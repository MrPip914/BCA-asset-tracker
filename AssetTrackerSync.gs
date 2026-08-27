/**
 * BCA Asset Tracker — Google Sheets backend
 * ------------------------------------------
 * Paste this into Extensions > Apps Script for a Google Sheet, then
 * Deploy > New deployment > Web app (Execute as: Me, Access: Anyone with the link).
 *
 * Design: the app keeps its whole state in memory and sends the FULL
 * snapshot on every save (that's how it already works with its built-in
 * storage), and doGet() reads all tabs back into that same shape. Simple
 * and always consistent at this data size (tens to low hundreds of assets).
 *
 * doPost() rewrites the Assets/Comments/Changes/Allocations/Maintenance
 * tabs together, but only when the client reports (`body._dirty.assets`)
 * that asset-related data actually changed — most config-only actions
 * (managed-list edits, adding a custom column) don't touch these at all.
 * Config is similarly gated on `body._dirty.config`. AuditLog is handled
 * differently: since audit entries are only ever appended to, never edited
 * or deleted, it's appended-to (`appendNewRows_`) rather than rewritten,
 * so an ever-growing history doesn't get more expensive to save over time.
 * Missing `_dirty` (an older client, or a direct API call) defaults to
 * "rewrite everything" — the original behavior, kept as the safe fallback.
 *
 * Every save is a FULL overwrite of the domains it touches, so a client
 * saving a snapshot it loaded before someone else's save would silently drop
 * that other person's work. Each of those same three domains therefore carries
 * a revision counter in the Config tab: doGet hands them out, the client posts
 * back the ones it loaded, and doPost — inside the same lock as the writes —
 * refuses the whole save if any domain it's about to write has moved on since.
 * See "Optimistic concurrency" in doPost. A payload with no `_revisions` (an
 * older client, or a direct API call) is still accepted and written, the same
 * fallback philosophy as a missing `_dirty`.
 *
 * Tabs created automatically on first run: Assets, Comments, Changes,
 * Allocations, Maintenance, Breakers, Circuits, BreakerTypes, AuditLog, Config.
 */

// Bump this number any time this file changes, so a stuck deployment is obvious
// instead of silently serving stale logic.
//
// JUST THE NUMBER. This used to carry a description of each change, which grew
// into a full changelog several paragraphs long, in the one place it was least
// readable — a string constant, duplicated in two files that had to match
// character for character. They drifted by a single word at v18 and would have
// shown a permanent false "Backend outdated" warning. What changed in a version
// belongs in the git history and CLAUDE.md, which is where it now lives.
//
// Two ways to check what's actually LIVE (not just what's pasted in the
// editor — those can differ if "New version" wasn't created on deploy):
//   1. Visit the deployed /exec URL directly in a browser and Ctrl+F for
//      "scriptVersion" in the raw JSON.
//   2. Compare this string to FRONTEND_SCRIPT_VERSION at the top of index.html.
const SCRIPT_VERSION = "v29";

const SHEET_NAMES = {
  assets: "Assets",
  comments: "Comments",
  changes: "Changes",
  allocations: "Allocations",
  maintenance: "Maintenance",
  breakers: "Breakers",
  circuits: "Circuits",
  breakerTypes: "BreakerTypes",
  audit: "AuditLog",
  config: "Config",
};

// Flat fields stored directly as Asset columns (everything except the
// per-asset arrays, which live in their own tabs keyed by asset label).
// "room"/"building" hold a Room/Building asset's own display name (only
// meaningful on that asset's own row).
//
// "parentId" is where an asset SITS: the stable `label` of the asset that
// contains it — a device's Room, a Room's Building, a closet's Room. One
// reference, so the hierarchy is ordinary data and can be any depth, rather than
// the two fixed levels roomId/buildingId could express. Empty is valid and means
// "Unassigned" (a Building has no container; so does a spare in a drawer).
//
// Storage here is deliberately PERMISSIVE: this script does not check that a
// parent exists, is of a sensible type, or doesn't close a loop. That matches
// every other rule in this app — nothing is validated server-side — and the
// frontend both enforces the rules on entry and tolerates/flags parentage that
// arrived some other way (a hand-edited sheet, a bulk script).
//
// "name" is every asset's own optional display name, added in v23. "subType" is
// the Bulk Item sub-type, added in v24.
//
// SIX COLUMNS WERE DROPPED HERE IN v25, having been kept only so each change
// that superseded them stayed reversible: "roomId"/"buildingId" (the pre-v15
// two-level location, replaced by parentId), "room"/"building"/"campus" (the
// per-type name columns, replaced by name), and "itemName" (replaced by
// subType). Every one had been superseded for at least one deployed version, and
// each row's replacement value was written by the whole-tab rewrite that follows
// any save, so nothing was read from them any more.
//
// Removing a name from this list DELETES that column from the sheet on the next
// asset-domain save — writeTable_ clears the tab and writes these headers. So
// this list is the schema, and shortening it is a destructive migration: be sure
// the replacement column is populated on every row first. The sheet's own
// version history is the only way back.
const ASSET_FIELDS = [
  "label", "name", "type", "subType", "screenSize", "hostname", "parentId",
  // `personIds` (v28) is the assignment: comma-joined labels of User assets, the
  // app's first many-to-many between assets. `person` is the pre-v28 slash-joined
  // list of NAMES, kept and still written so the change stays reversible and an
  // un-migrated row still resolves -- same shape as parentId/roomId in v17.
  "brand", "model", "serial", "person", "personIds", "peripherals", "notes",
  "totalQuantity", "purchaseDate", "warrantyUntil", "status",
  "panelSlotCount", "panelLayout",
];

// The Assets tab's real column set: the fixed schema above PLUS whatever custom
// columns the user has added. Custom columns live in Config's `columns` blob, so
// ASSET_FIELDS alone can never know about them — and writeTable_ writes only the
// columns it is handed, which is why anything typed into a custom column used to
// be silently dropped on save while the column itself went on appearing.
//
// Read needs no equivalent: readTable_ ignores the header list it is given and
// returns whatever the sheet actually holds, so a column that gets WRITTEN comes
// back on its own.
//
// Prefers the columns carried by this request, falling back to what Config
// already holds — an old client, or any direct API call, posts assets without a
// column list, and dropping the custom columns in that case would delete real
// data from the sheet.
function customColumnKeys_(bodyColumns, configMap) {
  let columns = Array.isArray(bodyColumns) ? bodyColumns : null;
  if (!columns) {
    try {
      const stored = configMap && configMap.columns;
      columns = Array.isArray(stored) ? stored : JSON.parse(stored || "[]");
    } catch (err) {
      columns = [];
    }
  }
  const keys = [];
  (columns || []).forEach(c => {
    const key = c && c.custom && c.key ? String(c.key) : "";
    // Never let a custom key shadow a schema field or duplicate another —
    // writeTable_ would write that column twice and readTable_ would keep only
    // the last one.
    if (key && ASSET_FIELDS.indexOf(key) === -1 && keys.indexOf(key) === -1) keys.push(key);
  });
  return keys;
}


// Breakers are scoped to a Panel asset (panelLabel); Circuits are scoped to a
// Breaker (breakerId), not directly to the Panel — chain is Circuit -> Breaker
// -> Panel. Both need a real id (not array position) since they get swapped/
// moved and other records point at them.
//
// Every physical slot has two halves, addressed "Na"/"Nb" (e.g. "1a", "1b") —
// a Breaker's footprint is the set of half-cells it occupies, not a list of
// whole slot numbers. A basic single-pole breaker in slot 1 is cells
// ["1a","1b"]; a double-pole across slots 1/3 is ["1a","1b","3a","3b"]; a
// tandem pair is two breaker rows, cells ["1a"] and ["1b"]. Poles are NOT
// stored — derived from the count of distinct slots a breaker's cells touch
// (see BREAKER_TYPES_ARCHITECTURE.md section 2). This one addressing scheme
// covers every breaker shape (single, double-pole, tandem, quad, and mixed
// offset configurations) without a separate "mount" enum.
//
// A multi-breaker unit (tandem, quad, or any BreakerType with >1 member) is a
// GROUP of individual Breaker rows, each with its own id, cells, ampRating,
// status, etc., created together and linked by a shared "groupId" (blank for
// a standalone breaker not placed from a multi-member type). Circuits attach
// to these rows exactly like any other breaker (via breakerId) — no separate
// per-circuit bookkeeping needed.
//
// "breakerTypeId" records which BreakerTypes catalog entry a breaker was
// placed from, for display only (e.g. a "Tandem" badge) — not a live link;
// editing a placed breaker never touches the type or its sibling rows.
const BREAKER_FIELDS = ["id", "panelLabel", "cells", "ampRating", "status", "serial", "installedDate", "notes", "groupId", "breakerTypeId"];
// "notes" is the free-text, multi-line "what's actually connected" field — it can
// contain embedded newlines (one callout per line), which Sheets stores fine in a
// single cell. The legacy "description" column is gone: the frontend collapsed the
// old label/description pair down to `label` alone, so nothing reads or writes it.
//
// "panelLabel" is the circuit's OWN link to its panel, not a copy of the breaker's.
// A circuit's panel used to be implied entirely by its breaker (breakerId -> that
// Breaker row's panelLabel), which left no way to record a circuit that exists but
// isn't wired to a breaker yet — the thing "unassigned circuits" are. So the panel
// is now stored on the circuit directly: a row with a breakerId is attached to that
// breaker as before, and a row with an EMPTY breakerId belongs to the panel named
// here and nothing else. panelLabel is the authoritative panel either way (doPost
// always derives it from the panel it's iterating, so it can't drift from the
// breaker's), which also means moving a circuit between breakers on one panel never
// has to touch it. No migration is needed for rows written before this column
// existed: every one of them has a breakerId, so they still attach to their breaker
// on read, and each gets its panelLabel filled in the next time the panel is saved.
const CIRCUIT_FIELDS = ["id", "breakerId", "panelLabel", "label", "roomsServed", "feedsPanelLabel", "notes"];
// A user-defined catalog of reusable breaker configurations — see
// BREAKER_TYPES_ARCHITECTURE.md. "members" is a JSON-encoded array of
// { cells, ampRating }, where cells use RELATIVE slot indices (a type's own
// 1st/2nd/... slot, not real panel slot numbers) — resolved to absolute
// cells at placement time in the frontend. Global/shared across all panels,
// not scoped to any one asset — its own flat tab, like Breakers/Circuits.
const BREAKER_TYPE_FIELDS = ["id", "name", "slotSpan", "members"];

// AuditLog's columns. `related` is LAST and any future column must be too: this
// is the one tab written by appendNewRows_ rather than writeTable_, so its header
// row is not rewritten on every save and existing rows keep their column
// positions. Inserting a name mid-list would shift every stored row's meaning.
//
// This list was duplicated at the doGet read and the doPost append until v27.
// They have to agree exactly -- readTable_ keys off the sheet's own header row,
// so a name in one and not the other reads back as undefined with no error.
const AUDIT_FIELDS = [
  "assetLabel", "assetType", "action", "field", "from", "to",
  "room", "quantity", "previousQuantity", "note", "at", "by",
  // v27: comma-joined `label:role` pairs naming the OTHER assets an entry
  // concerns and how -- "BCR0002:from,BCR0005:to". See relate() in index.html.
  "related",
];

// --- Public panel view (anonymous, read-only) --------------------------------
// Physical panels carry QR stickers pointing at panel.html?p=<label>, which any
// staff member, electrician, or contractor can scan without logging in. That
// page reads doGet(?panel=<label>) — a SEPARATE, deliberately anonymous
// endpoint returning one panel and nothing else. The parameterless doGet (the
// full snapshot) is the one that gets a token when auth lands; this one stays
// open by design.
//
// The whitelists below are the entire privacy boundary. panel.html is NOT what
// keeps anything private — someone curling the public URL gets exactly these
// fields, so anything not named here (person, serial at either level, hostname,
// purchaseDate, warrantyUntil, status, notes on the panel ASSET, and every other
// asset in the inventory) is unreachable through this path rather than merely
// unrendered. Adding a field to a *_FIELDS list below publishes it; that's the
// only way to publish one, which is the point.
//
// Note what's deliberately IN here: a breaker's `notes` and a circuit's `notes`
// are the "what's actually connected" free text, the single most useful thing
// for someone standing at an open panel door. Only the panel asset's own notes
// (procurement/maintenance commentary, not wiring) are withheld.
//
// PUBLIC_PANEL_FIELDS carried roomId/buildingId when this was first written
// against the fixed two-field location model. Nothing ever read them — the page
// renders the resolved roomName/buildingName below — so they were dropped rather
// than swapped for parentId when the parent chain landed. A public endpoint
// should publish the fewest fields that still answer the question.
const PUBLIC_PANEL_FIELDS = ["label", "panelSlotCount", "panelLayout"];
const PUBLIC_BREAKER_FIELDS = ["id", "cells", "ampRating", "groupId", "breakerTypeId", "notes"];
const PUBLIC_CIRCUIT_FIELDS = ["id", "breakerId", "label", "roomsServedIds", "feedsPanelLabel", "notes"];
const PUBLIC_BREAKER_TYPE_FIELDS = ["id", "name", "slotSpan", "members"];

// Copies ONLY the named fields off a source object. Absent keys come back as ""
// rather than being omitted, so the public payload's shape doesn't change based
// on which cells happen to be blank in the sheet.
function pickPublic_(source, fields) {
  const out = {};
  fields.forEach(f => {
    const v = source[f];
    out[f] = (v === undefined || v === null) ? "" : v;
  });
  return out;
}

// Where a row sits. This carried a roomId/buildingId fallback until v25, for the
// window when the sheet still held the pre-v15 pair; those columns are gone, so
// parentId is now the only answer there is.
function effectiveParentId_(row) {
  return String((row && row.parentId) || "").trim();
}

// The nearest ancestor of a given type, walking up parentId. Loop-safe by the
// same visited-set rule every chain walk in the frontend uses — storage is
// permissive, so a hand-edited sheet really can contain "A inside B inside A",
// and an unguarded walk here would hang a public page rather than a private one.
function nearestAncestorRow_(startRow, byLabel, type) {
  const seen = {};
  let cur = byLabel[effectiveParentId_(startRow)];
  let depth = 0;
  while (cur && !seen[cur.label] && depth < 50) {
    if (cur.type === type) return cur;
    seen[cur.label] = true;
    cur = byLabel[effectiveParentId_(cur)];
    depth++;
  }
  return null;
}

// --- Optimistic concurrency --------------------------------------------------
// One revision counter per save domain — the same three domains `_dirty`
// already describes. Per-domain rather than one global counter so two people
// editing unrelated things (a managed list vs an asset) never collide: only a
// domain this save actually writes can conflict.
const REVISION_DOMAINS = ["assets", "config", "breakerTypes"];
// Config-tab key each counter is stored under (rev_assets, rev_config,
// rev_breakerTypes), alongside nextAssetNumber. Prefixed so it can't collide
// with a managed-list key.
const REVISION_KEY_PREFIX = "rev_";

// The Config tab as a raw { key: cellValue } map — values are left as stored
// (JSON strings), NOT parsed, so keys this request isn't changing can be
// written straight back untouched when the tab gets rewritten.
function readConfigMap_() {
  const map = {};
  readTable_(SHEET_NAMES.config, ["key", "value"]).forEach(r => {
    if (r.key !== "" && r.key !== null && r.key !== undefined) map[r.key] = r.value;
  });
  return map;
}

// Current revision per domain. Missing/blank/garbage reads as 0 — which is
// also what a client with no stored revisions posts, so an existing sheet (or
// one last written by a backend predating this) starts out matched rather than
// conflicting on its very first save after deploy.
function readRevisions_(configMap) {
  const revisions = {};
  REVISION_DOMAINS.forEach(d => {
    const raw = Number(configMap[REVISION_KEY_PREFIX + d]);
    revisions[d] = isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  });
  return revisions;
}

// --- Authentication ----------------------------------------------------------
// Google Sign-In. The browser signs in against the OAuth client below and sends
// the resulting ID token with every request; this file verifies that token with
// Google, then checks the email against the allowlist stored in Config
// (`authUsers`).
//
// Two separate questions, deliberately kept apart:
//   1. "Is this really who they claim to be?"  -> Google answers, verifyIdToken_.
//   2. "Are they allowed in, and may they write?" -> the allowlist answers.
// The OAuth client is configured External, so ANY Google account can satisfy (1).
// That grants nothing on its own — (2) is the actual gate, and it lives here in
// the sheet rather than in Google's console so it can be managed from the app.
//
// The anonymous ?panel= branch of doGet predates this and STAYS anonymous by
// design — it's the QR-code page on physical panels. It was written as its own
// branch rather than an exemption inside the authenticated path, so nothing
// here has to carve a hole for it.
const OAUTH_CLIENT_ID = "512657381831-4so7t5t2shqn8nbgrgktsg6s37podqji.apps.googleusercontent.com";

// Always an editor, whatever the allowlist says — the escape hatch that makes
// lockout impossible. Every config save rewrites the Config tab wholesale, so a
// bad save (or a client predating `authUsers` that posts none) could otherwise
// empty the allowlist and leave nobody able to sign in and repair it. Changing
// this line needs the Apps Script editor, which only the sheet owner can open.
const OWNER_EMAIL = "mrpip914@gmail.com";

const ROLE_EDITOR = "editor";
const ROLE_VIEWER = "viewer";

// Verifies a Google ID token, returning { email, name } or null for anything
// that doesn't check out. Uses Google's tokeninfo endpoint rather than checking
// the JWT signature by hand — Apps Script has no RS256 primitive, and this is
// one UrlFetch on a request that's already doing spreadsheet I/O, so the added
// latency is noise.
/**
 * SETUP HELPER — run this by hand from the Apps Script editor (pick it in the
 * toolbar's function dropdown and press Run) after any deploy that changes what
 * the script is allowed to do. It exists because of a real trap:
 *
 * v18 introduced the first UrlFetchApp call in this file, which needs the
 * script.external_request permission. Running doGet() to trigger the consent
 * prompt does NOT work — with no event parameter it returns at the first branch
 * and never reaches an outbound call, so nothing forces the question, and the
 * web app then fails at runtime with "You do not have permission to call
 * UrlFetchApp.fetch" while the editor looks perfectly healthy.
 *
 * This function does nothing but make one outbound request, so it cannot dodge
 * the prompt. The token it sends is deliberately junk: Google answers HTTP 400,
 * which is a complete success for our purposes — it proves the call left the
 * building. Check the execution log for the result.
 *
 * After granting the permission, redeploy (Manage deployments > New version):
 * the web app runs under the authorization captured at deploy time, so a grant
 * made afterwards doesn't reach it until the deployment is updated.
 */
function forceAuthorizeExternalRequests() {
  const res = UrlFetchApp.fetch(
    "https://oauth2.googleapis.com/tokeninfo?id_token=deliberately-not-a-real-token",
    { muteHttpExceptions: true }
  );
  const code = res.getResponseCode();
  Logger.log("Reached Google — HTTP " + code + ". Outbound requests are authorized. "
    + "(400 is the expected answer to a junk token and means this worked.)");
  return code;
}

// Returns { ok: true, email, name } or { ok: false, detail } — never a bare
// null. `detail` names WHICH check failed, and is passed back to the client and
// shown on the sign-in screen.
//
// That's a deliberate reversal of the usual "give a failed login nothing to work
// with". The things this can report — your token was minted for a different app,
// the script couldn't reach Google, your clock says the token expired — say
// nothing about whether an account exists or is allowed; that's the allowlist's
// job, and it stays vague. What they do is turn a silent bounce back to the
// sign-in screen, which is undebuggable from the outside and was exactly the
// symptom that cost a round trip here, into a sentence naming the cause.
function verifyIdToken_(idToken) {
  if (!idToken || typeof idToken !== "string") {
    return { ok: false, detail: "No sign-in token was sent with the request." };
  }
  let res;
  try {
    res = UrlFetchApp.fetch(
      "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken),
      { muteHttpExceptions: true }
    );
  } catch (err) {
    // Most likely the script's permission to make external requests, which is a
    // scope this file only started needing in v18.
    return { ok: false, detail: "The script couldn't reach Google to check the sign-in: " + err.message };
  }
  const code = res.getResponseCode();
  const bodyText = res.getContentText();
  if (code !== 200) {
    return { ok: false, detail: "Google rejected the sign-in token (HTTP " + code + "): " + bodyText.slice(0, 300) };
  }
  let info;
  try {
    info = JSON.parse(bodyText);
  } catch (err) {
    return { ok: false, detail: "Google's reply wasn't readable: " + bodyText.slice(0, 200) };
  }
  // aud proves the token was minted for THIS app. Without this check, a token
  // issued to any other site using Google Sign-In could be replayed here.
  if (info.aud !== OAUTH_CLIENT_ID) {
    return {
      ok: false,
      detail: "This sign-in was issued for a different app. The script expects client id ending "
        + String(OAUTH_CLIENT_ID).slice(-30) + " but the token names " + String(info.aud || "(none)").slice(-30) + ".",
    };
  }
  // Comes back as the STRING "true", not a boolean.
  if (String(info.email_verified) !== "true") {
    return { ok: false, detail: "That Google account's email address isn't verified." };
  }
  if (!info.email) {
    return { ok: false, detail: "Google didn't include an email address with the sign-in." };
  }
  // tokeninfo rejects expired tokens itself; re-checking costs nothing and
  // means this doesn't silently depend on that staying true.
  const exp = Number(info.exp);
  if (isFinite(exp) && exp * 1000 < Date.now()) {
    return { ok: false, detail: "That sign-in had already expired." };
  }
  return { ok: true, email: String(info.email).toLowerCase().trim(), name: info.name || "" };
}

// Normalizes an allowlist from any source — the sheet, or a client's save — into
// [{ email, name, role }] with lowercased emails, no duplicates, and OWNER_EMAIL
// always present as an editor. Shared by both directions on purpose: the list
// that gets written back is cleaned by exactly the same rules as the list that
// gets read, so a save can't introduce a shape that a later read chokes on.
function sanitizeAuthUsers_(list) {
  if (!Array.isArray(list)) list = [];
  const byEmail = {};
  const cleaned = [];
  list
    .filter(u => u && u.email)
    .forEach(u => {
      const email = String(u.email).toLowerCase().trim();
      if (!email || byEmail[email]) return;
      byEmail[email] = true;
      cleaned.push({
        email: email,
        name: u.name || "",
        // Anything not explicitly the viewer role is an editor, so a typo in a
        // stored value fails toward the app's long-standing behavior rather
        // than silently stripping someone's ability to work.
        role: u.role === ROLE_VIEWER ? ROLE_VIEWER : ROLE_EDITOR,
      });
    });
  if (!byEmail[OWNER_EMAIL]) {
    cleaned.unshift({ email: OWNER_EMAIL, name: "Owner", role: ROLE_EDITOR });
  }
  return cleaned;
}

// The allowlist as stored in Config. OWNER_EMAIL is always present as an editor
// whether or not the stored list mentions it — see the constant above.
function readAuthUsers_(configMap) {
  let list = [];
  try {
    if (configMap.authUsers) list = JSON.parse(configMap.authUsers);
  } catch (err) {
    list = [];
  }
  return sanitizeAuthUsers_(list);
}

// Second half of the answer: a verified identity is checked against the
// allowlist. Split from verifyIdToken_ so the two halves can run in different
// places — verification does a network round trip to Google and belongs OUTSIDE
// the script lock, while the allowlist read has to happen INSIDE it (reading
// Config mid-rewrite would show an empty list and reject everyone). Holding a
// cross-execution mutex across a network call would serialize every save in the
// app behind it.
//
// Returns { ok: true, email, name, role, users } or { ok: false, reason, error }.
// `reason` is what the frontend branches on: "signin" means the token was
// missing/expired/bogus (show the sign-in button again), "notallowed" means a
// real, verified person who simply isn't on the list (say so, rather than
// looping them through a sign-in that will keep succeeding and keep failing).
function authorizeIdentity_(identity, configMap) {
  const users = readAuthUsers_(configMap);
  const match = users.filter(u => u.email === identity.email)[0];
  if (!match) {
    return {
      ok: false,
      reason: "notallowed",
      email: identity.email,
      error: identity.email + " isn't on the access list for this asset tracker. Ask an editor to add you.",
    };
  }
  return {
    ok: true,
    email: identity.email,
    // The stored name wins over Google's: it's what an editor typed for this
    // person here, and it's what already stamps their rows in the audit log.
    name: match.name || identity.name || identity.email,
    role: match.role,
    users: users,
  };
}

// --- Sessions ----------------------------------------------------------------
// Google's ID token lasts about an hour and browsers can't renew one silently
// (Chrome's move to FedCM made auto_select undependable). So the token is used
// ONCE, at sign-in, to establish who someone is; after that this script issues
// its own session and the browser presents that instead.
//
// Sessions live in Script Properties, not in the spreadsheet, for two reasons:
// anyone with the Sheet can read every tab, and doPost rewrites tabs wholesale —
// a session table sitting in there would be both readable and destroyable by
// ordinary saves.
//
// Stateful rather than a signed stateless token on purpose: a record that can be
// deleted is what makes sign-out and revocation real. A signed token would be
// slightly less code and impossible to withdraw before it expired.
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SESSION_PREFIX = "session_";
// Sliding expiry is only rewritten once the stored value has drifted by this
// much. Without the throttle every single request would write a property —
// pointless quota churn to move an expiry by a few seconds.
const SESSION_TOUCH_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

function sessionKey_(id) { return SESSION_PREFIX + id; }

// Two UUIDs, not one: this is a bearer credential good for a week, and the extra
// entropy costs nothing.
function newSessionId_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "");
}

function createSession_(email) {
  const props = PropertiesService.getScriptProperties();
  sweepExpiredSessions_(props);
  const id = newSessionId_();
  props.setProperty(sessionKey_(id), JSON.stringify({
    email: String(email).toLowerCase().trim(),
    expires: Date.now() + SESSION_TTL_MS,
  }));
  return id;
}

// Returns { email, expires } or null. Deletes anything expired or unreadable as
// it goes, so a bad record can't linger and can't be retried.
function readSession_(sessionId) {
  if (!sessionId || typeof sessionId !== "string") return null;
  // Shape check before touching storage: sessionId lands in a property key, and
  // this keeps a crafted value from being used to probe unrelated properties.
  if (!/^[0-9a-f]{40,80}$/i.test(sessionId)) return null;
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(sessionKey_(sessionId));
  if (!raw) return null;
  let session;
  try {
    session = JSON.parse(raw);
  } catch (err) {
    props.deleteProperty(sessionKey_(sessionId));
    return null;
  }
  if (!session || !session.email || !(Number(session.expires) > Date.now())) {
    props.deleteProperty(sessionKey_(sessionId));
    return null;
  }
  return session;
}

// Sliding expiry: any activity pushes the deadline back a full week, so someone
// who uses the app regularly is never asked to sign in again, while a forgotten
// device still ages out.
function touchSession_(sessionId, session) {
  const next = Date.now() + SESSION_TTL_MS;
  if (next - Number(session.expires) < SESSION_TOUCH_THRESHOLD_MS) return;
  PropertiesService.getScriptProperties().setProperty(sessionKey_(sessionId), JSON.stringify({
    email: session.email,
    expires: next,
  }));
}

function deleteSession_(sessionId) {
  if (!sessionId || typeof sessionId !== "string") return;
  if (!/^[0-9a-f]{40,80}$/i.test(sessionId)) return;
  try {
    PropertiesService.getScriptProperties().deleteProperty(sessionKey_(sessionId));
  } catch (err) { /* already gone */ }
}

// Ends every session belonging to an address — what makes removing someone from
// the allowlist take effect on their devices rather than only on their next
// request. (The per-request allowlist check already blocks them; this also
// reclaims the storage and drops them to the sign-in screen promptly.)
function deleteSessionsForEmail_(email) {
  const target = String(email || "").toLowerCase().trim();
  if (!target) return;
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  Object.keys(all).forEach(key => {
    if (key.indexOf(SESSION_PREFIX) !== 0) return;
    try {
      const s = JSON.parse(all[key]);
      if (s && String(s.email).toLowerCase() === target) props.deleteProperty(key);
    } catch (err) {
      props.deleteProperty(key);
    }
  });
}

// Expired records are only noticed when someone presents them, so without a
// sweep an abandoned session would sit in storage forever. Runs at sign-in,
// which is rare enough to be free and frequent enough to keep storage bounded.
function sweepExpiredSessions_(props) {
  try {
    const all = props.getProperties();
    const now = Date.now();
    Object.keys(all).forEach(key => {
      if (key.indexOf(SESSION_PREFIX) !== 0) return;
      try {
        const s = JSON.parse(all[key]);
        if (!s || !(Number(s.expires) > now)) props.deleteProperty(key);
      } catch (err) {
        props.deleteProperty(key);
      }
    });
  } catch (err) { /* non-fatal — a sweep that fails just leaves stale records */ }
}

// Resolves a request's sessionId to an authorized identity. The allowlist is
// re-read on EVERY request, so removing someone or dropping them to view-only
// takes effect on their next action rather than whenever their session expires.
function authorizeSession_(sessionId, configMap) {
  const session = readSession_(sessionId);
  if (!session) {
    return { ok: false, reason: "signin", error: "Your session has expired. Sign in again to continue." };
  }
  const auth = authorizeIdentity_({ email: session.email, name: "" }, configMap);
  if (auth.ok) touchSession_(sessionId, session);
  return auth;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function readTable_(name, headers) {
  const sheet = getSheet_(name);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const fileHeaders = values[0];
  return values.slice(1)
    .filter(row => row.some(cell => cell !== "" && cell !== null))
    .map(row => {
      const obj = {};
      fileHeaders.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });
}

function writeTable_(name, headers, rows) {
  const sheet = getSheet_(name);
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length > 0) {
    const data = rows.map(row => headers.map(h => (row[h] === undefined || row[h] === null ? "" : row[h])));
    // Force plain-text format before writing — otherwise Sheets auto-detects a
    // date-like string (e.g. a maintenance item's "yyyy-MM-dd" lastPerformed)
    // and silently converts the cell to a real Date, which then reads back as a
    // full ISO timestamp instead of the plain date string the app expects.
    const range = sheet.getRange(2, 1, data.length, headers.length);
    range.setNumberFormat("@");
    range.setValues(data);
  }
}

// Appends only the rows beyond what's already stored, instead of clearing and
// rewriting the whole tab — safe only for tables that are pure append logs
// (nothing ever edits or deletes an existing row). AuditLog is the only one
// that qualifies today. If the caller's array is shorter than or equal to
// what's already stored (a stale client, or nothing new), this is a no-op —
// it never truncates existing history.
function appendNewRows_(name, headers, rows) {
  const sheet = getSheet_(name);
  const lastRow = sheet.getLastRow();
  // Write the header row when the tab is empty -- and ALSO widen it when a new
  // column has been added to `headers` since the tab was created.
  //
  // Without the second case this function fails silently and unrecoverably. It
  // appends values positionally against `headers`, while readTable_ keys each row
  // off the SHEET's own header row; so a column appended under a blank header
  // cell reads back as obj[""], every such column collides on that one key, and
  // the data is gone. Nothing throws, and SCRIPT_VERSION still matches its
  // frontend -- the version check cannot see this, because the script is exactly
  // the version it claims to be.
  //
  // This is the only tab not written by writeTable_ (which clears and rewrites
  // its headers every save), so it is the only place where "add the field to the
  // list and the sheet follows" -- true everywhere else since v25 -- is wrong.
  // Widening only, never shrinking: this tab is an append-only log and dropping a
  // column would strand the values already under it.
  const storedWidth = lastRow === 0 ? 0 : sheet.getLastColumn();
  if (storedWidth < headers.length) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  const existingCount = Math.max(lastRow - 1, 0);
  if (rows.length <= existingCount) return;
  const newRows = rows.slice(existingCount);
  const data = newRows.map(row => headers.map(h => (row[h] === undefined || row[h] === null ? "" : row[h])));
  // See writeTable_'s comment — force text format so a date-like string doesn't
  // get silently converted to a real Date cell.
  const range = sheet.getRange(existingCount + 2, 1, data.length, headers.length);
  range.setNumberFormat("@");
  range.setValues(data);
}

// Wraps a payload as JSON, or as a JSONP call when ?callback= was passed —
// pulled out of doGet so the public panel branch gets the same treatment
// without duplicating it.
function respond_(payload, e) {
  const callback = e && e.parameter && e.parameter.callback;
  if (callback) {
    return ContentService
      .createTextOutput(`${callback}(${JSON.stringify(payload)});`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

// The anonymous per-panel read behind doGet(?panel=<label>) — see the
// PUBLIC_*_FIELDS whitelists above for what it will and won't hand out.
//
// Everything here is assembled by copying named fields onto fresh objects, never
// by deleting fields off a sheet row: a column added to the Assets/Breakers/
// Circuits tabs later is invisible to this endpoint until someone deliberately
// adds it to a whitelist. That's the opposite of a blacklist, which would start
// leaking the moment a new field lands.
// What an asset is called, for the public page. `name` (v23) with the old
// per-type columns as the fallback, so a panel's location renders correctly both
// before the sheet has been rewritten with names and after. Same shape as the
// frontend's nameOf(), minus the label fallback: a blank location should read as
// blank here, not as an Asset ID.
function displayName_(row) {
  if (!row) return "";
  return String(row.name || "").trim();
}

function publicPanelPayload_(requestedLabel) {
  const wanted = String(requestedLabel || "").trim().toUpperCase();
  if (!wanted) return { ok: false, error: "No panel specified." };

  const assetRows = readTable_(SHEET_NAMES.assets, ASSET_FIELDS);
  const panelRow = assetRows.filter(a =>
    a.type === "Electrical Panel" && String(a.label || "").trim().toUpperCase() === wanted
  )[0];
  // Deliberately the same message whether the label names a non-panel asset or
  // nothing at all — a public endpoint shouldn't confirm which asset IDs exist.
  if (!panelRow) return { ok: false, error: "No electrical panel found for that code." };

  // Label -> row, for the parent-chain walks below.
  const byLabel = {};
  assetRows.forEach(a => { byLabel[a.label] = a; });

  const panelLabel = panelRow.label;
  // Read once, filter twice — this panel's own breakers below, and (further
  // down) the single upstream breaker that feeds this panel, which by definition
  // lives on a different one.
  const allBreakerRows = readTable_(SHEET_NAMES.breakers, BREAKER_FIELDS);
  const breakerRows = allBreakerRows.filter(b => b.panelLabel === panelLabel);
  const circuitRows = readTable_(SHEET_NAMES.circuits, CIRCUIT_FIELDS);

  // Circuits are matched by breaker membership first (which is how every row
  // written before v13 — when panelLabel didn't exist as a column — has to be
  // found), and only the breaker-less ones fall back to panelLabel. Same split
  // doGet already does for breakers vs unassignedCircuits.
  function publicCircuit_(c) {
    const projected = pickPublic_({
      id: c.id, breakerId: c.breakerId, label: c.label,
      roomsServedIds: c.roomsServed ? String(c.roomsServed).split(",").map(s => s.trim()).filter(Boolean) : [],
      feedsPanelLabel: c.feedsPanelLabel, notes: c.notes,
    }, PUBLIC_CIRCUIT_FIELDS);
    // pickPublic_ turns a missing array into "", which the renderer would then
    // have to guard on — an empty list is the honest shape for "serves nothing".
    if (!projected.roomsServedIds) projected.roomsServedIds = [];
    return projected;
  }

  const breakers = breakerRows.map(b => {
    const projected = pickPublic_(b, PUBLIC_BREAKER_FIELDS);
    projected.cells = b.cells ? String(b.cells).split(",").map(s => s.trim()).filter(Boolean) : [];
    projected.circuits = circuitRows.filter(c => c.breakerId === b.id).map(publicCircuit_);
    return projected;
  });
  const unassignedCircuits = circuitRows
    .filter(c => String(c.breakerId || "").trim() === "" && c.panelLabel === panelLabel)
    .map(publicCircuit_);

  // Only the catalog entries this panel actually places, not the whole catalog —
  // it's all this page can render, and a shorter payload is the whole reason the
  // public view exists as its own endpoint.
  const usedTypeIds = {};
  breakers.forEach(b => { if (b.breakerTypeId) usedTypeIds[b.breakerTypeId] = true; });
  const breakerTypes = readTable_(SHEET_NAMES.breakerTypes, BREAKER_TYPE_FIELDS)
    .filter(t => usedTypeIds[t.id])
    .map(t => {
      const projected = pickPublic_(t, PUBLIC_BREAKER_TYPE_FIELDS);
      projected.members = t.members ? JSON.parse(t.members) : [];
      return projected;
    });

  // Room NAMES, resolved here rather than by shipping the asset list. A circuit
  // stores roomsServedIds (Room asset labels like "BCR0020"); resolving those on
  // the client is what forces the whole ~107-asset inventory down the wire, which
  // is exactly what this endpoint exists to avoid. Only rooms this panel actually
  // references are included — it's a lookup map, not a room directory.
  const roomNameById = {};
  assetRows.forEach(a => { if (a.type === "Room") roomNameById[a.label] = displayName_(a); });

  const panel = pickPublic_(panelRow, PUBLIC_PANEL_FIELDS);
  // The "where am I" header. A panel's Room and Building are found by walking up
  // the parent chain, so a panel in a closet inside a classroom still reports
  // both — which the old direct roomId/buildingId lookup could not express.
  const panelRoom = nearestAncestorRow_(panelRow, byLabel, "Room");
  const panelBuilding = nearestAncestorRow_(panelRow, byLabel, "Building");
  panel.roomName = panelRoom ? displayName_(panelRoom) : "";
  panel.buildingName = panelBuilding ? displayName_(panelBuilding) : "";

  const referencedRoomIds = {};
  breakers.forEach(b => b.circuits.forEach(c => (c.roomsServedIds || []).forEach(id => { referencedRoomIds[id] = true; })));
  unassignedCircuits.forEach(c => (c.roomsServedIds || []).forEach(id => { referencedRoomIds[id] = true; }));
  if (panelRoom) referencedRoomIds[panelRoom.label] = true;
  const rooms = {};
  Object.keys(referencedRoomIds).forEach(id => {
    if (roomNameById[id] !== undefined) rooms[id] = roomNameById[id];
  });

  // "Fed from" is never stored on a panel — it's found by asking which circuit
  // anywhere feeds this one (the same computed-not-stored rule the parent chain
  // follows). Worth the extra lookup here: at a sub-panel, "where's my upstream
  // breaker" is the other question someone at the door actually has. Only the
  // upstream panel's label/room and the feeding breaker's cells go out — its
  // amps, serial, and every other breaker on it stay behind.
  let fedFrom = null;
  const feedingCircuit = circuitRows.filter(c => c.feedsPanelLabel === panelLabel)[0];
  if (feedingCircuit) {
    const feedingBreaker = allBreakerRows.filter(b => b.id === feedingCircuit.breakerId)[0];
    const upstreamLabel = feedingBreaker ? feedingBreaker.panelLabel : (feedingCircuit.panelLabel || "");
    const upstreamPanel = assetRows.filter(a => a.label === upstreamLabel && a.type === "Electrical Panel")[0];
    const upstreamRoom = upstreamPanel ? nearestAncestorRow_(upstreamPanel, byLabel, "Room") : null;
    fedFrom = {
      panelLabel: upstreamLabel,
      panelRoomName: upstreamRoom ? displayName_(upstreamRoom) : "",
      circuitLabel: feedingCircuit.label || "",
      cells: feedingBreaker && feedingBreaker.cells
        ? String(feedingBreaker.cells).split(",").map(s => s.trim()).filter(Boolean)
        : [],
    };
  }

  return {
    ok: true,
    scriptVersion: SCRIPT_VERSION,
    panel,
    breakers,
    unassignedCircuits,
    breakerTypes,
    rooms,
    fedFrom,
  };
}

function doGet(e) {
  // The public per-panel branch. Checked before anything else reads a tab, so
  // an anonymous request never touches the full-snapshot path at all — when that
  // path gets a token, this one is already structurally separate from it rather
  // than being an exemption inside it.
  const panelParam = e && e.parameter && e.parameter.panel;
  if (panelParam) {
    // Same lock the full read takes, and for a sharper reason: writeTable_
    // clear()s a tab before writing it, so an unlocked read landing mid-save can
    // legitimately see an empty Breakers tab and render a panel with no breakers
    // in it — which on a public page reads as "this panel is empty", not "try
    // again". Never a write path regardless: doPost is untouched and unreachable
    // from here.
    const publicLock = LockService.getScriptLock();
    publicLock.waitLock(10000);
    try {
      return respond_(publicPanelPayload_(panelParam), e);
    } catch (err) {
      return respond_({ ok: false, error: "Could not load that panel." }, e);
    } finally {
      publicLock.releaseLock();
    }
  }

  // Everything below this point used to be the anonymous full read — the entire
  // inventory to anyone holding the URL. It now lives behind doPost's op:"read",
  // which can carry an ID token in its request BODY. A GET can only carry one in
  // the query string, which would write a live credential into browser history
  // and Google's request logs. See loadData() in index.html.
  //
  // scriptVersion is deliberately still reported without a token: opening the
  // /exec URL in a browser to see which version is actually deployed is a
  // documented diagnostic (see the SCRIPT_VERSION comment at the top of this
  // file), and it's the one thing that has to keep working unauthenticated.
  return respond_({
    ok: false,
    authFailed: true,
    reason: "signin",
    scriptVersion: SCRIPT_VERSION,
    error: "This endpoint requires sign-in.",
  }, e);
}

// Sign-in: the ONE place a Google ID token is accepted. Verifies it, checks the
// allowlist, issues a week-long session, and returns the inventory in the same
// response so signing in stays a single round trip.
function handleSignIn_(body, e) {
  // Verified outside the lock — it's a network round trip to Google.
  const identity = verifyIdToken_(body.idToken);
  if (!identity.ok) {
    return respond_({
      ok: false,
      authFailed: true,
      reason: "signin",
      error: "Sign in with Google to use the asset tracker.",
      detail: identity.detail,
      scriptVersion: SCRIPT_VERSION,
    }, e);
  }
  return handleAuthenticatedRead_({ _identity: identity }, e);
}

// The authenticated full read. Reached two ways: from handleSignIn_ with a
// freshly verified Google identity, or from doPost({op:"read"}) with a session
// id. Either way the allowlist decides, and the response carries the session.
//
// Takes its own lock, so doPost routes here BEFORE acquiring the write lock —
// Apps Script's script lock is a cross-execution mutex, not a reentrant one, and
// acquiring it twice in one execution would deadlock against itself. The lock
// matters for the same reason it does on the public panel branch: writeTable_
// clear()s a tab before rewriting it, so an unlocked read landing mid-save can
// legitimately observe an empty tab.
function handleAuthenticatedRead_(body, e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // Allowlist read under the same lock as the data: outside it, a Config
    // rewrite in flight would show an empty list and reject everyone.
    const configMap = readConfigMap_();

    // A brand-new sign-in mints a session; an existing one is resolved and slid
    // forward. `sessionId` goes back either way so the client always holds the
    // current one without needing to know which case it was.
    let auth;
    let sessionId;
    if (body._identity) {
      auth = authorizeIdentity_(body._identity, configMap);
      if (auth.ok) sessionId = createSession_(auth.email);
    } else {
      sessionId = body.sessionId;
      auth = authorizeSession_(sessionId, configMap);
    }

    if (!auth.ok) {
      return respond_({
        ok: false,
        authFailed: true,
        reason: auth.reason,
        email: auth.email || "",
        error: auth.error,
        scriptVersion: SCRIPT_VERSION,
      }, e);
    }

    const assetRows = readTable_(SHEET_NAMES.assets, ASSET_FIELDS);
    const commentRows = readTable_(SHEET_NAMES.comments, ["assetLabel", "text", "at", "by"]);
    const changeRows = readTable_(SHEET_NAMES.changes, ["assetLabel", "changeType", "vendor", "cost", "note", "at", "by"]);
    const allocationRows = readTable_(SHEET_NAMES.allocations, ["assetLabel", "room", "quantity"]);
    const maintenanceRows = readTable_(SHEET_NAMES.maintenance, [
      "assetLabel", "task", "frequencyLabel", "frequencyDays", "lastPerformed", "owner", "at", "by",
    ]);
    const breakerRows = readTable_(SHEET_NAMES.breakers, BREAKER_FIELDS);
    const circuitRows = readTable_(SHEET_NAMES.circuits, CIRCUIT_FIELDS);
    const breakerTypeRows = readTable_(SHEET_NAMES.breakerTypes, BREAKER_TYPE_FIELDS);
    const auditRows = readTable_(SHEET_NAMES.audit, AUDIT_FIELDS);
    const configRows = readTable_(SHEET_NAMES.config, ["key", "value"]);

    const config = {};
    const configRaw = {};
    configRows.forEach(r => {
      configRaw[r.key] = r.value;
      config[r.key] = r.value ? JSON.parse(r.value) : null;
    });

    const assets = assetRows.map(a => {
      const label = a.label;
      return {
        ...a,
        // Stored comma-joined in one cell (same as a circuit's roomsServed);
        // handed to the app as an array so nothing downstream re-parses it.
        personIds: String(a.personIds || "").split(",").map(s => s.trim()).filter(Boolean),
        comments: commentRows.filter(c => c.assetLabel === label).map(c => ({ text: c.text, at: c.at, by: c.by })),
        changes: changeRows.filter(c => c.assetLabel === label).map(c => ({
          changeType: c.changeType, vendor: c.vendor, cost: c.cost, note: c.note, at: c.at, by: c.by,
        })),
        allocations: allocationRows.filter(al => al.assetLabel === label).map(al => ({ roomId: al.room, quantity: al.quantity })),
        maintenanceItems: maintenanceRows.filter(m => m.assetLabel === label).map(m => ({
          task: m.task, frequencyLabel: m.frequencyLabel, frequencyDays: m.frequencyDays,
          lastPerformed: m.lastPerformed, owner: m.owner, at: m.at, by: m.by,
        })),
        // Only meaningful for Electrical Panel assets, but attached unconditionally
        // (like every other child array here) — no type check needed at this layer,
        // it's just an empty array for anything that isn't a panel.
        breakers: breakerRows.filter(b => b.panelLabel === label).map(b => ({
          id: b.id, panelLabel: b.panelLabel,
          cells: b.cells ? String(b.cells).split(",").map(s => s.trim()) : [],
          ampRating: b.ampRating, status: b.status,
          serial: b.serial, installedDate: b.installedDate, notes: b.notes,
          groupId: b.groupId, breakerTypeId: b.breakerTypeId,
          circuits: circuitRows.filter(c => c.breakerId === b.id).map(c => ({
            id: c.id, breakerId: c.breakerId, panelLabel: label, label: c.label,
            roomsServedIds: c.roomsServed ? String(c.roomsServed).split(",").map(s => s.trim()) : [],
            feedsPanelLabel: c.feedsPanelLabel, notes: c.notes,
          })),
        })),
        // Circuits that belong to this panel but aren't wired to any breaker yet.
        // Identified by an EMPTY breakerId plus a panelLabel naming this asset —
        // which is why panelLabel had to become a stored column: with the breaker
        // gone there's nothing else on the row that says which panel it's for.
        // Rows written before that column existed all have a breakerId, so none of
        // them can land here by accident.
        unassignedCircuits: circuitRows
          .filter(c => String(c.breakerId || "").trim() === "" && c.panelLabel === label)
          .map(c => ({
            id: c.id, breakerId: "", panelLabel: label, label: c.label,
            roomsServedIds: c.roomsServed ? String(c.roomsServed).split(",").map(s => s.trim()) : [],
            feedsPanelLabel: c.feedsPanelLabel, notes: c.notes,
          })),
      };
    });

    const auditLog = auditRows.map(r => ({
      assetLabel: r.assetLabel, assetType: r.assetType, action: r.action,
      field: r.field || undefined, from: r.from || undefined, to: r.to || undefined,
      room: r.room || undefined, quantity: r.quantity === "" ? undefined : r.quantity,
      previousQuantity: r.previousQuantity === "" ? undefined : r.previousQuantity,
      note: r.note || undefined,
      // Absent on every row written before v27, and on any row the backfill
      // could not resolve -- an entry with no related assets is the norm, not an
      // error, so this stays undefined rather than an empty string.
      related: r.related || undefined,
      at: r.at, by: r.by,
    }));

    const breakerTypes = breakerTypeRows.map(t => ({
      id: t.id, name: t.name, slotSpan: t.slotSpan,
      members: t.members ? JSON.parse(t.members) : [],
    }));

    const payload = {
      scriptVersion: SCRIPT_VERSION,
      assets,
      auditLog,
      breakerTypes,
      columns: config.columns || null,
      changeTypes: config.changeTypes || null,
      vendors: config.vendors || null,
      peripheralsList: config.peripheralsList || null,
      usersList: config.usersList || null,
      bulkItemTypes: config.bulkItemTypes || null,
      typesList: config.typesList || null,
      // Per-type overrides of the app's built-in type settings, keyed by type id
      // (see TYPE_SETTINGS in index.html). An object, not a list, unlike every
      // other managed key here.
      typeSettings: config.typeSettings || null,
      // Monotonic counter for the next BCA asset number to issue — see
      // peekAssetNumber() in index.html. Not a managed list like the rest of
      // Config, just a number that has to survive asset deletion (deriving it
      // from the assets instead would reissue a permanently deleted asset's
      // label, and AuditLog rows keyed by that label outlive the asset).
      // null when never stored; the frontend seeds it from max+1 on first use.
      nextAssetNumber: config.nextAssetNumber || null,
      // Per-domain revision counters as of this read. The client holds onto
      // these and posts them back with every save; doPost rejects the save if
      // a domain it's about to write has moved on since. All zeros on a sheet
      // that has never been written by a v12+ backend.
      revisions: readRevisions_(configRaw),
      // Who the backend decided this caller is, and the allowlist itself so the
      // app can render the user-management screen. Sent from here rather than
      // trusted from the token client-side: the role that governs whether a
      // save is accepted has to be the one the SERVER resolved, or a viewer
      // could simply edit their own role in memory and start writing.
      auth: {
        email: auth.email,
        name: auth.name,
        role: auth.role,
        users: auth.users,
        ownerEmail: OWNER_EMAIL,
        // The week-long session the browser stores and presents from here on.
        // No Google credential is kept client-side at all any more — this is an
        // opaque id that means nothing outside this script and can be deleted.
        sessionId: sessionId,
      },
    };

    // respond_ handles the ?callback= JSONP wrapper — kept because a <script>
    // tag isn't subject to the CORS restrictions a plain fetch() can hit here,
    // Apps Script not sending Access-Control-Allow-Origin headers.
    return respond_(payload, e);
  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  // Parsed before the lock so a read can be routed away without ever taking the
  // write lock — handleAuthenticatedRead_ acquires its own, and the script lock
  // is not reentrant.
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut_({ ok: false, error: "Malformed request body." });
  }

  // Sign-in — the only op that accepts a Google ID token. Returns a session plus
  // the inventory in one response.
  if (body.op === "signin") {
    return handleSignIn_(body, e);
  }

  // The authenticated full read. A POST purely so the session id rides in the
  // body rather than the URL — nothing on this path writes inventory data.
  if (body.op === "read") {
    return handleAuthenticatedRead_(body, e);
  }

  // Sign out. Deliberately unconditional: an invalid or already-deleted session
  // still returns ok, because "this session is gone" is exactly what the caller
  // asked for and reporting failure would only invite a retry loop.
  if (body.op === "signout") {
    deleteSession_(body.sessionId);
    return jsonOut_({ ok: true });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const assets = body.assets || [];
    // Which domains actually changed, as reported by the client (see persist()
    // in index.html — computed there by reference-equality against its current
    // state). Missing/absent _dirty (an older client, or a direct API call)
    // means "rewrite everything" — the safe default, same as before this existed.
    const dirty = body._dirty || { assets: true, config: true, breakerTypes: true };

    // --- Optimistic concurrency check ---------------------------------------
    // Deliberately inside the LockService critical section that already guards
    // the writes below: checking outside it would leave a window where someone
    // else's save lands between the check passing and this one writing, which
    // is the exact failure being prevented.
    //
    // Only domains this save is actually going to write are checked — a save
    // that touches assets doesn't care that a managed list moved on. A domain
    // the client didn't report a revision for isn't checked either, so an older
    // client (no `_revisions` at all) still writes, same fallback philosophy as
    // a missing `_dirty`.
    const configMap = readConfigMap_();

    // --- Authorization ------------------------------------------------------
    // Deliberately inside the lock and re-read on every save, so removing
    // someone (or dropping them to view-only) takes effect on their very next
    // save rather than whenever they happen to reload the page.
    //
    // View-only is enforced HERE, not by hiding buttons in the app. The UI does
    // hide them, but that's a courtesy — this is the rule.
    const auth = authorizeSession_(body.sessionId, configMap);
    if (!auth.ok) {
      return jsonOut_({
        ok: false,
        authFailed: true,
        reason: auth.reason,
        email: auth.email || "",
        error: auth.error,
      });
    }
    if (auth.role !== ROLE_EDITOR) {
      return jsonOut_({
        ok: false,
        authFailed: true,
        reason: "readonly",
        error: "Your access is view-only, so that change wasn't saved.",
      });
    }

    const revisions = readRevisions_(configMap);
    const postedRevisions = body._revisions;
    if (postedRevisions) {
      const conflict = REVISION_DOMAINS.filter(d => {
        if (!dirty[d]) return false;
        const posted = Number(postedRevisions[d]);
        if (!isFinite(posted)) return false;
        return Math.floor(posted) !== revisions[d];
      });
      if (conflict.length) {
        // Write NOTHING — not the tabs, and not the audit rows either, since
        // those describe the very changes being rejected. Returning the current
        // revisions lets the client resync without a second round trip.
        return jsonOut_({ ok: false, conflict: conflict, revisions: revisions });
      }
    }

    // --- Mass-deletion guard --------------------------------------------------
    // Refuses a save that would take a populated Assets tab to empty. This
    // architecture writes the FULL snapshot every time, which means "the client
    // sent no assets" and "the user deleted every asset" are the same request on
    // the wire — and the first one silently destroyed the live inventory once
    // (2026-08-21), which is why this exists.
    //
    // Deliberately only the jump straight to zero. Deleting assets through the
    // UI leaves N-1 each time and never trips this; nothing legitimate in the
    // app empties the inventory in one save. A caller that genuinely means it
    // can pass confirmEmptyAssets: true, so this is a safety catch and not a
    // wall.
    //
    // getLastRow() rather than reading the tab: this runs on every asset save
    // and only needs a count, not the data.
    if (dirty.assets && assets.length === 0 && body.confirmEmptyAssets !== true) {
      const existingRows = Math.max(0, getSheet_(SHEET_NAMES.assets).getLastRow() - 1);
      if (existingRows > 0) {
        return jsonOut_({
          ok: false,
          refused: "emptyAssets",
          existingRows: existingRows,
          error: "Refused: this save would have deleted all " + existingRows
            + " assets at once. Nothing was changed. If that was genuinely intended, "
            + "it has to be done deliberately rather than as a side effect of a save.",
        });
      }
    }

    if (dirty.assets) {
      // Assets tab: flat fields only, plus any custom columns (see
      // customColumnKeys_ — without them, custom column values are dropped).
      // personIds arrives as an array and has to be flattened explicitly: leaving
      // it to setValues' own stringification would work by accident today and
      // silently change shape the day the separator or the type did.
      const assetRows_ = assets.map(a => (
        Array.isArray(a.personIds) ? Object.assign({}, a, { personIds: a.personIds.join(",") }) : a
      ));
      writeTable_(SHEET_NAMES.assets, ASSET_FIELDS.concat(customColumnKeys_(body.columns, configMap)), assetRows_);

      // Child tables, flattened out with the parent asset's label as the key.
      const commentRows = [];
      const changeRows = [];
      const allocationRows = [];
      const maintenanceRows = [];
      const breakerRows = [];
      const circuitRows = [];
      assets.forEach(a => {
        (a.comments || []).forEach(c => commentRows.push({ assetLabel: a.label, text: c.text, at: c.at, by: c.by || "" }));
        (a.changes || []).forEach(c => changeRows.push({
          assetLabel: a.label, changeType: c.changeType, vendor: c.vendor || "", cost: c.cost || "", note: c.note || "", at: c.at, by: c.by || "",
        }));
        (a.allocations || []).forEach(al => allocationRows.push({ assetLabel: a.label, room: al.roomId, quantity: al.quantity }));
        (a.maintenanceItems || []).forEach(m => maintenanceRows.push({
          assetLabel: a.label, task: m.task, frequencyLabel: m.frequencyLabel, frequencyDays: m.frequencyDays,
          lastPerformed: m.lastPerformed || "", owner: m.owner || "", at: m.at, by: m.by || "",
        }));
        // panelLabel is derived from the parent asset here (not trusted from the
        // client payload), same as assetLabel is for every other child row above.
        (a.breakers || []).forEach(b => {
          breakerRows.push({
            id: b.id, panelLabel: a.label,
            cells: (b.cells || []).join(","),
            ampRating: b.ampRating, status: b.status, serial: b.serial || "",
            installedDate: b.installedDate || "", notes: b.notes || "",
            groupId: b.groupId || "", breakerTypeId: b.breakerTypeId || "",
          });
          // panelLabel comes from the panel being iterated, never from the
          // circuit's own payload — same rule as the breaker's above. That's what
          // keeps it from ever disagreeing with the breaker this circuit hangs off
          // of, since both are stamped from the one asset that contains them.
          (b.circuits || []).forEach(c => circuitRows.push({
            id: c.id, breakerId: b.id, panelLabel: a.label, label: c.label,
            roomsServed: (c.roomsServedIds || []).join(","), feedsPanelLabel: c.feedsPanelLabel || "",
            notes: c.notes || "",
          }));
        });
        // Same tab, same shape — just with no breaker to point at, so panelLabel is
        // the only thing tying the row to anything. doGet reads them straight back
        // as unassignedCircuits on this panel.
        (a.unassignedCircuits || []).forEach(c => circuitRows.push({
          id: c.id, breakerId: "", panelLabel: a.label, label: c.label,
          roomsServed: (c.roomsServedIds || []).join(","), feedsPanelLabel: c.feedsPanelLabel || "",
          notes: c.notes || "",
        }));
      });
      writeTable_(SHEET_NAMES.comments, ["assetLabel", "text", "at", "by"], commentRows);
      writeTable_(SHEET_NAMES.changes, ["assetLabel", "changeType", "vendor", "cost", "note", "at", "by"], changeRows);
      writeTable_(SHEET_NAMES.allocations, ["assetLabel", "room", "quantity"], allocationRows);
      writeTable_(
        SHEET_NAMES.maintenance,
        ["assetLabel", "task", "frequencyLabel", "frequencyDays", "lastPerformed", "owner", "at", "by"],
        maintenanceRows
      );
      writeTable_(SHEET_NAMES.breakers, BREAKER_FIELDS, breakerRows);
      writeTable_(SHEET_NAMES.circuits, CIRCUIT_FIELDS, circuitRows);
    }

    // Audit entries are only ever appended to client-side (never edited or
    // deleted), so this can just add what's new instead of rewriting the
    // whole — ever-growing — history on every save.
    appendNewRows_(
      SHEET_NAMES.audit,
      AUDIT_FIELDS,
      body.auditLog || []
    );

    if (dirty.breakerTypes) {
      const breakerTypeRows = (body.breakerTypes || []).map(t => ({
        id: t.id, name: t.name, slotSpan: t.slotSpan, members: JSON.stringify(t.members || []),
      }));
      writeTable_(SHEET_NAMES.breakerTypes, BREAKER_TYPE_FIELDS, breakerTypeRows);
    }

    // --- Config tab + revision counters -------------------------------------
    // The Config tab is rewritten wholesale and the revision counters live in
    // it, so this now runs whenever ANY domain was written — not only on a
    // config change. When config itself isn't dirty, its stored rows are copied
    // straight back (raw cell values, unparsed, including any key this script
    // doesn't know about) so an asset-only save still leaves Config untouched
    // apart from the counters.
    const written = REVISION_DOMAINS.filter(d => dirty[d]);
    if (written.length) {
      const configRows = [];
      if (dirty.config) {
        // nextAssetNumber has to be re-stated on every config write or it'd be
        // dropped by an unrelated one (adding a vendor, say). Taking the max
        // against what's already stored keeps it monotonic server-side too: a
        // client that predates this key posts nothing for it, and a client that
        // loaded before someone else created an asset posts a stale, lower
        // value — either would otherwise walk the counter backwards and let a
        // deleted asset's label be reissued. (The revision check above makes
        // that second case a conflict now, but the max costs nothing and still
        // covers a client that posts no revisions at all.)
        const nextAssetNumber = Math.max(
          Number(body.nextAssetNumber) || 0,
          Number(configMap.nextAssetNumber) || 0
        );
        configRows.push({ key: "columns", value: JSON.stringify(body.columns || []) });
        configRows.push({ key: "changeTypes", value: JSON.stringify(body.changeTypes || []) });
        configRows.push({ key: "vendors", value: JSON.stringify(body.vendors || []) });
        configRows.push({ key: "peripheralsList", value: JSON.stringify(body.peripheralsList || []) });
        configRows.push({ key: "usersList", value: JSON.stringify(body.usersList || []) });
        configRows.push({ key: "bulkItemTypes", value: JSON.stringify(body.bulkItemTypes || []) });
        configRows.push({ key: "typesList", value: JSON.stringify(body.typesList || []) });
        configRows.push({ key: "typeSettings", value: JSON.stringify(body.typeSettings || {}) });
        // The access allowlist, PRESERVED from the sheet unless this save
        // explicitly carries one. Every other key above is rewritten from the
        // posted body, which is exactly the hazard here: a client that predates
        // user management, or any save that simply isn't about users, would
        // otherwise blank the list and lock everyone except OWNER_EMAIL out of
        // the app. Absent means "leave it alone", not "set it to empty".
        const previousAuthUsers = readAuthUsers_(configMap);
        const nextAuthUsers = Array.isArray(body.authUsers)
          ? sanitizeAuthUsers_(body.authUsers)
          : previousAuthUsers;
        // Anyone dropped from the list has their sessions ended right now rather
        // than lingering for up to a week. Their next request would be refused
        // either way — the allowlist is re-read on every one — but this returns
        // them to the sign-in screen promptly instead of leaving a usable app on
        // screen, and reclaims the storage.
        if (Array.isArray(body.authUsers)) {
          const stillListed = {};
          nextAuthUsers.forEach(u => { stillListed[u.email] = true; });
          previousAuthUsers.forEach(u => {
            if (!stillListed[u.email]) deleteSessionsForEmail_(u.email);
          });
        }
        configRows.push({ key: "authUsers", value: JSON.stringify(nextAuthUsers) });
        configRows.push({ key: "nextAssetNumber", value: JSON.stringify(nextAssetNumber) });
      } else {
        Object.keys(configMap).forEach(k => {
          // Revision rows are re-added below with their new values.
          if (k.indexOf(REVISION_KEY_PREFIX) === 0) return;
          configRows.push({ key: k, value: String(configMap[k]) });
        });
      }
      // Bump only what was actually written, so an assets-only save doesn't
      // invalidate a config snapshot someone else is holding.
      written.forEach(d => { revisions[d] = revisions[d] + 1; });
      REVISION_DOMAINS.forEach(d => configRows.push({ key: REVISION_KEY_PREFIX + d, value: String(revisions[d]) }));
      writeTable_(SHEET_NAMES.config, ["key", "value"], configRows);
    }

    // The post-write revisions go back with the response so the client can keep
    // saving without a reload first — otherwise its very next save would post
    // the pre-bump numbers and conflict with its own write.
    return jsonOut_({ ok: true, revisions: revisions });
  } catch (err) {
    return jsonOut_({ ok: false, error: err.message });
  } finally {
    lock.releaseLock();
  }
}

// --- One-off: backfill `related` on pre-v27 audit rows ------------------------
//
// RUN THIS ONCE, BY HAND, FROM THE APPS SCRIPT EDITOR, after deploying v27.
// It is deliberately not reachable through doGet/doPost and must never be put on
// a trigger: it rewrites existing history, which is the one thing every other
// path in this file is careful not to do.
//
// WHY IT HAS TO EXIST AT ALL. Every audit row written before v27 recorded a
// place by its display NAME ("Room 101"), because that is what the frontend
// resolved before storing. Names are ambiguous (two rooms can share one) and
// mutable (a rename detaches the history silently), which is exactly why every
// other reference in this app stores a label. This maps those names back to
// labels so a room can find its own entries.
//
// IT IS BEST EFFORT AND FAILS INVISIBLY, ON PURPOSE. A name that matches nothing
// leaves `related` empty and the entry simply stays out of the associated views,
// which is the honest outcome -- better than guessing. Two known reasons a name
// won't match: a place renamed since the entry was written, and the v23 name
// backfill that wrote some wrong names in the first place (the repair that could
// detect those, hasMisadoptedName(), went with the columns deleted in v25).
//
// AMBIGUITY TAKES THE FIRST MATCH, which can file an entry under the wrong
// same-named room. Accepted deliberately for the current sheet, which is sample
// data -- a well-formed structure matters more here than which of two identically
// named rooms a sample move points at. THINK AGAIN BEFORE RUNNING THIS AGAINST
// HISTORY ANYONE RELIES ON.
//
// Safe to re-run: rows that already have a `related` value are left alone.
function backfillAuditIds_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const assetRows = readTable_(SHEET_NAMES.assets, ASSET_FIELDS);
    // name -> label, first writer wins (see the ambiguity note above).
    const labelByName = {};
    assetRows.forEach(a => {
      const nm = String(a.name || "").trim();
      if (nm && !(nm in labelByName)) labelByName[nm] = a.label;
    });
    const resolve = nm => {
      const key = String(nm || "").trim();
      if (!key || key === "Unassigned") return "";
      return labelByName[key] || "";
    };

    const sheet = getSheet_(SHEET_NAMES.audit);
    const values = sheet.getDataRange().getValues();
    if (values.length < 2) return "AuditLog is empty; nothing to do.";

    const headers = values[0].map(String);
    const relatedCol = headers.indexOf("related");
    if (relatedCol === -1) {
      // The v27 deploy widens this header on the first save. Refuse rather than
      // write into a column that isn't there.
      throw new Error("No `related` column on AuditLog yet — deploy v27 and let one save run first.");
    }
    const col = name => headers.indexOf(name);
    const iAction = col("action"), iField = col("field");
    const iFrom = col("from"), iTo = col("to"), iRoom = col("room");

    let filled = 0, skipped = 0, unmatched = 0;
    const out = [];
    for (let r = 1; r < values.length; r++) {
      const row = values[r];
      if (String(row[relatedCol] || "").trim()) { out.push([row[relatedCol]]); skipped++; continue; }

      const action = String(row[iAction] || "");
      const field = String(row[iField] || "");
      const pairs = [];

      if (action === "edited" && field === "Parent") {
        const f = resolve(row[iFrom]), t = resolve(row[iTo]);
        if (f) pairs.push(f + ":from");
        if (t) pairs.push(t + ":to");
      } else if (action === "allocated") {
        const t = resolve(row[iRoom]);
        if (t) pairs.push(t + ":to");
      } else if (action === "unallocated") {
        const f = resolve(row[iRoom]);
        if (f) pairs.push(f + ":from");
      } else if (action === "circuit_edited" && field.indexOf("Rooms served") !== -1) {
        // The stored value is a comma-joined list of names.
        String(row[iTo] || "").split(",").forEach(nm => {
          const id = resolve(nm);
          if (id) pairs.push(id + ":serves");
        });
      }

      if (pairs.length) filled++;
      else if (action === "allocated" || action === "unallocated" || (action === "edited" && field === "Parent")) unmatched++;
      out.push([pairs.join(",")]);
    }

    sheet.getRange(2, relatedCol + 1, out.length, 1).setNumberFormat("@").setValues(out);
    return `Backfill done: ${filled} rows filled, ${unmatched} place rows unmatched, ${skipped} already had a value.`;
  } finally {
    lock.releaseLock();
  }
}

/* ============================================================================
   ADMIN TOOLS — wipe and import, as a menu on the Sheet itself
   ============================================================================

   Replacing the inventory used to be a documented nine-step ritual: import a CSV
   into the Assets tab by hand, clear eight child tabs one at a time, then edit
   individual Config rows. Every step was a chance to clear the wrong tab, and one
   of them (leaving a stale `usersList`) silently flips the app back to legacy
   name mode and wipes every assignment on the next save.

   These two menu items do the whole thing. They live here rather than in a Node
   script because the /exec endpoint requires a signed-in session (v18+), and the
   only way to get one into a script would be to copy a live credential out of a
   browser. Running inside the bound script needs no credential at all — the
   Sheet's own authorization IS the auth — and it works from a phone.

   `onOpen` is a simple trigger, so the menu appears on every open with no
   installation step. The handlers must NOT end in `_`: Apps Script treats a
   trailing underscore as private and refuses to wire it to a menu item.

   Both operations bump every revision counter, which is load-bearing rather than
   tidy: a browser left open still holds the pre-wipe snapshot, and without the
   bump its next save would happily overwrite everything this just did. With it,
   that save is rejected as a conflict and the app reloads (see "Optimistic
   concurrency" in CLAUDE.md).

   NOTE ON SCOPES: reading the CSV from Drive adds the Drive scope to the whole
   project, so the first deploy after this asks for a permission the script never
   needed before, and the first use of the menu prompts for it too. Both are the
   normal interactive flow — unlike UrlFetchApp in the WEB APP path, which fails
   silently and needs forceAuthorizeExternalRequests above. DriveApp is only ever
   called from a menu handler, never from doGet/doPost, so there is nothing here
   that can fail invisibly.
*/

// What "Import inventory" looks for in Drive when the prompt is left blank.
//
// DRIVE, DELIBERATELY NOT A URL. The first version of this fetched the CSV from
// the repo's raw URL, which was simpler but wrong: the repo is PUBLIC, so using
// it would have published the school's whole inventory — 21 staff names, which
// room each person sits in, and every device's serial number and hostname — to
// the open internet, permanently, since git history outlives a deletion.
//
// This script is bound to the Sheet and runs as its owner, so it already has
// that person's Drive access. Reading the file straight from Drive needs no
// sharing, no link, and nothing public. A URL is still accepted (see
// adminReadSource_) for a genuinely public file, but it is no longer the path of
// least resistance.
const IMPORT_DRIVE_FILENAME = "BCA-inventory-import.csv";

// Every tab holding DATA, with the header row it should be left with when empty.
// Config is deliberately absent — it holds the access allowlist and the app's
// configuration, neither of which is inventory data. See adminWriteConfig_.
function adminDataTabs_() {
  return [
    { name: SHEET_NAMES.assets, headers: ASSET_FIELDS },
    { name: SHEET_NAMES.comments, headers: ["assetLabel", "text", "at", "by"] },
    { name: SHEET_NAMES.changes, headers: ["assetLabel", "changeType", "vendor", "cost", "note", "at", "by"] },
    { name: SHEET_NAMES.allocations, headers: ["assetLabel", "room", "quantity"] },
    { name: SHEET_NAMES.maintenance, headers: ["assetLabel", "task", "frequencyLabel", "frequencyDays", "lastPerformed", "owner", "at", "by"] },
    { name: SHEET_NAMES.breakers, headers: BREAKER_FIELDS },
    { name: SHEET_NAMES.circuits, headers: CIRCUIT_FIELDS },
    { name: SHEET_NAMES.breakerTypes, headers: BREAKER_TYPE_FIELDS },
    { name: SHEET_NAMES.audit, headers: AUDIT_FIELDS },
  ];
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("BCA Admin")
    .addItem("Import inventory (replaces everything)...", "menuImportInventory")
    .addSeparator()
    .addItem("Wipe all data...", "menuWipeAllData")
    .addToUi();
}

// Rewrites Config, overriding only the named keys and copying every other row
// through untouched — which is what preserves `authUsers`. Writing a fixed key
// list here instead would blank the allowlist and lock out everyone but
// OWNER_EMAIL, the same hazard doPost's authUsers handling exists to avoid.
// Revision counters are re-stated at their bumped values.
function adminWriteConfig_(configMap, overrides) {
  const rows = [];
  Object.keys(overrides).forEach(k => rows.push({ key: k, value: overrides[k] }));
  Object.keys(configMap).forEach(k => {
    if (k in overrides) return;
    if (k.indexOf(REVISION_KEY_PREFIX) === 0) return;
    rows.push({ key: k, value: String(configMap[k]) });
  });
  const revisions = readRevisions_(configMap);
  REVISION_DOMAINS.forEach(d =>
    rows.push({ key: REVISION_KEY_PREFIX + d, value: String(revisions[d] + 1) })
  );
  writeTable_(SHEET_NAMES.config, ["key", "value"], rows);
}

// Empties every data tab, leaving each one's header row. Assets can optionally be
// refilled in the same locked section, so an import never leaves the sheet in a
// half-wiped state if something fails partway.
function adminReplaceAll_(assetHeaders, assetRows, configOverrides) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const configMap = readConfigMap_();
    adminDataTabs_().forEach(t => {
      const isAssets = t.name === SHEET_NAMES.assets;
      writeTable_(
        t.name,
        isAssets && assetHeaders ? assetHeaders : t.headers,
        isAssets && assetRows ? assetRows : []
      );
    });
    adminWriteConfig_(configMap, configOverrides);
  } finally {
    lock.releaseLock();
  }
}

function menuWipeAllData() {
  const ui = SpreadsheetApp.getUi();
  const typed = ui.prompt(
    "Wipe all data",
    "This permanently empties Assets, Comments, Changes, Allocations, Maintenance, " +
      "Breakers, Circuits, BreakerTypes and AuditLog.\n\n" +
      "Sign-in access and column/type settings are kept.\n\n" +
      "File > Version history is the only undo. Type WIPE to confirm:",
    ui.ButtonSet.OK_CANCEL
  );
  if (typed.getSelectedButton() !== ui.Button.OK) return;
  if (String(typed.getResponseText()).trim().toUpperCase() !== "WIPE") {
    ui.alert("Cancelled — nothing was changed.");
    return;
  }
  adminReplaceAll_(null, null, {
    usersList: "[]",
    peripheralsList: "[]",
    // 0 reads as "never stored", so the app re-derives the next label from the
    // assets themselves — which, with none left, starts over at BCA0001.
    nextAssetNumber: "0",
  });
  ui.alert("Done — every data tab is empty. Reload the app.");
}

function menuImportInventory() {
  const ui = SpreadsheetApp.getUi();
  const asked = ui.prompt(
    "Import inventory",
    "Leave blank to import the file named\n" + IMPORT_DRIVE_FILENAME + "\nfrom your Drive.\n\n" +
      "Or type a different Drive filename, or paste a public CSV URL.",
    ui.ButtonSet.OK_CANCEL
  );
  if (asked.getSelectedButton() !== ui.Button.OK) return;
  const source = String(asked.getResponseText()).trim();
  const describedSource = /^https?:\/\//i.test(source)
    ? source
    : "Drive: " + (source || IMPORT_DRIVE_FILENAME);

  let parsed;
  try {
    parsed = adminParseAssetCsv_(source);
  } catch (err) {
    ui.alert("Import failed — nothing was changed.\n\n" + err.message);
    return;
  }

  // Everything above this point is read-only, so the summary describes real
  // parsed data rather than a promise. Nothing is destroyed until OK is clicked.
  const ok = ui.alert(
    "Replace everything with this?",
    parsed.rows.length + " assets parsed from:\n" + describedSource + "\n\n" +
      parsed.summary + "\n\n" +
      "This REPLACES the whole inventory and empties every child tab (comments, " +
      "maintenance, breakers, audit log...). Sign-in access is kept.\n\n" +
      "File > Version history is the only undo.",
    ui.ButtonSet.OK_CANCEL
  );
  if (ok !== ui.Button.OK) return;

  adminReplaceAll_(parsed.headers, parsed.rows, {
    // Derived from the file rather than hand-maintained, so the managed list can
    // never drift from what the assets actually reference.
    peripheralsList: JSON.stringify(parsed.peripherals),
    // Emptied on purpose. The app rebuilds it from the assets on load, and a
    // stale name left here with no matching User asset would make
    // `usersAreAssets` false -- dropping the app back to legacy name mode, where
    // every personIds assignment renders as unassigned and the next save writes
    // that emptiness back. That is the most destructive thing this import could
    // get wrong, and it is the step the manual process kept getting wrong.
    usersList: "[]",
    nextAssetNumber: String(parsed.nextAssetNumber),
  });
  ui.alert("Imported " + parsed.rows.length + " assets. Reload the app.");
}

// Resolves whatever the prompt returned to CSV text. Three shapes, in the order
// they're least likely to leak anything: blank means the default Drive file, a
// bare name means that Drive file, and only an explicit http(s) URL fetches.
function adminReadSource_(source) {
  const s = String(source || "").trim();
  if (/^https?:\/\//i.test(s)) {
    const res = UrlFetchApp.fetch(s, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) {
      throw new Error("Fetch returned HTTP " + res.getResponseCode() + ".\nCheck the URL is reachable and public.");
    }
    return res.getContentText("UTF-8");
  }
  const name = s || IMPORT_DRIVE_FILENAME;
  const found = DriveApp.getFilesByName(name);
  if (!found.hasNext()) {
    throw new Error('No file named "' + name + '" in your Drive.\n\n' +
      "Put the CSV anywhere in Drive under that name (My Drive, a folder, either " +
      "works) and try again. It does not need to be shared.");
  }
  const file = found.next();
  // Drive happily holds several files with one name, and importing the wrong copy
  // is exactly the mistake worth refusing rather than guessing at — this replaces
  // the entire inventory.
  if (found.hasNext()) {
    throw new Error('More than one file in your Drive is named "' + name + '".\n\n' +
      "Rename or remove the ones you don't want imported, so there is exactly one.");
  }
  return file.getBlob().getDataAsString("UTF-8");
}

// Reads and validates the CSV. Throws with a readable message rather than
// returning a half-result — the caller shows it and changes nothing.
function adminParseAssetCsv_(source) {
  // Strip a UTF-8 BOM — Sheets writes one on export, and parseCsv would otherwise
  // fold it into the first header name, so "label" would never match.
  const text = adminReadSource_(source).replace(/^﻿/, "");
  const grid = Utilities.parseCsv(text);
  if (!grid || grid.length < 2) throw new Error("That file has no data rows.");

  const csvHeaders = grid[0].map(h => String(h).trim());
  if (csvHeaders.indexOf("label") === -1 || csvHeaders.indexOf("type") === -1) {
    throw new Error("Expected 'label' and 'type' columns.\nFound: " + csvHeaders.join(", "));
  }

  const rows = grid.slice(1)
    .filter(r => r.some(c => String(c).trim() !== ""))
    .map(r => {
      const obj = {};
      csvHeaders.forEach((h, i) => { obj[h] = r[i] === undefined ? "" : r[i]; });
      return obj;
    });

  const seen = {}, dupes = [];
  rows.forEach(r => {
    const l = String(r.label || "").trim();
    if (!l) return;
    if (seen[l]) dupes.push(l); else seen[l] = true;
  });
  if (dupes.length) {
    // Two assets sharing a label are not two assets — every lookup in the app
    // matches ALL rows carrying that label, so they merge with no way back apart.
    throw new Error("Duplicate labels: " + dupes.slice(0, 5).join(", ") + (dupes.length > 5 ? "..." : ""));
  }

  // ASSET_FIELDS first so the tab keeps its canonical column order, then any
  // extra column the file carries (a custom column) appended after.
  const headers = ASSET_FIELDS.slice();
  csvHeaders.forEach(h => { if (headers.indexOf(h) === -1) headers.push(h); });

  const peripherals = [];
  rows.forEach(r => String(r.peripherals || "").split(",").forEach(p => {
    const v = p.trim();
    if (v && peripherals.indexOf(v) === -1) peripherals.push(v);
  }));
  peripherals.sort();

  let highest = 0;
  rows.forEach(r => {
    const m = /^BCA(\d+)$/i.exec(String(r.label || "").trim());
    if (m) highest = Math.max(highest, Number(m[1]));
  });

  const byType = {};
  rows.forEach(r => {
    const t = String(r.type || "(none)").trim() || "(none)";
    byType[t] = (byType[t] || 0) + 1;
  });
  const summary = Object.keys(byType).sort().map(t => byType[t] + " " + t).join(", ");

  return { headers, rows, peripherals, nextAssetNumber: highest + 1, summary };
}
