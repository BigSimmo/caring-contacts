# Whole-branch review — Caring Contacts Phase 2B

Run on the merged trunk, branch `claude/browser-test-gate-handoff-d5c1db`, at
`40ac6d240db92b4e7a163875f3c0d0c24e50902b`. Read-only: no source or test file was changed, nothing
was pushed, no pull request was opened, no subagent was dispatched. The untracked `1/` directory was
left alone and never staged.

**Verdict: safe to hand to the owner as complete, with three things attached to the handover.** No
Critical. Nothing on this branch changes what a discharged patient would receive, and nothing in it
can send anything — there is no send path in the tree at all (verified: no provider adapter, no
route that advances a contact past `scheduled`). Three Major findings and seven Minor. Two of the
Majors are the same family the phase has already been bitten by twice — something stored
incidentally, and a gate nobody ran — and the third is an error in the decision record itself rather
than in the code.

**Findings: 0 Critical, 3 Major, 7 Minor, 0 Nit.**

Every finding below is labelled **reproduced** (I ran it or read the exact bytes) or **reasoned**.

---

## 0. Gates

Run on this tree, unchanged, after every read. Verdict lines pasted; exit codes are not evidence.

| Gate                                                 | Result                                                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `GATE_RECEIPTS=refresh npm run test:cc-guards`       | `Test Files  37 passed (37)` / `Tests  827 passed (827)`, 79.47s, first attempt                  |
| The 32 caring-contacts suites the gate does NOT name | `Test Files  30 passed (30)` / `Tests  606 passed (606)`, 28.42s                                 |
| `npx tsc -p tsconfig.json --noEmit`                  | exit 0, zero output lines, read from `tsc` itself and not through a pipe                         |
| Control-byte scan of the whole Caring Contacts tree  | one hit, `tests/upload-structure.test.ts` 0x03 — allowlisted with a reason, and not this phase's |

**The second row named 32 files and reports 30.** The two that did not run are
`tests/caring-contacts-migrations.test.ts` and `tests/caring-contacts-postgres-repository.test.ts`,
excluded from every offline vitest project by name (`vitest.config.mts:12-15`, `:110-124`) and
collected only when `CARING_CONTACTS_DATABASE_URL` is set. They are not reported as covered. See
**MAJOR-2**.

No lock refusal was seen in either shape.

---

## 1. What a discharged patient would read, under every branch of the message code

Reproduced by importing the real modules and running them, not by reading the strings.

**Nothing is sent to anybody.** There is no sender, no provider adapter, and no route that moves a
contact past `scheduled`. Everything below is what the code would produce if a sender existed.

**Message A — the scheduled caring contact.** `resolvePatientVisibleMessage(preferredName)` has
exactly four outcomes:

| Preferred name                                 | Outcome                                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| absent, empty, or whitespace                   | refused, `preferred-name-not-recorded` — **no message exists at all**      |
| outside GSM-7 (`Zoë`)                          | refused, `preferred-name-not-sendable`, naming `ë`                         |
| over 33 septets                                | refused, `preferred-name-too-long`, `septets` and `maxSeptets` both stated |
| anything else (`Rowan`, `José`, `Christopher`) | the message below, with the name substituted                               |

With the specimen name the text is, verbatim:

> Hi Rowan, Alex from Example Aftercare Team is thinking of you. This is a one-way message. No one
> reads replies to this number. For timing changes call +61 491 570 157, 9 am-6 pm. In an emergency
> call 000. If you need to talk, Lifeline 13 11 14, any time. 13YARN 13 92 76. - Alex

`{ valid: true, septets: 278, segments: 2 }`. Empty slot 273; name cap 33; ceiling 306. Those are
exactly the numbers Ruling [144] predicted (247 → 273, 59 → 33). **The ceiling holds, and it holds
for every name the domain accepts, not just the specimen** — the suite walks every length from 1 to
the cap and asserts the name is really in the message before measuring it, so a template that
stopped substituting cannot hold the loop green.

**Message B — the automated reply to anyone who texts back:**

> No one at Example Aftercare Team reads this number, and this reply is automatic. To talk to
> someone, call +61 491 570 157, 9 am-6 pm every day. In an emergency call 000. If you need to talk,
> Lifeline 13 11 14, any time. 13YARN 13 92 76.

`{ valid: true, septets: 236, segments: 2 }` — 70 septets under the ceiling, and it has no name slot,
so that is its whole budget.

**Contacts 1 and 10 have no wording at all.** `schedule.ts:363` types contact 1 `first` and contact
10 `closing`; the demo corpus holds `""` for both (`demo-seed.ts:120-124`) and says why. Contacts 2–9
are `standard`, which is the message above. So of the ten contacts in a twelve-month plan, eight have
authored wording and two do not — which is the honest state, since nobody in this programme may write
either. See **MINOR-6** for the one asymmetry in how the two absences are handled.

**On the Ruling [144] change specifically, checked in full:**

- The crisis sentence is interpolated from `PROVISIONAL_MESSAGE_RULES.crisisSupportContact` in both
  messages, so the sentence a patient reads and the sentence `message-policy.ts` requires
  (`text.includes(rules.crisisSupportContact)`, `:132` and `:142`) cannot drift apart. **Correct, and
  it is the shape that matters**: two hand-maintained copies of a crisis number is how one of them
  ends up wrong.
- The owner's exact sentence is held as an independent literal in
  `caring-contacts-message-copy.test.ts:321`, so a reword reddens a test rather than being copied
  into it. Both numbers are additionally asserted individually, so a single-digit slip cannot hide
  behind a whole-string compare.
- **The real crisis service is not filed among the fictional numbers.** Reproduced: the marker
  pattern returns `false` on the authorised sentence alone, `Object.values(FICTIONAL_CONTACTS_BY_ROLE)`
  does not contain it, and neither `13 11 14` nor `13 92 76` occurs in any reserved number.
- **Both messages still identify themselves as demonstration specimens — to the SYSTEM.** Reproduced:
  `fictionalContactMarkerPattern.test()` is `true` for both, carried entirely by the fictional staffed
  line `+61 491 570 157`, and `validateGovernedMessage` reports `fictional-contact-detail-present` for
  both unless a call site explicitly acknowledges it. That is exactly the claim Ruling [144] made and
  it is correct.

  **Scope that claim precisely, because it changed and the record does not say so.** The word
  `Fictional` is now absent from both patient-visible strings — reproduced,
  `EXACT_PATIENT_VISIBLE_MESSAGE.includes("Fictional") === false`. Before the swap the message told a
  _human_ reader it was fake; now only the pattern does. That was the point of the change and the
  owner authorised it, so it is not a defect. What is worth writing down is the consequence: **the
  message now mixes two live crisis numbers with one non-connecting service line, and nothing in its
  text distinguishes them.** The human-visible tells that remain are "Alex", "Example Aftercare Team"
  and the specimen name. Not a finding; a fact the next person to touch these strings should have.

**One thing this branch does NOT do, and should not:** no screen assembles a greeting. The wizard
scans its own source and asserts it never imports `message-copy` and never writes the words
(`caring-contacts-plan-wizard.dom.test.tsx:2382-2402`), with a positive control that the scan read
the file at all before concluding anything about what it lacks. That is the correct shape and it is
proved rather than promised.

---

## 2. The four unreviewed rounds

Every SHA below was checked with `git cat-file -e <sha>^{commit}` before it was read. All six exist.

### Task 10, round 3 — `9f49d997a`. **Zero behavioural change.**

Reproduced: `git show 9f49d997a -w` over `src/` and `tests/` leaves only Prettier line-wrapping — one
JSX attribute split across lines in `patient-overview.tsx:911`, two object literals reformatted in
`caring-contacts-patient-overview.dom.test.tsx`. Everything else in the commit is the task report.
The skipped re-review cost nothing here; Ruling [136] was right to be suspicious of the premise and
right that the premise happened to hold in this one case. Nothing found.

### Task 11a, round 2 — `ae8c4a73c` plus two `test(` commits. **Real behaviour; one narrowing.**

Two changes, both sound:

- `save-draft` now announces where it takes you, in the control's own accessible name and in a
  sentence beside the pair (`plan-wizard.tsx:238-246`, `:1016-1046`). The destination lives in one
  constant so the two cannot drift. The matrix's Navigation clause is a contract the screen owes and
  the frozen drawer copy does not discharge it, so putting it on the screen rather than editing the
  approved copy is the right call. Checked: the sentence names "Discard draft", which is the actual
  visible label of the sibling control.
- `discard-changes` gets its own words when the sign-up has already gone
  (`overlay-guards.ts:120-146`). The shared `sign-up-still-here` sentence tells a coordinator to start
  the sign-up again — for an outcome they asked for and already have. The override changes the
  sentence and never the outcome, and it still refuses rather than reporting a removal this press did
  not perform. Correct, and correctly argued.

**MINOR-4 below** is the one thing in this round I would have sent back.

### Task 19, round 3 — `2ab079db8`. **Good, and it produced MAJOR-3 as a side effect.**

`medianMinutesToResolution` → `medianMinutesFromAttemptToResolution` is a real correction: the record
holds no difference-detected instant, so the number never was time-to-triage, and — as the commit says
— no assertion could have caught it, because every test derives its expected value from `startedAt`
too. The reach-report cross-filter defence became a test that fails on any interactive element in the
section, and the temporal differencing axis is recorded as open rather than implied closed. Both are
the right dispositions.

This round is also where the small-cell threshold acquired a governance home. See **MAJOR-3**: the
final ruling on that decision does not know it happened.

### Task 16, fix round 1 — `4b97b29f3`, `6adbf8902`, `42ebc801a`. **Accepted under Ruling [141]; I agree with the acceptance.**

The load-bearing change is deleting a false approval claim from the template-detail card and rendering
`CLINICIAN_FACING_WORDING_APPROVAL_STATUS`, read from the sealed domain, unconditionally. Checked
independently of the report: the deleted sentence is gone from `src/` entirely, the replacement is one
exported constant referenced by the screen and four suites, the absence assertion matches the stem
`/approv/i` rather than the deleted phrasing, and the guard against the status leaking into a
patient-visible string now asserts each guarded phrase **is** a substring of the status before
asserting it is absent from the messages — the correction M9 forced, and the thing that stops the
guard being inert.

`overlay-trigger.tsx`'s JSDoc changes are counts-to-properties only; the runtime is untouched.

**Nothing in the four rounds changed what a patient would read.** Task 10's round is whitespace; 11a
and 16 touch clinician-facing surfaces; 19 touches reporting. The only patient-visible string change
on the whole branch is Ruling [144]'s, which had its own scoped re-review and is re-checked in §1.

---

## 3. Findings

### MAJOR-1 — Two more stores of free text about a patient survive retention clearance, and one of them would survive the fix already approved for the third

**Reproduced by reading the SQL and the write sites; not executed** (the database suite cannot run
here — see MAJOR-2).

`markRetentionCleared` clears exactly two things: the `plans` row's five patient columns, and the
`cultural_identity_reports` row, both in the same transaction as the clearance record
(`postgres-repository.ts:2172-2187`). That part is thorough and well argued. It touches nothing else.

Ruling [139] MAJOR-4 already has one survivor with the owner: `plan_reassignments.reason`, the
handover note. **There are two more, and neither is recorded anywhere.**

1. **`caring_contacts.idempotency_records.result`** (`0001_caring_contacts_foundation.sql:235-243`).
   Every write stores `JSON.stringify(encodeStoredValue(staged))` — the **verbatim result payload** —
   keyed by `(team_id, idempotency_key)`, with no expiry and no purge
   (`postgres-repository.ts:648-652`; in-memory `in-memory-repository.ts:371`). For a reassignment
   the staged value is a `PlanAssignment`, and `PlanAssignment.reassignmentHistory[].reason`
   (`assignment.ts:24-29`) **is the handover note.** This path is live and reachable today:
   `src/app/api/caring-contacts/assignments/[planId]/route.ts:42,53,96` takes
   `{ type: "reassign", toActorId, reason }` with an idempotency key and calls `applyAssignment`.

   **So the owner's Decision 1 — "delete handover notes with the patient" — implemented against
   `plan_reassignments`, would leave a byte-identical copy of every note in `idempotency_records`.**
   That is the finding: not a new note, a second home for the one already decided about, in the one
   table whose stated purpose has nothing to do with patient data.

   The same mechanism would carry a third-party pause's `requester`, `relationship` and `note`
   (`hospital-events.ts:142-149`), since those ride the returned `exceptions`. That instance is not
   reachable today — `recordHospitalStatusEvent` has no route — but the shape is already built.

2. **`caring_contacts.contact_dispatches.discrepancy_note`** (`0003_caring_contacts_workspace.sql:386`,
   written at `postgres-repository.ts:1934-1939` from `resolveDispatchDiscrepancy`'s `note`, which
   the schema requires to be non-blank). This is a clinician's free-text account of what happened to
   **one named patient's message**. It has no data-classification comment, and no clearance path.

   The contrast that makes it a finding rather than an observation: `service_stops.note`, three
   hundred lines earlier in the same migration, carries `-- Free text written by a responder
mid-incident. Treat it as patient data.` and a recorded owner disposition with a tracked issue
   (`0003:99`, `:160-170`). Somebody classified that column and did not classify this one.

**What I am NOT claiming.** No real patient data exists in this tree, nothing is sent, and the
transactional-audit and fingerprint-hashing protections either side of these fields hold — no request
body reaches an audit event, and the idempotency _fingerprint_ is a SHA-256 (`fingerprint.ts:51-52`)
precisely because inputs carry patient text. **The gap is retention alone**, exactly as it was for
MAJOR-4. Both of these are product decisions in the same shape as the one already with the owner, and
the right move is to put them beside it rather than to guess.

**Why this was found by asking the brief's own question.** Neither field is _for_ holding patient
text. `idempotency_records` is replay protection; `discrepancy_note` is reconciliation. Asking what
each mechanism stores **incidentally** has now found this class three times in this phase.

### MAJOR-2 — The caring-contacts database suite has never run on the merged tree, and it is not on the owed-gates list

**Reproduced.** `vitest.config.mts:12-15` names `tests/caring-contacts-migrations.test.ts` and
`tests/caring-contacts-postgres-repository.test.ts` as `caringContactsDbTestFiles`; `:118-123`
excludes them from the offline `node` project unconditionally; `:141-159` collects them only when
`CARING_CONTACTS_DATABASE_URL` is non-empty. My run naming 32 files returned
`Test Files 30 passed (30)`. They are also absent from `test:cc-guards` and from `npm run test`.

**Nothing in the Phase 2B build record or archive mentions `db:test` at the merge point.** Ruling
[150] enumerates the owed gates — `format`, the full `npm run test`, `build`, the Playwright spec —
and this is not among them. Four task reports (5b, 6b, 9b, P) do record running it, but each on its
own branch, before the merge.

**Why that matters here specifically, rather than as a general tidiness point.** Three migrations
landed on this branch from three different worktrees — `0005` (first-contact reason), `0006` (plan
assurances), `0007` (preferred name). Commit `a2f74936a` on one of them reads _"0006 must not
re-grant on every table — that restored write access to the audit trail"_: a real privilege defect,
in a migration, found by this suite and by nothing else. Migration ordering, cumulative grants and
RLS are precisely the properties that are correct on each branch and can be wrong on the union — the
category Ruling [149] measured twenty-two instances of.

So the merged tree currently has **no evidence** for spec §3.2's team-scoped RLS, transactional audit
and duplicate prevention, or §11's migration tests, or the Postgres half of the de-identification
path that MAJOR-1 above turns on. `tests/caring-contacts-migrations.test.ts` gained 219 lines in this
phase and has not run once against the merged chain.

The run itself is local, offline and provider-free (a disposable Postgres container; the exact
command is in `docs/caring-contacts/phase-2a-build-record.md:374-375`). I did not run it — starting a
container is outside this review's permitted gates. **It should be run before handover, or recorded
as owed in the same sentence as the Playwright gate was.**

### MAJOR-3 — Ruling [142]'s disposition of Decision 4 is contradicted by the merged tree

**Reproduced.** The build record, line 3156, says of the small-cell suppression threshold:

> spec §2.5 requires a **governance-configured** threshold and no configuration surface exists in the
> sealed domain or in any caring-contacts migration. A hardcoded five is the same defect as a
> hardcoded anything — it is the provenance, not the value, that the disclosure control needs.

and adds _"Task 19 was instructed to stop rather than invent a constant, and that instruction stands."_

Both halves are false of this tree. `src/lib/caring-contacts/reach-reporting-governance.ts` exists —
created by `db6261646` on **2026-08-26**, verified an ancestor of HEAD — and is a record whose whole
subject is the decision: `smallCellThreshold: 5` alongside `decidedBy`, `decidedOn`, `basis`,
`restsOn` and `revisit`, frozen so a request cannot mutate it. It is in the sealed domain. It is read
by `reachReportingThreshold()` (`reach-reporting.ts:126-127`), rendered with its provenance on the
reports screen (`operational-reports.tsx:141-143`), and pinned value-and-provenance by
`caring-contacts-reporting.test.ts:157-169`. Task 19 did not stop; its round-3 diff `2ab079db8`
rewrote `reports/page.tsx:78-100` specifically to correct the earlier "nowhere to live" comment, and
says so in its own commit message.

**This is the controller failure the standing discipline names, in its usual costume:** a fact true at
one scope (the trunk, on 2026-08-27, before `cc-demo-seed` merged) written as a fact about the system.
The ruling is dated the day before the merge that made it false, and nothing re-read it afterwards.

**Consequence, and it is why this is Major rather than a typo.** The record is the handover artefact.
An owner reading it concludes a disclosure control over Aboriginal and Torres Strait Islander
reporting is still missing, and the recorded remedy is to build one — which would produce **a second
definition of a disclosure control**, the exact class Ruling [143] was written about eight paragraphs
earlier. The code is correct; the record needs a correction in place, not an overwrite.

### MINOR-1 — The wizard still says the frozen wording has no name slot

`plan-wizard.tsx:1798-1801`: _"The frozen wording carries a name of its own and has no slot for the
one typed above, so it is not this patient's message and must not be presented as one. That gap is
the sealed domain's to close; this screen states it instead of filling it."_

Task P closed that gap on `cc-message-name`. `message-copy.ts` is a template with a slot and a derived
cap, and the wizard itself calls `resolvePatientVisibleMessage` for validation
(`plan-wizard/patient-detail.ts:125`). **The screen's behaviour is still right** — showing the specimen
rather than interpolating at render time is Ruling [127]'s surviving conclusion, and the user-facing
paragraph beside it is accurate. It is the _reason_ that expired at the merge. The same stale claim
sits in `task-11a-report.md:143` and `:161`, where it is the recorded justification for one of the
frozen-copy conflicts; the conflict is the owner's and stays open, but its stated reason is no longer
the true one. Reproduced by reading both files at HEAD.

### MINOR-2 — A deliberate duplication whose stated obstacle no longer exists

`plan-wizard/plan-activation.ts:735-753` holds a second copy of the message-type labels and justifies
it: _"That module cannot be imported here: it reads `repository.ts`, which names the service-state
module."_

At the merge those labels moved out of `patient-overview.tsx` into `contact-vocabulary.ts` — a
plain-data module whose only import is `type { ContactState, MessageType } from
"@/lib/caring-contacts/model"`, which is already in the wizard's client module graph via
`plan-draft.ts`. So importing it adds no edge at all and cannot trip the explained-automation graph
scan. The three strings currently agree exactly, so there is no live divergence — but nothing holds
them in step, `contact-vocabulary.ts`'s own header says this vocabulary "must not exist twice", and
the note points the next reader at a file that no longer holds the counterpart. Reasoned from the
import graph, not executed.

### MINOR-3 — A universal claim on the template screen that no rule enforces

`template-detail.tsx`, `ReplyHandling`: _"Every message carries this sentence about replies:"_ above
`PATIENT_VISIBLE_NO_REPLY_NOTICE`.

`validateGovernedMessage` has no rule requiring the notice in any message — reproduced by reading
`message-policy.ts:100-160`, which checks segments, prohibited terms, the fictional marker, the
first/closing support fragments, the patient mobile and `?`, and nothing else. It is true today of
the one message that exists, and `AUTOMATED_REPLY_RESPONSE` — rendered two paragraphs below on the
same card — does not contain the notice. A clinician reads a guarantee about future wording that
nothing in the system will keep.

### MINOR-4 — Task 11a round 2 moved a defensive check later

Before `ae8c4a73c`, `wizardDecisionRefusal` iterated the row's conditions and threw for any condition
with no plain-words entry, whether or not that condition had fired. After it, the `Object.hasOwn`
check lives in `wizardDecisionRefusalWording` (`overlay-guards.ts:174-198`), which is called **only
for a condition that is already unmet** — so a missing entry now surfaces at the moment a clinician is
refused rather than the first time the row is evaluated. `WIZARD_DECISION_REFUSALS` is a total
`Record` over a closed union, so the compiler still covers the case and this is belt-and-braces
either way. It is recorded because the round is one of the four nobody reviewed, and because the
narrowing was not mentioned in the commit message. Reasoned from the two versions of the function.

### MINOR-5 — The demo corpus stores an already-personalised specimen as a version's message text

`demo-seed.ts:120-124` sets a pathway version's `messageTextByType.standard` to
`EXACT_PATIENT_VISIBLE_MESSAGE` — which is the template **with `Rowan` already substituted**.
`template-detail.tsx:337-405` renders that string verbatim under the heading "Message wording this
record holds", with the approval status beside it. The card correctly says nothing below is addressed
to anybody; it does not say that the name inside the string is an example rather than a slot. The
wizard does say exactly that beside the same string (`plan-wizard.tsx:1810-1814`), so the two screens
show one string and only one of them explains it.

There is no live exposure — nothing reads a version's stored text to build an outgoing body, because
nothing builds outgoing bodies. It is recorded because the trap is aimed squarely at the next person:
Ruling [127]'s surviving conclusion pushes a future sender toward reading the stored text, and reading
this one would greet every patient as Rowan. `preferredNameMaxSeptets`'s own doc anticipates a
version's text being a different string; it does not anticipate the stored one being pre-substituted.

### MINOR-6 — `closing` has a named refusal for unauthored wording and `first` does not

`resolveClosingContactMessageBody` (`message-policy.ts:170-186`) exists precisely so a closing contact
with no authored body produces a loud, identifiable refusal rather than an empty string or a silent
skip. Contact 1 is typed `first` (`schedule.ts:363`), its wording is equally unauthored, the demo
record holds `""` for it (`demo-seed.ts:122`), and there is no `resolveFirstContactMessageBody`.
`validateGovernedMessage` already treats `first` as its own type with its own required fragments, so
the domain knows the distinction. Today this costs nothing — there is no seam that resolves a body at
all. It is worth a line so that whoever builds that seam does not read the closing refusal as covering
both.

### MINOR-7 — The gate still does not name the suites for the module changed yesterday

`test:cc-guards` names 37 suites. Sixty-six caring-contacts suites exist. Thirty-two are unnamed, and
they include **`caring-contacts-message-copy.test.ts` and `caring-contacts-message-policy.test.ts`** —
the direct behavioural suites for the two modules Ruling [144] changed on 2026-08-27 — along with
`permissions`, `access-audit`, `migrations`, `postgres-repository`, `simulation`, `hospital-events`
and `repository`.

Ruling [149] records _"The merged gate names 35"_ as the resolution of the gate-drift problem. That
closed the **inter-branch** half — each side named 27 and each held 8 the other lacked — and left the
**never-named** half exactly where the standing discipline found it across the five branches. The
distinction matters because "the gate is green" reads identically either way.

I ran the 30 runnable ones on this tree: `Test Files 30 passed (30)` / `Tests 606 passed (606)`.
Nothing was hidden. The point stands.

---

## 4. What I checked and found sound

Recorded because a review that lists only findings tells you nothing about coverage.

- **Privacy, the read path.** `getEpisode` is called from exactly one screen
  (`patients/[patientId]/page.tsx:250`), once, for one plan, only after the plan has been resolved
  from a team-scoped `listPlans`. The chooser takes its name from `listPatientNames` instead. Denied,
  absent and another team's all answer `null` indistinguishably, and the denial is still recorded on
  the trail. The comment block explaining `?plan=`'s two rules is accurate to the code, including the
  one-plan case it deliberately does not let the URL veto.
- **Privacy, the address.** `workspace-address.ts` is an allowlist that **names what may be kept** and
  never copies or filters the incoming parameters — the only form that is still correct for a
  parameter nobody has invented yet. Every registered parameter is an identifier or a calendar day.
  A saved search term is reduced to a boolean flag. The canonicaliser is a fixed point of itself.
- **Privacy, the draft.** `plan-draft.ts` is the only module in the wizard directory that names a
  storage API, names exactly one (`sessionStorage`), and a suite scans the whole directory for the
  other name. One key, so "cleared on abandoning" is provable rather than a sweep. The referral rides
  inside the value rather than in the key, because a key is the enumerable part. The memory fallback
  is consulted first, which is what makes the Safari-private shape reachable.
- **The service-state incident note** cannot reach a Client Component, and the guard uses a sentinel
  rather than plausible literals, scans `innerHTML` rather than text, and re-inspects the rendered
  fixture rather than a fresh copy.
- **Explained automation (§4.4).** Reason and remedy are asserted in the page rather than in a
  `title`, the restart banner names all three approver roles and that they must be three different
  people, and the shell's `serviceState` prop is required — enforced by a `@ts-expect-error` that
  goes red if anyone makes it optional again.
- **Transport vocabulary.** One source (`contact-vocabulary.ts`), every provider state labelled
  `(transport receipt)`, exhaustive over the union so a new state cannot compile into a blank.
  `Delivered` appears nowhere as a patient-state label.
- **Role wording.** Raw role identifiers cross the client boundary only where they are compared
  (`actingAccount`, `carriedBy.actorId`); every rendered position reads
  `CARING_CONTACT_ROLE_WORDING`. Verified by grepping every use of both.
- **Control bytes.** Zero in the Caring Contacts tree. The one repository-wide hit is the ZIP magic
  number in an upload fixture, allowlisted per-file-per-byte with a reason and re-proved necessary.
- **Assertion strength in the message suites.** Absences carry positive controls that are
  demonstrably non-empty and demonstrably contain what is being looked for; the source-scan case
  asserts the scan read the file before concluding anything about what it lacks; the cap is proved at
  both ends rather than only the safe one. This is the strongest test-writing in the phase and I
  could not make any of it vacuous by inspection.

**Deliberately not re-raised**, per the brief: the six frozen-copy conflicts and the two-table
finding; the handover note outliving clearance (MAJOR-1 is two _further_ stores, one of which would
survive that fix); `WorkspaceOverlayCommit` having no exit member; `blockReason` with no producer and
the three address-only rows; `documentOverflow`/`layoutOverflow` and the app-wide reduced-motion
mechanism; Group 4 and Task 13b.

---

## 5. Recommendation

**Hand it over.** The build is coherent, the reasoning in it is unusually load-bearing, and the
patient-facing surface is in a defensible state: the crisis line is real, the ceiling holds for every
accepted name, the refusals are loud, and nothing can be sent. Attach three things to the handover:

1. **Put MAJOR-1's two stores beside the handover-note decision already with the owner**, and say
   plainly that fixing `plan_reassignments` alone will not remove the note from
   `idempotency_records`.
2. **Run the caring-contacts database suite on the merged tree, or record it as owed** in the same
   sentence Ruling [150] used for the Playwright gate. It is local and offline; the container command
   is already written down.
3. **Correct Ruling [142]'s Decision 4 in place** before the owner reads the record, so he is not
   asked to authorise building a disclosure control that exists.

**My single biggest concern** is MAJOR-2, and not because I think the migrations are wrong. It is
that the merged tree's only proof of the database half — RLS, grants, transactional audit,
de-identification — is a gate that this phase's own record does not list among the gates it owed. The
phase found twenty-two defects at the merge that no branch could see; the one surface where a merge
defect would be silent, permanent and about patient data is the one surface the merge never
re-verified.
