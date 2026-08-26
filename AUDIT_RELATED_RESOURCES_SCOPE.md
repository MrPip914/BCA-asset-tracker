# Audit entries on associated resources — scope

**Status:** **Phase 1 BUILT** (2026-08-26), verified in Sandbox in a real browser; backend
v27 undeployed. Phases 2-3 still scoped only. Eric's calls recorded inline.
**Rebased onto main 2026-08-26** (v23→v26: the generic `name` field, type ids, the
type editor, six deleted columns, `deploy.mjs`). Both findings below survived that
intact; what changed around them is marked **[v26]**.
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
array. So on the live sheet — which is not empty — adding a `related` column to the header array would append values into a column whose header
cell is still blank, and it would read back as `obj[""]` and vanish.

It would fail **silently**, and the `SCRIPT_VERSION` / `FRONTEND_SCRIPT_VERSION`
check would not catch it: both versions would match while the ids quietly went
nowhere. That is the same class of failure the version check exists for, in the
one spot the version check can't see.

**[v26] This is now the ONLY tab with this problem, which makes it easier to
forget.** v25 established that `ASSET_FIELDS` *is* the schema — `writeTable_`
clears its tab and rewrites the headers every save, so adding a column there is
self-applying and dropping one deletes it. AuditLog is the one tab not written
that way. So the mental model that now holds everywhere else ("edit the field
list, the sheet follows") is precisely wrong here, and silently so.

**Fix:** make `appendNewRows_` reconcile the header row — if the stored one is
narrower than `headers`, rewrite it. Three lines, and it makes every future audit
column safe instead of just this one.

```js
const storedWidth = lastRow === 0 ? 0 : sheet.getLastColumn();
if (storedWidth < headers.length) {
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
}
```

**[v26] Unit-test it in `test-backend-fields.js`.** That file exists because
Sandbox never contacts Apps Script and the live backend needs a sign-in, so a
backend write path is structurally untestable in the browser. A header-reconcile
bug is exactly the kind that would otherwise only surface in production, on the
one table that can't be rewritten to fix it.

---

## Phase 1 — ids on audit entries, and the associated-resource view

### Data shape

**One** new field on an audit entry, **one** new column at the **end** of the
AuditLog header array (order matters — see the trap above):

| Field | Type | Meaning |
|---|---|---|
| `related` | comma-joined `label:role` pairs | Every asset this entry is also about, and how. |

e.g. `BCR0002:from,BCR0005:to` for a move, or `BCR0005:at,BCU0001:assigned` for
an asset created in a room and given to someone.

**Roles, not a bare list of ids** — this is the one revision Eric's question
forced, and it is much cheaper now than in phase 2:

- `from` / `to` — a move out of / into this asset
- `at` — this asset was simply where it happened (created, archived, deleted)
- `serves` / `feeds` — a circuit's rooms served, and the sub-panel it feeds
- `assigned` / `unassigned` — phase 2, a person gaining or losing an asset

A bare list can answer *"does this entry concern me"* but not *"in what way"*,
and the two views of one entry need different wording — "created here" read from
a Room, "assigned to Jane" read from a person, from the identical row. In phase 1
every entry involves only one *kind* of reference, so a single `fromId`/`toId`
pair would have been enough and the gap would not have shown up until users
landed — at which point the fix means revisiting the history log a second time.
That is the one table in this app with **no rewrite path** (see Backfill below),
so a second pass there is the expensive kind of mistake.

It is already needed in phase 1 regardless, in a smaller way: a circuit entry can
name both the rooms it serves and the sub-panel it feeds — two different
relationships in one row.

Encoding the role alongside the id also **removes** the separate `fromId`/`toId`
columns proposed earlier, since a role already says which direction a reference
points. Three new columns collapse to one — the role-tagged version is the
simpler design, not the more elaborate one.

Comma-joining matches `Circuit.roomsServed`, which already stores a list of
labels in one cell. Labels are `BCA####`-shaped so the `:` separator is
unambiguous; a label validator should keep it that way.

### One helper, so no call site can forget

Building `label:role` pairs by hand at 10 call sites is exactly the kind of
invariant this codebase keeps getting bitten by when it's restated per site (see
the `nameOf()` entry in `CLAUDE.md` — the same ladder hand-written at four sites,
already drifted at three). So it gets a function:

```js
// The asset references an audit entry is about, each tagged with the role it
// plays -- "from"/"to" for a move, "at" for where something happened,
// "serves"/"feeds" for a circuit, "assigned"/"unassigned" for a person.
//
// The role is what lets ONE row read correctly from every asset it names: a
// created-in-a-room-and-given-to-someone entry is "created here" from the room
// and "assigned to Jane" from the person. A bare id list can only say that the
// entry is relevant, which is not enough to word it.
//
// Falsy ids drop out, so a call site can pass an unset parent without guarding.
function relate(pairs) {
  return Object.entries(pairs)
    .flatMap(([role, ids]) => (Array.isArray(ids) ? ids : [ids]).filter(Boolean).map(id => `${id}:${role}`))
    .join(",");
}
```

Used as `{ ...stamp, action: "edited", related: relate({ from: oldParent, to: newParent }) }`.

### Call sites to update (~10 of 24)

| Site | Action | Related |
|---|---|---|
| `saveDraft()` edit, `parentId` key | `edited` | `{ from: oldParent, to: newParent }` |
| `saveDraft()` add | `created` | `{ at: draft.parentId }` |
| `archiveAsset` / restore / `deleteAsset` | `archived`/`restored`/`deleted` | `{ at: parentId }` |
| `duplicateAsset()` | `created` | `{ at: copy.parentId }` |
| `moveFilteredTo()` (bulk) | `edited` | `{ from, to }` |
| `saveAllocation()` | `allocated` | `{ to: roomId }` |
| `removeAllocation()` | `unallocated` | `{ from: roomId }` |
| `addCircuit()` | `circuit_added` | `{ serves: roomsServedIds, feeds: feedsPanelLabel }` |
| `saveCircuitEdit()` rooms-served diff | `circuit_edited` | `{ serves: union(old, new) }` |
| `deleteCircuit()` | `circuit_removed` | `{ serves: roomsServedIds }` |

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
   edits) plus entries whose `related` names it (things moving in and
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

The viewer's own **role** in the entry is what picks the wording — `from` reads
"moved out", `to` reads "moved in", `at` reads "created here", `assigned` reads
"assigned to". So on Room 101: `BCA0001 (Dell OptiPlex) moved out → Room 205`,
on Room 205: `BCA0001 (Dell OptiPlex) moved in ← Room 101`, and on Jane, from an
entry that names her *and* a room: `BCA0001 (Dell OptiPlex) assigned to you`.

The subject's name comes from `nameOf()` on the asset found by label, **falling
back to the bare label when it isn't found** — audit entries deliberately outlive
the assets they describe, so a permanently deleted asset's move must still render.

**[v26] Two simplifications from main.** `nameOf()` is now just
`asset.name || asset.label` rather than a per-type ladder, so there is no naming
rule left to get wrong here. And an entry's `assetType` now holds a type **id**,
not a name — so display goes through `typeNameOf(entry.assetType, typesList)`,
and renaming a type no longer strands the entries logged under its old name. The
same id reasoning this document applies to rooms, applied one level up, already
shipped.

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
  labels, writes the `related` column back. No new endpoint, no permanent surface.
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

**[v26] Expect a lower match rate than this table implies.** Two things on main
work against it. The six columns deleted in v25 mean a place's name now lives only
in `name`, so matching is against that one field rather than `room`/`building`/
`campus` — fine in itself. But v23's *first* name backfill was broken, and
`hasMisadoptedName()` — the repair that could detect a wrong one — was deleted with
those columns. So some live place names may simply be wrong, and an audit row
naming the old value will not match anything. It fails the safe way (no id
written, entry stays invisible) rather than mis-filing, which is the right failure
for a best-effort pass.

**[v26] The one-off function now ships with the deploy.** `deploy.mjs` pushes the
whole `AssetTrackerSync.gs` via clasp, so `backfillAuditIds_()` is uploaded as part
of the v27 deploy and is then run once from the editor — no separate paste step.
It can't be invoked *by* `deploy.mjs` (that only pushes, versions and verifies), so
running it stays a deliberate manual act, which for a one-shot data rewrite is the
property you want. Leave it in place afterwards as inert, or strip it in a later
version; don't wire it to a trigger.

Also update `MOCK_SNAPSHOT` by hand with a few id-carrying audit entries, so
Sandbox has fixture data matching the new shape (per the Sandbox section of
`CLAUDE.md`) and the whole feature can be built before any redeploy.

### Deploy — and a sequencing decision that comes first

**This is `v27`, not `v23`.** The original draft said v23; main has since shipped
v23, v24, v25 and v26. Left uncorrected, `deploy.mjs` would have **refused the
deploy outright** — it compares the repo's `SCRIPT_VERSION` against the live one
and dies on a downgrade, because an older backend rewrites sheet tabs from its own
shorter field list and drops columns a newer one added. That guard exists because
it already happened once (v24 live, v22 pushed over it). Working the guard is the
guard doing its job; the number simply has to be right.

**[verified 2026-08-26] v26 is live.** An earlier draft of this section said to
deploy v26 first, on the strength of a line in `CLAUDE.md` that said it was
undeployed. Fetching the `/exec` URL says otherwise — it reports `v26`, and it
reports the version even on the unauthenticated `authFailed` response, so the
check takes a second and needs no sign-in. There is no sequencing gate: v27 builds
straight on a live v26. Recorded here because the retracted advice was confidently
written, and the file it came from carries an explicit warning against trusting
exactly that kind of line.

Then v27 ships as one deploy: the `appendNewRows_` header reconcile, the `related`
column, and the backfill run. `SCRIPT_VERSION` → `"v27"` and
`FRONTEND_SCRIPT_VERSION` to match, in the same commit.

**Effort: M–L.**

---

## Phase 2 — Users as assets  [re-estimated **M–L**, was L–XL]

**Eric asked: same chunk, or separate? Recommendation: separate, and phase 1
makes phase 2 cheap rather than duplicated.**

Four reasons:

1. **No rework.** `related` holds asset labels and knows nothing about types.
   When a user becomes an asset, its label goes in the same column with an
   `assigned`/`unassigned` role and the Audit tab renders it with no change. The
   plumbing is built once. That is the whole reason the column is generic rather
   than room-shaped, why the role vocabulary is open-ended, and why both Audit
   sections avoid type tests — the sequencing only pays off if phase 1 is written
   this way, which is what's specified above. **Eric's multi-association question
   is what pinned this down**: without roles, phase 2 would have had to revisit
   the one table that cannot be rewritten.

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

**[v26] The type editor did half of this already.** The original L–XL assumed
building a User type in code. Main's type editor now creates a type from the UI —
name, icon, what it can sit inside, and its own custom fields — and every asset
already has a generic `name`, so a User record with its own detail page and the
standard tabs (Audit included, since that is a common tab) needs **no code at
all**. Note the editor deliberately cannot add *modules*, because a tab body needs
a render branch and can't be switched on by data — but users need no module, only
the common tabs.

What's left is the part that was always the real work, and it is unchanged: one
asset can have several users, so `person` becomes a many-to-many. That is why this
is still M–L rather than S, and still its own phase.

Phase 2 sketch (not scoped in detail here):

- A `User` type — **created in the type editor, not in the registry**: an icon, no
  parent types, and its name held in the generic `name` field like every other
  asset. Only a type needing a *module* still requires a registry entry.
- `person` becomes `personIds` — an array of user labels, the app's first
  many-to-many between assets. `UserField` becomes a chip picker over User
  assets; it already tolerates unmanaged names, which is the migration path.
- A read-time adopter in `loadData()`'s map, so old name strings resolve without a
  migration script and one build stays correct against a migrated and an
  un-migrated sheet. **[v26] Note the precedents it would follow —
  `adoptLegacyParentage()` and `adoptLegacySubType()` — were deleted in v25 once
  nothing was left to adopt.** So this is the pattern to copy, not a helper to
  extend; and it comes with the reminder that an adopter is temporary by design and
  gets removed on the version that deletes the column it read.
- `usersList` (managed list) retires into the asset list.
- **[v26] Type ids make this safer than it would have been.** `asset.type` holds an
  id, not a name, so a User type can be renamed later — to "Person", "Staff" —
  without rewriting a single asset or stranding any audit entry logged under the
  old word.

**Effort: M–L**, essentially all of it the many-to-many `person` migration — the
record, the page and the tabs come from the type editor.

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
