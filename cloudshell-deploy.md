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

## Step 3: Deploy

Name the tenant. Try `dev` first — it has its own Sheet with throwaway data, so nothing
you do there can reach a school:

```sh
git pull --ff-only && node deploy.mjs dev
```

Then, once it is good, each school:

```sh
node deploy.mjs bca
```

Or every tenant in one go, which reports each and tells you if any did not take:

```sh
node deploy.mjs --all
```

The `git pull` matters: Cloud Shell reuses the copy of the project from your last visit,
so without it you could deploy a version that has since been superseded.

This uploads the script, publishes a new version, keeps the same `/exec` URL, and then
confirms the live backend is reporting the new version.

**Look for the last line.** A green `✓ <tenant> is now vNN. Deploy confirmed.` means it
worked. Anything else means it didn't, and the message says why.

Two failures it will stop on deliberately:

* **Version mismatch** — the version numbers in `AssetTrackerSync.gs` and `index.html`
  disagree. They must be bumped together. Nothing was uploaded.
* **Backend not reporting the new version** — the upload worked but the deployment didn't
  take. This is the silent failure the check exists to catch.

## What is running where

Asks every tenant's live backend what version it is on, and compares it to this repo. No
sign-in needed, nothing is changed:

```sh
node deploy.mjs --status
```

Worth running before and after any release. A written-down "the live backend is vNN" note
goes stale the moment someone deploys; this cannot.

## Testing a branch before it's merged

Sandbox mode never contacts Apps Script, so a backend change cannot be tested any other
way — you have to deploy it. **Deploy it to `dev`**, which exists for exactly this:

```sh
git fetch origin && git checkout -B BRANCH-NAME origin/BRANCH-NAME && node deploy.mjs dev
```

Replace `BRANCH-NAME` with the branch. The deploy prints which branch and which tenant it
is shipping, and warns you whenever the target is a school rather than `dev`.

Deploying a branch to a school still works and is sometimes right, but it is that school's
live data behind it — so it says so rather than letting it pass quietly.

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

Next time, open the same link and go straight to **Step 3**.
