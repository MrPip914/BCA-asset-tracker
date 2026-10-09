// Builds the inventory snapshot from a tenant's Sheet BY RUNNING doGet's OWN CODE.
//
// AssetTrackerSync.gs is evaluated in a Node sandbox whose SpreadsheetApp is
// backed by grids already fetched through the Sheets API, and its real read
// handler (handleAuthenticatedRead_) is called. So the importer cannot drift
// from what the app is served today: every adoption the read performs --
// `id || label`, the comma-split cells, the circuits split by blank breakerId,
// the hash_ keys skipped in Config -- is the backend's own line, not a copy of
// it. DATABASE_BACKEND_PLAN.md asks for exactly that: "builds the same shapes
// doGet builds".
//
// Pure: grids in, snapshot out. No network, which is what lets
// db/test-import.mjs cover it against fixtures.

import nodeCrypto from "node:crypto";
import vm from "node:vm";

// What the sandbox replaces, and why each is safe for a READ:
//   acquireLock_   -- there is no script lock here; the Sheet is read once.
//   logDiag_       -- an import is not an app event; nothing is written back.
//   createSession_ -- the new backend mints its own sessions; none carry over.
//   respond_       -- hand back the payload object rather than a ContentService.
//   stage_         -- per-step timing goes to the Executions page; not here.
const OVERRIDES = `
  acquireLock_ = function () { return { releaseLock: function () {} }; };
  logDiag_ = function () {};
  createSession_ = function () { return ""; };
  respond_ = function (payload) { return payload; };
  stage_ = function () {};
`;

// grids: { [tabName]: string[][] } -- each a header row plus data rows, as the
// Sheets API returns them (trailing blank cells omitted).
//
// `fullAudit: false` leaves the limit alone, so the payload is exactly what an
// ordinary read answers -- which is what the API's parity test compares against.
export function snapshotFromGrids(gasSource, grids, { fullAudit = true } = {}) {
  // An ordinary read returns only the newest AUDIT_READ_LIMIT audit rows; an
  // import must carry ALL of them, since audit_log is append-only and nothing
  // could fill the gap later. The constant is lifted rather than calling a
  // second handler, so the audit rows go through the same mapping as the rest.
  const limitRe = /const AUDIT_READ_LIMIT = \d+;/;
  if (!limitRe.test(gasSource)) {
    throw new Error("AUDIT_READ_LIMIT not found in AssetTrackerSync.gs -- the importer would silently truncate the audit log.");
  }
  const src = fullAudit ? gasSource.replace(limitRe, "const AUDIT_READ_LIMIT = Infinity;") : gasSource;

  const sheetFor = (name) => {
    const grid = grids[name] || [];
    // getDataRange() is rectangular; the REST API drops trailing blank cells.
    const width = grid.reduce((w, r) => Math.max(w, r.length), 0);
    const values = grid.map((r) => {
      const row = r.slice();
      while (row.length < width) row.push("");
      return row;
    });
    return { getDataRange: () => ({ getValues: () => values }) };
  };

  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (name) => sheetFor(name),
        insertSheet: (name) => sheetFor(name),
      }),
    },
  };
  vm.createContext(ctx);
  // Top-level const/let in a script are not properties of the context, so the
  // values the importer needs are handed out by a getter evaluated in scope.
  new vm.Script(src + "\n" + OVERRIDES + `
    globalThis.__import = function () {
      const payload = handleAuthenticatedRead_({ _identity: { email: OWNER_EMAIL, name: "Owner" } });
      const configRaw = readConfigMap_();
      return {
        payload: payload,
        configRaw: configRaw,
        authUsers: readAuthUsers_(configRaw),
        ownerEmail: OWNER_EMAIL,
        scriptVersion: SCRIPT_VERSION,
        revisionDomains: REVISION_DOMAINS,
        tabHashPrefix: TAB_HASH_KEY_PREFIX,
        revisionPrefix: REVISION_KEY_PREFIX,
      };
    };
  `, { filename: "AssetTrackerSync.gs" }).runInContext(ctx);

  // JSON round trip: the payload is what the app would receive over the wire,
  // so `undefined` fields vanish here exactly as they do there.
  const out = JSON.parse(JSON.stringify(ctx.__import()));
  if (out.payload.ok === false) {
    throw new Error("The backend's read refused: " + (out.payload.error || out.payload.reason || "unknown"));
  }
  return out;
}

// A SAVE through the .gs's own doPost, against a fake Sheet that can be
// written. Grids in, { response, grids } out -- feed the grids back to
// snapshotFromGrids to see what the app would read next. This is the other
// half of the API's save parity test: the same body posted to both backends
// must read back the same.
//
// What the sandbox replaces, beyond the read's list:
//   authorizeSession_ -- always the owner as an editor (`as` overrides it);
//                        the session rules are the API's own tests' business.
//   jsonOut_          -- the object, not a ContentService.
//   Utilities         -- MD5 for the tab hashes, from node:crypto.
// Only the Sheet calls doPost makes exist: clear, getRange().setValues/
// setNumberFormat, getLastRow/getLastColumn, getDataRange().getValues.
//   PropertiesService -- Script Properties from `props` (the upload signers).
//   Utilities.getUuid, Date.now -- from `uuid` and `now` when given, so a
//                        signature can be compared byte for byte.
export function saveThroughSheet(gasSource, grids, body, { as, props = {}, uuid, now } = {}) {
  const sheets = {};
  const sheetFor = (name) => {
    if (sheets[name]) return sheets[name];
    let grid = (grids[name] || []).map((r) => r.slice());
    const lastRow = () => {
      for (let i = grid.length - 1; i >= 0; i--) if ((grid[i] || []).some((c) => c !== "" && c !== null && c !== undefined)) return i + 1;
      return 0;
    };
    const width = () => grid.reduce((w, r) => {
      for (let j = (r || []).length - 1; j >= 0; j--) if (r[j] !== "" && r[j] !== null && r[j] !== undefined) return Math.max(w, j + 1);
      return w;
    }, 0);
    const sheet = {
      clear() { grid = []; },
      getLastRow: lastRow,
      getLastColumn: width,
      getRange(row, col) {
        return {
          setNumberFormat() {},
          setValues(vals) {
            vals.forEach((v, i) => {
              const r = row - 1 + i;
              while (grid.length <= r) grid.push([]);
              v.forEach((cell, j) => { grid[r][col - 1 + j] = cell; });
            });
          },
        };
      },
      getDataRange() {
        const w = width();
        const n = lastRow();
        const values = () => grid.slice(0, n).map((r) => Array.from({ length: w }, (_, j) => (r[j] === undefined ? "" : r[j])));
        // Display values: what a cell shows, so a leading apostrophe is gone.
        const display = () => values().map((r) => r.map((c) => String(c).replace(/^'/, "")));
        return { getValues: values, getDisplayValues: display };
      },
      _grid: () => grid.slice(0, lastRow()),
    };
    sheets[name] = sheet;
    return sheet;
  };

  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSheetByName: sheetFor, insertSheet: sheetFor }),
    },
    Utilities: {
      DigestAlgorithm: { MD5: "md5", SHA_1: "sha1" },
      Charset: { UTF_8: "utf8" },
      computeDigest: (alg, text) => Array.from(nodeCrypto.createHash(alg).update(String(text), "utf8").digest()).map((b) => (b > 127 ? b - 256 : b)),
      getUuid: uuid || (() => nodeCrypto.randomUUID()),
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) }),
    },
    __as: as || null,
    __now: now ?? null,
  };
  vm.createContext(ctx);
  new vm.Script(gasSource + "\n" + OVERRIDES + `
    jsonOut_ = function (obj) { return obj; };
    authorizeSession_ = function () {
      const who = globalThis.__as || { email: OWNER_EMAIL, role: ROLE_EDITOR };
      return { ok: true, email: who.email, name: "", role: who.role, users: [] };
    };
    if (globalThis.__now !== null) Date.now = function () { return globalThis.__now; };
    globalThis.__save = function (contents) { return doPost({ postData: { contents: contents } }); };
  `, { filename: "AssetTrackerSync.gs" }).runInContext(ctx);

  const response = JSON.parse(JSON.stringify(ctx.__save(JSON.stringify(body))));
  const out = {};
  for (const name of new Set([...Object.keys(grids), ...Object.keys(sheets)])) out[name] = sheets[name] ? sheets[name]._grid() : grids[name];
  return { response, grids: out };
}
