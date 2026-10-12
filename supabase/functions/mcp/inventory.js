// One tenant's inventory, read from the Phase 1 tables into memory and given
// the handful of lookups every tool needs: names, paths, "inside this place",
// and turning what a person typed ("Room 101", "BCA0042") into an asset.
//
// Pure: it is handed rows and never touches a database, so the whole of it is
// covered by test-mcp-connector.mjs with fixture rows.
//
// WHY LOAD EVERYTHING: a tenant is a few hundred assets, and the rules that
// make a name or a path (person name parts, legacy name columns, the parent
// chain) are far easier to keep in step with the app in JS than in SQL. The
// audit log is the one table that grows without bound; when a tenant's log
// makes this slow, filter it in SQL first (index.ts) rather than here.

import { dateOnly } from "./from-app.js";

const MAX_PARENT_DEPTH = 50;

// Built-in types whose id is their own name, so a sheet with no typesList still
// reads. Anything else falls back to its id.
const PERSON_TYPES = new Set(["User"]);

export function buildInventory({ assets = [], config = [] }) {
  const byId = new Map();
  const children = new Map();
  const cfg = {};
  for (const r of config) cfg[r.key] = r.value;

  const list = assets
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((r) => ({ ...r.data, id: r.id, parentId: r.parent_id ?? r.data?.parentId ?? "" }));
  for (const a of list) byId.set(a.id, a);
  for (const a of list) {
    const p = a.parentId && byId.has(a.parentId) ? a.parentId : "";
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(a);
  }

  const typesList = Array.isArray(cfg.typesList) ? cfg.typesList : [];
  const typeName = (id) => {
    const t = typesList.find((x) => (typeof x === "string" ? x : x?.id) === id);
    if (t && typeof t === "object" && t.name) return t.name;
    return id || "";
  };

  const isPerson = (a) =>
    PERSON_TYPES.has(a?.type) || !!(a?.firstName || a?.lastName);

  // The app's nameOf, minus the reading-order setting (a person reads
  // "First Last" here). The legacy per-type columns are the fallback the app's
  // load-time adoptLegacyNames fills `name` from, so an un-saved legacy row
  // still has its name.
  const nameOf = (a) => {
    if (!a) return "";
    if (isPerson(a)) {
      const composed = [a.firstName, a.lastName].map((s) => String(s || "").trim()).filter(Boolean).join(" ");
      if (composed) return composed;
    }
    for (const k of ["name", "room", "building", "campus", "itemName"]) {
      const v = String(a[k] || "").trim();
      if (v) return v;
    }
    const tag = String(a.tag || a.label || "").trim();
    if (tag) return tag;
    return `${typeName(a.type)} ${String(a.id).slice(0, 8)}`.trim();
  };

  // Outermost first, never including the asset itself, loop-safe.
  const ancestorsOf = (a) => {
    const out = [];
    const seen = new Set([a.id]);
    let cur = a;
    while (cur && cur.parentId && byId.has(cur.parentId) && !seen.has(cur.parentId) && out.length < MAX_PARENT_DEPTH) {
      seen.add(cur.parentId);
      cur = byId.get(cur.parentId);
      out.unshift(cur);
    }
    return out;
  };
  const pathOf = (a) => ancestorsOf(a).map(nameOf).join(" › ");

  // "This place and everything beneath it", the app's inHierarchyScope.
  const inScope = (a, scopeId) =>
    !scopeId || a.id === scopeId || ancestorsOf(a).some((x) => x.id === scopeId);

  const isArchived = (a) => String(a?.status || "") === "Archived";

  const personNames = (a) => {
    const ids = Array.isArray(a.personIds) ? a.personIds : [];
    const named = ids.map((id) => byId.get(id)).filter(Boolean).map(nameOf);
    if (named.length) return named;
    return String(a.person || "").split("/").map((s) => s.trim()).filter(Boolean);
  };

  // Turn what someone typed into ONE asset: id, then tag/label, then the
  // name, then the full path. Two matches is an answer of its own
  // ("which one?"), never the first one.
  const resolve = (ref) => {
    const q = String(ref ?? "").trim();
    if (!q) return { error: "No asset named." };
    if (byId.has(q)) return { asset: byId.get(q) };
    const lq = q.toLowerCase();
    const tiers = [
      (a) => [a.tag, a.label].some((v) => v && String(v).trim().toLowerCase() === lq),
      (a) => nameOf(a).toLowerCase() === lq,
      (a) => [pathOf(a), nameOf(a)].filter(Boolean).join(" › ").toLowerCase() === lq,
    ];
    for (const test of tiers) {
      const hits = list.filter(test);
      if (hits.length === 1) return { asset: hits[0] };
      if (hits.length > 1) {
        return {
          error: `"${q}" matches ${hits.length} assets. Use one of these ids instead.`,
          matches: hits.slice(0, 20).map(summary),
        };
      }
    }
    return { error: `No asset matches "${q}". Try search_assets.` };
  };

  const summary = (a) => ({
    id: a.id,
    name: nameOf(a),
    type: typeName(a.type),
    tag: a.tag || undefined,
    location: pathOf(a) || undefined,
    status: a.status || undefined,
  });

  // Every scalar field with a value, under the label the app shows for it.
  // Custom columns are real fields too, so they come through the same way.
  const columns = Array.isArray(cfg.columns) ? cfg.columns : [];
  const labelFor = (key) => columns.find((c) => c?.key === key)?.label || key;
  const refKeys = new Set(columns.filter((c) => c?.key && c.dataType === "reference").map((c) => c.key));
  const HIDDEN = new Set([
    "id", "label", "tag", "name", "type", "parentId", "parent", "status",
    "personIds", "person", "firstName", "lastName", "room", "building", "campus",
    "itemName", "roomId", "buildingId",
  ]);
  const fieldsOf = (a) => {
    const out = {};
    for (const [k, v] of Object.entries(a)) {
      if (HIDDEN.has(k) || v === null || v === undefined || v === "") continue;
      if (typeof v === "object") continue;
      // A Reference field stores an asset id; say which asset it is.
      if (refKeys.has(k) && byId.has(v)) { out[labelFor(k)] = `${nameOf(byId.get(v))} (${v})`; continue; }
      out[labelFor(k)] = /date|until/i.test(k) ? dateOnly(v) : v;
    }
    return out;
  };

  return {
    list, byId, children, cfg, typeName, nameOf, pathOf, ancestorsOf,
    inScope, isArchived, personNames, resolve, summary, fieldsOf,
  };
}
