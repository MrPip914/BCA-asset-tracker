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

**A FINISHED PIECE OF WORK IS A FEW LINES: what it now does, and anything he has to decide.**
Reasserted 2026-09-11, when a "summary" of the type-labels rework still ran eight paragraphs
with headings. The tell is a reply that explains WHY a decision was right — no deploy needed,
old data still resolves, grouping had to go — none of which he asked for. That reasoning is
already in the commit message and in this file, which is exactly why it does not belong in
the chat as well. **Do not report verification unprompted either** (tests run, browser driven,
mutation-checked): doing it is the job, and listing it is the same padding wearing a badge.
He will ask.

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
  runs. See "Multiple clients" below.
- `index.html` — the entire app. No build step, no npm install. React, ReactDOM,
  lucide-react (icons), and xlsx (SheetJS, for the Excel export button) are all loaded
  from esm.sh/unpkg via an import map. Babel Standalone transpiles the JSX in-browser
  at load time. To edit: just edit the JSX inline inside the `<script type="text/babel">`
  block and reload — no build/compile step exists or is needed.
- `sheet.mjs` — direct read/write access to a tenant's Google Sheet via the Sheets API
  and a service account, bypassing the app and its backend entirely. For data CLEANUP —
  the fixes that have no UI and shouldn't grow one. `test-sheet-tool.mjs` unit-tests its
  pure logic. See "Direct Sheet access" below, which is required reading before using it.
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
  cycles, before `SCRIPT_VERSION` below caught it) — so **whenever you edit this
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

## Direct Sheet access (`sheet.mjs`)

**Claude Code can read and write a tenant's Sheet directly, through the Sheets API with a
service account** (Eric's call, 2026-09-09). This is for **data cleanup** — correcting a
mis-typed parent across forty rows, seeding the dev tenant, reshaping an incoming client
inventory — work the app has no UI for and that Eric explicitly did not want to build one
for. It is not a second way to do what the app already does.

**It bypasses `doPost`, and therefore every guard this project has.** No editor/viewer
role check, no audit row describing what changed, no server-side refusal of a destructive
write. That was the accepted trade, stated when the decision was made rather than
discovered later. **File > Version history remains the only real undo**, exactly as it was
for the 2026-08-21 data-loss incident.

- **Access is per-Sheet and structural.** The service account
  (`asset-tracker-claude@bca-asset-tracker-test.iam.gserviceaccount.com`) holds **no project
  role**; it reaches a spreadsheet only because that spreadsheet was shared with it, like a
  person. So a tenant is opted in one Share dialog at a time, and the Drive API is
  deliberately NOT enabled — without it the account cannot enumerate or find files at all,
  only open the ids it is handed. As of 2026-09-09 only the **dev** Sheet is shared.
- **The credential is a downloaded key and lives in `$HOME`, never the repo**, which is
  public: `~/.bca-asset-tracker-sheets.json` (the key, as Google emitted it) and
  `~/.bca-asset-tracker-sheets-tenants.json` (`{ "dev": "<sheetId>" }`). Same convention and
  same reasoning as `~/.bca-asset-tracker-deploy.json`. **A cloud Claude Code session cannot
  use any of this** — its container is re-cloned per session and holds no `$HOME` state — so
  this is a LOCAL-only capability, unlike everything else in the repo.
  - **Two `$HOME` files now key off the same tenant ids, and they are deliberately separate.**
    `set-tenant.mjs` writes `~/.bca-asset-tracker-deploy.json` (`tenants.<id>.scriptId`), and
    `sheet.mjs` writes `~/.bca-asset-tracker-sheets-tenants.json` (`<id>: sheetId`). Folding the
    sheet id into the deploy config would look tidier and be wrong: they live on **different
    machines**. The deploy config's home is Cloud Shell's persistent `$HOME`, which is what makes
    a redeploy one tap from Eric's phone; the sheets config is on his Windows machine, next to a
    service-account key that must never reach Cloud Shell. Merging them would either drag the key
    somewhere it does not belong or leave half the file meaningless wherever it sat.
- **Zero dependencies, deliberately.** The service-account JWT is signed with `node:crypto`
  and exchanged for an access token by hand, ~20 lines. This repo has no build step and no
  `node_modules`, and a cleanup tool that needs an `npm install` first is one that doesn't
  get run when it's needed.

**Four rules it replicates from `AssetTrackerSync.gs`, because their failure is silent and
each has already cost this project something:**

- **Plain text before values.** A `repeatCell` setting `numberFormat: TEXT` runs BEFORE the
  write, and `valueInputOption` is `RAW`. This is `writeTable_`'s `setNumberFormat("@")` met
  from the REST side — without it Sheets converts a `yyyy-MM-dd` string into a real Date that
  reads back as a full ISO timestamp. Ordering is load-bearing: formatting afterwards is too
  late, the cell is already a Date.
- **The sheet's own header row is authoritative.** `readTable_` keys every row off whatever
  the sheet says, so a write that reorders or drops headers silently re-labels every value
  under them. `sheet.mjs` fills the EXISTING header order and never rewrites the header row.
- **An unknown key is refused, not dropped.** A typo (`lable`) would otherwise be ignored and
  the write would report success while the value never landed. Adding a real column is a
  schema change and belongs in `ASSET_FIELDS`, not here.
- **Writing zero rows over a populated tab needs `--allow-empty`.** The same shape as
  `doPost`'s mass-deletion guard, for the same reason: in a full-overwrite model "I sent
  nothing" and "delete everything" are the same request on the wire.

**And one thing it does that the app cannot do for itself: it bumps the revision counters.**
A browser left open holds a pre-cleanup snapshot, and its next save would overwrite the whole
edit. Bumping `rev_assets`/`rev_config`/`rev_breakerTypes` makes that save fail `doPost`'s
optimistic-concurrency check, so the app reloads instead of clobbering. `write` does it
automatically for the domain of the tab it touched (`TAB_DOMAIN`), and it is **not optional** —
it is the single cheapest thing that stops direct editing from fighting the app. Note
`AuditLog` has no counter and is deliberately absent from that map: it is append-only.

Every `write` also dumps the whole Sheet to `~/.bca-asset-tracker-backups/<tenant>-<stamp>/`
first. Not a substitute for version history — it is local and unversioned — but it is
immediate and diffable, which version history is not.

**`test-sheet-tool.mjs` covers the pure logic** (header authority, unknown keys, missing keys
padding rather than shifting, `colLetter` past Z). It is the only place that logic *can* be
covered: Sandbox never contacts anything, and rehearsing a destructive write against a live
Sheet is the thing being avoided.

## Local Sandbox mode

A "Sandbox" pill in the top-right of the header (next to the name tag) toggles between
the real Google Sheet and a local fixture (`MOCK_SNAPSHOT` in `index.html`) — added so
UI iteration doesn't have to touch live data or wait on Apps Script redeploys/cold
starts. OFF by default (talks to the real Sheet); the toggle state is remembered
per-device via `localStorage` (`SANDBOX_MODE_KEY`).

- **When ON**: `loadData()` reads `MOCK_SNAPSHOT` (or, after the first edit, the
  saved-over copy in `localStorage` under `SANDBOX_DATA_KEY`) instead of fetching
  `SHEET_API_URL`; `persist()` writes back to that same `localStorage` key instead of
  POSTing to Apps Script. **No network call to the real backend happens at all while
  Sandbox is ON** — safe to add/delete/break things freely. A "Reset" button next to
  the pill wipes the `localStorage` copy back to the original `MOCK_SNAPSHOT` fixture.
- **When OFF**: behaves exactly as before this existed — real fetch, real writes.
- `MOCK_SNAPSHOT` is a trimmed, hand-maintained subset of the real inventory (not all
  107 real assets — that would bloat the file for no benefit), but keeps the full
  Electrical Panel/Breaker/Circuit structure intact since that's the area under active
  development. Update it by hand (it's plain JS data) when you want the sandbox to
  start from a different baseline, e.g. after a schema change, so new development has
  fixture data that already matches the new shape instead of stale pre-change data.
- Backend schema changes (a new `BREAKER_FIELDS`/`CIRCUIT_FIELDS`/`ASSET_FIELDS` entry
  in `AssetTrackerSync.gs`) can be fully built and tried out in Sandbox mode — including
  by Claude Code, which can flip the toggle via the same UI — without needing a redeploy
  first. Only flip Sandbox OFF and redeploy once the feature is actually done, so a
  schema change only needs *one* "paste + redeploy" instead of one per iteration.

## Where the site is published

Two builds of the same repo, on one domain, published by `.github/workflows/pages.yml`:

    https://assets.stama.tech/        main — what clients use
    https://assets.stama.tech/dev/    dev  — where changes get tried first

**GitHub Pages' Source must stay set to "GitHub Actions"** (Settings > Pages). The simpler
"deploy from a branch" setting serves exactly ONE branch, which is why this exists: "test it
on Pages from my phone" and "this is what every client is running" used to be the same URL.
That was survivable while Brookside was the only user of production and is not now.

**The `github-pages` ENVIRONMENT must also allow the `dev` branch** (Settings > Environments
> github-pages > Deployment branches). GitHub creates that environment restricted to the
default branch, so a run triggered by a push to `dev` is refused before any step executes —
the job fails in ~2 seconds with no logs, which reads like a broken workflow rather than a
permission rule. If `/dev/` ever stops updating on a push to `dev` while a manual "Run
workflow" from `main` still works, this is why.

- **A subfolder, not a `dev.stama.tech` subdomain, because of Google sign-in.** Sign-in only
  works from an origin registered on the OAuth client. A subfolder is the SAME origin, so it
  needs no registration and cannot break sign-in; a subdomain would need adding, and the day
  it is forgotten sign-in fails in a way that looks like a bug in whatever was being built.
- **The workflow always checks out `main` explicitly for the root**, rather than publishing
  whatever ref was pushed — so a push to `dev` republishes the current live site unchanged
  at the root, instead of putting dev's code in front of clients.
- **`/dev/` is skipped, not failed, when no `dev` branch exists.** The branch is checked for
  with `git ls-remote` first, so the live site still publishes normally on its own.
- **`CNAME` must stay in the artifact.** It is what claims the custom domain; the workflow
  asserts it (along with `index.html`, `clients.js` and `panel.html`) rather than publishing
  a half-assembled site, which would look like the app itself had broken.
- **`isDevBuild` is derived from the PATH, in `clients.js`** — not stamped in by the publish
  step. A build-time rewrite would make the two copies differ in their source, which is the
  thing this whole design avoids, and it would not work when running locally.
- **A dev build defaults to the `dev` tenant** when one exists, so untested code cannot
  casually write to a client's live Sheet just because someone opened `/dev/` with no query
  string. An explicit `?client=` still wins — reproducing a client bug against real data is
  sometimes the point, and it should take saying so.
- **The `Dev` badge is not decoration.** The two builds are identical apart from which
  branch built them, so without a marker "am I looking at dev, or at what clients have?" is
  unanswerable at a glance — and getting it wrong means either testing against real client
  data or believing a fix shipped when it only ever ran in dev. It renders in the header,
  on the sign-in screen (which is where you would first notice), and as a `Site` row in
  About.

## Multiple clients (tenants)

The app runs for more than one school from **one deployed frontend**. A tenant is a Google
Sheet + its own bound Apps Script deployment + an entry in `clients.js`; picked per request
with `?client=<id>` (or `?c=<id>`, the short form for QR stickers), defaulting to `bca`.
`MULTI_CLIENT_DEPLOYMENT.md` is the full plan, including the release order and how to
onboard one.

- **The backend needed no change at all, and that is the load-bearing fact.**
  `AssetTrackerSync.gs` reads its Sheet through `SpreadsheetApp.getActiveSpreadsheet()` and
  never `openById`, so the identical file deploys unchanged to any number of script
  projects, each bound to its own Sheet. There is no tenant id in the backend, nothing to
  partition, and no cross-client query that could be got wrong — isolation is structural.
  The corollary is operational, not architectural: **a backend change now has to be
  deployed to every tenant** — `node deploy.mjs <tenant>` each, or `--all`.
  - **`node deploy.mjs --status` is how you learn which tenant is on which version.** It
    asks every tenant's live `/exec` and prints a table, needs no sign-in, and cannot go
    stale — unlike every "the live backend is vNN" line ever written into this file, three
    of which did. **Check, don't read**, now has a one-command answer.
  - **A bare `node deploy.mjs` refuses once there is more than one tenant** and lists them.
    Guessing would deploy to a school instead of to `dev`.
  - **`new-tenant.mjs` bootstraps a tenant; `deploy.mjs` cannot.** Deploy pulls the live
    project expecting to find an existing copy of the backend to overwrite, and *updates* an
    existing deployment — an empty project has neither. `new-tenant.mjs` creates the Sheet
    and bound script (`clasp create-script --type sheets`), pushes the backend with a
    manifest that declares the web app settings, creates the deployment, and records the ids.
    - **It deliberately does NOT declare `oauthScopes`** in that manifest. Brookside's live
      manifest does, and that is exactly what made adding a Drive call fail at runtime (see
      "Wipe and import"). With no explicit list, Apps Script detects what each version needs.
    - **A new tenant still needs one manual step**: open its script editor once, run
      `forceAuthorizeExternalRequests`, approve the prompt. The web app executes as its
      owner, so until those scopes are granted every request to it fails. That cannot be
      scripted — it is a consent screen.
    - The `/exec` URL is built from the **deployment** id, not the script id.
  - **`set-tenant.mjs` records a tenant's ids** in `~/.bca-asset-tracker-deploy.json`, which
    lives only in Cloud Shell's `$HOME`. It folds a pre-multi-tenant config (one top-level
    `scriptId`) under the **default** tenant — read from `clients.js`, not assumed. The first
    version assumed it belonged to whichever tenant was being written, so recording `dev`
    silently deleted Brookside's script id; if the default cannot be determined it now leaves
    the flat keys alone rather than dropping them.
- **`window.ASSET_TRACKER_CLIENT` is the only source of per-school values.** Nothing else
  should name a school, a deployment URL or an ID prefix. `index.html` reads it once into
  `CLIENT` at module scope and derives `SHEET_API_URL`, `ASSET_LABEL_PREFIX`, `APP_NAME`
  and `ORG_NAME` from it. `ASSET_LABEL_RE` is *built* from the prefix rather than written
  out, or a tenant whose assets read `SMA0001` would count none of its own labels.
- **One file for every tenant, not one file per tenant.** Per-tenant JSON would have to be
  fetched before the app knew which backend to talk to — a round trip and a loading state
  in front of every page load, and an async step in a codebase with no build to absorb it.
  A `<script src>` is already resolved when the app starts. Splitting hides nothing either:
  the `/exec` URLs are public and are protected by sign-in, not obscurity.
- **`GOOGLE_CLIENT_ID` / `OAUTH_CLIENT_ID` stay SHARED and are deliberately not in
  `clients.js`.** Google only answers "is this really them?"; the per-Sheet `authUsers`
  allowlist answers "may they in". Holding a client id authorizes nothing, so one client
  leaks nothing between tenants, and it keeps the authorized-JavaScript-origins list to one
  entry rather than one per school.
- **Every `localStorage` key is namespaced by tenant** (`CLIENT.storageKey()` →
  `asset-tracker-session:bca`). All tenants share one origin, so without it opening client B
  after client A hands B's backend A's session id — rejected correctly, so not a hole, but
  it presents as a mysteriously broken sign-in, which is worse to diagnose than to prevent.
  **Namespaced for the default tenant too**, and `adoptLegacyStorageKeys()` migrates the
  pre-namespace values once instead. Letting the default keep the bare keys would have
  skipped that migration at the price of stored sessions silently transferring if
  `DEFAULT_CLIENT_ID` ever changed. **The adoption is default-tenant-only** — the bare keys
  were written when there was one tenant, so they belong to whoever the default is; adopting
  them for an arbitrary `?client=` would hand a second school the first one's session.
- **Every URL the app builds carries the tenant**, via `CLIENT.urlParam()` — the panel deep
  link, the QR-sheet link, and every printed sticker. It returns `""` for the default, so
  Brookside's links and stickers keep exactly the shape they already have. **A sticker is
  the one artifact here that cannot be redeployed**: it ends up taped inside a panel door,
  so one printed without the tenant resolves to the default forever.
- **An unknown `?client=` falls back to the default rather than refusing**, and the About
  panel's `Client` row says which tenant resolved and flags the fallback. Refusing would be
  no safer — access is decided by that tenant's allowlist, not by which config loaded — and
  a silent fallback with nothing on screen makes "why am I looking at the wrong school"
  unanswerable from inside the app.
- **`MOCK_SNAPSHOT` is still Brookside's fixture for every tenant.** Sandbox on a second
  school shows Brookside campus names. Harmless (Sandbox touches no backend) and left alone
  deliberately: the fixture is hand-maintained and generalising it is not what Phase 0 was
  for. Worth doing when a second tenant actually exists.
- **Per-client theming is deferred.** The palette is Brookside's, shared. Adding it later is
  a `theme` key in `clients.js` and nothing else.

## Architecture

- **Top-level navigation**: `mainTab` ("assets" | "maintenance") switches the main page
  between the asset list (`view === "list"`) and a site-wide Maintenance overview — every
  asset's `maintenanceItems` flattened into one sortable-by-urgency table (`allMaintenanceRows`).
  Both live inside the same `view === "list"` screen; opening an asset (either tab) still
  goes through `openDetail()` into `view === "detail"`, and `openDetail(asset, "maintenance")`
  jumps straight to that asset's Maintenance sub-tab — used by the overview's row click.
- **Navigation IS the address bar now** (2026-09-10). This bullet used to say the opposite —
  "the app never pushes into the address bar as you navigate (no back-button support, that
  wasn't asked for)" — and it was asked for: clicking through several assets left no way to
  trace back, because the in-app arrow always returned to the LIST no matter how deep you
  were, and the browser's own Back left the app entirely since the tab held exactly one
  history entry. On a phone, where Back is a system gesture, that second one is the harsher.
  - **Every navigation writes history, so the browser's stack IS the trail.** Opening an
    asset PUSHES `?asset=<id>&tab=<tab>`; switching tabs REPLACES. That split is the whole
    design: pushing on a tab click would bury the previous asset one press deeper per tab
    looked at, so Back would stop meaning "the thing I was looking at before" almost
    immediately. A `popstate` listener restores the view.
  - **No second breadcrumb strip, deliberately.** The app already has two — `HierarchyNav`
    above the list and the Path field on the detail page — and both answer *where does this
    live* (containment). A trail of *where have I been* is a different question wearing an
    identical costume, and a third crumb row would have made all three ambiguous. The back
    control NAMES its destination instead ("← Room 101"), which is the same information
    without a new visual language.
  - **`backTo` is stored in the history entry because the History API deliberately does not
    expose the previous one.** It holds the id, and the NAME is resolved at render time —
    the app-wide reference convention (see "Reference conventions"), applied to a reference
    that happens to live in history state, so a rename can't leave a stale word on a button.
  - **`navDepth` is what stops Back leaving the site.** It counts entries *this app instance*
    pushed; the control may only call `history.back()` above zero. At zero the user arrived
    on a deep link in a fresh tab, and popping would take them off the site — so it clears
    the detail params in place instead.
  - **`navUrl()` rebuilds the URL from the CURRENT search string** rather than assembling one,
    so every param that isn't ours survives. `c`/`client` is the one that matters: dropping it
    silently re-resolves a dev or second-school session to the default tenant on the next
    reload, and someone would be reading Brookside's live data believing they were on dev.
    Naming the tenant here would work and would be wrong — a second copy of the
    `CLIENT.urlParam()` rule, to go stale the day a third param exists.
  - **A history entry whose asset is gone lands on the list and REWRITES itself there.**
    Entries outlive the assets they name (deleted here or in another tab). Closing without
    `fromHistory` on that path means `replaceState` heals the dead entry — legal during a
    popstate, disturbs nothing — so the address bar stops naming an asset that isn't there
    and a later pass doesn't retry the dead id.
  - **The one-time load-side deep link is unchanged in shape** and still gated by
    `urlDeepLinkAppliedRef` (a `useRef`, not empty-deps — `assets` starts `null` and the
    effect has to wait for `loadData()`); it now passes `replaceHistory` so the entry the
    user is already standing on is replaced rather than stacked on itself. `?asset=` still
    matches an id OR a label, permanently, and so does a pushed entry — a link pasted in or
    an entry from an older build can carry either.
  - **A deep-link arrival keeps its URL EXACTLY as it arrived** — `replaceHistory` seeds
    that entry's history *state* but passes no URL, and records the tab AS REQUESTED
    rather than as resolved. Found when merging this work onto the Maintenance/photos
    branch, which is the only place the two features meet: `?tab=changes` resolves to the
    Maintenance tab's History SUB-tab, and no URL param names a sub-tab, so normalising the
    address to `?tab=maintenance` would land a RELOAD of that link on Scheduled instead.
    Links outlive the layout that produced them — which is the whole reason `"changes"` is
    still accepted — so the one entry that *is* a link is the last place to tidy it away.
    The tab the user clicks still writes the resolved tab, because they are standing there
    rather than following a link. **The maintenance sub-tab is still not in the URL at
    all**; giving it one is the real fix if sub-tab links are ever wanted.
  - **The "Copy link" button (panel layout view only) is now largely redundant** — the address
    bar holds the same URL for every asset, not just panels. Kept because it copies without
    the user having to find the address bar on a phone, which is where a panel gets looked at.
  - **Covered by `test-frontend-nav.js`** for the two failures that are silent (the tenant
    drop, and a stale `?asset=` surviving a return to the list), verified by mutation. The
    history walking itself is browser behaviour — push vs replace, Back landing on the
    previous asset, the depth guard — and was verified by driving the real page in Chromium,
    which is the only place `popstate` exists. Sandbox mode is where that was done.
  - **Back and Home are two controls, and collapsing them would cost whichever lost**
    (2026-09-11). Making the arrow a one-level pop removed something it used to guarantee:
    a single tap out. Eric hit it immediately — nest a few levels and leaving meant tapping
    back through every one. So the detail header carries a **home icon** beside the arrow:
    Back means "the thing before this one", Home means "out".
    - **It collapses the whole stack in ONE history move**, `history.go()` back to the list
      entry, rather than switching the view directly. That is what returns the list exactly
      as it was left, scroll included — rebuilding it in place would land on the top of an
      unfiltered list, i.e. throw away the thing the history work was for.
    - **`homeDepth` on each entry is what makes that one move possible.** It carries the
      depth of the nearest list entry down the stack — set to the current depth when leaving
      the LIST, inherited when leaving a detail page — so the jump is always one `go()`
      however deep it went. **Depth 0 is NOT reliably the list**: a shared link opened cold
      starts the trail at an asset, so that entry's `homeDepth` is null and Home builds a
      list in place and lands at the top. That is the one case it cannot restore anything.
    - **Home sits LEFTMOST and is a fixed width**, so the back arrow keeps a stable position
      for the thumb even though the label beside it changes length — and it reads the way the
      list's own breadcrumb does, with "all of it" at the left end.
    - **Scroll on the home jump is left to the browser, like everywhere else.** A hand-rolled
      restore was written for it first and then removed again when the mutation passed
      without it: Chrome handles a multi-step `go()` as well as a single Back. See the scroll
      entry below for the measurement trap that produced the wrong conclusion — it caught
      this feature a SECOND time.
    - The first history entry is seeded with a real list entry on mount, so "no state" stops
      meaning "the initial list" by convention. Tidiness rather than a fix — `currentNavDepth`
      already read null as 0 — but two things read these fields now, not one.
  - **Scroll position: the browser restores it, and the app only resets it** (2026-09-11).
    An asset opened from the list now starts at its own top, and so does a list reached by
    `closeDetail` replacing an entry (a deep-link arrival, an asset deleted underneath a
    live entry) — both via one `useLayoutEffect` consuming a `scrollToTopRef`, so the
    correction lands before paint rather than as a visible jump.
    - **"Losing your place in the list" had already FIXED ITSELF** when this app started
      pushing history entries, and that is the thing to know before touching this again.
      The browser restores scroll for same-document history navigation on its own; with one
      entry in the tab there was nothing to restore, which is where the complaint came
      from. Verified by driving the committed build: Back returned to 1200, 400 and 900 px
      exactly, unaided.
    - **What was actually broken was the other direction.** Nothing reset the scroll when
      OPENING an asset, so the list's offset carried into a shorter page and clamped —
      1200px down the list put you 103px into an 806px detail page. That is the whole bug,
      and `window.scrollTo(0, 0)` after layout is the whole fix.
    - **A hand-rolled replacement was built first, passed, and was thrown away.**
      `scrollRestoration = "manual"`, a `scrollY` on every history entry, `captureScroll()`
      at each navigation point and a debounced scroll listener keeping the current entry
      up to date — ~70 lines, all of it reimplementing something the browser already does
      correctly. It was written on a measurement contaminated by the test harness:
      Playwright scrolls an off-screen row into view before clicking it, which moved the
      very offset under test, so "going back lands at 361" was the robot's scroll, not the
      app's. **Click a row that is already on screen** when measuring this, or the number
      is about Playwright. **This trap has now produced a wrong conclusion twice** — the
      second time on the home jump, where it made the browser look like it could not restore
      scroll across a multi-step `go()` and nearly bought a hand-rolled replacement for the
      second time. Scroll events coalesce per frame, so the robot's scroll never shows up in
      an event log either. The tell is a scroll number that disagrees with a single-step
      Back; when one appears, suspect the click before the code. Do not re-add the manual approach on suspicion; if restoration
      ever does prove flaky on a bigger sheet, that is the shape of the fallback.
  - **Deliberately NOT handled yet**, both because they widen the change rather than finish
    it: Back mid-edit still discards the draft silently (it always did, but a reflexive
    gesture makes it likelier than a deliberate click did), and Back with a modal open
    navigates instead of closing the modal.
- **State**: the whole app is one component (`AssetTracker`, ~3700 lines) holding all
  state — assets, managed lists (change types, vendors, peripherals, users), audit log,
  column config. This is a known architectural weak point (see "Component size" below),
  not an endorsement — it's evolved this large rather than being designed this way, and
  splitting more of its render tree out the way `BreakersTabContent` was pulled out is
  the natural next step whenever a tab gets touched again.
- **Related state lives in one object, not parallel `useState`s**, wherever it's opened/
  closed together — e.g. `breakerModal` (anchor id, per-member amp drafts, instance
  draft, editing flags, error, all in one object, `null` when closed) instead of 8
  separate states. This isn't just tidiness: before this consolidation, `openDetail()`
  (which runs every time you navigate to a different asset) didn't reset any of the
  breaker-modal or Add-Breaker-form state, since resetting 8+ scattered setters is easy
  to forget one of — which is exactly what happened. Grouping into one object made
  `openDetail()`'s reset trivial (`setBreakerModal(null)`) and structurally harder to
  regress. `swapModal`, `moveCircuitModal`, and `addBreakerDraft` (its own `error` field
  instead of a 4th parallel state) follow the same shape. `allocationDraft` folds its
  error in too. Maintenance's add/edit/delete state was *not* consolidated — it's three
  genuinely different sub-flows (new item, editing an existing one by index, confirming
  a delete), not one thing with parallel copies, so merging it would add complexity
  rather than remove it.
- **Persistence model**: the app keeps its full state in memory and, on every change,
  sends the ENTIRE state as one JSON snapshot to the Apps Script backend (`persist()` ->
  `writeSnapshot()` -> `fetch(SHEET_API_URL, { method: "POST", ... })`). On load, it does
  one GET to the same URL and reconstructs everything (`useEffect` near the top of the
  component). `persist(nextAssets, overrides)` takes an *options object* for everything
  besides assets (`{ columns, changeTypes, vendors, auditLog, peripheralsList, usersList,
  bulkItemTypes, typesList, breakerTypes }`) — each defaults to the current state, so a
  call site only names whichever domain it's actually changing (most calls are just
  `persist(next, { auditLog: logAudit([entry]) })`) instead of re-passing every other
  domain unchanged, which is what a 10-positional-argument signature demanded before.
  No per-field diffing on the client — but `persist()` does compute which *domains*
  changed (`_dirty: { assets, config }`), via plain reference-equality against
  current state (every call site already either passes a domain through untouched or a
  freshly computed value, so this needs no per-call-site bookkeeping). `AssetTrackerSync.gs`'s
  `doPost` uses that to skip rewriting the Assets/Comments/Changes/Allocations/Maintenance
  tabs when nothing asset-related changed, and skip Config when no managed list or column
  changed — e.g. toggling a managed-list entry no longer rewrites the Assets tab, and vice
  versa. AuditLog is handled differently again: since entries are only ever appended to
  (never edited or deleted client-side), `appendNewRows_` appends just the new rows instead
  of rewriting the whole — ever-growing — history each time. A request with no `_dirty` at
  all (an old client, or a direct API call) still rewrites everything, as the safe fallback.
  `LockService` still guards every write so concurrent saves don't corrupt a tab.
- **Optimistic concurrency (backend v12)**: because every save is a full overwrite, a
  client saving a snapshot it loaded *before* someone else's save used to silently drop
  that person's work. Each of the three `_dirty` domains now carries a revision counter,
  stored in Config as `rev_assets`/`rev_config`/`rev_breakerTypes`. `doGet` returns them
  (`revisions`), the frontend holds them next to `nextAssetNumber`, and `persist()` posts
  them back as `_revisions`. Inside the same `LockService` critical section as the writes,
  `doPost` compares posted vs stored for each domain it's about to write; on any mismatch
  it writes **nothing** (not even the audit rows, which describe the rejected change) and
  returns `{ ok: false, conflict: ["assets"], revisions: {...} }`. Otherwise it writes,
  bumps only the domains it actually wrote, and returns the new revisions so the client can
  keep saving without reloading first. Per-domain, not one global counter, so editing a
  managed list doesn't conflict with someone editing an asset. On a conflict the frontend
  does **not** merge and does **not** retry — either would destroy one of the two changes —
  it reloads through `loadData()` (which also replaces the optimistic `setState` calls
  `persist()` makes around the write, so the app stops showing an edit that isn't stored
  anywhere) and shows a blocking "Your change wasn't saved" modal telling the user to redo
  it. A payload with no `_revisions` (an older client, a direct API call) is still accepted
  and written — same fallback philosophy as a missing `_dirty` — and still bumps the
  counters so other clients notice. Sandbox mode makes no network call at all, so it
  attaches no revisions and no check runs, rather than fabricating numbers locally. Two
  supporting details in `persist()`: `revisionsRef` mirrors the revision state because a
  POST needs the value as of the moment it's *sent*, and `writeQueueRef` serializes the
  POSTs so only one is in flight — several call sites fire `persist()` without awaiting it,
  and an overlapping second save would otherwise post the revision the first is about to
  bump and be rejected as a conflict with this very client's own write (overlapping
  full-snapshot writes could also already land out of order before this).
  One knock-on effect: since the counters live in Config and `writeTable_` rewrites that
  tab wholesale, Config is now rewritten whenever *any* domain is written. When config
  itself isn't dirty its stored rows are copied straight back unparsed (including keys the
  script doesn't know about), so the content is unchanged — only the counters move.
- **Wipe and import are a menu on the Sheet, not a script (backend v29).** `onOpen` adds a
  **BCA Admin** menu with "Import inventory" and "Wipe all data"; both empty every data tab
  and rewrite Config in one `LockService` section.
  - **Why not a Node script, which is what was asked for.** `/exec` needs a signed-in
    session (v18+), so a script could only get one by copying a live credential out of a
    browser. Inside the bound script there is no credential at all — the Sheet's own
    authorization is the auth — and it works from a phone, which is where Eric operates.
    - **This reasoning still holds for wipe/import and is NOT contradicted by `sheet.mjs`**
      (2026-09-09), which reaches the Sheet through a different door: the Sheets API with a
      service account, not `/exec` with a stolen session. That door did not exist in this
      project when the paragraph above was written, and it closes the objection — a service
      account key is its own credential, not a copy of a person's. What stays true is the
      part about phones: a full replace is still better as a menu Eric can run from one,
      and `sheet.mjs` is for surgical edits, not for replacing the inventory.
  - **Menu handlers must NOT end in `_`.** Apps Script treats a trailing underscore as
    private and silently refuses to wire it to a menu item. Every helper here keeps the
    underscore; only the four `menu*`/`onOpen` entry points drop it.
  - **Both bump every revision counter**, which is load-bearing rather than tidy: a browser
    left open still holds the pre-wipe snapshot, and without the bump its next save would
    overwrite everything the import just did. With it, that save is refused as a conflict
    and the app reloads.
  - **`adminWriteConfig_` copies through every key it wasn't asked to change**, which is
    what preserves `authUsers`. A fixed key list there would blank the allowlist and lock
    out everyone but `OWNER_EMAIL` — the same hazard `doPost`'s own `authUsers` handling
    exists to avoid, met again in a second place.
  - **The import sets `usersList` to `[]` deliberately.** A stale name with no matching
    User asset makes `usersAreAssets` false, dropping the app to legacy name mode where
    every `personIds` assignment renders as unassigned and the next save writes that back.
    That is the single most destructive thing this can get wrong, and it is exactly what
    the by-hand process kept getting wrong.
  - **It parses and summarises BEFORE it destroys anything** — the confirmation quotes real
    row counts from the fetched file, and every validation failure throws before
    `adminReplaceAll_`, whose first act is to empty the sheet.
  - **The data is read from a TAB in the Sheet, and getting here took two wrong turns
    worth knowing about.** `adminReadGrid_` resolves a blank or bare-name answer to a tab
    (`IMPORT_TAB_NAME`, "Import"); an explicit `http(s)` URL still fetches.
    - **First wrong turn — a raw URL from this repo.** Simplest possible fetch, and it
      would have published the school's entire inventory (21 staff by name, which room
      each sits in, every serial number and hostname) to a **public repo**, permanently,
      since git history outlives a deletion. **`import/` is gitignored** for that reason:
      the generated CSV, the source xlsx and the transform scripts stay local.
    - **Second wrong turn — `DriveApp.getFilesByName`.** Private, and it failed at runtime
      with "You do not have permission to call DriveApp.getFilesByName". **The live
      manifest declares its `oauthScopes` explicitly**, so Apps Script does not auto-detect
      a newly used API's scope, and `deploy.mjs` deliberately keeps the LIVE manifest so a
      deploy can never alter the web app's access settings. Adding the scope is possible
      but not free: the web app executes as its owner, so between that deploy and the owner
      re-granting, **every user's requests fail** — the same trap
      `forceAuthorizeExternalRequests` documents for `UrlFetchApp`.
    - **So the rule for anything added here: use an API the script already holds a scope
      for.** `SpreadsheetApp` reads and writes tabs on every request already, so a tab
      costs nothing. The data also never leaves the document, and is visible before it is
      imported.
    - `getDisplayValues()`, not `getValues()` — Sheets turns a date-looking cell into a
      real `Date` on CSV import, and the app expects plain `yyyy-MM-dd` strings. Same
      hazard `writeTable_`'s `setNumberFormat("@")` exists for, met from the other side.
    - A missing tab **refuses and says how to create one**, deliberately not going through
      `getSheet_`, which would create an empty tab and then report "no data rows" — hiding
      the real answer, that the file never arrived.
    - The scratch tab is **deleted once the write succeeds**, so no second copy of the
      inventory is left in the document for a later import to read by mistake. A failure to
      delete it is reported without claiming the import failed.
- **Saving feedback is one flag, because `persist()` is the one choke point**: `isSaving`
  (plus a `savingRef` mirror) is set at the top of `persist()` and cleared in a `finally`,
  so it clears on success, on a network/backend failure, *and* on the conflict path that
  reloads and opens the blocking modal — a spinner that never stops would be worse than
  none. Since every write in the app funnels through `persist()`, that single flag covers
  every form without per-form plumbing: it drives a "Saving…" pill in **both** headers
  (list and detail) and puts every write control into a disabled *and visibly working*
  state — label swapped to "Saving…", `C.border` background, spinner (`Loader2` +
  the `.spin` keyframe) on the icon buttons. A disabled-but-otherwise-unchanged button
  still reads as frozen, which is the exact confusion this exists to fix. Components
  outside `AssetTracker` (`ListManagerModal`, `ChildEntityTable`, `BreakersTabContent`,
  `PanelConfigForm`) take it as an `isSaving` prop.
  Two things this is deliberately *not*: it is **not** a guard inside `persist()` — a few
  write paths aren't gated on it (the bulk reassign/move toolbar), and refusing one of
  those would silently drop a real edit; the guard is an `if (savingRef.current) return;`
  at the top of each submit *handler* instead, catching the double-click that lands before
  React re-renders the button as disabled. And it does **not** replace `writeQueueRef` —
  that still serializes the POSTs; this stops the second identical submit from ever being
  created, which the queue can't do (it would happily send both).
  Sandbox mode needs no special case: its write never awaits, so `isSaving` goes true and
  false inside one React batch and no "Saving…" frame is ever painted.
  A failed save now shows a "Save failed" pill in that same slot. It used to be a bare
  "Sync failed" tucked inside the name button on the *list* header only — i.e. invisible
  on the detail page, where almost every edit is actually made.
- **Sheet schema**: Assets tab holds flat fields only (see `ASSET_FIELDS` in the .gs
  file). Comments, Changes (structured change log with type/vendor/cost), Allocations
  (bulk-item quantity assignments), and Maintenance (scheduled maintenance items) each
  live in their own tab, keyed by the asset's `label` (its asset ID, e.g. `BCA0001`).
  Breakers (keyed by `panelLabel`) and Circuits (keyed by `breakerId`, one level deeper —
  see Data model) are the same pattern with an extra level of nesting. Config tab stores
  the managed lists and column config as JSON blobs (key/value rows), since those aren't
  naturally tabular.
- **Authentication (backend v18)**: Google Sign-In, gating the whole app. The browser signs
  in against `GOOGLE_CLIENT_ID` (`index.html`) / `OAUTH_CLIENT_ID` (`AssetTrackerSync.gs`) —
  **the same id must appear in both**, since the backend rejects any token not minted for
  exactly it. The ID token is sent with every request and verified server-side against
  Google's `tokeninfo` endpoint, then the email is checked against the `authUsers` allowlist
  in Config.
  - **Two separate questions, kept apart deliberately.** Google answers "is this really
    them?"; the allowlist answers "may they in, and may they write?". The OAuth client is
    **External** (the school has no Workspace, so Internal was unavailable), meaning *any*
    Google account can pass the first. That grants nothing — the allowlist is the gate.
  - **The full read is now a POST**, `doPost({ op: "read" })`, not a GET. Purely so the token
    travels in the body: a GET could only carry it in the query string, writing a live
    credential into browser history and Google's logs. The parameterless `doGet` now refuses
    with `authFailed` — but still reports `scriptVersion`, because checking the deployed
    version by opening `/exec` in a browser is a documented diagnostic that has to keep
    working without a token.
  - **`?panel=` stays anonymous**, unchanged. It's the QR-code page for physical panels
    (`panel.html`). v14 wrote it as its own branch rather than an exemption inside the
    authenticated path, which is exactly why v18 needed to carve no hole for it.
  - **Roles**: `editor` or `viewer`. View-only is enforced in `doPost` and again at
    `persist()` — the buttons are also hidden, but that is a courtesy, not the control.
  - **Lockout is impossible**: `OWNER_EMAIL` in `AssetTrackerSync.gs` is always an editor
    regardless of the allowlist, and `authUsers` is *preserved* rather than overwritten when
    a save doesn't carry it. That second part matters because the Config tab is rewritten
    wholesale on every config save — without it, one save from a client that doesn't know
    about `authUsers` would empty the allowlist and lock out everyone but the owner.
  - **Sandbox bypasses all of it** (`authSatisfied = sandboxMode || !!auth`), since it never
    touches the backend. The sign-in screen carries its own "Continue in Sandbox" link —
    the Sandbox pill lives in the header, which is now behind the gate, so without that link
    a signed-out browser could never reach sandbox mode at all.
  - **Sessions (v22): the Google ID token is used ONCE and never stored.** `doPost`
    exchanges it at `op:"signin"` for a script-issued session, and the browser presents
    that from then on (`SESSION_ID_KEY` in `localStorage`).
    - **Why not just keep the Google token:** it lasts about an hour and a browser cannot
      renew one silently — Chrome's move to FedCM made `auto_select` undependable, so v21
      (which did store it) sent people back to the sign-in screen constantly. A session
      also can't be revoked if it's a self-expiring token; a record can.
    - **Sessions live in Script Properties, NOT the Sheet.** Anyone with the Sheet can read
      every tab, and `doPost` rewrites tabs wholesale — a session table there would be both
      readable and destroyable by an ordinary save.
    - **7 days, sliding** (`SESSION_TTL_MS`). Any request pushes the expiry back a full
      week, so a regular user is never asked again while a forgotten device ages out. The
      rewrite is throttled (`SESSION_TOUCH_THRESHOLD_MS`) so a property isn't written on
      every single request just to move an expiry by seconds.
    - **The allowlist is still re-read on EVERY request**, so removing someone or dropping
      them to view-only takes effect on their next action, not when their session expires.
      Removal additionally calls `deleteSessionsForEmail_` to end their sessions outright.
    - **Sign out is real**: it POSTs `op:"signout"`, which deletes the record server-side.
      Fire-and-forget on purpose — the local sign-out must happen whether or not the call
      lands, and a session that outlives a failed call still expires on its own.
    - `readSession_` shape-checks the id before it touches storage, because the id becomes
      part of a property key.
    - Expired records are only noticed when presented, so `sweepExpiredSessions_` runs at
      sign-in to keep storage bounded.
    - v22's first load also deletes the leftover `asset-tracker-auth-token` that v21 left
      in every user's browser. Safe to remove that cleanup once nobody is on v21.
  - **Local testing needs `http://localhost:<port>` registered** as an authorized JavaScript
    origin on the OAuth client. `file://` has no origin Google accepts, so double-clicking
    `index.html` shows the sign-in button and then fails.
- **Personal identity**: `currentUser` (what stamps comments/changes/audit rows) now comes
  from the server-resolved identity on load — verified, not typed. The old self-declared
  `localStorage` name tag (`USER_STORAGE_KEY`) survives for **sandbox mode only**, which has
  no sign-in but still wants an author on audit entries.
- **Column visibility is per-device**, also `localStorage` (`COLUMN_VISIBILITY_STORAGE_KEY`),
  not the Sheet. Column *definitions* (key/label/width/custom flag) stay server-synced via
  Config, since a custom column adds a real field to every asset — only which columns are
  *shown* is local. `isColumnVisible(c)` reads the local override first, falling back to the
  column's server-defined `visible` (e.g. for a custom column another device just added, which
  this device hasn't seen/hidden yet). `toggleColumnVisible()` never calls `persist()`.
- **`ChildEntityTable`** (bottom of the file) is a generic list/add/edit/delete component for
  a structured child entity (fields config + items + onAdd/onSave/onDelete), built for
  Breakers and Circuits and intended for reuse — Locks under Doors is planned next and will
  need the identical list/add/edit/move shape. It owns its own add/edit/expand/delete-confirm
  UI state; the caller supplies data + callbacks, plus `renderCustomFields` for anything that
  doesn't fit the generic field-type system (text/number/date/select/multiselect) — used for
  a Circuit's rooms-served-vs-feeds-sub-panel toggle. Actions that aren't a generic field edit
  (Swap Breaker, Move Circuit) live outside the component via `customRowActions`, which opens
  the caller's own dedicated modal.
- **Component size**: `AssetTracker` is still a god-component (state, handlers, and most tab
  content all live in it) — a byproduct of the app growing feature-by-feature with no build
  step to make splitting files free. `BreakersTabContent` (the Breakers detail-tab's whole
  render: "Fed from" banner, panel config/diagram toggle, Add Breaker form) was pulled out as
  a top-level component taking only the props it touches, as a first cut proving the pattern
  works with zero build-step cost — plain JS/JSX reorganization within `index.html`, nothing
  else changes. Not all tabs have been split out this way yet; do the same extraction for
  another tab's content next time that tab needs real changes, rather than a dedicated
  refactor pass.
- **Main-page toolbar is intentionally minimal, on both top-level tabs**: on Assets,
  Columns/Export/Add Asset live in a hamburger menu (`showToolbarMenu`) anchored top-right of
  the Assets/Maintenance tab row rather than as always-visible buttons; on Maintenance, the
  same hamburger (shared state — only one tab's content is mounted at a time, so no conflict)
  holds just Export, since there's no per-tab Columns or an "Add" equivalent there. On both,
  the search box collapses to an icon (`searchOpen`) and expands on click — bound to `query` on
  Assets, `maintenanceQuery` on Maintenance — staying expanded whenever its query is non-empty
  so an active search is never hidden. Neither tab has a "Showing X of Y" count line: on Assets,
  the one thing that lived there besides the count (clearing an active sort) moved to a small ×
  chip next to the sort arrow on the sorted column's own header; on Maintenance, the overdue
  count that lived there is now a standalone badge above the table.
- **The header's account controls are one dropdown, and About is where the app names its
  own version** (2026-08-26). The top-right used to carry four separate controls beside the
  Sandbox pill — the name/identity tag, an `Access` link, a `View only` badge, `Sign out`.
  They're one `accountMenu` now (`showAccountMenu`), built like the toolbar hamburger
  (fixed-inset click-catcher + absolutely positioned card): an identity block at the top
  (name, email or "Sandbox — local data", Editor/View only), then Set name (sandbox only),
  Access (editors, real backend only), About, Sign out. Sandbox and signed-in are the same
  menu rather than two, which is what let sandbox's "Set name" stop being a second
  person-shaped button in the corner.
  - **The `View only` badge deliberately stayed OUTSIDE the menu.** It exists to explain why
    the edit controls a viewer expects aren't there, and an explanation you have to open a
    menu to find doesn't do that. The menu shows the role too; the duplication is the point.
  - **About answers "which build is this browser actually running?"**, which nothing in the
    app could answer before — the only version string was `FRONTEND_SCRIPT_VERSION`, and it
    is a *backend contract*, not a build id. It shows four version-ish facts because they go
    stale independently: `APP_VERSION` (this file's build), `document.lastModified` (what the
    browser says the file's date is — no discipline needed, so it catches a cached page even
    when the bump was forgotten), the backend version this build expects, and what the
    deployed backend reports. Plus data source (Sheet vs Sandbox), identity, and role.
  - **`APP_VERSION` is hand-bumped, `YYYY-MM-DD.N`, and is NOT `FRONTEND_SCRIPT_VERSION`.**
    Keeping one constant for both would answer the question wrongly: the script version only
    moves when `AssetTrackerSync.gs` changes, so every frontend-only change would leave it
    identical. Bump `APP_VERSION` whenever `index.html` changes in a way worth verifying
    landed. A stale value here is only a misleading label — never dropped data, which is what
    a stale `FRONTEND_SCRIPT_VERSION` costs.
  - The build string is repeated on the **sign-in screen**, since About sits behind the gate
    and "which build is this?" is often asked precisely because you can't get past it.
- **Per-column filter + sort is a shared pattern, not duplicated per table**: `ColumnHeaderCell`
  (Filter icon + click-to-cycle sort + clear-sort × chip) and `ColumnFilterModal` (option list +
  Sort A→Z/Z→A) are generic, parameterized by a `filterConfigs` map (`{ [colKey]: { label, value,
  setValue, options, labelForOption? } }`) plus `sortConfig`/`setSortConfig`. The Assets table's
  Type/Room/User/Status columns and the Maintenance table's Frequency/Owner/Status columns (Task/
  Asset/Last Performed/Next Due are plain sort-only, no filter) both go through these same two
  components — each tab just supplies its own state and options. `labelForOption` exists for
  columns whose stored value isn't the display text (Maintenance's Status filter stores
  `"due-soon"` but shows "Due soon", via `MAINTENANCE_STATUS_FILTER_OPTIONS`). Maintenance's
  default (unsorted) view is always due-soonest-first with never-performed items pinned to the
  top; picking an explicit column sort overrides that until cleared.
- **Edit affordance convention**: every "edit this record" trigger is an icon-only pencil
  (`<Pencil size={14} color={C.muted}/>`, `aria-label="Edit ..."`), positioned at the trailing
  edge of the row/section it edits, alongside that row's other icon actions (delete, etc.) —
  e.g. the Breaker Type manager row, a breaker instance/member row, a Circuit row, a Maintenance
  item's header row. The one exception is the Asset Detail page's primary "Edit" button (opens
  the full edit form) — it keeps a text label since it's a page-level action sitting next to
  other labeled buttons (Duplicate/Archive/Delete), not a per-row list action.

## Data model

Assets have a `type`, picked from a managed list (`typesList`, editable via the gear icon on
the Type field, seeded from `TYPE_OPTIONS` on a brand-new sheet: Computer, Monitor, Phone, TV,
DocuCam, Stream Deck, Room, Building, Bulk Item, Electrical Panel, Other).

**A type is referenced by `id`, never by the name people read** (2026-08-25). `typesList` holds
`{ id, name }`; `asset.type`, every `parentTypes` entry and every `TYPE_REGISTRY` key hold the
id. That split is what makes renaming a type free — with the name stored on every asset,
"Computer" → "Workstation" would have to rewrite every asset plus every type naming it as a
parent, the same cascade the id migration removed for Rooms.
- **A built-in type's id IS its original name** — Room's id is the string `"Room"`. That looks
  like the thing ids are meant to avoid and is the opposite: every asset already on the sheet
  is already storing a valid id, so this needed **no data migration and no backend change**
  (`typesList` is a JSON blob in Config, so its shape is the frontend's business), and every
  identity test the app makes (`a.type === "Room"`) keeps working. Only types created after
  this get a generated id, since only they have no historical name to preserve.
- `adoptLegacyTypesList()` reads the old plain-string array on load, same pattern as
  `adoptLegacyParentage`/`adoptLegacyNames`. `typeNameOf(id, typesList)` resolves a name for
  display, falling back to the id.
- Names needn't be unique for correctness, but add and rename both refuse a duplicate: two
  types both reading "Printer" in the picker is a trap for whoever is choosing.

**A type carries any number of LABELS, and every list of types is A→Z and FILTERED by them**
(2026-09-11; no backend change, see below). `typeSettings[id].categoryIds` is an array of
label ids; the vocabulary is `[{ id, name }]` with **array order as display order**.
- **This replaced one category per type, and several labels per type is what killed the
  grouping.** A grouped list can only show a two-label type twice, once under each heading —
  a list that lies about how many types there are, and "how many types do we have" stops
  being answerable by counting. So the Type picker, the Type column filter and the type
  manager all list every type alphabetically and offer the labels as a chip row that narrows
  the list. Same information, no double-counting.
- **THE CONFIG KEY IS STILL `typeCategories`, AND THAT IS DELIBERATE.** The per-type array
  rides `typeSettings`, a blob the backend stringifies whole, so this whole change cost **no
  backend version and no deploy** — but the vocabulary lives under a key of its own, and
  `doPost` writes a FIXED key list and silently drops the rest, so renaming it would discard
  every label list the new frontend saves until every tenant had been deployed. Rename what
  people read, never the stored key — the trade `changeType`/"Work type" already takes. The
  `.gs` comment beside that key still says `categoryId`; fix it on the next real backend
  change rather than spending a deploy on a comment.
- **A stored override is read AHEAD of the merged entry** (`typeLabelIdsOf`), which is the
  one subtle line. `typeEntryFor` spreads the override over the shipped registry entry, and
  the two now use different keys for the same fact — a v33 setting holds `categoryId`, the
  registry ships `categoryIds` — so a merged object carries BOTH, and reading the array first
  hands back the shipped labels while silently ignoring the school's own filing.
- **v33's singular `categoryId` is READ as a list of one**, so a sheet written before this
  resolves with no migration; the next save of that type rewrites it as an array. And an
  explicitly EMPTY array now beats the shipped labels, which the singular key could not
  express: clearing a built-in's category stored `undefined`, JSON dropped the key, and the
  shipped value came back on the next load.
- **A built-in label's id IS its own name** ("Places"), the same trick `typesList` and the
  asset key refactor used: every shipped registry entry already names a valid id, so this
  needed no seeding step and no migration. `ensureShippedLabels()` tops a stored list up with
  any label added in a later release, at its shipped position rather than appended — the
  lesson `ensureLockedTypes` learned when User landed under `Other`.
- **A DANGLING id is not an error, the type just carries one fewer label.** Deleting a label
  does not rewrite the types that named it, so deletion needs no in-use block — only a count
  saying how many types carry it. `typeLabelNamesOf` drops a dangling id rather than printing
  a raw uuid. **Renaming is a one-row edit**, which is the entire point of storing the id.
- **`Other` ships with no labels on purpose** — it keeps the Unlabeled bucket exercised in the
  shipped state, and the filter grows an **Unlabeled** chip whenever something on screen has
  none. Nothing ticked in the editor is a real answer, not a missing one.
- **The filter is OR, never AND.** Picking Equipment and Facilities shows everything carrying
  either, not the handful carrying both: intersecting two labels lands on an empty list often
  enough that the control would read as broken.
- **`SelectionModal` and `ColumnFilterModal` take an OPTIONAL `labelOptions`/`labelsForOption`**
  and render exactly as before when absent, which is every caller but the Type picker and the
  Type column filter. They replaced the optional `groupForOption` both took. One shared
  `useLabelFilter` hook owns the chip row, the active set and the narrowing — a hook rather
  than a component, because the caller still renders its own rows.
  - **`labelsForOption` returning `null` means EXEMPT**, which is load-bearing for exactly one
    row: "All types" is the option that CLEARS the column filter, so filtering it off screen
    would be the one thing the control must not do.
  - The chip row shows only labels something in THAT list carries, and only when there are at
    least two — a chip whose only possible effect is to empty the list is a dead control.
- **Covered by `test-frontend-type-labels.js`** (it replaced `test-frontend-categories.js`),
  which runs the real registry and the real helpers. Verified by mutation that five silent
  failures fail it: reading through the merge instead of the override, an empty array
  ceasing to beat the shipped list, `ensureShippedLabels` replacing rather than topping up,
  the filter turning into AND, and `null` ceasing to be exempt. `MOCK_SNAPSHOT` is
  deliberately MIXED — Mini Split carries the v33 singular key (naming a DIFFERENT label than
  the registry ships, or it would pass either way), Electrical Panel carries two, Stream Deck
  carries an explicit empty list, everything else none — so Sandbox exercises all three read
  paths rather than one. That is the `personIds` lesson, applied deliberately.
- **Eric chose a config key over a name string per type back at v33, knowing it cost a
  deploy**, and that reasoning survives the rework: a derived list can only be ordered by
  something else, and cannot hold a label nobody has filed a type under yet, so you could
  never build the scheme and then sort types into it. The rework kept the record and only
  changed how many of them a type may name.

**Per-type settings are a user-editable overlay on `TYPE_REGISTRY`** (the type editor,
2026-08-25). The registry is the shipped default and is never written to; overrides live in
Config under `typeSettings` keyed by type id (backend v24) and are merged on top at read time
via `typeEntryFor()`, so a built-in still works if its override is missing and "Reset to
default" is just deleting it.
- **`TYPE_SETTINGS` is a module-level variable, not React state, and that is a deliberate
  trade with a real hazard.** `fieldAppliesTo`, `isPlaceType` and `parentTypesFor` are plain
  functions called from ~100 render sites (several per table cell), so threading state through
  them would be an enormous diff for no behavioural gain. React therefore does not know when it
  changes: it is safe **only** because every write goes through `persist()`, which `setState`s
  anyway, and `applyTypeSettings()` is called *before* that setState so the following render
  reads the new values. **Anything that changes these settings without a setState will silently
  show stale rules.** The two app-wide derived sets (restricted fields, place types) are
  recomputed on change rather than per call, since `fieldAppliesTo` runs per cell.
- **Per-type custom fields (v26).** The editor can invent a new field for a type. It becomes
  an ordinary custom column (Config's `columns`) carrying `restricted: true`, plus its key in
  that type's `onlyFields` — so it reuses the restricted-field engine rather than adding a
  second mechanism. **Restriction is a flag on the COLUMN, not a consequence of who claims
  it**: derived the other way, unticking a field from its last owner would turn it into a
  common field and splash it across every type. New fields are pending until Save, so the whole
  editor stays one commit and a cancelled edit leaves no stray column. They're created hidden —
  a field belonging to one type would otherwise add a mostly-empty column to everyone's table.
  Deleting one stays in the Columns menu, which already owns that destructive action.
  - **Adding one is a DIALOG, opened by an "Add field" button** (2026-09-10). It was an
    always-open text box under the field list, which sat there on every visit whether or not
    anyone wanted a field — and left the field's KIND, the one thing that cannot be changed
    later, with nowhere to be chosen except a row that did not exist yet. The dialog is where
    a field is invented, so it holds the name, the kind, and a choice list when the kind is
    one; the row list then shows every field's kind as plain text and offers no control at all.
  - **It is rendered INSIDE the type-manager modal's tree, and that is what makes the layering
    work.** The modal establishes a stacking context, so anything nested paints above its
    content whatever the z-index, and the kind picker nested one deeper paints above the
    dialog in turn. A sibling overlay would have had to out-number the modal and would still
    have lost to its own picker.
  - **A blank or duplicate name is REPORTED, not silently ignored.** The old inline version
    `return`ed on both, so the button did nothing and said nothing.

**Three things a type now decides that it didn't before** (backend **v33**, 2026-09-09 —
see `TYPE_MANAGEMENT_PLAN.md`): which **labels** it carries (one **category** until
2026-09-11, see above), which of its fields are **required**, and — a per-column question
rather than a per-type one — what **kind of value** each field holds. Two of the three needed
no backend change at all, and the exception is the one worth remembering.

- **A column's `dataType` and a type's `requiredFields` cost NOTHING to add**, because
  `doPost` stringifies the whole `columns` and `typeSettings` blobs and the only thing the
  backend reads inside a column object is `customColumnKeys_`, which touches `custom` and
  `key`. **A new Config KEY is the one thing that blob-freedom does not cover** — `doPost`
  writes a fixed key list and silently drops the rest — which is exactly what the category
  list needed, and why that one phase cost a version bump and a deploy to every tenant. Reuse
  that test for any future per-field or per-type setting: a property on an existing blob is
  free, a key of its own is a release. **The 2026-09-11 multi-label rework is that test
  answered the other way**: several labels per type is a property on `typeSettings`, so it
  cost nothing — which is also why it kept v33's key name rather than minting a better one.
- **The data type is PER COLUMN, resolved at READ time** (`columnDataType()`): the column's
  own override, then `DEFAULT_COLUMN_DATA_TYPES`, then text. Per column because one key
  holding a date on Computers and a number on TVs breaks sorting, filtering and the export
  for a flexibility nobody asked for — a type decides *whether* it has a field, the column
  decides what that field *holds*, and the editor says so on screen because changing it from
  inside one type's editor changes every other type's form. Read-time because the column
  migration only ever ADDS newly-introduced columns and never updates the properties of
  stored ones, so a load-time backfill would bake today's defaults into every sheet forever.
  `applyFieldKind` stores an override only when it DIFFERS from the shipped default and
  removes it when it returns — "same as shipped" is never a stored fact.
  - **CHOSEN AT CREATION, FIXED AFTERWARDS** (Eric's call, 2026-09-10). The kind is picked
    where the field is born — the Columns menu's "add column", or a pending row in the type
    editor — and every existing field then shows its kind as plain text with no control.
    `saveTypeSettings` writes a kind only for a column it is inventing in that same save, so
    the rule is structural and not merely a hidden picker.
    - **This removed a problem rather than managing it.** A kind change could not convert
      stored values (a full asset rewrite triggered by a settings edit, with nowhere to put
      anything unparseable), so it left them intact but *undisplayable*: a number input
      cannot render `MOCK-CMP-001`, so the form showed the field EMPTY and then refused to
      save, naming a value that was not on screen. Across forty assets that was forty
      unsaveable records complaining about blank fields. **If a different kind is needed,
      the answer is a different field.**
    - A `select` column's CHOICES follow the same rule and for the same reason — narrowing
      the list under stored data leaves assets holding a value the field no longer offers.
      They are shown read-only on an existing field, since "Choice list" alone says nothing
      about what the field accepts.
    - `validateColumnValue` stays regardless: data can still arrive out of step from the
      admin import, a direct Sheet edit, or a hand-edited Config blob.
  - **This was not purely additive.** The app's entire data-type awareness was
    `type={c.key === "totalQuantity" ? "number" : undefined}` at two call sites, which is why
    `purchaseDate` and `warrantyUntil` were plain text boxes for the app's whole life. The
    general mechanism replaced that and gave them real date pickers on the way past.
  - **The vocabulary is `ChildEntityTable`'s**, character for character —
    text/textarea/number/date/select — so the app has one answer to "what kind of field is
    this". `multiselect` is deliberately absent: `person`, `peripherals` and a circuit's
    rooms each have a bespoke component with its own managed list, and a generic multiselect
    column would be a fourth thing that looks like them and behaves differently.
    `BESPOKE_FORM_FIELDS` names that set once, so the render and the save-time validation
    cannot drift — and the editor shows "Built in" rather than a kind picker for them, since
    offering a setting that does nothing is worse than offering none.
- **Required is PER TYPE, and that is the opposite call from `restricted`** — a flag on the
  column. The two look alike and are not: restriction HAD to live on the column, because
  deriving it from whoever claims a field means unticking it from its last owner turns it
  into a common field and splashes it across every type. Required is derived from nothing, so
  per-type is simply the more expressive reading. **Nothing is required as shipped.**
  - **Enforced on EVERY save, add and edit** (Eric's call). It is the only way a new rule
    reaches the assets already on the sheet, and a rule you can dodge by editing something
    else is not a rule. The cost is that someone who opened an old asset to fix a typo gets
    stopped; the whole mitigation is that the message names the fields *and* the type.
  - **At the FORM and nowhere else**, same posture as every other guard here — so existing
    assets can violate a new rule, and `duplicateAsset`, `convertUsersToAssets`, the bulk
    toolbar actions and the Sheet's admin import all bypass it.
  - **Emptiness, never falsiness**: `0` and `"0"` are filled in. And `fieldValueIsEmpty` knows
    the three fields that don't store a plain string — the parent is `parentId`, the people
    are `personIds` or the legacy slash-joined `person`. Miss that fallback and every asset on
    an un-converted sheet reads as unassigned, so a rule about User refuses every save.
  - **A rule naming a field the type doesn't have is ignored at READ time**, not only pruned
    on save: a settings blob can be hand-edited or written by an older build, and a rule about
    an invisible field would refuse every save with nothing on screen to fix. Structural
    fields go the same way, which is also what keeps **"Parent is required" out of scope** —
    Unassigned is a deliberate state, not a gap to nag about.
- **`draft.formError` + `draft.errorFields` replaced `draft.parentError`.** It was already
  carrying the duplicate-tag message as well as the parent one, and data-type and required
  errors were the third and fourth occupants. `errorFields` is what the rename made necessary:
  one channel carrying errors about several fields can't say which input to outline.
  **The message renders in exactly ONE place** — beside the field when it names one field
  that is on this form, at form level otherwise. The first version rendered both and printed
  the same sentence twice; each render site read correctly on its own, which is why only the
  browser caught it. The add form's separate `addError` state is gone with it.

- **What the editor can't do, and why.** An icon is stored as a NAME from a curated map
  (`TYPE_ICON_CHOICES`), since a React component can't survive JSON; an unknown name falls back
  to the shipped icon. A ticked field enters `onlyFields` only when it is *already* restricted
  app-wide (`SHIPPED_RESTRICTED_FIELDS`) — the editor must not mint a new restricted field,
  because that would restrict it app-wide and quietly strip it from every type that hadn't
  opted in — that hazard is about EXISTING columns, which is why a field the editor creates
  itself (above) may be restricted: it is new, so there is no data anywhere to strip.
  Modules stay uneditable: a tab body needs a render branch, so it can't be switched on by data.
- **Editing is allowed on locked types.** `locked` means the app depends on the type *existing*
  — its tabs, its field rules — which is about the id, not what it's called or what it holds.
- Name and settings save in ONE `persist()`: both are the config domain, so two calls would mean
  two full snapshot writes and a chance for the second to be rejected as a conflict with the
  first.

**Everything the app knows about a structurally special type lives in one `TYPE_REGISTRY`**
near the top of `index.html`, keyed by type name. This replaced a set of parallel arrays
(`TYPE_ONLY_FIELDS`, five `*_EXCLUDED_FIELDS`, `LOCKED_TYPES`, `CATEGORY_ICONS`) plus a
scattering of `asset.type === "Room"`-style tests at render sites — adding a structurally
new type meant editing all of them with nothing to catch a miss. Each entry may declare:
- `locked` — can't be removed in the type manager (`isLockedType()`): Room, Building, Bulk
  Item, Electrical Panel, which have deep structural dependencies elsewhere (field rules,
  Contents/Allocations/Breakers tabs, the parent chain) a plain managed-list removal breaks.
- `icon` — the lucide icon (`iconFor()`, default `HelpCircle`).
- `excludedFields` — column keys this type doesn't get at all.
- `onlyFields` — column keys belonging to this type. Any key named in *any* entry's
  `onlyFields` becomes restricted app-wide (`RESTRICTED_FIELDS`, derived from the registry,
  not declared separately): no type that doesn't name it gets it.
- *(no `nameField` — removed in v23.)* Every asset carries one optional **`name`** field
  instead, read via **`nameOf(asset)`**, which returns it if non-empty and otherwise falls
  back to the asset's `label` (its Asset ID). A type no longer declares where its name
  lives, which is what lets a user-created type have a real name with no registry change.
  Until v23 this was a per-type key pointing at a different column each time (Room →
  `room`, Building → `building`, Campus → `campus`, Bulk Item → `itemName`), and that
  tangled two questions into the same columns: the Room column meant "this room's name" on
  a Room row and "the room this sits in" on every other row, while the Type column printed
  a name where the type word belonged. Only those four types could be named at all.
  **A name is display only and never identity** — `label` remains the one stable key, names
  need not be unique, and nothing resolves a reference through one, which is what makes
  renaming free. **Nothing outside `nameOf()`/`adoptLegacyNames()` should read a per-type
  name column** — writing `.itemName ||` or `.room ||` anywhere else is the old ladder
  growing back. (`roomNameFor`/`buildingNameFor` were doing exactly that and were switched
  to `nameOf()` in the same change; `panel.html`, `panel-qr-sheet.html` and the backend's
  `displayName_()` read `name` with the legacy column as a fallback, since the public QR
  page has to be right both before and after the sheet is rewritten.)
- `parentTypes` — which types an asset of this type may sit **inside**, as an array of type
  names; `[]` means it takes no parent. This replaced the old `linkage` enum
  (`"room"`/`"building"`/`"allocations"`/`"none"`) when the fixed `roomId`/`buildingId` pair
  collapsed into one `parentId` — `linkage` existed only to describe those two fields, so
  keeping it would have left a second source of truth about the same question. **The registry
  is the only thing render sites should branch on** — never a hardcoded type-name comparison.
  See "The parent chain" below for the full story.

Types added at runtime via the gear-icon manager are deliberately NOT in the registry: every
lookup falls back to a generic room-dwelling device (no icon, no field rules,
`DEFAULT_PARENT_TYPES`), which is exactly how they behaved before the registry existed. Note
that "which assets *are* Rooms" queries (`roomNameFor()`, the Contents tab's
`isPlace`/`contentRooms`, the Duplicate button's place check, and `roomNameOf`/`buildingNameOf`'s
"is this asset itself one?" test) legitimately still compare type names — those are identity
questions. "What may contain what" is a capability question and goes through the registry:
the toolbar's `roomMovable` (bulk "Move filtered to room") asks `canBeParentOf("Room", a.type)`,
which correctly began including Rooms themselves once a Room could nest inside another. The
Contents tab no longer asks the question at all — it walks the chain downwards
(`descendantsOf()`), which is how the old Condenser special case disappeared.

`roomMovable` also excludes **the room being moved out of**, and that exclusion is load-bearing
rather than tidy-mindedness: the scope matches the room *and* everything under it (that's what
lets it find things nested deeper), and a Room is itself Room-movable, so without the exclusion
every use of "move the devices in this room" quietly moved the room into the destination too —
restructuring the building instead of relocating equipment. Nested rooms below it stay movable,
which is the coherent reading of "everything in this room moves". The bug was introduced by
making the *Room filter* chain-aware, back when the filter was what this hung off (it was
harmless while the filter only ever matched a direct `roomId`), and was caught in browser
testing, not by reading the diff. The filter is gone and the scope replaced it, but the
exclusion is the same rule about the same hazard.

`fieldAppliesTo()` reads the merged entry — e.g. Room and Building assets don't have
brand/model/serial; Bulk Items (chairs, tables — not individually tagged) get a `totalQuantity`
and a `subType` instead, and are distributed across rooms via their own `allocations` array
rather than a single `room` field. `subType` ("Sub-Type" in the UI) is picked from its own
managed list (`bulkItemTypes`) rather than freeform text, so it stays consistent.

**`subType` was called `itemName` until v24.** Renamed so the sheet column says what every label
in the app already said — the field carries only the category now, since `name` took the naming
half of its old double duty in v23. Done the way `parentId` and `name` were: `subType` is
written, `itemName` is still read as a fallback (`adoptLegacySubType()`) and still written by the
backend, so the change is reversible and un-migrated rows resolve; clearing the old column is a
separate later step. A stored column config maps the old key to the new one on load
(`RENAMED_COLUMN_KEYS`) — without that it would keep the dead `itemName` column *and* gain
`subType` from the add pass, showing the same thing twice.

**The Type column shows the type word and nothing else** — "Room", "Bulk Item", "Computer" —
since v23. It used to print a Room's name there (via a local `realName`), and a Bulk Item's
sub-type plus a small "BULK" badge; both are gone, along with the badge, which only existed
because the column was showing "Chairs" and there was otherwise no way to tell what kind of
row it was. Name now has its own column, visible by default and sitting ahead of Type. The
Sub-Type column shows only the category. The detail-view header is unchanged in shape: it
prints `label` and then `titleText`, which is `"<name> (<type>)"` for a named asset and
otherwise the older `type · screenSize` / bare `type`, keyed on `nameOf(asset) !==
asset.label` so a nameless asset can't render "BCA0082 BCA0082".

**No native `<select>` appears anywhere in the app** — every single-select field uses the same
custom modal picker (`SelectionModal`) instead: a centered card with a scrollable option list
and a checkmark on the selected item, visually matching the column-filter popup
(`activeFilterCol`) rather than the browser's native dropdown chrome. `PickerTrigger` is the
button that opens it, styled like the old `<select>` so form layouts didn't need to change.
`TypeField`/`RoomField`/`BuildingField` are bespoke wrappers (id-based, with "(deleted room)"-
style dangling-reference handling); everything else — Frequency, Change Type, Vendor, Bulk Item
Sub-Type, Breaker Type, panel Layout, the Move Circuit/Add Breaker/toolbar
bulk-action pickers, and `ChildEntityTable`'s generic `type: "select"` field — goes through the
generic `PickerField` component (same `PickerTrigger` + `SelectionModal`, parameterized by
`options`/`labelForOption`/`onManage`). Pass `hideLabel` when the field already has its own
label elsewhere (e.g. an outer flex-row `<label>`, or a mode-toggle button pair like the
Circuit form's Serves-rooms/Feeds-sub-panel picker) so `PickerField` renders just the trigger,
not a second redundant header. `UserField`/`PeripheralsField` are deliberately NOT `PickerField`
— they're multi-select chip-toggle groups, a different interaction from a single-select dropdown.

### The parent chain

**An asset's place in the world is ONE reference: `parentId`, holding the containing asset's
`label`.** A device's parent is its Room, a Room's is its Building, a closet's is the
classroom it's inside. This replaced the fixed `roomId`/`buildingId` pair, which could only
ever express two levels (Building contains Room contains equipment) because the hierarchy was
baked into the field *names*. Now the hierarchy is ordinary data and can be any depth.
An asset's own display name is untouched by this — it's a plain string on the asset (`name`
since v23; `Room.room`/`Building.building` before that), the one genuinely plain string here,
since a Room doesn't reference itself.

Depth is unlimited by design (Eric's call, 2026-08-19): `Room`'s `parentTypes` names `Room`
itself, which is what lets a closet nest inside a classroom. Nothing caps it, because a cap
would be a new hardcoded rule right after removing the old one.

**`Campus` sits above `Building`** (added 2026-08-20, so the app can describe more than one
site — the school plus a separate residence). It's the payoff for the whole parent change: a
registry entry, a `campus` column, a backend field, and `campusNameOf()`. Nothing else needed
telling the world got a level deeper — paths, the Contents tab, the parent pickers, search,
sort and export all just walk one more link. Compare what the old fixed `roomId`/`buildingId`
pair would have required: a third id field and a rewrite of every site that resolved a place.

**Which tabs a type gets, and which opens first, come from the registry too** (the rest of the
type-settings consolidation, 2026-08-20). Three keys and three helpers:

- `modules` on a registry entry names the extra detail tabs that type owns — `["allocations"]`
  on Bulk Item, `["breakers"]` on Electrical Panel, `["locks"]` on Door when that exists.
  `hasModule(type, key)` is what render sites ask instead of naming the type that happens to
  own it today; `modulesFor(type)` lists them.
- `ASSET_MODULES` says what each module IS — its tab label and how to count its contents.
  Kept separate from `modules` because they answer different questions: whether a Door has
  locks is a fact about Doors, while what a "locks" tab is called is a fact about the locks
  module, and a second type owning locks shouldn't mean restating the label.
- `defaultTab` is which tab opens first (`defaultTabFor()`), defaulting to `"details"`. Only
  worth setting when Details isn't the useful landing place — opening a panel anywhere but its
  Layout wastes a click every time.
- `availableTabsFor(type)` composes the whole ordered list: the common tabs, Contents when
  `isPlaceType()`, and the type's modules. **The tab bar and the deep-link check both read it**,
  which is what stops a link selecting a tab the bar doesn't offer — a `?tab=breakers` link
  pasted onto a Computer used to render the tab strip with nothing under it, and now falls back
  to that type's default. Deep links outlive the asset they were copied from.

This replaced a `type === "Electrical Panel"` test repeated at the tab list, the tab body and
the default-tab choice, plus the Bulk Item equivalent — three places to remember per module,
with nothing to catch a miss. Verified by the change it was built for: temporarily adding
`modules: ["allocations"], defaultTab: "allocations"` to Room gave Rooms a working Allocations
tab that opened by default, with **no other edit anywhere**.

**Contents is the one tab that is derived rather than declared** — a type has it when anything
can sit inside it, which falls out of `parentTypes`. Listing it in `ASSET_MODULES` would mean
hand-maintaining a fact the registry already computes, and Campus would have needed adding to
that list to get a Contents tab at all.

**`isPlaceType()` answers "can this contain things", derived from the registry** rather than
declared: it's the union of every entry's `parentTypes`, so a type becomes a place the moment
anything names it as a possible parent. This replaced a hardcoded
`type === "Room" || type === "Building"` at the Contents tab and a matching
`!== "Room" && !== "Building"` on the Duplicate button — both of which silently excluded Campus
when it arrived (no Contents tab on a campus; a Duplicate button that Rooms and Buildings
correctly don't have). It's also the cheapest possible version of the deferred "move place-ness
into the type settings" work, done here because Campus forced it rather than as a refactor of
its own.

**Which types may contain which is `parentTypes`, in the registry** — never a type-name
comparison at a render site. `parentTypesFor()` reads it, `typeTakesParent()` asks whether
there's a Parent field at all, `canBeParentOf(parentType, childType)` is the rule itself. An
**empty array** means "takes no parent", covering two cases that need no distinction anywhere:
a `Building` (top of the tree) and a `Bulk Item` (no single place — it spreads a quantity
across rooms via `allocations`, which is explicitly *not* parent/child). Every registered type
declares `parentTypes` explicitly, so `parentTypesFor` deliberately does NOT default a
registered entry to `[]` — an omission on a registered type should be a visible mistake, not a
silent "contains nothing". Only an *unregistered* (user-added) type falls back, to
`DEFAULT_PARENT_TYPES` (`["Room"]`), i.e. a generic room-dwelling device.

**No parent is a real state, called "Unassigned"** (`UNASSIGNED_LABEL`), not a blank — a spare
in a drawer, something just delivered, a unit away for repair. Deliberately not "Unplaced":
a parent is containment, not necessarily *location*, so a future type whose parent isn't a
place would make "Unplaced" read as nonsense. Only shown for a type that could have a parent;
a Building or Bulk Item renders nothing, since having none is their permanent correct state.

**Everything derived from the chain is computed, never stored**, extending the principle
the now-removed `inferBuilding()` followed: `roomNameOf()` / `buildingNameOf()` / `campusNameOf()` walk up to the nearest
Room/Building (answering with the asset's *own* name when it IS one), `effectiveBuildingId()`
does the same for a stable id, `pathOf()` renders the whole chain outermost-first, and
`descendantsOf()` looks the other way for the Contents tab.

**Every walk is loop-safe, and that is load-bearing, not padding.** With fixed room/building
fields a cycle was structurally impossible; with a general parent it isn't. `ancestorsOf()`
carries a visited set (plus `MAX_PARENT_DEPTH` as a second belt against a merely absurd
chain), so it terminates on "A inside B inside A" instead of hanging the browser. The app
refuses to *create* a cycle (`wouldCreateCycle()`, wired into `saveDraft` and into
`ParentField`'s candidate list), but **storage stays permissive** — the backend validates
nothing, matching every other rule in this app — so bad parentage can still arrive from a
hand-edited sheet or a bulk script, and the app must tolerate *and flag* it rather than break.
`parentageProblem()` is the flag: a banner on the Details tab naming what's wrong (parent
missing, wrong type, part of a loop). Note `ancestorsOf(asset)` can never report that `asset`
is its own ancestor — it seeds its visited set with `asset.label` and stops at the first
repeat — so the "is this in a loop" test has to be `wouldCreateCycle(asset.label,
asset.parentId, ...)`, i.e. "would re-pointing it where it already points close a loop".

**A type that takes no parent is never GIVEN one, and a stored one self-heals.** Three bugs met
on the live sheet's Bulk Item (2026-08-25), all of which only bite a type with `parentTypes: []`:
- `adoptLegacyParentage()` adopted a pre-v9 `roomId` as a `parentId` regardless of type. A Bulk
  Item spreads across rooms via allocations and takes no parent, so this manufactured an asset
  permanently flagged by `parentageProblem()`. It now returns early for such a type.
- That flagged asset **could not be saved at all**. `saveDraft` refused on `validateParentChoice`
  and wrote the message into `draft.parentError`, which renders *inside* `ParentField` — a field
  a no-parent type doesn't have. Save appeared to do nothing, with no control to fix it. Now the
  edit path CLEARS `parentId` for such a type instead of refusing (no parent is its only correct
  value, so this is a repair), the error also renders at form level, and the banner's "pick a
  different parent" advice is suppressed where picking one is impossible.
- `hasMisadoptedName()` bailed out whenever the type's own legacy name column held anything,
  which skipped the one type that has BOTH its own column and a stale `room`: the broken first
  backfill read `room` first, so a bulk item called "Room 100" instead of "Chairs" was precisely
  the case the repair could never see. It now ignores the type's own column and checks the rest.

**Load order matters**: `applyTypeSettings()` runs BEFORE the assets are mapped, not just before
its own `setState`. The load-time backfills ask `typeTakesParent` and `isPlaceType`, which read
the module-level settings, so applying them later means the first load after a settings change
adopts parents and names under the PREVIOUS rules.

**Reading old data needs no migration**: `adoptLegacyParentage()` runs in `loadData()`'s map
and reads a pre-v15 asset's `roomId`/`buildingId` as a `parentId`, so nothing past `loadData`
ever sees the old shape and the same build is correct against a migrated sheet and an
un-migrated one. `parentId` wins when both exist. See `PARENT_CHILD_MIGRATION.md` — the short
version is that the first asset-domain save after deploying v15 rewrites the whole Assets tab
and thereby migrates everything, so there's no script to run.

**"Condenser" is the type that shows `parentTypes` doing its job**: `{ parentTypes:
["Building"] }` and nothing else — an outdoor unit sits in no particular Room, so it names
Building and is simply offered Buildings by the Parent picker. Under the old model this took
three keys (`linkage: "building"`, `onlyFields: ["building"]`, `excludedFields: ["room"]`)
plus special cases at two render sites, because it was the one non-Room type with a direct
`buildingId`. Both special cases are gone: nothing branches on *how* a type attaches any more,
it just walks up. Reuse the one-key entry for any future type that attaches to a Building as a
whole rather than to one Room.

This is deliberate hardening, not the original design: earlier, everything stored the
target's display *name*, kept in sync by a rename cascade in the edit-save handler that
walked every asset and rewrote matching `.room`/`.building`/`allocations[].room` strings.
That cascade had a real gap — it never reached into
`panel.breakers[].circuits[].roomsServed` (nested inside Electrical Panel assets), so
renaming a Room silently orphaned the panel diagram's "Feeds" view and a Room's "Fed by"
banner. Switching every reference to an id removes the whole cascade requirement:
renaming a Room/Building is now a normal single-asset field edit with nothing else to
keep in sync, since every reference already holds the id, not the stale name. Deleting a
Room/Building that's still referenced is blocked (`canDeleteAsset()`, wired into the
`confirmDelete` modal) the same way Breaker Type deletion is blocked when still in use
(`canDeleteBreakerGroup`/`findBreakerTypeUsages`) — client-side only, consistent with
every other delete guard in this app.

**`ParentField` is the one field that says where an asset sits.** It replaced `BuildingField`
outright and took over `RoomField`'s placement role; `RoomField` survives with exactly one
caller, the Bulk Item Allocations tab, which picks a *Room specifically* rather than a parent.
Which types may be chosen comes from `parentTypesFor(childType)`, so a Computer gets Rooms, a
Condenser Buildings, a Room both — no list to maintain here. The trigger shows the chosen
parent's **full path**, since the browser's breadcrumb is gone once the modal closes and two
rooms can share a name. A dangling id resolves to `"(deleted asset)"`, not `""` — blank is
indistinguishable from Unassigned, which is now a different and legitimate state.

**`HierarchyBrowserModal` is the app's one place picker — a drill-down over the hierarchy, not
a flat list** (Eric's call, 2026-08-20). It first shipped inside the parent field as a flat
list of every valid candidate, each suffixed with its own chain to disambiguate ("Kitchen —
Building 100" vs "Kitchen (Upstairs) — Residence"); that works at four rooms and falls apart at
forty, with the path suffix doing the work navigation should do. You now start at the roots,
open one, and see only what's inside.

It was generalized out of the parent field once the same complaint applied everywhere else, and
**every place-picking control in the app now goes through it**: the Parent field, the circuit's
"serves rooms", the Bulk Item allocation picker, and the list toolbar's bulk move-to-room. Four
flat lists of every room was three too many. Callers pass a rule, not a list —
`isSelectable(asset)` (a type test, usually), an optional `excluded` set of labels to hide
outright, `multi` for several-at-once, and `noneLabel` for the "choose nothing" row.
`noneLabel` is deliberately NOT defaulted to "Unassigned": that word is right for a parent (a
real, meaningful state) and nonsense when assigning chairs to a room, where the honest answer
is that there's no such row at all.

The constraint that shapes the component: **the things you navigate THROUGH are usually not
things you may pick.** Choosing a Room, a Building is never a valid answer but is the only
route to the Rooms. So a row has up to two independent affordances — a body that selects it
(when legal) and a chevron that opens it — and when a row isn't selectable its body opens it
instead, because otherwise the obvious click would do nothing. Three rules keep it honest:

- **No dead ends.** A row is hidden unless it is itself selectable *or* something inside it is
  (`hasSelectableInside`, recursive with a visited set). An empty new Building is therefore
  offered when placing a Room and hidden when placing a Computer — and note the first of those
  is load-bearing: filter it out and you could never put the first Room in a new Building.
- **Self and descendants are excluded from the tree**, not greyed out — nothing below an asset
  can legally be its parent, so there's nothing to navigate to down there either. `saveDraft`
  still validates (`validateParentChoice()`), since a form left open while the chain moved
  underneath it can get past a filter computed at render time.
- **A dangling parent counts as a root** (`parentKeyOf` maps it to `null`), so an asset whose
  Building was deleted stays reachable instead of being stranded outside the tree.

It opens at the current value's level so the existing choice is visible and ticked. **Known
gap:** assets inside a *loop* are unreachable here, since they're neither roots nor below one
— the flat list would have shown them. That's bad data either way, only creatable by hand
editing, and `parentageProblem()` flags it on the asset's own Details tab, which is where it
gets fixed. The recursion is loop-safe regardless (verified against injected cyclic data).

**Multi-select** (`multi`) differs in three ways that all follow from one problem: you can only
see one level at a time, so you can't see your own selection. So it keeps a working copy and
commits once on **Done** rather than per click (a circuit's rooms are one edit, not one per
room); it renders the running selection as removable chips above the breadcrumb, so a pick made
three buildings ago stays visible and can be undone without navigating back to it; and it has
no "none" row, since picking nothing is just an empty chip row. `RoomsServedField` wraps it for
the circuit form and keeps those chips on the form itself — they're the answer to "what does
this circuit serve", which is what you want visible while filling it in, and each carries its
building, which is the ambiguity ("Kitchen" vs "Kitchen") that started all this.

**`RoomField` picks a Room specifically — not a parent.** Its callers are the Bulk Item
Allocations tab (a distribution across rooms, explicitly not parent/child) and the toolbar's
bulk move-to-room. `excludeId` hides one room from the tree, which the toolbar uses to drop the
room being moved *out of* — the one destination that can't be meant.

**The sub-panel feed picker shows `label — path`** ("BCA0083 — Building 200 › Room 200"). A
panel has no name of its own, so its Asset ID is its identity, but an ID alone is
unidentifiable standing in front of four panels. It listed bare ids before. It stays a flat
`PickerField` rather than a drill-down: there are four panels, not forty.

**`HierarchyNav` is the drill-down that sits above the asset list** (added 2026-08-20): a
breadcrumb plus a row of child places, narrowing the list to everything *beneath* wherever you
are, at any depth — drill to a building and you get the equipment in all its rooms, not just
what hangs directly off the building. Its state (`scopeId`) is **navigation**, deliberately
separate from the column **filters**: they intersect rather than override, and the scope
excludes the place itself (you're looking inside it).

It's deliberately NOT built on `HierarchyBrowserModal` despite the overlap. That component
picks one thing out of a tree and closes, and to do it it hides rows you can't pick and
branches that lead nowhere. Here every place is enterable — an empty building is still
somewhere you'd navigate to, to confirm it's empty — and nothing is "selectable" at all.
Sharing them would mean a predicate saying "everything" plus switches disabling the modal's own
hiding rules: more configuration than the shared tree-walking is worth.

`bulkMoveSourceId` is the "Move filtered devices to room" toolbar's source room, and it reads
the scope alone: the scope when the scope IS a Room, otherwise nothing, in which case the
toolbar doesn't render — with no single room to move out of, the action has no meaning. It used
to fall back to `roomFilter`, which no longer exists; the scope was already the primary way to
narrow to a room and is the better source anyway, since it matches nested rooms the way the
filter did. `moveFilteredTo` then re-points the scope at the destination, so the user follows
the assets they just moved instead of staring at the emptied room.

**Room, Building and Campus are not columns at all** (removed 2026-08-25). They were computed
columns — sortable and filterable but written by nothing — and the whole idea went with them,
`isComputedColumn`, `isOwnPlaceColumn` and `computedPlaceValue` included. Path already says
where something is, more completely; a second, partial answer beside it was the leftover.
Their type-aware ancestor `isComputedColumnFor` had gone one step earlier, when `name` stopped
those columns doubling as one type's own name — which is what made this removal possible at
all, since before `name` the `room` column was the only way to name a Room.
- **They survive in the Excel export**, which now builds them itself rather than walking
  `columns` (see `exportToExcel`'s `writePlaceColumns`). That coupling is exactly what would
  have deleted them from every export the moment the list stopped carrying them.
- **A stored column config has to be cleaned on load** (`RETIRED_COLUMN_KEYS`): the column
  migration only ever ADDED newly-introduced defaults, so an existing sheet would otherwise
  keep offering all three forever. Custom columns are never touched — a custom key is a real
  field on every asset, so dropping one would hide stored data.
- `MOCK_SNAPSHOT` carries a stored column config *including* the retired three, so the sandbox
  exercises that removal instead of starting from `DEFAULT_COLUMNS`, which has nothing to
  remove. A fixture without one hides the only case that matters — the same blind spot that
  let the first version of the name backfill ship broken.

**The list shows one `Path` column instead of separate Building and Room** (Eric's call,
2026-08-19, having been shown the trade-off). Its column *key* is still `parent` — that's the
field it edits — while the list and detail read it out in full via `pathOf()`, e.g. "Building
100 › Room 101 › Storage Room". A path is what makes deep nesting legible: with Building and
Room columns alone, a panel in a closet in a classroom showed the closet and the building and
silently dropped the classroom. The asset itself is not repeated in its own path. Building and
Room columns were kept, hidden, for a while after that — their filters were still load-bearing
and each was still one type's own name — and were removed outright on 2026-08-25 once neither
was true. `exportToExcel` still emits them as its own resolved columns, since a spreadsheet is
where you'd group by building and a single path string can't be grouped.

**Every asset's own `label` (its Asset ID, e.g. `BCA0082`) is the one field the whole app
treats as a stable, unique identifier** — `Breaker.panelLabel`, `Circuit.feedsPanelLabel`,
the `roomId`/`buildingId` references above, and the global `auditLog`'s `assetLabel`
matching all assume it never changes. It's therefore excluded from `editFormColumns`
(`formColumnsFor(draft.type).filter(c => c.key !== "label")`, ~line 2290) — editable only
in the *add* form (`addFormColumns`, unfiltered), where nothing references it yet. Before
this exclusion existed, the generic edit form rendered "Asset ID" as an ordinary text
field with no protection at all — renaming an existing asset there silently orphaned its
own audit history (new entries are logged against the *old* label at save time, via
`original.label`) and desynced `selectedLabel` from `assets` (kicking the user back to the
list view on save), the same failure mode the Room/Building hardening above was built to
eliminate — found by auditing the codebase for other name-vs-id gaps after that fix.

Two further gaps in that same "label is the primary key" story were closed later, both in
the *add* path (the only place a label is authored at all):

- **A duplicate label is rejected at creation** (`findLabelConflict()`, called from
  `saveDraft()`'s add branch, case-insensitive and trimmed). The suggested label is
  editable, so a typo could previously collide with an existing asset — and every lookup
  that uses a label matches *all* rows sharing it (`assets.map(a => a.label === selectedLabel
  ...)`, delete's mirror `filter`, and the backend grouping child rows by `assetLabel`), so
  two assets with one label aren't two colliding assets, they're one merged asset with no
  way to separate them again. The add form shows an inline error naming the existing asset
  (and saying so when it's archived, since an archived asset isn't in the default list view)
  rather than returning silently — Save doing nothing is indistinguishable from Save working
  to whoever typed the typo. Empty Asset ID / Type go through the same inline error.
- **Labels are issued from a persisted monotonic counter, not recomputed from the assets.**
  `nextAssetNumber` lives in the Config domain (backend v11) and is read by
  `peekAssetNumber()` / advanced by `advanceAssetNumber()`; `startAdd()` and
  `duplicateAsset()` both go through it, so they can't disagree. Deriving it as max BCA
  number + 1 — what both did before — meant permanently deleting the highest-numbered asset
  freed its label for immediate reuse, and since AuditLog is keyed by `assetLabel` and
  deliberately outlives the asset it logged, the next asset created silently inherited the
  dead one's created/edited/archived/deleted history. `peekAssetNumber()` returns
  `max(counter, derived)` rather than the counter alone, which is what seeds it on an
  existing sheet (counter null → derived wins) and what keeps a counter that somehow lags
  the sheet — a direct API write, a migration script, a hand-edited Config row — from ever
  handing out a number that's already taken. It never decrements: a hand-typed *higher*
  label pushes it past that number, a lower one (filling a hole) leaves it alone, and a
  non-BCA label consumes nothing. Only BCA numbers are ever generated; the BCR/BCB labels on
  Rooms/Buildings predate this and are never issued by it, and there's no per-type prefix
  scheme — a new Room still gets a BCA label like everything else.

### Reference conventions — apply these to any new module

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

**A person's name is TWO FIELDS, and how it reads is a SETTING (backend v36).**
`firstName`/`lastName` are the source of truth for what a person type is called; the single
`name` string everything displays is COMPOSED at render by `nameOf()`, in the order chosen
by **Name format** in the account menu — "John Smith" or "Smith, John", app-wide and at
once: the list, the pickers, the assignment chips, the detail header, the audit sentences.

- **This is option C of three, chosen knowing it was the expensive one.** Composing on save
  and keeping `name` stored (option B) would have been a much smaller diff and left every
  reader untouched. It cannot express this feature: a stored string has ONE spelling, and
  the whole point is that a person reads differently depending on how you have asked to see
  them. So the parts had to become the truth and every site that read a person's `name` had
  to learn to ask `nameOf()`.
- **THE NAME COLUMN HAS ONE SORT — A→Z / Z→A, like every other column — and the SETTING is
  what makes it a surname sort.** It compares `nameOf()`, the name as written, so under
  "Last, First" the string already begins with the surname. One control, and the list is
  always ordered the way it reads.
- **Two earlier shapes were tried, and both are worth keeping written down**, because each
  looked right and the second is the one that would get reinvented:
  1. **The sort chose the FORMAT** — four options in the Name column's popup, where picking
     *Last name* also flipped every name to "Smith, John". Rejected on sight. It conflates
     how you want a list ORDERED with how you want it READ.
  2. **The two were split apart** — the setting spelled names, and the column kept both sort
     keys comparing a canonical string, so a sort could not be moved by a preference. That
     fixed (1) and bought something subtler: the Name column became the only column in the
     app whose header did not simply sort itself, and the list could be ordered in a way its
     own rows did not read.
  The one sort that follows the setting is what both were reaching for. **The cost, stated
  plainly:** you cannot sort by surname while reading "John Smith" — that is one choice now,
  not two, and Eric's call was that a single control is worth more than that combination.
- **So the sort VALUE is spelled**, which is why `filtered` takes `personNameOrder` as a
  dependency. It is also why the Name column cannot use the generic `x[key]` sort path: a
  person has no stored `name` to compare.
- **EVERY column whose cell resolves a name must sort on the resolved string**, and this is
  the one that shipped broken. The **User** column displays `personTextOf` but sorted the
  stored `person` field, so its cells read "Cantrell, Aaron" while the order ran Aaron,
  Denise, Dillon — which is exactly how the setting looked ignored. That field is the legacy
  slash-joined copy written FROM the ids, so it was both a shadow of what was on screen and
  permanently spelled first-name-first: no setting could ever have moved it. The mismatch has
  now happened twice (`name` when people gained parts, `person` when the setting shipped), so
  `test-frontend-personname.js` reads `sortValue` as SOURCE and fails if `name`, `person`,
  `parent` or `type` loses its branch — a column falling through to `x[key]` is the regression.
- **`type` was the same bug in its quietest form** (fixed 2026-09-12). Its cell shows
  `typeNameOf` while the sort read the stored id, and **a built-in type's id IS its original
  name** — so the column was correct for everything shipped and wrong only for a type created
  at runtime, which sorts by a UUID nothing on screen explains. `MOCK_SNAPSHOT` now carries
  one such type ("Access Point"), because a fixture of built-ins alone cannot tell the two
  strings apart and so could never have shown this.
- **The setting is PER-DEVICE `localStorage`, the same class as column visibility** — it
  changes nothing that is stored, so it needs no backend version, no deploy, and cannot lose
  a race with someone else's save. Namespaced by tenant like every other key here. Offered
  to viewers and in Sandbox, since it is about reading rather than editing.
- **`name` is EXCLUDED for a person type** (User's `excludedFields`), so no form offers a
  third field competing with the two parts. Two render sites therefore read `nameOf()`
  BEFORE the `fieldAppliesTo` gate rather than after it — the list's Name cell and the
  Excel export — or every person's Name would be blank in the one column the list is
  scanned by. **Any new site that shows a name must do the same**; the gate is about
  whether the field is EDITABLE, and a person's name is displayable without being stored.
- **A person's old `name` cell rides along untouched, exactly as `label` rides under `tag`.**
  It is what the parts were split from, so it is the way back if the split is judged wrong.
  Nothing writes it, and `nameOf` never falls back to it while a part exists — preferring it
  would show the pre-split spelling forever.
- **THE ORDER IS A MODULE-LEVEL VARIABLE, and the hazard TYPE_SETTINGS carries does NOT
  apply to it.** `nameOf` is called from ~100 sites, most of them plain functions, so
  threading a format argument is the same behaviour-free diff `TYPE_SETTINGS` exists to
  avoid. The difference: `TYPE_SETTINGS` is safe only because every write happens to be
  followed by a `setState`, while `PERSON_NAME_ORDER` is mirrored FROM React state that
  re-renders by definition — the Name format setting — and is applied at the top of
  `AssetTracker`'s render body, before any child renders. A rendered frame cannot read a
  stale order.
  **What it DOES require: a `useMemo` that composes a name must take the order as a
  dependency**, or it hands back the previous spelling until its real inputs change.
- **`personMatchKey` is order-independent, and that is a data-loss guard rather than
  tidiness.** `unconvertedUserNames` compares a legacy `person` string against existing
  people; through `nameOf` that comparison finds nobody while sorted by last name, so every
  converted person reads as unconverted, `usersAreAssets` flips false, and — per the v28
  entry below — the next save writes id-stored assignments away. `convertUsersToAssets`
  would separately create a second record for everyone. **Never compare a person to a name
  through the display string.**
- **An audit row holds whatever spelling was current when it was WRITTEN**, so the audit
  log's name-matching (the one place it resolves a person by name rather than by id) tries
  BOTH spellings via `personNameVariants`. The stored text is history and is never rewritten.
- **The split is a load-time READ that fills a blank** (`adoptPersonNames`), never a
  rewrite: last whitespace token is the surname, only when BOTH parts are empty, and `name`
  is left byte-for-byte alone. Safe as an adoption because it is DETERMINISTIC — two
  browsers compute the same parts, which is the line between this and the randomly minted
  ids that stranded photos. A wrong guess ("Van Der Berg", a suffix) costs a retype and
  destroys nothing, and stored parts always beat a re-split.
- **`personType` in the registry is what makes a type a person**, alongside `locked` and
  `modules` — never a `type === "User"` test. A second person-shaped type gets the
  composition, the adoption skip and the sort by declaring one key.
- **`ColumnHeaderCell` and `ColumnFilterModal` are UNTOUCHED by this feature**, and that is
  the tell that the final shape is the right one. Shape (2) had grown them an optional
  `sortKeys` so one column could offer several sorts; collapsing to a single sort put both
  back byte-for-byte, so the Name header is the app's ordinary click-to-cycle control and
  there is no per-column sort configuration to maintain.
- **`splitPersonName` reads "Smith, John" as well as "John Smith", and that is required
  rather than generous.** The app now WRITES the comma spelling, so a name captured off the
  screen under that setting — a user filter's value, a bulk-reassign target, an audit row —
  comes back through the splitter, and splitting it on the last space makes the surname
  "Smith," and matches nobody. Found by driving it: a live User filter emptied the list the
  moment the format was changed underneath it.
- **The search matches both spellings**, because a person's name is not stored as one
  string and the raw field scan would never match a full name typed in.
- Covered by `test-frontend-personname.js`, which runs the real registry and the real
  helpers, including that composed names ORDER correctly under both settings. **The sort
  wiring itself is one call site inside a memo and is browser-verified, not unit-tested** —
  as is whether the setting survives a reload. Verified by
  mutation that six silent failures fail it: reading `name` ahead of
  the parts, an adoption that rewrites `name` (caught by a fixture row with irregular
  whitespace — recomposing tidies it, which is how "left alone" is told apart from "wrote
  back something that matches"), an adoption that declines only when BOTH parts are set,
  `personMatchKey` composing in the live order, an unconditional comma in the composition,
  and `adoptLegacyNames` ceasing to skip people.
- **`MOCK_SNAPSHOT` now carries People, and it is the fixture's first id-mode data.** It was
  wholly pre-v28 name mode, which meant no User assets existed to render at all — so this
  feature was unexercisable in Sandbox, the only place it can be tried without a deploy.
  Seven people in FOUR shapes deliberately: parts only, `name` only (adopted on load), both
  after a save, and both where the parts DISAGREE with a naive split (Ana Vega Ruiz, a
  two-word surname). James is the one-token case, who must read as "James" in both orders
  with no stray comma. The Kitchen's `person: "Multiple teachers"` had to go: it names
  nobody, and one legacy string with no User record behind it holds the WHOLE fixture in
  name mode.

**Users are assets (backend v28).** A person has a record, a detail page, and an audit
history, and an asset points AT one by id (`personIds`, an array of User labels) instead
of storing a name string. This is the app's **first many-to-many between assets** — one
device can have several users — which is why it wasn't the single-valued `parentId`
collapse and got its own phase.
- **Deliberately NOT the sign-in allowlist.** `authUsers` answers "who may open the app";
  a User asset answers "whose desk is this on". The app wants people in the inventory who
  never sign in — a student, or someone who has left whose history is still worth keeping.
  Linking them is a later question, and Eric's explicit call (2026-08-26) was to keep them
  apart for now.
- **Retiring someone is ARCHIVING them** (Eric's call), which keeps their history and every
  assignment intact. `canDeleteAsset` therefore blocks the permanent delete of a User who
  is still assigned to anything, exactly like a Room that still holds something.
- **`ensureLockedTypes` puts a missing locked type back in REGISTRY order, not at the end.**
  Appending is what User did on arrival: it landed below `Other` at the very bottom of the
  picker — the one entry beneath the catch-all, which is where the eye stops looking — and
  read as an afterthought rather than a peer of Room and Building. Existing entries keep
  their order; only the new arrival moves.
- **`person` is synced from `personIds` ONLY in id mode, and that gate is a data-loss fix.**
  `doGet` returns `personIds: []` for *every* asset, so in name mode — where `person` is the
  source of truth and nothing writes ids — an ungated sync overwrote `person` with `""` on
  every single save. It shipped, and it wiped assignments on the live sheet before Eric hit
  it. **Sandbox could not reproduce it**, because `MOCK_SNAPSHOT` rows carried no
  `personIds` key at all and the `isArray` test was false there. That is the lesson, not the
  line: a fixture whose SHAPE differs from the backend's actual response hides exactly the
  bugs the fixture exists to catch. `loadData` now normalizes `personIds` to an array for
  every asset from both sources, so fixture and backend agree.
- **Converting closes any open edit form.** The conversion changes what the User field
  means, and a draft seeded under the old meaning holds an empty `personIds`; saving it
  afterwards wrote that empty array back and blanked that one asset. Same class of bug as
  the one above, found in the same session by testing the two orders separately.
- **The mode switch is ALL-OR-NOTHING, and that is load-bearing.** `usersAreAssets` means
  the conversion is *complete* (`unconvertedUserNames.length === 0`), not that some User
  record happens to exist. An earlier version meant the latter and had a real bug: in id
  mode the edit form reads `personIds`, so an asset still carrying only a legacy `person`
  name rendered as **unassigned**, and the next save wiped the assignment. Found in browser
  testing, not by reading the diff.
- **`person` (the pre-v28 slash-joined names) is kept and still written**, trailing
  `personIds` the way `roomId`/`buildingId` trailed `parentId` through v17 — so the change
  is reversible and an un-migrated row still resolves. `personNamesOf()` reads ids first and
  falls back to it; **nothing outside `personLabelsOf`/`personNamesOf` should read either
  field.**
- **The conversion is offered in the LIST TOOLBAR menu** (next to Columns/Export/Add
  asset), shown only while `unconvertedUserNames` is non-empty so it surfaces itself once
  and then retires. It first lived only behind the gear on the User field — which is inside
  the *edit form* — i.e. a one-time setup action reachable only by opening an asset and
  clicking Edit, which nobody had a reason to do. It is still in the users manager too.
- **Conversion is a BUTTON, not a load-time rewrite** (`convertUsersToAssets`, in the users
  manager). Creating assets means issuing labels from `nextAssetNumber`, which lives in the
  Config domain behind the revision check — so a load-time conversion running in several
  browsers at once would race for the same numbers and one set of User assets would collide
  with the other. One deliberate click goes through `persist()` like every other write:
  audited, conflict-checked, all-or-nothing. Idempotent, so a name added later just re-runs it.
  - The conversion does **not** log a per-asset audit entry. Nobody's assignment changed —
    only its storage did — and an entry per asset would read "User changed from Jen Kramer
    to Jen Kramer" across the whole inventory, burying the entries that mean something. The
    User records being *created* is logged, which is the part that actually happened.
- **`assigned`/`unassigned` were reserved in v27 and are now live**, with no change to the
  audit renderer — which is the payoff the role-tagging was for. Reassigning a device writes
  `related: "<oldUser>:unassigned,<newUser>:assigned"`, so it lands in both people's history:
  "Phone BCA0003 unassigned" on one, "Phone BCA0003 assigned" on the other.
- `UserField` has two modes (labels vs. names) chosen by whether `userAssets` is passed, so
  neither path knows the other exists. It stays a chip toggle rather than a `PickerField`
  because several people can share one device.
- New Users get ordinary `BCA` labels — there is no per-type prefix scheme, same as Rooms.

**Audit entries name the OTHER assets they concern, in `related` (backend v27).** An entry
is stamped with the asset it happened TO (`assetLabel`), but most also concern somewhere
else: the room something moved out of and the one it moved into, the room a quantity was
allocated to, the rooms a circuit serves. `related` is a comma-joined string of
`label:role` pairs — `"BCR0006:from,BCR0020:to"` — built by **`relate({ from, to, ... })`**
and read by `parseRelated()`/`relatedRoleFor()`.
- **Ids, resolved at render — the audit log was the last holdout.** It stored display
  *names* (`parentNameFor(oldVal)` at write time, `room: roomNameFor(roomId)`), which is the
  one thing "Reference conventions" above forbids everywhere else. So "which entries involve
  Room 101" could only be a string match: ambiguous between two rooms of the same name, and
  stale the moment one was renamed. `from`/`to` still hold names — that is this entry's own
  wording — but the ids are what the rooms are found by.
- **The ROLE, not just the id, and that was the whole design question.** One row has to read
  correctly from every asset it names: the same move is "moved out" from one room and "moved
  in" from the other, and a created-in-a-room-and-assigned-to-someone entry will be "created
  here" from the room and "assigned to Jane" from the person. A bare id list says an entry is
  relevant but not *how*, which is not enough to word it. Roles: `from`/`to` (a move), `at`
  (where it happened — created/archived/deleted), `serves`/`feeds` (a circuit), and
  `assigned`/`unassigned`, **reserved unused for when users become assets**. Reserving them
  costs nothing now; adding them later means rewriting AuditLog, the one table with no
  rewrite path. Encoding the role also *removed* the separate `fromId`/`toId` columns an
  earlier draft had — the role already says which way a reference points, so three new
  columns collapsed to one.
- **`describeAuditFor(entry, viewerLabel, assets, typesList)`** renders an entry as the
  *viewer* sees it and **falls through to `describeAudit()` whenever the viewer IS the
  subject**, so every pre-existing call site is untouched. A subject with no role (reached
  via the contents section below) still gets named — "Serial changed from A to B" is useless
  in a room holding nine devices. The subject is `nameOf()`, and appending its type would say
  "Monitor BCA0002 (Monitor)" since `adoptLegacyNames` already builds names in that shape;
  only a **deleted** asset gets `"<type> <label>"`, since there the stored type is the one
  thing left. That fallback is load-bearing: audit entries deliberately outlive their assets.
- **Lookup goes through `auditIndex`, a `useMemo` keyed on `auditLog`** — two Maps of
  `label -> positions in auditLog`, one for the entry's subject and one for every id in
  its `related`. Not premature: the two lists live in the detail view's **render body**,
  so before this they were re-derived on every render of that view — every keystroke in
  the edit form, whether or not the Audit tab was even open — and each pass walked the
  whole append-only log calling `parseRelated()` on every row. Measured: 100k entries was
  ~26ms per pass on a desktop (~100ms on a phone), versus ~0.2ms from the index. It stores
  **positions, not entries**, because the log's append order IS its chronological order —
  so merging the two maps and sorting the numbers descending reproduces the old
  `.filter().reverse()` ordering without comparing timestamps.
  - **The ceiling is the full-snapshot load, not this lookup, and it always was.** `doGet`
    returns the entire AuditLog every time; at ~208 bytes/entry that is ~2MB at 10k entries
    and ~10MB at 50k. `related` adds ~25 of those bytes. So audit-log pruning (already on
    the deferred list) is what eventually bites, and it bites the payload long before any
    filter gets slow.
- **User names in an assignment entry are links too**, which needed one exception worth
  understanding. The people who actually moved come from `related` by id, like everything
  else. But someone already on the asset who *stays* has no id in that entry, and linking
  only the changed name read as arbitrary rather than as emphasis — so the remaining names
  are matched by NAME. That is safe **here and nowhere else**: this decorates text already
  on screen, it does not resolve a reference. An unmatched name stays plain, and an
  AMBIGUOUS one (two people sharing a name) is deliberately left plain, since there is no
  honest way to pick which page it opens.
- **The named assets are LINKS** (`auditSegments()`): "Computer BCA0001 moved out →
  Room 101" opens either one. Frontend-only — the ids were already in `related`, so this
  needed no backend change and no new version. The pairing is **structural, not a search
  for room-shaped words**: `related` says which id plays which role, and each role has a
  fixed home in the entry's own text (a parent move's `from` text IS its `from` id, an
  allocation's `room` IS its one id). Candidates that don't appear in the sentence simply
  never match, which is what lets the subject's own wording and the viewer-relative
  wording be fed one candidate list without either knowing which it got. Matching is
  longest-first and position-by-position, so "Room 10" can't win a spot "Room 101" starts
  at and a name appearing twice links twice. **Two things are never linked**: a value like
  "Unassigned" or an em dash, which name no asset, and an id whose asset is gone — audit
  entries outlive their assets, so that link would open nothing. `describeAudit()` still
  returns a plain string, which is what the Excel export needs.
- **The Audit tab is two sections**: the asset's own history (its entries plus every entry
  naming it), then **"Activity on contents"**, collapsed, keyed off `descendantsOf()`. No type
  test anywhere — a Building gets its rooms' activity and a Campus its buildings' for free.
  The contents section is a **live** view of current containment, so something that has since
  moved away takes its edit history with it; its *move* stays in the top section forever,
  since that entry names the room by id. The asset's own history is durable; the contents
  section is a snapshot.
- **Backfill**: `backfillAuditIds_()` in the .gs, run ONCE by hand from the Apps Script
  editor after deploying — deliberately unreachable from `doGet`/`doPost` and never on a
  trigger, since it rewrites history. Best effort by design: a name matching nothing leaves
  `related` empty and the entry stays out of the associated views, which beats guessing.
  Ambiguity takes the first match, accepted only because the sheet is sample data.

Every asset carries: `comments` (freeform notes), `changes` (structured: type/vendor/
cost/note — its own managed lists, editable via gear-icon "manage" buttons), and is
covered by a global `auditLog` that automatically records creates/edits/archives/
deletes/allocations (see `logAudit()`, `describeAudit()`) — this is separate from
`changes` and isn't user-authored.

Assets are archived (soft-deleted, `status: "Archived"`) rather than deleted by default;
permanent deletion is a separate, more heavily confirmed action only available on an
already-archived asset.

Every asset (any type) also has a `maintenanceItems` array — scheduled maintenance
entries with `task`, `frequencyLabel`/`frequencyDays` (picked from the fixed
`MAINTENANCE_FREQUENCIES` list, not a managed list, since a day-count is needed to
compute a next-due date), `lastPerformed`, and `owner` (freeform text). `nextMaintenanceDue()`
and `maintenanceStatusOf()` derive a next-due date and a status (`never` / `overdue` /
`due-soon` / `ok`) used to sort the Maintenance tab (most urgent first) and to flag the
tab itself in red when anything's overdue. Adding an item isn't separately audited (its
own `at`/`by` is enough); marking done, editing, or deleting one is, since those mutate
or remove data with no other history trail.

**"Change type" reads "Work type", and the button is "Log work" (2026-09-10).** LABELS ONLY.
The stored field is still `changeType`, the managed list is still `changeTypes`, and the sheet
column is unchanged -- renaming any of those is a schema change that would drop every existing
value on the next write, and it would buy nothing, since the label people read is the whole
point of the rename. Anything user-visible moved: the field, its picker title, its gear
("Manage work types"), the manager modal and its placeholder, the completion modal's copy of
the same field, the delete confirmation, and the Excel export's column header.
- Sentence case ("Log work", not "Log Work") to match every other button in the app -- "Add
  task", "Log completion", "Add comment".
- The edit dialog reads "Edit work entry" rather than "Edit work", which would read as a verb.

**Add and Log change are DIALOGS, and a history entry is editable (2026-09-10).** Both
sub-tabs used to open with a permanently expanded form pinned above their list, which pushed
the schedules and the history — the things the tab exists to show — below the fold on every
visit, including the many where nothing was being added. They are now an **Add task** and a
**Log change** button.
- **One dialog serves add AND edit for a change** (`changeModal` = `{ mode: "add" }` or
  `{ mode: "edit", idx }`, with `changeDraft` holding the fields either way). A separate edit
  form would be a second copy of the same fields to keep in step, which this file has been
  bitten by before.
- **Both openers reseed the draft on OPEN**, not only on close, so a cancelled edit cannot
  leave half-typed values waiting in the next dialog — the same rule entering breaker edit
  mode follows.
- **Editing a change is AUDITED, field by field**, exactly as editing a maintenance item is
  and for the same stated reason: it rewrites a record and, unlike adding one, leaves no other
  trail of what it used to say. A save that changed nothing writes no snapshot and no audit
  row.
- **`at` and `by` are never touched by an edit.** They record who first entered this and when,
  which stays true after a correction; the audit row records who changed it. Editing a typo
  must not rewrite provenance.
- **An edit does NOT restamp a linked schedule's `lastPerformed`,** even when the performed
  date is edited, and the *Mark this task performed* checkbox is **hidden in edit mode**.
  Completing is an act with its own opt-in; re-applying it every time someone fixed a typo
  would silently move a due date. `openChangeEdit` therefore never pre-ticks it.
- `openChangeEdit` seeds the date through **`changePerformedOn(ch)`**, not `ch.performedOn` —
  a pre-v34 entry has no such field and seeding blank would blank a real date on save.
- **The maintenance ADD is a dialog; its inline edit was left alone.** Not an oversight —
  only add was asked for, and the two are different flows. Worth revisiting together.
**The site-wide Maintenance tab mirrors an asset's (2026-09-10):** a `HierarchyNav` scope
filter, then **Scheduled** / **History** sub-tabs, then Add task / Log work.
- **It shares `scopeId` with the Assets tab, deliberately.** Narrowing to a building and
  switching tabs keeps you where you were; a second scope would silently widen the view and
  there would be no way to tell which one was in force. The scope now filters Scheduled too,
  which it did not before.
- **History is `allWorkRows`** — every change entry on every active asset, flattened the way
  `allMaintenanceRows` flattens schedules, defaulting to most-recently-performed first (the
  mirror of Scheduled's due-soonest). Its row `idx` is the entry's position in ITS OWN
  asset's `changes` array, never a position in the flattened sorted list — that would address
  the wrong entry the moment anything is re-sorted.
- **A History row opens that asset's History**, via `openDetail(asset, "changes")` — the
  legacy alias, which is exactly what it is for.
- **The two dialogs moved into `renderWorkDialogs()`, called from BOTH views.** They lived
  inside the detail-view return, which is why the site-wide tab could not offer them at all.
  A plain render helper, not a component: it closes over state and setters, so nothing has to
  be threaded. **It must be CALLED, not used as `<renderWorkDialogs/>`** — as a component it
  would remount every render and drop focus out of whatever field was being typed in.
- **`workDialogAssetId` says which asset a dialog writes to, and its THREE states matter.**
  `null` = the open asset (every detail-view case). A string = opened from the main page,
  where `""` means "nothing picked yet" and is what makes the Asset field appear. It is
  deliberately not `selectedId`: setting that would navigate the whole app behind a modal,
  and cancelling would leave you somewhere you never asked to be.
  - The openers use `assetId === undefined ? null : assetId`, NOT `assetId || null`. The
    obvious form collapses `""` to `null`, the dialog reads that as the detail-view case, and
    the Asset picker never appears — which is exactly what happened first time.
- **`AssetPickerField` is `HierarchyBrowserModal` with the predicate opened up** from "Rooms
  only" to "anything not archived". Everything being selectable means you drill with the
  chevron and select with the row body — the two-affordance design that component was built
  around, working as intended rather than by accident.
- **Nothing is pre-selected from the scope.** The scope is always a PLACE, and pre-filling a
  Room when most work is on a device inside it would be wrong more often than right.
- Save is disabled until an asset is chosen, in both dialogs — `workTarget` is the guard, so
  a main-page dialog cannot write to whatever happened to be open last.
**The Change Log is no longer a top-level tab — it is Maintenance › History (2026-09-10).**
The detail tabs are now Details / Maintenance / Comments / Audit, and Maintenance has two
sub-tabs: **Scheduled** (the recurring items) and **History** (what was actually done, i.e.
the entire former Change Log, unchanged). Answering "when is this due" and "what has been
done to it" from two different tabs made the link between them invisible, which is the same
problem `maintenanceId` was added to solve — this finishes it in the navigation.
- **`?tab=changes` still works and must keep working.** `openDetail()` translates it to
  Maintenance + the History sub-tab rather than dropping it, which would silently land on
  Details. Deep links outlive the layout that produced them — the same reason the panel tab
  kept its `"breakers"` key when its label became "Layout". `"changes"` is therefore a valid
  REQUEST forever while no longer being a valid `detailTab` VALUE; those are different things
  and the state's own comment says so.
- **The Maintenance tab's badge counts SCHEDULES, not history**, and keeps its overdue red.
  The badge answers "is there anything I have to do", and a growing count of completed work
  would drown that. Each sub-tab carries its own count.
- **The sub-tabs are styled as pills, deliberately unlike the tab bar above them.** They are a
  division within one tab; matching the bar would read as two competing rows of navigation.
- Implementation note: the two content blocks were NOT moved. Their conditions were narrowed
  (`detailTab === "maintenance" && maintenanceSubTab === "..."`) and a bar rendered above
  them, so the diff is three lines of condition rather than a re-indent of ~400 lines of JSX
  that would have buried any real change inside it.
**Both record types are addressed by their own id, never by array position (2026-09-10).**
A maintenance item got its `id` when work entries began referencing it; a work entry got one
when photos began attaching to it. Same rule, arrived at twice: **an id exists once something
points at the record, and not before.**
- **Why position was defensible until it wasn't.** `writeTable_` rewrites a tab in the order
  the client sent, so position survives a save. What it does not survive is a DELETE: remove
  an earlier entry and every later one shifts up, taking any attachment pointed at it to the
  wrong row. Nothing pointed at a work entry until photos did.
- **`change.id` was deliberately absent before this** — the reasoning is still in
  `CHANGE_FIELDS` — and adding it was a schema change, so it went into v34 while v34 was
  still undeployed, exactly as `performedOn` did. That trick expires the moment a version is
  live: check `node deploy.mjs --status` first.
- **Every handler now takes an id**: `openChangeEdit`, `deleteChange`, `saveChangeEdit`,
  `startEditMaintenance`, `saveMaintenanceEdit`, `openMaintenanceComplete`,
  `submitMaintenanceComplete`, `deleteMaintenanceItem`. The row objects no longer carry an
  `idx` at all, on either the detail lists or the two site-wide tables — so there is no stale
  index left to pass by mistake.
- **`editingMaintenanceIdx` was renamed `editingMaintenanceId`.** It held an id; a name that
  no longer says what the value is has cost this project real time more than once, and is
  treated as a bug rather than a tidy-up.
- **React keys are the ids too**, so deleting a row no longer re-keys every row beneath it.
- **Both are adopted at load** (`m.id || crypto.randomUUID()`, `c.id || crypto.randomUUID()`)
  — a read that fills a blank, reaching the Sheet inside whatever save happens next. No
  migration, and two browsers minting different ids is caught by the revision check.
- `MOCK_SNAPSHOT` stays MIXED: three work entries carry explicit ids, the rest are adopted,
  so both paths are exercised by the fixture rather than only by a unit test.
**A completion is a change-log entry, linked by `change.maintenanceId` (v34).** Marking a
task done and logging a change used to be two unconnected acts: "Mark done today" stamped
`lastPerformed` and wrote one audit row, so what a service visit actually cost, who did it
and what they found had nowhere to go — and a change logged separately had no idea a
schedule existed. The button is now **"Log completion…"**, opening a prefilled form
(`maintenanceCompleteModal`).
- **A maintenance item has a real `id`** — a `crypto.randomUUID()`, like a Breaker or a
  Circuit. Array position cannot serve: items are deleted by index, so removing one
  renumbers every item below it and would re-point every change referencing them.
- **The reference lives on ONE side.** A change names its schedule; a schedule keeps no
  list of its changes. Its history is derived (`changesByMaintenance`, a `useMemo` lifted
  out of the detail render body for the reason `auditIndex` was). Storing both would be a
  second copy to keep in sync, and it is the one that goes stale.
- **A dangling `maintenanceId` is a normal state, not corruption.** Deleting a schedule
  leaves its changes alone — a change records something that actually happened and outlives
  the schedule that prompted it, exactly as audit entries outlive their assets. It renders
  with no badge. No cascade, no cleanup, no repair pass.
- **The prefill is what keeps it one click.** Date is today, change type is `Maintenance`
  where that type still exists (seeded only if it does — the list is user-managed, and
  seeding a value that isn't an option renders a picker showing something it cannot
  re-select). A routine filter clean is still Save and go.
- **The date field is new capability, not just plumbing.** Back-dating a completion was
  previously impossible without hand-editing the schedule, and the audit row's `to` is the
  chosen date rather than always today — a row claiming today would be a lie about when the
  work happened.
- **One `persist()` writes the completion, the change and the audit row.** Every save posts
  the whole snapshot, so splitting it would mean several round trips for one logical act and
  a real chance of the second being rejected as a conflict with the first. Same reasoning as
  `saveBreakerUnit`.
- **The change entry is not separately audited**, consistent with comments and changes: it
  carries its own `at`/`by` and its presence in the Change Log is the record.
- **The Change Log's add form can attach a change to a schedule too** — an optional picker,
  hidden when the asset has no schedules — **and can complete it**, via a *Mark this task
  performed* checkbox with its own date, revealed only once a task is linked.
  - **The checkbox defaults OFF** (Eric's call, 2026-09-10), because the picker's main use is
    attaching a change that ISN'T a completion: parts ordered for next service, or a repair
    the tech found *during* it. Two entries against one schedule, one of them the completion.
    An unwanted stamp is also much harder to notice than a missing one.
  - **Completing is a deliberate tick, not a consequence of linking, and the date is why.**
    A change entry's only date is `at` — when it was *logged*, not when the work happened — so
    an automatic stamp could only ever say "today". Logging a visit from three months ago
    would then push the next due date three months out, which is worse than no link at all:
    it makes an overdue item read healthy. The checkbox carries its own date field for exactly
    the reason the completion modal has one.
  - It can move `lastPerformed` **backwards**, since `nextMaintenanceDue` reads it and nothing
    else. That is correct — recording a visit you hadn't logged yet is the point — and is why
    the date is editable rather than pinned to today.
  - **Ticked with an empty date is refused**, by the disabled-until-valid pattern the form
    already uses. Otherwise the change would log and the schedule would silently not move.
  - It writes the same `maintenance_completed` audit row as the modal, in the same single
    `persist()`, so a completion reads identically in the history whichever door it came
    through. The two paths are now the same operation reached from the schedule or from the
    log; they are kept as separate forms because the entry points differ, not the semantics.
- **`adoptLegacyMaintenanceIds` is a load-time READ that fills a blank**, last in
  `loadData()`'s map chain — not a load-time rewrite. A minted id reaches the Sheet only when
  some save happens for other reasons, inside that same snapshot: no migration, no script.
  **Two browsers can mint different ids for one item, and the revision counters are what make
  that safe** — whichever saves second is refused as a conflict and reloads onto the id the
  first wrote. Without optimistic concurrency this pattern would not be safe.
- The site-wide Maintenance overview gains **no column**: it is for triage, and clicking a
  row already lands on the asset's Maintenance tab where the history is. The Excel export's
  Changes sheet does gain a resolved **Maintenance task** column, since a spreadsheet is
  where anyone would total spend by schedule.
- Covered by `test-backend-maintenance-link.js`, which slices both `doGet` and `doPost` out
  of the .gs as source text. Verified by mutation that all four silent failure modes fail it:
  dropping the column from either header constant, from either per-row projection, or
  re-inlining a header literal at a call site. `MOCK_SNAPSHOT` is deliberately **mixed** —
  two assets carry item ids and linked changes (one with a dangling link), the rest are
  legacy-shaped with neither. A uniform fixture exercises half the code; that is the
  `personIds` lesson.

**Electrical Panel** assets (`type: "Electrical Panel"`) are otherwise device-like — real
brand/model/serial, purchase date, warranty, room placement via its `parentId` like any
other device — they just don't have `peripherals` (their registry entry's `excludedFields`). Each
carries a `breakers` array (own Breakers tab in the detail view), one level deeper than
anything else in the app: **Circuit → Breaker → Panel**. Breakers and Circuits are *not*
Assets themselves (don't appear in the main list, no independent archive) but get a real
`crypto.randomUUID()` id, since they get swapped/moved and other records point at them —
array position can't serve as identity once things move.

- A Breaker's footprint is `cells` — half-slot addresses like `["1a","1b"]`, not a list of
  whole slot numbers — see `BREAKER_TYPES_ARCHITECTURE.md` for the full reasoning. Poles are
  derived (`polesFromCells()` — count of distinct slots touched), never stored. This one
  addressing scheme covers single-pole, double-pole/240V, tandem, quad, and mixed/offset
  configurations without a `mount` enum (removed).
- **BreakerType** is a user-managed catalog (gear icon in the Add Breaker form → "Manage
  types") of reusable breaker configurations — a name, a slot span, and a list of members
  (relative cells + amp rating). Placing one via Add Breaker creates one real Breaker row per
  member atomically, all linked by a fresh `groupId`, with the type's amp ratings as editable
  starting values — not a live link; editing a placed breaker afterward never touches the type
  or its sibling rows. `breakerTypeId` on a Breaker is for display only (the type name badge).
  Seeded with 5 entries (`SEEDED_BREAKER_TYPES`): Single-Pole, Double-Pole (240V), Tandem,
  Quad, and Split Double-Pole (15/30/15) — a 2-pole breaker offset by half a slot from two
  independent single-poles, the case that motivated moving to cell addressing at all. Deleting
  a type in use is blocked, listing every panel+slot still referencing it
  (`findBreakerTypeUsages()`).
- A multi-member placement (tandem, quad, or any type with >1 member) is a GROUP of individual
  Breaker rows sharing a `groupId` — every breaker placed via Add Breaker gets one, even a
  lone single-pole (a "group" of one), so the panel diagram's grouping logic never needs to
  special-case mount/count. Editing an existing breaker never changes its cells/groupId/
  breakerTypeId (delete and re-add instead) — only Add Breaker creates groups.
- **Circuits are associated with a specific Breaker, not a slot** — clicking any member of a
  group in the diagram opens one modal for the whole group (every Breaker row sharing that
  `groupId`), since a breaker-type instance like a quad or split double-pole is one physical
  unit even though it's several rows. A single breaker can hold multiple circuits.
- Within that modal, fields are still *stored* by what they describe: **Amp Rating** is
  per-member (the one spec that legitimately varies within a unit, e.g. the 15/30/15 split
  double-pole), while **Serial/Installed Date/Notes** describe the one physical unit you
  bought and installed, so a single value is written to every member row rather than repeated
  per pole. But **editing them is one mode, not two**: the modal is read-only by default with a
  single icon-only pencil in its header (`breakerModal.editing`), and entering edit mode turns
  the instance fields AND every member's amp rating into inputs simultaneously, with one
  Cancel and one Save (plus the group Delete) in a footer at the bottom of the modal, below
  everything they act on. Cancel reseeds every draft from stored values; so does *entering*
  edit mode, so an abandoned edit can't leave a stale draft behind.
  - Save is a **single `persist()`** (`saveBreakerUnit`), which replaced a pair of per-field
    saves (`saveBreakerAmp` / `saveBreakerInstanceDetails`) each with its own pencil. That
    split made correcting a split double-pole's three amps plus its serial four edit/save
    cycles — and since every save posts the entire state snapshot (see Persistence model),
    four backend round trips for one logical edit.
  - Audit fidelity is unchanged and deliberately per-changed-thing: one entry per member whose
    amp actually moved (labelled with that member's own slot) plus one per instance field that
    actually changed (labelled with the group's slot) — never one blanket "unit edited" entry.
    A Save where nothing changed is a no-op: no snapshot write, no audit row. Amp drafts are
    compared as strings, since an untouched draft holds whatever was stored (possibly a number)
    while a touched one is always a string.
  - `activeMemberId` no longer gates editability — it now only tracks which member has its
    Circuits sub-table expanded, and that toggle is a chevron (matching `ChildEntityTable`'s own
    expand control), not a second pencil. It's hidden while in edit mode: circuits have their own
    add/edit/delete flow that persists immediately, so they'd escape the unit's Cancel.
- **Breakers have no `status` field at all anymore** — it was never editable after creation
  (Swap Breaker and the per-member edit only ever touched serial/amp/installed date), and the
  Add Breaker form was the sole place it could be set, so it was removed outright rather than
  built out into something editable: no Status picker in Add Breaker, no status-based color
  coding in the panel diagram (`statusColor()`/`groupStatusColor()` are gone — cell borders are
  now a plain `C.border`), no Status column in the panel Table view, no Status column in the
  Breakers export. A spare Table row now says "Spare" in the Type column instead of relying on
  a status value. Old `status` values already sitting on existing breaker data are harmless
  leftover fields — nothing reads them anymore.
- **Delete removes the whole group at once** (`deleteBreakerGroup`), not one member at a
  time — a breaker-type instance is one physical unit, not N independently removable poles.
  **A unit with circuits still attached is no longer refused**: the confirm prompt says how
  many circuits there are and that they'll be unassigned rather than deleted, and the button
  reads "Unassign & delete" so the outcome is never a surprise. The circuits land in the
  panel's `unassignedCircuits` (see the unassigned-circuits section), each one getting its own
  `circuit_reassigned` audit entry alongside the unit's `breaker_removed`. This replaced
  `canDeleteBreakerGroup`, which blocked the delete outright and left the user to move every
  circuit by hand first — only possible to improve once a circuit could exist without a
  breaker. `deleteBreakerGroup` still requires its `unassignCircuits` argument to be true
  before it will drop a unit that has circuits, so a future call site can't orphan them by
  omission; `attachedCircuitCount()` is what the prompt counts with.
- **Swap Breaker** (`openSwapBreaker`/`submitSwapBreaker`) still exists but its trigger button
  was removed from the breaker modal for now (per explicit request) — the functions and the
  swap modal are dead code until it's reconnected. If re-adding it, keep in mind Swap was
  designed as a single-breaker action (old serial/ampRating/installedDate on one row); the
  group-level instance-details edit above already covers the serial/installed-date case for a
  whole unit, so Swap's future role, if any, needs rethinking rather than just re-wiring the
  old button.
- A Circuit's `Circuit.feedsPanelLabel` marks it as feeding a downstream sub-panel instead of
  serving rooms directly (`roomsServed`) — mutually exclusive, enforced in `addCircuit`/
  `saveCircuitEdit`. A panel's "fed from" info is never stored on the Panel itself — it's
  found by searching all circuits for `feedsPanelLabel === thisPanelLabel` at render time,
  the same "computed, not stored" principle the parent chain already uses for a device's
  building.
- **`Circuit.label` is the circuit's nice display name** (e.g. "Outlets", "Water Heater",
  "Feed to Room 300 sub-panel") — it used to hold slot-style text mirroring the breaker's own
  cell notation ("1", "8a"), with the actual human-readable name living in a separate
  `Circuit.description` field. That split was redundant (the breaker already shows its own
  slot) and confusing (two name-ish fields), so `description` is gone — every circuit's
  identity is `id` (a `crypto.randomUUID()`, stable and guaranteed-unique, set once at
  creation and never re-derived) plus `label` (freeform, user-edited, the only name field
  now). The Add/Edit Circuit form is a single Label input; there's no separate description
  field to fill in. `MOCK_SNAPSHOT`'s circuits were migrated by hand — each one's old
  `description` became its `label`, and the handful with no description (the sub-panel-feed
  circuits) got a purpose-describing label written by hand (e.g. "Feed to garage sub-panel").
- **`Circuit.notes` is a free-text, multi-line field for what's actually connected** — one
  callout per line (e.g. "- North wall outlets\n- Closet outlets"), rendered with
  `whiteSpace: "pre-line"` so embedded `\n`s show as real line breaks without needing to
  split the string in JS. Uses the `ChildEntityTable` field system's new `"textarea"` type
  (added alongside the existing text/number/date/select/multiselect types — a plain
  `<textarea>`, `rows` configurable via `f.rows`, defaulting to 3). Shown in both the
  expanded (`ChildEntityTable`'s `renderSummary`) and collapsed (plain read-only list)
  circuit views — those two render blocks are kept in sync by hand since the collapsed one
  is deliberately NOT `ChildEntityTable` (no per-row actions there, see the pencil-icon
  standardization entry above), so a future circuit-summary field needs updating in both
  places. `MOCK_SNAPSHOT`'s circuits were populated by hand with realistic per-circuit
  callouts (walls/zones for outlet circuits, fixture names for lighting/appliance circuits,
  "Feeds downstream sub-panel; no direct loads" for sub-panel-feed circuits) — written via a
  line-number-anchored `sed` script (`/id: "cXX-Y"/ s/.../.../`) for the bulk of them, since
  authoring ~84 individual Edit calls wasn't practical; the two circuits with genuinely
  multi-line notes were done as direct `Edit` calls instead; see the PowerShell-file-editing
  memory entry — GNU sed's `\n` in a replacement means a literal newline unless doubled to
  `\\n`, and even that depends on how many escaping layers sit between you and the file, so
  verify escaping empirically (e.g. `sed 's/X/A\\nB/' <<< X | cat -A`) before trusting it on
  a real file, and diff/line-count-check immediately after any bulk substitution.
- **A circuit can belong to a panel without belonging to a breaker** (backend v13). Panel assets
  carry an `unassignedCircuits` array alongside `breakers`, holding circuits that exist but
  aren't wired to a slot yet — a run that's been pulled and labelled but not landed, or one
  taken off a breaker without being deleted. That's what forced `panelLabel` onto `CIRCUIT_FIELDS`:
  a circuit's panel used to be implied entirely by `breakerId` → that Breaker's `panelLabel`, so
  with no breaker there was nothing recording which panel it was for. `panelLabel` is now the
  authoritative panel for **every** circuit (`doPost` derives it from the panel being iterated,
  never from the client payload, so it can't disagree with the breaker's own panel), and `doGet`
  splits circuits by whether `breakerId` is empty. No migration was needed or written: every
  pre-v13 row has a `breakerId`, so it still attaches to its breaker on read and picks up its
  `panelLabel` on the next save of that panel.
  Frontend-side, `addCircuit`/`saveCircuitEdit`/`deleteCircuit`/`openMoveCircuit` all take the
  breaker id as their first argument and read a falsy one as "the unassigned list"
  (`circuitsIn()` picks the container, `updatePanelCircuits()` writes back whichever changed) —
  one flow, not a parallel set of handlers for circuits that happen not to be wired up. The
  rooms-vs-sub-panel exclusivity rule is shared as `validateCircuitDraft()` so an unassigned
  circuit can't sidestep it.
- **Move Circuit** (`openMoveCircuit`/`submitMoveCircuit`) reassigns a circuit to a different
  breaker **or to/from the unassigned list** — all three directions go through the one modal,
  with "Unassigned" offered as just another destination (`UNASSIGNED_TARGET`, a sentinel because
  `""` is already the picker's nothing-selected placeholder). Still **same panel only**; moving
  to a different Panel asset would mean mutating two assets atomically and is deferred as a
  follow-up. `circuit_reassigned` audit entries read "Slot 13a → Unassigned" rather than a raw
  id; `circuit_added`/`circuit_removed` gained the same location in their `from`, with a
  fallback in `describeAudit()` for the older entries that don't have one.
- **The panel detail tab is labelled "Layout", but its key is still `"breakers"`** — the label
  changed when the tab grew past breakers (diagram + unassigned circuits), the key deliberately
  did not: it's what `?asset=...&tab=breakers` deep links already in circulation carry and what
  `openDetail()` defaults a panel to, so renaming it would silently break every copied panel
  link. Its count badge is breakers + unassigned circuits, since both live on that tab.
- **The printed door card (`PanelLegendCard`) is a physical artifact, not a printout of the
  Table view.** It's what gets cut out and taped inside the panel door, so it deliberately
  ignores Table mode's room filter and sort and always emits *every* slot, breaker and
  circuit — including the panel's `unassignedCircuits`, which sit on no slot and would
  otherwise be missing from the one document meant to be the complete record. Reached from a
  Printer icon next to Copy link, offered in all three view modes since it doesn't render
  what's on screen.
  - **Sized against the panel, not the paper.** A breaker slot is 1" tall and a two-column
    panel stacks two slots per inch of panel height, so the breaker area is `slotCount / 2`
    inches; the card lists slots sequentially 1→N inside that height, which works out to
    `LEGEND_ROW_IN` = 0.5" per slot row, plus a 1" blank trim/tape band top and bottom.
    Width is one constant (`LEGEND_WIDTH_IN`, 7.5" = letter portrait minus 0.5" margins) —
    change that number if a door turns out to be narrower.
  - **Row height is a minimum, and the page height is MEASURED, not computed.** A slot with
    several circuits or a long note grows its row (including every circuit beats matching the
    panel's height exactly), and the unassigned section adds height no slot count predicts —
    BCA0082 computes 14" and measures 15.26". So `runPrint`/`measureCard` lay the card out
    off-screen via the `.measuring` class for one synchronous read before printing, and
    `@page` uses that. Sizing the page from `slotCount` alone spills onto a second sheet.
  - Two menu entries are page *geometry*, not content — both print the identical card:
    exact panel size (custom `@page`, one true-scale page, what "Save as PDF and send it to
    someone" wants) or tiled across letter pages.
  - **The card is portalled to `document.body`**, so printing is a straight `#root`-hides /
    card-shows swap. Leaving it in the tree instead means hiding the app around it, which
    needs the card absolutely positioned — and that silently breaks the day someone wraps the
    panel view in a `position: relative` container.
  - The print trigger is a `setTimeout`, deliberately **not** `requestAnimationFrame`: rAF
    doesn't fire while the page isn't compositing, so a user who clicked and immediately
    switched tabs would get no dialog at all until they came back.
  - The table rules (`border-collapse`, `table-layout`, `thead` repeat, `break-inside`) live
    *outside* `@media print` on purpose — the measuring pass lays the card out on screen and
    must produce the identical layout, or the height it reports isn't the height that prints.
- Deleting a breaker with circuits attached, or a circuit's roomsServed/feedsPanelLabel
  exclusivity, is validated client-side only (`canDeleteBreaker`, `addCircuit`) — consistent
  with every other guard in this app (delete/archive confirmations etc.); nothing else
  validates server-side either, so making this one check the exception wouldn't close a real
  gap. Breakers/Circuits carry no `at`/`by` of their own (unlike comments/changes/maintenance
  items), so — like Allocations — every mutation (add/edit/swap/move/remove) is audited, with
  `snake_case` action names: `breaker_added`, `breaker_edited`, `breaker_swapped`,
  `breaker_removed`, `circuit_added`, `circuit_edited`, `circuit_reassigned`, `circuit_removed`.

## Known constraints / things to watch

**Nothing here records what is deployed, or what is on a live Sheet.** Both are one
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

### What costs a backend release, and what a removal destroys

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
  used API's scope. See "Wipe and import" under Architecture for why adding the scope is not
  free either. **The rule: use an API the script already holds a scope for.**
- **`_dirty` on the read payload is load-bearing — do not remove it.** `loadData()` sends
  `_dirty: { assets:false, config:false, breakerTypes:false }` explicitly. Against a backend too
  old to recognise `op:"read"`, the read is treated as an ordinary save; a read payload carries
  no assets, and absent `_dirty` means "rewrite everything", so the first load of a new frontend
  against an old backend would blank the Assets tab and every child tab with it. With the flags
  present the old backend writes *nothing* and the load fails cleanly on "Malformed response".
  The current backend never reads them.

### Release ordering, and the deploys that went wrong

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

### Photos attach by reference, never by value

Photos live in **Cloudinary**; the Sheet stores a reference and nothing else. The full
evaluation and the three decisions behind it are in `PHOTOS_EVAL.md`.

- **The bytes could never have gone in the Sheet, for three independent reasons.** Every
  save posts the entire state, so a base64 image would be re-sent on every unrelated edit;
  a cell holds 50,000 characters, about 28KB of image against a 2-5MB phone photo; and
  `ContentService` has no image MIME type, so bytes could not be served back out even if
  they got in. That third one is the easiest to miss when sketching a Drive-based design.
- **The browser uploads directly and the backend only SIGNS, which is why this needed no
  new OAuth scope.** `Utilities.computeDigest` requires no authorization, so the manifest
  is untouched and `deploy.mjs` keeps working. Writing to Drive instead needs a scope the
  live manifest does not declare, and granting one means the owner re-authorizing while
  **every user's requests fail** — the trap v29's `DriveApp` import hit and v30 backed out
  of. **The rule that generalizes: prefer a design that needs no scope the script does not
  already hold.**
- **Credentials are per-tenant Script Properties and the deploy does not carry them**:
  `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, optionally
  `CLOUDINARY_FOLDER`. `op:"photoSign"` refuses and NAMES the missing keys, because a
  per-tenant setup step is easy to forget on a newly onboarded school and the symptom
  otherwise looks like a broken feature.
  - **Never an unsigned upload preset.** The preset name would have to ship in
    `index.html`, which is public, and anyone holding it can upload into the account.
    Server-side signing is also what keeps the `editor` check on uploads, where every other
    write rule lives.
  - **The folder and object name are chosen by the BACKEND, never taken from the request.**
    A client picking its own could overwrite an existing photo by naming it. A signature
    authorizes exactly one object, and deciding the name server-side is what makes that true.
- **`photos` is a revision domain of its own, not part of `assets`.** A photo can belong to
  a breaker or a work entry, so folding it in would make attaching one conflict with anyone
  editing any asset anywhere.
- **The write is gated on `dirty.photos`, which is what makes the backend safe to deploy
  ahead of the frontend.** A client that sends `_dirty` without that key leaves it
  `undefined`, so the Photos tab is untouched; only a client sending no `_dirty` at all gets
  the rewrite-everything fallback. Same shape as the `_dirty`-all-false guard on `op:"read"`.
- **The public `?panel=` page publishes photos, scoped to the panel, its breakers and its
  circuits** (`PHOTOS_EVAL.md` §7). The scope is a whitelist of ids assembled from what is
  already in that payload, so a photo of a laptop, a room or a person is **unreachable
  rather than filtered** — keep it that way rather than turning it into a query by owner
  type, because that bound is the entire reason publishing on an anonymous page was judged
  safe. `hiddenFromPublic` is the per-photo escape hatch and is checked BEFORE ownership, so
  a later change to the scoping cannot route around it. `PUBLIC_PHOTO_FIELDS` omits
  `storageKey` (the write handle) and `by` (a staff member's name).
- **`storageKey` is stored alongside the URL** because it is NOT recoverable from a
  transformed delivery URL, and it is what a deletion or a change of host would need. It is
  why moving off Cloudinary stays a copy plus one column rewrite.
- **A PHOTO ROW AND THE ID IT NAMES MUST BE WRITTEN IN THE SAME SAVE** (2026-09-11), and
  the bug that taught it is the sharpest example in this file of what a load-time adoption
  cannot cover. A work entry's and a schedule's id are adopted with
  `c.id || crypto.randomUUID()`, so a row written before v34 has a blank id cell and is
  handed a **fresh random id on every load**. Attaching a photo marks only the photos
  domain dirty, so the row landed in the sheet naming an id the very next load replaced.
  The photo was written, correct, and permanently unreachable — and the already-orphaned
  rows cannot be repaired, because the id they name never existed anywhere but one
  browser's memory.
  - **The asymmetry is what made it look like a photos bug rather than an id bug.** Asset
    photos survived, because an asset's id is adopted as `a.id || a.label` — deterministic,
    so a blank cell yields the SAME id every load. Only the two randomly-adopted owner types
    could orphan. Breakers and circuits mint theirs inside an asset save, so they are stored.
  - `attachPhotos` therefore passes a NEW assets array (`assets.slice()`) for a `change` or
    `maintenance` owner, which marks the assets domain dirty by reference and writes those
    ids alongside the row that points at them. It deliberately does NOT for the other owner
    types: rewriting five tabs and bumping the assets revision would conflict with anyone
    mid-edit for no gain.
  - **Generalize it:** wherever a reference is minted by a load-time adoption, the save that
    writes the reference must also carry the domain holding the target. `saveChangeEdit`'s
    "nothing changed, no write" path is the same trap from the other side — it is correct,
    and it means the id can still be memory-only when that dialog closes.
  - Covered by `test-frontend-photos.js`, which EXECUTES `attachPhotos` — the whole
    mechanism is one array identity, so it cannot be read off the source.
- **`adoptPhoto` never guesses a blank `ownerType`** (it defaulted to `"asset"` until
  2026-09-11). A blank can only come from a hand edit, and defaulting files a work entry's
  photo in its asset's gallery: the wrong photo shown confidently in the wrong place, which
  is worse than one that cannot be found. Left blank it matches no owner and stays out of
  every gallery until the cell is fixed.
- **An id exists once something points at the record, and not before** — the rule work
  entries and maintenance items arrived at twice. Photos are what made a work entry need
  one. Comments still have none, deliberately: nothing references a comment.
  - **An id also has to exist at CREATE time, not only after a load-time adoption.**
    `addMaintenanceItem` minted none at all until 2026-09-11: v34 gave schedules an id,
    moved every handler onto it and keyed the rows on it, but never wrote one where a
    schedule is born, and `adoptLegacyMaintenanceIds` filled the blank on the next load.
    That is exactly what hid it — reloading is the only cheap way to check, and after a
    reload it looks correct. Inside one session `startEditMaintenance(undefined)` matched
    the FIRST id-less item, so two new schedules meant editing the wrong one. **Where a
    load-time adoption exists, check the create path separately**; it is the one place the
    adoption cannot cover.

**Where a photo's gallery lives follows what the photo is FOR** (2026-09-11), and the two
work-item cases deliberately differ:

- **A work entry's photos are EVIDENCE of a moment** — a receipt, a before and after — so
  they live in its dialog, and the entry's id is minted when that dialog OPENS rather than
  when it saves. Otherwise a photo could only be attached by saving and reopening to edit,
  which is how the photo does not get taken. **The accepted cost is stranded bytes**:
  uploads start as soon as a file is picked, so cancelling the dialog afterwards leaves an
  orphan at the host. That is the same trade this feature takes everywhere — an invisible
  orphan over a row whose image 404s. The History row shows a READ-ONLY strip, because a
  photo only reachable through an edit form is nearly useless, and a second set of write
  controls out there would be a second thing to keep in step.
- **A schedule's photos are REFERENCE material** — where the access panel is, what the
  filter looks like when it actually needs doing — so the full gallery, add control
  included, sits on the Scheduled row where the schedule is READ. The photo that matters
  gets taken later, when someone is finally standing in front of the thing, and putting the
  control behind an edit form would be putting it where nobody is.

- **The lightbox renders from `renderWorkDialogs`, not the detail view**, and that is a
  fixed bug rather than a preference: the work dialogs render from BOTH views, so once one
  grew a gallery, opening a photo from the site-wide Maintenance tab set the state and
  painted nothing. Anything reachable from both views belongs there.
- **Captions are edited in the lightbox**, because that is the moment you are looking at
  the photo and can say what it is. The draft is held apart from the photo and reseeded
  every time the viewer opens, so an abandoned edit leaves nothing behind — the rule the
  work dialog and breaker edit mode already follow. Every gallery opens through
  `openPhotoViewer` rather than `setPhotoViewer`, or the draft carries one photo's caption
  into the next.
- **Photo rows CASCADE when an asset is permanently deleted** (Eric's call, 2026-09-11).
  `photoOwnerIdsOf` collects every id the asset carries that can own one — itself, its work
  entries, its maintenance items, its breakers and their circuits. Deliberately not a
  blocked delete: permanent delete is already a rare, twice-confirmed action on an
  already-archived asset. The images survive at the host either way, so dropping the rows
  destroys nothing. It passes `persist` the same array reference when nothing matched, so a
  delete that removed no photos does not mark the photos domain dirty.
- **Deleting a photo row does not delete the image.** Orphans are the safe failure — upload
  the bytes first, write the reference second, so a rejected save strands bytes rather than
  leaving a row whose image 404s. A sweeper is deferred and is the dangerous half:
  "the client sent no photo rows" and "delete every object" are the same request on the
  wire, the same ambiguity behind `doPost`'s mass-deletion guard.
- **Covered by `test-backend-photos.js`**, the only place it *can* be covered — Sandbox
  never contacts Apps Script and signing needs credentials that exist only in Script
  Properties. Verified by mutation that six silent-failure modes fail it: dropping either
  public filter, leaking `storageKey` or `by` into the whitelist, ceasing to write
  `storageKey`, an unmasked byte in `sha1Hex_`, and signing parameters unsorted.

### The asset key: `id`, `label` and `tag`

`ASSET_KEY_REFACTOR_PLAN.md` is the full plan. `id` is the app's identity, `label` is legacy
display text, and `tag` is the sticker on the thing.

- **Adopting each asset's LABEL as its `id` is what made the refactor need no migration.**
  Both join sites read `a.id || a.label`, so an existing asset's key IS its label, and every
  reference already stored — `parentId`, `personIds`, a child row's `assetLabel`, a breaker's
  `panelLabel`, AuditLog's `assetLabel` and `related` — was therefore *already a valid id*. No
  backfill, no script, and **AuditLog was never touched**. Same trick `typesList` uses, where a
  built-in type's id is its original name.
- **`loadData()` adopts `id = a.id || a.label` FIRST in its map chain**, before the `personIds`
  normalize and before `adoptLegacyNames` — which walks the parent chain, and so has to walk it
  by the ids everything downstream joins on. From that point `a.id` is populated on every asset
  and is the ONLY thing that should be compared for identity.
- **New assets mint `crypto.randomUUID()`** (`startAdd`, `duplicateAsset`,
  `convertUsersToAssets`).
- **Every address accepts an id OR a label, permanently** — the `?asset=` deep link,
  `panel.html?p=`, the QR sheet's `?only=`, and `?panel=` (which takes a tag as well). Links and
  stickers outlive the build that made them, and a sticker taped inside a panel door can never
  be reprinted out of existence.
- **Renaming stale parameters is what found the one real bug.** `childLabel` → `childId` exposed
  `childId={selectedAsset.label}` on the edit form: it type-checks, it renders, and it is correct
  on every legacy row, so only the rename surfaced it. **A name that no longer says what the
  value is has cost this project real time more than once; treat one as a bug, not a tidy-up.**
- **What deliberately still reads `label`**: `findLabelConflict` and `assetNumberFromLabel` (both
  genuinely about labels), the Excel export's "Asset ID" column, the detail header, and every
  "is this asset's name just its label?" display test.
- **`MOCK_SNAPSHOT` is deliberately MIXED** — three assets carry an id that is not their label (a
  Room reached by parentId/roomsServedIds/an allocation/two audit rows, a leaf device, and a
  sub-panel that is a `feedsPanelLabel` target and owns 21 breaker `panelLabel`s); every other
  row carries none. A fixture that was all one shape would exercise half the code. That is the
  `personIds` lesson, applied deliberately this time.
- **`tag` is a per-type CHOICE, not a fixed rule** (Eric's call). It ships excluded on
  Room/Building/Campus/User and can be switched on for any of them in the type editor. The
  editor already turns an unticked field into `excludedFields`; the only thing holding `label`
  out of that list was `TYPE_STRUCTURAL_FIELDS`, which contained it *because* it was the primary
  key. Once it is only a sticker it stops being structural.
  - **`label` is KEPT and written from the client's own value, not mirrored from `tag`.** The
    plan said to mirror it, which is self-defeating: clearing a Room's tag would clear its label
    with it, destroying the rollback being preserved. Nothing in the UI writes `label` any more.
  - **`adoptLegacyTag()` DECLINES rather than clears.** A type whose tag field is excluded does
    not inherit its label as a tag, so the BCR/BCB/BCC and User labels left the UI with no
    migration to run — a load-time READ that declines, not the load-time REWRITE this file warns
    about. An explicitly-empty stored tag is never re-adopted, or clearing one would undo itself
    on the next load.
  - **`nameOf()` has three rungs**: name, then tag, then `"<type> <short id>"`. The last is a
    genuine last resort, since `adoptLegacyNames` fills a blank name on everything it loads — only
    an in-session object (an add-form draft) reaches it. Its `typesList` argument is OPTIONAL and
    degrades rather than breaks.
  - **A duplicate tag is REFUSED, but for a different reason than a duplicate label was.** It used
    to be a data question (two assets sharing a primary key are one merged asset); now it is two
    stickers reading the same thing, refused because that traps whoever holds them. **Empty tags
    are skipped** — load-bearing, since an unconditional check would make every untagged asset
    collide with every other one and nothing could save. The EDIT form runs the same check with
    the asset excluded, which the add-only label never needed.
    - **Consequence:** swapping two assets' tags is a three-step edit (clear one, set the other,
      set the first), because the intermediate state is a duplicate. Accepted.
  - **`peekAssetNumber()`'s `Math.max(counter, derived)` guard is DELETED.** It existed because a
    reused label was a reused primary key, so a new asset inherited a dead one's audit history. A
    real `id` makes that impossible, and deriving from the assets stopped meaning anything once
    most rows carry no tag at all.
  - Covered by `test-frontend-tag.js`, which runs the real registry, the real
    `recomputeDerivedTypeSets` and the real `nameOf`. Verified by mutation that all three
    silent-failure modes fail it: a Room that stops excluding the tag, a `nameOf` that loses its
    last rung, and a conflict check that stops skipping empties.
- **`backfillAuditIds_` writes keys, not labels**, since what it fills is `related`. Run it ONCE
  by hand from the Apps Script editor, after a save has created the `related` column — it is
  deliberately unreachable from `doGet`/`doPost` and never on a trigger, since it rewrites
  history.
- The admin import refuses duplicate **ids** as well as tags — the merge hazard once the id is
  what child rows are keyed by. A file with no id column skips the check entirely.

### The one-time id migration, meant to be DELETED after use

`migrate-asset-ids.mjs` + `migrate-asset-ids-lib.mjs` + `test-migrate-asset-ids.mjs` (Eric's
call, 2026-09-09 — explicitly NOT a menu item, since it applies to exactly one situation and
would otherwise sit next to "Wipe all data" forever).

- **What it is for.** Adopting labels as ids is what made the refactor need no migration, and the
  cost is that a sheet carrying data across that change ends up with two kinds of id: legacy
  `BCA0001`-shaped ones, uuids on anything created since. Nothing breaks — an id is opaque
  everywhere — but once `label` is dropped, a legacy id is the only trace of an old label with
  nothing left to explain it.
- **It rewrites 12 key-bearing columns across 8 tabs, and `AuditLog` is the dangerous one.** Every
  other tab is rebuilt by the app's next save, so a mistake self-corrects; AuditLog is
  append-only, outlives the assets it describes, and nothing rewrites it — a wrong mapping there
  is silent, permanent, and indistinguishable from real history. Version history is the only undo.
- **Dry run is the DEFAULT**; `--apply` is required. It verifies every reference resolves BEFORE
  writing anything and refuses the whole migration if any does not.
- **A pre-existing dangling reference is carried through unchanged, not "fixed"** — one that
  pointed nowhere before still points nowhere after, which is honest — but it is reported, since
  a migration is exactly when someone would want to know.
- **An asset whose id is already a uuid is left alone.** Remapping one would churn every reference
  to it for nothing.
- **It bumps the revision counters, and that is not optional**: a browser open through the run
  holds the old ids and its next save would write them straight back. **Everyone must be OUT of
  the app while it runs**, for the same reason.
- **Ordering**: it can only run against a tenant whose backend has the `id` column AND where one
  save has written into it, and whose Sheet is shared with the service account. Which tenants
  those are is `node sheet.mjs tenants` and `node deploy.mjs --status`, not a line here.
- `sheet.mjs` gained `export` on six helpers so this reuses its auth, backup, plain-text write and
  revision bump rather than re-rolling them. The decision logic lives in the `-lib` half with no
  network in it, because rehearsing an AuditLog rewrite against a live Sheet is precisely what is
  being avoided; `test-migrate-asset-ids.mjs` drives it against fixtures. Verified by mutation
  that dropping AuditLog from the column list, losing `related`'s role suffix, treating a
  comma-joined list as one key, or remapping an existing uuid all fail the suite.

### What is actually on the live Sheets

**Read this as a shape, not as a fact** — `node sheet.mjs tabs <tenant>` is the check, and the
one time this section stated live data as fact it was wrong for ten backend versions.

- **The panel feature has no live data.** The Breakers, Circuits and BreakerTypes tabs have been
  empty and there have been no Electrical Panel assets, while a great deal of the Data model
  section is written as though four real panels are sitting there — the printed door card, the
  panel diagram, the "fed from" banner, the same-panel Move Circuit restriction. **The FEATURE is
  real and the code is all there; the DATA is not.**
  - **`MOCK_SNAPSHOT` is where panel data lives**, deliberately: it carries the full
    Panel/Breaker/Circuit structure with populated `breakers` arrays. So Sandbox is the only place
    panel work can be tried end to end, which inverts the usual relationship — for this one area
    the fixture is richer than production rather than a trimmed subset of it. Seed the dev tenant
    by hand if a real backend write path needs exercising.
- **Mini-split sample data is the live inventory's own oddity**: Mitsubishi indoor units across
  most Rooms, with seeded maintenance items (Monthly filter clean + Annual coil clean). Sandbox is
  again the richer copy — `MOCK_SNAPSHOT` still carries Condensers, which is what keeps the
  `parentTypes: ["Building"]` case in "The parent chain" exercisable against something.
- **A user-created type's id is a generated UUID** and resolves through `typesList` with no
  registry entry — the id scheme working exactly as designed. There is at least one on the live
  sheet.

- ~~No auth beyond the cosmetic name tag~~ — **fixed in v18**, see Authentication under
  Architecture. Worth recording why it mattered more than it looked: the GitHub repo is
  **public**, so `SHEET_API_URL` in `index.html` was published the whole time. The
  "private link" model was never actually private. Rotating the URL was considered and
  rejected — once the backend authenticates, the address isn't a secret and doesn't need
  to be. (The one genuine trap there: an *old deployment* left active keeps serving its
  own frozen copy of the code, unauthenticated. Updating the existing deployment in place,
  which is this project's normal ritual, avoids it. Confirmed there is only one.)
- **Data-loss incident, 2026-08-21 ~17:57 — cause never identified.** The Assets tab and
  every child tab went empty during the v18 Google Sign-In rollout. Recovered in full from
  the Sheet's own version history (File > Version history), which is the reason this was an
  inconvenience rather than a disaster — that history is the real backstop for this app.
  - What was ruled out: the read-path guard (`_dirty` all-false on `op:"read"`) was present
    in the very first pushed commit, so the frontend-newer-than-backend window did not do
    it. Reads never write on any version. The Executions log showed several `doGet`s at
    the time and `doGet` has never written anything.
  - What was never established: which request actually emptied the tabs. Only a `doPost`
    can write, and no `doPost` was tied to the moment.
  - **The response was to make the outcome impossible rather than to keep hunting** (v21):
    `doPost` refuses to write an empty asset list over a populated Assets tab unless
    `confirmEmptyAssets` is passed. In a full-overwrite design, "the client sent nothing"
    and "the user deleted everything" are the same request on the wire — that ambiguity is
    the actual defect, and it was worth closing whatever the trigger turned out to be.
  - If assets ever vanish again: restore from version history first with the app CLOSED,
    then check whether the guard fired (the app shows a "Refused:" notice) before assuming
    a new cause.
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
- `index.html` crossed 500KB with v18, so Babel Standalone now logs a "code generator has
  deoptimised the styling" note on every load. Harmless, but it means in-browser transpile
  time is no longer trivial — relevant to the long-standing "should this get a build step"
  question, and to the reason `panel.html` was kept as a separate small page.
- Apps Script free-tier quota is ~90 min of script runtime/day — comfortably enough
  for this app's usage pattern, but worth knowing if it ever gets flaky under heavy
  simultaneous use.
- Conflict detection exists as of backend v12 (see "Optimistic concurrency" under
  Architecture) but is **detect-and-reject, not merge**: the second person's save is
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
  (same-panel only today — see Move Circuit above).
- **Planned next**: Doors/Locks/Keys, reusing `ChildEntityTable`. Keying is many-to-many (one
  key opens many locks), not a tree like Panel→Breaker→Circuit — will need its own join-table
  design (`LockKeys`) and its own facility-wide view, not bolted onto the Panels tree pattern.
  See `DOORS_LOCKS_KEYS_NOTES.md` for why `LockKeys` has to be top-level shared state with its
  own sheet tab (the `breakerTypes` pattern) rather than an array nested in a Door asset.
