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

_(nothing open)_

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
