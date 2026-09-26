# Retention clearance and the unclaimed-work anchor — implementer report

Two owner-approved changes, built together because both needed a migration and two separate
migrations to `caring-contacts/supabase/migrations/` would have collided at the next number.

- **Deliverable one** — free text about a patient must not survive retention clearance.
  Owner decision 1 of 2026-08-27 (Ruling [139] MAJOR-4), extended by the owner on 2026-08-28 to the
  two further stores the whole-branch review's MAJOR-1 found.
- **Deliverable two** — the unclaimed-work escalation gets a real anchor. Group 4 review MAJOR-1,
  reproduced by execution, owner-approved 2026-08-28.

Branch `claude/browser-test-gate-handoff-d5c1db`. Nothing pushed, no pull request.

---

## 1. Something else was writing this worktree the whole time. Read this first.

The brief said **"You are the only agent here."** That was false of the tree while I worked in it.

- `src/lib/caring-contacts-server/session.ts` was modified at **01:29:15** on 2026-08-29, and
  `src/lib/caring-contacts-server/demo-seed.ts` at **01:32:00** — mid-session, by something other
  than this task. Minutes later `tests/caring-contacts-team-page.dom.test.tsx` joined them.
- Three commits landed on this branch that are not mine: **`a33fd9aff`** ("ruling 158 — Supabase as
  the intended database, and the auto-deploy hazard"), **`e45dfefc5`** ("seed a claimed plan, a
  due-today contact, and attempted dispatches") and **`b2da3fd1a`** ("ruling 159 — the seed timeline
  contradicted itself and every test passed"). The middle one is Team-screen-adjacent work, which is
  the same surface as deliverable two.
- A `next dev` server (PID 42528) was running in this worktree throughout, started by that agent and
  actively browsing caring-contacts pages. It is what makes the unscoped typecheck unpassable —
  see §6.
- By the end, `src/lib/caring-contacts-server/demo-seed.ts` and `src/lib/caring-contacts/schedule.ts`
  — the latter a **sealed-domain** module — were modified and uncommitted in the tree by that agent.

All five of my commits (`98a8c428b`, `5fdff3389`, `ccee65fc3`, `f64083ddf`, `d17944bef`) were
verified as ancestors of HEAD with `git merge-base --is-ancestor` afterwards, and the content of
every file I changed was re-checked as still present.

Nothing of mine was lost — I staged explicit paths for every commit and never used `git add -A` —
and nothing of theirs was swept into my commits. But three consequences travel with the evidence
below and must not be read past:

1. **The whole-tree cleanliness assertion the mutation method requires could not be made.** The
   driver was narrowed to assert cleanliness of the six files this task may mutate, and to PRINT
   every foreign modification it saw on both sides of every row. No suite any row runs imports
   `caring-contacts-server/**` (checked by grep across all six), so the narrowing is defensible —
   but it is a narrowing, and it is disclosed rather than absorbed.
2. **Rows ran against two different commits.** Each row below records which. `f64083ddf` is mine;
   `e45dfefc5` is the other agent's commit on top of mine.
3. **The final gates cover a tree containing another task's work**, not only this one's. That is
   stated again in §6 rather than left to be inferred.

**For the controller:** two implementers sharing one worktree and one branch is the exact
arrangement the memory note "Concurrent agents destroy worktrees" and the standing discipline's
"a concurrent writer in the same worktree has voided a whole mutation round here" exist about. It
did not cost anything this time. It nearly cost the mutation round.

---

## 2. Deliverable one — what was built

`markRetentionCleared` cleared exactly two things: the plan row's patient columns and the
cultural-identity report. Three stores of free text about the same patient survived it. All three
are now cleared **in the same transaction as the clearance record** — the property the existing
clearance already had and which must not be weakened, because a committed record saying "cleared"
beside an uncleared note is worse than either alone.

### 2.1 `plan_reassignments.reason` — the handover note

Cleared to `''`. The column is `not null`, so the empty string is how it says removed, exactly as
`patient_name` does.

**Only the reason clears.** The row survives, carrying `from_actor_id`, `to_actor_id` and `at`.
Two reasons, and they agree: spec §4.3 requires a formal reassignment to stay visible, and that
trio is the same no-patient-content class an audit event keeps — `deidentifyAuditEvent` preserves
actor, action, timestamp and object type for precisely this reason. Clearing the entry outright
would destroy the evidence that a handover happened while keeping the plan it belongs to, which is
the opposite of what retention is for.

The in-memory store holds the same note in `PlanAssignment.reassignmentHistory[].reason` and clears
it identically, so the shared contract holds both stores to it.

### 2.2 `contact_dispatches.discrepancy_note` — and its classification

Cleared to `''`, and **classified on the column itself**:

> `comment on column caring_contacts.contact_dispatches.discrepancy_note is 'Free text written by a
clinician about what happened to one named patient''s message. Treat it as patient data. …'`

That is `service_stops.note`'s classification in the same words. It is attached with
`comment on column` rather than as a `--` comment because 0005, 0006 and 0007 all use that form,
because a DBA reads it with `\d+` without opening this repository, and because a test can then
assert it — which one does. A `--` comment in the migration text would have had to be added to
0003, an already-applied migration, to sit where the next reader meets the column.

**Why `''` rather than null.** Null already means "this attempt was never reconciled". `''` is a
value the domain refuses on write (`dispatchDiscrepancyNoteRequired`), so it can only ever have
been written by a clearance — a REMOVED note stays distinguishable from an attempt that never had
one. That is 0007's argument for `preferred_name`, applied again.

**This half has no in-memory twin.** `DispatchRecord` carries no note, so the in-memory store never
holds one and there is nothing there for a contract test to assert. That is why the proof for this
column lives in the database suite, and why that suite was a required gate rather than a nicety.

### 2.3 `idempotency_records.result` — the one that needed thinking about

**The problem.** Every write's verbatim result payload is kept for replay, keyed by
`(team_id, idempotency_key)`, with no expiry and no purge. For a reassignment the payload is a
`PlanAssignment` whose `reassignmentHistory[].reason` **is the handover note**. So clearing §2.1
alone would have left a byte-identical copy in the one table whose stated purpose has nothing to do
with patient data — the reviewer's exact finding, and it is now proven as behaviour: before the fix,
replaying the reassignment key hands the note straight back out (`expect(replayBefore).toContain("Bunbury")`
is the positive control in the contract suite).

**How the rows are reached.** They were not reachable at all: a replay record knew nothing about the
plan its answer was about. Migration 0008 adds a nullable `plan_id`, and both stores file each
record against the plan its write named. The plan id is **derived from the write's own input** by
one shared function, `replayRecordPlanId`, rather than declared per method — a field passed by hand
at each write site is a field a future method can simply not pass, and nothing would fail. Every
write input in this contract that concerns a plan already names it `planId`.

The one write that files nothing is `resolveDispatchDiscrepancy`, whose input names a contact and an
attempt. That is safe only because its result is a `DispatchRecord`, which holds no note — and that
is now a compile error rather than a comment: `DISPATCH_RECORD_HOLDS_NO_DISCREPANCY_NOTE`. Releasing
the note there stops the module compiling instead of quietly creating a copy no clearance can find.

**REDACTED, NOT DELETED — and this is the decision the brief asked me to reason about and record.**

Deleting the row returns the key to unused. An identical retry would then find no previous record
and **execute the write a second time**. The guarantee the table exists for — one key, one execution
— would have been destroyed in order to remove a note, and a clinical write running twice is a worse
failure than a retained note. This system is required to degrade conservatively, so the row stays,
the key stays consumed, and only the stored ANSWER is replaced by a named refusal,
`idempotent-result-cleared-by-retention`.

**The two goals do not conflict**, which is why I did not stop and ask. The idempotency guarantee is
"a retried write does not execute twice"; it is carried by the row's existence, not by the contents
of its answer. Only the _replay's return value_ is lost. Both halves are asserted separately: one
case says what a replay ANSWERS after a clearance, another says what a replay DOES (no second
handover entry), and the database suite reads the row back to confirm it is still present under the
same key and the same fingerprint.

**What a caller loses, stated rather than glossed.** A replay after a clearance no longer returns the
original answer. That is a real narrowing of the replay contract, in the conservative direction: the
caller is told the answer is no longer held instead of being handed a discharged patient's clinical
prose or having its write re-run. It is reachable only for a plan whose episode has ended and whose
identifying detail has already been removed, which is not a window any live retry is in.

**No foreign key on `plan_id`**, and it is a decision rather than an omission. Either reason alone is
sufficient: a replay record must outlive its plan (cascade would delete replay protection with the
plan; `no action` would make plans undeletable), and a **refused** `createPlan` is recorded too,
naming a plan id that was never inserted — a reference would turn that named refusal into a raised
error, and this store's whole convention is a refusal rather than a throw.

**Backfill:** none, and none is honest. Records written before 0008 keep `null` and are unreachable
by a clearance, because nothing recorded which plan they were about and inventing one would be worse
than leaving it. They predate the assignments route, in a prototype holding no real data.

---

## 3. Deliverable two — what instant, and why

**The instant chosen is `plans.created_at`, released on the contract as `PlanRecord.createdAt`.**
No new column.

**Why creation is claimability, checked against the domain rather than assumed.** The brief asked me
to check whether "a plan becomes claimable when it is activated and unassigned". It does not require
activation:

- `applyAssignmentAction`'s `claim` has exactly one precondition, `ownerId === null`. No plan state
  gates it anywhere — which is consistent with `buildTeamWorkload` already counting an unowned
  **draft** as unclaimed alongside an active plan.
- A plan is created with no assignment row at all, so it is unowned from its first instant.
- Nothing in this domain returns a claimed plan to unowned. There is no release action, and
  `reassign` moves ownership from one actor to another.

So "unowned since" and "created at" are the same instant, for every plan that has one.

**Why not a distinct `claimable_since` column.** Its only honest value would be a copy of
`created_at`, for every existing row and every future one — a second definition of one fact, which
is the class Ruling [143] was written about. The equality is stated in the contract's doc comment
along with what would break it: a release action, if one is ever added, is the change that would
need the separate column, and it would need it that day.

**Backfill: none needed, and the direction is right anyway.** `plans.created_at` has been
`not null default now()` since migration 0001, so every existing row already carries a real observed
instant. Nothing is invented and nothing is guessed. The store now writes it explicitly from the
domain clock rather than leaning on the default, because the column's default is the _database's_
`now()` and the in-memory store answers from the injected clock — two stores answering one contract
question from two clocks is exactly what the shared contract exists to prevent.

**The one case that over-reports, and it errs the safe way.** A plan whose assignment could not be
read (`assignment === null`, reachable if a plan is removed between the two reads) is counted as
unclaimed, so its age is time since creation even if somebody owned it. That surfaces work whose
owner could not be established one escalation early, rather than dropping a discharged patient's
plan out of the monitor. For a safety escalation, early is the right direction.

### 3.1 What changed on the screen and in the read

- `UnclaimedWork.oldestMinutesSinceDischarge` → **`oldestMinutesUnclaimed`**. The old name stopped
  being true the moment the anchor moved.
- The §4.4 explanation is rewritten, not patched. It used to disclose a gap — _"nothing records when
  a plan became free for a coordinator to take. A plan can therefore show fewer minutes than it has
  been unclaimed, and reach the threshold later than it should."_ That gap is now **closed rather
  than disclosed**, so the disclosure is gone rather than reworded. What remains says what the
  number is: _"These minutes are counted from the moment the plan appeared for a coordinator to
  take, so they are how long it has been waiting. A plan stays in this count until somebody claims
  it."_
- The figure's own sentence changed from _"The oldest is N minutes past the discharge recorded on
  its plan"_ to _"The oldest has been waiting N minutes"_, because it now is.
- The footer no longer says both figures are counted from something that is not the wait. It
  separates them: the unclaimed figure **is** the wait; the exception figures are still counted from
  each contact's scheduled send, because nothing records when a contact started needing review, and
  those two are still not the true wait.
- No sentence anywhere describes the old anchor. Checked by grep across `src` and `tests`.
- The DOM tests that pinned the honest-but-superseded wording were **updated, not deleted**, and the
  refusal of the original false claim (`not.toContain("never longer than the figure shown")`) is
  kept, because "this is the wait" and "the wait is never longer than this" are different claims and
  only the first is true. A new refusal was added beside it: the screen must no longer say the
  escalation can fire _"later than it should"_.

### 3.2 The case the review used, pinned

`tests/caring-contacts-team-workload.test.ts` now builds its discharge through the wizard's own
`dischargeInstantFor` — the seam no fixture in the original branch crossed — and asserts:

- created 08:00 AWST, read 09:00 AWST → **60 minutes, escalated**, not 0;
- created 08:00, read 11:00 (still an hour before the old midday anchor) → **180 minutes,
  escalated**;
- a discharge typed for **tomorrow** → still 60 and escalated, where the old clamp reported 0 and
  could never escalate at all.

Its positive control asserts the wizard's instant really is 04:00 UTC — three hours after the plan is
created — so an age anchored on it could only have been zero.

---

## 4. Constraints held

- **Spec §4.2, never rank clinicians.** Untouched. `coordinators` is still sorted by actor id and
  nothing else; no share, total, percentile or placing exists; the existing refusal case with its
  positive control still passes.
- **§4.4 explained automation.** The escalated state is still an `AutomatedState` naming the state,
  why it was reached and what would change it, and the anchor note is rendered in **all three**
  unclaimed states — asserted on both branches, and M15 proves that assertion can fail.
- **Domain isolation, no patient data in a query string, no raw role identifier, design tokens,
  `min-h-12`, every button wired.** No control was added or moved; the whole screen change is
  wording. `caring-contacts-domain-isolation`, `caring-contacts-interface-vocabulary` and
  `design-system-adoption` are all in the guard set and green.
- **No patient-visible message wording was authored.** Nothing in this change touches
  `message-copy.ts`, `message-policy.ts` or `message-rules.ts`.
- **No assertion was weakened or deleted.** Two were rewritten because what they pinned stopped
  being true, and both rewrites are strictly stronger: the wording case now also refuses the stale
  disclosure, and the replay case was split so its second assertion can be reached at all.

---

## 5. Mutation ledger

Every row is itemised, greens included. **No aggregate total.** Each row records the commit it ran
against, the suite selection it used, and the message predicted against the message observed.

Presence was proved by byte equality against a computed post-image: `expected = before.replace(find,
replace)`, `expected !== before` asserted first, written, re-read from disk, compared byte for byte.
Two guards ran before every row — the anchor must occur exactly once, and the post-image must differ
from the original — and both have their own positive control below.

Cleanliness was asserted on both sides of every row, **narrowed to the six files this task owns**,
for the reason in §1. Every foreign modification was printed by the driver on both sides of every
row and appears in its output.

| Row                     | Target                                                          | Suite                | Commit      | Predicted                                                                         | Observed                                                                                                                                                                                                                                                      |
| ----------------------- | --------------------------------------------------------------- | -------------------- | ----------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CTRL_NOOP`             | driver guard: replacement equals anchor                         | —                    | `f64083ddf` | THROW                                                                             | **THROW** — `row CTRL_NOOP: the replacement changes nothing`                                                                                                                                                                                                  |
| `CTRL_ABSENT`           | driver guard: anchor absent                                     | —                    | `f64083ddf` | THROW                                                                             | **THROW** — `row CTRL_ABSENT: anchor occurs 0 times, expected exactly 1`                                                                                                                                                                                      |
| M1                      | `CLEARED_PATIENT_FREE_TEXT.reassignmentReason` → `"still here"` | contract (in-memory) | `f64083ddf` | RED, `expected 'still here' to be ''`                                             | **RED**, exactly that, in the handover-note case                                                                                                                                                                                                              |
| M2                      | in-memory clearance never reads the assignment                  | contract (in-memory) | `f64083ddf` | RED, `expected 'Moving this to the team lead: …' to be ''`                        | **RED**, exactly that                                                                                                                                                                                                                                         |
| M3                      | in-memory replay redaction matches no record                    | contract (in-memory) | `f64083ddf` | RED, replay returns `{ ok: true, … }`                                             | **RED**, `expected { ok: true, value: {…} } to deeply equal { ok: false, … }`                                                                                                                                                                                 |
| M4 (first run)          | in-memory redaction replaced by `delete`                        | contract (in-memory) | `f64083ddf` | RED on the "key stays consumed" length assertion                                  | **RED — but on the WRONG assertion.** See §5.1.                                                                                                                                                                                                               |
| M4 (re-run after split) | same                                                            | contract (in-memory) | `f64083ddf` | RED on both cases                                                                 | **RED**, `to deeply equal { ok: false, … }` **and** `expected [ …(2) ] to have a length of 1 but got 2`                                                                                                                                                       |
| M5                      | `replayRecordPlanId` always returns null                        | contract (in-memory) | `f64083ddf` | RED, nothing filed so nothing redacted                                            | **RED**, replay returns `{ ok: true, … }`                                                                                                                                                                                                                     |
| M6 (first attempt)      | postgres `plan_reassignments` update neutered                   | db                   | `e45dfefc5` | RED on the handover case                                                          | **REJECTED — not evidence.** See §5.2                                                                                                                                                                                                                         |
| M6                      | postgres `plan_reassignments` update matches no row             | db                   | `e45dfefc5` | RED on the handover case and the postgres-only block, nothing else                | **RED**, `Tests 2 failed                                                                                                                                                                                                                                      | 211 passed (213)`, `expected 'Moving this to the team lead: her sis…' to be ''`and`expected 'Handing this to the lead: his brother…' to be ''` |
| M7 (first attempt)      | postgres `contact_dispatches` update neutered                   | db                   | `e45dfefc5` | RED on the discrepancy note                                                       | **REJECTED — not evidence.** See §5.2                                                                                                                                                                                                                         |
| M7                      | postgres `contact_dispatches` update matches no row             | db                   | `e45dfefc5` | RED on the discrepancy note alone                                                 | **RED**, `Tests 1 failed                                                                                                                                                                                                                                      | 212 passed (213)`, `expected 'Rang Rowan Delacroix on 491 570 156; …' to be ''`                                                                |
| M8 (first attempt)      | postgres `idempotency_records` update neutered                  | db                   | `e45dfefc5` | RED on the replay assertions                                                      | **REJECTED — not evidence.** See §5.2                                                                                                                                                                                                                         |
| M8                      | postgres `idempotency_records` update matches no row            | db                   | `e45dfefc5` | RED on the replay cases                                                           | **RED**, `Tests 2 failed                                                                                                                                                                                                                                      | 211 passed (213)`, `to deeply equal { ok: false, … }`and`expected '{"ok": true, "value": {"ownerId": "CL…' not to contain 'Kalgoorlie'`        |
| M9                      | 0008's `discrepancy_note` comment moved to another column       | db                   | `e45dfefc5` | RED, `expected null to contain 'Treat it as patient data'`                        | **RED — right case, different message.** Chai refuses `expect(null).toContain(string)` with `the given combination of arguments (null and string) is invalid for this assertion`. Prediction partially wrong; recorded rather than relabelled.                |
| M10                     | 0008's index becomes `(plan_id)`                                | db                   | `e45dfefc5` | RED, indexdef lacks `(team_id, plan_id)`                                          | **RED**, `expected 'CREATE INDEX idempotency_records_team…' to contain '(team_id, plan_id)'`                                                                                                                                                                  |
| M11                     | anchor reverted to `record.dischargeAt`                         | team-workload        | `f64083ddf` | RED, the review's case returns to 0                                               | **RED**, four cases: `expected +0 to be 60`, `expected +0 to be 180`, `expected +0 to be 60`, and `expected 60 to be 120` on the oldest-of-several case                                                                                                       |
| M12                     | in-memory `createdAt` → epoch                                   | contract (in-memory) | `f64083ddf` | RED, `expected 1970-01-01T00:00:00.000Z to deeply equal 2026-03-02T03:00:00.000Z` | **RED**, exactly that, on both `createdAt` cases                                                                                                                                                                                                              |
| M13                     | postgres `createdAt` written from `input.dischargeAt`           | db                   | `e45dfefc5` | RED, the inequality control fires                                                 | **RED, and wider than predicted** — 3 cases: both `createdAt` cases (`expected 2026-03-02T02:00:00.000Z to deeply equal 2026-03-02T03:00:00.000Z`) plus the attestation case, because the attestation instant is now the same value. Predicted 1, observed 3. |
| M14                     | screen wording reverted to the discharge anchor                 | roster DOM           | `f64083ddf` | RED on the wording assertions                                                     | **RED**, 2 cases, `expected '…' to contain 'the oldest has been waiting 145 minut…'`                                                                                                                                                                          |
| M15                     | anchor note removed from the within-threshold branch            | roster DOM           | `f64083ddf` | RED, the both-branches case fires                                                 | **RED**, `expected 'unclaimed work1 plan has no coordinat…' to contain 'counted from the moment the plan appe…'`                                                                                                                                              |
| M16                     | comment-only edit in `team-workload.ts`                         | team-workload        | `f64083ddf` | GREEN                                                                             | **GREEN**, `Tests 26 passed (26)` — over-sensitivity control                                                                                                                                                                                                  |

### 5.1 M4 found a shadowed assertion, and the fix is in the tree

M4 replaced the replay redaction with a `delete` — the exact mistake the redact-not-delete decision
exists to prevent. It went red, but **on the wrong assertion**: the refusal check above the length
check failed first, so the assertion that actually proves the write did not run twice was never
reached, and was therefore never proven at all.

That is the standing discipline's "an assertion behind a sibling that fails first is never reached",
caught by mutating rather than by reading. The case is now split — one says what a replay ANSWERS,
the other says what a replay DOES, with its own positive control — and the re-run reddens both.
Committed as `f64083ddf` before the round continued.

### 5.2 Three mutations were rejected as not-evidence, and the tell was identical failure lists

The first M6, M7 and M8 each replaced `set <column> = $3` with `set <column> = <column>`, leaving the
parameter list at three. Postgres refused the statement — `bind message supplies 3 parameters, but
prepared statement "" requires 2` — so `markRetentionCleared` **threw**, and all three produced the
same **13-test** failure list, including cases with nothing to do with the mutated statement
(`clears an episode that has actually ended`, `the attestation … survives a retention clearance`).

Three disjoint mutations returning byte-identical failure lists is the signature Ruling [152] F3
recorded for a reused Playwright build root. Here the cause was different and was diagnosed rather
than assumed: the mutation had not isolated an assertion, it had broken the write. Rewritten to
preserve the parameter list and neuter only the predicate (`and $3::text is null`), each row then
isolated cleanly — 2, 1 and 2 failures respectively. **A mutation that changes everything proves
nothing**, which is the same rule as "check first that the mutation changes a value some assertion
reads", arriving from the other end.

A fourth attempt in the same family was also rejected: `and $3 is null` without a cast produced
`could not determine data type of parameter $3`.

### 5.3 Positive controls

Every absence in the new tests is asserted over a value that was proven present first:

- the handover note is read back from `getAssignment` (and from `plan_reassignments` directly) and
  asserted equal to what was written, before the clearance runs;
- the replay leak is asserted **as behaviour** first — replaying the key returns the note — so the
  refusal afterwards is a change rather than a fixture that never held it;
- the discrepancy note is read back out of `contact_dispatches` and asserted equal to what was
  written, before the clearance;
- the redaction's row-still-present claim compares the fingerprint after against the fingerprint
  before, so "same row" is a comparison rather than an assumption;
- `createdAt` is asserted **not equal** to `dischargeAt` on a fixture whose two instants genuinely
  differ, so a store answering the field from `discharge_at` — the exact thing being fixed — cannot
  pass. M13 proves that control fires;
- the migration classification case carries a control in the other direction: `plans.created_at`
  must carry a comment that does **not** say "Treat it as patient data", so a `col_description` that
  returned one string for every column could not satisfy the three assertions above it;
- 0008's "no foreign key on `plan_id`" uses the table's own `team_id` key as the control, inside the
  same query, so an empty filter is `plan_id` being unreferenced rather than the query finding
  nothing. That control was bought: the first draft asserted the table had no foreign key at all,
  which is false, and the DB suite said so.

---

## 6. Gates

All re-run after the final edit. **The tree kept moving underneath them** (§1): the offline gates
saw HEAD `d17944bef`, the browser gate saw HEAD `b2da3fd1a` plus the other agent's uncommitted
`demo-seed.ts`. Every one of them therefore covers another task's work as well as this one's, and
none of them is evidence about this change alone.

| Gate                                                                                | Result                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run caring-contacts:db:test`                                                   | **`Test Files 2 passed (2)`, `Tests 213 passed (213)`** — up from 205. The suite drops the schema and replays the whole migration chain from empty in `beforeAll`, so **0008 replaying from empty is what this run proves**, not a separate claim.        |
| `npm run test:cc-guards` (`GATE_RECEIPTS=refresh`)                                  | **`Test Files 42 passed (42)`, `Tests 1041 passed (1041)`**                                                                                                                                                                                               |
| off-gate suites reaching the modules touched                                        | `Test Files 8 passed (8)`, `Tests 207 passed (207)` — api-handler, page-access-audit, server-store, simulation, write-serialisation, assignment, access-audit, permissions                                                                                |
| `npx tsc --noEmit`                                                                  | **exit 0**, no output, read from `tsc` directly — but only with `.next` excluded. See the paragraph below; the unscoped run cannot pass while another agent's dev server is live in this worktree, and the reason is not in any file this change touched. |
| `npx eslint <changed files>`                                                        | exit 0, `node_modules/.cache/eslint` removed first                                                                                                                                                                                                        |
| `npx prettier --check <changed files>`                                              | `All matched files use Prettier code style!` (`.sql` has no parser here, as for 0005–0007)                                                                                                                                                                |
| `npm run test:e2e -- tests/ui-caring-contacts-workspace.spec.ts --project=chromium` | **`126 passed (3.4m)`** on a fresh build root. No `PLAYWRIGHT_KEEP_BUILD_ROOT`. Run twice: `126 passed (3.1m)` at `ccee65fc3`, then again on the final tree.                                                                                              |

**The typecheck needs its caveat read, not skipped.** `npx tsc -p tsconfig.json --noEmit` reports
eight errors, all eight at `.next/dev/types/validator.ts:2645`, and `tsconfig.json` includes
`.next/dev/types/**/*.ts`. That line reads `Validate ../../../src/app/(search-app)/formulation/layout.tsx`
— a comment with its `//` missing. It is a **generated** file being rewritten by a `next dev` server
(PID 42528) that another agent started in this worktree and is actively browsing through; the file's
mtime moved during the check. `rm -rf .next`, which the brief names as the remedy for a stale build
directory, would have broken that running server, so it was not done.

Instead the same compiler ran over the same project with `.next/**` excluded and nothing else
changed, and returned **exit 0 with no output**. Read that at the scope it was checked at: every
`.ts`/`.tsx`/`.mts` file in this repository outside `.next` compiles, which includes every file this
change touches. The generated Next route-type validator was not checked, and on this tree it cannot
be until that dev server stops.

`npm run test`, `npm run build` and `npm run verify:ui` were **not** run — the controller runs those.

**The gate set was diffed against the suites that exist**, per the standing discipline.
`tests/caring-contacts-repository.test.ts` — the direct behavioural suite of the contract this change
widened — was named by no branch's gate and has been added to `test:cc-guards`. The database suites
are deliberately not added: `vitest.config.mts` collects them only when
`CARING_CONTACTS_DATABASE_URL` is set, so they are absent from `test:cc-guards` and from `npm run
test` alike and must stay a separate gate.

Docker Desktop was not running when this task began and crashed on its first restart with
`initializing Ingest server: … remove … sailor-ingest.sock: The file cannot be accessed by the
system` — a stale socket left by an earlier session. Four stale sockets under
`%LOCALAPPDATA%\Docker\run` were removed and Docker Desktop restarted; it has been healthy since.
`com.docker.service` is still `Stopped`/`Manual` and could not be started without elevation; it was
not needed. Recording it because the same class of breakage is already in this project's memory.

---

## 7. Concerns

1. **Two agents, one worktree, one branch.** §1. Nothing was lost, and that is luck plus explicit
   staging rather than a property of the arrangement.
2. **A replay after a clearance answers differently than it did.** Documented on
   `RETENTION_CLEARED_REPLAY_ANSWER` and in the migration, and it is the conservative direction —
   but it is a real change to the replay contract and the owner should see it stated rather than
   discover it. Nothing in the tree replays across a seven-year retention boundary today.
3. **Replay records written before 0008 carry no plan id and are unreachable by a clearance.** There
   is no honest backfill. In this prototype they hold synthetic data only.
4. **`recordHospitalStatusEvent` carries a third party's name, relationship and note in its result
   payload** (`hospital-events.ts`), and that payload is now reachable by a clearance because the
   write names a plan. That is the right outcome and it was not the finding's subject; the write has
   no route today, so nothing exercises it end to end.
5. **The unclaimed count still includes unowned draft plans**, unchanged by this work. With a real
   anchor they now escalate on their own age, which is the conservative direction but is a behaviour
   the owner may want to look at: a half-finished draft is arguably not work waiting for a
   coordinator.
6. **The demo now shows small unclaimed ages.** Seeded plans are created at seeding time, so their
   queue age starts near zero rather than looking days old. That is honest; it may read as less
   lifelike than the old figure, which was days old because it was measuring the wrong thing.
7. **`plans.created_at` is not immutable.** Nothing stops a future write from updating it, and the
   escalation now depends on it. `service_stops` has an immutability trigger for a comparable
   reason. Not built here — it is a schema decision beyond this brief's scope, and worth capturing.
