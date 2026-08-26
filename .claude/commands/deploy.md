---
description: Print the backend deploy link and instructions for Eric (Google Apps Script)
---

Give Eric what he needs to deploy `AssetTrackerSync.gs`. He is usually on a phone, so
hand him a link and a tap — never Apps Script editor steps, and never a wall of text.

Do this:

1. Read `SCRIPT_VERSION` from `AssetTrackerSync.gs` on `main` — that is the version he
   is about to deploy. Also check `FRONTEND_SCRIPT_VERSION` in `index.html` matches it;
   if they disagree, say so and stop, because `deploy.mjs` will refuse to run anyway.
2. Ask the live backend what it is currently running, so you can tell him whether a
   deploy is even needed:

   `curl -s -L --max-time 45 "$(grep -m1 -o 'https://script.google.com/macros/s/[^"]*' index.html)"`

   The JSON comes back with `scriptVersion`. It needs no sign-in and is a documented
   diagnostic.
3. If live already matches, tell him that in one line and stop. Otherwise print exactly
   this, with the version filled in:

> **Deploy v<NN>** — open this, then tap the command in Step 3:
>
> https://shell.cloud.google.com/cloudshell/open?cloudshell_git_repo=https://github.com/MrPip914/BCA-asset-tracker&cloudshell_tutorial=cloudshell-deploy.md
>
> Look for `✓ Live backend is now v<NN>.` as the last line. Anything starting with `✗`
> means it did not deploy, and says why.

If `$ARGUMENTS` names a branch, deploy that branch instead: read its `SCRIPT_VERSION`,
and give him the link plus this command, with the branch filled in —

> `git fetch origin && git checkout -B <branch> origin/<branch> && node deploy.mjs`

— and one line saying this is the URL the school's app uses, so the branch is live for
everyone until something else is deployed. Do not refuse a branch deploy: it is the only
way to exercise a backend write path, because Sandbox mode never contacts Apps Script.

Add one line naming what is in this version, so he knows what he is shipping. Nothing
else — no setup walkthrough (his sign-in persists in Cloud Shell), no editor fallback.
