// Completion modes per task type: required (form), optional (one tap + Log work), simple (checkbox).
// Runs the REAL helpers sliced from index.html, plus source checks on the wiring.
// Run: node test-frontend-completion-modes.js
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
const consts = src.slice(src.indexOf('const TASK_COMPLETION_MODES'), src.indexOf('function taskCompletionMode'));
const code = [
  'const DEFAULT_WORK_TYPE_ID = "__default";',
  consts,
  slice('function workModelParts(model, kind) {'),
  slice('function defaultWorkTypeId(model, kind) {'),
  slice('function resolveWorkTypeId(model, kind, typeId) {'),
  slice('function taskCompletionMode(model, typeId) {'),
  slice('function setTaskCompletionMode(model, typeId, mode) {'),
  'const COLUMN_DATA_TYPE_VALUES = new Set(["text"]);',
  slice('function adoptWorkModel(raw) {'),
  'return { taskCompletionMode, setTaskCompletionMode, adoptWorkModel };',
].join(NL);
const { taskCompletionMode, setTaskCompletionMode, adoptWorkModel } = new Function(code)();

const base = adoptWorkModel({ taskTypes: [{ id: "t1", name: "Chore" }], taskTypeSettings: { t1: { fieldKeys: ["a"] } } });
check('an untouched type reads required', taskCompletionMode(base, "t1") === "required");
check('the built-in default reads required', taskCompletionMode(base, "__default") === "required");
check('a blank / removed type reads required', taskCompletionMode(base, "") === "required" && taskCompletionMode(base, "gone") === "required");
const simple = setTaskCompletionMode(base, "t1", "simple");
check('simple is stored and read back', taskCompletionMode(simple, "t1") === "simple");
check('setting keeps the type\'s other settings', simple.taskTypeSettings.t1.fieldKeys.join() === "a");
check('survives adoptWorkModel (a reload)', taskCompletionMode(adoptWorkModel(JSON.parse(JSON.stringify(simple))), "t1") === "simple");
check('optional is stored', taskCompletionMode(setTaskCompletionMode(base, "t1", "optional"), "t1") === "optional");
const back = setTaskCompletionMode(simple, "t1", "required");
check('going back to required stores nothing', !("completion" in back.taskTypeSettings.t1));
check('a junk stored mode reads required', taskCompletionMode(adoptWorkModel({ taskTypeSettings: { t1: { completion: "weird" } }, taskTypes: [{ id: "t1" }] }), "t1") === "required");
const dm = setTaskCompletionMode(base, "__default", "simple");
check('the built-in default can be switched, and untyped tasks follow', taskCompletionMode(dm, "") === "simple");

check('quick complete writes the audit row but no change entry', (() => {
  const f = src.slice(src.indexOf('async function completeTaskQuick'), src.indexOf('async function deleteMaintenanceItem'));
  return f.includes('maintenance_completed') && f.includes('lastPerformed: date') && !/changes:/.test(f);
})());
check('dialog button gated on mode', /mode !== "required"[\s\S]{0,200}completeTaskQuick\(maintenanceModal\.itemId/.test(src));
check('card checkbox gated on mode', /mode !== "required"[\s\S]{0,400}completeTaskQuick\(item\.id\)/.test(src));
check('required keeps the form button in dialog and card', (src.match(/mode !== "simple"/g) || []).length === 2);
check('settings picker present', src.includes('setTaskCompletionMode(model, selected.id, v)'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
