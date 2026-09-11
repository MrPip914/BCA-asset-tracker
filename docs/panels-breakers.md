# Electrical panels, breakers and circuits

*Read before touching panels, breakers, circuits, the panel diagram or the printed door card.*

*Moved out of `CLAUDE.md` on 2026-09-11, verbatim. See `CLAUDE.md` for the rules that apply to every change.*

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
    cycles — and since every save posts the entire state snapshot (see Persistence model in
    `docs/architecture.md`),
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
