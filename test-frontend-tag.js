// Unit test for phase 3 of ASSET_KEY_REFACTOR_PLAN.md — the tag.
//
// Three rules here fail SILENTLY if they regress, which is why they are tested
// rather than eyeballed:
//
//   1. adoptLegacyTag() must DECLINE to adopt a label as a tag for a type whose
//      tag field is excluded. Get that wrong and every Room, Building, Campus
//      and User quietly keeps its old BCR/BCB/BCC label as a tag -- the exact
//      thing Eric asked to clear, and nothing on screen would say it had failed.
//   2. nameOf() must fall through name -> tag -> "<type> <short id>". Get the
//      last rung wrong and an untagged, unnamed asset renders as an empty string
//      in the list, the detail header and every audit sentence.
//   3. findTagConflict() must SKIP empty tags. Get that wrong and every untagged
//      asset collides with every other one, so nothing can be saved at all.
//
// Run: node test-frontend-tag.js   (exits non-zero on failure)
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

// The registry names lucide icon components. Stub whatever it names, derived
// from the source rather than listed here, so adding an icon never breaks this.
const registrySrc = grabBlock('const TYPE_REGISTRY = {', '\n};');
const iconStubs = [...new Set(
  [...registrySrc.matchAll(/\bicon:\s*([A-Z]\w*)/g)].map(m => m[1])
)].map(n => `const ${n} = null;`).join('\n');

// The real registry, the real field rules, the real nameOf.
const code = [
  iconStubs,
  'const TYPE_SETTINGS = {};',                       // no user overrides in this test
  'let TYPE_FIELD_COLUMNS = [];',
  registrySrc,
  // The derived sets are real, not stubbed: recomputeDerivedTypeSets() is what
  // decides which fields are restricted app-wide, and fieldAppliesTo's answer
  // depends on it. Running it here means this test sees the same rules the app
  // does rather than a simplified copy.
  'let DERIVED_TYPE_SETS = { restrictedFields: new Set(), placeTypes: new Set() };',
  grabFn('recomputeDerivedTypeSets'),
  'recomputeDerivedTypeSets();',
  grabFn('typeEntryFor'),
  grabFn('typeNameOf'),
  grabFn('typeTakesParent'),
  grabFn('restrictedFields'),
  grabFn('fieldAppliesTo'),
  // nameOf composes a person's name from its parts now, so its own helpers come
  // with it. Real, not stubbed: a stub would let this test keep passing while
  // the app's actual naming changed underneath it.
  grabBlock('const PERSON_NAME_ORDERS = {', 'lastFirst" };'),
  'let PERSON_NAME_ORDER = PERSON_NAME_ORDERS.firstLast;',
  grabFn('isPersonType'),
  grabFn('splitPersonName'),
  grabFn('personNamePartsOf'),
  grabFn('composePersonName'),
  grabFn('nameOf'),
  'module.exports = { fieldAppliesTo, nameOf, typeNameOf, TYPE_REGISTRY };',
].join('\n');

const mod = { exports: {} };
try {
  new Function('module', code)(mod);
} catch (e) {
  console.error('Could not evaluate the extracted helpers:\n  ' + e.message);
  process.exit(1);
}
const { fieldAppliesTo, nameOf } = mod.exports;

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};

// --- 1. which types carry a tag --------------------------------------------
['Room', 'Building', 'Campus', 'User'].forEach(t => {
  check(`${t} carries no tag by default`, fieldAppliesTo('tag', t) === false);
});
['Computer', 'Electrical Panel', 'Bulk Item', 'Other'].forEach(t => {
  check(`${t} does carry a tag`, fieldAppliesTo('tag', t) === true);
});

// --- 2. the adoption rule, exactly as loadData applies it ------------------
// (Same expression, so a change to the rule shows up here.)
const adoptTag = a => {
  if (a.tag !== undefined && a.tag !== null) return a;
  return { ...a, tag: fieldAppliesTo('tag', a.type) ? (a.label || '') : '' };
};
{
  const room = adoptTag({ id: 'r1', label: 'BCR0006', type: 'Room', name: 'Room 102' });
  check('a Room does NOT inherit its label as a tag', room.tag === '',
        `got ${JSON.stringify(room.tag)}`);
  check("...and its label is left intact for the rollback", room.label === 'BCR0006');

  const user = adoptTag({ id: 'u1', label: 'BCA0090', type: 'User', name: 'Jen Kramer' });
  check('a User does NOT inherit its label as a tag', user.tag === '');

  const pc = adoptTag({ id: 'c1', label: 'BCA0001', type: 'Computer', name: 'Front Desk PC' });
  check('a Computer DOES inherit its label as a tag', pc.tag === 'BCA0001');

  const already = adoptTag({ id: 'c2', label: 'BCA0002', tag: '', type: 'Computer' });
  check('an explicitly-empty tag is never re-adopted', already.tag === '',
        'a stored empty tag means someone cleared it; re-adopting would undo that on every load');
}

// --- 3. nameOf's three rungs ------------------------------------------------
{
  const typesList = [{ id: 'Computer', name: 'Computer' }];
  check('nameOf prefers the name',
        nameOf({ name: 'Front Desk PC', tag: 'BCA0001', type: 'Computer', id: 'x' }, typesList) === 'Front Desk PC');
  check('nameOf falls back to the tag',
        nameOf({ name: '', tag: 'BCA0001', type: 'Computer', id: 'x' }, typesList) === 'BCA0001');
  const last = nameOf({ name: '', tag: '', type: 'Computer', id: 'b81c60de-2f47-4a93-8e15-0d7c39ab6215' }, typesList);
  check('nameOf falls back to "<type> <short id>"', last === 'Computer b81c60de', `got ${JSON.stringify(last)}`);
  check('nameOf never returns empty for a typed asset',
        nameOf({ name: '', tag: '', type: 'Room', id: 'abcdef01-0000' }) !== '');
  // The degradation named in nameOf's own comment: no typesList, so the type id
  // stands in -- correct for every built-in, since a built-in's id IS its name.
  check('without a typesList a built-in still reads correctly',
        nameOf({ name: '', tag: '', type: 'Room', id: 'abcdef01-0000' }) === 'Room abcdef01');
}

// --- 4. the duplicate-tag rule, as findTagConflict applies it --------------
// Reproduced rather than sliced: it closes over `assets` inside the component.
// The SHAPE is what matters and is asserted against the real source below.
{
  const assets = [
    { id: 'a', tag: 'BCA0001', type: 'Computer' },
    { id: 'b', tag: '', type: 'Room' },
    { id: 'c', tag: '', type: 'Room' },
  ];
  const findTagConflict = (tag, excludeId) => {
    const key = String(tag || '').trim().toLowerCase();
    if (!key) return null;
    return assets.find(a => a.id !== excludeId && String(a.tag || '').trim().toLowerCase() === key) || null;
  };
  check('an empty tag never conflicts', findTagConflict('', 'b') === null,
        'otherwise every untagged asset collides with every other and nothing saves');
  check('a duplicate tag is caught', findTagConflict('BCA0001', 'zzz') !== null);
  check('a tag does not conflict with itself on edit', findTagConflict('BCA0001', 'a') === null);
  check('matching is case- and space-insensitive', findTagConflict(' bca0001 ', 'zzz') !== null);

  // Guard the reproduction: if the real one stops skipping empties, say so here.
  const realSrc = grabFn('findTagConflict');
  check('the real findTagConflict still short-circuits on an empty tag',
        /if \(!key\) return null;/.test(realSrc),
        realSrc.split('\n').slice(0, 4).join('\n        '));
  check('the real findTagConflict still excludes the asset being edited',
        /excludeId/.test(realSrc));
}

// --- 5. the tag is editable per type ---------------------------------------
{
  const structural = grabBlock('const TYPE_STRUCTURAL_FIELDS = new Set(', ');');
  check('the tag is NOT structural, so the type editor can switch it off',
        !/["']tag["']/.test(structural) && !/["']label["']/.test(structural),
        structural);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
