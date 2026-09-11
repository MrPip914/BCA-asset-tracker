// Runs every test in the repo and prints ONE summary.
//
// There is no package.json and deliberately no test framework -- each test file
// is a plain node script that slices its subject out as source text and exits
// non-zero on failure (see "A backend write path cannot be covered by browser
// testing" in CLAUDE.md for why they are shaped that way). That works fine per
// file and badly in bulk: verifying a change meant nineteen separate commands
// and nineteen blocks of output to read past.
//
// This does not replace running one file directly -- when something fails, run
// that file on its own for the full output. This is the pass that answers
// "did I break anything", which is the question asked far more often.
//
// Discovery is by FILENAME, not a list, so a new test is covered the day it is
// written rather than the day someone remembers to add it here.
//
// Run: node run-tests.mjs          every test
//      node run-tests.mjs frontend only the ones whose name contains "frontend"
//      node run-tests.mjs -v       stream each file's own output as well
import { readdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const run = promisify(execFile);
const REPO = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const verbose = args.includes('-v') || args.includes('--verbose');
const filter = args.find((a) => !a.startsWith('-'));

const files = readdirSync(REPO)
  .filter((f) => /^test-.*\.(js|mjs)$/.test(f))
  .filter((f) => !filter || f.includes(filter))
  .sort();

if (!files.length) {
  console.error(filter ? `No test files match ${JSON.stringify(filter)}.` : 'No test files found.');
  process.exit(1);
}

// Each file prints its own tally as its last non-empty line, in one of two
// shapes ("29 passed, 0 failed" or "✓ 18 tests passed"). Pull the numbers out
// where they are there, so the summary can total real assertions rather than
// just files -- and fall back to the file's exit code where they are not, so a
// test that prints something else still counts.
const tally = (out) => {
  const last = out.trim().split('\n').filter((l) => l.trim()).pop() || '';
  let m = last.match(/(\d+)\s+passed,\s*(\d+)\s+failed/);
  if (m) return { passed: +m[1], failed: +m[2] };
  m = last.match(/(\d+)\s+tests?\s+passed/);
  if (m) return { passed: +m[1], failed: 0 };
  return null;
};

const started = Date.now();
const results = await Promise.all(files.map(async (f) => {
  const t0 = Date.now();
  try {
    const { stdout, stderr } = await run(process.execPath, [join(REPO, f)], { cwd: REPO, maxBuffer: 1e8 });
    return { f, ok: true, out: stdout + stderr, ms: Date.now() - t0 };
  } catch (e) {
    return { f, ok: false, out: (e.stdout || '') + (e.stderr || ''), ms: Date.now() - t0 };
  }
}));

let passed = 0, failed = 0, badFiles = [];
for (const r of results) {
  const t = tally(r.out);
  if (t) { passed += t.passed; failed += t.failed; }
  else if (!r.ok) failed++;
  const count = t ? `${t.passed} passed${t.failed ? `, ${t.failed} FAILED` : ''}` : (r.ok ? 'ok' : 'CRASHED');
  console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.f.padEnd(34)} ${String(r.ms).padStart(5)}ms  ${count}`);
  if (!r.ok) badFiles.push(r.f);
  if (verbose) console.log(r.out.split('\n').map((l) => '        ' + l).join('\n'));
}

console.log(`\n${files.length} files, ${passed} assertions passed, ${failed} failed  (${Date.now() - started}ms)`);
if (badFiles.length) {
  console.log('\nRe-run for the full output:');
  for (const f of badFiles) console.log(`  node ${f}`);
  process.exit(1);
}
