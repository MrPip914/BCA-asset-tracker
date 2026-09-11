# Photos attach by reference, never by value

*Read before touching photo upload, storage, galleries or the public panel page's photo scope.*

*Moved out of `CLAUDE.md` on 2026-09-11, verbatim. See `CLAUDE.md` for the rules that apply to every change.*

### Photos attach by reference, never by value

Photos live in **Cloudinary**; the Sheet stores a reference and nothing else. The full
evaluation and the three decisions behind it are in `PHOTOS_EVAL.md`.

- **The bytes could never have gone in the Sheet, for three independent reasons.** Every
  save posts the entire state, so a base64 image would be re-sent on every unrelated edit;
  a cell holds 50,000 characters, about 28KB of image against a 2-5MB phone photo; and
  `ContentService` has no image MIME type, so bytes could not be served back out even if
  they got in. That third one is the easiest to miss when sketching a Drive-based design.
- **The browser uploads directly and the backend only SIGNS, which is why this needed no
  new OAuth scope.** `Utilities.computeDigest` requires no authorization, so the manifest
  is untouched and `deploy.mjs` keeps working. Writing to Drive instead needs a scope the
  live manifest does not declare, and granting one means the owner re-authorizing while
  **every user's requests fail** — the trap v29's `DriveApp` import hit and v30 backed out
  of. **The rule that generalizes: prefer a design that needs no scope the script does not
  already hold.**
- **Credentials are per-tenant Script Properties and the deploy does not carry them**:
  `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, optionally
  `CLOUDINARY_FOLDER`. `op:"photoSign"` refuses and NAMES the missing keys, because a
  per-tenant setup step is easy to forget on a newly onboarded school and the symptom
  otherwise looks like a broken feature.
  - **Never an unsigned upload preset.** The preset name would have to ship in
    `index.html`, which is public, and anyone holding it can upload into the account.
    Server-side signing is also what keeps the `editor` check on uploads, where every other
    write rule lives.
  - **The folder and object name are chosen by the BACKEND, never taken from the request.**
    A client picking its own could overwrite an existing photo by naming it. A signature
    authorizes exactly one object, and deciding the name server-side is what makes that true.
- **`photos` is a revision domain of its own, not part of `assets`.** A photo can belong to
  a breaker or a work entry, so folding it in would make attaching one conflict with anyone
  editing any asset anywhere.
- **The write is gated on `dirty.photos`, which is what makes the backend safe to deploy
  ahead of the frontend.** A client that sends `_dirty` without that key leaves it
  `undefined`, so the Photos tab is untouched; only a client sending no `_dirty` at all gets
  the rewrite-everything fallback. Same shape as the `_dirty`-all-false guard on `op:"read"`.
- **The public `?panel=` page publishes photos, scoped to the panel, its breakers and its
  circuits** (`PHOTOS_EVAL.md` §7). The scope is a whitelist of ids assembled from what is
  already in that payload, so a photo of a laptop, a room or a person is **unreachable
  rather than filtered** — keep it that way rather than turning it into a query by owner
  type, because that bound is the entire reason publishing on an anonymous page was judged
  safe. `hiddenFromPublic` is the per-photo escape hatch and is checked BEFORE ownership, so
  a later change to the scoping cannot route around it. `PUBLIC_PHOTO_FIELDS` omits
  `storageKey` (the write handle) and `by` (a staff member's name).
- **`storageKey` is stored alongside the URL** because it is NOT recoverable from a
  transformed delivery URL, and it is what a deletion or a change of host would need. It is
  why moving off Cloudinary stays a copy plus one column rewrite.
- **A PHOTO ROW AND THE ID IT NAMES MUST BE WRITTEN IN THE SAME SAVE** (2026-09-11), and
  the bug that taught it is the sharpest example in this file of what a load-time adoption
  cannot cover. A work entry's and a schedule's id are adopted with
  `c.id || crypto.randomUUID()`, so a row written before v34 has a blank id cell and is
  handed a **fresh random id on every load**. Attaching a photo marks only the photos
  domain dirty, so the row landed in the sheet naming an id the very next load replaced.
  The photo was written, correct, and permanently unreachable — and the already-orphaned
  rows cannot be repaired, because the id they name never existed anywhere but one
  browser's memory.
  - **The asymmetry is what made it look like a photos bug rather than an id bug.** Asset
    photos survived, because an asset's id is adopted as `a.id || a.label` — deterministic,
    so a blank cell yields the SAME id every load. Only the two randomly-adopted owner types
    could orphan. Breakers and circuits mint theirs inside an asset save, so they are stored.
  - `attachPhotos` therefore passes a NEW assets array (`assets.slice()`) for a `change` or
    `maintenance` owner, which marks the assets domain dirty by reference and writes those
    ids alongside the row that points at them. It deliberately does NOT for the other owner
    types: rewriting five tabs and bumping the assets revision would conflict with anyone
    mid-edit for no gain.
  - **Generalize it:** wherever a reference is minted by a load-time adoption, the save that
    writes the reference must also carry the domain holding the target. `saveChangeEdit`'s
    "nothing changed, no write" path is the same trap from the other side — it is correct,
    and it means the id can still be memory-only when that dialog closes.
  - Covered by `test-frontend-photos.js`, which EXECUTES `attachPhotos` — the whole
    mechanism is one array identity, so it cannot be read off the source.
- **`adoptPhoto` never guesses a blank `ownerType`** (it defaulted to `"asset"` until
  2026-09-11). A blank can only come from a hand edit, and defaulting files a work entry's
  photo in its asset's gallery: the wrong photo shown confidently in the wrong place, which
  is worse than one that cannot be found. Left blank it matches no owner and stays out of
  every gallery until the cell is fixed.
- **An id exists once something points at the record, and not before** — the rule work
  entries and maintenance items arrived at twice. Photos are what made a work entry need
  one. Comments still have none, deliberately: nothing references a comment.
  - **An id also has to exist at CREATE time, not only after a load-time adoption.**
    `addMaintenanceItem` minted none at all until 2026-09-11: v34 gave schedules an id,
    moved every handler onto it and keyed the rows on it, but never wrote one where a
    schedule is born, and `adoptLegacyMaintenanceIds` filled the blank on the next load.
    That is exactly what hid it — reloading is the only cheap way to check, and after a
    reload it looks correct. Inside one session `startEditMaintenance(undefined)` matched
    the FIRST id-less item, so two new schedules meant editing the wrong one. **Where a
    load-time adoption exists, check the create path separately**; it is the one place the
    adoption cannot cover.

**Where a photo's gallery lives follows what the photo is FOR** (2026-09-11), and the two
work-item cases deliberately differ:

- **A work entry's photos are EVIDENCE of a moment** — a receipt, a before and after — so
  they live in its dialog, and the entry's id is minted when that dialog OPENS rather than
  when it saves. Otherwise a photo could only be attached by saving and reopening to edit,
  which is how the photo does not get taken. **The accepted cost is stranded bytes**:
  uploads start as soon as a file is picked, so cancelling the dialog afterwards leaves an
  orphan at the host. That is the same trade this feature takes everywhere — an invisible
  orphan over a row whose image 404s. The History row shows a READ-ONLY strip, because a
  photo only reachable through an edit form is nearly useless, and a second set of write
  controls out there would be a second thing to keep in step.
- **A schedule's photos are REFERENCE material** — where the access panel is, what the
  filter looks like when it actually needs doing — so the full gallery, add control
  included, sits on the Scheduled row where the schedule is READ. The photo that matters
  gets taken later, when someone is finally standing in front of the thing, and putting the
  control behind an edit form would be putting it where nobody is.

- **The lightbox renders from `renderWorkDialogs`, not the detail view**, and that is a
  fixed bug rather than a preference: the work dialogs render from BOTH views, so once one
  grew a gallery, opening a photo from the site-wide Maintenance tab set the state and
  painted nothing. Anything reachable from both views belongs there.
- **Captions are edited in the lightbox**, because that is the moment you are looking at
  the photo and can say what it is. The draft is held apart from the photo and reseeded
  every time the viewer opens, so an abandoned edit leaves nothing behind — the rule the
  work dialog and breaker edit mode already follow. Every gallery opens through
  `openPhotoViewer` rather than `setPhotoViewer`, or the draft carries one photo's caption
  into the next.
- **Photo rows CASCADE when an asset is permanently deleted** (Eric's call, 2026-09-11).
  `photoOwnerIdsOf` collects every id the asset carries that can own one — itself, its work
  entries, its maintenance items, its breakers and their circuits. Deliberately not a
  blocked delete: permanent delete is already a rare, twice-confirmed action on an
  already-archived asset. The images survive at the host either way, so dropping the rows
  destroys nothing. It passes `persist` the same array reference when nothing matched, so a
  delete that removed no photos does not mark the photos domain dirty.
- **Deleting a photo row does not delete the image.** Orphans are the safe failure — upload
  the bytes first, write the reference second, so a rejected save strands bytes rather than
  leaving a row whose image 404s. A sweeper is deferred and is the dangerous half:
  "the client sent no photo rows" and "delete every object" are the same request on the
  wire, the same ambiguity behind `doPost`'s mass-deletion guard.
- **Covered by `test-backend-photos.js`**, the only place it *can* be covered — Sandbox
  never contacts Apps Script and signing needs credentials that exist only in Script
  Properties. Verified by mutation that six silent-failure modes fail it: dropping either
  public filter, leaking `storageKey` or `by` into the whitelist, ceasing to write
  `storageKey`, an unmasked byte in `sha1Hex_`, and signing parameters unsorted.
