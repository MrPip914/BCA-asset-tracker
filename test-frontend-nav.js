// Unit test for the browser-history navigation added alongside the labelled
// back control -- specifically navUrl(), which builds every URL the app now
// writes into the address bar.
//
// Two rules here fail SILENTLY if they regress, which is why they are tested
// rather than eyeballed:
//
//   1. navUrl() must preserve every param it was not asked to change. The one
//      that matters today is `c`/`client`: drop it and a dev or second-school
//      session silently re-resolves to the DEFAULT tenant on the next reload,
//      with nothing on screen saying so -- someone would be looking at
//      Brookside's live data believing they were on dev. Writing the tenant out
//      by name here would work and would be wrong: it puts a second copy of the
//      CLIENT.urlParam() rule in the file, to go stale the day a third param
//      exists. Preserving everything is what makes that impossible.
//   2. navUrl(null) must CLEAR the detail params rather than leave them. A URL
//      naming an asset while the list is on screen reopens that asset on the
//      next reload -- and the case that produces it is an asset deleted out
//      from under a history entry, i.e. exactly when the id is dead.
//
// The history-walking itself (push vs replace, Back landing on the previous
// asset, the depth guard that stops a deep-link arrival leaving the site) is
// browser behaviour and cannot be covered here -- it was verified by driving
// the real page in Chromium, which is the only place popstate exists.
//
// Run: node test-frontend-nav.js   (exits non-zero on failure)
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

// The real functions out of the real file, not a copy of them.
const code = [grabFn('navUrl'), grabFn('historyEntry'), 'return { navUrl, historyEntry };'].join('\n');
const { navUrl, historyEntry } = new Function('window', code)(globalThis.__win = {});

// navUrl reads window.location; nothing else about the page is needed.
function at(pathname, search, hash) {
  globalThis.__win.location = { pathname, search: search || '', hash: hash || '' };
}

let passed = 0, failed = 0;
function eq(name, actual, expected) {
  const ok = actual === expected;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : `\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`));
  ok ? passed++ : failed++;
}

// --- rule 1: params that aren't ours survive ------------------------------
at('/index.html', '?c=dev');
eq('the tenant survives opening an asset',
  navUrl('BCA0001', 'details'), '/index.html?c=dev&asset=BCA0001&tab=details');
eq('the tenant survives returning to the list',
  navUrl(null, null), '/index.html?c=dev');

at('/index.html', '?client=stama');
eq('the long-form ?client= is preserved too, not just ?c=',
  navUrl('BCA0001', 'audit'), '/index.html?client=stama&asset=BCA0001&tab=audit');

at('/index.html', '?c=dev&somethingnew=1');
eq('a param this code has never heard of still rides along',
  navUrl('BCA0001', null), '/index.html?c=dev&somethingnew=1&asset=BCA0001');

// --- rule 2: our own params are replaced, never accumulated ---------------
at('/index.html', '?asset=OLD&tab=breakers&c=dev');
eq('navigating to another asset replaces the old one rather than appending',
  navUrl('NEW', 'details'), '/index.html?c=dev&asset=NEW&tab=details');
eq('returning to the list clears BOTH detail params',
  navUrl(null, null), '/index.html?c=dev');

at('/index.html', '?asset=OLD&tab=breakers');
eq('with no other params the list URL carries no query string at all',
  navUrl(null, null), '/index.html');

// --- shape details --------------------------------------------------------
at('/index.html', '?asset=OLD&tab=breakers');
eq('a tab is omitted when there is none, rather than written empty',
  navUrl('NEW', null), '/index.html?asset=NEW');
eq('a tab is never written without an asset to hang it on',
  navUrl(null, 'breakers'), '/index.html');

at('/dev/', '?c=dev');
eq('the /dev/ build keeps its own path',
  navUrl('BCA0001', 'details'), '/dev/?c=dev&asset=BCA0001&tab=details');

at('/index.html', '?c=dev', '#somewhere');
eq('a hash is carried through',
  navUrl('BCA0001', null), '/index.html?c=dev&asset=BCA0001#somewhere');

at('/index.html', '');
eq('an id containing URL-significant characters is encoded',
  navUrl('a b&c=d', null), '/index.html?asset=a+b%26c%3Dd');

// --- the history entry shape ---------------------------------------------
const e = historyEntry(2, 'BCA0001', 'details', 'BCR0006');
eq('an entry records its depth', e.navDepth, 2);
eq('an entry records where Back goes', e.backTo, 'BCR0006');
const list = historyEntry(0, null, null, null);
eq('a list entry has no asset', list.asset, null);
eq('a list entry has no backTo', list.backTo, null);
eq('undefined is normalised to null, so popstate never sees a hole',
  historyEntry(1, 'BCA0001', undefined, undefined).tab, null);

// homeDepth is what lets the home control collapse the stack in one move. It is
// normalised rather than passed through because 0 is a MEANINGFUL value here --
// the list is usually at depth 0 -- so a truthiness test would read the most
// common case as "no list beneath" and send every home tap down the rebuild-in-
// place path, landing on an unfiltered list at the top instead of the one the
// user left.
eq('a list at depth 0 is recorded as 0, not lost as falsy',
  historyEntry(3, 'BCA0001', 'details', null, 0).homeDepth, 0);
eq('a deeper list depth is kept as given',
  historyEntry(5, 'BCA0001', 'details', null, 2).homeDepth, 2);
eq('no list beneath (a link opened cold) is null',
  historyEntry(0, 'BCA0001', 'details', null, null).homeDepth, null);
eq('an omitted homeDepth is null rather than undefined',
  historyEntry(0, 'BCA0001', 'details', null).homeDepth, null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
