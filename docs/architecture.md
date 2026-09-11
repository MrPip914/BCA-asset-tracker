# Architecture

*Read before changing state, persistence, auth, the toolbar/header, or shared table components.*

*Moved out of `CLAUDE.md` on 2026-09-11, verbatim. See `CLAUDE.md` for the rules that apply to every change.*

- **State**: the whole app is one component (`AssetTracker`, ~3700 lines) holding all
  state — assets, managed lists (change types, vendors, peripherals, users), audit log,
  column config. This is a known architectural weak point (see "Component size" below),
  not an endorsement — it's evolved this large rather than being designed this way, and
  splitting more of its render tree out the way `BreakersTabContent` was pulled out is
  the natural next step whenever a tab gets touched again.
- **Related state lives in one object, not parallel `useState`s**, wherever it's opened/
  closed together — e.g. `breakerModal` (anchor id, per-member amp drafts, instance
  draft, editing flags, error, all in one object, `null` when closed) instead of 8
  separate states. This isn't just tidiness: before this consolidation, `openDetail()`
  (which runs every time you navigate to a different asset) didn't reset any of the
  breaker-modal or Add-Breaker-form state, since resetting 8+ scattered setters is easy
  to forget one of — which is exactly what happened. Grouping into one object made
  `openDetail()`'s reset trivial (`setBreakerModal(null)`) and structurally harder to
  regress. `swapModal`, `moveCircuitModal`, and `addBreakerDraft` (its own `error` field
  instead of a 4th parallel state) follow the same shape. `allocationDraft` folds its
  error in too. Maintenance's add/edit/delete state was *not* consolidated — it's three
  genuinely different sub-flows (new item, editing an existing one by index, confirming
  a delete), not one thing with parallel copies, so merging it would add complexity
  rather than remove it.
- **Persistence model**: the app keeps its full state in memory and, on every change,
  sends the ENTIRE state as one JSON snapshot to the Apps Script backend (`persist()` ->
  `writeSnapshot()` -> `fetch(SHEET_API_URL, { method: "POST", ... })`). On load, it does
  one GET to the same URL and reconstructs everything (`useEffect` near the top of the
  component). `persist(nextAssets, overrides)` takes an *options object* for everything
  besides assets (`{ columns, changeTypes, vendors, auditLog, peripheralsList, usersList,
  bulkItemTypes, typesList, breakerTypes }`) — each defaults to the current state, so a
  call site only names whichever domain it's actually changing (most calls are just
  `persist(next, { auditLog: logAudit([entry]) })`) instead of re-passing every other
  domain unchanged, which is what a 10-positional-argument signature demanded before.
  No per-field diffing on the client — but `persist()` does compute which *domains*
  changed (`_dirty: { assets, config }`), via plain reference-equality against
  current state (every call site already either passes a domain through untouched or a
  freshly computed value, so this needs no per-call-site bookkeeping). `AssetTrackerSync.gs`'s
  `doPost` uses that to skip rewriting the Assets/Comments/Changes/Allocations/Maintenance
  tabs when nothing asset-related changed, and skip Config when no managed list or column
  changed — e.g. toggling a managed-list entry no longer rewrites the Assets tab, and vice
  versa. AuditLog is handled differently again: since entries are only ever appended to
  (never edited or deleted client-side), `appendNewRows_` appends just the new rows instead
  of rewriting the whole — ever-growing — history each time. A request with no `_dirty` at
  all (an old client, or a direct API call) still rewrites everything, as the safe fallback.
  `LockService` still guards every write so concurrent saves don't corrupt a tab.
- **Optimistic concurrency (backend v12)**: because every save is a full overwrite, a
  client saving a snapshot it loaded *before* someone else's save used to silently drop
  that person's work. Each of the three `_dirty` domains now carries a revision counter,
  stored in Config as `rev_assets`/`rev_config`/`rev_breakerTypes`. `doGet` returns them
  (`revisions`), the frontend holds them next to `nextAssetNumber`, and `persist()` posts
  them back as `_revisions`. Inside the same `LockService` critical section as the writes,
  `doPost` compares posted vs stored for each domain it's about to write; on any mismatch
  it writes **nothing** (not even the audit rows, which describe the rejected change) and
  returns `{ ok: false, conflict: ["assets"], revisions: {...} }`. Otherwise it writes,
  bumps only the domains it actually wrote, and returns the new revisions so the client can
  keep saving without reloading first. Per-domain, not one global counter, so editing a
  managed list doesn't conflict with someone editing an asset. On a conflict the frontend
  does **not** merge and does **not** retry — either would destroy one of the two changes —
  it reloads through `loadData()` (which also replaces the optimistic `setState` calls
  `persist()` makes around the write, so the app stops showing an edit that isn't stored
  anywhere) and shows a blocking "Your change wasn't saved" modal telling the user to redo
  it. A payload with no `_revisions` (an older client, a direct API call) is still accepted
  and written — same fallback philosophy as a missing `_dirty` — and still bumps the
  counters so other clients notice. Sandbox mode makes no network call at all, so it
  attaches no revisions and no check runs, rather than fabricating numbers locally. Two
  supporting details in `persist()`: `revisionsRef` mirrors the revision state because a
  POST needs the value as of the moment it's *sent*, and `writeQueueRef` serializes the
  POSTs so only one is in flight — several call sites fire `persist()` without awaiting it,
  and an overlapping second save would otherwise post the revision the first is about to
  bump and be rejected as a conflict with this very client's own write (overlapping
  full-snapshot writes could also already land out of order before this).
  One knock-on effect: since the counters live in Config and `writeTable_` rewrites that
  tab wholesale, Config is now rewritten whenever *any* domain is written. When config
  itself isn't dirty its stored rows are copied straight back unparsed (including keys the
  script doesn't know about), so the content is unchanged — only the counters move.
- **Wipe and import are a menu on the Sheet, not a script (backend v29).** `onOpen` adds a
  **BCA Admin** menu with "Import inventory" and "Wipe all data"; both empty every data tab
  and rewrite Config in one `LockService` section.
  - **Why not a Node script, which is what was asked for.** `/exec` needs a signed-in
    session (v18+), so a script could only get one by copying a live credential out of a
    browser. Inside the bound script there is no credential at all — the Sheet's own
    authorization is the auth — and it works from a phone, which is where Eric operates.
    - **This reasoning still holds for wipe/import and is NOT contradicted by `sheet.mjs`**
      (2026-09-09), which reaches the Sheet through a different door: the Sheets API with a
      service account, not `/exec` with a stolen session. That door did not exist in this
      project when the paragraph above was written, and it closes the objection — a service
      account key is its own credential, not a copy of a person's. What stays true is the
      part about phones: a full replace is still better as a menu Eric can run from one,
      and `sheet.mjs` is for surgical edits, not for replacing the inventory.
  - **Menu handlers must NOT end in `_`.** Apps Script treats a trailing underscore as
    private and silently refuses to wire it to a menu item. Every helper here keeps the
    underscore; only the four `menu*`/`onOpen` entry points drop it.
  - **Both bump every revision counter**, which is load-bearing rather than tidy: a browser
    left open still holds the pre-wipe snapshot, and without the bump its next save would
    overwrite everything the import just did. With it, that save is refused as a conflict
    and the app reloads.
  - **`adminWriteConfig_` copies through every key it wasn't asked to change**, which is
    what preserves `authUsers`. A fixed key list there would blank the allowlist and lock
    out everyone but `OWNER_EMAIL` — the same hazard `doPost`'s own `authUsers` handling
    exists to avoid, met again in a second place.
  - **The import sets `usersList` to `[]` deliberately.** A stale name with no matching
    User asset makes `usersAreAssets` false, dropping the app to legacy name mode where
    every `personIds` assignment renders as unassigned and the next save writes that back.
    That is the single most destructive thing this can get wrong, and it is exactly what
    the by-hand process kept getting wrong.
  - **It parses and summarises BEFORE it destroys anything** — the confirmation quotes real
    row counts from the fetched file, and every validation failure throws before
    `adminReplaceAll_`, whose first act is to empty the sheet.
  - **The data is read from a TAB in the Sheet, and getting here took two wrong turns
    worth knowing about.** `adminReadGrid_` resolves a blank or bare-name answer to a tab
    (`IMPORT_TAB_NAME`, "Import"); an explicit `http(s)` URL still fetches.
    - **First wrong turn — a raw URL from this repo.** Simplest possible fetch, and it
      would have published the school's entire inventory (21 staff by name, which room
      each sits in, every serial number and hostname) to a **public repo**, permanently,
      since git history outlives a deletion. **`import/` is gitignored** for that reason:
      the generated CSV, the source xlsx and the transform scripts stay local.
    - **Second wrong turn — `DriveApp.getFilesByName`.** Private, and it failed at runtime
      with "You do not have permission to call DriveApp.getFilesByName". **The live
      manifest declares its `oauthScopes` explicitly**, so Apps Script does not auto-detect
      a newly used API's scope, and `deploy.mjs` deliberately keeps the LIVE manifest so a
      deploy can never alter the web app's access settings. Adding the scope is possible
      but not free: the web app executes as its owner, so between that deploy and the owner
      re-granting, **every user's requests fail** — the same trap
      `forceAuthorizeExternalRequests` documents for `UrlFetchApp`.
    - **So the rule for anything added here: use an API the script already holds a scope
      for.** `SpreadsheetApp` reads and writes tabs on every request already, so a tab
      costs nothing. The data also never leaves the document, and is visible before it is
      imported.
    - `getDisplayValues()`, not `getValues()` — Sheets turns a date-looking cell into a
      real `Date` on CSV import, and the app expects plain `yyyy-MM-dd` strings. Same
      hazard `writeTable_`'s `setNumberFormat("@")` exists for, met from the other side.
    - A missing tab **refuses and says how to create one**, deliberately not going through
      `getSheet_`, which would create an empty tab and then report "no data rows" — hiding
      the real answer, that the file never arrived.
    - The scratch tab is **deleted once the write succeeds**, so no second copy of the
      inventory is left in the document for a later import to read by mistake. A failure to
      delete it is reported without claiming the import failed.
- **Saving feedback is one flag, because `persist()` is the one choke point**: `isSaving`
  (plus a `savingRef` mirror) is set at the top of `persist()` and cleared in a `finally`,
  so it clears on success, on a network/backend failure, *and* on the conflict path that
  reloads and opens the blocking modal — a spinner that never stops would be worse than
  none. Since every write in the app funnels through `persist()`, that single flag covers
  every form without per-form plumbing: it drives a "Saving…" pill in **both** headers
  (list and detail) and puts every write control into a disabled *and visibly working*
  state — label swapped to "Saving…", `C.border` background, spinner (`Loader2` +
  the `.spin` keyframe) on the icon buttons. A disabled-but-otherwise-unchanged button
  still reads as frozen, which is the exact confusion this exists to fix. Components
  outside `AssetTracker` (`ListManagerModal`, `ChildEntityTable`, `BreakersTabContent`,
  `PanelConfigForm`) take it as an `isSaving` prop.
  Two things this is deliberately *not*: it is **not** a guard inside `persist()` — a few
  write paths aren't gated on it (the bulk reassign/move toolbar), and refusing one of
  those would silently drop a real edit; the guard is an `if (savingRef.current) return;`
  at the top of each submit *handler* instead, catching the double-click that lands before
  React re-renders the button as disabled. And it does **not** replace `writeQueueRef` —
  that still serializes the POSTs; this stops the second identical submit from ever being
  created, which the queue can't do (it would happily send both).
  Sandbox mode needs no special case: its write never awaits, so `isSaving` goes true and
  false inside one React batch and no "Saving…" frame is ever painted.
  A failed save now shows a "Save failed" pill in that same slot. It used to be a bare
  "Sync failed" tucked inside the name button on the *list* header only — i.e. invisible
  on the detail page, where almost every edit is actually made.
- **Sheet schema**: Assets tab holds flat fields only (see `ASSET_FIELDS` in the .gs
  file). Comments, Changes (structured change log with type/vendor/cost), Allocations
  (bulk-item quantity assignments), and Maintenance (scheduled maintenance items) each
  live in their own tab, keyed by the asset's `label` (its asset ID, e.g. `BCA0001`).
  Breakers (keyed by `panelLabel`) and Circuits (keyed by `breakerId`, one level deeper —
  see `docs/panels-breakers.md`) are the same pattern with an extra level of nesting. Config tab stores
  the managed lists and column config as JSON blobs (key/value rows), since those aren't
  naturally tabular.
- **Authentication (backend v18)**: Google Sign-In, gating the whole app. The browser signs
  in against `GOOGLE_CLIENT_ID` (`index.html`) / `OAUTH_CLIENT_ID` (`AssetTrackerSync.gs`) —
  **the same id must appear in both**, since the backend rejects any token not minted for
  exactly it. The ID token is sent with every request and verified server-side against
  Google's `tokeninfo` endpoint, then the email is checked against the `authUsers` allowlist
  in Config.
  - **Two separate questions, kept apart deliberately.** Google answers "is this really
    them?"; the allowlist answers "may they in, and may they write?". The OAuth client is
    **External** (the school has no Workspace, so Internal was unavailable), meaning *any*
    Google account can pass the first. That grants nothing — the allowlist is the gate.
  - **The full read is now a POST**, `doPost({ op: "read" })`, not a GET. Purely so the token
    travels in the body: a GET could only carry it in the query string, writing a live
    credential into browser history and Google's logs. The parameterless `doGet` now refuses
    with `authFailed` — but still reports `scriptVersion`, because checking the deployed
    version by opening `/exec` in a browser is a documented diagnostic that has to keep
    working without a token.
  - **`?panel=` stays anonymous**, unchanged. It's the QR-code page for physical panels
    (`panel.html`). v14 wrote it as its own branch rather than an exemption inside the
    authenticated path, which is exactly why v18 needed to carve no hole for it.
  - **Roles**: `editor` or `viewer`. View-only is enforced in `doPost` and again at
    `persist()` — the buttons are also hidden, but that is a courtesy, not the control.
  - **Lockout is impossible**: `OWNER_EMAIL` in `AssetTrackerSync.gs` is always an editor
    regardless of the allowlist, and `authUsers` is *preserved* rather than overwritten when
    a save doesn't carry it. That second part matters because the Config tab is rewritten
    wholesale on every config save — without it, one save from a client that doesn't know
    about `authUsers` would empty the allowlist and lock out everyone but the owner.
  - **Sandbox bypasses all of it** (`authSatisfied = sandboxMode || !!auth`), since it never
    touches the backend. The sign-in screen carries its own "Continue in Sandbox" link —
    the Sandbox pill lives in the header, which is now behind the gate, so without that link
    a signed-out browser could never reach sandbox mode at all.
  - **Sessions (v22): the Google ID token is used ONCE and never stored.** `doPost`
    exchanges it at `op:"signin"` for a script-issued session, and the browser presents
    that from then on (`SESSION_ID_KEY` in `localStorage`).
    - **Why not just keep the Google token:** it lasts about an hour and a browser cannot
      renew one silently — Chrome's move to FedCM made `auto_select` undependable, so v21
      (which did store it) sent people back to the sign-in screen constantly. A session
      also can't be revoked if it's a self-expiring token; a record can.
    - **Sessions live in Script Properties, NOT the Sheet.** Anyone with the Sheet can read
      every tab, and `doPost` rewrites tabs wholesale — a session table there would be both
      readable and destroyable by an ordinary save.
    - **7 days, sliding** (`SESSION_TTL_MS`). Any request pushes the expiry back a full
      week, so a regular user is never asked again while a forgotten device ages out. The
      rewrite is throttled (`SESSION_TOUCH_THRESHOLD_MS`) so a property isn't written on
      every single request just to move an expiry by seconds.
    - **The allowlist is still re-read on EVERY request**, so removing someone or dropping
      them to view-only takes effect on their next action, not when their session expires.
      Removal additionally calls `deleteSessionsForEmail_` to end their sessions outright.
    - **Sign out is real**: it POSTs `op:"signout"`, which deletes the record server-side.
      Fire-and-forget on purpose — the local sign-out must happen whether or not the call
      lands, and a session that outlives a failed call still expires on its own.
    - `readSession_` shape-checks the id before it touches storage, because the id becomes
      part of a property key.
    - Expired records are only noticed when presented, so `sweepExpiredSessions_` runs at
      sign-in to keep storage bounded.
    - v22's first load also deletes the leftover `asset-tracker-auth-token` that v21 left
      in every user's browser. Safe to remove that cleanup once nobody is on v21.
  - **Local testing needs `http://localhost:<port>` registered** as an authorized JavaScript
    origin on the OAuth client. `file://` has no origin Google accepts, so double-clicking
    `index.html` shows the sign-in button and then fails.
- **Personal identity**: `currentUser` (what stamps comments/changes/audit rows) now comes
  from the server-resolved identity on load — verified, not typed. The old self-declared
  `localStorage` name tag (`USER_STORAGE_KEY`) survives for **sandbox mode only**, which has
  no sign-in but still wants an author on audit entries.
- **Column visibility is per-device**, also `localStorage` (`COLUMN_VISIBILITY_STORAGE_KEY`),
  not the Sheet. Column *definitions* (key/label/width/custom flag) stay server-synced via
  Config, since a custom column adds a real field to every asset — only which columns are
  *shown* is local. `isColumnVisible(c)` reads the local override first, falling back to the
  column's server-defined `visible` (e.g. for a custom column another device just added, which
  this device hasn't seen/hidden yet). `toggleColumnVisible()` never calls `persist()`.
- **`ChildEntityTable`** (bottom of the file) is a generic list/add/edit/delete component for
  a structured child entity (fields config + items + onAdd/onSave/onDelete), built for
  Breakers and Circuits and intended for reuse — Locks under Doors is planned next and will
  need the identical list/add/edit/move shape. It owns its own add/edit/expand/delete-confirm
  UI state; the caller supplies data + callbacks, plus `renderCustomFields` for anything that
  doesn't fit the generic field-type system (text/number/date/select/multiselect) — used for
  a Circuit's rooms-served-vs-feeds-sub-panel toggle. Actions that aren't a generic field edit
  (Swap Breaker, Move Circuit) live outside the component via `customRowActions`, which opens
  the caller's own dedicated modal.
- **Component size**: `AssetTracker` is still a god-component (state, handlers, and most tab
  content all live in it) — a byproduct of the app growing feature-by-feature with no build
  step to make splitting files free. `BreakersTabContent` (the Breakers detail-tab's whole
  render: "Fed from" banner, panel config/diagram toggle, Add Breaker form) was pulled out as
  a top-level component taking only the props it touches, as a first cut proving the pattern
  works with zero build-step cost — plain JS/JSX reorganization within `index.html`, nothing
  else changes. Not all tabs have been split out this way yet; do the same extraction for
  another tab's content next time that tab needs real changes, rather than a dedicated
  refactor pass.
- **Main-page toolbar is intentionally minimal, on both top-level tabs**: on Assets,
  Columns/Export/Add Asset live in a hamburger menu (`showToolbarMenu`) anchored top-right of
  the Assets/Maintenance tab row rather than as always-visible buttons; on Maintenance, the
  same hamburger (shared state — only one tab's content is mounted at a time, so no conflict)
  holds just Export, since there's no per-tab Columns or an "Add" equivalent there. On both,
  the search box collapses to an icon (`searchOpen`) and expands on click — bound to `query` on
  Assets, `maintenanceQuery` on Maintenance — staying expanded whenever its query is non-empty
  so an active search is never hidden. Neither tab has a "Showing X of Y" count line: on Assets,
  the one thing that lived there besides the count (clearing an active sort) moved to a small ×
  chip next to the sort arrow on the sorted column's own header; on Maintenance, the overdue
  count that lived there is now a standalone badge above the table.
- **The header's account controls are one dropdown, and About is where the app names its
  own version** (2026-08-26). The top-right used to carry four separate controls beside the
  Sandbox pill — the name/identity tag, an `Access` link, a `View only` badge, `Sign out`.
  They're one `accountMenu` now (`showAccountMenu`), built like the toolbar hamburger
  (fixed-inset click-catcher + absolutely positioned card): an identity block at the top
  (name, email or "Sandbox — local data", Editor/View only), then Set name (sandbox only),
  Access (editors, real backend only), About, Sign out. Sandbox and signed-in are the same
  menu rather than two, which is what let sandbox's "Set name" stop being a second
  person-shaped button in the corner.
  - **The `View only` badge deliberately stayed OUTSIDE the menu.** It exists to explain why
    the edit controls a viewer expects aren't there, and an explanation you have to open a
    menu to find doesn't do that. The menu shows the role too; the duplication is the point.
  - **About answers "which build is this browser actually running?"**, which nothing in the
    app could answer before — the only version string was `FRONTEND_SCRIPT_VERSION`, and it
    is a *backend contract*, not a build id. It shows four version-ish facts because they go
    stale independently: `APP_VERSION` (this file's build), `document.lastModified` (what the
    browser says the file's date is — no discipline needed, so it catches a cached page even
    when the bump was forgotten), the backend version this build expects, and what the
    deployed backend reports. Plus data source (Sheet vs Sandbox), identity, and role.
  - **`APP_VERSION` is hand-bumped, `YYYY-MM-DD.N`, and is NOT `FRONTEND_SCRIPT_VERSION`.**
    Keeping one constant for both would answer the question wrongly: the script version only
    moves when `AssetTrackerSync.gs` changes, so every frontend-only change would leave it
    identical. Bump `APP_VERSION` whenever `index.html` changes in a way worth verifying
    landed. A stale value here is only a misleading label — never dropped data, which is what
    a stale `FRONTEND_SCRIPT_VERSION` costs.
  - The build string is repeated on the **sign-in screen**, since About sits behind the gate
    and "which build is this?" is often asked precisely because you can't get past it.
- **Per-column filter + sort is a shared pattern, not duplicated per table**: `ColumnHeaderCell`
  (Filter icon + click-to-cycle sort + clear-sort × chip) and `ColumnFilterModal` (option list +
  Sort A→Z/Z→A) are generic, parameterized by a `filterConfigs` map (`{ [colKey]: { label, value,
  setValue, options, labelForOption? } }`) plus `sortConfig`/`setSortConfig`. The Assets table's
  Type/Room/User/Status columns and the Maintenance table's Frequency/Owner/Status columns (Task/
  Asset/Last Performed/Next Due are plain sort-only, no filter) both go through these same two
  components — each tab just supplies its own state and options. `labelForOption` exists for
  columns whose stored value isn't the display text (Maintenance's Status filter stores
  `"due-soon"` but shows "Due soon", via `MAINTENANCE_STATUS_FILTER_OPTIONS`). Maintenance's
  default (unsorted) view is always due-soonest-first with never-performed items pinned to the
  top; picking an explicit column sort overrides that until cleared.
- **Edit affordance convention**: every "edit this record" trigger is an icon-only pencil
  (`<Pencil size={14} color={C.muted}/>`, `aria-label="Edit ..."`), positioned at the trailing
  edge of the row/section it edits, alongside that row's other icon actions (delete, etc.) —
  e.g. the Breaker Type manager row, a breaker instance/member row, a Circuit row, a Maintenance
  item's header row. The one exception is the Asset Detail page's primary "Edit" button (opens
  the full edit form) — it keeps a text label since it's a page-level action sitting next to
  other labeled buttons (Duplicate/Archive/Delete), not a per-row list action.
