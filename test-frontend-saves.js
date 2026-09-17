// Saves happen in the BACKGROUND, and a failed one has to be recoverable after
// the user has moved on. Every failure mode here is silent:
//
//   - re-awaiting the write puts the frozen form back, and nothing looks wrong
//   - holding the submit lock for the round trip blocks unrelated controls
//   - losing the save context turns a recoverable failure into "it didn't save"
//   - RE-SENDING the restored draft overwrites whoever won the race, which is
//     the one thing the revision counters exist to prevent
//
// The behaviour itself (form closes in 48ms against a 4s backend, the modal,
// the restore, the double click) was verified by driving the real page in
// Chromium. What is checked here is the structure that keeps it true.
//
// Run: node test-frontend-saves.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};

const SRC = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function body(decl) {
  const at = SRC.indexOf(decl);
  if (at === -1) return '';
  let i = SRC.indexOf('{', at + decl.length), depth = 0;
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (!depth) return SRC.slice(i, j + 1); }
  }
  return '';
}

const persistBody = body('async function persist(nextAssets, overrides = {})');
const finishBody = body('async function finishWrite(result, err, saveContext)');
const restoreBody = body('function restoreFailedSave()');

// --- the write is enqueued, not awaited -------------------------------------
check('persist() hands the write off instead of awaiting it',
  /send\.then\(/.test(persistBody) && !/const result = await send;/.test(persistBody),
  'awaiting it again is the frozen form coming back');
check('the outcome is handled somewhere that runs after persist() returned',
  finishBody.length > 0 && /finishWrite\(/.test(persistBody));
check('the write queue still serializes the POSTs',
  /writeQueueRef\.current = send\.then/.test(persistBody),
  'overlapping full-snapshot writes can land out of order');

// --- the submit lock is tick-scoped ------------------------------------------
check('the submit lock clears on a macrotask, not when the write lands',
  /savingRef\.current = true;\s*setTimeout\(\(\) => \{ savingRef\.current = false; \}, 0\);/.test(persistBody),
  'holding it for the round trip blocks every unrelated control, attachPhotos included');
check('nothing clears the submit lock from the write outcome',
  !/savingRef/.test(finishBody));

// --- the failure carries what it needs to be recoverable ---------------------
check('persist() accepts a save context',
  /context: saveContext = null,/.test(persistBody));
check('both failure paths record it',
  (finishBody.match(/context: saveContext/g) || []).length >= 2,
  'a conflict and a transport failure are equally recoverable');
check('the context reaches the failure state before any form is closed',
  finishBody.indexOf('setSaveFailure({ kind: "conflict"') < finishBody.indexOf('setDetailEditing(false)'),
  'the conflict path closes mid-edit forms; capturing after that discards the draft');

// --- the asset edit form supplies one ----------------------------------------
const saveDraftBody = body('async function saveDraft()');
check('an edit names the asset it belonged to, so the failure can link back',
  /context: \{ assetId: original\.id, restore: \{ mode: "edit", draft: draftToSave \} \}/.test(saveDraftBody));
check('an add carries its draft but NO assetId',
  /context: \{ restore: \{ mode: "add", draft \} \}/.test(saveDraftBody),
  'a rejected add is rolled back, so there is no asset left to link to');

// --- THE dangerous one -------------------------------------------------------
// Restoring puts the typing back in the form. It must never post it: on a
// conflict that would overwrite whoever saved first.
check('restoring does NOT re-send anything',
  !/persist\(/.test(restoreBody) && !/writeSnapshot\(/.test(restoreBody),
  'an automatic retry is the overwrite the revision counters exist to prevent');
check('restoring seeds the FORM from the draft, not from the failed payload',
  /\{ \.\.\.restore\.draft, formError: "", errorFields: \[\] \}/.test(restoreBody),
  'replaying the payload would restore every asset, not the one being edited');
check('restoring opens the form so the person can see and send it themselves',
  /setDetailEditing\(true\)/.test(restoreBody) || /setShowAdd\(true\)/.test(restoreBody));
check('the offer is dropped when there is nothing to restore onto',
  /const canRestore = !!\(failedContext && failedContext\.restore/.test(SRC)
  && /failedContext\.restore\.mode === "add" \|\| failedAsset/.test(SRC),
  'the asset can have been deleted by whoever won the race');

// --- isSaving drives the pill and nothing else -------------------------------
check('isSaving no longer disables any control',
  !/disabled=\{[^}]*isSaving[^}]*\}/.test(SRC),
  'disabling the form the user moved ON to is the frozen feeling relocated');
check('isSaving no longer swaps any label',
  !/isSaving \? "Saving…"/.test(SRC));
check('isSaving is not threaded into child components any more',
  !/isSaving=\{isSaving\}/.test(SRC));
check('the pill still reports a write in flight',
  /: isSaving \? "saving"/.test(SRC));
check('the in-flight count is what clears it, not the first write home',
  /pendingWritesRef\.current = Math\.max\(0, pendingWritesRef\.current - 1\);/.test(finishBody)
  && /if \(pendingWritesRef\.current === 0\) setIsSaving\(false\);/.test(finishBody),
  'several writes can overlap now that nothing awaits them');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
