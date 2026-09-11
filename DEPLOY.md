# Deploying the backend

`AssetTrackerSync.gs` lives inside Google's infrastructure, not in the static site deploy.
It used to be updated by hand: paste the file into the Apps Script editor, then
Deploy > Manage deployments > pencil > Version: New version > Deploy.

`node deploy.mjs <tenant>` does all of that, and then checks it worked.

## The procedure lives in `cloudshell-deploy.md`

**That walkthrough is the single source for how to run a deploy** — it is what opens in the
Cloud Shell tutorial pane, and its Step 3 is the main-or-branch choice that decides
everything else. This file is the reference behind it: what the tool does, why it refuses
what it refuses, and how the one-time setup works. When the two disagree, the walkthrough
wins and this file is the one to fix.

Nothing here restates what the tool prints. `deploy.mjs`'s own output is the authority on
whether a deploy worked; a doc quoting a success line is a copy that can go stale, and has.

## Where to run it

**Google Cloud Shell** is the path of least setup — a browser terminal, nothing installed
locally, works on a phone. Open this link:

<https://shell.cloud.google.com/cloudshell/open?cloudshell_git_repo=https://github.com/MrPip914/BCA-asset-tracker&cloudshell_tutorial=cloudshell-deploy.md>

It clones the repo and opens `cloudshell-deploy.md` as a guided walkthrough with tap-to-run
command buttons. Cloud Shell's `$HOME` persists between sessions, so the sign-in and the
Script ID are entered **once ever** — later visits go straight to Step 3.
($HOME is deleted after 120 days with no Cloud Shell use; you'd redo the two setup steps.)

It also works on your own machine. Same commands, same result — the only difference is
where the sign-in is stored.

## One-time setup

1. **Turn on the Apps Script API** for your Google account (once, ever):
   <https://script.google.com/home/usersettings> — set "Google Apps Script API" to On.

2. **Sign in:**

       npx -y @google/clasp@3.4.0 login          # on your own machine
       npx -y @google/clasp@3.4.0 login --no-localhost   # in Cloud Shell

   Approve in the browser. `--no-localhost` prints a link and asks you to paste back the
   address you land on, which is what works where no browser can reach the terminal.
   The credential is written to `~/.clasprc.json` — never into this repo, which is public.

3. **Record each tenant's Script ID** (its Sheet > Extensions > Apps Script > Project
   Settings > Script ID). One per tenant — every tenant is a separate Apps Script project:

       read -p "Paste the Script ID: " id && node set-tenant.mjs bca "$id"

   `node set-tenant.mjs --list` shows what is recorded. `deploy.mjs` reads
   `./deploy.config.json` first and falls back to the home-directory copy
   (`~/.bca-asset-tracker-deploy.json`). The home copy is what survives Cloud Shell
   re-cloning the repo each visit; `deploy.config.example.json` is the template if you'd
   rather keep it in the repo folder (that path is gitignored).

   A config written before there were several tenants — one `scriptId` at the top level —
   is folded under the default tenant automatically the first time `set-tenant.mjs` runs.
   Nothing needs redoing by hand.

4. **Bootstrapping a tenant that does not exist yet** is `new-tenant.mjs`, not this. It
   creates the Sheet, its bound script, pushes the backend and creates the web app
   deployment, because `deploy.mjs` can do none of those: it overwrites an existing copy
   of the backend and updates an existing deployment, neither of which an empty project
   has.

       node new-tenant.mjs --id dev --name "Asset Tracker (dev)" --org "Development sandbox" --prefix DEV

## Deploying

    node deploy.mjs <tenant>     one tenant, e.g. dev or bca
    node deploy.mjs --all        every tenant, reporting each
    node deploy.mjs --status     ask every tenant what it is running right now

**Every tenant has its own Apps Script project and its own Sheet**, so a backend change is
not shipped until it has been deployed to each of them. That is the price of the isolation
— and `--status` is there so "which tenant is on which version" is a command rather than a
memory, since every such line ever written into a doc has gone stale.

A bare `node deploy.mjs` works only while one tenant exists. With more, it refuses and
lists them rather than guessing: the wrong guess deploys to a school instead of to `dev`.

It will:

1. **Refuse to start** if `SCRIPT_VERSION` (in `AssetTrackerSync.gs`) and
   `FRONTEND_SCRIPT_VERSION` (in `index.html`) disagree — they must be bumped together.
2. Pull the live project, so the manifest it pushes back is always the one already
   deployed. Web app access settings can't be changed by accident.
3. Upload `AssetTrackerSync.gs` over the live code file, whatever the editor calls it.
4. Create a new version and point the **existing** deployment at it — so the `/exec` URL
   in `SHEET_API_URL` is unchanged.
5. **Fetch the live `/exec` and confirm the backend now reports the new version**,
   retrying for ~30s while the deploy propagates.

Step 5 is the reason this exists. Saving the script without creating a new version looks
identical to a successful deploy, and has silently cost several redeploy cycles on this
project before. Now it fails immediately, and says so.

## It refuses to go backwards

If the version in this branch is *older* than what is already deployed, the deploy stops
before uploading anything and tells you both versions.

This is not tidiness. Every save rewrites whole sheet tabs from the backend's own field
list, so an older backend **drops columns a newer one added** — the next save after a
downgrade destroys that data, rather than merely reverting behavior. It has happened once:
v24 was live and v22 was pushed over it from a branch that was simply behind.

If a rollback is genuinely what you want: `ALLOW_DOWNGRADE=1 node deploy.mjs <tenant>`.

## Deploying a branch

Sandbox mode never contacts Apps Script, so a backend change cannot be exercised without
deploying it. Deploying an unmerged branch is therefore supported and expected — and it
goes to **`dev`**, which exists so an unmerged branch has a harmless home:

    git fetch origin && git checkout -B <branch> origin/<branch> && node deploy.mjs dev

Step 3b of the walkthrough is this procedure with the traps called out; follow it there
rather than from here.

**Each tenant has its own deployment**, so a branch on `dev` is invisible to every school —
that is the whole point of the tenant. The warning the tool prints is keyed on the TENANT,
not on the branch: it fires when you are deploying to a production backend, whatever branch
you are on, and stays quiet on `dev`. Sending a branch to a school's tenant is still
testing in production, and is only correct as step 2 of the release order below.

To put `dev` back on `main`:

    git checkout -B main origin/main && ALLOW_DOWNGRADE=1 node deploy.mjs dev

The override is needed because `main` is older than what you just deployed. That is safe
only while nothing has saved data using the newer version's columns — once it has, rolling
back drops them on the next save, and fixing forward with a new version is the safer move.

## Releasing to a school: backend first, merge second

The frontend ships from `main` to every tenant at once; backends deploy one at a time. So
merging first puts a new frontend, writing new columns, in front of a school whose backend
still drops them. Deploy the branch to `dev`, then to the school, then merge. The
walkthrough spells out the four steps.

## Things worth knowing

- **The editor stops being a place to edit.** Every deploy overwrites the live code with
  this repo's copy. Anything typed into the Apps Script editor and not copied back here
  will be lost on the next deploy.
- **Google requires a real person's sign-in.** The Apps Script API does not work with
  service accounts, so this can't run unattended on a server or in a cloud session — it
  runs on your machine, as you.
- **If the sign-in expires**, re-run the `clasp login` command from step 2.
- **If it can't tell which deployment to update** (more than one versioned deployment
  exists), it stops and lists them; put the right ID in `deploy.config.json` as
  `deploymentId`.
