# The parent chain

*Read before touching containment — `parentId`, place pickers, the hierarchy nav or anything that resolves where an asset sits.*

*Moved out of `CLAUDE.md` on 2026-09-11, verbatim. See `CLAUDE.md` for the rules that apply to every change.*

### The parent chain

**An asset's place in the world is ONE reference: `parentId`, holding the containing asset's
`label`.** A device's parent is its Room, a Room's is its Building, a closet's is the
classroom it's inside. This replaced the fixed `roomId`/`buildingId` pair, which could only
ever express two levels (Building contains Room contains equipment) because the hierarchy was
baked into the field *names*. Now the hierarchy is ordinary data and can be any depth.
An asset's own display name is untouched by this — it's a plain string on the asset (`name`
since v23; `Room.room`/`Building.building` before that), the one genuinely plain string here,
since a Room doesn't reference itself.

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

**A type that takes no parent is never GIVEN one, and a stored one self-heals.** Three bugs met
on the live sheet's Bulk Item (2026-08-25), all of which only bite a type with `parentTypes: []`:
- `adoptLegacyParentage()` adopted a pre-v9 `roomId` as a `parentId` regardless of type. A Bulk
  Item spreads across rooms via allocations and takes no parent, so this manufactured an asset
  permanently flagged by `parentageProblem()`. It now returns early for such a type.
- That flagged asset **could not be saved at all**. `saveDraft` refused on `validateParentChoice`
  and wrote the message into `draft.parentError`, which renders *inside* `ParentField` — a field
  a no-parent type doesn't have. Save appeared to do nothing, with no control to fix it. Now the
  edit path CLEARS `parentId` for such a type instead of refusing (no parent is its only correct
  value, so this is a repair), the error also renders at form level, and the banner's "pick a
  different parent" advice is suppressed where picking one is impossible.
- `hasMisadoptedName()` bailed out whenever the type's own legacy name column held anything,
  which skipped the one type that has BOTH its own column and a stale `room`: the broken first
  backfill read `room` first, so a bulk item called "Room 100" instead of "Chairs" was precisely
  the case the repair could never see. It now ignores the type's own column and checks the rest.

**Load order matters**: `applyTypeSettings()` runs BEFORE the assets are mapped, not just before
its own `setState`. The load-time backfills ask `typeTakesParent` and `isPlaceType`, which read
the module-level settings, so applying them later means the first load after a settings change
adopts parents and names under the PREVIOUS rules.

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

`bulkMoveSourceId` is the "Move filtered devices to room" toolbar's source room, and it reads
the scope alone: the scope when the scope IS a Room, otherwise nothing, in which case the
toolbar doesn't render — with no single room to move out of, the action has no meaning. It used
to fall back to `roomFilter`, which no longer exists; the scope was already the primary way to
narrow to a room and is the better source anyway, since it matches nested rooms the way the
filter did. `moveFilteredTo` then re-points the scope at the destination, so the user follows
the assets they just moved instead of staring at the emptied room.

**Room, Building and Campus are not columns at all** (removed 2026-08-25). They were computed
columns — sortable and filterable but written by nothing — and the whole idea went with them,
`isComputedColumn`, `isOwnPlaceColumn` and `computedPlaceValue` included. Path already says
where something is, more completely; a second, partial answer beside it was the leftover.
Their type-aware ancestor `isComputedColumnFor` had gone one step earlier, when `name` stopped
those columns doubling as one type's own name — which is what made this removal possible at
all, since before `name` the `room` column was the only way to name a Room.
- **They survive in the Excel export**, which now builds them itself rather than walking
  `columns` (see `exportToExcel`'s `writePlaceColumns`). That coupling is exactly what would
  have deleted them from every export the moment the list stopped carrying them.
- **A stored column config has to be cleaned on load** (`RETIRED_COLUMN_KEYS`): the column
  migration only ever ADDED newly-introduced defaults, so an existing sheet would otherwise
  keep offering all three forever. Custom columns are never touched — a custom key is a real
  field on every asset, so dropping one would hide stored data.
- `MOCK_SNAPSHOT` carries a stored column config *including* the retired three, so the sandbox
  exercises that removal instead of starting from `DEFAULT_COLUMNS`, which has nothing to
  remove. A fixture without one hides the only case that matters — the same blind spot that
  let the first version of the name backfill ship broken.

**The list shows one `Path` column instead of separate Building and Room** (Eric's call,
2026-08-19, having been shown the trade-off). Its column *key* is still `parent` — that's the
field it edits — while the list and detail read it out in full via `pathOf()`, e.g. "Building
100 › Room 101 › Storage Room". A path is what makes deep nesting legible: with Building and
Room columns alone, a panel in a closet in a classroom showed the closet and the building and
silently dropped the classroom. The asset itself is not repeated in its own path. Building and
Room columns were kept, hidden, for a while after that — their filters were still load-bearing
and each was still one type's own name — and were removed outright on 2026-08-25 once neither
was true. `exportToExcel` still emits them as its own resolved columns, since a spreadsheet is
where you'd group by building and a single path string can't be grouped.

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
