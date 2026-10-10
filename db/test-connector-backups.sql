-- Checks the Claude connector's backups and undo (0010) against a THROWAWAY
-- database after db/migrate.sh. CI runs it on every change under db/; never
-- point it at dev.
--
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f db/test-connector-backups.sql
--
-- Runs as a stand-in for the connector's role, so row-level security applies
-- exactly as it does in production. Each change is its own transaction, as each
-- tool call is, because a backup is keyed by the transaction. Each check
-- raises on failure.

\set QUIET on
\o /dev/null
set search_path = asset_tracker;

insert into tenants (id, name, owner_email) values
  ('bk_a', 'Backups A', 'owner@bka.test'),
  ('bk_b', 'Backups B', 'owner@bkb.test');
insert into auth_users (tenant_id, email, role, name) values
  ('bk_a', 'ed@bka.test', 'editor', 'Ed Itor'),
  ('bk_a', 'view@bka.test', 'viewer', 'Vi Ewer');
insert into assets (tenant_id, id, position, type, tag, data) values
  ('bk_a', 'bld', 0, 'Building', null, '{"id":"bld","name":"Building 1"}'),
  ('bk_a', 'pc1', 1, 'Computer', 'BCA0001', '{"id":"pc1","type":"Computer","tag":"BCA0001","name":"Front desk","serial":"S1"}'),
  ('bk_a', 'pc2', 2, 'Computer', 'BCA0002', '{"id":"pc2","type":"Computer","tag":"BCA0002","name":"Library","serial":"S2"}'),
  ('bk_b', 'secret', 0, 'Room', null, '{"name":"B room"}');
insert into maintenance (tenant_id, id, asset_id, position, data) values
  ('bk_a', 't1', 'pc1', 0, '{"id":"t1","task":"Dust"}'),
  ('bk_a', 't2', 'pc1', 1, '{"id":"t2","task":"Update"}');
insert into config (tenant_id, key, value) values ('bk_a', 'peripheralsList', '["Mouse"]');
insert into space_links (tenant_id, plan_asset_id, shape_id, position, data) values
  ('bk_a', 'bld', 'g1', 0, '{"shapeId":"g1","roomId":"pc1"}');
insert into space_groups (tenant_id, id, plan_asset_id, position, data) values
  ('bk_a', 'grp', 'bld', 0, '{"id":"grp","memberShapeIds":["g1","g2"]}');
update assets set data = data || '{"floorPlanUrl":"https://res.cloudinary.com/x/old.svg","floorPlanFileName":"old.svg"}' where id = 'bld';

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'test_bk_login') then create role test_bk_login nologin; grant asset_api to test_bk_login; end if;
end $$;
set role test_bk_login;

create function pg_temp.refuses(label text, stmt text, want text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm not like 'connector: %' || want || '%' then
      raise exception 'FAIL: % refused with the wrong message: %', label, sqlerrm;
    end if;
    return;
  end;
  raise exception 'FAIL: % was not refused', label;
end
$$;
create function pg_temp.seen() returns jsonb language sql as $$
  select coalesce(jsonb_object_agg(domain, rev), '{}') from asset_tracker.revisions where tenant_id = 'bk_a'
$$;
create function pg_temp.last_backup() returns asset_tracker.connector_backups language sql as $$
  select * from asset_tracker.connector_backups where tenant_id = 'bk_a' order by id desc limit 1
$$;
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
end
$$;
select set_config('app.tenant_id', 'bk_a', false);

-- 1. A bulk change through connector_apply takes ONE backup, named after the
--    tool, holding every record it touches as it was and as it was left.
begin;
select set_config('connector.tool', 'save_assets', true);
select asset_tracker.connector_apply('ed@bka.test', pg_temp.seen(), '[
  {"op":"asset_update","id":"pc1","data":{"id":"pc1","type":"Computer","tag":"BCA0001","name":"Front desk","serial":"WRONG"}},
  {"op":"asset_update","id":"pc2","data":{"id":"pc2","type":"Computer","tag":"BCA0002","name":"Library","serial":"WRONG"}},
  {"op":"asset_create","id":"new1","data":{"id":"new1","type":"Computer","name":"New one"}},
  {"op":"task_delete","id":"t1","assetId":"pc1"},
  {"op":"config","key":"peripheralsList","value":["Mouse","Dock"]},
  {"op":"config","key":"nextAssetNumber","value":"9"},
  {"op":"audit","data":{"assetLabel":"pc1","action":"edited","field":"Serial","from":"S1","to":"WRONG"}}]');
commit;
do $$
declare b asset_tracker.connector_backups := pg_temp.last_backup();
begin
  perform pg_temp.check(b.tool = 'save_assets' and b."by" = 'Ed Itor (via Claude)', 'backup named after the tool and person');
  perform pg_temp.check(jsonb_array_length(b.scope) = 5, 'scope is pc1, pc2, new1, tasks on pc1, peripheralsList: ' || b.scope::text);
  perform pg_temp.check(not (b.before ? 'config:nextAssetNumber'), 'nextAssetNumber is never backed up');
  perform pg_temp.check(b.before->'asset:pc1'->'data'->>'serial' = 'S1', 'before holds the old serial');
  perform pg_temp.check(b.after->'asset:pc1'->'data'->>'serial' = 'WRONG', 'after holds the new serial');
  perform pg_temp.check(b.before->'asset:new1' = 'null'::jsonb or not (b.before ? 'asset:new1') or b.before->>'asset:new1' is null,
    'a created asset has no before');
  perform pg_temp.check(jsonb_array_length(b.before->'tasks:pc1') = 2 and jsonb_array_length(b.after->'tasks:pc1') = 1, 'task list before and after');
  perform pg_temp.check(b.before->'config:peripheralsList' = '["Mouse"]', 'list before');
end
$$;

-- 2. A refused change leaves no backup behind.
do $$
declare n int := (select count(*) from asset_tracker.connector_backups);
begin
  begin
    perform asset_tracker.connector_apply('ed@bka.test', pg_temp.seen(),
      '[{"op":"asset_update","id":"pc1","data":{"id":"pc1","type":"Computer","tag":"BCA0002"}}]');
  exception when others then null;
  end;
  perform pg_temp.check((select count(*) from asset_tracker.connector_backups) = n, 'a refused write left a backup');
end
$$;

-- 3. The preview says every record still reads as the change left it, and an
--    app save that writes the same record with blank fields filled in does not
--    count as a later change.
begin;
reset role;
update asset_tracker.assets set data = data || '{"notes":"","peripherals":[]}' where id = 'pc2';
set role test_bk_login;
commit;
do $$
declare p jsonb := asset_tracker.connector_backup_preview((pg_temp.last_backup()).id);
begin
  perform pg_temp.check((select bool_and(x->>'status' = 'changed') from jsonb_array_elements(p->'records') x),
    'every record reads as changed: ' || p::text);
end
$$;

-- 4. Someone edits pc1 again in the app: undo refuses, naming it, and changes
--    nothing.
begin;
reset role;
update asset_tracker.assets set data = data || '{"serial":"FIXED BY HAND"}' where id = 'pc1';
set role test_bk_login;
commit;
begin;
select pg_temp.refuses('undo over a later change',
  format($s$ select asset_tracker.connector_restore_backup('ed@bka.test', pg_temp.seen(), %s, false) $s$, (pg_temp.last_backup()).id),
  'changed again after');
commit;
do $$ begin
  perform pg_temp.check((select data->>'serial' from asset_tracker.assets where id = 'pc2') = 'WRONG', 'a refused undo changed something');
end $$;

-- 5. Who may undo, and on what picture.
begin;
select pg_temp.refuses('undo as a viewer',
  format($s$ select asset_tracker.connector_restore_backup('view@bka.test', pg_temp.seen(), %s, true) $s$, (pg_temp.last_backup()).id), 'view-only');
select pg_temp.refuses('undo on a stale revision',
  format($s$ select asset_tracker.connector_restore_backup('ed@bka.test', '{"assets":0}', %s, true) $s$, (pg_temp.last_backup()).id), 'inventory changed');
select pg_temp.refuses('undo a backup that does not exist',
  $s$ select asset_tracker.connector_restore_backup('ed@bka.test', pg_temp.seen(), 999999, true) $s$, 'No backup');
commit;

-- 6. Told to overwrite, undo puts everything back: both serials, the deleted
--    task in its place, the list; the created asset is ARCHIVED, never
--    deleted; one audit row per asset put back; the backup is marked undone;
--    and the undo took a backup of its own.
begin;
select asset_tracker.connector_restore_backup('ed@bka.test', pg_temp.seen(), (pg_temp.last_backup()).id, true);
commit;
do $$
declare first_ asset_tracker.connector_backups;
begin
  select * into first_ from asset_tracker.connector_backups where tool = 'save_assets';
  perform pg_temp.check((select data->>'serial' from asset_tracker.assets where id = 'pc1') = 'S1', 'pc1 serial restored');
  perform pg_temp.check((select data->>'serial' from asset_tracker.assets where id = 'pc2') = 'S2', 'pc2 serial restored');
  perform pg_temp.check((select string_agg(id, ',' order by position) from asset_tracker.maintenance where asset_id = 'pc1') = 't1,t2', 'tasks restored in order');
  perform pg_temp.check((select data->>'status' from asset_tracker.assets where id = 'new1') = 'Archived', 'created asset archived');
  perform pg_temp.check((select value from asset_tracker.config where key = 'peripheralsList') = '["Mouse"]', 'list restored');
  perform pg_temp.check(first_.restored_at is not null and first_.restored_by = 'Ed Itor (via Claude)', 'backup marked undone');
  perform pg_temp.check((select count(*) from asset_tracker.audit_log where action = 'backup_restored') = 2
    and (select count(*) from asset_tracker.audit_log where action = 'archived' and asset_id = 'new1') = 1, 'audit rows');
  perform pg_temp.check((pg_temp.last_backup()).tool = 'undo backup #' || first_.id, 'the undo has its own backup');
end
$$;
begin;
select pg_temp.refuses('undo twice',
  $s$ select asset_tracker.connector_restore_backup('ed@bka.test', pg_temp.seen(), (select id from asset_tracker.connector_backups where tool = 'save_assets'), true) $s$,
  'already undone');
commit;

-- 7. The undo can itself be undone, which brings the change back.
begin;
select asset_tracker.connector_restore_backup('ed@bka.test', pg_temp.seen(), (pg_temp.last_backup()).id, false);
commit;
do $$ begin
  perform pg_temp.check((select data->>'serial' from asset_tracker.assets where id = 'pc2') = 'WRONG', 'undo of the undo');
  perform pg_temp.check((select data->>'status' from asset_tracker.assets where id = 'new1') is distinct from 'Archived', 'created asset back');
end $$;

-- 8. replace_floor_plan backs up the plan fields, links and groups, and undo
--    puts all three back.
begin;
select asset_tracker.connector_replace_floor_plan('ed@bka.test', pg_temp.seen(), 'bld',
  '{"url":"https://res.cloudinary.com/x/new.svg","fileName":"new.svg"}', '[{"shapeId":"h1","roomId":"pc2"}]', '[]');
commit;
do $$ begin
  perform pg_temp.check((pg_temp.last_backup()).tool = 'replace_floor_plan', 'plan backup tool');
end $$;
begin;
select asset_tracker.connector_restore_backup('ed@bka.test', pg_temp.seen(), (pg_temp.last_backup()).id, false);
commit;
do $$ begin
  perform pg_temp.check((select data->>'floorPlanFileName' from asset_tracker.assets where id = 'bld') = 'old.svg', 'plan file restored');
  perform pg_temp.check((select string_agg(shape_id || '>' || (data->>'roomId'), ',') from asset_tracker.space_links where plan_asset_id = 'bld') = 'g1>pc1', 'links restored');
  perform pg_temp.check((select string_agg(id, ',') from asset_tracker.space_groups where plan_asset_id = 'bld') = 'grp', 'groups restored');
end $$;

-- 9. set_plan_walls is ONE backup holding the new wall and the plan's links;
--    undo takes the edges off and archives the wall.
begin;
select asset_tracker.connector_set_plan_walls('ed@bka.test', pg_temp.seen(), 'bld',
  '[{"op":"asset_create","id":"wN","data":{"id":"wN","type":"Wall","name":"North","parentId":"bld"}},
    {"op":"audit","data":{"assetLabel":"bld","assetType":"Building","action":"space_linked"}}]',
  '[{"wallId":"wN","segmentIds":["g1#e0"]}]', '[]');
commit;
do $$
declare b asset_tracker.connector_backups := pg_temp.last_backup();
begin
  perform pg_temp.check(b.tool = 'set_plan_walls' and b.scope @> '[{"kind":"plan","key":"bld"},{"kind":"asset","key":"wN"}]', 'wall backup: ' || b.scope::text);
  perform pg_temp.check((select count(*) from asset_tracker.connector_backups where txid = b.txid) = 1, 'one backup for the walls');
  perform pg_temp.check(jsonb_array_length(b.after->'plan:bld'->'links') = 2, 'after includes the edge');
end
$$;
begin;
select asset_tracker.connector_restore_backup('ed@bka.test', pg_temp.seen(), (pg_temp.last_backup()).id, false);
commit;
do $$ begin
  perform pg_temp.check((select string_agg(shape_id, ',') from asset_tracker.space_links where plan_asset_id = 'bld') = 'g1', 'edge removed');
  perform pg_temp.check((select data->>'status' from asset_tracker.assets where id = 'wN') = 'Archived', 'wall archived');
end $$;
-- A change someone has since put back by hand has nothing left to undo.
create temp table undo_target as select id, data from asset_tracker.assets where id = 'pc1';
begin;
select asset_tracker.connector_apply('ed@bka.test', pg_temp.seen(), jsonb_build_array(jsonb_build_object(
  'op', 'asset_update', 'id', 'pc1', 'data', (select data from undo_target) || '{"serial":"X"}')));
commit;
alter table undo_target add column backup bigint;
update undo_target set backup = (pg_temp.last_backup()).id;
begin;
select asset_tracker.connector_apply('ed@bka.test', pg_temp.seen(), jsonb_build_array(jsonb_build_object(
  'op', 'asset_update', 'id', 'pc1', 'data', (select data from undo_target))));
commit;
begin;
select pg_temp.refuses('nothing left to undo',
  $s$ select asset_tracker.connector_restore_backup('ed@bka.test', pg_temp.seen(), (select backup from undo_target), false) $s$,
  'nothing to undo');
commit;

-- 10. A site sees only its own backups.
do $$
declare id_ bigint := (pg_temp.last_backup()).id;
begin
  perform set_config('app.tenant_id', 'bk_b', true);
  perform pg_temp.check((select count(*) from asset_tracker.connector_backups) = 0, 'tenant B sees A''s backups');
  begin
    perform asset_tracker.connector_backup_preview(id_);
    raise exception 'FAIL: tenant B previewed A''s backup';
  exception when others then
    if sqlerrm not like 'connector: No backup%' then raise; end if;
  end;
  perform set_config('app.tenant_id', 'bk_a', true);
end
$$;

-- 11. The newest 200 are kept.
do $$
declare i int;
begin
  for i in 1..205 loop
    perform asset_tracker.connector_apply('ed@bka.test', pg_temp.seen(),
      format('[{"op":"asset_update","id":"pc2","data":{"id":"pc2","type":"Computer","tag":"BCA0002","name":"Library","serial":"N%s"}}]', i)::jsonb);
    -- Each call is its own backup only in its own transaction; force that here.
    update asset_tracker.connector_backups set txid = -id where txid = txid_current();
  end loop;
  perform pg_temp.check((select count(*) from asset_tracker.connector_backups) = 200, 'kept 200');
end
$$;

-- 12. Two writes in one transaction are one backup, and a record keeps the
--     "before" it was first seen with (set_plan_walls runs connector_apply and
--     then adds the plan; anything later must not overwrite what came first).
begin;
create temp table first_serial as select data->>'serial' as s from asset_tracker.assets where id = 'pc2';
select asset_tracker.connector_apply('ed@bka.test', pg_temp.seen(),
  '[{"op":"asset_update","id":"pc2","data":{"id":"pc2","type":"Computer","tag":"BCA0002","name":"Library","serial":"FIRST"}}]');
select asset_tracker.connector_apply('ed@bka.test', pg_temp.seen(),
  '[{"op":"asset_update","id":"pc2","data":{"id":"pc2","type":"Computer","tag":"BCA0002","name":"Library","serial":"SECOND"}}]');
do $$
declare b asset_tracker.connector_backups := pg_temp.last_backup();
begin
  perform pg_temp.check(b.before->'asset:pc2'->'data'->>'serial' = (select s from first_serial), 'first before kept: ' || (b.before->'asset:pc2')::text);
  perform pg_temp.check(b.after->'asset:pc2'->'data'->>'serial' = 'SECOND', 'last after kept');
  perform pg_temp.check(jsonb_array_length(b.scope) = 1, 'one record, once');
end
$$;
commit;

reset role;
\o
\echo 'connector backups: all checks passed'
