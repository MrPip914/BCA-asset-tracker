// The inventory a read hands back, in the SHAPE handleAuthenticatedRead_
// builds today -- that shape is the contract index.html is written against.
//
// Every record's `data` is already that shape (db/snapshot-rows.mjs stores the
// record exactly as doGet handed it to the app), so this is reassembly, not
// translation: nest each asset's children back under it, in `position` order.
// The parity test in api_test.ts compares the result against doGet's own
// output for the same Sheet.

import type { Tx } from "./db.ts";
import { AUDIT_FIELDS } from "./save-shape.ts";

// An ordinary read returns the newest AUDIT_READ_LIMIT rows, and auditTotal
// says how many there are; op:"auditFull" is how a view asks for the rest.
export const AUDIT_READ_LIMIT = 2000;
export const REVISION_DOMAINS = ["assets", "config", "breakerTypes", "photos"];

// The Config keys the read names, and the order it names them in. Any other
// key is kept in the table (the save path must preserve it) but not sent.
const CONFIG_KEYS = [
  "columns", "changeTypes", "vendors", "peripheralsList", "usersList", "bulkItemTypes",
  "typesList", "typeSettings", "typeCategories",
];

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const groupBy = (rows: Row[], key: string) => {
  const out = new Map<string, Row[]>();
  for (const r of rows) {
    const k = r[key];
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(r);
  }
  return out;
};

export async function readInventory(tx: Tx) {
  // One transaction, so every table is read at the same instant -- what the
  // script lock bought the Sheet read, without anyone waiting on anyone.
  const [assets, comments, allocations, changes, maintenance, breakers, circuits,
    breakerTypes, spaceLinks, spaceGroups, photos, audit, auditCount, config, revisions] = [
    await tx`select id, rev, data from assets order by position`,
    await tx`select asset_id, data from comments order by asset_id, position`,
    await tx`select asset_id, data from allocations order by asset_id, position`,
    await tx`select asset_id, data from changes order by asset_id, position`,
    await tx`select asset_id, data from maintenance order by asset_id, position`,
    await tx`select id, panel_id, data from breakers order by panel_id, position`,
    await tx`select panel_id, breaker_id, data from circuits order by panel_id, position`,
    await tx`select data from breaker_types order by position`,
    await tx`select plan_asset_id, data from space_links order by plan_asset_id, position`,
    await tx`select plan_asset_id, data from space_groups order by plan_asset_id, position`,
    await tx`select data from photos order by position`,
    // The tail of an append-only log is its newest history; seq IS append order.
    await tx`select data from audit_log order by seq desc limit ${AUDIT_READ_LIMIT}`,
    await tx`select count(*)::int as n from audit_log`,
    await tx`select key, value from config`,
    await tx`select domain, rev from revisions`,
  ];

  const commentsBy = groupBy(comments, "asset_id");
  const allocationsBy = groupBy(allocations, "asset_id");
  const changesBy = groupBy(changes, "asset_id");
  const maintenanceBy = groupBy(maintenance, "asset_id");
  const breakersBy = groupBy(breakers, "panel_id");
  const circuitsByBreaker = groupBy(circuits.filter((c: Row) => c.breaker_id !== null), "breaker_id");
  const unassignedBy = groupBy(circuits.filter((c: Row) => c.breaker_id === null), "panel_id");
  const linksBy = groupBy(spaceLinks, "plan_asset_id");
  const groupsBy = groupBy(spaceGroups, "plan_asset_id");
  const data = (rows: Row[] | undefined) => (rows || []).map((r) => r.data);

  const cfg: Row = {};
  for (const r of config) cfg[r.key] = r.value;

  const payload: Row = {
    assets: assets.map((a: Row) => ({
      ...a.data,
      // The asset's version, posted back by a per-record save (Phase 2b).
      _rev: Number(a.rev),
      comments: data(commentsBy.get(a.id)),
      changes: data(changesBy.get(a.id)),
      allocations: data(allocationsBy.get(a.id)),
      maintenanceItems: data(maintenanceBy.get(a.id)),
      breakers: (breakersBy.get(a.id) || []).map((b) => ({ ...b.data, circuits: data(circuitsByBreaker.get(b.id)) })),
      unassignedCircuits: data(unassignedBy.get(a.id)),
      floorPlanLinks: data(linksBy.get(a.id)),
      floorPlanGroups: data(groupsBy.get(a.id)),
    })),
    auditLog: audit.map((r: Row) => r.data).reverse(),
    auditTotal: auditCount[0].n,
    breakerTypes: data(breakerTypes),
    photos: data(photos),
  };
  for (const k of CONFIG_KEYS) payload[k] = cfg[k] || null;
  payload.nextAssetNumber = cfg.nextAssetNumber || null;
  payload.revisions = revisionsFrom(revisions);
  return payload;
}

// Every domain named, a missing or malformed counter read as 0 -- the shape the
// client posts back as _revisions.
const revisionsFrom = (rows: Row[]) => {
  const rev: Row = {};
  for (const r of rows) rev[r.domain] = r.rev;
  return Object.fromEntries(REVISION_DOMAINS.map((d) => [d, Number(rev[d]) > 0 ? Math.floor(rev[d]) : 0]));
};

// op:"revisions": the counters alone, for the live refresh. A few dozen bytes,
// so a client can ask often and run a full read only when one has moved.
export async function readRevisions(tx: Tx) {
  return revisionsFrom(await tx`select domain, rev from revisions`);
}

// handleAuditFull_: the WHOLE log, oldest first, for the views that must never
// quietly drop rows (an asset's own history, the master Audit tab, the export).
// No lock, unlike the Sheet's: a transaction already reads one instant.
//
// The Sheet answers this op through pickPublic_, which names EVERY audit field
// and writes "" for a blank, where the ordinary read leaves a blank field out.
// Rows are stored in the read's shape, so the blanks are put back here.
export async function readAuditFull(tx: Tx) {
  const rows = await tx`select data from audit_log order by seq`;
  const auditLog = rows.map((r: Row) =>
    Object.fromEntries(AUDIT_FIELDS.map((f) => [f, r.data[f] === undefined || r.data[f] === null ? "" : r.data[f]])));
  return { auditLog, auditTotal: rows.length };
}
