# Maintenance schedules and work entries

*Read before touching the Maintenance tab, work/change entries, or the completion link between them.*

*Moved out of `CLAUDE.md` on 2026-09-11, verbatim. See `CLAUDE.md` for the rules that apply to every change.*

**"Change type" reads "Work type", and the button is "Log work" (2026-09-10).** LABELS ONLY.
The stored field is still `changeType`, the managed list is still `changeTypes`, and the sheet
column is unchanged -- renaming any of those is a schema change that would drop every existing
value on the next write, and it would buy nothing, since the label people read is the whole
point of the rename. Anything user-visible moved: the field, its picker title, its gear
("Manage work types"), the manager modal and its placeholder, the completion modal's copy of
the same field, the delete confirmation, and the Excel export's column header.
- Sentence case ("Log work", not "Log Work") to match every other button in the app -- "Add
  task", "Log completion", "Add comment".
- The edit dialog reads "Edit work entry" rather than "Edit work", which would read as a verb.

**Add and Log change are DIALOGS, and a history entry is editable (2026-09-10).** Both
sub-tabs used to open with a permanently expanded form pinned above their list, which pushed
the schedules and the history — the things the tab exists to show — below the fold on every
visit, including the many where nothing was being added. They are now an **Add task** and a
**Log change** button.
- **One dialog serves add AND edit for a change** (`changeModal` = `{ mode: "add" }` or
  `{ mode: "edit", idx }`, with `changeDraft` holding the fields either way). A separate edit
  form would be a second copy of the same fields to keep in step, which this file has been
  bitten by before.
- **Both openers reseed the draft on OPEN**, not only on close, so a cancelled edit cannot
  leave half-typed values waiting in the next dialog — the same rule entering breaker edit
  mode follows.
- **Editing a change is AUDITED, field by field**, exactly as editing a maintenance item is
  and for the same stated reason: it rewrites a record and, unlike adding one, leaves no other
  trail of what it used to say. A save that changed nothing writes no snapshot and no audit
  row.
- **`at` and `by` are never touched by an edit.** They record who first entered this and when,
  which stays true after a correction; the audit row records who changed it. Editing a typo
  must not rewrite provenance.
- **An edit does NOT restamp a linked schedule's `lastPerformed`,** even when the performed
  date is edited, and the *Mark this task performed* checkbox is **hidden in edit mode**.
  Completing is an act with its own opt-in; re-applying it every time someone fixed a typo
  would silently move a due date. `openChangeEdit` therefore never pre-ticks it.
- `openChangeEdit` seeds the date through **`changePerformedOn(ch)`**, not `ch.performedOn` —
  a pre-v34 entry has no such field and seeding blank would blank a real date on save.
- **The maintenance ADD is a dialog; its inline edit was left alone.** Not an oversight —
  only add was asked for, and the two are different flows. Worth revisiting together.
**The site-wide Maintenance tab mirrors an asset's (2026-09-10):** a `HierarchyNav` scope
filter, then **Scheduled** / **History** sub-tabs, then Add task / Log work.
- **It shares `scopeId` with the Assets tab, deliberately.** Narrowing to a building and
  switching tabs keeps you where you were; a second scope would silently widen the view and
  there would be no way to tell which one was in force. The scope now filters Scheduled too,
  which it did not before.
- **History is `allWorkRows`** — every change entry on every active asset, flattened the way
  `allMaintenanceRows` flattens schedules, defaulting to most-recently-performed first (the
  mirror of Scheduled's due-soonest). Its row `idx` is the entry's position in ITS OWN
  asset's `changes` array, never a position in the flattened sorted list — that would address
  the wrong entry the moment anything is re-sorted.
- **A History row opens that asset's History**, via `openDetail(asset, "changes")` — the
  legacy alias, which is exactly what it is for.
- **The two dialogs moved into `renderWorkDialogs()`, called from BOTH views.** They lived
  inside the detail-view return, which is why the site-wide tab could not offer them at all.
  A plain render helper, not a component: it closes over state and setters, so nothing has to
  be threaded. **It must be CALLED, not used as `<renderWorkDialogs/>`** — as a component it
  would remount every render and drop focus out of whatever field was being typed in.
- **`workDialogAssetId` says which asset a dialog writes to, and its THREE states matter.**
  `null` = the open asset (every detail-view case). A string = opened from the main page,
  where `""` means "nothing picked yet" and is what makes the Asset field appear. It is
  deliberately not `selectedId`: setting that would navigate the whole app behind a modal,
  and cancelling would leave you somewhere you never asked to be.
  - The openers use `assetId === undefined ? null : assetId`, NOT `assetId || null`. The
    obvious form collapses `""` to `null`, the dialog reads that as the detail-view case, and
    the Asset picker never appears — which is exactly what happened first time.
- **`AssetPickerField` is `HierarchyBrowserModal` with the predicate opened up** from "Rooms
  only" to "anything not archived". Everything being selectable means you drill with the
  chevron and select with the row body — the two-affordance design that component was built
  around, working as intended rather than by accident.
- **Nothing is pre-selected from the scope.** The scope is always a PLACE, and pre-filling a
  Room when most work is on a device inside it would be wrong more often than right.
- Save is disabled until an asset is chosen, in both dialogs — `workTarget` is the guard, so
  a main-page dialog cannot write to whatever happened to be open last.
**The Change Log is no longer a top-level tab — it is Maintenance › History (2026-09-10).**
The detail tabs are now Details / Maintenance / Comments / Audit, and Maintenance has two
sub-tabs: **Scheduled** (the recurring items) and **History** (what was actually done, i.e.
the entire former Change Log, unchanged). Answering "when is this due" and "what has been
done to it" from two different tabs made the link between them invisible, which is the same
problem `maintenanceId` was added to solve — this finishes it in the navigation.
- **`?tab=changes` still works and must keep working.** `openDetail()` translates it to
  Maintenance + the History sub-tab rather than dropping it, which would silently land on
  Details. Deep links outlive the layout that produced them — the same reason the panel tab
  kept its `"breakers"` key when its label became "Layout". `"changes"` is therefore a valid
  REQUEST forever while no longer being a valid `detailTab` VALUE; those are different things
  and the state's own comment says so.
- **The Maintenance tab's badge counts SCHEDULES, not history**, and keeps its overdue red.
  The badge answers "is there anything I have to do", and a growing count of completed work
  would drown that. Each sub-tab carries its own count.
- **The sub-tabs are styled as pills, deliberately unlike the tab bar above them.** They are a
  division within one tab; matching the bar would read as two competing rows of navigation.
- Implementation note: the two content blocks were NOT moved. Their conditions were narrowed
  (`detailTab === "maintenance" && maintenanceSubTab === "..."`) and a bar rendered above
  them, so the diff is three lines of condition rather than a re-indent of ~400 lines of JSX
  that would have buried any real change inside it.
**Both record types are addressed by their own id, never by array position (2026-09-10).**
A maintenance item got its `id` when work entries began referencing it; a work entry got one
when photos began attaching to it. Same rule, arrived at twice: **an id exists once something
points at the record, and not before.**
- **Why position was defensible until it wasn't.** `writeTable_` rewrites a tab in the order
  the client sent, so position survives a save. What it does not survive is a DELETE: remove
  an earlier entry and every later one shifts up, taking any attachment pointed at it to the
  wrong row. Nothing pointed at a work entry until photos did.
- **`change.id` was deliberately absent before this** — the reasoning is still in
  `CHANGE_FIELDS` — and adding it was a schema change, so it went into v34 while v34 was
  still undeployed, exactly as `performedOn` did. That trick expires the moment a version is
  live: check `node deploy.mjs --status` first.
- **Every handler now takes an id**: `openChangeEdit`, `deleteChange`, `saveChangeEdit`,
  `startEditMaintenance`, `saveMaintenanceEdit`, `openMaintenanceComplete`,
  `submitMaintenanceComplete`, `deleteMaintenanceItem`. The row objects no longer carry an
  `idx` at all, on either the detail lists or the two site-wide tables — so there is no stale
  index left to pass by mistake.
- **`editingMaintenanceIdx` was renamed `editingMaintenanceId`.** It held an id; a name that
  no longer says what the value is has cost this project real time more than once, and is
  treated as a bug rather than a tidy-up.
- **React keys are the ids too**, so deleting a row no longer re-keys every row beneath it.
- **Both are adopted at load** (`m.id || crypto.randomUUID()`, `c.id || crypto.randomUUID()`)
  — a read that fills a blank, reaching the Sheet inside whatever save happens next. No
  migration, and two browsers minting different ids is caught by the revision check.
- `MOCK_SNAPSHOT` stays MIXED: three work entries carry explicit ids, the rest are adopted,
  so both paths are exercised by the fixture rather than only by a unit test.
**A completion is a change-log entry, linked by `change.maintenanceId` (v34).** Marking a
task done and logging a change used to be two unconnected acts: "Mark done today" stamped
`lastPerformed` and wrote one audit row, so what a service visit actually cost, who did it
and what they found had nowhere to go — and a change logged separately had no idea a
schedule existed. The button is now **"Log completion…"**, opening a prefilled form
(`maintenanceCompleteModal`).
- **A maintenance item has a real `id`** — a `crypto.randomUUID()`, like a Breaker or a
  Circuit. Array position cannot serve: items are deleted by index, so removing one
  renumbers every item below it and would re-point every change referencing them.
- **The reference lives on ONE side.** A change names its schedule; a schedule keeps no
  list of its changes. Its history is derived (`changesByMaintenance`, a `useMemo` lifted
  out of the detail render body for the reason `auditIndex` was). Storing both would be a
  second copy to keep in sync, and it is the one that goes stale.
- **A dangling `maintenanceId` is a normal state, not corruption.** Deleting a schedule
  leaves its changes alone — a change records something that actually happened and outlives
  the schedule that prompted it, exactly as audit entries outlive their assets. It renders
  with no badge. No cascade, no cleanup, no repair pass.
- **The prefill is what keeps it one click.** Date is today, change type is `Maintenance`
  where that type still exists (seeded only if it does — the list is user-managed, and
  seeding a value that isn't an option renders a picker showing something it cannot
  re-select). A routine filter clean is still Save and go.
- **The date field is new capability, not just plumbing.** Back-dating a completion was
  previously impossible without hand-editing the schedule, and the audit row's `to` is the
  chosen date rather than always today — a row claiming today would be a lie about when the
  work happened.
- **One `persist()` writes the completion, the change and the audit row.** Every save posts
  the whole snapshot, so splitting it would mean several round trips for one logical act and
  a real chance of the second being rejected as a conflict with the first. Same reasoning as
  `saveBreakerUnit`.
- **The change entry is not separately audited**, consistent with comments and changes: it
  carries its own `at`/`by` and its presence in the Change Log is the record.
- **The Change Log's add form can attach a change to a schedule too** — an optional picker,
  hidden when the asset has no schedules — **and can complete it**, via a *Mark this task
  performed* checkbox with its own date, revealed only once a task is linked.
  - **The checkbox defaults OFF** (Eric's call, 2026-09-10), because the picker's main use is
    attaching a change that ISN'T a completion: parts ordered for next service, or a repair
    the tech found *during* it. Two entries against one schedule, one of them the completion.
    An unwanted stamp is also much harder to notice than a missing one.
  - **Completing is a deliberate tick, not a consequence of linking, and the date is why.**
    A change entry's only date is `at` — when it was *logged*, not when the work happened — so
    an automatic stamp could only ever say "today". Logging a visit from three months ago
    would then push the next due date three months out, which is worse than no link at all:
    it makes an overdue item read healthy. The checkbox carries its own date field for exactly
    the reason the completion modal has one.
  - It can move `lastPerformed` **backwards**, since `nextMaintenanceDue` reads it and nothing
    else. That is correct — recording a visit you hadn't logged yet is the point — and is why
    the date is editable rather than pinned to today.
  - **Ticked with an empty date is refused**, by the disabled-until-valid pattern the form
    already uses. Otherwise the change would log and the schedule would silently not move.
  - It writes the same `maintenance_completed` audit row as the modal, in the same single
    `persist()`, so a completion reads identically in the history whichever door it came
    through. The two paths are now the same operation reached from the schedule or from the
    log; they are kept as separate forms because the entry points differ, not the semantics.
- **`adoptLegacyMaintenanceIds` is a load-time READ that fills a blank**, last in
  `loadData()`'s map chain — not a load-time rewrite. A minted id reaches the Sheet only when
  some save happens for other reasons, inside that same snapshot: no migration, no script.
  **Two browsers can mint different ids for one item, and the revision counters are what make
  that safe** — whichever saves second is refused as a conflict and reloads onto the id the
  first wrote. Without optimistic concurrency this pattern would not be safe.
- The site-wide Maintenance overview gains **no column**: it is for triage, and clicking a
  row already lands on the asset's Maintenance tab where the history is. The Excel export's
  Changes sheet does gain a resolved **Maintenance task** column, since a spreadsheet is
  where anyone would total spend by schedule.
- Covered by `test-backend-maintenance-link.js`, which slices both `doGet` and `doPost` out
  of the .gs as source text. Verified by mutation that all four silent failure modes fail it:
  dropping the column from either header constant, from either per-row projection, or
  re-inlining a header literal at a call site. `MOCK_SNAPSHOT` is deliberately **mixed** —
  two assets carry item ids and linked changes (one with a dangling link), the rest are
  legacy-shaped with neither. A uniform fixture exercises half the code; that is the
  `personIds` lesson.
