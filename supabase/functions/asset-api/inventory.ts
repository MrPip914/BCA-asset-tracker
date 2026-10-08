// The inventory a read hands back, in the SHAPE handleAuthenticatedRead_
// builds today -- that shape is the contract index.html is written against.
//
// Every record's `data` is already that shape (db/snapshot-rows.mjs stores the
// record exactly as doGet handed it to the app), so this is reassembly, not
// translation: nest each asset's children back under it, in `position` order.
// The parity test in api_test.ts compares the result against doGet's own
// output for the same Sheet.

import type { Tx } from "./db.ts";

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
    await tx`select id, data from assets order by position`,
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
  const rev: Row = {};
  for (const r of revisions) rev[r.domain] = r.rev;

  const payload: Row = {
    assets: assets.map((a: Row) => ({
      ...a.data,
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
  payload.revisions = Object.fromEntries(REVISION_DOMAINS.map((d) => [d, Number(rev[d]) > 0 ? Math.floor(rev[d]) : 0]));
  return payload;
}
