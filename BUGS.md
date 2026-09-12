# Known bugs

Bugs found while working on something else go **here**, not into the session that
found them. Log it, mention it in one line at the end of the response, and carry on
with what was actually asked. Eric decides what gets fixed and when.

The one exception: if a bug genuinely blocks the current request, say so explicitly
and name **which part** it blocks — not the whole task, unless it really is the whole
task.

Each entry: what's wrong, how it shows up, whether it needs an Apps Script deploy,
and how it was confirmed. Move fixed ones to the bottom under "Fixed" with the
version that fixed them.

---

## Open

### Sorting the Type column orders user-created types by their raw UUID
**Found:** 2026-09-12, while fixing the User column's sort.
**Needs a deploy:** no — `index.html` only.
**Confirmed:** by reading `sortValue`; not reproduced on screen, since it needs a
user-created type and the effect is only visible among several of them.

The Type cell renders `typeNameOf(a.type, typesList)` — the type's NAME — while the sort
falls through to the generic `x[key]` path and compares `a.type`, which is the type's ID.
For a built-in type the id IS its original name, so the two agree and the column looks
correct; a type created at runtime has a generated UUID, so it sorts by that instead of by
what the cell shows. It lands in an arbitrary position with no way to tell why.

Same class as the User column bug fixed the same day, and the fix is the same shape: give
`type` its own branch in `sortValue` returning `typeNameOf(x.type, typesList)`. Left alone
here only because it is a different column from the one that was reported, and it bites
just the school with a user-created type (CLAUDE.md notes there is at least one).

### An add-form draft keeps its Asset ID after switching to a type that has none
**Found:** 2026-09-12, while adding a person to test the first/last name work.
**Needs a deploy:** no — `index.html` only.
**Confirmed:** in a browser against Sandbox. Add asset (defaults to Computer, which
suggests an Asset ID), switch Type to User, Save.

`startAdd` seeds the draft with a suggested Asset ID because the default type carries
one. Switching the type to one whose registry entry EXCLUDES `tag` — User, Room,
Building, Campus — removes the field from the form but leaves the value on the draft.
Two consequences, in order of how much they matter:

- **The save can be refused by a field that is not on screen.** `findTagConflict` still
  runs against the carried value, so a collision reports `Asset ID "BCA0001" is already
  in use (Computer)` on a form with no Asset ID field to correct. Same shape as the Bulk
  Item parentId bug in CLAUDE.md: an error about a control the type does not have.
- **Otherwise it saves a hidden tag** onto a type that is meant to have none, and burns
  an asset number doing it.

**Sandbox shows it every time; a real sheet mostly hides it.** `MOCK_SNAPSHOT` carries no
`nextAssetNumber`, so `peekAssetNumber()` returns 1 and the suggested ID is `BCA0001`,
which the fixture's own first Computer already holds. On a live sheet the counter is real,
so the suggestion is unused and the save goes through — quietly writing the hidden tag.

**The fix is one line in the shape the codebase already uses**: clear `tag` when the
draft's type stops accepting one, the way the edit path clears `parentId` for a type that
takes no parent — a repair rather than a refusal, since no tag is that type's only correct
value. Worth checking at the same time whether any other excluded field survives a type
change on a draft.

### A value that doesn't match its field's kind shows as BLANK, then refuses the save
**Found:** 2026-09-10. **Mostly closed the same day** — see below.
**Needs a deploy:** no — `index.html` only.
**Confirmed:** in a browser against Sandbox, before the fix.

When a stored value doesn't match its column's data type, the edit form shows that field
**empty** — `<input type="number">` cannot render `MOCK-CMP-001`, and React still holds the
real value; only the browser refuses to display it. Saving is then refused with "Serial must
be a number.", naming a value **that is not on screen**. The data is never touched, and the
detail page still shows it, but the form reads as "the app is complaining about an empty
field", and the obvious response — type something — overwrites data that was never at risk.

**The route that made this common is gone.** A field's kind is now chosen when the field is
created and is fixed afterwards (Eric's call, 2026-09-10), so no settings change can put
stored data out of step with its own column. That removed the bad case entirely: changing a
kind under forty assets used to make all forty unsaveable at once.

What is left is narrow and arrives from outside the app: the **admin import** writing text
into a column created as a number, a direct Sheet edit, or a hand-edited Config blob.
`validateColumnValue` is the backstop for exactly those and should stay.

Worth doing if it ever bites: render a value that doesn't match its kind as **read-only text
with a note**, rather than as an empty typed input. One change, and the refusal stops
referring to something invisible.

**Blocks:** nothing.

---

### `deploy.config.json` in a repo clone silently shadows the `$HOME` config
**Found:** 2026-09-09 while misdiagnosing a deploy failure. **Latent — this did NOT cause
that failure**, see the correction below.
**Needs a deploy:** no — Node tooling only.
**Confirmed:** by reading the code, not by reproducing it.

`deploy.mjs`'s `loadConfig()` reads **`<repo>/deploy.config.json` FIRST** and only falls
back to `~/.bca-asset-tracker-deploy.json`. First hit wins; the two are never merged.
`set-tenant.mjs` mirrors that (`fs.existsSync(REPO_CONFIG) ? REPO_CONFIG : HOME_CONFIG`),
and `new-tenant.mjs` records a new tenant by shelling out to it.

So if a `deploy.config.json` ever exists in a Cloud Shell clone, every tenant id recorded
from then on is written into the repo directory — gitignored, disposable, and not the
`$HOME` that Cloud Shell persists. The tutorial link creates a NEW clone each time
(`~/cloudshell_open/BCA-asset-tracker-1`, `-2`, … — eleven of them as of 2026-09-09), so
that copy would be left behind on the next open.

The repo-first order is deliberate and its stated reason is sound: it stops `set-tenant`
creating a second config that shadows the first. But it resolves the shadowing by
preferring the **less durable** copy, which is backwards for a file whose whole purpose is
to persist in `$HOME` so a redeploy stays one tap from a phone.

Options, none obviously right: always write `$HOME` and warn when a repo copy shadows it;
merge the two per tenant; or refuse to start when both exist.

**CORRECTION, same day.** This was written as the *cause* of "No Apps Script ID configured
for tenant dev" and that was wrong. `cat ~/.bca-asset-tracker-deploy.json` showed a correct,
complete config with both tenants, and no `deploy.config.json` existed in any of the eleven
clones. The actual cause was never established — the most likely explanation is that the
`dev` entry was simply absent when the deploy ran and was added before the file was read
back. **The eleven clones were a red herring**, and the confident-sounding story built
around them cost real time.

The lesson is the one this file keeps recording from the other direction: *check, don't
infer*. `cat` on the config was one command and would have settled it before any theory was
built. It was the fourth thing tried, not the first, because the code-reading suggested a
tidier answer.

**MITIGATED 2026-09-10, not fixed.** The precedence order is unchanged — a repo
`deploy.config.json` still wins — but `deploy.mjs` now DETECTS the case and says so, and
the tenant-missing error prints which config file it read, which tenants were in it, and
which directory it ran from. The shadowing warning names the one-line fix (`rm` the repo
copy). Verified by creating both files and running a deploy.

That is deliberately a diagnostic rather than a behaviour change. Which copy *should* win
is still an open design question with no obviously right answer, and picking one under
time pressure before a deploy to a school is how the original wrong theory got written.
What was actually costly was not the precedence — it was that the failure said nothing,
so reasoning replaced looking. That part is now closed.

**Blocks:** nothing.

---

### Add asset suggests a colliding Asset ID when `nextAssetNumber` is unset
**Found:** 2026-09-09, in browser testing of the required-fields work — the add form
refused every save with a duplicate-tag error before the required rule was ever reached.
**Needs a deploy:** no — `index.html` only.
**Confirmed:** in Sandbox against `MOCK_SNAPSHOT`, which carries no `nextAssetNumber`.
Opening Add asset pre-fills `BCA0001`, which the fixture already uses, so Save is
refused until the tag is edited or cleared.

`peekAssetNumber()` returns `nextAssetNumber || 1`. Phase 3 of the key refactor deleted
its old `Math.max(counter, derived-from-assets)` guard, deliberately and with a good
reason: that guard existed because a reused label was a reused primary key, and a real
`id` makes that impossible. But it also meant a missing counter now yields 1 rather than
one past the highest existing number, and `startAdd()` puts that straight into the form
as the suggested tag.

**On the live sheet this does not bite** — the counter reads 116 — so the exposure is a
sheet that has never written the key: the sandbox fixture, a freshly imported tenant, or
`dev` after a wipe. There it makes Add asset look broken on first use, since the refusal
is about a value the app filled in itself.

Worth deciding rather than fixing blind, because the honest options differ:
- Seed the counter from the assets **once, at load**, when it is missing — close to the
  deleted guard but without reviving it as a per-call rule.
- Suggest nothing when the counter is unset. Tags are optional as of v32, so a blank tag
  on a new asset is a legitimate state and the person types the sticker they actually
  printed.
- Leave it, and make `MOCK_SNAPSHOT` carry a `nextAssetNumber` so at least the sandbox
  stops demonstrating it.

**Blocks:** nothing. It made the add-form test clear the tag first, which is a
one-line workaround, not an obstacle.

---

### `peekAssetNumber()`'s block comment describes behaviour that was deleted
**Found:** 2026-09-09, reading that function while investigating the entry above.
**Needs a deploy:** no — a comment in `index.html`.
**Confirmed:** by reading it. The comment above the function says "Max — not 'the counter
if it's set' — so it can also be seeded on an existing sheet that predates it (counter
null -> derived wins)". The comment *inside* the function says that `Math.max` is
DELETED as of v32. Both are in the same six lines, and they contradict each other.

The inner comment is the true one. The outer one is left over from before phase 3 and now
argues for behaviour the code no longer has — which matters more than an ordinary stale
comment, because it is precisely the reasoning someone would rely on when deciding what to
do about the bug above.

This project has twice written down that a name or comment which no longer says what the
code does is a bug rather than a tidy-up. Same class.

**Blocks:** nothing.

---


### `MOCK_SNAPSHOT` uses real staff names, and the repo is public
**Found:** 2026-08-26, while scanning the v29 commit for anything that shouldn't be
published — pre-existing, not introduced by that change.
**Needs a deploy:** no — `index.html` only.
**Confirmed:** by `grep` over the tracked files, and by fetching the GitHub API
anonymously to verify `"visibility": "public"`.

The sandbox fixture names six real people — Jen Kramer, Aaron Cantrell, Denise Sloan,
Kelly Mackinga, Dillon Jacobsma — against real room numbers, and `Kramer Residence` /
`Kramer Campus` name a staff member's home. `index.html` is committed and served from
GitHub Pages, so all of that is already public and already in git history.

Not as bad as it could be: every serial in the fixture is `MOCK-*`, there are no real
hostnames, and a school's staff list is semi-public anyway. What is actually exposed is
the mapping of person → room, plus one person's residence.

Worth fixing because the fixture has no reason to use real names — invented ones would
exercise exactly the same code paths. Renaming them in `MOCK_SNAPSHOT` fixes it going
forward; scrubbing history would mean a force-push and is probably not worth it for
this. Decide which.

**Blocks:** nothing.

---

### A user-created type collides with a built-in added later
**Found:** 2026-09-09, while auditing the app for other places where legacy ids and
generated UUIDs coexist (the same shape as the asset key refactor).
**Needs a deploy:** no — `index.html` only; `typesList` is a JSON blob in Config, so
its shape is entirely the frontend's business.
**Confirmed:** by reading `ensureLockedTypes` (index.html ~line 339) against `addType`
(~line 4640). Not reproduced against live data, because it needs a release that does
not exist yet — see Blocks.

A built-in type's id IS its original name (`Room`'s id is the string `"Room"`), while a
type someone creates in the manager gets a `crypto.randomUUID()`. That split is
deliberate and is what made the type-id migration free. The gap is in how a MISSING
built-in is restored: `ensureLockedTypes` matches on **id only** —
`new Set(list.map(t => t.id))` — and never looks at names.

So if a user has already created a type called "Door" (id: a UUID), and a later release
adds `Door` to `TYPE_REGISTRY` as a locked type, `ensureLockedTypes` finds no entry with
id `"Door"` and inserts `{ id: "Door", name: "Door" }` beside the one that is already
there. The result is two entries reading "Door" in the picker — the exact trap `addType`
and the rename path both refuse to create, arriving through a door neither of them
guards. One carries the structural behaviour (its tabs, its field rules, its
`parentTypes`); the other is inert, and every asset the user already filed under their
own "Door" stays pointed at the inert one, since `typeEntryFor(<uuid>)` misses the
registry entirely.

Nothing detects it and nothing repairs it. The fix is a decision rather than a patch:
either `ensureLockedTypes` skips a locked type whose NAME is already taken (leaving the
user's type inert but unduplicated, and the built-in absent — which breaks the "the app
depends on this type existing" premise `locked` encodes), or the restore ADOPTS the
existing entry by rewriting its id to the built-in's (which is a load-time rewrite of
stored data, the thing this codebase avoids everywhere else, and it would race between
browsers), or the collision is surfaced to the user to resolve. Worth choosing before
shipping the type, not after.

**Blocks:** nothing today — it needs a future release that adds a locked type whose name
a user has already used. It is timely rather than urgent because **Doors/Locks/Keys is
"Planned next"** in `CLAUDE.md`, and "Door" is exactly the kind of name a user would have
invented for themselves in the meantime.

### A failed sign-in hangs on "Checking your access…" forever
**Found:** 2026-08-24, while testing v22 sign-in against a backend still running v21.
**Needs a deploy:** no — `index.html` only.
**Confirmed:** by the symptom plus reading the code path.

`credentialHandlerRef` sets `authPending` true before calling `loadData()`. Every exit
from `loadData()` clears it EXCEPT the `catch`, which sets `loadError` and stops. But the
sign-in gate returns before the `loadError` screen is ever reached, so the user sits on
"Checking your access…" with no error, no button, and no way forward but a reload.

Any failure during sign-in produces this: backend unreachable, a non-JSON response, a
version mismatch. It's what turned "your backend is out of date" into "the app is
frozen", which cost a diagnosis round trip.

Fix is one line — clear `authPending` in the `catch` — plus deciding what the gate should
say when a sign-in attempt fails for a transport reason rather than an auth one.

**Blocks:** nothing. But it will disguise the cause of any future sign-in problem.

---

### Picking a type reopens the type manager behind the picker
**Found:** 2026-09-08, while browser-testing the type-name display fix — pre-existing,
present identically on the commit before that change.
**Needs a deploy:** no — `index.html` only.
**Confirmed:** in Chromium against Sandbox mode, on both the fixed build and `HEAD`
before it. Sequence: open the add form, open **Manage asset types** from the gear beside
Type, add a type, close the manager, open the Type picker, choose any type. The picker
closes and the asset takes the chosen type correctly — and the *type manager* reopens on
top of the form, needing a second dismissal before Save is clickable.

Only reproduces once the manager has been opened earlier in the same form session, so it
reads as the manager's own open-state not being cleared when it is closed from its X (the
picker's gear presumably sets it, and closing the picker restores whatever it thinks the
previous state was).

Cosmetic — nothing is mis-saved, the type does get picked — but it puts a modal in front
of Save right at the moment someone has just created a type, which is exactly when a new
user is least sure whether their click worked.

**Blocks:** nothing.

---

## Fixed

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
