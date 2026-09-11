# Linking maintenance completions to the change log

**Status: BUILT on `dev` 2026-09-10, NOT DEPLOYED.** Backend is **v34**, which now also
carries a `performedOn` date on every change entry — folded into v34 rather than cut as
v35, since v34 had never been deployed to any tenant (see CLAUDE.md; do not repeat that
once a version is live).

Two things grew past the plan below, both at Eric's request and in this order, because the
second is what makes the first honest:
1. A linked change can COMPLETE its schedule, via a checkbox that defaults off.
2. Every change carries an editable performed-on date, so work can be written up after the
   fact and still dated correctly. The plan's original "link only" rule was right for the
   data model as it stood — a change had no date but `at`, when it was typed — and stopped
   being right once it had one. Steps 1-4 of
the Sequence below are done and Sandbox-verified end to end; steps 5-6 (the deploys) are
outstanding, and until v34 is live the two new columns are dropped on write — so the link
works in-session and forgets on reload against a real backend. Sandbox is unaffected, as
ever, and is where the whole feature was built.

What Sandbox verified: the prefilled form, one save writing completion + change + audit
together, the service history, the badge, a dangling link rendering no badge, the reverse
picker NOT stamping `lastPerformed`, and a legacy item with no id minting one that survives
a reload with its change still resolving to it. What Sandbox structurally CANNOT verify is
the only thing left: that the columns actually persist through Apps Script.

**It does NOT start from a clean base, and that is the one thing to get right.**
`node deploy.mjs --status` on 2026-09-10 says:

```
  bca     v32
  dev     v33
```

The `dev` branch already carries an undeployed-to-`bca` **v33** (type categories,
required fields, field data types). So v34 will bundle that work with this, and
**`bca` must be taken from v32 straight to v34** whenever it is deployed. Nothing
about this plan changes because of it — but the merge-to-`main` gate now covers
two versions of backend change, not one.

## The problem

Marking a maintenance task done and logging a change are two separate,
unconnected acts today:

- `markMaintenanceDone(idx)` stamps `lastPerformed` with today's date and writes
  one `maintenance_completed` audit entry. That is the whole record. No notes, no
  vendor, no cost, no way to say it was done last Tuesday rather than today.
- `addChange()` writes a real record — change type, vendor, cost, free-text note,
  `at`/`by` — into the asset's `changes` array, which the Change Log tab renders
  and whose costs are totalled at the top of that tab.

So the useful detail about a service visit ends up in a change entry that has no
idea a maintenance schedule exists, while the schedule that actually drove the
visit records only a date. "When was the annual coil clean last done?" is
answerable; "what did it cost, who did it, and what did they find?" is not,
unless someone separately remembered to log a change and someone else remembers
to read both tabs and pair them up by date.

**The fix is one reference**, in the direction the data already runs: a change
entry may name the maintenance item it was performed against. Many changes to one
schedule, over years — the recurring item is the durable thing, each service
visit is an event.

## Decisions taken (Eric, 2026-09-09)

1. **Every completion goes through a prefilled form.** "Mark done today" becomes
   **"Log completion…"**, opening a small modal already filled in (today's date,
   change type `Maintenance` where that type exists, empty vendor/cost/note).
   Save is still one click for a routine filter clean; the fields are simply
   there for the visit that had something worth recording. Every completion
   therefore produces a change-log entry, which is what makes the history
   uniform and worth querying.
2. **The Change Log's add form gets an optional "Maintenance task" picker**, so a
   change logged from that side can be attached to a schedule. Link only — it
   does **not** stamp `lastPerformed`. Marking a task performed stays a
   Maintenance-tab action, because that is where the schedule and its due date
   live and where the consequence is visible.

## Data model

### The link is `change.maintenanceId`, and it needs a real id on the other end

This is another sub-entity reference, and it follows the conventions in
`CLAUDE.md` ("Reference conventions") exactly:

- **A maintenance item gets an `id`** — a `crypto.randomUUID()`, like a Breaker,
  a Circuit or a BreakerType. Array position cannot serve: items are edited and
  deleted by index, so deleting item 0 renumbers every item below it and would
  silently re-point every change entry that referenced them. This is the same
  reasoning that gave Breakers a UUID, and it is the single hardest requirement
  in this plan.
- **A change entry gets a `maintenanceId`** — empty for an ordinary, unattached
  change, which is what every existing row will be.
- **A maintenance item stores no list of its changes.** Its history is derived:
  filter the asset's `changes` for `maintenanceId === item.id`. Storing both
  sides would be a second copy to keep in sync, and it is the one that goes
  stale — the same rule that keeps a panel's "fed from" computed rather than
  stored.
- **Changes deliberately do NOT get an id of their own.** Nothing references a
  change, so a stable handle would be dead weight; the Change Log's own
  delete-by-index keeps working because `writeTable_` rewrites the tab in the
  order the client sent, so position is stable across a round trip.

### A dangling `maintenanceId` is a normal state, not an error

Deleting a maintenance schedule must **not** delete or rewrite the changes logged
against it. A change is a record of something that actually happened and it
outlives the schedule that prompted it — exactly as audit entries outlive their
assets. The Change Log renders such an entry with no maintenance badge, resolving
the id to nothing and saying nothing about it. No cascade, no cleanup, no repair
pass.

### Adopting existing data

Every maintenance item on the live Sheet today has no `id`. `loadData()` mints one
in its map chain, alongside the existing `adoptLegacyTag()` / `adoptLegacyNames()`
adoptions:

```js
maintenanceItems: (a.maintenanceItems || []).map(m => ({ id: m.id || crypto.randomUUID(), ...m }))
```

Two things about that are worth being explicit on, because both have bitten this
project before:

- **This is a load-time READ that fills a blank, not a load-time rewrite.**
  `loadData` never persists. A freshly minted id reaches the Sheet only when some
  save happens for other reasons, and it is written in that same snapshot — so
  there is no separate migration, no script, and no window where a browser has
  written an id nobody else can see.
- **Two browsers can mint different ids for the same item, and the revision
  counters already handle it.** Browser A mints `X`, saves; browser B still holds
  `Y`. B's next save posts a stale `rev_assets`, `doPost` refuses it as a
  conflict, B reloads and picks up `X`. That is the optimistic-concurrency check
  doing precisely the job it was built for. Without it this pattern would be
  unsafe, and it is worth knowing that is the load-bearing dependency.

## Backend (v34)

Two columns, on two tabs:

| Tab | Column added | Meaning |
|---|---|---|
| `Maintenance` | `id` | the item's stable key |
| `Changes` | `maintenanceId` | the maintenance item this change was performed against, or empty |

Purely additive. Every existing row reads back with an empty value, and an empty
`maintenanceId` is exactly what an unattached change means — so **no migration,
and behaviour is identical until something writes a link.** Same shape as v31's
`id` column.

### Extract `CHANGE_FIELDS` and `MAINTENANCE_FIELDS` while doing it

Both tabs' column lists are currently typed out as literal arrays in **three**
places each, and the three are not equal halves of one contract — which is
precisely what makes them a trap:

| Site | Actually used? |
|---|---|
| the `doGet` read | **No.** `readTable_(name, headers)` ignores its `headers` argument entirely and keys off the sheet's own header row. This copy is inert documentation that reads like a declaration. |
| the `doPost` write | **Yes — this one is the schema.** `writeTable_` clears the tab, writes exactly these headers, and projects every row through them. |
| `adminDataTabs_()` | **Yes.** Wipe and Import go through `adminReplaceAll_`, which uses it to decide what header row an emptied tab is left with. |

So the likely mistakes are: adding the column to the **read** list only (the
first hit when you grep, looks authoritative, does nothing at all — a silent
no-op), or forgetting **`adminDataTabs_`** (invisible day to day, then Wipe or
Import recreates the tab without the column and an imported inventory drops it).

Hoisting all three to one named constant next to `BREAKER_FIELDS`/`CIRCUIT_FIELDS`
removes the question. It is a prerequisite, not a tidy-up.

Then, in `doGet`'s asset map, pass `id: m.id` through on maintenance items and
`maintenanceId: c.maintenanceId` on changes; in `doPost`'s flatten, write
`id: m.id || ""` and `maintenanceId: c.maintenanceId || ""`. Note these are the
per-row projections, separate from the header constants above: the write side
decides whether the value reaches the Sheet at all, and the read side decides
whether it reaches the app. **A value written but not projected on read is
invisible to the app while sitting in plain view on the Sheet** — which reads as
"the link silently does not work" rather than as a missing column.

`SCRIPT_VERSION` → `"v34"` and `FRONTEND_SCRIPT_VERSION` → `"v34"` in the same
commit, plus a bump to `APP_VERSION`.

### Deploy ordering is mandatory: backend first

A frontend that writes `maintenanceId` against a v33 backend has that column
dropped on write. The change entry persists, unattached, and the maintenance
item's history silently comes back empty — with `SCRIPT_VERSION` still matching
its frontend, because it genuinely would. Same class of hazard as phase 2, and
the same rule: **deploy v34 to a tenant before the frontend that writes to it
reaches that tenant.** The frontend ships from `main` to every tenant at once, so
in practice: deploy `dev`, test on `/dev/`, deploy `bca`, then merge.

## Frontend

### 1. The completion modal

New state, as one object per the "related state lives in one object" convention
(`breakerModal`, `swapModal`, `allocationDraft` are the precedents):

```js
maintenanceCompleteModal = { idx, date, changeType, vendor, cost, note, error } | null
```

`openMaintenanceComplete(idx)` seeds it: `date` = today, `changeType` =
`"Maintenance"` if that entry exists in `changeTypes` (it is in
`DEFAULT_CHANGE_TYPES`) else `""`, everything else empty. It must be reset in
`openDetail()` alongside `setBreakerModal(null)` and friends — that reset exists
because forgetting one scattered setter is exactly what went wrong before.

The form reuses the Change Log tab's own controls verbatim — the `PickerField`
for change type (with its "Manage change types" gear), the `PickerField` for
vendor (with its gear), the numeric cost input, the note textarea — plus a
`type="date"` **Date performed** field, which is new and is worth having on its
own: today the only way to record work done last week is to edit the schedule's
`lastPerformed` by hand.

**Submit is a single `persist()`** writing three things at once:

- the maintenance item's `lastPerformed` = the chosen date,
- a new change entry carrying `maintenanceId: item.id` and the form's fields,
- the existing `maintenance_completed` audit entry (its `to` becomes the chosen
  date rather than always today).

One save, not two. `saveBreakerUnit` and the type editor's name+settings set the
precedent, and the reason is concrete: every save posts the whole snapshot, so
two calls means two round trips and a real chance the second is rejected as a
conflict with the first.

Guarded by `if (savingRef.current) return;` at the top of the handler, like every
other submit. Gated on `canEdit`, like the button it replaces.

### 2. The maintenance item shows its own history

Under each item on the Maintenance tab, a collapsible **"Service history (N)"**
listing the changes linked to it, newest first — date, change type, vendor, cost,
note — plus a total cost for that schedule. Derived, per asset:

```js
changesByMaintenance = useMemo(() => group (selectedAsset.changes || []) by maintenanceId, [selectedAsset])
```

A `useMemo` rather than a filter per item, because the Maintenance tab renders
inside the detail view's render body and would otherwise re-scan the changes
array once per item on every keystroke in any open form — the same reasoning that
produced `auditIndex`. The volume here is far smaller, so this is cheap insurance
rather than a measured fix.

Collapsed by default: the schedule and its next-due date are what that tab is
for, and the history is what you open when you have a question.

### 3. The change entry names its maintenance task

A change entry rendered in the Change Log tab that carries a `maintenanceId`
resolving to a live item on this asset gets a small badge — **"Maintenance:
Annual coil clean"** — next to its change type. An id that resolves to nothing
renders no badge at all (see "dangling is normal" above). Frontend-only, no new
lookup structure: the asset's own `maintenanceItems` is a short array.

### 4. The optional picker on the add-change form

A `PickerField` labelled **"Maintenance task"**, options = `["", ...this asset's
maintenanceItems]` with `labelForOption` showing the task name, defaulting to `""`
(the "Select…" placeholder / not attached). It sets `maintenanceId` on the new
entry and nothing else — no `lastPerformed` stamp, and no audit entry beyond what
`addChange` already does (which is none; a change is its own record, same as a
comment). Hidden entirely when the asset has no maintenance items, so it costs a
Computer's change form nothing.

### 5. Site-wide Maintenance tab — deliberately unchanged

The overview table (`allMaintenanceRows`) gains no column. Its job is triage —
what is overdue, what is due soon — and a last-cost or history column answers a
different question at the cost of width on the one screen that is already tight.
Clicking a row already lands on that asset's Maintenance tab, where the history
now is. Worth revisiting only if Eric actually wants cost roll-ups across the
site, which is a reporting feature, not this one.

### 6. Excel export

`exportToExcel` builds a Changes sheet from `asset.changes`. Add a **Maintenance
task** column resolving `maintenanceId` to the task name (blank when unattached
or dangling), since a spreadsheet is where anyone would total maintenance spend
by schedule. Cheap, and omitting it would make the export the one place the new
relationship is invisible.

## Audit

`maintenance_completed` keeps its action name and its shape. Its `to` becomes the
chosen date rather than always today, and `describeAudit()`'s existing wording —
`Completed maintenance "<task>" — last done <date>` — still reads correctly.

**The change entry is not separately audited**, consistent with comments and
changes today: it carries its own `at`/`by`, and its presence in the Change Log
is the record. An audit row per completion on top of the change row it just
created would say the same thing twice.

## Testing

- **Sandbox covers the entire frontend flow** — completion modal, history
  section, badge, picker, dangling-after-delete — with no backend at all. That is
  where the whole feature gets built and tried.
- **`MOCK_SNAPSHOT` must be updated, and deliberately MIXED**: some maintenance
  items carrying an `id` and a linked change or two, others carrying neither. A
  fixture that is uniformly one shape exercises half the code — this is the
  `personIds` lesson (a fixture whose shape differed from the backend's response
  hid a bug that then wiped live assignments) and the mixed-`id` precedent from
  phase 2. Include at least one change whose `maintenanceId` points at a deleted
  item, so the dangling path is exercised without anyone having to stage it.
- **A backend unit test in the `test-backend-fields.js` style**, round-tripping
  fake data through both the `doGet` maintenance/changes read and the `doPost`
  write, so a column added to one side and not the other fails. Sandbox
  structurally cannot cover a backend write path, and this is the same
  two-halves-of-one-contract hazard `test-backend-assetid.js` exists for — verify
  it by mutation (drop `maintenanceId` from one side; the suite must fail).

## Sequence

1. Backend: hoist `CHANGE_FIELDS`/`MAINTENANCE_FIELDS`, add the two columns to
   the read, the write and `adminDataTabs_`, bump `SCRIPT_VERSION` to v34.
2. Backend unit test, verified by mutation.
3. Frontend: `id` adoption in `loadData`, `MOCK_SNAPSHOT` update.
4. Frontend: completion modal, history section, badge, picker, export column.
   Bump `FRONTEND_SCRIPT_VERSION` and `APP_VERSION` in the same commit as (1).
5. Deploy v34 to **dev**, test the write path against `/dev/` — the only way to
   prove the two columns actually persist, since Sandbox never contacts Apps
   Script.
6. Deploy v34 to **bca** (which jumps it from v32, picking up v33 too), then merge to `main`.

## What this deliberately does not do

- **No cascade on delete.** Deleting a schedule leaves its changes alone.
- **No cross-asset links.** A change belongs to one asset and so does the
  schedule it names; there is no way to attach a change to another asset's item,
  and no reason to want one.
- **No auto-creation of schedules from changes.** Logging a "Maintenance" change
  does not offer to create a recurring item. Plausible later; it is a different
  feature and would need its own thinking about frequency.
- **No change to how due dates are computed.** `nextMaintenanceDue()` still reads
  `lastPerformed` alone. The change history is a record, not an input.
