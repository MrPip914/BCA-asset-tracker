// The connector's tools. The read tools say so in their annotations, so Claude
// never asks permission to run one. The four write tools (add_task,
// complete_task, log_work, add_comment) are annotated as writes, so Claude asks
// before each one unless the person has told it to always allow that tool.
//
// A write tool builds and checks the record HERE, with the app's own rules
// (from-app.js), then hands it to ctx.write, which calls one Postgres function
// (db/migrations/0006_connector_writes.sql). That function re-checks the role,
// the asset and the task, bumps the revision and writes the audit row, all in
// one transaction. Nothing here writes a table directly.
//
// A tool is handed a context that knows which sites (tenants) the signed-in
// person may see and can load one site's tables. It never sees a database or a
// request, so test-mcp-connector.mjs drives every tool with fixture rows.
//
// Access is decided BEFORE a site's rows are loaded (`ctx.sites` is already
// filtered to the sites this person is on the allowlist for), and the database
// separates tenants again underneath, by row-level security.

import { buildInventory } from "./inventory.js";
import {
  dateOnly, taskKindOf, taskDueDate, maintenanceStatusOf, cellsLabel_, isOneOffTask, taskIsDone,
  TASK_KIND_SCHEDULED, TASK_KIND_ONEOFF, MAINTENANCE_FREQUENCIES, WEEKDAY_NAMES,
  parseRecurrence, formatRecurrence, describeRecurrence, recurrenceApproxDays,
} from "./from-app.js";

export class ToolError extends Error {}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
// Additive: nothing a write tool does removes or overwrites a person's data
// (a completion moves a task's last-done date forward, which is the point).
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

const SITE = {
  type: "string",
  description: "Which site (tenant id from list_sites). May be omitted when the person has only one.",
};
const LIMIT = (max, dflt) => ({
  type: "integer", minimum: 1, maximum: max,
  description: `Most results to return (default ${dflt}).`,
});

const READ_TOOLS = [
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
];

const DATE = (what) => ({ type: "string", description: `${what}, yyyy-mm-dd. Default today.` });
const WORK_FIELDS = {
  work_type: { type: "string", description: "The work type, from the site's list (e.g. Maintenance, Repair, Purchase)." },
  vendor: { type: "string", description: "Who did the work, from the site's vendor list. Omit for in-house work." },
  cost: { type: "string", description: "What it cost, e.g. 120 or $1,200.50." },
  note: { type: "string", description: "What was done or found." },
};

const WRITE_TOOLS = [
  {
    name: "add_task",
    title: "Add task",
    description: "Add a maintenance task to an asset: recurring (with a frequency) or one-off (with an optional due date). Recorded as this person, via Claude. Confirm the asset and details with the person first.",
    inputSchema: {
      type: "object",
      properties: {
        site: SITE,
        asset: { type: "string", description: "The asset the task is on (id, tag, name or full path). A room or building is fine for work on the place itself." },
        task: { type: "string", description: "What the task is, e.g. Filter clean." },
        kind: { type: "string", enum: ["recurring", "one-off"], description: "Default recurring." },
        frequency: {
          type: "string",
          description: `Recurring only. One of ${MAINTENANCE_FREQUENCIES.map((f) => f.label).join(", ")}; or "every N days/weeks/months/years"; or "first/second/third/fourth/last <weekday> of every month" (optionally "every N months").`,
        },
        last_done: { type: "string", description: "Recurring only: when it was last done, yyyy-mm-dd, if known. Due dates count from it." },
        due_date: { type: "string", description: "One-off only: when it is due, yyyy-mm-dd." },
        owner: { type: "string", description: "Who is responsible." },
        notes: { type: "string" },
      },
      required: ["asset", "task"],
      additionalProperties: false,
    },
  },
  {
    name: "complete_task",
    title: "Log task completion",
    description: "Record that a task was done: sets its last-done date (a one-off becomes done) and logs a work entry linked to it, exactly like the app's Log completion. Recorded as this person, via Claude.",
    inputSchema: {
      type: "object",
      properties: {
        site: SITE,
        task: { type: "string", description: "The task's id (from list_tasks or get_asset), or its name." },
        asset: { type: "string", description: "Narrows a task given by name to this asset, or to anything inside this place." },
        date: DATE("When it was done"),
        ...WORK_FIELDS,
        work_type: { type: "string", description: "The work type, from the site's list. Default Maintenance." },
      },
      required: ["task"],
      additionalProperties: false,
    },
  },
  {
    name: "log_work",
    title: "Log work",
    description: "Log work done on an asset (a repair, a purchase, a service visit) with its type, vendor, cost and date. Linking a task does NOT mark it done; use complete_task for that. Recorded as this person, via Claude.",
    inputSchema: {
      type: "object",
      properties: {
        site: SITE,
        asset: { type: "string", description: "Id, tag, name or full path." },
        date: DATE("When the work was done"),
        ...WORK_FIELDS,
        task: { type: "string", description: "Optionally, a task on this asset the work relates to (id or name)." },
      },
      required: ["asset", "work_type"],
      additionalProperties: false,
    },
  },
  {
    name: "add_comment",
    title: "Add comment",
    description: "Add a comment (a free-text note) to an asset. Recorded as this person, via Claude.",
    inputSchema: {
      type: "object",
      properties: {
        site: SITE,
        asset: { type: "string", description: "Id, tag, name or full path." },
        text: { type: "string" },
      },
      required: ["asset", "text"],
      additionalProperties: false,
    },
  },
];

export const WRITE_TOOL_NAMES = WRITE_TOOLS.map((t) => t.name);

export const TOOLS = [
  ...READ_TOOLS.map((t) => ({ ...t, annotations: { title: t.title, ...READ_ONLY } })),
  ...WRITE_TOOLS.map((t) => ({ ...t, annotations: { title: t.title, ...WRITE } })),
];

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

// ------------------------------------------------------------------ write helpers

// "Today" for a date nobody gave. The server runs in UTC, and in an evening in
// California UTC is already tomorrow, which would stamp work a day late. Every
// site is in California today; give a site its own zone the day one is not.
export const SITE_TIME_ZONE = "America/Los_Angeles";
export const todayIn = (tz = SITE_TIME_ZONE, now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

function realDate(s, what) {
  const v = validDate(s, what);
  if (!v) return "";
  const d = new Date(v + "T00:00:00Z");
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw new ToolError(`${what} ${v} is not a real date.`);
  return v;
}

function requireEditor(site) {
  if (site.role !== "editor") throw new ToolError(`You have view-only access to ${site.name || site.id}, so nothing was changed.`);
}

function liveAsset(inv, ref) {
  const a = resolveOrThrow(inv, ref);
  if (inv.isArchived(a)) throw new ToolError(`${inv.nameOf(a)} is archived. Restore it in the app first.`);
  return a;
}

const norm = (s) => String(s ?? "").trim().toLowerCase();

// What a person typed for "how often", as the app stores it: a preset, or a
// custom repeat rule (backend v52) worded the way the app words it. Null when
// it is neither.
export function frequencyFrom(text) {
  const t = norm(text).replace(/,/g, " ").replace(/\s+/g, " ");
  if (!t) return null;
  const preset = MAINTENANCE_FREQUENCIES.find((f) => f.label.toLowerCase().replace(/[\s-]/g, "") === t.replace(/[\s-]/g, ""));
  if (preset) return { label: preset.label, days: preset.days, recurrence: "" };
  let m = t.match(/^every (?:(\d+) )?(day|week|month|year)s?$/);
  if (m) {
    const rule = parseRecurrence(`interval:${m[1] || 1}:${m[2]}`);
    return rule && { label: describeRecurrence(rule), days: recurrenceApproxDays(rule), recurrence: formatRecurrence(rule) };
  }
  m = t.match(/^(first|second|third|fourth|last) (\w+?)s?(?: of)?(?: (?:every|each) (?:(\d+) )?months?)?$/);
  if (m) {
    const ordinal = { first: 1, second: 2, third: 3, fourth: 4, last: -1 }[m[1]];
    const weekday = WEEKDAY_NAMES.findIndex((d) => d.toLowerCase() === m[2]);
    const rule = weekday < 0 ? null : parseRecurrence(`weekday:${ordinal}:${weekday}:${m[3] || 1}`);
    return rule && { label: describeRecurrence(rule), days: recurrenceApproxDays(rule), recurrence: formatRecurrence(rule) };
  }
  return null;
}

// A value from one of the site's managed lists (work types, vendors), spelled
// as the list spells it. A value the list does not hold would show in the app
// as a choice its picker cannot re-select, so it is refused, naming the list.
function fromList(value, list, what) {
  const hit = (list || []).find((x) => norm(x) === norm(value));
  if (hit !== undefined) return hit;
  throw new ToolError(`"${value}" is not one of this site's ${what}: ${(list || []).join(", ") || "(none yet)"}. Add it in the app first, or pick one of these.`);
}
const DEFAULT_CHANGE_TYPES = ["Purchase", "Repair", "Replacement", "Upgrade", "Maintenance", "Relocation", "Disposal", "Other"];
const changeTypesOf = (inv) => (Array.isArray(inv.cfg.changeTypes) && inv.cfg.changeTypes.length ? inv.cfg.changeTypes : DEFAULT_CHANGE_TYPES);

function costText(v) {
  const s = String(v ?? "").trim();
  if (s && !Number.isFinite(Number(s.replace(/[$,\s]/g, "")))) throw new ToolError(`Cost "${s}" is not an amount.`);
  return s;
}

// The fields of a work entry, as the app's Log work and Log completion write them.
function workFields(inv, args, dfltType) {
  const type = args.work_type ?? dfltType;
  if (!type) throw new ToolError(`Say which work type: ${changeTypesOf(inv).join(", ")}.`);
  return {
    changeType: fromList(type, changeTypesOf(inv), "work types"),
    vendor: args.vendor ? fromList(args.vendor, inv.cfg.vendors, "vendors") : "",
    cost: costText(args.cost),
    note: String(args.note ?? "").trim(),
  };
}

// A task by id, or by name within an optional asset or place. Two tasks with
// one name is a question for the person, never the first one.
function findTask(inv, rows, ref, within) {
  const live = rows.filter((r) => inv.byId.has(r.asset_id) && !inv.isArchived(inv.byId.get(r.asset_id)));
  const byId = live.find((r) => r.id === ref);
  if (byId) return byId;
  const scope = within ? resolveOrThrow(inv, within) : null;
  const named = live.filter((r) => norm(r.data.task) === norm(ref) && (!scope || inv.inScope(inv.byId.get(r.asset_id), scope.id)));
  if (named.length === 1) return named[0];
  if (!named.length) throw new ToolError(`No task "${ref}"${scope ? ` on or inside ${inv.nameOf(scope)}` : ""}. list_tasks shows them.`);
  const err = new ToolError(`${named.length} tasks are called "${ref}". Give the id of the one you mean, or the asset.`);
  err.detail = named.map((r) => ({ id: r.id, task: r.data.task, asset: inv.nameOf(inv.byId.get(r.asset_id)), location: inv.pathOf(inv.byId.get(r.asset_id)) || undefined }));
  throw err;
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

  // ---------------------------------------------------------------- writes

  async add_task(args, ctx) {
    const { site, inv } = await openSite(ctx, args, []);
    requireEditor(site);
    const a = liveAsset(inv, args.asset);
    const task = String(args.task ?? "").trim();
    if (!task) throw new ToolError("Say what the task is.");
    const oneOff = args.kind === "one-off";
    let freq = null;
    if (oneOff) {
      if (args.frequency) throw new ToolError("A one-off task has no frequency. Give a due_date instead, or make it recurring.");
      if (args.last_done) throw new ToolError("A one-off task is added open. Add it, then use complete_task if it is already done.");
    } else {
      if (args.due_date) throw new ToolError("A recurring task's due date comes from its frequency and last-done date. Give last_done, or make it one-off.");
      if (!args.frequency) throw new ToolError(`Say how often: ${MAINTENANCE_FREQUENCIES.map((f) => f.label).join(", ")}, or e.g. "every 6 weeks".`);
      freq = frequencyFrom(args.frequency);
      if (!freq) throw new ToolError(`"${args.frequency}" is not a frequency the app understands. Use ${MAINTENANCE_FREQUENCIES.map((f) => f.label).join(", ")}, "every N days/weeks/months/years", or "first Monday of every month".`);
    }
    // Both halves always written, the unused one blank, as addMaintenanceItem does.
    const item = {
      kind: oneOff ? TASK_KIND_ONEOFF : TASK_KIND_SCHEDULED,
      task,
      notes: String(args.notes ?? "").trim(),
      frequencyLabel: oneOff ? "" : freq.label,
      frequencyDays: oneOff ? "" : freq.days,
      recurrence: oneOff ? "" : freq.recurrence,
      dueDate: oneOff ? realDate(args.due_date, "due_date") : "",
      lastPerformed: oneOff ? "" : realDate(args.last_done, "last_done"),
      owner: String(args.owner ?? "").trim(),
    };
    const out = await ctx.write(site.id, "add_task", [a.id, item]);
    ctx.log?.("write", { tool: "add_task", site: site.id, asset: a.id, id: out.id });
    return { site: site.id, added: taskRow(inv, a, { ...item, id: out.id }) };
  },

  async complete_task(args, ctx) {
    const { site, rows, inv } = await openSite(ctx, args, ["maintenance"]);
    requireEditor(site);
    const r = findTask(inv, rows.maintenance, String(args.task ?? "").trim(), args.asset);
    const a = inv.byId.get(r.asset_id);
    if (isOneOffTask(r.data) && taskIsDone(r.data)) {
      throw new ToolError(`"${r.data.task}" is a one-off that is already done (${dateOnly(r.data.lastPerformed)}). Clear its completed date in the app to reopen it.`);
    }
    const date = realDate(args.date, "date") || todayIn();
    // Maintenance where the site still has it, as the app's completion form
    // prefills; otherwise the person has to say.
    const dflt = changeTypesOf(inv).find((t) => t === "Maintenance");
    const work = workFields(inv, args, dflt);
    const out = await ctx.write(site.id, "complete_task", [r.id, date, work]);
    ctx.log?.("write", { tool: "complete_task", site: site.id, task: r.id, id: out.id });
    const after = { ...r.data, lastPerformed: date };
    return {
      site: site.id,
      completed: taskRow(inv, a, after),
      previouslyDone: dateOnly(r.data.lastPerformed) || "never",
      workEntry: { id: out.id, date, type: work.changeType, vendor: work.vendor || undefined, cost: work.cost || undefined, note: work.note || undefined },
    };
  },

  async log_work(args, ctx) {
    const { site, rows, inv } = await openSite(ctx, args, ["maintenance"]);
    requireEditor(site);
    const a = liveAsset(inv, args.asset);
    const work = workFields(inv, args, null);
    let task = null;
    if (args.task) {
      task = findTask(inv, rows.maintenance.filter((m) => m.asset_id === a.id), String(args.task).trim(), null);
    }
    const date = realDate(args.date, "date") || todayIn();
    const out = await ctx.write(site.id, "log_work", [a.id, { ...work, performedOn: date, maintenanceId: task ? task.id : "" }]);
    ctx.log?.("write", { tool: "log_work", site: site.id, asset: a.id, id: out.id });
    return {
      site: site.id,
      logged: {
        id: out.id, date, type: work.changeType, vendor: work.vendor || undefined, cost: work.cost || undefined,
        note: work.note || undefined, task: task ? task.data.task : undefined, asset: inv.summary(a),
      },
    };
  },

  async add_comment(args, ctx) {
    const { site, inv } = await openSite(ctx, args, []);
    requireEditor(site);
    const a = liveAsset(inv, args.asset);
    const text = String(args.text ?? "").trim();
    if (!text) throw new ToolError("The comment is empty.");
    await ctx.write(site.id, "add_comment", [a.id, text]);
    ctx.log?.("write", { tool: "add_comment", site: site.id, asset: a.id });
    return { site: site.id, commented: { asset: inv.summary(a), text } };
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
