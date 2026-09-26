# Task: extend the demo seed so the wireframe reads as working

## What changed and why

The seed (`src/lib/caring-contacts-server/demo-seed.ts`) produced three plans (running, paused,
withdrawn) but nobody had ever claimed one, nothing was ever due on the day the workspace opens,
and every contact sat at `scheduled`. Three built surfaces -- the Team roster's "who is carrying
work" list, the Schedule screen's "due today" day, and the exception-handling surfaces
(`delivery-detail`, `resolve-failed-delivery`) -- were therefore either empty or reachable only by
typing an address. All three states now exist, produced through the domain's own real transitions,
never by relaxing a guard.

### 1. A coordinator carries plans, and one plan stays unclaimed

Rowan's plan is claimed by the demo coordinator through `applyAssignment`'s real `claim`
transition, right after activation. Mira's paused plan is left exactly as it was --
`claimedByCoordinator` is `true` only on Rowan's `DemoPlanSeed`. Ari's withdrawn plan was already
excluded from the roster before this change (`buildTeamWorkload` drops ended plans before any
measure), so it carries neither claimed nor unclaimed weight.

Verified against a live seeded store: the Team roster's `buildTeamWorkload` now reports
`demo-coordinator` carrying 1 active plan, and 1 plan (Mira's) still unclaimed.

### 2. Something is due today

Rowan's plan is discharged one AWST day before the shared `dischargeAt` the pathway snapshot uses
(`dischargeDaysBeforeShared: 1` on its `DemoPlanSeed`). `buildApprovedSchedule` puts the first
contact at discharge + 1 day (`FIRST_CONTACT_DEFAULT_OFFSET_DAYS`), so a plan discharged
yesterday opens its "Day 1" contact on the current AWST day. That contact is left untouched at
`scheduled` -- it is never named in `attemptedContacts` -- so it shows as genuinely due.

Checked the alternative before choosing this one: `rescheduleContact`'s `changeContactDate` branch
could move a single contact's date directly, but it requires a non-blank reason and a recorded
team-lead approval -- both free text or an attestation about why an invented patient's date moved,
for a contact that has no other reason to move. Re-discharging the plan a day early tells the
truer story without inventing either.

### 3. Some contacts have been attempted, exactly one as a failure

Three more of Rowan's contacts are advanced through the real four-step dispatch path
(`startContactDispatch` -> `recordContactSent` -> `recordContactProviderStatus`, the same order
`driveTwelveMonthSimulation` uses), attributed to a new system actor, `demoSystemDispatcher()`
(`src/lib/caring-contacts-server/session.ts`), never to a human demo role:

- "Week 1" (closest to today) -> `notDelivered` -- the one failure/discrepancy.
- "Month 1" -> `delivered`.
- "Month 2" -> `delivered`.

The failure was deliberately put on the CLOSEST contact to today so that paging the Schedule
screen's day strip forward reaches `resolve-failed-delivery` in a couple of clicks rather than
dozens; `delivery-detail` is on the patient-overview screen, which is not date-windowed, so its
reachability did not depend on this choice.

`demoSystemDispatcher()` mirrors `demoActorForRole` but returns a `SystemActor` with
`systemRole: "contactDispatcher"` -- the exact type `../permissions` already defines for this
purpose, whose grant table (`CONTACT_DISPATCHER_ACTIONS`) holds exactly the four dispatch actions
and never overlaps a human role's table. No human demo role was extended.

### Left alone: `template-changed-retired`

The task brief's opening paragraph lists `template-changed-retired` alongside the two dispatch
surfaces as "reachable only by typing their address," but that overlay is gated on the seeded
pathway version's own state being `retired` (`templateLifecycleOf` in
`templates-library.tsx`), which has nothing to do with contact attempts. The "Your task" section's
three concrete requirements do not ask for a retired version, and retiring the one seeded pathway
version would touch a fourth, unrelated fact (governance lifecycle) the task did not scope, with
its own knock-on questions (would `createPlan` for the still-unstarted "wren" referral still find
a current version to activate against?). Left unseeded rather than guessed at.

## Verification actually run

```
$ npx vitest run --reporter=dot tests/caring-contacts-demo-seed.test.ts
 Test Files  1 passed (1)
      Tests  16 passed (16)
```

```
$ ls tests/*caring-contacts* | grep -vE "\.spec\.ts$" | wc -l
65
$ npx vitest run --reporter=dot $(ls tests/*caring-contacts* | grep -vE "\.spec\.ts$" | tr '\n' ' ')
 Test Files  63 passed (63)
      Tests  1402 passed (1402)
```

The `ls` count is 65, not the 63 the task brief names, but the two extra files
(`tests/caring-contacts-migrations.test.ts`, `tests/caring-contacts-postgres-repository.test.ts`)
are the repository's own "live provider" suites, excluded unconditionally from the default Vitest
project (`vitest.config.mts`'s `liveProviderTests` exclusion) because they need a real Postgres
connection. Vitest itself collected and ran exactly 63 files -- the number the brief expects --
so nothing was silently dropped from collection; the count only looked different before Vitest's
own selection ran.

Also ran `npx eslint` on the three changed files (clean) and `npx tsc --noEmit -p tsconfig.json`;
the only errors reported are pre-existing `.next/dev/types/validator.ts` generated-file corruption
unrelated to this change, and neither changed file appears anywhere in that output.

Also drove the real seed end to end in an ephemeral test (written, run, and deleted -- not part of
this commit) to confirm the actual resulting state rather than trusting that the writes merely
succeeded:

```
TODAY (AWST): 2026-08-29
PLAN demo-seed-plan-rowan active assignment: {"ownerId":"demo-coordinator", ...}
  contact Day 1   2026-08-29 scheduled    <-- TODAY
  contact Week 1  2026-09-04 notDelivered
  contact Month 1 2026-09-28 delivered
  contact Month 2 2026-10-28 delivered
  ...
PLAN demo-seed-plan-mira paused assignment: {"ownerId":null, ...}
PLAN demo-seed-plan-ari withdrawn assignment: {"ownerId":null, ...} -- all contacts cancelled
WORKLOAD coordinators: [{"actorId":"demo-coordinator","activePlans":1, "exceptionBacklog":{"contacts":1,...}}]
WORKLOAD unclaimed: {"plans":1,"escalated":0, ...}
```

## Existing test updated, and why

`tests/caring-contacts-team-page.dom.test.tsx`, the one test in the caring-contacts suite that
exercises the REAL seed and made a claim about claiming: its `it` title read "counts the seeded
plans as unclaimed," and an inline comment said "Nothing in the seed claims a plan ... every plan
the seed left open is unclaimed." Both are now false -- Rowan's plan is claimed. The assertions
themselves still pass unmodified (the test only checks that the "unclaimed work escalated" group
renders, which stays true because Mira's plan is still unclaimed), so this was a comment/title
accuracy fix, not a logic change: the title now reads "shows the seeded plan nobody has claimed as
escalated," and the comment now says the seed claims one of its two non-ended plans and
deliberately leaves the other open. Re-ran this file alone after the edit: 11 passed (11).

No other test in the 63-file run asserted "nothing is claimed" or "no contact is sent" as a
literal check; the rest either use a synthetic empty fixture (unaffected) or check facts my change
does not touch (pathway-version governance, patient names, reserved mobile numbers, cadence
labels, prohibited-language scanning).

## What the domain refused, and what that taught

Nothing was refused during implementation. Every write in this seed extension went through on the
first real attempt once the sequencing was right (claim/dispatch inserted after `activatePlan`,
dispatch inserted before the pause/withdraw branch since `startContactDispatch` requires an
active plan). The refusal-shaped discoveries were made by READING the domain before writing, not
by trying something and being told no:

- `startContactDispatch` requires `plan.state === "active"` (`REPOSITORY_REFUSALS
.contactDispatchRequiresActivePlan`), which is why the dispatch attempts had to be seeded for
  Rowan (the plan that stays active) and could not be seeded for Mira (paused) or Ari (withdrawn,
  and its contacts are already cancelled by the withdrawal itself).
- `CONTACT_DISPATCHER_ACTIONS` and every human role's `ROLE_ACTIONS` are disjoint by construction,
  which is exactly why a `SystemActor` had to be introduced rather than handing the coordinator
  actor a fourth capability it does not hold in the real system.
- `rescheduleContact`'s `changeContactDate` branch would have been a smaller, more surgical way to
  put a single contact on today, but it demands a reason and a team-lead approval -- both invented
  content about a made-up patient's date change for no real reason. Discharging the whole plan a
  day early needed no invented text at all, so it was preferred even though it was not the only
  legal route.

## What was left undone rather than done by weakening a guard

`template-changed-retired` (see above) is the one surface named in the task's introduction that
this change does not seed. Producing it would mean retiring the one seeded, published pathway
version -- a real, correct transition (`retirePathwayVersion`, requires `approved` state) that
this task's explicit three requirements never asked for and that was not investigated far enough
to be confident it wouldn't quietly break the still-unstarted "wren" referral's route into the
activation wizard (which needs a current, non-retired version to build a plan against). Left
unseeded rather than guessed at; flagged here for a follow-up task that can scope and verify it
properly.
