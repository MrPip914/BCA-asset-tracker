// Window pane groups on tasks: the connector's side of the Window type
// (plans/window-tracking.md). A Window's layout is the asset's own
// floorPlanUrl plus its floorPlanGroups, which Postgres keeps in space_groups,
// so the inventory (built from the assets table alone) does not carry them;
// attachPaneGroups puts them back on the assets in memory, and the app's own
// taskPaneGroupsOf / livePaneGroupIds (from-app.js, copied verbatim) read them.
//
// Pure: handed rows, never a database. Covered by test-mcp-connector.mjs.

import { hasModule } from "./app-rules.js";
import { windowGroupsOf, taskPaneGroupsOf } from "./from-app.js";

const norm = (s) => String(s ?? "").trim().toLowerCase();

export const isWindowAsset = (a) => !!a && hasModule(a.type, "windowLayout");

// Put each plan asset's groups (space_groups rows, in stored order) on the
// in-memory asset as floorPlanGroups, the shape the app reads.
export function attachPaneGroups(rows, inv) {
  const by = new Map();
  for (const r of (rows.space_groups || []).slice().sort((x, y) => (x.position ?? 0) - (y.position ?? 0))) {
    if (!by.has(r.plan_asset_id)) by.set(r.plan_asset_id, []);
    by.get(r.plan_asset_id).push({ ...r.data, id: r.data?.id ?? r.id });
  }
  for (const [id, groups] of by) {
    const a = inv.byId.get(id);
    if (a) a.floorPlanGroups = groups;
  }
}

// A window's groups for reading: name and how many panes.
export const paneGroupsOut = (asset) =>
  windowGroupsOf(asset).map((g) => ({ id: g.id, name: g.name, panes: (g.memberShapeIds || []).length }));

// Names of the groups a task names (groups since deleted are ignored, as in the app).
export const taskPaneGroupNames = (asset, item) => taskPaneGroupsOf(asset, item).map((g) => g.name);

// What a person gave for pane_groups -- names or ids -- as the group ids to
// store. Only a Window has groups; an unknown name is refused, listing the
// real ones; a name two groups share is a question, never the first one.
export function resolvePaneGroupIds(asset, refs, nameOf, ToolError) {
  const list = Array.isArray(refs) ? refs : [refs];
  const wanted = list.map((x) => String(x ?? "").trim()).filter(Boolean);
  if (!wanted.length) return [];
  if (!isWindowAsset(asset)) {
    throw new ToolError(`${nameOf(asset)} is not a Window, so it has no pane groups. Only a Window's tasks can name groups.`);
  }
  const groups = windowGroupsOf(asset);
  const names = () => groups.map((g) => g.name).join(", ") || "(none yet: set them up on the window's Panes tab in the app)";
  const ids = [];
  for (const w of wanted) {
    const hits = groups.filter((g) => g.id === w);
    const byName = hits.length ? hits : groups.filter((g) => norm(g.name) === norm(w));
    if (!byName.length) throw new ToolError(`${nameOf(asset)} has no pane group "${w}". Its groups: ${names()}.`);
    if (byName.length > 1) throw new ToolError(`${byName.length} pane groups on ${nameOf(asset)} are called "${w}". Give the id of the one you mean: ${byName.map((g) => g.id).join(", ")}.`);
    if (!ids.includes(byName[0].id)) ids.push(byName[0].id);
  }
  // In the window's own order, as the app stores them.
  return groups.filter((g) => ids.includes(g.id)).map((g) => g.id);
}

// "Bay 1 lower, Bay 2 lower" for the change history, the way the app words it.
export const paneGroupNamesText = (asset, ids) => {
  const gs = windowGroupsOf(asset);
  return (ids || []).map((id) => (gs.find((g) => g.id === id) || {}).name).filter(Boolean).join(", ");
};
