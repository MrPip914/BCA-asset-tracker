-- Checks the Claude connector's write functions (0006) against a THROWAWAY
-- database after db/migrate.sh. CI runs it on every change under db/; never
-- point it at dev.
--
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f db/test-connector-writes.sql
--
-- Runs as a stand-in for the connector's role, so row-level security applies
-- exactly as it does in production. Each check raises on failure.

\set QUIET on
\o /dev/null
set search_path = asset_tracker;

insert into tenants (id, name, owner_email) values
  ('cw_a', 'Writes A', 'owner@cwa.test'),
  ('cw_b', 'Writes B', 'owner@cwb.test');
insert into auth_users (tenant_id, email, role, name) values
  ('cw_a', 'ed@cwa.test', 'editor', 'Ed Itor'),
  ('cw_a', 'view@cwa.test', 'viewer', 'Vi Ewer');
insert into assets (tenant_id, id, position, type, data) values
  ('cw_a', 'room1', 0, 'Room', '{"name":"Room 1"}'),
  ('cw_a', 'ms1', 1, 'Mini Split', '{"name":"MS 1"}'),
  ('cw_a', 'old1', 2, 'Computer', '{"name":"Old","status":"Archived"}'),
  ('cw_b', 'secret', 0, 'Room', '{"name":"B room"}');
insert into maintenance (tenant_id, id, asset_id, position, data) values
  ('cw_a', 'm1', 'ms1', 0, '{"id":"m1","task":"Filter clean","frequencyLabel":"Monthly","frequencyDays":30,"lastPerformed":"2026-09-01"}'),
  ('cw_a', 'm2', 'room1', 0, '{"id":"m2","kind":"oneoff","task":"Repaint","lastPerformed":"2026-08-01"}'),
  ('cw_b', 'mb', 'secret', 0, '{"id":"mb","task":"B task"}');
insert into revisions (tenant_id, domain, rev) values ('cw_a', 'assets', 7);

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'test_cw_login') then create role test_cw_login nologin; grant asset_api to test_cw_login; end if;
end $$;
set role test_cw_login;

-- A helper that expects a "connector: " refusal, naming the case on failure.
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

begin;
select set_config('app.tenant_id', 'cw_a', true);

-- 1. Who may write: a viewer, a stranger and a blank email are refused; the
--    owner and an editor are not.
select pg_temp.refuses('a viewer',
  $s$ select asset_tracker.connector_add_comment('view@cwa.test', 'room1', 'hi') $s$, 'view-only');
select pg_temp.refuses('a stranger',
  $s$ select asset_tracker.connector_add_comment('nobody@x.test', 'room1', 'hi') $s$, 'view-only');
select pg_temp.refuses('a blank email',
  $s$ select asset_tracker.connector_add_comment('', 'room1', 'hi') $s$, 'view-only');
do $$
begin
  if asset_tracker.connector_actor('OWNER@cwa.test') <> 'owner@cwa.test (via Claude)' then
    raise exception 'FAIL: owner not an editor, or not stamped by email';
  end if;
  if asset_tracker.connector_actor('ed@cwa.test') <> 'Ed Itor (via Claude)' then
    raise exception 'FAIL: editor not stamped by their name';
  end if;
end
$$;

-- 2. What may be written to: another tenant's asset and an archived one are refused.
select pg_temp.refuses('another tenant''s asset',
  $s$ select asset_tracker.connector_add_comment('ed@cwa.test', 'secret', 'hi') $s$, 'No such asset');
select pg_temp.refuses('another tenant''s task',
  $s$ select asset_tracker.connector_complete_task('ed@cwa.test', 'mb', '2026-10-01', '{}') $s$, 'No such task');
select pg_temp.refuses('an archived asset',
  $s$ select asset_tracker.connector_add_comment('ed@cwa.test', 'old1', 'hi') $s$, 'archived');

-- 3. A task is added at the end of its asset's list, stamped, and moves the revision.
do $$
declare r jsonb; d jsonb;
begin
  r := asset_tracker.connector_add_task('ed@cwa.test', 'ms1',
    '{"kind":"scheduled","task":"Coil clean","frequencyLabel":"Annually","frequencyDays":365,"id":"spoofed","by":"spoofed"}');
  select data into d from asset_tracker.maintenance where id = r->>'id';
  if d is null or (select position from asset_tracker.maintenance where id = r->>'id') <> 1 then
    raise exception 'FAIL: task not appended: %', r;
  end if;
  if d->>'id' = 'spoofed' or d->>'by' <> 'Ed Itor (via Claude)' or d->>'at' !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$' then
    raise exception 'FAIL: task stamps wrong: %', d;
  end if;
  if (r->>'revision')::int <> 8 or (select rev from asset_tracker.revisions where domain = 'assets') <> 8 then
    raise exception 'FAIL: revision not bumped to 8: %', r;
  end if;
end
$$;

-- 4. A completion stamps the task, writes a linked work entry with the same
--    date, and the audit row the app writes.
do $$
declare r jsonb; c jsonb; a record;
begin
  r := asset_tracker.connector_complete_task('ed@cwa.test', 'm1', '2026-10-05',
    '{"changeType":"Maintenance","vendor":"","cost":"120","note":"ok"}');
  if (select data->>'lastPerformed' from asset_tracker.maintenance where id = 'm1') <> '2026-10-05' then
    raise exception 'FAIL: lastPerformed not stamped';
  end if;
  select data into c from asset_tracker.changes where id = r->>'id';
  if c->>'performedOn' <> '2026-10-05' or c->>'maintenanceId' <> 'm1' or c->>'changeType' <> 'Maintenance' then
    raise exception 'FAIL: completion work entry wrong: %', c;
  end if;
  select * into a from asset_tracker.audit_log order by seq desc limit 1;
  if a.action <> 'maintenance_completed' or a.asset_id <> 'ms1'
     or a.data->>'from' <> 'Sep 1, 2026' or a.data->>'to' <> 'Oct 5, 2026'
     or a.data->>'field' <> 'Filter clean' or a.data->>'assetType' <> 'Mini Split'
     or a.data->>'assetLabel' <> 'ms1' or a."by" <> 'Ed Itor (via Claude)' then
    raise exception 'FAIL: completion audit row wrong: % %', a.action, a.data;
  end if;
end
$$;

-- 5. A finished one-off cannot be completed again, and a bad date is refused.
select pg_temp.refuses('a finished one-off',
  $s$ select asset_tracker.connector_complete_task('ed@cwa.test', 'm2', '2026-10-05', '{}') $s$, 'already done (Aug 1, 2026)');
select pg_temp.refuses('a bad date',
  $s$ select asset_tracker.connector_complete_task('ed@cwa.test', 'm1', '10/05/2026', '{}') $s$, 'yyyy-mm-dd');
select pg_temp.refuses('an impossible date',
  $s$ select asset_tracker.connector_log_work('ed@cwa.test', 'ms1', '{"performedOn":"2026-02-30"}') $s$, 'not a real date');

-- 6. Log work: linked only to a task on the same asset, and linking does not complete it.
select pg_temp.refuses('a task on another asset',
  $s$ select asset_tracker.connector_log_work('ed@cwa.test', 'room1', '{"performedOn":"2026-10-01","maintenanceId":"m1"}') $s$, 'not on this asset');
do $$
declare r jsonb;
begin
  r := asset_tracker.connector_log_work('ed@cwa.test', 'ms1',
    '{"changeType":"Repair","performedOn":"2026-10-02","maintenanceId":"m1"}');
  if (select data->>'lastPerformed' from asset_tracker.maintenance where id = 'm1') <> '2026-10-05' then
    raise exception 'FAIL: linking work moved the task';
  end if;
  if (select position from asset_tracker.changes where id = r->>'id') <> 1 then
    raise exception 'FAIL: work entry not appended after the completion';
  end if;
end
$$;

-- 7. Comments append, trimmed and stamped.
do $$
begin
  perform asset_tracker.connector_add_comment('ed@cwa.test', 'room1', '  first  ');
  perform asset_tracker.connector_add_comment('ed@cwa.test', 'room1', 'second');
  if (select string_agg(data->>'text', ',' order by position) from asset_tracker.comments where asset_id = 'room1') <> 'first,second' then
    raise exception 'FAIL: comments not appended in order';
  end if;
end
$$;
commit;

-- 8. A refused write leaves nothing behind, not even the revision bump.
begin;
select set_config('app.tenant_id', 'cw_a', true);
do $$
declare before int := (select rev from asset_tracker.revisions where domain = 'assets');
begin
  begin
    perform asset_tracker.connector_add_task('ed@cwa.test', 'ms1', '{"task":"  "}');
  exception when others then null;
  end;
  if (select rev from asset_tracker.revisions where domain = 'assets') <> before then
    raise exception 'FAIL: a refused write still moved the revision';
  end if;
end
$$;
commit;

-- 9. Tenant B's revision never moved.
reset role;
do $$
begin
  if exists (select 1 from asset_tracker.revisions where tenant_id = 'cw_b') then
    raise exception 'FAIL: a write reached tenant B''s revisions';
  end if;
  if (select count(*) from asset_tracker.comments where tenant_id = 'cw_b') <> 0 then
    raise exception 'FAIL: a write reached tenant B';
  end if;
end
$$;

\o
\echo 'connector writes: all checks passed'
