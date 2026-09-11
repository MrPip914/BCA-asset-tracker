// Guards exportToExcel() against calling something that no longer exists.
//
// `displayRoom` was a local helper deleted in b4a7ed1 ("Replace fixed
// room/building fields with a general parent chain"). Two call sites inside
// exportToExcel were left behind, and Export threw ReferenceError from that
// commit until 2026-09-10 -- weeks.
//
// Why nobody caught it, which is the part worth engineering against:
//   - Babel compiles it fine. A bare identifier is only resolved when the line
//     RUNS, and nothing runs until someone clicks Export.
//   - Both dead call sites sit inside `(a.comments || []).forEach` and
//     `(a.changes || []).forEach`. On an inventory where no asset has a comment
//     or a change, neither line ever executes and Export works perfectly. It
//     breaks only once there is data to export -- the opposite of the usual
//     "empty state is broken" bug, and invisible to a quick smoke test.
//   - It fails with NO user-visible message. The click just does nothing.
//
// So this walks every function call inside exportToExcel and asserts the callee
// is something that actually exists: defined at module level in index.html,
// declared locally inside the function, a parameter, or a known global.
//
// Run: node test-frontend-export.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};

// --- slice the function ------------------------------------------------------
const start = src.indexOf('  function exportToExcel() {');
if (start === -1) throw new Error('exportToExcel not found in index.html');
// Ends at the next line that is exactly two-space-indented "}".
// index.html is CRLF; don't assume either.
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const end = src.indexOf(NL + '  }' + NL, start);
if (end === -1) throw new Error('end of exportToExcel not found');
const fn = src.slice(start, end);

// --- what it calls -----------------------------------------------------------
// Bare `name(` only: a member call (`XLSX.utils.foo(`, `rows.map(`) resolves at
// runtime against an object and is not this bug's shape.
//
// Quoted strings are stripped first, or a column header like "Slot(s)" reads as
// a call to `Slot`. Template literals are LEFT ALONE on purpose: their `${...}`
// holes contain real calls, and dropping them would hide exactly the kind of
// dead reference this test exists to find.
const scannable = fn.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''");
const called = new Set();
for (const m of scannable.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) called.add(m[2]);

// --- what exists -------------------------------------------------------------
const defined = new Set();
// Module-level declarations anywhere in index.html.
for (const m of src.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) defined.add(m[1]);
for (const m of src.matchAll(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm)) defined.add(m[1]);
// Locals and destructured bindings declared inside the function itself.
for (const m of fn.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
for (const m of fn.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) {
  m[1].split(',').forEach(part => {
    const name = part.split(':').pop().trim().split('=')[0].trim();
    if (name) defined.add(name);
  });
}

// Language and browser built-ins, plus JSX/keyword shapes the regex picks up.
const BUILTINS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function',
  'String', 'Number', 'Boolean', 'Object', 'Array', 'Date', 'Math', 'JSON',
  'Map', 'Set', 'Promise', 'Error', 'RegExp', 'parseFloat', 'parseInt',
  'isNaN', 'encodeURIComponent', 'decodeURIComponent', 'alert', 'confirm',
  'setTimeout', 'clearTimeout', 'require', 'await', 'new',
]);

const missing = [...called].filter(n => !defined.has(n) && !BUILTINS.has(n));

check('every function exportToExcel calls actually exists', missing.length === 0,
      missing.length ? `undefined: ${missing.join(', ')}` : '');

// The specific regression, named, so the reason this file exists survives even
// if the general check above is ever loosened.
check('displayRoom (deleted in b4a7ed1) is not called anywhere',
      !src.includes('displayRoom('),
      'displayRoom was removed when the parent chain replaced room/building fields');

// The Room column still has to be produced SOMEHOW in both child sheets, or the
// "fix" could be to delete the column and call it done.
{
  const roomCols = (fn.match(/Room:\s*roomNameOf\(/g) || []).length;
  check('the Comments and Changes sheets both still emit a Room column', roomCols >= 2,
        `found ${roomCols}, expected at least 2 (comments + changes)`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
