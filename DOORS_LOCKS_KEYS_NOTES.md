# Doors / Locks / Keys — pre-build design notes

Nothing here is built yet. This records one structural decision that has to be made
*before* the module exists, because it's the kind of thing that's cheap now and expensive
after there's data in the sheet. Same role `PANELS_BREAKERS_ARCHITECTURE.md` played for
Panels — not a full spec, just the decision.

## `LockKeys` is top-level shared state, not an array nested in a Door

The obvious move is to copy the shape that already works: Panel → Breaker → Circuit, where
child entities live nested inside their parent asset's object and travel with it through
`persist()`. For Doors → Locks that's still the right shape. For **keys** it isn't.

Nesting encodes a tree, and a tree can only say "this child belongs to that one parent". It
can't represent:

- **Many-to-many.** One key opens many locks, across many doors; one lock is opened by many
  keys (a master, a sub-master, an individual). There's no parent to nest a key under —
  picking one Door as its home would be arbitrary, and every other door's view of that key
  would have to reach into a sibling asset to find it.
- **Cross-parent moves, cheaply.** Anything that moves a child from one parent asset to
  another means mutating two assets atomically, which this app has no mechanism for — the
  known limitation that got cross-panel circuit moves deferred (Move Circuit is same-panel
  only today). Rekeying is exactly that operation, and unlike cross-panel circuit moves it
  isn't a rare edge case that can be deferred; it's the normal way keying changes.

So the join data — which key opens which lock — lives as its own top-level state, with its
own sheet tab, keyed by `lockId` + `keyId`, and belongs to no single asset.

**The precedent is `breakerTypes`**, not `breakers`: a global catalog, its own tab, loaded
in `doGet` and passed through `persist()`'s options object (`persist(next, { lockKeys })`)
alongside the other non-asset domains, so it participates in `_dirty` domain-skipping the
same way. Follow that wiring end to end rather than inventing a new one.

Consequences worth knowing up front:

- Keys are their own records too (a key isn't a child of a lock any more than it's a child
  of a door), so the module has three things to store, not two: Locks (nested under their
  Door asset), Keys, and the `LockKeys` join rows.
- The join rows are the only place a key/lock pairing exists — a Door's "which keys open
  this?" and a key's "what does this open?" are both **computed** by filtering `lockKeys`
  at render time, per the reference conventions in `CLAUDE.md`. Neither side stores a list.
- Deleting a lock or a key has to clear its join rows, the same client-side guard-or-cascade
  pattern as every other delete in this app.

What *does* carry over from Panels unchanged: `ChildEntityTable` for the Locks-under-a-Door
list, UUID identity for Locks/Keys, per-mutation audit entries with `snake_case` action
names, and label-based references to Assets (a lock's Door is `doorLabel`).
