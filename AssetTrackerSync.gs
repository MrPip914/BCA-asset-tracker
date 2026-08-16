/**
 * BCA Asset Tracker — Google Sheets backend
 * ------------------------------------------
 * Paste this into Extensions > Apps Script for a Google Sheet, then
 * Deploy > New deployment > Web app (Execute as: Me, Access: Anyone with the link).
 *
 * Design: the app keeps its whole state in memory and sends the FULL
 * snapshot on every save (that's how it already works with its built-in
 * storage), and doGet() reads all tabs back into that same shape. Simple
 * and always consistent at this data size (tens to low hundreds of assets).
 *
 * doPost() rewrites the Assets/Comments/Changes/Allocations/Maintenance
 * tabs together, but only when the client reports (`body._dirty.assets`)
 * that asset-related data actually changed — most config-only actions
 * (managed-list edits, adding a custom column) don't touch these at all.
 * Config is similarly gated on `body._dirty.config`. AuditLog is handled
 * differently: since audit entries are only ever appended to, never edited
 * or deleted, it's appended-to (`appendNewRows_`) rather than rewritten,
 * so an ever-growing history doesn't get more expensive to save over time.
 * Missing `_dirty` (an older client, or a direct API call) defaults to
 * "rewrite everything" — the original behavior, kept as the safe fallback.
 *
 * Every save is a FULL overwrite of the domains it touches, so a client
 * saving a snapshot it loaded before someone else's save would silently drop
 * that other person's work. Each of those same three domains therefore carries
 * a revision counter in the Config tab: doGet hands them out, the client posts
 * back the ones it loaded, and doPost — inside the same lock as the writes —
 * refuses the whole save if any domain it's about to write has moved on since.
 * See "Optimistic concurrency" in doPost. A payload with no `_revisions` (an
 * older client, or a direct API call) is still accepted and written, the same
 * fallback philosophy as a missing `_dirty`.
 *
 * Tabs created automatically on first run: Assets, Comments, Changes,
 * Allocations, Maintenance, Breakers, Circuits, BreakerTypes, AuditLog, Config.
 */

// Bump this (number + short description) any time this file changes, so a
// stuck deployment is obvious instead of silently serving stale logic.
// Two ways to check what's actually LIVE (not just what's pasted in the
// editor — those can differ if "New version" wasn't created on deploy):
//   1. Visit the deployed /exec URL directly in a browser and Ctrl+F for
//      "scriptVersion" in the raw JSON.
//   2. Compare this string to SCRIPT_VERSION at the top of index.html.
const SCRIPT_VERSION = "v13 (2026-08-16) — Circuits gain a panelLabel column, so a circuit can belong to a panel without belonging to a breaker: doGet attaches circuits with a breakerId to that breaker exactly as before, and returns the ones with an empty breakerId whose panelLabel matches as the panel's new unassignedCircuits array; doPost writes panelLabel on EVERY circuit row (nested and unassigned alike), always derived from the panel being iterated so it can never disagree with the breaker's own panel";

const SHEET_NAMES = {
  assets: "Assets",
  comments: "Comments",
  changes: "Changes",
  allocations: "Allocations",
  maintenance: "Maintenance",
  breakers: "Breakers",
  circuits: "Circuits",
  breakerTypes: "BreakerTypes",
  audit: "AuditLog",
  config: "Config",
};

// Flat fields stored directly as Asset columns (everything except the
// per-asset arrays, which live in their own tabs keyed by asset label).
// "room"/"building" hold a Room/Building asset's own display name (only
// meaningful on that asset's own row). Every OTHER asset that's located in a
// room, or a Room that belongs to a building, points at it via roomId/
// buildingId — the referenced asset's stable `label`, not its mutable name —
// so renaming a Room/Building needs no cascade across other rows.
const ASSET_FIELDS = [
  "label", "type", "itemName", "screenSize", "hostname", "room", "building", "roomId", "buildingId",
  "brand", "model", "serial", "person", "peripherals", "notes",
  "totalQuantity", "purchaseDate", "warrantyUntil", "status",
  "panelSlotCount", "panelLayout",
];

// Breakers are scoped to a Panel asset (panelLabel); Circuits are scoped to a
// Breaker (breakerId), not directly to the Panel — chain is Circuit -> Breaker
// -> Panel. Both need a real id (not array position) since they get swapped/
// moved and other records point at them.
//
// Every physical slot has two halves, addressed "Na"/"Nb" (e.g. "1a", "1b") —
// a Breaker's footprint is the set of half-cells it occupies, not a list of
// whole slot numbers. A basic single-pole breaker in slot 1 is cells
// ["1a","1b"]; a double-pole across slots 1/3 is ["1a","1b","3a","3b"]; a
// tandem pair is two breaker rows, cells ["1a"] and ["1b"]. Poles are NOT
// stored — derived from the count of distinct slots a breaker's cells touch
// (see BREAKER_TYPES_ARCHITECTURE.md section 2). This one addressing scheme
// covers every breaker shape (single, double-pole, tandem, quad, and mixed
// offset configurations) without a separate "mount" enum.
//
// A multi-breaker unit (tandem, quad, or any BreakerType with >1 member) is a
// GROUP of individual Breaker rows, each with its own id, cells, ampRating,
// status, etc., created together and linked by a shared "groupId" (blank for
// a standalone breaker not placed from a multi-member type). Circuits attach
// to these rows exactly like any other breaker (via breakerId) — no separate
// per-circuit bookkeeping needed.
//
// "breakerTypeId" records which BreakerTypes catalog entry a breaker was
// placed from, for display only (e.g. a "Tandem" badge) — not a live link;
// editing a placed breaker never touches the type or its sibling rows.
const BREAKER_FIELDS = ["id", "panelLabel", "cells", "ampRating", "status", "serial", "installedDate", "notes", "groupId", "breakerTypeId"];
// "notes" is the free-text, multi-line "what's actually connected" field — it can
// contain embedded newlines (one callout per line), which Sheets stores fine in a
// single cell. The legacy "description" column is gone: the frontend collapsed the
// old label/description pair down to `label` alone, so nothing reads or writes it.
//
// "panelLabel" is the circuit's OWN link to its panel, not a copy of the breaker's.
// A circuit's panel used to be implied entirely by its breaker (breakerId -> that
// Breaker row's panelLabel), which left no way to record a circuit that exists but
// isn't wired to a breaker yet — the thing "unassigned circuits" are. So the panel
// is now stored on the circuit directly: a row with a breakerId is attached to that
// breaker as before, and a row with an EMPTY breakerId belongs to the panel named
// here and nothing else. panelLabel is the authoritative panel either way (doPost
// always derives it from the panel it's iterating, so it can't drift from the
// breaker's), which also means moving a circuit between breakers on one panel never
// has to touch it. No migration is needed for rows written before this column
// existed: every one of them has a breakerId, so they still attach to their breaker
// on read, and each gets its panelLabel filled in the next time the panel is saved.
const CIRCUIT_FIELDS = ["id", "breakerId", "panelLabel", "label", "roomsServed", "feedsPanelLabel", "notes"];
// A user-defined catalog of reusable breaker configurations — see
// BREAKER_TYPES_ARCHITECTURE.md. "members" is a JSON-encoded array of
// { cells, ampRating }, where cells use RELATIVE slot indices (a type's own
// 1st/2nd/... slot, not real panel slot numbers) — resolved to absolute
// cells at placement time in the frontend. Global/shared across all panels,
// not scoped to any one asset — its own flat tab, like Breakers/Circuits.
const BREAKER_TYPE_FIELDS = ["id", "name", "slotSpan", "members"];

// --- Optimistic concurrency --------------------------------------------------
// One revision counter per save domain — the same three domains `_dirty`
// already describes. Per-domain rather than one global counter so two people
// editing unrelated things (a managed list vs an asset) never collide: only a
// domain this save actually writes can conflict.
const REVISION_DOMAINS = ["assets", "config", "breakerTypes"];
// Config-tab key each counter is stored under (rev_assets, rev_config,
// rev_breakerTypes), alongside nextAssetNumber. Prefixed so it can't collide
// with a managed-list key.
const REVISION_KEY_PREFIX = "rev_";

// The Config tab as a raw { key: cellValue } map — values are left as stored
// (JSON strings), NOT parsed, so keys this request isn't changing can be
// written straight back untouched when the tab gets rewritten.
function readConfigMap_() {
  const map = {};
  readTable_(SHEET_NAMES.config, ["key", "value"]).forEach(r => {
    if (r.key !== "" && r.key !== null && r.key !== undefined) map[r.key] = r.value;
  });
  return map;
}

// Current revision per domain. Missing/blank/garbage reads as 0 — which is
// also what a client with no stored revisions posts, so an existing sheet (or
// one last written by a backend predating this) starts out matched rather than
// conflicting on its very first save after deploy.
function readRevisions_(configMap) {
  const revisions = {};
  REVISION_DOMAINS.forEach(d => {
    const raw = Number(configMap[REVISION_KEY_PREFIX + d]);
    revisions[d] = isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  });
  return revisions;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function readTable_(name, headers) {
  const sheet = getSheet_(name);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const fileHeaders = values[0];
  return values.slice(1)
    .filter(row => row.some(cell => cell !== "" && cell !== null))
    .map(row => {
      const obj = {};
      fileHeaders.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });
}

function writeTable_(name, headers, rows) {
  const sheet = getSheet_(name);
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length > 0) {
    const data = rows.map(row => headers.map(h => (row[h] === undefined || row[h] === null ? "" : row[h])));
    // Force plain-text format before writing — otherwise Sheets auto-detects a
    // date-like string (e.g. a maintenance item's "yyyy-MM-dd" lastPerformed)
    // and silently converts the cell to a real Date, which then reads back as a
    // full ISO timestamp instead of the plain date string the app expects.
    const range = sheet.getRange(2, 1, data.length, headers.length);
    range.setNumberFormat("@");
    range.setValues(data);
  }
}

// Appends only the rows beyond what's already stored, instead of clearing and
// rewriting the whole tab — safe only for tables that are pure append logs
// (nothing ever edits or deletes an existing row). AuditLog is the only one
// that qualifies today. If the caller's array is shorter than or equal to
// what's already stored (a stale client, or nothing new), this is a no-op —
// it never truncates existing history.
function appendNewRows_(name, headers, rows) {
  const sheet = getSheet_(name);
  const lastRow = sheet.getLastRow();
  if (lastRow === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  const existingCount = Math.max(lastRow - 1, 0);
  if (rows.length <= existingCount) return;
  const newRows = rows.slice(existingCount);
  const data = newRows.map(row => headers.map(h => (row[h] === undefined || row[h] === null ? "" : row[h])));
  // See writeTable_'s comment — force text format so a date-like string doesn't
  // get silently converted to a real Date cell.
  const range = sheet.getRange(existingCount + 2, 1, data.length, headers.length);
  range.setNumberFormat("@");
  range.setValues(data);
}

function doGet(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const assetRows = readTable_(SHEET_NAMES.assets, ASSET_FIELDS);
    const commentRows = readTable_(SHEET_NAMES.comments, ["assetLabel", "text", "at", "by"]);
    const changeRows = readTable_(SHEET_NAMES.changes, ["assetLabel", "changeType", "vendor", "cost", "note", "at", "by"]);
    const allocationRows = readTable_(SHEET_NAMES.allocations, ["assetLabel", "room", "quantity"]);
    const maintenanceRows = readTable_(SHEET_NAMES.maintenance, [
      "assetLabel", "task", "frequencyLabel", "frequencyDays", "lastPerformed", "owner", "at", "by",
    ]);
    const breakerRows = readTable_(SHEET_NAMES.breakers, BREAKER_FIELDS);
    const circuitRows = readTable_(SHEET_NAMES.circuits, CIRCUIT_FIELDS);
    const breakerTypeRows = readTable_(SHEET_NAMES.breakerTypes, BREAKER_TYPE_FIELDS);
    const auditRows = readTable_(SHEET_NAMES.audit, [
      "assetLabel", "assetType", "action", "field", "from", "to",
      "room", "quantity", "previousQuantity", "note", "at", "by",
    ]);
    const configRows = readTable_(SHEET_NAMES.config, ["key", "value"]);

    const config = {};
    const configRaw = {};
    configRows.forEach(r => {
      configRaw[r.key] = r.value;
      config[r.key] = r.value ? JSON.parse(r.value) : null;
    });

    const assets = assetRows.map(a => {
      const label = a.label;
      return {
        ...a,
        comments: commentRows.filter(c => c.assetLabel === label).map(c => ({ text: c.text, at: c.at, by: c.by })),
        changes: changeRows.filter(c => c.assetLabel === label).map(c => ({
          changeType: c.changeType, vendor: c.vendor, cost: c.cost, note: c.note, at: c.at, by: c.by,
        })),
        allocations: allocationRows.filter(al => al.assetLabel === label).map(al => ({ roomId: al.room, quantity: al.quantity })),
        maintenanceItems: maintenanceRows.filter(m => m.assetLabel === label).map(m => ({
          task: m.task, frequencyLabel: m.frequencyLabel, frequencyDays: m.frequencyDays,
          lastPerformed: m.lastPerformed, owner: m.owner, at: m.at, by: m.by,
        })),
        // Only meaningful for Electrical Panel assets, but attached unconditionally
        // (like every other child array here) — no type check needed at this layer,
        // it's just an empty array for anything that isn't a panel.
        breakers: breakerRows.filter(b => b.panelLabel === label).map(b => ({
          id: b.id, panelLabel: b.panelLabel,
          cells: b.cells ? String(b.cells).split(",").map(s => s.trim()) : [],
          ampRating: b.ampRating, status: b.status,
          serial: b.serial, installedDate: b.installedDate, notes: b.notes,
          groupId: b.groupId, breakerTypeId: b.breakerTypeId,
          circuits: circuitRows.filter(c => c.breakerId === b.id).map(c => ({
            id: c.id, breakerId: c.breakerId, panelLabel: label, label: c.label,
            roomsServedIds: c.roomsServed ? String(c.roomsServed).split(",").map(s => s.trim()) : [],
            feedsPanelLabel: c.feedsPanelLabel, notes: c.notes,
          })),
        })),
        // Circuits that belong to this panel but aren't wired to any breaker yet.
        // Identified by an EMPTY breakerId plus a panelLabel naming this asset —
        // which is why panelLabel had to become a stored column: with the breaker
        // gone there's nothing else on the row that says which panel it's for.
        // Rows written before that column existed all have a breakerId, so none of
        // them can land here by accident.
        unassignedCircuits: circuitRows
          .filter(c => String(c.breakerId || "").trim() === "" && c.panelLabel === label)
          .map(c => ({
            id: c.id, breakerId: "", panelLabel: label, label: c.label,
            roomsServedIds: c.roomsServed ? String(c.roomsServed).split(",").map(s => s.trim()) : [],
            feedsPanelLabel: c.feedsPanelLabel, notes: c.notes,
          })),
      };
    });

    const auditLog = auditRows.map(r => ({
      assetLabel: r.assetLabel, assetType: r.assetType, action: r.action,
      field: r.field || undefined, from: r.from || undefined, to: r.to || undefined,
      room: r.room || undefined, quantity: r.quantity === "" ? undefined : r.quantity,
      previousQuantity: r.previousQuantity === "" ? undefined : r.previousQuantity,
      note: r.note || undefined,
      at: r.at, by: r.by,
    }));

    const breakerTypes = breakerTypeRows.map(t => ({
      id: t.id, name: t.name, slotSpan: t.slotSpan,
      members: t.members ? JSON.parse(t.members) : [],
    }));

    const payload = {
      scriptVersion: SCRIPT_VERSION,
      assets,
      auditLog,
      breakerTypes,
      columns: config.columns || null,
      changeTypes: config.changeTypes || null,
      vendors: config.vendors || null,
      peripheralsList: config.peripheralsList || null,
      usersList: config.usersList || null,
      bulkItemTypes: config.bulkItemTypes || null,
      typesList: config.typesList || null,
      // Monotonic counter for the next BCA asset number to issue — see
      // peekAssetNumber() in index.html. Not a managed list like the rest of
      // Config, just a number that has to survive asset deletion (deriving it
      // from the assets instead would reissue a permanently deleted asset's
      // label, and AuditLog rows keyed by that label outlive the asset).
      // null when never stored; the frontend seeds it from max+1 on first use.
      nextAssetNumber: config.nextAssetNumber || null,
      // Per-domain revision counters as of this read. The client holds onto
      // these and posts them back with every save; doPost rejects the save if
      // a domain it's about to write has moved on since. All zeros on a sheet
      // that has never been written by a v12+ backend.
      revisions: readRevisions_(configRaw),
    };

    // Plain fetch() from a browser is blocked by CORS here, since Apps Script
    // doesn't send Access-Control-Allow-Origin headers. A <script> tag isn't
    // subject to that restriction, so support JSONP: if the caller passes
    // ?callback=name, wrap the payload as a function call instead of raw JSON.
    const callback = e.parameter && e.parameter.callback;
    if (callback) {
      return ContentService
        .createTextOutput(`${callback}(${JSON.stringify(payload)});`)
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const body = JSON.parse(e.postData.contents);
    const assets = body.assets || [];
    // Which domains actually changed, as reported by the client (see persist()
    // in index.html — computed there by reference-equality against its current
    // state). Missing/absent _dirty (an older client, or a direct API call)
    // means "rewrite everything" — the safe default, same as before this existed.
    const dirty = body._dirty || { assets: true, config: true, breakerTypes: true };

    // --- Optimistic concurrency check ---------------------------------------
    // Deliberately inside the LockService critical section that already guards
    // the writes below: checking outside it would leave a window where someone
    // else's save lands between the check passing and this one writing, which
    // is the exact failure being prevented.
    //
    // Only domains this save is actually going to write are checked — a save
    // that touches assets doesn't care that a managed list moved on. A domain
    // the client didn't report a revision for isn't checked either, so an older
    // client (no `_revisions` at all) still writes, same fallback philosophy as
    // a missing `_dirty`.
    const configMap = readConfigMap_();
    const revisions = readRevisions_(configMap);
    const postedRevisions = body._revisions;
    if (postedRevisions) {
      const conflict = REVISION_DOMAINS.filter(d => {
        if (!dirty[d]) return false;
        const posted = Number(postedRevisions[d]);
        if (!isFinite(posted)) return false;
        return Math.floor(posted) !== revisions[d];
      });
      if (conflict.length) {
        // Write NOTHING — not the tabs, and not the audit rows either, since
        // those describe the very changes being rejected. Returning the current
        // revisions lets the client resync without a second round trip.
        return jsonOut_({ ok: false, conflict: conflict, revisions: revisions });
      }
    }

    if (dirty.assets) {
      // Assets tab: flat fields only.
      writeTable_(SHEET_NAMES.assets, ASSET_FIELDS, assets);

      // Child tables, flattened out with the parent asset's label as the key.
      const commentRows = [];
      const changeRows = [];
      const allocationRows = [];
      const maintenanceRows = [];
      const breakerRows = [];
      const circuitRows = [];
      assets.forEach(a => {
        (a.comments || []).forEach(c => commentRows.push({ assetLabel: a.label, text: c.text, at: c.at, by: c.by || "" }));
        (a.changes || []).forEach(c => changeRows.push({
          assetLabel: a.label, changeType: c.changeType, vendor: c.vendor || "", cost: c.cost || "", note: c.note || "", at: c.at, by: c.by || "",
        }));
        (a.allocations || []).forEach(al => allocationRows.push({ assetLabel: a.label, room: al.roomId, quantity: al.quantity }));
        (a.maintenanceItems || []).forEach(m => maintenanceRows.push({
          assetLabel: a.label, task: m.task, frequencyLabel: m.frequencyLabel, frequencyDays: m.frequencyDays,
          lastPerformed: m.lastPerformed || "", owner: m.owner || "", at: m.at, by: m.by || "",
        }));
        // panelLabel is derived from the parent asset here (not trusted from the
        // client payload), same as assetLabel is for every other child row above.
        (a.breakers || []).forEach(b => {
          breakerRows.push({
            id: b.id, panelLabel: a.label,
            cells: (b.cells || []).join(","),
            ampRating: b.ampRating, status: b.status, serial: b.serial || "",
            installedDate: b.installedDate || "", notes: b.notes || "",
            groupId: b.groupId || "", breakerTypeId: b.breakerTypeId || "",
          });
          // panelLabel comes from the panel being iterated, never from the
          // circuit's own payload — same rule as the breaker's above. That's what
          // keeps it from ever disagreeing with the breaker this circuit hangs off
          // of, since both are stamped from the one asset that contains them.
          (b.circuits || []).forEach(c => circuitRows.push({
            id: c.id, breakerId: b.id, panelLabel: a.label, label: c.label,
            roomsServed: (c.roomsServedIds || []).join(","), feedsPanelLabel: c.feedsPanelLabel || "",
            notes: c.notes || "",
          }));
        });
        // Same tab, same shape — just with no breaker to point at, so panelLabel is
        // the only thing tying the row to anything. doGet reads them straight back
        // as unassignedCircuits on this panel.
        (a.unassignedCircuits || []).forEach(c => circuitRows.push({
          id: c.id, breakerId: "", panelLabel: a.label, label: c.label,
          roomsServed: (c.roomsServedIds || []).join(","), feedsPanelLabel: c.feedsPanelLabel || "",
          notes: c.notes || "",
        }));
      });
      writeTable_(SHEET_NAMES.comments, ["assetLabel", "text", "at", "by"], commentRows);
      writeTable_(SHEET_NAMES.changes, ["assetLabel", "changeType", "vendor", "cost", "note", "at", "by"], changeRows);
      writeTable_(SHEET_NAMES.allocations, ["assetLabel", "room", "quantity"], allocationRows);
      writeTable_(
        SHEET_NAMES.maintenance,
        ["assetLabel", "task", "frequencyLabel", "frequencyDays", "lastPerformed", "owner", "at", "by"],
        maintenanceRows
      );
      writeTable_(SHEET_NAMES.breakers, BREAKER_FIELDS, breakerRows);
      writeTable_(SHEET_NAMES.circuits, CIRCUIT_FIELDS, circuitRows);
    }

    // Audit entries are only ever appended to client-side (never edited or
    // deleted), so this can just add what's new instead of rewriting the
    // whole — ever-growing — history on every save.
    appendNewRows_(
      SHEET_NAMES.audit,
      ["assetLabel", "assetType", "action", "field", "from", "to", "room", "quantity", "previousQuantity", "note", "at", "by"],
      body.auditLog || []
    );

    if (dirty.breakerTypes) {
      const breakerTypeRows = (body.breakerTypes || []).map(t => ({
        id: t.id, name: t.name, slotSpan: t.slotSpan, members: JSON.stringify(t.members || []),
      }));
      writeTable_(SHEET_NAMES.breakerTypes, BREAKER_TYPE_FIELDS, breakerTypeRows);
    }

    // --- Config tab + revision counters -------------------------------------
    // The Config tab is rewritten wholesale and the revision counters live in
    // it, so this now runs whenever ANY domain was written — not only on a
    // config change. When config itself isn't dirty, its stored rows are copied
    // straight back (raw cell values, unparsed, including any key this script
    // doesn't know about) so an asset-only save still leaves Config untouched
    // apart from the counters.
    const written = REVISION_DOMAINS.filter(d => dirty[d]);
    if (written.length) {
      const configRows = [];
      if (dirty.config) {
        // nextAssetNumber has to be re-stated on every config write or it'd be
        // dropped by an unrelated one (adding a vendor, say). Taking the max
        // against what's already stored keeps it monotonic server-side too: a
        // client that predates this key posts nothing for it, and a client that
        // loaded before someone else created an asset posts a stale, lower
        // value — either would otherwise walk the counter backwards and let a
        // deleted asset's label be reissued. (The revision check above makes
        // that second case a conflict now, but the max costs nothing and still
        // covers a client that posts no revisions at all.)
        const nextAssetNumber = Math.max(
          Number(body.nextAssetNumber) || 0,
          Number(configMap.nextAssetNumber) || 0
        );
        configRows.push({ key: "columns", value: JSON.stringify(body.columns || []) });
        configRows.push({ key: "changeTypes", value: JSON.stringify(body.changeTypes || []) });
        configRows.push({ key: "vendors", value: JSON.stringify(body.vendors || []) });
        configRows.push({ key: "peripheralsList", value: JSON.stringify(body.peripheralsList || []) });
        configRows.push({ key: "usersList", value: JSON.stringify(body.usersList || []) });
        configRows.push({ key: "bulkItemTypes", value: JSON.stringify(body.bulkItemTypes || []) });
        configRows.push({ key: "typesList", value: JSON.stringify(body.typesList || []) });
        configRows.push({ key: "nextAssetNumber", value: JSON.stringify(nextAssetNumber) });
      } else {
        Object.keys(configMap).forEach(k => {
          // Revision rows are re-added below with their new values.
          if (k.indexOf(REVISION_KEY_PREFIX) === 0) return;
          configRows.push({ key: k, value: String(configMap[k]) });
        });
      }
      // Bump only what was actually written, so an assets-only save doesn't
      // invalidate a config snapshot someone else is holding.
      written.forEach(d => { revisions[d] = revisions[d] + 1; });
      REVISION_DOMAINS.forEach(d => configRows.push({ key: REVISION_KEY_PREFIX + d, value: String(revisions[d]) }));
      writeTable_(SHEET_NAMES.config, ["key", "value"], configRows);
    }

    // The post-write revisions go back with the response so the client can keep
    // saving without a reload first — otherwise its very next save would post
    // the pre-bump numbers and conflict with its own write.
    return jsonOut_({ ok: true, revisions: revisions });
  } catch (err) {
    return jsonOut_({ ok: false, error: err.message });
  } finally {
    lock.releaseLock();
  }
}
