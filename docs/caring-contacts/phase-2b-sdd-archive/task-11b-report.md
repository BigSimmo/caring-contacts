# Task 11b report — `pause`, `withdrawal` and `reassignment`

**Worktree:** `D:\Worktrees\Database\cc-plan-detail` · **Branch:** `claude/caring-contacts-plan-detail`
**Not pushed. No pull request. No subagents dispatched.** `docs/caring-contacts/phase-2b-build-record.md` untouched.

---

## READ THIS FIRST — three things the tree said that the brief did not

### 1. The frozen `pause` summary is false about this domain

The frozen row's own summary reads: _"Pausing can be undone, but the original dates never shift.
**Contacts that fall inside the pause are skipped for good.**"_

The second sentence is not what `pausePlan` does. `pausePlan` is `applyPlanTransition(plan, { type:
"pause" })` routed through `lifecycleWrite`, which carries **no contact work at all** — and the
domain's own contract test is named _"holds without cancelling for a readmission"_ and asserts the
full set is still listed. A contact whose date falls inside a hold stays `scheduled`. It is not
skipped, not suppressed and not cancelled; when the plan runs again it is still there, on its
original date.

I did not amend the frozen copy — it is frozen, and `OverlayHost` renders it verbatim and takes no
children. **The screen states what is true beside the control**, and the agreement case pins the
contrast between the two REAL strings (`overlayDefinition("pause").summary` is asserted to say
"skipped for good" before the screen is asserted not to), so this cannot be read as the drawer and
the screen agreeing.

**This is yours to resolve**: either that row's summary changes, or the domain gains a
skip-inside-the-hold rule it does not have. It is the fourth instance of Task 11a's
frozen-copy-describes-a-capability-that-does-not-exist finding, and the pattern is now four rows
across two tasks.

### 2. There is no authentication in this system, so `requiresFreshAuthentication` cannot mean one

You asked me to write the recheck on my two rows, and to check first what authentication means here.
It means nothing. `caring-contacts-server/session.ts` says of itself that it is _"deliberately NOT a
login and must never look like one"_; the cookie holds a role name and never a credential; the route
that sets it accepts `{ role }` from a closed list and nothing else. There is no password, no token
and nothing to re-enter. **A check that asked a clinician to prove who they are could not fail, so I
did not write one.**

What I wrote instead is a check that **can** fail, and is the only honest reading of "confirm who you
are" this system supports: **the account the service will record the write against is still the one
this screen was rendered for.** The role switcher is a separate surface and another tab can move it
while a confirmation sits open, so a coordinator can otherwise confirm a withdrawal against an
account this screen never named. On the two rows the frozen table marks
`requiresFreshAuthentication` — and only those two, so the scope comes from that table rather than
from a preference — the commit reads `/api/caring-contacts/session` **at that instant** and refuses
if the answer differs. It is named as what it is at every site, in the code and on the screen: **not
an authentication check.**

M1 proves it rechecks (make it compare the open-time value with itself and the case reddens); M2
proves the refusal changes nothing.

**The frozen decision copy for both rows is _"Continue and confirm who you are"_**, which promises an
identity confirmation this system cannot perform. The screen does not repeat that claim. Filed with
the `pause` finding above — same pattern, same owner decision.

### 3. A reassignment carries no version at all

`applyAssignment` takes `{ planId, action }` and no `expectedVersion`; the assignment route's schema
carries none either. So `stale-version` is unreachable on that write, and "a version collision is
distinguishable from a permission refusal" is a claim about the two **lifecycle** rows. It is stated
in `PLAN_ACTION_CONDITIONS` rather than left to be inferred: `this-screen-still-knows-the-plan` is
deliberately ABSENT from the reassignment row, because declaring it would refuse a move for want of a
number the service never asks for.

That is also why the idempotency key matters more there than anywhere else on this surface. On a
lifecycle write the version guard is a second net under a double press; on a reassignment **the key
is the only thing between one press-after-a-timeout and two moves of one patient's plan.** The
repeat-submission case is therefore written on `reassignment`, and M4 reddens it on a duplicate
**record** — `expected [ [ 'demo-teamLead', …(2) ], …(1) ] to deeply equal [ [ 'demo-teamLead', …(2) ] ]`
— rather than on a count of presses.

---

## What was built, and where

| File                                                            | Change                                                                                                                                                                                 |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/caring-contacts/workspace/plan-action-rules.ts` | **New, pure.** The four actions, their conditions, the plain-words refusals, the two request bodies, the idempotency key, and what every refusal the two routes can answer with means. |
| `src/components/caring-contacts/workspace/plan-actions.tsx`     | **New, client.** The three frozen rows wired through `WorkspaceOverlayTrigger`, plus the resume a hold owes; the two-moment guard; the writes; the outcome statement.                  |
| `src/components/caring-contacts/workspace/patient-overview.tsx` | Renders the plan-actions card; the paused note's remedy now names a control that exists.                                                                                               |
| `src/app/caring-contacts/patients/[patientId]/page.tsx`         | Reads the assignment, and resolves the grants, the role wording and the destinations server-side.                                                                                      |
| `tests/caring-contacts-patient-overview.dom.test.tsx`           | The new blocks, driven through the REAL route handlers; the paused-note case updated with the mechanism it describes.                                                                  |
| `tests/caring-contacts-explained-automation.dom.test.tsx`       | `plan-actions.tsx` added to `ALLOWED_CLIENT_COMPONENTS`, on the same three conditions every entry carries.                                                                             |

### The four controls, and what each one is

| Control    | Row of the frozen table      | Stages | What it does                                                                              |
| ---------- | ---------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| Hold       | `pause`, bottom sheet        | one    | `POST … { action: "pause" }` — the plan moves, no contact moves                           |
| Let run    | none — this screen's own     | one    | `POST … { action: "resume" }`                                                             |
| Withdrawal | `withdrawal`, full-screen    | two    | `POST … { action: "withdraw", origin: "patient" }` — the service cancels every unsent one |
| Move       | `reassignment`, bottom sheet | two    | `POST /assignments/… { action: { type: "reassign", toActorId, reason } }`                 |

**`resume` is not given a twenty-fifth row and that is deliberate**: the matrix's twenty-four
surfaces are frozen, and inventing one to carry a control would be a screen editing that contract. It
is an ordinary control performing one write, and it exists because **a hold a coordinator cannot lift
is not a hold** — which is what "make resuming visibly available" asks for.

**The withdrawal's `origin` is fixed at `patient` and stated rather than offered.** The frozen row is
titled "Record a withdrawal the patient asked for", and the route's body is a discriminated union
precisely so an absent origin cannot be defaulted and put words in a patient's mouth.
**FINDING: a clinician-initiated withdrawal has no surface here at all**, and `thirdParty` is refused
by the domain by name. Reported rather than invented.

---

## The commit-time recheck, and which of the matrix's four actually apply

The matrix names connectivity, permission, authentication and version state. Writing a check that
cannot fail would be worse than not having one, so each was decided against the tree:

- **Connectivity — APPLIES, and is real.** Unlike Task 11a's rows, all four of these touch the
  network. `post()` turns a failed `fetch` into `request-did-not-reach-the-service` and the screen
  says so in words. The repeat-submission case drives exactly that path.
- **Version — APPLIES, and the service performs it.** `resolveForWrite` compares
  `stored.plan.version` with `input.expectedVersion` and refuses `stale-version`. The screen's job is
  to send the version it actually holds and to name the refusal distinguishably; M13 and M14 prove
  the two wordings are disjoint in both directions.
- **Permission — APPLIES at two different moments, and both are real.** At OPEN time the screen
  refuses in the matrix's guard-rejection shape, from grants the page resolved (`reassignPlan` is
  granted to a narrower set of roles than the other three, which is what makes that check
  falsifiable rather than constant). At COMMIT time the SERVICE re-checks, because the account it
  acts as is resolved from the cookie at the write — so a role changed between open and confirm is
  refused `action-not-granted` even though the screen believed otherwise. That is proved end to end.
- **Authentication — DOES NOT EXIST.** Section 2 above. What is written in its place is an account
  CONTINUITY check on exactly the two rows the frozen table marks, and it is named as that.

`plan-action-rules.ts` is asked twice, exactly as `overlay-guards.ts` is: at render with one state
passed as both moments (the honest answer — nothing has changed yet), and inside the commit against
the render-time values and values read at that instant, from a ref rather than from the render the
closure was built in.

### The structural limit Task 11a recorded still holds

`WorkspaceOverlays.recordDecision` calls the commit and then calls `closeWorkspaceOverlay()`
**unconditionally**, so an overlay cannot stay open to report a refusal its own commit discovered.
The matrix's "retain the surface" clause is therefore served by the OPEN-time branch; a commit-time
refusal is stated in place on the screen, in the three-part shape this workspace uses everywhere.
Unchanged from Task 11a, and the fix is still a change to the shared host.

---

## The sibling branch's defect, and the case that would have caught it

`planVersion` arrives as a **prop**, and a prop cannot change without a server render. A screen that
kept acting on the version it was rendered with would have its SECOND action refused as
`stale-version` — whose honest wording is that the plan moved after this screen read it. A
coordinator would be told somebody else had changed a suicide-prevention plan **when nobody had.**

So a successful lifecycle write updates the state and the version this screen holds, **from the
answer the service gave**, and `router.refresh()` asks the server for the rest of the screen. The
two-consecutive-actions case is the proof: hold, then let run again, from one render.

```
expect(writes().map((entry) => [entry.body.action, entry.body.expectedVersion])).toEqual([
  ["pause", 2],
  ["resume", 3],
]);
```

M3 makes it send the prop instead, and the case reddens on `Let this plan run again — This plan
changed after this screen read it` — the exact false collision, reproduced. M17 isolates the refresh
half.

**One thing that CANNOT be updated from an answer, and is stated rather than papered over.** The plan
state and version rendered by `EpisodeOverview` above the card come from the server render and are
stale until the refresh lands. The card therefore states the outcome itself and says so in its
`changedBy`: _"The rest of this screen was read before this change and is being read again."_ jsdom
can prove the refresh was **requested**, never that it arrived; that is browser evidence and is
listed below as not proved.

---

## Reassignment: both coordinators, and never an identifier

The card names **who is carrying the plan now** and **who it would move to**, both in
`CARING_CONTACT_ROLE_WORDING`'s words, resolved on the server. Actor identifiers here are
`demo-<role>`, and the reverse lookup goes through `demoActorForRole` — the session module's own
constructor — rather than by re-deriving its `demo-` prefix on a screen.

`carriedBy` is **two fields, not one nullable string**: `{ held, wording }`. "Nobody has taken this
plan on" and "somebody has, and this demonstration cannot put a role to them" are different facts and
only the first is a reason to refuse a move; collapsing them would refuse a legitimate reassignment
with a sentence that is false. The second is unreachable through any write this workspace makes
today, and a branch that cannot run today is still read.

M21 proves the negative directly: name the owner by its identifier and the case reddens on
`expected 'Plan actions…' not to match /teamLead/`, with the positive control (the domain's own
wording present) still passing.

**FINDING — nothing in this workspace claims a plan.** `applyAssignment`'s `claim` action exists and
no surface calls it, so **every plan in the demonstration is unclaimed**, and a reassignment on one is
refused `plan-not-claimed` by the domain. The screen states that as its own condition at open time
(`somebody-is-carrying-this-plan`) rather than letting a coordinator press a control that always
fails, and the tests claim a plan through the store to reach the live path. A "take this plan on"
control is a real gap; it is not in this task's scope and I did not invent one.

---

## Verification

**Every summary line below is pasted. None is reported from an exit code.**

### `npm run test:cc-guards` — the full set, on the final source tree

Run with `GATE_RECEIPTS=refresh`, so no cached receipt could stand in for a run.

```
 Test Files  18 passed (18)
      Tests  455 passed (455)
   Duration  65.00s (transform 3.89s, setup 2.69s, import 10.74s, tests 78.62s, environment 10.21s)
```

That run examined the tree at `ec4f6b1cb`, the final source commit. The only change after it is this
report, which **no suite in `test:cc-guards` reads** — the overlay-definition test parses
`docs/caring-contacts/interaction-matrix.md`, and nothing reads anything under
`phase-2b-sdd-archive/`. Every source and test file is byte-identical to what that run saw.

The per-suite baseline the mutations were measured against, on the same tree:

```
 Test Files  1 passed (1)
      Tests  65 passed (65)
```

### Typecheck

`npx tsc -p tsconfig.json --noEmit` — no diagnostics, exit 0. Run five times across the task, the
last on the final tree.

### Lint, uncached

`node_modules/.cache/eslint` removed first, then `npx eslint --format json` over the six changed
files. `npm run lint` uses a per-file cache, so a failure caused by a different file's change stays
invisible locally and goes red in CI. The JSON names the files it examined, so this is not an exit
code standing in for a run:

```
eslint exit=0
files examined: 6
page.tsx                                          errors 0 warnings 0 []
patient-overview.tsx                              errors 0 warnings 0 []
plan-action-rules.ts                              errors 0 warnings 0 []
plan-actions.tsx                                  errors 0 warnings 0 []
caring-contacts-explained-automation.dom.test.tsx errors 0 warnings 0 []
caring-contacts-patient-overview.dom.test.tsx     errors 0 warnings 0 []
```

### `prettier --check`

Over every changed file, on the final tree:

```
Checking formatting...
All matched files use Prettier code style!
```

### Not run, and why

- `npm run test` — the controller's, at merge points.
- `npm run verify:ui` / `tests/ui-caring-contacts-workspace.spec.ts` — see the section below.
- Anything provider-backed — not approached.

### Disclosed rather than glossed: the tests were written AFTER the implementation

The standing discipline asks for test-first and I did not do it. The design had to be derived from
what four domain modules actually do before it could be written down, and I derived it in code. What
compensates is the mutation ledger below — 21 attempts, every claim attacked, and the three cases
whose load-bearing assertion sat behind a sibling were split so the mutation reddens the clause
rather than its neighbour. That is compensation, not equivalence, and Task 7's lesson stands: **a
mutation can only falsify a test that exists**, so an assertion I never thought to write is not
covered by any of this.

---

## `tests/ui-caring-contacts-workspace.spec.ts` — what I think it needs

**My assessment: it needs the same one change Task 11a asked for, and nothing else. I did not run it.**

That spec's isolated Playwright server **seeds no referrals and no plans** — its own module note says
so twice, and the patient-overview screen it visits is pinned to the ZERO-PLAN path. So
`EpisodeOverview` never renders there, and the plan-actions card with it. Nothing this task added is
reachable by that spec today, and nothing it asserts is broken by this task.

**What one seeded plan would buy, and it is more here than for Task 11a's rows:**

1. **`withdrawal` as a full-screen stage at 320px, measured rather than stamped.** I assert
   `data-overlay-modality="full-screen-stage"` against a `bottom-sheet` control at the same width,
   which proves the ROW reaches the host correctly. jsdom has no layout, so whether that surface
   actually fills a 320px viewport — and whether the destination `<select>` and the handover
   `<textarea>` fit beside it — is browser work and only browser work.
2. **Forced colours.** I assert the classes (`forced-colors:`), because that is all jsdom can see.
3. **The two-stage checkpoint with real focus.** The host moves focus inside a
   `requestAnimationFrame`; the return-focus-to-the-opener clause of the feedback contract is
   asserted by the host's own suite and not by mine.

If a plan is ever seeded there, add the plan-actions card to what that spec visits and these three
become real. **I would not add a `WORKSPACE_SCREENS` entry now**: the route is already listed, and
listing it a second time would not make an unreachable card reachable.

---

## Mutation ledger

**The driver is this branch's, and every one of its guards is kept**, in the order they run: each
row's `file` is validated against an **allowlist of the four files this task may mutate** and each
row's `id` for uniqueness, **both before any file I/O at all**; the tree is asserted
`git status --porcelain` clean before a mutation and again after restoring it; the computed
post-image must **differ** from the original before it is written (the no-op check); and the file is
re-read from disk and asserted byte-identical to that post-image. The lock-refusal detector matches
**both** shapes, as Task 11a corrected it to. Nothing was staged by wildcard while a mutation was
applied — every commit in this task stages explicit paths.

**The whole ledger was re-run on the final tree** after the one test change a mutation prompted (see
M18), rather than assuming the other twenty rows were unaffected by an edit to the file they all
read. Both rounds gave identical verdicts.

**Selection: every row ran `tests/caring-contacts-patient-overview.dom.test.tsx` alone** — the suite
every one of these mutations targets. The full `test:cc-guards` set was run once at the end on the
final tree, which is what catches collateral damage a narrowed selection cannot see.

**One lease refusal**, before M11, waited out and never forced:
`lease refused by another worktree (attempt 1) -- waiting, never forcing`. No row is UNRUN.

Every attempt is itemised, greens included. **No aggregate total** — the table is the evidence.

| #   | The claim the mutation attacks                                                                    | Expected | Got                                   | Gate result (`Tests`)      |
| --- | ------------------------------------------------------------------------------------------------- | -------- | ------------------------------------- | -------------------------- |
| M1  | THE COMMIT-TIME RECHECK ACTUALLY RECHECKS: it reads the acting account NOW, not at open time      | red      | **RED**, as predicted                 | 2 failed / 63 passed (65)  |
| M2  | A GUARD REJECTION DOES NOT MUTATE: the early return is load-bearing                               | red      | **RED**, message differed — see below | 2 failed / 63 passed (65)  |
| M3  | the version sent is the one the LAST ANSWER gave, not the prop this screen was rendered with      | red      | **RED**, as predicted                 | 1 failed / 64 passed (65)  |
| M4  | A REPEATED SUBMISSION DOES NOT ACT TWICE: one key per submission, reddening on a DUPLICATE RECORD | red      | **RED**, as predicted                 | 2 failed / 63 passed (65)  |
| M5  | PAUSE HOLDS RATHER THAN CANCELS: the control asks for the transition it says it does              | red      | **RED**, as predicted                 | 2 failed / 63 passed (65)  |
| M6  | the withdrawal records the origin the frozen row is about, which the domain accepts               | red      | **RED**, as predicted                 | 2 failed / 63 passed (65)  |
| M7  | the screen does not repeat the frozen drawer's "skipped for good" claim                           | red      | **RED**, as predicted                 | 1 failed / 64 passed (65)  |
| M8  | the no-sender sentence is pinned WHOLE, not by a loose match                                      | red      | **RED**, as predicted                 | 1 failed / 64 passed (65)  |
| M9  | what a hold actually changes — the write gate — is stated rather than left vague                  | red      | **RED**, as predicted                 | 1 failed / 64 passed (65)  |
| M10 | the destination is offered in the domain's wording                                                | red      | **RED**, message differed — see below | 1 failed / 64 passed (65)  |
| M11 | OVER-SENSITIVITY CONTROL: no assertion reads the action blocks' padding                           | green    | **GREEN**, as predicted               | 65 passed (65)             |
| M12 | every control on this card is a production tap target, not the 44px step                          | red      | **RED**, as predicted                 | 1 failed / 64 passed (65)  |
| M13 | a version collision is stated in its OWN words                                                    | red      | **RED**, as predicted                 | 1 failed / 64 passed (65)  |
| M14 | …and a permission refusal does not borrow them — the other direction, isolated                    | red      | **RED**, as predicted                 | 1 failed / 64 passed (65)  |
| M15 | a move on a plan nobody is carrying is refused rather than offered                                | red      | **RED**, as predicted                 | 1 failed / 64 passed (65)  |
| M16 | the paused note's remedy names a control that EXISTS on this screen                               | red      | **RED**, as predicted                 | 1 failed / 64 passed (65)  |
| M17 | the rest of the screen is asked for again after a change lands                                    | red      | **RED**, as predicted                 | 1 failed / 64 passed (65)  |
| M18 | a change already on its way holds the other controls, so a second cannot collide with it          | red      | **RED**, message differed — see below | 1 failed / 64 passed (65)  |
| M19 | the withdrawal control raises the withdrawal row of the frozen table and no other                 | red      | **RED**, message differed — see below | 13 failed / 52 passed (65) |
| M20 | an action nobody declared conditions for is refused by name rather than by a TypeError            | red      | **RED**, as predicted                 | 1 failed / 64 passed (65)  |
| M21 | a raw role identifier never reaches a clinician, while the domain's wording does                  | red      | **RED**, as predicted                 | 1 failed / 64 passed (65)  |

### Predicted message against observed, and the four that differed

- **M1** — predicted: _the account refusal is never shown, because the withdrawal went through_
  - failing tests: `refuses a withdrawal confirmed after the acting account changed, and writes nothing`, and its isolated sibling
  - observed: `Expected element to have text content: The account this screen was opened in is not the account acting now / Received: Withdrawal — recorded on the plan…`

- **M2 — THE PREDICTION NAMED THE WRONG CASE'S MESSAGE, AND THE DISCREPANCY IS WORTH THE ROW.**
  - predicted: _the isolated case fails on `writes()` — the write reached the service_
  - observed FIRST in the log: the WORDING case's `toHaveTextContent`, because removing the `return`
    lets the write land and its success outcome **overwrites** the refusal before the wait settles.
  - observed in the isolated case, which is the one this row exists for:
    `AssertionError: expected [ { …(2) } ] to deeply equal []`. **The write reached the service.**
  - The lesson is the driver's, not the test's: it reports the FIRST failure in the run, and with two
    cases failing that is not necessarily the one the mutation was aimed at. The per-run log has to
    be read case by case, which is why this round persisted them.

- **M4** — predicted: _the reassignment history holds two entries_
  - failing test: `moves the plan once when the answer is lost and the coordinator presses again`
  - observed: `AssertionError: expected [ [ 'demo-teamLead', …(2) ], …(1) ] to deeply equal [ [ 'demo-teamLead', …(2) ] ]`
  - the second failure is the key case, on `expect(keys[0]).toBe(keys[1])`. **Split deliberately**, so
    the duplicate RECORD is what this row reddens rather than a fact about the request.

- **M5** — predicted: _the contacts are cancelled where they should be untouched_
  - failing test: `holds the plan and cancels NOTHING, read back from the record rather than from the copy`
  - observed: `AssertionError: expected [ [ 'Day 1', 'cancelled' ], …(9) ] to deeply equal [ [ 'Day 1', 'scheduled' ], …(9) ]`
  - the second failure is the two-actions case, which cannot let a withdrawn plan run again.

- **M10 — THE PREDICTION WAS WRONG, AND WHAT IT LEAVES UNPROVEN IS STATED.**
  - predicted: _the card's text matches `/demo-/`, so the negative fires_
  - observed: `TestingLibraryElementError: Unable to find an accessible element with the role "option" and name "a coordinator account"` — the POSITIVE control fails first, because the option's accessible name changed.
  - So M10 proves the option is named in the domain's wording; it does **not** prove the negative.
    **M21 carries that**, on the other half of the same claim, and its observed message is the
    negative firing with its own positive control still passing.

- **M13** — predicted: _the collision case cannot find its own heading_
  - observed: `Expected element to have text content: This plan changed after this screen read it / Received: Pause — This account may not carry out this action on this plan…`

- **M14** — predicted: _the permission outcome matches the collision phrase_
  - observed: `AssertionError: expected 'Pause — This action is not granted to…' not to match /changed after this screen read it/i`. The
    row's own `toHaveTextContent` still passes on a substring, which is what isolates this one.

- **M18 — THE MUTATION FOUND A DEFECT IN MY OWN CASE, AND THE CASE WAS CHANGED.**
  - predicted: _the resume control is not `aria-disabled` while a change is on its way_
  - first observed (round 1): `Expected element to have text content: Another change to this plan is
still on its way to the service / Received: Only a plan that is being held can be let run again…`
  - Why: a RUNNING plan's resume control is refused **anyway**, for being a plan nobody is holding. So
    `aria-disabled` was already `"true"` before any change was on its way and that assertion proved
    nothing about the claim the case is named for; only the SENTENCE distinguishes the two.
  - The case now waits on the sentence and asserts the attribute after it, and the whole ledger was
    re-run against that tree. Same observed message, now from the load-bearing assertion.

- **M19 — THE MESSAGE DIFFERED AND THE BLAST RADIUS IS THE POINT.**
  - predicted: _`expected exactly one withdrawal trigger on screen, found 0`_
  - observed: `Error: expected exactly one pause trigger on screen, found 2` — the mutated control
    becomes a SECOND pause trigger, so the helper refuses on the ambiguity before any withdrawal
    lookup runs. Either way the row's identity is what fails, which is the claim.
  - **13 cases**, every one that reaches either row. Stated rather than counted as a surprise: a
    control raising the wrong row of the frozen table breaks everything downstream of it.

- **M12** — predicted: _the fields lose `min-h-tap`_
  - observed: `AssertionError: Nobody chosen yeta coordinator accounta team lead account is not a production tap target: expected 'min-h-11 w-full min-w-0 rounded-[var(…' to contain 'min-h-tap'`
  - The named control reads as run-together option text, because a `<select>`'s `textContent` is its
    options. Ugly, and it still names the control; worth tidying if that case is ever touched.

- **M11** — predicted: _GREEN; nothing reads the action blocks' padding_
  - observed: `Tests 65 passed (65)`. The over-sensitivity control: the tap-target scan reads
    `className` on buttons, selects and textareas, and this is a wrapper `<div>`, so a padding change
    there must not move the suite. It does not.

### What the ledger does NOT prove

- **Nothing here is browser evidence.** jsdom has no layout, so the tap-target and forced-colours
  assertions read class names and the modality assertion reads a stamped attribute. The pixel
  measurement at 320px is `verify:ui`'s and that spec cannot reach this card today — see above.
- **`router.refresh()` is proved REQUESTED, never proved to have arrived.** There is no app-router
  context in jsdom. What the card states about the outcome does not depend on the refresh, which is
  why the announcement is rendered from this screen's own state rather than waiting for the server.
- **The `this-screen-still-knows-the-plan` condition has no case and no mutation.** It fires only when
  a lifecycle write SUCCEEDS and its answer cannot be read, which the dispatcher can produce but I
  did not write a case for. It is declared, wired and unproven; the honest label is untested, not
  covered.
- **The `access-audit-unavailable`, `service-stopped`, `request-body-too-large` and unknown-name
  refusal wordings have no case.** They are total by construction (`Object.hasOwn` on a
  null-prototype map, with an explicit untaught-name branch), and the untaught branch is the one that
  would catch a service refusal nobody wrote wording for. None is exercised.
- **The two-stage checkpoint's own content is the HOST's, not this screen's.** The host renders one
  fixed paragraph and takes no children, so what stage 2 SAYS is not mine to change and not mine to
  prove. What I proved is that the commit happens only on the second activation and that the second
  stage carries a real check the first did not.
- **The `carriedBy.wording === null` branch** — an owner no demo role accounts for — is written,
  reachable by type and unreachable by any write this workspace makes. No mutation can make an
  unreachable branch fail.

---

## Open questions and limits I could not close

1. **The frozen `pause` summary contradicts the domain.** Section 1. Yours.
2. **The frozen decision copy on both two-stage rows promises an identity confirmation this system
   cannot perform.** Section 2. Yours.
3. **Nothing claims a plan**, so every plan is unclaimed and every reassignment is refused by the
   domain until something does. A "take this plan on" control is a real gap and is not in this task.
4. **A clinician-initiated withdrawal has no surface**, though the route and the domain both accept
   one.
5. **The host closes unconditionally**, so a commit-time refusal cannot retain the overlay surface.
   Unchanged from Task 11a; the fix is a change to `workspace-overlays.tsx`.
6. **The account check costs one extra round trip** on the two most consequential actions, and it
   refuses when that read fails. That is the conservative direction on a withdrawal, and it is a
   deliberate choice rather than an oversight: a change confirmed against an account this screen
   could not name is what the question exists to prevent.
7. **The idempotency key is minted at the first CONFIRMATION of an action, not at the first opening
   of its surface**, which is a deviation from the brief's wording. The reason: an opening a
   coordinator dismisses should not consume a key, and the retry guarantee is identical either way —
   the key is held until that action's write succeeds, so every retry of one submission shares it. If
   you want minting at open, it needs a hook the trigger does not currently offer.
8. **No sixth hospital-record value was found.** Nothing on this card wanted a value from a record
   this system is not connected to.
