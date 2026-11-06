// Recurring tasks as a configuration plus instances, and the Completion board source.
// Runs the REAL helpers sliced from index.html, plus source checks on the wiring.
// Run: node test-frontend-recurring.js
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};
const fn = name => { const a = src.indexOf('function ' + name + '('); if (a < 0) throw new Error(name); return src.slice(a, src.indexOf('\n}', a) + 2); };
const cst = name => { const a = src.indexOf('const ' + name + ' ='); return src.slice(a, src.indexOf('\n', a) + 1); };
const H = new Function([
  cst('TASK_KIND_SCHEDULED'), cst('TASK_KIND_ONEOFF'), fn('dateOnly'), fn('taskKindOf'), fn('isOneOffTask'), fn('taskIsDone'),
  'function parseRecurrence() { return null; }', 'function nextRecurrenceDate() { return null; }',
  'function localDateString(d) { d = d || new Date("2026-11-06T12:00:00"); const p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); }',
  fn('taskDueDate'), cst('TASK_MAX_DEPTH'), fn('taskIndexOf'), fn('taskChildrenOf'), fn('taskDescendantsOf'),
  fn('isRecurringConfig'), fn('recurringConfigIds'), fn('taskIsHidden'), fn('recurringInstancesOf'), fn('recurringOpenInstance'),
  fn('spawnNextInstance'), fn('afterInstanceCompleted'),
  'return { isRecurringConfig, recurringConfigIds, taskIsHidden, recurringOpenInstance, spawnNextInstance, afterInstanceCompleted };',
].join('\n'))();

const cfg = { id: 'cfg', kind: 'scheduled', instanced: true, task: 'Change filter', notes: 'n', owner: 'Sam', frequencyLabel: 'Weekly', frequencyDays: 7, lastPerformed: '' };
const mk = () => [
  { id: 'A', type: 'Room', maintenanceItems: [{ ...cfg }, { id: 'tpl', kind: 'oneoff', task: 'Check seal', parentTaskId: 'cfg', lastPerformed: '' }, { id: 'plain', kind: 'scheduled', task: 'Old schedule', frequencyDays: 30 }] },
  { id: 'B', type: 'Room', maintenanceItems: [{ id: 'blk', kind: 'oneoff', task: 'After', blockedBy: [], lastPerformed: '' }] },
];
const items = a => a.flatMap(x => x.maintenanceItems);

check('a configuration is only an instanced schedule', H.isRecurringConfig(cfg) && !H.isRecurringConfig({ ...cfg, instanced: false }) && !H.isRecurringConfig({ kind: 'oneoff', instanced: true }));
const ids = H.recurringConfigIds(mk());
check('configs and their template subtasks are hidden, others are not', H.taskIsHidden(cfg, ids) && H.taskIsHidden({ parentTaskId: 'cfg' }, ids) && !H.taskIsHidden({ id: 'plain', kind: 'scheduled' }, ids));

let r = H.spawnNextInstance(mk(), 'cfg', '', 'Eric');
const inst = r.spawned;
check('spawn creates one open one-off instance pointing at the config', inst && inst.recurringId === 'cfg' && inst.kind === 'oneoff' && inst.task === 'Change filter' && inst.owner === 'Sam' && !inst.lastPerformed);
check('a never-done config is due today', inst.dueDate === '2026-11-06');
check('its template subtasks are copied under the instance with fresh ids', items(r.assets).filter(m => m.parentTaskId === inst.id).length === 1 && items(r.assets).filter(m => m.task === 'Check seal').length === 2);
check('only one open instance: a second spawn does nothing', H.spawnNextInstance(r.assets, 'cfg', '', 'Eric').spawned === null);
check('from a completion date the next round counts forward', H.spawnNextInstance(mk(), 'cfg', '2026-11-01', '').spawned.dueDate === '2026-11-08');

// Completing the instance
const withInst = r.assets.map(a => a.id === 'B' ? { ...a, maintenanceItems: [{ ...a.maintenanceItems[0], blockedBy: [inst.id] }] } : a);
const stamped = withInst.map(a => ({ ...a, maintenanceItems: a.maintenanceItems.map(m => m.id === inst.id ? { ...m, lastPerformed: '2026-11-06' } : m) }));
const after = H.afterInstanceCompleted(stamped, stamped[0].maintenanceItems.find(m => m.id === inst.id), '2026-11-06', 'Eric');
const open = H.recurringOpenInstance(after, 'cfg');
check('completing an instance stamps the config and opens the next round', after[0].maintenanceItems.find(m => m.id === 'cfg').lastPerformed === '2026-11-06' && open && open.item.id !== inst.id && open.item.dueDate === '2026-11-13');
check('blockers move to the new round', after[1].maintenanceItems[0].blockedBy.join() === open.item.id);
check('finished rounds stay as history', after[0].maintenanceItems.some(m => m.id === inst.id && m.lastPerformed));
check('completing a non-instance changes nothing', H.afterInstanceCompleted(mk(), { id: 'x', kind: 'oneoff' }, '2026-11-06', '') !== null && H.afterInstanceCompleted(mk(), { id: 'x', kind: 'oneoff' }, '2026-11-06', '').length === 2);

// Wiring
const count = (re) => (src.match(re) || []).length;
check('both completion paths spawn the next round', count(/afterInstanceCompleted\(next, item, date, currentUser\)/g) === 2);
check('reopen is refused while a newer round is open (button and dialog)', count(/can't be reopened while a newer round is open/g) === 2);
check('a new repeating task is a configuration with a first round', /\.\.\.\(!oneOff \? \{ instanced: true \} : \{\}\)/.test(src) && /if \(!oneOff\) next = spawnNextInstance\(next, item\.id, "", currentUser\)/.test(src));
check('lists hide configurations', /if \(taskIsHidden\(item, hiddenIds\)\) return;/.test(src) && /!item \|\| taskIsHidden\(item, hiddenIds\)/.test(src) && /\.filter\(item => !taskIsHidden\(item, hiddenTaskIds\)\)/.test(src));
check('deleting a configuration removes its open round', /Deleting a recurring task also removes its open round/.test(src));
check('skip, start-next-round and the migration button exist', /async function skipRound/.test(src) && /async function startNextRound/.test(src) && /async function migrateSchedules/.test(src) && /onClick=\{migrateSchedules\}/.test(src));
check('Supabase keeps recurringId, instanced and skipped', /TASK_EXTRA_KEYS = \[[^\]]*"recurringId", "instanced", "skipped"/.test(fs.readFileSync(path.join(__dirname, 'supabase/functions/asset-api/save-shape.ts'), 'utf8')));

// Completion board source
check('Completion is a writable built-in board source with Open and Done', /key: "completion", label: "Completion", writable: true/.test(src) && /options = \[\{ id: "open", name: "Open" \}, \{ id: "done", name: "Done" \}\]/.test(src));
check('dragging on it runs the done circle path', /field\.builtin === "completion"[\s\S]{0,400}toggleTaskDone\(\{ item, asset \}\)/.test(src));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
