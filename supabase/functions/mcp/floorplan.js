// The floor plan half of replace_floor_plan that needs no network: reading a
// plan's spaces out of its SVG, and planning the replace.
//
// The app reads a plan with the browser's DOMParser (parseFloorPlanSvg in
// index.html). An Edge Function has none, so this is a small tag reader that
// answers the only questions a replace asks of a drawing, by the app's rules:
// which <g> elements are SPACES (a direct-child <title> starting "Space", and
// a <path> or <rect> inside with at least three points), and each one's gid
// (the group's id, else its title) and title. Geometry is the browser's
// business; the carry-over only matches ids and titles.

import { floorPlanRemapLinksAndGroups, floorPlanPathToPoints } from "./from-app.js";

// Same cap as the app's FLOORPLAN_MAX_BYTES would be far too generous for a
// tool argument; real plans are tens of KB.
export const FLOORPLAN_TOOL_MAX_BYTES = 2 * 1024 * 1024;

export class PlanFileError extends Error {}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") {
    const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : m;
  }
  return ENTITIES[e.toLowerCase()] ?? m;
});

// A tree of { name, attrs, children, text }. Refuses anything not well formed,
// as DOMParser's parsererror does in the app.
export function readSvgTree(text) {
  const src = String(text || "");
  const root = { name: "#doc", attrs: {}, children: [], text: "" };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/\s*([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)|(<)/g;
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) { top.text += m[1]; continue; }
    if (m[2]) {
      if (top.name !== m[2] || stack.length === 1) throw new PlanFileError("That file isn't a valid SVG.");
      stack.pop();
      continue;
    }
    if (m[3]) {
      const attrs = {};
      for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3]);
      const el = { name: m[3], attrs, children: [], text: "" };
      top.children.push(el);
      if (!m[5]) stack.push(el);
      continue;
    }
    if (m[6] !== undefined) { top.text += decode(m[6]); continue; }
    if (m[7]) throw new PlanFileError("That file isn't a valid SVG.");
  }
  if (stack.length !== 1) throw new PlanFileError("That file isn't a valid SVG.");
  return root;
}

const local = (el) => el.name.replace(/^.*:/, "").toLowerCase();
function* descendants(el) {
  for (const c of el.children) { yield c; yield* descendants(c); }
}
const first = (el, names) => {
  for (const d of descendants(el)) if (names.includes(local(d))) return d;
  return null;
};

// The plan's spaces, as [{ gid, title }], in document order.
export function floorPlanSpacesOf(svgText) {
  const tree = readSvgTree(svgText);
  const root = first(tree, ["svg"]);
  if (!root) throw new PlanFileError("That file isn't a valid SVG.");
  const spaces = [];
  for (const g of descendants(root)) {
    if (local(g) !== "g") continue;
    // A title that belongs to THIS group, not to one nested inside it.
    const titleEl = g.children.find((c) => local(c) === "title");
    const firstTitle = first(g, ["title"]);
    if (firstTitle && firstTitle !== titleEl) continue;
    const title = titleEl ? titleEl.text.trim() : "";
    if (!/^Space/i.test(title)) continue;
    const geom = first(g, ["path", "rect"]);
    if (!geom) continue;
    const enough = local(geom) === "rect" || floorPlanPathToPoints(geom.attrs.d || "").length >= 3;
    if (!enough) continue;
    spaces.push({ gid: g.attrs.id || title, title });
  }
  return spaces;
}

// What a replace would do to an asset's links and groups. `oldSpaces` is null
// when the current plan could not be read, in which case only a shape whose id
// is unchanged carries over -- the app's own rule with nothing to match titles
// against.
export function planFloorPlanReplace({ links, groups, oldSpaces, newSpaces }) {
  const { links: kept, groups: keptGroups } = floorPlanRemapLinksAndGroups(links, groups, oldSpaces || [], newSpaces);
  const survives = (l) => floorPlanRemapLinksAndGroups([l], [], oldSpaces || [], newSpaces).links.length > 0;
  return {
    links: kept,
    groups: keptGroups,
    droppedLinks: (links || []).filter((l) => !survives(l)),
    droppedGroups: (groups || []).filter((g) => !keptGroups.some((k) => k.id === g.id)),
  };
}
