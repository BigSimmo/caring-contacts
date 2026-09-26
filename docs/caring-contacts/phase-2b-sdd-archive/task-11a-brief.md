# Task 11a brief — Group 1's wizard, inspection and outcome overlays

**Plan:** `docs/superpowers/plans/2026-08-24-caring-contact-phase-2b-screens.md`, Group 1, Task 11.
**Split by ruling:** Task 11 named eleven overlays of three very different kinds. **You wire eight.** The
three plan actions — `pause`, `withdrawal`, `reassignment` — are mutating, two-stage and clinically
weighty, and they get their own task and their own review as **Task 11b**. Do not touch them.

**The standing discipline applies in full** — `docs/caring-contacts/phase-2b-sdd-archive/STANDING-DISCIPLINE.md`.

**Do not touch `docs/caring-contacts/phase-2b-build-record.md`.** Other implementers are live in other
worktrees on other branches.

Caring Contacts is a suicide-prevention prototype. Every patient is fictional and **nothing is ever sent
to any number**. `docs/caring-contacts/interaction-matrix.md` is the frozen contract; its source of truth
is `completionOverlayDefinitions` in `overlay-specimens.tsx`.

## The eight, and what kind each is

**Non-mutating** — `pathway-preview`, `message-preview`, `activation-success`.
**Mutating** — `verify-identity`, `change-patient`, `communication-preference`, `save-draft`, `discard-changes`.

The distinction is not cosmetic. **Task 3 made `overlay-trigger.tsx` require a commit handler at the type
level** so a screen cannot open a decision surface it has not wired, and **a bare no-op is exactly what
that forbids**. `{ kind: "unavailable" }` is not the escape either — `commitRefusalFor` returns
`scope: "every-row"` for it, which would `aria-disable` the control and reintroduce the defect Ruling [90]
fixed.

**Task 10 already solved this on this branch: use its `ExitOnlyOverlayTrigger`** for the three
non-mutating rows. It throws for any row marked `mutatesState: true`, which is the guard, and its reasoning
is in the module.

**Do NOT narrow the overlay id union yourself.** Ruling [130] says wrong wiring should be a compile error
rather than a runtime throw, and **Task 14 is making that change on another branch right now.** Two
branches narrowing the same type is a merge conflict I would rather not create. Use the runtime trigger;
the type arrives at merge.

## What every mutating overlay owes, from the matrix

**Recheck connectivity, permission, authentication and version state at COMMIT time — not at open time.**
A coordinator can open a confirmation and sit on it. An overlay that only checks at open passes a naive
test, so write the test that catches it: open in a permitted state, change the state, then commit, and
assert the refusal.

**The feedback contract, verbatim:**

- **Success** announces the synthetic in-memory outcome and updates the visible plan/audit summary.
- **No change** states explicitly that **no external or production action occurred.**
- **Guard rejection** retains the surface, keeps the action focusable with `aria-disabled`, gives the
  **named** reason, and **does not mutate.**
- **Recovery** clears the scenario only after its recovery action succeeds.
- **Modal close** restores focus to the originating action; overlay-only navigation must not move focus to
  the page heading.

## `message-preview` — read the wording, never assemble it

**The message text is changing underneath you.** Ruling [127] said `EXACT_PATIENT_VISIBLE_MESSAGE` was a
specimen with no name slot; **the owner has since decided it gains a first-name slot**, and that change is
being made in the sealed domain on the trunk as Task P.

So: **read the wording from the sealed domain and render what it gives you.** Do not hardcode its shape,
do not assume it has or lacks a slot, and above all **do not assemble a greeting yourself.** If it needs a
name you do not have, that is a finding to report, not a gap to fill.

**You may not author or alter any patient-visible wording, ever.** A screen that hardcodes one is a defect
even when the string is correct.

## `save-draft` and `discard-changes` — the storage distinction this wizard bought with three attempts

Draft state lives in **`sessionStorage`**: it survives a refresh and dies with the tab, and it holds a
patient's name and mobile number on a possibly shared ward computer. That is a deliberate owner decision,
taken twice, the second time because a label saying "nothing is stored" was inaccurate.

**Name the destination, not the act.** _"Recorded on the plan"_ survives; _"stored"_, _"kept"_ and
_"recorded"_ alone do not, because this system distinguishes **held in a tab's storage** from **written
onto the plan** while ordinary English does not. There is a comment at the site saying so. `discard-changes`
in particular must be unambiguous about which of the two it discards.

## Constraints

- Nothing under `src/lib/caring-contacts/` may import from `@/components`, `@/app`, any `@/lib` module
  outside itself, Supabase or OpenAI.
- **The service-state incident `note` must never cross into a Client Component.** A test asserts this.
- **Never render a raw role identifier to a clinician.** The vocabulary scan _rewards_ leaving identifiers
  on screen — it refuses "lead" as a whole word but passes `clinicalProgrammeLead` on a missing word
  boundary. That inversion is filed; do not exploit it.
- **The closed transport vocabulary is frozen.** `Delivered` is a transport receipt, never a patient-state
  label. The scan checks bare identifiers too.
- **Nothing about a patient may travel in a query string** (Ruling [111]), and `overlayUrl()` copies every
  existing parameter into each history entry it pushes — a fix is in flight on the trunk; do not add to it.
- Every `<button>` does something; never native `disabled` **and** `aria-disabled` on one control. Tap
  targets `min-h-12` on the element **containing** the control, never `min-h-11`.
- Design tokens only, no hex. Internal navigation via `<Link>` / `router.push`, hrefs from
  `src/lib/caring-contacts-routes.ts`, never a path literal — including in tests.
- **Do not restate a count in prose** (Ruling [94]). The test: is the thing the number counts visible in
  the same view as the number?
- **This is Next.js 16.** Read `node_modules/next/dist/docs/` before writing boundary code.

## Verification

**The standing discipline governs.** Write these first:

- **A guard rejection does not mutate.** Assert the refusal is shown, named and focusable — **and that the
  record is unchanged.** That last clause is the one nobody writes.
- **The commit-time recheck actually rechecks**, per the open-change-commit sequence above.
- **"No change" is distinguishable from success**, and says no external action occurred.
- **Every one of your eight is reachable and its commit is wired** — a row with a trigger that opens
  nothing, or a commit that records nothing, is the exact defect Task 3's type requirement exists to stop.
- Forced-colors and 320px.

**"Could this possibly go red?" for every assertion.** Give every absence a positive control; assert where
the property is **load-bearing**, not where convenient. Three tasks this session shipped instances of that
family _after naming it_, and one proved a refusal on the panel that displays it rather than on the control
a coordinator presses.

Gates: **`npm run test:cc-guards` only**, plus typecheck, **uncached** lint, and `prettier --check` with the
line pasted. **Re-verify after your final edit.** Reuse this branch's mutation driver and **keep both its
guards and their positive controls**; validate every row against an allowlist of files this task may mutate
**before any file I/O**, and assert **id uniqueness**. Check every SHA still exists. **Contention is
severe** — record every refusal UNRUN, retry, never force.

This touches `tests/ui-caring-contacts-workspace.spec.ts` — say what you think it needs; I run that gate.

## Report

**Commit early — before waiting on any gate.**
Write your full report to `docs/caring-contacts/phase-2b-sdd-archive/task-11a-report.md`, then return ONLY:
status, commit SHAs, a one-line test summary, and your concerns. Do not dispatch subagents. **Do not push
and do not open a pull request.**
