// What a save STORES: the posted snapshot, reshaped into exactly what
// AssetTrackerSync.gs's read would hand back after its doPost had written it.
//
// The rule from DATABASE_BACKEND_PLAN.md ("normalise on write to the exact
// shapes doGet returns today") is met literally rather than by a hand-written
// field list: each record goes through the .gs WRITE projection (doPost's
// `xxxRows.push({...})`), then through the Sheet's cell rule (writeTable_: a
// header the row lacks, or a null, becomes ""), then through the .gs READ
// (handleAuthenticatedRead_'s mapping). So a field doPost drops is dropped
// here, a blank reads back the way it does today, and the app cannot tell which
// backend it saved through. The parity test in api_test.ts runs the .gs doPost
// and read over the same body and requires the two to agree.
//
// Two things here are copies of lists in the .gs, and both are pinned to it by
// api_test.ts: ASSET_FIELDS and AUDIT_FIELDS.

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

// AssetTrackerSync.gs ASSET_FIELDS. The Assets tab's columns are these plus the
// custom columns; anything else on a posted asset is dropped, exactly as the
// Sheet drops a value with no column to land in.
export const ASSET_FIELDS = [
  "id", "tag", "label", "name", "firstName", "lastName",
  "type", "subType", "screenSize", "hostname", "parentId",
  "brand", "model", "serial", "person", "personIds", "peripherals", "notes",
  "totalQuantity", "purchaseDate", "warrantyUntil", "status",
  "panelSlotCount", "panelLayout", "panelPhases", "panelVoltage",
  "floorPlanUrl", "floorPlanStorageKey", "floorPlanFileName", "floorPlanRotation",
  "mapSelectMode", "mapSelectTargets", "mapPlanId", "mapX", "mapY",
];

export const AUDIT_FIELDS = [
  "assetLabel", "assetType", "action", "field", "from", "to",
  "room", "quantity", "previousQuantity", "note", "at", "by", "related",
];

const COMMENT_FIELDS = ["assetLabel", "text", "at", "by"];
const CHANGE_FIELDS = ["assetLabel", "id", "changeType", "vendor", "cost", "note", "at", "by", "maintenanceId", "performedOn"];
const ALLOCATION_FIELDS = ["assetLabel", "room", "quantity"];
const MAINTENANCE_FIELDS = [
  "assetLabel", "id", "kind", "task", "notes", "frequencyLabel", "frequencyDays",
  "recurrence", "dueDate", "lastPerformed", "owner", "at", "by",
];
const BREAKER_FIELDS = ["id", "panelLabel", "cells", "ampRating", "status", "serial", "installedDate", "notes", "groupId", "breakerTypeId"];
const CIRCUIT_FIELDS = ["id", "breakerId", "panelLabel", "label", "roomsServed", "feedsPanelLabel", "notes", "tag", "wireColor", "sharedNeutralWith"];
const SPACE_LINK_FIELDS = ["assetLabel", "shapeId", "roomId", "at", "by"];
const SPACE_GROUP_FIELDS = ["id", "assetLabel", "name", "hideLabel", "memberShapeIds", "at", "by"];
const BREAKER_TYPE_FIELDS = ["id", "name", "slotSpan", "members"];
const PHOTO_FIELDS = [
  "id", "ownerType", "ownerId", "url", "thumbUrl", "storageKey", "kind", "fileName",
  "caption", "width", "height", "bytes", "hiddenFromPublic", "at", "by",
];

// writeTable_ then readTable_: the row as the Sheet hands it back -- exactly
// these headers, a missing or null value as "". readTable_ also skips a row
// whose every cell is blank, which `tab` below does.
const asCells = (row: Row, headers: string[]): Row => {
  const out: Row = {};
  for (const h of headers) out[h] = row[h] === undefined || row[h] === null ? "" : row[h];
  return out;
};
const tab = (rows: Row[], headers: string[]) =>
  rows.map((r) => asCells(r, headers)).filter((r) => Object.values(r).some((v) => v !== "" && v !== null));

// An array written into one cell, the way doPost joins it. A value that is not
// an array goes in as it stands instead of throwing on .join.
const joined = (v: unknown) => (Array.isArray(v) ? v.join(",") : v);
const split = (v: unknown) => String(v).split(",").map((s) => s.trim());

// readTable_'s rows joined by a key, in tab order -- the same rows the .gs
// read's `.filter(r => r.key === label)` picks, without its O(n*m) scan.
const by = (rows: Row[], key: string) => {
  const out = new Map<unknown, Row[]>();
  for (const r of rows) {
    if (!out.has(r[key])) out.set(r[key], []);
    out.get(r[key])!.push(r);
  }
  return (k: unknown) => out.get(k) || [];
};

// customColumnKeys_: the request's own column list wins, then the stored one.
export function customColumnKeys(bodyColumns: unknown, storedColumns: unknown): string[] {
  let columns: unknown = Array.isArray(bodyColumns) ? bodyColumns : storedColumns;
  if (typeof columns === "string") {
    try { columns = JSON.parse(columns); } catch (_err) { columns = []; }
  }
  const keys: string[] = [];
  for (const c of Array.isArray(columns) ? columns : []) {
    const key = c && c.custom && c.key ? String(c.key) : "";
    if (key && !ASSET_FIELDS.includes(key) && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

// The assets, with every child array, as the .gs read would answer them.
export function shapeAssets(posted: Row[], customKeys: string[]): Row[] {
  const assets = (posted || []).filter((a) => a && typeof a === "object");
  const assetRows = tab(
    assets.map((a) => (Array.isArray(a.personIds) ? { ...a, personIds: a.personIds.join(",") } : a)),
    ASSET_FIELDS.concat(customKeys),
  );

  const comments: Row[] = [], changes: Row[] = [], allocations: Row[] = [], maintenance: Row[] = [];
  const breakers: Row[] = [], circuits: Row[] = [], links: Row[] = [], groups: Row[] = [];
  for (const a of assets) {
    const key = a.id || a.label;
    for (const c of a.comments || []) comments.push({ assetLabel: key, text: c.text, at: c.at, by: c.by || "" });
    for (const c of a.changes || []) {
      changes.push({
        assetLabel: key, changeType: c.changeType, vendor: c.vendor || "", cost: c.cost || "", note: c.note || "", at: c.at, by: c.by || "",
        id: c.id || "", maintenanceId: c.maintenanceId || "", performedOn: c.performedOn || "",
      });
    }
    for (const al of a.allocations || []) allocations.push({ assetLabel: key, room: al.roomId, quantity: al.quantity });
    for (const m of a.maintenanceItems || []) {
      maintenance.push({
        assetLabel: key, id: m.id || "", kind: m.kind || "", task: m.task, notes: m.notes || "",
        frequencyLabel: m.frequencyLabel, frequencyDays: m.frequencyDays, recurrence: m.recurrence || "",
        dueDate: m.dueDate || "", lastPerformed: m.lastPerformed || "", owner: m.owner || "", at: m.at, by: m.by || "",
      });
    }
    const circuitRow = (c: Row, breakerId: unknown) => ({
      id: c.id, breakerId, panelLabel: key, label: c.label,
      roomsServed: joined(c.roomsServedIds || []), feedsPanelLabel: c.feedsPanelLabel || "",
      notes: c.notes || "", tag: c.tag || "", wireColor: c.wireColor || "",
      sharedNeutralWith: joined(c.sharedNeutralWithIds || []),
    });
    for (const b of a.breakers || []) {
      breakers.push({
        id: b.id, panelLabel: key, cells: joined(b.cells || []),
        ampRating: b.ampRating, status: b.status, serial: b.serial || "",
        installedDate: b.installedDate || "", notes: b.notes || "",
        groupId: b.groupId || "", breakerTypeId: b.breakerTypeId || "",
      });
      for (const c of b.circuits || []) circuits.push(circuitRow(c, b.id));
    }
    for (const c of a.unassignedCircuits || []) circuits.push(circuitRow(c, ""));
    for (const l of a.floorPlanLinks || []) {
      links.push({ assetLabel: key, shapeId: l.shapeId, roomId: l.roomId || "", at: l.at || "", by: l.by || "" });
    }
    for (const g of a.floorPlanGroups || []) {
      groups.push({
        id: g.id, assetLabel: key, name: g.name || "", hideLabel: g.hideLabel ? "true" : "",
        memberShapeIds: joined(g.memberShapeIds || []), at: g.at || "", by: g.by || "",
      });
    }
  }

  // ---- and back out, as handleAuthenticatedRead_ reads them.
  const commentsOf = by(tab(comments, COMMENT_FIELDS), "assetLabel");
  const changesOf = by(tab(changes, CHANGE_FIELDS), "assetLabel");
  const allocationsOf = by(tab(allocations, ALLOCATION_FIELDS), "assetLabel");
  const maintenanceOf = by(tab(maintenance, MAINTENANCE_FIELDS), "assetLabel");
  const breakersOf = by(tab(breakers, BREAKER_FIELDS), "panelLabel");
  const circuitRows = tab(circuits, CIRCUIT_FIELDS);
  const circuitsOf = by(circuitRows, "breakerId");
  const unassignedOf = by(circuitRows.filter((c) => String(c.breakerId || "").trim() === ""), "panelLabel");
  const linksOf = by(tab(links, SPACE_LINK_FIELDS), "assetLabel");
  const groupsOf = by(tab(groups, SPACE_GROUP_FIELDS), "assetLabel");
  const circuitOut = (c: Row, label: unknown, breakerId: unknown) => ({
    id: c.id, breakerId, panelLabel: label, label: c.label,
    roomsServedIds: c.roomsServed ? split(c.roomsServed) : [],
    feedsPanelLabel: c.feedsPanelLabel, notes: c.notes,
    tag: c.tag || "", wireColor: c.wireColor || "",
    sharedNeutralWithIds: c.sharedNeutralWith ? split(c.sharedNeutralWith).filter(Boolean) : [],
  });

  return assetRows.map((a) => {
    const label = a.id || a.label;
    return {
      ...a,
      personIds: String(a.personIds || "").split(",").map((s) => s.trim()).filter(Boolean),
      comments: commentsOf(label).map((c) => ({ text: c.text, at: c.at, by: c.by })),
      changes: changesOf(label).map((c) => ({
        changeType: c.changeType, vendor: c.vendor, cost: c.cost, note: c.note, at: c.at, by: c.by,
        id: c.id || "", maintenanceId: c.maintenanceId || "", performedOn: c.performedOn || "",
      })),
      allocations: allocationsOf(label).map((al) => ({ roomId: al.room, quantity: al.quantity })),
      maintenanceItems: maintenanceOf(label).map((m) => ({
        id: m.id || "", kind: m.kind || "", task: m.task, notes: m.notes || "",
        frequencyLabel: m.frequencyLabel, frequencyDays: m.frequencyDays, recurrence: m.recurrence || "",
        dueDate: m.dueDate || "", lastPerformed: m.lastPerformed, owner: m.owner, at: m.at, by: m.by,
      })),
      breakers: breakersOf(label).map((b) => ({
        id: b.id, panelLabel: b.panelLabel,
        cells: b.cells ? split(b.cells) : [],
        ampRating: b.ampRating, status: b.status, serial: b.serial, installedDate: b.installedDate, notes: b.notes,
        groupId: b.groupId, breakerTypeId: b.breakerTypeId,
        circuits: circuitsOf(b.id).map((c) => circuitOut(c, label, c.breakerId)),
      })),
      unassignedCircuits: unassignedOf(label).map((c) => circuitOut(c, label, "")),
      floorPlanLinks: linksOf(label).map((l) => ({ shapeId: l.shapeId, roomId: l.roomId, at: l.at, by: l.by })),
      floorPlanGroups: groupsOf(label).map((g) => ({
        id: g.id, name: g.name, hideLabel: String(g.hideLabel) === "true",
        memberShapeIds: g.memberShapeIds ? split(g.memberShapeIds) : [], at: g.at, by: g.by,
      })),
    };
  });
}

export function shapeBreakerTypes(posted: Row[]): Row[] {
  const rows = tab((posted || []).map((t) => ({
    id: t.id, name: t.name, slotSpan: t.slotSpan, members: JSON.stringify(t.members || []),
  })), BREAKER_TYPE_FIELDS);
  return rows.map((t) => ({ id: t.id, name: t.name, slotSpan: t.slotSpan, members: t.members ? JSON.parse(t.members) : [] }));
}

export function shapePhotos(posted: Row[]): Row[] {
  const rows = tab((posted || []).map((ph) => ({
    id: ph.id, ownerType: ph.ownerType, ownerId: ph.ownerId, url: ph.url,
    thumbUrl: ph.thumbUrl || "", storageKey: ph.storageKey || "", kind: ph.kind || "image",
    fileName: ph.fileName || "", caption: ph.caption || "",
    width: ph.width || "", height: ph.height || "", bytes: ph.bytes || "",
    hiddenFromPublic: ph.hiddenFromPublic ? "true" : "", at: ph.at, by: ph.by || "",
  })), PHOTO_FIELDS);
  return rows.map((ph) => ({
    id: ph.id, ownerType: ph.ownerType, ownerId: ph.ownerId,
    url: ph.url, thumbUrl: ph.thumbUrl || "", storageKey: ph.storageKey || "",
    kind: ph.kind || "image", fileName: ph.fileName || "", caption: ph.caption || "",
    width: ph.width === "" ? undefined : ph.width,
    height: ph.height === "" ? undefined : ph.height,
    bytes: ph.bytes === "" ? undefined : ph.bytes,
    hiddenFromPublic: String(ph.hiddenFromPublic) === "true",
    at: ph.at, by: ph.by,
  }));
}

// appendNewRows_ then the read's audit mapping. JSON-round-tripped so an
// `undefined` field is absent, as it is over the wire.
export function shapeAuditRows(posted: Row[]): Row[] {
  const rows = tab((posted || []).filter((r) => r && typeof r === "object"), AUDIT_FIELDS);
  return rows.map((r) => JSON.parse(JSON.stringify({
    assetLabel: r.assetLabel, assetType: r.assetType, action: r.action,
    field: r.field || undefined, from: r.from || undefined, to: r.to || undefined,
    room: r.room || undefined, quantity: r.quantity === "" ? undefined : r.quantity,
    previousQuantity: r.previousQuantity === "" ? undefined : r.previousQuantity,
    note: r.note || undefined, related: r.related || undefined,
    at: r.at, by: r.by,
  })));
}
