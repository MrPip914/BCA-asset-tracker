# Panels & Breakers — Implementation Spec (for Claude Code)

Companion to `panels-breakers-architecture.md` (read that first for the reasoning —
this doc is the actionable build spec). Scope: Panels and Breakers/Circuits only.
Doors/Locks/Keys are explicitly out of scope for this pass — do not build them now,
but do not preclude them either (see "Design constraints to preserve" below).

## Files touched

- `AssetTrackerSync.gs` — new tabs, new read/write logic, new validation.
- `index.html` — new asset type, new state shape, new Breakers tab UI, new actions.
- `CLAUDE.md` — update after implementation to document the new module (follow the
  existing style/sections already in that file).

## 1. Backend changes (`AssetTrackerSync.gs`)

### New constant

Add `"Electrical Panel"` to wherever asset types are enumerated on the frontend
(this file doesn't need to know asset types — it's schema-agnostic at the Assets
tab level already via `ASSET_FIELDS`).

### New sheet tabs

Add to `SHEET_NAMES`:
```js
breakers: "Breakers",
circuits: "Circuits",
```

### New field lists

```js
const BREAKER_FIELDS = ["id", "panelLabel", "slots", "poles", "mount", "ampRating", "status", "serial", "installedDate", "notes"];
const CIRCUIT_FIELDS = ["id", "breakerId", "label", "description", "roomsServed", "feedsPanelLabel"];
```
`slots` and `roomsServed` are comma-joined strings in the sheet (same convention the
app already uses for `peripherals`) — join/split at the boundary, not stored as
arrays in the sheet.

### `doGet` changes

- Read `breakerRows = readTable_(SHEET_NAMES.breakers, BREAKER_FIELDS)` and
  `circuitRows = readTable_(SHEET_NAMES.circuits, CIRCUIT_FIELDS)`.
- When assembling each asset, if `a.type === "Electrical Panel"`, attach:
  ```js
  breakers: breakerRows.filter(b => b.panelLabel === label).map(b => ({
    ...b,
    slots: b.slots ? String(b.slots).split(",").map(s => s.trim()) : [],
    circuits: circuitRows.filter(c => c.breakerId === b.id).map(c => ({
      ...c,
      roomsServed: c.roomsServed ? String(c.roomsServed).split(",").map(s => s.trim()) : [],
    })),
  }))
  ```
  (Mirrors the existing `comments`/`changes`/`allocations`/`maintenanceItems`
  assembly block already in `doGet` — same shape, one more level of nesting.)

### `doPost` changes

- Flatten `panel.breakers` and each breaker's `circuits` out of the assets array
  the same way `comments`/`changes`/etc. are flattened today, joining `slots` and
  `roomsServed` back into comma strings before writing.
- Call `writeTable_(SHEET_NAMES.breakers, BREAKER_FIELDS, breakerRows)` and
  `writeTable_(SHEET_NAMES.circuits, CIRCUIT_FIELDS, circuitRows)`.
- **Validation before write** (reject the whole request with an error message if
  violated — same pattern as the existing `try/catch` → `{ ok: false, error }`
  response in `doPost`):
  1. No breaker may be deleted (i.e. present in the *previous* snapshot but absent
     from this one) while it still has circuits in this payload referencing its
     `id`. *(Requires reading current state before overwrite to detect deletions —
     if that's too heavy for a first pass, this check can instead be done
     client-side before `persist()` is called; note which approach you take in
     `CLAUDE.md`.)*
  2. Within a single panel, a slot number may appear in more than one breaker's
     `slots` only if every breaker sharing it has `mount === "tandem"`.
  3. A circuit must have exactly one of `roomsServed` (non-empty) or
     `feedsPanelLabel` (non-empty), not both, not neither.

## 2. Frontend changes (`index.html`)

### Asset type

Add `"Electrical Panel"` to the asset type list and to `fieldAppliesTo()` /
`TYPE_ONLY_FIELDS` handling — it behaves like Room/Building in that it doesn't need
brand/model/serial, but does need room/building placement like a device.

### State

No new top-level `useState` — breakers/circuits live nested inside each panel asset
object, consistent with `comments`/`changes` (see architecture doc section 7).
`persist()` doesn't need new parameters.

### New UI: Breakers tab

Add `"breakers"` as a `detailTab` value, but only render the tab itself when
`asset.type === "Electrical Panel"` (same conditional-tab pattern already used for
type-specific fields elsewhere in the file).

- Table: slot(s), amp rating, poles/mount, status — sorted by lowest slot number.
  Rows sharing a slot (tandem) render grouped together.
- Expand a breaker row to show its circuits (label, description, and either rooms
  served or "Feeds → [Panel label]").
- **Add Breaker** modal: slots (allow entering one or two numbers), amp rating,
  poles, mount, status.
- **Swap Breaker** action (separate button from edit): prompts for new
  serial/rating/installedDate; keeps `id` and `slots`; on save, call `logAudit()`
  with `action: "breaker-swapped"`, `from`/`to` = old/new serial.
- **Add Circuit** modal (scoped to a breaker): label, description, then a toggle —
  "Serves rooms" (multi-select of Room assets) vs. "Feeds sub-panel" (dropdown of
  Electrical Panel assets) — mutually exclusive, not two open fields.
- **Move Circuit** action: dropdown of other breakers (same panel by default;
  cross-panel move requires an extra confirm step per architecture doc section 5).
  On save, `logAudit()` with `action: "circuit-reassigned"`.
- **Delete Breaker** / **Delete Circuit**: block delete client-side if the breaker
  still has circuits (mirrors existing confirm-delete patterns like
  `confirmDelete`/`confirmArchive`), matching the backend validation in section 1.

### Reusable component

Build the breaker list/add/edit/move UI as a generic, parameterized component
(columns + item list + callbacks) rather than one-off JSX — this will be reused for
Locks under Doors in a future pass. Name it something like `ChildEntityTable` so its
purpose is discoverable later, and keep it free of any panel/breaker-specific
knowledge (that lives in how the caller configures it).

### Audit descriptions

Extend `describeAudit()` to handle the six new `action` values listed in the
architecture doc section 6. For `circuit-reassigned`, resolve breaker ids to a
human-readable slot number/panel label rather than showing raw ids.

## 3. Design constraints to preserve (for future Doors/Locks/Keys work)

Do not violate these while building Panels/Breakers, even though they're not used
yet — they're what makes the next module a reuse rather than a rewrite:

- Keep the `ChildEntityTable` component generic (no panel/breaker-specific logic
  baked in).
- Keep the "computed, not stored" principle for derived relationships (used here
  for a panel's "fed from" — see architecture doc section 3), the same principle
  already used for `inferBuilding()`.
- Keep swap/move as distinct actions from generic field edits, both logging through
  `describeAudit()` rather than a parallel history mechanism.

## 4. Definition of done

- [ ] `Breakers` and `Circuits` tabs created automatically on first run (same as
      other tabs today).
- [ ] Creating an Electrical Panel asset, adding breakers (including a tandem pair
      and a double-pole breaker), and adding circuits (both room-served and
      sub-panel-feed) round-trips correctly through save/reload.
- [ ] Swapping a breaker preserves its `id` and slot(s), and produces a correct
      audit entry.
- [ ] Moving a circuit to a different breaker on the same panel produces a correct
      audit entry and the circuit no longer appears under its old breaker.
- [ ] Deleting a breaker with circuits attached is blocked, both client-side and
      server-side.
- [ ] Two non-tandem breakers cannot be saved sharing the same slot number.
- [ ] A circuit cannot be saved with both `roomsServed` and `feedsPanelLabel` set,
      or neither.
- [ ] `CLAUDE.md` updated to document the new module, following its existing
      style and section structure.
