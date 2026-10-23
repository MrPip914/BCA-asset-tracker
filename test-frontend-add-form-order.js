// The add form renders from BOTH the list view and the asset page's floating +.
// AssetTracker is one function body, so a `const` declared BELOW the detail
// view's early return is in its temporal dead zone when the asset page calls
// renderAddForm(): "Cannot access 'addFormColumns' before initialization" and a
// white screen. Only the list view ever worked, which is how it shipped.
// This pins the declaration ahead of that return.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
let failed = 0;
function check(name, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; }

const decl = src.indexOf('const addFormColumns = ');
const detailReturn = src.indexOf('if (view === "detail" && selectedAsset) {');
check('addFormColumns is declared once', decl !== -1 && src.indexOf('const addFormColumns = ', decl + 1) === -1);
check('detail view early return exists', detailReturn !== -1);
check('addFormColumns is declared before the detail view returns', decl < detailReturn);
process.exit(failed ? 1 : 0);
