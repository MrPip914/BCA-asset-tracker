# Asset key vs. asset tag — evaluation

**Status: evaluation only. Nothing implemented. No decision made.**
Written 2026-09-08 against backend v30 (confirmed live by fetching `/exec` and reading
`scriptVersion`, not by trusting a line in `CLAUDE.md`).

The question: today `label` (e.g. `BCA0001`) is both the primary key for every
cross-reference AND the human-readable tag on the sticker. Split them — give assets a
real key, and make the asset ID an ordinary optional field that gets generated when an
asset actually needs a tag.

---

## 1. What `label` is load-bearing for right now

Three jobs, currently one field.

**As the key**, it is stored in:

| Where | Field | Notes |
|---|---|---|
| Assets tab | `parentId` | the whole containment chain |
| Assets tab | `personIds` | comma-joined User labels |
| Allocations tab | `assetLabel`, `room` | both are labels |
| Comments / Changes / Maintenance tabs | `assetLabel` | row → asset |
| Breakers tab | `panelLabel` | breaker → panel asset |
| Circuits tab | `panelLabel`, `feedsPanelLabel`, `roomsServed` | last is comma-joined Room labels |
| AuditLog tab | `assetLabel`, `related` | `related` is `label:role` pairs |

**As the display identity**: the detail header, the `label` column, `nameOf()`'s fallback,
the Excel export's "Asset ID" column, `PanelLegendCard`, `panel.html`'s `<h1>`.

**As an address**: `?asset=<label>&tab=` deep links, `panel.html?p=<label>` QR stickers,
and the backend's anonymous `doGet(?panel=<label>)`.

Rough touch-point counts, excluding `MOCK_SNAPSHOT`:

```
index.html   a.label 88 · asset.label 15 · selectedLabel 34 · assetLabel 44
             parentId 50 · roomId 50 · roomsServedIds 30 · feedsPanelLabel 30
             personIds 21 · panelLabel 14 · relate()/parseRelated 24
AssetTrackerSync.gs   assetLabel 23 · panelLabel 28 · parentId 8 · related 16
panel.html   its own local projection walks parentId / byLabel / roomNameById
MOCK_SNAPSHOT  49 assets, ~101 roomsServedIds entries, every reference by label
```

Most of that is mechanical rename. The parts that are *not* mechanical are all in §4.

---

## 2. The problem is real, and it is bigger than tagging

Two things are impossible today and both come up in practice.

**An asset cannot be retagged.** `CLAUDE.md`'s "Labels are never renamed" is not a
preference, it is a consequence: nothing keeps referring holders in sync, `label` is
excluded from the edit form for exactly this reason (`index.html:5726`), and renaming one
silently orphans its own audit history. So a scuffed sticker, a re-tagged asset, or a
prefix change has no answer but "archive it and create a replacement" — which loses the
history that archiving exists to preserve.

**Assets that will never carry a sticker still consume tag numbers.** Nobody tapes a
`BCA` sticker to a room, a building, a campus, or a person. In the sandbox fixture, 25 of
49 assets are places (18 `BCR`, 5 `BCB`, 2 `BCC`); the live sheet is similar. Those four
prefixes exist because they were hand-assigned before the counter did, and today
`startAdd()` hands a brand-new Room an ordinary `BCA` label like everything else. So the
tag sequence is half-full of things that are not tagged.

There is also a latent third: two assets sharing a label are not two assets, they are one
merged asset with no way back apart. `findLabelConflict()` and `peekAssetNumber()`'s
`Math.max(counter, derived)` both exist solely to keep that from happening. With a real
key, a duplicate tag is a cosmetic annoyance and both guards can relax.

---

## 3. Three options, in increasing cost

### Option A — add `tag`, leave the key alone (recommended)

Keep `label` exactly as it is, as the key. Add a **new, separate, optional `tag` field**.
Nothing that currently references an asset changes at all.

- Backend: one name added to `ASSET_FIELDS`. Purely additive, same shape as `campus` in
  v17 — a sheet without the column round-trips fine, and the first asset-domain save
  after the deploy fills it in for every row. One version bump, no migration, no backfill.
- Frontend: a `tag` column in `DEFAULT_COLUMNS`, a field in the add/edit form, "issue a
  tag" wired to the existing `peekAssetNumber()`/`advanceAssetNumber()` counter, and tag
  display in the detail header, the list, the export and the sticker.
- `MOCK_SNAPSHOT`: untouched except for a few `tag` values to exercise the column.
- `panel.html` / `panel-qr-sheet.html`: unchanged, or show the tag alongside the label.

Roughly **one backend version and ~200–300 lines of frontend**, with no data at risk.

This delivers the entire stated goal: assets get a tag only when they need one, tags can
be reissued and corrected freely, an untagged asset is a normal state, and a duplicate tag
is harmless. The rooms/buildings/users stop consuming tag numbers the day you stop issuing
them one.

What it does **not** fix: the key is still a `BCA`-shaped string that *looks* like a tag,
so someone reading the Assets tab sees two similar-looking columns. That is a naming and
documentation problem, not a data problem — and it is solvable by renaming the column
`id` in a later, separate change.

### Option B — `id` defaults to the existing label

Add a real `id` field, and on load adopt `asset.id || asset.label`. Existing assets keep
their current label **as their id**; only assets created afterwards get a generated one.

This is exactly the trick `typesList` already uses — "a built-in type's id IS its original
name" — and it is what makes the migration free:

- every cross-reference already stored in every tab is **already a valid id**;
- **AuditLog needs no backfill**, which matters enormously (see §4);
- every printed sticker and every deep link in circulation still resolves;
- `adoptLegacyAssetIds()` in `loadData()`'s map is the whole read-side migration, same
  pattern as `adoptLegacyParentage()`.

The cost is the ~400 frontend touch-points in §1, plus the backend column renames, plus
the fixture. The renames are boring but they are not free, and several are subtle (§4).
Ids also become heterogeneous — `BCA0001` for legacy rows, UUIDs for new ones. `CLAUDE.md`
already accepted that trade for types and calls it a feature.

### Option C — mint fresh UUIDs for everything

The clean-slate version. **Do not do this.** It forces the one migration the app has no
cheap path for (§4.1), orphans every printed sticker unless you keep a tag→id lookup — at
which point you have Option B's compatibility layer anyway — and buys nothing over B.

---

## 4. The parts that are not mechanical

These apply to B and C. They are the reason the estimate is not "rename a field".

### 4.1 AuditLog is append-only and has no rewrite path

Every other tab is cleared and rewritten by `writeTable_` on each save, so changing a
column there is one save away. AuditLog is written by `appendNewRows_`, which widens the
header but **never rewrites existing rows**. Changing `assetLabel` to hold something else,
or rewriting `related`'s `label:role` pairs, therefore requires a one-off backfill run by
hand from the Apps Script editor.

This is not speculative: `backfillAuditIds_()` already exists for exactly this reason (it
filled `related` in after v27), it is deliberately unreachable from `doGet`/`doPost`, and
it is best-effort by design. So the pattern is proven — but it is a hand-run, history-
rewriting, non-idempotent step against the one table that deliberately outlives the assets
it describes.

**Option B avoids this entirely**, because the labels already in those columns are already
valid ids. That single fact is most of the difference in cost between B and C.

### 4.2 `nameOf()` has no fallback once the tag is optional

```js
function nameOf(asset) {
  return (asset?.name || "").trim() || asset?.label || "";
}
```

An asset with no name and no tag renders as an empty string — in the list, the detail
header, every audit sentence, and `parentNameFor()`. Something has to fill that hole:
require `name`, fall back to `type + short id`, or fall back to a truncated id. This needs
a decision, not a rename, and it affects every display site in the app.

### 4.3 Printed stickers are the one artifact that cannot be redeployed

`CLAUDE.md` already flags this for the tenant param. A sticker taped inside a panel door
encodes `panel.html?p=BCA0082` forever. So `doGet(?panel=)` must accept a **tag** as well
as a key, permanently, whatever else changes. Same for `?asset=` deep links, though those
are cheaper to be wrong about.

Under Option B this is free (the tag *is* that asset's id). Under C it is a permanent
lookup you have to build and never remove.

### 4.4 The Sheet stops being readable, and that is load-bearing here

This app's disaster-recovery story is "restore from the Sheet's own version history" — it
is what saved the 2026-08-21 data-loss incident — and its admin import reads a tab in the
Sheet by eye. Today you can open the Assets tab, see `parentId: BCR0006`, and know what it
means. Fill those columns with UUIDs and you cannot. That is a genuine cost for this
project specifically, and it argues for keeping human-readable keys (A or B, not C).

### 4.5 `MOCK_SNAPSHOT` must be converted properly or not at all

`CLAUDE.md` records the `personIds` incident: a fixture whose *shape* differed from the
backend's real response hid the exact bug the fixture exists to catch, and it wiped live
assignments before anyone noticed. A half-converted fixture under B would do the same
thing. 49 assets and ~101 `roomsServedIds` entries is a bulk edit, and it has to be exact.

### 4.6 Smaller ones

- The admin import (`menuImportInventory`) validates a `label` column and derives
  `nextAssetNumber` from `^BCA(\d+)$`. Both need revisiting.
- `ASSET_LABEL_RE`, `assetNumberFromLabel`, `assetLabelForNumber`, `findLabelConflict`,
  `peekAssetNumber`, `advanceAssetNumber` and the `nextAssetNumber` Config value all stop
  being about identity and become about tag issuance. Their semantics get *simpler* — the
  reuse hazard that `peekAssetNumber`'s `Math.max` guards against disappears — but every
  one of them needs re-reading rather than renaming.
- `label`'s exclusion from `editFormColumns` can be dropped, and the tag becomes editable.
- The Excel export's "Asset ID" column should carry the tag, not the key. A spreadsheet
  full of UUIDs is noise.
- `test-backend-fields.js` / `test-backend-admin.js` cover the backend write paths that
  Sandbox structurally cannot reach. Any column change here needs them extended — this is
  the only place a write-path regression can be caught.

---

## 5. Recommendation

**Do Option A now.** It satisfies the whole stated goal — tags issued on demand, freely
retaggable, optional, duplicate-tolerant — for one additive backend version and a few
hundred frontend lines, with nothing at risk and no migration.

**Keep Option B on the shelf as a later, separate change**, and if it is ever done, do it
the `typesList` way: `id` defaults to the existing label, so the migration is a read-side
adoption and the AuditLog backfill never happens.

The reason to separate them is that they are independent. "The sticker is a field, not the
key" is the change with the user-visible payoff and the small blast radius. "The key is a
UUID rather than a `BCA` string" is a much larger internal refactor whose only remaining
benefit, once A has shipped, is that the sheet's key column no longer *looks* like a tag —
and §4.4 argues it is not obviously an improvement even then.

Doing A first also de-risks B: once tags exist as their own field, every display site,
sticker and export has already stopped reading `label`, which is a large share of B's
touch-points retired before B starts.

---

## 6. Open questions for Eric

1. Should places and people (Room / Building / Campus / User) be *incapable* of holding a
   tag, or merely default to none? Incapable is cleaner — `excludedFields` on the registry
   entry, one line each — but a Building might genuinely want a plaque.
2. What does an untagged, unnamed asset display as? (§4.2 — needed for A as well as B.)
3. Should a tag be unique-enforced, warned about, or free? With the key split off, a
   duplicate is no longer destructive, so this is a usability call rather than a data one.
4. Do the existing `BCR`/`BCB`/`BCC` labels become tags, or stay as keys with no tag? If
   the latter, those prefixes stop being visible anywhere in the UI.
5. Should one tag counter serve all types, or one per prefix? Today there is one, and only
   `BCA` numbers are ever generated.
