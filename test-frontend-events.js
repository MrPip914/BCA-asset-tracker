// Events: a task type that completes as "event". Runs the REAL helpers sliced from index.html, plus source checks on the wiring.
// Run: node test-frontend-events.js
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};
const fn = name => { const a = src.indexOf('function ' + name + '('); if (a < 0) throw new Error(name); return src.slice(a, src.indexOf('\n}', a) + 2); };
const cst = name => { const a = src.indexOf('const ' + name + ' ='); if (a < 0) throw new Error(name); return src.slice(a, src.indexOf('\n];', a) + 3); };
const H = new Function([
  'const DEFAULT_WORK_TYPE_ID = "__default";',
  fn('dateOnly'), 'function localDateString(d) { const x = d || new Date(); return x.toISOString().slice(0, 10); }',
  'function resolveWorkTypeId(model, kind, id) { return id || DEFAULT_WORK_TYPE_ID; }',
  'function workModelParts(model) { return { settings: model.taskTypeSettings || {} }; }',
  'const TASK_KIND_SCHEDULED = "scheduled"; const TASK_KIND_ONEOFF = "oneoff";',
  fn('taskKindOf'), fn('isOneOffTask'), fn('taskIsDone'), fn('taskDueDate'), fn('taskStartDate'), fn('taskDoOnDate'), fn('taskNotStarted'),
  'function taskDateOf(item, k) { return dateOnly(item && item[k]); }',
  'function parseRecurrence() { return null; }',
  fn('maintenanceStatusOf'),
  cst('TASK_COMPLETION_MODES'), fn('taskCompletionMode'), fn('setTaskCompletionMode'),
  'let EVENT_MODEL = null;', fn('applyEventModel'), fn('taskIsEvent'), fn('taskEventEnd'), fn('taskStatusFinished'), fn('taskStatusCounts'), fn('taskStatusOf'),
  'function calendarDayAdd(day, n) { const d = new Date(day + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }',
  fn('templateRepeatDays'),
  'return { templateRepeatDays, taskStatusOf, taskIsEvent, applyEventModel, taskEventEnd, taskStatusFinished, taskStatusCounts, taskCompletionMode, setTaskCompletionMode, TASK_COMPLETION_MODES };',
].join('\n'));
let H1;
try { H1 = H(); } catch (e) { console.log('FAIL  could not slice helpers: ' + e.message); process.exit(1); }
const model = { taskTypeSettings: { ev: { completion: 'event' } } };
H1.applyEventModel(model);
const today = new Date().toISOString().slice(0, 10);
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const ev = (extra = {}) => ({ id: 'e', task: 'Service', kind: 'oneoff', taskType: 'ev', lastPerformed: '', ...extra });

check('event is a completion mode', H1.TASK_COMPLETION_MODES.some(m => m.value === 'event') && H1.taskCompletionMode(model, 'ev') === 'event');
check('a task of another type is not an event', !H1.taskIsEvent({ id: 'x', kind: 'oneoff', taskType: 'other' }) && !H1.taskIsEvent(null));
check('a future or today event reads "event"', H1.taskStatusOf(ev({ doOn: day(3) })) === 'event' && H1.taskStatusOf(ev({ doOn: today })) === 'event');
check('an undated event reads "event", never "undated" or "never"', H1.taskStatusOf(ev()) === 'event');
check('an event is never overdue, however old its due date', H1.taskStatusOf(ev({ dueDate: '2020-01-01' })) === 'past');
check('an event is past only after its LAST date', H1.taskStatusOf(ev({ doOn: day(-1), dueDate: day(2) })) === 'event' && H1.taskStatusOf(ev({ startDate: day(-5), doOn: day(-3) })) === 'past');
check('an event with a completion date is still an event', H1.taskStatusOf(ev({ doOn: day(2), lastPerformed: '2020-01-01' })) === 'event');
check('past events are finished, upcoming ones are open but not counted', H1.taskStatusFinished('past') && !H1.taskStatusFinished('event') && !H1.taskStatusCounts('event') && !H1.taskStatusCounts('past') && !H1.taskStatusCounts('done') && H1.taskStatusCounts('overdue'));
H1.applyEventModel({ taskTypeSettings: {} });
check('switching the type back makes it an ordinary task again', H1.taskStatusOf(ev({ dueDate: '2020-01-01' })) === 'overdue');
check('setTaskCompletionMode stores and clears event', H1.setTaskCompletionMode({ taskTypeSettings: {} }, 't', 'event').taskTypeSettings.t.completion === 'event' && !('completion' in H1.setTaskCompletionMode(model, 'ev', 'required').taskTypeSettings.ev));

// Repeat weekly
check('repeat adds one date a week on the same weekday', JSON.stringify(H1.templateRepeatDays('2026-11-15', 3, ['2026-11-15'])) === '["2026-11-22","2026-11-29","2026-12-06"]');
check('repeat skips dates already chosen', JSON.stringify(H1.templateRepeatDays('2026-11-15', 2, ['2026-11-15', '2026-11-22'])) === '["2026-11-29"]');
check('repeat is capped at 52 weeks and at least 1', H1.templateRepeatDays('2026-11-15', 500, []).length === 52 && H1.templateRepeatDays('2026-11-15', 0, []).length === 1 && H1.templateRepeatDays('', 4, []).length === 0);
check('the dialog offers the repeat from the latest date', /templateRepeatDays\(days\[days\.length - 1\], repeatWeeks \|\| 1, dialog\.days\)/.test(src) && /data-repeat-weekly/.test(src));

// Wiring
check('adoptWorkModel keeps the event mode', /st\.completion === "simple" \|\| st\.completion === "event"/.test(src));
check('the app reads the model at the top of render', /applyPersonNameOrder\(personNameOrder\);\s*applyEventModel\(workModel\);/.test(src));
check('allMaintenanceRows recomputes when the model changes', /\}, \[assets, personNameOrder, workModel\]\);/.test(src));
check('every status call site uses taskStatusOf', (src.match(/maintenanceStatusOf\(/g) || []).length === 2 && (src.match(/taskStatusOf\(/g) || []).length >= 6);
check('the Tasks badge counts only work to do', /allOpenMaintenanceRows = allMaintenanceRows\.filter\(r => taskStatusCounts\(r\.status\)\)/.test(src) && /count: countedMaintenanceItems\.length/.test(src));
check('the done circle becomes a calendar mark for an event', /function TaskDoneCircle[\s\S]{0,300}taskIsEvent\(row\.item\)\) return <CalendarDays/.test(src));
check('every completing door refuses an event', /toggleTaskDone\(row\) \{[\s\S]{0,200}taskIsEvent\(item\)/.test(src) && /async function completeTaskQuick[\s\S]{0,600}if \(taskIsEvent\(item\)\) return;/.test(src));
check('dialog and card buttons are hidden for an event', (src.match(/if \(mode === "event"\) return null;/g) || []).length === 2);
check('Add event is in both + menus', (src.match(/label: "Add event"/g) || []).length === 2);
check('the statuses are filterable and shown', /value: "event", label: "Event"/.test(src) && /past: \{ label: "Past"/.test(src));
check('the connector copy of the status rule is untouched', !/taskIsEvent/.test(fs.readFileSync(path.join(__dirname, 'supabase/functions/mcp/from-app.js'), 'utf8')));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
