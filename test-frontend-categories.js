// Unit test for type categories (TYPE_MANAGEMENT_PLAN.md, phase 3 / backend v33).
//
// Four rules here fail SILENTLY if they regress:
//
//   1. ensureShippedCategories() must TOP UP a stored list, never replace it. Get
//      that wrong and either a category added in a later release never appears
//      (no top-up), or every school's own categories and their order are wiped
//      on load by the shipped defaults.
//   2. A DANGLING categoryId must land in Uncategorized, not vanish. Deleting a
//      category deliberately does not rewrite the types that named it — that is
//      what lets deletion need no in-use block — so a type pointing at a deleted
//      category has to keep showing up somewhere.
//   3. groupTypesByCategory() must return groups in the STORED list's order, not
//      the shipped one. Ordering by hand is most of what this config key was
//      bought for; fall back to shipped order and the feature quietly isn't
//      there.
//   4. ...and it must KEEP empty categories, which is the other half. A derived
//      category list could never hold one, and being able to create the scheme
//      before filing types into it is the reason this is a record.
//
// Run: node test-frontend-categories.js   (exits non-zero on failure)
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
  grabBlock('const DEFAULT_TYPE_CATEGORIES = [', '\n];'),
  grabBlock('const UNCATEGORIZED_LABEL = ', ';'),
  grabFn('categoryIdOf'),
  grabFn('ensureShippedCategories'),
  grabFn('groupTypesByCategory'),
  'function fileType(id, categoryId) { TYPE_SETTINGS[id] = { categoryId }; }',
  'module.exports = { DEFAULT_TYPE_CATEGORIES, UNCATEGORIZED_LABEL, categoryIdOf, ensureShippedCategories, groupTypesByCategory, fileType };',
].join('\n');

const mod = { exports: {} };
try {
  new Function('module', code)(mod);
} catch (e) {
  console.error('Could not evaluate the extracted helpers:\n  ' + e.message);
  process.exit(1);
}
const { DEFAULT_TYPE_CATEGORIES, UNCATEGORIZED_LABEL, categoryIdOf, ensureShippedCategories, groupTypesByCategory, fileType } = mod.exports;

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};
const names = list => list.map(c => c.name);
const groupNames = gs => gs.map(g => g.name);

// --- 1. the shipped registry files every type it should ---------------------
check('a built-in category id is its own NAME',
  DEFAULT_TYPE_CATEGORIES.every(c => c.id === c.name),
  'that is what makes the registry need no seeding step and no migration');
check('Computer ships under Equipment', categoryIdOf('Computer') === 'Equipment');
check('Room ships under Places', categoryIdOf('Room') === 'Places');
check('User ships under People', categoryIdOf('User') === 'People');
check('Electrical Panel ships under Facilities', categoryIdOf('Electrical Panel') === 'Facilities');
check('"Other" ships with NO category',
  categoryIdOf('Other') === '',
  'the catch-all belongs in Uncategorized, and it keeps that bucket exercised');
check('an unregistered type has none either', categoryIdOf('some-uuid') === '');

// --- 2. topping up a stored list --------------------------------------------
{
  const stored = [
    { id: 'Facilities', name: 'Facilities' },
    { id: 'Equipment', name: 'Equipment' },
    { id: 'Places', name: 'Places' },
  ];
  const out = ensureShippedCategories(stored);
  check('a missing shipped category is added', names(out).includes('People'));
  check('...and the stored ORDER is preserved',
    names(out).slice(0, 3).join(',') === 'Facilities,Equipment,Places',
    `got ${JSON.stringify(names(out))}`);
  check('nothing is duplicated', new Set(out.map(c => c.id)).size === out.length);

  const renamed = ensureShippedCategories([{ id: 'Equipment', name: 'Kit' }]);
  check('a RENAMED shipped category keeps its new name',
    renamed.find(c => c.id === 'Equipment').name === 'Kit',
    'matching on id, not name, is the whole point of the id');
  check('...and the others are still added', renamed.length === DEFAULT_TYPE_CATEGORIES.length);

  const custom = ensureShippedCategories([{ id: 'abc-123', name: 'Networking' }]);
  check("a school's own category survives the top-up",
    names(custom).includes('Networking'));
  check('an empty stored list becomes the shipped set',
    ensureShippedCategories([]).length === DEFAULT_TYPE_CATEGORIES.length);
}

// --- 3 & 4. grouping ---------------------------------------------------------
const CATS = [
  { id: 'Facilities', name: 'Facilities' },
  { id: 'Equipment', name: 'Equipment' },
  { id: 'Empty', name: 'Nothing here yet' },
];
const TYPES = [
  { id: 'Computer', name: 'Computer' },
  { id: 'Condenser', name: 'Condenser' },
  { id: 'Other', name: 'Other' },
];
{
  const gs = groupTypesByCategory(TYPES, CATS);
  check('groups follow the CATEGORY list order, not the shipped order',
    groupNames(gs).slice(0, 3).join(',') === 'Facilities,Equipment,Nothing here yet',
    `got ${JSON.stringify(groupNames(gs))}`);
  check('an EMPTY category is kept',
    gs.find(g => g.name === 'Nothing here yet').types.length === 0,
    'creating the scheme before filing types into it is why this is a record');
  check('a type with no category lands in Uncategorized',
    gs[gs.length - 1].name === UNCATEGORIZED_LABEL
      && gs[gs.length - 1].types.map(t => t.id).join() === 'Other');
  check('...which is LAST, never first', groupNames(gs).indexOf(UNCATEGORIZED_LABEL) === gs.length - 1);
  check('every type appears exactly once',
    gs.flatMap(g => g.types).length === TYPES.length);
}
{
  // Deleting a category leaves the types that named it pointing nowhere.
  const gs = groupTypesByCategory(TYPES, [{ id: 'Equipment', name: 'Equipment' }]);
  const loose = gs[gs.length - 1];
  check('a DANGLING categoryId lands in Uncategorized rather than vanishing',
    loose.name === UNCATEGORIZED_LABEL && loose.types.some(t => t.id === 'Condenser'),
    'Condenser points at Facilities, which this list does not have');
  check('...so nothing is lost when a category is deleted',
    gs.flatMap(g => g.types).length === TYPES.length,
    'this is what lets category deletion need no in-use block');
}
{
  const gs = groupTypesByCategory([{ id: 'Computer', name: 'Computer' }], CATS);
  check('Uncategorized is absent when nothing is loose',
    !groupNames(gs).includes(UNCATEGORIZED_LABEL),
    'it is not a category; an always-on empty heading would be noise');
}
{
  // A user override re-files a type, over the shipped registry.
  fileType('Computer', 'Facilities');
  check('a typeSettings override re-files a type',
    categoryIdOf('Computer') === 'Facilities');
  const gs = groupTypesByCategory([{ id: 'Computer', name: 'Computer' }], CATS);
  check('...and the grouping follows it',
    gs.find(g => g.name === 'Facilities').types.length === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
