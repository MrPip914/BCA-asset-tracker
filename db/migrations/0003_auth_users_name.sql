-- 0003 — the allowlist keeps each person's display name.
--
-- authUsers in Config stores { email, name, role }, and the Access screen shows
-- the name. 0001 left it out; the importer would otherwise drop it.

alter table asset_tracker.auth_users add column name text not null default '';
