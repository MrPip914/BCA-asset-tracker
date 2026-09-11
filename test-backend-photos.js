// Tests for the v35 photo backend — the Photos tab, the public panel
// projection, and the Cloudinary upload signature.
//
// It has to be tested HERE and cannot be tested anywhere else: Sandbox mode
// never contacts Apps Script, the live backend needs a Google sign-in, and the
// signing path additionally needs credentials that only exist in a tenant's
// Script Properties. "Open it in a browser and try it" reaches none of it.
//
// Every block below is SLICED OUT of AssetTrackerSync.gs as source text and run
// against fakes, rather than reimplemented here — a reimplementation would test
// this file's idea of the contract instead of the backend's, and would keep
// passing after the backend changed.
//
// The four things it exists to catch, each of which fails SILENTLY:
//   1. doPost writing a field doGet doesn't read back (or vice versa) — the
//      same two-halves-of-one-contract hazard as test-backend-assetid.js.
//   2. hiddenFromPublic being ignored, publishing a photo deliberately withheld.
//   3. The public projection widening past the panel it belongs to.
//   4. storageKey or `by` leaking onto the anonymous page.
//
// Run: node test-backend-photos.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const src = fs.readFileSync(path.join(__dirname, 'AssetTrackerSync.gs'), 'utf8');

function between(startMarker, endMarker) {
  const i = src.indexOf(startMarker);
  if (i === -1) throw new Error(`marker not found: ${startMarker}`);
  const j = src.indexOf(endMarker, i);
  if (j === -1) throw new Error(`end marker not found: ${endMarker}`);
  return src.slice(i, j);
}
function grab(name) {
  const i = src.indexOf(`function ${name}(`);
  if (i === -1) throw new Error(`${name} not found`);
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
}
const constSrc = (name) => {
  const i = src.indexOf(`const ${name} = [`);
  if (i === -1) throw new Error(`${name} not found`);
  return src.slice(i, src.indexOf('];', i) + 2);
};

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name
    + (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
};

// --- 1. the doPost -> doGet round trip --------------------------------------
const writePhotos = new Function('body', `
  ${constSrc('PHOTO_FIELDS')}
  const SHEET_NAMES = { photos: 'Photos' };
  let out = null;
  const writeTable_ = (name, fields, rows) => { out = { name, fields, rows }; };
  ${between('const photoRows = (body.photos || []).map(ph => ({', 'writeTable_(SHEET_NAMES.photos')}
  writeTable_(SHEET_NAMES.photos, PHOTO_FIELDS, photoRows);
  return out;
`);
const readPhotos = new Function('photoRows', `
  ${between('const photos = photoRows.map(ph => ({', '\n    const payload = {')}
  return photos;
`);

const AUTHORED = {
  id: 'p-1', ownerType: 'breaker', ownerId: 'brk-uuid-1',
  url: 'https://res.cloudinary.com/x/image/upload/v1/assets/abc.jpg',
  thumbUrl: 'https://res.cloudinary.com/x/image/upload/w_200/v1/assets/abc.jpg',
  storageKey: 'assets/abc', caption: 'Main lugs',
  width: 1600, height: 1200, bytes: 301244,
  hiddenFromPublic: true, at: '2026-09-10T00:00:00.000Z', by: 'Eric',
};
const written = writePhotos({ photos: [AUTHORED] });
eq('the Photos tab is written with the declared schema', written.fields, JSON.parse(JSON.stringify(
  new Function(`${constSrc('PHOTO_FIELDS')} return PHOTO_FIELDS;`)())));

// Every authored field has to survive the trip. This is the contract that fails
// silently: a name written on one side and not read on the other simply vanishes.
const back = readPhotos(written.rows)[0];
['id', 'ownerType', 'ownerId', 'url', 'thumbUrl', 'storageKey', 'caption', 'at', 'by']
  .forEach(k => eq(`round trip preserves ${k}`, back[k], AUTHORED[k]));
eq('round trip preserves hiddenFromPublic as a real boolean', back.hiddenFromPublic, true);
eq('a photo not hidden reads back false, not ""',
   readPhotos(writePhotos({ photos: [Object.assign({}, AUTHORED, { hiddenFromPublic: false })] }).rows)[0].hiddenFromPublic,
   false);
// storageKey is the delete/migrate handle and is NOT derivable from a
// transformed delivery URL, so losing it here would be unrecoverable.
eq('storageKey survives a blank thumbUrl',
   readPhotos(writePhotos({ photos: [Object.assign({}, AUTHORED, { thumbUrl: '' })] }).rows)[0].storageKey,
   'assets/abc');

// --- 2. the public panel projection -----------------------------------------
const projectPublic = new Function('rows', 'panelLabel', 'breakers', 'unassignedCircuits', `
  ${constSrc('PHOTO_FIELDS')}
  ${constSrc('PUBLIC_PHOTO_FIELDS')}
  const SHEET_NAMES = { photos: 'Photos' };
  const readTable_ = () => rows;
  ${grab('pickPublic_')}
  ${between('const publicOwnerIds = {};', '\n  return {')}
  return photos;
`);

const PANEL = 'panel-uuid';
const BREAKERS = [{ id: 'brk-1', circuits: [{ id: 'cir-1' }] }];
const UNASSIGNED = [{ id: 'cir-loose' }];
const row = (over) => Object.assign({
  id: 'x', ownerType: 'asset', ownerId: PANEL, url: 'u', thumbUrl: 't',
  storageKey: 'assets/secret', caption: 'c', width: 1, height: 2, bytes: 3,
  hiddenFromPublic: '', at: 'now', by: 'Eric Stamage',
}, over);

const published = projectPublic([
  row({ id: 'on-panel' }),
  row({ id: 'on-breaker', ownerType: 'breaker', ownerId: 'brk-1' }),
  row({ id: 'on-circuit', ownerType: 'circuit', ownerId: 'cir-1' }),
  row({ id: 'on-loose-circuit', ownerType: 'circuit', ownerId: 'cir-loose' }),
  row({ id: 'hidden', hiddenFromPublic: 'true' }),
  row({ id: 'other-panel', ownerId: 'some-other-panel' }),
  row({ id: 'a-laptop', ownerId: 'laptop-uuid' }),
  row({ id: 'a-work-entry', ownerType: 'change', ownerId: 'change-uuid' }),
], PANEL, BREAKERS, UNASSIGNED);

eq('publishes exactly the panel, its breakers and its circuits',
   published.map(p => p.id).sort(),
   ['on-breaker', 'on-circuit', 'on-loose-circuit', 'on-panel']);
// Each of these is the whole reason section 7 concluded an anonymous page was
// safe: a photo of anything else is unreachable, not merely filtered.
eq('a photo marked hiddenFromPublic is withheld', published.some(p => p.id === 'hidden'), false);
eq('another panel\'s photo is not published', published.some(p => p.id === 'other-panel'), false);
eq('an asset photo is not published', published.some(p => p.id === 'a-laptop'), false);
eq('a work entry photo is not published', published.some(p => p.id === 'a-work-entry'), false);

// A leak here is permanent: these URLs are handed to anyone who guesses a code.
const publicKeys = Object.keys(published[0]).sort();
eq('storageKey never reaches the public page', publicKeys.includes('storageKey'), false);
eq('the uploader\'s name never reaches the public page', publicKeys.includes('by'), false);
eq('the public projection is exactly its whitelist', publicKeys,
   new Function(`${constSrc('PUBLIC_PHOTO_FIELDS')} return PUBLIC_PHOTO_FIELDS;`)().slice().sort());

// --- 3. the Cloudinary signature --------------------------------------------
// Apps Script hands back SIGNED bytes from computeDigest, so the shim reproduces
// that faithfully — a hex helper that forgets to mask produces "-1" where "ff"
// belongs, and the only symptom is Cloudinary refusing the upload.
const Utilities = {
  DigestAlgorithm: { SHA_1: 'SHA_1' },
  Charset: { UTF_8: 'UTF_8' },
  computeDigest: (_alg, text) =>
    Array.from(crypto.createHash('sha1').update(text, 'utf8').digest())
      .map(b => (b > 127 ? b - 256 : b)),
};
const signMod = {};
new Function('Utilities', 'module',
  grab('sha1Hex_') + grab('cloudinarySignature_')
  + '\nmodule.sha1Hex_ = sha1Hex_; module.sign = cloudinarySignature_;'
)(Utilities, signMod);

const sha1 = (s) => crypto.createHash('sha1').update(s, 'utf8').digest('hex');
eq('sha1Hex_ matches a known digest', signMod.sha1Hex_('abc'), sha1('abc'));
// The byte-sign trap, pinned directly: this input's digest contains bytes above
// 0x7f, which is where an unmasked conversion goes wrong.
eq('sha1Hex_ is 40 lowercase hex chars for a high-byte digest',
   /^[0-9a-f]{40}$/.test(signMod.sha1Hex_('ÿþ photo')), true);

eq('the signature is sorted params joined with the secret appended',
   signMod.sign({ timestamp: 1757462400, folder: 'assets', public_id: 'uuid-1' }, 'SECRET'),
   sha1('folder=assets&public_id=uuid-1&timestamp=1757462400' + 'SECRET'));
// Cloudinary drops blanks rather than signing them; signing an empty value
// yields a signature its server will not match, and it does not say why.
eq('blank parameters are dropped before signing',
   signMod.sign({ timestamp: 1, folder: '', public_id: 'u' }, 'S'),
   sha1('public_id=u&timestamp=1' + 'S'));
eq('parameter order in the object does not change the signature',
   signMod.sign({ public_id: 'u', folder: 'f', timestamp: 2 }, 'S'),
   signMod.sign({ timestamp: 2, folder: 'f', public_id: 'u' }, 'S'));

// --- 4. schema guards --------------------------------------------------------
const PHOTO_FIELDS = new Function(`${constSrc('PHOTO_FIELDS')} return PHOTO_FIELDS;`)();
eq('ownerType and ownerId are both part of the key', 
   PHOTO_FIELDS.includes('ownerType') && PHOTO_FIELDS.includes('ownerId'), true);
eq('the Photos tab is in the admin wipe list',
   /SHEET_NAMES\.photos, headers: PHOTO_FIELDS/.test(src), true);
eq('photos is a revision domain of its own',
   /REVISION_DOMAINS = \[[^\]]*"photos"/.test(src), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
