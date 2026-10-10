// A reference field may point at SEVERAL asset types (2026-10-10).
//
// Runs the REAL columnReferenceTypes and joinTypeNames, sliced out of
// index.html, and the real applyFieldKind (a closure inside the component,
// sliced by its own indentation). The picker and the editor are browser
// behaviour and were driven in Chromium against Sandbox.
//
// Run: node test-frontend-reference-types.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};
function slice(decl, closer) {
  const start = src.indexOf(decl);
  if (start === -1) throw new Error(decl + ' not found in index.html');
  const end = src.indexOf(closer, start);
  return src.slice(start, end + closer.length);
}
const code = [
  slice('function columnReferenceTypes(col) {', '\n}\n'),
  slice('function joinTypeNames(ids, typesList) {', '\n}\n'),
  slice('  function applyFieldKind(col, kind, choicesText, referenceTypes) {', '\n  }\n'),
].join('\n');
const typeNameOf = (id, list) => ((list || []).find(t => t.id === id) || {}).name || id;
const COLUMN_DATA_TYPE_VALUES = new Set(['text', 'textarea', 'number', 'date', 'select', 'reference']);
const DEFAULT_COLUMN_DATA_TYPES = {};
const { columnReferenceTypes, joinTypeNames, applyFieldKind } = new Function(
  'typeNameOf', 'COLUMN_DATA_TYPE_VALUES', 'DEFAULT_COLUMN_DATA_TYPES',
  code + '\nreturn { columnReferenceTypes, joinTypeNames, applyFieldKind };'
)(typeNameOf, COLUMN_DATA_TYPE_VALUES, DEFAULT_COLUMN_DATA_TYPES);

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- reading -------------------------------------------------------------------
check('a field from before this change (single referenceType) reads as a list of one',
  eq(columnReferenceTypes({ dataType: 'reference', referenceType: 'Thermostat' }), ['Thermostat']));
check('referenceTypes wins over the legacy string',
  eq(columnReferenceTypes({ referenceTypes: ['TV', 'Monitor'], referenceType: 'TV' }), ['TV', 'Monitor']));
check('nothing configured -> empty list, not [""]',
  eq(columnReferenceTypes({ referenceType: '' }), []) && eq(columnReferenceTypes(undefined), []));

// --- writing -------------------------------------------------------------------
const col = { key: 'mount' };
applyFieldKind(col, 'reference', '', ['TV', 'Monitor', 'TV', '']);
check('several types are stored, de-duplicated and blank-free',
  eq(col.referenceTypes, ['TV', 'Monitor']), JSON.stringify(col));
check('the first type is ALSO written as referenceType, for older builds',
  col.referenceType === 'TV');
const legacyCall = { key: 'tstat' };
applyFieldKind(legacyCall, 'reference', '', 'Thermostat');
check('a single string still works', eq(legacyCall.referenceTypes, ['Thermostat']));
const switched = { key: 'x', referenceTypes: ['TV'], referenceType: 'TV' };
applyFieldKind(switched, 'text', '', ['TV']);
check('a non-reference kind drops both keys',
  !('referenceTypes' in switched) && !('referenceType' in switched));

// --- wording -------------------------------------------------------------------
const types = [{ id: 'TV', name: 'TV' }, { id: 'Monitor', name: 'Monitor' }, { id: 'u1', name: 'Projector' }];
check('one type', joinTypeNames(['TV'], types) === 'TV');
check('two types', joinTypeNames(['TV', 'Monitor'], types) === 'TV or Monitor');
check('three types, names resolved from ids', joinTypeNames(['TV', 'Monitor', 'u1'], types) === 'TV, Monitor or Projector');

// --- wiring --------------------------------------------------------------------
check('the asset picker filters by the LIST of types',
  src.includes('targetTypes.includes(a.type)') && !src.includes('a.type === referenceType'));
check('both form call sites pass the resolved list',
  (src.match(/referenceTypes=\{columnReferenceTypes\(c\)\}/g) || []).length === 2);
check('the editor seeds existing fields through the resolver',
  src.includes('fieldReferenceTypes: Object.fromEntries(fieldOptions.map(f => [f.key, columnReferenceTypes(f)]))'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
