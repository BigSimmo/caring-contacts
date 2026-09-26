# Task P round 2 — scoped re-review

**Verdict: round 2 is SAFE TO MERGE.** No Critical, no Major. Findings are recorded below and none of
them holds the merge.

**Scope reviewed.** The commits after the round-1 close at `5e28a05a8`, confirmed against the branch
rather than taken from the brief, and each checked to exist with `git cat-file -e <sha>^{commit}`:

| commit      | subject                                                    | what it actually changes                            |
| ----------- | ---------------------------------------------------------- | --------------------------------------------------- |
| `5c78c0dcf` | make the null-preferred-name row inside an audited session | `tests/caring-contacts-postgres-repository.test.ts` |
| `1232cbcd7` | task P gate evidence, and the void mutation row            | `task-p-report.md`                                  |
| `05487cdd7` | send the unsendable-name refusal back to the patient       | `patient-detail.ts`, `message-copy.ts`, two suites  |
| `e0285a737` | task P round 2 — ledger repairs and the corrected claim    | `task-p-report.md`                                  |

The controller's list matched the branch. Round 1 is read for context only; its findings are closed
and are not this review's work list.

---

## 1. The patient-visible wording — the thing this review exists for

**Round 2 changed no executable line of `message-copy.ts`.** Verified mechanically rather than by
eye: with block and line comments stripped and blank lines dropped, the file at `5e28a05a8` and the
file at HEAD are identical strings. Every `+`/`-` line in round 2's diff of that file is a JSDoc
continuation.

**Across the whole branch — not only round 2 — the only change to any patient-visible string is
`Rowan` becoming `${preferredName}`.** Verified by taking the constant as it stood at the Task P base
`1f7be1673`, substituting `Hi Rowan,` → `Hi ${preferredName},`, and comparing byte-for-byte against
the template function at HEAD: equal. `PATIENT_VISIBLE_NO_REPLY_NOTICE` and
`AUTOMATED_REPLY_RESPONSE` are byte-identical to their base-commit forms.

**Nothing is newly authored.** The prohibition on an implementer drafting patient-visible message
wording is not breached, in round 2 or anywhere on this branch.

Independently recomputed from the GSM-7 tables in `message-policy.ts`, rather than read from the
report: the specimen message is 252 septets / 2 segments; the message with the slot empty is 247
septets; the two-segment ceiling is 306; the cap is 59; a name of 59 basic-set characters lands
_exactly_ on 306 and stays at 2 segments; one character more is 307 and 3 segments. The report's
figures are correct.

---

## 2. What a discharged patient reads, in every branch

**First, the fact that frames all of it: nothing is sent to anyone.** There is no send path in this
tree. `resolvePatientVisibleMessage` has exactly two production callers, both of them validation
inside the plan wizard (`personalisationIssues` and `createPlanPatientDetail`). No screen renders a
personalised message. The screens that render the specimen — `personalisation-screen.tsx`,
`product-ui.tsx`, `review-activation-screen.tsx` — sit under `src/components/caring-contacts/mockups/`
and are reached only from `src/app/mockups/caring-contacts/`, which 404s in production. I checked
that reachability rather than assuming it.

So the following is what this code _would_ produce if a sender existed, which is the honest form of
the answer:

**Branch A — a preferred name is held, is inside the GSM-7 alphabet, and costs at most 59 septets.**
The patient reads:

> Hi «Name», Alex from Example Aftercare Team is thinking of you. This is a one-way message. No one
> reads replies to this number. For timing changes call +61 491 570 157, 9 am-6 pm. In an emergency
> call 000. Fictional Support Line: +61 491 570 158. - Alex

Every word other than «Name» is byte-identical to the text that stood on this branch's base. Two SMS
segments.

**Branch B — no preferred name is held** (`null`, `""`, or whitespace only). The patient reads
**nothing at all.** `resolvePatientVisibleMessage` refuses with `preferred-name-not-recorded`. There
is no unpersonalised wording anywhere in the tree and none was invented. The wizard also refuses to
create such a plan.

**Branch C — the preferred name carries a character outside GSM-7** (`Zoë`, `Aroha-Lī`). The patient
reads **nothing at all.** Refusal `preferred-name-not-sendable`; the plan cannot be created through
the wizard, and `createPlanPatientDetail` returns `null` for a detail object built by hand.

**Branch D — the preferred name costs more than 59 septets.** The patient reads **nothing at all.**
Refusal `preferred-name-too-long`; the plan cannot be created.

**Branch E — the episode has been de-identified** (`preferredName === ""`, the retention clearance's
own value). Identical to branch B: the resolver treats it as not recorded, and the patient reads
nothing.

In branches B, C and D what changes is what the **clinician** reads on stage 3, and branch C's
clinician wording is the whole of round 2's executable change:

- before: `A text message cannot carry ë, so the message would arrive damaged. Enter the closest spelling an ordinary text message can send.`
- after: `A text message here cannot carry ë, so this plan's message could not be sent as written. Ask them how they would like their name spelled in a text message, and enter that.`

Both are rendered beside the stage-3 field. Neither is ever transmitted to anybody.

---

## 3. The refusal path — read literally

`05487cdd7`'s subject, "send the unsendable-name refusal back to the patient", is a metaphor about
**who decides the spelling**, not about transmission. Read literally it would describe a message
reaching a patient, and it does not: the refusal is a `PersonalisationIssue.message`, rendered as the
`requirement` prop on the stage-3 field, in the clinician's browser.

**Does a refusal change what the patient receives? No.** It changes whether a plan exists to send
anything at all. That block is round 1's, not round 2's; round 2 reworded the explanation the
clinician reads and corrected the reasoning behind it.

**The block itself remains an open owner decision, and I agree with the implementer that it is one.**
Sharpening why it matters clinically: the GSM-7 basic set carries `à ä ö ñ ü è é ù ì ò Ç Å Æ ß É` but
does **not** carry `ë`, `ï`, `í`, the macrons `ā ē ī ō ū`, lowercase `ç`, or any character outside
Latin-1's GSM subset. In a Perth service that is a routine population, not an exotic one. The
implementer's round-2 rewording is a genuine improvement — it stops instructing a clinician to strip
someone's diacritics and sends them back to the person — but a clinician still cannot proceed, and
the person is still being asked to supply a diminished spelling of their own name. That is the
owner's call, not an implementer's, and the report says so.

The round-2 correction to the _reasoning_ is right and worth keeping: the earlier claim that such a
message would "arrive damaged" was stronger than anything known, and the demonstrable failure —
`validateGovernedMessage` evaluates the segment ceiling only `if (gsm7.valid)`, and
`MessageValidationIssue` carries no invalid-characters code — is real. I confirmed both in
`message-policy.ts`.

---

## 4. The GSM-7 segment budget

**The assertion exists, it is load-bearing, and it can go red.** The bound in
`tests/caring-contacts-message-copy.test.ts` quantifies over every accepted name length and asserts
both the septet ceiling and `evidence.segments <= PROVISIONAL_MESSAGE_RULES.maxSegments`. The second
of those is the anchor that matters: `maxSegments` is data in `message-rules.ts`, so it cannot
co-vary with `maxSeptetsWithin`, and an inflated ceiling would still be caught. Both ends are tested,
and the two-septet extension character `€` covers septets-versus-characters. The ledger reddens the
cap at `M1`, `M2`, `M3` and `M21`.

**The exact `252` pin was not deleted, and the report's claim about where it lives is true.** It sits
at `tests/caring-contact-mockups.dom.test.tsx:130`, and it was already there at the Task P base
`1f7be1673` — checked, not taken on trust. Round 2 did not touch that file.

**Round 2 changed none of this.** No re-run of the segment count was owed, because no round-2 change
can move it.

---

## 5. Privacy

Round 2 introduces no new privacy surface.

- Nothing in the round-2 diff touches routing, URLs, or search parameters. The wizard's only
  navigation is `router.push(patientPlanRoute(patientId, body.planId))` — identifiers, never a name.
- The refusal string interpolates characters taken from the patient's preferred name. That was
  already true in round 1; it reaches the clinician's screen as React text and goes nowhere else. It
  is not logged, not stored, and not sent.
- `5c78c0dcf` writes a fabricated audit row so the raw column strip can happen inside an audited
  team session. Asked what it stores _incidentally_ rather than what it is for: its columns are team,
  actor, roles, action, object type, object id, outcome, idempotency key and timestamp — no patient
  content, no payload. The suite truncates in `afterEach`, so it cannot leak into a sibling case. It
  is test-only, against a disposable local schema.

---

## 6. Findings

### Minor 1 — one of round 2's two new assertions is unproven, and it sits behind a sibling that fails first

`tests/caring-contacts-plan-patient-detail.test.ts` gained two assertions:

```ts
expect(refused[0].message, "…").toMatch(/ask them how they would like their name spelled/i);
expect(refused[0].message.toLowerCase()).not.toContain("closest spelling");
```

The ledger carries one mutation for them, `M22`, which reverts the string to its round-1 wording.
Under that mutation the `toMatch` fails first and the `not.toContain` is never reached. The standing
discipline states both halves of this exactly: _"A case with N assertions needs N mutations, or it
needs splitting"_, and _"an assertion behind a sibling that fails first is never reached."_

It is not decoration — the sibling `toMatch` establishes the string is real and non-empty, so this is
not the empty-fixture family — and it is provable: a wording carrying both phrases would redden it.
It is simply unproven, in the round whose stated purpose was repairing mutation evidence.

### Minor 2 — a restated prose count is wrong

`task-p-report.md` says **"Six rows are worth reading rather than counting."** The paragraphs that
follow it lead with, in order, `M4`, `M20`, `M20b`, `M20c`+`M20d`, `M6`+`M19`, `M22`, `M11` — seven
paragraphs naming nine rows. The number matches neither reading. Round 1 said "Four" above four
paragraphs, the last of which describes a driver defect rather than a row, so the count was wrong
then too and round 2 moved it without fixing it.

The standing discipline names this defect and records that it has been broken by every role in this
programme, repeatedly, in the act of removing someone else's count. The fix is to name the rows
instead of counting them.

### Minor 3 — the mutation driver is not in the tree, so the ledger's evidence columns cannot be checked by a reader

`present`, `head` and `attempt` are the implementer's report of what a scratchpad script did. The
central round-2 repair — _"the driver now records `head` on every row"_ — rests entirely on an
artefact that is not committed and that nobody but its author has seen. Per the discipline, a
mechanism nobody has watched run is a hypothesis.

What **can** be checked from the repository, and does hold:

- Every row id is unique — checked by extracting the table and comparing the id set to itself, not
  by eye.
- `M17` is the only gap in the base numbering, and the report explains it as a numbering slip.
- Every row carries a `head`, and every distinct head — `2a11d3b0c`, `f0336d1d1`, `5e28a05a8`,
  `5c78c0dcf`, `05487cdd7` — is a commit that exists on this branch.
- The ancestry the narrative depends on is real: `2a11d3b0c` precedes `f0336d1d1`, which is where the
  case that broke the Postgres suite was added; `f0336d1d1` precedes `5c78c0dcf`, which fixed it. So
  `M6` and `M19` at `2a11d3b0c` genuinely predate the broken case, and `M20b` at `f0336d1d1`
  genuinely ran inside the broken window. The VOID label is correct.
- `M4` and `M20` are the only rows whose observation differs from its prediction, and both are
  disclosed at length rather than relabelled.

The repair is honest and its arithmetic checks out. The limitation is structural to this programme's
method, not something round 2 introduced, and I record it so nobody later reads the table as
independently verified.

### Minor 4 — `5c78c0dcf` cannot be verified without Docker

That commit changes only `tests/caring-contacts-postgres-repository.test.ts`, which lives in
`caring-contacts:db:test` and is in no Vitest project that runs without a local Postgres. It is not
in `test:cc-guards`. The report claims `Tests  204 passed (204)`; I did not re-run it, and this
review does not corroborate that line.

### Minor 5 — the gate table's attribution moved a commit forward while every number stayed identical

At `1232cbcd7` the report read _"Every gate below ran on `5c78c0dcf`, the last commit that changes
code; the only commit after it touches this report and nothing else."_ `05487cdd7` then landed and
falsified that sentence. `e0285a737` updated the attribution to `05487cdd7` — and left **every result
byte-identical**: `18 passed / 432 passed`, `12 passed / 328 passed`, `2 passed / 204 passed`.

Identical numbers are entirely consistent with a genuine re-run, because `05487cdd7` adds assertions
to an existing `it` and renames it, neither of which moves a test count. They are equally consistent
with the attribution having been edited without the gates being re-run. **Nothing in the report
distinguishes the two**, which is precisely the gap the round-2 ledger repair closed for the mutation
rows by recording `head` per row, and did not close for the gate table.

The discipline is explicit that an edit after a gate voids that gate's verdict, and the fix is
re-running rather than re-attributing. What the ledger does establish independently is that the
machine ran _something_ at `05487cdd7`: `M22`, `M6b`, `M19b` and `M20d` all record that head, and
`M22` targets `plan-patient-detail` — the suite carrying the only executable change. That suite is
one of the three this review re-ran itself on the final tree (§9, `Tests  83 passed (83)`), which
settles the practical risk for the file that matters and leaves the wider table on the implementer's
word.

### Nit 1 — a refusal can name an invisible character (pre-existing, from round 1)

`` `A text message here cannot carry ${issue.unsupportedCharacters.join(" ")}, …` `` renders whatever
`calculateGsm7` rejected. A zero-width space (`U+200B`) or a soft hyphen (`U+00AD`) survives
`String.prototype.trim`, fails the alphabet check, and produces a refusal that appears to name
nothing at all. Pasting a name out of a hospital record system is exactly how such a character
arrives. Round 2 did not introduce this and it is not a merge blocker; it belongs to whichever task
next touches that message.

### Nit 2 — the retracted claim survives in a test's own name, and the report says it does not

Round 2 retracted "the message would arrive damaged" as stronger than anything known, and the report
states the correction was applied _"wherever I wrote it — `message-copy.ts`, the two covering tests,
and this report."_ That sentence is falsifiable, and it is false in one place:

```
tests/caring-contacts-message-copy.test.ts:145
it("refuses a name this channel cannot carry, rather than emitting a message it would mangle", …)
```

Round 2 rewrote the comment **inside** that `it` and left its title carrying the retracted
proposition. A test name is what a reader sees in a failure and in a reporter's output, so it is the
sentence most likely to be read and least likely to be re-derived. The corresponding quotation in
`message-copy.ts` is fine — it is explicitly framed as the claim being withdrawn.

Cosmetic, and it does not hold the merge. It is recorded because the over-claim in the report is of
the same family as the over-claim the round was correcting.

---

## 7. For the owner — a consequence worth knowing, not a defect

**The preferred-name slot now spends the entire remaining two-segment budget.** The message with the
slot empty costs 247 septets against a 306-septet ceiling, and the cap is set to the whole remaining 59. A maximum-length name lands exactly on the ceiling, deliberately — the report argues, correctly,
that a cap which is merely safe is a different claim from one that is right.

Two things follow, and both are for the owner rather than an implementer:

1. **Copy decision A9** — adding Lifeline `13 11 14`, approved in principle and blocked on a real
   crisis number — has no room left at a maximum-length name. It had room before this branch. The cap
   is computed from the wording, so it will shrink automatically rather than silently break; but the
   decision "what comes out to let Lifeline in" now has a second claimant.
2. **A wording change can render an existing plan's stored preferred name too long.** Nothing
   re-validates stored names when the wording moves. The failure is conservative — the resolver
   refuses and no message is built, rather than sending an over-length one — but no coordinator is
   warned, and the plan would simply stop having a message it could send.

---

## 8. Two premises in the review brief I was given are wrong, and both were relayed rather than checked

Recorded because a brief is the most expensive place for a false claim to sit.

1. **"Patient-visible copy is FROZEN until the owner answers."** It is not. The owner approved all
   thirteen copy decisions on 2026-08-24, and the banner at the head of
   `docs/caring-contacts/copy-decisions-recommended.md` says the strings are no longer frozen —
   subject to each change citing the item it implements. Commit `875c8b604` removed the freeze line
   that contradicted it. What remains in force, and what actually governs this branch, is the
   narrower rule: **no implementer may author patient-visible message wording**, and A4's closing
   message is a deferral rather than approved text. Round 2 complies with the rule that is real.

2. **"Message A is 252 characters — two SMS segments, roughly nine characters from rejection."** It
   is 252 **septets**, and there are **54** septets of headroom to the 306-septet two-segment
   ceiling. The Task P brief warned explicitly against inheriting this exact false claim — _"The
   controller generalised that sentence and told the owner something false; do not inherit the
   error"_ — and it has now been relayed once more. Nine characters is the figure in
   `copy-decisions-recommended.md`'s A9 note, and it is wrong there too.

**A third premise is accurate but does not bite here.** `message-copy` and `message-policy` are
indeed in no branch's `test:cc-guards` list — I read the gate's suite list in `package.json` and
neither is among the paths it names. But round 2 changed **no code** in either module. The one executable round-2
change is the string in `patient-detail.ts`, and `tests/caring-contacts-plan-patient-detail.test.ts`
**is** in the gate. So the gate omission the controller measured leaves no round-2 code unrun.

---

## 9. Gates this review ran

Reported honestly rather than by exit code.

| check                                                                                                 | result                                                                          |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `npx prettier --check` on the report and every round-2 changed file, **on the final tree**            | `All matched files use Prettier code style!`                                    |
| control-byte and CR scan of every round-2 changed file, read in-process                               | zero control bytes, zero CR, in each file                                       |
| GSM-7 arithmetic recomputed independently from the alphabet tables                                    | 252 / 2 segments; base 247; cap 59; 59-septet name = 306 = 2 segments; 60th = 3 |
| `git cat-file -e <sha>^{commit}` on every SHA this review states                                      | all exist                                                                       |
| the new refusal string against the repo's own interface-vocabulary regex                              | no match — the gate cannot redden on it                                         |
| `npx eslint` on every round-2 changed file, cache directory removed first                             | no diagnostics printed, exit 0                                                  |
| `node scripts/run-vitest.mjs run --reporter=dot` on message-copy, message-policy, plan-patient-detail | `Test Files  3 passed (3)` / `Tests  83 passed (83)` — on attempt 16, see below |
| `npm run typecheck`                                                                                   | **UNRUN — lock refusal, see below**                                             |

**ESLint's silence is its pass form**, unlike Vitest's. There is no `N passed` line to paste for it,
so the honest statement is that it printed no diagnostics and exited 0 — and that is only meaningful
because `node_modules/.cache/eslint` was removed first. A cached run would have reported the same
thing having examined nothing.

The vocabulary check was run by **reading both the regex and the string out of the repository** —
`tests/helpers/caring-contacts-prohibited-language.ts` and `patient-detail.ts` — rather than
retyping either. Retyping the regex is not a hypothetical risk: my first attempt at it turned the
`\b` word boundaries into literal `0x08` bytes, which is the failure this programme has already
recorded and which leaves every gate green.

It also bounds what a missed re-run in Minor 5 could cost. Only two suites read the changed string:
`caring-contacts-plan-patient-detail` (updated in the same commit) and
`caring-contacts-interface-vocabulary`, whose regex demonstrably does not match it. No other test in
the tree asserts on the old wording — `closest spelling` and `arrive damaged` appear nowhere else.

The prettier check matters beyond formatting: the implementer's own gate table ran at `05487cdd7`,
and `e0285a737` edited the report afterwards. Under the discipline that edit voids the earlier
verdict for the report file. Re-running it on the final tree closes that gap; it is clean.

### The narrowed run landed on its sixteenth attempt; the typecheck never did

`D:\Worktrees\Database\pr-2390-fix` held the exclusive heavy lease for almost the whole review,
running `playwright tests/ui-ward-roles.spec.ts --project=chromium-mockups` — and running it
**repeatedly**, not once: the lease record's owner PID and start time both moved between refusals
(PID `5556` from `02:08`, then PID `45704` from `02:32`). A retry loop attempting the narrowed
selection every forty-five seconds was refused fifteen consecutive times before the lease cleared.
**No lease was ever forced.** The run that landed:

```
 RUN  v4.1.10 D:/Worktrees/Database/cc-message-name
 Test Files  3 passed (3)
      Tests  83 passed (83)
   Duration  3.46s
```

The tree it saw carries no source or test change since `05487cdd7` — `git diff 05487cdd7..HEAD -- src
tests caring-contacts` is empty, the only later commits being this review file. So that verdict
covers exactly the code round 2 shipped.

`npm run typecheck` was refused and is recorded UNRUN. I did not retry it: round 2 adds no type, and
the compile-affecting part of it — the three helper imports `5c78c0dcf` added to the Postgres suite —
is settled by reading `tests/helpers/caring-contacts-postgres.ts`, where `runInTeamSession(pool,
options, work)`, `nextAuditToken()` and `insertAuditEvent(client, event)` all exist with the
signatures the new call sites use.

**Both refusal shapes appeared, and one of them arrived with exit 0.** Worth writing down because it
is the trap this programme has already recorded and it reproduced exactly:

- `node scripts/run-vitest.mjs` **threw**, ending in a Node stack with no marker:
  `Error: Database focused-test capacity is full (current owner PID …)`.
- `npm run typecheck` printed the marker `DATABASE_HEAVY_RUN_ADMISSION_BUSY` — and because it came
  through a pipe, the shell reported `chain exit=0` for a gate that never ran. A detector reading
  the exit code would have recorded that as a pass.

**What this leaves open.** Minor 5's practical risk is now closed for the suites that matter: the
three that carry the round-2 change and the two modules the controller flagged as absent from every
branch's gate are green on this tree, independently of the implementer's numbers. What remains
resting on the implementer's word is the _wider_ table — the full `test:cc-guards` selection, the
twelve-file supplementary selection, and the Postgres suite, which needs Docker to be covered at all.
Whoever runs the wide gate at the merge point closes that.

<!-- REVIEW GATE EVIDENCE -->

---

## 10. Recommendation

**Merge round 2.** The one executable change is a clinician-facing string that improves on what it
replaced, in a file the gate already covers, with a mutation that reddens the assertion the change
exists for. No patient-visible wording moved. Every finding above is documentation or evidence
hygiene, and none is worth a third review pass over comment and report edits.

Two things should travel forward rather than be lost:

- The owner still owes an answer on whether a name outside the GSM-7 alphabet should block plan
  creation. Round 2 improved the wording of that block; it did not settle whether the block is right.
- Section 7's headroom consequence should reach whoever next revisits copy decision A9.
