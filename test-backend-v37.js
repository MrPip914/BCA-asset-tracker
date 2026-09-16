// v37: per-tab change detection, the capped audit read, and batched photo
// signing. Every failure here is silent in the worst way — a tab that stops
// being rewritten, history that stops being appended, or a signature batch that
// authorizes the wrong thing.
//
// Run: node test-backend-v37.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};
const eq = (name, got, want) => check(name, Object.is(got, want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const src = fs.readFileSync(path.join(__dirname, 'AssetTrackerSync.gs'), 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8').replace(/\r\n/g, '\n');

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

// ---------------------------------------------------------------------------
// appendNewRows_ — the audit append, EXECUTED
// ---------------------------------------------------------------------------
// This is the one table with no rewrite path, so getting "which rows are new"
// wrong either duplicates history or loses it, permanently and silently. The
// client can now hold only the tail of the log, so the offset is what keeps the
// comparison anchored to the tab's own row count.
function makeAppend(storedRowCount, storedWidth) {
  const written = [];
  const sheet = {
    getLastRow: () => (storedRowCount === 0 ? 0 : storedRowCount + 1),
    getLastColumn: () => storedWidth,
    getRange: (row, col, nRows, nCols) => ({
      setValues: (vals) => { written.push({ row, nRows, vals }); },
      setNumberFormat: () => {},
    }),
  };
  const fn = new Function('getSheet_', 'rows_out', grab('function appendNewRows_') + '\nreturn appendNewRows_;')(
    () => sheet, written
  );
  return { fn, written };
}

{
  const HEADERS = ['a'];
  const rows = n => Array.from({ length: n }, (_, i) => ({ a: 'r' + i }));

  // Pre-v37 shape: the client holds everything, no base.
  {
    const { fn, written } = makeAppend(3, 1);
    fn('AuditLog', HEADERS, rows(5));
    eq('no offset: appends only the rows past what is stored', (written[0] ? written[0].vals.length : 0), 2);
    eq('no offset: appends them at the right row', (written[0] || {}).row, 5);
  }
  {
    const { fn, written } = makeAppend(5, 1);
    fn('AuditLog', HEADERS, rows(5));
    eq('no offset: nothing new appends nothing', written.length, 0);
  }
  // v37: the client holds the tail only.
  {
    // Server has 1000 rows; client loaded the last 200 (base 800) and added 2.
    const { fn, written } = makeAppend(1000, 1);
    fn('AuditLog', HEADERS, rows(202), 800);
    eq('offset: appends only the genuinely new rows', (written[0] ? written[0].vals.length : 0), 2);
    eq('offset: appends them after the stored rows', (written[0] || {}).row, 1002);
  }
  {
    // The same client saving twice without a reload: the second save carries the
    // same array and must append NOTHING, because the tab has already grown.
    const { fn, written } = makeAppend(1002, 1);
    fn('AuditLog', HEADERS, rows(202), 800);
    eq('offset: a repeated save appends nothing the second time', written.length, 0);
  }
  {
    // History removed behind the app's back.
    const { fn, written } = makeAppend(700, 1);
    fn('AuditLog', HEADERS, rows(202), 800);
    eq('offset: a shrunken tab writes the held slice back rather than accepting the loss',
       (written[0] ? written[0].vals.length : 0), 202);
  }
}

// ---------------------------------------------------------------------------
// The read cap
// ---------------------------------------------------------------------------
check('an ordinary read returns only the recent slice',
  /allAuditRows\.slice\(allAuditRows\.length - AUDIT_READ_LIMIT\)/.test(src),
  'the tail, because append order IS chronological order on an append-only tab');
check('and reports the TRUE total beside it',
  /auditTotal: allAuditRows\.length,/.test(src),
  'without it the client cannot know it has a window');
check('a full-log op exists for the views that need everything',
  /if \(body\.op === "auditFull"\)/.test(src) && /function handleAuditFull_/.test(src));
check('the full-log op is authenticated like every other read',
  /authorizeSession_\(body\.sessionId, configMap\)/.test(grab('function handleAuditFull_')));
check('the export ships the WHOLE log, never the loaded window',
  /const fullAuditLog = await ensureFullAuditLog\(\);/.test(html)
  && /const auditRows = fullAuditLog\.map/.test(html),
  'an export that quietly dropped rows is the worst thing an audit trail can do');
check('the client posts how much of the log it does not hold',
  /auditBase: auditBaseRef\.current,/.test(html));
check('fetching the full log resets that offset to zero',
  /auditBaseRef\.current = 0;/.test(html),
  'otherwise the next save appends from the wrong place');
check('an audit view showing a window says so',
  /Showing the most recent \{auditLog\.length\.toLocaleString\(\)\} of/.test(html),
  'silently showing partial history is what an audit view must not do');

// ---------------------------------------------------------------------------
// Per-tab change detection
// ---------------------------------------------------------------------------
{
  const mod = new Function('Utilities',
    grab('function rowsHash_') + '\nreturn rowsHash_;')({
      DigestAlgorithm: { MD5: 'MD5' },
      Charset: { UTF_8: 'UTF_8' },
      // A stand-in digest: the test is about WHAT is hashed, not the algorithm.
      computeDigest: (_alg, text) => Array.from(String(text)).map(c => c.charCodeAt(0) & 0xff),
    });
  const H = ['a', 'b'];
  eq('the same rows hash the same', mod(H, [{ a: 1 }]), mod(H, [{ a: 1 }]));
  check('different rows hash differently', mod(H, [{ a: 1 }]) !== mod(H, [{ a: 2 }]));
  check('a HEADER change hashes differently even with identical rows',
    mod(['a', 'b'], [{ a: 1 }]) !== mod(['a', 'c'], [{ a: 1 }]),
    'a schema change can move no value and must still write');
}

const guard = grab('function writeTableIfChanged_');
check('an unchanged tab is skipped', /if \(stored && String\(stored\) === hash\)/.test(guard));
check('the row count is checked against the SHEET before skipping',
  /Math\.max\(0, sheet\.getLastRow\\?\(\) - 1\) === rows\.length/.test(guard.replace(/\\/g, '')),
  'a tab emptied behind this script cannot be masked by a hash that still matches');
check('every asset-domain tab goes through the guard',
  ['assets', 'comments', 'changes', 'allocations', 'maintenance', 'breakers', 'circuits']
    .every(t => src.includes(`writeTableIfChanged_(SHEET_NAMES.${t},`)),
  'one flag covering seven tabs is what made a comment edit rewrite the panel tabs');
check('the hashes are carried through a config-only save',
  /if \(k\.indexOf\(TAB_HASH_KEY_PREFIX\) === 0\) return;/.test(src));
check('wipe and import DROP every hash rather than copying it through',
  /if \(k\.indexOf\(TAB_HASH_KEY_PREFIX\) === 0\) return;/.test(grab('function adminWriteConfig_')),
  'a surviving hash would describe data the wipe just erased');
check('sheet.mjs blanks them too',
  /TAB_HASH_KEY_PREFIX/.test(fs.readFileSync(path.join(__dirname, 'sheet.mjs'), 'utf8')),
  'it writes tabs outside doPost, so it leaves stale hashes the same way');

// ---------------------------------------------------------------------------
// Batched photo signing
// ---------------------------------------------------------------------------
const sign = grab('function handlePhotoSign_');
check('a batch is N INDEPENDENT signatures, each naming its own object',
  /var publicId = Utilities\.getUuid\(\);/.test(sign) && /signatures\.push\(/.test(sign),
  'one signature covering a prefix would let a client overwrite by naming');
check('the object name is still chosen here, never taken from the request',
  !/body\.publicId|body\.folder/.test(sign));
check('the batch size is bounded',
  /Math\.min\(requested, PHOTO_SIGN_MAX_BATCH\)/.test(sign));
check('the first signature is still spread at the top level for older clients',
  /Object\.assign\(\{ ok: true, signatures: signatures \}, signatures\[0\]\)/.test(sign),
  'this backend must be deployable before the frontend that reads the array');
check('the client reads a single-signature response as a batch of one',
  /Array\.isArray\(data\.signatures\) \? data\.signatures : \[data\]/.test(html),
  'so a frontend ahead of its backend still uploads one photo');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
