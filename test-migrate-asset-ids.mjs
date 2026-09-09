// Tests for the one-time id migration's pure logic (migrate-asset-ids-lib.mjs).
//
// This is the only place it CAN be tested. The migration rewrites AuditLog,
// which is append-only and has no undo, so rehearsing it against a live Sheet is
// precisely the thing being avoided — and a wrong mapping there is silent and
// permanent afterwards. So the decision logic is separated from the network and
// driven against fixtures here instead.
import { remapPlan, applyPlan, isUuid } from "./migrate-asset-ids-lib.mjs";

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "PASS  " : "FAIL  ") + name + (ok || !detail ? "" : `\n        ${detail}`));
  ok ? pass++ : fail++;
};
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want),
    `got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);

// Deterministic ids, so an expectation can name them.
const seq = () => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`; };
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// A sheet in exactly the state Eric described: legacy ids adopted from labels on
// everything that predates v31, one uuid on an asset created since.
const REAL_UUID = "b81c60de-2f47-4a93-8e15-0d7c39ab6215";
function fixture() {
  return {
    Assets: {
      headers: ["id", "tag", "label", "name", "type", "parentId", "personIds"],
      rows: [
        { id: "BCR0006", tag: "", label: "BCR0006", name: "Room 102", type: "Room", parentId: "BCB0001", personIds: "" },
        { id: "BCB0001", tag: "", label: "BCB0001", name: "Building 100", type: "Building", parentId: "", personIds: "" },
        { id: "BCA0001", tag: "BCA0001", label: "BCA0001", name: "Front Desk PC", type: "Computer", parentId: "BCR0006", personIds: "BCA0090" },
        { id: "BCA0090", tag: "", label: "BCA0090", name: "Jen Kramer", type: "User", parentId: "", personIds: "" },
        { id: REAL_UUID, tag: "BCA0117", label: "", name: "New Laptop", type: "Computer", parentId: "BCR0006", personIds: "" },
      ],
    },
    Comments: { headers: ["assetLabel", "text"], rows: [{ assetLabel: "BCA0001", text: "note" }] },
    Changes: { headers: ["assetLabel", "note"], rows: [] },
    Allocations: { headers: ["assetLabel", "room", "quantity"], rows: [{ assetLabel: "BCA0050", room: "BCR0006", quantity: "8" }] },
    Maintenance: { headers: ["assetLabel", "task"], rows: [{ assetLabel: "BCA0001", task: "clean" }] },
    Breakers: { headers: ["id", "panelLabel"], rows: [{ id: "brk1", panelLabel: "BCA0082" }] },
    Circuits: {
      headers: ["id", "panelLabel", "feedsPanelLabel", "roomsServed"],
      rows: [{ id: "c1", panelLabel: "BCA0082", feedsPanelLabel: "", roomsServed: "BCR0006,BCB0001" }],
    },
    AuditLog: {
      headers: ["assetLabel", "action", "related"],
      rows: [
        { assetLabel: "BCA0001", action: "moved", related: "BCB0001:from,BCR0006:to" },
        { assetLabel: REAL_UUID, action: "created", related: "BCR0006:at" },
        { assetLabel: "BCA0001", action: "edited", related: "" },
      ],
    },
  };
}
// BCA0082 and BCA0050 are referenced but absent from Assets — pre-existing
// dangling references, which the migration must carry through untouched rather
// than "fix" or drop.

// --- uuid detection ---------------------------------------------------------
check("a real uuid is recognised", isUuid(REAL_UUID));
check("a legacy label is not a uuid", !isUuid("BCA0001"));
check("a near-miss is not a uuid", !isUuid("00000000-0000-0000-0000-000000000000"));
check("blank is not a uuid", !isUuid(""));

// --- the plan ---------------------------------------------------------------
{
  const plan = remapPlan(fixture(), seq());
  eq("no errors on a healthy sheet", plan.errors, []);
  check("four legacy assets are remapped", plan.remapped === 4, `got ${plan.remapped}`);
  check("the existing uuid is left alone", plan.alreadyUuid === 1 && !plan.map.has(REAL_UUID));
  // Three occurrences across two distinct ids: BCA0050 once (an allocation) and
  // BCA0082 twice (a breaker and a circuit both naming the missing panel).
  check("every dangling occurrence is reported", plan.dangling.length === 3,
    JSON.stringify(plan.dangling));
  check("...and they collapse to the two ids that are actually missing",
    plan.danglingIds.size === 2 && plan.danglingIds.has("BCA0050") && plan.danglingIds.has("BCA0082"),
    JSON.stringify([...plan.danglingIds]));
}

// --- refusals ---------------------------------------------------------------
{
  const f = fixture(); f.Assets.headers = f.Assets.headers.filter((h) => h !== "id");
  check("refuses a sheet with no id column", remapPlan(f, seq()).errors.some((e) => /no "id" column/.test(e)));
}
{
  const f = fixture(); f.Assets.rows[1].id = "";
  check("refuses an empty id", remapPlan(f, seq()).errors.some((e) => /empty id/.test(e)));
}
{
  const f = fixture(); f.Assets.rows[1].id = "BCR0006";
  check("refuses two assets sharing an id", remapPlan(f, seq()).errors.some((e) => /share the id/.test(e)));
}
{
  check("refuses an empty Assets tab",
    remapPlan({ Assets: { headers: ["id"], rows: [] } }, seq()).errors.some((e) => /empty/.test(e)));
}

// --- the rewrite ------------------------------------------------------------
{
  const tabs = fixture();
  const plan = remapPlan(tabs, seq());
  const out = applyPlan(tabs, plan);
  // Ids were minted in Assets row order: BCR0006=1, BCB0001=2, BCA0001=3, BCA0090=4.
  eq("the asset's own id is replaced", out.Assets.rows[0].id, U(1));
  eq("an existing uuid is untouched", out.Assets.rows[4].id, REAL_UUID);
  eq("parentId follows", out.Assets.rows[0].parentId, U(2));
  eq("personIds follows", out.Assets.rows[2].personIds, U(4));
  eq("a child row's assetLabel follows", out.Comments.rows[0].assetLabel, U(3));
  eq("an allocation's room follows", out.Allocations.rows[0].room, U(1));
  eq("a comma-joined list follows, in order", out.Circuits.rows[0].roomsServed, `${U(1)},${U(2)}`);
  eq("related keeps its roles", out.AuditLog.rows[0].related, `${U(2)}:from,${U(1)}:to`);
  eq("an audit row already on a uuid is untouched", out.AuditLog.rows[1].assetLabel, REAL_UUID);
  eq("...and its related still follows", out.AuditLog.rows[1].related, `${U(1)}:at`);
  eq("an empty related stays empty", out.AuditLog.rows[2].related, "");

  // The honest-carry-through rule.
  eq("a dangling assetLabel is carried through unchanged", out.Allocations.rows[0].assetLabel, "BCA0050");
  eq("a dangling panelLabel is carried through unchanged", out.Breakers.rows[0].panelLabel, "BCA0082");

  // Non-key data must survive untouched.
  eq("the tag is not touched", out.Assets.rows[2].tag, "BCA0001");
  eq("the label is not touched", out.Assets.rows[2].label, "BCA0001");
  eq("names are not touched", out.Assets.rows[0].name, "Room 102");
  eq("headers are preserved exactly", out.Assets.headers, fixture().Assets.headers);
  check("the input is not mutated", fixture().Assets.rows[0].id === "BCR0006" && tabs.Assets.rows[0].id === "BCR0006");
}

// --- idempotence: a second run must be a no-op ------------------------------
{
  const tabs = fixture();
  const once = applyPlan(tabs, remapPlan(tabs, seq()));
  const twice = applyPlan(once, remapPlan(once, seq()));
  eq("running it again changes nothing", twice, once);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
