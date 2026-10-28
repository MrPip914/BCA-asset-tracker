// Parent / child tasks. Runs the REAL helpers sliced from index.html, plus source checks on the wiring.
// Run: node test-frontend-subtasks.js
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
  'function formatDateOnly(s) { return s; }',
  cst('TASK_MAX_DEPTH'), fn('taskIndexOf'), fn('taskChildrenOf'), fn('taskDepthOf'), fn('canAddSubtaskTo'),
  fn('taskDescendantsOf'), fn('taskProgressOf'), fn('resetSubtasks'),
  'return { taskIndexOf, taskChildrenOf, taskDepthOf, canAddSubtaskTo, taskDescendantsOf, taskProgressOf, resetSubtasks };',
].join('\n'))();

const t = (id, extra = {}) => ({ id, task: id, kind: 'oneoff', lastPerformed: '', ...extra });
const assets = [
  { id: 'A', type: 'Room', maintenanceItems: [t('event'), t('setup', { parentTaskId: 'event' }), t('chairs', { parentTaskId: 'setup', lastPerformed: '2026-10-01' }), t('deep', { parentTaskId: 'chairs' })] },
  { id: 'B', type: 'Room', maintenanceItems: [t('lights', { parentTaskId: 'event', lastPerformed: '2026-10-02' }), t('orphan', { parentTaskId: 'gone' }), t('weekly', { kind: 'scheduled' })] },
];
const ids = rows => rows.map(r => r.item.id).sort();
check('children are found across assets', ids(H.taskChildrenOf(assets, 'event')).join() === 'lights,setup');
check('descendants go all the way down, across assets', ids(H.taskDescendantsOf(assets, 'event')).join() === 'chairs,deep,lights,setup');
check('progress counts direct children done', JSON.stringify(H.taskProgressOf(assets, 'event')) === '{"done":1,"total":2}');
const ix = H.taskIndexOf(assets);
check('depth: top 1, then 2, 3, 4', ['event', 'setup', 'chairs', 'deep'].map(i => H.taskDepthOf(ix, ix.get(i).item)).join() === '1,2,3,4');
check('subtasks allowed to depth 3 only', H.canAddSubtaskTo(ix, ix.get('event').item) && H.canAddSubtaskTo(ix, ix.get('setup').item) && !H.canAddSubtaskTo(ix, ix.get('chairs').item));
check('a dangling parent reads as top level', H.taskDepthOf(ix, ix.get('orphan').item) === 2 - 1);
const loop = [{ id: 'L', maintenanceItems: [t('p', { parentTaskId: 'q' }), t('q', { parentTaskId: 'p' })] }];
check('a loop in bad data terminates', H.taskDescendantsOf(loop, 'p').length === 1 && H.taskDepthOf(H.taskIndexOf(loop), loop[0].maintenanceItems[0]) <= 3);
const r = H.resetSubtasks(assets, 'event', 'Eric');
check('resetting reopens only the finished ones below, on every asset', r.entries.length === 2 && r.assets[0].maintenanceItems[2].lastPerformed === '' && r.assets[1].maintenanceItems[0].lastPerformed === '');
check('reset writes an audit row for each', r.entries.every(e => e.action === 'maintenance_edited' && /Completed$/.test(e.field) && e.by === 'Eric'));
check('reset with nothing finished changes nothing', H.resetSubtasks([{ id: 'X', maintenanceItems: [t('a'), t('b', { parentTaskId: 'a' })] }], 'a', '').assets.length === 1);

check('a subtask is stored with its parent id, a child is always a one-off',
  /\|\| !!maintenanceDraft\.parentTaskId;/.test(src) && /\|\| !!original\.parentTaskId;/.test(src) && /\.\.\.\(maintenanceDraft\.parentTaskId \? \{ parentTaskId/.test(src));
check('delete cascades through descendants on every asset', /taskDescendantsOf\(assets, itemId\)/.test(src) && /This also deletes its/.test(src));
check('both completion paths reset a repeating parent', (src.match(/resetSubtasks\(next, itemId, currentUser\)/g) || []).length === 2);
check('completing asks when subtasks are open', /guardParentComplete\(maintenanceModal\.itemId/.test(src) && /guardParentComplete\(item\.id/.test(src) && /Complete anyway/.test(src));
check('Parent task is a view field', /key: "parent", label: "Parent task"/.test(src) && /case "parent":/.test(src));
check('the Supabase save keeps parentTaskId', /"parentTaskId"/.test(fs.readFileSync(path.join(__dirname, 'supabase/functions/asset-api/save-shape.ts'), 'utf8')));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
