# Caring Contacts Phase 2B — The Working Screens: Implementation Plan

**Status: DRAFT, not yet approved for execution.** Written 2026-08-24.

**Spec:** `docs/superpowers/specs/2026-08-19-caring-contact-production-build-design.md` — binding.
Every conflict in this plan resolves **against the spec**, not against the mockups and not against
this document.

**Phase 2A is complete and merged** to `main` as `e4cbe8d3a` (#2279). This plan consumes it.

---

## 0. What Phase 2B is, and what Phase 2A actually left

Spec §0 defines Phase 2 as "the working screens". Phase 2A built the foundations underneath them.
Establishing precisely what exists is the whole basis of this plan, so it was measured rather than
assumed (2026-08-24, by direct reading of the tree):

| What exists                                                                           | What that means here                                                              |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **One real route**: `/caring-contacts`, a Server Component with a placeholder body    | Thirteen further destinations are declared in `caring-contacts-routes.ts` and     |
|                                                                                       | rendered as `UnavailableDestination` stubs. They are not links.                   |
| **The shell** — nav rail, phone dock, header, four width states, service-state banner | The extension backbone. A screen becomes real by gaining an `href` in             |
|                                                                                       | `PRIMARY_DESTINATIONS` / `MORE_DESTINATIONS` in `shell.tsx`.                      |
| **24 overlays, fully defined and rendered by one data-driven renderer**               | **Zero of the 24 are wired to a real trigger.** Every one is reachable only by    |
|                                                                                       | typing `?overlay=<id>`. Wiring them to controls is core Phase 2B work.            |
| **11 API routes** on shared `readHandler` / `writeHandler` factories                  | Audit-on-every-read and idempotency-key-on-every-write come free. But there is no |
|                                                                                       | backing route for patients-list, schedule, workload, coverage, team, or           |
|                                                                                       | reconciliation — those must be added.                                             |
| **A sealed domain of ~27 modules and a 38-method repository**, two stores, one shared | The rules are done. A screen must never re-derive a rule a module already owns.   |
| contract                                                                              |                                                                                   |
| **Route-level loading and error states only**                                         | Generic and not data-driven. **No empty-state component exists anywhere.**        |

So Phase 2B is not "add some pages". It is: turn one placeholder route into thirteen working screens,
give twenty-four already-built overlays their triggers, and add the read surfaces four of those screens
need.

### The owner's order, which this plan follows

1. **Patients and their plans**
2. **Schedule and what is due**
3. **Message templates**
4. **Team, workload and coverage**

### Deliberately NOT in Phase 2B

Phase 3 owns the demo clock, the synthetic caseload, training mode, and the bounded clinical-record
summary (spec §0). Guidance and Reports are approved screens but sit outside the owner's four groups;
they are scheduled last, after the four, and may be deferred to Phase 3 without blocking anything.

---

## Global Constraints

Every task's requirements implicitly include this section.

### Absolutely out of scope

- **No message is sent to any number, real or test.** No SMS provider, no adapter beyond a
  deterministic fake.
- **No migration against the Clinical KB Supabase project `sjrfecxgysukkwxsowpy`.** Caring-contact
  migrations live **only** in `caring-contacts/supabase/migrations/`, never in `supabase/migrations/`.
- No hosting change, no hospital system connection, no enterprise sign-on, no real patient data.
- Sign-in stays a **demo role switcher**, never credentials.
- **Do not push, do not open a pull request, and do not run `verify:release` or any provider-backed
  gate** (`eval:*`, `check:supabase-project`, `test:live`) without asking the owner first.

### Patient-visible copy is FROZEN until the owner answers

**SUPERSEDED 2026-08-27 — the freeze was lifted on 2026-08-24 and this section was never updated.**
The owner approved all thirteen decisions that day, and `875c8b604` removed the contradicting freeze
line from the decision record itself. Patient-visible strings are **no longer frozen**; each change
must cite the decision-item number it implements. Two items remain unexecutable: **A9** (adding
Lifeline) is approved in principle and blocked on a real crisis number and on there being no
unallocated room in the message, and **A4** (the closing message) is approved as a **deferral**, its
wording to be written later with a lived-experience representative.

**What still binds, unchanged and absolutely:** no implementer, reviewer or controller may AUTHOR
patient-visible message wording, and every such string lives only in the sealed domain's
`message-copy` module. A screen that hardcodes one is still a defect. Read the paragraph below with
that substitution — **a lifted freeze is not permission to write the words.**

`docs/caring-contacts/copy-decisions-recommended.md` carries thirteen open decisions — nine clinical
or policy, four engineering. **No task in this plan may change a patient-visible string.** Screens
render patient-visible copy by reading the sealed domain's `message-copy` module; a screen that
hardcodes a patient-visible string is a defect even when the string is correct, because it puts the
owner's eventual answer in two places.

Four of the thirteen (B1–B4 in that file) need no clinical input and may proceed once he says go.

### Design non-regression (spec §6) — frozen, may not change without a recorded decision

1. The screen and overlay inventory of spec §4.
2. The 24-row modality and dismissal decisions in `docs/caring-contacts/interaction-matrix.md`.
3. The width-to-state mapping `compact` (320–430) / `rail` (768) / `split` (1024) / `wide` (1440).
4. The closed transport vocabulary and every prohibited clinical term.
5. Token usage: no hardcoded colour, no new colour semantics, no decorative clinical colour.
6. The continuity thread's meaning — elapsed schedule spacing only, never patient, delivery or
   clinical state.

**No existing assertion may be deleted or loosened to accommodate a change.** Any test that goes red
is a defect in the change, not in the test.

### The four design corrections — implement the SPEC, not the mockup

`docs/caring-contacts/phase-2a-visual-differences.md` records four places where the approved mockups
are out of date against later decisions. Each is an **edit to an existing design, not new design**, and
each resolves **to the spec**:

| #   | The mockup shows                                          | The spec requires                                  | Lands in         |
| --- | --------------------------------------------------------- | -------------------------------------------------- | ---------------- |
| 1   | The old first-contact-date control                        | §2.3 — the coordinator sets the first contact date | Group 1, Task 6  |
| 2   | "replies are not received, stored, analysed or monitored" | §2.1 — the automated non-monitored response copy   | Group 3, Task 16 |
| 3   | No distinct closing message type at month 12              | §2.2 — the pathway ends with a closing message     | Groups 1 and 2   |
| 4   | Ten sendable contacts                                     | Phase 1 decision 1 — **nine** sendable contacts    | Groups 1 and 2   |

Corrections 3 and 4 travel together and touch both the activation review and every schedule display.

### Repository contracts that fail the build

- **Button wiring.** Every `<button>` does something. A control unavailable for a stated reason uses
  `aria-disabled="true"` + an inert handler + `title="… — coming soon"` + an `sr-only` note. Never
  native `disabled` and `aria-disabled` together.
- **No orphan routes.** A new production route needs an inbound link from real nav, then
  `npm run sitemap:update`, a `docs/codebase-index.md` entry, and a reachability assertion.
- **Internal navigation** uses `<Link>` / `router.push` / server `redirect()`. Never a raw `<a href>`.
- **One search composer per page.**
- **Tap targets are `min-h-12` (48px).** Do NOT "fix" them to `min-h-11` — that reintroduces a known
  `ui-smoke` flake.
- **Design tokens, not hex.**

### Domain isolation, and the one constraint that has already caused a CRITICAL

- Nothing under `src/lib/caring-contacts/` may import from `@/components`, `@/app`, any `@/lib` module
  outside itself, Supabase, or OpenAI.
- Production code may **never** import from `src/components/caring-contacts/mockups/`. Those pages are
  fixture-only, 404 in production, and are read in this plan as a **specification**, never copied.
- **The service-state incident `note` must never reach a Client Component.** Enforced by type
  narrowing (`ServiceStopBannerFacts`), a separate anchors module, and a source-scanning test.
- **`getEpisode` is the only read that releases `patientDetail`** — name, mobile, identifiers, cultural
  identity. Every other read returns `PlanRecord`, which excludes it. A screen that needs a patient's
  name must justify it; a list screen almost never does.
- The whole-branch review's CRITICAL finding was patient data reaching a table nobody had classified as
  holding it. **Ask what a mechanism stores incidentally, not only what it is for.**

### Verification discipline

- **Test-first, always.** Write the failing test, run it, watch it fail for the stated reason, then
  implement.
- **After each task, deliberately break the implementation and confirm the covering test goes red** —
  and check FIRST that the mutation changes a value some assertion actually reads. Four tests across
  this programme have been found unable to fail at all.
- **A mutation proof has two results, not one.** Prove the mutation is in the tree before believing
  anything the gate says about it: assert the anchor is unique, assert the replacement is present, and
  print the diff into the same log as the gate output. On 2026-08-24 a mutation silently failed to
  apply and its gate reported `32 passed`, exit 0 — a real, green, strongest-looking run supporting
  exactly the wrong conclusion.
- **Never report a gate as passing from an exit code alone.** Paste the `N passed` line. Never pipe a
  gate through `tail`. Never invoke `npx playwright test` — the repo refuses it with an `Error:` line
  and **exit code 0**, so it reads as a pass having run nothing. Use
  `npm run test:e2e -- <spec> --project=chromium`.
- Smallest gate first: `npm run test:focused -- --files <paths>`; `npm run test` whenever test
  infrastructure or deleted files are involved; `npm run lint`; `npm run typecheck`;
  `npm run caring-contacts:db:test` for migrations; `npm run verify:phone-chrome` for phone chrome;
  `npm run verify:pr-local` only at the end.
- **Run `npm run format` and commit the result** before any handoff.

### Explained automation (spec §4.4) — a contract, not a preference

Wherever the system has acted on its own — paused, skipped, suppressed, blocked, escalated — the
surface stating that state must also state, in plain words and in place, **why** and **what would
change it**. No bare status chip without a reachable reason. **Asserted in DOM tests for every
automated state.** This binds every task in this plan.

---

## Rulings taken in writing this plan

Recorded here rather than in the build record because they bind the plan itself.

**Ruling [68] — Phase 2B opens with a shared-scaffolding group, before the owner's group 1.**
_Why:_ all four groups need the same three things that do not exist — an empty-state component, a
list-read API pattern, and a way to wire an overlay to a trigger. Built inside group 1 they would be
shaped by patients alone and then bent twice; built three times they would diverge. Group 0 is small
and every task in it is consumed by at least three later tasks. _Cost if wrong:_ the owner sees
nothing recognisable for one group's worth of work. Mitigated by keeping Group 0 to four tasks and by
Task 4 delivering a visibly working Patients link at its end.

**Ruling [69] — Overlay wiring travels with the screen that owns the trigger, never as one batch task.**
_Why:_ `interaction-matrix.md` already assigns every overlay to a route. A single "wire 24 overlays"
task would touch every screen in the plan, could not be reviewed against any one screen's spec, and
would collide with whichever screen task was in flight. _Cost if wrong:_ the same overlay-wiring
pattern is written into several tasks and may drift; Group 0 Task 3 exists to make the pattern shared
so that drift is a review finding rather than an inevitability.

**Ruling [70] — Screens read patient-visible copy from the sealed domain, never inline it.**
_Why:_ thirteen copy decisions are open and the owner's answers must land in ONE place. _Cost if
wrong:_ a small indirection cost on strings that may never change. Cheap against re-auditing thirteen
screens.

**Ruling [71] — Where a mockup and the spec disagree, implement the spec and record the difference.**
_Why:_ spec §6 freezes the design, but the four differences in `phase-2a-visual-differences.md` are
places where the design predates a later decision. The spec is the binding authority. _Cost if wrong:_
the built screen no longer matches the atlas image, so the visual-regression evidence for that screen
must be recaptured. That is stated per task rather than discovered at review.

**Ruling [72] — "Workload and coverage" is scoped to the approved roster table for Phase 2B.**
_Why:_ the approved design for group 4 is a flat ownership table with active-plans, unclaimed-work and
escalation columns, plus a mobile roster. It has no capacity chart, no coverage calendar, no per-member
detail. Anything beyond the table is **design work from nothing**, and design is not an implementation
plan's job. _Cost if wrong:_ if the owner's ambition for group 4 is larger, Phase 2B delivers less than
he expected for it. **This is the single most likely place this plan under-delivers, so it is flagged
to him explicitly rather than settled here.**

---

## File structure

```
src/app/caring-contacts/
  page.tsx                         Today — exists, currently a placeholder body
  patients/page.tsx                NEW  Group 1
  patients/[patientId]/page.tsx    NEW  Group 1
  plans/new/page.tsx               NEW  Group 1 — the four-stage activation
  plans/[planId]/page.tsx          NEW  Group 1
  schedule/page.tsx                NEW  Group 2
  contacts/[contactId]/page.tsx    NEW  Group 2
  templates/page.tsx               NEW  Group 3
  templates/[pathwayId]/page.tsx   NEW  Group 3
  team/page.tsx                    NEW  Group 4

src/app/api/caring-contacts/
  patients/route.ts                NEW  Group 0/1
  schedule/route.ts                NEW  Group 2
  team/route.ts                    NEW  Group 4

src/components/caring-contacts/workspace/
  shell.tsx                        EDIT — destinations gain hrefs as screens land
  empty-state.tsx                  NEW  Group 0
  overlay-trigger.tsx              NEW  Group 0
  patients/…  schedule/…  templates/…  team/…    NEW per group
```

---

## Task C — The owner's approved copy changes (batched, ahead of Group 0)

Approved 2026-08-24; see `docs/caring-contacts/copy-decisions-recommended.md` for each item's
reasoning. Six edits, two modules, one dispatch (Ruling 76). **Every change cites its item number and
carries its own covering test.**

| Item | Change                                                                                        | Module              |
| ---- | --------------------------------------------------------------------------------------------- | ------------------- |
| A1   | Refuse any governed message whose text still contains "Fictional"                             | `message-policy.ts` |
| A2   | Narrow the storage promise in the automated reply to who is not reading                       | `message-copy.ts`   |
| A3   | Say nobody reads it AND that something automatic comes back                                   | `message-copy.ts`   |
| A4   | Refuse loudly when a final message is required but has no body — **refusal only, no wording** | `message-policy.ts` |
| B2   | Narrow the "lead" prohibition to the commercial sense                                         | `message-policy.ts` |
| B3   | Extend the prohibited-word scan to interface strings                                          | new static test     |

**A9 is deliberately NOT in this task** — approved in principle, blocked on a real crisis number
existing. See Ruling 77. Do not add Lifeline by deleting some other sentence.

**The length ceiling is the trap here.** Message A is 252 septets against a **306-septet** two-segment
ceiling. ~~roughly nine characters from rejection~~ — **CORRECTED 2026-08-27**: it is 54 septets from
rejection, and all 54 are allocated to the preferred-name slot, so the room for new fixed wording is
zero. A2 and A3 both change the reply message (Message B), which has more room, but any edit must
re-run the segment count and assert it, not assume it — which is exactly what the wrong figure above
was produced by not doing.

---

## Group 0 — Shared scaffolding (4 tasks)

**Task 1 — The empty-state component.** One component, used by every list screen. Renders a heading, a
plain-words explanation, and at most one action. Must satisfy §4.4: an empty list caused by a filter
says so and says what would change it; an empty list caused by there being no data says something
different. Tests: both cases, plus forced-colors and 320px.

**Task 2 — CUT (Ruling 84).** `readHandler` already IS the list-read pattern: eight routes use it and
four share the `COLLECTION = "all"` objectId convention. What survives is one requirement moved into
the first list route's brief — a contract test pinning that **an empty list is 200 with an empty
array, never a 404**, because `auditedRead` maps a null release to `denied` / `not-found` and an empty
array must never be mistaken for that.

**Task 3 — The overlay trigger AND the commit contract (Ruling 87).** `openWorkspaceOverlay(id)`
already exists, is exported, and is DOM-tested — this task does not rebuild it. It delivers the small
Client Component a Server Component screen renders to call it, **and** the commit contract, together.
The trigger must **require** a commit handler, never default it to a no-op: `WorkspaceOverlays`'
`commit` currently closes and records nothing, which is safe only while no screen can open an overlay.
Making them reachable without that requirement would ship confirm buttons that advertise an action the
system does not perform — the exact defect the button-wiring gate forbids. Where an action genuinely is
not built, the caller passes an explicit unavailable handler in `unavailable-destination.tsx`'s shape.
Contract tests: a trigger for a nonexistent overlay id fails loudly; a screen cannot compile if it
opens an overlay without supplying a commit handler.

**Task 4 — MERGED INTO TASK 5 (Ruling 89).** As written it would ship a page rendering the empty state
before Task 5 supplies data — i.e. a caseload screen saying "No patients yet" whether or not patients
exist. That is the exact defect Task 1's component was built to prevent, and the orphan-route gate
would have forced an inbound link at the same moment, making the false state reachable rather than
merely present. Its real deliverables — the `href` in `PRIMARY_DESTINATIONS`, `npm run sitemap:update`,
the `docs/codebase-index.md` entry and the reachability assertion — travel with Task 5.

**Checkpoint 0:** `npm run test`, `npm run typecheck`, `npm run lint`, and the caring-contacts browser
gate all green. The Patients link navigates.

---

## Group 1 — Patients and their plans (owner's first priority, 7 tasks)

Approved design covers every screen here; nothing needs designing from nothing.

- **Task 5 — Patients directory.** List, filter, empty state. **No new API (Ruling 85):**
  `GET /api/caring-contacts/plans` already lists the team's plans through `readHandler`. The
  `patientDirectory` access-object-type is NOT an unwired gap — the referrals route already uses it,
  for patients who may not yet have a plan. Carries Task 2's surviving empty-list contract test.
  Reads `listPlans`, **not** `getEpisode` —
  a directory does not need patient identifiers, and taking them would widen the data released to a
  list screen. If the approved design shows a name in the list, that is a difference to record and put
  to the owner, not a reason to call `getEpisode` per row.
- **Task 6 — Patient overview.** The one screen that legitimately reads `getEpisode`. Carries design
  correction #1 (first-contact-date control, spec §2.3) — which is a **screen** change only:
  `schedule.ts` already takes and validates `firstContactDate`, and the plans POST schema already
  accepts it and `firstContactReason` (Ruling 86). Do not build a second path.
- **Tasks 7–9 — The four-stage activation** (agreement → pathway → personalisation → review), one task
  per one-to-two stages. Carries corrections #3 and #4: a distinct closing message type at month 12 and
  **nine** sendable contacts, not ten.
- **Task 10 — Plan and contact detail**, including the delivery-exception drawer's inbound path.
- **Task 11 — Overlay wiring for this group**, per `interaction-matrix.md`'s route column.

**Checkpoint 1:** all group-1 screens reachable, browser gate green at all six widths, every automated
state carrying its §4.4 explanation.

---

## Group 2 — Schedule and what is due (3 tasks)

- **Task 12 — The schedule read API**, on Group 0 Task 2's pattern.
- **Task 13 — The Schedule screen**: day grid, three sending windows, named-exceptions panel. Same
  nine-contacts and closing-message corrections.
- **Task 14 — Contact / delivery exception**: delivery attempts and the same-day task drawer. The
  closed transport vocabulary is frozen — `Delivered` is a transport receipt and never a patient-state
  label. Plus this group's overlay wiring.

**Checkpoint 2.**

---

## Group 3 — Message templates (2 tasks)

The pathway-versions API already exists, so the GOVERNANCE half of this group is the lightest in the
plan. **The content half is not, and the difference was nearly missed.**

> **The gap, found while writing this plan and not previously recorded.** The pathway-version lifecycle
> — draft, review, dual approval, publish, retire, immutable snapshot — is fully built and API-wired.
> But **the actual patient-visible message text is a single hard-coded provisional constant, not
> per-version snapshot content.** The database column reserved to hold approved message content is
> empty and no row exists anywhere. So a "template library" can today show version records, approvers
> and lifecycle state, and **cannot show a different message per version, because there is only one
> message.**
>
> This is the same fact `copy-review.md` §1.3 states from the copy side ("there is no library of
> message templates … one message exists, hard-written, for one fictional patient"), and it is worth
> noting that two independent readings — one of the copy, one of the storage — had to be put side by
> side before the consequence for this group's screens became visible.
>
> **Consequence for the plan:** Task 16 must not render a per-version message body it does not have. It
> shows the governance record truthfully and states plainly that message content is not yet authored —
> which is precisely copy-review item B1's rule ("a true statement about a smaller product beats a
> false one about a larger one"). Authoring real per-version content is a separate piece of work
> needing the owner and a lived-experience representative; it is **not** in this plan.

- **Task 15 — Templates library** (`/templates`) with all three lifecycle states: Current, Retired,
  Pending.
- **Task 16 — Template detail** (`/templates/[pathwayId]`), the message-preview surface, dual approval,
  and this group's overlays. **Carries design correction #2** — the reply-handling copy is superseded by
  spec §2.1. Note this is patient-visible copy: implement the spec's wording, and if the owner's copy
  decisions A2/A3 land first, they win.

**Checkpoint 3.**

---

## Group 4 — Team, workload and coverage (2 tasks)

**Read Ruling 72 before starting.** The approved design is a roster table and nothing more.

- **Task 17 — The team read API**: active plans per coordinator, unclaimed work against the 60-minute
  escalation, exception backlog age. **Operational only; never ranks clinicians** (spec §4.2).
  Per-plan assignment and coverage are real and already API-wired, but **no aggregate "plans per
  coordinator" read exists anywhere** — this task builds it by rolling up `listPlans` and
  `getAssignment`. Decide deliberately whether that roll-up belongs in the sealed domain or in the API
  layer, and record the reason: it is an aggregation over existing rules, not a new rule, so the
  domain-isolation constraint does not settle it by itself.
- **Task 18 — The Team screen**: desktop ownership table, mobile roster, unclaimed chip, and the
  "Reassign work" control wired to the reassignment overlay.

**Checkpoint 4.**

---

## Group 5 — The remainder, and closing proof (3 tasks)

- **Task 19 — Guidance and Reports. COMMITTED to this phase** — the owner answered on 2026-08-24 that
  he wants them built here, reversing Ruling 75, which had deferred them. Both already have approved
  designs. Reports carries the §2.5 equity reach section with small-cell suppression.
- **Task 20 — Every remaining overlay trigger**, reconciled against all 24 rows of the frozen matrix.
  A row with no trigger at the end of this task is a defect or a recorded exception, never silence.
- **Task 21 — Full responsive and accessibility proof**, 320px to 1440px, dark mode, forced colours,
  reduced motion, 400% reflow — per spec §0's Phase 2 definition.

---

## Verification plan

| Gate                                                                                | When                                               |
| ----------------------------------------------------------------------------------- | -------------------------------------------------- |
| `npm run test:focused -- --files <paths>`                                           | During each task                                   |
| `npm run test`                                                                      | Before completing any task that adds or renames an |
|                                                                                     | exported symbol under `src/lib/caring-contacts/`   |
| `npm run typecheck`, `npm run lint`                                                 | Each task                                          |
| `npm run test:e2e -- tests/ui-caring-contacts-workspace.spec.ts --project=chromium` | Each checkpoint                                    |
| `npm run verify:phone-chrome`                                                       | Any task touching phone chrome                     |
| `npm run caring-contacts:db:test`                                                   | Any task touching the schema                       |
| `npm run verify:pr-local`                                                           | End of plan only                                   |

**Known trap:** the caring-contacts browser gate builds and serves a **production** app, and the
Caring Contacts routes fail closed in production. They open only when **both**
`PLAYWRIGHT_OFFLINE_MODE` and `NEXT_PUBLIC_DEMO_MODE` are exactly `"true"` — the exception the owner
approved on 2026-08-23. Four "the production lock" tests pin it. Do not widen it.

---

## What this plan needs before execution starts

1. **The owner's answer on Ruling 72** — is "workload and coverage" the approved roster table, or more?
   This is the one place the plan is most likely to under-deliver.
2. **The four engineering copy items (B1–B4)** can proceed on his word alone.
3. **The nine clinical copy items (A1–A9)** block only patient-visible strings, not the screens. Group
   3 Task 16 is the first task that genuinely wants them answered.
4. A decision on whether **Guidance and Reports** (Task 19) are Phase 2B or Phase 3.
