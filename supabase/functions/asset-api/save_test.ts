// The save, against a throwaway Postgres (see api_test.ts for how to run it).
//
// PARITY is the check that matters: the same body is saved through this API
// AND through AssetTrackerSync.gs's own doPost (against a fake Sheet,
// db/sheet-snapshot.mjs's saveThroughSheet), and the inventory each reads back
// afterwards must be the same. So a field the Sheet drops is dropped here, a
// blank reads back the way it always has, and the app cannot tell which backend
// it saved through. Then the rules a save enforces, one test each.

import postgres from "npm:postgres@3.4.5";
import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { saveThroughSheet, snapshotFromGrids } from "../../../db/sheet-snapshot.mjs";
import { snapshotToRows } from "../../../db/snapshot-rows.mjs";
import { loadSql, TABLE_COLUMNS } from "../../../db/load-sql.mjs";
import { grids as fixtureGrids } from "../../../db/fixture-grids.mjs";
import { createApi } from "./api.ts";
import { ASSET_FIELDS, AUDIT_FIELDS } from "./save-shape.ts";
import { SYNC_TABLES } from "./save.ts";

const DATABASE_URL = Deno.env.get("DATABASE_URL");
const gas = await Deno.readTextFile(new URL("../../../AssetTrackerSync.gs", import.meta.url));
// deno-lint-ignore no-explicit-any
type Any = any;

// A `const NAME = [ ... ];` list out of the .gs, evaluated as the array it is.
const gasList = (name: string) => {
  const start = gas.indexOf(`const ${name} = [`);
  const end = gas.indexOf("];", start);
  return new Function(`return ${gas.slice(start + `const ${name} = `.length, end + 1)}`)();
};

Deno.test("the shaping copies of the .gs field lists are the .gs lists", () => {
  assertEquals(ASSET_FIELDS, gasList("ASSET_FIELDS"));
  assertEquals(AUDIT_FIELDS, gasList("AUDIT_FIELDS"));
});

Deno.test("every table a save rewrites has the importer's columns", () => {
  for (const [table, { cols, key }] of Object.entries(SYNC_TABLES)) {
    assertEquals(cols, (TABLE_COLUMNS as Any)[table], table);
    for (const k of key) assert(k in cols, `${table} key ${k}`);
  }
});

const OWNER = "mrpip914@gmail.com";
const verifyIdToken = (token: unknown) => {
  const [kind, email] = String(token).split(":");
  return Promise.resolve(kind === "good" ? { ok: true as const, email, name: "" } : { ok: false as const, detail: "no" });
};

if (!DATABASE_URL) {
  Deno.test({ name: "save checks (DATABASE_URL not set)", ignore: true, fn() {} });
} else {
  const sql = postgres(DATABASE_URL, { prepare: false, max: 4, onnotice: () => {} });
  const api = createApi({ sql, verifyIdToken, lockTimeoutMs: 300 });
  const TENANT = "save_test";
  const USERS = [
    { email: "jane@school.test", name: "Jane", role: "viewer" },
    { email: "sam@school.test", name: "Sam", role: "editor" },
  ];

  // Both backends start from the fixture Sheet. `sheet` is the Sheet side's
  // state and moves with every save posted to it.
  let sheet: Any;
  const reset = async () => {
    sheet = structuredClone(fixtureGrids);
    const snap = snapshotFromGrids(gas, sheet);
    const { tables } = snapshotToRows(TENANT, { ...snap, authUsers: USERS });
    await sql`delete from asset_tracker.sessions where tenant_id = ${TENANT}`;
    await sql`delete from asset_tracker.diagnostics where tenant_id = ${TENANT}`;
    await sql.begin((tx: Any) => tx.unsafe(loadSql({ id: TENANT, name: TENANT, ownerEmail: OWNER, cloudinaryFolder: null }, tables)).simple());
  };

  const post = async (body: unknown) => {
    const res = await api(new Request(`https://api.test/asset-api?tenant=${TENANT}`, { method: "POST", body: JSON.stringify(body) }));
    return await res.json();
  };
  const signIn = async (email = OWNER) => (await post({ op: "signin", idToken: `good:${email}` })).auth.sessionId as string;
  // What the client holds after a read: the payload, plus the offset of its
  // audit slice, as index.html keeps it beside the log (auditBase).
  const read = async (sessionId: string) => {
    const r = await post({ op: "read", sessionId });
    if (r.auditLog) r.auditBase = r.auditTotal - r.auditLog.length;
    return r;
  };
  const diag = async (): Promise<Any[]> => await sql`select event, reason, detail from asset_tracker.diagnostics where tenant_id = ${TENANT} order by seq`;

  // A read, minus what is not the inventory, with the import's one deliberate
  // difference undone: a blank work-entry id was minted at import.
  const comparable = (p: Any) => {
    const out = structuredClone(p);
    delete out.auth;
    delete out.scriptVersion;
    delete out.auditBase;
    for (const a of out.assets) delete a._rev; // a database version; the Sheet has none
    for (const a of out.assets) for (const c of a.changes) if (String(c.id).startsWith("imp-")) c.id = "";
    return out;
  };
  // The Sheet's read, with the import's other deliberate difference applied: a
  // duplicate asset id keeps only its first row. (The fixture has one, and it
  // stays on the Sheet until a save rewrites the Assets tab.)
  const sheetRead = () => {
    const p = comparable(snapshotFromGrids(gas, sheet, { fullAudit: false }).payload);
    const seen = new Set();
    p.assets = p.assets.filter((a: Any) => !seen.has(a.id || a.label) && seen.add(a.id || a.label));
    return p;
  };

  // What a client holding `p` posts: the whole snapshot, as persist() sends it.
  const bodyFrom = (p: Any, sessionId: string, extra: Any = {}) => ({
    sessionId,
    assets: p.assets, breakerTypes: p.breakerTypes, photos: p.photos,
    columns: p.columns, changeTypes: p.changeTypes, vendors: p.vendors, peripheralsList: p.peripheralsList,
    usersList: p.usersList, bulkItemTypes: p.bulkItemTypes, typesList: p.typesList,
    typeSettings: p.typeSettings, typeCategories: p.typeCategories, nextAssetNumber: p.nextAssetNumber,
    auditLog: p.auditLog, auditBase: p.auditBase,
    _revisions: p.revisions,
    _dirty: { assets: true, config: true, breakerTypes: true, photos: true },
    ...extra,
  });

  // The same body, saved through both. Both answers and both reads must agree.
  const saveBoth = async (body: Any) => {
    const viaSheet = saveThroughSheet(gas, sheet, body);
    sheet = viaSheet.grids;
    const viaApi = await post(body);
    assertEquals(viaApi, viaSheet.response);
    return viaApi;
  };
  const assertSameRead = async (sessionId: string) => assertEquals(comparable(await read(sessionId)), sheetRead());

  Deno.test("a whole snapshot posted back unchanged reads back the same, and rewrites no row", async () => {
    await reset();
    const sid = await signIn();
    // The first save widens every asset to the full column list, exactly as the
    // Sheet's rewrite of the tab does. From then on, unchanged is unchanged.
    assertEquals((await saveBoth(bodyFrom(await read(sid), sid))).ok, true);
    await assertSameRead(sid);
    const before = await read(sid);
    const xmin = async () => (await sql`select string_agg(xmin::text, ',' order by id) as x from asset_tracker.assets where tenant_id = ${TENANT}`)[0].x;
    const childXmin = async () => (await sql`select string_agg(xmin::text, ',' order by id) as x from asset_tracker.circuits where tenant_id = ${TENANT}`)[0].x;
    const [a0, c0] = [await xmin(), await childXmin()];
    const r = await saveBoth(bodyFrom(before, sid));
    assertEquals(r.ok, true);
    await assertSameRead(sid);
    assertEquals([await xmin(), await childXmin()], [a0, c0]);
  });

  Deno.test("an edit across every table reads back as the Sheet reads it back", async () => {
    await reset();
    const sid = await signIn();
    const p = await read(sid);
    const pc = p.assets.find((a: Any) => a.id === "pc-uuid");
    const panel = p.assets.find((a: Any) => a.id === "panel-uuid");
    pc.name = "Front desk PC (renamed)";
    pc.junkField = "not a column, so dropped";
    pc.personIds = ["u2"];
    pc.comments.push({ text: "Replaced fan", at: "2026-10-09", by: OWNER });
    pc.changes[0].cost = 55;
    pc.maintenanceItems[0].lastPerformed = "2026-10-01";
    pc.maintenanceItems.push({ id: "m-2", kind: "oneoff", task: "Replace PSU", dueDate: "2026-11-01", at: "2026-10-09", by: OWNER });
    // The breaker goes; its circuit is moved to the unassigned list.
    const [breaker] = panel.breakers;
    panel.unassignedCircuits.push(...breaker.circuits.map((c: Any) => ({ ...c, breakerId: "" })));
    panel.breakers = [{ id: "b-2", cells: ["5a", "5b"], ampRating: 30, circuits: [{ id: "c-3", label: "Dryer", roomsServedIds: ["room-uuid"] }] }];
    // A new asset with children, and an existing one removed.
    p.assets.push({ id: "new-uuid", type: "Monitor", name: "New monitor", parentId: "room-uuid", comments: [{ text: "boxed", at: "x" }] });
    p.assets = p.assets.filter((a: Any) => a.id !== "BCA0001");
    p.breakerTypes[0].name = "Single-Pole (edited)";
    p.photos.push({ id: "p-3", ownerType: "asset", ownerId: "new-uuid", url: "https://x/3.jpg", width: 0, hiddenFromPublic: false });
    p.vendors = ["Acme"];
    p.nextAssetNumber = 2; // lower than stored: must not walk the counter back
    const entry = { assetLabel: "pc-uuid", assetType: "Computer", action: "edited", field: "name", from: "a", to: "b", at: "2026-10-09", by: OWNER };
    p.auditLog.push(entry);

    const r = await saveBoth(bodyFrom(p, sid));
    assertEquals(r.ok, true);
    await assertSameRead(sid);
    const after = await read(sid);
    assertEquals(after.auditTotal, p.auditTotal + 1);
    assertEquals(after.nextAssetNumber, 5);
    assertEquals(after.assets.find((a: Any) => a.id === "pc-uuid").junkField, undefined);
  });

  Deno.test("a custom column's values are kept, from the posted list or the stored one", async () => {
    await reset();
    const sid = await signIn();
    const p = await read(sid);
    p.columns = [{ key: "roomColor", label: "Colour", custom: true }, { key: "serial", custom: true }];
    p.assets[0].roomColor = "teal";
    await saveBoth(bodyFrom(p, sid));
    await assertSameRead(sid);
    // An asset-only save from a client that sent no column list keeps it too.
    const q = await read(sid);
    q.assets[0].roomColor = "navy";
    const body = bodyFrom(q, sid, { _dirty: { assets: true, config: false, breakerTypes: false, photos: false } });
    delete body.columns;
    await saveBoth(body);
    await assertSameRead(sid);
    assertEquals((await read(sid)).assets[0].roomColor, "navy");
  });

  Deno.test("audit rows append from the client's offset, and a repeated save appends nothing", async () => {
    await reset();
    const sid = await signIn();
    const p = await read(sid);
    p.auditLog.push({ assetLabel: "pc-uuid", action: "edited", at: "2026-10-09", by: OWNER });
    const body = bodyFrom(p, sid, { _dirty: { assets: false, config: false, breakerTypes: false, photos: false } });
    await saveBoth(body);
    await saveBoth(body); // the same request again, e.g. a retry whose reply was lost
    await assertSameRead(sid);
    assertEquals((await read(sid)).auditTotal, p.auditTotal + 1);
  });

  Deno.test("only the domains written are bumped", async () => {
    await reset();
    const sid = await signIn();
    const p = await read(sid);
    const r = await saveBoth(bodyFrom(p, sid, { _dirty: { assets: false, config: true, breakerTypes: false, photos: false } }));
    assertEquals(r.revisions, { ...p.revisions, config: p.revisions.config + 1 });
  });

  Deno.test("no _dirty at all rewrites everything, as an older client expects", async () => {
    await reset();
    const sid = await signIn();
    const p = await read(sid);
    const body = bodyFrom(p, sid);
    delete body._dirty;
    const r = await saveBoth(body);
    assertEquals(r.revisions, Object.fromEntries(Object.entries(p.revisions).map(([d, n]) => [d, Number(n) + 1])));
  });

  Deno.test("a stale revision is a conflict, and NOTHING is written -- not even the audit rows", async () => {
    await reset();
    const sid = await signIn();
    const p = await read(sid);
    const baseline = comparable(p);
    p.assets[0].name = "should not land";
    p.auditLog.push({ assetLabel: "x", action: "edited", at: "now", by: OWNER });
    const r = await post(bodyFrom(p, sid, { _revisions: { ...p.revisions, assets: p.revisions.assets - 1 } }));
    assertEquals([r.ok, r.conflict, r.revisions], [false, ["assets"], p.revisions]);
    assertEquals(comparable(await read(sid)), baseline);
    const last = (await diag()).at(-1);
    assertEquals(last.event, "conflict");
    assertMatch(last.detail, /assets posted \d+, stored \d+/);
  });

  Deno.test("a viewer's save is refused as view-only; a bad session as signed out", async () => {
    await reset();
    const p = await read(await signIn());
    const viewer = await signIn("jane@school.test");
    const r = await post(bodyFrom(p, viewer));
    assertEquals([r.ok, r.authFailed, r.reason], [false, true, "readonly"]);
    assertMatch(r.error, /view-only/);
    const bad = await post(bodyFrom(p, "0".repeat(64)));
    assertEquals([bad.authFailed, bad.reason], [true, "signin"]);
    assertEquals((await read(await signIn())).revisions, p.revisions);
  });

  Deno.test("emptying a populated inventory in one save is refused unless it is confirmed", async () => {
    await reset();
    const sid = await signIn();
    const p = await read(sid);
    const r = await post(bodyFrom(p, sid, { assets: [] }));
    assertEquals([r.ok, r.refused, r.existingRows], [false, "emptyAssets", 4]);
    const ph = await post(bodyFrom(p, sid, { photos: [] }));
    assertEquals([ph.refused, ph.existingRows], ["emptyPhotos", 2]);
    assertEquals((await read(sid)).assets.length, 4);
    const ok = await saveBoth(bodyFrom(p, sid, { assets: [], confirmEmptyAssets: true }));
    assertEquals(ok.ok, true);
    assertEquals((await read(sid)).assets.length, 0);
  });

  Deno.test("an allowlist in a config save replaces the list and ends a removed person's sessions", async () => {
    await reset();
    const sid = await signIn();
    const sam = await signIn("sam@school.test");
    const p = await read(sid);
    // Absent: left alone.
    await post(bodyFrom(p, sid, { _dirty: { assets: false, config: true, breakerTypes: false, photos: false } }));
    assertEquals((await read(sid)).auth.users.map((u: Any) => u.email), [OWNER, "jane@school.test", "sam@school.test"]);
    const q = await read(sid);
    const r = await post(bodyFrom(q, sid, {
      _dirty: { assets: false, config: true, breakerTypes: false, photos: false },
      authUsers: [{ email: "Jane@School.test", name: "Jane", role: "editor" }],
    }));
    assertEquals(r.ok, true);
    const after = await read(sid);
    assertEquals(after.auth.users, [
      { email: OWNER, name: "Owner", role: "editor" },
      { email: "jane@school.test", name: "Jane", role: "editor" },
    ]);
    assertEquals((await sql`select 1 from asset_tracker.sessions where id = ${sam}`).length, 0);
  });

  Deno.test("a save queued behind another past the lock timeout is answered busy", async () => {
    await reset();
    const sid = await signIn();
    const p = await read(sid);
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => { locked = r; });
    const holder = sql.begin(async (tx: Any) => {
      await tx`select 1 from asset_tracker.revisions where tenant_id = ${TENANT} for update`;
      locked();
      await held;
    });
    await isLocked;
    try {
      // Nothing dirty and no new audit rows: only the lock itself can make
      // this wait, as only the script lock could on the Sheet.
      const r = await post(bodyFrom(p, sid, { _dirty: { assets: false, config: false, breakerTypes: false, photos: false } }));
      assertEquals([r.ok, r.busy], [false, true]);
      assertMatch(r.error, /busy.*Nothing was changed/);
    } finally {
      release();
      await holder;
    }
    assertEquals((await diag()).at(-1).event, "busy");
    assertEquals((await read(sid)).revisions, p.revisions);
  });

  Deno.test("a duplicate id in a posted save keeps the first, and the log says so", async () => {
    await reset();
    const sid = await signIn();
    const p = await read(sid);
    p.assets.push({ ...p.assets[1], name: "the second copy" });
    const r = await post(bodyFrom(p, sid));
    assertEquals(r.ok, true);
    const after = await read(sid);
    assertEquals(after.assets.filter((a: Any) => a.id === p.assets[1].id).length, 1);
    assert(after.assets.every((a: Any) => a.name !== "the second copy"));
    const last = (await diag()).at(-1);
    assertEquals(last.event, "save_adjusted");
    assertMatch(last.detail, /duplicate key/);
  });


  // ---- per-record saves (Phase 2b) ----
  // What persist() posts on the Supabase path: only the assets that changed,
  // each carrying the _rev it was read with.
  const perRecord = (p: Any, sessionId: string, assetChanges: Any, extra: Any = {}) => ({
    sessionId, assetChanges,
    auditAppend: [],
    _revisions: p.revisions,
    _dirty: { assets: true, config: false, breakerTypes: false, photos: false },
    ...extra,
  });
  // An asset's key is id || label, as the client adopts it.
  const k = (a: Any) => a.id || a.label;
  const byId = (p: Any, id: string) => p.assets.find((a: Any) => k(a) === id);

  Deno.test("per record: two devices saving DIFFERENT assets both land", async () => {
    await reset();
    const sid = await signIn();
    const a = await read(sid), b = await read(sid);
    const [x, y] = [a.assets[0], a.assets[1]];
    const r1 = await post(perRecord(a, sid, { upsert: [{ ...x, name: "edited by A" }] }));
    assertEquals(r1.ok, true);
    assertEquals(r1.revisions.assets, a.revisions.assets + 1);
    assert(r1.assetRevs[k(x)] > x._rev, "the saved asset's version moved");
    // B still holds the old domain revision; a whole-snapshot save would conflict.
    const r2 = await post(perRecord(b, sid, { upsert: [{ ...byId(b, k(y)), name: "edited by B" }] }));
    assertEquals(r2.ok, true);
    const after = await read(sid);
    assertEquals(byId(after, k(x)).name, "edited by A");
    assertEquals(byId(after, k(y)).name, "edited by B");
    assertEquals(after.assets.map((q: Any) => k(q)), a.assets.map((q: Any) => k(q)), "every asset keeps its place");
  });

  Deno.test("per record: two devices saving the SAME asset -- the second is a conflict and writes nothing", async () => {
    await reset();
    const sid = await signIn();
    const a = await read(sid), b = await read(sid);
    const x = a.assets[0];
    assertEquals((await post(perRecord(a, sid, { upsert: [{ ...x, name: "A wins" }] }))).ok, true);
    const before = await read(sid);
    const r = await post(perRecord(b, sid, {
      upsert: [{ ...byId(b, k(x)), name: "B loses" }, { ...b.assets[1], name: "also not written" }],
    }, { auditAppend: [{ at: "2026-10-09T00:00:00Z", by: "B", action: "edited", assetLabel: k(x), field: "name" }] }));
    assertEquals([r.ok, r.conflict, r.conflictIds], [false, ["assets"], [k(x)]]);
    const after = await read(sid);
    assertEquals(comparable(after), comparable(before), "nothing written, not even the audit row");
    assertEquals((await diag()).at(-1).event, "conflict");
  });

  Deno.test("per record: a child-only change (a comment) moves the version too", async () => {
    await reset();
    const sid = await signIn();
    const a = await read(sid), b = await read(sid);
    const x = a.assets[0];
    const r = await post(perRecord(a, sid, { upsert: [{ ...x, comments: [...x.comments, { text: "new", at: "2026-10-09", by: "A" }] }] }));
    assertEquals(r.ok, true);
    const stale = await post(perRecord(b, sid, { upsert: [{ ...byId(b, k(x)), name: "stale" }] }));
    assertEquals(stale.conflictIds, [k(x)]);
  });

  Deno.test("per record: only the named assets' child rows are touched", async () => {
    await reset();
    const sid = await signIn();
    const p = await read(sid);
    // Normalize once through a whole save, so unchanged rows are byte-identical.
    await post(bodyFrom(p, sid));
    const q = await read(sid);
    const withKids = q.assets.find((a: Any) => a.comments.length || a.changes.length || a.maintenanceItems.length);
    const panel = q.assets.find((a: Any) => (a.breakers || []).length);
    assert(withKids && panel && k(withKids) !== k(panel), "fixture has both shapes");
    const xmin = async () => (await sql`select string_agg(xmin::text, ',' order by id) as x from asset_tracker.circuits where tenant_id = ${TENANT}`)[0].x;
    const c0 = await xmin();
    // A list that omits the panel's breakers entirely: in a whole save this
    // would delete them; per record it cannot, since the panel is not named.
    const r = await post(perRecord(q, sid, { upsert: [{ ...withKids, comments: [], changes: [], name: "trimmed" }] }));
    assertEquals(r.ok, true);
    const after = await read(sid);
    assertEquals(byId(after, k(withKids)).comments, []);
    assertEquals(byId(after, k(panel)).breakers, panel.breakers);
    assertEquals(await xmin(), c0, "no circuit row rewritten");
    for (const a of q.assets) if (k(a) !== k(withKids)) assertEquals(comparable({ assets: [byId(after, k(a))] }), comparable({ assets: [a] }));
  });

  Deno.test("per record: a new asset goes on the end; posting it again is a conflict, not a duplicate", async () => {
    await reset();
    const sid = await signIn();
    const p = await read(sid);
    const fresh = { id: "new-asset-1", label: "", tag: "", type: "Computer", name: "Brand new", status: "Active" };
    const r = await post(perRecord(p, sid, { upsert: [fresh] }, { _dirty: { assets: true, config: true, breakerTypes: false, photos: false }, nextAssetNumber: 999, columns: p.columns }));
    assertEquals(r.ok, true);
    assertEquals(r.revisions.config, p.revisions.config + 1, "the config half of the same save is still domain-checked and written");
    const after = await read(sid);
    assertEquals(k(after.assets.at(-1)), "new-asset-1");
    assertEquals(after.assets.length, p.assets.length + 1);
    const again = await post(perRecord(after, sid, { upsert: [fresh] }));
    assertEquals(again.conflictIds, ["new-asset-1"]);
  });

  Deno.test("per record: a removal deletes the asset and its children; a stale removal is a conflict", async () => {
    await reset();
    const sid = await signIn();
    const a = await read(sid), b = await read(sid);
    const [x, y] = [a.assets[0], a.assets[1]];
    assertEquals((await post(perRecord(a, sid, { remove: [{ id: k(x), _rev: x._rev }] }))).ok, true);
    const after = await read(sid);
    assert(!byId(after, k(x)));
    const [{ n }] = await sql`select count(*)::int as n from asset_tracker.comments where tenant_id = ${TENANT} and asset_id = ${k(x)}`;
    assertEquals(n, 0);
    // Removing it again is not a conflict -- it is already gone.
    assertEquals((await post(perRecord(b, sid, { remove: [{ id: k(x), _rev: x._rev }] }))).ok, true);
    // Removing one someone else edited is.
    assertEquals((await post(perRecord(after, sid, { upsert: [{ ...byId(after, k(y)), name: "kept" }] }))).ok, true);
    const stale = await post(perRecord(b, sid, { remove: [{ id: k(y), _rev: byId(b, k(y))._rev }] }));
    assertEquals(stale.conflictIds, [k(y)]);
  });

  Deno.test("per record: removing every asset at once is refused unless confirmed", async () => {
    await reset();
    const sid = await signIn();
    const p = await read(sid);
    const all = p.assets.map((a: Any) => ({ id: k(a), _rev: a._rev }));
    const r = await post(perRecord(p, sid, { remove: all }));
    assertEquals([r.ok, r.refused], [false, "emptyAssets"]);
    assertEquals((await read(sid)).assets.length, p.assets.length);
  });

  Deno.test("per record: audit rows are appended as sent, from two devices both", async () => {
    await reset();
    const sid = await signIn();
    const a = await read(sid), b = await read(sid);
    const entry = (who: string, id: string) => ({ at: "2026-10-09T01:00:00Z", by: who, action: "edited", assetLabel: id, field: "name", from: "x", to: "y" });
    await post(perRecord(a, sid, { upsert: [{ ...a.assets[0], name: "y" }] }, { auditAppend: [entry("A", k(a.assets[0]))] }));
    await post(perRecord(b, sid, { upsert: [{ ...b.assets[1], name: "y" }] }, { auditAppend: [entry("B", k(b.assets[1]))] }));
    const after = await read(sid);
    assertEquals(after.auditTotal, a.auditTotal + 2);
    assertEquals(after.auditLog.slice(-2).map((e: Any) => e.by), ["A", "B"]);
  });

  Deno.test("per record: the domain check still guards a whole-snapshot save from an older build", async () => {
    await reset();
    const sid = await signIn();
    const a = await read(sid), old = await read(sid);
    assertEquals((await post(perRecord(a, sid, { upsert: [{ ...a.assets[0], name: "per record" }] }))).ok, true);
    const r = await post(bodyFrom(old, sid));
    assertEquals([r.ok, r.conflict], [false, ["assets"]]);
    assertEquals(byId(await read(sid), k(a.assets[0])).name, "per record");
  });

  Deno.test("per record: a viewer is still refused", async () => {
    await reset();
    const sid = await signIn("jane@school.test");
    const p = await read(sid);
    const r = await post(perRecord(p, sid, { upsert: [{ ...p.assets[0], name: "no" }] }));
    assertEquals(r.ok, false);
    assert(r.readOnly || /view/i.test(r.error || ""), JSON.stringify(r));
  });

  Deno.test({
    name: "close the save test's database",
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => { await sql.end(); },
  });
}
