// The save: doPost's no-op branch in AssetTrackerSync.gs, ported in the shape
// DATABASE_BACKEND_PLAN.md ("Transaction shape for a save") lays out. Two body
// shapes, one transaction:
//   - `assets`: the WHOLE snapshot, as the Sheet takes it. Domain-checked.
//     Older builds, and anything else that posts a full list, take this path.
//   - `assetChanges`: per-record (Phase 2b). Only the assets that changed, each
//     with the version it was edited from, refused only when THAT asset moved.
// Either way only rows that actually differ are written.
//
// The order is the .gs order, and each step's reason is the .gs reason:
//   1. lock      -- FOR UPDATE on the tenant's revision rows. One save at a
//                   time per tenant, as the script lock was; reads never wait.
//   2. authorize -- inside the lock, so a removal takes effect on the next save.
//   3. conflict  -- a domain this save writes that has moved on => write NOTHING,
//                   not even the audit rows (they describe the rejected change).
//   4. guards    -- an empty list over a populated table is refused.
//   5. write     -- each dirty domain diffed against what is stored.
//   6. audit     -- appended from the client's offset (auditBase).
//   7. bump      -- only the domains written.

import type { DiagEntry, Tx } from "./db.ts";
import { type Auth, authorizeSession, readUsers, sanitizeUsers, ROLE_EDITOR } from "./auth.ts";
import { REVISION_DOMAINS } from "./inventory.ts";
import { customColumnKeys, shapeAssets, shapeAuditRows, shapeBreakerTypes, shapePhotos } from "./save-shape.ts";
import { snapshotToRows } from "../_shared/snapshot-rows.mjs";

// deno-lint-ignore no-explicit-any
type Body = Record<string, any>;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

// acquireLock_(10000): how long a save queues behind another before it is
// answered busy rather than left hanging.
export const LOCK_TIMEOUT_MS = 10000;

// The config keys a config save restates from the body, with what an absent one
// is written as. Every other stored key is left alone (the .gs rewrote the tab
// and dropped them; nothing reads them, and keeping a key costs nothing).
const CONFIG_WRITES: [string, () => unknown][] = [
  ["columns", () => []], ["changeTypes", () => []], ["vendors", () => []],
  ["peripheralsList", () => []], ["usersList", () => []], ["bulkItemTypes", () => []],
  ["typesList", () => []], ["typeSettings", () => ({})], ["typeCategories", () => []],
];

// Each table a save rewrites: its key, and its columns as jsonb_to_recordset
// types (the same names as db/load-sql.mjs's TABLE_COLUMNS; api_test.ts checks).
export const SYNC_TABLES: Record<string, { key: string[]; cols: Record<string, string> }> = {
  assets: { key: ["id"], cols: { id: "text", position: "integer", label: "text", tag: "text", type: "text", parent_id: "text", data: "jsonb" } },
  comments: { key: ["asset_id", "position"], cols: { asset_id: "text", position: "integer", data: "jsonb" } },
  allocations: { key: ["asset_id", "position"], cols: { asset_id: "text", position: "integer", data: "jsonb" } },
  changes: { key: ["id"], cols: { id: "text", asset_id: "text", position: "integer", data: "jsonb" } },
  maintenance: { key: ["id"], cols: { id: "text", asset_id: "text", position: "integer", data: "jsonb" } },
  breakers: { key: ["id"], cols: { id: "text", panel_id: "text", position: "integer", data: "jsonb" } },
  circuits: { key: ["id"], cols: { id: "text", panel_id: "text", breaker_id: "text", position: "integer", data: "jsonb" } },
  space_links: { key: ["plan_asset_id", "shape_id"], cols: { plan_asset_id: "text", shape_id: "text", position: "integer", data: "jsonb" } },
  space_groups: { key: ["id"], cols: { id: "text", plan_asset_id: "text", position: "integer", data: "jsonb" } },
  breaker_types: { key: ["id"], cols: { id: "text", position: "integer", data: "jsonb" } },
  photos: {
    key: ["id"],
    cols: { id: "text", owner_type: "text", owner_id: "text", kind: "text", hidden_from_public: "boolean", position: "integer", data: "jsonb" },
  },
};
const ASSET_TABLES = ["assets", "comments", "allocations", "changes", "maintenance", "breakers", "circuits", "space_links", "space_groups"];
// The column naming the asset each table's rows belong to, for a per-record
// save's scoped write.
const OWNER_COLUMN: Record<string, string> = {
  assets: "id", comments: "asset_id", allocations: "asset_id", changes: "asset_id", maintenance: "asset_id",
  breakers: "panel_id", circuits: "panel_id", space_links: "plan_asset_id", space_groups: "plan_asset_id",
};

// Makes the table hold exactly `rows`: deletes what is not posted, inserts what
// is new, and updates only a row whose columns actually differ. One statement,
// the rows travelling as one jsonb parameter. Returns how many rows moved.
//
// With `owners`, the delete is SCOPED: only rows belonging to one of those
// assets can be removed. That is a per-record save -- a row of an asset the
// save does not name is not the save's to delete.
async function syncTable(tx: Tx, table: string, rows: Row[], owners?: string[]): Promise<number> {
  const { key, cols } = SYNC_TABLES[table];
  const names = Object.keys(cols);
  const shape = names.map((c) => `${c} ${cols[c]}`).join(", ");
  const rest = names.filter((c) => !key.includes(c));
  const match = key.map((k) => `i.${k} = t.${k}`).join(" and ");
  const scope = owners ? `t.${OWNER_COLUMN[table]} = any($2::text[]) and ` : "";
  // tx.json, not JSON.stringify: postgres.js serializes a jsonb parameter
  // itself, and a pre-stringified one would arrive as one JSON string.
  const payload = tx.json(rows.map((r) => Object.fromEntries(names.map((c) => [c, r[c] ?? null]))));
  const [moved] = await tx.unsafe(`
    with incoming as (select * from jsonb_to_recordset($1::jsonb) as x(${shape})),
    gone as (
      delete from ${table} t where ${scope}not exists (select 1 from incoming i where ${match})
      returning 1
    ),
    put as (
      insert into ${table} (tenant_id, ${names.join(", ")})
        select current_tenant(), ${names.join(", ")} from incoming
      on conflict (tenant_id, ${key.join(", ")}) do update
        set ${rest.map((c) => `${c} = excluded.${c}`).join(", ")}
        where (${rest.map((c) => `${table}.${c}`).join(", ")}) is distinct from (${rest.map((c) => `excluded.${c}`).join(", ")})
      returning 1
    )
    select (select count(*) from gone)::int + (select count(*) from put)::int as n`, owners ? [payload, owners] : [payload]);
  return moved.n;
}

const rowsFor = (tenantId: string, payload: Row): { tables: Record<string, Row[]>; warnings: string[] } =>
  snapshotToRows(tenantId, {
    payload: { assets: [], breakerTypes: [], photos: [], auditLog: [], revisions: {}, ...payload },
    configRaw: {}, authUsers: [], tabHashPrefix: "hash_", revisionPrefix: "rev_",
  });

export type SaveContext = {
  tenantId: string; ownerEmail: string; now: number; diag: DiagEntry[]; stages: string[];
  lockTimeoutMs?: number; email?: string;
};

export async function saveInventory(tx: Tx, body: Body, ctx: SaveContext): Promise<Row> {
  const { tenantId, ownerEmail, now, diag, stages } = ctx;
  const dirty = body._dirty || { assets: true, config: true, breakerTypes: true, photos: true };

  // 1. The lock. The rows are created on a tenant's first save, then held.
  await tx.unsafe(`set local lock_timeout = '${Math.floor(ctx.lockTimeoutMs ?? LOCK_TIMEOUT_MS)}ms'`);
  await tx`insert into revisions (tenant_id, domain, rev)
    select current_tenant(), d, 0 from unnest(${REVISION_DOMAINS}::text[]) as d
    on conflict do nothing`;
  const stored: Record<string, number> = {};
  for (const r of await tx`select domain, rev from revisions order by domain for update`) stored[r.domain] = Number(r.rev) > 0 ? Math.floor(r.rev) : 0;
  stages.push("lock acquired");

  // 2. Who, and may they write.
  const users = await readUsers(tx, ownerEmail);
  const auth: Auth = await authorizeSession(tx, body.sessionId, users, now, diag);
  if (!auth.ok) return { ok: false, authFailed: true, reason: auth.reason, email: auth.email || "", error: auth.error };
  if (auth.role !== ROLE_EDITOR) {
    diag.push({ event: "auth_failed", email: auth.email, reason: "readonly" });
    return { ok: false, authFailed: true, reason: "readonly", error: "Your access is view-only, so that change wasn't saved." };
  }
  stages.push("authorized");
  ctx.email = auth.email;

  const revisions = Object.fromEntries(REVISION_DOMAINS.map((d) => [d, stored[d] || 0]));
  const changes = readAssetChanges(body);

  // 3. Optimistic concurrency, per domain, only for what this save writes and
  //    only where the client said which revision it holds.
  const posted = body._revisions;
  if (posted) {
    const conflict = REVISION_DOMAINS.filter((d) => {
      if (!dirty[d]) return false;
      // A per-record save is checked per asset instead (below), which is the
      // whole point: someone saving a DIFFERENT asset is not a conflict.
      if (d === "assets" && changes) return false;
      const p = Number(posted[d]);
      return isFinite(p) && Math.floor(p) !== revisions[d];
    });
    if (conflict.length) {
      diag.push({
        event: "conflict", email: auth.email,
        detail: conflict.map((d) => `${d} posted ${Math.floor(Number(posted[d]))}, stored ${revisions[d]}`).join("; "),
      });
      return { ok: false, conflict, revisions };
    }
  }

  // 3b. Per record: each asset the save names, against its stored version.
  //     A new asset (no version posted) must not exist yet -- which is also
  //     what makes a retried request harmless. A removal of one already gone
  //     is not a conflict.
  let storedById = new Map<string, Row>();
  if (changes) {
    const ids = [...changes.upsert.map((a) => a.id), ...changes.remove.map((r) => r.id)];
    storedById = new Map((await tx`select id, rev, position from assets where id = any(${ids}::text[])`).map((r: Row) => [r.id, r]));
    const moved = (posted: unknown, s: Row | undefined) =>
      posted === undefined || posted === null ? !!s : !s || Number(s.rev) !== Math.floor(Number(posted));
    const conflictIds = [
      ...changes.upsert.filter((a) => moved(a.rev, storedById.get(a.id))).map((a) => a.id),
      ...changes.remove.filter((r) => storedById.has(r.id) && moved(r.rev, storedById.get(r.id))).map((r) => r.id),
    ];
    if (conflictIds.length) {
      diag.push({ event: "conflict", email: auth.email, detail: "assets changed since loaded: " + conflictIds.slice(0, 5).join(", ") + (conflictIds.length > 5 ? ` (+${conflictIds.length - 5} more)` : "") });
      return { ok: false, conflict: ["assets"], conflictIds, revisions };
    }
    // Every asset removed and nothing left: the same jump to zero the
    // full-snapshot guard below refuses.
    if (changes.remove.length && body.confirmEmptyAssets !== true) {
      const [{ n }] = await tx`select count(*)::int as n from assets`;
      const removing = changes.remove.filter((r) => storedById.has(r.id)).length;
      if (n > 0 && removing === n && !changes.upsert.length) {
        diag.push({ event: "refused", email: auth.email, reason: "emptyAssets", detail: n + " rows on the tab" });
        return {
          ok: false, refused: "emptyAssets", existingRows: n,
          error: "Refused: this save would have deleted all " + n + " assets at once. Nothing was changed. If that was genuinely intended, "
            + "it has to be done deliberately rather than as a side effect of a save.",
        };
      }
    }
  }

  // 4. In a full-overwrite save, "the client sent nothing" and "delete
  //    everything" are the same request -- the 2026-08-21 incident. Only the
  //    jump straight to zero, and confirmEmpty* says it was meant.
  const assets = Array.isArray(body.assets) ? body.assets : [];
  if (dirty.assets && !changes && assets.length === 0 && body.confirmEmptyAssets !== true) {
    const [{ n }] = await tx`select count(*)::int as n from assets`;
    if (n > 0) {
      diag.push({ event: "refused", email: auth.email, reason: "emptyAssets", detail: n + " rows on the tab" });
      return {
        ok: false, refused: "emptyAssets", existingRows: n,
        error: "Refused: this save would have deleted all " + n + " assets at once. Nothing was changed. If that was genuinely intended, "
          + "it has to be done deliberately rather than as a side effect of a save.",
      };
    }
  }
  const photos = Array.isArray(body.photos) ? body.photos : [];
  if (dirty.photos && photos.length === 0 && body.confirmEmptyPhotos !== true) {
    const [{ n }] = await tx`select count(*)::int as n from photos`;
    if (n > 0) {
      diag.push({ event: "refused", email: auth.email, reason: "emptyPhotos", detail: n + " rows on the tab" });
      return {
        ok: false, refused: "emptyPhotos", existingRows: n,
        error: "Refused: this save would have removed all " + n + " photo records at once. Nothing was changed.",
      };
    }
  }

  // 5. The domains. Shaped exactly as the Sheet would store them, turned into
  //    rows by the importer's own code, then diffed against the tables.
  const warnings: string[] = [];
  const sync = async (tables: string[], payload: Row) => {
    const built = rowsFor(tenantId, payload);
    warnings.push(...built.warnings);
    for (const t of tables) stages.push(`${t} ${await syncTable(tx, t, built.tables[t])} moved`);
  };
  let assetRevs: Record<string, number> | undefined;
  if (dirty.assets || changes) {
    let storedColumns: unknown = null;
    if (!Array.isArray(body.columns)) [{ value: storedColumns } = { value: null }] = await tx`select value from config where key = 'columns'`;
    const keys = customColumnKeys(body.columns, storedColumns);
    if (!changes) {
      await sync(ASSET_TABLES, { assets: shapeAssets(assets, keys) });
    } else {
      // Built by the same code as a full save, from just the named assets,
      // then written SCOPED to them. An existing asset keeps its place in the
      // list; a new one goes on the end, in the order sent.
      const built = rowsFor(tenantId, { assets: shapeAssets(changes.upsert, keys) });
      warnings.push(...built.warnings);
      const [{ max }] = await tx`select coalesce(max(position), -1)::int as max from assets`;
      let next = max + 1;
      for (const r of built.tables.assets) {
        const s = storedById.get(r.id);
        r.position = s ? s.position : next++;
      }
      const owners = [...changes.upsert.map((a) => a.id), ...changes.remove.map((r) => r.id)];
      for (const t of ASSET_TABLES) stages.push(`${t} ${await syncTable(tx, t, built.tables[t], owners)} moved`);
      // After the writes, so the triggers (0007) have already moved them.
      const upsertIds = changes.upsert.map((a) => a.id);
      assetRevs = Object.fromEntries((await tx`select id, rev from assets where id = any(${upsertIds}::text[])`)
        .map((r: Row) => [r.id, Number(r.rev)]));
    }
  }

  // 6. Append-only. `auditBase` is how many rows sit before the client's first;
  //    comparing against the table's own count is what makes a repeated save
  //    append nothing the second time (appendNewRows_).
  //    A per-record save sends `auditAppend` instead: only the entries it
  //    added, appended as sent. The offset cannot work there, since two saves
  //    of different assets both land and the count moves between them; a
  //    retry is refused by the per-asset check before it gets here.
  const appendOnly = Array.isArray(body.auditAppend);
  const auditLog = appendOnly ? body.auditAppend : Array.isArray(body.auditLog) ? body.auditLog : [];
  let startAt = 0;
  if (!appendOnly) {
    const [{ n: existing }] = await tx`select count(*)::int as n from audit_log`;
    startAt = existing - (Math.floor(Number(body.auditBase)) || 0);
  }
  if (startAt < auditLog.length) {
    const fresh = rowsFor(tenantId, { auditLog: shapeAuditRows(auditLog.slice(Math.max(0, startAt))) }).tables.audit_log;
    await tx`insert into audit_log (tenant_id, asset_id, at, by, action, data)
      select current_tenant(), e.v->>'asset_id', e.v->>'at', e.v->>'by', e.v->>'action', e.v->'data'
      from jsonb_array_elements(${tx.json(fresh)}::jsonb) with ordinality as e(v, n)
      order by e.n`;
    stages.push(`audit ${fresh.length} appended`);
  }

  if (dirty.breakerTypes) {
    await sync(["breaker_types"], { breakerTypes: shapeBreakerTypes(Array.isArray(body.breakerTypes) ? body.breakerTypes : []) });
  }
  if (dirty.photos) await sync(["photos"], { photos: shapePhotos(photos) });

  if (dirty.config) {
    // nextAssetNumber is monotonic server-side too: a stale or older client
    // posting a lower number must not walk it back and reissue a label.
    const [{ value: storedNext } = { value: null }] = await tx`select value from config where key = 'nextAssetNumber'`;
    const values: [string, unknown][] = CONFIG_WRITES.map(([k, empty]) => [k, body[k] || empty()]);
    values.push(["nextAssetNumber", Math.max(Number(body.nextAssetNumber) || 0, Number(storedNext) || 0)]);
    await tx`insert into config (tenant_id, key, value)
      select current_tenant(), e.v->>0, e.v->1 from jsonb_array_elements(${tx.json(values)}::jsonb) as e(v)
      on conflict (tenant_id, key) do update set value = excluded.value where config.value is distinct from excluded.value`;

    // The allowlist is PRESERVED unless this save carries one: absent means
    // "leave it alone", or one save from an old client would lock everyone
    // but the owner out. Anyone dropped has their sessions ended now.
    if (Array.isArray(body.authUsers)) {
      const next = sanitizeUsers(body.authUsers, ownerEmail);
      const kept = new Set(next.map((u) => u.email));
      const dropped = users.map((u) => u.email).filter((e) => !kept.has(e));
      if (dropped.length) await tx`delete from sessions where email = any(${dropped}::text[])`;
      await tx`delete from auth_users`;
      await tx`insert into auth_users (tenant_id, email, role, name, position)
        select current_tenant(), e.v->>'email', e.v->>'role', e.v->>'name', (e.n - 1)::int
        from jsonb_array_elements(${tx.json(next)}::jsonb) with ordinality as e(v, n)`;
    }
    stages.push("config written");
  }

  // 7. Bump only what was written, so an assets-only save does not invalidate
  //    a config snapshot someone else is holding.
  const written = REVISION_DOMAINS.filter((d) => dirty[d] || (d === "assets" && changes));
  if (written.length) {
    await tx`update revisions set rev = rev + 1 where domain = any(${written}::text[])`;
    for (const d of written) revisions[d] += 1;
  }

  // The .gs would have stored a duplicate or a blank-id record as it stood;
  // a table key cannot, so the first is kept and a blank id minted. Said once.
  if (warnings.length) diag.push({ event: "save_adjusted", email: auth.email, detail: warnings.slice(0, 3).join(" | ") + (warnings.length > 3 ? ` (+${warnings.length - 3} more)` : "") });

  return assetRevs ? { ok: true, revisions, assetRevs } : { ok: true, revisions };
}

// A per-record save's `assetChanges`, cleaned: every entry an object with an
// id (an asset's key is `id || label`, as everywhere), the version it posted
// as `rev`, and a duplicate id kept once -- the first, as a full save keeps it.
// Null when the body is a full snapshot, or names no asset.
function readAssetChanges(body: Body): { upsert: Row[]; remove: { id: string; rev: unknown }[] } | null {
  const c = body.assetChanges;
  if (!c || typeof c !== "object" || Array.isArray(c)) return null;
  const seen = new Set<string>();
  const upsert: Row[] = [];
  for (const a of Array.isArray(c.upsert) ? c.upsert : []) {
    if (!a || typeof a !== "object") continue;
    const id = String(a.id || a.label || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const { _rev, ...record } = a;
    upsert.push({ ...record, id, rev: _rev });
  }
  const remove: { id: string; rev: unknown }[] = [];
  for (const r of Array.isArray(c.remove) ? c.remove : []) {
    const id = r && String(r.id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    remove.push({ id, rev: r._rev });
  }
  // Nothing named is not a per-record save at all: the body then carries no
  // asset change, and must not bump the assets revision for one.
  return upsert.length || remove.length ? { upsert, remove } : null;
}
