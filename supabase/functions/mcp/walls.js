// The wall half of the floor plan tools that needs no network: which edges of
// a plan are outside walls, which way each one faces, and planning a change to
// which wall owns which edges.
//
// The outside-edge rule and the one-edge-one-wall rule are the APP's
// (floorPlanExteriorSegments, floorPlanSetWallSegments in from-app.js, pinned
// to index.html by the test), so a segment id this hands Claude is exactly one
// the Map tab draws. Facing is new here: the app has no notion of north, so
// "north" means UP on the plan as the app shows it, after the plan's stored
// rotation (floorPlanRotation, quarter turns).

import {
  floorPlanRotateSpaces, floorPlanExteriorSegments, floorPlanIsSegmentId, floorPlanBbox, floorPlanPointInPoly,
} from "./from-app.js";

export const FACINGS = ["north", "east", "south", "west"];

// The plan's spaces turned the way the app turns them. floorPlanRotateSpaces
// carries a label point along; nothing here reads it.
export function rotatedSpaces(spaces, rotation) {
  const turns = (parseInt(rotation, 10) || 0) % 4;
  return floorPlanRotateSpaces(spaces.map((sp) => ({ ...sp, pole: { x: 0, y: 0, clear: 0 } })), turns);
}

// Every outside edge, with the compass direction it faces: the outward normal
// (away from its own space, found the way the app finds it), as a bearing in
// degrees (0 = up/north, 90 = right/east; SVG's y runs down) and the nearest
// of the four points. Length is in the drawing's own units.
export function exteriorWalls(spaces) {
  const segs = floorPlanExteriorSegments(spaces);
  if (!segs.length) return [];
  const all = floorPlanBbox(spaces.flatMap((sp) => sp.pts));
  const eps = Math.max(all.w, all.h) * 0.006;
  const byGid = new Map(spaces.map((sp) => [sp.gid, sp]));
  return segs.map((sg) => {
    const sp = byGid.get(sg.gid);
    const dx = sg.b[0] - sg.a[0], dy = sg.b[1] - sg.a[1], len = Math.hypot(dx, dy);
    let nx = -dy / len, ny = dx / len;
    const mid = [(sg.a[0] + sg.b[0]) / 2, (sg.a[1] + sg.b[1]) / 2];
    if (floorPlanPointInPoly([mid[0] + nx * eps, mid[1] + ny * eps], sp.pts)) { nx = -nx; ny = -ny; }
    const bearing = ((Math.atan2(nx, -ny) * 180) / Math.PI + 360) % 360;
    return {
      id: sg.id, gid: sg.gid, edge: sg.edge,
      facing: FACINGS[Math.round(bearing / 90) % 4],
      bearing: Math.round(bearing),
      length: Math.round(len * 10) / 10,
    };
  });
}

// The walls on a plan from its link rows: wall id -> the segment ids it owns,
// split into the ones the current drawing still has as outside edges and the
// stale ones it does not (the app ignores those when drawing).
export function wallsOnPlan(links, segIds) {
  const walls = new Map();
  for (const l of links || []) {
    if (!l || !l.roomId || !floorPlanIsSegmentId(l.shapeId)) continue;
    if (!walls.has(l.roomId)) walls.set(l.roomId, { segments: [], stale: [] });
    walls.get(l.roomId)[segIds.has(l.shapeId) ? "segments" : "stale"].push(l.shapeId);
  }
  return walls;
}

export class WallPlanError extends Error {
  constructor(message, detail) { super(message); this.detail = detail; }
}

// What a set of wall changes would leave on the plan.
//   requests: [{ wallId, segmentIds }]  each wall's COMPLETE set of segments here
//   removes:  [wallId]                  walls taken off this plan (the asset stays)
//   links:    the plan's link rows now
//   segIds:   the plan's current outside-edge ids
// Every wall named is cleared first and then given its set, so moving an edge
// from one named wall to another is fine; an edge owned by a wall NOT named is
// refused, never stolen -- the app's rule (floorPlanSetWallSegments).
export function planWallChanges({ requests, removes, links, segIds }) {
  const problems = [];
  const named = new Set([...removes, ...requests.map((r) => r.wallId)]);
  const claimed = new Map();
  for (const r of requests) {
    if (!r.segmentIds.length) problems.push(`${r.label}: no edges to attach.`);
    for (const s of r.segmentIds) {
      if (!segIds.has(s)) problems.push(`${r.label}: "${s}" is not an outside edge on this plan. get_plan_walls lists them.`);
      else if (claimed.has(s)) problems.push(`${r.label}: "${s}" is also given to ${claimed.get(s)}.`);
      else claimed.set(s, r.label);
    }
  }
  const owner = new Map();
  for (const l of links || []) if (floorPlanIsSegmentId(l.shapeId)) owner.set(l.shapeId, l.roomId);
  const before = wallsOnPlan(links, segIds);
  const results = requests.map((r) => {
    const taken = r.segmentIds.filter((s) => owner.has(s) && !named.has(owner.get(s)));
    if (taken.length) problems.push(`${r.label}: ${taken.join(", ")} already belong${taken.length === 1 ? "s" : ""} to another wall (${[...new Set(taken.map((s) => owner.get(s)))].join(", ")}). Remove it from that wall first, or include that wall in this change.`);
    const had = before.get(r.wallId);
    const same = !!had && !had.stale.length && had.segments.length === r.segmentIds.length && r.segmentIds.every((s) => had.segments.includes(s));
    return { ...r, before: had ? [...had.segments, ...had.stale] : [], unchanged: same };
  });
  if (problems.length) throw new WallPlanError("Nothing was changed.", problems.slice(0, 50));
  return results;
}
