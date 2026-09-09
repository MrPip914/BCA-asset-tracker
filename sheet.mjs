// Direct Google Sheets access for data cleanup, bypassing the app entirely.
//
//   node sheet.mjs tenants                       list configured tenants
//   node sheet.mjs set <tenant> <sheetId>        remember a tenant's Sheet id
//   node sheet.mjs tabs <tenant>                 list the Sheet's tabs + row counts
//   node sheet.mjs read <tenant> <Tab>           dump a tab as JSON (stdout)
//   node sheet.mjs read <tenant> --all <dir>     dump EVERY tab into a directory
//   node sheet.mjs write <tenant> <Tab> <file>   replace a tab's rows from a JSON file
//   node sheet.mjs bump <tenant> <domain...>     bump rev_assets / rev_config / rev_breakerTypes
//
// WHY THIS EXISTS, given the app already writes the Sheet. Cleaning up data —
// fixing a mis-typed parent on forty rows, renaming a stale value, seeding a dev
// tenant — is work the app has no UI for and shouldn't grow one for. Eric's call
// (2026-09-09): do it directly rather than build functionality into the app.
//
// WHAT THAT COSTS, stated plainly because nothing here enforces it. Every guard
// in AssetTrackerSync.gs lives in doPost, and this file does not go through
// doPost. So there is no editor/viewer role check, no audit row describing what
// changed, and no server-side refusal of a destructive write. The Sheet's own
// File > Version history is the undo, exactly as it has been for every other
// incident this project has had.
//
// WHAT IT DOES REPLICATE, because these are data-corrupting rather than merely
// unguarded, and each has already bitten this project once:
//
//   - Plain-text number format on every written range. Sheets auto-detects a
//     "yyyy-MM-dd" string and converts the cell to a real Date, which then reads
//     back as "2026-06-03T07:00:00.000Z" instead of the plain string the app
//     expects. writeTable_ calls setNumberFormat("@") for this; the REST
//     equivalent is a repeatCell with numberFormat TEXT, done BEFORE the values
//     land. valueInputOption is RAW for the same reason, one layer up.
//   - The sheet's OWN header row is authoritative and is never reordered or
//     dropped. readTable_ keys every row off whatever the sheet says, so a
//     rewrite that reorders headers silently re-labels every column of data.
//     A write here fills the existing header order and refuses any key that
//     isn't already a column.
//   - A backup of the whole Sheet before every write. Not a substitute for
//     version history, but it is local, immediate, and diffable.
//   - The mass-deletion guard's shape: writing zero rows over a populated tab
//     needs --allow-empty. doPost refuses the same thing for the same reason —
//     in a full-overwrite model, "I sent nothing" and "delete everything" are
//     the same request.
//
// AND ONE THING THE APP CANNOT DO FOR ITSELF: bumping the revision counters.
// A browser left open holds a snapshot from before this ran, and its next save
// would overwrite the cleanup wholesale. Bumping rev_* makes that save fail the
// optimistic-concurrency check in doPost, so the app reloads instead. `write`
// does it automatically for the domain it touched. This is the single cheapest
// thing that stops direct editing from fighting the app, which is why it is not
// optional.
//
// ZERO DEPENDENCIES on purpose — this repo has no build step and no node_modules,
// and a cleanup tool that needs an npm install before it runs is one that won't
// be run. The service-account JWT is signed with node:crypto and exchanged for an
// access token by hand; that is ~20 lines and costs less than a dependency.
//
// CREDENTIALS live outside the repo, which is public:
//   ~/.bca-asset-tracker-sheets.json          the service account key, as downloaded
//   ~/.bca-asset-tracker-sheets-tenants.json  { "dev": "<sheetId>", ... }
// Same $HOME convention as ~/.bca-asset-tracker-deploy.json, and for the same
// reason: a fresh clone must not carry either one.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

const KEY_PATH = process.env.BCA_SHEETS_KEY
  || path.join(os.homedir(), ".bca-asset-tracker-sheets.json");
const TENANTS_PATH = process.env.BCA_SHEETS_TENANTS
  || path.join(os.homedir(), ".bca-asset-tracker-sheets-tenants.json");

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const API = "https://sheets.googleapis.com/v4/spreadsheets";

// Mirrors REVISION_DOMAINS / REVISION_KEY_PREFIX in AssetTrackerSync.gs.
const REVISION_DOMAINS = ["assets", "config", "breakerTypes"];
const REVISION_KEY_PREFIX = "rev_";

// Which revision domain a tab belongs to, so `write` can bump the right counter
// without being told. Mirrors doPost's own _dirty grouping: the asset domain is
// the Assets tab plus every child tab keyed by assetLabel/panelLabel.
const TAB_DOMAIN = {
  Assets: "assets", Comments: "assets", Changes: "assets", Allocations: "assets",
  Maintenance: "assets", Breakers: "assets", Circuits: "assets",
  Config: "config",
  BreakerTypes: "breakerTypes",
  // AuditLog deliberately absent: it is append-only and carries no counter.
};

function die(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

function readJson(file, what) {
  if (!fs.existsSync(file)) die(`No ${what} at ${file}`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    die(`${file} is not valid JSON: ${err.message}`);
  }
}

// ------------------------------------------------------------------ auth
// Service-account JWT -> access token. Google's own documented flow; the only
// reason it is written out rather than imported is the no-dependency rule above.
let cachedToken = null;
async function accessToken() {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  const key = readJson(KEY_PATH, "service account key");
  if (!key.client_email || !key.private_key) {
    die(`${KEY_PATH} does not look like a service account key (no client_email/private_key).`);
  }
  const b64 = (s) => Buffer.from(s).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." + b64(JSON.stringify({
    iss: key.client_email, scope: SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  }));
  const sig = crypto.createSign("RSA-SHA256").update(unsigned).sign(key.private_key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: unsigned + "." + b64(sig),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) die(`Token request failed (HTTP ${res.status}): ${body.error_description || body.error || "unknown"}`);
  cachedToken = { value: body.access_token, expires: Date.now() + (body.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

async function api(url, opts = {}) {
  const token = await accessToken();
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!res.ok) {
    const detail = (body.error && body.error.message) || body.raw || `HTTP ${res.status}`;
    if (res.status === 403) {
      die(`Google refused that request: ${detail}\n\n` +
        `  The usual cause is the Sheet not being shared with the service account.\n` +
        `  Open the Sheet > Share and add it as an Editor.`);
    }
    die(`Google API error: ${detail}`);
  }
  return body;
}

// ------------------------------------------------------------------ tenants
function tenants() {
  return fs.existsSync(TENANTS_PATH) ? readJson(TENANTS_PATH, "tenant map") : {};
}

function sheetIdFor(tenant) {
  const map = tenants();
  const id = map[tenant];
  if (!id) {
    die(`No Sheet id for tenant "${tenant}".\n\n` +
      `  Known: ${Object.keys(map).join(", ") || "(none)"}\n` +
      `  Add one with:  node sheet.mjs set ${tenant} <sheetId>`);
  }
  return id;
}

// ------------------------------------------------------------------ sheet io
async function sheetMeta(sheetId) {
  const meta = await api(`${API}/${sheetId}?fields=properties.title,sheets.properties`);
  return {
    title: meta.properties.title,
    tabs: meta.sheets.map((s) => ({
      title: s.properties.title,
      gid: s.properties.sheetId,
      rows: s.properties.gridProperties.rowCount,
      cols: s.properties.gridProperties.columnCount,
    })),
  };
}

const quote = (tab) => `'${String(tab).replace(/'/g, "''")}'`;

// FORMATTED_VALUE is the REST equivalent of getDisplayValues(): what is on
// screen, as a string. getValues()/UNFORMATTED_VALUE would hand back a serial
// number for any cell Sheets managed to interpret as a date, which is the exact
// corruption the write path takes pains to avoid creating.
async function readGrid(sheetId, tab) {
  const res = await api(
    `${API}/${sheetId}/values/${encodeURIComponent(quote(tab))}` +
    `?valueRenderOption=FORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`
  );
  return res.values || [];
}

// Rows as objects, keyed by the SHEET's header row. Blank rows dropped, matching
// readTable_ in the backend so a read here sees what the app sees.
export function gridToRows(grid) {
  if (grid.length < 2) return { headers: grid[0] || [], rows: [] };
  const headers = grid[0].map((h) => String(h));
  const rows = grid.slice(1)
    .filter((r) => r.some((c) => c !== "" && c !== null && c !== undefined))
    .map((r) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = r[i] === undefined ? "" : r[i]; });
      return obj;
    });
  return { headers, rows };
}

// Every key a caller supplied that is not a column on the sheet. A write must
// refuse rather than drop these: silently ignoring an unknown key turns a typo
// ("lable") into a no-op that reports success while the value never lands.
export function unknownKeys(headers, rows) {
  const seen = new Set();
  rows.forEach((r) => Object.keys(r).forEach((k) => { if (!headers.includes(k)) seen.add(k); }));
  return [...seen];
}

// Rows to a grid, in the SHEET's header order. Everything is stringified because
// the range is formatted as text before the write; letting a number through as a
// number would land in a text-formatted cell anyway, so this only makes what is
// actually stored explicit. A missing key writes "" rather than being skipped,
// or the row would shift left and every column after it would be wrong.
export function rowsToValues(headers, rows) {
  return rows.map((r) => headers.map((h) => (r[h] === undefined || r[h] === null ? "" : String(r[h]))));
}

async function backup(sheetId, label) {
  const dir = path.join(os.homedir(), ".bca-asset-tracker-backups",
    `${label}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  fs.mkdirSync(dir, { recursive: true });
  const meta = await sheetMeta(sheetId);
  for (const tab of meta.tabs) {
    const grid = await readGrid(sheetId, tab.title);
    fs.writeFileSync(path.join(dir, `${tab.title}.json`), JSON.stringify(grid, null, 2));
  }
  return dir;
}

// ------------------------------------------------------------------ commands
async function cmdTabs(tenant) {
  const sheetId = sheetIdFor(tenant);
  const meta = await sheetMeta(sheetId);
  console.log(`${meta.title}  (${tenant})`);
  for (const tab of meta.tabs) {
    const grid = await readGrid(sheetId, tab.title);
    const { headers, rows } = gridToRows(grid);
    console.log(`  ${tab.title.padEnd(16)} ${String(rows.length).padStart(5)} rows   ${headers.join(", ")}`);
  }
}

async function cmdRead(tenant, tab, outDir) {
  const sheetId = sheetIdFor(tenant);
  if (tab === "--all") {
    if (!outDir) die("read --all needs a directory to write into.");
    fs.mkdirSync(outDir, { recursive: true });
    const meta = await sheetMeta(sheetId);
    for (const t of meta.tabs) {
      const { headers, rows } = gridToRows(await readGrid(sheetId, t.title));
      fs.writeFileSync(path.join(outDir, `${t.title}.json`), JSON.stringify({ headers, rows }, null, 2));
      console.log(`  ${t.title.padEnd(16)} ${rows.length} rows`);
    }
    console.log(`✓ Wrote ${meta.tabs.length} tabs to ${outDir}`);
    return;
  }
  const { headers, rows } = gridToRows(await readGrid(sheetId, tab));
  process.stdout.write(JSON.stringify({ headers, rows }, null, 2) + "\n");
}

async function cmdWrite(tenant, tab, file, flags) {
  const sheetId = sheetIdFor(tenant);
  const payload = readJson(file, "row file");
  const rows = Array.isArray(payload) ? payload : payload.rows;
  if (!Array.isArray(rows)) die(`${file} must be an array of row objects, or { rows: [...] }.`);

  // The SHEET's header row wins, always. Reordering or dropping a column here
  // would silently re-label every value under it on the next read, because
  // readTable_ keys off whatever the sheet says rather than off any field list.
  const grid = await readGrid(sheetId, tab);
  const headers = (grid[0] || []).map((h) => String(h));
  if (!headers.length) die(`The "${tab}" tab has no header row. Refusing to invent one.`);
  const existingCount = gridToRows(grid).rows.length;

  const unknown = unknownKeys(headers, rows);
  if (unknown.length) {
    die(`These keys are not columns on "${tab}": ${unknown.join(", ")}\n\n` +
      `  Columns are: ${headers.join(", ")}\n` +
      `  Adding a column is a schema change and belongs in AssetTrackerSync.gs, not here.`);
  }

  // Same shape as doPost's mass-deletion guard, and for the same reason: with a
  // full-overwrite write, "no rows" and "delete everything" are indistinguishable.
  if (rows.length === 0 && existingCount > 0 && !flags.allowEmpty) {
    die(`Refusing to empty "${tab}", which has ${existingCount} rows.\n` +
      `  Pass --allow-empty if that is genuinely what you mean.`);
  }

  const domain = TAB_DOMAIN[tab];
  console.log(`${tab}: ${existingCount} rows → ${rows.length} rows` +
    (domain ? `   (will bump rev_${domain})` : "   (no revision counter for this tab)"));
  if (flags.dryRun) { console.log("✓ Dry run, nothing written."); return; }

  const dir = await backup(sheetId, tenant);
  console.log(`  backup: ${dir}`);

  await writeRows(sheetId, tab, headers, rows);
  console.log(`✓ Wrote ${rows.length} rows to ${tab}.`);

  if (domain) {
    const to = await bumpRevisions(sheetId, [domain]);
    console.log(`✓ rev_${domain} → ${to[domain]}   (an open browser will now reload rather than overwrite this)`);
  }
}

async function writeRows(sheetId, tab, headers, rows) {
  const meta = await sheetMeta(sheetId);
  const target = meta.tabs.find((t) => t.title === tab);
  if (!target) die(`No tab named "${tab}".`);

  // Clear the data rows first, so a shorter write leaves nothing behind. The
  // header row is deliberately left in place rather than rewritten — it is the
  // authority, and rewriting it is how a column set silently changes.
  await api(`${API}/${sheetId}/values/${encodeURIComponent(quote(tab) + "!A2:ZZ")}:clear`, { method: "POST", body: "{}" });
  if (!rows.length) return;

  // Plain text BEFORE the values, mirroring writeTable_'s setNumberFormat("@").
  // Sheets applies formatting at write time, so doing this afterwards would be
  // too late: the date has already become a Date.
  await api(`${API}/${sheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [{
        repeatCell: {
          range: {
            sheetId: target.gid, startRowIndex: 1,
            endRowIndex: rows.length + 1, startColumnIndex: 0, endColumnIndex: headers.length,
          },
          cell: { userEnteredFormat: { numberFormat: { type: "TEXT" } } },
          fields: "userEnteredFormat.numberFormat",
        },
      }],
    }),
  });

  const values = rowsToValues(headers, rows);
  // RAW, not USER_ENTERED: the second one re-parses "2026-06-03" and "=SUM(" alike.
  await api(
    `${API}/${sheetId}/values/${encodeURIComponent(quote(tab) + `!A2`)}?valueInputOption=RAW`,
    { method: "PUT", body: JSON.stringify({ values }) }
  );
}

// A1 column letter from a 0-based index. Written out rather than
// String.fromCharCode(65 + i), which is silently wrong past column Z — Config
// only has two columns today, but a helper that breaks on growth is a trap.
export function colLetter(index) {
  let s = "", n = index;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

// Config is key/value rows, so a counter bump is a single cell edit — found by
// key, never by row number, since nothing keeps Config's row order stable.
async function bumpRevisions(sheetId, domains) {
  const grid = await readGrid(sheetId, "Config");
  const headers = (grid[0] || []).map(String);
  const keyCol = headers.indexOf("key");
  const valCol = headers.indexOf("value");
  if (keyCol === -1 || valCol === -1) die(`The Config tab has no key/value columns (found: ${headers.join(", ")}).`);

  const result = {};
  const updates = [];
  const appended = [];
  for (const domain of domains) {
    const key = REVISION_KEY_PREFIX + domain;
    const idx = grid.findIndex((r, i) => i > 0 && String(r[keyCol]) === key);
    // Missing / blank / garbage reads as 0, matching readRevisions_ — so a bump
    // on a sheet that has never had counters starts them at 1 rather than NaN.
    const current = idx === -1 ? 0 : (Number(grid[idx][valCol]) > 0 ? Math.floor(Number(grid[idx][valCol])) : 0);
    const next = current + 1;
    result[domain] = next;
    if (idx === -1) appended.push([key, String(next)]);
    else updates.push({
      range: `${quote("Config")}!${colLetter(valCol)}${idx + 1}`,
      values: [[String(next)]],
    });
  }
  if (updates.length) {
    await api(`${API}/${sheetId}/values:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ valueInputOption: "RAW", data: updates }),
    });
  }
  if (appended.length) {
    await api(
      `${API}/${sheetId}/values/${encodeURIComponent(quote("Config") + "!A1")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: "POST", body: JSON.stringify({ values: appended }) }
    );
  }
  return result;
}

// ------------------------------------------------------------------ entry
// Guarded so the pure helpers above can be imported by test-sheet-tool.mjs
// without the CLI running as a side effect of the import.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) await main();

async function main() {
const [cmd, ...rest] = process.argv.slice(2);
const flags = {
  dryRun: rest.includes("--dry-run"),
  allowEmpty: rest.includes("--allow-empty"),
};
const args = rest.filter((a) => !a.startsWith("--"));

const USAGE = `
  node sheet.mjs tenants
  node sheet.mjs set <tenant> <sheetId>
  node sheet.mjs tabs <tenant>
  node sheet.mjs read <tenant> <Tab>
  node sheet.mjs read <tenant> --all <dir>
  node sheet.mjs write <tenant> <Tab> <file.json> [--dry-run] [--allow-empty]
  node sheet.mjs bump <tenant> <domain...>

  key:     ${KEY_PATH}
  tenants: ${TENANTS_PATH}
`;

try {
  if (cmd === "tenants") {
    const map = tenants();
    const keys = Object.keys(map);
    if (!keys.length) console.log(`No tenants yet. Add one:  node sheet.mjs set dev <sheetId>`);
    keys.forEach((k) => console.log(`  ${k.padEnd(8)} ${map[k]}`));
  } else if (cmd === "set") {
    const [tenant, sheetId] = args;
    if (!tenant || !sheetId) die("Usage: node sheet.mjs set <tenant> <sheetId>");
    const map = tenants();
    map[tenant] = sheetId;
    fs.writeFileSync(TENANTS_PATH, JSON.stringify(map, null, 2) + "\n");
    console.log(`✓ ${tenant} → ${sheetId}\n  stored in ${TENANTS_PATH}`);
  } else if (cmd === "tabs") {
    await cmdTabs(args[0]);
  } else if (cmd === "read") {
    await cmdRead(args[0], rest.includes("--all") ? "--all" : args[1], rest.includes("--all") ? args[1] : null);
  } else if (cmd === "write") {
    const [tenant, tab, file] = args;
    if (!tenant || !tab || !file) die("Usage: node sheet.mjs write <tenant> <Tab> <file.json>");
    await cmdWrite(tenant, tab, file, flags);
  } else if (cmd === "bump") {
    const [tenant, ...domains] = args;
    const bad = domains.filter((d) => !REVISION_DOMAINS.includes(d));
    if (!domains.length || bad.length) die(`Domains must be one or more of: ${REVISION_DOMAINS.join(", ")}`);
    const to = await bumpRevisions(sheetIdFor(tenant), domains);
    Object.entries(to).forEach(([d, v]) => console.log(`✓ rev_${d} → ${v}`));
  } else {
    console.log(USAGE);
  }
} catch (err) {
  die(err && err.stack ? err.stack : String(err));
}
}
