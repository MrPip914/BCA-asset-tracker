// Task dependencies (blocked by). Runs the REAL helpers sliced from index.html, plus source checks on the wiring.
// Run: node test-frontend-dependencies.js
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
  fn('taskIndexOf'), fn('taskOpenBlockers'), fn('taskIsBlocked'), fn('blockedByWouldLoop'),
  'return { taskIndexOf, taskOpenBlockers, taskIsBlocked, blockedByWouldLoop };',
].join('\n'))();

const t = (id, extra = {}) => ({ id, task: id, kind: 'oneoff', lastPerformed: '', ...extra });
const assets = [
  { id: 'A', maintenanceItems: [t('paint'), t('prime', { blockedBy: ['paint'] }), t('hang', { blockedBy: ['prime', 'gone'] }), t('free')] },
  { id: 'B', maintenanceItems: [t('quote', { lastPerformed: '2026-10-01' }), t('order', { blockedBy: ['quote'] }), t('weekly', { kind: 'scheduled' }), t('sched-blocked', { kind: 'scheduled', blockedBy: ['paint'] }), t('onweekly', { blockedBy: ['weekly'] }), t('self', { blockedBy: ['self'] })] },
];
const ix = H.taskIndexOf(assets);
const item = id => ix.get(id).item;
check('blocked while the blocker is open', H.taskIsBlocked(ix, item('prime')));
check('a task with no blockers is free', !H.taskIsBlocked(ix, item('free')));
check('a finished blocker stops blocking', !H.taskIsBlocked(ix, item('order')));
check('a deleted blocker is ignored, a live one still counts', H.taskOpenBlockers(ix, item('hang')).map(b => b.item.id).join() === 'prime');
check('blockers are found across assets', (() => { const l = [{ id: 'X', maintenanceItems: [t('a', { blockedBy: ['b'] })] }, { id: 'Y', maintenanceItems: [t('b')] }]; return H.taskIsBlocked(H.taskIndexOf(l), l[0].maintenanceItems[0]); })());
check('a scheduled task is never blocked', !H.taskIsBlocked(ix, item('sched-blocked')));
check('a scheduled task never blocks', !H.taskIsBlocked(ix, item('onweekly')));
check('a task cannot block itself', !H.taskIsBlocked(ix, item('self')));
check('a finished task is not "blocked"', !H.taskIsBlocked(ix, { ...item('prime'), lastPerformed: '2026-10-05' }));
check('loop check: direct and through a chain', H.blockedByWouldLoop(ix, 'paint', 'prime') && H.blockedByWouldLoop(ix, 'paint', 'hang') && H.blockedByWouldLoop(ix, 'paint', 'paint'));
check('loop check: unrelated tasks are fine', !H.blockedByWouldLoop(ix, 'free', 'paint') && !H.blockedByWouldLoop(ix, 'prime', 'free'));
const cyc = [{ id: 'C', maintenanceItems: [t('p', { blockedBy: ['q'] }), t('q', { blockedBy: ['p'] })] }];
check('a loop in bad data terminates', H.blockedByWouldLoop(H.taskIndexOf(cyc), 'z', 'p') === false);

check('save paths: add writes it only for a one-off, edit clears it for a schedule',
  /\.\.\.\(oneOff && \(maintenanceDraft\.blockedBy \|\| \[\]\)\.length \? \{ blockedBy/.test(src) && /blockedBy: oneOff \? \[\.\.\.\(maintenanceDraft\.blockedBy \|\| \[\]\)\] : \[\]/.test(src));
check('the edit is audited as Blocked by', /mkEntry\("Blocked by"/.test(src));
check('completing a blocked task asks, naming the blockers', /taskOpenBlockers\(index, \(index\.get\(itemId\) \|\| \{\}\)\.item\)/.test(src) && /Blocked by \{parentCompleteAsk\.blockers\.join/.test(src));
check('the picker leaves out loops, the task itself and finished tasks', /blockedByWouldLoop\(tIndex, maintenanceDraft\.id, id\)/.test(src) && /id === maintenanceDraft\.id/.test(src));
check('Blocked and Blocked by are view fields', /key: "blocked", label: "Blocked"/.test(src) && /case "blocked":/.test(src) && /case "blockedBy":/.test(src));
check('the Supabase save keeps blockedBy', /"blockedBy"/.test(fs.readFileSync(path.join(__dirname, 'supabase/functions/asset-api/save-shape.ts'), 'utf8')));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
