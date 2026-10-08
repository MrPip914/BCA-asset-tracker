// The Claude connector: a remote MCP server, as a Supabase Edge Function.
// See /mnt/project-files/evaluations/claude-connector.md for why, and
// CLAUDE.md "Claude connector" for the rules.
//
// Sign-in is OAuth (oauth.js), whose one proof of identity is the app's own
// Google sign-in, checked against each site's allowlist on EVERY request.
// No valid token, no answer: 401 with a pointer to the sign-in metadata.
//
// Everything that decides an answer lives in plain JS beside this file
// (protocol.js, tools.js, inventory.js, from-app.js, oauth.js) so Node can test
// it with no Deno and no database. This file is only HTTP and SQL.
//
// Nothing to configure. Supabase injects SUPABASE_URL, SUPABASE_DB_URL and
// SUPABASE_SERVICE_ROLE_KEY. Optional secrets (Supabase > Edge Functions > Secrets):
//   MCP_TENANT_IDS    comma-separated tenants this connector serves (default "dev").
//   MCP_SIGNING_KEY   the token-signing secret; defaults to one derived from the
//                     service role key. Changing it signs everyone out of Claude.
//   MCP_CONNECT_URL   the app's connect page (default the dev build's).

import postgres from "npm:postgres@3.4.5";
import { handleMcp } from "./protocol.js";
import { roleFor } from "./tools.js";
import { createOAuth, makeSigner } from "./oauth.js";
import { verifyGoogleIdToken } from "../asset-api/auth.ts";

// The project's own database URL, a role that bypasses RLS -- which is why
// every query goes through withTenant below, whose `set local role` turns it on.
const sql = postgres(Deno.env.get("SUPABASE_DB_URL") ?? "", {
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

const BASE = `${(Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "")}/functions/v1/mcp`;
const CONNECT_URL = Deno.env.get("MCP_CONNECT_URL") ?? "https://assets.stama.tech/dev/mcp-connect.html";
// The connect page is the one browser caller, and it is on the app's origin.
const CONNECT_ORIGIN = new URL(CONNECT_URL).origin;

const signingSecret = Deno.env.get("MCP_SIGNING_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SUPABASE_DB_URL") || "";
const oauthPromise = makeSigner(signingSecret).then((signer) =>
  createOAuth({ base: BASE, connectUrl: CONNECT_URL, signer, verifyGoogle: (t: unknown) => verifyGoogleIdToken(t), sitesFor })
);

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const cors = {
  "access-control-allow-origin": CONNECT_ORIGIN,
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "vary": "origin",
};
// Discovery documents are public and read by Claude's browser-side code too.
const openCors = { "access-control-allow-origin": "*" };

// The path after the function name. Supabase hands the function its full
// path (/functions/v1/mcp/...) or just (/mcp/...) depending on the route.
function subPath(url: URL) {
  const i = url.pathname.indexOf("/mcp");
  const rest = i < 0 ? url.pathname : url.pathname.slice(i + 4);
  return rest.replace(/\/+$/, "") || "/";
}

async function readForm(req: Request): Promise<Record<string, string> | URLSearchParams> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return await req.json().catch(() => ({}));
  return new URLSearchParams(await req.text());
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = subPath(url);
  const oauth = await oauthPromise;

  // Discovery. Served with and without a path suffix, since clients build the
  // well-known URL from the issuer in more than one way.
  if (req.method === "GET" && path.startsWith("/.well-known/oauth-protected-resource")) {
    return json(200, oauth.resourceMetadata(), openCors);
  }
  if (req.method === "GET" &&
    (path.startsWith("/.well-known/oauth-authorization-server") || path.startsWith("/.well-known/openid-configuration"))) {
    return json(200, oauth.metadata(), openCors);
  }
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: path === "/authorize/complete" ? cors : { ...openCors, "access-control-allow-headers": "authorization, content-type, mcp-protocol-version", "access-control-allow-methods": "GET, POST, OPTIONS" },
    });
  }
  if (req.method === "POST" && path === "/register") {
    const out = await oauth.register(await req.json().catch(() => ({})));
    return json(out.status, out.body, openCors);
  }
  if (req.method === "GET" && path === "/authorize") {
    const out = await oauth.authorize(url.searchParams);
    if ("location" in out) return new Response(null, { status: 302, headers: { location: out.location } });
    return json(out.status, out.body);
  }
  if (req.method === "POST" && path === "/authorize/complete") {
    const out = await oauth.complete(await req.json().catch(() => ({})));
    return json(out.status, out.body, { ...cors, "cache-control": "no-store" });
  }
  if (req.method === "POST" && path === "/token") {
    const out = await oauth.token(await readForm(req));
    return json(out.status, out.body, { ...openCors, "cache-control": "no-store", "pragma": "no-cache" });
  }

  if (path !== "/") return json(404, { error: "Not found." });
  if (req.method !== "POST") return json(405, { error: "POST only" }, { allow: "POST" });

  const email = await oauth.bearer(req.headers.get("authorization"));
  if (!email) {
    return json(401, { error: "Sign-in required." }, {
      ...openCors,
      "www-authenticate": `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource"`,
      "access-control-expose-headers": "www-authenticate",
    });
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
    log: (event: string, detail: unknown) => console.log(JSON.stringify({ event, email, detail })),
  };
  const out = await handleMcp(body, ctx);
  return json(out.status, out.body, openCors);
});
