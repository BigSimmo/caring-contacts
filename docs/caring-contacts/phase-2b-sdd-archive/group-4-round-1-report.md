# Group 4 fix round 1 — the false bound, the invisible backlog, and four smaller things

**Status: complete.** Branch `claude/browser-test-gate-handoff-d5c1db`, worktree
`browser-test-gate-handoff-d5c1db`. Nothing pushed, no PR, no subagents. The untracked `1/`
directory at the worktree root was left alone and never staged.

| Commit      | What                                                                        |
| ----------- | --------------------------------------------------------------------------- |
| `6dc16e78e` | MAJOR-1, MEDIUM-2, LOW-3, LOW-4 and the INFO row — source, screen and cases |
| `2ffeb7ab2` | the timestamp case split, so its refusal is not shadowed by a sibling       |
| `e3c8a2f7e` | the two task-report findings that rested on the false bound, marked         |

Every SHA above was checked with `git cat-file -e <sha>^{commit}`. This report is committed on top
of them and its own SHA is in the return message.

---

## MAJOR-1 — the screen stopped claiming a bound the anchor cannot hold

**What was wrong, restated in one line so the fix can be judged against it.** The unclaimed age is
`queueAgeMinutes(dischargeAt, asAt)`, and `dischargeAt` is not an observed instant: the only surface
in the tree that writes one is the plan wizard, and `dischargeInstantFor` pins it to
`DISCHARGE_WALL_CLOCK_HOUR` — midday — on the AWST calendar day a coordinator typed. So the module
header's _"it can raise one early, never miss a late one"_ and the footer's _"the true wait is never
longer than the figure shown"_ described the one failure that actually occurs.

### What the screen says now

Three sentences, and they are the whole of what this screen asserts about that figure.

1. **The age itself**, in the unclaimed block, wherever an age is rendered:

   > The oldest is 145 minutes past the discharge recorded on its plan.

2. **What it is counted from**, rendered in all three unclaimed states — inside the escalation's
   `AutomatedState` reason in the escalated state, and as its own paragraph in the other two:

   > These minutes are counted from the discharge recorded on the plan, because nothing records when
   > a plan became free for a coordinator to take. A plan can therefore show fewer minutes than it
   > has been unclaimed, and reach the threshold later than it should.

3. **The footer**, where the retracted claim used to sit:

   > Each age above is counted from something this system does record — the discharge on the plan, or
   > the contact's scheduled send — because it records nothing about when the work started waiting.
   > Neither figure is the true wait, and neither puts a limit on it.

The false clause is gone from the screen and from `team-workload.ts`'s header, and the header now
carries the reproduction — the three timings, the clamp, and why no fixture could have caught it —
so the next reader meets the property rather than the retracted assurance.

### Two wording decisions, and the reason each went the way it did

**The screen does not say "midday", and that is deliberate.** Naming midday would have been the
plainest possible sentence and it would have been false of some plans: `dischargeInstantFor` is the
only surface that applies the convention, and `demo-seed.ts` records `dischargeAt` as `clock.now()`
— the seeding instant — so a demo server holds discharges at no particular hour. What is true of
**every** plan is that the anchor is a recorded discharge rather than the moment the work became
available, and that is what the screen says. The midday convention, which is what makes the
consequence concrete, is named in the module header and in the tests, where it is true of the thing
being described.

**The backlog wording was left alone.** The review found "45 minutes since its scheduled send" sound
as a naming, and only the _bound_ claim wrong. Changing it would have been churn on a sentence
nobody found fault with.

### What was NOT done, and why

**No queue instant was invented.** Task 17 escalated that as a repository-contract change — release
the plan's creation instant, or add a claimable-since column — and it remains the owner's. Nothing
here re-anchors the escalation. The residual is unchanged and is stated on the screen instead of
being papered over: **on a plan activated the morning of its own discharge day, the escalation still
cannot raise before the recorded discharge is passed.**

### The case that pins the behaviour

`tests/caring-contacts-team-workload.test.ts` gained a describe block that builds its discharge
through **the wizard's own `dischargeInstantFor`** — the one import in that file which reaches out of
the sealed domain, and the point of the block rather than a convenience. Every other fixture in that
file constructs `DISCHARGE_AT` by hand, which is exactly why no test could have found this: the seam
is crossed by no fixture that does not go through that function.

- **"reports zero for a plan unclaimed all morning, because the anchor is midday on the discharge
  day"** — asserts the wizard's instant really is `2026-08-30T04:00:00.000Z` (midday AWST) as its
  positive control, then that a plan seeded against it and read at 11:00 AWST reports an age of `0`
  and a state of `withinThreshold`.
- **"starts counting from that anchor, so nothing escalates until an hour past midday"** — the same
  plan read at 13:00 AWST reports `60` and `escalated`.

Both pin the behaviour; neither endorses it.

---

## MEDIUM-2 — the backlog filed under the person who is not answering

**The evidence was written first, because that is the part the review said was missing.**
`tests/caring-contacts-team-workload.test.ts` now has a case that combines coverage with an exception
backlog: Ava owns a plan with a missed contact, Blake covers it across the instant read, and the case
asserts Blake's `coveringForAnother` is 1 (the positive control that the window really is open),
Ava's backlog is 1, and Blake's is 0. Before it, an edit moving the backlog to the responder passed
the whole suite.

**The screen now states it, and the decision is recorded here.** §4.4's principle — a surface
reporting an automated state says in place what it means — pushed toward saying it, and the sentence
can be said truthfully:

> While a plan is covered, the plan and its contacts needing review stay counted against the
> coordinator who owns it, not against whoever is covering. A coordinator who owns nothing and is
> only covering therefore shows no plans of their own.

It renders only when some row shows coverage in either direction, beside the table and the compact
roster it explains.

**What it deliberately does not say.** It names no plan, no backlog and no person. The read carries
neither the identity of a covered plan nor whether a covered plan has a backlog, so a sentence saying
"there is a backlog you are covering" would be a claim this screen has no data for — the exact shape
of the defect MAJOR-1 was. The general rule is supported; the specific claim is not, so only the
general rule is made.

**Whether the backlog should move to the responder instead is not decided here.** The review called
filing by ownership defensible and I agree with its reason: it keeps the named coordinator visible,
which is the same principle the coverage columns exist for. That remains the owner's call; what has
changed is that it is now stated and proven rather than silent and unproven.

---

## LOW-3 — the ISO timestamp

`Measured at 2026-08-30T11:00:00+08:00` is now `Measured at 11:00 am AWST on Sunday 30 August 2026`.
The machine-readable value is still carried on the `<time>` element's `dateTime` attribute, which is
where a machine reads it, and two cases hold the pair: one that the words are rendered, one that the
ISO string is on the attribute and **not** in the body text.

**Those two started as one case and were split.** Held together, a screen that printed the ISO as its
text would fail the plain-words assertion first and the refusal would never be evaluated — an
assertion behind a sibling that fails first is not proven however red the case goes. `H3` and `H4`
are the two mutations that show the split was load-bearing: each reddens one of them.

The weekday and month arrays are a second copy of the Schedule screen's, and the copy is deliberate:
importing them from `schedule-screen.tsx` would pull that module's whole component graph into this
Server Component's build for two lists of English words that cannot change meaning. The alternative —
a shared wording module — is the better long-term shape and is offered as a follow-up rather than
taken here, because it means editing a file outside the reviewed scope for no behaviour change.

---

## LOW-4 — the covering coordinator who owns nothing

Fixed **by the same sentence as MEDIUM-2**, which is what the review predicted. Its second half — "A
coordinator who owns nothing and is only covering therefore shows no plans of their own" — tells a
reader how to read a `0` in the leftmost column, which is the fact that was missing.

**The alternative I did not take, and why.** A per-row qualifier in the Plans-sending cell ("Owns no
plan") would put the correction where the number is, which is better placement. It needs a condition
distinguishing "owns nothing" from "owns only held plans", it duplicates what the Coverage cell
already says, and it turns a numeric column into prose for one row. The review recorded LOW-4 as not
held against the merge and expected it to share MEDIUM-2's fix; a general sentence that is certainly
true beat a per-row rendering I would be guessing at.

---

## LOW-5 — the ranking-vocabulary loop

The loop refuses `rank`, `percentile`, `score`, `leaderboard`, `busiest`, `quietest` and
`performance`; Task 18 mutated only `busiest`. The other six now have their own rows — `V-rank`,
`V-percentile`, `V-score`, `V-leaderboard`, `V-quietest`, `V-performance` — each inserting its word
into the screen's intro sentence and each reddening with its own named message. **None was
unprovable.** The loop is now seven proofs rather than one.

---

## INFO — the unreachable branch

`const responder = assignment === null ? owner : effectiveResponder(assignment, asAtIso);` is gone.
The dead branch existed because `const owner = assignment?.ownerId ?? null` narrows `owner` but not
`assignment`, so TypeScript still saw a nullable `assignment` below and the ternary was the price.
The guard is now `if (assignment === null || assignment.ownerId === null)`, `owner` is taken from the
narrowed value, and `effectiveResponder(assignment, asAtIso)` is called directly. Behaviour is
unchanged, and `I1` proves the guard still carries the conservative direction: inverted, a plan whose
assignment could not be read throws instead of being counted as unclaimed.

---

## Mutation ledger

Every attempt is itemised, greens included, with **no aggregate total**. Every row ran against commit
`2ffeb7ab2`, on a tree asserted clean by `git status --porcelain` immediately before and after each
row by the driver itself, which restores with `git checkout -- <file>` in a `finally` block.

**The unmutated baseline was re-established on that same tree before the round**, with
`GATE_RECEIPTS=refresh`: `Tests 25 passed (25)` for the workload suite and `Tests 33 passed (33)` for
the roster suite. Both were re-established after it, by the final `test:cc-guards` run below.

**Presence** was proven by byte equality against a computed post-image: `expected =
before.replace(find, replace)`, `expected !== before` asserted, written, re-read from disk, compared
byte for byte — with an occurrence guard requiring the anchor exactly once, run first. All four
driver guards were proven to fire on their own lines before the round began:

| Guard          | What it is                            | Observed                                                                                         |
| -------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `CTRL_NOOP`    | a replacement equal to its anchor     | `CTRL_NOOP: post-image is byte-identical to the original`                                        |
| `CTRL_ABSENT`  | an anchor not in the file             | `CTRL_ABSENT: anchor occurs 0 times in … expected exactly 1`                                     |
| `CTRL_FOREIGN` | a row naming a file off the allowlist | `refused before any file I/O -- src/lib/caring-contacts/message-copy.ts is not on the allowlist` |
| `DUP`          | two rows sharing an id                | `duplicate row id DUP`                                                                           |

The allowlist and the id-uniqueness check both run **before** any file read. The driver lives at a
scratchpad path carrying this worktree's name, and every line it prints carries that name too.

Selection: `W` = `tests/caring-contacts-team-workload.test.ts`, `R` =
`tests/caring-contacts-team-roster.dom.test.tsx`.

| Id              | Mutation                                                    | Sel | Predicted                                                    | Observed                                                                                                  | Match |
| --------------- | ----------------------------------------------------------- | --- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ----- |
| `A1`            | `DISCHARGE_WALL_CLOCK_HOUR` 12 → 8                          | W   | 2 failed; the midday control, then the afternoon age         | 2 failed; `expected '2026-08-30T00:00:00.000Z' to be '2026-08-30T04:00:00.000Z'`, `expected 300 to be 60` | yes   |
| `A2`            | `queueAgeMinutes` loses its `Math.max(0, …)` clamp          | W   | 1 failed; the morning age goes negative                      | 1 failed; `expected -60 to be +0`                                                                         | yes   |
| `A3`            | any unclaimed plan reported as `escalated`                  | W   | 2 failed; the morning state, and the minute-before state     | 2 failed; `expected 'escalated' to be 'withinThreshold'`, twice                                           | yes   |
| `B1`            | `DISCHARGE_WALL_CLOCK_HOUR` 12 → 13                         | W   | 2 failed; the midday control, then the afternoon age         | 2 failed; `expected '2026-08-30T05:00:00.000Z' to be '2026-08-30T04:00:00.000Z'`, `expected +0 to be 60`  | yes   |
| `B2`            | escalation `>=` → `>`                                       | W   | 2 failed; at the threshold, and the afternoon state          | 2 failed; `expected +0 to be 1`, `expected 'withinThreshold' to be 'escalated'`                           | yes   |
| `C1`            | `coveringForAnother += 1` → `+= 0`                          | W   | 2 failed; the coverage case and the new control              | 2 failed; `expected +0 to be 1`, twice                                                                    | yes   |
| `C2`            | the owner's backlog push deleted                            | W   | 3 failed; two backlog cases and the covered-backlog case     | 3 failed; `expected +0 to be 1` twice, `expected +0 to be 2`                                              | yes   |
| `C3`            | the backlog also pushed onto the coverer                    | W   | 1 failed; the coverer's backlog is no longer empty           | 1 failed; `expected 1 to be +0`                                                                           | yes   |
| `I1`            | the unreadable-assignment guard inverted                    | W   | 1 failed; a null assignment reaches `.ownerId`               | 1 failed; `TypeError: Cannot read properties of null (reading 'ownerId')`                                 | yes   |
| `CTRL-GREEN-W`  | a word inside one doc comment                               | W   | **GREEN** — changes no value any assertion reads             | `Tests 25 passed (25)`                                                                                    | yes   |
| `D1`            | the age reworded back to "since the patient was discharged" | R   | 2 failed; the age case and the two-names case                | 2 failed; `Expected element to have text content:`, then `to contain '145 minutes past the discharge…'`   | yes   |
| `D2`            | the footer's honest clause reworded                         | R   | 1 failed; the control on the retraction                      | 1 failed; `to contain 'neither figure is the true wait'`                                                  | yes   |
| `D3`            | the false clause re-added to the footer                     | R   | 1 failed; the refusal fires                                  | 1 failed; `not to contain 'never longer than the figure shown'`                                           | yes   |
| `E1`            | the anchor note's first clause reworded                     | R   | 2 failed; the escalated branch and the within-threshold one  | 2 failed; `to contain 'nothing records when a plan became fr…'`, in both                                  | yes   |
| `E2`            | the anchor note's consequence clause dropped                | R   | 1 failed; the escalated case                                 | 1 failed; `to contain 'reach the threshold later than it sho…'`                                           | yes   |
| `F1`            | the backlog cell renders a count of zero                    | R   | 2 failed; the backlog case and the coverage control          | 2 failed; two `Expected element to have text content:`                                                    | yes   |
| `F2`            | the table's active count off by one                         | R   | 3 failed; the order case, the coverage case, the new control | 3 failed; `expected [ '2', '3', '4' ] to deeply equal [ '1', '2', '3' ]`, then two text-content errors    | yes   |
| `F3`            | the attribution clause reworded                             | R   | 1 failed; the coverage case                                  | 1 failed; `to contain 'stay counted against the coordinator …'`                                           | yes   |
| `F4`            | the covering-coordinator sentence dropped                   | R   | 1 failed; the coverage case                                  | 1 failed; `to contain 'shows no plans of their own'`                                                      | yes   |
| `G1`            | the coverage note rendered unconditionally                  | R   | 1 failed; the no-coverage refusal                            | 1 failed; `not to contain 'stay counted against the coordinator …'`                                       | yes   |
| `H1`            | the `<time>` element replaced by a `<span>`                 | R   | 2 failed; both timestamp cases                               | 2 failed; `expected null not to be null`, then `toHaveAttribute` against null                             | yes   |
| `H2`            | `dateTime` set to the words instead of the ISO value        | R   | 1 failed; the attribute case only                            | 1 failed; `toHaveAttribute("dateTime", "2026-08-30T11:00:00+08:00")`                                      | yes   |
| `H3`            | the am/pm test inverted                                     | R   | 1 failed; the plain-words case only                          | 1 failed; `Expected element to have text content: 11:00 am AWST on Sunday 30 August 2026`                 | yes   |
| `H4`            | the ISO string rendered as the body text                    | R   | 2 failed; the words case, and the ISO refusal                | 2 failed; the text-content error, then `not to contain '2026-08-30t11:00:00+08:00'`                       | yes   |
| `V-rank`        | "rank" inserted in the intro                                | R   | 1 failed; the vocabulary loop on `rank`                      | 1 failed; `the screen uses the word "rank": … not to contain 'rank'`                                      | yes   |
| `V-percentile`  | "percentile" inserted in the intro                          | R   | 1 failed; the loop on `percentile`                           | 1 failed; `the screen uses the word "percentile": … not to contain 'percentile'`                          | yes   |
| `V-score`       | "score" inserted in the intro                               | R   | 1 failed; the loop on `score`                                | 1 failed; `the screen uses the word "score": … not to contain 'score'`                                    | yes   |
| `V-leaderboard` | "leaderboard" inserted in the intro                         | R   | 1 failed; the loop on `leaderboard`                          | 1 failed; `the screen uses the word "leaderboard": … not to contain 'leaderboard'`                        | yes   |
| `V-quietest`    | "quietest" inserted in the intro                            | R   | 1 failed; the loop on `quietest`                             | 1 failed; `the screen uses the word "quietest": … not to contain 'quietest'`                              | yes   |
| `V-performance` | "performance" inserted in the intro                         | R   | 1 failed; the loop on `performance`                          | 1 failed; `the screen uses the word "performance": … not to contain 'performance'`                        | yes   |
| `CTRL-GREEN-R`  | a word inside one doc comment                               | R   | **GREEN** — changes no value any assertion reads             | `Tests 33 passed (33)`                                                                                    | yes   |

**Every row matched its prediction, message and count.** That is unusual enough in this programme to
be worth a caveat rather than a claim: the counts were easy to predict here because the diff is
almost entirely wording, and a wording mutation reddens the assertions that quote the wording and
nothing else. Two rows required thought about the count and are the ones worth reading — `C2`, where
deleting the owner's backlog push reaches three cases including one that expects a zero and stays
green, and `F2`, where an off-by-one on the table's active count reaches the order case, the coverage
case and the new control but not the compact roster, which renders through a different component.

---

## Gates

| Gate                                                                                                 | Result                                                                 |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `npm run test:cc-guards`, `GATE_RECEIPTS=refresh`, final tree                                        | `Test Files  41 passed (41)` / `Tests  904 passed (904)`               |
| `npm run test:e2e -- tests/ui-caring-contacts-workspace.spec.ts --project=chromium`                  | `126 passed (3.2m)`, exit 0, first attempt — no build crash this round |
| `npx tsc -p tsconfig.json --noEmit`, read from tsc and never through a pipe                          | exit 0, no diagnostics — re-run after the last source and test edit    |
| `npx eslint` over the four changed source and test files, `node_modules/.cache/eslint` removed first | exit 0                                                                 |
| `npx prettier --check` over every changed file, including the two reports                            | `All matched files use Prettier code style!`                           |

The guard set was 896 before this round and is 904 after: three cases added to the workload suite and
five to the roster suite, listed in the sections above.

**No lock was forced.** Lock refusals were absorbed throughout the round, in both shapes — the
throwing `acquireHeavyRunLock` form with no `DATABASE_HEAVY_RUN_ADMISSION_BUSY` marker, and the
marker form — and every retry loop used here matched both.

Not run, and deliberately: `npm run test`, `npm run build`, `npm run verify:ui`, and anything
provider-backed. Those are the controller's.

No literal `\b` was written anywhere in this diff, and `tests/source-control-bytes.test.ts` runs
inside `test:cc-guards`.

---

## Concerns, in the order I would want them looked at

1. **The escalation is still wrong, and only the words are fixed.** This round removed a false
   assurance; it did not make the escalation raise on time. On a plan activated the morning of its
   own discharge day, the sixty-minute escalation still cannot fire before the recorded discharge is
   passed, and on the demo seed's plans the anchor is the seeding instant rather than any clinical
   event. **That is a live safety gap on a suicide-prevention roster**, and the only thing standing
   between it and a clinician is a sentence on a screen. Closing it is the repository-contract change
   Task 17 escalated and it is the owner's; I would not let this group be read as having closed it.

2. **The screen's honesty has made it wordier.** The unclaimed block now carries the state, the
   threshold, the count, the age, the remedy, the backlog **and** two sentences about what the age is
   counted from. Task 18 already raised the shorter version of this concern. A reader in a hurry may
   take the number and skip the qualification, which is exactly the failure mode the qualification
   exists to prevent. I do not have a better shape to offer; a designer might.

3. **The demo server proves the wrong branch of what changed.** The browser gate is green on 126
   tests, and almost none of them sees the new copy, because nothing in that isolated server can
   leave a plan unclaimed or claim one. The unclaimed block's anchor note, the coverage sentence and
   the backlog cells are proved offline against real views and never in a browser. The plain-words
   timestamp **is** rendered there, on the empty roster, and is the one new thing the browser saw.

4. **The two month-name arrays can now drift.** `team-roster.tsx` and `schedule-screen.tsx` each hold
   their own copy. They are English month and weekday names and cannot change meaning, but the
   Schedule screen's own comment argues for one copy, and a shared wording module under
   `src/components/caring-contacts/workspace/` is the right follow-up. I kept the diff inside the
   reviewed files rather than editing a screen nobody found fault with.

5. **`dischargeInstantFor` is now imported by a domain test.** That is the point of the anchoring
   cases — the seam has to be crossed by something — but it means a test in the sealed domain's suite
   depends on a component module. If the wizard's convention moves, those two cases fail, which is
   the correct direction; if the module moves, they fail to import, which is noisier than it should
   be. The import is commented in place so the next reader knows it is deliberate.

6. **MEDIUM-2's screen sentence states a general rule where a specific one would help more.** A
   coordinator covering for someone with a backlog is told how the column works, not that there is a
   backlog waiting for them. Saying the specific thing needs the read to carry, per covering actor,
   whether the plans they are covering hold reviewable contacts — a shape change to
   `CoordinatorWorkload`, not a wording change. I did not make it, and I would want the owner to
   decide whether a covering coordinator should see the backlog they have inherited.
