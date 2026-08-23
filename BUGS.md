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

### Custom column values are never saved
**Found:** 2026-08-23, during the asset type editor design discussion.
**Needs a deploy:** yes — the fix is in `AssetTrackerSync.gs`.
**Confirmed:** read both ends of the path, not inferred.

Anything typed into a user-created custom column is silently discarded. The column
itself keeps working — its definition is stored in Config and it goes on appearing in
the table — so the failure looks like the value "didn't stick" rather than like a bug.

Why: `addColumn()` in `index.html` puts the value on each asset under the new column's
key, but the backend writes the Assets tab with `writeTable_(SHEET_NAMES.assets,
ASSET_FIELDS, assets)`, and `ASSET_FIELDS` is a fixed list that never learns about
custom columns. `writeTable_` only writes the columns it was handed, so the value is
dropped on save; `readTable_` reads the same fixed list, so nothing comes back.

Fixing it means the Assets tab's column set has to become dynamic — the fixed fields
plus whatever custom columns exist in Config. Note the tab is `clear()`ed and rewritten
on every save, so a column set that changes between saves needs care.

**Blocks:** per-type custom fields (phase two of the asset type editor). New fields
need somewhere to store their values, and this is that same broken path. Does **not**
block phase one of the type editor (icon, allowed parents, default tab, and toggling
which existing fields apply), since those change no asset data.

---

## Fixed

_(nothing yet)_
