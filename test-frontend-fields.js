// Unit test for the field data-type layer (TYPE_MANAGEMENT_PLAN.md, phase 1).
//
// Four rules here fail SILENTLY if they regress, which is why they are tested
// rather than eyeballed:
//
//   1. columnDataType() must resolve stored override -> shipped default -> text,
//      IN THAT ORDER. Get the order wrong and either every user's choice is
//      ignored (the default always wins) or the shipped dates stop being dates
//      the moment a config is stored. Neither says anything on screen: the form
//      just renders a plain text box, which is what it always did.
//   2. An UNKNOWN dataType must fall back, not pass through. A config carrying a
//      type this build doesn't have — written by a newer build, or by hand —
//      would otherwise reach Field and render nothing at all.
//   3. validateColumnValue() must treat BLANK as valid for every type. "Must be
//      filled in" is the required rule, a different question; conflate them and
//      every optional date field on every asset refuses to save, with the form
//      blaming a field the user never touched.
//   4. applyFieldKind()'s rule — store a dataType only when it DIFFERS from the
//      shipped default — is what keeps the read-time fallback meaningful. Get it
//      wrong and today's defaults are baked into every sheet, so a later release
//      can never correct one.
//
// Run: node test-frontend-fields.js   (exits non-zero on failure)
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
function grabBlock(startsWith, endsWith) {
  const i = src.indexOf(startsWith);
  if (i === -1) throw new Error(`${startsWith} not found`);
  const j = src.indexOf(endsWith, i);
  return src.slice(i, j + endsWith.length);
}

// The REAL constants and the REAL functions, sliced out of index.html rather
// than restated here — a copy of the rules would pass while the app was broken.
const code = [
  grabBlock('const COLUMN_DATA_TYPES = [', '\n];'),
  'const COLUMN_DATA_TYPE_VALUES = new Set(COLUMN_DATA_TYPES.map(t => t.value));',
  grabBlock('const DEFAULT_COLUMN_DATA_TYPES = {', '\n};'),
  grabFn('columnDataType'),
  grabFn('columnOptions'),
  grabFn('dateOnly'),
  grabFn('validateColumnValue'),
  grabFn('applyFieldKind'),
  'module.exports = { columnDataType, columnOptions, validateColumnValue, applyFieldKind, COLUMN_DATA_TYPES, DEFAULT_COLUMN_DATA_TYPES };',
].join('\n');

const mod = { exports: {} };
try {
  new Function('module', code)(mod);
} catch (e) {
  console.error('Could not evaluate the extracted helpers:\n  ' + e.message);
  process.exit(1);
}
const { columnDataType, columnOptions, validateColumnValue, applyFieldKind, DEFAULT_COLUMN_DATA_TYPES } = mod.exports;

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};

// --- 1. the resolution order -----------------------------------------------
check('a stored override wins over the shipped default',
  columnDataType({ key: 'purchaseDate', dataType: 'text' }) === 'text',
  'the user changed it; the shipped default must not override the person');
check('a shipped default applies with nothing stored',
  columnDataType({ key: 'purchaseDate' }) === 'date',
  'this is what gives Purchase Date a real date picker with no migration');
check('warrantyUntil is a date by default', columnDataType({ key: 'warrantyUntil' }) === 'date');
check('totalQuantity is a number by default', columnDataType({ key: 'totalQuantity' }) === 'number');
check('notes is long text by default', columnDataType({ key: 'notes' }) === 'textarea');
check('an unlisted column is plain text',
  columnDataType({ key: 'serial' }) === 'text',
  'text is what every one of these fields was before data types existed');
check('screenSize is deliberately NOT a number',
  columnDataType({ key: 'screenSize' }) === 'text',
  'it holds 24", which the add form has always suggested as its placeholder');
check('a custom column with no dataType is text',
  columnDataType({ key: 'warranty_contact', custom: true }) === 'text');
check('a missing column object does not throw', columnDataType(undefined) === 'text');

// --- 2. an unknown stored type falls back, it does not pass through ---------
check('an unknown dataType falls back to the shipped default',
  columnDataType({ key: 'purchaseDate', dataType: 'datetime-local' }) === 'date',
  'a config written by a newer build must not reach Field with a type it cannot render');
check('...and to text when there is no shipped default',
  columnDataType({ key: 'serial', dataType: 'colour' }) === 'text');

// --- 3. validation ----------------------------------------------------------
const numCol = { key: 'totalQuantity', label: 'Total Qty' };
const dateCol = { key: 'purchaseDate', label: 'Purchase Date' };
const pickCol = { key: 'condition', label: 'Condition', dataType: 'select', options: ['Good', 'Fair'] };

// Blank is the required rule's business, not this one's.
[numCol, dateCol, pickCol, { key: 'serial', label: 'Serial' }].forEach(c => {
  check(`blank passes for ${columnDataType(c)}`, validateColumnValue(c, '') === '');
  check(`whitespace-only passes for ${columnDataType(c)}`, validateColumnValue(c, '   ') === '');
  check(`undefined passes for ${columnDataType(c)}`, validateColumnValue(c, undefined) === '');
});

check('zero is a valid number', validateColumnValue(numCol, '0') === '',
  'a falsy-but-present value must not be treated as absent');
check('a negative number is valid', validateColumnValue(numCol, '-4') === '');
check('a decimal is valid', validateColumnValue(numCol, '2.5') === '');
check('text is refused as a number', validateColumnValue(numCol, 'twelve') !== '');
check('...and the message names the field',
  validateColumnValue(numCol, 'twelve').includes('Total Qty'));

check('a plain yyyy-MM-dd date is valid', validateColumnValue(dateCol, '2026-06-03') === '');
check('an ISO timestamp is valid, not refused',
  validateColumnValue(dateCol, '2026-06-03T07:00:00.000Z') === '',
  'that is a real date the Sheet round-tripped oddly, not bad data — see dateOnly');
check('a US-style date is refused', validateColumnValue(dateCol, '06/03/2026') !== '');
check('an impossible date is refused', validateColumnValue(dateCol, '2026-02-31') !== '');

check('a listed choice is valid', validateColumnValue(pickCol, 'Good') === '');
check('an unlisted choice is refused', validateColumnValue(pickCol, 'Excellent') !== '');
check('...and the message lists the real choices',
  validateColumnValue(pickCol, 'Excellent').includes('Good, Fair'));
check('a choice list with NO options accepts anything',
  validateColumnValue({ key: 'x', label: 'X', dataType: 'select', options: [] }, 'anything') === '',
  'refusing here would make a misconfigured column unsaveable with no way to fix it from the form');

check('columnOptions drops blank entries',
  JSON.stringify(columnOptions({ options: ['Good', '', '  ', 'Fair'] })) === '["Good","Fair"]');
check('columnOptions on a column with none is empty',
  columnOptions({ key: 'serial' }).length === 0);

// --- 4. what actually gets STORED ------------------------------------------
{
  const c = { key: 'purchaseDate', label: 'Purchase Date' };
  applyFieldKind(c, 'date', '');
  check('choosing the shipped default stores NO override', !('dataType' in c),
    'storing it would bake today default into every sheet and freeze it there');

  const c2 = { key: 'purchaseDate', label: 'Purchase Date', dataType: 'text' };
  applyFieldKind(c2, 'date', '');
  check('...and an existing override is REMOVED when it returns to the default',
    !('dataType' in c2), 'otherwise "reset to default" leaves the override behind');

  const c3 = { key: 'serial', label: 'Serial' };
  applyFieldKind(c3, 'number', '');
  check('choosing something else DOES store an override', c3.dataType === 'number');

  const c4 = { key: 'serial', label: 'Serial' };
  applyFieldKind(c4, 'nonsense', '');
  check('an unknown kind stores nothing rather than corrupting the column',
    !('dataType' in c4));

  const c5 = { key: 'condition', label: 'Condition' };
  applyFieldKind(c5, 'select', 'Good\nFair\n\n  Needs replacing  \nGood');
  check('choices are split per LINE, trimmed and de-duplicated',
    JSON.stringify(c5.options) === '["Good","Fair","Needs replacing"]',
    `got ${JSON.stringify(c5.options)}`);

  const c6 = { key: 'condition', label: 'Condition', dataType: 'select', options: ['Good'] };
  applyFieldKind(c6, 'text', 'Good');
  check('switching away from a choice list DROPS its options',
    !('options' in c6),
    'otherwise switching back would silently resurrect a stale list');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
