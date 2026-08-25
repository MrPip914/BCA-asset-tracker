# Deploying the backend

`AssetTrackerSync.gs` lives inside Google's infrastructure, not in the static site deploy.
It used to be updated by hand: paste the file into the Apps Script editor, then
Deploy > Manage deployments > pencil > Version: New version > Deploy.

`node deploy.mjs` does all of that, and then checks it worked.

## Where to run it

**Google Cloud Shell** is the path of least setup — a browser terminal, nothing installed
locally, works on a phone. Open this link:

<https://shell.cloud.google.com/cloudshell/open?cloudshell_git_repo=https://github.com/MrPip914/BCA-asset-tracker&cloudshell_tutorial=cloudshell-deploy.md>

It clones the repo and opens `cloudshell-deploy.md` as a guided walkthrough with tap-to-run
command buttons. Cloud Shell's `$HOME` persists between sessions, so the sign-in and the
Script ID are entered **once ever** — later visits go straight to `node deploy.mjs`.
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

3. **Record the Script ID** (Apps Script editor: Project Settings > IDs > Script ID):

       echo '{"scriptId":"YOUR_ID_HERE"}' > ~/.bca-asset-tracker-deploy.json

   `deploy.mjs` reads `./deploy.config.json` first and falls back to that home-directory
   copy. The home copy is what survives Cloud Shell re-cloning the repo each visit;
   `deploy.config.example.json` is the template if you'd rather keep it in the repo folder
   (that path is gitignored).

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
