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
//   5. (v39) a DOCUMENT reaching that page. Eric's call was that photos publish
//      and documents never do, and a filter that silently stopped filtering
//      would publish a quote or an invoice with no symptom at all.
//   6. (v39) a signed upload parameter the client is never told to post.
//      Cloudinary then refuses every upload with "invalid signature" and says
//      nothing about which parameter, which reads as broken credentials.
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

// v37 routes every full-tab write through writeTableIfChanged_, which skips a
// tab whose contents hash unchanged. The slice marker below names that call, and
// matches the older spelling too so this file reads both.
const TAB_WRITE_CALL = src.includes('writeTableIfChanged_(SHEET_NAMES.photos') ? 'writeTableIfChanged_' : 'writeTable_';

// --- 1. the doPost -> doGet round trip --------------------------------------
const writePhotos = new Function('body', `
  ${constSrc('PHOTO_FIELDS')}
  const SHEET_NAMES = { photos: 'Photos' };
  let out = null;
  const writeTable_ = (name, fields, rows) => { out = { name, fields, rows }; };
  ${between('const photoRows = (body.photos || []).map(ph => ({', TAB_WRITE_CALL + '(SHEET_NAMES.photos')}
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
  storageKey: 'assets/abc', kind: 'image', fileName: 'IMG_4821.HEIC', caption: 'Main lugs',
  width: 1600, height: 1200, bytes: 301244,
  hiddenFromPublic: true, at: '2026-09-10T00:00:00.000Z', by: 'Eric',
};
const written = writePhotos({ photos: [AUTHORED] });
eq('the Photos tab is written with the declared schema', written.fields, JSON.parse(JSON.stringify(
  new Function(`${constSrc('PHOTO_FIELDS')} return PHOTO_FIELDS;`)())));

// Every authored field has to survive the trip. This is the contract that fails
// silently: a name written on one side and not read on the other simply vanishes.
const back = readPhotos(written.rows)[0];
['id', 'ownerType', 'ownerId', 'url', 'thumbUrl', 'storageKey', 'kind', 'fileName', 'caption', 'at', 'by']
  .forEach(k => eq(`round trip preserves ${k}`, back[k], AUTHORED[k]));
eq('round trip preserves hiddenFromPublic as a real boolean', back.hiddenFromPublic, true);
eq('a photo not hidden reads back false, not ""',
   readPhotos(writePhotos({ photos: [Object.assign({}, AUTHORED, { hiddenFromPublic: false })] }).rows)[0].hiddenFromPublic,
   false);
// A PDF has to survive as a PDF. Losing `kind` on the way through would file a
// document as an image, which renders as a broken tile AND publishes it on the
// public panel page, since that filter reads this very field.
const pdfBack = readPhotos(writePhotos({ photos: [Object.assign({}, AUTHORED,
  { kind: 'pdf', fileName: 'boiler-quote.pdf' })] }).rows)[0];
eq('round trip preserves kind: pdf', pdfBack.kind, 'pdf');
eq('round trip preserves the original file name', pdfBack.fileName, 'boiler-quote.pdf');
// A link stores its address in `url` and nothing in storageKey -- no new column,
// which is why this kind needed no backend release. It has to come back a link.
const linkBack = readPhotos(writePhotos({ photos: [Object.assign({}, AUTHORED,
  { kind: 'link', url: 'https://drive.google.com/drive/folders/x', thumbUrl: '', storageKey: '', fileName: 'ImageMeter folder' })] }).rows)[0];
eq('round trip preserves kind: link', linkBack.kind, 'link');
eq('round trip preserves a link\'s url', linkBack.url, 'https://drive.google.com/drive/folders/x');
eq('round trip preserves a link\'s name', linkBack.fileName, 'ImageMeter folder');
// Pre-v39 rows have no kind cell, and an image is the only thing that could
// have been uploaded then — so this default is known, not guessed.
eq('a blank kind reads back as an image',
   readPhotos(writePhotos({ photos: [Object.assign({}, AUTHORED, { kind: undefined })] }).rows)[0].kind,
   'image');

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
  hiddenFromPublic: '', kind: 'image', fileName: 'x.jpg', at: 'now', by: 'Eric Stamage',
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
  row({ id: 'a-panel-pdf', kind: 'pdf', fileName: 'panel-schedule.pdf' }),
  row({ id: 'a-breaker-pdf', kind: 'pdf', ownerType: 'breaker', ownerId: 'brk-1' }),
  row({ id: 'a-panel-link', kind: 'link', url: 'https://drive.google.com/drive/folders/x', thumbUrl: '', storageKey: '' }),
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
// Eric's call, 2026-09-17: photos publish, documents never do. Both of these
// are owned by something IN the payload, so the ownership scope would let them
// through — only the kind filter stops them.
eq('a document on the panel itself is not published', published.some(p => p.id === 'a-panel-pdf'), false);
eq('a document on one of its breakers is not published', published.some(p => p.id === 'a-breaker-pdf'), false);
// A LINK (2026-09-24) points into someone's private Drive folder -- the same
// reasoning that keeps documents off this page, met by the same filter with no
// change to it: the public page takes images and nothing else.
eq('a link on the panel itself is not published', published.some(p => p.id === 'a-panel-link'), false);
// A row written before v39 has a blank kind and is an image; reading that as
// "not an image" would quietly unpublish every photo already on the sheet.
eq('a pre-v39 row with no kind still publishes',
   projectPublic([row({ id: 'legacy', kind: undefined })], PANEL, BREAKERS, UNASSIGNED).map(p => p.id),
   ['legacy']);

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

// --- 3b. what the sign handler hands the browser (v39) -----------------------
// Executed rather than read, because the property that matters is a RELATION:
// every parameter folded into the signature must also be named in signedParams
// AND present in the response under that exact name, since the client builds its
// upload form by reading sig[k] for each name. Break any one of the three and
// Cloudinary refuses every upload as "invalid signature" without saying which
// parameter is wrong.
const signHandler = (() => {
  const mod = {};
  new Function('Utilities', 'PropertiesService', 'ROLE_EDITOR', 'PHOTO_SIGN_MAX_BATCH',
    'readConfigMap_', 'authorizeSession_', 'jsonOut_', 'module', `
    ${src.slice(src.indexOf('const PHOTO_ALLOWED_FORMATS'), src.indexOf(';', src.indexOf('const PHOTO_ALLOWED_FORMATS')) + 1)}
    ${grab('sha1Hex_')}
    ${grab('cloudinarySignature_')}
    ${grab('handlePhotoSign_')}
    module.f = handlePhotoSign_;
  `)(
    Object.assign({ getUuid: () => 'uuid-fixed' }, Utilities),
    { getScriptProperties: () => ({ getProperty: (k) => ({
      CLOUDINARY_CLOUD_NAME: 'school', CLOUDINARY_API_KEY: 'KEY',
      CLOUDINARY_API_SECRET: 'SECRET', CLOUDINARY_FOLDER: 'dev',
    }[k] || null) }) },
    'editor',
    10,
    () => ({}),
    () => ({ ok: true, role: 'editor', email: 'eric@example.com' }),
    (o) => o,
    mod,
  );
  return mod.f;
})();

const signed = signHandler({ sessionId: 's' });
eq('signing succeeds for an editor with credentials set', signed.ok, true);
eq('every signed parameter is named in signedParams',
   signed.signedParams, ['allowed_formats', 'folder', 'public_id', 'timestamp']);
// The client reads each signed name straight off this response (public_id is the
// one alias), so a name it cannot find is a parameter it silently omits.
eq('every signed parameter is also present in the response under that name',
   signed.signedParams.filter(k => (k === 'public_id' ? signed.publicId : signed[k]) === undefined), []);
eq('the signature covers the format allowlist',
   signed.signature,
   sha1(`allowed_formats=${signed.allowed_formats}&folder=dev&public_id=uuid-fixed&timestamp=${signed.timestamp}SECRET`));
// The list is deliberately NARROWER than the file picker's: a photo is
// re-encoded to JPEG in the browser, so jpg covers every camera format there is.
// png is the canvas fallback. Dropping either stops every photo upload; adding
// a format nothing produces only widens what could be put in the account.
eq('the allowlist is exactly jpg, png and pdf',
   signed.allowed_formats.split(',').sort(), ['jpg', 'pdf', 'png']);
// The object name stays this script's to choose. A client that could name its
// own could overwrite an existing photo, or another tenant's, by naming it.
eq('the object name is server-chosen, never taken from the request',
   signHandler({ sessionId: 's', publicId: 'attacker-chosen', folder: 'bca' }).publicId, 'uuid-fixed');

// A BATCH is N independent signatures, and the allowlist is part of what each
// one covers -- so it has to ride inside the loop, not be sent once beside it.
// Signed on the first and omitted from the rest would refuse every upload but
// the first, which reads as a flaky host.
const batch = signHandler({ sessionId: 's', count: 3 });
eq('a batch signs three separate objects',
   batch.signatures.map(x => x.publicId).length, 3);
eq('every signature in a batch carries the format allowlist',
   batch.signatures.every(x => x.allowed_formats === signed.allowed_formats), true);
eq('and every one names it among its signed parameters',
   batch.signatures.every(x => x.signedParams.includes('allowed_formats')), true);

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
