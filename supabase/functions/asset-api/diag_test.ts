// op:"diagnostics" against AssetTrackerSync.gs's own handleDiagnostics_. The
// same log rows go into the diagnostics table and into a fake Diagnostics tab
// (as logDiag_ writes them, apostrophes and all), and both answers must be equal.

import postgres from "npm:postgres@3.4.5";
import { assertEquals } from "jsr:@std/assert@1";
import { saveThroughSheet, snapshotFromGrids } from "../../../db/sheet-snapshot.mjs";
import { snapshotToRows } from "../../../db/snapshot-rows.mjs";
import { loadSql } from "../../../db/load-sql.mjs";
import { grids } from "../../../db/fixture-grids.mjs";
import { createApi } from "./api.ts";
import { DIAG_READ_LIMIT } from "./db.ts";

const DATABASE_URL = Deno.env.get("DATABASE_URL");
const gas = await Deno.readTextFile(new URL("../../../AssetTrackerSync.gs", import.meta.url));

Deno.test("the read limit moves with AssetTrackerSync.gs", () => {
  assertEquals(DIAG_READ_LIMIT, Number(gas.match(/const DIAG_READ_LIMIT = (\d+);/)![1]));
});

if (!DATABASE_URL) {
  Deno.test({ name: "database checks (DATABASE_URL not set)", ignore: true, fn() {} });
} else {
  const sql = postgres(DATABASE_URL, { prepare: false, max: 2, onnotice: () => {} });
  const TENANT = "school_diag";
  const OWNER = "mrpip914@gmail.com";
  const { tables } = snapshotToRows(TENANT, snapshotFromGrids(gas, grids));
  await sql.begin((tx: postgres.TransactionSql) =>
    tx.unsafe(loadSql({ id: TENANT, name: TENANT, ownerEmail: OWNER, cloudinaryFolder: null }, tables)).simple());

  const verifyIdToken = (t: unknown) => Promise.resolve({ ok: true as const, email: String(t).split(":")[1], name: "" });
  const api = createApi({ sql, verifyIdToken });
  const post = async (body: unknown) =>
    await (await api(new Request(`https://api.test/asset-api?tenant=${TENANT}`, { method: "POST", body: JSON.stringify(body) }))).json();
  const session = async (email: string) => (await post({ op: "signin", idToken: `good:${email}` })).auth.sessionId;

  // More rows than one read returns, with blanks, a formula-looking detail and
  // a missing duration -- the cases the Sheet's apostrophes and display values
  // exist for.
  const N = DIAG_READ_LIMIT + 7;
  const rows = Array.from({ length: N }, (_, i) => ({
    at: new Date(Date.UTC(2026, 9, 9, 0, 0, i)).toISOString(),
    event: i % 3 ? "busy" : "auth_failed",
    op: i % 2 ? "save" : "read",
    email: i % 5 ? `user${i}@school.test` : "",
    reason: i % 3 ? "" : "signin",
    detail: i === 4 ? "=HYPERLINK(\"x\")" : `row ${i}`,
    ms: i % 4 ? i * 10 : null,
    scriptVersion: "v52",
  }));

  // Exactly the rows that are compared, and nothing the sign-in below logs.
  const reset = async () => {
    await sql`delete from asset_tracker.diagnostics where tenant_id = ${TENANT}`;
    for (const r of rows) {
      await sql`insert into asset_tracker.diagnostics (tenant_id, at, event, op, email, reason, detail, ms, script_version)
        values (${TENANT}, ${r.at}, ${r.event}, ${r.op}, ${r.email}, ${r.reason}, ${r.detail}, ${r.ms}, ${r.scriptVersion})`;
    }
  };
  const sheetGrid = [
    ["at", "event", "op", "email", "reason", "detail", "ms", "scriptVersion"],
    ...rows.map((r) => [
      "'" + r.at, "'" + r.event, "'" + r.op, "'" + r.email, "'" + r.reason, "'" + r.detail,
      r.ms === null ? "" : r.ms, "'" + r.scriptVersion,
    ]),
  ];
  const sheet = (as?: unknown) =>
    // deno-lint-ignore no-explicit-any
    saveThroughSheet(gas, { ...grids, Diagnostics: sheetGrid }, { op: "diagnostics", sessionId: "x" }, { as } as any).response;

  const editor = await session(OWNER);
  const viewer = await session("jane@school.test");

  Deno.test("an editor reads what handleDiagnostics_ answers: newest first, capped, with the true count", async () => {
    await reset();
    const r = await post({ op: "diagnostics", sessionId: editor });
    assertEquals(r, sheet());
    assertEquals([r.entries.length, r.total, r.entries[0].detail], [DIAG_READ_LIMIT, N, `row ${N - 1}`]);
  });

  Deno.test("a viewer is told only editors may read it, as the .gs says", async () => {
    await reset();
    const r = await post({ op: "diagnostics", sessionId: viewer });
    assertEquals(r, sheet({ email: "jane@school.test", role: "viewer" }));
    assertEquals([r.ok, r.forbidden, r.entries], [false, true, undefined]);
  });

  Deno.test("no session is refused, and the refusal is logged", async () => {
    await reset();
    const r = await post({ op: "diagnostics" });
    assertEquals([r.ok, r.authFailed, r.reason, r.entries], [false, true, "signin", undefined]);
    const [last] = await sql`select event, op, detail from asset_tracker.diagnostics where tenant_id = ${TENANT} order by seq desc limit 1`;
    assertEquals([last.event, last.op, last.detail], ["auth_failed", "diagnostics", "session none"]);
  });

  Deno.test("an empty log is an empty list, not a failure", async () => {
    await sql`delete from asset_tracker.diagnostics where tenant_id = ${TENANT}`;
    const r = await post({ op: "diagnostics", sessionId: editor });
    // deno-lint-ignore no-explicit-any
    const empty = saveThroughSheet(gas, { ...grids, Diagnostics: [] }, { op: "diagnostics", sessionId: "x" }, {} as any).response;
    assertEquals(r, empty);
    assertEquals([r.entries, r.total], [[], 0]);
  });
}
