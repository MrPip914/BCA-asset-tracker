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
