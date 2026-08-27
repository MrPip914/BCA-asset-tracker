// Unit test for AssetTrackerSync.gs's admin import/wipe helpers — the CSV parse
// that "BCA Admin > Import inventory" runs, and the Config rewrite both menu
// items share.
//
// Same reason test-backend-fields.js exists: Sandbox never contacts Apps Script
// and the live backend needs a Google sign-in, so a browser cannot reach this
// path at all. And the cost of it being wrong is the whole inventory, since both
// callers clear every data tab before writing.
//
// The two things most worth pinning down:
//   - adminWriteConfig_ must COPY THROUGH keys it wasn't asked to change. It is
//     what preserves `authUsers`; a fixed key list there would lock everyone out
//     of the app except OWNER_EMAIL.
//   - adminParseAssetCsv_ must REFUSE rather than half-import. Every failure has
//     to throw before adminReplaceAll_ is reached, because that function's first
//     act is to empty the sheet.
//
// Reads the .gs as text and evaluates just these functions, so there is nothing
// to keep in sync.
//
// Run: node test-backend-admin.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'AssetTrackerSync.gs'), 'utf8');

const grab = (name) => {
  const i = src.indexOf(`function ${name}(`);
  if (i === -1) throw new Error(`${name} not found`);
  let depth = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
};
const constSrc = (decl) => {
  const i = src.indexOf(decl);
  if (i === -1) throw new Error(`${decl} not found`);
  return src.slice(i, src.indexOf('];', i) + 2);
};

// Stubs for the Apps Script globals these functions touch. UrlFetchApp and
// DriveApp are driven per-test; Utilities.parseCsv is the real RFC4180 behaviour
// we depend on.
let fetchResponse = { code: 200, body: '' };
const UrlFetchApp = {
  fetch: () => ({
    getResponseCode: () => fetchResponse.code,
    getContentText: () => fetchResponse.body,
  }),
};
// tabs maps a tab name to its grid, so a test can produce a missing tab as well
// as the happy path. getDisplayValues is what the real reader calls.
let tabs = {};
const SpreadsheetApp = {
  getActiveSpreadsheet: () => ({
    getSheetByName: (name) => tabs[name]
      ? { getDataRange: () => ({ getDisplayValues: () => tabs[name] }) }
      : null,
  }),
};
// Turns CSV text into the grid a tab would hand back, so the same fixtures drive
// both the tab path and the URL path.
const asGrid = (text) => Utilities.parseCsv(text);
const Utilities = {
  parseCsv: (s) => {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) {
        if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  },
};

let writtenConfig = null;
const SHEET_NAMES = { config: 'Config' };
const writeTable_ = (name, headers, rows) => { writtenConfig = rows; };

const tabNameSrc = src.slice(
  src.indexOf('const IMPORT_TAB_NAME'),
  src.indexOf(';', src.indexOf('const IMPORT_TAB_NAME')) + 1
);

const mod = {};
new Function(
  'module', 'UrlFetchApp', 'SpreadsheetApp', 'Utilities', 'SHEET_NAMES', 'writeTable_',
  constSrc('const ASSET_FIELDS = [') + '\n' +
  constSrc('const REVISION_DOMAINS = [') + '\n' +
  'const REVISION_KEY_PREFIX = "rev_";\n' +
  tabNameSrc + '\n' +
  grab('readRevisions_') + '\n' +
  grab('adminReadGrid_') + '\n' +
  grab('adminParseAssetCsv_') + '\n' +
  grab('adminWriteConfig_') + '\n' +
  'module.parse = adminParseAssetCsv_; module.writeConfig = adminWriteConfig_;' +
  'module.ASSET_FIELDS = ASSET_FIELDS; module.DEFAULT_NAME = IMPORT_TAB_NAME;'
)(mod, UrlFetchApp, SpreadsheetApp, Utilities, SHEET_NAMES, writeTable_);
const { parse, writeConfig, ASSET_FIELDS, DEFAULT_NAME } = mod;

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name +
    (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
};
const throws = (name, fn, re) => {
  let msg = null;
  try { fn(); } catch (e) { msg = e.message; }
  const ok = msg !== null && re.test(msg);
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name +
    (ok ? '' : `\n        got  ${msg === null ? 'no throw' : JSON.stringify(msg)}\n        want match ${re}`));
  ok ? pass++ : fail++;
};
// Default path: the data sits in the default tab and the prompt is left blank.
// Every parse test below therefore also exercises the tab branch.
const csv = (body, code = 200) => {
  fetchResponse = { code, body };
  tabs = {}; tabs[DEFAULT_NAME] = asGrid(body);
  return () => parse('');
};

/* ---- adminReadGrid_: where the data comes from -------------------------- */

// The whole point of the tab default: no new OAuth scope, and nothing published.
tabs = {}; tabs[DEFAULT_NAME] = asGrid('label,type\nBCA0009,Computer\n');
eq('a blank prompt reads the default tab', parse('').rows[0].label, 'BCA0009');

tabs = { Other: asGrid('label,type\nBCA0011,Phone\n') };
eq('a bare name reads that tab', parse('Other').rows[0].label, 'BCA0011');

// Must not fall through to getSheet_, which would CREATE an empty tab and then
// report "no data rows" — hiding the real answer, that the file never arrived.
tabs = {};
throws('a missing tab refuses, naming it',
  () => parse(''), new RegExp('no tab named "' + DEFAULT_NAME + '"'));
throws('a missing tab explains how to make one', () => parse(''), /File > Import/);

// A URL still works, but only when explicitly given.
tabs = {};
fetchResponse = { code: 200, body: 'label,type\nBCA0022,TV\n' };
eq('an explicit http URL is fetched', parse('https://example.test/a.csv').rows[0].label, 'BCA0022');

/* ---- adminParseAssetCsv_: refusing ------------------------------------- */

fetchResponse = { code: 404, body: '' };
throws('a non-200 URL refuses', () => parse('https://example.test/a.csv'), /HTTP 404/);
throws('an empty file refuses', csv('label,type\n'), /no data rows/);
throws('a header-less file refuses', csv('a,b,c\n1,2,3\n'), /Expected 'label' and 'type'/);
throws('a missing type column refuses', csv('label,name\nBCA0001,x\n'), /Expected 'label' and 'type'/);
throws('duplicate labels refuse',
  csv('label,type\nBCA0001,Computer\nBCA0002,Phone\nBCA0001,TV\n'), /Duplicate labels: BCA0001/);

/* ---- adminParseAssetCsv_: accepting ------------------------------------ */

const basic = csv('label,type\nBCA0001,Computer\nBCA0007,Phone\n')();
eq('parses every row', basic.rows.length, 2);
eq('nextAssetNumber is the highest BCA plus one', basic.nextAssetNumber, 8);
eq('summary counts by type', basic.summary, '1 Computer, 1 Phone');
eq('headers are the canonical ASSET_FIELDS order', basic.headers, ASSET_FIELDS);

// A BOM is what Sheets writes on export; folded into the first header it would
// make "label" unfindable and every import would refuse.
const bom = csv('﻿label,type\nBCA0001,Computer\n')();
eq('a UTF-8 BOM is stripped from the first header', bom.rows[0].label, 'BCA0001');

// The real file's shape: quoted commas inside personIds/peripherals, and a note
// containing a literal newline.
const real = csv(
  'label,type,personIds,peripherals,notes\r\n' +
  'BCA0001,Computer,"BCU0006,BCU0011","Keyboard,Mouse","line one\nline two"\r\n' +
  'BCA0002,Monitor,BCU0005,,\r\n'
)();
eq('a quoted comma stays inside one cell', real.rows[0].personIds, 'BCU0006,BCU0011');
eq('an embedded newline stays inside one cell', real.rows[0].notes, 'line one\nline two');
eq('peripherals are collected across rows and deduped',
  real.peripherals, ['Keyboard', 'Mouse']);

// Non-BCA labels consume no device number — Rooms/Users must not push the counter.
const mixed = csv('label,type\nBCR0001,Room\nBCU0001,User\nBCA0004,Phone\n')();
eq('only BCA labels advance nextAssetNumber', mixed.nextAssetNumber, 5);

// A blank row in the middle of a hand-edited file shouldn't become a ghost asset.
const blanks = csv('label,type\nBCA0001,Computer\n,,\nBCA0002,Phone\n')();
eq('blank rows are dropped', blanks.rows.length, 2);

// A custom column has to survive, appended after the canonical fields.
const custom = csv('label,type,col_warranty\nBCA0001,Computer,yes\n')();
eq('a custom column is appended after ASSET_FIELDS',
  custom.headers.slice(ASSET_FIELDS.length), ['col_warranty']);
eq('a custom column keeps its value', custom.rows[0].col_warranty, 'yes');

/* ---- adminWriteConfig_ -------------------------------------------------- */

const asRows = () => writtenConfig.reduce((m, r) => (m[r.key] = r.value, m), {});

writeConfig(
  { authUsers: '[{"email":"a@b.c","role":"editor"}]', typesList: '["Computer"]',
    usersList: '["Stale Name"]', rev_assets: '4', rev_config: '9', rev_breakerTypes: '2' },
  { usersList: '[]', nextAssetNumber: '94' }
);
const out = asRows();
eq('the access allowlist is copied through', out.authUsers, '[{"email":"a@b.c","role":"editor"}]');
eq('unrelated config is copied through', out.typesList, '["Computer"]');
eq('an overridden key takes the new value', out.usersList, '[]');
eq('a brand-new key is added', out.nextAssetNumber, '94');
eq('every revision counter is bumped',
  [out.rev_assets, out.rev_config, out.rev_breakerTypes], ['5', '10', '3']);
eq('no key is written twice',
  writtenConfig.length, new Set(writtenConfig.map(r => r.key)).size);

// A sheet last written by a backend predating the counters reads them as 0, so
// the first admin write has to put them at 1 rather than NaN.
writeConfig({ authUsers: '[]' }, {});
eq('missing counters start at 1',
  [asRows().rev_assets, asRows().rev_config, asRows().rev_breakerTypes], ['1', '1', '1']);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
