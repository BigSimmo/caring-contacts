# Group 4 review — Tasks 17 and 18, the team read and the Team screen

**Reviewer verdicts.**

- **Spec compliance: PASS WITH ONE MAJOR.** §4.2's never-rank requirement is **met**, on the read and
  on the screen, held as a constraint on shape and on rendering and proven in both places. §4.4 is met
  for the one automated state this screen has. **But the screen makes a safety assurance about the
  escalation that is false**, and the read's own module header makes it too. That is MAJOR-1 below.
- **Task quality: HIGH.** The method here is the best this phase has produced — positive controls on
  every absence, a live-proven spy double, two self-found test defects disclosed rather than smoothed,
  and a wrong mutation prediction reported as wrong. MAJOR-1 is not a lapse in that method; it is a
  false premise the method had no way to test, because no fixture crosses the seam it lives on.

Findings: **1 MAJOR, 1 MEDIUM, 3 LOW, 1 INFO.** Each is labelled reproduced or reasoned.

Scope: the Group 4 diff only. All twelve SHAs in the brief were verified present with
`git cat-file -e <sha>^{commit}` before anything was relied on; none had been amended away.

---

## MAJOR-1 — the escalation is anchored on an instant nobody observed, and the screen tells a clinician it is a bound. REPRODUCED.

**What the screen says.** `team-roster.tsx`, in the footer, on every render:

> Both ages above are measured from the earliest instant the work could have been waiting — a
> patient's discharge, or a contact's scheduled send — so the true wait is never longer than the
> figure shown.

`team-workload.ts`'s header makes the same claim as a safety property: _"The true wait is therefore
never LONGER than the number reported, which is the conservative direction for a safety escalation: it
can raise one early, never miss a late one."_ Task 17 finding 4 and Task 18 finding 4 both rest on it.
The premise given is _"a plan cannot have become claimable before its patient was discharged"_.

**Why the premise does not hold of the stored field.** `PlanRecord.dischargeAt` is not an observed
instant. It is a **display convention**: `dischargeInstantFor` in
`src/components/caring-contacts/workspace/plan-wizard/plan-activation.ts` takes the AWST calendar day a
coordinator types and pins it to `DISCHARGE_WALL_CLOCK_HOUR = 12` — **midday**. That constant's own doc
comment says why the hour is arbitrary and safe to be arbitrary: _"the time of day changes nothing
about the schedule … The clinician is not asked for a time because nothing in this domain uses one."_

Task 17 is the first reader in the tree to do **instant arithmetic** on that field. Nothing warned it,
because the field's author had correctly recorded that nobody did.

Nothing constrains the typed day either: `firstContactDayBounds` validates only that the string is a
real calendar day, so today and tomorrow are both accepted, and a plan activated on the morning of its
discharge day carries a `dischargeAt` **in the future**. `queueAgeMinutes` clamps with `Math.max(0, …)`.

**Reproduced, executed against the real modules** (`npx tsx`, one unclaimed active plan, discharge day
`2026-08-30`, activated 08:00 AWST and never claimed):

```
stored dischargeAt = 2026-08-30T04:00:00.000Z          <- midday AWST, as DISCHARGE_WALL_CLOCK_HOUR says
09:00 AWST (unclaimed  60 min) -> reported age: 0  | state: withinThreshold | escalated: 0
11:00 AWST (unclaimed 180 min) -> reported age: 0  | state: withinThreshold | escalated: 0
13:00 AWST (unclaimed 300 min) -> reported age: 60 | state: escalated       | escalated: 1
```

So, for every unclaimed plan, on the day it is most likely to be unclaimed:

1. **The escalation cannot fire at all before midday.** At 11:00 the plan has been unclaimed for three
   times the threshold and the read reports `withinThreshold` and an age of **0**. The screen renders
   "Every plan that is running has a coordinator … escalates once it has waited 60 minutes" — or, with
   other plans present, the within-threshold sentence — while a discharged patient's plan has sat
   unowned all morning.
2. **After midday it under-reports by the morning offset**, escalating four hours late in the run above.
3. The age therefore bounds the true wait in **neither** direction: a backdated discharge over-reports
   by days, a same-day morning activation under-reports to zero. It is not a conservative estimate of
   the wait; it is an unrelated anchor that sometimes resembles one.

**Consequence.** The failure the module header says is impossible — _"never miss a late one"_ — is the
one that actually happens, on a suicide-prevention roster whose stated purpose (spec §4.2) is
_"unclaimed work against the 60-minute escalation"_. And the footer sentence is not a stale comment: it
is a **false assurance rendered to a clinician**, who is being told the figure is an upper bound at the
moment it is a floor of zero.

**Why no test caught it.** `tests/caring-contacts-team-workload.test.ts` builds `DISCHARGE_AT` by hand
as `new Date("2026-08-30T02:00:00.000Z")` and passes it straight to `createPlan`. Every fixture in both
tasks constructs the instant directly; **none goes through `dischargeInstantFor`**, so the seam between
the wizard's midday convention and the domain's instant arithmetic is crossed by no fixture in the
branch. `tests/caring-contacts-team-roster.dom.test.tsx` then **pins the false sentence** —
`expect(...).toContain("never longer than the figure shown")` — and Task 18's `M12b` reddened it, so the
assertion is real and load-bearing. It is pinning wrong content, which is the harder kind to find.

**This is not fixable inside Group 4.** Task 17 already reported the right shape of the answer as
finding 4 — the repository contract releases no claimable-since instant — and correctly called closing
it the owner's call. What is in scope, and what I would hold the merge for, is that **the code and the
screen currently claim a property they do not have**. The minimum honest change is to stop asserting the
bound: name the figure for exactly what it measures (time since the recorded discharge day's midday
anchor) and delete the "never longer than the figure shown" sentence and its module-header twin, rather
than leave a clinician trusting a floor as a ceiling. Whether the escalation should be re-anchored — and
on what — is the repository-contract decision Task 17 already escalated.

---

## MEDIUM-2 — during coverage, the exception backlog is filed under the person who is not answering. REPRODUCED (code), and pinned by no test.

In `buildTeamWorkload`, `tally.reviewableSendInstants.push(...)` runs only on `tallyFor(owner)`. The
covering actor's tally receives `coveringForAnother += 1` and nothing else. The module states the rule —
_"A covered plan's backlog stays with its named owner"_ — but not its consequence.

So while ACTOR-AVA is on leave and ACTOR-BLAKE is covering her plans, the desktop table shows
`Contacts needing review: 3` against **AVA**, who is absent, and `None` against **BLAKE**, who is the
person who has to act on them. The screen says nothing about this; the Coverage cell states who is
covering, not where the backlog was filed.

I checked whether any test pins the attribution: `tests/caring-contacts-team-workload.test.ts` asserts
coverage only as counts (`coveredByAnother`, `coveringForAnother`, at lines 407, 408 and 420). **No case
combines coverage with an exception backlog**, so the rule is unproven as well as unstated. A future
edit that moved the backlog to the responder would pass the whole suite.

Filing by ownership is a defensible choice — it keeps the named coordinator visible, which is the same
principle the coverage columns exist for. The finding is that a workload monitor whose §4.2 remit
includes "exception backlog age" attributes that backlog to the absent person, silently, on a screen
whose subject is whether anyone is answering for a discharged patient's plan. It wants a sentence on the
screen and a case in the suite, or an owner's decision to file it under the responder instead.

---

## LOW-3 — a raw ISO 8601 timestamp is rendered to a clinician. REPRODUCED.

`team-roster.tsx`: `Measured at <time dateTime={view.asAtIso}>{view.asAtIso}</time>` prints e.g.
`2026-08-30T11:00:00+08:00` as body text. It is the only place in the workspace that renders a machine
timestamp to a reader — I grepped `src/components/caring-contacts/workspace/` and there is no other.

The sibling convention is explicit and deliberate: `schedule-screen.tsx` writes weekday and month names
out by hand with a documented rationale (_"A screen's date wording has to be the same in a test, in CI
and on the machine of whoever reads it, and `Intl.DateTimeFormat` is none of those things"_). That
rationale argues against `Intl`, not in favour of ISO — the Schedule screen's answer was hand-written
plain words, and this screen should use the same answer.

---

## LOW-4 — a covering coordinator who owns nothing reads as carrying nothing. REASONED.

`tallyFor(responder)` creates a row for a coverer, so a coordinator who owns no plan but is covering two
appears with `Plans sending: 0` in the leftmost numeric column, and the correction appears only in the
Coverage cell. The primary figure understates what that person is carrying. Same family as MEDIUM-2 and
probably the same fix.

---

## LOW-5 — the ranking-vocabulary loop carries seven refusals and one mutation. REASONED.

`tests/caring-contacts-team-roster.dom.test.tsx` refuses `rank`, `percentile`, `score`, `leaderboard`,
`busiest`, `quietest` and `performance`; Task 18's `M3` mutated only `busiest`. Under the standing
discipline's "a case with N assertions needs N mutations" this is under-proven. I record it rather than
press it: it is a single-mechanism allowlist loop, one member exercises the mechanism, and the
alternative is seven near-identical rows. Noted so a later reader does not mistake it for seven proofs.

---

## INFO — one unreachable branch in `team-workload.ts`.

`const responder = assignment === null ? owner : effectiveResponder(assignment, asAtIso);` — at that
point `owner` is non-null and came off `assignment`, so `assignment === null` cannot hold and the left
branch is dead. Harmless, and TypeScript will not flag it. Noted only because the module is otherwise
scrupulous about not carrying code that cannot run, and the comment beside it already says `assignment`
is non-null here.

---

## The brief's checks, answered — claims verified rather than accepted

Each of these was a claim in a report. I checked each against the tree rather than relaying it.

| Claim under check                                                               | Verdict                                                    | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §4.2: the **read** never ranks                                                  | **Holds**                                                  | Sort is `actorId` only; no share/percentile/rank/total field exists; every number counts work. The fixture's work order is the exact reverse of identifier order, so the order case cannot pass by coincidence. REPRODUCED by reading plus the guard set.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| §4.2: the **screen** never ranks                                                | **Holds**                                                  | Rows drawn in read order; no total to divide by; no colour as a grade — `AutomatedState` uses `--surface-subtle` and `--border` with an icon and words, no tint, and the forced-colours e2e case exists for exactly that. The screen states on itself that the order is identifier order and not a placing. REPRODUCED.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `getEpisode` never called (read)                                                | **Holds**                                                  | The route test proves the double **live**: asserts 0 after the call, then calls `getEpisode` directly and asserts the counter moves to 1. This is the rule about inert doubles, applied correctly. REPRODUCED.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `getEpisode` / `listPatientNames` never called (screen)                         | **Holds, and the fix is real**                             | `3b0e0a193` moved the case onto `createDemoWorkspaceStore`, asserts `listPlans` returned a non-empty list first, **and** spies `listPlans` as a positive control that the spied store is the one the page used. The pre-fix empty-store version is exactly the shape the discipline calls decoration, and `M26-old` measured it green. REPRODUCED.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| No patient name, mobile, identifier or plan id reaches view or response         | **Holds**                                                  | Positive controls from two sources at the route (ids from `listPlans`, name and mobile from `getEpisode`), and against the real demo seed at the page. The handover note (`reassignmentHistory[].reason`) — the one piece of clinician free text the input holds — is asserted absent against a fixture that really carries one. REPRODUCED.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Nothing about a patient in a query string                                       | **Holds**                                                  | The route takes no parameters; a request carrying `?patientId=…&q=<name>` is answered identically and the trail records `objectId: "all"` either way, asserted. REPRODUCED.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Finding 1 — **no staff display name exists anywhere**                           | **TRUE**                                                   | No `displayName` / `staffName` / `fullName` under `src/lib/caring-contacts/`; `Actor` is `{ id, teamId, roles }`. REPRODUCED.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Finding 2 — **no role source for anyone but the acting user**                   | **TRUE**                                                   | No repository read returns roles for a third party; `Actor` is assembled at the session seam for the one person acting. REPRODUCED.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Finding 3 — **per-member unclaimed has no referent**                            | **TRUE**                                                   | Unclaimed is defined by the absence of an owner, so there is no key to file a per-person figure under. REASONED from the model.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| The screen **states** all three absences rather than printing a bare identifier | **TRUE**                                                   | The footer states that no staff name is held and no role for anyone but you, and that each coordinator appears as the identifier their work is filed under. Pinned by `M4`, `M5`, `M6`. The identifier is rendered monospaced and verbatim, and `demo-clinicalProgrammeLead` is pinned to appear as an identifier **and** never as "clinical programme lead" — so the vocabulary scan's word-boundary hole is not reached, let alone exploited. REPRODUCED.                                                                                                                                                                                                                                                                                                                                           |
| The two ages are named for what they measure, not relabelled                    | **Holds as wording; see MAJOR-1 for the claim about them** | "145 minutes since the patient was discharged", "45 minutes since its scheduled send"; `queue age` and `waiting time` both refused with both ages present as the positive control. REPRODUCED.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| §4.4 asserted in DOM tests for every automated state                            | **Holds**                                                  | The escalation is the only automated state on this screen. `AutomatedState` puts state, why and what-changes-it in one `role="group"`; `M7` / `M8` / `M9` redden the remedy, the threshold, and calling within-threshold work escalated. The other two unclaimed states are correctly **not** dressed as automation and still carry threshold and remedy. REPRODUCED.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Two assertions labelled un-reddenable — is the labelling honest?                | **Yes, both**                                              | The `title` loop iterates `group.querySelectorAll("[title]")`, which is empty — a zero-iteration loop, correctly declared. `TeamWorkloadView` carries no patient, plan or contact field, so the shape pin is correctly declared too. Task 12's error (labelling without checking the inputs) is not repeated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Anything else silently sharing that property?                                   | **Nothing found**                                          | I swept every `not.toContain` / `not.toMatch` / `toBeNull` in all four suites. Every absence has a positive control asserted first. LOW-5 is the only under-proof, and it is an allowlist loop rather than a vacuous assertion.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| "Reassign work" as a `<Link>` rather than "coming soon" — sound?                | **Sound**                                                  | The reassignment overlay exists and is wired on `plan-actions.tsx`, rendered by `patient-overview.tsx` at `/caring-contacts/patients/[patientId]`, and the trigger inventory records it as `{ kind: "literal", modules: [PLAN_ACTIONS] }` — still true, no second trigger added. A reassignment needs one plan; this read deliberately carries none. So "coming soon" would state the product cannot reassign, which is false. The link's stated reason ("done on one plan at a time, from that patient's record") matches where the action actually lives. The residual — a team lead must still find the plan by hand — is stated. REPRODUCED.                                                                                                                                                      |
| The role gate on that control                                                   | **Holds, and leaks no role identifier**                    | `reassignPlan` is in `TEAM_LEAD_ACTIONS` and **not** in `COORDINATOR_ACTIONS`; the capability is asked of the sealed domain with the action the store itself checks. Where absent, **no control renders** and the screen says "Moving a plan to another coordinator is not available in this role" — no role identifier, no role wording. Both directions asserted at the page (`teamLead` present, `coordinator` absent), each the other's control. I also checked the combination `mayReassignPlan && !mayViewPlans`, where the link would render beside the not-permitted state: **unreachable**, because teamLead is the only holder of `reassignPlan` and it also holds `viewReferral`. REPRODUCED.                                                                                              |
| Repository contracts                                                            | **Hold**                                                   | Tap target is `min-h-tap` = `var(--spacing-tap)` = `3rem` = 48px, and the case refuses `min-h-11` explicitly; it sits on the control element, not a wrapper. Internal navigation is `<Link>` with `data-internal-link`, asserted over every `a[href^='/']` in the render. Design tokens only, no hex. No orphan route — Team's `href` landed in `shell.tsx` in the same change as the page (`M27` reddens `route-reachability`), and the More panel is its only inbound link at every width. Domain isolation intact: `team-workload.ts` imports only from `./`. Transport vocabulary clean — `caring-contacts-interface-vocabulary.test.ts` scans both `workspace/` and `src/app/caring-contacts/` and is green. No `0x08` or CR byte in any of the eight files (checked by byte scan, not by grep). |

### The merge interaction (`3a2904837`)

The catch-up merge sits between the two tasks, so Task 17 was written against the pre-merge tree and
Task 18 against the post-merge one. Two interactions, both checked, both clean:

- **Task 17's gate-line edit survived the merge.** `test:cc-guards` now names 41 paths and includes all
  four team suites (`team-workload`, `team-route`, `team-roster`, `team-page`). A merge that took the
  incoming `package.json` would have silently dropped Task 17's two suites out of the gate; it did not.
  REPRODUCED.
- **`docs/scripts-index.md` 280 → 281 is the merge's drift, correctly attributed.** Task 18's report
  says the stale count arrived on the trunk before its own work. I verified: `package.json` holds
  **281** script entries both at `3a2904837` and at HEAD, and neither task added one. The correction is
  a legitimate merge-interaction repair, not an unexplained edit. REPRODUCED.

Task 18 also updated `docs/design-system/adoption-{contract,manifest}.json`, `ADOPTION.md` and the
`design-system-adoption` route census (75 → 76) in the same change as the route, which is what that
census requires. The comment above the assertion enumerates the ten workspace screens directly on top of
the count, which is the acceptable form of that rule.

---

## Gates

Run in this worktree, on the final tree at `92b82ecce`, with the tree asserted clean by
`git status --porcelain` (empty output) before and after.

| Gate                                                                    | Result                                                   |
| ----------------------------------------------------------------------- | -------------------------------------------------------- |
| `npm run test:cc-guards`, `GATE_RECEIPTS=refresh`                       | `Test Files  41 passed (41)` / `Tests  896 passed (896)` |
| `npx tsc -p tsconfig.json --noEmit` (read from tsc, not through a pipe) | exit 0, no diagnostics                                   |
| Byte scan for `0x08` / CR across the eight source and test files        | 0 in every file                                          |

**The first `test:cc-guards` attempt was a lock refusal, in the throwing shape**, and it arrived wearing
the exact disguise this programme's ledger names. The pipeline reported exit **1**, the wrapper printed
`[exited with code 0]`, and there was **no summary line** — the body was
`Error: Database focused-test capacity is full (current owner PID 26532, worktree
D:\Worktrees\Database\pr-2390-fix)`, thrown by `acquireHeavyRunLock` with **no
`DATABASE_HEAVY_RUN_ADMISSION_BUSY` marker**. A detector matching only the marker would have read that
as a run. It was retried, matching both refusal shapes, and passed on the second attempt; the line above
is from that run. No lease was forced.

Not run, deliberately: `npm run test`, `npm run build`, `npm run verify:ui`, Playwright, and anything
provider-backed. Task 18's browser evidence (`126 passed (3.1m)`) is its own and is not re-derived here.

---

## Recommendation

**Do not merge Group 4 until MAJOR-1's false assurance is removed from the screen and the module
header.** The underlying anchor problem is a repository-contract change and is correctly the owner's;
the claim that the anchor is a conservative bound is this branch's, is rendered to a clinician, and is
wrong in the direction that misses a late escalation.

MEDIUM-2 wants a sentence on the screen and a case in the suite. LOW-3 is a small wording change to
match the Schedule screen. LOW-4, LOW-5 and the INFO row are recorded, not held against the merge.

Everything else in this group is sound, and the privacy work in particular is the strongest in the
phase: every absence carries a positive control, the spy double is proven live rather than assumed, and
the one absence that could not be made red is labelled as such after checking what it reads.
