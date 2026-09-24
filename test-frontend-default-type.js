// The type editor's "Default type for new assets" setting.
//
// Runs the REAL defaultNewAssetType and renameTypeInList, sliced out of
// index.html, plus two source checks on the wiring that can't be executed
// outside the component: startAdd reading the resolver instead of a hardcoded
// "Computer", and saveTypeSettings writing through renameTypeInList.
//
// Run: node test-frontend-default-type.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

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
const code = [
  sliceTopLevel('function defaultNewAssetType(typesList) {'),
  sliceTopLevel('function renameTypeInList(list, id, name, makeDefault) {'),
].join('\n');
const { defaultNewAssetType, renameTypeInList } =
  new Function(code + '\nreturn { defaultNewAssetType, renameTypeInList };')();

// --- resolution --------------------------------------------------------------
const shipped = [{ id: 'Computer', name: 'Computer' }, { id: 'Monitor', name: 'Monitor' }, { id: 'Room', name: 'Room' }];
check('no flag anywhere -> Computer, what startAdd always used',
  defaultNewAssetType(shipped) === 'Computer');
check('a flagged type wins over Computer',
  defaultNewAssetType([...shipped.slice(0, 2), { id: 'Room', name: 'Room', isDefault: true }]) === 'Room');
check('Computer removed and nothing flagged -> first listed, not a type that does not exist',
  defaultNewAssetType([{ id: 'Room', name: 'Room' }, { id: 'Monitor', name: 'Monitor' }]) === 'Room');
check('removing the flagged type (removeType filters it out) falls back to Computer',
  defaultNewAssetType([{ id: 'Computer', name: 'Computer' }, { id: 'Monitor', name: 'Monitor', isDefault: true }]
    .filter(t => t.id !== 'Monitor')) === 'Computer');
check('empty / missing list does not throw',
  defaultNewAssetType([]) === 'Computer' && defaultNewAssetType(undefined) === 'Computer');

// --- writing the flag ----------------------------------------------------------
const flaggedMonitor = [{ id: 'Computer', name: 'Computer' }, { id: 'Monitor', name: 'Monitor', isDefault: true }, { id: 'Room', name: 'Room' }];
const moved = renameTypeInList(flaggedMonitor, 'Room', 'Space', true);
check('making a type the default flags it and renames it',
  moved.find(t => t.id === 'Room').isDefault === true && moved.find(t => t.id === 'Room').name === 'Space');
check('making a type the default CLEARS the old default -- never two',
  moved.filter(t => t.isDefault).length === 1 && !('isDefault' in moved.find(t => t.id === 'Monitor')));
check('...and the resolver agrees', defaultNewAssetType(moved) === 'Room');

const plainRename = renameTypeInList(flaggedMonitor, 'Computer', 'Workstation', false);
check('saving another type WITHOUT ticking leaves the existing default alone',
  defaultNewAssetType(plainRename) === 'Monitor' && plainRename.find(t => t.id === 'Computer').name === 'Workstation');
check('an untouched entry keeps its reference (persist compares by identity)',
  plainRename[2] === flaggedMonitor[2]);
const resaveDefault = renameTypeInList(flaggedMonitor, 'Monitor', 'Monitors', false);
check('re-saving the default type itself (box locked, so false) does not unset it',
  resaveDefault.find(t => t.id === 'Monitor').isDefault === true && defaultNewAssetType(resaveDefault) === 'Monitor');
check('extra keys on an entry survive a rename',
  renameTypeInList([{ id: 'X', name: 'X', extra: 1 }], 'X', 'Y', false)[0].extra === 1);

// --- wiring ------------------------------------------------------------------
const startAddAt = src.indexOf('  function startAdd() {');
const startAddBody = src.slice(startAddAt, src.indexOf(NL + '  }' + NL, startAddAt));
check('startAdd resolves the starting type through defaultNewAssetType',
  /const startType = defaultNewAssetType\(typesList\)/.test(startAddBody));
check('startAdd no longer hardcodes Computer',
  !/const startType = "Computer"/.test(startAddBody));
check('saveTypeSettings writes typesList through renameTypeInList with the draft flag',
  /renameTypeInList\(typesList, id, name, !!draft\.isDefault\)/.test(src));

// --- the scoped Parent follows a Type change -----------------------------------
// Scoped to a Building, the form opens on Computer (which only takes a Room), so
// the Parent starts blank. Switching to Room must then fill it in -- that it
// didn't read as "the prefill doesn't work". canBeParentOf is stubbed with the
// shipped rule for these three types; the real one reads the registry.
const scopeCode = [
  sliceTopLevel('function scopedParentFor(type, scopeId, assets) {'),
  sliceTopLevel('function reScopedParentId(currentParentId, newType, scopeId, assets) {'),
].join('\n');
const PARENTS = { Computer: ['Room'], Room: ['Room', 'Building'], Building: ['Campus'] };
const { scopedParentFor, reScopedParentId } = new Function('canBeParentOf',
  scopeCode + '\nreturn { scopedParentFor, reScopedParentId };')((p, c) => (PARENTS[c] || []).includes(p));
const place = [{ id: 'B1', type: 'Building' }, { id: 'R1', type: 'Room' }, { id: 'R2', type: 'Room' }];
check('scoped to a Building, a Computer starts with no parent (it cannot sit there)',
  scopedParentFor('Computer', 'B1', place) === '');
check('...and switching the type to Room fills the Building in',
  reScopedParentId('', 'Room', 'B1', place) === 'B1');
check('switching back to a type the scope cannot hold clears it rather than leaving an illegal parent',
  reScopedParentId('B1', 'Computer', 'B1', place) === '');
check('a parent picked BY HAND survives any type change',
  reScopedParentId('R2', 'Room', 'B1', place) === 'R2' && reScopedParentId('R2', 'Computer', 'B1', place) === 'R2');
check('no scope: a type change leaves a blank parent blank', reScopedParentId('', 'Room', '', place) === '');
check('the add form\'s Type field re-derives the parent through it',
  /type: v, parentId: reScopedParentId\(draft\.parentId, v, scopeId, assets\)/.test(src));
check('startAdd seeds the parent through the same rule',
  /const startParentId = scopedParentFor\(startType, scopeId, assets\)/.test(startAddBody));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
