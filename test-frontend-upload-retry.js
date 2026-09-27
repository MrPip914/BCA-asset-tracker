// Upload retries: sendUploadOnce + retryTransientUpload, run for real against a
// scripted XMLHttpRequest.
//
// Found 2026-09-24 on a 3C PDF: "the upload could not reach the image host",
// partway through a several-megabyte upload from a phone. Cloudinary answered
// every direct probe up to 10.6MB, so it was the connection dropping mid-body,
// and one wobble cost the whole file. What this guards, in order of how quietly
// each would fail:
//   1. A REAL refusal being retried -- a bad signature or a disallowed format
//      fails identically three times, and the user waits seven seconds to be
//      told the same thing.
//   2. Progress going BACKWARDS on a retry, which drags the batch percentage
//      down mid-upload and reads as the app losing work.
//   3. Either upload path skipping the retry, leaving one door that still gives
//      up on the first dropped connection.
//
// Run: node test-frontend-upload-retry.js   (exits non-zero on failure)
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

// A scripted XHR: each `new XMLHttpRequest()` takes the next reply. A reply is
// { error: true } (the connection dropped), { timeout: true }, or
// { status, body, progress: [fractions] }.
function makeXhr(replies) {
  const made = [];
  class FakeXhr {
    constructor() { this.reply = replies[Math.min(made.length, replies.length - 1)]; made.push(this); this.upload = {}; }
    open(method, url) { this.method = method; this.url = url; }
    send(form) {
      this.form = form;
      const r = this.reply;
      setTimeout(() => {
        (r.progress || []).forEach(f => this.upload.onprogress && this.upload.onprogress({ lengthComputable: true, loaded: f * 100, total: 100 }));
        if (r.error) return this.onerror();
        if (r.timeout) return this.ontimeout();
        this.status = r.status;
        this.responseText = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
        this.onload();
      }, 0);
    }
  }
  return { FakeXhr, made };
}

function load(FakeXhr) {
  const mod = {};
  new Function('XMLHttpRequest', 'FormData', 'module', [
    constLine('UPLOAD_RETRY_DELAYS_MS'),
    grab('sendUploadOnce'),
    grab('retryTransientUpload'),
    grab('uploadPhotoToCloudinary'),
    grab('uploadFloorPlanToCloudinary'),
    'Object.assign(module, { sendUploadOnce, retryTransientUpload, uploadPhotoToCloudinary, uploadFloorPlanToCloudinary, DELAYS: UPLOAD_RETRY_DELAYS_MS });',
  ].join('\n'))(FakeXhr, class { append() {} }, mod);
  return mod;
}

const OK = { status: 200, body: { secure_url: 'https://res.cloudinary.com/x/y.pdf', public_id: 'y' } };
const DROP = { error: true };
const SIG = { cloudName: 'demo', apiKey: 'k', signature: 's', publicId: 'p', timestamp: 1, folder: 'f' };
const noSleep = slept => ({ sleep: async ms => { slept.push(ms); } });

(async () => {
  // --- the retry itself ------------------------------------------------------------
  {
    const { FakeXhr, made } = makeXhr([DROP, OK]);
    const m = load(FakeXhr);
    const slept = [];
    const got = await m.uploadPhotoToCloudinary({}, SIG, 'x.pdf', null, noSleep(slept));
    check('a dropped connection is retried, and the retry\'s answer is returned',
      got.secure_url === OK.body.secure_url && made.length === 2);
    check('...after the first configured pause', slept.length === 1 && slept[0] === m.DELAYS[0]);
    check('...to the same URL (same signed object, so a repeat overwrites rather than duplicates)',
      made[0].url === made[1].url && /\/image\/upload$/.test(made[0].url));
  }
  {
    const { FakeXhr, made } = makeXhr([{ timeout: true }, { status: 503, body: '<html>busy</html>' }, OK]);
    const m = load(FakeXhr);
    const got = await m.uploadPhotoToCloudinary({}, SIG, 'x.pdf', null, noSleep([]));
    check('a timeout and a 5xx are retried too', got.secure_url && made.length === 3);
  }
  {
    const { FakeXhr, made } = makeXhr([{ status: 429, body: { error: { message: 'Rate limited' } } }, OK]);
    const m = load(FakeXhr);
    await m.uploadPhotoToCloudinary({}, SIG, 'x.pdf', null, noSleep([]));
    check('a 429 is retried', made.length === 2);
  }

  // --- a real refusal is NOT retried ------------------------------------------------
  for (const [label, reply] of [
    ['a bad signature (401)', { status: 401, body: { error: { message: 'Invalid Signature abc' } } }],
    ['a disallowed format (400)', { status: 400, body: { error: { message: 'Image file format docx not allowed' } } }],
    ['a success with no URL in it', { status: 200, body: { nope: true } }],
  ]) {
    const { FakeXhr, made } = makeXhr([reply, OK]);
    const m = load(FakeXhr);
    let err = null;
    try { await m.uploadPhotoToCloudinary({}, SIG, 'x.pdf', null, noSleep([])); } catch (e) { err = e; }
    check(`${label} fails at once, in the host's own words`,
      !!err && made.length === 1 && /refused the upload/.test(err.message), err ? err.message : 'no error');
  }

  // --- giving up ---------------------------------------------------------------------
  {
    const { FakeXhr, made } = makeXhr([DROP]);
    const m = load(FakeXhr);
    const slept = [];
    let err = null;
    try { await m.uploadPhotoToCloudinary({}, SIG, 'x.pdf', null, { ...noSleep(slept), giveUpHint: 'or attach it as a link instead' }); } catch (e) { err = e; }
    check('it gives up after delays + 1 attempts', !!err && made.length === m.DELAYS.length + 1, `attempts=${made.length}`);
    check('...waiting the configured backoff', JSON.stringify(slept) === JSON.stringify(m.DELAYS));
    check('...and says it KEPT dropping, with the count', err && /kept dropping/.test(err.message) && /tried 3 times/.test(err.message), err && err.message);
    check('...plus the caller\'s hint', err && /attach it as a link/.test(err.message));
  }
  {
    // A refusal after a drop is still a refusal: the second attempt's real
    // answer is what the user needs, not a generic "kept dropping".
    const { FakeXhr } = makeXhr([DROP, { status: 400, body: { error: { message: 'File size too large' } } }]);
    const m = load(FakeXhr);
    let err = null;
    try { await m.uploadPhotoToCloudinary({}, SIG, 'x.pdf', null, noSleep([])); } catch (e) { err = e; }
    check('a refusal on a retry is reported as the refusal', err && /File size too large/.test(err.message), err && err.message);
  }

  // --- progress never goes backwards --------------------------------------------------
  {
    const { FakeXhr } = makeXhr([{ error: true, progress: [0.3, 0.6] }, { ...OK, progress: [0.2, 0.5, 0.8] }]);
    const m = load(FakeXhr);
    const seen = [];
    await m.uploadPhotoToCloudinary({}, SIG, 'x.pdf', f => seen.push(f), noSleep([]));
    const monotonic = seen.every((f, i) => i === 0 || f >= seen[i - 1]);
    check('progress holds through a retry instead of dropping back to zero', monotonic, seen.join(','));
    check('...and still finishes at 1', seen[seen.length - 1] === 1, seen.join(','));
    check('...moving again once the retry passes where the first attempt got', seen.includes(0.8), seen.join(','));
  }

  // --- the floor plan's raw upload takes the same path --------------------------------
  {
    const { FakeXhr, made } = makeXhr([DROP, OK]);
    const m = load(FakeXhr);
    // Its own opts are not exposed, so the real pause runs here -- 2s, once.
    const got = await m.uploadFloorPlanToCloudinary({ name: 'plan.svg' }, { ...SIG, resourceType: 'raw' }, null);
    check('the floor-plan upload retries a dropped connection too', got.secure_url && made.length === 2);
    check('...against the raw pipeline', /\/raw\/upload$/.test(made[0].url));
  }

  // --- wiring --------------------------------------------------------------------------
  const prep = grab('preparePhotoRow');
  check('a PDF that keeps failing is pointed at the link option',
    /kind === "pdf" \? \{ giveUpHint: "or attach it as a link instead" \}/.test(prep));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(err => {
  console.log('FAIL  the test itself threw\n        ' + ((err && err.stack) || err));
  process.exit(1);
});
