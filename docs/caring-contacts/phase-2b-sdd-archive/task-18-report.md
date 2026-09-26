# Task 18 — the Team screen

**Status: complete.** Branch `claude/browser-test-gate-handoff-d5c1db`, nothing pushed, no PR, no
subagents. The untracked `1/` directory at the worktree root was left alone.

| Commit      | What                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------- |
| `2cb10a98c` | the screen, the page, both suites, the `href`, and the docs and gates that go with a new route |
| `a27dffd5f` | split the nothing-unclaimed case so each of its claims can fail                                |
| `9b9e68700` | replace a control that was checking for a digit, not a count                                   |
| `3b0e0a193` | run the roster's privacy absence against a store that holds patients                           |
| `be912062b` | say which assertion no mutation of this task can redden                                        |

Every SHA above was checked to exist with `git cat-file -e <sha>^{commit}` after the last amend.

---

## What was built

`/caring-contacts/team`, a Server Component, reading through `auditedRead` exactly as the other
workspace screens do — no HTTP hop from a render, and the same access identity the API route already
records: `{ search, teamWorkload, "all" }`, plus the service state as `{ administrative,
serviceState, "service" }`.

- **`src/components/caring-contacts/workspace/team-roster.tsx`** — the screen body. A Server
  Component that takes every figure as a prop and adds no client payload. It renders the approved
  design and nothing more (Ruling [72]): a desktop ownership table, a compact roster, the unclaimed
  indicator, and the "Reassign work" control. No capacity chart, no coverage calendar, no per-member
  detail page.
- **`src/app/caring-contacts/team/page.tsx`** — resolves who is asking and when "now" is, joins
  `listPlans` to each plan's `getAssignment`, hands the pair to `buildTeamWorkload`, and decides two
  capabilities from the actor. It derives nothing the domain owns.
- **`shell.tsx`** — the `Team` More-panel entry gains its `href` in the same change as its page
  (Ruling 89). Team is in neither the rail nor the phone bar, so the More panel is its **only**
  inbound link at every width, not merely below 768px.

The table's five columns are **Coordinator, Plans sending, Plans held, Coverage, Contacts needing
review**. The design's five were Team member, Role, Active plans, Unclaimed work, Escalation; three
of those have no source and are covered below.

## Spec §4.2 — this screen never ranks a clinician

The read holds that as a constraint on its own shape. A shape with no ranking in it can still be
**rendered** as one, so the screen holds it too:

- rows are drawn in the order the read gave them — ascending actor id and nothing else — and the
  screen **says on itself** that this is identifier order and not a placing, so a reader is not left
  to infer what an order means. Proven by `M1` and `M1b`, which sort the table by work and reverse
  the roster: the case's fixture has work order exactly reversed against identifier order, so neither
  could pass by coincidence.
- nothing is divided by anything. There is no total, share, percentile or placing on this screen and
  none is computed. `M3`, which adds "busiest first" to one sentence, is what pins the vocabulary.
- nothing is coloured as a grade. The one place any emphasis appears is the escalation, which is a
  statement about work nobody has claimed, and it carries its words and its icon rather than a tint.

## Spec §4.4 — the escalation states why, and what would change it

The escalation is the one place this screen says the system acted on its own, so that is where the
pair has to be. It renders as an `AutomatedState`: the state named, the reason — the threshold, how
many have reached it, and how long the oldest has waited — and what ends it, all inside one
`role="group"` a screen reader enters together, with the reason never in a `title`.

The other two unclaimed states are **not** automated acts and are stated plainly rather than dressed
as automation. Both still carry the threshold and the remedy, because a reader looking at unclaimed
work needs both whichever side of the line it is on — including on a quiet morning, where an
escalation rule you can only discover by tripping it is a rule you cannot plan around.

`M7` (the remedy), `M8` (the threshold) and `M9` (calling work inside the threshold escalated) are
the three mutations that hold this.

## Privacy

`getEpisode` and `listPatientNames` are never called, and no patient, plan or contact identifier
reaches the screen — asserted against the **real demo seed**, which demonstrably holds all three, and
with the plan count asserted non-zero first so the absence is about the page's narrowing rather than
about an empty fixture. The route takes no parameters at all, so nothing about a patient can travel
in a query string. `M26` is the mutation that reads an episode per plan; it reddens with
`expected "getEpisode" to not be called at all, but actually been called 3 times`.

---

## Findings — things the approved design needs and the tree does not have

Reported rather than designed, per the brief. All three were measured by Task 17 against the tree;
this task confirmed each against the shape it actually renders and states the absence on the screen.

**1. There is no staff display name, so the identifier travels — and the screen says so.** The stores
hold an `ActorId` and nothing else about a person. The identifier is rendered **as** an identifier:
monospaced, verbatim, never resolved into words. Printing a bare code and leaving a clinician to
guess would have been the other half of the defect, so the screen states, in plain words, that this
system holds no name for a member of staff and no role for anyone but you, and that each coordinator
appears as the identifier their work is filed under. `M4` removes that sentence and the suite goes
red.

**2. There is no Role column,** because nothing returns the roles an `ActorId` holds. `M5` adds one
and the suite goes red. This also settles the raw-role-identifier rule the easy way rather than the
clever one: `demo-clinicalProgrammeLead` is reachable as an actor id, and it is rendered as an
identifier, so the interface-vocabulary scan's known word-boundary hole is not reached at all. A case
pins that the string appears verbatim **and** that the screen never renders "clinical programme lead".

**3. A per-member unclaimed column cannot exist,** and the design's unclaimed row is rendered in
full — once, above both renderings, rather than twice inside them. Its figures are not owner-shaped:
`Plans sending` and `Plans held` have no meaning for work with no owner, and forcing them into those
columns would draw the same false statement at two widths. What it carries is everything the read
holds: the count, how many have passed the threshold, the age of the oldest, the threshold itself,
what clears it, and its own exception backlog — so a reviewable contact on an unowned plan cannot go
uncounted for want of an owner to file it under. `M6` puts an unclaimed figure into a roster entry
and the suite goes red.

**4. Both ages are rendered as what they measure.** "145 minutes since the patient was discharged"
and "45 minutes since its scheduled send", never a queue age or a waiting time; and the screen states
that both are measured from the earliest instant the work could have been waiting, so the true wait
is never longer than the figure shown. `M11` and `M13` rename them and both go red; `M12b` drops the
upper-bound clause and it goes red.

**SUPERSEDED IN PART, 2026-08-28.** The upper-bound clause was a false assurance rendered to a
clinician: the anchor is the plan wizard's midday convention rather than an observed instant, so the
figure bounds the true wait in neither direction. The screen no longer makes the claim, the age is
worded "145 minutes past the discharge recorded on its plan", and the case that pinned the false
sentence now pins the honest one. The naming of the two ages stands. See `group-4-review.md`
MAJOR-1 and `group-4-round-1-report.md`.

**5. The threshold is inclusive**, and the screen states it as "escalates at 60 minutes" / "escalates
once it has waited 60 minutes" rather than "after", which would not determine the boundary. The
inclusive behaviour itself is the domain's and is pinned there.

**6. The "Reassign work" control is a link to the caseload.** See the next section.

**7. Nothing is derived from a demo actor id.** Covered in finding 2.

**8. A fourth thing the design shows and this build cannot produce, offered as a finding rather than
built:** the mockup's roster draws an avatar with a person's initials. Initials are a projection of a
display name, which is the system finding 1 names, so there is no avatar. This is the same absence
as finding 1 and not a new one; it is written down because the mockup shows it in two places and a
later reader will look for it.

---

## The "Reassign work" control, and why it is a link

**It is a `<Link>` to the caseload, with a visible reason the control points at with
`aria-describedby`.** The brief offered two honest shapes and this is the first of them.

The reassignment overlay is **already built and already wired**, on `plan-actions.tsx`, reached from
a patient's record — and `tests/caring-contacts-overlay-trigger-inventory.test.ts` records it there
as the only module that raises it. A reassignment names one plan, one destination and one reason.
This roster deliberately carries no plan id (Task 17's finding 8: a roster that carried them would be
a caseload read wearing a roster's name), so there is no plan for a control here to move, and
inventing one is not available.

That leaves the two shapes the brief names, and they are not equally true. A "coming soon"
`UnavailableDestination` would state that the system cannot reassign work — **which is false**; the
product has the action, and Ruling 93's point cuts the same way in reverse: a control that misstates
what exists sends the reader to look for something that is not the problem. The link states the true
thing: reassignment is done on one plan at a time, from that patient's record, and this opens the
caseload where you choose the plan to move.

Three things make it a control rather than a decoration:

- it is gated on the domain's own `reassignPlan` action, asked through
  `canPerformCaringContactAction` with the action the store itself checks — not a broader stand-in
  and not a list of roles written on the screen. `reassignPlan` is a team lead's action and not a
  coordinator's, so the two roles genuinely see different screens, and both directions are asserted.
  `M25` assumes the capability and the suite goes red.
- where the role may not move a plan, **no control is rendered at all** and the screen says so in
  words. A dead button would be the wrong shape here: `UnavailableDestination` says "not built yet",
  which is not what is true, and the alternative — an `aria-disabled` control with an inert handler
  — needs a click handler and would make this screen a Client Component, which Ruling 13 and the
  service-state allowlist both push back on for a refusal a sentence states just as well.
- it adds **no second trigger** for the `reassignment` overlay. The trigger inventory records that
  row as raised by `plan-actions.tsx` and nowhere else, and that record is still true.

**Residual, stated rather than resolved:** a clinician on this screen who can see that
`ACTOR-BLAKE` is carrying eleven plans still has to find the right plan by hand in the caseload,
because nothing on this roster can name one. Closing that means either a roster read that carries
plan ids — which is the caseload — or a caseload filter by owner, which is a new surface. Both are
the owner's call.

---

## Mutation ledger

Every attempt is itemised, greens included, with **no aggregate total**. Each row ran against commit
`3b0e0a193`, on a tree asserted clean by `git diff --quiet` immediately before and after the row. The
unmutated baseline on that same tree, with `GATE_RECEIPTS=refresh`, was `Test Files 4 passed (4)` /
`Tests 63 passed (63)`, and it was re-established after the round.

Presence was proven by byte equality against a computed post-image (`expected =
before.replace(find, replace)`, asserted `!== before`, written, re-read from disk, compared byte for
byte), with an occurrence guard requiring the anchor exactly once. All three driver guards were
proven to fire on their own lines before the round began:

- `CTRL_NOOP` (replacement equal to its anchor) → `post-image is byte-identical to the original`
- `CTRL_ABSENT` (anchor not in the file) → `anchor occurs 0 times … expected exactly 1`
- `CTRL_FOREIGN` (a row naming another task's file) → `refused before any file I/O — … is not on the allowlist`

The allowlist and the id-uniqueness check both run **before** any file read. The driver lives at a
scratchpad path carrying this worktree's name, and every line it prints carries that name too.

Selection: `R` = `tests/caring-contacts-team-roster.dom.test.tsx`, `P` =
`tests/caring-contacts-team-page.dom.test.tsx`, `S+RR` =
`tests/caring-contacts-workspace-shell.dom.test.tsx` + `tests/route-reachability.test.ts`.

| Id        | Mutation                                                      | Sel  | Predicted                                                            | Observed                                                                                                          | Match             |
| --------- | ------------------------------------------------------------- | ---- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------- |
| `M1`      | the table sorts rows by active plans, descending              | R    | 1 failed; the row order deep-equal fires                             | 1 failed; `expected [ 'ACTOR-CASS', 'ACTOR-BLAKE', …(1) ] to deeply equal [ 'ACTOR-AVA', …(1) ]`                  | yes               |
| `M1b`     | the compact roster reverses its own order                     | R    | 1 failed; the roster order deep-equal fires                          | 1 failed; `expected [ 'ACTOR-BLAKE', 'ACTOR-AVA' ] to deeply equal [ 'ACTOR-AVA', 'ACTOR-BLAKE' ]`                | yes               |
| `M2`      | the screen stops saying what its order means                  | R    | 1 failed; `to contain 'identifier order'`                            | 1 failed; exactly that                                                                                            | yes               |
| `M3`      | "busiest first" added to the intro                            | R    | 1 failed; the ranking-vocabulary loop fires on `busiest`             | 1 failed; `the screen uses the word "busiest": … not to contain 'busiest'`                                        | yes               |
| `M4`      | the no-staff-name sentence removed                            | R    | 1 failed; `to contain 'no name for a member of staff'`               | 1 failed; exactly that                                                                                            | yes               |
| `M5`      | a Role column added                                           | R    | 1 failed; the header list includes `role`                            | 1 failed; `expected [ 'coordinator', 'role', …(4) ] to not include 'role'`                                        | yes               |
| `M6`      | a roster entry labelled "Unclaimed work"                      | R    | 1 failed; the per-entry `not.toContain('unclaim')` fires             | 1 failed; `a roster entry carries an unclaimed figure: … not to contain 'unclaim'`                                | yes               |
| `M7`      | the escalation stops naming what clears it                    | R    | 1 failed; `to contain 'a coordinator claiming the plan'`             | 1 failed; exactly that                                                                                            | yes               |
| `M8`      | the escalation stops naming the threshold                     | R    | 1 failed; `toHaveTextContent` on `60 minutes`                        | 1 failed; `Expected element to have text content: 60 minutes`                                                     | yes               |
| `M9`      | work inside the threshold is called escalated                 | R    | 1 failed; the escalated group is not null                            | 1 failed; `expected <div role="group" …(2)>…(3)</div> to be null`                                                 | yes               |
| `M10`     | the nothing-unclaimed branch renders the other statement      | R    | 2 failed; the coordinator sentence, and the age it then prints       | 2 failed; `to contain 'every plan that is running has a coor…'` first                                             | yes               |
| `M11`     | the unclaimed age stops saying what it measures               | R    | 2 failed; the age case and the two-names case                        | 2 failed; `Expected element to have text content: 145 minutes since the patient was discharged`                   | yes               |
| `M12`     | the upper-bound sentence's HEAD reworded                      | R    | RED — **wrong**                                                      | `Tests 28 passed (28)` — GREEN                                                                                    | **no**            |
| `M12b`    | the upper-bound CLAUSE the assertion reads, dropped           | R    | 1 failed; `to contain 'never longer than the figure shown'`          | 1 failed; exactly that                                                                                            | yes               |
| `M13`     | the backlog age renamed to a waiting time                     | R    | 2 failed; the backlog case and the two-names case                    | 2 failed; `Expected element to have text content: 45 minutes since its scheduled send`                            | yes               |
| `M14`     | an empty backlog renders as a count of zero                   | R    | 1 failed; `toHaveTextContent` on `None`                              | 1 failed; `Expected element to have text content: None`                                                           | yes               |
| `M15`     | an added unused binding in `HeldPlans`                        | R    | **GREEN** — changes no value any assertion reads                     | `Tests 28 passed (28)`                                                                                            | yes               |
| `M16`     | a hold worded as something the domain does not call it        | R    | 1 failed; `toHaveTextContent` on `Plan paused`                       | 1 failed; `Expected element to have text content: Plan paused`                                                    | yes               |
| `M17`     | the two coverage directions read from the wrong field         | R    | 1 failed; the covered-by line reads 0                                | 1 failed; `Expected element to have text content: 2 plans are being covered by someone else`                      | yes               |
| `M18`     | the control points at the Schedule instead of the caseload    | R    | 1 failed; the `href` attribute assertion                             | 1 failed; `toHaveAttribute("href", "/caring-contacts/patients")`                                                  | yes               |
| `M19`     | the control stops pointing at its stated reason               | R    | 1 failed; `the control states no reason: expected null to be truthy` | 1 failed; exactly that                                                                                            | yes               |
| `M20`     | the tap target drops to the 44px step                         | R    | 1 failed; `to contain 'min-h-tap'`                                   | 1 failed; `expected 'inline-flex min-h-11 w-fit min-w-0 it…' to contain 'min-h-tap'`                              | yes               |
| `M21`     | the control is offered to a role that may not move a plan     | R    | 1 failed; the control is not null                                    | 1 failed; `expected <a data-internal-link="true" …(4)>…(2)</a> to be null`                                        | yes               |
| `M22`     | a role that may not see plans is told nobody is carrying work | R    | 1 failed; the not-permitted group is not found                       | 1 failed; `Unable to find an accessible element with the role "group" and name /not visible in this role/i`       | yes               |
| `M23`     | the roster read recorded under the caseload's object type     | P    | 2 failed — **undercounted**                                          | 3 failed; the third is the failed-read case, which asserts the same object type                                   | msg yes, count no |
| `M24`     | a broken list contract laundered into an empty roster         | P    | 1 failed; the rejection assertion                                    | 1 failed; `promise resolved "{ …(10) }" instead of rejecting`                                                     | yes               |
| `M25`     | the reassign capability assumed rather than asked             | P    | 1 failed; the control is not null                                    | 1 failed; `expected <a data-internal-link="true" …(4)>…(2)</a> to be null`                                        | yes               |
| `M26`     | the render reads a patient record per plan                    | P    | 1 failed; the `getEpisode` spy                                       | 1 failed; `expected "getEpisode" to not be called at all, but actually been called 3 times`                       | yes               |
| `M26-old` | the same mutation, against the PRE-FIX empty-store case       | P    | **GREEN** — the loop never runs over an empty store                  | `Test Files 1 passed (1)` / `Tests 11 passed (11)`                                                                | yes               |
| `M27`     | the Team destination loses its `href`                         | S+RR | 5 failed across 2 files; the orphan-route gate names the route       | 5 failed; `Orphan page route(s) … /caring-contacts/team: expected [ '/caring-contacts/team' ] to deeply equal []` | yes               |
| `M28`     | no coverage renders as an empty cell rather than as none      | R    | 1 failed; `toHaveTextContent` on `None`                              | 1 failed; `Expected element to have text content: None`                                                           | yes               |
| `M29`     | the internal link stops declaring itself one                  | R    | 1 failed — **undercounted**                                          | 2 failed; the link case asserts the attribute too                                                                 | msg yes, count no |
| `M30`     | the service-state read recorded under another object type     | P    | 1 failed; the second `toContainEqual` in the identity case           | 1 failed; `expected [ { …(7) }, { …(7) } ] to deep equally contain ObjectContaining{…}`                           | yes               |

### The three rows worth reading rather than counting

**`M12` was predicted RED and came back GREEN, and the miss is mine rather than the test's.** It
reworded the HEAD of the upper-bound sentence while the assertion reads its TAIL — so it changed no
value any assertion reads, which is the first check the standing discipline asks for and the one I
did not make. `M12b` mutates the same claim where the assertion actually looks, and it is red. The
assertion was never inert; the mutation was. Reporting the miss is worth more than quietly
relabelling it.

**`M23` and `M29` were undercounted, not mis-predicted.** Both produced exactly the message shape
predicted, on one more case than I expected, because a second case asserts the same property from a
different angle — the failed-read case also names `teamWorkload`, and the caseload-link case also
asserts `data-internal-link`. The under-count is recorded rather than smoothed over: a prediction
that names the message and misses the count is a partial prediction.

**`M26` and `M26-old` are a pair and only the pair proves anything.** The privacy absence originally
ran over an EMPTY store, where the render's only per-plan work never executes — so "getEpisode was
not called" was satisfied by a page that would call it once per plan. `M26-old` restores that case
verbatim, applies the mutation, and comes back **green**, which is the measurement. The case now runs
against the demo seed and `M26` reddens it.

### Two assertions no mutation of this task's files can redden, said plainly

- **The `title`-attribute line in the escalation case.** The group is `AutomatedState`'s own element
  and this screen renders no attribute inside it, so only an edit to `automated-state.tsx` — which
  this task does not own and which `tests/caring-contacts-explained-automation.dom.test.tsx` already
  guards — could put a `title` there. It is kept as a statement, and the test now says so in place.
- **"renders no patient, plan or contact identifier".** `TeamWorkloadView` carries no such field, so
  this is a pin on the SHAPE the screen is handed rather than on a narrowing the screen performs, and
  the case says so in its own comment. The narrowing that IS performed is proven at the page, against
  the real seed, by `M26` and by the id-absence assertions with their non-zero-plan control.

---

## Two defects this round found in my own tests, before any mutation ran

Both were found by **re-establishing the unmutated baseline on the tree being mutated**, which is the
only thing that could have found either.

1. **A control that was checking for a digit, not a count** (`9b9e68700`). The demo-population case
   asserted the unclaimed block contained `String(plans.length)`. The seed leaves one plan ended and
   `buildTeamWorkload` drops ended plans before any measure, so the number could never match — and it
   passed on its first run anyway, because the wall-clock age rendered in the same block happened to
   contain the digit it was looking for. It is now the escalated group itself, which an empty store
   would not render.
2. **A privacy absence over a store with no patients** (`3b0e0a193`), described above.

A third was found by `tsc` rather than by a run: the same case asserted
`not.toContain(record.plan.patientId)`, and `Plan` has no `patientId` — so the assertion was
comparing against `undefined` and could not fail. `PlanRecord.patientId` is the real field.

---

## Gates

| Gate                                                                                | Result                                                                                           |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm run test:cc-guards` (`GATE_RECEIPTS=refresh`, final tree)                      | see the line pasted in the return message                                                        |
| `npm run test:e2e -- tests/ui-caring-contacts-workspace.spec.ts --project=chromium` | `126 passed (3.1m)`, on the second attempt; the nine `caring-contacts team` tests ran as 118-126 |
| `npx tsc -p tsconfig.json --noEmit` (read from tsc, never through a pipe)           | exit 0, no diagnostics — re-run after the last edit                                              |
| `npx eslint <the changed files>`, `node_modules/.cache/eslint` removed first        | exit 0                                                                                           |
| `npx prettier --check` over every changed file                                      | `All matched files use Prettier code style!`                                                     |
| the gate-absent suites bearing on what this task touched                            | `Test Files 8 passed (8)` / `Tests 330 passed (330)`                                             |

Not run, and deliberately: `npm run test`, `npm run build`, `npm run verify:ui`, and anything
provider-backed. Those are the controller's.

**The browser gate's first attempt did not run.** Its isolated production build crashed with Windows
status `3221226505` before any test started, and the wrapper's own line — `Playwright production
build failed` — is the evidence, not the exit code, which the pipeline reported as `1` while the
harness printed `[exited with code 0]`. That is the masked-exit trap this programme's ledger already
names, arriving in the shape it warns about. The gate was re-run; the passing line is in the return
message. `PLAYWRIGHT_KEEP_BUILD_ROOT` was not used at any point.

**Gate drift, measured rather than assumed.** `test:cc-guards` now names forty-one paths; sixty-five
caring-contacts suites exist. Of the twenty-seven absent, eight bear on modules this task touches or
depends on — `empty-state`, `permissions`, `page-access-audit`, `api-handler`, `access-audit`,
`assignment`, `repository`, `session` — and they were run narrowed. The remaining nineteen cover
message copy and policy, the Postgres repository, migrations, referrals, hospital events, training,
simulation, notification preferences, the server pool and config, width state, write serialisation,
fingerprinting, service state, contact rescheduling, the model, and audit — none of which this diff
reaches. Following the Ruling [139] MAJOR-2 practice, the diff is recorded here rather than the
hand-maintained gate line being rewritten mid-branch; the two suites this task adds ARE named on it.

`docs/scripts-index.md` recorded 280 npm scripts where 281 existed, on the trunk, before this task.
The pre-commit generator corrected it while running for this change. Nothing here added a script.

---

## Concerns, in the order I would want them looked at

1. **The `workload` More-panel entry now overlaps the Team screen.** `shell.tsx` still declares an
   unbuilt `workload` destination whose stated reason is "Work waiting across the team" — which is
   part of what Team now shows. Spec §4.2's row is called "Workload and queue monitor", and Ruling
   [72] scoped Group 4 to the roster, so the two are not the same screen; but a clinician reading the
   More panel today sees two destinations describing one thing. Left alone rather than edited,
   because deciding what `workload` is for after this is the owner's call, not mine.
2. **The roster shows who is carrying work, not who is on the team.** A coordinator carrying nothing
   today has no row, because nobody can be discovered — there is no staff directory to enumerate. The
   screen states this, but it is a real limitation of a workload monitor: a team member who has
   claimed nothing all week is invisible here, and that is exactly the case a workload monitor exists
   to surface. Closing it needs the staff directory of finding 1.
3. **The escalation's age is an upper bound and the screen is honest about it, but the honesty has a
   cost.** "145 minutes since the patient was discharged" is a longer sentence than "waiting 145
   minutes", and on a busy screen a reader may take the shorter meaning anyway. The wording is the
   most I can do without the repository-contract change Task 17 asked for.
4. **The compact roster and the desktop table are two copies of the same figures in one document.**
   They are both fed from one `view`, so they cannot disagree — but every figure appears twice in the
   DOM, which is why every test scopes itself to one of the two. A future reader adding an assertion
   without scoping it will get an ambiguous-match error rather than a wrong answer, which is the safe
   direction, but it is worth knowing before you write the assertion.
5. **The browser gate proves the empty branch only.** Nothing in that isolated server can claim a
   plan, so the populated table, the held-plan and coverage cells, the exception backlog and the
   escalation `AutomatedState` are proved offline against real views and never in a browser. That is
   the same limit the Templates and Reports blocks carry, and it is stated in the spec file beside
   the route constant rather than left for a reader to discover.
