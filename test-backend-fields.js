// Unit test for AssetTrackerSync.gs's customColumnKeys_ — the function that
// decides which custom columns get written to the Assets tab.
//
// It exists because this is the one piece the usual check can't reach: Sandbox
// mode never contacts Apps Script, and the live backend needs a Google sign-in,
// so "open it in a browser and try it" cannot cover the write path that used to
// drop every custom column value. Reads the .gs as text and evaluates just this
// function, so there is nothing to keep in sync.
//
// Run: node test-backend-fields.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'AssetTrackerSync.gs'), 'utf8');

const grab = (name) => {
  const i = src.indexOf(`function ${name}(`);
  if (i === -1) throw new Error(`${name} not found`);
  let depth = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
};
const fieldsSrc = src.slice(src.indexOf('const ASSET_FIELDS = ['), src.indexOf('];', src.indexOf('const ASSET_FIELDS = [')) + 2);
const mod = {};
new Function('module', fieldsSrc + '\n' + grab('customColumnKeys_') + '\nmodule.ASSET_FIELDS = ASSET_FIELDS; module.f = customColumnKeys_;')(mod);
const { f, ASSET_FIELDS } = mod;

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : `\n        got ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
};

eq('custom columns from the request',
   f([{ key: 'name' }, { key: 'col_a', custom: true }, { key: 'col_b', custom: true }], {}),
   ['col_a', 'col_b']);

eq('non-custom columns ignored',
   f([{ key: 'brand' }, { key: 'notes' }], {}),
   []);

eq('falls back to stored config when the request carries none',
   f(undefined, { columns: JSON.stringify([{ key: 'col_z', custom: true }]) }),
   ['col_z']);

eq('a custom key shadowing a schema field is dropped',
   f([{ key: 'serial', custom: true }, { key: 'col_ok', custom: true }], {}),
   ['col_ok']);

eq('duplicate custom keys are deduped',
   f([{ key: 'col_a', custom: true }, { key: 'col_a', custom: true }], {}),
   ['col_a']);

eq('garbage config does not throw', f(undefined, { columns: '{not json' }), []);
eq('missing config does not throw', f(undefined, {}), []);
eq('null body and null config', f(null, null), []);

console.log(`\nASSET_FIELDS has ${ASSET_FIELDS.length} fields; none of the six removed ones:`,
  ['room','building','campus','roomId','buildingId','itemName'].filter(k => ASSET_FIELDS.includes(k)).length === 0);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
