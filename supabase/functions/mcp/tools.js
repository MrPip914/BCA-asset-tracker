// The connector's tools. The read tools say so in their annotations, so Claude
// never asks permission to run one. The write tools are annotated as writes
// (and the ones that remove or overwrite something as destructive), so Claude
// asks before each one unless the person has told it to always allow that tool.
//
// A write tool builds and checks the record HERE, with the app's own rules
// (from-app.js for tasks, app-rules.js via asset-writes.js for assets), then
// hands it to ctx.write, which calls one Postgres function (migrations 0006 and
// 0007). That function re-checks the role, takes the lock, bumps the revision
// and writes the audit rows, all in one transaction. Nothing here writes a
// table directly.
//
// A tool is handed a context that knows which sites (tenants) the signed-in
// person may see and can load one site's tables. It never sees a database or a
// request, so test-mcp-connector.mjs drives every tool with fixture rows.
//
// Access is decided BEFORE a site's rows are loaded (`ctx.sites` is already
// filtered to the sites this person is on the allowlist for), and the database
// separates tenants again underneath, by row-level security.

import { buildInventory } from "./inventory.js";
import { isPlaceType } from "./app-rules.js";
import { floorPlanSpacesOf, floorPlanGeometryOf, planFloorPlanReplace, PlanFileError, FLOORPLAN_TOOL_MAX_BYTES } from "./floorplan.js";
import { rotatedSpaces, exteriorWalls, wallsOnPlan, planWallChanges, WallPlanError, FACINGS } from "./walls.js";
import {
  appView, schemaOf, planSaveAssets, planArchive, taskEditAudit, PlanError, MAX_ROWS,
} from "./asset-writes.js";
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
// Overwrites or removes something a person entered (an asset's fields, a task).
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

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
        include_fields: { type: "boolean", description: "Also return every field of each asset and its users, for reviewing data in bulk." },
        limit: LIMIT(1000, 50),
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_schema",
    title: "Get site schema",
    description: "How this site's inventory is shaped: every asset type with the fields it has and what it can sit inside, every field's kind and choices, the managed lists (peripherals, sub-types, work types, vendors), and whether people are assigned as User assets. Read this before save_assets.",
    inputSchema: { type: "object", properties: { site: SITE }, additionalProperties: false },
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
  {
    name: "get_plan_walls",
    title: "Floor plan walls",
    description: "List the outside walls of a place's floor plan: every space (shape) on the plan with what it is linked to, each of its outside edges (segment ids, as the app's Map tab draws them) with the direction it faces and its length, and the Wall assets already attached to edges. North means up on the plan as the app shows it. Use this before set_plan_walls.",
    inputSchema: {
      type: "object",
      properties: {
        site: SITE,
        asset: { type: "string", description: "The place whose floor plan to read (id, tag, name or full path)." },
        space: { type: "string", description: "Only this space: its title (Space.12), its shape id, or the room or building linked to it." },
      },
      required: ["asset"],
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

const TASK_FIELDS = {
  task: { type: "string", description: "What the task is, e.g. Filter clean." },
  kind: { type: "string", enum: ["recurring", "one-off"], description: "Default recurring." },
  frequency: {
    type: "string",
    description: `Recurring only. One of ${MAINTENANCE_FREQUENCIES.map((f) => f.label).join(", ")}; or "every N days/weeks/months/years"; or "first/second/third/fourth/last <weekday> of every month" (optionally "every N months").`,
  },
  last_done: { type: "string", description: "When it was last done, yyyy-mm-dd, if known. Due dates count from it." },
  due_date: { type: "string", description: "One-off only: when it is due, yyyy-mm-dd." },
  owner: { type: "string", description: "Who is responsible." },
  notes: { type: "string" },
};

// Changing or removing what is already there. Each one is checked against the
// app's own rules and audited as the app audits it.
const MANAGE_TOOLS = [
  {
    name: "save_assets",
    title: "Create or update assets",
    description: "Create new assets and change existing ones, up to 500 rows in one call, checked by the app's own import rules and recorded field by field in the change history under this person, via Claude. A row with `asset` updates that asset and changes only the fields it gives; a row without one creates an asset (Type required). Field names come from get_schema; Location takes a place's full path (Building 100 › Room 101) and may name a place created by another row in the same call. If any row has a problem nothing is written and every problem is listed. Use dry_run first for anything sizeable and show the person what will change.",
    inputSchema: {
      type: "object",
      properties: {
        site: SITE,
        rows: {
          type: "array",
          maxItems: MAX_ROWS,
          items: {
            type: "object",
            properties: {
              asset: { type: "string", description: "The existing asset to update (id, tag, name or full path). Omit to create a new asset." },
              fields: {
                type: "object",
                description: "Field name to value, e.g. {\"Type\": \"Computer\", \"Name\": \"Front desk PC\", \"Location\": \"Building 100 › Room 101\", \"Serial\": \"ABC123\"}. An empty string clears a field. People (User) and Peripherals take several values separated by /.",
                additionalProperties: true,
              },
            },
            required: ["fields"],
            additionalProperties: false,
          },
        },
        assign_asset_ids: { type: "boolean", description: "Give each NEW asset whose type uses an Asset ID, and that has none in its row, the next ID in sequence, as the app's Add asset does." },
        dry_run: { type: "boolean", description: "Check everything and say exactly what would change, without writing anything." },
      },
      required: ["rows"],
      additionalProperties: false,
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "archive_assets",
    title: "Archive or restore assets",
    description: "Archive assets (the app's soft delete: hidden from the active lists, history kept) or restore archived ones. Nothing is ever permanently deleted. Recorded as this person, via Claude.",
    inputSchema: {
      type: "object",
      properties: {
        site: SITE,
        assets: { type: "array", maxItems: MAX_ROWS, items: { type: "string" }, description: "Id, tag, name or full path of each asset." },
        restore: { type: "boolean", description: "Restore instead of archive." },
      },
      required: ["assets"],
      additionalProperties: false,
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "add_tasks",
    title: "Add tasks in bulk",
    description: "Add up to 500 maintenance tasks in one call, each on its own asset, e.g. a filter clean on every mini split. All or nothing: if one is wrong, none is added. Recorded as this person, via Claude.",
    inputSchema: {
      type: "object",
      properties: {
        site: SITE,
        tasks: {
          type: "array",
          maxItems: MAX_ROWS,
          items: {
            type: "object",
            properties: { asset: { type: "string", description: "Id, tag, name or full path." }, ...TASK_FIELDS },
            required: ["asset", "task"],
            additionalProperties: false,
          },
        },
      },
      required: ["tasks"],
      additionalProperties: false,
    },
    annotations: WRITE,
  },
  {
    name: "edit_task",
    title: "Edit task",
    description: "Change a task's name, kind, frequency, due date, last-done date, owner or notes. Only the fields given change; an empty string clears one (clearing a finished one-off's last_done reopens it). Each change is recorded in the change history as the app records it.",
    inputSchema: {
      type: "object",
      properties: {
        site: SITE,
        task: { type: "string", description: "The task's id (from list_tasks or get_asset), or its name." },
        asset: { type: "string", description: "Narrows a task given by name to this asset, or to anything inside this place." },
        name: { type: "string", description: "A new name for the task." },
        kind: TASK_FIELDS.kind,
        frequency: TASK_FIELDS.frequency,
        last_done: { type: "string", description: "yyyy-mm-dd, or empty to clear." },
        due_date: { type: "string", description: "One-off only: yyyy-mm-dd, or empty to clear." },
        owner: TASK_FIELDS.owner,
        notes: TASK_FIELDS.notes,
      },
      required: ["task"],
      additionalProperties: false,
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "delete_task",
    title: "Delete task",
    description: "Delete a task. Work already logged against it is kept. Recorded in the change history as the app records it.",
    inputSchema: {
      type: "object",
      properties: {
        site: SITE,
        task: { type: "string", description: "The task's id, or its name." },
        asset: { type: "string", description: "Narrows a task given by name to this asset, or to anything inside this place." },
      },
      required: ["task"],
      additionalProperties: false,
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "replace_floor_plan",
    title: "Replace floor plan",
    description: "Put a new floor plan (an SVG drawing, as exported from Visio) on a place: a campus, building, floor or room. Works for a place's first plan too. As in the app's Replace, every room and wall already linked to a shape on the old plan stays linked when the new plan has a shape with the same id or the same title (Space.N), and a link whose shape is gone is dropped and listed. The file is stored on the app's file host. Recorded in the change history as this person, via Claude. Run with dry_run first and tell the person which links carry over and which would be dropped.",
    inputSchema: {
      type: "object",
      properties: {
        site: SITE,
        asset: { type: "string", description: "The place the plan belongs to (id, tag, name or full path)." },
        svg: { type: "string", description: "The whole SVG file, as text." },
        file_name: { type: "string", description: "The file's name, shown in the app and the change history, e.g. campus.svg." },
        dry_run: { type: "boolean", description: "Read the new plan and say which links would carry over, without uploading or writing anything." },
      },
      required: ["asset", "svg", "file_name"],
      additionalProperties: false,
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "set_plan_walls",
    title: "Set floor plan walls",
    description: "Attach Wall assets to outside edges of a place's floor plan, as the Map tab's Walls setup does. Each entry gives one wall its COMPLETE set of edges on this plan: either segment ids from get_plan_walls, or a space plus an optional facing (north, east, south, west) to take every outside edge of that space facing that way. Name an existing Wall in `wall`, or give `name` to create a new Wall asset (parented to the room or building linked to the space unless `parent` says otherwise); `wall` plus `name` renames it. An edge already on a wall not in this change is refused, never taken. `remove` takes walls off this plan and keeps the assets. Recorded in the change history as this person, via Claude. `auto` does the usual case in one go: a new North, East, South and West wall for each space named, from whichever directions its outside edges face. Run with dry_run first and show the person what each wall would get.",
    inputSchema: {
      type: "object",
      properties: {
        site: SITE,
        asset: { type: "string", description: "The place whose floor plan the walls are on (id, tag, name or full path)." },
        walls: {
          type: "array",
          description: "One entry per wall.",
          items: {
            type: "object",
            properties: {
              wall: { type: "string", description: "An existing Wall asset (id, name or path)." },
              name: { type: "string", description: "A new wall's name, e.g. Worship Center North Wall. With `wall`, renames it." },
              parent: { type: "string", description: "Where a new wall sits. Default: what the space is linked to, else this place." },
              segments: { type: "array", items: { type: "string" }, description: "Segment ids from get_plan_walls." },
              space: { type: "string", description: "Instead of segments: a space (title, shape id, or the room or building linked to it)." },
              facing: { type: "string", enum: FACINGS, description: "With space: only its outside edges facing this way." },
            },
            additionalProperties: false,
          },
        },
        auto: { type: "array", items: { type: "string" }, description: "Spaces (title, shape id, or the room or building linked to it) to give a new wall per direction their outside edges face, named e.g. \"Worship Center North Wall\". Adds to walls." },
        remove: { type: "array", items: { type: "string" }, description: "Walls to take off this plan. The Wall assets are kept." },
        dry_run: { type: "boolean", description: "Say what each wall would get, without writing anything." },
      },
      required: ["asset"],
      additionalProperties: false,
    },
    annotations: DESTRUCTIVE,
  },
];

export const WRITE_TOOL_NAMES = [...WRITE_TOOLS, ...MANAGE_TOOLS].map((t) => t.name);

export const TOOLS = [
  ...READ_TOOLS.map((t) => ({ ...t, annotations: { title: t.title, ...READ_ONLY } })),
  ...WRITE_TOOLS.map((t) => ({ ...t, annotations: { title: t.title, ...WRITE } })),
  ...MANAGE_TOOLS.map((t) => ({ ...t, annotations: { title: t.title, ...t.annotations } })),
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
  const rows = {};
  // The revision counters are read BEFORE everything else, so a save landing
  // while the rest loads moves them past what this read saw, and the write
  // that follows is refused instead of acting on a mixed picture.
  if (tables.includes("revisions")) rows.revisions = await ctx.load(site.id, "revisions");
  const want = Array.from(new Set(["assets", "config", ...tables])).filter((t) => t !== "revisions");
  await Promise.all(want.map(async (t) => { rows[t] = await ctx.load(site.id, t); }));
  return { site, rows, inv: buildInventory(rows) };
}

// A management write: ONE call to connector_apply with the revisions this
// read saw, which refuses everything if the inventory has moved since.
async function apply(ctx, site, view, ops, tool) {
  const out = await ctx.write(site.id, "apply", [view.revisions, ops]);
  ctx.log?.("write", { tool, site: site.id, ops: ops.length });
  return out;
}

// A place's floor plan, read for its walls: the drawing's spaces turned the way
// the app shows them, their outside edges, the link rows, and the walls on it.
async function openPlanWalls(ctx, rows, inv, ref, live) {
  const a = live ? liveAsset(inv, ref) : resolveOrThrow(inv, ref);
  if (!a.floorPlanUrl) throw new ToolError(`${inv.nameOf(a)} has no floor plan. Put one on it with replace_floor_plan first.`);
  let spaces;
  try {
    spaces = floorPlanGeometryOf(await ctx.fetchPlan(a.floorPlanUrl));
  } catch (err) {
    if (err instanceof PlanFileError) throw new ToolError(`The floor plan on ${inv.nameOf(a)} could not be read: ${err.message}`);
    throw new ToolError(`The floor plan on ${inv.nameOf(a)} could not be fetched from the file host, so nothing was read or changed.`);
  }
  spaces = rotatedSpaces(spaces, a.floorPlanRotation);
  const edges = exteriorWalls(spaces);
  const links = (rows.space_links || []).filter((r) => r.plan_asset_id === a.id)
    .sort((x, y) => (x.position ?? 0) - (y.position ?? 0)).map((r) => r.data);
  const linkOf = new Map();
  for (const l of links) if (l?.roomId && !/#e\d+(\.\d+)?$/.test(l.shapeId)) linkOf.set(l.shapeId, l.roomId);
  const walls = wallsOnPlan(links, new Set(edges.map((e) => e.id)));
  const resolveSpace = (sref) => {
    const t = norm(sref);
    const hit = spaces.filter((sp) => norm(sp.title) === t || norm(sp.gid) === t);
    if (hit.length === 1) return hit[0];
    if (hit.length > 1) throw new ToolError(`More than one space is called "${sref}"; use its shape id.`);
    const r = inv.resolve(sref);
    if (r.asset) {
      const linked = spaces.filter((sp) => linkOf.get(sp.gid) === r.asset.id);
      if (linked.length === 1) return linked[0];
      if (linked.length > 1) throw new ToolError(`${inv.nameOf(r.asset)} is linked to more than one space; use a shape id.`);
      throw new ToolError(`${inv.nameOf(r.asset)} is not linked to a space on this plan.`);
    }
    throw new ToolError(`No space "${sref}" on this plan.`);
  };
  return { asset: a, spaces, edges, links, linkOf, walls, resolveSpace };
}

function planOrThrow(fn) {
  try {
    return fn();
  } catch (err) {
    if (!(err instanceof PlanError)) throw err;
    const e = new ToolError(err.message);
    e.detail = err.detail;
    throw e;
  }
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

// A new task as addMaintenanceItem builds it. Both halves are always written,
// the unused one blank, so flipping the kind later cannot resurrect either.
function taskItem(args) {
  const task = String(args.task ?? "").trim();
  if (!task) throw new ToolError("Say what the task is.");
  const oneOff = args.kind === "one-off";
  let freq = null;
  if (oneOff) {
    if (args.frequency) throw new ToolError("A one-off task has no frequency. Give a due_date instead, or make it recurring.");
    if (args.last_done) throw new ToolError("A one-off task is added open. Add it, then use complete_task if it is already done.");
  } else {
    if (args.due_date) throw new ToolError("A recurring task's due date comes from its frequency and last-done date. Give last_done, or make it one-off.");
    freq = frequencyOrThrow(args.frequency);
  }
  return {
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
}

function frequencyOrThrow(text) {
  if (!text) throw new ToolError(`Say how often: ${MAINTENANCE_FREQUENCIES.map((f) => f.label).join(", ")}, or e.g. "every 6 weeks".`);
  const freq = frequencyFrom(text);
  if (!freq) throw new ToolError(`"${text}" is not a frequency the app understands. Use ${MAINTENANCE_FREQUENCIES.map((f) => f.label).join(", ")}, "every N days/weeks/months/years", or "first Monday of every month".`);
  return freq;
}

// The revisions a read saw, for a write that needs no asset rules.
const appViewRevisions = (rows) => {
  const out = { assets: 0, config: 0 };
  for (const r of rows.revisions || []) if (r.domain in out) out[r.domain] = Number(r.rev) || 0;
  return { revisions: out };
};

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
      assets: hits.slice(0, limit).map((a) => (args.include_fields
        ? { ...inv.summary(a), users: inv.personNames(a).length ? inv.personNames(a) : undefined, fields: inv.fieldsOf(a) }
        : inv.summary(a))),
    };
  },

  async get_schema(args, ctx) {
    const { site, rows, inv } = await openSite(ctx, args, []);
    const view = appView(rows, site.id);
    return {
      site: site.id,
      ...schemaOf(view),
      lists: {
        peripherals: view.peripheralsList,
        subTypes: view.bulkItemTypes,
        workTypes: changeTypesOf(inv),
        vendors: Array.isArray(inv.cfg.vendors) ? inv.cfg.vendors : [],
      },
      people: view.usersAreAssets
        ? "People are User assets: the User field takes their names, and a new person is created as a User asset first."
        : "People are plain names in the User field (this site has not converted them to User assets).",
      nextAssetId: view.tagPrefix ? view.tagPrefix + String(view.nextAssetNumber).padStart(4, "0") : undefined,
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
    const item = taskItem(args);
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

  // ---------------------------------------------------------------- managing

  async save_assets(args, ctx) {
    const { site, rows, inv } = await openSite(ctx, args, ["revisions"]);
    requireEditor(site);
    const list = Array.isArray(args.rows) ? args.rows : [];
    // Which existing asset each update row names, by the connector's usual
    // lookup. Done first, since the view below must not be split by an await.
    const resolved = list.map((r, i) => {
      if (!r || !r.asset) return { ...r, asset: "" };
      const hit = inv.resolve(r.asset);
      if (hit.asset) return { ...r, asset: hit.asset.id };
      const err = new ToolError(`Row ${i + 1}: ${hit.error}`);
      err.detail = hit.matches;
      throw err;
    });
    const view = appView(rows, site.id);
    const { ops, summary } = planOrThrow(() => planSaveAssets(view, resolved, { assignTags: !!args.assign_asset_ids }));
    const counts = { updated: summary.updated.length, created: summary.created.length, unchanged: summary.unchanged };
    if (args.dry_run) return { site: site.id, dryRun: true, wouldWrite: !!ops.length, counts, ...summary };
    if (!ops.length) return { site: site.id, counts, note: "Nothing to change: every row already matches.", ...summary };
    await apply(ctx, site, view, ops, "save_assets");
    return { site: site.id, counts, ...summary };
  },

  async archive_assets(args, ctx) {
    const { site, rows, inv } = await openSite(ctx, args, ["revisions"]);
    requireEditor(site);
    const refs = Array.isArray(args.assets) ? args.assets : [];
    if (!refs.length) throw new ToolError("Name at least one asset.");
    const ids = [...new Set(refs.map((r) => resolveOrThrow(inv, r).id))];
    const view = appView(rows, site.id);
    const { ops, changed, skipped } = planArchive(view, ids, !!args.restore);
    if (ops.length) await apply(ctx, site, view, ops, "archive_assets");
    return {
      site: site.id,
      [args.restore ? "restored" : "archived"]: changed,
      alreadyThatWay: skipped.length ? skipped : undefined,
    };
  },

  async add_tasks(args, ctx) {
    const { site, rows, inv } = await openSite(ctx, args, ["revisions"]);
    requireEditor(site);
    const list = Array.isArray(args.tasks) ? args.tasks : [];
    if (!list.length) throw new ToolError("Give at least one task.");
    if (list.length > MAX_ROWS) throw new ToolError(`At most ${MAX_ROWS} tasks at a time.`);
    const problems = [];
    const added = [];
    const ops = [];
    list.forEach((t, i) => {
      try {
        const a = liveAsset(inv, t.asset);
        const item = taskItem(t);
        const id = crypto.randomUUID();
        ops.push({ op: "task_insert", id, assetId: a.id, data: item });
        added.push(taskRow(inv, a, { ...item, id }));
      } catch (err) {
        if (!(err instanceof ToolError)) throw err;
        problems.push(`Task ${i + 1}: ${err.message}`);
      }
    });
    if (problems.length) {
      const err = new ToolError("Nothing was added: fix these and send the whole set again.");
      err.detail = problems.slice(0, 50);
      throw err;
    }
    await apply(ctx, site, appViewRevisions(rows), ops, "add_tasks");
    return { site: site.id, added: added.length, tasks: added };
  },

  async edit_task(args, ctx) {
    const { site, rows, inv } = await openSite(ctx, args, ["maintenance", "revisions"]);
    requireEditor(site);
    const r = findTask(inv, rows.maintenance, String(args.task ?? "").trim(), args.asset);
    const a = inv.byId.get(r.asset_id);
    const orig = r.data;
    const given = (k) => args[k] !== undefined && args[k] !== null;
    const oneOff = given("kind") ? args.kind === "one-off" : taskKindOf(orig) === TASK_KIND_ONEOFF;
    let freq = { label: orig.frequencyLabel || "", days: orig.frequencyDays ?? "", recurrence: orig.recurrence || "" };
    if (oneOff) {
      if (given("frequency") && args.frequency !== "") throw new ToolError("A one-off task has no frequency. Give a due_date, or make it recurring.");
    } else {
      if (given("due_date") && args.due_date !== "") throw new ToolError("A recurring task's due date comes from its frequency and last-done date.");
      if (given("frequency") || taskKindOf(orig) === TASK_KIND_ONEOFF) freq = frequencyOrThrow(args.frequency);
    }
    const name = given("name") ? String(args.name).trim() : orig.task;
    if (!name) throw new ToolError("A task needs a name.");
    const updated = {
      ...orig,
      kind: oneOff ? TASK_KIND_ONEOFF : TASK_KIND_SCHEDULED,
      task: name,
      notes: given("notes") ? String(args.notes).trim() : (orig.notes || ""),
      frequencyLabel: oneOff ? "" : freq.label,
      frequencyDays: oneOff ? "" : freq.days,
      recurrence: oneOff ? "" : freq.recurrence,
      dueDate: oneOff ? (given("due_date") ? realDate(args.due_date, "due_date") : (orig.dueDate || "")) : "",
      lastPerformed: given("last_done") ? realDate(args.last_done, "last_done") : (orig.lastPerformed || ""),
      owner: given("owner") ? String(args.owner).trim() : (orig.owner || ""),
    };
    const audit = taskEditAudit(a, orig, updated, taskKindOf);
    if (!audit.length) return { site: site.id, unchanged: taskRow(inv, a, orig), note: "Nothing to change." };
    await apply(ctx, site, appViewRevisions(rows), [
      { op: "task_update", id: r.id, assetId: a.id, data: updated },
      ...audit.map((data) => ({ op: "audit", data })),
    ], "edit_task");
    return {
      site: site.id,
      edited: taskRow(inv, a, updated),
      changes: audit.map((e) => ({ field: e.field.slice(orig.task.length + 3), from: e.from, to: e.to })),
    };
  },

  async delete_task(args, ctx) {
    const { site, rows, inv } = await openSite(ctx, args, ["maintenance", "revisions"]);
    requireEditor(site);
    const r = findTask(inv, rows.maintenance, String(args.task ?? "").trim(), args.asset);
    const a = inv.byId.get(r.asset_id);
    await apply(ctx, site, appViewRevisions(rows), [
      { op: "task_delete", id: r.id, assetId: a.id },
      { op: "audit", data: { assetLabel: a.id, assetType: a.type, action: "maintenance_removed", field: r.data.task || "" } },
    ], "delete_task");
    return { site: site.id, deleted: taskRow(inv, a, r.data) };
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

  async replace_floor_plan(args, ctx) {
    const { site, rows, inv } = await openSite(ctx, args, ["space_links", "space_groups", "revisions"]);
    requireEditor(site);
    const a = liveAsset(inv, args.asset);
    appView(rows, site.id); // applies this site's type settings, which isPlaceType reads
    if (!isPlaceType(a.type)) {
      throw new ToolError(`${inv.nameOf(a)} is a ${inv.typeName(a.type)}, which is not a place. A floor plan goes on a campus, building, floor or room.`);
    }
    const svg = String(args.svg ?? "");
    if (!svg.trim()) throw new ToolError("The SVG is empty.");
    if (new TextEncoder().encode(svg).length > FLOORPLAN_TOOL_MAX_BYTES) {
      throw new ToolError(`That file is too large: a floor plan sent through Claude has to be under ${FLOORPLAN_TOOL_MAX_BYTES / 1024 / 1024}MB.`);
    }
    const fileName = String(args.file_name ?? "").trim().replace(/[\\/]/g, "_");
    if (!/\.svg$/i.test(fileName)) throw new ToolError("file_name has to end in .svg.");
    let newSpaces;
    try {
      newSpaces = floorPlanSpacesOf(svg);
    } catch (err) {
      if (err instanceof PlanFileError) throw new ToolError(err.message);
      throw err;
    }
    if (!newSpaces.length) {
      throw new ToolError("That drawing has no spaces (groups titled Space...), so nothing on it could be linked to a room.");
    }

    const mine = (t) => (rows[t] || []).filter((r) => r.plan_asset_id === a.id)
      .sort((x, y) => (x.position ?? 0) - (y.position ?? 0)).map((r) => r.data);
    const links = mine("space_links");
    const groups = mine("space_groups");

    // The plan being replaced, read for its shape titles. Unreadable is not a
    // refusal: the app goes ahead too, carrying over only unchanged ids.
    let oldSpaces = null;
    let oldPlanNote;
    if (a.floorPlanUrl && (links.length || groups.length)) {
      try {
        oldSpaces = floorPlanSpacesOf(await ctx.fetchPlan(a.floorPlanUrl));
      } catch {
        oldPlanNote = "The current plan could not be read, so only shapes whose id is unchanged keep their links.";
      }
    }
    const plan = planFloorPlanReplace({ links, groups, oldSpaces, newSpaces });
    const linkOut = (l) => {
      const room = inv.byId.get(l.roomId);
      return { shape: l.shapeId, linkedTo: room ? inv.summary(room) : l.roomId };
    };
    const summary = {
      site: site.id,
      asset: inv.summary(a),
      file: fileName,
      replaces: a.floorPlanFileName || (a.floorPlanUrl ? "(a plan)" : undefined),
      spacesOnNewPlan: newSpaces.length,
      linksCarriedOver: plan.links.length,
      linksDropped: plan.droppedLinks.map(linkOut),
      groupsCarriedOver: plan.groups.length,
      groupsDropped: plan.droppedGroups.map((g) => g.name || g.id),
      note: oldPlanNote,
    };
    if (args.dry_run) return { ...summary, dryRun: true };

    // Bytes first, row second, as the app does: a refused write strands a file
    // at the host rather than leaving a plan that points at nothing.
    const uploaded = await ctx.uploadPlan(site.id, svg, fileName);
    await ctx.write(site.id, "replace_floor_plan", [
      appViewRevisions(rows).revisions, a.id,
      { url: uploaded.url, storageKey: uploaded.storageKey, fileName },
      plan.links, plan.groups,
    ]);
    ctx.log?.("write", { tool: "replace_floor_plan", site: site.id, asset: a.id });
    return { ...summary, replaced: true };
  },

  async get_plan_walls(args, ctx) {
    const { site, rows, inv } = await openSite(ctx, args, ["space_links"]);
    const p = await openPlanWalls(ctx, rows, inv, args.asset);
    let spaces = p.spaces;
    if (args.space) spaces = [p.resolveSpace(args.space)];
    const wallOf = new Map();
    for (const [wid, w] of p.walls) for (const s of w.segments) wallOf.set(s, wid);
    const sum = (id) => (inv.byId.has(id) ? inv.summary(inv.byId.get(id)) : { id, missing: true });
    return {
      site: site.id,
      asset: inv.summary(p.asset),
      plan: p.asset.floorPlanFileName || undefined,
      north: "up on the plan as the app shows it",
      spaces: spaces.map((sp) => ({
        space: sp.title,
        shape: sp.gid,
        linkedTo: p.linkOf.get(sp.gid) ? sum(p.linkOf.get(sp.gid)) : undefined,
        outsideEdges: p.edges.filter((e) => e.gid === sp.gid).map((e) => ({
          segment: e.id, facing: e.facing, bearing: e.bearing, length: e.length,
          wall: wallOf.has(e.id) ? sum(wallOf.get(e.id)).name : undefined,
        })),
      })),
      walls: [...p.walls].filter(([, w]) => !args.space || w.segments.some((s) => spaces.some((sp) => s.startsWith(sp.gid + "#")))).map(([wid, w]) => ({
        wall: sum(wid), segments: w.segments, notOnThisPlan: w.stale.length ? w.stale : undefined,
      })),
    };
  },

  async set_plan_walls(args, ctx) {
    const { site, rows, inv } = await openSite(ctx, args, ["space_links", "revisions"]);
    requireEditor(site);
    const p = await openPlanWalls(ctx, rows, inv, args.asset, true);
    const entries = Array.isArray(args.walls) ? args.walls.slice() : [];
    const removeRefs = Array.isArray(args.remove) ? args.remove : [];
    // auto: one new wall per direction a space's outside edges face.
    for (const ref of Array.isArray(args.auto) ? args.auto : []) {
      const sp = p.resolveSpace(ref);
      const linked = p.linkOf.get(sp.gid);
      const base = linked && inv.byId.has(linked) ? inv.nameOf(inv.byId.get(linked)) : sp.title;
      const facings = FACINGS.filter((f) => p.edges.some((e) => e.gid === sp.gid && e.facing === f));
      if (!facings.length) throw new ToolError(`${sp.title} has no outside edges on this plan.`);
      for (const f of facings) entries.push({ name: `${base} ${f[0].toUpperCase()}${f.slice(1)} Wall`, space: sp.gid, facing: f });
    }
    if (!entries.length && !removeRefs.length) throw new ToolError("Give at least one wall, or a wall to remove.");
    if (entries.length > MAX_ROWS) throw new ToolError(`At most ${MAX_ROWS} walls at a time.`);
    const segIds = new Set(p.edges.map((e) => e.id));
    const problems = [];
    const asWall = (ref, label, live) => {
      const r = inv.resolve(ref);
      if (!r.asset) { problems.push(`${label}: ${r.error}`); return null; }
      if (r.asset.type !== "Wall") { problems.push(`${label}: ${inv.nameOf(r.asset)} is a ${inv.typeName(r.asset.type)}, not a Wall.`); return null; }
      if (live && inv.isArchived(r.asset)) { problems.push(`${label}: ${inv.nameOf(r.asset)} is archived. Restore it in the app first.`); return null; }
      return r.asset;
    };

    const removes = [];
    removeRefs.forEach((ref, i) => {
      const w = asWall(ref, `Remove ${i + 1}`, false);
      if (w && !removes.includes(w.id)) removes.push(w.id);
    });

    // Each entry: which wall (existing, or a row for save_assets' planner) and
    // which edges.
    const saveRows = [];
    const planned = entries.map((e, i) => {
      const label = `Wall ${i + 1}${e?.name ? ` (${String(e.name).trim()})` : ""}`;
      if (!e || typeof e !== "object") { problems.push(`${label}: not a wall.`); return null; }
      const name = String(e.name ?? "").trim();
      let wall = null;
      if (e.wall) wall = asWall(e.wall, label, true);
      else if (!name) { problems.push(`${label}: name an existing wall, or give a name for a new one.`); return null; }
      if (e.wall && !wall) return null;
      if (wall && e.parent) problems.push(`${label}: parent is only for a new wall; move an existing one with save_assets.`);

      let space = null;
      if (e.space) {
        try { space = p.resolveSpace(e.space); } catch (err) { if (err instanceof ToolError) { problems.push(`${label}: ${err.message}`); return null; } throw err; }
      }
      let segmentIds;
      if (Array.isArray(e.segments) && e.segments.length) {
        if (space || e.facing) { problems.push(`${label}: give segments, or a space and facing, not both.`); return null; }
        segmentIds = [...new Set(e.segments.map((s) => String(s).trim()))];
      } else if (space) {
        segmentIds = p.edges.filter((x) => x.gid === space.gid && (!e.facing || x.facing === e.facing)).map((x) => x.id);
        if (!segmentIds.length) { problems.push(`${label}: ${space.title} has no outside edge${e.facing ? ` facing ${e.facing}` : ""}.`); return null; }
      } else { problems.push(`${label}: give segments, or a space.`); return null; }

      if (wall) {
        if (name && name !== String(wall.name || "").trim()) saveRows.push({ asset: wall.id, fields: { Name: name } });
        return { label, wallId: wall.id, name: name || inv.nameOf(wall), segmentIds };
      }
      // A new wall sits in what its space is linked to, unless told otherwise.
      let parentId = p.asset.id;
      if (e.parent) {
        const r = inv.resolve(e.parent);
        if (!r.asset) { problems.push(`${label}: ${r.error}`); return null; }
        parentId = r.asset.id;
      } else {
        const gid = space ? space.gid : String(segmentIds[0]).replace(/#e\d+(\.\d+)?$/, "");
        const linked = p.linkOf.get(gid);
        if (linked && inv.byId.has(linked) && !inv.isArchived(inv.byId.get(linked))) parentId = linked;
      }
      saveRows.push({ fields: { Type: "Wall", Name: name, Location: parentId }, newWall: i });
      return { label, wallId: null, name, segmentIds, row: saveRows.length };
    });
    const seen = new Set();
    for (const r of planned) {
      if (!r || !r.wallId) continue;
      if (seen.has(r.wallId)) problems.push(`${r.label}: that wall is named twice.`);
      if (removes.includes(r.wallId)) problems.push(`${r.label}: that wall is also in remove.`);
      seen.add(r.wallId);
    }
    if (problems.length) {
      const err = new ToolError("Nothing was changed.");
      err.detail = problems.slice(0, 50);
      throw err;
    }

    // New walls and renames go through the app's own import rules (a legal
    // parent, the audit rows), exactly as save_assets would write them.
    const view = appView(rows, site.id);
    let saveOps = [];
    let created = [];
    if (saveRows.length) {
      const out = planOrThrow(() => planSaveAssets(view, saveRows.map(({ asset, fields }) => (asset ? { asset, fields } : { fields }))));
      saveOps = out.ops;
      created = out.summary.created;
      for (const r of planned) {
        if (r.wallId) continue;
        const c = created.find((x) => x.row === r.row);
        r.wallId = c ? c.id : null;
        r.parent = c?.location;
      }
    }

    let results;
    try {
      results = planWallChanges({ requests: planned, removes, links: p.links, segIds });
    } catch (err) {
      if (!(err instanceof WallPlanError)) throw err;
      const e = new ToolError(err.message);
      e.detail = err.detail.map((d) => d.replace(/\(([^()]*)\)\. Remove/, (m, ids) => `(${ids.split(", ").map((id) => (inv.byId.has(id) ? inv.nameOf(inv.byId.get(id)) : id)).join(", ")}). Remove`));
      throw e;
    }
    const renamed = new Set(saveRows.filter((r) => r.asset).map((r) => r.asset));
    const changing = results.filter((r) => !r.unchanged || renamed.has(r.wallId) || !r.before.length);
    const removing = removes.filter((id) => p.walls.has(id));
    const edgeOut = (id) => {
      const e = p.edges.find((x) => x.id === id);
      return e ? `${id} (${e.facing}, ${e.length})` : id;
    };
    const summary = {
      site: site.id,
      asset: inv.summary(p.asset),
      walls: results.map((r) => ({
        wall: r.name,
        id: inv.byId.has(r.wallId) ? r.wallId : undefined,
        new: !inv.byId.has(r.wallId) || undefined,
        parent: r.parent,
        segments: r.segmentIds.map(edgeOut),
        replaces: r.before.length && !r.unchanged ? r.before : undefined,
        unchanged: (r.unchanged && !renamed.has(r.wallId)) || undefined,
      })),
      removed: removing.length ? removing.map((id) => inv.nameOf(inv.byId.get(id))) : undefined,
      note: removes.length > removing.length ? "Some walls in remove had no edges on this plan; nothing to take off." : undefined,
    };
    if (args.dry_run) return { ...summary, dryRun: true };
    if (!changing.length && !removing.length) return { ...summary, note: "Nothing to change: every wall already has exactly those edges." };

    // The audit rows the app's Walls setup writes on the plan's own history.
    const ops = [...saveOps];
    for (const r of changing) {
      ops.push({ op: "audit", data: {
        assetLabel: p.asset.id, assetType: p.asset.type, action: "space_linked",
        field: `${r.segmentIds.length} wall segment${r.segmentIds.length === 1 ? "" : "s"}`, to: r.name,
      } });
    }
    for (const id of removing) {
      ops.push({ op: "audit", data: {
        assetLabel: p.asset.id, assetType: p.asset.type, action: "space_unlinked", field: "wall segments", from: inv.nameOf(inv.byId.get(id)),
      } });
    }
    const out = await ctx.write(site.id, "set_plan_walls", [
      view.revisions, p.asset.id, ops,
      changing.map((r) => ({ wallId: r.wallId, segmentIds: r.segmentIds })),
      removing,
    ]);
    ctx.log?.("write", { tool: "set_plan_walls", site: site.id, asset: p.asset.id, walls: changing.length, removed: removing.length });
    return { ...summary, saved: true, revision: out?.revision };
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
