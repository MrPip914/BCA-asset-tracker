// Guards the owner-only "View as" (2026-10-20). The silent failures:
//   * a non-owner getting a target (the owner check dropped from viewingAs);
//   * a write path that ignores View as (persist, viewState, the two signers);
//   * canEdit / the viewer's views not following the target;
//   * the target surviving sign-out.
// Run: node test-frontend-view-as.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name); ok ? pass++ : fail++; };
const has = s => src.includes(s);
const body = (start, len = 900) => { const i = src.indexOf(start); return i < 0 ? '' : src.slice(i, i + len); };

check('target requires the owner', /const viewingAs = \(viewAsIsOwner && viewAsEmail\)/.test(src));
check('owner = real session email equals ownerEmail, never in Sandbox',
  /viewAsIsOwner = !sandboxMode && !!auth && !!auth\.ownerEmail/.test(src));
check('canEdit follows the target', has('viewingAs ? viewingAs.role !== "viewer"'));
check('persist refuses while viewing as', /async function persist[\s\S]{0,6000}if \(viewingAs\) \{/.test(src));
check('viewState refuses', /async function saveViewState[\s\S]{0,900}if \(viewingAs\)/.test(src));
check('photo signing refuses', /async function signPhotoUploads\(count\) \{\s*\n\s*if \(viewingAs\)/.test(src));
check('floor plan signing refuses', /async function signFloorPlanUpload\(\) \{\s*\n\s*if \(viewingAs\)/.test(src));
check('views and [CURRENT USERNAME] follow the target',
  has('viewingAs ? viewingAs.email : (auth ? auth.email') && has('viewingAs ? (viewingAs.name || viewingAs.email)'));
check('sign-out clears the target', /setAuth\(null\);\s*\n\s*setViewAsEmail\(null\)/.test(src));
check('menu row only for the owner', /\{viewAsIsOwner && \(\s*\n\s*<div[\s\S]{0,400}View as…/.test(src));
check('persistent banner with an exit', has('Viewing as {viewingAs.name || viewingAs.email}') && has('aria-label="Exit View as"'));
check('picker excludes the owner themself', has('!== String(auth.email).toLowerCase()).map('));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
