// The connector's tools. READ-ONLY for now: nothing here writes, and every
// tool says so in its annotations, so Claude never asks permission to run one.
//
// A tool is handed a context that knows which sites (tenants) the signed-in
// person may see and can load one site's tables. It never sees a database or a
// request, so test-mcp-connector.mjs drives every tool with fixture rows.
//
// Access is decided BEFORE a site's rows are loaded (`ctx.sites` is already
// filtered to the sites this person is on the allowlist for), and the database
// separates tenants again underneath, by row-level security.

import { buildInventory } from "./inventory.js";
import { dateOnly, taskKindOf, taskDueDate, maintenanceStatusOf, cellsLabel_ } from "./from-app.js";

export class ToolError extends Error {}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const SITE = {
  type: "string",
  description: "Which site (tenant id from list_sites). May be omitted when the person has only one.",
};
const LIMIT = (max, dflt) => ({
  type: "integer", minimum: 1, maximum: max,
  description: `Most results to return (default ${dflt}).`,
});

export const TOOLS = [
  {
    name: "list_sites",
    title: "List sites",
    description: "The sites (schools, churches, the dev sandbox) this person can see, with their role on each. Call this first when unsure which site is meant.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "search_assets",
    title: "Search assets",
    description: "Find assets by text (name, tag, serial, model, any field), type, location and status. A location includes everything inside it at any depth.",
    inputSchema: {
      type: "object",
      properties: {
        site: SITE,
        query: { type: "string", description: "Words to match anywhere in the asset's fields, name, type or location. All words must match." },
        type: { type: "string", description: "Only this type, by name (e.g. Computer, Room, Mini Split)." },
        within: { type: "string", description: "Only assets inside this place (id, tag, name or full path)." },
        status: { type: "string", enum: ["active", "archived", "all"], description: "Default active." },
        limit: LIMIT(200, 50),
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_asset",
    title: "Get asset",
    description: "Everything about one asset: fields, where it is, who uses it, what is inside it, its tasks and recent work.",
    inputSchema: {
      type: "object",
      properties: { site: SITE, asset: { type: "string", description: "Id, tag, name or full path." } },
      required: ["asset"],
      additionalProperties: false,
    },
  },
  {
    name: "browse_location",
    title: "Browse location",
    description: "What is directly inside a place (campus, building, floor, room). Omit location for the top level.",
    inputSchema: {
      type: "object",
      properties: { site: SITE, location: { type: "string", description: "Id, tag, name or full path." } },
      additionalProperties: false,
    },
  },
  {
    name: "list_tasks",
    title: "List tasks",
    description: "Maintenance tasks (recurring and one-off) with their status and due date, most urgent first. Statuses: overdue, due-soon (within 14 days), never (recurring, never done), undated (one-off with no date), ok, done.",
    inputSchema: {
      type: "object",
      properties: {
        site: SITE,
        within: { type: "string", description: "Only tasks on assets inside this place, or on that asset." },
        status: {
          type: "string",
          enum: ["open", "overdue", "due-soon", "never", "undated", "ok", "done", "all"],
          description: "Default open (everything except done).",
        },
        due_within_days: { type: "integer", minimum: 0, maximum: 3650, description: "Only tasks due within this many days from today (overdue ones included)." },
        limit: LIMIT(500, 100),
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_work_history",
    title: "Get work history",
    description: "Logged work (repairs, service visits, purchases) with type, vendor, cost and date, newest first, plus the total cost.",
    inputSchema: {
      type: "object",
      properties: {
        site: SITE,
        within: { type: "string", description: "Only work on this asset or on anything inside this place." },
        since: { type: "string", description: "yyyy-mm-dd, inclusive." },
        until: { type: "string", description: "yyyy-mm-dd, inclusive." },
        limit: LIMIT(500, 100),
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_audit",
    title: "Get change history",
    description: "Who changed what and when (the app's audit log), newest first.",
    inputSchema: {
      type: "object",
      properties: {
        site: SITE,
        asset: { type: "string", description: "Only entries about this asset, or naming it (a move into or out of a room)." },
        by: { type: "string", description: "Only entries by this person (part of a name or email)." },
        action: { type: "string", description: "Only this action, e.g. edited, created, moved, maintenance_completed." },
        since: { type: "string", description: "yyyy-mm-dd, inclusive." },
        limit: LIMIT(500, 50),
      },
      additionalProperties: false,
    },
  },
  {
    name: "panel_lookup",
    title: "Electrical panel lookup",
    description: "Give a panel to list its breakers and circuits, or a room (or anything in it) to find the circuits that serve it and which panel and breaker they are on.",
    inputSchema: {
      type: "object",
      properties: {
        site: SITE,
        panel: { type: "string", description: "The electrical panel (id, tag, name or path)." },
        room: { type: "string", description: "A room, or an asset whose room should be looked up." },
      },
      additionalProperties: false,
    },
  },
].map((t) => ({ ...t, annotations: { title: t.title, ...READ_ONLY } }));

// ------------------------------------------------------------------ helpers

function pickSite(ctx, site) {
  const sites = ctx.sites || [];
  if (!sites.length) throw new ToolError("You are not on the access list for any site.");
  if (!site) {
    if (sites.length === 1) return sites[0];
    throw new ToolError(`Say which site: ${sites.map((s) => s.id).join(", ")}.`);
  }
  const hit = sites.find((s) => s.id === site || s.name?.toLowerCase() === String(site).toLowerCase());
  // The same answer for "no such site" and "not yours": which tenants exist is
  // not something a stranger should learn from this.
  if (!hit) throw new ToolError(`No site "${site}" that you can see. Yours: ${sites.map((s) => s.id).join(", ")}.`);
  return hit;
}

async function openSite(ctx, args, tables) {
  const site = pickSite(ctx, args.site);
  const want = Array.from(new Set(["assets", "config", ...tables]));
  const rows = {};
  await Promise.all(want.map(async (t) => { rows[t] = await ctx.load(site.id, t); }));
  return { site, rows, inv: buildInventory(rows) };
}

function resolveOrThrow(inv, ref) {
  const r = inv.resolve(ref);
  if (r.asset) return r.asset;
  const err = new ToolError(r.error);
  err.detail = r.matches;
  throw err;
}

const limitOf = (v, dflt) => (Number.isInteger(v) && v > 0 ? v : dflt);
const validDate = (s, what) => {
  if (s === undefined || s === null || s === "") return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) throw new ToolError(`${what} must be yyyy-mm-dd.`);
  return String(s);
};
const ymd = (d) => (d ? d.toISOString().slice(0, 10) : null);
const changePerformedOn = (c) => dateOnly(c.performedOn) || dateOnly(c.at);
const costOf = (c) => {
  const n = Number(String(c.cost ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && String(c.cost ?? "").trim() !== "" ? n : null;
};
const STATUS_ORDER = { overdue: 0, never: 1, "due-soon": 2, ok: 3, undated: 4, done: 5 };

function taskRow(inv, asset, m) {
  const status = maintenanceStatusOf(m);
  return {
    id: m.id,
    task: m.task || "",
    kind: taskKindOf(m) === "oneoff" ? "one-off" : "recurring",
    status,
    due: ymd(taskDueDate(m)),
    frequency: taskKindOf(m) === "oneoff" ? undefined : m.frequencyLabel || undefined,
    lastDone: dateOnly(m.lastPerformed) || undefined,
    owner: m.owner || undefined,
    notes: m.notes || undefined,
    asset: inv.summary(asset),
  };
}

// ------------------------------------------------------------------ handlers

const handlers = {
  async list_sites(_args, ctx) {
    return { sites: (ctx.sites || []).map((s) => ({ id: s.id, name: s.name, role: s.role })) };
  },

  async search_assets(args, ctx) {
    const { site, inv } = await openSite(ctx, args, []);
    const scope = args.within ? resolveOrThrow(inv, args.within) : null;
    const status = args.status || "active";
    const words = String(args.query || "").toLowerCase().split(/\s+/).filter(Boolean);
    const type = String(args.type || "").trim().toLowerCase();
    const hits = inv.list.filter((a) => {
      if (status === "active" && inv.isArchived(a)) return false;
      if (status === "archived" && !inv.isArchived(a)) return false;
      if (type && inv.typeName(a.type).toLowerCase() !== type && String(a.type).toLowerCase() !== type) return false;
      if (scope && !inv.inScope(a, scope.id)) return false;
      if (!words.length) return true;
      const hay = [
        inv.nameOf(a), inv.typeName(a.type), inv.pathOf(a), ...inv.personNames(a),
        ...Object.values(a).filter((v) => typeof v === "string" || typeof v === "number"),
      ].join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    const limit = limitOf(args.limit, 50);
    return {
      site: site.id,
      total: hits.length,
      truncated: hits.length > limit || undefined,
      assets: hits.slice(0, limit).map(inv.summary),
    };
  },

  async get_asset(args, ctx) {
    const { site, rows, inv } = await openSite(ctx, args, ["maintenance", "changes", "comments", "photos"]);
    const a = resolveOrThrow(inv, args.asset);
    const own = (t) => rows[t].filter((r) => r.asset_id === a.id).sort((x, y) => x.position - y.position).map((r) => r.data);
    const inside = inv.children.get(a.id) || [];
    const work = own("changes").sort((x, y) => changePerformedOn(y).localeCompare(changePerformedOn(x)));
    return {
      site: site.id,
      ...inv.summary(a),
      users: inv.personNames(a).length ? inv.personNames(a) : undefined,
      fields: inv.fieldsOf(a),
      contains: inside.length
        ? { count: inside.length, items: inside.slice(0, 50).map(inv.summary) }
        : undefined,
      tasks: own("maintenance").map((m) => taskRow(inv, a, m)).map(({ asset, ...t }) => t),
      recentWork: work.slice(0, 10).map((c) => ({
        date: changePerformedOn(c), type: c.changeType || undefined, vendor: c.vendor || undefined,
        cost: costOf(c) ?? undefined, note: c.note || undefined, by: c.by || undefined,
      })),
      workEntries: work.length,
      comments: own("comments").slice(-10).map((c) => ({ at: c.at, by: c.by, text: c.text })),
      files: rows.photos.filter((p) => p.owner_type === "asset" && p.owner_id === a.id).length || undefined,
    };
  },

  async browse_location(args, ctx) {
    const { site, inv } = await openSite(ctx, args, []);
    const place = args.location ? resolveOrThrow(inv, args.location) : null;
    const kids = (inv.children.get(place ? place.id : "") || []).filter((a) => !inv.isArchived(a));
    const countInside = (a) => (inv.children.get(a.id) || []).filter((x) => !inv.isArchived(x)).length;
    return {
      site: site.id,
      location: place ? inv.summary(place) : "top level",
      items: kids.map((a) => ({ ...inv.summary(a), location: undefined, contains: countInside(a) || undefined })),
    };
  },

  async list_tasks(args, ctx) {
    const { site, rows, inv } = await openSite(ctx, args, ["maintenance"]);
    const scope = args.within ? resolveOrThrow(inv, args.within) : null;
    const want = args.status || "open";
    const horizon = Number.isInteger(args.due_within_days) ? Date.now() + args.due_within_days * 86400000 : null;
    const out = [];
    for (const r of rows.maintenance) {
      const a = inv.byId.get(r.asset_id);
      if (!a || inv.isArchived(a)) continue; // the app's Tasks tab skips archived assets too
      if (scope && !inv.inScope(a, scope.id)) continue;
      const t = taskRow(inv, a, r.data);
      if (want === "open" ? t.status === "done" : want !== "all" && t.status !== want) continue;
      if (horizon !== null && (!t.due || new Date(t.due + "T00:00:00Z").getTime() > horizon)) continue;
      out.push(t);
    }
    out.sort((x, y) => (STATUS_ORDER[x.status] - STATUS_ORDER[y.status]) || String(x.due || "9").localeCompare(String(y.due || "9")));
    const limit = limitOf(args.limit, 100);
    const counts = {};
    for (const t of out) counts[t.status] = (counts[t.status] || 0) + 1;
    return { site: site.id, today: ymd(new Date()), total: out.length, counts, tasks: out.slice(0, limit) };
  },

  async get_work_history(args, ctx) {
    const { site, rows, inv } = await openSite(ctx, args, ["changes", "maintenance"]);
    const scope = args.within ? resolveOrThrow(inv, args.within) : null;
    const since = validDate(args.since, "since");
    const until = validDate(args.until, "until");
    const taskName = new Map(rows.maintenance.map((r) => [r.id, r.data.task]));
    const out = [];
    for (const r of rows.changes) {
      const a = inv.byId.get(r.asset_id);
      if (!a) continue;
      if (scope && !inv.inScope(a, scope.id)) continue;
      const c = r.data;
      const date = changePerformedOn(c);
      if (since && date < since) continue;
      if (until && date > until) continue;
      out.push({
        date, type: c.changeType || undefined, vendor: c.vendor || undefined, cost: costOf(c) ?? undefined,
        note: c.note || undefined, by: c.by || undefined,
        task: c.maintenanceId ? taskName.get(c.maintenanceId) : undefined,
        asset: inv.summary(a),
      });
    }
    out.sort((x, y) => y.date.localeCompare(x.date));
    const total = out.reduce((s, w) => s + (w.cost || 0), 0);
    const limit = limitOf(args.limit, 100);
    return { site: site.id, entries: out.length, totalCost: Math.round(total * 100) / 100, work: out.slice(0, limit) };
  },

  async get_audit(args, ctx) {
    const { site, rows, inv } = await openSite(ctx, args, ["audit_log"]);
    const subject = args.asset ? resolveOrThrow(inv, args.asset) : null;
    const since = validDate(args.since, "since");
    const by = String(args.by || "").toLowerCase();
    const action = String(args.action || "").toLowerCase();
    const named = (d, id) => String(d.related || "").split(",").some((p) => p.split(":")[0].trim() === id);
    const out = [];
    // seq is append order, which is chronological; newest first.
    for (const r of rows.audit_log.slice().sort((x, y) => Number(y.seq) - Number(x.seq))) {
      const d = r.data || {};
      if (subject && r.asset_id !== subject.id && !named(d, subject.id)) continue;
      if (by && !String(d.by || "").toLowerCase().includes(by)) continue;
      if (action && String(d.action || "").toLowerCase() !== action) continue;
      if (since && dateOnly(d.at) && dateOnly(d.at) < since) continue;
      const a = inv.byId.get(r.asset_id);
      out.push({
        at: d.at, by: d.by, action: d.action,
        asset: a ? inv.nameOf(a) : `${d.assetType || "Asset"} ${r.asset_id || ""} (deleted)`.trim(),
        assetId: r.asset_id || undefined,
        field: d.field || undefined, from: d.from || undefined, to: d.to || undefined,
        note: d.note || undefined,
      });
    }
    const limit = limitOf(args.limit, 50);
    return { site: site.id, total: out.length, entries: out.slice(0, limit) };
  },

  async panel_lookup(args, ctx) {
    if (!args.panel === !args.room) throw new ToolError("Give one of panel or room.");
    const { site, rows, inv } = await openSite(ctx, args, ["breakers", "circuits"]);
    const breakers = new Map(rows.breakers.map((r) => [r.id, { ...r.data, id: r.id, panelId: r.panel_id, position: r.position }]));
    const circuitOut = (r) => {
      const c = r.data;
      const b = r.breaker_id ? breakers.get(r.breaker_id) : null;
      const panel = inv.byId.get(r.panel_id);
      return {
        circuit: c.tag || undefined,
        description: c.label || undefined,
        panel: panel ? inv.nameOf(panel) : r.panel_id,
        slot: b ? cellsLabel_(b) : "unassigned",
        amps: b?.ampRating || undefined,
        serves: (c.roomsServedIds || []).map((id) => (inv.byId.get(id) ? inv.nameOf(inv.byId.get(id)) : id)),
        feedsPanel: c.feedsPanelLabel ? (inv.byId.get(c.feedsPanelLabel) ? inv.nameOf(inv.byId.get(c.feedsPanelLabel)) : c.feedsPanelLabel) : undefined,
        wire: c.wireColor || undefined,
        notes: c.notes || undefined,
      };
    };

    if (args.panel) {
      const p = resolveOrThrow(inv, args.panel);
      const bs = rows.breakers.filter((r) => r.panel_id === p.id).sort((x, y) => x.position - y.position);
      const cs = rows.circuits.filter((r) => r.panel_id === p.id);
      return {
        site: site.id,
        panel: inv.summary(p),
        slots: p.panelSlotCount || undefined,
        phases: p.panelPhases || undefined,
        voltage: p.panelVoltage || undefined,
        breakers: bs.map((r) => ({
          slot: cellsLabel_(r.data), amps: r.data.ampRating || undefined, notes: r.data.notes || undefined,
          circuits: cs.filter((c) => c.breaker_id === r.id).sort((x, y) => x.position - y.position).map(circuitOut)
            .map(({ panel, slot, amps, ...rest }) => rest),
        })),
        unassignedCircuits: cs.filter((c) => !c.breaker_id).map(circuitOut),
      };
    }

    const target = resolveOrThrow(inv, args.room);
    // The room itself, or the nearest place above an asset that a circuit serves.
    const chain = [target, ...inv.ancestorsOf(target).reverse()];
    const servedIds = new Set(rows.circuits.flatMap((r) => r.data.roomsServedIds || []));
    const room = chain.find((x) => servedIds.has(x.id));
    if (!room) return { site: site.id, room: inv.summary(target), circuits: [], note: "No circuit lists this room or any place it sits in." };
    return {
      site: site.id,
      room: inv.summary(room),
      circuits: rows.circuits.filter((r) => (r.data.roomsServedIds || []).includes(room.id)).map(circuitOut),
    };
  },
};

export async function callTool(name, args, ctx) {
  const fn = Object.prototype.hasOwnProperty.call(handlers, name) ? handlers[name] : null;
  if (!fn) throw new ToolError(`Unknown tool "${name}".`);
  return fn(args || {}, ctx);
}

// Owner first (always an editor, so lockout is impossible), then the allowlist.
// Emails compare case-insensitively; the table stores them lowercased.
export function roleFor(email, tenant, authUsers) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return null;
  if (tenant && String(tenant.owner_email || "").toLowerCase() === e) return "editor";
  const row = (authUsers || []).find((u) => String(u.email).toLowerCase() === e);
  return row ? row.role : null;
}
