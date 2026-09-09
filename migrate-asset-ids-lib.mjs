// The pure half of migrate-asset-ids.mjs — everything that decides WHAT changes,
// with no network in it, so it can be tested against fixtures rather than
// rehearsed against a live Sheet. See that file for why the migration exists and
// why both files are disposable.

// Every column, anywhere, that holds an asset key. Getting this list wrong is
// the whole risk: a column left out keeps pointing at an id that no longer
// exists, and nothing at read time would say so — the reference just resolves to
// nothing and the app renders "(deleted asset)".
export const KEY_COLUMNS = {
  Assets: ["parentId", "personIds"],   // `id` is handled separately: it is the thing being replaced
  Comments: ["assetLabel"],
  Changes: ["assetLabel"],
  Allocations: ["assetLabel", "room"],
  Maintenance: ["assetLabel"],
  Breakers: ["panelLabel"],
  Circuits: ["panelLabel", "feedsPanelLabel", "roomsServed"],
  AuditLog: ["assetLabel", "related"],
};

// Columns holding several keys in one cell, comma-joined.
export const LIST_COLUMNS = new Set([
  "Assets.personIds",
  "Circuits.roomsServed",
  "AuditLog.related",
]);

// A v4 uuid as crypto.randomUUID() emits it. Used only to tell "already
// migrated" from "still a legacy label" — deliberately strict, because a loose
// test that accepted a label would skip exactly the rows this exists to fix.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v) => UUID_RE.test(String(v || "").trim());

// `related` is comma-joined "<id>:<role>" pairs. Split on the LAST colon, the
// same way parseRelated() does in index.html, so an id containing one survives.
function splitRelated(pair) {
  const i = pair.lastIndexOf(":");
  return i === -1 ? { id: pair, role: "" } : { id: pair.slice(0, i), role: pair.slice(i + 1) };
}

// Builds the old-key -> new-uuid map and counts what it would touch. Reads
// nothing and writes nothing.
export function remapPlan(tabs, newId) {
  const errors = [];
  const assets = tabs.Assets?.rows || [];
  if (!assets.length) errors.push("The Assets tab is empty — nothing to migrate.");
  if (!(tabs.Assets?.headers || []).includes("id")) {
    errors.push('The Assets tab has no "id" column. Deploy v31+ and let one save land first.');
  }

  const map = new Map();
  let alreadyUuid = 0;
  const seen = new Set();
  assets.forEach((a, i) => {
    const key = String(a.id ?? "").trim();
    if (!key) { errors.push(`Assets row ${i + 2} has an empty id — migrate nothing until that is fixed.`); return; }
    if (seen.has(key)) { errors.push(`Two assets share the id "${key}" — refusing to remap an ambiguous key.`); return; }
    seen.add(key);
    if (isUuid(key)) { alreadyUuid++; return; }
    map.set(key, newId());
  });

  // What every reference will be checked against afterwards: the ids that will
  // exist. A reference to something outside this set pointed nowhere already.
  const known = new Set([...seen].map((k) => map.get(k) || k));
  const counts = {};
  const dangling = [];
  const danglingIds = new Set();

  for (const [tab, cols] of Object.entries(KEY_COLUMNS)) {
    for (const col of cols) {
      const where = `${tab}.${col}`;
      counts[where] = 0;
      (tabs[tab]?.rows || []).forEach((row, i) => {
        const raw = String(row[col] ?? "").trim();
        if (!raw) return;
        const parts = LIST_COLUMNS.has(where) ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [raw];
        parts.forEach((p) => {
          const id = col === "related" ? splitRelated(p).id : p;
          if (!id) return;
          if (map.has(id)) counts[where]++;
          else if (!known.has(id)) {
            danglingIds.add(id);
            if (dangling.length < 200) dangling.push(`${tab} row ${i + 2} ${col}: ${id}`);
          }
        });
      });
    }
  }

  return { map, counts, dangling, danglingIds, errors, remapped: map.size, alreadyUuid };
}

// Applies a plan, returning NEW tab objects. Never mutates its input, so a
// caller can compare before and after.
export function applyPlan(tabs, plan) {
  const { map } = plan;
  const sub = (id) => map.get(id) || id;
  const out = {};

  for (const [tab, { headers, rows }] of Object.entries(tabs)) {
    out[tab] = {
      headers,
      rows: rows.map((row) => {
        const next = { ...row };
        if (tab === "Assets") next.id = sub(String(row.id ?? "").trim());
        for (const col of KEY_COLUMNS[tab] || []) {
          const raw = String(row[col] ?? "").trim();
          if (!raw) continue;
          if (!LIST_COLUMNS.has(`${tab}.${col}`)) { next[col] = sub(raw); continue; }
          next[col] = raw.split(",").map((s) => s.trim()).filter(Boolean).map((p) => {
            if (col !== "related") return sub(p);
            const { id, role } = splitRelated(p);
            // Role preserved exactly: it is what makes an entry read correctly
            // from each asset it names, and it is not a key.
            return role ? `${sub(id)}:${role}` : sub(id);
          }).join(",");
        }
        return next;
      }),
    };
  }
  return out;
}
