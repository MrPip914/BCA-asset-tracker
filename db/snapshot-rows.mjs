// Turns an inventory snapshot (the shape doGet returns) into rows for the
// tables in db/migrations/. Pure, so it is covered by db/test-import.mjs, and
// shaped so the save path can reuse it: a save is this same snapshot, diffed
// against what these rows say is stored.
//
// What `data` holds: the record EXACTLY as doGet hands it to the app, minus the
// nested arrays that became tables of their own. The real columns beside it are
// copies the server queries on, never a second source of truth.

import crypto from "node:crypto";

// The child arrays each asset carries, and so does NOT keep in its own `data`.
const ASSET_CHILD_KEYS = [
  "comments", "changes", "allocations", "maintenanceItems",
  "breakers", "unassignedCircuits", "floorPlanLinks", "floorPlanGroups",
];

const without = (obj, keys) => {
  const out = {};
  for (const k of Object.keys(obj)) if (!keys.includes(k)) out[k] = obj[k];
  return out;
};

const blankToNull = (v) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v));

// A work entry or task written before v34 has a blank id, which the frontend
// fills with crypto.randomUUID() on every load. A table key cannot be blank, so
// one is minted here -- DETERMINISTICALLY, from where the record sits, so a
// re-import produces the same id and the import stays idempotent. It names
// nothing anywhere else (a photo naming a blank-id record was already orphaned
// by the random adoption; see CLAUDE.md "a photo row and the id it names").
const mintId = (tenantId, kind, assetId, position) =>
  "imp-" + crypto.createHash("sha256").update([tenantId, kind, assetId, position].join("\u0000"))
    .digest("hex").slice(0, 32);

export function snapshotToRows(tenantId, snap) {
  const { payload, configRaw, authUsers, tabHashPrefix, revisionPrefix } = snap;
  const warnings = [];
  const t = {
    assets: [], comments: [], allocations: [], changes: [], maintenance: [],
    breakers: [], circuits: [], breaker_types: [], space_links: [], space_groups: [],
    photos: [], audit_log: [], config: [], revisions: [], auth_users: [],
  };

  // A duplicate key would abort the whole load on a primary-key violation with
  // no hint of which record. Caught here instead, keeping the FIRST: that is
  // the one doGet's .filter() would have matched for anything joining on it.
  const seen = {};
  const firstOf = (table, key, what) => {
    const k = table + "\u0000" + key;
    if (seen[k]) { warnings.push(`${what}: duplicate key "${key}" -- kept the first, dropped this one.`); return false; }
    seen[k] = true;
    return true;
  };

  payload.assets.forEach((a, position) => {
    const id = a.id || a.label;
    if (!id) { warnings.push(`Asset at row ${position + 2} has neither id nor label -- skipped.`); return; }
    if (!firstOf("assets", id, "Asset")) return;
    t.assets.push({
      id, position,
      label: blankToNull(a.label), tag: blankToNull(a.tag), type: blankToNull(a.type),
      parent_id: blankToNull(a.parentId),
      data: without(a, ASSET_CHILD_KEYS),
    });

    (a.comments || []).forEach((c, i) => t.comments.push({ asset_id: id, position: i, data: c }));
    (a.allocations || []).forEach((al, i) => t.allocations.push({ asset_id: id, position: i, data: al }));

    (a.changes || []).forEach((c, i) => {
      const cid = c.id || mintId(tenantId, "change", id, i);
      if (!c.id) warnings.push(`Work entry ${i + 1} on ${id} had no id -- minted ${cid}.`);
      if (!firstOf("changes", cid, `Work entry on ${id}`)) return;
      t.changes.push({ id: cid, asset_id: id, position: i, data: { ...c, id: cid } });
    });
    (a.maintenanceItems || []).forEach((m, i) => {
      const mid = m.id || mintId(tenantId, "maintenance", id, i);
      if (!m.id) warnings.push(`Task ${i + 1} on ${id} had no id -- minted ${mid}.`);
      if (!firstOf("maintenance", mid, `Task on ${id}`)) return;
      t.maintenance.push({ id: mid, asset_id: id, position: i, data: { ...m, id: mid } });
    });

    const pushCircuit = (c, breakerId, i) => {
      if (!c.id) { warnings.push(`A circuit on panel ${id} has no id -- skipped.`); return; }
      if (!firstOf("circuits", c.id, `Circuit on ${id}`)) return;
      t.circuits.push({ id: c.id, panel_id: id, breaker_id: breakerId, position: i, data: c });
    };
    (a.breakers || []).forEach((b, i) => {
      if (!b.id) { warnings.push(`A breaker on panel ${id} has no id -- skipped with its circuits.`); return; }
      if (!firstOf("breakers", b.id, `Breaker on ${id}`)) return;
      t.breakers.push({ id: b.id, panel_id: id, position: i, data: without(b, ["circuits"]) });
      (b.circuits || []).forEach((c, ci) => pushCircuit(c, b.id, ci));
    });
    (a.unassignedCircuits || []).forEach((c, i) => pushCircuit(c, null, i));

    (a.floorPlanLinks || []).forEach((l, i) => {
      // The Sheet kept one row per shape by REPLACING; here the shape is part of
      // the key, so a second row for it is a duplicate.
      if (!firstOf("space_links", id + "\u0000" + l.shapeId, `Floor plan link on ${id}`)) return;
      t.space_links.push({ plan_asset_id: id, shape_id: String(l.shapeId), position: i, data: l });
    });
    (a.floorPlanGroups || []).forEach((g, i) => {
      if (!g.id) { warnings.push(`A floor plan group on ${id} has no id -- skipped.`); return; }
      if (!firstOf("space_groups", g.id, `Floor plan group on ${id}`)) return;
      t.space_groups.push({ id: g.id, plan_asset_id: id, position: i, data: g });
    });
  });

  (payload.breakerTypes || []).forEach((bt, position) => {
    if (!bt.id || !firstOf("breaker_types", bt.id, "Breaker type")) return;
    t.breaker_types.push({ id: bt.id, position, data: bt });
  });

  (payload.photos || []).forEach((ph, position) => {
    if (!ph.id) { warnings.push(`Photo row ${position + 2} has no id -- skipped.`); return; }
    if (!firstOf("photos", ph.id, "Photo")) return;
    t.photos.push({
      id: ph.id, position,
      owner_type: blankToNull(ph.ownerType), owner_id: blankToNull(ph.ownerId),
      kind: ph.kind || "image", hidden_from_public: ph.hiddenFromPublic === true,
      data: ph,
    });
  });

  // In append order, which IS chronological order. The loader keeps it.
  (payload.auditLog || []).forEach((r) => t.audit_log.push({
    asset_id: blankToNull(r.assetLabel), at: blankToNull(r.at), by: blankToNull(r.by),
    action: blankToNull(r.action), data: r,
  }));

  // EVERY Config key comes across, not only the ones doGet names -- a key the
  // client does not know is preserved, never dropped (the v37 lesson). Three
  // kinds are left behind on purpose: tab hashes (a diff-on-write needs none),
  // revision counters (their own table), and the allowlist (its own table).
  for (const [key, raw] of Object.entries(configRaw)) {
    if (key.startsWith(tabHashPrefix) || key.startsWith(revisionPrefix) || key === "authUsers") continue;
    let value;
    if (raw === "" || raw === null || raw === undefined) value = null;
    else {
      try { value = JSON.parse(raw); }
      catch {
        // doGet reads an unparseable value as absent. Kept here as the string it
        // is, so a hand-edited cell is not destroyed by the move.
        value = String(raw);
        warnings.push(`Config "${key}" is not JSON -- kept as a plain string.`);
      }
    }
    t.config.push({ key, value });
  }

  for (const [domain, rev] of Object.entries(payload.revisions || {})) t.revisions.push({ domain, rev });

  authUsers.forEach((u) => t.auth_users.push({ email: u.email, role: u.role, name: u.name || "" }));

  // Every row carries its tenant; set once here rather than at fifteen sites.
  for (const rows of Object.values(t)) rows.forEach((r) => { r.tenant_id = tenantId; });
  return { tables: t, warnings };
}
