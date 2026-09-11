# Deploy the BCA Asset Tracker backend

This publishes `AssetTrackerSync.gs` to Google Apps Script and then checks that the live
backend really is running the new version.

**Every tenant has its own Apps Script project**, so a deploy names which one it is for:
`dev` is the safe one to experiment on, and each school is its own. `node deploy.mjs
--status` answers "which one is running what" at any time.

Steps 1 and 2 are **one-time setup** — Cloud Shell remembers them, so on later visits you
skip straight to step 3.

Tap the copy button on any command box to drop it into the terminal, then press Enter.

## Step 1: Sign in to Google (first visit only)

This lets the deploy tool act on your Google account. Skip it if you've done it before —
step 3 will tell you if the sign-in has expired.

```sh
npx -y @google/clasp@3.4.0 login --no-localhost
```

It prints a link. Open it, approve access, then copy the address of the page you land on
(it will look like an error page — that's expected) and paste it back into the terminal.

Check it worked:

```sh
npx -y @google/clasp@3.4.0 show-authorized-user
```

That should print your email address.

## Step 2: Save each tenant's Script ID (first visit only)

First get the ID: open that tenant's Google Sheet, then **Extensions → Apps Script**, then
**Project Settings** (the gear icon on the left), and copy the **Script ID**.

Then record it, replacing `bca` with the tenant and pasting the ID at the prompt:

```sh
read -p "Paste the Script ID: " id && node set-tenant.mjs bca "$id"
```

Repeat once per tenant. To see what is already recorded:

```sh
node set-tenant.mjs --list
```

This lives in your home directory, which persists — you won't be asked again. An older
config from before there were several tenants is folded in automatically the first time
this runs, so nothing needs redoing by hand.

## Step 3: Pick what you are deploying

**Start here every time, and answer this before running anything.** Getting it wrong is
the single most common way this goes sideways: opening the link puts you on `main`, so
running the plain deploy while the work is on a branch ships the OLD backend and the
downgrade guard stops you with a confusing message.

| What you are deploying | Go to |
| --- | --- |
| Work that is merged into `main` | **3a** |
| Work on a branch, not merged yet | **3b** |

Not sure? `git log --oneline -1 origin/main` and see whether your change is in it.

### Step 3a: Deploy `main`

Try `dev` first — its own Sheet, throwaway data, nothing a school can see:

```sh
git checkout -B main origin/main && git pull --ff-only && node deploy.mjs dev
```

Then each school:

```sh
node deploy.mjs bca
```

Or every tenant at once, which reports each one:

```sh
node deploy.mjs --all
```

### Step 3b: Deploy a branch

Sandbox mode never contacts Apps Script, so a backend change cannot be tested any other
way — it has to be deployed. Send it to `dev`, which exists for exactly this. Replace
`BRANCH-NAME` with the branch:

```sh
git fetch origin && git checkout -B BRANCH-NAME origin/BRANCH-NAME && node deploy.mjs dev
```

Note `dev` is both a branch name and a tenant name. In that command the FIRST `dev`
would be the branch and the LAST one is always the tenant — so for the `dev` branch it
reads `git checkout -B dev origin/dev && node deploy.mjs dev`, which looks like a typo
and is not.

**Check the second line of the output before it finishes.** It names the version, the
branch and the tenant:

```
Deploying v34 from branch "dev" to "dev" (Development sandbox)
```

If the version is older than you expect, or the branch says `main` when you chose a
branch, stop — the checkout did not take.

## Did it work?

Whichever route you took, the deploy uploads the script, publishes a new version, keeps
the same `/exec` URL, and then asks the live backend what version it is running.

**Look at the last line.**

* `✓ <tenant> is now vNN. Deploy confirmed.` — done. The live backend confirmed it.
* Anything starting with `✗` — it did NOT deploy, and the message says why.

Failures it stops on deliberately, all of which upload nothing:

* **Version mismatch** — `AssetTrackerSync.gs` and `index.html` disagree about the version.
  They must be bumped together.
* **Refusing to downgrade** — the version you are deploying is OLDER than what is live.
  Usually you are on the wrong branch: re-read Step 3. An older backend drops columns a
  newer one added, which is data loss rather than a rollback, so this one is a hard stop.
* **No Apps Script ID configured** — it prints which config file it read, which tenants
  were in it, and which directory it ran from. Read those lines before theorising; the
  answer is usually in them.
* **Backend not reporting the new version** — the upload worked but the deployment did
  not take. This is the silent failure the whole check exists to catch.

## Releasing a backend change to a school

**Backend first, merge second. This order is not a preference — the other way round
loses data.**

The frontend ships from `main` to EVERY tenant at once, through GitHub Pages. Backends
deploy one tenant at a time. So merging first puts a new frontend, writing new columns,
in front of a school whose backend still drops them: written, then silently gone.

1. Deploy the branch to `dev` (3b) and check it there.
2. Deploy the same branch to the school: `node deploy.mjs bca`. Yes, from the unmerged
   branch — the backend code is identical to what merging will put on `main`, and it is
   the only ordering that is safe.
3. Merge the branch into `main` and push. That publishes the frontend.
4. `node deploy.mjs --status` — every tenant should now say the same version.

Between 2 and 3 the school sees the **"Backend outdated"** banner: their backend is new,
their frontend is not yet. That is the version check doing its job, and step 3 clears
it. Nothing breaks in that window — the old frontend simply does not use the new
columns.
## What is running where

Asks every tenant's live backend what version it is on, and compares it to this repo. No
sign-in needed, nothing is changed:

```sh
node deploy.mjs --status
```

Worth running before and after any release. A written-down "the live backend is vNN" note
goes stale the moment someone deploys; this cannot.

## Setting up a new tenant

Creates the Sheet, its bound script, pushes the backend and creates the web app, then
prints the entry to add to `clients.js`:

```sh
node new-tenant.mjs --id stmarys --name "St Mary's Asset Tracker" --org "St Mary's School" --prefix SMS
```

Add `--dry-run` to see what it would do without creating anything. Afterwards it tells you
to open the new script once and approve the permission prompt — the web app runs as you,
so until you have granted that, every request to it fails.

## Putting it back

If the branch turns out to be broken, go back to `main`:

```sh
git checkout -B main origin/main && ALLOW_DOWNGRADE=1 node deploy.mjs dev
```

Name whichever tenant you deployed the branch to. `ALLOW_DOWNGRADE=1` is needed because
`main` is *older* than the branch you just deployed,
and going backwards is blocked by default — an older backend drops columns a newer one
added. That is exactly why it asks you to be explicit. Here it is the right thing to do,
**as long as nothing has saved data using the new version's columns yet.** If it has,
going back will drop those columns on the next save. When in doubt, fix forward with a new
version rather than rolling back.

## Done

The backend is live. Close this tab whenever you like — nothing is left running.

Next time, open the same link and go straight to **Step 3** — and make that choice
again rather than repeating whatever you ran last time. `main` or a branch is the
question that decides everything else.
