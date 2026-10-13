// Window pane layouts and the pane groups tasks name (plans/window-tracking.md).
//
// Runs the REAL pure helpers sliced out of index.html (group saving with the
// one-group-per-pane rule, task lookup of live groups, group deletion taking the
// group off tasks, the Map guard, the remap minimum), plus source checks on the
// wiring that cannot be executed outside the component.
//
// Run: node test-frontend-windows.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};

const NL = src.includes('\r\n') ? '\r\n' : '\n';
function sliceFn(decl) {
  const start = src.indexOf(decl);
  if (start === -1) throw new Error(decl + ' not found in index.html');
  const end = src.indexOf(NL + '}' + NL, start);
  return src.slice(start, end + NL.length + 1);
}
const sliceConst = decl => {
  const start = src.indexOf(decl);
  if (start === -1) throw new Error(decl + ' not found');
  return src.slice(start, src.indexOf(';' + NL, start) + 2);
};

const H = new Function(`
  const hasModule = (type, key) => type === "Window" && key === "windowLayout";
  ${sliceFn('function isWindowLayoutType(type) {')}
  ${sliceFn('function hasMapPlan(asset) {')}
  ${sliceFn('function windowGroupsOf(asset) {')}
  ${sliceFn('function windowGroupOfPane(groups, paneId) {')}
  ${sliceFn('function windowGroupsAfterSave(groups, draft, newId, stamp) {')}
  ${sliceFn('function taskPaneGroupsOf(asset, item) {')}
  ${sliceFn('function livePaneGroupIds(asset, ids) {')}
  ${sliceFn('function tasksWithoutPaneGroup(items, groupId) {')}
  ${sliceConst('const WINDOW_GROUP_COLORS = [')}
  ${sliceFn('function windowGroupColor(groups, groupId) {')}
  ${sliceFn('function windowBackdropNear(backdrop, spaces) {')}
  const floorPlanBbox = pts => { const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); const x = Math.min(...xs), y = Math.min(...ys); return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }; };
  return { isWindowLayoutType, hasMapPlan, windowGroupsOf, windowGroupOfPane, windowGroupsAfterSave, taskPaneGroupsOf, livePaneGroupIds, tasksWithoutPaneGroup, windowGroupColor, WINDOW_GROUP_COLORS, windowBackdropNear };
`)();

// --- the type -----------------------------------------------------------------
check('a Window owns the windowLayout module; a Room does not',
  H.isWindowLayoutType('Window') && !H.isWindowLayoutType('Room'));
check('the Map ignores a Window layout but still sees a Room plan',
  !H.hasMapPlan({ type: 'Window', floorPlanUrl: 'x' }) && H.hasMapPlan({ type: 'Room', floorPlanUrl: 'x' })
  && !H.hasMapPlan({ type: 'Room', floorPlanUrl: '' }));
const reg = src.match(/\n  Window: \{[\s\S]*?\n  \},/);
check('Window is a locked built-in that sits in a Wall or a Room, with no floorPlan setting',
  !!reg && /locked: true/.test(reg[0]) && /parentTypes: \["Wall", "Room"\]/.test(reg[0]) && /modules: \["windowLayout"\]/.test(reg[0]) && !/floorPlan:/.test(reg[0]));
check('the Panes tab is a registered module', /windowLayout: \{\s*label: "Panes"/.test(src));

// --- groups: one group per pane, a group of one is fine ------------------------
const g0 = [
  { id: 'a', name: 'Bay 1 lower', memberShapeIds: ['p1', 'p2'] },
  { id: 'b', name: 'Bay 2 lower', memberShapeIds: ['p3', 'p4'] },
];
let r = H.windowGroupsAfterSave(g0, { name: ' Uppers ', memberShapeIds: ['p5'] }, 'new1', { by: 'E' });
check('a new group goes last, trimmed, and may hold a single pane',
  r.groups.length === 3 && r.groups[2].id === 'new1' && r.groups[2].name === 'Uppers' && r.groups[2].memberShapeIds.length === 1 && r.groups[2].by === 'E');
r = H.windowGroupsAfterSave(g0, { name: 'Mixed', memberShapeIds: ['p2', 'p3'] }, 'n');
check('a pane claimed by a new group leaves its old group',
  r.groups.find(g => g.id === 'a').memberShapeIds.join() === 'p1' && r.groups.find(g => g.id === 'b').memberShapeIds.join() === 'p4'
  && r.groups.find(g => g.id === 'n').memberShapeIds.join() === 'p2,p3');
check('what moved is reported, by group and count', r.moved.length === 2 && r.moved.every(m => m.count === 1));
r = H.windowGroupsAfterSave(g0, { name: 'All', memberShapeIds: ['p1', 'p2', 'p3', 'p4'] }, 'n');
check('a group left with no panes is dropped', r.groups.length === 1 && r.groups[0].id === 'n');
r = H.windowGroupsAfterSave(g0, { id: 'a', name: 'Renamed', memberShapeIds: ['p1', 'p2', 'p3'] }, 'unused');
check('editing keeps the group in its place (so colours do not shuffle) and takes panes from others',
  r.groups[0].id === 'a' && r.groups[0].name === 'Renamed' && r.groups[0].memberShapeIds.length === 3
  && r.groups.length === 2 && r.groups[1].memberShapeIds.join() === 'p4');
r = H.windowGroupsAfterSave(g0, { id: 'a', name: '', memberShapeIds: ['p1', 'p1', 'p2'] }, 'x');
check('a blank name falls back to a count, and a pane listed twice counts once',
  r.saved.name === 'Group of 2' && r.saved.memberShapeIds.length === 2);
check('a pane is in at most one group after any save',
  (() => { const seen = new Set(); return r.groups.every(g => g.memberShapeIds.every(m => !seen.has(m) && seen.add(m))); })());
check('the group of a pane is found, or null',
  H.windowGroupOfPane(g0, 'p3').id === 'b' && H.windowGroupOfPane(g0, 'zz') === null);

// --- tasks name groups -----------------------------------------------------------
const win = { type: 'Window', floorPlanGroups: g0 };
check('a task\'s live groups come back in the window\'s order; a deleted group is ignored',
  H.taskPaneGroupsOf(win, { paneGroupIds: ['b', 'gone', 'a'] }).map(g => g.id).join() === 'a,b'
  && H.taskPaneGroupsOf(win, {}).length === 0 && H.taskPaneGroupsOf(win, { paneGroupIds: 'a' }).length === 0);
check('saving a task keeps only groups the window has',
  H.livePaneGroupIds(win, ['a', 'gone']).join() === 'a' && H.livePaneGroupIds({ type: 'Room' }, ['a']).length === 0);
const items = [{ id: 't1', paneGroupIds: ['a', 'b'] }, { id: 't2', paneGroupIds: ['b'] }, { id: 't3' }];
const cleaned = H.tasksWithoutPaneGroup(items, 'b');
check('deleting a group takes it off every task that named it, and touches no other task',
  cleaned[0].paneGroupIds.join() === 'a' && cleaned[1].paneGroupIds.length === 0 && cleaned[2] === items[2]);
check('colours follow group order and repeat past the palette',
  H.windowGroupColor(g0, 'a') === H.WINDOW_GROUP_COLORS[0] && H.windowGroupColor(g0, 'b') === H.WINDOW_GROUP_COLORS[1] && H.windowGroupColor(g0, 'nope') === '');

// --- wiring (source) ---------------------------------------------------------------
check('Replace keeps one-pane groups on a Window, two on a plan',
  /floorPlanRemapLinksAndGroups\(nextLinks, nextGroups, oldSpaces, newSpaces, isWindowLayoutType\(targetAsset\.type\) \? 1 : 2\)/.test(src)
  && /\.filter\(g => g\.memberShapeIds\.length >= \(minGroupSize \|\| 2\)\)/.test(src));
check('the Map\'s descendant-plan test uses hasMapPlan, not a bare floorPlanUrl',
  /descendantsOf\(navAsset, assets\)\.some\(hasMapPlan\)/.test(src) && !/descendantsOf\(navAsset, assets\)\.some\(d => d\.floorPlanUrl\)/.test(src));
check('deleting a group removes it from the tasks in the SAME persist',
  /function deleteWindowGroup[\s\S]*?tasksWithoutPaneGroup\(a\.maintenanceItems, groupId\)[\s\S]*?\n  \}\n/.test(src));
check('the group save returns false when refused, so the tab keeps the selection',
  /function saveWindowGroup[\s\S]*?if \(savingRef\.current\) return false;/.test(src) && /if \(ok !== false\) clearEditor\(\)/.test(src));
check('the tab is wired: Panes tab renders WindowLayoutTabContent only for a window',
  /detailTab === "windowLayout" && hasModule\(selectedAsset\.type, "windowLayout"\)/.test(src));
check('all four task drafts carry paneGroupIds, and opening a task seeds them',
  (src.match(/taskType: "", custom: \{\}, paneGroupIds: \[\] \}/g) || []).length === 4
  && /paneGroupIds: Array\.isArray\(item\.paneGroupIds\) \? \[\.\.\.item\.paneGroupIds\] : \[\]/.test(src));
check('add and edit both save only live groups',
  (src.match(/livePaneGroupIds\(workTarget, maintenanceDraft\.paneGroupIds\)/g) || []).length >= 4);
check('editing a task audits the pane groups by name', /mkEntry\("Pane groups"/.test(src));
check('the audit log words the pane-group actions',
  /pane_group_created"\) return `Created pane group/.test(src) && /pane_group_deleted"\) return `Deleted pane group/.test(src));
check('the task preview only mounts for a window whose task names a group (no floor plan fetched per task row)',
  /isWindowLayoutType\(selectedAsset\.type\) && taskPaneGroupsOf\(selectedAsset, item\)\.length > 0/.test(src));
check('the Tasks search finds a task by its group name', /\.\.\.taskPaneGroupsOf\(r\.asset, r\.item\)\.map\(g => g\.name\)/.test(src));
check('the edge function keeps paneGroupIds on a task',
  /TASK_EXTRA_KEYS = \["taskType", "custom", "paneGroupIds"\]/.test(fs.readFileSync(path.join(__dirname, 'supabase/functions/asset-api/save-shape.ts'), 'utf8')));
check('Sandbox carries a Window with a layout, groups and tasks that name them',
  /label: "BCA0121", type: "Window"/.test(src) && /floorPlanUrl: "data:image\/svg\+xml;utf8,"/.test(src)
  && /id: "wg-b1-lower"/.test(src) && /paneGroupIds: \["wg-b1-lower", "wg-b2-lower"\]/.test(src));

const panes = [{ pts: [[0,0],[10,0],[10,10],[0,10]] }];
const wall = { pts: [[-5,-5],[30,-5],[30,30],[-5,30]], closed: true };
const page = { pts: [[-500,-500],[500,-500],[500,500],[-500,500]], closed: true };
const kept = H.windowBackdropNear([wall, page], panes);
check('a wall around the panes is kept as backdrop', kept.length === 1 && kept[0] === wall);
check('a page-sized border is dropped so it cannot shrink the panes', !kept.includes(page));
check('no backdrop is fine', H.windowBackdropNear(undefined, panes).length === 0);
check('both window views get the backdrop and the hook asks for it',
  (src.match(/useFloorPlanSvg\([^)]*, true\)/g) || []).length === 2 && (src.match(/backdrop=\{plan\.backdrop\}/g) || []).length === 2);
check('a backdrop shape is never clickable', /strokeLinejoin="round" style=\{\{ pointerEvents: "none" \}\}/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
