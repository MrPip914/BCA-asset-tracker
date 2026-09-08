#!/usr/bin/env node
//
// Deploys AssetTrackerSync.gs to Google Apps Script and then PROVES it landed.
//
//   node deploy.mjs <tenant>    deploy one tenant   (e.g. dev, bca)
//   node deploy.mjs --all       deploy every tenant, reporting each
//   node deploy.mjs --status    ask every tenant's live /exec what it is running
//
// Replaces the manual ritual (paste into the editor > Deploy > Manage deployments >
// pencil > New version > Deploy). Reuses each tenant's EXISTING deployment, so the
// /exec URLs in clients.js never change.
//
// EVERY TENANT HAS ITS OWN Apps Script project and its own Sheet, so a backend change
// is not shipped until it has been deployed to each of them one at a time. That is the
// price of the isolation, and `--status` exists so "which tenant is on which version"
// is a command rather than a memory.
//
// The verification step at the end is the point: it fetches that tenant's live /exec and
// checks the backend now reports the version this repo expects. A deploy that silently
// didn't take fails here, loudly, instead of days later when a feature quietly stops
// persisting.
//
// See DEPLOY.md for one-time setup, and MULTI_CLIENT_DEPLOYMENT.md for the release order.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import vm from "node:vm";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.dirname(fileURLToPath(import.meta.url));
const CLASP = "@google/clasp@3.4.0";
const VERIFY_ATTEMPTS = 6;
const VERIFY_WAIT_MS = 5000;

const die = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1); };
const step = (msg) => console.log(`\n▸ ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readMatch(file, re, what) {
  const text = fs.readFileSync(path.join(REPO, file), "utf8");
  const m = text.match(re);
  if (!m) die(`Could not find ${what} in ${file}.`);
  return m[1];
}

function clasp(args, { cwd, json = false } = {}) {
  const quoted = ["-y", CLASP, ...args].map((a) => (/[\s"]/.test(a) ? JSON.stringify(a) : a));
  const res = spawnSync("npx", quoted, {
    cwd,
    shell: true,
    encoding: "utf8",
    stdio: json ? ["inherit", "pipe", "inherit"] : "inherit",
  });
  if (res.status !== 0) die(`clasp ${args[0]} failed (exit ${res.status}).`);
  if (!json) return null;
  const out = res.stdout || "";
  const start = out.search(/[[{]/);
  if (start === -1) die(`clasp ${args[0]} returned no JSON.\n${out}`);
  try {
    return JSON.parse(out.slice(start).trim());
  } catch {
    die(`Could not parse clasp ${args[0]} output:\n${out}`);
  }
}

// ------------------------------------------------------------ the tenant registry

// The /exec URLs live in clients.js, one per tenant. clients.js is browser code (it reads
// window.location), so it is evaluated here in a stub context rather than imported — and
// read as a registry rather than regexed, so this cannot silently pick the wrong tenant's
// URL, which with one tenant would have looked like it worked.
function loadClients() {
  const src = fs.readFileSync(path.join(REPO, "clients.js"), "utf8");
  const ctx = { window: { location: { search: "", pathname: "/" } }, URLSearchParams };
  vm.createContext(ctx);
  try {
    new vm.Script(src, { filename: "clients.js" }).runInContext(ctx);
  } catch (e) {
    die(`Could not evaluate clients.js: ${e.message}`);
  }
  const registry = ctx.window.ASSET_TRACKER_CLIENTS;
  const defaultId = ctx.window.ASSET_TRACKER_DEFAULT_CLIENT_ID;
  const devId = ctx.window.ASSET_TRACKER_DEV_CLIENT_ID;
  if (!registry || !defaultId || !registry[defaultId]) die("clients.js did not define a usable tenant registry.");
  return { registry, defaultId, devId };
}

const { registry: CLIENTS, defaultId: DEFAULT_ID, devId: DEV_ID } = loadClients();
const TENANT_IDS = Object.keys(CLIENTS);

// ---------------------------------------------------------------- config

// Config is looked for in the repo first, then in the home directory. The home copy is
// what makes Cloud Shell work: the repo is re-cloned fresh every visit (and the repo copy
// is gitignored, so it is never in the clone), while $HOME persists between sessions.
const HOME_CONFIG = path.join(os.homedir(), ".bca-asset-tracker-deploy.json");
const REPO_CONFIG = path.join(REPO, "deploy.config.json");

function loadConfig() {
  for (const p of [REPO_CONFIG, HOME_CONFIG]) {
    if (fs.existsSync(p)) {
      try {
        return { ...JSON.parse(fs.readFileSync(p, "utf8")), _path: p };
      } catch {
        die(`${p} is not valid JSON.`);
      }
    }
  }
  return { _path: HOME_CONFIG };
}

const cfg = loadConfig();

// Two shapes are accepted. The nested one is current:
//
//     { "tenants": { "bca": { "scriptId": "...", "deploymentId": "..." } } }
//
// The flat one is what existed before there was more than one tenant, and is read as the
// DEFAULT tenant's ids so an existing Cloud Shell $HOME keeps working untouched:
//
//     { "scriptId": "...", "deploymentId": "..." }
//
// Reading the old shape rather than demanding a rewrite matters more than it looks: that
// file lives only in Cloud Shell's $HOME, so "just update it" means retyping a Script ID
// on a phone.
function tenantConfig(id) {
  const nested = (cfg.tenants || {})[id];
  if (nested) return nested;
  if (id === DEFAULT_ID && cfg.scriptId) return { scriptId: cfg.scriptId, deploymentId: cfg.deploymentId };
  return null;
}

function requireTenantConfig(id) {
  const t = tenantConfig(id) || {};
  // Env overrides stay, but only for a single named tenant — with --all they would point
  // every tenant at one script, which is the exact accident this file now exists to stop.
  const scriptId = (singleTarget ? process.env.GAS_SCRIPT_ID : null) || t.scriptId;
  const deploymentId = (singleTarget ? process.env.GAS_DEPLOYMENT_ID : null) || t.deploymentId;
  if (!scriptId || String(scriptId).startsWith("PASTE_")) {
    die(
      `No Apps Script ID configured for tenant "${id}".\n\n` +
        `Find it in that tenant's Apps Script editor under Project Settings > IDs > Script ID,\n` +
        `then save it once (it persists, so this is a one-time step per tenant):\n\n` +
        `    node set-tenant.mjs ${id} <SCRIPT_ID> [DEPLOYMENT_ID]\n\n` +
        `or edit ${cfg._path} by hand. See DEPLOY.md.`
    );
  }
  return { scriptId, deploymentId };
}

// ------------------------------------------------------------------- arguments

const argv = process.argv.slice(2);
const wantStatus = argv.includes("--status");
const wantAll = argv.includes("--all");
const named = argv.filter((a) => !a.startsWith("-"));

if (named.length > 1) die(`Give at most one tenant id. Got: ${named.join(", ")}`);
for (const id of named) {
  if (!CLIENTS[id]) {
    die(`"${id}" is not a tenant in clients.js.\n\nKnown tenants: ${TENANT_IDS.join(", ")}`);
  }
}
if (wantAll && named.length) die("Use either --all or a single tenant id, not both.");

// Which tenants this run will deploy to. A bare `node deploy.mjs` is only unambiguous
// while there is one tenant; with several it REFUSES rather than guessing, because the
// wrong guess deploys to a school instead of to dev.
const targets = wantStatus
  ? []
  : wantAll
    ? TENANT_IDS
    : named.length
      ? named
      : TENANT_IDS.length === 1
        ? TENANT_IDS
        : die(
            `Which tenant? clients.js defines ${TENANT_IDS.length}: ${TENANT_IDS.join(", ")}\n\n` +
              `    node deploy.mjs ${DEV_ID && CLIENTS[DEV_ID] ? DEV_ID : TENANT_IDS[0]}      one tenant\n` +
              `    node deploy.mjs --all    every tenant\n` +
              `    node deploy.mjs --status what each one is running right now`
          );

const singleTarget = targets.length === 1;

// ---------------------------------------------------- preflight: versions agree

const backendVersion = readMatch("AssetTrackerSync.gs", /const SCRIPT_VERSION = "([^"]+)"/, "SCRIPT_VERSION");
const frontendVersion = readMatch("index.html", /const FRONTEND_SCRIPT_VERSION = "([^"]+)"/, "FRONTEND_SCRIPT_VERSION");

if (!wantStatus && backendVersion !== frontendVersion) {
  die(
    `Version mismatch before deploying:\n` +
      `    AssetTrackerSync.gs SCRIPT_VERSION      = ${backendVersion}\n` +
      `    index.html FRONTEND_SCRIPT_VERSION      = ${frontendVersion}\n\n` +
      `Both must be bumped in the same commit, or the app will show a permanent\n` +
      `"Backend outdated" warning. Fix them and re-run.`
  );
}

// ------------------------------------------------------------------- --status

// The answer to "which tenant is on which version", asked rather than remembered. Every
// deploy-state line ever written into CLAUDE.md went stale; this cannot, and it needs no
// sign-in because /exec reports scriptVersion even on its authFailed response.
async function liveVersionOf(id) {
  try {
    const res = await fetch(CLIENTS[id].apiUrl, { redirect: "follow" });
    const body = await res.text();
    return (JSON.parse(body) || {}).scriptVersion ?? null;
  } catch {
    return null;
  }
}

if (wantStatus) {
  console.log(`This repo expects ${backendVersion} (index.html expects ${frontendVersion})\n`);
  const width = Math.max(...TENANT_IDS.map((i) => i.length), 6);
  const rows = await Promise.all(TENANT_IDS.map(async (id) => [id, await liveVersionOf(id)]));
  let anyStale = false;
  for (const [id, live] of rows) {
    const ok = live === backendVersion;
    if (!ok) anyStale = true;
    console.log(
      `  ${ok ? "✓" : "✗"} ${id.padEnd(width)}  ${(live || "no answer").padEnd(12)}  ${CLIENTS[id].orgName}`
    );
  }
  console.log(
    anyStale
      ? `\nSomething is not on ${backendVersion}. Deploy it: node deploy.mjs <tenant>\n`
      : `\nEvery tenant is on ${backendVersion}.\n`
  );
  process.exit(anyStale ? 1 : 0);
}

// ----------------------------------------------------------------- the deploy

// Which branch this is, so the output never leaves it ambiguous what is being shipped
// where. Deploying a branch is the normal way to exercise a backend write path, since
// Sandbox never contacts Apps Script — the question is only WHICH tenant receives it.
const branch = (() => {
  const r = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: REPO, encoding: "utf8" });
  return r.status === 0 ? (r.stdout || "").trim() : null;
})();

async function deployTo(id) {
  const { scriptId, deploymentId: configuredDeploymentId } = requireTenantConfig(id);
  const client = CLIENTS[id];

  console.log(
    `\n${"=".repeat(70)}\n` +
      `Deploying ${backendVersion}${branch ? ` from branch "${branch}"` : ""} to "${id}" (${client.orgName})`
  );

  // The warning is about deploying to somebody's live data, which is a property of the
  // TENANT, not of the branch. Dev exists precisely so an unmerged branch has a harmless
  // home, so scolding there would be noise that teaches people to ignore the real one.
  if (id !== DEV_ID) {
    console.log(
      `\n  ! This is a PRODUCTION backend — the one ${client.orgName} uses.\n` +
        `    ${branch && branch !== "main"
              ? `Branch "${branch}" is unmerged, so this is testing in production.`
              : `Their live data is behind it.`}\n` +
        `    Try it on "${DEV_ID}" first if you have not:  node deploy.mjs ${DEV_ID}`
    );
  }

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), `bca-gas-${id}-`));
  try {
    fs.writeFileSync(path.join(staging, ".clasp.json"), JSON.stringify({ scriptId, rootDir: "." }, null, 2));

    step("Fetching the live script");
    clasp(["pull"], { cwd: staging });

    // Pulling first means appsscript.json is always the LIVE manifest, so a deploy can
    // never accidentally change the web app's access settings. It also tells us what the
    // remote actually calls its code file — pushing under the wrong name would leave the
    // old file in place and duplicate every function.
    const serverFiles = fs
      .readdirSync(staging)
      .filter((f) => /\.(gs|js)$/i.test(f))
      .filter((f) => fs.readFileSync(path.join(staging, f), "utf8").includes("SCRIPT_VERSION"));

    if (serverFiles.length !== 1) {
      die(
        `Expected exactly one remote file defining SCRIPT_VERSION in "${id}", found ${serverFiles.length}` +
          (serverFiles.length ? `: ${serverFiles.join(", ")}` : "") +
          `.\nThe live script's layout differs from what this script assumes — deploy by hand and check DEPLOY.md.` +
          (serverFiles.length === 0
            ? `\n\nIf this is a BRAND NEW tenant, it has no backend yet — bootstrap it with\n    node new-tenant.mjs --id ${id} ...\nrather than with this script.`
            : "")
      );
    }
    const remoteName = serverFiles[0];
    const liveVersion = (fs.readFileSync(path.join(staging, remoteName), "utf8")
      .match(/const SCRIPT_VERSION = "([^"]+)"/) || [])[1];
    console.log(`  live script is "${remoteName}" (currently ${liveVersion || "unknown"})`);

    // Refuse to go backwards. A branch can easily be behind what is already deployed, and
    // because every save rewrites whole sheet tabs from the backend's own field lists, an
    // older backend silently DROPS columns a newer one added - the next save after a
    // downgrade destroys that data. This happened once (v24 live, v22 pushed over it) and
    // is the reason the check exists. Same-version re-deploys are fine.
    const seq = (v) => {
      const m = /^v(\d+)/.exec(String(v || "").trim());
      return m ? Number(m[1]) : null;
    };
    const liveSeq = seq(liveVersion);
    const nextSeq = seq(backendVersion);

    if (liveSeq !== null && nextSeq !== null && nextSeq < liveSeq && !process.env.ALLOW_DOWNGRADE) {
      die(
        `Refusing to downgrade the live backend of "${id}".\n\n` +
          `    live:             ${liveVersion}\n` +
          `    this repo/branch: ${backendVersion}\n\n` +
          `Nothing was uploaded. This branch is behind what is already deployed - you are\n` +
          `probably on the wrong branch, or the newer work needs merging in first.\n\n` +
          `Because a save rewrites whole sheet tabs from the backend's field list, an older\n` +
          `backend drops columns a newer one added. That is data loss, not just a rollback.\n\n` +
          `If a rollback really is what you want: ALLOW_DOWNGRADE=1 node deploy.mjs ${id}`
      );
    }
    if (liveSeq === null || nextSeq === null) {
      console.log("  (could not compare versions numerically - downgrade check skipped)");
    }

    fs.copyFileSync(path.join(REPO, "AssetTrackerSync.gs"), path.join(staging, remoteName));

    step("Uploading");
    clasp(["push", "-f"], { cwd: staging });

    step("Creating a new version");
    const { versionNumber } = clasp(["create-version", backendVersion, "--json"], { cwd: staging, json: true });
    if (!versionNumber) die("clasp did not return a version number.");
    console.log(`  version ${versionNumber}`);

    step("Pointing the existing deployment at it");
    let deploymentId = configuredDeploymentId;
    if (!deploymentId) {
      const all = clasp(["list-deployments", "--json"], { cwd: staging, json: true });
      // The always-present @HEAD dev deployment has no versionNumber; the real web app does.
      const versioned = all.filter((d) => d.versionNumber !== undefined && d.versionNumber !== null);
      if (versioned.length !== 1) {
        die(
          `Could not tell which deployment of "${id}" to update (found ${versioned.length} versioned).\n` +
            all.map((d) => `    ${d.deploymentId}  @${d.versionNumber ?? "HEAD"}  ${d.description ?? ""}`).join("\n") +
            `\n\nRecord the right one:  node set-tenant.mjs ${id} ${scriptId} <DEPLOYMENT_ID>`
        );
      }
      deploymentId = versioned[0].deploymentId;
    }
    clasp(["update-deployment", deploymentId, "-V", String(versionNumber), "-d", backendVersion], { cwd: staging });
    console.log(`  deployment ${deploymentId} now serving version ${versionNumber}`);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }

  // ---------------------------------------------------- verify against the live URL

  step(`Checking ${id}'s live backend actually reports ${backendVersion}`);

  for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt++) {
    const reported = await liveVersionOf(id);

    if (reported === backendVersion) {
      console.log(`\n✓ ${id} is now ${backendVersion}. Deploy confirmed.`);
      return true;
    }

    if (attempt < VERIFY_ATTEMPTS) {
      console.log(`  attempt ${attempt}: ${reported ? `still reporting ${reported}` : "no clear answer"}, retrying…`);
      await sleep(VERIFY_WAIT_MS);
    } else {
      console.error(
        `\n✗ The upload to "${id}" succeeded but its live backend is NOT reporting ${backendVersion}` +
          (reported ? ` (it says ${reported})` : "") +
          `.\n  This is exactly the silent-failure case this check exists to catch.\n` +
          `  Open that tenant's Apps Script editor and confirm a NEW VERSION was deployed, not just saved.`
      );
      return false;
    }
  }
  return false;
}

const results = [];
for (const id of targets) {
  // Deliberately NOT Promise.all: clasp is interactive-ish and shares one login, and a
  // readable sequential log is worth more than saving a few seconds on a phone.
  results.push([id, await deployTo(id)]);
}

if (results.length > 1) {
  console.log(`\n${"=".repeat(70)}\nSummary for ${backendVersion}:`);
  for (const [id, ok] of results) console.log(`  ${ok ? "✓" : "✗"} ${id}`);
}

const failed = results.filter(([, ok]) => !ok).map(([id]) => id);
if (failed.length) {
  // A partial --all leaves tenants on different versions, which is a real state someone
  // has to act on, so it exits non-zero and names them rather than ending on a tick.
  die(`Not deployed: ${failed.join(", ")}. Re-run for those, or: node deploy.mjs --status`);
}
console.log("");
