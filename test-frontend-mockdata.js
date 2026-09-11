// Guards the wiring between index.html and mock-data.js.
//
// The Sandbox fixture moved out of index.html on 2026-09-11. Nothing about the
// fixture changed -- it was verified deep-equal to the inline version at the time
// -- so what is worth testing forever is not its contents (other tests cover
// those) but the four joints the move created, three of which fail in places you
// would not be looking:
//
//   * The PUBLISH STEP. index.html reads MOCK_SNAPSHOT at module scope, so a
//     mock-data.js that is not published is not a broken Sandbox, it is a blank
//     app -- and only on the published site, which is the one place nobody is
//     running a test. The workflow asserts the file is in the artifact; this
//     asserts the workflow still asserts it.
//   * The SCRIPT TAG. Same failure, reached from the other side.
//   * The FACTORY SIGNATURE. The fixture names three things that belong to
//     index.html. Adding a fourth to the fixture without adding it to the call
//     site is a bare ReferenceError naming the constant but not the reason.
//   * The DECLARATION NAMES. test-frontend-assetid.js and test-frontend-photos.js
//     slice this fixture out as SOURCE TEXT. They anchor to a line start, because
//     the first version of mock-data.js's header quoted the declaration and the
//     tests matched the comment -- the fixture then evaluated as prose, and the
//     error pointed at the middle of an English sentence.
//
// Run: node test-frontend-mockdata.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const idx = read('index.html');
const mock = read('mock-data.js');
const wf = read(path.join('.github', 'workflows', 'pages.yml'));

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name);
  if (!ok) console.log(`        got ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
};

// ------------------------------------------------------------------ publishing
eq('the publish workflow requires mock-data.js in the artifact',
   /for required in [^\n]*\bmock-data\.js\b/.test(wf), true);

eq('index.html loads mock-data.js as a classic script',
   /<script src="mock-data\.js"><\/script>/.test(idx), true);

// It has to come BEFORE the babel module that calls the factory, or the call runs
// against an undefined global. Comparing offsets is the whole check.
eq('mock-data.js is loaded before the babel module that calls it',
   idx.indexOf('<script src="mock-data.js">') < idx.indexOf('<script type="text/babel"'), true);

// -------------------------------------------------------------- factory shape
const params = (mock.match(/window\.MOCK_DATA_FOR = function \(\{([^}]*)\}\)/) || [])[1];
const args = (idx.match(/window\.MOCK_DATA_FOR\(\{([^}]*)\}\)/) || [])[1];
eq('mock-data.js exports a MOCK_DATA_FOR factory', typeof params, 'string');
eq('index.html calls that factory', typeof args, 'string');

const split = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean).sort();
eq('the call site passes exactly the parameters the factory destructures',
   split(args), split(params));

// Each of those is defined in index.html and NOT in mock-data.js -- that is the
// reason the factory exists rather than a plain object.
for (const name of split(params)) {
  eq(`${name} is still defined in index.html`,
     new RegExp(`(const|let|function)\\s+${name}\\b`).test(idx), true);
}

// -------------------------------------------------- declarations stay sliceable
for (const decl of ['const MOCK_SNAPSHOT = {', 'const MOCK_PHOTOS = [']) {
  eq(`mock-data.js declares ${decl.split(' ')[1]} at the start of a line`,
     mock.includes('\n' + decl), true);
  // A comment quoting the declaration would be matched by an UNANCHORED search,
  // which is how this broke the first time. Nothing may precede it on its line.
  const quoted = mock.split('\n').some((l) => l.includes(decl) && l.trim().startsWith('//'));
  eq(`no comment in mock-data.js quotes the ${decl.split(' ')[1]} declaration`, quoted, false);
}

// --------------------------------------------------------------- it evaluates
// Cheapest possible proof that the file is not merely present but runnable, and
// that the fixture still has the shape Sandbox needs.
const win = {};
new Function('window', mock)(win);
const snap = win.MOCK_DATA_FOR({
  FRONTEND_SCRIPT_VERSION: '(test)',
  SEEDED_BREAKER_TYPES: [],
  relate: () => '',
});
eq('the factory returns a snapshot with assets', Array.isArray(snap.assets) && snap.assets.length > 0, true);
eq('...and photos', Array.isArray(snap.photos) && snap.photos.length > 0, true);
eq('...and an audit log', Array.isArray(snap.auditLog) && snap.auditLog.length > 0, true);
// The fixture is deliberately MIXED on asset ids; that is what the id-adoption
// path is tested against, so a fixture that lost the mix would quietly halve the
// coverage of test-frontend-assetid.js without failing it.
eq('the fixture still mixes assets that carry an id with ones that do not',
   snap.assets.some((a) => a.id && a.id !== a.label) && snap.assets.some((a) => !a.id), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
