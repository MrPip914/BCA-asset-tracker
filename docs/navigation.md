# Navigation, history and scroll

*Read before changing how the app moves between the list and an asset, or anything touching the address bar.*

*Moved out of `CLAUDE.md` on 2026-09-11, verbatim. See `CLAUDE.md` for the rules that apply to every change.*

- **Top-level navigation**: `mainTab` ("assets" | "maintenance") switches the main page
  between the asset list (`view === "list"`) and a site-wide Maintenance overview — every
  asset's `maintenanceItems` flattened into one sortable-by-urgency table (`allMaintenanceRows`).
  Both live inside the same `view === "list"` screen; opening an asset (either tab) still
  goes through `openDetail()` into `view === "detail"`, and `openDetail(asset, "maintenance")`
  jumps straight to that asset's Maintenance sub-tab — used by the overview's row click.
- **Navigation IS the address bar now** (2026-09-10). This bullet used to say the opposite —
  "the app never pushes into the address bar as you navigate (no back-button support, that
  wasn't asked for)" — and it was asked for: clicking through several assets left no way to
  trace back, because the in-app arrow always returned to the LIST no matter how deep you
  were, and the browser's own Back left the app entirely since the tab held exactly one
  history entry. On a phone, where Back is a system gesture, that second one is the harsher.
  - **Every navigation writes history, so the browser's stack IS the trail.** Opening an
    asset PUSHES `?asset=<id>&tab=<tab>`; switching tabs REPLACES. That split is the whole
    design: pushing on a tab click would bury the previous asset one press deeper per tab
    looked at, so Back would stop meaning "the thing I was looking at before" almost
    immediately. A `popstate` listener restores the view.
  - **No second breadcrumb strip, deliberately.** The app already has two — `HierarchyNav`
    above the list and the Path field on the detail page — and both answer *where does this
    live* (containment). A trail of *where have I been* is a different question wearing an
    identical costume, and a third crumb row would have made all three ambiguous. The back
    control NAMES its destination instead ("← Room 101"), which is the same information
    without a new visual language.
  - **`backTo` is stored in the history entry because the History API deliberately does not
    expose the previous one.** It holds the id, and the NAME is resolved at render time —
    the app-wide reference convention (see "Reference conventions" in `CLAUDE.md`), applied to a reference
    that happens to live in history state, so a rename can't leave a stale word on a button.
  - **`navDepth` is what stops Back leaving the site.** It counts entries *this app instance*
    pushed; the control may only call `history.back()` above zero. At zero the user arrived
    on a deep link in a fresh tab, and popping would take them off the site — so it clears
    the detail params in place instead.
  - **`navUrl()` rebuilds the URL from the CURRENT search string** rather than assembling one,
    so every param that isn't ours survives. `c`/`client` is the one that matters: dropping it
    silently re-resolves a dev or second-school session to the default tenant on the next
    reload, and someone would be reading Brookside's live data believing they were on dev.
    Naming the tenant here would work and would be wrong — a second copy of the
    `CLIENT.urlParam()` rule, to go stale the day a third param exists.
  - **A history entry whose asset is gone lands on the list and REWRITES itself there.**
    Entries outlive the assets they name (deleted here or in another tab). Closing without
    `fromHistory` on that path means `replaceState` heals the dead entry — legal during a
    popstate, disturbs nothing — so the address bar stops naming an asset that isn't there
    and a later pass doesn't retry the dead id.
  - **The one-time load-side deep link is unchanged in shape** and still gated by
    `urlDeepLinkAppliedRef` (a `useRef`, not empty-deps — `assets` starts `null` and the
    effect has to wait for `loadData()`); it now passes `replaceHistory` so the entry the
    user is already standing on is replaced rather than stacked on itself. `?asset=` still
    matches an id OR a label, permanently, and so does a pushed entry — a link pasted in or
    an entry from an older build can carry either.
  - **A deep-link arrival keeps its URL EXACTLY as it arrived** — `replaceHistory` seeds
    that entry's history *state* but passes no URL, and records the tab AS REQUESTED
    rather than as resolved. Found when merging this work onto the Maintenance/photos
    branch, which is the only place the two features meet: `?tab=changes` resolves to the
    Maintenance tab's History SUB-tab, and no URL param names a sub-tab, so normalising the
    address to `?tab=maintenance` would land a RELOAD of that link on Scheduled instead.
    Links outlive the layout that produced them — which is the whole reason `"changes"` is
    still accepted — so the one entry that *is* a link is the last place to tidy it away.
    The tab the user clicks still writes the resolved tab, because they are standing there
    rather than following a link. **The maintenance sub-tab is still not in the URL at
    all**; giving it one is the real fix if sub-tab links are ever wanted.
  - **The "Copy link" button (panel layout view only) is now largely redundant** — the address
    bar holds the same URL for every asset, not just panels. Kept because it copies without
    the user having to find the address bar on a phone, which is where a panel gets looked at.
  - **Covered by `test-frontend-nav.js`** for the two failures that are silent (the tenant
    drop, and a stale `?asset=` surviving a return to the list), verified by mutation. The
    history walking itself is browser behaviour — push vs replace, Back landing on the
    previous asset, the depth guard — and was verified by driving the real page in Chromium,
    which is the only place `popstate` exists. Sandbox mode is where that was done.
  - **Back and Home are two controls, and collapsing them would cost whichever lost**
    (2026-09-11). Making the arrow a one-level pop removed something it used to guarantee:
    a single tap out. Eric hit it immediately — nest a few levels and leaving meant tapping
    back through every one. So the detail header carries a **home icon** beside the arrow:
    Back means "the thing before this one", Home means "out".
    - **It collapses the whole stack in ONE history move**, `history.go()` back to the list
      entry, rather than switching the view directly. That is what returns the list exactly
      as it was left, scroll included — rebuilding it in place would land on the top of an
      unfiltered list, i.e. throw away the thing the history work was for.
    - **`homeDepth` on each entry is what makes that one move possible.** It carries the
      depth of the nearest list entry down the stack — set to the current depth when leaving
      the LIST, inherited when leaving a detail page — so the jump is always one `go()`
      however deep it went. **Depth 0 is NOT reliably the list**: a shared link opened cold
      starts the trail at an asset, so that entry's `homeDepth` is null and Home builds a
      list in place and lands at the top. That is the one case it cannot restore anything.
    - **Home sits LEFTMOST and is a fixed width**, so the back arrow keeps a stable position
      for the thumb even though the label beside it changes length — and it reads the way the
      list's own breadcrumb does, with "all of it" at the left end.
    - **Scroll on the home jump is left to the browser, like everywhere else.** A hand-rolled
      restore was written for it first and then removed again when the mutation passed
      without it: Chrome handles a multi-step `go()` as well as a single Back. See the scroll
      entry below for the measurement trap that produced the wrong conclusion — it caught
      this feature a SECOND time.
    - The first history entry is seeded with a real list entry on mount, so "no state" stops
      meaning "the initial list" by convention. Tidiness rather than a fix — `currentNavDepth`
      already read null as 0 — but two things read these fields now, not one.
  - **Scroll position: the browser restores it, and the app only resets it** (2026-09-11).
    An asset opened from the list now starts at its own top, and so does a list reached by
    `closeDetail` replacing an entry (a deep-link arrival, an asset deleted underneath a
    live entry) — both via one `useLayoutEffect` consuming a `scrollToTopRef`, so the
    correction lands before paint rather than as a visible jump.
    - **"Losing your place in the list" had already FIXED ITSELF** when this app started
      pushing history entries, and that is the thing to know before touching this again.
      The browser restores scroll for same-document history navigation on its own; with one
      entry in the tab there was nothing to restore, which is where the complaint came
      from. Verified by driving the committed build: Back returned to 1200, 400 and 900 px
      exactly, unaided.
    - **What was actually broken was the other direction.** Nothing reset the scroll when
      OPENING an asset, so the list's offset carried into a shorter page and clamped —
      1200px down the list put you 103px into an 806px detail page. That is the whole bug,
      and `window.scrollTo(0, 0)` after layout is the whole fix.
    - **A hand-rolled replacement was built first, passed, and was thrown away.**
      `scrollRestoration = "manual"`, a `scrollY` on every history entry, `captureScroll()`
      at each navigation point and a debounced scroll listener keeping the current entry
      up to date — ~70 lines, all of it reimplementing something the browser already does
      correctly. It was written on a measurement contaminated by the test harness:
      Playwright scrolls an off-screen row into view before clicking it, which moved the
      very offset under test, so "going back lands at 361" was the robot's scroll, not the
      app's. **Click a row that is already on screen** when measuring this, or the number
      is about Playwright. **This trap has now produced a wrong conclusion twice** — the
      second time on the home jump, where it made the browser look like it could not restore
      scroll across a multi-step `go()` and nearly bought a hand-rolled replacement for the
      second time. Scroll events coalesce per frame, so the robot's scroll never shows up in
      an event log either. The tell is a scroll number that disagrees with a single-step
      Back; when one appears, suspect the click before the code. Do not re-add the manual approach on suspicion; if restoration
      ever does prove flaky on a bigger sheet, that is the shape of the fallback.
  - **Deliberately NOT handled yet**, both because they widen the change rather than finish
    it: Back mid-edit still discards the draft silently (it always did, but a reflexive
    gesture makes it likelier than a deliberate click did), and Back with a modal open
    navigates instead of closing the modal.
