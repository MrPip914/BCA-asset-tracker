# Multi-client deployment

**Status: proposal, nothing implemented in the app.** This is the plan for running the app
for several schools at once, with a development instance to work against instead of testing
on a live client. Ownership and hosting are now decided (see Decisions made); the remaining
open questions are at the bottom.

The hosting half is already done and live: Brookside runs at `https://assets.stama.tech`
as of 2026-09-04. Nothing in the app changed for it — no `?client=` yet, one backend.

## The finding that makes this small

`AssetTrackerSync.gs` reads its Sheet through `SpreadsheetApp.getActiveSpreadsheet()` and
never `openById` — it is a container-bound script, so **the identical file deploys unchanged
to any number of Apps Script projects**, each bound to its own Sheet. There is no tenant id
in the backend, no cross-client query to get wrong, and no shared table to partition. Data
isolation is a property of the architecture already, not something to add.

So this is not a rewrite. It is: pull a handful of constants out of the frontend, point
`deploy.mjs` at more than one script, and write down the onboarding steps. The whole
per-client surface is below and it is short.

Not sharing one backend across clients is deliberate and not negotiable: every save
rewrites whole sheet tabs (see Persistence model in `CLAUDE.md`), so multi-tenancy inside
one Sheet would mean one client's save could blank another's rows. One Sheet per client
keeps the blast radius at one client, permanently.

## Shape

**One repo, one deployed frontend, N tenants.** A tenant is a Google Sheet + its bound Apps
Script deployment + a config file naming them.

    clients.js   — one file next to index.html, a few lines per tenant:
                   bca    → the school, production
                   dev    → fake data, deploy branches at it freely
                   <next> → each new client

The frontend picks its tenant at load and everything else follows from that. One deployed
`index.html` for everybody, so a fix lands in one file rather than N copies — which matters
because that file is 10k lines with no build step, and this repo's history is largely a
record of what happens when two copies of one constant drift apart.

**One file holding every tenant, not one file per tenant** (2026-09-04, revised from the
first draft of this doc). Per-tenant JSON would have to be *fetched* before the app knows
which backend to talk to — a network round trip and a loading state in front of every page
load, and an async step in a codebase with no build to absorb it. A `<script src>` is
already resolved when the app starts. Nothing in it is secret, so splitting the file would
hide nothing: the `/exec` URLs have been public since the repo was, and are protected by
sign-in rather than obscurity.

### What is per-client, in full

Frontend (`index.html`, `panel.html`, `panel-qr-sheet.html`):

| Thing | Today | Becomes |
|---|---|---|
| `SHEET_API_URL` | hardcoded, duplicated across 3 files | `apiUrl` in the client config |
| `ASSET_LABEL_PREFIX` | `"BCA"` | `labelPrefix` — each client wants their own initials |
| App title, sign-in card, header | "BCA Asset Tracker" / "Brookside Christian Academy" | `appName` / `orgName` |
| `localStorage` keys | one global set | **namespaced per client — see below** |
| Accent palette | one palette | optional `theme`, later |

Backend: **nothing.** Same file, different script project. Only the "BCA Admin" menu name
and the header comment are cosmetic and can read from a constant or just stay generic.

`deploy.mjs`: needs `scriptId` / `deploymentId` / the verify URL per tenant, instead of one
`~/.bca-asset-tracker-deploy.json`.

### `GOOGLE_CLIENT_ID` stays shared, deliberately

One OAuth client for every tenant. Google answers "is this really them?"; the per-Sheet
`authUsers` allowlist answers "may they in" — that split already exists (see Authentication
in `CLAUDE.md`) and it is what makes one client id safe here. Holding the client id
authorizes nothing, so a shared one leaks nothing between clients, and it keeps the
authorized-JavaScript-origins list to the one Pages origin instead of one per client.

`OAUTH_CLIENT_ID` in the .gs stays a constant to match. One less thing to get wrong per
deploy, and getting it wrong is the failure that rejects every token for that client.

### Namespacing `localStorage` is a real bug fix, not tidiness

Every tenant would be served from the same origin, so today's keys (`asset-tracker-session`,
`asset-tracker-sandbox-data`, `asset-tracker-column-visibility`, `asset-tracker-user`,
`asset-tracker-sandbox-mode`) collide across tenants in one browser. Concretely: open client
B after client A and the browser presents A's session id to B's backend. B rejects it
correctly, so this is not a security hole — it reads as a mysteriously broken sign-in, which
is worse to diagnose than it is to prevent. Suffix every key with the client id as part of
the extraction, in the same commit. Column visibility genuinely is per-client anyway, since
custom columns differ.

### How the tenant gets chosen

`?client=<id>`, defaulting to `bca` when absent.

So a bare `https://assets.stama.tech` stays Brookside, and no existing link or bookmark has
to change when the first second client arrives.

**An earlier draft of this doc justified the default by saying it protected QR stickers
already taped inside panel doors. That was wrong — no stickers were ever printed; the
panels in the sheet were test data** (confirmed 2026-09-04). The default is worth keeping
anyway, for the bookmark reason above, but it is a convenience now and not a constraint.

That does change one thing for the better: `panel-qr-sheet.html` encodes
`<base>/panel.html?p=<label>` into every sticker, so had any been printed they would carry
the old repo-subpath address AND no `client=`. Nothing is out there, so both the domain move
and the tenant suffix are free. **Print no stickers until `?client=` ships**, or that window
closes again — a sticker is the one artifact in this app that cannot be re-deployed.

Hostname would be cleaner than a query param, but GitHub Pages allows one custom domain per
repo, so it is not available without splitting repos. See the hosting note at the end.

## The development instance

**The dev environment is just another tenant** — its own Sheet, its own deployment, fake
data. That is the whole answer, and it is worth being precise about what it buys, because
the app already has Sandbox mode and this is not a duplicate of it.

Sandbox never contacts Apps Script at all. That is its point and also its ceiling: it
**structurally cannot exercise a backend write path**, which is why every backend change so
far has been tested by deploying a branch to the school's production `/exec`. `CLAUDE.md`
is explicit that this is testing in production and supported on purpose. With paying clients
that stops being an acceptable trade — and a dev tenant retires the problem entirely rather
than managing it.

Three tiers, each with a job the others cannot do:

1. **Sandbox** — no network, instant, no deploy. UI iteration. Unchanged.
2. **Dev tenant** — real Apps Script, real Sheet, fake data. Exercise write paths, schema
   changes, the admin import, conflict handling. Deploy any branch at it, any time.
3. **Client tenants** — production. Only ever gets `main`, only after the dev tenant has run it.

Seed the dev Sheet from `MOCK_SNAPSHOT` via the existing **BCA Admin > Import inventory**
menu, so it starts with data already in the current schema and no real names in it.

For frontend work, serve the repo locally (`python -m http.server 8000`) and open
`?client=dev` — `http://localhost:8000` is already registered as an authorized origin on the
OAuth client. Nothing new to host.

## Releasing to clients

One shared frontend means merging to `main` updates every client at once, while backends
deploy one at a time. That mismatch is the only genuinely new operational hazard here, and
it has one rule:

> **Backend to every client first. Frontend second.**

Backend changes in this app are additive — a new column that an older frontend ignores. So
an old frontend against a new backend is harmless. The reverse is the "Backend outdated"
state, where a field the frontend sends is silently dropped on write. Today that window is
one deploy long; with N clients it lasts until the slowest client is done, so the order is
what keeps it from mattering.

The full sequence:

1. Build and verify against the **dev tenant**, branch deployed there.
2. Merge to `main`.
3. `node deploy.mjs --all` — backend to every client, each verified against its own `/exec`.
4. `node deploy.mjs --status` — confirm every tenant reports the new version.
5. Frontend is already live from `main`; a hard refresh picks it up.

Step 4 earns its place. `CLAUDE.md`'s most-repeated warning is that a written-down "the live
backend is vN" line goes stale the moment someone deploys, and that has cost real sessions
twice — **check, don't read**. With N clients that failure multiplies by N. `--status` should
fetch every tenant's `/exec` and print a table of tenant / live version / expected version,
so the answer is one command and never a memory.

Staged rollout (client A on the new frontend, client B held back) is deliberately **not** in
this plan. It needs pinned per-client frontend releases — `/releases/<version>/` directories
and a `frontendRelease` in each config — which reintroduces the multiple-copies problem this
design exists to avoid. The escape hatch if a client ever needs to be held back: pin that one
client, not all of them.

## Onboarding a new client

Roughly 30 minutes, most of it Google's UI:

1. Copy the Sheet template (empty tabs; the script creates what it needs).
2. Extensions > Apps Script on the new Sheet — this creates the bound project.
3. Deploy as Web App: execute as **me**, access **anyone**. Record the `/exec` URL,
   the Script ID and the deployment id.
4. Add the tenant to `clients.js` — URL, name, org, label prefix.
5. `node deploy.mjs --client <id>` — first real deploy, verified.
6. Sign in once as owner; add the client's staff to the allowlist via Access.
7. Load their inventory: paste their CSV into an **Import** tab, then BCA Admin >
   Import inventory. The data never leaves the document, which is why it reads a tab
   rather than a URL — the repo is public.
8. Print panel QR stickers from `panel-qr-sheet.html` with their `c=` in the base URL.

Worth turning into `ONBOARDING.md` with the exact clicks once the first one is done for
real, rather than writing it from imagination now.

## Decisions made

**Ownership: Eric owns every client's Sheet and Script** (2026-09-04). One `clasp login`
deploys all of them, `OWNER_EMAIL` stays a constant giving standing admin access to every
client, and the one-tap phone deploy survives. The cost is accepted: each client's staff
names, rooms and serials live in Eric's Drive, and a departing client is a Drive transfer.
**To do: say so in writing to each client** rather than leaving it implicit.

**Hosting: `assets.stama.tech`, live on GitHub Pages** (2026-09-04). A neutral product
domain rather than any one client's, so a second client is not signing in at a first
client's address. One `CNAME` to `mrpip914.github.io`, HTTPS enforced, and the old
`mrpip914.github.io/BCA-asset-tracker/` address 301s to it, so existing bookmarks carry
over. `https://assets.stama.tech` was added to the OAuth client's authorized origins
alongside the github.io one, which stays registered as a fallback.

Client URLs are therefore `https://assets.stama.tech/?client=<id>`, with `bca` as the
default so a bare `assets.stama.tech` stays Brookside.

One consequence worth remembering: because the site moved from a repo subpath to the root
of the domain, any absolute path baked into a link or a printed QR sticker changes shape.
Nothing was printed yet, so nothing had to be reissued — that window is now closed and a
future host move would not be as free.

## Open questions — Eric's calls

**1. ~~Who owns each client's Sheet and Script?~~ Decided above — Eric owns them.** Kept
for the reasoning, since it is what the deploy model rests on.

Apps Script web apps execute as their owner. If **you** own every client's Sheet and script,
one `clasp login` deploys all of them from your phone — the entire operational model here
survives, and `OWNER_EMAIL` stays a constant giving you permanent break-glass access to every
client. The cost is that each client's inventory lives in your Drive: staff names, rooms,
serials. If a client leaves, handing it over is a Drive transfer, and their data was in your
account the whole time. That is a contract question, not a technical one, and it should be
written down for them rather than left implicit.

If instead **the client** owns it, every deploy needs their Google account — which means
either they run Cloud Shell themselves or you hold their credentials. The one-tap deploy
model does not survive that. I would not recommend it.

Recommendation: you own them, disclosed in writing.

**2. Apps Script quota is per account, not per script.** ~90 min of runtime a day across
everything you own. Fine for several small schools on this usage pattern, worth watching if
it grows, and another consequence of question 1.

**3. The repo is public, so `clients.js` publishes your client list.** The `/exec` URLs
themselves are not secrets — that has been true since v18 put auth in front of them — but
which schools are customers is business information. Options: accept it, keep the config out
of the repo and inject it at deploy, or go private (GitHub Pages on a private repo needs a
paid plan). Lowest-friction is to accept it and revisit if a client objects.

**4. ~~Hosting, eventually.~~ Partly settled: `assets.stama.tech` is live on GitHub Pages.**
What remains open is the *per-client* domain case. Pages allows one custom domain per repo,
so every client shares `assets.stama.tech` with their own `?client=` suffix. If a client
ever wants `assets.theirschool.org`, **Cloudflare Pages** serves the same static files,
allows many custom domains on one project, and gives every branch an automatic preview URL
— which would also solve staging without the `/releases/` machinery above. Free. Still not
worth moving until someone actually asks for it.

## Suggested phasing

| Phase | Work | Result |
|---|---|---|
| 0 | Extract config to `clients.js` + `resolveClient()`; namespace `localStorage`; thread the config through the 3 HTML files | No behaviour change. BCA byte-identical in use. Verifiable before anything else moves. |
| 1 | Dev tenant: Sheet, script, a `dev` entry in `clients.js`, seed from `MOCK_SNAPSHOT` | Stop testing backend changes on the school. |
| 2 | `deploy.mjs --client/--all/--status`; config moves to a per-tenant home file | One command to deploy or audit every backend. |
| 3 | First real client onboarded; write `ONBOARDING.md` from what actually happened | Two live clients. |
| 4 | Optional, only if wanted: per-client theming, pinned frontend releases, Cloudflare Pages | Staged rollout, custom domains. |

Phase 0 is the only one with any risk of regressing the school's app, and it is entirely
mechanical — worth doing on its own branch, verified against BCA in Sandbox and then live,
before phase 1 gives it somewhere safer to be tested.
