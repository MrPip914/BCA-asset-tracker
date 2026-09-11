// Guards changePerformedOn() — the resolver that answers "when did this change
// actually happen", and the reason no backfill was needed when performedOn
// arrived in v34.
//
// A change entry now carries TWO dates that answer different questions:
//   `at`          — when the entry was TYPED. Never edited, pairs with `by`.
//   `performedOn` — when the WORK happened. Editable, defaults to today.
//
// Keeping them apart is what lets a job finished in August and written up in
// September record both facts. It is also what makes a change entry able to mark
// a maintenance task performed: an editable date is the one thing an automatic
// stamp could never get right.
//
// Every row written before v34 has only `at`, and the date part of it is what
// such a row always implicitly meant — so that is the fallback, applied at read
// time. Get this wrong and every historical change entry either shows a blank
// date or silently reports the wrong day, on a Sheet nobody can tell is wrong
// by looking at it.
//
// The function is SLICED OUT of index.html rather than reimplemented.
//
// Run: node test-frontend-performedon.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function sliceFn(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in index.html`);
  return src.slice(start, src.indexOf('\n}', start) + 2);
}
// changePerformedOn calls dateOnly, so both are needed.
const ctx = new Function(sliceFn('dateOnly') + '\n' + sliceFn('changePerformedOn') + '\nreturn { dateOnly, changePerformedOn };')();
const { changePerformedOn } = ctx;

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};

// The ordinary case: an explicit performedOn wins, and is NOT overridden by the
// logged timestamp even when they are far apart. This is the whole feature.
check('an explicit performedOn wins over at',
      changePerformedOn({ performedOn: '2026-05-28', at: '2026-07-15T16:20:00.000Z' }) === '2026-05-28',
      `got ${changePerformedOn({ performedOn: '2026-05-28', at: '2026-07-15T16:20:00.000Z' })}`);

// A pre-v34 row: no performedOn at all. Falls back to the DATE part of at.
[
  ['absent', { at: '2026-02-11T19:40:00.000Z' }],
  ['empty string', { performedOn: '', at: '2026-02-11T19:40:00.000Z' }],
  ['undefined', { performedOn: undefined, at: '2026-02-11T19:40:00.000Z' }],
].forEach(([shape, ch]) => {
  check(`a pre-v34 row (performedOn ${shape}) falls back to at's date`,
        changePerformedOn(ch) === '2026-02-11', `got ${JSON.stringify(changePerformedOn(ch))}`);
});

// Sheets turns a date-looking cell into a real Date, which reads back as a full
// ISO timestamp — the hazard dateOnly() exists for. A round-tripped performedOn
// must still resolve to a plain date, or it lands in an <input type="date"> as
// a value the browser silently refuses to display.
check('a performedOn that round-tripped through Sheets is sliced back to a date',
      changePerformedOn({ performedOn: '2026-06-03T07:00:00.000Z', at: 'x' }) === '2026-06-03',
      `got ${changePerformedOn({ performedOn: '2026-06-03T07:00:00.000Z', at: 'x' })}`);

// Degenerate input must yield "" rather than throwing or producing "undefined",
// which would be rendered to the user and written back to the Sheet.
[['null entry', null], ['undefined entry', undefined], ['empty object', {}]].forEach(([name, ch]) => {
  let got, threw = false;
  try { got = changePerformedOn(ch); } catch (e) { threw = true; }
  check(`${name} yields "" and does not throw`, !threw && got === '',
        threw ? 'threw' : `got ${JSON.stringify(got)}`);
});

// The two dates must stay SEPARATE fields. Reusing `at` as the performed date —
// the obvious shortcut, and what a future refactor might reach for — destroys
// the record of when an entry was actually typed, which is the only provenance
// a change entry has and which pairs with `by`.
check('at is not overwritten when a performedOn exists (they are distinct facts)',
      (() => {
        const ch = { performedOn: '2026-05-28', at: '2026-07-15T16:20:00.000Z' };
        changePerformedOn(ch);
        return ch.at === '2026-07-15T16:20:00.000Z';
      })(),
      'changePerformedOn must not mutate the entry');

// And the call sites must go through the resolver. Reading either field directly
// to answer "when was this done" reintroduces the bug for legacy rows only —
// invisible against a fixture where every row is new.
{
  // Allow the field names inside the resolver itself, the write sites that SET
  // them, the fixture, and comments. What must not exist is another read that
  // formats ch.performedOn or ch.at as the performed date.
  const badReads = (src.match(/formatDateOnly\(\s*ch\.(performedOn|at)\s*\)/g) || []);
  check('no display site formats ch.performedOn / ch.at directly', badReads.length === 0,
        `found ${JSON.stringify(badReads)} — use changePerformedOn(ch)`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
