---
description: Print the backend deploy link and instructions for Eric (Google Apps Script)
---

Give Eric what he needs to deploy `AssetTrackerSync.gs`. He is usually on a phone, so hand
him a link and a tap — never Apps Script editor steps, and never a wall of text.

**This command carries no deploy text of its own, deliberately.** The blocks live in
`CLAUDE.md` ("Working here"), the procedure lives in `cloudshell-deploy.md`, and the
success and failure lines belong to `deploy.mjs`. A second copy here is what drifted last
time: this file spent a month telling him to watch for a success line the tool has never
printed, so a failed deploy and a good one read the same. Quote those three sources; do
not paraphrase them.

Do this:

1. **Work out which branch the change is on, and do not assume `main`.** If `$ARGUMENTS`
   names a branch, that is the answer. Otherwise it is the branch this session has been
   working on — check what you actually committed to, and confirm with
   `git log --oneline -1 origin/main` whether the change is in `main` yet. Getting this
   wrong is the single most expensive mistake here: it is what sent a `main` deploy for
   work that lived on a branch, and the downgrade guard stopped him with a confusing
   message. Ask him if you genuinely cannot tell.

2. **Read `SCRIPT_VERSION` from `AssetTrackerSync.gs` on that branch** — not on `main`,
   unless that is where the work is. Check `FRONTEND_SCRIPT_VERSION` in `index.html`
   matches; if they disagree, say so and stop, because `deploy.mjs` refuses to run anyway.

3. **Ask every tenant what it is running:** `node deploy.mjs --status`. This works from a
   cloud session — it is an unauthenticated fetch of each `/exec`, no sign-in and no
   `clasp`. Never state a live version from memory or from a line in a doc; every such
   line in this repo has gone stale at least once.

4. If live already matches on every tenant that needs it, tell him in one line and stop.

5. Otherwise **send exactly one block, quoted verbatim from `CLAUDE.md`'s "Working here"
   section**, with `<NN>`, `<branch>` and the tenant filled in:
   - the change is merged into `origin/main` → **block A**
   - the change is on a branch → **block B**, which targets `dev`

   They are alternatives, never a sequence. Sending both, `main` first, is the documented
   way this has already gone wrong once.

6. Add one line naming what is in this version, so he knows what he is shipping. Nothing
   else — no setup walkthrough (his sign-in persists in Cloud Shell), no editor fallback.

Only send a branch to a school's tenant if he asked for that, or as step 2 of the
backend-first release order, and then say plainly that it is their live data behind it.
Do not refuse a branch deploy: it is the only way to exercise a backend write path, since
Sandbox never contacts Apps Script.

Do not put a school command in the same response as an unverified branch deploy. Wait for
him to confirm `dev` first.
