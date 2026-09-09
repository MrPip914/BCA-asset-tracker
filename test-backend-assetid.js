// Round-trip test for the v31 asset `id` join — the contract between doGet and
// doPost that decides which child rows belong to which asset.
//
// This is the one thing v31 can get wrong, and it fails SILENTLY: if the two
// sides key on different things, every comment, change, allocation, maintenance
// item, breaker and circuit is written under one key and read back under
// another, so they simply vanish. Nothing throws and SCRIPT_VERSION still
// matches its frontend.
//
// It has to be tested HERE and cannot be tested anywhere else: Sandbox mode
// never contacts Apps Script, and the live backend needs a Google sign-in.
//
// Rather than reimplement the join (which would test this file's idea of it,
// not the backend's), both blocks are SLICED OUT of AssetTrackerSync.gs as
// source text and executed against fake data with the sheet I/O stubbed. So a
// change to either side is picked up automatically, and a change to only one of
// them fails here.
//
// Run: node test-backend-assetid.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'AssetTrackerSync.gs'), 'utf8');

// --- slice the two real blocks ---------------------------------------------
function between(startMarker, endMarker) {
  const i = src.indexOf(startMarker);
  if (i === -1) throw new Error(`marker not found: ${startMarker}`);
  const j = src.indexOf(endMarker, i);
  if (j === -1) throw new Error(`end marker not found: ${endMarker}`);
  return src.slice(i, j);
}

// doGet's asset assembly: builds each asset with its child arrays attached.
const readBlock = between('const assets = assetRows.map(a => {', '\n    const auditLog =');
// doPost's child-row flattening: turns assets back into flat rows per tab.
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

// --- fixtures ---------------------------------------------------------------
// Deliberately MIXED, the same way MOCK_SNAPSHOT has to be: a legacy row with no
// id at all (the entire live sheet on the day v31 deploys) and a post-v31 row
// whose id is nothing like its label. A fixture of only one kind would pass
// while the other silently broke — which is exactly how the personIds
// data-loss bug hid in Sandbox.
const LEGACY = { label: 'BCA0001', type: 'Computer', personIds: '' };
const MODERN = { id: '9f8e7d6c-1111-2222-3333-444455556666', label: 'BCA0900', type: 'Electrical Panel', personIds: '' };
const UNTAGGED = { id: 'aabbccdd-0000-1111-2222-333344445555', label: '', type: 'Computer', personIds: '' };

function assetWithChildren(row) {
  return {
    ...row,
    comments: [{ text: 'c1', at: 'T', by: 'E' }],
    changes: [{ changeType: 'Repair', vendor: 'V', cost: '1', note: 'n', at: 'T', by: 'E' }],
    allocations: [{ roomId: 'BCR0001', quantity: 2 }],
    maintenanceItems: [{ task: 'm', frequencyLabel: 'Monthly', frequencyDays: 30, lastPerformed: '', owner: '', at: 'T', by: 'E' }],
    breakers: [{ id: 'brk-1', cells: ['1a', '1b'], ampRating: 20, circuits: [{ id: 'ckt-1', label: 'Outlets', roomsServedIds: ['BCR0001'] }] }],
    unassignedCircuits: [{ id: 'ckt-2', label: 'Spare run', roomsServedIds: [] }],
  };
}

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};

// --- the round trip ---------------------------------------------------------
// Write each asset out to flat rows, read them straight back, and confirm every
// child array survived. This is the whole contract in one assertion.
[['legacy row (no id — the live sheet at deploy time)', LEGACY],
 ['post-v31 row (uuid id, label unlike it)', MODERN],
 ['post-v31 row with NO label at all (phase 3 shape)', UNTAGGED],
].forEach(([name, row]) => {
  const written = writeSide([assetWithChildren(row)]);
  const back = readSide(
    [row], written.commentRows, written.changeRows, written.allocationRows,
    written.maintenanceRows, written.breakerRows, written.circuitRows
  )[0];
  const counts = {
    comments: back.comments.length,
    changes: back.changes.length,
    allocations: back.allocations.length,
    maintenanceItems: back.maintenanceItems.length,
    breakers: back.breakers.length,
    circuits: back.breakers.reduce((n, b) => n + b.circuits.length, 0),
    unassignedCircuits: back.unassignedCircuits.length,
  };
  const want = { comments: 1, changes: 1, allocations: 1, maintenanceItems: 1, breakers: 1, circuits: 1, unassignedCircuits: 1 };
  check(`round trip keeps every child array — ${name}`,
        JSON.stringify(counts) === JSON.stringify(want),
        `got ${JSON.stringify(counts)}\n        want ${JSON.stringify(want)}`);
});

// A mixed sheet must not cross-attach: each asset gets its own rows and no more.
{
  const assets = [assetWithChildren(LEGACY), assetWithChildren(MODERN)];
  const written = writeSide(assets);
  const back = readSide(
    [LEGACY, MODERN], written.commentRows, written.changeRows, written.allocationRows,
    written.maintenanceRows, written.breakerRows, written.circuitRows
  );
  check('a mixed sheet does not cross-attach child rows',
        back.every(a => a.comments.length === 1 && a.breakers.length === 1),
        `got ${JSON.stringify(back.map(a => ({ comments: a.comments.length, breakers: a.breakers.length })))}`);
}

// The key actually used must be the id when there is one — otherwise a post-v31
// asset's rows are filed under its tag, and retagging it (phase 3) orphans them.
{
  const written = writeSide([assetWithChildren(MODERN)]);
  check('child rows are keyed on the id, not the label',
        written.commentRows[0].assetLabel === MODERN.id,
        `got ${JSON.stringify(written.commentRows[0].assetLabel)}, want ${JSON.stringify(MODERN.id)}`);
  check('panelLabel on breakers is keyed on the id too',
        written.breakerRows[0].panelLabel === MODERN.id,
        `got ${JSON.stringify(written.breakerRows[0].panelLabel)}`);
  check('panelLabel on unassigned circuits is keyed on the id too',
        written.circuitRows.every(c => c.panelLabel === MODERN.id),
        `got ${JSON.stringify(written.circuitRows.map(c => c.panelLabel))}`);
}

// A legacy row must still be keyed on its label, or v31 orphans the ENTIRE
// existing sheet on the first save after deploying.
{
  const written = writeSide([assetWithChildren(LEGACY)]);
  check('a legacy row is still keyed on its label',
        written.commentRows[0].assetLabel === LEGACY.label,
        `got ${JSON.stringify(written.commentRows[0].assetLabel)}`);
}

// --- schema ------------------------------------------------------------------
const fieldsSrc = src.slice(src.indexOf('const ASSET_FIELDS = ['), src.indexOf('];', src.indexOf('const ASSET_FIELDS = [')) + 2);
const mod = {};
new Function('module', fieldsSrc + '\nmodule.ASSET_FIELDS = ASSET_FIELDS;')(mod);
check('ASSET_FIELDS carries id', mod.ASSET_FIELDS.indexOf('id') !== -1);
check('ASSET_FIELDS still carries label (v31 keeps both)', mod.ASSET_FIELDS.indexOf('label') !== -1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
