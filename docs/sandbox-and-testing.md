# Local Sandbox mode

*Read before iterating on UI, or before deciding how to verify a change.*

*Moved out of `CLAUDE.md` on 2026-09-11, verbatim. See `CLAUDE.md` for the rules that apply to every change.*

## Local Sandbox mode

A "Sandbox" pill in the top-right of the header (next to the name tag) toggles between
the real Google Sheet and a local fixture (`MOCK_SNAPSHOT`, in `mock-data.js` since
2026-09-11) — added so
UI iteration doesn't have to touch live data or wait on Apps Script redeploys/cold
starts. OFF by default (talks to the real Sheet); the toggle state is remembered
per-device via `localStorage` (`SANDBOX_MODE_KEY`).

- **When ON**: `loadData()` reads `MOCK_SNAPSHOT` (or, after the first edit, the
  saved-over copy in `localStorage` under `SANDBOX_DATA_KEY`) instead of fetching
  `SHEET_API_URL`; `persist()` writes back to that same `localStorage` key instead of
  POSTing to Apps Script. **No network call to the real backend happens at all while
  Sandbox is ON** — safe to add/delete/break things freely. A "Reset" button next to
  the pill wipes the `localStorage` copy back to the original `MOCK_SNAPSHOT` fixture.
- **When OFF**: behaves exactly as before this existed — real fetch, real writes.
- `MOCK_SNAPSHOT` is a trimmed, hand-maintained subset of the real inventory (not all
  107 real assets — that would bloat the file for no benefit), but keeps the full
  Electrical Panel/Breaker/Circuit structure intact since that's the area under active
  development. Update it by hand (it's plain JS data) when you want the sandbox to
  start from a different baseline, e.g. after a schema change, so new development has
  fixture data that already matches the new shape instead of stale pre-change data.
- Backend schema changes (a new `BREAKER_FIELDS`/`CIRCUIT_FIELDS`/`ASSET_FIELDS` entry
  in `AssetTrackerSync.gs`) can be fully built and tried out in Sandbox mode — including
  by Claude Code, which can flip the toggle via the same UI — without needing a redeploy
  first. Only flip Sandbox OFF and redeploy once the feature is actually done, so a
  schema change only needs *one* "paste + redeploy" instead of one per iteration.

## How a change gets verified

The three rules that decide this live in `CLAUDE.md`, because they apply to every change
rather than to Sandbox:

- **A backend write path cannot be covered by browser testing, structurally.** Sandbox
  never contacts Apps Script and the live backend needs a sign-in, so a `.gs` change is
  verified by slicing the source out and unit-testing it.
- **`doGet` and `doPost` are two halves of one contract**, and a test that slices only one
  side passes while the pair is broken.
- **A fixture whose SHAPE differs from the backend's actual response hides exactly the
  bugs the fixture exists to catch** — the `personIds` lesson. That is why `MOCK_SNAPSHOT`
  is deliberately MIXED on asset ids, work-entry ids and maintenance ids rather than
  uniform.

`node run-tests.mjs` runs every test file in the repo and prints one summary; run a single
file directly when one fails, for its full output. New tests are discovered by filename.

**A guard is not finished until it has been verified by mutation** — break the thing it
protects, watch the test fail, put it back. Every test in this repo was built that way,
and it is the only thing that distinguishes a guard from a line that always passes.
