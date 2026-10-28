// Tasks with no asset: the hidden catch-all asset (2026-10-28).
//
// Runs the REAL helpers sliced out of index.html, plus source checks on the
// wiring that cannot be executed outside the component: every place that LISTS
// assets leaves the catch-all out, and the Asset picker offers it as "No asset"
// only to a caller that asks.
//
// Run: node test-frontend-general-asset.js   (exits non-zero on failure)
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
const consts = ['const GENERAL_ASSET_ID', 'const GENERAL_ASSET_TYPE', 'const GENERAL_ASSET_NAME']
  .map(d => { const i = src.indexOf(d); return src.slice(i, src.indexOf(NL, i)); }).join('\n');
const code = consts + '\n' + ['function isGeneralAsset(a) {', 'function makeGeneralAsset() {', 'function ensureGeneralAsset(list) {']
  .map(sliceTopLevel).join('\n');
const { isGeneralAsset, makeGeneralAsset, ensureGeneralAsset } =
  new Function(code + '\nreturn { isGeneralAsset, makeGeneralAsset, ensureGeneralAsset };')();

// --- helpers ------------------------------------------------------------------
const g = makeGeneralAsset();
check('the catch-all is recognised by id', isGeneralAsset(g));
check('an ordinary asset, null and undefined are not it', !isGeneralAsset({ id: 'a1' }) && !isGeneralAsset(null) && !isGeneralAsset(undefined));
check('it reads "No asset" wherever an Asset column shows its name', g.name === 'No asset');
check('it is Active, parentless and carries an empty task list', g.status === 'Active' && !g.parentId && Array.isArray(g.maintenanceItems) && g.maintenanceItems.length === 0);
const base = [{ id: 'a1' }, { id: 'a2' }];
const once = ensureGeneralAsset(base);
check('it is appended when missing', once.length === 3 && isGeneralAsset(once[2]));
check('ensuring twice adds no second one and keeps the same array', ensureGeneralAsset(once) === once);
check('a stored one (with its tasks) is kept as it is, not replaced',
  (() => { const stored = { ...makeGeneralAsset(), maintenanceItems: [{ id: 't1' }] }; const l = [{ id: 'a1' }, stored]; return ensureGeneralAsset(l)[1] === stored; })());
check('null and empty lists get one', ensureGeneralAsset(null).length === 1 && ensureGeneralAsset([]).length === 1);

// --- wiring -------------------------------------------------------------------
check('the load ensures it, after the name adoptions', /ensureGeneralAsset\(adoptLegacyNames\(adoptPersonNames\(parented\), loadedTypes\)\)/.test(src));
const filteredAt = src.indexOf('const filtered = useMemo(() => {');
check('the Assets list leaves it out', src.slice(filteredAt, filteredAt + 600).includes('isGeneralAsset(a)) return false'));
check('the type filter options do not list its type', /assets\.filter\(a => !isGeneralAsset\(a\)\)\.map\(a => a\.type \|\| "Other"\)/.test(src));
check('the full workbook\'s Assets sheet leaves it out', src.includes('const assetRows = assets.filter(a => !isGeneralAsset(a)).map'));
check('it has no page to open', /function openDetail\(asset, initialTab, opts = \{\}\) \{\s*if \(isGeneralAsset\(asset\)\) return;/.test(src));
check('the task dialog shows no asset link for it', src.includes('!isGeneralAsset(workTarget) ? workTarget : null'));
const pickerAt = src.indexOf('function AssetPickerField(');
const picker = src.slice(pickerAt, pickerAt + 2500);
check('the picker never browses it', /isGeneralAsset\(a\)\)\.map\(a => a\.id\)/.test(picker));
check('the picker offers "No asset" only when asked, and maps it to the catch-all id',
  picker.includes('allowNone') && picker.includes('onChange(id || GENERAL_ASSET_ID)') && picker.includes('noneLabel={allowNone'));
const taskPickerAt = src.indexOf('hint="Which asset is this task for?"');
check('the task dialog asks for it', src.slice(taskPickerAt, taskPickerAt + 80).includes('allowNone'));
const workPickerAt = src.indexOf('<AssetPickerField', src.indexOf('changeModal.mode === "add"') );
check('the Log work dialog does not', !src.slice(workPickerAt, workPickerAt + 400).includes('allowNone'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
