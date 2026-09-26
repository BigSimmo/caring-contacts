# Task 5b report — the names-only patient projection

**Branch** `claude/browser-test-gate-handoff-d5c1db`, base `e3d1fa6f3`.

**Commits** — `85fb6db90` (storage contract + both stores + shared contract suite),
`3450ebcb8` (the Patients directory and its page consuming it),
`897a49fa0` (one test assertion tightened after mutation M7 exposed it),
`c6cd1ede8` (this report), `6f2a9d3ae` (**review round 1**: I-1, I-2, I-3, the role notice, and
the four minors).

**Review round 1 is addressed in `6f2a9d3ae`.** The two findings the coordinator weighted heaviest
came back clean and are unchanged. What follows records what moved.

Status: **complete**. Both stores implement the read, the shared contract holds them to it, the
directory names its rows from it, and `getEpisode` is still never called from this screen with its
spy untouched.

---

## What was built

### `listPatientNames`, on the shared storage contract

`src/lib/caring-contacts/repository.ts` declares:

```ts
export type PatientNameProjection = { planId: PlanId; patientName: string };
listPatientNames(context: ReadContext): Promise<PatientNameProjection[]>;
```

**The shape, and why it is this one.** The brief named three defensible options. This is a plan-keyed
list, chosen for three separate reasons rather than one:

- **Two fields, declared as their own type.** Not a `Pick` of `Episode`, not a `PlanRecord` with the
  other fields blanked. A shape that _could_ hold a mobile number, an identifier list or a cultural
  identity is one edit away from doing so, and it would typecheck, pass every existing test, and
  still be called a names projection. `PATIENT_NAME_PROJECTION_RELEASES_ONLY_THE_NAME` pins the key
  set at compile time, so widening it stops the build rather than passing review.
- **Keyed by plan, not by patient.** The patient detail is held per plan and `markRetentionCleared`
  clears it per plan, so one patient's two episodes can honestly differ — one cleared, one not. A
  patient-keyed map would need an invented rule for which wins. Plan-keyed joins 1:1 onto `listPlans`,
  which is what a caseload renders.
- **A list, not a per-plan lookup.** A caseload costs one round trip rather than one per row, and —
  the part that matters — **this read never takes a plan id at all**, so it cannot become the oracle
  that distinguishes "no such plan" from "another team's plan". A per-plan lookup would have had to
  answer for an id the caller supplied; `getPlan` returns `null` for both cases deliberately, and
  nothing added here weakens that.

**The capability.** Ruling 95 as written: `READ_ACTIONS.patientName` is the **existing**
`viewPatientRecord`. No new action was minted, so `permissions.ts`'s exhaustiveness guard is
untouched and no role's grant had to be decided.

**One thing the ruling did not settle, decided here and flagged for you.**
`PATIENT_NAME_READ_ACTIONS` requires **both** `viewPatientRecord` and `READ_ACTIONS.plan`
(`viewReferral`). Gating on `viewPatientRecord` alone would have been a **widening**, not a
narrowing: three roles hold `viewPatientRecord` without `viewReferral` — **auditor**,
**clinicalProgrammeLead** and **livedExperienceRepresentative** (corrected after fix round 1, finding
M-8; this paragraph first named the auditor as the only one). Taking the auditor as the worked
example: today it gets
`[]` from `listPlans` and `null` from `getEpisode` and can obtain no patient's name by any route at
all. A names read on the name capability alone would have handed that role every name the team holds
— from the one change whose whole purpose is to release less. The extra requirement decides the
read's **scope** (it enumerates plans, so it releases a name only for a plan the actor could have
listed — the same "scoped through the plan" rule `listContacts` already follows), not its capability.
No action was minted and the name still travels on `viewPatientRecord` exactly as ruled. **If you
read Ruling 95 as forbidding this too, say so and it comes out in one line** — the contract test that
pins it names the auditor explicitly.

### Both stores

- `in-memory-repository.ts` filters by the same predicate `listPlans` uses, plus the name capability,
  and **builds** the two-field objects rather than deriving them from the stored plan, so no widening
  can ride along in a spread.
- `db/postgres-repository.ts` goes through **`runRead`**, which is what emits
  `set_config('caring_contacts.team_id', …)` and `set local role caring_contacts_app`. Mutation M1
  below removed exactly that and the contract went red on a cross-team read — a `TEAM-SOUTH`
  coordinator saw `TEAM-NORTH`'s patient name. The query names two columns rather than reusing
  `PLAN_COLUMNS`, so **this read** never fetches the mobile number or the identifier list into the
  process at all; the narrowing is in the SQL, not only in the mapping afterwards. It says nothing
  about the page as a whole: `listPlans` still selects `PLAN_COLUMNS` verbatim, which does carry
  `patient_mobile_number` and `patient_identifiers`, on every caseload render. Narrowing that list is
  a separate change and is filed rather than attempted here. (Qualified after fix round 1, finding
  I-1.)

New behaviour lives in `tests/helpers/caring-contacts-repository-contract.ts` — the shared suite both
stores run — not in either store's own file.

### The Patients directory

- Rows are headed by the patient's **name**, with the synthetic identifier kept **beside** it on its
  own line. Two patients can share a name, and the row's detail control is still named
  `The patient record for <synthetic id>`, so its accessible name is unchanged and one row's control
  is still distinguishable from the next.
- When no name comes back — a de-identified episode, or a role that may list plans without holding
  `viewPatientRecord` — the row falls back to the synthetic identifier **and the label above the
  heading says which of the two it is**. The row never presents an identifier as a name. It
  deliberately does not guess _which_ cause applies; the screen is not told.
- An empty name (what both stores write for a cleared one) is treated as "no name held", never as a
  name, and never as a blank heading.
- **Search matches the name as well as the three identifiers**, and stays entirely server-side: still
  an ordinary `method="get"` form, still no client state, still a URL. The screen adds no client
  component. Ruling 13 is untouched.
- The page performs its own audited read for the names, with its own access identity,
  `{ search, patientName, "all" }`, deliberately not folded into the plans read: this is the read on
  the page that releases patient identity, and a trail that recorded it as part of a plan search
  could not later answer _who read patients' names, and when_. It fails closed as every read on the
  page does.

  **Corrected after fix round 1.** This paragraph first named the identity
  `{ search, patientDirectory, "names" }`. Round 1 replaced it with a new `AccessedObjectType`
  member, `"patientName"`, because `patientDirectory` already carries two referral reads and the
  trail's query surface filters on `objectType` with no `objectId` filter — so the distinction was
  visible by eye and unaskable. The re-review found this sentence still asserting the superseded
  identity in the present tense, 160 lines above the round-1 section that records the change; the
  document asserted a fact and its contradiction at once, which is the same shape as finding I-2
  reproduced in the artifact instead of the code.

- `getEpisode` is still never called, and the spy pinning its absence was not weakened — a new test
  asserts the name renders **and** `getEpisode` was not called, in the same test.

---

## Mutation ledger

Every attempt, including the one that did not go red. Each mutation was applied with an editor,
**proved present with `git diff` before the test was run**, and the test was run as its **own
command** — never chained to the presence check, so a zero grep count could not short-circuit the
run. Reverted after each.

| #   | Mutation                                                                                                                                                       | File                        | Covering test                                                                                                               | Result                                                                                                                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | `runRead(...)` → `pool.withConnection(...)` — removes the RLS preamble                                                                                         | `db/postgres-repository.ts` | contract: _"gives an actor from another team the same empty answer an empty store gives"_                                   | **RED** — `expected [ { planId: 'PLAN-1', … } ] to deeply equal []`. A `TEAM-SOUTH` coordinator read `TEAM-NORTH`'s name.                                                                                                                                   |
| M2  | capability guard made unfireable (`!x` → `x === undefined`)                                                                                                    | `db/postgres-repository.ts` | contract: _"is empty, never a refusal, for a role that may not list plans"_                                                 | **RED** — same assertion shape, auditor received the row.                                                                                                                                                                                                   |
| M3  | `PATIENT_NAME_READ_ACTIONS` reduced to the name capability alone                                                                                               | `repository.ts`             | contract, same test                                                                                                         | **RED** — but on the _constant_ assertion (`expected [ 'viewPatientRecord' ] to include 'viewReferral'`), which aborts the test before the behavioural line. M4 is what proves the behavioural path. Recorded rather than presented as stronger than it is. |
| M4  | `mayReadAll` → `mayReadAny`                                                                                                                                    | `in-memory-repository.ts`   | contract, same test                                                                                                         | **RED** on the behavioural assertion — auditor received the row.                                                                                                                                                                                            |
| M5  | projection maps `patientMobileNumber` into `patientName`                                                                                                       | `in-memory-repository.ts`   | contract: _"releases the patient's name…"_ and _"holds no name for a plan a retention clearance has already de-identified"_ | **RED** ×2 — `expected '+61 491 570 156' to be 'Jordan Nguyen'`.                                                                                                                                                                                            |
| M6  | drop the `patientName !== ""` filter                                                                                                                           | `patients-directory.tsx`    | DOM: _"treats a de-identified plan's empty name as no name held"_                                                           | **RED** — no heading named `patient-plan-1`; the row headed itself with nothing.                                                                                                                                                                            |
| M7  | delete the row's synthetic-identifier line                                                                                                                     | `patients-directory.tsx`    | DOM: _"heads the row with the patient's name, and keeps the synthetic identifier beside it"_                                | **NOT RED.** 28 passed. The assertion read the **row's whole `textContent`**, which the detail control's own label (`Patient record — patient-plan-1`) satisfies on its own — so the line could be deleted entirely and nothing noticed.                    |
| M7b | same mutation, after the assertion was rewritten to read the line itself (`within(row).getByText(/Synthetic identifier: patient-plan-1/)`, commit `897a49fa0`) | `patients-directory.tsx`    | DOM, same test                                                                                                              | **RED** — `Unable to find an element with the text: /Synthetic identifier: patient-plan-1/`.                                                                                                                                                                |
| M8  | remove `name` from the search haystack                                                                                                                         | `patients-directory.tsx`    | DOM: _"matches the search against the name as well as the identifiers"_                                                     | **RED** — no `listitem`; the name search found nothing.                                                                                                                                                                                                     |
| M9  | names read recorded as `{ search, plan, "all" }` — folded into the plans read                                                                                  | `patients/page.tsx`         | page DOM: _"reads the names through their OWN access identity"_ and the failed-attempt test                                 | **RED** ×2.                                                                                                                                                                                                                                                 |
| M10 | `?? []` instead of throwing on a null release                                                                                                                  | `patients/page.tsx`         | page DOM: _"throws rather than rendering a caseload from a names answer that was never given"_                              | **RED** — `promise resolved … instead of rejecting`.                                                                                                                                                                                                        |
| M11 | add `patientMobileNumber: string` to `PatientNameProjection`                                                                                                   | `repository.ts`             | `typecheck`                                                                                                                 | **RED** at the structural guard — `repository.ts(309,14): error TS2322: Type 'true' is not assignable to type 'never'`, plus both store implementations.                                                                                                    |

**No attempt had an anchor that failed to match**; every mutation above was confirmed in the tree by
`git diff` before its test ran. M7 is the one that did not go red, and it is recorded as a finding
rather than smoothed over: it is exactly the failure the brief named — a mutation that changes the
rendered output but no value any assertion reads.

---

## Gates

Pasted lines, not exit codes.

| Gate                                                            | Evidence                                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `npm run test`                                                  | `Test Files  828 passed \| 3 skipped (831)` / `Tests  9985 passed \| 74 skipped (10059)`    |
| `npm run typecheck`                                             | `[gate-receipts] recorded a pass for "typecheck:internal" (5289 input files)`               |
| `npm run lint`                                                  | `[gate-receipts] recorded a pass for "lint:internal" (5289 input files)`                    |
| `npm run caring-contacts:db:test` (Postgres, docker on `54329`) | `Test Files  2 passed (2)` / `Tests  182 passed (182)`                                      |
| focused: repository contract (in-memory)                        | `Tests  113 passed (113)`, of which `5 passed \| 108 skipped` under `-t "listPatientNames"` |
| focused: directory DOM                                          | `Tests  28 passed (28)`                                                                     |
| focused: page DOM                                               | `Tests  16 passed (16)`                                                                     |

**`tests/gate-receipts.test.ts` did NOT fail here.** The brief predicted exactly 2 environmental
failures in it (file modes, `chmodSync`); the full run came back with zero failures across 831 files.
Confirmed since: they were fixed upstream and that file passes 34 of 34. Any failure there is real
and is no longer to be waved through as environmental.

**One lock refusal, retried rather than reported as red.** A `typecheck` during the mutation pass
returned `DATABASE_HEAVY_RUN_ADMISSION_BUSY` (owner: another worktree running Playwright). That is an
acquisition failure, not a result. The M11 typecheck evidence above was then taken from a direct
`npx tsc -p tsconfig.typecheck.json --noEmit`, a read-only check, and the coordinator-mediated
`npm run typecheck` is the row in the table.

---

## Concerns

1. ~~**The extra `viewReferral` requirement is a judgement call inside Ruling 95's territory.**~~
   **Settled at review** — and it protects more than I claimed. **Three** roles hold
   `viewPatientRecord` without `viewReferral` (auditor, `clinicalProgrammeLead`,
   `livedExperienceRepresentative`), not one. The ALL-of list releases names to exactly the set that
   could already obtain them through `getEpisode`. The note now states that as a property rather
   than citing the auditor alone (M-8).
2. **The row cannot say _why_ it has no name.** "This episode was de-identified" and "your role may
   not see names" arrive at the screen identically — an absent entry. Saying which would require the
   page to compare `listPlans`'s length against `listPatientNames`'s and infer, which is a claim the
   data does not support per row. The row therefore states which kind of thing the heading is and
   nothing more. If a clinician ever needs the distinction, it needs a deliberate answer rather than
   an inference.
3. ~~**`patientDirectory` is now used by two different reads.**~~ **Fixed in `6f2a9d3ae`** — and it
   was worse than I wrote: the trail has no `objectId` filter at all, so the reads were not merely
   indistinguishable by action name, they were **unaskable**. Name reads now carry their own
   `AccessedObjectType`.
4. **Search now matches a name, and the search term still never reaches the audit trail** — the
   `objectId` is the literal `"names"`, and `ACCESS_OBJECT_ID_PATTERN` would reject a name anyway.
   Worth restating because the search box's reach grew this round while the recorded identifier did
   not, and that is the correct relationship rather than an oversight.
5. **`markRetentionCleared` empties the name and the row falls back silently.** That is right, and it
   means a de-identified episode's row looks exactly like Task 5's row did. Nothing regressed; it is
   simply not visible on the screen that anything was cleared.

6. **The role notice is unreachable through every role that exists.** It is correct, tested and
   documented as unreachable — but it is untested against a real actor, because no real actor can
   produce it. If a role holding `viewReferral` without `viewPatientRecord` is ever added, the notice
   starts firing on that role's first render with no further work, which is the intent; until then it
   is a branch kept honest by a component test alone.

7. **Patient names now travel in the URL** — recorded by the coordinator as a known residual for the
   owner, not a defect, and repeated here so it is in one place: search matches names and the form is
   a GET, so `?q=Nguyen` reaches the address bar, history, any `Referer` and any access log. Before
   this round only synthetic identifiers went there. There was no compliant alternative — the brief
   mandates server-side filtering, Ruling 13 forbids client state, and the approved design requires
   name search. The audit trail itself is unaffected: the recorded `objectId` is the literal `"all"`,
   and `ACCESS_OBJECT_ID_PATTERN` would reject a name anyway.

## `tests/ui-caring-contacts-workspace.spec.ts` — yes, this could affect it, in two specific places

I did not run it (you own that gate). Where I would look:

- **Any assertion counting or naming rows on `/caring-contacts/patients`.** The visible heading text
  of every row changes from the synthetic identifier to the patient's name whenever the demo store
  holds one, and each row gains one extra `<p>`. A locator matching a row **by its heading text**
  will need the name. Locators keyed on the **detail control** are safe — its accessible name and its
  visible text are byte-identical to before.
- **The search box.** For a role that sees names — which is every role that can reach this screen
  at all — the `sr-only` label changed from _"Search by synthetic patient, plan or referral
  identifier"_ to _"Search by name, or by synthetic patient, plan or referral identifier"_, and the
  placeholder from `"Synthetic identifier"` to `"Name or synthetic ID"`. A `getByLabel`/
  `getByPlaceholder` locator on either will miss. (Both revert to the old strings for a role without
  `viewPatientRecord`, which no role reaching this screen currently is.)

Also relevant: the C-1 finding from the Task 5 review — that this spec has never visited
`/caring-contacts/patients` at all. If that is still true at the head you run, the spec will pass
without exercising any of the above, and a green result should not be read as coverage of this
change.

---

## Review round 1 — what changed (`6f2a9d3ae`)

### I-2 — the tally is gone, not corrected (Ruling 94)

The finding is exact and the diagnosis was worse than "an incomplete edit": `page.tsx` opened
`TWO AUDITED READS`, and the round that added a third **corrected the headline and left the two
sentences that depended on it** — "**Both** reads go through `auditedRead`" above three bullets, and
"no honest fallback for **either** read" enumerating two of three. Two false statements in the same
comment block as the number that had just been fixed. That is Ruling 94 demonstrating itself inside
the diff that cited it, which is the most useful place it could have happened.

Fixed by removing the count from the prose entirely rather than raising it:

- `EVERY READ IS AUDITED, AND NONE OF THEM IS HTTP` as the heading;
- "**EVERY** read on this page goes through `auditedRead`";
- "**NO** read on this page has an honest fallback".

A fourth read cannot falsify any of those. The bullets remain as a list of _what_ is read — a list,
not a tally — and the comment now carries a short note recording why, so the next person to add a
read sees the trap rather than repeating it.

### I-1 — the strongest sentence is qualified to what it covers

Correct, and the qualification matters because the sentence would have been read as being about the
page. `PLAN_COLUMNS` carries `patient_mobile_number` and `patient_identifiers`, `listPlans` selects
it verbatim, so the directory already pulls both for the whole caseload on every render and discards
them in `toPlanRecord`. The comment now says the narrowing is a claim about **this method**, states
the `listPlans` fact plainly next to it, and records that narrowing `listPlans`' own column list is
tracked separately. Not attempted here.

### I-3 — a dedicated object type, chosen over an `objectId` filter, and the reason is in the code

Concern 3 was understated: the trail's query schema accepts `objectType` and offers **no `objectId`
filter at all**, so `patientDirectory` + `objectId: "names"` was recoverable by eye and **not
askable** — while that type already carries two referral reads.

**Chosen: a new `AccessedObjectType` member, `"patientName"`**, with the page recording
`{ search, patientName, "all" }`. Reasons, all of them in the code at `access-audit.ts`:

- It is Ruling 46's own instruction — _add a member here rather than reaching for a catch-all_ — and
  the type's existing comment says exactly that.
- The trail's `objectType` filter is a plain equality on the event field in both stores, so a new
  member is askable the moment it exists. Nothing else had to change but the route's enum.
- Adding an `objectId` filter would have widened a **query surface that deliberately refuses to
  accept free text**, to solve a problem a type member solves without touching it.
- `objectId` reverts to the collection convention `"all"`, matching every other collection read.

### The role notice — added, and it is currently an unreachable branch

You were right that the page already knows the answer, and right that the two causes are not
symmetric. Implemented as described: one `role="note"` region above the list, decided from
`canPerformCaringContactAction(actor, READ_ACTIONS.patientName, …)` — never inferred from an empty
`patientNames`, because a coordinator whose team holds only de-identified episodes also receives no
names, and telling that clinician their role was the reason would be false. Mutation M13 pins that
distinction at both the component and the page level.

Two things worth your attention:

- **The search box drops its name-search offer in that role.** With no names released a name search
  matches nothing on every row, and a control must not advertise what it cannot do. Label and
  placeholder branch; both directions pinned (M15).
- **No role reaches the notice today.** It needs a role holding `viewReferral` _without_
  `viewPatientRecord`, and the grants run the other way round — which is the very asymmetry that
  makes `PATIENT_NAME_READ_ACTIONS` a conjunction. So it is an unreachable branch, written and
  pinned on the same principle as this page's null-release guard: still read, still copied by the
  next screen, one grant edit from running. Stated at the branch rather than left to be discovered.

### Minors

- **M-5** — both directions of the row's eyebrow label are now read. The hole was real and is the
  same shape as M7: a row reading "Synthetic patient identifier / Jordan Nguyen" is a _mislabelled_
  name, which is the same class of defect as an unlabelled one. Mutation M12 added.
- **M-6** — `patient name` restored to the alternation. It cost nothing and guards a future row
  growing a "Patient name:" field label beside a widened read.
- **M-7** — reworded. `getEpisode` is now "the only read that releases a mobile number or an
  identifier"; the file header was carrying the same stale claim and was corrected with it.
- **M-8** — the note states the **property** (`viewPatientRecord` is granted more widely than plan
  visibility, so it cannot decide a plan-enumerating read alone) and then names the three roles as
  the current membership, explicitly flagged as the thing that will change rather than the thing to
  check.

### Gates, round 1 (`6f2a9d3ae` / `7617a273b`)

| Gate                                                                                                                                                                         | Evidence                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Postgres suite, `npm run caring-contacts:db:test`                                                                                                                            | `Test Files  2 passed (2)` / `Tests  182 passed (182)`                 |
| Focused: every file covering a changed surface — access audit, API handler, patients page, patients directory, repository contract, interface vocabulary, route reachability | `Test Files  7 passed (7)` / `Tests  213 passed (213)`                 |
| Typecheck, whole project                                                                                                                                                     | `npx tsc -p tsconfig.typecheck.json --noEmit` — no diagnostics, exit 0 |
| Lint, `src` + `tests`                                                                                                                                                        | `npx eslint src tests --max-warnings 0` — no output, exit 0            |
| Full `npm run test`                                                                                                                                                          | `Test Files 828 passed                                                 | 3 skipped (831)`/`Tests 9990 passed | 74 skipped (10064)` |

**The full suite was blocked for hours and then ran; both facts are recorded.** Every attempt for
roughly four hours returned `DATABASE_HEAVY_RUN_ADMISSION_BUSY` -- an exclusive lease held by another
worktree (`C:\\Users\\joshs\\.codex\\worktrees\\5fd2\\Database`, `playwright --project=chromium`, taken at
`2026-08-24T19:19:38`). That is an acquisition failure, not a result, so it was retried on a loop
rather than reported as red, and the lease eventually cleared.

I deliberately did **not** bypass the coordinator to get there sooner. A whole-repo Vitest run is
exclusive precisely because it contends, and forcing one past a live Playwright lease would have
risked flaking another worktree's run to buy myself a line in this table. While waiting I took the
two read-only checks that cost that worktree nothing -- `npx tsc -p tsconfig.typecheck.json --noEmit`
(no diagnostics, exit 0) and `npx eslint src tests --max-warnings 0` (no output, exit 0) -- plus the
seven focused files above. All three were later confirmed by the coordinator-mediated runs.

`9990` is `9985` plus the five tests this round added: four in the directory suite, one in the page
suite. `tests/gate-receipts.test.ts` passed, as expected now that its file-mode failures are fixed
upstream.

### Mutation ledger, round 1

Same discipline: applied with an editor, proved present with `git diff`, test run as its own
command, reverted after.

| #   | Mutation                                                                 | File                     | Covering test                                                  | Result                                                                                                          |
| --- | ------------------------------------------------------------------------ | ------------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| M12 | eyebrow label collapsed to always-`"Synthetic patient identifier"`       | `patients-directory.tsx` | DOM: _"labels the heading for what it is, in both directions"_ | **RED** — `Unable to find an element with the text: Patient`. (This is the mutation that was green before M-5.) |
| M13 | notice inferred from `nameByPlan.size` instead of the actor's capability | `patients-directory.tsx` | DOM ×2 + page DOM ×1                                           | **RED** ×3 — including _"a coordinator with no names released gets none"_, which is the false-explanation case. |
| M14 | object type reverted to `{ patientDirectory, "names" }`                  | `patients/page.tsx`      | page DOM ×2                                                    | **RED** ×2.                                                                                                     |
| M15 | placeholder fixed to `"Name or synthetic ID"` in both roles              | `patients-directory.tsx` | DOM: _"offers a name search only when names are released"_     | **RED**.                                                                                                        |

No attempt in this round failed to match its anchor, and none was green.
