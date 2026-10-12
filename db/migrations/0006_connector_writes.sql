-- 0006 — the Claude connector's writes (supabase/functions/mcp/).
--
-- Each write is ONE function, so the rules a write must keep happen in one
-- transaction and cannot be skipped by a caller that forgets one:
--
--   1. the caller is an editor on this tenant (owner, or 'editor' on the
--      allowlist), re-read on every call;
--   2. the `assets` revision is bumped FIRST, which takes the row lock every
--      save takes, so the write is serialized against the app's own saves, and
--      an open browser holding the old revision is refused and reloads rather
--      than overwriting this change;
--   3. the record is written with the app's own shape, stamped `by` the
--      person's name "(via Claude)";
--   4. where the app audits the same act, the audit row the app would write.
--      The app does not audit adding a task, logging work or commenting (each
--      carries its own at/by), and neither does this; it does audit a
--      completion.
--
-- The connector builds and validates each record's FIELDS in JS (tools.js),
-- where the app's own rules for tasks and repeat rules are copied verbatim and
-- tested. What lives here is what must hold whatever JS sent: who may write,
-- that the asset or task exists in this tenant and is live, the lock, the
-- revision, the stamps.
--
-- Each pins its own search_path, so it resolves the same tables and helpers
-- whatever the caller's path is. SECURITY INVOKER (the default): they run as asset_api with app.tenant_id
-- set, so row-level security applies to every statement inside them. An error
-- meant for the person starts with "connector: "; index.ts turns that into the
-- tool's answer and anything else into a vague failure.

set search_path = asset_tracker;

-- ------------------------------------------------------------------ helpers

-- The person's display name for `by`, or an error when they may not write.
create function connector_actor(p_email text) returns text
  language plpgsql stable
  set search_path = asset_tracker, pg_catalog as $$
declare
  e     text := lower(trim(coalesce(p_email, '')));
  owner text;
  nm    text;
  rl    text;
begin
  select owner_email into owner from tenants where id = current_tenant();
  if owner is null then
    raise exception 'connector: That site is not available.';
  end if;
  select name, role into nm, rl from auth_users where email = e;
  if e = '' or (lower(owner) <> e and coalesce(rl, '') <> 'editor') then
    raise exception 'connector: You have view-only access to this site, so nothing was changed.';
  end if;
  return coalesce(nullif(trim(nm), ''), e) || ' (via Claude)';
end
$$;

-- Moves the assets revision on by one and returns it. Called FIRST: the UPDATE
-- is the row lock (0001: "The FOR UPDATE on these rows is the lock that
-- replaces LockService").
create function connector_bump_assets() returns integer
  language plpgsql
  set search_path = asset_tracker, pg_catalog as $$
declare
  v integer;
begin
  insert into revisions (tenant_id, domain, rev) values (current_tenant(), 'assets', 0)
    on conflict do nothing;
  update revisions set rev = rev + 1
    where tenant_id = current_tenant() and domain = 'assets'
    returning rev into v;
  return v;
end
$$;

-- The asset's type, or an error when it is not a live asset of this tenant.
create function connector_live_asset(p_asset_id text) returns text
  language plpgsql stable
  set search_path = asset_tracker, pg_catalog as $$
declare
  t    text;
  st   text;
begin
  select type, data->>'status' into t, st from assets
    where tenant_id = current_tenant() and id = p_asset_id;
  if not found then
    raise exception 'connector: No such asset.';
  end if;
  if st = 'Archived' then
    raise exception 'connector: That asset is archived. Restore it in the app first.';
  end if;
  return coalesce(t, '');
end
$$;

-- The app's toISOString(): 2026-10-09T00:44:03.123Z.
create function connector_now() returns text
  language sql stable
  set search_path = asset_tracker, pg_catalog as $$
  select to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- The app's formatDateOnly() in an en-US browser: "Oct 9, 2026". A value that
-- is not a date is returned as it stands, as the app does.
create function connector_fmt_date(p text) returns text
  language sql immutable
  set search_path = asset_tracker, pg_catalog as $$
  select case
    when coalesce(p, '') = '' then ''
    when left(p, 10) ~ '^\d{4}-\d{2}-\d{2}$' then to_char(left(p, 10)::date, 'Mon FMDD, YYYY')
    else p
  end
$$;

create function connector_check_date(p text) returns void
  language plpgsql immutable
  set search_path = asset_tracker, pg_catalog as $$
begin
  if coalesce(p, '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'connector: A date must be yyyy-mm-dd.';
  end if;
  perform p::date;
exception when datetime_field_overflow or invalid_datetime_format then
  raise exception 'connector: % is not a real date.', p;
end
$$;

-- ------------------------------------------------------------------ writes

-- A task (recurring or one-off) on an asset. p_item is the maintenance record
-- tools.js built; id, at and by are set here.
create function connector_add_task(p_email text, p_asset_id text, p_item jsonb) returns jsonb
  language plpgsql
  set search_path = asset_tracker, pg_catalog as $$
declare
  actor text := connector_actor(p_email);
  rev   integer := connector_bump_assets();
  tid   text := gen_random_uuid()::text;
  pos   integer;
begin
  perform connector_live_asset(p_asset_id);
  if coalesce(trim(p_item->>'task'), '') = '' then
    raise exception 'connector: A task needs a name.';
  end if;
  select coalesce(max(position), -1) + 1 into pos from maintenance
    where tenant_id = current_tenant() and asset_id = p_asset_id;
  insert into maintenance (tenant_id, id, asset_id, position, data) values (
    current_tenant(), tid, p_asset_id, pos,
    p_item || jsonb_build_object('id', tid, 'at', connector_now(), 'by', actor));
  return jsonb_build_object('id', tid, 'revision', rev);
end
$$;

-- Logs a completion of a task, the app's "Log completion": stamps the task's
-- lastPerformed, writes a work entry linked to it with the same date, and the
-- maintenance_completed audit row. p_change is { changeType, vendor, cost, note }.
create function connector_complete_task(p_email text, p_task_id text, p_date text, p_change jsonb) returns jsonb
  language plpgsql
  set search_path = asset_tracker, pg_catalog as $$
declare
  actor text := connector_actor(p_email);
  rev   integer := connector_bump_assets();
  aid   text;
  item  jsonb;
  atype text;
  cid   text := gen_random_uuid()::text;
  now_  text := connector_now();
  pos   integer;
begin
  perform connector_check_date(p_date);
  select asset_id, data into aid, item from maintenance
    where tenant_id = current_tenant() and id = p_task_id
    for update;
  if not found then
    raise exception 'connector: No such task.';
  end if;
  atype := connector_live_asset(aid);
  if item->>'kind' = 'oneoff' and coalesce(item->>'lastPerformed', '') <> '' then
    raise exception 'connector: That one-off task is already done (%). Clear its completed date in the app to reopen it.',
      connector_fmt_date(item->>'lastPerformed');
  end if;

  update maintenance set data = data || jsonb_build_object('lastPerformed', p_date)
    where tenant_id = current_tenant() and id = p_task_id;

  select coalesce(max(position), -1) + 1 into pos from changes
    where tenant_id = current_tenant() and asset_id = aid;
  insert into changes (tenant_id, id, asset_id, position, data) values (
    current_tenant(), cid, aid, pos,
    p_change || jsonb_build_object('id', cid, 'at', now_, 'by', actor,
      'performedOn', p_date, 'maintenanceId', p_task_id));

  insert into audit_log (tenant_id, asset_id, at, by, action, data) values (
    current_tenant(), aid, now_, actor, 'maintenance_completed',
    jsonb_build_object(
      'at', now_, 'by', actor, 'assetLabel', aid, 'assetType', atype,
      'action', 'maintenance_completed', 'field', coalesce(item->>'task', ''),
      'from', case when coalesce(item->>'lastPerformed', '') = '' then 'never'
                   else connector_fmt_date(item->>'lastPerformed') end,
      'to', connector_fmt_date(p_date)));

  return jsonb_build_object('id', cid, 'assetId', aid, 'previous', coalesce(item->>'lastPerformed', ''), 'revision', rev);
end
$$;

-- A work entry, the app's "Log work". p_change is { changeType, vendor, cost,
-- note, performedOn, maintenanceId }; a linked task must be on the same asset,
-- as the app's picker only offers that asset's tasks. Linking does NOT mark the
-- task done (the app's checkbox defaults off); complete_task does that.
create function connector_log_work(p_email text, p_asset_id text, p_change jsonb) returns jsonb
  language plpgsql
  set search_path = asset_tracker, pg_catalog as $$
declare
  actor text := connector_actor(p_email);
  rev   integer := connector_bump_assets();
  cid   text := gen_random_uuid()::text;
  pos   integer;
begin
  perform connector_live_asset(p_asset_id);
  perform connector_check_date(p_change->>'performedOn');
  if coalesce(p_change->>'maintenanceId', '') <> '' and not exists (
    select 1 from maintenance where tenant_id = current_tenant()
      and id = p_change->>'maintenanceId' and asset_id = p_asset_id) then
    raise exception 'connector: That task is not on this asset.';
  end if;
  select coalesce(max(position), -1) + 1 into pos from changes
    where tenant_id = current_tenant() and asset_id = p_asset_id;
  insert into changes (tenant_id, id, asset_id, position, data) values (
    current_tenant(), cid, p_asset_id, pos,
    p_change || jsonb_build_object('id', cid, 'at', connector_now(), 'by', actor));
  return jsonb_build_object('id', cid, 'revision', rev);
end
$$;

create function connector_add_comment(p_email text, p_asset_id text, p_text text) returns jsonb
  language plpgsql
  set search_path = asset_tracker, pg_catalog as $$
declare
  actor text := connector_actor(p_email);
  rev   integer := connector_bump_assets();
  pos   integer;
begin
  perform connector_live_asset(p_asset_id);
  if coalesce(trim(p_text), '') = '' then
    raise exception 'connector: A comment needs some text.';
  end if;
  select coalesce(max(position), -1) + 1 into pos from comments
    where tenant_id = current_tenant() and asset_id = p_asset_id;
  insert into comments (tenant_id, asset_id, position, data) values (
    current_tenant(), p_asset_id, pos,
    jsonb_build_object('text', trim(p_text), 'at', connector_now(), 'by', actor));
  return jsonb_build_object('revision', rev);
end
$$;

-- ------------------------------------------------------------------ grants

do $$
declare
  f text;
begin
  foreach f in array array[
    'connector_actor(text)', 'connector_bump_assets()', 'connector_live_asset(text)',
    'connector_now()', 'connector_fmt_date(text)', 'connector_check_date(text)',
    'connector_add_task(text, text, jsonb)', 'connector_complete_task(text, text, text, jsonb)',
    'connector_log_work(text, text, jsonb)', 'connector_add_comment(text, text, text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to asset_api', f);
  end loop;
end
$$;
