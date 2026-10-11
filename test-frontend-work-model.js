// Managed types + custom fields for tasks and logged work (the WORK MODEL).
// Runs the REAL helpers sliced out of index.html, plus source checks on the wiring.
// Run: node test-frontend-work-model.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};
const NL = src.includes('\r\n') ? '\r\n' : '\n';
function slice(decl) {
  const start = src.indexOf(decl);
  if (start === -1) throw new Error(decl + ' not found');
  const end = src.indexOf(NL + '}' + NL, start);
  return src.slice(start, end + NL.length + 1);
}
const code = [
  'const COLUMN_DATA_TYPE_VALUES = new Set(["text","textarea","number","date","select","reference"]);',
  'const dateOnly = s => String(s).slice(0, 10);',
  slice('function columnDataType(col) {'),
  slice('function columnOptions(col) {'),
  slice('function validateColumnValue(col, raw) {'),
  slice('function adoptWorkModel(raw) {'),
  slice('function workModelParts(model, kind) {'),
  slice('function customFieldsFor(model, kind, typeId) {'),
  slice('function requiredCustomFieldsFor(model, kind, typeId) {'),
  slice('function validateCustomValues(model, kind, typeId, values) {'),
  slice('function newWorkFieldKey(fields, label) {'),
  'return { adoptWorkModel, customFieldsFor, requiredCustomFieldsFor, validateCustomValues, newWorkFieldKey };',
].join('\n');
const H = new Function('DEFAULT_COLUMN_DATA_TYPES', code)({});

const empty = H.adoptWorkModel(undefined);
check('no stored model reads as empty lists', empty.taskTypes.length === 0 && empty.workFields.length === 0);
check('garbage reads as empty', H.adoptWorkModel('x').taskFields.length === 0 && H.adoptWorkModel([1]).taskTypes.length === 0);

const m = H.adoptWorkModel({
  taskTypes: [{ id: 'insp', name: 'Inspection' }],
  taskFields: [
    { key: 'cf_size', label: 'Filter size', dataType: 'text' },
    { key: 'cf_psi', label: 'PSI', dataType: 'number' },
    { key: 'cf_grade', label: 'Grade', dataType: 'select', options: ['A', 'B'] },
  ],
  taskTypeSettings: { insp: { fieldKeys: ['cf_psi', 'cf_size', 'cf_gone'], requiredFields: ['cf_psi', 'cf_grade'] } },
  workFields: [{ key: 'cf_po', label: 'PO number' }],
  workTypeSettings: { Repair: { fieldKeys: ['cf_po'], requiredFields: ['cf_po'] } },
});
check('a type lists its fields in its own order', H.customFieldsFor(m, 'task', 'insp').map(f => f.key).join() === 'cf_psi,cf_size');
check('a field with no definition is dropped at read time', !H.customFieldsFor(m, 'task', 'insp').some(f => f.key === 'cf_gone'));
check('a blank or unknown type has no fields', H.customFieldsFor(m, 'task', '').length === 0 && H.customFieldsFor(m, 'task', 'nope').length === 0);
check('required is limited to fields the type has', H.requiredCustomFieldsFor(m, 'task', 'insp').join() === 'cf_psi');
check('tasks and work are separate pools', H.customFieldsFor(m, 'work', 'insp').length === 0 && H.customFieldsFor(m, 'work', 'Repair').length === 1);
check('a required field left empty is refused', H.validateCustomValues(m, 'task', 'insp', {}) === 'PSI is required.');
check('zero is filled in', H.validateCustomValues(m, 'task', 'insp', { cf_psi: 0 }) === '');
check('"0" is filled in', H.validateCustomValues(m, 'task', 'insp', { cf_psi: '0' }) === '');
check('a wrong data type is refused', /must be a number/.test(H.validateCustomValues(m, 'task', 'insp', { cf_psi: 'abc' })));
check('values for fields the type lacks are ignored', H.validateCustomValues(m, 'task', 'insp', { cf_psi: 1, cf_other: 'zzz' }) === '');
check('no type means nothing is required', H.validateCustomValues(m, 'task', '', {}) === '');
check('work type rules apply to work only', H.validateCustomValues(m, 'work', 'Repair', {}) === 'PO number is required.');
const k1 = H.newWorkFieldKey([], 'Filter size!');
check('a key is prefixed and slugged', k1 === 'cf_filter_size');
check('a taken key gets a suffix', H.newWorkFieldKey([{ key: k1 }], 'Filter size') === 'cf_filter_size_2');

// Wiring: the wire key travels every way a config key must.
check('persist restates workModel in the payload', /typeCategories: nextTypeLabels,\s*workModel: nextWorkModel,/.test(src));
check('a workModel change marks config dirty', /nextWorkModel !== workModel/.test(src));
check('per-record saves send workModel', /CONFIG_PAYLOAD_KEYS = \[[^\]]*"workModel"/.test(src));
check('load adopts it', /setWorkModel\(adoptWorkModel\(data\.workModel\)\)/.test(src));
const root = __dirname;
check('the backend writes the key', /\["workModel"/.test(fs.readFileSync(path.join(root, 'supabase/functions/asset-api/save.ts'), 'utf8')));
check('the backend reads the key', /"workModel"/.test(fs.readFileSync(path.join(root, 'supabase/functions/asset-api/inventory.ts'), 'utf8')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
