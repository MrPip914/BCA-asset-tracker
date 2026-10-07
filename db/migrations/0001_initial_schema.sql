-- 0001 — Phase 1 schema. See DATABASE_BACKEND_PLAN.md, "Schema: JSONB records".
--
-- Every Sheet tab becomes a table of (tenant_id, key, position, data jsonb), with
-- real columns ONLY for what the server must query or enforce. `data` holds the
-- record in the exact shape doGet returns today; the real columns are copies the
-- API extracts on write, never a second place a client writes to.
--
-- WHY A SCHEMA OF ITS OWN, NOT `public`: Supabase's REST layer (PostgREST) serves
-- `public` to anyone holding the project's anon key, which ships in browsers. RLS
-- would still refuse them, but a table nobody can address is a smaller surface
-- than one that is addressable and refused. Nothing here is meant to be reached
-- except through our own API.
--
-- `tenant_id` is in every key and every foreign key, so a child row cannot point
-- at another tenant's parent. RLS is in 0002.
--
-- Foreign keys are DEFERRABLE INITIALLY DEFERRED because a save is a diff applied
-- inside one transaction: upserts and deletes land in whatever order the diff
-- produces, and only the end state has to be consistent.

create schema if not exists asset_tracker;
set search_path = asset_tracker;

-- ------------------------------------------------------------------ tenants

create table tenants (
  id                text primary key,              -- the clients.js id: 'dev', 'bca', '3c'
  name              text not null,
  owner_email       text not null,                  -- always an editor; replaces OWNER_EMAIL
  cloudinary_folder text,
  created_at        timestamptz not null default now()
);

-- ------------------------------------------------------------------ assets

-- Keyed by `id`, which is already `a.id || a.label` everywhere, so every stored
-- reference (parentId, personIds, child assetLabel, panelLabel, audit rows) is a
-- valid key with no id migration.
--
-- parent_id deliberately has NO foreign key: storage is permissive today (a
-- dangling or looping parent is flagged by the app, not refused by the backend),
-- and a hand-edited sheet imported here must not fail to load over it.
create table assets (
  tenant_id text    not null references tenants (id),
  id        text    not null,
  position  integer not null,
  label     text,                                   -- legacy display text, kept for rollback
  tag       text,
  type      text,
  parent_id text,
  data      jsonb   not null,
  primary key (tenant_id, id)
);
create index assets_parent_idx on assets (tenant_id, parent_id);
create index assets_tag_idx    on assets (tenant_id, lower(tag)) where tag is not null and tag <> '';

-- ------------------------------------------------------------------ per-asset children

-- Comments and allocations carry no id of their own (nothing references them),
-- so their key is their place in the asset's array — which is exactly how the
-- Sheet identified them too.
create table comments (
  tenant_id text    not null,
  asset_id  text    not null,
  position  integer not null,
  data      jsonb   not null,
  primary key (tenant_id, asset_id, position),
  foreign key (tenant_id, asset_id) references assets (tenant_id, id)
    on delete cascade deferrable initially deferred
);

create table allocations (
  tenant_id text    not null,
  asset_id  text    not null,
  position  integer not null,
  data      jsonb   not null,
  primary key (tenant_id, asset_id, position),
  foreign key (tenant_id, asset_id) references assets (tenant_id, id)
    on delete cascade deferrable initially deferred
);

-- Work entries and tasks have ids because something points at them (photos,
-- maintenanceId). A pre-v34 Sheet row has a blank id; the importer mints one in
-- the same pass, it never stores a blank here.
create table changes (
  tenant_id text    not null,
  id        text    not null,
  asset_id  text    not null,
  position  integer not null,
  data      jsonb   not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, asset_id) references assets (tenant_id, id)
    on delete cascade deferrable initially deferred
);
create index changes_asset_idx on changes (tenant_id, asset_id, position);

create table maintenance (
  tenant_id text    not null,
  id        text    not null,
  asset_id  text    not null,
  position  integer not null,
  data      jsonb   not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, asset_id) references assets (tenant_id, id)
    on delete cascade deferrable initially deferred
);
create index maintenance_asset_idx on maintenance (tenant_id, asset_id, position);

-- ------------------------------------------------------------------ panels

create table breakers (
  tenant_id text    not null,
  id        text    not null,
  panel_id  text    not null,                       -- today's panelLabel
  position  integer not null,
  data      jsonb   not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, panel_id) references assets (tenant_id, id)
    on delete cascade deferrable initially deferred
);
create index breakers_panel_idx on breakers (tenant_id, panel_id, position);

-- breaker_id null = the panel's unassigned list (backend v13). Deleting a
-- breaker unassigns its circuits rather than deleting them, which is what the
-- app does on purpose; SET NULL (breaker_id) leaves tenant_id alone.
create table circuits (
  tenant_id  text    not null,
  id         text    not null,
  panel_id   text    not null,
  breaker_id text,
  position   integer not null,
  data       jsonb   not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, panel_id) references assets (tenant_id, id)
    on delete cascade deferrable initially deferred,
  foreign key (tenant_id, breaker_id) references breakers (tenant_id, id)
    on delete set null (breaker_id) deferrable initially deferred
);
create index circuits_panel_idx   on circuits (tenant_id, panel_id, position);
create index circuits_breaker_idx on circuits (tenant_id, breaker_id);

-- Shared catalog, not scoped to a panel. Its own revision domain.
create table breaker_types (
  tenant_id text    not null references tenants (id),
  id        text    not null,
  position  integer not null,
  data      jsonb   not null,
  primary key (tenant_id, id)
);

-- ------------------------------------------------------------------ floor plans

-- A shape has at most one link per plan, structurally — the Sheet enforced that
-- by replacing the row; here it is the key. A wall segment is an ordinary link
-- whose shape id carries a `#e<edge>` suffix, so the same rule covers walls.
create table space_links (
  tenant_id     text    not null,
  plan_asset_id text    not null,                   -- today's assetLabel
  shape_id      text    not null,
  position      integer not null,
  data          jsonb   not null,
  primary key (tenant_id, plan_asset_id, shape_id),
  foreign key (tenant_id, plan_asset_id) references assets (tenant_id, id)
    on delete cascade deferrable initially deferred
);

create table space_groups (
  tenant_id     text    not null,
  id            text    not null,
  plan_asset_id text    not null,
  position      integer not null,
  data          jsonb   not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, plan_asset_id) references assets (tenant_id, id)
    on delete cascade deferrable initially deferred
);

-- ------------------------------------------------------------------ photos

-- The owner is polymorphic (asset, change, maintenance, breaker, circuit), so
-- there is no foreign key. A row whose owner is gone is a normal state today.
-- `kind` and `hidden_from_public` are real columns because the anonymous
-- ?panel= page filters on them, and that filter is the security boundary.
create table photos (
  tenant_id          text    not null references tenants (id),
  id                 text    not null,
  owner_type         text,
  owner_id           text,
  kind               text    not null default 'image',   -- blank reads as image (pre-v39)
  hidden_from_public boolean not null default false,
  position           integer not null,
  data               jsonb   not null,
  primary key (tenant_id, id)
);
create index photos_owner_idx on photos (tenant_id, owner_type, owner_id);

-- ------------------------------------------------------------------ audit log

-- Append-only, and that is made a database fact in 0002 (no UPDATE/DELETE grant).
-- asset_id has no foreign key: audit entries outlive the assets they describe.
-- seq is append order, which IS chronological order — the fact auditIndex and
-- the master Audit tab's default sort both rely on.
create table audit_log (
  tenant_id text        not null references tenants (id),
  seq       bigint      generated always as identity,
  asset_id  text,
  at        text,                                   -- as stored today; may not parse
  by        text,
  action    text,
  data      jsonb       not null,
  primary key (tenant_id, seq)
);
create index audit_log_asset_idx on audit_log (tenant_id, asset_id);

-- ------------------------------------------------------------------ config & revisions

-- Managed lists, columns, typeSettings, nextAssetNumber… Keys the client does
-- not send are preserved by the API, never dropped (the v37 lesson). The tab
-- hashes and rev_* keys do NOT come across: revisions have their own table and
-- a diff-on-write needs no hashes.
create table config (
  tenant_id text  not null references tenants (id),
  key       text  not null,
  value     jsonb not null,
  primary key (tenant_id, key)
);

-- The FOR UPDATE on these rows is the lock that replaces LockService.
create table revisions (
  tenant_id text    not null references tenants (id),
  domain    text    not null check (domain in ('assets', 'config', 'breakerTypes', 'photos')),
  rev       integer not null default 0,
  primary key (tenant_id, domain)
);

-- ------------------------------------------------------------------ auth

-- Replaces the `authUsers` Config blob. Owner email is on `tenants` and is an
-- editor whatever this table says, so lockout stays impossible.
create table auth_users (
  tenant_id text not null references tenants (id),
  email     text not null check (email = lower(email)),
  role      text not null check (role in ('editor', 'viewer')),
  primary key (tenant_id, email)
);

-- An opaque server-minted id, 7-day sliding. Never logged. A request naming a
-- different tenant than the session's is refused by the API.
create table sessions (
  id         text        primary key,
  tenant_id  text        not null references tenants (id),
  email      text        not null,
  expires_at timestamptz not null,
  touched_at timestamptz not null default now()
);
create index sessions_tenant_email_idx on sessions (tenant_id, email);
create index sessions_expires_idx      on sessions (expires_at);

-- ------------------------------------------------------------------ diagnostics

-- DIAG_FIELDS as columns: this table is read by people, filtered by time, and
-- trimmed to the newest 1000 per tenant. Never holds a session id.
create table diagnostics (
  tenant_id      text   not null references tenants (id),
  seq            bigint generated always as identity,
  at             timestamptz not null default now(),
  event          text,
  op             text,
  email          text,
  reason         text,
  detail         text,
  ms             integer,
  script_version text,
  primary key (tenant_id, seq)
);
