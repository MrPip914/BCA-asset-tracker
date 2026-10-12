// The public panel read (GET ?panel=) against AssetTrackerSync.gs's own
// publicPanelPayload_, over the same Sheet. This is the one ANONYMOUS answer
// either backend gives, so the check is equality: a field this API added would
// be a field published to anyone holding a QR sticker.

import postgres from "npm:postgres@3.4.5";
import { assert, assertEquals } from "jsr:@std/assert@1";
import { getThroughSheet, snapshotFromGrids } from "../../../db/sheet-snapshot.mjs";
import { snapshotToRows } from "../../../db/snapshot-rows.mjs";
import { loadSql } from "../../../db/load-sql.mjs";
import { grids as base } from "../../../db/fixture-grids.mjs";
import { createApi } from "./api.ts";
import * as panelTs from "./panel.ts";

const DATABASE_URL = Deno.env.get("DATABASE_URL");
const gas = await Deno.readTextFile(new URL("../../../AssetTrackerSync.gs", import.meta.url));

Deno.test("the public whitelists move with AssetTrackerSync.gs", () => {
  for (const name of ["PUBLIC_PANEL_FIELDS", "PUBLIC_BREAKER_FIELDS", "PUBLIC_CIRCUIT_FIELDS", "PUBLIC_BREAKER_TYPE_FIELDS", "PUBLIC_PHOTO_FIELDS"]) {
    const m = gas.match(new RegExp(`const ${name} = (\\[[^\\]]*\\]);`));
    assert(m, name + " not found in the .gs");
    assertEquals((panelTs as Record<string, unknown>)[name], JSON.parse(m[1]), name);
  }
});

// The shared fixture, grown into a panel worth reading: a sub-panel in a
// closet inside a room, fed from the first panel; a second breaker type that
// only the sub-panel places; photos that must and must not publish; a panel
// fields row; and a computer, which is not a panel whatever its code says.
const grids = structuredClone(base) as Record<string, unknown[][]>;
const A = ["id", "label", "tag", "type", "name", "parentId", "personIds", "serial", "panelSlotCount", "panelLayout", "panelPhases", "panelVoltage", "notes", "hostname"];
grids.Assets = [
  A,
  ["", "BCA0001", "BCA0001", "Building", "Building 100"],
  ["room-uuid", "BCR0002", "", "Room", "Room 101", "BCA0001"],
  ["pc-uuid", "BCA0003", "BCA0003", "Computer", "Front desk PC", "room-uuid", "u1, u2", 12345],
  ["panel-uuid", "BCA0004", "BCA0004", "Electrical Panel", "", "room-uuid", "", "SN-SECRET", 42, "two-column", "", "", "procurement note", "host"],
  ["closet-uuid", "BCR0006", "", "Room", "Closet", "room-uuid"],
  ["sub-uuid", "BCA0005", "MDP-2", "Electrical Panel", "Sub", "closet-uuid", "", "", 12, "single-column", "3", "120/208"],
  ["loop-a", "BCA0007", "", "Room", "Loop A", "loop-b"],
  ["loop-b", "BCA0008", "", "Room", "Loop B", "loop-a"],
  ["loop-panel", "BCA0009", "", "Electrical Panel", "", "loop-a", "", "", 4],
];
grids.Breakers = [
  base.Breakers[0],
  ["b-1", "panel-uuid", "1a,1b", 20, "", "SN-B", "", "kitchen", "g-1", "bt-1"],
  ["b-feed", "panel-uuid", "3, 5", 60, "", "", "", "", "g-2", "bt-1"],
  ["b-sub", "sub-uuid", "1,3,5", 30, "", "", "", "", "g-3", "bt-3"],
  ["b-orphan", "nowhere", "3", 15],
];
grids.Circuits = [
  base.Circuits[0],
  ["c-1", "b-1", "panel-uuid", "Outlets", "room-uuid, closet-uuid", "", "north wall", "1", "Black", "c-2"],
  ["c-2", "", "panel-uuid", "Spare run", "", "", "", "2"],
  ["c-feed", "b-feed", "panel-uuid", "Feed to MDP-2", "", "sub-uuid", "", "3"],
  ["c-sub", "b-sub", "sub-uuid", "Kitchen RTU", "closet-uuid,ghost-room", "", "", "", "Black/Red/Blue"],
];
grids.BreakerTypes = [
  base.BreakerTypes[0],
  base.BreakerTypes[1],
  ["bt-2", "Unused", 2, '[{"cells":["1"],"ampRating":20}]'],
  ["bt-3", "Triple-Pole", 3, '[{"cells":["1","3","5"],"ampRating":30}]'],
];
grids.Photos = [
  base.Photos[0],
  ["p-1", "asset", "panel-uuid", "https://x/1.jpg", "", "k1", "", "", "Door", 800, 600, "", true],  // hidden
  ["p-2", "change", "ch-1", "https://x/2.pdf", "", "k2", "pdf", "quote.pdf"],                      // not this panel's
  ["p-3", "asset", "panel-uuid", "https://x/3.jpg", "https://x/3t.jpg", "k3", "image", "door.jpg", "Inside", 1200, 900, 5000, "", "2026-01-01", "Eric"],
  ["p-4", "breaker", "b-1", "https://x/4.jpg", "", "k4", "", "", "", "", "", "", ""],
  ["p-5", "circuit", "c-2", "https://x/5.pdf", "", "k5", "pdf", "schedule.pdf"],                  // a document: never public
  ["p-6", "asset", "pc-uuid", "https://x/6.jpg", "", "k6"],                                        // a computer's
  ["p-7", "circuit", "c-sub", "https://x/7.jpg", "", "k7", "image", "", "RTU"],
];

if (!DATABASE_URL) {
  Deno.test({ name: "database checks (DATABASE_URL not set)", ignore: true, fn() {} });
} else {
  const sql = postgres(DATABASE_URL, { prepare: false, max: 2, onnotice: () => {} });
  const TENANT = "school_panel";
  const { tables } = snapshotToRows(TENANT, snapshotFromGrids(gas, grids));
  await sql.begin((tx: postgres.TransactionSql) =>
    tx.unsafe(loadSql({ id: TENANT, name: TENANT, ownerEmail: "mrpip914@gmail.com", cloudinaryFolder: null }, tables)).simple());
  // A second tenant holding only the plain fixture: no sub-panel there.
  const other = snapshotToRows("school_panel_b", snapshotFromGrids(gas, base)).tables;
  await sql.begin((tx: postgres.TransactionSql) =>
    tx.unsafe(loadSql({ id: "school_panel_b", name: "b", ownerEmail: "mrpip914@gmail.com", cloudinaryFolder: null }, other)).simple());
  const api = createApi({ sql });
  const get = async (query: string) => {
    const res = await api(new Request(`https://api.test/asset-api?${query}`));
    assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
    return await res.json();
  };

  Deno.test("every way into a panel answers what publicPanelPayload_ answers", async () => {
    // Key, tag, label, any case, padded; a sub-panel fed from another; a panel
    // whose rooms loop; a computer's code; a code nothing has; nothing at all.
    for (const code of ["panel-uuid", "BCA0004", "bca0004", " BCA0004 ", "sub-uuid", "MDP-2", "BCA0005", "BCA0009", "BCA0003", "nope", ""]) {
      const r = await get(`tenant=${TENANT}&panel=${encodeURIComponent(code)}`);
      const sheet = code === "" ? { ok: false, error: "No panel specified." } : getThroughSheet(gas, grids, { panel: code });
      // An empty ?panel= never reaches the panel branch on either backend.
      if (code === "") { assertEquals(r.authFailed, true); continue; }
      assertEquals(r, sheet, `panel code "${code}"`);
    }
  });

  Deno.test("only this panel's public photos and fields go out", async () => {
    const r = await get(`tenant=${TENANT}&panel=BCA0004`);
    assertEquals(r.photos.map((p: { id: string }) => p.id), ["p-3", "p-4"]);
    const text = JSON.stringify(r);
    for (const secret of ["SN-SECRET", "SN-B", "procurement note", "host", "k3", "Eric", "quote.pdf", "u1"]) {
      assert(!text.includes(secret), `"${secret}" reached the public page`);
    }
    assertEquals(r.breakerTypes.map((t: { id: string }) => t.id), ["bt-1"]);
    const sub = await get(`tenant=${TENANT}&panel=MDP-2`);
    assertEquals(sub.fedFrom, { panelLabel: "BCA0004", panelRoomName: "Room 101", circuitLabel: "Feed to MDP-2", cells: ["3", "5"] });
    assertEquals([sub.panel.roomName, sub.panel.buildingName], ["Closet", "Building 100"]);
  });

  Deno.test("one tenant's panel code finds nothing on another tenant", async () => {
    const r = await get(`tenant=school_panel_b&panel=sub-uuid`);
    assertEquals(r, { ok: false, error: "No electrical panel found for that code." });
    assertEquals(await get(`tenant=no_such_school&panel=BCA0004`), { ok: false, error: "Could not load that panel." });
    assertEquals((await get(`panel=BCA0004`)).ok, false);
  });
}
