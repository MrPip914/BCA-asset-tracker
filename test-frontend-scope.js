// The location navigator (scopeId) survives a refresh: it is written
// to the address bar and to localStorage, and read back with the URL winning.
// Runs the real helpers out of index.html.
//
// Silent failures guarded: the tenant (`c=`) or the asset params being dropped
// when the scope is written; a scope left in the URL after it is cleared (a
// reload would re-apply a filter the user removed); the storage fallback
// overriding an explicit URL; a retired `exact` param lingering; the history STATE being replaced (it carries navDepth/backTo/homeDepth).
//
// Run: node test-frontend-scope.js   (exits non-zero on failure)
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
const win = { location: {}, history: {}, localStorage: null };
const store = {};
win.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
let replaced = null;
win.history = { state: { navDepth: 2, backTo: 'X' }, replaceState: (st, _t, url) => { replaced = { st, url }; } };
const code = ['const SCOPE_STORAGE_KEY = "scope-key";', grabFn('readInitialScope'), grabFn('persistScope'),
  'return { readInitialScope, persistScope };'].join('\n');
const { readInitialScope, persistScope } = new Function('window', code)(win);
function at(search) { win.location = { pathname: '/index.html', search: search || '', hash: '' }; }

let passed = 0, failed = 0;
function eq(name, a, e) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : `\n        expected ${JSON.stringify(e)}\n        got      ${JSON.stringify(a)}`));
  ok ? passed++ : failed++;
}

at('?c=dev&scope=B1&exact=1');
eq('reads the scope from the URL, ignoring a retired exact param', readInitialScope(), { scopeId: 'B1' });

store['scope-key'] = JSON.stringify({ scopeId: 'S1', scopeExact: true });
at('?c=dev');
eq('falls back to storage with no scope in the URL (old entry shape still reads)', readInitialScope(), { scopeId: 'S1' });
at('?scope=B1');
eq('an explicit URL scope beats storage', readInitialScope(), { scopeId: 'B1' });
store['scope-key'] = '{not json';
at('');
eq('corrupt storage starts unscoped', readInitialScope(), { scopeId: '' });
delete store['scope-key'];
eq('nothing anywhere starts unscoped', readInitialScope(), { scopeId: '' });

at('?c=dev&asset=A1&tab=details');
persistScope('B1');
eq('writing keeps the tenant and asset params, adds scope',
  replaced.url, '/index.html?c=dev&asset=A1&tab=details&scope=B1');
eq('the history state is passed through untouched', replaced.st, { navDepth: 2, backTo: 'X' });
eq('storage is written too', JSON.parse(store['scope-key']), { scopeId: 'B1' });

at('?c=dev&scope=B1&exact=1');
persistScope('B1');
eq('an old link\'s exact param is stripped', replaced.url, '/index.html?c=dev&scope=B1');

at('?c=dev&scope=B1&exact=1');
persistScope('');
eq('clearing the scope clears it (and exact), keeps the tenant', replaced.url, '/index.html?c=dev');
eq('clearing the scope clears storage', 'scope-key' in store, false);

replaced = null;
at('?c=dev');
persistScope('');
eq('no change to the URL means no history write', replaced, null);

// The one thing a unit test can't see: that the component actually wires these.
eq('the component seeds scopeId from readInitialScope', /useState\(initialScopeRef\.current\.scopeId\)/.test(src), true);
eq('the component persists on change', /persistScope\(scopeId\)/.test(src), true);
eq('"Hide children" is gone', /scopeExact|Hide children —/.test(src), false);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
