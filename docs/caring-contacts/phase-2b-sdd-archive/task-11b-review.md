# Task 11b review — `pause`, `withdrawal` and `reassignment`

**Reviewed:** `fe721ce70`, `541345e8c`, `f3ee88113`, `ec4f6b1cb` against merge base `23ab19bb0`, plus the
report at `9a64f7b6f`. Every one of those SHAs was checked with `git cat-file -e <sha>^{commit}` and
exists. `git diff --stat ec4f6b1cb HEAD -- src tests` is empty, so the source tree I reviewed is
byte-identical to the tree the report's gate line describes.

**Worktree:** `D:\Worktrees\Database\cc-plan-detail`, branch `claude/caring-contacts-plan-detail`. Nothing
pushed, no pull request, no subagents.

---

## The two verdicts

### Spec compliance — **FAIL**

The three frozen rows are wired, the copy is derived from what the domain actually does rather than from
the drawer's summary, the idempotency key is real, the version is carried honestly, and no patient data
crosses any boundary this diff opens. That is most of the task and it is well done.

It fails on one thing, and it fails a verbatim clause of the brief. **`reassignment` can be confirmed
through both stages and do nothing at all — no write, no message, no trace** (CRITICAL-1, reproduced and
observed, not inferred). The brief's feedback contract says a success announces the outcome and a no-change
"states explicitly that no external or production action occurred". This path announces neither; it closes
the surface and leaves the previous action's message standing. `workspace-overlays.tsx` throws loudly
rather than allow "a confirm control that appears to work and writes nothing" (Ruling 87); this reproduces
that exact defect one layer below the throw.

A second brief clause is deviated from and the deviation causes a defect: "**Mint the key once when the
confirmation is first opened and reuse it for every retry of that submission**" (MAJOR-1). The key is held
per ACTION until that action succeeds, not per submission, and I observed one key carried across two
submissions with different bodies.

Both are narrow and both are one round's work.

### Task quality — **PASS**

The verification is real, and by a wide margin the strongest evidence in it is that the cases drive the
actual route handlers against the actual in-memory store and then read the store back. "Pause holds rather
than cancels" is proven from `getPlan`'s contacts, not from a sentence on screen. The guard-rejection cases
assert the record AND the assignment are unchanged, which is the clause the brief says nobody writes. The
account-continuity, replay and version cases each carry a positive control. Three cases were deliberately
split so a load-bearing assertion is not standing behind a sibling, and one mutation (M18) found a real
defect in the implementer's own case and the case was changed and the whole ledger re-run. The wrong
prediction at M10 was reported as wrong rather than relabelled.

The reservations are enumerated below and none of them is "the tests cannot fail". They are: one named
discipline step skipped (MAJOR-2, the gate-drift diff), one consequential surface with no copy assertion at
all (MAJOR-3), and three claims in the report that are wider than what was checked.

**On the disclosed test-after-implementation:** the ledger compensates for **assertion strength** and does
not compensate for **coverage**, and this review is the demonstration. Every assertion I probed can go red.
Both defects I found sit in assertions nobody wrote — the `plan === null` reassignment path and the
withdrawal card's copy. Task 7's lesson is stated in the report and is exactly what happened here: a
mutation can only falsify a test that exists. So the honest answer to "does the ledger compensate" is _no,
not for the thing test-first buys_, and the report's own sentence ("that is compensation, not equivalence")
is right in a way that turned out to be load-bearing.

---

## The report's three findings, checked against the tree

**All three are true.** Each is stated below at the scope I actually checked it at.

1. **The frozen `pause` summary contradicts the domain — VERIFIED, both halves.** The string is at
   `src/components/caring-contacts/workspace/overlays/definitions.ts:225` and reads "Contacts that fall
   inside the pause are skipped for good." `pausePlan` at
   `src/lib/caring-contacts/in-memory-repository.ts:607` routes to `lifecycleWrite` (`:484`), whose `stage`
   applies `applyPlanTransition` and calls `withPlan` — it touches no contact, and `cancelAllNonTerminalContacts`
   is reached only from the withdrawal and hospital-status paths (`:628`, `:671`). The contract test named
   _"holds without cancelling for a readmission"_ exists at
   `tests/helpers/caring-contacts-repository-contract.ts:899`. The row's `decision` is also "Pause future
   contacts", which carries the same implication; the report does not mention that second string and it
   belongs with this finding when the owner rules on it.

2. **`requiresFreshAuthentication` has nothing to authenticate against — VERIFIED at the scope claimed.**
   `src/app/api/caring-contacts/session/route.ts` takes `{ role }` from a closed list and sets a cookie
   holding a role name; there is no credential anywhere in it. The flag is `true` for exactly `withdrawal`
   and `reassignment` — pinned by the Task 17 contract, and `planActionNeedsTheAccountChecked` in
   `plan-actions.tsx:489` matches those two rows and no others. The decision copy on both rows is
   "Continue and confirm who you are" (`definitions.ts:240`, `:254`). I did not read
   `caring-contacts-server/session.ts` end to end; I read `resolveDemoActor` and the route.

3. **A reassignment carries no version — VERIFIED.** `assignmentSchema` in
   `src/app/api/caring-contacts/assignments/[planId]/route.ts:38` is `.strict()` and carries `action` and
   `idempotencyKey` only, so an `expectedVersion` would be REJECTED rather than ignored — the omission in
   `PLAN_ACTION_CONDITIONS.reassignment` is therefore required, not merely defensible. `applyAssignment`
   (`in-memory-repository.ts:1084`) reads no version.

---

## Findings

Ordered by severity. The set is CRITICAL-1; MAJOR-1 through MAJOR-4; MINOR-1 through MINOR-5;
NIT-1 through NIT-3 — each is a heading below, so the list is the count.

---

### CRITICAL-1 — a confirmed reassignment can silently do nothing, and say nothing

`src/components/caring-contacts/workspace/plan-actions.tsx:210-211`

```ts
const held = live.current.plan;
if (held === null) return;
```

`held` is used only in the LIFECYCLE branch (`expectedVersion: held.version`). For the three lifecycle
actions this line is dead, because `this-screen-still-knows-the-plan` refuses them first. For
`reassignment` it is live and it is the only thing that runs, because that row deliberately omits that
condition (`plan-action-rules.ts:308-315`) — correctly, since the assignment route accepts no version. So
the deliberate design decision "a reassignment survives a plan whose version this screen has lost" is
defeated by a guard belonging to a different action, silently.

`plan` becomes `null` whenever a lifecycle write SUCCEEDS and `planFromWriteAnswer` cannot read the answer
(`plan-actions.tsx:247`) — the degraded-transport case this whole surface is designed around, and the
one the card renders a sentence for ("not known here any more — a change landed and its answer could not be
read").

**Failure mode, concretely.** A coordinator holds a plan; the service's answer comes back in a shape the
screen cannot read; the card says so. They then move the plan to another coordinator: the "Move this plan"
control is live, the confirmation opens, its decision control is NOT `aria-disabled`, they press through
BOTH stages of a two-stage surface, and the overlay closes. No request is sent. No outcome is written. The
outcome region still shows the previous message. **Responsibility for a discharged suicide-risk patient
stays with the wrong person, and the screen gave the coordinator every signal that it moved.**

**Reproduced, not reasoned.** I rendered `PlanActions` + `WorkspaceOverlays` with a `fetch` that answers the
lifecycle write `200 {}`, then drove the move. Observed:

```
PROBE reassignment action aria-disabled = null
PROBE requests after the move: ["/api/caring-contacts/plans/plan-probe"]
PROBE outcome unchanged by the move: true
```

One request ever left the screen — the hold. The probe file was deleted and `git status --porcelain` is
empty; see "What I ran" below.

No case covers this and no mutation reaches it. Whatever the fix (refuse by name, or scope the guard to the
lifecycle branch), the case that must exist is: plan unknown, confirm a move, assert either a write or a
NAMED refusal — never silence.

---

### MAJOR-1 — the key is held past the submission, so a corrected move is refused for a second, worse reason

`plan-actions.tsx:213-214` mints `keys.current[action] ?? mint(action)` and `:240` deletes it only on
success. The brief says "reuse it for every retry of **that submission**". This reuses it for every
submission of that action until one succeeds.

The two are not equivalent, and report item 7's "the retry guarantee is identical either way" is false in
the direction that matters. `runWrite` (`in-memory-repository.ts:315`) records a refusal from `stage()`
under the key with the request's fingerprint, and answers a later request carrying that key with a
different fingerprint as `idempotency-key-reused-for-a-different-write`.

**Failure mode, concretely.** A team lead's move is refused by the service (`plan-not-claimed` after a
concurrent unclaim, `not-found`, a store-level `permission-denied`). They edit the destination or rewrite
the handover note and confirm again — a genuinely new submission. It is refused as a key reuse. The remedy
that refusal states is "Reading this screen again so it holds the plan as it now stands, then deciding
again", which does not clear a ref; only a remount does. The move cannot be completed from that screen.

**Observed.** Two submissions from one mount with different `reason` values:

```
PROBE2 bodies: [ "idempotencyKey": "PLAN-REASSIGNMENT-mgidhicbdgbkekfjjcphcbkeldminpce"
                 "idempotencyKey": "PLAN-REASSIGNMENT-mgidhicbdgbkekfjjcphcbkeldminpce" ]
PROBE2 same key across two DIFFERENT submissions: true
```

The replay case in the suite cannot see this: it retries the SAME body, which is the case the key is for.
The missing case is a retry of a CHANGED body. Note that the size-limit path is safe by luck —
`request-body-too-large` is refused by `parseJsonBody` before `runWrite`, so no server record is created —
but the screen's own remedy for it ("Shortening the reason for the move, then confirming again") is
advice that would walk straight into this on any other refusal.

---

### MAJOR-2 — the gate was reported without the drift diff the standing discipline requires

The report names `npm run test:cc-guards` as the gate and pastes its line. It never lists the suites the
gate names, lists the suites that exist, and diffs the two — the step STANDING-DISCIPLINE spells out
because that gate is a hand-maintained path list in `package.json` that nothing updates.

I did the diff. The gate names eighteen suites. Offline Caring Contacts suites it does not name, that cover
modules this diff touched:

- `tests/caring-contacts-page-access-audit.test.ts` — the access-audit contract for the very page this diff
  added an audited read to. The highest-risk omission of the set.
- `tests/caring-contacts-overlay-host.dom.test.tsx` and `tests/caring-contacts-overlay-trigger.dom.test.tsx`
  — the host and trigger this task uses four times, and the suites the report leans on for its two-stage,
  focus-return and modality claims.
- `tests/caring-contacts-assignment.test.ts` — the assignment domain this task is the first surface to write.
- `tests/caring-contacts-session.test.ts` — the read this task now performs at commit time.
- `tests/caring-contacts-permissions.test.ts` — the grants the page now resolves per action.

**I ran all six.** `Test Files 6 passed (6)` / `Tests 182 passed (182)`. So the omission hid nothing this
time — but "green" and "not run" read identically in a report, and the report presents one as the other.
The modality/desktop-width direction I was going to raise as a gap is in fact pinned by
`caring-contacts-overlay-host.dom.test.tsx:90`, which is one of the six — an instance of the discipline's
own point that an omitted suite hides the precedent as well as the coverage.

---

### MAJOR-3 — the withdrawal's copy, the one sentence that says the schedule is destroyed, has no assertion

`plan-actions.tsx:377` renders the withdrawal explanation: "A withdrawal ends the plan, and the service
moves every message on it that had not already gone to cancelled. That is the opposite of holding it:
nothing is kept to come back to, and it cannot be undone."

Nothing asserts it. `caring-contacts-plan-actions` is queried in five cases in
`tests/caring-contacts-patient-overview.dom.test.tsx` and not one reads that block. By contrast the PAUSE
copy is asserted three ways plus one whole sentence pinned verbatim, and the no-sender sentence is pinned
in full.

The brief made this an explicit requirement of the row: "**State what becomes of the remaining contacts**,
derived from what the domain actually does, not assumed."

**Failure mode.** Someone editing this card later — the plausible edit is making the two blocks read
consistently — writes the hold's reassuring wording into the withdrawal block. Nothing goes red. A
coordinator ending a person's participation in a suicide-prevention programme is told the schedule is kept
when the service has just cancelled every message on it. That is the same class of defect the report's own
finding 1 is about, in the other direction, on the irreversible action.

This is the family the discipline names: the property was proven where it was convenient (pause, where
finding 1 made it interesting) and not where it is load-bearing.

---

### MAJOR-4 — the handover note outlives retention clearance, in a store nothing classifies as patient data

`plan-actions.tsx:416-430` renders a free-text `<textarea>` prompted "Why this plan is changing hands" and
"Write what a coordinator picking this plan up needs to know." It becomes `action.reason`
(`plan-action-rules.ts` `reassignmentRequestBody`), validated as `z.string().min(1)` with no maximum, and
is appended to `PlanAssignment.reassignmentHistory[].reason` (`src/lib/caring-contacts/assignment.ts:28`,
`:87`) permanently.

I checked what else it reaches, and the pre-existing protections hold: the audit event carries no request
body (`in-memory-repository.ts:340`), and the idempotency fingerprint is SHA-256'd inside
`src/lib/caring-contacts/fingerprint.ts` precisely because request inputs carry patient text. So no new
plaintext store. **The gap is retention.** `admitRetentionClearance` clears `patientDetail` on the plan
(`in-memory-repository.ts:1317`) and touches `assignments` not at all. After clearance, the patient's name,
mobile, identifiers and cultural identity are gone from the plan and a clinician's free-text note about
that handover — which this screen's own prompt invites clinical detail into — is still there, indefinitely.

The field pre-existed. **This diff is the first thing in the product that writes it** (`grep` for
`type: "reassign"` outside the two repositories and the route returns nothing else), which is what turns a
dormant shape into a live one. The screen is honest that the note is permanent ("Kept with the move on this
plan, for good"); nothing says it is permanent in a way that outlasts the erasure of everything else about
the patient.

This is an owner decision, not an implementer fix: either constrain what the prompt asks for, or bring
`reassignmentHistory.reason` under retention clearance. Recording it here because the brief asked what each
mechanism stores incidentally, and this is the answer.

---

### MINOR-1 — a condition is named and documented for a check it does not perform

`plan-action-rules.ts:91` documents `a-different-coordinator-is-chosen` as "A reassignment needs a
destination, **and it may not be whoever already holds the plan**", and its refusal (`:235`) says the choice
"is either empty **or is the coordinator already carrying it**". The predicate (`:352-353`) is
`now.chosenDestination !== ""`. The exclusion is enforced only by the server-built `destinations` list
(`page.tsx:339`).

`destination` is client state that survives a `router.refresh()`, and the props do not resync (see
MINOR-2). After a successful move, the select still holds the previous destination while the refreshed
`destinations` no longer offers it. A second press then sends a move whose `toActorId` is the account that
now holds the plan; `applyAssignment` does not refuse `from === to`, so it appends a handover row saying the
plan changed hands when it did not. A later reader of the assignment history cannot tell that entry from a
real one.

Name the state, not the intent: either check it, or say what the condition checks.

---

### MINOR-2 — the plan state never re-derives from props, and the refusal remedy assumes it does

`plan-actions.tsx:106-109` initialises `plan` from `context`, and nothing ever syncs it again. On the
success path this is right and deliberate — the version comes from the answer. On a refusal path it is
not: `router.refresh()` is not called after a refusal (`:233-235` returns early), and even if it were, a
`useState` initialiser is ignored on re-render.

So after a `stale-version` refusal the screen holds the old version for as long as it stays mounted, while
telling the coordinator "Reading this screen again so it holds the plan as it now stands, then deciding
again." Nothing on the screen performs that re-read. It works if the coordinator navigates away and back or
reloads the browser; it does not work if they take the sentence at face value and press again, which sends
the identical body and receives the identical refusal as a true replay.

---

### MINOR-3 — "in both directions" is claimed and asserted in one

`tests/caring-contacts-patient-overview.dom.test.tsx:1804` — the case titled "tells a version collision
apart from a permission refusal, **in both directions**" produces only a PERMISSION refusal and asserts it
does not read like a collision. The collision case above it asserts its own heading and asserts nothing
about permission wording. The report says "M13 and M14 prove the two wordings are disjoint in both
directions"; M13 proves the collision heading is asserted, which is a different claim.

What is unguarded: an edit that gave `stale-version` the permission remedy — the two `changedBy` strings
are already near-identical in shape — would not redden anything. A coordinator would then be unable to tell
"the plan moved under this screen" from "you may not do this", which is the exact distinction the brief
required.

---

### MINOR-4 — a case is titled for a claim it deliberately does not make

`tests/caring-contacts-patient-overview.dom.test.tsx:1717` — "refuses a withdrawal confirmed after the
acting account changed, **and writes nothing**" ends with `void before; void writes;`. The splitting is
right and the discipline asked for it; the title was not updated, and two locals exist only to be voided.
A later reader trusts the title, and the title claims the clause the sibling case owns.

---

### MINOR-5 — the new audited read has no assertion, and the outcome is announced from a region that did not exist a moment earlier

Two small ones together, both in the "proven where reachable, not where load-bearing" family.

`src/app/caring-contacts/patients/[patientId]/page.tsx:277-281` adds an `auditedRead` of the assignment
with a carefully-reasoned access identity. Nothing asserts it. The only trail assertion in the suite
(`:314`) is `toContainEqual` on the episode row, so replacing `auditedRead` with a bare
`store.getAssignment` would release the assignment with no access record and stay green — in a system whose
stated bargain is that a read that cannot be recorded does not happen.

`plan-actions.tsx:306` mounts `<div role="status">` only when there is an outcome, so the live region is
created together with its content. That is the pattern assistive technology is least reliable about. The
feedback contract's "success **announces** the outcome" is asserted as text presence, which is where it is
reachable in jsdom, not where it is load-bearing. Worth stating as unproven rather than fixing blind.

---

### NIT-1 — the card teaches "hold" and the outcome announces "Pause"

`plan-actions.tsx:309` builds the outcome heading from `planActionLabel`, which returns the frozen row's
label. Every other sentence on the card deliberately avoids "pause" in favour of "hold", for the reason
finding 1 exists. Using the frozen label is defensible; the result is that the one sentence a coordinator
reads after a mutating action uses the vocabulary the rest of the card was written to replace.

### NIT-2 — scope the identifier negative

`tests/caring-contacts-patient-overview.dom.test.tsx:1985` asserts `card.textContent` does not match
`/demo-/` or `/teamLead/`, four lines after asserting the option's `value` attribute IS `demo-coordinator`.
Both are correct — an option value is not rendered to anybody — but the negative's scope should be in the
sentence, because as written the case both forbids and requires the same string.

### NIT-3 — one control carries the forced-colours proof for the card

Same block: `expect(planActionTrigger("pause").className).toContain("forced-colors:")`. `controlBase`
carries `forced-colors:border` so every button in fact has it, and `fieldClass`/`blockClass` carry their
own — but the assertion covers one control while the tap-target assertion beside it loops over all of them.

---

## The mutation ledger — spot-check

**What holds up.**

- The baseline is real and I reproduced it. The report's per-suite baseline is
  `Tests 65 passed (65)`; I ran that suite on the current tree and got `Tests 65 passed (65)`. So the trap
  the discipline names — a red that could be a pre-existing failure — is closed for this round, and the
  rows are attributable.
- **M11, the over-sensitivity control, is correctly predicted for the right reason.** `blockClass`'s
  padding sits on a `<div>` and the tap-target scan reads `className` on `button`, `select` and `textarea`
  only, so no assertion reads that value. Green was the honest answer.
- **M12's observed message names the mutated string** (`'min-h-11 w-full min-w-0 rounded-[var(…'`), which
  is `fieldClass`, and the assertion that fired reads exactly that `className`. Verified end to end.
- **M19's blast radius is explained rather than smoothed over.** The predicted message was wrong because
  `planActionTrigger` refuses on ambiguity before any lookup runs; the report says so and says why thirteen
  cases went with it.
- **M2, M10 and M18 are the three most valuable rows** and all three are recorded as discrepancies. M18
  changed a real test — the resume control was already `aria-disabled` for an unrelated reason, so the
  attribute proved nothing and only the sentence distinguishes the two. That is the ledger doing the job it
  exists for, and the whole ledger was re-run afterwards rather than the other twenty rows being assumed
  unaffected.
- **M10's prediction was wrong and is reported wrong**, with what it therefore does not prove stated, and
  the negative it was aimed at carried to M21. That is the behaviour the discipline says is worth more than
  a right prediction.

**Where the ledger cannot be checked, and it is a real limit.**

- **No row records the mutation text.** The table gives the claim, the prediction and the observed message,
  and no `find`/`replace`. For rows whose observed message quotes the mutated string (M12, M13, M18) I
  could confirm the mutation changed a value some assertion reads. For the rest I could not — including
  M21, where the observed message (`not to match /teamLead/`) implies the mutation ADDED the identifier
  beside the wording rather than replacing it, since replacing it would have failed the positive control on
  the line above first. That is a materially weaker mutation than the row's claim suggests, and nothing in
  the report lets a reader tell which was applied.
- **No per-row commit.** The discipline says "record the commit each row ran against". The report records
  it at round level (`ec4f6b1cb`, both rounds identical) which mostly discharges it, and the baseline I
  reproduced makes it verifiable. Worth doing per row next time.
- **Coverage, not strength, is what the ledger is silent about**, and both defects above sit there.
  MAJOR-3 has no assertion to mutate; CRITICAL-1 has no case to redden.

---

## Privacy

Nothing about a patient travels in a query string, and nothing about a patient crosses the new client
boundary.

- `PlanActionsContext` carries a synthetic plan id, a plan state, a version number, role NAMES, role
  WORDING and four booleans. No patient field, and `page.tsx:323-346` builds it field by field from the
  plan and the assignment rather than spreading either.
- The `ServiceState` incident note cannot reach `plan-actions.tsx`. `ALLOWED_CLIENT_COMPONENTS` was
  extended, and the companion test walks the whole guarded module graph of every entry — so the new
  `plan-action-rules.ts` and its import of `@/lib/caring-contacts/model` are covered, not just the entry
  file. The allowlist addition is properly earned rather than a red test being cleared.
- URLs: both endpoints put the synthetic plan id in the PATH under `encodeURIComponent`, no query string;
  the session read carries nothing. `plans/[planId]/route.ts`'s own header note ("everything that could
  carry patient text stays in the body") is honoured. One case asserts it, with a positive control that the
  URL list is non-empty.
- **What is stored incidentally:** the handover note. The audit event does not carry it and the idempotency
  fingerprint hashes it. It IS stored, forever, in `reassignmentHistory.reason`, and retention clearance
  does not reach it — MAJOR-4.
- The new audited read releases `PlanAssignment`, whose `reassignmentHistory[].reason` is free clinician
  text. Only `ownerId !== null` and a resolved role wording cross to the client; the history does not. That
  is right, and it is the thing that would have been easy to get wrong.
- `getAssignment` gates on `READ_ACTIONS.plan`, the same capability that already released the plan on this
  page, so the page's new fail-closed throw is unreachable in practice. Correct as written.

---

## Repository constraints

Checked, and clean:

- **Domain isolation.** `plan-action-rules.ts` imports `./overlays/definitions` and a type from
  `@/lib/caring-contacts/model`; nothing under `src/lib/caring-contacts/` was touched, and the screen
  re-derives no rule the domain owns — the pause/withdraw asymmetry is read from the domain and quoted, not
  restated as logic.
- **Button wiring.** Every `<button>` acts. The resume control carries `aria-disabled="true"` +
  `ignoreUnavailableActivation` + `aria-describedby` pointing at rendered prose, and never native
  `disabled` alongside it. `eslint-rules/require-button-wiring.mjs` requires an inert handler, not a
  `title`, and its own doc explicitly prefers the described-by reason over a `title` a keyboard user
  reaches only by hovering. No blanket disable anywhere.
- **Tap targets.** `--spacing-tap` is `3rem` = 48px; `controlBase` and `fieldClass` both carry `min-h-tap`,
  the assertion loops over every button, select and textarea in the card, and `min-h-11` is asserted absent.
- **Tokens.** No hex. `forced-colors:` variants on the block, field and control classes.
- **Navigation.** No raw `<a href>`; the only navigation is `router.refresh()`.
- **Vocabulary.** Nothing from the frozen transport list. Role wording reaches the screen as words from
  `CARING_CONTACT_ROLE_WORDING` resolved server-side, with `plans/new/page.tsx` as the existing precedent —
  no raw identifier is rendered.
- **Patient-visible copy.** None authored. Every string on this surface is clinician-facing, and the card
  states once that nothing here can send anything.

---

## What I ran, and what refused

Every line below is pasted. None is reported from an exit code.

**The suite this task changed**, on the current tree, `GATE_RECEIPTS=refresh`:

```
 Test Files  1 passed (1)
      Tests  65 passed (65)
```

**The six suites `test:cc-guards` does not name that cover modules this diff touched** (MAJOR-2):

```
 Test Files  6 passed (6)
      Tests  182 passed (182)
```

**`npm run test:cc-guards`**, `GATE_RECEIPTS=refresh`, independently reproducing the report's headline:

```
 Test Files  18 passed (18)
      Tests  455 passed (455)
```

**Lock refusals.** Every refused attempt in this session took the throwing shape (`Database focused-test
capacity is full … worktree D:\Worktrees\Database\pr-2390-fix`), no `DATABASE_HEAVY_RUN_ADMISSION_BUSY`
marker. All waited out with backoff; no lease was forced and no lock state was touched. A refusal is
neither a pass nor a failure and none is reported as either.

**Not run, and why.** `npm run test`, `npm run build`, `npm run verify:ui`, `tests/ui-caring-contacts-workspace.spec.ts`,
typecheck, lint, `prettier --check`, and anything provider-backed — the controller's, at the merge point.
I have therefore NOT independently verified the report's typecheck, uncached-lint or Prettier lines.

**The two probes.** CRITICAL-1 and MAJOR-1 were reproduced with a temporary file,
`tests/zz-review-probe-task11b.dom.test.tsx`, rendering `PlanActions` + `WorkspaceOverlays` against a
stubbed `fetch`. It was run, its output is quoted above, and it was deleted. `git status --porcelain` is
empty and `git log --oneline -1` is `9a64f7b6f`. I also removed a stray untracked `1/` directory (a Node
compile cache, not anybody's work) that was present in the worktree.

**On `tests/ui-caring-contacts-workspace.spec.ts`:** I agree with the report's assessment and I did not run
it either. That spec seeds no plans, so `EpisodeOverview` and this card are unreachable from it and nothing
it asserts is broken by this task. I also agree with the refusal to add a second `WORKSPACE_SCREENS` entry.
Worth adding to the controller's note: if a plan is ever seeded there, the highest-value browser assertion
is not the 320px full-screen stage — it is that the destination `<select>` and the handover `<textarea>` fit
beside it, because the full-screen stage is the row's stamped modality and that half is already pinned in
`caring-contacts-overlay-host.dom.test.tsx`.

---

## What I would hold the merge for

CRITICAL-1 and MAJOR-1 are code changes and need a scoped re-review of the round that fixes them. MAJOR-3
is a missing assertion on shipped copy and should land with them. MAJOR-2 is discharged by the six-suite run
recorded above — nothing needs re-running, only the report's gate section needs to say what was and was not
run. MAJOR-4 is an owner decision and should go to the ledger rather than hold this task.

The MINORs and NITs are all one-line or one-sentence changes and none of them needs a further review pass on
its own.
