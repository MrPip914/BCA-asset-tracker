# The Name field — plan

Status: **agreed design, not yet built** (Eric, 2026-08-24). Nothing in this
document has been implemented. It is the prerequisite for the asset type editor.

## The problem

Two different questions are answered by the same columns today, and that overlap is
what makes the type system hard to open up to the user.

- **What is this thing called?** A Room is called "Room 102", a Building "Building
  100", a Campus by its campus name, a Bulk Item by its sub-type ("Chairs"). Four
  types, four different fields, each declared per type in the registry as `nameField`.
  Every other type has no name at all and is called by its Asset ID.
- **Where is this thing?** A printer's Room column reads "Room 102" because that's the
  room it sits in — computed by walking up the parent chain.

The Room column means the first thing on a Room row and the second thing on every
other row. `isComputedColumnFor()` exists solely to paper over that split, and the
Type column carries the same overload from the other side: it prints a Room's *name*
where the type word belongs, and a Bulk Item's *sub-type* plus a BULK badge to
compensate.

## The design

**One optional `name` field on every asset**, replacing `room` / `building` /
`campus` as name-carrying fields and ending Sub-Type's double duty.

- Names are **display only, never identity**. `label` (the Asset ID) remains the one
  stable key, per the reference conventions in CLAUDE.md. Names need not be unique,
  are freely editable, and nothing ever resolves a reference through one.
- `nameOf(asset)` keeps its shape and its label fallback, but reads one field instead
  of a per-type ladder. **The registry's `nameField` key disappears entirely** — with
  it, one of the settings the type editor would otherwise have to expose.
- A user-created type gets a real name immediately, without the per-type custom-field
  system and without the broken custom-column save path (see BUGS.md). This is the
  main reason this work comes first.

### Type and Sub-Type become type information only

- **Type column** always prints the type word: "Room", "Bulk Item", "Computer". No
  names, no exceptions, no `realName` branch.
- **The BULK badge is removed.** It only existed because the Type column was showing
  "Chairs" and there was otherwise no way to tell it was a bulk item.
- **Sub-Type column** prints only the category ("Folding Chair"). It stops standing in
  as the Bulk Item's name.
- **Detail header** reads name then type, as it does today, but fed from `name`.

### Room / Building / Campus stop being columns

They were kept, at the point Path replaced them, for three reasons. Only one survives
this change, and it isn't about the list:

1. *They hold a Room's own name.* — Gone. That is what `name` is for.
2. *The Room filter is what the bulk "move filtered to room" toolbar hangs off.* —
   Weak. `bulkMoveSourceId` already prefers the `HierarchyNav` scope and only falls
   back to `roomFilter`; the scope is the better source anyway, since it matches
   nested rooms. Rewire it onto the scope and drop the fallback.
3. *A spreadsheet is where you group by building, and a Path string can't be grouped.*
   — Real, but an argument about the **export**, not the list.

So: remove Campus/Building/Room as list columns and filters, and give
`exportToExcel` its own resolved Campus/Building/Room columns. Note the coupling to
break: the export currently builds its rows by walking `columns`, so deleting them
from the list silently deletes them from the export too.

Sorting the list by **Path** already groups by building ("Building 100 › Room 101"
and "…› Room 102" sort adjacent), so the list loses no grouping either.

## Backfill

The live sheet is sample data and does not have to come out perfect (Eric,
2026-08-24). Names are editable afterwards, so a wrong guess costs a retype.

Same mechanism as `adoptLegacyParentage()`: on load, an asset with no stored `name`
adopts one by the ladder below; the first asset-domain save writes it in for every
asset at once. No script, and the same build is correct against a migrated sheet and
an un-migrated one.

| Asset | Name it adopts | Example |
| --- | --- | --- |
| Room / Building / Campus | its existing `room` / `building` / `campus` value | `Room 102` |
| Bulk Item | a copy of its sub-type (`itemName`), editable after | `Chairs` |
| Fixed in place, with a place above it | *nearest place name* + type | `Room 102 Mini Split`, `Building 300 Condenser` |
| Everything else | type + Asset ID | `Computer BCA0012` |

"Fixed in place" is Mini Split, Condenser and Electrical Panel — things bolted to a
building rather than carried around. Stated as *nearest place + type* rather than
*room + type* so a Condenser, which hangs off a Building, reads correctly. A fixed
asset with no parent falls through to type + Asset ID.

Two consequences worth naming rather than discovering later:

- **A backfilled name can go stale.** Move that mini split and it still reads "Room
  102 Mini Split". It's ordinary editable text, and correcting it is a field edit.
  Accepted deliberately — a name that silently rewrites itself when you move
  something is worse, and would make it impossible to tell a real name from a
  placeholder.
- **New assets don't get backfilled names.** The add form pre-fills the same
  suggestion instead, editable before save, so a new asset is named at creation and
  never relies on the fallback. A genuinely blank name still displays as the Asset ID.

## Sequence

1. **Add `name`** — backend field, column, form input on every type, backfill ladder,
   `nameOf()` reading one field.
2. **Clean out Type / Sub-Type** — type word only, BULK badge removed, Sub-Type as
   category only, `nameField` deleted from the registry.
3. **Remove the place columns** — Campus/Building/Room out of the list and filters,
   export given its own resolved columns, bulk move rewired onto the scope,
   `isComputedColumnFor()` retired.
4. **Type editor** — now materially simpler, one fewer setting to design.

Steps 1–3 are one backend deploy (a `name` column on the Assets tab), taken once at
the end rather than per step. The legacy `room`/`building`/`campus` columns stay
readable but stop being written, so the change is reversible; clearing them is a
separate later step, exactly as with `roomId`/`buildingId`.

## Deferred

- Deleting the legacy name columns from the sheet.
- Per-type custom fields — still blocked by the custom-column bug in BUGS.md, but no
  longer blocking anything else.
- "Fixed in place" as a real per-type setting rather than a list used once by the
  backfill. Worth revisiting if the add form's name suggestion earns its keep.
