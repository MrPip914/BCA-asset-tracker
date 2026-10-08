// Guards the Claude connector (supabase/functions/mcp/): the MCP protocol
// handling, every read tool, site access, and that the task and panel rules it
// reports are the app's own.
//
// Drives the real modules with fixture rows shaped like the Phase 1 tables, so
// it needs no Deno and no database. index.ts (HTTP + SQL) is not covered here.
//
// Run: node test-mcp-connector.mjs   (exits non-zero on failure)
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { handleMcp, PROTOCOL_VERSIONS } from "./supabase/functions/mcp/protocol.js";
import { TOOLS, roleFor } from "./supabase/functions/mcp/tools.js";

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
    ...["TASK_KIND_SCHEDULED", "TASK_KIND_ONEOFF", "RECURRENCE_MAX_EVERY"].map(line),
    ...["RECURRENCE_UNITS", "RECURRENCE_ORDINALS"].map(arr),
    ...["recurrenceCount", "parseRecurrence", "addCalendarMonths", "nthWeekdayOfMonth", "nextRecurrenceDate",
      "dateOnly", "taskKindOf", "isOneOffTask", "taskIsDone", "taskDueDate", "maintenanceStatusOf", "cellsLabel_"].map(fn),
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
      A("b300", 2, "campus", { type: "Building", name: "Building 300" }),
      A("r101", 3, "b200", { type: "Room", name: "Room 101" }),
      A("r101b", 4, "b300", { type: "Room", name: "Room 101" }),
      A("closet", 5, "r101", { type: "Room", name: "Storage Closet" }),
      A("pc1", 6, "closet", { type: "Computer", tag: "BCA0042", name: "Teacher PC", serial: "SN-777", brand: "Dell", personIds: ["u1"], purchaseDate: "2024-08-01T07:00:00.000Z" }),
      A("pc2", 7, "r101b", { type: "Computer", tag: "BCA0043", name: "Lab PC", status: "Archived" }),
      A("u1", 8, null, { type: "User", firstName: "Aaron", lastName: "Cantrell", name: "old name" }),
      A("panelA", 9, "b200", { type: "Electrical Panel", tag: "BCA0082", panelSlotCount: 24, panelPhases: "1" }),
      A("ms1", 10, "r101", { type: "uuid-ms", name: "Mini Split 1" }),
    ],
    config: [
      { key: "typesList", value: ["Campus", "Building", "Room", "Computer", "User", "Electrical Panel", { id: "uuid-ms", name: "Mini Split" }] },
      { key: "columns", value: [{ key: "serial", label: "Serial #" }, { key: "purchaseDate", label: "Purchased" }] },
    ],
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
  check("every tool is marked read-only and not destructive",
    tools.every((t) => t.annotations.readOnlyHint === true && t.annotations.destructiveHint === false));
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
