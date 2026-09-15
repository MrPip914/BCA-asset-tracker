// Unit test for the site-wide Audit tab's filtering and sorting.
//
// The tab itself is a table like any other, and most of it would fail loudly if
// it broke. These are the rules that would fail SILENTLY -- the table would
// still render, still look right, and quietly not be an audit any more:
//
//   1. An entry whose asset is GONE must survive. Audit entries deliberately
//      outlive the assets they describe, and a permanently deleted asset's
//      history is the one thing no other screen in the app can show. Filtering
//      rows down to those with a live asset is the obvious way to write this
//      (every other site-wide table does exactly that) and it would delete the
//      most valuable rows from the one place they appear.
//   2. An ARCHIVED asset's entries must survive. allMaintenanceRows and
//      allWorkRows both drop archived assets to match the Assets tab's default
//      Active view; copying that here hides "who archived this, and when", which
//      is precisely what someone opens an audit for.
//   3. The default order is NEWEST FIRST BY POSITION, not by timestamp. The log
//      is append-only so its append order IS its chronological order -- the same
//      fact auditIndex relies on. Sorting on `at` instead looks identical until
//      a row has a missing or skewed timestamp, and then it silently reorders
//      history.
//   4. A filter compares the STORED value, never the label on screen. Actions
//      are stored snake_case and shown prettified; comparing the pretty string
//      would match nothing and the table would just go empty.
//   5. Every column that resolves something for display sorts on the RESOLVED
//      string. That rule has already shipped broken twice in this app (`name`
//      when people gained parts, `person` when the name-order setting landed),
//      so Asset sorts on the resolved name and Details on the rendered sentence.
//   6. A window filter ("Last 7 days") excludes an entry whose date will not
//      parse, but "All time" -- the default -- shows it. Nothing is ever hidden
//      unless a window was asked for.
//
// Run: node test-frontend-audit.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function grabFn(name) {
  const i = src.indexOf(`function ${name}(`);
  if (i === -1) throw new Error(`${name} not found`);
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error(`${name} not closed`);
}
// A top-level const, whether it is a one-liner or a bracketed literal. Grabbed
// rather than restated here so the sentinel strings and the period vocabulary
// cannot drift out of step with the file that uses them.
function grabConst(name) {
  const i = src.indexOf(`const ${name} = `);
  if (i === -1) throw new Error(`${name} not found`);
  let j = src.indexOf('=', i) + 1;
  while (src[j] === ' ') j++;
  const close = { '[': ']', '{': '}' }[src[j]];
  if (!close) return src.slice(i, src.indexOf(';', i) + 1);
  let depth = 0;
  for (let n = j; n < src.length; n++) {
    if (src[n] === src[j]) depth++;
    else if (src[n] === close && --depth === 0) return src.slice(i, n + 1) + ';';
  }
  throw new Error(`${name} not closed`);
}

// The real functions out of the real file, not a copy of them. describeAudit
// comes along because auditSortValue renders the Details column through it.
const code = [
  grabConst('AUDIT_ALL_ACTIONS'), grabConst('AUDIT_ALL_USERS'),
  grabConst('AUDIT_ALL_TYPES'), grabConst('AUDIT_ALL_TIME'),
  grabConst('AUDIT_PERIOD_OPTIONS'),
  grabFn('describeAudit'), grabFn('auditActionLabel'), grabFn('withinAuditPeriod'),
  grabFn('auditSortValue'), grabFn('sortAuditRows'), grabFn('filterAuditRows'),
  'return { AUDIT_ALL_ACTIONS, AUDIT_ALL_USERS, AUDIT_ALL_TYPES, AUDIT_ALL_TIME, AUDIT_PERIOD_OPTIONS, auditActionLabel, withinAuditPeriod, auditSortValue, sortAuditRows, filterAuditRows };',
].join('\n');
const A = new Function(code)();

let passed = 0, failed = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : `\n        expected ${e}\n        got      ${a}`));
  ok ? passed++ : failed++;
}

// --- fixture ---------------------------------------------------------------
// Deliberately mixed, the way MOCK_SNAPSHOT is: a live asset, an ARCHIVED one,
// and an entry whose asset is GONE. A fixture of live active assets alone would
// pass every rule above while the two that matter were broken.
const NOW = Date.parse('2026-09-15T18:00:00.000Z');
const ago = days => new Date(NOW - days * 86400000).toISOString();

// The names deliberately sort in a DIFFERENT order from the ids (Alpha Monitor
// is BCA0009, Front Desk PC is BCA0001), or a sort reading the stored id would
// produce the same list as one reading the resolved name and rule 5 would be
// untestable here.
const assets = [
  { id: 'BCA0001', type: 'Computer', name: 'Front Desk PC', tag: 'BCA0001', status: 'Active' },
  { id: 'BCA0009', type: 'Monitor', name: 'Alpha Monitor', tag: 'BCA0009', status: 'Archived' },
];

// The shape allAuditRows builds. Type names are the ids here -- a built-in
// type's id IS its name, so that is what the real typeNameOf hands back too.
const entries = [
  { at: ago(10), by: 'Eric', assetLabel: 'BCA0001', assetType: 'Computer', action: 'created' },
  { at: ago(3), by: 'Eric', assetLabel: 'BCA0042', assetType: 'Phone', action: 'deleted' },
  { at: ago(2), by: 'Jen', assetLabel: 'BCA0001', assetType: 'Computer', action: 'edited', field: 'Serial', from: 'SN-AAA', to: 'SN-BBB' },
  { at: ago(1), by: 'Eric', assetLabel: 'BCA0009', assetType: 'Monitor', action: 'archived' },
  { at: ago(0), by: 'Jen', assetLabel: 'BCA0001', assetType: 'Computer', action: 'maintenance_completed', field: 'Filter clean', to: '2026-09-15' },
  // No parseable date at all -- a hand-edited row, or one written by something
  // that is not this app.
  { at: '', by: 'Eric', assetLabel: 'BCA0001', assetType: 'Computer', action: 'noted', note: 'moved to storage' },
];
const rows = entries.map((entry, idx) => {
  const asset = assets.find(a => a.id === entry.assetLabel) || null;
  const typeId = entry.assetType || (asset ? asset.type : '');
  return {
    idx, entry, asset, typeId, typeName: typeId,
    assetName: asset ? asset.name : `${typeId} ${entry.assetLabel}`.trim(),
  };
});

const NO_FILTER = {
  query: '', action: A.AUDIT_ALL_ACTIONS, by: A.AUDIT_ALL_USERS,
  type: A.AUDIT_ALL_TYPES, period: A.AUDIT_ALL_TIME, now: NOW,
  scopeId: null, inScope: () => true,
};
const f = over => A.filterAuditRows(rows, { ...NO_FILTER, ...over });
const idsOf = list => list.map(r => r.idx);

// --- rule 1: a deleted asset's history stays ------------------------------
eq('an entry whose asset is gone is kept', f({}).some(r => r.entry.assetLabel === 'BCA0042'), true);
eq('nothing is dropped with no filters set', f({}).length, rows.length);

// --- rule 2: an archived asset's history stays ----------------------------
eq('an archived asset\'s entries are kept', f({}).some(r => r.entry.assetLabel === 'BCA0009'), true);

// --- a scope is the ONE thing that drops an assetless row -----------------
eq('a scope drops the row with no asset to place',
  idsOf(f({ scopeId: 'BCR0006' })), [0, 2, 3, 4, 5]);
eq('a scope that matches nothing empties the table',
  f({ scopeId: 'BCR0006', inScope: () => false }).length, 0);

// --- rule 3: default order is append order, reversed ----------------------
eq('no sort means newest first, by position',
  idsOf(A.sortAuditRows(rows, null)), [5, 4, 3, 2, 1, 0]);
// idx 5 carries no date at all and idx 0 is the oldest; ordering by timestamp
// would put one of them somewhere else.
eq('the dateless entry still sorts as the newest, because it was appended last',
  A.sortAuditRows(rows, null)[0].idx, 5);

// --- rule 4: filters compare the stored value ------------------------------
eq('the action filter matches the stored snake_case value',
  idsOf(f({ action: 'maintenance_completed' })), [4]);
eq('the action filter does NOT match the label on screen',
  f({ action: 'Maintenance completed' }).length, 0);
eq('the user filter matches `by`', idsOf(f({ by: 'Jen' })), [2, 4]);
eq('the type filter matches the stored type id', idsOf(f({ type: 'Monitor' })), [3]);
eq('a deleted asset is still filterable by the type it WAS',
  idsOf(f({ type: 'Phone' })), [1]);

// --- the action label -----------------------------------------------------
eq('snake_case prettifies', A.auditActionLabel('maintenance_completed'), 'Maintenance completed');
eq('a one-word action prettifies', A.auditActionLabel('archived'), 'Archived');
eq('an empty action does not render as blank', A.auditActionLabel(''), '—');

// --- rule 5: sorts read the resolved string -------------------------------
eq('Asset sorts on the resolved name, not the stored id',
  A.sortAuditRows(rows.filter(r => r.idx !== 5), { key: 'asset', dir: 'asc' }).map(r => r.assetName),
  ['Alpha Monitor', 'Front Desk PC', 'Front Desk PC', 'Front Desk PC', 'Phone BCA0042']);
eq('Details sorts on the rendered sentence',
  A.auditSortValue(rows[2], 'detail'), 'serial changed from "sn-aaa" to "sn-bbb"');
eq('Action sorts on the label, which is what the cell shows',
  A.auditSortValue(rows[4], 'action'), 'maintenance completed');
eq('Date sorts on the raw ISO string', A.auditSortValue(rows[0], 'at'), entries[0].at);
// Equal values must not shuffle: the tiebreak is position, newest first.
eq('an explicit sort breaks ties by position, newest first',
  A.sortAuditRows(rows, { key: 'by', dir: 'asc' }).map(r => r.idx), [5, 3, 1, 0, 4, 2]);

// --- rule 6: windows, and the unparseable date ----------------------------
eq('All time shows the entry with no usable date',
  A.withinAuditPeriod('', A.AUDIT_ALL_TIME, NOW), true);
eq('a window excludes the entry with no usable date',
  A.withinAuditPeriod('', '7', NOW), false);
eq('a window keeps what falls inside it', A.withinAuditPeriod(ago(2), '7', NOW), true);
eq('a window drops what falls outside it', A.withinAuditPeriod(ago(10), '7', NOW), false);
eq('Today is the local day boundary, not 24 rolling hours',
  A.withinAuditPeriod(new Date(NOW).toISOString(), 'today', NOW), true);
eq('the last 7 days, through the filter', idsOf(f({ period: '7' })), [1, 2, 3, 4]);
eq('every period option has a label',
  A.AUDIT_PERIOD_OPTIONS.every(o => o.value && o.label), true);

// --- search ---------------------------------------------------------------
eq('search matches the resolved asset name', idsOf(f({ query: 'front desk' })), [0, 2, 4, 5]);
eq('search matches the prettified action', idsOf(f({ query: 'maintenance completed' })), [4]);
eq('search matches a raw field value', idsOf(f({ query: 'sn-bbb' })), [2]);
eq('search matches the note on a `noted` entry', idsOf(f({ query: 'storage' })), [5]);
eq('search finds a deleted asset by the label it used to carry',
  idsOf(f({ query: 'bca0042' })), [1]);
eq('search matches the user', idsOf(f({ query: 'jen' })), [2, 4]);
eq('search is trimmed and case-insensitive', idsOf(f({ query: '  JEN  ' })), [2, 4]);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
