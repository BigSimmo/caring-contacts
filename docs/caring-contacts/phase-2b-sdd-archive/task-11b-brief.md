# Task 11b brief — pause, withdrawal and reassignment

**Plan:** `docs/superpowers/plans/2026-08-24-caring-contact-phase-2b-screens.md`, Group 1, Task 11.
**Split by ruling.** Task 11 named eleven overlays of three kinds; Task 11a wires the wizard, inspection
and outcome ones. **You wire the three plan actions**, because they are mutating, two of them two-stage,
and they are the only controls in this workspace that stop a suicide-prevention programme for a person.
They get their own task and their own review for that reason.

**The standing discipline applies in full** — `docs/caring-contacts/phase-2b-sdd-archive/STANDING-DISCIPLINE.md`.

**Do not touch `docs/caring-contacts/phase-2b-build-record.md`.** Other implementers are live elsewhere.

Caring Contacts is a suicide-prevention prototype. Every patient is fictional and **nothing is ever sent
to any number**.

## Read this before you write a word of copy: what pausing ACTUALLY does

**Ruling [129], and it was wrong once before it was right — do not re-derive it, and do not restate it
from memory.**

The domain's behaviour is deliberate and is pinned by a committed contract test:

- **Readmission → the plan pauses, and ZERO contacts are cancelled.** The test is named _"holds without
  cancelling for a readmission"_ and it asserts the full set is still listed. That is correct: cancelling
  a whole suicide-prevention schedule because someone spent a week on a ward would be worse than the
  problem it solved. **Pause is a hold, and the schedule is kept so it can resume.**
- **Death → the plan is cancelled and every contact moves to `cancelled`.**

**And the send gate lives at the write, not in the list.** `contactStatusWrite` takes `requiresActivePlan`;
`startContactDispatch` passes `true`, so any plan that is not `active` is refused with
`contactDispatchRequiresActivePlan`. A paused plan's contacts stay in the sendable _list_ and are refused
at the _write_.

**So the overlay must say what is true and nothing more.** Pausing **holds** the schedule; it does not
delete it; the plan can resume. And because **nothing in this system can send anything** — there is no
telephony provider at all — **no screen may claim that pausing prevented a message from going out.** That
is a claim about a sender that does not exist.

This exact reasoning has already been got wrong twice: once by a screen that told a coordinator a stopped
plan would still send, and once by a report concluding the send rule "lives nowhere". **Read the code, not
the summary.**

## The three, and what each owes

**`pause`** — bottom sheet on phone, dialog on desktop, mutating. Must say it holds rather than cancels,
and must make resuming visibly available.

**`withdrawal`** — **full-screen stage on phone**, dialog on desktop, mutating, **two-stage**. It is
two-stage in the frozen matrix for a reason: it ends a person's participation in a suicide-prevention
programme. Both stages must be real — a second stage that merely repeats the first is theatre. **State
what becomes of the remaining contacts**, derived from what the domain actually does, not assumed.

**`reassignment`** — bottom sheet, mutating, **two-stage**. It changes who is responsible for a patient.
The losing and gaining coordinator both matter; **never render a raw role or actor identifier** — role
wording lives in the sealed domain and is resolved server-side.

## What every one of them owes, from the matrix

**Recheck connectivity, permission, authentication and version state at COMMIT time — not at open time.**
A coordinator can open one of these and sit on it for an hour. Write the test that catches an open-time
check: open in a permitted state, change the state, then commit, and assert the refusal.

**Version state matters most here.** These are the writes most likely to collide with another
coordinator's, and the repository already refuses on an expected-version mismatch. **Surface that refusal
distinguishably** — "someone else changed this plan" is a different fact from "you may not do this", and a
coordinator acting on a suicide-prevention plan needs to know which.

**The feedback contract, verbatim:**

- **Success** announces the synthetic in-memory outcome and updates the visible plan/audit summary.
- **No change** states explicitly that **no external or production action occurred.**
- **Guard rejection** retains the surface, keeps the action focusable with `aria-disabled`, gives the
  **named** reason, and **does not mutate.**
- **Recovery** clears the scenario only after its recovery action succeeds.
- **Modal close** restores focus to the originating action.

**Idempotency is not optional on these three.** Every write route requires a caller-supplied
idempotency key, because only the caller knows whether this is a retry. **Mint the key once when the
confirmation is first opened and reuse it for every retry of that submission.** If you mint a fresh key
per attempt, a coordinator who presses twice after a timeout withdraws a patient twice, or reassigns them
twice. Task 9 has the pattern and the reasoning.

## Do not narrow the overlay id union

Ruling [130] says wrong wiring should be a compile error rather than a runtime throw, and **Task 14 is
making that change on another branch.** Use the existing trigger; the type arrives at merge. All three of
yours mutate, so the non-mutating trigger is not your concern.

## Constraints

- Nothing under `src/lib/caring-contacts/` may import from `@/components`, `@/app`, any `@/lib` module
  outside itself, Supabase or OpenAI. **A screen must never re-derive a rule a module owns** — and the
  rules about what pausing and withdrawing do are owned by the domain.
- **The service-state incident `note` must never cross into a Client Component.** A test asserts this; a
  withdrawal surface is exactly where a stop reason would be tempting to render.
- **The closed transport vocabulary is frozen**: high risk, safe, engagement score, campaign, lead,
  conversion, best match, inbox, conversation, clinical risk, risk score, wellbeing score, and any claim
  that replies are monitored. `Delivered` is a transport receipt, never a patient-state label. **The scan
  checks bare identifiers too.**
- **You may not author any patient-visible wording.** These are clinician-facing surfaces; nothing you
  write here reaches a patient, and nothing you write may imply it does.
- **Nothing about a patient may travel in a query string** (Ruling [111]).
- Every `<button>` does something; never native `disabled` **and** `aria-disabled` on one control. Tap
  targets `min-h-12` on the element **containing** the control, never `min-h-11`.
- Design tokens only, no hex. Internal navigation via `<Link>` / `router.push`, hrefs from the routes
  module, never a path literal — including in tests.
- **Do not restate a count in prose** (Ruling [94]). **This is Next.js 16.**

## Verification

Write these first, and they are the task:

- **A guard rejection does not mutate.** Assert the refusal is shown, named and focusable — **and that the
  plan record is unchanged.** That last clause is the one nobody writes, and on these three it is the one
  that matters.
- **The commit-time recheck actually rechecks**, per the open-change-commit sequence.
- **A repeated submission does not act twice.** Same key, second attempt refused as a replay. Mutate it:
  mint a fresh key per attempt and confirm the case reddens on a **duplicate record**, not on a count.
- **A version collision is distinguishable from a permission refusal.**
- **Pause holds rather than cancels** — assert the contacts survive, from the record, not from the copy.
- Forced-colors and 320px. `withdrawal` is a **full-screen stage on phone**; prove it at 320px.

**"Could this possibly go red?" for every assertion.** Give every absence a positive control; assert where
the property is **load-bearing**, not where convenient. Three tasks this session shipped instances of that
family _after naming it_.

Gates: **`npm run test:cc-guards` only**, plus typecheck, **uncached** lint, and `prettier --check` with the
line pasted. **Re-verify after your final edit.** Reuse the branch's mutation driver and **keep both its
guards and their positive controls**; validate every row against an allowlist **before any file I/O**, and
assert **id uniqueness**. Check every SHA still exists. **Contention is severe** — record every refusal
UNRUN, retry, never force.

This touches `tests/ui-caring-contacts-workspace.spec.ts` — say what you think it needs; I run that gate.

## Report

**Commit early — before waiting on any gate.**
Write your full report to `docs/caring-contacts/phase-2b-sdd-archive/task-11b-report.md`, then return ONLY:
status, commit SHAs, a one-line test summary, and your concerns. Do not dispatch subagents. **Do not push
and do not open a pull request.**
