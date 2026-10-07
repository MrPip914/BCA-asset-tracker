// Guards custom task frequencies (backend v52): "every N days/weeks/months/
// years" and "the Nth weekday of every N months".
//
// Every failure here is silent in the app -- a task simply shows the wrong due
// date, or a preset task quietly starts computing a different one. The rule
// helpers are SLICED OUT of index.html, so this tests the shipped code.
//
// Run: node test-frontend-recurrence.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const gs = fs.readFileSync(path.join(__dirname, 'AssetTrackerSync.gs'), 'utf8');

function sliceFn(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in index.html`);
  return src.slice(start, src.indexOf('\n}', start) + 2);
}
function sliceConst(name) {
  const start = src.indexOf(`const ${name} =`);
  return src.slice(start, src.indexOf('\n', start) + 1);
}
const block = src.slice(src.indexOf('const MAINTENANCE_FREQUENCIES ='), src.indexOf('// A field key named in ANY registry entry'));
const ctx = new Function([
  sliceConst('TASK_KIND_SCHEDULED'), sliceConst('TASK_KIND_ONEOFF'),
  block, sliceFn('dateOnly'), sliceFn('taskKindOf'), sliceFn('isOneOffTask'), sliceFn('taskDueDate'),
  'return { parseRecurrence, formatRecurrence, describeRecurrence, frequencyFromDraft, recurrenceToDraft, recurrenceFromDraft, nextRecurrenceDate, taskDueDate, MAINTENANCE_FREQUENCY_CUSTOM };',
].join('\n'))();
const R = ctx;

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};
const ymd = d => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null;
const due = (recurrence, lastPerformed, extra) => ymd(R.taskDueDate({ kind: 'scheduled', recurrence, lastPerformed, ...(extra || {}) }));
const eq = (name, got, want) => check(name, got === want, `got ${got}, want ${want}`);

// ---------- presets are untouched ----------
// A task saved before v52 has no recurrence at all; its due date must be the
// exact day arithmetic it always was, including Monthly's 30 days.
eq('a preset with no rule still adds frequencyDays', due(undefined, '2026-01-31', { frequencyDays: 30 }), '2026-03-02');
eq('a blank rule is the same as none', due('', '2026-01-01', { frequencyDays: 7 }), '2026-01-08');
eq('an unreadable rule falls back to the day count', due('interval:0:week', '2026-01-01', { frequencyDays: 7 }), '2026-01-08');
eq('an unreadable rule with no day count is simply undated', due('garbage', '2026-01-01', { frequencyDays: '' }), null);
eq('a never-performed custom task has no due date', due('interval:2:week', ''), null);

// ---------- interval rules ----------
eq('every 3 days', due('interval:3:day', '2026-02-27'), '2026-03-02');
eq('every 2 weeks', due('interval:2:week', '2026-10-07'), '2026-10-21');
eq('every month is a calendar month', due('interval:1:month', '2026-03-15'), '2026-04-15');
eq('a month clamps to the shorter month', due('interval:1:month', '2026-01-31'), '2026-02-28');
eq('every 18 months crosses a year', due('interval:18:month', '2026-08-10'), '2028-02-10');
eq('every 2 years', due('interval:2:year', '2026-05-01'), '2028-05-01');
eq('a leap day plus a year clamps', due('interval:1:year', '2028-02-29'), '2029-02-28');

// ---------- weekday rules ----------
// Oct 2026: Thu 1st, so first Monday is the 5th. Nov 2026: Sun 1st, first Monday 2nd.
eq('first Monday, done on the day -> next month', due('weekday:1:1:1', '2026-10-05'), '2026-11-02');
eq('first Monday, done a few days EARLY still counts for that month', due('weekday:1:1:1', '2026-10-02'), '2026-11-02');
eq('first Monday, done a few days LATE still counts for that month', due('weekday:1:1:1', '2026-10-08'), '2026-11-02');
// Last Friday of Oct 2026 is the 30th; of Nov, the 27th.
eq('last Friday done the following Monday counts for the month owed', due('weekday:-1:5:1', '2026-11-02'), '2026-11-27');
eq('last Friday on the day', due('weekday:-1:5:1', '2026-10-30'), '2026-11-27');
eq('third Wednesday every 3 months', due('weekday:3:3:3', '2026-10-21'), '2027-01-20');
eq('second Tuesday every 12 months', due('weekday:2:2:12', '2026-09-08'), '2027-09-14');
eq('fourth Sunday crosses a year', due('weekday:4:0:1', '2026-12-27'), '2027-01-24');

// ---------- the string format ----------
['interval:2:week', 'interval:1:day', 'interval:18:month', 'weekday:1:1:1', 'weekday:-1:5:3'].forEach(s =>
  eq(`round-trips ${s}`, R.formatRecurrence(R.parseRecurrence(s)), s));
['interval:1000:day', 'interval:2:fortnight', 'interval:1.5:week', 'weekday:5:1:1', 'weekday:1:7:1', 'weekday:1:1:0', 'weekday:1:1'].forEach(s =>
  check(`refuses ${s}`, R.parseRecurrence(s) === null));

// ---------- labels ----------
eq('label: every week', R.describeRecurrence(R.parseRecurrence('interval:1:week')), 'Every week');
eq('label: every 6 weeks', R.describeRecurrence(R.parseRecurrence('interval:6:week')), 'Every 6 weeks');
eq('label: first Monday monthly', R.describeRecurrence(R.parseRecurrence('weekday:1:1:1')), 'First Monday of every month');
eq('label: last Friday quarterly', R.describeRecurrence(R.parseRecurrence('weekday:-1:5:3')), 'Last Friday, every 3 months');

// ---------- what the form writes ----------
const preset = R.frequencyFromDraft({ frequency: 'Quarterly' });
check('a preset choice writes no rule', preset.recurrence === '' && preset.days === 90 && preset.label === 'Quarterly', JSON.stringify(preset));
const custom = R.frequencyFromDraft({ frequency: R.MAINTENANCE_FREQUENCY_CUSTOM, recurrence: { mode: 'weekday', ordinal: '1', weekday: '1', months: '1' } });
check('a custom choice writes rule, label and an approximate day count',
  custom.recurrence === 'weekday:1:1:1' && custom.label === 'First Monday of every month' && custom.days === 30, JSON.stringify(custom));
check('an incomplete custom choice writes NOTHING rather than a preset',
  R.frequencyFromDraft({ frequency: R.MAINTENANCE_FREQUENCY_CUSTOM, recurrence: { mode: 'interval', every: '', unit: 'week' } }) === null);
const back = R.recurrenceFromDraft(R.recurrenceToDraft(R.parseRecurrence('interval:5:year')));
eq('draft round-trip', R.formatRecurrence(back), 'interval:5:year');

// ---------- wiring ----------
check('both save paths write the rule',
  src.split('recurrence: oneOff ? "" : freq.recurrence').length - 1 === 2);
check('both save paths build the frequency through one function',
  src.split('const freq = frequencyFromDraft(maintenanceDraft);').length - 1 === 2);
check('Save stays disabled on an incomplete custom rule', /disabled=\{[^}]*maintenanceFrequencyOk/.test(src));
check('the backend keeps the column', /"recurrence"/.test(gs.slice(gs.indexOf('const MAINTENANCE_FIELDS'), gs.indexOf('];', gs.indexOf('const MAINTENANCE_FIELDS')))));
check('the backend reads AND writes it', gs.split('recurrence: m.recurrence || ""').length - 1 === 2);
check('MOCK_SNAPSHOT carries both rule shapes', /recurrence: "interval:/.test(src) && /recurrence: "weekday:/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
