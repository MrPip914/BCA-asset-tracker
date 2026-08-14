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
  Just saving the script does not update the live `/exec` URL. This exact mistake
  happened once already (silently — Maintenance and Breakers/Circuits both appeared
  to work in-session but never actually reached the sheet, for several redeploy
  cycles, before `SCRIPT_VERSION` below caught it) — so **whenever you edit this
  file, bump `SCRIPT_VERSION` at its top *and* the matching `FRONTEND_SCRIPT_VERSION`
  near the top of `index.html`, in the same commit.** `loadData()` compares the two
  on every load and shows a "Backend outdated" warning (with both version strings in
  its tooltip) if the live backend doesn't match — the fast way to confirm a redeploy
  actually landed, instead of only finding out when a feature quietly fails to persist.

## Local Sandbox mode

A "Sandbox" pill in the top-right of the header (next to the name tag) toggles between
the real Google Sheet and a local fixture (`MOCK_SNAPSHOT` in `index.html`) — added so
UI iteration doesn't have to touch live data or wait on Apps Script redeploys/cold
starts. OFF by default (talks to the real Sheet); the toggle state is remembered
per-device via `localStorage` (`SANDBOX_MODE_KEY`).

- **When ON**: `loadData()` reads `MOCK_SNAPSHOT` (or, after the first edit, the
  saved-over copy in `localStorage` under `SANDBOX_DATA_KEY`) instead of fetching
  `SHEET_API_URL`; `persist()` writes back to that same `localStorage` key instead of
  POSTing to Apps Script. **No network call to the real backend happens at all while
  Sandbox is ON** — safe to add/delete/break things freely. A "Reset" button next to
  the pill wipes the `localStorage` copy back to the original `MOCK_SNAPSHOT` fixture.
- **When OFF**: behaves exactly as before this existed — real fetch, real writes.
- `MOCK_SNAPSHOT` is a trimmed, hand-maintained subset of the real inventory (not all
  107 real assets — that would bloat the file for no benefit), but keeps the full
  Electrical Panel/Breaker/Circuit structure intact since that's the area under active
  development. Update it by hand (it's plain JS data) when you want the sandbox to
  start from a different baseline, e.g. after a schema change, so new development has
  fixture data that already matches the new shape instead of stale pre-change data.
- Backend schema changes (a new `BREAKER_FIELDS`/`CIRCUIT_FIELDS`/`ASSET_FIELDS` entry
  in `AssetTrackerSync.gs`) can be fully built and tried out in Sandbox mode — including
  by Claude Code, which can flip the toggle via the same UI — without needing a redeploy
  first. Only flip Sandbox OFF and redeploy once the feature is actually done, so a
  schema change only needs *one* "paste + redeploy" instead of one per iteration.

## Architecture

- **Top-level navigation**: `mainTab` ("assets" | "maintenance") switches the main page
  between the asset list (`view === "list"`) and a site-wide Maintenance overview — every
  asset's `maintenanceItems` flattened into one sortable-by-urgency table (`allMaintenanceRows`).
  Both live inside the same `view === "list"` screen; opening an asset (either tab) still
  goes through `openDetail()` into `view === "detail"`, and `openDetail(asset, "maintenance")`
  jumps straight to that asset's Maintenance sub-tab — used by the overview's row click.
- **Deep links are one-way and on-demand, not continuous URL sync**: the app never pushes
  `view`/`selectedLabel`/`detailTab` into the address bar as you navigate (no back-button
  support, that wasn't asked for). Instead, a "Copy link" button (currently only in the
  panel layout view, `PanelDiagram`) builds a `?asset=<label>&tab=<tab>` URL on demand and
  copies it (`fallbackCopyToClipboard()` covers browsers/contexts without the async
  Clipboard API, e.g. a plain `file://` page). On load, a one-time effect gated by
  `urlDeepLinkAppliedRef` (a `useRef`, not empty-deps — `assets` starts `null` and the
  effect has to wait for `loadData()` to resolve before there's anything to match against)
  reads those params and calls `openDetail()` straight to that asset/tab if the label
  still exists. Extend this same pattern (`?asset=...&tab=...` + a button calling the same
  URL-building logic) for a "copy link" anywhere else it'd be useful — the restore side
  already works for any asset/tab combination, only the button is scoped to panels so far.
- **State**: the whole app is one component (`AssetTracker`, ~3700 lines) holding all
  state — assets, managed lists (change types, vendors, peripherals, users), audit log,
  column config. This is a known architectural weak point (see "Component size" below),
  not an endorsement — it's evolved this large rather than being designed this way, and
  splitting more of its render tree out the way `BreakersTabContent` was pulled out is
  the natural next step whenever a tab gets touched again.
- **Related state lives in one object, not parallel `useState`s**, wherever it's opened/
  closed together — e.g. `breakerModal` (anchor id, per-member amp drafts, instance
  draft, editing flags, error, all in one object, `null` when closed) instead of 8
  separate states. This isn't just tidiness: before this consolidation, `openDetail()`
  (which runs every time you navigate to a different asset) didn't reset any of the
  breaker-modal or Add-Breaker-form state, since resetting 8+ scattered setters is easy
  to forget one of — which is exactly what happened. Grouping into one object made
  `openDetail()`'s reset trivial (`setBreakerModal(null)`) and structurally harder to
  regress. `swapModal`, `moveCircuitModal`, and `addBreakerDraft` (its own `error` field
  instead of a 4th parallel state) follow the same shape. `allocationDraft` folds its
  error in too. Maintenance's add/edit/delete state was *not* consolidated — it's three
  genuinely different sub-flows (new item, editing an existing one by index, confirming
  a delete), not one thing with parallel copies, so merging it would add complexity
  rather than remove it.
- **Persistence model**: the app keeps its full state in memory and, on every change,
  sends the ENTIRE state as one JSON snapshot to the Apps Script backend (`persist()` ->
  `writeSnapshot()` -> `fetch(SHEET_API_URL, { method: "POST", ... })`). On load, it does
  one GET to the same URL and reconstructs everything (`useEffect` near the top of the
  component). `persist(nextAssets, overrides)` takes an *options object* for everything
  besides assets (`{ columns, changeTypes, vendors, auditLog, peripheralsList, usersList,
  bulkItemTypes, typesList, breakerTypes }`) — each defaults to the current state, so a
  call site only names whichever domain it's actually changing (most calls are just
  `persist(next, { auditLog: logAudit([entry]) })`) instead of re-passing every other
  domain unchanged, which is what a 10-positional-argument signature demanded before.
  No per-field diffing on the client — but `persist()` does compute which *domains*
  changed (`_dirty: { assets, config }`), via plain reference-equality against
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
  Breakers (keyed by `panelLabel`) and Circuits (keyed by `breakerId`, one level deeper —
  see Data model) are the same pattern with an extra level of nesting. Config tab stores
  the managed lists and column config as JSON blobs (key/value rows), since those aren't
  naturally tabular.
- **Personal identity**: a lightweight, unverified "who's using this browser" name tag
  is stored in `localStorage` (not the Sheet) — used only to stamp comments/changes/edits
  with an author name. Not real auth.
- **Column visibility is per-device**, also `localStorage` (`COLUMN_VISIBILITY_STORAGE_KEY`),
  not the Sheet. Column *definitions* (key/label/width/custom flag) stay server-synced via
  Config, since a custom column adds a real field to every asset — only which columns are
  *shown* is local. `isColumnVisible(c)` reads the local override first, falling back to the
  column's server-defined `visible` (e.g. for a custom column another device just added, which
  this device hasn't seen/hidden yet). `toggleColumnVisible()` never calls `persist()`.
- **`ChildEntityTable`** (bottom of the file) is a generic list/add/edit/delete component for
  a structured child entity (fields config + items + onAdd/onSave/onDelete), built for
  Breakers and Circuits and intended for reuse — Locks under Doors is planned next and will
  need the identical list/add/edit/move shape. It owns its own add/edit/expand/delete-confirm
  UI state; the caller supplies data + callbacks, plus `renderCustomFields` for anything that
  doesn't fit the generic field-type system (text/number/date/select/multiselect) — used for
  a Circuit's rooms-served-vs-feeds-sub-panel toggle. Actions that aren't a generic field edit
  (Swap Breaker, Move Circuit) live outside the component via `customRowActions`, which opens
  the caller's own dedicated modal.
- **Component size**: `AssetTracker` is still a god-component (state, handlers, and most tab
  content all live in it) — a byproduct of the app growing feature-by-feature with no build
  step to make splitting files free. `BreakersTabContent` (the Breakers detail-tab's whole
  render: "Fed from" banner, panel config/diagram toggle, Add Breaker form) was pulled out as
  a top-level component taking only the props it touches, as a first cut proving the pattern
  works with zero build-step cost — plain JS/JSX reorganization within `index.html`, nothing
  else changes. Not all tabs have been split out this way yet; do the same extraction for
  another tab's content next time that tab needs real changes, rather than a dedicated
  refactor pass.
- **Main-page toolbar is intentionally minimal, on both top-level tabs**: on Assets,
  Columns/Export/Add Asset live in a hamburger menu (`showToolbarMenu`) anchored top-right of
  the Assets/Maintenance tab row rather than as always-visible buttons; on Maintenance, the
  same hamburger (shared state — only one tab's content is mounted at a time, so no conflict)
  holds just Export, since there's no per-tab Columns or an "Add" equivalent there. On both,
  the search box collapses to an icon (`searchOpen`) and expands on click — bound to `query` on
  Assets, `maintenanceQuery` on Maintenance — staying expanded whenever its query is non-empty
  so an active search is never hidden. Neither tab has a "Showing X of Y" count line: on Assets,
  the one thing that lived there besides the count (clearing an active sort) moved to a small ×
  chip next to the sort arrow on the sorted column's own header; on Maintenance, the overdue
  count that lived there is now a standalone badge above the table.
- **Per-column filter + sort is a shared pattern, not duplicated per table**: `ColumnHeaderCell`
  (Filter icon + click-to-cycle sort + clear-sort × chip) and `ColumnFilterModal` (option list +
  Sort A→Z/Z→A) are generic, parameterized by a `filterConfigs` map (`{ [colKey]: { label, value,
  setValue, options, labelForOption? } }`) plus `sortConfig`/`setSortConfig`. The Assets table's
  Type/Room/User/Status columns and the Maintenance table's Frequency/Owner/Status columns (Task/
  Asset/Last Performed/Next Due are plain sort-only, no filter) both go through these same two
  components — each tab just supplies its own state and options. `labelForOption` exists for
  columns whose stored value isn't the display text (Maintenance's Status filter stores
  `"due-soon"` but shows "Due soon", via `MAINTENANCE_STATUS_FILTER_OPTIONS`). Maintenance's
  default (unsorted) view is always due-soonest-first with never-performed items pinned to the
  top; picking an explicit column sort overrides that until cleared.
- **Edit affordance convention**: every "edit this record" trigger is an icon-only pencil
  (`<Pencil size={14} color={C.muted}/>`, `aria-label="Edit ..."`), positioned at the trailing
  edge of the row/section it edits, alongside that row's other icon actions (delete, etc.) —
  e.g. the Breaker Type manager row, a breaker instance/member row, a Circuit row, a Maintenance
  item's header row. The one exception is the Asset Detail page's primary "Edit" button (opens
  the full edit form) — it keeps a text label since it's a page-level action sitting next to
  other labeled buttons (Duplicate/Archive/Delete), not a per-row list action.

## Data model

Assets have a `type`, picked from a managed list (`typesList`, editable via the gear icon on
the Type field — same pattern as peripherals/vendors/change types, seeded from `TYPE_OPTIONS`
on a brand-new sheet: Computer, Monitor, Phone, TV, DocuCam, Stream Deck, Room, Building,
Bulk Item, Electrical Panel, Other).

**Everything the app knows about a structurally special type lives in one `TYPE_REGISTRY`**
near the top of `index.html`, keyed by type name. This replaced a set of parallel arrays
(`TYPE_ONLY_FIELDS`, five `*_EXCLUDED_FIELDS`, `LOCKED_TYPES`, `CATEGORY_ICONS`) plus a
scattering of `asset.type === "Room"`-style tests at render sites — adding a structurally
new type meant editing all of them with nothing to catch a miss. Each entry may declare:
- `locked` — can't be removed in the type manager (`isLockedType()`): Room, Building, Bulk
  Item, Electrical Panel, which have deep structural dependencies elsewhere (field rules,
  Contents/Allocations/Breakers tabs, `inferBuilding()`) a plain managed-list removal breaks.
- `icon` — the lucide icon (`iconFor()`, default `HelpCircle`).
- `excludedFields` — column keys this type doesn't get at all.
- `onlyFields` — column keys belonging to this type. Any key named in *any* entry's
  `onlyFields` becomes restricted app-wide (`RESTRICTED_FIELDS`, derived from the registry,
  not declared separately): no type that doesn't name it gets it.
- `linkage` — `"room"` (has a `roomId`; building inferred transitively through that Room) /
  `"building"` (has its own `buildingId`; must also name `building` in `onlyFields`) /
  `"allocations"` (a pooled quantity spread across rooms) / `"none"` (a Building, top of the
  place tree — its `building` field is its own display name, not a link). **`linkageOf(type)`
  is the only thing render sites should branch on** — never a hardcoded type-name comparison.

Types added at runtime via the gear-icon manager are deliberately NOT in the registry: every
lookup falls back to a generic room-linked device (no icon, no field rules, `DEFAULT_LINKAGE`),
which is exactly how they behaved before the registry existed. Note that "which assets *are*
Rooms" queries (`roomNameFor()`, the Contents tab's `isPlace`/`contentDevices`) legitimately
still compare type names — those are identity questions, not linkage.

`fieldAppliesTo()` reads the registry — e.g. Room and Building assets don't have brand/model/serial; Bulk Items
(chairs, tables — not individually tagged) get a `totalQuantity` and an `itemName` instead, and
are distributed across rooms via their own `allocations` array rather than a single `room` field.
`itemName` ("Sub-Type" in the UI) is picked from its own managed list (`bulkItemTypes`) rather
than freeform text, so it stays consistent — and the list view's Type column shows a Bulk Item's
sub-type plus a small "BULK" badge instead of the literal "Bulk Item" for every row.

**No native `<select>` appears anywhere in the app** — every single-select field uses the same
custom modal picker (`SelectionModal`) instead: a centered card with a scrollable option list
and a checkmark on the selected item, visually matching the column-filter popup
(`activeFilterCol`) rather than the browser's native dropdown chrome. `PickerTrigger` is the
button that opens it, styled like the old `<select>` so form layouts didn't need to change.
`TypeField`/`RoomField`/`BuildingField` are bespoke wrappers (id-based, with "(deleted room)"-
style dangling-reference handling); everything else — Frequency, Change Type, Vendor, Bulk Item
Sub-Type, Breaker Type, panel Layout, the Move Circuit/Add Breaker/toolbar
bulk-action pickers, and `ChildEntityTable`'s generic `type: "select"` field — goes through the
generic `PickerField` component (same `PickerTrigger` + `SelectionModal`, parameterized by
`options`/`labelForOption`/`onManage`). Pass `hideLabel` when the field already has its own
label elsewhere (e.g. an outer flex-row `<label>`, or a mode-toggle button pair like the
Circuit form's Serves-rooms/Feeds-sub-panel picker) so `PickerField` renders just the trigger,
not a second redundant header. `UserField`/`PeripheralsField` are deliberately NOT `PickerField`
— they're multi-select chip-toggle groups, a different interaction from a single-select dropdown.

Rooms link to Buildings, and devices link to Rooms, by **stable id** (the target Room/
Building asset's own `label`, e.g. `BCR0002`) — `Room.buildingId`, everything else's
`roomId`, `allocations[].roomId`, `Circuit.roomsServedIds` — not by the target's display
name. `roomNameFor()`/`buildingNameFor()` resolve an id back to the current name at render
time; a device's building is inferred transitively through its Room (see `inferBuilding()`,
which now follows `roomId` → that Room's `buildingId`), not stored directly. `Room.room`/
`Building.building` remain the *own* display name of that Room/Building asset — the one
field that's genuinely a plain string, since a Room doesn't reference itself.

**"Condenser" is the one non-Room/Building type that links to a Building directly** (a
`buildingId` field of its own) instead of inferring one through a Room — it's an outdoor
unit that doesn't sit inside any particular Room. Its registry entry is
`{ linkage: "building", onlyFields: ["building"], excludedFields: ["room"] }` — so it gets a
Building field and no Room field. This is a second, generally-useful linkage pattern, not a
one-off hack — reuse it (that same three-key entry) for any future type that attaches to a
Building as a whole rather than to one Room. Two rendering
sites had to learn to resolve a *direct* `buildingId` for a non-Room type, since previously
only Room ever had one: the read-only Detail view's building special-case (was hardcoded to
`selectedAsset.type === "Room"`, now `linkageOf(type) === "building"`, which covers Room and
Condenser but not Building itself) and the list-row cell renderer (new `isBuildingCol` branch
resolving via `buildingNameFor(a.buildingId, assets)`, alongside the existing `isRoomCol`/
`isInferredBuilding` branches) — the latter was also silently blank for Room rows before
this fix, since the generic fallback path read the non-existent `a.building` field instead
of resolving `a.buildingId`. Sort/filter/search and `exportToExcel`'s `displayBuilding`
already resolved a direct `buildingId` correctly for any type, so they needed no changes.

This is deliberate hardening, not the original design: earlier, everything stored the
target's display *name*, kept in sync by a rename cascade in the edit-save handler that
walked every asset and rewrote matching `.room`/`.building`/`allocations[].room` strings.
That cascade had a real gap — it never reached into
`panel.breakers[].circuits[].roomsServed` (nested inside Electrical Panel assets), so
renaming a Room silently orphaned the panel diagram's "Feeds" view and a Room's "Fed by"
banner. Switching every reference to an id removes the whole cascade requirement:
renaming a Room/Building is now a normal single-asset field edit with nothing else to
keep in sync, since every reference already holds the id, not the stale name. Deleting a
Room/Building that's still referenced is blocked (`canDeleteAsset()`, wired into the
`confirmDelete` modal) the same way Breaker Type deletion is blocked when still in use
(`canDeleteBreakerGroup`/`findBreakerTypeUsages`) — client-side only, consistent with
every other delete guard in this app.

`RoomField`/`BuildingField` (~line 4229) take the id-valued asset list (`rooms`/
`buildings` — i.e. `roomAssets`/`buildingAssets`) directly rather than an array of name
strings, and resolve the id to a name for display (`PickerTrigger`, `SelectionModal`'s
`labelForOption`) while storing the id on change. A dangling id (its Room/Building was
deleted) resolves to `"(deleted room)"`/`"(deleted building)"` rather than throwing.

**Every asset's own `label` (its Asset ID, e.g. `BCA0082`) is the one field the whole app
treats as a stable, unique identifier** — `Breaker.panelLabel`, `Circuit.feedsPanelLabel`,
the `roomId`/`buildingId` references above, and the global `auditLog`'s `assetLabel`
matching all assume it never changes. It's therefore excluded from `editFormColumns`
(`formColumnsFor(draft.type).filter(c => c.key !== "label")`, ~line 2290) — editable only
in the *add* form (`addFormColumns`, unfiltered), where nothing references it yet. Before
this exclusion existed, the generic edit form rendered "Asset ID" as an ordinary text
field with no protection at all — renaming an existing asset there silently orphaned its
own audit history (new entries are logged against the *old* label at save time, via
`original.label`) and desynced `selectedLabel` from `assets` (kicking the user back to the
list view on save), the same failure mode the Room/Building hardening above was built to
eliminate — found by auditing the codebase for other name-vs-id gaps after that fix.

Two further gaps in that same "label is the primary key" story were closed later, both in
the *add* path (the only place a label is authored at all):

- **A duplicate label is rejected at creation** (`findLabelConflict()`, called from
  `saveDraft()`'s add branch, case-insensitive and trimmed). The suggested label is
  editable, so a typo could previously collide with an existing asset — and every lookup
  that uses a label matches *all* rows sharing it (`assets.map(a => a.label === selectedLabel
  ...)`, delete's mirror `filter`, and the backend grouping child rows by `assetLabel`), so
  two assets with one label aren't two colliding assets, they're one merged asset with no
  way to separate them again. The add form shows an inline error naming the existing asset
  (and saying so when it's archived, since an archived asset isn't in the default list view)
  rather than returning silently — Save doing nothing is indistinguishable from Save working
  to whoever typed the typo. Empty Asset ID / Type go through the same inline error.
- **Labels are issued from a persisted monotonic counter, not recomputed from the assets.**
  `nextAssetNumber` lives in the Config domain (backend v11) and is read by
  `peekAssetNumber()` / advanced by `advanceAssetNumber()`; `startAdd()` and
  `duplicateAsset()` both go through it, so they can't disagree. Deriving it as max BCA
  number + 1 — what both did before — meant permanently deleting the highest-numbered asset
  freed its label for immediate reuse, and since AuditLog is keyed by `assetLabel` and
  deliberately outlives the asset it logged, the next asset created silently inherited the
  dead one's created/edited/archived/deleted history. `peekAssetNumber()` returns
  `max(counter, derived)` rather than the counter alone, which is what seeds it on an
  existing sheet (counter null → derived wins) and what keeps a counter that somehow lags
  the sheet — a direct API write, a migration script, a hand-edited Config row — from ever
  handing out a number that's already taken. It never decrements: a hand-typed *higher*
  label pushes it past that number, a lower one (filling a hole) leaves it alone, and a
  non-BCA label consumes nothing. Only BCA numbers are ever generated; the BCR/BCB labels on
  Rooms/Buildings predate this and are never issued by it, and there's no per-type prefix
  scheme — a new Room still gets a BCA label like everything else.

### Reference conventions — apply these to any new module

The rules the existing modules already follow, stated once so a new one doesn't have to
rediscover them:

- **A reference from one Asset to another stores the target's `label`** — `roomId`,
  `buildingId`, `allocations[].roomId`, `Circuit.roomsServedIds`, `Breaker.panelLabel`,
  `Circuit.feedsPanelLabel` — never the target's display name. Resolve to a name at render
  time (`roomNameFor()`/`buildingNameFor()`), and handle a dangling id gracefully
  ("(deleted room)") rather than throwing.
- **A reference to a sub-entity stores its `crypto.randomUUID()` id** — `Circuit.breakerId`,
  a Breaker's `groupId`/`breakerTypeId`. Breakers, Circuits, and BreakerTypes aren't Assets
  and have no `label`, so the UUID is their only stable handle; array position isn't one,
  since they get swapped and moved.
- **Labels are never renamed.** Nothing keeps referring holders in sync on a rename, and
  nothing should have to — an asset that's wrong or retired is archived and a replacement
  gets a new label. That's why `label` is editable in the add form only.
- **Computed, not stored, for anything derivable from a reference that already exists.** A
  device's building comes from its Room (`inferBuilding()`); a panel's "fed from" comes from
  searching all circuits for `feedsPanelLabel === thisPanelLabel`. Don't add a stored field
  mirroring a relationship the other side already records — it's just a second copy to keep
  in sync, and the one that goes stale.

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

**Electrical Panel** assets (`type: "Electrical Panel"`) are otherwise device-like — real
brand/model/serial, purchase date, warranty, room placement via `inferBuilding()` like any
other device — they just don't have `peripherals` (their registry entry's `excludedFields`). Each
carries a `breakers` array (own Breakers tab in the detail view), one level deeper than
anything else in the app: **Circuit → Breaker → Panel**. Breakers and Circuits are *not*
Assets themselves (don't appear in the main list, no independent archive) but get a real
`crypto.randomUUID()` id, since they get swapped/moved and other records point at them —
array position can't serve as identity once things move.

- A Breaker's footprint is `cells` — half-slot addresses like `["1a","1b"]`, not a list of
  whole slot numbers — see `BREAKER_TYPES_ARCHITECTURE.md` for the full reasoning. Poles are
  derived (`polesFromCells()` — count of distinct slots touched), never stored. This one
  addressing scheme covers single-pole, double-pole/240V, tandem, quad, and mixed/offset
  configurations without a `mount` enum (removed).
- **BreakerType** is a user-managed catalog (gear icon in the Add Breaker form → "Manage
  types") of reusable breaker configurations — a name, a slot span, and a list of members
  (relative cells + amp rating). Placing one via Add Breaker creates one real Breaker row per
  member atomically, all linked by a fresh `groupId`, with the type's amp ratings as editable
  starting values — not a live link; editing a placed breaker afterward never touches the type
  or its sibling rows. `breakerTypeId` on a Breaker is for display only (the type name badge).
  Seeded with 5 entries (`SEEDED_BREAKER_TYPES`): Single-Pole, Double-Pole (240V), Tandem,
  Quad, and Split Double-Pole (15/30/15) — a 2-pole breaker offset by half a slot from two
  independent single-poles, the case that motivated moving to cell addressing at all. Deleting
  a type in use is blocked, listing every panel+slot still referencing it
  (`findBreakerTypeUsages()`).
- A multi-member placement (tandem, quad, or any type with >1 member) is a GROUP of individual
  Breaker rows sharing a `groupId` — every breaker placed via Add Breaker gets one, even a
  lone single-pole (a "group" of one), so the panel diagram's grouping logic never needs to
  special-case mount/count. Editing an existing breaker never changes its cells/groupId/
  breakerTypeId (delete and re-add instead) — only Add Breaker creates groups.
- **Circuits are associated with a specific Breaker, not a slot** — clicking any member of a
  group in the diagram opens one modal for the whole group (every Breaker row sharing that
  `groupId`), since a breaker-type instance like a quad or split double-pole is one physical
  unit even though it's several rows. A single breaker can hold multiple circuits.
- Within that modal, fields are split by what they actually describe: **Amp Rating** is
  per-member (the one spec that legitimately varies within a unit, e.g. the 15/30/15 split
  double-pole) with its own pencil-to-edit control (`saveBreakerAmp`); **Serial/Installed
  Date/Notes** describe the one physical unit you bought and installed, so they're edited once
  at the group level and written to every member row (`saveBreakerInstanceDetails`) rather than
  repeated per pole. All fields are read-only by default with a pencil icon to enter edit mode
  (Save/Cancel), not an always-open form.
- **Breakers have no `status` field at all anymore** — it was never editable after creation
  (Swap Breaker and the per-member edit only ever touched serial/amp/installed date), and the
  Add Breaker form was the sole place it could be set, so it was removed outright rather than
  built out into something editable: no Status picker in Add Breaker, no status-based color
  coding in the panel diagram (`statusColor()`/`groupStatusColor()` are gone — cell borders are
  now a plain `C.border`), no Status column in the panel Table view, no Status column in the
  Breakers export. A spare Table row now says "Spare" in the Type column instead of relying on
  a status value. Old `status` values already sitting on existing breaker data are harmless
  leftover fields — nothing reads them anymore.
- **Delete removes the whole group at once** (`deleteBreakerGroup`/`canDeleteBreakerGroup`),
  not one member at a time — a breaker-type instance is one physical unit, not N independently
  removable poles. Blocked if any member still has circuits, naming how many
  (`"Still has circuits attached (1 of 3 breakers in this unit)"`).
- **Swap Breaker** (`openSwapBreaker`/`submitSwapBreaker`) still exists but its trigger button
  was removed from the breaker modal for now (per explicit request) — the functions and the
  swap modal are dead code until it's reconnected. If re-adding it, keep in mind Swap was
  designed as a single-breaker action (old serial/ampRating/installedDate on one row); the
  group-level instance-details edit above already covers the serial/installed-date case for a
  whole unit, so Swap's future role, if any, needs rethinking rather than just re-wiring the
  old button.
- A Circuit's `Circuit.feedsPanelLabel` marks it as feeding a downstream sub-panel instead of
  serving rooms directly (`roomsServed`) — mutually exclusive, enforced in `addCircuit`/
  `saveCircuitEdit`. A panel's "fed from" info is never stored on the Panel itself — it's
  found by searching all circuits for `feedsPanelLabel === thisPanelLabel` at render time,
  the same "computed, not stored" principle `inferBuilding()` already uses for a device's
  building.
- **`Circuit.label` is the circuit's nice display name** (e.g. "Outlets", "Water Heater",
  "Feed to Room 300 sub-panel") — it used to hold slot-style text mirroring the breaker's own
  cell notation ("1", "8a"), with the actual human-readable name living in a separate
  `Circuit.description` field. That split was redundant (the breaker already shows its own
  slot) and confusing (two name-ish fields), so `description` is gone — every circuit's
  identity is `id` (a `crypto.randomUUID()`, stable and guaranteed-unique, set once at
  creation and never re-derived) plus `label` (freeform, user-edited, the only name field
  now). The Add/Edit Circuit form is a single Label input; there's no separate description
  field to fill in. `MOCK_SNAPSHOT`'s circuits were migrated by hand — each one's old
  `description` became its `label`, and the handful with no description (the sub-panel-feed
  circuits) got a purpose-describing label written by hand (e.g. "Feed to garage sub-panel").
- **`Circuit.notes` is a free-text, multi-line field for what's actually connected** — one
  callout per line (e.g. "- North wall outlets\n- Closet outlets"), rendered with
  `whiteSpace: "pre-line"` so embedded `\n`s show as real line breaks without needing to
  split the string in JS. Uses the `ChildEntityTable` field system's new `"textarea"` type
  (added alongside the existing text/number/date/select/multiselect types — a plain
  `<textarea>`, `rows` configurable via `f.rows`, defaulting to 3). Shown in both the
  expanded (`ChildEntityTable`'s `renderSummary`) and collapsed (plain read-only list)
  circuit views — those two render blocks are kept in sync by hand since the collapsed one
  is deliberately NOT `ChildEntityTable` (no per-row actions there, see the pencil-icon
  standardization entry above), so a future circuit-summary field needs updating in both
  places. `MOCK_SNAPSHOT`'s circuits were populated by hand with realistic per-circuit
  callouts (walls/zones for outlet circuits, fixture names for lighting/appliance circuits,
  "Feeds downstream sub-panel; no direct loads" for sub-panel-feed circuits) — written via a
  line-number-anchored `sed` script (`/id: "cXX-Y"/ s/.../.../`) for the bulk of them, since
  authoring ~84 individual Edit calls wasn't practical; the two circuits with genuinely
  multi-line notes were done as direct `Edit` calls instead; see the PowerShell-file-editing
  memory entry — GNU sed's `\n` in a replacement means a literal newline unless doubled to
  `\\n`, and even that depends on how many escaping layers sit between you and the file, so
  verify escaping empirically (e.g. `sed 's/X/A\\nB/' <<< X | cat -A`) before trusting it on
  a real file, and diff/line-count-check immediately after any bulk substitution.
- **Move Circuit** (`openMoveCircuit`/`submitMoveCircuit`) reassigns a circuit to a different
  breaker — **same panel only** in this pass; moving to a different Panel asset would mean
  mutating two assets atomically and is deferred as a follow-up.
- Deleting a breaker with circuits attached, or a circuit's roomsServed/feedsPanelLabel
  exclusivity, is validated client-side only (`canDeleteBreaker`, `addCircuit`) — consistent
  with every other guard in this app (delete/archive confirmations etc.); nothing else
  validates server-side either, so making this one check the exception wouldn't close a real
  gap. Breakers/Circuits carry no `at`/`by` of their own (unlike comments/changes/maintenance
  items), so — like Allocations — every mutation (add/edit/swap/move/remove) is audited, with
  `snake_case` action names: `breaker_added`, `breaker_edited`, `breaker_swapped`,
  `breaker_removed`, `circuit_added`, `circuit_edited`, `circuit_reassigned`, `circuit_removed`.

## Feature request tracking (shared with Cowork)

Eric keeps the running feature request list for this app in his Logseq graph, not in this
repo: `C:\Users\mrpip\OneDrive\Logseq\pages\Asset Tracker - Feature Requests.md`. It's a
plain markdown file — read/write it directly with normal file tools, same as any other
file. A separate Cowork session (cloud) is where Eric describes new feature ideas out
loud and where they first get added to the list; a scheduled daily job on that side also
scans this repo and marks things done as a backstop. Since Claude Code runs locally and
actually does the implementation work, it's in the best position to update the list
**the moment a feature ships** — don't leave it to the backstop job to catch up.

**Never edit this file from a stale copy.** This page is written to by two independent
systems (this repo's Claude Code, and a Cowork session/scheduled job in the cloud), so a
version you read 10 minutes — or even 1 minute — ago may already be out of date. This has
already caused real data loss twice (once from Cowork's side, once from Claude Code's
side re-introducing an old bullet-list version over Cowork's table conversion). The rule,
no exceptions: immediately before every single write to this file, re-read it fresh from
disk in that same turn, apply your change to that fresh copy, and write it back right
away. Never reuse a copy read earlier in the session, never batch up multiple planned
edits against one earlier read, and never assume the format you remember is still what's
on disk — check.

**File format — as of Aug 1 2026 this is a TABLE, not a bullet list** (don't restructure
it again, just follow this shape):
- Page properties at the top: `title::`, `type:: project`, `alias::`.
- A `# Requests` section (open/in-progress items) and a `# Done / Shipped` section, each
  containing one markdown table (a single Logseq block — the whole table is one bullet's
  multi-line content, not one bullet per row).
- Requests table columns: `Feature | Status | Effort | Added | Source | Details`.
  Done/Shipped table columns: `Feature | Effort | Added | Completed | Source | Details`
  (Completed replaces Status once something's done).
  - `Status`: `idea` → `planned` → `in-progress` (done rows move to the other table
    entirely, not marked `done` in place).
  - `Effort`: T-shirt size — `S` / `M` / `L` / `XL`, or `TBD` if unsized. Don't guess a
    size just to fill the cell — leave `TBD` unless you're actually confident.
  - `Added` / `Completed`: Logseq date-link format, `[[Aug 1st, 2026]]`.
  - `Source`: `eric` or `claude-code`.
  - `Details`: free text, single cell (no line breaks — keep it to one or two sentences,
    semicolon-separated if it needs more than one point).

**When you finish implementing a feature that has a matching row in the Requests table:**
1. Move that entire row to the Done/Shipped table (reshape it into that table's column
   order — Effort/Added/Completed/Source/Details, dropping Status).
2. Fill in `Completed` with today's date, same link format as `Added`.
3. Leave every other row untouched — don't reformat, reorder, resize columns, or "clean
   up" the rest of either table in the same edit.

**You may also add new request rows directly** — e.g. when you notice a real gap while
implementing something (an obvious follow-up, an edge case the current work doesn't
cover, something that clearly wants to exist but is out of scope for the current change).
When you do:
- Set `Source` to `claude-code` (Eric's own requests from Cowork are `eric`) so it's
  visibly distinguishable at a glance from something Eric actually asked for.
- Default `Status` to `idea` and `Effort` to `TBD`, and use the `Details` cell to explain
  why you're suggesting it / what prompted it — Eric wasn't in the room for this one, so
  give him enough context to evaluate it without having to ask you.
- Don't add speculative "nice to have" noise for its own sake — add it because you hit a
  concrete, real gap while working, not as a general brainstorm.

**What NOT to do:**
- Don't mark something done on a guess — only when you've actually shipped the matching
  work in this session. A false "done" is worse than leaving it as `in-progress`, since
  this file is Eric's source of truth for what's still outstanding.
- If two systems touch the file close together, only ever change the specific row(s)
  you're updating — never regenerate the whole table — so a concurrent edit from the
  other side doesn't get clobbered.
- Before writing, re-read the file fresh rather than reusing a copy from earlier in your
  session — a stale copy is exactly what caused this file to get accidentally clobbered
  once already (Cowork made the same mistake and fixed its own process after).

## Known constraints / things to watch

- **Backend is at v11 — this needs a re-paste + New version deploy to go live**, and it
  carries *two* undeployed changes, since v10 was never deployed either (the live backend is
  still v9). One paste + one New version deploy ships both.
  - v11 adds `nextAssetNumber` to Config — the monotonic asset-label counter (see the
    Asset ID section under Data model). doGet returns it; doPost re-states it on every
    config write at `max(posted, stored)`. Until it deploys, the frontend still works —
    it just re-seeds the counter from max+1 on every load, i.e. the old reuse-after-
    permanent-delete behavior persists against the live Sheet.
  - v10 adds `notes` to `CIRCUIT_FIELDS` and to both the doGet read and doPost write circuit
    mappings, and drops the legacy `description` column. Until that deploy lands,
    **circuit notes entered against the live Sheet are silently discarded on save** — the
    "Backend outdated" banner will now catch this, since v11 ≠ the deployed v9.
  The Circuits tab's header row changes shape on the first save after deploy (`description`
  column gone, `notes` column added); `readTable_` keys off the sheet's own header row, so a
  v10 backend reading a not-yet-rewritten v9 tab just returns empty notes rather than
  breaking. Existing circuit `description` values on the live sheet are dropped at that
  first rewrite — intended, nothing has read that column since the frontend collapsed
  label/description into `label`.
- **The live Sheet is fully migrated to the v9 id-based schema** (as of the 2026-08-13
  session): `roomId`/`buildingId`/`allocations[].roomId`/`Circuit.roomsServedIds` are all
  stable ids on every live asset, all 4 real panels (BCA0082–85) were rebuilt with the
  `cells`/`BreakerType` model (BCA0082 is the main panel, 32 slots, with 3 real sub-panel
  feeds to BCA0083/84/85; each sub-panel is sized to its building's real room count — 3/3/4
  rooms — with one reserved-but-not-yet-installed future sub-panel feed each), and the live
  `BreakerTypes` tab (previously empty despite the v9 deploy) was seeded with the 5 catalog
  types. The migration was written via a one-off PowerShell script against `SHEET_API_URL`
  (not through the UI) since it touched ~130 assets at once; no migration script was kept
  in the repo. Check `backendScriptVersion` in the UI if this ever seems stale.
- Mitsubishi mini-split/condenser sample data now exists in both Sandbox and the live
  Sheet: one "Mini Split" indoor unit per Room (18 on live) and one "Condenser" outdoor
  unit per Building (4 on live, zone count matched to that building's room count), each
  with seeded maintenance items (Monthly filter clean + Annual coil clean for Mini Splits;
  Annual inspection/cleaning for Condensers).
- No auth beyond the cosmetic name tag — anyone with the deployed URL can read/write
  everything. Fine for internal school use with a private link; not a public-facing
  security model.
- Apps Script free-tier quota is ~90 min of script runtime/day — comfortably enough
  for this app's usage pattern, but worth knowing if it ever gets flaky under heavy
  simultaneous use.
- No conflict detection: if two people save at nearly the same moment, last write wins
  and can silently drop the other person's change (each save is a full overwrite).
- **Date-only fields and Sheets auto-conversion**: any plain "yyyy-MM-dd" string (a
  maintenance item's `lastPerformed`, a breaker's `installedDate`, `purchaseDate`,
  `warrantyUntil`) used to come back from the Sheet as a full ISO timestamp instead —
  Google Sheets auto-detects a date-looking string on write and silently converts the
  cell to a real Date, which then serializes as `"2026-06-03T07:00:00.000Z"` rather than
  the plain string the app expects. Fixed two ways (`SCRIPT_VERSION` v3): `writeTable_`/
  `appendNewRows_` now force the written range to plain-text format (`setNumberFormat("@")`)
  before writing, so it won't happen again; and the frontend's `dateOnly()` helper
  normalizes any value that already round-tripped this way (slices to the first 10 chars)
  wherever a date-only field is parsed or fed into a `type="date"` input, so already-
  corrupted rows in the Sheet still display and compute correctly without a data migration.
- Deferred features discussed but not built: a physical audit/walkthrough mode, live
  auto-refresh of stale data between users, audit log pruning, cross-panel circuit moves
  (same-panel only today — see Move Circuit above).
- **Planned next**: Doors/Locks/Keys, reusing `ChildEntityTable`. Keying is many-to-many (one
  key opens many locks), not a tree like Panel→Breaker→Circuit — will need its own join-table
  design (`LockKeys`) and its own facility-wide view, not bolted onto the Panels tree pattern.
  See `DOORS_LOCKS_KEYS_NOTES.md` for why `LockKeys` has to be top-level shared state with its
  own sheet tab (the `breakerTypes` pattern) rather than an array nested in a Door asset.
