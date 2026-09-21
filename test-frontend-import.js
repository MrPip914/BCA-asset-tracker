// Unit test for the Assets tab's round trip: export what is shown, edit it in a
// spreadsheet, import it back.
//
// WHY THESE AND NOT OTHERS. Every rule asserted below fails SILENTLY if it
// regresses -- the import reports success, the file looks right, and the damage
// is in the inventory:
//
//   1. The export and the import must agree about which header means which
//      field. They build it from one function over one `columns` list; if they
//      ever stop, a column lands under the wrong heading and the import writes
//      serials into hostnames.
//   2. A parent must resolve by its own FULL PATH first. Two rooms can share a
//      name, and taking the first match moves equipment into the wrong building
//      with nothing on screen saying so.
//   3. A tag colliding with an asset the file does NOT contain must be found.
//      That is the whole-inventory check, and it is invisible from inside the
//      file -- which is exactly why it has to be looked for deliberately.
//   4. One bad row must refuse the WHOLE file. Half-applying leaves the
//      inventory in a state nobody chose and the spreadsheet on screen no
//      longer describing what landed.
//   5. A row that matches nothing must CREATE, and a row that changes nothing
//      must write nothing. Get the second wrong and every import rewrites the
//      whole Assets tab and fills the audit log with edits that did not happen.
//   6. personIds must only be written in id mode. In legacy name mode nothing
//      reads them, so resolving names to ids there hands the asset an
//      assignment the app cannot see -- the v28 data loss from a new direction.
//
// Run: node test-frontend-import.js   (exits non-zero on failure)
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
  grabFn('fullPathOf'),
  grabFn('importHeadersFor'),
  grabFn('importCellFor'),
  grabFn('assetToImportRow'),
  grabFn('importCellText'),
  grabFn('importRowsFromGrid'),
  grabFn('buildImportRefIndex'),
  grabFn('resolveImportRef'),
  grabFn('resolveImportType'),
  grabFn('buildImportPeopleIndex'),
  grabFn('splitImportList'),
  grabFn('splitImportPeople'),
  grabFn('describeImportAsset'),
  grabFn('planAssetImport'),
  `module.exports = {
     PERSON_NAME_ORDERS, setNameOrder: v => { PERSON_NAME_ORDER = v; },
     planAssetImport, assetToImportRow, importHeadersFor, importRowsFromGrid,
     resolveImportRef, buildImportRefIndex, resolveImportType, importCellText,
     fullPathOf, nameOf, pathOf, DEFAULT_COLUMNS, IMPORT_KEY_HEADER, splitImportList,
     splitImportPeople,
   };`,
].join('\n');

const mod = { exports: {} };
try {
  new Function('module', 'crypto', code)(mod, { randomUUID: () => 'new-uuid-' + Math.random().toString(16).slice(2) });
} catch (e) {
  console.error('Could not evaluate the extracted helpers:\n  ' + e.message);
  process.exit(1);
}
const {
  PERSON_NAME_ORDERS, setNameOrder,
  planAssetImport, assetToImportRow, importHeadersFor, importRowsFromGrid,
  resolveImportRef, buildImportRefIndex, resolveImportType, importCellText,
  fullPathOf, nameOf, DEFAULT_COLUMNS, IMPORT_KEY_HEADER, splitImportList, splitImportPeople,
} = mod.exports;

// --- a small inventory, shaped like a real one -------------------------------
// Two rooms deliberately share a NAME in different buildings: that is the case
// the full-path tier exists for, and a fixture where every name is unique could
// never show it.
const typesList = [
  { id: 'Campus', name: 'Campus' }, { id: 'Building', name: 'Building' },
  { id: 'Room', name: 'Room' }, { id: 'Computer', name: 'Computer' },
  { id: 'Monitor', name: 'Monitor' }, { id: 'User', name: 'User' },
  { id: 'Bulk Item', name: 'Bulk Item' },
  { id: 'a7f3-uuid', name: 'Access Point' },
];
const assets = [
  { id: 'BCC0001', type: 'Campus', name: 'Main Campus', tag: '', status: 'Active' },
  { id: 'BCB0001', type: 'Building', name: 'Building 100', parentId: 'BCC0001', status: 'Active' },
  { id: 'BCB0002', type: 'Building', name: 'Building 200', parentId: 'BCC0001', status: 'Active' },
  { id: 'r-101a', type: 'Room', name: 'Room 101', parentId: 'BCB0001', status: 'Active' },
  { id: 'r-101b', type: 'Room', name: 'Room 101', parentId: 'BCB0002', status: 'Active' },
  { id: 'r-storage', type: 'Room', name: 'Storage', parentId: 'BCB0001', status: 'Active' },
  // A Room with NO parent, sharing a name with the one above. Unassigned is a
  // real state, so this is ordinary data -- and it is the only shape that tells
  // the full-path tier apart from the bare-name one: "Storage" is this room's
  // ENTIRE address and also one of two rooms called that.
  { id: 'r-loose', type: 'Room', name: 'Storage', status: 'Active' },
  { id: 'r-lab', type: 'Room', name: 'Science Lab', parentId: 'BCB0002', status: 'Active' },
  { id: 'u-jen', type: 'User', firstName: 'Jen', lastName: 'Kramer', status: 'Active' },
  { id: 'u-aaron', type: 'User', firstName: 'Aaron', lastName: 'Cantrell', status: 'Active' },
  { id: 'c-1', type: 'Computer', name: 'Front Office PC', tag: 'BCA0001', parentId: 'r-101a',
    serial: 'SN-1', hostname: 'front-1', personIds: ['u-jen'], person: 'Jen Kramer',
    purchaseDate: '2024-03-01', peripherals: 'Dock/Keyboard', status: 'Active' },
  { id: 'c-2', type: 'Computer', name: 'Lab PC', tag: 'BCA0002', parentId: 'r-101b',
    serial: 'SN-2', personIds: [], status: 'Active' },
  { id: 'm-1', type: 'Monitor', name: 'Lab Monitor', tag: 'BCA0003', parentId: 'r-101b',
    personIds: [], status: 'Archived' },
  // TWO PEOPLE ON ONE DEVICE, which is the shape the User column's separator
  // has to survive. With one person every separator round-trips, so a fixture
  // of singly-assigned assets can never show a joiner that a name can contain.
  { id: 'c-3', type: 'Computer', name: 'Shared Cart PC', tag: 'BCA0004', parentId: 'r-storage',
    personIds: ['u-jen', 'u-aaron'], person: 'Jen Kramer/Aaron Cantrell', status: 'Active' },
];
const columns = DEFAULT_COLUMNS;
const ctx = {
  assets, columns, typesList,
  peripheralsList: ['Dock', 'Keyboard', 'Mouse'],
  bulkItemTypes: ['Chairs'],
  usersAreAssets: true,
};
// By id, never by position: the fixture grows, and a test that silently
// addressed a different asset than it names would assert nothing.
const A = id => assets.find(a => a.id === id);
const headers = [IMPORT_KEY_HEADER, ...importHeadersFor(columns).map(h => h.header)];
const rowFor = a => assetToImportRow(a, ctx);
// Builds the grid an export would produce for `list`, with `edits` applied by
// header. Going through assetToImportRow rather than hand-writing cells is the
// point: a round-trip test that hand-wrote the file would stop testing the
// export the moment the two disagreed.
// `edits` is keyed by ASSET ID, not by row position: the fixture grows, and an
// edit that silently landed on a different row than it names would assert
// nothing while still passing.
function gridFrom(list, edits = {}) {
  const rows = list.map(a => {
    const row = { ...rowFor(a), ...(edits[a.id] || {}) };
    return headers.map(h => (row[h] === undefined ? '' : row[h]));
  });
  return [headers, ...rows];
}
const planFor = (list, edits, over = {}) =>
  planAssetImport(importRowsFromGrid(gridFrom(list, edits)), { ...ctx, ...over });

// --- 1. the two halves agree about headers -----------------------------------
{
  const map = importHeadersFor(columns);
  const dupes = map.map(h => h.header).filter((h, i, all) => all.indexOf(h) !== i);
  check('every column gets a distinct header', dupes.length === 0, `repeated: ${dupes.join(', ')}`);

  // A custom column deliberately colliding with a built-in LABEL. The export
  // writes an object per row, so without the key fallback the second would
  // overwrite the first and that field would silently never be exported.
  const collide = [...columns, { key: 'siteNotes', label: 'Notes', custom: true }];
  const hs = importHeadersFor(collide).map(h => h.header);
  check('a column whose label is already taken falls back to its key',
        hs.filter(h => h === 'Notes').length === 1 && hs.includes('siteNotes'),
        `headers: ${hs.filter(h => /Notes|siteNotes/.test(h)).join(', ')}`);

  check('Asset Key is never used as a column header',
        !importHeadersFor([{ key: 'k', label: IMPORT_KEY_HEADER }]).some(h => h.header === IMPORT_KEY_HEADER));
}

// --- 2. a clean round trip changes nothing -----------------------------------
{
  const plan = planFor(assets);
  check('re-importing an untouched export writes nothing',
        plan.errors.length === 0 && plan.updates.length === 0 && plan.creates.length === 0
        && plan.unchanged === assets.length,
        `errors=${plan.errors.length} updates=${plan.updates.length} creates=${plan.creates.length} unchanged=${plan.unchanged}\n        ${plan.errors.concat(plan.updates.map(u => u.changes.map(c => `${u.asset.id}.${c.key}: "${c.from}"->"${c.to}"`).join('; '))).join('\n        ')}`);
}

// --- 3. a field edit lands, and only that field ------------------------------
{
  const plan = planFor(assets, { 'c-1': { Serial: 'SN-CHANGED' } });
  const u = plan.updates[0];
  check('editing one cell updates exactly that field',
        plan.errors.length === 0 && plan.updates.length === 1 && u.asset.id === 'c-1'
        && u.changes.length === 1 && u.changes[0].key === 'serial'
        && u.changes[0].from === 'SN-1' && u.changes[0].to === 'SN-CHANGED'
        && u.next.serial === 'SN-CHANGED' && u.next.hostname === 'front-1',
        JSON.stringify(plan.errors.concat(plan.updates.map(x => x.changes))));
}

// --- 4. the parent resolves by FULL PATH first -------------------------------
{
  // Two rooms called "Room 101". The export writes the full path, so this must
  // land on the one in Building 200 -- not on whichever is first.
  const plan = planFor([A('c-1')], { 'c-1': { Path: 'Main Campus › Building 200 › Room 101' } });
  check('a parent given as a full path picks the right one of two same-named rooms',
        plan.errors.length === 0 && plan.updates.length === 1
        && plan.updates[0].next.parentId === 'r-101b',
        `errors: ${plan.errors.join(' | ')} parentId=${(plan.updates[0] || {}).next && plan.updates[0].next.parentId}`);

  const bare = planFor([A('c-1')], { 'c-1': { Path: 'Room 101' } });
  check('a bare name matching two assets is REFUSED, not guessed at',
        bare.errors.length === 1 && /matches more than one/.test(bare.errors[0]),
        bare.errors.join(' | '));

  const unique = planFor([A('c-1')], { 'c-1': { Path: 'Science Lab' } });
  check('a bare name matching exactly one asset resolves',
        unique.errors.length === 0 && unique.updates[0].next.parentId === 'r-lab',
        unique.errors.join(' | '));

  // THE TIER ORDER, which is what stops a full path being read as a name.
  // "Storage" is the ENTIRE address of the parentless room AND the name of two
  // rooms. An exact, complete address is the more specific answer, so the path
  // tier has to win -- try the name tier first and this reads as "ambiguous",
  // i.e. a parent that can be typed in but can never be resolved.
  const tiers = planFor([A('c-1')], { 'c-1': { Path: 'Storage' } });
  check('an exact full-path match beats a name that matches several',
        tiers.errors.length === 0 && tiers.updates.length === 1
        && tiers.updates[0].next.parentId === 'r-loose',
        `${tiers.errors.join(' | ')} parentId=${(tiers.updates[0] || {}).next && tiers.updates[0].next.parentId}`);

  const missing = planFor([A('c-1')], { 'c-1': { Path: 'Room 999' } });
  check('a parent that names nothing is refused',
        missing.errors.length === 1 && /isn't an asset in this inventory/.test(missing.errors[0]),
        missing.errors.join(' | '));

  const cleared = planFor([A('c-1')], { 'c-1': { Path: '' } });
  check('a blank Path unassigns rather than being ignored',
        cleared.errors.length === 0 && cleared.updates.length === 1
        && cleared.updates[0].next.parentId === '',
        JSON.stringify(cleared.errors));
}

// --- 5. the whole-inventory tag check ----------------------------------------
{
  // c-1 is NOT in this file. Row 2 claims its tag; nothing inside the file says
  // so, which is the entire reason this check has to look outside it.
  const plan = planFor([A('c-2')], { 'c-2': { 'Asset ID': 'BCA0001' } });
  check('a tag already worn by an asset the file does not contain is refused',
        plan.errors.length === 1 && /already on Front Office PC/.test(plan.errors[0]),
        plan.errors.join(' | '));

  const within = planFor([A('c-1'), A('c-2')], { 'c-2': { 'Asset ID': 'BCA0001' } });
  check('two rows claiming one tag are refused',
        within.errors.some(e => /is also on row/.test(e)), within.errors.join(' | '));

  // Retagging an asset that carries its own key must NOT read as a collision
  // with itself, or nothing could ever be retagged.
  const retag = planFor([A('c-1')], { 'c-1': { 'Asset ID': 'BCA0099' } });
  check('retagging an asset in place is allowed',
        retag.errors.length === 0 && retag.updates[0].next.tag === 'BCA0099',
        retag.errors.join(' | '));
}

// --- 6. one bad row refuses the whole file -----------------------------------
{
  // A GOOD EDIT AND A BAD ONE IN THE SAME FILE. The good row is what makes this
  // assertion mean anything: a file whose only edit is the broken one stages
  // nothing whatever the rule is, so it would pass a half-applying import too.
  const plan = planFor(assets, {
    'c-1': { 'Purchase Date': 'whenever' },
    'c-2': { Serial: 'SN-PERFECTLY-FINE' },
  });
  check('one bad row discards the good rows too — the file is all or nothing',
        plan.errors.length === 1 && plan.updates.length === 0 && plan.creates.length === 0,
        `errors=${plan.errors.join(' | ')} updates=${plan.updates.length} creates=${plan.creates.length}`);

  const badType = planFor([A('c-1')], { 'c-1': { Type: 'Toaster' } });
  check('an unknown type is refused', badType.errors.length === 1 && /isn't a type/.test(badType.errors[0]),
        badType.errors.join(' | '));
}

// --- 7. rows that match nothing are created ----------------------------------
{
  const grid = gridFrom([]);
  grid.push(headers.map(h => ({
    Type: 'Computer', Name: 'New Laptop', 'Asset ID': 'BCA0500',
    Path: 'Main Campus › Building 100 › Storage', Serial: 'SN-NEW',
    Peripherals: 'Dock/Stylus',
  }[h] || '')));
  const plan = planAssetImport(importRowsFromGrid(grid), ctx);
  check('a row with no key and no matching tag creates an asset',
        plan.errors.length === 0 && plan.creates.length === 1
        && plan.creates[0].next.name === 'New Laptop'
        && plan.creates[0].next.parentId === 'r-storage'
        && plan.creates[0].next.type === 'Computer'
        && !!plan.creates[0].next.id,
        `${plan.errors.join(' | ')} ${JSON.stringify(plan.creates[0] && plan.creates[0].next)}`);
  check('creating is announced as a warning, not done quietly',
        plan.warnings.some(w => /will be created as (a )?new assets?/.test(w)), plan.warnings.join(' | '));
  // A CREATED row extends the managed list too. Only the UPDATE path was
  // covered first time round, so moving the adoption off the create branch
  // went unnoticed -- and what that costs is a brand-new asset carrying a
  // peripheral no picker can offer back, which reads as a broken field.
  check("a created row's new peripheral is adopted into the managed list",
        plan.newPeripherals.join(',') === 'Stylus',
        `newPeripherals=${plan.newPeripherals.join(',')}`);
}

// --- 8. an asset the file omits is untouched ---------------------------------
{
  const plan = planFor([A('c-1')], { 'c-1': { Serial: 'SN-X' } });
  check('a one-row file stages one update and touches nothing else',
        plan.updates.length === 1 && plan.creates.length === 0
        && plan.updates[0].asset.id === 'c-1');
}

// --- 9. people resolve by match key, and only in id mode ---------------------
{
  const plan = planFor([A('c-2')], { 'c-2': { User: 'Aaron Cantrell' } });
  check('a user resolves to an id by name',
        plan.errors.length === 0 && JSON.stringify(plan.updates[0].next.personIds) === '["u-aaron"]',
        `${plan.errors.join(' | ')} ${JSON.stringify((plan.updates[0] || {}).next)}`);

  // THE "LAST, FIRST" SPELLING OF ONE PERSON. Splitting the cell on commas
  // tears this into "Cantrell" and "Aaron", neither of which is anybody --
  // which is exactly what a comma-joined User column did until a round trip
  // was tested end to end.
  const comma = planFor([A('c-2')], { 'c-2': { User: 'Cantrell, Aaron' } });
  check('a name written "Last, First" is ONE person, not two',
        comma.errors.length === 0 && JSON.stringify(comma.updates[0].next.personIds) === '["u-aaron"]',
        comma.errors.join(' | '));

  const two = planFor([A('c-2')], { 'c-2': { User: 'Cantrell, Aaron/Kramer, Jen' } });
  check('several people separated by slashes all resolve',
        two.errors.length === 0
        && JSON.stringify(two.updates[0].next.personIds) === '["u-aaron","u-jen"]',
        `${two.errors.join(' | ')} ${JSON.stringify((two.updates[0] || {}).next && two.updates[0].next.personIds)}`);

  check('people split on slash only; peripherals accept either separator',
        splitImportPeople('Cantrell, Aaron/Kramer, Jen').length === 2
        && splitImportList('Dock, Keyboard/Mouse').length === 3);

  // THE ROUND TRIP UNDER "LAST, FIRST", which is the only setting where a
  // comma-joined User column comes apart -- and the reason this has to be
  // driven end to end rather than asserted on the splitter alone. Under
  // "First Last" a comma-joined cell round-trips perfectly, so an export that
  // used commas would look entirely correct right up until somebody changed a
  // reading preference in the account menu.
  setNameOrder(PERSON_NAME_ORDERS.lastFirst);
  try {
    const surname = planFor([A('c-3')]);
    check('an untouched export round-trips under the "Last, First" name format',
          surname.errors.length === 0 && surname.updates.length === 0 && surname.unchanged === 1,
          `${surname.errors.join(' | ')} ${JSON.stringify(surname.updates.map(u => u.changes))}`);
    const moved = planFor([A('c-2')], { 'c-2': { User: nameOf(A('u-aaron')) } });
    check('a person written surname-first still resolves to one id',
          moved.errors.length === 0
          && JSON.stringify((moved.updates[0] || {}).next && moved.updates[0].next.personIds) === '["u-aaron"]',
          moved.errors.join(' | '));
  } finally {
    setNameOrder(PERSON_NAME_ORDERS.firstLast);
  }

  const nobody = planFor([A('c-2')], { 'c-2': { User: 'Nobody Here' } });
  check('a user who does not exist is refused',
        nobody.errors.length === 1 && /isn't a person in this inventory/.test(nobody.errors[0]),
        nobody.errors.join(' | '));

  // LEGACY NAME MODE. Nothing reads personIds there, so writing them would hand
  // the asset an assignment the app cannot see.
  const legacy = planFor([A('c-2')], { 'c-2': { User: 'Aaron Cantrell' } }, { usersAreAssets: false });
  const next = (legacy.updates[0] || {}).next || {};
  check('in legacy name mode the NAME is written and personIds are left alone',
        legacy.errors.length === 0 && next.person === 'Aaron Cantrell'
        && JSON.stringify(next.personIds || []) === '[]',
        `${legacy.errors.join(' | ')} ${JSON.stringify(next)}`);
}

// --- 10. a cycle spanning two rows is caught ---------------------------------
{
  // Science Lab into Storage, and Storage into Science Lab. NEITHER ROW IS A
  // LOOP ON ITS OWN, and neither is one against the inventory as it stands
  // right now -- the two rooms are unrelated today. Only the file's projected
  // result is circular, which is exactly why this cannot be checked row by row
  // against the current assets.
  const plan = planFor([A('r-lab'), A('r-storage')], {
    'r-lab': { Path: 'Main Campus › Building 100 › Storage' },
    'r-storage': { Path: 'Main Campus › Building 200 › Science Lab' },
  });
  check('a parent loop that exists only in the projected result is refused',
        plan.errors.length > 0 && /inside itself/.test(plan.errors.join(' ')),
        `errors: ${plan.errors.join(' | ')}`);

  // The CONTROL: the same move on its own is ordinary and must import cleanly.
  // Without it the assertion above would pass just as well on a planner that
  // refused every parent move there is.
  const fine = planFor([A('r-lab')], {
    'r-lab': { Path: 'Main Campus › Building 100 › Storage' },
  });
  check('one of those two moves on its own is fine',
        fine.errors.length === 0 && fine.updates.length === 1
        && fine.updates[0].next.parentId === 'r-storage',
        fine.errors.join(' | '));
}

// --- 11. a field the type does not have is dropped with a word ---------------
{
  const plan = planFor([A('r-101a')], { 'r-101a': { Serial: 'SN-NOPE' } });
  check('a value in a field this type does not have is warned about, not written',
        plan.errors.length === 0 && plan.updates.length === 0
        && plan.warnings.some(w => /Serial isn't a field on a Room/.test(w)),
        `${plan.warnings.join(' | ')}`);
  check("a person's composed Name is dropped SILENTLY, since First/Last carry it",
        !planFor([A('u-jen')]).warnings.some(w => /Name isn't a field/.test(w)),
        planFor([A('u-jen')]).warnings.join(' | '));
}

// --- 12. the wrong file says so once -----------------------------------------
{
  const plan = planAssetImport(importRowsFromGrid([
    ['Account', 'Amount'], ['Checking', '12.00'], ['Savings', '3.00'],
  ]), ctx);
  check('a file that is not an asset sheet is refused with ONE message',
        plan.errors.length === 1 && /doesn't look like an asset export/.test(plan.errors[0]),
        plan.errors.join(' | '));
  check('an empty file is refused',
        planAssetImport(importRowsFromGrid([headers]), ctx).errors.length === 1);
}

// --- 13. cells --------------------------------------------------------------
{
  check('a Date cell becomes yyyy-MM-dd in LOCAL parts',
        importCellText(new Date(2026, 8, 21)) === '2026-09-21',
        importCellText(new Date(2026, 8, 21)));
  check('a blank row is skipped rather than refused',
        importRowsFromGrid([headers, headers.map(() => ''), headers.map(() => '')]).rows.length === 0);
  check('both list separators are accepted',
        splitImportList('Dock, Keyboard/Mouse').join('|') === 'Dock|Keyboard|Mouse',
        splitImportList('Dock, Keyboard/Mouse').join('|'));
}

// --- 14. a new managed-list value is adopted, not orphaned -------------------
{
  const plan = planFor([A('c-1')], { 'c-1': { Peripherals: 'Dock/Docking Station' } });
  check('a peripheral the managed list does not have is added to it',
        plan.errors.length === 0 && plan.newPeripherals.join(',') === 'Docking Station'
        && plan.warnings.some(w => /New peripherals/.test(w)),
        `${plan.errors.join(' | ')} ${plan.newPeripherals.join(',')}`);

  // AN UNCHANGED ROW MUST NOT EXTEND THE MANAGED LIST. c-1 already carries a
  // peripheral the list has never heard of -- which is ordinary, since a value
  // can predate the list -- and re-importing that row writes nothing, so a
  // promise to add it is a promise about a save that will not happen. This is
  // not hypothetical: Sandbox ships an EMPTY peripherals list beside assets
  // that carry several, and an untouched re-import advertised four of them.
  const quiet = planFor([A('c-1')], {}, { peripheralsList: [] });
  check('an unchanged row does not extend the managed list',
        quiet.updates.length === 0 && quiet.newPeripherals.length === 0
        && !quiet.warnings.some(w => /New peripherals/.test(w)),
        `newPeripherals=${quiet.newPeripherals.join(',')} warnings=${quiet.warnings.join(' | ')}`);

  // The control: the SAME row, with something actually edited, does extend it.
  const loud = planFor([A('c-1')], { 'c-1': { Serial: 'SN-MOVED' } }, { peripheralsList: [] });
  check('the same row, once it is genuinely written, does extend it',
        loud.updates.length === 1 && loud.newPeripherals.join(',') === 'Dock,Keyboard',
        `newPeripherals=${loud.newPeripherals.join(',')}`);
}

// --- 15. archived assets are updated, and said so ----------------------------
{
  const plan = planFor([A('m-1')], { 'm-1': { Name: 'Lab Monitor 2' } });
  check('an archived asset is updated with a warning rather than skipped',
        plan.errors.length === 0 && plan.updates.length === 1
        && plan.warnings.some(w => /archived/.test(w)),
        `${plan.errors.join(' | ')} ${plan.warnings.join(' | ')}`);
}

// --- 16. a type is matched by the name people read ---------------------------
{
  check('a type resolves by name, case-insensitively',
        resolveImportType('computer', typesList) === 'Computer');
  check("a user-created type's name resolves to its uuid id",
        resolveImportType('Access Point', typesList) === 'a7f3-uuid');
  check('a raw type id still resolves, so an older file still lands',
        resolveImportType('a7f3-uuid', typesList) === 'a7f3-uuid');
}

// --- 17. the Path cell written for a child IS its parent's full path ---------
// This is the identity the whole round trip rests on. If pathOf ever starts
// including the asset itself, every parent in every exported file shifts down a
// level and the import silently re-parents the inventory.
{
  const child = A('c-1');                       // Front Office PC in Room 101 (B100)
  const parent = A('r-101a');
  check("a child's exported Path equals its parent's own full path",
        rowFor(child).Path === fullPathOf(parent, assets),
        `${rowFor(child).Path} !== ${fullPathOf(parent, assets)}`);
  check('resolving that string back finds the parent',
        resolveImportRef(rowFor(child).Path, buildImportRefIndex(assets)).asset === parent);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
