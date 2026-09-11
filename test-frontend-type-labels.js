// Unit test for type LABELS (the multi-label rework of v33's single category).
//
// A type carries any number of labels; every list of types is alphabetical and
// filtered by them rather than grouped under them. Five rules here fail SILENTLY
// if they regress:
//
//   1. typeLabelIdsOf() must read a STORED OVERRIDE AHEAD OF THE MERGE. v33
//      stored one `categoryId` string and the registry now ships a `categoryIds`
//      array, so typeEntryFor's spread carries BOTH keys — read the array first
//      and every school's own filing is silently replaced by the shipped one.
//   2. An explicitly EMPTY array must beat the shipped list. That is the state
//      the singular key could never express (undefined, JSON drops the key, the
//      shipped value returns on the next load), so "I cleared this type's
//      labels" has to survive a reload or it is not a setting.
//   3. ensureShippedLabels() must TOP UP a stored list, never replace it. Get
//      that wrong and either a label added in a later release never appears, or
//      every school's own labels and their order are wiped on load.
//   4. A DANGLING id must be dropped from the display names, not rendered raw.
//      Deleting a label deliberately does not rewrite the types that named it —
//      that is what lets deletion need no in-use block — so a chip would
//      otherwise print a bare uuid.
//   5. matchesLabelFilter() must be OR, must treat null as EXEMPT, and must
//      match an unlabeled option only against the "" chip. Exempt is what keeps
//      the "All types" row — the control that CLEARS the filter — from being
//      filtered off the screen.
//
// Run: node test-frontend-type-labels.js   (exits non-zero on failure)
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
  return src.slice(i, j + endsWith.length);
}

const registrySrc = grabBlock('const TYPE_REGISTRY = {', '\n};');
const iconStubs = [...new Set(
  [...registrySrc.matchAll(/\bicon:\s*([A-Z]\w*)/g)].map(m => m[1])
)].map(n => `const ${n} = null;`).join('\n');

const code = [
  iconStubs,
  'let TYPE_SETTINGS = {};',
  'let TYPE_FIELD_COLUMNS = [];',
  registrySrc,
  'let DERIVED_TYPE_SETS = { restrictedFields: new Set(), placeTypes: new Set() };',
  grabFn('recomputeDerivedTypeSets'),
  grabFn('typeEntryFor'),
  'recomputeDerivedTypeSets();',
  grabBlock('const DEFAULT_TYPE_LABELS = [', '\n];'),
  grabBlock('const UNLABELED_LABEL = ', ';'),
  grabFn('typeLabelIdsOf'),
  grabFn('typeLabelNamesOf'),
  grabFn('ensureShippedLabels'),
  grabFn('sortTypesByName'),
  grabFn('matchesLabelFilter'),
  'function setOverride(id, over) { TYPE_SETTINGS[id] = over; }',
  'module.exports = { DEFAULT_TYPE_LABELS, UNLABELED_LABEL, typeLabelIdsOf, typeLabelNamesOf, ensureShippedLabels, sortTypesByName, matchesLabelFilter, setOverride, TYPE_REGISTRY };',
].join('\n');

const mod = { exports: {} };
try {
  new Function('module', code)(mod);
} catch (e) {
  console.error('Could not evaluate the extracted helpers:\n  ' + e.message);
  process.exit(1);
}
const {
  DEFAULT_TYPE_LABELS, UNLABELED_LABEL, typeLabelIdsOf, typeLabelNamesOf,
  ensureShippedLabels, sortTypesByName, matchesLabelFilter, setOverride, TYPE_REGISTRY,
} = mod.exports;

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};
const names = list => list.map(c => c.name);

// --- 1. the shipped registry files every type it should ---------------------
check('a built-in label id is its own NAME',
  DEFAULT_TYPE_LABELS.every(c => c.id === c.name),
  'that is what makes the registry need no seeding step and no migration');
check('the registry ships ARRAYS, not a single id',
  Object.values(TYPE_REGISTRY).every(e => e.categoryId === undefined)
    && Object.values(TYPE_REGISTRY).some(e => Array.isArray(e.categoryIds)),
  'a leftover singular key here would be read only by the legacy fallback');
check('Computer ships under Equipment', typeLabelIdsOf('Computer').join() === 'Equipment');
check('Room ships under Places', typeLabelIdsOf('Room').join() === 'Places');
check('User ships under People', typeLabelIdsOf('User').join() === 'People');
check('Electrical Panel ships under Facilities', typeLabelIdsOf('Electrical Panel').join() === 'Facilities');
check('"Other" ships with NO labels',
  typeLabelIdsOf('Other').length === 0,
  'the catch-all is unlabeled, and it keeps that bucket exercised');
check('an unregistered type has none either', typeLabelIdsOf('some-uuid').length === 0);

// --- 2. reading a stored override -------------------------------------------
{
  setOverride('Computer', { categoryIds: ['Facilities', 'Equipment'] });
  check('a type can carry SEVERAL labels',
    typeLabelIdsOf('Computer').join() === 'Facilities,Equipment',
    'this is the whole change; one value per type is what it replaced');

  // The hazard: typeEntryFor spreads the override over the registry, so the
  // registry's `categoryIds` and the override's `categoryId` both survive.
  setOverride('Monitor', { categoryId: 'Places' });
  check('a v33 SINGULAR categoryId is read as a list of one',
    typeLabelIdsOf('Monitor').join() === 'Places',
    'a sheet written before this change still resolves, with no migration');
  check('...and it BEATS the array the registry ships',
    typeLabelIdsOf('Monitor').join() !== 'Equipment',
    'the override must be read ahead of the merged entry — both keys survive the spread');

  setOverride('Phone', { categoryIds: [] });
  check('an explicitly EMPTY list beats the shipped labels',
    typeLabelIdsOf('Phone').length === 0,
    'clearing a type\'s labels has to survive a reload, which the singular key could not do');

  setOverride('TV', { iconName: 'Monitor' });
  check('an override that mentions neither key falls back to the registry',
    typeLabelIdsOf('TV').join() === 'Equipment',
    'editing a type\'s icon must not drop its labels');
}

// --- 3. display names --------------------------------------------------------
{
  const LABELS = [{ id: 'Equipment', name: 'Kit' }, { id: 'Facilities', name: 'Facilities' }];
  setOverride('DocuCam', { categoryIds: ['Equipment', 'gone-uuid', 'Facilities'] });
  check('names come from the list, so a rename needs no cascade',
    typeLabelNamesOf('DocuCam', LABELS).join() === 'Kit,Facilities');
  check('a DANGLING id is dropped rather than printed raw',
    !typeLabelNamesOf('DocuCam', LABELS).includes('gone-uuid'),
    'deleting a label deliberately leaves the types that named it alone');
  check('no labels means no chips', typeLabelNamesOf('Other', LABELS).length === 0);
}

// --- 4. topping up a stored list --------------------------------------------
{
  const stored = [
    { id: 'Facilities', name: 'Facilities' },
    { id: 'Equipment', name: 'Equipment' },
    { id: 'Places', name: 'Places' },
  ];
  const out = ensureShippedLabels(stored);
  check('a missing shipped label is added', names(out).includes('People'));
  check('...and the stored ORDER is preserved',
    names(out).slice(0, 3).join(',') === 'Facilities,Equipment,Places',
    `got ${JSON.stringify(names(out))}`);
  check('nothing is duplicated', new Set(out.map(c => c.id)).size === out.length);

  const renamed = ensureShippedLabels([{ id: 'Equipment', name: 'Kit' }]);
  check('a RENAMED shipped label keeps its new name',
    renamed.find(c => c.id === 'Equipment').name === 'Kit',
    'matching on id, not name, is the whole point of the id');
  check('...and the others are still added', renamed.length === DEFAULT_TYPE_LABELS.length);

  const custom = ensureShippedLabels([{ id: 'abc-123', name: 'Networking' }]);
  check("a school's own label survives the top-up", names(custom).includes('Networking'));
  check('an empty stored list becomes the shipped set',
    ensureShippedLabels([]).length === DEFAULT_TYPE_LABELS.length);
}

// --- 5. ordering and filtering ----------------------------------------------
{
  const TYPES = [
    { id: 'c', name: 'TV' },
    { id: 'a', name: 'Computer' },
    { id: 'b', name: 'monitor' },
  ];
  const sorted = sortTypesByName(TYPES);
  check('types sort A→Z by the NAME people read',
    sorted.map(t => t.name).join(',') === 'Computer,monitor,TV',
    'localeCompare, so case does not sort lowercase names into their own block');
  check('...without mutating the caller\'s array',
    TYPES.map(t => t.id).join(',') === 'c,a,b');
}
{
  const none = [];
  check('no active labels shows everything',
    matchesLabelFilter(['Equipment'], none) && matchesLabelFilter([], none));
  check('OR, never AND: one of the option\'s labels matching is enough',
    matchesLabelFilter(['Equipment', 'Facilities'], ['Equipment'])
      && matchesLabelFilter(['Equipment'], ['Places', 'Equipment']),
    'a two-label type has to show under either of them, or carrying more labels makes a type harder to find');
  check('a type carrying neither is filtered out',
    !matchesLabelFilter(['People'], ['Places', 'Equipment']));
  check('an unlabeled option matches ONLY the Unlabeled chip',
    matchesLabelFilter([], ['']) && !matchesLabelFilter([], ['Equipment']));
  check('a labelled option does NOT match the Unlabeled chip',
    !matchesLabelFilter(['Equipment'], ['']));
  check('null is EXEMPT — it survives every filter',
    matchesLabelFilter(null, ['Equipment']) && matchesLabelFilter(null, ['']),
    'this is what keeps the "All types" row, which clears the filter, on screen');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
