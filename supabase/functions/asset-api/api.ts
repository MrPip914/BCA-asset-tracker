// The request handler: the same requests AssetTrackerSync.gs answers, with the
// same answers, so index.html changes by a URL and not a rewrite
// (DATABASE_BACKEND_PLAN.md). Ported so far: signin, read, signout, save (a
// body with no op), auditFull, revisions, diagnostics, photoSign, floorPlanSign, the
// public panel read (GET ?panel=), and the bare GET.
// Everything else answers that it is not here YET -- as JSON, never an error
// page, which is the one thing every answer must be.
//
// The tenant is named by the request (`?tenant=dev`, or the frontend's own
// `client` / `c`). A tenant is a row in `tenants`; RLS does the rest.

import { type DiagEntry, readDiag, type Sql, withTenant, writeDiag } from "./db.ts";
import {
  type Auth, authorizeIdentity, authorizeSession, createSession, deleteSession,
  type Identity, readSession, readUsers, verifyGoogleIdToken,
} from "./auth.ts";
import { readAuditFull, readInventory, readRevisions } from "./inventory.ts";
import { LOCK_TIMEOUT_MS, type SaveContext, saveInventory } from "./save.ts";
import { publicPanel } from "./panel.ts";
import { type CloudinaryCreds, NOT_SET_UP, signFloorPlan, signPhotos } from "./sign.ts";

// The backend contract version, in AssetTrackerSync.gs's series. index.html
// compares it to FRONTEND_SCRIPT_VERSION and shows "Backend outdated" when they
// differ. api_test.ts fails if this and SCRIPT_VERSION drift apart.
export const SCRIPT_VERSION = "v52";

// A read or save slower than this is logged as slow_read / slow_save, as
// DIAG_SLOW_READ_MS and DIAG_SLOW_MS do.
const DIAG_SLOW_READ_MS = 8000;
const DIAG_SLOW_MS = 8000;

// busyResponse_: the save queued behind others past the lock timeout. Nothing
// was read or written, so the client treats it as any other failed save.
const BUSY = {
  ok: false,
  busy: true,
  error: "The tracker was busy with other saves and couldn't take this one. Nothing was changed -- try again.",
  scriptVersion: SCRIPT_VERSION,
};

// deno-lint-ignore no-explicit-any
type Body = Record<string, any>;

export type ApiOptions = {
  sql: Sql;
  verifyIdToken?: (token: unknown) => Promise<Identity>;
  now?: () => number;
  // How long a save waits for another tenant save's lock (save.ts). Tests
  // shorten it; the deployed function keeps acquireLock_'s ten seconds.
  lockTimeoutMs?: number;
  // The Cloudinary account upload signatures are made with (sign.ts); null
  // when the secrets are not set, which the sign ops answer by naming them.
  cloudinary?: CloudinaryCreds | null;
  uuid?: () => string;
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

export function createApi({
  sql, verifyIdToken = verifyGoogleIdToken, now = Date.now, lockTimeoutMs, cloudinary = null, uuid = () => crypto.randomUUID(),
}: ApiOptions) {
  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (req.method === "GET") {
      // The public per-panel read: anonymous by design, and structurally
      // separate from everything authenticated (panel.ts).
      const code = url.searchParams.get("panel");
      if (code) {
        const tenantId = tenantOf(url);
        if (!tenantId) return json({ ok: false, error: "No tenant named in the request (?tenant=).", scriptVersion: SCRIPT_VERSION });
        try {
          return json(await withTenant(sql, tenantId, async (tx) => {
            const [tenant] = await tx`select 1 from tenants`;
            if (!tenant) return { ok: false, error: "Could not load that panel." };
            return await publicPanel(tx, code, SCRIPT_VERSION);
          }));
        } catch (_err) {
          return json({ ok: false, error: "Could not load that panel." });
        }
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
      if (op === "save") return await save(body, tenantId, diag, started);
      if (op === "auditFull") return await auditFull(body, tenantId, diag);
      if (op === "revisions") return await revisions(body, tenantId, diag);
      if (op === "diagnostics") return await diagnostics(body, tenantId, diag);
      if (op === "photoSign" || op === "floorPlanSign") return await sign(op, body, tenantId, diag);
      return json({ ok: false, error: `"${op}" isn't available on this backend yet.`, scriptVersion: SCRIPT_VERSION });
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

  // handleAuditFull_: a session, any role, and the whole log.
  async function auditFull(body: Body, tenantId: string, diag: DiagEntry[]) {
    try {
      const answer = await withTenant(sql, tenantId, async (tx) => {
        const [tenant] = await tx`select owner_email from tenants`;
        if (!tenant) return { ok: false, error: `There is no tenant "${tenantId}" on this backend.`, scriptVersion: SCRIPT_VERSION };
        const users = await readUsers(tx, String(tenant.owner_email).toLowerCase());
        const auth = await authorizeSession(tx, body.sessionId, users, now(), diag);
        if (!auth.ok) {
          return { ok: false, authFailed: true, reason: auth.reason, email: auth.email || "", error: auth.error, scriptVersion: SCRIPT_VERSION };
        }
        return { ok: true, ...(await readAuditFull(tx)), scriptVersion: SCRIPT_VERSION };
      });
      return json(answer);
    } catch (err) {
      diag.push({ event: "error", detail: (err as Error)?.message });
      return json({ ok: false, error: "The server couldn't load the audit log: " + (err as Error)?.message, scriptVersion: SCRIPT_VERSION });
    }
  }

  // The live refresh's cheap check (DATABASE_BACKEND_PLAN.md, Phase 2a): a
  // session, any role, and the revision counters -- nothing else. The client
  // runs a full read only when one has moved. Supabase-only on purpose: the
  // Sheet backend has no such op, and its doPost would read an unknown op as a
  // save, so the client never sends it there.
  async function revisions(body: Body, tenantId: string, diag: DiagEntry[]) {
    try {
      const answer = await withTenant(sql, tenantId, async (tx) => {
        const [tenant] = await tx`select owner_email from tenants`;
        if (!tenant) return { ok: false, error: `There is no tenant "${tenantId}" on this backend.`, scriptVersion: SCRIPT_VERSION };
        const users = await readUsers(tx, String(tenant.owner_email).toLowerCase());
        const auth = await authorizeSession(tx, body.sessionId, users, now(), diag);
        if (!auth.ok) {
          return { ok: false, authFailed: true, reason: auth.reason, email: auth.email || "", error: auth.error, scriptVersion: SCRIPT_VERSION };
        }
        return { ok: true, revisions: await readRevisions(tx), role: auth.role, scriptVersion: SCRIPT_VERSION };
      });
      return json(answer);
    } catch (err) {
      diag.push({ event: "error", detail: (err as Error)?.message });
      return json({ ok: false, error: "The server couldn't check for changes: " + (err as Error)?.message, scriptVersion: SCRIPT_VERSION });
    }
  }

  // handleDiagnostics_: the backend's own log, for the About panel. EDITORS
  // ONLY, because it names other people.
  async function diagnostics(body: Body, tenantId: string, diag: DiagEntry[]) {
    try {
      const answer = await withTenant(sql, tenantId, async (tx) => {
        const [tenant] = await tx`select owner_email from tenants`;
        if (!tenant) return { ok: false, error: `There is no tenant "${tenantId}" on this backend.`, scriptVersion: SCRIPT_VERSION };
        const users = await readUsers(tx, String(tenant.owner_email).toLowerCase());
        const auth = await authorizeSession(tx, body.sessionId, users, now(), diag);
        if (!auth.ok) return { ok: false, authFailed: true, reason: auth.reason, error: auth.error, scriptVersion: SCRIPT_VERSION };
        if (auth.role !== "editor") return { ok: false, forbidden: true, error: "Only editors can read the backend log.", scriptVersion: SCRIPT_VERSION };
        return { ok: true, ...(await readDiag(tx)), scriptVersion: SCRIPT_VERSION };
      });
      return json(answer);
    } catch (err) {
      diag.push({ event: "error", detail: (err as Error)?.message });
      return json({ ok: false, error: (err as Error)?.message, scriptVersion: SCRIPT_VERSION });
    }
  }

  // handlePhotoSign_ / handleFloorPlanSign_: an editor's session, then a
  // signature. Writes nothing and takes no lock.
  async function sign(op: string, body: Body, tenantId: string, diag: DiagEntry[]) {
    try {
      const answer = await withTenant(sql, tenantId, async (tx) => {
        const [tenant] = await tx`select owner_email, cloudinary_folder from tenants`;
        if (!tenant) return { ok: false, error: `There is no tenant "${tenantId}" on this backend.`, scriptVersion: SCRIPT_VERSION };
        const users = await readUsers(tx, String(tenant.owner_email).toLowerCase());
        const auth = await authorizeSession(tx, body.sessionId, users, now(), diag);
        if (!auth.ok) return { ok: false, authFailed: true, reason: auth.reason, email: auth.email || "", error: auth.error };
        if (auth.role !== "editor") {
          return {
            ok: false, authFailed: true, reason: "readonly",
            error: op === "photoSign"
              ? "Your access is view-only, so files can't be uploaded."
              : "Your access is view-only, so a floor plan can't be uploaded.",
          };
        }
        if (!cloudinary) return { ok: false, error: NOT_SET_UP };
        const input = { creds: cloudinary, folder: tenant.cloudinary_folder, now: now(), uuid };
        return op === "photoSign" ? await signPhotos(body.count, input) : await signFloorPlan(input);
      });
      return json(answer);
    } catch (err) {
      diag.push({ event: "error", detail: (err as Error)?.message });
      return json({ ok: false, error: (err as Error)?.message, scriptVersion: SCRIPT_VERSION });
    }
  }

  // doPost's write path. Everything happens in ONE transaction, so a refusal,
  // a conflict or a failure part-way leaves the inventory exactly as it was.
  async function save(body: Body, tenantId: string, diag: DiagEntry[], started: number) {
    const stages: string[] = [];
    try {
      // The diagnostics of a save that throws part-way are kept: they are
      // pushed to `diag`, which is written after, in a transaction of its own.
      const ctx: SaveContext = { tenantId, ownerEmail: "", now: now(), diag, stages, lockTimeoutMs };
      const answer = await withTenant(sql, tenantId, async (tx) => {
        const [tenant] = await tx`select owner_email from tenants`;
        if (!tenant) return { ok: false, error: `There is no tenant "${tenantId}" on this backend.`, scriptVersion: SCRIPT_VERSION };
        ctx.ownerEmail = String(tenant.owner_email).toLowerCase();
        return await saveInventory(tx, body, ctx);
      });
      const took = now() - started;
      if (answer.ok && took > DIAG_SLOW_MS) diag.push({ event: "slow_save", email: ctx.email, ms: took, detail: stages.join("; ") });
      return json(answer);
    } catch (err) {
      // 55P03 lock_not_available: someone else's save held the lock past the
      // timeout. An answer, not a crash (v42).
      if ((err as { code?: string })?.code === "55P03") {
        diag.push({ event: "busy", detail: `lock not acquired in ${lockTimeoutMs ?? LOCK_TIMEOUT_MS}ms` });
        return json(BUSY);
      }
      diag.push({ event: "error", detail: (err as Error)?.message + " | after: " + stages.join("; ") });
      return json({ ok: false, error: (err as Error)?.message });
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
