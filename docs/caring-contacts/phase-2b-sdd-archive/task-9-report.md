# Task 9 report — stage 4, review and activation

**Branch:** `claude/browser-test-gate-handoff-d5c1db`. Committed locally; nothing pushed, no PR.

**Commits:**

| SHA         | What                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------- |
| `12f8e0ad1` | **Not mine, and this is a finding.** Another session's docs commit swept in my first two files |
| `1cb79ad5d` | `plan-activation.ts` — the pure half — and its 16 cases                                        |
| `399904cd8` | The draft carries `activation` and `submission`, in the type, the empty draft and the parser   |
| `451231a49` | Stage 4 itself: the body, the write, the confirmation overlay, and `stages.ts` flipped         |
| `284e891aa` | Test-harness corrections: one render tree, and `fireEvent` for the date inputs                 |
| `a54388fac` | Stage 4's fields in Task 7's draft fixture; branded ids in the new test                        |
| `2693405f8` | This report                                                                                    |
| `a0e806ae4` | Formatting                                                                                     |
| `54d96b3af` | An unused setup dropped, found by lint                                                         |
| `0b8239040` | `onActivate` typed as returning what it returns                                                |
| `5f009e095` | **A mutation reverted** — one my own `git add -A` had committed; see the mutation section      |
| `0e205b338` | Mutation log, first version                                                                    |
| `dfa1425e8` | Gate evidence                                                                                  |
| `74990ca25` | The full suite, green                                                                          |
| `bbf3dbd0d` | The mutation round rewritten, and the finding that voided most of it                           |
| `c54aad72e` | Which tree each gate ran against                                                               |

(`b6c524dbc`, the owner's Ruling 122 on storing the assurances, landed on this branch mid-task from
another session. Nothing in it conflicts with this work and I have left it exactly as it is.)

**The working tree is not clean at handover, and the dirt is not mine.** `plan-wizard.tsx` carries
another session's in-flight mutation. I left it there deliberately rather than running
`git checkout --` again: discarding it would break their round exactly as theirs broke mine. Every
line of my own work is committed.

---

## 0. A finding before anything else: another session is committing in this worktree

At 20:57 a commit titled `docs(caring-contacts): round 3 — the missing mutation, and what "proved"
means` landed on this branch. Its message describes only `phase-2b-build-record.md` and
`task-8-report.md` work — but its diff also contains **`src/lib/caring-contacts/schedule.ts` (+36)
and `tests/caring-contacts-schedule.test.ts` (+71)**, which are mine: the `firstContactDayBounds`
export and its three cases, written and green minutes earlier and not yet committed. That session
ran `git add -A` and swept my working tree into its commit.

Nothing was lost and nothing conflicts, so I have not tried to unpick it. But it is worth saying
plainly because of what it could have cost rather than what it did: that session is doing **mutation
testing**, which means `git checkout --` against files in this worktree. Had it reverted a mutation
while my uncommitted edits were in the same file, my work would have gone. I committed every piece
immediately from then on, including one deliberately untested intermediate commit, for exactly that
reason.

**Recommendation:** one worktree, one session. If two are unavoidable, the second should stage paths
explicitly rather than `git add -A`.

---

## 1. What was built, file by file

| File                                                                      | What changed                                                                                                        |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/components/caring-contacts/workspace/plan-wizard/plan-activation.ts` | **New.** What stage 4 collects, what it derives, the body it sends, and the words for every refusal. Pure.          |
| `src/components/caring-contacts/workspace/plan-wizard/plan-wizard.tsx`    | `ReviewStage`, the `activate()` write, the minting, the created state, `DateField`, `RefusalStatement`.             |
| `src/components/caring-contacts/workspace/plan-wizard/plan-draft.ts`      | `activation` and `submission` added to `PlanDraft`, to `emptyPlanDraft` **and to `parseDraft`**.                    |
| `src/components/caring-contacts/workspace/plan-wizard/stages.ts`          | `review` flipped to `{ kind: "built" }`; the false coverage claim about `assertBuiltStageHasABody` corrected.       |
| `src/lib/caring-contacts/schedule.ts`                                     | `firstContactDayBounds` — the days a screen may offer, derived from the three constants the refusal is enforced by. |
| `package.json`                                                            | `test:cc-guards` gains `tests/caring-contacts-plan-activation.test.ts`.                                             |

Tests added: `tests/caring-contacts-plan-activation.test.ts` (16 cases).
Tests extended: `tests/caring-contacts-plan-wizard.dom.test.tsx`, `tests/caring-contacts-plan-draft.dom.test.tsx`,
`tests/caring-contacts-schedule.test.ts`.

---

## 2. The rulings, and how each was implemented

### Ruling [117] — the write, and the three orderings

`activate()` in `plan-wizard.tsx` is the whole of it, and it is deliberately linear so the ordering
can be read off the source rather than reasoned about:

1. **Confirm success → clear the draft → navigate.** `clearPlanDraft()` is called only after
   `answer.ok`, and `router.push` only after that. A test records the order from inside the `fetch`
   stub and from inside the `push` mock and asserts the exact sequence
   `["fetch-answered", "draft-still-held", "navigate-after-clear"]`. Both reversals would have passed
   a test that only checked the end state.
2. **On ANY failure the draft survives.** Nothing but the successful path touches the draft. Five
   failure shapes are covered by one case — a lost connection, a permission refusal, an existing
   plan, a schedule refusal, and an answer that is not JSON — and each asserts the patient's name is
   still readable out of storage and that nothing navigated.
3. **The refusal says which failure it was, in place.** `submissionRefusalWording` is a total map
   from refusal name to a three-part §4.4 statement, and its **default names the refusal verbatim**.
   A property test walks twenty named refusals plus one nobody has written and requires each to have
   a reason and a remedy, to avoid "something went wrong", and to say the draft survived.

**One thing the API surfaces that this screen cannot distinguish, stated rather than papered over.**
`writeHandler` answers a cross-team write with `not-found` on purpose, so a cross-team actor cannot
learn the record exists. The screen therefore cannot tell "another team's referral" from "nothing
there", and its `not-found` wording says exactly that rather than guessing.

### Ruling [120] — minted once, together, held in the draft

`mintPlanSubmissionIdentity()` returns both, and the draft holds them. There are two arrival points
at stage 4 and both go through that one function: `goTo("review")` mints in the same write that moves
the stage, and an effect covers a stored draft that already names `review` (a reload, or a draft
written before this build). Neither re-mints.

The retry property is tested directly: two confirmations, the first refused with `service-stopped`,
and the two request bodies must carry the same `planId` **and** the same `idempotencyKey`.

**The minted identifiers contain no digits at all, and that is not decoration.**
`ACCESS_OBJECT_ID_PATTERN` would accept a bare UUID, but `audit.ts` scans every field of an assembled
audit event against an Australian mobile-number pattern and **throws** on a match — and a random
hexadecimal string can produce an eleven-digit run. Rare rather than impossible is the worst kind:
the plan is created and the audit record for it cannot be built. So the UUID's hex is mapped to
sixteen letters, and the hazard is removed by construction. A test mints two hundred pairs and puts
each through `buildAccessAuditEvent` itself — the real guard, not a regex written in the test.

### Ruling [118] — the first-contact control, and its consequence

The domain half is used, never rebuilt. `firstContactDayBounds` (new, in `schedule.ts`) publishes
`usual`, `earliest` and `latest` derived from the same three offset constants `buildApprovedSchedule`
refuses against; the date input's `min`, `max` and default are read off it. Whether a value is
acceptable is never decided by the screen: `planSchedulePreview` builds the real schedule and reports
the domain's own named refusal, so `first-contact-invalid-date`, `first-contact-out-of-range`,
`first-contact-reason-required` and `first-contact-reason-too-long` all reach the clinician as four
distinguishable statements.

**The consequence is shown while the date is being chosen.** Moving the first contact to discharge +
7 suppresses Week 1, and the screen renders an `AutomatedState` naming Week 1, saying why, saying
what would change it, and stating that the plan will send nine messages rather than ten — in the same
panel as the control, before anything is confirmed. On the usual day nothing of the kind appears; a
test asserts both directions.

Whether to **ask** for a reason is decided by comparing the chosen day against the published `usual`
day — the same value `buildApprovedSchedule` compares against. That is the one place the screen makes
a decision adjacent to a domain rule, so it is pinned as a property: a test walks every day the
control can offer and requires the screen's answer to agree with what the domain does when no reason
is supplied.

### Ruling [119] — every count derived, and no false reassurance

**Counts.** `sendableContacts` in `hospital-events.ts` is the function the store itself uses when it
decides which planned entries to create as `scheduled` and which as `suppressed`, so the preview and
the plan cannot disagree. `total`, `stillToSend`, `willNotBeSent` and `closing` come from it and from
`PlannedContact.messageType`; nothing on the screen is a literal. The closing message is labelled as
its own kind, never as one more caring contact.

**The pin.** The ruling names `contactSendability()` and `summariseStoredContacts()`. The second one
cannot be called from this screen — see finding 3 — so it is used where it can be: a test creates a
plan in the in-memory store from the same input and requires `summariseStoredContacts` over the
contacts that store really built to agree with the preview, for both the usual day and discharge + 7.
That is the only assertion in the task that can fail honestly; every other count is compared against
a number written in the test.

**`Agreement confirmed: Yes` is not presented as a stored fact.** The phrase does not appear. What
the screen says instead is today's fact, in a `StatedReason`: the confirmations were made by you in
this sign-up, they are not facts read from a record, and they are **not recorded on the plan**.

The wording is deliberately about today rather than about a permanent property, on the coordinator's
mid-task note: the owner has decided these confirmations **will** be stored as an attestation, which
is a schema change and a later task. "Not recorded on the plan" is true now and becomes false in one
place when 9b lands. "Nothing in this domain records them" would have had to be hunted for.

### Ruling [121] — `dischargeAt` is collected here

A `type="date"` field labelled "Day the patient was discharged", **immediately beside** the
first-contact control in the same panel, under a heading that says why they are together. It starts
empty rather than defaulted to today: a discharge day the screen guessed is a clinical fact it
invented, and every date in the plan is counted from it.

The absence of a source is stated in place, in §4.4's shape, because an input for a value the
approved design shows arriving from a hospital record otherwise reads as an oversight.

`dischargeInstantFor` turns the chosen day into **midday AWST**. The hour is the screen's decision,
not the domain's: `buildApprovedSchedule` reads only the AWST calendar day, so the time changes
nothing about the schedule — but it changes what every other reader of the stored instant sees, and
midday is the one hour that lands on the chosen day under any conversion. UTC midnight for the same
day is 08:00 AWST, and anything the clinician might have meant before that lands on the day before.

### The one overlay wired

`final-activation`, through `WorkspaceOverlayTrigger`. When the plan cannot be created the commit is
`{ kind: "unavailable", reason }` and the reason names what is missing in the clinician's own terms,
so the overlay opens and states it rather than leaving a dead control behind it. Tests prove the
write does not fire on opening, that it does fire on the overlay's own decision control, and that an
unavailable commit's control is `aria-disabled` and inert.

---

## 3. Findings I am reporting rather than fixing

### Finding 1 — the write creates a plan in `draft`, and this screen is called "activation"

> **RULED, fix round 1: stage 4 does both writes.** The frozen row's title — "Last check before the
> plan starts" — already said the wizard is the activation workflow, so the matrix was right and the
> code did half of it. Implemented in `111cc3529`; see fix round 1 below. The finding is left here
> unedited because the reasoning it records is what the ruling corrected.

`createPlan` records `plan.state = "draft"`. Starting a plan is `activatePlan` — a **separate write,
on a separate route** (`/api/caring-contacts/plans/[planId]`), carrying its own `expectedVersion` and
needing its own idempotency key. Ruling [117] names one POST and Ruling [120] mints one key, so I
performed one write and did not invent a second.

The consequences, all three of which are yours to rule on:

- **The screen says what it does.** Its control reads "Create this plan", and a `StatedReason` above
  it says confirming creates the plan and its schedule, that the plan is created in draft and is not
  running, that starting it is a separate step this workspace does not have, and that nothing is ever
  sent from this prototype whatever state a plan is in.
- **The frozen overlay copy does not.** `final-activation`'s `decision` is **"Confirm and activate"**
  and its `title` is "Last check before the plan starts". Those are transcribed from
  `docs/caring-contacts/interaction-matrix.md` and I have not touched them. So the button inside the
  overlay says "activate" while the commit creates a draft plan. **I consider this the most important
  thing in this report.** It is the same class of overstatement as `Agreement confirmed: Yes`, one
  surface over, and I could not fix it without either editing frozen copy or performing a second
  write nobody has ruled on.
- **Two ways out, and I recommend the first.** Either (a) rule that stage 4 performs create **and**
  `activatePlan`, which is genuinely retry-safe — a replayed create returns the first attempt's own
  answer, so the pair can be retried end to end — and needs a second minted key plus a
  partial-success wording; or (b) amend the `final-activation` row to name creation. (a) matches the
  matrix, the stage's own name and `stages.ts`'s purpose line ("the control that starts it"); (b) is
  smaller but leaves the product with a plan nothing can start.

### Finding 2 — `stages.ts` claimed a proof that did not exist, since Task 7

The comment read: "`assertBuiltStageHasABody` in the wizard throws rather than rendering a stepper
over an empty column, and `tests/caring-contacts-plan-wizard.dom.test.tsx` proves it fires."
**Nothing did.** No test called it, and no render reached it.

This is the shape Task 8's round 2 named — a mechanism nobody has run, written down as coverage — and
it was sitting in the one guard protecting the exact mistake Tasks 8 and 9 could each have made:
flipping a table entry to `built` and not writing the body. It is also the shape that could not have
been caught by accident, because the guard is only reachable from a state the codebase never enters.

Fixed rather than only reported: the function is exported and called directly, in both directions
(throws on a missing body, returns the body when there is one), and the comment now says where the
proof is and why it had to move.

### Finding 3 — Ruling [119] names a function this screen cannot call

`summariseStoredContacts` takes `StoredContact` — a plan that already exists — and lives in
`repository.ts`, which names the service-state module in its own imports.
`tests/caring-contacts-explained-automation.dom.test.tsx` scans the wizard's whole client module
graph for that name, because the service-state record carries a free-text incident note that must
never cross this boundary. Importing it here would have made that guard red, and weakening the guard
to satisfy a ruling would be the wrong direction on both counts.

> **ADJUDICATED IN FAVOUR, fix round 1.** The coordinator's ruling was wrong on the mechanism and
> the test-side pin is better than what it asked for: it proves the screen's derivation against the
> domain's own answer without dragging `repository.ts` into the client module graph. **Do not "fix"
> this back to a direct import** — that would make the service-state guard red, and the guard is the
> one protecting a free-text incident note from crossing this boundary.

`contactSendability` is importable (it is in `model.ts`, already in the graph) but takes a
`ContactState`, which a planned contact does not have until the plan exists — so using it would have
meant the screen re-deriving the store's own planned-to-state mapping. `sendableContacts` **is** that
mapping's input in the store, so it is what the screen uses, and the store-agreement test is what
proves the two agree.

### Finding 4 — `UnbuiltStagePanel` and the unavailable forward control are now unreached

Every member of the stage union is built, so `planWizardStageImplementation` returns `not-built` for
nothing. `UnbuiltStagePanel`, `ForwardControl`'s unavailable branch and the `UnavailableDestination`
import in this file are all **unreached, not dead**: they are the extension point a fifth stage would
use, and Ruling 52 is what they implement. Stated at both sites rather than deleted, and named here
so a dead-code sweep meets an explanation rather than a reachability scan.

### Finding 5 — `MESSAGE_TYPE_LABELS` now exists twice

`PLANNED_MESSAGE_TYPE_LABELS` in `plan-activation.ts` holds the same three strings as
`MESSAGE_TYPE_LABELS` in `patient-overview.tsx`, and nothing keeps them in step. The overview's
cannot be imported (finding 3's reason). The right home is a module both can import — a small
wording module beside the domain, or the sealed domain itself. Not done here because it means moving
a constant out of a screen this task does not own.

### Finding 6 (carried) — the assurances still are not stored

Task 7's finding 1 and Task 8's finding 4. Now settled by the owner as Task 9b, per the coordinator's
note: the confirmations will be stored as an attestation. Stage 4's wording was written for that (see
Ruling [119] above) and the request body is assembled in one place (see §4) so 9b's fields are an
additive change.

---

## 4. What Task 9b and Task 11 inherit

**For Task 9b — the request-body seam (Ruling [122]).** `createPlanRequestBody` in `plan-activation.ts` is the
**only** place the POST body is assembled. It takes named parts (`submission`, `referralId`,
`patientId`, `pathwayVersionId`, `activation`, `sendingPreference`, `patientDetail`), returns the ten
keys `createPlanSchema` accepts or `null`, and `activate()` does nothing to it but stringify it.
Adding an `assurances` part is one parameter and one key there, plus the draft field it reads from —
no literal anywhere in the submit path, and no fixture holding a hand-written body.

Ruling [122] puts the attestation **on the plan rather than in `patientDetail`**, which is the easier
of the two for this seam: `patientDetail` is taken whole from `createPlanPatientDetail`, while the
plan-level keys are named individually in the return object. A list rather than a fixed pair is
likewise additive here — one more named part in, one more key out.

The draft already holds what 9b needs to send: `PlanDraftAssurances` survives a reload and reaches
stage 4 as a prop (`assurances`), which stage 4 already reads to write its own read-back sentence.

Its test is likewise not a copy of the schema: the body is **POSTed to the real route handler** with
an in-memory store, so `.strict()`, every `min(1)` and the `auditableIdentifier` shape are enforced by
the thing that will enforce them in production. A field added to the schema and not to the body will
fail there rather than silently.

**For Task 11 — the seams stage 4 leaves.** No overlay but `final-activation` is wired.

| Overlay id           | What the mockup opens it for from this stage | Note                                                                                                                                               |
| -------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `message-preview`    | The `MessagePreviewCard`                     | Patient-visible copy belongs to the sealed `message-copy`. Stage 4 renders none and says the wording comes from the pathway version.               |
| `adjust-date-time`   | "Adjust schedule"                            | **Now built into the stage** as the first-contact control (Ruling [118]). This overlay and that control would be the same thing twice.             |
| `activation-success` | After a successful activation                | Stage 4 renders an in-flow created panel and navigates instead. If this overlay is wanted, it replaces that panel.                                 |
| `save-draft`         | "Save draft"                                 | Task 8's recommendation stands: there is nothing to wire, the draft saves on every keystroke, and a control implying otherwise is worse than none. |
| `discard-changes`    | A discard confirmation                       | The wizard's real "Discard draft" control is unconfirmed. If this becomes a confirmation, it wraps that control.                                   |

---

## 5. Verification

### Test-first

**All four pieces, test-first, and each was run and seen red for its stated reason before the code
existed:**

- `firstContactDayBounds` — three cases written first: `TypeError: firstContactDayBounds is not a function`, then `Tests 26 passed (26)`.
- `plan-activation.ts` — sixteen cases written first: `Error: Cannot find package '@/components/…/plan-activation'`, then `Tests 16 passed (16)`.
- The draft's new fields — three cases written first, `3 failed | 16 passed (19)`, each failing on the parser accepting a draft it should have refused or on a field that did not exist.
- Stage 4 itself — the DOM cases written first: `22 failed | 32 passed (54)`, every one of the twenty-two unable to reach a stage that had no body.

### Mutation log — every attempt, itemised, no aggregate

**Read the next section first.** Another session is running its own mutation round in this same
worktree, concurrently, and it corrupted most of this one. What survives is the four mutations whose
failure message names the mutated value itself, so no interleaving could have produced it.

**Trustworthy — the failure message identifies the mutation, not merely a red test:**

| #   | Mutation                                                                        | Predicted                                                                                                             | Observed                                                                                                                                                                                    | Verdict                 |
| --- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| M1  | `mintPlanSubmissionIdentity` returns a constant pair                            | 1 red on "mints a different pair every time"                                                                          | `Tests 1 failed \| 15 passed (16)`, `AssertionError: expected 'PLAN-constant' not to be 'PLAN-constant'` — the mutated literal is in the message. Reproduced identically on a second run    | RED, prediction matched |
| M2  | `lettersFromRandomIdentifier` returns the raw UUID, digits and all              | 1 red on the digit assertion; its `buildAccessAuditEvent` sibling passes first                                        | `AssertionError: a minted identifier carries a digit, so it could one day read as a number: expected 'PLAN-376a19682f254501ad634ee804bae620' not to match /\d/`                             | RED, prediction matched |
| M3  | `dischargeInstantFor` drops the domain parse, keeping only the round-trip guard | 1 red on "answers null for anything that is not a real AWST calendar day", as a thrown error rather than an assertion | `FAIL … answers null for anything that is not a real AWST calendar day`, `RangeError: Invalid time value` — thrown from `toAwstParts` on the `Invalid Date` the missing parse let through   | RED, prediction matched |
| M4  | `planSchedulePreview` reports `stillToSend` as every entry                      | 3 red: the discharge + 7 case, the store-agreement pin, and the wizard's in-place consequence                         | Exactly 3, with the exact numbers: `expected 10 to be 9`, `discharge + 7: the preview promises a different number of messages: expected 10 to be 9`, and the wizard's `toHaveTextContent()` | RED, prediction matched |

**M4 is the one worth pausing on**, because it is the assertion this task leans hardest on. The
second of its three failures is the store-agreement pin — the preview disagreeing with
`summariseStoredContacts` over a plan the in-memory store really built. That is the pin doing exactly
what it exists to do, and it is the only one in the task that could not have been satisfied by the
preview agreeing with itself.

**Void — applied, run, and NOT trustworthy:**

| #     | Mutation                                                                       | Status                                                                                                    |
| ----- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| M5    | `firstContactReasonIsRequired` compares against `earliest` not `usual`         | ran; reported M3's failure, which its own change cannot cause                                             |
| M6    | `createPlanRequestBody` sends `firstContactReason: ""` rather than omitting it | ran; reported M4's failure                                                                                |
| M7    | `submissionRefusalWording`'s default heading becomes "Something went wrong"    | ran; reported M5's predicted failure                                                                      |
| M8    | `sendableContacts` replaced by a local "not the closing message" filter        | ran; reported M6's predicted failure                                                                      |
| M9    | `activate()` clears the draft BEFORE the fetch                                 | ran; 4 red, all explainable by M9 — but see below, and "explainable" is not proof                         |
| M10   | `activate()` navigates BEFORE clearing                                         | ran; 2 red, one of them M13's                                                                             |
| M11   | `goTo` mints on every arrival at review                                        | ran; its own failure appeared, and its mutation was still in the tree afterwards                          |
| M12   | The first-contact field's `min`/`max` dropped                                  | ran; its own case did NOT fail, which is the clearest sign of contamination                               |
| M13   | The absorbed-contact `AutomatedState` never rendered                           | ran; its own failure appeared, alongside M11's                                                            |
| M14   | `parseSubmission` answers `null` instead of `undefined`                        | ran; its own failure appeared                                                                             |
| M15   | `parseActivation` returns an empty activation instead of null                  | ran; its own failure appeared                                                                             |
| M16   | `firstContactDayBounds.latest` is one day too late                             | ran; its own failure appeared, naming `2026-03-18`                                                        |
| M17\* | **Control.** The schedule summary's `data-testid` renamed — expected GREEN     | ran; came back RED with M11's and M13's failures, which is contamination, not a finding about the control |

Several of the void rows probably did fire correctly. **That is exactly why they are void rather
than reported:** on a tree a second process is editing, "the right test went red" and "some test went
red" are indistinguishable, and reporting the first when you have only established the second is the
failure this programme keeps catching. They should be re-run in a worktree nobody else is writing to;
the table above is written so a reviewer can do that without rebuilding it.

### The finding that voided them: two sessions mutating one worktree

**Proved rather than inferred, and the proof is two consecutive commands.** After my batch had
finished and its driver had exited, `git status` reported
`M src/lib/caring-contacts/schedule.ts`; the very next command reported
`M src/components/caring-contacts/workspace/plan-wizard/plan-wizard.tsx` and nothing else. Nothing of
mine was running. A third check found `plan-activation.ts` modified. **Another session is applying
and reverting mutations in this worktree, right now, interleaved with mine.**

That also explains the first batch's shape, which I had wrongly begun to diagnose as my own
off-by-one: from M5 onward each run reported the previous-but-one mutation's failure, and after the
batch `plan-wizard.tsx` still carried M11's mutation — a revert of mine that another process had
overwritten in between.

**What I did about it, and what I deliberately did not.** I rewrote the driver to revert with
`git checkout --` rather than from an in-memory copy, to assert `git diff --quiet` after every
revert, and to prove each mutation visible **to a separate process** with `grep -c` before running
the gate — because a driver comparing its own write against its own read proves nothing about what
node reads. That driver refused to start on a dirty tree, which is how the leftover was caught, and
then stopped itself at M1 with `reverted, git says clean = False` rather than continuing on a tree it
could not vouch for. **Stopping was the correct outcome and the driver is right, not broken.**

What I did NOT do is keep running `git checkout -- .` to clear the way. I did it three times before I
understood what was happening, and each of those may have discarded the other session's in-flight
mutation mid-run — the same harm to them that theirs did to me. Once the cause was clear I left their
working-tree state alone.

**The committed content is unaffected, and I checked rather than assumed.** `git show HEAD:<file>`
for all four changed source files finds no mutation marker from my table; the two regex hits are
`total: schedule.contacts.length` (correct code) and the phrase "Something went wrong" inside the
comment that forbids it. The two gates below both ran to completion with zero failures, which a live
mutation in the tree could not have produced.

**The recommendation from §0 is now stronger than a preference.** One worktree, one session. Two
sessions sharing a worktree cannot both do mutation testing, cannot both trust `git status`, and
cannot both use `git add -A` — and today all three went wrong.

### A mutation I committed, by my own hand

Recorded in full because it is the failure the brief warns about, met from the other side.

`b5e21f2cf` — a documentation commit — carried **M1 in the tree**: `mintPlanSubmissionIdentity`
returning the constant pair. I had run `git add -A && git commit` for a report edit while a mutation
driver had M1 applied. Reverted in `5f009e095`, and the tree was verified clean afterwards rather
than assumed.

The brief's rule is "commit each piece before you mutate the file it lives in", and its reason is
that `git checkout --` discards an uncommitted fix. **This is its converse and it needs the opposite
discipline: never `git add -A` while a mutation is live.** The two together are one rule — the
working tree during a mutation round is not yours to stage — and I had internalised only the half the
brief spelled out.

### Gates

**The guard set, `npm run test:cc-guards`** — run during iteration and at the end:

```
 Test Files  18 passed (18)
      Tests  364 passed (364)
   Duration  98.24s (transform 6.47s, setup 4.79s, import 16.21s, tests 115.96s, environment 22.49s)
```

Membership grew by one, `tests/caring-contacts-plan-activation.test.ts`, which is this task's own.
The set went from 17 files and 325 cases to 18 and 364.

**Typecheck and lint.** Both were run directly (`npx tsc --noEmit -p tsconfig.json`, `npx eslint …`)
rather than through the npm wrappers, because the wrappers take the repository's heavy lease and it
was held throughout by another worktree. Both are clean, and lint was not clean the first time — it
found an unused `userEvent.setup()` in the discharge-day case, fixed in `54d96b3af`.

```
$ npx tsc --noEmit -p tsconfig.json
(no output)

$ npx eslint src/components/caring-contacts/workspace/plan-wizard src/lib/caring-contacts/schedule.ts     tests/caring-contacts-plan-activation.test.ts tests/caring-contacts-plan-wizard.dom.test.tsx
(no output)
```

Two typecheck failures were found and fixed on the way: branded `ActorId`/`TeamId` in the new test,
and Task 7's whole-draft fixture missing stage 4's two fields.

**Prettier:** `npx prettier --write` over every file in this diff; the last run reports every one
unchanged.

**Which tree each gate ran against, because it matters here.** Both gates ran on the source as it
now stands: every commit after `5f009e095` (the mutation revert) touches this report and nothing
else, verified with `git log --name-only`. Both also ran to completion with zero failures, which a
live mutation from the concurrent session could not have produced — that is the reason to believe the
tree was its own during those two runs rather than an assumption about it. I did not re-run either
afterwards, because the working tree currently carries another session's in-flight mutation and a run
now would report their change as mine.

**The full suite, `npm run test`, once, at the end — and backgrounded from the first command, which
is Task 8's lease lesson applied rather than restated:**

```
 Test Files  835 passed | 3 skipped (838)
      Tests  10160 passed | 74 skipped (10234)
   Duration  694.30s (transform 70.50s, setup 120.72s, import 312.56s, tests 1391.85s, environment 455.68s)
```

**Clean, and it took four attempts to get a lease at all.** The exclusive lease was held for a long
stretch by `D:\Worktrees\Database\care-plan-impl`, re-acquiring for `playwright
--project=chromium-mockups` within seconds of each release. Every refusal was treated as neither a
pass nor a failure and retried; ownership was read from the lease record's own `worktree` field
rather than from a live PID, and **nothing was forced** — no lock file was touched and no other
worktree's process was signalled.

```
Error: Database focused-test capacity is full (current owner PID 61748, worktree
D:/Worktrees/Database/care-plan-impl, started 2026-08-25T13:17:23.740Z):
playwright --project=chromium-mockups tests/ui-care-plan-mockup.spec.ts
```

This matters beyond the wait, and it is why it is recorded rather than mentioned: the guard set is a
SELECTED eighteen files, and the full suite is what confirms the selection was right. This task
touches `src/lib/caring-contacts/schedule.ts`, whose importers include
`tests/caring-contacts-hospital-events.test.ts`, `tests/caring-contacts-repository.test.ts` and
`tests/caring-contacts-postgres-repository.test.ts` — none of which is in `test:cc-guards`. The
addition there is pure and touches nothing existing, but "I do not expect a regression" is not
evidence and the run above is.

### The browser gate

**No, I do not believe this touches `tests/ui-caring-contacts-workspace.spec.ts`, and I did not
change it.** The reason is unchanged from Tasks 7 and 8, and I checked it rather than inherited it:
that spec's isolated Playwright server seeds no referrals, so `/caring-contacts/plans/new` always
renders "No referral named" and no Playwright case can reach any stage of this wizard. Everything
Task 9 built is inside a stage.

That is a coverage gap rather than a clean bill of health, and stage 4 widens it in a way worth
naming: **two date inputs, a live schedule preview and a confirmation overlay have no browser
evidence at all.** The tap-target assertions here read the CLASS, not the rendered box, because jsdom
has no layout; `type="date"` renders a native picker whose real height and forced-colours behaviour
jsdom cannot show; and the overlay's `full-screen-stage` phone modality has never been seen with this
screen behind it. It cannot be closed until that server seeds a referral.

### Not run, and why

- `npm run verify:ui`, `verify:phone-chrome` — you run the browser gate, and see above for why it cannot reach this stage today.
- `npm run verify:cheap`, `verify:pr-local`, `verify:release` — not asked for; the last is provider-backed.
- Nothing provider-backed was run at all. No Supabase, no OpenAI, no GitHub, no CI.

---

# Fix round 1

Both items done. The worktree was mine alone for all of it, so **every mutation result below is
fresh** — nothing is carried from the contaminated round, including the four that survived it.

---

## 1. Stage 4 creates the plan AND starts it (Ruling [123])

Commit `111cc3529`.

The ruling is right and my report had the evidence backwards: I read the frozen row's `decision`
("Confirm and activate") as copy that overstated the code, and did not read its `title` — _"Last
check before the plan starts"_ — which says plainly that the wizard is the activation workflow. The
matrix was describing the product; the code was doing half of it.

**What the flow is now.** `createPlanRequestBody` → `POST /api/caring-contacts/plans` →
`planVersionFromCreateAnswer` → `activatePlanRequestBody` →
`POST /api/caring-contacts/plans/<id>` with `action: "activate"`.

**Three identifiers, minted once together when stage 4 is first reached, all three held in the
draft.** `PlanSubmissionIdentity` is now `{ planId, createIdempotencyKey, activateIdempotencyKey }`.
The second key is a third independent value, not the first reused and not derived from it:
`runWrite` scopes a key to `(team, key)` and fingerprints the method and input under it, so a key
that answered the create and is then sent with the activate is refused outright as
`idempotency-key-reused-for-a-different-write` — the plan would exist and could never be started.
**N1 proves that is not theoretical**: sending the create key with the activate makes the real
lifecycle route answer `{"refusal":"idempotency-key-reused-for-a-different-write"}`, 409.

A derived key is refused for the same reason a copy of any rule is: it is a second copy of the first
key's uniqueness and stops being unique the moment the derivation changes. N2b proves the assertion
that forbids it.

**`expectedVersion` comes from the create's own answer.** `planVersionFromCreateAnswer` reads
`value.plan.version` and validates every step of that shape, because it arrives over the wire. It
answers **null rather than a default** when it cannot: a default would be a guess wearing a number,
and the refusal it earned would be about concurrency rather than about the answer this screen could
not read.

**Created-but-not-started is a real state, and it is built as one.**

- Its own status (`created-not-started`), reached only after the create has succeeded.
- **Its own wording table.** `submissionRefusalWording` says "Nothing was created" in every branch —
  true of the first write and false after it. A coordinator told nothing was created starts the
  sign-up again, and that patient gets a second plan. So `activationRefusalWording` is separate, and
  a test walks all thirteen refusal names requiring each to say three things: the plan was created,
  it has not started, and confirming again finishes _the same plan_. `RefusalStatement` takes the
  lookup as a parameter, because `service-stopped` means "nothing exists" before the create and "a
  plan is waiting to start" after it, and one table for both would have to print a sentence that is
  false in one of the two cases.
- **The draft is KEPT.** This is the refinement Ruling [117] needed and the reason is Ruling [120]'s
  mechanism doing its job: the draft holds the plan id and both keys, which is the only thing that
  distinguishes "try again" from "create a second plan for this patient". `clearPlanDraft()` now runs
  only after **both** writes are confirmed.
- One branch is deliberately different. `plan-not-draft` on a retry usually means the first attempt
  _did_ start the plan and this screen never saw the answer — a success wearing a refusal — so that
  branch sends the coordinator to look at the plan rather than telling them to press again.

**All three outcomes are mutation-proved**, which was the explicit ask:

| Outcome                         | Mutation                                                                      | What went red                                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Both succeed                    | M10 (navigate before clear), N7 (navigate after the create)                   | the two-write order assertion; `expected "vi.fn()" to be called 1 times, but got 2 times`                             |
| Create fails                    | M9 (clear the draft before the first write)                                   | `a lost connection: the draft was lost on a failed write: expected undefined to be 'Rowan Example'`                   |
| Create succeeds, activate fails | N4 (clear the draft on the half-done path), N5 (use the create-stage wording) | the KEEPS-the-draft case; and `expected 'Read back before this plan is created…' not to match /nothing was created/i` |

**Seven cases were added for this**, including one the ruling did not name and the code needed: a
create that answers 200 with no readable version. The plan exists, so the second write is **not**
attempted with a guess, and the screen shows the half-done state.

**On your closing note.** Thank you — and the part I want to keep is the correction rather than the
credit. Stopping at an honest screen was right; what was wrong was that I framed a _design_ question
as a _copy_ question, and recommended amending the frozen row as one of two equal options. The row
already contained the answer. "Read the whole artefact before proposing to change it" is the lesson,
and it is the same shape as Task 8's §2.5 finding one document over.

---

## 2. The mutation round, re-run on a quiet worktree

**24 mutations, all fresh, none carried.** Every one was applied, proved visible **to a separate
process** with `grep -c`, run, then reverted with `git checkout --` and confirmed by
`git diff --quiet` rather than by a string compare. The driver refuses to start on a dirty tree and
stops itself if a revert does not take; neither fired this time.

### Every attempt, itemised

| #     | Mutation                                                                | Predicted                              | Observed                                                                                                                                                       | Verdict                           |
| ----- | ----------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| M1    | `mintPlanSubmissionIdentity` returns constant identifiers               | 1 red, "mints a different pair"        | 2 red — also "mints a SECOND idempotency key": `expected 'PLAN-START-constant' not to contain 'constant'`                                                      | RED, blast radius under-predicted |
| M2    | letter mapping dropped; raw UUID used                                   | 1 red on the digit assertion           | 2 red, both the digit assertion: `expected 'PLAN-811160af…' not to match /\d/` and the same for the activate key                                               | RED, under-predicted              |
| M3    | `dischargeInstantFor` drops the domain parse                            | 1 red, thrown not asserted             | `RangeError: Invalid time value`                                                                                                                               | RED, matched                      |
| M4    | `stillToSend` counts every entry                                        | 3 red                                  | exactly 3: `expected 10 to be 9` twice, and the wizard's in-place consequence                                                                                  | RED, matched                      |
| M5    | reason-required compares against `earliest`                             | 1 red naming the first disagreeing day | `2026-03-10: the screen and the schedule disagree… expected false to be true`                                                                                  | RED, matched                      |
| M6    | `firstContactReason: ""` sent rather than omitted                       | 2 red: the real route, and the key set | exactly 2: `the route refused the body: {"refusal":"invalid-request"}: expected 400 to be 200`, and the key-set assertion                                      | RED, matched                      |
| M7    | default refusal heading becomes "Something went wrong"                  | 1 red on the unnamed refusal           | `a-refusal-nobody-has-written-yet is not explained: expected 'Something went wrong' not to match /something went wrong/i`                                      | RED, matched                      |
| M8    | `sendableContacts` replaced by a local "not the closing message" filter | 2 red                                  | 3 red — also the usual-day case: `expected 9 to be 10`, and `expected [ 'Month 12' ] to deeply equal [ 'Week 1' ]`                                             | RED, under-predicted              |
| M9    | draft cleared BEFORE the first write                                    | 2 red                                  | 10 red, every one explainable by it: the draft is gone, so stage 4 unmounts and the trigger, the refusal and the half-done wording all vanish with it          | RED, badly under-predicted        |
| M10   | navigate before clear                                                   | 1 red on the ordering case             | 2 red: the single-write ordering case AND the two-write one                                                                                                    | RED, under-predicted              |
| M11   | `goTo` mints on every arrival at review                                 | 1 red                                  | `the identifiers were minted again on a second visit, so a retry would create a second plan`                                                                   | RED, matched                      |
| M12   | first-contact `min`/`max` dropped                                       | 1 red                                  | `expect(element).toHaveAttribute("min", "2026-03-10")`                                                                                                         | RED, matched                      |
| M13   | the absorbed-contact `AutomatedState` never rendered                    | 1 red                                  | `Unable to find role="group" and name /suppressed/i`                                                                                                           | RED, matched                      |
| M14   | `parseSubmission` answers `null` for a malformed identity               | 1 red                                  | `a draft carrying half a minted identity was accepted`                                                                                                         | RED, matched                      |
| M15   | `parseActivation` returns an empty activation                           | 1 red                                  | `a draft missing two of its three activation fields was accepted`                                                                                              | RED, matched                      |
| M16   | `firstContactDayBounds.latest` one day too late                         | 1 red naming the day                   | `2026-03-18 is advertised as choosable and the schedule refused it`                                                                                            | RED, matched                      |
| M17\* | **Control.** the schedule summary's `data-testid` renamed               | **GREEN** — nothing asserts on it      | `Tests 61 passed (61)`                                                                                                                                         | **GREEN, as designed**            |
| N1    | activate sends the CREATE key                                           | 2 red                                  | 3 red, and the first is the one that matters: the real route answers `{"refusal":"idempotency-key-reused-for-a-different-write"}`, 409                         | RED, under-predicted              |
| N2    | activate key "derived" by stripping its prefix                          | 1 red                                  | **GREEN — and the mutation was the defective thing.** Stripping a prefix off a random value leaves it random, so it never changed the property under test      | GREEN on an ineffective mutation  |
| N2b   | activate key genuinely derived from the create key (a getter)           | 1 red on the `not.toContain` assertion | `expected 'PLAN-START-medipedkiifdehmojhnphpadng…' not to contain 'medipedkiifdehmojhnphpadngilnijk'`                                                          | RED, matched                      |
| N3    | `planVersionFromCreateAnswer` defaults to 1                             | 2 red                                  | 1 red: `expected 1 to be null`. The wizard's own case survived, because a create answering `{ value: null }` then activates and the version is never read back | RED, over-predicted               |
| N4    | the draft cleared on the half-done path                                 | 2 red                                  | 4 red, all four Ruling [123] cases that depend on the draft surviving                                                                                          | RED, under-predicted              |
| N5    | the half-done state uses the create-stage wording                       | 1 red                                  | `expected 'Read back before this plan is created…' not to match /nothing was created/i`                                                                        | RED, matched                      |
| N6    | `expectedVersion` hard-coded to 1                                       | 1 red                                  | `expected 1 to be 3`                                                                                                                                           | RED, matched                      |
| N7    | navigate and clear straight after the create                            | 7 red                                  | 7 red: three navigation-count cases and all four half-done cases                                                                                               | RED, matched                      |

**No anchor failed to match** except N6 on its first attempt, where Prettier had reflowed the call
across three lines between my writing the anchor and applying it — Task 8 recorded that same hazard
and I repeated it. Re-anchored against the file as it stands and re-run; the result above is that run.

### What this proves, counted rather than described

I own **52 cases** across three files in the review range (round 2, M1 -- the three `caring-contacts-schedule.test.ts` cases landed in the swept commit before the base, so they are outside it). Of those:

- **31 are proved alive** — at least one assertion in them was made to fail by a mutation.
- **21 were not touched by any mutation at all.** They are green and they are unfalsified.
- **1 is proved assertion-by-assertion**: "asks for one on exactly the days the schedule refuses
  without one", which has a single assertion inside a loop, so M5 falsifying it falsifies the case.
- **6 more have two distinct assertions individually proved** — the discharge + 7 preview (M4, M8),
  the in-place consequence (M4, M13), the half-done wording (N4, N5), the draft parser (M14, M15),
  the two-write order (N1, N6), and the second-key case (M1, N2b). None of those is complete: each
  still has assertions nothing has falsified.
- The remaining **24 are proved alive by exactly one assertion each**, which is the state Task 8
  called "alive rather than complete", and its count was four of about thirty.

**The honest reading of 1 of 52.** Assertion-by-assertion proof is expensive — a case with five
assertions needs five mutations or needs splitting into five cases — and I did not pay it for
forty-five of them. The three that most deserve it and have not had it are the store-agreement pin
(four comparisons, one proved), `planVersionFromCreateAnswer` (six inputs, one proved), and
`activationRefusalWording`'s thirteen-name walk (five assertions per name, none proved by a mutation
— N5 proves the SCREEN reaches that table, not that the table's contents are pinned). Those are the
first three to split if this is worth another round.

### Two things the round found that I would otherwise have written down as facts

**N2 is the one I most want on the record.** I wrote a mutation intended to derive the activate key
from the create key, and it came back green. My first instinct was that the assertion was weak. It
was not: stripping a prefix off a random value leaves a random value, so the mutation never changed
the property the assertion reads. **The brief's rule — check first that the mutation changes a value
some assertion reads — is the one I skipped, and a green would have been reported as a finding about
the test.** N2b does the derivation properly, with a getter, and goes red.

**M9's blast radius, and why under-prediction is the safe direction.** I predicted two failures and
got ten, and every one of the ten is caused by the mutation: clearing the draft before the first
write unmounts stage 4 entirely, so the overlay trigger, the refusal statement and all four
half-done cases have no screen to assert against. Predicting too narrowly cost nothing here because
the extra failures were explicable; predicting too _broadly_ is what hides a mutation that did not
land.

### The visibility check has a false-negative, and it is mine to report

M12's `grep -c` in a separate process answered **0** while the mutation was demonstrably live — the
`min` assertion failed on exactly the attribute it removed. So a `0` from that check does not prove
absence, and I have not tracked down why (the marker contains `{`, which is the obvious suspect
under `-F`). It fails in the safe direction — it can under-report presence, never invent it — but a
future round should not treat it as a two-way proof. Recorded rather than quietly relied on.

---

## 3. The `git add -A` rule

Recorded, and yours makes mine sharper: I had it as the converse of "commit before you mutate", which
is about protecting a fix from `git checkout --`. Stating it as **stage explicit paths, never `-A`,
in a shared worktree** covers both directions and both parties — the mutation you commit and the
work you sweep in. Every commit in this round staged named paths.

---

## Adjudications, carried into the report

- **`assertBuiltStageHasABody`** — kept exported and proved by direct call, with the reason recorded
  at the site so the next reader does not undo it.
- **`summariseStoredContacts` used as a test-side pin** — kept, and the report now says explicitly
  that this is better than what Ruling [119] asked for and why, so nobody "fixes" it back into the
  client module graph.
- **The browser gap** — noted as widened.

## Fix round 1 gates

**The guard set, `npm run test:cc-guards`:**

```
 Test Files  18 passed (18)
      Tests  377 passed (377)
   Duration  52.94s (transform 3.39s, setup 2.41s, import 10.15s, tests 58.72s, environment 9.55s)
```

377, up from 364: thirteen cases added for the second write and the state between the two writes.

**The full suite, `npm run test`, once, at the end, backgrounded from the first command:**

```
 Test Files  835 passed | 3 skipped (838)
      Tests  10173 passed | 74 skipped (10247)
   Duration  486.14s (transform 49.92s, setup 81.33s, import 259.40s, tests 953.26s, environment 308.80s)
```

Clean, no lease refusal at any point — the worktree was mine alone — and 10173 against the base
round's 10160, which is the thirteen new cases and nothing else moving.

**Typecheck, lint and Prettier, all clean**, all run directly rather than through the npm wrappers.
Nothing but this report has changed since the full suite started, verified with
`git log --name-only`.

## Does this touch the browser gate?

**Still no, and the second write does not change the answer — but it widens the gap again, and this
time by more than markup.** `tests/ui-caring-contacts-workspace.spec.ts` is unchanged and its
isolated server seeds no referral, so no Playwright case can reach any stage of this wizard. What now
has no browser evidence at all: two `type="date"` inputs and their native pickers, a live schedule
preview, the confirmation overlay's `full-screen-stage` phone modality with this screen behind it,
**and a two-write submission whose middle state is a screen a clinician can act on**. The half-done
state is the one I would most want seen in a real browser, because it is the only screen in this
workspace that asks someone to press a writing control a second time.

---

# Fix round 2

All three Criticals, all three Importants and both Minors. Commit `2ef2ba882`.

**The three Criticals were all prose, and that is the finding rather than a coincidence.** Every
mechanism in this task is pinned by a test; none of the sentences a clinician actually reads was.
The copy drifted the moment the code underneath it changed, and nothing went red.

---

## C1 — the sentence above the write control was false

Fixed and pinned. `activate()` performs both writes, and the screen now says so:

- The `StatedReason` at the control: **"Confirming creates this plan and starts it, and nothing is
  ever sent from here"**, with the two writes named in order and both recorded on the access trail.
- The control: **"Create and start this plan"**, which agrees with the overlay's own
  "Confirm and activate" and its title "Last check before the plan starts".
- The success panel: **"The plan was created and started"**, and it says the schedule is running.
  Omitting the start understated what had happened on a screen whose whole subject is whether a
  suicide-prevention schedule is live.
- Both doc comments asserting the one-write design are gone.

**Four cases pin it now**, and one of them reads the SOURCE rather than the DOM — `carries no
comment claiming this screen performs one write` — because the two stale comments were not visible
in any rendered output and so no DOM assertion could ever have caught them. R1–R4 prove all four.

**On this being the `stages.ts` defect two functions away.** You are right, and the count is right:
third time this phase that finding a pattern has not interrupted it. What I take from it is narrower
than "look harder". `stages.ts` was found by a mutation — R1-round-1's self-arming case pointed at
it — and I fixed the instance the tooling handed me. **I never searched for siblings**, because the
finding arrived as a test failure rather than as a question, and a test failure names one site.
The habit that would have caught this: when a mutation reveals a comment describing a mechanism the
code no longer has, grep the diff's own files for the same claim before moving on. That is now what
the source-reading test does mechanically for this file.

## C2 — the claim the domain contradicts

Fixed. `PLAN_EXISTS` said "no message is scheduled to go out yet"; I checked your reading against
the code rather than accepting it, and it holds:

- `createPlan` writes every planned contact in state `scheduled` (or `suppressed` for an absorbed
  one) **at creation**;
- `listSendableContacts` in **both** stores filters on `contact.state === "scheduled"` with no
  plan-state gate;
- nothing in `model.ts`'s contact transitions consults `plan.state`.

**Your reading of the true statement is correct, and I can add one thing to it.** The plan exists,
its contacts are scheduled, and nothing dispatches because there is no sender — and the sharper
version of "no sender" is that **`simulation.ts` is the only reader of `listSendableContacts`
anywhere in the tree.** There is no dispatcher, no provider, and no route that sends; the
reconciliation route reads dispatch records, it does not create them. So the copy now reads:

> The plan was created and is on this patient's record, and its contacts are scheduled — creating a
> plan schedules them. No second plan was created. Nothing reaches any handset either way: this
> prototype is connected to no messaging provider and has nothing that sends.

`listSendableContacts` is untouched, and the reasoning is recorded at the constant so the next
reader does not re-derive it.

**Two new assertions pin it**, and they are a pair on purpose: one refuses the false claim by name,
one requires the true one. R5 and R6 prove both halves separately.

## C3 — a branch asserting and denying one fact, with a test holding it there

Fixed, and **the assertion that was enforcing the falsehood is gone.** Recording that plainly,
because it is the one change in this round that removes a check:

> The thirteen-name walk required **every** branch to match `/not started|has not been started/`.
> `plan-not-draft` renders "It has not been started … an earlier attempt already started it". The
> test was not failing to catch the contradiction; it was **requiring** it.

The replacement is stricter, not looser. The names are split into two lists:

- **`STILL_WAITING` (eleven)** — a refusal means the write did not happen, so "has not been started"
  is true and is required.
- **`MAY_HAVE_STARTED` (three)** — must **not** claim the plan is unstarted, **must** admit the
  state is unknown, and **must** point at where to look.

**You named one branch; there are three, and the other two have the identical defect:**

- `plan-terminal` — a plan that has been ended may well have run first.
- `service-answered-with-something-unreadable` — the write may have landed. That branch's own
  heading already said "it is not clear whether it started" while the shared prefix denied it, so it
  was self-contradictory in the same way and one sentence apart.

R7 proves the new assertion catches exactly the defect C3 reported: putting `NOT_STARTED` back into
`plan-not-draft` goes red with `plan-not-draft claims the plan has not started, and it may have`.
R8 proves the eleven-branch half, R9 the "send the reader to look" half.

---

## Important

**I1 — five shapes, five cases.** The `for` loop became five `it`s. R15 is the proof that the split
bought something: clearing the draft on the lost-connection path now reddens **only** "keeps the
whole draft after a lost connection", and the other four stay green. Under the old single case, M9
reddened all five through one path and none was individually pinned.

**I2 — independence pinned by draw count, not by substring.** You are right that
`not.toContain(...)` catches literal embedding and nothing else. The new case stubs
`crypto.randomUUID` to a fixed three-draw sequence and asserts **three calls**, three distinct
identifiers, and three distinct random halves. A hash, a reversal or any other derivation consumes
fewer draws, so the call count catches every shape at once. **R12 is a reversal derivation and it
now goes red** — `expected "randomUUID" to be called 3 times, but got 2 times` — which is precisely
the mutation the old assertion would have passed. The double is asserted to have been used, so it
cannot pass inert.

**I3 — the consequence now arrives with the date, not after the justification.** `firstContactConsequence`
asks the domain the same question with the reason requirement satisfied by a stand-in, and the
absorbed-contact notice is built from it. The stand-in never leaves that function: only `absorbed`
and `summary` are read, and the submission path still goes through `createPlanRequestBody`, which
uses what the clinician wrote and returns null while it is missing. R13 and R14 prove it from both
sides — reverting to the submittable preview, and removing the stand-in — and the new case asserts
the reason field is still **empty** when the consequence appears, which is the ordering itself.

Your framing is the part I want to keep: _the consequence is an input to the decision, not a receipt
for it._ Ruling [118] said "before the choice is committed" and I implemented the letter of it.

## Minor

- **M1 — fixed.** 52 cases across **three** files in the review range; the three schedule cases
  landed in the swept commit before the base. The arithmetic was right and the phrasing was not.
- **M2 — fixed, by moving the reason onto the control that can deliver it.** A natively `disabled`
  input cannot announce its own `aria-describedby`, so the prerequisite now also appears on the
  **discharge day** field's hint — the control a clinician can actually act on to unblock the other
  one. The visible paragraph stays for anyone reading in document order.

---

## Coverage: your reordering accepted, and acted on this round

`activationRefusalWording` is first, and it is no longer unproved. **Six mutations now land inside
that table** — R5, R6, R7, R8, R9, R10 — plus R11 on its unnamed default. They pin, separately: that
the plan is said to exist, that the contacts are said to be scheduled, that the reason nothing sends
is given, that the not-started claim appears where it is true, that it does **not** appear where it
is false, that the reader is sent to look, and that a retry is described as finishing the same plan.

That C3 was a live defect inside exactly that walk is the argument, and I had the diagnosis and did
not act on it. The remaining order stands: (2) the store-agreement pin, (3) I1's five shapes — now
split, so this one is discharged — (4) `planVersionFromCreateAnswer`.

## The `grep -c` false negative — your cause is right, and there is a second one underneath it

The reviewer's finding is correct: under `-E`/`-P`, `{…}` is an interval quantifier and GNU grep
declines to match rather than erroring. **But `-F` did not fix it in my driver, and switching to
`-F` is what let me find why.** Measured here, passing the marker through Python's `subprocess`
argv into MSYS2 grep:

```
caring-contacts-activation-schedule-summary                  -> 1  (rc 0)
data-testid="caring-contacts-activation-schedule-summary"    -> 0  (rc 1)   double quotes
min={bounds?.earliest}                                       -> 0  (rc 1)   braces, under -F
```

The Windows and MSYS2 command-line conventions disagree about **both** double quotes and braces, so
the pattern grep receives is not the pattern that was sent. Interactively — `sed` then `grep` in one
bash — the same marker counts 1, which is why the hand check disagreed with the driver.

**Both our diagnoses were partial.** Yours explains the interactive `-E` case exactly; mine ("the
brace is the suspect") was right about the character and wrong about the mechanism. The fix is to
stop crossing that boundary: the visibility check is now a fresh `python -c` that reads the file and
counts, with the marker travelling on **stdin** rather than argv. Still a separate process, which is
the property being established.

Two more driver defects fell out of chasing it, and both could have produced a false green:

- **The write was never flushed.** `io.open(...).write(...)` as one expression leaves the close to
  refcounting. Now `with` + `flush()` + `os.fsync()`. On a ReFS Dev Drive this is exactly the shape
  that makes a run execute a file other than the one the driver believes it wrote — which is what
  round 1 looked like from the outside, alongside the concurrent session.
- **A mutation run could reuse a gate receipt.** `gate-receipts.mjs` memoises a passing Vitest run,
  and a reused receipt exits 0 printing **no summary line** — indistinguishable from a green
  mutation except by the absence the brief names ("no summary line means no run"). R16's control
  came back empty for exactly that reason and I re-ran it by hand with `GATE_RECEIPTS=refresh`
  before believing it. The driver now sets that for every mutation run.

---

## Round 2 mutation log — every attempt, itemised, no aggregate

| #     | Mutation                                                          | Predicted                                                         | Observed                                                                                                                                                      | Verdict                                                                    |
| ----- | ----------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| R1    | the control's heading restored to "does not start it"             | 1 red, the promise case                                           | `tells the coordinator, at the control, that confirming creates AND starts the plan`                                                                          | RED, matched                                                               |
| R2    | the control relabelled "Create this plan"                         | 1 red, the label case                                             | `labels the control for both writes, agreeing with the overlay it opens`                                                                                      | RED, matched                                                               |
| R3    | the success panel drops "and started"                             | 1 red                                                             | `says the plan was created AND started once both writes have landed`                                                                                          | RED, matched                                                               |
| R4    | the "one write its brief names" comment restored                  | 1 red, the source-reading case                                    | `a comment still says this screen performs a single write`                                                                                                    | RED, matched                                                               |
| R5    | `PLAN_EXISTS` restored to "no message is scheduled to go out yet" | 1 red                                                             | `stale-version still claims nothing is scheduled`                                                                                                             | RED, matched                                                               |
| R6    | the "nothing that sends" half removed                             | 1 red                                                             | `stale-version does not say why nothing reaches a handset`                                                                                                    | RED, matched                                                               |
| R7    | **the C3 defect put back** — `NOT_STARTED` into `plan-not-draft`  | 1 red on the branch that may have started                         | `plan-not-draft claims the plan has not started, and it may have`                                                                                             | RED, matched — the replacement assertion catches what the old one required |
| R8    | `NOT_STARTED` emptied                                             | 1 red on the eleven-branch half                                   | `stale-version does not say the plan has not started`                                                                                                         | RED, matched                                                               |
| R9    | `plan-not-draft`'s remedy replaced with "Try again"               | 1 red on "sends the reader to look"                               | `plan-not-draft does not send the reader to look at the plan`                                                                                                 | RED, matched                                                               |
| R10   | `PRESS_AGAIN` drops the same-plan guarantee                       | 1 red                                                             | `stale-version does not say a retry is not a second plan`                                                                                                     | RED, matched                                                               |
| R11   | the unnamed default stops naming the refusal                      | 1 red                                                             | `expected 'The plan was created and is on this p…' to contain 'a-refusal-nobody-has-written-yet'`                                                             | RED, matched                                                               |
| R12   | the activate key derived by REVERSING the create key              | 1 red on the draw count — the shape the old substring pin allowed | `the mint did not draw from crypto.randomUUID at all: expected "randomUUID" to be called 3 times, but got 2 times`                                            | RED, matched                                                               |
| R13   | the consequence read from the submittable preview again           | 1 red on the I3 case                                              | `Unable to find role="group" and name /suppressed/i`                                                                                                          | RED, matched                                                               |
| R14   | the reason stand-in removed                                       | 1 red on the I3 case                                              | same, from the other side                                                                                                                                     | RED, matched                                                               |
| R15   | the draft cleared on the lost-connection path                     | **1 red, and only one** — the split's whole point                 | `keeps the whole draft after a lost connection`; the other four shapes stayed green                                                                           | RED, matched                                                               |
| R16\* | **Control.** the schedule summary's `data-testid` renamed         | **GREEN** — nothing asserts on it                                 | first attempt returned no summary line at all (a reused receipt); re-run with `GATE_RECEIPTS=refresh` and the mutation proved present: `Tests 70 passed (70)` | **GREEN, as designed — on the second, believable run**                     |

Sixteen attempts, one anchor miss (R9, reflowed by Prettier between writing the anchor and applying
it — the same hazard as round 1's N6, met a second time), and one result I refused to believe until
it was re-run.

## Round 2 gates

**The guard set, `npm run test:cc-guards`:**

```
 Test Files  18 passed (18)
      Tests  391 passed (391)
   Duration  54.95s (transform 3.35s, setup 2.53s, import 10.00s, tests 61.81s, environment 9.22s)
```

391, up from 377: the five-shape split, the four copy pins and the independence pin, less the two
cases the C3 rewrite replaced with six.

**The full suite, `npm run test`, once, at the end, backgrounded from the first command:**

```
 Test Files  835 passed | 3 skipped (838)
      Tests  10187 passed | 74 skipped (10261)
   Duration  494.25s (transform 51.21s, setup 77.26s, import 264.69s, tests 957.09s, environment 314.74s)
```

Clean, and 10187 against round 1's 10173 — the fourteen net new cases and nothing else moving.

**Typecheck, lint and Prettier all clean.** The guard set was red once on the way, and it is worth
recording because it was not a test of mine: `tests/design-system-adoption.test.ts` compares
`docs/design-system/adoption-manifest.json` against a freshly built one, and my wizard test began
referencing an overlay test id, which adds it as a root. Regenerated with
`node scripts/generate-design-system-adoption.mjs --write` — one line — rather than edited by hand.

## Does round 2 touch the browser gate?

**No, and I do not expect the answer to change** — you measured `49 passed (1.3m)`, exit 0, unchanged
after round 1, and round 2 touches strictly less: copy inside stage 4, one new derived value, and
tests. `tests/ui-caring-contacts-workspace.spec.ts` is unchanged and its isolated server still seeds
no referral, so no Playwright case reaches any stage of this wizard.

The gap is unchanged from round 1 and still worth its row: two `type="date"` inputs and their native
pickers, the live schedule preview, the overlay's `full-screen-stage` phone modality with this screen
behind it, and the half-done state — the only screen in this workspace that asks someone to press a
writing control a second time. Round 2 adds one item to it: the M2 fix moves a prerequisite onto the
discharge field's hint precisely because a natively `disabled` control cannot announce its own
description, and **whether that lands for a real screen-reader user is exactly the kind of thing
jsdom cannot answer.**

---

# Fix round 3

Commits `6d2fe0806` (comments and the widened pin) and `463bec549` (the pin was inert; repaired).

---

## 1. Stale doc comments — you named two, the rule found four

I applied your scope rule rather than my phrase rule, which meant reading all **78 doc comments**
across the two files this diff touches (33 in `plan-activation.ts`, 45 in `plan-wizard.tsx`) and
asking of each whether it still describes the code beneath it. It took a few minutes and it found
**two more than the review named**, both older than the two:

| Where                                    | Claimed                                                                                    | False since        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------ |
| `plan-wizard.tsx` module doc             | _"Stage 4 … is still an explicit, typed extension point"_ and _"NO OVERLAY IS WIRED HERE"_ | the base task      |
| `CREATE_PLAN_ENDPOINT`                   | _"The one endpoint this workspace writes to"_ — there are two                              | fix round 1        |
| `PlanSubmissionState` (you named)        | _"Where the one write has got to"_                                                         | fix round 1        |
| `ACTIVATION_REFUSAL_WORDING` (you named) | _"Every branch says three things"_                                                         | fix round 2, by me |

A fifth was ambiguous rather than false: `SubmissionRefusalWording` is now the shared shape for two
tables and said so nowhere, so a reader would reasonably think there is one.

**The `ACTIVATION_REFUSAL_WORDING` one was also orphaned**, which I had not noticed and which is its
own small lesson: round 2 replaced the `PLAN_EXISTS` line with a doc comment plus the const, leaving
the table's doc floating above a different symbol's doc. It now sits on the table it describes, and
it states the invariant per class instead of a count:

- **all** branches say the plan was created, that its contacts are scheduled, and what to do next
  about _the same plan_;
- **only where true** — eleven of them — that it has not been started; the three that withhold it are
  named, with the reason.

And it no longer restates a count in prose, because **Ruling [94] applies to source as much as to a
screen**: the two lists live in the test, so a branch added to the wrong one goes red there rather
than disagreeing with a sentence nobody re-reads.

## 2. The pin, widened both ways — **and it was inert, and mutations caught it**

Widened as asked: both files, and a **family** of single-write claims rather than two literal
phrases, plus a second family for a count restated in prose. Its own limitation is stated at the
site — a fourth phrasing outside the family still passes — in the spirit of
`strip-source-comments.ts`'s pinned known limitation.

**Then S3 and S4 came back GREEN.** Putting _"Where the one write has got to"_ back into
`plan-wizard.tsx`, and _"This screen performs one write"_ into `plan-activation.ts`, changed nothing.
The cause:

```
'singleWriteClaims = [\n      /\x08the one write\x08/i,\n      /\x08one write its brief names\x08/i, …'
```

**Fourteen literal `0x08` bytes.** Every `\b` I wrote reached the file as a backspace escape, so the
patterns read `/<BS>the one write<BS>/i` and matched nothing. **The pin I wrote in this round to
catch stale claims could not fail.**

Three things about that, in order of how much they matter:

1. **It is Task 8's own recorded hazard**, met a third time in this programme: that report describes
   `\b` in a lease path eating the `b` and reaching committed Markdown as a control byte. I read that
   report at the start of this task. Knowing a hazard is not the same as recognising it.
2. **Only the mutations found it.** The case passes either way; the guard set, the full suite,
   typecheck, lint and Prettier were all green with an inert assertion in place. This is the repo's
   "checks that cannot fail" class, and what caught it is the discipline the review has been
   pressing: _a mutation proves the assertion it makes fail._ S3 and S4 existed only because you
   asked for mutations on the branches R7 did not cover; they found a different defect than the one
   they were written for.
3. **Every file this task touches is now scanned for control bytes** — ten files, zero found.

Repaired and re-run: S3 now fails with `plan-wizard.tsx still carries a single-write claim matching
/\bthe one write\b/i`, and **S4 fails naming `plan-activation.ts`**, which is the proof that the pin
reads the second file rather than only claiming to.

## 3. The corrected generalisation — the thing I am carrying out of this task

Yours, adopted verbatim, because I tested mine against the three instances and it catches one:

> **When a diff changes what a mechanism does, read every doc comment in the files it touches and ask
> whether each still describes the code beneath it.**

**A phrase grep is the mechanised subset of that: useful as a regression pin, not as the habit.**

What I had — _"grep the diff's own files for the same claim"_ — fails because "the same claim" in
practice means "the same phrase", and two of three instances shared no phrase with the one that was
found. The trigger half of my diagnosis survives and is worth keeping beside yours: **the fix arrived
as a test failure, and a test failure names one site**, so the missing step is a search rather than
more care. Your rule supplies the search's _scope_; the trigger says when to run it.

Round 3 is evidence for it in both directions: the scope rule found four where the phrase rule found
— and could only ever find — one, and the phrase pin I built as its mechanised subset was itself
broken in a way only mutation testing could see. **The habit is the rule; the pin is the regression
net; neither substitutes for the other.**

## 4. R7 proved one branch of three — the other two now have their own mutations

Correct, and it is the rule this phase already bought. Both added:

- **S1** — `NOT_STARTED` put back into `plan-terminal`:
  `plan-terminal claims the plan has not started, and it may have`.
- **S2** — the same into `service-answered-with-something-unreadable`:
  `service-answered-with-something-unreadable claims the plan has not started, and it may have`.

Each names its own branch in the failure message, so the three are proved separately rather than as a
class.

---

## Round 3 mutation log — every attempt, itemised, no aggregate

| #    | Mutation                                                         | Predicted                                          | Observed                                                                                                                                     | Verdict                                  |
| ---- | ---------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| S1   | `NOT_STARTED` restored to `plan-terminal`                        | 1 red naming that branch                           | `plan-terminal claims the plan has not started, and it may have`                                                                             | RED, matched                             |
| S2   | `NOT_STARTED` restored to the unreadable-answer branch           | 1 red naming that branch                           | `service-answered-with-something-unreadable claims the plan has not started, and it may have`                                                | RED, matched                             |
| S3   | _"Where the one write has got to"_ restored in `plan-wizard.tsx` | 1 red on the widened pin                           | **GREEN — the pin was inert.** After repair: `plan-wizard.tsx still carries a single-write claim matching /\bthe one write\b/i`              | GREEN exposed a defect; RED after repair |
| S4   | a single-write claim added to `plan-activation.ts`               | 1 red, proving the pin reads the second file       | **GREEN — same cause.** After repair: `plan-activation.ts still carries a single-write claim matching /\bthis screen performs one write\b/i` | GREEN exposed a defect; RED after repair |
| S5   | the branch-count claim restored to the table's doc               | 1 red on the count family                          | `plan-activation.ts restates a branch count in prose, which decays`                                                                          | RED, matched                             |
| S6\* | **Control.** `REASON_STAND_IN` reworded                          | **GREEN** — nothing asserts on the stand-in's text | `Tests 97 passed (97)`, mutation present (count 1), run with `GATE_RECEIPTS=refresh`                                                         | **GREEN, as designed**                   |

S5 is worth a second look: it went red first time while S3 and S4 did not, and the difference is that
its regexes contained no `\b`. **The count family was sound by accident and the single-write family
was broken by accident**, in the same array literal, written in the same edit.

---

## The retroactive presence-check audit

Every marker from rounds 1 and 2, checked for a character the Windows→MSYS2 argv boundary re-parses
(`"`, `{`, `}`, `?`, `[`, `]`, `*`):

| Round             | Markers | Carrying a boundary-sensitive character          |
| ----------------- | ------- | ------------------------------------------------ |
| 1 (M1–M17, N1–N7) | 25      | **17** — sound: M3, M4, M5, M6, M10, M16, N1, N7 |
| 2 (R1–R16)        | 16      | **14** — sound: R6, R14                          |

**31 of 41 were exposed. Two actually manifested, and only one conclusion is affected.**

- **M12** (round 1) reported `0`, and **R16-control** (round 2) reported `0`. Everything else
  reported a real count despite the exposure, because manifestation depends on how MSYS2 re-parses
  the specific string, not merely on containing the character.
- **M12's conclusion stands.** Its run went red on the exact assertion it targeted
  (`toHaveAttribute("min", …)`), and **a red proves presence by itself** — a mutation that never
  reached disk cannot make its own target assertion fail.
- **That is the general answer, and it bounds the damage sharply.** A presence check is load-bearing
  only for a GREEN. Every red result in rounds 1–3 carries a failure message naming the mutated
  behaviour, so all of them are self-proving.
- **R16-control is the one compromised result**, because a control's whole content is its green. It
  was re-run under the fixed driver with `GATE_RECEIPTS=refresh` and the mutation proved present.
- The other two greens are independently sound: **N2** was diagnosed as an ineffective mutation on
  its own merits (stripping a prefix off a random value leaves it random), and **M17-control**
  reported a count of 1 and produced a real summary line.

**Scope, as you bound it:** the rule is "do not pass data through the Windows→MSYS2 argv boundary",
not "do not use grep". On a Linux CI runner none of this applies, and grep in a bash-to-bash pipeline
is unaffected — which is exactly why my hand check disagreed with the driver.

## Receipt reuse, corrected by your analysis

Your decomposition is right and mine was too alarmed: the signature is over **working-tree bytes**, so
a mutation that reached disk changes the hash, misses the cache and runs. **Mutation results were
never threatened.** A restore returns previously-seen bytes, hits, and exits silently — the control
case, and it fails safe.

The composite is the dangerous one: an unflushed write leaves the _unmutated_ signature, which hits a
receipt and prints nothing — a false green on a mutation. Both defects were in my driver and could
have composed.

**They did not, and the reason is a rule rather than luck:** the observable is identical either way —
**no summary line** — and the brief's own "no summary line means no run" is what stopped me reporting
R16's first attempt. A check that catches two unrelated defects through one observable is worth
keeping.

## The "copy only is inert" counterexample

Taken. Round 2's overlay test-id made a DOM test file an adoption-manifest root, so a copy change did
move a non-test artifact. Caught by the guard set and regenerated with
`node scripts/generate-design-system-adoption.mjs --write` rather than hand-edited. Not a browser
risk, but **"copy only" is not a safety argument** and I used it as one.

## The inbox record

Thank you for committing it. You are right that an uncommitted record is not a disposition — C2's
whole defence was that the draft-plan sendability question is filed separately, and it was sitting
untracked in a worktree this machine has destroyed before. **The record was the load-bearing half of
that argument and I left it unversioned.**

## Round 3 gates

**The guard set, `npm run test:cc-guards`:**

```
 Test Files  18 passed (18)
      Tests  391 passed (391)
   Duration  63.61s (transform 3.10s, setup 2.54s, import 10.81s, tests 70.57s, environment 10.61s)
```

391, unchanged from round 2: round 3 rewrote comments and repaired assertions inside an existing
case rather than adding cases.

**The full suite, `npm run test`, once, at the end, backgrounded from the first command — and it was
RED on one test that is not this task's:**

```
 Test Files  1 failed | 834 passed | 3 skipped (838)
      Tests  1 failed | 10186 passed | 74 skipped (10261)
   Duration  635.61s (transform 65.73s, setup 99.23s, import 303.95s, tests 1254.63s, environment 394.77s)
```

```
FAIL |jsdom| tests/document-viewer-page-virtualization.dom.test.tsx
  > PDF reader page virtualization > reads exactly one page ahead and one behind, and only once idle
AssertionError: expected [ 4 ] to deeply equal [ 3, 4, 5 ]
```

**Reported as red rather than re-run until green**, which is Task 8's precedent and the right one: a
re-run would hide the load condition and prove nothing about the diff. The evidence that it is not
mine, gathered rather than asserted:

- **It passes alone on the same tree** — `Tests 9 passed (9)`.
- **This task touches no `document-viewer` file at all** — `git log --name-only` across every commit
  from the base to HEAD returns zero.
- **The assertion is a timing one** — a prefetch window that should hold three pages once the reader
  is idle held one, which is what an idle callback that has not fired yet looks like.
- **The run was 635s against round 2's 494s on the same machine**, ~30% slower, so it was under
  heavier load. `import` alone rose from 265s to 304s.

I have not touched that test, raised its timeout, or quarantined it. If it recurs on an idle machine
it is a real flake worth the ledger; one observation under load is not enough to file it as one.

**Typecheck, lint and Prettier: clean.**

## Does round 3 touch the browser gate?

**No.** It changes doc comments, one test case's assertions, and nothing a browser renders — the
copy a clinician reads is byte-identical to round 2, which you measured at `49 passed (1.3m)`,
exit 0. `tests/ui-caring-contacts-workspace.spec.ts` is unchanged.

I will not repeat "strictly less than" as a safety argument, per the counterexample above: what I can
say is narrower and checkable. Round 3's diff is two source files and one test file; the two source
changes are inside comment blocks, verified by `git diff` carrying no change to any string literal or
JSX text node; and the adoption manifest is unchanged this round because no new test id was
introduced.

# Fix round 4

## 1. The control-byte guard

You were right that what I reported was not a check. It was a scan I ran once, in a shell, and then
described in a report — which is the same category of thing as a comment claiming an invariant. It
could not fail because it could not run.

**Where it lives: `tests/source-control-bytes.test.ts`.** You asked me to say where it belongs and
why, so the alternatives, and why each loses:

- **An ESLint rule** sees only what it lints. Two of the three real occurrences were in Markdown —
  `task-8-report.md` twice — and the extension list a lint rule would cover excludes `.md`, `.json`,
  `.sh` and `.yml`. It would have caught the one occurrence that was already the easiest to find.
- **A pre-commit hook** does not run in CI, and `core.hooksPath` is set by each checkout's own
  `npm install`, so an agent pushing from its own environment bypasses it entirely — AGENTS.md says
  exactly this about the format guard, which is why the format rule is still written down as a rule.
- **A test** runs in `npm run test`, runs in CI, and fails in the same place as every other
  correctness claim. The precedent is already in this repo: `tests/session-start-hook.test.ts`
  polices CR bytes in the hook blobs, for the same reason and in the same shape.

**Scope, deliberately, and what it does not touch.** Permitted everywhere: `0x09` tab, `0x0A` line
feed, `0x0D` carriage return. Tab and newline are ordinary text. **The carriage return is out of
scope rather than approved** — `.gitattributes` sets `* text=auto eol=lf` and the hook-script test
already fails on CR in the blobs where a CR is dangerous. Policing it here as well would put two
guards on one rule, and the second guard's failures would be somebody else's to interpret. Files are
selected by text extension rather than by excluding known binaries, so generated and binary paths are
out **by construction** rather than by an exclusion list that has to be maintained;
`--exclude-standard` keeps `.gitignore` in force, so `node_modules`, `.next` and `coverage` never
enter the scan.

**The allowlist is per file AND per byte, with a written reason.** One entry:
`tests/upload-structure.test.ts`, bytes `0x03` and `0x04` — the ZIP local-file-header signature
`50 4B 03 04`, embedded literally because a `.docx` is a zip and writing it as an escape would test a
different string from the one that actually arrives. I verified those bytes are literal rather than
escape text before writing the entry: one `0x03` and one `0x04`. That single legitimate case is why
the guard is an allowlist rather than an absolute rule.

**Two gaps I found by inspection before mutating, both of which the mutations then confirmed:**

- **The scan could not see the file being written.** A plain `git ls-files` lists tracked files only,
  so a control byte in a NEW file would stay invisible for the whole session that introduced it and
  surface later against somebody else's diff. That is the wrong half of the problem to solve, since a
  byte arrives at the moment a file is written. It now lists `--cached --others --exclude-standard`.
  Measured: 5,335 tracked, 5,336 including not-ignored untracked — the one extra being the guard
  itself, which the tracked-only version could not scan.
- **A scan over an empty list passes vacuously.** Everything the guard asserts about offences is
  satisfied by examining nothing at all. That is the same shape of defect the guard exists to catch,
  so it is not allowed to have it: it now also asserts it examined more than 1,000 files and names
  three it must have seen — one source file, one Markdown file, and itself.

**Cost.** 5,137 candidate files; the Buffer scan takes ~1.0 s, and the whole test file runs in
1.5–2.6 s. I measured a UTF-8-decoding version at 24 s, which is why it reads bytes rather than
characters — and reading bytes also means an invalid sequence cannot be silently turned into a
replacement character and hidden.

### Round 4 mutation log — every attempt, itemised, no aggregate

Green baseline **shown** first: `7 passed`, clean tree.

| #   | Mutation                                     | Predicted                                   | Observed                                                                                      |
| --- | -------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| G1  | Plant `0x08` into tracked `task-8-report.md` | repo-wide case red, detector cases green    | `1 failed \| 6 passed`; message named `…/task-8-report.md:443 carries 0x08 between …`         |
| G2  | Plant `0x08` into an UNTRACKED `.ts` file    | red — this is what the `--others` half buys | `1 failed \| 6 passed`; offence named `src/lib/caring-contacts/scratch-untracked-probe.ts:2`  |
| G3  | `forbiddenControlBytes` returns `[]` always  | the positive controls red                   | `5 failed \| 2 passed`                                                                        |
| G4  | `scannableTextFiles` returns `[]`            | ONLY the new count assertion red            | `1 failed \| 6 passed`; `expected 0 to be greater than 1000`                                  |
| G5  | Delete the ZIP magic bytes from the fixture  | stale-exception case red                    | `1 failed \| 6 passed`; `is allowed 0x3 and no longer contains it, so the exception is stale` |

Tree asserted clean by `git diff --quiet` before and after each; baseline re-confirmed at `7 passed`
after the last revert.

**What G3's two survivors say, because they are more interesting than its five reds.** The tab and
newline case survives because it asserts a count of zero — it is a **labelled control**, not a
missing assertion. The repo-wide scan also survives, and that one is worth stating plainly: **a scan
cannot detect its own blindness.** With the detector returning nothing, the repository "carries no
stray control byte" is still green. That is exactly why G1 and G2 plant real bytes in real files
rather than relying on the unit controls, and why the guard would be worth much less without them.

**What G4 says.** Before the hardening above, G4 was green. A guard that examines nothing and reports
success is the failure mode I was asked to prevent, and it was present in my first draft.

## 2. The two surviving prose counts — and the second one was false

The comment read:

> `ONLY WHERE IT IS TRUE: that the plan has not been started (NOT_STARTED). Three branches withhold
it … Two of those three tell the clinician NOT to press again`

sitting directly above `The counts are deliberately not restated in prose here`. You called it two
surviving counts. Reading the three branches to fix them, the second one is not merely a count — **it
is wrong**, and wrong in the direction that matters:

- `plan-not-draft` — "Do not start the sign-up again". Warns.
- `plan-terminal` — "Opening the plan on the patient's screen to see what ended it. It is the same
  plan; nothing here will create a second one." **Says nothing either way about pressing again.**
  This is the tightened reading you asked for: it does not tell the clinician not to press.
- `service-answered-with-something-unreadable` — uses `PRESS_AGAIN`, so it **invites** pressing
  again, after checking the patient's screen first.

So only one of them warns. The sentence credited branches with a warning they do not give, in a
paragraph written to correct an earlier over-claim. A tally is a claim nobody re-derives; that is the
whole mechanism, and it produced the same defect a second time inside the fix for the first.

The bullet now names the withholding branches without counting them, and a second bullet states that
what they advise about pressing again is **not uniform and not summarisable** — read them. The
sentence that used to promise no counts now explains why there are none, without quoting the tally.

**I then introduced a count myself.** My replacement text ended "Read the three." — a count, written
in the act of removing counts, in the same edit. That is the fourth instance this phase of finding a
pattern failing to interrupt it, and I am reporting it rather than quietly fixing it because it is
the strongest argument available for the pin: prose discipline demonstrably does not hold here, in
either direction, even under direct instruction.

**The pin, widened to the two shapes that survived**, and kept deliberately narrow. A general
"`<numeral>` of those" pattern collides with ordinary prose in these two files — `one of them`, `one
of the two confirmations`, `every one of them`, `not one of them is reproducible` — so it would fail
on sentences that are fine and teach the next author to disable it. The two added patterns match a
numeral qualifying `branches`, and a numeral-of-those-numeral construction, and neither matches
anything now in either file.

Two proofs, one of them free:

- **Unplanned.** On first run the widened pin went red **on my own new comment**, which quoted the
  false tally verbatim while explaining it. That is a real red on real content, and I fixed the
  explanation rather than relaxing the pattern — describing the tally instead of reproducing it.
  A second occurrence in the same block, `TWO of the three were false`, went red the same way and was
  rewritten too.
- **P1, deliberate.** Reinstated `Three branches withhold it` — predicted red on the
  numeral-plus-`branches` pattern, observed exactly that, with the other unnumbered `branches` lines
  in the same file not matching, which is the narrowness claim proved rather than asserted. Reverted;
  baseline `70 passed` restored.

`plan-wizard.tsx`'s counts are untouched, as instructed — verified by `git diff`: this round's source
change is confined to `plan-activation.ts`.

## 3. "A red proves presence" — the three conditions

I have been treating a red as self-proving. It is not, and the correct statement is conditional. **A
red proves the assertion was present and reachable only if all three hold:**

1. **A green baseline on the same tree, shown rather than asserted.** Without it, the red may predate
   the mutation. This is the condition I did not state for M12: its rescue rested on a green baseline
   I claimed rather than pasted. This round I ran and pasted the baseline before the first mutation
   and after the last revert.
2. **A quiet worktree.** A concurrent edit produces a red that belongs to somebody else's change —
   and that is not hypothetical here, it is the exact failure round 1 of this task records. **It
   happened again this round; see the concern below.**
3. **A deterministic assertion.** A flaky assertion produces reds without a mutation, and this very
   run contains the existence proof: the `document-viewer` failure earlier in this task was red
   without any input from me.

The asymmetry that remains true: a red needs these three conditions, while a **green** needs all of
them _plus_ an independent presence check, because a green is also what an absent, unreachable or
inert assertion produces. That is the asymmetry — not that a red needs nothing.

## 4. The Task 8 report repair

`task-8-report.md` still carried two literal `0x08` bytes — inside the sentence explaining the
backspace hazard, in a report that claims in its own round-1 section to have fixed it. Both are now
the two literal characters `\b`, verified zero remaining. This had to happen before the guard could
ship, since the guard scans that file; it is also the clearest possible statement of why the guard is
a check and not a habit.

## 5. Does round 4 touch the browser gate?

**No, and the control-byte guard does not change that answer.** You asked me to say if it did. It
adds one test file that reads bytes off disk, renders nothing, and imports no component; the
adoption manifest is unchanged by it (`design-system adoption checked: 54 components, 97 roots`,
exit 0, and the pre-commit hook's own run reported `Documentation is synchronized`). The
copy a clinician reads is byte-identical to round 3 — this round's product change is inside a comment
block in `plan-activation.ts`, with no change to any string literal or JSX text node.
`tests/ui-caring-contacts-workspace.spec.ts` is unchanged. The browser gate stands where you measured
it, `49 passed`, and I am not asking for it to be re-run.

## Round 4 gates

**`npm run test:cc-guards`**

```
 Test Files  18 passed (18)
      Tests  391 passed (391)
   Duration  81.73s
```

**`npm run test`** — started backgrounded, one run:

```
 Test Files  1 failed | 835 passed | 3 skipped (839)
      Tests  1 failed | 10193 passed | 74 skipped (10268)
   Duration  466.23s
```

**The one failure is `tests/document-viewer-page-virtualization.dom.test.tsx`, and it is the same
one you already ruled conclusively not mine.** I re-proved it this round rather than citing your
ruling: run alone it is `9 passed` in 2.82 s; it fails only under full-suite load, inside a
`waitFor` on rendered page numbers, which is a timing signature rather than a logic one. My round-4
diff is four files — `plan-activation.ts`, `caring-contacts-plan-wizard.dom.test.tsx`,
`source-control-bytes.test.ts`, `task-8-report.md` — and none of them is imported by that test.

**One thing about that run to flag rather than let pass.** The command exited with the wrapper
printing `[exited with code 0]` even though the suite reports `1 failed`. The pipe I ran it through
masked the real code. I am reporting the summary line, not the exit status, which is the rule; but it
is worth recording that on this machine the exit code was actively misleading in the direction of
false reassurance.

Also run this round, each with its own summary line rather than an exit code:

- `tests/source-control-bytes.test.ts` — `7 passed`, baseline before and after the mutation series.
- `tests/caring-contacts-plan-wizard.dom.test.tsx` — `70 passed` after the prose fixes.
- `node scripts/generate-design-system-adoption.mjs --check` — `design-system adoption checked: 54
components, 97 roots`. The pre-commit hook independently ran the `--write` form on the second
  commit and reported `[pre-commit] Documentation is synchronized.`

## Concern: the worktree was not mine alone this round

Condition 2 of section 3 failed, and I only know because the mutation discipline asserts it.

While reverting the P1 mutation, `git diff --quiet` reported the tree dirty in a file I had never
touched — `tests/caring-contacts-empty-state.dom.test.tsx`, converting `<a href>` to `<Link>`. Then,
between two of my commands, that change was **committed to this branch**: `163f101f1`, "use Link in
the empty-state tests — lint was red behind a stale cache", authored 02:12:06, which is now HEAD
above my two round-4 commits.

What I did **not** do: touch it, revert it, stage it, or include it in any commit of mine. Explicit
paths only, as ruled.

What I checked before continuing, because "my work is probably fine" is exactly the assumption that
cost round 1:

- All three of my commits are ancestors of the new HEAD; history is linear and nothing of mine was
  rewritten or lost.
- My five files match HEAD exactly — the P1 mutation was fully reverted and no foreign edit landed
  inside anything I wrote.
- The foreign edit appeared on disk **before** `test:cc-guards` started, and that gate does not
  include the empty-state test, so its `391 passed` is unaffected. The full suite ran after the
  commit and therefore includes that change; its `10193 passed` covers their file as well as mine.

The mutation results themselves are unaffected: G1–G5 all completed with `git diff --quiet` asserted
clean immediately before and after, and P1's red was on a byte I planted in a file they never
touched. But the general point stands and is the reason I am not quietly absorbing this: **a red in a
shared worktree is only evidence about my change if the tree is quiet, and this tree was not.** The
only reason I can still make the claim is that the discipline asserts cleanliness rather than
assuming it — which is the same argument as the guard in section 1, applied to process instead of
bytes.
