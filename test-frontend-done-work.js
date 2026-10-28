// The done circle and logged work: helpers run for real, wiring read as source.
// Run: node test-frontend-done-work.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
let pass = 0, fail = 0;
const check = (n, ok) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + n); ok ? pass++ : fail++; };
const block = (from, to) => { const a = src.indexOf(from); return src.slice(a, src.indexOf(to, a)); };

const helpers = block('function taskWorkEntries', '// When this task is due');
const dateOnly = d => String(d || '').slice(0, 10);
const f = new Function('dateOnly', helpers + '; return { taskWorkEntries, taskCompletionWork, taskWorkSummary };')(dateOnly);
const item = { id: 't1', lastPerformed: '2026-10-28' };
const asset = { changes: [
  { id: 'c1', maintenanceId: 't1', performedOn: '2026-10-28', cost: '100' },
  { id: 'c2', maintenanceId: 't1', performedOn: '2026-10-01', cost: '20.5' },
  { id: 'c3', maintenanceId: 'other', performedOn: '2026-10-28' },
] };
check('work entries are those naming the task', f.taskWorkEntries(asset, item).length === 2);
check('the completion is the entry on the completed date', f.taskCompletionWork(asset, item).map(c => c.id).join() === 'c1');
check('an open task has no completion work', f.taskCompletionWork(asset, { id: 't1', lastPerformed: '' }).length === 0);
check('summary counts entries and cost', f.taskWorkSummary(asset, item) === '2 work entries, $120.50');
check('summary is blank with no work', f.taskWorkSummary({ changes: [] }, item) === '');

const toggle = block('function toggleTaskDone', 'async function deleteMaintenanceItem');
check('unticking with completion work asks first', /taskCompletionWork\(row\.asset, item\)/.test(toggle) && /setReopenAsk\(/.test(toggle));
const reopen = block('async function reopenTask', 'function toggleTaskDone');
check('reopen deletes only completion work, and only on request', /dropWork \? new Set\(taskCompletionWork/.test(reopen) && /changes: dropIds\.size/.test(reopen));
const del = block('async function deleteChange', 'function getAllocatedTotal');
check('deleting a completing entry can reopen the task in the same save', /reopen \? completedTaskOf/.test(del) && /lastPerformed: ""/.test(del) && (del.match(/await persist\(/g) || []).length === 1);
check('re-completing a task with work warns', /prior > 0|prior === 0/.test(block('function guardComplete', 'async function addMaintenanceItem')));
check('Completed row shows the work summary', /taskWorkSummary\(workTarget, taskItem\)/.test(src));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
