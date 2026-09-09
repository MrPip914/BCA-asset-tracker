# Type management: categories, required fields, field data types — plan

Status: **not started.** Written 2026-09-09 from Eric's three asks.

Three changes to how asset types are managed, in one document because they land in
the same two places (the type editor and the column record) and because two of them
share a UI that only makes sense built once.

1. **Categories** — a type belongs to a category, and every list of types groups by it.
2. **Required fields** — a field can be marked required, and a save is refused until
   it is filled in.
3. **Field data types** — a field declares what kind of value it holds, and the form
   only lets you enter that kind.

## The headline: none of this needs an Apps Script deploy

That is unusual enough here to state first, and it is not luck — it falls out of
where each setting is stored.

- `AssetTrackerSync.gs` writes the Config tab's `columns` and `typeSettings` and
  `typesList` rows as **whole JSON blobs** (`JSON.stringify(body.columns || [])`), so
  any new property on a column object or a type-settings object round-trips untouched.
- The one place the backend looks *inside* a column object is `customColumnKeys_`,
  which reads `c.custom` and `c.key` and ignores everything else.
- Nothing here adds a Config **key**, an `ASSET_FIELDS` entry, or an Assets column.

So `SCRIPT_VERSION`/`FRONTEND_SCRIPT_VERSION` do not move, no tenant needs deploying,
and the whole thing ships with the frontend from `main`. **This is a real constraint on
the design, not just a happy outcome** — the moment any of these three wants its own
Config key (see "Categories: the alternative" below), the cost jumps from one merge to
a deploy on every tenant, and the feature works in-session and forgets on reload until
that deploy lands. Keep them out of new keys unless there is a reason worth that.

`bumpAppVersion`: `APP_VERSION` should move for each phase, since these are exactly the
changes where "did my browser get the new build?" gets asked.

---

## 1. Categories

### Where a category lives

**Recommendation: the category is a plain name string on the type's own settings —
`typeSettings[typeId].category = "Places"` — and there is no separate category list.**

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

### Categories: the alternative, and when to take it

A real `typeCategories` Config key holding `[{ id, name }]` with array order as display
order, and `typeSettings[typeId].categoryId` pointing at it. That buys explicit
ordering, empty categories, and a rename that touches one row.

It costs a **backend version bump and a deploy to every tenant**, because `doPost`
writes a fixed list of config keys and silently drops the rest — so until the deploy
lands, categories would work in-session and be forgotten on reload. That is the same
window the pre-v24 `typeSettings` work sat in, and it is a real cost for a school with
six categories.

Take it if Eric wants categories he can order by hand, or wants to define the category
scheme before assigning types to it. Otherwise the string is the right size.

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

- `typeEntryFor` already merges `TYPE_SETTINGS` over `TYPE_REGISTRY`, so
  `entry.category` needs no new plumbing. Ship the built-ins with a `category` in
  `TYPE_REGISTRY` (Places: Room/Building/Campus; People: User; Equipment: everything
  else) so the grouping is useful on day one without anyone editing anything.
- `categoriesInOrder(typesList)` — derive the ordered list, used by both the manager
  and the pickers.
- `TypeManagerModal`: a Category combobox in the edit form; grouped rows in the list.
- `saveTypeSettings` writes `category` into the `typeSettings[id]` object it already
  builds. One line.
- `SelectionModal` + `ColumnFilterModal`: optional grouping.

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
  filled.** This is the intended behaviour (it is how the rule gets applied to existing
  data at all) and it is also the one way this feature can be genuinely annoying. Worth
  a decision from Eric before building: nag-on-every-edit, or only enforce on *add* and
  on an edit that touches the required field itself. Recommendation: nag on every edit —
  a rule you can dodge by editing something else is not a rule — but say so plainly in
  the error, naming the field.

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
  a Required checkbox, and the data-type control from phase 3. Off fields render dimmed
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
  reason to do phase 3's `Field` rework first (see sequencing).
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

The per-field row in the type editor (shared with phase 2), **and** the Columns menu,
which is where a custom column is created (`addColumn`, ~4474) and deleted. A column
created there should be able to declare its type at creation rather than needing a trip
through the type editor afterwards.

---

## Sequencing

Three commits, in this order, each shippable on its own:

1. **Categories.** Touches `TYPE_REGISTRY`, `typeSettings`, `TypeManagerModal`,
   `SelectionModal`, `ColumnFilterModal`. No dependency on the other two.
2. **Data types.** The `Field` rework (an `error` prop and a `dataType` prop) is the
   thing phase 3 needs anyway and the thing phase 2's inline errors depend on, so it
   goes second even though "required" is the simpler feature. Also carries the
   `parentError` → `formError` rename, since the error channel gets its second and
   third occupant here.
3. **Required fields.** Now a small change: a `requiredFields` array, a validation pass
   in `saveDraft`, and a checkbox in a per-field row that phase 2 already built.

Phases 2 and 3 share the type editor's per-field row list. Build it in phase 2 with the
data-type control and an empty slot; phase 3 fills the slot.

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

## Open questions for Eric

1. **Required on every edit, or only on add and on edits that touch the field?**
   Recommendation: every edit. It is the only way the rule reaches existing data, and a
   rule with a dodge is not a rule.
2. **Categories as plain strings (no deploy, no explicit ordering) or as their own
   Config key (a deploy, orderable, empty categories possible)?** Recommendation: plain
   strings, which is what this plan assumes throughout.
3. **"Parent is required" — worth pulling into scope?** It is the most valuable single
   rule available and it is the one this plan explicitly leaves out, because `parent` is
   a structural field and Unassigned is a deliberate state that a required rule would
   need an answer for.
