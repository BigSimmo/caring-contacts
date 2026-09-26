# Task 9b report — the stage-1 confirmations, recorded as an attestation

**Status:** implemented and verified. Every gate the policy allows is green, and the mutation ledger
is complete — twelve mutations, all landed, one of which falsified one of my own assertions and was
fixed. Details in "Mutation ledger" and "Gates" below.

**Branch:** `claude/browser-test-gate-handoff-d5c1db`, worktree
`.claude/worktrees/browser-test-gate-handoff-d5c1db`. Nothing pushed, no pull request.

---

## What was built

An activated plan now carries evidence that a coordinator confirmed the stage-1 checks. It records
**that a check happened** — who confirmed, what they confirmed, when — and it does **not** record
that the patient consented. Agreement is held in the patient's hospital record, which this system is
not connected to; the coordinator is confirming they checked it.

That distinction is carried in four places rather than only in prose, because prose does not survive
an edit:

- the type name (`PlanAssuranceAttestation`) and both value names
  (`patient-agreement-confirmed`, `patient-controls-mobile-confirmed`) name the **act**;
- the module header of `src/lib/caring-contacts/assurances.ts` states what it is and what it is not;
- the migration's `comment on table` records the same thing on the schema itself, so it travels with
  the table rather than living only in a test;
- each of the wizard's wording sites keeps a **pin against the overshoot** — a screen claiming the
  plan records the patient's consent goes red.

### Files

| File                                                                           | What changed                                                                                                                                                                                  |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/caring-contacts/assurances.ts`                                        | **New.** The closed vocabulary, the attestation type, and a compile-time guard against a fourth field.                                                                                        |
| `src/lib/caring-contacts/repository.ts`                                        | `PlanRecord.assuranceAttestations`, `CreatePlanInput.assurances`, two named refusals, `admitPlanAssurances`, and the note beside `CLEARED_PATIENT_DETAIL` recording what it must never reach. |
| `src/lib/caring-contacts/in-memory-repository.ts`                              | Stamps actor and instant at creation; copies attestations out of storage rather than handing the live object out.                                                                             |
| `src/lib/caring-contacts/db/postgres-repository.ts`                            | Inserts the rows inside the create transaction; a third grouped read for `listPlans`; `readPlanRecord` widened so the compiler forced every `toPlanRecord` call site.                         |
| `caring-contacts/supabase/migrations/0006_caring_contacts_plan_assurances.sql` | **New.** The table, its closed check, its composite same-team foreign key, RLS, narrow grants, and the audit guard.                                                                           |
| `src/app/api/caring-contacts/plans/route.ts`                                   | The `.strict()` schema gains `assurances`, built **from** `PLAN_ASSURANCES` rather than restated.                                                                                             |
| `src/components/caring-contacts/workspace/plan-wizard/plan-activation.ts`      | `planAssurancesFrom`, `everyAssuranceConfirmed`, and the request body.                                                                                                                        |
| `src/components/caring-contacts/workspace/plan-wizard/plan-wizard.tsx`         | The four wording sites, plus stage 1's gate now calling the shared predicate.                                                                                                                 |
| `src/components/caring-contacts/workspace/plan-wizard/plan-draft.ts`           | The doc comment that said the confirmations are recorded nowhere.                                                                                                                             |
| `src/lib/caring-contacts/simulation.ts`                                        | Attests what a real sign-up attests.                                                                                                                                                          |
| `tests/helpers/caring-contacts-repository-contract.ts`                         | The new behaviour, in the shared suite both stores run.                                                                                                                                       |
| `tests/caring-contacts-domain-isolation.test.ts`                               | Two offline source scans (below).                                                                                                                                                             |
| `tests/caring-contacts-migrations.test.ts`                                     | Column shape, closed value set, cross-team refusal.                                                                                                                                           |
| `tests/caring-contacts-plan-wizard.dom.test.tsx`                               | The four screens, each with its overshoot pin.                                                                                                                                                |
| `tests/helpers/caring-contacts-postgres.ts`                                    | `plan_assurances` joins the truncate list.                                                                                                                                                    |
| Six other test files                                                           | `CreatePlanInput` / `PlanRecord` fixtures the compiler forced.                                                                                                                                |

---

## Ruling [122], as three decisions

### 1. On the PLAN, and specifically on `PlanRecord`

`PlanRecord`, not `StoredPlan`. That needs its own justification, because
`PLAN_RECORD_HOLDS_NO_FIRST_CONTACT_REASON` exists to keep something **off** that shape.

The reason that guard exists is what the first-contact reason **contains** — prose a clinician typed
about a patient, fetched for every patient in the team on every render of a caseload. Apply the same
test to an attestation and it comes out the other way: a closed enum value, an actor id and an
instant, no patient content at all. Judging by content rather than by category is the rule
Ruling [105] itself used, and it is the rule I used here.

The alternative — `StoredPlan` beside `patientDetail` — would have made it releasable only through
`getEpisode`, which returns `Episode`. That meant adding it to `Episode` **and** deciding what
`DeidentifiedEpisode` does with it: a wider change for a worse read.

**The cost is real and stated rather than buried:** the Postgres `listPlans` now runs a third grouped
query. One round trip per kind of row, not one per row — the same argument `listPatientNames` makes
for being a list.

### 2. A list over a closed vocabulary, not two fields

`CreatePlanInput.assurances` is `readonly PlanAssurance[]`. Adding a third confirmation is a value in
`PLAN_ASSURANCES`, a value in the migration's check constraint, and a checkbox — not a schema change.

Two named refusals guard it, and both refuse rather than silently repair:

- `plan-assurances-required` — an empty list. Refused rather than accepted-and-empty, because a plan
  holding an empty list is afterwards indistinguishable from one created before attestations existed,
  and `createPlan` is the write that decides which of those a new plan is.
- `plan-assurance-repeated` — the same assurance twice. Refused rather than de-duplicated, following
  Ruling [106]'s stance on the first-contact reason: a store that silently collapses a caller's list
  records something the caller did not send. It also keeps the two stores honest, since the Postgres
  table is keyed on `(plan_id, assurance)` and would have thrown where the map would have kept both.

`admitPlanAssurances` lives on the contract, not in either store, for the reason
`CLEARED_PATIENT_DETAIL` does: it is a rule about what a plan **means**.

**It deliberately does not decide WHICH assurances are required.** That belongs to the screen that
asks, and the design's assurance set is not frozen. The screen's rule is `everyAssuranceConfirmed`,
declared once in the wizard with two callers.

### 3. Retention must NOT clear it — pinned in both directions

`markRetentionCleared` does not touch the attestation in either store. The in-memory clearance
spreads `CLEARED_PATIENT_DETAIL` over `patientDetail` alone; the Postgres clearance names its columns
and the attestation lives in another table.

The shared contract suite holds **two cases, deliberately not one**:

- `survives a retention clearance, which must not remove evidence that a check happened`
- `does not stop that clearance removing what it is supposed to remove`

The second is the one the brief insisted on and it is not redundant: the first passes just as well
against a clearance that has stopped working entirely, because an attestation left alone by a write
that does nothing looks exactly like one left alone on purpose.

Two further offline guards hold the property where no database is available — the case in which its
absence would be silent:

- the Postgres store carries **no amend and no delete path** for an attestation;
- the migration's check constraint lists exactly the values `PLAN_ASSURANCES` declares.

---

## The four screens

Each was true when written and became false. Each now keeps a pin against the **opposite** error,
which is new: before this task there was no record at all, so "the plan records the patient's
consent" was not a sentence anyone could write. It is now.

| Site                         | Was                                                                                                     | Is                                                                                                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stage 1 panel                | "nothing in this domain records either of them … the plan that is created carries no field for them"    | "What the plan records is that you confirmed each of these, and when — not that the patient consented. Agreement is held in the patient's hospital record; what you are confirming here is that you checked it." |
| Stage 1 status line          | "Neither is recorded on the plan; like everything else on this screen, they are kept on this computer…" | "Each is recorded on the plan when the plan is created — that you confirmed it, and when. Until then, like everything else on this screen, they are kept on this computer until you finish or discard."          |
| Stage 4 review (`because`)   | "…they are not recorded on the plan — nothing in the plan being created has a field for either."        | "Creating the plan records each of those on the plan as your confirmation, with who you are acting as and the time. What is recorded is that you confirmed the patient agreed — not the agreement itself…"       |
| Stage 4 review (`changedBy`) | "What the plan records is not changed by it either way."                                                | "…and so changes what the plan will record."                                                                                                                                                                     |

The status line keeps round 2's pin (`not.toMatch(/stored anywhere|kept anywhere/i)`) unchanged: this
task did not stop the ticks being held in the tab, and the shared-ward-computer argument for pointing
at Discard draft is untouched.

`plan-draft.ts`'s type comment said the same thing and was found by reading every doc comment in the
touched files rather than by grepping the screen phrase — the scope rule, and it found the fifth site
the brief's four did not name.

### Confirmed: each now says what is true, and none overshoots

Stated explicitly because it is the whole shape of the task.

- **Each of the four now states a true fact.** The plan does record the confirmations, so the
  screens say so, and each says it in the form the wizard's own rule requires — naming the
  destination ("recorded on the plan") rather than the bare act.
- **None of the four claims the patient consented.** What every one of them says is that the
  COORDINATOR confirmed a check. Stage 1's panel says it outright — "not that the patient consented.
  Agreement is held in the patient's hospital record; what you are confirming here is that you
  checked it." Stage 4 says "What is recorded is that you confirmed the patient agreed — not the
  agreement itself".
- **The overshoot is pinned, not merely avoided.** Each site carries an assertion against the
  opposite error: the stage-1 status line rejects `consent is recorded|records the patient's
consent`, the stage-1 panel asserts `not that the patient consented` and `hospital record` are
  present, and stage 4 asserts the old "not recorded on the plan" sentence is GONE while
  `records each of those on the plan as your confirmation` is present. That last pair is what would
  have caught a stale sentence surviving the change.
- **The fifth site**, `plan-draft.ts`'s type comment, carries the same distinction in prose.

---

## A decision the brief did not name, which I took and am flagging

**Stage 4 now refuses to build a create body unless every stage-1 confirmation is made.**

Before this task, a draft restored from a tab's storage sitting at stage 4 with one tick missing
changed nothing about the plan — nothing was recorded either way. It does now: such a draft would
create a plan attesting one confirmation that had never passed stage 1's gate. The domain's own rule
stays "at least one, no repeats"; the screen's rule lives in `everyAssuranceConfirmed`, which stage
1's Continue control and stage 4's body builder both call.

Conservative — a plan that cannot honestly be created is not created — but it is a behaviour change
on a reachable path, so it is named here rather than folded in.

**Upheld by the coordinator, and now pinned and worded.** Two things were added on that ruling:

- **A test pins it.** `refuses to build a body while any stage-1 confirmation is missing, not merely
all of them` in `caring-contacts-plan-activation.test.ts` covers each half-ticked combination and
  carries a positive control, so the nulls are the confirmations rather than some other missing
  field. A second case pins the derivation itself: with none confirmed, the outstanding list is
  exactly as long as the domain's own value list, which is what would go red if the derivation were
  replaced by two hardcoded strings.
- **The refusal now names WHICH confirmation is missing.** "At least one of the confirmations is not
  ticked" told a coordinator they were blocked without telling them by what, on the one screen whose
  only remedy is to go back a stage and hunt for it. `unconfirmedAssuranceSentence` subtracts what
  was confirmed from `PLAN_ASSURANCE_VALUES` and lists the rest by name, so a third confirmation is a
  value and a label rather than a new branch. `PLAN_ASSURANCE_LABELS` is a
  `Record<PlanAssurance, string>`, so adding a value to the domain stops it compiling until it is
  given words.

**And the wording states what is outstanding, never that the patient refused.** A coordinator who has
not yet confirmed a check has not learned anything about the patient, and both the unit case and the
DOM case assert against `did not agree|refused|declined`.

---

## What I did not conclude

**The attestation carries no free text, and I did not need it to.** The brief said to stop and report
if I concluded otherwise. I did not: what stage 1 collects is two tick-boxes, and the act, actor and
instant are the whole of what they support. The type guard
`PLAN_ASSURANCE_ATTESTATION_HOLDS_ONLY_ACT_ACTOR_AND_INSTANT` stops compiling when a fourth field is
added, so the next person adding one has to read the paragraph and take the decision rather than
inherit the answer — proved by mutation M7.

**No sixth mockup value arriving from a hospital record.** The agreement row's source label
("Imported source record—not legal or treatment consent") describes a record this system reads
nothing from, and the design does not show its content — only that a coordinator confirms it. Same
class as the five already filed, not a new one.

---

## Mutation ledger

Every attempt is itemised, including the one that did not prove what it was aimed at. No total.

Each round asserted `git diff --quiet` clean on both sides, checked presence by reading the file
**in process** (never `grep -c` through this shell, which has a known false negative on patterns
carrying quotes or braces), and re-echoed the inner exit code rather than letting a pipe report it.

| #   | Mutation                                                                   | Predicted                                                                                               | Observed                                                                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | in-memory `createPlan` stamps `input.patientId` instead of `actor.id`      | `records who confirmed, what they confirmed, and when` red                                              | **RED**, that case only. `AssertionError: expected [ { …(3) }, { …(3) } ] to deeply equal [ { …(3) }, { …(3) } ]` — same shape, different actor, which is the mutation.                                                                           |
| M2  | `admitPlanAssurances`: `length === 0` becomes `length === -1`              | `refuses a plan that would carry no attestation, and stores no plan at all` red                         | **RED**, that case only. `expected { ok: true, value: { …(9) } } to deeply equal { ok: false, …(1) }` — the write was accepted where a refusal was required.                                                                                      |
| M3  | `admitPlanAssurances`: the duplicate branch becomes `if (false)`           | `refuses a repeated assurance by name, so one check cannot be recorded as two` red                      | **RED**, that case only, same shape as M2.                                                                                                                                                                                                        |
| M4  | the in-memory clearance also writes `assuranceAttestations: []`            | `survives a retention clearance…` red                                                                   | **RED**, that case only. `expected [] to deeply equal [ { …(3) }, { …(3) } ]`.                                                                                                                                                                    |
| M5  | the in-memory clearance becomes `const cleared = stored`                   | `does not stop that clearance removing what it is supposed to remove` **red** while M4's case **green** | **EXACTLY THAT.** `does not stop that clearance…` red (`expected 'Jordan Nguyen' to be ''`); `survives a retention clearance…` **not in the failure list — it stayed green.** Four pre-existing clearance cases also went red, as a no-op should. |
| M6  | in-memory `toPlanRecord` returns `assuranceAttestations: []`               | `reads back through getPlan and through the caseload list alike` red                                    | **FIRST RUN: did not prove its target** — see below. **After the fix, RED on that case**: `expected [] to have a length of 2 but got +0`.                                                                                                         |
| M7  | `PlanAssuranceAttestation` gains a fourth field `checkedNote: string`      | `tsc` red at the `SameUnion` guard                                                                      | **RED**, exactly there: `src/lib/caring-contacts/assurances.ts(88,14): error TS2322: Type 'true' is not assignable to type 'never'` — the `PLAN_ASSURANCE_ATTESTATION_HOLDS_ONLY_ACT_ACTOR_AND_INSTANT` line.                                     |
| M8  | the migration's check constraint drops `patient-controls-mobile-confirmed` | `keeps the attestation vocabulary identical in the domain and in its SQL check constraint` red          | **RED**, that case only. `expected [ 'patient-agreement-confirmed' ] to deeply equal [ 'patient-agreement-confirmed', …(1) ]`.                                                                                                                    |
| M9  | the Postgres clearance deletes from `plan_assurances`                      | `never amends or deletes an attestation from the Postgres store` red                                    | **RED**, that case only, on the `delete from caring_contacts.plan_assurances` pattern.                                                                                                                                                            |
| M10 | the stage-1 status line reverts to "Neither is recorded on the plan"       | `says what the plan will record about the confirmations, and what it will not` red                      | **RED**, that case only, on the whole-sentence `toContain`.                                                                                                                                                                                       |
| M11 | stage 4's `changedBy` reverts to "not changed by it either way"            | `names the plan's record of the confirmations as a confirmation…` red                                   | **RED**, that case only.                                                                                                                                                                                                                          |
| M12 | `everyAssuranceConfirmed` uses a logical OR                                | `will not go to the pathway stage until both confirmations are ticked, and says why` red                | **RED** on that case **and** on `names the missing confirmation on a restored draft that skipped one` — correct, because a half-ticked draft then renders the confirmed branch. Both are cases this task added or depends on.                     |

### M6 is the finding, and it is a finding about my own test

**First run, M6 left its intended case GREEN while reddening three others.** The reason is worth
stating plainly: `reads back through getPlan and through the caseload list alike` asserted only that
the three reads **matched each other**. A mutation that empties `toPlanRecord` for every read empties
all three, and three empty lists agree perfectly. **An assertion that compares reads only to one
another cannot see a fault they share.**

It would still have caught the fault I wrote it for — a Postgres grouping bug that leaves `getPlan`
right and the caseload wrong — but that is a narrower guarantee than the case's name implies.

Fixed by holding each read to CONTENT first (`toHaveLength(ASSURANCES.length)`) and layering the
agreement assertion on top. **M6 re-run against the fix is red on the intended case.** This is the
standing discipline's "a check you believe is adequate is a hypothesis" arriving from the other
direction: I believed the case was load-bearing, and mutation said it was half of one.

### Over-sensitivity, recorded rather than filtered out

M5, M6 and M12 each reddened cases beyond their target. In every instance that is the mutation doing
real damage rather than a leaky assertion: a no-op clearance genuinely breaks every clearance case
(M5), an emptied projection genuinely breaks every attestation read (M6), and an OR'd gate genuinely
lets a half-ticked draft through both screens (M12). None of them is a case that should have stayed
green.

## Gates

Every line below was read from the run's own output. No gate is reported from an exit code.

| Gate                                                         | Result                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx tsc --noEmit -p tsconfig.json`                          | Clean, no output, on the final tree and re-run after the last mutation was restored.                                                                                                                                                                        |
| `npx eslint --no-cache <every changed source and test file>` | Clean, no output. `--no-cache` deliberately: the per-file cache does not re-examine a file whose failure was caused by a different file's change.                                                                                                           |
| `npx prettier --check` over every changed file               | `All matched files use Prettier code style!` The `.sql` migration has no Prettier parser, which is a fact about the tool rather than an exemption I chose.                                                                                                  |
| `npm run test:cc-guards` (final tree)                        | `Test Files  18 passed (18)` / `Tests  397 passed (397)`, inner exit 0, `GATE_RECEIPTS=refresh`. 397 rather than the 393 of the pre-fix-round-1 run: the four cases this round added. Acquired the shared lease on the 7th polite attempt.                  |
| `npm run caring-contacts:db:test`                            | `Test Files  2 passed (2)` / `Tests  202 passed (202)` against a real Postgres 17 in Docker. The helper drops the schema and replays every migration, so **0006 is proved to replay from empty**, not merely to apply to an existing local database.        |
| `npm run test` (full offline suite)                          | Ran to completion with exactly one failure, mine, described below. The wrapper's `tail` truncated the summary, so I have the failure text and inner exit `1` but **no quotable `N passed` line for that run** — I am not reporting a number I did not read. |
| `tests/caring-contacts-api-handler.test.ts` after the fix    | `Test Files  1 passed (1)` / `Tests  37 passed (37)`, inner exit 0.                                                                                                                                                                                         |
| `tests/caring-contacts-repository.test.ts` (final tree)      | `Test Files  1 passed (1)` / `Tests  130 passed (130)`, inner exit 0. The in-memory half of the shared contract, and the suite every store-side mutation below was run against.                                                                             |

### Gate policy in force from fix round 1

The coordinator changed this mid-task after the lease starvation, and it is recorded here because it
explains the shape of the evidence above:

- **`npm run test:cc-guards` only**, plus focused single-file runs. Both take a _shared_ lease and
  two are permitted concurrently, so neither starves the way an exclusive full-suite run does.
- **No full `npm run test`** from a task worktree. It runs once per branch at the merge point, when
  the other worktrees are idle -- its value is catching cross-file breakage, and that matters at
  merge rather than per task. The one run recorded above happened before this policy.
- **Mutations run against the guard set**, for the same reason.
- **No browser gate** from here; it is not run and not claimed.

### Two failures the gates caught that reading had not

Both were mine, and both are why the gates are worth their runtime.

**1. Migration 0006 re-granted on every table, restoring write access to the audit trail.** The first
draft copied 0003's `grant select, insert, update, delete on all tables in schema`. That is safe in
0003 _because 0003 sorts before 0004_, and 0004 then narrows `audit_events` back down with
`revoke update, delete` — its own comment says the replay order is what makes that work. 0006 sorts
AFTER 0004, so the same line silently undid the append-only guarantee and left only a trigger behind
it. Both of 0004's own controls in `caring-contacts-migrations.test.ts` went red. 0006 now grants on
the table it created and nothing else, and grants **SELECT and INSERT only** — the same move 0004
makes, for the same reason. The trap is written into the file so 0007 does not repeat it.

**This is the sharpest argument yet for the filed issue that CI never runs the caring-contacts
database suite.** Nothing in typecheck, lint, or the whole offline unit suite can see this defect —
they went green on it. A migration that quietly re-grants DELETE on an audit trail is exactly the
class of defect that suite exists to catch, and today it runs only when a human happens to have
Docker up and remembers to invoke it. Had this branch been handed off on a machine without a
container running, an append-only clinical audit trail would have become deletable by the application
role and every gate would have reported green.

**The general form is worth naming, because the next migration will face it.** _A migration copied
from an earlier one inherits that migration's assumptions about what had not happened yet._ 0003's
blanket grant was correct when nothing had revoked anything. The identical line placed after 0004
undoes 0004. Copying SQL forward carries the ordering it was written for, and that ordering is
invisible in the copied text.

**2. A POST body predating the schema change turned a 409 privacy assertion into a 400.** The
api-handler case that posts a duplicate plan and asserts the refusal body carries no patient data was
being refused by the schema before it reached the store — so it was asserting a privacy property
about a request the route never carried. Found by the full offline suite.

### Does this touch `tests/ui-caring-contacts-workspace.spec.ts`?

**Probably not, and here is the reasoning rather than a verdict.** That spec reaches no wizard stage —
Task 9's own finding, and the filed browser gap is exactly that the wizard has never been seen in a
browser at any width. Every screen this task changed is inside the wizard. The one way it could bite
is a caseload render, and the Postgres store, where the extra query lives, is not what the browser
gate runs against. **I did not run it and am not claiming it green.**

---

## Concerns, in the order I would want them read

1. **The retention pair is now proven in both directions, and that is the headline rather than a
   concern.** M4 shows the attestation-survives case is real; M5 shows the pair is NOT redundant —
   under a no-op clearance the survival case stays green while the clears-everything case goes red.
   That is precisely the discrimination the brief asked for.

   What remains: the Postgres half of the clearance is proved behaviourally by the database suite,
   but the store-side mutations were run against the in-memory store only. The offline scan
   `never amends or deletes an attestation from the Postgres store` — proven by M9 — is what covers
   that gap when no database is available.

2. **`listPlans` grew a query, and Task 12 has just been pointed at it — recorded, NOT optimised.**
   Ruling [124], committed to this branch while I was working, has Task 12 derive its schedule from
   `listPlans` rather than adding a repository method, which makes the third grouped query more
   consequential than it was when I chose it. **The coordinator's direction is to leave it, and I
   have.** No speculative change was made here. It is still the right home for the attestation; if
   Task 12's read turns out to be slow, the measurement will exist there and the decision belongs
   there. The narrowing lever, if one is ever wanted, is `PLAN_COLUMNS`, which already carries its
   own filed concern.

3. **The stage-4 gate change — upheld, pinned, and now naming the missing confirmation.**
   `createPlanRequestBody` refuses unless EVERY stage-1 confirmation is made. See "A decision the
   brief did not name" above for the test that pins it and the wording that names which one is
   outstanding. A restored draft attesting a confirmation that never passed the gate would be an
   attestation of something that did not happen, which is the one outcome this whole task exists to
   prevent.

4. **`plan-activation.ts` type-imports from `plan-draft.ts`, which value-imports from it.** A
   type-only cycle, erased at build; `tsc` and `eslint` are both clean on it. I chose it so the
   assurance shape has exactly one declaration. If the repo later adopts `import/no-cycle`, move the
   type rather than drop the import.

5. **One of my own assertions was weaker than its name, and mutation is what said so.**
   `reads back through getPlan and through the caseload list alike` compared the three reads only to
   each other, so a fault they shared was invisible to it. Fixed and re-proven. I raise it as a
   concern rather than a closed item because the same shape may exist elsewhere in what I wrote:
   **an assertion that compares two outputs of one function to each other is not testing the
   function.** That is worth a reviewer's eye across the rest of this diff.

6. **Test-first was not followed for the store behaviour — and here is exactly where to look.**
   Task 7 disclosed the same and it cost one real bug: an in-memory fallback branch unreachable in
   the exact case its own comment claimed it handled, which nobody had written an assertion about.
   Mutation testing can only falsify tests that exist, so the review needs the specific list rather
   than the admission.

   **Covered only by after-the-fact tests** (implementation written first, assertion written to
   match it):
   - the attestation minted at creation — actor from the write context, instant from the domain
     clock, one instant for the whole set;
   - `admitPlanAssurances` and both of its named refusals;
   - the attestation surviving a retention clearance in BOTH stores;
   - `toPlanRecord` copying attestations out rather than handing the stored object out;
   - the Postgres store's third grouped read in `listPlans`, and `readPlanRecord`'s widened shape;
   - the migration's column shape, closed value set, and composite same-team foreign key.

   **Written test-first, and the exception rather than the rule:** the stage-4 gate's named-missing
   wording (`unconfirmedAssuranceSentence` and `unconfirmedAssuranceLabels`), added in fix round 1 —
   the cases were written from the coordinator's requirement before the helper existed.

   Every item on that list now carries at least one landed mutation: the minting by M1, the two
   refusals by M2 and M3, the clearance by M4 and M5, the projection by M6, the type shape by M7, and
   the migration vocabulary by M8. What after-the-fact authorship cost here was one weak assertion
   (see 5 above), found and fixed, rather than an untested branch.

---

# Fix round 2

Five items from the re-review. All five are done; four were defects in what I wrote, and the fifth
was a pre-existing one adjacent to it.

## 1. The named refusal was on the wrong surface

**The finding is right and it is the serious one.** The sentence naming which confirmation is
outstanding reached only the `StatedReason` panel. The control a coordinator presses renders its
reason through `unavailableReasonFor`, which consulted `state`, `patientDetail` and `preview` — and
not the assurances. So on the exact path this task created — restored half-ticked draft, patient
detail present, schedule ready — it fell through to the catch-all: _"Something this plan needs has
not been settled yet, so nothing can be created. The stages behind this one say which."_

That function's own doc comment promises a coordinator "is told what is missing rather than finding a
control that does nothing", earliest missing thing first. **Stage 1 is the earliest and was absent
from the chain**, so my fix made that comment untrue of the newest reachable path.

The assurance branch is now first in the chain. It cannot race the `sending` branch below it:
`activate` returns early on a null body, and the body is null whenever a confirmation is missing, so
a send is never in flight while this branch is live — the ordering is the stated chain rather than a
tie-break, and the comment says so.

**Mutated, and the mutation is the proof that was asked for.** M13 disables the branch
(`if (false)`); the new case goes red with
`expected 'Something this plan needs has not bee…' to match /that the number this plan will use i…/i`
— **the catch-all sentence itself, caught.** The case asserts through the control's own
`aria-describedby` rather than searching the overlay's text, so it is an assertion about the reason
_the control points at_ rather than about a sentence that happens to be on screen.

## 2. An assertion that could not fail

`expect(episode?.culturalIdentity).toBeNull()` in the clearance half ran against a fixture that sets
`culturalIdentity: null`. Null before, null after, nothing could turn it red — decoration presented
as proof, in the one case whose whole job is proof.

`createActivePlan` now takes an optional cultural identity (opt-in, because that value lives in its
own table in the Postgres store and most callers have no business writing a row there). The case sets
`"Noongar"`, and every field the clearance is asserted to empty now has a positive control before it
rather than only the name.

**M14** flips the new control to `toBe(null)` and the case goes red with
`expected 'Noongar' to be null` — the control reads a real value, so it is live.

## 3. A narrowing made on a premise that did not force it

`c5433b383` narrowed the no-blame check from the region to the single paragraph, because the wizard
uses "refused" for draft storage and for service refusals. **Both premises were traced and neither
forced it**: `DraftNotice` renders outside the stage section, and every `RefusalStatement` branch
needs `state.status` / `preview.kind` values that fixture never reaches. The region-wide match was
already green.

The cost was real — the heading and "What changes it" of that same block fell outside the check, and
**the heading had no assertion on it at all.** Now scoped to the `StatedReason` group by its
accessible name, which is the heading: it keeps the stated benefit (no coupling to unrelated copy
elsewhere on the stage) and loses neither of the other two sentences.

_A check you believe is over-broad is a hypothesis too._ I had the rule and applied it in one
direction only.

## 4. A comment that overstated its own generality

`unconfirmedAssuranceLabels` claimed its derivation was "the same promise `planAssurancesFrom` makes
one function up", and that a third confirmation is "a value and a label". True of that function;
false of the wizard. `planAssurancesFrom` is a branch per checkbox and `everyAssuranceConfirmed` is a
hardcoded conjunction, both written against the draft's named booleans rather than the domain list —
so a third confirmation is a value, a label, a draft field, a parser check, a branch **and** a
conjunct. The comment now says exactly that, and names widening those two as separate work rather
than pretending it away.

## 5. Task 6b's case, adjacent and pre-existing

`never puts the reason on a plan record, which is what a caseload lists` asserted only **absences**
across four reads, so a store returning `null, null, [], []` passed a case guarding a real retention
obligation. Same family as the M6 finding, one section away.

Two controls added, because they fail differently: one proves the reason exists at all (without it
the case is vacuous against a store that never stored one), and one proves each of the four reads
actually returned this plan.

**Both mutated, separately, because one mutation could not prove both.** M15 drops the stored reason:
red on the first control (`expected null to be 'Patient asked to wait until she is ho…'`). M16
empties `listPlans`: red on the second (`expected '[]' to contain 'MOVED-PLAN-3'`). Before this
round, M16's mutation would have left the case **green** — four empty reads contain no "sister".

## Round 2 mutation ledger

| #   | Mutation                                                               | Predicted                                                                 | Observed                                                                                                                                                                     |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M13 | `unavailableReasonFor`'s assurance branch becomes `if (false)`         | the new overlay case red                                                  | **RED**, that case only: `expected 'Something this plan needs has not bee…' to match /that the number this plan will use i…/i` — the catch-all, which is the defect exactly. |
| M14 | the new `culturalIdentity` control asserts `null` instead of "Noongar" | `does not stop that clearance removing what it is supposed to remove` red | **RED**, that case only: `expected 'Noongar' to be null`. The control reads a real value.                                                                                    |
| M15 | in-memory `createPlan` stores `firstContactReason: null`               | `never puts the reason on a plan record…` red via the first control       | **RED** on that case (`expected null to be 'Patient asked to wait…'`, the new control's own line) and on five siblings — correct, the reason is gone everywhere.             |
| M16 | in-memory `listPlans` returns an empty list                            | `never puts the reason on a plan record…` red via the second control      | **RED** on that case: `expected '[]' to contain 'MOVED-PLAN-3'`. Also red on four siblings and on the strengthened `reads back…` case, all correctly.                        |

## Round 2 gates

| Gate                                       | Result                                                            |
| ------------------------------------------ | ----------------------------------------------------------------- |
| `npx tsc --noEmit -p tsconfig.json`        | Clean, no output.                                                 |
| `npx eslint --no-cache` over changed files | Clean, no output.                                                 |
| `npx prettier --write` over changed files  | All reported unchanged — already formatted.                       |
| `npm run test:cc-guards`                   | `Test Files  18 passed (18)` / `Tests  398 passed (398)`, exit 0. |
| `tests/caring-contacts-repository.test.ts` | `Test Files  1 passed (1)` / `Tests  130 passed (130)`, exit 0.   |
| Full suite, browser gate                   | Not run, per the standing policy. Not claimed.                    |

398 rather than round 1's 397: the one case this round added. 130 is unchanged because round 2
strengthened existing contract cases rather than adding any.

## What I take from this round

Three of the five findings are the same mistake in different clothes: **a property was proven where
it was convenient to assert rather than where it is load-bearing.** The sentence was proven in the
panel and not on the control. The clearance was asserted on a field the fixture never populated. The
absences were asserted with nothing establishing there was anything to be absent.

Round 1's M6 finding named the shape, and three more instances of it shipped in the same diff. The
hunt run afterwards looked for _that literal shape_ — reads compared to each other — and came back
clean, which it was. **The shape is wider than the instance that found it**: an assertion is only
worth what its failure mode is worth, and "could this possibly go red?" is a question to ask of every
assertion, not only of the ones that compare two outputs.

---

# Fix round 3

Two items. The first is a real defect and it is a defect in an argument I made, not only in code.

## 1. My no-race argument proved entry into `sending`, not the state during it

I wrote that the assurance branch "cannot race the `sending` branch … a send is never in flight while
this branch is live", and gave as proof that `activate` returns early on a null body. **That proof
establishes that a send cannot START with a confirmation outstanding. It says nothing about whether
the confirmations stay complete while a send is in flight** — and they need not.

Verified at source rather than accepted:

- `state.status` is component state; the draft is a separate external store read through
  `useSyncExternalStore`.
- The review stage's `Back to personalisation` control is rendered with **no guard on
  `submissionState`**.
- `update()` and `onAssuranceChange` are likewise ungated.

So during an in-flight create a coordinator can go back, untick a box, and return — and with the
branches in my order the control read **"Still to confirm: …"** on a screen where **a plan may
already exist.** The `role="status"` line above still said a create was running, so the screen was
not wholly wrong; the control was, and it was wrong in the direction that tells a coordinator the
plan was never submitted at the exact moment it may have been. On this screen that is not cosmetic —
it is the sentence that invites a second sign-up for the same patient.

**`sending` is now first**, and the comment states the real principle rather than a stage number: a
write in flight is **not a missing thing at all**, so no sentence about a missing stage is safe to
print while it holds. Everything below it is a missing thing, ordered by the stage a coordinator
would go back to.

**Pinned, because the reorder was invisible to every existing case.** The round-2 overlay case renders
at `status: "idle"` and stays green either way — so as it stood, this would have been a one-line
change no test could distinguish. The new case drives a create that never answers, confirms the
in-flight state from the screen's own status line, unticks a confirmation through `writePlanDraft`
(the exact call `onAssuranceChange` makes), and asserts the sending message wins.

**M17 mutates the order back** — `sending` guarded on `everyAssuranceConfirmed`, which reproduces the
old precedence exactly — and the result is the discrimination that was missing:

- the new case goes **RED**: `expected 'This plan cannot be created until eve…' to match /the plan is being created now/i`;
- the round-2 overlay case stays **GREEN**, which is the whole point.

## 2. The ordering comment asserted more than the chain delivers

"Earliest missing thing to latest" is only approximately true. Stage 2's `pathwayVersionId` and
`sendingPreference` have **no branch at all**: with either missing, the body is null, no branch
matches, and the catch-all speaks — **last, not in stage order.**

That hole predates this task and this round did not widen it, but my comment had turned a
pre-existing gap into a false statement in the code. The comment now scopes its claim to the stages
that are branched — stage 1 here, stage 3's patient detail, then stage 4's own dates — and names the
stage-2 gap as outstanding separate work. **The stage-2 branches are deliberately not built**; that
was not scoped to me and inventing it here would be the same over-reach in the other direction.

## Round 3 mutation ledger

| #   | Mutation                                                                                  | Predicted                                                         | Observed                                                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M17 | the `sending` guard gains `&& everyAssuranceConfirmed(...)`, restoring the old precedence | the new sending-outranks case RED; the round-2 overlay case GREEN | **Exactly that.** `1 failed \| 72 passed`. Red: `expected 'This plan cannot be created until eve…' to match /the plan is being created now/i`. The round-2 case is not among the failures. |

## Round 3 gates

| Gate                                       | Result                                                            |
| ------------------------------------------ | ----------------------------------------------------------------- |
| `npx tsc --noEmit -p tsconfig.json`        | Clean, no output.                                                 |
| `npx eslint --no-cache` over changed files | Clean, no output.                                                 |
| `npx prettier --write` over changed files  | Both reported unchanged — already formatted.                      |
| `npm run test:cc-guards`                   | `Test Files  18 passed (18)` / `Tests  399 passed (399)`, exit 0. |
| Full suite, browser gate                   | Not run, per the standing policy. Not claimed.                    |

399 rather than round 2's 398: the one case this round added. The contract suite is untouched by this
round and was not re-run; the last recorded run of it stands at `Tests 130 passed (130)`.

## An incident worth recording, because it nearly contaminated a ledger

The mutation driver I had been running from the session scratchpad **was replaced by another task's
driver at the same path.** Running it produced Task 10's output — a different worktree, a different
suite, `407` tests — and, because that driver takes its ledger filename as an argument, my `M17`
argument caused it to write **Task 10's ledger into a file called `M17` in this worktree's root.**

Nothing was corrupted: that driver carries its own `REPO` constant pointing elsewhere, so it never
touched this tree, and `git status` confirmed clean before and after. The stray file was removed.
**The near miss is that a mutation result from another task could have been read as mine** — the
output arrived in response to my command, and only the test count and suite name made it obviously
foreign.

The driver now lives at a path carrying this worktree's own suffix. The generalisable form: **a
session scratchpad is not private when several tasks share a machine, and a tool that reports results
should be identified by something other than the fact that you were the one who ran it.**

## What this round adds to the standing lessons

Round 1's M6 lesson was about assertions. This one is about **arguments**: I did not merely fail to
test the ordering, I wrote a proof for it, and the proof was of the wrong proposition. "A send cannot
start with X" and "X holds throughout a send" differ by a quantifier, and the second is the one the
code needed. A comment asserting an invariant deserves the same question a test does — **what would
have to be true for this to be false, and can that state be reached?** Here it could, through a
control on the very same screen.
