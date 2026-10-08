// Guards the Map panel's list switch (2026-10-08): the list under a floor plan
// shows the selection's Assets, Tasks or History, over the SAME scope.
//
// The failures here are silent: a scope that forgot descendants shows a room's
// own tasks and none of its equipment's; an archived asset leaking in shows work
// the Tasks tab hides; a card that skipped the switch simply has no switch. The
// helpers are SLICED OUT of index.html and run, not reimplemented. The switch
// itself, and a task row opening its dialog, were driven in Chromium.
//
// Run: node test-frontend-map-list.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let failed = 0;
function check(cond, msg) {
  if (cond) console.log('  ok  ' + msg);
  else { console.log('  FAIL ' + msg); failed++; }
}
function sliceFn(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found`);
  return src.slice(start, src.indexOf('\n}', start) + 2);
}

// A tiny hierarchy: Building > Room > PC, plus an archived Printer in the Room.
const ctx = new Function(`
  const isPlaceType = t => t === "Building" || t === "Room";
  const maintenanceStatusOf = it => it.status;
  const taskDueDate = it => it.due ? new Date(it.due) : null;
  const changePerformedOn = ch => ch.performedOn || "";
  function ancestorsOf(a, assets) {
    const out = []; let p = a;
    while (p && p.parentId) { p = assets.find(x => x.id === p.parentId); if (p) out.push(p); }
    return out;
  }
  ${sliceFn('descendantsOf')}
  ${sliceFn('maintenanceSortKey')}
  ${sliceFn('mapScopeAssets')}
  ${sliceFn('mapTaskRows')}
  ${sliceFn('mapWorkRows')}
  return { mapScopeAssets, mapTaskRows, mapWorkRows };
`)();

const B = { id: 'B', type: 'Building', maintenanceItems: [{ id: 't1', status: 'ok', due: '2030-01-01' }] };
const R = { id: 'R', type: 'Room', parentId: 'B', changes: [{ id: 'c1', performedOn: '2026-01-01' }] };
const PC = { id: 'PC', type: 'Computer', parentId: 'R',
  maintenanceItems: [{ id: 't2', status: 'overdue', due: '2020-01-01' }, { id: 't3', status: 'done' }, { id: 't4', status: 'never' }],
  changes: [{ id: 'c2', performedOn: '2026-05-01' }] };
const P = { id: 'P', type: 'Printer', parentId: 'R', status: 'Archived', maintenanceItems: [{ id: 't5', status: 'overdue' }] };
const assets = [B, R, PC, P];

const scopeB = ctx.mapScopeAssets([B], assets).map(a => a.id).sort();
check(JSON.stringify(scopeB) === '["B","PC","R"]', 'a place covers itself and everything below it, archived excluded');
check(ctx.mapScopeAssets([PC], assets).map(a => a.id).join() === 'PC', 'a pin covers only its own asset');
check(ctx.mapScopeAssets([R, R], assets).length === 2, 'a group dedupes assets reached twice');

const tasks = ctx.mapTaskRows(ctx.mapScopeAssets([B], assets)).map(r => r.item.id);
check(tasks.join() === 't4,t2,t1,t3', 'tasks sort like the Tasks tab: never, then by due, done last (got ' + tasks.join() + ')');
check(!tasks.includes('t5'), "an archived asset's task stays out");

const work = ctx.mapWorkRows(ctx.mapScopeAssets([B], assets)).map(r => r.change.id);
check(work.join() === 'c2,c1', 'history is newest first');

// Wiring.
const fp = src.slice(src.indexOf('function FloorPlanTabContent({'), src.indexOf('\n// Every room/group name label drawn ON the plan'));
check(/const \[listMode, setListMode\] = useState\("assets"\)/.test(fp), 'the list defaults to Assets');
check((fp.match(/<MapListModeSwitch /g) || []).length === 5, 'every list card carries the switch (no plan, space, pin, nothing selected, group)');
check(/listMode !== "assets" \? panelList\(null, groupRooms\)/.test(fp), "a group's Tasks/History cover its rooms");
const call = src.slice(src.indexOf('<MapTabContent'), src.indexOf('/>', src.indexOf('<MapTabContent')));
check(/onOpenTask=\{\(item, a\) => \(canEdit \? openMaintenanceEdit\(item\.id, a\.id\)/.test(call), 'a task row opens the task dialog for editors, against its own asset');
const mapTab = src.slice(src.indexOf('function MapTabContent({'), src.indexOf('function FloorPlanTabContent({'));
check(/onOpenTask=\{onOpenTask\}/.test(mapTab) && /onOpenWork=\{onOpenWork\}/.test(mapTab), 'MapTabContent passes both handlers through');

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nall map list checks passed');
