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

Open the Apps Script editor, go to **Project Settings → IDs**, and copy the **Script ID**.

Then run this with your ID pasted in place of `YOUR_ID_HERE`:

```sh
echo '{"scriptId":"YOUR_ID_HERE"}' > ~/.bca-asset-tracker-deploy.json
```

This is saved in your home directory, which persists — you won't need to do it again.

## Step 3: Deploy

```sh
node deploy.mjs
```

This uploads the script, publishes a new version, keeps the same `/exec` URL, and then
confirms the live backend is reporting the new version.

**Look for the last line.** A green `✓ Live backend is now vNN. Deploy confirmed.` means it
worked. Anything else means it didn't, and the message says why.

Two failures it will stop on deliberately:

* **Version mismatch** — the version numbers in `AssetTrackerSync.gs` and `index.html`
  disagree. They must be bumped together. Nothing was uploaded.
* **Backend not reporting the new version** — the upload worked but the deployment didn't
  take. This is the silent failure the check exists to catch.

## Done

The backend is live. Close this tab whenever you like — nothing is left running.

Next time, open the same link and go straight to **Step 3**.
