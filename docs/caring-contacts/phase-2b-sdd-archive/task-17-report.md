# Task 17 — the team read

**Status: complete.** Branch `claude/browser-test-gate-handoff-d5c1db`, nothing pushed, no PR, no
subagents. The untracked `1/` directory at the worktree root was left alone.

| Commit      | What                                                                          |
| ----------- | ----------------------------------------------------------------------------- |
| `e90811947` | `buildTeamWorkload` in the sealed domain, and its suite                       |
| `7fcf7504c` | the HTTP boundary, the `teamWorkload` audit member, both suites into the gate |
| `bee416599` | Prettier                                                                      |
| `71863cbeb` | the roster's privacy absences given their positive controls                   |

---

## What was built

`src/lib/caring-contacts/team-workload.ts` — `buildTeamWorkload(ownership, asAt)`, pure, taking the
plans and assignments a caller has already read and returning:

- **`coordinators`**, one row per actor carrying work: `activePlans`, `heldPlans` (owned plans held
  by their own plan state, with the hold named), `coveredByAnother`, `coveringForAnother`, and an
  `exceptionBacklog` of `{ contacts, oldestMinutesSinceScheduledSend }`.
- **`unclaimed`**: `plans`, `escalated`, `oldestMinutesSinceDischarge`, a `state` of
  `noUnclaimedWork` / `withinThreshold` / `escalated`, a `clearedBy` naming what ends it, and its
  own `exceptionBacklog` so a reviewable contact on an unowned plan cannot go uncounted for want of
  an owner to file it under.
- **`thresholdMinutes`**, republished from `UNCLAIMED_ESCALATION_MINUTES`, and `asAtIso`.

`src/app/api/caring-contacts/team/route.ts` — `GET`, through the shared `readHandler`, joining
`listPlans` to each plan's `getAssignment` and handing the pair to the roll-up.

## Where the roll-up went, and why

**The sealed domain**, not the API layer. The plan asks for the reason either way, so here it is in
full.

The isolation constraint genuinely does not settle it: this is an aggregation over existing rules,
not a new rule, and `operational-reporting.ts` and `schedule-view.ts` are both aggregations that sit
in the domain while nothing forbids a route from assembling one. Two things decided it:

1. **Every rule it composes is already owned in the domain** — the escalation threshold and the
   queue-age arithmetic (`assignment.ts`), who is actually answering for a plan
   (`effectiveResponder`, same file), whether a plan's own state holds it (`planSendingHold`,
   `schedule-view.ts`), and which contact states a person has to look at (`needsOperationalReview`,
   same file). Assembling those in a route puts a screen's read one edit away from re-deriving a rule
   a module owns, which is the thing the constraint exists to stop — and the brief is explicit that
   the constraint binds a route as much as a component.
2. **There will be more than one reader.** Task 18's Team screen is a Server Component that will read
   this directly rather than calling itself over the network, exactly as
   `src/app/caring-contacts/patients/page.tsx` already does. `schedule-view.ts` gives that same
   reason in its own header and it is the stronger of the two: two readers must get one answer, and
   the only way to guarantee that is for there to be one answer.

**Not added to `operational-reporting.ts`**, which would have been the nearest home. That module's
header states as a property that "no function in this file takes, returns, or groups by an actor" —
a team roster groups by actor, so putting it there would have falsified the module's own note in the
act of reusing it.

**No repository method and no second store read.** Team scoping comes free from two reads that are
already scoped identically (`getAssignment` gates on exactly the predicate `listPlans` filters by),
which is the scoping property this domain guards hardest. The cost is one assignment read per listed
plan — stated in the module header rather than hidden. If that becomes the wrong trade the fix is a
repository method returning the pairs, which is a contract change with its own review (Ruling
[124]'s shape), not a second aggregation.

## The `AccessedObjectType` decision (Ruling [46] vs Ruling [134])

**A new member, `teamWorkload`, added deliberately** — and decided from Ruling [134]'s reasoning
rather than Ruling [46]'s wording, because Ruling [134] says in terms that when the two point
different ways the reasoning is the ruling.

Ruling [134] collapsed the Templates library into `pathwayVersion` because that read was
**byte-identical** to one that already existed, so a second member would have named a _screen_ rather
than an object and split one askable question into two. The test it establishes is identity, not
provenance.

This read is not identical to anything. No existing read joins `listPlans` to every plan's
`getAssignment`; the per-plan assignment route records one plan at a time under `plan` with that
plan's own id. Recording the roster as `plan` would drop "who looked at how work is distributed
across the team" into the caseload's stream — and with no `objectId` filter on the trail's query
surface, it could then be picked out by eye and never _asked for_. That is Ruling [46]'s actual
reason, and it reaches here.

The member also names an object rather than a screen: the team's ownership state is a thing that
exists whether or not the Team screen does. The access-trail route's hand-copied `z.enum` was updated
in the same commit; `tests/caring-contacts-schedule-route.test.ts`'s set-equality pin covers the two
staying in step and was re-run green.

## Spec §4.2 — this read never ranks clinicians

Held as a constraint on the shape, not only on the wording:

- Rows are ordered by **actor id and nothing else**. The case that pins it uses a fixture whose work
  order is the exact reverse (Ava 1 plan, Blake 2, Cass 3), so an order that followed the counts could
  not pass by coincidence — proven by `M2`, which replaced the comparator with a work-descending sort
  and produced `expected [ 'ACTOR-CASS', 'ACTOR-BLAKE', …(1) ] to deeply equal [ 'ACTOR-AVA', …`.
- **No derived comparison exists to render**: no share, no percentile, no rank, no team total for a
  row to be divided by. `M20` added a `share` field and the refusal fired.
- Every number is a count of **work**: how many plans are here, how many contacts are waiting, how
  long the oldest has waited. None is a number about a person.

## §4.4 — explained automation

The one place this read says the system acted on its own is the escalation, so that is where the
shape has to carry both halves. `unclaimed.state` says which of the three situations it is in;
`unclaimed.clearedBy` names what ends it and is `null` only when there is nothing to clear;
`thresholdMinutes` and `oldestMinutesSinceDischarge` give the screen the two numbers the sentence
needs. Both halves are enum values or numbers, never sentences — interface wording is Task 18's.

A contact's own reason for needing review is deliberately **not** restated here. It is on the
schedule read (`ScheduleEntry.state`, `notSendingReason`), which is where a screen goes to act on
one; a second answer to the same question is the thing this method keeps finding.

## Privacy

`getEpisode` is never called, and a test proves the double it is watched with actually fires. The
response carries no patient id, no plan id, no contact id, no name and no mobile number — each
asserted against a positive control from a source that demonstrably holds it. The route takes **no
parameters at all**, so nothing about a patient can travel in a query string; a request carrying one
is answered identically and the trail records `objectId: "all"` either way.

The absence with the most teeth is the **handover note**. `reassignmentHistory[].reason` is free text
a clinician types when moving a plan, and the whole-branch review recorded (Ruling [139] MAJOR-4)
that it is stored permanently and that a retention clearance does not touch it. It is the one piece
of patient-adjacent text this read's _input_ actually holds, so a roster is precisely the surface
that would carry it onto a screen by accident. It is now asserted absent against a fixture that
really has one, and `M17` — which leaked the history onto the view — made that assertion red.

---

## Findings — things the approved design or the plan needs and the tree does not have

Reported rather than designed, per the brief. Ruling [72] flagged this group as the one most likely
to want more than the plan scopes, and it does.

**1. The roster's display name has no source, and it is a SIXTH system the design assumes.** The
standing discipline names five values the mockups show arriving from a hospital record this build is
not connected to. A member of staff's display name is a sixth, and it does not come from a hospital
record at all — it comes from a **staff directory**. The stores hold `ActorId` and nothing else about
a person. No name was invented; the identifier travels.

**2. The Role column has no source either.** Nothing anywhere returns the roles an `ActorId` holds —
`Actor` is assembled at the session seam for the one person acting and is never looked up for anybody
else. So the read returns no role. That happens to settle the raw-role-identifier rule the easy way:
there is no role to render raw, and the vocabulary scan's known word-boundary hole is not exploited
because nothing reaches for it.

**3. The design's per-member "Unclaimed work" column cannot be produced.** Unclaimed means there is
no owner to file the work under, so a per-person unclaimed count has no referent. The design's own
unclaimed **row** — which is what the numbers in it belong to — is produced, in full. The brief lists
only "active plans" as per-coordinator, so the brief and the domain agree; it is the mockup that
carries the extra column, and its `[2, 4, 1]` are placeholders.

**4. No "became claimable" instant exists on the repository contract, so the unclaimed age is
measured from DISCHARGE and is an upper bound.** `caring_contacts.plans` has a `created_at`, but
`PlanRecord` does not release it and neither store offers it. A plan cannot have become claimable
before its patient was discharged, so the reported age is never shorter than the true wait — the
conservative direction for a safety escalation, which can therefore raise one early but never miss a
late one. The field is named `oldestMinutesSinceDischarge` rather than "queue age" so nobody reads it
as something it is not. **Closing this properly is a repository-contract change** (release the
creation instant, or add a claimable-since column) and is the owner's call, not mine.

**SUPERSEDED IN PART, 2026-08-28.** The bound claimed above is false, and the Group 4 review
reproduced it by execution: `dischargeAt` is not an observed instant but the plan wizard's midday
display convention, so an unclaimed plan reports zero all morning on its own discharge day and the
escalation cannot raise before midday. Everything else in this finding stands, including that
closing it is a repository-contract change and the owner's call. See `group-4-review.md` MAJOR-1
and `group-4-round-1-report.md`.

**5. Contacts have no "entered this state" instant either**, so backlog age is measured from the
scheduled send time — `oldestMinutesSinceScheduledSend`. For a `missed` or `notDelivered` contact
that is tight, because the attempt happened at or just after its send time; in general it is the same
upper bound as above.

**6. The threshold is inclusive: work escalates AT sixty minutes, not after it.** The mockup's copy
reads "escalates after 60 minutes", which does not determine the boundary. Inclusive was chosen
because it raises sooner, and it is pinned by a case that also asserts the minute before is _not_
escalated. If the owner wants it exclusive, it is a one-character change with a test that names it.

**7. Task 18 must not print an actor id as words.** The demo role switcher mints ids of the shape
`demo-<role>`, so `demo-clinicalProgrammeLead` is reachable as an actor id even though this read
returns no role. It is an identifier and should be rendered as one; it is not role wording, and role
wording lives in `CARING_CONTACT_ROLE_WORDING` in the sealed domain.

**8. This read carries no plan ids, deliberately.** The approved roster table has no per-plan links,
so none are needed — and a roster that carried them would be a caseload read wearing a roster's name.
If Task 18's "Reassign work" control needs a specific plan, it must come from a surface that is
already about plans, not from here.

**9. The N+1 assignment read.** One `getAssignment` per listed plan. Cheap in the in-memory store, a
query each in Postgres. Stated in the module header; the fix, if it is ever needed, is a repository
method and its own review.

**10. Gate drift, measured rather than assumed.** `test:cc-guards` names thirty-six caring-contacts
suites; sixty-three exist. My two are now named. Of the twenty-seven still absent, five bear on
modules this task touched or depends on — `access-audit`, `api-handler`, `assignment`,
`page-access-audit`, `repository` — and I ran them narrowed: `Test Files 5 passed (5)` /
`Tests 194 passed (194)`. I did not add them to the gate line, following the Ruling [139] MAJOR-2
practice of recording the diff rather than editing that hand-maintained list mid-branch.

---

## Mutation ledger

Every attempt is itemised, greens included. Each row ran against commit `71863cbeb`, on a tree
asserted clean by `git diff --quiet` immediately before and after. The unmutated baseline on that
same tree, with `GATE_RECEIPTS=refresh`, was `Test Files 2 passed (2)` / `Tests 29 passed (29)`, and
it was re-established after the last row.

Presence was proven by byte equality against a computed post-image (`expected = before.replace(find,
replace)`, asserted `!== before`, written, re-read, compared byte for byte), with an occurrence guard
requiring the anchor exactly once. Both guards were proven to fire on their own line before the round
began — `CTRL_NOOP` (a replacement equal to its anchor) threw
`post-image is byte-identical to the original`, and `CTRL_ABSENT` (an anchor not in the file) threw
`anchor occurs 0 times … expected exactly 1`. The driver validates every row against an allowlist of
the three files this task may mutate, and asserts id uniqueness, both before any file I/O. It lives
at a scratchpad path carrying this worktree's name, and every line it prints carries that name too.

Selection: `W` = `tests/caring-contacts-team-workload.test.ts`, `R` =
`tests/caring-contacts-team-route.test.ts`, `W+R` = both.

| Id             | Mutation                                                 | Sel | Predicted message                                                  | Observed                                                                         | Match |
| -------------- | -------------------------------------------------------- | --- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ----- |
| `M1`           | `activePlans += 1` → `+= 0`                              | W   | `expected +0 to be 1` on the owner's active count                  | `expected +0 to be 1` (5 failed / 17 passed)                                     | yes   |
| `M2`           | roster comparator → sort by active plans, descending     | W   | `expected [ 'ACTOR-CASS', … ] to deeply equal [ 'ACTOR-AVA', … ]`  | exactly that                                                                     | yes   |
| `M3`           | escalation `>=` → `>`                                    | W   | `expected +0 to be 1` on `escalated` at the threshold              | `expected +0 to be 1`                                                            | yes   |
| `M4`           | oldest-unclaimed `>` → `<`                               | W   | `expected 15 to be 120`                                            | `expected 15 to be 120`                                                          | yes   |
| `M5`           | `clearedBy` always names the remedy                      | W   | `expected 'aCoordinatorClaimsThePlan' to be null`                  | exactly that                                                                     | yes   |
| `M6`           | `oldestMinutesSinceDischarge` → `?? 0`                   | W   | `expected +0 to be null`                                           | `expected +0 to be null`                                                         | yes   |
| `M7`           | delete the `planEnded` skip                              | W   | non-empty `coordinators` where `[]` expected                       | `expected [ { actorId: 'ACTOR-AVA', …(5) } ] to deeply equal []`                 | yes   |
| `M8`           | `HELD_PLAN_ORDER` loses `planPaused`                     | W   | `expected [] to deeply equal [ { hold: 'planPaused', plans: 1 } ]` | exactly that                                                                     | yes   |
| `M9`           | `HELD_PLAN_ORDER` loses `planNotStarted`                 | W   | `expected [] to deeply equal [ Array(1) ]` on the draft case       | exactly that                                                                     | yes   |
| `M10`          | coverage test `responder !== owner` → `=== owner`        | W   | `expected +0 to be 1`, then `expected 1 to be +0`                  | both, in that order                                                              | yes   |
| `M11`          | `effectiveResponder` asked about a fixed day, not `asAt` | W   | same two, proving the instant used is `asAt`                       | both, in that order                                                              | yes   |
| `M12`          | `needsOperationalReview` negated                         | W   | `expected 9 to be 1`                                               | `expected 9 to be 1` (4 failed / 18 passed)                                      | yes   |
| `M13`          | backlog `Math.min` → `Math.max`                          | W   | `expected 1 to be <the value the case computes>`                   | `expected 1 to be 8641`                                                          | yes   |
| `M14`          | empty backlog age `null` → `0`                           | W   | `expected +0 to be null`                                           | `expected +0 to be null`                                                         | yes   |
| `M15`          | delete the unclaimed backlog push                        | W   | `expected +0 to be 1`                                              | `expected +0 to be 1`                                                            | yes   |
| `M16`          | leak every plan id onto the view                         | W+R | `not to contain 'SYN-PLAN-001'`, in both suites                    | both, one per suite (2 failed / 27 passed)                                       | yes   |
| `M17`          | leak `reassignmentHistory` onto the view                 | W   | `not to contain 'Handover note quoting clinical detail…'`          | exactly that                                                                     | yes   |
| `M18`          | `unclaimedPlans += 1` → `+= 0`                           | W   | `expected +0 to be 1` on the unclaimed count                       | `expected +0 to be 1` (5 failed / 17 passed)                                     | yes   |
| `M19`          | a null assignment no longer counts as unclaimed          | W   | `expected +0 to be 1`                                              | `expected +0 to be 1`                                                            | yes   |
| `M20`          | add a `share` field to each row                          | W   | the key refusal fires on `share`                                   | `expected [ 'actorId', 'share', …(5) ] to not include 'share'`                   | yes   |
| `M21`          | `thresholdMinutes` → `+ 1`                               | W   | `expected 61 to be 60`                                             | `expected 61 to be 60`                                                           | yes   |
| `CTRL-COMMENT` | a word inside one doc comment                            | W   | **GREEN** — changes no value any assertion reads                   | `Tests 22 passed (22)`                                                           | yes   |
| `MR1`          | `objectType: "teamWorkload"` → `"plan"`                  | R   | `expected 'plan' to be 'teamWorkload'`                             | exactly that                                                                     | yes   |
| `MR2`          | the route calls `getEpisode` per plan                    | R   | `expected 1 to be +0`                                              | `expected 1 to be +0`                                                            | yes   |
| `MR3`          | an empty roster released as `null`                       | R   | `expected 404 to be 200`, and the trail outcome turns `denied`     | both: `expected 404 to be 200`, `expected [ 'denied' ] to … [ 'allowed' ]`       | yes   |
| `MR4`          | audit `objectId` taken from the query string             | R   | `expected 'SYN-PATIENT-001' to be 'all'`                           | exactly that                                                                     | yes   |
| `MR5`          | the read filters plans by a query-string patient id      | R   | the two bodies differ                                              | `expected '{"coordinators":[],…' to be '{"coordinators":[{"actorId":"demo-coo…'` | yes   |
| `CTRL_NOOP`    | driver guard: replacement equals its anchor              | —   | the driver refuses, on the post-image line                         | `CTRL_NOOP: post-image is byte-identical to the original`                        | yes   |
| `CTRL_ABSENT`  | driver guard: anchor not in the file                     | —   | the driver refuses, on the occurrence line                         | `CTRL_ABSENT: anchor occurs 0 times … expected exactly 1`                        | yes   |

**One assertion I could not make red, and I am saying so rather than implying otherwise.** The case
"carries no patient name or mobile number" cannot be falsified by any mutation of the roll-up,
because neither of its inputs holds either value: `PlanRecord` carries no patient detail and
`PlanAssignment` carries none. It is a pin on the SHAPE of what the roll-up is handed, not on a
narrowing the roll-up performs, and the case now says so in its own header and asserts that the input
really is free of both. The narrowing that _is_ performed is proven by `M16` and `M17` and, at the
boundary, by the route's own privacy case. This is the Task 12 correction applied deliberately: I
checked which inputs the assertion reads before labelling it, rather than after.

---

## Gates

| Gate                                                                             | Result                                                                               |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `npm run test:cc-guards` (`GATE_RECEIPTS=refresh`, final tree)                   | see the line pasted in the return message                                            |
| `npx tsc -p tsconfig.json --noEmit` (read from tsc, never through a pipe)        | exit 0, no diagnostics — re-run after the last source and test edit                  |
| `npx eslint <the six changed files>`, `node_modules/.cache/eslint` removed first | exit 0                                                                               |
| `npx prettier --check <the six changed files + package.json + site-map>`         | `All matched files use Prettier code style!`                                         |
| the five gate-missing suites bearing on touched modules                          | `Test Files 5 passed (5)` / `Tests 194 passed (194)`                                 |
| `tests/caring-contacts-schedule-route.test.ts` (the enum-sync pin)               | green, with `tests/caring-contacts-domain-isolation.test.ts`: `Tests 21 passed (21)` |

Not run, and deliberately: `npm run test`, `npm run build`, `npm run verify:ui`, Playwright, and
anything provider-backed. Those are the controller's.

No literal `\b` was written anywhere in this diff; `tests/source-control-bytes.test.ts` runs inside
`test:cc-guards`.
