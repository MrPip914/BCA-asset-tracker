# Attaching photos — evaluation

**Status: evaluation only. Nothing is built and nothing is decided.** Written 2026-09-10
against backend **v32** (the number came from `SCRIPT_VERSION` in the repo at commit
`559e784`, NOT from a live check — run `node deploy.mjs --status` before planning around
it, per the standing rule).

The question: attach photos to assets, work items, and other components of the app. Eric's
assumption going in was that a separate service is needed. **That assumption is correct**,
and this document is mostly about *which* separate service and *why the obvious one is the
wrong one*.

---

## 1. Why photos cannot live where everything else lives

Three constraints, each independently fatal to "just put it in the Sheet".

**The persistence model is a full snapshot.** `persist()` posts the ENTIRE application
state as one JSON body on every single change, and `doPost` rewrites whole tabs from it.
A base64 photo in that payload would be re-uploaded and re-written on every unrelated edit
— rename a room, re-post every photo in the school. This is not a tuning problem; it is
the shape of the design.

**A Sheets cell holds 50,000 characters.** That is ~37KB of base64, i.e. ~28KB of image.
A phone photo is 2–5MB. Chunking across rows would work and would be an abomination.

**Apps Script cannot serve an image back.** `ContentService` emits only ATOM, CSV, ICAL,
JAVASCRIPT, JSON, RSS, TEXT, VCARD and XML — there is no image MIME type. So even if bytes
got *in*, the only way *out* through `/exec` is base64 inside JSON, decoded client-side
into a data URL: no browser caching, no `<img src>` against a CDN, the whole payload
through a 6-minute-limit script. This one is easy to miss when sketching the Drive option
and is what rules it out.

**Therefore: the Sheet stores a REFERENCE; the bytes live somewhere that speaks HTTP.**
Same principle the app already applies to everything else — see "Computed, not stored" and
"A reference from one Asset to another stores the target's `label`" in `CLAUDE.md`. A photo
reference is just another reference.

---

## 2. The options

### Option A — Google Drive, written by the Apps Script backend

The intuitive answer: the backend already lives inside Google, bound to a Sheet that
already sits in a Drive folder. Post base64 to `/exec`, `DriveApp.createFile(blob)`.

**This project has already tried to call `DriveApp` and it failed at runtime.** v29 shipped
an admin import that read a file via `DriveApp.getFilesByName` and died with *"You do not
have permission to call DriveApp.getFilesByName"*. The cause is recorded under "Wipe and
import" in `CLAUDE.md`: **the live manifest declares its `oauthScopes` explicitly**, so
Apps Script does not auto-detect a newly used API's scope. v30 rewrote the feature to read
a Sheet tab instead, and the standing rule that came out of it is:

> use an API the script already holds a scope for.

Adding the Drive scope is possible, but it is not free and it fights the existing tooling:

| Cost | Detail |
|---|---|
| Manifest edit, per tenant | `deploy.mjs` deliberately pulls and preserves the **live** manifest, so a deploy can never alter the web app's access settings. Adding a scope means a manual manifest change outside the normal path. |
| An outage window, per tenant | The web app executes as its owner. Between the deploy and the owner re-granting, **every user's requests fail** — the same trap `forceAuthorizeExternalRequests` documents for `UrlFetchApp`. |
| Repeat for every tenant | Two today, more later. |
| It still doesn't solve serving | See §1. Displaying a Drive image means either link-sharing every photo publicly (unlisted-public, forever) or relying on undocumented `lh3.googleusercontent.com` thumbnail URLs, which Google has broken before. |
| Upload path is the worst one | 4MB photo → base64 (+33%) → POST body → Apps Script → Drive, all inside a script with a 6-minute ceiling, for a job that wants to be a direct browser upload. |

**Verdict: the option that looks free and isn't.** It buys "no new vendor" at the price of
a scope escalation this codebase has explicitly ruled against, an outage window per tenant,
and a serving story that doesn't work.

### Option B — Browser uploads to Drive with the user's own OAuth token

No backend change at all: add `google.accounts.oauth2` alongside the existing
`google.accounts.id`, request `drive.file`, upload straight from the browser.

Genuinely tempting, and **the ownership model kills it**. A file created this way is owned
by the *uploading user*. Consolidating them under the school would need a Shared Drive, and
**Shared Drives require Google Workspace — which this school does not have** (it is why the
OAuth client is External in the first place; see Authentication in `CLAUDE.md`). So every
photo is owned by whichever staff member happened to take it, and leaves with them. For an
inventory system whose entire point is institutional memory, that is disqualifying. It also
adds a second consent screen and still has §1's serving problem.

**Verdict: no.**

### Option C — Object storage, with the backend signing the uploads *(recommended)*

The browser PUTs the photo directly to an object store; the Apps Script backend's only job
is to hand out a short-lived signed permission to do so.

**The reason this fits: it needs no new Google scope.** The signature is HMAC/SHA — Apps
Script's `Utilities.computeHmacSha256Signature` and `Utilities.computeDigest` are core
library calls requiring no authorization at all, and `UrlFetchApp` (if a server-side call
is even wanted) has been authorized since v18. Nothing about the manifest changes, so
`deploy.mjs` keeps working exactly as it does, and there is no re-grant outage.

It also puts the role check in the one place this app trusts. `CLAUDE.md` is explicit that
hiding edit controls is cosmetic and "`persist()` and `doPost` remain the control" — a
signing endpoint inside `doPost` inherits that: **a viewer asks for an upload credential and
is refused server-side.** This is precisely why the upload must NOT use an unsigned/public
upload preset: this repo is **public**, so anything embedded in `index.html` is a key handed
to the internet. The signing secret lives in Script Properties (where sessions already live,
and for the same reason — the Sheet is readable by anyone it is shared with).

Flow:

1. Browser downscales and re-encodes the photo on a `<canvas>` (see §4).
2. Browser POSTs `{ op: "photoUpload", ownerType, ownerId, contentType }` to `/exec`.
3. `doPost` validates the session, checks the role is `editor`, computes a signature, returns
   it. No bytes touch Apps Script.
4. Browser PUT/POSTs the bytes straight to the storage host.
5. Browser calls `persist()` with the new photo row. Normal snapshot write, normal revision
   check, normal audit entry.

**Two candidates, and the trade between them is thumbnails vs. ownership:**

| | **Cloudinary** | **Cloudflare R2** |
|---|---|---|
| Signature in Apps Script | SHA-1 of sorted params + secret. Three lines. | AWS SigV4. ~40 lines, well-trodden, all HMAC. |
| Thumbnails | Free, on-the-fly, by URL (`w_200,h_200,c_fill`). | You generate and store them yourself — a second object per photo. |
| EXIF / auto-orient | Handled server-side. | Yours to handle. |
| Free tier | ~25GB storage/bandwidth. | 10GB storage, **zero egress fees**. |
| Bytes live | On Cloudinary. | In your bucket, servable from your own domain via a Worker. |

**Thumbnails are not a nicety here.** A grid of photos on an asset detail page, or a column
of them in a list, means loading N full-size phone photos over school wifi on a phone. One
of these options gives you that for free and the other makes it a feature you build.

**Recommendation: Cloudinary to start, R2 if Eric would rather own the bytes.** The switching
cost is deliberately low if §3 is followed — the reference stores a URL, so migrating is a
copy of the objects plus a rewrite of one column.

---

## 3. Where the reference goes

**A new `Photos` tab, as its own `_dirty` domain with its own `rev_photos` counter.**

Not an array nested on the asset, for the reason `DOORS_LOCKS_KEYS_NOTES.md` already
established for `LockKeys`: the things being photographed are not all assets. A maintenance
item, a change record, a circuit and a breaker are not assets and have nowhere to nest.

One flat tab, keyed by an owner *pair*:

| Column | Notes |
|---|---|
| `id` | `crypto.randomUUID()`, per the sub-entity convention |
| `ownerType` | `asset` / `maintenance` / `change` / `comment` / `circuit` / `breaker` |
| `ownerId` | the owner's `id` — an asset's real `id` since v32, never its `tag` |
| `url` | full-size, the display reference |
| `thumbUrl` | may be derived from `url` on Cloudinary; stored so a later move off it is one column, not a code change |
| `storageKey` | the object's own key at the host — what a deletion or a migration needs, and NOT recoverable from a transformed URL |
| `caption`, `width`, `height`, `bytes` | |
| `at`, `by` | matches Comments/Changes/Maintenance |

Making it its own domain means uploading a photo does not rewrite the Assets tab, and does
not conflict with someone editing a managed list — the same reasoning that produced the
existing three counters.

Photos are a full-overwrite tab like every other, **except** that its rows point at bytes
outside the Sheet. See §5.

### The prerequisite nobody will expect

**Comments, Changes and Maintenance rows have no `id`.** Verified in `AssetTrackerSync.gs`:
they are `["assetLabel", "text", "at", "by"]`, `["assetLabel", "changeType", "vendor",
"cost", "note", "at", "by"]` and `["assetLabel", "task", "frequencyLabel", "frequencyDays",
"lastPerformed", "owner", "at", "by"]` respectively. The frontend edits maintenance items
**by array index**.

So "attach a photo to a work item" is blocked on giving work items a stable identity —
exactly the problem `Circuit.id` and the breaker `groupId` already solved elsewhere in this
app, and the same reasoning as the v31/v32 asset-key refactor. That is real scope, and it
is what decides the phasing:

- **Phase 1 — assets only.** Assets already have a real `id` (v31/v32). Nothing else needed.
- **Phase 2 — work items.** Add `id` to Maintenance (and Changes/Comments if wanted),
  adopting `id = id || <assetId>:<index>` on load the way phase 1 of the key refactor
  adopted `id = a.id || a.label`. Purely additive, no migration script.

Doing phase 1 first is not just risk-aversion: it is the phase that answers whether the
storage choice is right, using the one entity that needs no schema work to find out.

---

## 4. Client-side work that is not optional

**Downscale and re-encode before upload.** A `<canvas>` resize to ~1600px on the long edge
at JPEG q0.8 turns a 4MB phone photo into ~300KB. Plain browser APIs, no build step, which
matters in a codebase that has neither.

**That same re-encode strips EXIF as a side effect — including GPS.** Phones geotag. Photos
of a school's rooms, tagged with the school's coordinates, uploaded to a third party, is a
thing to have decided deliberately rather than discovered. Canvas re-encoding decides it for
free. (It also drops the orientation flag, so read and apply it before drawing, or portrait
photos land sideways.)

**Sandbox mode needs an answer, and the answer is "no network, as always".** Per
`CLAUDE.md`, Sandbox makes **no** call to the real backend, so it cannot sign an upload.
Hold `URL.createObjectURL` blobs in memory for the session and let them evaporate on reload
— do NOT put data URLs in `localStorage`, whose ~5MB budget one photo would eat.
`MOCK_SNAPSHOT` should carry a couple of rows pointing at real, small, public URLs so the
render path is exercised. **The `personIds` lesson applies directly**: a fixture whose SHAPE
differs from the backend's response hides exactly the bugs the fixture exists to catch.

**The public `?panel=` page is a fork in the road.** If panel/breaker photos should appear
on the anonymous QR page, the URLs must be publicly fetchable, which means unlisted-public.
If they must not, the projection whitelists (`PUBLIC_*_FIELDS`) simply omit photos and the
question disappears. **Decide this before choosing between an open bucket and a Worker with
signed reads** — it is the only requirement that changes the storage shape.

---

## 5. What will go wrong, and which way to let it fail

**Orphans, not broken references.** Upload the bytes FIRST, then write the reference. If the
`persist()` is rejected by the revision check (which it can be — that path is real), the
bytes are stranded but nothing in the app points at a 404. The other order gives a row whose
image never loads, which looks like data loss to a user and is unrecoverable. Orphans are
cheap and sweepable; broken references are not.

**Deleting a photo row does not delete the object**, and deleting an *asset* silently
strands every photo of it. Options: accept it (a few stranded megabytes on a free tier), or
add a reaper that lists the bucket and removes objects with no matching row. **The reaper is
the dangerous one** — the same shape as `doPost`'s mass-deletion guard: "the app sent no
photo rows" and "delete every object" are the same request on the wire. If it gets built, it
needs the equivalent of `--allow-empty` and a dry run, per `sheet.mjs`'s conventions.

**A stale browser holding a pre-delete snapshot** is already handled by the revision check,
provided `rev_photos` is a real domain rather than photos being folded into `rev_assets`.

**The signing secret is per tenant.** It goes in that tenant's Script Properties, never in
`clients.js` — which is public and is documented as holding only values that authorize
nothing. Note this is a genuine asymmetry with `GOOGLE_CLIENT_ID`, which is shared precisely
*because* holding it authorizes nothing. An upload secret is the opposite.

---

## 6. Summary

| | Drive via backend | Drive via browser | **Object storage + signed** |
|---|---|---|---|
| New Google scope | **yes, + outage per tenant** | yes (user consent) | **none** |
| Who owns the files | the school | **whoever uploaded** | the school |
| Serving images | broken (§1) | broken (§1) | plain HTTPS URL |
| Thumbnails | build it | build it | free (Cloudinary) |
| Fights `deploy.mjs` | yes | no | no |
| New vendor | no | no | **yes** |
| Recurring cost | none | none | none at this scale |

**Recommendation: Option C, Cloudinary, assets-only for phase 1.** The whole cost of being
wrong about the vendor is one column of URLs; the cost of being wrong about the Drive scope
is an outage on a school's live system.

**Three decisions needed before any of this is built:**

1. **Should photos show on the public QR panel page?** This is the only one that changes the
   architecture (§4).
2. **Cloudinary or R2** — free thumbnails, or owning the bytes (§2).
3. **Assets only, or work items too** — the second needs stable ids on child rows first (§3).
