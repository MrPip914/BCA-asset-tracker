# Moving the backend from Apps Script + Sheets to Postgres — Phase 1 design

Status: **Rollout step 1 (schema, `db/migrations/`) applied to dev 2026-10-07; step 2 (importer, `db/import-from-sheet.mjs`) run against dev 2026-10-08; step 3 (API, `supabase/functions/asset-api/`) started 2026-10-08 with `signin`, `read` and `signout`; the save, `auditFull`, upload signing and `diagnostics` were added 2026-10-09.** Written 2026-10-06 after saves against the Google
backend proved unreliable (see "Google's layer in front of Apps Script fails
intermittently" in CLAUDE.md, and the v42/v49/v50 diagnostics work).

## Goal and non-goal

**Goal:** replace `AssetTrackerSync.gs` with a service on a real database that answers the
SAME requests the frontend already sends, so `index.html` changes by a URL and a small
transport shim, not by a rewrite.

**Non-goal (Phase 2, deferred):** per-record writes. Every save still posts the whole
snapshot in Phase 1. That is a known wart and is kept on purpose — see "Why the snapshot
contract survives".

## What is being replaced (the contract)

Everything goes through `doPost` (plus a bare `doGet` for the version check and the
anonymous `?panel=` QR page). Ops, from `AssetTrackerSync.gs`:

| Op | What it does | Notes |
|---|---|---|
| `signin` | Google ID token -> allowlist check -> mint 7-day sliding session -> return inventory | token used once, never stored |
| `read` | session -> whole inventory + revisions + auth block | audit log capped to newest 2000 + `auditTotal` |
| *(no op)* = save | session, editor role, full snapshot + `_dirty` + `_revisions` -> write | the hard one |
| `auditFull` | whole audit log | |
| `signout` | delete session | unconditional ok |
| `diagnostics` | backend log, editors only | |
| `photoSign` / `floorPlanSign` | Cloudinary upload signatures | secrets move out of Script Properties |
| `GET ?panel=` | anonymous public panel page data (whitelisted fields, scoped photos) | |
| `GET` bare | `{ scriptVersion }` and authFailed | deploy tool and "Backend outdated" banner depend on it |

Behaviours that MUST carry over, because each exists due to an incident:

- **Per-domain revision counters** (`assets`, `config`, `breakerTypes`, `photos`): posted
  revision != stored revision => write nothing, return `{ ok:false, conflict:[...], revisions }`.
- **`_dirty` gating**: only write domains the client says changed. Absent `_dirty` = write
  everything; `op:"read"` carries all-false `_dirty` as its guard against an old backend.
- **Mass-deletion guard**: refuse an empty asset list over a populated table unless
  `confirmEmptyAssets`.
- **Audit append by offset** (`auditBase`), never rewrite. Compare against what the DB holds.
- **Allowlist re-read on every request**; `OWNER_EMAIL` is always an editor; `authUsers`
  survives saves that do not carry it.
- **Failure answers are JSON, never an HTML page**: lock/contention => `{ ok:false, busy:true }`.
- **Config keys the client does not send are preserved**, not dropped (the v37 lesson).
- **Sessions never appear in logs**; diagnostics rows hold emails but no session ids.

## Recommended stack

**Supabase** (managed Postgres + Auth + Edge Functions), one project for all tenants.

- *Postgres*: real transactions replace `LockService`; the revision check becomes a
  row-level `UPDATE ... WHERE rev = $posted` inside the same transaction as the writes.
- *Edge Functions* (Deno/TypeScript): host the API. They sit behind Supabase's gateway, not
  Google's, and a cold start is tens of ms, not seconds.
- *Auth*: Google sign-in is built in, but **don't adopt it in Phase 1** — see Auth below.
- Alternative considered: Cloudflare Workers + D1/Hyperdrive. Equally capable and cheaper at
  scale; rejected only because Supabase gives backups, a SQL console and point-in-time
  recovery with no extra assembly, which is exactly what Sheets' version history was doing
  for this project. Revisit if cost matters more than convenience.

## Schema: JSONB records, not 60 mirrored columns

Mirroring `ASSET_FIELDS` as columns re-creates today's most fragile property (the field list
IS the schema; dropping a name drops data) and cannot hold per-tenant **custom columns**,
which are real fields on every asset. So each Sheet tab becomes a table of:

    (tenant_id, id/key, owner key where one exists, position int, data jsonb)

with real columns only for what the SERVER must query or enforce.

| Table | Key | Real columns beyond `data` |
|---|---|---|
| `assets` | `(tenant_id, id)` | `position`, `label` (legacy), `tag`, `type`, `parent_id` |
| `comments`, `changes`, `allocations`, `maintenance` | `(tenant_id, id)` | `asset_id`, `position` |
| `breakers` | `(tenant_id, id)` | `panel_id`, `position` |
| `circuits` | `(tenant_id, id)` | `panel_id`, `breaker_id` (null = unassigned), `position` |
| `breaker_types`, `space_links`, `space_groups` | as today | `position` |
| `photos` | `(tenant_id, id)` | `owner_type`, `owner_id`, `kind`, `hidden_from_public` |
| `audit_log` | `(tenant_id, seq bigserial)` | `asset_id`, `at`, `by`, `action` — **append-only; no UPDATE/DELETE grant** |
| `config` | `(tenant_id, key)` | `value jsonb` — managed lists, columns, typeSettings, nextAssetNumber… |
| `revisions` | `(tenant_id, domain)` | `rev int` |
| `auth_users` | `(tenant_id, email)` | `role` — replaces the `authUsers` Config blob |
| `sessions` | `(id)` | `tenant_id, email, expires_at, touched_at` |
| `diagnostics` | `(tenant_id, seq)` | the existing `DIAG_FIELDS`, capped at 1000 by trim |
| `tenants` | `id` | name, `owner_email`, Cloudinary folder |

Notes:
- `position` preserves array order, which `writeTable_` preserves today and the UI relies on.
- Child tables keyed by `asset_id` fix the "two assets share a label" hazard structurally.
- Assets stay keyed by `id` (already `a.id || a.label`), so every stored reference remains valid
  with **no id migration** — the same trick the asset-key refactor used.
- `audit_log` having no UPDATE/DELETE grant makes "append-only" a database fact, not a
  convention. That is the one table with no rewrite path today.
- Row-level security: every table carries `tenant_id`, and RLS is the real separation, not a
  decoration. **The API must NOT connect as the service role** (it bypasses RLS). It connects as
  a restricted role and runs `SET LOCAL app.tenant_id = ...` at the start of each transaction;
  policies compare `tenant_id` to it, so a query that forgets its filter returns nothing
  instead of another school's rows.
- `tenant_id` is part of every key and foreign key (composite), so a child row cannot point at
  another tenant's parent.
- A session stores its tenant and is refused when a request names a different one.

## Why the snapshot contract survives Phase 1

A save posts `assets` (with nested comments/changes/allocations/maintenance/breakers/circuits)
plus managed-list config. The API **diffs it against the stored rows inside one transaction**
and writes only what differs (upsert changed, delete missing, rewrite `position`). That is
strictly better than `writeTableIfChanged_`'s hash-the-whole-tab, needs no client change, and
keeps `persist()`'s ~85 call sites untouched. The cost is that each save still ships the whole
inventory over the wire (~hundreds of KB); acceptable now, and the thing Phase 2 removes.

Transaction shape for a save:

1. `BEGIN`; `SELECT rev FROM revisions WHERE tenant_id=$1 AND domain = ANY($dirty) FOR UPDATE`.
2. Any posted != stored => `ROLLBACK`, answer conflict (nothing written, not even audit rows).
3. Authorize (session -> role) — inside, so a removal takes effect on the next save.
4. Mass-deletion guard.
5. Diff-and-write dirty domains; append audit rows from `auditBase`.
6. Bump only the domains written; `COMMIT`; return new revisions.

`FOR UPDATE` on the revision rows is the lock. Contention becomes a short row-lock wait rather
than a 10-second script lock; on timeout answer `{ ok:false, busy:true }` exactly as v42 does.

## Auth: keep the existing model in Phase 1

Keep: Google ID token verified once at `signin` (Google's `tokeninfo`, or `jose` against
Google's JWKS — no network call, faster), then an opaque server-minted session id, 7-day
sliding, in the `sessions` table. The allowlist moves from a Config blob to `auth_users`.

Why not Supabase Auth now: the frontend, the session id in `localStorage`, the cached-snapshot
keying (tenant + session id) and the sign-out semantics all assume this exact model. Swapping
the identity provider is a separate change with its own failure modes. Do it later if per-user
RLS is ever wanted.

## Tenancy

One database, `tenant_id` on every row, tenant chosen by the request (the frontend already
sends `?client=` -> `clients.js` entry; the entry gains an `apiUrl` and a tenant id, replacing
the `/exec` URL). A tenant is **a row in `tenants` plus an allowlist**, not a Sheet + script +
deploy. `deploy.mjs`, `new-tenant.mjs`, `set-tenant.mjs` and the Cloud Shell walkthrough stop
being part of the release path. Backend deploys become one `supabase functions deploy`, and a
backend change no longer has to be repeated per tenant — which removes the whole
"deploy dev, then school, then merge" ordering hazard for backend changes (schema migrations
still need care; see Rollout).

Isolation trade: this is logical, not structural like one-Sheet-per-school. Mitigated by the
restricted-role RLS above, plus a cross-tenant test (sign in as school A, try to read and write
school B's rows through every op) and a per-tenant export so one school can be pulled or
restored alone. **Decided 2026-10-06: no client has a physical-separation requirement, so one
shared database.** If one ever does, a separate Supabase project per tenant runs the identical
code.

## Things that move or change

- **Cloudinary secrets**: Script Properties -> Edge Function secrets (shared, since all tenants
  already share one Cloudinary account; folder per tenant from `tenants`). The signing code
  (`sha1Hex_`, sorted params, server-chosen object name, signed `allowed_formats`) ports
  line for line; keep its tests.
- **Public `?panel=`**: stays an anonymous GET on the new API with the same whitelists
  (`PUBLIC_*_FIELDS`), `hiddenFromPublic` checked first, documents/links never published.
  QR stickers already printed carry `panel.html?p=<id>&c=<tenant>` on the Pages origin, so they
  keep working; only `panel.html`'s fetch URL comes from `clients.js`.
- **Version check**: keep `scriptVersion` in the bare GET so "Backend outdated" and
  `--status` keep working. The number continues the existing series; it is just a number.
- **CORS**: Edge Functions can send real CORS headers, so the JSONP `?callback=` wrapper and the
  `text/plain` POST workaround can eventually go. Leave them in Phase 1 (zero frontend risk).
- **Diagnostics**: the `Diagnostics` tab becomes a table; the Executions-page equivalent is
  Supabase's function logs (retained for the plan's period, searchable). Per-step timing
  (`stage_`) ports as structured logs.
- **`sheet.mjs`**: replaced by plain SQL / a small CLI for cleanup. It still must bump the
  revision counters on every direct write — keep that rule (a "write" helper that does it).
- **Admin menu (wipe/import)**: becomes an owner-only endpoint or CLI, not a Sheet menu.
- **Backups**: Supabase daily backups (paid tier) plus a nightly job that dumps every tenant to
  a downloadable file/Sheet. Version history was the project's only undo; this replaces it,
  and PITR is the upgrade if wanted.

## Running on the free tier (decided 2026-10-06)

Production starts on Supabase's FREE plan. Verified terms (supabase.com/pricing and
/docs/guides/platform/free-project-pausing, 2026-10-06): paused after ~7 days of low
activity; a few database requests a day keep it awake and API calls count; a warning email
goes out about a week before; restorable from the dashboard for up to a year (an older
changelog says 90 days -- treat 90 as the floor); **no backups at all**; 500 MB database, 5 GB
egress, 500k function calls, 2 active projects (dev + prod, nothing spare for staging).
Everything below exists to make that safe. None of it is optional.

1. **Keep-alive.** A scheduled job (GitHub Actions cron, every 12 hours) calls a `/health`
   endpoint that runs a real `SELECT` against the database -- it must touch the DB, not just
   the function, since the rule is DATABASE activity. A failed ping fails the workflow, and
   GitHub emails the repo owner on a failed run. Set the cron to a time that is not the hour.
2. **Nightly export, which is the ONLY backup.** A cron job dumps every tenant to a file
   (`pg_dump` plus a per-tenant JSON export in the importer's own format, so a single school
   can be restored alone). **The repo is public, so the dump is never committed or left as a
   public artifact**: it is encrypted (age, public key in the repo, private key held by Eric
   offline) and uploaded to storage that is not the Supabase project -- Cloudflare R2's free
   tier or a private repo. Keep 30 dailies and 12 weeklies. A backup in the same project it
   protects is not a backup.
3. **A restore drill, automated.** Monthly, CI restores the newest export into a throwaway
   Postgres and checks row counts and a checksum per tenant against the live database. An
   export that has never been restored is a hope, and this is the single check that stops
   a silently failing export from being discovered on the worst day. The job pages (fails
   loudly) if the newest export is older than 36 hours.
4. **The Sheet stays the fallback for every cut-over tenant** -- read-only, untouched, for
   several months, not weeks. While the project is on free, a school that has moved can be
   moved BACK by re-pointing `clients.js` and re-importing from the latest export into its
   Sheet. This is the reason the importer is built to run in both directions.
5. **Pause runbook (written down, one page).** The warning email goes to the Supabase account
   owner: make that a monitored address. Resume is a dashboard click and takes minutes. The
   runbook also says what the app will show meanwhile (the existing "Saved copy" state, writes
   blocked) and who tells the schools.
6. **Frontend says what happened.** A paused or unreachable backend currently surfaces as a
   generic load failure. The API's `/health` and the paused-project error shape get a
   specific message ("the service is temporarily unavailable") so a pause is not mistaken for
   a bug in a school's data. Small frontend change; the cached-snapshot behaviour already
   keeps the inventory readable.
7. **Spend the 500 MB and 5 GB budgets deliberately.**
   - Photos and floor plans are in Cloudinary, so the database holds rows only. Watch the
     audit log, which never shrinks: a monthly size report per table, alert at 70% of 500 MB.
   - Every load sends the whole inventory, which is what burns egress. Two cheap fixes inside
     the Phase 1 contract: **gzip the responses**, and let `op:"read"` carry the client's
     known revisions so the server answers `{ unchanged: true }` with no payload when nothing
     moved (the snapshot cache already makes this the common case). Measure real payload size
     per tenant during the dev spike before assuming the budget is fine.
   - Function calls (500k/month) are one per load or save, so this is the loosest limit.
8. **The two-project limit is a design constraint.** `dev` and `prod` use both. There is no
   staging project, so schema migrations are rehearsed against a throwaway local Postgres in
   CI (the same one the restore drill uses) before they touch `dev`, then `dev`, then `prod`.
9. **Stay portable so the exit is cheap.** Plain Postgres, standard SQL migrations, no
   Supabase-only features in the data path (no Realtime, no Storage, no Supabase Auth). Moving
   to Pro is a billing change with no migration; moving to another host is restore-and-redeploy.
10. **Upgrade triggers, decided now so they are not argued later.** Move to Pro when ANY of:
    a second pause happens despite the ping; the restore drill fails; egress passes 60% or
    storage 70% of the free limit; or a school asks for an uptime/backup commitment.

Residual risk, stated plainly: a missed ping still pauses everyone until someone clicks
Resume, and between nightly exports up to a day of edits is unprotected. Both are accepted
for the free tier; Pro's 7 daily backups and no-pause guarantee are what removes them.

## Rollout

1. **Schema + migrations** in the repo (`db/migrations/`), tested against a throwaway Postgres.
2. **Importer** (`import-from-sheet.mjs`): reads a tenant's Sheet through the existing
   service-account path (`sheet.mjs` internals), builds the same shapes `doGet` builds, and
   inserts. Idempotent per tenant (truncate-and-load inside one transaction). Run it
   repeatedly against dev while building.
3. **API**: port op by op, in this order — `read`/`signin`/`signout`, then save, then
   `auditFull`, photo/floor-plan signing, diagnostics, public panel.
   - **Where it is**: `supabase/functions/asset-api/` — `api.ts` routes, `auth.ts` is the
     session/allowlist port, `inventory.ts` reassembles the read payload, `db.ts` holds
     `withTenant`. The tenant is named by `?tenant=` (or `client`/`c`). `deploy-api-dev` in
     `db-migrate.yml` deploys it to the dev project on every push to `dev` and asks it two
     questions; it needs `SUPABASE_ACCESS_TOKEN` on the `supabase-dev` GitHub environment.
   - **One change from "Row-level security" above**: the function connects with the
     project's own `SUPABASE_DB_URL` (which bypasses RLS) and every transaction runs
     `set local role asset_api` in `withTenant`, rather than a separate login role holding a
     password. Same isolation, no password to create or rotate. The cost is a rule: NOTHING
     queries outside `withTenant`. Migration 0005 grants the membership that `set role` needs.
   - **Parity is already tested for the read**: `api_test.ts` runs the `.gs` file's own read
     over the shared fixture Sheet (`db/fixture-grids.mjs`) and requires this API's answer to
     equal it, except for the two differences the import makes on purpose (a duplicate
     asset id keeps its first row; a blank work-entry id gets a stable minted one).
   - The allowlist gained a `position` (migration 0004) so the Access screen keeps its order.
   - **The save (2026-10-09)** is `save.ts`, in the transaction shape above. Three things
     about it worth knowing before touching it:
     - **What it stores is shaped by the `.gs`'s own write and read, not by a field list.**
       `save-shape.ts` runs each record through doPost's projection, the Sheet's cell rule
       (a missing or null value is `""`) and handleAuthenticatedRead_'s mapping, so a field
       doPost drops is dropped here too, and the stored `data` is exactly what the `.gs` read
       would answer next. `ASSET_FIELDS` and `AUDIT_FIELDS` are copies, pinned to the `.gs`.
     - **The rows come from the importer's own `snapshotToRows`**, which moved to
       `supabase/functions/_shared/` so a deploy bundles it (`db/snapshot-rows.mjs`
       re-exports it). An import and a save cannot store a record differently.
     - **Parity is tested for the save too**: `save_test.ts` posts the same body through
       this API and through the `.gs` doPost running against a writable fake Sheet
       (`saveThroughSheet` in `db/sheet-snapshot.mjs`), and requires the two answers and the
       two reads afterwards to agree.
     - Deliberate differences from the `.gs`: a config save KEEPS stored config keys it does
       not restate (the `.gs` rewrote the tab and dropped them; nothing read them); a posted
       duplicate id keeps its first record and logs `save_adjusted`; only rows that differ
       are written, so an unchanged save touches no row. The first save after an import
       rewrites every asset once, widening it to the full column list, as the Sheet's first
       rewrite of its tab did.
     - The lock is `FOR UPDATE` on the tenant's four revision rows, taken by every save
       (an audit-only save included), with a 10s `lock_timeout` answered as `busy`.
   - **`auditFull` (2026-10-09)** is `readAuditFull` in `inventory.ts`: the whole log in
     `seq` order, any signed-in role, no lock (one transaction is one instant). The `.gs`
     answers it through `pickPublic_`, which names every audit field and writes `""` for a
     blank, while the ordinary read leaves blanks out, so the blanks are put back. Its
     parity test runs the `.gs` handler through `saveThroughSheet` and requires equality.
   - **Upload signing (2026-10-09)**, `photoSign` and `floorPlanSign`, is `sign.ts`: editor
     only, the folder and object name chosen server-side, a photo's allowed formats signed,
     a floor plan's not (v51). The Cloudinary account is shared by every tenant, so its three
     credentials are Edge Function secrets (`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
     `CLOUDINARY_API_SECRET`, under Supabase > Edge Functions > Secrets); the per-tenant folder
     is `tenants.cloudinary_folder`, falling back to `"assets"` as `CLOUDINARY_FOLDER` does.
     **Until those secrets are set the ops answer by naming them**, which is harmless before
     the cutover and a blocker at it. `sign_test.ts` runs the `.gs` handlers with the same
     clock, ids and credentials and requires byte-identical answers.
   - **`diagnostics` (2026-10-09)** is `readDiag` in `db.ts`: editors only, the newest 300
     rows newest first, every field a string as the Sheet's `getDisplayValues` hands them
     over, plus the true count. `diag_test.ts` puts the same rows in the table and in a
     fake Diagnostics tab and requires equal answers.
4. **Parity tests** (the important part): a **replay harness** that feeds the same recorded
   request sequence to the Apps Script backend (dev tenant) and the new API and compares the
   responses field for field. The existing `test-backend-*.js` suites, which slice `.gs`
   source, get a TypeScript twin for each rule they pin (revision conflict, `_dirty`, mass
   deletion, audit offset, public whitelist, photo signing). Mutation-check them as before.
5. **Dev tenant cutover**: point `dev` at the new API, import, use it for a week. The old Sheet
   stays untouched and shareable with the service account as the fallback.
6. **First school** (ask Eric, per the client-dispatch rule): import, freeze edits for the
   few minutes the import takes (revision bump on the Sheet side so any open browser is
   refused), flip `clients.js`, keep the Sheet read-only for several weeks.
7. Remaining tenants; then retire the `.gs` deploy path and its docs
   (`test-deploy-docs.js` list updates the same day).

## Frontend changes (small, enumerated)

- `clients.js`: `apiUrl`/tenant id per client; `SHEET_API_URL` derives from it.
- `backendPost`: no change in logic (retry rules, blip detection stay valid); the bare-GET
  reply it treats as a blip simply never happens.
- `panel.html` / `panel-qr-sheet.html`: fetch URL from `clients.js` (they already load it).
- Optionally drop JSONP and the `text/plain` content-type once CORS is real.
- Sandbox is untouched — it never contacts a backend.

## Risks and how this design answers them

- **Subtle behavioural drift in the save diff** (ordering, blank-vs-null, number-vs-string
  cells — Sheets turned everything into strings; JSONB will not). *Answer:* normalise on write
  to the exact shapes `doGet` returns today, and let the replay harness catch the rest.
  Expect a pass of "a field that used to read back as `"0"` now reads back as `0`".
- **Photos/IDs adopted at load time** (work-entry and schedule ids minted by
  `crypto.randomUUID()` on read) are unchanged: still written by the save that carries the
  domain. Do not "fix" them here.
- **Supabase free tier pauses** inactive projects: production must be on a paid plan.
- **Vendor lock-in** is mild: plain Postgres + a thin TypeScript API; moving hosts is a dump
  and a redeploy.
- **Two sources of truth during cutover**: avoided by making the Sheet read-only (revision bump)
  the moment a tenant flips, never dual-writing.

## Decisions needed from Eric

1. ~~Supabase vs Cloudflare Workers + D1~~ — DECIDED 2026-10-06: Supabase.
2. ~~One shared database vs a project per school~~ — DECIDED: shared (see Tenancy).
3. ~~Losing spreadsheet-style editing~~ — DECIDED 2026-10-06: acceptable. The nightly export remains the only Sheet-like artifact.
4. ~~Paid tier from the start~~ — DECIDED: free tier for now, with the safeguards in "Running on the free tier".

## Phase 2 (for later, not designed here)

Per-record writes: `persist()` sends only changed records; the revision domains become
per-record versions; conflicts shrink from "anyone saved any asset" to "someone saved THIS
asset". Large (touches every save site) and optional once Phase 1 has removed the reliability
problem.
