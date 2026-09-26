# Task 11b, fix round 2 — the window after a move, and three assertions that were reading themselves

**Worktree:** `D:\Worktrees\Database\cc-plan-detail` · **Branch:** `claude/caring-contacts-plan-detail`
**Not pushed. No pull request. No subagents dispatched.** The untracked `1/` directory was left exactly
as it was, never staged and never deleted. `docs/caring-contacts/phase-2b-build-record.md` untouched.

**Commits this round**

| SHA           | What                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------- |
| `b255d2ae1`   | MINOR-A: the choice and the note are cleared where the move is recorded, plus three cases |
| `e5c2afa35`   | MINOR-C, MINOR-D's note, NIT-1, NIT-2's clause, NIT-3, NIT-5 — prose and comments only    |
| `42127f1ba`   | The case proving the throw `planActionLabel` survives for (found while answering NIT-2)   |
| `351bdc26b`   | Two assertions re-pinned after mutations showed they were reading themselves              |
| (this report) | Committed last                                                                            |

Every SHA written down in this report was checked with `git cat-file -e <sha>^{commit}`, and
`git log --oneline 0b121f4c3..351bdc26b` returns exactly those four and nothing else.

---

## The headline, because it changes what the review said about it

**MINOR-A was reproduced, not reasoned.** The re-review recorded it as "reasoned from the code, NOT
reproduced", on the grounds that both existing cases call `rereadTheScreen` first and jsdom's
`router.refresh()` is a mock that delivers no props. That is exactly why it IS reachable: because the
mock delivers no props, jsdom sits **permanently** in the window the defect needs. A case that simply
declines to call `rereadTheScreen` is inside it.

Written before the fix, that case went red with the phantom row itself:

```
AssertionError: a handover was appended for a move that had already happened, from an account to itself
- Expected
+ Received
  [
    [ "demo-teamLead", "demo-coordinator" ],
+   [ "demo-coordinator", "demo-coordinator" ],
  ]
```

**What is reproduced is the STATE, not the timing.** In a browser the window closes when the move's RSC
round trip lands, so it is a sub-second race against a two-stage confirmation; in jsdom it never closes.
That distinction is written into the case's own note rather than left for a reader to infer. The
review's judgement that this is narrow in production stands; what it is not is unreachable offline.

---

## MINOR-A — fixed at the source, as ruled

`plan-actions.tsx`, the reassignment success branch. The announcement is taken, then `setDestination("")`
and `setHandoverNote("")`, then the outcome is recorded. Nothing waits for a refresh, and the trigger is
refused after a recorded move by `a-different-coordinator-is-chosen` — whose own wording already covers
the emptied case ("the choice on this screen is either empty or is the coordinator already carrying it").

Three cases, each asserting one thing:

- **`clears the chosen coordinator and the handover note when the move is recorded`** — the two fields,
  each with its positive control taken **before** the act, so the emptiness is what recording did rather
  than what the fixture was.
- **`appends no second handover when the move is confirmed again before this screen has been read back`**
  — the record, read inside the window.
- The pre-existing pair covering the other side (after the re-read) is unchanged and still passes.

**The clearing also closes MINOR-C's incidental store.** The fingerprint ref holding the note in
plaintext is `delete`d on success already; the textarea is now cleared at the same moment, so after a
successful move neither the field nor the ref holds the note. That is a consequence worth naming and not
a reason the fix was made.

---

## MINOR-B — the positive control, and what a mutation found underneath it

Added as ruled. Then the mutation that should have reddened it **reddened the negative instead**, which
means the control had passed — and the reason is a second source for the phrase:

`plan-action-rules.ts` gives `the-plan-is-held` the heading **"Only a plan that is being held can be let
run again"**, and that heading renders **inside the hold block** whenever the plan is running, which it is
in this fixture. So a control written as `/can be let run again/i` passes on the refusal heading while the
explanation beside it could say anything at all. The received text in the mutation run shows both strings
in the same block.

The control now pins the hold explanation's own clause,
`"no date moves, and the plan can be let run again from this screen"`, and the re-run reddens the control
itself (S3b, below). **The finding MINOR-B describes was real; the fix it proposed was one step short of
closing it, and only a mutation showed that.**

---

## MINOR-C — recorded, not changed

`planActionSubmissionFingerprint`'s note now says what the string holds: for a reassignment it contains
`reason` **verbatim** — the free-text handover note — unhashed, and in `JSON.stringify` order rather than a
canonicalising sort, so it is key-order dependent too. It records why both are fine where it is (compared
against a ref in the tab that computed it, deleted on success, never sent, rendered, persisted, or across a
boundary; key order fixed because each builder constructs its literal in one place), and states plainly that
if it is ever persisted, logged, sent, or moved server-side it must be hashed and canonicalised first, as
`src/lib/caring-contacts/fingerprint.ts` does and says it does.

**Not hashed and not restructured, as ruled. No behaviour change, and therefore no mutation row** — a
comment cannot be mutated into a red, and saying otherwise would be exactly the kind of decorative evidence
this method exists to refuse.

---

## MINOR-D — the note corrected, and the missing case written

The ref's note no longer claims the shared key is what stops a second press withdrawing a patient twice. It
now separates the two mechanisms:

- **What the key covers:** the window where nothing has come back yet — two commits racing before either
  answer arrives fingerprint the same body, share one key, and `runWrite` replays the first.
- **What covers the rest:** after a refusal, `refuse()`'s refresh can bring back a newer version, the
  lifecycle body fingerprints differently and mints a new key, so the retry is a NEW submission — and what
  refuses it is the row's own state condition read against the state that same refresh brought back:
  `the-plan-is-running`, `the-plan-is-held`, `the-plan-has-started-and-has-not-ended`, and
  `a-different-coordinator-is-chosen` (which a recorded move now also clears its choice for). The note says
  in terms that relaxing one of those four on the belief that the key stands behind it would remove the only
  guard there is in that case.

The missing case is written: **`refuses the press after a lost answer by the state the re-read brought back,
not by the key`**, with a positive control that the lost write actually landed.

---

## The NITs

- **NIT-1** — the forced-colours comment now names the property rather than a count: `controlBase` on the
  buttons and `fieldClass` on the select and the textarea, both of which the loop reaches, and it says
  plainly that `blockClass`'s variant is on `<div>`s the loop does not reach and is **not** covered here.
- **NIT-2** — `planActionLabel`'s note gains the clause. **And answering it turned up something the NIT did
  not claim:** nothing tested the throw. The one call left discards the result, so removing it would have
  left every assertion about this card green. A case now pins both halves (the card's word for a row that
  exists, and the throw for an id naming no row), and S10 reddens it.
- **NIT-3** — the round-1 ledger preamble now carries R15's first-pass exception explicitly, marked as a
  round-2 correction.
- **NIT-4** — both previously unproven assertions on the R15 case now have their own mutations: S6 for
  `role="status"`, S7 for `toBeEmptyDOMElement()`.
- **NIT-5** — `writes()`'s filter is gone and the invariant is stated where it is read: a session read
  returns before anything is captured, so `sent` holds writes by construction. S9 restores the filter as a
  control and confirms it removes nothing.

---

## What this round changed that nobody asked for, and why

Two assertions were re-pinned in `351bdc26b` because mutations showed they were reading themselves.

- **MINOR-D's heading assertion** read the wording back out of `PLAN_ACTION_CONDITION_REFUSALS` — the same
  map the screen renders from. Rewording that entry moved **both sides together** and the mutation stayed
  green (S5, first pass). It is now a literal, and the re-run reddens it.
- **MINOR-B's positive control** — described above.

**This shape is not confined to what I wrote.** Five pre-existing assertions in this file read a refusal
heading back out of that same map (lines 1747, 1795, 1852, 1999, 2338 as the file now stands). Each is
load-bearing for **which** condition refused, which is a real property; none of them can detect a rewording
of the sentence a clinician actually reads. I have **not** changed them — that is outside this round's four
findings and a final round is the wrong place to widen scope — but it is the standing discipline's
"comparing two reads of one value" family, in the file this task owns, and it is the controller's call.

---

## Mutation ledger

**How presence is proved.** `git status --porcelain --untracked-files=no` clean before and after every
mutation; the anchor must occur **exactly once**; the computed post-image must **differ** from the original;
the file is re-read from disk and asserted **byte-identical** to that post-image. All checks in process —
`grep -c` on this machine silently returns 0 for an argument holding a quote or a brace. Restore uses a
`:(literal)` pathspec. The driver and its ledger live under a **worktree-namespaced** scratch path
(`…/cc-plan-detail-task11b-r2/`), and every line it prints carries `[cc-plan-detail]`.

**Untracked files are excluded from the cleanliness check, deliberately.** This worktree carries an
untracked `1/` directory belonging to another task; including it would refuse every row. Staged and unstaged
changes to tracked files — a concurrent writer, or an unrestored mutation — are still caught, and that
mattered (below).

**Both positive controls fired, each on its own line, and they are distinct failure modes:**

```
[cc-plan-detail] CTRL_NOOP threw: CTRL_NOOP: the mutation of …/plan-actions.tsx matched its anchor and changed nothing
[cc-plan-detail] CTRL_ABSENT threw: CTRL_ABSENT: anchor occurs 0 times in …/plan-actions.tsx -- absent or ambiguous
```

**Selection: every row ran `tests/caring-contacts-patient-overview.dom.test.tsx` alone.** The full guard set
ran once at the end on the final tree.

**Baselines, unmutated, each on the tree named:**

| Tree                       | Baseline                            | What it is                                  |
| -------------------------- | ----------------------------------- | ------------------------------------------- |
| `0b121f4c3` (round's base) | `Tests  75 passed (75)`             | the tree this round started from            |
| pre-fix, cases added       | `Tests  2 failed \| 76 passed (78)` | the MINOR-A reproduction                    |
| `42127f1ba`                | `Tests  79 passed (79)`             | the tree rows S1–S11 ran against            |
| `351bdc26b`                | `Tests  79 passed (79)`             | the tree the S3b and S5 re-runs ran against |

Every attempt is itemised, greens, misaimed rows and unrun rows included. **No aggregate total.**

| #    | The claim the mutation attacks                                                                | Predicted | Observed                                                                                                            | Gate (`Tests`)              | Tree        |
| ---- | --------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------- |
| S1   | MINOR-A: the chosen coordinator is cleared when the move is recorded                          | RED       | **RED** — but 1 case, not the 2 predicted (see below)                                                               | 1 failed \| 78 passed (79)  | `42127f1ba` |
| S2   | MINOR-A: the handover note is cleared when the move is recorded                               | RED       | **RED**, as predicted                                                                                               | 1 failed \| 78 passed (79)  | `42127f1ba` |
| S11  | MINOR-A whole: with NEITHER cleared, the second confirmation appends a from-self handover     | RED       | **RED**, as predicted — the defect as it stood                                                                      | 2 failed \| 77 passed (79)  | `42127f1ba` |
| S3   | MINOR-B: the hold's way back, moved to the withdrawal block                                   | RED       | **RED but MISAIMED** — reddened a pinned sentence earlier in the same case; retired for S3b                         | 1 failed \| 78 passed (79)  | `42127f1ba` |
| S3b¹ | MINOR-B re-aimed, without disturbing the pinned withdrawal sentences                          | RED       | **UNRUN** — 20 consecutive lock refusals; tree restored clean                                                       | —                           | `42127f1ba` |
| S3b² | as above, re-run                                                                              | RED       | **RED, on the NEGATIVE** — which exposed the second source of the phrase                                            | 1 failed \| 78 passed (79)  | `42127f1ba` |
| S3b³ | as above, against the control re-pinned to the hold's own clause                              | RED       | **RED, on the positive control**, as intended                                                                       | 1 failed \| 78 passed (79)  | `351bdc26b` |
| S4   | MINOR-D: the press after the re-read is refused by the row's own state condition              | RED       | **RED** — 2 cases, not the 1 predicted (see below)                                                                  | 2 failed \| 77 passed (79)  | `42127f1ba` |
| S5¹  | MINOR-D: the reason names that condition — by rewording the map entry                         | RED       | **GREEN. The prediction was wrong and the reason is the finding.**                                                  | 79 passed (79)              | `42127f1ba` |
| S5b  | MINOR-D re-aimed by inserting an earlier unmet condition on the hold's row                    | RED       | **RED but MISAIMED and over-broad** — 11 cases; my case failed at its first `waitFor`, not at the heading. Retired. | 11 failed \| 68 passed (79) | `42127f1ba` |
| S5²  | as S5¹, against the heading assertion re-pinned to a literal                                  | RED       | **RED**, as originally predicted                                                                                    | 1 failed \| 78 passed (79)  | `351bdc26b` |
| S6   | NIT-4: the outcome region carries `role="status"`                                             | RED       | **RED**, as predicted                                                                                               | 1 failed \| 78 passed (79)  | `42127f1ba` |
| S7¹  | NIT-4: that region is empty before there is an outcome                                        | RED       | **UNATTRIBUTABLE** — empty output file; see the machine note                                                        | —                           | `42127f1ba` |
| S7²  | as above, re-run                                                                              | RED       | **RED**, as predicted                                                                                               | 1 failed \| 78 passed (79)  | `42127f1ba` |
| S8   | CONTROL: nothing any assertion reads depends on taking the announcement before the two clears | GREEN     | **GREEN**, as predicted                                                                                             | 79 passed (79)              | `42127f1ba` |
| S9   | CONTROL for NIT-5: restoring `writes()`'s session filter removes nothing                      | GREEN     | **GREEN**, as predicted                                                                                             | 79 passed (79)              | `42127f1ba` |
| S10  | NIT-2: `planActionLabel` is read for its throw                                                | RED       | **RED**, as predicted                                                                                               | 1 failed \| 78 passed (79)  | `42127f1ba` |

### Predicted message against observed

- **S1 — predicted RED on two cases, observed RED on one.** Predicted: the field assertion, plus the
  window case, since the destination would still name the new holder. Observed only the field assertion:

  ```
  Error: the choice that has already been acted on is still standing: expect(element).toHaveValue()
  Expected the element to have value:
  Received:  demo-coordinator
  ```

  **Why the second did not redden, and it is worth knowing:** `setHandoverNote("")` still ran, so
  `a-handover-note-is-written` refused the second confirmation before `a-different-coordinator-is-chosen`
  was ever reached. The two clears are **independently sufficient** to close the window. That is why S11
  exists — neither S1 nor S2 alone can redden the record case, and without S11 the record assertion would
  have had no mutation at all.

- **S2** — predicted: the note assertion alone.

  ```
  Error: the note kept with the move that has already been made is still in the field: expect(element).toHaveValue()
  Expected the element to have value:
  Received:  (the note text)
  ```

- **S11** — predicted: both the field assertion and the record. Observed exactly that, the record failing
  with the phantom `["demo-coordinator","demo-coordinator"]` row quoted at the top of this report.

- **S3 — RED, and misaimed.** The mutation inserted the moved phrase **inside** a whole-sentence pin
  ("…and it cannot be undone."), so the case failed two assertions earlier than the control it was aimed at:

  ```
  Expected element to have text content:
    That is the opposite of holding it: nothing is kept to come back to, and it cannot be undone.
  ```

  A mutation proves the assertion it makes fail, not the case it makes red. Retired and rebuilt as S3b,
  appending the phrase after every pinned sentence instead.

- **S3b² — RED, on the negative rather than the control**, which is how the second source of the phrase was
  found. The received text names it:

  ```
  Received: … Hold this plan Let this plan run again Only a plan that is being held can be let run again …
  ```

- **S3b³ — RED on the control**, after re-pinning:

  ```
  Expected element to have text content:
    no date moves, and the plan can be let run again from this screen
  ```

- **S4 — predicted RED on one case, observed RED on two.** The second is pre-existing
  (`refuses a hold on a plan that is not running, and sends nothing`), which reads the same condition. My
  case failed on its own bound message, so the row is still attributable to it:

  ```
  Error: the retry after the re-read was offered rather than refused: expect(element).toHaveAttribute("aria-disabled", "true")
  ```

- **S5¹ — GREEN where RED was predicted, and this is the most useful row here.** The mutation reworded
  `PLAN_ACTION_CONDITION_REFUSALS["the-plan-is-running"].heading`; the assertion read its expected value out
  of **that same map**. Both sides moved together. The assertion could detect **which** condition refused and
  could never detect a rewording — the "comparing two reads of one value" family, written by me, in a round
  whose whole subject is assertions that cannot fail. Reported as a wrong prediction rather than relabelled.

- **S5b — RED, misaimed, and over-broad.** Adding `somebody-is-carrying-this-plan` to the hold's row refused
  the hold in every fixture with no assignment: 11 cases. My own case failed at its **first** `waitFor`
  (`/did not reach the service/i` never appeared, because the write never happened), not at the heading. It
  proves nothing about the heading and is retired rather than counted.

- **S5² — RED**, after the literal pin, with the mutated wording visible:

  ```
  Expected element to have text content:  Only a running plan can be held
  Received:  This plan cannot be held right now. Holding a plan takes it out of running, …
  ```

- **S6** — predicted: the role assertion, the region still being found.

  ```
  expect(element).toHaveAttribute("role", "status")
  ```

- **S7²** — predicted: the emptiness assertion, `role` having passed above it.

- **S8 — GREEN, as predicted, and what it therefore establishes.** Deferring `destinationWording()` until
  after both setters changes no asserted value, because `live.current` is written by an **effect** and not by
  a state setter. So the ordering in the fix is defensive rather than load-bearing, and the comment beside it
  was softened to say exactly that before this control was run.

- **S9 — GREEN, as predicted.** Restoring the filter changes no count, which is the direct evidence for
  NIT-5's claim that it was filtering nothing.

- **S10 — RED**, on the new guard case, `planActionCardName` returning `undefined` instead of throwing.

### The machine, and the two rows it cost

**Lock refusals.** Every refusal this round took the **throwing** shape
(`Database focused-test capacity is full (current owner PID …, worktree D:\Worktrees\Database\<other>)`),
with no `DATABASE_HEAVY_RUN_ADMISSION_BUSY` marker; the detector matches both. S3b's first pass was refused
**20 consecutive times** and is recorded UNRUN rather than forced. **No lease was forced and no lock state was
touched.**

**A worse failure, and the guard that contained it.** During the first batch the machine ran out of process
handles — `bash: /c/Program Files/nodejs/node: Resource temporarily unavailable` — so S7's **restore
invocation never spawned** and its mutation stayed on disk. Two things followed, and both are worth recording:

1. **Every later row refused**, by the clean-tree assertion, rather than applying a second mutation on top of
   an unrestored one. That guard did exactly the job the standing discipline gives it.
2. **S7's own row was unattributable.** Its runner printed `RAN on attempt 3`, but the output file it wrote
   was **empty** — the same shell was failing to spawn. A "RAN" line from a shell that cannot spawn processes
   is not evidence, so the row was discarded and re-run rather than reported. The driver now refuses to count
   any run that produced **no summary line**, retries the restore, verifies it with git, and **aborts the
   batch** rather than continuing on a tree it could not clean.

---

## Gates

Every line below is pasted from the run. None is reported from an exit code.

**`npm run test:cc-guards`**, on the final code tree `351bdc26b`, `GATE_RECEIPTS=refresh`, first attempt:

```
 Test Files  18 passed (18)
      Tests  469 passed (469)
```

That is 465 at the round's base plus this round's four new cases.

**`npx tsc -p tsconfig.json --noEmit`** — exit 0 with no output, and the exit code was read **from tsc**
rather than through a pipe. The first attempt at this measured `tail`'s exit code instead, which is the
wrapper trap in this repository's own ledger; it was re-run correctly and both the code and the empty output
file are the evidence:

```
tsc REAL exit: 0
--- output lines: 0
```

**`npx eslint` over the three changed source and test files, with `node_modules/.cache/eslint` removed
first** — exit 0, no output. Not a formality: uncached lint caught a real
`react-hooks/set-state-in-effect` violation in round 1.

```
eslint REAL exit: 0
```

**`npx prettier --check`** over the three changed files plus the round-1 report:

```
Checking formatting...
All matched files use Prettier code style!
```

**Re-verified after the final edit**, because a gate's verdict covers the tree it saw. The gates above ran on
`351bdc26b`; the only change after them is this report, a Markdown file. `tests/source-control-bytes.test.ts`
reads this archive directory, so it was run once this file existed, and the whole guard set was run again
after it:

```
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

```
 Test Files  18 passed (18)
      Tests  469 passed (469)
```

Both on the tree carrying this report, `GATE_RECEIPTS=refresh`, first attempt each. This report was then
amended in place to paste those two lines, and rather than reason about whether that matters
`source-control-bytes` was run once more afterwards — it is three seconds, and "an edit after the gate voids
the verdict" is the rule this section exists to honour:

```
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

**Not run, and why.** `npm run test`, `npm run build`, `npm run verify:ui`, Playwright, and anything
provider-backed — out of scope by instruction. `check:docs-links` is already red on this branch for
pre-existing references in other documents; it is the controller's at the merge point and I raise no finding
about it.

---

## What this round does NOT prove

- **The timing half of MINOR-A.** The state is reproduced; the race is not. jsdom's window never closes, and
  a browser's closes in one RSC round trip. No offline case can distinguish "the window is narrow" from "the
  window is wide", and this one does not claim to.
- **That the announcement reaches assistive technology.** S6 and S7 prove the region is mounted, empty, and
  carries `role="status"`. jsdom cannot prove an announcement, and the case says so itself.
- **Anything about a browser.** No layout, no forced-colours rendering; those assertions read class names.
- **The five pre-existing read-it-back assertions.** They are named above as a finding, not fixed, and no
  mutation in this ledger addresses them.
- **MINOR-C's claim about what the fingerprint contains.** It is read from the code and from the review's own
  check, not from an assertion: the value never reaches the DOM, so no case in this suite can see it.
