// The device diagnostics log and the About panel's two logs (v42). Each failure
// here is silent: a log that stops recording, a log erased by the very sign-out
// it was meant to explain, or a backend-log request that an older backend reads
// as a rewrite-everything save.
//
// The panel itself — opening both logs, the Copy button, the busy and HTML
// failure paths landing in the log — was driven in Chromium against a mocked
// backend. What is checked here is the logic and the structure that keeps it true.
//
// Run: node test-frontend-diagnostics.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const SRC = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8').replace(/\r\n/g, '\n');

function grab(decl) {
  const at = SRC.indexOf(decl);
  if (at === -1) throw new Error('not found: ' + decl);
  let i = SRC.indexOf('{', at + decl.length), depth = 0;
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (!depth) return SRC.slice(at, j + 1); }
  }
  throw new Error('unterminated: ' + decl);
}

function makeStorage(opts = {}) {
  const data = {};
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { if (opts.full) throw new Error('QuotaExceededError'); data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}

function loadLog(storage) {
  const code = [
    'const APP_VERSION = "test";',
    'const DIAG_LOG_KEY = "diag:test";',
    (SRC.match(/^const DIAG_LOG_MAX = [^\n]+/m) || [''])[0],
    grab('function readDiagLog()'),
    grab('function diagLog('),
    grab('function diagLogSave('),
    (SRC.match(/^const DIAG_WINDOWS = \[[\s\S]*?\n\];/m) || [''])[0],
    grab('function combineDiagLogs('),
    grab('function formatDiagReport('),
    'return { readDiagLog, diagLog, diagLogSave, combineDiagLogs, formatDiagReport, DIAG_LOG_MAX, DIAG_WINDOWS };',
  ].join('\n');
  return new Function('localStorage', code)(storage);
}

// ------------------------------------------------------------ the ring buffer
{
  const storage = makeStorage();
  const L = loadLog(storage);
  L.diagLog('app_start', 'stored session found');
  eq('an entry is recorded with its event and detail',
    L.readDiagLog().map(e => [e.event, e.detail]), [['app_start', 'stored session found']]);
  for (let i = 0; i < L.DIAG_LOG_MAX + 25; i++) L.diagLog('save_ok', String(i));
  const kept = L.readDiagLog();
  eq('the log is capped at DIAG_LOG_MAX', kept.length, L.DIAG_LOG_MAX);
  eq('and the cap drops the OLDEST entries', kept[kept.length - 1].detail, String(L.DIAG_LOG_MAX + 24));

  storage.data['diag:test'] = '{not json';
  eq('a corrupt log reads as empty rather than throwing', L.readDiagLog(), []);
  L.diagLog('load_ok', 'x');
  eq('and the next entry starts a fresh log', L.readDiagLog().length, 1);

  let threw = false;
  try { loadLog(makeStorage({ full: true })).diagLog('save_failed', 'x'); } catch (e) { threw = true; }
  check('full or blocked storage costs the log, never the app', !threw);
}

// ------------------------------------------------------- save outcome wording
{
  const storage = makeStorage();
  const L = loadLog(storage);
  L.diagLogSave(null, new Error('Non-JSON response: <html>'), 900);
  L.diagLogSave({ ok: false, authFailed: true, reason: 'signin', error: 'expired' }, null, 100);
  L.diagLogSave({ ok: false, refused: 'emptyAssets' }, null, 100);
  L.diagLogSave({ ok: false, conflict: ['assets'] }, null, 100);
  L.diagLogSave({ ok: true }, null, 1234);
  eq('every way a save can end is its own event',
    L.readDiagLog().map(e => e.event), ['save_failed', 'save_auth_failed', 'save_refused', 'save_conflict', 'save_ok']);
  check('a transport failure keeps the server\'s own words', /Non-JSON response: <html>/.test(L.readDiagLog()[0].detail));
  check('and every outcome carries how long it took', L.readDiagLog().every(e => /\d+ms/.test(e.detail)));
}

// ------------------------------------------------- the window and the merge
{
  const L = loadLog(makeStorage());
  const now = Date.parse('2026-09-27T12:00:00.000Z');
  const ago = (min) => new Date(now - min * 60000).toISOString();
  const device = [
    { at: ago(90), event: 'app_start' },
    { at: ago(3), event: 'save_failed' },
    { at: 'not a date', event: 'mystery' },
  ];
  const backend = [
    { at: ago(2), event: 'busy', op: 'save' },
    { at: ago(3000), event: 'signin' },
  ];
  const win = (id) => L.DIAG_WINDOWS.find(w => w.id === id).ms;
  eq('the windows offered are 5 minutes, an hour, a day, a week, and everything',
    L.DIAG_WINDOWS.map(w => w.id), ['5m', '1h', '24h', '7d', 'all']);
  eq('the last 5 minutes keeps only what happened in them, from BOTH logs',
    L.combineDiagLogs(device, backend, win('5m'), now).map(e => e.event), ['busy', 'save_failed']);
  eq('the two logs are ONE list, newest first, each entry tagged with its source',
    L.combineDiagLogs(device, backend, win('24h'), now).map(e => e.source + ':' + e.event),
    ['backend:busy', 'device:save_failed', 'device:app_start']);
  eq('an unparseable time is dropped once a window is chosen',
    L.combineDiagLogs(device, [], win('7d'), now).some(e => e.event === 'mystery'), false);
  eq('...and kept under "everything", at the end',
    L.combineDiagLogs(device, backend, null, now).map(e => e.event).pop(), 'mystery');
  eq('an unticked log contributes nothing',
    L.combineDiagLogs([], backend, win('1h'), now).map(e => e.source), ['backend']);

  const text = L.formatDiagReport(L.combineDiagLogs(device, backend, win('24h'), now), {
    org: 'Brookside', tenant: 'bca', app: '2026-09-28.1', backend: 'v42',
    exportedAt: '2026-09-27T12:00:00.000Z', logs: ['device', 'backend'], window: 'Last 24 hours',
    notes: ['The backend returned its newest 300 of 900 rows; anything older is not included.'],
  });
  const lines = text.split('\n');
  check('the file names the tenant, the build, the backend, the logs and the window',
    /bca/.test(lines[0]) && /2026-09-28\.1/.test(lines[1]) && /v42/.test(lines[1]) && /device, backend/.test(lines[2]) && /Last 24 hours/.test(lines[2]));
  check('a truncation note reaches the file, not only the screen', /Note: The backend returned its newest 300/.test(text));
  check('each entry line carries its time, its source and its event',
    lines.some(l => l.startsWith(ago(2)) && /\[backend\]/.test(l) && /busy/.test(l) && /op=save/.test(l)));
}

// --------------------------------------------------------------------- wiring
{
  const endSession = grab('function endSession(');
  check('ending a session is logged, and says whether it was the button or the server',
    /diagLog\(manualSignOut \? "signed_out" : "session_ended"/.test(endSession));
  check('signing out does NOT clear the log — it is the question the log answers',
    !/removeItem\(DIAG_LOG_KEY\)/.test(endSession) && !/removeItem\(DIAG_LOG_KEY\)/.test(SRC));
  check('app start records whether the browser still held a session',
    /diagLog\("app_start", \(restored \? "stored session found" : "no stored session"\)/.test(SRC));
  const load = grab('async function loadData()');
  check('a load failure is logged', /diagLog\("load_failed"/.test(load));
  check('a load refused as busy or as a server error is treated as a failure, not applied',
    /if \(data && data\.ok === false\) throw new Error/.test(load));
  const persist = grab('async function persist(nextAssets, overrides = {})');
  check('every save outcome is logged, from the moment the request actually starts',
    /const started = Date\.now\(\);(?:(?!writeQueueRef)[\s\S]){0,1200}?return writeSnapshot\(/.test(persist) && /diagLogSave\(/.test(persist));

  const fetchDiag = grab('async function fetchBackendDiagnostics()');
  check('the backend-log request carries the all-false _dirty guard (an older backend would treat it as a save)',
    /op: "diagnostics"[^}]*_dirty: \{ assets: false, config: false, breakerTypes: false, photos: false \}/.test(fetchDiag));
  check('a backend too old to log is reported as such, not as an empty log',
    /!Array\.isArray\(data\.entries\)/.test(fetchDiag));
  check('the backend log is editors-only and never in Sandbox',
    /const diagBackendAvailable = !sandboxMode && canEdit;/.test(SRC)
      && /const diagWantsBackend = diagIncludeBackend && diagBackendAvailable;/.test(SRC)
      && /disabled=\{!diagBackendAvailable\}/.test(SRC));
  check('the device log checkbox is not gated on anything',
    /<input type="checkbox" checked=\{diagIncludeDevice\}/.test(SRC));
  const gather = grab('async function gatherDiagnostics()');
  check('View and Download both go through the ONE gather, so the file is what View shows',
    /gatherDiagnostics\(\)/.test(grab('async function viewDiagnostics()'))
      && /gatherDiagnostics\(\)/.test(grab('async function downloadDiagnostics()')));
  check('a backend failure becomes a note instead of failing the device half',
    /catch \(e\) \{\s*notes\.push\("Backend log unavailable/.test(gather));
  check('the backend is only asked when its checkbox is effectively on',
    /if \(diagWantsBackend\)/.test(gather));
  check('closing Diagnostics does not also close About (the click is stopped)',
    /onClick=\{\(e\) => \{ e\.stopPropagation\(\); setShowDiagnostics\(false\); \}\}/.test(SRC));
  const dl = grab('async function downloadDiagnostics()');
  check('Download reports its progress: working first, then done or error',
    /setDiagDownload\(\{ state: "working" \}\)/.test(dl)
      && /setDiagDownload\(\{ state: "done"/.test(dl)
      && /catch \(e\) \{\s*setDiagDownload\(\{ state: "error"/.test(dl));
  check('the working state is announced before anything slow runs',
    dl.indexOf('state: "working"') < dl.indexOf('gatherDiagnostics()'));
  check('the status line renders, and says so to a screen reader',
    /\{diagDownload && \(\s*<div\s*role="status"/.test(SRC));
  check('About opens Diagnostics from a single button', (SRC.match(/setShowDiagnostics\(true\)/g) || []).length === 1);
  check('no session id is ever written into the device log',
    !/diagLog\([^;]*sessionId/.test(SRC));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
