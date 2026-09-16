// Two caches sit in front of the slowest parts of a page load, and BOTH fail
// silently when they fail at all.
//
// The transpile cache runs the app from a previously compiled copy of itself.
// The snapshot cache paints a previously loaded copy of the inventory. Neither
// throws when it goes wrong -- one runs the wrong CODE, the other shows the
// wrong DATA, and both look exactly like a fast, working app.
//
// The browser behaviour (cache hits, injection, the revalidate swap) was
// verified by driving the real page in Chromium, which is the only place Cache
// Storage exists. What is checked HERE is the set of structural properties that
// make that behaviour safe -- the ones a later edit could drop without any test
// or any browser noticing.
//
// Run: node test-frontend-cache.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};

const SRC = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// Slice a named function body out of the source. Crude brace matching is enough
// here: these are all plain declarations at a known indent.
function body(decl) {
  const at = SRC.indexOf(decl);
  if (at === -1) return '';
  // Start scanning AFTER the parameter list. `persist(nextAssets, overrides = {})`
  // has a brace in its own signature, and starting at the first one returns the
  // empty default value instead of the function -- which reads as "the guard is
  // missing" for every check below it.
  let i = SRC.indexOf('{', at + decl.length), depth = 0;
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (!depth) return SRC.slice(i, j + 1); }
  }
  return '';
}

// ---------------------------------------------------------------------------
// The transpile cache
// ---------------------------------------------------------------------------

// The app source must NOT be type="text/babel". That is what Babel Standalone's
// own auto-runner scans for -- leave it and the file is transpiled twice, once
// by the runner and once by the loader, and the app mounts twice with it.
const beforeLoader = SRC.slice(0, SRC.indexOf('TRANSPILE CACHE'));
check('the app source is not left as a text/babel tag',
  /<script type="text\/x-babel-source" id="app-source">/.test(SRC)
  // Everything before the loader, so its comment quoting the tag it replaced
  // is not mistaken for the tag itself.
  && !/<script type="text\/babel"/.test(beforeLoader),
  'the loader owns transpiling; the auto-runner must never also pick this up');

// Babel Standalone is loaded lazily or the cache saves a transform and still
// pays 598KB over the wire plus 2.87MB of parsing for a file it never uses.
check('Babel is not loaded eagerly in <head>',
  !/<script src="https:\/\/unpkg\.com\/@babel[^>]*><\/script>/.test(SRC),
  'the whole point of a hit is that Babel is never fetched');

// Babel's auto-runner passes a NON-EMPTY default plugins list. Dropping it here
// changes the emitted code while everything still appears to work -- read out of
// babel.min.js rather than guessed, and restated here so a later tidy-up of the
// options object cannot quietly delete it.
const loader = SRC.slice(SRC.indexOf('TRANSPILE CACHE'));
['transform-class-properties', 'transform-object-rest-spread', 'transform-flow-strip-types'].forEach(plugin => {
  check(`the transform still passes Babel's own default plugin "${plugin}"`,
    loader.includes(`"${plugin}"`),
    'the auto-runner defaults these in; omitting one silently emits different code');
});
check('the transform still asks for the react preset',
  /presets: \["react"\]/.test(loader));

// The hash is of the SOURCE. Any hand-maintained key (APP_VERSION, a date) can
// be forgotten, and a forgotten bump here does not show a stale label -- it runs
// stale code.
check('the cache key is a hash of the source, not a hand-bumped version',
  /crypto\.subtle\.digest\("SHA-256"/.test(loader)
  && /hashSource\(source\)/.test(loader)
  && /key = "\/transpiled\/" \+ hex;/.test(loader),
  'a content hash cannot be forgotten; a version constant can');

// Every failure has to land on the path this file has always taken.
check('a missing Cache Storage or crypto.subtle falls through to transpiling',
  /if \(!window\.caches \|\| !window\.crypto \|\| !crypto\.subtle\) return null;/.test(loader),
  'an insecure context must still boot, just without the shortcut');
check('an empty or truncated cache entry is re-transpiled rather than run',
  /if \(!code\) return transpileAndRun/.test(loader),
  'running a truncated module is a silent white screen');
check('the app is injected as an INLINE module script',
  /el\.type = "module";/.test(loader) && /el\.text = code;/.test(loader)
  && !/createObjectURL/.test(loader),
  'bare specifiers resolve against the document import map; a blob URL is a different document');
check('a start-up failure says something instead of leaving a blank page',
  /function fail\(/.test(loader) && /root\.textContent = /.test(loader));

// ---------------------------------------------------------------------------
// The snapshot cache
// ---------------------------------------------------------------------------

const loadDataBody = body('async function loadData()');
const persistBody = body('async function persist(nextAssets, overrides = {})');
const endSessionBody = body('function endSession(error, manualSignOut)');

// THE FOUR GUARDS. Each rules out a case where server truth is the entire point
// of the call, and losing any one of them is silent.
check('the cached paint is skipped in sandbox mode',
  /!sandboxMode &&/.test(loadDataBody), 'sandbox has its own local copy and never fetches');
check('the cached paint is skipped during a fresh Google sign-in',
  /!authIdToken &&/.test(loadDataBody),
  'sessionId may still name the EXPIRED session being replaced, whose cache is not this user\'s');
check('the cached paint requires a session id to key on',
  /sessionId && assets === null/.test(loadDataBody));
// The sharpest of the four: the conflict handler reloads precisely BECAUSE the
// state in memory is wrong. Handing it a cache would defeat the reload and leave
// the user looking at the edit that was just rejected.
check('the cached paint happens on the FIRST load only (assets === null)',
  /assets === null/.test(loadDataBody),
  'the conflict path and the sandbox toggle both reload to escape bad state');

check('a cached paint reads through the same applySnapshot as a fresh one',
  /applySnapshot\(cached\)/.test(loadDataBody) && /applySnapshot\(data\)/.test(loadDataBody),
  'two readers of one payload would drift; migrations must run on a cached load too');

// Ordering: a sign-in adopts a NEW session id inside applySnapshot, and the
// snapshot has to be stored under the id the next load will present.
const applyAt = loadDataBody.indexOf('applySnapshot(data);');
const writeAt = loadDataBody.indexOf('writeSnapshotCache(');
check('the snapshot is cached AFTER applySnapshot adopts the new session',
  applyAt !== -1 && writeAt !== -1 && writeAt > applyAt,
  'storing it first would key a fresh sign-in under the session it replaced');

check('a failed revalidation keeps the cached view instead of the error screen',
  /if \(paintedFromCache\) \{\s*setStaleSnapshot\(true\);\s*\} else \{\s*setLoadError\(true\);/.test(loadDataBody),
  'a flaky connection is when a local copy is worth the most');

// The write guard. The revision counters would CATCH a stale save, but being
// refused is not the same as not being invited.
check('persist() refuses to write while the snapshot is unconfirmed',
  /if \(revalidating \|\| staleSnapshot\) \{/.test(persistBody),
  'nothing the cache paints may reach the Sheet before the server copy arrives');
const guardAt = persistBody.indexOf('if (revalidating || staleSnapshot)');
const fetchAt = persistBody.indexOf('writeSnapshot(');
check('that refusal comes BEFORE the write is attempted',
  guardAt !== -1 && fetchAt !== -1 && guardAt < fetchAt);

check('signing out erases the cached inventory',
  /clearSnapshotCache\(\);/.test(endSessionBody),
  'a session id is erased from localStorage already; the inventory it named must go too');

// Tenant AND session, both halves. One origin serves every school.
check('the cache key carries the tenant and the session',
  /"\/snapshot\/" \+ encodeURIComponent\(CLIENT\.id\) \+ "\/" \+ encodeURIComponent\(id\)/.test(SRC),
  'the tenant is the CLIENT.storageKey() rule; the session is what makes a new sign-in a miss');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
