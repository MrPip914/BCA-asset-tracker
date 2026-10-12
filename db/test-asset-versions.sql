-- Checks the per-asset version triggers (0007) against a THROWAWAY database
-- after db/migrate.sh. CI runs it on every change under db/; never point it at
-- dev.
--
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f db/test-asset-versions.sql
--
-- Runs as the API's role, so row-level security applies as in production.
-- Each check raises on failure.

\set QUIET on
\o /dev/null
set search_path = asset_tracker;

insert into tenants (id, name, owner_email) values ('av_a', 'Versions A', 'owner@ava.test'), ('av_b', 'Versions B', 'owner@avb.test');
insert into assets (tenant_id, id, position, type, data) values
  ('av_a', 'x', 0, 'Room', '{"name":"X"}'),
  ('av_a', 'y', 1, 'Room', '{"name":"Y"}'),
  ('av_a', 'p', 2, 'Electrical Panel', '{}'),
  ('av_b', 'x', 0, 'Room', '{"name":"B X"}');

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'test_av_login') then create role test_av_login nologin; grant asset_api to test_av_login; end if;
end $$;
set role test_av_login;
select set_config('app.tenant_id', 'av_a', false);

create function pg_temp.rev_is(label text, asset text, want bigint) returns void language plpgsql as $$
declare got bigint;
begin
  select rev into got from asset_tracker.assets where id = asset;
  if got is distinct from want then raise exception 'FAIL %: rev of % is %, wanted %', label, asset, got, want; end if;
end $$;

select pg_temp.rev_is('a new asset starts at 0', 'x', 0);

update assets set data = '{"name":"X2"}' where id = 'x';
select pg_temp.rev_is('a content change bumps', 'x', 1);

update assets set data = '{"name":"X2"}' where id = 'x';
select pg_temp.rev_is('writing the same content does not', 'x', 1);

update assets set position = 9 where id = 'x';
select pg_temp.rev_is('a position change does not', 'x', 1);

insert into comments (tenant_id, asset_id, position, data) values ('av_a', 'x', 0, '{"text":"hi"}'), ('av_a', 'x', 1, '{"text":"two"}');
select pg_temp.rev_is('adding children bumps the owner once per statement', 'x', 2);
select pg_temp.rev_is('and leaves other assets alone', 'y', 0);

update comments set data = '{"text":"edited"}' where asset_id = 'x' and position = 0;
select pg_temp.rev_is('editing a child bumps', 'x', 3);

delete from comments where asset_id = 'x' and position = 1;
select pg_temp.rev_is('removing a child bumps', 'x', 4);

insert into maintenance (tenant_id, id, asset_id, position, data) values ('av_a', 'm1', 'y', 0, '{"task":"t"}');
update maintenance set asset_id = 'x' where id = 'm1';
select pg_temp.rev_is('a child moved away bumps the old owner', 'y', 2);
select pg_temp.rev_is('and the new one', 'x', 5);

insert into breakers (tenant_id, id, panel_id, position, data) values ('av_a', 'b1', 'p', 0, '{}');
insert into circuits (tenant_id, id, panel_id, breaker_id, position, data) values ('av_a', 'c1', 'p', 'b1', 0, '{}');
select pg_temp.rev_is('a panel''s breakers and circuits bump the panel', 'p', 2);

insert into space_links (tenant_id, plan_asset_id, shape_id, position, data) values ('av_a', 'p', 's1', 0, '{}');
select pg_temp.rev_is('a floor-plan link bumps its plan', 'p', 3);

-- Another tenant's row with the same id is never touched.
reset role;
do $$ begin
  if (select rev from asset_tracker.assets where tenant_id = 'av_b' and id = 'x') <> 0 then
    raise exception 'FAIL: another tenant''s asset was bumped';
  end if;
end $$;

-- Deleting an asset cascades its children without error.
delete from assets where tenant_id = 'av_a' and id = 'x';

delete from assets where tenant_id in ('av_a', 'av_b');
delete from tenants where id in ('av_a', 'av_b');
\o
\echo '✓ asset versions'
