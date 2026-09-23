// Tests for the v41 floor-plan backend — the SpaceLinks/SpaceGroups tabs (a
// shape-on-a-plan -> Room link, and several shapes collapsed into a named
// group) and the Cloudinary RAW upload signature that lets an SVG floor plan
// be uploaded without being re-encoded the way a photo is.
//
// Tested here for the same reason test-backend-photos.js is: Sandbox mode
// never contacts Apps Script, the live backend needs a Google sign-in, and
// the signing path additionally needs credentials that only exist in a
// tenant's Script Properties. Every block below is SLICED OUT of
// AssetTrackerSync.gs as source text and run against fakes, so it tests the
// backend's actual contract rather than this file's idea of it.
//
// The things this exists to catch, each of which fails SILENTLY:
//   1. doPost writing a field doGet doesn't read back (or vice versa) — the
//      same two-halves-of-one-contract hazard as test-backend-assetid.js.
//   2. assetLabel/roomId/memberShapeIds not surviving the round trip, which
//      would silently un-link or un-group every space on the next load.
//   3. hideLabel losing its boolean-ness (stored as the string "true"/"").
//   4. floorPlanSign signing the IMAGE pipeline's allowed_formats instead of
//      "svg", or omitting a signed parameter from signedParams/the response —
//      either produces "invalid signature" with no indication why.
//   5. resourceType leaking into the signed params (it must not: Cloudinary's
//      resource_type is chosen by the UPLOAD URL, not a signed body field).
//
// Run: node test-backend-floorplan.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const src = fs.readFileSync(path.join(__dirname, 'AssetTrackerSync.gs'), 'utf8');

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
function between(startMarker, endMarker) {
  const i = src.indexOf(startMarker);
  if (i === -1) throw new Error(`marker not found: ${startMarker}`);
  const j = src.indexOf(endMarker, i);
  if (j === -1) throw new Error(`end marker not found: ${endMarker}`);
  return src.slice(i, j);
}

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name
    + (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
};

// --- 1. doPost's row-building (assets -> SpaceLinks/SpaceGroups rows) -------
// Sliced as the exact forEach bodies that build spaceLinkRows/spaceGroupRows
// from one asset, keyed on `key` the same way panelLabel is derived for
// breakers — never trusted from the child row's own payload.
const buildRows = new Function('asset', `
  const key = asset.id || asset.label;
  const spaceLinkRows = [];
  const spaceGroupRows = [];
  const a = asset;
  ${between('(a.floorPlanLinks || []).forEach(l => spaceLinkRows.push({', '\n      });') }
  return { spaceLinkRows, spaceGroupRows };
`);

const ASSET = {
  id: 'bldg-1', label: 'BCA0050',
  floorPlanLinks: [
    { shapeId: 'Space.0042', roomId: 'BCA0100', at: '2026-09-22T00:00:00.000Z', by: 'Eric' },
  ],
  floorPlanGroups: [
    { id: 'grp-uuid-1', name: "Women's Locker-Room", hideLabel: true, memberShapeIds: ['Space.0043', 'Space.0044'], at: '2026-09-22T00:00:00.000Z', by: 'Eric' },
  ],
};
const built = buildRows(ASSET);
eq('a link row is keyed on the owning asset\'s id, not its label',
   built.spaceLinkRows[0].assetLabel, 'bldg-1');
eq('a link row carries the shape id and the room it was linked to',
   [built.spaceLinkRows[0].shapeId, built.spaceLinkRows[0].roomId], ['Space.0042', 'BCA0100']);
eq('a group row carries its own id, name and comma-joined members',
   [built.spaceGroupRows[0].id, built.spaceGroupRows[0].name, built.spaceGroupRows[0].memberShapeIds],
   ['grp-uuid-1', "Women's Locker-Room", 'Space.0043,Space.0044']);
eq('hideLabel is written as the string "true", not a boolean',
   built.spaceGroupRows[0].hideLabel, 'true');
const builtNoHide = buildRows(Object.assign({}, ASSET, {
  floorPlanGroups: [Object.assign({}, ASSET.floorPlanGroups[0], { hideLabel: false })],
}));
eq('hideLabel false is written as an empty string, not "false"',
   builtNoHide.spaceGroupRows[0].hideLabel, '');
// A row keyed on a pre-v31 asset with no id falls back to its label, same as
// every other child table here.
eq('an asset with no id falls back to its label as the key',
   buildRows(Object.assign({}, ASSET, { id: undefined })).spaceLinkRows[0].assetLabel, 'BCA0050');

// --- 2. doGet's row-reading (SpaceLinks/SpaceGroups rows -> asset fields) ---
// The slice is exactly the two object-literal entries doGet spreads onto each
// asset (trailing comma and all) — wrapping it in { } is a plain object
// literal, where a trailing comma is legal, rather than fragile string
// surgery to turn it into declarators.
const readBackSrc = between('floorPlanLinks: spaceLinkRows.filter', '\n      };');
const readBack = new Function('spaceLinkRows', 'spaceGroupRows', 'label', `
  return { ${readBackSrc} };
`);

const linkRows = [
  { assetLabel: 'bldg-1', shapeId: 'Space.0042', roomId: 'BCA0100', at: 't1', by: 'Eric' },
  { assetLabel: 'other-bldg', shapeId: 'Space.0099', roomId: 'BCA0200', at: 't2', by: 'Eric' },
];
const groupRows = [
  { id: 'grp-uuid-1', assetLabel: 'bldg-1', name: 'Kitchen Cluster', hideLabel: 'true', memberShapeIds: 'Space.0010,Space.0011', at: 't1', by: 'Eric' },
];
const read = readBack(linkRows, groupRows, 'bldg-1');
eq('read scopes links to the requested asset only',
   read.floorPlanLinks.map(l => l.shapeId), ['Space.0042']);
eq('read resolves a group\'s comma-joined members back into an array',
   read.floorPlanGroups[0].memberShapeIds, ['Space.0010', 'Space.0011']);
eq('read resolves hideLabel back into a real boolean, not the string "true"',
   read.floorPlanGroups[0].hideLabel, true);
eq('an asset with no rows of its own reads back empty arrays, not undefined',
   readBack(linkRows, groupRows, 'nobody-here'), { floorPlanLinks: [], floorPlanGroups: [] });

// --- 3. the floorPlanSign handler --------------------------------------------
const Utilities = {
  DigestAlgorithm: { SHA_1: 'SHA_1' },
  Charset: { UTF_8: 'UTF_8' },
  computeDigest: (_alg, text) =>
    Array.from(crypto.createHash('sha1').update(text, 'utf8').digest())
      .map(b => (b > 127 ? b - 256 : b)),
  getUuid: () => 'plan-uuid-fixed',
};
const sha1 = (s) => crypto.createHash('sha1').update(s, 'utf8').digest('hex');

function makeSignHandler(propsOverride) {
  const mod = {};
  new Function('Utilities', 'PropertiesService', 'ROLE_EDITOR',
    'readConfigMap_', 'authorizeSession_', 'jsonOut_', 'module', `
    ${grab('sha1Hex_')}
    ${grab('cloudinarySignature_')}
    ${src.slice(src.indexOf('const FLOORPLAN_ALLOWED_FORMATS'), src.indexOf(';', src.indexOf('const FLOORPLAN_ALLOWED_FORMATS')) + 1)}
    ${grab('handleFloorPlanSign_')}
    module.f = handleFloorPlanSign_;
  `)(
    Utilities,
    { getScriptProperties: () => ({ getProperty: (k) => (propsOverride || {
      CLOUDINARY_CLOUD_NAME: 'school', CLOUDINARY_API_KEY: 'KEY',
      CLOUDINARY_API_SECRET: 'SECRET', CLOUDINARY_FOLDER: 'dev',
    })[k] || null }) },
    'editor',
    () => ({}),
    (sessionId) => sessionId === 'viewer-session'
      ? { ok: true, role: 'viewer', email: 'v@example.com' }
      : { ok: true, role: 'editor', email: 'eric@example.com' },
    (o) => o,
    mod,
  );
  return mod.f;
}

const signHandler = makeSignHandler();
const signed = signHandler({ sessionId: 'editor-session' });
eq('signing succeeds for an editor with credentials set', signed.ok, true);
eq('the allowlist is exactly svg, not the photo pipeline\'s jpg/png/pdf',
   signed.allowed_formats, 'svg');
eq('every signed parameter is named in signedParams',
   signed.signedParams, ['allowed_formats', 'folder', 'public_id', 'timestamp']);
// resourceType tells the CLIENT which URL to post to; Cloudinary itself reads
// that from the URL path, not a signed field — including it in signedParams
// would make Cloudinary compute a different signature than this one covers.
eq('resourceType is NOT among the signed parameters',
   signed.signedParams.includes('resourceType'), false);
eq('resourceType is "raw", so the client posts to .../raw/upload',
   signed.resourceType, 'raw');
eq('the signature matches folder+public_id+timestamp+allowed_formats, secret appended',
   signed.signature,
   sha1(`allowed_formats=svg&folder=dev&public_id=plan-uuid-fixed&timestamp=${signed.timestamp}SECRET`));
eq('the object name is server-chosen, never taken from the request',
   signHandler({ sessionId: 'editor-session', publicId: 'attacker-chosen' }).publicId, 'plan-uuid-fixed');

eq('a viewer is refused', signHandler({ sessionId: 'viewer-session' }).authFailed, true);
{
  const noCreds = makeSignHandler({})({ sessionId: 'editor-session' });
  eq('missing credentials refuses with a message naming the Script Properties',
     noCreds.ok === false && /CLOUDINARY_CLOUD_NAME/.test(noCreds.error), true);
}

// --- 4. schema guards --------------------------------------------------------
eq('SpaceLinks is in the admin wipe/import list',
   /SHEET_NAMES\.spaceLinks, headers: SPACE_LINK_FIELDS/.test(src), true);
eq('SpaceGroups is in the admin wipe/import list',
   /SHEET_NAMES\.spaceGroups, headers: SPACE_GROUP_FIELDS/.test(src), true);
eq('the floor plan file reference rides ASSET_FIELDS, not a child tab',
   /"floorPlanUrl", "floorPlanStorageKey", "floorPlanFileName"/.test(src), true);
eq('links/groups are NOT their own revision domain (they ride assets, like breakers)',
   /REVISION_DOMAINS = \[[^\]]*"spaceLinks"/.test(src), false);
eq('doPost writes SpaceLinks/SpaceGroups only when dirty.assets triggers it',
   /writeTableIfChanged_\(SHEET_NAMES\.spaceLinks, SPACE_LINK_FIELDS/.test(
     between('if (dirty.assets) {', 'appendNewRows_(')), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
