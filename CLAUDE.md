# BCA Asset Tracker

A school IT/facilities asset tracker for Brookside Christian Academy (Atascadero, CA),
originally built as a Claude.ai artifact and migrated to a standalone static site so it
could connect to a live Google Sheets backend (Claude.ai's artifact sandbox blocks
outbound network requests to arbitrary domains, which is why this migration happened).

## Working here

**Answer Eric at summary level by default, not at implementation level.** He wants enough
to understand the direction and make the call — the shape of the problem, the recommended
path, what it costs, what it blocks. Not the code tour that got you there. Leave out file
walkthroughs, function names, option-by-option comparisons and long tables unless he asks;
he will ask, and asking is cheap. This is about the CHAT, not the work: keep investigating
as thoroughly as ever, and keep writing this file, `BUGS.md` and commit messages at their
existing level of detail — those are records, where the reasoning is the point.

**A decision gets recorded in ONE place, chosen by kind.** A rule whose violation is
silent and destructive goes in this file; why a feature has the shape it does goes in its
`docs/` file; what changed this time goes in the commit message. Writing the same decision
into all three in different words is what grew this file to 198KB by 2026-09-11, and it is
the growth RATE that matters rather than any one entry — it was 58KB on 2026-08-16, and
this file is read in full at the start of every session, including the ones that never go
near most of it.

**A bug you find while doing something else goes in `BUGS.md`, not into the current
session.** Log it, mention it in one line at the end of your response, and carry on with
what was asked — Eric decides what gets fixed and when, and an unprioritized bug taking
over the thread costs him that. The one exception is a genuine blocker: say so
explicitly and name *which part* it blocks, not the whole task. Pass this instruction on
to any session you spawn; they inherit the same tendency.

**Deploying the backend is Eric's job, done from his phone, and you hand him this
verbatim — never the Apps Script editor steps.** `AssetTrackerSync.gs` changes are dead
until deployed, so whenever you change that file (or notice `SCRIPT_VERSION` here is ahead
of the live `/exec`), end your response with a deploy block.

**ASK WHICH BRANCH THE WORK IS ON FIRST, AND SEND EXACTLY ONE BLOCK.** The two below are
alternatives, not a sequence. On 2026-09-10 both were pasted, main-first, for work that
lived on a branch — Eric followed them in order, deployed `main`, and got a downgrade
refusal. He did nothing wrong; the instructions were wrong. If the change is not in
`origin/main`, the second block is the only correct one.

**A. The work is merged into `main`:**

> **Deploy v<NN>** — open this, then tap the commands in Step 3a:
>
> https://shell.cloud.google.com/cloudshell/open?cloudshell_git_repo=https://github.com/MrPip914/BCA-asset-tracker&cloudshell_tutorial=cloudshell-deploy.md
>
> Try it on dev first:
> `git checkout -B main origin/main && git pull --ff-only && node deploy.mjs dev`
>
> Then the school: `node deploy.mjs bca` (or `node deploy.mjs --all` for every tenant).
>
> Look for `✓ <tenant> is now v<NN>. Deploy confirmed.` as the last line. Anything
> starting with `✗` means it did not deploy, and says why.

**B. The work is on a branch (the normal case for anything just built):**

> **Deploy v<NN> to the dev tenant** — this is a branch deploy, so it does NOT use the
> Step 3a buttons.
>
> https://shell.cloud.google.com/cloudshell/open?cloudshell_git_repo=https://github.com/MrPip914/BCA-asset-tracker&cloudshell_tutorial=cloudshell-deploy.md
>
> Then tap the terminal and run:
>
> `git fetch origin && git checkout -B <branch> origin/<branch> && node deploy.mjs dev`
>
> Check line 2 reads `Deploying v<NN> from branch "<branch>" to "dev"`. If it says an
> older version or `branch "main"`, stop — the checkout did not take.
>
> Success is `✓ dev is now v<NN>. Deploy confirmed.` That is the dev tenant's own Sheet —
> throwaway data, nothing a school can see. To undo:
> `git checkout -B main origin/main && ALLOW_DOWNGRADE=1 node deploy.mjs dev`

**Do not put a school command in the same response as an unverified branch deploy.** Wait
for him to confirm dev, then send `node deploy.mjs bca` on its own.

**Releasing to a school is BACKEND FIRST, MERGE SECOND, and that ordering is not a
preference.** The frontend ships from `main` to every tenant at once while backends go one
at a time, so merging first puts a new frontend writing new columns in front of a school
whose backend still drops them — written, then silently gone. Deploy the branch to dev,
then to the school, then merge. Between the last two the school shows the "Backend
outdated" banner, which is correct and which the merge clears.

**Name the tenant. A bare `node deploy.mjs` now REFUSES** and lists them, because there is
more than one and guessing would deploy to a school instead of to dev. `node deploy.mjs
--status` says what each tenant is running — use it instead of stating a live version from
memory or from a line in this file.

**Deploying a BRANCH is block B above** — testing a backend change before merging is the
normal case for unmerged work, since Sandbox cannot cover a write path. The command is
written out once, there, deliberately: this section used to carry a second copy, and having
the main procedure and the branch procedure in two places is what let both get pasted
together in the wrong order.

Only send a branch to a school's tenant if he asks for that specifically, or as step 2 of
the backend-first release ordering above, and then say
plainly that it is their live data behind it. **This used to be the only option** — the
warning that a branch deploy is testing in production is kept below because it is still
true of a school's tenant, but it is no longer the default, and telling him to test on
production when dev exists would be wrong.

**Four files used to carry this procedure and two of them went stale**, which is what
made a deploy fail on 2026-09-10. The arrangement now, and `test-deploy-docs.js` enforces
it: `cloudshell-deploy.md` owns the PROCEDURE (its Step 3 is the main-or-branch choice);
this file owns the two BLOCKS above, which are what Eric is handed; `DEPLOY.md` is
reference and rationale only; `/deploy` generates a block and carries no strings of its
own. **And never write down what is deployed** — `node deploy.mjs --status` answers it per
tenant in one command; the same test fails the build on a "vNN is DEPLOYED" line, because
that claim went stale here four separate times and once cost a session real work.
**Never restate what `deploy.mjs` prints** — the slash command spent a month naming
a success line the tool has never printed, so a failed deploy read exactly like a good
one. Quote the tool, or point at it. If a fifth file ever needs deploy text, add it to
that test's `DOCS` list the same day.

That link opens Google Cloud Shell, clones this repo, and shows `cloudshell-deploy.md` as
a walkthrough where every command has a tap-to-run button. Eric's sign-in and Script ID
persist in Cloud Shell's `$HOME`, so a repeat deploy is that one tap — do NOT walk him
through the one-time setup again; the walkthrough covers it if it is ever needed. `/deploy`
prints this same block if you would rather not retype it.

Three things that make this non-optional rather than a convenience:
- **Never tell him to paste into the Apps Script editor.** That path still works and is
  documented in `DEPLOY.md` as the break-glass fallback, but it skips the version check
  below, which is the whole point.
- **Never deploy anything OLDER than what is live, and never assume what that is.** Ask
  the live `/exec`. An older backend does not merely roll behavior back — every save
  rewrites whole sheet tabs from the backend's own field list, so it DROPS columns a newer
  one added and the next save destroys that data. This happened: v22 was deployed over a
  live v24 from a branch that was simply behind `main`. `deploy.mjs` refuses to go
  backwards, which is the only reason a repeat is merely annoying.
  - **Deploying from a branch is allowed and is sometimes the point** — Eric needs to test
    a backend change before merging, since Sandbox mode never contacts Apps Script and so
    cannot cover a write path at all. An earlier version of this rule said "never deploy
    from a feature branch", which conflated *behind* with *unmerged* and left him told to
    merge untested code. Branch-ness is not the hazard; being behind is.
  - What IS true: a school's `/exec` is the one that school uses, so pushing an untested
    branch *there* is testing in production. Say so plainly rather than refusing — but
    since 2026-09-08 the **dev tenant** is the place for it, and that sentence is now
    about a deliberate exception rather than about the normal case.
- **The frontend ships separately** (GitHub Pages, from `main`) and has run ahead of both
  the backend and `main` before. Matching `SCRIPT_VERSION` and `FRONTEND_SCRIPT_VERSION`
  in the same commit is what keeps the pair honest; deploying one without the other is
  what the "Backend outdated" banner is for.

## Files

- `BUGS.md` — known bugs, why they happen, whether fixing one needs an Apps Script
  deploy, and what each blocks. Read it before starting anything substantial.
- `clients.js` — the tenant registry: one entry per school, holding everything that
  differs between them (backend URL, app/org name, asset-ID prefix). Loaded by
  `index.html`, `panel.html` and `panel-qr-sheet.html` in `<head>` before anything else
  runs. See `docs/multi-tenant.md`.
- `index.html` — the entire app. No build step, no npm install. React, ReactDOM,
  lucide-react (icons), and xlsx (SheetJS, for the Excel export button) are all loaded
  from esm.sh/unpkg via an import map. Babel Standalone transpiles the JSX in-browser
  at load time. To edit: just edit the JSX inline inside the `<script type="text/babel">`
  block and reload — no build/compile step exists or is needed.
  - **The Sandbox fixture is NOT in here — it is `mock-data.js`** (2026-09-11). At ~600
    lines it was the biggest non-code thing in the file and it sat in the middle, so a
    search for a domain term found the fixture rather than the code: 101 of 132 matches
    for `roomsServedIds`, 112 of 186 for `circuits`. It is a factory, not a plain object,
    because the fixture names three things that belong to `index.html` and must stay
    single-sourced there — `FRONTEND_SCRIPT_VERSION`, `SEEDED_BREAKER_TYPES`, `relate`.
    `test-frontend-mockdata.js` guards the joints, including the one that only fails on
    the published site: `MOCK_SNAPSHOT` is read at module scope, so a `mock-data.js`
    missing from the Pages artifact is a blank app, not a broken Sandbox.
- `mock-data.js` — the Sandbox fixture, and only that. See the `index.html` entry above.
- `run-tests.mjs` — runs every `test-*.js` / `test-*.mjs` in the repo and prints ONE
  summary. `node run-tests.mjs` is the "did I break anything" pass; run a single file
  directly when one fails, for its full output. Discovery is by filename, not a list, so a
  new test is covered the day it is written. There is no package.json and deliberately no
  test framework — each test slices its subject out as source text and exits non-zero.
- `docs/` — the per-feature reasoning that used to live in this file. See "Where the
  detail lives" below.
- `sheet.mjs` — direct read/write access to a tenant's Google Sheet via the Sheets API
  and a service account, bypassing the app and its backend entirely. For data CLEANUP —
  the fixes that have no UI and shouldn't grow one. `test-sheet-tool.mjs` unit-tests its
  pure logic. See `docs/sheet-access.md`, which is required reading before using it.
- `AssetTrackerSync.gs` — Google Apps Script backend, deployed as a Web App bound to a
  Google Sheet. This is NOT part of the static site deploy — it lives entirely inside
  Google's infrastructure. **Deploy it with `node deploy.mjs <tenant>`** (see `DEPLOY.md`),
  once per tenant — each has its own Apps Script project — which
  pushes this file, cuts a new version, repoints the existing deployment so the `/exec`
  URL is unchanged, and then fetches the live `/exec` to confirm the backend really is
  reporting the new version. Needs a one-time `clasp login` wherever it runs; Google's
  Apps Script API rejects service accounts, so it always acts as Eric — but that only
  rules out an unattended *robot*, not a browser. **Google Cloud Shell is the intended
  home** (`cloudshell-deploy.md` is a tap-to-run walkthrough; the link is in `DEPLOY.md`):
  its `$HOME` persists, so the sign-in and Script ID are entered once ever and later
  deploys are one command from a phone. A Claude Code cloud session is NOT a viable
  host — the sign-in is blocked there as credential handling, which is why the config
  falls back to `~/.bca-asset-tracker-deploy.json` rather than a repo file that a fresh
  clone would not carry. The manual equivalent — paste into the Apps Script
  editor, then Deploy > Manage deployments > pencil icon > Version: New version > Deploy —
  still works and is the fallback if the tooling breaks.
  Just saving the script does not update the live `/exec` URL. This exact mistake
  happened once already (silently — Maintenance and Breakers/Circuits both appeared
  to work in-session but never actually reached the sheet, for several redeploy
  cycles, before `SCRIPT_VERSION` caught it) — so **whenever you edit this
  file, bump `SCRIPT_VERSION` at its top *and* the matching `FRONTEND_SCRIPT_VERSION`
  near the top of `index.html`, in the same commit.** `loadData()` compares the two
  on every load and shows a "Backend outdated" warning (with both version strings in
  its tooltip) if the live backend doesn't match — the fast way to confirm a redeploy
  actually landed, instead of only finding out when a feature quietly fails to persist.
  - **The version is JUST A NUMBER — `"v20"`, nothing more.** It used to carry a
    description of the change, which grew into a multi-paragraph changelog inside a
    string constant duplicated across two files that must match character for
    character. At v18 the two copies drifted by one word (`here` vs `there`), which
    would have shown a permanent false "Backend outdated" warning; it went unnoticed
    only because sign-in was broken and nobody reached the header. **What changed in a
    version goes in the commit message and in this file, not in the constant.**

## Where the detail lives

**This file is the part that applies to every change. The reasoning behind each feature
lives in `docs/`, and is NOT loaded automatically — open the one you need before you touch
that area.** The split happened on 2026-09-11 because this file had reached 198KB and was
being read in full at the start of every session, including the ones that never went near
most of it. Nothing was rewritten or summarised: the prose moved verbatim.

**The rule for what lives where: a rule whose violation is SILENT and DESTRUCTIVE stays in
this file, because a session that never opens the right doc still has to know it. Everything
that explains why a feature has the shape it does moved out.** If you find yourself adding a
feature narrative here, it belongs in `docs/`; if you find yourself putting a
data-destroying invariant in `docs/`, it belongs here.

| Touching this | Read first |
| --- | --- |
| State, persistence, `persist()`, auth, sign-in, the toolbar or header, `ChildEntityTable`, column filters | `docs/architecture.md` |
| Containment, `parentId`, place pickers, `HierarchyNav`, paths | `docs/parent-chain.md` |
| `TYPE_REGISTRY`, the type editor, categories, custom fields, required fields, column data types | `docs/type-system.md` |
| Back/Home, the address bar, deep links, scroll position | `docs/navigation.md` |
| Maintenance schedules, work/change entries, completions | `docs/maintenance-work.md` |
| Panels, breakers, circuits, the panel diagram, the printed door card | `docs/panels-breakers.md` |
| Photos, uploads, galleries, the public panel page's photo scope | `docs/photos.md` |
| User assets, `personIds`, audit entries and `related` | `docs/users-and-audit.md` |
| Asset identity — `id`, `label`, `tag` — or the one-time id migration | `docs/asset-key.md` |
| `clients.js`, tenant resolution, the Pages workflow, anything naming a school | `docs/multi-tenant.md` |
| Reading or writing a Sheet directly with `sheet.mjs` | `docs/sheet-access.md` |
| Sandbox mode, `MOCK_SNAPSHOT`, or how to verify a change | `docs/sandbox-and-testing.md` |
| Wondering what real data looks like, or why a guard exists | `docs/live-data-and-incidents.md` |
| A known bug, before starting anything substantial | `BUGS.md` (fixed ones: `docs/bugs-fixed.md`) |

Longer-form plans and evaluations that predate or explain a whole feature —
`PHOTOS_EVAL.md`, `ASSET_KEY_REFACTOR_PLAN.md`, `TYPE_MANAGEMENT_PLAN.md`,
`MULTI_CLIENT_DEPLOYMENT.md`, `DOORS_LOCKS_KEYS_NOTES.md`,
`BREAKER_TYPES_ARCHITECTURE.md`, `PARENT_CHILD_MIGRATION.md` — are still where they were.
The `docs/` file is the summary of record; the plan is the long form.

## Reference conventions — apply these to any new module

The rules the existing modules already follow, stated once so a new one doesn't have to
rediscover them:

- **A reference from one Asset to another stores the target's `label`** — `parentId`,
  `allocations[].roomId`, `Circuit.roomsServedIds`, `Breaker.panelLabel`,
  `Circuit.feedsPanelLabel` — never the target's display name. Resolve to a name at render
  time (`nameOf()` via `parentNameFor()`/`roomNameFor()`), and handle a dangling id gracefully
  ("(deleted asset)") rather than throwing.
- **Containment is `parentId` and nothing else.** If a new type needs to sit inside something,
  give it `parentTypes` in the registry — do not add a second placement field. The whole point
  of collapsing `roomId`/`buildingId` into one reference was that two fields could only ever
  describe the one hierarchy their names happened to encode.
- **A reference to a sub-entity stores its `crypto.randomUUID()` id** — `Circuit.breakerId`,
  a Breaker's `groupId`/`breakerTypeId`. Breakers, Circuits, and BreakerTypes aren't Assets
  and have no `label`, so the UUID is their only stable handle; array position isn't one,
  since they get swapped and moved.
- **Labels are never renamed.** Nothing keeps referring holders in sync on a rename, and
  nothing should have to — an asset that's wrong or retired is archived and a replacement
  gets a new label. That's why `label` is editable in the add form only.
- **Computed, not stored, for anything derivable from a reference that already exists.** A
  device's building comes from walking up its parent chain (`buildingNameOf()`); a panel's "fed from" comes from
  searching all circuits for `feedsPanelLabel === thisPanelLabel`. Don't add a stored field
  mirroring a relationship the other side already records — it's just a second copy to keep
  in sync, and the one that goes stale.

## Never write down what is deployed, or what is on a live Sheet

**Nothing in this repo's prose records what is deployed, or what is on a live Sheet.** Both are one
command away, and both have gone stale in this file — deploy state four separate times,
the Sheet's own schema once, and that one outlived ten backend versions because no banner
catches it:

    node deploy.mjs --status        which tenant runs which backend version
    node sheet.mjs tabs <tenant>    what columns a live Sheet actually has

`test-deploy-docs.js` fails if a live-version claim reappears in prose. What belongs here
is the RULE a version taught, which does not expire. When a version is genuinely mid-flight
and the window matters — "categories work in-session and vanish on reload until this is
deployed" — that note goes in the branch's commit message or its plan file, where it dies
with the branch instead of outliving it here.

## What costs a backend release, and what a removal destroys

- **A property on an existing Config blob is free; a Config KEY of its own is a release.**
  `doPost` stringifies the whole `columns` and `typeSettings` blobs and reads nothing inside
  them but `customColumnKeys_`, so a column's `dataType` or a type's `requiredFields` cost
  nothing. But `doPost` writes a FIXED list of config keys and silently drops the rest, so a
  new key — `typeCategories`, and `typeSettings` before it — is discarded on every save until
  it is deployed. **This is the test to run against any future per-field or per-type setting**
  before estimating it.
- **`ASSET_FIELDS` is the schema, and dropping a name from it deletes that column on the next
  asset-domain save.** `writeTable_` clears the tab and writes those headers. The Sheet's own
  version history is the only way back — that is the entire rollback story. So treat any
  removal the way v25's six columns were treated: confirm the replacement column is populated
  on every row, and deploy only after a save has written it.
  - What a removal takes with it can be unrebuildable. `hasMisadoptedName()` repaired names
    written by a broken backfill by comparing against `room`/`building`/`campus`; with those
    columns gone a wrong name can no longer even be *detected*, only retyped. That is why the
    removal waited for a save that wrote every repaired name into the sheet.
  - **A public page reading a column needs the fallback FIRST.** Three sites in `panel.html`
    read `room`/`building` with no `name` fallback, unlike the rest of the file — harmless
    while the column was still written, and a blank location on every QR page the moment it
    was not.
- **AuditLog is the one tab with no rewrite path, and it has its own hazard.** It is
  append-only, so its header row is written once and never again: adding a column to its field
  list does NOT widen the stored header, and `readTable_` — which keys off the *sheet's*
  headers — then reads every new column back as `obj[""]`, colliding them onto one key and
  losing the data. Silently, with `SCRIPT_VERSION` still matching its frontend, because the
  script really is the version it claims. `appendNewRows_` now widens a narrow stored header
  and never shrinks one (dropping a column would strand the values under it).
- **The Assets tab's column set is dynamic** — the fixed `ASSET_FIELDS` plus the custom columns
  named in Config (`customColumnKeys_`). That is what makes a custom column's value persist at
  all, and therefore what per-type custom fields rest on.
- **A backend write path cannot be covered by browser testing, structurally.** Sandbox never
  contacts Apps Script and the live backend needs a sign-in, so a `.gs` change is verified by
  slicing the source out and unit-testing it: `test-backend-fields.js`, `test-backend-admin.js`,
  `test-backend-assetid.js`, `test-backend-maintenance-link.js`. Keep the habit.
- **`doGet` and `doPost` are two halves of one contract.** If they key on different things,
  every comment, change, allocation, maintenance item, breaker and circuit is written under one
  key and read under another — they vanish, silently, with the version check still matching.
  `test-backend-assetid.js` slices BOTH blocks out as source text and round-trips fake data, so
  changing one side and not the other fails. Verified by mutation.
- **The admin import reads a TAB in the Sheet, not Drive.** The `DriveApp` version failed at
  runtime — "You do not have permission to call DriveApp.getFilesByName" — because the live
  manifest declares its `oauthScopes` explicitly, so Apps Script does not auto-detect a newly
  used API's scope. See "Wipe and import" in `docs/architecture.md` for why adding the scope is not
  free either. **The rule: use an API the script already holds a scope for.**
- **`_dirty` on the read payload is load-bearing — do not remove it.** `loadData()` sends
  `_dirty: { assets:false, config:false, breakerTypes:false }` explicitly. Against a backend too
  old to recognise `op:"read"`, the read is treated as an ordinary save; a read payload carries
  no assets, and absent `_dirty` means "rewrite everything", so the first load of a new frontend
  against an old backend would blank the Assets tab and every child tab with it. With the flags
  present the old backend writes *nothing* and the load fails cleanly on "Malformed response".
  The current backend never reads them.

## Release ordering, and the deploys that went wrong

- **BACKEND FIRST, MERGE SECOND.** The frontend ships from `main` to every tenant at once
  through GitHub Pages, while backends deploy one tenant at a time. Merging first puts a
  frontend writing new columns in front of a school whose backend still drops them — written,
  then silently gone. Deploy the branch to `dev`, then to the school, then merge; `--status` is
  the gate between each step. Between the school deploy and the merge that school shows the
  "Backend outdated" banner, which is correct and which the merge clears.
- **Read the VERSION in the confirmation line, not the checkmark.** A deploy once reported
  `✓ bca is now v30` when v31 was intended: Cloud Shell was checked out on `main`, which still
  carried v30, so it deployed v30 over v30. Harmless only because the versions were equal —
  against a newer tenant `deploy.mjs` would have refused it as a downgrade. **The tutorial link
  clones the DEFAULT branch**, so a re-opened link silently puts you back on `main`; unmerged
  work needs `git fetch origin && git checkout -B <branch> origin/<branch>` first.
- **Never deploy something OLDER than what is live.** v22 was once pushed over a live v24 from
  a branch that was simply behind `main`. An older backend does not merely revert behaviour —
  it drops columns a newer one added, and the next save destroys that data. `deploy.mjs` refuses
  to go backwards, which is the only reason a repeat is merely annoying.
- **Two branches cannot both call themselves the next version.** v14, v15 and v16 were each
  pending on their own branch, each claiming to be next, and all three edited the same `doGet` —
  so deploying one after another would have silently erased the first, while each also bumped
  `FRONTEND_SCRIPT_VERSION` to its own string, making the "Backend outdated" banner report a
  *match* against a script missing half the change. They were merged into one version rather
  than renumbered, because renumbering alone leaves the same trap somewhere else.

## Known constraints / things to watch

- Access changes aren't written to the audit log. The log is keyed by `assetLabel` and
  every row describes an asset event, so "Jane was made view-only" has nowhere natural to
  sit. Worth revisiting if who-changed-whose-access ever needs answering.
- ~~Individual edit controls are still rendered for view-only users~~ — **done.** Edit
  affordances are gated on `canEdit`, by cluster rather than per button. Shared components
  (`ChildEntityTable`, `PanelDiagram`, `BreakersTabContent`) take a `canEdit` prop.
  - **Hiding is still only cosmetic — `persist()` and `doPost` remain the control.** Anything
    here can be undone from a browser console, so a missed control is a rough edge, never a
    hole. Add new edit UI behind `canEdit`, but never rely on it alone.
  - Deliberately still available to viewers: Columns (per-device visibility, never
    persisted), Export, Copy link, the QR sticker, expand/collapse, search, sort, and
    opening a breaker to read it. Empty panel slots still render — "nothing in slot 14" is
    information a viewer wants, they just can't click it into existence.
  - The breaker modal needed only its pencil gated: Save and Delete render solely while
    `editing`, and the pencil is the only way in. Worth knowing before adding actions there.
  - To test either role without a second Google account, temporarily force
    `const canEdit = false` (it's one line) and use Sandbox mode.
- **Inline styles are ~114KB of `index.html` across ~1000 sites, and ~44KB of that is
  strings repeated three or more times.** Collapsing the most-repeated into named style
  constants would take ~30KB off the file and make the JSX far more scannable, but it
  touches a thousand sites that all render visible output. **Do it per-tab, when that tab
  is being worked on anyway** — the way `BreakersTabContent` came out — not as a refactor
  pass of its own.
- `index.html` crossed 500KB with v18, so Babel Standalone now logs a "code generator has
  deoptimised the styling" note on every load. Harmless, but it means in-browser transpile
  time is no longer trivial — relevant to the long-standing "should this get a build step"
  question, and to the reason `panel.html` was kept as a separate small page.
- Apps Script free-tier quota is ~90 min of script runtime/day — comfortably enough
  for this app's usage pattern, but worth knowing if it ever gets flaky under heavy
  simultaneous use.
- Conflict detection exists as of backend v12 (see "Optimistic concurrency" in
  `docs/architecture.md`) but is **detect-and-reject, not merge**: the second person's save is
  refused outright and they have to redo their change against freshly reloaded data.
  Nothing auto-merges, and there's no live "someone else just changed this" indicator —
  you find out at save time. Note it only guards against a *stale* save; two people can
  still take turns overwriting the same field, each on current data.
- **Date-only fields and Sheets auto-conversion**: any plain "yyyy-MM-dd" string (a
  maintenance item's `lastPerformed`, a breaker's `installedDate`, `purchaseDate`,
  `warrantyUntil`) used to come back from the Sheet as a full ISO timestamp instead —
  Google Sheets auto-detects a date-looking string on write and silently converts the
  cell to a real Date, which then serializes as `"2026-06-03T07:00:00.000Z"` rather than
  the plain string the app expects. Fixed two ways (`SCRIPT_VERSION` v3): `writeTable_`/
  `appendNewRows_` now force the written range to plain-text format (`setNumberFormat("@")`)
  before writing, so it won't happen again; and the frontend's `dateOnly()` helper
  normalizes any value that already round-tripped this way (slices to the first 10 chars)
  wherever a date-only field is parsed or fed into a `type="date"` input, so already-
  corrupted rows in the Sheet still display and compute correctly without a data migration.
- Deferred features discussed but not built: a physical audit/walkthrough mode, live
  auto-refresh of stale data between users, audit log pruning, cross-panel circuit moves
  (same-panel only today — see Move Circuit in `docs/panels-breakers.md`).
- **Planned next**: Doors/Locks/Keys, reusing `ChildEntityTable`. Keying is many-to-many (one
  key opens many locks), not a tree like Panel→Breaker→Circuit — will need its own join-table
  design (`LockKeys`) and its own facility-wide view, not bolted onto the Panels tree pattern.
  See `DOORS_LOCKS_KEYS_NOTES.md` for why `LockKeys` has to be top-level shared state with its
  own sheet tab (the `breakerTypes` pattern) rather than an array nested in a Door asset.
