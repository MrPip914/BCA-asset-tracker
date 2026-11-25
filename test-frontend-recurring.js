// Recurring tasks as ONE entity with instances (configuration hidden behind the Repeats toggle),
// and the Completion board source.
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
  cst('TASK_KIND_SCHEDULED'), cst('TASK_KIND_ONEOFF'), fn('dateOnly'), fn('taskKindOf'), fn('taskKindShown'), fn('taskKindShownLabel'), cst('TASK_KIND_REPEATING'), fn('isOneOffTask'), fn('taskIsDone'),
  'function parseRecurrence() { return null; }', 'function nextRecurrenceDate() { return null; }',
  'function localDateString(d) { d = d || new Date("2026-11-06T12:00:00"); const p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); }',
  fn('taskDueDate'), cst('TASK_MAX_DEPTH'), fn('taskIndexOf'), fn('taskChildrenOf'), fn('taskDescendantsOf'),
  fn('isRecurringConfig'), fn('recurringConfigIds'), fn('taskIsHidden'), fn('recurringInstancesOf'), fn('recurringOpenInstance'),
  fn('spawnNextInstance'), fn('afterInstanceCompleted'), fn('recurringLatestDone'), fn('recurringHistoryOf'), fn('recurringSyncLastDone'),
  fn('removeTasksWithChildren'), fn('recurringReopenReplacing'), fn('recurringDeleteInstance'), fn('recurringDetach'), fn('makeRecurringFrom'), fn('legacyScheduleRows'), fn('convertSchedulesToRecurring'), 'function taskIsEvent() { return false; }',
  'return { isRecurringConfig, recurringConfigIds, taskIsHidden, recurringOpenInstance, spawnNextInstance, afterInstanceCompleted, recurringLatestDone, recurringHistoryOf, recurringSyncLastDone, recurringReopenReplacing, recurringDeleteInstance, recurringDetach, makeRecurringFrom, legacyScheduleRows, convertSchedulesToRecurring };',
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
check('a never-done config is due today', (() => { const d = new Date(), p = n => String(n).padStart(2, '0'); return inst.dueDate === d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); })());
check('its template subtasks are copied under the instance with fresh ids', items(r.assets).filter(m => m.parentTaskId === inst.id).length === 1 && items(r.assets).filter(m => m.task === 'Check seal').length === 2);
check('only one open instance: a second spawn does nothing', H.spawnNextInstance(r.assets, 'cfg', '', 'Eric').spawned === null);
check('from a completion date the next instance counts forward', H.spawnNextInstance(mk(), 'cfg', '2026-11-01', '').spawned.dueDate === '2026-11-08');

// Completing the instance
const withInst = r.assets.map(a => a.id === 'B' ? { ...a, maintenanceItems: [{ ...a.maintenanceItems[0], blockedBy: [inst.id] }] } : a);
const stamped = withInst.map(a => ({ ...a, maintenanceItems: a.maintenanceItems.map(m => m.id === inst.id ? { ...m, lastPerformed: '2026-11-06' } : m) }));
const after = H.afterInstanceCompleted(stamped, stamped[0].maintenanceItems.find(m => m.id === inst.id), '2026-11-06', 'Eric');
const open = H.recurringOpenInstance(after, 'cfg');
check('completing an instance stamps the config and opens the next instance', after[0].maintenanceItems.find(m => m.id === 'cfg').lastPerformed === '2026-11-06' && open && open.item.id !== inst.id && open.item.dueDate === '2026-11-13');
check('blockers move to the new instance', after[1].maintenanceItems[0].blockedBy.join() === open.item.id);
check('finished instances stay as history', after[0].maintenanceItems.some(m => m.id === inst.id && m.lastPerformed));
check('completing a non-instance changes nothing', H.afterInstanceCompleted(mk(), { id: 'x', kind: 'oneoff' }, '2026-11-06', '') !== null && H.afterInstanceCompleted(mk(), { id: 'x', kind: 'oneoff' }, '2026-11-06', '').length === 2);

// History, reopen-replacing, delete, detach, make-recurring
const cfgOf = a => a.flatMap(x => x.maintenanceItems).find(m => m.id === 'cfg');
const two = (() => {
  // three finished instances (Jan, Feb, Mar) and one open (current), one template subtask
  const base = [{ id: 'A', type: 'Room', maintenanceItems: [
    { id: 'cfg', kind: 'scheduled', instanced: true, task: 'Filter', frequencyLabel: 'Weekly', frequencyDays: 7, lastPerformed: '2026-03-01' },
    { id: 'tpl', kind: 'oneoff', task: 'Seal', parentTaskId: 'cfg', lastPerformed: '' },
    { id: 'i1', kind: 'oneoff', recurringId: 'cfg', task: 'Filter', lastPerformed: '2026-01-01', at: '2026-01-01T00:00:00Z', dueDate: '2026-01-01' },
    { id: 'i2', kind: 'oneoff', recurringId: 'cfg', task: 'Filter', lastPerformed: '2026-02-01', at: '2026-02-01T00:00:00Z', dueDate: '2026-02-01' },
    { id: 'i3', kind: 'oneoff', recurringId: 'cfg', task: 'Filter', lastPerformed: '2026-03-01', at: '2026-03-01T00:00:00Z', dueDate: '2026-03-01' },
    { id: 'cur', kind: 'oneoff', recurringId: 'cfg', task: 'Filter', lastPerformed: '', at: '2026-03-02T00:00:00Z', dueDate: '2026-03-08' },
    { id: 'curSub', kind: 'oneoff', task: 'Seal', parentTaskId: 'cur', lastPerformed: '' },
  ] }];
  return base;
})();
check('history lists the open instance first, then finished ones newest first', H.recurringHistoryOf(two, 'cfg').map(r => r.item.id).join() === 'cur,i3,i2,i1');
check('latest done is the newest completed date', H.recurringLatestDone(two, 'cfg').item.id === 'i3' && H.recurringLatestDone(two, 'cfg', 'i3').item.id === 'i2');
let ro = H.recurringReopenReplacing(two, 'i2');
const roItems = ro.assets[0].maintenanceItems;
check('reopening an older instance deletes the open one and its subtasks', !roItems.some(m => m.id === 'cur' || m.id === 'curSub') && ro.removed.length === 2);
check('the reopened instance is open and the config last-done follows the newest finished one', roItems.find(m => m.id === 'i2').lastPerformed === '' && cfgOf(ro.assets).lastPerformed === '2026-03-01');
check('exactly one instance is open after a replace', roItems.filter(m => m.recurringId === 'cfg' && !m.lastPerformed).length === 1);
let di = H.recurringDeleteInstance(two, 'cur');
check('deleting the open instance reopens the previous one and removes its subtasks', di.reopened && di.reopened.id === 'i3' && di.assets[0].maintenanceItems.find(m => m.id === 'i3').lastPerformed === '' && !di.assets[0].maintenanceItems.some(m => m.id === 'cur' || m.id === 'curSub'));
check('the config last-done is recomputed after deleting the open instance', cfgOf(di.assets).lastPerformed === '2026-02-01');
let dd = H.recurringDeleteInstance(two, 'i2');
check('deleting a finished instance reopens nothing and keeps the config date current', dd.reopened === null && cfgOf(dd.assets).lastPerformed === '2026-03-01' && dd.assets[0].maintenanceItems.some(m => m.id === 'cur'));
let dt = H.recurringDetach(two, 'cfg', true);
const dtItems = dt.assets[0].maintenanceItems;
check('deleting the recurring task removes the config, template and open instance but keeps finished ones as plain one-offs', !dtItems.some(m => ['cfg', 'tpl', 'cur', 'curSub'].includes(m.id)) && ['i1', 'i2', 'i3'].every(id => { const m = dtItems.find(x => x.id === id); return m && !m.recurringId && m.lastPerformed; }));
let st = H.recurringDetach(two, 'cfg', false);
check('turning Repeats off keeps every instance, open one included, as a one-off', ['i1', 'i2', 'i3', 'cur', 'curSub'].every(id => st.assets[0].maintenanceItems.some(m => m.id === id)) && !st.assets[0].maintenanceItems.some(m => m.recurringId) && !st.assets[0].maintenanceItems.some(m => m.id === 'cfg'));
const oneOff = [{ id: 'A', type: 'Room', maintenanceItems: [{ id: 'o', kind: 'oneoff', task: 'Paint', owner: 'Sam', custom: {}, lastPerformed: '' }, { id: 'os', kind: 'oneoff', task: 'Mask', parentTaskId: 'o', lastPerformed: '2026-01-01' }] }];
let mr = H.makeRecurringFrom(oneOff, 'o', { label: 'Monthly', days: 30, recurrence: '' }, '2026-02-01', 'Eric');
const mrItems = mr.assets[0].maintenanceItems;
check('making a one-off recurring keeps it as the first instance and creates a config beside it', mr.config && mr.config.instanced && mr.config.frequencyLabel === 'Monthly' && mr.config.lastPerformed === '2026-02-01' && mrItems.find(m => m.id === 'o').recurringId === mr.config.id);
check('its subtasks are copied as the config template, unfinished', mrItems.filter(m => m.parentTaskId === mr.config.id).length === 1 && mrItems.find(m => m.parentTaskId === mr.config.id).lastPerformed === '');

// Wiring
const count = (re) => (src.match(re) || []).length;
check('both completion paths spawn the next instance', count(/afterInstanceCompleted\(next, item, date, currentUser\)/g) === 2);
check('reopening while another instance is open asks to replace it (button and dialog), never refuses', !/can't be reopened while a newer/.test(src) && /setRecurringReplaceAsk\(\{ itemId, assetId: tid/.test(src) && /setRecurringReplaceAsk\(\{ itemId: original\.id/.test(src) && /reopenTask\(a\.itemId, a\.assetId, a\.keepOpen, a\.dropWork, true\)/.test(src) && /saveMaintenanceEdit\(true\)/.test(src));
check('a new repeating task is a configuration with a first instance', /\.\.\.\(!oneOff \? \{ instanced: true \} : \{\}\)/.test(src) && /if \(!oneOff\) next = spawnNextInstance\(next, item\.id, "", currentUser\)/.test(src));
check('Repeats on an existing one-off creates the config through makeRecurringFrom', /becomesRecurring[\s\S]{0,400}makeRecurringFrom\(next, original\.id/.test(src));
check('lists hide configurations', /if \(taskIsHidden\(item, hiddenIds\)\) return;/.test(src) && /!item \|\| taskIsHidden\(item, hiddenIds\)/.test(src) && /\.filter\(item => !taskIsHidden\(item, hiddenTaskIds\)\)/.test(src));
check('delete on an open instance asks which (this instance or the recurring task), card and dialog', count(/requestDeleteTask\(/g) >= 3 && /setRecurringDeleteAsk\(\{ itemId, assetId: tid/.test(src) && /Delete this instance/.test(src) && /Delete the recurring task/.test(src));
check('Delete the recurring task also drops the open instance', /async function deleteRecurringTask[\s\S]{0,120}recurringDetach\(assets, configId, true\)/.test(src));
check('a Repeats toggle replaces the One-off/Repeats choice', /function RepeatsToggle/.test(src) && !/TaskKindToggle/.test(src) && /<RepeatsToggle on=\{repeatsOn\}/.test(src));
check('the toggle has a gear that opens the recurring settings (frequency and subtask template)', /aria-label="Recurring task settings"/.test(src) && /aria-label="Recurring task settings" style/.test(src) && /Subtask template/.test(src));
check('turning Repeats off on an instance asks first and keeps the instances', /setStopRepeatAsk\(\{ configId: maintenanceDraft\.recurringId/.test(src) && /recurringDetach\(assets, configId, false\)/.test(src));
check('an instance links to its History and a finished one links to the open instance', /History of this task/.test(src) && /Open current instance/.test(src) && /recurringHistoryOf\(assets, recurringHistory\)/.test(src));
check('the old Recurring tasks section, the old per-task Convert, Skip and Start-next are gone', !/recurringConfigRows/.test(src) && !/skipRound|startNextRound|migrateSchedules/.test(src) && !/Recurring tasks<\/div>/.test(src));
check('the word "round" is gone from the recurring wording', !/Skip this round|next round|open round|one open round|a newer round/.test(src));
check('Supabase keeps recurringId, instanced and skipped', /TASK_EXTRA_KEYS = \[[^\]]*"recurringId", "instanced", "skipped"/.test(fs.readFileSync(path.join(__dirname, 'supabase/functions/asset-api/save-shape.ts'), 'utf8')));

// Completion board source
check('Completion is a writable built-in board source with Open and Done', /key: "completion", label: "Completion", writable: true/.test(src) && /options = \[\{ id: "open", name: "Open" \}, \{ id: "done", name: "Done" \}\]/.test(src));
check('dragging on it runs the done circle path', /field\.builtin === "completion"[\s\S]{0,400}toggleTaskDone\(\{ item, asset \}\)/.test(src));
// Kind column
check('an instance (stored one-off) shows as Repeating', /taskKindShown\(item\) \{ return \(item && item\.recurringId\) \? TASK_KIND_REPEATING/.test(src) && /label: "Repeating"/.test(src) && /label: "Scheduled"/.test(src));
check('the Kind column, filter and view field read taskKindShown', (src.match(/taskKindShown(Label)?\(/g) || []).length >= 8);
// Correcting a Completed date, and the dialog staying in step
{
  const base = H.spawnNextInstance(mk(), 'cfg', '2026-11-01', '').assets;
  const doneInst = items(base).find(m => m.recurringId === 'cfg');
  const done = base.map(a => ({ ...a, maintenanceItems: a.maintenanceItems.map(m => (m.id === doneInst.id ? { ...m, lastPerformed: '2026-11-05' } : m.id === 'cfg' ? { ...m, lastPerformed: '2026-11-05' } : m)) }));
  const edited = done.map(a => ({ ...a, maintenanceItems: a.maintenanceItems.map(m => (m.id === doneInst.id ? { ...m, lastPerformed: '2026-11-02' } : m)) }));
  const synced = H.recurringSyncLastDone(edited, 'cfg');
  check('an earlier Completed date moves the config last performed back', items(synced).find(m => m.id === 'cfg').lastPerformed === '2026-11-02');
}
check('editing a Completed date re-syncs the config and offers the due date', /else if \(original\.lastPerformed && updated\.lastPerformed && original\.lastPerformed !== updated\.lastPerformed\) \{[\s\S]{0,900}recurringSyncLastDone\(next, original\.recurringId\)[\s\S]{0,900}dueAsk = \{/.test(src));
check('the prompt comes BEFORE the save: nothing persists until the person answers', /if \(dueAsk && !dueChoice\) \{ setRecurringDueAsk\(dueAsk\); return; \}[\s\S]{0,900}await persist\(next/.test(src));
check('Update writes the due date and an audit row in the same save; Keep and Cancel do not touch it', /dueChoice === "update"\)[\s\S]{0,700}dueDate: dueAsk\.to[\s\S]{0,700}— Due date/.test(src) && /saveMaintenanceEdit\(true, "keep"\)/.test(src) && /saveMaintenanceEdit\(true, "update"\)/.test(src));
check('Cancel on the prompt only closes it', /onClick=\{\(\) => setRecurringDueAsk\(null\)\} style=[^\n]*>Cancel<\/button>/.test(src));
check('a quick completion refreshes an open dialog draft', /else \{ setMaintenanceDraft\(d => \(d && d\.id === itemId \? \{ \.\.\.d, lastPerformed: date \} : d\)\); setMaintenanceBaseline/.test(src));
// Converting old schedules
{
  const old = [{ id: 'S', type: 'Room', maintenanceItems: [
    { id: 's1', kind: 'scheduled', task: 'Old filter', frequencyLabel: 'Weekly', frequencyDays: 7, lastPerformed: '2026-11-01', notes: 'n' },
    { id: 's1c', kind: 'oneoff', task: 'Check seal', parentTaskId: 's1', lastPerformed: '' },
    { id: 's2', kind: 'scheduled', task: 'Never done', frequencyLabel: 'Monthly', frequencyDays: 30, lastPerformed: '' },
    { id: 'new', kind: 'scheduled', instanced: true, task: 'Already new', frequencyDays: 7 },
    { id: 'plain', kind: 'oneoff', task: 'One-off' } ] }];
  check('only old-model schedules are offered', H.legacyScheduleRows(old).map(r => r.item.id).join() === 's1,s2');
  const res = H.convertSchedulesToRecurring(old, 'Eric');
  const its = res.assets[0].maintenanceItems;
  const inst = its.find(m => m.id === 's1');
  const cfgN = its.find(m => m.id === inst.recurringId);
  check('the row keeps its id and becomes the open instance due at its next due date', inst.kind === 'oneoff' && !inst.lastPerformed && inst.dueDate === '2026-11-08' && !inst.frequencyDays);
  check('a configuration takes the frequency and last performed', cfgN && cfgN.instanced && cfgN.kind === 'scheduled' && cfgN.frequencyDays === 7 && cfgN.lastPerformed === '2026-11-01');
  check('its subtasks stay and are copied as the template', its.filter(m => m.task === 'Check seal').length === 2 && its.some(m => m.task === 'Check seal' && m.parentTaskId === cfgN.id));
  check('a never-done schedule becomes an instance due today', its.find(m => m.id === 's2').dueDate === (() => { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); })());
  check('count, audit rows, and nothing left to convert', res.count === 2 && res.entries.length === 2 && H.legacyScheduleRows(res.assets).length === 0);
  check('the already-new task and the one-off are untouched', JSON.stringify(its.find(m => m.id === 'new')) === JSON.stringify(old[0].maintenanceItems[3]) && JSON.stringify(its.find(m => m.id === 'plain')) === JSON.stringify(old[0].maintenanceItems[4]));
}
check('the Settings card and handler wire the conversion into one save', /convertSchedulesToRecurring\(assets, currentUser\)[\s\S]{0,300}await persist\(res\.assets, \{ auditLog: logAudit\(res\.entries\) \}\)/.test(src) && /Convert \{old\.length\} to repeating/.test(src));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
