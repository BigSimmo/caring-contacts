# Task 13 brief — the Schedule screen

**Plan:** `docs/superpowers/plans/2026-08-24-caring-contact-phase-2b-screens.md`, Group 2, Task 13.
**The standing discipline applies in full** —
`docs/caring-contacts/phase-2b-sdd-archive/STANDING-DISCIPLINE.md`. Read it once; it replaces the
verification boilerplate earlier briefs carried inline, and every rule in it is named with the defect
that bought it.

**Do not touch `docs/caring-contacts/phase-2b-build-record.md`** — the controller owns it and it is the
one file guaranteed to conflict. Other implementers are live in other worktrees on other branches.

Caring Contacts is a suicide-prevention prototype. Every patient is fictional and **nothing is ever
sent to any number**. Task 12 built the **read** behind "what is due"; you are building the screen on
top of it. Read `docs/caring-contacts/phase-2b-sdd-archive/task-12-report.md` first — it says exactly
what it left you and in what shape.

## What already exists, so you do not rebuild it

- **The derivation**, in the sealed domain's `schedule-view.ts`. It groups by the three sending windows,
  classifies non-delivery, and owns the arithmetic. **Do not re-derive any of it on the screen.**
- **`GET /api/caring-contacts/schedule`**, with its own `contactSchedule` access-object type and a pin
  keeping the access-trail route's `z.enum` in sync with the union.
- **The window-to-hour mapping**, owned by `schedule.ts`. AWST is UTC+8 with no daylight saving.
- **`contactSendability()`** in `model.ts`, which classifies suppressed, cancelled, missed and sendable.
  It exists because a screen once told a coordinator a **stopped plan would still send**.

## The route, and the checklist that comes with it

You are adding a real production page route, `/caring-contacts/schedule`. This repository has a gate for
exactly this and it fails the build:

1. Add the page.
2. **Light up the nav link in the same change.** `src/components/caring-contacts/workspace/shell.tsx`
   already declares `{ id: "schedule", label: "Schedule", icon: CalendarDays, reason: "Contacts due, day
by day." }` **with no `href`** — deliberately. Ruling 89 is written above it: a navigation entry lit
   ahead of its screen points at a page that says "nothing due" whether or not anything is due, which is
   a false statement on a clinical screen. Add `href: CARING_CONTACTS_ROUTES.schedule`.
3. `npm run sitemap:update`.
4. A `docs/codebase-index.md` entry.
5. A reachability assertion — `tests/route-reachability.test.ts` fails on a production page route with no
   inbound nav link.

`shell.tsx` is shared with other live branches; expect a merge conflict there and leave it to the
controller.

## Ruling [126] — the fourth group the design does not have

Task 12 found a real disagreement between the approved design and the types, and refused to resolve it
silently. `moveContactWithinDay` accepts any hour and minute inside the approved window and both stores
persist it, so a contact can sit at **11:30 — an approved send time belonging to no named window.** The
design has three windows and no fourth. Task 12 routed those contacts to `outsideApprovedWindows` rather
than inventing a band, which was right: inventing one would add a sending window to a suicide-prevention
schedule by implementation accident.

**The screen names such a contact by its TIME, not by an act.** It does not invent a fourth window, and
it does not hide the contact among the three. Say that the contact sits at a time none of the named
windows covers, and show the time.

**Ruling [126] originally said to call it "moved", and that was wrong — read why, because the reasoning
is the point.** Task 12's review verified that a deliberate move is indeed the only way to produce an
off-window time. But **the converse is false**: a morning plan's contact moved to 14:00 lands silently
inside the afternoon window, indistinguishable from a contact that was always afternoon, because nothing
in `PlanRecord` records that a move happened. So "moved" would be true of every member of this group and
would silently miss every moved contact that landed on an approved hour. `outsideApprovedWindows` means
**"not at an approved send time"** — it does not mean "moved", and a label that says so overstates what
the system can attest.

If you find you can honestly distinguish a moved contact from an unmoved one, that is a finding worth
reporting — but **do not derive it from the window**, which is the inference that was just corrected.

## The four states that must not collapse into "nothing due"

This is the substance of the task. Each pair below is two different clinical facts that a careless
screen renders identically, and each has already cost this programme something.

1. **A plan with every contact suppressed, against a plan with none.** Same defect `ListEmptyState`
   exists to prevent, one layer down.
2. **A held plan is not an exception — but it is not a quiet day either.** Task 12 reports a draft plan
   whose first contact day has arrived as `held`, and keeping it out of the exceptions panel is
   deliberate and correct: nothing failed, nothing is overdue, the plan was never started.

   **But that state is a real operational failure** — somebody finished a sign-up and never started the
   plan, so a discharged patient is receiving nothing while the record looks complete. It must be
   visible on this screen. Task 12 put `counts.held` and `entry.planHold` on the wire precisely so the
   screen can decide this without a domain change.

3. **`disposition: "nothingDue"` is three different days and you must not render it as one.** It covers
   a day where everything is stopped, a day where everything has already been sent, and a day that is
   entirely exceptions. The disposition alone cannot separate them; `counts` can. **Read `counts`.** A
   screen that renders the disposition and stops will show a draft plan past its first contact day as a
   quiet day — which is the defect in (2), arriving through the back door.
4. **An empty day caused by a filter, against an empty day because nothing is scheduled.** §4.4 requires
   the first to say what would change it and the second to say something different.

## Counts, which are the thing this screen gets wrong

**Everything is derived; nothing is a literal** (Rulings [98] and [119]). A plan sends **nine** caring
contacts rather than ten when the first contact is set to discharge + 7, because the Week 1 contact is
absorbed — and the final entry is a **closing message**, a distinct kind, not one more caring contact.
The mockup's "10-contact schedule" heading is a literal and it is wrong.

## The named-exceptions panel

Task 12 defined a named exception as four non-delivery provider outcomes plus `missed`, by an exhaustive
switch so nothing can default in. **That definition is its judgement, not a rule the domain held** — it
says so itself. Read its report's reasoning before you render the panel, and if rendering it surfaces a
case its five do not cover, that is a finding, not something to squeeze into the nearest bucket.

**`Delivered` is a transport receipt and never a patient-state label.** The closed vocabulary is frozen
and the scan checks bare identifiers too.

## What you are NOT building

- **No overlays.** Task 14 owns `adjust-date-time`, `outside-window-warning` and this group's overlay
  wiring. Name every seam you leave in your report.
- **No change** to `schedule-view.ts`, the window mapping, `contactSendability()`, or the schedule route.
  If the screen needs something the read does not give it, **report that** — do not compute it here. A
  screen that re-derives a rule a module owns is the failure mode this whole architecture exists to stop.

## Constraints

- Nothing under `src/lib/caring-contacts/` may import from `@/components`, `@/app`, any `@/lib` module
  outside itself, Supabase or OpenAI.
- **The service-state incident `note` must never cross into a Client Component.**
- **Patient-visible copy is frozen, and you may not draft any.** If this screen shows message text, it is
  **the approved example message for that pathway version** (Ruling [127]) — `EXACT_PATIENT_VISIBLE_MESSAGE`
  is a specimen, not a template: one approved example, greeting and sender name included, measured at 252
  septets against a hard two-segment ceiling with no room left. Never "this patient's message", and never
  with a name interpolated at render time.
- **Never render a raw role identifier to a clinician.** Role wording lives in the sealed domain and is
  resolved server-side. The vocabulary scan currently _rewards_ leaving identifiers on screen — it refuses
  "lead" as a whole word but passes `clinicalProgrammeLead` on a missing word boundary. That inversion is
  filed; do not exploit it.
- Every `<button>` does something. A control unavailable for a **stated reason** uses `aria-disabled="true"`
  - an inert handler + `title="… — coming soon"` + an `sr-only` note; native `disabled` is for **transient**
    inertness only, and never both on one control.
- Internal navigation via `<Link>` / `router.push`, hrefs from `src/lib/caring-contacts-routes.ts`, never a
  path literal — **including in tests**, once the route exists.
- Design tokens only, no hex. Tap targets `min-h-12` (48px), **never `min-h-11`**, on the element
  **containing** the control — on a wrapper it leaves the row's whitespace dead.
- **One search composer per page**, and the phone-chrome contract in `docs/search-chrome-behaviour.md`
  applies if you touch any chrome. Hidden chrome means **zero** reserve.
- **Do not restate a count in prose** (Ruling [94]). State the invariant.
- **This is Next.js 16.** Read `node_modules/next/dist/docs/` before writing route or boundary code.

## Verification

**The standing discipline governs.** Beyond it:

- **Write the three non-collapsing pairs first.** They are the task, and each assertion must fail if its
  pair collapses — not merely pass when they differ.
- **Test the boundaries of the day, not the middle.** A schedule screen inherits every timezone trap the
  read has: a contact at 17:00 AWST on the last day of a month, and one at 00:00.
- **Do not compare two outputs of one function to each other and call it coverage.** Task 9b's mutation
  falsified exactly that shape: three reads held only against one another stayed green when the mapper
  they share was emptied, because three empty lists agree perfectly. Hold at least one side to expected
  content.
- Forced-colors and 320px, per the group's accessibility requirement.

Gates: `npm run test:cc-guards` only, including for mutations — the full `npm run test` is the
controller's at merge points, because three concurrent worktrees starved the exclusive lease. Then
typecheck and **uncached** lint (`npx eslint <paths>`, or clear `node_modules/.cache/eslint`; the
per-file cache hid two real errors this week). **Paste every `N passed` line; never report a gate from an
exit code.**

**This one almost certainly does touch `tests/ui-caring-contacts-workspace.spec.ts`** — you are adding a
route and lighting a nav link. Say what you think it needs; I run that gate.

## Report

**Commit early — before waiting on any gate.**
Write your full report to `docs/caring-contacts/phase-2b-sdd-archive/task-13-report.md`, then return
ONLY: status, commit SHAs, a one-line test summary, and your concerns. Do not paste the report into your
reply. Do not dispatch subagents. **Do not push and do not open a pull request.**
