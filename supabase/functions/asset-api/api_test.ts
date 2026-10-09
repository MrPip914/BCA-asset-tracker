// The API against a throwaway Postgres, with the migrations applied and the
// shared fixture Sheet imported through the real importer.
//
//   DATABASE_URL=postgresql://postgres:…@localhost:5432/postgres \
//     deno test --allow-env --allow-read --allow-net --allow-sys supabase/functions/asset-api/
//
// The check that matters most is PARITY: a read from this API must equal what
// AssetTrackerSync.gs's own read answers for the same Sheet. The Sheet side is
// produced by running the .gs read itself (db/sheet-snapshot.mjs), so a
// difference here is a difference the app would see.

import postgres from "npm:postgres@3.4.5";
import { assert, assertEquals, assertMatch, assertNotEquals } from "jsr:@std/assert@1";
import { saveThroughSheet, snapshotFromGrids } from "../../../db/sheet-snapshot.mjs";
import { snapshotToRows } from "../../../db/snapshot-rows.mjs";
import { loadSql } from "../../../db/load-sql.mjs";
import { AUDIT_ROWS, grids } from "../../../db/fixture-grids.mjs";
import { createApi, SCRIPT_VERSION } from "./api.ts";
import { OAUTH_CLIENT_ID, SESSION_TTL_MS, verifyGoogleIdToken } from "./auth.ts";
import { withTenant } from "./db.ts";

const DATABASE_URL = Deno.env.get("DATABASE_URL");
const gas = await Deno.readTextFile(new URL("../../../AssetTrackerSync.gs", import.meta.url));
const gasConst = (name: string) => gas.match(new RegExp(`const ${name} = "([^"]+)"`))![1];

// ---------------------------------------------------------------- no database

Deno.test("the version and the OAuth client move with AssetTrackerSync.gs", () => {
  assertEquals(SCRIPT_VERSION, gasConst("SCRIPT_VERSION"));
  assertEquals(OAUTH_CLIENT_ID, gasConst("OAUTH_CLIENT_ID"));
});

Deno.test("Google token checks refuse what verifyIdToken_ refuses, and say why", async () => {
  const reply = (status: number, body: unknown) => () =>
    Promise.resolve(new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
  const good = { aud: OAUTH_CLIENT_ID, email: "Jane@School.test", email_verified: "true", exp: Date.now() / 1000 + 600, name: "Jane" };
  assertEquals(await verifyGoogleIdToken("t", reply(200, good) as typeof fetch), { ok: true, email: "jane@school.test", name: "Jane" });
  const refused = async (body: unknown, status = 200) => {
    const r = await verifyGoogleIdToken("t", reply(status, body) as typeof fetch);
    assert(!r.ok);
    return r.detail;
  };
  assertMatch(await refused({ ...good, aud: "someone-else" }), /different app/);
  assertMatch(await refused({ ...good, email_verified: "false" }), /isn't verified/);
  assertMatch(await refused({ ...good, email: "" }), /didn't include an email/);
  assertMatch(await refused({ ...good, exp: 1 }), /already expired/);
  assertMatch(await refused("bad", 400), /HTTP 400/);
  assertMatch(await refused("<html>"), /wasn't readable/);
  const none = await verifyGoogleIdToken(undefined);
  assert(!none.ok && /No sign-in token/.test(none.detail));
});

// ---------------------------------------------------------------- database

const OWNER = "mrpip914@gmail.com";
// A fake Google: "good:<email>:<name>" verifies, anything else is refused.
const verifyIdToken = (token: unknown) => {
  const [kind, email, name] = String(token).split(":");
  return Promise.resolve(kind === "good"
    ? { ok: true as const, email, name: name || "" }
    : { ok: false as const, detail: "fake Google said no" });
};

if (!DATABASE_URL) {
  Deno.test({ name: "database checks (DATABASE_URL not set)", ignore: true, fn() {} });
} else {
  const sql = postgres(DATABASE_URL, { prepare: false, max: 2, onnotice: () => {} });
  let clock = Date.parse("2026-10-08T12:00:00Z");
  const api = createApi({ sql, verifyIdToken, now: () => clock });

  // school_a is the fixture Sheet. school_b's list is NOT alphabetical and
  // does not name the owner, so order and the owner rule are both visible.
  const snap = snapshotFromGrids(gas, grids);
  const load = async (id: string, users: unknown[]) => {
    const { tables } = snapshotToRows(id, { ...snap, authUsers: users });
    await sql.begin((tx: postgres.TransactionSql) =>
      tx.unsafe(loadSql({ id, name: id, ownerEmail: OWNER, cloudinaryFolder: null }, tables)).simple());
  };
  await sql`delete from asset_tracker.sessions where tenant_id in ('school_a', 'school_b')`;
  await sql`delete from asset_tracker.diagnostics where tenant_id in ('school_a', 'school_b')`;
  await load("school_a", snap.authUsers);
  await load("school_b", [
    { email: "zed@school.test", name: "Zed", role: "viewer" },
    { email: "amy@school.test", name: "Amy", role: "editor" },
  ]);

  const post = async (tenant: string, body: unknown) => {
    const res = await api(new Request(`https://api.test/asset-api?tenant=${tenant}`, {
      method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }));
    assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
    return await res.json();
  };
  const signIn = (tenant: string, email: string, name = "") => post(tenant, { op: "signin", idToken: `good:${email}:${name}` });
  const diagRows = (tenant: string) =>
    sql`select event, op, email, reason, detail from asset_tracker.diagnostics where tenant_id = ${tenant} order by seq`;

  // What the .gs read answers for the same Sheet, adjusted for the two things
  // the import changes ON PURPOSE: a duplicate asset id keeps only its first
  // row, and a work entry with a blank id gets a stable minted one.
  const expected = () => {
    const p = structuredClone(snapshotFromGrids(gas, grids, { fullAudit: false }).payload);
    const seen = new Set();
    p.assets = p.assets.filter((a: { id?: string; label: string }) => {
      const id = a.id || a.label;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    delete p.auth;
    return p;
  };
  const comparable = (payload: Record<string, unknown>) => {
    const p = structuredClone(payload);
    for (const a of p.assets as { changes: { id: string }[] }[]) {
      for (const c of a.changes) if (c.id.startsWith("imp-")) c.id = "";
    }
    delete p.auth;
    return p;
  };

  Deno.test("sign-in answers what the Sheet backend answers, plus a session", async () => {
    const r = await signIn("school_a", OWNER);
    assertEquals(comparable(r), expected());
    assertEquals(r.auditLog.length, 2000);
    assertEquals(r.auditTotal, AUDIT_ROWS);
    assertEquals(r.auth.email, OWNER);
    assertEquals(r.auth.role, "editor");
    assertEquals(r.auth.ownerEmail, OWNER);
    assertMatch(r.auth.sessionId, /^[0-9a-f]{64}$/);
  });

  Deno.test("the whole audit log answers what the Sheet backend's auditFull answers", async () => {
    const { auth } = await signIn("school_a", OWNER);
    const r = await post("school_a", { op: "auditFull", sessionId: auth.sessionId });
    const sheet = saveThroughSheet(gas, grids, { op: "auditFull", sessionId: "x" }).response;
    assertEquals(r, sheet);
    assertEquals([r.auditLog.length, r.auditTotal], [AUDIT_ROWS, AUDIT_ROWS]);
    // Oldest first: the window an ordinary read sends is this list's tail.
    const { auditLog } = await post("school_a", { op: "read", sessionId: auth.sessionId });
    const at = (rows: { at: string }[]) => rows.map((e) => e.at);
    assertEquals(at(r.auditLog.slice(-2000)), at(auditLog));
  });

  Deno.test("a viewer gets the whole log; no session, or another tenant's, gets nothing", async () => {
    const viewer = await signIn("school_a", "jane@school.test");
    assertEquals((await post("school_a", { op: "auditFull", sessionId: viewer.auth.sessionId })).auditTotal, AUDIT_ROWS);
    for (const [tenant, sessionId] of [["school_a", undefined], ["school_b", viewer.auth.sessionId]]) {
      const r = await post(tenant, { op: "auditFull", sessionId });
      assertEquals([r.ok, r.authFailed, r.reason, r.auditLog], [false, true, "signin", undefined]);
    }
    const [last] = (await diagRows("school_a")).slice(-1);
    assertEquals([last.event, last.op, last.detail], ["auth_failed", "auditFull", "session none"]);
  });

  Deno.test("the allowlist keeps its stored order, and the owner is always an editor", async () => {
    const r = await signIn("school_b", OWNER);
    assertEquals(r.auth.role, "editor");
    assertEquals(r.auth.users, [
      { email: OWNER, name: "Owner", role: "editor" },
      { email: "zed@school.test", name: "Zed", role: "viewer" },
      { email: "amy@school.test", name: "Amy", role: "editor" },
    ]);
  });

  Deno.test("a read with the session answers the same, and keeps the session", async () => {
    const { auth } = await signIn("school_a", OWNER);
    const r = await post("school_a", { op: "read", sessionId: auth.sessionId, _dirty: { assets: false, config: false, breakerTypes: false } });
    assertEquals(comparable(r), expected());
    assertEquals(r.auth.sessionId, auth.sessionId);
  });

  Deno.test("the stored name wins, and a viewer is a viewer", async () => {
    const r = await signIn("school_a", "jane@school.test", "Jane From Google");
    assertEquals([r.auth.name, r.auth.role], ["Jane", "viewer"]);
  });

  Deno.test("someone not on the list is refused by name", async () => {
    const r = await signIn("school_a", "stranger@school.test");
    assertEquals([r.ok, r.authFailed, r.reason, r.email], [false, true, "notallowed", "stranger@school.test"]);
    assertEquals(r.assets, undefined);
  });

  Deno.test("a token Google refuses is a sign-in failure that says why", async () => {
    const r = await post("school_a", { op: "signin", idToken: "forged" });
    assertEquals([r.ok, r.authFailed, r.reason, r.detail], [false, true, "signin", "fake Google said no"]);
  });

  Deno.test("a session from one tenant is refused by another", async () => {
    const { auth } = await signIn("school_a", OWNER);
    const r = await post("school_b", { op: "read", sessionId: auth.sessionId });
    assertEquals([r.authFailed, r.reason], [true, "signin"]);
    assertEquals(r.assets, undefined);
    const [last] = (await diagRows("school_b")).slice(-1);
    assertEquals(last.detail, "session missing");
  });

  Deno.test("a missing, malformed or absent session is refused, and the log says which", async () => {
    for (const [sessionId, why] of [["0".repeat(64), "missing"], ["../etc", "malformed"], [undefined, "none"]]) {
      const r = await post("school_a", { op: "read", sessionId });
      assertEquals([r.authFailed, r.reason], [true, "signin"]);
      const [last] = (await diagRows("school_a")).slice(-1);
      assertEquals([last.event, last.op, last.detail], ["auth_failed", "read", "session " + why]);
    }
  });

  Deno.test("an expired session is refused and deleted", async () => {
    const { auth } = await signIn("school_a", OWNER);
    clock += SESSION_TTL_MS + 1000;
    try {
      const r = await post("school_a", { op: "read", sessionId: auth.sessionId });
      assertEquals(r.reason, "signin");
      assertEquals((await sql`select 1 from asset_tracker.sessions where id = ${auth.sessionId}`).length, 0);
    } finally {
      clock -= SESSION_TTL_MS + 1000;
    }
  });

  Deno.test("a session slides forward once it has drifted an hour, not before", async () => {
    const { auth } = await signIn("school_a", OWNER);
    const expiry = async () => (await sql`select expires_at from asset_tracker.sessions where id = ${auth.sessionId}`)[0].expires_at.getTime();
    const first = await expiry();
    clock += 10 * 60 * 1000;
    await post("school_a", { op: "read", sessionId: auth.sessionId });
    assertEquals(await expiry(), first);
    clock += 60 * 60 * 1000;
    await post("school_a", { op: "read", sessionId: auth.sessionId });
    assertEquals(await expiry(), clock + SESSION_TTL_MS);
  });

  Deno.test("removing someone from the list locks them out on their next request", async () => {
    const { auth } = await signIn("school_a", "jane@school.test");
    await sql`delete from asset_tracker.auth_users where tenant_id = 'school_a' and email = 'jane@school.test'`;
    try {
      const r = await post("school_a", { op: "read", sessionId: auth.sessionId });
      assertEquals([r.authFailed, r.reason], [true, "notallowed"]);
    } finally {
      await load("school_a", snap.authUsers);
    }
  });

  Deno.test("sign-out ends the session and is ok whatever it was handed", async () => {
    const { auth } = await signIn("school_a", OWNER);
    assertEquals(await post("school_a", { op: "signout", sessionId: auth.sessionId }), { ok: true });
    assertEquals((await post("school_a", { op: "read", sessionId: auth.sessionId })).reason, "signin");
    assertEquals(await post("school_a", { op: "signout", sessionId: "nonsense" }), { ok: true });
    assertEquals(await post("school_a", { op: "signout" }), { ok: true });
    const rows = await diagRows("school_a");
    assert(rows.some((r) => r.event === "signout" && r.email === OWNER));
  });

  Deno.test("the log never holds a session id", async () => {
    const ids = (await sql`select id from asset_tracker.sessions`).map((r) => r.id as string);
    assertNotEquals(ids.length, 0);
    const text = JSON.stringify(await sql`select * from asset_tracker.diagnostics`);
    for (const id of ids) assert(!text.includes(id), "a session id reached the diagnostics table");
  });

  Deno.test("every query runs as asset_api, under the request's tenant", async () => {
    // deno-lint-ignore no-explicit-any
    const who: any = await withTenant(sql, "school_a", (tx) => tx`select current_user as u, current_tenant() as t`);
    assertEquals([who[0].u, who[0].t], ["asset_api", "school_a"]);
    // deno-lint-ignore no-explicit-any
    const leak: any = await withTenant(sql, "school_a", (tx) => tx`select count(*)::int as n from assets where tenant_id = 'school_b'`);
    assertEquals(leak[0].n, 0);
  });

  Deno.test("an unknown tenant, no tenant, a bad body and an unported op are all JSON answers", async () => {
    assertMatch((await signIn("no_such_school", OWNER)).error, /no tenant "no_such_school"/);
    const res = await api(new Request("https://api.test/asset-api", { method: "POST", body: '{"op":"read"}' }));
    assertMatch((await res.json()).error, /No tenant named/);
    assertEquals(await post("school_a", "{not json"), { ok: false, error: "Malformed request body." });
    assertMatch((await post("school_a", { op: "noSuchOp" })).error, /"noSuchOp" isn't available/);
  });

  Deno.test("the bare GET reports the version without a token", async () => {
    const r = await (await api(new Request("https://api.test/asset-api"))).json();
    assertEquals([r.authFailed, r.scriptVersion], [true, gasConst("SCRIPT_VERSION")]);
    const pre = await api(new Request("https://api.test/asset-api", { method: "OPTIONS" }));
    assertEquals(pre.status, 204);
  });

  Deno.test({
    name: "close the database",
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => { await sql.end(); },
  });
}
