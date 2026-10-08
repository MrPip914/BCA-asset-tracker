// Tests the importer's pure halves against a fixture Sheet, and -- when
// DATABASE_URL names a THROWAWAY database with the migrations applied -- loads
// it for real. CI runs both on every change under db/. Never point it at dev:
// it creates and replaces tenants.
//
//   node db/test-import.mjs
//   DATABASE_URL=postgres://…/throwaway node db/test-import.mjs
//
// The fixture is deliberately MIXED, the `personIds` lesson from CLAUDE.md: a
// uniform fixture exercises half the code.

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { snapshotFromGrids } from "./sheet-snapshot.mjs";
import { snapshotToRows } from "./snapshot-rows.mjs";
import { loadSql } from "./load-sql.mjs";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const gas = fs.readFileSync(path.join(REPO, "AssetTrackerSync.gs"), "utf8");

let passed = 0;
const check = (name, fn) => {
  try { fn(); passed++; } catch (err) { console.error(`✗ ${name}\n  ${err.message}`); process.exitCode = 1; }
};

// ---------------------------------------------------------------- fixture
const AUDIT_ROWS = 2500; // past AUDIT_READ_LIMIT (2000): an import must carry them all
const grids = {
  // Trailing blank cells omitted on some rows, as the Sheets API returns them.
  Assets: [
    ["id", "label", "tag", "type", "name", "parentId", "personIds", "serial"],
    ["", "BCA0001", "BCA0001", "Building", "Building 100"],                    // legacy: no id, keyed by label
    ["room-uuid", "BCR0002", "", "Room", "Room 101", "BCA0001"],
    ["pc-uuid", "BCA0003", "BCA0003", "Computer", "Front desk PC", "room-uuid", "u1, u2", 12345],
    ["panel-uuid", "BCA0004", "BCA0004", "Electrical Panel", "", "room-uuid"],
    ["pc-uuid", "BCA9999", "", "Computer", "duplicate id"],                   // duplicate: dropped
  ],
  Comments: [["assetLabel", "text", "at", "by"], ["pc-uuid", "Fan noisy", "2026-01-01", "Eric"]],
  Changes: [
    ["assetLabel", "id", "changeType", "vendor", "cost", "note", "at", "by", "maintenanceId", "performedOn"],
    ["pc-uuid", "ch-1", "Repair", "", 40, "fan", "2026-01-02", "Eric", "m-1", "2026-01-02"],
    ["pc-uuid", "", "Upgrade", "", "", "pre-v34 row", "2025-05-01", "Eric"],   // blank id: minted
  ],
  Allocations: [["assetLabel", "room", "quantity"]],
  Maintenance: [
    ["assetLabel", "id", "kind", "task", "notes", "frequencyLabel", "frequencyDays", "dueDate", "lastPerformed", "owner", "at", "by"],
    ["pc-uuid", "m-1", "", "Dust", "", "Monthly", 30, "", "2026-01-02", "Eric", "", ""],
  ],
  Breakers: [
    ["id", "panelLabel", "cells", "ampRating", "status", "serial", "installedDate", "notes", "groupId", "breakerTypeId"],
    ["b-1", "panel-uuid", "1a,1b", 20, "", "", "", "", "g-1", "bt-1"],
    ["b-orphan", "nowhere", "3", 15],                                         // panel missing: doGet drops it
  ],
  Circuits: [
    ["id", "breakerId", "panelLabel", "label", "roomsServed", "feedsPanelLabel", "notes", "tag", "wireColor", "sharedNeutralWith"],
    ["c-1", "b-1", "panel-uuid", "Outlets", "room-uuid", "", "", "1", "Black", "c-2"],
    ["c-2", "", "panel-uuid", "Spare run", "", "", "", "2"],                  // unassigned
  ],
  BreakerTypes: [["id", "name", "slotSpan", "members"], ["bt-1", "Single-Pole", 1, '[{"cells":["1a","1b"],"ampRating":20}]']],
  SpaceLinks: [["assetLabel", "shapeId", "roomId", "at", "by"], ["BCA0001", "s1", "room-uuid", "", ""], ["BCA0001", "s1#e2", "room-uuid", "", ""]],
  SpaceGroups: [["id", "assetLabel", "name", "hideLabel", "memberShapeIds", "at", "by"], ["sg-1", "BCA0001", "Wing", true, "s1,s2", "", ""]],
  Photos: [
    ["id", "ownerType", "ownerId", "url", "thumbUrl", "storageKey", "kind", "fileName", "caption", "width", "height", "bytes", "hiddenFromPublic", "at", "by"],
    ["p-1", "asset", "panel-uuid", "https://x/1.jpg", "", "k1", "", "", "Door", 800, 600, "", true],
    ["p-2", "change", "ch-1", "https://x/2.pdf", "", "k2", "pdf", "quote.pdf"],
  ],
  AuditLog: [
    ["assetLabel", "assetType", "action", "field", "from", "to", "room", "quantity", "previousQuantity", "note", "at", "by", "related"],
    ...Array.from({ length: AUDIT_ROWS }, (_, i) => ["pc-uuid", "Computer", "edited", "serial", String(i), String(i + 1), "", "", "", "", `2026-01-01T00:00:${i}`, "Eric"]),
  ],
  Config: [
    ["key", "value"],
    ["typesList", '[{"id":"Room","name":"Room"}]'],
    ["nextAssetNumber", "5"],
    ["hash_Assets", "ab12cd"],                          // not JSON, and must not come across
    ["rev_assets", 7],
    ["authUsers", '[{"email":"Jane@School.test","name":"Jane","role":"viewer"}]'],
    ["handEdited", "{not json"],                         // kept as a string, with a warning
    ["futureKey", '{"x":1}'],                            // unknown to doGet: still preserved
  ],
};

// ---------------------------------------------------------------- pure
const snap = snapshotFromGrids(gas, grids);
const { tables, warnings } = snapshotToRows("school_a", snap);

check("doGet's own code built the snapshot", () => {
  assert.equal(snap.payload.assets.length, 5);
  assert.ok(snap.scriptVersion.startsWith("v"));
});
check("a legacy asset with no id is keyed by its label", () => {
  assert.ok(tables.assets.some((a) => a.id === "BCA0001" && a.type === "Building"));
});
check("a duplicate asset id keeps the first and warns", () => {
  assert.equal(tables.assets.length, 4);
  assert.equal(tables.assets.find((a) => a.id === "pc-uuid").label, "BCA0003");
  assert.ok(warnings.some((w) => w.includes('duplicate key "pc-uuid"')));
});
check("asset data keeps scalar fields and drops the child arrays", () => {
  const pc = tables.assets.find((a) => a.id === "pc-uuid");
  assert.deepEqual(pc.data.personIds, ["u1", "u2"]);
  assert.equal(pc.data.serial, 12345);
  assert.equal(pc.parent_id, "room-uuid");
  for (const k of ["comments", "changes", "maintenanceItems", "breakers", "unassignedCircuits", "floorPlanLinks"]) {
    assert.ok(!(k in pc.data), `data still carries ${k}`);
  }
});
check("a blank work-entry id is minted deterministically", () => {
  const minted = tables.changes.find((c) => c.data.note === "pre-v34 row");
  assert.match(minted.id, /^imp-[0-9a-f]{32}$/);
  assert.equal(minted.data.id, minted.id);
  const again = snapshotToRows("school_a", snapshotFromGrids(gas, grids)).tables.changes.find((c) => c.data.note === "pre-v34 row");
  assert.equal(again.id, minted.id);
});
check("circuits: on a breaker, and unassigned with a null breaker", () => {
  assert.equal(tables.circuits.find((c) => c.id === "c-1").breaker_id, "b-1");
  assert.equal(tables.circuits.find((c) => c.id === "c-2").breaker_id, null);
  assert.ok(!("circuits" in tables.breakers[0].data));
  assert.deepEqual(tables.circuits.find((c) => c.id === "c-1").data.sharedNeutralWithIds, ["c-2"]);
});
check("a breaker whose panel does not exist is dropped, as doGet drops it", () => {
  assert.ok(!tables.breakers.some((b) => b.id === "b-orphan"));
});
check("the WHOLE audit log comes across, in order", () => {
  assert.equal(tables.audit_log.length, AUDIT_ROWS);
  assert.equal(tables.audit_log[0].data.from, "0");
  assert.equal(tables.audit_log[AUDIT_ROWS - 1].data.from, String(AUDIT_ROWS - 1));
});
check("photos: kind defaults to image, hidden flag is a real boolean", () => {
  const p1 = tables.photos.find((p) => p.id === "p-1");
  assert.equal(p1.kind, "image");
  assert.equal(p1.hidden_from_public, true);
  assert.equal(tables.photos.find((p) => p.id === "p-2").kind, "pdf");
});
check("config: every key but hashes, revisions and the allowlist; bad JSON kept as text", () => {
  const keys = tables.config.map((c) => c.key).sort();
  assert.deepEqual(keys, ["futureKey", "handEdited", "nextAssetNumber", "typesList"]);
  assert.equal(tables.config.find((c) => c.key === "handEdited").value, "{not json");
  assert.equal(tables.config.find((c) => c.key === "nextAssetNumber").value, 5);
  assert.ok(warnings.some((w) => w.includes('"handEdited"')));
});
check("revisions come from the rev_ keys", () => {
  assert.equal(tables.revisions.find((r) => r.domain === "assets").rev, 7);
});
check("the allowlist is lower-cased and always holds the owner as editor", () => {
  const byEmail = Object.fromEntries(tables.auth_users.map((u) => [u.email, u]));
  assert.equal(byEmail["jane@school.test"].role, "viewer");
  assert.equal(byEmail[snap.ownerEmail].role, "editor");
});
check("floor plan rows keep their shape ids, wall segments included", () => {
  assert.deepEqual(tables.space_links.map((l) => l.shape_id), ["s1", "s1#e2"]);
  assert.equal(tables.space_groups[0].data.hideLabel, true);
});
check("every row carries the tenant", () => {
  for (const [t, rows] of Object.entries(tables)) rows.forEach((r) => assert.equal(r.tenant_id, "school_a", t));
});
check("an inventory string cannot end the SQL literal early", () => {
  const evil = snapshotToRows("school_a", snapshotFromGrids(gas, {
    ...grids,
    Comments: [["assetLabel", "text", "at", "by"], ["pc-uuid", "$j$'); drop table assets; --", "", ""]],
  }));
  const sql = loadSql({ id: "school_a", name: "A", ownerEmail: "o@a" }, evil.tables);
  assert.ok(sql.includes("drop table assets"));   // present, but only inside the quoted JSON
  assert.ok(!/^\s*drop table/m.test(sql));
});

// ---------------------------------------------------------------- load
const psql = (sql, extra = []) => {
  const r = spawnSync("psql", [process.env.DATABASE_URL, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", ...extra], {
    input: sql, encoding: "utf8", maxBuffer: 1 << 30,
    env: { ...process.env, PGOPTIONS: "-c client_min_messages=warning" },
  });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
};

if (process.env.DATABASE_URL) {
  const tenant = (id) => ({ id, name: id, ownerEmail: snap.ownerEmail, cloudinaryFolder: null });
  const countsFor = (id) => psql(
    `select string_agg(t || '=' || n, ' ' order by t collate "C") from (` +
    Object.keys(tables).map((t) => `select '${t}' t, count(*) n from asset_tracker.${t} where tenant_id = '${id}'`).join(" union all ") +
    `) x;`);
  const expected = Object.entries(tables).map(([t, r]) => `${t}=${r.length}`).sort().join(" ");

  check("the load lands every row", () => {
    psql(loadSql(tenant("school_a"), tables), ["--single-transaction"]);
    assert.equal(countsFor("school_a"), expected);
  });
  check("a second load replaces rather than duplicates", () => {
    psql(loadSql(tenant("school_a"), tables), ["--single-transaction"]);
    assert.equal(countsFor("school_a"), expected);
  });
  check("loading one tenant leaves another untouched", () => {
    const b = snapshotToRows("school_b", snap).tables;
    psql(loadSql(tenant("school_b"), b), ["--single-transaction"]);
    psql(loadSql(tenant("school_a"), tables), ["--single-transaction"]);
    assert.equal(countsFor("school_b"), expected);
  });
  check("audit seq follows append order", () => {
    const froms = psql(`select string_agg(data->>'from', ',' order by seq) from asset_tracker.audit_log where tenant_id = 'school_a';`);
    assert.equal(froms, Array.from({ length: AUDIT_ROWS }, (_, i) => String(i)).join(","));
  });
  check("a failing load changes nothing", () => {
    const broken = { ...tables, comments: [...tables.comments, { tenant_id: "school_a", asset_id: "no-such-asset", position: 0, data: {} }] };
    assert.throws(() => psql(loadSql(tenant("school_a"), broken), ["--single-transaction"]));
    assert.equal(countsFor("school_a"), expected);
  });
} else {
  console.log("· DATABASE_URL not set: skipped the load checks.");
}

console.log(process.exitCode ? "✗ import checks failed" : `✓ ${passed} import checks passed`);
