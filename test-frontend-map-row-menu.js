// Guards the Map panel's asset list (2026-10-07): no asset ID on its rows, and a
// per-row action menu (Show on map, Place/Move pin, Remove pin).
//
// Both fail silently: an ID creeping back is a styling regression nobody files,
// and a dropped prop leaves the rows with no menu button at all -- ContentsList
// renders a row with no actions exactly as it did before the menu existed.
//
// Source-level on purpose: the behaviour itself (the menu opening, Show on map
// landing on the pin, placement starting) is browser behaviour and was driven in
// Chromium against Sandbox.
//
// Run: node test-frontend-map-row-menu.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let failed = 0;
function check(cond, msg) {
  if (cond) console.log('  ok  ' + msg);
  else { console.log('  FAIL ' + msg); failed++; }
}
function slice(startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  if (a === -1) throw new Error(startMarker + ' not found');
  return src.slice(a, src.indexOf(endMarker, a));
}

const list = slice('function ContentsList({', "\n// The Map panel's list modes.");
check(/const showIds = !locationsLast;/.test(list), 'the Map panel layout (locationsLast) hides asset IDs');
check(/const idTag = a => showIds \?/.test(list), 'every ID tag goes through the showIds gate');
check(!/\{[a-z]\.label\}/.test(list.replace(/const idTag[^\n]*/, '')), 'no row prints a .label outside idTag');
check(/rowActions \? rowActions\(a\) : \[\]/.test(list), 'rows ask rowActions for their menu');

const fp = slice('function FloorPlanTabContent({', '\n}\n');
const mapLists = (src.match(/<ContentsList [^>]*locationsLast[^>]*\/>/g) || []);
// One Map panel list, inside panelList, which every card calls (the list-mode
// switch, 2026-10-08) -- so the row menu cannot reach one card and miss another.
check(mapLists.length === 1, 'one Map panel list, shared by every card (found ' + mapLists.length + ')');
check(mapLists.every(l => /rowActions=\{mapRowActions\}/.test(l)), 'the Map panel list gets the row menu');
check((fp.match(/panelList\(/g) || []).length >= 5, 'every card renders through panelList');
check(/panelList\(place, \[a\], \{ onlyId: a\.id/.test(fp), 'a selected pin is the standard list narrowed to that asset');
check(!/Open asset\s*</.test(fp), 'no separate pin card with its own Open asset button');
check(/if \(onlyId\) \{/.test(list) && /contentDevices = \[only\]/.test(list), 'onlyId narrows the list and never leaves it empty');
check(/\(selectedWallId \|\| selectedShapeId\) && !selectedPinId/.test(fp) && /openGroupId && !selectedShapeId && !selectedPinId/.test(fp), 'a selected pin is the only list: no space or group list beside it');
check(/onShowOnMap, onStartPlace/.test(fp), 'FloorPlanTabContent takes onShowOnMap/onStartPlace');

const actions = slice('const mapRowActions = a =>', '\n  };\n');
check(/"Show on map"/.test(actions) && /"Remove pin"/.test(actions) && /"Move pin" : "Place pin"/.test(actions),
  'menu offers Show on map, Place/Move pin and Remove pin');
check(/canEdit && typeCanBePinned\(a\.type\)/.test(actions), 'placing is editors-only and only for pinnable types');
check(/canEdit && pin && onClearPin/.test(actions), 'Remove pin is editors-only and only when pinned');

const mapTab = slice('function MapTabContent({', '\n}\n');
check(/onShowOnMap=\{onShowOnMap\}/.test(mapTab) && /onStartPlace=\{onStartPlace\}/.test(mapTab),
  'MapTabContent passes both handlers through');
const call = slice('<MapTabContent', '/>');
check(/onShowOnMap=\{/.test(call) && /onStartPlace=\{/.test(call), 'the Map tab wires both handlers');
check(!/closeDetail\(\)/.test(call), 'the Map tab handlers do not close a detail page (there is none)');

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nall map row menu checks passed');
