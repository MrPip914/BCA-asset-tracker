# Breaker Types — Architecture Design (Implemented)

Companion to `PANELS_BREAKERS_ARCHITECTURE.md` — extends that model rather than
replacing it. Introduces **BreakerType** as a new entity between Slot and Breaker,
and the underlying addressing change (half-slot cells) that makes it possible.
Built and verified in Sandbox mode — the live backend still needs a redeploy
(`AssetTrackerSync.gs` v8) before this is usable against the real Sheet; see
`CLAUDE.md` for current status.

## 1. Why the current model can't express this

Today a Breaker's footprint is a list of whole slot numbers (`slots: ["1"]`,
`slots: ["1", "3"]`). Every shape built so far — single, double-pole, tandem, quad —
happens to be expressible as "N whole slots, aligned." A configuration where one
breaker uses *half* of slot 1 and *half* of slot 2 (offset from its neighbors, not
slot-aligned) has no representation: there's no such thing as "half a slot" in the
current schema.

Real panels do build breakers this way — a 2-pole breaker doesn't need two *full*
slots' worth of bus stab, it needs one stab from each of two adjacent phases, which
a half-slot offset provides just as validly as two full aligned slots do.

## 2. The new primitive: half-slot cells

Every physical slot has two halves, addressed `Na` and `Nb` (e.g. `1a`, `1b`) — `a`
is the first half, `b` the second. **A breaker's footprint is a set of cells, not a
set of slots.** This one change is what makes everything else possible:

- A basic single-pole breaker in slot 1: cells `["1a", "1b"]` (both halves — no
  sharing).
- A tandem pair: two breakers, cells `["1a"]` and `["1b"]`.
- A double-pole breaker across slots 1 and 3 (today's model, stacked same column):
  cells `["1a", "1b", "3a", "3b"]`.
- Your third example (2 slots, 3 breakers): cells `["1a"]` (15A), `["1b", "2a"]`
  (30A), `["2b"]` (15A).

**Poles are derived, not stored.** Poles = the count of *distinct slots* a breaker's
cells touch — 1 slot touched is 1-pole, 2 slots touched is 2-pole, regardless of
which halves. This removes a field that could otherwise drift out of sync with the
actual footprint (e.g. someone hand-editing poles to "2" on a breaker that only
touches one slot).

`Breaker.slots` (today's field) is replaced by `Breaker.cells`. Anywhere that needs
"which whole slots does this breaker touch" (slot-sharing validation, the panel
diagram's row/column placement, the `Slot 1/3` label) derives it by extracting the
distinct slot numbers referenced in `cells` — a strict superset of what `slots` could
already express, so nothing downstream loses information.

## 3. BreakerType entity

A user-defined catalog entry — a template, not a placed breaker:

```
BreakerType {
  id: uuid,
  name: "Mixed 15/30/15",     // freeform, shown in the Add Breaker picker
  slotSpan: 2,                 // how many physical slots this type claims when placed
  members: [
    { cells: ["1a"],       ampRating: "15" },
    { cells: ["1b", "2a"], ampRating: "30" },
    { cells: ["2b"],       ampRating: "15" },
  ],
}
```

`1`/`2` in a type's `cells` are **relative** slot positions within the type (its 1st
slot, 2nd slot) — not real panel slot numbers. A type is defined once and reused
across any panel/slot.

**Basic and tandem are just this same shape at `slotSpan: 1`:**
- Basic: `slotSpan: 1`, one member, cells `["1a", "1b"]`.
- Tandem: `slotSpan: 1`, two members, cells `["1a"]` and `["1b"]`.

No separate "mount" enum is needed once BreakerType exists — "tandem" and "quad" stop
being special-cased breaker properties and become just two more catalog entries,
alongside whatever new ones get added later (like your 3-breaker mixed example, or a
GFCI/AFCI type when that turns out to need its own cell pattern).

## 4. Placement: relative → absolute

**Decision:** a type's slots must stack in a single column, matching the existing
double-pole convention — e.g. a `slotSpan: 2` type placed starting at slot 5 resolves
to absolute slots 5 and 7 (not 5 and 6), same rule already used for double-pole
breakers today. This keeps the panel diagram's column/row math unchanged — a type
never needs to reason about crossing between the odd and even columns.

Placing a type:
1. User picks a starting slot (e.g. 5) and a BreakerType from the catalog.
2. The app validates all `slotSpan` resolved slots (5, 7, ... in the same column) are
   currently free.
3. One Breaker row is created per member, each with:
   - `cells`: the member's relative cells mapped onto the resolved absolute slots
     (relative slot 1 → 5, relative slot 2 → 7, ...).
   - `ampRating`: copied from the member as a **starting value** — editable
     afterward via the existing per-row Edit/Swap, exactly like any breaker today.
     Placing a type is a convenience for defining the group correctly in one step,
     not a live link — editing one instance later never touches the type or other
     instances placed from it.
   - `groupId`: a fresh UUID shared by every row from this placement (same mechanism
     already used for tandem/quad).
   - `breakerTypeId`: the source type's id, kept **for display only** (e.g. a
     "Tandem 2×15A" badge) — not re-validated against the type after placement.

## 5. Backend schema

New sheet tab, same flat-row/JSON-blob pattern already used for Config:

**`BreakerTypes` tab**

| column | notes |
|---|---|
| `id` | UUID |
| `name` | freeform |
| `slotSpan` | integer |
| `members` | JSON-encoded array of `{ cells, ampRating }` — structured, so it's serialized the same way Config already stores managed-list JSON, not comma-joined like `slots` is |

**`Breakers` tab changes**

- `slots` → `cells` (comma-joined, e.g. `"1a,1b"` — same joining convention as
  today's `slots`, just with half-cell strings instead of whole slot numbers).
- `poles` column **removed** — derived at read time from `cells`, never stored.
- `breakerTypeId` **added** (blank for breakers not placed from a type — including
  every existing breaker, which stays valid with no migration needed beyond the
  `slots`→`cells` rewrite below).
- `groupId` unchanged (already added in the previous pass).

## 6. Frontend changes (high level — not yet built)

- **Breaker Type manager**: a new managed-list-style modal (gear icon, matching the
  existing peripherals/vendors/change-types pattern) but with a richer per-type
  editor than those flat lists need — **a visual slot-cell picker**: a small grid of
  clickable half-cells (`1a`/`1b`/`2a`/`2b`/...) sized to the type's `slotSpan`,
  where clicking cells assigns them to the "current member" being defined, then an
  amp-rating input per member. This reuses the same visual language as the existing
  panel diagram (a grid of cells) rather than inventing a new UI idiom.
- **Add Breaker flow**: replace the current Slot(s)/Mount/Poles/Amp fields with:
  pick a BreakerType from the catalog (dropdown, shows name + slot span), pick a
  starting slot, optionally adjust each member's amp rating before confirming. Poles
  and cell layout come from the type, not typed in by hand.
- **PanelDiagram**: cell-building logic changes from grouping by `slots` overlap to
  grouping by `groupId` + extracting distinct slots from `cells` — mechanically
  similar to the current tandem/quad detection, just reading `cells` instead of
  `slots`. Rendering (the vertical-stack-of-breakers cell) is unaffected — it already
  doesn't care how many breakers are in a group or which mount they claim.
- **Breaker detail modal**: clicking any breaker in the diagram opens every member of
  its group at once (every row sharing that `groupId`), not just the one clicked — a
  breaker-type instance like a quad or split double-pole is one physical unit even
  though it's several rows. Fields are split accordingly: Amp Rating is per-member
  (editable via its own pencil icon); Serial/Installed Date/Notes describe the one
  physical unit and are edited once at the group level, applied to every member row.
  Status was dropped from the UI entirely. Delete removes the whole group at once
  (blocked if any member still has circuits attached). Circuits are attached per
  member breaker, each with its own Add/Edit/Delete/Move — a single breaker can carry
  multiple circuits. Swap exists in code but its trigger was removed from the modal
  for now.

## 7. Migration for existing data

Every breaker already in the sheet (BCA0082 and friends) has `slots` + `poles` +
`mount` set under the old model. Converting to `cells`:

- `mount: "full"`, 1 slot → `cells: ["Na", "Nb"]`.
- `mount: "full"`, 2 slots (double-pole, e.g. `["6","8"]`) → `cells: ["6a","6b","8a","8b"]`.
- `mount: "tandem"` / `"quad"` rows (already one row per physical breaker, linked by
  `groupId`) → each row's single slot `N` becomes cells `["Na"]` for one half and
  `["Nb"]` for its sibling — needs the *pairing* preserved (which existing row gets
  `a` vs `b`) but no new information has to be invented, since a tandem/quad row's
  slot already fully determines which whole slot it's in.
- No existing breaker needs a `breakerTypeId` — it's fine for that to be blank
  forever on data that predates the catalog.

## Resolved during implementation

- **Deleting a BreakerType IS blocked** if any breaker anywhere still references it
  via `breakerTypeId` — `findBreakerTypeUsages()` scans every Electrical Panel's
  breakers and, if any match, the delete is refused with a message listing exactly
  where (`"Can't delete — still used by: BCA0082 Slot 2, BCA0082 Slot 4"`), so the
  user can go fix those breakers first rather than getting a silently-stale badge.
- **The catalog ships seeded** with 5 entries covering every shape used or
  discussed while designing this: Single-Pole, Double-Pole (240V), Tandem, Quad,
  and Split Double-Pole (15/30/15) — the mixed/offset example that motivated the
  whole redesign. See `SEEDED_BREAKER_TYPES` in `index.html`.

## Decisions log

| # | Question | Decision |
|---|---|---|
| 1 | How to represent a breaker footprint that doesn't align to whole slots | Half-slot cell addressing (`Na`/`Nb`) replaces whole-slot `slots` (section 2) |
| 2 | Store poles explicitly or derive them | Derive from distinct slots touched by `cells` — one less field to drift out of sync (section 2) |
| 3 | Can a multi-slot type span any 2 slots, or must they stack in one column | Same-column stacking only, matching today's double-pole rule — keeps diagram column logic unchanged (section 4) |
| 4 | How rich should the Breaker Type editor UI be | Visual slot-cell picker (grid of clickable half-cells), not a plain form (section 6) |
| 5 | Does placing a type create a live link back to it | No — copies starting values onto independent Breaker rows; `breakerTypeId` is kept for display only (section 4) |
