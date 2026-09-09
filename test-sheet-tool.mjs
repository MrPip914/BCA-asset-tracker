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
import { gridToRows, rowsToValues, unknownKeys, colLetter } from "./sheet.mjs";
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

if (!process.exitCode) console.log(`✓ ${passed} tests passed`);
