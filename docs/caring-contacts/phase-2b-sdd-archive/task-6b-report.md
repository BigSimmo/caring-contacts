# Task 6b report — the reason a first contact date was moved is now kept

**Status:** DONE_WITH_CONCERNS (three concerns, none blocking; all in "Concerns" below)
**Branch:** `claude/browser-test-gate-handoff-d5c1db`, worktree
`.claude/worktrees/browser-test-gate-handoff-d5c1db`. Not pushed, no PR.
**Base:** `286e1ec13` ("record Task 6b BASE"). Five commits sit on top of it.

| Commit       | Subject                                                                |
| ------------ | ---------------------------------------------------------------------- |
| `c07dea064`  | feat(caring-contacts): keep the reason a first contact date was moved  |
| `3436eaf39`  | test(caring-contacts): pin the stored reason in the shared contract    |
| `32c369f33`  | test(caring-contacts): prove migration 0005's column shape in Postgres |
| `4f33d0940`  | test(caring-contacts): pin the reason out of `PLAN_COLUMNS`            |
| `3be680990`  | style(caring-contacts): npm run format                                 |
| _(this one)_ | docs(caring-contacts): this report — a commit cannot name its own SHA  |

---

## 1. What was built

The gap the brief describes was exactly as stated: `buildApprovedSchedule` refused any
first-contact date other than discharge + 1 without a non-blank reason, and then discarded the
string. It reached no field of `StoredPlan` and no column of `caring_contacts.plans`.

### The shape decision, and why (Ruling [105])

The reason is held **inside the patient detail**, as a fifth field:

```ts
export type StoredPatientDetail = EpisodePatientDetail & Pick<Episode, "firstContactReason">;
export type StoredPlan = PlanRecord & { patientDetail: StoredPatientDetail };
```

`EpisodePatientDetail` — the four identifying fields a caller supplies — is unchanged, so
`CreatePlanInput.patientDetail`, the API's strict `patientDetail` object, `simulation.ts` and every
existing fixture still typecheck untouched. The reason arrives where it always did, at the top level
of `CreatePlanInput` (Ruling [107]: no second write path).

The reason is **not** a fact about the person the way a name is; it is a fact about a scheduling
decision. It is filed with the identifying fields because of what it **contains** rather than what it
is about — prose a clinician typed, which in a real one names relatives, places and living
arrangements. That placement is not presentational. It buys the two guarantees the ruling asks for:

1. **It cannot reach a list read.** `StoredPlan` is `PlanRecord & { patientDetail }`, and
   `PlanRecord` is what `listPlans` returns and what the caseload renders for every patient in the
   team.
2. **A clearance cannot forget it.** `CLEARED_PATIENT_DETAIL` is declared as `StoredPatientDetail`,
   so adding a field to that type and not to that constant stops `repository.ts` compiling. Proved
   as mutation **M6** below.

Guarantee 2's compile error covers the **constant**, not the two stores' writes: the Postgres store
names its columns in SQL, which no type can check. That half is pinned by the shared contract suite
(mutation **M1**).

### The three constraints of Ruling [105], answered

| Constraint                       | How it is held                                                                                                   | Proof      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------- |
| Never on `PlanRecord`            | New compile guard `PLAN_RECORD_HOLDS_NO_FIRST_CONTACT_REASON`                                                    | M7, M8     |
| `markRetentionCleared` clears it | `CLEARED_PATIENT_DETAIL` typed as the stored shape; both stores' clearance asserted in the shared contract suite | M1, M2, M6 |
| Names projection cannot gain it  | Checked; **it still holds and needs no sibling**                                                                 | see below  |

**On the names projection.** `PATIENT_NAME_PROJECTION_RELEASES_ONLY_THE_NAME` held unchanged and
required no edit, because `PatientNameProjection` is declared field by field rather than derived
from the patient detail: a fifth stored field reaches it only if someone writes it into that type,
and writing it there breaks the existing guard. Its "or anything else" clause already covers the new
field.

**A sibling guard WAS needed, for a different shape.** `PlanRecord` is derived by intersection
(`StoredPlan = PlanRecord & …`), so it is the shape that could have gained the field silently — and
it is the caseload's read. `PLAN_RECORD_HOLDS_NO_FIRST_CONTACT_REASON` closes that:

```ts
type LacksKey<T, K extends string> = K extends keyof T ? never : true;
export const PLAN_RECORD_HOLDS_NO_FIRST_CONTACT_REASON: LacksKey<PlanRecord, "firstContactReason"> = true;
```

Mutation **M8** is the one that matters here: adding the field as **optional** leaves both stores
compiling and every behavioural test green. This guard is the only thing that fails.

### The schedule publishes what it accepted (Ruling [107])

`ScheduleResult`'s ok branch gained `firstContactReason: string | null`. The stores write
`schedule.firstContactReason`, never `input.firstContactReason`.

The reason for that indirection is the rule, not tidiness: **whether a reason is required is
`schedule.ts`'s rule and nowhere else's.** A store writing the raw input would either persist a
string the domain refused, or persist one it never looked at — and each store would have needed its
own copy of "did the date move?", free to disagree. Mutations **M3** (in-memory) and **M11**
(Postgres) both go red on exactly that substitution, and they fail different assertions in the same
shared suite.

A reason supplied alongside an **unmoved** date is deliberately not kept. It explains nothing, and
free text about a patient that no surface accounts for should not be stored.

### The length cap (Ruling [106])

`FIRST_CONTACT_REASON_MAX_LENGTH = 500`, exported from `schedule.ts`, measured **after trimming**.

- **500** is a few sentences: enough for a coordinator to say what the ward agreed with the patient
  and why, short enough that the field stays a reason rather than becoming an unreviewed clinical
  note. It is deliberately generous, so hitting it signals that the wrong thing is being written
  here.
- Over-long is **refused by its own name**, `first-contact-reason-too-long`, matching
  `first-contact-reason-required`. Never truncated: "not because the family objected" cut off after
  "not" says the opposite, and nothing in the record would show it happened. Mutation **M4**
  replaces the refusal with a `slice` and two tests go red.
- Enforced where the input is validated. The column carries a matching `check` as a backstop only —
  the same relationship `isAwstCalendarDay` has to the schema's calendar-day pattern.

### The migration

`caring-contacts/supabase/migrations/0005_caring_contacts_first_contact_reason.sql`. In **that**
directory, never the repository root's `supabase/migrations/`.

- `alter table … add column if not exists first_contact_reason text` — nullable, **no default, no
  backfill**. A plan created before this migration genuinely holds no reason, and that is a fact the
  screen states as its own. A placeholder string would be a fabricated sentence on a clinical record,
  indistinguishable from one a clinician typed.
- A guarded `check` constraint refusing blank and over-500 (guarded by a `pg_constraint` lookup,
  because Postgres has no `add constraint if not exists`).
- Transactional, no `CREATE INDEX CONCURRENTLY`, replay-safe.
- No RLS work: `plans` already has row-level security enabled and forced, policies are per row not
  per column, and 0002's grants are table-wide.

**Replays from empty, proved rather than assumed.** Both database suites call
`dropCaringContactsSchema` then `applyCaringContactsMigrations` in `beforeAll`, so every run applies
0001–0005 to an empty schema; `caring-contacts-migrations.test.ts` additionally applies the whole set
a second time for replay-safety. The new column's shape is asserted directly against the live schema
(`information_schema.columns`: nullable, no default) rather than inferred from the store passing.

### The screen (Ruling [108])

`FirstContact` now takes the episode — which is the shape decision showing through: `record` cannot
answer this question and `episode` can. A new `FirstContactReason` component holds four branches, one
per fact:

| Case                                      | What the screen says                                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Date is the usual day                     | "the day after discharge, which is this programme's usual first contact" — unchanged                                 |
| Reason held                               | The reason verbatim in quotation marks, attributed to the coordinator who created the plan, in place beside the date |
| Episode not released to this role         | The reason is part of a record this role may not read; its absence says nothing about whether one is held            |
| Episode released, no reason, name blank   | A retention clearance removed it with the name, number, identifiers and cultural identity                            |
| Episode released, no reason, name present | The plan was created before reasons were kept — **"Nobody failed to give one."**                                     |

The fourth case exists because a cleared episode also holds no reason, and telling a clinician "this
plan predates the field" about a de-identified record would be a false statement. The screen
distinguishes it from the blank name, exactly as `NoNameHeldNotice` already does and for the same
stated reason: an actor who may not read an episode receives no episode at all, so a blank name on a
**released** episode can only be the clearance.

The old sentence — "the reason is not kept with the plan, so this screen has nothing to show you" —
is gone, and a DOM test asserts it is gone.

**Also done, from Task 6's review:** the `cancelled` contact on a plan that has not ended now carries
a comment saying the branch is **defensive** and naming why it is unreachable (every
`{ type: "cancel" }` travels with a plan transition to `cancelled`/`withdrawn`, and
`applyDeathCorrection` deliberately leaves the plan cancelled), ending "Do not go hunting for the
path: there isn't one."

### Files changed

```
src/lib/caring-contacts/episode.ts                     Episode.firstContactReason
src/lib/caring-contacts/schedule.ts                    cap, refusal, published accepted reason
src/lib/caring-contacts/repository.ts                  StoredPatientDetail, the two guards, clearance
src/lib/caring-contacts/in-memory-repository.ts        store, release
src/lib/caring-contacts/db/postgres-repository.ts      insert, narrow select, clearance
src/components/caring-contacts/workspace/patient-overview.tsx   four cases + defensive comment
caring-contacts/supabase/migrations/0005_…sql          new
tests/helpers/caring-contacts-repository-contract.ts   9 new shared cases
tests/caring-contacts-schedule.test.ts                 4 new cases
tests/caring-contacts-retention.test.ts                fixture + de-identification assertion
tests/caring-contacts-migrations.test.ts               column shape against live Postgres
tests/caring-contacts-postgres-repository.test.ts      PLAN_COLUMNS source scan
tests/caring-contacts-patient-overview.dom.test.tsx    3 cases (1 rewritten, 2 new)
```

---

## 2. Mutation testing — every attempt, itemised

Method, following the brief's two named traps: each mutation was applied with an **exact anchor
assertion** (a Python `assert old in s` that fails loudly if Prettier had reflowed the line), then
its presence in the tree was proved by a **separate `grep -c` step joined with `;`, never `&&`**, and
only then was the gate run. Every gate result below was read from a `Test Files` / `Tests` summary
line or a `tsc` diagnostic — never from an exit code. Every mutation was reverted with
`git checkout --` and the revert confirmed by a second `grep -c`.

| #              | Mutation                                                                                                                                    | Anchor matched? | Gate                                              | Result                                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **M1**         | Postgres `markRetentionCleared`: drop `first_contact_reason = $5` and its parameter                                                         | yes             | `caring-contacts:db:test`                         | **RED** — `1 failed \| 191 passed (192)`; the failure is the shared contract's "clears the reason a first contact was moved, which is free text a clinician wrote" |
| **M2**         | In-memory clearance: replace `{ ...CLEARED_PATIENT_DETAIL }` with an explicit four-field object carrying the stored reason forward          | yes             | `vitest tests/caring-contacts-repository.test.ts` | **RED** — `1 failed \| 121 passed (122)`; same shared contract case, other store                                                                                   |
| **M3**         | In-memory `createPlan`: write `input.firstContactReason ?? null` instead of `schedule.firstContactReason`                                   | yes             | same                                              | **RED** — `2 failed \| 120 passed (122)`: "holds no reason for a plan whose first contact is on the programme's usual day" and "stores the reason trimmed"         |
| **M4**         | `schedule.ts`: truncate with `slice(0, MAX)` instead of refusing                                                                            | yes             | `vitest schedule + repository`                    | **RED** — `2 failed \| 140 passed (142)`: the schedule's cap case and the contract's cap case                                                                      |
| **M5**         | `deidentifyEpisode`: carry `firstContactReason` into the de-identified projection                                                           | yes             | `vitest tests/caring-contacts-retention.test.ts`  | **RED** — `1 failed \| 31 passed (32)`: "removes patient name, mobile, identifiers, and cultural identity"                                                         |
| **M6**         | Remove `firstContactReason: null` from `CLEARED_PATIENT_DETAIL`                                                                             | yes             | `tsc --noEmit`                                    | **RED** — `repository.ts(298,14) TS2322: Property 'firstContactReason' is missing … but required in type 'Pick<Episode, "firstContactReason">'`                    |
| **M7**         | Add `firstContactReason: string \| null` (required) to `PlanRecord`                                                                         | yes             | `tsc --noEmit`                                    | **RED** — 4 errors, including `repository.ts(382,14) TS2322: Type 'true' is not assignable to type 'never'`, which is `PLAN_RECORD_HOLDS_NO_FIRST_CONTACT_REASON`  |
| **M8**         | Add `firstContactReason?: string \| null` (**optional**) to `PlanRecord` — the subtle version both stores still satisfy                     | yes             | `tsc --noEmit`                                    | **RED** — **exactly one** error, the guard line. Nothing else in the tree notices. This is the decisive proof the guard earns its place                            |
| **M9**         | Screen: collapse the cleared branch (`if (episode.patientName === "")` → `if (false)`) so a de-identified record is reported as an old plan | yes             | `vitest …patient-overview.dom.test.tsx`           | **RED** — `1 failed \| 26 passed (27)`: "names the retention clearance when a cleared episode holds no reason"                                                     |
| **M10**        | Screen: never render a held reason (`if (reason !== null)` → `if (false)`)                                                                  | yes             | same                                              | **RED** — `1 failed \| 26 passed (27)`: "shows a moved first contact's recorded reason IN PLACE, in the clinician's own words"                                     |
| **M11**        | Postgres `createPlan`: write `input.firstContactReason ?? null` instead of `schedule.firstContactReason` (M3 on the other store)            | yes             | `caring-contacts:db:test`                         | **RED** — `2 failed \| 190 passed (192)`, the same two shared cases M3 failed                                                                                      |
| **M12**        | Add `first_contact_reason` to `PLAN_COLUMNS`, so every list read fetches the clinical note for the whole caseload                           | yes             | `caring-contacts:db:test`                         | **SURVIVED** on the first run — `2 passed (2)`, `192 passed (192)`. See below.                                                                                     |
| **M12 re-run** | The same mutation, after adding the guard it exposed                                                                                        | yes             | `caring-contacts:db:test`                         | **RED** — `1 failed \| 192 passed (193)`: "does not fetch the first-contact reason for a list read"                                                                |

**M12 is the finding of this task's verification.** Adding the column to `PLAN_COLUMNS` makes
`readPlanRecord` and `listPlans` pull a patient's clinical note into the process for every plan in
the team — and **nothing observable through the repository can see it**, because `toPlanRecord` maps
field by field and so still releases nothing. Every behavioural test stayed green. The narrowing
lives in the query, so only a source scan can hold it, and the comment claiming it was
aspirational until commit `4f33d0940`. The new scan carries a positive control (it asserts the
constant was found and really is the plan column list) so it cannot pass by matching nothing.

**No mutation failed to apply**, and no anchor went unmatched: each was guarded by an assertion that
would have raised rather than silently producing an unmutated tree. Every gate above printed a real
summary line; none was inferred from `$?`.

**Re-run after `npm run format`, because the brief's first trap nearly landed.** M1–M12 were run
before formatting, and `npm run format` then reflowed three lines — a JSX sentence in
`patient-overview.tsx`, the `ScheduleResult` union in `schedule.ts`, and one assertion in the
schedule test. None of them is a mutation anchor, so no result above was invalidated. But
"none of them is an anchor" is a claim, and the trap is precisely that a stale anchor prints a green
summary on an unmutated tree — so it was checked rather than asserted. **M4** and **M10** were
re-applied at the formatted tip `3be680990`: both anchor assertions matched, both presence checks
returned 1, and the gate went `3 failed | 166 passed (169)` with exactly the three expected cases red.
Reverted, the same three files run `169 passed (169)`.

> **Correction (round 1).** ~~"M4 and M10, the two mutations in the two source files Prettier
> touched"~~ — that clause, struck above, was false twice: Prettier touched **three** files, and
> `patient-overview.tsx` carries **two** mutations, M9 and M10, of which only M10 was re-run here.
> M9 was re-run in round 1 (**M9-recheck**) and is red at the shipped bytes, so the ledger below
> stands. See "The correction to my mutation ledger" in the round 1 section. Struck at its own site
> rather than only explained downstream: a correction 300 lines later leaves the error readable
> here.

**I also got this wrong once and am recording it.** I read `git status` while `npm run format` was
still running in the background, saw a clean tree, and wrote into an earlier draft of this report
that formatting had changed nothing. It had changed three files. The claim was corrected before this
report was finished, but the lesson is the brief's own: evidence read before the command finished is
not evidence.

Not attempted, and stated rather than left implicit: the RLS-preamble mutation of Task 5b's M1
(bypassing `runRead`/`runWrite`). Nothing in this change adds a method — the new Postgres select
sits **inside** `getEpisode`'s existing `runRead` callback, so there is no new method that could omit
the preamble. The existing contract case that caught M1 still runs.

---

## 3. Gates

Run with every mutation reverted (confirmed by a `grep -c` returning 0 and by `git status`). The
full suite, lint, typecheck and the database suite ran at `4f33d0940`; `npm run format` then produced
`3be680990`, whose only delta from `4f33d0940` is three reflowed lines of whitespace. The focused
re-run at that tip is in the mutation section above.

| Gate                                                    | Result                                              |
| ------------------------------------------------------- | --------------------------------------------------- |
| `npm run typecheck` (`tsc --noEmit -p tsconfig.json`)   | clean, no diagnostics                               |
| `npm run test` (full offline Vitest)                    | see the line pasted below                           |
| `npm run lint`                                          | see below                                           |
| `npm run format`                                        | changed 3 lines; committed as `3be680990`           |
| `caring-contacts:db:test` (Docker Postgres 17 on 54329) | `Test Files 2 passed (2)`, `Tests 193 passed (193)` |

The decisive lines, pasted rather than summarised:

```
# npm run test  (GATE_RECEIPTS=refresh, so this is a fresh run, not a reused receipt)
 Test Files  830 passed | 3 skipped (833)
      Tests  10034 passed | 74 skipped (10108)
   Duration  536.39s
[exited with code 0]

# npm run caring-contacts:db:test  (Docker Postgres 17, local, offline)
 Test Files  2 passed (2)
      Tests  193 passed (193)
   Duration  25.76s

# npm run lint
[gate-receipts] recorded a pass for "lint:internal" (5301 input files).

# npm run typecheck
[gate-receipts] recorded a pass for "typecheck:internal" (5301 input files).

# npm run format
whole-tree Prettier write, exit code 0. It reflowed THREE tracked lines (see the
mutation section's post-format note); they are committed as `3be680990`, and
`git status --short` afterwards shows only this untracked report.
```

`lint` and `typecheck` print no count line of their own — the receipt line is the run's own
terminal output, recorded because both were forced fresh with `GATE_RECEIPTS=refresh` rather than
reusing an earlier receipt. Neither is being reported from an exit code alone.

The offline suite's growth reconciles exactly, which is the property worth stating: every case this
task added is accounted for, and none of the previously passing ones changed status. The offline
delta over Task 6's recorded tip is the nine shared contract cases (the Postgres project is a
separate run, so the shared suite is counted once here), the four schedule cases, and the two net-new
DOM cases — the third DOM case replaced the old "no reason is kept" assertion rather than adding to
it. The skip count is unchanged, so nothing was quietly skipped to reach green.

The database project's count is not a delta I can report honestly: I did not run it before making
changes, so I have no pre-task baseline for it. What I can say is that its final run passed with the
new shared cases, the migration column-shape case, and the `PLAN_COLUMNS` scan all included, and that
each of those was independently shown to fail under its own mutation.

**Not run, and why:** `npm run verify:ui` / `npm run verify:phone-chrome`. This change touches one
Server Component's prose and adds no route, control, layout, or client boundary; the DOM suite covers
the rendered text. **`tests/ui-caring-contacts-workspace.spec.ts`: I do not believe this touches it.**
That spec's journeys assert navigation, chrome and accessibility modes, not the first-contact note's
wording, and the new branches change no element structure other than the paragraphs inside an
existing `role="note"`. You run that gate; my expectation is that it stays at its current count, and
I would treat any change in it as a real finding rather than noise.

No provider-backed command was run. The Postgres container is local and offline (the one the brief
names); no Supabase, OpenAI, GitHub or CI surface was touched.

---

## 4. Concerns

1. **A cleared episode is identified by its blank name, which is an inference.** The screen decides
   "this reason was removed by a retention clearance" from `episode.patientName === ""`. That
   inference is sound today and is the one the module already makes for the name itself
   (`NoNameHeldNotice`) — the API requires a non-blank name, and the clearance is the only writer of
   `""`. But it is an inference, not a stored fact, and it is now load-bearing for a second
   statement. If the workspace ever gains a plan whose name is legitimately blank, two notices go
   wrong together. The durable fix is for the episode to carry the clearance instant it already has
   in `retention_state`; that is a wider change than this task and I did not make it.

2. **The 500-character cap is duplicated as a literal in the SQL.** `FIRST_CONTACT_REASON_MAX_LENGTH`
   is the enforcement and the column check is the backstop, so they must agree, and nothing checks
   that they do. It follows the existing `isAwstCalendarDay` precedent, so it is consistent rather
   than novel — but a future edit to the constant would silently leave the column stricter or looser.
   A cheap guard (scan the migration for the number, compare with the export) would close it; I left
   it out rather than widen the diff without a ruling.

3. **`listPlans` still fetches the mobile number and identifier list for the whole caseload.** The
   new field is now guarded out of `PLAN_COLUMNS`, but the two fields the store's own
   `listPatientNames` comment already names as a tracked residual are not. My guard is narrow to my
   field, which is arguably inconsistent — the same scan could cover all three. I did not widen it
   because narrowing `listPlans`'s column list is tracked separately and was explicitly said to
   deserve its own review.

Two smaller observations, not concerns:

- `patient-overview.tsx` keeps its own `DEFAULT_FIRST_CONTACT_OFFSET_DAYS = 1`, a second copy of the
  schedule's `FIRST_CONTACT_DEFAULT_OFFSET_DAYS`. That constant decides which of the four sentences a
  clinician reads. Exporting the schedule's and importing it would remove the duplication; it is
  Task 6's code and outside this brief, so I left it and am naming it instead.
- The API schema and the store did **not** disagree (Ruling [107]'s reporting clause): the plans POST
  already accepts `firstContactReason: z.string().min(1).optional()` and passes it straight through.
  No third path was invented and nothing needed reconciling. The one thing worth noting is that the
  API's `min(1)` and the domain's trim-then-refuse are two different checks of the same rule; a body
  of `"   "` passes Zod and is refused by the domain, by name, which is the correct order.

---

# Round 1 — review fixes

**Round 1 of up to 5.** Two IMPORTANTs, three minors, and one correction to this report. All
addressed. Nothing pushed, no PR.

| Commit       | Subject                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `a230bba34`  | fix — move the guard where it can fire, cover the fourth branch, M-1, and M-2's migrations-test cases (M-2's SQL edit is in `15559437f`; see the correction below) |
| _(this one)_ | docs — this round 1 section, M-3, and the mutation-ledger correction                                                                                               |

The browser gate held at `43 passed (1.1m)` on the round-0 tip, as predicted. My answer for this
round is at the end.

**One attribution correction, because a commit table that is wrong is worse than none.** The M-2 SQL
edit is NOT in `a230bba34`. It is in `15559437f` ("Task 6b review outcome; file the CI database-suite
gap", authored 08:01), which was committed while that change sat uncommitted in my working tree and
therefore swept it up: those 23 lines of
`0005_caring_contacts_first_contact_reason.sql` are mine, in someone else's commit. `a230bba34` holds
the four test files. Nothing is lost and the tree is correct -- I checked the migration's committed
content line by line, and M19 proves the new check is load-bearing -- but if you are reading the
round-1 diff by commit, the SQL is one commit earlier than this table implies. Worth knowing before
the next round starts from an uncommitted working tree.

## I-1 — the guard is now somewhere routine work runs it

The finding was right, and it lands on this repo's "a check that cannot fail" pattern one step later
than usual: the check was correct, non-vacuous, and **unreachable**. `vitest.config.mts` lists
`tests/caring-contacts-postgres-repository.test.ts` in `caringContactsDbTestFiles` and excludes that
array from the `node` project, and no workflow under `.github/workflows/` mentions caring-contacts at
all — so the guard for this task's headline finding fired only when a human happened to have a
Postgres container running. It needs no database: it is a `readFileSync` and a regular expression.

Moved to `tests/caring-contacts-domain-isolation.test.ts`, which the default `npm run test` collects,
with its positive control intact. Proved by re-running the mutation that produced it (**M15**): the
scan goes red in its new home, under the offline gate.

### The cap-desynchronisation scan, added beside it

The review's reasoning is why this is now a test rather than a paragraph in my concerns, and the
distinction is worth recording because I had it wrong. I cited `isAwstCalendarDay` as precedent for
"TypeScript enforces, SQL backstops". The precedent is real but **not symmetric with this case**:

- `isAwstCalendarDay` is **strictly stricter than its SQL pattern by construction** — it rejects
  `2026-02-30` and `2026-13-01`, which the schema's `^\d{4}-\d{2}-\d{2}$` accepts. Drift there can
  only ever make the SQL redundant.
- The cap is **the same rule written twice**. Raising `FIRST_CONTACT_REASON_MAX_LENGTH` without
  raising the constraint converts a named, machine-readable refusal (`first-contact-reason-too-long`)
  into a raw check-constraint violation on a clinical write. That is a regression, not a redundancy,
  and it is the direction a future edit is most likely to take.

The scan reads both literals — the constant from `schedule.ts`, the number from inside the
`plans_first_contact_reason_shape` constraint — and asserts they are equal. Three mutations prove it
holds in both directions and that it cannot pass by matching nothing (**M16**, **M17**, **M18**).

## I-2 — the fourth branch now has a test and a mutation

Correct on every point. All three `episode: null` renders in the DOM file use a discharge + 1 first
contact, so they return from the default-day branch and the role prose was never reached. M9 and M10
covered cleared and held; nothing covered this one.

The new case renders `PatientOverview` directly with `episode: null` and a first contact on the
absorbing day. It asserts the two things that make this branch different from the other three: that
the reason is named as part of a record this role may not read, and — the load-bearing half — that
the screen **says nothing about whether one is held**. Each of the other three branches would be a
false statement here, so the test asserts the absence of the pre-existing-plan and clearance wordings
as well.

Built as a direct render rather than through the page, deliberately: `episode: null` is a fact about
the ACTOR that the page decides, and `permissions.ts` grants `generateClinicalRecordSummary` to
exactly the roles holding `viewReferral`, so no role can produce this view through the store today. A
fixture that reached for one would be asserting a grant rather than the branch.

## Minors

**M-1 — the tally in the comment.** Fixed by the move: the relocated comment states the invariant
("the mutation changed no test's verdict anywhere in the repository until this scan existed") rather
than a count its own commit had already falsified. Ruling [94] applies to comments, and this is the
second time in this task I wrote a number where an invariant belonged.

**M-2 — `btrim()` versus `.trim()`.** Real, and my tested cases could not have caught it: `''` and
`'   '` both fail a spaces-only check, so those two passing assertions proved nothing about tabs or
newlines. Closed rather than documented away:

- the blank test is now `first_contact_reason ~ '[^[:space:]]'`, so any value with no non-whitespace
  character is refused;
- the cap is measured with `regexp_replace(…, '^[[:space:]]+|[[:space:]]+$', '', 'g')`, so padding
  cannot refuse a reason the domain would have accepted;
- the migration comment now states exactly what "blank" means here **and names the residual**: JS
  `.trim()` strips the whole Unicode whitespace set, POSIX `[[:space:]]` in a UTF-8 locale does not,
  so a value of only U+00A0 would satisfy this constraint. That is accepted on purpose — this is a
  backstop against a write that bypassed the domain, not a second implementation of the domain's
  rule, and closing it would mean encoding a Unicode table in a check constraint. The review's point
  stands either way: the constraint and its comment now describe the same behaviour.

Two whitespace cases and a padded-boundary case were added to the migrations test, and **M19** proves
they catch the old form.

**Editing a committed migration rather than adding 0006.** `0005` has never been applied outside
disposable test schemas — both database suites `drop schema … cascade` and re-apply the whole set in
`beforeAll` — and this directory is not the Clinical KB's `supabase/migrations/`, so the
guard-migration contract in `AGENTS.md` does not bind it. Editing in place keeps one statement of the
rule. Stated rather than assumed, because it is the kind of decision that should not be silent.

**M-3 — the file table said eight.** Fixed to nine. The reconciliation prose and the 10019 → 10034
arithmetic already used nine and were right; the table was the outlier.

## The correction to my mutation ledger, and what actually makes M9 safe

I wrote that I re-ran "M4 and M10, the two mutations in the two source files Prettier touched". That
sentence is false twice over. **Prettier touched three files**, and **`patient-overview.tsx` carries
two mutations, M9 and M10** — I re-ran only M10 and did not mention M9 at all.

The review checked and found the ledger sound anyway. I am not going to restate that argument, because
arguing is what produced the error: the moral of that disclosure was checking a claim instead of
asserting one, and I then asserted one in the same paragraph.

So M9 was re-run at the current tip. **M9-recheck** in the table below is the evidence. What makes M9
safe is not a count of files — it is that its anchor and the reflowed hunk are disjoint regions of one
file: the reflow is the hunk at `@@ -675,8 +675,8 @@`, inside the cleared branch's paragraph text,
while `if (episode.patientName === "")` sits at line 671, above it. That is now proved rather than
argued.

## Round 1 mutations

Same method as round 0: an exact-anchor assertion that raises rather than silently leaving an
unmutated tree, then a **separate** `grep -c` presence step joined with `;` and never `&&`, then the
gate, read from a real summary line. Every one reverted, and every revert confirmed by a second
`grep -c`.

| #              | Mutation                                                                                                      | Anchor matched? | Gate                       | Result                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------- | --------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M13**        | Delete `FirstContactReason`'s role branch (`if (episode === null)` → `if (false)`)                            | yes             | DOM suite                  | **RED** — `2 failed \| 26 passed (28)`. The new I-2 case, **and** a pre-existing suppressed-contact case, because the fall-through dereferences a null episode. Red, but partly by crash — so M14 was added |
| **M14**        | Keep the branch; garble only its prose into a claim about the record ("the reason is not held for this plan") | yes             | DOM suite                  | **RED** — `1 failed \| 27 passed (28)`, the I-2 case alone. This is the one proving the test pins the WORDING, not merely the branch's existence                                                            |
| **M15**        | Add `first_contact_reason` to `PLAN_COLUMNS` (round 0's M12, re-aimed at the relocated guard)                 | yes             | `vitest …domain-isolation` | **RED** — `1 failed \| 5 passed (6)`: "never fetches the first-contact reason for a list read". The guard now fires under the offline gate                                                                  |
| **M16**        | Raise `FIRST_CONTACT_REASON_MAX_LENGTH` to 800, leaving the SQL at 500 — the regression direction             | yes             | `vitest …domain-isolation` | **RED** — `AssertionError: expected '500' to be '800'`                                                                                                                                                      |
| **M17**        | Lower the SQL cap to 400, leaving the constant at 500 — the other direction                                   | yes             | `vitest …domain-isolation` | **RED** — `AssertionError: expected '400' to be '500'`                                                                                                                                                      |
| **M18**        | Rename the constraint to `plans_first_contact_reason_bounds`, so the scan's regex anchor disappears           | yes (2 sites)   | `vitest …domain-isolation` | **RED** — `AssertionError: expected undefined to be defined`. The positive control doing its job: a scan that matched nothing fails loudly instead of passing                                               |
| **M19**        | Revert the blank test to spaces-only (`btrim(first_contact_reason) <> ''`), leaving the cap alone             | yes             | `caring-contacts:db:test`  | **RED** — `1 failed \| 191 passed (192)`: "holds the moved-first-contact reason nullable, undefaulted, and bounded"                                                                                         |
| **M9-recheck** | Round 0's M9 (collapse the cleared branch) re-applied at the post-format tip                                  | yes             | DOM suite                  | **RED** — `1 failed \| 27 passed (28)`: "names the retention clearance when a cleared episode holds no reason". Round 0's ledger row describes the shipped bytes — now by evidence rather than argument     |

## Round 1 gates

The decisive lines, pasted:

```
# npm run test   (GATE_RECEIPTS=refresh -- a fresh run, not a reused receipt)
 Test Files  830 passed | 3 skipped (833)
      Tests  10037 passed | 74 skipped (10111)
   Duration  551.18s
[exited with code 0]

# npm run caring-contacts:db:test   (Docker Postgres 17 on 54329, local and offline)
 Test Files  2 passed (2)
      Tests  192 passed (192)
   Duration  22.77s

# npm run lint          (GATE_RECEIPTS=refresh)
[gate-receipts] recorded a pass for "lint:internal" (5303 input files).

# npm run typecheck     (GATE_RECEIPTS=refresh)
[gate-receipts] recorded a pass for "typecheck:internal" (5303 input files).
```

`npm run format` was run and committed in round 0 (`3be680990`); round 1 touched no line it would
reflow, and the tree is clean.

One note on how the suite run was READ, because it is the exact failure mode this brief warns about.
The backgrounded command ended in `| tail -8`, so its capture file sat at **zero bytes for
twenty-five minutes** -- from the outside, indistinguishable from a gate that never started. Rather
than assume either way, the run was confirmed alive from the coordinator's own lease file
(`clinical-kb-heavy-locks/.../leases/.../owner.json`: pid 57448, `vitest run --reporter=dot`, this
worktree, `startedAt` 08:09:08) and from the live process. **Nothing was terminated and no lease was
forced** -- the lease proved to be my own run's, and the only correct action was to wait. The
`Test Files` line above is what established that it ran; the exit code alone would not have.

**The database suite's count moved 193 → 192, and that is the I-1 fix rather than a lost test.** The
`PLAN_COLUMNS` scan left that project when it moved into the offline one; the offline count rises by
that same case plus the new I-2 case, and nothing else changed hands.

## Does this round touch the browser gate?

**No — and with more confidence than last round, because the reviewer confirmed the load-bearing
premise.** The spec asserts nothing about the first-contact note's wording. This round changes two
test files, one SQL check expression, and one migration comment — and **not one line of rendered
output**. `patient-overview.tsx` is untouched in round 1 apart from being the subject of two reverted
mutations. The I-2 test renders an existing component through an existing prop combination and adds
no element, route, control or class. I expect `43 passed` unmoved, and would treat any movement as a
real finding rather than noise.

## Still open, and now yours to schedule

Concern 1's durable fix — releasing the clearance instant from `caring_contacts.retention_state`
rather than inferring the clearance from a blank name — you are capturing as tracked work. Nothing in
this round changes that inference, so the screen still reads a blank `patientName` as the clearance in
two places (`NoNameHeldNotice` and the reason note). Both are correct today for the reason the review
traced; both would go wrong together if a released episode ever held `""` without a clearance, which
the API forbids and `createPlan` does not.

---

# Round 2 — review fixes

**Round 2 of up to 5.** Two items, both addressed, plus one thing the mutations found on the way.
Nothing pushed, no PR.

| Commit       | Subject                                                                  |
| ------------ | ------------------------------------------------------------------------ |
| `2eaf76ca4`  | fix — anchor the cap scan on the expression, strike the round-0 sentence |
| `904461e77`  | test — strip SQL comments before the cap scan reads the migration        |
| _(this one)_ | docs — this round 2 section (a commit cannot name its own SHA)           |

## 1. The cap scan's SQL anchor

The finding is right, and it is the same shape as the one that opened this task: **a scan that is
correct today and cannot stay correct by construction.** I had proved the wrong thing about it. M16
and M17 show the scan reads the cap correctly _now_; neither shows it will keep reading the _cap_.

The mechanism, restated so the fix is checkable: `plans_first_contact_reason_shape` appears **twice**
in the migration — first in the `where c.conname = …` existence guard, then as the constraint being
added. The regex anchored on the first occurrence and took the first `<=` after it, so anything
numeric inserted between the two would be read as the cap.

Anchored on `char_length(` instead, which appears only in the constraint body and sits immediately
left of the comparison. And because "only" is the whole basis of that claim, the anchor's
**uniqueness is now asserted** rather than assumed: a second `char_length(` anywhere in the scanned
SQL fails the test instead of silently displacing the match.

**M20 is the demonstration the review asked for**, and it is worth reading as a pair of numbers. The
mutation inserts `and array_length(c.conkey, 1) <= 500` into the existence guard — a plausible future
edit — and drifts the real cap to `900`, leaving the TypeScript constant at `500`. Both regexes were
then run over the mutated file:

```
constant: 500 | OLD anchor: 500 AGREES (false green) | NEW anchor: 900 DISAGREES (correctly red)
```

That is the defect, executed: the old scan would have reported agreement while the real cap had
drifted by 400 characters. The new one fails, `expected '900' to be '500'`.

## The thing the mutations found: the scan was reading its own prose

M21 inserts a real second `char_length(` into the guard, and the uniqueness control fired — but it
reported `expected 3 to be 1`, not `2`. The third occurrence was **inside the mutation's own
explanatory comment**.

So the control was counting prose. In the committed file that happened to be harmless, because no
comment mentioned `char_length(` — but it meant a future comment that merely _discussed_ the anchor
would fail a test while changing no behaviour at all, and the regex could equally have matched a
`<=` written in prose.

This repo already had the answer, in `caring-contacts-migrations.test.ts`'s CREATE INDEX CONCURRENTLY
scan: _"the migrations discuss the prohibition in prose, and a scan that reads its own warning as a
violation is a scan that reports the wrong thing."_ The same precedent, applied here: `--` comments
are stripped before the migration is scanned, with a control on the stripping itself so a silently
broken `.replace` shows up as a failure rather than as a scan quietly reading prose again. **M22**
proves the direction that matters for over-sensitivity: a comment mentioning `char_length(` leaves
the raw file with two occurrences and the scan still passes.

I would not have found this by inspection. It surfaced only because the mutation's failure message
carried a number I did not expect, and I read it instead of accepting the red.

## 2. The falsified sentence, struck where it stands

Correct, and the inconsistency was the tell: I fixed M-3's round-0 error **in place** in the file
table and left this one annotated only downstream. A correction 300 lines after the error leaves the
error readable.

The clause in §2 is now struck through at its own site, with a one-line note naming what was false
(three files, not two; two mutations in `patient-overview.tsx`, not one) and pointing to the round-1
explanation and to M9-recheck. The round-1 commit table's attribution of M-2 to `a230bba34` is fixed
in passing — the migrations-test cases are there, the SQL edit is in `15559437f`.

## The `[[:space:]]` framing

Loosened, as suggested, and it cost about a line rather than a word. The comment now claims only the
provider-independent floor — space, tab, newline, carriage return, form feed, vertical tab, "how much
more depends on the collation provider" — and keeps U+00A0 as the named example of what escapes
either way. The enumerated set is unchanged, because that set is the safe floor and restating it
smaller would be the same over-claim in the other direction.

## Round 2 mutations

Method unchanged: exact-anchor assertion that raises rather than silently leaving an unmutated tree,
a **separate** `grep -c` presence step joined with `;`, then the gate read from a real summary line.
Every one reverted, every revert confirmed.

Note **M22**, the intentional survivor. A mutation that _should_ leave the gate green is evidence too
— it is how over-sensitivity gets caught — and it is labelled as such rather than buried.

<sub>(Corrected by the controller after the round-2 re-review. This sentence read "the two intentional
survivors … and both are labelled as such"; the table directly beneath it contains exactly one, M22.
A restated count falsified by its own adjacent table — Ruling 94 again, in the same round whose build
record is headed "written by me, broken by me". The controller then inherited the "two" into the
re-review brief without checking it against the table, which is how these travel.)</sub>

| #               | Mutation                                                                                                                       | Anchor matched? | Gate                       | Result                                                                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M20**         | Insert `and array_length(c.conkey, 1) <= 500` into the existence guard **and** drift the real cap to 900, constant left at 500 | yes (both)      | `vitest …domain-isolation` | **RED** — `expected '900' to be '500'`. Side-by-side regex run on the same bytes: old anchor `500` (false agreement), new anchor `900`. The finding, executed                                     |
| **M21**         | Insert a real second `char_length(c.conname) <= 500` into the existence guard                                                  | yes             | `vitest …domain-isolation` | **RED** — `expected 2 to be 1`. The uniqueness control refusing to let the anchor be displaced. (First run reported `3`, which is what exposed the prose-counting bug above)                      |
| **M22**         | Add a **comment** that merely mentions `char_length(` — raw file then holds two occurrences                                    | yes             | `vitest …domain-isolation` | **SURVIVED, intentionally** — `6 passed (6)`. Comments are stripped, so prose about the anchor is not the anchor. This is the over-sensitivity check                                              |
| **M18-recheck** | Rename the constraint to `plans_first_contact_reason_bounds` (round 1's M18, re-aimed at the new anchor)                       | yes (2 sites)   | `vitest …domain-isolation` | **RED** — `expected '…' to contain 'plans_first_contact_reason_shape'`. The new anchor does not depend on the name, so the name is now pinned by its own control; round 1's evidence still stands |
| **M16-recheck** | Raise `FIRST_CONTACT_REASON_MAX_LENGTH` to 800 with the SQL unchanged (round 1's M16, under the hardened scan)                 | yes             | `vitest …domain-isolation` | **RED** — `expected '500' to be '800'`. The drift case still caught after the anchor change                                                                                                       |

## Round 2 gates

The decisive lines, pasted:

```
# npm run test   (GATE_RECEIPTS=refresh -- a fresh run, not a reused receipt)
 Test Files  830 passed | 3 skipped (833)
      Tests  10037 passed | 74 skipped (10111)
   Duration  549.21s
[exited with code 0]

# npm run caring-contacts:db:test   (Docker Postgres 17 on 54329, local and offline)
 Test Files  2 passed (2)
      Tests  192 passed (192)
   Duration  194.68s

# npm run lint          (GATE_RECEIPTS=refresh)
[gate-receipts] recorded a pass for "lint:internal" (5305 input files).

# npm run typecheck     (GATE_RECEIPTS=refresh)
[gate-receipts] recorded a pass for "typecheck:internal" (5305 input files).
```

Counts unchanged from round 1 in both suites, which is what round 2 should produce: it hardened an
existing scan rather than adding a case.

The database suite was re-run even though round 2 changed only `--` comments in the migration,
because the migration FILE changed and both database suites apply it from an empty schema. A comment
cannot alter behaviour, but "cannot" was worth twenty seconds of proof rather than an assumption.

**One reading note, so nothing in that log is mistaken for a failure.** The `npm run test` dot stream
carries two lines reading `check:function-grants: FAIL`. Those are that guard's OWN positive-control
output -- it feeds itself deliberately broken SQL to prove it catches it -- and the suite reports
zero failed tests. Flagged because a later reader grepping this log for `FAIL` will find them.

## Does this round touch the browser gate?

**No.** Round 2 changes one test file, one SQL comment block, and this report — no rendered output, no
component, no route, no schema behaviour. The one SQL change is prose inside `--` comments, which the
database never parses as anything. The review noted my round-1 answer was sound and stronger than I
stated it, since the migration is retired by the database suite independently; that holds here with
less at stake, because round 2 does not change the constraint at all. I would still treat any
movement off `43 passed` as a real finding.

## A distinction I am carrying forward

The review's note on the lease evidence is the most useful thing I was told this task, and it is not
about locks. I identified a lease from a recorded `worktree` field plus a live PID, and that was
**sufficient for waiting** and would **not** have been sufficient for breaking the lease — a stale
record plus PID reuse defeats it, and reading the live process's own working directory from the OS is
the stronger evidence that a destructive action would have required.

The general form: **the strength of evidence you need scales with the destructiveness of what you do
with it.** The same observation can be adequate proof for a reversible act and inadequate for an
irreversible one, so "I checked" is never a complete answer on its own — what was checked has to be
weighed against what it is being used to justify. That principle generalises well past this
repository, and it is the one I would most want a later implementer on this programme to inherit.
