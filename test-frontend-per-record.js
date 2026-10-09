// Per-record saves (DATABASE_BACKEND_PLAN.md, Phase 2b), the app's half. The
// pure helpers run for real; the wiring is read as source, because what fails
// SILENTLY here are gates and orderings -- an Apps Script tenant sent a body
// with no asset list, a version read when the save was QUEUED rather than when
// it was SENT, and a domain revision adopted that someone else bumped.
//
// Run: node test-frontend-per-record.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};
function grab(name) {
  const i = src.indexOf(`function ${name}(`);
  if (i === -1) throw new Error(`${name} not found`);
  let depth = 0;
  // From the BODY's brace, not a default parameter's `= {}`.
  for (let k = src.indexOf(') {', i) + 2; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error(`${name} not closed`);
}
const stmt = (start) => {
  const i = src.indexOf(start);
  if (i === -1) throw new Error(`${start} not found`);
  return src.slice(i, src.indexOf('];', i) + 2);
};
const mod = {};
new Function('module', [
  'const REVISION_DOMAINS = ["assets", "config", "breakerTypes", "photos"];',
  grab('normalizeRevisions'),
  grab('assetChangesBetween'),
  grab('auditAppendOf'),
  stmt('const CONFIG_PAYLOAD_KEYS = ['),
  grab('perRecordBody'),
  grab('adoptSavedRevisions'),
  'Object.assign(module, { assetChangesBetween, auditAppendOf, perRecordBody, adoptSavedRevisions });',
].join('\n'))(mod);
const { assetChangesBetween, auditAppendOf, perRecordBody, adoptSavedRevisions } = mod;

check('the REVISION_DOMAINS the test uses are the app\'s',
  /const REVISION_DOMAINS = \["assets", "config", "breakerTypes", "photos"\];/.test(src));

// ---- what changed ----
const a = { id: 'a', name: 'A' }, b = { id: 'b', name: 'B' }, c = { label: 'C1' };
const prev = [a, b, c];
const edited = { ...b, name: 'B2' };
let ch = assetChangesBetween(prev, [a, edited, c]);
check('an edited asset is the only upsert', ch && ch.upsert.length === 1 && ch.upsert[0] === edited && ch.remove.length === 0);
ch = assetChangesBetween(prev, [a, c]);
check('a removed asset is named by its key', ch && ch.upsert.length === 0 && ch.remove.join() === 'b');
ch = assetChangesBetween(prev, [a, b]);
check('an asset with no id is keyed by its label', ch && ch.remove.join() === 'C1');
const fresh = { id: 'n', name: 'New' };
ch = assetChangesBetween(prev, [...prev, fresh]);
check('a new asset is an upsert', ch && ch.upsert.length === 1 && ch.upsert[0] === fresh);
check('the same entries in a fresh array name nothing -- the whole snapshot is sent instead',
  assetChangesBetween(prev, prev.slice()) === null);
check('a reorder alone names nothing', assetChangesBetween(prev, [c, b, a]) === null);

// ---- the audit log ----
const e1 = { action: 'x' }, e2 = { action: 'y' }, e3 = { action: 'z' };
check('appended entries are found', JSON.stringify(auditAppendOf([e1, e2], [e1, e2, e3])) === JSON.stringify([e3]));
check('no new entries is an empty list, not a fallback', auditAppendOf([e1], [e1]).length === 0);
check('an empty log grows', auditAppendOf([], [e1]).length === 1);
check('a log replaced since (the full history fetched) is a fallback', auditAppendOf([e1, e2], [{ ...e1 }, { ...e2 }, e3]) === null);
check('a SHORTER log is a fallback', auditAppendOf([e1, e2], [e1]) === null);

// ---- the body ----
const payload = { assets: prev, columns: [1], changeTypes: [2], vendors: [], peripheralsList: [], usersList: [],
  bulkItemTypes: [], typesList: [], typeSettings: {}, typeCategories: [], nextAssetNumber: 7,
  breakerTypes: [3], photos: [4], auditLog: [e1], auditBase: 0 };
const dirtyAssets = { assets: true, config: false, breakerTypes: false, photos: false };
let body = perRecordBody(payload, dirtyAssets, { upsert: [edited], remove: [] }, []);
check('an assets-only save carries no asset list, no log, no other domain',
  !('assets' in body) && !('auditLog' in body) && !('auditBase' in body) && !('columns' in body) && !('photos' in body) && !('breakerTypes' in body));
check('...and carries the changes and the appended entries', body.assetChanges && Array.isArray(body.auditAppend));
body = perRecordBody(payload, { assets: false, config: true, breakerTypes: false, photos: true }, null, []);
check('a config save restates every config key, as the backend expects of one',
  ['columns', 'changeTypes', 'vendors', 'peripheralsList', 'usersList', 'bulkItemTypes', 'typesList', 'typeSettings', 'typeCategories', 'nextAssetNumber']
    .every(k => k in body) && body.photos === payload.photos && !('breakerTypes' in body));
check('a save naming no asset marks assets clean', body._dirty.assets === false && !('assetChanges' in body));
check('the allowlist is sent only when the payload carries it', !('authUsers' in body)
  && perRecordBody({ ...payload, authUsers: [] }, { assets: false, config: true }, null, []).authUsers !== undefined);
// The config keys the app restates are the ones the backend writes.
const saveTs = fs.readFileSync(path.join(__dirname, 'supabase/functions/asset-api/save.ts'), 'utf8');
const writes = [...saveTs.slice(saveTs.indexOf('const CONFIG_WRITES'), saveTs.indexOf('];', saveTs.indexOf('const CONFIG_WRITES'))).matchAll(/\["(\w+)"/g)].map(m => m[1]);
check('every config key the backend writes is sent', writes.length > 5 && writes.every(k => body[k] !== undefined), writes.join());

// ---- adopting revisions ----
const held = { assets: 4, config: 2, breakerTypes: 1, photos: 0 };
const w = { assets: true, config: false, breakerTypes: false, photos: false };
check('a written domain one past what was held is adopted', adoptSavedRevisions(held, { ...held, assets: 5 }, w).assets === 5);
check('a written domain someone ELSE also bumped is kept -- live refresh fetches it', adoptSavedRevisions(held, { ...held, assets: 6 }, w).assets === 4);
check('a domain this save did NOT write is never adopted', adoptSavedRevisions(held, { ...held, assets: 5, config: 3 }, w).config === 2);

// ---- the wiring ----
check('Supabase only', /const PER_RECORD_SAVES = CLIENT\.backend === "supabase";/.test(src));
const persist = grab('persist');
check('per record only off the sandbox path (sandbox returns first)',
  persist.indexOf('if (sandboxMode)') !== -1 && persist.indexOf('if (sandboxMode)') < persist.indexOf('const assetChanges = PER_RECORD_SAVES'));
check('an assets change nothing names falls back to the whole snapshot',
  /const perRecord = PER_RECORD_SAVES && \(!dirty\.assets \|\| assetChanges\) && appended !== null;/.test(persist));
check('versions are read when the save is SENT, inside the queue',
  /writeQueueRef\.current\.then\(\(\) => \{[\s\S]*?const revOf = id => assetRevsRef\.current\.get\(id\);[\s\S]*?return writeSnapshot\(sent\)/.test(persist));
check('new versions are stamped inside the chain, before the next save starts',
  /return writeSnapshot\(sent\)\.then\(\s*\(result\) => \{[\s\S]*?assetRevsRef\.current\.set\(id, rev\)[\s\S]*?return result;/.test(persist));
const finish = grab('finishWrite');
check('a per-record save adopts revisions through adoptSavedRevisions', /if \(perRecordDirty\) \{\s*const adopted = adoptSavedRevisions\(/.test(finish));
check('finishWrite is told which domains a per-record save wrote', /finishWrite\(result, null, saveContext, perRecord \? body\._dirty : null\)/.test(persist));
const apply = grab('applySnapshot');
check('a read\'s _rev is kept OFF the asset', /\.map\(\(\{ _rev, \.\.\.a \}\) =>/.test(apply));
check('and the read replaces the version map', /assetRevsRef\.current = readRevs;/.test(apply));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
