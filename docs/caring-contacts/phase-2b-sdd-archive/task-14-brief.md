# Task 14 brief — contact and delivery exception, and this group's overlays

**Plan:** `docs/superpowers/plans/2026-08-24-caring-contact-phase-2b-screens.md`, Group 2, Task 14.
**The standing discipline applies in full** —
`docs/caring-contacts/phase-2b-sdd-archive/STANDING-DISCIPLINE.md`. Read it once; it replaces the
verification boilerplate earlier briefs carried inline, and every rule in it is named with the defect
that bought it.

**Do not touch `docs/caring-contacts/phase-2b-build-record.md`** — the controller owns it and it is the
one file guaranteed to conflict. Other implementers are live in other worktrees on other branches.

Caring Contacts is a suicide-prevention prototype. Every patient is fictional and **nothing is ever
sent to any number**. Task 12 built the schedule read and Task 13 built the Schedule screen, both on this
branch, both through three fix rounds. **Read `task-13-report.md` first** — its seams section names what it
left you, and its seam 2 was corrected in place after a review, so read the corrected version.

## The finding you inherit, and it is the whole shape of the task

**Task 10 established that no per-attempt record exists in the domain**, while the frozen matrix row's own
copy speaks of _"all three attempts"_. So the approved design describes a delivery history this system
does not store.

**You do not invent it.** This is the fifth instance of a pattern already recorded four times — the design
is a coherent picture of a **later, integrated product**, and it cannot tell you which fields exist today.
**Where the design and the types disagree, the types win, and the disagreement is worth recording rather
than silently resolving.**

So: render what a contact's record actually holds, say plainly what is not recorded, and **do not draft a
sentence implying attempts were counted.** If you conclude a per-attempt record is genuinely required for
the screen to be honest, **stop and report it** — that is a repository contract change with its own
review, not something to fit in here.

## The overlays you wire, and the one type change that should come first

You own **`resolve-failed-delivery`**, **`adjust-date-time`** and **`outside-window-warning`**. Task 10
wired `delivery-detail` on another branch; Task 11 owns Group 1's; Task 20 sweeps the remainder.

**Ruling [130] — do this before wiring anything.** `WORKSPACE_OVERLAY_DEFINITIONS` is annotated
`readonly WorkspaceOverlayDefinition[]` with `id: string`, which **erases the literals**. Narrow `id` to a
literal union so a non-mutating overlay's trigger can take a derived `NonMutatingOverlayId` and **wrong
wiring becomes a compile error** — the standard Ruling [87] set. Task 10 resolved the same hole with a
runtime throw and recorded that the type should carry it instead; keep any throw as belt-and-braces, not
as the only guard.

`definitions.ts` is shared with live branches. Expect a conflict there and leave it to the controller.

**Every one of your three overlays mutates**, and the matrix requires that mutation-bearing actions
**recheck connectivity, permission, authentication and version state at commit time.** Not at open time —
at commit. A coordinator can open a confirmation and sit on it.

**The feedback contract, verbatim from the matrix**, applies to each:

- **Success** announces the synthetic in-memory outcome and updates the visible plan/audit summary.
- **No change** states explicitly that **no external or production action occurred.**
- **Guard rejection** retains the surface, keeps the action focusable with `aria-disabled`, gives the
  **named** reason, and **does not mutate**.
- **Recovery** clears the scenario only after its recovery action succeeds.
- **Modal close** restores focus to the originating action; overlay-only navigation must not move focus to
  the page heading.

## `outside-window-warning`, and a corrected ruling you must not re-derive

**Ruling [126] was corrected and the correction is the part that matters.** A contact outside the three
named sending windows is named **by its time**, never as "moved". A deliberate move is the only way to
produce an off-window time, but the **converse is false** — a contact moved onto an approved hour lands
silently inside a named window, because nothing in `PlanRecord` records that a move happened.
`outsideApprovedWindows` means _"not at an approved send time"_ and nothing more.

Task 13 also had to correct a **second** overclaim one sentence below the first: it said such contacts
_"sit inside the approved 9:00 am to 6:00 pm AWST window"_, and `sendingPreferenceAt` **never tests that
bound at all** — it returns `null` for any instant that is not exactly one of the three send hours at
minute 0. Your warning overlay is the natural place to make the same mistake a third time. **Say only what
the code guarantees.**

## Vocabulary, which this screen is the likeliest in the workspace to break

- **`Delivered` is a transport receipt and never a patient-state label.** The closed vocabulary is frozen:
  high risk, safe, engagement score, campaign, lead, conversion, best match, inbox, conversation, clinical
  risk, risk score, wellbeing score, and any claim that replies are monitored. **The scan checks bare
  identifiers too.**
- **A named exception** is Task 12's definition — four non-delivery provider outcomes plus `missed`, by an
  exhaustive switch so nothing can default in. **It says itself that which five is a judgement, not a rule
  the domain held.** If rendering surfaces a case those five do not cover, that is a finding.
- **You may not draft any patient-visible wording, ever.** `EXACT_PATIENT_VISIBLE_MESSAGE` is a
  **specimen, not a template** (Ruling [127]) — one approved example at 252 septets against a hard
  two-segment ceiling with no room left. If this screen shows message text it is **the approved example
  message for that pathway version**, never "this patient's message".
- **Never render a raw role identifier to a clinician.** The vocabulary scan currently _rewards_ leaving
  identifiers on screen — it refuses "lead" as a whole word but passes `clinicalProgrammeLead` on a
  missing word boundary. That inversion is filed; do not exploit it.

## Constraints

- Nothing under `src/lib/caring-contacts/` may import from `@/components`, `@/app`, any `@/lib` module
  outside itself, Supabase or OpenAI. **A screen must never re-derive a rule a module owns.**
- **The service-state incident `note` must never cross into a Client Component.** A test asserts this.
- Every `<button>` does something. A control unavailable for a **stated reason** uses
  `aria-disabled="true"` + an inert handler + `title="… — coming soon"` + an `sr-only` note; native
  `disabled` is for **transient** inertness only, and never both on one control.
- Internal navigation via `<Link>` / `router.push`, hrefs from `src/lib/caring-contacts-routes.ts`, never
  a path literal — **including in tests**.
- **Nothing about a patient may travel in a query string** (Ruling [111]) — and note `overlayUrl()` copies
  every existing parameter into each history entry it pushes, so anything reaching the address is
  multiplied. A fix for that is in flight on the trunk; do not add to the problem.
- Design tokens only, no hex. Tap targets `min-h-12` (48px), **never `min-h-11`**, on the element
  **containing** the control.
- **Do not restate a count in prose** (Ruling [94]). The test: is the thing the number counts visible in
  the same view as the number?
- **This is Next.js 16.** Read `node_modules/next/dist/docs/` before writing boundary code.

## Verification

**The standing discipline governs.** Write these first:

- **A guard rejection does not mutate.** Assert the refusal is shown, named, focusable — **and that the
  record is unchanged**. That last clause is the one nobody writes.
- **A commit-time recheck actually rechecks.** Open the overlay in a permitted state, change the state,
  then commit, and assert the refusal. An overlay that only checks at open time passes a naive test.
- **"No change" says no external action occurred**, distinguishably from success.
- Forced-colors and 320px.

**"Could this possibly go red?" for every assertion.** Give every absence a positive control; assert where
the property is **load-bearing**, not where convenient. Three tasks this session shipped instances of that
family _after naming it_.

Gates: **`npm run test:cc-guards` only**, plus typecheck, **uncached** lint, and `prettier --check` with
the line pasted — formatting is in none of the other three. **Re-verify after your final edit.** If you use
the branch's mutation driver, keep **both** its guards and their positive controls (`CTRL_NOOP`,
`CTRL_ABSENT`), and validate every row against an allowlist of files this task may mutate **before any file
I/O**, asserting id uniqueness.

**Contention is severe** — four implementers plus another project share the lease, and one round here saw
eight consecutive refusals. **A lock refusal is neither a pass nor a failure**: record it UNRUN, retry,
never force.

This touches `tests/ui-caring-contacts-workspace.spec.ts` — say what you think it needs; I run that gate.

## Report

**Commit early — before waiting on any gate.**
Write your full report to `docs/caring-contacts/phase-2b-sdd-archive/task-14-report.md`, then return
ONLY: status, commit SHAs, a one-line test summary, and your concerns. Do not dispatch subagents. **Do not
push and do not open a pull request.**
