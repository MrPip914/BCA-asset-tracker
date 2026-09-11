# Types, categories and per-type settings

*Read before touching `TYPE_REGISTRY`, the type editor, categories, custom fields, required fields or column data types.*

*Moved out of `CLAUDE.md` on 2026-09-11, verbatim. See `CLAUDE.md` for the rules that apply to every change.*

## Data model

Assets have a `type`, picked from a managed list (`typesList`, editable via the gear icon on
the Type field, seeded from `TYPE_OPTIONS` on a brand-new sheet: Computer, Monitor, Phone, TV,
DocuCam, Stream Deck, Room, Building, Bulk Item, Electrical Panel, Other).

**A type is referenced by `id`, never by the name people read** (2026-08-25). `typesList` holds
`{ id, name }`; `asset.type`, every `parentTypes` entry and every `TYPE_REGISTRY` key hold the
id. That split is what makes renaming a type free — with the name stored on every asset,
"Computer" → "Workstation" would have to rewrite every asset plus every type naming it as a
parent, the same cascade the id migration removed for Rooms.
- **A built-in type's id IS its original name** — Room's id is the string `"Room"`. That looks
  like the thing ids are meant to avoid and is the opposite: every asset already on the sheet
  is already storing a valid id, so this needed **no data migration and no backend change**
  (`typesList` is a JSON blob in Config, so its shape is the frontend's business), and every
  identity test the app makes (`a.type === "Room"`) keeps working. Only types created after
  this get a generated id, since only they have no historical name to preserve.
- `adoptLegacyTypesList()` reads the old plain-string array on load, same pattern as
  `adoptLegacyParentage`/`adoptLegacyNames`. `typeNameOf(id, typesList)` resolves a name for
  display, falling back to the id.
- Names needn't be unique for correctness, but add and rename both refuse a duplicate: two
  types both reading "Printer" in the picker is a trap for whoever is choosing.

**A type is filed under a CATEGORY, and every list of types groups by it** (backend v33).
`typeCategories` is its own Config key holding `[{ id, name }]` with **array order as display
order**; a type points at one through `typeSettings[id].categoryId`.
- **Eric chose the key over the free version, knowing it cost a deploy.** The cheap version
  was a category NAME on each type with the list derived from whoever names one — no backend
  change at all. What it cannot do is the two things a category list is for: it can only be
  ordered by something else (the order types happen to appear in), and it cannot hold a
  category nobody has filed a type under yet, so you could never build the scheme and then
  sort types into it. **The argument that made the cheap version tempting is still worth
  keeping**, because it is reusable: the store-an-id rule is about names held in several
  places written at several times, and a category has exactly one holder (`typeSettings`, one
  blob rewritten atomically), so a name there would have been safe — just not capable.
- **A built-in category's id IS its own name** ("Places"), the same trick `typesList` and the
  asset key refactor used: every shipped registry entry already names a valid id, so this
  needed no seeding step and no migration. `ensureShippedCategories()` tops a stored list up
  with any category added in a later release, at its shipped position rather than appended —
  the lesson `ensureLockedTypes` learned when User landed under `Other`.
- **A DANGLING `categoryId` is not an error, it is Uncategorized.** Deleting a category does
  not rewrite the types that named it, so deletion needs no in-use block — only a
  confirmation naming how many types fall back. Same permissive-storage stance as `removeType`
  and `parentageProblem`. **Renaming is a one-row edit** with nothing to keep in sync, which
  is the entire point of storing the id.
- **`Other` ships with no category on purpose** — the catch-all belongs in Uncategorized, and
  it keeps that bucket exercised in the shipped state.
- **`SelectionModal` and `ColumnFilterModal` take an OPTIONAL `groupForOption`** and render
  flat when it's absent, which is every caller but the Type picker and the Type column filter.
  Forking either into a grouped twin is how the app would end up with two dropdown behaviours
  — the thing `SelectionModal` exists to prevent. Both callers must hand it options already
  sorted into category runs, or one heading appears several times down the list.

**Per-type settings are a user-editable overlay on `TYPE_REGISTRY`** (the type editor,
2026-08-25). The registry is the shipped default and is never written to; overrides live in
Config under `typeSettings` keyed by type id (backend v24) and are merged on top at read time
via `typeEntryFor()`, so a built-in still works if its override is missing and "Reset to
default" is just deleting it.
- **`TYPE_SETTINGS` is a module-level variable, not React state, and that is a deliberate
  trade with a real hazard.** `fieldAppliesTo`, `isPlaceType` and `parentTypesFor` are plain
  functions called from ~100 render sites (several per table cell), so threading state through
  them would be an enormous diff for no behavioural gain. React therefore does not know when it
  changes: it is safe **only** because every write goes through `persist()`, which `setState`s
  anyway, and `applyTypeSettings()` is called *before* that setState so the following render
  reads the new values. **Anything that changes these settings without a setState will silently
  show stale rules.** The two app-wide derived sets (restricted fields, place types) are
  recomputed on change rather than per call, since `fieldAppliesTo` runs per cell.
- **Per-type custom fields (v26).** The editor can invent a new field for a type. It becomes
  an ordinary custom column (Config's `columns`) carrying `restricted: true`, plus its key in
  that type's `onlyFields` — so it reuses the restricted-field engine rather than adding a
  second mechanism. **Restriction is a flag on the COLUMN, not a consequence of who claims
  it**: derived the other way, unticking a field from its last owner would turn it into a
  common field and splash it across every type. New fields are pending until Save, so the whole
  editor stays one commit and a cancelled edit leaves no stray column. They're created hidden —
  a field belonging to one type would otherwise add a mostly-empty column to everyone's table.
  Deleting one stays in the Columns menu, which already owns that destructive action.
  - **Adding one is a DIALOG, opened by an "Add field" button** (2026-09-10). It was an
    always-open text box under the field list, which sat there on every visit whether or not
    anyone wanted a field — and left the field's KIND, the one thing that cannot be changed
    later, with nowhere to be chosen except a row that did not exist yet. The dialog is where
    a field is invented, so it holds the name, the kind, and a choice list when the kind is
    one; the row list then shows every field's kind as plain text and offers no control at all.
  - **It is rendered INSIDE the type-manager modal's tree, and that is what makes the layering
    work.** The modal establishes a stacking context, so anything nested paints above its
    content whatever the z-index, and the kind picker nested one deeper paints above the
    dialog in turn. A sibling overlay would have had to out-number the modal and would still
    have lost to its own picker.
  - **A blank or duplicate name is REPORTED, not silently ignored.** The old inline version
    `return`ed on both, so the button did nothing and said nothing.

**Three things a type now decides that it didn't before** (backend **v33**, 2026-09-09 —
see `TYPE_MANAGEMENT_PLAN.md`): which **category** it is filed under, which of its fields are
**required**, and — a per-column question rather than a per-type one — what **kind of value**
each field holds. Two of the three needed no backend change at all, and the exception is the
one worth remembering.

- **A column's `dataType` and a type's `requiredFields` cost NOTHING to add**, because
  `doPost` stringifies the whole `columns` and `typeSettings` blobs and the only thing the
  backend reads inside a column object is `customColumnKeys_`, which touches `custom` and
  `key`. **A new Config KEY is the one thing that blob-freedom does not cover** — `doPost`
  writes a fixed key list and silently drops the rest — which is exactly what categories
  needed, and why that one phase cost a version bump and a deploy to every tenant. Reuse
  that test for any future per-field or per-type setting: a property on an existing blob is
  free, a key of its own is a release.
- **The data type is PER COLUMN, resolved at READ time** (`columnDataType()`): the column's
  own override, then `DEFAULT_COLUMN_DATA_TYPES`, then text. Per column because one key
  holding a date on Computers and a number on TVs breaks sorting, filtering and the export
  for a flexibility nobody asked for — a type decides *whether* it has a field, the column
  decides what that field *holds*, and the editor says so on screen because changing it from
  inside one type's editor changes every other type's form. Read-time because the column
  migration only ever ADDS newly-introduced columns and never updates the properties of
  stored ones, so a load-time backfill would bake today's defaults into every sheet forever.
  `applyFieldKind` stores an override only when it DIFFERS from the shipped default and
  removes it when it returns — "same as shipped" is never a stored fact.
  - **CHOSEN AT CREATION, FIXED AFTERWARDS** (Eric's call, 2026-09-10). The kind is picked
    where the field is born — the Columns menu's "add column", or a pending row in the type
    editor — and every existing field then shows its kind as plain text with no control.
    `saveTypeSettings` writes a kind only for a column it is inventing in that same save, so
    the rule is structural and not merely a hidden picker.
    - **This removed a problem rather than managing it.** A kind change could not convert
      stored values (a full asset rewrite triggered by a settings edit, with nowhere to put
      anything unparseable), so it left them intact but *undisplayable*: a number input
      cannot render `MOCK-CMP-001`, so the form showed the field EMPTY and then refused to
      save, naming a value that was not on screen. Across forty assets that was forty
      unsaveable records complaining about blank fields. **If a different kind is needed,
      the answer is a different field.**
    - A `select` column's CHOICES follow the same rule and for the same reason — narrowing
      the list under stored data leaves assets holding a value the field no longer offers.
      They are shown read-only on an existing field, since "Choice list" alone says nothing
      about what the field accepts.
    - `validateColumnValue` stays regardless: data can still arrive out of step from the
      admin import, a direct Sheet edit, or a hand-edited Config blob.
  - **This was not purely additive.** The app's entire data-type awareness was
    `type={c.key === "totalQuantity" ? "number" : undefined}` at two call sites, which is why
    `purchaseDate` and `warrantyUntil` were plain text boxes for the app's whole life. The
    general mechanism replaced that and gave them real date pickers on the way past.
  - **The vocabulary is `ChildEntityTable`'s**, character for character —
    text/textarea/number/date/select — so the app has one answer to "what kind of field is
    this". `multiselect` is deliberately absent: `person`, `peripherals` and a circuit's
    rooms each have a bespoke component with its own managed list, and a generic multiselect
    column would be a fourth thing that looks like them and behaves differently.
    `BESPOKE_FORM_FIELDS` names that set once, so the render and the save-time validation
    cannot drift — and the editor shows "Built in" rather than a kind picker for them, since
    offering a setting that does nothing is worse than offering none.
- **Required is PER TYPE, and that is the opposite call from `restricted`** — a flag on the
  column. The two look alike and are not: restriction HAD to live on the column, because
  deriving it from whoever claims a field means unticking it from its last owner turns it
  into a common field and splashes it across every type. Required is derived from nothing, so
  per-type is simply the more expressive reading. **Nothing is required as shipped.**
  - **Enforced on EVERY save, add and edit** (Eric's call). It is the only way a new rule
    reaches the assets already on the sheet, and a rule you can dodge by editing something
    else is not a rule. The cost is that someone who opened an old asset to fix a typo gets
    stopped; the whole mitigation is that the message names the fields *and* the type.
  - **At the FORM and nowhere else**, same posture as every other guard here — so existing
    assets can violate a new rule, and `duplicateAsset`, `convertUsersToAssets`, the bulk
    toolbar actions and the Sheet's admin import all bypass it.
  - **Emptiness, never falsiness**: `0` and `"0"` are filled in. And `fieldValueIsEmpty` knows
    the three fields that don't store a plain string — the parent is `parentId`, the people
    are `personIds` or the legacy slash-joined `person`. Miss that fallback and every asset on
    an un-converted sheet reads as unassigned, so a rule about User refuses every save.
  - **A rule naming a field the type doesn't have is ignored at READ time**, not only pruned
    on save: a settings blob can be hand-edited or written by an older build, and a rule about
    an invisible field would refuse every save with nothing on screen to fix. Structural
    fields go the same way, which is also what keeps **"Parent is required" out of scope** —
    Unassigned is a deliberate state, not a gap to nag about.
- **`draft.formError` + `draft.errorFields` replaced `draft.parentError`.** It was already
  carrying the duplicate-tag message as well as the parent one, and data-type and required
  errors were the third and fourth occupants. `errorFields` is what the rename made necessary:
  one channel carrying errors about several fields can't say which input to outline.
  **The message renders in exactly ONE place** — beside the field when it names one field
  that is on this form, at form level otherwise. The first version rendered both and printed
  the same sentence twice; each render site read correctly on its own, which is why only the
  browser caught it. The add form's separate `addError` state is gone with it.

- **What the editor can't do, and why.** An icon is stored as a NAME from a curated map
  (`TYPE_ICON_CHOICES`), since a React component can't survive JSON; an unknown name falls back
  to the shipped icon. A ticked field enters `onlyFields` only when it is *already* restricted
  app-wide (`SHIPPED_RESTRICTED_FIELDS`) — the editor must not mint a new restricted field,
  because that would restrict it app-wide and quietly strip it from every type that hadn't
  opted in — that hazard is about EXISTING columns, which is why a field the editor creates
  itself (above) may be restricted: it is new, so there is no data anywhere to strip.
  Modules stay uneditable: a tab body needs a render branch, so it can't be switched on by data.
- **Editing is allowed on locked types.** `locked` means the app depends on the type *existing*
  — its tabs, its field rules — which is about the id, not what it's called or what it holds.
- Name and settings save in ONE `persist()`: both are the config domain, so two calls would mean
  two full snapshot writes and a chance for the second to be rejected as a conflict with the
  first.

**Everything the app knows about a structurally special type lives in one `TYPE_REGISTRY`**
near the top of `index.html`, keyed by type name. This replaced a set of parallel arrays
(`TYPE_ONLY_FIELDS`, five `*_EXCLUDED_FIELDS`, `LOCKED_TYPES`, `CATEGORY_ICONS`) plus a
scattering of `asset.type === "Room"`-style tests at render sites — adding a structurally
new type meant editing all of them with nothing to catch a miss. Each entry may declare:
- `locked` — can't be removed in the type manager (`isLockedType()`): Room, Building, Bulk
  Item, Electrical Panel, which have deep structural dependencies elsewhere (field rules,
  Contents/Allocations/Breakers tabs, the parent chain) a plain managed-list removal breaks.
- `icon` — the lucide icon (`iconFor()`, default `HelpCircle`).
- `excludedFields` — column keys this type doesn't get at all.
- `onlyFields` — column keys belonging to this type. Any key named in *any* entry's
  `onlyFields` becomes restricted app-wide (`RESTRICTED_FIELDS`, derived from the registry,
  not declared separately): no type that doesn't name it gets it.
- *(no `nameField` — removed in v23.)* Every asset carries one optional **`name`** field
  instead, read via **`nameOf(asset)`**, which returns it if non-empty and otherwise falls
  back to the asset's `label` (its Asset ID). A type no longer declares where its name
  lives, which is what lets a user-created type have a real name with no registry change.
  Until v23 this was a per-type key pointing at a different column each time (Room →
  `room`, Building → `building`, Campus → `campus`, Bulk Item → `itemName`), and that
  tangled two questions into the same columns: the Room column meant "this room's name" on
  a Room row and "the room this sits in" on every other row, while the Type column printed
  a name where the type word belonged. Only those four types could be named at all.
  **A name is display only and never identity** — `label` remains the one stable key, names
  need not be unique, and nothing resolves a reference through one, which is what makes
  renaming free. **Nothing outside `nameOf()`/`adoptLegacyNames()` should read a per-type
  name column** — writing `.itemName ||` or `.room ||` anywhere else is the old ladder
  growing back. (`roomNameFor`/`buildingNameFor` were doing exactly that and were switched
  to `nameOf()` in the same change; `panel.html`, `panel-qr-sheet.html` and the backend's
  `displayName_()` read `name` with the legacy column as a fallback, since the public QR
  page has to be right both before and after the sheet is rewritten.)
- `parentTypes` — which types an asset of this type may sit **inside**, as an array of type
  names; `[]` means it takes no parent. This replaced the old `linkage` enum
  (`"room"`/`"building"`/`"allocations"`/`"none"`) when the fixed `roomId`/`buildingId` pair
  collapsed into one `parentId` — `linkage` existed only to describe those two fields, so
  keeping it would have left a second source of truth about the same question. **The registry
  is the only thing render sites should branch on** — never a hardcoded type-name comparison.
  See `docs/parent-chain.md` for the full story.

Types added at runtime via the gear-icon manager are deliberately NOT in the registry: every
lookup falls back to a generic room-dwelling device (no icon, no field rules,
`DEFAULT_PARENT_TYPES`), which is exactly how they behaved before the registry existed. Note
that "which assets *are* Rooms" queries (`roomNameFor()`, the Contents tab's
`isPlace`/`contentRooms`, the Duplicate button's place check, and `roomNameOf`/`buildingNameOf`'s
"is this asset itself one?" test) legitimately still compare type names — those are identity
questions. "What may contain what" is a capability question and goes through the registry:
the toolbar's `roomMovable` (bulk "Move filtered to room") asks `canBeParentOf("Room", a.type)`,
which correctly began including Rooms themselves once a Room could nest inside another. The
Contents tab no longer asks the question at all — it walks the chain downwards
(`descendantsOf()`), which is how the old Condenser special case disappeared.

`roomMovable` also excludes **the room being moved out of**, and that exclusion is load-bearing
rather than tidy-mindedness: the scope matches the room *and* everything under it (that's what
lets it find things nested deeper), and a Room is itself Room-movable, so without the exclusion
every use of "move the devices in this room" quietly moved the room into the destination too —
restructuring the building instead of relocating equipment. Nested rooms below it stay movable,
which is the coherent reading of "everything in this room moves". The bug was introduced by
making the *Room filter* chain-aware, back when the filter was what this hung off (it was
harmless while the filter only ever matched a direct `roomId`), and was caught in browser
testing, not by reading the diff. The filter is gone and the scope replaced it, but the
exclusion is the same rule about the same hazard.

`fieldAppliesTo()` reads the merged entry — e.g. Room and Building assets don't have
brand/model/serial; Bulk Items (chairs, tables — not individually tagged) get a `totalQuantity`
and a `subType` instead, and are distributed across rooms via their own `allocations` array
rather than a single `room` field. `subType` ("Sub-Type" in the UI) is picked from its own
managed list (`bulkItemTypes`) rather than freeform text, so it stays consistent.

**`subType` was called `itemName` until v24.** Renamed so the sheet column says what every label
in the app already said — the field carries only the category now, since `name` took the naming
half of its old double duty in v23. Done the way `parentId` and `name` were: `subType` is
written, `itemName` is still read as a fallback (`adoptLegacySubType()`) and still written by the
backend, so the change is reversible and un-migrated rows resolve; clearing the old column is a
separate later step. A stored column config maps the old key to the new one on load
(`RENAMED_COLUMN_KEYS`) — without that it would keep the dead `itemName` column *and* gain
`subType` from the add pass, showing the same thing twice.

**The Type column shows the type word and nothing else** — "Room", "Bulk Item", "Computer" —
since v23. It used to print a Room's name there (via a local `realName`), and a Bulk Item's
sub-type plus a small "BULK" badge; both are gone, along with the badge, which only existed
because the column was showing "Chairs" and there was otherwise no way to tell what kind of
row it was. Name now has its own column, visible by default and sitting ahead of Type. The
Sub-Type column shows only the category. The detail-view header is unchanged in shape: it
prints `label` and then `titleText`, which is `"<name> (<type>)"` for a named asset and
otherwise the older `type · screenSize` / bare `type`, keyed on `nameOf(asset) !==
asset.label` so a nameless asset can't render "BCA0082 BCA0082".

**No native `<select>` appears anywhere in the app** — every single-select field uses the same
custom modal picker (`SelectionModal`) instead: a centered card with a scrollable option list
and a checkmark on the selected item, visually matching the column-filter popup
(`activeFilterCol`) rather than the browser's native dropdown chrome. `PickerTrigger` is the
button that opens it, styled like the old `<select>` so form layouts didn't need to change.
`TypeField`/`RoomField`/`BuildingField` are bespoke wrappers (id-based, with "(deleted room)"-
style dangling-reference handling); everything else — Frequency, Change Type, Vendor, Bulk Item
Sub-Type, Breaker Type, panel Layout, the Move Circuit/Add Breaker/toolbar
bulk-action pickers, and `ChildEntityTable`'s generic `type: "select"` field — goes through the
generic `PickerField` component (same `PickerTrigger` + `SelectionModal`, parameterized by
`options`/`labelForOption`/`onManage`). Pass `hideLabel` when the field already has its own
label elsewhere (e.g. an outer flex-row `<label>`, or a mode-toggle button pair like the
Circuit form's Serves-rooms/Feeds-sub-panel picker) so `PickerField` renders just the trigger,
not a second redundant header. `UserField`/`PeripheralsField` are deliberately NOT `PickerField`
— they're multi-select chip-toggle groups, a different interaction from a single-select dropdown.
