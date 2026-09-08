#!/usr/bin/env node
//
// Records one tenant's Apps Script ids in the deploy config.
//
//   node set-tenant.mjs <tenant> <scriptId> [deploymentId]
//   node set-tenant.mjs --list
//
// Exists because that config lives in Cloud Shell's $HOME — which is where deploys are
// run from, on a phone. Editing JSON by hand there is the kind of thing that produces a
// broken file at the moment you most need a working deploy, so this writes it for you and
// leaves every other tenant untouched.
//
// The file is NOT in the repo (it is gitignored, and the repo is public). See DEPLOY.md.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const REPO = path.dirname(fileURLToPath(import.meta.url));
const HOME_CONFIG = path.join(os.homedir(), ".bca-asset-tracker-deploy.json");
const REPO_CONFIG = path.join(REPO, "deploy.config.json");

const die = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1); };

// Written wherever a config already lives, so this never creates a second one that
// silently shadows the first — deploy.mjs reads the repo copy before the home copy.
const target = fs.existsSync(REPO_CONFIG) ? REPO_CONFIG : HOME_CONFIG;

function read() {
  if (!fs.existsSync(target)) return {};
  try {
    return JSON.parse(fs.readFileSync(target, "utf8"));
  } catch {
    die(`${target} is not valid JSON. Fix or delete it first.`);
  }
}

const cfg = read();

// Which tenant the pre-multi-tenant config belonged to. Read from clients.js rather than
// assumed, because guessing wrong here DELETES a working tenant's ids — the first version
// of this file folded the flat entry under whichever tenant was being written, so
// recording "dev" silently discarded Brookside's script id. Same tiny loader deploy.mjs
// uses; the constant still has exactly one home, in clients.js.
function defaultClientId() {
  try {
    const src = fs.readFileSync(path.join(REPO, "clients.js"), "utf8");
    const ctx = { window: { location: { search: "", pathname: "/" } }, URLSearchParams };
    vm.createContext(ctx);
    new vm.Script(src, { filename: "clients.js" }).runInContext(ctx);
    return ctx.window.ASSET_TRACKER_DEFAULT_CLIENT_ID || null;
  } catch {
    return null;
  }
}

// The pre-multi-tenant shape put one scriptId at the top level. Fold it into the tenants
// map under the DEFAULT tenant, so the old Cloud Shell config keeps working and stops
// being a second place tenant ids can hide.
//
// If the default cannot be determined, the flat keys are LEFT ALONE rather than dropped.
// A stale duplicate is recoverable; a deleted 57-character script id means finding it
// again in the Apps Script console, on a phone.
function normalize(c) {
  const out = { ...c, tenants: { ...(c.tenants || {}) } };
  if (!out.scriptId) return out;
  const defaultId = defaultClientId();
  if (!defaultId) {
    console.error(`  ! Could not read the default tenant from clients.js, so the existing`);
    console.error(`    top-level scriptId was left in place rather than moved or deleted.`);
    return out;
  }
  if (!out.tenants[defaultId]) {
    out.tenants[defaultId] = { scriptId: out.scriptId, ...(out.deploymentId ? { deploymentId: out.deploymentId } : {}) };
    console.log(`  (moved the existing top-level scriptId under tenant "${defaultId}")`);
  }
  delete out.scriptId;
  delete out.deploymentId;
  return out;
}

const argv = process.argv.slice(2);

if (argv.includes("--list") || argv.length === 0) {
  const tenants = normalize(cfg).tenants;
  const ids = Object.keys(tenants);
  console.log(`\nConfig: ${target}${fs.existsSync(target) ? "" : "  (does not exist yet)"}\n`);
  if (!ids.length) {
    console.log("  No tenants recorded.\n\n  node set-tenant.mjs <tenant> <scriptId> [deploymentId]\n");
  } else {
    for (const id of ids) {
      const t = tenants[id];
      console.log(`  ${id}`);
      console.log(`      scriptId     ${t.scriptId}`);
      console.log(`      deploymentId ${t.deploymentId || "(auto-detected at deploy time)"}`);
    }
    console.log("");
  }
  process.exit(0);
}

const [id, scriptId, deploymentId] = argv.filter((a) => !a.startsWith("-"));
if (!id || !scriptId) die("Usage: node set-tenant.mjs <tenant> <scriptId> [deploymentId]");

// Not validated against clients.js on purpose: a tenant's ids usually get recorded BEFORE
// its entry is committed, which is exactly the order new-tenant.mjs works in.
const next = normalize(cfg);
next.tenants[id] = { scriptId, ...(deploymentId ? { deploymentId } : {}) };

fs.writeFileSync(target, JSON.stringify(next, null, 2) + "\n");
console.log(`\n✓ Recorded "${id}" in ${target}`);
console.log(`    scriptId     ${scriptId}`);
console.log(`    deploymentId ${deploymentId || "(will be auto-detected at deploy time)"}\n`);
