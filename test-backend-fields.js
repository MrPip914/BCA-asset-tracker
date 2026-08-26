// Unit test for AssetTrackerSync.gs's customColumnKeys_ — the function that
// decides which custom columns get written to the Assets tab.
//
// It exists because this is the one piece the usual check can't reach: Sandbox
// mode never contacts Apps Script, and the live backend needs a Google sign-in,
// so "open it in a browser and try it" cannot cover the write path that used to
// drop every custom column value. Reads the .gs as text and evaluates just this
// function, so there is nothing to keep in sync.
//
// Run: node test-backend-fields.js   (exits non-zero on failure)
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
const fieldsSrc = src.slice(src.indexOf('const ASSET_FIELDS = ['), src.indexOf('];', src.indexOf('const ASSET_FIELDS = [')) + 2);
const mod = {};
new Function('module', fieldsSrc + '\n' + grab('customColumnKeys_') + '\nmodule.ASSET_FIELDS = ASSET_FIELDS; module.f = customColumnKeys_;')(mod);
const { f, ASSET_FIELDS } = mod;

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : `\n        got ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
};

eq('custom columns from the request',
   f([{ key: 'name' }, { key: 'col_a', custom: true }, { key: 'col_b', custom: true }], {}),
   ['col_a', 'col_b']);

eq('non-custom columns ignored',
   f([{ key: 'brand' }, { key: 'notes' }], {}),
   []);

eq('falls back to stored config when the request carries none',
   f(undefined, { columns: JSON.stringify([{ key: 'col_z', custom: true }]) }),
   ['col_z']);

eq('a custom key shadowing a schema field is dropped',
   f([{ key: 'serial', custom: true }, { key: 'col_ok', custom: true }], {}),
   ['col_ok']);

eq('duplicate custom keys are deduped',
   f([{ key: 'col_a', custom: true }, { key: 'col_a', custom: true }], {}),
   ['col_a']);

eq('garbage config does not throw', f(undefined, { columns: '{not json' }), []);
eq('missing config does not throw', f(undefined, {}), []);
eq('null body and null config', f(null, null), []);

console.log(`\nASSET_FIELDS has ${ASSET_FIELDS.length} fields; none of the six removed ones:`,
  ['room','building','campus','roomId','buildingId','itemName'].filter(k => ASSET_FIELDS.includes(k)).length === 0);

// --- appendNewRows_ header reconcile (v27) -----------------------------------
//
// The AuditLog tab is the only one not rewritten by writeTable_, so its header
// row is written once and then left alone. Adding a column to AUDIT_FIELDS
// therefore has to widen that stored header, or appended values land under a
// blank header cell -- and readTable_, which keys off the SHEET's headers, reads
// every such column back as obj[""]. Nothing throws and the version check still
// matches, so this is only catchable here.
const auditSrc = src.slice(src.indexOf('const AUDIT_FIELDS = ['), src.indexOf('];', src.indexOf('const AUDIT_FIELDS = [')) + 2);

// Minimal fake of the Sheets API surface appendNewRows_ actually touches.
function fakeSheet(rows) {
  const grid = rows.map(r => r.slice());
  return {
    grid,
    getLastRow: () => grid.length,
    getLastColumn: () => (grid.length ? grid[0].length : 0),
    getRange(row, col, numRows, numCols) {
      return {
        setNumberFormat() { return this; },
        setValues(vals) {
          for (let i = 0; i < numRows; i++) {
            const r = row - 1 + i;
            while (grid.length <= r) grid.push([]);
            for (let j = 0; j < numCols; j++) grid[r][col - 1 + j] = vals[i][j];
          }
          return this;
        },
      };
    },
  };
}

const appendMod = {};
new Function('module', 'getSheet_', auditSrc + '\n' + grab('appendNewRows_') +
  '\nmodule.AUDIT_FIELDS = AUDIT_FIELDS; module.append = appendNewRows_;'
)(appendMod, () => appendMod._sheet);
const { append, AUDIT_FIELDS } = appendMod;

eq('`related` is the LAST audit column (positions of stored rows must not shift)',
   AUDIT_FIELDS[AUDIT_FIELDS.length - 1], 'related');

// A tab created before `related` existed: 12 headers, one data row.
const old = ['assetLabel','assetType','action','field','from','to','room','quantity','previousQuantity','note','at','by'];
appendMod._sheet = fakeSheet([old.slice(), ['BCA0001','Computer','edited','Parent','A','B','','','','','2026-01-01','eric']]);
append('AuditLog', AUDIT_FIELDS, [
  { assetLabel: 'BCA0001' },
  { assetLabel: 'BCA0002', action: 'edited', field: 'Parent', related: 'BCR0002:from,BCR0005:to', at: '2026-08-26', by: 'eric' },
]);
eq('a narrow stored header is widened to the new field list',
   appendMod._sheet.grid[0], AUDIT_FIELDS);
eq('the new column lands under its own header, not a blank one',
   appendMod._sheet.grid[2][AUDIT_FIELDS.indexOf('related')], 'BCR0002:from,BCR0005:to');
eq('the pre-existing row keeps its original column positions',
   appendMod._sheet.grid[1].slice(0, 12), ['BCA0001','Computer','edited','Parent','A','B','','','','','2026-01-01','eric']);

// An empty tab still gets its headers, as before.
appendMod._sheet = fakeSheet([]);
append('AuditLog', AUDIT_FIELDS, [{ assetLabel: 'BCA0003', related: 'BCR0001:at' }]);
eq('an empty tab is given the full header row', appendMod._sheet.grid[0], AUDIT_FIELDS);

// Already-wide header: nothing to do, and nothing clobbered.
appendMod._sheet = fakeSheet([AUDIT_FIELDS.slice(), ['BCA0001','','','','','','','','','','','','keep-me']]);
append('AuditLog', AUDIT_FIELDS, [{ assetLabel: 'BCA0001' }, { assetLabel: 'BCA0004' }]);
eq('an already-wide header leaves existing values alone',
   appendMod._sheet.grid[1][AUDIT_FIELDS.indexOf('related')], 'keep-me');

// Never shrink: this is an append-only log, so a shorter list must not drop a
// column that already holds values.
appendMod._sheet = fakeSheet([AUDIT_FIELDS.slice(), ['BCA0001','','','','','','','','','','','','keep-me']]);
append('AuditLog', old, [{ assetLabel: 'BCA0001' }, { assetLabel: 'BCA0005' }]);
eq('a shorter field list does not narrow the stored header',
   appendMod._sheet.grid[0].length, AUDIT_FIELDS.length);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
