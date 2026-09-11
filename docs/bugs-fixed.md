# Fixed bugs

*Split out of `BUGS.md` on 2026-09-11. The archive had reached 12KB of the file's 27KB,
and `CLAUDE.md` tells every session to read `BUGS.md` before starting anything
substantial — so the resolved half was being read at the start of most sessions in order
to scroll past it.*

*Nothing here is open. These are kept because a fixed bug is a record of how this project
fails: several of the rules in `CLAUDE.md` exist because of an entry below, and knowing
that a class of failure has happened once is what stops it being re-litigated from
scratch. Move an entry here when it is fixed, newest first, with the version that fixed
it.*

---

### A newly added maintenance schedule had no `id` until the next load — fixed 2026-09-11
**Found:** 2026-09-11, while wiring photos onto maintenance items — the photo needed an
owner id and there wasn't one.
**Needed a deploy:** no — `index.html` only.
**Confirmed:** by reading `addMaintenanceItem`, which built the item with `task`,
`frequencyLabel`, `frequencyDays`, `lastPerformed`, `owner`, `at`, `by` — and no `id`.

v34 gave maintenance items a real `id` and moved every handler onto it
(`startEditMaintenance`, `saveMaintenanceEdit`, `openMaintenanceComplete`,
`deleteMaintenanceItem`), with the row's React key on it too. What it did not do was mint
one at the point a schedule is CREATED. `adoptLegacyMaintenanceIds` filled the blank on
the next load, which made it invisible in every normal test — add a task, reload, and it
has an id like everything else.

**The window is one session, and inside it the failure is silent and wrong-targeted.**
`startEditMaintenance(undefined)` matches on `m.id === itemId`, so it finds the FIRST item
with no id. With one freshly added schedule that is coincidentally the right one, which is
why nobody hit it. Add TWO without reloading and editing, deleting or completing the second
acts on the first. React also keys those rows on `undefined`.

**Fixed as a by-product rather than deliberately**, which is worth noting: the id is now
minted when the Add task dialog OPENS — needed so a photo can name the schedule while the
form is still being filled in — and `addMaintenanceItem` uses it. Had photos not needed an
owner id, this would still be sitting there.

**The lesson generalises past this bug.** An adoption that fills a blank at LOAD makes the
create path look correct, because the only cheap way to check is to reload. v34's work
entries got this right (`addChange` minted its own); the schedule path did not, and the two
were written in the same change. When a load-time adoption exists, check the create path
separately — it is the one place the adoption cannot cover.

### `/deploy` printed the pre-2026-09-10 deploy instructions — fixed 2026-09-10
**Found:** 2026-09-10, right after the block it produced was pasted in the wrong shape.
**Needed a deploy:** no — `.claude/commands/deploy.md` only.
**Fixed by** `b29cdf5` ("Give the deploy procedure one home, and a test that keeps it
there"), on `main`, in a separate session — not by the session that logged it.

`CLAUDE.md` advertised `/deploy` as the safe alternative to retyping the deploy block from
memory, while `8cc1603` had rewritten the instructions in `CLAUDE.md` and
`cloudshell-deploy.md` without touching the command file. So the escape hatch someone
reaches for *because* they do not trust their memory would have handed back the superseded
procedure — missing the ask-which-branch/send-one-block rule that the rewrite existed to
add. Both copies still said roughly the right thing, which is what made the drift invisible:
the same shape as the v18 `SCRIPT_VERSION` drift, where two copies of one string differed by
one word.

**The fix went further than the entry asked for, and the extra part is the durable bit.**
The entry proposed either quoting `CLAUDE.md` or deleting the command. The actual fix did
the first — `/deploy` now carries no deploy text of its own and quotes the three sources
that own it — and then added `test-deploy-docs.js`, which fails if a fifth copy of the
procedure appears, if a doc names a tenant `clients.js` does not have, if a doc tells you
to watch for a success line `deploy.mjs` never prints, or if a live-version claim
reappears in prose. **A convention nothing checks is a convention that drifts**, which is
the whole lesson: the earlier rewrite was correct and still could not stop the next copy
going stale.

### `test-backend-maintenance-link.js` never ran on an LF checkout — fixed 2026-09-10
**Found:** 2026-09-10 while auditing the deploy docs; the whole file exited non-zero on
`Error: end marker not found` before a single assertion ran.
**Needed a deploy:** no — test files only.

It sliced `doGet`/`doPost` out of `AssetTrackerSync.gs` using a marker with a hardcoded
**CRLF**: `'\r\n    const auditLog ='`. Git for Windows defaults to `core.autocrlf=true`
and nothing in this repo pins line endings, so the `.gs` is CRLF on Eric's machine and LF
in a cloud session, in CI, or on a Mac.

**The asymmetry is why it hid for weeks, and is the part worth keeping.** Its twin,
`test-backend-assetid.js`, sliced at the same place with `'\n    const auditLog ='` — and
that form works on BOTH, because the `\n` matches the LF half of a `\r\n` pair. So an LF
marker is accidentally universal while a CRLF marker only works on CRLF. The broken form
therefore passes for whoever writes it on Windows and dies for everyone else, with no
signal on the machine where it was written.

Fixed by normalising the source on read (`.replace(/\r\n/g, '\n')`) in both files, so
neither marker form can be wrong rather than one of them being accidentally right.
Verified by running both suites against a `.gs` converted to CRLF and back to LF.

**The other two files that contain `\r\n` are correct and were left alone** — an earlier
version of this entry claimed all three were broken, which was wrong.
`test-frontend-export.js` already detects the line ending (`src.includes('\r\n') ? ... `),
and `test-backend-admin.js`'s is CSV fixture data, where CRLF is the format and the point
of the test.

**Still open, and the broader fix:** a `.gitattributes` pinning the repo's line endings
would remove the whole class. Not done — it would restate every checkout in the repo and
is a bigger change than the bug warranted.

---

### Export did nothing at all, on every tab — fixed 2026-09-10
**Found:** 2026-09-10, reported by Eric ("clicked Export on the Maintenance tab, didn't get
anything").
**Broken since:** `b4a7ed1`, *Replace fixed room/building fields with a general parent chain*.
**Fixed:** same day. `index.html` only — no deploy.
**Confirmed:** in a browser — `Uncaught ReferenceError: displayRoom is not defined`, thrown
from the Export click; and by `git log -S`, which puts the deletion of the helper in b4a7ed1
with two call sites left behind.

`displayRoom` was a local helper (`a.type === "Room" ? a.room : roomNameFor(a.roomId, ...)`).
The parent-chain change deleted it and replaced its callers everywhere EXCEPT two lines inside
`exportToExcel` — the Comments sheet and the Changes sheet. Both now use `roomNameOf(a,
assets)`, which is what the Assets sheet already used.

**Not a Maintenance-tab bug.** Both toolbar Export buttons call the same function, so Export
was broken everywhere. It is worth being precise about that: the report named one tab, and
fixing only what was reported would have left the other one broken.

**Why it survived weeks, which is the part worth engineering against:**
- Babel compiles it fine. A bare identifier is only resolved when the line RUNS, and nothing
  runs until someone clicks Export.
- Both dead lines sit inside `(a.comments || []).forEach` and `(a.changes || []).forEach`. On
  an inventory where nothing has a comment or a change, neither ever executes and Export works
  perfectly. It breaks only once there is data worth exporting — the opposite of the usual
  empty-state bug, and invisible to a smoke test.
- It fails with **no user-visible message**. The click simply does nothing, which is exactly
  how it was reported.

`test-frontend-export.js` now walks every call inside `exportToExcel` and asserts the callee
exists — module-level, local, parameter, or a known global. Verified by mutation that it
catches the original bug reintroduced, any other dead reference, and the Room column being
quietly dropped instead of fixed. Quoted strings are stripped before scanning or the header
`"Slot(s)"` reads as a call to `Slot`; template literals are deliberately left in, since their
`${...}` holes hold real calls.

### Viewers saw the delete X on comments and change entries — fixed 2026-09-10
**Found:** 2026-09-10, while adding the maintenance badge to the Change Log.
**Fixed:** same day, at Eric's request. `index.html` only — no deploy.

The per-entry X on a comment and on a change entry rendered for a view-only user: both
sat OUTSIDE the `{canEdit && (...)}` wrapper that gates each tab's add form. Cosmetic
only — `persist()` refuses the write and so does `doPost`, which are the real control —
but it offered a viewer a button that could only fail, and it was the one place the app
broke its own convention that edit affordances are hidden by cluster.

One `canEdit &&` around each. Verified both directions in Sandbox by temporarily forcing
`const canEdit = false` (the technique this file's Access notes describe, since testing
the viewer role otherwise needs a second Google account): as a viewer, zero delete
buttons on both tabs and no add forms, with **every entry still readable** — which is the
point, a viewer reads everything and changes nothing. As an editor, all six change
buttons back and a freshly added comment carrying its own.

Worth knowing for the next one: the fixture has no comments at all, so the comment case
reads as "0 buttons" for an editor too and proves nothing by itself. It was confirmed by
adding a comment, seeing its X appear, then deleting it again.

### "Today" was computed in UTC, dating evening work a day ahead — fixed 2026-09-10
**Found:** 2026-09-10, while building the v34 maintenance completion form.
**Fixed:** same day, at Eric's request. `index.html` only — no deploy.

`new Date().toISOString().slice(0, 10)` takes the **UTC** date. A date-only field carries
no timezone and is displayed verbatim, so nothing downstream could convert it back: at
UTC-7, everything stamped between 5pm and midnight local was recorded as TOMORROW, and a
maintenance item completed Tuesday evening fell due a day late from a Wednesday it was
never done on. True of every completion the app had ever recorded — the old one-click
`markMaintenanceDone` used the identical expression.

**Why it survived so long, and why the test matters more than the fix.** Nothing about it
is visible to ordinary checking. UTC and local agree until 5pm, so any daytime test passes.
It sits beside a change entry's `at`, which IS timezone-aware and renders correctly in
local time — so a wrong date sits next to a right time and the pair looks self-consistent.
Eric hit exactly that: he tested at 08:45, correctly reported the time showing as local,
and that observation proved nothing about the date.

`localDateString(d)` now builds the string from the local getters, and
`test-frontend-localdate.js` slices it out of `index.html` and sweeps all 24 hours of a
day plus the month/year/leap rollovers — the old form turned 23:30 on Dec 31 into the
next YEAR. It also asserts no call site has gone back to `toISOString()`, since that
reintroduces the bug while passing every behavioural test. Verified by mutation that all
four failure modes fail it.

Two sites that formatted a computed due-date the same way were switched too. They were
correct at UTC-7 (local midnight falls on the same UTC day) and would have been wrong
east of UTC — fixed while the helper was being added rather than left as a latent trap.

### Custom column values are never saved — fixed in v26
**Found:** 2026-08-23. **Fixed:** 2026-08-25, alongside per-type custom fields, which
were blocked by it.

`writeTable_` writes only the columns it is handed, and `doPost` handed it the fixed
`ASSET_FIELDS`, so anything typed into a user-created column was dropped on save while
the column itself kept appearing — the failure looked like the value "didn't stick".

`customColumnKeys_()` now appends the custom columns to that list, taken from the
columns carried by the request and falling back to what Config already holds (an old
client or a direct API call posts assets with no column list, and dropping the custom
columns there would delete real data). Keys that shadow a schema field or repeat
another are refused, since `writeTable_` would write that column twice and
`readTable_` would keep only the last.

The read side needed nothing: `readTable_` ignores the header list it is given and
returns whatever the sheet holds, so a column that gets written comes back on its own.

**Verified** by `test-backend-fields.js` in the repo root, not in a browser — Sandbox
never contacts Apps Script and the live backend needs a sign-in, so the write path this
bug lived on is exactly what the usual check can't reach.
