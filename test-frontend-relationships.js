// Tests for the Relationships tab's query runner (RELATIONSHIP QUERIES in
// index.html): the real runner, step walker, field-option filter and stored-
// query cleaner, run against a small fixture inventory. The builder and the tab
// are React and are driven in Chromium against Sandbox, not here.
//
// Run: node test-frontend-relationships.js   (exits non-zero on failure)
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
  return src.slice(i, j);
}

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};

const mod = { exports: {} };
new Function('module', [
  'let TYPE_SETTINGS = {};',
  'const TYPE_REGISTRY = {};',
  'const MAX_PARENT_DEPTH = 50;',
  // Stand-ins for the type rules: which types are places, and which fields a
  // type carries. The runner only ever asks these two questions.
  'const PLACES = new Set(["Room", "Building"]);',
  'function isPlaceType(t) { return PLACES.has(t); }',
  'const FIELDS = { Thermostat: ["controls"], Sensor: ["monitors"] };',
  'function fieldAppliesTo(key, t) { return (FIELDS[t] || []).includes(key); }',
  'function nameOf(a) { return a.name || a.label || a.id; }',
  grabFn('typeEntryFor'),
  grabBlock('const COLUMN_DATA_TYPES = [', '// What a kind is CALLED'),
  'const DEFAULT_COLUMN_DATA_TYPES = {};',
  grabFn('columnDataType'),
  grabFn('personLabelsOf'),
  grabFn('parentOf'),
  grabFn('ancestorsOf'),
  grabBlock('// ---------- RELATIONSHIP QUERIES ----------', "// The Rooms/Devices/Bulk-Items listing"),
  grabFn('availableTabsFor').replace(/\.\.\.\(typeHasFloorPlan[^\n]*\n/, '').replace(/\.\.\.modulesFor\(type\),/, ''),
  'module.exports = { runRelationshipQuery, relationshipQueriesFor, relationshipQueriesShownFor, relationshipFieldOptions, relationshipStepSourceTypes, referenceTargetTypes, availableTabsFor, setTypeSettings: s => { TYPE_SETTINGS = s; } };',
].join('\n'))(mod);
const R = mod.exports;

const columns = [
  { key: 'name', label: 'Name' },
  { key: 'controls', label: 'Controls', custom: true, dataType: 'reference', referenceType: 'Mini Split' },
  { key: 'monitors', label: 'Monitors', custom: true, dataType: 'reference', referenceTypes: ['Mini Split', 'Condenser'] },
  { key: 'condition', label: 'Condition', custom: true, dataType: 'select' },
];
const A = (id, type, parentId, extra) => ({ id, label: id, name: id, type, parentId: parentId || '', status: 'Active', ...(extra || {}) });
const assets = [
  A('B1', 'Building'),
  A('R1', 'Room', 'B1'),
  A('R2', 'Room', 'R1'),             // a closet inside R1
  A('MS1', 'Mini Split', 'R1'),
  A('MS2', 'Mini Split', 'R2'),
  A('MS3', 'Mini Split', 'R1', { status: 'Archived' }),
  A('T1', 'Thermostat', 'R1', { controls: 'MS1' }),
  A('T2', 'Thermostat', 'R2', { controls: 'MS2' }),
  A('T3', 'Thermostat', 'R1', { controls: 'MS1' }),
  A('S1', 'Sensor', 'R1', { monitors: 'MS1' }),
  A('PC', 'Computer', 'R1', { personIds: ['U1'] }),
  A('U1', 'User'),
  // a loop: X1 inside X2 inside X1
  A('X1', 'Room', 'X2'),
  A('X2', 'Room', 'X1'),
];
const ids = nodes => nodes.map(n => n.asset.id);
const run = (assetId, steps, opts) => R.runRelationshipQuery(assets.find(a => a.id === assetId), { id: 'q', name: 'q', steps, ...(opts || {}) }, assets, columns);
const S = (follow, extra) => ({ follow, typeIds: [], fieldKey: '', show: true, ...(extra || {}) });

// --- single steps ------------------------------------------------------------
check('children lists only what is directly inside', JSON.stringify(ids(run('R1', [S('children')]).nodes).sort()) === JSON.stringify(['MS1', 'PC', 'R2', 'S1', 'T1', 'T3']));
check('archived assets are left out by default', !ids(run('R1', [S('children')]).nodes).includes('MS3'));
check('Include archived brings them back', ids(run('R1', [S('children')], { includeArchived: true }).nodes).includes('MS3'));

const desc = run('B1', [S('descendants')]);
check('descendants nest by containment (B1 > R1 > R2 > MS2)',
  ids(desc.nodes).join() === 'R1'
  && desc.nodes[0].children.some(n => n.asset.id === 'R2' && n.children.some(m => m.asset.id === 'MS2')));
check('descendants count every shown asset once', desc.count === 9, `got ${desc.count}`);

check('type filter narrows a step', JSON.stringify(ids(run('B1', [S('descendants', { typeIds: ['Mini Split'] })]).nodes)) === JSON.stringify(['MS1', 'MS2']));
check('parent is what it sits in', ids(run('MS2', [S('parent')]).nodes).join() === 'R2');
check('nearest finds the first ancestor of the chosen type', ids(run('MS2', [S('nearest', { typeIds: ['Building'] })]).nodes).join() === 'B1');
check('nearest with a type the chain lacks finds nothing', run('MS2', [S('nearest', { typeIds: ['Campus'] })]).count === 0);
check('forward reference follows the field', ids(run('T2', [S('refOut', { fieldKey: 'controls' })]).nodes).join() === 'MS2');
check('reverse reference finds everything pointing at it', JSON.stringify(ids(run('MS1', [S('refIn', { fieldKey: 'controls' })]).nodes)) === JSON.stringify(['T1', 'T3']));
check('users and what a person uses go both ways',
  ids(run('PC', [S('users')]).nodes).join() === 'U1' && ids(run('U1', [S('usedBy')]).nodes).join() === 'PC');

// --- chains ------------------------------------------------------------------
const hvac = run('R1', [S('descendants', { typeIds: ['Mini Split'] }), S('refIn', { fieldKey: 'controls' })]);
check('the HVAC query: units inside, then what controls each',
  JSON.stringify(hvac.nodes.map(n => [n.asset.id, ids(n.children)])) === JSON.stringify([['MS1', ['T1', 'T3']], ['MS2', ['T2']]]),
  JSON.stringify(hvac.nodes.map(n => [n.asset.id, ids(n.children)])));
const lifted = run('R1', [S('descendants', { typeIds: ['Mini Split'], show: false }), S('refIn', { fieldKey: 'controls' })]);
check('a hidden step lifts the next step\'s results up a level',
  JSON.stringify(ids(lifted.nodes)) === JSON.stringify(['T1', 'T3', 'T2']) && lifted.count === 3, JSON.stringify(ids(lifted.nodes)));
const twice = run('R1', [S('children', { typeIds: ['Thermostat'] }), S('refOut', { fieldKey: 'controls' })]);
check('an asset reached twice is shown once, under the first',
  twice.nodes.filter(n => n.children.some(c => c.asset.id === 'MS1')).length === 1, JSON.stringify(twice.nodes.map(n => [n.asset.id, ids(n.children)])));
check('the asset the query runs on is never its own result', !ids(run('MS1', [S('refIn', { fieldKey: 'controls' }), S('refOut', { fieldKey: 'controls' })]).nodes[0].children).includes('MS1'));
check('a parent loop terminates', run('X1', [S('descendants')]).count === 1 && run('X1', [S('nearest', { typeIds: ['Room'] })]).count === 1);

// --- the builder's field filter -------------------------------------------------
const opts = (follow, src) => R.relationshipFieldOptions(follow, src, columns, ['Thermostat', 'Sensor', 'Mini Split']).map(c => c.key);
check('forward: only fields the source type carries', JSON.stringify(opts('refOut', ['Thermostat'])) === JSON.stringify(['controls']));
check('forward from "any type": every field some type carries', JSON.stringify(opts('refOut', null)) === JSON.stringify(['controls', 'monitors']));
check('reverse: only fields that can point at the source type', JSON.stringify(opts('refIn', ['Condenser'])) === JSON.stringify(['monitors']));
check('a non-reference column is never offered', !opts('refIn', null).includes('condition'));
check('referenceTypes (several targets) is read as well as referenceType',
  JSON.stringify(R.referenceTargetTypes(columns[2])) === JSON.stringify(['Mini Split', 'Condenser']) && JSON.stringify(R.referenceTargetTypes(columns[1])) === JSON.stringify(['Mini Split']));
check('step 2 starts from step 1\'s type filter',
  JSON.stringify(R.relationshipStepSourceTypes('Room', [S('children', { typeIds: ['Mini Split'] })], 1, columns)) === JSON.stringify(['Mini Split']));
check('step 2 after a forward field starts from that field\'s targets',
  JSON.stringify(R.relationshipStepSourceTypes('Thermostat', [S('refOut', { fieldKey: 'controls' })], 1, columns)) === JSON.stringify(['Mini Split']));

// --- stored queries and the tab ----------------------------------------------------
R.setTypeSettings({
  Computer: { relationshipQueries: [
    { id: 'a', name: '  Users ', steps: [{ follow: 'users' }] },
    { id: 'b', name: 'Bad', steps: [{ follow: 'teleport' }] },
    { id: 'c', name: 'No field', steps: [{ follow: 'refIn', fieldKey: '' }] },
    { id: 'd', name: 'Long', steps: [S('parent'), S('parent'), S('parent'), S('parent')] },
  ] },
});
const qs = R.relationshipQueriesFor('Computer');
check('stored queries are cleaned: unknown follows and fieldless field steps dropped',
  JSON.stringify(qs.map(q => q.id)) === JSON.stringify(['a', 'd']), JSON.stringify(qs.map(q => q.id)));
check('names are trimmed and steps default to shown', qs[0].name === 'Users' && qs[0].steps[0].show === true);
check('at most three steps run', qs[1].steps.length === 3);
check('a place gets the built-in Contents query first', R.relationshipQueriesShownFor('Room')[0].builtIn === true);
check('the Relationships tab appears for a type with queries', R.availableTabsFor('Computer').includes('relationships'));
check('…and for a place, through Contents', R.availableTabsFor('Room').includes('relationships'));
check('…and not for a type with neither', !R.availableTabsFor('Monitor').includes('relationships'));

// --- wiring (read as source) ----------------------------------------------------------
const saveSrc = grabFn('saveTypeSettings');
check('the type editor\'s save CARRIES the stored queries (it rebuilds the whole settings object)',
  /relationshipQueries:\s*draft\.relationshipQueries\s*\|\|\s*\(typeSettings\[id\]\s*\|\|\s*\{\}\)\.relationshipQueries/.test(saveSrc));
check('reset keeps a type\'s queries', /keptQueries/.test(grabFn('resetTypeSettings')));
check('the tab\'s own save merges into the stored override',
  /\.\.\.\(typeSettings\[id\] \|\| \{\}\), relationshipQueries: queries/.test(grabFn('saveRelationshipQueries')));
const mockStart = src.indexOf('const MOCK_SNAPSHOT = {');
const mock = src.slice(mockStart, src.indexOf('\n};', mockStart));
check('the Sandbox fixture carries a reverse-field query and the field it follows',
  /follow: "refIn"[^}]*fieldKey: "controls"/.test(mock) && /key: "controls"[^}]*dataType: "reference"/.test(mock) && /controls: "BCA0086"/.test(mock));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
