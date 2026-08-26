# Audit entries on associated resources — scope

**Status:** scoped, not built. Eric's calls recorded inline.
**Goal:** open a Room (or any container) and see the audit entries for things that
happened *to it* — a computer moved in from Room A, chairs allocated, a circuit
pointed at it — not just entries stamped with that asset's own label.

---

## The blocker: the audit log stores names, everything else stores ids

`CLAUDE.md`'s "Reference conventions" say a reference from one asset to another
stores the target's `label` and resolves to a name at render time. Every module
follows that — `parentId`, `allocations[].roomId`, `Circuit.roomsServedIds`,
`Breaker.panelLabel`. **The audit log is the one place that doesn't.**

```js
// saveDraft(), parent move
from: parentNameFor(oldVal, assets) || UNASSIGNED_LABEL,   // "Room 101"
to:   parentNameFor(newVal, assets) || UNASSIGNED_LABEL,   // "Room 205"

// saveAllocation()
room: roomNameFor(roomId, assets),                          // "Room 101"

// addCircuit()
to: `Serves ${roomsServedIds.map(id => roomNameFor(id, assets)).join(", ")}`,
```

So "which entries involve Room 101" can only be asked as a string match against a
name that was correct at write time. That's ambiguous (two rooms can be called
"Kitchen") and it goes stale (renaming a room silently detaches its history) —
the exact failure the id-based hardening was built to eliminate everywhere else.

**This is not an incidental detail; it is the feature.** Once audit entries carry
ids, a room's view is a filter. Until they do, there is nothing correct to filter on.

## The trap: adding a column to AuditLog does not widen its header row

AuditLog is append-only and is the only tab written by `appendNewRows_` rather
than `writeTable_`. That function writes the header row **only when the sheet is
empty**:

```js
function appendNewRows_(name, headers, rows) {
  const lastRow = sheet.getLastRow();
  if (lastRow === 0) {                     // <-- only on a brand-new sheet
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  ...
}
```

`readTable_` keys each row off **the file's own header row**, not the passed
array. So on the live sheet — which is not empty — adding `relatedIds`/`fromId`/
`toId` to the header array would append values into three columns whose header
cells are still blank, and every one would read back as `obj[""]`, colliding with
each other and vanishing.

It would fail **silently**, and the `SCRIPT_VERSION` / `FRONTEND_SCRIPT_VERSION`
check would not catch it: both versions would match while the ids quietly went
nowhere. That is the same class of failure the version check exists for, in the
one spot the version check can't see.

**Fix:** make `appendNewRows_` reconcile the header row — if the stored one is
narrower than `headers`, rewrite it. Three lines, and it makes every future audit
column safe instead of just this one.

```js
const storedWidth = lastRow === 0 ? 0 : sheet.getLastColumn();
if (storedWidth < headers.length) {
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
}
```

---

## Phase 1 — ids on audit entries, and the associated-resource view

### Data shape

Three new fields on an audit entry, three new columns at the **end** of the
AuditLog header array (order matters — see the trap above):

| Field | Type | Meaning |
|---|---|---|
| `relatedIds` | comma-joined labels | Every asset this entry is *also* about. The queryable index. |
| `fromId` | label or `""` | Where the subject came from, when the field is a reference. |
| `toId` | label or `""` | Where it went. |

`fromId`/`toId` are always also members of `relatedIds`. The redundancy is
deliberate and has one job: `relatedIds` answers *"does this entry concern me"*,
`fromId`/`toId` answer *"in which direction"*, which is what lets Room A say
"moved out" and Room B say "moved in" about the same entry. Allocations and
`roomsServed` have related ids with no direction at all, which is why the generic
array is the index rather than a derived from/to pair.

Comma-joining matches `Circuit.roomsServed`, which already stores a list of
labels in one cell — no new serialization convention.

### One helper, so no call site can forget

The from/to-must-be-in-relatedIds rule is exactly the kind of invariant this
codebase keeps getting bitten by when it's restated at each call site (see the
`nameOf()` entry in `CLAUDE.md` — the same ladder hand-written at four sites, and
already drifted at three of them). So it gets a function:

```js
// Attach the asset references an audit entry is about. fromId/toId carry the
// direction of a move; alsoIds covers references with no direction (an
// allocation's room, a circuit's rooms served). Every id given ends up in
// relatedIds, which is the ONLY thing the associated-resource views query --
// so no call site can index an entry by forgetting to repeat itself.
function relate({ fromId = "", toId = "", alsoIds = [] } = {}) {
  const all = [fromId, toId, ...alsoIds].filter(Boolean);
  return { fromId, toId, relatedIds: [...new Set(all)] };
}
```

Used as `{ ...stamp, action: "edited", ...relate({ fromId, toId }) }`.

### Call sites to update (~10 of 24)

| Site | Action | Ids |
|---|---|---|
| `saveDraft()` edit, `parentId` key | `edited` | `fromId` = old parent, `toId` = new parent |
| `saveDraft()` add | `created` | `toId` = `draft.parentId` |
| `archiveAsset` / restore / `deleteAsset` | `archived`/`restored`/`deleted` | `alsoIds` = `[parentId]` |
| `duplicateAsset()` | `created` | `toId` = copy's `parentId` |
| `moveFilteredTo()` (bulk) | `edited` | `fromId`/`toId` |
| `saveAllocation()` | `allocated` | `toId` = `roomId` |
| `removeAllocation()` | `unallocated` | `fromId` = `roomId` |
| `addCircuit()` | `circuit_added` | `alsoIds` = `roomsServedIds` + `feedsPanelLabel` |
| `saveCircuitEdit()` rooms-served diff | `circuit_edited` | `alsoIds` = union(old, new) |
| `deleteCircuit()` | `circuit_removed` | `alsoIds` = `roomsServedIds` |

The remaining 14 (maintenance, breaker, comment, note, plain field edits) get
nothing — they concern one asset only.

`reassignFilteredTo()` and the `person` field edit are deliberately **left
alone** in this phase: users aren't assets yet, so their names are still their
identity. Phase 2 picks them up.

The existing `room` field on allocation entries stays. It becomes a display
fallback for rows written before this change; new rows resolve `toId` at render.

### Rendering: the Audit tab gets two sections

**Eric's call: contents activity, collapsed.**

1. **This asset's history** — expanded. `assetLabel === asset.label` (its own
   edits) plus entries whose `relatedIds` include its label (things moving in and
   out, allocations, circuits). One merged, reverse-chronological list.

2. **Activity on contents** — collapsed, with a count. Entries whose `assetLabel`
   is in `descendantsOf(asset)`. A serial correction on a computer in Room 101,
   visible from the room without drowning the room's own history.

Deliberately **not room-specific.** Section 1 needs no type test at all, and
section 2 keys off `descendantsOf()`, which is already the Contents tab's
mechanism — so a Building shows its rooms' activity and a Campus its buildings',
for free. Gating this on `type === "Room"` would be the hardcoded-type-comparison
pattern the registry exists to prevent.

### Wording: `describeAuditFor(entry, viewerLabel)`

`describeAudit(entry)` writes from the subject's point of view ("Parent changed
from Room 101 to Room 205"). Read from Room 101 that's backwards. So:

```js
// describeAudit() reads an entry as its own asset's history. Seen from an
// associated resource the subject is someone ELSE, and the direction inverts --
// the same move is "moved out" from one room and "moved in" at the other.
// Falls through to describeAudit() whenever the viewer IS the subject, so every
// existing call site is unchanged.
function describeAuditFor(entry, viewerLabel, assets) { ... }
```

Yielding, on Room 101: `BCA0001 (Dell OptiPlex) moved out → Room 205`, and on
Room 205: `BCA0001 (Dell OptiPlex) moved in ← Room 101`.

The subject's name comes from `nameOf()` on the asset found by label, **falling
back to the bare label when it isn't found** — audit entries deliberately outlive
the assets they describe, so a permanently deleted asset's move must still render.

### Performance

The audit log is append-only and never pruned (`CLAUDE.md` lists pruning as
deferred). Section 2 would otherwise scan the whole log per render. Build one
index in a `useMemo` keyed on `[auditLog, assets]`:

```js
// label -> entries, built once per audit/asset change rather than filtered per
// render: the log only ever grows, and the Contents section asks it once per
// descendant.
const auditByLabel = useMemo(() => { ... }, [auditLog, assets]);
```

Not premature — it's the difference between one pass and one pass per descendant.

### Backfill

**Eric's call: best-effort, structure over exact fidelity — it's sample data.**

The constraint: **AuditLog has no rewrite path.** `doPost` only ever calls
`appendNewRows_` on it, so a backfill cannot go through the API at all.

- **Recommended:** a one-off `backfillAuditIds_()` function in the Apps Script
  editor, run once from the editor. Reads Assets + AuditLog, resolves names to
  labels, writes the three columns back. No new endpoint, no permanent surface.
- **Rejected:** a new `op` in `doPost` — a permanent API surface for a one-time
  job, on the endpoint where the 2026-08-21 data-loss incident happened.
- **Rejected:** a PowerShell script against `SHEET_API_URL` like the v9
  migration — needs the rejected endpoint to exist.

Matching rules:

| Entry | Match |
|---|---|
| `field === "Parent"` | `from`/`to` against `nameOf()` of every asset; `"Unassigned"` → `""` |
| `allocated`/`unallocated` | `room` against every Room's `room` |
| `circuit_edited`, "Rooms served" | comma-split names → room labels |
| everything else | leave blank |

On an ambiguous name, take the first match. **This can attribute an entry to the
wrong same-named room** — accepted, because the current sheet is sample data and
a well-formed structure matters more than which "Kitchen" a fake move points at.
Worth re-reading this line before running anything similar against real history.

Also update `MOCK_SNAPSHOT` by hand with a few id-carrying audit entries, so
Sandbox has fixture data matching the new shape (per the Sandbox section of
`CLAUDE.md`) and the whole feature can be built before any redeploy.

### Deploy

`SCRIPT_VERSION` → `"v23"` and `FRONTEND_SCRIPT_VERSION` to match, in the same
commit. Ships as one deploy: the `appendNewRows_` header fix, the three columns,
and the backfill run.

**Effort: M–L.**

---

## Phase 2 — Users as assets

**Eric asked: same chunk, or separate? Recommendation: separate, and phase 1
makes phase 2 cheap rather than duplicated.**

Four reasons:

1. **No rework.** `relatedIds` holds asset labels and knows nothing about types.
   When a user becomes an asset, its label goes in the same array and the Audit
   tab renders it with no change. The plumbing is built once. This is the whole
   reason to name the field `relatedIds` and not `relatedRoomIds`, and to keep
   the two Audit sections type-agnostic — the sequencing only pays off if phase 1
   is written generically, which is what's specified above.

2. **It isn't the same kind of change.** `person` is a slash-joined *multi-value*
   string (`"Jane Smith/Bob Lee"`). Turning that into asset references is a
   many-to-many, not the single-valued `parentId` collapse — structurally it's
   the `LockKeys` problem `DOORS_LOCKS_KEYS_NOTES.md` already flags as needing
   its own join-table design. Phase 1 is "add three columns to one tab."

3. **Two schema changes in one deploy means ambiguous blame.** Each phase needs
   its own paste-and-redeploy. This repo has a documented near-destructive
   frontend/backend skew (v18) and an unexplained data-loss incident, and the
   standing ritual is one change per deploy so the version check means something.

4. **Phase 1 delivers the stated example on its own.** "Move a computer from Room
   A to Room B and see it from either room" is done at the end of phase 1.

Phase 2 sketch (not scoped in detail here):

- `User` registry entry with `nameField: "personName"`, `parentTypes: []`.
- `person` becomes `personIds` — an array of user labels, the app's first
  many-to-many between assets. `UserField` becomes a chip picker over User
  assets; it already tolerates unmanaged names, which is the migration path.
- A read-time adopter in `loadData()`'s map — same trick as
  `adoptLegacyParentage()` — so old name strings resolve without a migration
  script and the same build is correct against a migrated and an un-migrated
  sheet.
- `usersList` (managed list) retires into the asset list.
- Users get a detail page with all the standard tabs, including Audit, for free.

**Effort: L–XL**, mostly the many-to-many and the `person` migration.

## Phase 3 — user history

Falls out of the two above. `reassignFilteredTo()` and the `person` field edit
start calling `relate()` with user labels, and a user's Audit tab already renders
"BCA0001 assigned ← Jane Smith". **Effort: S.**

### Optional 1.5, and why it isn't recommended

A name-string filter would give a rough user history in phase 1 without waiting
for phase 2 — cheap, and genuinely useful for offboarding. But it builds a second
surface with different semantics that phase 2 then has to migrate, and it
re-introduces name-matching as a lookup mechanism in the same change whose entire
premise is that name-matching is the bug. Ship it only if the user view is needed
before phase 2 realistically lands.
