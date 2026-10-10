// Guards the Claude connector (supabase/functions/mcp/): the MCP protocol
// handling, every read tool, site access, and that the task and panel rules it
// reports are the app's own.
//
// Drives the real modules with fixture rows shaped like the Phase 1 tables, so
// it needs no Deno and no database. Sign-in (oauth.js) runs on Node's WebCrypto.
// index.ts (HTTP routing + SQL) is not covered here; CI's deploy smoke-checks it.
//
// Run: node test-mcp-connector.mjs   (exits non-zero on failure)
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { handleMcp, PROTOCOL_VERSIONS } from "./supabase/functions/mcp/protocol.js";
import { TOOLS, WRITE_TOOL_NAMES, roleFor, frequencyFrom, todayIn } from "./supabase/functions/mcp/tools.js";
import { createOAuth, makeSigner, redirectAllowed, sha256b64url, ACCESS_TTL_MS } from "./supabase/functions/mcp/oauth.js";

const here = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "PASS  " : "FAIL  ") + name + (ok || detail === undefined ? "" : `\n        ${detail}`));
  ok ? pass++ : fail++;
};
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ---------------------------------------------------------------- copied code is the app's

{
  const src = fs.readFileSync(path.join(here, "index.html"), "utf8");
  const copy = fs.readFileSync(path.join(here, "supabase/functions/mcp/from-app.js"), "utf8");
  const fn = (n) => {
    const s = src.indexOf(`function ${n}(`);
    const first = src.slice(s, src.indexOf("\n", s));
    return first.trimEnd().endsWith("}") ? first : src.slice(s, src.indexOf("\n}", s) + 2);
  };
  const arr = (n) => { const s = src.indexOf(`const ${n} =`); return src.slice(s, src.indexOf("\n];", s) + 3); };
  const line = (n) => { const s = src.indexOf(`const ${n} =`); return src.slice(s, src.indexOf("\n", s)); };
  const pieces = [
    ...["TASK_KIND_SCHEDULED", "TASK_KIND_ONEOFF", "RECURRENCE_MAX_EVERY", "floorPlanRound2"].map(line),
    ...["RECURRENCE_UNITS", "RECURRENCE_ORDINALS", "MAINTENANCE_FREQUENCIES"].map(arr),
    line("WEEKDAY_NAMES"),
    ...["recurrenceCount", "parseRecurrence", "addCalendarMonths", "nthWeekdayOfMonth", "nextRecurrenceDate",
      "dateOnly", "taskKindOf", "isOneOffTask", "taskIsDone", "taskDueDate", "maintenanceStatusOf", "cellsLabel_",
      "formatRecurrence", "describeRecurrence", "recurrenceApproxDays",
      "floorPlanPathToPoints", "floorPlanRemapShapeIds", "floorPlanRemapLinksAndGroups", "floorPlanSegmentId", "floorPlanSegmentParts",
      // The outside-wall rule, and the geometry it runs on: set_plan_walls must
      // offer exactly the edges the Map tab draws.
      "floorPlanParseTransform", "floorPlanApplyTransform", "floorPlanApplyChain", "floorPlanPointInPoly", "floorPlanBbox",
      "floorPlanRotatePoint", "floorPlanRotateSpaces", "floorPlanIsSegmentId", "floorPlanExteriorSegments", "floorPlanWallCoverSet", "floorPlanSetWallSegments"].map(fn),
  ];
  const missing = pieces.filter((p) => !p || !copy.includes(p)).map((p) => p.split("\n")[0]);
  check("from-app.js matches index.html, piece for piece", missing.length === 0, `stale or missing: ${missing.join(" | ")}`);
}

// ---------------------------------------------------------------- fixture

const day = (offset) => {
  const d = new Date(Date.now() + offset * 86400000);
  return d.toISOString().slice(0, 10);
};
const A = (id, position, parent_id, data) => ({ id, position, parent_id, data: { id, parentId: parent_id || "", ...data } });
const SITES = {
  dev: {
    assets: [
      A("campus", 0, null, { type: "Campus", name: "Main Campus" }),
      A("b200", 1, "campus", { type: "Building", name: "Building 200" }),
      A("b300", 2, "campus", { type: "Building", name: "Building 300", floorPlanUrl: "https://res.cloudinary.com/demo/raw/upload/old.svg", floorPlanFileName: "old.svg" }),
      A("r101", 3, "b200", { type: "Room", name: "Room 101" }),
      A("r101b", 4, "b300", { type: "Room", name: "Room 101" }),
      A("closet", 5, "r101", { type: "Room", name: "Storage Closet" }),
      A("pc1", 6, "closet", { type: "Computer", tag: "BCA0042", name: "Teacher PC", serial: "SN-777", brand: "Dell", personIds: ["u1"], purchaseDate: "2024-08-01T07:00:00.000Z" }),
      A("pc2", 7, "r101b", { type: "Computer", tag: "BCA0043", name: "Lab PC", status: "Archived" }),
      A("u1", 8, null, { type: "User", firstName: "Aaron", lastName: "Cantrell", name: "old name" }),
      A("panelA", 9, "b200", { type: "Electrical Panel", tag: "BCA0082", panelSlotCount: 24, panelPhases: "1" }),
      A("ms1", 10, "r101", { type: "uuid-ms", name: "Mini Split 1" }),
    ],
    space_links: [
      { plan_asset_id: "b300", shape_id: "shape-1", position: 0, data: { shapeId: "shape-1", roomId: "r101b", at: "2026-09-01T00:00:00Z", by: "Eric" } },
      { plan_asset_id: "b300", shape_id: "g-old-2", position: 1, data: { shapeId: "g-old-2", roomId: "closet" } },
      { plan_asset_id: "b300", shape_id: "shape-9", position: 2, data: { shapeId: "shape-9", roomId: "r101" } },
      { plan_asset_id: "b300", shape_id: "g-old-2#e1", position: 3, data: { shapeId: "g-old-2#e1", roomId: "ms1" } },
      { plan_asset_id: "b200", shape_id: "shape-1", position: 0, data: { shapeId: "shape-1", roomId: "r101" } },
    ],
    space_groups: [
      { id: "grp1", plan_asset_id: "b300", position: 0, data: { id: "grp1", name: "Wing", memberShapeIds: ["shape-1", "g-old-2"] } },
      { id: "grp2", plan_asset_id: "b300", position: 1, data: { id: "grp2", name: "Gone", memberShapeIds: ["shape-1", "shape-9"] } },
    ],
    config: [
      { key: "typesList", value: ["Campus", "Building", "Room", "Computer", "User", "Electrical Panel", { id: "uuid-ms", name: "Mini Split" }] },
      { key: "columns", value: [{ key: "serial", label: "Serial #" }, { key: "purchaseDate", label: "Purchased" }] },
      { key: "vendors", value: ["CoolCo", "Sparky Electric"] },
    ],
    revisions: [{ domain: "assets", rev: 7 }, { domain: "config", rev: 3 }],
    maintenance: [
      { id: "m1", asset_id: "ms1", position: 0, data: { id: "m1", task: "Filter clean", frequencyLabel: "Monthly", frequencyDays: 30, lastPerformed: day(-45) } },
      { id: "m2", asset_id: "ms1", position: 1, data: { id: "m2", task: "Coil clean", frequencyLabel: "Annually", frequencyDays: 365 } },
      { id: "m3", asset_id: "b300", position: 0, data: { id: "m3", kind: "oneoff", task: "Repaint", dueDate: day(5) } },
      { id: "m4", asset_id: "b300", position: 1, data: { id: "m4", kind: "oneoff", task: "Replace sign", lastPerformed: day(-3) } },
      { id: "m5", asset_id: "b200", position: 0, data: { id: "m5", kind: "oneoff", task: "Someday roof survey" } },
      { id: "m6", asset_id: "pc2", position: 0, data: { id: "m6", task: "Archived thing", frequencyDays: 30, lastPerformed: day(-90) } },
    ],
    changes: [
      { id: "c1", asset_id: "ms1", position: 0, data: { id: "c1", changeType: "Maintenance", vendor: "CoolCo", cost: "$1,200.50", performedOn: "2026-03-02", maintenanceId: "m1", at: "2026-03-05T10:00:00Z" } },
      { id: "c2", asset_id: "pc1", position: 0, data: { id: "c2", changeType: "Repair", cost: "80", at: "2026-05-01T10:00:00Z" } },
      { id: "c3", asset_id: "b300", position: 0, data: { id: "c3", changeType: "Repair", cost: "", at: "2026-06-01T10:00:00Z" } },
    ],
    comments: [{ asset_id: "pc1", position: 0, data: { text: "Fan noisy", at: "2026-01-01", by: "Eric" } }],
    photos: [{ id: "p1", owner_type: "asset", owner_id: "pc1", kind: "image", data: {} }],
    breakers: [
      { id: "br1", panel_id: "panelA", position: 0, data: { cells: ["1a", "1b"], ampRating: 20 } },
      { id: "br2", panel_id: "panelA", position: 1, data: { cells: ["2b"], ampRating: 15 } },
    ],
    circuits: [
      { id: "ci1", panel_id: "panelA", breaker_id: "br1", position: 0, data: { tag: "1", label: "Outlets", roomsServedIds: ["r101"], wireColor: "Black" } },
      { id: "ci2", panel_id: "panelA", breaker_id: null, position: 0, data: { tag: "U1", label: "Pulled, not landed", roomsServedIds: [] } },
    ],
    audit_log: [
      { seq: 1, asset_id: "pc1", data: { action: "created", at: "2026-01-01T00:00:00Z", by: "Eric" } },
      { seq: 2, asset_id: "pc1", data: { action: "moved", field: "parent", from: "Room 101", to: "Storage Closet", at: "2026-02-01T00:00:00Z", by: "Jen Kramer", related: "r101:from,closet:to" } },
      { seq: 3, asset_id: "gone1", data: { action: "deleted", assetType: "Monitor", at: "2026-03-01T00:00:00Z", by: "Eric" } },
    ],
  },
  bca: { assets: [A("x", 0, null, { type: "Room", name: "Secret Room" })], config: [] },
};

const loads = [];
const ctxFor = (sites) => ({
  sites,
  load: async (tenant, table) => {
    loads.push(tenant);
    if (!sites.some((s) => s.id === tenant)) throw new Error("site not permitted");
    return SITES[tenant][table] || [];
  },
  logged: [],
  log(event, detail) { this.logged.push({ event, detail }); },
  // Stands in for index.ts's call to the 0006 Postgres function, which
  // db/test-connector-writes.sql covers against a real database.
  writes: [],
  async write(tenant, op, args) {
    if (!sites.some((s) => s.id === tenant)) throw new Error("site not permitted");
    this.writes.push({ tenant, op, args });
    return { id: `new-${this.writes.length}`, revision: 99 };
  },
});
const ONE = [{ id: "dev", name: "Development", role: "editor" }];
const TWO = [...ONE, { id: "bca", name: "Brookside", role: "viewer" }];

let nextId = 1;
const call = async (name, args, ctx = ctxFor(ONE)) => {
  const res = await handleMcp({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }, ctx);
  const r = res.body.result;
  return { isError: !!r?.isError, data: r?.structuredContent ?? (() => { try { return JSON.parse(r?.content?.[0]?.text || "null"); } catch { return null; } })(), raw: res.body, text: r?.content?.[0]?.text };
};

// ---------------------------------------------------------------- protocol

{
  const init = await handleMcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t" } } }, ctxFor(ONE));
  eq("initialize echoes a supported version", init.body.result.protocolVersion, "2025-03-26");
  check("initialize declares tools", !!init.body.result.capabilities.tools);
  const init2 = await handleMcp({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }, ctxFor(ONE));
  eq("initialize answers the newest for an unknown version", init2.body.result.protocolVersion, PROTOCOL_VERSIONS[0]);
  const note = await handleMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, ctxFor(ONE));
  eq("a notification gets 202 and no body", [note.status, note.body], [202, null]);
  const unknown = await handleMcp({ jsonrpc: "2.0", id: 3, method: "resources/list" }, ctxFor(ONE));
  eq("unknown method is -32601", unknown.body.error.code, -32601);
  const bad = await handleMcp({ hello: 1 }, ctxFor(ONE));
  eq("malformed message is -32600", bad.body.error.code, -32600);
  const list = await handleMcp({ jsonrpc: "2.0", id: 4, method: "tools/list" }, ctxFor(ONE));
  const tools = list.body.result.tools;
  eq("tools/list names every tool", tools.map((t) => t.name), TOOLS.map((t) => t.name));
  // Claude asks before a tool not marked read-only, so a write marked
  // read-only would run without asking. Exactly the writes are writes, and the
  // ones that overwrite or remove something say so.
  const WRITES = ["add_comment", "add_task", "add_tasks", "archive_assets", "complete_task", "delete_task", "edit_task", "log_work", "replace_floor_plan", "save_assets", "set_plan_walls"];
  eq("exactly the write tools are marked as writes",
    tools.filter((t) => t.annotations.readOnlyHint !== true).map((t) => t.name).sort(), WRITES);
  eq("the write tool list matches", [...WRITE_TOOL_NAMES].sort(), WRITES);
  eq("exactly the tools that overwrite or remove are marked destructive",
    tools.filter((t) => t.annotations.destructiveHint !== false).map((t) => t.name).sort(),
    ["archive_assets", "delete_task", "edit_task", "replace_floor_plan", "save_assets", "set_plan_walls"]);
  check("every tool's annotations carry its title", tools.every((t) => t.annotations.title === t.title));
  check("every tool's schema is a closed object",
    tools.every((t) => t.inputSchema.type === "object" && t.inputSchema.additionalProperties === false));
  const nope = await handleMcp({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "delete_everything" } }, ctxFor(ONE));
  eq("calling a tool that does not exist is -32602", nope.body.error.code, -32602);
}

// ---------------------------------------------------------------- sites and access

{
  eq("roleFor: the owner is always an editor", roleFor("Owner@X.org", { owner_email: "owner@x.org" }, []), "editor");
  eq("roleFor: allowlist, case-insensitive", roleFor("JEN@x.org", { owner_email: "o@x.org" }, [{ email: "jen@x.org", role: "viewer" }]), "viewer");
  eq("roleFor: a stranger gets nothing", roleFor("who@x.org", { owner_email: "o@x.org" }, [{ email: "jen@x.org", role: "viewer" }]), null);
  eq("roleFor: no email gets nothing", roleFor("", { owner_email: "" }, []), null);

  const none = await call("search_assets", {}, ctxFor([]));
  check("no sites: refused with a reason", none.isError && /access list/.test(none.data.message));
  const two = await call("search_assets", {}, ctxFor(TWO));
  check("two sites and none named: asks which", two.isError && /dev, bca/.test(two.data.message));
  loads.length = 0;
  const other = await call("search_assets", { site: "3c" }, ctxFor(TWO));
  check("a site not on the list is refused before anything loads", other.isError && loads.length === 0);
  const named = await call("search_assets", { site: "Brookside" }, ctxFor(TWO));
  check("a site can be named by its name", !named.isError && named.data.site === "bca");
  const sites = await call("list_sites", {}, ctxFor(TWO));
  eq("list_sites", sites.data.sites.map((s) => `${s.id}:${s.role}`), ["dev:editor", "bca:viewer"]);
  const fault = await call("search_assets", {}, { ...ctxFor(ONE), load: async () => { throw new Error("connection refused at 10.0.0.1"); } });
  check("a database fault is reported vaguely, never verbatim", fault.isError && !/10\.0\.0\.1/.test(fault.text));
}

// ---------------------------------------------------------------- search and resolve

{
  const all = await call("search_assets", {});
  check("archived assets are left out by default", !all.data.assets.some((a) => a.id === "pc2"));
  const arch = await call("search_assets", { status: "archived" });
  eq("status archived", arch.data.assets.map((a) => a.id), ["pc2"]);
  const words = await call("search_assets", { query: "dell teacher" });
  eq("all words must match, across fields", words.data.assets.map((a) => a.id), ["pc1"]);
  const bySerial = await call("search_assets", { query: "sn-777" });
  eq("serial is searchable", bySerial.data.assets.map((a) => a.id), ["pc1"]);
  const byUser = await call("search_assets", { query: "cantrell" });
  check("a device is found by its user's name", byUser.data.assets.some((a) => a.id === "pc1"));
  const typed = await call("search_assets", { type: "mini split" });
  eq("type by its name, for a type with a generated id", typed.data.assets.map((a) => a.id), ["ms1"]);
  const within = await call("search_assets", { within: "Building 200", type: "Computer" });
  eq("within reaches any depth", within.data.assets.map((a) => a.id), ["pc1"]);
  const withinSelf = await call("search_assets", { within: "Building 200" });
  check("within includes the place itself", withinSelf.data.assets.some((a) => a.id === "b200"));
  const amb = await call("search_assets", { within: "Room 101" });
  check("an ambiguous name is an error listing both", amb.isError && amb.data.matches?.length === 2);
  check("the ambiguity says where each one is", amb.data.matches?.some((m) => /Building 300/.test(m.location)));
  const byPath = await call("search_assets", { within: "Main Campus › Building 300 › Room 101", status: "all" });
  check("a full path resolves the ambiguity", !byPath.isError && byPath.data.assets.some((a) => a.id === "pc2"));
  const byTag = await call("get_asset", { asset: "bca0042" });
  eq("a tag resolves, case-insensitive", byTag.data.id, "pc1");
  const lim = await call("search_assets", { limit: 2 });
  check("limit truncates and says so", lim.data.assets.length === 2 && lim.data.truncated === true && lim.data.total > 2);
}

// ---------------------------------------------------------------- get_asset and browse

{
  const a = (await call("get_asset", { asset: "pc1" })).data;
  eq("location is the full path above it", a.location, "Main Campus › Building 200 › Room 101 › Storage Closet");
  eq("users are resolved from personIds", a.users, ["Aaron Cantrell"]);
  eq("fields use the app's labels and date-only values", [a.fields["Serial #"], a.fields["Purchased"]], ["SN-777", "2024-08-01"]);
  eq("comments come through", a.comments.map((c) => c.text), ["Fan noisy"]);
  eq("files are counted", a.files, 1);
  const u = (await call("get_asset", { asset: "u1" })).data;
  eq("a person is named by their parts, not the stale name cell", u.name, "Aaron Cantrell");
  const ms = (await call("get_asset", { asset: "Mini Split 1" })).data;
  eq("an asset's tasks", ms.tasks.map((t) => `${t.task}:${t.status}`), ["Filter clean:overdue", "Coil clean:never"]);
  eq("recent work, cost parsed", ms.recentWork.map((w) => w.cost), [1200.5]);
  const top = (await call("browse_location", {})).data;
  eq("top level lists the roots", top.items.map((i) => i.id), ["campus", "u1"]);
  const b200 = (await call("browse_location", { location: "Building 200" })).data;
  eq("browse lists direct children with counts", b200.items.map((i) => `${i.id}:${i.contains || 0}`), ["r101:2", "panelA:0"]);
}

// ---------------------------------------------------------------- tasks

{
  const open = (await call("list_tasks", {})).data;
  eq("open: most urgent first, done and archived left out",
    open.tasks.map((t) => `${t.task}:${t.status}`),
    ["Filter clean:overdue", "Coil clean:never", "Repaint:due-soon", "Someday roof survey:undated"]);
  eq("counts by status", open.counts, { overdue: 1, never: 1, "due-soon": 1, undated: 1 });
  const done = (await call("list_tasks", { status: "done" })).data;
  eq("status done", done.tasks.map((t) => t.task), ["Replace sign"]);
  const scoped = (await call("list_tasks", { within: "Building 300" })).data;
  eq("within scopes tasks, including the place's own", scoped.tasks.map((t) => t.task), ["Repaint"]);
  const soon = (await call("list_tasks", { due_within_days: 7 })).data;
  eq("due_within_days keeps overdue and near ones", soon.tasks.map((t) => t.task), ["Filter clean", "Repaint"]);
  check("a one-off reads as one-off", open.tasks.find((t) => t.task === "Repaint").kind === "one-off");
}

// ---------------------------------------------------------------- work and audit

{
  const w = (await call("get_work_history", {})).data;
  eq("work newest first", w.work.map((x) => x.date), ["2026-06-01", "2026-05-01", "2026-03-02"]);
  eq("total cost skips blanks", w.totalCost, 1280.5);
  eq("a linked task is named", w.work.find((x) => x.task).task, "Filter clean");
  eq("performedOn beats at", w.work[2].date, "2026-03-02");
  const ranged = (await call("get_work_history", { since: "2026-04-01", until: "2026-05-31" })).data;
  eq("date range", ranged.work.map((x) => x.date), ["2026-05-01"]);
  const badDate = await call("get_work_history", { since: "last week" });
  check("a malformed date is refused", badDate.isError);
  const scopedW = (await call("get_work_history", { within: "Main Campus › Building 200 › Room 101" })).data;
  eq("work within a place", scopedW.work.map((x) => x.asset.id).sort(), ["ms1", "pc1"]);

  const all = (await call("get_audit", {})).data;
  eq("audit newest first", all.entries.map((e) => e.action), ["deleted", "moved", "created"]);
  eq("a deleted asset reads as its type and id", all.entries[0].asset, "Monitor gone1 (deleted)");
  const closet = (await call("get_audit", { asset: "Storage Closet" })).data;
  eq("an entry naming the asset in `related` counts", closet.entries.map((e) => e.action), ["moved"]);
  const byJen = (await call("get_audit", { by: "jen" })).data;
  eq("filter by person", byJen.entries.map((e) => e.action), ["moved"]);
  const since = (await call("get_audit", { since: "2026-01-15" })).data;
  eq("filter by date", since.total, 2);
}

// ---------------------------------------------------------------- panels

{
  const p = (await call("panel_lookup", { panel: "BCA0082" })).data;
  eq("breakers with the app's slot labels", p.breakers.map((b) => `${b.slot}:${b.amps}`), ["1:20", "2b:15"]);
  eq("circuits under their breaker", p.breakers[0].circuits.map((c) => c.description), ["Outlets"]);
  eq("unassigned circuits listed", p.unassignedCircuits.map((c) => c.circuit), ["U1"]);
  const r = (await call("panel_lookup", { room: "BCA0042" })).data;
  eq("an asset finds the room above it that a circuit serves", r.room.id, "r101");
  eq("and the panel and slot", r.circuits.map((c) => `${c.panel}:${c.slot}`), ["BCA0082:1"]);
  const both = await call("panel_lookup", { panel: "BCA0082", room: "r101" });
  check("panel and room together is refused", both.isError);
  const nothing = (await call("panel_lookup", { room: "Building 300" })).data;
  eq("a place no circuit serves says so", nothing.circuits, []);
}

// ---------------------------------------------------------------- writes

{
  // index.ts: a record must reach Postgres as text cast to jsonb (see WRITE_SQL).
  const ts = fs.readFileSync(path.join(here, "supabase/functions/mcp/index.ts"), "utf8");
  check("every jsonb parameter in index.ts goes through ::text", (ts.match(/::jsonb/g) || []).length === (ts.match(/::text::jsonb/g) || []).length && /::text::jsonb/.test(ts));
  check("index.ts has a writer for every write tool",
    ["add_task", "complete_task", "log_work", "add_comment", "apply", "replace_floor_plan", "set_plan_walls"].every((n) => ts.includes(`connector_${n}(`)));
  check("index.ts loads the revisions a management write sends back", /revisions: "select domain, rev from asset_tracker\.revisions"/.test(ts));
  // Frequencies come out exactly as the app stores them.
  eq("a preset frequency", frequencyFrom("semi annually"), { label: "Semi-Annually", days: 182, recurrence: "" });
  eq("an interval frequency", frequencyFrom("Every 6 weeks"), { label: "Every 6 weeks", days: 42, recurrence: "interval:6:week" });
  eq("every month is a calendar month, not the 30-day preset", frequencyFrom("every month").recurrence, "interval:1:month");
  eq("a weekday frequency", frequencyFrom("first Monday of every month"), { label: "First Monday of every month", days: 30, recurrence: "weekday:1:1:1" });
  eq("a weekday frequency every N months", frequencyFrom("last Friday, every 2 months").recurrence, "weekday:-1:5:2");
  eq("an unknown frequency is null", [frequencyFrom("biweekly"), frequencyFrom("first Funday"), frequencyFrom("")], [null, null, null]);
  // 2026-10-09 04:00 UTC is still the 8th in California.
  eq("today is the site's day, not UTC's", todayIn(undefined, new Date("2026-10-09T04:00:00Z")), "2026-10-08");

  const w = async (name, args, sites = ONE) => { const ctx = ctxFor(sites); const r = await call(name, args, ctx); return { ...r, writes: ctx.writes }; };

  // add_task
  let r = await w("add_task", { asset: "Mini Split 1", task: "Drain check", frequency: "Quarterly", last_done: "2026-09-01", owner: " Jim " });
  eq("add_task writes the app's record shape", r.writes, [{ tenant: "dev", op: "add_task", args: ["ms1", {
    kind: "scheduled", task: "Drain check", notes: "", frequencyLabel: "Quarterly", frequencyDays: 90, recurrence: "",
    dueDate: "", lastPerformed: "2026-09-01", owner: "Jim" }] }]);
  eq("add_task answers with the new task's status", [r.data.added.id, r.data.added.due, r.data.added.status], ["new-1", "2026-11-30", "ok"]);
  r = await w("add_task", { asset: "b300", task: "Gutters", kind: "one-off", due_date: "2026-11-01" });
  eq("a one-off keeps its due date and blanks the schedule half",
    [r.writes[0].args[1].kind, r.writes[0].args[1].dueDate, r.writes[0].args[1].frequencyLabel, r.writes[0].args[1].frequencyDays], ["oneoff", "2026-11-01", "", ""]);
  for (const [label, args] of [
    ["a recurring task with no frequency", { asset: "ms1", task: "X" }],
    ["an unknown frequency", { asset: "ms1", task: "X", frequency: "fortnightly-ish" }],
    ["a recurring task given a due date", { asset: "ms1", task: "X", frequency: "Weekly", due_date: "2026-11-01" }],
    ["a one-off given a frequency", { asset: "ms1", task: "X", kind: "one-off", frequency: "Weekly" }],
    ["an impossible date", { asset: "ms1", task: "X", kind: "one-off", due_date: "2026-02-30" }],
    ["an archived asset", { asset: "Lab PC", task: "X", frequency: "Weekly" }],
    ["an ambiguous asset", { asset: "Room 101", task: "X", frequency: "Weekly" }],
    ["a blank task", { asset: "ms1", task: "  ", frequency: "Weekly" }],
  ]) {
    r = await w("add_task", args);
    check(`add_task refuses ${label}, writing nothing`, r.isError && r.writes.length === 0, r.text);
  }

  // A viewer is refused before anything is written, on every write tool.
  const VIEWER = [{ id: "dev", name: "Development", role: "viewer" }];
  for (const [tool, args] of [
    ["add_task", { asset: "ms1", task: "X", frequency: "Weekly" }],
    ["complete_task", { task: "m1" }],
    ["log_work", { asset: "ms1", work_type: "Repair" }],
    ["add_comment", { asset: "ms1", text: "hi" }],
  ]) {
    r = await w(tool, args, VIEWER);
    check(`${tool} refuses a viewer, writing nothing`, r.isError && r.writes.length === 0 && /view-only/.test(r.text), r.text);
  }
  r = await w("add_comment", { site: "bca", asset: "x", text: "hi" }, TWO);
  check("a write on a site where this person is a viewer is refused", r.isError && r.writes.length === 0, r.text);

  // complete_task
  r = await w("complete_task", { task: "filter clean", date: "2026-10-05", vendor: "coolco", cost: "$120", note: "dusty" });
  eq("complete_task by name defaults to Maintenance and spells the vendor as the list does", r.writes[0], { tenant: "dev", op: "complete_task",
    args: ["m1", "2026-10-05", { changeType: "Maintenance", vendor: "CoolCo", cost: "$120", note: "dusty" }] });
  eq("complete_task reports the task as done and when it was last done before",
    [r.data.completed.status, r.data.completed.lastDone, r.data.previouslyDone], ["ok", "2026-10-05", day(-45)]);
  r = await w("complete_task", { task: "m3" });
  eq("a completion with no date is today, in the site's zone", r.writes[0].args[1], todayIn());
  for (const [label, args] of [
    ["a finished one-off", { task: "Replace sign" }],
    ["a task on an archived asset", { task: "m6" }],
    ["a task that does not exist", { task: "Polish the moon" }],
    ["a vendor not on the list", { task: "m1", vendor: "Some Guy" }],
    ["a work type not on the list", { task: "m1", work_type: "Magic" }],
    ["a cost that is not an amount", { task: "m1", cost: "a lot" }],
    ["a name outside the asset given", { task: "Filter clean", asset: "Building 300" }],
  ]) {
    r = await w("complete_task", args);
    check(`complete_task refuses ${label}, writing nothing`, r.isError && r.writes.length === 0, r.text);
  }
  {
    // Two tasks sharing a name is a question, never the first one.
    SITES.dev.maintenance.push({ id: "m7", asset_id: "b300", position: 2, data: { id: "m7", task: "Filter clean", frequencyDays: 30 } });
    r = await w("complete_task", { task: "Filter clean" });
    check("two tasks with one name are refused, listing both", r.isError && r.writes.length === 0 && /2 tasks/.test(r.text) && /m7/.test(r.text) && /m1/.test(r.text), r.text);
    r = await w("complete_task", { task: "Filter clean", asset: "Building 300" });
    eq("naming the place picks the one inside it", r.writes[0]?.args[0], "m7");
    SITES.dev.maintenance.pop();
  }

  // log_work
  r = await w("log_work", { asset: "Teacher PC", work_type: "repair", date: "2026-10-01", cost: "80", task: "nonexistent" });
  check("log_work refuses a task that is not on the asset", r.isError && r.writes.length === 0, r.text);
  r = await w("log_work", { asset: "Mini Split 1", work_type: "repair", date: "2026-10-01", task: "Coil clean" });
  eq("log_work links a task on the asset without completing it", r.writes[0], { tenant: "dev", op: "log_work",
    args: ["ms1", { changeType: "Repair", vendor: "", cost: "", note: "", performedOn: "2026-10-01", maintenanceId: "m2" }] });
  r = await w("log_work", { asset: "ms1" });
  check("log_work needs a work type", r.isError && r.writes.length === 0, r.text);

  // add_comment
  r = await w("add_comment", { asset: "BCA0042", text: "  Fan replaced  " });
  eq("add_comment trims and writes against the asset's id", r.writes[0], { tenant: "dev", op: "add_comment", args: ["pc1", "Fan replaced"] });
}

// ---------------------------------------------------------------- managing assets and tasks

{
  // app-rules.js is GENERATED from index.html; a stale copy is the app's rules
  // drifting away from what the connector checks.
  const { generate, OUT } = await import("./supabase/functions/mcp/gen-app-rules.mjs");
  check("app-rules.js is up to date with index.html (run gen-app-rules.mjs)", fs.readFileSync(OUT, "utf8") === generate());
  // Every name the sliced code calls or reads in CAPITALS is declared in it: a
  // declaration left out of PIECES is otherwise a ReferenceError only on the
  // one path that reaches it (a user-made type, say).
  {
    const src = fs.readFileSync(OUT, "utf8").replace(/\/\/.*$/gm, "").replace(/"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*'/g, '""');
    const declared = new Set([...src.matchAll(/(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
    const called = [...src.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
    const caps = src.match(/(?<![.\w$])[A-Z][A-Z0-9_]{2,}\b/g) || [];
    const builtin = new Set([...Object.getOwnPropertyNames(globalThis), "if", "for", "while", "switch", "return", "catch", "function", "typeof"]);
    const missing = [...new Set([...called, ...caps])].filter((n) => !declared.has(n) && !builtin.has(n));
    eq("app-rules.js declares everything it uses", missing, []);
  }
  const { ASSET_FIELDS } = await import("./supabase/functions/mcp/asset-writes.js");
  const shape = fs.readFileSync(path.join(here, "supabase/functions/asset-api/save-shape.ts"), "utf8");
  const lit = /export const ASSET_FIELDS = (\[[\s\S]*?\]);/.exec(shape)[1];
  eq("asset-writes.js stores the save's own ASSET_FIELDS", ASSET_FIELDS, JSON.parse(lit.replace(/,\s*\]$/, "]")));

  const writesOf = (ctx) => ctx.writes.filter((w) => w.op === "apply");
  const opsOf = (ctx) => writesOf(ctx).flatMap((w) => w.args[1]);
  const audits = (ctx) => opsOf(ctx).filter((o) => o.op === "audit").map((o) => o.data);

  // Schema.
  const sc = (await call("get_schema", {})).data;
  const t = (n) => sc.types.find((x) => x.name === n);
  check("schema: a Computer has its fields, under the site's own labels", t("Computer").fields.includes("Serial #") && t("Computer").fields.includes("Location"));
  check("schema: a Room has no Serial, and sits in a Building or a Room", !t("Room").fields.includes("Serial #") && t("Room").canSitInside.includes("Building"));
  check("schema: a user-made type resolves by name", !!t("Mini Split"));
  check("schema: people are User assets on this site", /User assets/.test(sc.people));
  eq("schema: lists the vendors", sc.lists.vendors, ["CoolCo", "Sparky Electric"]);

  // A new building, a room in it and a computer in that, child FIRST.
  const tree = [
    { fields: { Type: "Computer", Name: "Front desk PC", Location: "Main Campus › Building 400 › Room 401", "Serial #": "NEW-1", User: "Aaron Cantrell" } },
    { fields: { Type: "Room", Name: "Room 401", Location: "Main Campus › Building 400" } },
    { fields: { type: "building", name: "Building 400", parent: "Main Campus" } },
  ];
  let ctx = ctxFor(ONE);
  const dry = await call("save_assets", { rows: tree, dry_run: true }, ctx);
  check("dry run: plans three new assets and writes nothing", !dry.isError && dry.data.counts.created === 3 && ctx.writes.length === 0, dry.text);
  ctx = ctxFor(ONE);
  const made = await call("save_assets", { rows: tree, assign_asset_ids: true }, ctx);
  const ops = opsOf(ctx);
  check("create: one apply call, with the revisions read", !made.isError && writesOf(ctx).length === 1 && JSON.stringify(writesOf(ctx)[0].args[0]) === JSON.stringify({ assets: 7, config: 3 }), made.text);
  const created = ops.filter((o) => o.op === "asset_create").map((o) => o.data);
  const pc = created.find((a) => a.name === "Front desk PC");
  const room = created.find((a) => a.name === "Room 401");
  const bldg = created.find((a) => a.name === "Building 400");
  check("create: the tree hangs together", pc && room && bldg && pc.parentId === room.id && room.parentId === bldg.id && bldg.parentId === "campus");
  eq("create: the computer gets the next Asset ID, the places none", [pc?.tag, room?.tag, bldg?.tag], ["BCA0001", "", ""]);
  eq("create: people resolve to User ids", pc?.personIds, ["u1"]);
  check("create: stored in the save's shape (every field, blanks as \"\")", pc && pc.brand === "" && pc.status === "Active" && "mapY" in pc);
  eq("create: one created audit row each, naming where", audits(ctx).filter((a) => a.action === "created").map((a) => a.related).sort(),
    ["campus:at", `${bldg?.id}:at`, `${room?.id}:at`].sort());
  check("create: the counter moves past the new Asset ID", ops.some((o) => o.op === "config" && o.key === "nextAssetNumber" && o.value === 2));

  // An update changes only what it names, and is audited per field.
  ctx = ctxFor(ONE);
  const up = await call("save_assets", { rows: [{ asset: "BCA0042", fields: { "Serial #": "SN-888" } }] }, ctx);
  const u = opsOf(ctx).find((o) => o.op === "asset_update")?.data;
  check("update: the field changes and the rest is kept", !up.isError && u && u.serial === "SN-888" && u.brand === "Dell" && u.tag === "BCA0042" && u.parentId === "closet" && u.personIds[0] === "u1", up.text);
  eq("update: one edited row, as the app's import writes it", audits(ctx).map((a) => [a.action, a.field, a.from, a.to]), [["edited", "Serial #", "SN-777", "SN-888"]]);

  ctx = ctxFor(ONE);
  const amb = await call("save_assets", { rows: [{ asset: "pc1", fields: { Location: "Room 101" } }] }, ctx);
  check("move: an ambiguous place is refused and nothing written", amb.isError && /more than one/.test(amb.text) && ctx.writes.length === 0, amb.text);
  ctx = ctxFor(ONE);
  const mv = await call("save_assets", { rows: [{ asset: "pc1", fields: { Location: "Main Campus › Building 300 › Room 101" } }] }, ctx);
  const mvRow = audits(ctx)[0];
  check("move: lands in both rooms' history", !mv.isError && mvRow?.field === "Location" && mvRow?.related === "closet:from,r101b:to", mv.text);

  // Mixed rows: the update row keeps its own parent although another row sets one.
  ctx = ctxFor(ONE);
  const mix = await call("save_assets", { rows: [
    { asset: "pc1", fields: { "Serial #": "X1" } },
    { fields: { Type: "Computer", Name: "Spare", Location: "Main Campus › Building 200 › Room 101" } },
  ] }, ctx);
  eq("mixed: an update row's other columns are left as they are", audits(ctx).filter((a) => a.action === "edited").map((a) => a.field), ["Serial #"]);
  check("mixed: ok", !mix.isError, mix.text);

  ctx = ctxFor(ONE);
  const same = await call("save_assets", { rows: [{ asset: "pc1", fields: { "Serial #": "SN-777" } }] }, ctx);
  check("unchanged: nothing written", !same.isError && ctx.writes.length === 0 && same.data.counts.unchanged === 1, same.text);

  const refused = async (label, args, re) => {
    const c = ctxFor(ONE);
    const r = await call("save_assets", args, c);
    check(label, r.isError && re.test(r.text) && c.writes.length === 0, r.text);
  };
  await refused("refused: a field that does not exist", { rows: [{ asset: "pc1", fields: { Colour: "red" } }] }, /not a field/);
  await refused("refused: status goes through archive_assets", { rows: [{ asset: "pc1", fields: { Status: "Archived" } }] }, /archive_assets/);
  await refused("refused: a new asset with no type", { rows: [{ fields: { Name: "Mystery" } }] }, /needs a Type/);
  await refused("refused: a new asset wearing a tag already in use", { rows: [{ fields: { Type: "Computer", "Asset ID": "bca0042" } }] }, /already on Teacher PC/);
  await refused("refused: a bad row refuses the good ones too", { rows: [
    { asset: "pc1", fields: { "Serial #": "OK" } },
    { fields: { Type: "Computer", Location: "Nowhere › At All" } },
  ] }, /Row 2/);
  await refused("refused: a type that cannot sit there", { rows: [{ fields: { Type: "Building", Name: "B9", Location: "Main Campus › Building 200 › Room 101" } }] }, /Row 1/);
  const viewer = ctxFor([{ id: "dev", name: "Development", role: "viewer" }]);
  const vr = await call("save_assets", { rows: [{ asset: "pc1", fields: { "Serial #": "X" } }] }, viewer);
  check("refused: a viewer", vr.isError && /view-only/.test(vr.text) && viewer.writes.length === 0);

  // Archive and restore.
  ctx = ctxFor(ONE);
  const ar = await call("archive_assets", { assets: ["pc1", "pc2"] }, ctx);
  check("archive: archives, and says which already were", !ar.isError && ar.data.archived.length === 1 && ar.data.alreadyThatWay.length === 1, ar.text);
  check("archive: the status and the app's audit row", opsOf(ctx).find((o) => o.op === "asset_update")?.data.status === "Archived"
    && audits(ctx)[0]?.action === "archived" && audits(ctx)[0]?.related === "closet:at");
  ctx = ctxFor(ONE);
  await call("archive_assets", { assets: ["pc2"], restore: true }, ctx);
  check("restore: back to Active, audited", opsOf(ctx).find((o) => o.op === "asset_update")?.data.status === "Active" && audits(ctx)[0]?.action === "restored");

  // Tasks.
  ctx = ctxFor(ONE);
  const at = await call("add_tasks", { tasks: [
    { asset: "ms1", task: "Drain line flush", frequency: "Quarterly" },
    { asset: "Building 300", task: "Gutter clean", kind: "one-off", due_date: "2026-11-01" },
  ] }, ctx);
  const ins = opsOf(ctx).filter((o) => o.op === "task_insert");
  check("add_tasks: one insert each, in one call", !at.isError && ins.length === 2 && ins[0].assetId === "ms1" && ins[1].data.dueDate === "2026-11-01" && ins[1].data.frequencyLabel === "", at.text);
  ctx = ctxFor(ONE);
  const atBad = await call("add_tasks", { tasks: [{ asset: "ms1", task: "Ok", frequency: "Monthly" }, { asset: "ms1", task: "No freq" }] }, ctx);
  check("add_tasks: one bad task adds none", atBad.isError && /Task 2/.test(atBad.text) && ctx.writes.length === 0, atBad.text);

  ctx = ctxFor(ONE);
  const ed = await call("edit_task", { task: "m1", name: "Filter wash", owner: "Facilities" }, ctx);
  const upd = opsOf(ctx).find((o) => o.op === "task_update");
  check("edit_task: only the given fields change", !ed.isError && upd?.data.task === "Filter wash" && upd?.data.frequencyLabel === "Monthly" && upd?.data.owner === "Facilities", ed.text);
  eq("edit_task: audited as the app audits it", audits(ctx).map((a) => [a.action, a.field, a.from, a.to]),
    [["maintenance_edited", "Filter clean — Task", "Filter clean", "Filter wash"], ["maintenance_edited", "Filter clean — Owner", "—", "Facilities"]]);
  ctx = ctxFor(ONE);
  const reopen = await call("edit_task", { task: "Replace sign", last_done: "" }, ctx);
  check("edit_task: clearing a one-off's date reopens it, worded Completed", !reopen.isError && audits(ctx)[0]?.field === "Replace sign — Completed" && audits(ctx)[0]?.to === "—", reopen.text);
  ctx = ctxFor(ONE);
  const noop = await call("edit_task", { task: "m1", owner: "" }, ctx);
  check("edit_task: no change, no write", !noop.isError && ctx.writes.length === 0, noop.text);
  ctx = ctxFor(ONE);
  const flip = await call("edit_task", { task: "m3", kind: "recurring" }, ctx);
  check("edit_task: a one-off made recurring needs a frequency", flip.isError && /how often/.test(flip.text) && ctx.writes.length === 0, flip.text);

  ctx = ctxFor(ONE);
  const del = await call("delete_task", { task: "Coil clean" }, ctx);
  check("delete_task: removes it and writes maintenance_removed", !del.isError && opsOf(ctx)[0]?.op === "task_delete" && opsOf(ctx)[0]?.id === "m2"
    && audits(ctx)[0]?.action === "maintenance_removed" && audits(ctx)[0]?.field === "Coil clean", del.text);

  // Review reads.
  const all = (await call("search_assets", { type: "Computer", include_fields: true })).data;
  check("search with include_fields returns every field and the users", all.assets[0].fields?.["Serial #"] === "SN-777" && all.assets[0].users?.[0] === "Aaron Cantrell");
}

// ---------------------------------------------------------------- sign-in (oauth.js)

{
  let clock = 1_000_000;
  const allowed = new Map([["eric@example.com", [{ id: "dev", name: "Dev" }]]]);
  const signer = await makeSigner("test-secret");
  const oauth = createOAuth({
    base: "https://x.supabase.co/functions/v1/mcp",
    connectUrl: "https://assets.stama.tech/dev/mcp-connect.html",
    signer,
    verifyGoogle: async (t) => (t === "good-google" ? { ok: true, email: "eric@example.com" }
      : t === "stranger" ? { ok: true, email: "nobody@example.com" } : { ok: false, detail: "bad token" }),
    sitesFor: async (e) => allowed.get(e) || [],
    now: () => clock,
  });
  const CB = "https://claude.ai/api/mcp/auth_callback";

  check("Claude's callback is allowed", redirectAllowed(CB));
  check("loopback is allowed", redirectAllowed("http://127.0.0.1:33418/callback"));
  check("an arbitrary https callback is refused", !redirectAllowed("https://evil.example/cb"));
  check("a lookalike host is refused", !redirectAllowed("https://claude.ai.evil.example/api/mcp/auth_callback"));

  const bad = await oauth.register({ redirect_uris: ["https://evil.example/cb"] });
  eq("registering a foreign callback is refused", bad.status, 400);
  const reg = await oauth.register({ redirect_uris: [CB], client_name: "Claude" });
  eq("registration succeeds", reg.status, 201);
  const clientId = reg.body.client_id;

  const verifier = "v".repeat(50);
  const challenge = await sha256b64url(verifier);
  const params = (o) => new URLSearchParams({ client_id: clientId, redirect_uri: CB, response_type: "code",
    code_challenge: challenge, code_challenge_method: "S256", state: "st1", ...o });

  eq("authorize with a forged client is refused", (await oauth.authorize(params({ client_id: clientId + "x" }))).status, 400);
  eq("authorize to an unregistered redirect is refused", (await oauth.authorize(params({ redirect_uri: "http://localhost:1/cb" }))).status, 400);
  eq("authorize without PKCE is refused", (await oauth.authorize(params({ code_challenge_method: "plain" }))).status, 400);
  const az = await oauth.authorize(params());
  check("authorize sends the browser to the connect page", az.status === 302 && az.location.startsWith("https://assets.stama.tech/dev/mcp-connect.html?req="));
  const req = decodeURIComponent(az.location.split("req=")[1]);

  eq("a bad Google token is refused", (await oauth.complete({ req, credential: "nope" })).status, 401);
  const stranger = await oauth.complete({ req, credential: "stranger" });
  check("someone on no allowlist is refused", stranger.status === 403 && /access list/.test(stranger.body.error));
  const done = await oauth.complete({ req, credential: "good-google" });
  check("a listed person gets a code", done.status === 200 && done.body.ok);
  const back = new URL(done.body.redirect);
  check("the code goes back to the registered callback with its state",
    back.origin + back.pathname === CB && back.searchParams.get("state") === "st1");
  const code = back.searchParams.get("code");
  check("the Google token is never handed back", !JSON.stringify(done.body).includes("good-google"));

  const tok = (o) => oauth.token(new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId,
    redirect_uri: CB, code_verifier: verifier, ...o }));
  eq("a wrong PKCE verifier is refused", (await tok({ code_verifier: "w".repeat(50) })).status, 400);
  const other = (await oauth.register({ redirect_uris: [CB] })).body.client_id;
  eq("a code presented by another client is refused", (await tok({ client_id: other })).status, 400);
  const t = await tok();
  check("the code trades for tokens", t.status === 200 && t.body.access_token && t.body.refresh_token);

  eq("the access token names the person", await oauth.bearer(`Bearer ${t.body.access_token}`), "eric@example.com");
  eq("a code is not an access token", await oauth.bearer(`Bearer ${code}`), null);
  eq("a refresh token is not an access token", await oauth.bearer(`Bearer ${t.body.refresh_token}`), null);
  const tampered = t.body.access_token.replace(/^./, (c) => (c === "e" ? "f" : "e"));
  eq("a tampered token is refused", await oauth.bearer(`Bearer ${tampered}`), null);
  const otherSigner = await makeSigner("another-secret");
  eq("a token signed with another key is refused", await oauth.bearer(`Bearer ${await otherSigner.sign({ typ: "access", e: "eric@example.com", exp: clock + 1000 })}`), null);

  clock += 6 * 60 * 1000;
  eq("an expired code is refused", (await tok()).status, 400);
  clock += ACCESS_TTL_MS;
  eq("an expired access token is refused", await oauth.bearer(`Bearer ${t.body.access_token}`), null);

  const refresh = (o) => oauth.token(new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.body.refresh_token, client_id: clientId, ...o }));
  const r = await refresh();
  check("a refresh issues a new access token", r.status === 200 && (await oauth.bearer(`Bearer ${r.body.access_token}`)) === "eric@example.com");
  eq("a refresh by another client is refused", (await refresh({ client_id: other })).status, 400);
  allowed.delete("eric@example.com");
  eq("a refresh after losing every site is refused", (await refresh()).status, 400);
  eq("an unknown grant is refused", (await oauth.token(new URLSearchParams({ grant_type: "password" }))).status, 400);

  const meta = oauth.metadata();
  check("metadata advertises PKCE S256 and registration", meta.code_challenge_methods_supported.includes("S256") && meta.registration_endpoint);
  eq("the resource names its own authorization server", oauth.resourceMetadata().authorization_servers, [meta.issuer]);
}

// ---------------------------------------------------------------- the connect page

{
  const page = fs.readFileSync(path.join(here, "mcp-connect.html"), "utf8");
  check("the connect page pins the connector URL rather than reading it from the link",
    /var CONNECTOR_URL = "https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/mcp";/.test(page) && !/searchParams\.get\("(api|url|connector)"\)/.test(page));
  const appId = /const GOOGLE_CLIENT_ID = "([^"]+)"/.exec(fs.readFileSync(path.join(here, "index.html"), "utf8"))[1];
  check("the connect page uses the app's Google client", page.includes(`"${appId}"`));
}

// ---------------------------------------------------------------- replace_floor_plan

{
  const svg = (spaces) => `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    spaces.map(([id, t]) => `<g id="${id}"><title>${t}</title><path d="M0 0 L10 0 L10 10 Z"/><g><title>Chair</title><rect x="1" y="1" width="1" height="1"/></g></g>`).join("") +
    `<g id="noise"><title>Wall</title><path d="M0 0 L5 5 L9 9 Z"/></g><g id="tiny"><title>Space.99</title><path d="M0 0 L1 1"/></g></svg>`;
  const OLD = svg([["shape-1", "Space.1"], ["g-old-2", "Space.2"], ["shape-9", "Space.9"]]);
  const NEW = svg([["shape-1", "Space.1"], ["shape-2", "Space.2"], ["shape-3", "Space.3"]]);
  const pctx = (sites = ONE, oldText = OLD) => {
    const ctx = ctxFor(sites);
    ctx.fetched = []; ctx.uploads = [];
    ctx.fetchPlan = async (url) => { ctx.fetched.push(url); if (oldText === null) throw new Error("404"); return oldText; };
    ctx.uploadPlan = async (tenant, text, name) => { ctx.uploads.push({ tenant, name, len: text.length }); return { url: "https://res.cloudinary.com/demo/image/upload/new.svg", storageKey: "assets/abc" }; };
    return ctx;
  };

  const { floorPlanSpacesOf } = await import("./supabase/functions/mcp/floorplan.js");
  eq("the SVG reader finds spaces as the app does: own title, real geometry, nested titles ignored",
    floorPlanSpacesOf(NEW), [{ gid: "shape-1", title: "Space.1" }, { gid: "shape-2", title: "Space.2" }, { gid: "shape-3", title: "Space.3" }]);
  eq("a group whose first title is a nested one's is skipped, as the app's querySelector skips it",
    floorPlanSpacesOf(`<svg><g id="x"><g><title>Chair</title><rect/></g><title>Space.5</title><rect/></g></svg>`), []);
  eq("a space with no id is addressed by its title",
    floorPlanSpacesOf(`<svg><g><title>Space.4</title><rect x="0" y="0" width="1" height="1"/></g></svg>`), [{ gid: "Space.4", title: "Space.4" }]);
  for (const bad of ["<svg><g></svg>", "not xml at all <", "<g><title>Space.1</title></g>", "<svg><g></g>"]) {
    let threw = false; try { floorPlanSpacesOf(bad); } catch { threw = true; }
    check(`the SVG reader refuses a broken file: ${bad}`, threw);
  }
  // Every real plan in the project folder, when present, reads the same as in the app (checked in Chromium when written).
  for (const f of ["3c/campus.svg", "bca/building-100.svg"]) {
    const p = path.join("/mnt/project-files/floorplans", f);
    if (fs.existsSync(p)) check(`a real plan reads: ${f}`, floorPlanSpacesOf(fs.readFileSync(p, "utf8")).length > 0);
  }

  let ctx = pctx();
  let r = await call("replace_floor_plan", { asset: "Building 300", svg: NEW, file_name: "b300.svg", dry_run: true }, ctx);
  eq("dry run: carries links by id and by title, a wall segment rides along, the rest is listed",
    [r.isError, r.data?.linksCarriedOver, r.data?.linksDropped?.map((l) => [l.shape, l.linkedTo.id]), r.data?.groupsCarriedOver, r.data?.groupsDropped, r.data?.replaces, r.data?.spacesOnNewPlan],
    [false, 3, [["shape-9", "r101"]], 1, ["Gone"], "old.svg", 3]);
  check("dry run: reads the old plan, uploads and writes nothing",
    ctx.fetched[0] === "https://res.cloudinary.com/demo/raw/upload/old.svg" && ctx.uploads.length === 0 && ctx.writes.length === 0);

  ctx = pctx();
  r = await call("replace_floor_plan", { asset: "b300", svg: NEW, file_name: "b300.svg" }, ctx);
  const wr = ctx.writes[0];
  eq("replace: uploads, then one write with the remapped links and groups",
    [r.isError, ctx.uploads, wr?.op, wr?.args[1], wr?.args[2], wr?.args[3].map((l) => l.shapeId), wr?.args[4].map((g) => g.memberShapeIds)],
    [false, [{ tenant: "dev", name: "b300.svg", len: NEW.length }], "replace_floor_plan", "b300",
      { url: "https://res.cloudinary.com/demo/image/upload/new.svg", storageKey: "assets/abc", fileName: "b300.svg" },
      ["shape-1", "shape-2", "shape-2#e1"], [["shape-1", "shape-2"]]]);
  eq("replace: a carried link keeps who made it", wr?.args[3][0], { shapeId: "shape-1", roomId: "r101b", at: "2026-09-01T00:00:00Z", by: "Eric" });
  eq("replace: sends the revisions it read", wr?.args[0], { assets: 7, config: 3 });

  ctx = pctx(ONE, null);
  r = await call("replace_floor_plan", { asset: "b300", svg: NEW, file_name: "b300.svg", dry_run: true }, ctx);
  check("an unreadable old plan carries only unchanged ids, and says so",
    !r.isError && r.data.linksCarriedOver === 1 && /could not be read/.test(r.data.note), r.text);

  ctx = pctx();
  r = await call("replace_floor_plan", { asset: "Main Campus", svg: NEW, file_name: "campus.svg" }, ctx);
  check("a first plan: nothing to carry, nothing fetched, written", !r.isError && ctx.fetched.length === 0 && ctx.writes.length === 1 && ctx.writes[0].args[3].length === 0, r.text);

  for (const [label, args, sites] of [
    ["a viewer", { site: "bca", asset: "x", svg: NEW, file_name: "a.svg" }, TWO],
    ["an asset that is not a place", { asset: "Teacher PC", svg: NEW, file_name: "a.svg" }],
    ["an archived asset", { asset: "Lab PC", svg: NEW, file_name: "a.svg" }],
    ["a file name that is not .svg", { asset: "b300", svg: NEW, file_name: "plan.pdf" }],
    ["a broken SVG", { asset: "b300", svg: "<svg><g>", file_name: "a.svg" }],
    ["a drawing with no spaces", { asset: "b300", svg: "<svg><g><title>Wall</title><rect/></g></svg>", file_name: "a.svg" }],
    ["an empty SVG", { asset: "b300", svg: " ", file_name: "a.svg" }],
  ]) {
    ctx = pctx(sites);
    r = await call("replace_floor_plan", args, ctx);
    check(`replace_floor_plan refuses ${label}, uploading and writing nothing`, r.isError && ctx.uploads.length === 0 && ctx.writes.length === 0, r.text);
  }
}

// ---------------------------------------------------------------- plan walls

{
  // Two rooms side by side, the second drawn inside a translated group: A's
  // right edge and B's left edge touch, so neither is outside.
  const PLAN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">` +
    `<g id="shapeA"><title>Space.A</title><rect x="0" y="0" width="10" height="10"/></g>` +
    `<g transform="translate(10,0)"><g id="shapeB"><title>Space.B</title><rect x="0" y="0" width="10" height="10"/></g></g></svg>`;
  const URL = "https://res.cloudinary.com/demo/image/upload/b400.svg";
  const dev = SITES.dev;
  dev.assets.push(
    A("b400", 20, "campus", { type: "Building", name: "Building 400", floorPlanUrl: URL, floorPlanFileName: "b400.svg" }),
    A("r401", 21, "b400", { type: "Room", name: "Room 401" }),
    A("r402", 22, "b400", { type: "Room", name: "Room 402" }),
    A("w1", 23, "r401", { type: "Wall", name: "Room 401 north" }),
    A("w2", 24, "r402", { type: "Wall", name: "Room 402 east" }),
    A("w9", 25, "r401", { type: "Wall", name: "Old wall", status: "Archived" }),
  );
  dev.space_links.push(
    { plan_asset_id: "b400", shape_id: "shapeA", position: 0, data: { shapeId: "shapeA", roomId: "r401" } },
    { plan_asset_id: "b400", shape_id: "shapeB", position: 1, data: { shapeId: "shapeB", roomId: "r402" } },
    { plan_asset_id: "b400", shape_id: "shapeA#e0", position: 2, data: { shapeId: "shapeA#e0", roomId: "w1" } },
    { plan_asset_id: "b400", shape_id: "shapeA#e7", position: 3, data: { shapeId: "shapeA#e7", roomId: "w1" } },
    { plan_asset_id: "b400", shape_id: "shapeB#e1", position: 4, data: { shapeId: "shapeB#e1", roomId: "w2" } },
  );
  const wctx = (sites = ONE, plan = PLAN) => {
    const ctx = ctxFor(sites);
    ctx.fetched = [];
    ctx.fetchPlan = async (url) => { ctx.fetched.push(url); if (plan === null) throw new Error("404"); return plan; };
    return ctx;
  };

  const { floorPlanGeometryOf } = await import("./supabase/functions/mcp/floorplan.js");
  eq("plan geometry carries a space through its ancestors' transforms, as the app does",
    floorPlanGeometryOf(PLAN).map((sp) => [sp.gid, sp.pts]),
    [["shapeA", [[0, 0], [10, 0], [10, 10], [0, 10]]], ["shapeB", [[10, 0], [20, 0], [20, 10], [10, 10]]]]);

  let ctx = wctx();
  let r = await call("get_plan_walls", { asset: "Building 400" }, ctx);
  const edges = (sp) => sp.outsideEdges.map((e) => [e.segment, e.facing, e.length, e.wall || null]);
  eq("get_plan_walls: each space's outside edges, facing and owner; touching edges are not outside",
    [r.isError, r.data?.spaces?.map((sp) => [sp.space, sp.linkedTo?.id, edges(sp)])],
    [false, [
      ["Space.A", "r401", [["shapeA#e0", "north", 10, "Room 401 north"], ["shapeA#e2", "south", 10, null], ["shapeA#e3", "west", 10, null]]],
      ["Space.B", "r402", [["shapeB#e0", "north", 10, null], ["shapeB#e1", "east", 10, "Room 402 east"], ["shapeB#e2", "south", 10, null]]],
    ]], r.text);
  eq("get_plan_walls: the walls on the plan, with an edge the drawing no longer has set apart",
    r.data?.walls?.map((w) => [w.wall.id, w.segments, w.notOnThisPlan || null]),
    [["w1", ["shapeA#e0"], ["shapeA#e7"]], ["w2", ["shapeB#e1"], null]]);
  check("get_plan_walls reads the plan from its stored url", ctx.fetched[0] === URL);
  r = await call("get_plan_walls", { asset: "b400", space: "Room 402" }, wctx());
  eq("get_plan_walls narrows to the space a room is linked to", [r.data?.spaces?.map((s) => s.space), r.data?.walls?.map((w) => w.wall.id)], [["Space.B"], ["w2"]]);
  dev.assets.find((a) => a.id === "b400").data.floorPlanRotation = "1";
  r = await call("get_plan_walls", { asset: "b400", space: "Space.A" }, wctx());
  eq("facing follows the plan's rotation in the app (a quarter turn clockwise: up becomes east)",
    r.data?.spaces?.[0]?.outsideEdges.map((e) => e.facing), ["east", "west", "north"]);
  delete dev.assets.find((a) => a.id === "b400").data.floorPlanRotation;

  // set_plan_walls
  ctx = wctx();
  r = await call("set_plan_walls", { asset: "b400", dry_run: true, walls: [
    { name: "Room 401 West", space: "Room 401", facing: "west" },
    { wall: "Room 401 north", segments: ["shapeA#e0", "shapeB#e0"] },
  ] }, ctx);
  eq("dry run: a new wall from a space and a facing, parented to the room the space is linked to; an existing wall's edges replaced",
    [r.isError, r.data?.walls?.map((w) => [w.wall, w.new || false, w.segments.map((s) => s.split(" ")[0]), w.replaces || null])],
    [false, [["Room 401 West", true, ["shapeA#e3"], null], ["Room 401 north", false, ["shapeA#e0", "shapeB#e0"], ["shapeA#e0", "shapeA#e7"]]]], r.text);
  check("dry run writes nothing", ctx.writes.length === 0);

  ctx = wctx();
  r = await call("set_plan_walls", { asset: "b400", walls: [
    { name: "Room 401 West", space: "Space.A", facing: "west" },
    { wall: "w1", segments: ["shapeA#e0", "shapeB#e0"] },
  ] }, ctx);
  const wr = ctx.writes[0];
  const created = wr?.args[2].find((o) => o.op === "asset_create");
  eq("set: one write, carrying the revisions, the plan, the new Wall, its audit rows and each wall's edges",
    [r.isError, ctx.writes.length, wr?.op, wr?.args[0], wr?.args[1], created?.data.type, created?.data.name, created?.data.parentId,
      wr?.args[2].filter((o) => o.op === "audit").map((o) => [o.data.assetLabel === created?.id ? "new" : o.data.assetLabel, o.data.action, o.data.field || null, o.data.to || null]),
      wr?.args[3].map((w) => [w.wallId === created?.id ? "new" : w.wallId, w.segmentIds]), wr?.args[4]],
    [false, 1, "set_plan_walls", { assets: 7, config: 3 }, "b400", "Wall", "Room 401 West", "r401",
      [["new", "created", null, null], ["b400", "space_linked", "1 wall segment", "Room 401 West"], ["b400", "space_linked", "2 wall segments", "Room 401 north"]],
      [["new", ["shapeA#e3"]], ["w1", ["shapeA#e0", "shapeB#e0"]]], []], r.text);

  ctx = wctx();
  r = await call("set_plan_walls", { asset: "b400", walls: [{ name: "B East", segments: ["shapeB#e1"] }], remove: ["Room 402 east"] }, ctx);
  eq("an edge moves to a new wall when its old wall is taken off in the same change",
    [r.isError, ctx.writes[0]?.args[4], ctx.writes[0]?.args[2].filter((o) => o.op === "audit").map((o) => o.data.action), r.data?.removed],
    [false, ["w2"], ["created", "space_linked", "space_unlinked"], ["Room 402 east"]], r.text);

  ctx = wctx();
  r = await call("set_plan_walls", { asset: "b400", auto: ["Room 401"], remove: ["w1"], dry_run: true }, ctx);
  eq("auto: one new wall per direction the space's outside edges face, named after what it is linked to",
    [r.isError, r.data?.walls?.map((w) => [w.wall, w.new, w.segments.map((x) => x.split(" ")[0])]), ctx.writes.length],
    [false, [["Room 401 North Wall", true, ["shapeA#e0"]], ["Room 401 South Wall", true, ["shapeA#e2"]], ["Room 401 West Wall", true, ["shapeA#e3"]]], 0], r.text);
  check("auto still refuses an edge another wall owns (Room 401's north edge is on Room 401 north)",
    (await call("set_plan_walls", { asset: "b400", auto: ["Room 401"] }, wctx())).isError);
  ctx = wctx();
  r = await call("set_plan_walls", { asset: "b400", auto: ["Room 401"], remove: ["w1"] }, ctx);
  eq("auto with the old wall removed writes three new walls in one call",
    [r.isError, ctx.writes[0]?.args[2].filter((o) => o.op === "asset_create").map((o) => [o.data.name, o.data.parentId])],
    [false, [["Room 401 North Wall", "r401"], ["Room 401 South Wall", "r401"], ["Room 401 West Wall", "r401"]]], r.text);

  ctx = wctx();
  r = await call("set_plan_walls", { asset: "b400", walls: [{ wall: "w2", segments: ["shapeB#e1"] }] }, ctx);
  check("a wall that already has exactly those edges writes nothing", !r.isError && ctx.writes.length === 0 && /Nothing to change/.test(r.data.note), r.text);
  ctx = wctx();
  r = await call("set_plan_walls", { asset: "b400", walls: [{ wall: "w2", name: "Room 402 East Wall", space: "Room 402", facing: "east" }] }, ctx);
  eq("wall plus name renames it through the app's import rules",
    [r.isError, ctx.writes[0]?.args[2].filter((o) => o.op === "asset_update").map((o) => [o.id, o.data.name])], [false, [["w2", "Room 402 East Wall"]]], r.text);

  for (const [label, args, sites, plan] of [
    ["an edge on a wall not in this change", { asset: "b400", walls: [{ name: "X", segments: ["shapeB#e1"] }] }],
    ["an edge that is not outside", { asset: "b400", walls: [{ name: "X", segments: ["shapeA#e1"] }] }],
    ["an edge given to two walls", { asset: "b400", walls: [{ name: "X", segments: ["shapeA#e2"] }, { name: "Y", segments: ["shapeA#e2"] }] }],
    ["a facing the space has no edge on", { asset: "b400", walls: [{ name: "X", space: "Room 402", facing: "west" }] }],
    ["segments and a space together", { asset: "b400", walls: [{ name: "X", space: "Room 402", segments: ["shapeB#e0"] }] }],
    ["a wall that is not a Wall", { asset: "b400", walls: [{ wall: "Room 401", segments: ["shapeA#e2"] }] }],
    ["an archived wall", { asset: "b400", walls: [{ wall: "Old wall", segments: ["shapeA#e2"] }] }],
    ["a wall named twice", { asset: "b400", walls: [{ wall: "w1", segments: ["shapeA#e2"] }, { wall: "w1", segments: ["shapeA#e3"] }] }],
    ["a wall with neither a wall nor a name", { asset: "b400", walls: [{ segments: ["shapeA#e2"] }] }],
    ["a space that is not on the plan", { asset: "b400", walls: [{ name: "X", space: "Space.Z" }] }],
    ["nothing to do", { asset: "b400" }],
    ["a place with no plan", { asset: "Building 200", walls: [{ name: "X", segments: ["shapeA#e2"] }] }],
    ["a viewer", { site: "bca", asset: "x", walls: [{ name: "X", segments: ["a#e0"] }] }, TWO],
    ["a plan the file host will not serve", { asset: "b400", walls: [{ name: "X", segments: ["shapeA#e2"] }] }, ONE, null],
  ]) {
    ctx = wctx(sites, plan);
    r = await call("set_plan_walls", args, ctx);
    check(`set_plan_walls refuses ${label}, writing nothing`, r.isError && ctx.writes.length === 0, r.text);
  }

  // A plan that is not a building's own (a campus): only a space linked into a
  // building closes off an edge, so a building beside an unlinked courtyard
  // still has its outside wall there -- the app's floorPlanWallCoverSet.
  dev.assets.find((a) => a.id === "campus").data.floorPlanUrl = URL;
  dev.space_links.push(
    { plan_asset_id: "campus", shape_id: "shapeA", position: 0, data: { shapeId: "shapeA", roomId: "b400" } },
  );
  r = await call("get_plan_walls", { asset: "campus", space: "Space.A" }, wctx());
  eq("get_plan_walls on a campus plan: an unlinked neighbour does not close off a building's edge",
    r.data?.spaces?.[0]?.outsideEdges?.map((e) => e.segment), ["shapeA#e0", "shapeA#e1", "shapeA#e2", "shapeA#e3"], r.text);
  dev.space_links.push(
    { plan_asset_id: "campus", shape_id: "shapeB", position: 1, data: { shapeId: "shapeB", roomId: "r402" } },
  );
  r = await call("get_plan_walls", { asset: "campus", space: "Space.A" }, wctx());
  eq("get_plan_walls on a campus plan: a neighbour linked inside a building does",
    r.data?.spaces?.[0]?.outsideEdges?.map((e) => e.segment), ["shapeA#e0", "shapeA#e2", "shapeA#e3"], r.text);
  dev.space_links = dev.space_links.filter((l) => l.plan_asset_id !== "campus");
  delete dev.assets.find((a) => a.id === "campus").data.floorPlanUrl;

  // The real plans in the project folder, when present.
  const { rotatedSpaces, exteriorWalls } = await import("./supabase/functions/mcp/walls.js");
  for (const f of ["bca/building-100.svg", "bca/campus.svg"]) {
    const p = path.join("/mnt/project-files/floorplans", f);
    if (!fs.existsSync(p)) continue;
    const e = exteriorWalls(rotatedSpaces(floorPlanGeometryOf(fs.readFileSync(p, "utf8")), 0));
    check(`a real plan has outside walls facing all four ways: ${f}`, ["north", "east", "south", "west"].every((d) => e.some((x) => x.facing === d)));
  }
}

// ---------------------------------------------------------------- reference fields and relationship queries

{
  // A site of its own, so the counts the tests above rely on stay put. A
  // Thermostat's Controls field points at a Mini Split; a Mount's Holds field
  // points at a TV OR a Monitor (referenceTypes); a Room has an "HVAC" query:
  // the units in the room, then what controls each one.
  SITES.rel = {
    assets: [
      A("bld", 0, null, { type: "Building", name: "Building 1" }),
      A("rm", 1, "bld", { type: "Room", name: "Room 1" }),
      A("rm2", 2, "bld", { type: "Room", name: "Room 2" }),
      A("msA", 3, "rm", { type: "uuid-ms", name: "Unit A" }),
      A("msB", 4, "rm", { type: "uuid-ms", name: "Unit B" }),
      A("msC", 5, "rm2", { type: "uuid-ms", name: "Unit C" }),
      A("msOld", 6, "rm2", { type: "uuid-ms", name: "Old unit", status: "Archived" }),
      A("tA", 7, "rm", { type: "uuid-th", name: "Thermostat A", controls: "msA" }),
      A("tB", 8, "rm", { type: "uuid-th", name: "Thermostat B", controls: "msB" }),
      A("tv1", 9, "rm", { type: "TV", name: "Lobby TV" }),
      A("mon1", 10, "rm", { type: "Monitor", name: "Desk Monitor" }),
      A("mount1", 11, "rm", { type: "uuid-mount", name: "Wall mount" }),
    ],
    config: [
      { key: "typesList", value: ["Building", "Room", "TV", "Monitor", { id: "uuid-ms", name: "Mini Split" }, { id: "uuid-th", name: "Thermostat" }, { id: "uuid-mount", name: "Mount" }] },
      { key: "columns", value: [
        { key: "controls", label: "Controls", custom: true, restricted: true, dataType: "reference", referenceType: "uuid-ms" },
        { key: "holds", label: "Holds", custom: true, restricted: true, dataType: "reference", referenceTypes: ["TV", "Monitor"], referenceType: "TV" },
      ] },
      { key: "typeSettings", value: {
        "uuid-th": { onlyFields: ["controls"], parentTypes: ["Room"] },
        "uuid-mount": { onlyFields: ["holds"], parentTypes: ["Room"] },
        Room: { relationshipQueries: [
          { id: "q1", name: "HVAC", steps: [
            { follow: "descendants", typeIds: ["uuid-ms"], show: true },
            { follow: "refIn", fieldKey: "controls", typeIds: [], show: true },
          ] },
          { id: "q2", name: "Empty one", hideWhenEmpty: true, steps: [{ follow: "children", typeIds: ["Building"], show: true }] },
        ] },
      } },
    ],
    revisions: [{ domain: "assets", rev: 1 }, { domain: "config", rev: 1 }],
  };
  const REL = [{ id: "rel", name: "Relationships", role: "editor" }];
  const rc = () => ctxFor(REL);

  // Schema.
  const sc = (await call("get_schema", {}, rc())).data;
  const f = (n) => sc.fields.find((x) => x.field === n);
  eq("schema: a Reference field says what it points at (old single referenceType)", f("Controls")?.pointsAt, ["Mini Split"]);
  eq("schema: a Reference field allowed several types lists them all", f("Holds")?.pointsAt, ["TV", "Monitor"]);
  check("schema: a field that is not a Reference carries no pointsAt", sc.fields.every((x) => x.field === "Controls" || x.field === "Holds" || x.pointsAt === undefined));
  const room = sc.types.find((t) => t.name === "Room");
  eq("schema: a place lists the built-in Contents query first, then its own",
    room.relationshipQueries?.map((q) => q.name), ["Contents", "HVAC", "Empty one"]);
  eq("schema: a query's steps are worded for reading, with the field and types named",
    room.relationshipQueries?.[1]?.steps, [{ follow: "Anywhere inside it", types: ["Mini Split"] }, { follow: "What points to it through a field", field: "Controls" }]);
  check("schema: a type with no queries says nothing about them", sc.types.find((t) => t.name === "Thermostat").relationshipQueries === undefined);

  // get_relationships.
  let r = await call("get_relationships", { asset: "Room 1", query: "HVAC" }, rc());
  eq("get_relationships: units in the room, each with what controls it, as a tree",
    r.data?.queries?.[0]?.results?.map((n) => [n.name, (n.children || []).map((c) => c.name)]),
    [["Unit A", ["Thermostat A"]], ["Unit B", ["Thermostat B"]]]);
  eq("get_relationships: counts every asset the tree shows", r.data?.queries?.[0]?.count, 4);
  r = await call("get_relationships", { asset: "Room 1" }, rc());
  eq("get_relationships: every query, and one that is empty and marked hide-when-empty is left out",
    r.data?.queries?.map((q) => q.name), ["Contents", "HVAC"]);
  r = await call("get_relationships", { asset: "Room 2", query: "HVAC" }, rc());
  eq("get_relationships: an archived unit is not a result", r.data?.queries?.[0]?.results?.map((n) => n.name), ["Unit C"]);
  r = await call("get_relationships", { asset: "Room 1", query: "Plumbing" }, rc());
  check("get_relationships: an unknown query names the ones there are", r.isError && /HVAC/.test(r.text), r.text);
  r = await call("get_relationships", { asset: "Thermostat A" }, rc());
  check("get_relationships: a type with no queries says so", !r.isError && r.data.queries.length === 0 && /no relationship queries/.test(r.data.note), r.text);

  // search_assets following a Reference in reverse.
  r = await call("search_assets", { points_to: "Unit A" }, rc());
  eq("search_assets points_to: what points at an asset through any Reference", r.data?.assets?.map((a) => a.name), ["Thermostat A"]);
  r = await call("search_assets", { points_to: "Unit B", through_field: "controls" }, rc());
  eq("search_assets points_to + through_field (by key)", r.data?.assets?.map((a) => a.name), ["Thermostat B"]);
  r = await call("search_assets", { points_to: "Unit B", through_field: "Holds" }, rc());
  eq("search_assets: a different field finds nothing", r.data?.total, 0);
  r = await call("search_assets", { points_to: "Unit B", through_field: "Serial" }, rc());
  check("search_assets: a field that is not a Reference is refused, naming the ones there are", r.isError && /Controls, Holds/.test(r.text), r.text);
  r = await call("search_assets", { through_field: "Controls" }, rc());
  check("search_assets: through_field alone is refused", r.isError);

  // get_asset names the asset a Reference field holds.
  r = await call("get_asset", { asset: "Thermostat A" }, rc());
  eq("get_asset: a Reference field shows the asset's name and id", r.data?.fields?.Controls, "Unit A (msA)");

  // save_assets: a Reference must name ONE asset of a type it points at.
  let ctx = rc();
  r = await call("save_assets", { rows: [{ asset: "tA", fields: { Controls: "Unit C" } }] }, ctx);
  const op = ctx.writes.flatMap((w) => w.args[1]).find((o) => o.op === "asset_update");
  check("save_assets: a Reference given by name is stored as the asset's id", !r.isError && op?.data?.controls === "msC", r.text);
  ctx = rc();
  r = await call("save_assets", { rows: [{ asset: "mount1", fields: { Holds: "Desk Monitor" } }] }, ctx);
  check("save_assets: a field allowed several types accepts any of them", !r.isError && ctx.writes.length === 1, r.text);
  ctx = rc();
  r = await call("save_assets", { rows: [{ asset: "mount1", fields: { Holds: "tv1" } }] }, ctx);
  check("save_assets: ... by id too", !r.isError && ctx.writes.length === 1, r.text);
  for (const [why, fields, re] of [
    ["the wrong type", { Holds: "Unit A" }, /must be a TV or Monitor; Unit A is a Mini Split/],
    ["an archived asset", { Controls: "msOld" }, /archived/],
    ["nothing that matches", { Controls: "Unit Z" }, /no Mini Split matches/],
  ]) {
    ctx = rc();
    const asset = "Holds" in fields ? "mount1" : "tB";
    r = await call("save_assets", { rows: [{ asset, fields }] }, ctx);
    check(`save_assets: a Reference naming ${why} is refused and nothing is written`, r.isError && re.test(JSON.stringify(r.data ?? r.text)) && ctx.writes.length === 0, r.text);
  }
  SITES.rel.assets.push(A("msA2", 12, "rm2", { type: "uuid-ms", name: "Unit A" }));
  ctx = rc();
  r = await call("save_assets", { rows: [{ asset: "tB", fields: { Controls: "Unit A" } }] }, ctx);
  check("save_assets: a name two assets share is refused, listing their ids", r.isError && /msA, msA2/.test(JSON.stringify(r.data ?? r.text)) && ctx.writes.length === 0, r.text);
  SITES.rel.assets.pop();
  ctx = rc();
  r = await call("save_assets", { rows: [{ asset: "tB", fields: { Controls: "" } }] }, ctx);
  check("save_assets: a blank Reference clears it", !r.isError && ctx.writes.flatMap((w) => w.args[1]).find((o) => o.op === "asset_update")?.data?.controls === "", r.text);
  delete SITES.rel;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
