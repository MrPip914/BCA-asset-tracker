# BCA Asset Tracker

A school IT/facilities asset tracker for Brookside Christian Academy (Atascadero, CA),
originally built as a Claude.ai artifact and migrated to a standalone static site so it
could connect to a live Google Sheets backend (Claude.ai's artifact sandbox blocks
outbound network requests to arbitrary domains, which is why this migration happened).

## Files

- `index.html` — the entire app. No build step, no npm install. React, ReactDOM,
  lucide-react (icons), and xlsx (SheetJS, for the Excel export button) are all loaded
  from esm.sh/unpkg via an import map. Babel Standalone transpiles the JSX in-browser
  at load time. To edit: just edit the JSX inline inside the `<script type="text/babel">`
  block and reload — no build/compile step exists or is needed.
- `AssetTrackerSync.gs` — Google Apps Script backend, pasted into the Apps Script editor
  bound to a Google Sheet, deployed as a Web App. This is NOT part of the static site
  deploy — it lives entirely inside Google's infrastructure. If you change this file,
  you must re-paste it into the Apps Script editor and create a **new deployment
  version** (Deploy > Manage deployments > pencil icon > Version: New version > Deploy).
  Just saving the script does not update the live `/exec` URL.

## Architecture

- **Top-level navigation**: `mainTab` ("assets" | "maintenance") switches the main page
  between the asset list (`view === "list"`) and a site-wide Maintenance overview — every
  asset's `maintenanceItems` flattened into one sortable-by-urgency table (`allMaintenanceRows`).
  Both live inside the same `view === "list"` screen; opening an asset (either tab) still
  goes through `openDetail()` into `view === "detail"`, and `openDetail(asset, "maintenance")`
  jumps straight to that asset's Maintenance sub-tab — used by the overview's row click.
- **State**: the whole app is one component (`AssetTracker`) holding all state — assets,
  managed lists (change types, vendors, peripherals, users), audit log, column config.
- **Persistence model**: the app keeps its full state in memory and, on every change,
  sends the ENTIRE state as one JSON snapshot to the Apps Script backend (`persist()` ->
  `writeSnapshot()` -> `fetch(SHEET_API_URL, { method: "POST", ... })`). On load, it does
  one GET to the same URL and reconstructs everything (`useEffect` near the top of the
  component). No per-field diffing on the client — but `persist()` does compute which
  *domains* changed (`_dirty: { assets, config }`), via plain reference-equality against
  current state (every call site already either passes a domain through untouched or a
  freshly computed value, so this needs no per-call-site bookkeeping). `AssetTrackerSync.gs`'s
  `doPost` uses that to skip rewriting the Assets/Comments/Changes/Allocations/Maintenance
  tabs when nothing asset-related changed, and skip Config when no managed list or column
  changed — e.g. toggling a managed-list entry no longer rewrites the Assets tab, and vice
  versa. AuditLog is handled differently again: since entries are only ever appended to
  (never edited or deleted client-side), `appendNewRows_` appends just the new rows instead
  of rewriting the whole — ever-growing — history each time. A request with no `_dirty` at
  all (an old client, or a direct API call) still rewrites everything, as the safe fallback.
  `LockService` still guards every write so concurrent saves don't corrupt a tab.
- **Sheet schema**: Assets tab holds flat fields only (see `ASSET_FIELDS` in the .gs
  file). Comments, Changes (structured change log with type/vendor/cost), Allocations
  (bulk-item quantity assignments), and Maintenance (scheduled maintenance items) each
  live in their own tab, keyed by the asset's `label` (its asset ID, e.g. `BCA0001`).
  Config tab stores the managed lists and column config as JSON blobs (key/value rows),
  since those aren't naturally tabular.
- **Personal identity**: a lightweight, unverified "who's using this browser" name tag
  is stored in `localStorage` (not the Sheet) — used only to stamp comments/changes/edits
  with an author name. Not real auth.
- **Column visibility is per-device**, also `localStorage` (`COLUMN_VISIBILITY_STORAGE_KEY`),
  not the Sheet. Column *definitions* (key/label/width/custom flag) stay server-synced via
  Config, since a custom column adds a real field to every asset — only which columns are
  *shown* is local. `isColumnVisible(c)` reads the local override first, falling back to the
  column's server-defined `visible` (e.g. for a custom column another device just added, which
  this device hasn't seen/hidden yet). `toggleColumnVisible()` never calls `persist()`.

## Data model

Assets have a `type`: Computer, Monitor, Phone, TV, DocuCam, Stream Deck, Room, Building,
Bulk Item, or Other. Which fields apply to which type is governed by `TYPE_ONLY_FIELDS`
and the `*_EXCLUDED_FIELDS` arrays near the top of the file (`fieldAppliesTo()`) — e.g.
Room and Building assets don't have brand/model/serial; Bulk Items (chairs, tables — not
individually tagged) get a `totalQuantity` and an `itemName` instead, and are distributed
across rooms via their own `allocations` array rather than a single `room` field.
`itemName` ("Sub-Type" in the UI) is picked from a managed list (`bulkItemTypes`, editable
via the gear icon, same pattern as peripherals/vendors/change types) rather than freeform
text, so it stays consistent — and the list view's Type column shows a Bulk Item's
sub-type plus a small "BULK" badge instead of the literal "Bulk Item" for every row.

Rooms link to Buildings (`building` field, dropdown of existing Building assets); devices
link to Rooms (`room` field, dropdown of existing Room assets); a device's building is
inferred transitively through its Room (see `inferBuilding()`), not stored directly.

Every asset carries: `comments` (freeform notes), `changes` (structured: type/vendor/
cost/note — its own managed lists, editable via gear-icon "manage" buttons), and is
covered by a global `auditLog` that automatically records creates/edits/archives/
deletes/allocations (see `logAudit()`, `describeAudit()`) — this is separate from
`changes` and isn't user-authored.

Assets are archived (soft-deleted, `status: "Archived"`) rather than deleted by default;
permanent deletion is a separate, more heavily confirmed action only available on an
already-archived asset.

Every asset (any type) also has a `maintenanceItems` array — scheduled maintenance
entries with `task`, `frequencyLabel`/`frequencyDays` (picked from the fixed
`MAINTENANCE_FREQUENCIES` list, not a managed list, since a day-count is needed to
compute a next-due date), `lastPerformed`, and `owner` (freeform text). `nextMaintenanceDue()`
and `maintenanceStatusOf()` derive a next-due date and a status (`never` / `overdue` /
`due-soon` / `ok`) used to sort the Maintenance tab (most urgent first) and to flag the
tab itself in red when anything's overdue. Adding an item isn't separately audited (its
own `at`/`by` is enough); marking done, editing, or deleting one is, since those mutate
or remove data with no other history trail.

## Known constraints / things to watch

- No auth beyond the cosmetic name tag — anyone with the deployed URL can read/write
  everything. Fine for internal school use with a private link; not a public-facing
  security model.
- Apps Script free-tier quota is ~90 min of script runtime/day — comfortably enough
  for this app's usage pattern, but worth knowing if it ever gets flaky under heavy
  simultaneous use.
- No conflict detection: if two people save at nearly the same moment, last write wins
  and can silently drop the other person's change (each save is a full overwrite).
- Deferred features discussed but not built: a physical audit/walkthrough mode, live
  auto-refresh of stale data between users, audit log pruning.
