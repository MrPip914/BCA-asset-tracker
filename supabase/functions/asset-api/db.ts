// Every query the API makes runs inside withTenant, and that is the whole
// tenancy story: the transaction names its tenant and drops to asset_api, so
// row-level security (db/migrations/0002) decides what it can see. A query that
// forgot its tenant would see nothing, not another school's rows.
//
// The connection itself is the project's own database URL, which is a role
// that bypasses RLS. That is why NOTHING may query outside this helper: the
// `set local role` below is what turns RLS on.

// deno-lint-ignore no-explicit-any
export type Sql = any;
// deno-lint-ignore no-explicit-any
export type Tx = any;

export async function withTenant<T>(sql: Sql, tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return await sql.begin(async (tx: Tx) => {
    await tx`select set_config('app.tenant_id', ${tenantId}, true), set_config('search_path', 'asset_tracker', true)`;
    await tx`set local role asset_api`;
    return await fn(tx);
  });
}

// --- Diagnostics (DIAG_FIELDS in AssetTrackerSync.gs) ------------------------
// Failures and session boundaries, never every request, and NEVER a session id.
// Written after the request's own transaction, in one of its own, and any
// failure is swallowed: logging exists to explain failures and must not become
// one.

export const DIAG_MAX_ROWS = 1000;
export const DIAG_TRIM_SLACK = 100;

export type DiagEntry = { event: string; op?: string; email?: string; reason?: string; detail?: string; ms?: number };

export async function writeDiag(sql: Sql, tenantId: string, entries: DiagEntry[], scriptVersion: string) {
  if (!entries.length) return;
  try {
    await withTenant(sql, tenantId, async (tx) => {
      for (const e of entries) {
        const clip = (v: unknown) => (v === undefined || v === null ? "" : String(v).slice(0, 500));
        await tx`insert into diagnostics (tenant_id, event, op, email, reason, detail, ms, script_version)
          values (${tenantId}, ${clip(e.event)}, ${clip(e.op)}, ${clip(e.email)}, ${clip(e.reason)},
                  ${clip(e.detail)}, ${e.ms === undefined ? null : Math.round(e.ms)}, ${scriptVersion})`;
      }
      // Once past the slack, back down to the newest DIAG_MAX_ROWS -- the same
      // trim the Sheet tab does, so a busy tenant is not trimmed on every row.
      await tx`delete from diagnostics
        where exists (select 1 from diagnostics order by seq desc offset ${DIAG_MAX_ROWS + DIAG_TRIM_SLACK} limit 1)
          and seq <= (select seq from diagnostics order by seq desc offset ${DIAG_MAX_ROWS} limit 1)`;
    });
  } catch (_err) {
    /* never let logging break the request it describes */
  }
}
