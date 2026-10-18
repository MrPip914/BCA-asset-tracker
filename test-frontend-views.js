// Views (saved task lists): the real pure helpers sliced out of index.html, plus
// source checks on the wiring that cannot be exercised without a browser.
// Run: node test-frontend-views.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};
const eq = (name, a, e) => check(name, JSON.stringify(a) === JSON.stringify(e), `expected ${JSON.stringify(e)}\n        got      ${JSON.stringify(a)}`);
const NL = src.includes('\r\n') ? '\r\n' : '\n';
function slice(decl) {
  const start = src.indexOf(decl);
  if (start === -1) throw new Error(decl + ' not found');
  const end = src.indexOf(NL + '}' + NL, start);
  return src.slice(start, end + NL.length + 1);
}
const block = src.slice(src.indexOf('// ---------- VIEWS (2026-10-17)'), src.indexOf('// ---------- AUDIT: ASSOCIATED RESOURCES'));
const code = [
  'const C = { danger: "r", accent: "a", success: "g", muted: "m" };',
  'const TASK_KIND_ONEOFF = "oneoff";',
  'const DEFAULT_WORK_TYPE_ID = "__default"; const DEFAULT_WORK_TYPE_NAME = "Default";',
  'const dateOnly = s => String(s || "").slice(0, 10);',
  'const localDateString = d => d.toISOString().slice(0, 10);',
  'const formatDateOnly = s => "D:" + s;',
  'const isOneOffTask = item => item.kind === "oneoff";',
  'const dataTypeDisplay = (f, v) => String(v);',
  slice('function multiValues(value) {'),
  slice('function resolveWorkTypeId(model, kind, typeId) {'),
  slice('function defaultWorkTypeId(model, kind) {'),
  slice('function taskTypeNameOf(model, id) {'),
  slice('function maintenanceSortKey(row) {'),
  slice('function maintenanceStatusMeta(status) {'),
  block,
  'return { adoptViews, viewsVisibleTo, viewFieldsFor, viewFieldValue, viewFieldDisplay, viewConditionMatches, viewMatches, describeViewQuery, orderViewRows, moveInViewOrder, addToViewOrder, removeFromViewOrder, viewTaskKey, viewDialogShows, viewVisibleCustomKeys, viewDragOrder, viewBoard, viewBoardMove, viewBucketIdIn, viewBucketOf, viewBuckets, viewLiveMatches, viewLiveActive, viewCanArrange };',
].join(NL);
const H = new Function(code)();

const model = {
  taskTypes: [{ id: "tt-a", name: "Repair" }], taskTypeSettings: {}, workTypeSettings: {}, workFields: [],
  taskFields: [{ key: "cf_zone", label: "Zone", dataType: "multiselect", options: ["Roof", "Gym"] }, { key: "cf_psi", label: "PSI", dataType: "number", options: [] }],
};
const row = (id, o = {}) => ({
  asset: { id: "A1" }, assetName: "Room 1", status: o.status || "ok", due: o.due || null,
  item: { id, task: o.task || id, owner: o.owner || "", kind: o.kind || "scheduled", taskType: o.taskType || "", custom: o.custom || {}, frequencyLabel: "Monthly", notes: "", lastPerformed: "" },
});
const view = (conditions, extra = {}) => ({ id: "v", name: "V", userEmails: [], conditions, columns: [], dialogFields: [], order: [], ...extra });
const cond = (field, op, value, join = "and", token = "") => ({ field, op, value, token, join });

// --- reading stored data
const v = H.adoptViews({ list: [
  { id: "x", name: "N", userEmails: ["A@B.com ", 5], conditions: [{ field: "owner", op: "weird", value: 3, token: "NOPE", join: "xor" }, { field: "" }, null], columns: "bad", order: ["k", 7] },
  { name: "no id" }, null,
] });
eq('a view without an id is dropped', v.list.length, 1);
eq('emails are lowercased and trimmed, junk dropped', v.list[0].userEmails, ["a@b.com"]);
eq('a bad op reads as =, a bad join as and, an unknown token as none, a number value as text',
  v.list[0].conditions, [{ field: "owner", op: "=", value: "3", token: "", join: "and" }]);
eq('columns that are not a list read as the defaults', v.list[0].columns, ["task", "asset", "dueDate", "status"]);
eq('order keeps only strings', v.list[0].order, ["k"]);
eq('nothing stored reads as an empty list', H.adoptViews(undefined).list, []);

// --- who sees a view
const list = [view([], { id: "1", userEmails: ["a@x.com"] }), view([], { id: "2", userEmails: ["b@x.com"] })];
eq('a person sees only the views naming their email (any case)', H.viewsVisibleTo(list, "A@X.com", false).map(x => x.id), ["1"]);
eq('nobody signed in sees nothing', H.viewsVisibleTo(list, "", false), []);
eq('Sandbox sees every view', H.viewsVisibleTo(list, "", true).length, 2);

// --- conditions
const ctx = { userName: "Jane  Smith" };
check('= ignores case and spacing', H.viewConditionMatches(cond("owner", "=", "jane smith"), row("t", { owner: "Jane Smith" }), model, ctx));
check('!= is the opposite', !H.viewConditionMatches(cond("owner", "!=", "jane smith"), row("t", { owner: "Jane Smith" }), model, ctx));
check('[CURRENT USERNAME] compares to the signed-in name', H.viewConditionMatches(cond("owner", "=", "", "and", "CURRENT_USERNAME"), row("t", { owner: "jane smith" }), model, ctx));
check('...and does not match someone else', !H.viewConditionMatches(cond("owner", "=", "", "and", "CURRENT_USERNAME"), row("t", { owner: "Bob" }), model, ctx));
check('a token with no name known matches nothing for =, even a blank owner',
  !H.viewConditionMatches(cond("owner", "=", "", "and", "CURRENT_USERNAME"), row("t", { owner: "" }), model, { userName: "" }));
check('...and everything for !=', H.viewConditionMatches(cond("owner", "!=", "", "and", "CURRENT_USERNAME"), row("t", { owner: "Bob" }), model, { userName: "" }));
check('a blank value matches a blank field', H.viewConditionMatches(cond("owner", "=", ""), row("t"), model, ctx));
check('status compares by the label people read', H.viewConditionMatches(cond("status", "=", "overdue"), row("t", { status: "overdue" }), model, ctx));
check('a multiple-choice custom field matches when any pick matches', H.viewConditionMatches(cond("custom:cf_zone", "=", "gym"), row("t", { custom: { cf_zone: "Roof; Gym" } }), model, ctx));
check('...and != needs none of them to', !H.viewConditionMatches(cond("custom:cf_zone", "!=", "gym"), row("t", { custom: { cf_zone: "Roof; Gym" } }), model, ctx));
check('a task with no type reads as Default', H.viewConditionMatches(cond("type", "=", "default"), row("t"), model, ctx));
check('a named type matches by name', H.viewConditionMatches(cond("type", "=", "repair"), row("t", { taskType: "tt-a" }), model, ctx));
check('a field that no longer exists reads blank', H.viewConditionMatches(cond("custom:cf_gone", "=", ""), row("t"), model, ctx));
eq('a due date is compared as ISO text', H.viewFieldValue(row("t", { due: new Date("2026-10-20T12:00:00Z") }), "dueDate", model), "2026-10-20");

// --- AND binds tighter than OR
const rows3 = [row("a", { owner: "X", status: "ok" }), row("b", { owner: "Y", status: "overdue" }), row("c", { owner: "Z", status: "ok" })];
const q = view([cond("owner", "=", "X"), cond("status", "=", "On track", "and"), cond("owner", "=", "Y", "or")]);
eq('A and B or C is (A and B) or C', rows3.filter(r => H.viewMatches(q, r, model, ctx)).map(r => r.item.id), ["a", "b"]);
const q2 = view([cond("owner", "=", "X"), cond("owner", "=", "Y", "or"), cond("status", "=", "On track", "and")]);
eq('A or B and C is A or (B and C)', rows3.filter(r => H.viewMatches(q2, r, model, ctx)).map(r => r.item.id), ["a"]);
eq('no conditions shows every task', rows3.filter(r => H.viewMatches(view([]), r, model, ctx)).length, 3);
eq('the query reads in words', H.describeViewQuery(q, model), '(Owner is "X" and Status is "On track") or Owner is "Y"');
eq('a token reads as itself', H.describeViewQuery(view([cond("owner", "=", "", "and", "CURRENT_USERNAME")]), model), "Owner is [CURRENT USERNAME]");

// --- order
const o1 = row("o1", { due: new Date(3000) }), o2 = row("o2", { due: new Date(1000) }), o3 = row("o3", { due: new Date(2000) });
const k = r => H.viewTaskKey(r);
let ord = H.orderViewRows([o1, o2, o3], [k(o1), "A1::gone"]);
eq('ordered tasks come first; the rest follow due-soonest first', [...ord.ordered, ...ord.rest].map(r => r.item.id), ["o1", "o2", "o3"]);
ord = H.orderViewRows([o1, o2, o3], [k(o3), k(o1)]);
eq('ordered tasks keep the stored order, not the due order', ord.ordered.map(r => r.item.id), ["o3", "o1"]);
eq('a stale key (task gone) is skipped, not shown', H.orderViewRows([o1], ["A1::gone"]).ordered.length, 0);
eq('adding to the order appends once', H.addToViewOrder(H.addToViewOrder(["a"], "b"), "b"), ["a", "b"]);
eq('removing takes it out', H.removeFromViewOrder(["a", "b"], "a"), ["b"]);
eq('moving down swaps with the next visible one', H.moveInViewOrder(["a", "b", "c"], ["a", "b", "c"], "a", 1), ["b", "a", "c"]);
eq('moving swaps past a slot held by a task not on screen', H.moveInViewOrder(["a", "hidden", "b"], ["a", "b"], "b", -1), ["b", "hidden", "a"]);
eq('moving the first task up is a no-op', H.moveInViewOrder(["a", "b"], ["a", "b"], "a", -1), ["a", "b"]);

// --- the dialog
eq('no view shows every field', H.viewDialogShows(null, "notes"), true);
eq('a view shows only what it ticked', [H.viewDialogShows(view([], { dialogFields: ["notes"] }), "notes"), H.viewDialogShows(view([], { dialogFields: ["notes"] }), "owner")], [true, false]);
eq('visible custom keys come from the view', H.viewVisibleCustomKeys(view([], { dialogFields: ["notes", "custom:cf_psi"] })), ["cf_psi"]);
eq('no view means no restriction on custom fields', H.viewVisibleCustomKeys(null), null);

// --- wiring (browser behaviour is driven separately; these fail if a piece is dropped)
check('the Views section is an editors-only Settings section', /\{ key: "views", label: "Views", icon: Eye, editor: true \}/.test(src));
check('Views is a main tab', /const MAIN_TABS = \[[^\]]*"views"/.test(src));
check('the tab only appears when a view is assigned', /\.\.\.\(visibleViews\.length \? \[\{ key: "views", label: "Views" \}\] : \[\]\)/.test(src));
check('persist carries views as a config key', /views: nextViews = viewsCfg/.test(src) && /nextViews !== viewsCfg/.test(src) && /views: nextViews,/.test(src));
check('a per-record save sends views', /"workModel", "views", "nextAssetNumber"/.test(src));
check('a load adopts views', /setViewsCfg\(adoptViews\(data\.views\)\)/.test(src));
check('opening from a view passes the view id', /openMaintenanceEdit\(r\.item\.id, r\.asset\.id, activeView\.id\)/.test(src));
check('no Delete on a task opened from a view', /\{editing && !dialogView && \(\s*<button\s+onClick=\{\(\) => setConfirmMaintenanceDelete/.test(src));
check('the save validates only the fields the view shows', /viewVisibleCustomKeys\(viewsCfg\.list\.find\(v => v\.id === maintenanceModal\.viewId\)\)/.test(src));
check('a view-only person gets the dialog read-only', /<fieldset disabled=\{viewReadOnly\}/.test(src));
check('the Edge Function stores and reads the key', ['save.ts', 'inventory.ts'].every(f => /OPTIONAL_CONFIG_KEYS = \["workModel", "views"\]/.test(fs.readFileSync(path.join(__dirname, 'supabase/functions/asset-api', f), 'utf8'))));
check('Sandbox carries views', /views: \{ list: \[/.test(src));

// --- Kanban, drag order, live filter, who may arrange (2026-10-17 update)
const board = (extra = {}) => view([], { id: "kb", name: "Workweek", type: "kanban", defaultBucketName: "Backlog", buckets: [{ id: "b-mon", name: "Monday" }, { id: "b-tue", name: "Tuesday" }], assignments: {}, ...extra });
const ak = H.adoptViews({ list: [{ id: "k", name: "K", type: "kanban", viewersCanOrder: true, defaultBucketName: " Backlog ", buckets: [{ id: "b1", name: "Mon" }, { id: "", name: "x" }, null], assignments: { "A1::t": "b1", bad: 5 } }, { id: "l", name: "L", type: "weird" }] }).list;
eq('a Kanban reads its type, buckets, default name and assignments', [ak[0].type, ak[0].viewersCanOrder, ak[0].defaultBucketName, ak[0].buckets, ak[0].assignments], ["kanban", true, "Backlog", [{ id: "b1", name: "Mon" }], { "A1::t": "b1" }]);
eq('an unknown type reads as a list, and viewers cannot arrange unless ticked', [ak[1].type, ak[1].viewersCanOrder], ["list", false]);
eq('the default bucket leads, named by the view', H.viewBuckets(board()).map(b => b.name), ["Backlog", "Monday", "Tuesday"]);
eq('an unassigned task, and one in a removed bucket, sit in the default bucket',
  [H.viewBucketOf(board(), row("t")).id, H.viewBucketOf(board({ assignments: { "A1::t": "b-gone" } }), row("t")).id], ["__default", "__default"]);
const wk = board({ assignments: { "A1::t": "b-mon" } });
const kctx = { userName: "", views: [wk], seen: [] };
eq('another view can query a Kanban by bucket id', H.viewConditionMatches(cond("kanban:kb", "=", "b-mon"), row("t"), model, kctx), true);
eq('...and != Monday leaves out only the Monday card', [H.viewConditionMatches(cond("kanban:kb", "!=", "b-mon"), row("t"), model, kctx), H.viewConditionMatches(cond("kanban:kb", "!=", "b-mon"), row("u"), model, kctx)], [false, true]);
eq('a task the board does not list reads as blank', H.viewBucketIdIn(row("t"), "kb", model, { views: [board({ conditions: [cond("owner", "=", "zz")] })], seen: [] }), "");
const loop = [board({ id: "p", conditions: [cond("kanban:q", "=", "__default")] }), board({ id: "q", conditions: [cond("kanban:p", "=", "__default")] })];
eq('two boards that query each other end instead of recursing', typeof H.viewBucketIdIn(row("t"), "p", model, { views: loop, seen: [] }), "string");
check('a Kanban field is offered for every OTHER board only', H.viewFieldsFor(model, [wk], "kb").every(f => !f.kanban) && H.viewFieldsFor(model, [wk], "other").some(f => f.key === "kanban:kb" && f.label === "Workweek Kanban"));
eq('a Kanban query reads in words', H.describeViewQuery(view([cond("kanban:kb", "!=", "b-mon")]), model, [wk]), 'Workweek Kanban is not "Monday"');

// dragging in a list: everything down to the dropped task becomes ordered
eq('dropping the first of the unordered pile on top pins only it', H.viewDragOrder([], ["a", "b", "c"], 0, "a", 0), ["a"]);
eq('dropping the last at the top pins it first', H.viewDragOrder([], ["a", "b", "c"], 0, "c", 0), ["c"]);
eq('dropping into the unordered pile pins what is above it', H.viewDragOrder([], ["a", "b", "c"], 0, "a", 2), ["b", "c", "a"]);
eq('reordering ordered tasks keeps the count', H.viewDragOrder(["a", "b", "c"], ["a", "b", "c"], 3, "c", 0), ["c", "a", "b"]);
eq('a stored key not on screen keeps its slot', H.viewDragOrder(["a", "hid", "b"], ["a", "b"], 2, "b", 0), ["b", "hid", "a"]);
eq('an unknown key changes nothing', H.viewDragOrder(["a"], ["a"], 1, "zz", 0), ["a"]);

// the board and moving a card
const r1 = row("t1", { due: new Date(1000) }), r2 = row("t2", { due: new Date(2000) }), r3 = row("t3", { due: new Date(3000) });
const bv = board({ assignments: { "A1::t2": "b-mon", "A1::t3": "b-mon" }, order: [] });
const bd = H.viewBoard(bv, [r1, r2, r3]);
eq('cards land in their buckets', bd.map(c => c.rows.map(r => r.item.id)), [["t1"], ["t2", "t3"], []]);
let mv = H.viewBoardMove(bv, bd, "A1::t3", "b-mon", 0);
eq('dropping on top of a bucket pins it first', mv.order, ["A1::t3"]);
mv = H.viewBoardMove(bv, bd, "A1::t1", "b-tue", 0);
eq('moving to another bucket assigns it', [mv.assignments["A1::t1"], mv.order], ["b-tue", ["A1::t1"]]);
mv = H.viewBoardMove(bv, bd, "A1::t2", "__default", 0);
eq('moving back to the default stores nothing', ["A1::t2" in mv.assignments, mv.assignments["A1::t3"]], [false, "b-mon"]);
eq('a drop on a bucket that is gone changes nothing', H.viewBoardMove(bv, bd, "A1::t1", "b-gone", 0).assignments, bv.assignments);

// live filter
const lf = (text, conds = []) => ({ text, conds });
check('an empty live filter is inactive and matches all', !H.viewLiveActive(lf("  ")) && H.viewLiveMatches(lf(""), row("t"), view([]), model, ctx));
check('text matches the task name, ignoring case', H.viewLiveMatches(lf("FILT"), row("t", { task: "Change filter" }), view([]), model, ctx) && !H.viewLiveMatches(lf("zzz"), row("t", { task: "Change filter" }), view([]), model, ctx));
check('text matches the owner', H.viewLiveMatches(lf("bob"), row("t", { owner: "Bob R" }), view([]), model, ctx));
check('"has" is contains, and a stored query can never use it', H.viewLiveMatches(lf("", [{ field: "owner", op: "has", value: "ob" }]), row("t", { owner: "Bob" }), view([]), model, ctx) && /op === "has"/.test(src) && !/VIEW_OPS = \[[^\]]*"has"/.test(src));
check('every live line must hold', !H.viewLiveMatches(lf("", [{ field: "owner", op: "=", value: "Bob" }, { field: "status", op: "=", value: "overdue" }]), row("t", { owner: "Bob" }), view([]), model, ctx));
eq('editors always arrange; others only when the view allows', [H.viewCanArrange(view([]), true), H.viewCanArrange(view([]), false), H.viewCanArrange(view([], { viewersCanOrder: true }), false)], [true, false, true]);

// wildcards: * is any run of characters; a lone * is any non-blank value
const wc = (v, o = "=") => H.viewConditionMatches(cond("owner", o, v), row("t", { owner: "Jane Smith" }), model, ctx);
check('a trailing * matches a prefix', wc("jane*") && !wc("bob*"));
check('a leading and trailing * matches inside', wc("*e sm*"));
check('a lone * matches any value but not a blank one', wc("*") && !H.viewConditionMatches(cond("owner", "=", "*"), row("t", { owner: "" }), model, ctx));
check('is not with * flips it', !wc("jane*", "!=") && wc("bob*", "!="));
check('regex characters in a value are literal', !H.viewConditionMatches(cond("owner", "=", "j.ne*"), row("t", { owner: "Jane" }), model, ctx));
check('a value without * still has to match whole', !wc("jane"));

// wiring
check('the sidebar lists views with counts and is the first screen on a phone', /<nav aria-label="Views"/.test(src) && /aria-label="Back to views"/.test(src) && /viewPaneOpen/.test(src));
check('no per-task Set order button remains', !/Set order/.test(src));
check('tasks and views are ordered from an icon at the top right', /"Order tasks"/.test(src) && /"Order views"/.test(src));
check('a Kanban has no order button and its cards always drag', /canArrange && !kanban && \(/.test(src) && /const arranging = canArrange && \(kanban \|\| arrange\)/.test(src));
check('search is an icon on a phone until opened', /aria-label="Search this view"/.test(src) && /searchShown = !phone \|\| searchOpen/.test(src));
check('filter and order buttons carry no text label', !/ Filters\{filterCount/.test(src) && !/\{arranging \? "Done" : "Order"\}/.test(src));
check('a task from a view opens read-only with a pencil for editors', /editView/.test(src) && /Edit this task/.test(src) && /viewReadOnly = !!dialogView && \(!canEdit \|\| !maintenanceModal\.editView\)/.test(src));
check('arranging goes through the viewState op on Supabase', /op: "viewState"/.test(src) && /"viewState"/.test(fs.readFileSync(path.join(__dirname, 'supabase/functions/asset-api/api.ts'), 'utf8')));
check('the backend checks the permission from stored data', /viewersCanOrder === true/.test(fs.readFileSync(path.join(__dirname, 'supabase/functions/asset-api/save.ts'), 'utf8')));
check('the editor offers the checkbox, the type and buckets', /Viewers can change task order/.test(src) && /VIEW_TYPE_KANBAN/.test(src));
check('Sandbox carries a Kanban and a view that queries it', /type: "kanban"/.test(src) && /field: "kanban:view-week"/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
