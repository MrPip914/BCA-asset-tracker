-- 0010 — a backup before every bulk edit the Claude connector makes, and a way
-- to undo one (supabase/functions/mcp/). Eric, 2026-10-09: "always take a
-- backup before doing bulk edits".
--
-- The backup is taken INSIDE the write functions (connector_apply,
-- connector_replace_floor_plan, connector_set_plan_walls), in the same
-- transaction as the change, so there is no way to write without one and a
-- refused write leaves no backup behind. Every management tool goes through one
-- of those three: save_assets, archive_assets, add_tasks, edit_task,
-- delete_task, replace_floor_plan, set_plan_walls. The four single-record
-- writes of 0006 (add one task, complete one, log work, comment) are additive
-- and keep no backup.
--
-- A backup holds the RECORDS the change touches, each as it was before and as
-- the change left it:
--
--   asset  <id>       the asset row (label, tag, type, parent, data), or null
--                     when the change created it
--   tasks  <assetId>  that asset's whole task list, in order
--   plan   <assetId>  that plan's space links and groups, in order
--   config <key>      a managed list (never nextAssetNumber, which only climbs)
--
-- Several calls in ONE transaction add to ONE backup (keyed by the
-- transaction id), keeping the first "before" they saw, so set_plan_walls --
-- which runs connector_apply and then rewrites edges -- is one backup, and the
-- "after" is taken by the last seal.
--
-- Undo (connector_restore_backup) puts each record back as it was, ONLY where
-- it still reads as the change left it. A record someone changed again since
-- refuses the whole undo, naming it, unless the person says to overwrite those
-- later changes too. An asset the change CREATED is archived, never deleted.
-- An undo is itself a bulk edit, so it takes its own backup and can be undone.
--
-- The newest 200 backups per site are kept.

set search_path = asset_tracker;

create table connector_backups (
  tenant_id   text   not null references tenants (id),
  id          bigint generated always as identity,
  txid        bigint not null default txid_current(),
  taken_at    text   not null,
  by          text   not null,
  tool        text   not null,
  -- [{kind, key}], in the order first touched.
  scope       jsonb  not null default '[]',
  -- {"asset:<id>": state, "tasks:<id>": state, ...}
  before      jsonb  not null default '{}',
  after       jsonb  not null default '{}',
  restored_at text,
  restored_by text,
  primary key (tenant_id, id)
);
create index connector_backups_txid_idx on connector_backups (tenant_id, txid);

grant select, insert, update, delete on connector_backups to asset_api;
alter table connector_backups enable row level security;
create policy tenant_isolation on connector_backups to asset_api
  using (tenant_id = current_tenant())
  with check (tenant_id = current_tenant());

-- ------------------------------------------------------------------ states

-- One record as it stands now, or null when it does not exist. Positions are
-- left out: they shift when something earlier is removed, and are order, not
-- content (0007's rule). Lists are ordered, so order is kept by the array.
create function connector_backup_state(p_kind text, p_key text) returns jsonb
  language plpgsql stable
  set search_path = asset_tracker, pg_catalog as $$
declare
  out jsonb;
begin
  case p_kind
  when 'asset' then
    select jsonb_build_object('label', label, 'tag', tag, 'type', type, 'parent_id', parent_id, 'data', data)
      into out from assets where tenant_id = current_tenant() and id = p_key;
  when 'tasks' then
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'data', data) order by position), '[]')
      into out from maintenance where tenant_id = current_tenant() and asset_id = p_key;
  when 'plan' then
    select jsonb_build_object(
      'links', (select coalesce(jsonb_agg(jsonb_build_object('shape_id', shape_id, 'data', data) order by position), '[]')
                  from space_links where tenant_id = current_tenant() and plan_asset_id = p_key),
      'groups', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'data', data) order by position), '[]')
                  from space_groups where tenant_id = current_tenant() and plan_asset_id = p_key))
      into out;
  when 'config' then
    select value into out from config where tenant_id = current_tenant() and key = p_key;
  else
    raise exception 'connector: Unknown backup record "%".', p_kind;
  end case;
  return out;
end
$$;

-- What counts as "the same" when deciding whether a record moved since: a key
-- holding null, "" or an empty list is the same as no key, at any depth. The
-- app's full-snapshot save writes every field, blank ones included, so a
-- record it re-saved untouched must not read as changed.
create function connector_backup_norm(p jsonb) returns jsonb
  language sql immutable
  set search_path = asset_tracker, pg_catalog as $$
  select case jsonb_typeof(p)
    when 'object' then coalesce((
      select jsonb_object_agg(k, connector_backup_norm(v))
      from jsonb_each(p) as e(k, v)
      where v <> 'null'::jsonb and v <> '""'::jsonb and v <> '[]'::jsonb and v <> '{}'::jsonb), '{}'::jsonb)
    when 'array' then (select coalesce(jsonb_agg(connector_backup_norm(v) order by n), '[]'::jsonb)
                         from jsonb_array_elements(p) with ordinality as e(v, n))
    else p
  end
$$;

create function connector_backup_same(a jsonb, b jsonb) returns boolean
  language sql immutable
  set search_path = asset_tracker, pg_catalog as $$
  -- A record that did not exist is SQL null now and JSON null in a backup.
  select case
    when nullif(a, 'null') is null or nullif(b, 'null') is null then nullif(a, 'null') is null and nullif(b, 'null') is null
    else connector_backup_norm(a) = connector_backup_norm(b)
  end
$$;

-- ------------------------------------------------------------------ taking one

-- Adds records to this transaction's backup, creating it on the first call.
-- A record already in it keeps the "before" it was first seen with. Returns
-- the backup's id.
create function connector_backup(p_actor text, p_tool text, p_scope jsonb) returns bigint
  language plpgsql
  set search_path = asset_tracker, pg_catalog as $$
declare
  bid   bigint;
  sc    jsonb;
  bf    jsonb;
  r     jsonb;
  k     text;
begin
  select id, scope, before into bid, sc, bf from connector_backups
    where tenant_id = current_tenant() and txid = txid_current()
    for update;
  if not found then
    insert into connector_backups (tenant_id, taken_at, by, tool)
      values (current_tenant(), connector_now(), p_actor, p_tool)
      returning id, scope, before into bid, sc, bf;
    -- Keep the newest 200 per site.
    delete from connector_backups where tenant_id = current_tenant() and id in (
      select id from connector_backups where tenant_id = current_tenant()
        order by id desc offset 200);
  end if;
  for r in select value from jsonb_array_elements(coalesce(p_scope, '[]')) loop
    k := (r->>'kind') || ':' || (r->>'key');
    if coalesce(r->>'key', '') = '' or bf ? k then continue; end if;
    sc := sc || jsonb_build_array(jsonb_build_object('kind', r->>'kind', 'key', r->>'key'));
    bf := bf || jsonb_build_object(k, connector_backup_state(r->>'kind', r->>'key'));
  end loop;
  update connector_backups set scope = sc, before = bf
    where tenant_id = current_tenant() and id = bid;
  return bid;
end
$$;

-- Records how this transaction's change left every record in its backup. The
-- last call wins, so the function that finishes the change seals last.
create function connector_backup_seal() returns bigint
  language plpgsql
  set search_path = asset_tracker, pg_catalog as $$
declare
  bid bigint;
  sc  jsonb;
  af  jsonb := '{}';
  r   jsonb;
begin
  select id, scope into bid, sc from connector_backups
    where tenant_id = current_tenant() and txid = txid_current();
  if not found then return null; end if;
  for r in select value from jsonb_array_elements(sc) loop
    af := af || jsonb_build_object((r->>'kind') || ':' || (r->>'key'), connector_backup_state(r->>'kind', r->>'key'));
  end loop;
  update connector_backups set after = af where tenant_id = current_tenant() and id = bid;
  return bid;
end
$$;

-- ------------------------------------------------------------------ reading one

-- One backup with every record's three states and where it stands:
--   'changed'  reads as the change left it; undo puts it back
--   'reverted' already reads as it was before; undo leaves it
--   'later'    changed again since; undo refuses unless told to overwrite
create function connector_backup_preview(p_id bigint) returns jsonb
  language plpgsql stable
  set search_path = asset_tracker, pg_catalog as $$
declare
  b    connector_backups;
  r    jsonb;
  k    text;
  cur  jsonb;
  recs jsonb := '[]';
begin
  select * into b from connector_backups where tenant_id = current_tenant() and id = p_id;
  if not found then
    raise exception 'connector: No backup #% on this site.', p_id;
  end if;
  for r in select value from jsonb_array_elements(b.scope) loop
    k := (r->>'kind') || ':' || (r->>'key');
    cur := connector_backup_state(r->>'kind', r->>'key');
    recs := recs || jsonb_build_array(jsonb_build_object(
      'kind', r->>'kind', 'key', r->>'key',
      'status', case
        when connector_backup_same(cur, b.before->k) then 'reverted'
        when connector_backup_same(cur, b.after->k) then 'changed'
        else 'later' end,
      'before', b.before->k, 'after', b.after->k, 'current', cur));
  end loop;
  return jsonb_build_object('id', b.id, 'takenAt', b.taken_at, 'by', b."by", 'tool', b.tool,
    'restoredAt', b.restored_at, 'restoredBy', b.restored_by, 'records', recs);
end
$$;

-- ------------------------------------------------------------------ undo

create function connector_restore_backup(p_email text, p_expected jsonb, p_id bigint, p_overwrite boolean)
  returns jsonb
  language plpgsql
  set search_path = asset_tracker, pg_catalog as $$
declare
  actor  text := connector_actor(p_email);
  now_   text := connector_now();
  b      connector_backups;
  pv     jsonb;
  r      jsonb;
  st     jsonb;
  later  text[] := '{}';
  rev_a  integer;
  rev_c  integer;
  touched text[] := '{}';
  tags   text[] := '{}';
  dup    text;
  pos    integer;
  e      jsonb;
  n      integer;
  nb     bigint;
  undone integer := 0;
  arch   integer := 0;
begin
  rev_a := connector_take_revision('assets', (p_expected->>'assets')::integer);
  select * into b from connector_backups where tenant_id = current_tenant() and id = p_id for update;
  if not found then
    raise exception 'connector: No backup #% on this site.', p_id;
  end if;
  if b.restored_at is not null then
    raise exception 'connector: Backup #% was already undone (% by %).', p_id, b.restored_at, b.restored_by;
  end if;
  if b.txid = txid_current() then
    raise exception 'connector: A change cannot undo itself.';
  end if;
  if exists (select 1 from jsonb_array_elements(b.scope) s where s->>'kind' = 'config') then
    rev_c := connector_take_revision('config', (p_expected->>'config')::integer);
  end if;

  pv := connector_backup_preview(p_id);
  for r in select value from jsonb_array_elements(pv->'records') loop
    if r->>'status' = 'later' then
      later := later || (case r->>'kind' when 'tasks' then 'the tasks on ' when 'plan' then 'the floor plan links on '
          when 'config' then 'the list ' else '' end || coalesce(
        (select coalesce(nullif(data->>'name', ''), nullif(tag, ''), id) from assets
           where tenant_id = current_tenant() and id = r->>'key' and r->>'kind' <> 'config'),
        r->>'key'));
    end if;
  end loop;
  if not exists (select 1 from jsonb_array_elements(pv->'records') x where x->>'status' <> 'reverted') then
    raise exception 'connector: Everything in backup #% already reads as it did before that change, so there is nothing to undo.', p_id;
  end if;
  if array_length(later, 1) > 0 and not coalesce(p_overwrite, false) then
    raise exception 'connector: These were changed again after backup #% was taken, so nothing was undone: %. Undo anyway only if the person agrees to lose those later changes.',
      p_id, array_to_string(later, ', ');
  end if;

  -- The undo is a bulk edit too.
  nb := connector_backup(actor, 'undo backup #' || p_id,
    (select jsonb_agg(jsonb_build_object('kind', x->>'kind', 'key', x->>'key'))
       from jsonb_array_elements(pv->'records') x where x->>'status' <> 'reverted'));

  for r in select value from jsonb_array_elements(pv->'records') loop
    continue when r->>'status' = 'reverted';
    st := nullif(r->'before', 'null');
    case r->>'kind'

    when 'asset' then
      if st is null then
        -- The change created it: archive, never delete.
        if exists (select 1 from assets where tenant_id = current_tenant() and id = r->>'key'
                     and coalesce(data->>'status', '') <> 'Archived') then
          update assets set data = data || '{"status":"Archived"}'
            where tenant_id = current_tenant() and id = r->>'key';
          insert into audit_log (tenant_id, asset_id, at, by, action, data)
            select current_tenant(), id, now_, actor, 'archived',
              jsonb_build_object('assetLabel', id, 'assetType', coalesce(type, ''), 'action', 'archived', 'at', now_, 'by', actor)
            from assets where tenant_id = current_tenant() and id = r->>'key';
          arch := arch + 1;
        end if;
        continue;
      end if;
      if nullif(trim(st->>'tag'), '') is not null then tags := tags || lower(trim(st->>'tag')); end if;
      update assets set label = st->>'label', tag = st->>'tag', type = st->>'type',
          parent_id = st->>'parent_id', data = st->'data'
        where tenant_id = current_tenant() and id = r->>'key';
      if not found then
        select coalesce(max(position), -1) + 1 into pos from assets where tenant_id = current_tenant();
        insert into assets (tenant_id, id, position, label, tag, type, parent_id, data)
          values (current_tenant(), r->>'key', pos, st->>'label', st->>'tag', st->>'type', st->>'parent_id', st->'data');
      end if;
      touched := touched || (r->>'key');

    when 'tasks' then
      if not exists (select 1 from assets where tenant_id = current_tenant() and id = r->>'key') then
        continue;  -- the asset is gone; its tasks went with it
      end if;
      delete from maintenance where tenant_id = current_tenant() and asset_id = r->>'key';
      n := 0;
      for e in select value from jsonb_array_elements(coalesce(st, '[]')) loop
        -- A task id is unique across the site; one that moved to another asset
        -- since comes back here.
        delete from maintenance where tenant_id = current_tenant() and id = e->>'id';
        insert into maintenance (tenant_id, id, asset_id, position, data)
          values (current_tenant(), e->>'id', r->>'key', n, e->'data');
        n := n + 1;
      end loop;
      touched := touched || (r->>'key');

    when 'plan' then
      if not exists (select 1 from assets where tenant_id = current_tenant() and id = r->>'key') then
        continue;
      end if;
      delete from space_links where tenant_id = current_tenant() and plan_asset_id = r->>'key';
      delete from space_groups where tenant_id = current_tenant() and plan_asset_id = r->>'key';
      n := 0;
      for e in select value from jsonb_array_elements(coalesce(st->'links', '[]')) loop
        insert into space_links (tenant_id, plan_asset_id, shape_id, position, data)
          values (current_tenant(), r->>'key', e->>'shape_id', n, e->'data');
        n := n + 1;
      end loop;
      n := 0;
      for e in select value from jsonb_array_elements(coalesce(st->'groups', '[]')) loop
        delete from space_groups where tenant_id = current_tenant() and id = e->>'id';
        insert into space_groups (tenant_id, id, plan_asset_id, position, data)
          values (current_tenant(), e->>'id', r->>'key', n, e->'data');
        n := n + 1;
      end loop;
      touched := touched || (r->>'key');

    when 'config' then
      if st is null then
        delete from config where tenant_id = current_tenant() and key = r->>'key';
      else
        insert into config (tenant_id, key, value) values (current_tenant(), r->>'key', st)
          on conflict (tenant_id, key) do update set value = excluded.value;
      end if;
    end case;
    undone := undone + 1;
  end loop;

  select t into dup from (
    select lower(trim(tag)) as t from assets
      where tenant_id = current_tenant() and lower(trim(tag)) = any(tags)
      group by lower(trim(tag)) having count(*) > 1
  ) x limit 1;
  if dup is not null then
    raise exception 'connector: Undoing would put Asset ID % on two assets, since another asset has taken it. Nothing was undone.', upper(dup);
  end if;

  -- One row on each asset put back, in the app's generic "X changed from A to B" shape.
  insert into audit_log (tenant_id, asset_id, at, by, action, data)
    select current_tenant(), a.id, now_, actor, 'backup_restored',
      jsonb_build_object('assetLabel', a.id, 'assetType', coalesce(a.type, ''), 'action', 'backup_restored',
        'field', 'Change via Claude', 'from', b.tool || ' by ' || b."by" || ', ' || b.taken_at,
        'to', 'undone (backup #' || p_id || ')', 'at', now_, 'by', actor)
    from assets a
    where a.tenant_id = current_tenant() and a.id = any(select distinct unnest(touched));

  update connector_backups set restored_at = now_, restored_by = actor
    where tenant_id = current_tenant() and id = p_id;
  perform connector_backup_seal();

  return jsonb_strip_nulls(jsonb_build_object('revision', rev_a, 'configRevision', rev_c,
    'undone', undone, 'archived', arch, 'backup', nb));
end
$$;

-- ------------------------------------------------------------------ the writes, now with a backup

-- connector_apply (0007), unchanged but for the backup: every asset an op
-- names, the task list of every asset a task op names, and every managed list
-- written. Taken after the revision check, before the first write.
create or replace function connector_apply(p_email text, p_expected jsonb, p_ops jsonb) returns jsonb
  language plpgsql
  set search_path = asset_tracker, pg_catalog as $$
declare
  actor  text := connector_actor(p_email);
  now_   text := connector_now();
  rev_a  integer;
  rev_c  integer;
  op     jsonb;
  d      jsonb;
  pos    integer;
  tags   text[] := '{}';
  dup    text;
  stored jsonb;
  bid    bigint;
begin
  if jsonb_typeof(p_ops) is distinct from 'array' or jsonb_array_length(p_ops) = 0 then
    raise exception 'connector: Nothing to write.';
  end if;
  rev_a := connector_take_revision('assets', (p_expected->>'assets')::integer);
  if exists (select 1 from jsonb_array_elements(p_ops) o where o->>'op' = 'config') then
    rev_c := connector_take_revision('config', (p_expected->>'config')::integer);
  end if;

  -- The tool's name rides in a transaction setting (index.ts sets it), since
  -- this function's signature is the 0007 one every caller already uses.
  bid := connector_backup(actor, coalesce(nullif(current_setting('connector.tool', true), ''), 'connector'), (
    select coalesce(jsonb_agg(s), '[]') from (
      select jsonb_build_object('kind', 'asset', 'key', o->>'id') as s
        from jsonb_array_elements(p_ops) o where o->>'op' in ('asset_create', 'asset_update')
      union all
      select jsonb_build_object('kind', 'tasks', 'key', o->>'assetId')
        from jsonb_array_elements(p_ops) o where o->>'op' in ('task_insert', 'task_update', 'task_delete')
      union all
      select jsonb_build_object('kind', 'config', 'key', o->>'key')
        from jsonb_array_elements(p_ops) o where o->>'op' = 'config' and o->>'key' <> 'nextAssetNumber'
    ) x));

  for op in select value from jsonb_array_elements(p_ops) with ordinality as e(value, n) order by n loop
    d := op->'data';
    case op->>'op'

    when 'asset_create', 'asset_update' then
      if coalesce(op->>'id', '') = '' or jsonb_typeof(d) is distinct from 'object' or d->>'id' is distinct from op->>'id' then
        raise exception 'connector: An asset change was malformed.';
      end if;
      if nullif(trim(d->>'tag'), '') is not null then tags := tags || lower(trim(d->>'tag')); end if;
      if op->>'op' = 'asset_create' then
        if exists (select 1 from assets where tenant_id = current_tenant() and id = op->>'id') then
          raise exception 'connector: An asset with id % already exists.', op->>'id';
        end if;
        select coalesce(max(position), -1) + 1 into pos from assets where tenant_id = current_tenant();
        insert into assets (tenant_id, id, position, label, tag, type, parent_id, data) values (
          current_tenant(), op->>'id', pos,
          nullif(trim(d->>'label'), ''), nullif(trim(d->>'tag'), ''), nullif(trim(d->>'type'), ''),
          nullif(trim(d->>'parentId'), ''), d);
      else
        update assets set
          label = nullif(trim(d->>'label'), ''), tag = nullif(trim(d->>'tag'), ''),
          type = nullif(trim(d->>'type'), ''), parent_id = nullif(trim(d->>'parentId'), ''), data = d
          where tenant_id = current_tenant() and id = op->>'id';
        if not found then
          raise exception 'connector: No such asset (%).', op->>'id';
        end if;
      end if;

    when 'task_insert' then
      perform connector_live_asset(op->>'assetId');
      if coalesce(trim(d->>'task'), '') = '' then
        raise exception 'connector: A task needs a name.';
      end if;
      select coalesce(max(position), -1) + 1 into pos from maintenance
        where tenant_id = current_tenant() and asset_id = op->>'assetId';
      insert into maintenance (tenant_id, id, asset_id, position, data) values (
        current_tenant(), op->>'id', op->>'assetId', pos,
        d || jsonb_build_object('id', op->>'id', 'at', now_, 'by', actor));

    when 'task_update' then
      if coalesce(trim(d->>'task'), '') = '' then
        raise exception 'connector: A task needs a name.';
      end if;
      select data into stored from maintenance
        where tenant_id = current_tenant() and id = op->>'id' and asset_id = op->>'assetId'
        for update;
      if not found then
        raise exception 'connector: No such task.';
      end if;
      -- Who first entered it and when stays true after an edit.
      update maintenance set data = (d - 'at' - 'by') || jsonb_build_object('id', op->>'id')
          || jsonb_strip_nulls(jsonb_build_object('at', stored->'at', 'by', stored->'by'))
        where tenant_id = current_tenant() and id = op->>'id';

    when 'task_delete' then
      delete from maintenance
        where tenant_id = current_tenant() and id = op->>'id' and asset_id = op->>'assetId';
      if not found then
        raise exception 'connector: No such task.';
      end if;

    when 'audit' then
      if jsonb_typeof(d) is distinct from 'object' or coalesce(d->>'action', '') = '' then
        raise exception 'connector: An audit row was malformed.';
      end if;
      insert into audit_log (tenant_id, asset_id, at, by, action, data) values (
        current_tenant(), nullif(d->>'assetLabel', ''), now_, actor, d->>'action',
        d || jsonb_build_object('at', now_, 'by', actor));

    when 'config' then
      if op->>'key' = 'nextAssetNumber' then
        -- Never backwards, as the save keeps it.
        select value into stored from config where tenant_id = current_tenant() and key = 'nextAssetNumber';
        insert into config (tenant_id, key, value) values (current_tenant(), 'nextAssetNumber',
            to_jsonb(greatest(
              case when op->>'value' ~ '^\d{1,9}$' then (op->>'value')::integer else 0 end,
              case when stored #>> '{}' ~ '^\d{1,9}$' then (stored #>> '{}')::integer else 0 end)))
          on conflict (tenant_id, key) do update set value = excluded.value;
      elsif op->>'key' in ('peripheralsList', 'bulkItemTypes') then
        if jsonb_typeof(op->'value') is distinct from 'array' then
          raise exception 'connector: A list was malformed.';
        end if;
        insert into config (tenant_id, key, value) values (current_tenant(), op->>'key', op->'value')
          on conflict (tenant_id, key) do update set value = excluded.value;
      else
        raise exception 'connector: That setting cannot be changed from Claude.';
      end if;

    else
      raise exception 'connector: Unknown change "%".', op->>'op';
    end case;
  end loop;

  select t into dup from (
    select lower(trim(tag)) as t from assets
      where tenant_id = current_tenant() and lower(trim(tag)) = any(tags)
      group by lower(trim(tag)) having count(*) > 1
  ) x limit 1;
  if dup is not null then
    raise exception 'connector: Asset ID % would be on two assets. Nothing was written.', upper(dup);
  end if;

  perform connector_backup_seal();
  return jsonb_strip_nulls(jsonb_build_object('revision', rev_a, 'configRevision', rev_c, 'backup', bid));
end
$$;

-- connector_replace_floor_plan (0008), with the plan asset's row and its links
-- and groups backed up first.
create or replace function connector_replace_floor_plan(
  p_email text, p_expected jsonb, p_asset_id text, p_plan jsonb, p_links jsonb, p_groups jsonb
) returns jsonb
  language plpgsql
  set search_path = asset_tracker, pg_catalog as $$
declare
  actor text := connector_actor(p_email);
  now_  text := connector_now();
  rev_a integer;
  atype text;
  l     jsonb;
  g     jsonb;
  n     integer := 0;
  bid   bigint;
begin
  rev_a := connector_take_revision('assets', (p_expected->>'assets')::integer);
  atype := connector_live_asset(p_asset_id);

  if jsonb_typeof(p_plan) is distinct from 'object'
     or coalesce(p_plan->>'url', '') !~ '^https://res\.cloudinary\.com/'
     or coalesce(trim(p_plan->>'fileName'), '') = '' then
    raise exception 'connector: The new floor plan was malformed.';
  end if;
  if jsonb_typeof(p_links) is distinct from 'array' or jsonb_typeof(p_groups) is distinct from 'array' then
    raise exception 'connector: The floor plan links were malformed.';
  end if;

  bid := connector_backup(actor, 'replace_floor_plan', jsonb_build_array(
    jsonb_build_object('kind', 'asset', 'key', p_asset_id),
    jsonb_build_object('kind', 'plan', 'key', p_asset_id)));

  update assets set data = data || jsonb_build_object(
      'floorPlanUrl', p_plan->>'url',
      'floorPlanStorageKey', coalesce(p_plan->>'storageKey', ''),
      'floorPlanFileName', p_plan->>'fileName')
    where tenant_id = current_tenant() and id = p_asset_id;

  delete from space_links where tenant_id = current_tenant() and plan_asset_id = p_asset_id;
  delete from space_groups where tenant_id = current_tenant() and plan_asset_id = p_asset_id;

  for l in select value from jsonb_array_elements(p_links) loop
    if coalesce(l->>'shapeId', '') = '' or coalesce(l->>'roomId', '') = '' then
      raise exception 'connector: A floor plan link was malformed.';
    end if;
    if exists (select 1 from space_links where tenant_id = current_tenant()
               and plan_asset_id = p_asset_id and shape_id = l->>'shapeId') then
      raise exception 'connector: Two links name the same shape (%).', l->>'shapeId';
    end if;
    insert into space_links (tenant_id, plan_asset_id, shape_id, position, data)
      values (current_tenant(), p_asset_id, l->>'shapeId', n, l);
    n := n + 1;
  end loop;

  n := 0;
  for g in select value from jsonb_array_elements(p_groups) loop
    if coalesce(g->>'id', '') = '' or jsonb_typeof(g->'memberShapeIds') is distinct from 'array'
       or jsonb_array_length(g->'memberShapeIds') < 2 then
      raise exception 'connector: A floor plan group was malformed.';
    end if;
    insert into space_groups (tenant_id, id, plan_asset_id, position, data)
      values (current_tenant(), g->>'id', p_asset_id, n, g);
    n := n + 1;
  end loop;

  insert into audit_log (tenant_id, asset_id, at, by, action, data) values (
    current_tenant(), p_asset_id, now_, actor, 'floor_plan_replaced',
    jsonb_build_object('assetLabel', p_asset_id, 'assetType', atype, 'action', 'floor_plan_replaced',
      'to', p_plan->>'fileName', 'at', now_, 'by', actor));

  perform connector_backup_seal();
  return jsonb_build_object('revision', rev_a, 'backup', bid);
end
$$;

-- connector_set_plan_walls (0009), with the plan's links backed up first; the
-- walls it creates or renames join the same backup through connector_apply.
create or replace function connector_set_plan_walls(
  p_email text, p_expected jsonb, p_plan_asset_id text, p_ops jsonb, p_walls jsonb, p_removes jsonb
) returns jsonb
  language plpgsql
  set search_path = asset_tracker, pg_catalog as $$
declare
  actor text := connector_actor(p_email);
  now_  text := connector_now();
  out   jsonb;
  w     jsonb;
  wid   text;
  seg   text;
  wtype text;
  n     integer;
begin
  if jsonb_typeof(p_walls) is distinct from 'array' or jsonb_typeof(p_removes) is distinct from 'array'
     or jsonb_array_length(p_walls) + jsonb_array_length(p_removes) = 0 then
    raise exception 'connector: The wall change was malformed.';
  end if;

  -- The role check, the revision, any new walls and every audit row -- and the
  -- backup, which the plan's links join next, before any edge moves.
  perform set_config('connector.tool', 'set_plan_walls', true);
  out := connector_apply(p_email, p_expected, p_ops);
  perform connector_live_asset(p_plan_asset_id);
  perform connector_backup(actor, 'set_plan_walls',
    jsonb_build_array(jsonb_build_object('kind', 'plan', 'key', p_plan_asset_id)));

  for wid in
    select value #>> '{}' from jsonb_array_elements(p_removes)
    union all
    select value ->> 'wallId' from jsonb_array_elements(p_walls)
  loop
    select type into wtype from assets where tenant_id = current_tenant() and id = wid;
    if not found then
      raise exception 'connector: No such asset (%).', wid;
    end if;
    if wtype is distinct from 'Wall' then
      raise exception 'connector: % is not a wall.', wid;
    end if;
    delete from space_links
      where tenant_id = current_tenant() and plan_asset_id = p_plan_asset_id
        and data ->> 'roomId' = wid and shape_id ~ '#e[0-9]+(\.[0-9]+)?$';
  end loop;

  select coalesce(max(position), -1) + 1 into n from space_links
    where tenant_id = current_tenant() and plan_asset_id = p_plan_asset_id;
  for w in select value from jsonb_array_elements(p_walls) loop
    wid := w ->> 'wallId';
    perform connector_live_asset(wid);
    if jsonb_typeof(w -> 'segmentIds') is distinct from 'array' or jsonb_array_length(w -> 'segmentIds') = 0 then
      raise exception 'connector: A wall had no edges.';
    end if;
    for seg in select value #>> '{}' from jsonb_array_elements(w -> 'segmentIds') loop
      if coalesce(seg, '') !~ '^.+#e[0-9]+(\.[0-9]+)?$' then
        raise exception 'connector: A wall edge was malformed.';
      end if;
      if exists (select 1 from space_links where tenant_id = current_tenant()
                 and plan_asset_id = p_plan_asset_id and shape_id = seg) then
        raise exception 'connector: The edge % already belongs to another wall. Nothing was written.', seg;
      end if;
      insert into space_links (tenant_id, plan_asset_id, shape_id, position, data)
        values (current_tenant(), p_plan_asset_id, seg, n,
          jsonb_build_object('shapeId', seg, 'roomId', wid, 'at', now_, 'by', actor));
      n := n + 1;
    end loop;
  end loop;

  perform connector_backup_seal();
  return out;
end
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'connector_backup_state(text, text)', 'connector_backup_norm(jsonb)', 'connector_backup_same(jsonb, jsonb)',
    'connector_backup(text, text, jsonb)', 'connector_backup_seal()', 'connector_backup_preview(bigint)',
    'connector_restore_backup(text, jsonb, bigint, boolean)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to asset_api', f);
  end loop;
end
$$;
