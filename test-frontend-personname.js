// Unit test for a person's name held as two fields (firstName/lastName), with
// `name` composed at render — see CLAUDE.md, "A person's name is two fields".
//
// Six rules here fail SILENTLY if they regress, which is why they are tested
// rather than eyeballed:
//
//   1. Stored parts must BEAT a split of the ride-along `name`. Get it wrong
//      and every person whose surname is two words ("Vega Ruiz") is quietly
//      re-split on every load and reads as "Ruiz, Ana Vega" forever, with the
//      correction they typed still sitting in the sheet.
//   2. adoptPersonNames must fill a blank and NEVER rewrite `name`. Rewriting
//      it destroys the one copy of what the parts were split from — the way
//      back if the split is judged wrong.
//   3. It must decline when either part is already set, or a deliberate
//      one-part name is overwritten by a re-split of the stale string beside it.
//   4. personMatchKey must be ORDER-INDEPENDENT. This is the dangerous one:
//      convertUsersToAssets and unconvertedUserNames both compare a legacy
//      "Jen Kramer" against existing people, and if that comparison goes
//      through the composed name instead, then while the list is sorted by last
//      name every already-converted person reads as unconverted — usersAreAssets
//      flips false, the app drops to legacy name mode with assignments stored as
//      ids, and the next save writes them away.
//   5. A one-part name must compose to itself in BOTH orders. A stray "Smith, "
//      or ", John" is the visible half of the same bug.
//   6. adoptLegacyNames must SKIP a person type. Otherwise every person is
//      given a generated "User BCA0090" in the sheet — invisible while nameOf
//      prefers the parts, and waiting for anything that reads the column.
//
// Run: node test-frontend-personname.js   (exits non-zero on failure)
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

// The REAL registry and the real derived sets, so isPersonType answers from the
// same `personType` key the app reads rather than from a copy of the answer.
const code = [
  iconStubs,
  'const TYPE_SETTINGS = {};',
  'let TYPE_FIELD_COLUMNS = [];',
  registrySrc,
  'let DERIVED_TYPE_SETS = { restrictedFields: new Set(), placeTypes: new Set(), personTypes: new Set() };',
  grabFn('recomputeDerivedTypeSets'),
  'recomputeDerivedTypeSets();',
  grabFn('typeEntryFor'),
  grabFn('typeNameOf'),
  grabFn('typeTakesParent'),
  grabFn('isPlaceType'),
  grabFn('isPersonType'),
  grabFn('restrictedFields'),
  grabFn('fieldAppliesTo'),
  grabBlock('const PERSON_NAME_ORDERS = {', 'lastFirst" };'),
  'let PERSON_NAME_ORDER = PERSON_NAME_ORDERS.firstLast;',
  grabFn('applyPersonNameOrder'),
  grabFn('splitPersonName'),
  grabFn('personNamePartsOf'),
  grabFn('composePersonName'),
  grabFn('personNameVariants'),
  grabFn('personMatchKey'),
  grabBlock('const NAME_SORT_KEYS = [', '];'),
  grabBlock('const NAME_ORDER_OPTIONS = [', '];'),
  grabFn('nameOf'),
  grabFn('nameSortValue'),
  grabFn('adoptPersonNames'),
  // adoptLegacyNames needs the suggestion machinery it calls; all real.
  grabBlock('const FIXED_IN_PLACE_TYPES', ');'),
  grabFn('nearestPlaceNameOf'),
  grabFn('ancestorsOf'),
  grabBlock('const MAX_PARENT_DEPTH', ';'),
  grabBlock('const NAME_FROM_FIELD', ';'),
  grabFn('nameFromFieldOf'),
  grabFn('suggestedNameFor'),
  grabFn('adoptLegacyNames'),
  `module.exports = {
     nameOf, adoptPersonNames, adoptLegacyNames, splitPersonName, personMatchKey,
     personNameVariants, composePersonName, nameSortValue, applyPersonNameOrder,
     PERSON_NAME_ORDERS, NAME_SORT_KEYS, NAME_ORDER_OPTIONS, fieldAppliesTo,
   };`,
].join('\n');

const mod = { exports: {} };
try {
  new Function('module', code)(mod);
} catch (e) {
  console.error('Could not evaluate the extracted helpers:\n  ' + e.message);
  process.exit(1);
}
const {
  nameOf, adoptPersonNames, adoptLegacyNames, splitPersonName, personMatchKey,
  personNameVariants, composePersonName, nameSortValue, applyPersonNameOrder,
  PERSON_NAME_ORDERS, NAME_SORT_KEYS, NAME_ORDER_OPTIONS, fieldAppliesTo,
} = mod.exports;

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};
const firstLast = () => applyPersonNameOrder(PERSON_NAME_ORDERS.firstLast);
const lastFirst = () => applyPersonNameOrder(PERSON_NAME_ORDERS.lastFirst);

// ---------- splitting ----------
const s1 = splitPersonName('Jen Kramer');
check('the last token is the surname', s1.firstName === 'Jen' && s1.lastName === 'Kramer', JSON.stringify(s1));
const s2 = splitPersonName('Mary Jo Vasquez');
check('everything before the last token stays the first name',
  s2.firstName === 'Mary Jo' && s2.lastName === 'Vasquez', JSON.stringify(s2));
const s3 = splitPersonName('James');
check('one token is a first name with no surname',
  s3.firstName === 'James' && s3.lastName === '', JSON.stringify(s3));
const s4 = splitPersonName('   ');
check('blank splits to two blanks', s4.firstName === '' && s4.lastName === '');
// The app WRITES this spelling, so it has to be able to read it back — a name
// captured while the list was sorted by surname (a filter value, a picker
// choice, an audit row) would otherwise get "Smith," as a surname and match
// nobody. This is what emptied a live User filter when the sort was flipped.
const s5 = splitPersonName('Smith, John');
check('"Last, First" is read as such, not split on the last space',
  s5.firstName === 'John' && s5.lastName === 'Smith', JSON.stringify(s5));
const s6 = splitPersonName('Vega Ruiz, Ana');
check('a two-word surname survives the comma form',
  s6.firstName === 'Ana' && s6.lastName === 'Vega Ruiz', JSON.stringify(s6));
const s7 = splitPersonName('Smith,');
check('a trailing comma with nothing after it falls back to the space split',
  s7.lastName === '' && s7.firstName === 'Smith,', JSON.stringify(s7));

// ---------- composing ----------
firstLast();
check('first-last composes "Jen Kramer"', composePersonName('Jen', 'Kramer') === 'Jen Kramer');
lastFirst();
check('last-first composes "Kramer, Jen"', composePersonName('Jen', 'Kramer') === 'Kramer, Jen');
// Rule 5.
check('a first name alone has no trailing comma in last-first order',
  composePersonName('James', '') === 'James', composePersonName('James', ''));
check('a surname alone has no leading comma in last-first order',
  composePersonName('', 'Kramer') === 'Kramer', composePersonName('', 'Kramer'));
firstLast();
check('a first name alone is itself in first-last order too',
  composePersonName('James', '') === 'James');

// ---------- nameOf ----------
const ana = { id: 'u1', type: 'User', name: 'Ana Vega Ruiz', firstName: 'Ana', lastName: 'Vega Ruiz' };
firstLast();
check('nameOf composes a person from the parts', nameOf(ana) === 'Ana Vega Ruiz', nameOf(ana));
lastFirst();
// Rule 1: the naive split would say "Ruiz, Ana Vega".
check('STORED PARTS BEAT a split of the ride-along name',
  nameOf(ana) === 'Vega Ruiz, Ana', nameOf(ana));
const jen = { id: 'u2', type: 'User', name: 'Jen Kramer' };
check('a person with no parts yet falls back to splitting `name`',
  nameOf(jen) === 'Kramer, Jen', nameOf(jen));
const room = { id: 'r1', type: 'Room', name: 'Room 101' };
check('a non-person is untouched by the order', nameOf(room) === 'Room 101', nameOf(room));
firstLast();
check('a non-person is untouched by the other order too', nameOf(room) === 'Room 101');
const nameless = { id: 'u3', type: 'User', tag: 'BCA0110' };
check('a person with nothing at all still falls through to the old rungs',
  nameOf(nameless) === 'BCA0110', nameOf(nameless));

// ---------- the sort is INDEPENDENT of the display setting ----------
// Rule 7: the sort must compare the same thing whichever way names are being
// read. Comparing the DISPLAYED string (which is what the first version of this
// feature did) means changing a display preference silently reorders the list.
check('both name sort keys are offered',
  NAME_SORT_KEYS.length === 2 && NAME_SORT_KEYS.some(k => k.key === 'name') && NAME_SORT_KEYS.some(k => k.key === 'lastName'));
check('the setting offers exactly the two orders',
  NAME_ORDER_OPTIONS.length === 2
  && NAME_ORDER_OPTIONS.some(o => o.value === PERSON_NAME_ORDERS.firstLast)
  && NAME_ORDER_OPTIONS.some(o => o.value === PERSON_NAME_ORDERS.lastFirst));
check('every option carries a worked example, which is what the menu shows',
  NAME_ORDER_OPTIONS.every(o => o.label && o.example));

const sortPeople = [
  { id: 'p1', type: 'User', firstName: 'Zoe', lastName: 'Adams' },
  { id: 'p2', type: 'User', firstName: 'Adam', lastName: 'Zeller' },
  { id: 'p3', type: 'Room', name: 'Kitchen' },
];
const ordered = (key) => sortPeople
  .map(a => [a.id, nameSortValue(a, key)])
  .sort((x, y) => x[1].localeCompare(y[1])).map(x => x[0]).join(',');
firstLast();
const byFirstA = ordered('name'), byLastA = ordered('lastName');
lastFirst();
const byFirstB = ordered('name'), byLastB = ordered('lastName');
check('a first-name sort does not move when the display setting changes',
  byFirstA === byFirstB, `${byFirstA} vs ${byFirstB}`);
check('a last-name sort does not move either',
  byLastA === byLastB, `${byLastA} vs ${byLastB}`);
check('the two sorts genuinely differ', byFirstA !== byLastA, `${byFirstA} / ${byLastA}`);
check('a first-name sort really is by first name', byFirstA === 'p2,p3,p1', byFirstA);
check('a last-name sort really is by surname', byLastA === 'p1,p3,p2', byLastA);
firstLast();
check('a non-person sorts by what it is called, under either key',
  nameSortValue(sortPeople[2], 'lastName') === 'Kitchen');

// ---------- adoption ----------
// Rule 2 and 3.
const loaded = adoptPersonNames([
  { id: 'a', type: 'User', name: 'Jen Kramer' },
  { id: 'b', type: 'User', name: 'Ana Vega Ruiz', firstName: 'Ana', lastName: 'Vega Ruiz' },
  { id: 'c', type: 'User', name: 'Cher', firstName: '', lastName: 'Sarkisian' },
  { id: 'd', type: 'Room', name: 'Room 101' },
  // Irregular whitespace ON PURPOSE: recomposing the parts would tidy it to
  // "Mary Jo Vasquez", so this row is the one that can tell "left `name`
  // alone" apart from "wrote back something that happens to match".
  { id: 'g', type: 'User', name: 'Mary Jo  Vasquez ' },
]);
const byId = k => loaded.find(a => a.id === k);
check('a person with no parts is split on load',
  byId('a').firstName === 'Jen' && byId('a').lastName === 'Kramer');
check('the adoption NEVER rewrites `name`, not even to tidy it',
  byId('a').name === 'Jen Kramer' && byId('b').name === 'Ana Vega Ruiz'
    && byId('g').name === 'Mary Jo  Vasquez ',
  JSON.stringify(byId('g').name));
check('...while still splitting that row correctly',
  byId('g').firstName === 'Mary Jo' && byId('g').lastName === 'Vasquez');
check('a person that already has parts is left alone',
  byId('b').firstName === 'Ana' && byId('b').lastName === 'Vega Ruiz');
check('ONE part already set is enough to decline',
  byId('c').firstName === '' && byId('c').lastName === 'Sarkisian',
  JSON.stringify({ f: byId('c').firstName, l: byId('c').lastName }));
check('a non-person is never given parts',
  byId('d').firstName === undefined && byId('d').lastName === undefined);
check('the adoption is deterministic — twice is the same as once',
  JSON.stringify(adoptPersonNames(loaded)) === JSON.stringify(loaded));

// Rule 6.
const named = adoptLegacyNames([
  { id: 'e', type: 'User', tag: '', firstName: 'Kelly', lastName: 'Mackinga' },
  { id: 'f', type: 'Monitor', tag: 'BCA0002' },
], [{ id: 'User', name: 'User' }, { id: 'Monitor', name: 'Monitor' }]);
check('adoptLegacyNames leaves a person with NO stored name',
  !named.find(a => a.id === 'e').name, JSON.stringify(named.find(a => a.id === 'e')));
check('adoptLegacyNames still names a non-person',
  !!named.find(a => a.id === 'f').name, JSON.stringify(named.find(a => a.id === 'f')));

// ---------- matching, the destructive one ----------
// Rule 4.
const person = { type: 'User', firstName: 'Jen', lastName: 'Kramer' };
firstLast();
const keyFirst = personMatchKey(person);
lastFirst();
const keyLast = personMatchKey(person);
check('personMatchKey does not move when the display order does',
  keyFirst === keyLast, `${keyFirst} vs ${keyLast}`);
check('a legacy name string matches the person it names, in either order',
  personMatchKey('Jen Kramer') === keyLast, `${personMatchKey('Jen Kramer')} vs ${keyLast}`);
check('matching is case- and space-insensitive',
  personMatchKey('  jen   KRAMER ') === keyLast);
check('two different people do not collide',
  personMatchKey('Jen Kramer') !== personMatchKey('Jen Kramerson'));
// The round trip that matters: a name read off the screen in EITHER order has
// to lead back to the same person. A user filter, a bulk-reassign target and a
// conversion all compare a captured string against live records this way.
check('a name captured as "Last, First" still matches the person',
  personMatchKey('Kramer, Jen') === keyLast, `${personMatchKey('Kramer, Jen')} vs ${keyLast}`);
check('every spelling nameOf can produce round-trips to the same key',
  personNameVariants(person).every(v => personMatchKey(v) === keyLast),
  JSON.stringify(personNameVariants(person).map(personMatchKey)));
// And the demonstration that nameOf CANNOT serve as that key.
check('nameOf would have failed this comparison, which is why the key exists',
  nameOf(person) !== 'Jen Kramer', nameOf(person));

// Both spellings resolve an audit row written under either order.
const variants = personNameVariants(person);
check('personNameVariants offers both spellings',
  variants.includes('Jen Kramer') && variants.includes('Kramer, Jen'), JSON.stringify(variants));
check('a one-part person has a single variant',
  personNameVariants({ type: 'User', firstName: 'James', lastName: '' }).length === 1);

// ---------- the field rules ----------
check('firstName belongs to a person type', fieldAppliesTo('firstName', 'User'));
check('firstName is restricted away from everything else', !fieldAppliesTo('firstName', 'Computer'));
check('a person has NO `name` field of its own', !fieldAppliesTo('name', 'User'));
check('everything else still has one', fieldAppliesTo('name', 'Computer'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
