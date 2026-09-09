# Asset key refactor — implementation plan

**Status: plan only. Nothing implemented.** Written 2026-09-09 against backend v30
(confirmed live by fetching `/exec` and reading `scriptVersion`).

Supersedes the recommendation in `ASSET_KEY_VS_TAG_EVAL.md`. That doc costed three
options and recommended the cheapest (A — add a `tag` field, leave the key alone) on the
grounds that it delivered the user-visible payoff for a fraction of the work. Eric's
priority is a **foundation for future expansion**, not minimising risk to existing data,
which reverses that call: Option B is the one that fixes the foundation, and A only
defers it. The eval's cost analysis still stands and is the input to this plan.

---

## 1. Why B, restated for the foundation goal

Four arguments, in order of how much they bind.

**The next module already has this problem, on paper.**
`DOORS_LOCKS_KEYS_NOTES.md` commits Doors/Locks/Keys to "label-based references to Assets
(a lock's Door is `doorLabel`)" and to a top-level `LockKeys` join table. A join table is
two foreign keys and nothing else — it is the shape where an unrenameable display-string
key hurts most, because a mistagged door can never be corrected, only archived and
recreated, which breaks every join row pointing at it. Building that module on labels
means building the problem in deeper and then paying to remove it from three places
instead of one. **This plan supersedes that line in those notes.**

**The app already has two identity schemes and only needs one.**
Breakers, Circuits and BreakerTypes use `crypto.randomUUID()`. Assets use labels.
`CLAUDE.md`'s "Reference conventions" has to state both rules separately and explain when
each applies. Collapsing to one scheme removes a rule rather than adding one — which is
the test for whether a refactor is actually foundational.

**Client-side minting removes a coordination constraint that has already cost a design.**
`convertUsersToAssets` had to be a deliberate button rather than a load-time rewrite
*because* issuing labels draws from `nextAssetNumber`, which lives in the Config domain
behind the revision check — so two browsers converting at once would race for the same
numbers. A UUID needs no counter and no coordination, so any future bulk creation
(importing a room list, generating locks for every door, seeding a new tenant) becomes an
ordinary local operation.

**Multi-tenant.** `ASSET_LABEL_PREFIX` is per-client. Today an asset's identity encodes
its tenant, so anything that ever moves or merges assets across sheets has to rewrite
keys. UUIDs are tenant-neutral by construction.

### Why UUID and not a readable non-displayed key

A monotonic readable key (`a0001`) would keep the sheet legible, but it needs a counter,
which reintroduces exactly the coordination constraint above. `crypto.randomUUID()` also
matches what the sub-entities already do. Taking the readability loss knowingly:

- The Assets tab keeps a human-readable column right next to `id` (the tag), so
  eyeballing the sheet still works — you read the tag column, not the key column.
- The reference columns (`parentId`, `personIds`, `roomsServed`) become unreadable. That
  is the real cost. Mitigation is a debugging habit, not code: resolve through the Assets
  tab. Accepted deliberately; see §6.

---

## 2. The mechanism that makes this affordable

**On load, an asset's `id` defaults to its existing `label`:**

```js
.map(a => ({ ...a, id: a.id || a.label }))
```

Same trick `typesList` already uses ("a built-in type's id IS its original name"). Because
every reference stored in the sheet today holds a label, and every existing asset's id
*is* that label, **every reference already in the sheet is already a valid id**. Nothing
needs rewriting. Specifically:

- **AuditLog needs no backfill and no column change, ever.** Its `assetLabel` and
  `related` columns already hold valid ids. This is the single biggest saving — AuditLog
  is written by `appendNewRows_`, never rewritten, and is the one tab where a column
  change means a hand-run history rewrite. We simply don't touch it. (See §6 for why a
  *rename* there would be actively dangerous.)
- **Printed QR stickers keep resolving.** A sticker encodes `?p=BCA0082`, and that panel's
  id is `BCA0082`.
- **Deep links in circulation keep resolving**, same reason.
- **Child tabs need no migration.** Their `assetLabel` values are already ids.

Only assets created *after* the refactor get UUIDs. Ids therefore become heterogeneous —
`BCA0001` for legacy rows, UUIDs for new ones. That is the same trade `typesList` made and
`CLAUDE.md` calls it a feature: it is what buys a zero-migration cutover.

### Deploy order is mandatory: backend first

The adoption is safe in one direction and not the other.

- **Backend ahead of frontend** (v31 live, old `index.html`): the backend writes an empty
  `id` column; the old frontend ignores it. Harmless.
- **Frontend ahead of backend**: a *new* asset gets a UUID `id` and the backend drops the
  column, so on the next load that asset has no `id` and no matching `label` — a broken,
  unreferenceable row. **This is a real data hazard**, unlike the rest of the plan.

So Phase 1 deploys and is confirmed live before Phase 2 ships. This is the normal order
anyway, and `FRONTEND_SCRIPT_VERSION` plus the "Backend outdated" banner already enforce
it, but it is worth stating because this refactor is otherwise unusually forgiving.

---

## 3. Phases

Each phase is independently deployable and independently useful. Stopping after any of
them leaves a coherent app. Phase 0 is setup rather than refactor, and is largely
already done.

### Phase 0 — get live data into the dev tenant (mostly already done)

**The dev tenant exists and the tooling is built.** An earlier draft of this section said
the opposite, at length. It was written from a stale clone and was simply wrong; the work
had already landed on the `dev` branch. What is actually true, verified 2026-09-09:

- `clients.js` **on `main`** defines a second tenant: `dev`, its own Sheet, its own Apps
  Script deployment, `labelPrefix: "DEV"`. `/dev/` falls back to it automatically.
- Both backends report **v30** — checked by fetching each `/exec`, not read off a line
  here. They are in sync with the repo and with each other.
- `deploy.mjs` already takes a tenant: `node deploy.mjs dev`, plus `--all` and `--status`.
  A bare invocation refuses and lists the tenants rather than guessing.
- `new-tenant.mjs` bootstraps a tenant from nothing; `set-tenant.mjs` records its ids.
- The `/deploy` block Eric is handed already names a tenant and points branch testing at
  `dev` rather than at the school's URL (commit `4e3f420`).

So the deploy story is solved, and **`main` and `dev` are now identical** (both at
`4e3f420` as of 2026-09-09) — the tenant, the tooling and the merge all landed on `main`,
so this refactor branches from `main` like any other work. An earlier draft asked which
branch to build on; that question is closed.

One thing remains.

**Get live BCA data into the dev Sheet.** Still a manual step, and still Eric's — a
Claude Code cloud session cannot do it or read the live Sheet, because `/exec` has needed a
signed-in session since v18 and credential handling is blocked there (the same reason
`clasp login` cannot run there).

- **Google Sheets → File → Make a copy**, then point the `dev` entry's `apiUrl` at the
  copy's own deployment. Copies the data and the bound script in one action, from a phone,
  with `authUsers` carried along so access is preserved. If instead the existing dev Sheet
  is kept and the data imported, **BCA Admin > Import inventory** reads a tab — but a copy
  is exact and an import is a reconstruction.
- **A live copy, deliberately, not the `MOCK_SNAPSHOT` seed** that
  `MULTI_CLIENT_DEPLOYMENT.md` suggests for general dev work. What this refactor has to
  validate is the *un-migrated → migrated transition*, and only real data carries the real
  edge cases: four panels with sub-panel feeds, the `BCR`/`BCB`/`BCC` labels the counter
  never issued, ~130 assets, and the full audit history.
- **Re-copy before each rehearsal, not once.** Migrating dev leaves it migrated while live
  is still un-migrated — that validates the end state, not the transition, which is the
  risky half.

**One fidelity trap in the copy.** The dev tenant's `labelPrefix` is `"DEV"`, and
`ASSET_LABEL_RE` is built from the prefix — so against copied `BCA…` data,
`assetNumberFromLabel()` returns 0 for every row and `peekAssetNumber()`'s derived
`max + 1` safety net never fires. It still works (the copied Config carries
`nextAssetNumber`), but dev then stops being representative of live for exactly the
counter behaviour Phase 3 rewrites. **Set the dev entry's `labelPrefix` to `"BCA"` while
validating with copied Brookside data**, and put it back afterwards. One line, and without
it the tag-issuance testing is measuring a different code path than the one that will run.

### Phase 1 — backend v31: add the `id` column (additive, safe) — **BUILT 2026-09-09, not yet deployed**

Landed as described below, plus five sites in the public `?panel=` path and
`backfillAuditIds_` that the plan had not enumerated — all found by auditing for a
bare `a.label` join after the named edits were made, not by the plan. Covered by
`test-backend-assetid.js`, which slices both join blocks out of the .gs and
round-trips fake data through them; verified by mutation that reverting either side
to the label alone fails.

`AssetTrackerSync.gs` only. No frontend change, no behaviour change.

1. Add `"id"` to `ASSET_FIELDS`, first position, ahead of `"label"`.
2. `doGet` (~line 1017): `const label = a.label;` → `const key = a.id || a.label;` and use
   `key` in the six child-row filters and the two `panelLabel:` projections below it. This
   one line is the entire read-side join.
3. `doPost` (~line 1281): inside `assets.forEach(a => {`, add
   `const key = a.id || a.label;` and replace every `a.label` in that callback (comments,
   changes, allocations, maintenance, `panelLabel` on breakers, `panelLabel` on both
   circuit branches). Six sites, one block.
4. `customColumnKeys_`: no change — `id` is in `ASSET_FIELDS`, so it can't be shadowed by
   a custom column, which is already what that guard does.
5. Admin import (`menuImportInventory` / `adminParseInventory_`): accept an optional `id`
   column; when absent leave it blank and let adoption fill it. Keep the existing
   duplicate-`label` check for now — it is still meaningful while labels are keys.
6. Bump `SCRIPT_VERSION` to `"v31"` and `FRONTEND_SCRIPT_VERSION` in the same commit.
7. Extend `test-backend-fields.js` to cover the `a.id || a.label` join both ways (a row
   with an id, a row without). This is the only place it *can* be covered — Sandbox never
   contacts Apps Script.
8. Deploy, and confirm by fetching `/exec` and reading `scriptVersion`.

After this the sheet has an `id` column that is empty for every row, and everything
behaves exactly as before.

### Phase 2 — frontend: switch internal identity to `id` — **BUILT 2026-09-09, not merged**

Landed as described below. Two things the plan did not anticipate:

- **New assets get a generated id in this phase, not phase 3.** Keeping `id = label`
  for new assets would have made phase 2 a pure rename that proved nothing — the whole
  point is to show the app works when the two differ, and `MOCK_SNAPSHOT` plus the dev
  tenant are where that gets exercised. `startAdd`, `duplicateAsset` and
  `convertUsersToAssets` all mint one.
- **Renaming the stale parameters found a real bug.** `childLabel` → `childId` exposed
  `childId={selectedAsset.label}` on the edit form — a label being passed where an id
  was expected, which would have made the parent picker's self/descendant exclusion
  silently wrong for any asset whose id is not its label. Nothing else caught it: it
  type-checks, it renders, and on the legacy rows it is correct. `doDelete`,
  `archiveAsset`, `restoreAsset` and `seg.label` were renamed for the same reason.

Covered by `test-frontend-assetid.js`, which runs the real chain helpers sliced out of
`index.html` over the real fixture; verified by mutation that a half-converted
comparison (a stored reference against a label) fails it.

The big mechanical phase. `label` is still displayed as "Asset ID" everywhere and is still
required; only what the app *joins on* changes.

**Adoption.** In `loadData()`'s map chain (~line 2657), prepend the id map **before** the
`personIds` normalize and before `adoptLegacyNames(parented)`. Order matters for the same
reason `applyTypeSettings()` runs before the map: the name backfill walks the parent chain,
and it must walk it by the ids it will actually be joined on.

**Rename the state.** `selectedLabel` → `selectedId` (34 sites). `openDetail(asset)` sets
`asset.id`. `scopeId` and `bulkMoveSourceId` already read as ids and keep their names.

**Switch the lookups.** Every `a.label === X` → `a.id === X`. From the eval's counts:
`a.label` 88, `asset.label` 15, plus `selectedAsset.label`, `original.label`, `x.label`,
`p.label`, `u.label`, `cur.label`. Not all are keys — `c.label` is a circuit's display
name, `f.label` a field label — so this is a read-every-site pass, not a sed.

**Reference fields keep their names, change their contents.** `parentId`, `personIds`,
`roomsServedIds`, `allocations[].roomId` already read as ids. `panelLabel` and
`feedsPanelLabel` become misnomers — leave them, comment them, rename in Phase 4.

**Audit.** Entry stamps (`assetLabel: selectedId`, 44 sites) now carry ids; the column name
stays. `relate()` receives ids. `auditIndex`'s two Maps key on ids. `describeAuditFor` and
`auditSegments` take a viewer *id*. `parseRelated` needs no change — it splits on the last
`:` and a UUID contains none. Likewise the comma joins for `personIds` and `roomsServed`.

**Chain and tree helpers.** `ancestorsOf`, `descendantsOf`, `wouldCreateCycle`,
`effectiveBuildingId`, `pathOf`, `parentageProblem`, `canDeleteAsset`'s reference scan,
`HierarchyBrowserModal`'s `excluded`/`parentKeyOf`, `HierarchyNav` — all mechanical.
`ancestorsOf`'s visited set seeds on the id instead of the label; the loop-safety property
is unchanged.

**Addresses resolve by id OR label**, permanently:
- `?asset=` deep link: `assets.find(a => a.id === v || a.label === v)`. Emit `id`.
- `?panel=` / `panel.html?p=`: same, backend and page. Stickers keep encoding the **tag** —
  a UUID under a QR code is unreadable to someone standing at a panel door, and the
  sticker is the one artifact that can never be redeployed.

**`panel.html`** has its own local-sandbox projection walking `parentId`, `byLabel[a.label]`
and `roomNameById[a.label]` — same treatment. `panel-qr-sheet.html` keeps using the tag.

**`MOCK_SNAPSHOT`.** Give every asset an explicit `id`. Deliberately **mixed**: most equal
to their label (the legacy shape), and a handful of genuine UUIDs with the tag still
present (the new shape). `CLAUDE.md` records why this matters — the `personIds` data-loss
bug was invisible in Sandbox precisely because the fixture's *shape* differed from the
backend's real response. A fixture that is all-legacy would hide every bug in the new path.

**`exportToExcel`** keeps "Asset ID" showing `label`. Do not add the UUID.

Bump `APP_VERSION`. No backend version change.

### Phase 3 — backend v32 + frontend: `label` becomes `tag`

Now the user-visible payoff. This is where the original request actually lands.

1. Backend: add `"tag"` to `ASSET_FIELDS`, **keep `"label"`**, and write both (`label`
   mirrors `tag`) so the change stays reversible — the v23/v24 playbook.
2. Frontend: `adoptLegacyTag()` in the load map — `tag = a.tag ?? a.label`.
3. **Make the tag configurable per type** (decision 2): drop `label` from
   `TYPE_STRUCTURAL_FIELDS` so the type editor can exclude it, and ship `tag` in
   `excludedFields` for Room, Building, Campus and User.
4. **`adoptLegacyTag()` declines to adopt a label as a tag for a type whose tag field is
   excluded** (decision 3), which is what clears the BCR/BCB/BCC and User labels without a
   separate migration.
5. **Fix `nameOf()`.** It currently falls back to `asset.label`; once the tag is optional,
   an unnamed untagged asset renders as an empty string in the list, the detail header,
   `parentNameFor()` and every audit sentence. Settled (decision 1, §7): a third rung of
   `nameOf()` — name, then tag, then `"<type> <short id>"`.
6. Drop `label`'s exclusion from `editFormColumns` (`index.html:5726`) — retagging becomes
   an ordinary field edit, which is the entire point.
7. Tag issuance becomes explicit: an "Issue tag" action drawing from the existing counter.
   Rename `peekAssetNumber`/`advanceAssetNumber`/`assetLabelForNumber`/`ASSET_LABEL_RE`
   into tag vocabulary. `peekAssetNumber`'s `Math.max(counter, derived)` guard can be
   **deleted** — it exists because a reused label inherits a dead asset's audit history,
   and with a real key that is no longer possible.
8. `findLabelConflict` → `findTagConflict`, **still blocking** (decision 4), but skipping
   empty tags — an unconditional check would make every untagged asset collide.
9. Detail header, `label` column, export and sticker all read `tag`.

### Phase 4 — backend v33, destructive, DEFERRED INDEFINITELY (2026-09-09)

**Eric's plan is to build phases 1–3 in dev and ship them to production as ONE push**,
avoiding incremental production updates. That is fine for 1–3, which are additive, and it is
the reason phase 4 is now explicitly held back rather than merely "optional".

**Batching phase 4 with them would be destructive, and the window is one ordinary save
wide.** A version mismatch only shows a *banner* — it does not refuse writes — and
`writeTable_` clears the tab and writes only the columns it is handed, filling `""` for any
field the client did not send. So in the gap between deploying a label-dropping backend to a
school and the frontend merge reaching every browser, one save from a stale tab writes `id`
blank, `tag` blank, and no `label` at all: every asset loses its identity, and every child
row keys to the same empty string. Version history is the only way back.

That cannot happen on phases 1–3, because `label` stays in `ASSET_FIELDS` and a stale tab's
save is harmless — which is exactly what `CLAUDE.md` means by "an old frontend against a new
backend is harmless". **Phase 4 is the exception to that rule.** It buys only tidiness:
dropping a column that is still correct, and renaming some misnamed ones. Do it later as its
own deliberate exercise, once production has run v32 long enough that every row carries a
populated tag — or never.

### Phase 4 — backend v33, destructive, later and optional

Only once Phase 3 has been live long enough that every row has been rewritten.

- Drop `"label"` from `ASSET_FIELDS`. Destructive, same class as v25 — confirm `tag` is
  populated on every row first, and the sheet's version history is the only way back.
- Optionally rename the child tabs' `assetLabel` → `assetId` (Comments, Changes,
  Allocations, Maintenance) and `panelLabel`/`feedsPanelLabel` → `panelId`/`feedsPanelId`.
  These tabs are rewritten wholesale by `writeTable_`, so a rename is one save away — **but
  it needs a read-side fallback** (`r.assetId || r.assetLabel`) for the window between the
  deploy and that first save, or every comment, change, allocation and maintenance item
  reads back undefined and is written out empty. This is pure cosmetics over correct data;
  do it only if the naming genuinely bothers you.
- **Never rename AuditLog's columns.** See §6.

---

## 4. What gets deleted

Worth tracking, because a foundation refactor that only adds is a bad sign:

- `peekAssetNumber()`'s `Math.max(counter, derived)` reuse guard (Phase 3).
- `findLabelConflict()`'s save-blocking behaviour (Phase 3).
- The `label`-excluded-from-`editFormColumns` special case (Phase 3).
- `CLAUDE.md`'s "Labels are never renamed" convention and the paragraph explaining why
  `label` is add-form-only — both become obsolete.
- One of the app's two identity schemes.

---

## 5. Test plan

Sandbox never contacts Apps Script and the live backend needs a sign-in, so the write
paths are structurally unreachable from a browser. Split accordingly.

**Node (`test-backend-fields.js`)** — the only place these can be covered:
- `doGet` join with `id` present, absent, and mixed across rows.
- `doPost` child-row keying for an asset with a UUID id and one without.
- `customColumnKeys_` still refuses to shadow the new `id` field.

**Sandbox (browser)** — with the mixed fixture from Phase 2:
- Open a legacy asset and a UUID asset; check path, contents, audit, breakers.
- Move a UUID asset under a legacy parent and vice versa.
- Assign a UUID User to a legacy device.
- A circuit on a legacy panel serving a UUID room.
- Delete guards: `canDeleteAsset` on a UUID room that still holds things.
- Deep link to a UUID asset and to a legacy one by label.

**Live, after each deploy:** fetch `/exec`, read `scriptVersion`, and confirm one save
round-trips before trusting anything else.

---

## 6. Hazards

**AuditLog renames are silently destructive.** `appendNewRows_` rewrites the header row
only when the new header list is *wider* than the stored one. A same-width rename
therefore leaves the old header in place, new rows get written positionally under it, and
`readTable_` — which keys off the sheet's own header row — hands them back under the old
name. Code reading the new name gets `undefined`, nothing throws, and `SCRIPT_VERSION`
still matches its frontend because the script really is the version it claims. This is the
v25 bug, met from a new angle. **The plan's answer is to never touch that tab**, which the
adoption mechanism makes free.

**Deploy order.** §2. Backend first, confirmed live, before the frontend ships.

**The fixture must be mixed, not converted.** §3 Phase 2. An all-legacy fixture exercises
none of the new path.

**Sheet readability drops.** Accepted (§1), but it degrades two things this project
genuinely relies on: restoring from the Sheet's version history (the 2026-08-21 recovery)
and reading the import tab by eye. Neither breaks — the tag column stays adjacent — but
resolving a `parentId` by eye stops being possible. If that turns out to matter more than
expected, the fallback is Phase 3-only (tags without UUID keys), i.e. the eval's Option A.

**Phase 2 is a large diff with no user-visible change**, which is the hardest kind to
review and the easiest kind to half-finish. It should land as one commit, not spread
across sessions, and Sandbox testing after it is not optional — three of this project's
worst bugs (`personIds` wiping assignments, `usersAreAssets` rendering unassigned, the
`roomMovable` self-move) were all found in the browser and none by reading the diff.

---

## 7. Decisions — settled 2026-09-09

Eric's answers, with what each one costs to build and the consequences worth knowing.

**1. An unnamed, untagged asset displays as `"<type> <short id>"`** — "Computer 3f2a91c4".
Chosen because it matches the fallback `describeAuditFor` already uses for a deleted asset,
so the app gains no new convention. `nameOf()` gets a third rung: name, then tag, then this.
In practice it will rarely show — `adoptLegacyNames` suggests a name for almost everything —
but it is what stops a blank rendering anywhere.

**2. The tag field is CONFIGURABLE PER TYPE, defaulting OFF for Room, Building, Campus and
User.** Not a fixed rule either way: the type editor decides, like every other field.
- **The engine already exists and this is one line.** The editor turns an unticked field into
  `excludedFields` today. What blocks `label` from appearing there is
  `TYPE_STRUCTURAL_FIELDS = new Set(["name","type","parent","label","status"])`, which holds
  it out of the editor's list — and `label` is in that set precisely *because* it was the
  primary key. Once it is only a tag it stops being structural, so taking it out is the
  correct change rather than a workaround. The four types get `tag` in their registry
  `excludedFields` as the shipped default; anyone can tick it back on.

**3. Existing BCR / BCB / BCC and User labels are CLEARED, not carried over as tags.**
- **Done in `adoptLegacyTag()` rather than as a separate data migration.** The adoption
  simply does not take a label as a tag for a type whose tag field is excluded, so the clear
  happens on the first save with nothing to run by hand. A load-time *rewrite* is what
  `CLAUDE.md` warns against; this is a load-time *read* that declines to adopt, which is the
  same shape as every other `adoptLegacy*` and carries no race.
- **`label` still holds the old value until phase 4**, so this stays reversible: turn the tag
  field back on for Rooms and re-adopt. After phase 4 drops the column it is gone for good —
  one more reason phase 4 waits.
- Rooms and Buildings are named, so nothing renders blank as a result; decision 1 covers the
  case where something somehow is not.

**4. A duplicate tag is BLOCKED at save, as today.** `findLabelConflict` keeps its behaviour,
renamed to `findTagConflict`.
- **It must skip empty tags.** With the tag optional, an unconditional uniqueness check makes
  every untagged asset collide with every other one. Only non-empty tags are compared.
- **The consequence Eric accepted:** swapping two assets' tags is now a three-step edit —
  clear one, set the other, set the first — because the intermediate state is a duplicate.
  Worth knowing before the first time someone tries it, not worth designing around.
- `peekAssetNumber()`'s `Math.max(counter, derived)` reuse guard can still be deleted: it
  exists because a reused *label* inherited a dead asset's audit history, which a real key
  makes impossible regardless of what the tag says.

### Still open

Nothing blocking. One question deferred until the tag exists and can be looked at:

- **Whether one tag counter still serves every type.** Today there is one and only `BCA`
  numbers are generated. With places and people no longer consuming numbers, the sequence
  gets denser and the question of per-prefix counters mostly answers itself — but it is worth
  a look once real usage exists rather than a guess now.
