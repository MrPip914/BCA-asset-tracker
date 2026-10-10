// The connector's asset and task MANAGEMENT writes: creating and editing assets
// in bulk, archiving and restoring them, and adding, editing and deleting tasks.
//
// THE RULES ARE THE APP'S OWN, NOT A COPY OF THEM. Asset writes go through the
// Assets import's planner (planAssetImport, in app-rules.js, which
// gen-app-rules.mjs slices out of index.html), so a row Claude sends is checked
// exactly as a spreadsheet row is: the type, every field the type has, data
// types, tags unique across the WHOLE inventory, parent types and loops checked
// against the inventory as it would stand afterwards, people resolved only in
// id mode. And it is audited exactly as an import is: one "edited" row per
// field that moved, one "created" row per new asset.
//
// Pure: handed the rows a tool loaded, returns the changes to make as a list of
// ops for ONE Postgres call (connector_apply, db/migrations/0007). That call
// refuses the whole list if the inventory moved since these rows were read, so
// nothing here can act on a stale picture -- the revision check the app's own
// saves rely on.
//
// MODULE STATE: app-rules.js keeps the type settings in module-level variables,
// as the app does. appView() sets them, so everything from appView() to the
// plan must run without an `await` in between, or another request's settings
// could be in force. Every caller here is synchronous.

import * as R from "./app-rules.js";

// save-shape.ts ASSET_FIELDS (AssetTrackerSync.gs's): what a stored asset row
// holds, plus the custom columns. Pinned to that list by test-mcp-connector.mjs.
export const ASSET_FIELDS = [
  "id", "tag", "label", "name", "firstName", "lastName",
  "type", "subType", "screenSize", "hostname", "parentId",
  "brand", "model", "serial", "person", "personIds", "peripherals", "notes",
  "totalQuantity", "purchaseDate", "warrantyUntil", "status",
  "panelSlotCount", "panelLayout", "panelPhases", "panelVoltage",
  "floorPlanUrl", "floorPlanStorageKey", "floorPlanFileName", "floorPlanRotation",
  "mapSelectMode", "mapSelectTargets", "mapPlanId", "mapX", "mapY",
];

export const MAX_ROWS = 500;

// ------------------------------------------------------------------ the view

// The app's column migration (applySnapshot): rename, drop retired, add new
// defaults. Order only matters for display, so a new default is appended.
export function migrateColumns(stored) {
  let cols = Array.isArray(stored) && stored.length ? stored : R.DEFAULT_COLUMNS;
  cols = cols.map((c) => (
    !c.custom && R.RENAMED_COLUMN_KEYS[c.key]
      ? { ...c, key: R.RENAMED_COLUMN_KEYS[c.key], label: R.DEFAULT_COLUMNS.find((d) => d.key === R.RENAMED_COLUMN_KEYS[c.key])?.label || c.label }
      : c
  ));
  cols = cols.filter((c) => c.custom || !R.RETIRED_COLUMN_KEYS.has(c.key));
  for (const dc of R.DEFAULT_COLUMNS) if (!cols.some((c) => c.key === dc.key)) cols = [...cols, dc];
  return cols;
}

export function customColumnKeys(columns) {
  const keys = [];
  for (const c of columns || []) {
    const key = c && c.custom && c.key ? String(c.key) : "";
    if (key && !ASSET_FIELDS.includes(key) && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

const tagRegex = (prefix) =>
  new RegExp("^" + String(prefix || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\d+)$", "i");

// The inventory as the app holds it after loadData: the same column migration,
// type settings, type list and load-time adoptions (id, tag, personIds, names),
// so the planner sees what a person importing a file in the app would.
export function appView(rows, tenantId) {
  const cfg = {};
  for (const r of rows.config || []) cfg[r.key] = r.value;
  const columns = migrateColumns(cfg.columns);
  R.applyTypeSettings(cfg.typeSettings && typeof cfg.typeSettings === "object" ? cfg.typeSettings : {}, columns);
  const typesList = R.ensureLockedTypes(R.adoptLegacyTypesList(
    Array.isArray(cfg.typesList) && cfg.typesList.length ? cfg.typesList : R.DEFAULT_TYPES,
  ));
  const parented = (rows.assets || [])
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((r) => ({
      comments: [], changes: [], allocations: [], status: "Active", subType: "", purchaseDate: "", warrantyUntil: "",
      ...r.data,
      id: r.id,
      parentId: r.parent_id ?? r.data?.parentId ?? "",
    }))
    .map((a) => {
      if (a.tag !== undefined && a.tag !== null) return a;
      return { ...a, tag: R.fieldAppliesTo("tag", a.type) ? (a.label || "") : "" };
    })
    .map((a) => (Array.isArray(a.personIds) ? a : { ...a, personIds: [] }));
  const assets = R.adoptLegacyNames(R.adoptPersonNames(parented), typesList);

  const usersList = Array.isArray(cfg.usersList) ? cfg.usersList : [];
  const known = new Set(assets.filter((a) => a.type === "User").map(R.personMatchKey));
  const unconverted = [...new Set([
    ...usersList,
    ...assets.flatMap((a) => String(a.person || "").split("/").map((x) => x.trim())),
  ].filter(Boolean))].filter((n) => !known.has(R.personMatchKey(n)));

  const revisions = {};
  for (const r of rows.revisions || []) revisions[r.domain] = Number(r.rev) || 0;

  return {
    tenantId, cfg, columns, typesList, assets,
    byId: new Map(assets.map((a) => [a.id, a])),
    peripheralsList: Array.isArray(cfg.peripheralsList) ? cfg.peripheralsList : [],
    bulkItemTypes: Array.isArray(cfg.bulkItemTypes) ? cfg.bulkItemTypes : [],
    usersAreAssets: assets.some((a) => a.type === "User") && unconverted.length === 0,
    nextAssetNumber: Number(cfg.nextAssetNumber) || 1,
    customKeys: customColumnKeys(columns),
    tagPrefix: R.TENANT_LABEL_PREFIX[tenantId] || "",
    revisions: { assets: revisions.assets || 0, config: revisions.config || 0 },
  };
}

// An asset as its row's `data` stores it: the save's own shape (shapeAssets),
// every field present, a missing one as "", personIds an array.
export function storedAssetData(a, customKeys) {
  const out = {};
  for (const k of ASSET_FIELDS.concat(customKeys || [])) {
    const v = k === "personIds" ? (Array.isArray(a.personIds) ? a.personIds : String(a.personIds || "").split(",").map((s) => s.trim()).filter(Boolean)) : a[k];
    out[k] = v === undefined || v === null ? "" : v;
  }
  return out;
}

const assetOp = (op, a, view) => ({ op, id: a.id, data: storedAssetData(a, view.customKeys) });
const auditOp = (entry) => ({ op: "audit", data: entry });

// ------------------------------------------------------------------ describing

export const describe = (view, a) => ({
  id: a.id,
  name: R.nameOf(a, view.typesList),
  type: R.typeNameOf(a.type, view.typesList),
  tag: a.tag || undefined,
  location: R.pathOf(a, view.assets) || undefined,
  status: a.status === "Archived" ? "Archived" : undefined,
});

// ------------------------------------------------------------------ schema

// What the app knows about this site's shape: the types and the fields each
// one has, which types may sit inside which, every column's kind and choices,
// and the managed lists. What save_assets accepts is exactly this.
export function schemaOf(view) {
  const types = view.typesList.map((t) => {
    const fields = view.columns.filter((c) => c.key !== "type" && R.fieldAppliesTo(c.key, t.id));
    return {
      id: t.id,
      name: t.name,
      fields: fields.map((c) => fieldLabel(c)),
      canSitInside: R.typeTakesParent(t.id) ? R.parentTypesFor(t.id).map((p) => R.typeNameOf(p, view.typesList)) : [],
      canContainThings: R.isPlaceType(t.id) || undefined,
      isPerson: R.isPersonType(t.id) || undefined,
      usesAssetId: R.fieldAppliesTo("tag", t.id) || undefined,
      count: view.assets.filter((a) => a.type === t.id && a.status !== "Archived").length,
      relationshipQueries: relationshipQueriesOf(view, t.id),
    };
  });
  const fields = view.columns.map((c) => ({
    field: fieldLabel(c),
    key: c.key,
    kind: fieldKind(c),
    choices: R.columnDataType(c) === "select" ? R.columnOptions(c) : undefined,
    pointsAt: R.columnDataType(c) === "reference" ? R.columnReferenceTypes(c).map((id) => R.typeNameOf(id, view.typesList)) : undefined,
    custom: c.custom || undefined,
  }));
  return { types, fields };
}

// A type's relationship queries (the Relationships tab), worded for reading:
// the built-in Contents first on a place, then the type's own. Undefined when
// it has none, so the schema stays short.
export function relationshipQueriesOf(view, typeId) {
  const qs = R.relationshipQueriesShownFor(typeId);
  if (!qs.length) return undefined;
  const colLabel = (key) => {
    const c = view.columns.find((x) => x.key === key);
    return c ? fieldLabel(c) : key;
  };
  return qs.map((q) => ({
    name: q.name,
    builtIn: q.builtIn || undefined,
    steps: q.steps.map((st) => ({
      follow: R.relationshipFollowMeta(st.follow).label.replace("…", "<type>"),
      field: st.fieldKey ? colLabel(st.fieldKey) : undefined,
      types: st.typeIds.length ? st.typeIds.map((id) => R.typeNameOf(id, view.typesList)) : undefined,
      shown: st.show ? undefined : false,
    })),
    includeArchived: q.includeArchived || undefined,
    hideWhenEmpty: q.hideWhenEmpty || undefined,
  }));
}

const PARENT_ALIASES = ["location", "location path", "parent", "parent path", "path", "inside", "within"];
const fieldLabel = (c) => (c.key === "parent" ? "Location" : c.key === "person" ? "User" : c.label || c.key);
function fieldKind(c) {
  if (c.key === "parent") return "a place: its full path (Building 100 › Room 101), its name when unique, or its id";
  if (c.key === "person") return "people, by name; several separated by /";
  if (c.key === "peripherals") return "a list, separated by /";
  if (c.key === "type") return "a type name";
  if (c.key === "tag") return "the sticker ID; unique across the site";
  if (R.columnDataType(c) === "reference") return "reference: ONE asset of a pointsAt type, by id, tag, name or full path (stored as its id); blank clears it";
  return R.columnDataType(c);
}

// ------------------------------------------------------------------ save_assets

// What a person or Claude may call a field, mapped to the header the planner
// reads it under.
function fieldNames(view) {
  const map = new Map();
  for (const { header, key, col } of R.importHeadersFor(view.columns)) {
    for (const n of [header, key, col.label, fieldLabel(col)]) {
      if (n && !map.has(String(n).trim().toLowerCase())) map.set(String(n).trim().toLowerCase(), { header, key });
    }
    if (key === "parent") for (const n of PARENT_ALIASES) if (!map.has(n)) map.set(n, { header, key });
    if (key === "person") for (const n of ["users", "people", "assigned to"]) if (!map.has(n)) map.set(n, { header, key });
  }
  return map;
}

const cellText = (v) => (Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean).join("/") : v === null || v === undefined ? "" : String(v).trim());

// What a Reference field's value names: ONE existing asset of one of the
// field's target types. An archived asset is refused, as the form offers none;
// so is the asset itself, and a name two assets share.
export function resolveReference(view, col, value, selfId) {
  const label = fieldLabel(col);
  const targets = R.columnReferenceTypes(col);
  if (!targets.length) return { error: `${label} has no type it points at yet, so it cannot be set.` };
  const names = targets.map((id) => R.typeNameOf(id, view.typesList));
  const wanted = names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " or " + names[names.length - 1];
  const q = String(value).trim();
  const lq = q.toLowerCase();
  const ok = (a) => targets.includes(a.type) && a.status !== "Archived" && a.id !== selfId;
  const direct = view.byId.get(q);
  if (direct) {
    if (ok(direct)) return { id: direct.id };
    const why = direct.id === selfId ? "it cannot point at itself"
      : direct.status === "Archived" ? `${R.nameOf(direct, view.typesList)} is archived`
      : `${R.nameOf(direct, view.typesList)} is a ${R.typeNameOf(direct.type, view.typesList)}`;
    return { error: `${label} must be a ${wanted}; ${why}.` };
  }
  const pool = view.assets.filter(ok);
  const tiers = [
    (a) => String(a.tag || "").trim().toLowerCase() === lq,
    (a) => R.nameOf(a, view.typesList).toLowerCase() === lq,
    (a) => R.fullPathOf(a, view.assets).toLowerCase() === lq,
  ];
  for (const test of tiers) {
    const hits = pool.filter(test);
    if (hits.length === 1) return { id: hits[0].id };
    if (hits.length > 1) return { error: `${label}: "${q}" matches ${hits.length} ${wanted} assets (${hits.slice(0, 5).map((a) => a.id).join(", ")}); give its id.` };
  }
  // Nothing of the right type: say what it DID match, if anything.
  const other = view.assets.find((a) => R.nameOf(a, view.typesList).toLowerCase() === lq || String(a.tag || "").trim().toLowerCase() === lq);
  if (other) {
    const why = other.status === "Archived" && targets.includes(other.type) ? `${R.nameOf(other, view.typesList)} is archived`
      : `${R.nameOf(other, view.typesList)} is a ${R.typeNameOf(other.type, view.typesList)}`;
    return { error: `${label} must be a ${wanted}; ${why}.` };
  }
  return { error: `${label} must be a ${wanted}; no ${wanted} matches "${q}".` };
}

export class PlanError extends Error {
  constructor(message, detail) { super(message); this.detail = detail; }
}

// rows: [{ asset?: <the existing asset's id>, fields: { <field>: value } }].
// A row naming an asset UPDATES it, changing only the fields it gives; a row
// naming none CREATES one. The caller resolves `asset` to an id first.
export function planSaveAssets(view, rows, { assignTags = false } = {}) {
  if (!Array.isArray(rows) || !rows.length) throw new PlanError("Give at least one row.");
  if (rows.length > MAX_ROWS) throw new PlanError(`At most ${MAX_ROWS} rows at a time.`);
  const names = fieldNames(view);
  const headersByKey = new Map(R.importHeadersFor(view.columns).map((h) => [h.key, h.header]));
  const tagHeader = headersByKey.get("tag");
  const typeHeader = headersByKey.get("type");
  const byTag = new Map();
  for (const a of view.assets) if (String(a.tag || "").trim()) byTag.set(String(a.tag).trim().toLowerCase(), a);

  const used = new Set([R.IMPORT_KEY_HEADER]);
  const problems = [];
  const given = rows.map((r, i) => {
    const out = {};
    const fields = r && typeof r.fields === "object" && r.fields ? r.fields : {};
    for (const [name, value] of Object.entries(fields)) {
      const hit = names.get(String(name).trim().toLowerCase());
      if (!hit) { problems.push(`Row ${i + 1}: "${name}" is not a field here. get_schema lists them.`); continue; }
      if (hit.key === "status") { problems.push(`Row ${i + 1}: Status is changed with archive_assets, not here.`); continue; }
      out[hit.header] = cellText(value);
      used.add(hit.header);
    }
    if (!r?.asset) {
      const tag = String(out[tagHeader] || "").trim().toLowerCase();
      const holder = tag && byTag.get(tag);
      if (holder) problems.push(`Row ${i + 1}: Asset ID "${out[tagHeader]}" is already on ${R.nameOf(holder, view.typesList)} (${holder.id}). To change that asset, name it in "asset".`);
      if (!String(out[typeHeader] || "").trim()) problems.push(`Row ${i + 1}: a new asset needs a Type.`);
    } else if (!view.byId.has(r.asset)) {
      problems.push(`Row ${i + 1}: no asset with id "${r.asset}".`);
    }
    return out;
  });
  // A Reference field holds ONE asset's id, and only an asset of a type the
  // field points at. The app's form offers only those, but its import checks
  // nothing here, so the connector does: what was given is resolved (id, tag,
  // name or full path, among assets of those types) and stored as the id.
  const refCols = R.referenceColumns(view.columns).map((c) => [headersByKey.get(c.key), c]).filter(([h]) => h);
  given.forEach((out, i) => {
    for (const [header, col] of refCols) {
      if (!(header in out) || out[header] === "") continue;
      const hit = resolveReference(view, col, out[header], rows[i]?.asset);
      if (hit.error) problems.push(`Row ${i + 1}: ${hit.error}`);
      else out[header] = hit.id;
    }
  });
  if (problems.length) throw new PlanError("Nothing was changed.", problems.slice(0, 50));

  // The next tags the app's add form would suggest, for new rows that use one
  // and were given none.
  let counter = view.nextAssetNumber;
  const tagRe = tagRegex(view.tagPrefix);
  if (assignTags && tagHeader) {
    const taken = new Set(byTag.keys());
    for (const v of given) for (const t of [v[tagHeader]]) if (t) taken.add(t.toLowerCase());
    rows.forEach((r, i) => {
      if (r.asset || String(given[i][tagHeader] || "").trim()) return;
      const typeId = R.resolveImportType(given[i][typeHeader], view.typesList);
      if (!typeId || !R.fieldAppliesTo("tag", typeId)) return;
      let tag;
      do { tag = view.tagPrefix + String(counter++).padStart(4, "0"); } while (taken.has(tag.toLowerCase()));
      taken.add(tag.toLowerCase());
      given[i][tagHeader] = tag;
      used.add(tagHeader);
    });
  }

  // An update row carries the asset's CURRENT value for every column some
  // other row sets and it does not -- a spreadsheet's columns are file-wide,
  // and a blank cell would clear the field. The parent goes as an id, which
  // resolves back to itself without depending on its path being unique.
  const ctx = { assets: view.assets, columns: view.columns, typesList: view.typesList };
  const headers = [...used];
  const parsed = {
    headers,
    rows: rows.map((r, i) => {
      const values = { [R.IMPORT_KEY_HEADER]: r.asset || "" };
      const current = r.asset ? R.assetToImportRow(view.byId.get(r.asset), ctx) : null;
      for (const h of headers) {
        if (h === R.IMPORT_KEY_HEADER) continue;
        if (h in given[i]) values[h] = given[i][h];
        else if (current) {
          const a = view.byId.get(r.asset);
          values[h] = h === headersByKey.get("parent") && a.parentId && view.byId.has(a.parentId) ? a.parentId : current[h];
        } else values[h] = "";
      }
      return { row: i + 1, values };
    }),
  };

  const plan = R.planAssetImport(parsed, {
    assets: view.assets, columns: view.columns, typesList: view.typesList,
    peripheralsList: view.peripheralsList, bulkItemTypes: view.bulkItemTypes, usersAreAssets: view.usersAreAssets,
  });
  // The planner's own notice that the file came from elsewhere names an
  // export; nothing here is a file.
  const warnings = plan.warnings.filter((w) => !/rows? match(es)? nothing here and will be created/.test(w));
  if (plan.errors.length) throw new PlanError("Nothing was changed: fix these and send the whole set again.", plan.errors.slice(0, 50));

  // The ops: each asset in full, then the audit rows the app's import writes.
  const ops = [];
  for (const u of plan.updates) {
    ops.push(assetOp("asset_update", u.next, view));
    for (const ch of u.changes) {
      ops.push(auditOp({
        assetLabel: u.asset.id, assetType: u.next.type, action: "edited", field: ch.label,
        from: ch.from || "—", to: ch.to || "—", related: ch.related || "",
      }));
    }
  }
  for (const c of plan.creates) {
    ops.push(assetOp("asset_create", c.next, view));
    ops.push(auditOp({ assetLabel: c.next.id, assetType: c.next.type, action: "created", related: R.relate({ at: c.next.parentId }) }));
  }
  // The counter moves past any generated tag a new asset now wears, as
  // applyAssetImport does; the database keeps it from going backwards.
  const next = plan.creates.reduce((n, c) => {
    const m = tagRe.exec(String(c.next.tag || "").trim());
    return m ? Math.max(n, parseInt(m[1], 10) + 1) : n;
  }, Math.max(counter, view.nextAssetNumber));
  if (plan.creates.length && next !== view.nextAssetNumber) ops.push({ op: "config", key: "nextAssetNumber", value: next });
  if (plan.newPeripherals.length) ops.push({ op: "config", key: "peripheralsList", value: [...view.peripheralsList, ...plan.newPeripherals] });
  if (plan.newSubTypes.length) ops.push({ op: "config", key: "bulkItemTypes", value: [...view.bulkItemTypes, ...plan.newSubTypes] });

  const projected = [
    ...view.assets.map((a) => plan.updates.find((u) => u.asset.id === a.id)?.next || a),
    ...plan.creates.map((c) => c.next),
  ];
  const after = { ...view, assets: projected };
  return {
    ops,
    summary: {
      updated: plan.updates.map((u) => ({
        ...describe(after, u.next),
        changes: u.changes.map((ch) => ({ field: ch.label, from: ch.from || "—", to: ch.to || "—" })),
      })),
      created: plan.creates.map((c) => ({ row: c.row, ...describe(after, c.next) })),
      unchanged: plan.unchanged,
      newPeripherals: plan.newPeripherals.length ? plan.newPeripherals : undefined,
      newSubTypes: plan.newSubTypes.length ? plan.newSubTypes : undefined,
      warnings: warnings.length ? warnings : undefined,
    },
  };
}

// ------------------------------------------------------------------ archive

// The app's archiveAsset / restoreAsset, for several at once: the status, and
// one "archived" or "restored" audit row naming where it sat.
export function planArchive(view, ids, restore) {
  const ops = [];
  const changed = [], skipped = [];
  for (const id of ids) {
    const a = view.byId.get(id);
    const archived = a.status === "Archived";
    if (archived === !restore) { skipped.push(describe(view, a)); continue; }
    const next = { ...a, status: restore ? "Active" : "Archived" };
    ops.push(assetOp("asset_update", next, view));
    ops.push(auditOp({
      assetLabel: a.id, assetType: a.type, action: restore ? "restored" : "archived",
      related: R.relate({ at: a.parentId }),
    }));
    changed.push(describe(view, a));
  }
  return { ops, changed, skipped };
}

// ------------------------------------------------------------------ tasks

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// The app's formatDateOnly in an en-US browser: "Oct 9, 2026". Anything that
// is not a date is returned as it stands, as the app does.
export function fmtDate(s) {
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : String(s);
}

// The app's saveMaintenanceEdit audit: one maintenance_edited row per field
// that moved, worded as the app words it.
export function taskEditAudit(asset, original, updated, kindOf) {
  const rows = [];
  const add = (field, from, to) => rows.push({
    assetLabel: asset.id, assetType: asset.type, action: "maintenance_edited",
    field: `${original.task} — ${field}`, from, to,
  });
  const kindWord = (k) => (k === "oneoff" ? "One-off" : "Scheduled");
  if (kindOf(original) !== kindOf(updated)) add("Kind", kindWord(kindOf(original)), kindWord(kindOf(updated)));
  if (original.task !== updated.task) add("Task", original.task, updated.task);
  if ((original.notes || "") !== (updated.notes || "")) add("Notes", original.notes || "—", updated.notes || "—");
  if ((original.frequencyLabel || "") !== (updated.frequencyLabel || "")) add("Frequency", original.frequencyLabel || "—", updated.frequencyLabel || "—");
  if ((original.dueDate || "") !== (updated.dueDate || "")) add("Due date", fmtDate(original.dueDate) || "—", fmtDate(updated.dueDate) || "—");
  if ((original.owner || "") !== (updated.owner || "")) add("Owner", original.owner || "—", updated.owner || "—");
  if ((original.lastPerformed || "") !== (updated.lastPerformed || "")) {
    add(kindOf(updated) === "oneoff" ? "Completed" : "Last performed", fmtDate(original.lastPerformed) || "—", fmtDate(updated.lastPerformed) || "—");
  }
  return rows;
}
