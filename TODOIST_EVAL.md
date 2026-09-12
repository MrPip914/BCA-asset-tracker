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

**And it has to be the app that notices, because Todoist cannot ask.** Nothing in Todoist
fires on completion — no custom fields, no completion form, no native rules engine, and the
official extension platform is invoked by hand and does not run on mobile. See §12, which
was written after this section and settles it.

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
2. **Does a task completed in Todoist need to become a work-history entry?** (§2, §7, §12)
   This is the biggest cost driver. §7 says "as a one-click prompt"; the alternatives are
   "by hand, as today" and "automatically, at Option D's price". **Todoist cannot ask for
   the detail itself** (§12) — so the realistic choices are a description template the task
   already carries (§12.6), a follow-up task the app creates (§12.5), or nothing.
3. **Do recurring maintenance schedules stay in the app?** Recommendation: **yes, stay.**
   They are tied to `lastPerformed`, to work history, and to the overdue badge — moving them
   to Todoist would trade a working feature for a dependency. Todoist takes the one-time
   work the app cannot express. **§13 is the follow-on question**: if they stay, how they
   appear in Todoist and how a completion gets back — answerable, and the only part of this
   document that asks the app to grow a writer of its own.
4. **Do other staff need to see or complete these?** If yes, that is a shared Todoist
   project and eventually per-user OAuth, and it should be known before the first token is
   pasted.

---

## 12. Can Todoist itself ask for the detail when a task is completed?

Asked 2026-09-12, as a follow-up to §7: instead of the app noticing a completion after the
fact, can Todoist prompt for cost/vendor/notes at the moment the checkbox is tapped —
natively, or via an extension?

**Short answer: no. Nothing in Todoist fires on completion, and the one official
extensibility platform is invoked by hand and does not run on mobile.** The detail below
matters because two of the near-misses look like they would work and do not.

### 12.1 There is no native mechanism, in three separate places

- **No custom fields and no completion form.** A task has `content`, `description`,
  labels, priority, dates, assignee — that is the whole vocabulary (§6). There is nowhere
  to put a cost or a vendor, and no form shown when a task is closed.
- **No automation or rules engine.** Todoist has no native "when a task is completed, do
  X" builder. Everything of that shape in the ecosystem is a third party (§12.4).
- **No completion event available to anything you host yourself** except the webhook, which
  is Option D and carries Option D's price (an OAuth app to get a client secret to verify
  the HMAC, plus an anonymous `doPost` branch).

### 12.2 The obvious zero-cost workaround does not work

The instinct is a **sub-task**: hang "Log cost + vendor in the tracker" under every task, so
closing the parent leaves the reminder behind.

**It does not survive.** Completing a parent task in Todoist **completes its open
sub-tasks along with it** — including ones deliberately made uncompletable. So the
reminder is swept away by the very action meant to trigger it, silently. Worth recording
because it costs nothing to try and looks like it works until you check whether the
sub-task is still there.

### 12.3 UI Extensions — the official answer, and why it is not the answer here

Todoist does have a real extension platform (`developer.todoist.com/ui-extensions`), and
it is more capable than expected:

- **Three surfaces**: task/project **context menu**, **composer** (while adding a task,
  sub-task or comment), and **settings** (one per integration).
- **Real forms.** The UI is a "Doist Card" — adaptive-card JSON with text blocks, **input
  fields**, toggles, columns and action buttons, supporting `Action.Submit`, which posts
  the user's input back as `{"inputId": "inputValue"}`.
- **Your own HTTPS endpoint** receives a POST (`extensionType`, `context`, `action`) and
  answers with a `card` and/or `bridges` (client-side actions: notifications, text
  insertion, sync triggers). Turn-based: the client renders, the user interacts, it posts
  again.
- **Verified by HMAC**, `x-todoist-hmac-sha256` over the whole payload keyed on a
  verification token from the App Management Console — a real auth mechanism, and notably
  **no full OAuth client is needed for the extension itself**. An optional short-lived
  token (`x-todoist-apptoken`) can be requested with scopes for API calls during the
  extension's lifecycle.
- **Available on all plan tiers** (Beginner, Pro, Business).

So the shape Eric is imagining is buildable: a task context-menu item — *"Log work in Asset
Tracker"* — opening a modal with Work type, Vendor, Cost and Notes, submitting straight
into the Sheet. **Two things disqualify it for this particular job:**

1. **It is invoked manually, never by an event.** It is a menu item, not a hook. Completing
   a task does not open it, and nothing can make it. So it does not prompt — it is a place
   to type the detail *if you remember to go there*, which is the same problem §7 already
   solves without it.
2. **Web and desktop only. Not mobile** (Todoist says support is planned). Eric works from
   a phone, and completing a task on a phone is the exact moment in question. This is close
   to fatal on its own.

And one further cost, found by testing rather than reading: **the app's Apps Script backend
is a poor integration service.** A POST to `/exec` answers **302** to
`script.googleusercontent.com/macros/echo?…` — the client has to follow the redirect (and
switch to GET) to collect the body, which is why the browser works and why a plain
`curl -L --data …` gets a **405** instead. Whether Todoist's caller does that is unknown
and would have to be tested; on top of that, Apps Script cold starts take seconds, in front
of a modal a user is waiting on. Making this robust would mean a small separate service — a
Worker or a serverless function — which is a new moving part this project has deliberately
gone without (no build step, no `npm install`, nothing to keep running).

**Where UI Extensions WOULD earn their keep**, if desktop-only is acceptable later: a
**composer** extension that inserts the correct asset link while a task is being written.
That fixes the one real weakness of the recommended join key (§4) — a hand-typed or
hand-pasted link — at the point the task is created, on the machine where most tasks get
typed. Worth remembering, not worth building first.

### 12.4 What *can* be triggered by a completion (all third parties, all polling)

| Tool | Completion trigger | Can it prompt? |
|---|---|---|
| **Zapier** | Yes — "new completed task" | Yes: it can create a Todoist task, or POST a webhook |
| **Make / IFTTT** | Yes | Same shape as Zapier |
| **Doify** (Todoist-specific) | Yes — "task completed" | **No.** Its actions are Todoist-internal only — move, reschedule, add/remove label. No webhook, no task creation, no comment |

Two things to note. **Doify is the one that looks purpose-built and cannot do the job** —
it can label a completed task `@needs-writeup`, which is a Todoist-side filter view and
nothing the app's own poll doesn't already know. And **none of these are instant**: they
poll on the order of minutes (5+ typically, longer on free tiers), so even the best case is
"a few minutes after you tick it", not "as you tick it".

Each also adds an account, a subscription, and a third party holding a Todoist grant —
against a design whose whole appeal is that it needs no new moving parts.

### 12.5 The mechanism that actually reaches a phone: let the app create a follow-up task

**A Todoist task is Todoist's own prompt mechanism.** It appears in Today, it can carry a
due date and a reminder, and it works on every platform including the phone. So the prompt
does not need an extension or a webhook — it needs something to create a task.

**The app can do that itself.** §7's poller already reads completions with a token it
already holds; creating a task is one more call on the same credential (Option C's write
op). On finding a completed task with no matching work entry, it creates:

> **Log work: Room 104 mini split** — cost, vendor, notes → *(link to the prefilled Log
> work form)*

No third party, no OAuth app, no extension, no anonymous endpoint. It reaches the phone
because it is a Todoist task like any other.

**Three costs to name honestly:**

- **Idempotency needs one durable fact.** "Have I already asked about this completion?"
  cannot be answered from nothing, and a poller that forgets will recreate the prompt every
  cycle — the most annoying possible failure. The prompt task itself can hold the completed
  task's id and be searched for, which covers the normal case; what it does not cover is a
  prompt Eric completes *without* logging work. That is the point at which §7's optional
  column — the completed Todoist task id recorded on the work entry it produced, one
  optional `CHANGE_FIELDS` entry — stops being optional. It is still the cheapest storage
  this whole evaluation asks for.
- **The write-up tasks must be excluded from the app's own read filter**, or they show up as
  open work against the asset and the app is reporting its own reminders back to itself. A
  dedicated label the filter excludes handles it.
- **Their completion must not spawn another prompt.** Same label, checked before creating.

### 12.6 The reframe: completion is the wrong moment to ask

Worth saying plainly, because it changes what "good" looks like here.

**The cost and the vendor are usually not known when the task is completed.** The filter is
changed on Tuesday; the invoice arrives a fortnight later. A modal at the moment of the tap
would frequently be answered "don't know yet" — and the app already encodes exactly this
belief: `at` (when the entry was typed) and `performedOn` (when the work happened) are
deliberately different fields, so that "a job can be written up days later and still be
dated honestly".

So a hard prompt at completion is not merely unavailable — it is the wrong instrument. The
two things that fit the real timing:

1. **Put the fields where the eye already is.** When the app creates the task (Option C), it
   seeds the description with a template:

       Asset: Room 104 Mini Split (BCA0117)
       <link back to the app>
       --- fill in when known ---
       Cost:
       Vendor:
       Notes:

   Those lines are **on screen in the task detail view at the moment the checkbox is
   tapped**, on mobile, with no extension and no moving parts — which is the closest thing
   to the prompt Eric asked about that actually exists. The poller parses whatever was
   filled in into the prefilled Log work form; blank lines parse to nothing and lose
   nothing.
2. **A follow-up task (§12.5) for the ones that matter** — where a cost is expected — so the
   reminder survives until the invoice lands, which a modal never could.

### 12.7 Recommendation

**Do not chase a completion-time prompt.** It does not exist natively, the sub-task
workaround is silently swept away, UI Extensions are manual and desktop-only, and every
event-driven route is either a third-party poller or Option D's OAuth app.

**Build §12.6's description template with Option C, and §12.5's follow-up task only if the
template alone proves too easy to ignore.** Both ride the token and the poll that Options B
and C already need, neither needs a new service, and both work on a phone.

Revisit UI Extensions if and when they reach mobile — at which point a *composer* extension
that inserts the asset link (§12.3) is the more valuable of the two anyway.

---

## 13. If schedules stay in the app: how Todoist shows them, and how a completion gets back

Asked 2026-09-12. §11's decision 3 recommends recurring maintenance stays in the app. This
section is what that costs, because "stays in the app" is not the same as "stays out of
Todoist" — the whole point is that they show up in the list Eric actually works from.

**Two directions, and the hard part is not Todoist.** Pushing a due schedule into Todoist
and reading a completion back are both a handful of API calls. What makes this the most
expensive thing in this document is that **nothing in this app writes anything unless a
browser asks it to** (§13.5). That is an architectural fact about the app, not a limitation
of the integration.

### 13.1 The one property that makes this tractable

**A schedule's entire mutable state is one date.** `nextMaintenanceDue()` is
`lastPerformed + frequencyDays`; `maintenanceStatusOf()` reads nothing else. `task`,
`frequencyLabel`, `frequencyDays` and `owner` are edited by hand in the app and are not
things a completion touches.

So the sync surface is **one date per schedule** — not a record with fields that can each
change on either side. That is what keeps this from being the sync engine §2 refuses, and
it is the reason this is worth considering at all.

### 13.2 Push: one open one-shot task per schedule — never a Todoist recurring task

**The trap to avoid first.** The obvious move is a Todoist *recurring* task
(`due_string: "every 30 days"`). It is wrong, and it is wrong in a way that only shows up
weeks later: **Todoist advances its own due date on completion**, so the app computes
next-due from `lastPerformed + frequencyDays` and Todoist computes it from its recurrence
rule. They agree until the first completion logged late, the first manual reschedule, or
the first frequency change in the app — and then there are two answers to "when is this
due" with no way to say which is right. Two schedulers is the failure; recurrence is how
you get one by accident.

**The rule: Todoist holds at most ONE OPEN TASK per schedule, and it is a plain dated
one-shot. Todoist never computes a date.** When a completion is recorded, the app sets
`lastPerformed`, derives the next due date, and creates the *next* one-shot. This is
exactly the shape the app already uses internally — store the completion, derive the due
date — projected onto Todoist.

What the task carries:

| | |
|---|---|
| `content` | `Monthly filter clean — Room 104 Mini Split` |
| `due_date` | The app's computed next-due |
| `labels` | One marker label, so the app's read filter can find them and so §12.5's write-up tasks stay distinguishable |
| `description` | The app deep link, plus the **schedule id** — the join key, same convention as §4 |
| `priority` | Optional, from `maintenanceStatusOf()` — overdue → p1. Cheap, and it makes Todoist's own sorting useful |

Three details that are not obvious:

- **Nothing new is stored on the app side.** The reconciler already fetches the project's
  open tasks for the display in §8, so "which task belongs to this schedule" is answered by
  parsing the schedule id out of descriptions **in memory** — no `todoistTaskId` column, and
  no reliance on Todoist's `search:` semantics matching description text.
- **A schedule that has never been performed has no computable due date** — that is what
  `"never"` means. Create the task with **no due date** rather than inventing one: it sits
  in the project waiting to be dated, which mirrors the app pinning those to the top of
  Scheduled. A faked due date would make an unknown look like a commitment.
- **Never `close` a task to cancel it — `DELETE` it.** Both endpoints exist
  (`POST /tasks/{id}/close`, `DELETE /tasks/{id}`, both verified). A *closed* task is
  indistinguishable from a completion to the poller in §13.4, so cancelling a stale
  occurrence by closing it would write a **false `lastPerformed`** and silently push the
  next service out by a full interval. This is the single easiest way to corrupt data in
  this whole design.

The reconciler is then small and idempotent: for each schedule, ensure exactly one open
task with the right content; delete open tasks whose schedule no longer exists.

### 13.3 The reschedule conflict — the one genuine UX collision

Someone drags the task to next week in Todoist. What should happen?

A strict reconciler snaps it back to the app's date, which reads as the integration
fighting the user — the worst possible impression, and unfixable from inside Todoist.
Three resolutions:

| | |
|---|---|
| **(a) App wins, snap back** | Correct by the ownership rule, and feels broken |
| **(b) Todoist wins** | Needs a stored "deferred until" on the schedule — a new column, a backend release, and a second date competing with `lastPerformed + frequencyDays` |
| **(c) Set the date at creation and never re-date an open task** *(recommended)* | A manual reschedule sticks. The app simply does not know about it |

**(c) is the cheap and honest one.** The app only ever *creates* and *deletes* tasks; it
never edits a date it has already written. The consequence, which has to be said out loud
rather than discovered: **the app's next-due and Todoist's date can disagree, and the
overdue badge uses the app's.** A task deferred in Todoist still reads overdue in the app.
That is the correct reading — deferring is not doing — but it will look like a bug to
anyone who does not know the rule.

### 13.4 Pull: getting the completion date back

`GET /tasks/completed/by_completion_date` — **requires `since` and `until`** (verified by
the API's own missing-argument error), and **accepts `project_id` and `filter_query`** for
scoping (verified: a junk `project_id` is rejected as a malformed id rather than as an
unknown parameter). Read the schedule id out of each completed task's description, set
`lastPerformed` to the completion date.

- **Idempotency is free, and this is the nicest property in the design.** `lastPerformed`
  **is** the applied-marker: if it is already on or after the completion date, the
  completion has been applied and is skipped. No cursor, no stored sync state, nothing new
  in the Sheet — and it converges no matter how many times it runs or in which order.
- **The date is when it was TICKED, not when the work happened.** Same limitation the app's
  own completion default has, and editable afterwards for the same reason. Do not dress it
  up as more than it is.
- **A completion should write `lastPerformed` and nothing else.** Whether it also becomes a
  cost-bearing work-history entry is §7's separate prompt — the app's own convention is
  that a change entry is a deliberate act with a vendor and a cost, and a checkbox tapped
  on a phone is not that.

### 13.5 The actual hard part: this app has no server-side writer

Every write in this app is a browser posting the whole snapshot through `doPost` with a
session. There is no component that writes on its own. So "how does the date get updated"
has three possible answers, and choosing among them is the real decision:

**A — On page load, in the browser.** *(cheapest, no new machinery)* The app polls Todoist
during load, applies any completions, and `persist()`s.

- **What it costs:** nothing moves until someone opens the app. The overdue badge stays
  wrong until then — and the *push* direction has the same dependency, so a newly-due
  schedule does not appear in Todoist until someone loads the page either. For a one-person
  IT shop who opens the app regularly this may genuinely be enough, and it self-corrects at
  exactly the moment anyone looks.
- **Two hazards to respect:** this would be the app's **first automatic `persist()` on
  load**, which it has never done — and two browsers loading at once both compute the same
  completion, so the second one's write is rejected and a user gets the blocking "your
  change wasn't saved" modal **for a change they never made**. So: write only when
  something actually changed, and treat a conflict on this path as "reload and drop it"
  rather than as a user-facing failure.

**B — A time-driven Apps Script trigger.** *(hourly; correct while nobody is looking)* Both
directions run unattended.

- **This is the app's first unattended writer, and that is a bigger step than the Todoist
  work itself.** It must take the same `LockService` lock as `doPost`, and it must **bump
  `rev_assets`** so a browser left open does not overwrite what it just wrote — the exact
  discipline `sheet.mjs` documents and calls "not optional".
- It also writes **with no session behind it**, in a file where every write rule hangs off
  `authorizeSession_`. That needs a deliberate decision about what "who did this" means on
  the resulting audit rows.
- **Quota is not the constraint.** Consumer accounts get ~90 minutes of trigger runtime per
  day, 6 minutes per execution, up to 20 triggers per script; intervals go down to a minute
  (imprecisely). An hourly poll of one project is seconds.

**C — Webhook.** Instant, and **strictly worse than B unless instant matters**: it is still
a server-side write, so it inherits every concern in B, *and* adds Option D's OAuth app and
anonymous `doPost` branch on top.

**Recommendation: A to prove the whole loop works, B if being correct between visits turns
out to matter.** The good news is that A and B share all the logic — the same reconcile
function, called from a different place — so starting with A does not throw work away.

### 13.6 What stays broken, stated plainly

- **`owner` cannot become a Todoist assignee.** It is freeform text; an assignee is a
  collaborator id. Mapping them is the same unsolved question as §5's multi-user problem,
  so leave assignment out.
- **There is a gap after every completion**: the next occurrence's task does not exist until
  the next writer pass — under an hour with a trigger, "until someone opens the app"
  without one.
- **Todoist becomes a place a schedule APPEARS, not a place it can be EDITED.** Frequency,
  task name and owner still change in the app only. Editing the task's text in Todoist
  changes nothing and will be silently reverted the next time the task is recreated —
  which is a reasonable rule and a surprising one.
- **Deleting the marker label or moving the task out of the project** takes it out of
  the reconciler's view, so the app will create a second one. Same class of fragility as
  §4's editable description, and the same acceptable failure direction: a duplicate task,
  not lost data.

### 13.7 Recommendation

**Viable, and it is the second-biggest thing in this document after the account question.**
The design that works is narrow and worth stating in one sentence: *the app owns the
schedule and every date; Todoist holds one dated one-shot task per schedule as a view;
completion flows back as a single date whose own value makes the operation idempotent.*

Do it **after** Options B and C are working, not with them. It needs the read token, the
write op, the project convention and the description-parsing that those already build — and
it is the only part of this evaluation that asks the app to grow a writer of its own.
