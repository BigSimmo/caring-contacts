# Task 11b, fix round 1 — the silent commit, the key that outlived its submission, and the copy nobody read

**Worktree:** `D:\Worktrees\Database\cc-plan-detail` · **Branch:** `claude/caring-contacts-plan-detail`
**Not pushed. No pull request. No subagents dispatched.** `docs/caring-contacts/phase-2b-build-record.md` untouched.

**Commits this round**

| SHA           | What                                                                           |
| ------------- | ------------------------------------------------------------------------------ |
| `f2d23c425`   | The four behaviour fixes: CRITICAL-1, MAJOR-1, MINOR-1, MINOR-2                |
| `a43bc7728`   | The assertions: MAJOR-3, MINOR-3, MINOR-4, MINOR-5, NIT-1, NIT-2, NIT-3        |
| `8b98e2a17`   | The live-region case R15 exposed as missing — see the ledger's own discrepancy |
| `487cb2ed7`   | The props sync moved out of an effect, after uncached lint failed on it        |
| `9cb661a29`   | A Prettier reflow of one test helper's parameter list                          |
| (this report) | Committed last                                                                 |

Every SHA written down in this report was checked with `git cat-file -e <sha>^{commit}`.

---

## What was decided against the tree, and what I did not relitigate

Every ruling in the brief was implemented as ruled. Two of them turned out to depend on each other in
a way the brief could not have known, and that is recorded in its own section below rather than
silently absorbed. Nothing here contradicted the tree, so nothing was brought back to ask about.

---

## CRITICAL-1 — the bare return, and the audit of every other exit

### What was wrong, confirmed in the tree

`plan-actions.tsx` read `const held = live.current.plan; if (held === null) return;` **in front of both
branches**, and `held` was used only by the lifecycle one. `reassignment` deliberately omits
`this-screen-still-knows-the-plan` (`plan-action-rules.ts`, and the reason is right: the assignment
route's schema is `.strict()` and carries no `expectedVersion`, so declaring the condition would refuse
a move for want of a number the service never asks for). So on that row the bare return was the only
thing that ran, and it ran silently.

### The fix

The version is now read **inside the lifecycle branch**, through
`planLifecycleExpectedVersion(action, held)`, which **throws** for a null plan. The reassignment branch
never calls it and proceeds, which is what the absent condition means.

The throw rather than a refusal, because for the lifecycle rows this state is an internal
contradiction rather than anything a coordinator can produce: every lifecycle action declares
`this-screen-still-knows-the-plan`, it is evaluated against the same live values immediately before,
and for `withdrawal` — the one row with an `await` in between — the post-account recheck re-evaluates
every condition including that one. `overlay-commits.ts` documents what a rejected commit does: the
host re-throws it during render and it reaches `src/app/caring-contacts/error.tsx` rather than the
console, which is the minimum this workspace accepts as "not silent". `planActionConditions` and
`planActionLabel` in the same module already throw for their own contradictions, so this is the
existing convention rather than a new one.

### The audit the ruling asked for: every `return` in `carryOut`

| Exit                        | What it does now                                                                                | Was it silent before?         |
| --------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------- |
| `refusedNow !== null`       | states the named condition refusal, then asks for the screen again                              | no — already named            |
| `acting === null`           | states `ACTING_ACCOUNT_UNREADABLE` by name                                                      | no — already named            |
| `refusedByAccount !== null` | states the named condition refusal                                                              | no — already named            |
| the plan-is-null check      | **removed from the shared path**; the lifecycle half now throws, the reassignment half proceeds | **YES — this was CRITICAL-1** |
| `!sent.ok`                  | states the service's refusal in plain words                                                     | no — already named            |
| falling off the end         | states the recorded outcome and asks for the screen again                                       | no — already announced        |
| the `finally`               | clears `changeOnItsWay` only; it decides nothing                                                | not an exit                   |

So one exit of six was silent, and it is the one the review found. The rule is now written into the
function's own note so the next edit inherits it: **every exit either sends a write and states the
outcome, or states a named refusal.**

### The case that must exist, and did not

`moves a plan whose last answer could not be read, rather than closing and saying nothing`. It drives a
lifecycle write whose answer comes back as `200 {}` — the only way `plan` becomes null — waits for the
card to say so in words, then confirms a move through both stages and asserts that a second request
left the screen, that the outcome region says the plan moved, and that the store's assignment actually
changed hands. Watched fail first: `Expected element to have text content: /now moves to/i`.

The `routeFetch` dispatcher gained a `garble` option for it, alongside the existing `swallow`. The two
model the two degraded transports: `swallow` is "the service acted and the answer never arrived",
`garble` is "the service acted and the answer came back in a shape this screen cannot read". Both let
the real handler run against the real store first.

---

## MAJOR-1 — a key names a submission, and a submission is the action and its body

### The mechanism chosen, and why

The ref is now keyed by action and holds `{ fingerprint, key }`. At each confirmation the request body
is built with a blank key, `planActionSubmissionFingerprint` stringifies it with the key blanked, and
the held key is reused **only if that fingerprint matches**. Otherwise a fresh key is minted. The key
is still deleted on success.

Two alternatives were rejected. Minting per attempt is the defect the key exists to prevent — a
coordinator who presses twice after a timeout withdraws a patient twice. Fingerprinting the _inputs_
(destination, note, version) rather than the _body_ would hold a second copy of what each request
carries, so a field added to either request shape would silently fall outside the submission's
identity; reading the whole body means a new field is part of it without this function being touched.

The blanked key rather than an omitted one keeps the object shape identical whichever key is held,
so the fingerprint of a first attempt and of its retry cannot differ for that reason alone.

### The missing case, and its counterpart

`mints a new key for a corrected submission, so a refusal is not the end of the action` drives a real
`stale-version` refusal from the real store, reads the screen again, and confirms the same action with
the corrected version. It asserts the two writes carried different versions **and different keys**, and
that the hold actually landed. Watched fail first: the second submission never reached
`recorded on the plan`, because the service refused it as `idempotency-key-reused-for-a-different-write`
— the defect reproduced end to end rather than argued.

The existing replay case (same body, transport failure) is the other half and still passes: an
unchanged submission produces an identical fingerprint and keeps its key. Both halves are mutated
separately (R3 and R4) so neither stands in for the other.

### Where I disagree with my predecessor's open question 7, for the record

Its claim was "the retry guarantee is identical either way". It is not. Holding the key per action
preserves the guarantee in the direction where a repeat is harmful and destroys the recoverability in
the direction where the coordinator has corrected something — and the remedy the screen prints for that
refusal ("Reading this screen again … then deciding again") did not clear a ref, so before MINOR-2 it
was not even a remedy a remount would reach without a full browser reload.

---

## MAJOR-2 — the gate-drift diff, done as my own work

`npm run test:cc-guards` on this branch is a hand-maintained list in `package.json` naming eighteen
suites. Listed, and diffed against the Caring Contacts suites that exist in `tests/`:

**The gate names:** `caring-contacts-plan-draft.dom`, `-plan-patient-detail`, `-plan-activation`,
`-plan-wizard.dom`, `-schedule`, `-new-plan-page.dom`, `-explained-automation.dom`,
`-workspace-shell.dom`, `-patients-directory.dom`, `-patient-overview.dom`, `-patients-page.dom`,
`-domain-isolation`, `-interface-vocabulary`, `-retention`, `-overlay-definitions`,
`-workspace-screens`, plus `route-reachability` and `design-system-adoption`.

**Caring Contacts suites that exist and the gate does not name:** `-access-audit`, `-api-handler`,
`-assignment`, `-audit`, `-clock`, `-contact-rescheduling`, `-empty-state.dom`, `-fingerprint`,
`-hospital-events`, `-message-copy`, `-message-policy`, `-migrations`, `-model`,
`-notification-preferences`, `-overlay-host.dom`, `-overlay-trigger.dom`, `-page-access-audit`,
`-pathway-versions`, `-permissions`, `-postgres-repository`, `-referrals`, `-repository`,
`-server-config`, `-server-pool`, `-server-store`, `-service-state`, `-session`, `-simulation`,
`-training`, `-width-state`, `-write-serialisation`.

**Of those, the ones covering a module this round touched, and I ran all of them:**

- `caring-contacts-page-access-audit.test.ts` — the access-audit contract for the exact page whose
  audited read this round asserts.
- `caring-contacts-overlay-host.dom.test.tsx` and `caring-contacts-overlay-trigger.dom.test.tsx` — the
  host and trigger every control on this card goes through.
- `caring-contacts-assignment.test.ts` — the assignment domain, which is where MINOR-1's absent
  `from === to` refusal actually lives.
- `caring-contacts-session.test.ts` — the read performed at commit time.
- `caring-contacts-permissions.test.ts` — the grants the page resolves per action.
- `caring-contacts-api-handler.test.ts` and `caring-contacts-write-serialisation.test.ts` — **added to
  the reviewer's six**, because MAJOR-1's fix depends on `runWrite`'s idempotency fingerprinting and
  these are the suites that hold it. If that behaviour were not what the fix assumes, the fix is wrong.

```
 Test Files  8 passed (8)
      Tests  221 passed (221)
```

`package.json` was **not** edited, as ruled. Four branches are editing that one line and the union is
the controller's to compute at the merge point.

---

## MAJOR-3 — the withdrawal's copy, pinned where it is load-bearing

`says what a withdrawal does to the schedule, in the block that offers it` pins both sentences
verbatim, and — this is the half that matters — **scopes them to the withdrawal block**, located by its
own heading rather than by the card. A card-level negative would pass forever, because the hold block
two inches above says exactly the reassuring thing the withdrawal must not.

The positive control is the hold's own wording asserted PRESENT in the hold block first, so the
negative is about where the sentence is rather than about a phrase this test invented and would never
have found anywhere on the screen.

R9 proves the pin (the sentence softened → red). R10 proves the scope (the hold's reassurance appended
to the withdrawal block, both pins still passing → the negative is what fires).

**Disclosed:** this assertion could not be "watched fail" in the ordinary sense, because the copy it
pins already shipped in the previous round and the assertion passed the moment it was written. Its
proof is the two mutations, not a red first run, and I am naming that rather than implying otherwise.

---

## MAJOR-4 — RECORDED ONLY, no code changed, prompt untouched

Exactly what I verified, at the scope I verified it:

- **Where the note goes.** The `<textarea>` labelled "Why this plan is changing hands" becomes
  `action.reason` in `reassignmentRequestBody`, is validated by the assignment route, and
  `applyAssignmentAction`'s `reassign` branch appends it to `PlanAssignment.reassignmentHistory[].reason`
  and never removes it — a reassignment appends and the module's own note says the earlier owner is
  never deleted.
- **Where it does NOT go, and these hold.** The audit event is assembled from `actorId`, `actorRoles`,
  `teamId`, `action`, `objectType`, `objectId`, `outcome` and `idempotencyKey` — no request body. The
  idempotency fingerprint is hashed. Nothing about the history crosses to the client: the page passes
  `carriedBy.actorId`, `carriedBy.wording` and the destinations list, never `reassignmentHistory`.
- **The gap, which is retention.** `markRetentionCleared`'s staged commit writes `plans` and
  `retentionCleared` and nothing else; `admitRetentionClearance` reasons only about the plan's state and
  dates. `src/lib/caring-contacts/retention.ts` contains no reference to assignments at all. So after
  clearance the patient's name, mobile, identifiers and cultural identity are gone from the plan and a
  clinician's free-text note about the handover is still there, in a store nothing classifies as holding
  patient data.
- **Whose diff makes it live.** `grep` for `type: "reassign"` across `src`, `worker` and `scripts`
  returns the assignment route, the domain's own action type, and this branch's two lines in
  `plan-action-rules.ts`. Nothing else in the product writes that field, so this diff is the first thing
  that does.
- **What the screen says today.** "Kept with the move on this plan, for good." That is true and it is
  not the whole truth: it does not say the note is permanent in a way that outlasts the erasure of
  everything else about the patient.

I changed nothing and I did not touch the prompt.

---

## The MINORs and NITs

**MINOR-1 — the predicate now performs the check its name makes.** `PlanActionState.planIsCarried`
(a boolean) became `planCarriedBy` (the account, or the empty string), because two conditions read it
and only one of them is answered by "is anybody carrying it". `somebody-is-carrying-this-plan` is
`planCarriedBy !== ""`; `a-different-coordinator-is-chosen` is now
`chosenDestination !== "" && chosenDestination !== planCarriedBy`. `PlanActionsContext.carriedBy`
correspondingly became `{ actorId, wording }` — the same identifier/wording split `actingAccount`
already makes, where the identifier is compared and never rendered.

Two cases, split so the refusal and the non-mutation clause each have their own: the second one asserts
the record FIRST, so a mutation reddens it rather than a sibling. Watched fail first — and the failure
showed the defect rather than merely absence: `["demo-coordinator", "demo-coordinator"]` appended to
`reassignmentHistory`, a row saying the plan changed hands when it did not.

**MINOR-2 — closed in the direction I can prove: the screen now performs the remedy it states.**
`refuse()` calls `router.refresh()`, and a monotone effect adopts the plan from props when props are
ahead of what is held (or when nothing is held, which is the unreadable-answer case). Monotone
deliberately: a successful write answers with a version this screen adopts at once, and the server
render that follows may be the one taken before it, so adopting unconditionally would pull the version
backwards and manufacture the exact false collision `no-other-change-to-this-plan-is-on-its-way`
exists to prevent.

The case proves both halves and each has its own mutation: R6 removes the refresh (the refusal-path
half), R7 removes the sync (the landing half). R8 is an honest **green** control — removing the
monotonicity changes nothing offline, because `router.refresh()` is a mock in jsdom and no re-render
follows it, so the monotone guard is reasoned rather than evidenced. Stated rather than glossed.

**MINOR-3 — the other direction added as its own case.** `and the other way round: a version collision
does not read like a permission refusal`, with the collision's own wording asserted present first as a
positive control. R11 gives `stale-version` the permission remedy and it reddens.

**MINOR-4 — retitled and cleaned.** The account-continuity case is now
`…and names that refusal`; its sibling owns the writes-nothing clause. Both locals that existed only to
be voided are gone, and so is the one remaining `void writes;` in the replay case, which was the same
smell one case over.

**MINOR-5 — both halves, and the second labelled honestly.** The audited read of the assignment is
asserted as its own access-trail row (`{ kind: "view", objectType: "plan", objectId: <plan> }`),
distinguished in the same case from the plan list's `{ kind: "search", … objectId: "all" }` row so the
two cannot be confused. R12 replaces `auditedRead` with a bare `store.getAssignment` — the exact
substitution the review named — and it reddens.

The live region is now mounted unconditionally. **jsdom cannot prove that an announcement reaches
assistive technology**, so this is correctness by construction, not by evidence. What jsdom _can_ prove
is that the region exists and is empty before any action, and that is asserted and mutated (R15). The
`toBeInTheDocument()` settle in the sibling non-mutation case became `not.toBeEmptyDOMElement()`,
because a region that is always mounted settles that wait instantly and would have raced the assertion
behind it.

**NIT-1 — the outcome speaks the card's language.** `planActionCardName` returns this screen's word for
each action ("Hold this plan", "Let this plan run again", "Record a withdrawal", "Move this plan") and
still reads the frozen row first, so an action naming no row throws exactly as before. **The frozen row
is not edited**; it is simply not quoted in the one sentence a coordinator reads after a mutating
action. Pinned with the frozen label asserted to be "Pause" as the positive control, so the negative is
between two real strings. R13 reverts it and the case reddens.

**NIT-2 — the scope is now in the assertion.** `card.textContent` is bound to `renderedWords` with a
message naming what the negative is about, and the comment states plainly that an `<option>`'s `value`
is required to BE the identifier and is not rendered text. The case no longer reads as forbidding and
requiring the same string.

**NIT-3 — every control, not one.** The forced-colours assertion now loops the same collection the
tap-target assertion beside it does, with the control named in the failure message. R14 removes the
variant from `fieldClass` and it reddens on the `<select>`.

---

## Two fixes that turned out to depend on each other

MAJOR-1's new case cannot exist without MINOR-2's fix, and this is worth stating because it is not
obvious from the rulings. A _corrected_ lifecycle submission is only possible if the body can change,
and the only field of a lifecycle body a coordinator can change is `expectedVersion` — which only moves
when the screen re-reads itself. Before MINOR-2 there was no way, from a mounted screen, to submit the
same action with a different body at all.

They are still mutated separately (R3 for the key, R7 for the sync), so neither is standing in for the
other in the evidence.

---

## Verification

**Every summary line below is pasted. None is reported from an exit code, and no gate is reported from
a receipt.**

### The `test:cc-guards` set — on the final tree, `GATE_RECEIPTS=refresh`

Run as the gate's own command, argument for argument — `node scripts/run-vitest.mjs run
--reporter=dot <its eighteen paths>`, read out of `package.json` rather than retyped — wrapped only in
a retry loop that re-invokes it on a lease refusal and never forces one. Saying that rather than
"I ran `npm run test:cc-guards`", because they are not literally the same keystrokes.

```
 Test Files  18 passed (18)
      Tests  465 passed (465)
   Duration  124.81s (transform 3.27s, setup 2.22s, import 12.94s, tests 141.83s, environment 8.71s)
```

### Typecheck

`npx tsc -p tsconfig.json --noEmit`, on the final tree: no diagnostics, exit 0. Run four times across
the round; the last after every source edit.

### Lint, uncached

`node_modules/.cache/eslint` removed first, then `npx eslint --format json` over the four changed
source and test files. The JSON names the files it examined, so this is not an exit code standing in
for a run:

```
eslint exit=0
files examined: 4
page.tsx                                          errors 0 warnings 0 []
plan-action-rules.ts                              errors 0 warnings 0 []
plan-actions.tsx                                  errors 0 warnings 0 []
caring-contacts-patient-overview.dom.test.tsx     errors 0 warnings 0 []
```

**This gate did NOT pass first time, and what it caught is worth the paragraph.** The props sync added
for MINOR-2 was written as a `useEffect` calling `setPlan`, and uncached lint failed it:

```
plan-actions.tsx errors 1 warnings 0 ["react-hooks/set-state-in-effect: Error: Calling setState
synchronously within an effect can trigger cascading renders ... Avoid calling setState() directly
within an effect"]
```

The rule is right and the fix is React's own documented shape for state that must change when a prop
does: compare the props against what the server last said and adjust **during render**, which is one
render rather than two. `487cb2ed7`. The brief told me to treat the previous round's lint line as
unestablished; this is what running it from scratch found.

### `prettier --check`

Over every changed file including this report, on the final tree:

```
Checking formatting...
All matched files use Prettier code style!
```

It also did not pass first time — the test file and this report both needed reflowing. The test file's
reflow is `9cb661a29`, and it is line wrapping of one helper's parameter list and nothing else
(`git diff` for that commit is five lines of whitespace).

### The nine suites `test:cc-guards` does not name (MAJOR-2), on the final tree

The reviewer's six, plus `caring-contacts-api-handler` and `caring-contacts-write-serialisation`
(MAJOR-1's fix depends on `runWrite`'s idempotency fingerprinting and those are the suites that hold
it), plus `source-control-bytes` — which turned out to scan this very archive directory, so it reads
this report and the previous one's claim that "nothing reads anything under `phase-2b-sdd-archive/`"
is **wrong**. It is named here so the correction is on the record.

```
 Test Files  9 passed (9)
      Tests  228 passed (228)
```

### Not run, and why

- `npm run test`, `npm run build`, `npm run verify:ui`, `npx playwright test`,
  `tests/ui-caring-contacts-workspace.spec.ts` — out of scope by instruction; the controller's at the
  merge point. My assessment of that Playwright spec is unchanged from the previous round: it seeds no
  plans, so this card is unreachable from it, and I would not add a second `WORKSPACE_SCREENS` entry.
- Anything provider-backed — not approached.
- `npm run verify:cheap` and `check:docs-links` — not asked for, and out of the brief's gate list.
  Worth knowing that `scripts/check-docs-links.mjs` resolves backticked paths inside docs, so this
  report is input to it at the merge point.
- **The previous round's typecheck, lint and Prettier lines were treated as unestablished**, as
  instructed, and all three were run here from scratch. Lint and Prettier both failed on this round's
  tree before they passed; both failures are recorded above rather than smoothed away.

---

## Mutation ledger

**The driver is this branch's shape, rewritten in this worktree's own namespaced scratchpad directory
(`…/scratchpad/cc-plan-detail/mutate.mjs`), because the previous round's driver is gone and the only
one left on this machine belongs to a different task. That is the foreign-row hazard the discipline
names, and copying it was not an option.** Every guard is kept, in the order they run: each row's
`file` is validated against an **allowlist of the four files this task may mutate** and each row's
`id` for uniqueness, **both before any file I/O at all**; the tree is asserted `git diff --quiet`
clean before a mutation and again after restoring it; the anchor must occur **exactly once**; the
computed post-image must **differ** from the original; and the file is re-read from disk and asserted
**byte-identical** to that post-image. The presence check is done in process — `grep -c` on this
machine silently returns 0 for an argument containing a quote or a brace. `git checkout` restores with
a `:(literal)` pathspec, because the page's path contains `[patientId]` and git would otherwise read
the brackets as a character class and restore nothing.

**Both positive controls fired, each on its own line**, and they are distinct failure modes:

```
CTRL_NOOP threw: the mutation of …/plan-actions.tsx matched its anchor and changed nothing
CTRL_ABSENT threw: anchor occurs 0 times in …/plan-actions.tsx -- absent or ambiguous
```

**Selection: every row ran `tests/caring-contacts-patient-overview.dom.test.tsx` alone** — the suite
every one of these mutations targets. The whole guard set was run once at the end on the final tree,
which is what catches collateral damage a narrowed run cannot see.

**Every row in the table below ran against `487cb2ed7`, and the baseline was re-established on that
same tree**, unmutated — **with one exception, and it is the row this ledger turns on.** R15's FIRST
pass ran against `a43bc7728`, before the case it exists to falsify had been written; that is why its
cell reads `74 passed (74)` where every other cell counts 75, and it is the wrong prediction recorded
below rather than an attribution slip. R15's second pass ran against `487cb2ed7` like the rest.
_(Corrected in fix round 2, answering NIT-3 of the round-1 re-review.)_

The baseline on `487cb2ed7`:

```
 Test Files  1 passed (1)
      Tests  75 passed (75)
```

The tree moved twice during the round (`8b98e2a17`, then `487cb2ed7`), and rather than carry rows
attributed to an earlier commit **the whole ledger was re-run from scratch on the final tree**. Only
the Prettier reflow `9cb661a29` lands after it, and its entire diff is the line wrapping of one test
helper's parameter list — no assertion, no anchor, no behaviour.

**Lock refusals:** every refusal in this round took the throwing shape (`Database focused-test capacity
is full … worktree D:\Worktrees\Database\<other>`), with no `DATABASE_HEAVY_RUN_ADMISSION_BUSY` marker;
the detector matches both. One row needed **eleven** attempts and one earlier run needed **sixteen**,
behind an exclusive `npm run build:internal` in the main repo with a Playwright run queued ahead of it.
All were waited out. **No lease was forced and no lock state was touched.** No row is UNRUN.

Every attempt is itemised, greens included. **No aggregate total** — the table is the evidence.

| #   | The claim the mutation attacks                                                          | Expected | Got                                                                                         | Gate (`Tests`)                                 |
| --- | --------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| R1  | CRITICAL-1: a confirmed move proceeds when this screen has lost the plan's version      | red      | **RED**, as predicted                                                                       | 1 failed / 74 passed (75)                      |
| R2  | CONTROL: the lifecycle null case is unreachable, so its throw is untested               | green    | **GREEN**, as predicted                                                                     | 75 passed (75)                                 |
| R3  | MAJOR-1: a CHANGED submission is a new submission and gets a new key                    | red      | **RED**, as predicted                                                                       | 1 failed / 74 passed (75)                      |
| R4  | MAJOR-1, the other half: an UNCHANGED submission keeps its key, so a retry is a replay  | red      | **RED**, as predicted                                                                       | 2 failed / 73 passed (75)                      |
| R5  | MINOR-1: the destination may not be the account already carrying the plan               | red      | **RED**, as predicted                                                                       | 2 failed / 73 passed (75)                      |
| R6  | MINOR-2, half one: a commit-time refusal asks for this screen again                     | red      | **RED**, as predicted                                                                       | 1 failed / 74 passed (75)                      |
| R7  | MINOR-2, half two: what the server answers with lands in what the next decision acts on | red      | **RED**, and it reddened a SECOND case — see below                                          | 2 failed / 73 passed (75)                      |
| R8  | CONTROL: the monotone half of that sync is not reachable offline                        | green    | **GREEN**, as predicted                                                                     | 75 passed (75)                                 |
| R9  | MAJOR-3: the withdrawal says the schedule is destroyed rather than kept                 | red      | **RED**, as predicted                                                                       | 1 failed / 74 passed (75)                      |
| R10 | MAJOR-3, the scope: the hold's reassuring wording does not reach the withdrawal block   | red      | **RED**, as predicted                                                                       | 1 failed / 74 passed (75)                      |
| R11 | MINOR-3: a version collision does not borrow the permission refusal's remedy            | red      | **RED**, as predicted                                                                       | 1 failed / 74 passed (75)                      |
| R12 | MINOR-5: the read of who is carrying the plan is recorded on the access trail           | red      | **RED**, as predicted                                                                       | 1 failed / 74 passed (75)                      |
| R13 | NIT-1: the outcome announces the action in the card's vocabulary, not the frozen row's  | red      | **RED**, as predicted                                                                       | 1 failed / 74 passed (75)                      |
| R14 | NIT-3: every control on the card carries a forced-colours variant, not just one         | red      | **RED**, as predicted                                                                       | 1 failed / 74 passed (75)                      |
| R15 | MINOR-5: the region that announces an outcome is mounted before there is one            | red      | **GREEN on its first pass — the prediction was wrong, and why is the most useful row here** | 74 passed (74), then 1 failed / 74 passed (75) |

### Predicted message against observed

- **R1** — predicted: _the move says nothing, so the outcome region still shows the hold_

  ```
  Expected element to have text content:
    /now moves to/i
  Received:
    Hold this plan — recorded on the planWhy: This plan is now being held … The answer itself could
    not be read here, so this screen cannot say which version of the plan it now stands at …
  ```

  That received text **is the defect**: the previous action's message still standing while a
  two-stage confirmation closed and sent nothing.

- **R2 — GREEN, and what it therefore does not prove.** Replacing the throw with `return 1` moves no
  value any assertion reads, because no case can reach a lifecycle write with a null plan — the guard
  refuses it by name first. That is the reason the throw is a throw rather than a refusal, and it is
  also the reason the throw is **untested rather than covered**. Labelled as an over-sensitivity
  control, not as evidence for the fix.

- **R3** — predicted: _the corrected submission is refused as a key reuse and never lands_

  ```
  Expected element to have text content:
    /recorded on the plan/i
  Received:
    Hold this plan — This no longer matches the request it is retryingWhy: The key this screen holds
    for this action was recorded against a different set of answers, so the service refused it rather
    than treating it as a retry …
  ```

  The review's MAJOR-1 reproduced verbatim, from the real store.

- **R4** — predicted: _the reassignment history holds two entries_
  - failing: `moves the plan once when the answer is lost and the coordinator presses again`, and its key sibling
  - observed: `AssertionError: expected [ [ 'demo-teamLead', …(2) ], …(1) ] to deeply equal [ [ 'demo-teamLead', …(2) ] ]` — the duplicate **record**, which is what the case was split to redden
  - and: `expected 'PLAN-REASSIGNMENT-embmejdalcobedacjbh…' to be 'PLAN-REASSIGNMENT-jlkjjkkofigleomllgc…'`

- **R5** — predicted: _the move to the current holder is offered rather than refused_
  - observed: `expect(element).toHaveAttribute("aria-disabled", "true") // element.getAttribute("aria-disabled") === "true"`
  - and in the record half: `expected [ [ 'demo-teamLead', …(1) ], …(1) ] to deeply equal [ [ 'demo-teamLead', …(1) ] ]` — the phantom `["demo-coordinator", "demo-coordinator"]` handover appended

- **R6** — predicted: _nothing asks the server for this screen again_
  - observed: `AssertionError: expected "vi.fn()" to be called at least once`

- **R7 — REDDENED TWO CASES, AND THE SECOND ONE IS INFORMATIVE.**
  - predicted: _the resume control is not live, so nothing lets the plan run again_
  - observed: `Expected element to have text content: /running again/i` / `Received: Hold this plan — This plan changed after this screen read it …`
  - the second failing case is `mints a new key for a corrected submission`, and that is not collateral
    noise: a corrected lifecycle submission is only possible if the body can change, and the only field
    of a lifecycle body a coordinator can change is the version. See "Two fixes that turned out to
    depend on each other" above. The two fixes still have separate rows (R3 attacks the key, R7 the
    sync), so neither is standing in for the other.

- **R8 — GREEN as predicted.** `router.refresh()` is a mock in jsdom and no server re-render follows
  it, so nothing offline distinguishes a monotone adoption from an unconditional one. The monotone
  rule is reasoned from what the service answers, and it is not evidenced here.

- **R9** — predicted: _the withdrawal's pinned sentence is gone_

  ```
  Expected element to have text content:
    That is the opposite of holding it: nothing is kept to come back to, and it cannot be undone.
  Received:
    Record a withdrawal the patient asked forA withdrawal ends the plan … That is much the same as
    holding it: the schedule is kept, and it can be undone. …
  ```

- **R10** — predicted: _the hold's reassurance appears inside the withdrawal block_
  - observed: `Error: the withdrawal block took on the hold's reassuring wording: expect(element).not.toHaveTextContent()`
  - both verbatim pins still passed, which is what isolates this row to the scope rather than the copy.

- **R11** — predicted: _the collision refusal now reads like a permission refusal_
  - observed: `AssertionError: expected 'Hold this plan — This plan changed af…' not to match /acting in a role that is granted it/i`

- **R12** — predicted: _the assignment is released with no access record_
  - observed: `AssertionError: expected [ …(3) ] to deep equally contain ObjectContaining{ "kind": "view", "objectId": "plan-actions", "objectType": "plan", "outcome": "allowed" }` — three records left, and the one this round added is not among them.

- **R13** — predicted: _the outcome heading reverts to the frozen label_

  ```
  Expected element to have text content:
    Hold this plan — recorded on the plan
  Received:
    Pause — recorded on the planWhy: This plan is now being held …
  ```

- **R14** — predicted: _a control loses its forced-colours variant and the loop finds it_
  - observed: `AssertionError: Nobody chosen yeta coordinator accounta team lead account disappears in forced colours: expected 'min-h-tap w-full min-w-0 rounded-[var…' to contain 'forced-colors:'`
  - the control reads as run-together option text because a `<select>`'s `textContent` is its options.
    Ugly, unchanged from the previous round's M12, and it still names the control.

- **R15 — THE PREDICTION WAS WRONG, AND THE REASON IS THE POINT OF THE WHOLE METHOD.**
  - predicted: RED; observed on its first pass: **GREEN, `Tests 74 passed (74)`.**
  - Why: the case this row exists to falsify had been **planned and never written**. I had described it
    in my own plan for MINOR-5, implemented the unconditional mount, and moved on. The mutation had no
    assertion to reach. **A mutation can only falsify a test that exists**, and the ledger is the only
    thing in this round that would have caught the omission — no gate could, because everything was
    green.
  - The case was then written (`8b98e2a17`), the baseline re-established, and the row re-run:
    `Test Files 1 failed (1)` / `Tests 1 failed | 74 passed (75)`, observed
    `TestingLibraryElementError: Unable to find an element by: [data-testid="caring-contacts-plan-action-outcome"]`.
  - It is recorded as a wrong prediction rather than relabelled, because the wrongness is the finding.

---

## What this round does NOT prove

- **Nothing here is browser evidence.** jsdom has no layout. The tap-target and forced-colours
  assertions read class names; the modality assertion reads a stamped attribute.
- **The live region's announcement.** See MINOR-5 above. The mount is proven; the announcement is not
  provable in jsdom.
- **The monotone half of the props sync** (R8, green). No offline case distinguishes it, because
  `router.refresh()` is a mock and no server re-render follows it.
- **`planLifecycleExpectedVersion`'s throw** (R2, green). The state is unreachable through the guard,
  which is why it throws rather than refusing — but it also means no case reddens when the throw is
  replaced by a fallback. The honest label is _untested_, not _covered_.
- **`router.refresh()` is proved REQUESTED, never proved to have arrived.** Unchanged from the previous
  round. What the card states does not depend on it.
- The refusal wordings with no case remain as the previous round listed them.

---

## Concerns I am handing up

1. **MAJOR-4 is unresolved and is yours.** Recorded above at the scope I checked it.
2. **The `1/` directory in the worktree.** An untracked Node compile-cache directory
   (`1/v24.19.0-x64-…`) exists at the worktree root. It is not mine and it is not staged. I did not
   delete it — nothing in this task authorised removing anything from the worktree.
3. **`test:cc-guards` still does not name the nine suites above.** Left alone as ruled; the union is
   yours at the merge point.
4. **`node scripts/check-docs-links.mjs` is ALREADY RED on this branch, for seven pre-existing
   references, and none of them is mine.** I ran it because it resolves backticked paths inside docs
   and this report is input to it. The seven are other documents': the Task 11b review names
   `tests/zz-review-probe-task11b.dom.test.tsx`, the probe it created, quoted and deleted; the Task 12
   and 13 briefs name reports that do not exist yet; Task 9's report names a scratch probe; Task 9b's
   names a `tsc` diagnostic fragment that parses as a path. Several are the same shape the script's own
   `SCOPED_ALLOWLIST` already carries entries for. Not mine to fix and not in this round's scope, but it
   will fail at the merge point if nothing is done, and the review's probe is the newest of them.
