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
import { roleFor, ToolError } from "./tools.js";
import { createOAuth, makeSigner } from "./oauth.js";
import { verifyGoogleIdToken } from "../asset-api/auth.ts";
import { credsFromEnv, signFloorPlan, NOT_SET_UP } from "../asset-api/sign.ts";

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
  space_links: "select plan_asset_id, shape_id, position, data from asset_tracker.space_links",
  space_groups: "select id, plan_asset_id, position, data from asset_tracker.space_groups",
  // What a management write sends back as "the inventory I planned against"
  // (connector_apply refuses if it has moved since).
  revisions: "select domain, rev from asset_tracker.revisions",
};

// Every read runs inside a transaction that first names its tenant, which is
// what row-level security keys on, then drops to asset_api (the raw
// connection would bypass RLS) and is declared READ ONLY: asset_api holds
// write grants, and the connector's only writes go through write() below. Same shape as
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

// A write: the same tenant and role setup, minus READ ONLY, and exactly one
// statement -- a call to one of the 0006/0007 functions, which does every check and
// the revision bump itself. The connector never writes a table directly.
// A record goes as TEXT cast to jsonb: postgres.js serializes a parameter it
// infers as jsonb with JSON.stringify, so passing the string straight to
// a jsonb cast would store a JSON string holding the record, not the record.
const WRITE_SQL: Record<string, (tx: postgres.TransactionSql, email: string, a: unknown[]) => Promise<postgres.RowList<postgres.Row[]>>> = {
  add_task: (tx, email, [asset, item]) =>
    tx`select asset_tracker.connector_add_task(${email}, ${asset as string}, ${JSON.stringify(item)}::text::jsonb) as out`,
  complete_task: (tx, email, [task, date, change]) =>
    tx`select asset_tracker.connector_complete_task(${email}, ${task as string}, ${date as string}, ${JSON.stringify(change)}::text::jsonb) as out`,
  log_work: (tx, email, [asset, change]) =>
    tx`select asset_tracker.connector_log_work(${email}, ${asset as string}, ${JSON.stringify(change)}::text::jsonb) as out`,
  add_comment: (tx, email, [asset, text]) =>
    tx`select asset_tracker.connector_add_comment(${email}, ${asset as string}, ${text as string}) as out`,
  // Every management tool (save_assets, archive_assets, add_tasks, edit_task,
  // delete_task): one list of ops, applied whole or not at all (0007).
  apply: (tx, email, [expected, ops]) =>
    tx`select asset_tracker.connector_apply(${email}, ${JSON.stringify(expected)}::text::jsonb, ${JSON.stringify(ops)}::text::jsonb) as out`,
  // replace_floor_plan (0008): the asset's plan fields, its links and groups.
  replace_floor_plan: (tx, email, [expected, asset, planFile, links, groups]) =>
    tx`select asset_tracker.connector_replace_floor_plan(${email}, ${JSON.stringify(expected)}::text::jsonb, ${asset as string},
      ${JSON.stringify(planFile)}::text::jsonb, ${JSON.stringify(links)}::text::jsonb, ${JSON.stringify(groups)}::text::jsonb) as out`,
};

async function write(tenant: string, email: string, op: string, args: unknown[]) {
  const run = WRITE_SQL[op];
  if (!run) throw new Error(`no writer for ${op}`);
  try {
    return await sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenant}, true)`;
      await tx`select set_config('search_path', 'asset_tracker, public', true)`;
      await tx`set local role asset_api`;
      const [row] = await run(tx, email, args);
      return row.out;
    });
  } catch (err) {
    // The functions word their refusals for the person ("connector: ...").
    const m = String((err as Error)?.message ?? "");
    if (m.startsWith("connector: ")) throw new ToolError(m.slice("connector: ".length));
    throw err;
  }
}

// ---------------------------------------------------------------- floor plan files

// Only the app's file host is ever fetched: the url comes from a stored row,
// and a row is not a licence to make this function fetch anything.
const PLAN_HOST = "https://res.cloudinary.com/";
const PLAN_MAX_BYTES = 25 * 1024 * 1024;

async function fetchPlan(url: string) {
  if (!String(url).startsWith(PLAN_HOST)) throw new Error("not the file host");
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`file host answered ${res.status}`);
  const text = await res.text();
  if (text.length > PLAN_MAX_BYTES) throw new Error("plan too large");
  return text;
}

// The app's upload, done here: a signature from asset-api's signFloorPlan (the
// folder and object name chosen server-side), then the image route, which
// keeps an SVG as it is (see CLAUDE.md, "The floor plan SVG upload").
async function uploadPlan(tenant: string, svg: string, fileName: string) {
  const creds = credsFromEnv((k) => Deno.env.get(k));
  if (!creds) throw new ToolError(NOT_SET_UP);
  const folder = await withTenant(tenant, async (tx) => {
    const [t] = await tx`select cloudinary_folder from asset_tracker.tenants where id = ${tenant}`;
    return t ? t.cloudinary_folder : null;
  });
  const sig = await signFloorPlan({ creds, folder, now: Date.now(), uuid: () => crypto.randomUUID() });
  const form = new FormData();
  form.append("file", new Blob([svg], { type: "image/svg+xml" }), fileName);
  form.append("api_key", sig.apiKey);
  form.append("signature", sig.signature);
  for (const k of sig.signedParams) form.append(k, String(k === "public_id" ? sig.publicId : (sig as Record<string, unknown>)[k]));
  const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(sig.cloudName)}/image/upload`, {
    method: "POST", body: form, signal: AbortSignal.timeout(60000),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.secure_url) {
    throw new ToolError(`The file host refused the plan: ${out?.error?.message || `status ${res.status}`}. Nothing was changed.`);
  }
  return { url: String(out.secure_url), storageKey: String(out.public_id || sig.publicId) };
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
    write: (tenant: string, op: string, args: unknown[]) => {
      if (!sites.some((s) => s.id === tenant)) throw new Error("site not permitted");
      return write(tenant, email, op, args);
    },
    fetchPlan,
    uploadPlan: (tenant: string, svg: string, fileName: string) => {
      if (!sites.some((s) => s.id === tenant)) throw new Error("site not permitted");
      return uploadPlan(tenant, svg, fileName);
    },
    log: (event: string, detail: unknown) => console.log(JSON.stringify({ event, email, detail })),
  };
  const out = await handleMcp(body, ctx);
  return json(out.status, out.body, openCors);
});
