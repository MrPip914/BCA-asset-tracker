-- 0002 — the API's role, its grants, and row-level security.
-- See DATABASE_BACKEND_PLAN.md, "Row-level security".
--
-- The API must NOT connect as the service role or as the table owner: both
-- bypass RLS. It connects as a login role that is a member of `asset_api`, and
-- starts every transaction with
--
--     select set_config('app.tenant_id', $tenant, true);   -- i.e. SET LOCAL
--
-- Every policy compares tenant_id to that setting. Unset, it reads as NULL and
-- matches nothing — so a query that forgets its tenant returns no rows rather
-- than another school's.
--
-- `asset_api` is NOLOGIN on purpose. The login role that carries a password is
-- created out of band (Supabase SQL editor, or a later migration reading a
-- secret), because a password in a migration file would be in a public repo.

set search_path = asset_tracker;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'asset_api') then
    create role asset_api nologin;
  end if;
end
$$;

grant usage on schema asset_tracker to asset_api;

-- The setting, read once in one place so every policy says the same thing.
create function current_tenant() returns text
  language sql stable
  as $$ select nullif(current_setting('app.tenant_id', true), '') $$;
grant execute on function current_tenant() to asset_api;

-- ------------------------------------------------------------------ grants

-- Tables the save diff rewrites: full DML.
grant select, insert, update, delete on
  assets, comments, allocations, changes, maintenance,
  breakers, circuits, breaker_types, space_links, space_groups,
  photos, config, sessions
  to asset_api;

-- Counters are created per tenant and only ever moved, never removed.
grant select, insert, update on revisions to asset_api;

-- Append-only, as a database fact rather than a convention: no UPDATE, no
-- DELETE. This is the one table with no rewrite path today, and now it cannot
-- grow one by accident.
grant select, insert on audit_log to asset_api;

-- Trimmed to the newest 1000 rows, so DELETE but never UPDATE.
grant select, insert, delete on diagnostics to asset_api;

-- The allowlist is edited through the app's Access screen.
grant select, insert, update, delete on auth_users to asset_api;

-- A tenant is created by the owner, not by the API.
grant select on tenants to asset_api;

-- ------------------------------------------------------------------ RLS

do $$
declare
  t text;
begin
  foreach t in array array[
    'assets', 'comments', 'allocations', 'changes', 'maintenance',
    'breakers', 'circuits', 'breaker_types', 'space_links', 'space_groups',
    'photos', 'audit_log', 'config', 'revisions', 'auth_users', 'sessions',
    'diagnostics'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy tenant_isolation on %I to asset_api '
      'using (tenant_id = current_tenant()) '
      'with check (tenant_id = current_tenant())', t);
  end loop;
end
$$;

alter table tenants enable row level security;
create policy tenant_isolation on tenants to asset_api
  using (id = current_tenant());
