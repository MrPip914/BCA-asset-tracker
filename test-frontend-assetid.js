// Unit test for the asset-key helpers in index.html, after phase 2 of
// ASSET_KEY_REFACTOR_PLAN.md made `id` the identity and left `label` as display
// text.
//
// Why it exists: every one of these helpers used to compare `.label`, and the
// conversion was ~200 sites. A miss does not throw — it silently returns an
// empty chain, an empty Contents tab, or a cycle check that never fires. That is
// the same shape of failure as the personIds bug, which Sandbox could not
// reproduce because the FIXTURE was the wrong shape.
//
// So this runs the real functions, sliced out of index.html as source text, over
// the real MOCK_SNAPSHOT — which deliberately mixes assets that have a distinct
// `id` with assets that have none. A helper still keyed on `.label` passes for
// the legacy rows and fails for the others, which is exactly what we want caught.
//
// Run: node test-frontend-assetid.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// --- slice the pieces we need, so nothing is duplicated here ----------------
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
function grabConst(decl) {
  const i = src.indexOf(decl);
  if (i === -1) throw new Error(`${decl} not found`);
  const j = src.indexOf('\n};', i);
  return src.slice(i, j + 3);
}

const fixtureSrc = grabConst('const MOCK_SNAPSHOT = {');
const depthLine = src.match(/const MAX_PARENT_DEPTH = \d+;/);
if (!depthLine) throw new Error('MAX_PARENT_DEPTH not found');

const code = [
  // The fixture names FRONTEND_SCRIPT_VERSION; stub it rather than slice the
  // constant in, so this test never has an opinion about the backend contract.
  'const FRONTEND_SCRIPT_VERSION = "(test)";',
  // Same reasoning: the fixture references the seeded catalog, which this test
  // has no opinion about.
  'const SEEDED_BREAKER_TYPES = [];',
  depthLine[0],
  // `relate` is real, not stubbed: the fixture's audit rows go through it, and
  // it is one of the things phase 2 now feeds ids rather than labels.
  grabFn('relate'),
  grabFn('parentOf'),
  grabFn('ancestorsOf'),
  grabFn('descendantsOf'),
  grabFn('wouldCreateCycle'),
  fixtureSrc,
  'module.exports = { ancestorsOf, descendantsOf, wouldCreateCycle, MOCK_SNAPSHOT };',
].join('\n');

const mod = { exports: {} };
new Function('module', code)(mod);
const { ancestorsOf, descendantsOf, wouldCreateCycle, MOCK_SNAPSHOT } = mod.exports;

// --- the adoption loadData() performs, replicated in one line --------------
// (Deliberately the same expression, so a change to the rule shows up here.)
const assets = MOCK_SNAPSHOT.assets.map(a => (a.id ? a : { ...a, id: a.label }));

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};
const byLabel = l => assets.find(a => a.label === l);

// --- the fixture really is mixed -------------------------------------------
const distinct = assets.filter(a => a.id !== a.label);
check('fixture has assets whose id differs from their label', distinct.length >= 3,
      `found ${distinct.length}`);
check('fixture still has legacy-shaped assets (id adopted from label)',
      assets.some(a => a.id === a.label));

// --- the chain resolves THROUGH an asset with a distinct id ----------------
// BCA0001 (legacy id) sits in BCR0006 (distinct id) inside BCB0001 (legacy).
// Keyed on the label anywhere in that walk, it breaks at the middle link.
{
  const computer = byLabel('BCA0001');
  const chain = ancestorsOf(computer, assets).map(a => a.label);
  check('ancestorsOf walks through an asset whose id is not its label',
        chain.includes('BCR0006') && chain.includes('BCB0001'),
        `BCA0001 chain = ${JSON.stringify(chain)}`);
}

// --- and the other direction ------------------------------------------------
{
  const room = byLabel('BCR0006');
  const inside = descendantsOf(room, assets).map(a => a.label);
  check('descendantsOf finds children of an asset whose id is not its label',
        inside.includes('BCA0001'),
        `BCR0006 contents = ${JSON.stringify(inside)}`);
}

// --- a panel with a distinct id is still placed ----------------------------
{
  const panel = byLabel('BCA0084');
  check('a sub-panel with a distinct id resolves its own chain',
        ancestorsOf(panel, assets).length > 0,
        `BCA0084 chain = ${JSON.stringify(ancestorsOf(panel, assets).map(a => a.label))}`);
}

// --- cycle detection still fires on keys, not labels -----------------------
{
  const room = byLabel('BCR0006');
  const building = byLabel('BCB0001');
  check('wouldCreateCycle catches putting a building inside its own room',
        wouldCreateCycle(building.id, room.id, assets) === true);
  check('wouldCreateCycle allows a legitimate move',
        wouldCreateCycle(byLabel('BCA0001').id, byLabel('BCR0008').id, assets) === false);
}

// --- every stored reference resolves ---------------------------------------
// The real regression test: after rekeying the fixture, nothing may dangle.
{
  const ids = new Set(assets.map(a => a.id));
  const dangling = [];
  assets.forEach(a => {
    if (a.parentId && !ids.has(a.parentId)) dangling.push(`${a.label}.parentId -> ${a.parentId}`);
    (a.personIds || []).forEach(pid => { if (!ids.has(pid)) dangling.push(`${a.label}.personIds -> ${pid}`); });
    (a.allocations || []).forEach(al => { if (al.roomId && !ids.has(al.roomId)) dangling.push(`${a.label}.allocations -> ${al.roomId}`); });
    (a.breakers || []).forEach(b => {
      if (b.panelLabel && b.panelLabel !== a.id) dangling.push(`${a.label} breaker ${b.id}.panelLabel -> ${b.panelLabel}`);
      (b.circuits || []).forEach(c => {
        (c.roomsServedIds || []).forEach(r => { if (!ids.has(r)) dangling.push(`circuit ${c.id}.roomsServedIds -> ${r}`); });
        if (c.feedsPanelLabel && !ids.has(c.feedsPanelLabel)) dangling.push(`circuit ${c.id}.feedsPanelLabel -> ${c.feedsPanelLabel}`);
      });
    });
  });
  // feedsPanelLabel entries naming a panel that isn't in the fixture are
  // deliberate ("reserved but not yet installed"), so those are filtered out by
  // the known list rather than failing.
  const RESERVED = ['BCA0100', 'BCA0101', 'BCA0102', 'BCA0085'];
  const real = dangling.filter(d => !RESERVED.some(r => d.endsWith(r)));
  check('no reference in the fixture dangles after rekeying', real.length === 0,
        real.slice(0, 8).join('\n        '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
