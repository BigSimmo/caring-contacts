# Task 10 report — plan and contact detail

**Worktree:** `D:\Worktrees\Database\cc-plan-detail` · **Branch:** `claude/caring-contacts-plan-detail`
**Not pushed. No pull request. No subagents dispatched.**

---

## What was built, and where

Nothing new was routed. Everything below is the **patient overview deepened**, plus one new
overlay-trigger module and one wording map in the sealed domain.

| File                                                                              | Change                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/caring-contacts/workspace/patient-overview.tsx`                   | The plan detail itself: the attestation card, the plan-not-running note, the delivery-detail control on each row that has a transport report, and the removal of the `UnavailableDestination` that used to point at "the plan detail". |
| `src/components/caring-contacts/workspace/overlays/exit-only-overlay-trigger.tsx` | **New.** The trigger for the overlays the frozen table marks `mutatesState: false`, whose decision control is an exit rather than a confirmation, and the module where the Ruling [87] tension is resolved.                            |
| `src/lib/caring-contacts/assurances.ts`                                           | `PLAN_ASSURANCE_WORDING` + `planAssuranceWording()` — the plain words each attestation is read back in, beside the closed vocabulary they name.                                                                                        |
| `tests/caring-contacts-patient-overview.dom.test.tsx`                             | New cases across four blocks, listed under Verification.                                                                                                                                                                               |
| `tests/caring-contacts-explained-automation.dom.test.tsx`                         | One allowlist entry, with its three conditions stated.                                                                                                                                                                                 |

---

## Ruling [128] — no new page route, and the design does not disagree

Plan detail is `/caring-contacts/patients/[patientId]?plan=<planId>`, built by `patientPlanRoute()`.
Contact detail is the `delivery-detail` overlay. No route was added, and none was needed.

**I looked for the disagreement the brief warned about and did not find one.** The approved design's
plan-detail screen is `src/components/caring-contacts/mockups/product-pages.tsx`
(`caring-contact-screen-plan-detail`), and it is design scratch under a `/mockups` route that 404s in
production — not a claim that production carries a `/caring-contacts/plans/[planId]` route.
`CARING_CONTACTS_ROUTES` has no key for one; `planRoute()` and `contactRoute()` exist in
`src/lib/caring-contacts-routes.ts` as declared-but-unbuilt shapes and are still unbuilt after this
task. So there is nothing to record as a difference beyond that: **the mockup names a screen, and the
screen is this one.**

### Ruling [46] — no new `AccessedObjectType` member, decided deliberately

**Concluded: no new member is owed, and none was added.** The deepening reads nothing new. The
attestations arrive on `PlanRecord` from the `{ search, plan, "all" }` read the page already makes;
the first-contact reason arrives on `Episode` from the `{ view, episode, <planId> }` read the page
already makes for this plan. Adding a member would put a second name on the access trail for a read
that did not happen — and because the trail filters on `objectType` with no `objectId` filter, that
second name would be visible by eye and unaskable, which is Task 5b's defect pointed the other way.
The `z.enum` in `src/app/api/caring-contacts/access-trail/route.ts` is therefore untouched, and Task
12's pin has nothing to keep in sync for this change.

---

## The two stored fields that move in opposite directions

Both are now rendered by one screen, and a cleared plan shows both at once.

**The first-contact reason (Ruling [105]) is cleared.** `FirstContactReason` already distinguished
its four cases before this task — reason held, role may not read the episode, retention clearance,
plan older than the field. I did not change it. What this task adds is the **other half beside it**,
so a reader who sees the reason gone and the attestation present is told why the two differ rather
than left to guess that one was missed.

**The attestation (Ruling [122]) is preserved,** and the card says so in place: "A retention clearance
leaves these on the plan while it removes the patient's detail … Each line above holds no patient
detail, only which check was made and when, so removing it would destroy the evidence that the check
happened while keeping the plan it belongs to."

**Not a consent record.** The card says a coordinator confirmed _that the patient had agreed_, never
that the patient agreed; it says the agreement is held in the patient's hospital record and not in
this system; and a test asserts the card contains no occurrence of "consent" at all. **Name the
destination, not the act:** every mention is "recorded on the plan", and the assertion that pins it
reads the attestation **list**, not the paragraph above it, so it cannot be satisfied by prose
elsewhere on the card.

**A plan with no attestation states itself.** "This plan holds no record of those confirmations. It
was created before this plan began recording them, and nothing was written into the older plans
afterwards — a placeholder here would be a clinical record nobody made. Nobody failed to confirm
anything." It also says explicitly that a retention clearance is **not** what emptied it, because
that is the wrong conclusion nearest to hand on this screen.

---

## The defect I wrote the first test for: a plan that is not running

The brief's "stopped plan" case has two halves, and only one was already closed.

**Already closed, and left alone.** `withdrawPlan` and `recordHospitalStatusEvent` run every unsent
contact through `{ type: "cancel" }`, so a withdrawn or death-stopped plan is ten cancelled contacts;
`contactSendability` classifies them `willNotBeSent`, the summary says "none of them will be sent",
and `notSentExplanation` gives each row its own reason.

**Open on the SCREEN, and the one this screen would have reintroduced.** `pausePlan` is a plain
lifecycle transition: it moves the plan and touches no contact. So a **paused** plan's messages are
still `scheduled`, `contactSendability` correctly says `stillToSend`, and the summary sentence reads
"10 entries, and every one of them is still to be sent." That is true about the record and reads as a
promise about the future. A **draft** plan is the same shape.

**This was never a hole in the domain, and the report must not leave that impression.** Nothing would
actually have gone out: `contactStatusWrite` refuses any contact-status write on a plan that is not
`active`, so dispatch is blocked at the write whatever the list says (see the withdrawn open question
below for the exact call sites). The defect was confined to what a coordinator would **read** on this
screen — which is quite bad enough on a suicide-prevention surface, and is what the note fixes.

`planNotRunningNote` states the second fact beside the first: "The messages below are dated and still
to be sent, and this plan is paused. A paused plan is not running, so a date below is not a message
on its way." Draft gets its own wording, and the two are asserted not to collapse into one.

**Deliberately NOT fixed by re-deriving sendability on the screen.** The classification is correct and
belongs to `src/lib/caring-contacts/model.ts`; what was missing is `plan.state`, and stating it is the
screen's job. The note deliberately says what the two records hold and claims nothing about what a
dispatcher would do — which is why it needed no change once I found the dispatch gate.

**The terminal branch is guarded and defensive.** It fires only when `stillToSend > 0`, which an ended
plan never has, and it says the two records disagree rather than inventing a cause. That guard is
proved by its own test (an ended plan gets no plan-level note) rather than assumed — it would
otherwise have been an unproven check, which the standing discipline calls a hypothesis.

---

## The delivery-detail overlay, and the commit tension resolved honestly

**Where it is offered.** On each schedule row where `contactSendability(state) === "alreadySent"` —
the domain's own classification, asked rather than copied. A scheduled, suppressed, cancelled or
missed message has no transport report, so no control promises one.

**What the drawer can and cannot say — a real limit, reported rather than worked around.**
`OverlayHost` renders each row's frozen `summary` and **takes no children**. There is no slot for
per-row content, so the overlay cannot name the contact it was opened from. The per-contact fact
therefore stays on the row itself, where `CONTACT_STATE_LABELS` already labels every provider state as
a transport receipt. The trigger's visible words are generic — the drawer is — and the cadence label
follows as the control's ORIGIN, which is what tells one schedule row's control from another's for a
reader who cannot see which row it sits in.

**The tension, and how it was resolved.** `delivery-detail` is `mutatesState: false` and its decision
is "Close this detail". Two obvious answers are both wrong:

- `{ kind: "unavailable", reason }` carries scope `every-row`, so the host would `aria-disabled` the
  exit and print a refusal beside it — **the exact defect Ruling [90] fixed**, reintroduced from the
  caller's side instead of the host's.
- `{ kind: "record", record: () => {} }` written inline is the silent no-op Ruling [87] exists to
  prevent.

**The answer is neither: for an exit row, the host's own close IS the whole action.**
`WorkspaceOverlays.recordDecision` calls the commit and then calls `closeWorkspaceOverlay()`
unconditionally, so "Close this detail" is performed in full and there is genuinely nothing left for
the commit to do. That is a property of the **row**, so it is asserted against the row rather than by
a comment: `exitOnlyOverlayCommit` **throws** for any row the frozen table marks `mutatesState: true`,
and for an unknown id. That guard is what stops the module becoming the workspace's universal escape
hatch from Ruling [87], and it is under test in both directions.

**Why it is a component rather than an exported value.** A Server Component cannot pass a function
across the client boundary at all, and `record` is a function position. Constructing the commit inside
the client boundary is what lets every screen above it stay a Server Component and pass plain data (an
overlay id, a class name, children). That is also why it needed an entry in
`ALLOWED_CLIENT_COMPONENTS`, added on the three conditions Ruling [59] states.

### FINDING: `WorkspaceOverlayCommit` has no member for a non-mutating row

**I did not weaken the type, and I am reporting it rather than fixing it.** The union expresses
"records something" and "is not built yet" and has no member meaning _"this row's decision is an exit,
and the host's own close is the action."_ Every screen wiring a non-mutating row must
therefore reach for a construct like `exitOnlyOverlayCommit` or write a bare no-op — and Tasks 11 and
14 are about to wire `activation-success` and `permission-unavailable`, which are exactly those rows.
Adding a member is a change to Task 3's pinned contract and to the totality of `commitRefusalFor`, so
it is the owner's call, not a screen's.

**And the choice between the two IS pinned offline, though I first reported that it was not.** Swapping
the exit commit for `{ kind: "unavailable" }` is mutation **M25**, and it is **RED**: `commitRefusalFor`
is exported, pure and total, so `expect(commitRefusalFor(exitOnlyOverlayCommit("delivery-detail")))
.toBeNull()` decides it without a browser. My original claim here — that the difference is visible only
inside an open overlay, and so is Playwright's ground — was withdrawn in round 2; see "What the ledger
does NOT prove" for why I got it wrong and what it cost.

So the open question below is **only** whether the union should carry a member for it. The behaviour is
under test either way.

---

## Seams left for other tasks, named

- `resolve-failed-delivery` — **Task 14.** Not wired. See open question 3 about attempt records.
- `pause`, `withdrawal`, `reassignment`, `activation-success` — **Task 11.** Not wired. The paused note
  says in plain words that there is no control for resuming on this screen yet, rather than offering a
  dead one.
- `message-preview` — not wired here. The frozen `EXACT_PATIENT_VISIBLE_MESSAGE` specimen is not
  rendered on this screen at all: **no patient-visible copy was drafted, quoted, or interpolated.**
- Task 12's schedule read — not used, not waited for, not reimplemented.

---

## Open questions and limits I could not close

1. **WITHDRAWN — I was wrong, and the correction matters more than the original.** I reported that
   "if pausing is meant to stop sending, the rule for that does not currently live anywhere." **That
   rule does exist**, and I have now read it at source. My narrow observation was right —
   `listSendableContacts` filters on `contact.state === "scheduled"` and consults `plan.state`
   nowhere, in both stores — but the conclusion drawn from it was not.

   `contactStatusWrite` is the single path every contact-status write takes, and it carries a
   `requiresActivePlan` flag. `startContactDispatch` passes `true` (`in-memory-repository.ts:693`),
   so a plan that is not `active` is refused with `REPOSITORY_REFUSALS.contactDispatchRequiresActivePlan`
   — `in-memory-repository.ts:459-461` and `db/postgres-repository.ts:757-759`. A paused or draft
   plan's contacts appear in the **list** and are refused at the **write**. `listSendableContacts` also
   has exactly one production reader in the tree, `simulation.ts:293`; no screen calls it, and
   `plan-activation.ts:766` already says so in a comment.

   **The screen behaviour stands unchanged** — stating plan state beside the schedule was the right
   call and is what this task shipped. What was wrong was the invitation to go and add a gate; doing
   so would have duplicated one that already exists on the path that matters.

   **The lesson, which is the part worth keeping:** I verified the narrow claim and then reported a
   conclusion I had not verified. _Verifying a premise is not verifying the conclusion drawn from it._
   One more grep — **who calls this, and what happens after?** — would have closed it. The coordinator
   made the same error downstream of mine, which is exactly how an unverified conclusion travels.

2. **The attestation's actor is recorded on the plan and is not shown.** Actor ids in this workspace
   are `demo-<role>`, so printing one would put a raw role identifier in front of a clinician. Role
   wording lives in the sealed domain (`CARING_CONTACT_ROLE_WORDING`) and resolves from a **role**;
   nothing maps an actor id to one, and parsing the id's shape on a screen would be re-deriving a rule
   the session module owns. The card says the account is recorded and is not shown, and why. Naming the
   person needs a directory this prototype has not got.
3. **The domain holds no per-attempt record.** `Contact` is `{ id, planId, state, version }` — no
   attempt timestamps and no attempt count. So "what already happened" is the transport receipt state
   and nothing more, and the `resolve-failed-delivery` row's "all three attempts in the original window"
   has no data behind it today. Flagged for Task 14 rather than invented here.
4. **No sixth hospital-record value was found.** The five the standing discipline names are the only
   ones this screen wanted and did not have.

---

## Does this touch `tests/ui-caring-contacts-workspace.spec.ts`?

**My assessment: no, and I did not run it.**

That spec's `caring-contacts patient overview` block runs against the isolated Playwright server, whose
in-memory store **seeds no plans** — its own module note says so in as many words. Every one of its
patient-overview tests therefore exercises the **zero-plan** path and asserts on the
`No plan for this patient` empty state. None can reach `EpisodeOverview`, so none can reach the
attestation card, the not-running note, the schedule rows, or the trigger. The `UnavailableDestination`
I removed is likewise unreachable there, and nothing in the spec names it.

**The one thing worth your judgement:** that spec asserts single occupancy of the overlay content node
throughout, and this change introduces the workspace's first production `delivery-detail` trigger. It
sits on an unreachable branch of that server, so it cannot affect the assertion today — but if a plan
is ever seeded into the Playwright store, that spec becomes the surface where the exit-commit choice
(the finding above, mutation M25) would finally be provable.

---

## Verification

Gates run in this worktree. **Every summary line is pasted; none is reported from an exit code.**

### `npm run test:cc-guards` (with `GATE_RECEIPTS=refresh`, so no cached receipt could stand in)

```
 Test Files  18 passed (18)
      Tests  408 passed (408)
   Duration  105.89s
```

That run is the round-3 full-set gate on the final tree, and it is the one that catches collateral
damage the per-suite mutation runs cannot see. It took **21 attempts** to get the lease: a Playwright
run in another worktree held it for the preceding twenty minutes, and every refusal was waited out
rather than forced.

```

```

An earlier run went **red** on one file before the client-component allowlist entry was added, which
is itself evidence the gate examines this change. (Its lower test count is not that commit's doing:
`1c37c5c61` adds one array entry and no test at all. The count rose with `9bef9682f`, which added the
ended-plan case, and again with `3465b94fd`.)

```
 FAIL  |jsdom| tests/caring-contacts-explained-automation.dom.test.tsx > the service-state path stays on the server
 Test Files  1 failed | 17 passed (18)
      Tests  1 failed | 405 passed (406)
```

### Typecheck

`npx tsc -p tsconfig.json --noEmit` — no diagnostics emitted, exit 0.

### Lint, uncached

`node_modules/.cache/eslint` removed first, then `npx eslint --format json` over the five changed
files. The JSON names the files it examined, so this is not an exit code standing in for a run:

```
exit=0
files examined: 5
overlays\exit-only-overlay-trigger.tsx      errors 0 warnings 0 []
workspace\patient-overview.tsx              errors 0 warnings 0 []
lib\caring-contacts\assurances.ts           errors 0 warnings 0 []
tests\caring-contacts-explained-automation.dom.test.tsx  errors 0 warnings 0 []
tests\caring-contacts-patient-overview.dom.test.tsx      errors 0 warnings 0 []
```

### Not run, and why

- `npm run test` — the controller's, at merge points. Three worktrees are live and the exclusive
  heavy lease is the resource the standing discipline protects.
- `npm run verify:ui` / `tests/ui-caring-contacts-workspace.spec.ts` — see the section above; the
  changed branches are unreachable in that server.
- Anything provider-backed — not approached.

### One test-shape correction I made to my own work

My first version of the attestation read-back asserted the rendered text against
`planAssuranceWording(...)`'s **own return value**. That is precisely the shape Task 9b's mutation
falsified: emptying the map moves both sides together and the assertion agrees with itself. It was
rewritten to hold the rendered text to **literal expected content**, with the map pinned to the same
literals separately, before any mutation was run. Mutation **M10** is the one that proves the
correction: changing the domain's wording now goes red where it would previously have stayed green.

---

## Mutation ledger

Rules the driver enforced, each from the standing discipline: `git diff --quiet` asserted clean on
**both** sides of every mutation; presence checked **in process** by reading the file, never through a
shell (`grep -c` silently returns 0 here for a mutation demonstrably present); the gate was
`npm run test:cc-guards` and nothing wider, with `GATE_RECEIPTS=refresh`; every attempt itemised,
greens included; **no aggregate total**.

| #   | The claim the mutation attacks                                                             | Expected | Got                     | Gate result (`Tests`)       | Selection                                     |
| --- | ------------------------------------------------------------------------------------------ | -------- | ----------------------- | --------------------------- | --------------------------------------------- |
| M1  | the paused note names the PAUSED state as the cause                                        | red      | **RED**, as predicted   | 1 failed / 407 passed (408) | full set                                      |
| M2  | the paused note says a date is not a message on its way                                    | red      | **RED**, as predicted   | 1 failed / 407 passed (408) | full set                                      |
| M3  | the paused note says what would change it                                                  | red      | **RED**, as predicted   | 1 failed / 407 passed (408) | full set                                      |
| M4  | the paused note is LABELLED Paused, so it is findable by the state it is about             | red      | **RED**, as predicted   | 2 failed / 406 passed (408) | full set                                      |
| M5  | the draft note names NOT STARTED as the cause                                              | red      | **RED**, as predicted   | 1 failed / 407 passed (408) | full set                                      |
| M6  | draft and paused are different facts and do not collapse into one label                    | red      | **RED**, as predicted   | 3 failed / 405 passed (408) | full set                                      |
| M7  | the draft note says a date is not a message on its way                                     | red      | **RED**, as predicted   | 1 failed / 407 passed (408) | full set                                      |
| M8  | a RUNNING plan gets no such note, so the note means something when it appears              | red      | **RED**, as predicted   | 1 failed / 407 passed (408) | full set                                      |
| M9  | an ENDED plan, which explains itself row by row, gets no plan-level note                   | red      | **RED**, as predicted   | 1 failed / 407 passed (408) | full set                                      |
| M10 | THE SELF-COMPARISON TRAP IS CLOSED: the read-back is held to expected content              | red      | **RED**, as predicted   | 3 failed / 405 passed (408) | full set                                      |
| M11 | each attestation row NAMES THE DESTINATION rather than only the act                        | red      | **RED**, as predicted   | 1 failed / 407 passed (408) | full set                                      |
| M12 | no wording on this card says the patient consented                                         | red      | **RED**, as predicted   | 1 failed / 407 passed (408) | full set                                      |
| M13 | the card says WHERE the agreement lives                                                    | red      | **RED**, as predicted   | 1 failed / 407 passed (408) | full set                                      |
| M14 | the attestation's own instant is read back, not a constant                                 | red      | **RED**, as predicted   | 1 failed / 407 passed (408) | full set                                      |
| M15 | the empty case states itself as a fact                                                     | red      | **RED**, as predicted   | 1 failed / 407 passed (408) | full set                                      |
| M16 | the empty case says WHICH absence it is -- an older plan, not a missed confirmation        | red      | **RED**, as predicted   | 1 failed / 407 passed (408) | full set                                      |
| M17 | a plan WITH attestations renders them rather than the empty copy                           | red      | **RED**, as predicted   | 3 failed / 405 passed (408) | full set                                      |
| M18 | the card says WHY retention keeps the attestation while it clears the reason               | red      | **RED**, as predicted   | 1 failed / 407 passed (408) | full set                                      |
| M19 | the delivery drawer is offered where a message LEFT, not where it did not                  | red      | **RED**, as predicted   | 2 failed / 406 passed (408) | full set                                      |
| M20 | the control raises the delivery-detail row and no other                                    | red      | **RED**, as predicted   | 1 failed / 407 passed (408) | full set                                      |
| M21 | the control names the row it was opened from, so one row's control is told from another's  | red      | **RED**, as predicted   | 1 failed / 407 passed (408) | full set                                      |
| M22 | the exit-only commit REFUSES a row that records something (not a universal no-op)          | red      | **RED**, as predicted   | 1 failed / 407 passed (408) | full set                                      |
| M23 | an unknown overlay id is refused by name rather than by a TypeError                        | red      | **RED**, as predicted   | 1 failed / 407 passed (408) | full set                                      |
| M24 | OVER-SENSITIVITY CONTROL: no assertion reads the trigger's responsive width                | green    | **GREEN**, as predicted | 408 passed (408)            | full set                                      |
| M25 | the exit row gets a RECORD commit, not an unavailable one that would aria-disable the exit | red      | **RED**, as predicted   | 1 failed / 407 passed (408) | full set                                      |
| M26 | the visible promise is GENERIC, because the drawer it opens is                             | red      | **RED**, as predicted   | 1 failed / 407 passed (408) | full set                                      |
| M27 | REACHABLE NOW: the draft note does not describe itself as paused                           | red      | **RED**, as predicted   | 1 failed / 407 passed (408) | full set                                      |
| M28 | CONTROL: the attestation list locator finds a list when one exists                         | red      | **RED**, as predicted   | 2 failed / 37 passed (39)   | caring-contacts-patient-overview.dom.test.tsx |
| M29 | CONTROL: an ended plan's rows carry their own reason, held to expected content             | red      | **RED**, as predicted   | 2 failed / 37 passed (39)   | caring-contacts-patient-overview.dom.test.tsx |

Predicted message against observed, row by row:

- **M1** — predicted: _element does not contain "this plan is paused"_
  - failing test: `says a PAUSED plan is not running, and that a date below is not a message on its way`
  - observed: Error: expect(element).toHaveTextContent() Expected element to have text content: this plan is paused Received:
- **M2** — predicted: _element does not contain "a date below is not a message on its way"_
  - failing test: `says a PAUSED plan is not running, and that a date below is not a message on its way`
  - observed: Error: expect(element).toHaveTextContent() Expected element to have text content: a date below is not a message on its way Received:
- **M3** — predicted: _element does not match /Resuming the plan/i_
  - failing test: `says a PAUSED plan is not running, and that a date below is not a message on its way`
  - observed: Error: expect(element).toHaveTextContent() Expected element to have text content: /Resuming the plan/i Received:
- **M4** — predicted: _unable to find an accessible element with the role "group" and name "Paused"_
  - failing test: `says a PAUSED plan is not running, and that a date below is not a message on its way`
  - observed: TestingLibraryElementError: Unable to find an accessible element with the role "group" and name "Paused" Here are the accessible roles: region: Name "Rowan Sample":
- **M5** — predicted: _element does not contain "this plan has not been started"_
  - failing test: `says a DRAFT plan has not been started, in different words from the paused one`
  - observed: Error: expect(element).toHaveTextContent() Expected element to have text content: this plan has not been started Received:
- **M6** — predicted: _unable to find an accessible element with the role "group" and name "Draft"_
  - failing test: `says a DRAFT plan has not been started, in different words from the paused one`
  - observed: TestingLibraryElementError: Unable to find an accessible element with the role "group" and name "Draft" Here are the accessible roles: region: Name "Rowan Sample":
- **M7** — predicted: _element does not contain "a date below is not a message on its way"_
  - failing test: `says a DRAFT plan has not been started, in different words from the paused one`
  - observed: Error: expect(element).toHaveTextContent() Expected element to have text content: a date below is not a message on its way Received:
- **M8** — predicted: _expected null not to be in the document (queryByRole group "Paused")_
  - failing test: `adds no such note to a running plan, so the note means something when it appears`
  - observed: Error: expect(element).not.toBeInTheDocument() expected document not to contain element, found <div aria-label="Paused" class="flex min-w-0 flex-col gap-1 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2 forced-colors:border-[CanvasText]"
- **M9** — predicted: _expected element not to be in the document (queryByRole group "Withdrawn")_
  - failing test: `adds no plan-level note to an ENDED plan, which already explains itself row by row`
  - observed: Error: expect(element).not.toBeInTheDocument() expected document not to contain element, found <div aria-label="Withdrawn" class="flex min-w-0 flex-col gap-1 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2 forced-colors:border-[CanvasText]"
- **M10** — predicted: _element does not contain "A coordinator confirmed that the patient had agreed to receive caring contacts"_
  - failing test: `reads both attestations back in plain words, and never says the patient consented`
  - observed: Error: expect(element).toHaveTextContent() Expected element to have text content: A coordinator confirmed that the patient had agreed to receive caring contacts Received:
- **M11** — predicted: _element does not match /recorded on the plan on/i_
  - failing test: `reads both attestations back in plain words, and never says the patient consented`
  - observed: Error: expect(element).toHaveTextContent() Expected element to have text content: /recorded on the plan on/i Received:
- **M12** — predicted: _expected element not to match /consent/i_
  - failing test: `reads both attestations back in plain words, and never says the patient consented`
  - observed: Error: expect(element).not.toHaveTextContent() Expected element not to have text content: /consent/i Received:
- **M13** — predicted: _element does not match /hospital record/i_
  - failing test: `reads both attestations back in plain words, and never says the patient consented`
  - observed: Error: expect(element).toHaveTextContent() Expected element to have text content: /hospital record/i Received:
- **M14** — predicted: _element does not contain "2026-03-02 (AWST)"_
  - failing test: `reads both attestations back in plain words, and never says the patient consented`
  - observed: Error: expect(element).toHaveTextContent() Expected element to have text content: 2026-03-02 (AWST) Received:
- **M15** — predicted: _element does not match /holds no record of those confirmations/i_
  - failing test: `says a plan created before the attestation existed holds none, rather than rendering a blank`
  - observed: Error: expect(element).toHaveTextContent() Expected element to have text content: /holds no record of those confirmations/i Received:
- **M16** — predicted: _element does not match /before this plan began recording them/i_
  - failing test: `says a plan created before the attestation existed holds none, rather than rendering a blank`
  - observed: Error: expect(element).toHaveTextContent() Expected element to have text content: /before this plan began recording them/i Received:
- **M17** — predicted: _element does not contain "A coordinator confirmed that the patient had agreed to receive caring contacts"_
  - failing test: `reads both attestations back in plain words, and never says the patient consented`
  - observed: Error: expect(element).toHaveTextContent() Expected element to have text content: A coordinator confirmed that the patient had agreed to receive caring contacts Received:
- **M18** — predicted: _element does not match /no patient detail/i_
  - failing test: `keeps the attestation on a cleared plan while the first-contact reason has gone`
  - observed: Error: expect(element).toHaveTextContent() Expected element to have text content: /no patient detail/i Received:
- **M19** — predicted: _the surviving trigger is the Month 1 row, so the accessible name does not match /opened from the Day 1 row/_
  - failing test: `offers it on a message that went out, naming the row it was opened from`
  - observed: Error: expect(element).toHaveAccessibleName() Expected element to have accessible name: /opened from the Day 1 row/ Received:
- **M20** — predicted: _expected data-overlay-trigger "message-preview" to equal "delivery-detail"_
  - failing test: `offers it on a message that went out, naming the row it was opened from`
  - observed: Error: expect(element).toHaveAttribute("data-overlay-trigger", "delivery-detail") // element.getAttribute("data-overlay-trigger") === "delivery-detail" Expected the element to have attribute: data-overlay-trigger="delivery-detail" Received:
- **M21** — predicted: _accessible name loses the row, so it does not match /opened from the Day 1 row/_
  - failing test: `offers it on a message that went out, naming the row it was opened from`
  - observed: Error: expect(element).toHaveAccessibleName() Expected element to have accessible name: /opened from the Day 1 row/ Received:
- **M22** — predicted: _expected function to throw an error matching /records a decision/i, but it did not throw_
  - failing test: `refuses to be the workspace's escape hatch from Ruling 87 on a row that records something`
  - observed: AssertionError: expected [Function] to throw an error - Expected: null + Received:
- **M23** — predicted: _thrown error message does not match /No overlay is defined/i (a null property read instead)_
  - failing test: `refuses to be the workspace's escape hatch from Ruling 87 on a row that records something`
  - observed: AssertionError: expected [Function] to throw error matching /No overlay is defined/i but got 'Cannot read properties of null (readi…' - Expected: /No overlay is defined/i + Received:
- **M24** — predicted: _green -- geometry is not asserted offline, and should not be_
  - observed: no failure, and none expected. 408 passed (408).
- **M25** — predicted: _commitRefusalFor returns an every-row refusal instead of null, so toBeNull fails_
  - failing test: `refuses to be the workspace's escape hatch from Ruling 87 on a row that records something`
  - observed: AssertionError: expected { reason: 'Not built yet.', …(1) } to be null - Expected: null + Received:
- **M26** — predicted: _accessible name no longer starts with 'What a delivery receipt means'_
  - failing test: `offers it on a message that went out, naming the row it was opened from`
  - observed: Error: expect(element).toHaveAccessibleName() Expected element to have accessible name: /^What a delivery receipt means/ Received:
- **M27** — predicted: _the Draft group matches /paused/i, so the not.toHaveTextContent negative fires_
  - failing test: `does not let draft and paused collapse into one note, and proves the locators first`
  - observed: Error: expect(element).not.toHaveTextContent() Expected element not to have text content: /paused/i Received:
- **M28** — predicted: _the positive control cannot find the list, so the empty case's absence proves nothing_
  - failing test: `reads both attestations back in plain words, and never says the patient consented`
  - observed: TestingLibraryElementError: Unable to find an accessible element with the role "list" and name "Confirmations recorded on this plan" Here are the accessible roles: heading: Name "What was confirmed before this plan started":
- **M29** — predicted: _the Cancelled group's text no longer matches the expected sentence_
  - failing test: `explains every cancelled message in place, rather than leaving a bare status beside it`
  - observed: Error: expect(element).toHaveTextContent() Expected element to have text content: /cancelled every message that had not already gone out/i Received:

## Three process incidents during verification, none of them absorbed

**1. The scratchpad is shared, and my first driver sat at a colliding path.** The session scratchpad
holds helpers from every task in this programme (`mutate.py`, `mutate2.py`, `mutate-b2-*.mjs` and so
on). My first driver was written as a generic `mutate.mjs` writing a generic `ledger.md` — exactly the
collision the coordinator warned about. **Every row above was re-run** from a namespaced driver
(`scratchpad/cc-plan-detail/mutate-cc-plan-detail.mjs` → `ledger-cc-plan-detail.md`), and the generic
copies were deleted. The driver now also **reads the vitest `RUN` header out of each captured run and
records whether it names this worktree**; every row above carries
`attributed to THIS worktree (cc-plan-detail): true`, and a row that did not would abort the pass
rather than be reported. A result that cannot name itself is not evidence.

**2. A stale driver process dirtied the tree, and the guard caught it rather than absorbing it.**
After the first driver was stopped, a surviving node process left a mutation applied. The next pass
refused at its first row with `ABORTED | worktree dirty BEFORE applying`, which is exactly what the
`git diff --quiet`-on-both-sides rule exists for. The tree was restored and verified clean before the
namespaced run began, and it is clean now.

**3. Three rows were blocked by a lock refusal, and a refusal is neither a pass nor a failure.**
M20, M22 and M25 first came back with **no summary line**: `Database focused-test capacity is full`,
owned by other worktrees (`cc-schedule`, and the parent worktree). They were **retried, never forced**,
and all three landed. Their intermediate refusals stay itemised in the ledger file rather than tidied
away.

---

## What the ledger does NOT prove, stated rather than implied

- **M25 WAS NOT A GAP, and how I got that wrong is the most useful thing in this report.** I first
  reported the record-vs-unavailable commit choice as unprovable offline and deferred it to Playwright.
  It is provable offline twice over. `commitRefusalFor` is exported, pure and total over the three
  states of the slot, and `tests/caring-contacts-overlay-trigger.dom.test.tsx` **already draws exactly
  this distinction** — an `unavailable` commit gives an `every-row` refusal, a `record` commit gives
  `null`. That same file also opens overlays **in jsdom** and asserts `aria-disabled` on
  `workspace-overlay-action`, so the DOM-level difference is not Playwright's ground either.

  One line now sits beside the throw assertions and reddens under M25:
  `expect(commitRefusalFor(exitOnlyOverlayCommit("delivery-detail"))).toBeNull();` — **M25 is RED in
  the ledger below**, where it used to be green.

  **Why I missed it:** `tests/caring-contacts-overlay-trigger.dom.test.tsx` is **not in
  `test:cc-guards`**. Reasoning from _"what does my gate run?"_ I concluded that no offline test could
  distinguish two behaviours that an unrun suite distinguishes today. **A gate that omits a suite does
  not merely skip coverage — it hides the precedent**, and the second failure is worse than the first,
  because it makes an existing solution invisible rather than merely unproven.

- **M24 is an over-sensitivity control** and its green is the correct answer: no assertion reads the
  trigger's responsive width, and none should. It is now the only green in the ledger.
- **The schedule summary sentence itself** is asserted in my paused-plan case but was **not** mutated
  by me — `scheduleSummarySentence` is an earlier task's, proved by the Ruling [98] and ended-plan
  blocks above mine. I am relying on those rather than claiming my own coverage of it.
- **Several mutations turned more than one test red**, and the set is named rather than counted:
  **M6**, **M10** and **M17** each reddened three cases; **M4**, **M19**, **M28** and **M29** each
  reddened two. Reported rather than smoothed — each attacks a claim that more than one of my cases
  leans on. (An earlier draft of this line said "M10, M17 and M19 each turned two", which was wrong in
  both the number and the membership, and was itself a count standing where the set belonged.)

---

## Review round 2 — what was wrong, and what it cost

Five things in the first submission were wrong or unproven. Each is corrected in the tree and in the
ledger above; this section is what they have in common.

**1. An unreachable pair of negatives (M6).** My draft case asserted
`getByRole("group", { name: "Draft" })` and then, behind it, that the note says nothing about being
paused. M6 swaps the draft label for the paused one — so the **first** line failed and neither
negative was ever reached. The claim "draft and paused do not collapse into one label" was therefore
**unproven while appearing proven**, which is worse than an absent test. The negatives now live in
their own case, with the group negative placed **first** so a mutated label reaches it, and
**M27** — new, and reachable — reddens the wording negative.

**2. Absence assertions with no positive control.** Four assertions denied the presence of something
without ever showing that the locator can find that something when it exists: the empty-attestation
card's missing list, the running plan's missing not-running note, the ended plan's missing plan-level
note, and `exitOnlyOverlayCommit("delivery-detail")` not throwing. Each now renders the **present**
case first, asserts it, and only then asserts the absence — and each control is itself mutated
(**M28** for the attestation list, **M29** for the ended plan's row-level reasons, **M6** for the
not-running note, **M25** for the commit). The ended-plan control was also holding to
`length > 0`, which any group carrying any words at all satisfies; it is held to expected content now.

**3. A label that promised what the surface behind it cannot hold.** The control read
`What the phone network reported — Day 1` and opened a drawer with no contact data in it, because
`OverlayHost` takes no children. I had **disclosed** that in a comment and left the label alone, which
is precisely the "disclosing a limitation is not discharging it" failure. The visible words are now
generic — `What a delivery receipt means` — and the cadence label follows as the control's **origin**
(`opened from the Day 1 row`), which disambiguates one row's control from another's for a
screen-reader user without claiming anything about what opens. **M26** pins the generic promise;
**M21** pins the row.

**4. Ruling [130] — the throw stands in for a type, and I should have said so.**
`exitOnlyOverlayCommit`'s refusal is a runtime check for something the type system could make
impossible. `WORKSPACE_OVERLAY_DEFINITIONS` is annotated `readonly WorkspaceOverlayDefinition[]` with
`id: string`, which erases the id literals its `satisfies` clause would otherwise preserve; narrowing
`id` to a literal union there would let `overlayId` become a derived `NonMutatingOverlayId` and turn
**M22's wrong wiring into a compile error** — the standard Ruling [87] set. That narrowing lives in
`definitions.ts`, which is shared with live branches, so it is the coordinator's to land. The throw
stays as belt-and-braces either way, and is now recorded in the module rather than left implicit.

**5. Counts restated in prose survived the commit named for removing them** — `sixteen rows that
record something` and `not ambiguous among ten of them` in the source, and `the eight overlays` in this
report. Each is replaced by the set it names. The test that catches them: **is the thing the number
counts visible in the same view as the number?** If not, name the set. (This bullet said "Three counts"
in its own first draft, which counted a set it did not enumerate — failing the test the sentence
itself proposes, in the sentence proposing it.)

---

## A finding: the unmatched anchor was not mine

The `M17 | ANCHOR NOT UNIQUE (0 occurrences) | NOT RUN` line in my driver log is **not** my M17
failing to match. It is a **foreign mutation row from another task's table**, sitting inside my
driver's array — `file: "…/plan-wizard/plan-wizard.tsx"`, carrying `from`/`to`/`suite`/`predicts`
where every row of mine carries `find`/`replace`/`claim`/`predicted`. My own M17 ran and is RED above.

**It never wrote anything.** The foreign row has no `find` key, so the driver's uniqueness check
counted occurrences of the string `"undefined"`, got zero, and took the `continue` path — which is
above the write. The load-bearing confirmation is that **`plan-wizard.tsx` is byte-identical to
`HEAD`**: same blob, same working file, clean tree.

**Two of my first three supports were wrong, and I am correcting them rather than quietly dropping
them.** I wrote that the replacement text "appears nowhere in the tree" — **false**:
`everyAssuranceConfirmed(input.assurances)` is at `plan-activation.ts:485`. The true statement is
narrower: the **whole replacement line**, `sending" && everyAssuranceConfirmed`, occurs nowhere in
`src/` or `tests/`. I also wrote that "no commit on this branch touches that file at all" — **false**:
**19** commits touch `plan-wizard.tsx` (Tasks 7–9b). The true statement is that **no commit since this
task's base `ee2676290`** touches it, which is verified empty. A near-miss dressed up as three
independent proofs is worse than one proof stated exactly.

**And the escape was far narrower than my first account implied.** The foreign row's anchor,
`if (input.state.status === "sending") {`, occurs **exactly once** in `plan-wizard.tsx`. Had the row
carried a `find` key instead of `from`, the uniqueness check would have passed and **the driver would
have applied it** — mutating another task's source file mid-pass. Nothing about the anchor saved this;
only the missing key did.

**How it actually arrived, which is more mundane and more instructive than my first account.** I
reported this as evidence that "namespacing the directory was not enough". The row is present in
`mutate-cc-plan-detail.mjs.bak` as the **last element of my own MUTATIONS array**, immediately after
M25 — exactly where the log shows it. So it arrived as an **append edit to my own table**, not through
a shared path. Namespacing did its job; what had no guard was the array itself.

**It also collided on `id`.** The row was `id: "M17"`, duplicating a real row that had already run —
which is the entire reason the log read as _my_ M17 failing to match. **The crossing damaged the
ledger's row identity, not any result.**

**Both the intermediate lock refusals and this row are itemised** rather than replaced by the later
clean result, because the discipline asks for every attempt including the ones that did not run. In
this pass one row (**M29**) was refused the focused-test lease and was retried, not forced.

---

## Presence, now recorded rather than merely enforced

Every row above carries `mutation verified present on disk (in process): true`, read back from the
file by the driver rather than through a shell. It is load-bearing only for a **green** — a red proves
its own presence, since a mutation that never reached disk cannot make its own target assertion fail —
but the field is printed for every attempt so that the one green in the ledger (**M24**) rests on
evidence rather than on the absence of an abort.

---

## Review round 3

Four items, all closed. Two were my errors of the same kind: **a correction applied to one site and
not to its twin.**

### 1. A claim I withdrew was still standing, stated as current, in the same report

Round 2 withdrew "the choice between the two is unproven offline". I corrected it in "What the ledger
does NOT prove" and **left it standing** in the `FINDING: WorkspaceOverlayCommit has no member`
section — which is the section a reader consults when deciding that very question, so they got the
withdrawn version. The same family, milder: the trigger was still framed as "names the row so ten of
them are not ambiguous", the pre-correction wording.

Both are corrected. **The rule I broke is one this programme already wrote down:** _when a diff
changes what a mechanism does, read every doc comment in the files it touches._ A retraction is
exactly that kind of change, and my own report is exactly that kind of file. A phrase grep would have
found both in seconds; I did not run one because I believed I had already fixed "the" site.

### 2. Two of the three supports under my foreign-row proof were false

The conclusion held and was independently verified, but I had propped it up with two claims that do
not survive checking:

- "its replacement text appears nowhere in the tree" — **false.**
  `everyAssuranceConfirmed(input.assurances)` is at `plan-activation.ts:485`. The true statement is
  the **whole replacement line**: `sending" && everyAssuranceConfirmed` occurs nowhere in `src/` or
  `tests/`.
- "no commit on this branch touches that file at all" — **false.** **19** commits touch
  `plan-wizard.tsx` (Tasks 7–9b). The true statement is **no commit since this task's base**
  `ee2676290`, which is verified empty.

The support that was exactly right is the one that carries the weight: **byte-identical to `HEAD`**.

**And the escape was much narrower than I implied.** The foreign row's anchor occurs **exactly once**
in `plan-wizard.tsx`. Had it carried a `find` key rather than `from`, the uniqueness check would have
passed and **the driver would have applied it** to another task's source file. Only the missing key
prevented that — nothing about the anchor did. Three loose supports read as three independent proofs;
one exact support plus an honest statement of how close it came is worth more.

**How the row actually arrived** is also more mundane than I said: it sits in
`mutate-cc-plan-detail.mjs.bak` as the **last element of my own MUTATIONS array**, immediately after
M25. It arrived as an **append edit to my own table**, not through a shared path. Namespacing did its
job; the array had no guard.

### 3. The guard was inadequate in four ways, and had never run

Every one is fixed, and — the point I had missed — **the fixes are now executed rather than asserted**:

| Defect                                                                                                         | Fix                                                                          | Proof                                                                               |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Ran _after_ `readFileSync`, so a row naming an absent path would ENOENT and kill the pass                      | every refusal moved above all file I/O                                       | `PROBE-ALLOWLIST` names a non-existent path and **refuses instead of throwing**     |
| Sniffed shape, not containment — a foreign row carrying `find`/`claim` would be applied to another task's file | an **allowlist** of the files this task may mutate, checked against `m.file` | `PROBE-ALLOWLIST` refused on containment                                            |
| No duplicate-`id` check — the collision that corrupted ledger identity                                         | id-uniqueness **throws** before any row runs                                 | re-injecting `id: "M17"` throws `duplicate mutation id M17`, and nothing is written |
| Never executed                                                                                                 | probe rows that trip each branch                                             | `PROBE-SHAPE` refused on shape; tree clean after every probe                        |

**Plus the check the byte-equality rule needed and did not have.** `expected !== before` is asserted
**before** the write: if `find` were absent, `String.replace` returns the original, the write is a
no-op, and `onDisk === expected` **passes** — reporting a mutation as present when it never applied,
in precisely the green case the presence field exists for. `PROBE-NOOP` trips it.

### 4. Formatting, and a count with a false number attached

The changed files had never been through Prettier — `patient-overview.tsx`, the patient-overview DOM
suite and this report all failed `--check`. All now pass. **Formatting moved no mutation anchor:**
every one of the 29 was re-counted against the formatted files and each still occurs exactly once,
and the ledger was then re-run in full against the formatted tree so the captured line numbers are
the ones a reader will find.

The Ruling [94] breach: "M10, M17 and M19 each turned two tests red" was wrong in **both** the number
and the membership — **M6**, **M10** and **M17** reddened three; **M4**, **M19**, **M28** and **M29**
reddened two. It is now stated as the set. Round-2 item 5 had the same shape — "Three counts restated
in prose", counting a set it did not enumerate, failing the test the sentence itself proposes — and is
now stated as the set too.

### Per-mutation suite selection, from M28 onward

The last two rows ran against **only the suite they target** rather than the whole `test:cc-guards`
set — same runner, same lease, same evidence, a far shorter hold. The **Selection** column records
which rows used which, so a per-suite red is never mistaken for a full-set red. What the narrow run
deliberately cannot see is collateral damage in a suite it does not name; that is what the single full
`test:cc-guards` run on the final tree is for, and it is not claimed to be replaced.

### The lease, and what it cost

This round's re-run met sustained contention: **one pass had every one of its first eighteen rows
refused** by a single long lease from another worktree, which would have produced a ledger of unrun
rows wearing the shape of evidence. That pass was **abandoned rather than recorded**. The driver now
**retries a refusal in place** — waiting up to forty attempts, logging every refused attempt, never
forcing — and the ledger shows those waits: fourteen consecutive refusals before one row, seven before
another. The driver was also killed twice mid-row by process cleanup; each time the stranded mutation
was restored and verified clean before the pass resumed, which is what `git diff --quiet` on both
sides is for.
