// Unit tests for sheet.mjs's pure logic — the parts that decide what actually
// lands in a cell.
//
// Same reason test-backend-fields.js and test-backend-admin.js exist: Sandbox
// never contacts a real backend, and there is no safe way to rehearse a
// destructive write against a live Sheet. The difference here is that sheet.mjs
// bypasses doPost entirely, so nothing downstream will catch a mistake — the
// Sheet's version history is the only backstop, and it is a manual one.
//
// The three rules under test are the ones whose failure is SILENT:
//   - header order is the sheet's, not the caller's  (a reorder re-labels data)
//   - an unknown key is refused, never dropped       (a typo would report success)
//   - a missing key writes "", never shifts the row  (a gap would misalign columns)
//
// Run: node test-sheet-tool.mjs   (exits non-zero on failure)
import { gridToRows, rowsToValues, unknownKeys, colLetter, buildScrubber } from "./sheet.mjs";
import assert from "node:assert";

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (err) { console.error(`✗ ${name}\n  ${err.message}`); process.exitCode = 1; }
}

test("gridToRows keys off the sheet's own header row", () => {
  const { headers, rows } = gridToRows([
    ["label", "name", "type"],
    ["DEV0001", "Room 100", "Room"],
  ]);
  assert.deepStrictEqual(headers, ["label", "name", "type"]);
  assert.deepStrictEqual(rows, [{ label: "DEV0001", name: "Room 100", type: "Room" }]);
});

test("gridToRows drops blank rows and pads short ones", () => {
  const { rows } = gridToRows([
    ["label", "name", "type"],
    ["DEV0001", "Room 100"],      // short row — Sheets omits trailing empties
    ["", "", ""],                  // blank row
    ["DEV0002", "Room 101", "Room"],
  ]);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].type, "", "a short row must pad, not leave undefined");
  assert.strictEqual(rows[1].label, "DEV0002");
});

test("gridToRows on a header-only tab yields headers and no rows", () => {
  const { headers, rows } = gridToRows([["key", "value"]]);
  assert.deepStrictEqual(headers, ["key", "value"]);
  assert.deepStrictEqual(rows, []);
});

test("rowsToValues follows the SHEET's header order, not the object's", () => {
  // The object lists its keys backwards. If insertion order ever won, every
  // column of every row would be written under the wrong header.
  const values = rowsToValues(
    ["label", "name", "type"],
    [{ type: "Room", name: "Room 100", label: "DEV0001" }]
  );
  assert.deepStrictEqual(values, [["DEV0001", "Room 100", "Room"]]);
});

test("rowsToValues writes an absent key as empty rather than shifting the row", () => {
  const values = rowsToValues(["label", "name", "type"], [{ label: "DEV0001", type: "Room" }]);
  assert.deepStrictEqual(values, [["DEV0001", "", "Room"]]);
});

test("rowsToValues stringifies, so a date-shaped value stays a string", () => {
  const values = rowsToValues(["lastPerformed", "quantity"], [{ lastPerformed: "2026-06-03", quantity: 12 }]);
  assert.deepStrictEqual(values, [["2026-06-03", "12"]]);
  values[0].forEach((v) => assert.strictEqual(typeof v, "string"));
});

test("rowsToValues treats null and undefined as empty", () => {
  assert.deepStrictEqual(
    rowsToValues(["a", "b"], [{ a: null, b: undefined }]),
    [["", ""]]
  );
});

test("unknownKeys catches a typo instead of letting it be dropped", () => {
  assert.deepStrictEqual(unknownKeys(["label", "name"], [{ label: "X", lable: "typo" }]), ["lable"]);
});

test("unknownKeys is empty for a well-formed write, including partial rows", () => {
  assert.deepStrictEqual(unknownKeys(["label", "name", "type"], [{ label: "X" }, { name: "Y" }]), []);
});

test("unknownKeys reports each bad key once across many rows", () => {
  const bad = unknownKeys(["label"], [{ oops: 1 }, { oops: 2 }, { alsoBad: 3 }]);
  assert.deepStrictEqual(bad.sort(), ["alsoBad", "oops"]);
});

test("colLetter is correct past Z", () => {
  assert.deepStrictEqual([0, 1, 25, 26, 27, 51, 52].map(colLetter), ["A", "B", "Z", "AA", "AB", "AZ", "BA"]);
});


// --------------------------------------------------------------- scrubbing
// The rule under test is the one whose failure is silent in the same way as the
// three above: a scrub that breaks STRUCTURE still produces a plausible-looking
// sheet, and the dev copy then fails to reproduce the very bugs it exists for.
// So these assert what must survive, not just what must change.

const SAMPLE = [
  { label: "BCA0001", type: "User", name: "Jen Kramer", parentId: "", personIds: "", serial: "", hostname: "" },
  { label: "BCA0002", type: "User", name: "Josh Runge", parentId: "", personIds: "", serial: "", hostname: "" },
  { label: "BCA0010", type: "Computer", name: "", parentId: "BCR0006", personIds: "BCA0001,BCA0002",
    person: "Jen Kramer / Josh Runge", serial: "5CD1234XYZ", hostname: "BCA-LAB-01", notes: "Jen's spare" },
];

test("scrubber maps a person to the same alias everywhere they appear", () => {
  const s = buildScrubber(SAMPLE, []);
  const user = s.scrub("Assets", SAMPLE[0]);
  const device = s.scrub("Assets", SAMPLE[2]);
  const audit = s.scrub("AuditLog", { by: "Jen Kramer", from: "", to: "Jen Kramer", note: "x" });
  assert.notStrictEqual(user.name, "Jen Kramer");
  assert.ok(device.person.startsWith(user.name), `${device.person} should start with ${user.name}`);
  assert.strictEqual(audit.by, user.name);
  assert.strictEqual(audit.to, user.name);
});

test("scrubber leaves every identifier and reference untouched", () => {
  const s = buildScrubber(SAMPLE, []);
  const device = s.scrub("Assets", SAMPLE[2]);
  assert.strictEqual(device.label, "BCA0010");
  assert.strictEqual(device.parentId, "BCR0006");
  assert.strictEqual(device.personIds, "BCA0001,BCA0002");
  assert.strictEqual(device.type, "Computer");
});

test("scrubber keeps a slash-joined person field slash-joined", () => {
  const s = buildScrubber(SAMPLE, []);
  const device = s.scrub("Assets", SAMPLE[2]);
  assert.strictEqual(device.person.split("/").length, 2, `got ${device.person}`);
});

test("scrubber replaces serial and hostname but keeps distinct ones distinct", () => {
  const s = buildScrubber(SAMPLE, []);
  const a = s.scrub("Assets", { type: "Computer", serial: "AAA", hostname: "host-a" });
  const b = s.scrub("Assets", { type: "Computer", serial: "BBB", hostname: "host-b" });
  const again = s.scrub("Assets", { type: "Computer", serial: "AAA", hostname: "host-a" });
  assert.notStrictEqual(a.serial, "AAA");
  assert.notStrictEqual(a.serial, b.serial);
  assert.strictEqual(a.serial, again.serial);
  assert.strictEqual(a.hostname, again.hostname);
});

test("scrubber blanks free text, which can name anyone", () => {
  const s = buildScrubber(SAMPLE, []);
  assert.strictEqual(s.scrub("Assets", SAMPLE[2]).notes, "");
  assert.strictEqual(s.scrub("Comments", { text: "Jen said it broke", by: "Jen Kramer" }).text, "(scrubbed)");
  assert.strictEqual(s.scrub("Changes", { note: "swapped for Jen", by: "" }).note, "");
});

test("scrubber covers a usersList name with no matching User asset", () => {
  // The pre-v28 legacy case: a name in the managed list that was never converted.
  const s = buildScrubber([], ["Larry Halderman"]);
  assert.notStrictEqual(s.scrubUsersList(["Larry Halderman"])[0], "Larry Halderman");
  assert.strictEqual(s.scrubUsersList(["Larry Halderman"])[0], s.scrub("AuditLog", { by: "Larry Halderman" }).by);
});

test("scrubber leaves a from/to value that names no person alone", () => {
  const s = buildScrubber(SAMPLE, []);
  const moved = s.scrub("AuditLog", { by: "", from: "Room 100", to: "Room 101" });
  assert.strictEqual(moved.from, "Room 100");
  assert.strictEqual(moved.to, "Room 101");
});

if (!process.exitCode) console.log(`✓ ${passed} tests passed`);
