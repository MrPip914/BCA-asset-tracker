// Tests for the Floor Plan tab's pure logic: the per-type "can carry a floor
// plan" toggle, and the geometry/parsing math (clearance-based label sizing,
// viewBox framing, and the SVG path/transform parsing a real Visio export
// needs).
//
// parseFloorPlanSvg itself is NOT tested here — it calls the real browser
// DOMParser, which plain Node has no equivalent of, and this project's own
// convention (see CLAUDE.md, the snapshot-cache and nav sections) is that
// genuine browser behavior gets verified by driving the real page in
// Chromium, not faked with a DOM shim that tests this file's idea of a
// parser instead of the real one. Its building blocks — floorPlanPathToPoints
// (arc-aware path parsing) and floorPlanParseTransform/floorPlanApplyTransform
// (the transform composition) — ARE pure and ARE tested here, since those are
// exactly the pieces that fail silently and produce a garbled outline with no
// error (the same arc-desync bug the prototype hit against a real 29-space
// export, ported here as a regression check).
//
// Run: node test-frontend-floorplan.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function grabFn(name) {
  const i = src.indexOf(`function ${name}(`);
  if (i === -1) throw new Error(`${name} not found`);
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error(`${name} not closed`);
}
function grabBlock(startsWith, endsWith) {
  const i = src.indexOf(startsWith);
  if (i === -1) throw new Error(`${startsWith} not found`);
  const j = src.indexOf(endsWith, i);
  if (j === -1) throw new Error(`${endsWith} not found after ${startsWith}`);
  return src.slice(i, j + endsWith.length);
}

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};
const approx = (a, b, eps) => Math.abs(a - b) < (eps || 0.01);

// --- 1. the per-type toggle ---------------------------------------------------
const registrySrc = grabBlock('const TYPE_REGISTRY = {', '\n};');
const iconStubs = [...new Set(
  [...registrySrc.matchAll(/\bicon:\s*([A-Z]\w*)/g)].map(m => m[1])
)].map(n => `const ${n} = null;`).join('\n');

const toggleMod = { exports: {} };
try {
  new Function('module', [
    iconStubs,
    'let TYPE_SETTINGS = {};',
    'let TYPE_FIELD_COLUMNS = [];',
    registrySrc,
    'let DERIVED_TYPE_SETS = { restrictedFields: new Set(), placeTypes: new Set() };',
    grabFn('recomputeDerivedTypeSets'),
    'recomputeDerivedTypeSets();',
    grabFn('typeEntryFor'),
    grabFn('typeHasFloorPlan'),
    grabFn('isPlaceType'),
    grabFn('modulesFor'),
    grabFn('availableTabsFor'),
    // setTypeSettings lets a test swap in an override without re-evaluating
    // the whole module for each case.
    'module.exports = { typeHasFloorPlan, availableTabsFor, setTypeSettings: s => { TYPE_SETTINGS = s; recomputeDerivedTypeSets(); } };',
  ].join('\n'))(toggleMod);
} catch (e) {
  console.error('Could not evaluate the type-toggle helpers:\n  ' + e.message);
  process.exit(1);
}
const { typeHasFloorPlan, availableTabsFor, setTypeSettings } = toggleMod.exports;

check('Room carries a floor plan by default', typeHasFloorPlan('Room') === true);
check('Building carries a floor plan by default', typeHasFloorPlan('Building') === true);
// Campus joined Room/Building once plan-to-plan navigation needed a site
// plan to navigate FROM -- see onNavigateToPlan in FloorPlanTabContent.
check('Campus carries a floor plan by default', typeHasFloorPlan('Campus') === true);
check('Computer does not carry a floor plan by default', typeHasFloorPlan('Computer') === false);
check('an unregistered (user-created) type does not carry one by default', typeHasFloorPlan('SomeCustomType') === false);

setTypeSettings({ Computer: { floorPlan: true } });
check('a per-type override can turn it ON for a type that ships off', typeHasFloorPlan('Computer') === true);
check('Room is unaffected by an override naming a different type', typeHasFloorPlan('Room') === true);
setTypeSettings({ Room: { floorPlan: false } });
check('a per-type override can turn it OFF for a type that ships on', typeHasFloorPlan('Room') === false);
setTypeSettings({});

// The per-asset "Floor Plan" detail tab was removed once the site-wide Map
// tab took over managing a plan -- typeHasFloorPlan now decides only what
// the Map tab shows at a given scope, never a per-asset tab. availableTabsFor
// must never resurrect it, for ANY type, regardless of the setting above.
check('availableTabsFor no longer offers a floorPlan tab for Room', !availableTabsFor('Room').includes('floorPlan'));
check('availableTabsFor no longer offers a floorPlan tab for Building', !availableTabsFor('Building').includes('floorPlan'));
check('availableTabsFor no longer offers a floorPlan tab for Computer', !availableTabsFor('Computer').includes('floorPlan'));

// --- 2. geometry: clearance-based label sizing --------------------------------
const geomMod = { exports: {} };
new Function('module', [
  grabFn('floorPlanPointInPoly'),
  grabFn('floorPlanSegDist'),
  grabFn('floorPlanPole'),
  grabFn('floorPlanBbox'),
  grabFn('floorPlanGroupOutlineKey'),
  grabFn('floorPlanGroupOutline'),
  grabFn('floorPlanWrapWords'),
  grabFn('floorPlanLabelFit'),
  grabFn('floorPlanZoomViewBox'),
  grabFn('floorPlanZoomAt'),
  'module.exports = { floorPlanPole, floorPlanBbox, floorPlanGroupOutline, floorPlanLabelFit, floorPlanZoomViewBox, floorPlanZoomAt };',
].join('\n'))(geomMod);
const { floorPlanPole, floorPlanBbox, floorPlanGroupOutline, floorPlanLabelFit, floorPlanZoomViewBox, floorPlanZoomAt } = geomMod.exports;

// A 100x100 square: the pole should land at the center with clearance ~50.
const square = [[0, 0], [100, 0], [100, 100], [0, 100]];
const squarePole = floorPlanPole(square);
check('a square\'s pole lands near its center', approx(squarePole.x, 50, 3) && approx(squarePole.y, 50, 3),
  `got (${squarePole.x}, ${squarePole.y})`);
check('a square\'s clearance is about half its side', approx(squarePole.clear, 50, 3), `got ${squarePole.clear}`);

// A long, narrow hallway (300 x 6): clearance should be tiny (~3), even
// though its bounding-box WIDTH (300) is huge — this is the exact bug the
// prototype fixed (Stage Left Hall's label rendering far too large because it
// was sized off the bounding box instead of the local clearance). Narrow
// enough that clear*1.15 lands clearly under the 11px cap both shapes would
// otherwise hit — a hallway that's merely somewhat narrow proves nothing if
// both ends up pinned to the same maximum.
const hallway = [[0, 0], [300, 0], [300, 6], [0, 6]];
const hallPole = floorPlanPole(hallway);
check('a narrow hallway has small clearance despite a huge bounding box',
  hallPole.clear < 5, `got ${hallPole.clear}`);
const { fs: hallFs } = floorPlanLabelFit(1, hallPole.clear, 11, 'Stage Left Hall');
const { fs: squareFs } = floorPlanLabelFit(1, squarePole.clear, 11, 'Main Room');
check('the hallway\'s label is sized smaller than the square\'s, not larger',
  hallFs < squareFs, `hallway fs=${hallFs}, square fs=${squareFs}`);

// --- 2b. group outline: edge-cancellation union of adjacent rooms -------------
// Two unit squares sharing the edge x=1 -- the union is a 2x1 rectangle, and
// the shared wall must cancel out of the traced boundary entirely rather
// than showing up as a stray interior line.
const shoelaceArea = loop => Math.abs(loop.reduce((s, p, i) => {
  const q = loop[(i + 1) % loop.length];
  return s + (p[0] * q[1] - q[0] * p[1]);
}, 0)) / 2;
{
  const left = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const right = [[1, 0], [2, 0], [2, 1], [1, 1]];
  const outline = floorPlanGroupOutline([left, right]);
  check('two adjacent squares trace to their combined 2x1 area, not each square alone',
    outline && approx(shoelaceArea(outline), 2), `got ${outline && shoelaceArea(outline)}`);
  const hasCorner = (loop, x, y) => loop.some(([px, py]) => approx(px, x) && approx(py, y));
  check('the traced outline reaches the far outer corner (2,1), not just each square\'s own',
    outline && hasCorner(outline, 2, 1), JSON.stringify(outline));
  check('the shared wall (x=1) does not survive as a visible interior edge',
    outline && outline.filter(([x]) => approx(x, 1)).length <= 2, JSON.stringify(outline));
}

// Three unit squares forming an L (bottom-left, bottom-right, top-right) --
// the traced outline has to be SMALLER than the 2x2 bounding box a rect
// would have used, or it isn't actually following the concave shape.
{
  const a = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const b = [[1, 0], [2, 0], [2, 1], [1, 1]];
  const c = [[1, 1], [2, 1], [2, 2], [1, 2]];
  const outline = floorPlanGroupOutline([a, b, c]);
  check('an L of three squares traces to area 3, not the 2x2=4 bounding box',
    outline && approx(shoelaceArea(outline), 3), `got ${outline && shoelaceArea(outline)}`);
}

// Two squares that share no edge at all -- the exact shape of the fixture's
// own "Storage & Hallway" group, whose two rooms are grouped on the floor
// plan without sharing a wall on the SVG (a gap between them). Edge
// cancellation cancels nothing, so this closes into TWO separate loops, not
// one -- and returning either loop alone would trace one room while
// silently leaving the other one outside its own group's border, which is
// worse than the bounding box this must fall back to instead.
{
  const disjoint = floorPlanGroupOutline([[[0, 0], [1, 0], [1, 1], [0, 1]], [[5, 5], [6, 5], [6, 6], [5, 6]]]);
  check('two shapes with no shared wall return null rather than tracing just one of them',
    disjoint === null, JSON.stringify(disjoint));
}

// A single polygon (the caller never does this -- a "group" of one member
// is refused elsewhere -- but the helper itself should still behave) traces
// back to its own boundary rather than returning null or throwing.
{
  const solo = floorPlanGroupOutline([[[0, 0], [3, 0], [3, 2], [0, 2]]]);
  check('a single polygon traces back to its own area', solo && approx(shoelaceArea(solo), 6),
    `got ${solo && shoelaceArea(solo)}`);
}

// --- 3. label wrapping ---------------------------------------------------------
const { words: shortWords } = floorPlanLabelFit(1, 50, 11, 'Kitchen');
check('a short label that fits is not wrapped', shortWords.length === 1);
const { words: longWords } = floorPlanLabelFit(1, 8, 11, "Women's Locker-Room Water Heater");
check('a long label in a tight space wraps to more than one line', longWords.length > 1,
  `got ${JSON.stringify(longWords)}`);
check('wrapping does not drop any words', longWords.join(' ').split(/\s+/).length,
  "Women's Locker-Room Water Heater".split(/\s+/).length);

// --- 4. viewBox framing ---------------------------------------------------------
const framed = floorPlanZoomViewBox({ x: 0, y: 0, w: 100, h: 100 }, 0, 1);
check('framing a square bbox at 1:1 aspect with no padding reproduces it',
  approx(framed.w, 100) && approx(framed.h, 100), JSON.stringify(framed));
const paddedFrame = floorPlanZoomViewBox({ x: 0, y: 0, w: 100, h: 100 }, 0.1, 1);
check('padding grows the frame rather than shrinking it',
  paddedFrame.w > 100 && paddedFrame.h > 100, JSON.stringify(paddedFrame));
// aspect is the STAGE's own height/width ratio (matching how the prototype's
// zoomTo read stage.getBoundingClientRect()) — a WIDE stage has a SMALL
// aspect (short relative to its width), e.g. 0.5 for a 2:1 stage.
const wideStage = floorPlanZoomViewBox({ x: 0, y: 0, w: 100, h: 100 }, 0, 0.5);
check('framing a square on a wide stage grows the WIDTH to fill it, keeping the shape centered',
  wideStage.w > wideStage.h, JSON.stringify(wideStage));
const tinyFrame = floorPlanZoomViewBox({ x: 0, y: 0, w: 1, h: 1 }, 0, 1);
check('an absurdly small bbox is floored at a minimum width rather than zooming in forever',
  tinyFrame.w >= 80, JSON.stringify(tinyFrame));

// w starts well above the 80-unit floor (see floorPlanZoomViewBox's own
// "tiny bbox" test above) so halving it lands somewhere that floor can't
// mask a broken factor.
const zoomedIn = floorPlanZoomAt({ x: 0, y: 0, w: 400, h: 400 }, 0.5, 200, 200);
check('zooming in around the center keeps that center point fixed',
  approx(zoomedIn.x + zoomedIn.w / 2, 200) && approx(zoomedIn.y + zoomedIn.h / 2, 200), JSON.stringify(zoomedIn));
check('zooming in by 0.5 halves the width', approx(zoomedIn.w, 200), JSON.stringify(zoomedIn));

// --- 5. path parsing: the arc-desync bug, pinned as a regression -------------
const pathMod = { exports: {} };
new Function('module', [
  grabFn('floorPlanPathToPoints'),
  'module.exports = { floorPlanPathToPoints };',
].join('\n'))(pathMod);
const { floorPlanPathToPoints } = pathMod.exports;

check('a plain M/L rectangle parses to 4 points',
  floorPlanPathToPoints('M0 0 L100 0 L100 100 L0 100 Z').length === 4);
// A room with one rounded corner: three straight sides plus one arc. Pairing
// every number naively (the bug this parser exists to avoid) would desync
// every point after the arc's 7 non-paired parameters and either throw or
// silently misplace the rest of the outline.
const arcPath = 'M0 0 L80 0 L100 20 A20 20 0 0 1 100 40 L100 100 L0 100 Z';
const arcPts = floorPlanPathToPoints(arcPath);
check('a path with one rounded corner (arc) does not throw and returns real points',
  arcPts.length >= 5 && arcPts.every(p => p.length === 2 && !p.some(Number.isNaN)),
  JSON.stringify(arcPts));
check('the arc contributes its ENDPOINT (100,40), not a desynced pairing of its 7 params',
  arcPts.some(([x, y]) => approx(x, 100) && approx(y, 40)), JSON.stringify(arcPts));
// The two points AFTER the arc must still be correct — this is exactly what
// desyncs if the arc's params are paired as if they were plain x,y pairs.
check('points after the arc are not corrupted by the arc\'s own parameters',
  arcPts.some(([x, y]) => approx(x, 100) && approx(y, 100)) && arcPts.some(([x, y]) => approx(x, 0) && approx(y, 100)),
  JSON.stringify(arcPts));

// --- 6. transform composition ---------------------------------------------------
const tMod = { exports: {} };
new Function('module', [
  grabFn('floorPlanParseTransform'),
  grabFn('floorPlanApplyTransform'),
  'module.exports = { floorPlanParseTransform, floorPlanApplyTransform };',
].join('\n'))(tMod);
const { floorPlanParseTransform, floorPlanApplyTransform } = tMod.exports;

check('a translate-only transform reads its tx/ty and no rotation',
  JSON.stringify(floorPlanParseTransform('translate(10,20)')) === JSON.stringify({ tx: 10, ty: 20, rot: 0 }));
check('a rotate-only transform reads its angle and no translation',
  JSON.stringify(floorPlanParseTransform('rotate(90)')) === JSON.stringify({ tx: 0, ty: 0, rot: 90 }));
check('a missing/unrecognized transform is the identity, not a throw',
  JSON.stringify(floorPlanParseTransform('')) === JSON.stringify({ tx: 0, ty: 0, rot: 0 }));

const rotated = floorPlanApplyTransform({ tx: 0, ty: 0, rot: 90 }, 10, 0);
check('a 90-degree rotation sends (10,0) to (~0,10)', approx(rotated[0], 0) && approx(rotated[1], 10),
  JSON.stringify(rotated));
const translated = floorPlanApplyTransform({ tx: 5, ty: 5, rot: 0 }, 10, 10);
check('a plain translation just adds tx/ty', JSON.stringify(translated) === JSON.stringify([15, 15]));

// --- 7. remapping links/groups across a plan REPLACE ----------------------------
// The bug this covers: replacing a floor plan's SVG can hand every shape a
// brand-new id (Visio's own numeric suffix is NOT stable across a re-export,
// only the title is — see floorPlanRemapShapeIds's own comment), so a room
// link stored against the OLD id silently stopped matching anything on the
// new plan. It stayed in storage, inflated the "linked" count, and blocked
// its room from being picked again as "already assigned elsewhere" — on a
// plan that, as far as anyone could see, had never been linked at all.
const remapMod = { exports: {} };
new Function('module', [
  grabFn('floorPlanRemapShapeIds'),
  grabFn('floorPlanRemapLinksAndGroups'),
  'module.exports = { floorPlanRemapShapeIds, floorPlanRemapLinksAndGroups };',
].join('\n'))(remapMod);
const { floorPlanRemapShapeIds, floorPlanRemapLinksAndGroups } = remapMod.exports;

{
  const oldSpaces = [
    { gid: 'old-1', title: 'Space.101' },
    { gid: 'old-2', title: 'Space.102' },
  ];
  // A re-export: same titles, entirely different ids -- the exact case that
  // broke, and the one this exists to carry forward.
  const newSpacesRenamed = [
    { gid: 'new-9', title: 'Space.101' },
    { gid: 'new-8', title: 'Space.102' },
  ];
  const remap = floorPlanRemapShapeIds(oldSpaces, newSpacesRenamed);
  check('a shape whose id changed is found by its (stable) title',
    remap('old-1') === 'new-9', `got ${JSON.stringify(remap('old-1'))}`);
  check('a shape with no match in the new plan is undefined, not guessed',
    floorPlanRemapShapeIds(oldSpaces, [{ gid: 'new-1', title: 'Space.999' }])('old-1') === undefined);

  // A tool whose ids DO survive a re-export (or a literal re-upload of the
  // same file) is trusted outright — id match wins before title is even
  // consulted, so this is not solely a title-matching mechanism.
  const newSpacesSameIds = [{ gid: 'old-1', title: 'Space.WHATEVER' }];
  check('a direct id match is trusted even if the title changed underneath it',
    floorPlanRemapShapeIds(oldSpaces, newSpacesSameIds)('old-1') === 'old-1');
}

{
  const oldSpaces = [
    { gid: 'old-1', title: 'Space.101' },
    { gid: 'old-2', title: 'Space.102' },
    { gid: 'old-3', title: 'Space.103' },
  ];
  const newSpaces = [
    { gid: 'new-1', title: 'Space.101' }, // survives, renamed
    { gid: 'new-2', title: 'Space.102' }, // survives, renamed
    // Space.103 is gone entirely -- the room genuinely isn't on this plan.
  ];
  const links = [
    { shapeId: 'old-1', roomId: 'BCR0001' },
    { shapeId: 'old-3', roomId: 'BCR0003' },
  ];
  const groups = [
    // Both members survive -- the group itself should survive, remapped.
    { id: 'g1', name: 'Pair', memberShapeIds: ['old-1', 'old-2'] },
    // Only one member survives -- a "group" of one is not a group; the
    // same rule saveGroupEditNow already applies when a member is removed
    // by hand.
    { id: 'g2', name: 'Orphaned', memberShapeIds: ['old-1', 'old-3'] },
  ];
  const { links: nextLinks, groups: nextGroups } = floorPlanRemapLinksAndGroups(links, groups, oldSpaces, newSpaces);

  check('a link onto a surviving (renamed) shape is remapped, not dropped',
    nextLinks.some(l => l.shapeId === 'new-1' && l.roomId === 'BCR0001'),
    `got ${JSON.stringify(nextLinks)}`);
  check('a link onto a shape that is genuinely gone is dropped, not left dangling',
    !nextLinks.some(l => l.roomId === 'BCR0003'),
    `got ${JSON.stringify(nextLinks)}`);
  check('exactly the surviving links remain', nextLinks.length === 1,
    `got ${JSON.stringify(nextLinks)}`);

  check('a group whose members all survive keeps them, remapped',
    JSON.stringify((nextGroups.find(g => g.id === 'g1') || {}).memberShapeIds) === JSON.stringify(['new-1', 'new-2']),
    `got ${JSON.stringify(nextGroups)}`);
  check('a group that drops below two surviving members is dropped whole',
    !nextGroups.some(g => g.id === 'g2'),
    `got ${JSON.stringify(nextGroups)}`);
}

check('a first upload (no old plan yet) drops every link rather than throwing',
  JSON.stringify(floorPlanRemapLinksAndGroups(
    [{ shapeId: 'old-1', roomId: 'BCR0001' }], [], [], [{ gid: 'new-1', title: 'Space.101' }]
  ).links) === '[]');

// --- 8. drawnOnMapFor: finding where a room/asset is shown on SOME plan --------
// The "Show on map" cross-navigation this exists for: an ordinary asset is
// never itself drawn, only the room holding it is, and the room holding it
// can be nested arbitrarily deep with a plan living at any level -- not just
// the one hardcoded floor the mockup's own drawnFor walked.
const drawnMod = { exports: {} };
new Function('module', [
  grabFn('drawnOnMapFor'),
  'module.exports = { drawnOnMapFor };',
].join('\n'))(drawnMod);
const { drawnOnMapFor } = drawnMod.exports;

{
  const assets = [
    { id: 'building', parentId: null, floorPlanUrl: 'x.svg', floorPlanLinks: [{ shapeId: 'shape-1', roomId: 'room' }] },
    { id: 'room', parentId: 'building' },
    { id: 'device', parentId: 'room' },
  ];
  check('a room drawn directly on its parent\'s plan is found',
    JSON.stringify(drawnOnMapFor('room', assets)) === JSON.stringify({ ownerId: 'building', shapeId: 'shape-1', roomId: 'room' }));
  // The real call site passes an ordinary (non-place) asset's parentId here,
  // never the asset's own id -- but the function itself has no notion of
  // "place" at all, it just walks parents. Calling it with the DEVICE's own
  // id still finds the room's link by climbing straight past it, which is
  // the same "fall back to an ancestor that IS drawn" behavior as the nested
  // case below, just entered one level lower. Worth pinning: it means an
  // isPlaceType mistake at the call site would degrade to "finds it anyway"
  // rather than a silent miss.
  check("starting from a non-place asset's own id still finds its room via the same walk-up",
    JSON.stringify(drawnOnMapFor('device', assets)) === JSON.stringify({ ownerId: 'building', shapeId: 'shape-1', roomId: 'room' }));

  // A device's own room isn't drawn, but ITS parent (a nested "wing" room) is
  // -- the same "falls back to whichever ancestor room IS drawn" case the
  // mockup's drawnFor handled, generalized past one hardcoded floor.
  const nested = [
    { id: 'building', parentId: null, floorPlanUrl: 'x.svg', floorPlanLinks: [{ shapeId: 'shape-9', roomId: 'wing' }] },
    { id: 'wing', parentId: 'building' },
    { id: 'closet', parentId: 'wing' }, // not itself linked to any shape
  ];
  check('an undrawn room falls back to the nearest ancestor room that IS drawn',
    JSON.stringify(drawnOnMapFor('closet', nested)) === JSON.stringify({ ownerId: 'building', shapeId: 'shape-9', roomId: 'wing' }));
}

check('a room whose parent has no floor plan at all is not drawn anywhere',
  drawnOnMapFor('room', [{ id: 'building', parentId: null }, { id: 'room', parentId: 'building' }]) === null);

check('a room whose parent has a plan but no link naming it is not drawn',
  drawnOnMapFor('room', [
    { id: 'building', parentId: null, floorPlanUrl: 'x.svg', floorPlanLinks: [{ shapeId: 'shape-1', roomId: 'some-other-room' }] },
    { id: 'room', parentId: 'building' },
  ]) === null);

check('a null/blank roomId (e.g. a Bulk Item with no single parentId) is not drawn anywhere, not a throw',
  drawnOnMapFor(null, [{ id: 'building', floorPlanUrl: 'x.svg', floorPlanLinks: [] }]) === null);

check('a parentage loop does not hang -- terminates rather than looping forever',
  drawnOnMapFor('a', [
    { id: 'a', parentId: 'b' },
    { id: 'b', parentId: 'a' },
  ]) === null);

// --- 9. in-map search: floorPlanShapeMatches / floorPlanTextMatches -----------
// This needs the real type registry (contentsOf calls isPlaceType, nameOf
// needs the person-name machinery even for non-person fixtures) -- the same
// stubbing shape test-frontend-tag.js already uses to run these functions
// for real rather than reimplementing what "matches" means a second time.
// Reuses registrySrc/iconStubs from section 1 above rather than re-slicing
// the same source text.
const searchDepthLine = src.match(/const MAX_PARENT_DEPTH = \d+;/);
if (!searchDepthLine) throw new Error('MAX_PARENT_DEPTH not found');

const matchMod = { exports: {} };
try {
  new Function('module', [
    iconStubs,
    'const TYPE_SETTINGS = {};',
    'let TYPE_FIELD_COLUMNS = [];',
    registrySrc,
    'let DERIVED_TYPE_SETS = { restrictedFields: new Set(), placeTypes: new Set() };',
    grabFn('recomputeDerivedTypeSets'),
    'recomputeDerivedTypeSets();',
    grabFn('typeEntryFor'),
    grabFn('typeNameOf'),
    grabFn('isPlaceType'),
    searchDepthLine[0],
    grabFn('parentOf'),
    grabFn('ancestorsOf'),
    grabFn('descendantsOf'),
    grabFn('contentsOf'),
    grabBlock('const PERSON_NAME_ORDERS = {', 'lastFirst" };'),
    'let PERSON_NAME_ORDER = PERSON_NAME_ORDERS.firstLast;',
    grabFn('isPersonType'),
    grabFn('splitPersonName'),
    grabFn('personNamePartsOf'),
    grabFn('composePersonName'),
    grabFn('nameOf'),
    grabFn('floorPlanTextMatches'),
    grabFn('floorPlanShapeMatches'),
    'module.exports = { floorPlanTextMatches, floorPlanShapeMatches, contentsOf };',
  ].join('\n'))(matchMod);
} catch (e) {
  console.error('Could not evaluate the search-match helpers:\n  ' + e.message);
  process.exit(1);
}
const { floorPlanShapeMatches } = matchMod.exports;

{
  const assets = [
    { id: 'room1', type: 'Room', name: 'Kitchen', parentId: null },
    { id: 'dev1', type: 'Computer', name: '', tag: 'BCA0001', parentId: 'room1', brand: 'Dell' },
    { id: 'bulk1', type: 'Bulk Item', name: '', tag: 'BCA0002', parentId: null, allocations: [{ roomId: 'room1', quantity: 5 }] },
  ];
  const room = assets[0];
  check('a room matches by its own name',
    floorPlanShapeMatches(room, assets, [], 'kitchen'));
  check('matching is case-insensitive',
    floorPlanShapeMatches(room, assets, [], 'KITCHEN'));
  check('a room matches when a DEVICE inside it matches (here, by brand)',
    floorPlanShapeMatches(room, assets, [], 'dell'));
  check('a room matches when a BULK ITEM allocated to it matches (here, by tag)',
    floorPlanShapeMatches(room, assets, [], 'BCA0002'));
  check('a room does not match text that names nothing in it',
    !floorPlanShapeMatches(room, assets, [], 'nonexistent'));
  check('an empty query never matches -- search is INACTIVE, not "matches everything"',
    !floorPlanShapeMatches(room, assets, [], ''));
  check('a null room (e.g. an unresolved link) never matches, and does not throw',
    !floorPlanShapeMatches(null, assets, [], 'kitchen'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
