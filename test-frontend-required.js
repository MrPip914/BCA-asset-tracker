// Unit test for required fields (TYPE_MANAGEMENT_PLAN.md, phase 3).
//
// Four rules here fail SILENTLY, or worse, if they regress:
//
//   1. fieldValueIsEmpty() must test EMPTINESS, not falsiness. A quantity of 0
//      and a value of "0" are filled in; treat them as blank and a required
//      Total Qty makes every zero-quantity bulk item unsaveable, while the form
//      insists a field that visibly holds 0 is empty.
//   2. ...and it must know the three fields that don't store a plain string:
//      the parent is `parentId`, the people are `personIds` (an array) or the
//      legacy slash-joined `person`. Miss one and that field reads as blank on
//      every asset, so a rule about it refuses every save in the app.
//   3. missingRequiredFields() must ignore a field the TYPE doesn't have. A
//      stale rule naming an excluded field would refuse every save with nothing
//      on screen to fix — the field isn't rendered.
//   4. ...and it must return them ALL, not the first. Reporting one blank at a
//      time turns finishing a half-filled form into four rejected saves.
//
// Run: node test-frontend-required.js   (exits non-zero on failure)
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

// The registry names lucide icon components; stub whatever it names, derived
// from the source rather than listed here.
const registrySrc = grabBlock('const TYPE_REGISTRY = {', '\n};');
const iconStubs = [...new Set(
  [...registrySrc.matchAll(/\bicon:\s*([A-Z]\w*)/g)].map(m => m[1])
)].map(n => `const ${n} = null;`).join('\n');

// The REAL registry, the REAL field rules. TYPE_SETTINGS is writable here so a
// test can install a rule the way the type editor would.
const code = [
  iconStubs,
  'let TYPE_SETTINGS = {};',
  'let TYPE_FIELD_COLUMNS = [];',
  registrySrc,
  'let DERIVED_TYPE_SETS = { restrictedFields: new Set(), placeTypes: new Set() };',
  grabFn('recomputeDerivedTypeSets'),
  grabFn('typeEntryFor'),
  'recomputeDerivedTypeSets();',
  grabBlock('const TYPE_STRUCTURAL_FIELDS = new Set(', ');'),
  grabFn('restrictedFields'),
  grabFn('fieldAppliesTo'),
  grabFn('requiredFieldsFor'),
  grabFn('isRequiredField'),
  grabFn('fieldValueIsEmpty'),
  grabFn('missingRequiredFields'),
  grabFn('missingRequiredMessage'),
  `function setRule(typeId, keys) { TYPE_SETTINGS[typeId] = { requiredFields: keys }; recomputeDerivedTypeSets(); }`,
  `function clearRules() { TYPE_SETTINGS = {}; recomputeDerivedTypeSets(); }`,
  'module.exports = { fieldValueIsEmpty, missingRequiredFields, missingRequiredMessage, isRequiredField, requiredFieldsFor, setRule, clearRules, fieldAppliesTo };',
].join('\n');

const mod = { exports: {} };
try {
  new Function('module', code)(mod);
} catch (e) {
  console.error('Could not evaluate the extracted helpers:\n  ' + e.message);
  process.exit(1);
}
const { fieldValueIsEmpty, missingRequiredFields, missingRequiredMessage, isRequiredField, requiredFieldsFor, setRule, clearRules } = mod.exports;

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};

const COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'type', label: 'Type' },
  { key: 'parent', label: 'Path' },
  { key: 'status', label: 'Status' },
  { key: 'serial', label: 'Serial' },
  { key: 'hostname', label: 'Hostname' },
  { key: 'person', label: 'User' },
  { key: 'peripherals', label: 'Peripherals' },
  { key: 'totalQuantity', label: 'Total Qty' },
  { key: 'purchaseDate', label: 'Purchase Date' },
];

// --- 1. emptiness, not falsiness -------------------------------------------
check('"0" is filled in', fieldValueIsEmpty('totalQuantity', { totalQuantity: '0' }) === false,
  'a required quantity of zero must be saveable');
check('the number 0 is filled in', fieldValueIsEmpty('totalQuantity', { totalQuantity: 0 }) === false);
check('an empty string is blank', fieldValueIsEmpty('serial', { serial: '' }) === true);
check('whitespace only is blank', fieldValueIsEmpty('serial', { serial: '   ' }) === true);
check('a missing key is blank', fieldValueIsEmpty('serial', {}) === true);
check('normal text is filled in', fieldValueIsEmpty('serial', { serial: 'ABC123' }) === false);

// --- 2. the three fields that aren't plain strings --------------------------
check('the parent reads parentId, not parent',
  fieldValueIsEmpty('parent', { parentId: 'BCR0006' }) === false,
  'reading draft.parent would report every placed asset as unplaced');
check('...and an unset parent is blank', fieldValueIsEmpty('parent', { parentId: '' }) === true);
check('people read personIds when set',
  fieldValueIsEmpty('person', { personIds: ['u1'], person: '' }) === false);
check('...an empty personIds falls back to the legacy name',
  fieldValueIsEmpty('person', { personIds: [], person: 'Jen Kramer' }) === false,
  'an un-converted sheet stores the name only; ignoring it makes every one look unassigned');
check('...and neither means blank',
  fieldValueIsEmpty('person', { personIds: [], person: '' }) === true);
check('an array of empty strings is blank',
  fieldValueIsEmpty('person', { personIds: ['', null] }) === true);
check('peripherals is a slash-joined string',
  fieldValueIsEmpty('peripherals', { peripherals: 'Keyboard/Mouse' }) === false);

// --- 3. rules only apply to fields the type actually has --------------------
clearRules();
check('nothing is required as shipped', requiredFieldsFor('Computer').length === 0,
  'a rule must only exist because someone set it');

setRule('Computer', ['serial', 'hostname']);
{
  const missing = missingRequiredFields({ type: 'Computer' }, COLUMNS);
  check('both blanks are reported, not just the first', missing.length === 2,
    `got ${JSON.stringify(missing.map(c => c.key))}`);
  check('...in form order', missing[0].key === 'serial' && missing[1].key === 'hostname');
  const filled = missingRequiredFields({ type: 'Computer', serial: 'X', hostname: 'pc-1' }, COLUMNS);
  check('a filled form reports nothing', filled.length === 0);
}

// hostname is restricted to Computer, so a Monitor doesn't have it at all.
setRule('Monitor', ['hostname']);
check('a rule naming a field the type lacks is ignored',
  missingRequiredFields({ type: 'Monitor' }, COLUMNS).length === 0,
  'the field is not rendered, so refusing over it would be a dead end');
check('isRequiredField agrees', isRequiredField('hostname', 'Monitor') === false);

// A Room excludes serial by default.
setRule('Room', ['serial']);
check('an excluded field cannot be required either',
  missingRequiredFields({ type: 'Room' }, COLUMNS).length === 0);

setRule('Computer', ['name', 'type', 'parent', 'status']);
check('structural fields are never required, even if a settings row says so',
  missingRequiredFields({ type: 'Computer' }, COLUMNS).length === 0,
  'Parent-is-required is deliberately out of scope; Unassigned is a real state');

// --- 4. the wording ---------------------------------------------------------
check('one field reads "is required"',
  missingRequiredMessage([{ label: 'Serial' }], 'Computer') === 'Serial is required for a Computer.');
check('two fields read "are required"',
  missingRequiredMessage([{ label: 'Serial' }, { label: 'Hostname' }], 'Computer')
    === 'Serial and Hostname are required for a Computer.');
check('three fields use a comma then "and"',
  missingRequiredMessage([{ label: 'A' }, { label: 'B' }, { label: 'C' }], 'TV')
    === 'A, B and C are required for a TV.');
check('the message names the TYPE, not just the fields',
  missingRequiredMessage([{ label: 'Serial' }], 'Computer').includes('Computer'),
  'the rule may have been set by someone else; the person needs to know why');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
