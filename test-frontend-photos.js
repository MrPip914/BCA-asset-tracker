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

function grab(name) {
  const i = src.indexOf(`function ${name}(`);
  if (i === -1) throw new Error(`${name} not found`);
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
}

const mod = {};
new Function('crypto', 'module',
  grab('adoptPhoto') + grab('photoThumbUrl')
  + '\nmodule.adoptPhoto = adoptPhoto; module.photoThumbUrl = photoThumbUrl;'
)({ randomUUID: () => 'generated-uuid' }, mod);
const { adoptPhoto, photoThumbUrl } = mod;

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
eq('ownerType defaults to asset', adoptPhoto({}).ownerType, 'asset');

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

// ------------------------------------------------------------ fixture shape
// MOCK_PHOTOS is Sandbox's only photo data, so its shape IS the shape this
// feature gets exercised against. Read as source text rather than executed,
// since the file it lives in is a browser module.
const fixtureSrc = src.slice(src.indexOf('const MOCK_PHOTOS = ['), src.indexOf('];', src.indexOf('const MOCK_PHOTOS = [')) + 2);
const ownerTypesUsed = [...fixtureSrc.matchAll(/ownerType: "([a-z]+)"/g)].map(m => m[1]);
const ownerIdsUsed = [...fixtureSrc.matchAll(/ownerId: "([^"]+)"/g)].map(m => m[1]);

eq('the fixture covers more than one owner kind',
   [...new Set(ownerTypesUsed)].sort(), ['asset', 'breaker', 'circuit']);
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
