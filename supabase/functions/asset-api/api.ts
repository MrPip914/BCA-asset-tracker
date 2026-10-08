// The request handler: the same requests AssetTrackerSync.gs answers, with the
// same answers, so index.html changes by a URL and not a rewrite
// (DATABASE_BACKEND_PLAN.md). Ported so far: signin, read, signout, and the
// bare GET. Everything else answers that it is not here YET -- as JSON, never
// an error page, which is the one thing every answer must be.
//
// The tenant is named by the request (`?tenant=dev`, or the frontend's own
// `client` / `c`). A tenant is a row in `tenants`; RLS does the rest.

import { type DiagEntry, type Sql, withTenant, writeDiag } from "./db.ts";
import {
  type Auth, authorizeIdentity, authorizeSession, createSession, deleteSession,
  type Identity, readSession, readUsers, verifyGoogleIdToken,
} from "./auth.ts";
import { readInventory } from "./inventory.ts";

// The backend contract version, in AssetTrackerSync.gs's series. index.html
// compares it to FRONTEND_SCRIPT_VERSION and shows "Backend outdated" when they
// differ. api_test.ts fails if this and SCRIPT_VERSION drift apart.
export const SCRIPT_VERSION = "v52";

// A read slower than this is logged as slow_read, as DIAG_SLOW_READ_MS does.
const DIAG_SLOW_READ_MS = 8000;

// deno-lint-ignore no-explicit-any
type Body = Record<string, any>;

export type ApiOptions = {
  sql: Sql;
  verifyIdToken?: (token: unknown) => Promise<Identity>;
  now?: () => number;
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const tenantOf = (url: URL) =>
  (url.searchParams.get("tenant") || url.searchParams.get("client") || url.searchParams.get("c") || "").trim();

export function createApi({ sql, verifyIdToken = verifyGoogleIdToken, now = Date.now }: ApiOptions) {
  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (req.method === "GET") {
      if (url.searchParams.get("panel")) {
        return json({ ok: false, error: "The public panel page isn't on this backend yet." });
      }
      // The bare GET: version without a token. "Backend outdated" and
      // `deploy.mjs --status` both read it, so it stays unauthenticated.
      return json({ ok: false, authFailed: true, reason: "signin", scriptVersion: SCRIPT_VERSION, error: "This endpoint requires sign-in." });
    }
    if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);

    // text/plain, like every request index.html sends: a "simple" request with
    // no preflight. The body is JSON whatever the declared type.
    let body: Body;
    try {
      body = JSON.parse(await req.text());
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
    } catch (_err) {
      return json({ ok: false, error: "Malformed request body." });
    }

    const op = body.op ? String(body.op).slice(0, 40) : "save";
    const tenantId = tenantOf(url);
    const started = now();
    const diag: DiagEntry[] = [];

    try {
      if (op === "signout") return await signOut(body, tenantId, diag, started);
      if (!tenantId) return json({ ok: false, error: "No tenant named in the request (?tenant=).", scriptVersion: SCRIPT_VERSION });
      if (op === "signin") {
        // Verified OUTSIDE the transaction: it is a network round trip to Google.
        const identity = await verifyIdToken(body.idToken);
        if (!identity.ok) {
          diag.push({ event: "auth_failed", reason: "signin", detail: "google token rejected: " + identity.detail });
          return json({
            ok: false, authFailed: true, reason: "signin", error: "Sign in with Google to use the asset tracker.",
            detail: identity.detail, scriptVersion: SCRIPT_VERSION,
          });
        }
        return await read({ identity }, tenantId, diag, started);
      }
      if (op === "read") return await read({ sessionId: body.sessionId }, tenantId, diag, started);
      return json({
        ok: false,
        error: op === "save"
          ? "Saving isn't available on this backend yet. Nothing was changed."
          : `"${op}" isn't available on this backend yet.`,
        scriptVersion: SCRIPT_VERSION,
      });
    } finally {
      // Stamped here so every entry carries the op and how long the request took.
      for (const e of diag) { e.op ??= op; e.ms ??= now() - started; }
      if (tenantId) await writeDiag(sql, tenantId, diag, SCRIPT_VERSION);
    }
  };

  // handleAuthenticatedRead_: reached from sign-in with a fresh identity, or
  // from op:"read" with a session. Either way the allowlist decides, and the
  // answer carries the session so the client always holds the current one.
  async function read(
    who: { identity?: Identity & { ok: true }; sessionId?: unknown }, tenantId: string, diag: DiagEntry[], started: number,
  ) {
    try {
      const answer = await withTenant(sql, tenantId, async (tx) => {
        const [tenant] = await tx`select owner_email from tenants`;
        if (!tenant) return { ok: false, error: `There is no tenant "${tenantId}" on this backend.`, scriptVersion: SCRIPT_VERSION };
        const ownerEmail = String(tenant.owner_email).toLowerCase();
        const users = await readUsers(tx, ownerEmail);
        const t = now();

        let auth: Auth;
        let sessionId: unknown;
        if (who.identity) {
          auth = authorizeIdentity(who.identity, users);
          if (auth.ok) {
            sessionId = await createSession(tx, tenantId, auth.email, t);
            diag.push({ event: "signin", email: auth.email, detail: auth.role });
          } else {
            diag.push({ event: "auth_failed", email: auth.email || "", reason: auth.reason });
          }
        } else {
          sessionId = who.sessionId;
          auth = await authorizeSession(tx, sessionId, users, t, diag);
        }
        if (!auth.ok) {
          return { ok: false, authFailed: true, reason: auth.reason, email: auth.email || "", error: auth.error, scriptVersion: SCRIPT_VERSION };
        }

        const inventory = await readInventory(tx);
        return {
          scriptVersion: SCRIPT_VERSION,
          ...inventory,
          auth: {
            email: auth.email, name: auth.name, role: auth.role, users: auth.users,
            ownerEmail, sessionId,
          },
        };
      });
      const took = now() - started;
      if (took > DIAG_SLOW_READ_MS && "auth" in answer) diag.push({ event: "slow_read", email: answer.auth.email, ms: took });
      return json(answer);
    } catch (err) {
      diag.push({ event: "error", detail: (err as Error)?.message });
      return json({ ok: false, error: "The server couldn't load the inventory: " + (err as Error)?.message, scriptVersion: SCRIPT_VERSION });
    }
  }

  // Unconditional ok: "this session is gone" is exactly what was asked for,
  // and reporting a failure would only invite a retry loop. Read first only so
  // the log can say WHO signed out.
  async function signOut(body: Body, tenantId: string, diag: DiagEntry[], _started: number) {
    if (tenantId) {
      try {
        await withTenant(sql, tenantId, async (tx) => {
          const ending = await readSession(tx, body.sessionId, now());
          await deleteSession(tx, body.sessionId);
          diag.push({ event: "signout", email: ending ? ending.email : "", detail: ending ? "" : "no live session" });
        });
      } catch (_err) { /* still ok -- the session ages out on its own */ }
    }
    return json({ ok: true });
  }
}
