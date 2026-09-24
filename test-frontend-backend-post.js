// backendPost: every call to the backend, and what it RETRIES.
//
// Found 2026-09-24 against the live dev tenant: Google's serving layer in front
// of Apps Script intermittently answers with its own 404 page ("Sorry, unable to
// open the file at this time"), stalls for 15+ seconds, or delivers a POST
// without its body -- which lands in doGet and comes back as authFailed "This
// endpoint requires sign-in.". The app took each of those as final: a stale
// cached view with saving blocked, a failed save, or -- for the last one -- a
// SIGN-OUT. backendPost retries exactly those and returns every real answer
// untouched. This runs the real function against scripted replies.
//
// Run: node test-frontend-backend-post.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};

function grab(name) {
  let i = src.indexOf(`function ${name}(`);
  if (i === -1) throw new Error(`${name} not found`);
  if (src.slice(i - 6, i) === 'async ') i -= 6;
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error(`${name} not closed`);
}
const constLine = name => {
  const m = src.match(new RegExp(`const ${name} = [^;]+;`));
  if (!m) throw new Error(`${name} not found`);
  return m[0];
};
const mod = {};
new Function('module', [
  constLine('BACKEND_GET_FALLBACK_ERROR'),
  constLine('BACKEND_RETRY_DELAYS_MS'),
  constLine('BACKEND_ATTEMPT_TIMEOUT_MS'),
  grab('backendPost'),
  'module.backendPost = backendPost; module.GET_FALLBACK = BACKEND_GET_FALLBACK_ERROR; module.DELAYS = BACKEND_RETRY_DELAYS_MS;',
].join('\n'))(mod);
const { backendPost, GET_FALLBACK, DELAYS } = mod;

// A scripted server: each call consumes the next reply. A reply is
// { status, body } (body a string or an object to JSON-encode) or { throws }.
function server(replies) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (r.throws) throw new Error(r.throws);
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => text };
  };
  const slept = [];
  const sleep = async ms => { slept.push(ms); };
  return { calls, slept, opts: { fetchImpl, sleep } };
}
const OK = { status: 200, body: { ok: true, assets: [] } };
const GOOGLE_404 = { status: 404, body: '<!DOCTYPE html><html>Sorry, unable to open the file at this time.</html>' };
const HTML_200 = { status: 200, body: '<html>Exception: Lock timeout</html>' };
const BARE_GET = { status: 200, body: { ok: false, authFailed: true, reason: 'signin', scriptVersion: 'v41', error: GET_FALLBACK } };

(async () => {
  // --- the request itself --------------------------------------------------------
  {
    const s = server([OK]);
    const got = await backendPost('https://x/exec', { op: 'read', sessionId: 'abc' }, s.opts);
    const init = s.calls[0].init;
    check('a clean answer comes straight back, no retries', got.ok === true && s.calls.length === 1 && s.slept.length === 0);
    check('it is a POST with the body JSON-encoded', init.method === 'POST' && JSON.parse(init.body).op === 'read' && JSON.parse(init.body).sessionId === 'abc');
    check('text/plain, so there is no CORS preflight Apps Script cannot answer',
      init.headers['Content-Type'] === 'text/plain;charset=utf-8');
    check('no-store, so a cached reply can never bring back stale revisions', init.cache === 'no-store');
  }

  // --- the blips it retries ----------------------------------------------------------
  {
    const s = server([GOOGLE_404, OK]);
    const got = await backendPost('u', {}, s.opts);
    check('Google\'s 404 page is retried, and the retry\'s answer is returned', got.ok === true && s.calls.length === 2);
  }
  {
    const s = server([HTML_200, OK]);
    const got = await backendPost('u', {}, s.opts);
    check('an HTML page served with 200 is retried (a crash, not an answer)', got.ok === true && s.calls.length === 2);
  }
  {
    // The status rule on its own: a 404 page is ALSO not JSON, so without this
    // case the status check could vanish and every other test would still pass.
    const s = server([{ status: 503, body: { ok: true, assets: ['from-an-error-page'] } }, OK]);
    const got = await backendPost('u', {}, s.opts);
    check('an error status is retried even when its body happens to parse', s.calls.length === 2 && got.assets.length === 0);
  }
  {
    // The shape rule on its own: JSON, but not an object the app could read.
    const s = server([{ status: 200, body: '42' }, OK]);
    const got = await backendPost('u', {}, s.opts);
    check('valid JSON that is not an object is retried, not returned', got && got.ok === true && s.calls.length === 2);
  }
  {
    const s = server([{ throws: 'Failed to fetch' }, OK]);
    const got = await backendPost('u', {}, s.opts);
    check('a network error is retried', got.ok === true && s.calls.length === 2);
  }
  {
    const s = server([BARE_GET, OK]);
    const got = await backendPost('u', { op: 'read' }, s.opts);
    check('doGet\'s bare-GET reply is RETRIED, never returned -- it is what signed people out',
      got.ok === true && s.calls.length === 2);
  }
  {
    const s = server([GOOGLE_404, BARE_GET, HTML_200, OK]);
    const got = await backendPost('u', {}, s.opts);
    check('three different blips in a row, then an answer', got.ok === true && s.calls.length === 4);
    check('...waiting the configured backoff between attempts', JSON.stringify(s.slept) === JSON.stringify(DELAYS));
  }

  // --- a request that simply HANGS is abandoned and retried ------------------------
  {
    // Measured on dev: one attempt hung ~54s before failing. The first call here
    // never settles on its own -- only the abort ends it.
    let calls = 0;
    const fetchImpl = (u, init) => {
      calls++;
      if (calls === 1) return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
      return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) });
    };
    const t0 = Date.now();
    const got = await backendPost('u', {}, { fetchImpl, timeoutMs: 30, delays: [1], sleep: async () => {} });
    check('a hung attempt is abandoned at the time limit and retried', got.ok === true && calls === 2 && Date.now() - t0 < 2000, `calls=${calls}`);
  }
  {
    const fetchImpl = (u, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    let err = null;
    try { await backendPost('u', {}, { fetchImpl, timeoutMs: 20, delays: [1], sleep: async () => {} }); } catch (e) { err = e; }
    check('...and when every attempt hangs, the error says it timed out', err && /no answer within/.test(err.message), err && err.message);
  }

  // --- real answers are NOT retried --------------------------------------------------
  {
    const realAuth = { status: 200, body: { ok: false, authFailed: true, reason: 'signin', error: 'Your session has expired. Sign in again to continue.' } };
    const s = server([realAuth, OK]);
    const got = await backendPost('u', {}, s.opts);
    check('a genuine expired session comes straight back (it must still sign the user out)',
      got.authFailed === true && got.error.indexOf('expired') !== -1 && s.calls.length === 1);
  }
  {
    const conflict = { status: 200, body: { ok: false, conflict: ['assets'], revisions: { assets: 9 } } };
    const s = server([conflict, OK]);
    const got = await backendPost('u', {}, s.opts);
    check('a conflict is an answer, returned at once -- retrying it would never succeed',
      Array.isArray(got.conflict) && s.calls.length === 1);
  }
  {
    const readonly = { status: 200, body: { ok: false, authFailed: true, reason: 'readonly', error: 'Your access is view-only.' } };
    const s = server([readonly]);
    const got = await backendPost('u', {}, s.opts);
    check('a view-only refusal is returned, not retried', got.reason === 'readonly' && s.calls.length === 1);
  }

  // --- giving up -------------------------------------------------------------------
  {
    const s = server([GOOGLE_404]);
    let err = null;
    try { await backendPost('u', {}, s.opts); } catch (e) { err = e; }
    check('after every retry fails it throws, rather than returning a fake answer', !!err);
    check('...having tried exactly delays + 1 times', s.calls.length === DELAYS.length + 1, `calls=${s.calls.length}`);
    check('...and says what went wrong', err && /HTTP 404/.test(err.message), err && err.message);
  }
  {
    const s = server([BARE_GET]);
    let err = null, got = null;
    try { got = await backendPost('u', {}, s.opts); } catch (e) { err = e; }
    check('a POST that keeps arriving empty ends in an ERROR, never in an authFailed reply', !!err && got === null);
  }

  // --- wiring: every backend call goes through it ------------------------------------
  const raw = [...src.matchAll(/fetch\(SHEET_API_URL/g)].map(m => m.index);
  const signoutAt = src.indexOf('op: "signout"');
  check('the only raw fetch to the backend left is the fire-and-forget sign-out',
    raw.length === 1 && signoutAt > raw[0] && signoutAt - raw[0] < 400, `raw fetches at ${raw.join(',')}`);
  for (const op of ['op: "auditFull"', 'op: "photoSign"', 'op: "floorPlanSign"']) {
    const at = src.indexOf(op);
    check(`${op} is sent through backendPost`, /backendPost\(SHEET_API_URL, \{ $/.test(src.slice(at - 40, at)) || src.slice(at - 60, at).includes('backendPost(SHEET_API_URL, {'), src.slice(at - 60, at));
  }
  const load = grab('loadData');
  check('the read / sign-in goes through backendPost', /data = await backendPost\(SHEET_API_URL,/.test(load));
  const write = grab('writeSnapshot');
  check('every save goes through backendPost', /await backendPost\(SHEET_API_URL, \{ \.\.\.payload, sessionId: sessionId \}\)/.test(write));

  // --- photos are refused BEFORE uploading when nothing can be saved ------------------
  const attach = grab('attachPhotos');
  const guardAt = attach.indexOf('if (revalidating || staleSnapshot)');
  const signAt = attach.indexOf('signPhotoUploads(');
  check('attachPhotos checks for an unconfirmed view BEFORE it uploads anything',
    guardAt !== -1 && signAt !== -1 && guardAt < signAt);
  check('...and says so in the gallery, not in a toast the detail page does not render',
    /setPhotoError\(staleSnapshot/.test(attach));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(err => {
  console.log('FAIL  the test itself threw\n        ' + ((err && err.stack) || err));
  process.exit(1);
});
