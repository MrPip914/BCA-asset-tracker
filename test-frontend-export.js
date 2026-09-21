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

// --- slice the functions -----------------------------------------------------
// `async` since 2026-09-16, when xlsx became a dynamic import — matched either
// way rather than pinned to one spelling, so the next signature change fails on
// a real assertion below instead of on this slice.
// index.html is CRLF; don't assume either.
const NL = src.includes('\r\n') ? '\r\n' : '\n';
function slice(name) {
  const DECL = [`  async function ${name}() {`, `  function ${name}() {`]
    .map(d => ({ d, at: src.indexOf(d) })).find(x => x.at !== -1);
  if (!DECL) throw new Error(`${name} not found in index.html`);
  // Ends at the next line that is exactly two-space-indented "}".
  const end = src.indexOf(NL + '  }' + NL, DECL.at);
  if (end === -1) throw new Error(`end of ${name} not found`);
  return src.slice(DECL.at, end);
}
// EXPORTASSETSSHEET IS SCANNED TOO, and it has to be: it is a second function
// built out of the same resolved-place helpers, written by copying the shape of
// the first, and it fails in exactly the way this file was created for — a bare
// identifier is resolved only when the line RUNS, and nothing runs until
// somebody presses Export. Adding the function without adding it here would
// have left the new half of the feature covered by nothing at all.
const fnExcel = slice('exportToExcel');
const fnSheet = slice('exportAssetsSheet');
const fn = fnExcel + NL + fnSheet;

// --- what it calls -----------------------------------------------------------
// Bare `name(` only: a member call (`XLSX.utils.foo(`, `rows.map(`) resolves at
// runtime against an object and is not this bug's shape.
//
// LINE COMMENTS GO FIRST, and that ordering is the whole correctness of this
// scan. An apostrophe in ordinary prose -- "you'd group by building" -- is
// indistinguishable from an opening single quote, so the string stripper below
// pairs it with the next apostrophe and blanks everything between, INCLUDING
// real calls. That is not hypothetical: it silently hid two of them until
// 2026-09-16, when unrelated text shifted the apostrophe parity and they
// reappeared. A scan that quietly finds less than it should is worse than no
// scan, so the prose is removed before the quotes are.
//
// Quoted strings are stripped next, or a column header like "Slot(s)" reads as
// a call to `Slot`. Template literals are LEFT ALONE on purpose: their `${...}`
// holes contain real calls, and dropping them would hide exactly the kind of
// dead reference this test exists to find.
const scannable = fn
  .replace(/^[ \t]*\/\/.*$/gm, '')
  .replace(/"(?:[^"\\]|\\.)*"/g, '""')
  .replace(/'(?:[^'\\]|\\.)*'/g, "''");
const called = new Set();
for (const m of scannable.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) called.add(m[2]);

// --- what exists -------------------------------------------------------------
const defined = new Set();
// Module-level declarations anywhere in index.html.
for (const m of src.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) defined.add(m[1]);
for (const m of src.matchAll(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm)) defined.add(m[1]);
// Locals and destructured bindings declared inside the function itself.
for (const m of fn.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
// Array destructuring, which is how every useState pair is bound:
// `const [notice, setNotice] = useState(null)`. Module level as well as local,
// since a handler here legitimately calls a setter declared at the top of the
// component.
for (const m of src.matchAll(/\b(?:const|let|var)\s*\[([^\]]*)\]\s*=/g)) {
  m[1].split(',').forEach(part => {
    const name = part.trim().split('=')[0].trim();
    if (name) defined.add(name);
  });
}
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
  // `await import("xlsx")` -- a keyword form, not a function this file defines.
  'import',
]);

const missing = [...called].filter(n => !defined.has(n) && !BUILTINS.has(n));

check('every function the two export paths call actually exists', missing.length === 0,
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

// The workbook's filename names the TENANT, not the school this app was built
// for. A hardcoded name is the quietest possible multi-tenant failure: Export
// works perfectly, the file is correct, and it lands in a downloads folder
// calling itself another client's inventory. Nothing on screen says so.
{
  const calls = fn.match(/XLSX\.writeFile\([^)]*\)/g) || [];
  check('BOTH exports name the tenant in the filename, not a hardcoded school',
        calls.length === 2 && calls.every(c => /CLIENT\.(id|appName|orgName)/.test(c)),
        `writeFile calls: ${calls.join(' | ') || '(none found)'}`);
  // The two land in one downloads folder and only ONE of them can be imported
  // back. Identical names would make "which of these is the importable one?"
  // unanswerable without opening both.
  check('the two exports write DIFFERENT filenames',
        calls.length === 2 && calls[0] !== calls[1], calls.join(' | '));
}

// The Assets tab exports WHAT IS SHOWN. Reading `assets` there instead of
// `filtered` is a silent failure of exactly the kind this file exists for: the
// file is well-formed, imports cleanly, and simply contains the wrong four
// hundred rows -- and the only way to notice is to count them.
{
  check('exportAssetsSheet builds its rows from `filtered`, not from `assets`',
        /\bfiltered\.map\(/.test(fnSheet) && !/\bassets\.map\(/.test(fnSheet),
        'expected filtered.map(...) and no assets.map(...) in exportAssetsSheet');
}

// The header row must come from the same function the IMPORT resolves headers
// through. Two lists that merely happen to agree today is how a column lands
// under the wrong heading later, and the import then writes serials into
// hostnames without a word.
{
  check('the Assets sheet header is built by importHeadersFor, not written out',
        /importHeadersFor\(columns\)/.test(fnSheet) && /IMPORT_KEY_HEADER/.test(fnSheet),
        'exportAssetsSheet should build its header from IMPORT_KEY_HEADER + importHeadersFor(columns)');
  check('every row is built by assetToImportRow, the import\'s own reader',
        /assetToImportRow\(/.test(fnSheet));
}

// A result of zero must still produce a header row: an empty file is useless,
// while a header-only one is a template somebody can type new assets into.
{
  check('an empty result still writes a header row',
        /aoa_to_sheet\(\[header\]\)/.test(fnSheet),
        'expected an aoa_to_sheet([header]) fallback when no assets matched');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
