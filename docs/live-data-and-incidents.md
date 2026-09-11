# What is on the live Sheets, and what has gone wrong

*Background, not rules. Read when you need to know the shape of real data, or the history behind a guard.*

*Moved out of `CLAUDE.md` on 2026-09-11, verbatim. See `CLAUDE.md` for the rules that apply to every change.*

### What is actually on the live Sheets

**Read this as a shape, not as a fact** — `node sheet.mjs tabs <tenant>` is the check, and the
one time this section stated live data as fact it was wrong for ten backend versions.

- **The panel feature has no live data.** The Breakers, Circuits and BreakerTypes tabs have been
  empty and there have been no Electrical Panel assets, while a great deal of the Data model
  section is written as though four real panels are sitting there — the printed door card, the
  panel diagram, the "fed from" banner, the same-panel Move Circuit restriction. **The FEATURE is
  real and the code is all there; the DATA is not.**
  - **`MOCK_SNAPSHOT` is where panel data lives**, deliberately: it carries the full
    Panel/Breaker/Circuit structure with populated `breakers` arrays. So Sandbox is the only place
    panel work can be tried end to end, which inverts the usual relationship — for this one area
    the fixture is richer than production rather than a trimmed subset of it. Seed the dev tenant
    by hand if a real backend write path needs exercising.
- **Mini-split sample data is the live inventory's own oddity**: Mitsubishi indoor units across
  most Rooms, with seeded maintenance items (Monthly filter clean + Annual coil clean). Sandbox is
  again the richer copy — `MOCK_SNAPSHOT` still carries Condensers, which is what keeps the
  `parentTypes: ["Building"]` case in "The parent chain" exercisable against something.
- **A user-created type's id is a generated UUID** and resolves through `typesList` with no
  registry entry — the id scheme working exactly as designed. There is at least one on the live
  sheet.

- ~~No auth beyond the cosmetic name tag~~ — **fixed in v18**, see Authentication in
  `docs/architecture.md`. Worth recording why it mattered more than it looked: the GitHub repo is
  **public**, so `SHEET_API_URL` in `index.html` was published the whole time. The
  "private link" model was never actually private. Rotating the URL was considered and
  rejected — once the backend authenticates, the address isn't a secret and doesn't need
  to be. (The one genuine trap there: an *old deployment* left active keeps serving its
  own frozen copy of the code, unauthenticated. Updating the existing deployment in place,
  which is this project's normal ritual, avoids it. Confirmed there is only one.)
- **Data-loss incident, 2026-08-21 ~17:57 — cause never identified.** The Assets tab and
  every child tab went empty during the v18 Google Sign-In rollout. Recovered in full from
  the Sheet's own version history (File > Version history), which is the reason this was an
  inconvenience rather than a disaster — that history is the real backstop for this app.
  - What was ruled out: the read-path guard (`_dirty` all-false on `op:"read"`) was present
    in the very first pushed commit, so the frontend-newer-than-backend window did not do
    it. Reads never write on any version. The Executions log showed several `doGet`s at
    the time and `doGet` has never written anything.
  - What was never established: which request actually emptied the tabs. Only a `doPost`
    can write, and no `doPost` was tied to the moment.
  - **The response was to make the outcome impossible rather than to keep hunting** (v21):
    `doPost` refuses to write an empty asset list over a populated Assets tab unless
    `confirmEmptyAssets` is passed. In a full-overwrite design, "the client sent nothing"
    and "the user deleted everything" are the same request on the wire — that ambiguity is
    the actual defect, and it was worth closing whatever the trigger turned out to be.
  - If assets ever vanish again: restore from version history first with the app CLOSED,
    then check whether the guard fired (the app shows a "Refused:" notice) before assuming
    a new cause.
