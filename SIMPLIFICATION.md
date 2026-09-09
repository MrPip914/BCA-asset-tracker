# Bloat and simplification review — 2026-09-09

A one-off audit of the whole repo, ordered by value-per-risk. **This file is a
worklist, not a record** — delete it once the items are done or declined, rather
than leaving it to become another stale plan doc like the seven in section D.

Every line number below was read at commit `538adae`. Nothing here has been
changed; this is the evaluation Eric asked for, not the work.

Baseline: `index.html` 10,479 lines / 624KB · `AssetTrackerSync.gs` 1,842 lines ·
`CLAUDE.md` 1,944 lines / 156KB · 9 planning docs 1,700 lines · 62 tests, all
passing.

---

## A. Verified dead code — deletable with no behaviour change (~215 lines)

Each of these was confirmed by counting references across the whole file, not by
reading a comment that said it was unused.

| What | Where | Lines |
|---|---|---|
| **Swap Breaker, entire feature** | `index.html:2284`, `4100–4125`, `7005–7052` | ~74 |
| **`backfillAuditIds_()`** | `AssetTrackerSync.gs:1458–1592` | 135 |
| `effectiveBuildingId()` | `index.html:1219–1227` | 9 |
| `STATUS_OPTIONS` | `index.html:745` | 1 |
| `hiddenColumns` | `index.html:7136` | 1 |

**Swap Breaker is unreachable, not merely unused.** `openSwapBreaker` has exactly
one occurrence in the file — its own definition. Nothing calls it, so `swapModal`
can never be non-null, so the 48-line modal never renders and `submitSwapBreaker`
(called only from inside that modal) never runs. CLAUDE.md already records that
the trigger button was removed "per explicit request" and calls the remainder dead
code; this just confirms it and prices it. Deleting it also settles the open
question CLAUDE.md poses about what Swap's future role should be — the group-level
instance edit already covers serial/installed-date for a whole unit, so the answer
is likely "none", and it can be recovered from git if it isn't.

**`backfillAuditIds_()` is the one worth doing first**, because it is the only item
here that costs something ongoing: it ships to every tenant on every deploy. It is
a one-shot migration that CLAUDE.md says was run once by hand from the editor after
v27, is deliberately unreachable from `doGet`/`doPost`, and rewrites history if run
again. Removing it needs a `SCRIPT_VERSION` bump and a deploy to every tenant, so
fold it into the next backend change rather than spending a deploy cycle on it
alone.

The last three are pure leftovers. Note `effectiveBuildingId` is described in
CLAUDE.md's "Data model" as live ("does the same for a stable id") — it isn't, and
that sentence should go with it.

## B. Duplication a small component or config table collapses (~180 lines)

This is the largest genuine saving, and the safest kind: every item is the same
code written out N times, where N is 5–50.

1. **Eight confirm dialogs, structurally identical** (`confirmArchive`,
   `confirmCommentDelete`, `confirmChangeDelete`, `confirmAllocationRemove`,
   `confirmMaintenanceDelete`, `confirmDelete`, `confirmDeleteCol`,
   `confirmDeleteTypeId`; three more live in `TypeManagerModal`,
   `ListManagerModal` and `ChildEntityTable`). Five of them sit consecutively at
   `index.html:6595–6682` and differ only in title, body text, button label and
   handler — the overlay div, card div, title style, body style, footer flex,
   Cancel button and `isSaving ? "Saving…" : verb` danger button are byte-identical.
   A `<ConfirmModal title body verb onConfirm onCancel isSaving>` turns each into
   about six lines. **~110 lines saved**, and it makes "confirm dialogs behave
   consistently" structural rather than a thing to remember.

2. **23 hand-rolled modal overlays** (`position: "fixed", inset: 0, background:
   "rgba(42,52,57,0.45)" …`), varying only in `zIndex` (20/30/40/50/60/70) and
   whether padding is set. A `<ModalShell z padded onBackdrop>` removes the
   repetition and gives one place to add focus-trapping or Escape-to-close, neither
   of which any of the 23 has today.

3. **Repeated inline styles**: 24 identical "Cancel" outline buttons, 50 buttons
   sharing `padding: "8px 14px"` with one of three fills, 42 copies of the
   uppercase mono eyebrow label. Three ~5-line presentational components
   (`Btn variant="primary|danger|ghost"`, `Eyebrow`) cover all of it. Inline styles
   total 56KB across 831 sites — this is the repetitive half.

4. **Five managed-list handler pairs** (`index.html:4345–4375`, `4449–4472`).
   `addChangeType`/`addVendor`/`addPeripheral`/`addUser`/`addBulkItemType` are the
   same four lines five times, differing only in which state they read, which
   `persist()` key they write and whether the result is `.sort()`ed; the five
   `remove*` are the same one line five times. One config table plus two generic
   functions replaces ~50 lines with ~15, and removes the class of bug where a fix
   lands on one and not the other four.

5. **Six list-manager UIs, twelve states.** `showPeripheralsManager` /
   `newPeripheralName` and its five siblings are 12 `useState` calls driving five
   `<ListManagerModal>` invocations that differ by a title, a placeholder and two
   handlers (Users adds `readOnly`/`note`/`action`; Types is correctly a different
   component). A single `listManager` state (`{ kind, draft }` or `null`) plus a
   `LIST_MANAGERS` config record collapses the states 12 → 1 and the five render
   blocks → 1. This is the same consolidation CLAUDE.md already argues for under
   "Related state lives in one object", applied to the case that most needs it:
   `AssetTracker` holds **98 `useState` calls**, and these twelve are the clearest
   block of pure parallelism among them.

## C. Load-time: move the sandbox fixture out of the Babel block (60KB)

`MOCK_SNAPSHOT` is `index.html:1645–2184` — **540 lines, 60KB, ~10% of the file**,
and it is *pure data with zero JSX*. It nonetheless sits inside
`<script type="text/babel">`, so Babel Standalone parses and transpiles all 60KB
in every browser on every load, for every user, whether or not they ever touch
Sandbox mode.

Moving it to a plain `mock-data.js` loaded with a `<script src>` alongside
`clients.js` needs no build step and no change to how Sandbox works. Its only
dependency on the surrounding scope is `FRONTEND_SCRIPT_VERSION`, which can move
to the same file or be stamped in at read time.

This is the cheapest available answer to the deopt warning CLAUDE.md records
("`index.html` crossed 500KB with v18, so Babel Standalone now logs a code
generator has deoptimised the styling note on every load"). It does not get the
file under 500KB on its own — 624KB → 564KB — but it is the one 60KB chunk that
provably does not need to be transpiled at all, and it makes the fixture editable
without scrolling past it.

## D. Nine planning docs, seven of them finished (~1,400 lines / 93KB)

| Doc | Lines | State |
|---|---|---|
| `AUDIT_RELATED_RESOURCES_SCOPE.md` | 413 | shipped; header says "**v28 undeployed**" — v28 went live 2026-08-26 |
| `NAME_FIELD_PLAN.md` | 224 | shipped; accurate |
| `BREAKER_TYPES_ARCHITECTURE.md` | 192 | shipped; header says "the live backend still needs a redeploy (v8)" — backend is v30 |
| `PANELS_BREAKERS_ARCHITECTURE.md` | 183 | shipped |
| `PANELS_BREAKERS_IMPLEMENTATION_SPEC.md` | 163 | shipped; a build spec for work finished in August |
| `PARENT_CHILD_ARCHITECTURE.md` | 130 | shipped; opens "Nothing here is built yet" |
| `PARENT_CHILD_MIGRATION.md` | 118 | obsolete — v25 deleted the columns it plans to migrate |
| `MULTI_CLIENT_DEPLOYMENT.md` | 275 | **live** — Phase 1+ still proposed |
| `DOORS_LOCKS_KEYS_NOTES.md` | 48 | **live** — pre-build decision for the next module |

The seven finished ones are not neutral. Their reasoning is already in CLAUDE.md
(that is the documented convention — "update `CLAUDE.md` after implementation"),
so what is left is a second, older copy of the same decisions carrying **stale
status headers that state the opposite of reality**. This is precisely the failure
CLAUDE.md complains about three separate times about itself — a deploy-state line
that nothing prompts anyone to update. Here there are three more of them, in files
nobody has a reason to open.

Recommendation: delete the seven (git history keeps them), keeping
`BREAKER_TYPES_ARCHITECTURE.md` only if the half-slot cell addressing reasoning it
holds is not fully reproduced in CLAUDE.md — it is cited there as the place to read
for that. Keep the two live ones.

## E. `CLAUDE.md` — 187 lines of superseded deploy history

At 1,944 lines / 156KB, CLAUDE.md is loaded into the context of every session
against this repo — roughly 39K tokens, every time, before any work starts. Most of
it earns that: the design rationale is dense, specific, and demonstrably prevents
repeat mistakes.

One block does not. "Known constraints / things to watch" is 308 lines, of which
**187 are per-version deploy entries for v17 through v30** — every one of which now
reads "is DEPLOYED, confirmed". Their sizes: v17 67 lines, v25 33, v29–v18 the rest.
They are a changelog, and the file's own rule is that "what changed in a version
goes in the commit message and in this file, not in the constant" — the changelog
came back anyway, one layer out.

They are also superseded by a command. CLAUDE.md now says, correctly, that
`node deploy.mjs --status` "asks every tenant's live `/exec` and prints a table,
needs no sign-in, and **cannot go stale** — unlike every 'the live backend is vNN'
line ever written into this file, three of which did." Fourteen such lines are
still sitting in it.

Recommendation: replace all 187 lines with a short section saying (a) run
`--status`, never read a version from this file, (b) the two or three facts from
that history that are still *rules* rather than status — the v25 "`ASSET_FIELDS` is
the schema, removing a name deletes the column" warning, the `appendNewRows_`
narrow-header hazard, and the v18 `_dirty`-on-read guard. Keep the 47-line
data-loss incident entry in full; it is the only one that documents an unsolved
problem. **Net: ~140 lines / ~11KB / ~2.8K tokens off every session.**

## F. Structural — real, large, and correctly deferred

`AssetTracker` is `index.html:2186–7786` — **5,600 lines and 98 `useState` calls in
one component.** CLAUDE.md already names this as a known weak point and prescribes
the remedy: extract a tab's content the way `BreakersTabContent` was, whenever that
tab next needs real changes, rather than as a dedicated refactor pass.

That prescription is right and this review does not contradict it. Worth noting
only that section B item 5 is the cheap down payment on it — twelve of the 98
states are one config table away from being one.

Also worth recording, though it is coverage rather than bloat: all 62 tests cover
`AssetTrackerSync.gs` and `sheet.mjs`. Nothing covers `index.html`'s 10,479 lines,
which is why every item in sections A–C above should land in small commits that are
each checked in a browser in Sandbox mode.

---

## Suggested order

1. **A** — delete the dead code. No behaviour change, no deploy needed except for
   `backfillAuditIds_`, which should ride along with the next backend change.
2. **D** and **E** — delete the finished plan docs, cut the version history out of
   CLAUDE.md. No code risk at all, and E pays back on every future session.
3. **C** — move `MOCK_SNAPSHOT` out. One file move, verified by toggling Sandbox on.
4. **B** — the component extractions, one at a time, each checked in Sandbox.
   Items 1 and 4/5 are the highest ratio of lines removed to risk taken.

Sections A–E together remove roughly **2,000 lines** across the repo without
changing a single behaviour.
