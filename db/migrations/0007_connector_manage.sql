-- 0007 — the Claude connector's management writes (supabase/functions/mcp/):
-- creating and editing assets in bulk, archiving and restoring them, and
-- adding, editing and deleting tasks.
--
-- ONE function, connector_apply, takes the whole change as a list of ops and
-- applies it in one transaction or not at all. The connector builds the ops in
-- JS with the app's own import and task rules (asset-writes.js, app-rules.js),
-- because those rules are a few thousand lines of the app's code and are only
-- trustworthy as the app's code. What lives here is what must hold whatever JS
-- sent:
--
--   1. the caller is an editor on this tenant (connector_actor, from 0006);
--   2. THE INVENTORY HAS NOT MOVED since JS read it. JS sends the revisions it
--      read; each domain this touches is locked and compared, and a mismatch
--      refuses everything. JS planned against that picture (tags unique, a
--      parent's type, no loops), so a write on a newer one could break any of
--      them. This is the same check the app's own saves pass;
--   3. the revisions move on, so an open browser reloads rather than
--      overwriting this change;
--   4. every audit row is stamped now, by the person's name "(via Claude)",
--      whatever JS put there;
--   5. no two assets this touches end up wearing one tag (a belt for the
--      whole-inventory check JS ran, given 2 holds).
--
-- An asset's `data` is written whole, in the save's own shape (shapeAssets),
-- with the real columns beside it copied from it as the save does. Only three
-- config keys may be written, the ones the app's import writes.

set search_path = asset_tracker;

-- Locks one revision row, refuses if it is not the one the caller read, and
-- moves it on. Returns the new value.
create function connector_take_revision(p_domain text, p_expected integer) returns integer
  language plpgsql
  set search_path = asset_tracker, pg_catalog as $$
declare
  cur integer;
begin
  insert into revisions (tenant_id, domain, rev) values (current_tenant(), p_domain, 0)
    on conflict do nothing;
  select rev into cur from revisions
    where tenant_id = current_tenant() and domain = p_domain
    for update;
  -- A domain nothing has saved yet has no row, which the read reports as 0.
  if cur is distinct from coalesce(p_expected, 0) then
    raise exception 'connector: The inventory changed while I was working on this (someone saved in the app). Nothing was written. Look again and resend.';
  end if;
  update revisions set rev = rev + 1
    where tenant_id = current_tenant() and domain = p_domain
    returning rev into cur;
  return cur;
end
$$;

create function connector_apply(p_email text, p_expected jsonb, p_ops jsonb) returns jsonb
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
begin
  if jsonb_typeof(p_ops) is distinct from 'array' or jsonb_array_length(p_ops) = 0 then
    raise exception 'connector: Nothing to write.';
  end if;
  rev_a := connector_take_revision('assets', (p_expected->>'assets')::integer);
  if exists (select 1 from jsonb_array_elements(p_ops) o where o->>'op' = 'config') then
    rev_c := connector_take_revision('config', (p_expected->>'config')::integer);
  end if;

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

  return jsonb_strip_nulls(jsonb_build_object('revision', rev_a, 'configRevision', rev_c));
end
$$;

do $$
declare
  f text;
begin
  foreach f in array array['connector_take_revision(text, integer)', 'connector_apply(text, jsonb, jsonb)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to asset_api', f);
  end loop;
end
$$;
