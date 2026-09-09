// ONE-TIME migration: replace legacy asset ids with real UUIDs.
//
//   node migrate-asset-ids.mjs <tenant>            report what would change
//   node migrate-asset-ids.mjs <tenant> --apply    do it
//
// WHY THIS EXISTS AND WHY IT IS DISPOSABLE. Phase 1 of the key refactor gave
// every asset an `id` and adopted the existing LABEL as that id, which is what
// made the whole change need no migration: every reference already stored in the
// Sheet was already a valid id. The cost is that a sheet which predates v31 ends
// up with two kinds of id -- BCA0001-shaped ones on everything that existed
// then, uuids on everything created since. Nothing breaks (an id is opaque
// everywhere), but it is a permanent oddity, and once phase 4 drops the `label`
// column a legacy id is the only trace of an old label with nothing left to
// explain it.
//
// This is Eric's call (2026-09-09) and is deliberately NOT a menu item: it
// applies to exactly one situation -- a tenant that carried data across v31 --
// and once each such tenant is done it can never be useful again. A permanent
// admin entry for it would be clutter at best and a loaded gun next to "Wipe all
// data" at worst. DELETE THIS FILE once bca has been migrated.
//
// WHAT IT TOUCHES. Every column anywhere that holds an asset key:
//   Assets       id, parentId, personIds
//   Comments     assetLabel
//   Changes      assetLabel
//   Allocations  assetLabel, room
//   Maintenance  assetLabel
//   Breakers     panelLabel
//   Circuits     panelLabel, feedsPanelLabel, roomsServed
//   AuditLog     assetLabel, related
//
// AUDITLOG IS THE DANGEROUS ONE and the reason this defaults to a dry run.
// Every other tab is rebuilt from scratch by the app's next save, so a mistake
// there self-corrects. AuditLog is append-only, outlives the assets it
// describes, and nothing ever rewrites it -- so a wrong mapping there is silent,
// permanent, and indistinguishable from real history afterwards. File > Version
// history is the only undo.
//
// An asset whose id is ALREADY a uuid is left alone. Remapping one would churn
// every reference to it for no gain, and it is already exactly what we want.
import crypto from "node:crypto";
import { sheetIdFor, readGrid, gridToRows, rowsToValues, backup, writeRows, bumpRevisions } from "./sheet.mjs";
import { remapPlan, applyPlan, KEY_COLUMNS, LIST_COLUMNS } from "./migrate-asset-ids-lib.mjs";

const TABS = ["Assets", "Comments", "Changes", "Allocations", "Maintenance", "Breakers", "Circuits", "AuditLog"];

function die(msg) { console.error("✗ " + msg); process.exit(1); }

const [, , tenant, ...flags] = process.argv;
if (!tenant) die("Usage: node migrate-asset-ids.mjs <tenant> [--apply]");
const apply = flags.includes("--apply");

const sheetId = sheetIdFor(tenant);
console.log(`Tenant ${tenant}\n`);

// --- read everything first, so the plan is built against one consistent view --
const tabs = {};
for (const tab of TABS) {
  const grid = await readGrid(sheetId, tab);
  tabs[tab] = gridToRows(grid);
  console.log(`  read ${tab.padEnd(12)} ${String(tabs[tab].rows.length).padStart(5)} rows`);
}
console.log("");

const plan = remapPlan(tabs, () => crypto.randomUUID());

if (plan.errors.length) {
  console.error("Refusing to continue:\n");
  plan.errors.forEach((e) => console.error("  ✗ " + e));
  process.exit(1);
}

console.log(`${plan.remapped} asset(s) get a new uuid; ${plan.alreadyUuid} already had one.`);
if (plan.dangling.length) {
  // Carried through unchanged rather than "fixed" -- a reference that pointed
  // nowhere before still points nowhere after, which is honest. Reported because
  // a migration is exactly when someone would want to know.
  console.log(`\n${plan.dangling.length} reference(s) point at no asset and are left as they are:`);
  plan.dangling.slice(0, 15).forEach((d) => console.log("    " + d));
  if (plan.dangling.length > 15) console.log(`    ... and ${plan.dangling.length - 15} more`);
}
console.log("\nReferences to rewrite, by tab and column:");
Object.entries(plan.counts).forEach(([where, n]) => { if (n) console.log(`  ${where.padEnd(28)} ${n}`); });

if (!apply) {
  console.log("\n✓ Dry run. Nothing written. Re-run with --apply to do it.");
  console.log("  Everyone should be OUT of the app when you do: a browser holding");
  console.log("  the pre-migration snapshot would otherwise save over this. The");
  console.log("  revision bump at the end is what refuses that save.");
  process.exit(0);
}

const next = applyPlan(tabs, plan);

// --- verify BEFORE writing: every reference must resolve, or be empty ---------
const ids = new Set(next.Assets.rows.map((r) => r.id));
const broken = [];
for (const [tab, { rows }] of Object.entries(next)) {
  rows.forEach((row, i) => {
    for (const col of KEY_COLUMNS[tab] || []) {
      const raw = String(row[col] ?? "").trim();
      if (!raw) continue;
      const parts = LIST_COLUMNS.has(`${tab}.${col}`)
        ? raw.split(",").map((s) => s.trim()).filter(Boolean)
        : [raw];
      for (const p of parts) {
        const id = col === "related" ? p.slice(0, p.lastIndexOf(":")) : p;
        if (id && !ids.has(id) && !plan.danglingIds.has(id)) {
          broken.push(`${tab} row ${i + 2} ${col}: ${id}`);
        }
      }
    }
  });
}
if (broken.length) {
  die(`Post-remap verification failed — ${broken.length} reference(s) resolve to nothing.\n` +
      broken.slice(0, 10).map((b) => "    " + b).join("\n") +
      "\n\n  NOTHING WAS WRITTEN.");
}
console.log("\n✓ Verified: every reference resolves.");

const dir = await backup(sheetId, `${tenant}-pre-idmigration`);
console.log(`  backup: ${dir}`);

for (const tab of TABS) {
  await writeRows(sheetId, tab, next[tab].headers, next[tab].rows);
  console.log(`  wrote ${tab.padEnd(12)} ${next[tab].rows.length} rows`);
}

// Not optional. A browser open through this holds the old ids and its next save
// would write them straight back over the new ones; the bump makes that save
// fail doPost's optimistic-concurrency check so the app reloads instead.
const to = await bumpRevisions(sheetId, ["assets", "config", "breakerTypes"]);
console.log(`\n  revisions bumped: ${JSON.stringify(to)}`);
console.log("\n✓ Done. Everyone should hard-refresh.");
