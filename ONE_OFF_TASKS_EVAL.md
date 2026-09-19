# One-off tasks and projects

Proposal, 2026-09-19. Nothing here is built. It exists so the shape can be argued
about before a backend version is spent on it.

## The gap, stated as a quadrant

The app already covers three of four quadrants of "work on a thing":

|            | recurring                         | one-time                         |
|------------|-----------------------------------|----------------------------------|
| **future** | Maintenance › Scheduled           | **nothing**                      |
| **past**   | a completion logged against one   | Maintenance › History (Log work) |

`maintenanceItems` is prospective and recurring. A change entry is retrospective
and one-time — "Log work" records a repair that already happened, with its cost,
vendor, note and photos. What has no home is the prospective one-time: *replace
the projector in Room 101*, *run a drop to the office*, *repaint Building 200*.
Today those live in someone's head, or get typed into a comment where nothing
counts them, sorts them by urgency, or turns the tab red when they slip.

So this is not a new subsystem. It is the fourth quadrant of a table that
already has three, and the honest cheapest version of it reuses the record that
already fills the other prospective cell.

## Three shapes, and which one to build

### A. A task is a maintenance item that does not repeat — RECOMMENDED

`maintenanceItems` grows a `kind` ("scheduled" | "oneoff"), a `dueDate` and a
`doneOn`. A one-off is a row with no frequency, its own due date, and a
completion stamp instead of a moving `lastPerformed`. Everything else — the
owner, the completion flow, the work-entry link, the photo gallery, the site-wide
table, the overdue badge, the scope filter, the search — is already built and
already applies.

Cost: four columns on a tab `writeTable_` rewrites every save, so no migration.
One backend version. Frontend work is real but mostly widening existing code
paths rather than adding surfaces.

### B. Tasks become their own top-level domain

A `tasks` array beside `breakerTypes`: its own sheet tab, its own revision
counter, its own `doGet`/`doPost` handling, referencing zero or more assets.

This is the only shape that supports work belonging to **no asset at all**, and
work spanning **several** assets as first-class. It is also roughly four times
the release, and it buys a second mechanism that looks exactly like the first:
two places to record "this needs doing to that", with the user made to choose
between them on every entry. This project has been bitten before by two things
that look alike and behave differently — the `restricted` / `required` pair is
documented at length precisely because they are *not* the same call.

The multi-asset half is also weaker than it sounds. A job spanning four rooms
almost always belongs to the building those rooms are in, and this app has an
asset for the building.

### C. Projects as a separate concept above tasks

A project record owning several tasks. Rejected as a starting point: a
non-recurring task and a project differ in how many entries end up under them,
not in kind, and shape A already produces a project journal for free (below). If
projects genuinely need sub-tasks later, that is one `parentTaskId` column on the
same record — reachable from A, and not reachable from a design that decided up
front they were different things.

**Recommendation: A.** With one honest limitation, stated in full below.

## What shape A gives you that costs nothing extra

- **A project journal, already built.** A change entry can already name the
  schedule it belongs to (`change.maintenanceId`, v34). Log three work entries
  against one task and you have a dated, costed, authored, photographed record of
  a job with a running total — which is most of what anyone wants from a project.
  The Excel export's Changes sheet already resolves that link into a column, so
  "what did the Room 300 rebuild cost" is a pivot table, not a feature.
- **Before-and-after photos, already built.** A schedule's gallery renders on the
  row where the schedule is READ, with its add control, deliberately — because
  the photo that matters gets taken later, by someone standing in front of the
  thing. That reasoning was written for filters and access panels and is exactly
  right for a project.
- **Site-wide triage, already built.** The Maintenance tab is a flattened,
  scope-filtered, sortable-by-urgency table with a search and an overdue badge.
  One-offs land in it as rows.
- **A place for site-wide work.** Every asset has a `maintenanceItems` array,
  and Room, Building and Campus are assets. *Repaint Building 200* hangs off the
  building. *Renew the bell system* hangs off the campus.

## The limitation, stated plainly

**Every task must hang off an asset.** Work that is about nothing physical —
renew a licence, write the tech plan, interview a vendor — has no honest owner
here, and hanging it off Campus is filing rather than modelling. If that class of
work turns out to be most of what you want to track, shape A is the wrong shape
and B is the right one; this is the single question most worth answering before
any of this is built.

## The data

Four columns on `MAINTENANCE_FIELDS` (backend v40):

- **`kind`** — `"scheduled"` or `"oneoff"`. **A blank reads as "scheduled"**, and
  that default is known rather than guessed: before v40 a recurring item was the
  only thing that could exist. Same call as `photo.kind` defaulting to "image",
  and the opposite of `ownerType`, which is left blank because a blank there can
  only come from a hand edit.
- **`dueDate`** — the one-off's own due date. A scheduled item leaves it blank;
  its due date is derived from `lastPerformed + frequencyDays` and must stay
  derived, or the two would disagree the first time a completion is back-dated.
- **`doneOn`** — the completion date. Blank means open. A scheduled item never
  sets it; that is what `lastPerformed` is for.
- **`notes`** — a description. A schedule survives on a `task` string because
  "Filter clean" says everything; a project does not.

`frequencyLabel`/`frequencyDays` stay blank on a one-off rather than gaining a
sentinel "One-time" frequency. `MAINTENANCE_FREQUENCIES` exists because every
entry needs a day count to compute a next-due date, and a one-time entry has
none — a zero-day row in that list would be a value that means "ignore the
mechanism this list exists for".

**A completed task is kept, never deleted.** Its photos hang off its id, its work
entries name it, and a finished job is exactly the thing you want to find again
next year. Completion flips `doneOn` and drops it out of the default view.

## What has to change in the frontend

- **`nextMaintenanceDue` generalises**: a one-off answers `dueDate`, a scheduled
  item answers as it does now. Every caller already treats the result as "when is
  this due", so the call sites are unchanged.
- **`maintenanceStatusOf` gains `done`** and loses `never` for one-offs: an
  undated one-off is not urgent, it is undated.
- **One list, not a third sub-tab.** Scheduled and one-off rows share the
  Scheduled table (retitled), separated by a **Kind** column filter through the
  existing `ColumnHeaderCell`/`ColumnFilterModal` pattern. "What do I owe this
  building" is one question; splitting it across two tabs makes the overdue badge
  answer half of it. The sub-tabs stay Scheduled/History — past and future.
- **The add dialog gains a "Repeats" toggle**: frequency picker when on, due date
  when off. One dialog, one draft, as the add/edit change dialog already is.
- **"Log completion…" branches on kind** — it stamps `doneOn` for a one-off and
  moves `lastPerformed` for a schedule. Both still write the linked work entry
  with its cost, vendor, note and photos, and both still write one audit row in
  one `persist()`.
- **The status filter defaults to hiding done**, or completed tasks accumulate in
  the triage view forever.
- The Excel export's Maintenance sheet takes the four new columns.

## Four traps that will bite

1. **The default sort pins a null due date to the TOP** (`-Infinity`), because
   for a schedule a null means never-performed and needs attention. For an
   undated one-off the correct end is the BOTTOM. Same expression, opposite
   meaning, and nothing on screen would say which rule ran.
2. **A done task must not feed `maintenanceOverdueTotal`** or the red tab flag,
   including on the site-wide tab, where the badge is the whole point of the tab.
3. **`MAINTENANCE_STATUS_FILTER_OPTIONS` stores values that differ from their
   labels** (`"due-soon"` → "Due soon") through `labelForOption`; the new statuses
   have to be added there and not only to the filter's option list.
4. **Both halves of the backend contract move together.** The read projection and
   the write projection are separate literal objects in the .gs; a field added to
   `MAINTENANCE_FIELDS` and to only one of them reads back as undefined with no
   error and no version mismatch. `test-backend-maintenance-link.js` already
   covers exactly this mutation class for the v34 columns — extend it rather than
   writing a new file.

## Fixtures and tests

`MOCK_SNAPSHOT` needs all four shapes, not one: a legacy row with no `kind` at
all (the adoption), an open dated one-off, an undated one-off (trap 1), and a
completed one. A uniform fixture exercises half the code — that is the
`personIds` lesson, and the reason Sandbox could not reproduce the assignment
wipe that reached the live sheet.

New `test-frontend-tasks.js` for the derived logic — due date by kind, status by
kind, the sort placement of an undated one-off, the overdue count excluding done.
Extend `test-backend-fields.js` and `test-backend-maintenance-link.js` for the
columns. The completion flow itself is browser-verified in Sandbox, as the
existing one was.

## Release

Backend v40 + matching `FRONTEND_SCRIPT_VERSION`, in one commit. Backend first,
merge second: deploy the branch to dev, try it, deploy to the school, then merge.

## What is deliberately deferred

- **Sub-tasks** (`parentTaskId`) — reachable from this design, not worth building
  before a real project proves it is needed.
- **Asset-less work** — shape B, and the question above decides whether it ever
  matters.
- **A start date, a %-complete, a blocked state** — a project that needs all
  three is a project-management app, and this is an asset tracker with a task
  list attached to its assets. Worth adding one at a time, if ever.
- **Assigning to a User asset** rather than the freeform `owner` string. Sensible
  and cheap now that people are assets, but it is a change to schedules too, so
  it belongs in its own pass.

## Decisions needed before building

1. **Is the asset-less case real?** If most of what you want to track is not
   about a physical thing, build B instead.
2. **Does "Maintenance" stay the tab's name?** Once it holds projects it is the
   wrong word. Renaming what people read is free and this project has done it
   twice (`changeType` → "Work type", `breakers` → "Layout"); the stored key,
   the domain and the `?tab=maintenance` deep link would not move.
3. **One list with a Kind filter, or separate sub-tabs?** The recommendation is
   one list, for the reason above.
