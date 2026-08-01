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
 * Tabs created automatically on first run: Assets, Comments, Changes,
 * Allocations, Maintenance, Breakers, Circuits, AuditLog, Config.
 */

const SHEET_NAMES = {
  assets: "Assets",
  comments: "Comments",
  changes: "Changes",
  allocations: "Allocations",
  maintenance: "Maintenance",
  breakers: "Breakers",
  circuits: "Circuits",
  audit: "AuditLog",
  config: "Config",
};

// Flat fields stored directly as Asset columns (everything except the
// per-asset arrays, which live in their own tabs keyed by asset label).
const ASSET_FIELDS = [
  "label", "type", "itemName", "screenSize", "hostname", "room", "building",
  "brand", "model", "serial", "person", "peripherals", "notes",
  "totalQuantity", "purchaseDate", "warrantyUntil", "status",
];

// Breakers are scoped to a Panel asset (panelLabel); Circuits are scoped to a
// Breaker (breakerId), not directly to the Panel — chain is Circuit -> Breaker
// -> Panel. Both need a real id (not array position) since they get swapped/
// moved and other records point at them.
const BREAKER_FIELDS = ["id", "panelLabel", "slots", "poles", "mount", "ampRating", "status", "serial", "installedDate", "notes"];
const CIRCUIT_FIELDS = ["id", "breakerId", "label", "description", "roomsServed", "feedsPanelLabel"];

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
    sheet.getRange(2, 1, data.length, headers.length).setValues(data);
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
  sheet.getRange(existingCount + 2, 1, data.length, headers.length).setValues(data);
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
    const auditRows = readTable_(SHEET_NAMES.audit, [
      "assetLabel", "assetType", "action", "field", "from", "to",
      "room", "quantity", "previousQuantity", "note", "at", "by",
    ]);
    const configRows = readTable_(SHEET_NAMES.config, ["key", "value"]);

    const config = {};
    configRows.forEach(r => { config[r.key] = r.value ? JSON.parse(r.value) : null; });

    const assets = assetRows.map(a => {
      const label = a.label;
      return {
        ...a,
        comments: commentRows.filter(c => c.assetLabel === label).map(c => ({ text: c.text, at: c.at, by: c.by })),
        changes: changeRows.filter(c => c.assetLabel === label).map(c => ({
          changeType: c.changeType, vendor: c.vendor, cost: c.cost, note: c.note, at: c.at, by: c.by,
        })),
        allocations: allocationRows.filter(al => al.assetLabel === label).map(al => ({ room: al.room, quantity: al.quantity })),
        maintenanceItems: maintenanceRows.filter(m => m.assetLabel === label).map(m => ({
          task: m.task, frequencyLabel: m.frequencyLabel, frequencyDays: m.frequencyDays,
          lastPerformed: m.lastPerformed, owner: m.owner, at: m.at, by: m.by,
        })),
        // Only meaningful for Electrical Panel assets, but attached unconditionally
        // (like every other child array here) — no type check needed at this layer,
        // it's just an empty array for anything that isn't a panel.
        breakers: breakerRows.filter(b => b.panelLabel === label).map(b => ({
          id: b.id, panelLabel: b.panelLabel,
          slots: b.slots ? String(b.slots).split(",").map(s => s.trim()) : [],
          poles: b.poles, mount: b.mount, ampRating: b.ampRating, status: b.status,
          serial: b.serial, installedDate: b.installedDate, notes: b.notes,
          circuits: circuitRows.filter(c => c.breakerId === b.id).map(c => ({
            id: c.id, breakerId: c.breakerId, label: c.label, description: c.description,
            roomsServed: c.roomsServed ? String(c.roomsServed).split(",").map(s => s.trim()) : [],
            feedsPanelLabel: c.feedsPanelLabel,
          })),
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

    const payload = {
      assets,
      auditLog,
      columns: config.columns || null,
      changeTypes: config.changeTypes || null,
      vendors: config.vendors || null,
      peripheralsList: config.peripheralsList || null,
      usersList: config.usersList || null,
      bulkItemTypes: config.bulkItemTypes || null,
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
    const dirty = body._dirty || { assets: true, config: true };

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
        (a.allocations || []).forEach(al => allocationRows.push({ assetLabel: a.label, room: al.room, quantity: al.quantity }));
        (a.maintenanceItems || []).forEach(m => maintenanceRows.push({
          assetLabel: a.label, task: m.task, frequencyLabel: m.frequencyLabel, frequencyDays: m.frequencyDays,
          lastPerformed: m.lastPerformed || "", owner: m.owner || "", at: m.at, by: m.by || "",
        }));
        // panelLabel is derived from the parent asset here (not trusted from the
        // client payload), same as assetLabel is for every other child row above.
        (a.breakers || []).forEach(b => {
          breakerRows.push({
            id: b.id, panelLabel: a.label,
            slots: (b.slots || []).join(","), poles: b.poles, mount: b.mount,
            ampRating: b.ampRating, status: b.status, serial: b.serial || "",
            installedDate: b.installedDate || "", notes: b.notes || "",
          });
          (b.circuits || []).forEach(c => circuitRows.push({
            id: c.id, breakerId: b.id, label: c.label, description: c.description || "",
            roomsServed: (c.roomsServed || []).join(","), feedsPanelLabel: c.feedsPanelLabel || "",
          }));
        });
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

    if (dirty.config) {
      writeTable_(SHEET_NAMES.config, ["key", "value"], [
        { key: "columns", value: JSON.stringify(body.columns || []) },
        { key: "changeTypes", value: JSON.stringify(body.changeTypes || []) },
        { key: "vendors", value: JSON.stringify(body.vendors || []) },
        { key: "peripheralsList", value: JSON.stringify(body.peripheralsList || []) },
        { key: "usersList", value: JSON.stringify(body.usersList || []) },
        { key: "bulkItemTypes", value: JSON.stringify(body.bulkItemTypes || []) },
      ]);
    }

    return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
