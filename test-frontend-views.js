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
  'return { adoptViews, viewsVisibleTo, viewFieldsFor, viewFieldValue, viewFieldDisplay, viewConditionMatches, viewMatches, describeViewQuery, orderViewRows, moveInViewOrder, addToViewOrder, removeFromViewOrder, viewTaskKey, viewDialogShows, viewVisibleCustomKeys, viewDragOrder, viewBoard, viewBoardMove, viewBucketIdIn, viewBucketOf, viewBuckets, viewLiveMatches, viewLiveActive, viewCanArrange, viewCondChanged, viewOpsFor, viewFieldEntry, viewKindOf, viewValueMode, viewGroups, viewGroupKeyOf, viewGroupMove, viewTokenAllowed, viewItemsMatch, adoptViewConds };',
].join(NL);
const H = new Function(code)();

const model = {
  taskTypes: [{ id: "tt-a", name: "Repair" }], taskTypeSettings: {}, workTypeSettings: {}, workFields: [],
  taskFields: [{ key: "cf_zone", label: "Zone", dataType: "multiselect", options: ["Roof", "Gym"] }, { key: "cf_psi", label: "PSI", dataType: "number", options: [] }, { key: "cf_day", label: "Day", dataType: "select", options: ["Mon", "Tue", "Wed"] }, { key: "cf_when", label: "When", dataType: "date", options: [] }],
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


// ---- Follow-up 2026-10-18 (b): card titles open, buffer, split schedule pieces, clean read view
{
  const html = src;
  const kb = html.slice(html.indexOf('function KanbanBoard'), html.indexOf('function ViewLiveFilterPanel'));
  check('a Kanban card title opens the task even while cards drag', /data-card-title/.test(kb) && /tappedIn\("\[data-card-title\]"\)/.test(kb));
  check('a Kanban column keeps space below its last card', /paddingBottom: 72/.test(kb));
  check('the sort hook drops only a real drag, not a tap', /s\.moved && t\.group !== null/.test(html));
  eq('the old schedule tick expands to its pieces', H.adoptViews({ list: [{ id: 'a', dialogFields: ['schedule', 'notes', 'dueDate'] }] }).list[0].dialogFields, ['frequency', 'lastPerformed', 'dueDate', 'notes']);
  check('schedule is no longer a tick of its own', !/key: "schedule"/.test(html));
  check('the read-only task view has no kind toggle or inputs', /viewReadOnly \? \(\s*<div[^>]*>\s*<div[^>]*>\{maintenanceDraft\.task\}/.test(html));
}

// --- before / after / less than / greater than (2026-10-19)
{
  const d = (iso) => ({ toISOString: () => iso + "T00:00:00.000Z" });
  const dueRow = iso => row("t", { due: iso ? d(iso) : null });
  const m = (c, r, cx = ctx) => H.viewConditionMatches(c, r, model, cx);
  eq('a date field offers is / is not / before / after', H.viewOpsFor(H.viewFieldEntry(model, [], "dueDate")), ["=", "!=", "before", "after"]);
  eq('a custom date field does too', H.viewKindOf(H.viewFieldEntry(model, [], "custom:cf_when")), "date");
  eq('text offers only is / is not, and the live filter adds contains', [H.viewOpsFor(H.viewFieldEntry(model, [], "owner")), H.viewOpsFor(H.viewFieldEntry(model, [], "owner"), true)], [["=", "!="], ["has", "=", "!="]]);
  eq('number, choice, multi and board offer less / greater than',
    ["custom:cf_psi", "custom:cf_day", "custom:cf_zone"].map(k => H.viewOpsFor(H.viewFieldEntry(model, [], k))), [["=", "!=", "<", ">"], ["=", "!=", "<", ">"], ["=", "!=", "<", ">"]]);
  check('due before a date', m(cond("dueDate", "before", "2026-11-01"), dueRow("2026-10-15")));
  check('...not on the day itself', !m(cond("dueDate", "before", "2026-10-15"), dueRow("2026-10-15")));
  check('due after a date', m(cond("dueDate", "after", "2026-10-01"), dueRow("2026-10-15")) && !m(cond("dueDate", "after", "2026-10-15"), dueRow("2026-10-15")));
  check('a task with no date is neither before nor after', !m(cond("dueDate", "before", "2026-11-01"), dueRow(null)) && !m(cond("dueDate", "after", "2026-01-01"), dueRow(null)));
  check('no date picked matches nothing', !m(cond("dueDate", "before", ""), dueRow("2026-10-15")));
  check('a custom date field compares too', m(cond("custom:cf_when", "after", "2026-01-01"), row("t", { custom: { cf_when: "2026-05-05" } })));
  check('a number custom field: greater and less than', m(cond("custom:cf_psi", ">", "9"), row("t", { custom: { cf_psi: "10" } })) && !m(cond("custom:cf_psi", "<", "9"), row("t", { custom: { cf_psi: "10" } })) && m(cond("custom:cf_psi", "<", "10.5"), row("t", { custom: { cf_psi: "10" } })));
  check('...numbers compare as numbers, not text', m(cond("custom:cf_psi", ">", "9"), row("t", { custom: { cf_psi: "100" } })));
  check('...a blank or non-numeric value matches neither', !m(cond("custom:cf_psi", "<", "9"), row("t")) && !m(cond("custom:cf_psi", ">", "9"), row("t", { custom: { cf_psi: "abc" } })));
  check('a choice list counts its entries 1, 2, 3', m(cond("custom:cf_day", ">", "Mon"), row("t", { custom: { cf_day: "Wed" } })) && m(cond("custom:cf_day", "<", "Wed"), row("t", { custom: { cf_day: "Tue" } })) && !m(cond("custom:cf_day", ">", "Wed"), row("t", { custom: { cf_day: "Wed" } })));
  check('...a value not in the list matches neither', !m(cond("custom:cf_day", ">", "Mon"), row("t", { custom: { cf_day: "Sat" } })) && !m(cond("custom:cf_day", ">", "Sat"), row("t", { custom: { cf_day: "Wed" } })));
  check('a multiple choice matches when ANY pick is past the entry', m(cond("custom:cf_zone", ">", "Roof"), row("t", { custom: { cf_zone: "Roof; Gym" } })) && !m(cond("custom:cf_zone", "<", "Roof"), row("t", { custom: { cf_zone: "Roof; Gym" } })));
  const wk = board({ assignments: { "A1::t": "b-tue" } });
  const bctx = { userName: "", views: [wk], seen: [] };
  check('a Kanban counts its columns 1, 2, 3 left to right (default first)', m(cond("kanban:kb", ">", "b-mon"), row("t"), bctx) && !m(cond("kanban:kb", "<", "b-mon"), row("t"), bctx) && m(cond("kanban:kb", ">", "__default"), row("t"), bctx));
  check('...a task in the default column is column 1', m(cond("kanban:kb", "<", "b-mon"), row("u"), bctx));
  check('...a task the board does not list matches neither', !m(cond("kanban:kb", ">", "__default"), row("t"), { userName: "", views: [board({ conditions: [cond("owner", "=", "zz")] })], seen: [] }));
  check('a comparison on a field that cannot do it matches nothing', !m(cond("owner", ">", "a"), row("t", { owner: "b" })) && !m(cond("owner", "before", "2026-01-01"), row("t", { owner: "2025-01-01" })));
  eq('the new comparisons survive being stored and read back', H.adoptViews({ list: [{ id: "a", conditions: ["before", "after", "<", ">", "has", "x"].map(op => ({ field: "dueDate", op, value: "v" })) }] }).list[0].conditions.map(c => c.op), ["before", "after", "<", ">", "=", "="]);
  eq('the query reads in words', H.describeViewQuery(view([cond("dueDate", "before", "2026-11-01"), cond("custom:cf_psi", ">", "9")]), model), 'Due date is before "2026-11-01" and PSI is greater than "9"');
  const E = k => H.viewFieldEntry(model, [], k);
  eq('changing to a field that cannot do the comparison falls back to is', H.viewCondChanged(cond("dueDate", "before", "2026-11-01"), { field: "owner" }, E("dueDate"), E("owner"), false), { ...cond("owner", "=", ""), });
  eq('switching between less-than and is clears a typed-in number', H.viewCondChanged(cond("custom:cf_day", "=", "mon*"), { op: ">" }, E("custom:cf_day"), E("custom:cf_day"), false).value, "");
  eq('switching less-than to greater-than keeps the value', H.viewCondChanged(cond("custom:cf_day", "<", "Tue"), { op: ">" }, E("custom:cf_day"), E("custom:cf_day"), false).value, "Tue");
  eq('a date line shows a date picker, text keeps wildcards', [H.viewValueMode("date", "="), H.viewValueMode("text", "="), H.viewValueMode("number", "="), H.viewValueMode("number", "<"), H.viewValueMode("choice", ">"), H.viewValueMode("choice", "=")], ["date", "text", "text", "number", "option", "text"]);
  check('the value box is a date picker for a date field', /mode === "date" \|\| mode === "number"\) \{\s*return <input type=\{mode\}/.test(src));
  check('both editors use the one value box and the one op list', (src.match(/<ViewValueInput /g) || []).length >= 2 && /viewOpsFor\(f, true\)/.test(src) && /viewOpsFor\(entryOf\(c\.field\)\)/.test(src));
}

// --- grouping, and the [DAY OF WEEK] token (2026-10-20)
{
  const g = (extra, rows) => H.viewGroups(view([], extra), rows, model, ctx);
  const keysOf = (extra, rows) => (g(extra, rows) || []).map(x => x.key);
  const by = (owner, id) => row(id, { owner });
  const rs = [by("Cy", "a"), by("Al", "b"), by("", "c"), by("Bo", "d"), by("Al", "e")];
  eq('an ungrouped view has no groups', g({}, rs), null);
  eq('a field that no longer exists reads as ungrouped', g({ groupBy: "custom:cf_gone" }, rs), null);
  eq('groups run ascending, with the blank group last', keysOf({ groupBy: "owner" }, rs), ["Al", "Bo", "Cy", ""]);
  eq('descending flips them but the blank group stays last', keysOf({ groupBy: "owner", groupDir: "desc" }, rs), ["Cy", "Bo", "Al", ""]);
  eq('a task joins the group of its value', g({ groupBy: "owner" }, rs)[0].rows.map(r => r.item.id), ["b", "e"]);
  eq('the blank group is labelled for the field', g({ groupBy: "owner" }, rs)[3].label, "No owner");
  eq('pinned groups come first, in the pinned order, then the rest by direction',
    keysOf({ groupBy: "owner", groupOrder: ["Cy", "Bo"] }, rs), ["Cy", "Bo", "Al", ""]);
  eq('the blank group can be pinned to the front', keysOf({ groupBy: "owner", groupOrder: ["__none"] }, rs), ["", "Al", "Bo", "Cy"]);
  eq('a pinned group with no tasks is simply absent', keysOf({ groupBy: "owner", groupOrder: ["Zed", "Cy"] }, rs), ["Cy", "Al", "Bo", ""]);
  const day = (d, id) => row(id, { custom: { cf_day: d } });
  eq('a choice list groups in the list order, not alphabetically', keysOf({ groupBy: "custom:cf_day" }, [day("Wed", "a"), day("Mon", "b"), day("Tue", "c")]), ["Mon", "Tue", "Wed"]);
  eq('...and descending reverses that', keysOf({ groupBy: "custom:cf_day", groupDir: "desc" }, [day("Wed", "a"), day("Mon", "b"), day("Tue", "c")]), ["Wed", "Tue", "Mon"]);
  const num = (n, id) => row(id, { custom: { cf_psi: n } });
  eq('numbers group numerically', keysOf({ groupBy: "custom:cf_psi" }, [num("100", "a"), num("9", "b"), num("20", "c")]), ["9", "20", "100"]);
  const dueRow = (iso, id) => row(id, { due: new Date(iso + "T12:00:00Z") });
  eq('dates group chronologically, labelled as dates', [keysOf({ groupBy: "dueDate" }, [dueRow("2026-11-02", "a"), dueRow("2026-10-05", "b")]), g({ groupBy: "dueDate" }, [dueRow("2026-10-05", "b")])[0].label], [["2026-10-05", "2026-11-02"], "D:2026-10-05"]);
  eq('a multiple choice groups by its first pick', keysOf({ groupBy: "custom:cf_zone" }, [row("a", { custom: { cf_zone: "Gym; Roof" } }), row("b", { custom: { cf_zone: "Roof" } })]), ["Roof", "Gym"]);
  const kb = board({ assignments: { "A1::a": "b-tue", "A1::b": "b-mon" } });
  const gctx = { userName: "", views: [kb], seen: [] };
  eq('a Kanban field groups in column order, labelled by column name',
    H.viewGroups(view([], { groupBy: "kanban:kb" }), [row("a"), row("b"), row("c")], model, gctx).map(x => [x.key, x.label]), [["__default", "Backlog"], ["b-mon", "Monday"], ["b-tue", "Tuesday"]]);
  eq('moving a group down pins everything shown in the new order',
    H.viewGroupMove(view([], { groupBy: "owner" }), ["Al", "Bo", "Cy", ""], "Al", 1), ["Bo", "Al", "Cy", "__none"]);
  eq('...and keeps pinned groups that have no tasks behind', H.viewGroupMove(view([], { groupOrder: ["Zed"] }), ["Al", "Bo"], "Bo", -1), ["Bo", "Al", "Zed"]);
  eq('moving the first group up is a no-op', H.viewGroupMove(view([], { groupOrder: ["x"] }), ["Al", "Bo"], "Al", -1), ["x"]);
  eq('grouping is stored and read back', (({ groupBy, groupDir, groupOrder }) => ({ groupBy, groupDir, groupOrder }))(H.adoptViews({ list: [{ id: "a", groupBy: " owner ", groupDir: "desc", groupOrder: ["x", 3, ""] }] }).list[0]), { groupBy: "owner", groupDir: "desc", groupOrder: ["x"] });
  eq('a view with none reads as ungrouped, ascending', (({ groupBy, groupDir, groupOrder }) => ({ groupBy, groupDir, groupOrder }))(H.adoptViews({ list: [{ id: "a", groupDir: "weird", groupBy: 5 }] }).list[0]), { groupBy: "", groupDir: "asc", groupOrder: [] });

  // a grouped Kanban: same group order in every column, each card in its own group
  const gb = board({ groupBy: "owner", assignments: { "A1::a": "b-mon", "A1::b": "b-mon", "A1::c": "b-mon" } });
  const gr = [by("Cy", "a"), by("Al", "b"), by("Al", "c"), by("Bo", "d")];
  const gbd = H.viewBoard(gb, gr, model, ctx);
  eq('a grouped column reads group by group', gbd.find(c => c.id === "b-mon").groups.map(x => [x.key, x.rows.map(r => r.item.id)]), [["Al", ["b", "c"]], ["Cy", ["a"]]]);
  eq('a column with none of a group omits it, the others keep their order', gbd.find(c => c.id === "__default").groups.map(x => x.key), ["Bo"]);
  eq('an ungrouped board has no groups', H.viewBoard(board(), gr, model, ctx)[0].groups, undefined);
  let mv = H.viewBoardMove(gb, gbd, "A1::c", "b-mon", 0, gbd.find(c => c.id === "b-mon").groups[0].rows);
  eq('a drop inside its own group orders that group only', mv.order, ["A1::c"]);
  mv = H.viewBoardMove(gb, gbd, "A1::d", "b-tue", 0, null);
  eq('a drop outside its own group moves the bucket and orders nothing', [mv.assignments["A1::d"], mv.order], ["b-tue", []]);

  // [DAY OF WEEK]
  const monday = new Date(2026, 9, 19, 12), friday = new Date(2026, 9, 23, 12);
  const wkb = board({ assignments: { "A1::t": "b-mon" } });
  const dctx = now => ({ userName: "", views: [wkb], seen: [], now });
  const tok = (f, op) => cond(f, op, "", "and", "DAY_OF_WEEK");
  check('the token is one an editor can pick and a stored view keeps', H.adoptViews({ list: [{ id: "a", conditions: [{ field: "owner", token: "DAY_OF_WEEK" }] }] }).list[0].conditions[0].token === "DAY_OF_WEEK");
  eq('the token reads as its own name in the query', H.describeViewQuery(view([tok("owner", "=")]), model), "Owner is [DAY OF WEEK]");
  check('against a text field it is today\'s weekday', H.viewConditionMatches(tok("owner", "="), row("t", { owner: "monday" }), model, dctx(monday)) && !H.viewConditionMatches(tok("owner", "="), row("t", { owner: "monday" }), model, dctx(friday)));
  check('against a choice list it matches the entry spelled that way', H.viewConditionMatches(tok("custom:cf_day", "="), row("t", { custom: { cf_day: "Friday" } }), model, dctx(friday)));
  check('against a Kanban it means the column of that name', H.viewConditionMatches(tok("kanban:kb", "="), row("t"), model, dctx(monday)) && !H.viewConditionMatches(tok("kanban:kb", "="), row("t"), model, dctx(friday)));
  check('...and is not means every card outside it', !H.viewConditionMatches(tok("kanban:kb", "!="), row("t"), model, dctx(monday)) && H.viewConditionMatches(tok("kanban:kb", "!="), row("t"), model, dctx(friday)));
  check('...a day with no column of that name matches nothing for is', !H.viewConditionMatches(tok("kanban:kb", "="), row("u"), model, dctx(friday)));
  eq('every weekday has a name', [0, 1, 2, 3, 4, 5, 6].map(i => H.viewConditionMatches(tok("owner", "="), row("t", { owner: ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][i] }), model, dctx(new Date(2026, 9, 18 + i, 12)))), [true, true, true, true, true, true, true]);
  eq('a token is offered for text and for a Kanban is / is not, not for dates or less-than', [H.viewTokenAllowed("text", "="), H.viewTokenAllowed("board", "!="), H.viewTokenAllowed("board", "<"), H.viewTokenAllowed("date", "before"), H.viewTokenAllowed("choice", ">")], [true, true, false, false, false]);
  eq('switching a token line to a comparison that cannot take one drops the token', H.viewCondChanged(tok("kanban:kb", "="), { op: ">" }, H.viewFieldEntry(model, [wkb], "kanban:kb"), H.viewFieldEntry(model, [wkb], "kanban:kb"), false).token, "");

  // wiring
  check('the list groups into sections with a heading each', /data-group-heading/.test(src) && /viewGroups\(view, rows, model, ctx\)/.test(src));
  check('the board splits each column and orders inside the card\'s own group', /col\.groups \?/.test(src) && /g\.key === viewGroupKeyOf\(view, row, model, ctx\)/.test(src));
  check('the editor can pick the field, the direction and move groups', /Group tasks by/.test(src) && /viewGroupMove\(draft/.test(src) && /Move group \$\{g\.label\} up/.test(src));
  check('Sandbox carries a grouped view and a [DAY OF WEEK] one', /groupBy: "owner"/.test(src) && /token: "DAY_OF_WEEK"/.test(src));
}


// --- nested groups
const grp = (conditions, join = "and") => ({ group: true, join, conditions });
{
  const g1 = view([grp([cond("owner", "=", "X"), cond("owner", "=", "Y", "or")]), grp([cond("status", "=", "On track")], "and")]);
  eq('(A or B) and (C) resolves by the groups', rows3.filter(r => H.viewMatches(g1, r, model, ctx)).map(r => r.item.id), ["a"]);
  const g2 = view([grp([cond("owner", "=", "X"), cond("owner", "=", "Y", "or")]), cond("status", "=", "On track")]);
  eq('a group beside a plain line', rows3.filter(r => H.viewMatches(g2, r, model, ctx)).map(r => r.item.id), ["a"]);
  const g3 = view([cond("owner", "=", "Z"), grp([cond("owner", "=", "X"), cond("status", "=", "On track")], "or")]);
  eq('a group joined with or', rows3.filter(r => H.viewMatches(g3, r, model, ctx)).map(r => r.item.id), ["a", "c"]);
  const g4 = view([grp([cond("owner", "=", "X"), grp([cond("owner", "=", "Q"), cond("status", "=", "On track", "or")])])]);
  eq('groups nest', rows3.filter(r => H.viewMatches(g4, r, model, ctx)).map(r => r.item.id), ["a"]);
  const g5 = view([cond("owner", "=", "X"), grp([])]);
  eq('an empty group is ignored', rows3.filter(r => H.viewMatches(g5, r, model, ctx)).map(r => r.item.id), ["a"]);
  eq('only empty groups shows every task', rows3.filter(r => H.viewMatches(view([grp([])]), r, model, ctx)).length, 3);
  eq('a group reads in brackets', H.describeViewQuery(g1, model), '(Owner is "X" or Owner is "Y") and (Status is "On track")'.replace(/^\(Owner is "X" or Owner is "Y"\) and /, '(Owner is "X" or Owner is "Y") and '));
  const a = H.adoptViewConds([cond("owner", "=", "X"), { group: true, join: "or", conditions: [{ field: "" }, cond("owner", "=", "Y"), { group: true, conditions: [cond("owner", "=", "Z")] }] }, { group: 1 }], 0);
  eq('adoption keeps nested groups and drops junk', a, [cond("owner", "=", "X"), { group: true, join: "or", conditions: [cond("owner", "=", "Y"), { group: true, join: "and", conditions: [cond("owner", "=", "Z")] }] }]);
  const deep = H.adoptViewConds([grp([grp([grp([grp([cond("owner", "=", "X")])])])])], 0);
  eq('nesting past the limit is dropped', JSON.stringify(deep).split('"group"').length - 1, 3);
  const src = require("fs").readFileSync("index.html", "utf8");
  check('the editor offers Add a group', /Add a group/.test(src) && /renderConds\(draft\.conditions/.test(src));
}
{
  const src = require("fs").readFileSync("index.html", "utf8");
  const i = src.indexOf('mainTab === "views" && activeView && canEdit');
  const blk = i < 0 ? "" : src.slice(i, i + 2600);
  check('the Views tab has a + for editors', i > 0);
  check('it offers task, asset and work', /openMaintenanceAdd\(""\)/.test(blk) && /startAdd\(\)/.test(blk) && /openChangeAdd\(""\)/.test(blk));
  check('the add-asset form opens as a dialog on Views', /mainTab === "views" && activeView && showAdd/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
