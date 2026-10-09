// Upload signing (sign.ts) against AssetTrackerSync.gs's own handlePhotoSign_
// and handleFloorPlanSign_, run with the same clock, the same ids and the same
// credentials. A signature that differs by one byte is an upload Cloudinary
// refuses as "invalid signature" without saying why, so the answers must be
// IDENTICAL, not merely shaped alike.

import postgres from "npm:postgres@3.4.5";
import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { saveThroughSheet, snapshotFromGrids } from "../../../db/sheet-snapshot.mjs";
import { snapshotToRows } from "../../../db/snapshot-rows.mjs";
import { loadSql } from "../../../db/load-sql.mjs";
import { grids } from "../../../db/fixture-grids.mjs";
import { createApi } from "./api.ts";
import { cloudinarySignature, credsFromEnv, PHOTO_SIGN_MAX_BATCH } from "./sign.ts";

const DATABASE_URL = Deno.env.get("DATABASE_URL");
const gas = await Deno.readTextFile(new URL("../../../AssetTrackerSync.gs", import.meta.url));

const CREDS = { cloudName: "demo-cloud", apiKey: "123456789", apiSecret: "s3cr3t-value" };
const PROPS = { CLOUDINARY_CLOUD_NAME: CREDS.cloudName, CLOUDINARY_API_KEY: CREDS.apiKey, CLOUDINARY_API_SECRET: CREDS.apiSecret };
const NOW = Date.parse("2026-10-09T12:00:00Z");
const counter = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};

// What the .gs answers, for a body and a set of Script Properties.
const sheet = (body: unknown, props: Record<string, string> = PROPS, as?: unknown) =>
  // deno-lint-ignore no-explicit-any
  saveThroughSheet(gas, grids, body, { props, uuid: counter(), now: NOW, as } as any).response;

Deno.test("the signature is Cloudinary's documented example", async () => {
  // https://cloudinary.com/documentation/authentication_signatures
  assertEquals(
    await cloudinarySignature({ eager: "w_400,h_300,c_pad|w_260,h_200,c_crop", public_id: "sample_image", timestamp: 1315060510 }, "abcd"),
    "bfd09f95f331f558cbd1320e67aa8d488770583e",
  );
  // A blank value is not signed.
  assertEquals(await cloudinarySignature({ a: "1", b: "" }, "x"), await cloudinarySignature({ a: "1" }, "x"));
});

Deno.test("credentials come from all three secrets or not at all", () => {
  assertEquals(credsFromEnv((k) => (PROPS as Record<string, string>)[k]), CREDS);
  assertEquals(credsFromEnv((k) => (k === "CLOUDINARY_API_SECRET" ? "" : (PROPS as Record<string, string>)[k])), null);
});

if (!DATABASE_URL) {
  Deno.test({ name: "database checks (DATABASE_URL not set)", ignore: true, fn() {} });
} else {
  const sql = postgres(DATABASE_URL, { prepare: false, max: 2, onnotice: () => {} });
  const TENANT = "school_sign";
  const OWNER = "mrpip914@gmail.com";
  const snap = snapshotFromGrids(gas, grids);
  const { tables } = snapshotToRows(TENANT, snap);
  await sql`delete from asset_tracker.sessions where tenant_id = ${TENANT}`;
  await sql.begin((tx: postgres.TransactionSql) =>
    tx.unsafe(loadSql({ id: TENANT, name: TENANT, ownerEmail: OWNER, cloudinaryFolder: null }, tables)).simple());
  const setFolder = (f: string | null) => sql`update asset_tracker.tenants set cloudinary_folder = ${f} where id = ${TENANT}`;
  await setFolder(null);

  const verifyIdToken = (t: unknown) => {
    const [, email] = String(t).split(":");
    return Promise.resolve({ ok: true as const, email, name: "" });
  };
  const apiWith = (cloudinary: typeof CREDS | null) => createApi({ sql, verifyIdToken, now: () => NOW, cloudinary, uuid: counter() });
  const post = async (body: unknown, cloudinary: typeof CREDS | null = CREDS) => {
    const res = await apiWith(cloudinary)(new Request(`https://api.test/asset-api?tenant=${TENANT}`, { method: "POST", body: JSON.stringify(body) }));
    return await res.json();
  };
  const session = async (email: string) => (await post({ op: "signin", idToken: `good:${email}` })).auth.sessionId;
  const editor = await session(OWNER);
  const viewer = await session("jane@school.test");

  Deno.test("a photo batch answers exactly what handlePhotoSign_ answers", async () => {
    for (const count of [undefined, 1, 3, 0, -2, "4", 1000]) {
      const r = await post({ op: "photoSign", sessionId: editor, count });
      assertEquals(r, sheet({ op: "photoSign", sessionId: "x", count }));
    }
    const big = await post({ op: "photoSign", sessionId: editor, count: 1000 });
    assertEquals(big.signatures.length, PHOTO_SIGN_MAX_BATCH);
    assertEquals(big.signatures[0].signedParams, ["allowed_formats", "folder", "public_id", "timestamp"]);
    assertEquals(big.publicId, big.signatures[0].publicId);
  });

  Deno.test("a floor plan answers exactly what handleFloorPlanSign_ answers, with no allowed_formats", async () => {
    const r = await post({ op: "floorPlanSign", sessionId: editor });
    assertEquals(r, sheet({ op: "floorPlanSign", sessionId: "x" }));
    assertEquals(r.signedParams, ["folder", "public_id", "timestamp"]);
  });

  Deno.test("the tenant's folder is the one signed, and a request cannot choose it", async () => {
    await setFolder("dev-photos");
    try {
      const r = await post({ op: "photoSign", sessionId: editor, folder: "someone-else", publicId: "theirs" });
      assertEquals(r, sheet({ op: "photoSign", sessionId: "x" }, { ...PROPS, CLOUDINARY_FOLDER: "dev-photos" }));
      assertEquals([r.folder, r.publicId], ["dev-photos", "00000000-0000-4000-8000-000000000001"]);
    } finally {
      await setFolder(null);
    }
  });

  Deno.test("a viewer is refused as the .gs refuses, for both kinds", async () => {
    const as = { email: "jane@school.test", role: "viewer" };
    for (const op of ["photoSign", "floorPlanSign"]) {
      const r = await post({ op, sessionId: viewer });
      assertEquals(r, sheet({ op, sessionId: "x" }, PROPS, as));
      assertEquals(r.reason, "readonly");
    }
  });

  Deno.test("no session is refused before anything is signed", async () => {
    const r = await post({ op: "photoSign" });
    assertEquals([r.ok, r.authFailed, r.reason, r.signature], [false, true, "signin", undefined]);
  });

  Deno.test("missing secrets are named, and nothing is signed", async () => {
    for (const op of ["photoSign", "floorPlanSign"]) {
      const r = await post({ op, sessionId: editor }, null);
      const gasR = sheet({ op, sessionId: "x" }, {});
      assertEquals([r.ok, gasR.ok, r.signature, gasR.signature], [false, false, undefined, undefined]);
      assertMatch(r.error, /CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET under Supabase/);
      assert(!JSON.stringify(r).includes(CREDS.apiSecret));
    }
  });

  Deno.test("the secret never leaves the function", async () => {
    const r = await post({ op: "photoSign", sessionId: editor, count: 3 });
    assert(!JSON.stringify(r).includes(CREDS.apiSecret));
  });
}
