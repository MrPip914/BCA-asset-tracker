#!/usr/bin/env node
// Copies one tenant's Google Sheet into the Postgres tables, replacing whatever
// that tenant had there. DATABASE_BACKEND_PLAN.md, Rollout step 2.
//
//   DATABASE_URL=postgres://… node db/import-from-sheet.mjs <tenant> [--dry-run] [--sql-out file]
//
// Reads the Sheet through the service account (sheet.mjs: the key at
// $BCA_SHEETS_KEY or ~/.bca-asset-tracker-sheets.json, the Sheet id from
// $BCA_SHEETS_TENANTS or ~/.bca-asset-tracker-sheets-tenants.json), builds the
// snapshot by running doGet's own code (sheet-snapshot.mjs), and loads it in
// ONE transaction (load-sql.mjs). Idempotent: run it as often as you like.
//
// READ-ONLY ON THE SHEET. Nothing is written back and no revision is bumped --
// the Sheet stays the live backend until a tenant is cut over, which is a
// separate, deliberate step (plan, Rollout 6).
//
// Never prints DATABASE_URL or the key: CI logs on this repo are public.

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sheetIdFor, sheetMeta, readGrid } from "../sheet.mjs";
import { snapshotFromGrids } from "./sheet-snapshot.mjs";
import { snapshotToRows } from "./snapshot-rows.mjs";
import { loadSql } from "./load-sql.mjs";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function die(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

// The tenant's display name, from clients.js -- read the way deploy.mjs reads it.
function orgNameFor(tenant) {
  const ctx = { window: { location: { search: "", pathname: "/" } }, URLSearchParams };
  vm.createContext(ctx);
  new vm.Script(fs.readFileSync(path.join(REPO, "clients.js"), "utf8")).runInContext(ctx);
  const entry = (ctx.window.ASSET_TRACKER_CLIENTS || {})[tenant];
  if (!entry) die(`"${tenant}" is not a tenant in clients.js.`);
  return entry.orgName || entry.appName || tenant;
}

async function main() {
  const argv = process.argv.slice(2);
  const tenant = argv.find((a) => !a.startsWith("--"));
  const dryRun = argv.includes("--dry-run");
  const sqlOutIdx = argv.indexOf("--sql-out");
  const sqlOut = sqlOutIdx >= 0 ? argv[sqlOutIdx + 1] : null;
  if (!tenant) die("Usage: node db/import-from-sheet.mjs <tenant> [--dry-run] [--sql-out file]");
  // Phase 1 runs on dev only (project instructions). A school's import is a
  // cut-over step and gets asked for by name, not reached by a typo.
  if (tenant !== "dev" && !argv.includes("--i-mean-a-client")) {
    die(`Refusing to import "${tenant}": only dev is migrated in Phase 1. A client import is a cut-over step, asked for separately.`);
  }
  if (!dryRun && !sqlOut && !process.env.DATABASE_URL) die("DATABASE_URL is not set.");

  const sheetId = sheetIdFor(tenant);
  const meta = await sheetMeta(sheetId);
  console.log(`Reading "${meta.title}" for tenant ${tenant}…`);

  // Every tab the Sheet has. A tab the backend reads but the Sheet lacks is
  // simply absent from `grids`, which doGet's getSheet_ reads as empty too.
  const grids = {};
  for (const tab of meta.tabs) {
    grids[tab.title] = await readGrid(sheetId, tab.title, "UNFORMATTED_VALUE");
  }

  const gas = fs.readFileSync(path.join(REPO, "AssetTrackerSync.gs"), "utf8");
  const snap = snapshotFromGrids(gas, grids);
  const { tables, warnings } = snapshotToRows(tenant, snap);

  console.log(`Built from backend ${snap.scriptVersion}:`);
  for (const [table, rows] of Object.entries(tables)) console.log(`  ${table.padEnd(14)} ${rows.length}`);
  if (warnings.length) {
    console.log(`\n${warnings.length} warning(s):`);
    warnings.slice(0, 50).forEach((w) => console.log("  ! " + w));
    if (warnings.length > 50) console.log(`  … and ${warnings.length - 50} more`);
  }

  const sql = loadSql(
    { id: tenant, name: orgNameFor(tenant), ownerEmail: snap.ownerEmail, cloudinaryFolder: null },
    tables,
  );
  if (sqlOut) { fs.writeFileSync(sqlOut, sql); console.log(`\nSQL written to ${sqlOut}`); }
  if (dryRun || sqlOut) { console.log("\nDry run: nothing loaded."); return; }

  const res = spawnSync("psql", [process.env.DATABASE_URL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction"], {
    input: sql,
    stdio: ["pipe", "inherit", "inherit"],
    env: { ...process.env, PGOPTIONS: "-c client_min_messages=warning" },
    maxBuffer: 1 << 30,
  });
  if (res.status !== 0) die("Load failed; the transaction was rolled back and the tenant's data is unchanged.");
  console.log(`\n✓ ${tenant} imported.`);
}

main().catch((err) => die(err && err.stack ? err.stack : String(err)));
