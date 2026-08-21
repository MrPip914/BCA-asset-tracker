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
- **Optimistic concurrency (backend v12)**: because every save is a full overwrite, a
  client saving a snapshot it loaded *before* someone else's save used to silently drop
  that person's work. Each of the three `_dirty` domains now carries a revision counter,
  stored in Config as `rev_assets`/`rev_config`/`rev_breakerTypes`. `doGet` returns them
  (`revisions`), the frontend holds them next to `nextAssetNumber`, and `persist()` posts
  them back as `_revisions`. Inside the same `LockService` critical section as the writes,
  `doPost` compares posted vs stored for each domain it's about to write; on any mismatch
  it writes **nothing** (not even the audit rows, which describe the rejected change) and
  returns `{ ok: false, conflict: ["assets"], revisions: {...} }`. Otherwise it writes,
  bumps only the domains it actually wrote, and returns the new revisions so the client can
  keep saving without reloading first. Per-domain, not one global counter, so editing a
  managed list doesn't conflict with someone editing an asset. On a conflict the frontend
  does **not** merge and does **not** retry — either would destroy one of the two changes —
  it reloads through `loadData()` (which also replaces the optimistic `setState` calls
  `persist()` makes around the write, so the app stops showing an edit that isn't stored
  anywhere) and shows a blocking "Your change wasn't saved" modal telling the user to redo
  it. A payload with no `_revisions` (an older client, a direct API call) is still accepted
  and written — same fallback philosophy as a missing `_dirty` — and still bumps the
  counters so other clients notice. Sandbox mode makes no network call at all, so it
  attaches no revisions and no check runs, rather than fabricating numbers locally. Two
  supporting details in `persist()`: `revisionsRef` mirrors the revision state because a
  POST needs the value as of the moment it's *sent*, and `writeQueueRef` serializes the
  POSTs so only one is in flight — several call sites fire `persist()` without awaiting it,
  and an overlapping second save would otherwise post the revision the first is about to
  bump and be rejected as a conflict with this very client's own write (overlapping
  full-snapshot writes could also already land out of order before this).
  One knock-on effect: since the counters live in Config and `writeTable_` rewrites that
  tab wholesale, Config is now rewritten whenever *any* domain is written. When config
  itself isn't dirty its stored rows are copied straight back unparsed (including keys the
  script doesn't know about), so the content is unchanged — only the counters move.
- **Saving feedback is one flag, because `persist()` is the one choke point**: `isSaving`
  (plus a `savingRef` mirror) is set at the top of `persist()` and cleared in a `finally`,
  so it clears on success, on a network/backend failure, *and* on the conflict path that
  reloads and opens the blocking modal — a spinner that never stops would be worse than
  none. Since every write in the app funnels through `persist()`, that single flag covers
  every form without per-form plumbing: it drives a "Saving…" pill in **both** headers
  (list and detail) and puts every write control into a disabled *and visibly working*
  state — label swapped to "Saving…", `C.border` background, spinner (`Loader2` +
  the `.spin` keyframe) on the icon buttons. A disabled-but-otherwise-unchanged button
  still reads as frozen, which is the exact confusion this exists to fix. Components
  outside `AssetTracker` (`ListManagerModal`, `ChildEntityTable`, `BreakersTabContent`,
  `PanelConfigForm`) take it as an `isSaving` prop.
  Two things this is deliberately *not*: it is **not** a guard inside `persist()` — a few
  write paths aren't gated on it (the bulk reassign/move toolbar), and refusing one of
  those would silently drop a real edit; the guard is an `if (savingRef.current) return;`
  at the top of each submit *handler* instead, catching the double-click that lands before
  React re-renders the button as disabled. And it does **not** replace `writeQueueRef` —
  that still serializes the POSTs; this stops the second identical submit from ever being
  created, which the queue can't do (it would happily send both).
  Sandbox mode needs no special case: its write never awaits, so `isSaving` goes true and
  false inside one React batch and no "Saving…" frame is ever painted.
  A failed save now shows a "Save failed" pill in that same slot. It used to be a bare
  "Sync failed" tucked inside the name button on the *list* header only — i.e. invisible
  on the detail page, where almost every edit is actually made.
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
  Contents/Allocations/Breakers tabs, the parent chain) a plain managed-list removal breaks.
- `icon` — the lucide icon (`iconFor()`, default `HelpCircle`).
- `excludedFields` — column keys this type doesn't get at all.
- `onlyFields` — column keys belonging to this type. Any key named in *any* entry's
  `onlyFields` becomes restricted app-wide (`RESTRICTED_FIELDS`, derived from the registry,
  not declared separately): no type that doesn't name it gets it.
- `nameField` — which field holds this type's human-readable **name**, when it isn't the
  label: Room → `room`, Building → `building`, Bulk Item → `itemName` (its sub-type,
  "Folding Chair"). Read it via **`nameOf(asset)`**, never inline — it returns that field's
  value if non-empty and otherwise falls back to the asset's `label` (its Asset ID), which
  is also what an ordinary device and any unregistered user-added type get, since neither
  has a name of its own. This exists because that per-type ladder was previously hand-written inline at
  **four** sites and had already drifted: the Maintenance overview's row name fell back to
  the literal strings `"Bulk Item"`/`"Building"`/`"Room"`, `exportToExcel`'s
  `displayRoom`/`displayBuilding` fell back to `""`, the list view's Type column fell back to
  the literal type word, and the detail-view header had no ladder at all — so opening a Room
  showed the word "Room" rather than which room it was. A fifth, partial instance (the Contents
  tab's bulk-allocation rows, `bulk.itemName || "Bulk Item"`) was folded in at the same time:
  it only ever handled the one type it could encounter, but it was the same question asked
  outside the registry, which is exactly how the other copies drifted. All five now go through
  `nameOf()`, converged on the label fallback, and a future named type is one registry key
  instead of a hunt through render sites. **No code outside the registry should know which
  field names a given type** — if you find yourself writing `.itemName ||` or `.room ||`, that's
  the ladder growing back.
- `parentTypes` — which types an asset of this type may sit **inside**, as an array of type
  names; `[]` means it takes no parent. This replaced the old `linkage` enum
  (`"room"`/`"building"`/`"allocations"`/`"none"`) when the fixed `roomId`/`buildingId` pair
  collapsed into one `parentId` — `linkage` existed only to describe those two fields, so
  keeping it would have left a second source of truth about the same question. **The registry
  is the only thing render sites should branch on** — never a hardcoded type-name comparison.
  See "The parent chain" below for the full story.

Types added at runtime via the gear-icon manager are deliberately NOT in the registry: every
lookup falls back to a generic room-dwelling device (no icon, no field rules,
`DEFAULT_PARENT_TYPES`), which is exactly how they behaved before the registry existed. Note
that "which assets *are* Rooms" queries (`roomNameFor()`, the Contents tab's
`isPlace`/`contentRooms`, the Duplicate button's place check, and `roomNameOf`/`buildingNameOf`'s
"is this asset itself one?" test) legitimately still compare type names — those are identity
questions. "What may contain what" is a capability question and goes through the registry:
the toolbar's `roomMovable` (bulk "Move filtered to room") asks `canBeParentOf("Room", a.type)`,
which correctly began including Rooms themselves once a Room could nest inside another. The
Contents tab no longer asks the question at all — it walks the chain downwards
(`descendantsOf()`), which is how the old Condenser special case disappeared.

`roomMovable` also excludes **the filtered room itself**, and that exclusion is load-bearing
rather than tidy-mindedness: the Room filter now matches the room *and* everything under it
(that's what lets it find things nested deeper), and a Room is itself Room-movable, so without
the exclusion every use of "move the devices in this room" quietly moved the room into the
destination too — restructuring the building instead of relocating equipment. Nested rooms
below it stay movable, which is the coherent reading of "everything in this room moves". The
bug was introduced by making the filter chain-aware (it was harmless when the filter only ever
matched a direct `roomId`) and was caught in browser testing, not by reading the diff.

`fieldAppliesTo()` reads the registry — e.g. Room and Building assets don't have brand/model/serial; Bulk Items
(chairs, tables — not individually tagged) get a `totalQuantity` and an `itemName` instead, and
are distributed across rooms via their own `allocations` array rather than a single `room` field.
`itemName` ("Sub-Type" in the UI) is picked from its own managed list (`bulkItemTypes`) rather
than freeform text, so it stays consistent — and the list view's Type column shows a Bulk Item's
sub-type plus a small "BULK" badge instead of the literal "Bulk Item" for every row.

That Type column generalizes via `nameField`: any type that has one shows the asset's name there
(a Room row reads "Room 102", a Building row "Building 100"), while a type without one keeps
showing the plain type string. It does **not** call `nameOf()` directly — the cell renderer
derives a local `realName` (`nameOf(a) !== a.label ? nameOf(a) : ""`) and branches on that,
because this is the one column where `nameOf()`'s label fallback is the wrong answer: an Asset
ID is neither a name nor a Type. Testing only whether the *type* declares a `nameField` isn't
enough either — that's true of a Room created without a name typed in, and of a Bulk Item before
its sub-type is picked (`bulkItemTypes` starts out empty, so that case is routine, not exotic),
and both would then print "BCR0002" where the type word belongs. `realName` collapses "type has
no name field" and "has one, still blank" into the same falsy value, so both fall through to the
plain type string. The Bulk Item case stays its own branch purely because of the BULK badge, and
uses the same `realName || a.type`. The detail-view header does the same thing in its own shape: it prints `label` and
then `titleText`, which is `"<name> (<type>)"` for a named asset ("Room 102 (Room)", "Chairs
(Bulk Item)" — the pre-existing Bulk Item parenthetical, generalized) and otherwise the older
`type · screenSize` / bare `type`. It's keyed on `nameOf(asset) !== asset.label` so a nameless
asset can't render "BCA0082 BCA0082".

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

### The parent chain

**An asset's place in the world is ONE reference: `parentId`, holding the containing asset's
`label`.** A device's parent is its Room, a Room's is its Building, a closet's is the
classroom it's inside. This replaced the fixed `roomId`/`buildingId` pair, which could only
ever express two levels (Building contains Room contains equipment) because the hierarchy was
baked into the field *names*. Now the hierarchy is ordinary data and can be any depth.
`Room.room`/`Building.building` are untouched by this — they remain the *own* display name of
that asset (the registry's `nameField`), the one genuinely plain string here, since a Room
doesn't reference itself.

Depth is unlimited by design (Eric's call, 2026-08-19): `Room`'s `parentTypes` names `Room`
itself, which is what lets a closet nest inside a classroom. Nothing caps it, because a cap
would be a new hardcoded rule right after removing the old one.

**`Campus` sits above `Building`** (added 2026-08-20, so the app can describe more than one
site — the school plus a separate residence). It's the payoff for the whole parent change: a
registry entry, a `campus` column, a backend field, and `campusNameOf()`. Nothing else needed
telling the world got a level deeper — paths, the Contents tab, the parent pickers, search,
sort and export all just walk one more link. Compare what the old fixed `roomId`/`buildingId`
pair would have required: a third id field and a rewrite of every site that resolved a place.

**Which tabs a type gets, and which opens first, come from the registry too** (the rest of the
type-settings consolidation, 2026-08-20). Three keys and three helpers:

- `modules` on a registry entry names the extra detail tabs that type owns — `["allocations"]`
  on Bulk Item, `["breakers"]` on Electrical Panel, `["locks"]` on Door when that exists.
  `hasModule(type, key)` is what render sites ask instead of naming the type that happens to
  own it today; `modulesFor(type)` lists them.
- `ASSET_MODULES` says what each module IS — its tab label and how to count its contents.
  Kept separate from `modules` because they answer different questions: whether a Door has
  locks is a fact about Doors, while what a "locks" tab is called is a fact about the locks
  module, and a second type owning locks shouldn't mean restating the label.
- `defaultTab` is which tab opens first (`defaultTabFor()`), defaulting to `"details"`. Only
  worth setting when Details isn't the useful landing place — opening a panel anywhere but its
  Layout wastes a click every time.
- `availableTabsFor(type)` composes the whole ordered list: the common tabs, Contents when
  `isPlaceType()`, and the type's modules. **The tab bar and the deep-link check both read it**,
  which is what stops a link selecting a tab the bar doesn't offer — a `?tab=breakers` link
  pasted onto a Computer used to render the tab strip with nothing under it, and now falls back
  to that type's default. Deep links outlive the asset they were copied from.

This replaced a `type === "Electrical Panel"` test repeated at the tab list, the tab body and
the default-tab choice, plus the Bulk Item equivalent — three places to remember per module,
with nothing to catch a miss. Verified by the change it was built for: temporarily adding
`modules: ["allocations"], defaultTab: "allocations"` to Room gave Rooms a working Allocations
tab that opened by default, with **no other edit anywhere**.

**Contents is the one tab that is derived rather than declared** — a type has it when anything
can sit inside it, which falls out of `parentTypes`. Listing it in `ASSET_MODULES` would mean
hand-maintaining a fact the registry already computes, and Campus would have needed adding to
that list to get a Contents tab at all.

**`isPlaceType()` answers "can this contain things", derived from the registry** rather than
declared: it's the union of every entry's `parentTypes`, so a type becomes a place the moment
anything names it as a possible parent. This replaced a hardcoded
`type === "Room" || type === "Building"` at the Contents tab and a matching
`!== "Room" && !== "Building"` on the Duplicate button — both of which silently excluded Campus
when it arrived (no Contents tab on a campus; a Duplicate button that Rooms and Buildings
correctly don't have). It's also the cheapest possible version of the deferred "move place-ness
into the type settings" work, done here because Campus forced it rather than as a refactor of
its own.

**Which types may contain which is `parentTypes`, in the registry** — never a type-name
comparison at a render site. `parentTypesFor()` reads it, `typeTakesParent()` asks whether
there's a Parent field at all, `canBeParentOf(parentType, childType)` is the rule itself. An
**empty array** means "takes no parent", covering two cases that need no distinction anywhere:
a `Building` (top of the tree) and a `Bulk Item` (no single place — it spreads a quantity
across rooms via `allocations`, which is explicitly *not* parent/child). Every registered type
declares `parentTypes` explicitly, so `parentTypesFor` deliberately does NOT default a
registered entry to `[]` — an omission on a registered type should be a visible mistake, not a
silent "contains nothing". Only an *unregistered* (user-added) type falls back, to
`DEFAULT_PARENT_TYPES` (`["Room"]`), i.e. a generic room-dwelling device.

**No parent is a real state, called "Unassigned"** (`UNASSIGNED_LABEL`), not a blank — a spare
in a drawer, something just delivered, a unit away for repair. Deliberately not "Unplaced":
a parent is containment, not necessarily *location*, so a future type whose parent isn't a
place would make "Unplaced" read as nonsense. Only shown for a type that could have a parent;
a Building or Bulk Item renders nothing, since having none is their permanent correct state.

**Everything derived from the chain is computed, never stored**, extending the principle
the now-removed `inferBuilding()` followed: `roomNameOf()` / `buildingNameOf()` / `campusNameOf()` walk up to the nearest
Room/Building (answering with the asset's *own* name when it IS one), `effectiveBuildingId()`
does the same for a stable id, `pathOf()` renders the whole chain outermost-first, and
`descendantsOf()` looks the other way for the Contents tab.

**Every walk is loop-safe, and that is load-bearing, not padding.** With fixed room/building
fields a cycle was structurally impossible; with a general parent it isn't. `ancestorsOf()`
carries a visited set (plus `MAX_PARENT_DEPTH` as a second belt against a merely absurd
chain), so it terminates on "A inside B inside A" instead of hanging the browser. The app
refuses to *create* a cycle (`wouldCreateCycle()`, wired into `saveDraft` and into
`ParentField`'s candidate list), but **storage stays permissive** — the backend validates
nothing, matching every other rule in this app — so bad parentage can still arrive from a
hand-edited sheet or a bulk script, and the app must tolerate *and flag* it rather than break.
`parentageProblem()` is the flag: a banner on the Details tab naming what's wrong (parent
missing, wrong type, part of a loop). Note `ancestorsOf(asset)` can never report that `asset`
is its own ancestor — it seeds its visited set with `asset.label` and stops at the first
repeat — so the "is this in a loop" test has to be `wouldCreateCycle(asset.label,
asset.parentId, ...)`, i.e. "would re-pointing it where it already points close a loop".

**Reading old data needs no migration**: `adoptLegacyParentage()` runs in `loadData()`'s map
and reads a pre-v15 asset's `roomId`/`buildingId` as a `parentId`, so nothing past `loadData`
ever sees the old shape and the same build is correct against a migrated sheet and an
un-migrated one. `parentId` wins when both exist. See `PARENT_CHILD_MIGRATION.md` — the short
version is that the first asset-domain save after deploying v15 rewrites the whole Assets tab
and thereby migrates everything, so there's no script to run.

**"Condenser" is the type that shows `parentTypes` doing its job**: `{ parentTypes:
["Building"] }` and nothing else — an outdoor unit sits in no particular Room, so it names
Building and is simply offered Buildings by the Parent picker. Under the old model this took
three keys (`linkage: "building"`, `onlyFields: ["building"]`, `excludedFields: ["room"]`)
plus special cases at two render sites, because it was the one non-Room type with a direct
`buildingId`. Both special cases are gone: nothing branches on *how* a type attaches any more,
it just walks up. Reuse the one-key entry for any future type that attaches to a Building as a
whole rather than to one Room.

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

**`ParentField` is the one field that says where an asset sits.** It replaced `BuildingField`
outright and took over `RoomField`'s placement role; `RoomField` survives with exactly one
caller, the Bulk Item Allocations tab, which picks a *Room specifically* rather than a parent.
Which types may be chosen comes from `parentTypesFor(childType)`, so a Computer gets Rooms, a
Condenser Buildings, a Room both — no list to maintain here. The trigger shows the chosen
parent's **full path**, since the browser's breadcrumb is gone once the modal closes and two
rooms can share a name. A dangling id resolves to `"(deleted asset)"`, not `""` — blank is
indistinguishable from Unassigned, which is now a different and legitimate state.

**`HierarchyBrowserModal` is the app's one place picker — a drill-down over the hierarchy, not
a flat list** (Eric's call, 2026-08-20). It first shipped inside the parent field as a flat
list of every valid candidate, each suffixed with its own chain to disambiguate ("Kitchen —
Building 100" vs "Kitchen (Upstairs) — Residence"); that works at four rooms and falls apart at
forty, with the path suffix doing the work navigation should do. You now start at the roots,
open one, and see only what's inside.

It was generalized out of the parent field once the same complaint applied everywhere else, and
**every place-picking control in the app now goes through it**: the Parent field, the circuit's
"serves rooms", the Bulk Item allocation picker, and the list toolbar's bulk move-to-room. Four
flat lists of every room was three too many. Callers pass a rule, not a list —
`isSelectable(asset)` (a type test, usually), an optional `excluded` set of labels to hide
outright, `multi` for several-at-once, and `noneLabel` for the "choose nothing" row.
`noneLabel` is deliberately NOT defaulted to "Unassigned": that word is right for a parent (a
real, meaningful state) and nonsense when assigning chairs to a room, where the honest answer
is that there's no such row at all.

The constraint that shapes the component: **the things you navigate THROUGH are usually not
things you may pick.** Choosing a Room, a Building is never a valid answer but is the only
route to the Rooms. So a row has up to two independent affordances — a body that selects it
(when legal) and a chevron that opens it — and when a row isn't selectable its body opens it
instead, because otherwise the obvious click would do nothing. Three rules keep it honest:

- **No dead ends.** A row is hidden unless it is itself selectable *or* something inside it is
  (`hasSelectableInside`, recursive with a visited set). An empty new Building is therefore
  offered when placing a Room and hidden when placing a Computer — and note the first of those
  is load-bearing: filter it out and you could never put the first Room in a new Building.
- **Self and descendants are excluded from the tree**, not greyed out — nothing below an asset
  can legally be its parent, so there's nothing to navigate to down there either. `saveDraft`
  still validates (`validateParentChoice()`), since a form left open while the chain moved
  underneath it can get past a filter computed at render time.
- **A dangling parent counts as a root** (`parentKeyOf` maps it to `null`), so an asset whose
  Building was deleted stays reachable instead of being stranded outside the tree.

It opens at the current value's level so the existing choice is visible and ticked. **Known
gap:** assets inside a *loop* are unreachable here, since they're neither roots nor below one
— the flat list would have shown them. That's bad data either way, only creatable by hand
editing, and `parentageProblem()` flags it on the asset's own Details tab, which is where it
gets fixed. The recursion is loop-safe regardless (verified against injected cyclic data).

**Multi-select** (`multi`) differs in three ways that all follow from one problem: you can only
see one level at a time, so you can't see your own selection. So it keeps a working copy and
commits once on **Done** rather than per click (a circuit's rooms are one edit, not one per
room); it renders the running selection as removable chips above the breadcrumb, so a pick made
three buildings ago stays visible and can be undone without navigating back to it; and it has
no "none" row, since picking nothing is just an empty chip row. `RoomsServedField` wraps it for
the circuit form and keeps those chips on the form itself — they're the answer to "what does
this circuit serve", which is what you want visible while filling it in, and each carries its
building, which is the ambiguity ("Kitchen" vs "Kitchen") that started all this.

**`RoomField` picks a Room specifically — not a parent.** Its callers are the Bulk Item
Allocations tab (a distribution across rooms, explicitly not parent/child) and the toolbar's
bulk move-to-room. `excludeId` hides one room from the tree, which the toolbar uses to drop the
room being moved *out of* — the one destination that can't be meant.

**The sub-panel feed picker shows `label — path`** ("BCA0083 — Building 200 › Room 200"). A
panel has no name of its own, so its Asset ID is its identity, but an ID alone is
unidentifiable standing in front of four panels. It listed bare ids before. It stays a flat
`PickerField` rather than a drill-down: there are four panels, not forty.

**`HierarchyNav` is the drill-down that sits above the asset list** (added 2026-08-20): a
breadcrumb plus a row of child places, narrowing the list to everything *beneath* wherever you
are, at any depth — drill to a building and you get the equipment in all its rooms, not just
what hangs directly off the building. Its state (`scopeId`) is **navigation**, deliberately
separate from the column **filters**: they intersect rather than override, and the scope
excludes the place itself (you're looking inside it).

It's deliberately NOT built on `HierarchyBrowserModal` despite the overlap. That component
picks one thing out of a tree and closes, and to do it it hides rows you can't pick and
branches that lead nowhere. Here every place is enterable — an empty building is still
somewhere you'd navigate to, to confirm it's empty — and nothing is "selectable" at all.
Sharing them would mean a predicate saying "everything" plus switches disabling the modal's own
hiding rules: more configuration than the shared tree-walking is worth.

`bulkMoveSourceId` is where the two mechanisms meet: the "Move filtered devices to room"
toolbar keys off the scope when the scope IS a room, falling back to `roomFilter`. Without
that it would be effectively unreachable, since the Room column filter is hidden by default now
that Path replaced it. `moveFilteredTo` then updates whichever one the user was actually
using, so they follow the assets they just moved instead of staring at the emptied room.

**Room, Building and Campus are computed *columns*, and the distinction that keeps that honest is
`isComputedColumnFor(key, type)`.** They're still sortable/filterable columns, but nothing
writes them, so `formColumnsFor` drops them from the add/edit forms — the Parent field is what
you edit instead, and keeping both editable would mean two ways to say where something is with
one of them going stale. The exception is why the check takes a *type*: `room` and `building`
each double as one type's own `nameField`, and for that type the column is a real stored
editable field. Treating them as flatly computed removed the only way to name a Room at all —
caught in browser testing, not by reading.

**The list shows one `Path` column instead of separate Building and Room** (Eric's call,
2026-08-19, having been shown the trade-off). Its column *key* is still `parent` — that's the
field it edits — while the list and detail read it out in full via `pathOf()`, e.g. "Building
100 › Room 101 › Storage Room". A path is what makes deep nesting legible: with Building and
Room columns alone, a panel in a closet in a classroom showed the closet and the building and
silently dropped the classroom. The asset itself is not repeated in its own path. Building and
Room columns still exist and are re-enablable from the Columns menu, just `visible: false` by
default — deleting them would have taken their column filters with them, and the bulk "Move
filtered to room" toolbar hangs off `roomFilter`. `exportToExcel` keeps them as their own
resolved columns regardless, since a spreadsheet is where you'd group by building and a single
path string can't be grouped.

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

- **A reference from one Asset to another stores the target's `label`** — `parentId`,
  `allocations[].roomId`, `Circuit.roomsServedIds`, `Breaker.panelLabel`,
  `Circuit.feedsPanelLabel` — never the target's display name. Resolve to a name at render
  time (`nameOf()` via `parentNameFor()`/`roomNameFor()`), and handle a dangling id gracefully
  ("(deleted asset)") rather than throwing.
- **Containment is `parentId` and nothing else.** If a new type needs to sit inside something,
  give it `parentTypes` in the registry — do not add a second placement field. The whole point
  of collapsing `roomId`/`buildingId` into one reference was that two fields could only ever
  describe the one hierarchy their names happened to encode.
- **A reference to a sub-entity stores its `crypto.randomUUID()` id** — `Circuit.breakerId`,
  a Breaker's `groupId`/`breakerTypeId`. Breakers, Circuits, and BreakerTypes aren't Assets
  and have no `label`, so the UUID is their only stable handle; array position isn't one,
  since they get swapped and moved.
- **Labels are never renamed.** Nothing keeps referring holders in sync on a rename, and
  nothing should have to — an asset that's wrong or retired is archived and a replacement
  gets a new label. That's why `label` is editable in the add form only.
- **Computed, not stored, for anything derivable from a reference that already exists.** A
  device's building comes from walking up its parent chain (`buildingNameOf()`); a panel's "fed from" comes from
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
brand/model/serial, purchase date, warranty, room placement via its `parentId` like any
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
- Within that modal, fields are still *stored* by what they describe: **Amp Rating** is
  per-member (the one spec that legitimately varies within a unit, e.g. the 15/30/15 split
  double-pole), while **Serial/Installed Date/Notes** describe the one physical unit you
  bought and installed, so a single value is written to every member row rather than repeated
  per pole. But **editing them is one mode, not two**: the modal is read-only by default with a
  single icon-only pencil in its header (`breakerModal.editing`), and entering edit mode turns
  the instance fields AND every member's amp rating into inputs simultaneously, with one
  Cancel and one Save (plus the group Delete) in a footer at the bottom of the modal, below
  everything they act on. Cancel reseeds every draft from stored values; so does *entering*
  edit mode, so an abandoned edit can't leave a stale draft behind.
  - Save is a **single `persist()`** (`saveBreakerUnit`), which replaced a pair of per-field
    saves (`saveBreakerAmp` / `saveBreakerInstanceDetails`) each with its own pencil. That
    split made correcting a split double-pole's three amps plus its serial four edit/save
    cycles — and since every save posts the entire state snapshot (see Persistence model),
    four backend round trips for one logical edit.
  - Audit fidelity is unchanged and deliberately per-changed-thing: one entry per member whose
    amp actually moved (labelled with that member's own slot) plus one per instance field that
    actually changed (labelled with the group's slot) — never one blanket "unit edited" entry.
    A Save where nothing changed is a no-op: no snapshot write, no audit row. Amp drafts are
    compared as strings, since an untouched draft holds whatever was stored (possibly a number)
    while a touched one is always a string.
  - `activeMemberId` no longer gates editability — it now only tracks which member has its
    Circuits sub-table expanded, and that toggle is a chevron (matching `ChildEntityTable`'s own
    expand control), not a second pencil. It's hidden while in edit mode: circuits have their own
    add/edit/delete flow that persists immediately, so they'd escape the unit's Cancel.
- **Breakers have no `status` field at all anymore** — it was never editable after creation
  (Swap Breaker and the per-member edit only ever touched serial/amp/installed date), and the
  Add Breaker form was the sole place it could be set, so it was removed outright rather than
  built out into something editable: no Status picker in Add Breaker, no status-based color
  coding in the panel diagram (`statusColor()`/`groupStatusColor()` are gone — cell borders are
  now a plain `C.border`), no Status column in the panel Table view, no Status column in the
  Breakers export. A spare Table row now says "Spare" in the Type column instead of relying on
  a status value. Old `status` values already sitting on existing breaker data are harmless
  leftover fields — nothing reads them anymore.
- **Delete removes the whole group at once** (`deleteBreakerGroup`), not one member at a
  time — a breaker-type instance is one physical unit, not N independently removable poles.
  **A unit with circuits still attached is no longer refused**: the confirm prompt says how
  many circuits there are and that they'll be unassigned rather than deleted, and the button
  reads "Unassign & delete" so the outcome is never a surprise. The circuits land in the
  panel's `unassignedCircuits` (see the unassigned-circuits section), each one getting its own
  `circuit_reassigned` audit entry alongside the unit's `breaker_removed`. This replaced
  `canDeleteBreakerGroup`, which blocked the delete outright and left the user to move every
  circuit by hand first — only possible to improve once a circuit could exist without a
  breaker. `deleteBreakerGroup` still requires its `unassignCircuits` argument to be true
  before it will drop a unit that has circuits, so a future call site can't orphan them by
  omission; `attachedCircuitCount()` is what the prompt counts with.
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
  the same "computed, not stored" principle the parent chain already uses for a device's
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
- **A circuit can belong to a panel without belonging to a breaker** (backend v13). Panel assets
  carry an `unassignedCircuits` array alongside `breakers`, holding circuits that exist but
  aren't wired to a slot yet — a run that's been pulled and labelled but not landed, or one
  taken off a breaker without being deleted. That's what forced `panelLabel` onto `CIRCUIT_FIELDS`:
  a circuit's panel used to be implied entirely by `breakerId` → that Breaker's `panelLabel`, so
  with no breaker there was nothing recording which panel it was for. `panelLabel` is now the
  authoritative panel for **every** circuit (`doPost` derives it from the panel being iterated,
  never from the client payload, so it can't disagree with the breaker's own panel), and `doGet`
  splits circuits by whether `breakerId` is empty. No migration was needed or written: every
  pre-v13 row has a `breakerId`, so it still attaches to its breaker on read and picks up its
  `panelLabel` on the next save of that panel.
  Frontend-side, `addCircuit`/`saveCircuitEdit`/`deleteCircuit`/`openMoveCircuit` all take the
  breaker id as their first argument and read a falsy one as "the unassigned list"
  (`circuitsIn()` picks the container, `updatePanelCircuits()` writes back whichever changed) —
  one flow, not a parallel set of handlers for circuits that happen not to be wired up. The
  rooms-vs-sub-panel exclusivity rule is shared as `validateCircuitDraft()` so an unassigned
  circuit can't sidestep it.
- **Move Circuit** (`openMoveCircuit`/`submitMoveCircuit`) reassigns a circuit to a different
  breaker **or to/from the unassigned list** — all three directions go through the one modal,
  with "Unassigned" offered as just another destination (`UNASSIGNED_TARGET`, a sentinel because
  `""` is already the picker's nothing-selected placeholder). Still **same panel only**; moving
  to a different Panel asset would mean mutating two assets atomically and is deferred as a
  follow-up. `circuit_reassigned` audit entries read "Slot 13a → Unassigned" rather than a raw
  id; `circuit_added`/`circuit_removed` gained the same location in their `from`, with a
  fallback in `describeAudit()` for the older entries that don't have one.
- **The panel detail tab is labelled "Layout", but its key is still `"breakers"`** — the label
  changed when the tab grew past breakers (diagram + unassigned circuits), the key deliberately
  did not: it's what `?asset=...&tab=breakers` deep links already in circulation carry and what
  `openDetail()` defaults a panel to, so renaming it would silently break every copied panel
  link. Its count badge is breakers + unassigned circuits, since both live on that tab.
- **The printed door card (`PanelLegendCard`) is a physical artifact, not a printout of the
  Table view.** It's what gets cut out and taped inside the panel door, so it deliberately
  ignores Table mode's room filter and sort and always emits *every* slot, breaker and
  circuit — including the panel's `unassignedCircuits`, which sit on no slot and would
  otherwise be missing from the one document meant to be the complete record. Reached from a
  Printer icon next to Copy link, offered in all three view modes since it doesn't render
  what's on screen.
  - **Sized against the panel, not the paper.** A breaker slot is 1" tall and a two-column
    panel stacks two slots per inch of panel height, so the breaker area is `slotCount / 2`
    inches; the card lists slots sequentially 1→N inside that height, which works out to
    `LEGEND_ROW_IN` = 0.5" per slot row, plus a 1" blank trim/tape band top and bottom.
    Width is one constant (`LEGEND_WIDTH_IN`, 7.5" = letter portrait minus 0.5" margins) —
    change that number if a door turns out to be narrower.
  - **Row height is a minimum, and the page height is MEASURED, not computed.** A slot with
    several circuits or a long note grows its row (including every circuit beats matching the
    panel's height exactly), and the unassigned section adds height no slot count predicts —
    BCA0082 computes 14" and measures 15.26". So `runPrint`/`measureCard` lay the card out
    off-screen via the `.measuring` class for one synchronous read before printing, and
    `@page` uses that. Sizing the page from `slotCount` alone spills onto a second sheet.
  - Two menu entries are page *geometry*, not content — both print the identical card:
    exact panel size (custom `@page`, one true-scale page, what "Save as PDF and send it to
    someone" wants) or tiled across letter pages.
  - **The card is portalled to `document.body`**, so printing is a straight `#root`-hides /
    card-shows swap. Leaving it in the tree instead means hiding the app around it, which
    needs the card absolutely positioned — and that silently breaks the day someone wraps the
    panel view in a `position: relative` container.
  - The print trigger is a `setTimeout`, deliberately **not** `requestAnimationFrame`: rAF
    doesn't fire while the page isn't compositing, so a user who clicked and immediately
    switched tabs would get no dialog at all until they came back.
  - The table rules (`border-collapse`, `table-layout`, `thead` repeat, `break-inside`) live
    *outside* `@media print` on purpose — the measuring pass lays the card out on screen and
    must produce the identical layout, or the height it reports isn't the height that prints.
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

- **The backend here is v17, a single COMBINED version, and it was confirmed deployed on
  2026-08-21** (by fetching the `/exec` URL and reading `scriptVersion` back — not by trusting
  this line; see the standing warning about that a few paragraphs down, which applies to this
  sentence exactly as much as to the ones it replaced). v14 (the public
  QR panel view), v15 (`parentId`) and v16 (`campus`) were each pending on their own branch and
  each called itself the next version. They edit the same `doGet`, so pasting one into the Apps
  Script editor after the other would have silently erased the first — and because each also
  bumped `FRONTEND_SCRIPT_VERSION` to its own string, the "Backend outdated" banner would have
  reported a *match* while the deployed script was missing one of the two changes. That's the
  exact failure the version check exists to catch, so the numbering couldn't be left to sort
  itself out.
  They were merged rather than renumbered (2026-08-20), because renumbering alone would have
  left the same trap in a different place. `panel.html`, `panel-qr-sheet.html`, the
  `PUBLIC_*_FIELDS` whitelists, `publicPanelPayload_`, `respond_` and the panel QR button all
  live here now; the sibling worktree `.claude/worktrees/practical-dhawan-c50573` still holds
  the original uncommitted v14 and is now **superseded — don't merge it**, it would reintroduce
  the pre-parent-chain version of the same code.
  The merge was not a concatenation: the public projection resolved a panel's Room and Building
  by reading `roomId`/`buildingId` directly, at four sites plus the whitelist. Those are what
  `parentId` replaced, so left alone the QR page would have shown a blank location the moment
  the sheet migrated. It now walks the chain (`effectiveParentId_`/`nearestAncestorRow_`, with
  the legacy pair as a fallback so it's right before AND after migration), and the same walk was
  applied to `panel.html`'s local-sandbox projection and `panel-qr-sheet.html`'s label text.
  Don't take a hardcoded "the live backend is vN" line here on
  faith, including this one: it goes stale the moment someone redeploys and nothing prompts
  anyone to update it, which has already sent a wrong "you're two versions behind" down a
  branch once. Check instead — the app's "Backend outdated" banner names both versions in its
  tooltip, or fetch the deployed `/exec` URL and read `scriptVersion` in the raw JSON. (For
  what it's worth as a dated data point rather than a standing claim: v17 — and therefore
  everything before it — was confirmed live on 2026-08-21, superseding an earlier note that
  said the same of v12 on 2026-08-16.)
  - v17 bundles three things: the `campus` column (the Campus type's name field, purely
    additive — a sheet without it round-trips Campus rows with a blank name), the `?panel=`
    public read, and `parentId` on `ASSET_FIELDS` — see "The parent chain" under Data model, and
    `PARENT_CHILD_MIGRATION.md` for the deploy/migration sequence. Now that it's deployed,
    `parentId` persists normally. Before the deploy the live backend had no such column, so a
    `parentId` the app sent was dropped on write and the app fell back to reading
    `roomId`/`buildingId` on every load (`adoptLegacyParentage()`) — which meant it *worked*,
    correctly, it just couldn't persist a move. That fallback still runs, and still matters:
    it's what resolves any row last written before the deploy, until a save rewrites it. The old `roomId`/
    `buildingId` columns are deliberately kept and still written, so v17 is reversible and
    un-migrated rows keep resolving. **No migration script exists or is needed**: every save
    rewrites the whole Assets tab, so the first asset-domain save after deploying fills
    `parentId` in for every asset at once. Clearing the two legacy columns is a separate,
    later, destructive step that has NOT been done — it's the one that closes the rollback.
  - v13 adds `panelLabel` to `CIRCUIT_FIELDS` and the `unassignedCircuits` array on panel
    assets — see "A circuit can belong to a panel without belonging to a breaker" under Data
    model. Live since the v17 deploy (v17 supersedes it). While it was pending, the live backend
    had no `panelLabel` column: circuits attached to breakers kept round-tripping exactly as
    before, but that backend's `doPost` only walked `a.breakers`, so an asset's
    `unassignedCircuits` were silently **not written at all** and disappeared on the next reload.
    Sandbox mode was unaffected — it never touches the backend. No data migration was needed:
    existing circuit rows all have a `breakerId` and get their `panelLabel` filled in on the
    next save.
  - v12 added the per-domain revision counters (`rev_assets`/`rev_config`/`rev_breakerTypes`
    in Config) behind the optimistic-concurrency check — see "Optimistic concurrency" under
    Architecture. Deployed 2026-08-16 and confirmed by a write coming back with a bumped
    `revisions` object, which only a v12+ backend returns — so conflict detection is real
    live behavior, not pending, and the three `rev_*` rows are seeded in Config.
  - Already live from the v11 deploy, both confirmed against the live payload: `Circuit.notes`
    round-trips (the Circuits tab was rewritten with a `notes` column on the first save after
    the deploy, and the legacy `description` column is gone — its old values were dropped at
    that rewrite, intended, since nothing had read them since the frontend collapsed
    label/description into `label`), and doGet returns `nextAssetNumber`. That counter still
    reads `null` because no asset has been created since the deploy; the first one created
    writes it, and until then `peekAssetNumber()` seeds from max+1 as designed.
- **The live Sheet is fully migrated to the v9 id-based schema** (as of the 2026-08-13
  session) and is still in that shape — the v15 parent chain has NOT been deployed or
  migrated, so live assets still carry `roomId`/`buildingId` and no `parentId`. The app reads
  that correctly (see the v15 note above); `PARENT_CHILD_MIGRATION.md` covers what changes
  when it deploys. As of v9:
  `roomId`/`buildingId`/`allocations[].roomId`/`Circuit.roomsServedIds` are all
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
- Conflict detection exists as of backend v12 (see "Optimistic concurrency" under
  Architecture) but is **detect-and-reject, not merge**: the second person's save is
  refused outright and they have to redo their change against freshly reloaded data.
  Nothing auto-merges, and there's no live "someone else just changed this" indicator —
  you find out at save time. Note it only guards against a *stale* save; two people can
  still take turns overwriting the same field, each on current data.
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
