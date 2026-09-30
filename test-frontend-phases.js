// Three-phase panels (backend v43).
//
// Runs the REAL phase helpers sliced out of index.html -- slotPhase,
// breakerPhases, breakerPhaseConflict, breakerVoltage and the electrical
// summary -- plus the real placement math (resolveRelativeCells) against the
// real seeded catalog, and source checks on the wiring that only runs inside
// the component: addBreaker refusing a pole set that shares a phase, the
// config form saving phase/voltage, the backend carrying both columns, and
// panel.html deriving phases the same way.
//
// Run: node test-frontend-phases.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const gs = fs.readFileSync(path.join(__dirname, 'AssetTrackerSync.gs'), 'utf8');
const panelHtml = fs.readFileSync(path.join(__dirname, 'panel.html'), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};

const NL = src.includes('\r\n') ? '\r\n' : '\n';
function sliceTopLevel(decl) {
  const start = src.indexOf(decl);
  if (start === -1) throw new Error(decl + ' not found in index.html');
  const end = src.indexOf(NL + '}' + NL, start);
  if (end === -1) throw new Error('end of ' + decl + ' not found');
  return src.slice(start, end + NL.length + 1);
}
function sliceConst(decl) {
  const start = src.indexOf(decl);
  if (start === -1) throw new Error(decl + ' not found in index.html');
  const end = src.indexOf(NL + '];' + NL, start);
  const endObj = src.indexOf(NL + '};' + NL, start);
  const stop = [end, endObj].filter(i => i !== -1).sort((a, b) => a - b)[0];
  return src.slice(start, stop + NL.length + 2);
}
const code = [
  sliceTopLevel('function slotsFromCells(cells) {'),
  sliceTopLevel('function resolveRelativeCells(relativeCells, startSlot) {'),
  sliceConst('const PANEL_VOLTAGE_OPTIONS = {'),
  sliceTopLevel('function panelIsThreePhase(panel) {'),
  sliceTopLevel('function slotPhase(slot, threePhase) {'),
  sliceTopLevel('function breakerPhases(cells, threePhase) {'),
  sliceTopLevel('function breakerPhaseConflict(cells, threePhase) {'),
  sliceTopLevel('function breakerVoltage(panelVoltage, poles) {'),
  sliceTopLevel('function breakerElectricalSummary(cells, panel) {'),
  sliceConst('const SEEDED_BREAKER_TYPES = ['),
].join('\n');
const H = new Function(code + '\nreturn { resolveRelativeCells, PANEL_VOLTAGE_OPTIONS, panelIsThreePhase, slotPhase, breakerPhases, breakerPhaseConflict, breakerVoltage, breakerElectricalSummary, SEEDED_BREAKER_TYPES };')();

// --- which phase a slot is on --------------------------------------------------
const row = (three, n) => Array.from({ length: n }, (_, i) => H.slotPhase(i + 1, three)).join('');
check('single-phase: 1+2 share a row and a phase, alternating A/B by row',
  row(false, 8) === 'AABBAABB', row(false, 8));
check('three-phase: cycles A/B/C by row',
  row(true, 12) === 'AABBCCAABBCC', row(true, 12));
check('a non-slot reads as no phase rather than throwing',
  H.slotPhase('', true) === '' && H.slotPhase(0, false) === '');

check('blank panelPhases reads as single-phase (every pre-v43 panel)',
  H.panelIsThreePhase({}) === false && H.panelIsThreePhase({ panelPhases: '' }) === false);
check('"3" is three-phase, a stored number too',
  H.panelIsThreePhase({ panelPhases: '3' }) && H.panelIsThreePhase({ panelPhases: 3 }));
check('"1" is single-phase', H.panelIsThreePhase({ panelPhases: '1' }) === false);

// --- the rule placement enforces ----------------------------------------------
const triple = H.SEEDED_BREAKER_TYPES.find(t => t.id === 'type-triple-pole');
check('a Triple-Pole type ships in the seeded catalog, spanning three slots',
  !!triple && triple.slotSpan === 3 && triple.members.length === 1);
const placeAt = (type, start) => type.members.map(m => H.resolveRelativeCells(m.cells, start));
const tripleAt1 = placeAt(triple, 1)[0];
check('placed at slot 1 the triple-pole lands on 1/3/5',
  JSON.stringify([...new Set(tripleAt1.map(c => c.slice(0, -1)))]) === '["1","3","5"]');
check('...which is A-B-C on a three-phase panel, no conflict',
  H.breakerPhases(tripleAt1, true).join('') === 'ABC' && H.breakerPhaseConflict(tripleAt1, true) === '');
check('...and A-B-A on a single-phase panel, conflicting on A',
  H.breakerPhaseConflict(tripleAt1, false) === 'A');
check('a triple-pole placed at ANY start slot on a three-phase panel is valid',
  [1, 2, 3, 4, 7, 12].every(s => H.breakerPhaseConflict(placeAt(triple, s)[0], true) === ''));

const dbl = H.SEEDED_BREAKER_TYPES.find(t => t.id === 'type-double-pole');
check('a double-pole is valid on both panel kinds at every start slot',
  [1, 2, 5, 10].every(s => H.breakerPhaseConflict(placeAt(dbl, s)[0], false) === '' && H.breakerPhaseConflict(placeAt(dbl, s)[0], true) === ''));
const split = H.SEEDED_BREAKER_TYPES.find(t => t.id === 'type-split-double');
check('the split double-pole is checked PER MEMBER: its 2-pole middle breaker spans two phases',
  placeAt(split, 1).every(cells => H.breakerPhaseConflict(cells, false) === ''));
const quad = H.SEEDED_BREAKER_TYPES.find(t => t.id === 'type-quad');
check('a quad passes -- its members are single-pole, so sharing a slot is not a conflict',
  placeAt(quad, 1).every(cells => H.breakerPhaseConflict(cells, true) === ''));
check('a 4-pole run on a three-phase panel wraps back to A and conflicts',
  H.breakerPhaseConflict(['1a', '1b', '3a', '3b', '5a', '5b', '7a', '7b'], true) === 'A');

// --- voltage and the summary -------------------------------------------------
check('120/208: one pole reads line-to-neutral, several read line-to-line',
  H.breakerVoltage('120/208', 1) === '120V' && H.breakerVoltage('120/208', 2) === '208V' && H.breakerVoltage('120/208', 3) === '208V');
check('a delta with no neutral reads the one voltage for every pole count',
  H.breakerVoltage('480', 1) === '480V' && H.breakerVoltage('480', 3) === '480V');
check('an unset voltage is blank, not a guess', H.breakerVoltage('', 2) === '');
check('summary of a 3-pole on a 120/208 panel',
  H.breakerElectricalSummary(tripleAt1, { panelPhases: '3', panelVoltage: '120/208' }) === '3P · A-B-C · 208V',
  H.breakerElectricalSummary(tripleAt1, { panelPhases: '3', panelVoltage: '120/208' }));
check('summary of a single-pole on a legacy panel says only its phase',
  H.breakerElectricalSummary(['3a', '3b'], {}) === 'B');
check('every voltage preset is listed under exactly one phase',
  H.PANEL_VOLTAGE_OPTIONS['1'].every(v => !H.PANEL_VOLTAGE_OPTIONS['3'].includes(v)));

// --- wiring (source checks) ------------------------------------------------------
const addBreakerSrc = src.slice(src.indexOf('  function addBreaker(draft) {'), src.indexOf('  function openBreakerModal('));
check('addBreaker checks every new breaker against the panel\'s phase BEFORE persisting',
  /for \(const b of newBreakers\) \{\s*const shared = breakerPhaseConflict\(b\.cells, threePhase\);\s*if \(!shared\) continue;/.test(addBreakerSrc)
  && addBreakerSrc.indexOf('breakerPhaseConflict') < addBreakerSrc.indexOf('persist('));
const updateSrc = src.slice(src.indexOf('  function updatePanelConfig('), src.indexOf('  function addBreaker(draft) {'));
check('updatePanelConfig writes panelPhases and panelVoltage',
  /const next = assets\.map\(a => \(a\.id === selectedId \? \{[^\n]*panelPhases: nextPhases, panelVoltage: voltage/.test(updateSrc));
check('the config form hands phase and voltage to its save',
  /onSave\(parseInt\(count, 10\) \|\| 0, lay, ph, volts\)/.test(src));
check('the diagram flags existing breakers whose poles share a phase',
  /const phaseWarnings = breakers/.test(src) && /phaseWarnings\.length > 0 &&/.test(src));

const assetFields = gs.slice(gs.indexOf('const ASSET_FIELDS = ['), gs.indexOf('];', gs.indexOf('const ASSET_FIELDS = [')));
check('backend ASSET_FIELDS carries panelPhases and panelVoltage (else a save drops them)',
  /"panelPhases"/.test(assetFields) && /"panelVoltage"/.test(assetFields));
const publicFields = gs.slice(gs.indexOf('const PUBLIC_PANEL_FIELDS = ['), gs.indexOf('];', gs.indexOf('const PUBLIC_PANEL_FIELDS = [')));
check('the public panel page is sent the phase and voltage',
  /"panelPhases"/.test(publicFields) && /"panelVoltage"/.test(publicFields));
const sv = /const SCRIPT_VERSION = "(v\d+)"/.exec(gs)[1];
const fv = /const FRONTEND_SCRIPT_VERSION = "(v\d+)"/.exec(src)[1];
check('SCRIPT_VERSION and FRONTEND_SCRIPT_VERSION match', sv === fv, `${sv} vs ${fv}`);

check('panel.html derives phase by row the same way (ceil(n/2), A-B / A-B-C)',
  /Math\.ceil\(n \/ 2\) - 1\) % letters\.length/.test(panelHtml) && /three \? "ABC" : "AB"/.test(panelHtml));

// --- circuit ID and hot wire colour (v44) ---------------------------------------------
{
  const circuitFields = gs.slice(gs.indexOf('const CIRCUIT_FIELDS = ['), gs.indexOf('];', gs.indexOf('const CIRCUIT_FIELDS = [')));
  check('backend CIRCUIT_FIELDS carries tag and wireColor (else a save drops them)',
    /"tag"/.test(circuitFields) && /"wireColor"/.test(circuitFields));
  check('doPost writes both, for breaker circuits AND unassigned ones',
    (gs.match(/notes: c\.notes \|\| "", tag: c\.tag \|\| "", wireColor: c\.wireColor \|\| ""/g) || []).length === 2);
  check('doGet reads both back, for breaker circuits AND unassigned ones',
    (gs.match(/tag: c\.tag \|\| "", wireColor: c\.wireColor \|\| "",\n\s*sharedNeutralWithIds:[^\n]*\n\s*\}\)\),/g) || []).length === 2);
  check('the shared-neutral links are written and read back as a list, for both kinds of circuit (v45)',
    /"sharedNeutralWith"/.test(circuitFields)
    && (gs.match(/sharedNeutralWith: \(c\.sharedNeutralWithIds \|\| \[\]\)\.join\(","\)/g) || []).length === 2
    && (gs.match(/sharedNeutralWithIds: c\.sharedNeutralWith \? String\(c\.sharedNeutralWith\)\.split\(","\)/g) || []).length === 2);
  const pub = gs.slice(gs.indexOf('const PUBLIC_CIRCUIT_FIELDS = ['), gs.indexOf('];', gs.indexOf('const PUBLIC_CIRCUIT_FIELDS = [')));
  check('the public panel page is sent them too', /"tag"/.test(pub) && /"wireColor"/.test(pub) && /tag: c\.tag, wireColor: c\.wireColor/.test(gs));
}

// --- fixture ---------------------------------------------------------------------
check('MOCK_SNAPSHOT carries a three-phase panel so Sandbox can exercise it',
  /panelPhases: "3"/.test(src.slice(src.indexOf('const MOCK_SNAPSHOT'))));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
