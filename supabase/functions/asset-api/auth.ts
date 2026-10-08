// Sign-in, sessions and the allowlist -- AssetTrackerSync.gs's model, ported
// as it is (DATABASE_BACKEND_PLAN.md, "Auth: keep the existing model in Phase
// 1"). A Google ID token is used ONCE, at sign-in; after that the browser
// presents an opaque session id good for a week, sliding.
//
// What moved: sessions live in the `sessions` table rather than Script
// Properties, and the allowlist in `auth_users` rather than a Config blob. The
// owner comes from the tenant's row, not a constant in the code.

import type { DiagEntry, Tx } from "./db.ts";

// Must match OAUTH_CLIENT_ID in AssetTrackerSync.gs and GOOGLE_CLIENT_ID in
// index.html; api_test.ts fails if it drifts from the former.
export const OAUTH_CLIENT_ID = "512657381831-4so7t5t2shqn8nbgrgktsg6s37podqji.apps.googleusercontent.com";

export const ROLE_EDITOR = "editor";
export const ROLE_VIEWER = "viewer";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_TOUCH_THRESHOLD_MS = 60 * 60 * 1000;
const SESSION_ID_RE = /^[0-9a-f]{40,80}$/i;

export type Identity = { ok: true; email: string; name: string } | { ok: false; detail: string };
export type User = { email: string; name: string; role: string };
export type Auth =
  | { ok: true; email: string; name: string; role: string; users: User[] }
  | { ok: false; reason: string; email?: string; error: string };

// verifyIdToken_, line for line: Google's tokeninfo endpoint, then the same
// checks in the same order, each refusal NAMING what failed so the sign-in
// screen can say it.
export async function verifyGoogleIdToken(idToken: unknown, fetchImpl: typeof fetch = fetch): Promise<Identity> {
  if (!idToken || typeof idToken !== "string") {
    return { ok: false, detail: "No sign-in token was sent with the request." };
  }
  let res: Response;
  try {
    res = await fetchImpl("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken));
  } catch (err) {
    return { ok: false, detail: "The server couldn't reach Google to check the sign-in: " + (err as Error).message };
  }
  const bodyText = await res.text();
  if (res.status !== 200) {
    return { ok: false, detail: "Google rejected the sign-in token (HTTP " + res.status + "): " + bodyText.slice(0, 300) };
  }
  // deno-lint-ignore no-explicit-any
  let info: any;
  try {
    info = JSON.parse(bodyText);
  } catch (_err) {
    return { ok: false, detail: "Google's reply wasn't readable: " + bodyText.slice(0, 200) };
  }
  if (info.aud !== OAUTH_CLIENT_ID) {
    return {
      ok: false,
      detail: "This sign-in was issued for a different app. The server expects client id ending "
        + OAUTH_CLIENT_ID.slice(-30) + " but the token names " + String(info.aud || "(none)").slice(-30) + ".",
    };
  }
  if (String(info.email_verified) !== "true") return { ok: false, detail: "That Google account's email address isn't verified." };
  if (!info.email) return { ok: false, detail: "Google didn't include an email address with the sign-in." };
  const exp = Number(info.exp);
  if (isFinite(exp) && exp * 1000 < Date.now()) return { ok: false, detail: "That sign-in had already expired." };
  return { ok: true, email: String(info.email).toLowerCase().trim(), name: info.name || "" };
}

// sanitizeAuthUsers_: lowercased, de-duplicated, anything not explicitly a
// viewer is an editor, and the owner always present as an editor -- which is
// what makes lockout impossible.
export function sanitizeUsers(list: { email: string; name?: string; role?: string }[], ownerEmail: string): User[] {
  const seen: Record<string, true> = {};
  const cleaned: User[] = [];
  for (const u of list) {
    const email = String(u?.email || "").toLowerCase().trim();
    if (!email || seen[email]) continue;
    seen[email] = true;
    cleaned.push({ email, name: u.name || "", role: u.role === ROLE_VIEWER ? ROLE_VIEWER : ROLE_EDITOR });
  }
  const owner = ownerEmail.toLowerCase().trim();
  if (!seen[owner]) cleaned.unshift({ email: owner, name: "Owner", role: ROLE_EDITOR });
  return cleaned;
}

// Re-read on EVERY request, so removing someone or dropping them to view-only
// takes effect on their next action rather than when their session expires.
export async function readUsers(tx: Tx, ownerEmail: string): Promise<User[]> {
  const rows = await tx`select email, name, role from auth_users order by position, email`;
  return sanitizeUsers(rows, ownerEmail);
}

// authorizeIdentity_. The stored name wins over Google's: it is what an editor
// typed for this person, and it already stamps their rows in the audit log.
export function authorizeIdentity(identity: { email: string; name: string }, users: User[]): Auth {
  const match = users.find((u) => u.email === identity.email);
  if (!match) {
    return {
      ok: false,
      reason: "notallowed",
      email: identity.email,
      error: identity.email + " isn't on the access list for this asset tracker. Ask an editor to add you.",
    };
  }
  return { ok: true, email: identity.email, name: match.name || identity.name || identity.email, role: match.role, users };
}

// Two UUIDs' worth of hex: a week-long bearer credential, and the extra
// entropy costs nothing.
export function newSessionId(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
}

// Expired sessions are only noticed when presented, so a sign-in sweeps the
// tenant's -- rare enough to be free, frequent enough to keep the table small.
export async function createSession(tx: Tx, tenantId: string, email: string, now: number): Promise<string> {
  await tx`delete from sessions where expires_at <= ${new Date(now)}`;
  const id = newSessionId();
  await tx`insert into sessions (id, tenant_id, email, expires_at, touched_at)
    values (${id}, ${tenantId}, ${email.toLowerCase().trim()}, ${new Date(now + SESSION_TTL_MS)}, ${new Date(now)})`;
  return id;
}

// readSession_. `why` names the cause of a null for the diagnostics log:
// "missing" (signed out elsewhere, removed, or ANOTHER TENANT'S session --
// RLS hides it, which is how a session is refused for the wrong tenant) and
// "none" (the browser sent nothing) point at different causes of the same
// sign-in screen.
export async function readSession(tx: Tx, sessionId: unknown, now: number, out: { why?: string } = {}) {
  if (!sessionId || typeof sessionId !== "string") { out.why = "none"; return null; }
  if (!SESSION_ID_RE.test(sessionId)) { out.why = "malformed"; return null; }
  const [row] = await tx`select email, expires_at from sessions where id = ${sessionId}`;
  if (!row) { out.why = "missing"; return null; }
  if (!(new Date(row.expires_at).getTime() > now)) {
    await tx`delete from sessions where id = ${sessionId}`;
    out.why = "expired";
    return null;
  }
  return { email: String(row.email), expires: new Date(row.expires_at).getTime() };
}

// Sliding expiry, rewritten only once it has drifted by an hour so a request
// does not write a row just to move a deadline by seconds.
export async function touchSession(tx: Tx, sessionId: string, session: { expires: number }, now: number) {
  const next = now + SESSION_TTL_MS;
  if (next - session.expires < SESSION_TOUCH_THRESHOLD_MS) return;
  await tx`update sessions set expires_at = ${new Date(next)}, touched_at = ${new Date(now)} where id = ${sessionId}`;
}

export async function deleteSession(tx: Tx, sessionId: unknown) {
  if (!sessionId || typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) return;
  await tx`delete from sessions where id = ${sessionId}`;
}

// authorizeSession_: the session, then the allowlist. Every refusal is logged
// here so a new op authorizing through it is logged without anyone remembering.
export async function authorizeSession(
  tx: Tx, sessionId: unknown, users: User[], now: number, diag: DiagEntry[],
): Promise<Auth> {
  const out: { why?: string } = {};
  const session = await readSession(tx, sessionId, now, out);
  if (!session) {
    diag.push({ event: "auth_failed", reason: "signin", detail: "session " + (out.why || "unknown") });
    return { ok: false, reason: "signin", error: "Your session has expired. Sign in again to continue." };
  }
  const auth = authorizeIdentity({ email: session.email, name: "" }, users);
  if (auth.ok) await touchSession(tx, sessionId as string, session, now);
  else diag.push({ event: "auth_failed", email: session.email, reason: auth.reason });
  return auth;
}
