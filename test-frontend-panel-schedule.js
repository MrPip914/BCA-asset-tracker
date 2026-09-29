// Panel schedule export/import: one panel's breakers and circuits as a sheet the
// same panel reads back (panelScheduleRows / planPanelImport).
//
// Every rule below fails SILENTLY if it regresses -- the import reports success
// and the damage is in the panel:
//   1. A round trip changes NOTHING: same ids, same groups, same circuits.
//      Lose the ids and every photo and "fed from" pointing at a breaker is
//      orphaned by an edit in Excel.
//   2. It is a REPLACE: a breaker the file leaves out is removed, and the plan
//      says how many.
//   3. The panel's phase rule applies: a 3-pole on a single-phase panel is
//      refused, as Add Breaker refuses it.
//   4. One bad row refuses the WHOLE file.
//   5. Tandems stay one unit (shared groupId) through the Unit column.
//
// Run: node test-frontend-panel-schedule.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};

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
function grabConst(decl, endsWith) {
  const i = src.indexOf(decl);
  if (i === -1) throw new Error(`${decl} not found`);
  const j = src.indexOf(endsWith, i);
  if (j === -1) throw new Error(`end of ${decl} not found`);
  return src.slice(i, j + endsWith.length);
}

// The registry names lucide icon components; stub whatever it names, derived
// from the source so adding an icon never breaks this.
const registrySrc = grabConst('const TYPE_REGISTRY = {', '\n};');
const iconStubs = [...new Set(
  [...registrySrc.matchAll(/\bicon:\s*([A-Z]\w*)/g)].map(m => m[1])
)].map(n => `const ${n} = null;`).join('\n');

// THE REAL HELPERS, not simplified copies. A stub here would let this test keep
// passing while the app's own field rules, naming and validation changed
// underneath it -- which is the failure mode the whole file exists to catch.
const code = [
  iconStubs,
  'const TYPE_SETTINGS = {};',
  'let TYPE_FIELD_COLUMNS = [];',
  registrySrc,
  'let DERIVED_TYPE_SETS = { restrictedFields: new Set(), placeTypes: new Set() };',
  grabFn('recomputeDerivedTypeSets'),
  'recomputeDerivedTypeSets();',
  grabFn('typeEntryFor'),
  grabFn('typeNameOf'),
  grabFn('typeTakesParent'),
  grabFn('parentTypesFor'),
  grabFn('canBeParentOf'),
  grabFn('isPlaceType'),
  grabFn('restrictedFields'),
  grabFn('fieldAppliesTo'),
  grabConst('const PERSON_NAME_ORDERS = {', 'lastFirst" };'),
  'let PERSON_NAME_ORDER = PERSON_NAME_ORDERS.firstLast;',
  grabFn('isPersonType'),
  grabFn('splitPersonName'),
  grabFn('personNamePartsOf'),
  grabFn('composePersonName'),
  grabFn('personMatchKey'),
  grabFn('nameOf'),
  grabFn('personLabelsOf'),
  grabFn('personNamesOf'),
  grabFn('personTextOf'),
  grabConst('const UNASSIGNED_LABEL', ';'),
  grabConst('const MAX_PARENT_DEPTH', ';'),
  grabFn('parentOf'),
  grabFn('ancestorsOf'),
  grabFn('nearestAncestorOfType'),
  grabFn('nearestPlaceNameOf'),
  grabConst('const FIXED_IN_PLACE_TYPES', ');'),
  grabFn('suggestedNameFor'),
  grabConst('const PATH_SEPARATOR', ';'),
  grabFn('pathOf'),
  grabFn('parentNameFor'),
  grabFn('wouldCreateCycle'),
  grabFn('validateParentChoice'),
  grabFn('relate'),
  grabFn('dateOnly'),
  grabFn('localDateString'),
  grabConst('const COLUMN_DATA_TYPES = [', '];'),
  grabConst('const COLUMN_DATA_TYPE_VALUES', ';'),
  grabConst('const DEFAULT_COLUMN_DATA_TYPES = {', '\n};'),
  grabFn('columnDataType'),
  grabFn('columnOptions'),
  grabFn('validateColumnValue'),
  grabConst('const DEFAULT_COLUMNS = [', 'custom: false }));'),
  // The feature under test.
  grabConst('const IMPORT_KEY_HEADER', ';'),
  grabConst('const IMPORT_HEADER_OVERRIDES', ';'),
  grabFn('fullPathOf'),
  grabFn('importHeadersFor'),
  grabFn('importCellFor'),
  grabFn('assetToImportRow'),
  grabFn('importCellText'),
  grabFn('importRowsFromGrid'),
  grabFn('addImportRef'),
  grabFn('buildImportRefIndex'),
  grabFn('indexImportRow'),
  grabFn('resolveImportRef'),
  grabFn('resolveImportType'),
  grabFn('buildImportPeopleIndex'),
  grabFn('splitImportList'),
  grabFn('splitImportPeople'),
  grabFn('describeImportAsset'),
  grabFn("planAssetImport"),
  grabFn("slotsFromCells"), grabFn("cellsLabel_"), grabFn("panelIsThreePhase"), grabFn("slotPhase"),
  grabFn("breakerPhases"), grabFn("breakerPhaseConflict"),
  grabConst("const PANEL_SCHEDULE_HEADERS = [", "];"), grabConst("const PANEL_BREAKER_COLS", ";"),
  grabConst("const PANEL_CIRCUIT_COLS", ";"), grabConst("const PANEL_SERVES_SEPARATOR", "\"; \";"),
  grabFn("panelRefText"), grabFn("cellsFromSlotText"), grabFn("panelScheduleRows"), grabFn("planPanelImport"),
  `module.exports = {
     PERSON_NAME_ORDERS, setNameOrder: v => { PERSON_NAME_ORDER = v; },
     planAssetImport, assetToImportRow, importHeadersFor, importRowsFromGrid,
     resolveImportRef, buildImportRefIndex, resolveImportType, importCellText,
     fullPathOf, nameOf, pathOf, DEFAULT_COLUMNS, IMPORT_KEY_HEADER, splitImportList,
     splitImportPeople, panelScheduleRows, planPanelImport, cellsFromSlotText, PANEL_SCHEDULE_HEADERS,
   };`,
].join('\n');

const mod = { exports: {} };
let uuidN = 0;
try {
  new Function('module', 'crypto', code)(mod, { randomUUID: () => 'new-' + (++uuidN) });
} catch (e) {
  console.error('Could not evaluate the extracted helpers:\n  ' + e.message);
  process.exit(1);
}
const { panelScheduleRows, planPanelImport, cellsFromSlotText, importRowsFromGrid, PANEL_SCHEDULE_HEADERS } = mod.exports;

// --- fixture -------------------------------------------------------------------
// Two rooms share a NAME in different buildings, so Serves must round-trip by
// full path; a sub-panel is the Feeds target; a tandem is a two-breaker unit.
const assets = [
  { id: 'B1', type: 'Building', name: 'Building 100', status: 'Active' },
  { id: 'B2', type: 'Building', name: 'Building 200', status: 'Active' },
  { id: 'R1', type: 'Room', name: 'Kitchen', parentId: 'B1', status: 'Active' },
  { id: 'R2', type: 'Room', name: 'Kitchen', parentId: 'B2', status: 'Active' },
  { id: 'SUB', type: 'Electrical Panel', tag: 'BCA0099', parentId: 'R2', status: 'Active' },
];
const breakerTypes = [
  { id: 'type-single-pole', name: 'Single-Pole' }, { id: 'type-tandem', name: 'Tandem' },
  { id: 'type-triple-pole', name: 'Triple-Pole (3-phase)' },
];
const panel = {
  id: 'P1', type: 'Electrical Panel', tag: 'BCA0098', parentId: 'R1', panelSlotCount: 12, panelPhases: '3',
  breakers: [
    { id: 'b1', panelLabel: 'P1', cells: ['1a', '1b', '3a', '3b', '5a', '5b'], ampRating: '40', serial: 'S1', installedDate: '2026-01-02', notes: '', groupId: 'g1', breakerTypeId: 'type-triple-pole', circuits: [
      { id: 'c1', breakerId: 'b1', panelLabel: 'P1', label: 'RTU', notes: '- roof', roomsServedIds: ['R1'], feedsPanelLabel: '' },
    ] },
    { id: 'b2a', panelLabel: 'P1', cells: ['2a'], ampRating: '20', serial: '', installedDate: '', notes: '', groupId: 'g2', breakerTypeId: 'type-tandem', circuits: [
      { id: 'c2', breakerId: 'b2a', panelLabel: 'P1', label: 'Lights', notes: '', roomsServedIds: ['R1', 'R2'], feedsPanelLabel: '' },
      { id: 'c3', breakerId: 'b2a', panelLabel: 'P1', label: 'Fan', notes: '', roomsServedIds: ['R2'], feedsPanelLabel: '' },
    ] },
    { id: 'b2b', panelLabel: 'P1', cells: ['2b'], ampRating: '15', serial: '', installedDate: '', notes: '', groupId: 'g2', breakerTypeId: 'type-tandem', circuits: [] },
    { id: 'b4', panelLabel: 'P1', cells: ['4a', '4b', '6a', '6b'], ampRating: '60', serial: '', installedDate: '', notes: 'feed', groupId: 'g4', breakerTypeId: '', circuits: [
      { id: 'c4', breakerId: 'b4', panelLabel: 'P1', label: 'Sub feed', notes: '', roomsServedIds: [], feedsPanelLabel: 'SUB' },
    ] },
  ],
  unassignedCircuits: [
    { id: 'c5', breakerId: '', panelLabel: 'P1', label: 'Pulled run', notes: '', roomsServedIds: ['R1'], feedsPanelLabel: '' },
  ],
};
const allAssets = [...assets, panel];
const ctx = { panel, assets: allAssets, breakerTypes };

// Rows → the grid a spreadsheet would hand back, then the planner.
const toGrid = rows => [PANEL_SCHEDULE_HEADERS, ...rows.map(r => PANEL_SCHEDULE_HEADERS.map(h => r[h] || ''))];
const planOf = (rows, c = ctx) => planPanelImport(importRowsFromGrid(toGrid(rows)), c);

// --- slot text -----------------------------------------------------------------
check('slot text: a whole slot is both halves', JSON.stringify(cellsFromSlotText('5')) === '["5a","5b"]');
check('slot text: a multi-pole run', JSON.stringify(cellsFromSlotText('1/3/5')) === '["1a","1b","3a","3b","5a","5b"]');
check('slot text: halves survive', JSON.stringify(cellsFromSlotText('9b/11a')) === '["9b","11a"]');
check('slot text: rubbish is refused', cellsFromSlotText('A1') === null && cellsFromSlotText('0') === null);

// --- export --------------------------------------------------------------------
const rows = panelScheduleRows(panel, { assets: allAssets, breakerTypes });
check('one row per circuit, a row for a circuitless breaker, unassigned last',
  rows.length === 6 && rows[rows.length - 1].Slot === '' && rows[rows.length - 1].Circuit === 'Pulled run',
  JSON.stringify(rows.map(r => [r.Slot, r.Circuit])));
check('a multi-pole breaker writes its slots the way the app labels them', rows[0].Slot === '1/3/5');
check('Serves is written as FULL paths, so two Kitchens stay apart',
  rows.find(r => r.Circuit === 'Lights').Serves === 'Building 100 › Kitchen; Building 200 › Kitchen');
check('Feeds Panel is written as the sub-panel\'s tag', rows.find(r => r.Circuit === 'Sub feed')['Feeds Panel'] === 'BCA0099');
check('a tandem\'s two breakers share one Unit number',
  rows.find(r => r.Slot === '2a').Unit === rows.find(r => r.Slot === '2b').Unit && rows.find(r => r.Slot === '2a').Unit !== rows[0].Unit);

// --- round trip ----------------------------------------------------------------
const same = planOf(rows);
check('an untouched export imports as UNCHANGED', same.errors.length === 0 && same.unchanged === true,
  JSON.stringify(same.errors.concat(same.warnings)));
check('...keeping every breaker id', JSON.stringify(same.breakers.map(b => b.id).sort()) === JSON.stringify(['b1', 'b2a', 'b2b', 'b4']));
check('...and the tandem\'s groupId', same.breakers.find(b => b.id === 'b2a').groupId === 'g2' && same.breakers.find(b => b.id === 'b2b').groupId === 'g2');
check('...and every circuit id, in its place', JSON.stringify(same.breakers.find(b => b.id === 'b2a').circuits.map(c => c.id)) === '["c2","c3"]'
  && same.unassignedCircuits.map(c => c.id).join() === 'c5');

// --- edits ---------------------------------------------------------------------
const edited = rows.map(r => (r.Circuit === 'RTU' ? { ...r, Amps: '50' } : r));
const e1 = planOf(edited);
check('an edited amp is a change, not unchanged', e1.errors.length === 0 && !e1.unchanged && e1.breakers.find(b => b.id === 'b1').ampRating === '50');

const dropped = rows.filter(r => r.Slot !== '4/6');
const e2 = planOf(dropped);
check('a breaker left OUT of the file is removed, and the plan counts it',
  e2.errors.length === 0 && !e2.breakers.some(b => b.id === 'b4') && e2.removed.breakers === 1 && e2.removed.circuits === 1,
  JSON.stringify(e2.removed));

const added = [...rows, { Slot: '7', 'Breaker Type': 'Single-Pole', Amps: '20', Circuit: 'New outlets', Serves: 'Building 200 › Kitchen' }];
const e3 = planOf(added);
const nb = e3.breakers.find(b => b.cells.join() === '7a,7b');
check('a keyless row is a NEW breaker with a new id and its own group',
  e3.errors.length === 0 && nb && /^new-/.test(nb.id) && nb.groupId && !['g1', 'g2', 'g4'].includes(nb.groupId)
  && nb.breakerTypeId === 'type-single-pole' && nb.circuits[0].roomsServedIds.join() === 'R2', JSON.stringify(e3.errors));

// --- refusals ------------------------------------------------------------------
const single = { ...panel, panelPhases: '1' };
const e4 = planOf(rows, { ...ctx, panel: single });
check('a 3-pole on a SINGLE-phase panel is refused, as Add Breaker refuses it',
  e4.errors.some(m => /phase A/.test(m)) && e4.breakers.length === 0);

const bad = [...rows, { Slot: '8', Circuit: 'Ghost', Serves: 'Nowhere' }];
const e5 = planOf(bad);
check('one bad row refuses the WHOLE file, carrying no layout', e5.errors.length > 0 && e5.breakers.length === 0 && e5.unassignedCircuits.length === 0);
check('a bare room name matching two rooms is ambiguous, not the first one',
  planOf([...rows, { Slot: '9', Circuit: 'X', Serves: 'Kitchen' }]).errors.some(m => /more than one room/.test(m)));
check('two breakers on one cell are refused',
  planOf([...rows, { Slot: '1a', Circuit: 'Clash', Serves: 'Building 100 › Kitchen' }]).errors.some(m => /both use slot/.test(m)));
check('a slot past the panel\'s count is refused',
  planOf([...rows, { Slot: '13', Circuit: 'Far', Serves: 'Building 100 › Kitchen' }]).errors.some(m => /beyond/.test(m)));
check('a split-column run (22/23) is refused',
  planOf([...rows, { Slot: '8/9', Circuit: 'Odd', Serves: 'Building 100 › Kitchen' }]).errors.some(m => /one column/.test(m)));
check('serves AND feeds is refused',
  planOf([...rows, { Slot: '10', Circuit: 'Both', Serves: 'Building 100 › Kitchen', 'Feeds Panel': 'BCA0099' }]).errors.some(m => /not both/.test(m)));
check('an Assets export chosen by mistake says so ONCE',
  (() => { const p = planPanelImport(importRowsFromGrid([['Asset Key', 'Name'], ['x', 'y']]), ctx); return p.errors.length === 1 && /isn't a panel schedule/.test(p.errors[0]); })());
check('an empty schedule is refused rather than emptying the panel',
  planPanelImport(importRowsFromGrid([PANEL_SCHEDULE_HEADERS]), ctx).errors.some(m => /no rows/.test(m)));
check('an unknown breaker type is a warning, not a refusal',
  (() => { const p = planOf([...rows, { Slot: '11', 'Breaker Type': 'Mystery', Circuit: 'M', Serves: 'Building 100 › Kitchen' }]); return p.errors.length === 0 && p.warnings.some(m => /catalog/.test(m)); })());

// --- the menu (source) ---------------------------------------------------------
const diagram = src.slice(src.indexOf('function PanelDiagram('), src.indexOf('function PanelDiagram(') + 40000);
check('the panel header carries ONE menu, and the four bare icons are gone',
  /aria-label="Panel actions"/.test(diagram) && !/aria-label="Reconfigure panel layout"/.test(diagram)
  && !/aria-label="Copy link to this panel"/.test(diagram) && !/aria-label="Print a QR sticker for this panel"/.test(diagram));
check('import is an editor-only row; export is not',
  /canEdit && onImportSchedule &&/.test(diagram) && /onExportSchedule && \{ key: "export"/.test(diagram));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
