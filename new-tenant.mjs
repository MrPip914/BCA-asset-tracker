#!/usr/bin/env node
//
// Bootstraps a brand new tenant: a Google Sheet, its bound Apps Script project, the
// backend pushed into it, and a Web App deployment — then prints everything needed to
// add it to clients.js.
//
//   node new-tenant.mjs --id dev --name "Asset Tracker (dev)" --org "Development sandbox" --prefix DEV
//   node new-tenant.mjs --id dev ... --dry-run     print the plan, create nothing
//
// WHY THIS EXISTS RATHER THAN "just do it in the Apps Script editor": deploy.mjs cannot
// bootstrap. It pulls the live project and expects to find an existing copy of the backend
// to overwrite, and it UPDATES an existing deployment rather than creating one — neither is
// true of an empty project. Doing it by hand means pasting ~90KB into a phone browser and
// clicking through the deployment dialog, once per client, forever.
//
// Run it in Google Cloud Shell, where `clasp login` already persists. See DEPLOY.md.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.dirname(fileURLToPath(import.meta.url));
const CLASP = "@google/clasp@3.4.0";

const die = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1); };
const step = (msg) => console.log(`\n▸ ${msg}`);

function clasp(args, { cwd, json = false } = {}) {
  const quoted = ["-y", CLASP, ...args].map((a) => (/[\s"]/.test(a) ? JSON.stringify(a) : a));
  const res = spawnSync("npx", quoted, {
    cwd, shell: true, encoding: "utf8",
    stdio: json ? ["inherit", "pipe", "inherit"] : "inherit",
  });
  if (res.status !== 0) die(`clasp ${args[0]} failed (exit ${res.status}).`);
  if (!json) return null;
  const out = res.stdout || "";
  const start = out.search(/[[{]/);
  if (start === -1) return { _raw: out };
  try { return JSON.parse(out.slice(start).trim()); } catch { return { _raw: out }; }
}

// ------------------------------------------------------------------ arguments

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
function arg(name) {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
}

const id = arg("id");
const appName = arg("name");
const orgName = arg("org");
const prefix = arg("prefix");

if (!id || !appName || !orgName || !prefix) {
  die(
    `Usage:\n\n` +
      `  node new-tenant.mjs --id <id> --name "<App name>" --org "<Organisation>" --prefix <PREFIX>\n\n` +
      `  --id      short url-safe key, becomes ?client=<id>   e.g. dev, stmarys\n` +
      `  --name    what the app calls itself                  e.g. "St Mary's Asset Tracker"\n` +
      `  --org     the organisation, shown under the name     e.g. "St Mary's School"\n` +
      `  --prefix  asset-ID prefix, letters only              e.g. SMS  (gives SMS0001)\n\n` +
      `  --dry-run prints the plan and creates nothing.`
  );
}
if (!/^[a-z0-9-]+$/.test(id)) die(`--id must be lowercase letters, digits or hyphens. Got "${id}".`);
// Letters only because clients.js builds ASSET_LABEL_RE from this without escaping, and
// because a prefix with a digit in it would make the label's number ambiguous.
if (!/^[A-Za-z]+$/.test(prefix)) die(`--prefix must be letters only. Got "${prefix}".`);

if (fs.readFileSync(path.join(REPO, "clients.js"), "utf8").includes(`\n    ${id}: {`)) {
  die(`clients.js already has a tenant called "${id}".`);
}

const backendVersion = (fs.readFileSync(path.join(REPO, "AssetTrackerSync.gs"), "utf8")
  .match(/const SCRIPT_VERSION = "([^"]+)"/) || [])[1];
if (!backendVersion) die("Could not read SCRIPT_VERSION from AssetTrackerSync.gs.");

const title = `${orgName} — Asset Tracker`;

// The manifest for the NEW project. Deliberately does NOT declare oauthScopes: Brookside's
// live manifest does, and that is exactly what made adding a Drive call fail at runtime
// (see "Wipe and import" in CLAUDE.md) — with no explicit list, Apps Script detects the
// scopes a version actually needs. webapp settings have to be here, because a deployment
// created through the API takes its access settings from the manifest, not from a dialog.
const manifest = {
  timeZone: "America/Los_Angeles",
  exceptionLogging: "STACKDRIVER",
  runtimeVersion: "V8",
  webapp: { executeAs: "USER_DEPLOYING", access: "ANYONE_ANONYMOUS" },
};

console.log(
  `\nNew tenant "${id}"\n` +
    `  Sheet + script title   ${title}\n` +
    `  App name               ${appName}\n` +
    `  Asset ID prefix        ${prefix}  (e.g. ${prefix}0001)\n` +
    `  Backend version        ${backendVersion}\n` +
    `  Web app access         anyone, executing as you\n`
);

if (dryRun) {
  console.log("--dry-run: nothing was created. The manifest that would be pushed:\n");
  console.log(JSON.stringify(manifest, null, 2));
  console.log("");
  process.exit(0);
}

// ---------------------------------------------------------------- create it

const staging = fs.mkdtempSync(path.join(os.tmpdir(), `bca-new-${id}-`));
let scriptId = null;
let deploymentId = null;

try {
  step(`Creating the Sheet and its bound script`);
  // --type sheets makes a NEW spreadsheet and binds a script to it, which is what makes
  // this one command instead of "create a Sheet, then Extensions > Apps Script".
  const created = clasp(["create-script", "--type", "sheets", "--title", title, "--rootDir", "."],
    { cwd: staging, json: true });
  scriptId = created.scriptId || created.parentId || null;
  if (!scriptId && fs.existsSync(path.join(staging, ".clasp.json"))) {
    scriptId = JSON.parse(fs.readFileSync(path.join(staging, ".clasp.json"), "utf8")).scriptId;
  }
  if (!scriptId) die(`clasp created something but did not report a scriptId:\n${created._raw || JSON.stringify(created)}`);
  console.log(`  scriptId ${scriptId}`);

  step("Pushing the backend and the web app manifest");
  // A newly created project ships a stub Code.gs; overwriting it by name means the push
  // replaces it rather than leaving a second file that also defines nothing.
  for (const f of fs.readdirSync(staging)) {
    if (/\.(gs|js)$/i.test(f)) fs.rmSync(path.join(staging, f));
  }
  fs.writeFileSync(path.join(staging, "appsscript.json"), JSON.stringify(manifest, null, 2));
  fs.copyFileSync(path.join(REPO, "AssetTrackerSync.gs"), path.join(staging, "AssetTrackerSync.gs"));
  clasp(["push", "-f"], { cwd: staging });

  step("Creating the web app deployment");
  const dep = clasp(["create-deployment", "-d", `${backendVersion} (initial)`, "--json"],
    { cwd: staging, json: true });
  deploymentId = dep.deploymentId || (Array.isArray(dep) ? dep[0]?.deploymentId : null);
  if (!deploymentId) {
    const all = clasp(["list-deployments", "--json"], { cwd: staging, json: true });
    const versioned = (Array.isArray(all) ? all : []).filter((d) => d.versionNumber != null);
    deploymentId = versioned.length === 1 ? versioned[0].deploymentId : null;
  }
  if (!deploymentId) die(`Deployment created but its id could not be read. Run:\n    npx -y ${CLASP} list-deployments`);
  console.log(`  deploymentId ${deploymentId}`);
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}

// A web app's public URL is its DEPLOYMENT id, not its script id — using the script id
// here would produce a URL that 404s in a way that looks like the deploy failed.
const apiUrl = `https://script.google.com/macros/s/${deploymentId}/exec`;

// Recorded straight away rather than printed for copying: this runs on a phone, and the
// script id is 57 characters of noise to retype.
step("Recording the ids for deploy.mjs");
const setRes = spawnSync("node", [path.join(REPO, "set-tenant.mjs"), id, scriptId, deploymentId],
  { stdio: "inherit", encoding: "utf8" });
if (setRes.status !== 0) console.error(`  (could not record automatically — run: node set-tenant.mjs ${id} ${scriptId} ${deploymentId})`);

console.log(`
${"=".repeat(70)}
✓ Tenant "${id}" created.

  Sheet + script   ${title}
  scriptId         ${scriptId}
  deploymentId     ${deploymentId}
  /exec URL        ${apiUrl}

NEXT, IN ORDER — the first two cannot be scripted:

  1. AUTHORIZE IT. Open the script editor, pick any function, Run, and approve the
     permission prompt:

         https://script.google.com/home/projects/${scriptId}/edit

     The web app executes as YOU, so until you have granted the scopes every request
     to it fails. Run forceAuthorizeExternalRequests — it exists for this, and logs
     "HTTP 400", which is the expected answer to a junk token and means it worked.

  2. CHECK IT ANSWERS. Open the /exec URL above in a browser. It should return JSON
     saying it needs sign-in, and reporting scriptVersion ${backendVersion}. That
     response needs no login and is the documented way to ask a backend its version.

  3. ADD IT TO clients.js — paste this into the CLIENTS object:

    ${id}: {
      appName: ${JSON.stringify(appName)},
      orgName: ${JSON.stringify(orgName)},
      labelPrefix: ${JSON.stringify(prefix)},
      apiUrl: ${JSON.stringify(apiUrl)},
    },

  4. Redeploy later with:  node deploy.mjs ${id}
`);
