# Parent/Child Structure — pre-build design notes

Nothing here is built yet. This records the decisions made before the work starts, so the
build session doesn't have to rediscover them. Same role `PANELS_BREAKERS_ARCHITECTURE.md`
played for the panels module, and `DOORS_LOCKS_KEYS_NOTES.md` for locks/keys.

Decided in conversation with Eric, Aug 17 2026.

## The change

Today an asset's place in the world is stored as two fixed fields: the room it's in, and
the building that room is in. That hardcodes a two-level hierarchy — building contains
room, room contains equipment — and it's the only shape the app can express.

Replace both with **one parent reference per asset**. A room's parent is its building. A
computer's parent is its room. The hierarchy stops being baked into the field names and
becomes ordinary data.

## Decisions

1. **One parent field replaces the fixed room/building fields.** The two-level hierarchy
   becomes a general chain that can be any depth.

2. **Each type declares what it can have as a parent, in the type settings.** A Room takes
   a Building. A Computer takes a Room. A Condenser takes a Building (it's outdoor, it
   belongs to no particular room). A Building takes nothing — it's the top. These rules
   live in the same central type settings as everything else about a type, **not** scattered
   through the app. This is why this work happens together with finishing the type settings,
   as one change rather than two.

3. **Storage is permissive; the app enforces the rules.** The spreadsheet backend will
   accept any parent. The app is what knows a computer belongs in a room and prevents
   nonsense. This matches how every other rule in this app already works — nothing is
   validated server-side today, and making this the one exception wouldn't close a real gap.
   The consequence to accept: a hand-edited spreadsheet or a bulk script can still introduce
   a parent that breaks the rules, so the app must **tolerate and flag** bad parentage rather
   than break on it.

4. **Circular chains must be blocked.** With fixed fields this was structurally impossible.
   With a general parent it isn't: A inside B inside A. Anything walking the chain has to be
   safe against a loop, and the app should refuse to create one. This is a new risk that
   didn't exist before.

5. **References stay id-based.** A parent is stored as the target asset's stable ID, never
   its display name — exactly as room and building references already work. This is the
   single most valuable property of the current design and must survive the change unchanged.
   Renaming a room stays a plain single-asset edit with nothing else to keep in sync.

6. **A device's building stays computed, never stored.** Today a device's building is derived
   by looking through its room. After this change it's derived by walking up the parent chain.
   Same principle, more general: don't store a relationship that something else already
   records.

## The other half: finishing the type settings

The parent rules above are a new entry in the app's central type settings — the one place
that describes each kind of asset. That list already exists, and it already replaced an
earlier mess of scattered per-type checks. But it only got half-finished, and this work is
the moment to finish it.

**What it covers today:** which fields a type has, its icon, whether it can be deleted, what
it's called, and how it attaches to a place.

**What it still doesn't cover** — and what should move into it as part of this work:

- **Whether a type is a place** that can contain other things. Currently a hardcoded check
  for two specific type names.
- **Which tabs appear** when you open an asset of that type, and which one opens first.
  Currently hardcoded per type name at each tab.
- **Which sub-item module belongs to it** — breakers for an electrical panel, locks for a
  door when that exists.

Those decisions are made today by comparing against literal type names, scattered across the
app — roughly 39 such comparisons. The practical effect: adding a plain device type is a
one-line change, but adding a structurally interesting one takes around nine separate edits
in different places, with nothing to warn you if one is missed.

**Why this happens in the same change as parent/child, not before or after it:** the parent
rules are a new setting in this same list. Building the list out first would mean designing
its attachment section around today's fixed room/building model, then immediately reworking
it. One change, not two.

**What stays as-is — do not "clean this up":** some questions really are about one specific
type. "Which of these assets are Rooms?" — asked to build the list you pick a room from — means
Rooms, and naming the type there is correct. What moves into the settings is questions about a
*capability* that several types might share: "can this hold other things inside it?" is answered
today by checking for Room or Building by name, and that silently breaks the moment a new kind
of place is added. The first kind should be left alone; only the second kind moves. `CLAUDE.md`
already draws this line correctly.

## Explicitly out of scope

These are deliberate exclusions, not oversights.

- **Sub-item modules stay separate.** Breakers and circuits — and locks and keys when they're
  built — remain their own modules, not ordinary assets with parents. Making them ordinary
  assets was considered and rejected: it would fill the main asset list with hundreds of
  breakers and locks, and the panels module already works. The cost of this decision is that
  each new module is still largely hand-built; the answer to that is a standard module
  template, tracked separately from this work.
- **Bulk item distribution is not parent/child.** A bulk item spreads a quantity across many
  rooms at once. That's a distribution, not a single parent, and it stays exactly as it is.
- **Many-to-many relationships are not modeled here.** One key opening many locks is a
  different shape and gets its own design when locks/keys is built.
- **Multiple parents are not supported.** A door that sits between two rooms can't be
  expressed by one parent field. Not needed today; revisit if a real case appears rather than
  building for it speculatively.

## Open questions for the build session

Raise these with Eric rather than deciding silently:

- **How deep should nesting go?** Building → Room → equipment is today's depth. Should a room
  be allowed inside a room (a closet inside a classroom)? Allowing it is more flexible;
  restricting it is easier to reason about.
- **What does an asset with no parent mean?** Buildings legitimately have none. Should an
  ordinary device be allowed to have none — a spare in a drawer, something not yet placed?
- **How is the chain shown in the interface?** Today there are separate Building and Room
  columns. Whether those stay as computed display columns, or become a single path, is a
  presentation decision Eric should see before it's built.

## Sequencing and risk

Unlike the display-name work that preceded this, **this change touches live data**: every
existing asset's room and building information has to move into the new shape. About 107
assets today, which is a good reason to do it now rather than later.

Recommended: make the data structure change first and **pause for Eric's review** on test
data before layering the type-settings work on top. Two reviewable stages, not one large
change.
