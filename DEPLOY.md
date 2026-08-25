# Deploying the backend

`AssetTrackerSync.gs` lives inside Google's infrastructure, not in the static site deploy.
It used to be updated by hand: paste the file into the Apps Script editor, then
Deploy > Manage deployments > pencil > Version: New version > Deploy.

`node deploy.mjs` does all of that, and then checks it worked.

## One-time setup

1. **Turn on the Apps Script API** for your Google account (once, ever):
   <https://script.google.com/home/usersettings> — set "Google Apps Script API" to On.

2. **Sign in**, from the repo folder:

       npx -y @google/clasp@3.4.0 login

   A browser opens; approve it. This writes a credential to your home folder
   (`~/.clasprc.json` — *not* into this repo, which is public).

3. **Record the Script ID.** In the Apps Script editor: Project Settings > IDs > Script ID.

       cp deploy.config.example.json deploy.config.json

   Paste the ID into `scriptId`. This file is gitignored.

That's it. `deploy.config.json` and the credential both stay off GitHub.

## Deploying

    node deploy.mjs

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
