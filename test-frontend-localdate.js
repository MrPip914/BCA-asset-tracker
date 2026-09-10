// Guards localDateString() — the helper that stamps a date-only field with the
// day it is in the VIEWER'S timezone.
//
// This needs a permanent test because the bug it fixes is invisible to every
// normal way of checking. `new Date().toISOString().slice(0, 10)` takes the UTC
// date, so west of UTC it stamps TOMORROW for the last hours of every evening --
// which means:
//
//   - a daytime test passes, always. UTC and local agree until 5pm Pacific.
//   - the value sits next to a change entry's `at`, which IS timezone-aware and
//     renders correctly in local time, so a wrong date sits beside a right time
//     and looks fine.
//   - nothing downstream can detect it: a date-only field carries no timezone
//     and is displayed verbatim, so whatever was stamped is what the user sees
//     forever, and a maintenance item completed Tuesday evening falls due a day
//     late from a Wednesday it was never done on.
//
// Eric hit exactly this: he tested at 08:45 and correctly reported the time
// showing as local, which proved nothing about the date. Hence the test.
//
// The function is SLICED OUT of index.html rather than reimplemented, so this
// tests the real helper and a regression there fails here.
//
// Run: node test-frontend-localdate.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const start = src.indexOf('function localDateString(d) {');
if (start === -1) throw new Error('localDateString not found in index.html');
const fnSrc = src.slice(start, src.indexOf('\n}', start) + 2);
const localDateString = new Function(fnSrc + '\nreturn localDateString;')();

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};

// Every hour of one local day must report that same local day. The hours after
// ~17:00 are the ones the old toISOString() form got wrong at UTC-7; the early
// hours are the ones it would get wrong EAST of UTC, so both ends are covered
// wherever this runs.
{
  let wrong = [];
  for (let h = 0; h < 24; h++) {
    const d = new Date(2026, 8, 10, h, 30); // Sep 10 2026, local
    if (localDateString(d) !== '2026-09-10') wrong.push(`${h}:30 -> ${localDateString(d)}`);
  }
  check('every hour of a local day reports that local day', wrong.length === 0, wrong.join(', '));
}

// Rollovers are where an off-by-one day becomes an off-by-one month or YEAR --
// the old form turned 23:30 on Dec 31 into next year.
[
  ['month end', new Date(2026, 8, 30, 23, 30), '2026-09-30'],
  ['year end', new Date(2026, 11, 31, 23, 30), '2026-12-31'],
  ['leap day', new Date(2028, 1, 29, 23, 30), '2028-02-29'],
  ['first hour of a month', new Date(2026, 9, 1, 0, 30), '2026-10-01'],
].forEach(([name, d, want]) => {
  check(`${name}: ${want}`, localDateString(d) === want, `got ${localDateString(d)}`);
});

// Zero-padding: a bare getMonth()+1 would emit "2026-9-5", which is not a valid
// value for <input type="date"> and sorts wrongly as a string.
{
  const got = localDateString(new Date(2026, 4, 5, 12, 0));
  check('pads month and day to two digits', got === '2026-05-05', `got ${got}`);
  check('output matches yyyy-MM-dd exactly', /^\d{4}-\d{2}-\d{2}$/.test(got), `got ${got}`);
}

// No argument means now -- the completion form calls it that way.
{
  const now = new Date();
  const want = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  check('no argument defaults to today, locally', localDateString() === want, `got ${localDateString()}, want ${want}`);
}

// An invalid Date must not produce the string "NaN-NaN-NaN", which would be
// written to the sheet and read back as a real value.
check('an invalid Date yields ""', localDateString(new Date('nonsense')) === '',
      `got ${JSON.stringify(localDateString(new Date('nonsense')))}`);

// And the call sites must actually use it: a reintroduced toISOString() date
// stamp is the whole bug coming back, and it would pass every test above.
{
  const offenders = (src.match(/toISOString\(\)\.slice\(0, ?10\)/g) || []).length;
  // One occurrence is expected: the helper's own comment explains the trap by
  // naming it. Any more means a real call site went back to the broken form.
  check('no call site stamps a date-only value via toISOString()', offenders <= 1,
        `found ${offenders} occurrences (1 is the explanatory comment)`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
