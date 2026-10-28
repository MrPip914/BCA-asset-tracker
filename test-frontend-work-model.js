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
  'const COLUMN_DATA_TYPE_VALUES = new Set(["text","textarea","number","date","select","multiselect","reference"]);',
  'function isChoiceKind(kind) { return kind === "select" || kind === "multiselect"; }',
  'function multiValues(value) { return String(value == null ? "" : value).split(";").map(x => x.trim()).filter(Boolean); }',
  'const dateOnly = s => String(s).slice(0, 10);',
  slice('function columnDataType(col) {'),
  slice('function columnOptions(col) {'),
  slice('function validateColumnValue(col, raw) {'),
  slice('function adoptWorkModel(raw) {'),
  'const DEFAULT_WORK_TYPE_ID = "__default";',
  slice('function workModelParts(model, kind) {'),
  slice('function defaultWorkTypeId(model, kind) {'),
  slice('function setDefaultWorkType(model, kind, id) {'),
  slice('function resolveWorkTypeId(model, kind, typeId) {'),
  slice('function workBuiltinShown(model, kind, typeId, key) {'),
  slice('function setWorkBuiltinShown(model, kind, typeId, key, on) {'),
  slice('function customFieldsFor(model, kind, typeId) {'),
  slice('function requiredCustomFieldsFor(model, kind, typeId) {'),
  slice('function validateCustomValues(model, kind, typeId, values, visibleKeys) {'),
  slice('function newWorkFieldKey(fields, label) {'),
  slice('function workModelKey(kind) {'),
  slice('function addWorkField(model, kind, def) {'),
  slice('function addWorkFieldChoice(model, kind, key, choice) {'),
  slice('function removeWorkField(model, kind, key) {'),
  slice('function setTypeHasField(model, kind, typeId, key, on) {'),
  slice('function setTypeFieldRequired(model, kind, typeId, key, on) {'),
  slice('function addTaskType(model, name) {'),
  slice('function renameTaskType(model, id, name) {'),
  slice('function removeTaskType(model, id) {'),
  slice('function taskTypeNameOf(model, id) {'),
  'return { defaultWorkTypeId, setDefaultWorkType, resolveWorkTypeId, workBuiltinShown, setWorkBuiltinShown, DEFAULT_WORK_TYPE_ID, addWorkField, addWorkFieldChoice, removeWorkField, setTypeHasField, setTypeFieldRequired, addTaskType, renameTaskType, removeTaskType, taskTypeNameOf, adoptWorkModel, customFieldsFor, requiredCustomFieldsFor, validateCustomValues, newWorkFieldKey };',
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
check('the backend writes the key', /OPTIONAL_CONFIG_KEYS = \["workModel", "views"\]/.test(fs.readFileSync(path.join(root, 'supabase/functions/asset-api/save.ts'), 'utf8')));
check('the backend reads the key', /OPTIONAL_CONFIG_KEYS = \["workModel", "views"\]/.test(fs.readFileSync(path.join(root, 'supabase/functions/asset-api/inventory.ts'), 'utf8')));

// ---- editing
let em = H.adoptWorkModel(null);
let r = H.addTaskType(em, ' Inspection ');
check('a task type is added, trimmed, with an id', r.id && r.model.taskTypes[0].name === 'Inspection');
em = r.model;
check('a duplicate type name is refused case-insensitively', !!H.addTaskType(em, 'inspection').error);
check('a blank type name is refused', !!H.addTaskType(em, '  ').error);
const tid = r.id;
r = H.addWorkField(em, 'task', { label: 'PSI', dataType: 'number' });
check('a field is added with a key', r.key === 'cf_psi' && r.model.taskFields.length === 1);
check('a duplicate field label is refused', !!H.addWorkField(r.model, 'task', { label: 'psi', dataType: 'text' }).error);
check('a choice list with no choices is refused', !!H.addWorkField(r.model, 'task', { label: 'Grade', dataType: 'select', options: [' ', ''] }).error);
check('task and work field pools are separate', H.addWorkField(r.model, 'work', { label: 'PSI', dataType: 'text' }).model.workFields.length === 1);
em = H.setTypeHasField(r.model, 'task', tid, 'cf_psi', true);
em = H.setTypeFieldRequired(em, 'task', tid, 'cf_psi', true);
check('ticking a field then requiring it sticks', H.requiredCustomFieldsFor(em, 'task', tid).join() === 'cf_psi');
check('requiring a field the type lacks does nothing', H.setTypeFieldRequired(r.model, 'task', tid, 'cf_psi', true) === r.model);
const em2 = H.setTypeHasField(em, 'task', tid, 'cf_psi', false);
check('unticking a field also drops its required flag', em2.taskTypeSettings[tid].requiredFields.length === 0);
const em3 = H.removeWorkField(em, 'task', 'cf_psi');
check('removing a field definition unticks it everywhere', em3.taskFields.length === 0 && em3.taskTypeSettings[tid].fieldKeys.length === 0 && em3.taskTypeSettings[tid].requiredFields.length === 0);
check('a rename keeps the id', H.renameTaskType(em, tid, 'Check').model.taskTypes[0].id === tid && H.taskTypeNameOf(H.renameTaskType(em, tid, 'Check').model, tid) === 'Check');
const em4 = H.removeTaskType(em, tid);
check('removing a type drops its settings; a task naming it reads untyped', em4.taskTypes.length === 0 && !em4.taskTypeSettings[tid] && H.taskTypeNameOf(em4, tid) === '');
check('the original model is never mutated', em.taskTypes.length === 1 && em.taskFields.length === 1);

// ---- task dialog wiring (source)
check('the add and edit saves both write taskType and custom', (src.match(/taskType: maintenanceDraft\.taskType \|\| ""/g) || []).length === 2);
check('both saves validate custom values', (src.match(/validateCustomValues\(workModel, "task"/g) || []).length >= 3);
check('the draft is seeded with taskType/custom when editing', /taskType: item\.taskType \|\| "",/.test(src));
check('Save is disabled while a custom value is invalid', /\|\| !!taskCustomError\}/.test(src));
check('the Task types settings section exists', /key: "tasktypes"/.test(src) && /key === "tasktypes"/.test(src));
check('the edge function keeps taskType/custom on save', /TASK_EXTRA_KEYS = \["taskType", "custom", "paneGroupIds"/.test(fs.readFileSync(path.join(__dirname, 'supabase/functions/asset-api/save-shape.ts'), 'utf8')));

// ---- work dialog wiring (source)
check('add and edit work saves write custom', (src.match(/custom: \{ \.\.\.\(changeDraft\.custom \|\| \{\}\) \}/g) || []).length === 2);
check('the completion form writes custom and validates it', /custom: \{ \.\.\.\(custom \|\| \{\}\) \}/.test(src) && /validateCustomValues\(workModel, "work", changeType, custom\)/.test(src));
check('work saves validate custom values', (src.match(/validateCustomValues\(workModel, "work"/g) || []).length >= 4);
check('the draft is seeded with custom when editing', /custom: ch\.custom && typeof ch\.custom === "object"/.test(src));
check('the Work types settings section exists', /key: "worktypes"/.test(src) && /key === "worktypes"/.test(src));
check('work search covers custom values', /Object\.values\(r\.change\.custom/.test(src));

// ---- default type and built-in field switches
{
  const base = H.adoptWorkModel(null);
  check('a blank type resolves to the default', H.resolveWorkTypeId(base, 'task', '') === '__default' && H.resolveWorkTypeId(base, 'work', '') === '__default');
  check('a removed task type resolves to the default', H.resolveWorkTypeId(base, 'task', 'tt-gone') === '__default');
  check('a named work type resolves to itself', H.resolveWorkTypeId(base, 'work', 'Repair') === 'Repair');
  {
    let m = H.addTaskType(base, 'Repair').model; const id = m.taskTypes[0].id;
    m = H.setDefaultWorkType(m, 'task', id);
    check('a chosen default takes blank and removed task types', H.resolveWorkTypeId(m, 'task', '') === id && H.resolveWorkTypeId(m, 'task', 'tt-gone') === id);
    check('the built-in stays reachable by id', H.resolveWorkTypeId(m, 'task', '__default') === '__default');
    check('a chosen task type does not move work', H.resolveWorkTypeId(m, 'work', '') === '__default');
    check('removing the chosen type falls back to the built-in', H.resolveWorkTypeId(H.removeTaskType(m, id), 'task', '') === '__default');
    check('choosing the built-in clears the setting', H.resolveWorkTypeId(H.setDefaultWorkType(m, 'task', '__default'), 'task', '') === '__default');
    const w = H.setDefaultWorkType(base, 'work', 'Repair');
    check('a chosen work default takes blank', H.resolveWorkTypeId(w, 'work', '') === 'Repair');
    check('the default survives adoption', H.adoptWorkModel(m).defaultTaskType === id && H.adoptWorkModel(w).defaultWorkType === 'Repair');
  }
  check('nothing is hidden on a fresh model', H.workBuiltinShown(base, 'task', '', 'owner') && H.workBuiltinShown(base, 'work', 'Repair', 'cost'));
  const off = H.setWorkBuiltinShown(base, 'task', '__default', 'owner', false);
  check('switching a built-in off hides it for untyped tasks', !H.workBuiltinShown(off, 'task', '', 'owner') && H.workBuiltinShown(off, 'task', '', 'notes'));
  check('switching it back on shows it', H.workBuiltinShown(H.setWorkBuiltinShown(off, 'task', '__default', 'owner', true), 'task', '', 'owner'));
  check('hiding is per type', H.workBuiltinShown(H.setWorkBuiltinShown(base, 'work', 'Repair', 'cost', false), 'work', 'Inspection', 'cost'));
  const withField = H.setTypeHasField(off, 'task', '__default', 'cf_x', true);
  check('ticking a custom field keeps the hidden list', !H.workBuiltinShown(withField, 'task', '', 'owner'));
  check('hidden fields survive a reload through adoptWorkModel', !H.workBuiltinShown(H.adoptWorkModel(JSON.parse(JSON.stringify(off))), 'task', '', 'owner'));
  const df = H.addWorkField(base, 'task', { label: 'Site code' });
  const dm = H.setTypeHasField(df.model, 'task', '__default', df.key, true);
  check('custom fields on the default type reach untyped tasks', H.customFieldsFor(dm, 'task', '').length === 1);
  check('the dialogs gate each built-in on the type', (src.match(/workBuiltinShown\(workModel, "(task|work)"/g) || []).length >= 9);
}

{
  const mr = H.addWorkField(em, 'task', { label: 'Areas', dataType: 'multiselect', options: ['Roof', 'Gym'] });
  check('a multiple-choice field is created with its choices', !mr.error && mr.model.taskFields.find(f => f.key === mr.key).dataType === 'multiselect');
  check('a multiple-choice field needs a choice', !!H.addWorkField(em, 'task', { label: 'Z', dataType: 'multiselect' }).error);
  const more = H.addWorkFieldChoice(mr.model, 'task', mr.key, 'Lab');
  check('a choice can be added to a multiple-choice field', more.taskFields.find(f => f.key === mr.key).options.length === 3);
  check('a choice with a semicolon is refused', H.addWorkFieldChoice(mr.model, 'task', mr.key, 'a;b') === mr.model);
  const on = H.setTypeHasField(mr.model, 'task', '__default', mr.key, true);
  check('several picks validate', H.validateCustomValues(on, 'task', '', { [mr.key]: 'Roof; Gym' }) === '' || !H.validateCustomValues(on, 'task', '', { [mr.key]: 'Roof; Gym' }));
  const bad = H.validateCustomValues(on, 'task', '', { [mr.key]: 'Roof; Pool' });
  check('a pick outside the list is refused', !!bad && bad.length > 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
