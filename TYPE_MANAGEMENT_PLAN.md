# Type management: categories, required fields, field data types — plan

Status: **all three BUILT, 2026-09-09.** Phases 1 and 2 (field data types, required
fields) are frontend-only and need no deploy. Phase 3 (categories) is backend **v33** and is
PENDING A DEPLOY — check with `node deploy.mjs --status`, never with this line.

Originally: Written from Eric's three asks; the three
open questions at the bottom were put to him and answered, and this document has been
updated to match rather than left describing the version he did not pick.

**Eric's decisions, 2026-09-09:**

1. **Required is enforced on every save — add AND edit.** A rule you can dodge by
   editing something else is not a rule, and this is the only way a new requirement
   ever reaches the assets already on the sheet.
2. **Categories get their own Config key**, orderable and renameable, at the cost of a
   backend version bump and a deploy to every tenant. This is the answer that changes
   the plan most: categories moves from first to **last** in the sequence, so the other
   two ship without waiting on a deploy and the whole project costs exactly one.
3. **"Parent is required" stays out of scope.** Unassigned is a real state and requiring
   a parent needs its own answer for it.

Three changes to how asset types are managed, in one document because they land in
the same two places (the type editor and the column record) and because two of them
share a UI that only makes sense built once.

1. **Categories** — a type belongs to a category, and every list of types groups by it.
2. **Required fields** — a field can be marked required, and a save is refused until
   it is filled in.
3. **Field data types** — a field declares what kind of value it holds, and the form
   only lets you enter that kind.

## Two of the three need no Apps Script deploy

This section originally read "none of this needs a deploy", and that was true of the
plan as first written. Eric's choice of a real Config key for categories spends that
for one of the three, deliberately and with the cost known. It stays true of the other
two, and the reasoning is worth keeping because it is what makes them cheap:

- `AssetTrackerSync.gs` writes the Config tab's `columns` and `typeSettings` and
  `typesList` rows as **whole JSON blobs** (`JSON.stringify(body.columns || [])`), so
  any new property on a column object or a type-settings object round-trips untouched.
- The one place the backend looks *inside* a column object is `customColumnKeys_`,
  which reads `c.custom` and `c.key` and ignores everything else.
- Nothing here adds a Config **key**, an `ASSET_FIELDS` entry, or an Assets column.

So **data types and required fields** move no version, need no tenant deployed, and
ship with the frontend from `main`. **Categories does not**, because a new Config
*key* is the one thing `doPost` cannot absorb: it writes a fixed list of keys and
silently drops the rest, so until the deploy lands a category would work in-session and
be forgotten on reload — the same window the pre-v24 `typeSettings` work sat in.

That asymmetry is the whole reason for the sequence below. Keep any *future* per-field
or per-type setting out of a new key unless it needs what categories needed.

`bumpAppVersion`: `APP_VERSION` should move for each phase, since these are exactly the
changes where "did my browser get the new build?" gets asked.

---

## 1. Categories

### Where a category lives

**DECIDED: categories are their own Config key.** `typeCategories` holds
`[{ id, name }]` with array order as display order, and `typeSettings[typeId].categoryId`
points at one. Backend **v33**.

That buys three things the cheap version could not: categories you can **order by hand**
(rather than inheriting type order), an **empty category** you can create and fill later,
and a **rename that touches one row** instead of every type in the category.

`categoryId` holds an id, not a name, which puts categories back under the app's ordinary
reference convention — see "Reference conventions" in CLAUDE.md. Two consequences follow
from that and are both deliberate:

- **A dangling `categoryId` is not an error, it is Uncategorized.** Deleting a category
  does not rewrite the types that named it; they simply fall back, the same permissive-
  storage stance `parentageProblem` and `removeType` already take. So category deletion
  needs no in-use block, only a confirmation naming how many types will become
  uncategorized.
- **Renaming a category is a one-row edit** with nothing to keep in sync, which is the
  entire point of storing the id.

### The version this replaced, kept for the reasoning

The original recommendation was a plain name string on `typeSettings[typeId].category`,
with the category list derived from the types naming one. It needed no deploy and it
broke the "store an id, never a display name" rule — safely, because a category has
exactly one holder (one JSON blob rewritten in full and atomically on every config save)
rather than the scattered, independently-written holders that rule exists for.

It is written down because the argument is reusable: **the store-an-id rule is about
holders in more than one place written at more than one time**, not about names being
inherently unsafe. What sank it here was not correctness but capability — no explicit
ordering, and no way to create a category before there is a type to put in it.

The set of categories is *derived* from the types that name one, in the order those
types appear in `typesList` (first appearance wins). "Uncategorized" is the absence of
the key, not a value.

This breaks the app's own "store an id, never a display name" rule, and it is worth
being explicit about why that rule does not apply here rather than pretending it does:

- The rule exists because a rename cascade has to reach every holder of the name, and
  the holders live in different places that are written at different times — an asset
  row, an audit entry that outlives the asset, a circuit nested inside a panel. That is
  what made the Room rename cascade unmaintainable and what `parentId` fixed.
- A category has exactly one kind of holder, `typeSettings`, which is **one JSON blob
  written in full on every config save**. Renaming a category rewrites the N entries
  that name it inside that one blob, in one `persist()`, atomically. There is no second
  writer, no partial state, and no dangling reference possible — a category *is* its
  name.
- The number of holders is bounded by the number of types (~15), not by the inventory.

Two consequences to accept up front:

- **A category with no types in it cannot exist.** You do not create a category and
  then fill it; you type a category name on a type, and that is what creates it. The
  editor's Category control is therefore a combobox — pick an existing name, or type a
  new one — not a managed list behind a gear icon. This is a feature, not a limitation:
  it removes the empty-category state entirely.
- **Category display order is `typesList` order**, i.e. the order categories first
  appear. There is no drag-to-reorder for categories. If that turns out to matter,
  see the alternative below.

### Where categories show up

- **`TypeManagerModal`'s list** (index.html ~8840). Rows group under a category
  heading; uncategorized types fall under a trailing "Uncategorized" heading, never a
  leading one — a type without a category should not be the first thing you see.
- **The Type picker** (`TypeField` → `SelectionModal`, ~7982 / ~9008). `SelectionModal`
  is the app's one single-select picker and is used by Frequency, Vendor, Breaker Type
  and `ChildEntityTable`'s generic `select` fields — so it gets an **optional**
  `groupForOption` prop and renders flat, exactly as today, when nothing passes it.
  Do not fork it; a second picker is how the app ends up with the native-`<select>`
  problem again from the other direction.
- **The type editor's own "Can sit inside" chip row**, which lists every type and is
  already the longest thing in that modal. Group it the same way.
- **The Assets list's Type column filter** (`ColumnFilterModal`, ~9133). Same
  `groupForOption` mechanism, one line at the call site.

Deliberately **not** in scope: filtering the asset list *by category* (a category is a
grouping of types, not a field on an asset — it would need its own filter config and a
decision about how it interacts with the Type filter), and per-category icons or
colours.

### Work

Backend (**v33**, deployed to every tenant before the frontend merges):

- `doGet` returns `typeCategories` alongside the other config blobs.
- `doPost` adds one `configRows.push({ key: "typeCategories", ... })` line to the
  fixed key list. Nothing else — no `ASSET_FIELDS` entry, no new tab, no migration.
- `SCRIPT_VERSION` → `"v33"`, and `FRONTEND_SCRIPT_VERSION` in the same commit.

Frontend:

- Ship built-in categories in `TYPE_REGISTRY` (Places: Room/Building/Campus; People:
  User; Equipment: the rest) so the grouping is useful before anyone edits anything.
  A built-in category's id is its own name, the same trick `typesList` and the asset
  key refactor both used: it needs no migration and no seeding step, and a stored
  `typeCategories` that predates a new built-in still resolves it.
- `categoryOf(typeId)` / `groupTypesByCategory(types)` — used by the manager and both
  pickers, with dangling and absent ids both landing in a trailing "Uncategorized".
- `TypeManagerModal`: a Category picker in the edit form, grouped rows in the list, and
  a small category manager (add / rename / reorder / delete-with-count) reached from
  the same modal.
- `saveTypeSettings` writes `categoryId`; a new `saveTypeCategories` writes the list.
  Both are the config domain, so a category edit is one `persist()` like every other.
- `SelectionModal` + `ColumnFilterModal`: optional `groupForOption`, flat when absent.

**Release order is backend first**, for the reason the phase-2 key refactor documented:
the frontend ships from `main` to every tenant at once while backends deploy one at a
time, so merging first would put a category-writing frontend in front of a backend that
drops the key. `node deploy.mjs --status` is the gate, not a line in a file.

---

## 2. Required fields

### Where "required" lives

**Recommendation: per-type, as `typeSettings[typeId].requiredFields: ["serial"]`.**

Eric's phrasing — "if the field is present on the asset type, users are required to
fill the field in" — is ambiguous between a flag on the field and a flag on the
field-for-this-type, and the per-type reading is both the more expressive one and the
one that matches the existing model. A Serial is genuinely required on a Computer and
meaningless on a Stream Deck; the type editor already owns exactly this kind of
per-type field decision (`onlyFields` / `excludedFields` live there), and a required
list beside them needs no new storage and no new mental model.

Note this is the *opposite* call from `restricted`, which is a flag on the **column**
— and the reason is worth keeping straight, because the two look similar and are not.
Restriction had to be a column flag because deriving it from "who currently claims it"
meant unticking a field from its last owner would turn it into a common field and
splash it across every type (see `SHIPPED_RESTRICTED_FIELDS`). Required is not derived
from anything: unticking it from a type just means that type does not require it, which
is the correct and obvious outcome.

**Pruning:** `saveTypeSettings` must drop from `requiredFields` any key the same save
un-ticked from the type's fields. A field the type does not have cannot be required,
and leaving a stale entry there would make it spring back if the field were ever
re-ticked.

### What "filled in" means

Non-empty after `trim()` for a string field; a non-empty array for `personIds` and for
any multiselect; a non-empty id for `parentId`. Zero is a filled-in number and `"0"`
must pass — the check is on emptiness, never truthiness.

### Where it is enforced

**At the form, in `saveDraft`, and nowhere else.** Not in `persist()`, not in the
backend. That is the same posture as every other guard in this app (`canDeleteAsset`,
`validateCircuitDraft`, the role checks in the UI) and the same honesty about it: a
required field is a data-quality nudge, not an invariant. Three consequences, all of
which should be stated to users rather than discovered:

- **Existing assets can violate a new rule**, and will, the moment anyone marks a field
  required. Nothing rewrites them.
- **Bulk paths bypass it entirely** — `duplicateAsset`, `convertUsersToAssets`, the
  toolbar's bulk reassign and move-to-room, and the Sheet's own admin import. None of
  these go through the add/edit form and none should start refusing.
- **Editing an old asset to fix a typo will refuse to save until the required field is
  filled.** DECIDED (Eric, 2026-09-09): **nag on every edit.** It is the only way a rule
  reaches data that predates it, and a rule you can dodge by editing something else is
  not a rule. The cost is real and the mitigation is entirely in the wording: the error
  names the fields and the type, so it reads as "a Computer needs a Serial" rather than
  as a Save button that stopped working.

### The form-error channel needs renaming first

`draft.parentError` is already the general form-level error channel: it carries the
parent validation message, and since v32 the duplicate-tag message too. Adding required
and data-type errors to it makes a name that says "parent" carry four unrelated things.

CLAUDE.md's own rule from the phase-2 refactor applies exactly: *"A name that no longer
says what the value is has cost this project real time more than once; treat one as a
bug, not a tidy-up."* So **rename `draft.parentError` → `draft.formError`** as the first
commit of this phase, keeping `ParentField`'s `error` prop fed only when the error is
actually about the parent. It is a mechanical rename across ~8 sites and it is much
cheaper now than after two more error kinds move in.

The add form has a second channel, `addError` (a `useState`, not on the draft). Leave
the split alone — the add form is not editing an existing asset and has no draft to
hang state off — but make both render the same component so a required-field error
looks identical in both forms.

### UI

- **Type editor**: the Fields chip row cannot carry two more per-field settings. It
  becomes a **list, one row per field**: the on/off toggle (what the chip does today),
  a Required checkbox, and the data-type control from phase 1. Off fields render dimmed
  with their extra controls disabled, so the row list is stable as you tick things.
  - One wrinkle to surface in that UI: **Required is per-type, Data type is per-column**
    — the same row carries one setting that affects this type only and one that affects
    every type using the field. A single line of helper text under the data-type control
    ("Applies wherever this field is used") is enough, and is needed: silently changing
    another type's form from inside this one's editor is exactly the kind of surprise
    this app has paid for before.
- **Asset forms**: a required field's label gets a `*`. On a refused save, the offending
  fields get a red border and the form-level line names them ("Serial and Purchase Date
  are required for a Computer."). `Field` gains an `error` prop; `ParentField`,
  `UserField`, `PeripheralsField` and `BulkTypeField` need the same, which is a good
  reason the `Field` rework lands in phase 1 (see Sequencing).
- **Detail view**: nothing. A missing required value on an existing asset is not an
  error state to decorate the whole app with; it surfaces when someone edits.

### Deliberately out of scope

`TYPE_STRUCTURAL_FIELDS` (`name`, `type`, `parent`, `status`) is what the type editor
does not offer, so **"Parent is required" is not buildable in this phase** — which is a
shame, because "every Computer must be in a Room" is probably the most valuable single
rule anyone would write. It is a small follow-on (allow `parent` into the required list
without allowing it into the on/off list) and should be its own change with its own
thought about what it means for Unassigned, which is a real and deliberate state.

---

## 3. Field data types

### Where the data type lives

**Recommendation: on the column record — `{ key, label, dataType: "date" }` — resolved
at read time against a shipped default, never written into a stored config on load.**

Per-column rather than per-type, because a column is one field across the whole sheet
and the whole Assets tab: the same key holding a date on Computers and a number on TVs
would make sorting, filtering, the Excel export and the sheet's own cell contents
incoherent, for no gain anybody asked for.

Resolved at read time, because a stored column config on an existing sheet has no
`dataType` and the load-time column migration only ever *adds* new columns — it does not
update the properties of ones already stored. So:

```
const DEFAULT_COLUMN_DATA_TYPES = { purchaseDate: "date", warrantyUntil: "date",
                                    totalQuantity: "number", notes: "textarea", ... };
function columnDataType(c) {
  return c.dataType || DEFAULT_COLUMN_DATA_TYPES[c.key] || "text";
}
```

Same shape as `typeEntryFor` merging over `TYPE_REGISTRY`: nothing to migrate, a
shipped default can change in a later release and take effect everywhere it has not
been overridden, and "reset to default" is deleting the key.

### The vocabulary

Reuse `ChildEntityTable`'s existing field-type names exactly — `text`, `textarea`,
`number`, `date`, `select` — so the app has one vocabulary for "what kind of field is
this" rather than two that nearly match. `multiselect` is deliberately excluded: the
three multi-valued fields in the app (`person`, `peripherals`, and a circuit's rooms)
each have a bespoke component with its own management gear, and a generic multiselect
column would be a fourth thing that looks like them and is not.

`select` needs its options: `{ dataType: "select", options: ["Good", "Fair", "Poor"] }`
on the column. A per-column array, not a new managed list — the managed lists
(`vendors`, `peripheralsList`, `bulkItemTypes`) each have their own Config key and their
own manager modal, and a school inventing a three-value dropdown should not cost either.
Worth noting for later that a `select` column could grow an option to point *at* a
managed list instead; do not build that now.

### What this fixes on the way past

`purchaseDate` and `warrantyUntil` render as **plain text inputs today** — the asset
form's only data-type awareness is a hardcoded `type={c.key === "totalQuantity" ?
"number" : undefined}` at two call sites. So this phase is not purely additive: it
replaces that special case with the general mechanism and gives the two date fields
real date pickers, which is a visible improvement independent of anyone configuring
anything.

### Behaviour per data type

- **Input**: `Field` takes `dataType` and renders `<input type="date">`,
  `<input type="number">`, a `<textarea>`, or a `PickerField`. Date values run through
  the existing `dateOnly()` on the way in — a value that round-tripped through the Sheet
  before the plain-text fix can still be a full ISO timestamp, and `<input type="date">`
  refuses to show one.
- **Validation on save**: the browser enforces most of this while typing, but a value
  that predates the rule (or arrived by import) can violate it, so `saveDraft` validates
  and reports through the same channel as required-field errors. A number must parse; a
  date must be `yyyy-MM-dd`; a select value must be in `options` **or blank**.
- **Changing a column's data type when data already exists must NOT coerce stored
  values.** Converting every asset's value would be a full rewrite of the Assets domain
  triggered by a settings change, and an unparseable value would have nowhere to go but
  the bin. Existing values display as-is and are flagged the next time someone edits
  that asset. Say this in the editor, next to the control.
- **Sorting** (`sortValue`, ~3199): today it sniffs with `parseFloat` and falls back to
  a locale compare. With a declared type it can sort numbers numerically, dates
  lexically (ISO sorts correctly), and text by locale. Low risk, do it in the same
  change — the sniff is what makes `"24\""` and `"8a"` sort oddly today.
- **Export** (`exportToExcel`): could emit real numbers and dates rather than strings,
  so a spreadsheet can sum and sort them. Genuinely useful, entirely optional, and
  separable — leave it out of the first cut and note it.
- **List cells and the detail view**: no formatting change. A date already displays as
  `yyyy-MM-dd` and that is what the school reads.

### Where the control lives

The per-field row in the type editor (shared with the required checkbox), **and** the
Columns menu,
which is where a custom column is created (`addColumn`, ~4474) and deleted. A column
created there should be able to declare its type at creation rather than needing a trip
through the type editor afterwards.

---

## Sequencing

Reordered once Eric chose a real Config key for categories. The original sequence put
categories first because it was the simplest; it now goes **last**, because it is the
only one that has to wait on a deploy, and putting it there means the other two are live
in the meantime and the project costs exactly one deploy instead of gating everything
behind it.

1. **Field data types** — frontend only, merges immediately. Carries the `Field` rework
   (a `dataType` prop and an `error` prop), which is what the required-field
   inline errors need,
   and carries the `parentError` → `formError` rename, since the error channel gains its
   second and third occupant here. Also builds the type editor's **per-field row list**
   with the data-type control and an empty slot beside it.
2. **Required fields** — frontend only, merges immediately. Now small: a
   `requiredFields` array, a validation pass in `saveDraft`, and a checkbox filling the
   slot phase 1 left.
3. **Categories** — backend **v33** plus frontend. Deploy to every tenant first,
   confirm with `node deploy.mjs --status`, then merge.

## Testing

Sandbox mode covers all of this end to end — none of it touches the backend, so there
is no write path a browser cannot exercise. Two things Sandbox will *not* catch on its
own and that need deliberate attention, both of which have burned this project before:

- **`MOCK_SNAPSHOT`'s stored column config must be updated to include at least one
  column with an explicit `dataType` and one without**, so the read-time fallback is
  exercised rather than only the stored path. The fixture already carries retired column
  keys for exactly this reason; a fixture whose shape is uniform hides the case that
  matters (the `personIds` lesson).
- **A pure-logic test file**, `test-frontend-type-rules.js`, following
  `test-frontend-tag.js`: it should slice the real helpers out of `index.html` and cover
  `columnDataType`'s fallback order, `requiredFields` pruning when a field is un-ticked,
  the emptiness check treating `"0"` as filled, and `categoriesInOrder` putting
  uncategorized last. Verify by mutation that each of those failing actually fails the
  suite — the four silent-failure modes here are a required field that a save silently
  ignores, a data type that resets to default on every load, a category that disappears,
  and a stale required entry that springs back.

## The questions, and the answers

Kept rather than deleted, because two of the three answers went against the
recommendation and the reasons are what a later reader will want.

1. **Required on every edit, or only on add?** → **Every edit** (as recommended). The
   only way the rule reaches existing data.
2. **Categories as plain strings, or their own Config key?** → **Own Config key**,
   against the recommendation. The recommendation optimised for shipping without a
   deploy; Eric optimised for the feature being properly manageable — orderable, with
   empty categories and a one-row rename — and accepted one deploy for it. Resequencing
   to put categories last recovers most of what the recommendation was protecting: the
   other two features do not wait on it.
3. **"Parent is required" in scope?** → **No** (as recommended). Left as a follow-on
   that needs its own answer for Unassigned, which is a deliberate state — a spare in a
   drawer, a unit away for repair — and not a gap to be nagged about.