# Task 8 report — stage 3, personalisation

**Branch:** `claude/browser-test-gate-handoff-d5c1db`. Committed locally; nothing pushed, no PR.

**Commits:**

| SHA         | What                                                                              |
| ----------- | --------------------------------------------------------------------------------- |
| `9015ca0a5` | The pure half: `patient-detail.ts`, `SENDING_PREFERENCE_OPTIONS`, and their tests |
| `30a581c47` | Stage 3 itself, the draft's new fields, the page's two new props                  |
| `5eb3df29a` | The stage comments Task 8 made stale, corrected at their own sites                |

---

## 1. What was built, file by file

| File                                                                     | What changed                                                                                                      |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `src/components/caring-contacts/workspace/plan-wizard/patient-detail.ts` | **New.** What stage 3 collects and whether it is enough to create a plan with. Pure — no React, no storage.       |
| `src/components/caring-contacts/workspace/plan-wizard/plan-wizard.tsx`   | `PersonalisationStage`, plus two small field components and two new props.                                        |
| `src/components/caring-contacts/workspace/plan-wizard/plan-draft.ts`     | `patientDetail` and `sendingPreference` added to `PlanDraft`, to `emptyPlanDraft` **and to `parseDraft`**.        |
| `src/components/caring-contacts/workspace/plan-wizard/stages.ts`         | `personalisation` flipped to `{ kind: "built" }`; its purpose line corrected (see §5).                            |
| `src/app/caring-contacts/plans/new/page.tsx`                             | Resolves the send-time wording and the reserved fictional numbers on the server and passes them in.               |
| `src/lib/caring-contacts/schedule.ts`                                    | `SENDING_PREFERENCE_OPTIONS` — the three preferences, their labels, and the send time **derived** from the hours. |
| `src/lib/caring-contacts/model.ts`                                       | `SENDING_PREFERENCES` published as a value; `SendingPreference` now derived from it.                              |
| `src/lib/caring-contacts/synthetic-contacts.ts`                          | `DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS` — the two reserved PATIENT mobiles, derived from the frozen record. |

Tests added: `tests/caring-contacts-plan-patient-detail.test.ts` (11 cases).
Tests extended: `tests/caring-contacts-plan-wizard.dom.test.tsx` (+10), `tests/caring-contacts-plan-draft.dom.test.tsx` (+3), `tests/caring-contacts-schedule.test.ts` (+3).
`docs/scripts-index.md`: one regenerated line, written by the pre-commit documentation sync when
`test:cc-guards` gained files (round 1, M-5 — it was in the diff and absent from this table).
`package.json`: `test:cc-guards` now also carries `tests/caring-contacts-plan-patient-detail.test.ts`
(this task's own) and `tests/caring-contacts-schedule.test.ts` (pre-existing, but this task edits
`schedule.ts`). See §6 for why.

Task 7 said Task 8 would change **exactly two things** — the `stages.ts` entry and the `stageBody()`
branch — and that the forward control would become a real Continue with no edit at its call site.
**That held.** No call site moved; the stepper, the forward control and the unbuilt-stage panel all
followed the table.

---

## 2. The rulings, and how each was implemented

### Ruling [114] — this is a DATA ENTRY stage, and the mockup has it backwards

`PersonalisationStage` in the mockup renders four read-only rows — preferred name, message variant,
team identity, coordinator signature — each with a green tick and the source line "Imported from the
synthetic referral". None of the four is reproducible. `createPlanSchema.patientDetail` requires the
clinician to **supply** `patientName` and `patientMobileNumber` (both `min(1)`), and a `Referral` is
five fields holding neither.

So stage 3 is four inputs and a radio group:

| Field                 | Control                    | Required                                |
| --------------------- | -------------------------- | --------------------------------------- |
| `patientName`         | text                       | yes                                     |
| `patientMobileNumber` | text, `inputMode="tel"`    | yes                                     |
| `patientIdentifiers`  | textarea, **one per line** | no — an empty box is `[]`, never `[""]` |
| `culturalIdentity`    | text                       | no — reaches the plan as `null`         |
| `sendingPreference`   | three radios               | yes                                     |

Nothing is ticked and nothing claims a source. A test asserts the phrases "imported from the
synthetic referral" and "governed value present" appear nowhere on the stage.

**On the identifiers textarea, because it is the one presentational convention I invented.** One
identifier per line, stated in place. It is a parsing convention owned by the screen, not a domain
rule, and `parsePatientIdentifiers` is where it lives so Task 9 uses the same split. The alternative
— a repeatable row list with add and remove controls — is more machinery for a field the domain
describes only as `z.array(z.string().min(1))`. Say if you would rather have the rows.

### Ruling [115] — the mobile number is required, and the design has no field for it

Collected here, not deferred to stage 4. **And I looked for the validator the ruling told me to look
for. There is none, and I have not invented one:**

- `createPlanSchema.patientMobileNumber` is `z.string().min(1)`. That is the whole rule.
- `message-policy.ts` takes `patientMobileNumber` only to check whether the number **leaked into**
  message text (`contains-patient-mobile`). It treats it as an opaque string and says nothing about
  its shape.
- `synthetic-contacts.ts` holds a closed list of reserved fictional numbers, and says nothing about
  the shape of any other number.

So the only refusal is the one the domain holds — the field must not be empty — with **trimming,
which is stricter than the schema on purpose**: `z.string().min(1)` accepts `" "`, and a plan whose
patient name is a single space passes the API and identifies nobody.

**What the screen says, and where.** A `StatedReason` group sits directly beneath the number field,
in the flow of the page, headed _"Nothing typed here is ever sent to any number"_, with spec §4.4's
`Why:` / `What changes it:` shape — never a `title` attribute, which has not been stated to anyone
who does not hover. Its reason names the reserved fictional numbers, **read from the sealed domain**
rather than written into the screen.

**The one judgement call in this task, stated so you can overrule it.** When the number entered is
not one of the reserved fictional ones, the screen **says so and still accepts it**:

> The number entered is not one of the reserved fictional numbers listed above. It is accepted — this
> prototype holds no rule about what a mobile number looks like — but a number belonging to a real
> person would be recorded on the plan.

I considered refusing anything outside that pair, which is the more conservative failure direction
and would make it impossible to type a real person's number into a prototype. I did not, for two
reasons: it is a rule that exists nowhere in the domain and would be enforced only by this screen
while `createPlanSchema` went on accepting any non-empty string — the exact "inventing the authority"
Ruling [115] warns against — and it would turn a stage the same ruling calls a data-entry stage into
a two-option picker. **If you want the refusal instead, it is one line in `personalisationIssues` and
one test, and I will make it.**

### Ruling [116] — cultural identity is optional, and the screen says why it is asked

Optional in all three senses: no issue is raised when it is blank, nothing on the stage waits for it,
and `createPlanPatientDetail` sends `null` rather than `""`. That last is not cosmetic — `Episode`
types the field `string | null` and `CLEARED_PATIENT_DETAIL` blanks it to `null` on a retention
clearance, so `""` would be a third state meaning neither "not given" nor "cleared", and nothing
reading the record afterwards could tell those two apart.

**A recorded purpose exists, and I did not have to invent one.** Spec §2.5, "Cultural identity is
imported for reach reporting only", is the authority: Aboriginal and Torres Strait Islander status is
used for **aggregate reporting on programme reach**, with a small-cell threshold and a non-inferable
`Suppressed` state, and it "never affects eligibility, ordering, timing, pathway assignment, message
content, or any ranking, and never appears on a worklist row." The screen states the purpose, the
equity reasoning behind it, and that list of nevers, in a `StatedReason` group beneath the field.
The Postgres store corroborates it in code: `culturalIdentity` goes to `cultural_identity_reports`
and, in its own words, "nowhere near the plan row".

**One thing §2.5 says that the screen deliberately does not reproduce: "imported from the source
record".** There is no import path in this domain. See finding 1.

### Rulings [94] and [98] — the count is not restated

The mockup's legend reads _"One preference applies to all 10 contacts."_ The screen says:

> One choice applies to every contact in this plan.

A test asserts the invariant is present and that no `N contacts` count appears on the stage.

### Ruling [110] — the draft, and what stage 3 puts in it

Task 7's draft is used and no second storage mechanism exists. `patientDetail` and
`sendingPreference` were added to the type, to `emptyPlanDraft` **and to `parseDraft`** — Task 7
warned that a field added to the type and not to the parser is silently dropped on every reload, and
`parseDraft` refuses a draft it does not fully recognise, so a draft written before stage 3 existed
is discarded rather than half-read. Three cases cover that and mutation M8′ proves they fire.

**`sendingPreference` starts at `null`, not at `"morning"`.** The mockup default-checks the first
option. Nothing in this domain carries a sending preference, so a default would decide when a
discharged patient hears from the service and then present that decision as the coordinator's. Stage
2's pathway starts filled only because a referral genuinely carries one.

**Nothing patient-identifying is in a URL.** Stage 3 added no route, no query parameter and no
storage key; the draft key is unchanged.

**Task 7's notice is reachable from this stage and is still true — and I did not strengthen it.**
It is rendered by the wizard shell above every stage, so it is on screen while the name and number
are typed. Its "held" wording already says what is written, that it is not sent anywhere, that
closing the tab removes it, and that Discard draft removes it now — _"use it if you are stepping away
from a shared computer."_ That was written knowing stage 3 was coming. What I did instead was make
the stage point at it rather than re-describe it: the panel intro says _"until you finish or discard
it is kept on this computer — the notice above this stage says exactly where"_, and the completion
line says _"None of it is recorded on a plan yet; like everything else on this screen it is kept on
this computer until you finish or discard."_

**On the wording rule.** "Name the destination, not the act." Both sentences above name a
destination — _on a plan_, _on this computer_ — and neither uses a bare "stored". I read the comment
at the site in `AgreementStage` before writing them.

### Ruling [109] — the client boundary

Unchanged. The page is still a Server Component, the wizard is still the only client boundary, and
**the two new props are resolved on the server** — the send-time wording from
`SENDING_PREFERENCE_OPTIONS` and the reserved numbers from `synthetic-contacts.ts`. That is round 1
finding M-2's precedent applied: a screen must never re-derive a rule a module owns, and resolving
server-side keeps `schedule.ts` out of this route's client chunk.

One deliberate exception, and it is a value import: `plan-draft.ts` imports `SENDING_PREFERENCES`
from `model.ts`, because the parser has to decide at **runtime** whether a value read out of a
browser's storage is still one of the three. The alternative was a list written out in the component,
which is a second copy of the union free to go on accepting a preference the domain had dropped —
and the value being checked is exactly the kind that can be older than the code reading it. So the
array is now the source of the type in `model.ts`, the same shape `TERMINAL_PLAN_STATES` there
already uses. `model.ts` has one import (`./ids`, types only) and is side-effect-free, so
tree-shaking keeps a frozen three-string array rather than the state machine.

**The service state still does not cross.** No new prop is derived from it; the page test that stops
a service with a distinctive incident note and asserts the wizard's props hold neither it, the stop
reason, nor a key of that name is unchanged and green.

---

## 3. Findings I am reporting rather than fixing

**Finding 1 — the fourth field the design assumes an import for, and this one is a spec sentence
rather than a mockup row.** The brief asked me to say if I found one. I did, and it is
`culturalIdentity`. Spec §2.5's own title is "Cultural identity is **imported** for reach reporting
only" and its text says the status is "imported from the source record". There is no source record
and no import path: `createPlanSchema` requires the clinician to supply it, and `Referral` carries
nothing of the kind. It is Ruling [114] a fourth time, and the pattern the build record calls
"three-for-three" is now four-for-four.

There is a second half worth a decision. §2.5 scopes the field to **Aboriginal and Torres Strait
Islander status** — a categorical fact with a small-cell suppression threshold — while
`createPlanSchema` types it `z.string().min(1).nullable()`, free text. Aggregate reporting over free
text is not the same product as aggregate reporting over a category, and the difference decides
whether the equity report §2.5 promises can be built at all. I did not narrow the control to a
category, because that is a schema and a governance decision rather than a screen decision, and
because inventing the category list for a demographic field is exactly what Ruling [116] refuses.
The screen therefore asks an open question and states what the answer is used for.

**Finding 2 — `dischargeAt` is required to create a plan and NO stage collects it.** This is
Ruling [115]'s shape exactly, one field over, and it will land on Task 9 unless it is settled first.
`createPlanSchema.dischargeAt` is a required ISO instant; `buildApprovedSchedule` hangs the entire
twelve-month calendar off the AWST discharge day; and nothing in this domain holds a discharge
instant before a plan exists — `Referral` is five fields, `hospital-events.ts` has no discharge
event, and the only `dischargeAt` values anywhere are read back **out of** an already-created plan.

I did not build a control for it, and the reason is the briefs rather than convenience: Task 8's
constraints name "adjust schedule" as one of the four overlays **Task 11** owns, and Task 9's
Ruling [118] puts the first-contact-date control on **stage 4** on Ruling [96]'s authority. So the
scheduling controls are deliberately not mine. But Ruling [118] then talks throughout about "the
discharge day" as a known quantity — "default is discharge + 1 day", "movable within the discharge
day to discharge + 7" — and nothing says where it comes from. **A review screen that is also the only
place a required value can be entered is not a review**, which is Ruling [115]'s own sentence. Worth
a ruling before Task 9 starts.

**Finding 3 — the DOM test for the send times is tautological with respect to their values, and the
schedule test is what actually pins them.** Recorded because mutation M3 found it rather than review.
The wizard test asserts the fieldset renders `option.sendTime` for each option — but it reads
`SENDING_PREFERENCE_OPTIONS`, the same constant the screen renders, so hardcoding every send time to
10:00 leaves it **green**. What goes red is
`tests/caring-contacts-schedule.test.ts`'s case, which builds a real schedule and compares the
advertised wording against the hour the contact is actually sent at. Both tests are worth keeping and
they prove different things: the DOM one proves the screen renders what the domain published, the
schedule one proves what the domain publishes is true. It is the same trap as a check that cannot
fail, one layer up — an assertion that reads its subject's own source of truth.

**Finding 4 (carried forward, not mine to fix).** Task 7's finding 1 stands unchanged: the stage-1
assurances still cannot be recorded, and stage 3 does not change that. Task 9's Ruling [119] names it
too.

---

## 4. Seams left for Task 11 (overlays), and what Task 9 gets

**No overlay is wired.** The mockup opens four from this stage, plus a preview card:

| Overlay id                 | What the mockup opens it for               | Note for Task 11                                                                                                                                                                  |
| -------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `message-preview`          | The `MessagePreviewCard` on this stage     | This is where patient-visible copy belongs. It must read the sealed domain's `message-copy`; the stage renders none.                                                              |
| `communication-preference` | A communication-preference sheet           | `notification-preferences.ts` exists in the domain; whether this stage is where it belongs is a design question.                                                                  |
| `adjust-date-time`         | "Adjust schedule" — the first-contact date | **Check against Task 9 first.** Ruling [118] puts the first-contact-date control on stage 4, so this overlay and that control may be the same thing built twice.                  |
| `discard-changes`          | A discard confirmation                     | The wizard already has a real, unconfirmed "Discard draft" control beside the notice. If this becomes a confirmation step, it wraps that control rather than adding a second one. |
| `save-draft`               | "Save draft"                               | There is nothing to wire. The draft saves on every keystroke and the notice says so; a Save-draft control would imply the opposite. Recommend it is dropped rather than built.    |

**What Task 9 inherits from this task:**

- `createPlanPatientDetail(draft.patientDetail)` returns exactly the four-key `patientDetail` object
  `createPlanSchema` accepts, or `null` while anything required is missing. `.strict()` means a fifth
  key is refused outright rather than ignored, which is why that function returns those four and
  nothing else. **Use it; do not re-derive the trimming or the null.**
- `personalisationIssues(...)` is the same list stage 3 renders. If stage 4 needs to say why it
  cannot submit, that is where the words are.
- The draft now carries `patientDetail` and `sendingPreference`. Ruling [120]'s `planId` and
  `idempotencyKey` are additions to `PlanDraft` **and to `parseDraft`** — the parser refuses what it
  does not recognise, so a field added to one and not the other is dropped on every reload.
- `dischargeAt` is still nobody's. See finding 2.

---

## 5. A decision that goes slightly beyond the brief — please check it

**I changed `stages.ts`'s `personalisation` purpose line.** It read "The patient's details, the day of
the first contact, and when in the day messages go out." The stage does not collect the day of the
first contact — Ruling [118] puts that control on stage 4 — and that string is rendered to a
clinician by the stepper and by the unbuilt-stage panel. A purpose line naming something the stage
does not collect is a promise the screen breaks, so it now reads "The patient's details, and when in
the day messages go out."

---

## 6. Verification

### Test-first, honestly reported

**Test-first for three of the four pieces, and not for the fourth.**

- `patient-detail.ts` — test-first. `tests/caring-contacts-plan-patient-detail.test.ts` was written
  first and run first: `Error: Cannot find package '@/components/…/patient-detail'`, then
  `Tests 11 passed (11)` after the module existed.
- The draft's new fields — test-first. Three cases written first, run first, `3 failed | 12 passed
(15)`, each failing for its stated reason (`expected { Object (referralId, stage, ...) } to be
null`, and `undefined` where the new `patientDetail` should have been).
- Stage 3 itself — test-first. Ten cases plus five edits to existing ones, run first:
  `13 failed | 19 passed (32)`, all thirteen unable to reach a stage that did not exist.
- `SENDING_PREFERENCE_OPTIONS` — **implementation first. I am not claiming otherwise.** It is a small
  derived constant and I wrote it before its three cases. Falsifiability is proved by mutation M3
  rather than by having watched it fail first.

### Mutation log — every attempt, itemised, no aggregate

Each mutation was applied, its presence in the tree confirmed by a separate `grep -c` run as its own
command with `;` — never `&&`, because `grep -c` exits non-zero on a zero count and would
short-circuit the gate into printing no summary line at all — then the gate run, then reverted with
`git checkout --`. **Every mutated file was committed first**, so no revert could discard a fix; that
is round 1's process defect applied rather than re-learned.

| #   | Mutation                                                                     | Predicted                                                                                                  | Observed                                                                                                                                                                                                                                                                                | Verdict                                                     |
| --- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| M1  | `personalisationIssues` never reports `patient-mobile-required`              | 3 red: 2 in patient-detail, 1 in the wizard                                                                | Exactly 3. `expected [ 'patientName', 'sendingPreference' ] to deeply equal [ 'patientName', …(2) ]`; `expected [ 'patientName' ] to deeply equal [ Array(2) ]`; and `a required field states nothing about what is missing: expected '' to match /cannot be created without/i`         | RED, prediction matched                                     |
| M2  | `createPlanPatientDetail` sends `""` for cultural identity instead of `null` | 2 red, one per file, both reading `expected '' to be null`                                                 | Exactly 2, both `expected '' to be null`                                                                                                                                                                                                                                                | RED, prediction matched                                     |
| M3  | Every `sendTime` hardcoded to 10:00                                          | 1 red in the schedule suite; **green in the wizard suite**, because that assertion reads the same constant | `afternoon is advertised at the wrong time: expected '10:00 am AWST' to be '2:00 pm AWST'`, and the wizard suite green — see finding 3                                                                                                                                                  | RED where predicted, and the predicted green is the finding |
| M4  | The mobile statement drops `fictionalPatientMobileNumbers.join(...)`         | 1 red, the reserved numbers not found in the group                                                         | 1 red: "states, where the number is entered, that nothing is ever sent to it"                                                                                                                                                                                                           | RED, prediction matched                                     |
| M5  | `mobileIsDesignatedFictional` always true                                    | 2 red: the near-miss case, and the wizard's caution                                                        | Exactly 2. `expected true to be false`, and `expected 'Entered by youA referral carries no n…' to match /not one of the reserved fictional nu…/i`                                                                                                                                       | RED, prediction matched                                     |
| M6  | The cultural-identity purpose becomes "record keeping"                       | 1 red on `/reporting on programme reach/i`                                                                 | 1 red: "states the recorded purpose from the spec, and what it never does"                                                                                                                                                                                                              | RED, prediction matched                                     |
| M7  | `min-h-tap` stripped from stage 3's radio labels                             | 1 red naming the row                                                                                       | `Morning is not a production tap target: expected 'flex w-full min-w-0 cursor-pointer it…' to contain 'min-h-tap'`                                                                                                                                                                      | RED, prediction matched                                     |
| M8  | `parsePatientDetail` returns an empty detail instead of null                 | 1 red, the pre-stage-3 draft accepted                                                                      | **GREEN — and the mutation was the defective thing, not the test.** I mutated 2 of the 5 refusal branches; `patientIdentifiers` still returned null and caught both cases. The brief's own warning, met in practice: check first that the mutation changes a value some assertion reads | GREEN on an effectively unmutated path                      |
| M8′ | All five branches of `parsePatientDetail` return an empty detail             | 1 red, and on the SECOND sub-assertion (the first is caught by the `sendingPreference` check)              | `a draft missing half its patient detail was accepted: expected { Object (referralId, stage, ...) } to be null` — the second sub-assertion, as predicted                                                                                                                                | RED, prediction matched                                     |
| M9  | The completion status line's branch inverted                                 | 1 red on `/nothing else is needed/i`                                                                       | `expected 'Entered by youA referral carries no n…' to match /nothing else is needed/i`                                                                                                                                                                                                  | RED, prediction matched                                     |
| M10 | The identifiers field's `id` renamed                                         | **GREEN** — nothing asserts on it; the label is what the tests find                                        | `Tests 32 passed (32)`                                                                                                                                                                                                                                                                  | GREEN, as intended                                          |

No anchor failed to match: every mutation was confirmed present by its own `grep -c` before its gate
ran, and `git status` was clean after the last revert.

**Where a prediction was wrong, and it is worth recording.** M8 is the one, and it is the more
useful direction to be wrong in than round 1's under-predicted blast radii: the mutation was
**green on a tree that was not meaningfully mutated**. Nothing about the summary line said so — it
read `Tests 47 passed (47)`, which is indistinguishable from a test that cannot fail. What caught it
was predicting _which assertion_ would fail and then not finding it in the output, which is the whole
reason the brief asks for the prediction rather than "expect red". M10 is the deliberate control in
the other direction: a change that SHOULD leave the gate green, labelled as such, so a green line
somewhere in this log is not read as an oversight.

### Gates

**The guard set, `npm run test:cc-guards`** — run during iteration and after each fix, twice at the
end (before and after the comment refresh):

```
[cc-guards] exit=0 elapsed=118s        # first green, 17 files
 Test Files  17 passed (17)
      Tests  319 passed (319)
   Duration  107.85s

[cc-guards] exit=0 elapsed=67s         # after the comment refresh; warm caches
 Test Files  17 passed (17)
      Tests  319 passed (319)
   Duration  63.43s
```

Membership grew by two — `tests/caring-contacts-plan-patient-detail.test.ts` (this task's own) and
`tests/caring-contacts-schedule.test.ts` (this task edits `schedule.ts`, and it is the suite that
actually pins the send times — see finding 3). Both are `node`-project suites and cheap; the set went
from 15 files to 17 and the wall time did not rise.

**The full suite, once, at the end:**

```
[test] exit=1 elapsed=768s
 Test Files  1 failed | 833 passed | 3 skipped (837)
      Tests  1 failed | 10114 passed | 74 skipped (10189)
   Duration  755.09s (transform 70.42s, setup 113.70s, import 339.81s, tests 1568.38s, environment 451.04s)
```

**It was red, on one test, and it is not this change's.** The failure is
`tests/codex-cloud-setup.test.ts > Codex Cloud environment contract > pins connected retrieval mode
and rejects unsafe shell-policy configs`, and the message is not an assertion:

```
Error: Test timed out in 120000ms.
```

That file exercises the Codex Cloud provisioning scripts by spawning shells against temporary
`CODEX_HOME` directories. It touches nothing this task changed — not the workspace, not the domain,
not the draft — and there is no path from a caring-contacts screen to it. Run on its own against the
same tree:

```
 Test Files  1 passed (1)
      Tests  35 passed (35)
   Duration  37.61s
```

**37.6 s alone against a 120 s timeout under full-suite load.** So it is a load-dependent timeout on
this machine rather than a regression, and I am reporting it that way rather than re-running the
suite until it goes green — a re-run would have hidden the load problem and proved nothing about the
diff. I did not raise its timeout, and nothing about it was changed.

**Why this machine was under unusual load, stated because it is my own doing.** See the lease note
below.

**Typecheck and lint:**

```
[typecheck] exit=0 elapsed=52s
[gate-receipts] recorded a pass for "typecheck:internal" (5325 input files).

[lint] exit=0 elapsed=46s
[gate-receipts] recorded a pass for "lint:internal" (5325 input files).
```

Neither was red at any point in this task, and neither hit a lease refusal. **Prettier was red once**
and it is worth recording because the brief warns about exactly its consequence: four files
(`plan-wizard.tsx` and three test files) failed `prettier --check` after the comment refresh. Fixed
with `--write` and committed in the same commit as the change, not after it — a push sends commits,
not a working tree.

### The timing question the brief asked me to answer

**The guard set is 67–118 s against the full suite's 768 s.** Round 1 measured 53 s
against 590 s (about 11×) on 12 files; round 2 measured 133 s against 803 s (about 6×) on 15. This
task is 17 files and lands between 6× and 11× — 67 s and 118 s against 768 s, and the two guard-set
figures are the same 17 files on the same tree, differing only in how warm the caches were. So the
saving is real and has held across three
measurements and two widenings, but **the ratio is not stable and should not be quoted as a
constant**: both numbers move with how many of the owner's worktrees are running, and the guard set's
own membership has grown by five files across three tasks. What is stable is the shape of the trade —
minutes rather than tens of minutes per fix round, at the cost of a selected set that the full suite
still has to confirm was selected correctly.

**And it earned its place on this task rather than passing by never looking.** It was red on its
first run of every piece: the draft cases, the thirteen stage-3 cases, and the five existing wizard
cases the flip invalidated (the stepper's unbuilt count, the forward control, the stage table, and
the stored-draft fixtures). No workspace-wide guard fired this time — `interface-vocabulary`,
`domain-isolation`, `route-reachability`, `design-system-adoption` and `explained-automation` were
green throughout, which I checked deliberately rather than assumed, because Task 7 was caught by two
of them and this task adds a new module to the same client boundary.

### A lease refusal, and it was mine

**Recorded in full because the brief asks for it and because I caused it.** The first attempt at the
full suite was a foreground run that the tool killed at its own 10-minute ceiling. That killed the
wrapper; it did **not** kill the vitest process, which went on holding the repository's exclusive
heavy-run lease with no workers and no output anywhere I could read. The next attempt sat behind it
for 906 s and then refused:

```
Error: Another Database heavyweight command is active (PID 55448, worktree
D:/Repos/Database/.claude/worktrees/browser-test-gate-handoff-d5c1db, started
2026-08-25T07:12:07.831Z): vitest run --reporter=dot
[test] exit=1 elapsed=906s
```

**The path above is written with forward slashes deliberately (corrected in round 1).** The original
paste kept the record's Windows separators, and `\b` in `\worktrees\browser-…` is a BACKSPACE
escape — it survived into the committed Markdown as a literal control byte, so the displayed field
read `worktrees` with the `b` eaten. The evidence that actually carried the ownership argument was
the process ancestry, not that path; a corrupted paste is a good reason not to lean on one.

**A refusal is neither a pass nor a failure, and I treated it as neither.** I proved ownership from
the lease record rather than from a live PID, exactly as the brief requires: its `worktree` field is
this worktree, its `command` is the one I ran, and its `startedAt` matches the run that was killed.
The process tree confirmed it independently —
`bash → npm run test → cmd → run-vitest.mjs → vitest`, rooted in this session's own shell — and the
vitest process had 52 s of CPU across 26 minutes with **no worker children**, which is a hung
process rather than a slow one.

I then terminated **my own** process tree. That is not the thing the brief forbids: no other
worktree's lease was broken, and the coordinator reclaims a lease whose PID is dead all by itself
(`ownerDirectoryIsStale` → `if (!processIsAlive(owner.pid)) return true`), so nothing was deleted by
hand and no lock file was forced. The suite then ran normally.

**The lesson, since it will recur.** The full suite takes longer than a foreground tool call is
allowed to last, so running it in the foreground does not merely fail — it leaves a hung
lease-holder that blocks every worktree on this machine until someone notices. Run it in the
background from the start. The Codex Cloud timeout above is the second-order cost of not having
done that.

### The browser gate

**No, I do not believe this touches `tests/ui-caring-contacts-workspace.spec.ts`, and I did not
change it.** The reason is the one Task 7 recorded in that spec's own comment: its isolated
Playwright server seeds no referrals, so `/caring-contacts/plans/new` always renders "No referral
named" and **no Playwright case can reach any stage of this wizard**. Everything Task 8 built is
inside a stage. The six existing `caring contacts new plan` cases exercise the route's start state,
which is unchanged.

That is a real coverage gap rather than a clean bill of health, and it is the same one Task 7 filed
twice: the tap-target assertions here read the CLASS, not the rendered box, because jsdom has no
layout, and the 320px, dark, forced-colours and print behaviour of four new inputs and a radio group
has not been seen by anything. It cannot be closed until that server seeds a referral.

### Not run, and why

- `npm run verify:ui`, `verify:phone-chrome` — you run the browser gate, and see above for why it
  cannot reach this stage today.
- `npm run verify:cheap`, `verify:pr-local`, `verify:release` — not asked for; the last is
  provider-backed.
- Nothing provider-backed was run at all. No Supabase, no OpenAI, no GitHub, no CI.

---

# Round 1 — the review's findings, addressed

Every item fixed. Commits: `d275c02c4` (M-1, M-2), `473abfc96` (M-3, M-4), `61f1f93c5` (item 1 and
I-3), `a78baf138` (I-2), `1064839b7` (I-1), `6be44f71c` (item 5), plus this report.

## Item 1 — the cultural-identity field is removed, and the screen says why

Done, and the reasoning is now in the code rather than only in the instruction. The input is gone;
`createPlanPatientDetail` sends `null`; the field stays nullable in the schema and in the draft; the
storage, the column and `cultural_identity_reports` are untouched.

**Not replaced with a category picker**, because choosing the categories is precisely the deferred
decision. That is the part it would have been easiest to get wrong while looking helpful.

**The absence is stated in place**, in spec §4.4's shape, because an absent field with no explanation
reads as an oversight:

> **Cultural identity is not asked for here.** _Why:_ The design for this service records cultural
> identity as something read from the hospital record, and used only for counting how many people the
> programme reaches — never for who is eligible, the timing of anything, which pathway runs, or what a
> message says. This prototype is connected to no hospital record, so the only way to have it would be
> to ask you to type it, and typed free text cannot support the small-number suppression that
> reporting would depend on. _What changes it:_ Nothing on this screen. It needs the record it is
> meant to be read from, and a decision about which identities are recorded — neither of which has
> been made. Until then the plan records nothing here.

**I-3 is resolved by the same change, and the reviewer's framing of it is the part worth keeping.**
The removed panel said the field _"is used for aggregate reporting on programme reach"_ — present
tense, for a report nobody has built. I had refused to reproduce §2.5's false "imported from the
source record" and then reproduced §2.5's equally unbuilt "is used for", **one sentence later**. The
lesson generalises past this fix: I treated §2.5 as one claim to check rather than as a document
every sentence of which describes an unbuilt capability. A test now refuses both strings by name, so
the pair travels together.

## I-1 — "validate before advancing" was present and dead

**Confirmed exactly as described.** `ForwardControl` returns an `UnavailableDestination` whenever the
next stage is unbuilt and never reads `ready` on that path, so stage 3's `ready={complete}` was
unreachable, and **no test asserted that an incomplete stage 3 cannot advance.** Task 9 could have
flipped `review` to built, shipped a Continue that ignores `ready`, and had every gate stay green —
with a plan submittable carrying no patient name and no mobile number.

My report claimed Ruling [115] satisfied without naming this. That was the report's defect as much as
the code's: I described the mechanism ("`ready` is passed, and it arms when Task 9 builds review")
accurately enough for it to sound covered, and did not follow the sentence to its end — "so nothing
tests it today".

Two halves, because either alone leaves a hole:

1. **Live now.** Stage 2's forward control — whose next stage _is_ built — must be `disabled` with no
   pathway chosen, and must use native `disabled` rather than `aria-disabled`, because awaiting
   validity is transient inertness. That proves the `ready` → `disabled` mechanism is wired at all.
2. **Self-arming**, in Task 7's shape. Inert while `review` is `not-built` (asserting only that no
   enabled Continue has appeared behind the table's back), and a hard requirement the instant that
   entry flips. R1-M14 proves it arms, and it names Ruling [115] in its own failure message.

## I-2 — the caution nobody would hear

**Confirmed, and it is the finding I am least comfortable about**, because the whole reason the
accept-with-caution decision is defensible is that the caution arrives — and I had built it so that
it might not. The `<p role="status">` was created along with its content; a live region has to be on
the page already for a change inside it to be announced.

The region is now always rendered with its children toggled, and its id is named in the input's
`aria-describedby`, so it is reachable from the control rather than only as a region someone has to
go and find. `TextField` gained an optional `describedBy` that is **joined** with the requirement
rather than replacing it — a field can be both incomplete and cautioned, and an implementation that
overwrote one with the other would have traded one silent string for another.

## The minors

- **M-1 and M-2 — fixed, and the reviewer's observation about where they came from is the useful
  part.** Both are the tautology of my own finding 3, written twice more in the same diff. The
  schedule case named "advertises every send time inside the approved window" asserted a regex that
  accepts `"5:00 am AWST"`; it now parses the advertised wording back to a 24-hour hour and compares
  it against `APPROVED_SEND_WINDOW`. The patient-detail case named "names only the two reserved
  PATIENT mobiles" asserted `toHaveLength(2)`; it now checks the list against
  `FICTIONAL_CONTACTS_BY_ROLE` and separately refuses each service line. R1-M11 and R1-M12 prove both.

  **What I take from it.** I found the pattern by mutation and then wrote it up as a property of one
  assertion, which let me file it as handled. It is not a property of an assertion, it is a habit —
  asserting the shape of a value instead of the rule that produces it — and finding one instance does
  not interrupt a habit. The check that would have caught all three is the one that caught the first:
  for every assertion, name the wrong value it is supposed to reject, then confirm it rejects it.

- **M-3 — fixed.** The comment argued `""` and `null` would be indistinguishable from a cleared
  record; they are distinguishable (a clearance writes `null`), merely meaningless. The decisive fact
  is that `z.string().min(1).nullable()` **refuses `""` outright**, so a plan carrying one could not
  be created at all. Kept, as instructed, even though the field is gone — the shape rule still governs
  the stored value, and Task 9 reads this function.

- **M-4 — fixed.** The draft suite carried a reserved number as a literal three times. It now reads
  `DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS`, and the replacement comment does not quote the number
  either: a copy in prose is still a copy, which the first draft of that comment demonstrated by
  tripping my own "no literals left" check on its own text.

- **M-5 — fixed.** `docs/scripts-index.md` is now in the file table, named as what it is: one line
  regenerated by the pre-commit documentation sync when `test:cc-guards` gained files.

## Item 5 — the draft notice names what it holds

**Overruled and implemented, and the overrule is right.** My reasoning was that the notice already
named the destination and pointed at Discard draft, so the stage panel could carry the rest. What it
missed is that a clinician cannot weigh the Discard-draft decision the same sentence offers them
without knowing what is being held — and the sentence was written for a draft of two checkboxes.

The held and pending wordings now say "what you enter here — including the patient's name and mobile
number — is written to this computer's storage for this tab only". "Name the destination, not the
act" is unchanged; this adds the content to it rather than replacing it. A test pins the phrase, and
R1-M15 proves the pin fires.

## The mangled lease path

Corrected at its own site. `\b` in `\worktrees\browser-…` is a backspace escape and reached the
committed Markdown as a literal control byte, so the displayed field read `worktrees` with the `b`
eaten. The path is now written with forward slashes and the corruption is noted where it happened.
The ownership argument never rested on it — the process ancestry did — which is the reason to say so
rather than silently repair it.

## Round 1 mutation log — every attempt, itemised, no aggregate

Same discipline: each mutation applied, presence confirmed by its own `grep -c` run as a separate
command with `;` (never `&&`), the gate run, then reverted with `git checkout --` against a committed
file, so no revert could discard a fix.

| #      | Mutation                                                                        | Predicted                                                                                                                                                                                                    | Observed                                                                                                                                                                                                                                                        | Verdict                 |
| ------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| R1-M11 | `awstWallClockLabel`'s meridiem hardcoded to `"am"`                             | 2 red in the schedule suite, and the window case must be one of them                                                                                                                                         | Exactly 2: `afternoon is advertised at the wrong time: expected '2:00 am AWST' to be '2:00 pm AWST'`, and the window case firing for the first time — `afternoon is advertised before the earliest permitted send: expected 2 to be greater than or equal to 9` | RED, prediction matched |
| R1-M12 | `crisisSupportContact` swapped in for `rowanPatientMobile` in the reserved list | 1 red, the exact-equality half firing before the not-contains loop                                                                                                                                           | 1 red: `expected [ Array(2) ] to deeply equal [ Array(2) ]` — the case that passed this exact swap before the fix                                                                                                                                               | RED, prediction matched |
| R1-M13 | `ForwardControl`'s `disabled={!ready}` → `disabled={false}`                     | 1 red: the live half. The self-arming half stays GREEN, because it is still inert                                                                                                                            | 1 red, the live half; the self-arming half green as predicted                                                                                                                                                                                                   | RED, prediction matched |
| R1-M14 | `stages.ts` marks `review` built **and** `disabled={false}` kept                | 7 red: the self-arming case naming Ruling [115], the live half, the stepper count, the table case, the review unavailable-control case, the unbuilt-panel case, and Task 7's draft-clearing self-arming case | Exactly 7, and the self-arming case fired its own message: `stage 3 could advance with no patient name and no mobile number — Ruling [115] requires the mobile number to be validated BEFORE the wizard advances: expect(element).toBeDisabled()`               | RED, prediction matched |
| R1-M15 | The pre-round-1 draft-notice sentence restored                                  | 1 red on the content pin                                                                                                                                                                                     | `the notice does not say what it is holding: expect(element).toHaveTextContent()`                                                                                                                                                                               | RED, prediction matched |

No anchor failed to match, and `git status` was clean after each revert.

**One process note, since the brief asks for unmatched anchors too.** Two _edits_ in this round failed
their `assert old in s` on the first attempt — the caution paragraph and one comment — both because
Prettier had reflowed those lines between my writing the anchor and applying it. Nothing green was
reported on an unmutated tree, because these were edits rather than mutations and they aborted loudly.
But it is the same hazard the brief names for mutations, met from the other side: **an anchor written
against unformatted text does not match formatted text.** Anchor against the file as it stands, not as
you last typed it. One of those aborts left a half-applied edit that broke every stage-3 case until
the remaining hunks landed, which is exactly why each piece was committed before the next began.

## Round 1 gates

**The guard set, `npm run test:cc-guards`** — run after every fix in this round:

```
[cc-guards] exit=0 elapsed=56s
 Test Files  17 passed (17)
      Tests  324 passed (324)
   Duration  52.68s (transform 2.67s, setup 3.09s, import 9.87s, tests 51.53s, environment 10.31s)
```

324 cases, up from 319: five added this round (three for the removed field, one for the live region,
two for I-1, one for the notice's content pin, less the two cultural-identity cases removed).

**The full suite, once, at the end — and started in the background from the first command, which is
the lesson from my own lease incident:**

```
[test] exit=0
 Test Files  834 passed | 3 skipped (837)
      Tests  10120 passed | 74 skipped (10194)
   Duration  503.06s (transform 49.88s, setup 76.66s, import 266.17s, tests 990.78s, environment 315.91s)
```

**Clean, and `tests/codex-cloud-setup.test.ts` passed in it.** That is the base round's failure, and
it going green here on an unchanged file with no orphaned lease competing for the machine is the
confirmation of the load diagnosis rather than an assumption about it. The suite also finished in
503 s against the base round's 768 s, on the same tree plus this round's changes — same cause.

(The `check:function-grants: FAIL` lines mid-run are one test's own positive-control fixtures
printing their expected refusals, not failures.)

**Typecheck and lint:**

```
[typecheck] exit=0 elapsed=17s
[gate-receipts] recorded a pass for "typecheck:internal" (5326 input files).

[lint] exit=0 elapsed=12s
[gate-receipts] recorded a pass for "lint:internal" (5326 input files).
```

**One lease refusal this round, and it is the good kind.** A typecheck attempted while the full suite
held the exclusive lease returned the documented blocked-not-red code:

```
DATABASE_HEAVY_RUN_ADMISSION_BUSY
Database focused-test capacity is full (current owner PID 76076, worktree
D:/Repos/.../browser-test-gate-handoff-d5c1db, ...): vitest run --reporter=dot
[typecheck] exit=75 elapsed=36s
```

`75`, not `1`. Reported as neither a pass nor a failure, retried on the message once the suite
finished, and nothing forced. That the holder was a suite I had deliberately backgrounded — rather
than one I had orphaned — is the whole difference from the base round.

**Prettier: my own file only.** `npx prettier --check .` across the whole tree reports four files,
and **three of them are not in this task's diff**: `docs/caring-contacts/phase-2b-sdd-archive/task-7-report.md`,
`docs/codebase-index.md` and `tests/caring-contacts-new-plan-page.dom.test.tsx`. I verified they were
already unformatted at this task's base commit (`git show 9f659863e:<path>` piped to
`prettier --check`), so they are pre-existing rather than mine, and I have not touched them —
formatting files outside the diff would sweep unrelated changes into this task. **Worth knowing
before anyone pushes this branch**, because the pre-push guard checks the whole tree when prettier
policy changes and the changed-file CI check would catch them the moment anything else edits them.

## Does round 1 touch the browser gate?

**No, and I do not disagree with your expectation.** Every change is inside stage 3 or its tests, and
`tests/ui-caring-contacts-workspace.spec.ts` is unchanged in this round and in the base task's fix
rounds. The reason no Playwright case can reach a stage is unchanged too: that server seeds no
referral. The removed field and the always-rendered live region are both inside that gap, which means
the 320px, dark, forced-colours and print behaviour of the changed markup is still unseen — the same
coverage gap already filed, not a new one.

## One thing observed, not caused

`eb32ba403` — "docs(caring-contacts): Ruling 121 — dischargeAt collected on stage 4", touching only
`docs/caring-contacts/phase-2b-build-record.md` — landed on this branch during this round. That is
the ruling on my concern 2, recorded where it belongs; nothing about it conflicts with this task and
I have left it exactly as it is.

---

# Round 2 — four items, and three corrections to what I claimed in round 1

Commits: `cf858c0dc` (N-1, N-2), `b69932029` (items 2 and 3), plus this report.

## N-1 — the screen's claim was a property of state, not of code

**Confirmed, and the reviewer's phrasing is the whole finding.** `null` reached the schema because
the UI could no longer write a value, not because anything enforced it. The path was live enough that
my own draft suite still round-tripped `culturalIdentity: "Noongar"` through storage — a test I wrote
and read past, because I was thinking about what the screen offers rather than about what the data
can carry.

**I defended both boundaries, and they are not two copies of one rule.**

1. **`parseDraft` blanks a stored value** (the draft boundary). A draft written before the field was
   removed survives in the same tab across a redeploy; blanking it there means the value cannot
   re-enter the application at all, which is the earliest point at which it can be stopped.
2. **`createPlanPatientDetail` returns `null` unconditionally** (the submit boundary). This is the
   function Task 9 calls, and it must not emit a value whatever it is handed — including a detail
   object built by hand that never went near storage, which is precisely what Task 9 will be doing.

Neither subsumes the other: the first cannot constrain a caller who never reads a draft, and the
second cannot stop a stale value from being read back into the running screen. They happen to agree
today, and each has its own test and its own mutation (R2-M22, R2-M23).

**Blanked rather than refused, and the choice is not cosmetic.** Returning `null` from
`parsePatientDetail` would discard the whole draft — throwing away the patient's name and mobile
number a clinician typed, in order to remove a field they were never offered. Blanking drops exactly
the value that may no longer be supplied and keeps everything they did type. The key is still
_required_ to be a string first, so this is a decision about a recognised field rather than a silence
about an unrecognised one; deleting the field from the type would have made it the silence instead,
which is why the field stays (N-2's comment now says so).

## Item 2 — my own check, turned on my own round-1 work

**Both halves failed, and the reviewer is right on both.**

**The I-3 assertions pinned the shape of the wrong sentence, not the rule.** They rejected two exact
phrasings. `"provides aggregate reach reporting"` and `"reach figures are produced from this"` would
both have passed — **and I have now demonstrated that rather than accepting it**: R2-M17 puts
precisely that second sentence on the screen, and it matches neither of the two original regexes. It
is the round-1 habit one level up, which is the part worth sitting with: I fixed two instances of
"assert the shape, not the rule" and then wrote the fix for a third instance in the same shape.

What I did about it: the refusal now covers a **family** of affirmative constructions rather than two
sentences, and a **positive** assertion pins the counterfactual framing the honest wording depends on
(`would depend on`, `connected to no hospital record`), so a rewrite into an affirmative claim has to
defeat both halves. **CORRECTED IN ROUND 3 — the original sentence here read "R2-M16, R2-M17 and
R2-M18 prove all three parts fire", which overstated it.** What those three mutations prove is **two
of the six family regexes and one of the two counterfactual clauses**. R3-M24 adds the second
counterfactual clause; four of the six regexes remain unproven. See round 3.

**And it is recorded in the comment as a shape-pin, not as the rule**, because it is at the limit of
what an assertion can express here. The rule is "the screen makes no affirmative present-tense claim
about a reach-reporting capability nobody has built" — a semantic property. A fourth phrasing outside
the family still passes. That limitation is written at the site, in the same spirit as
`strip-source-comments.ts`'s pinned known limitation, rather than left for the next reader to
discover by writing one.

**The second half — no mutation proof — is the more serious of the two**, because it is not a judgement
call. My own stated rule has two clauses and I performed one. Both new guards are now proved:

- The **id list** needed two mutations, and that is itself a finding. R2-M19 (re-adding the
  cultural-identity input) goes red on `queryByRole("textbox", { name: /cultural/i })`, which fires
  **first and short-circuits the case** — so the id list was still unproved after it. R2-M20 renames
  the identifiers field's id, leaves the cultural query null, and reaches the list, which then fails
  with `stage 3 collects a field it should not, or has lost one it should`. **An assertion behind a
  sibling that fails first is not proved by a mutation that trips the sibling** — the ordering is part
  of what has to be tested, and one mutation per case is not enough when a case holds two.

## Item 3 — a true assertion with a lying failure message

Swapped to `toBeEmptyDOMElement()`. The reviewer's reading of the matcher source is right — the old
form is behaviourally correct here — and the reason to change it anyway is the better argument: the
message it prints on failure tells a future reader the assertion is vacuous when it is not, and a
reader who acts on that message **deletes a real check**. The failure mode is one step removed from
the assertion, which is exactly the kind that survives review. R2-M21 proves the emptiness check
fires.

## Item 4 — the two small ones

- **N-2 — fixed.** `patient-detail.ts` no longer says "A text input has no null; the plan does" about
  an input that does not exist. It now says why the field is _kept_: so `parseDraft` can recognise the
  key in an older draft and blank it deliberately, rather than ignoring it by omission.
- **N-3 — fixed.** The round-1 itemisation was wrong. The actual shape: **four** new cases in the
  cultural-identity describe, **one** for the live region, **two** for I-1, and **zero** for the notice
  content pin — that is an assertion added inside an existing case, not a case. Two cultural-identity
  cases were removed. Net +5, and 319 → 324 was right; the attribution was not. **The arithmetic being
  right is what let the wrong attribution through**, which is worth naming: a total that reconciles
  invites nobody to check its parts.

## The three corrections to what I said in round 1

**1. The §2.5 generalisation overshoots, and the narrower rule is the useful one.** I wrote "a
document whose every sentence describes an unbuilt capability". That is false, and my own replacement
copy proves it: the screen reproduces §2.5's negative constraints — never eligibility, never timing,
never pathway, never message content, never a worklist row — because **those are true today**. Under
the sweeping version I stated, my own text would have been self-contradictory.

The accurate rule: **every affirmative capability sentence in §2.5 is unbuilt; the negative
constraints are the part safe to reproduce.** That is narrower, checkable, and it is what I was
actually doing. It also generalises properly — for any spec section describing a system that does not
exist yet, the affirmatives are promises and the negatives are boundaries, and only the second kind
can be repeated on a screen as fact.

**2. On I-1, "finish the sentence" was too kind to myself.** I framed the report defect as an
unfinished thought. It was not. _"`ready` is passed, and it arms when Task 9 builds review"_ was **a
prediction about a code path that had never executed, written as a property of the code** — and wrong
on its own terms, because `ForwardControl` returns before it reads `ready`. The rule to carry is:
**a mechanism you have not seen run is a hypothesis, and reporting it as coverage is the failure.**
That is a different discipline from finishing a sentence; it is a rule about which claims require an
observation before they may be written down.

**3. My check depends on naming discipline, and that dependency should travel with it.** "For every
assertion, name the wrong value it should reject, then confirm it rejects it" worked on M-1 and M-2
because both cases were **named for the rule** — "inside the approved window", "not the staffed line
or the crisis contact" — so the wrong value was derivable from the name. A vaguely named case yields
nothing to name, and the check quietly returns nothing rather than failing. So the rule has a
precondition: **name the case for the rule it enforces, or the check that would catch its tautology
cannot run.**

## Round 2 mutation log — every attempt, itemised, no aggregate

| #      | Mutation                                                                                           | Predicted                                                                                                                  | Observed                                                                                                                                                                            | Verdict                 |
| ------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| R2-M16 | The removed sentence "It is used for aggregate reporting on programme reach" put back on the stage | 1 red, on the `is/are used for` member of the family                                                                       | `the stage makes an affirmative claim about an unbuilt capability: /\b(?:is\|are)\s+used\s+for\b/i`                                                                                 | RED, prediction matched |
| R2-M17 | "Reach figures are produced from this" — a phrasing the ORIGINAL two regexes both allowed          | 1 red, on the `reach figures` member; and it demonstrates the widening is not inert                                        | `the stage makes an affirmative claim about an unbuilt capability: /\breach\s+(?:figures\|numbers\|counts\|data)\b/i`. Checked against the round-1 pair by hand: neither matches it | RED, prediction matched |
| R2-M18 | "would depend on" removed from the absence statement                                               | 1 red, on the positive counterfactual half                                                                                 | `expect(element).toHaveTextContent() … /would depend on/i`                                                                                                                          | RED, prediction matched |
| R2-M19 | The cultural-identity `TextField` put back                                                         | 1 red on "offers no input for it" — **and I predicted it would fire on the FIRST assertion, leaving the id list unproved** | `expected <input …(6)></input> to be null`. The id list was never reached, exactly as predicted, which is why R2-M20 exists                                                         | RED, prediction matched |
| R2-M20 | The identifiers field's `id` renamed, so the cultural query stays null and the list is reached     | 1 red on the id list itself                                                                                                | `stage 3 collects a field it should not, or has lost one it should: expected [ Array(3) ] to deeply equal [ Array(3) ]`                                                             | RED, prediction matched |
| R2-M21 | The caution's condition replaced with `true`, so the region is never empty                         | 2 red: the emptiness assertion, and the "clears when the number is reserved" half                                          | Exactly 2: `expect(element).toBeEmptyDOMElement()`, and `expected 'Entered by youA referral carries no n…' not to match /not one of the reserved fictional nu…/i`                   | RED, prediction matched |
| R2-M22 | `parsePatientDetail` carries `culturalIdentity` through instead of blanking it                     | 2 red in the draft suite                                                                                                   | Exactly 2, both `expected 'Noongar' to be ''` — the round-trip case with its named message, and the dedicated blanking case                                                         | RED, prediction matched |
| R2-M23 | `createPlanPatientDetail` returns the trimmed value again                                          | 1 red in the patient-detail suite                                                                                          | `a supplied cultural identity was passed through to the plan: expected 'Noongar' to be null`                                                                                        | RED, prediction matched |

Each mutation confirmed present by its own `grep -c`, run as a separate command with `;`, against a
committed file; `git status` clean after every revert. No anchor failed to match this round.

**The N-1 fixes additionally have test-first evidence**, which is stronger than a mutation and is
recorded here rather than only in the commit: the three N-1 cases were written before the fix and run
before it, producing `3 failed | 24 passed (27)` with the messages `a supplied cultural identity was
passed through to the plan: expected 'Noongar' to be null`, `a stored cultural identity survived a
reload, so the screen's claim depends on nobody having one: expected 'Noongar' to be ''`, and
`expected 'Noongar' to be ''`.

## Round 2 gates

**The guard set, `npm run test:cc-guards`** — run after every fix in this round:

```
[cc-guards] exit=0 elapsed=54s
 Test Files  17 passed (17)
      Tests  325 passed (325)
   Duration  50.14s (transform 2.44s, setup 2.54s, import 8.93s, tests 49.25s, environment 9.59s)
```

325, up from 324: **one net new case** — the dedicated blanking case for N-1. The other N-1 assertions
went into existing cases, and the item 2 and item 3 work changed assertions rather than adding cases.
(Counted from the code this time, not reconstructed from a total — that is N-3's lesson applied
rather than restated.)

**The full suite, once, at the end, backgrounded from the first command:**

```
[test] exit=0
 Test Files  834 passed | 3 skipped (837)
      Tests  10121 passed | 74 skipped (10195)
   Duration  513.81s (transform 51.08s, setup 82.11s, import 266.30s, tests 1001.84s, environment 331.93s)
```

Clean, no lease incident, and `tests/codex-cloud-setup.test.ts` green again — the second consecutive
run on which it passes, which is now a pattern rather than a single observation.

(The `check:function-grants: FAIL` lines mid-run are one test's own positive-control fixtures printing
their expected refusals, not failures.)

**Typecheck and lint:**

```
[typecheck] exit=0 elapsed=15s
[gate-receipts] recorded a pass for "typecheck:internal" (5326 input files).

[lint] exit=0 elapsed=10s
[gate-receipts] recorded a pass for "lint:internal" (5326 input files).
```

**Prettier, whole tree: clean apart from this report, which was then formatted.** The three
pre-existing unformatted files reported in round 1 have been fixed by the coordinator, so
`npx prettier --check .` now returns only files this task owns.

## Does round 2 touch the browser gate?

**No.** `tests/ui-caring-contacts-workspace.spec.ts` is unchanged in this round and in both previous
ones. Every change is inside stage 3's body, its pure module, the draft parser, or the tests — all of
it behind the referral the isolated Playwright server does not seed, which the reviewer confirmed
independently from that spec's own comment. The coverage gap is unchanged: the removed field, the
always-rendered live region and the blanked draft field have no browser evidence, and cannot until
that server seeds a referral.

---

# Round 3 — the missing mutation, and what "proved" actually means here

Commit: this report. **No source changed** — R3-M24 and R3-M25 were both applied and reverted, and
the only file this round edits is the report plus one test comment. So the guard set is the gate; no
full suite, as you said.

## The unproven assertion, and why the asymmetry is the real finding

**Confirmed.** `"makes no present-tense claim…"` ends with two `toHaveTextContent` assertions and only
`/would depend on/i` had a mutation. R3-M24 now isolates the other one: rewording the screen to
"is **not connected to a** hospital record" leaves `/would depend on/i` intact and the family regexes
unmatched, and fails on that clause alone.

**The asymmetry is what I want on the record, because it is the part I cannot put down to
inattention.** In the same round I wrote out, at length, that the regex loop covers a family and that
"a fourth phrasing outside the family still passes" — an unprompted disclosure of an unproven
residual. Two lines below it, in the same case, I left a second assertion with no mutation and wrote
"prove all three parts fire". So it is not that I cannot see unproven assertions; it is that I saw
one, described it well, and then **treated the description as if it had discharged the obligation for
the whole case**. Disclosing a limitation feels like completing the audit. It is not the audit.

## The general form, in my words, kept

> **A mutation proves the assertion it makes fail — not the case it makes red.** A case with N
> assertions needs N mutations, or it needs splitting.

The order-masked rule I gave you last round is a _special case_ of this one, not a separate rule:
when an earlier assertion fails first, the later one is not merely unproven but unreachable by that
mutation. Both reduce to the same discipline — **count assertions, not red cases.**

And a third thing follows that I did not see until I did the counting: **order-masking is a property
of a (case, mutation) pair, not of a case.** R2-M19 masks the id list; R2-M20 does not. Saying "this
case is order-masked" is already the wrong shape of claim.

## Which of my cases are in which state

You asked me to say, so here it is counted from the code rather than estimated. Every case I added or
materially changed in Task 8, by whether **each** of its assertions has a mutation that makes **that**
assertion fail:

**Fully proved, per assertion — four cases:**

| Case                                                                                      | Assertions | Mutations      |
| ----------------------------------------------------------------------------------------- | ---------- | -------------- |
| `treats whitespace as absent, which the schema alone would not`                           | 1          | M1             |
| `names only the two reserved PATIENT mobiles, not the staffed line or the crisis contact` | 2          | R1-M12, R3-M25 |
| `offers no input for it`                                                                  | 2          | R2-M19, R2-M20 |
| `states the same send time the schedule actually uses`                                    | 1 (looped) | M3, R1-M11     |

**Partially proved — every other case I own.** The largest gaps, named rather than summarised:

| Case                                                              | Assertions               | Proved                         | Unproven                                                    |
| ----------------------------------------------------------------- | ------------------------ | ------------------------------ | ----------------------------------------------------------- |
| `makes no present-tense claim… (I-3)`                             | 8 (6 looped regexes + 2) | R2-M16, R2-M17, R2-M18, R3-M24 | 4 of the 6 regexes                                          |
| `keeps a patient's name, number and identifiers across a reload`  | 6                        | R2-M22 (cultural identity)     | name, mobile, identifiers, sending preference               |
| `keeps the caution's live region on the page from the start`      | 5                        | R2-M21 (emptiness)             | role, content-after-typing, describedby link, non-empty id  |
| `will require an incomplete stage 3 to be unable to advance`      | 5                        | R1-M14 (the armed refusal)     | the `aria-disabled` absence, the enabled-when-complete half |
| `trims the two required fields and carries exactly the four keys` | 4                        | —                              | all four                                                    |
| `asks the clinician to TYPE the patient's name…`                  | 4                        | —                              | all four                                                    |

That is the honest position: **4 of the ~30 cases I own are proved assertion by assertion.** The rest
have one or two mutations each and are proved to be _alive_, not proved _complete_. I am not going to
close that gap in this round — you scoped it to one mutation and prose, and a further twenty
mutations is its own piece of work — but the count is now written down instead of implied, and the
biggest gaps are named so the next person does not have to rediscover which they are.

**Is anything intrinsically unreachable?** No, and I checked rather than asserting it. The candidate
I suspected was the not-contains loop in the reserved-mobiles case: given the exact-equality
assertion above it, `[mira, rowan]` cannot contain a service line, so I had it written down as
redundant — a check that cannot fail, which is the worst kind. **That was wrong, and the mutation is
what told me.** R3-M25 sets `rowanPatientMobile` to the crisis-support number: the equality assertion
still passes, because both sides read the same mutated record, and the loop fails with `a number a
patient CALLS is offered as a number a patient receives on`. It catches precisely the confusion the
case is named for. I have added that mutation's name to the assertion's own comment so nobody
"simplifies" it away on the reasoning I nearly filed.

**The near-miss is worth more than the result.** I was one paragraph from reporting a sound assertion
as dead weight, on an argument that was internally consistent and wrong. What caught it was running
the mutation I was about to claim was impossible — which is the same rule as everything else in this
round: **a property you have not seen fail is a hypothesis.**

## Round 3 mutation log — every attempt, itemised, no aggregate

| #      | Mutation                                                                 | Predicted                                                                                                                    | Observed                                                                                                                        | Verdict                 |
| ------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| R3-M24 | "connected to no hospital record" → "not connected to a hospital record" | 1 red, isolating the SECOND counterfactual clause: `/would depend on/i` survives, no family regex matches                    | `expect(element).toHaveTextContent() /connected to no hospital record/i`, at the second of the two lines                        | RED, prediction matched |
| R3-M25 | `rowanPatientMobile` set to the crisis-support number                    | 1 red on the not-contains loop, with the equality assertion above it still PASSING — the pair I had wrongly called redundant | `a number a patient CALLS is offered as a number a patient receives on: expected [ Array(2) ] to not include '+61 491 570 158'` | RED, prediction matched |

Both confirmed present by their own `grep -c`, run as a separate command with `;`, against committed
files; `git status` clean after each revert. No anchor failed to match.

## Round 3 gate

Guard set only, and no full suite: the only tracked change this round is the report plus one comment
in `tests/caring-contacts-plan-patient-detail.test.ts`. Both mutations were reverted and `git status`
is clean, so no source ships.
