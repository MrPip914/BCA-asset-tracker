# One-time tasks and projects — Todoist integration evaluation

**Status: evaluation only. Nothing is built and nothing is decided.** Written 2026-09-12
against backend **v36** (the number came from `SCRIPT_VERSION` in the repo at this commit,
NOT from a live check — run `node deploy.mjs --status` before planning around it, per the
standing rule).

The question: the app schedules recurring maintenance and records work that was done, but
has nowhere to put a **one-time task** or a **multi-step project**. Eric uses Todoist and
explicitly does not want a second to-do tracker built into the app. Is an integration
viable, and what does it cost?

**Short answer: yes, and it is cheaper than it looks.** Three findings decide the shape:

1. **Todoist's API sets CORS headers that echo the caller's origin** — verified
   empirically, not read off a doc page (§6). A browser at `assets.stama.tech` can call it
   directly. That removes the need for a proxy, and then gets rejected anyway for a reason
   that has nothing to do with whether it works (§5).
2. **`UrlFetchApp` is already an authorized scope** — v18's `tokeninfo` call proved it, and
   `forceAuthorizeExternalRequests` exists to grant it. So a backend-mediated design needs
   **no new OAuth scope**, which is the rule `PHOTOS_EVAL.md` landed on and the trap v29's
   `DriveApp` import fell into.
3. **The join between an asset and its tasks can be stored on ZERO sides of the Sheet**
   (§4). No `ASSET_FIELDS` entry, no new tab, no new Config key, no migration — therefore
   none of the release hazards this project keeps getting bitten by.

What it costs instead is a **decision about ownership** (§2) and an **account question**
(§5) that has to be answered before a line is written.

---

## 1. What exists today, and the exact shape of the gap

Two record types, and neither can hold a one-time task.

**`maintenanceItems`** — `assetLabel, id, task, frequencyLabel, frequencyDays,
lastPerformed, owner, at, by` (`MAINTENANCE_FIELDS`). Recurrence is not an attribute of a
maintenance item; it is the **only way one exists**:

- `nextMaintenanceDue()` returns `null` unless BOTH `lastPerformed` and `frequencyDays` are
  set.
- `maintenanceStatusOf()` returns `"never"` when `lastPerformed` is empty — and `"never"`
  is pinned to the TOP of the Scheduled list, deliberately, because a schedule that has
  never run needs attention.
- `MAINTENANCE_FREQUENCIES` is a fixed five-entry list (Weekly → Annually). There is no
  "once" and no "no repeat".

So a one-time task expressed as a degenerate schedule — "Replace the Room 104 ballast", no
frequency — would render as **permanently overdue-looking, forever, and could never be
cleared**, because the only way out of `"never"` is a completion that then computes a next
due date. This is not a missing field. The record type is the wrong shape.

**`changes`** — `assetLabel, id, changeType, vendor, cost, note, at, by, maintenanceId,
performedOn` (`CHANGE_FIELDS`). This is the **durable record of work done**: what it cost,
which vendor, when it actually happened, optionally against which schedule. Entirely past
tense. Nothing here is a plan.

**The gap is precisely the future, non-recurring item**: a repair to book, a quote to
chase, a part to order, a summer project with five steps and a deadline. Today those live
in Eric's head or in Todoist with no connection to the asset.

**And what must not be lost:** in this app the **asset is the organizing principle**.
"Every open item on Building 200" is a question the app can answer and Todoist cannot,
because Todoist has no idea what Building 200 contains. A task list that does not resolve
back to an asset is what Todoist alone already provides — and it is not what is missing.

---

## 2. The rule that decides the architecture: one owner per fact

This repo's conventions already answer this, in `CLAUDE.md`:

> **The reference lives on ONE side.** A change names its schedule; a schedule keeps no
> list of its changes. Storing both would be a second copy to keep in sync, and it is the
> one that goes stale.

> **Computed, not stored, for anything derivable from a reference that already exists.**

Two systems both holding a task's due date, owner, and done-ness is a **sync engine**. A
sync engine needs conflict rules, a reconciliation pass, and a story for "edited in both
places while offline". This app's entire concurrency design is *detect and refuse* —
`doPost` writes nothing on a revision mismatch and tells the user to redo it, because
merging would destroy one of the two changes. A background two-way merge against a third
party is the opposite of that posture, and it is not maintainable by one person from a
phone.

**Therefore: Todoist owns the task. The app owns the asset. Neither mirrors the other's
mutable state.**

The consequence, stated plainly because it is the part that will feel wrong later:
**completing a task happens in Todoist.** The app displays open tasks against an asset; it
is not a second place where they get ticked off. That is not a limitation of the
integration — it is the thing that keeps this from becoming the to-do tracker Eric said he
did not want.

### The seam where the two systems genuinely have to meet

There is exactly one place where clean separation is not good enough:

- **Todoist's value is the working list** — capture on a phone, due dates, reminders,
  "what am I doing today".
- **The app's value is the durable record** — what was done to which asset, what it cost,
  which vendor, who signed it off. That record is what a five-year-old air handler's
  history is made of, and Todoist deletes completed tasks from view and keeps no cost or
  vendor fields at all.

So when a task is completed in Todoist, **the fact that work happened is knowledge the app
needs and will not otherwise get.** Ignore that seam and the app's work history silently
becomes a record of only the work that was logged by hand — which is a worse record than
today's, because today nothing pretends to be complete.

This is the single biggest cost driver in the whole evaluation, and §7 proposes a way to
close it that needs no webhooks and no OAuth app.

---

## 3. The options

### Option 0 — Build one-time tasks natively, no Todoist at all

Stated first and fairly, because it is the honest baseline and Eric's constraint ("no
second to-do tracker") does not automatically rule it out.

Adding `{ label: "One-time", days: 0 }` to `MAINTENANCE_FREQUENCIES` does **not** work —
`frequencyDays: 0` is falsy, so `nextMaintenanceDue` returns null and the item is
`"never"` forever (§1). Doing it properly means a real `dueOn` field, a `done` flag, and a
status function that understands "closed", i.e. **a new record type with its own column in
`MAINTENANCE_FIELDS`** — a backend release plus UI for add/complete/reopen.

| | |
|---|---|
| **Cost** | One backend version + deploy to every tenant; ~a day of UI |
| **Buys** | Works offline, no third party, no account question, tasks live where the assets are |
| **Costs** | It IS a to-do tracker. No phone capture, no reminders, no natural-language dates, no "today" view — and Eric would then be keeping two lists |

**Keep this on the shelf.** It is the fallback if the account question in §5 has no good
answer, and it is worth noting it is *additive* to every other option rather than in
competition with it.

### Option A — Deep link out only (zero integration)

An **"Add task in Todoist"** button on the asset page opens Todoist's quick-add with the
content prefilled: asset name, tag, and a link back to `?asset=<id>`. The app stores
nothing, calls nothing, and shows nothing back.

| | |
|---|---|
| **Cost** | An afternoon. No backend change, no version bump, no deploy, no token |
| **Buys** | Capture from the asset page, and a Todoist task that knows which asset it is about |
| **Costs** | One-way and blind. The app can never answer "what is open on Building 200" |

Mechanically: `https://todoist.com/add?content=…` 307-redirects to
`https://app.todoist.com/add?content=…`, which serves 200 (verified). **That route is
undocumented** — it is not in the API reference and not in the help article on task links
— so treat it as unsupported: verify it in a browser, and accept it may break. The cost of
it breaking is one dead button, which is the right failure for something this cheap.

### Option B — Read-back through the backend, nothing stored *(recommended first real step)*

The backend gains one read op (`op:"todoistTasks"`) holding a Todoist token in Script
Properties. The app asks for the tenant's open tasks once per load, groups them by the
asset id carried in each task (§4), and renders them. Read-only: tasks are created and
completed in Todoist.

| | |
|---|---|
| **Cost** | One backend version + deploy per tenant. **No schema change, no new Config key, no migration** |
| **Buys** | "What is open on this asset / this building / the whole school", answered by the app |
| **Costs** | Needs a token (§5). Nothing is written from the app |

### Option C — Read plus write-through

Adds `op:"todoistCreate"` and `op:"todoistClose"`, editor-gated exactly like
`photoSign`. Create a task from the asset page; optionally close one. Still stores nothing.

| | |
|---|---|
| **Cost** | Same release as B if built together; ~half a day more of UI |
| **Buys** | Capture without leaving the app, which is where the asset context already is |
| **Costs** | Every write is a live third-party call — needs a real failure story, and "the task may or may not exist now" is a genuinely unpleasant state |

### Option D — Two-way, webhook-driven

Todoist pushes `item:completed` to the backend, which writes a work-history entry.

**This is where the cost jumps, and it is worth knowing why before it is wanted.** Todoist
webhooks are verified by an HMAC-SHA256 of the body keyed on an **OAuth app's client
secret** — so they require registering a Todoist application and moving off personal
tokens onto OAuth (whose new-app default is a 1-hour access token with refresh rotation,
i.e. a token-refresh story inside Apps Script). And the receiving endpoint must be
**unauthenticated**, which means a new public branch of `doPost` alongside `?panel=` — the
one part of this app's surface that is deliberately anonymous, and not somewhere to add a
second door casually.

| | |
|---|---|
| **Cost** | OAuth app + token refresh + an anonymous `doPost` branch + HMAC verification. A feature, not a phase |
| **Buys** | Completions land in work history with no human step |
| **Costs** | All of the above, to save a click that §7 can already reduce to one |

**Recommendation: A now if a button is wanted this week, B as the real first step, C once B
is proven, and D only if §7's polling answer is measured and found wanting.**

---

## 4. Where the join key lives

Three candidates. The third is recommended, and it is the finding that makes B cheap.

**(a) The asset stores its task ids.** The obvious design, and the expensive one. An asset
has *many* tasks, so this is either a JSON blob column in `ASSET_FIELDS` or a new tab —
both a backend release, and the tab is the `doGet`/`doPost` contract hazard
`test-backend-assetid.js` exists to guard. Worse, it stores a **reference to a record
whose lifecycle another system controls**: delete the task in Todoist and the app holds a
dangling id it cannot distinguish from a transient API failure. Every id is a row that can
go stale.

**(b) A Todoist label per asset** (`@BCA0042`). Rejected on sight: a label per asset means
hundreds of labels in a personal Todoist account, which makes the label picker useless for
everything else Eric uses Todoist for, and runs into per-plan label limits.

**(c) The Todoist task carries the asset id.** *(recommended)* The task's `description`
holds the app's own deep link — the same `?asset=<id>` URL the app already builds — and the
id is parsed back out of it on read. The app stores **nothing**.

Why this fits rather than merely being cheap:

- **It is the app's existing convention applied across the boundary.** `?asset=` accepts an
  **id OR a tag, permanently** (see "The asset key" in `CLAUDE.md`) — so a link sitting in
  a Todoist task survives a retagging, exactly as a printed sticker does. That property was
  built for links that outlive the build that made them, which is what this is.
- **A Todoist project can group a multi-step project** with no app-side concept at all: the
  project name comes back on the task, so "Summer lab refresh" is a heading the app renders
  from data it did not have to store. This is the "projects" half of the original question,
  answered for free.
- **One Todoist-side convention, one filter.** A single label (`@asset`, or a dedicated
  project) is what the read query selects on — one label total, not one per asset.

**The honest cost:** the join key lives in **user-editable text**. Someone who rewrites a
description breaks the link. But notice the failure direction — the task stays in Todoist
and keeps working; it just stops appearing under its asset. **Nothing is destroyed and
nothing is silently wrong**, which is the same trade the app already accepts for a dangling
`maintenanceId` ("a normal state, not corruption"). Compare (a), where the stale reference
lives in the Sheet and looks authoritative.

Mitigation if it proves annoying: the app can render the id as a stable marker line and,
when it reads a task in the target project whose description has lost it, show it in an
"unlinked tasks" group rather than dropping it. That makes breakage visible and fixable in
one click instead of invisible.

---

## 5. Auth — the decision that has to come first

**Recommended: a personal API token per tenant in Script Properties, exactly the Cloudinary
pattern.** `CLOUDINARY_*` is already read that way, the deploy deliberately does not carry
Script Properties, and `handlePhotoSign_` **names the missing keys** rather than failing
generically, because a per-tenant setup step is easy to forget on a newly onboarded school.
`TODOIST_API_TOKEN` (plus optionally `TODOIST_PROJECT_ID`, `TODOIST_LABEL`) is the same
shape and should copy that error text.

Three things follow, and the first is the real decision:

**It is ONE Todoist account behind a multi-user app.** Every task the app shows is that
account's, and every task created from the app lands in it. For Brookside — where Eric *is*
IT and facilities — that is probably exactly the intent. But it needs stating now, because
the first staff member who wants their own list is the moment the model breaks, and it
breaks in the direction of "Eric's personal task list is visible to app users". If other
staff need to see or complete these, the target must be a **shared Todoist project**, they
need Todoist accounts and collaborator invites, and then mapping a Todoist collaborator to
a `User` asset becomes a real question. Bounded, but not free, and not phase 1.

**Rejected: a per-user token held in the browser.** CORS makes it technically possible
(§6) and it is the wrong call anyway. A Todoist personal token is an **unscoped,
non-expiring, full-account bearer credential**; this app's origin is public and its repo is
public, and `localStorage` on a shared school machine is not where one belongs. It also
defeats the purpose — each user's tasks would live in their own account, so "the school's
open items" would not exist anywhere.

**Rejected for now: proper per-user OAuth.** It needs a client secret, so it needs the
backend regardless, plus refresh-token handling inside Apps Script. It is the right answer
to the multi-user question if that question ever gets asked in earnest — and it is what
Option D needs anyway, which is a reason to treat D and multi-user as one future project
rather than two.

Three smaller rules that follow from existing conventions and should not have to be
rediscovered:

- **Writes gate on `editor` in the backend**, in the same place every other write rule in
  `AssetTrackerSync.gs` lives. Hiding the button is a courtesy; this is the control.
- **Sandbox makes no network call, at all.** A Todoist section in Sandbox renders fixture
  rows or renders nothing — it must not reach the backend, per the Sandbox rule.
- **The public `?panel=` page must not carry tasks.** That payload is a whitelist
  (`pickPublic_` + `PUBLIC_*_FIELDS`), so this is free by construction — the rule is just
  "never add them". Tasks name vendors, costs and staff.

---

## 6. What the wire actually allows (verified, not assumed)

**CORS is real and permissive.** An `OPTIONS` preflight to `https://api.todoist.com/api/v1/tasks`
with `Origin: https://assets.stama.tech` returns:

    access-control-allow-origin: https://assets.stama.tech
    access-control-allow-headers: Authorization,Content-Type
    access-control-allow-methods: GET,POST,PUT,DELETE,OPTIONS
    access-control-max-age: 600

So the origin is echoed and `Authorization` is permitted — a browser could call Todoist
directly. Recorded because it removes a whole class of "we need a proxy" reasoning; the
design still goes through the backend, for the credential reason in §5 and not for a
technical one.

**Endpoints that matter**, all under `https://api.todoist.com/api/v1/`:

| Need | Call |
|---|---|
| Open tasks matching a filter | `GET /tasks/filter?query=…` (401 unauthenticated, so the path is live) |
| Create | `POST /tasks` — `content`, `description`, `project_id`, `section_id`, `parent_id`, `labels`, `priority`, `due_string`, `due_date`, `deadline_date`, `assignee_id` |
| Complete | `POST /tasks/{id}/close` |
| Completed history | `GET /tasks/completed/by_completion_date` — **requires `since` and `until`**; verified by the API's own error: `{"error":"Required argument is missing","error_extra":{"argument":"until, since"}}` |
| Batch | `POST /sync` — up to 100 commands in one request |

`due_string` accepting natural language ("every 3 months", "next Tuesday") is worth
noticing: it is how a recurring task would be expressed if maintenance schedules ever moved
to Todoist, and it is a better parser than this app will ever have.

**Rate limits: 1000 requests per 15 minutes per token**; Sync is 1000 partial / 100 full
per 15 minutes, with up to 100 commands batched into one request.

**Budget:** Option B is **one request per app load** — a single filter query returns every
open task for the school. Even so, the token is shared by every user of that tenant, so
cache it: `CacheService.getScriptCache()` for ~60 seconds per tenant needs **no scope** and
collapses a staff room full of reloads into one call. Well inside the limit with room to
spare.

**A Todoist failure must never fail `loadData()`.** The tasks section says "couldn't reach
Todoist" and every other part of the app carries on. This is the same posture as the
"Backend outdated" banner: report the degraded thing in place, do not take the app down
with it.

---

## 7. Closing the completion seam without webhooks

§2 identified the one fact that genuinely has to cross the boundary: **work happened.**
Option D buys it with an OAuth app and an anonymous endpoint. There is a much cheaper way,
and it is worth building *with* Option B rather than after it.

**Poll completed tasks and OFFER them, rather than pushing and writing them.** On load (or
behind a button), the backend calls `GET /tasks/completed/by_completion_date` for the
tenant's project over a recent window — the endpoint requires `since` and `until`, so a
window is mandatory, not a choice. Any completed task whose description names an asset, and
for which the app has no work entry yet, is shown as a prompt:

> **3 tasks completed in Todoist aren't in this asset's history.** *Log work →*

Clicking it opens the existing **Log work** dialog, prefilled: the asset resolved from the
link, `performedOn` set to the completion date, the note seeded from the task content.
Vendor, cost and work type are the fields only a human can supply — which is the whole
reason this should be a prompt rather than an automatic write.

Why this is the better trade:

- **No OAuth app, no client secret, no anonymous `doPost` branch, no HMAC.** It reuses the
  read credential B already needs.
- **It writes nothing on its own.** A completion becoming a cost-bearing work record is a
  judgement, and the app's own convention is that a completion is "a deliberate tick, not a
  consequence" — the exact reasoning behind the *Mark this task performed* checkbox
  defaulting off.
- **The expensive half of D is the write path, and this removes the need for it entirely.**

**The known limit:** "for which the app has no work entry yet" needs a way to tell. With
nothing stored (§4), the honest version is a dismissible per-device prompt keyed on the
Todoist task id in `localStorage` — the same class of state as column visibility, and it
costs no backend version. If that proves too leaky, the smallest possible escalation is
recording the completed Todoist task id on the work entry it produced, which is **one
optional column in `CHANGE_FIELDS`** and a backend release — the cheapest storage this
whole evaluation asks for anywhere, and only if measurement says it is needed.

---

## 8. Where it shows up in the app

- **A third sub-tab under Maintenance: Scheduled / History / Tasks.** The division already
  exists on the detail page and on the site-wide Maintenance tab, and it is the right shelf:
  Scheduled is what recurs, History is what was done, **Tasks is what is open**. The
  site-wide copy gets the scope filter for free — `scopeId` already narrows by place, so
  "every open task in Building 200" is the existing mechanism, not new work.
- **Grouped by Todoist project**, since that is how a multi-step project arrives (§4).
- **The Maintenance tab's badge is a decision, not an extension.** It currently counts
  schedules and turns red on overdue, deliberately — "a growing count of completed work
  would drown that". Folding open tasks into the same number is the same hazard and should
  be an explicit call; the sub-tab carrying its own count is the safe default.
- **The dialogs live in `renderWorkDialogs()`** if Option C is built, for the reason the
  photo lightbox had to move there: anything reachable from both the detail view and the
  site-wide tab must render from both, or opening it from the main page sets state and
  paints nothing.
- **Viewers see tasks and cannot create them**, matching Export and Copy link.

---

## 9. What will go wrong, and which way to let it fail

| Failure | Let it fail as |
|---|---|
| Token missing on a new tenant | Named setup instruction, `handlePhotoSign_`'s exact shape — never a generic error |
| Todoist unreachable / rate-limited | Tasks section reports it; the rest of the app is unaffected. Never fail `loadData()` |
| Description edited, link lost | Task keeps working in Todoist, drops out of its asset's view. Surface it as "unlinked", do not silently drop |
| Task deleted in Todoist | It disappears from the app. Nothing stale, because nothing was stored |
| Create succeeds, response lost | A duplicate task in Todoist, deleted in one swipe. Better than a task the app believes exists and does not |
| Someone completes in Todoist and never logs work | §7's prompt. Accept that it is a prompt, not a guarantee |
| Token leaks | It is a full-account credential — hence backend-only (§5). Rotation is one Script Property |

---

## 10. Summary

| | Option 0 (native) | A (deep link) | B (read) | C (+write) | D (webhooks) |
|---|---|---|---|---|---|
| Backend release | Yes, + schema | No | Yes, no schema | Same as B | Yes, + OAuth app |
| Stores anything new | Yes | No | **No** | **No** | Probably |
| Answers "what's open on Building 200" | Yes | No | Yes | Yes | Yes |
| Phone capture with reminders | No | Yes | Yes | Yes | Yes |
| Completions reach work history | n/a | No | Via §7 prompt | Via §7 prompt | Automatically |
| Effort | ~1 day + deploy | ~1 afternoon | ~1–2 days + deploy | +~half a day | Days, + new public surface |

**Recommended path: A this week if a button is wanted immediately; B + §7 as the real
build; C once B has been used for a while; D probably never.** Option 0 stays on the shelf
as the answer if §5's account question has no good answer.

---

## 11. Decisions for Eric

1. **One Todoist account, or per-user?** (§5) One account is the cheap path and means app
   users see that account's tasks. Everything else in this document assumes one.
2. **Does a task completed in Todoist need to become a work-history entry?** (§2, §7) This
   is the biggest cost driver. §7 says "as a one-click prompt"; the alternatives are
   "by hand, as today" and "automatically, at Option D's price".
3. **Do recurring maintenance schedules stay in the app?** Recommendation: **yes, stay.**
   They are tied to `lastPerformed`, to work history, and to the overdue badge — moving them
   to Todoist would trade a working feature for a dependency. Todoist takes the one-time
   work the app cannot express.
4. **Do other staff need to see or complete these?** If yes, that is a shared Todoist
   project and eventually per-user OAuth, and it should be known before the first token is
   pasted.
