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
