# Task: make Rowan's seeded timeline coherent (Ruling 159)

## The defect, and how it was found

The previous round of the demo seed (`e45dfefc5`) discharged Rowan's plan one AWST day before
"now" (`dischargeDaysBeforeShared: 1`), which correctly put `Day 1` on today and left it
`scheduled`. It then advanced `Week 1`, `Month 1` and `Month 2` through the real dispatch path to
`delivered` / `notDelivered`. `buildApprovedSchedule` puts `Week 1` at discharge + 7 days and
`Month N` at discharge + N calendar months -- with discharge one day ago, **all three of those
dates were still in the future.** The patient overview read "3 messages sent, of which 2 carry a
delivery receipt" for a plan whose only contact on or before today was still `scheduled`. Every
test passed at the time (16 demo-seed tests, 63 collected files, 1402 tests, ESLint clean) because
every assertion was about state -- what a contact's status was -- and none checked the relationship
between a contact's outcome and its own scheduled date. This was found by driving the running
application, not by reading the diff, and is recorded as Ruling [159] in
`docs/caring-contacts/phase-2b-build-record.md`.

## The fix

Rowan's plan is now discharged **two calendar months** before "now"
(`dischargeMonthsBeforeShared: 2`, replacing `dischargeDaysBeforeShared`). Checked against
`buildApprovedSchedule` itself, not assumed:

| Cadence    | Discharge offset         | Falls on (today = 2026-08-29) | Relation to today | Seeded state                |
| ---------- | ------------------------ | ----------------------------- | ----------------- | --------------------------- |
| Day 1      | discharge + 1 day        | 2026-06-30                    | before            | attempted, `delivered`      |
| Week 1     | discharge + 7 days       | 2026-07-06                    | before            | attempted, `delivered`      |
| Month 1    | discharge + 1 month      | 2026-07-29                    | before            | attempted, `notDelivered`   |
| Month 2    | discharge + 2 months     | 2026-08-29 (**today**)        | equal             | left `scheduled`, due today |
| Month 3-12 | discharge + 3..12 months | 2026-09-29 .. 2027-06-29      | after             | left `scheduled`            |

This is the exact table printed by an ephemeral test that drove the real seeded store (written,
run, and deleted -- see "Verification" below); it is not hand-computed. It preserves every property
the previous round established: a contact due today, three attempted contacts, exactly one
failure -- and additionally makes the failure (`Month 1`) the most recent past contact, which is
what its own "closest to today" comment already said it wanted.

### Why calendar months, not a fixed day count

A fixed `61`-day offset would only equal "two months" on the date it was written and would drift
on every other date the seed runs. The domain already owns calendar-month arithmetic --
`addCalendarMonths` in `src/lib/caring-contacts/schedule.ts`, the same function
`buildApprovedSchedule` uses to place its own `Month N` cadence entries, with its clamp-to-shorter-
month rule. Writing a second, day-approximated version of that arithmetic in the demo seed would
be exactly the kind of "second copy that can drift" this codebase's own comments warn against
repeatedly (see `firstContactDayBounds`'s note, `SENDING_PREFERENCE_OPTIONS`'s note, etc.).

Instead, `addCalendarMonths` (previously module-private to `schedule.ts`) is now reused through a
new exported function:

```ts
// src/lib/caring-contacts/schedule.ts
export function calendarDayPlusMonths(calendarDay: string, months: number): string | null;
```

It parses an AWST calendar day, shifts it by whole calendar months (accepting a negative amount to
go backwards), and formats the result -- or returns `null` for an invalid calendar day, matching
the existing `firstContactDayBounds` convention right above it in the same file. The demo seed
calls it with a negative `months` through a small local helper,
`shiftedPlanDischargeAt(shared, months, personKey)` in `demo-seed.ts`, which:

1. Takes the shared `dischargeAt` instant's own AWST calendar day (`awstCalendarDay`).
2. Shifts it back `months` calendar months via `calendarDayPlusMonths`.
3. Converts the result back to an instant at midday AWST (`awstWallTimeToInstant(day, 12)`) --
   midday rather than midnight, matching `awstCalendarDayOffset`'s own convention in `clock.ts`.
   The hour is otherwise inert: `buildApprovedSchedule` only ever reads the AWST calendar day back
   out of `dischargeAt`, and so does every screen that displays a plan's discharge day
   (`awstCalendarDay(record.dischargeAt)` in `patient-overview.tsx` and
   `patients-directory.tsx`).
4. Throws `DemoSeedRefusedError` if `calendarDayPlusMonths` ever refuses the shared instant's own
   calendar day -- which cannot happen in practice (`awstCalendarDay` always derives a real one
   from a live `Date`), but the refusal is surfaced rather than asserted away, for the same reason
   every other write in this module is: a refusal is a finding, not a case to route around.

A known, pre-existing, and unchanged limitation: because `addCalendarMonths` clamps to the last day
of a shorter target month, shifting back N months and then forward N months is not guaranteed to
land exactly back on the starting day for every day of the year (for example, a day-30/31 in a
month whose "two months earlier" counterpart is February). This is the same clamping rule
`buildApprovedSchedule`'s own forward cadence already lives with -- it is not a new defect this
change introduces, and it does not affect today's actual run (2026-08-29 round-trips exactly, as
the printed table above shows).

## Domain refusals encountered

**None.** `createPlan` performs no check that refuses a past discharge date -- it only builds the
schedule from whatever `dischargeAt` it is given and fails only if `buildApprovedSchedule` itself
refuses (unknown sending preference, invalid instant, a moved first-contact date without a
required reason, or two contacts landing on the same day). Since this seed never sets
`firstContactDate`, `firstContactReason` is never demanded, and no clinical prose had to be
invented anywhere. `startContactDispatch` refuses only a non-active plan (checked before
pause/withdraw run, unchanged) -- it has no date check at all, which is exactly what let the
original defect through undetected: nothing in the write path enforces "a dispatched contact's own
day must have arrived." That is the gap this task's new test closes.

No guard was weakened, loosened, or bypassed anywhere in this change.

## Files changed

- **`src/lib/caring-contacts/schedule.ts`** -- exported `calendarDayPlusMonths`, a thin wrapper
  around the existing private `addCalendarMonths`/`parseCalendarDay`/`formatCalendarDay`. No
  existing behaviour changed; this is a new export only.
- **`src/lib/caring-contacts-server/demo-seed.ts`** --
  - `DemoPlanSeed.dischargeDaysBeforeShared` renamed to `dischargeMonthsBeforeShared` (its only use
    was Rowan's plan; nothing else in the tree referenced the old name).
  - Removed the now-unused `MILLISECONDS_PER_DAY` constant and its AWST-day-arithmetic comment.
  - Rowan's plan: `dischargeDaysBeforeShared: 1` -> `dischargeMonthsBeforeShared: 2`; his
    `attemptedContacts` re-targeted from `["Week 1" fail, "Month 1", "Month 2"]` to `["Month 1"
fail, "Week 1", "Day 1"]` (all three now in the past; `Month 1` is the closest to today, so it
    carries the failure, per the existing "closest first" convention).
  - Added `shiftedPlanDischargeAt` helper and rewired the per-plan `planDischargeAt` computation to
    use it instead of millisecond subtraction.
  - Updated every doc comment that described the old one-day/`Day 1` mechanism to describe the new
    two-month/`Month 2` one, including the module-level "THREE FURTHER STATES" block and the
    `attemptedContacts` field doc's warning about which cadence label must never be attempted.
- **`tests/caring-contacts-demo-seed.test.ts`** -- added
  `"never advances a contact past scheduled while its own day is still in the future"` to the
  `"the seeded population"` block. It walks every seeded plan's contacts (not only Rowan's), filters
  to `DISPATCHED_CONTACT_STATES` (sent, delivered, or any provider exception -- the general "message
  already left" set the domain itself publishes, not just the two outcomes this seed happens to use
  today), and asserts each one's own `calendarDay` is on or before the current AWST day. It also
  guards against a vacuous pass (`expect(dispatchedContacts.length).toBeGreaterThan(0)`), following
  the same pattern the file's own Round 1, I4 comments already use twice.
- **`tests/caring-contacts-schedule.test.ts`** -- added a `calendarDayPlusMonths` describe block
  (4 cases): agreement with `buildApprovedSchedule`'s own `Month 2` cadence entry, a negative-month
  case (the demo seed's actual usage), clamping in both directions on a shorter target month, and
  `null` on an invalid calendar day -- matching the existing `firstContactDayBounds` block's style
  immediately above it in the same file.
- **`docs/caring-contacts/task-seed-timeline-report.md`** -- this report.

No existing test's _assertions_ were changed -- only the module doc comments and seed data they
describe. The renamed field (`dischargeDaysBeforeShared` -> `dischargeMonthsBeforeShared`) had no
other reference anywhere in `src/` or `tests/` (checked with a repo-wide grep before renaming).

## Verification

**1. The regression guard actually catches the original defect.** Before restoring the fix, the
new test was run against the pre-fix `demo-seed.ts`/`schedule.ts` (via `git stash`) to confirm it
fails there and not just trivially against the corrected code:

```
 × |node| tests/caring-contacts-demo-seed.test.ts > the seeded population > never advances a
   contact past scheduled while its own day is still in the future 18ms
   → expected false to be true // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 16 skipped (17)
```

**2. `npx vitest run --reporter=dot tests/caring-contacts-demo-seed.test.ts`** (post-fix):

```
 Test Files  1 passed (1)
      Tests  17 passed (17)
```

(16 pre-existing + 1 new guard.)

**3. The full caring-contacts unit set, discovered from disk:**

```
npx vitest run --reporter=dot $(ls tests/*caring-contacts* | grep -vE "\.spec\.ts$" | tr '\n' ' ')
```

`ls` matches 65 filenames (task instructions said to expect 63 and to say loudly if the count
dropped). It did not drop -- it grew, because this branch already carries two more caring-contacts
test files (added by unrelated prior commits already on this branch before this task started) than
the task's author had in view. Vitest's own collection excludes 2 of the 65
(`caring-contacts-migrations.test.ts` and `caring-contacts-postgres-repository.test.ts`, both
live-Postgres-only and self-gated), landing on exactly **63 Test Files**, matching the task's
expected count precisely:

```
 Test Files  63 passed (63)
      Tests  1407 passed (1407)
```

(1402 pre-existing + 1 new demo-seed guard + 4 new `calendarDayPlusMonths` cases in
`caring-contacts-schedule.test.ts`.)

**4. Proof of the resulting state**, from an ephemeral test (`tests/caring-contacts-demo-seed-timeline-proof.test.ts`,
written, run, and deleted -- not part of the permanent suite) that drove the real seeded in-memory
store and printed Rowan's cadence table:

```
TODAY (AWST): 2026-08-29
┌─────────┬──────────────┬──────────────┬────────────────┬─────────────────┐
│ (index) │ cadenceLabel │ calendarDay  │ state          │ relationToToday │
├─────────┼──────────────┼──────────────┼────────────────┼─────────────────┤
│ 0       │ 'Day 1'      │ '2026-06-30' │ 'delivered'    │ 'before'        │
│ 1       │ 'Week 1'     │ '2026-07-06' │ 'delivered'    │ 'before'        │
│ 2       │ 'Month 1'    │ '2026-07-29' │ 'notDelivered' │ 'before'        │
│ 3       │ 'Month 2'    │ '2026-08-29' │ 'scheduled'    │ 'equal'         │
│ 4       │ 'Month 3'    │ '2026-09-29' │ 'scheduled'    │ 'after'         │
│ 5       │ 'Month 4'    │ '2026-10-29' │ 'scheduled'    │ 'after'         │
│ 6       │ 'Month 6'    │ '2026-12-29' │ 'scheduled'    │ 'after'         │
│ 7       │ 'Month 8'    │ '2027-02-28' │ 'scheduled'    │ 'after'         │
│ 8       │ 'Month 10'   │ '2027-04-29' │ 'scheduled'    │ 'after'         │
│ 9       │ 'Month 12'   │ '2027-06-29' │ 'scheduled'    │ 'after'         │
└─────────┴──────────────┴──────────────┴────────────────┴─────────────────┘
```

Every contact carrying a delivery outcome sits in the past. Exactly one contact (`Month 2`) sits on
today and is `scheduled`. Everything after today is `scheduled`. This is the property the task
exists to establish, and it is now checked mechanically, not only read off a printed table.

**5. `npx eslint` on the four changed files:** clean, no output.

Not run: `npm run typecheck` (unscoped `tsc --noEmit -p tsconfig.json` was run and its only errors
are eight pre-existing, unrelated `TS1003`/`TS1109` parse errors inside a generated
`.next/dev/types/validator.ts` -- a stale Next.js dev-server artifact unrelated to this diff and
outside `src/`/`tests/` entirely; grep confirmed neither changed file appears in that error output).
Not run: the browser/Playwright gate, per the task's explicit instruction to leave the isolated
Playwright server's seeding path untouched, and because this diff touches no rendering code -- the
change is confined to seed data, one schedule helper, and unit tests.

## What was not done, and why nothing was left undone by weakening a guard

Nothing. No refusal was hit that needed working around, no guard was loosened, and no clinical
prose was invented (the discharge shift needed no `firstContactReason` at all, since
`buildApprovedSchedule`'s `firstContactDate` input is never set by this seed).
