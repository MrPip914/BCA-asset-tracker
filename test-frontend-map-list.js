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
check(/const \[localListMode, setLocalListMode\] = useState\("assets"\)/.test(fp)
  && /const \[mapListMode, setMapListMode\] = useState\("assets"\)/.test(src), 'the list defaults to Assets');
// Back from an asset opened off the panel lands on the list the user left: the
// mode lives on the page (the map unmounts while an asset is open), and the
// selection is remembered there and put back on remount.
check(/const listMode = listModeProp \|\| localListMode/.test(fp) && /listMode=\{mapListMode\}/.test(src)
  && /onListModeChange=\{setMapListMode\}/.test(src) && /const listFilters = listFiltersProp \|\| localListFilters/.test(fp)
  && /listFilters=\{mapListFilters\}/.test(src), 'the list mode and filters are held by the page, so they survive opening an asset');
check(/selectionMemoRef=\{mapSelectionMemoRef\}/.test(src) && /applySelect\(m\.selectId\)/.test(fp)
  && !/return \(\) => \{[^}]*selectionMemoRef\.current = null/.test(fp), 'the selected space is remembered across the unmount and restored');
check((fp.match(/<MapListModeSwitch /g) || []).length === 1 && /return \(<>\s*<div style=\{\{ position: "relative" \}\}>\s*<MapListModeSwitch/.test(fp), 'the switch is drawn by panelList, so every card that lists carries it');
check((fp.match(/\{panelList\(/g) || []).length === 5, 'all five list cards go through panelList (no plan, space, pin, nothing selected, group)');
check(/panelList\(null, groupRooms, \{ assetsBody:/.test(fp), "a group's Tasks/History cover its rooms, its Assets list its rooms");
check(/<MapListFilterMenu /.test(fp) && /filterOpen && <MapListFilterMenu/.test(fp), 'the filter choices are a menu, drawn only while open');
const activeFn = src.slice(src.indexOf('function MapListActiveFilters('), src.indexOf('\n}', src.indexOf('function MapListActiveFilters(')));
check(/if \(!chips\.length\) return null;/.test(activeFn) && /<MapListActiveFilters /.test(fp), 'only the active filters show under the switch, nothing when none');
check(/const keepAsset = \(count \|\| assetQ\) \? \(a => mapListFilterMatches\("assets", active, a, 0, assets\) && assetMatchesSearch\(a, assets, typesList, assetQ\)\)/.test(fp) && /filterAsset=\{keepAsset\}/.test(fp) && /filter=\{active\}/.test(fp), 'the active filter reaches both list kinds');

// The filter (2026-10-08).
const fctx = new Function(`
  const AUDIT_ALL_TIME = "All time";
  const TASK_KIND_SCHEDULED = "scheduled", TASK_KIND_ONEOFF = "oneoff";
  ${src.slice(src.indexOf('const AUDIT_PERIOD_OPTIONS = ['), src.indexOf('];', src.indexOf('const AUDIT_PERIOD_OPTIONS = [')) + 2)}
  ${src.slice(src.indexOf('const TASK_KIND_FILTER_OPTIONS = ['), src.indexOf('];', src.indexOf('const TASK_KIND_FILTER_OPTIONS = [')) + 2)}
  const typeNameOf = t => ({ C: "Computer", M: "Monitor" })[t] || t;
  const taskKindOf = it => it.kind || "scheduled";
  const maintenanceStatusMeta = st => ({ label: st });
  ${sliceFn('withinAuditPeriod')}
  ${src.slice(src.indexOf('const MAP_TASK_STATUS_ORDER'), src.indexOf('const MAP_NO_WORK_TYPE'))}
  const MAP_NO_WORK_TYPE = "No work type";
  const UNASSIGNED_LABEL = "Unassigned";
  const isPlaceType = t => t === 'Room';
  const personLabelsOf = a => a.personIds || [];
  const personNamesOf = (a, all) => (a.personIds || []).map(id => (all.find(x => x.id === id) || {}).n);
  ${src.slice(src.indexOf('const MAP_UNASSIGNED_USER'), src.indexOf('function mapListFilterGroups('))}
  ${sliceFn('mapListFilterGroups')}
  ${sliceFn('mapListActiveFilter')}
  ${sliceFn('mapListFilterMatches')}
  return { mapListFilterGroups, mapListActiveFilter, mapListFilterMatches };
`)();
const g1 = fctx.mapListFilterGroups('assets', [{ type: 'M' }, { type: 'C' }, { type: 'C' }]);
check(g1.length === 1 && g1[0].options.map(o => o.label).join() === 'Computer,Monitor', 'assets filter by the types present, A-Z, once each');
const people = [{ id: 'u1', n: 'Ann' }, { id: 'u2', n: 'Bo' }];
const devs = [{ type: 'C', personIds: ['u2'] }, { type: 'C', personIds: ['u1', 'u2'] }, { type: 'C' }, { type: 'Room' }];
const gu = fctx.mapListFilterGroups('assets', devs, null, people).find(g => g.key === 'user');
check(gu && gu.options.map(o => o.label).join() === 'Ann,Bo,Unassigned', 'assets filter by user, A-Z, Unassigned last, a room offering none');
check(devs.filter(a => fctx.mapListFilterMatches('assets', { user: ['u2'] }, a, 0, people)).length === 2, 'a user filter matches every asset that person is on');
check(devs.filter(a => fctx.mapListFilterMatches('assets', { user: ['__unassigned'] }, a, 0, people)).length === 1, 'Unassigned matches a device with nobody, never a place');
check(fctx.mapListFilterGroups('assets', [{ type: 'C' }, { type: 'C' }], null, []).length === 0, 'one type and no users offers no filter (a dead control)');
const trows = [{ status: 'done', item: {} }, { status: 'overdue', item: { kind: 'oneoff' } }, { status: 'never', item: {} }];
const g2 = fctx.mapListFilterGroups('tasks', trows);
check(g2.map(g => g.key).join() === 'status,kind' && g2[0].options.map(o => o.value).join() === 'overdue,never,done', 'tasks filter by status (urgent first) and kind');
const a2 = fctx.mapListActiveFilter(g2, { status: ['overdue', 'ok'], kind: ['oneoff'] });
check(JSON.stringify(a2) === '{"status":["overdue"],"kind":["oneoff"]}', 'a stored value this selection does not offer is pruned');
check(fctx.mapListActiveFilter(g1, { type: ['Printer'] }).type === undefined, 'a filter for a type not here is inactive, not an empty list');
check(trows.filter(r => fctx.mapListFilterMatches('tasks', { status: ['overdue', 'never'], kind: ['scheduled'] }, r, 0)).length === 1, 'OR within a group, AND across groups');
const now = Date.parse('2026-10-08T12:00:00Z');
const hrows = [{ performedOn: '2026-10-01', change: { changeType: 'Repair' } }, { performedOn: '2025-01-01', change: {} }];
const g3 = fctx.mapListFilterGroups('history', hrows);
check(g3.map(g => g.key).join() === 'workType,period' && g3[0].options[1].label === 'No work type', 'history filters by work type (blank last) and period');
check(g3[1].single && hrows.filter(r => fctx.mapListFilterMatches('history', { period: ['30'] }, r, now)).length === 1, 'the period is one rolling window');
check(hrows.filter(r => fctx.mapListFilterMatches('history', { workType: [''] }, r, now)).length === 1, 'blank work type is filterable');
const call = src.slice(src.indexOf('<MapTabContent'), src.indexOf('/>', src.indexOf('<MapTabContent')));
check(/onOpenTask=\{\(item, a\) => \(canEdit \? openMaintenanceEdit\(item\.id, a\.id\)/.test(call), 'a task row opens the task dialog for editors, against its own asset');
const mapTab = src.slice(src.indexOf('function MapTabContent({'), src.indexOf('function FloorPlanTabContent({'));
check(/onOpenTask=\{onOpenTask\}/.test(mapTab) && /onOpenWork=\{onOpenWork\}/.test(mapTab), 'MapTabContent passes both handlers through');

// The search (2026-10-08): the Map tab's search box narrows the panel list with
// the SAME match the Assets, Tasks and History tabs use -- one function each,
// called by the tab and by the map, so the two cannot drift.
const sctx = new Function(`
  const nameOf = a => a.name || a.label || "";
  const typeNameOf = t => ({ C: "Computer", Room: "Room" })[t] || t || "";
  const isPersonType = () => false;
  const personNameVariants = () => [];
  function ancestorsOf(a, assets) {
    const out = []; let p = a;
    while (p && p.parentId) { p = assets.find(x => x.id === p.parentId); if (p) out.push(p); }
    return out;
  }
  const roomNameOf = (a, assets) => { const r = [a, ...ancestorsOf(a, assets)].find(x => x.type === "Room"); return r ? r.name : ""; };
  const buildingNameOf = () => "";
  ${sliceFn('assetMatchesSearch')}
  ${sliceFn('taskMatchesSearch')}
  ${sliceFn('workMatchesSearch')}
  return { assetMatchesSearch, taskMatchesSearch, workMatchesSearch };
`)();
const sRoom = { id: 'r', type: 'Room', name: 'Library' };
const sPc = { id: 'p', type: 'C', name: 'Front desk', parentId: 'r', serial: 'XJ-9' };
const sAll = [sRoom, sPc];
check(sctx.assetMatchesSearch(sPc, sAll, null, 'xj-9') && !sctx.assetMatchesSearch(sRoom, sAll, null, 'xj-9'), 'search finds an asset by any field and leaves others out');
check(sctx.assetMatchesSearch(sPc, sAll, null, 'library'), "search finds equipment by the room it sits in, as the Assets tab does");
check(sctx.assetMatchesSearch(sPc, sAll, null, '') , 'a blank search matches everything');
check(sctx.taskMatchesSearch({ asset: sPc, item: { task: 'Clean filter' } }, sAll, null, 'filter')
  && sctx.taskMatchesSearch({ asset: sPc, item: { task: 'x' } }, sAll, null, 'library')
  && !sctx.taskMatchesSearch({ asset: sPc, item: { task: 'x' } }, sAll, null, 'roof'), 'task search matches the task, its asset and its room');
check(sctx.workMatchesSearch({ asset: sPc, change: { vendor: 'Acme' } }, null, 'acme')
  && sctx.workMatchesSearch({ asset: sPc, change: {} }, null, 'front desk'), 'history search matches the vendor and the asset name');
check(/return assetMatchesSearch\(a, assets, typesList, q\);/.test(src) && /return taskMatchesSearch\(r, assets, typesList, q\);/.test(src)
  && /return workMatchesSearch\(r, typesList, q\);/.test(src), 'the Assets, Tasks and History tabs use the same search functions');
const mwl = sliceFn('MapWorkList');
check(/taskMatchesSearch\(r, assets \|\| \[\], typesList, q\)/.test(mwl) && /workMatchesSearch\(r, typesList, q\)/.test(mwl)
  && /query=\{listQ\} assets=\{assets\}/.test(fp), "the map's Tasks and History lists apply the search");
check(/const listQ = \(query \|\| ""\)/.test(fp) && fp.indexOf('const listQ') < fp.indexOf('const qTrim'),
  'the list reads the query itself, ahead of the no-plan early return (qTrim there would be a TDZ crash)');
check(/const shownRooms = qTrim \? groupRooms\.filter/.test(fp), "an open group's room list is narrowed by the search too");
check(/query=\{mapQuery\}/.test(src) && !/popstate[\s\S]{0,400}setMapQuery/.test(src), 'the search text lives on the page, so Back from an asset keeps it');

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nall map list checks passed');
