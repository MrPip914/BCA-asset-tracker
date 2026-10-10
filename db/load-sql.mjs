// Turns the rows from snapshot-rows.mjs into ONE SQL script that replaces a
// tenant's data: delete everything the tenant has, then insert. Run with
// `psql --single-transaction`, so the tenant is either wholly replaced or not
// touched at all -- the plan's "truncate-and-load inside one transaction".
//
// Zero dependencies, like the rest of this repo: no Postgres driver, just psql.
// Each table's rows travel as ONE JSON document inside a dollar-quoted literal,
// unpacked with jsonb_array_elements ... WITH ORDINALITY so rows go in in array
// order. That order is load-bearing for audit_log, whose identity `seq` IS its
// chronological order.

import crypto from "node:crypto";

// Column -> SQL type, per table. `jsonb` columns are taken as JSON, the rest as
// text and cast. Every name here must match db/migrations/ -- db/test-import.mjs
// loads a fixture through this into a real Postgres, so a drift fails there.
export const TABLE_COLUMNS = {
  assets: { id: "text", position: "integer", label: "text", tag: "text", type: "text", parent_id: "text", data: "jsonb" },
  comments: { asset_id: "text", position: "integer", data: "jsonb" },
  allocations: { asset_id: "text", position: "integer", data: "jsonb" },
  changes: { id: "text", asset_id: "text", position: "integer", data: "jsonb" },
  maintenance: { id: "text", asset_id: "text", position: "integer", data: "jsonb" },
  breakers: { id: "text", panel_id: "text", position: "integer", data: "jsonb" },
  circuits: { id: "text", panel_id: "text", breaker_id: "text", position: "integer", data: "jsonb" },
  breaker_types: { id: "text", position: "integer", data: "jsonb" },
  space_links: { plan_asset_id: "text", shape_id: "text", position: "integer", data: "jsonb" },
  space_groups: { id: "text", plan_asset_id: "text", position: "integer", data: "jsonb" },
  photos: { id: "text", owner_type: "text", owner_id: "text", kind: "text", hidden_from_public: "boolean", position: "integer", data: "jsonb" },
  audit_log: { asset_id: "text", at: "text", by: "text", action: "text", data: "jsonb" },
  config: { key: "text", value: "jsonb" },
  revisions: { domain: "text", rev: "integer" },
  auth_users: { email: "text", role: "text", name: "text", position: "integer" },
};

// Deleted children first is not required (the foreign keys are deferred and
// cascade), but it keeps the statement order readable as "empty, then fill".
const DELETE_ORDER = [
  "circuits", "breakers", "comments", "allocations", "changes", "maintenance",
  "space_links", "space_groups", "assets", "breaker_types", "photos",
  "audit_log", "config", "revisions", "auth_users",
  // The connector's backups (0010) describe the data being replaced; undoing
  // one onto a fresh import would put old rows over it.
  "connector_backups",
];
const INSERT_ORDER = [
  "assets", "comments", "allocations", "changes", "maintenance", "breakers",
  "circuits", "breaker_types", "space_links", "space_groups", "photos",
  "audit_log", "config", "revisions", "auth_users",
];

const lit = (s) => (s === null || s === undefined ? "null" : "'" + String(s).replace(/'/g, "''") + "'");

// A dollar-quote tag that cannot occur in the payload, so no escaping is needed
// and no inventory text can end the literal early.
const dollarQuote = (text) => {
  let tag;
  do { tag = "$j" + crypto.randomBytes(6).toString("hex") + "$"; } while (text.includes(tag));
  return tag + text + tag;
};

export function loadSql(tenant, tables) {
  const out = [];
  out.push("set search_path = asset_tracker;");
  out.push("set constraints all deferred;");
  out.push(
    `insert into tenants (id, name, owner_email, cloudinary_folder) values (${lit(tenant.id)}, ${lit(tenant.name)}, ${lit(tenant.ownerEmail)}, ${lit(tenant.cloudinaryFolder)})` +
    ` on conflict (id) do update set name = excluded.name, owner_email = excluded.owner_email,` +
    ` cloudinary_folder = coalesce(excluded.cloudinary_folder, tenants.cloudinary_folder);`
  );
  for (const table of DELETE_ORDER) out.push(`delete from ${table} where tenant_id = ${lit(tenant.id)};`);

  for (const table of INSERT_ORDER) {
    const rows = tables[table] || [];
    if (!rows.length) continue;
    const cols = TABLE_COLUMNS[table];
    const names = ["tenant_id", ...Object.keys(cols)];
    const exprs = names.map((c) => {
      if (c === "tenant_id") return "e.v->>'tenant_id'";
      return cols[c] === "jsonb" ? `e.v->'${c}'` : `(e.v->>'${c}')::${cols[c]}`;
    });
    const json = JSON.stringify(rows.map((r) => {
      const o = {};
      names.forEach((c) => { o[c] = r[c] === undefined ? null : r[c]; });
      return o;
    }));
    out.push(
      `insert into ${table} (${names.join(", ")})\n` +
      `  select ${exprs.join(", ")}\n` +
      `  from jsonb_array_elements(${dollarQuote(json)}::jsonb) with ordinality as e(v, n)\n` +
      `  order by e.n;`
    );
  }
  out.push("set constraints all immediate;");
  return out.join("\n") + "\n";
}
