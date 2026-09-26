# Task SEED report — make the demo drivable

**Status: DONE_WITH_CONCERNS**, after fix round 1. The population exists, the prototype can be
driven, and nothing patient-visible was authored.

Round 1's largest finding was that I had described the fictional dual approval as a future risk when
it was already rendering at stage 2, with a mitigation that never reached the viewer. That is fixed:
the record now carries its own provenance and the screen states it — F3 below. Round 1 also made the
production boundary structural rather than conventional, restored two assertions that had been
rewritten into shapes that could not fail, and corrected a mutation ledger that over-stated its own
coverage.

What still needs someone other than me: **F7**, a shared snapshot against a personalised greeting,
which is a question about what a snapshot is for. **F1**'s trade was upheld and the owner has resolved
it — the isolated Playwright server stays unseeded and a second server is a separate task, described
below. Everything else here is recorded rather than outstanding.

## What was built

`src/lib/caring-contacts-server/demo-seed.ts`, reached from exactly one place: the in-memory branch
of `caringContactsStore()`.

The population is one approved and published pathway version, a referral for every seeded patient,
and a plan in each of the three states a coordinator has to be able to tell apart. Every record was
written through the repository's own methods, with a demo actor from `session.ts` and a fixed
idempotency key. Nothing was written into a Map.

The shape is chosen so that each built screen has something on it **and** a sign-up can be
completed:

| What                         | Why it is there                                                                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| One approved pathway version | Without one, `createPlan` has nothing to name and stage 2 of the wizard has nothing to choose.                                                       |
| Accepted referrals           | One of them has **no plan**, which is what the wizard needs — a patient with a live plan is refused a second.                                        |
| One awaiting handover        | So the two referral states are distinguishable on a screen rather than inferred.                                                                     |
| A running plan               | The ordinary caseload row.                                                                                                                           |
| A paused plan                | The state a coordinator has to be able to tell apart from a stopped one.                                                                             |
| A withdrawn plan             | Task 9 found the screen once told a coordinator a stopped plan would still send. A demo that cannot show a stopped plan cannot demonstrate that fix. |

## The safety boundary

**1. It cannot run against a database, or against production — structurally, not by a flag.**

`createDemoWorkspaceStore(clock)` **constructs** the in-memory repository itself. There is no store
parameter, so a Postgres repository has nothing to arrive through. The module imports
`createInMemoryRepository` and nothing under `caring-contacts/db/**`. `applyDemoSeed` is exported so
its idempotency can be tested against a real store, and that export is closed off by a module-private
`WeakSet` of the stores this module built: handed anything else it throws `DemoSeedForeignStoreError`
before reading or writing anything.

Store selection is unchanged. `buildStore()` reaches the seed only inside `if (!url)`; when
`CARING_CONTACTS_DATABASE_URL` is set, `createPostgresRepository` is chosen and the seed module is
never called. `tests/caring-contacts-demo-seed.test.ts` spies on the real seed and fails if the
Postgres branch ever calls it.

**The production boundary is checked in the same place, which round 1 found it was not.** The gate
originally sat only at the constructor, and in a production process the store handed back is one this
module built — built and left empty — so it was already inside the `WeakSet` and `applyDemoSeed` would
have populated it. The check is now inside `applyDemoSeed` too, where the writes are, and a case pins
it by seeding through the exported function against exactly that store.

**2. It is not a privileged back door.** Every write goes through the contract. The consequence is
the point rather than a formality: the pathway version's dual approval is a governance record the
**domain** produced. `applyPathwayVersionTransition` checked that two distinct roles were recorded by
two distinct people, neither of them the author, and refused anything else. A version written
straight into the Map would have had the same shape and none of that meaning.

A refused write is treated as a finding, not an obstacle: `DemoSeedRefusedError` names the step and
the domain's own machine-readable reason and stops the seed. A partly-populated store that looked
whole would be the worse outcome. Nothing was refused in practice — see "Findings".

**3. It authors no patient-visible wording.** `messageTextByType.standard` is
`EXACT_PATIENT_VISIBLE_MESSAGE` from the sealed domain's `message-copy`, the one provisional message
that exists and the only one reviewed. `first` and `closing` are **empty strings**, and nothing
anywhere refused them — not the store, not the wizard, not any schema. An empty entry is the truthful
representation of "not yet written".

The closing slot was deliberately left empty rather than filled with the standard message.
`message-rules` requires a final message to say that it is the final message in the programme, so a
closing message that did not say so would tell someone in a suicide-prevention programme that contact
continues when it has ended. The owner deferred that wording to the lived-experience representative.

**Idempotency** has two independent guards. `applyDemoSeed` returns without writing when the store
already holds a pathway version; and every key is fixed (`demo-seed-plan-create-rowan`, and so on)
rather than derived, so a racing second call replays through the store's own contract and performs no
second change. Above both of those, `caringContactsStore()` memoises on `globalThis`, so under
`next dev` the seed runs once per process however many times the store is asked for.

**Names and numbers.** Every mobile number is one of the reserved fictional numbers that stand for a
patient's own mobile (`DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS`). There are fewer of those than
there are seeded plans, so one is used more than once — reusing a reserved non-connecting number is
the safe outcome, and inventing a number-shaped string would not have been.

Every name follows the surname convention the fixtures in this tree already use — `Rowan Sample`,
`Mira Example` — and the surname is what makes it unmistakably invented. The given names are new;
only the convention is borrowed. (Round 1 corrected this claim in the code and left it standing here,
where it had cited `Rowan Example` as precedent when that is the seed's own patient. Round 2 caught
the report contradicting the comment it had been corrected into.)

## Findings

**F1 — The isolated Playwright server is not seeded by default, and this is the one decision here
that the brief and the existing browser gate pull in opposite directions on.**

The brief asks the seed to make it possible for a browser test to reach a wizard stage. The isolated
Playwright server is a production build with `PLAYWRIGHT_OFFLINE_MODE=true` and
`NEXT_PUBLIC_DEMO_MODE=true` (`scripts/run-playwright.mjs`), which is the one place
`isCaringContactsDemoEnabled()` is true inside a production build — so seeding on that predicate alone
would have populated it.

That would have broken a contract that is currently proven rather than assumed.
`tests/ui-caring-contacts-workspace.spec.ts` observes, end to end, that an empty caseload is served as
a **page** rather than as a missing resource, and that the empty state says in words which of the
three facts it is. A seeded server never renders "No patients yet" again, and the observation is
simply gone.

So the seed is excluded there unless asked, by `CARING_CONTACTS_DEMO_SEED=on`. Development is seeded;
the browser gate is unchanged and still green on its own terms.

**This is a real trade and the owner may want it the other way.** The switch is process-wide, not
per-test, so a future wizard journey cannot simply turn it on for one spec: it needs either a second
server or a decision about what the empty-caseload spec should assert once the workspace is normally
populated. That decision is not an implementer's to make, which is why it is here rather than in the
diff.

**F2 — No screen lists referrals, so the wizard's entry point is a URL a person has to know.**

`plans/new` takes `?referral=<id>` and validates it against the referrals the actor can list. Nothing
links to it with an id. The seed therefore publishes a stable one,
`DEMO_SEED_UNSTARTED_REFERRAL_ID` (`demo-seed-referral-wren`), and the wizard is reachable at
`/caring-contacts/plans/new?referral=demo-seed-referral-wren`. That is a workaround for a missing
screen, not a substitute for one: a coordinator with no referral list still cannot find their way in.

**F3 — The seed records a governance approval that no person gave, and stage 2 shows it. Fixed in
round 1; recorded here because the original report got both the timing and the mitigation wrong.**

I filed this as a risk for when the templates library arrives. It was already on a screen:
`plans/new/page.tsx` resolves `version.approvals` through `PATHWAY_APPROVAL_ROLE_WORDING` and
`plan-wizard.tsx` prints `Approved by {…}` at **stage 2**, so a coordinator choosing a pathway read
an unqualified _"Approved by the clinical programme lead and the lived-experience representative"_
for an approval nobody gave. And the mitigation I claimed — that every actor id is `demo-` prefixed —
never reaches the viewer at all: the screen renders role wording, never actor ids.

The fix is Ruling [126] applied directly, not a new decision: **the record carries the provenance**,
so a screen can say the approval is invented without having to know a seed exists.
`PathwayVersionSnapshot.provenance` is optional, and the only claim it can make is a weakening one —
it can say an approval is synthetic, never that one is genuine, and absence asserts nothing. Stage 2
prints the wording on its own line inside the option's `aria-describedby` region, so it is heard with
the option rather than after it. The approval is **not** hidden: a demonstration that cannot show a
governed pathway shows nothing.

Two things worth knowing about the placement. It lives in the snapshot because `savePathwayVersion`
rebuilds every governance field server-side whatever the caller sends, and copies the snapshot
verbatim — the snapshot is the only channel an author may state anything through, and a top-level
field would have needed a Postgres column and a migration. And the in-memory store's
`clonePathwayVersion` enumerated the snapshot's fields, so the marker was silently dropped on the
way out until that copy was changed to spread; mutation R6 below is that line's proof. The Postgres
store persists the snapshot as JSONB, so it round-trips there by construction.

**F4 — `culturalIdentity` is recorded as "Not stated" for every seeded patient.** A cultural identity
attributed to an invented person is an invention about culture. "Not stated" is a value already used
in this tree and is what the record honestly holds. If a demo needs to exercise that field with
content, that content should come from the owner.

**F5 — Every seeded plan discharges at the instant the seed runs**, so every contact on it is still
in the future and none is a past-dated message that was never sent. Dispatch is not simulated: nothing in the
demo has been sent, which is true of this prototype generally.

**F6 — `npm run lint` is already red on this branch, for something outside this task.**

`tests/caring-contacts-empty-state.dom.test.tsx` raises two
`@next/next/no-html-link-for-pages` errors (lines 32 and 93: `<a href>` to `/caring-contacts/patients/new/`
and `/caring-contacts/patients/`). That file is byte-identical to my branch base and my diff touches
no route, so this is pre-existing rather than caused here. I have deliberately not fixed it — it
belongs to another task's file and fixing it unasked would put an unrelated change in this diff — but
it will block CI on the branch, so somebody has to.

**F7 — One snapshot, three patients, and a greeting that names one of them. RULED, round 2.**

`EXACT_PATIENT_VISIBLE_MESSAGE` hardcodes "Hi Rowan, …", and the seed applies that one approved
snapshot to Mira's and Ari's plans too. I recorded it rather than choosing, and framed it as two
options: either the greeting is not governed content, or a version cannot be shared across patients.

**The ruling is that neither option is the answer, because of what the artefact is.**
`EXACT_PATIENT_VISIBLE_MESSAGE` is a **specimen, not a template** — one specific approved example,
greeting and sender name and all, measured at **252 septets against a hard two-segment ceiling with
no room left**. It has no name slot and cannot acquire one: a greeting that varies with the patient
makes the segment count vary with it, so the single measured safety fact about this message silently
assumes a five-letter name.

So **the seed is correct to store the specimen verbatim, and no screen may present it as this
patient's message.** It is the approved example message for this pathway version, and clinician-facing
screens name it that way. That keeps the frozen-copy rule intact, keeps the septet evidence meaningful,
and needs nothing from the owner.

**Nothing changed here for it.** No message text and no screen wording was touched — the ruling is
recorded so the templates task inherits it rather than rediscovering it. Whether the real product
personalises a greeting is a Phase 3 product question carrying both a schema and a message-length
consequence, and the controller has flagged it as one.

## What a browser test would now need to do to reach stage 4

**The owner's resolution of F1 is a second Playwright server, not moving the assertion.** The
empty-caseload observation is an HTTP-level fact — served as a page rather than as a missing resource
— which a DOM test cannot make, and it is a real production state: a newly onboarded team has no
patients on day one. Moving it loses the evidence.

**That second server is a separate task and is not built here.** What it needs: `run-playwright.mjs`
owns the server, so it is a second instance on a second port, reusing the same isolated build, with
`CARING_CONTACTS_DEMO_SEED=on` in its environment, plus a Playwright project with its own `baseURL`
pointing at it — so the existing empty-caseload project keeps its own unseeded server and its
assertions stay exactly as they are. The journey below then belongs to that project alone.

With such a server:

1. Go to `/caring-contacts/plans/new?referral=demo-seed-referral-wren`. The referral is accepted and
   has no plan, so the page renders the wizard rather than a `PlanStartStateNotice`.
2. **Stage 1, Agreement.** Tick both checkboxes inside the "Assurances you are confirming" fieldset —
   the patient agreed, and the mobile is the patient's own. The primary control
   ("Continue to pathway") is `disabled` until both are ticked.
3. **Stage 2, Pathway.** Choose the one option. This is the stage that was impossible before: the
   page offers only versions whose state is `approved`, and there were none. There is now exactly
   one, published, showing its cadence and both approving roles. Then "Continue to personalisation".
4. **Stage 3, Personalisation.** Fill the patient's name, the mobile number
   (`+61 491 570 006` or `+61 491 570 156` — the wizard states these in place and refuses neither),
   and any other identifiers, then choose a send time from the "When in the day messages go out"
   radio group. Then "Continue to review and activation".
5. **Stage 4, Review and activation.** Supply the discharge day the stage collects, then use the
   activation control. It POSTs `/api/caring-contacts/plans` and then activates the created plan.

Note for whoever writes it: the wizard is this workspace's only Client Component and keeps its draft
in tab storage, so a test that re-enters the route mid-flow resumes rather than restarts. And the new
plan is created for `demo-seed-patient-wren`, who has no other plan — running the journey twice
against one server will be refused by `duplicateActivePlan` the second time, correctly.

## Effect on existing tests

Checked rather than assumed. Every other suite that touches `caringContactsStore()`
(`caring-contacts-api-handler`, `-plan-activation`, `-page-access-audit`, `-new-plan-page.dom`,
`-patient-overview.dom`, `-patients-page.dom`) replaces it with `vi.mock`, so none of them sees the
seed at all. The one suite that exercises the real function,
`tests/caring-contacts-server-store.test.ts`, asserts store selection, memoisation and a service stop
— all unaffected by the store having content.

The offline suites are therefore unaffected, and the browser gate is unaffected because of F1.

## Files

Listed in full, because a seed task reaching into the sealed domain and a shared client component is
exactly what a later reader needs to see and what a three-line list hid.

**Sealed domain** (`src/lib/caring-contacts/`)

- `pathway-versions.ts` — `PathwayVersionSnapshot.provenance` (optional), `PathwayVersionProvenance`,
  `PATHWAY_VERSION_PROVENANCE_WORDING`, and `pathwayVersionProvenanceWording`, the resolver whose
  fallback keeps the qualifier for a value this build does not recognise.
- `in-memory-repository.ts` — `clonePathwayVersion` now spreads the snapshot instead of naming its
  fields, which is what stopped the marker being dropped on the way out.

**Server seam** (`src/lib/caring-contacts-server/`)

- `demo-seed.ts` — new. The population, both boundaries, and the idempotency guards.
- `store.ts` — the in-memory branch builds the seeded store; the Postgres branch is untouched.

**Screens**

- `src/app/caring-contacts/plans/new/page.tsx` — resolves a version's provenance to words beside the
  role wording, on the server.
- `src/components/caring-contacts/workspace/plan-wizard/plan-wizard.tsx` — **shared client
  component.** `PlanWizardPathwayOption.provenanceNote`, the stage-2 line that renders it, and
  `PATHWAY_PROVENANCE_TESTID`.

**Tests**

- `tests/caring-contacts-demo-seed.test.ts` — new; the seed's own suite.
- `tests/caring-contacts-pathway-versions.test.ts` — the resolver's fallback.
- `tests/caring-contacts-new-plan-page.dom.test.tsx` — the page's provenance join, including a value
  outside the union.
- `tests/caring-contacts-plan-wizard.dom.test.tsx` — stage 2 states it, says nothing extra without
  it, and the strengthened first-choice case.
- `tests/helpers/caring-contacts-repository-contract.ts` — the shared two-store contract for
  `snapshot.provenance`, both directions: present survives the round trip, absent stays absent.
  **It needs a real database, so it did not run in any gate above and is unproven here.** It is
  written anyway because the case existing is what catches the next enumerating copy — the in-memory
  store dropped this exact field once already, through a copy that named the fields it knew about and
  left every existing case green.
- `tests/ui-caring-contacts-workspace.spec.ts` — comment only, correcting why that server is empty.

**Build**

- `package.json` — `tests/caring-contacts-demo-seed.test.ts` added to `test:cc-guards`, so the task
  gate carries the task's own suite.

## Gate evidence

### Mutation proofs

Round 1's report claimed one uncovered assertion. That was wrong: mapping nine mutations onto
fourteen cases left **seven** carrying none, including the case holding the brief's own
"production must never fall back to synthetic content" constraint and the closed-vocabulary scan.
The table below is the corrected position, re-run in full against the file as it now stands (16
cases here, plus three in the two screen suites) so no row describes an earlier version of it.

Each mutation is applied one at a time in process — never through a shell, since the MSYS2 runtime
re-parses argv and a `grep -c` presence check silently returns 0 for a mutation that is demonstrably
present, `-F` included — read back in process, and the tree restored from git afterwards. **The
per-row pass/fail count is the evidence that a mutation isolated one assertion rather than making a
case red**, so it is stated per row rather than once for the set.

| #   | Mutation                                                | Predicted                                          | Observed                                                                                                                                                                                                                     | Counts               |
| --- | ------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| M1  | the Postgres branch calls the seed                      | the spy assertion fails                            | `expected "vi.fn()" to not be called at all, but actually been called 1 times`                                                                                                                                               | 1 failed / 15 passed |
| M2  | the `WeakSet` guard is removed                          | no `DemoSeedForeignStoreError`                     | `expected TypeError: store.listPathwayVersions is n… to be an instance of DemoSeedForeignStoreError`                                                                                                                         | 1 failed / 15 passed |
| M3  | the standard message is copied into the closing slot    | closing is no longer empty                         | `expected 'Hi Rowan, Alex from Example Aftercare…' to be ''`                                                                                                                                                                 | 1 failed / 15 passed |
| M8  | the standard message is blanked                         | standard is empty                                  | `expected '' to be 'Hi Rowan, Alex from Example Aftercare…'`                                                                                                                                                                 | 1 failed / 15 passed |
| R4  | the unauthored **first** message is filled in           | first is no longer empty                           | `expected 'Hi Rowan, Alex from Example Aftercare…' to be ''`                                                                                                                                                                 | 1 failed / 15 passed |
| M4a | the already-seeded return reports a population          | `populated` is true on the second call             | `expected true to be false`                                                                                                                                                                                                  | 1 failed / 15 passed |
| M4b | the already-seeded guard is removed entirely            | the second call re-writes and is refused           | `DemoSeedRefusedError: The Caring Contacts demo seed was refused at createPlan:rowan: idempotency-key-reused-for-a-different-write`                                                                                          | 1 failed / 15 passed |
| M5  | a seeded mobile number is not a reserved one            | an unreserved number is present                    | `expected [ Array(2) ] to include '+61 400 000 000'`                                                                                                                                                                         | 1 failed / 15 passed |
| M6  | the isolated Playwright exclusion is removed            | that server holds a population unasked             | `expected [ … ] to have a length of +0 but got 3`                                                                                                                                                                            | 1 failed / 15 passed |
| M9  | the cadence labels are typed out instead of derived     | the lists differ                                   | `expected [ 'Day 1' ] to deeply equal [ 'Day 1', 'Week 1', 'Month 1', …(7) ]`                                                                                                                                                | 1 failed / 15 passed |
| R1  | the demo predicate is dropped from `demoSeedRequested`  | the **production-empty** case fails                | `expected [ … ] to have a length of +0 but got 3`                                                                                                                                                                            | 2 failed / 14 passed |
| R2  | the production gate is removed from `applyDemoSeed`     | the I1 case fails                                  | `expected true to be false`                                                                                                                                                                                                  | 1 failed / 15 passed |
| R3  | a seeded value uses closed vocabulary                   | the **vocabulary scan** fails                      | `expected 'Safe' not to match /\bhigh risk\b\|\bsafe\b\|…/i`                                                                                                                                                                 | 1 failed / 15 passed |
| R5  | the seed stops marking its version as invented          | the record claims nothing                          | `expected undefined to be 'syntheticDemonstration'`                                                                                                                                                                          | 1 failed / 15 passed |
| R6  | the store's snapshot copy enumerates its fields again   | the marker is dropped on the way out               | `expected undefined to be 'syntheticDemonstration'`                                                                                                                                                                          | 1 failed / 15 passed |
| R7  | the page stops carrying provenance to the wizard        | the join case fails                                | `expected null to be 'Invented for demonstration: no person…'`                                                                                                                                                               | 1 failed / 12 passed |
| R8  | stage 2 stops printing the provenance                   | the note is not on the screen                      | `TestingLibraryElementError: Unable to find an element with the text: Invented for demonstration: no person recorded either approval.`                                                                                       | 1 failed / 71 passed |
| N1  | the wizard's referral is left un-accepted               | the wizard-referral case fails                     | `expected 'awaitingHandover' to be 'accepted'`                                                                                                                                                                               | 1 failed / 15 passed |
| N2  | the store's memoisation is removed                      | the in-memory-branch case fails                    | `expected { …(39) } to be { …(39) }`                                                                                                                                                                                         | 1 failed / 15 passed |
| N3  | stage 2 prints a provenance line for **every** version  | the negative wizard case fails                     | **survived at first — see below**                                                                                                                                                                                            | see below            |
| P1  | an unrecognised provenance resolves to no claim         | the resolver and the page both lose the qualifier  | `AssertionError: an unrecognised provenance (trainingCopy) lost its qualifier: expected null to be 'Invented for demonstration: no person…'`, and on the page `expected null to be 'Invented for demonstration: no person…'` | 2 failed / 22 passed |
| P2  | the wizard's referral-named-no-pathway guard is removed | the first-choice case fails on the group **count** | `AssertionError: expected [ …(2) ] to have a length of 1 but got 2`                                                                                                                                                          | 1 failed / 71 passed |

**R1 fails two cases rather than one, and that is correct**: dropping the demo predicate populates
both the production store and the one `applyDemoSeed` is handed, which are two different guards on
the same fact. It is listed as 2/14 rather than presented as an isolation.

**N3 survived, and the test was wrong rather than the mutation.** Removing the `=== null` condition
renders the paragraph for every option — and a null note renders as an _empty_ paragraph, so a case
asserting the wording is absent passed against a screen that had gained an element per version. The
negative case asserted on text where the condition controls an element. It now asserts on a stable
handle, and N3 dies against the strengthened test: `2 failed / 70 passed`, on
`expected [ <p …(2)></p> ] to have a length of +0 but got 1` — the empty paragraph the earlier
assertion could not see.

This one is worth more than its row. It is the only mutation in three rounds that survived, and what
it caught was a test that read as a guarantee and was not one — the same defect class as I4, found the
same way. A mutation round that produces no survivors has told you less than one that produces a
single well-chosen one.

**The vacuity pair — round 1 finding I4.** Two assertions had been rewritten _after_ their mutation
into `expect(x).toHaveLength(plans.length)`, which on an empty store is `0 === 0`; the reserved-number
loop beneath one of them then iterated nothing, so the case existing to prove no unreserved number was
ever written could go green having checked no number at all. One source mutation, run twice, is what
demonstrates that:

|     | Mutation                                      | Result                                                                                                                                                               |
| --- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | the seed creates no plans, **guards present** | 6 failed / 10 passed — including `names every patient in the caseload` and `uses only the reserved fictional numbers`, both `expected [] to not have a length of +0` |
| V2  | the same empty seed, **guards removed**       | 4 failed / 12 passed — **those two cases drop out of the failure list**, i.e. they pass on a seed that produced nothing                                              |

The counts column below uses `N failed / M passed` rather than a pipe. Two rows had rendered as six
cells in a five-column table: the cell held an escaped pipe, and Prettier's column padding separated
the backslash from the pipe, at which point it stopped escaping. Both were rows whose text had been
lengthened, so a reformat moved the padding. This column is the evidence that a mutation isolated one
assertion rather than making a case red, and evidence that does not render is not evidence — so it
now uses a character no reformat can un-escape.

**P1 is the round-2 blocking defect's proof, and what made that defect invisible is the point.** The
call-site lookup returned `undefined` — not `null` — for a provenance outside the union, so the
wizard's `=== null` test was false and stage 2 rendered an empty qualifier while "Approved by the
clinical programme lead and the lived-experience representative" stood unqualified. No fixture and no
writer produces such a value; it can only arrive through the Postgres reader's unchecked cast. A suite
does not notice a defect reachable only by a value none of its fixtures can express, which is why the
fixtures now cast exactly where the store casts.

**P2 supplemented two assertions that could not fail — it did not replace them.** Both `queryByRole`
lines are still in the case, with the group count added ahead of them: they are correct as far as they
go, and they name two specific headings that would be lost by deleting them. What they could not do
is fail. Removing the component's guard renders a _third_ panel — "Accepting this referral named
null …" — whose accessible name matches neither regex, so the case passed against a screen stating a
decision about a referral that named nothing. Counting the groups the stage is entitled to is what
pins the branch, and P2's observed message is that count rather than a missing heading.

**What still carries no mutation, stated exactly.** One case in the seed suite: _"approved by two
different people through the domain's own transition"_. It cannot be falsified by mutating the seed,
because the domain refuses the mutation — recording both approvals under one actor is
`pathway-approval-actor-already-recorded` and the seed stops. A test able to falsify it would have to
weaken `applyPathwayVersionTransition`, which is worse than the gap. Every other case in the seed
suite and in both screen suites is covered above.

### Gates

Every run below used `GATE_RECEIPTS=refresh`, so none is a restored-tree receipt exiting 0 with no
summary line. Lease contention was severe: another worktree held the exclusive lease almost
continuously, and two of my runs were killed while queued rather than refused — the failure mode the
updated standing discipline documents, where a queued run blocks inside the child process with no
refusal to retry around. Every refusal was retried and none was forced past. **Nothing below is
reported from an exit code**; each line is the run's own summary.

- `npm run typecheck` — clean. It **caught a real error in each round**, both times on a case added
  after an earlier typecheck had already passed. Round 1: `loadPage` types the rendered props as
  `unknown`, so destructuring them did not compile — narrowed structurally to the one field under
  test. Round 2: widening the fixture's `provenance` parameter is not enough, because the value has
  to enter a strictly typed snapshot field — the fixture now casts in the same place the Postgres
  reader does, which is also the more honest reproduction of the defect.

  Both are the same mistake: verifying, then adding, then not re-verifying. I first drew the rule as
  "run the gate last", and that is only half of it — "last" prevents nothing unless nothing is added
  afterwards, which is exactly the assumption that failed both times. **The mechanism is re-verifying
  after the final edit**, whenever that edit lands, and it is the rule this task ends on.

- `npm run lint` — `2 problems (2 errors, 0 warnings)`, both in
  `tests/caring-contacts-empty-state.dom.test.tsx`, which is untouched by this branch. The reviewer
  has established these were a stale eslint cache masking a real error, already fixed on another
  branch; nothing here to do. **No error in any file this task adds or changes.**
- `npm run test:cc-guards` — the task gate, re-run **after the last edit of round 3**:
  `Test Files  20 passed (20)` / `Tests  421 passed (421)`. Twenty rather than the original eighteen
  because the gate had not been carrying either of this task's own suites: the seed suite joined in
  round 2 and `caring-contacts-pathway-versions` — which holds the fallback's direct proof, including
  `"constructor"`, `"toString"` and `"__proto__"` — in round 3. It also covers both screen suites this work changed (`-plan-wizard.dom`,
  `-new-plan-page.dom`) and the vocabulary, workspace-screens and route-reachability scans a diff
  cannot contain.
- `tests/caring-contacts-demo-seed.test.ts`, run alone after the round-1 restore before it joined the
  gate: `Test Files  1 passed (1)` / `Tests  16 passed (16)`.
- `npm run test`, the full offline suite — run **before** the standing discipline was updated to
  reserve it for the controller at the merge point. Its last result was
  `Test Files 1 failed / 835 passed | 3 skipped (839)` / `Tests 1 failed / 10205 passed | 74 skipped`,
  and that single failure is the contamination described immediately below, now fixed. **I have not
  re-run it**, per the updated discipline reserving it for the controller at the merge point; the two
  runs above are the evidence for the fix, and the controller's merge-point run is what should
  confirm nothing crosses files.

**A mutation was committed by mistake, and the full suite is what caught it.** `git add -A` run while
the round-3 driver held the tree captured N1 — the wizard's referral left `awaitingHandover` — into
commit `c6c5ed535`. That is not a cosmetic slip: `DEMO_SEED_UNSTARTED_REFERRAL_ID` is the demo's only
entry point into the wizard, so with it committed the sign-up could not be started at all. Restored in
`c61cf12b9`, and every other mutation site was then audited individually and is clean: the store's
`??=` memoisation, the wizard's `=== null` condition, `CULTURAL_IDENTITY_NOT_STATED`, all three message
slots, the `provenance` line, the clone's spread, the demo predicate, and the production gate.

The rule this breaks is one the brief already states — commit before mutating, and do not let a driver
and a commit hold the tree at once — and I broke the second half of it. Recorded rather than tidied
away, because the mutation ledger and the commit history are the only places it would show.

**Not run, and why.** Whole-tree `npm run format` — Prettier was run over every changed file and they
are clean, but the repository-wide check the pre-push guard performs was not, and this task does not
push. `npm run verify:ui` — the browser gate's inputs are deliberately unchanged (F1), and no route,
chrome or shared style changed; the stage-2 line added here is proved in the DOM suite. No
provider-backed gate was run or needed.

**`STANDING-DISCIPLINE.md` is the controller's and the controller has committed it** (`81a20f2d5`,
updated at `fc8b8e1bb`). An earlier draft of this report said it sat uncommitted in the worktree and
that I had left it alone; that was true when written and is not now.

## Round 3

Small, and two of the five were claims that were simply false.

**The naming assurance was wrong, in the code as well as the report — and it was wrong twice.**
Round 1 wrote "the given names below are new"; round 2 aligned the report to that comment rather than
checking either. Checked at the merge base this time, per name:

| Seeded name     | Where it already existed at the merge base                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------- |
| `Mira Example`  | verbatim, in the mockup fixtures (`caring-contacts/mockups/fixtures.ts`, `care-plan/mockups/fixtures.ts`)             |
| `Rowan Example` | verbatim, in this workspace's own test fixtures (`caring-contacts-plan-draft.dom`, `-plan-activation`)                |
| `Ari Sample`    | the one new **pairing** — `Ari` from `Ari Placeholder` in the care-plan mockup fixtures, `Sample` from `Rowan Sample` |

So not one given name is new, and neither surname is. The honest statement is that nothing was drawn
from outside this repository's existing synthetic vocabulary, and the two surnames — `Sample` and
`Example` — are what make the names unmistakably not a real person's. That is now written per name in
`demo-seed.ts` rather than summarised, because a summary is what was wrong twice.

Worth more than its size, and the reason it is spelled out: that comment exists to tell a later reader
that no real person's name is in the seed. A sentence that is wrong about where the names came from
undermines the one assurance it was written to give. (`wren` and `nima` are identifiers, never names —
those two referrals carry no plan and so store no patient detail. The comment now says so, because
they read like names.)

**A comment went stale in the same round that changed the mechanism.** `plan-wizard.tsx` still said
the page resolves through `PATHWAY_VERSION_PROVENANCE_WORDING`; it resolves through
`pathwayVersionProvenanceWording`. The page's own comment was updated and this one was not. I then
swept every doc comment in the files this work touches rather than grepping the phrase — the only
remaining references to the map are inside the resolver's own docstring, where quoting the unsafe
call-site spelling is deliberate.

**`tests/caring-contacts-pathway-versions.test.ts` is now in `test:cc-guards`.** It holds the direct
proof of the fallback, including `"constructor"`, `"toString"` and `"__proto__"` — the cases nobody
will think to re-derive. The branch was already covered end to end by the gate-carried page case, so
this was a gap rather than a hole.

**Two report corrections.** P2 supplemented rather than replaced (both `queryByRole` lines are still
there). And two table rows rendered as six cells in a five-column table — see the note above the
mutation table; the counts column no longer contains a pipe at all.

**On reporting commit identifiers.** I reported `4c1a5ff96` for the cast fix; no such object exists —
the commit is `856f1fd7e`, after an amend. The check is one command, `git cat-file -e <sha>^{commit}`,
and every SHA in this round's hand-back was run through it.
