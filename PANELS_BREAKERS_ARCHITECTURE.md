# Panels & Breakers Module — Architecture Design (Finalized)

Scoped to electrical panels and breakers only. Every structural decision here (ID
scheme, FK pattern, audit actions, UI shape) is chosen so Doors/Locks/Keys can reuse
it later without a redesign — see section 7.

## 1. Entity model

Three new entity types, one level deeper than anything the app currently models:

- **Panel** — an Asset (`type: "Electrical Panel"`), same as any other asset today.
  Lives in the main asset list, has a room/building, comments, changes, audit trail —
  no special handling needed at this level. A panel can also be *fed by* another
  panel's breaker (sub-panel feeds — see section 3).
- **Breaker** — a new child entity scoped to a panel. Not an Asset itself (doesn't
  show up in the main list, isn't independently archived) — but has its own identity
  that outlives edits: it gets swapped, and things (circuits) point *at* it.
- **Circuit** — a new child entity scoped to a breaker (not directly to the panel).
  The chain goes two levels deep: Circuit → Breaker → Panel. A circuit either serves
  one or more rooms, **or** feeds a downstream sub-panel — not both.

### Why breakers/circuits need real IDs, not array position

Breakers and circuits get swapped/moved independently, and other records reference
them (a circuit points at a breaker's id). Array position can't serve as identity
once things move. So:

- Every Breaker and Circuit gets a generated `id` (UUID), same place `label` gets
  generated for new assets today.
- A "move" or "swap" is a field update on that ID (`circuit.breakerId = newId`), not
  a delete-from-array-A / insert-into-array-B operation.

## 2. Physical slot modeling (breakers)

Real panels have numbered physical slots in two columns. Three cases need to be
representable:

- **Standard single-pole breaker**: occupies one slot.
- **Double-pole breaker** (240V — HVAC, sub-panel feed, range, etc.): occupies two
  *stacked* slots in the same column (e.g. slots 1 and 3, not 1 and 2).
- **Tandem breaker**: two independent single-pole breakers physically sharing one
  slot's space (half-height). Both are `poles: 1`, but they're not standard single
  breakers — they share a slot, which pole count alone can't express.

**Decision:** each Breaker stores `slots` as an explicit list of slot numbers it
occupies, rather than a single position + an inferred second slot. This is the one
representation that covers all three cases without a special-cased inference rule:
single-pole is `slots: [5]`, double-pole/sub-panel feed is `slots: [1, 3]`, and each
half of a tandem pair is `slots: [7]` — same slot number, two separate breaker rows.

A `mount` field (`"full"` or `"tandem"`) distinguishes "one breaker alone in slot 7"
from "two tandem halves sharing slot 7," since pole count can't disambiguate that on
its own.

**Validation rule** (enforced in app logic, not by the sheet): a slot number may
appear in more than one breaker's `slots` list only if every breaker sharing it has
`mount: "tandem"`. Any other overlap is a data error the UI should block on add/edit.

## 3. Sub-panel feeds

A breaker's circuit can feed a downstream sub-panel instead of serving rooms
directly. Modeled on the **Circuit**, not the Breaker or Panel:

- `Circuit.feedsPanelLabel` — set when this circuit is a feed to another Panel asset,
  instead of (not in addition to) `roomsServed`.

**"Fed from" is computed, not stored redundantly on the downstream panel.** The app
already has a precedent for this: `inferBuilding()` derives a device's building
transitively through its room rather than storing it directly. Apply the same
principle here — a panel's "fed from" info (which upstream panel/breaker feeds it)
is found by searching circuits for `feedsPanelLabel === thisPanelLabel`, computed at
render time, not written to the Panel asset itself. This avoids two places that can
drift out of sync.

**Cascade rule:** deleting a panel that is currently fed by an upstream circuit (i.e.
some circuit's `feedsPanelLabel` points at it) should warn, same pattern as blocking
deletion of a breaker that still has circuits attached (section 4).

## 4. Sheet schema

Following the existing pattern in `AssetTrackerSync.gs` (Comments/Changes/Allocations/
Maintenance are each their own tab, keyed by parent). Two new tabs:

**`Breakers` tab**

| column | notes |
|---|---|
| `id` | UUID, generated on creation |
| `panelLabel` | FK → Panel asset's `label` |
| `slots` | comma-joined list of slot numbers, e.g. `"1,3"` or `"7"` |
| `poles` | 1 or 2 |
| `mount` | `"full"` or `"tandem"` |
| `ampRating` | e.g. 20, 30 |
| `status` | Active / Spare / Faulted / Retired |
| `serial` | if tracked |
| `installedDate` | |
| `notes` | freeform |

**`Circuits` tab**

| column | notes |
|---|---|
| `id` | UUID |
| `breakerId` | FK → Breaker's `id` (chained through the breaker, not the panel) |
| `label` | e.g. "Circuit 14" or a custom name |
| `description` | freeform — what it feeds |
| `roomsServed` | comma-joined list of Room asset labels — set when this circuit serves rooms directly |
| `feedsPanelLabel` | FK → a downstream Panel asset's `label` — set when this circuit feeds a sub-panel instead. Mutually exclusive with `roomsServed`. |

Read/written the same way Comments etc. are today: `readTable_` / `writeTable_` in
the `.gs` file. On `doGet`, breakers get filtered onto their panel by `panelLabel`
the same way comments are; circuits get filtered onto their breaker by `breakerId`.

## 5. Referential integrity rules

Enforced in `doPost` / the app's action handlers, same as any Sheets-backed rule
today:

- **Deleting a breaker with circuits attached**: block, same pattern as blocking
  hard-delete of a non-archived asset.
- **Deleting a panel with breakers attached**: same rule, one level up.
- **Deleting a panel that's fed by an upstream circuit**: warn (see section 3).
- **Moving a circuit**: destination breaker must belong to the same panel by
  default; moving to a different panel is a real but rare action — confirm rather
  than block.
- **Slot overlap**: see section 2's validation rule.

## 6. Audit log extensions

Reuse the existing `auditLog` / `describeAudit()` mechanism. New `action` values:

- `"breaker-added"`, `"breaker-swapped"` (`from`/`to` = old/new serial),
  `"breaker-removed"`
- `"circuit-added"`, `"circuit-reassigned"` (`from`/`to` = old/new breaker id,
  resolved to human-readable slot in `describeAudit()`), `"circuit-removed"`
- All entries key off `assetLabel` = the panel's label, so they surface in the
  panel's existing Audit tab with no new UI plumbing.

**Decision:** no separate queryable breaker-replacement history table. The audit
log's freeform description of each swap (old serial → new serial, timestamp, author)
is sufficient — this was confirmed as unnecessary complexity for now.

## 7. Frontend state shape

Breakers/circuits travel as part of the panel's asset object, same as `comments`/
`changes` do today: `panel.breakers = [{ id, slots, poles, mount, ..., circuits: [{
id, label, ... }] }]`. Matches every existing relationship pattern in the app —
no new top-level state needed in `persist()`.

## 8. UI plan

- Panel asset detail gets a new **Breakers** tab, alongside Details/Comments/Changes/Audit.
- Table resembling a real panel schedule: slot(s), amp rating, mount/poles, status,
  each row expandable to its circuits. Tandem pairs sharing a slot render grouped
  under that slot number.
- **Add Breaker**: form (slots, amp rating, poles, mount, status).
- **Swap Breaker**: distinct action from "edit" — prompts for new serial/rating,
  keeps the same `id` and slot(s), logs `breaker-swapped`.
- **Add Circuit** (under a breaker): form (label, description, then either rooms
  served OR a downstream panel — mutually exclusive fields, UI should make that
  an either/or choice, not two open fields).
- **Move Circuit**: dropdown of other breakers on the same panel (or, with
  confirmation, another panel) + submit; logs `circuit-reassigned`.
- Build as one reusable `ChildEntityTable`-style component rather than bespoke JSX,
  since Locks under Doors will need the identical list/add/edit/move shape later.

## 9. Generalizing to Doors/Locks/Keys later

Carries over directly: the two-tab FK-keyed pattern, UUID identity, swap-as-distinct-
action, audit log reuse, and the generic child-entity UI component.

Does **not** carry over: keying is many-to-many (one key opens many locks), not a
tree like Panel→Breaker→Circuit. That needs its own join-table design
(`LockKeys`) and its own facility-wide view when that module is built — not to be
bolted onto this tree pattern.

## Decisions log

| # | Question | Decision |
|---|---|---|
| 1 | How to represent breaker slot position, incl. double-pole and tandem | Explicit `slots` list + `mount` field (section 2) |
| 2 | Do breakers feed sub-panels? | Yes — modeled via `Circuit.feedsPanelLabel`, computed reverse lookup, not a stored field on Panel (section 3) |
| 3 | Queryable breaker-replacement history beyond the audit log? | Not needed — audit log entries are sufficient (section 6) |
