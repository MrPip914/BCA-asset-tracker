# Splitting a person's name into first and last

A proposal, not a decision. Four options, a recommendation, and the things that
have to be settled before any of them is built.

## What the single string actually is today

A person is a **User asset**, and their name is the ordinary `name` field every
asset carries — read through `nameOf()`, written by the generic edit form, and
nothing about it is person-shaped. That is the string this is about.

Three other name-ish strings exist and are **deliberately out of scope**, because
each answers a different question:

- **`usersList`** — plain-string names on a tenant that has not run
  `convertUsersToAssets` yet. It is the pre-v28 shape and it feeds the same split,
  but at conversion time rather than as a second scheme (see "Legacy data" below).
- **`asset.person`** — the pre-v28 slash-joined names, trailing `personIds` as the
  reversible copy. It is written FROM ids and read only by `personNamesOf`. It
  takes whatever `nameOf()` produces and needs no change of its own.
- **`by` on an audit row, comment, work entry or photo** — the *actor*, snapshotted
  as text at the moment it happened, sourced from Google's `auth.name`. Splitting
  it would mean reading `given_name`/`family_name` from `tokeninfo` (a backend
  change) and would still leave every historical row single-string, since AuditLog
  is the one tab with no rewrite path. Leave it alone.

## What is already free, and what is not

Two things fall out of the existing architecture and are worth knowing before
costing any option:

- **Search needs no work.** The list filter ends in
  `Object.values(a).some(v => typeof v === "string" && ...)`, so any new string
  field on the asset is searchable the day it exists.
- **Export needs no work.** `exportToExcel` walks `columns` and gates each one on
  `fieldAppliesTo`, so a field restricted to User exports populated on Users and
  empty everywhere else, with no export-side edit.
- **A new ASSET_FIELDS entry is NOT free.** It is a backend version bump and a
  deploy to every tenant, released backend-first. A *custom* column is free —
  `customColumnKeys_` adds it to the Assets tab dynamically — which is what makes
  Option A cost nothing at all.
- **`name` is structural.** `TYPE_STRUCTURAL_FIELDS` holds `name`, so the type
  editor cannot untick it for User. Any option that wants the Name input to stop
  appearing on a User form is a code change, not a settings change.

## Option A — two custom fields on User, no code at all

Use the type editor: add `firstName` and `lastName` to the User type as per-type
custom fields. They become restricted custom columns, they persist, they sort,
they search, they export. **Cost: zero. No commit, no deploy.**

What it does not do: nothing composes them, so `name` stays the field that is
displayed everywhere and stays hand-typed. Two people would now have to be kept in
step by whoever types them, which is the exact failure this file warns about in
every other context.

Worth stating because it is available this afternoon and is the right answer if
the real need is "hold the surname somewhere I can filter on", not "restructure
what a person's name is".

## Option B — real fields, `name` composed on save (RECOMMENDED)

`firstName` and `lastName` join `ASSET_FIELDS`. The User form replaces its single
Name input with two, and saving a User writes
`name = [firstName, lastName].filter(Boolean).join(" ")`.

Everything downstream is untouched *because* `name` is still populated:
`nameOf()`, `personNamesOf()`, audit text, the Excel export, `panel.html`,
`panel-qr-sheet.html`, and the backend's own `displayName_()` all keep reading the
one field they already read.

- **The composition has exactly ONE writer**, which is what keeps the copy from
  going stale: the User branch of `saveDraft`. This is the same trade `person`
  takes behind `personIds` — a derived copy is acceptable when one place writes it
  and nothing else may.
- **It does not violate "computed, not stored"** in the direction that rule
  guards. That rule is about not storing a second copy of a *relationship*; this
  is a display string that four contexts outside the app's own render tree already
  read off the sheet.
- **Sorting by surname becomes possible** — `userNames`, the User column filter and
  the `UserField` chips sort on `lastName` when present and on `name` otherwise.
  This is the payoff; if it is not wanted, Option A is enough.
- **Cost**: the next backend version (`node deploy.mjs --status` says what each
  tenant is on — do not take a number from this file), deployed to dev, then to
  the school, then merged.

## Option C — first/last are the truth, `name` composed at render

Purest by the reference conventions, and the most expensive, because `name` is
read off the sheet by things that are not this app: the Name column's own sort
value, `exportToExcel`'s raw `a[c.key]`, `panel.html`, `panel-qr-sheet.html` and
`displayName_()` in the backend. Each would need the composition rule, which is
precisely the "nothing outside `nameOf()` should read a per-type name column"
ladder that v23 tore down. `adoptLegacyNames` also fills a blank `name` on every
load, so a User would have to be excluded from it or the two schemes would fight.

Not recommended. The purity buys nothing a single writer does not already buy.

## Option D — more than two fields

If the driver is matching against a SIS export or a mail merge, the shape wanted
may be `firstName` / `middleName` / `lastName` / `preferredName`, or a `sortName`
override for the names that do not split. If the driver is only "sort the list by
surname and show 'Smith, John'", then a single `sortName` field plus a display
format is cheaper than splitting anything.

**This is the question to answer before building A or B.** The rest of the plan
assumes first/last.

## Legacy data: splitting the names already on the sheet

- **A load-time read that fills a blank, never a rewrite.** `adoptPersonName(a)`
  sets `firstName`/`lastName` only when BOTH are empty, splitting `name` on the
  last space. It reaches the sheet inside whatever save happens next — no
  migration, no script, same shape as `adoptLegacyTag`.
- **The split is deterministic, so two browsers cannot disagree.** That is what
  makes a load-time adoption safe here and unsafe for the randomly-minted ids that
  caused the orphaned-photo bug: `a.id || a.label` is fine, `c.id ||
  crypto.randomUUID()` is not.
- **A wrong guess costs a retype and nothing else**, because the adoption never
  touches `name`. "Van Der Berg", "de la Cruz" and a suffix will land wrong; they
  are editable on the record.
- **`convertUsersToAssets` splits with the same helper**, so an unconverted tenant
  arrives in the new shape rather than needing a second pass. One
  `splitPersonName()` used by both, or they drift.
- **Do NOT build a review screen for this.** The conversion is a button because it
  mints labels from a counter and races; a deterministic split has neither problem
  and a confirmation screen for it is ceremony.

## Follow-ons that are cheap once B exists

- `lastName` can be marked **required on User** in the type editor — free, per-type
  required fields are already a `typeSettings` property.
- The **create path needs its own check**. `startAdd` and `duplicateAsset` must
  compose `name` too, not only the edit branch: a load-time adoption cannot cover
  the place a record is born, which is the lesson `addMaintenanceItem` taught.
- **Display format ("Smith, John") is deferred.** One composition, one order.

## Coverage

`test-frontend-personname.js`, driven by mutation:

- `splitPersonName` on one token, two, three, and a trailing empty.
- The adoption declining when either field is already set.
- The compose-on-save running on the ADD path as well as the edit path.
- The user list sorting by surname when present and by name when not.

Plus `test-backend-fields.js` for the two new `ASSET_FIELDS` entries, which is the
only place a backend write path can be covered at all.

## Release order if B is chosen

Backend first, merge second: deploy the branch to `dev`, then to the school, then
merge. Between the school deploy and the merge that school shows "Backend
outdated", which is correct and which the merge clears. `--status` is the gate
between each step.
