// Tests the frontend photo logic that has no browser in it — the pure parts,
// sliced out of index.html as source text so they cannot drift from what ships.
//
// What it exists to catch, in order of how quietly each would fail:
//   1. photoThumbUrl losing its DERIVE fallback. A row written before thumbUrl
//      was stored, or by hand, would then load the FULL image into every grid
//      tile — invisible on a desk, ruinous on school wifi in a mechanical room,
//      which is the one place this feature is most needed.
//   2. adoptPhoto losing the string/boolean normalize on hiddenFromPublic. The
//      sheet stores "true"; a photo deliberately withheld from the public QR
//      page would silently start appearing on it.
//   3. The fixture drifting from the real data shape — MOCK_PHOTOS pointing at
//      owner ids that no longer exist, or all being one shape. That is the
//      personIds lesson: a fixture whose shape differs from the backend's hides
//      exactly the bugs it exists to catch.
//
// Run: node test-frontend-photos.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// Includes a leading `async ` when there is one. Slicing from `function` alone
// drops it, and the body then has `await` inside a non-async function — which
// fails as "missing ) after argument list", an error that names neither the
// function nor the real cause.
function grab(name) {
  let i = src.indexOf(`function ${name}(`);
  if (i === -1) throw new Error(`${name} not found`);
  if (src.slice(i - 6, i) === 'async ') i -= 6;
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
}

const mod = {};
new Function('crypto', 'module', `
  ${src.slice(src.indexOf('const PHOTO_THUMB_TRANSFORM'), src.indexOf('const PDF_PREVIEW_TRANSFORM'))}
  ${src.slice(src.indexOf('const PDF_PREVIEW_TRANSFORM'), src.indexOf(';', src.indexOf('const PDF_PREVIEW_TRANSFORM')) + 1)}
  ${grab('adoptPhoto')}
  ${grab('photoTransformUrl')}
  ${grab('photoThumbUrl')}
  ${grab('photoPreviewUrl')}
  ${grab('fileKindOf')}
  module.adoptPhoto = adoptPhoto;
  module.photoThumbUrl = photoThumbUrl;
  module.photoPreviewUrl = photoPreviewUrl;
  module.fileKindOf = fileKindOf;
`)({ randomUUID: () => 'generated-uuid' }, mod);
const { adoptPhoto, photoThumbUrl, photoPreviewUrl, fileKindOf } = mod;

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name
    + (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
};

// ---------------------------------------------------------------- adoptPhoto
// The sheet stores the string "true"; doGet converts, but a fixture or a
// hand-edited row can still arrive either way, and BOTH have to end up boolean.
eq('the string "true" becomes a real boolean', adoptPhoto({ hiddenFromPublic: 'true' }).hiddenFromPublic, true);
eq('a real true stays true', adoptPhoto({ hiddenFromPublic: true }).hiddenFromPublic, true);
eq('a blank cell is not hidden', adoptPhoto({ hiddenFromPublic: '' }).hiddenFromPublic, false);
eq('a missing key is not hidden', adoptPhoto({}).hiddenFromPublic, false);
// "false" is what a hand-typed cell says when someone means false. Reading it as
// truthy would publish a withheld photo, so it is the case worth pinning.
eq('the string "false" is not hidden', adoptPhoto({ hiddenFromPublic: 'false' }).hiddenFromPublic, false);

eq('a row with no id is given one', adoptPhoto({}).id, 'generated-uuid');
eq('an existing id is left alone', adoptPhoto({ id: 'keep-me' }).id, 'keep-me');
// Never invent a url: a row without one is broken, and should render as broken
// rather than silently vanish from the grid.
eq('a missing url stays empty rather than being invented', adoptPhoto({}).url, '');
// Deliberately NOT defaulted to "asset", which it was until 2026-09-11. A blank
// ownerType can only come from a hand edit, and guessing one files a work
// entry's photo in its asset's gallery — the wrong photo shown confidently in
// the wrong place, which is worse than one that cannot be found.
eq('a blank ownerType is left blank, never guessed as "asset"', adoptPhoto({}).ownerType, '');
eq('a real ownerType is untouched', adoptPhoto({ ownerType: 'change' }).ownerType, 'change');

// kind, unlike ownerType, HAS a safe default: before v37 an image was the only
// thing that could be uploaded, so a blank cell is an image by fact rather than
// by guess. Reading it as anything else would unpublish every photo already on
// the sheet, since the public panel filter keys off this field.
eq('a blank kind is an image', adoptPhoto({}).kind, 'image');
eq('a stored kind is kept', adoptPhoto({ kind: 'pdf' }).kind, 'pdf');
eq('a missing fileName is blank rather than undefined', adoptPhoto({}).fileName, '');

// ------------------------------------------------------------ photoThumbUrl
const FULL = 'https://res.cloudinary.com/demo/image/upload/v1712345678/assets/abc.jpg';
eq('a stored thumbUrl wins', photoThumbUrl({ url: FULL, thumbUrl: 'https://stored/thumb.jpg' }), 'https://stored/thumb.jpg');
eq('a missing thumbUrl is derived by inserting a transform',
   photoThumbUrl({ url: FULL, thumbUrl: '' }),
   'https://res.cloudinary.com/demo/image/upload/w_400,h_400,c_fill,q_auto,f_auto/v1712345678/assets/abc.jpg');
// A url from somewhere else entirely — a sandbox object URL, a data URI, or a
// different host after a migration — has no transform to insert, and must come
// back usable rather than mangled.
eq('a non-Cloudinary url is returned unchanged',
   photoThumbUrl({ url: 'blob:http://localhost/abc', thumbUrl: '' }), 'blob:http://localhost/abc');
eq('a data URI is returned unchanged',
   photoThumbUrl({ url: 'data:image/svg+xml;utf8,%3Csvg%3E', thumbUrl: '' }), 'data:image/svg+xml;utf8,%3Csvg%3E');
eq('an empty photo does not throw', photoThumbUrl({}), '');

// A PDF's tile is its FIRST PAGE, rasterized on demand by the image host. Lose
// pg_1/f_jpg and the tile asks the browser to render a PDF inside an <img>,
// which no browser does — every document in the app becomes a grey square.
eq('a document derives a page-1 render rather than an image transform',
   photoThumbUrl({ url: 'https://res.cloudinary.com/demo/image/upload/v1/assets/quote.pdf', thumbUrl: '', kind: 'pdf' }),
   'https://res.cloudinary.com/demo/image/upload/w_400,h_400,c_fill,q_auto,f_jpg,pg_1/v1/assets/quote.pdf');
eq('the lightbox shows a photo itself',
   photoPreviewUrl({ url: FULL, kind: 'image' }), FULL);
eq('the lightbox shows a document as a rendered page, not as the file',
   photoPreviewUrl({ url: 'https://res.cloudinary.com/demo/image/upload/v1/assets/quote.pdf', kind: 'pdf' }),
   'https://res.cloudinary.com/demo/image/upload/w_1200,c_limit,q_auto,f_jpg,pg_1/v1/assets/quote.pdf');
// The Open button goes to `url` untouched, which is the whole point of showing
// a render beside it rather than instead of it.
eq('a sandbox document with no host to transform comes back unchanged',
   photoPreviewUrl({ url: 'data:application/pdf;base64,AAA', kind: 'pdf' }), 'data:application/pdf;base64,AAA');

// ---------------------------------------------------------------- fileKindOf
// iOS hands back a BLANK type for HEIC often enough that keying on the MIME
// type alone refuses photos taken on half the phones in the building.
eq('a jpeg is an image', fileKindOf({ type: 'image/jpeg', name: 'a.jpg' }), 'image');
eq('a pdf is a document', fileKindOf({ type: 'application/pdf', name: 'quote.pdf' }), 'pdf');
eq('a typeless .heic is still an image', fileKindOf({ type: '', name: 'IMG_1.HEIC' }), 'image');
eq('a typeless .pdf is still a document', fileKindOf({ type: '', name: 'Quote 4471.PDF' }), 'pdf');
eq('a video is refused', fileKindOf({ type: 'video/quicktime', name: 'a.mov' }), '');
eq('a word document is refused', fileKindOf({ type: 'application/msword', name: 'a.doc' }), '');
eq('a nameless, typeless file is refused rather than assumed', fileKindOf({}), '');

// ------------------------------------------------------------ fixture shape
// MOCK_PHOTOS is Sandbox's only photo data, so its shape IS the shape this
// feature gets exercised against. Read as source text rather than executed,
// since the file it lives in is a browser module.
const fixtureSrc = src.slice(src.indexOf('const MOCK_PHOTOS = ['), src.indexOf('];', src.indexOf('const MOCK_PHOTOS = [')) + 2);
const ownerTypesUsed = [...fixtureSrc.matchAll(/ownerType: "([a-z]+)"/g)].map(m => m[1]);
const ownerIdsUsed = [...fixtureSrc.matchAll(/ownerId: "([^"]+)"/g)].map(m => m[1]);

eq('the fixture covers more than one owner kind',
   [...new Set(ownerTypesUsed)].sort(), ['asset', 'breaker', 'change', 'circuit']);
// Sandbox is the only place this feature can be tried without a deploy, so a
// fixture of photos alone would leave the whole v37 document path unexercised
// there — tile fallback, PDF badge, Open, and a work entry holding both kinds.
eq('the fixture carries at least one document', /kind: "pdf"/.test(fixtureSrc), true);
eq('and at least one row with no kind at all, which adopts as an image',
   fixtureSrc.split('\n').some(l => /storageKey: "sandbox\//.test(l)) && !/kind: "image"/.test(fixtureSrc), true);
eq('a document carries its original file name', /fileName: "[^"]+\.pdf"/.test(fixtureSrc), true);
// The whole point of a mixed fixture: one row must exercise the derive path.
eq('at least one fixture photo has no stored thumbUrl',
   /thumbUrl: ""/.test(fixtureSrc), true);
eq('at least one fixture photo is hidden from the public page',
   /hiddenFromPublic: true/.test(fixtureSrc), true);
eq('at least one fixture photo is NOT hidden',
   /hiddenFromPublic: false/.test(fixtureSrc), true);

// Every owner the fixture names has to actually exist in MOCK_SNAPSHOT, or the
// gallery renders empty in Sandbox and the feature looks broken when it is not.
const mockSnapshotSrc = src.slice(src.indexOf('const MOCK_SNAPSHOT = {'));
const missing = ownerIdsUsed.filter(id => {
  // An asset is matched on `label:` or `id:`; a breaker/circuit on its own `id:`.
  return !(new RegExp('(id|label): "' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"').test(mockSnapshotSrc));
});
eq('every fixture photo points at an owner that exists in MOCK_SNAPSHOT', missing, []);

// ------------------------------------------------------------ wiring guards
// Each of these is a one-line edit away from silently breaking the feature, and
// none of them shows up as an error — the app just stops saving photos.
eq('photos is a revision domain on the frontend too',
   /REVISION_DOMAINS = \[[^\]]*"photos"/.test(src), true);
eq('persist computes a photos dirty flag',
   /photos: nextPhotos !== photos/.test(src), true);
eq('persist sends photos in the payload',
   /photos: nextPhotos,/.test(src), true);
eq('the read payload declares photos:false, matching the _dirty read guard',
   (src.match(/_dirty: \{ assets: false, config: false, breakerTypes: false, photos: false \}/g) || []).length, 2);
eq('Photos is a common detail tab, not a per-type module',
   /"maintenance", "photos", "comments", "audit"/.test(src), true);
// EXIF/GPS is dropped as a side effect of re-encoding; losing the canvas step
// would start shipping the school's coordinates to a third party.
eq('uploads are downscaled and re-encoded before leaving the browser',
   /canvas\.toBlob\(res, "image\/jpeg", PHOTO_JPEG_QUALITY\)/.test(src), true);
eq('orientation is applied before EXIF is discarded',
   /imageOrientation: "from-image"/.test(src), true);

// ------------------------------------------------- cascade on asset delete
// photoOwnerIdsOf collects every id an asset carries that can own a photo.
// Miss one and that owner's photos survive the asset as invisible orphans.
const cascadeMod = {};
new Function('module', grab('photoOwnerIdsOf') + '\nmodule.f = photoOwnerIdsOf;')(cascadeMod);
const ownerIds = cascadeMod.f;

const RICH_ASSET = {
  id: 'asset-1',
  changes: [{ id: 'change-1' }, { id: 'change-2' }, null],
  maintenanceItems: [{ id: 'maint-1' }, {}],
  breakers: [{ id: 'brk-1', circuits: [{ id: 'cir-1' }, { id: 'cir-2' }] }, { id: 'brk-2' }],
  unassignedCircuits: [{ id: 'cir-loose' }],
};
eq('every owner kind an asset carries is collected',
   ownerIds(RICH_ASSET).sort(),
   ['asset-1', 'brk-1', 'brk-2', 'change-1', 'change-2', 'cir-1', 'cir-2', 'cir-loose', 'maint-1']);
// Real data has holes — a pre-v34 row with no id, a null from a bad edit. A
// throw here would break the delete path entirely.
eq('a bare asset yields just itself', ownerIds({ id: 'solo' }), ['solo']);
eq('no asset yields nothing rather than throwing', ownerIds(null), []);
eq('an id-less child is skipped, not pushed as undefined',
   ownerIds({ id: 'a', changes: [{}, { id: 'c' }] }).sort(), ['a', 'c']);

// ------------------------------------------------------------ wiring guards 2
// The id has to exist when the dialog OPENS, or a photo has no owner to name
// while the form is being filled in — which is the whole point of attaching one
// there rather than after saving.
// Sliced as a function body rather than matched in a character window: the
// explanation above the mint is long, and a window wide enough to clear it
// would also reach into whatever function comes next.
eq('the Log work dialog mints the entry id on open',
   /id: crypto\.randomUUID\(\)/.test(grab('openChangeAdd')), true);
eq('addChange uses the id the draft was opened with',
   /id: changeDraft\.id \|\| crypto\.randomUUID\(\)/.test(src), true);
eq('deleting an asset cascades its photo rows',
   /photoOwnerIdsOf\(asset\)/.test(src) && /keptPhotos/.test(src), true);
// The lightbox must render from BOTH views: the Log work dialog opens from the
// site-wide Maintenance tab too, and a viewer that only renders in the detail
// view would set state and paint nothing.
const rwAt = src.indexOf('function renderWorkDialogs');
const lbAt = src.indexOf('{photoViewer && (');
const detailAt = src.indexOf('if (view === "detail" && selectedAsset)');
eq('the lightbox lives in renderWorkDialogs, not inside the detail view',
   rwAt !== -1 && lbAt > rwAt && lbAt < detailAt, true);
eq('every gallery opens through openPhotoViewer, which reseeds the caption draft',
   src.includes('onOpen={setPhotoViewer}'), false);

// A schedule's id must exist at CREATE time, not only after a load-time
// adoption fills it in — see BUGS.md. An id-less row cannot be addressed by any
// handler, and with two of them the wrong one is edited.
eq('the Add task dialog mints the schedule id on open',
   /id: crypto\.randomUUID\(\)/.test(src.slice(src.indexOf('setShowMaintenanceAdd(true)') - 400, src.indexOf('setShowMaintenanceAdd(true)'))), true);
eq('addMaintenanceItem writes an id rather than leaving it to the next load',
   /id: maintenanceDraft\.id \|\| crypto\.randomUUID\(\)/.test(src), true);
eq('a maintenance schedule can own photos',
   src.includes('attachPhotos("maintenance", item.id, files)'), true);
eq('a work entry can own photos',
   src.includes('attachPhotos("change", changeDraft.id, files)'), true);

// ------------------------------------------------- multi-file upload
// attachPhotos is EXECUTED here, not pattern-matched, because the rule that
// matters cannot be seen by reading: `photos` is the state the render closed
// over and does not advance during the loop, so persisting per file would build
// every list from the ORIGINAL array and each save would drop the ones before
// it — N writes, one photo surviving. That failure looks like "only the last
// photo uploaded", which reads as a flaky network rather than a bug.
function runAttach({ files, failOn = [], ownerType = 'asset' }) {
  const calls = { persist: [], persistAssets: [], errors: [], progress: [], busy: [] };
  const fn = new Function(
    'savingRef', 'photoBusy', 'PHOTO_OWNER_TYPES', 'setPhotoError', 'setPhotoBusy',
    'setPhotoProgress', 'preparePhotoRow', 'persist', 'photos', 'assets', 'module',
    grab('attachPhotos') + '\nmodule.f = attachPhotos;'
  );
  const mod = {};
  fn(
    { current: false },
    false,
    ['asset', 'breaker', 'circuit', 'change', 'maintenance'],
    (m) => calls.errors.push(m),
    (b) => calls.busy.push(b),
    (p) => calls.progress.push(p),
    async (ownerType, ownerId, file) => {
      if (failOn.includes(file.name)) throw new Error('nope');
      return { id: 'row-' + file.name, ownerType, ownerId };
    },
    async (a, overrides) => { calls.persist.push(overrides.photos); calls.persistAssets.push(a); },
    [{ id: 'existing' }],
    ASSETS,
    mod
  );
  return mod.f(ownerType, 'owner-1', files).then(() => calls);
}


// ------------------------------------------------- preparing one row (v37)
// preparePhotoRow is EXECUTED for the same reason attachPhotos is: what matters
// is which PATH a file takes, and that cannot be read off the source. A PDF put
// through the canvas step comes back a picture of nothing, or throws "could not
// be read as an image" on a file that is perfectly fine.
function runPrepare({ file, sandbox = false }) {
  const seen = { downscaled: 0, uploadNames: [] };
  const mod = {};
  new Function(
    'fileKindOf', 'PHOTO_MAX_BYTES', 'DOC_MAX_BYTES', 'downscalePhoto', 'sandboxMode',
    'crypto', 'currentUser', 'signPhotoUpload', 'uploadPhotoToCloudinary', 'photoThumbUrl',
    'URL', 'module',
    grab('preparePhotoRow') + '\nmodule.f = preparePhotoRow;'
  )(
    fileKindOf, 25 * 1024 * 1024, 10 * 1024 * 1024,
    async (f) => { seen.downscaled++; return { blob: { size: 1234 }, width: 1600, height: 1200 }; },
    sandbox,
    { randomUUID: () => 'new-uuid' },
    'Eric Stamage',
    async () => ({ publicId: 'uuid-fixed' }),
    async (blob, sig, uploadName) => {
      seen.uploadNames.push(uploadName);
      return { secure_url: 'https://res.cloudinary.com/x/image/upload/v1/dev/uuid-fixed.pdf', public_id: 'dev/uuid-fixed', bytes: 404 };
    },
    photoThumbUrl,
    { createObjectURL: () => 'blob:sandbox' },
    mod,
  );
  return mod.f('asset', 'BCA0082', file).then(row => ({ row, seen }), err => ({ error: err.message, seen }));
}

// The one array identity the assets-domain assertions below compare against.
// persist() decides which tabs to rewrite by reference equality, so "did this
// save carry the assets domain" is literally "is this a different array".
const ASSETS = [{ id: 'a1' }];

const F = (name) => ({ name, size: 1000 });

runAttach({ files: [F('a.jpg'), F('b.jpg'), F('c.jpg')] }).then(calls => {
  eq('three files produce exactly ONE snapshot write', calls.persist.length, 1);
  eq('that one write carries the existing photo plus all three new ones',
     calls.persist[0].map(p => p.id), ['existing', 'row-a.jpg', 'row-b.jpg', 'row-c.jpg']);
  eq('no error is reported when every file succeeds', calls.errors.filter(Boolean).length, 0);
  eq('busy goes true then false', calls.busy, [true, false]);

  // A partial failure keeps the good work. Throwing away two uploaded photos
  // because the third was a video is worse than reporting the third.
  return runAttach({ files: [F('a.jpg'), F('bad.mov'), F('c.jpg')], failOn: ['bad.mov'] });
}).then(calls => {
  eq('one bad file does not abandon the batch', calls.persist.length, 1);
  eq('the two good files are still written',
     calls.persist[0].map(p => p.id), ['existing', 'row-a.jpg', 'row-c.jpg']);
  eq('the failure names the file', /bad\.mov/.test(calls.errors.join(' ')), true);

  // Every file failing must write NOTHING — persisting an unchanged list would
  // bump the photos revision for no reason and conflict with other clients.
  return runAttach({ files: [F('bad1.mov'), F('bad2.mov')], failOn: ['bad1.mov', 'bad2.mov'] });
}).then(calls => {
  eq('all files failing writes nothing at all', calls.persist.length, 0);
  eq('and still reports both failures', /2 of 2/.test(calls.errors.join(' ')), true);

  // ---- the id a photo points at must be written in the SAME save -----------
  // A work entry's and a schedule's id are adopted at load with a RANDOM uuid
  // when the sheet's cell is blank, so an id that has never been saved is
  // different on the next load and the photo row pointing at it is orphaned --
  // written, correct, and unreachable. Marking the assets domain dirty is what
  // puts the id in the sheet alongside the row that names it. This is executed
  // rather than read because the whole mechanism is one array identity.
  return runAttach({ files: [F('a.jpg')], ownerType: 'change' });
}).then(calls => {
  eq('a work-entry photo carries the assets domain, so the entry id is stored',
     calls.persistAssets[0] !== ASSETS, true);
  eq('and it carries the same assets CONTENT, not a rebuilt list',
     calls.persistAssets[0], ASSETS);

  return runAttach({ files: [F('a.jpg')], ownerType: 'maintenance' });
}).then(calls => {
  eq('a schedule photo carries the assets domain too',
     calls.persistAssets[0] !== ASSETS, true);

  return runAttach({ files: [F('a.jpg')], ownerType: 'asset' });
}).then(calls => {
  // An asset's id is adopted as `a.id || a.label` -- deterministic, so a blank
  // cell yields the same id every load and there is nothing to rescue. Writing
  // the assets domain anyway would rewrite five tabs and bump the assets
  // revision, conflicting with anyone mid-edit, for no gain.
  eq('an asset photo does NOT needlessly rewrite the assets domain',
     calls.persistAssets[0], ASSETS);

  return runAttach({ files: [F('a.jpg')], ownerType: 'breaker' });
}).then(calls => {
  eq('nor does a breaker photo — breaker ids are minted inside an asset save',
     calls.persistAssets[0], ASSETS);

  return runAttach({ files: [] });
}).then(async (calls) => {
  eq('an empty pick does nothing and never sets busy', calls.busy.length, 0);

  // ---- which pipeline a file takes ----------------------------------------
  const asPdf = await runPrepare({ file: { name: 'Quote 4471.pdf', type: 'application/pdf', size: 900000 } });
  eq('a PDF never goes through the canvas', asPdf.seen.downscaled, 0);
  eq('a PDF is stored as a document', asPdf.row.kind, 'pdf');
  eq('a PDF keeps the name it had on the device', asPdf.row.fileName, 'Quote 4471.pdf');
  // Cloudinary reads the FORMAT off the posted part's filename, so this is what
  // decides whether the upload is accepted at all.
  eq('a PDF is announced to the host as a PDF', asPdf.seen.uploadNames, ['Quote 4471.pdf']);

  const asJpg = await runPrepare({ file: { name: 'IMG_4821.HEIC', type: 'image/heic', size: 4000000 } });
  eq('a photo is downscaled exactly once', asJpg.seen.downscaled, 1);
  eq('a photo is stored as an image', asJpg.row.kind, 'image');
  // The bytes are JPEG by the time they are posted; announcing the original
  // HEIC name would declare a format these bytes no longer are.
  eq('a photo is announced as the JPEG it has become', asJpg.seen.uploadNames, ['upload.jpg']);
  eq('a photo still keeps its original name for display', asJpg.row.fileName, 'IMG_4821.HEIC');

  // ---- what is refused, and before any work is done -----------------------
  const mov = await runPrepare({ file: { name: 'walkthrough.mov', type: 'video/quicktime', size: 100 } });
  eq('a video is refused by kind, not by size', /photo or a PDF/.test(mov.error), true);
  eq('and nothing was prepared for it', mov.seen.downscaled, 0);
  const bigPdf = await runPrepare({ file: { name: 'manual.pdf', type: 'application/pdf', size: 12 * 1024 * 1024 } });
  // A photo that size is fine, because re-encoding shrinks it. Nothing shrinks
  // a PDF, so the host would refuse it in its own words after a long upload.
  eq('an oversized PDF is refused here rather than by the host', /under 10MB/.test(bigPdf.error), true);
  eq('a 12MB PHOTO is still accepted, since re-encoding shrinks it',
     (await runPrepare({ file: { name: 'a.jpg', type: 'image/jpeg', size: 12 * 1024 * 1024 } })).row.kind, 'image');

  const sandboxPdf = await runPrepare({ file: { name: 'a.pdf', type: 'application/pdf', size: 10 }, sandbox: true });
  eq('sandbox makes no network call for a document either', sandboxPdf.seen.uploadNames, []);
  eq('and still records it as a document', sandboxPdf.row.kind, 'pdf');

  // A blank ownerType must not be guessed. Filing a work entry's photo in its
  // asset's gallery is the wrong photo shown confidently in the wrong place.
  eq('adoptPhoto never defaults a blank ownerType to "asset"',
     /ownerType: p\.ownerType \|\| "asset"/.test(src), false);
  eq('adoptPhoto leaves a blank ownerType blank',
     /ownerType: p\.ownerType \|\| ""/.test(src), true);

  // ---- the input and the wiring, which the execution above cannot see -------
  eq('the file input accepts several at once, photos and PDFs alike',
     /type="file" accept="image\/\*,application\/pdf" multiple/.test(src), true);
  eq('pick hands over the whole FileList rather than just the first',
     /Array\.from\(e\.target\.files\)/.test(src), true);
  // The split exists so a future call site cannot reintroduce a per-file write.
  eq('preparePhotoRow writes nothing — it returns a row',
     /persist\(/.test(grab('preparePhotoRow')), false);
  eq('attachPhotos writes exactly once in its source too',
     (grab('attachPhotos').match(/await persist\(/g) || []).length, 1);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch(err => {
  // A rejection here means attachPhotos let an error escape — which is exactly
  // what happens if the per-file catch is removed and one bad file abandons the
  // batch. Reported as a failure rather than a raw stack, so the cause is named.
  console.log('FAIL  attachPhotos let an error escape instead of collecting it');
  console.log('        ' + ((err && err.message) || err));
  console.log(`\n${pass} passed, ${fail + 1} failed`);
  process.exit(1);
});

