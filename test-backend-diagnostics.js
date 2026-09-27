// The backend diagnostics log (v41). Everything here fails SILENTLY — a log that
// quietly stops writing, a lock timeout that goes back to crashing into an HTML
// page, or a session id leaking into a tab anyone with the Sheet can read — and
// none of it can be exercised from Sandbox, which never contacts Apps Script.
//
// Run: node test-backend-diagnostics.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const src = fs.readFileSync(path.join(__dirname, 'AssetTrackerSync.gs'), 'utf8').replace(/\r\n/g, '\n');

function grab(decl) {
  const at = src.indexOf(decl);
  if (at === -1) throw new Error('not found: ' + decl);
  let i = src.indexOf('{', at + decl.length), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) return src.slice(at, j + 1); }
  }
  throw new Error('unterminated: ' + decl);
}
const constLine = (name) => (src.match(new RegExp('^const ' + name + ' = [^\\n]+', 'm')) || [''])[0];

// Evaluates the named functions and constants together, with the given stubs
// in scope, and returns the functions by name.
function load(fnDecls, consts, stubs, extra = '') {
  const names = Object.keys(stubs);
  const code = consts.map(constLine).join('\n') + '\n' + extra + '\n' +
    fnDecls.map(grab).join('\n') + '\nreturn {' +
    fnDecls.map(d => d.replace(/^function /, '').replace(/\(.*$/, '')).join(',') + '};';
  return new Function(...names, code)(...names.map(n => stubs[n]));
}

// ------------------------------------------------------------------ diagRow_
{
  const { diagRow_ } = load(['function diagRow_'], ['SCRIPT_VERSION', 'DIAG_FIELDS'], {},
    'let diagOp_ = "save"; let diagStarted_ = 0;');
  const now = new Date('2026-09-27T10:00:00.000Z');
  const row = diagRow_({ event: 'error', detail: '=IMPORTXML("http://x")', ms: 42 }, now);
  eq('a row has one cell per DIAG_FIELDS column', row.length, 8);
  eq('the timestamp is stored as TEXT, not left for Sheets to turn into a Date', row[0], "'2026-09-27T10:00:00.000Z");
  eq('a value starting with "=" is stored as text, never evaluated as a formula', row[5], "'=IMPORTXML(\"http://x\")");
  eq('the op defaults to the one doPost is routing', row[2], "'save");
  eq('ms stays a number', row[6], 42);
  const long = diagRow_({ detail: 'x'.repeat(2000) }, now);
  check('a long detail is capped rather than filling a cell', long[5].length <= 501);
}

// ------------------------------------------------------------- diagEntries_
{
  const { diagEntries_ } = load(['function diagEntries_'], [], {});
  const values = [['at', 'event'], ['t1', 'a'], ['t2', 'b'], ['t3', 'c']];
  eq('entries come back NEWEST first, keyed by the tab\'s own header row',
    diagEntries_(values, 10), [{ at: 't3', event: 'c' }, { at: 't2', event: 'b' }, { at: 't1', event: 'a' }]);
  eq('the cap keeps the newest rows, not the oldest', diagEntries_(values, 2).map(e => e.event), ['c', 'b']);
  eq('an empty tab reads as no entries', diagEntries_([['at', 'event']], 10), []);
}

// ---------------------------------------------------------------- logDiag_
function fakeSheet(dataRows) {
  const calls = { appended: [], deleted: null };
  let rows = dataRows;
  const sheet = {
    getLastRow: () => (rows === null ? 0 : rows + 1),
    appendRow: (r) => { calls.appended.push(r); rows = (rows === null ? -1 : rows) + 1; },
    deleteRows: (start, n) => { calls.deleted = { start, n }; rows -= n; },
  };
  return { sheet, calls };
}
{
  const consts = ['SCRIPT_VERSION', 'DIAG_FIELDS', 'DIAG_MAX_ROWS', 'DIAG_TRIM_SLACK', 'DIAGNOSTICS_SHEET'];
  const extra = 'let diagOp_ = ""; let diagStarted_ = 0;';

  const empty = fakeSheet(null);
  load(['function diagRow_', 'function logDiag_'], consts, { getSheet_: () => empty.sheet }, extra)
    .logDiag_({ event: 'busy' });
  eq('a brand-new tab gets its header row first', empty.calls.appended[0], ['at', 'event', 'op', 'email', 'reason', 'detail', 'ms', 'scriptVersion']);
  eq('then the entry', empty.calls.appended[1][1], "'busy");

  const full = fakeSheet(1101);
  load(['function diagRow_', 'function logDiag_'], consts, { getSheet_: () => full.sheet }, extra)
    .logDiag_({ event: 'busy' });
  eq('an overgrown tab is trimmed back to DIAG_MAX_ROWS, oldest rows first', full.calls.deleted, { start: 2, n: 102 });

  const under = fakeSheet(1050);
  load(['function diagRow_', 'function logDiag_'], consts, { getSheet_: () => under.sheet }, extra)
    .logDiag_({ event: 'busy' });
  eq('inside the slack nothing is deleted (no per-append trim)', under.calls.deleted, null);

  let threw = false;
  try {
    load(['function diagRow_', 'function logDiag_'], consts, { getSheet_: () => { throw new Error('quota'); } }, extra)
      .logDiag_({ event: 'busy' });
  } catch (e) { threw = true; }
  check('logging NEVER throws — it must not become the failure it describes', !threw);
}

// ------------------------------------------------------------ acquireLock_
{
  const logged = [];
  const mk = (ok) => load(['function acquireLock_'], [], {
    LockService: { getScriptLock: () => ({ tryLock: () => ok }) },
    logDiag_: (e) => logged.push(e),
  }).acquireLock_;
  check('a lock that is had is returned', !!mk(true)(10000));
  eq('a lock that is NOT had returns null instead of throwing', mk(false)(10000), null);
  eq('and is logged as busy', logged.map(e => e.event), ['busy']);
}

// ------------------------------------------- readSession_ says why it failed
{
  const store = { session_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb: JSON.stringify({ email: 'x@y', expires: 1 }) };
  const { readSession_ } = load(['function sessionKey_', 'function readSession_'], ['SESSION_PREFIX'], {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => store[k] || null,
      deleteProperty: (k) => { delete store[k]; },
    }) },
  });
  const why = (id) => { const out = {}; readSession_(id, out); return out.why; };
  eq('no id at all reads as "none" — the browser lost its own storage', why(undefined), 'none');
  eq('a bad shape reads as "malformed"', why('nope'), 'malformed');
  eq('an unknown id reads as "missing"', why('a'.repeat(40)), 'missing');
  eq('a stale record reads as "expired"', why('b'.repeat(40)), 'expired');
  eq('the out parameter stays optional', readSession_('a'.repeat(40)), null);
}

// ---------------------------------------------------------------- wiring
{
  const read = grab('function handleAuthenticatedRead_');
  const audit = grab('function handleAuditFull_');
  const post = grab('function doPost');
  check('no authenticated path waits on the lock with waitLock (it throws into an HTML page)',
    ![read, audit, post].some(b => /waitLock\(/.test(b)));
  check('each authenticated path takes the lock through acquireLock_ and answers busy as JSON',
    [read, audit, post].every(b => /acquireLock_\(/.test(b) && /busyResponse_\(\)/.test(b)));
  const diagAt = post.indexOf('body.op === "diagnostics"');
  const lockAt = post.indexOf('acquireLock_(');
  check('op:"diagnostics" is routed away BEFORE the write lock (the script lock is not reentrant)',
    diagAt !== -1 && diagAt < lockAt);
  check('a conflict, a refused save and a server error are each logged',
    /event: "conflict"/.test(post) && /event: "refused"/.test(post) && /event: "error"/.test(post));
  check('every session refusal is logged centrally, in authorizeSession_',
    /logDiag_\(\{ event: "auth_failed"/.test(grab('function authorizeSession_')));
  const handler = grab('function handleDiagnostics_');
  check('the backend log is EDITORS ONLY — it names other people',
    /auth\.role !== ROLE_EDITOR/.test(handler) && /forbidden: true/.test(handler));
  check('no log call is ever handed a session id',
    !/logDiag_\([^)]*sessionId/.test(src));
  check('the diagnostics tab is not in SHEET_NAMES, so the admin wipe leaves it alone',
    !/Diagnostics/.test(grab('const SHEET_NAMES = ')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
