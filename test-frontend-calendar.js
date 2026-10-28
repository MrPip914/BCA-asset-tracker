// Calendar view type. Runs the REAL helpers sliced from index.html, plus source checks on the wiring.
// Run: node test-frontend-calendar.js
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
  cst('TASK_KIND_SCHEDULED'), cst('TASK_KIND_ONEOFF'), cst('CALENDAR_MODES'), fn('dateOnly'), fn('localDateString'), fn('taskKindOf'), fn('isOneOffTask'), fn('taskIsDone'),
  fn('calendarDayAdd'), fn('calendarRange'), fn('calendarShift'), fn('calendarPlacement'), fn('calendarLayout'), fn('calendarCanSchedule'),
  'return { calendarDayAdd, calendarRange, calendarShift, calendarPlacement, calendarLayout, calendarCanSchedule };',
].join('\n'))();

const row = (id, item, due) => ({ asset: { id: 'A' }, item: { id, task: id, kind: 'oneoff', lastPerformed: '', ...item }, due: due ? new Date(due + 'T00:00:00') : null, status: 'ok' });

// Ranges
const oct = H.calendarRange('month', '2026-10-15');
check('a month fills whole Sunday-first weeks', oct.from === '2026-09-27' && oct.to === '2026-10-31' && oct.days.length === 35 && oct.weeks.length === 5);
const wk = H.calendarRange('week', '2026-10-28');
check('a week is Sunday to Saturday', wk.from === '2026-10-25' && wk.to === '2026-10-31' && wk.days.length === 7);
check('shifting moves a month by month and a week by seven days', H.calendarShift('month', '2026-12-20', 1) === '2027-01-01' && H.calendarShift('month', '2026-01-31', -1) === '2025-12-01' && H.calendarShift('week', '2026-10-28', 1) === '2026-11-04');

// Placement
const P = r => H.calendarPlacement(r);
check('Scheduled for wins over the due date', JSON.stringify(P(row('a', { doOn: '2026-10-12', dueDate: '2026-10-20' }))) === JSON.stringify({ kind: 'day', date: '2026-10-12', via: 'doOn' }));
check('start + due with no Scheduled for is a span', JSON.stringify(P(row('b', { startDate: '2026-10-05', dueDate: '2026-10-09' }))) === JSON.stringify({ kind: 'span', from: '2026-10-05', to: '2026-10-09' }));
check('only a due date is a day', P(row('c', { dueDate: '2026-10-09' })).date === '2026-10-09');
check('a start date alone is a day', P(row('d', { startDate: '2026-10-03' })).via === 'start');
check('no dates is unplaced', P(row('e', {})) === null);
check('a schedule sits on its derived due date, and ignores stray one-off dates', (() => { const p = P(row('f', { kind: 'scheduled', doOn: '2026-10-01' }, '2026-10-22')); return p.date === '2026-10-22' && p.via === 'due'; })());
check('a schedule never done has no place', P(row('g', { kind: 'scheduled' })) === null);

// Layout
const rows = [row('day', { doOn: '2026-10-12' }), row('span', { startDate: '2026-10-05', dueDate: '2026-10-09' }), row('out', { doOn: '2027-01-01' }), row('none', {}), row('far-span', { startDate: '2026-12-01', dueDate: '2026-12-05' }), row('edge-span', { startDate: '2026-10-29', dueDate: '2026-11-04' })];
const L = H.calendarLayout(rows, oct);
check('a task lands in its day cell', L.byDay['2026-10-12'].length === 1 && L.byDay['2026-10-12'][0].row.item.id === 'day');
check('a task outside the window is left out, not lost into another day', Object.values(L.byDay).flat().length === 1);
check('spans touching the window are kept, others dropped', L.spans.map(s => s.row.item.id).sort().join() === 'edge-span,span');
check('an undated task is listed', L.undated.map(r => r.item.id).join() === 'none');

// Dragging
check('only an open one-off can be scheduled', H.calendarCanSchedule(row('x', {})) && !H.calendarCanSchedule(row('y', { lastPerformed: '2026-10-01' })) && !H.calendarCanSchedule(row('z', { kind: 'scheduled' })));

// Wiring
check('the view type is stored and adopted', /VIEW_TYPE_CALENDAR = "calendar"/.test(src) && /v\.type === VIEW_TYPE_CALENDAR \? VIEW_TYPE_CALENDAR/.test(src));
check('ViewBody renders the calendar for that type', /calendar \? \(\s*<CalendarView view=\{view\}/.test(src));
check('the editor offers Calendar and hides ordering and grouping for it', /\[VIEW_TYPE_CALENDAR, "Calendar"\]/.test(src) && (src.match(/\{!calendar && <>/g) || []).length === 2);
check('only editors get the drag handler', /onSchedule=\{canEdit \? \(key, day\) => setTaskDoOn\(key, day\) : undefined\}/.test(src) && /!!onSchedule && calendarCanSchedule\(r\)/.test(src));
check('a drag writes doOn and an audit row', (() => { const a = src.indexOf('async function setTaskDoOn'); const b = src.slice(a, a + 1500); return /doOn: day/.test(b) && /Scheduled for/.test(b) && /maintenance_edited/.test(b) && /isOneOffTask\(item\)/.test(b); })());
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
