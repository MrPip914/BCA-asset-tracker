// Sign-in for the Claude connector: a small OAuth 2.1 authorization server
// (authorization code + PKCE, dynamic client registration, refresh tokens) whose
// one way of proving who you are is the app's own Google sign-in.
//
// HOW A CONNECT WORKS
//   1. Claude registers itself (POST /register) and opens GET /authorize.
//   2. /authorize checks the request and redirects to the app's connect page
//      (mcp-connect.html on assets.stama.tech), carrying it as a signed `req`.
//      The page has to be on the app's origin: that is the only origin Google
//      sign-in is registered for, and Supabase will not serve HTML anyway.
//   3. The page signs in with Google and posts the ID token plus `req` to
//      /authorize/complete, which checks the token with Google (the same
//      verifyGoogleIdToken the app's backend uses) and that the person is on at
//      least one site's allowlist, then hands back a one-time code for Claude.
//   4. Claude trades the code at /token for an hour-long access token and a
//      30-day refresh token.
//
// STATELESS ON PURPOSE. Clients, requests, codes and tokens are all HMAC-signed
// JSON, so nothing is stored and there is no table to migrate or clean up. The
// costs, accepted: a code can't be marked used, so it is short-lived and bound
// to its PKCE challenge (useless without the verifier only Claude holds); and a
// token can't be revoked by itself. That second one is why access is decided
// FRESH on every request from the allowlist (index.ts sitesFor) -- removing
// someone from a site takes effect on their next question, exactly as in the
// app, and a refresh is refused once they are on no site at all.
//
// The Google ID token is used once, in step 3, and never stored or returned.
//
// Pure: no network, no database, no clock it isn't given. index.ts wires it up;
// test-mcp-connector.mjs drives it with WebCrypto in Node.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const ACCESS_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const CODE_TTL_MS = 5 * 60 * 1000;
export const REQUEST_TTL_MS = 15 * 60 * 1000;

// Where a code may be sent. Claude's own callbacks, and a loopback address for
// Claude Code and the desktop app. An arbitrary https callback is refused at
// registration: a registered client is otherwise anyone at all.
const CLAUDE_CALLBACKS = new Set([
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
]);
export function redirectAllowed(uri) {
  if (CLAUDE_CALLBACKS.has(uri)) return true;
  let u;
  try { u = new URL(uri); } catch { return false; }
  return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1") && !u.username && !u.password;
}

const b64url = (bytes) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64url = (s) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

export async function sha256b64url(text) {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text))));
}

// Signed, typed, expiring JSON. `typ` is checked on every verify so a code can
// never be presented as an access token, nor a client id as anything else.
export async function makeSigner(secret) {
  if (!secret) throw new Error("no signing secret");
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  // Derived rather than used directly, so the secret it comes from (index.ts
  // picks one) is never itself a token-signing key.
  const derived = new Uint8Array(await crypto.subtle.sign("HMAC", base, enc.encode("asset-tracker-mcp-oauth-v1")));
  const key = await crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  return {
    async sign(payload) {
      const body = b64url(enc.encode(JSON.stringify(payload)));
      const mac = b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body))));
      return `${body}.${mac}`;
    },
    async verify(token, typ, now) {
      if (typeof token !== "string") return null;
      const parts = token.split(".");
      if (parts.length !== 2) return null;
      let ok = false;
      try {
        ok = await crypto.subtle.verify("HMAC", key, unb64url(parts[1]), enc.encode(parts[0]));
      } catch { return null; }
      if (!ok) return null;
      let p;
      try { p = JSON.parse(dec.decode(unb64url(parts[0]))); } catch { return null; }
      if (!p || p.typ !== typ) return null;
      if (p.exp !== undefined && !(p.exp > now)) return null;
      return p;
    },
  };
}

const oauthError = (status, error, description) => ({ status, body: { error, error_description: description } });

// A short fingerprint of a client id, carried in requests and codes so a code
// is only good for the client it was issued to.
const fingerprint = async (clientId) => (await sha256b64url(String(clientId))).slice(0, 22);

export function createOAuth({ base, connectUrl, signer, verifyGoogle, sitesFor, now = () => Date.now() }) {
  const metadata = () => ({
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["inventory.read"],
  });

  const resourceMetadata = () => ({
    resource: base,
    authorization_servers: [base],
    scopes_supported: ["inventory.read"],
    bearer_methods_supported: ["header"],
    resource_name: "Asset Tracker",
  });

  async function readClient(clientId) {
    return signer.verify(clientId, "client", now());
  }

  async function register(body) {
    const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.map(String) : [];
    if (!uris.length) return oauthError(400, "invalid_redirect_uri", "redirect_uris is required.");
    const bad = uris.find((u) => !redirectAllowed(u));
    if (bad) return oauthError(400, "invalid_redirect_uri", `This server only sends sign-ins back to Claude, not to ${bad}.`);
    const name = String(body?.client_name || "").slice(0, 80);
    const clientId = await signer.sign({ typ: "client", r: uris, n: name });
    return {
      status: 201,
      body: {
        client_id: clientId,
        client_id_issued_at: Math.floor(now() / 1000),
        client_name: name || undefined,
        redirect_uris: uris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
    };
  }

  // GET /authorize. A bad client or redirect is answered here, never by
  // redirecting to an address nobody has vouched for.
  async function authorize(params) {
    const get = (k) => (params.get ? params.get(k) : params[k]) ?? "";
    const clientId = get("client_id");
    const client = await readClient(clientId);
    if (!client) return oauthError(400, "invalid_client", "Unknown client. Remove the connector in Claude and add it again.");
    const redirectUri = get("redirect_uri") || (client.r.length === 1 ? client.r[0] : "");
    if (!client.r.includes(redirectUri)) return oauthError(400, "invalid_request", "redirect_uri does not match the registered one.");
    if (get("response_type") !== "code") return oauthError(400, "unsupported_response_type", "Only response_type=code is supported.");
    const challenge = get("code_challenge");
    if (!challenge || get("code_challenge_method") !== "S256") {
      return oauthError(400, "invalid_request", "PKCE with code_challenge_method=S256 is required.");
    }
    const req = await signer.sign({
      typ: "req",
      fp: await fingerprint(clientId),
      ru: redirectUri,
      cc: challenge,
      st: get("state"),
      cn: client.n || "",
      exp: now() + REQUEST_TTL_MS,
    });
    const sep = connectUrl.includes("?") ? "&" : "?";
    return { status: 302, location: `${connectUrl}${sep}req=${encodeURIComponent(req)}` };
  }

  // POST /authorize/complete, from the connect page. Answers JSON either way so
  // the page can say what went wrong on screen.
  async function complete(body) {
    const req = await signer.verify(body?.req, "req", now());
    if (!req) return { status: 400, body: { ok: false, error: "This connect link has expired. Start again from Claude." } };
    const identity = await verifyGoogle(body?.credential);
    if (!identity?.ok) return { status: 401, body: { ok: false, error: identity?.detail || "Google sign-in failed." } };
    const sites = await sitesFor(identity.email);
    if (!sites.length) {
      return {
        status: 403,
        body: { ok: false, error: `${identity.email} isn't on the access list for any site this connector serves. Ask an editor to add you.` },
      };
    }
    const code = await signer.sign({ typ: "code", e: identity.email, fp: req.fp, ru: req.ru, cc: req.cc, exp: now() + CODE_TTL_MS });
    const u = new URL(req.ru);
    u.searchParams.set("code", code);
    if (req.st) u.searchParams.set("state", req.st);
    return { status: 200, body: { ok: true, email: identity.email, sites: sites.map((s) => s.name || s.id), redirect: u.toString() } };
  }

  async function issue(email, clientFp) {
    const t = now();
    return {
      status: 200,
      body: {
        access_token: await signer.sign({ typ: "access", e: email, exp: t + ACCESS_TTL_MS }),
        token_type: "Bearer",
        expires_in: Math.floor(ACCESS_TTL_MS / 1000),
        refresh_token: await signer.sign({ typ: "refresh", e: email, fp: clientFp, exp: t + REFRESH_TTL_MS }),
        scope: "inventory.read",
      },
    };
  }

  // POST /token, form-encoded (JSON accepted too).
  async function token(form) {
    const get = (k) => String((form.get ? form.get(k) : form[k]) ?? "");
    const grant = get("grant_type");
    if (grant === "authorization_code") {
      const code = await signer.verify(get("code"), "code", now());
      if (!code) return oauthError(400, "invalid_grant", "The sign-in code is invalid or expired.");
      if (code.fp !== await fingerprint(get("client_id"))) return oauthError(400, "invalid_grant", "The code was issued to a different client.");
      if (get("redirect_uri") && get("redirect_uri") !== code.ru) return oauthError(400, "invalid_grant", "redirect_uri does not match.");
      const verifier = get("code_verifier");
      if (!verifier || (await sha256b64url(verifier)) !== code.cc) return oauthError(400, "invalid_grant", "PKCE verification failed.");
      return issue(code.e, code.fp);
    }
    if (grant === "refresh_token") {
      const r = await signer.verify(get("refresh_token"), "refresh", now());
      if (!r) return oauthError(400, "invalid_grant", "The refresh token is invalid or expired.");
      if (get("client_id") && r.fp !== await fingerprint(get("client_id"))) return oauthError(400, "invalid_grant", "The token was issued to a different client.");
      // A token can't be revoked, so a refresh asks the allowlist again: someone
      // taken off every site stops getting new tokens.
      if (!(await sitesFor(r.e)).length) return oauthError(400, "invalid_grant", "This account no longer has access to any site.");
      return issue(r.e, r.fp);
    }
    return oauthError(400, "unsupported_grant_type", "Use authorization_code or refresh_token.");
  }

  // The email an Authorization header vouches for, or null.
  async function bearer(header) {
    const m = /^Bearer\s+(\S+)$/i.exec(String(header || ""));
    if (!m) return null;
    const p = await signer.verify(m[1], "access", now());
    return p ? p.e : null;
  }

  return { metadata, resourceMetadata, register, authorize, complete, token, bearer };
}
