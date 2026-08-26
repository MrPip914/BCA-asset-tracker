# Deploy the BCA Asset Tracker backend

This publishes `AssetTrackerSync.gs` to Google Apps Script and then checks that the live
backend really is running the new version.

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

## Step 2: Save the Script ID (first visit only)

First get the ID: open your Google Sheet, then **Extensions → Apps Script**, then
**Project Settings** (the gear icon on the left), and copy the **Script ID**.

Now run this. It will stop and ask for the ID — paste it at the prompt and press Enter.
You do not need to edit the command.

```sh
read -p "Paste your Script ID: " id && printf '{"scriptId":"%s"}\n' "$id" > ~/.bca-asset-tracker-deploy.json && echo "Saved."
```

It prints `Saved.` when done. This lives in your home directory, which persists — you
won't be asked again.

## Step 3: Deploy

```sh
git pull --ff-only && node deploy.mjs
```

The `git pull` matters: Cloud Shell reuses the copy of the project from your last visit,
so without it you could deploy a version that has since been superseded.

This uploads the script, publishes a new version, keeps the same `/exec` URL, and then
confirms the live backend is reporting the new version.

**Look for the last line.** A green `✓ Live backend is now vNN. Deploy confirmed.` means it
worked. Anything else means it didn't, and the message says why.

Two failures it will stop on deliberately:

* **Version mismatch** — the version numbers in `AssetTrackerSync.gs` and `index.html`
  disagree. They must be bumped together. Nothing was uploaded.
* **Backend not reporting the new version** — the upload worked but the deployment didn't
  take. This is the silent failure the check exists to catch.

## Testing a branch before it's merged

Sandbox mode never contacts Apps Script, so a backend change cannot be tested any other
way — you have to deploy it. That is supported. Just know this is the **same URL the
school's app uses**, so while your branch is deployed, that is what everyone is running.

Replace `BRANCH-NAME` with the branch, then run:

```sh
git fetch origin && git checkout -B BRANCH-NAME origin/BRANCH-NAME && node deploy.mjs
```

The deploy prints which branch it is shipping and warns you when it isn't `main`.

## Putting it back

If the branch turns out to be broken, go back to `main`:

```sh
git checkout -B main origin/main && ALLOW_DOWNGRADE=1 node deploy.mjs
```

`ALLOW_DOWNGRADE=1` is needed because `main` is *older* than the branch you just deployed,
and going backwards is blocked by default — an older backend drops columns a newer one
added. That is exactly why it asks you to be explicit. Here it is the right thing to do,
**as long as nothing has saved data using the new version's columns yet.** If it has,
going back will drop those columns on the next save. When in doubt, fix forward with a new
version rather than rolling back.

## Done

The backend is live. Close this tab whenever you like — nothing is left running.

Next time, open the same link and go straight to **Step 3**.
