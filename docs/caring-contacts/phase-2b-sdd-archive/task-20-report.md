# Task 20 — every overlay trigger, reconciled against all twenty-four frozen rows

Run on the merged tree, per Ruling [133]. Branch `claude/browser-test-gate-handoff-d5c1db`, from
`b4af12247`. The reconciliation below was established at `c8ceb68e7`; the mutation round was then
re-run in full at `30a6c33e1`, the final tree, after a lint-driven rename of two loop variables, and
returned identical verdicts. Nothing was pushed and no pull request was opened.

**The result in one line:** every row is now either raised by a control whose `file:line` is
recorded below, or recorded as unwired with the reason it is unwired. No row is silent.

---

## How each column was established

**Route and trigger.** Every trigger site in the workspace was found by reading the production
component tree — `src/components/caring-contacts/workspace/**` (excluding `overlays/`, which is the
machinery) and `src/app/caring-contacts/**` — for the `overlayId` prop on either trigger component,
in both the literal and the variable form. The literal form is what a text scan sees; the variable
form is not, and two rows are wired that way. The `file:line` in the table is the line carrying the
prop, read from the file rather than from a grep summary.

**Reachability.** Established from the render condition around each trigger, then asked of the
seeded demonstration and of the routes that exist. Three answers occur and they are different
findings, so they are not collapsed:

- **On the screen** — the control renders in a state the seeded demonstration reaches, so an
  ordinary walk through the interface gets to it.
- **On the screen, in a state nothing produces** — the control is correctly conditioned and would
  render, but no route and no seed can put a record into that state, so today the surface is
  reachable only by address. This is a property of the demonstration's data, not a defect in the
  trigger.
- **Address only** — no control anywhere raises it; `?overlay=<id>` on any workspace route is the
  whole of its reachability. The shell mounts `WorkspaceOverlays` on every route, so every one of the
  twenty-four is deep-linkable from every screen.

**Defect or recorded exception.** A row with no trigger is a **defect** when the screen the matrix
assigns it to exists in this tree _and_ the action behind its decision exists, and nothing raises it.
It is a **recorded exception** when one of those two is absent — and the reason is stated against the
module that would have to change for it to become wired, so the exception can be re-opened by
checking one thing rather than by re-deriving the argument.

---

## The table

Routes are under `/caring-contacts`. Line numbers are as at `30a6c33e1`; no production source was
changed by this task, so they are the same lines the reconciliation was read from.

| #   | ID                         | Matrix product context               | Route the trigger is on                | Trigger                                                                       | Reachability                                                                                                                                     | Verdict                                      |
| --- | -------------------------- | ------------------------------------ | -------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| 1   | `verify-identity`          | Agreement gate                       | `/plans/new`                           | `plan-wizard.tsx:1218`                                                        | On the screen — Agreement stage, unconditional                                                                                                   | Wired                                        |
| 2   | `change-patient`           | Agreement gate                       | `/plans/new`                           | `plan-wizard.tsx:1226`                                                        | On the screen — Agreement stage, unconditional                                                                                                   | Wired                                        |
| 3   | `pathway-preview`          | Pathway selection                    | `/plans/new`                           | `plan-wizard.tsx:1472`                                                        | On the screen — one per approved version row; the seed publishes one                                                                             | Wired                                        |
| 4   | `message-preview`          | Personalisation, review, templates   | `/plans/new`, `/templates/[pathwayId]` | `plan-wizard.tsx:1821`, `template-detail.tsx:490`                             | On the screen in both — Personalisation is unconditional; the template control needs a current version that holds wording, which the seed's does | Wired (see note A)                           |
| 5   | `communication-preference` | Personalisation                      | `/plans/new`                           | `plan-wizard.tsx:1778`                                                        | On the screen — Personalisation stage, unconditional                                                                                             | Wired                                        |
| 6   | `adjust-date-time`         | Personalisation / schedule exception | `/schedule`                            | `contact-time-adjustment.tsx:511`, id from `ADJUST_DATE_TIME` (line 95)       | On the screen — a contact still to send, where the role may move one                                                                             | Wired through a variable (see note B)        |
| 7   | `outside-window-warning`   | Schedule validation                  | `/schedule`                            | `contact-time-adjustment.tsx:511`, id from `OUTSIDE_WINDOW_WARNING` (line 96) | On the screen — the same control, once a time outside 9:00–18:00 AWST is chosen                                                                  | Wired through a variable                     |
| 8   | `save-draft`               | Personalisation                      | `/plans/new`                           | `plan-wizard.tsx:1042`                                                        | On the screen — the draft notice, on every stage                                                                                                 | Wired                                        |
| 9   | `discard-changes`          | Personalisation                      | `/plans/new`                           | `plan-wizard.tsx:1038`                                                        | On the screen — the draft notice, on every stage                                                                                                 | Wired                                        |
| 10  | `final-activation`         | Review and activation                | `/plans/new`                           | `plan-wizard.tsx:2429`                                                        | On the screen — Review stage, unconditional                                                                                                      | Wired                                        |
| 11  | `activation-success`       | Patient overview outcome             | `/patients/[patientId]`                | `patient-overview.tsx:1024`                                                   | On the screen — a running plan; the seed leaves one running                                                                                      | Wired                                        |
| 12  | `pause`                    | Plan actions                         | `/patients/[patientId]`                | `plan-actions.tsx:451`                                                        | On the screen — the plan-actions card, unconditional                                                                                             | Wired                                        |
| 13  | `withdrawal`               | Plan actions                         | `/patients/[patientId]`                | `plan-actions.tsx:499`                                                        | On the screen — the plan-actions card, unconditional                                                                                             | Wired                                        |
| 14  | `reassignment`             | Plan / team actions                  | `/patients/[patientId]`                | `plan-actions.tsx:552`                                                        | On the screen — the plan-actions card, unconditional                                                                                             | Wired on the plan side (see note C)          |
| 15  | `delivery-detail`          | Plan / contact inspection            | `/patients/[patientId]`                | `patient-overview.tsx:825`                                                    | **On the screen, in a state nothing produces** — needs a contact whose message left (see note D)                                                 | Wired                                        |
| 16  | `resolve-failed-delivery`  | Delivery exception                   | `/schedule`                            | `schedule-screen.tsx:936`                                                     | **On the screen, in a state nothing produces** — needs a contact needing operational review (see note D)                                         | Wired                                        |
| 17  | `contact-changed-block`    | Contact destination review           | —                                      | **none**                                                                      | Address only                                                                                                                                     | **Recorded exception — E1**                  |
| 18  | `template-changed-retired` | Template lifecycle / workflow        | `/templates/[pathwayId]`               | `template-detail.tsx:514`                                                     | **On the screen, in a state nothing produces** — needs a retired version; the seed publishes one version and no control retires one (see note D) | Wired                                        |
| 19  | `session-expiry`           | Protected action guard               | —                                      | **none**                                                                      | Address only                                                                                                                                     | **Recorded exception — E2**                  |
| 20  | `offline-banner`           | Global connectivity guard            | —                                      | **none**                                                                      | Address only                                                                                                                                     | **Recorded exception — E3**                  |
| 21  | `recoverable-error`        | Read recovery                        | —                                      | **none**                                                                      | Address only                                                                                                                                     | **Recorded exception — E4**                  |
| 22  | `permission-unavailable`   | Role guard                           | —                                      | **none**                                                                      | Address only                                                                                                                                     | **Recorded exception — E5, with a residual** |
| 23  | `team-switcher`            | Header active-team context           | —                                      | **none**                                                                      | Address only                                                                                                                                     | **Recorded exception — E6**                  |
| 24  | `draft-version-conflict`   | Draft / version guard                | —                                      | **none**                                                                      | Address only                                                                                                                                     | **Recorded exception — E7**                  |

**Wired: rows 1–16 and 18. Unwired by recorded exception: rows 17, 19, 20, 21, 22, 23, 24. Unwired
as a defect: none.** Two of the wired rows share one control (rows 6 and 7), and one row carries two
controls on two screens (row 4), so the trigger sites number eighteen while the wired rows number
seventeen.

---

## The recorded exceptions, each argued against the module that would have to change

**E1 — `contact-changed-block`.** The matrix names a "contact destination review" and no screen in
this phase is one. The state the row is about is real in the domain: a `mobileChanged` hospital
status event pauses the plan and raises a `contactChanged` exception
(`src/lib/caring-contacts/hospital-events.ts:136`). But `applyHospitalStatusEvent` is reached only
from the two repository implementations, and no API route under `src/app/api/caring-contacts/**`
applies a hospital status event at all — the routes call `createPlan`, `activatePlan`, `pausePlan`,
`resumePlan`, `withdrawPlan`, `rescheduleContact`, `resolveDispatchDiscrepancy` and the reads, and
nothing else. So nothing in the interface can put a plan into the state, and the row's decision —
"Keep the plan paused" — would be a confirmation about a state that cannot arise. **To become wired
this needs an inbound route for the event and a screen that reviews the destination.**

**E2 — `session-expiry`.** There is no session. `src/lib/caring-contacts-server/session.ts` says of
itself, in its first paragraph, that it is "deliberately NOT a login" and that the cookie it reads
"holds only a role name, never a credential". `contact-time-adjustment.tsx:79` reaches the same
conclusion from the other side while implementing the matrix's commit-time recheck: "AUTHENTICATION
— THERE IS NONE TO RECHECK … Claiming an authentication check here would be theatre." The row's
decision is "Sign in again", an action this prototype cannot perform. **To become wired this needs
enterprise authentication, which the decision lock puts outside the prototype.**

**E3 — `offline-banner`.** A status banner is raised by an observer, not pressed. The workspace has
no connectivity observer: `navigator.onLine` is read once, at the moment of a write
(`contact-time-adjustment.tsx:306`), and the answer becomes a named refusal carried on that row's own
overlay. A control that opened this banner would assert there is no connection at a moment nobody had
checked. The row is also `dismissal: recovery-only`, so an overlay opened while online would be one a
person could not leave except by its recovery action. **To become wired this needs a connectivity
observer in the shell, which is a mechanism rather than a trigger.**

**E4 — `recoverable-error`.** Read recovery is performed, in full, by
`src/app/caring-contacts/error.tsx`. That boundary takes Next 16's `retry` rather than `reset`
specifically so its control re-fetches instead of re-rendering the same failure (Ruling 53), and it
already states that nothing was sent and nothing was changed. A trigger for this row would offer a
second, weaker recovery beside a working one. **To become wired the row would have to be given a
recovery the boundary does not already perform.**

**E5 — `permission-unavailable`, and the residual that goes with it.** Role refusals in this
workspace are stated in place, on the control, in the shape `docs/wiring-conventions.md` requires:
`aria-disabled`, an inert handler, and the named reason. `plan-actions.tsx` carries them per action
block, `contact-time-adjustment.tsx` re-checks permission at commit and renders the refusal on the
row's own overlay, and `unavailable-destination.tsx` carries the shell's. A control that opened this
drawer would say "press here to be told you may not do this".

**The residual is real and is not the trigger.** `OverlayHost` can render this row from a
`blockReason`, and the wording for it is written and total
(`overlays/overlay-host.tsx:187`). Nothing ever supplies it: `WorkspaceOverlays` passes
`blockReason={null}` unconditionally (`overlays/workspace-overlays.tsx`, the `OverlayHost` element at
the end of the module). So a built mechanism with reviewed copy has no producer anywhere in the
workspace. **That is worth the controller's attention** — it is either a seam nobody closed or a
mechanism that should be removed, and it is not something a screen may decide.

Note also that Task 10's report recorded, as a seam left for another task, that "Tasks 11 and 14 are
about to wire `activation-success` and `permission-unavailable`". `activation-success` was wired
(row 11). `permission-unavailable` was not, and Task 14's report does not say why. **An earlier
task's report does not match what it left**, which the standing discipline says to report rather than
work around.

**E6 — `team-switcher`.** There is one team. `DEMO_TEAM_ID` in
`src/lib/caring-contacts-server/session.ts` is documented as "The one team every demo actor belongs
to — there is no multi-team demo", and `demoActorForRole` gives every role that team. No store method
changes an actor's team. So there is nothing to switch to and no write that switches, and the row's
decision — "Clear and switch team" — would clear a draft to arrive back where it started. **To become
wired this needs more than one team and a write that moves between them.**

**E7 — `draft-version-conflict`.** Nothing detects an approved version changing under an open draft.
The wizard reads its pathway options once, on the server, at page render
(`src/app/caring-contacts/plans/new/page.tsx`), and the client draft holds the chosen id with no
later comparison against the record. The one adjacent case that IS handled — a referral naming a
version that is not startable — is answered with a `StatedReason` block on the pathway stage
(`plan-wizard.tsx:1384`), not with this overlay, and that is a different fact: it is true on arrival
rather than a change that happened while the draft was open. **To become wired this needs a
re-read-and-compare the wizard does not perform.**

---

## Notes on the wired rows

**Note A — `message-preview` names three contexts and carries controls on two.** The matrix's product
context for this row reads "Personalisation, review, templates". Personalisation and templates each
carry one. The wizard's Review stage does not, and its own comment
(`plan-wizard.tsx:2360`) says why it renders no wording: "No message TEXT is rendered here.
Patient-visible copy is frozen …". The overlay itself carries no patient content either — `OverlayHost`
renders the row's frozen summary and takes no children — so a third control would open the same
generic drawer. **Recorded, not decided.** Whether the "review" context obliges a control is a
question about what the matrix's context column means, which belongs with the six frozen-copy
conflicts already sitting with the owner under Rulings [132] and [135], not with a screen.

**Note B — two rows are wired through a variable, and a text scan cannot see either.** The schedule's
move control raises `adjust-date-time` or `outside-window-warning` from one `overlayId={overlayId}`
prop, chosen at `contact-time-adjustment.tsx:495`. A grep for `overlayId="…"` finds fifteen distinct
ids across the tree and misses both of these; the true wired figure is seventeen. This is exactly the
undercount the brief warned the opening measurement might be, and it is why the inventory gate
records the indirection explicitly rather than inferring it.

**Note C — `reassignment` names "Plan/team actions" and only the plan side exists.** The plan-actions
card carries the control. The Team screen is Group 4, Tasks 17–18, deferred by the owner, and its
"Reassign work" control is named in the plan for Task 18. The row is wired; the team-side control is
part of a deferred group rather than a missing trigger.

**Note D — three wired controls sit behind states the running demonstration cannot reach.** This is
the finding most likely to be misread, so it is stated exactly.

`delivery-detail` renders only where `contactSendability(state) === "alreadySent"`;
`resolve-failed-delivery` only where `needsOperationalReview(state)` is true; `template-changed-retired`
only on a retired pathway version. Each condition is the right one and each is asked of the domain
rather than of a list written in the screen.

But **no route advances a contact past `scheduled`.** Not one store method called from
`src/app/api/caring-contacts/**` is a dispatch transition — there is no `markSent`, no
`providerStatus` and no `markMissed` anywhere in that tree — and `demo-seed.ts` writes no dispatch
records at all. The states a seeded contact can reach are `scheduled`, `suppressed` (absorbed by the
first contact) and `cancelled` (after a withdrawal), none of which is `alreadySent` and none of which
needs review. Likewise no control retires a pathway version, and the seed publishes exactly one.

**So all three surfaces are, today, reachable only by address — and the trigger is not the reason.**
Fixing it by loosening a condition would be the defect: it would offer "What the phone network
reported" for a message that has not been sent. What it means for Task 21 is more immediate: a
browser proof that walks the interface will not reach these three overlays through their controls,
and a proof that reports them as unreachable would be describing the seed rather than the screens.

---

## What this task changed, and what it deliberately did not

**No trigger was wired.** Every one of the seven unwired rows fails the "screen exists and action
exists" test, each for the reason recorded above. Wiring any of them would have put a control on a
screen that advertises an action the system does not perform, which is the defect this phase already
paid for once.

**No frozen text was edited**, and no assertion was weakened or deleted to make a row pass. One test
case was deleted, and it was deleted for the opposite reason — see the mutation ledger, `M13`.

**What was added:** `tests/caring-contacts-overlay-trigger-inventory.test.ts`, and its name in
`test:cc-guards`. A table in a document is true on the day it is written; this file is the part that
stays true. It records every row as raised by a literal trigger in named modules, raised through a
named constant, or raised by nothing with the reason beside it — and checks each form against the
tree. Deleting a trigger, moving one, adding one, adding a row to the frozen table, or quietly wiring
a row recorded as unwired each turns it red and names the row.

**What it does not claim, stated because a green must not be over-read.** The scan is textual. It
reads source as text and cannot tell a control from a comment: writing `overlayId="pause"` inside a
comment would count as a trigger, and quoting an unwired id in a comment reddens the unwired check.
Both were confirmed by mutation (`M4`, `M9`) rather than assumed, and the limit is written into the
file's own header. A green there says the strings are in the files; that a control renders is proved
by each screen's own DOM suite. It also makes no claim about reachability — that column of the table
above needs a rendered screen, not a file read.

---

## Findings for the controller

**F1 — two live `ExitOnlyOverlayTrigger` implementations, and Ruling [130] does not hold at one call
site.** The adjudication recorded in the build record ("The duplicate `ExitOnlyOverlayTrigger`,
adjudicated") resolved to _keep Task 10's file and structure, with Task 16's runtime behaviour, and
carry over the `data-overlay-trigger-kind="exit-only"` marker_. The merged tree has neither half of
that. Both implementations are present and both are imported:

- `overlays/exit-only-overlay-trigger.tsx` — Task 10's module. Types `overlayId` as
  `NonMutatingOverlayId`, stages `{ kind: "record", record: closingIsTheWholeAction }`, renders no
  marker. Imported by `patient-overview.tsx:21` and `plan-wizard/plan-wizard.tsx:29`.
- `overlays/overlay-trigger.tsx` — a second `ExitOnlyOverlayTrigger` exported from the base trigger's
  own module. Types `overlayId` as **`string`**, stages nothing, renders the marker. Imported by
  `template-detail.tsx:22`.

Two consequences, and the first is the one that matters. **Ruling [130]'s compile-time guarantee is
absent at the `template-detail.tsx` call site**: `overlayId: string` there means wiring a recording
row to an exit-only trigger is a render-time throw again rather than a compile error, which is
precisely the state Ruling [130] was written to end. And the two stage different things, so "what an
exit row's commit is" has two answers in one tree.

**I did not repair it, deliberately.** The minimal repair — delete the duplicate, re-point
`template-detail.tsx` — reddens `tests/caring-contacts-template-detail.dom.test.tsx:481`, which
asserts the marker the surviving module does not render. Carrying the marker over means giving
`WorkspaceOverlayTrigger` a pass-through prop, which is a change to Task 3's pinned trigger contract.
That is an adjudication the merge only half-applied, not something a reconciliation may decide, and
the brief forbids weakening the assertion that stands in the way. **Recommended: one small task that
lands the whole adjudication — marker into the surviving module, duplicate deleted, import
re-pointed, that assertion still green.**

**F2 — a built refusal mechanism with no producer.** `blockReason` and its reviewed wording exist in
`OverlayHost`; `WorkspaceOverlays` passes `null` in every case. See E5.

**F3 — an earlier task's report does not match what it left.** Task 10 recorded
`permission-unavailable` as Task 14's to wire. It is unwired and Task 14's report does not mention it.
See E5.

**F4 — three wired controls cannot be reached through the interface, because of the demonstration's
data rather than the screens.** See note D. This lands on Task 21 directly.

**F5 — a generated document was stale before this task started.** `docs/scripts-index.md` recorded one
fewer npm script than `package.json` carried at `b4af12247`, before any change of mine. The
pre-commit synchronisation surfaced it; it is committed on its own at `9c13c8417` so it is not mixed
into this task's work.

---

## Mutation ledger

Every row ran against `30a6c33e1`, the final tree, with the baseline re-established on it first:
`Tests 9 passed (9)`. The round had already been run once at `c8ceb68e7` and every verdict below is
unchanged between the two; it was repeated because the suite was edited afterwards, and a gate
verdict covers only the tree it saw. Each row was applied by a driver that validates its whole table against an
allowlist of the four files this task may mutate **before any file I/O**, checks its anchor occurs
exactly once, asserts the computed post-image differs from the original, writes it, re-reads from disk
and asserts byte equality, restores, and asserts `git diff --quiet` over the allowlisted paths on both
sides. Selection was the single suite in every row: `run-vitest.mjs run --reporter=dot
tests/caring-contacts-overlay-trigger-inventory.test.ts`, with `GATE_RECEIPTS=refresh`.

The case labels below are the test names in the suite.

| ID            | File                          | Mutation                                                                                      | Predicted                                                                                                                                           | Observed                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Verdict                                       |
| ------------- | ----------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `CTRL_NOOP`   | test                          | replacement equals anchor                                                                     | the driver refuses the row                                                                                                                          | `REFUSED — the post-image equals the original`                                                                                                                                                                                                                                                                                                                                                                                                                   | Guard fired                                   |
| `CTRL_ABSENT` | test                          | anchor not in the file                                                                        | the driver refuses the row                                                                                                                          | `REFUSED — anchor occurs 0 times`                                                                                                                                                                                                                                                                                                                                                                                                                                | Guard fired                                   |
| `M1`          | test                          | delete the `overlays` exclusion from the walk                                                 | "excludes the overlay machinery" red; "no mention of an unwired id" red, because `overlay-host.tsx` quotes `permission-unavailable` as a lookup key | `Tests 2 failed \| 7 passed (9)`; failed: _excludes the overlay machinery from the scan_, _finds no mention of an id recorded as unwired in any screen module_; `expected [ …(6) ] to deeply equal []`, `expected [ …(7) ] to deeply equal []`                                                                                                                                                                                                                   | RED as predicted                              |
| `M2`          | test                          | point one inventory module at a path outside the scanned roots                                | "scans every module the inventory names" red; the literal and trigger-component cases error from `sourceOf`                                         | `Tests 3 failed \| 6 passed (9)`; failed: _scans every module the inventory names_, _finds a literal trigger where one is recorded, and nowhere else_, _finds every recorded literal trigger's module declaring the trigger component it uses_; `expected [ …(42) ] to deeply equal ArrayContaining{…}`, `expected [ …(3) ] to deeply equal []`, thrown `…product-pages.tsx is named in TRIGGER_INVENTORY but is not one of the screen modules this file scans.` | RED — **prediction half wrong, see below**    |
| `M3`          | test                          | add an inventory entry for an id no frozen row carries                                        | "one entry per frozen row" red                                                                                                                      | `Tests 1 failed \| 8 passed (9)`; failed: _holds one entry per frozen row, and names no row the frozen table does not carry_; `expected [ 'activation-success', …(24) ] to deeply equal [ 'activation-success', …(23) ]`                                                                                                                                                                                                                                         | RED as predicted                              |
| `M4`          | `schedule-screen.tsx`         | add `overlayId="not-a-frozen-row"` in a comment                                               | "no trigger for an id the frozen table does not carry" red, naming the file and the id                                                              | `Tests 1 failed \| 8 passed (9)`; failed: _finds no trigger in a screen for an id the frozen table does not carry_; `expected [ Array(1) ] to deeply equal []`                                                                                                                                                                                                                                                                                                   | RED as predicted                              |
| `M5`          | `plan-actions.tsx`            | `overlayId="pause"` becomes `overlayId="withdrawal"`                                          | "literal trigger where recorded, nowhere else" red, naming `pause`                                                                                  | `Tests 1 failed \| 8 passed (9)`; failed: _finds a literal trigger where one is recorded, and nowhere else_; `expected [ Array(1) ] to deeply equal []`                                                                                                                                                                                                                                                                                                          | RED as predicted                              |
| `M6`          | test                          | point the schedule module at a scanned module that imports no trigger                         | "module declaring the trigger component" red; the literal case red too, because the module moved                                                    | `Tests 2 failed \| 7 passed (9)`; failed: _finds a literal trigger where one is recorded, and nowhere else_, _finds every recorded literal trigger's module declaring the trigger component it uses_; two × `expected [ Array(1) ] to deeply equal []`                                                                                                                                                                                                           | RED as predicted                              |
| `M7`          | `contact-time-adjustment.tsx` | `const ADJUST_DATE_TIME = "adjust-date-time"` gains a suffix                                  | "wired through a variable" red on the constant branch                                                                                               | `Tests 1 failed \| 8 passed (9)`; failed: _finds each id wired through a variable declared as a named constant and passed as one_; `expected [ Array(1) ] to deeply equal []`                                                                                                                                                                                                                                                                                    | RED as predicted                              |
| `M8`          | `contact-time-adjustment.tsx` | `overlayId={` broken by a space                                                               | the same case red on the other branch, for both indirect rows                                                                                       | `Tests 1 failed \| 8 passed (9)`; same case; `expected [ …(2) ] to deeply equal []` — two entries, one per indirect row                                                                                                                                                                                                                                                                                                                                          | RED as predicted                              |
| `M9`          | `plan-actions.tsx`            | quote `"team-switcher"` in a comment                                                          | "no mention of an id recorded as unwired" red, naming `team-switcher`                                                                               | `Tests 1 failed \| 8 passed (9)`; failed: _finds no mention of an id recorded as unwired in any screen module_; `expected [ Array(1) ] to deeply equal []`                                                                                                                                                                                                                                                                                                       | RED as predicted                              |
| `M10`         | test                          | empty one unwired row's reason                                                                | "states a reason" red, naming the row                                                                                                               | `Tests 1 failed \| 8 passed (9)`; failed: _states a reason for every row recorded as unwired_; `expected [ 'team-switcher' ] to deeply equal []`                                                                                                                                                                                                                                                                                                                 | RED as predicted                              |
| `M11`         | test                          | reword one reason without emptying it                                                         | **GREEN** — the reasons are prose, not pinned text                                                                                                  | `Tests 9 passed (9)`                                                                                                                                                                                                                                                                                                                                                                                                                                             | GREEN as predicted (over-sensitivity control) |
| `M12`         | test                          | swap two inventory entries' order                                                             | **GREEN** — every comparison is sorted, so entry order carries nothing                                                                              | `Tests 9 passed (9)`                                                                                                                                                                                                                                                                                                                                                                                                                                             | GREEN as predicted (over-sensitivity control) |
| `M13`         | test                          | _(structural, before the round)_ delete the "wired through a variable, so not a literal" case | it cannot fail on its own                                                                                                                           | see below                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Case deleted                                  |

**`M2`'s prediction was half wrong, and reporting it is worth more than the row.** I predicted both
the literal case and the trigger-component case would fail by a throw from `sourceOf`. Only the second
did. The literal case never calls `sourceOf` on a module that is not in the scanned set — it filters
over `MODULES`, every member of which is by construction present — so it failed by ordinary assertion
with three mismatched rows, not by an error. The prediction and the mechanism disagreed, and the
mechanism was right; a driver that had only counted failures would not have exposed it.

**`M13` is why a case was deleted rather than kept.** The suite originally held a case asserting that a
row wired through a variable carries no literal trigger. Its condition is identical to one the literal
case already evaluates — for such a row the literal case records an empty expected set, so any edit
that would redden the extra case reddens the literal case first, and for the same reason. The
standing discipline says a check believed redundant is a hypothesis to be mutated rather than filed;
mutating it confirmed it could not fail alone, and it was deleted. That deletion is recorded in the
suite's own header so the next reader does not re-add it.

**One case's assertions were split rather than mutated as a group.** The scan precondition originally
held four assertions in one case, and only two of them were reachable by any mutation — an assertion
behind a sibling that fails first is never reached. It is now two cases: one derived from the
inventory rather than naming modules by hand, one for the exclusion. `M2` and `M1` prove them
separately.

---

## Gates

All run on the final tree. Evidence is the summary line, not an exit code.

- `test:cc-guards`, the whole set, with `GATE_RECEIPTS=refresh`: `Test Files 37 passed (37)`,
  `Tests 819 passed (819)`. The receipt line names the new suite among the paths, so the gate ran it
  rather than merely listing it. One case writes a deliberate rejection to stderr — the trigger
  suite's "raises a rejection where an error boundary can state that nothing was written" — which is
  the behaviour under test, not a failure.
- `npx tsc -p tsconfig.json --noEmit`: exit 0, and no output at all. Read from `tsc` directly, never
  through a pipe. `tsconfig.json` includes `**/*.ts`, so the new suite is inside it.
- `npx eslint tests/caring-contacts-overlay-trigger-inventory.test.ts --no-cache`, after removing
  `node_modules/.cache/eslint`: `errorCount: 0 warningCount: 0`. Its first run was **not** clean —
  `@next/next/no-assign-module-variable` rejected two loops declaring a variable named `module`, and
  the per-file cache would have hidden that on any later run.
- `npx prettier --check` over every changed file: `All matched files use Prettier code style!` The
  report needed a `--write` pass first and the re-check is the evidence.
- No lock refusal in either shape on the final gate.

`tests/source-control-bytes.test.ts` is inside `test:cc-guards` and covers the literal-backspace trap;
no `\b` was written into this task's sources, in a regex or anywhere else.
