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
