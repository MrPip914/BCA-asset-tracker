# Multiple clients, and where the site is published

*Read before touching `clients.js`, tenant resolution, the Pages workflow, or anything that names a school.*

*Moved out of `CLAUDE.md` on 2026-09-11, verbatim. See `CLAUDE.md` for the rules that apply to every change.*

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
