# Parent/Child — live data migration plan

Written during the Stage 1 build (2026-08-19). **Nothing here has been run against live
data.** Deciding when — or whether — to run step 3 is Eric's call.

Companion to `PARENT_CHILD_ARCHITECTURE.md` (the design) and the "Parent chain" section of
`CLAUDE.md` (what shipped).

## The short version

**There is no migration you have to run for the app to work.** That was the point of building
the read-side fallback first. The app understands both the old shape and the new one, and the
new column fills itself in the first time anything is saved. The optional cleanup at the end
is cosmetic, and it's the only step with any real risk.

## What changed in the data

| | Before | After |
|---|---|---|
| A device's place | `roomId` → a Room's label | `parentId` → that Room's label |
| A Room's place | `buildingId` → a Building's label | `parentId` → that Building's label |
| A Condenser's place | `buildingId` → a Building's label | `parentId` → that Building's label |
| A Building's place | (nothing) | `parentId` → a Campus's label |
| A device's Building | inferred through its Room | walked up the parent chain |

**Campus is new and has no old data to convert.** Live buildings will come through step 2 with
no parent (correct — nothing above them existed), so they'll read as Unassigned until someone
creates the campuses and points the buildings at them. That's a normal edit through the app,
not a migration: create two Campus assets, then set each building's Parent. Doing it before the
campuses exist isn't possible and doing it after costs five edits.

`roomId` and `buildingId` still exist as sheet columns and are still read and written. They
are **not** kept in sync with `parentId` — once an asset is moved, they go stale. `parentId`
is authoritative.

## Step 1 — Deploy backend v17 (required) — ✅ DONE 2026-08-21

`AssetTrackerSync.gs` is at v17 — one combined script containing the `parentId` column, the `campus` column, and the public QR panel endpoint. One paste covered all three.

**This is done.** Confirmed by fetching the deployed `/exec` URL and reading `scriptVersion`
back as v17 on 2026-08-21 — not by trusting a note in a file, which is the only way this
should ever be confirmed. While it was pending, the live backend had no such column, so a
`parentId` the app sent was silently dropped and the app fell back to `roomId`/`buildingId`
on every load. Nothing broke; nothing new persisted either.

> ✅ **The clash with the QR panel work is resolved.** That change (which called itself v14)
> edited the same `doGet`, so pasting one over the other would have silently erased the first.
> Both are now merged into this one v17 script, so there is a single thing to paste. The
> sibling worktree still holding the original v14 is superseded — don't merge it.

Per `CLAUDE.md`: paste the file into the Apps Script editor **and create a new deployment
version** (Deploy → Manage deployments → pencil → Version: New version → Deploy). Saving
alone does not update the live `/exec` URL. Confirm afterwards that the app's "Backend
outdated" warning is gone.

**Reversible:** yes. Redeploying the previous version leaves the `parentId` column sitting unread in the sheet
and the old `roomId`/`buildingId` columns still populated and correct.

## Step 2 — Let the data migrate itself (automatic, no script)

Every save in this app rewrites the whole Assets tab (see the persistence model in
`CLAUDE.md`). On load, the app fills `parentId` in memory from `roomId`/`buildingId` for any
asset that lacks one. So **the first time anyone saves any asset-related change after step 1,
every asset's `parentId` is written to the sheet at once.**

No script, no bulk API call, no separate migration pass. This is the whole migration.

To do it deliberately rather than waiting: open any asset, edit a field, save it. That one
save populates `parentId` for all ~107 assets.

**Verify:** open the sheet's Assets tab and confirm the `parentId` column is populated —
Rooms holding a `BCB…` label, devices holding a `BCR…` label, Buildings blank, Bulk Items
blank.

**Reversible:** yes. `roomId`/`buildingId` are untouched by this step.

## Step 3 — Clear the legacy columns (optional, later, riskiest)

Only worth doing once the new shape has been trusted for a while — there's no functional
reason to hurry, and every day it waits is another day the rollback path stays open.

What it does: blanks the `roomId` and `buildingId` columns, then removes them from
`ASSET_FIELDS` in a later version of the backend.

Why it's worth doing eventually: those columns become stale the moment an asset is moved, so
anyone reading the sheet directly sees two answers to "where is this?" and no indication that
one of them is dead. That's a trap for a future reader, not a problem for the app.

Why it's the risky one: it is the only step that destroys information, and it closes the
rollback path — after it, redeploying an older version leaves every asset with no location at all.

**Do not run this until steps 1 and 2 have been live and correct for a meaningful stretch**,
and take a copy of the sheet first (File → Make a copy) so the previous state is recoverable.

## What to watch for after step 1

The app now flags parentage it considers wrong, on the asset's Details tab, rather than
failing quietly. Any of these appearing on live data after migration means something in the
old data didn't convert cleanly and wants a look:

- *"Its parent no longer exists"* — the old `roomId`/`buildingId` pointed at a deleted asset.
  This was already broken before; it was just invisible, showing an empty Room instead.
- *"A ‹type› can't sit inside a ‹type›"* — an asset whose old room/building link didn't match
  what its type is allowed to sit in.
- *"It's part of a loop"* — should be impossible from converted data, since the old two-field
  shape couldn't express one. If it appears, it came from a hand edit.

None of these break the app. Each is fixed by opening that asset, pressing Edit and choosing a
different parent (or Unassigned).

## What was deliberately NOT migrated

- **Bulk item allocations** still reference Rooms by `roomId` inside the allocations list.
  That's a distribution across many rooms, not a parent, and `PARENT_CHILD_ARCHITECTURE.md`
  puts it explicitly out of scope.
- **Circuits' `roomsServedIds`** still reference Rooms directly. Same reason — a circuit
  serves several rooms; that isn't containment.
- **Breakers and circuits** remain their own module, not assets with parents.
