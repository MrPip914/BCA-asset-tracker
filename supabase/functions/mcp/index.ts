// The Claude connector: a remote MCP server, as a Supabase Edge Function.
// See /mnt/project-files/evaluations/claude-connector.md for why, and
// CLAUDE.md "Claude connector" for the rules.
//
// THIS DOES NOT ANSWER ANYONE YET. Sign-in (OAuth with Google, checked against
// each site's allowlist) is the next piece, and until it exists `whoIs()`
// returns nobody, so every request is refused with 401. That is deliberate:
// the alternative is an inventory readable by anyone holding the URL.
//
// Everything that decides an answer lives in plain JS beside this file
// (protocol.js, tools.js, inventory.js, from-app.js) so Node can test it with
// no Deno and no database. This file is only HTTP and SQL.
//
// Secrets (Supabase > Edge Functions > Secrets):
//   MCP_DATABASE_URL  a LOGIN role that is a member of asset_api -- never the
//                     service role, which skips row-level security.
//   MCP_TENANT_IDS    comma-separated tenants this connector serves (default "dev").

import postgres from "npm:postgres@3.4.5";
import { handleMcp } from "./protocol.js";
import { roleFor } from "./tools.js";

const sql = postgres(Deno.env.get("MCP_DATABASE_URL") ?? "", {
  max: 3,
  prepare: false, // Supabase's pooler runs in transaction mode
  idle_timeout: 20,
});

const TENANT_IDS = (Deno.env.get("MCP_TENANT_IDS") ?? "dev").split(",").map((s) => s.trim()).filter(Boolean);

// The columns each table is read with. Everything a tool needs, nothing else.
const TABLE_SQL: Record<string, string> = {
  assets: "select id, position, parent_id, data from asset_tracker.assets",
  config: "select key, value from asset_tracker.config",
  maintenance: "select id, asset_id, position, data from asset_tracker.maintenance",
  changes: "select id, asset_id, position, data from asset_tracker.changes",
  comments: "select asset_id, position, data from asset_tracker.comments",
  photos: "select id, owner_type, owner_id, kind, data from asset_tracker.photos",
  breakers: "select id, panel_id, position, data from asset_tracker.breakers",
  circuits: "select id, panel_id, breaker_id, position, data from asset_tracker.circuits",
  audit_log: "select seq, asset_id, data from asset_tracker.audit_log",
};

// Every read runs inside a transaction that first names its tenant, which is
// what row-level security keys on, then drops to asset_api (the raw
// connection would bypass RLS) and is declared READ ONLY, since asset_api
// holds write grants and this connector must never use them. Same shape as
// asset-api/db.ts's withTenant (PR #26); switch to importing that once it
// lands, keeping the read-only line.
function withTenant<T>(tenant: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`set transaction read only`;
    await tx`select set_config('app.tenant_id', ${tenant}, true)`;
    await tx`select set_config('search_path', 'asset_tracker, public', true)`;
    await tx`set local role asset_api`;
    return fn(tx);
  }) as Promise<T>;
}

async function load(tenant: string, table: string) {
  const q = TABLE_SQL[table];
  if (!q) throw new Error(`no loader for ${table}`);
  return withTenant(tenant, (tx) => tx.unsafe(q));
}

// The sites this email may see: owner or on the allowlist. Re-read on every
// request, so removing someone takes effect on their next question.
async function sitesFor(email: string) {
  const out = [];
  for (const id of TENANT_IDS) {
    const r = await withTenant(id, async (tx) => {
      const [tenant] = await tx`select id, name, owner_email from asset_tracker.tenants where id = ${id}`;
      if (!tenant) return null;
      const users = await tx`select email, role from asset_tracker.auth_users where email = ${email.toLowerCase()}`;
      const role = roleFor(email, tenant, users);
      return role ? { id, name: tenant.name, role } : null;
    });
    if (r) out.push(r);
  }
  return out;
}

// TODO(sign-in): verify the bearer token issued by this connector's own OAuth
// flow and return the email it names. Until then: nobody.
async function whoIs(_req: Request): Promise<string | null> {
  return null;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" }, { allow: "POST" });

  const email = await whoIs(req);
  if (!email) {
    return json(401, { error: "Sign-in required." }, { "www-authenticate": 'Bearer realm="asset-tracker"' });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }

  const sites = await sitesFor(email);
  const ctx = {
    sites,
    load: (tenant: string, table: string) => {
      // Defence in depth: tools.js already only opens sites from `sites`.
      if (!sites.some((s) => s.id === tenant)) throw new Error("site not permitted");
      return load(tenant, table);
    },
    log: (event: string, detail: unknown) => console.log(JSON.stringify({ event, detail })),
  };
  const out = await handleMcp(body, ctx);
  return json(out.status, out.body);
});
