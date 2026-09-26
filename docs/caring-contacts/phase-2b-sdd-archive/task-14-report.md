# Task 14 — contact and delivery exception, and this group's overlays

Group 2's write surface: moving one caring contact within the day it is already scheduled for, the
warning that stands in the way of a time this service may not send at, and what the Schedule screen
says — and refuses to say — about a delivery the provider did not complete.

## Commits

| SHA          | What                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------- |
| `7c3dacb17`  | Ruling [130]: the frozen overlay table carries its own ids, and the trigger takes the union. |
| `1f0dea068`  | `ScheduleEntry.contactVersion`, and the route that moves one contact within its day.         |
| `be4b6a791`  | The three overlays wired onto the Schedule screen.                                           |
| `01f656acb`  | The word-ban fix: Task 13's whole-screen assertion, kept rather than weakened.               |
| `ee57d649f`  | The two new suites: the DOM control and the HTTP boundary.                                   |
| `b74500d02`  | Three screen cases for the delivery exceptions, and the version pinned in the view suite.    |
| `f4769b8d9`  | Wait for any outcome before asserting which one it is; the unreadable-role case.             |
| `b6a151b85`  | This report, committed before the gates and the ledger were in it.                           |
| `82e9c1487`  | Formatting for the two files Prettier had not seen.                                          |
| `878385245`  | The already-sent absence assertion, found by designing mutation T17.                         |
| `2e071506c`  | The final gate on the final tree, written into the gates table.                              |
| _(this one)_ | This commit table.                                                                           |

Every SHA above was re-checked with `git cat-file -e <sha>^{commit}` after the last commit of this
task; the branch log is the authority for the rows this table cannot name before they exist.

## The finding that shapes the whole task, and it is not the one the brief predicted

**The brief said Task 10 established that no per-attempt record exists in the domain. That is not
what the tree holds, and the difference matters.**

**Corrected after review, and this is the version to inherit.** The coordinator checked it against
the tree and found the generalisation was theirs rather than Task 10's: **Task 10 found that it could
not reach a per-attempt record from its screen**, and that was written up as "no per-attempt record
exists in the domain." Those are different claims and only the first is true. The paragraphs below
were written against the brief's wording; read them as answering the true claim — the record exists,
and no schedule surface can reach it.

`repository.ts` declares `DispatchRecord`, keyed by `(contactId, attempt)`, with `startedAt`,
`expectedStatus`, `reportedStatus`, and a `discrepancyResolution` that `resolveDispatchDiscrepancy`
writes. `POST /api/caring-contacts/dispatches` already exposes that write. So a per-attempt record
does exist, and so does the decision surface `resolve-failed-delivery` is named for.

What does **not** exist is the thing the frozen row's copy describes. Three separate facts, each
checked in the tree rather than inferred:

1. **Nothing dispatches a contact twice.** `startContactDispatch` is the only writer that opens a
   dispatch record, and it runs `applyContactTransition`'s `startProcessing`, which accepts a
   `scheduled` contact and nothing else. A contact carrying a provider outcome is not `scheduled`,
   and no method anywhere in the contract returns one to that state. `DispatchRecord`'s own comment
   says it: "there is no method anywhere in this contract that re-dispatches a contact whose status
   is uncertain." So the attempt number exists in the shape and is always the first one.
2. **The schedule read publishes neither the contact's dispatch record nor its attempt number.** It
   is built from `listPlans`, deliberately — Ruling 124 — and `PlanRecord` carries no dispatch.
3. **The only read that returns dispatch records is keyed by a window over `startedAt`** — the
   instant a SEND BEGAN — which is a different instant from the one a schedule groups by
   (`planned.sendAt`). In a running service the two usually fall on the same day; nothing in this
   domain guarantees it, and `listDispatches` offers no by-contact filter.

**This is the fifth instance of the recorded pattern, and it is a sharper one than "the field does
not exist": the field exists and is unreachable from this surface.** The approved design is a
coherent picture of a later, integrated product; the types are a specification of what is built.

### What I did about it, and what I did not

`resolve-failed-delivery` is wired with `{ kind: "unavailable", reason }` rather than to a write, and
the reason is where the row's own copy gets corrected. I did not add a by-contact dispatch read: that
is a repository contract change with its own review, exactly as the brief says, and joining a day's
contacts to a day's dispatches by date would be relying on a coincidence the domain does not
guarantee — a resolution recorded against the wrong attempt is not an acceptable way to be wrong on
this panel.

**The correction is placed inside the overlay, not beside it.** The host renders the row's frozen
summary, which opens "All three attempts in the original window are finished" — transcribed from
`docs/caring-contacts/interaction-matrix.md`, checked against it row for row, and not mine to edit.
A clinician who opens that overlay must not be left with the sentence, and the `unavailable` reason
is the only text this screen puts on the same surface. So it begins by correcting it:

> Nothing can be recorded here, and one thing this overlay says needs correcting first: this service
> does not keep a history of sending attempts. It records the outcome of a single attempt for a
> contact and has no way to send another, so there is no set of attempts to close off. …

The panel says the same thing once, above the rows, so a coordinator who never opens the overlay
still reads it. **No sentence this screen renders counts attempts**, and a case asserts that against
the screen's own text — scoped to the screen rather than to the document, because the overlay's
frozen wording is on the document and is not this screen's claim.

### What is rendered instead

Four of the five named-exception states are provider outcomes, and until now the screen said nothing
about any of them: `notSendingExplanation` covers only the states `contactSendability` answers
`willNotBeSent` for, and those four are `alreadySent`. Each now states, in place, what the record
holds and what follows — the transport receipt, and that nothing is sent again — through the same
`AutomatedState` region every other automated state on this screen uses. `missed` is deliberately
left to `notSendingExplanation`, which already states it; two statements on one row would be the same
fact told twice in different words.

## Ruling [130], done first

`WORKSPACE_OVERLAY_DEFINITIONS` was annotated `readonly WorkspaceOverlayDefinition[]`. `id` is
declared `string` on that type — it has to be; the type describes the shape of a row, not the
twenty-four rows — so the annotation erased every literal, and a trigger's `overlayId` could only
ever be a `string`.

`as const` before the `satisfies` is what preserves them (`satisfies` alone cannot: it checks against
a type whose `id` is already `string`, so there is no narrower expected type to keep). From the rows:

- `WorkspaceOverlayId` — the twenty-four ids;
- `MutatingOverlayId` / `NonMutatingOverlayId` — `Extract` over the row union on the literal
  `mutatesState`, which is available at type level only because the rows are `as const`;
- `MUTATING_OVERLAY_IDS` is now typed as the first of those rather than `readonly string[]`, so the
  value and the type cannot disagree about which rows they describe.

`WorkspaceOverlayTrigger.overlayId` takes the union. **The runtime throw stays** — a cast, an `any`,
or a value that entered the program untyped all reach the component past the type, and an overlay
that opens nothing must fail loudly however it was asked for. Its test splits in two accordingly: a
`@ts-expect-error` case that fails the typecheck if the compile error ever stops being raised, and a
render case that defeats the type deliberately with a cast, because that is the only remaining way in.

`contact-time-adjustment.tsx` uses the derived type for work rather than decoration:
`[ADJUST_DATE_TIME, OUTSIDE_WINDOW_WARNING] as const satisfies readonly MutatingOverlayId[]`. Both
rows are `mutatesState: true`, and the whole shape of that file — a commit-time recheck, a guard that
must not write, a refusal that survives into the next opening — is the shape a mutating row needs. If
either row were ever re-frozen as non-mutating its controls would become exits, and that annotation
makes the wrong wiring a compile error rather than a reading somebody has to make.

## The commit-time recheck, and the one of the four that does not exist

The matrix requires a mutation-bearing action to recheck connectivity, permission, authentication and
version state **at commit time**. A coordinator can raise a confirmation and sit on it, so the checks
run after the confirm and immediately before the request.

- **Connectivity** — `navigator.onLine`, read at the commit. Nothing is requested when it is false;
  an offline commit must not depend on a fetch failing.
- **Permission** — the acting role is read again from `/api/caring-contacts/session` and the
  capability rechecked through the sealed domain's own `canPerformCaringContactAction`. The
  membership test on the role string is `Object.hasOwn` against `CARING_CONTACT_ROLE_WORDING`, not a
  list written in the component and not `!== undefined`, which an inherited `constructor` would pass.
- **Version** — the version the screen rendered from travels as `expectedContactVersion`, and the
  store refuses `stale-version`. That check is the store's, which is the only place it can be made
  truthfully.
- **Authentication — there is none to recheck, and I did not perform one.** This prototype has no
  credential and no session that can expire; `session.ts` says of itself that it is deliberately not
  a login and that its cookie holds only a role name. The nearest true fact is the acting role, which
  the permission recheck already re-reads. A fourth check here would have been theatre, and it is
  recorded as a disagreement with the matrix rather than faked.

`ScheduleEntry` gained `contactVersion` so the third of those is possible at all. It is a counter the
domain increments on every write to the contact; it names nobody, and the entry beside it already
carries the contact id, the plan id and the synthetic patient id.

## `outside-window-warning`, and the third overclaim that did not happen

Two different rules govern the two things this screen says about time, and conflating them is exactly
what the two earlier corrections were about:

- `sendingPreferenceAt` answers which of the three approved send times an instant is — `null` for
  anything that is not exactly one of them at minute zero. That is what the "Not at an approved send
  time" group means, and it says nothing about any range.
- `isWithinApprovedSendWindow` tests the HOUR against `APPROVED_SEND_WINDOW`, whose latest hour is
  **exclusive**. That is the rule `moveContactWithinDay` refuses against, and it is the rule that
  decides which overlay this control raises.

So the helper text is derived from those two constants rather than written out, and it says "from
9:00 am up to but not including 6:00 pm AWST". "Between 9 and 6" would have been the third instance
of the same error class, and a case asserts both halves: that the exact phrase is present, and that
the closed-range form is not.

The row's decision is "Keep the approved time", and keeping a time is not a write — so it is wired as
the contract's **No change** outcome: the field returns to the time the contact is already scheduled
for, and the statement says that no message was sent, no number was contacted and nothing outside the
browser happened. **The matrix marks that row `mutatesState: true` and its own decision records
nothing**; that disagreement is stated in the code rather than resolved quietly. Returning the field
is also the recovery — the scenario clears because the recovery action succeeded, not because the
overlay was dismissed.

## What was built

| File                                                                       | What it is                                                                         |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/components/caring-contacts/workspace/contact-time-adjustment.tsx`     | NEW. The client control: the time field, the two triggers, the commit-time checks. |
| `src/app/api/caring-contacts/plans/[planId]/contacts/[contactId]/route.ts` | NEW. `POST` — the within-day move, and only that.                                  |
| `src/components/caring-contacts/workspace/overlays/definitions.ts`         | EDIT. Ruling [130]: literal ids and the three derived types.                       |
| `src/components/caring-contacts/workspace/overlays/overlay-trigger.tsx`    | EDIT. `overlayId` takes the union; the throw stays as belt-and-braces.             |
| `src/components/caring-contacts/workspace/schedule-screen.tsx`             | EDIT. The acting context, the delivery-exception statements, the two new controls. |
| `src/app/caring-contacts/schedule/page.tsx`                                | EDIT. Asks the domain for `moveContactWithinDay` and passes the acting context.    |
| `src/lib/caring-contacts/schedule-view.ts`                                 | EDIT. `ScheduleEntry.contactVersion`.                                              |
| `tests/caring-contacts-contact-time-adjustment.dom.test.tsx`               | NEW. The control, against the real store.                                          |
| `tests/caring-contacts-contact-route.test.ts`                              | NEW. The HTTP boundary.                                                            |
| `tests/caring-contacts-schedule-screen.dom.test.tsx`                       | EDIT. Three delivery-exception cases, and the acting context in the render helper. |
| `tests/caring-contacts-schedule-view.test.ts`                              | EDIT. The published contact version.                                               |
| `tests/caring-contacts-overlay-trigger.dom.test.tsx`                       | EDIT. The compile-time and run-time halves of the id guard.                        |
| `tests/caring-contacts-explained-automation.dom.test.tsx`                  | EDIT. The new client boundary added to the allowlist, with its three conditions.   |
| `package.json`                                                             | EDIT. Four suites added to `test:cc-guards`.                                       |
| `docs/site-map.md`                                                         | Regenerated.                                                                       |

## Two things about the route worth knowing

**The date change is not offered.** `rescheduleContact` accepts either change, but `changeContactDate`
requires a non-blank reason and a recorded team-lead approver, and an approval nobody gave must never
be defaulted in. The schema is a discriminated union of one member so that a second kind of
reschedule is a new member with its own required fields rather than an optional field bolted on.

**`RescheduleContactInput.change.contact` is dead input, and that is a finding.** Both stores discard
the caller's `PlannedContact` and re-read the one they hold — deliberately, so a caller cannot smuggle
a different calendar day past the two rules. The field is therefore something every caller must supply
and no implementation reads. The route reads the real contact rather than fabricating a placeholder,
because a placeholder would put a value in the request that says something untrue; that lookup is not
recorded on the access trail, on `handler.ts`'s own stated rule that a read is recordable where it
CROSSES A BOUNDARY, and nothing from this one is released to the caller. Narrowing the field touches
both stores and the shared contract suite, so it is reported rather than done here.

## Verification

### Gates

| Gate                                                                | Evidence                                                   |
| ------------------------------------------------------------------- | ---------------------------------------------------------- |
| `npm run test:cc-guards` (`GATE_RECEIPTS=refresh`), at `b74500d02`  | `Test Files  27 passed (27)` and `Tests  523 passed (523)` |
| The four suites this task can move (`GATE_RECEIPTS=refresh`), later | `Test Files  4 passed (4)` and `Tests  63 passed (63)`     |
| `npm run test:cc-guards` (`GATE_RECEIPTS=refresh`), FINAL TREE      | `Test Files  27 passed (27)` and `Tests  525 passed (525)` |
| `npx tsc --noEmit`, final tree                                      | exit 0, zero `error TS` lines emitted                      |
| `npx eslint --no-cache`, every changed TypeScript file              | `files linted: 15`, `errorCount: 0 warningCount: 0` (JSON) |
| `prettier --check`, every file this task changed                    | `All matched files use Prettier code style!`               |

`typecheck` prints nothing on success, so its row is an exit code and an absence of diagnostics
rather than a summary line. The ESLint cache directory was deleted before that run and `--no-cache`
passed, because the per-file cache is what hides a failure caused by a different file's change.
`prettier --check` was run because formatting is in none of the other three, and it caught two files
(`tests/caring-contacts-contact-route.test.ts` and this report), repaired in `82e9c1487`.

The FINAL TREE row is the one to read: it ran after the last commit, on the tree as it stands, and
its `525` is `523` plus the two cases added since — the role-recheck split and the already-sent
absence case. **It is what covers the assertion the four-suite row could not**, and it is the run that
catches collateral damage a per-suite mutation run structurally cannot see. It took nineteen
consecutive lease refusals before a run produced a summary line.

**What the two earlier suite rows cover between them, precisely.** The full run at `b74500d02` covers every
source change this task made — no source file has been touched since. Three commits followed it:
`f4769b8d9` (the DOM test restructure), `b6a151b85` (this report) and `82e9c1487` (formatting), and
the first of those is what the four-suite run covers. **The one thing neither covers is the assertion
added last** — "offers no move control on a contact that has already been sent" — which is stated in
its own right below rather than folded into a green — and the FINAL TREE row above is where it
finally was.

The full `npm run test` was **not** run: the controller owns it at the merge point.

**One disclosure about how a gate was run.** Early in this task, before adopting the per-mutation
narrowing, I ran `npx vitest run tests/caring-contacts-contact-route.test.ts` directly once, which
takes NO lease from the run coordinator and therefore ran as a third concurrent job while capacity was
full. It was not repeated; every run after it went through `scripts/run-vitest.mjs`.

### The browser gate — what I think it needs, which I did not run

`tests/ui-caring-contacts-workspace.spec.ts` is **untouched by this task**, and I believe it needs no
new block. Task 13's `SCHEDULE_SCREEN` entry and its seven tests already satisfy
`tests/caring-contacts-workspace-screens.test.ts`; no route was added here.

The honest reason there is nothing to add is the same one Task 13 gave for its own block: **the
isolated Playwright server seeds no plans**, so every day of the strip is empty, no contact row
renders, and neither of this task's controls exists on the page for a browser to reach. A block
asserting their absence would pass for the wrong reason.

What that leaves unproved in a real browser, stated rather than glossed:

- the time field and the two triggers at 320px, where the row is already the tightest content on the
  screen and the field, the trigger and the recovery control share one wrapping row;
- forced colours on the refusal paragraph the overlay renders — the DOM suite asserts the
  `aria-disabled`/`aria-describedby` pairing, which is what carries the reason when the accent colour
  is dropped, but not that the surface survives;
- the overlay's own return of focus to the trigger that opened it, which the shared host owns and
  Task 19 proves across all twenty-four rows.

If the owner wants browser evidence for this control, the cheapest route is seeding one active plan
in the isolated server rather than writing assertions around its absence.

### The mutation ledger

**SUPERSEDED BY ROUND 2 — every row below ran, and the results are in that ledger.** This section is
left standing rather than rewritten, because what it records about the shared machine is true and is
the reason the remedy was needed: the wide selection could not get a lease, and the narrow one could.
Read the outcome in Round 2; read this for why it took two rounds.

**The suite-borne rows are UNRUN, and that is the honest result rather than a shortfall dressed up.**
The shared focused-test capacity was continuously full for the whole window this task had: the
coordinator named `C:\Users\joshs\.codex\worktrees\document-viewer-workspace-20260826\Database`
and then `C:\Users\joshs\.codex\worktrees\remove-followup-suggestions\Database` as the owners,
the second running `playwright tests/ui-smoke.spec.ts --project=chromium`. The driver retried on the
coordinator's own markers — never on the lock directory path, which a run that merely WAITED also
prints — and **T1 alone was refused twenty-three consecutive times over about fifty minutes** before I
stopped it. Task 13's worst round saw eight.

A lock refusal is neither a pass nor a failure. I did not force past another worktree's lease, and I
did not run the suites outside the coordinator to get around it. The rows below record what each
mutation was for, so a later round can run the table as it stands rather than rebuild it.

**Two rows DID run, because their guard is the typechecker rather than a suite**, and `tsc` takes no
lease. Both are real proofs of the Ruling [130] work, and both predictions were exact:

| #   | Mutation                                                                | Gate  | Predicted                                                              | Result | The line it printed                                                                                                                               |
| --- | ----------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| T18 | `WorkspaceOverlayId` widened back to `string`                           | `tsc` | the trigger suite's `@ts-expect-error` case has nothing left to expect | RED    | `tests/caring-contacts-overlay-trigger.dom.test.tsx(108,7): error TS2578: Unused '@ts-expect-error' directive.`                                   |
| T19 | `outside-window-warning` swapped for the non-mutating `delivery-detail` | `tsc` | the `satisfies readonly MutatingOverlayId[]` in the control refuses it | RED    | `contact-time-adjustment.tsx(75,3): error TS2322: Type '"delivery-detail"' is not assignable to type '"verify-identity" \| … \| "team-switcher"'` |

T18 is the one that matters most: before the narrowing that `@ts-expect-error` did not compile as an
error at all, which is exactly why the hole existed. T19 proves the derived `MutatingOverlayId` is
doing work in this task's own wiring rather than decorating it — the union in that error message is
the sixteen mutating rows, and the non-mutating id is refused by name.

**The table that did not run.** Every row was validated against the file allowlist and the
id-uniqueness check before any file I/O, and each names the suite it targets rather than the whole
`test:cc-guards` set:

| #   | File                      | Suite                           | Mutation                                                           | Predicted                                                                                                    | Result |
| --- | ------------------------- | ------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------ |
| T1  | `contact-time-adjustment` | contact-time-adjustment         | the commit-time recheck stops re-reading the acting role           | the role case loses "auditor"; the unreadable-role case's record CHANGES; the recovery case clears its guard | UNRUN  |
| T2  | `contact-time-adjustment` | contact-time-adjustment         | the commit ignores the refusal its own recheck produced            | the role case loses "auditor"; the unreadable-role case's record changes                                     | UNRUN  |
| T3  | `contact-time-adjustment` | contact-time-adjustment         | the connectivity check is dropped                                  | the offline case's record changes — the write lands                                                          | UNRUN  |
| T4  | `contact-time-adjustment` | contact-time-adjustment         | the success wording stops saying the outcome is synthetic          | the success case's "no message was sent" assertion, and only it                                              | UNRUN  |
| T5  | `contact-time-adjustment` | contact-time-adjustment         | the write sends a version one ahead of the rendered one            | success becomes stale; the stale case succeeds — two cases                                                   | UNRUN  |
| T6  | `contact-time-adjustment` | contact-time-adjustment         | the window rule is ignored, so the warning is never raised         | 18:00 opens `adjust-date-time`; the No change case commits a move — two cases                                | UNRUN  |
| T7  | `contact-time-adjustment` | contact-time-adjustment         | the window wording becomes a closed range                          | the exclusive-bound assertion, and only it                                                                   | UNRUN  |
| T8  | `contact-time-adjustment` | contact-time-adjustment         | the No change outcome borrows the success sentence                 | the `not.toContain("Recorded on the plan")` assertion                                                        | UNRUN  |
| T9  | `contact-time-adjustment` | contact-time-adjustment         | keeping the approved time no longer returns the field              | the recovery assertion on the field's value                                                                  | UNRUN  |
| T10 | `contact-time-adjustment` | contact-time-adjustment         | the recovery clears the guard whether or not the recheck passed    | the still-refused re-open finds no `aria-disabled`                                                           | UNRUN  |
| T11 | `contact-time-adjustment` | contact-time-adjustment         | a standing guard no longer reaches the decision control            | both `aria-disabled` assertions — two cases                                                                  | UNRUN  |
| T12 | `schedule-screen`         | schedule-screen                 | a provider outcome states nothing at all                           | the transport-receipt group is not found; the overlay case finds no trigger                                  | UNRUN  |
| T13 | `schedule-screen`         | schedule-screen                 | the panel stops saying an attempt history is not held              | the positive half of the absence case                                                                        | UNRUN  |
| T14 | `schedule-screen`         | schedule-screen                 | the overlay refusal drops the correction to its own frozen summary | the `aria-describedby` text assertion                                                                        | UNRUN  |
| T15 | `schedule-view`           | schedule-view + schedule-screen | the entry publishes a constant version                             | the view suite's version pair — `expected 1 to be 2`                                                         | UNRUN  |
| T16 | contact route             | contact-route                   | the route ignores the version the caller sent                      | the stale-version case gets 200 — `expected 200 to be 409`                                                   | UNRUN  |
| T17 | `schedule-screen`         | schedule-screen                 | the move control is offered on a contact already sent              | **predicted GREEN, and that prediction is why an assertion was added** — see below                           | UNRUN  |

**T17 is the row worth reading.** Designing it found a real coverage gap before it was run: nothing in
either suite asserted that the move control is ABSENT on a contact that has already gone out, so a
screen offering to change the send time of a delivered message would have been green. The assertion
now exists — "offers no move control on a contact that has already been sent", with the still-to-send
day as its positive control, because an absence check against a screen that renders nothing passes for
the wrong reason. **That assertion is green in the FINAL TREE run above**, and **its falsifying mutation T17 ran in
Round 2 and went red** — `expected <div ...(3)>...(4)</div> to be null`. The claim that it would go
red on the screen it is written against is no longer untested.

### The driver, and its four guards

`scratchpad/cc-schedule-task14/mutate.mjs` — a separate directory from Task 13's, because Task 13
recorded one implementer's driver being overwritten by another task's at the same path. Every path and
name carries `cc-schedule-task14`, and each log's first lines record the worktree, the suite and the
id, so a result that is not this task's says so itself.

Both of Task 13's guards are kept, and two more were added for this task. Each has a positive control
that fires on its own line, and each control was run:

| Control           | What it applies                              | What was printed                                                                                         |
| ----------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `CTRL_ABSENT`     | an anchor that is not in the file at all     | `cc-schedule-task14 CTRL_ABSENT: the anchor matched 0 times, not once`                                   |
| `CTRL_NOOP`       | a replacement equal to its anchor            | `cc-schedule-task14 CTRL_NOOP: the post-image is identical to the file -- this mutation changes nothing` |
| `PROBE_FOREIGN`   | a row naming a file this task may not mutate | `cc-schedule-task14 PROBE_FOREIGN: …plan-wizard.tsx is not a file this task may mutate.`                 |
| `PROBE_DUPLICATE` | a repeated id                                | `cc-schedule-task14: the id T1 appears more than once`                                                   |

The last two are run from a temporary copy of the driver rather than from a permanent row, because a
foreign row or a duplicated id would break every ordinary run; the copies were deleted afterwards. The
id check is why the table is an ARRAY: **an object literal cannot detect a duplicated key at all** —
the later one silently wins — which is the shape that let a foreign row cross into another task's
driver this session.

The two file guards remain separate lines with separate messages, deliberately and for the reason
Task 13 gave: the occurrence guard catches an absent or ambiguous anchor and fires first; the
post-image guard catches a mutation that matches its anchor and changes nothing anyway, which a count
cannot see. Neither is the other's substitute, and the gap between them was created once by an edit
that removed one and left the other looking sufficient.

`git status --porcelain` was asserted empty before each mutation and again after each restore, by the
driver, which throws rather than continuing. When the round was stopped, the driver was parked and the
worktree restored by hand; `git status --porcelain` is empty and was verified after the restore.

### The shared machine

Beyond the mutation round, ordinary gate runs were refused repeatedly: one round of
`npm run test:cc-guards` was refused eight consecutive times before a run produced a summary line, and
a later round more than twenty. Every refusal is recorded as UNRUN and retried; none was forced.

## Seams left

1. **A by-contact dispatch read.** The one change that would let `resolve-failed-delivery` record
   anything from this screen. It is a repository contract change: `listDispatches` is keyed by a
   window over `startedAt`, and a schedule cannot honestly join on that.
2. **`RescheduleContactInput.change.contact` is dead input** on the repository contract. Narrowing it
   removes a required field no implementation reads.
3. **`lettersFromRandomIdentifier` now exists twice** — in `plan-activation.ts` and in
   `contact-time-adjustment.tsx`. The right home is a module both can import; importing the wizard's
   would widen this boundary's client module graph for eight lines.
4. **The date change has no screen.** `changeContactDate` needs a reason and a team-lead approver, and
   nothing in this workspace collects either.
5. **TWO frozen rows this task raises describe a capability that does not exist.** Corrected in round
   3, which added the second.
   - **`resolve-failed-delivery`** — "All three attempts in the original window are finished". The
     correction is in the `unavailable` refusal on the same surface, which is the strongest fix
     available without editing the frozen record.
   - **`outside-window-warning`** — "The time asked for falls outside 9:00 am to 6:00 pm AWST", the
     closed-range form, shown to a coordinator who typed exactly 18:00. **No correction is possible
     here**: this row's commit is a `record` (it is the No change outcome), so there is no
     `unavailable` reason string to carry one without breaking that wiring.

   Changing either row is a matrix change. The coordinator is consolidating these with
   `message-preview`, `verify-identity` and `save-draft` as one finding for the owner.

## Concerns

1. **The brief's premise about the per-attempt record does not match the tree**, and the difference
   changed what I built. See the first section. If Task 10's report says a per-attempt record does not
   exist in the domain, that report is wrong about `DispatchRecord`; what is true is that nothing ever
   opens a second attempt and that a schedule cannot reach the record at all.
2. **`resolve-failed-delivery` records nothing**, so the "delivery exception" half of this task is a
   statement and a correction rather than a decision surface. I believe that is the honest outcome,
   but it is a smaller deliverable than the brief anticipated and the owner may disagree.
3. **`schedule-view.ts` is Task 12's module and I added a field to it.** `contactVersion` is the
   smallest thing that makes an optimistic-concurrency check possible from a screen, and the
   alternative — refetching the plan at commit time — reintroduces the race it is meant to close. It
   is two functional lines plus a seventeen-line comment to revert if the controller would rather it
   were not there. **Round 1 called it "one line" three times and that was wrong** — see round 3.
4. **The DOM suite mirrors the route rather than executing it.** `route.ts` imports `server-only` and
   `next/headers`, so it cannot run in jsdom. The mirror performs the same two steps in the same
   order with the same sealed-domain function, and the real handler has its own suite — but a
   divergence between the two would be invisible to both.
5. **`package.json`'s `test:cc-guards` gained four entries** (the two new suites plus the overlay
   trigger and host suites, which this task's type change can move). That is the line every other
   implementer is most likely to have touched. `definitions.ts` and `overlay-trigger.tsx` are the
   other shared files, and the brief already expects a conflict in the first.
6. **The move control is offered on a contact whose plan is holding it.** `rescheduleContact` does not
   gate on plan state, so setting the time a paused plan's contact would send at if it resumed is
   something the domain allows; the day already states above the windows that the plan is holding it.
   It is a product judgement, not a rule I found written down.

---

# Round 2 — after review

The review accepted the task and named one blocking item: fifteen of seventeen mutations had not run,
so this task's guard-rejection and commit-time-recheck assertions were **described rather than
proven**. They are proven now. Nothing is UNRUN.

## Commits

| SHA          | What                                                                                  |
| ------------ | ------------------------------------------------------------------------------------- |
| _(this one)_ | This round: the corrected premise, the completed ledger, and the four accepted notes. |

No source file changed in this round. Every SHA in both rounds was re-checked with
`git cat-file -e <sha>^{commit}` after the last commit of this round.

## 1 — the premise, corrected where the next task will read it

The coordinator verified my finding against the tree rather than relaying it back, and corrected the
brief: **Task 10 found it could not reach a per-attempt record from its screen, and that was written
up as "no per-attempt record exists in the domain."** Only the first is true. The correction is made
in place at the top of this report rather than only here, so a reader who never reaches Round 2 does
not inherit the false version.

The resolution stands unchanged: `resolve-failed-delivery` wired `unavailable`, with the correction
to the row's "all three attempts" copy **on the same surface that makes the claim**.

## 2 — the remedy that made the ledger runnable

The blocker was never the driver; it was the selection. Each row now runs
`node scripts/run-vitest.mjs run --reporter=dot tests/<the-suite>` instead of the twenty-seven-file
set — explicit paths still take the shared focused lease, so the round stays coordinated, and a run
that finishes in seconds holds the slot for seconds. **Twenty-one rows ran without a single refusal**,
against twenty-three consecutive refusals for one row under the wide selection.

Two selections are wider on purpose:

- **`SUITES.OVERLAYS`** — the overlay definitions, trigger and host suites plus the two screens — for
  a mutation to `definitions.ts` or `overlay-trigger.tsx`. Those are shared mechanisms every overlay
  consumer reads through, and a per-screen selection there would report green on damage it never
  looked at. Five suites, not twenty-seven.
- **`gate: "tsc"`** — for a mutation whose only effect is on a type. Vitest does not typecheck, so
  such a row is invisible to every suite; that is a fact about where the guard lives, not a gap. Each
  is paired with a `*G` row that runs the identical mutation against the suites, recorded as an
  over-sensitivity control rather than as coverage.

## The mutation ledger

Every row ran. `git status --porcelain` was asserted empty before each mutation and after each restore
by the driver, which throws rather than continuing; it was empty every time, and the tree was
separately checked after every row. Presence was checked in process, whole-file against the
post-image, and reported `true` for all twenty-one.

| #    | Selection          | Mutation                                                        | Predicted                                                                                   | Result | The line it printed                                                                                                                               |
| ---- | ------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1   | move UI            | the commit-time recheck stops re-reading the acting role        | the role case loses "auditor"; the unreadable-role case's record changes; the recovery case | RED    | `expected 'The role you are acting in is not gra…' to contain 'auditor'` — `3 failed / 7 passed (10)`                                             |
| T2   | move UI            | the commit ignores the refusal its own recheck produced         | two cases — **and this was wrong, see below**                                               | RED    | `expected 'The role you are acting in is not gra…' to contain 'auditor'` — `3 failed / 7 passed (10)`                                             |
| T3   | move UI            | the connectivity check is dropped                               | the offline case's record changes — the write lands                                         | RED    | `expected '{"sendAt":"2026-08-31T03:30:00.000Z",…' to be '{"sendAt":"2026-08-31T02:00:00.000Z",…'` — `1 failed / 9 passed (10)`                   |
| T4   | move UI            | the success wording stops saying the outcome is synthetic       | the success case's disclosure assertion, and only it                                        | RED    | `expected 'Recorded on the plan: this contact no…' to contain 'no message was sent and no number was…'` — `1 failed / 9 passed (10)`              |
| T5   | move UI            | the write sends a version one ahead of the rendered one         | success becomes stale; the stale case succeeds — two cases                                  | RED    | `expected 'Somebody else changed this contact wh…' to contain '11:30 AWST'` — `2 failed / 8 passed (10)`                                          |
| T6   | move UI            | the window rule is ignored, so the warning is never raised      | 18:00 opens `adjust-date-time`; the No change case — two cases                              | RED    | `expected 'adjust-date-time' to be 'outside-window-warning'` — `2 failed / 8 passed (10)`                                                         |
| T7   | move UI            | the window wording becomes a closed range                       | the exclusive-bound assertion, and only it                                                  | RED    | `expected 'A contact’s send time may be changed …' to contain 'up to but not including 6:00 pm AWST'` — `1 failed / 9 passed (10)`                |
| T8   | move UI            | the No change outcome borrows the success sentence              | the `not.toContain("Recorded on the plan")` assertion                                       | RED    | `expected 'Recorded on the plan. No message was …' not to contain 'Recorded on the plan'` — `1 failed / 9 passed (10)`                            |
| T9   | move UI            | keeping the approved time no longer returns the field           | the recovery assertion on the field's value                                                 | RED    | `expected '07:15' to be '10:00'` — `1 failed / 9 passed (10)`                                                                                     |
| T10  | move UI            | the recovery clears the guard whether or not the recheck passed | the still-refused re-open finds no `aria-disabled`                                          | RED    | `expected '' to contain 'not granted the action that moves a c…'` — `1 failed / 9 passed (10)`                                                    |
| T11  | move UI            | a standing guard no longer reaches the decision control         | both `aria-disabled` assertions — two cases                                                 | RED    | `expected null to be 'true'`, twice — `2 failed / 8 passed (10)`                                                                                  |
| T12  | screen             | a provider outcome states nothing at all                        | the transport-receipt group is not found; the overlay case finds no trigger                 | RED    | `Unable to find an accessible element with the role "group" and name "Transport receipt unavailable"` — `2 failed / 19 passed (21)`               |
| T13  | screen             | the panel stops saying an attempt history is not held           | the positive half of the absence case                                                       | RED    | `expected 'What this screen holds is what the pr…' to contain 'a history of sending attempts'` — `1 failed / 20 passed (21)`                      |
| T14  | screen             | the overlay refusal drops the correction to its frozen summary  | the `aria-describedby` text assertion                                                       | RED    | `expected 'Nothing can be recorded here yet. It …' to contain 'does not keep a history of sending at…'` — `1 failed / 20 passed (21)`             |
| T15  | view + screen      | the entry publishes a constant version                          | the view suite's version pair                                                               | RED    | `expected 1 to be 2` — `1 failed / 46 passed (47)`                                                                                                |
| T16  | route              | the route ignores the version the caller sent                   | the stale-version case gets 200                                                             | RED    | `expected 200 to be 409` — `1 failed / 6 passed (7)`                                                                                              |
| T17  | screen             | the move control is offered on a contact already sent           | **the assertion added because of this row goes red**                                        | RED    | `expected <div …(3)>…(4)</div> to be null` — `1 failed / 20 passed (21)`                                                                          |
| T18  | `tsc`              | the derived id union is widened back to `string`                | the trigger suite's `@ts-expect-error` has nothing left to expect                           | RED    | `tests/caring-contacts-overlay-trigger.dom.test.tsx(108,7): error TS2578: Unused '@ts-expect-error' directive.`                                   |
| T18G | overlays, 5 suites | OVER-SENSITIVITY CONTROL: the same widening, against the suites | GREEN — vitest does not typecheck                                                           | GREEN  | `Test Files  5 passed (5)` and `Tests  80 passed (80)`                                                                                            |
| T19  | `tsc`              | a non-mutating row wired into the control                       | the `satisfies readonly MutatingOverlayId[]` refuses it                                     | RED    | `contact-time-adjustment.tsx(75,3): error TS2322: Type '"delivery-detail"' is not assignable to type '"verify-identity" \| … \| "team-switcher"'` |
| T19G | overlays, 5 suites | the same swap, against the suites                               | GREEN — **and this was wrong, see below**                                                   | RED    | `expected 'delivery-detail' to be 'outside-window-warning'`, twice — `2 failed / 78 passed (80)`                                                  |

### Where a prediction was not what fired

Four misses, each stated with what it means rather than absorbed:

- **T2 reddened three cases where I predicted two.** T2 makes `commitMove` ignore the refusal its own
  recheck produced — and that refusal is produced for EVERY guard, not only the role one. So the
  connectivity case fell with it. The prediction was reasoning about the role check while the mutation
  was disabling the whole gate; obvious in hindsight, which is why it is written down.
- **T10, and T1's third case, fired one assertion earlier than predicted.** I named the
  `aria-disabled` re-open assertion in "clears a standing refusal only when the recheck passes"; what
  fired was the outcome assertion above it, `expected '' to contain 'not granted…'`. That is the
  mutation behaving correctly: clearing the guard also clears the outcome to nothing. **I checked this
  rather than accepting it**, because an empty string where a sentence was expected reads exactly like
  a flaky wait — it is not. T10 touches only `checkAgain`, and `checkAgain` sets the outcome to
  `none`.
- **T6's second case fired at its overlay-id assertion**, not at the outcome text I predicted. The No
  change case asserts which overlay opened before it confirms anything, so it never reaches the
  wording. Same conclusion, one line earlier.
- **T19G was predicted GREEN and came back RED**, which is the useful one. I had reasoned that swapping
  the id was a type-level change; it is not — it also changes which overlay the control OPENS. So
  `MutatingOverlayId` is proved twice, at the type level by T19 and at the behaviour level by T19G,
  and only T18/T18G is a genuine type-only pair.

**T18G is the one green, honestly.** It is recorded as an over-sensitivity control and nothing more:
widening `WorkspaceOverlayId` back to `string` cannot move a runtime assertion, because vitest does
not typecheck. Its red sibling T18 is where the claim lives, and that is the whole of Ruling [130]
landing — before the narrowing, that `@ts-expect-error` did not compile as an error at all.

**T17 is the row the review would not let pass, and it earned that.** Designing it found the gap
before running it: nothing asserted the move control is ABSENT on a contact already sent, so a screen
offering to change the send time of a delivered message would have been green. The assertion now
exists, has a still-to-send positive control, and **goes red on the mutation it was written for**.

## The four notes the review accepted, recorded so nobody undoes them

1. **There is no fourth commit-time recheck, and one must not be added.** Connectivity, acting role
   and record version are rechecked at the commit. Authentication is not, because this prototype has
   no credential and no session that can expire — `session.ts` says of itself that the role switcher
   is deliberately not a login. **A later reader must not "fix" this by adding a hollow check**: a
   check that cannot fail is worse than a documented absence, because it reads as coverage.
2. **`schedule-view.ts` gained one line by a DELIBERATE UNFREEZE, not by drift.** The controller froze
   that module for Task 13 and accepted `ScheduleEntry.contactVersion` here, because without it a
   screen cannot perform the version recheck the matrix requires, and the alternative — refetching the
   plan at commit time — reintroduces the race it exists to close. **Its size, stated accurately after
   round 3**: two functional lines and a seventeen-line comment, nothing removed, and no other part of
   Task 12's contract touched.
3. **Task 13's whole-screen ban on "moved" was kept, not narrowed.** The ruling is about claiming a
   contact WAS moved; my helper text did not. Weakening a whole-screen guard to admit one's own
   sentence is how guards die, so the sentence changed instead.
4. **`RescheduleContactInput.change.contact` is dead input** on the repository contract — reported,
   not fixed, because narrowing it touches both stores and the shared contract suite.

## The browser gate — what the block would assert, once a seeded server exists

Concern 9 is the coordinator's to carry: Task 15 established that switching the seed on for the
existing isolated Playwright server breaks the empty-state tests, which `emptyStateColours` throws on
— so the answer is a **second server with the seed enabled**, and that is a merge-point job. What the
block should assert against it, stated now so it does not have to be re-derived:

- **A contact row carries a time field and one trigger**, and the trigger's accessible name names the
  synthetic patient identifier — a day of rows must not produce a column of identically named
  controls.
- **320px.** No horizontal overflow with the field, the trigger and (after a refusal) the recovery
  control on one wrapping row; each of the three at or above the 48px production tap floor. This is
  the tightest content on the screen and the DOM suite cannot measure it.
- **The domain's own boundary, end to end**: 17:59 opens `adjust-date-time`, 18:00 opens
  `outside-window-warning`. The exclusive latest hour is the fact two corrections in this programme
  have already been made about; a browser check costs one extra assertion.
- **Forced colours on the refusal.** The DOM suite pins the `aria-disabled` + `aria-describedby`
  pairing, which is what carries the reason when the accent colour is dropped; what it cannot show is
  that the paragraph and the panel border survive with the tokens replaced.
- **Focus returns to the trigger** when the overlay closes, and overlay-only navigation does not move
  focus to the page heading. The shared host owns this and Task 19 proves it across all twenty-four
  rows; the value here is proving it for a trigger inside a list row rather than a page-level control.
- **A confirmed move updates the day.** **Corrected in round 3 — as written here, the second half
  described a mechanism that did not exist.** See "Correction to the round-2 browser-block
  specification" in round 3 for the form that is true of the code.

## Gates, after the final edit of this round

| Gate                                                           | Evidence                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------ |
| `npm run test:cc-guards` (`GATE_RECEIPTS=refresh`), final tree | `Test Files  27 passed (27)` and `Tests  525 passed (525)`   |
| The 21 mutation selections, all coordinated                    | every row above carries its own `N passed` / `N failed` line |
| `npx tsc --noEmit`, final tree                                 | exit 0, zero `error TS` lines emitted                        |
| `npx eslint --no-cache`, every changed TypeScript file         | `files linted: 15`, `errorCount: 0 warningCount: 0` (JSON)   |
| `prettier --check`, every file this task changed               | `All matched files use Prettier code style!`                 |

**No tracked source file changed in this round.** The full-gate run above is the one taken on the
final code tree; everything since is prose in this report, which is where the re-verification regress
stops. The driver itself changed — it is a scratchpad file and is not committed — and its four guards
were re-run after that change: `CTRL_ABSENT` and `CTRL_NOOP` both threw on their own lines again.

## Concerns from round 2

1. **The DOM suite still mirrors the route rather than executing it**, unchanged by this round. T16
   proves the real handler's version check, so the two are pinned independently — but a divergence
   between the mirror and the handler would still be invisible to both.
2. **Two assertions are strengthenings rather than independently proven claims**, and are labelled so
   in the code: the "no contact-endpoint request" check behind the record-unchanged check in the
   unreadable-role case, and the panel-length assertion beside T14. Nothing falsifies either without
   also falsifying the assertion above it.
3. **T19G shows my reasoning about what is "type-only" is not reliable.** I predicted green on a
   mutation that changes runtime behaviour. The lesson generalises past this row: a constant named as
   a type-level pin is still a value somebody reads.

---

# Round 3 — after review

Spec PASS with one Important, and the Important was real: a confirmed move told a coordinator
something false. It is fixed, the case whose absence hid it is written and mutated, and writing that
case immediately found a second defect underneath it.

## Commits

| SHA          | What                                                                                               |
| ------------ | -------------------------------------------------------------------------------------------------- |
| `de47c24c3`  | The refresh, the tracked version, the corrected `stale-version` wording, and three cases for them. |
| `fa467f822`  | The case for a version the service never confirmed.                                                |
| _(this one)_ | This round.                                                                                        |

Every SHA in all three rounds was re-checked with `git cat-file -e <sha>^{commit}` after the last
commit of this round.

## 1 — the false statement, and the two defects behind it

**What a coordinator saw.** A confirmed move announced a new time while the row directly above it went
on showing the old one, and the contact stayed in its old window group. `ContactRow` renders
`Sends at:` from the SERVER render, and nothing asked the server to run again. The matrix's Success
clause asks for the outcome to be announced **and** the visible summary updated; only the first was
happening.

**What was worse, and what the review found.** `contactVersion` arrives as a prop, so it cannot change
until that refresh lands — and a coordinator who moves the same contact twice in a row does not wait.
The second write went out carrying the version the first had already consumed, the store refused it
`stale-version`, and the screen rendered _"Somebody else changed this contact while this was open."_
**Nobody had.** The thing that had changed it was this screen's own previous write, and the sentence
naming a person was an inference the record cannot support — on a suicide-prevention schedule.

Three changes, and the second is the one that actually closes it:

1. **`router.refresh()` after a successful commit**, so the row catches up with the sentence.
2. **The version this control sends is held in state**: seeded from the prop, advanced from the
   store's OWN answer to each write, and reset whenever a fresh server render hands down a different
   prop than it did last render (React's documented way of adjusting state while a prop changes).
   Held in state rather than waiting for the refresh, because the refresh is asynchronous and the
   second click is not.
3. **The `stale-version` wording no longer names anybody.** The store answers `stale-version` for any
   write against a version it has moved past and does not say what moved it — a coordinator, a
   dispatcher, or this screen. It now says "This contact changed after this screen read it", which is
   the whole of what the code guarantees.

**A version is never guessed.** `rescheduleContact` increments by exactly one, so `previous + 1` would
be right today — and silently wrong the first time anything else touches the contact between two
writes. A 200 whose body carries no readable version leaves the tracked version `null` and the next
commit is refused by name. That branch is covered by its own case (`fa467f822`), and T23 proves it.

### The second defect, found by writing the missing case

The two-consecutive-moves case failed on its first run for a reason that was not the one it was
written for: **the DOM suite's mirror of the route answered `{ value: null }` where the real handler
answers `{ value: <the updated StoredContact> }`.** So the control could never read a version back and
refused every second move.

That is exactly the divergence I listed as a concern in round 1 — "a divergence between the mirror and
the handler would be invisible to both" — and it was invisible until a test needed the field.
`tests/caring-contacts-contact-route.test.ts` now pins the body's `value.contact.version` **on the real
route**, so the mirror cannot drift from it on this field again. The general concern stands for every
field neither suite reads.

## 2 — `outside-window-warning` is the fifth frozen row, and seam 5 now says so

The review is right and I had scoped my own assertion too narrowly. That row's frozen summary is
_"The time asked for falls outside 9:00 am to 6:00 pm AWST, so it cannot be scheduled."_ — **the closed-range
form**, rendered by the shared host, shown to a coordinator who typed exactly 18:00, **on the overlay
this task's own control raises**. My screen-level assertion keeps the closed form out of the helper
text and cannot reach the overlay.

It is not fixable here, and the reason is structural rather than a judgement: unlike
`resolve-failed-delivery`, this row's commit is a `record` — it is the No change outcome — so there is
no `unavailable` reason string to carry a correction without breaking that wiring.

**Seam 5 is corrected below to name both rows.** The coordinator is consolidating all five such rows
(`message-preview`, `verify-identity`, `save-draft`, `resolve-failed-delivery` and this one) as one
finding for the owner.

## 3 — the three small ones

- **The three exports now have the walk they promised.** `SCHEDULE_MOVE_OVERLAYS`, `parseInputTime` and
  `moveRefusalWording` were exported with a comment saying a test would use them, and no such test
  existed. A promise in a doc comment is not coverage, and a later dead-code sweep would have been
  entitled to read the comment as a consumer. Three cases now walk them, and T26 and T24 prove two of
  them.
- **"One line" was wrong three times and the accurate figure is this**: `schedule-view.ts` gained
  **two functional lines** — `contactVersion: number;` on `ScheduleEntry` and
  `contactVersion: stored.contact.version,` in `entryFor` — **plus a seventeen-line doc comment**
  explaining why. Nineteen added lines, nothing removed, and no other part of Task 12's contract
  touched. The change is still the smallest one that makes the version recheck possible; the
  description of it was not.
- **Prettier was re-run on this report after this round's edits**, which is the check round 2 recorded
  before adding two hundred lines of markdown tables to the file it was recording.

**`NonMutatingOverlayId` is exported with no consumer, deliberately.** Tasks 11b, 16 and 20 inherit
it — it is the half of Ruling [130] that makes a read-only overlay's trigger refuse a mutating id, and
those tasks wire the read-only rows. **A dead-code sweep must not delete it**: `check:dead-code-candidate`
would find no importer, and the answer is that its consumer has not been written yet, which is the
exact shape the "deleting code you believe is dead" rule is about.

## The mutation ledger, round 3

Same driver, same four guards, same narrowed selection. `CTRL_ABSENT` and `CTRL_NOOP` were re-run
after the driver changed and both threw on their own lines. `git status --porcelain` was empty before
and after every row.

| #   | Selection | Mutation                                                                  | Predicted                                                           | Result | The line it printed                                                                                                                          |
| --- | --------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| T20 | move UI   | the write sends the PROP version again instead of the tracked one         | the second move is refused as stale — the exact defect that shipped | RED    | `expected { year: 2026, month: 8, day: 31, …(2) } to match object { hour: 15, minute: 45 }` — `1 failed / 16 passed (17)`                    |
| T21 | move UI   | the confirmed move no longer asks the server to re-render                 | the refresh spy is never called                                     | RED    | `expected "vi.fn()" to be called at least once` — `1 failed / 16 passed (17)`                                                                |
| T22 | move UI   | a fresh server render no longer reseeds the field or the version          | the field keeps a time the row above no longer shows                | RED    | `expected '11:30' to be '16:00'` — `1 failed / 16 passed (17)`                                                                               |
| T23 | move UI   | an unreadable version is guessed at as `previous + 1` rather than refused | **predicted GREEN and came back RED, see below**                    | RED    | `expected 'Recorded on the plan: this contact no…' to contain 'no longer knows which version of this…'` — `1 failed / 16 passed (17)`        |
| T24 | move UI   | the `stale-version` wording names a person again                          | the stale case and the wording walk — two cases                     | RED    | `expected 'Somebody else changed this contact wh…' to contain 'This contact changed after this scree…'`, twice — `2 failed / 15 passed (17)` |
| T25 | move UI   | the refusal map loses its null prototype                                  | GREEN — `Object.hasOwn` is the guard, see below                     | GREEN  | `Test Files  1 passed (1)` and `Tests  17 passed (17)`                                                                                       |
| T26 | move UI   | the wall-clock parser stops bounding the hour                             | `parseInputTime("24:00")` stops being null                          | RED    | `expected { hour: 24, minute: +0 } to be null` — `1 failed / 16 passed (17)`                                                                 |

### Where a prediction was not what fired

- **T23 was predicted GREEN and came back RED, and the order is the point.** I predicted green because
  `previous + 1` is right today, so no assertion would have caught the guess — **so I wrote the case
  before running the row**. The prediction was about the tree as it stood; the row was run against a
  tree where the branch was covered. Recording it as a miss rather than as a prediction I got right
  by accident: had I run first and written after, this would be a green row and an uncovered
  conservative branch.
- **T25 is the one green, and its reason is worth keeping.** Losing the null prototype changes nothing
  because **`Object.hasOwn` is the actual guard** — `Object.hasOwn({}, "constructor")` is false either
  way. The null prototype is belt-and-braces behind it, exactly as the runtime throw is belt-and-braces
  behind the narrowed overlay id. Recorded as an over-sensitivity control; the claim it might have
  looked like proving (that the prototype chain is what protects the lookup) is not one this suite
  makes, and `moveRefusalWording("constructor")` is asserted directly for the property that matters.

## Correction to the round-2 browser-block specification

Round 2 wrote, as the last bullet of what a seeded browser server should assert: _"the statement
announces the new time AND the row beneath re-renders at it."_ **At the moment it was written, nothing
implemented the second half** — there was no refresh, and the row did not re-render. That is a
mechanism nobody had seen run, described as a fact about behaviour, in the one place a later reader
would trust it most: a specification another task is meant to build against.

`de47c24c3` implements it. The bullet is therefore now a claim about code that exists — **and it is
still unproven in a browser**, which is the whole reason it belongs in that list rather than in a
gates table. The corrected form:

> **A confirmed move updates the day.** `router.refresh()` re-runs the Server Component after a
> successful commit, and the DOM suite proves only that the call is made — a mocked router cannot
> re-render a server tree. What a browser must show is the row's own `Sends at:` reading the new time
> afterwards, and the contact appearing under the window that time belongs to. **Neither has been
> observed;** they are what this bullet exists to have checked.

## The full gate caught what the narrow selections structurally could not

**This is the round's best argument for running the wide set once at the end**, and it is not
hypothetical: adding `useRouter()` to the control broke **eleven cases in the Schedule-screen suite and
two in the page suite**, none of which any per-mutation selection ever ran. `useRouter` throws outside
an app-router context and the hook runs at RENDER, so every screen test that draws a contact row fell
over with `Error: invariant expected app router to be mounted`. Both suites now mock it, annotated
with why a file that confirms no move still needs one.

Round 2 said a per-suite selection "cannot see collateral damage, and is not claimed to". That was the
right disclaimer and this is what it was about. The narrow selection is still correct for a mutation
round; the wide run at the end is what makes it safe.

## Gates, after the final edit of this round

| Gate                                                           | Evidence                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------ |
| `npm run test:cc-guards` (`GATE_RECEIPTS=refresh`), final tree | `Test Files  27 passed (27)` and `Tests  532 passed (532)`   |
| The 7 round-3 mutation selections                              | every row above carries its own `N passed` / `N failed` line |
| `npx tsc --noEmit`, final tree                                 | exit 0, zero `error TS` lines emitted                        |
| `npx eslint --no-cache`, every changed TypeScript file         | `files linted: 15`, `errorCount: 0 warningCount: 0` (JSON)   |
| `prettier --check`, every file this task changed               | `All matched files use Prettier code style!`                 |

The `532` is round 2's `525` plus seven: three cases for the move fix, one for a version the service
never confirmed, and three walking the exports that had promised a test and had none.

## Concerns from round 3

1. **The refresh is proved to be CALLED, not to have any effect.** A mocked router cannot re-render a
   server tree, so the DOM suite's evidence for the Success clause stops at the call. The browser
   bullet above is what closes it, and it is a merge-point job.
2. **`versionFrom` reads a shape the route produces but no type binds.** It parses
   `value.contact.version` out of an unknown payload; if `writeHandler`'s envelope or
   `rescheduleContact`'s return type changed, the client would quietly fall back to refusing every
   second move rather than failing loudly. The route suite pins the field, which is the cheap half;
   a shared response type would be the real fix and is a contract change.
3. **The reseeding is keyed on `(version, scheduledTime)`.** A server render that changed neither —
   there is no such write today, since every reschedule advances the version — would not reset a
   standing guard. Stated because it is a real edge of the pattern rather than an assumption I can
   prove away.

---

# Round 4 — after review, and the last one

Five items, all addressed. The branch merges next.

## Commits

| SHA          | What                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `25c1fabcb`  | One body schema for the client and the route; the two inert assertions; the two comment fixes. |
| `a6a0710d0`  | The route case that pins `.strict()`.                                                          |
| _(this one)_ | This round.                                                                                    |

Every SHA in all four rounds was re-checked with `git cat-file -e <sha>^{commit}` after the last
commit of this round.

## 1 — the body the client sends is now the body the route defines

The review found the sharpest remaining member of the mirror-divergence family, and it was worse than
the one caught in round 3. **The mirror never read `action` at all**: it `JSON.parse`d the body and
took four fields off the result, while the real route's union is `.strict()`, so a missing, renamed or
extra field is a 400. And the route's own suite builds its request from a fixture rather than from the
client. **A client-side body-shape regression was therefore invisible to both suites** — the same shape
as the `{ value: null }` divergence, one field along.

`contactMoveRequestSchema` now lives in `src/lib/caring-contacts-contact-move-request.ts`, which both
the route and the DOM mirror import. It could not live in either of the obvious places: the route
reaches `server-only` and `next/headers`, which no jsdom test can load, and nothing under
`src/lib/caring-contacts/` may import anything non-relative, which rules out Zod. That file is plain
validation with one import of the sealed domain's own id-shape predicate.

**Three mutations prove it**, and T28 is the one that could not have gone red before this round:

- **T27** renames `expectedContactVersion` in the client's body — six cases red.
- **T28** removes the `action` discriminant entirely — six cases red. Under the old hand-parsing
  mirror this mutation was invisible, because nothing on that path ever looked at the field.
- **T30** turns the shared schema's `.strict()` into `.passthrough()`. Nothing exercised strictness —
  the route suite's date-change case fails on the DISCRIMINANT, not on an extra field — so that case
  was added first, and T30 reddens it.

**The other divergences, named and not fixed**, because each is a property neither suite claims:

- **Path segments are ignored by the mirror**, so `contactEndpoint()`'s `encodeURIComponent` is proved
  by neither suite. The real route holds both segments to `isAccessObjectIdShape`, and the route suite
  covers a segment that is not identifier-shaped; what is unproved is the client's escaping of one
  that is.
- **The refusal-to-status map is collapsed** to 403/422 in the mirror where the real route answers 409
  for a stale version, 404 for not-found and 423 for a service stop. The wordings are keyed off the
  refusal NAME rather than the status, so the screen is unaffected — but a client that ever branched on
  status would be tested against the wrong numbers.
- **No `Cache-Control: no-store`, no production demo-404, no access-denial audit event, no 413.** All
  four belong to the real boundary, all four are covered by the route suite or by the handler's own,
  and none is visible through the mirror.

## 2 — the two assertions that could not go red

- **The headline case's own sentence.** In "takes a second move from the same screen, and says nothing
  about anybody else", the `not.toContain("This contact changed after this screen read it")` sat BEHIND
  the record assertions: a refused second move fails the record check first and never reaches it; a
  successful one satisfies it trivially. **There was no execution in which it could fail**, and it was
  the assertion carrying the case's name. The two `outcomeText()` checks now come first, and **T20
  re-run against the reordered case reddens on the sentence itself**:
  `expected 'This contact changed after this scree…' not to contain 'This contact changed after this scree…'`.
- **The overlay walk's negative half.** `expect(SCHEDULE_MOVE_OVERLAYS).toEqual([...])` determines the
  array completely, so any further claim about its contents cannot fail — and the comment's rationale
  was wrong, not merely redundant: it said the line proved the loop above was not satisfied by every id
  in the table, which the `toEqual` had already made impossible. The assertion now makes that claim
  about the thing that can actually change:
  `expect(MUTATING_OVERLAY_IDS).not.toContain("delivery-detail")`.

## 3 — the three counts, stated as the diff rather than as counts

`git diff --name-only <task base> HEAD` is the authority for all of this, and it says:

- **Fifteen TypeScript files changed**, not thirteen. The stale row carried a figure from before
  `caring-contacts-schedule-page.dom.test.tsx` and `caring-contacts-contact-move-request.ts` existed.
  The gate rows now read fifteen, and `prettier --check`'s "every file this task changed" is run from
  that same `git diff --name-only` list rather than from a hand-kept one.
- **`schedule-view.ts`: eighteen added lines**, two functional and sixteen of comment — not the
  "seventeen and nineteen" round 3 wrote while correcting round 1's "one line". Correcting a count with
  a count is where this rule keeps failing, and the fix is the one the rule already prescribes: name
  the source rather than the number. It is
  `git diff eafe033a2 HEAD -- src/lib/caring-contacts/schedule-view.ts`, and nothing is removed.

## 4 — the two observations, both acted on

- **The reseed leaves `outcome` alone deliberately, and now says so at the site.** The commonest render
  arriving there is the one this control asked for — `router.refresh()` after its own successful move —
  and clearing the statement then would wipe a coordinator's confirmation at the exact moment the row
  caught up with it. **The residual is recorded in the code, not only here**: after a successful move,
  an EXTERNAL move plus a refresh leaves "Recorded on the plan: this contact now sends at 11:30 AWST"
  standing beside a field and a row both reading the newer time. Same family as the defect round 3
  fixed, narrower trigger, and at least in the past tense — it says what this screen recorded, which
  stays true.
- **"Check again" no longer clears a version guard, and the comment is true again.** `recheckAtCommit`
  covers connectivity and the acting role; **only a server render carries a version**, so the button
  could remove the refusal while the condition still stood and the next confirm would refuse
  identically. Nothing was ever written either way, so it was an affordance defect — but the file's own
  sentence claimed a guard clears ONLY if the recheck passes, and a comment left false is a comment
  that stops being read. **The behaviour changed rather than the comment**: a version guard survives
  "Check again", and the statement names reloading the day as the thing that clears it. T29 reddens it.

## 5 — the T25 nit, fixed where it was wrong

The test's own comment credited "the null-prototype record plus `Object.hasOwn`" for refusing an
inherited key. **T25 showed the first half is inert**: `Object.hasOwn({}, "constructor")` is false
either way, so removing `Object.create(null)` leaves every assertion green. The comment now says
`Object.hasOwn` is what stops it, on its own, and that the null prototype stays as belt-and-braces for
a lookup somebody later rewrites as `map[key] ?? fallback` — which is a different claim, and not one
this case proves.

## The mutation ledger, round 4

Same driver, same four guards, same narrowed selection; `CTRL_NOOP` was re-run after the driver gained
the new allowlisted file and threw on its own line. `git status --porcelain` empty before and after
every row.

| #       | Selection | Mutation                                                         | Predicted                                                           | Result | The line it printed                                                                                                                       |
| ------- | --------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| T27     | move UI   | the client renames a field the route's strict schema requires    | every case that reaches a write is refused as a bad request         | RED    | `expected 'The service refused the move and name…' to contain '11:30 AWST'` — `6 failed / 11 passed (17)`                                 |
| T28     | move UI   | the client omits the `action` discriminant the mirror never read | the same six — **and invisible before this round**                  | RED    | `expected 'The service refused the move and name…' to contain '11:30 AWST'` — `6 failed / 11 passed (17)`                                 |
| T29     | move UI   | "Check again" clears a version guard it cannot recheck           | the new guard case loses its statement                              | RED    | `expected '' to contain 'checking again cannot tell it'` — `1 failed / 16 passed (17)`                                                    |
| T30     | route     | the shared schema stops being strict                             | the extra-field case is accepted                                    | RED    | `expected 200 to be 400` — `1 failed / 6 passed (7)`                                                                                      |
| T20 (2) | move UI   | re-run of round 3's row against the REORDERED headline case      | it now reddens on the case's own sentence rather than on the record | RED    | `expected 'This contact changed after this scree…' not to contain 'This contact changed after this scree…'` — `1 failed / 16 passed (17)` |

Every prediction was exact this round, including T28's six.

## Gates, after the final edit of this round

| Gate                                                           | Evidence                                                   |
| -------------------------------------------------------------- | ---------------------------------------------------------- |
| `npm run test:cc-guards` (`GATE_RECEIPTS=refresh`), final tree | `Test Files  27 passed (27)` and `Tests  532 passed (532)` |
| The 5 round-4 mutation selections                              | every row above carries its own `N failed / N passed` line |
| `npx tsc --noEmit`, final tree                                 | exit 0, zero `error TS` lines emitted                      |
| `npx eslint --no-cache`, every changed TypeScript file         | `files linted: 15`, `errorCount: 0 warningCount: 0` (JSON) |
| `prettier --check`, every file this task changed               | `All matched files use Prettier code style!`               |

**`532` is unchanged from round 3 and that is correct**: this round added assertions inside existing
cases rather than new cases — the strictness check joined the route suite's bad-request case, and the
"Check again" check joined the unconfirmed-version case. Both of those files were run and pasted before
the wide set.

## Concerns from round 4

1. **The mirror is closer to the route but is still a mirror.** Body shape and the success envelope are
   now pinned; status codes, cache headers, the demo lock and the access-denial event are not, and are
   listed above so the next reader does not have to re-derive which. A shared response type would close
   the envelope half properly and is a contract change.
2. **`src/lib/caring-contacts-contact-move-request.ts` is a new file at a level with one neighbour**
   (`caring-contacts-routes.ts`). If a later task adds a second route schema, that is the moment to
   make it a directory rather than accumulating siblings.
3. **The residual in item 4 is unfixed by design and is a real, if narrow, divergence.** An external
   move plus a refresh leaves this screen's own past-tense confirmation beside a newer time. Clearing
   `outcome` on every reseed would remove it and cost the confirmation of one's own move; a fix keeping
   both would need to know WHICH render it is looking at, which the props do not say.

---

# Round 5 — one item, and the substantive fix was small

The re-review found a true thing round 4 did not: `caring-contacts-contact-move-request.ts` opened by
saying it exists so "the client that BUILDS a body and the boundary that REFUSES one" share one
definition — and the client did no such thing. `contact-time-adjustment.tsx` hand-built the fetch body
as a plain object literal and imported nothing from that module. Only the route and the **test double**
imported it. **The net was real and it ran through a mock**, and the comment described a stronger
guarantee than the code provided.

That is the shape this phase keeps paying for — a comment that outlives the thing it described — and
this report has now recorded it three times: Task 13's containment sentence, round 4's null-prototype
credit, and this.

## Commits

| SHA          | What                                                                       |
| ------------ | -------------------------------------------------------------------------- |
| `40cf87651`  | The client's body typed from the schema, and the module comment made true. |
| _(this one)_ | This round.                                                                |

Every SHA in all five rounds was re-checked with `git cat-file -e <sha>^{commit}` after the last commit
of this round.

## The substantive fix, taken because it was small

Two lines: a **type-only** import of `ContactMoveRequestBody` (`z.infer` of the schema) and an
annotation on the body the client builds. It drags in nothing — the schema module reaches Zod and the
sealed domain's `isAccessObjectIdShape`, not `server-only`, and a type-only import erases at build
time, so the client bundle is unchanged. The sealed domain is untouched, so nothing there has to
import Zod.

This is Ruling [130]'s standard one layer out: **wrong wiring should fail where it can be made to
fail, and that is the compiler.** A renamed field is now a compile error at the call site; an omitted
`action` is a missing-property error; an extra field is refused by excess-property checking rather
than by a round trip and a 400.

The module's comment now names all three callers exactly rather than claiming two, and says which two
are the guarantee and which one is the thing that stops a test double drifting from what it stands in
for.

## The proof

**T31 — rename `expectedContactVersion` in the shared schema, gate `tsc`.** RED, and the line that
matters is the second one, because it is the CLIENT:

```
src/components/caring-contacts/workspace/contact-time-adjustment.tsx(383,7): error TS2561: Object literal may only specify known properties, but 'expectedContactVersion' does not exist in type '{ action: "moveWithinDay"; toHour: number; toMinute: number; expectedVersion: number; idempotencyKey: string; }'. Did you mean to write 'expectedVersion'?
```

The same run also names the route (`route.ts(83,40): error TS2551`) and the mirror
(`…dom.test.tsx(184,38): error TS2551`), so all three callers are bound to the one definition — which
is what the comment says, now demonstrably.

**T31G — the same rename, run against the suite instead of `tsc`.** I labelled this an
over-sensitivity control and predicted GREEN. **It came back RED**, `6 failed / 11 passed (17)`, with
`expected 'The service refused the move and name…' to contain '11:30 AWST'`. The reason is the fix
itself: the mirror validates with the same schema, so a client body that no longer matches is refused
at runtime as well as at compile time. It is a second independent proof rather than a control.

**That is the second time this task I have mislabelled a schema-level change as type-only** — T19G was
the first. The pattern is worth naming rather than apologising for twice: **a value that a type is
derived FROM is still a value somebody reads at runtime.** `z.infer` looks like a type-level
relationship and the object it is inferred from is executable.

## The mutation ledger, round 5

Same driver, same four guards, same narrowed selection. `CTRL_ABSENT` was re-run after the driver
gained these rows and threw on its own line. `git status --porcelain` empty before and after each row.

| #    | Selection | Mutation                                             | Predicted                                          | Result | The line it printed                                                                                                                                         |
| ---- | --------- | ---------------------------------------------------- | -------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T31  | `tsc`     | the shared schema renames a field                    | the CLIENT stops compiling, not merely a test      | RED    | `contact-time-adjustment.tsx(383,7): error TS2561: Object literal may only specify known properties, but 'expectedContactVersion' does not exist in type …` |
| T31G | move UI   | the same rename, against the suite rather than `tsc` | GREEN — **wrong, and wrong the same way T19G was** | RED    | `expected 'The service refused the move and name…' to contain '11:30 AWST'` — `6 failed / 11 passed (17)`                                                   |

## Gates, after the final edit of this round

| Gate                                                           | Evidence                                                   |
| -------------------------------------------------------------- | ---------------------------------------------------------- |
| `npm run test:cc-guards` (`GATE_RECEIPTS=refresh`), final tree | `Test Files  27 passed (27)` and `Tests  532 passed (532)` |
| The 2 round-5 mutation selections                              | both rows above carry their own line                       |
| `npx tsc --noEmit`, final tree                                 | exit 0, zero `error TS` lines emitted                      |
| `npx eslint --no-cache`, every changed TypeScript file         | `files linted: 15`, `errorCount: 0 warningCount: 0` (JSON) |
| `prettier --check`, every file this task changed               | `All matched files use Prettier code style!`               |

**`532` is unchanged and correct**: this round added no test. The new guarantee is carried by the
typechecker, and the assertion that would otherwise have carried it is the `tsc` run itself — which is
why T31's evidence is a compiler diagnostic rather than an `N failed` line. The file list for lint and
Prettier comes from `git diff --name-only`, not from a hand-kept list.

No lease refusal was recorded in this round; every narrowed run and the wide run took their lease
first time.

## Concerns from round 5

1. **`ContactMoveRequestBody` binds the SHAPE, not the values.** A client sending a valid-shaped body
   with the wrong contact's version still compiles; that is what the store's `stale-version` refusal
   and its own case exist for. Worth saying because a compile-time guard invites the belief that the
   request is now fully checked, and it is not.
2. **Only this one route has a shared body schema.** The other caring-contacts write routes still
   declare theirs inline, so the same divergence is available to any client that builds one of those
   bodies by hand. Generalising it is a change across several routes and is not this task's.
3. **The `z.infer` relationship is invisible at the call site without the annotation.** Deleting the
   annotation from the body literal would compile, and nothing but the mirror would notice — T31G is
   what would catch it today. A lint rule could bind it properly; that is a repo-wide change.
