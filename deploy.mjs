#!/usr/bin/env node
//
// Deploys AssetTrackerSync.gs to Google Apps Script and then PROVES it landed.
//
//   node deploy.mjs
//
// Replaces the manual ritual (paste into the editor > Deploy > Manage deployments >
// pencil > New version > Deploy). Reuses the EXISTING deployment, so the /exec URL in
// SHEET_API_URL never changes.
//
// The verification step at the end is the point: it fetches the live /exec and checks
// that the backend now reports the version this repo expects. A deploy that silently
// didn't take fails here, loudly, instead of days later when a feature quietly stops
// persisting.
//
// See DEPLOY.md for one-time setup.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
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
        return JSON.parse(fs.readFileSync(p, "utf8"));
      } catch {
        die(`${p} is not valid JSON.`);
      }
    }
  }
  return {};
}

const cfg = loadConfig();
const scriptId = process.env.GAS_SCRIPT_ID || cfg.scriptId;
if (!scriptId || scriptId.startsWith("PASTE_")) {
  die(
    "No Apps Script ID configured.\n\n" +
      "Find it in the Apps Script editor under Project Settings > IDs > Script ID, then\n" +
      "save it once (it persists, so this is a one-time step):\n\n" +
      `    echo '{"scriptId":"YOUR_ID_HERE"}' > ${HOME_CONFIG}\n\n` +
      "See DEPLOY.md."
  );
}

// ------------------------------------------------- preflight: versions agree

const backendVersion = readMatch("AssetTrackerSync.gs", /const SCRIPT_VERSION = "([^"]+)"/, "SCRIPT_VERSION");
const frontendVersion = readMatch("index.html", /const FRONTEND_SCRIPT_VERSION = "([^"]+)"/, "FRONTEND_SCRIPT_VERSION");
const apiUrl = readMatch("index.html", /const SHEET_API_URL = "([^"]+)"/, "SHEET_API_URL");

if (backendVersion !== frontendVersion) {
  die(
    `Version mismatch before deploying:\n` +
      `    AssetTrackerSync.gs SCRIPT_VERSION      = ${backendVersion}\n` +
      `    index.html FRONTEND_SCRIPT_VERSION      = ${frontendVersion}\n\n` +
      `Both must be bumped in the same commit, or the app will show a permanent\n` +
      `"Backend outdated" warning. Fix them and re-run.`
  );
}
console.log(`Deploying ${backendVersion}`);

// -------------------------------------- stage: pull live project, swap in our file

const staging = fs.mkdtempSync(path.join(os.tmpdir(), "bca-gas-"));
let pushed = false;
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
      `Expected exactly one remote file defining SCRIPT_VERSION, found ${serverFiles.length}` +
        (serverFiles.length ? `: ${serverFiles.join(", ")}` : "") +
        `.\nThe live script's layout differs from what this script assumes — deploy by hand and check DEPLOY.md.`
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
      `Refusing to downgrade the live backend.\n\n` +
        `    live:            ${liveVersion}\n` +
        `    this repo/branch: ${backendVersion}\n\n` +
        `Nothing was uploaded. This branch is behind what is already deployed - you are\n` +
        `probably on the wrong branch, or the newer work needs merging in first.\n\n` +
        `Because a save rewrites whole sheet tabs from the backend's field list, an older\n` +
        `backend drops columns a newer one added. That is data loss, not just a rollback.\n\n` +
        `If a rollback really is what you want: ALLOW_DOWNGRADE=1 node deploy.mjs`
    );
  }
  if (liveSeq === null || nextSeq === null) {
    console.log("  (could not compare versions numerically - downgrade check skipped)");
  }

  fs.copyFileSync(path.join(REPO, "AssetTrackerSync.gs"), path.join(staging, remoteName));

  step("Uploading");
  clasp(["push", "-f"], { cwd: staging });
  pushed = true;

  step("Creating a new version");
  const { versionNumber } = clasp(["create-version", backendVersion, "--json"], { cwd: staging, json: true });
  if (!versionNumber) die("clasp did not return a version number.");
  console.log(`  version ${versionNumber}`);

  step("Pointing the existing deployment at it");
  let deploymentId = process.env.GAS_DEPLOYMENT_ID || cfg.deploymentId;
  if (!deploymentId) {
    const all = clasp(["list-deployments", "--json"], { cwd: staging, json: true });
    // The always-present @HEAD dev deployment has no versionNumber; the real web app does.
    const versioned = all.filter((d) => d.versionNumber !== undefined && d.versionNumber !== null);
    if (versioned.length !== 1) {
      die(
        `Could not tell which deployment to update (found ${versioned.length} versioned).\n` +
          all.map((d) => `    ${d.deploymentId}  @${d.versionNumber ?? "HEAD"}  ${d.description ?? ""}`).join("\n") +
          `\n\nAdd the right one to deploy.config.json as "deploymentId".`
      );
    }
    deploymentId = versioned[0].deploymentId;
  }
  clasp(["update-deployment", deploymentId, "-V", String(versionNumber), "-d", backendVersion], { cwd: staging });
  console.log(`  deployment ${deploymentId} now serving version ${versionNumber}`);
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}

// ------------------------------------------------------ verify against the live URL

step("Checking the live backend actually reports " + backendVersion);

for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt++) {
  let reported = null;
  try {
    const res = await fetch(apiUrl, { redirect: "follow" });
    const body = await res.text();
    reported = (JSON.parse(body) || {}).scriptVersion ?? null;
  } catch {
    // A fresh deploy can briefly 302 to an error page or return HTML. Retry.
  }

  if (reported === backendVersion) {
    console.log(`\n✓ Live backend is now ${backendVersion}. Deploy confirmed.\n`);
    process.exit(0);
  }

  if (attempt < VERIFY_ATTEMPTS) {
    console.log(`  attempt ${attempt}: ${reported ? `still reporting ${reported}` : "no clear answer"}, retrying…`);
    await sleep(VERIFY_WAIT_MS);
  } else {
    die(
      `The upload succeeded but the live backend is NOT reporting ${backendVersion}` +
        (reported ? ` (it says ${reported})` : "") +
        `.\n\nThis is exactly the silent-failure case this check exists to catch.\n` +
        `Open the Apps Script editor and confirm a NEW VERSION was deployed, not just saved.`
    );
  }
}
