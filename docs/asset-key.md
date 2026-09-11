# The asset key: `id`, `label` and `tag`

*Read before touching asset identity, the tag field, or the one-time id migration.*

*Moved out of `CLAUDE.md` on 2026-09-11, verbatim. See `CLAUDE.md` for the rules that apply to every change.*

### The asset key: `id`, `label` and `tag`

`ASSET_KEY_REFACTOR_PLAN.md` is the full plan. `id` is the app's identity, `label` is legacy
display text, and `tag` is the sticker on the thing.

- **Adopting each asset's LABEL as its `id` is what made the refactor need no migration.**
  Both join sites read `a.id || a.label`, so an existing asset's key IS its label, and every
  reference already stored — `parentId`, `personIds`, a child row's `assetLabel`, a breaker's
  `panelLabel`, AuditLog's `assetLabel` and `related` — was therefore *already a valid id*. No
  backfill, no script, and **AuditLog was never touched**. Same trick `typesList` uses, where a
  built-in type's id is its original name.
- **`loadData()` adopts `id = a.id || a.label` FIRST in its map chain**, before the `personIds`
  normalize and before `adoptLegacyNames` — which walks the parent chain, and so has to walk it
  by the ids everything downstream joins on. From that point `a.id` is populated on every asset
  and is the ONLY thing that should be compared for identity.
- **New assets mint `crypto.randomUUID()`** (`startAdd`, `duplicateAsset`,
  `convertUsersToAssets`).
- **Every address accepts an id OR a label, permanently** — the `?asset=` deep link,
  `panel.html?p=`, the QR sheet's `?only=`, and `?panel=` (which takes a tag as well). Links and
  stickers outlive the build that made them, and a sticker taped inside a panel door can never
  be reprinted out of existence.
- **Renaming stale parameters is what found the one real bug.** `childLabel` → `childId` exposed
  `childId={selectedAsset.label}` on the edit form: it type-checks, it renders, and it is correct
  on every legacy row, so only the rename surfaced it. **A name that no longer says what the
  value is has cost this project real time more than once; treat one as a bug, not a tidy-up.**
- **What deliberately still reads `label`**: `findLabelConflict` and `assetNumberFromLabel` (both
  genuinely about labels), the Excel export's "Asset ID" column, the detail header, and every
  "is this asset's name just its label?" display test.
- **`MOCK_SNAPSHOT` is deliberately MIXED** — three assets carry an id that is not their label (a
  Room reached by parentId/roomsServedIds/an allocation/two audit rows, a leaf device, and a
  sub-panel that is a `feedsPanelLabel` target and owns 21 breaker `panelLabel`s); every other
  row carries none. A fixture that was all one shape would exercise half the code. That is the
  `personIds` lesson, applied deliberately this time.
- **`tag` is a per-type CHOICE, not a fixed rule** (Eric's call). It ships excluded on
  Room/Building/Campus/User and can be switched on for any of them in the type editor. The
  editor already turns an unticked field into `excludedFields`; the only thing holding `label`
  out of that list was `TYPE_STRUCTURAL_FIELDS`, which contained it *because* it was the primary
  key. Once it is only a sticker it stops being structural.
  - **`label` is KEPT and written from the client's own value, not mirrored from `tag`.** The
    plan said to mirror it, which is self-defeating: clearing a Room's tag would clear its label
    with it, destroying the rollback being preserved. Nothing in the UI writes `label` any more.
  - **`adoptLegacyTag()` DECLINES rather than clears.** A type whose tag field is excluded does
    not inherit its label as a tag, so the BCR/BCB/BCC and User labels left the UI with no
    migration to run — a load-time READ that declines, not the load-time REWRITE this file warns
    about. An explicitly-empty stored tag is never re-adopted, or clearing one would undo itself
    on the next load.
  - **`nameOf()` has three rungs**: name, then tag, then `"<type> <short id>"`. The last is a
    genuine last resort, since `adoptLegacyNames` fills a blank name on everything it loads — only
    an in-session object (an add-form draft) reaches it. Its `typesList` argument is OPTIONAL and
    degrades rather than breaks.
  - **A duplicate tag is REFUSED, but for a different reason than a duplicate label was.** It used
    to be a data question (two assets sharing a primary key are one merged asset); now it is two
    stickers reading the same thing, refused because that traps whoever holds them. **Empty tags
    are skipped** — load-bearing, since an unconditional check would make every untagged asset
    collide with every other one and nothing could save. The EDIT form runs the same check with
    the asset excluded, which the add-only label never needed.
    - **Consequence:** swapping two assets' tags is a three-step edit (clear one, set the other,
      set the first), because the intermediate state is a duplicate. Accepted.
  - **`peekAssetNumber()`'s `Math.max(counter, derived)` guard is DELETED.** It existed because a
    reused label was a reused primary key, so a new asset inherited a dead one's audit history. A
    real `id` makes that impossible, and deriving from the assets stopped meaning anything once
    most rows carry no tag at all.
  - Covered by `test-frontend-tag.js`, which runs the real registry, the real
    `recomputeDerivedTypeSets` and the real `nameOf`. Verified by mutation that all three
    silent-failure modes fail it: a Room that stops excluding the tag, a `nameOf` that loses its
    last rung, and a conflict check that stops skipping empties.
- **`backfillAuditIds_` writes keys, not labels**, since what it fills is `related`. Run it ONCE
  by hand from the Apps Script editor, after a save has created the `related` column — it is
  deliberately unreachable from `doGet`/`doPost` and never on a trigger, since it rewrites
  history.
- The admin import refuses duplicate **ids** as well as tags — the merge hazard once the id is
  what child rows are keyed by. A file with no id column skips the check entirely.

### The one-time id migration, meant to be DELETED after use

`migrate-asset-ids.mjs` + `migrate-asset-ids-lib.mjs` + `test-migrate-asset-ids.mjs` (Eric's
call, 2026-09-09 — explicitly NOT a menu item, since it applies to exactly one situation and
would otherwise sit next to "Wipe all data" forever).

- **What it is for.** Adopting labels as ids is what made the refactor need no migration, and the
  cost is that a sheet carrying data across that change ends up with two kinds of id: legacy
  `BCA0001`-shaped ones, uuids on anything created since. Nothing breaks — an id is opaque
  everywhere — but once `label` is dropped, a legacy id is the only trace of an old label with
  nothing left to explain it.
- **It rewrites 12 key-bearing columns across 8 tabs, and `AuditLog` is the dangerous one.** Every
  other tab is rebuilt by the app's next save, so a mistake self-corrects; AuditLog is
  append-only, outlives the assets it describes, and nothing rewrites it — a wrong mapping there
  is silent, permanent, and indistinguishable from real history. Version history is the only undo.
- **Dry run is the DEFAULT**; `--apply` is required. It verifies every reference resolves BEFORE
  writing anything and refuses the whole migration if any does not.
- **A pre-existing dangling reference is carried through unchanged, not "fixed"** — one that
  pointed nowhere before still points nowhere after, which is honest — but it is reported, since
  a migration is exactly when someone would want to know.
- **An asset whose id is already a uuid is left alone.** Remapping one would churn every reference
  to it for nothing.
- **It bumps the revision counters, and that is not optional**: a browser open through the run
  holds the old ids and its next save would write them straight back. **Everyone must be OUT of
  the app while it runs**, for the same reason.
- **Ordering**: it can only run against a tenant whose backend has the `id` column AND where one
  save has written into it, and whose Sheet is shared with the service account. Which tenants
  those are is `node sheet.mjs tenants` and `node deploy.mjs --status`, not a line here.
- `sheet.mjs` gained `export` on six helpers so this reuses its auth, backup, plain-text write and
  revision bump rather than re-rolling them. The decision logic lives in the `-lib` half with no
  network in it, because rehearsing an AuditLog rewrite against a live Sheet is precisely what is
  being avoided; `test-migrate-asset-ids.mjs` drives it against fixtures. Verified by mutation
  that dropping AuditLog from the column list, losing `related`'s role suffix, treating a
  comma-joined list as one key, or remapping an existing uuid all fail the suite.
