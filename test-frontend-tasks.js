// Guards the scheduled/one-off split (v40) — the rules that let ONE record type
// hold both a recurring schedule and a non-recurring job or project.
//
// Every one of these fails SILENTLY in the app. A blank `kind` misread
// unpublishes nothing and throws nothing; it just quietly stops a legacy row
// being a schedule. A done task that still counts as overdue turns the badge
// into noise. And the sort trap below reads as "the list is in a weird order"
// rather than as a bug.
//
// The helpers are SLICED OUT of index.html rather than reimplemented, so this
// tests the shipped code and not a second copy of it.
//
// Run: node test-frontend-tasks.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function sliceFn(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in index.html`);
  return src.slice(start, src.indexOf('\n}', start) + 2);
}
function sliceConst(name) {
  const start = src.indexOf(`const ${name} =`);
  if (start === -1) throw new Error(`${name} not found in index.html`);
  return src.slice(start, src.indexOf('\n', start) + 1);
}

const ctx = new Function(
  [
    sliceConst('TASK_KIND_SCHEDULED'),
    sliceConst('TASK_KIND_ONEOFF'),
    sliceFn('dateOnly'),
    sliceFn('taskKindOf'),
    sliceFn('isOneOffTask'),
    sliceFn('taskIsDone'),
    sliceFn('taskDueDate'),
    sliceFn('maintenanceStatusOf'),
    sliceFn('maintenanceSortKey'),
    'return { taskKindOf, isOneOffTask, taskIsDone, taskDueDate, maintenanceStatusOf, maintenanceSortKey };',
  ].join('\n')
)();
const { taskKindOf, isOneOffTask, taskIsDone, taskDueDate, maintenanceStatusOf, maintenanceSortKey } = ctx;

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};

// Dates relative to today, so these assertions cannot rot into the past.
const day = 86400000;
const iso = ms => new Date(ms).toISOString().slice(0, 10);
const inDays = n => iso(Date.now() + n * day);

// ---------- a blank kind is a SCHEDULE ----------
// The whole no-migration story. Every row written before v40 has an empty kind
// cell, and every one of them really is a recurring schedule — that is knowable
// rather than assumed, because a schedule was the only thing this tab could
// hold. Read it the other way and every task on every existing sheet silently
// becomes a one-off with no due date: no next-due calculation, no overdue flag.
check('a blank kind reads as scheduled',
      taskKindOf({ task: 'Filter clean', frequencyDays: 30 }) === 'scheduled');
check('a missing kind key reads as scheduled',
      taskKindOf({}) === 'scheduled');
check('an unrecognised kind reads as scheduled, not as a one-off',
      taskKindOf({ kind: 'nonsense' }) === 'scheduled',
      'anything but the one known value must fall back to the safe reading');
check('an explicit oneoff is a one-off',
      isOneOffTask({ kind: 'oneoff' }) === true);

// ---------- done is lastPerformed, and there is no second column ----------
// If a `doneOn` field is ever reintroduced, these are what should fail first:
// done-ness must stay derived from the date the record already holds.
check('a one-off with a lastPerformed is done',
      taskIsDone({ kind: 'oneoff', lastPerformed: '2026-09-02' }) === true);
check('a one-off with no lastPerformed is open',
      taskIsDone({ kind: 'oneoff', lastPerformed: '' }) === false);
check('a SCHEDULE is never done, however often it has been performed',
      taskIsDone({ kind: 'scheduled', lastPerformed: '2026-09-02', frequencyDays: 30 }) === false,
      'being performed starts a schedule\'s next interval; it does not finish it');
check('a completed one-off survives a round trip through a full ISO timestamp',
      taskIsDone({ kind: 'oneoff', lastPerformed: '2026-09-02T07:00:00.000Z' }) === true,
      'Sheets can hand back a Date; dateOnly is what normalises it');

// ---------- due date by kind ----------
check('a schedule derives its due date from lastPerformed + frequencyDays',
      taskDueDate({ lastPerformed: '2026-01-01', frequencyDays: 30 }).getTime()
        === new Date('2026-01-31T00:00:00').getTime());
check('a one-off answers its own dueDate',
      taskDueDate({ kind: 'oneoff', dueDate: '2026-10-15' }).getTime()
        === new Date('2026-10-15T00:00:00').getTime());
// The two halves must not cross over. A one-off that somehow carries an
// interval (a hand-edited row, a kind flipped on an old record) must not start
// deriving a due date from a completion that ENDED it — that would resurrect a
// finished job as a recurring one.
check('a one-off ignores frequencyDays even when one is stored',
      taskDueDate({ kind: 'oneoff', dueDate: '', lastPerformed: '2026-01-01', frequencyDays: 30 }) === null,
      'a completion ENDS a one-off; deriving an interval from it resurrects a finished job');
check('a one-off with BOTH a dueDate and an interval answers the dueDate',
      taskDueDate({ kind: 'oneoff', dueDate: '2026-10-15', lastPerformed: '2026-01-01', frequencyDays: 30 }).getTime()
        === new Date('2026-10-15T00:00:00').getTime(),
      'the kind decides which half is read, never which half happens to be filled in');
check('a schedule ignores a stray dueDate',
      taskDueDate({ kind: 'scheduled', dueDate: '2026-10-15', lastPerformed: '', frequencyDays: 30 }) === null,
      'a schedule\'s due date is derived, or the two disagree on a back-dated completion');
check('an undated one-off has no due date at all',
      taskDueDate({ kind: 'oneoff', dueDate: '' }) === null);

// ---------- status ----------
check('a never-performed schedule is "never"',
      maintenanceStatusOf({ lastPerformed: '', frequencyDays: 30 }) === 'never');
check('an undated one-off is "undated", NOT "never"',
      maintenanceStatusOf({ kind: 'oneoff', dueDate: '' }) === 'undated',
      '"never" pins to the top of the list; a someday project must not');
check('a completed one-off is "done"',
      maintenanceStatusOf({ kind: 'oneoff', dueDate: '2026-08-29', lastPerformed: '2026-09-02' }) === 'done');
check('a completed one-off is "done" even when its due date is long past',
      maintenanceStatusOf({ kind: 'oneoff', dueDate: '2020-01-01', lastPerformed: '2020-02-01' }) === 'done',
      'done must win over overdue, or finished work keeps feeding the overdue badge');
check('a one-off past its due date is overdue',
      maintenanceStatusOf({ kind: 'oneoff', dueDate: inDays(-3) }) === 'overdue');
check('a one-off due within 14 days is due-soon',
      maintenanceStatusOf({ kind: 'oneoff', dueDate: inDays(5) }) === 'due-soon');
check('a one-off due well ahead is ok',
      maintenanceStatusOf({ kind: 'oneoff', dueDate: inDays(90) }) === 'ok');
check('an overdue schedule still reads overdue (the pre-v40 behaviour is intact)',
      maintenanceStatusOf({ lastPerformed: inDays(-40), frequencyDays: 30 }) === 'overdue');

// ---------- THE SORT TRAP ----------
// A null due date means two OPPOSITE things, and the same inline expression was
// correct for one and backwards for the other. Before v40 the default sort was
// `due ? due.getTime() : -Infinity`: a null pinned the row to the top, which is
// right for a schedule that has never been done and is exactly wrong for an
// undated project — it would sit above everything genuinely overdue.
const rows = [
  { name: 'done',     status: 'done',    due: new Date(Date.now() - 50 * day) },
  { name: 'undated',  status: 'undated', due: null },
  { name: 'ok',       status: 'ok',      due: new Date(Date.now() + 90 * day) },
  { name: 'overdue',  status: 'overdue', due: new Date(Date.now() - 3 * day) },
  { name: 'never',    status: 'never',   due: null },
];
const order = rows.slice().sort((a, b) => maintenanceSortKey(a) - maintenanceSortKey(b)).map(r => r.name);
check('default order is never, overdue, ok, undated, done',
      JSON.stringify(order) === JSON.stringify(['never', 'overdue', 'ok', 'undated', 'done']),
      'got ' + JSON.stringify(order));
check('an undated one-off sorts BELOW everything with a date',
      order.indexOf('undated') > order.indexOf('ok'),
      'the trap: a null due date must not read as "needs attention" for a one-off');
check('a never-performed schedule still sorts to the very top',
      order[0] === 'never');
check('a done task sorts last even though its date is the oldest',
      order[order.length - 1] === 'done');
check('the sort keys are finite enough to subtract without NaN',
      rows.every(r => Number.isFinite(maintenanceSortKey(r) - maintenanceSortKey(rows[2]))
                      || r.status === 'never'),
      'only "never" may be -Infinity; MAX_SAFE_INTEGER sentinels keep a-b meaningful');

// ---------- the source-level rules ----------
// These read index.html directly, because they are about wiring rather than
// about a function's return value.

// The default status filter. "Open" hides done; had this stayed "All statuses",
// every finished job would sit in the triage table forever, which is the whole
// reason a completed task is kept rather than deleted.
check('the Status filter defaults to Open, not All statuses',
      /useState\(MAINTENANCE_STATUS_OPEN\)/.test(src),
      'a finished job must leave the triage view without being destroyed');
check('"Open" is filtered as "not done", not matched as a status',
      /maintenanceStatusFilter === MAINTENANCE_STATUS_OPEN[\s\S]{0,120}r\.status === "done"/.test(src));

// The badges. maintenanceOverdueTotal already excludes done by construction
// (status is "done", not "overdue"), but the COUNTS beside the tab names have
// to be filtered explicitly or they grow with every job ever finished.
check('the top-level Tasks badge counts open rows only',
      /allOpenMaintenanceRows = allMaintenanceRows\.filter\(r => r\.status !== "done"\)/.test(src));
check('the detail Tasks badge counts open items only',
      /label: "Tasks", count: openMaintenanceItems\.length/.test(src));

// The detail card list has no status filter, so it needs its own way not to
// accumulate finished work.
check('the detail list hides completed tasks behind a toggle',
      /shownMaintenanceItems = showCompletedTasks \? maintenanceItems : openMaintenanceItems/.test(src));

// Every status renders through one map, or a new status reaches one list and
// silently misses another. The two card lists and the table all read it.
check('no list carries its own private copy of the status labels',
      src.split('never: { label: "Not yet done"').length - 1 === 1,
      'the status labels must live only in maintenanceStatusMeta');
check('maintenanceStatusMeta knows the two statuses v40 added',
      /undated: \{ label: "No date"/.test(src) && /done: \{ label: "Done"/.test(src));

// Writing the unused half BLANK is what stops the two descriptions crossing
// over when a kind is flipped. BOTH write paths have to do it -- add and edit --
// and counting is what catches one of them being changed back on its own, which
// a presence test cannot: the other call site keeps the pattern alive.
check('BOTH save paths clear the frequency on a one-off',
      src.split('frequencyLabel: oneOff ? "" : freq.label').length - 1 === 2,
      'add and edit both write it; found ' + (src.split('frequencyLabel: oneOff ? "" : freq.label').length - 1));
check('BOTH save paths clear the due date on a schedule',
      (src.match(/dueDate: oneOff \? \(maintenance(Draft|EditDraft)\.dueDate \|\| ""\) : ""/g) || []).length === 2);
check('BOTH save paths clear frequencyDays too',
      src.split('frequencyDays: oneOff ? "" : freq.days').length - 1 === 2,
      'the label and the day count are two fields, and only the day count drives taskDueDate');
check('an edit always writes an explicit kind rather than relying on the blank default',
      /kind: oneOff \? TASK_KIND_ONEOFF : TASK_KIND_SCHEDULED,/.test(src));

// ---------- the task dialog, and what it writes to ----------
// Tapping a task on the site-wide list used to open its ASSET, which is the
// long way round to the thing that was tapped. It opens the task itself now,
// with the asset as a link inside it. Every rule below fails silently: the
// dialog still opens, and writes land somewhere other than where they look.

// Brace-counting, because these live INSIDE the component and their closing
// brace is indented -- slicing to the first line-start `}` runs to the end of
// AssetTracker and makes every assertion below trivially true.
function body(name) {
  let i = src.indexOf(`function ${name}(`);
  if (i === -1) throw new Error(`${name} not found in index.html`);
  if (src.slice(i - 6, i) === 'async ') i -= 6;
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error(`${name} never closes`);
}

check('the site-wide task row opens the task, not the asset',
      /onClick=\{\(\) => \(canEdit \? openMaintenanceEdit\(item\.id, asset\.id\) : openDetail\(asset, "maintenance"\)\)\}/.test(src),
      'the row hands over its OWN asset; there is no open one to fall back to on the main page');

// The whole reason the dialog can be opened from the main page at all. Every
// one of these handlers read selectedAsset, which is null out there -- so a
// save would silently do nothing, and a completion would write to whatever
// asset happened to be open last.
for (const fn of ['saveMaintenanceEdit', 'submitMaintenanceComplete', 'deleteMaintenanceItem']) {
  // Comments stripped: several of these SAY "selectedAsset" while explaining
  // why they no longer read it.
  const b = body(fn).split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  check(`${fn} writes to workTarget, not to whatever asset is open`,
        b.includes('workTarget') && !/\bselectedAsset\b/.test(b) && !/\bselectedId\b/.test(b),
        'selectedAsset is null on the main page, where this is now reachable');
}

// Logging a completion leaves a draft holding the PREVIOUS lastPerformed on
// screen. Its Save would write that back over the completion just logged, with
// the form looking untouched.
check('logging a completion closes the task dialog behind it',
      /setMaintenanceCompleteModal\(null\);[\s\S]{0,400}?setMaintenanceModal\(null\);/.test(body('submitMaintenanceComplete')));
check('deleting a task closes the dialog it was deleted from',
      body('deleteMaintenanceItem').includes('setMaintenanceModal(null)'));

// Both of these are opened FROM the task dialog, so they have to render where
// it does. Left in the detail view they set state and paint nothing on the main
// page -- exactly the bug the photo lightbox had.
const rwAt = src.indexOf('function renderWorkDialogs');
const detailAt = src.indexOf('if (view === "detail" && selectedAsset)');
for (const [what, marker] of [['the delete confirmation', '{confirmMaintenanceDelete !== null && ('],
                              ['the completion form', '{maintenanceCompleteModal && (() => {']]) {
  const at = src.indexOf(marker);
  check(`${what} renders from renderWorkDialogs, not inside the detail view`,
        at > rwAt && at < detailAt);
}

// ONE form over these fields, not two. The add dialog and an inline edit form
// were separate copies until the dialog took both, which is the duplication
// changeModal exists to avoid.
check('there is no second task form left behind',
      !/maintenanceEditDraft/.test(src),
      'add and edit are one dialog over one draft');
check('the dialog serves both modes off the same save buttons',
      /onClick=\{editing \? saveMaintenanceEdit : addMaintenanceItem\}/.test(src));

// Clearing the completion date is the ONLY way to reopen a finished one-off --
// there is no done flag to unset. Offering it while ADDING one would invite
// logging a job as done in the act of creating it.
check('a one-off being edited can be reopened by clearing its date',
      /\{editing && \([\s\S]{0,1200}?Clear to reopen/.test(src));
check('the reopen field is editing-only',
      src.split('Clear to reopen').length - 1 === 1);

// The fixture. A uniform one exercises half the code — the personIds lesson.
const mock = src.slice(src.indexOf('const MOCK_SNAPSHOT'), src.indexOf('const MOCK_SNAPSHOT') + 200000);
check('MOCK_SNAPSHOT carries an open dated one-off',
      /kind: "oneoff"[^}]*dueDate: "20\d\d-\d\d-\d\d", lastPerformed: ""/.test(mock));
check('MOCK_SNAPSHOT carries an UNDATED one-off (the sort trap)',
      /kind: "oneoff"[^}]*dueDate: "", lastPerformed: ""/.test(mock));
check('MOCK_SNAPSHOT carries a COMPLETED one-off',
      /kind: "oneoff"[^}]*dueDate: "20\d\d-\d\d-\d\d", lastPerformed: "20\d\d-\d\d-\d\d"/.test(mock));
check('MOCK_SNAPSHOT still carries legacy rows with no kind at all',
      /\{ task: "Filter clean", frequencyLabel: "Monthly"/.test(mock),
      'the blank-reads-as-scheduled path must be exercised by the fixture too');

// The backend contract. Both projections move together or the column reads back
// as undefined with no error and no version mismatch.
const gs = fs.readFileSync(path.join(__dirname, 'AssetTrackerSync.gs'), 'utf8');
for (const f of ['kind', 'dueDate', 'notes']) {
  check(`MAINTENANCE_FIELDS declares ${f}`,
        new RegExp(`MAINTENANCE_FIELDS = \\[[\\s\\S]*?"${f}"[\\s\\S]*?\\];`).test(gs));
}
check('the backend declares no completion column beside lastPerformed',
      !/"doneOn"|"completedOn"/.test(gs),
      'done-ness is derived from lastPerformed; a second date is a second copy of one fact');
check('SCRIPT_VERSION and FRONTEND_SCRIPT_VERSION agree',
      (gs.match(/const SCRIPT_VERSION = "(v\d+)"/) || [])[1]
        === (src.match(/const FRONTEND_SCRIPT_VERSION = "(v\d+)"/) || [])[1]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
