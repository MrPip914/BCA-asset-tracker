# The Name field — plan

Status: **steps 1 and 2 built and deployed, backend v23** — confirmed live on 2026-08-25
by reading `scriptVersion` back from the `/exec` URL. This header said "undeployed" while
the Sequence section below said the opposite; the fetch settles it. Step 3 and the type
editor are still ahead. It is the prerequisite for the asset type editor.

Steps 1 and 2 were **built together, not separately as planned.** They don't
separate: the moment every asset has a name, the Type column's "show the name if
this type has one" rule fires for everything, and the list reads "Computer
BCA0012" in the Type column for every row. Step 1 alone is a visibly broken app.
The same forced pulling `isComputedColumnFor` forward out of step 3 — leaving a
Room's `room` field editable alongside the new Name would have put two competing
name fields on the same form.

## The problem

Two different questions are answered by the same columns today, and that overlap is
what makes the type system hard to open up to the user.

- **What is this thing called?** A Room is called "Room 102", a Building "Building
  100", a Campus by its campus name, a Bulk Item by its sub-type ("Chairs"). Four
  types, four different fields, each declared per type in the registry as `nameField`.
  Every other type has no name at all and is called by its Asset ID.
- **Where is this thing?** A printer's Room column reads "Room 102" because that's the
  room it sits in — computed by walking up the parent chain.

The Room column means the first thing on a Room row and the second thing on every
other row. `isComputedColumnFor()` exists solely to paper over that split, and the
Type column carries the same overload from the other side: it prints a Room's *name*
where the type word belongs, and a Bulk Item's *sub-type* plus a BULK badge to
compensate.

## The design

**One optional `name` field on every asset**, replacing `room` / `building` /
`campus` as name-carrying fields and ending Sub-Type's double duty.

- Names are **display only, never identity**. `label` (the Asset ID) remains the one
  stable key, per the reference conventions in CLAUDE.md. Names need not be unique,
  are freely editable, and nothing ever resolves a reference through one.
- `nameOf(asset)` keeps its shape and its label fallback, but reads one field instead
  of a per-type ladder. **The registry's `nameField` key disappears entirely** — with
  it, one of the settings the type editor would otherwise have to expose.
- A user-created type gets a real name immediately, without the per-type custom-field
  system and without the broken custom-column save path (see BUGS.md). This is the
  main reason this work comes first.

### Type and Sub-Type become type information only

- **Type column** always prints the type word: "Room", "Bulk Item", "Computer". No
  names, no exceptions, no `realName` branch.
- **The BULK badge is removed.** It only existed because the Type column was showing
  "Chairs" and there was otherwise no way to tell it was a bulk item.
- **Sub-Type column** prints only the category ("Folding Chair"). It stops standing in
  as the Bulk Item's name.
- **Detail header** reads name then type, as it does today, but fed from `name`.

### Room / Building / Campus stop being columns

They were kept, at the point Path replaced them, for three reasons. Only one survives
this change, and it isn't about the list:

1. *They hold a Room's own name.* — Gone. That is what `name` is for.
2. *The Room filter is what the bulk "move filtered to room" toolbar hangs off.* —
   Weak. `bulkMoveSourceId` already prefers the `HierarchyNav` scope and only falls
   back to `roomFilter`; the scope is the better source anyway, since it matches
   nested rooms. Rewire it onto the scope and drop the fallback.
3. *A spreadsheet is where you group by building, and a Path string can't be grouped.*
   — Real, but an argument about the **export**, not the list.

So: remove Campus/Building/Room as list columns and filters, and give
`exportToExcel` its own resolved Campus/Building/Room columns. Note the coupling to
break: the export currently builds its rows by walking `columns`, so deleting them
from the list silently deletes them from the export too.

Sorting the list by **Path** already groups by building ("Building 100 › Room 101"
and "…› Room 102" sort adjacent), so the list loses no grouping either.

## Backfill

The live sheet is sample data and does not have to come out perfect (Eric,
2026-08-24). Names are editable afterwards, so a wrong guess costs a retype.

Same mechanism as `adoptLegacyParentage()`: on load, an asset with no stored `name`
adopts one by the ladder below; the first asset-domain save writes it in for every
asset at once. No script, and the same build is correct against a migrated sheet and
an un-migrated one.

| Asset | Name it adopts | Example |
| --- | --- | --- |
| Room / Building / Campus | its existing `room` / `building` / `campus` value | `Room 102` |
| Bulk Item | a copy of its sub-type (`itemName`), editable after | `Chairs` |
| Fixed in place, with a place above it | *nearest place name* + type | `Room 102 Mini Split`, `Building 300 Condenser` |
| Everything else | type + Asset ID | `Computer BCA0012` |

"Fixed in place" is Mini Split, Condenser and Electrical Panel — things bolted to a
building rather than carried around. Stated as *nearest place + type* rather than
*room + type* so a Condenser, which hangs off a Building, reads correctly. A fixed
asset with no parent falls through to type + Asset ID.

Two consequences worth naming rather than discovering later:

- **A backfilled name can go stale.** Move that mini split and it still reads "Room
  102 Mini Split". It's ordinary editable text, and correcting it is a field edit.
  Accepted deliberately — a name that silently rewrites itself when you move
  something is worse, and would make it impossible to tell a real name from a
  placeholder.
- **New assets don't get backfilled names.** The add form pre-fills the same
  suggestion instead, editable before save, so a new asset is named at creation and
  never relies on the fallback. A genuinely blank name still displays as the Asset ID.

## What the first version got wrong

Shipped 2026-08-24, found against the live sheet the same day. Recorded because
the cause is a testing gap, not a typo.

The backfill's first pass read `a.room || a.building || a.campus || a.itemName`
ungated by type. On a Room the `room` column IS its name — but on every other
asset it's a leftover from the pre-v9 schema still holding the room it sits in,
kept and still written so v17 stays reversible. So every computer, monitor and
phone was named after its room: "Room 102" instead of "Computer BCA0001".

**The sandbox fixture didn't reproduce it**, which is why the tests passed. Its
devices carry no legacy place columns at all — only its Rooms do — so the ungated
read found nothing to go wrong with. `MOCK_SNAPSHOT` now gives a few devices the
stale `room`/`building` values the live sheet actually has, so the fixture has
the shape that broke it.

Two fixes: `LEGACY_NAME_COLUMNS` gates each old column to the one type it named,
and `hasMisadoptedName()` repairs names the broken version already wrote — a name
equal to one of those leftover columns on a type that column never named is
exactly the set that got it wrong. It's self-limiting (a corrected name stops
matching) and removable once no sheet carries one.

A second, smaller miss in the same release: a new default column was always
inserted just before `status`, so `name` landed at the far right of an existing
user's table while being first for anyone starting fresh. New columns now land at
their `DEFAULT_COLUMNS` position.

## Sequence

1. ~~**Add `name`**~~ — done: backend field, column, form input on every type, backfill
   ladder, `nameOf()` reading one field.
2. ~~**Clean out Type / Sub-Type**~~ — done: type word only, BULK badge removed, Sub-Type
   as category only, `nameField` deleted from the registry.
3. **Remove the place columns** — Campus/Building/Room out of the list and filters,
   export given its own resolved columns, bulk move rewired onto the scope,
   `isComputedColumnFor()` retired.
4. **Type editor** — now materially simpler, one fewer setting to design. **Carry the
   `itemName` → `subType` rename in with it** (Eric, 2026-08-25): the sheet column is still
   called `itemName` while every visible label says "Sub-Type", and the field now only carries
   the category, since `name` took the naming half in v23. It needs a backend version, and so
   does the type editor, so bundling them costs one paste-and-redeploy instead of two. Do it
   the way `parentId` and `name` were done — write `subType`, keep reading `itemName` as a
   fallback, clear the old column later — so no step of it is one-way. Note the frontend key
   is also a column key, so a device's saved column-visibility choice for `itemName` won't
   carry over; it falls back to the server default, which is visible, so nothing disappears.
   Left open deliberately: whether Sub-Type earns its keep at all now that bulk items have
   real names — if it doesn't, the rename is moot and the field goes instead. Two
   decisions are still open, both put to Eric on 2026-08-24 and neither answered,
   so a session picking this up starts by asking:
   - **Renaming a type.** `asset.type` stores the type's NAME, and so does every
     other type's `parentTypes`, so a rename needs a cascade over two reference
     sites — the same shape as the room-rename cascade the id migration removed.
     Three options: forbid renaming (consistent with "labels are never renamed"),
     cascade it, or give types real ids first. The last is cheapest done BEFORE a
     pile of user-created types exists.
   - **Where a type's settings live.** Recommended: `TYPE_REGISTRY` stays the
     shipped defaults and a `typeSettings` Config blob overlays it per key. An icon
     is a React component and a module needs a render branch, so neither can be
     data; everything else can. Note this needs a backend version of its own —
     `doPost` writes a FIXED list of config keys and silently drops unknown ones,
     so a `typeSettings` row would be erased by the next config save.

Step 3 needs no backend change. Step 1 shipped as backend **v23** (a `name` column
on the Assets tab), live and re-confirmed 2026-08-25. The legacy `room`/`building`/`campus` columns stay
readable but stop being written, so the change is reversible; clearing them is a
separate later step, exactly as with `roomId`/`buildingId`.

## Testing setup

The cloud sessions this was built in could not load the app at all: the environment's
network policy blocked `esm.sh` and `unpkg.com`, so React and Babel never arrived, and
`script.google.com` was blocked too. Everything was verified by transpiling the JSX and
exercising the helpers against `MOCK_SNAPSHOT` — which is exactly how the mis-adopted
names above reached the live sheet.

Eric created a **Full Access** environment on 2026-08-24 to fix this. Reading the deployed
`scriptVersion` from the `/exec` URL works there (no sign-in needed), and that is how v23
was confirmed live on 2026-08-25. It still cannot sign in to Google, so verifying the live
Sheet stays a human step.

Opening the app in a real browser there works, but **not** by simply loading `index.html`:
the session's outbound HTTPS goes through a proxy that `curl` uses happily and **Chromium
cannot use at all** — every request dies with `ERR_CONNECTION_RESET` once the tunnel is up,
so React, Babel and the fonts never arrive and the page stays blank. Not a TLS-version,
ALPN or post-quantum issue; all three were ruled out against a logging shim.

What does work, and what steps 1 and 2 were finally verified against on 2026-08-25: mirror
the five esm.sh modules and Babel Standalone to local files with `curl`, generate a copy of
`index.html` whose import map points at them, and serve it over `http://127.0.0.1`. Drop the
fonts and the `accounts.google.com` script — Sandbox needs neither, and the sign-in screen's
"Continue in Sandbox" link still works without GSI loaded. Generated per run, never
committed, per the local-copy rule above. Worth turning into a committed script the next
time a session needs it, rather than rediscovering the proxy behaviour from a blank page.

Agreed but not yet built: a **local mock backend** — a small server speaking the same API
as `AssetTrackerSync.gs`, backed by a JSON file, with a local copy of `index.html` pointed
at it (generated per run, never committed). That covers the authenticated path, plus
failure modes production can't be asked to produce: a save conflict, an expired session, a
view-only user, the empty-assets guard, the "Backend outdated" banner. Rejected on the way
there: disabling sign-in or adding a test back door on the live deployment — the repo is
public, the backend URL is in it, and headless Google sign-in wouldn't have worked anyway.

## Deferred

- Deleting the legacy name columns from the sheet.
- Per-type custom fields — still blocked by the custom-column bug in BUGS.md, but no
  longer blocking anything else.
- "Fixed in place" as a real per-type setting rather than a list used once by the
  backfill. Worth revisiting if the add form's name suggestion earns its keep.
