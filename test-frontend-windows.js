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
  ${sliceFn('function windowGroupsOfPane(groups, paneId) {')}
  ${sliceFn('function windowGroupsAfterSave(groups, draft, newId, stamp) {')}
  ${sliceFn('function taskPaneGroupsOf(asset, item) {')}
  ${sliceFn('function livePaneGroupIds(asset, ids) {')}
  ${sliceFn('function tasksWithoutPaneGroup(items, groupId) {')}
  ${sliceConst('const WINDOW_GROUP_COLORS = [')}
  ${sliceFn('function windowGroupColor(groups, groupId) {')}
  ${sliceFn('function windowBackdropNear(backdrop, spaces) {')}
  ${sliceConst('const SECTIONS_MAX_ZOOM =')}
  ${sliceFn('function clampZoomView(box, v) {')}
  ${sliceFn('function zoomViewBox(box, v) {')}
  ${sliceFn('function zoomViewAround(box, v, nextZ, ux, uy) {')}
  const floorPlanBbox = pts => { const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); const x = Math.min(...xs), y = Math.min(...ys); return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }; };
  return { isWindowLayoutType, hasMapPlan, windowGroupsOf, windowGroupsOfPane, windowGroupsAfterSave, taskPaneGroupsOf, livePaneGroupIds, tasksWithoutPaneGroup, windowGroupColor, WINDOW_GROUP_COLORS, windowBackdropNear, clampZoomView, zoomViewBox, zoomViewAround, SECTIONS_MAX_ZOOM };
`)();

// --- the type -----------------------------------------------------------------
check('a Window owns the windowLayout module; a Room does not',
  H.isWindowLayoutType('Window') && !H.isWindowLayoutType('Room'));
check('the Map ignores a Window layout but still sees a Room plan',
  !H.hasMapPlan({ type: 'Window', floorPlanUrl: 'x' }) && H.hasMapPlan({ type: 'Room', floorPlanUrl: 'x' })
  && !H.hasMapPlan({ type: 'Room', floorPlanUrl: '' }));
const reg = src.match(/\n  Window: \{[\s\S]*?\n  \},/);
check('Window is a locked built-in that sits in a Wall or a Room, with no floorPlan setting',
  !!reg && /locked: true/.test(reg[0]) && /parentTypes: \["Wall", "Room"\]/.test(reg[0]) && /sections: true/.test(reg[0]) && !/floorPlan:/.test(reg[0]));
check('the Sections tab is a registered module', /windowLayout: \{\s*label: "Sections"/.test(src));

// --- groups: a pane can be in several, a group of one is fine ------------------------
const g0 = [
  { id: 'a', name: 'Bay 1 lower', memberShapeIds: ['p1', 'p2'] },
  { id: 'b', name: 'Bay 2 lower', memberShapeIds: ['p3', 'p4'] },
];
let r = H.windowGroupsAfterSave(g0, { name: ' Uppers ', memberShapeIds: ['p5'] }, 'new1', { by: 'E' });
check('a new group goes last, trimmed, and may hold a single pane',
  r.groups.length === 3 && r.groups[2].id === 'new1' && r.groups[2].name === 'Uppers' && r.groups[2].memberShapeIds.length === 1 && r.groups[2].by === 'E');
r = H.windowGroupsAfterSave(g0, { name: 'Mixed', memberShapeIds: ['p2', 'p3'] }, 'n');
check('a pane claimed by a new group STAYS in its old group',
  r.groups.find(g => g.id === 'a').memberShapeIds.join() === 'p1,p2' && r.groups.find(g => g.id === 'b').memberShapeIds.join() === 'p3,p4'
  && r.groups.find(g => g.id === 'n').memberShapeIds.join() === 'p2,p3');
check('nothing is reported as moved', r.moved === undefined);
r = H.windowGroupsAfterSave(g0, { name: 'All', memberShapeIds: ['p1', 'p2', 'p3', 'p4'] }, 'n');
check('claiming every pane of other groups leaves those groups alone', r.groups.length === 3 && r.groups[0].memberShapeIds.length === 2);
r = H.windowGroupsAfterSave(g0, { id: 'a', name: 'Renamed', memberShapeIds: ['p1', 'p2', 'p3'] }, 'unused');
check('editing keeps the group in its place (so colours do not shuffle) and does not touch others',
  r.groups[0].id === 'a' && r.groups[0].name === 'Renamed' && r.groups[0].memberShapeIds.length === 3
  && r.groups.length === 2 && r.groups[1].memberShapeIds.join() === 'p3,p4');
r = H.windowGroupsAfterSave(g0, { id: 'a', name: '', memberShapeIds: ['p1', 'p1', 'p2'] }, 'x');
check('a blank name falls back to a count, and a pane listed twice counts once',
  r.saved.name === 'Group of 2' && r.saved.memberShapeIds.length === 2);
const gm = [{ id: 'a', name: 'A', memberShapeIds: ['p1', 'p2'] }, { id: 'b', name: 'B', memberShapeIds: ['p2', 'p3'] }];
check('the groups of a pane are found in window order, or none',
  H.windowGroupsOfPane(gm, 'p2').map(g => g.id).join() === 'a,b' && H.windowGroupsOfPane(gm, 'p3').map(g => g.id).join() === 'b'
  && H.windowGroupsOfPane(gm, 'zz').length === 0);
check('the layout view reads every group of a pane (striped when several) and the tab no longer reports moves',
  /windowGroupsOfPane\(groups, sp\.gid\)/.test(src) && /<pattern /.test(src) && !/Moves \{movedText\}/.test(src) && !/windowGroupOfPane/.test(src));

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
check('the tab is wired: Sections tab renders WindowLayoutTabContent only for a window',
  /detailTab === "windowLayout" && hasModule\(selectedAsset\.type, "windowLayout"\)/.test(src));
check('all four task drafts carry paneGroupIds, and opening a task seeds them',
  (src.match(/taskType: "", custom: \{\}, paneGroupIds: \[\] \}/g) || []).length === 4
  && /paneGroupIds: Array\.isArray\(item\.paneGroupIds\) \? \[\.\.\.item\.paneGroupIds\] : \[\]/.test(src));
check('add and edit both save only live groups',
  (src.match(/livePaneGroupIds\(workTarget, maintenanceDraft\.paneGroupIds\)/g) || []).length >= 4);
check('editing a task audits the pane groups by name', /mkEntry\("Section groups"/.test(src));
check('the audit log words the pane-group actions',
  /pane_group_created"\) return `Created section group/.test(src) && /pane_group_deleted"\) return `Deleted section group/.test(src));
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
const photo = { pts: [[-500,-500],[500,-500],[500,500],[-500,500]], closed: true, image: 'data:image/jpeg;base64,AA' };
check('an embedded photo is kept even when far larger than the panes', H.windowBackdropNear([photo, page], panes).length === 1);
check('only data: images are read from a layout, never a remote href',
  /data:image\\\/\(png\|jpe\?g\|gif\|webp\);/.test(src.replace(/\\\//g, '\\/')) || src.includes('/^data:image\\/(png|jpe?g|gif|webp);/i.test(href)'));
check('a layout with a photo offers Photo and Shapes toggles, and never both off',
  /hasPhoto && \(/.test(src) && /toggle\("Photo"/.test(src) && /toggle\("Shapes"/.test(src) && /if \(showPhoto && !showShapes\) setShowShapes\(true\)/.test(src) && /if \(showShapes && !showPhoto\) setShowPhoto\(true\)/.test(src));
check('hiding the shapes removes the panes from the view', /\(!hasPhoto \|\| showShapes\) && list\.map/.test(src));
check('the view draws the photo behind the shapes', /b\.image\s*\?[\s\S]{0,200}<image key=/.test(src));
check('both window views get the backdrop and the hook asks for it',
  (src.match(/useFloorPlanSvg\([^)]*, true\)/g) || []).length === 2 && (src.match(/backdrop=\{plan\.backdrop\}/g) || []).length === 4);
check('a backdrop shape is never clickable', /strokeLinejoin="round" style=\{\{ pointerEvents: "none" \}\}/.test(src));

const tpl = src.slice(src.indexOf('function TaskPaneLayout('), src.indexOf('function WindowLayoutTabContent('));
check('a task\'s layout starts COLLAPSED behind a chevron and is only fetched once opened',
  /useState\(false\)/.test(tpl) && /aria-expanded=\{open\}/.test(tpl) && /useFloorPlanSvg\(open && asset/.test(tpl) && /ChevronRight/.test(tpl));
check('the layout is on the task dialog (editing and reading), the task card AND the completion form',
  (src.match(/<TaskPaneLayout /g) || []).length === 4);

// --- zoom (2026-10-16) ----------------------------------------------------------------
{
  const box = { x: 0, y: 0, w: 200, h: 100 };
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const full = H.zoomViewBox(box, { z: 1, dx: 0, dy: 0 });
  check('zoom 1 shows the whole drawing', near(full.x, 0) && near(full.w, 200) && near(full.h, 100));
  const c = H.clampZoomView(box, { z: 99, dx: 9999, dy: -9999 });
  check('zoom is capped and the view cannot leave the drawing',
    c.z === H.SECTIONS_MAX_ZOOM && near(c.dx, 100 * (1 - 1 / c.z)) && near(c.dy, -50 * (1 - 1 / c.z)));
  check('zoom cannot go below the whole drawing', H.clampZoomView(box, { z: 0.2, dx: 5, dy: 5 }).z === 1 && H.clampZoomView(box, { z: 0.2, dx: 5, dy: 5 }).dx === 0);
  // The point under the cursor stays put: (150, 25) at zoom 1, then zoom to 2 around it.
  const z2 = H.zoomViewAround(box, { z: 1, dx: 0, dy: 0 }, 2, 150, 25);
  const vb = H.zoomViewBox(box, z2);
  check('zooming around a point keeps that point at the same place on screen',
    near((150 - vb.x) / vb.w, (150 - 0) / 200) && near((25 - vb.y) / vb.h, 25 / 100));
  const back = H.zoomViewAround(box, z2, 1, 150, 25);
  check('zooming back out returns to the whole drawing', back.z === 1 && near(back.dx, 0) && near(back.dy, 0));
  check('the layout view is zoomable on the tab and in the full-screen view',
    /<WindowLayoutView spaces=\{spaces\}[\s\S]*?zoomable \/>/.test(src) && /maxHeight="calc\(100vh - 130px\)" zoomable wheelZoom/.test(src));
  const tl = src.slice(src.indexOf('function TaskPaneLayout('), src.indexOf('function WindowLayoutTabContent('));
  check('a task\'s thumbnail opens the enlarged view without closing the dialog behind it',
    /aria-label="Enlarge the sections drawing"/.test(tl) && /e\.stopPropagation\(\); setEnlarged\(true\)/.test(tl) && /<SectionsZoomModal/.test(tl));
  const zm = src.slice(src.indexOf('function SectionsZoomModal('), src.indexOf('function PaneGroupChips('));
  check('the enlarged view is portalled and stops clicks', /createPortal\(/.test(zm) && /e\.stopPropagation\(\); onClose\(\)/.test(zm));
  check('a drag is never read as a pane click', /onClickCapture=\{zoomable \? \(e => \{ if \(dragged\.current\)/.test(src));
  check('the tab offers an Enlarge button', /setEnlarged\(true\)\}[\s\S]{0,400}Enlarge\s*<\/button>/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

check('modulesFor adds windowLayout from the per-type sections setting, not the type name',
  /entry\?\.sections && !mods\.includes\("windowLayout"\)/.test(src) && !/type === "Window"/.test(src.slice(src.indexOf('function modulesFor'), src.indexOf('function modulesFor') + 500)));
check('the type editor offers and saves the sections setting',
  /sections: !!entry\.sections/.test(src) && /sections: !!draft\.sections/.test(src) && /setDraft\(\{ \.\.\.draft, sections: !draft\.sections \}\)/.test(src));
