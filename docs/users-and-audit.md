# Users as assets, and the audit log

*Read before touching User assets, `personIds`, or anything that writes or renders an audit entry.*

*Moved out of `CLAUDE.md` on 2026-09-11, verbatim. See `CLAUDE.md` for the rules that apply to every change.*

**Users are assets (backend v28).** A person has a record, a detail page, and an audit
history, and an asset points AT one by id (`personIds`, an array of User labels) instead
of storing a name string. This is the app's **first many-to-many between assets** — one
device can have several users — which is why it wasn't the single-valued `parentId`
collapse and got its own phase.
- **Deliberately NOT the sign-in allowlist.** `authUsers` answers "who may open the app";
  a User asset answers "whose desk is this on". The app wants people in the inventory who
  never sign in — a student, or someone who has left whose history is still worth keeping.
  Linking them is a later question, and Eric's explicit call (2026-08-26) was to keep them
  apart for now.
- **Retiring someone is ARCHIVING them** (Eric's call), which keeps their history and every
  assignment intact. `canDeleteAsset` therefore blocks the permanent delete of a User who
  is still assigned to anything, exactly like a Room that still holds something.
- **`ensureLockedTypes` puts a missing locked type back in REGISTRY order, not at the end.**
  Appending is what User did on arrival: it landed below `Other` at the very bottom of the
  picker — the one entry beneath the catch-all, which is where the eye stops looking — and
  read as an afterthought rather than a peer of Room and Building. Existing entries keep
  their order; only the new arrival moves.
- **`person` is synced from `personIds` ONLY in id mode, and that gate is a data-loss fix.**
  `doGet` returns `personIds: []` for *every* asset, so in name mode — where `person` is the
  source of truth and nothing writes ids — an ungated sync overwrote `person` with `""` on
  every single save. It shipped, and it wiped assignments on the live sheet before Eric hit
  it. **Sandbox could not reproduce it**, because `MOCK_SNAPSHOT` rows carried no
  `personIds` key at all and the `isArray` test was false there. That is the lesson, not the
  line: a fixture whose SHAPE differs from the backend's actual response hides exactly the
  bugs the fixture exists to catch. `loadData` now normalizes `personIds` to an array for
  every asset from both sources, so fixture and backend agree.
- **Converting closes any open edit form.** The conversion changes what the User field
  means, and a draft seeded under the old meaning holds an empty `personIds`; saving it
  afterwards wrote that empty array back and blanked that one asset. Same class of bug as
  the one above, found in the same session by testing the two orders separately.
- **The mode switch is ALL-OR-NOTHING, and that is load-bearing.** `usersAreAssets` means
  the conversion is *complete* (`unconvertedUserNames.length === 0`), not that some User
  record happens to exist. An earlier version meant the latter and had a real bug: in id
  mode the edit form reads `personIds`, so an asset still carrying only a legacy `person`
  name rendered as **unassigned**, and the next save wiped the assignment. Found in browser
  testing, not by reading the diff.
- **`person` (the pre-v28 slash-joined names) is kept and still written**, trailing
  `personIds` the way `roomId`/`buildingId` trailed `parentId` through v17 — so the change
  is reversible and an un-migrated row still resolves. `personNamesOf()` reads ids first and
  falls back to it; **nothing outside `personLabelsOf`/`personNamesOf` should read either
  field.**
- **The conversion is offered in the LIST TOOLBAR menu** (next to Columns/Export/Add
  asset), shown only while `unconvertedUserNames` is non-empty so it surfaces itself once
  and then retires. It first lived only behind the gear on the User field — which is inside
  the *edit form* — i.e. a one-time setup action reachable only by opening an asset and
  clicking Edit, which nobody had a reason to do. It is still in the users manager too.
- **Conversion is a BUTTON, not a load-time rewrite** (`convertUsersToAssets`, in the users
  manager). Creating assets means issuing labels from `nextAssetNumber`, which lives in the
  Config domain behind the revision check — so a load-time conversion running in several
  browsers at once would race for the same numbers and one set of User assets would collide
  with the other. One deliberate click goes through `persist()` like every other write:
  audited, conflict-checked, all-or-nothing. Idempotent, so a name added later just re-runs it.
  - The conversion does **not** log a per-asset audit entry. Nobody's assignment changed —
    only its storage did — and an entry per asset would read "User changed from Jen Kramer
    to Jen Kramer" across the whole inventory, burying the entries that mean something. The
    User records being *created* is logged, which is the part that actually happened.
- **`assigned`/`unassigned` were reserved in v27 and are now live**, with no change to the
  audit renderer — which is the payoff the role-tagging was for. Reassigning a device writes
  `related: "<oldUser>:unassigned,<newUser>:assigned"`, so it lands in both people's history:
  "Phone BCA0003 unassigned" on one, "Phone BCA0003 assigned" on the other.
- `UserField` has two modes (labels vs. names) chosen by whether `userAssets` is passed, so
  neither path knows the other exists. It stays a chip toggle rather than a `PickerField`
  because several people can share one device.
- New Users get ordinary `BCA` labels — there is no per-type prefix scheme, same as Rooms.

**Audit entries name the OTHER assets they concern, in `related` (backend v27).** An entry
is stamped with the asset it happened TO (`assetLabel`), but most also concern somewhere
else: the room something moved out of and the one it moved into, the room a quantity was
allocated to, the rooms a circuit serves. `related` is a comma-joined string of
`label:role` pairs — `"BCR0006:from,BCR0020:to"` — built by **`relate({ from, to, ... })`**
and read by `parseRelated()`/`relatedRoleFor()`.
- **Ids, resolved at render — the audit log was the last holdout.** It stored display
  *names* (`parentNameFor(oldVal)` at write time, `room: roomNameFor(roomId)`), which is the
  one thing "Reference conventions" above forbids everywhere else. So "which entries involve
  Room 101" could only be a string match: ambiguous between two rooms of the same name, and
  stale the moment one was renamed. `from`/`to` still hold names — that is this entry's own
  wording — but the ids are what the rooms are found by.
- **The ROLE, not just the id, and that was the whole design question.** One row has to read
  correctly from every asset it names: the same move is "moved out" from one room and "moved
  in" from the other, and a created-in-a-room-and-assigned-to-someone entry will be "created
  here" from the room and "assigned to Jane" from the person. A bare id list says an entry is
  relevant but not *how*, which is not enough to word it. Roles: `from`/`to` (a move), `at`
  (where it happened — created/archived/deleted), `serves`/`feeds` (a circuit), and
  `assigned`/`unassigned`, **reserved unused for when users become assets**. Reserving them
  costs nothing now; adding them later means rewriting AuditLog, the one table with no
  rewrite path. Encoding the role also *removed* the separate `fromId`/`toId` columns an
  earlier draft had — the role already says which way a reference points, so three new
  columns collapsed to one.
- **`describeAuditFor(entry, viewerLabel, assets, typesList)`** renders an entry as the
  *viewer* sees it and **falls through to `describeAudit()` whenever the viewer IS the
  subject**, so every pre-existing call site is untouched. A subject with no role (reached
  via the contents section below) still gets named — "Serial changed from A to B" is useless
  in a room holding nine devices. The subject is `nameOf()`, and appending its type would say
  "Monitor BCA0002 (Monitor)" since `adoptLegacyNames` already builds names in that shape;
  only a **deleted** asset gets `"<type> <label>"`, since there the stored type is the one
  thing left. That fallback is load-bearing: audit entries deliberately outlive their assets.
- **Lookup goes through `auditIndex`, a `useMemo` keyed on `auditLog`** — two Maps of
  `label -> positions in auditLog`, one for the entry's subject and one for every id in
  its `related`. Not premature: the two lists live in the detail view's **render body**,
  so before this they were re-derived on every render of that view — every keystroke in
  the edit form, whether or not the Audit tab was even open — and each pass walked the
  whole append-only log calling `parseRelated()` on every row. Measured: 100k entries was
  ~26ms per pass on a desktop (~100ms on a phone), versus ~0.2ms from the index. It stores
  **positions, not entries**, because the log's append order IS its chronological order —
  so merging the two maps and sorting the numbers descending reproduces the old
  `.filter().reverse()` ordering without comparing timestamps.
  - **The ceiling is the full-snapshot load, not this lookup, and it always was.** `doGet`
    returns the entire AuditLog every time; at ~208 bytes/entry that is ~2MB at 10k entries
    and ~10MB at 50k. `related` adds ~25 of those bytes. So audit-log pruning (already on
    the deferred list) is what eventually bites, and it bites the payload long before any
    filter gets slow.
- **User names in an assignment entry are links too**, which needed one exception worth
  understanding. The people who actually moved come from `related` by id, like everything
  else. But someone already on the asset who *stays* has no id in that entry, and linking
  only the changed name read as arbitrary rather than as emphasis — so the remaining names
  are matched by NAME. That is safe **here and nowhere else**: this decorates text already
  on screen, it does not resolve a reference. An unmatched name stays plain, and an
  AMBIGUOUS one (two people sharing a name) is deliberately left plain, since there is no
  honest way to pick which page it opens.
- **The named assets are LINKS** (`auditSegments()`): "Computer BCA0001 moved out →
  Room 101" opens either one. Frontend-only — the ids were already in `related`, so this
  needed no backend change and no new version. The pairing is **structural, not a search
  for room-shaped words**: `related` says which id plays which role, and each role has a
  fixed home in the entry's own text (a parent move's `from` text IS its `from` id, an
  allocation's `room` IS its one id). Candidates that don't appear in the sentence simply
  never match, which is what lets the subject's own wording and the viewer-relative
  wording be fed one candidate list without either knowing which it got. Matching is
  longest-first and position-by-position, so "Room 10" can't win a spot "Room 101" starts
  at and a name appearing twice links twice. **Two things are never linked**: a value like
  "Unassigned" or an em dash, which name no asset, and an id whose asset is gone — audit
  entries outlive their assets, so that link would open nothing. `describeAudit()` still
  returns a plain string, which is what the Excel export needs.
- **The Audit tab is two sections**: the asset's own history (its entries plus every entry
  naming it), then **"Activity on contents"**, collapsed, keyed off `descendantsOf()`. No type
  test anywhere — a Building gets its rooms' activity and a Campus its buildings' for free.
  The contents section is a **live** view of current containment, so something that has since
  moved away takes its edit history with it; its *move* stays in the top section forever,
  since that entry names the room by id. The asset's own history is durable; the contents
  section is a snapshot.
- **Backfill**: `backfillAuditIds_()` in the .gs, run ONCE by hand from the Apps Script
  editor after deploying — deliberately unreachable from `doGet`/`doPost` and never on a
  trigger, since it rewrites history. Best effort by design: a name matching nothing leaves
  `related` empty and the entry stays out of the associated views, which beats guessing.
  Ambiguity takes the first match, accepted only because the sheet is sample data.

Every asset carries: `comments` (freeform notes), `changes` (structured: type/vendor/
cost/note — its own managed lists, editable via gear-icon "manage" buttons), and is
covered by a global `auditLog` that automatically records creates/edits/archives/
deletes/allocations (see `logAudit()`, `describeAudit()`) — this is separate from
`changes` and isn't user-authored.

Assets are archived (soft-deleted, `status: "Archived"`) rather than deleted by default;
permanent deletion is a separate, more heavily confirmed action only available on an
already-archived asset.

Every asset (any type) also has a `maintenanceItems` array — scheduled maintenance
entries with `task`, `frequencyLabel`/`frequencyDays` (picked from the fixed
`MAINTENANCE_FREQUENCIES` list, not a managed list, since a day-count is needed to
compute a next-due date), `lastPerformed`, and `owner` (freeform text). `nextMaintenanceDue()`
and `maintenanceStatusOf()` derive a next-due date and a status (`never` / `overdue` /
`due-soon` / `ok`) used to sort the Maintenance tab (most urgent first) and to flag the
tab itself in red when anything's overdue. Adding an item isn't separately audited (its
own `at`/`by` is enough); marking done, editing, or deleting one is, since those mutate
or remove data with no other history trail.
