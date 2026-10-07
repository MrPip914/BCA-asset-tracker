-- Checks the properties of the schema that fail SILENTLY if they regress.
-- Run against a THROWAWAY database after db/migrate.sh — it creates tenants
-- and roles. CI does this on every change under db/; never point it at dev.
--
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f db/test-schema.sql
--
-- Each check raises on failure, so ON_ERROR_STOP turns any one of them into a
-- failed run.

\set QUIET on
\o /dev/null
set search_path = asset_tracker;

insert into tenants (id, name, owner_email) values
  ('school_a', 'School A', 'owner@a.test'),
  ('school_b', 'School B', 'owner@b.test');

-- A stand-in for the API's login role. Its membership in asset_api is the whole
-- of what it is allowed; it owns nothing, so RLS applies to it.
create role test_api_login nologin;
grant asset_api to test_api_login;

-- ------------------------------------------------------------- as the API role
set role test_api_login;

-- 1. No tenant set => nothing visible, nothing writable.
do $$
begin
  if (select count(*) from asset_tracker.tenants) <> 0 then
    raise exception 'FAIL: tenants visible with no app.tenant_id set';
  end if;
  begin
    insert into asset_tracker.assets (tenant_id, id, position, data)
      values ('school_a', 'X', 0, '{}');
    raise exception 'FAIL: insert succeeded with no app.tenant_id set';
  exception when insufficient_privilege then null;  -- RLS WITH CHECK refusal
  end;
end
$$;

-- 2. School A writes its own rows.
begin;
select set_config('app.tenant_id', 'school_a', true);
insert into assets (tenant_id, id, position, type, data) values
  ('school_a', 'BCA0001', 0, 'Room',     '{"label":"BCA0001"}'),
  ('school_a', 'BCA0002', 1, 'Computer', '{"label":"BCA0002"}');
insert into maintenance (tenant_id, id, asset_id, position, data)
  values ('school_a', 'm1', 'BCA0002', 0, '{}');
insert into audit_log (tenant_id, asset_id, action, data)
  values ('school_a', 'BCA0002', 'created', '{}');
insert into revisions (tenant_id, domain, rev) values ('school_a', 'assets', 1);
commit;

-- 3. School B sees none of it, and cannot write into A.
begin;
select set_config('app.tenant_id', 'school_b', true);
do $$
begin
  if (select count(*) from asset_tracker.assets) <> 0
     or (select count(*) from asset_tracker.audit_log) <> 0
     or (select count(*) from asset_tracker.revisions) <> 0 then
    raise exception 'FAIL: school_b can read school_a rows';
  end if;
  if (select count(*) from asset_tracker.tenants) <> 1 then
    raise exception 'FAIL: school_b sees a tenant row other than its own';
  end if;
  begin
    insert into asset_tracker.assets (tenant_id, id, position, data)
      values ('school_a', 'EVIL', 0, '{}');
    raise exception 'FAIL: school_b inserted a row for school_a';
  exception when insufficient_privilege then null;
  end;
  update asset_tracker.assets set data = '{"x":1}' where tenant_id = 'school_a';
  delete from asset_tracker.assets where tenant_id = 'school_a';
end
$$;
commit;

-- 4. The audit log is append-only for the API: UPDATE and DELETE are refused
--    outright, not merely filtered to zero rows.
begin;
select set_config('app.tenant_id', 'school_a', true);
do $$
begin
  if (select count(*) from asset_tracker.assets where data = '{"x":1}') <> 0
     or (select count(*) from asset_tracker.assets) <> 2 then
    raise exception 'FAIL: school_b changed or deleted school_a rows';
  end if;
  begin
    update asset_tracker.audit_log set action = 'rewritten';
    raise exception 'FAIL: audit_log UPDATE allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from asset_tracker.audit_log;
    raise exception 'FAIL: audit_log DELETE allowed';
  exception when insufficient_privilege then null;
  end;
end
$$;
commit;

-- 5. Deleting a breaker unassigns its circuits; deleting an asset takes its
--    children with it (the Sheet's rewrite-the-tab behaviour); both settle at
--    COMMIT because the foreign keys are deferred, so a diff may write in any
--    order.
begin;
select set_config('app.tenant_id', 'school_a', true);
-- Child before parent: legal only because the FK is deferred.
insert into breakers (tenant_id, id, panel_id, position, data)
  values ('school_a', 'b1', 'PANEL', 0, '{}');
insert into circuits (tenant_id, id, panel_id, breaker_id, position, data)
  values ('school_a', 'c1', 'PANEL', 'b1', 0, '{}');
insert into assets (tenant_id, id, position, type, data)
  values ('school_a', 'PANEL', 2, 'Electrical Panel', '{}');
commit;

begin;
select set_config('app.tenant_id', 'school_a', true);
delete from breakers where id = 'b1';
commit;

begin;
select set_config('app.tenant_id', 'school_a', true);
do $$
begin
  if (select breaker_id from asset_tracker.circuits where id = 'c1') is not null then
    raise exception 'FAIL: deleting a breaker did not unassign its circuit';
  end if;
  if (select tenant_id from asset_tracker.circuits where id = 'c1') <> 'school_a' then
    raise exception 'FAIL: SET NULL cleared tenant_id along with breaker_id';
  end if;
end
$$;
delete from assets where id = 'BCA0002';
commit;

begin;
select set_config('app.tenant_id', 'school_a', true);
do $$
begin
  if exists (select 1 from asset_tracker.maintenance where id = 'm1') then
    raise exception 'FAIL: deleting an asset left its maintenance rows behind';
  end if;
  if (select count(*) from asset_tracker.audit_log where asset_id = 'BCA0002') <> 1 then
    raise exception 'FAIL: deleting an asset touched its audit history';
  end if;
end
$$;
commit;

-- 6. A child cannot point at another tenant's parent (composite foreign key).
reset role;
do $$
begin
  begin
    insert into asset_tracker.comments (tenant_id, asset_id, position, data)
      values ('school_b', 'BCA0001', 0, '{}');
    set constraints all immediate;
    raise exception 'FAIL: school_b comment attached to school_a asset';
  exception when foreign_key_violation then null;
  end;
end
$$;

\echo '✓ schema checks passed'
