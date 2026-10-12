-- 0005 — the role that connects may become asset_api.
--
-- The Edge Function connects with the project's own database URL and starts
-- every transaction with `set local role asset_api`, so RLS applies to every
-- query it makes (0002). Since Postgres 16, creating a role gives its creator
-- ADMIN on it but not the right to SET ROLE to it, so that is granted here to
-- whichever role runs migrations -- the same one the function connects as.
-- Membership widens nothing: asset_api can do less than its grantee.

grant asset_api to current_user;
