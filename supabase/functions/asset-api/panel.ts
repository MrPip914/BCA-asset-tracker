// publicPanelPayload_: the ANONYMOUS read behind GET ?panel=<code>, which the
// QR sticker inside a panel door opens (panel.html). One panel and nothing else.
//
// The whitelists are the entire privacy boundary, exactly as in the .gs:
// everything is COPIED by name onto fresh objects, so a field added to a table
// later is invisible here until someone adds it to a list below. The lists are
// copies, pinned to the .gs by panel_test.ts.
//
// Rows are stored in the read's shape (snapshot-rows), so this works from
// `data` rather than from Sheet cells; panel_test.ts runs the .gs's own
// function over the same Sheet and requires the answers to be equal.

import type { Tx } from "./db.ts";

export const PUBLIC_PANEL_FIELDS = ["tag", "label", "panelSlotCount", "panelLayout", "panelPhases", "panelVoltage"];
export const PUBLIC_BREAKER_FIELDS = ["id", "cells", "ampRating", "groupId", "breakerTypeId", "notes"];
export const PUBLIC_CIRCUIT_FIELDS = ["id", "breakerId", "label", "roomsServedIds", "feedsPanelLabel", "notes", "tag", "wireColor"];
export const PUBLIC_BREAKER_TYPE_FIELDS = ["id", "name", "slotSpan", "members"];
export const PUBLIC_PHOTO_FIELDS = ["id", "ownerType", "ownerId", "url", "thumbUrl", "caption", "width", "height"];

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

// pickPublic_: only the named fields, a missing one as "".
const pick = (src: Row, fields: string[]) =>
  Object.fromEntries(fields.map((f) => [f, src[f] === undefined || src[f] === null ? "" : src[f]]));
const list = (v: unknown) => (Array.isArray(v) ? v : []).map((s) => String(s).trim()).filter(Boolean);
const keyOf = (a: Row) => a.id || a.label;
const nameOf = (a: Row | null) => (a ? String(a.name || "").trim() : "");

// nearestAncestorRow_: loop-safe, as the walk is on a PUBLIC page.
function nearestAncestor(start: Row, byKey: Map<string, Row>, type: string) {
  const seen = new Set<string>();
  let cur = byKey.get(String(start.parentId || "").trim());
  for (let depth = 0; cur && !seen.has(keyOf(cur)) && depth < 50; depth++) {
    if (cur.type === type) return cur;
    seen.add(keyOf(cur));
    cur = byKey.get(String(cur.parentId || "").trim());
  }
  return null;
}

export async function publicPanel(tx: Tx, requested: unknown, scriptVersion: string) {
  const wanted = String(requested || "").trim().toUpperCase();
  if (!wanted) return { ok: false, error: "No panel specified." };

  const assets: Row[] = (await tx`select data from assets order by position`).map((r: Row) => r.data);
  // The key, the tag or the label: a sticker outlives all three.
  const panelRow = assets.find((a) => {
    if (a.type !== "Electrical Panel") return false;
    const up = (v: unknown) => String(v || "").trim().toUpperCase();
    return [up(a.id), up(a.tag), up(a.label)].some((v) => v && v === wanted);
  });
  // The same message whether the code names a non-panel or nothing at all.
  if (!panelRow) return { ok: false, error: "No electrical panel found for that code." };

  const byKey = new Map<string, Row>(assets.map((a) => [keyOf(a), a]));
  const panelKey = keyOf(panelRow);

  const allBreakers: Row[] = await tx`select id, panel_id, data from breakers order by panel_id, position`;
  const circuits: Row[] = await tx`select panel_id, breaker_id, data from circuits order by panel_id, breaker_id nulls last, position`;

  const publicCircuit = (c: Row) => {
    const p = pick({ ...c.data, roomsServedIds: list(c.data.roomsServedIds) }, PUBLIC_CIRCUIT_FIELDS);
    p.breakerId = c.breaker_id ?? "";
    return p;
  };
  const breakers = allBreakers.filter((b) => b.panel_id === panelKey).map((b) => {
    const p: Row = pick(b.data, PUBLIC_BREAKER_FIELDS);
    p.cells = list(b.data.cells);
    p.circuits = circuits.filter((c) => c.breaker_id === b.id).map(publicCircuit);
    return p;
  });
  const unassignedCircuits = circuits.filter((c) => c.breaker_id === null && c.panel_id === panelKey).map(publicCircuit);

  // Only the catalog entries this panel places.
  const used = new Set(breakers.map((b) => b.breakerTypeId).filter(Boolean));
  const breakerTypes = (await tx`select data from breaker_types order by position`)
    .map((r: Row) => r.data)
    .filter((t: Row) => used.has(t.id))
    .map((t: Row) => ({ ...pick(t, PUBLIC_BREAKER_TYPE_FIELDS), members: Array.isArray(t.members) ? t.members : [] }));

  const panel: Row = pick(panelRow, PUBLIC_PANEL_FIELDS);
  const panelRoom = nearestAncestor(panelRow, byKey, "Room");
  panel.roomName = nameOf(panelRoom);
  panel.buildingName = nameOf(nearestAncestor(panelRow, byKey, "Building"));

  // Room NAMES for just the rooms this panel references -- a lookup, not a directory.
  const roomName = new Map(assets.filter((a) => a.type === "Room").map((a) => [keyOf(a), nameOf(a)]));
  const referenced = new Set<string>();
  for (const c of [...breakers.flatMap((b) => b.circuits), ...unassignedCircuits]) for (const id of c.roomsServedIds) referenced.add(id);
  if (panelRoom) referenced.add(keyOf(panelRoom));
  const rooms: Row = {};
  for (const id of referenced) if (roomName.has(id)) rooms[id] = roomName.get(id);

  // "Fed from": which circuit anywhere feeds this panel. Only its panel's code
  // and room and the feeding breaker's cells go out.
  let fedFrom: Row | null = null;
  const feeding = circuits.find((c) => c.data.feedsPanelLabel === panelKey);
  if (feeding) {
    const feedingBreaker = feeding.breaker_id ? allBreakers.find((b) => b.id === feeding.breaker_id) : undefined;
    const upstreamKey = feedingBreaker ? feedingBreaker.panel_id : (feeding.panel_id || "");
    const upstream = assets.find((a) => keyOf(a) === upstreamKey && a.type === "Electrical Panel");
    fedFrom = {
      panelLabel: (upstream && (upstream.tag || upstream.label)) || upstreamKey,
      panelRoomName: upstream ? nameOf(nearestAncestor(upstream, byKey, "Room")) : "",
      circuitLabel: feeding.data.label || "",
      cells: feedingBreaker ? list(feedingBreaker.data.cells) : [],
    };
  }

  // Photos scoped to what is ALREADY in this payload, hidden ones and
  // documents dropped first, so a change to the scope cannot route around them.
  const owners = new Set<string>([panelKey]);
  for (const b of breakers) { owners.add(b.id); for (const c of b.circuits) owners.add(c.id); }
  for (const c of unassignedCircuits) owners.add(c.id);
  const photos = (await tx`select data from photos order by position`)
    .map((r: Row) => r.data)
    .filter((ph: Row) => ph.hiddenFromPublic !== true && String(ph.hiddenFromPublic) !== "true")
    .filter((ph: Row) => (ph.kind || "image") === "image")
    .filter((ph: Row) => owners.has(ph.ownerId))
    .map((ph: Row) => pick(ph, PUBLIC_PHOTO_FIELDS));

  return { ok: true, scriptVersion, panel, breakers, unassignedCircuits, breakerTypes, rooms, photos, fedFrom };
}
