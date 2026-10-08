-- 0004 — the allowlist keeps its order.
--
-- The Access screen lists people in the order the Config blob held them, and
-- the API's read hands the list back in that order. 0001 gave every other
-- ordered table a `position`; this one was missed. A re-import fills it.

alter table asset_tracker.auth_users add column position integer not null default 0;
