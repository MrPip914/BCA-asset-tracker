# Responsiveness — evaluation

**Status: items 1, 2, 3 and 7 of the table in §5 are BUILT** (2026-09-16, frontend only, no
backend deploy) — lazy `xlsx`, the snapshot cache and the transpile cache, all described
in `CLAUDE.md` under "Two caches in front of the load". Everything else here is still
evaluation only. Background saves landed with two things this document did not
propose — a failure that names and links its asset, and putting the draft back —
because backgrounding is what made a failure surface after the user had moved on.
Items 5, 6 and 8 are one backend release between them, and are all that is left.
Written 2026-09-15
against the repo at `c98746b`. Every backend version number below is a *shape* — run
`node deploy.mjs --status` before planning around any of it.

The question: make saving a change, saving a photo, signing in, and coming back after a
refresh all feel faster.

Everything here rests on one measured number, so it goes first.

---

## 0. The floor: every `/exec` call costs ~1.2–2.0 seconds, empty

Measured against the `bca` tenant's live `/exec`, from a datacenter, with the parameterless
`doGet` — the cheapest possible request this backend can answer, which reads no tab and
writes nothing:

    total=1.99s   total=1.41s   total=1.42s

Split across the redirect Apps Script always issues:

    first hop (script.google.com, 302)  1.01s
    second hop (googleusercontent)      0.18s

So **~1.2–1.5 seconds is the fixed cost of talking to the backend at all**, before any data
moves, from a wired machine. A phone on school wifi or LTE adds its own RTTs on top. This
is Apps Script's dispatch, not anything in `AssetTrackerSync.gs`, and no change in this
repo can reduce it.

That reframes the whole problem. There are only three levers:

1. **Fewer round trips** — every avoided `/exec` call is ~1.5s.
2. **Don't make the user WAIT on the round trip** — the app already updates optimistically,
   it just refuses to let go until the server answers.
3. **Less work inside the script** — real, but second-order next to (1) and (2).

Lever 2 is the cheapest and the biggest, and it needs no deploy.

---

## 1. Saving a change

### What it costs now

A Save click runs: optimistic `setState` → the form stays open and **disabled** → POST →
`doPost` → the form closes. The user watches a frozen form for the whole round trip.

Inside the lock, when `dirty.assets` is set, `doPost` rewrites **eight tabs**: Assets,
Comments, Changes, Allocations, Maintenance, Breakers, Circuits, then Config for the
revision counters. Each `writeTable_` is a `clear()`, a header `setValues`, a
`setNumberFormat("@")` and a data `setValues` — four Sheets calls that each force a flush.

**So editing one word of a comment rewrites the Breakers and Circuits tabs.** `_dirty`
already spares the Config/BreakerTypes/Photos domains, but *everything* under `assets` is
one flag, and almost every edit in the app sets it.

Realistic total today: ~1.5s transport + ~1–3s of Sheets writes.

### (a) Stop making the user wait — frontend only, no backend version

The highest-value change here, and it is mostly deletion.

`persist()` already does the work that makes this safe: it `setState`s optimistically
before the POST, `writeQueueRef` serializes overlapping writes, the revision check catches
a stale save, and the conflict path already reloads and interrupts with a blocking modal.
The only thing the `await` buys is the *disabled form*, and the disabled form is the entire
complaint.

Close the form on submit, let the save finish in the background, and leave the existing
"Saving…" pill in the header as the only indicator. Perceived save latency goes from 2–5
seconds to zero.

Three details that decide whether this is safe, and they are the actual work:

- **The double-submit guard has to be split in two.** Today `savingRef.current` means both
  "this form is mid-submit" (which must still block) and "a write is in flight" (which must
  stop blocking, or a background save would lock out the next edit for its whole duration).
  `attachPhotos` and `deletePhoto` both read it, so they would be blocked by an unrelated
  save that the user has already forgotten about.
- **A queued save behind a failed one is already a hazard, and this makes it likelier.**
  If save #1 conflicts and reloads, save #2 in the queue posts state derived from
  pre-reload assets. That exists today; backgrounding saves means more of them overlap. The
  fix is to drain the queue on a conflict rather than let it keep the chain alive.
- **Not every call site should be backgrounded.** Anything whose next step needs the
  server's answer stays as it is. In practice almost none do — new assets mint a
  client-side `crypto.randomUUID()`, so even add-then-navigate works — but the sweep must
  be per call site, not a blanket change to `persist`.

### (b) Per-tab dirty, so a comment edit stops rewriting the panel tabs

Backend version + frontend, one release.

The clean shape given this codebase's rule that call sites must not keep bookkeeping: have
`doPost` flatten each child tab's rows as it does now, hash each one, and compare against a
hash stored in Config. Write only the tabs whose hash moved, then store the new hashes.
Config is already rewritten on every save that writes anything, so six extra rows there
cost nothing.

That takes a comment edit from 8 tab rewrites to 2 (Comments + Config), and a photo
caption from 8 to 1. It also needs no per-call-site declaration and no new `_dirty` keys
the client has to get right — which is what makes it survivable, since a client that
misreports a dirty flag silently fails to write.

Deploy ordering is the usual one: this is a backend change, so backend first to dev, then
the school, then merge.

### (c) What is NOT worth doing

**Diffing individual rows instead of full-tab overwrite.** The full-snapshot model is what
every guard in this app is built on — the mass-deletion guard, the revision counters, the
`doGet`/`doPost` key contract. Replacing it to save Sheets calls would be trading the
architecture for a term that is already smaller than the 1.5s transport floor.

---

## 2. Saving photos

### What it costs now

`attachPhotos` loops over the chosen files **serially**, and each iteration does:

    downscale on canvas  →  signPhotoUpload()  →  upload to Cloudinary

`signPhotoUpload()` is a **full `/exec` round trip per photo** — ~1.5s each, by §0. Then
one `persist()` at the end (correctly: accumulating and writing once is deliberate, see the
comment in `attachPhotos`).

Four photos therefore cost roughly: 4 × 1.5s signing + 4 uploads in series + one save.
Call it 10–15 seconds, of which **six seconds is signing round trips**.

### (a) Sign N at once — backend version + frontend

`handlePhotoSign_` mints one `publicId` and one signature per call. Have it take a count
and return an array. Four round trips become one; ~4.5s saved on a four-photo batch.

The security property that matters is preserved exactly: the folder and every object name
are still decided **server-side** and never taken from the request. A batch is N
independent signatures, each authorizing exactly one object — not one signature covering a
prefix, which would be the thing that breaks the guarantee.

### (b) Upload in parallel, and overlap the downscale — frontend only

Cap concurrency at ~3 (phones re-encoding several multi-megapixel images at once is its own
stall) and start file N+1's downscale while N is uploading. The per-file failure handling
and the accumulate-then-write-once rule both survive a bounded `Promise.all`; the progress
counter needs to count completions rather than index.

### (c) Prefetch the signature — frontend only, once (a) exists

Nothing stops the app asking for signatures the moment the file picker opens, so the sign
round trip overlaps the user's file-choosing rather than sitting in front of the upload.
Only worth doing after (a); a pool of single-use signatures is more moving parts than a
batch call.

### (d) The bytes themselves

At `PHOTO_MAX_EDGE` 1600 / quality 0.8 a phone photo lands around 300–600KB. On LTE that
is the second-largest term after signing. Dropping to 1280 would cut it by roughly a third
— but that is a **quality decision, not a free win**, and it is Eric's to make. Flagging
it, not recommending it.

Expected after (a)+(b): a four-photo batch from ~12s to ~4s.

---

## 3. Signing in

**This one is already close to optimal and the obvious lever is a trap.**

Sign-in is one round trip: the `signin` POST verifies the Google credential and returns the
session *and* the whole inventory together. That was the right call and there is no second
call to remove.

What remains inside it:

- `verifyIdToken_` does a `UrlFetch` to Google's tokeninfo endpoint — ~200–500ms, inside
  the ~1.5s. **Verifying the JWT locally instead is not worth it**: it means RSA signature
  verification against Google's rotating JWKS, in Apps Script, which has no such primitive
  — so it would be hand-rolled crypto guarding the app's only real access control, to save
  a third of a second **once per device per week**. Do not do this.
- Everything else at sign-in is the snapshot read and the client boot, i.e. §4.

So: the honest answer on login is that the backend half is done, and what Eric perceives as
slow sign-in is §4 wearing a different hat.

---

## 4. Coming back after a refresh

### It is not authentication, and that matters for where to look

The session is recalled **instantly** — `restoreSessionId()` is a single synchronous
`localStorage` read, and it has always been fast. Nothing re-authenticates on a refresh
unless the session has genuinely expired or been revoked.

What is actually being watched is the app **rebuilding itself from source and then
refusing to draw anything until it has refetched the entire inventory**. The sign-in
screen is not involved. Chasing the auth path would find nothing wrong with it.

The sequence, with measured numbers:

| step | cost | kind |
|------|------|------|
| download index.html, babel, react-dom, lucide, xlsx | ~1.22MB compressed over the wire | network |
| Babel parses its own 2.87MB, then transpiles 884KB of JSX to 732KB | 1.27–1.47s on a server CPU; 4–8s on a phone | **CPU** |
| mount, restore session from localStorage | ~0ms | — |
| `loadData()` POSTs `op:"read"`, backend reads 11 tabs | ~1.5s floor (§0) + tab reads | network |
| first paint | | |

The screen is blank or on the loading state for **all** of it.

Two things follow. First, **the dominant term is CPU, not bandwidth** — 1.22MB compressed
is not much, but Babel has to parse its own 2.87MB and then transform 884KB on the
device, and a faster connection does not help with that at all. Second, the backend read
and the client boot are **two independent halves of the wait**, so fixing either one alone
still leaves the other in front of the user.

### The two halves

#### (a) The client boot — measured, and it is the headline

`index.html` is **884KB**, and Babel Standalone transpiles all of it **on every single
load**. Measured by running the real file through the real Babel build the page loads:

    Babel transform of index.html's script body:  1.27–1.47s  (server-class CPU)
    output size:                                  732KB

A mid-range phone is 3–5× slower than that CPU, so **4–8 seconds of transpiling before the
app's first line runs**, every refresh. On top of it, the load pulls:

                      uncompressed    over the wire
    babel.min.js           2,866KB          598KB
    lucide-react             558KB          166KB
    xlsx                     433KB          175KB
    react-dom                132KB           53KB
    react + client            10KB            —
    index.html               884KB          232KB

**~4.9MB of JavaScript to parse before first paint** (~1.22MB of it over the wire), over
an esm.sh waterfall where each package is a redirect shim pointing at the real module —
two RTTs deep per package. The compressed column is why this is a CPU problem rather than
a bandwidth one: the bytes arrive quickly and then the device has to chew through the
uncompressed column.

Options, cheapest first:

1. **Lazy-load `xlsx`.** It is used by exactly one function, `exportToExcel`. A dynamic
   `await import("xlsx")` inside it removes **433KB from every load** for a button most
   sessions never press. Trivial, frontend only, no deploy. Do this regardless of what else
   is decided.
2. **Cache Babel's output, keyed by a hash of the source.** *(The single biggest one.)* Read the inline script text
   from the DOM, hash it, and keep the transpiled output in Cache Storage or IndexedDB
   under that hash; on a repeat load skip Babel entirely and inject the cached module. This
   removes the 1.3s–8s transform *and* lets `babel.min.js` load only on a cache miss —
   another 2.87MB off the repeat-load path. **This is the change that fits this project's
   constraints**: it keeps the no-build-step property (edit the JSX inline, reload, and a
   changed hash invalidates the cache automatically) while deleting most of its cost.
   Moderate complexity; the care is all in module-script mechanics and making a cache miss
   fall back cleanly rather than white-screening. **The honest limit: the first load after
   any edit to `index.html` is unchanged**, because the hash moved and the cache misses.
   That is precisely the right trade — it costs nothing on the load where the code is new
   and pays on every load after, which is what a refresh is.
3. **A service worker** with stale-while-revalidate over the shell and the CDN deps. Makes
   a refresh near-instant and adds offline tolerance. Bigger commitment: update semantics
   are their own trap, a bad service worker serves stale code to every school at once, and
   the scope has to be path-scoped or `/dev/` and `/` will fight — see the two-build layout
   in `CLAUDE.md`. Worth it only after 1 and 2 are in and measured.
4. **Per-icon lucide imports** (`esm.sh/lucide-react@.../icons/monitor`, ~1.7KB each)
   would take 558KB down to ~85KB, at the cost of ~50 extra requests with a shim hop each.
   esm.sh's own `?exports=` tree-shaking was measured and barely helps — 558KB → 453KB for
   eight icons. Marginal either way; mentioned for completeness, not recommended.
5. **A real build step** (esbuild in the Pages workflow) collapses all of the above into
   one ~400KB bundle and deletes the Babel cost outright. It is the biggest win available
   and it costs the thing `CLAUDE.md` deliberately protects: editing JSX inline and
   reloading, with no toolchain between the source and the page. A "publish a bundle and
   prefer it when present" middle path would mean two code paths for the same app, which
   this project's own history says is how things go stale. **Recommended against unless
   Eric decides the working style is worth trading** — but it is his call, not a technical
   verdict, and option 2 exists precisely so it does not have to be made.

#### (b) The snapshot read

Every refresh re-reads **eleven tabs** — including the whole AuditLog, which is never
pruned and grows forever — and blocks the entire UI behind it. `CLAUDE.md` already names
audit growth as the real ceiling on load time; at ~208 bytes an entry that is ~2MB at 10k
entries.

1. **Paint from a cached snapshot and revalidate in the background.** Keep the last
   snapshot in IndexedDB, keyed by tenant *and* the session it was loaded under; on
   refresh, render immediately from it with a "refreshing" marker and swap when the read
   lands. A 2–5 second blank screen becomes instant.

   **The safety argument is that the revision counters already exist for exactly this.** A
   save built on a stale snapshot is rejected as a conflict and the app reloads — that is
   the mechanism, already shipped and already load-bearing. Still, writes should be held
   until the fresh snapshot arrives rather than offered against stale data: being refused
   is safe, but being refused is not pleasant.

   Two things it must get right: the cache is inventory data sitting in a browser, so it is
   **cleared on sign-out** along with the session id, and it is **keyed per tenant** like
   every other storage key here — an unkeyed cache would show one school's inventory to
   another on the same device, which is the presentation bug `CLIENT.storageKey()` exists
   to prevent, in its worst possible form.

2. **Cap the audit rows in the read payload** — return the most recent N and fetch the rest
   on demand when the master Audit tab actually asks for them. Backend version. Worth doing
   before the log is large rather than after; the tab already pages at `AUDIT_PAGE_SIZE`,
   so the frontend shape for this is half-built already.

---

## 5. Recommended order

Ordered by payoff per unit of risk, not by size.

| # | Change | Where | Deploy? | Effect |
|---|--------|-------|---------|--------|
| 1 | Lazy-load `xlsx` | frontend | no | −433KB every load |
| 2 | Background saves (close the form, keep the pill) | frontend | no | save feels instant |
| 3 | Snapshot cache + background revalidate | frontend | no | refresh feels instant |
| 4 | Parallel photo uploads + overlapped downscale | frontend | no | ~40% off a batch |
| 5 | Batch photo signing | both | yes | ~4.5s off a 4-photo batch |
| 6 | Per-tab dirty via Config hashes | both | yes | 8 tab rewrites → 1–2 |
| 7 | Cache Babel output by source hash | frontend | no | −1.3s(desktop)/−4–8s(phone) + −2.9MB on repeat loads |
| 8 | Cap audit rows in the read | both | yes | keeps load flat as history grows |

**On the refresh specifically: 3 and 7 are the pair.** They attack the two halves named
above and neither one alone finishes the job — 3 removes the read from the blocking path
but leaves the Babel wait in front of it, 7 removes the Babel wait but leaves the read.
Together they take a refresh on a phone from roughly 6–10 seconds to near-instant.

1–4 need no backend deploy at all and cover most of what Eric is feeling. 5 and 6 are one
backend release together, so they should ship as one version rather than two. 7 is the
largest single win on refresh and the most delicate; it deserves its own branch. 8 is
insurance rather than a fix today.

**Explicitly rejected:** local JWT verification (§3), row-level diffing in `doPost` (§1c),
and a build step (§4a.5, unless Eric wants it).
