// Live refresh (DATABASE_BACKEND_PLAN.md, Phase 2a): other people's saves
// appear without a reload. The pure helpers run for real; the wiring is read
// as source, because the parts that fail SILENTLY are gates -- the Supabase-only
// check (an Apps Script backend reads an unknown op as a SAVE), the hold while
// someone is editing (a refresh under an open draft turns a conflict into a
// quiet overwrite), and the guard against applying a read older than a save
// this device just made.
//
// Run: node test-frontend-live-refresh.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};

function grab(name) {
  let i = src.indexOf(`function ${name}(`);
  if (i === -1) throw new Error(`${name} not found`);
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error(`${name} not closed`);
}
const constLine = name => {
  const m = src.match(new RegExp(`const ${name} = [^;]+;`));
  if (!m) throw new Error(`${name} not found`);
  return m[0];
};
const mod = {};
new Function('module', [
  constLine('REVISION_DOMAINS'),
  grab('normalizeRevisions'),
  grab('revisionsMoved'),
  grab('revisionsBehind'),
  grab('liveRefreshHeld'),
  'Object.assign(module, { revisionsMoved, revisionsBehind, liveRefreshHeld });',
].join('\n'))(mod);
const { revisionsMoved, revisionsBehind, liveRefreshHeld } = mod;

// ---- the comparison ----
const held = { assets: 4, config: 2, breakerTypes: 1, photos: 0 };
check('nothing moved is not a change', !revisionsMoved({ ...held }, held));
check('any one domain moving is a change', revisionsMoved({ ...held, photos: 1 }, held));
check('a LOWER server number is not a change to pick up', !revisionsMoved({ ...held, assets: 3 }, held));
check('garbage from the server is read as 0, never as a change', !revisionsMoved({ assets: 'x', config: null }, held));
check('a read behind this device is spotted', revisionsBehind({ ...held, assets: 3 }, held));
check('a read level with or ahead of this device is not behind',
  !revisionsBehind({ ...held }, held) && !revisionsBehind({ ...held, config: 9 }, held));

// ---- the hold ----
const doc = (activeElement, overlay) => ({
  activeElement,
  querySelector: sel => (overlay && sel.includes('position: fixed') && sel.includes('inset: 0') ? {} : null),
});
check('idle: not held', !liveRefreshHeld({}, doc(null, false)));
check('an inline form is held', liveRefreshHeld({ formOpen: true }, doc(null, false)));
check('a write in flight is held', liveRefreshHeld({ writing: true }, doc(null, false)));
check('any overlay (modal or menu) is held', liveRefreshHeld({}, doc(null, true)));
check('typing in a text field is held', liveRefreshHeld({}, doc({ tagName: 'INPUT', type: 'text' }, false)));
check('typing in a textarea is held', liveRefreshHeld({}, doc({ tagName: 'TEXTAREA' }, false)));
check('a focused checkbox is not typing', !liveRefreshHeld({}, doc({ tagName: 'INPUT', type: 'checkbox' }, false)));
check('a focused button is not typing', !liveRefreshHeld({}, doc({ tagName: 'BUTTON' }, false)));
// The overlay selector has to match how React writes the style attribute.
check('the overlay selector matches the app\'s own overlays',
  /\[style\*="position: fixed"\]\[style\*="inset: 0"\]/.test(grab('liveRefreshHeld'))
  && (src.match(/position: "fixed", inset: 0/g) || []).length >= 40);

// ---- the wiring ----
check('Supabase only', /const LIVE_REFRESH_SUPPORTED = CLIENT\.backend === "supabase";/.test(src));
const effectStart = src.indexOf('const liveRefreshRef = useRef(');
const effect = src.slice(effectStart, src.indexOf('}, []);', effectStart));
check('the effect bails out when unsupported, before any timer', /if \(!LIVE_REFRESH_SUPPORTED\) return undefined;[\s\S]*window\.setInterval/.test(effect));
check('the revisions op is the only thing sent on a check', /op: "revisions"/.test(effect));
check('a refresh is a read that writes nothing', /op: "read"[\s\S]{0,120}_dirty: \{ assets: false, config: false, breakerTypes: false, photos: false \}/.test(effect));
check('hidden tabs do not check', /document\.visibilityState !== "visible"\) return;/.test(effect));
check('a refresh re-checks the hold before applying', /if \(held\(\) \|\| revisionsRef\.current !== heldRevisions \|\| revisionsBehind\(data\.revisions, revisionsRef\.current\)\) return;\s*latest\.applySnapshot\(data\);/.test(effect));
check('a pending refresh waits while held', /if \(r\.pending\) \{\s*if \(held\(\)\) return;/.test(effect));
check('a sign-in failure goes through loadData, which signs out properly', (effect.match(/authFailed\) \{[^}]*loadData\(\)/g) || []).length === 2);
check('an older backend is asked once, not every minute', /isn't available/.test(effect) && /r\.unsupported = true/.test(effect));
check('the inline forms are named in the hold', ['detailEditing', 'showAdd', 'commentDraft', 'addBreakerDraft', 'showPanelConfig', 'saveFailure']
  .every(n => new RegExp(`formOpen:[^}]*${n}`).test(src.slice(effectStart, effectStart + 1600))));
check('no retries on a background check', /const NO_RETRY = \{ delays: \[\]/.test(effect));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
