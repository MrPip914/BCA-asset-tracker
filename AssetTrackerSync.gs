/**
 * BCA Asset Tracker — Google Sheets backend
 * ------------------------------------------
 * Paste this into Extensions > Apps Script for a Google Sheet, then
 * Deploy > New deployment > Web app (Execute as: Me, Access: Anyone with the link).
 *
 * Design: the app keeps its whole state in memory and sends the FULL
 * snapshot on every save (that's how it already works with its built-in
 * storage). So doPost() here just rewrites every tab from the payload,
 * and doGet() reads all tabs back into that same shape. Simple and
 * always consistent — the tradeoff is each save rewrites everything,
 * which is fine at this data size (tens to low hundreds of assets).
 *
 * Tabs created automatically on first run: Assets, Comments, Changes,
 * Allocations, AuditLog, Config.
 */

const SHEET_NAMES = {
  assets: "Assets",
  comments: "Comments",
  changes: "Changes",
  allocations: "Allocations",
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

function doGet(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const assetRows = readTable_(SHEET_NAMES.assets, ASSET_FIELDS);
    const commentRows = readTable_(SHEET_NAMES.comments, ["assetLabel", "text", "at", "by"]);
    const changeRows = readTable_(SHEET_NAMES.changes, ["assetLabel", "changeType", "vendor", "cost", "note", "at", "by"]);
    const allocationRows = readTable_(SHEET_NAMES.allocations, ["assetLabel", "room", "quantity"]);
    const auditRows = readTable_(SHEET_NAMES.audit, [
      "assetLabel", "assetType", "action", "field", "from", "to",
      "room", "quantity", "previousQuantity", "at", "by",
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
      };
    });

    const auditLog = auditRows.map(r => ({
      assetLabel: r.assetLabel, assetType: r.assetType, action: r.action,
      field: r.field || undefined, from: r.from || undefined, to: r.to || undefined,
      room: r.room || undefined, quantity: r.quantity === "" ? undefined : r.quantity,
      previousQuantity: r.previousQuantity === "" ? undefined : r.previousQuantity,
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

    // Assets tab: flat fields only.
    writeTable_(SHEET_NAMES.assets, ASSET_FIELDS, assets);

    // Child tables, flattened out with the parent asset's label as the key.
    const commentRows = [];
    const changeRows = [];
    const allocationRows = [];
    assets.forEach(a => {
      (a.comments || []).forEach(c => commentRows.push({ assetLabel: a.label, text: c.text, at: c.at, by: c.by || "" }));
      (a.changes || []).forEach(c => changeRows.push({
        assetLabel: a.label, changeType: c.changeType, vendor: c.vendor || "", cost: c.cost || "", note: c.note || "", at: c.at, by: c.by || "",
      }));
      (a.allocations || []).forEach(al => allocationRows.push({ assetLabel: a.label, room: al.room, quantity: al.quantity }));
    });
    writeTable_(SHEET_NAMES.comments, ["assetLabel", "text", "at", "by"], commentRows);
    writeTable_(SHEET_NAMES.changes, ["assetLabel", "changeType", "vendor", "cost", "note", "at", "by"], changeRows);
    writeTable_(SHEET_NAMES.allocations, ["assetLabel", "room", "quantity"], allocationRows);

    writeTable_(
      SHEET_NAMES.audit,
      ["assetLabel", "assetType", "action", "field", "from", "to", "room", "quantity", "previousQuantity", "at", "by"],
      body.auditLog || []
    );

    writeTable_(SHEET_NAMES.config, ["key", "value"], [
      { key: "columns", value: JSON.stringify(body.columns || []) },
      { key: "changeTypes", value: JSON.stringify(body.changeTypes || []) },
      { key: "vendors", value: JSON.stringify(body.vendors || []) },
      { key: "peripheralsList", value: JSON.stringify(body.peripheralsList || []) },
      { key: "usersList", value: JSON.stringify(body.usersList || []) },
      { key: "bulkItemTypes", value: JSON.stringify(body.bulkItemTypes || []) },
    ]);

    return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
