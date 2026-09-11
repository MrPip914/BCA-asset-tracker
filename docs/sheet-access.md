# Direct Sheet access (`sheet.mjs`)

*Read before using `sheet.mjs` to read or write a tenant's Google Sheet directly.*

*Moved out of `CLAUDE.md` on 2026-09-11, verbatim. See `CLAUDE.md` for the rules that apply to every change.*

## Direct Sheet access (`sheet.mjs`)

**Claude Code can read and write a tenant's Sheet directly, through the Sheets API with a
service account** (Eric's call, 2026-09-09). This is for **data cleanup** — correcting a
mis-typed parent across forty rows, seeding the dev tenant, reshaping an incoming client
inventory — work the app has no UI for and that Eric explicitly did not want to build one
for. It is not a second way to do what the app already does.

**It bypasses `doPost`, and therefore every guard this project has.** No editor/viewer
role check, no audit row describing what changed, no server-side refusal of a destructive
write. That was the accepted trade, stated when the decision was made rather than
discovered later. **File > Version history remains the only real undo**, exactly as it was
for the 2026-08-21 data-loss incident.

- **Access is per-Sheet and structural.** The service account
  (`asset-tracker-claude@bca-asset-tracker-test.iam.gserviceaccount.com`) holds **no project
  role**; it reaches a spreadsheet only because that spreadsheet was shared with it, like a
  person. So a tenant is opted in one Share dialog at a time, and the Drive API is
  deliberately NOT enabled — without it the account cannot enumerate or find files at all,
  only open the ids it is handed. As of 2026-09-09 only the **dev** Sheet is shared.
- **The credential is a downloaded key and lives in `$HOME`, never the repo**, which is
  public: `~/.bca-asset-tracker-sheets.json` (the key, as Google emitted it) and
  `~/.bca-asset-tracker-sheets-tenants.json` (`{ "dev": "<sheetId>" }`). Same convention and
  same reasoning as `~/.bca-asset-tracker-deploy.json`. **A cloud Claude Code session cannot
  use any of this** — its container is re-cloned per session and holds no `$HOME` state — so
  this is a LOCAL-only capability, unlike everything else in the repo.
  - **Two `$HOME` files now key off the same tenant ids, and they are deliberately separate.**
    `set-tenant.mjs` writes `~/.bca-asset-tracker-deploy.json` (`tenants.<id>.scriptId`), and
    `sheet.mjs` writes `~/.bca-asset-tracker-sheets-tenants.json` (`<id>: sheetId`). Folding the
    sheet id into the deploy config would look tidier and be wrong: they live on **different
    machines**. The deploy config's home is Cloud Shell's persistent `$HOME`, which is what makes
    a redeploy one tap from Eric's phone; the sheets config is on his Windows machine, next to a
    service-account key that must never reach Cloud Shell. Merging them would either drag the key
    somewhere it does not belong or leave half the file meaningless wherever it sat.
- **Zero dependencies, deliberately.** The service-account JWT is signed with `node:crypto`
  and exchanged for an access token by hand, ~20 lines. This repo has no build step and no
  `node_modules`, and a cleanup tool that needs an `npm install` first is one that doesn't
  get run when it's needed.

**Four rules it replicates from `AssetTrackerSync.gs`, because their failure is silent and
each has already cost this project something:**

- **Plain text before values.** A `repeatCell` setting `numberFormat: TEXT` runs BEFORE the
  write, and `valueInputOption` is `RAW`. This is `writeTable_`'s `setNumberFormat("@")` met
  from the REST side — without it Sheets converts a `yyyy-MM-dd` string into a real Date that
  reads back as a full ISO timestamp. Ordering is load-bearing: formatting afterwards is too
  late, the cell is already a Date.
- **The sheet's own header row is authoritative.** `readTable_` keys every row off whatever
  the sheet says, so a write that reorders or drops headers silently re-labels every value
  under them. `sheet.mjs` fills the EXISTING header order and never rewrites the header row.
- **An unknown key is refused, not dropped.** A typo (`lable`) would otherwise be ignored and
  the write would report success while the value never landed. Adding a real column is a
  schema change and belongs in `ASSET_FIELDS`, not here.
- **Writing zero rows over a populated tab needs `--allow-empty`.** The same shape as
  `doPost`'s mass-deletion guard, for the same reason: in a full-overwrite model "I sent
  nothing" and "delete everything" are the same request on the wire.

**And one thing it does that the app cannot do for itself: it bumps the revision counters.**
A browser left open holds a pre-cleanup snapshot, and its next save would overwrite the whole
edit. Bumping `rev_assets`/`rev_config`/`rev_breakerTypes` makes that save fail `doPost`'s
optimistic-concurrency check, so the app reloads instead of clobbering. `write` does it
automatically for the domain of the tab it touched (`TAB_DOMAIN`), and it is **not optional** —
it is the single cheapest thing that stops direct editing from fighting the app. Note
`AuditLog` has no counter and is deliberately absent from that map: it is append-only.

Every `write` also dumps the whole Sheet to `~/.bca-asset-tracker-backups/<tenant>-<stamp>/`
first. Not a substitute for version history — it is local and unversioned — but it is
immediate and diffable, which version history is not.

**`test-sheet-tool.mjs` covers the pure logic** (header authority, unknown keys, missing keys
padding rather than shifting, `colLetter` past Z). It is the only place that logic *can* be
covered: Sandbox never contacts anything, and rehearsing a destructive write against a live
Sheet is the thing being avoided.
