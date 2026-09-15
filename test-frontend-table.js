// Source-contract test for StickyTable, the shell every table in the app is
// rendered through (2026-09-15).
//
// Three rules here fail SILENTLY -- the table still renders, still filters,
// still sorts, and simply stops doing the one thing the shell exists for:
//
//   1. `overflow: hidden` anywhere on the outer box. That box would become the
//      sticky container for both sticky children, and a box that never scrolls
//      never sticks anything: the header would scroll away with the rows and the
//      scrollbar strip would sit at the bottom of the table again. It is an easy
//      thing to re-add, because it is what rounds the corners of every other
//      bordered box in this file.
//   2. A missing `headerTop`. The default is 0, so the header parks UNDER the
//      app's own sticky chrome -- visible, wrong, and only obvious if you happen
//      to scroll that table far enough to see it collide.
//   3. A table built the old way -- a `.scroller` box with the header as its
//      first row. That is exactly the shape this replaced, and it is what a new
//      table would be copied from if one were added by pattern-matching on a
//      neighbour.
//
// What is NOT here: whether the header actually sticks, whether the strip lands
// at the bottom of the viewport, and whether the three scroll positions stay in
// step. Those are layout and event behaviour, so they were verified by driving
// the real page in Chromium instead.
//
// Run: node test-frontend-table.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let passed = 0, failed = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : `\n        expected ${e}\n        got      ${a}`));
  ok ? passed++ : failed++;
}

// Each call site's props, from `<StickyTable` to the `>` that opens its children.
const calls = [...src.matchAll(/<StickyTable\b([\s\S]*?)\n\s*>/g)].map(m => m[1]);
eq('every table in the app goes through the shared shell', calls.length >= 5, true);

eq('no call site re-adds overflow: hidden, which would stop both sticky children sticking',
  calls.filter(a => /overflow:\s*"hidden"/.test(a)).length, 0);

eq('every call site says where its header parks',
  calls.filter(a => !/headerTop=\{/.test(a)).length, 0);

eq('and parks it below that screen\'s own sticky chrome',
  calls.filter(a => !/headerTop=\{(LIST_TABLE_HEADER_TOP|DETAIL_TABLE_HEADER_TOP)\}/.test(a)).length, 0);

// The old shape: a horizontally scrolling box holding the header as its first
// row. Nothing should be built that way any more.
eq('no table is left built the old way',
  (src.match(/<div className="scroller" style=\{\{ overflowX: "auto" \}\}>/g) || []).length, 0);

// The component itself: the header has to live OUTSIDE the scrolling body, or
// `position: sticky` on it resolves against a box that never scrolls vertically.
const body = src.slice(src.indexOf('function StickyTable('), src.indexOf('function ColumnHeaderCell('));
const headerAt = body.indexOf('{header}');
const bodyAt = body.indexOf('className="hscroll-body"');
eq('the header is rendered before the scrolling body, not inside it',
  headerAt > 0 && bodyAt > 0 && headerAt < bodyAt, true);
eq('the body carries the class that hides its own scrollbar', bodyAt > 0, true);
eq('and that class is defined in the stylesheet', /\.hscroll-body\s*\{[^}]*scrollbar-width:\s*none/.test(src), true);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
