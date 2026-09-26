# Task P report — the patient-visible message uses the patient's first name

**Branch** `claude/caring-contacts-message-name`, worktree `D:\Worktrees\Database\cc-message-name`.
Base `1f7be1673`. Nothing pushed, no pull request opened, no subagent dispatched.

## What was built

**The message gained a slot, and the system asks for what goes in it.** Nothing anywhere splits the
stored `patientName`, and every place a later editor might reach for one carries the reason it must
not: a split greets a person with one name by their only name, a person whose family name is written
first by their surname, `Mr John Smith` as "Mr", and a person with two given names by half of them.

| Where                                                          | What changed                                                                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/caring-contacts/message-policy.ts`                    | New `maxSeptetsWithin(segments)`, so a caller can derive a ceiling from the GSM-7 thresholds instead of writing one down |
| `src/lib/caring-contacts/message-copy.ts`                      | The template, its specimen, the computed cap, and `resolvePatientVisibleMessage`                                         |
| `src/lib/caring-contacts/episode.ts`                           | `Episode.preferredName: string \| null`                                                                                  |
| `src/lib/caring-contacts/repository.ts`                        | `EpisodePatientDetail` widened; `CLEARED_PATIENT_DETAIL.preferredName = ""`                                              |
| `src/lib/caring-contacts/retention.ts`                         | Contract prose corrected; `deidentifyEpisode` drops it by construction                                                   |
| `src/lib/caring-contacts/audit.ts`                             | `preferredName` added to the audit-event denylist                                                                        |
| `src/lib/caring-contacts/in-memory-repository.ts`              | Written at create, projected by `getEpisode`, cleared by the whole-constant spread                                       |
| `src/lib/caring-contacts/db/postgres-repository.ts`            | Written at create, read by `getEpisode` only, cleared by name — all inside `runWrite`/`runRead`                          |
| `caring-contacts/supabase/migrations/0007_…preferred_name.sql` | Nullable, undefaulted, unbackfilled column with a character-length backstop                                              |
| `src/app/api/caring-contacts/plans/route.ts`                   | `preferredName: z.string().min(1).nullable()` inside the `.strict()` object                                              |
| `plan-wizard/patient-detail.ts`                                | Draft field, three named refusals, and the submit-boundary guard                                                         |
| `plan-wizard/plan-draft.ts`                                    | Required on read-back; an older draft is discarded rather than defaulted                                                 |
| `plan-wizard/plan-activation.ts`                               | `CreatePlanRequestBody.patientDetail.preferredName`                                                                      |
| `plan-wizard/plan-wizard.tsx`                                  | The stage-3 field with a persistent hint, and the review-stage read-back row                                             |
| `workspace/patient-overview.tsx`                               | Renders the three states apart — recorded, never held, removed by a clearance                                            |

`EXACT_PATIENT_VISIBLE_MESSAGE` is now `personalisedPatientVisibleMessage(SPECIMEN_PREFERRED_NAME)`
and is byte-identical to the constant that stood there before. Every mockup that renders it is
untouched.

## The length contract

`PREFERRED_NAME_MAX_SEPTETS` is **computed, never a literal**:

```
maxSeptetsWithin(PROVISIONAL_MESSAGE_RULES.maxSegments) - PATIENT_VISIBLE_MESSAGE_BASE_SEPTETS
```

The base is `calculateGsm7(personalisedPatientVisibleMessage("")).septets` — the message with the
slot empty — so the cap moves with the wording. It evaluates to **59 septets** today (the message
with `Rowan` is 252, the empty-slot base is 247, the two-segment ceiling is 306).

`maxSeptetsWithin` deliberately returns `160` for one segment rather than `153 * 1`: the
concatenation header costing the other seven septets exists only once a message is split, and
`153 * segments` would have understated a one-segment budget — quietly, in the safe direction.

**The exact `septets: 252` pin was not deleted; it was superseded by a stronger statement.** 252 was
true of one string. The message is a template now, so the interesting property is not "this string is
252 septets" but "no name this domain accepts can push this message past its ceiling". The
replacement quantifies over every accepted length, and it is tested at both ends: the longest
accepted name lands **exactly on** the 306-septet ceiling (so the cap is maximal, not merely safe),
and one character past it is refused by name. A third case pins that the cap counts **septets rather
than characters**, using the two-septet extension character `€`.

The specimen's own `septets: 252` evidence is still pinned, in
`tests/caring-contact-mockups.dom.test.tsx` — **where it already was before this branch. I did not
move it there**, and nothing above should be read as a relocation. It is the surviving evidence that
the wording did not change, and it sits in the suite that renders the specimen, which is where that
claim belongs.

**Nothing is owed on "keep a case pinning the unpersonalised form".** The brief asked for one _if one
still exists anywhere_, and none does: there has never been unpersonalised wording, and
`resolvePatientVisibleMessage` refuses with `preferred-name-not-recorded` rather than inventing one.
The pinned case is that refusal, which is the honest replacement for a form that does not exist.

## Retention

`preferredName` is Ruling [105]'s class, not Ruling [122]'s: the attestation is preserved because it
holds no patient content, and a name is nothing but patient content. It clears to `""`, matching
`patientName`, and both directions are pinned in the shared contract suite:

- **it is removed** — `tests/helpers/caring-contacts-repository-contract.ts`, "actually removes the
  identifying detail", with a positive control that the name was held right up to the clearance;
- **the clearance still removes everything else** — the existing "does not stop that clearance
  removing what it is supposed to remove" case, which is the half that would catch a clearance that
  had stopped working entirely.

The fixture's preferred name is `"Jordy"` against a patient name of `"Jordan Nguyen"` — **not a
substring, and not reachable by any split**. Had the two overlapped, an implementation that _did_
split would satisfy every assertion about the field, and the `JSON.stringify` absence checks could
not tell the two apart.

**Cleared and never-held stay distinguishable.** `null` means no preferred name is held (a plan that
predates the column, or a caller that supplied none); `""` is the clearance's own value. The Postgres
projection preserves null as null rather than collapsing it, and `patient-overview.tsx` gives each
state its own sentence. Neither sentence names a cause the record cannot support.

**"Both stores" is complete for the clearance and NOT for the null, and the difference is worth
stating rather than glossing.** The clearance is pinned in the shared contract suite, so it is proven
against the in-memory store and the Postgres one from one set of assertions. The `null` case is not:
the shared fixture always supplies a preferred name, so the only place a null-holding plan exists is
the Postgres case added in `f0336d1d1`, which writes the column directly. The risk is low — the
in-memory store holds the caller's `patientDetail` object verbatim and has no mapping step that could
collapse a null — but low risk is not proof, and `M20` is exactly the reminder that "no route
produces this row" is how a branch stays unproven.

## The migration

`caring-contacts/supabase/migrations/0007_caring_contacts_preferred_name.sql`, following `0005`:
`if not exists`, a named check constraint added only when absent, one `begin`/`commit`, no
`CREATE INDEX CONCURRENTLY`, and a `comment on` recording the obligation. **No backfill and no
default** — plans created before this hold no preferred name, and a placeholder (least of all one
derived from `patient_name`) would fabricate a clinical record.

**It is in `caring-contacts/supabase/migrations/`, never the repository root's `supabase/migrations/`.**

Two deliberate differences from `0005`, both stated in the file:

1. **`''` is accepted rather than refused.** In `0005` null means absent and `''` can only be a
   caller's bug. Here `''` is what `markRetentionCleared` writes, exactly as it already does for
   `patient_name`; a constraint refusing it would break de-identification against a real database.
2. **The domain cap is pinned `<=` the SQL literal, not `=`.** `0005` expresses one rule twice in one
   unit, so equality is right there. Here the units differ — the domain caps GSM-7 septets, Postgres
   counts characters — and every character costs at least one septet, so a septet cap of N implies a
   character length of at most N. The constraint can therefore never refuse a name the domain
   accepted; drift can only make it redundant. And the domain cap is _derived_ from provisional
   wording the clinical approval gate is expected to change, so pinning equality would make a wording
   review produce a schema migration. The dangerous direction is still caught: a domain cap above the
   literal would turn a named refusal into a raw constraint violation on a clinical write.

## One decision beyond the brief, recorded so it can be overturned

`resolvePatientVisibleMessage` has a **third** refusal, `preferred-name-not-sendable`, for a name
containing a character outside the GSM-7 alphabet (`Zoë`, `Aroha-Lī`).

I added it because the alternative is silent. Such a name makes `calculateGsm7` report
`{ valid: false, segments: 0 }` for the **whole message**; `validateGovernedMessage` evaluates the
segment ceiling only `if (gsm7.valid)`; and `MessageValidationIssue` carries no invalid-characters
code at all. So an accepted `Zoë` produces a message this domain reports as **valid**, with the
ceiling never evaluated. Length is the only thing checked there, and this removes the check.

**CORRECTED FROM ROUND 1, where I wrote that such a message would "arrive damaged" and told the
coordinator so.** That is stronger than anything known. A real SMS gateway normally re-encodes a
non-GSM-7 message to UCS-2 and delivers it **intact**, at 70 characters per segment and 67
concatenated — which would turn this 252-septet message into roughly four segments. So the
demonstrable failure is **not corruption; it is that the two-segment ceiling silently stops being
enforced**. This domain models no UCS-2 path, so within this system the message genuinely is
unencodable and refusing remains the conservative answer — but for the unenforced ceiling, not for a
corruption nobody here has observed.

**It is still a refusal a clinician meets when typing a real person's name, and that is a product
decision, not mine.** If the owner would rather accept the name and fix the encoding path instead,
the change is local: delete the `!nameEvidence.valid` branch in `message-copy.ts` and the cases that
cover it. I would then recommend `validateGovernedMessage` gain an `invalid-characters` issue code,
because the hole it leaves is real either way.

**The refusal's wording was wrong in round 1 and is fixed.** It read _"Enter the closest spelling an
ordinary text message can send"_ — while the field's own hint one line above says _"Ask the person."_
A clinician quietly stripping the diacritics from someone's name is precisely the small indignity an
ASKED-FOR preferred name exists to prevent, and a refusal instructing them to do it is worse than no
refusal at all. It now names the offending characters and asks them to ask the person how they would
like their name spelled in a text message. `M22` is the mutation that holds it there.

## The slot's shape, and the Server/Client boundary

The coordinator relayed a constraint from the task wiring the message preview: a Server Component
cannot pass a **function** across the boundary, so the resolved message must be a serialisable value
by the time it reaches a Client Component.

**The shape here already satisfies that, and it was not changed to.** `resolvePatientVisibleMessage`
lives in the sealed domain and is called for its VALUE; what comes back is a plain object holding a
string, or a plain object holding a refusal code. Nothing in this diff passes a function as a prop,
and `EXACT_PATIENT_VISIBLE_MESSAGE` is still a plain string constant, so every screen already
rendering it is untouched.

`message-copy.ts` stays importable from client code — it is pure, with no server-only dependency —
which is what lets `patient-detail.ts` ask it in the browser the same question the submit boundary
asks. That is the one rule not being duplicated, rather than a boundary being crossed.

**What I did NOT do: run a build.** The brief's gate list is `test:cc-guards`, typecheck, uncached
lint and Prettier, and a build is none of them. This diff adds no prop of function type and no value
crossing a boundary that was not already crossing it (`Episode` already reaches
`patient-overview.tsx` carrying `Date`s), so I judge the added boundary risk to be nil — but that is
an assessment, not a check, and this repository has twice shipped Server/Client defects that passed
typecheck and the full unit suite. **The build at the merge point is where that gets confirmed.**

## What a screen must do differently now the slot exists

Nothing renders a personalised message yet, and that is a state the next task inherits rather than a
gap in this one. The rule the slot creates:

- A screen showing the message **in the context of a specific plan or patient** must call
  `resolvePatientVisibleMessage(episode.preferredName)` and render either the resolved text or the
  named refusal. It must never render `EXACT_PATIENT_VISIBLE_MESSAGE` there: that string carries the
  fictional name `Rowan`, and a clinician reading it beside a patient's record would reasonably take
  it for that patient's message.
- A screen showing the wording **as a specimen** — the design-scratch mockups, the review pack —
  keeps rendering `EXACT_PATIENT_VISIBLE_MESSAGE`, and should say the name in it is a fictional
  specimen rather than this patient's.

Today the three mockup screens (`personalisation-screen.tsx`, `product-ui.tsx`,
`review-activation-screen.tsx`) render it under the heading **"Exact patient-visible message"** and
say nothing about the name being a specimen. That was harmless while no plan held a preferred name.
It is still not wrong — those routes 404 in production — but it is exactly the sentence the preview
task must not carry onto a real screen. I have not changed them: they are design scratch, and that
task owns them.

## The cap and the demo seed

The coordinator noted that the demo seed writes the current message into `messageTextByType.standard`
on another branch, and that the bound has to hold for whatever the seed stores too.

`PREFERRED_NAME_MAX_SEPTETS` bounds **this module's template and nothing else** — a cap derived from
one string says nothing about a different one. So the rule is now exported as well as its answer:

```ts
preferredNameMaxSeptets(unpersonalisedText: string): number;
```

`PREFERRED_NAME_MAX_SEPTETS` is that function applied to this template, pinned by a test, so the
general rule and the specific number cannot disagree. At merge, if the seed's stored text gains the
same slot, ask `preferredNameMaxSeptets` for ITS cap rather than reusing this one — and where two
texts of different lengths are both substituted from one field, the effective cap is the smaller,
because one accepted name has to fit both.

## Mutation ledger

Every row is one mutation, applied to a committed tree, presence checked by byte equality read
in-process (never through a shell), the worktree asserted clean on both sides, and reverted with
`git checkout --` before the next ran. `present` is that byte-equality check; `attempt` is which
lease attempt actually ran, so a queued row is visible rather than averaged away. The driver refuses
above all file I/O: a containment allowlist of explicit paths, id uniqueness checked before any row
runs, and a no-op check that the replacement really changes the file. Both lock-refusal shapes are
detected — the one that prints `DATABASE_HEAVY_RUN_ADMISSION_BUSY` and the one that throws with no
marker — and a run with no `Test Files` summary line is recorded UNRUN whatever its exit code.

`head` is the commit the row ran against. **The driver only began recording it in round 2**, and the
finding that forced that is below. Round-1 rows carry their commit in italics, established from the
run order rather than from the row itself — which is exactly the weakness the round-2 change removes.

| id     | mutation                                                              | suite selection                    | predicted | observed      | present | head        | attempt | summary                    |
| ------ | --------------------------------------------------------------------- | ---------------------------------- | --------- | ------------- | ------- | ----------- | ------- | -------------------------- |
| `M1`   | widen `PREFERRED_NAME_MAX_SEPTETS` by one septet                      | message-copy                       | RED       | **RED**       | true    | _2a11d3b0c_ | 1       | `Test Files  1 failed (1)` |
| `M2`   | stop refusing an over-long preferred name                             | message-copy                       | RED       | **RED**       | true    | _2a11d3b0c_ | 1       | `Test Files  1 failed (1)` |
| `M3`   | template ignores the slot and hardcodes the specimen name             | message-copy                       | RED       | **RED**       | true    | _2a11d3b0c_ | 1       | `Test Files  1 failed (1)` |
| `M4`   | break the one-segment branch of `maxSeptetsWithin`                    | message-copy                       | **GREEN** | **GREEN**     | true    | _2a11d3b0c_ | 1       | `Test Files  1 passed (1)` |
| `M5`   | clearance leaves the preferred name in place                          | repository (in-memory)             | RED       | **RED**       | true    | _2a11d3b0c_ | 1       | `Test Files  1 failed (1)` |
| `M6`   | Postgres clearance keeps a preferred name it already holds            | postgres-repository                | RED       | **RED**       | true    | _2a11d3b0c_ | 10      | `Test Files  1 failed (1)` |
| `M6b`  | the same mutation, re-run so the row is attributable                  | postgres-repository                | RED       | **RED**       | true    | `05487cdd7` | 1       | `Test Files  1 failed (1)` |
| `M7`   | add `preferred_name` to the list read's column set                    | domain-isolation                   | RED       | **RED**       | true    | _2a11d3b0c_ | 1       | `Test Files  1 failed (1)` |
| `M8`   | drop the SQL backstop below the domain cap                            | domain-isolation                   | RED       | **RED**       | true    | _2a11d3b0c_ | 1       | `Test Files  1 failed (1)` |
| `M9`   | accept a stored draft with no preferred name                          | plan-draft.dom                     | RED       | **RED**       | true    | _2a11d3b0c_ | 1       | `Test Files  1 failed (1)` |
| `M10`  | submit boundary stops refusing an unusable name                       | plan-patient-detail                | RED       | **RED**       | true    | _2a11d3b0c_ | 1       | `Test Files  1 failed (1)` |
| `M11`  | stage 3 stops reporting the preferred name's refusals                 | plan-patient-detail                | RED       | **RED**       | true    | _2a11d3b0c_ | 1       | `Test Files  1 failed (1)` |
| `M12`  | prefill the preferred-name field from the patient's name              | plan-wizard.dom                    | RED       | **RED**       | true    | _2a11d3b0c_ | 1       | `Test Files  1 failed (1)` |
| `M13`  | collapse a cleared preferred name into the never-held wording         | patient-overview.dom               | RED       | **RED**       | true    | _2a11d3b0c_ | 1       | `Test Files  1 failed (1)` |
| `M14`  | drop the preferred name from the audit-event denylist                 | audit                              | RED       | **RED**       | true    | _2a11d3b0c_ | 1       | `Test Files  1 failed (1)` |
| `M15`  | derive the preferred name by splitting the stored patient name        | domain-isolation                   | RED       | **RED**       | true    | _2a11d3b0c_ | 1       | `Test Files  1 failed (1)` |
| `M16`  | stop refusing a name outside the GSM-7 alphabet                       | message-copy + plan-patient-detail | RED       | **RED**       | true    | _2a11d3b0c_ | 1       | `Test Files  2 failed (2)` |
| `M18`  | create writes an empty preferred name instead of the caller's         | repository (in-memory)             | RED       | **RED**       | true    | _2a11d3b0c_ | 1       | `Test Files  1 failed (1)` |
| `M19`  | Postgres create never writes the preferred name                       | postgres-repository                | RED       | **RED**       | true    | _2a11d3b0c_ | 1       | `Test Files  1 failed (1)` |
| `M19b` | the same mutation, re-run so the row is attributable                  | postgres-repository                | RED       | **RED**       | true    | `05487cdd7` | 1       | `Test Files  1 failed (1)` |
| `M20`  | Postgres read collapses a never-held name onto the cleared value      | postgres-repository                | RED       | **GREEN**     | true    | _2a11d3b0c_ | 1       | `Test Files  1 passed (1)` |
| `M20b` | the same mutation, first re-run                                       | postgres-repository                | RED       | **RED, VOID** | true    | _f0336d1d1_ | 1       | `Test Files  1 failed (1)` |
| `M20c` | the same mutation, re-run after the case it needed was fixed          | postgres-repository                | RED       | **RED**       | true    | _5c78c0dcf_ | 1       | `Test Files  1 failed (1)` |
| `M20d` | the same mutation again, with `head` recorded by the driver           | postgres-repository                | RED       | **RED**       | true    | `05487cdd7` | 1       | `Test Files  1 failed (1)` |
| `M21`  | cap rule ignores the text it is given                                 | message-copy                       | RED       | **RED**       | true    | _5e28a05a8_ | 1       | `Test Files  1 failed (1)` |
| `M22`  | unsendable-name refusal picks a spelling instead of asking the person | plan-patient-detail                | RED       | **RED**       | true    | `05487cdd7` | 1       | `Test Files  1 failed (1)` |

**There is no `M17`, and no attempt is missing.** The ids run `M1`–`M16` and `M18`–`M22`, plus four
re-run suffixes. `M17` was never allocated: the second plan file was written straight from `M16` to
`M18`, a numbering slip made while writing the plan rather than a dropped, unmatched, or refused
attempt. Every attempt this task made has a row above, greens included.

Six rows are worth reading rather than counting.

**`M4` is an over-sensitivity control, and it went GREEN as predicted.** `maxSeptetsWithin` returns
160 for one segment rather than `153 * 1`, and nothing calls it with 1 today, so breaking that branch
changes no value any assertion reads. It is in the ledger because a mutation that SHOULD leave a gate
green is evidence too — and because that branch is therefore honestly unproven, held by its own
reasoning and not by a test.

**`M20` is the one prediction that was wrong, and it found a real gap.** I predicted RED; it went
GREEN. Collapsing the Postgres read's `null` onto the cleared `""` left every suite passing, because
no fixture anywhere builds a plan row without a preferred name — that row is a plan created BEFORE
migration 0007, which deliberately backfilled nothing, so it exists in a live database and in no
test. The distinction the whole "cleared versus never held" requirement rests on was unproven at the
one layer that reads it out of a real column. `f0336d1d1` added a case that makes the row directly.

**`M20b` is VOID and is kept rather than deleted. It is the most useful row in this table, and it
proves nothing about the mutation — read the two sentences above and below it together.** It went red
under the right test name and for the wrong reason. The case `f0336d1d1` had just added made its
pre-0007 row with a bare `pool.query`, and this schema refuses a bare `update` on `plans` outside an
audited transaction, so the case failed _unmutated_. **Nothing in this report should be read as if
`M20b` established the property.** I found it only because the final gate run on the whole database
suite went red on a clean tree; the mutation ledger alone would have carried a false green into
review. Note what the row's own `firstFailure` could not do: it names the same test as `M20c` and
`M20d`, so the failing test name did not distinguish a real red from the broken case, and only the
unmutated suite's verdict on the same tree could.

**`M20c` and `M20d` are what actually establish it**, and the property is load-bearing enough to have
been run twice more rather than argued about. `5c78c0dcf` fixed the case to open an audited team
session; `M20c` re-ran the same mutation there against a suite that is `Tests  204 passed (204)`
unmutated, and went RED. `M20d` is a third run at `05487cdd7`, after the driver began recording
`head`, so the row that carries "cleared versus never held" no longer depends on my saying which tree
it ran on.

**`M6` and `M19` are attributable, and round 2 made that checkable instead of arguable.** Both target
`postgres-repository` — the same file that failed unmutated for the whole window between `f0336d1d1`
and `5c78c0dcf` — and both print `Test Files  1 failed (1)`, which is byte-identical to what that
broken case alone produced. A reader was right to ask which it was. It was the mutation: both ran at
`2a11d3b0c`, before the broken case existed, and the database suite was verified
`Tests  203 passed (203)` immediately before that round. Their recorded failing tests are also the
wrong ones for the broken case — `does not stop that clearance removing what it is supposed to
remove` for `M6`, `replays the original created plan and stores no second plan` for `M19`, neither of
which is the null-preferred-name case. **None of that was legible from the table as first written**,
so `M6b` and `M19b` re-run both at `05487cdd7`, where the suite is green unmutated, and the driver
now records `head` on every row. Every non-database row was never in doubt: the broken case lives in
a project those selections do not run, and `M8` targets the migrations file, which would have printed
`2 failed`.

**`M22` covers round 2's clinical fix.** Reverting the unsendable-name refusal to the wording that
told the clinician to pick a spelling themselves reddens the case asserting it asks the person
instead. Without it, that change would have been a wording edit with no test that could fail.

**`M11` is coarser than one assertion.** It disables the whole preferred-name reporting block in
`personalisationIssues`, so it reddens the field-order case and both cap cases together. The three
refusals underneath are separately mutated at their source — `M2` for too-long, `M16` for
not-sendable, and the not-recorded case at the submit boundary by `M10` — so the coarse row is not
the only evidence for any of them.

**One driver defect, found and corrected rather than worked around.** The first run threw
`spawnSync git ENOENT`, and the obvious reading — "this process does not inherit the shell's PATH" —
was false; a bare `git` resolves fine. The real cause was the driver's `ROOT`, written as
`"D:\Worktrees\..."` into a heredoc that collapsed the doubled backslashes, so JavaScript read `\W`,
`\D` and `\c` as their bare letters and the working directory became
`D:WorktreesDatabasecc-message-name`. `spawnSync` reports a missing cwd as ENOENT **on the file**,
which is what sent the first diagnosis the wrong way. It threw at the cleanliness check, before
touching any file — the intended order. The wrong explanation is recorded in the driver beside the
fix, because the next reader would otherwise inherit it.

## Verification

Every gate below ran on `05487cdd7`, the last commit that changes code; the only commit after it
touches this report and nothing else. Lock refusals are recorded as UNRUN and retried; none was ever
forced past another worktree's lease, and this round recorded no refusal at all.

| gate                                                                                             | result                                                   |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `npx tsc --noEmit -p tsconfig.json`                                                              | `typecheck exit=0` (the config includes `tests/**`)      |
| `npx eslint <every changed .ts/.tsx>` — **uncached**, `node_modules/.cache/eslint` removed first | `eslint exit=0 over 29 files`                            |
| `npx prettier --check <every changed non-SQL path>`                                              | `All matched files use Prettier code style!`             |
| the `test:cc-guards` selection                                                                   | `Test Files  18 passed (18)` / `Tests  432 passed (432)` |
| the affected suites `cc-guards` does not cover — enumerated below                                | `Test Files  12 passed (12)` / `Tests  328 passed (328)` |
| `caring-contacts:db:test` against local Postgres                                                 | `Test Files  2 passed (2)` / `Tests  204 passed (204)`   |

**The migration replays from empty**, not merely against an existing database:
`tests/helpers/caring-contacts-postgres.ts` runs `drop schema if exists caring_contacts cascade` and
then applies every file in `caring-contacts/supabase/migrations` in order before the suite starts, so
`Tests  204 passed (204)` is a full replay including `0007`. The container is the local disposable one
named in the brief; nothing here touched a hosted service.

**The second selection is not in `test:cc-guards`, is touched by this diff, and had to be run
anyway.** Named rather than counted, so the figure beside it can be checked:
`caring-contacts-message-copy`, `caring-contacts-message-policy`, `caring-contacts-repository`,
`caring-contacts-api-handler`, `caring-contacts-fingerprint`, `caring-contacts-simulation`,
`caring-contacts-audit`, `caring-contacts-model`, `caring-contact-mockups.dom`,
`caring-contact-product-redesign.dom`, `caring-contacts-access-audit`, and
`caring-contacts-page-access-audit`. Reporting `cc-guards` green while `caring-contacts-repository`
was red would have been a true sentence about a broken tree.

**Three runs went red before these numbers, and all three were mine.** The first `cc-guards` run
reported `Tests  37 failed | 395 passed` — three wizard fixtures reached stage 4 without the field
stage 3 now requires, and the retention sibling scan caught the new `episode.ts` doc comment using
the word "retention", which that gate forbids outside `retention.ts`. The comment was reworded to
name the clearance instead; the gate was not weakened and `episode.ts` was not added to its
allowlist. The first database run reported `Tests  1 failed | 203 passed`, for the reason `M20b`
records above. Round 2 added no red of its own.

**Every SHA in this report was checked to still exist** with `git cat-file -e <sha>^{commit}`.

**Not run, and why.** No build (see the boundary section — assessed, not checked). No Playwright: no
route, no chrome, and no phone-composer behaviour changed. No `verify:cheap`, `verify:pr-local`, or
`verify:release`: the brief names the gate set, and the broad ones are provider-backed or would
re-derive the same verdict on a shared machine already at capacity.

## Round 2 — what the review changed

Spec PASS, quality PASS with findings. One finding was in the code and the rest were in this report.

**The code change, and it was the one that mattered.** The `preferred-name-not-sendable` refusal read
_"Enter the closest spelling an ordinary text message can send"_ while the field's own hint one line
above says _"Ask the person."_ **A clinician quietly stripping the diacritics from someone's name is
precisely the small indignity an asked-for preferred name exists to prevent**, and a refusal telling
them to do it hands the decision back at the one moment the design exists to keep it with the
patient. The refusal now names the offending characters and asks the clinician to ask the person how
they would like their name spelled. `M22` reddens the case that holds it there, so this is a change
with a test that can fail rather than a wording edit.

**A claim of mine was over-stated and is corrected wherever I wrote it** — `message-copy.ts`, the two
covering tests, and this report. "Arrives damaged" is stronger than anything known: a real gateway
re-encodes a non-GSM-7 message to UCS-2 and delivers it intact, at 70/67 characters per segment. The
demonstrable failure is that the two-segment ceiling silently stops being enforced. The refusal is
kept, on the corrected reasoning.

**Three ledger defects, all repaired above rather than argued away.**

- `M20c` had no row, so the property I had myself called load-bearing rested on one prose sentence,
  beside a paragraph presenting the void `M20b` as proof. `M20c` and `M20d` now have rows, and the
  `M20b` note says outright that it establishes nothing.
- `M6` and `M19` were not attributable as written: same suite, same summary string as the
  pre-existing failure, and no commit recorded. The driver now records `head` on every row, `M6b` and
  `M19b` re-run both against a green tree, and the note gives the original commits and the failing
  test names.
- `M17` was an unexplained gap with the shape of a dropped attempt. It was a numbering slip, and the
  table now says so.

**Four smaller corrections.** The demo-seed attribution was inverted — the brief does list it as a
deliverable, and the honest reason it is undone is that this tree contains no such module. The
`null` case is pinned for the Postgres store only, not both, and now says so. Nothing implies the
`252` pin was relocated; it was already where it is. Two counted sets are enumerated instead, and the
brief's "keep a case pinning the unpersonalised form" is answered in one sentence: nothing is owed,
because no unpersonalised form exists and the resolver refuses rather than inventing one.

**Confirmed clean, no action.** The reviewer read the Server/Client boundary against this repo's
specific failure modes and found nothing a build would reject — no function, class instance or
non-serialisable value added to any prop, and `message-copy.ts` pulls no `server-only`, no `node:`
builtin, no `process.env`. That is a read, not a build, and it stays open until the merge-point
build.

## Concerns and follow-ups

1. **The non-sendable refusal is a product decision I made.** See the section above. A clinician
   typing `Zoë` is told the channel cannot carry it, and asked to ask the person how they would like
   it spelled. Refusing beats emitting a message whose two-segment ceiling is never checked, and the
   alternative leaves `validateGovernedMessage` unable to see the problem at all — but the owner
   should confirm it, and the reversal is local.

2. **The preferred name is REQUIRED at stage 3, and that is also mine.** The domain allows `null`
   (a caller may hold no preferred name, and every pre-0007 plan does); the wizard does not, because
   a plan created there exists to send messages and the message opens with this name. If the owner
   wants a clinician able to proceed without it, `createPlanPatientDetail` and `personalisationIssues`
   are the two places, and the message resolver then refuses at send time instead — which is later
   and less useful, but not unsafe.

3. **`parseDraft` now discards a draft written before this field existed**, taking the patient's name
   and mobile number with it. That follows the module's own stated rule, and the alternative is a
   silently defaulted blank that is indistinguishable from a clinician who deliberately left it empty.
   The cost is a clinician retyping three fields once, in a tab open across a redeploy.

4. **The demo seed is not done, and my round-1 reason for that was inverted.** I wrote that it was
   "not mine (brief)" — the brief in fact lists it under _what you are building_. The honest framing
   is that **the brief names a deliverable this tree does not contain**: there is no caring-contacts
   demo-seed module here, so building it was impossible, and the coordinator separately took the
   reconciliation as a merge task. The substance stands and the attribution did not.
   `messageTextByType.standard` on the seed branch holds a copy of the current message; once the
   wording gains a slot there, its cap must come from `preferredNameMaxSeptets` applied to that text.

5. **`maxSeptetsWithin`'s one-segment branch is unproven** (`M4`). Nothing calls it with 1 today. It
   is right, and it is held by reasoning rather than by a test.

6. **A build has not been run.** Assessed as nil added Server/Client boundary risk, not checked. See
   the boundary section.

7. **The mockup preview screens now need the specimen said out loud.** Not a defect today, and not
   mine to change; written up above so the preview task inherits it rather than guessing.

8. **The `null` preferred name is pinned in the Postgres store only.** The shared contract fixture
   always supplies one, so the in-memory side of that branch has no covering case. Low risk — that
   store holds the caller's object verbatim — but `M20` is the standing reminder that "no route
   produces this row" is exactly how a branch stays unproven.
