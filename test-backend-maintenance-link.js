// Round-trip test for the v34 maintenance<->change link: a maintenance item's
// `id` and a change entry's `maintenanceId`.
//
// This is the one thing v34 can get wrong, and it fails SILENTLY in two
// distinct ways, neither of which throws and neither of which moves
// SCRIPT_VERSION out of step with its frontend:
//
//   1. A column missing from CHANGE_FIELDS/MAINTENANCE_FIELDS never reaches the
//      Sheet at all. writeTable_ projects each row through that list, so an
//      absent name is silently dropped on write.
//   2. A column present in the header list but not in the per-row PROJECTION
//      inside doGet is written to the Sheet and never handed to the app. The
//      value sits in plain view in the spreadsheet while the app behaves as if
//      the link does not exist -- the worse of the two, because looking at the
//      Sheet suggests it worked.
//
// It has to be tested HERE and cannot be tested anywhere else: Sandbox mode
// never contacts Apps Script, and the live backend needs a Google sign-in.
//
// Rather than reimplement either side (which would test this file's idea of the
// contract, not the backend's), both blocks are SLICED OUT of
// AssetTrackerSync.gs as source text and run against fake data. So a change to
// either side is picked up automatically, and a change to only one of them
// fails here.
//
// Run: node test-backend-maintenance-link.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'AssetTrackerSync.gs'), 'utf8');

function between(startMarker, endMarker) {
  const i = src.indexOf(startMarker);
  if (i === -1) throw new Error(`marker not found: ${startMarker}`);
  const j = src.indexOf(endMarker, i);
  if (j === -1) throw new Error(`end marker not found: ${endMarker}`);
  return src.slice(i, j);
}

const readBlock = between('const assets = assetRows.map(a => {', '\r\n    const auditLog =');
const writeBlock = between('assets.forEach(a => {', 'writeTable_(SHEET_NAMES.comments');

const readSide = new Function(
  'assetRows', 'commentRows', 'changeRows', 'allocationRows', 'maintenanceRows',
  'breakerRows', 'circuitRows',
  readBlock + '\n return assets;'
);
const writeSide = new Function('assets', `
  const commentRows = [], changeRows = [], allocationRows = [], maintenanceRows = [],
        breakerRows = [], circuitRows = [];
  ${writeBlock}
  return { commentRows, changeRows, allocationRows, maintenanceRows, breakerRows, circuitRows };
`);

// The two header constants, evaluated from their real source.
const constsSrc = between('const CHANGE_FIELDS = [', '// AuditLog\'s columns.');
const mod = {};
new Function('module', constsSrc + '\nmodule.CHANGE_FIELDS = CHANGE_FIELDS; module.MAINTENANCE_FIELDS = MAINTENANCE_FIELDS;')(mod);

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};

// --- fixtures ---------------------------------------------------------------
// Deliberately MIXED, the same way MOCK_SNAPSHOT has to be: a pre-v34 item with
// no id and a change with no maintenanceId (which is the entire live sheet on
// the day v34 deploys), alongside a linked pair. A fixture of only one kind
// would pass while the other silently broke -- exactly how the personIds
// data-loss bug hid in Sandbox.
const MAINT_ID = 'm-1111-2222-3333-444455556666';
const ASSET = {
  id: '9f8e7d6c-1111-2222-3333-444455556666', label: 'BCA0900', type: 'Mini Split', personIds: '',
  comments: [], allocations: [], breakers: [], unassignedCircuits: [],
  maintenanceItems: [
    // linked
    { id: MAINT_ID, task: 'Annual coil clean', frequencyLabel: 'Annually', frequencyDays: 365, lastPerformed: '2026-09-10', owner: 'Eric', at: 'T', by: 'E' },
    // legacy: no id at all
    { task: 'Monthly filter clean', frequencyLabel: 'Monthly', frequencyDays: 30, lastPerformed: '', owner: '', at: 'T', by: 'E' },
  ],
  changes: [
    // logged against the schedule above
    { changeType: 'Maintenance', vendor: 'Acme HVAC', cost: '250', note: 'Coils fouled', at: 'T', by: 'E', maintenanceId: MAINT_ID },
    // an ordinary unattached change -- what every pre-v34 row is
    { changeType: 'Repair', vendor: '', cost: '', note: 'n', at: 'T', by: 'E' },
    // a DANGLING link: the schedule it named has since been deleted. This must
    // round-trip untouched rather than being dropped or repaired -- a change
    // outlives the schedule that prompted it, like an audit entry outlives its
    // asset.
    { changeType: 'Maintenance', vendor: '', cost: '40', note: 'old', at: 'T', by: 'E', maintenanceId: 'm-deleted-0000' },
  ],
};

// --- the header lists (failure mode 1) --------------------------------------
check('CHANGE_FIELDS carries maintenanceId', mod.CHANGE_FIELDS.indexOf('maintenanceId') !== -1,
      `got ${JSON.stringify(mod.CHANGE_FIELDS)}`);
check('MAINTENANCE_FIELDS carries id', mod.MAINTENANCE_FIELDS.indexOf('id') !== -1,
      `got ${JSON.stringify(mod.MAINTENANCE_FIELDS)}`);

// Both lists must still be used at all THREE sites rather than re-inlined as
// literals. A literal that drifts from the constant is the trap v34 removed --
// and the doGet one is inert (readTable_ ignores its argument), so a re-inlined
// copy there looks authoritative while doing nothing.
[['CHANGE_FIELDS', 'changes'], ['MAINTENANCE_FIELDS', 'maintenance']].forEach(([constName, tab]) => {
  const uses = [
    `readTable_(SHEET_NAMES.${tab}, ${constName})`,
    `writeTable_(SHEET_NAMES.${tab}, ${constName},`,
    `{ name: SHEET_NAMES.${tab}, headers: ${constName} }`,
  ];
  uses.forEach(u => check(`${constName} is used at: ${u}`, src.includes(u)));
});

// --- the round trip (failure mode 2) ----------------------------------------
const written = writeSide([ASSET]);
const back = readSide(
  [ASSET], written.commentRows, written.changeRows, written.allocationRows,
  written.maintenanceRows, written.breakerRows, written.circuitRows
)[0];

check('a maintenance item\'s id survives the round trip',
      back.maintenanceItems[0].id === MAINT_ID,
      `got ${JSON.stringify(back.maintenanceItems[0].id)}`);

check('a change\'s maintenanceId survives the round trip',
      back.changes[0].maintenanceId === MAINT_ID,
      `got ${JSON.stringify(back.changes[0].maintenanceId)}`);

check('the link still resolves after the round trip',
      back.changes.filter(c => c.maintenanceId === back.maintenanceItems[0].id).length === 1,
      `got ${JSON.stringify(back.changes.map(c => c.maintenanceId))}`);

// An empty value must come back as "" and never as undefined: the frontend
// treats "no maintenanceId" as an ordinary unattached change, and `undefined`
// would be written to the Sheet as the string "undefined" on the next save.
check('a pre-v34 maintenance item reads back with id "" (not undefined)',
      back.maintenanceItems[1].id === '',
      `got ${JSON.stringify(back.maintenanceItems[1].id)}`);
check('a pre-v34 change reads back with maintenanceId "" (not undefined)',
      back.changes[1].maintenanceId === '',
      `got ${JSON.stringify(back.changes[1].maintenanceId)}`);

// A dangling link is data, not an error -- it must survive untouched.
check('a dangling maintenanceId round-trips unchanged',
      back.changes[2].maintenanceId === 'm-deleted-0000',
      `got ${JSON.stringify(back.changes[2].maintenanceId)}`);

// The written rows must carry the columns too -- this is what actually reaches
// the Sheet, and is the half that a header-list-only change would leave empty.
check('the written change row carries maintenanceId',
      written.changeRows[0].maintenanceId === MAINT_ID,
      `got ${JSON.stringify(written.changeRows[0])}`);
check('the written maintenance row carries id',
      written.maintenanceRows[0].id === MAINT_ID,
      `got ${JSON.stringify(written.maintenanceRows[0])}`);

// The link is per-asset and must not leak across assets sharing a tab.
{
  const other = { ...ASSET, id: 'other-asset-id', label: 'BCA0901' };
  const w = writeSide([ASSET, other]);
  const rows = readSide(
    [ASSET, other], w.commentRows, w.changeRows, w.allocationRows,
    w.maintenanceRows, w.breakerRows, w.circuitRows
  );
  check('two assets on one tab keep their own maintenance items and changes',
        rows.every(a => a.maintenanceItems.length === 2 && a.changes.length === 3),
        `got ${JSON.stringify(rows.map(a => ({ m: a.maintenanceItems.length, c: a.changes.length })))}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
