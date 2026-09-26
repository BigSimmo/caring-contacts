# Task 6 report — the Patient overview screen

**Branch:** `claude/browser-test-gate-handoff-d5c1db`. **Base:** `fa7f8ac98`.
**Status:** DONE_WITH_CONCERNS. Everything the brief asked for is built and proved, and one of
its requirements — Ruling 96's display of the recorded first-contact reason — **cannot be met**,
because the reason is not stored anywhere this screen can read it. That is reported below rather
than worked around, exactly as the brief instructed.

**Commits (five, oldest first):**

| SHA         | What                                                                        |
| ----------- | --------------------------------------------------------------------------- |
| `ae75c501b` | The screen, its component, the route helper, the wired directory row, tests |
| `f149f2a4a` | The browser surface, and a gate that makes the omission fail                |
| `e5795b418` | Two gates the mutation ledger proved could not fail, closed                 |
| `14a2ec880` | The design-system adoption declaration the full suite caught                |
| `5450777f6` | Prettier                                                                    |

---

## A note on the rulings before anything else

**Rulings 96–99 do not exist in `docs/caring-contacts/phase-2b-build-record.md`.** That file's
ruling numbering stops at 94, and its last line is the Task 6 dispatch. The four rulings exist only
as the section headings of `task-6-brief.md` itself, which state them in full. I worked from the
brief's statements of them and have quoted them where a decision turns on one. If they were meant
to be written into the build record, that has not happened yet.

---

## What was built

### `src/app/caring-contacts/patients/[patientId]/page.tsx`

A Server Component, no client boundary of its own, following the Task 5 spine exactly:
`isCaringContactsDemoEnabled()` → `notFound()`; `resolveDemoActor()`; `caringContactsStore()`;
every read through `auditedRead`; fail closed on every bad outcome; `<CaringContactsShell>` behind
the same lazy `dynamic()` boundary.

**Next 16.** `params` is a `Promise<{ patientId: string }>` and is awaited, per
`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`, which documents
it as a promise and notes that the synchronous access of Next 14 and earlier is being removed. I
read the file rather than reasoning from memory, as the brief required.

**Ruling 97, implemented as stated.** The patient's plans come from filtering `listPlans` — which
is team-scoped for free — by `record.patientId`. I checked the premise the brief flagged: `PlanRecord`
carries `patientId` as a required field (`repository.ts`), and both stores populate it on every
record, so the relationship is as described and no new read was invented. From there:

- **Zero plans** → an honest empty state, never `notFound()`, and its words deliberately do not
  distinguish "no plan exists" from "the plan is another team's".
- **A role without `viewReferral`** → the `"not-permitted"` empty state instead, decided from the
  actor by `canPerformCaringContactAction`, never inferred from the empty list. This is the third
  case Task 5 found, and `ListEmptyState` now has a `"not-permitted"` kind for it (Ruling 92), so
  I used that kind rather than the `"filtered"` shape Task 5 had to borrow.
- **Exactly one plan** → renders.
- **More than one, no plan named** → a chooser. It calls `getEpisode` **not at all**; the name
  comes from `listPatientNames` (Ruling 91).
- **`?plan=`** → validated against the plans this actor could already list for this patient before
  anything is read with it. A plan id that fails that is ignored and the screen asks; a repeated
  `?plan=a&plan=b` names no single plan and is treated the same way.

`getEpisode` is called **once**, for **one** plan, and only after that rule settles which.

**The episode read's access identity.** There is no API route anywhere under
`src/app/api/caring-contacts/` that reads an episode, so this read has no API-side twin to copy.
I used `{ kind: "view", objectType: "episode", objectId: <planId> }` — `"episode"` is an existing
`AccessedObjectType` member, so **no new member was needed** and the route's hand-copied `z.enum`
in `access-trail/route.ts` did not have to change. `"view"` because a single named object is being
looked at rather than a collection searched; the plan id as object id because that is the object
released.

**A denied episode is not a failed one.** `getEpisode` answers `null` for a nonexistent plan, for
another team's plan, and for a role without `generateClinicalRecordSummary` — indistinguishably, on
purpose. `auditedRead` records that as `denied`. Since the page has already established from
`listPlans` that the plan exists and is this team's, a null release is the capability, and the
capability is a fact about the actor. So: the read is still made and still recorded (a denied read
belongs on the trail), and `canPerformCaringContactAction` answers which fact it is. When the actor
**does** hold the capability and the release is still null, the page throws — nothing legitimate
produces that, and rendering a nameless record would read exactly like a role restriction.

Today that branch is unreachable: `permissions.ts` grants `generateClinicalRecordSummary` to
`coordinator` and `teamLead`, which is exactly the set holding `viewReferral`. It is written anyway,
on the same principle as Task 5's names notice.

### `src/components/caring-contacts/workspace/patient-overview.tsx`

A Server Component with no hooks. It takes a discriminated `view` the page has already decided, so
it never infers a capability from a shape.

**Ruling 98 — every number derived, nothing a literal.** The schedule summary counts
`record.contacts`; sendability is keyed off `contact.state`, never `planned.suppressed`, for the
reason `PatientsDirectory` records (N-2: `applyContactTransition`'s `suppress` action can move any
live contact there later, and such a contact carries no `planned.suppressed` marker). The closing
message is labelled "Closing message" with a line saying it ends the twelve months and is not one
more caring contact. A suppressed entry states, in place, why it will not be sent, distinguishing
the absorption (reversible by choosing another first-contact date) from any other suppression
(terminal, and this screen does not hold the cause).

I did **not** use `Episode.counts.contactsScheduled` for "messages that will be sent" — see
Concern 2.

**What it shows of the person, and what it withholds.** Name, synthetic identifier, other
identifiers, cultural identity. **The mobile number is deliberately never painted**, though
`getEpisode` releases it: nothing on this screen needs it, the approved mockup's identity strip does
not show it, and a number rendered onto a page is a number in a screenshot, a printout and a cache.
Permitted to read is not the same as obliged to display. This is a judgement call and is flagged for
review.

**A blank name.** `CLEARED_PATIENT_DETAIL` is what both stores write after a retention clearance, so
a blank `patientName` is "no name held". This screen can say _why_ where the directory could not: an
actor who may not read an episode receives no `Episode` at all, so a blank name on a **released**
episode is the clearance, not the role. A note states that, and the heading falls back to the
synthetic identifier.

### Ruling 99 — the directory row

`patients-directory.tsx`'s row control is now `<Link href={patientRoute(record.patientId)}>`. I
checked whether that was the whole of the change, as the brief asked, and **it was not**:

1. `UnavailableDestination` was then unused in that file, so its import had to go.
2. The module comment's Ruling-13 paragraph claimed "the only [client component] it renders is
   `UnavailableDestination`", which the swap made **false**. Corrected: the screen now renders none
   of its own.
3. The "Why the row's detail control is not a link" paragraph was rewritten, per the brief.
4. Two component tests asserted the control was an `aria-disabled` button; they now assert a real
   `<Link>` at `patientRoute(...)`.

I kept it keyed by **patient**, as the brief specified, rather than using the new
`patientPlanRoute(patientId, planId)`. The control says "patient record", the destination is the
patient's record, and where a patient holds two plans it lands on the chooser — which is what
Ruling 97 asks of a patient-keyed route. See Concern 4 for the alternative I did not take.

The four orphan-route steps: (1) the inbound link above; (2) `npm run sitemap:update`, with a real
description added to `scripts/generate-site-map.ts` so the entry is not the generator's
"Route discovered from app directory" placeholder; (3) an entry in `docs/codebase-index.md`, plus a
correction to its Caring Contacts paragraph, which named only two built screens; (4) a reachability
assertion — see below.

### The reachability assertion, and why a new one was needed

`tests/route-reachability.test.ts` filters out **every route containing `[`**. So the new screen was
exempt from the orphan guard by construction: it could have shipped with no inbound link anywhere and
the file would have stayed green. That exemption is right for the app's older `[slug]` families,
whose hrefs come from live data; it is wrong here, because this workspace reaches every destination
through a named builder, so "is it linked" is statically answerable.

I added `CARING_CONTACTS_DYNAMIC_ROUTE_BUILDERS` and an assertion that every dynamic
`/caring-contacts` page family is registered against a builder that exists, and that some non-mockup
source renders `<Link href={<builder>(...)}>`. Registration is mandatory: an unregistered family
fails.

### `src/lib/caring-contacts-routes.ts`

Added `CARING_CONTACTS_PLAN_QUERY_PARAM` and `patientPlanRoute(patientId, planId)`, so the chooser's
hrefs and the page's parser agree on the parameter name from one declaration. No path literal is
assembled anywhere in the new code.

---

## The browser surface

`WORKSPACE_SCREENS` gains `{ name: "Patient overview", route: PATIENT_OVERVIEW_ROUTE, heading: "Patient" }`,
and I added a `caring-contacts patient overview` describe block covering all five proof categories
the adoption contract names: serving + words, 320px layout and tap floor, dark re-resolution
(reading this screen's **own** surface, not only shell chrome), forced colours, and print.

**Adding the array entry alone would have proved nothing.** `WORKSPACE_SCREENS` is used only to type
`WorkspaceScreen` and to index `TODAY_SCREEN`/`PATIENTS_SCREEN`; no proof iterates it. So the array
is necessary and not sufficient, and the real work was the describe block. The array's own comment
overstated this, and I have corrected it.

**The demo id.** The brief said to find what the demo store seeds. It seeds **nothing**:
`caringContactsStore()` falls back to `createInMemoryRepository`, which starts with no plans, and
nothing writes any. So there is no seeded id to pin, and I did not pretend otherwise. The spec uses
`SYN-PATIENT-001`, and its comment says plainly that this is a well-formed synthetic identifier
exercising the zero-plans path rather than a seeded record. That makes it stable rather than rotten:
**any** id renders the same empty state with the same `h1`. If the workspace ever seeds a caseload,
this should become one of the seeded ids.

**The consequence for coverage, stated rather than glossed.** Every browser assertion on this screen
exercises the zero-plan path — which is the branch that must never become a 404, renders this
screen's own empty state, and is what a mistyped URL reaches. The populated paths (the schedule, the
suppressed entry, the chooser, the cleared name) are proved in the DOM test against the real store,
because nothing in that browser can create a plan. **The caseload row that links here cannot be
clicked in that server either** — with no plans there is no row — so the inbound link is proved
statically instead.

### Making the omission fail rather than pass

The brief asked for a cheap way, if one exists. There is one, and I built it:
**`tests/caring-contacts-workspace-screens.test.ts`**. It is offline, reads two files, and runs in
~200 ms. It resolves the `route:` expressions inside `WORKSPACE_SCREENS` (reading the spec as text,
because the array is not exported and the spec imports `@playwright/test`, which a Vitest run must
not pull in), resolves their `${...}` interpolations from the `const` declarations beside them, and
compares them against the workspace's production page routes from `collectSiteMapData()`. A dynamic
family matches segment-by-segment, `[param]` accepting any non-empty segment.

Every step of the parse throws rather than returning nothing, and there is a separate test asserting
both inputs are non-empty — because a parser that silently stops understanding the source would
recreate the exact vacuous-pass this check exists to close. It also fails on a **stale** entry: a
listed route the workspace no longer serves means those proofs assert against a 404.

What it does not claim: listing a route proves a proof _can_ reach it, not that any proof asserts
anything about it. It closes the silent half.

---

## Ruling 96 — the gap, reported rather than worked around

**The recorded first-contact reason is not stored anywhere this screen can read it.** I traced it:

- `ScheduleInput.firstContactReason` (`schedule.ts`) is used **once**, at line 182, to refuse a
  non-default first contact with a blank reason. It is then discarded.
- `CreatePlanInput.firstContactReason` (`repository.ts`) is passed straight into
  `buildApprovedSchedule` by the in-memory store (`in-memory-repository.ts:523`) and by the Postgres
  store (`postgres-repository.ts:1069`), and by neither into anything persisted.
- `StoredPlan` has no field for it. `PlannedContact` has no field for it. The
  `caring_contacts.plans` insert lists its columns explicitly and there is no
  `first_contact_reason` among them; `grep -rn "first_contact" supabase/ src/lib/caring-contacts/db/`
  returns nothing.

So Ruling 96's display requirement **cannot be met as written**. I did not invent a storage location
and I did not silently omit the reason. What the screen does instead:

- It shows the first contact date always.
- When the date is the default (discharge + 1) it says so.
- When it is **not**, it renders an in-place `role="note"` with the spec §4.4 "Why: / What changes
  it:" shape, stating the date, how many days after discharge it is, that a coordinator **had** to
  give a reason for the move, and that the reason **is not kept with the plan, so this screen has
  nothing to show you**. The remedy line says the reason is checked at creation and then discarded,
  and that keeping it is outstanding work.

The claim that a reason was given is sound rather than assumed: `buildApprovedSchedule` refuses any
offset other than discharge + 1 unless `firstContactReason` is non-blank, and only an explicit
`firstContactDate` can move the day. So a moved first contact implies a validated reason existed.

**This wants an owner decision.** Fixing it means adding a field to `StoredPlan`, a column to
`caring_contacts.plans` (a migration), and a value to both stores' `createPlan` — a domain and
schema change, well outside a screen task. I have not started it.

---

## Verification

Every gate below actually ran and printed a summary; none was reported from an exit code, and none
hit a lock refusal.

| Gate                                            | Result                                           |
| ----------------------------------------------- | ------------------------------------------------ |
| Focused Vitest (the four files I changed/added) | `Tests  58 passed (58)`, then `26 passed (26)`   |
| **Full `npm run test`**                         | **`Tests  10011 passed \| 74 skipped (10085)`**  |
| `npm run typecheck`                             | exit 0, `[gate-receipts] recorded a pass`        |
| `npm run lint`                                  | exit 0, `--max-warnings 0`, `recorded a pass`    |
| `npx prettier --check` on every changed file    | 4 files reformatted, re-checked clean, committed |

**The full suite earned its runtime.** The focused runs were green while `tests/design-system-adoption.test.ts`
was red — the adoption contract is a route **census**, so an undeclared production page route fails
it from a file my diff did not contain. That is the exact trap the brief described. Fixed by
declaring the route on the `caring-contacts-workspace` surface, regenerating the manifest
(`npm run design-system:adoption:update`), and moving the census total from 80 to 81 with the prose
that explains it.

**`npm run verify:ui` was NOT run.** It needs `npm run ensure` and a production build; the brief says
you run that gate. See "Does this affect the browser spec" below — the answer is an unambiguous yes.

### Mutation ledger

Every attempt, including the two that did not go red first time and the one whose mutation did not
compile. Each mutation's presence in the tree was confirmed with `git diff --stat` as a **separate
step** before any test was run — never chained with `&&`.

| #    | Mutation                                                                 | Covering test                     | Verdict                                                                                                        |
| ---- | ------------------------------------------------------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| M1   | page: stop filtering `listPlans` by `patientId`                          | patient-overview.dom              | **RED** `1 failed \| 15 passed (16)`                                                                           |
| M2   | page: silently pick the first plan instead of asking                     | patient-overview.dom              | **RED** `3 failed \| 13 passed (16)`                                                                           |
| M3   | page: trust `?plan=` without proving it is this patient's                | patient-overview.dom              | **RED** `1 failed \| 15 passed (16)`                                                                           |
| M4   | page: record the episode read as a `plan` read on the trail              | patient-overview.dom              | **RED** `1 failed \| 15 passed (16)`                                                                           |
| M5   | page: drop the actor-decided role gate                                   | patient-overview.dom              | **RED** `1 failed \| 15 passed (16)`                                                                           |
| M6   | page: `notFound()` on zero plans instead of stating it                   | patient-overview.dom              | **RED** `1 failed \| 15 passed (16)`                                                                           |
| M7   | overview: hard-code the mockup's ten-contact literal                     | patient-overview.dom              | **RED** `1 failed \| 15 passed (16)`                                                                           |
| M8   | overview: count sendability off `planned.suppressed`                     | patient-overview.dom              | **GREEN — not covered** (see below)                                                                            |
| M8b  | the same mutation, retried after adding a distinguishing fixture         | patient-overview.dom              | **RED** `1 failed \| 16 passed (17)`                                                                           |
| M9   | overview: call the closing message one more caring contact               | patient-overview.dom              | **RED** `1 failed \| 15 passed (16)`                                                                           |
| M10  | overview: treat every first contact as the usual day                     | patient-overview.dom              | **RED** `1 failed \| 15 passed (16)`                                                                           |
| M11  | overview: paint the patient's mobile number                              | patient-overview.dom              | **RED** `1 failed \| 15 passed (16)`                                                                           |
| M12  | overview: treat a blank cleared name as a name                           | patient-overview.dom              | **RED** `1 failed \| 15 passed (16)`                                                                           |
| M13  | overview: drop the absorbed contact's reason for the generic one         | patient-overview.dom              | **RED** `1 failed \| 15 passed (16)`                                                                           |
| M14  | directory: replace the row `<Link>` with a `<span>`                      | patients-directory.dom            | **NO SUMMARY — the gate did not run** (the JSX no longer compiled; an invalid mutation, not a coverage result) |
| M14b | directory: point the row's link at the plan id instead of the patient id | patients-directory.dom            | **RED** `1 failed \| 31 passed (32)`                                                                           |
| M15  | directory: link the row at the patients list, not the patient            | route-reachability                | **GREEN — the gate could not fail** (see below)                                                                |
| M15c | the same mutation, retried after the comment-stripping fix               | route-reachability                | **RED** `1 failed \| 5 passed (6)`                                                                             |
| M16  | spec: leave the new screen off `WORKSPACE_SCREENS`                       | caring-contacts-workspace-screens | **RED** `1 failed \| 2 passed (3)`                                                                             |
| M17  | reachability: forget to register the dynamic family's builder            | route-reachability                | **RED** `1 failed \| 5 passed (6)`                                                                             |
| M18  | screens gate: point `WORKSPACE_SCREENS` at a route not served            | caring-contacts-workspace-screens | **RED** `2 failed \| 1 passed (3)`                                                                             |

**M15 found a real defect in a gate I had just written, and it is the most instructive result here.**
The reachability regex looked for `<Link href={patientRoute(` in each source file. The patients
directory's **module comment** contains the sentence "the control is `<Link href={patientRoute(...)}>`".
So the check passed on prose while the real link was mutated away — a check that could not fail,
satisfied by a file _documenting_ a link rather than containing one. Fixed by stripping block
comments and whole-line `//` comments before the scan (trailing `//` is deliberately left alone so a
protocol-relative URL inside a string cannot truncate its line). M15c then goes red.

**M8 was a genuine coverage hole, not a false alarm.** Every fixture the tests could build came from
the real store, and for a store-built plan the two derivations agree exactly — the schedule's
absorption is the only suppression any repository write performs. So swapping `contact.state` for
`planned.suppressed` changed no value any assertion read. `applyContactTransition`'s `suppress`
action exists in `model.ts` and **no repository method calls it**, so the distinguishing fixture is
one the store cannot produce. I added a component-level test that renders `PatientOverview` directly
with a transition-suppressed contact (state `suppressed`, no `planned.suppressed` marker) and
asserts both the count and the generic reason wording. M8b then goes red. This is Task 5's finding
N-2 one screen further along.

**One process note.** The mutation harness reverts with `git checkout -- <file>`, which also
discarded my _uncommitted_ comment-stripping fix when a later mutation targeted the same file. I
caught it by re-grepping for the fix rather than trusting the earlier run, re-applied it, and
re-verified M15c on its own. Worth knowing before anyone reuses that harness: commit a fix before
mutating the file it lives in.

### Does this affect `tests/ui-caring-contacts-workspace.spec.ts`?

**Yes, unambiguously — I edited it.** Three changes:

1. Three new constants and a third `WORKSPACE_SCREENS` entry.
2. `emptyStateColours(page)` gained an optional `label` parameter defaulting to `"No patients yet"`,
   so every existing call site reads exactly as before. Its `page.evaluate` now takes an argument.
3. A new `caring-contacts patient overview` describe block: five tests, five page loads.

The existing Today and Patients blocks are otherwise untouched. The risk I would watch is the
`emptyStateColours` signature change, since it now passes an argument through `page.evaluate`, and
the new block's dependence on `"No plan for this patient"` being both the `aria-label` and the
rendered heading of the empty state.

---

## Concerns

1. **Ruling 96 cannot be satisfied as written.** The first-contact reason is validated and
   discarded; it reaches no field and no column. The screen states that absence in place rather than
   omitting it, but a clinician still cannot see why a plan's first contact was moved. Closing this
   needs a `StoredPlan` field, a migration and both stores — an owner decision, not a screen change.

2. **`Episode.counts.contactsScheduled` can overstate the plan.** It counts entries whose
   `planned.suppressed` is undefined (`in-memory-repository.ts:1351`), so a contact suppressed by a
   later `applyContactTransition` would still be counted as scheduled — the module's own count would
   claim a message will be sent that never will. This is the same divergence as M8 above, but inside
   the domain rather than in a screen. I avoided it by deriving from `contact.state`, which meant
   **not** using the number the module owns — a deliberate departure from "a screen must never
   re-derive a rule a module already owns", made because the module's number is wrong for the
   question the screen asks. It is unreachable today (no store write suppresses a contact that way)
   and worth fixing in the domain rather than routing around forever.

3. **I chose not to display the mobile number**, though `getEpisode` releases it and the brief calls
   the read legitimate here. Reasoning is in the module comment: nothing on the screen needs it, the
   approved mockup does not show it, and rendering it puts it in screenshots, printouts and caches.
   If the owner wants it shown, it is one line — but I would rather be told to add it than have
   added it unasked.

4. **The caseload row is patient-keyed, so two plans for one patient give two rows with the same
   destination**, both landing on the chooser. The brief specified `patientRoute(record.patientId)`
   and I followed it. `patientPlanRoute(record.patientId, record.plan.id)` would send each row to
   its own plan directly; I did not take it because the control's label says "patient record", not
   "this plan". Flagging it as the one place where the literal instruction and the row's own
   identity pull slightly apart.

5. **The browser proofs only ever see the zero-plan path**, because the demo store seeds nothing.
   That is honestly the strongest branch to prove in a browser, but it does mean the schedule, the
   suppressed entry, the chooser and the cleared-name notice are proved in jsdom only. Seeding a
   small synthetic caseload for the Playwright server would fix this for every workspace screen at
   once, and would also let the caseload row's link be _clicked_ rather than asserted statically.

6. **`patients-directory.tsx` carried stale prose I did not fix.** Its "Three empty lists, three
   different facts" paragraph still says `ListEmptyState` has two kinds and that the role case "gets
   the `filtered` wording shape" — Ruling 92 added a third kind and the code uses
   `kind="not-permitted"`. This predates my change and I left it alone rather than widening the diff,
   but it is the same correction-without-its-dependent-sentences decay the build record keeps
   recording, sitting in the file I was already editing. Say the word and I will fix it.

7. **No overlay was wired**, per the brief's instruction. `overlay-trigger.tsx` requires a commit
   handler at the type level and this screen needs no overlay to work; Task 11 owns that wiring.
   The one control that would eventually be a link — the plan detail — remains an
   `UnavailableDestination` with a stated reason, because Task 7 builds that page.

8. **No new `AccessedObjectType` member was needed.** `"episode"` already existed, so
   `access-trail/route.ts`'s hand-copied `z.enum` did not have to change and could not drift. Worth
   noting that the deferred contract test pinning that enum to the union (Task 5b deferral 3) is
   still outstanding and would have made this a non-question.

---

# Review round 1

One Critical, one Important, three Minors. All addressed.

| SHA          | What                                                                          |
| ------------ | ----------------------------------------------------------------------------- |
| `6a51a29c6`  | C1 and its M5 extension — the predicate moved into the sealed domain          |
| `4f6b72285`  | I2, M6, M7                                                                    |
| `baf709d41`  | The coordinator's own commit, recording both owner decisions and this section |
| `7e6da48b8`  | The mobile number, per the owner's reversal of my Concern 4                   |
| _(this one)_ | The addendum below, and this corrected table                                  |

## C1 — the schedule summary told the reader a cancelled plan would still be sent

**Confirmed, and worse than the count alone.** I reproduced it before fixing it: `withdrawPlan`
runs `cancelAllNonTerminalContacts` (`in-memory-repository.ts:590`), and
`recordHospitalStatusEvent`'s `cancelUnsent` outcome does the same for a recorded death, so both
produce a plan of ten `cancelled` contacts — none of them `suppressed`. The old predicate counted
every one of them as sendable and printed "10 entries, and every one of them will be sent." above
ten rows reading "Caring contact · Cancelled".

**The reviewer's reading of my Concern 3 is correct and I accept it.** I saw the rule, reasoned
about it, and broke it anyway: I replaced a domain number that is wrong on a path nothing reaches
yet with a component predicate that is wrong on a path ordinary writes reach today. Being right
about the domain bug did not license inventing a second truth in the screen — and the second truth
landed somewhere worse than the first.

### The fix, as ruled

**The predicate now lives in the sealed domain**, in three layers, none of which redefines
`EpisodeCounts.contactsScheduled`:

1. **`src/lib/caring-contacts/model.ts`** gains `ContactSendability` and `contactSendability(state)`
   — an **exhaustive switch** over `ContactState` with a `never` default, placed beside
   `applyContactTransition`, the state machine that produces those states. A list of non-sendable
   states is a list someone has to remember to extend; this does not compile at all when a member is
   added to `ContactState` and left unclassified, so a new state cannot default into "will be sent".
2. **The same file ties the new knowledge to the knowledge it already held**, at load time and
   thrown rather than asserted in a test — the pattern `schedule.ts` already uses for its send
   window. Every state in `DISPATCHED_CONTACT_STATES` must classify as `alreadySent`, and no state
   in `TERMINAL_CONTACT_STATES` may classify as `stillToSend`. So the three descriptions of this one
   state machine cannot drift apart, and a build that got it wrong does not start.
3. **`src/lib/caring-contacts/repository.ts`** gains `StoredContactSummary` and
   `summariseStoredContacts(contacts)`, separating **already sent**, **still to send** and **will
   not be sent**. It lives on the contract because `StoredContact` is declared there and both stores
   hold one; a second copy of the arithmetic anywhere would be a second answer to "how much of this
   plan is left". `total` is stated rather than left to the caller to add up, so a caller cannot
   reconstruct it from two buckets and be wrong when a third exists.

`EpisodeCounts.contactsScheduled` is untouched, per the ruling.

**The phrasing.** "Every one of them will be sent" is a claim about the future, and the sentence is
now derived from all three buckets rather than from the absence of one:

- nothing left to send → `10 entries, and none of them will be sent.`
- nothing sent yet → `10 entries, and every one of them is still to be sent.`
- everything sent → `10 entries, and every one of them has been sent.`
- mixed → `3 entries: 1 already sent, 1 still to send, and 1 that will not be sent.`
- no entries at all → `This plan holds no schedule entries.`

### M5, which travelled with it

`ScheduleEntry` now renders `AutomatedState` for **every** state the domain classifies as
`willNotBeSent`, not suppression alone. A cancelled message on a plan that has **ended** is
explained by the ending, which `PlanRecord.outcome` does carry:

> This plan ended (withdrawn), and the system cancelled every message that had not already gone out.

A cancelled message on a plan still running says it does not hold the cause rather than inventing
one, and a missed message says the send window closed without the message going out. Every branch's
remedy is honest: absorption is the one reversible case here and the only one offered a remedy.

I accept the extension beyond Ruling 98's letter. A row reading "Caring contact · Cancelled" with
nothing beside it is the bare status chip §4.4 exists to prevent, whatever produced the state.

### Coverage

Five new tests. The two the review asked for are built **through the real store**: one plan
withdrawn, one stopped by a recorded death via `recordHospitalStatusEvent`. Neither is a hand-built
fixture, so neither can be true of a plan the domain would never produce. Three more cover branches
those two cannot reach — a cancelled contact on a **still-running** plan (which must not claim the
plan ended), a missed contact, and a three-bucket plan, the only shape that proves the sentence is
built from the summary rather than from the absence of one state.

The withdrawn-plan test also pins the old sentence negatively, so the exact regression cannot come
back silently.

## I2 — the coverage claim in the spec comment was false

**Accepted without qualification.** I checked the code this time instead of extending the sentence,
and the reviewer is right on every particular:

- `caring-contacts workspace accessibility modes` calls `page.goto(WORKSPACE_ROUTE, …)` directly —
  Today only, for every mode it covers.
- `caring-contacts service stop, stated on every screen` calls
  `openWorkspace(page, width, STOP_HANDOVER_VIEWPORT_HEIGHT)` with no fourth argument and takes the
  `TODAY_SCREEN` default. Despite its name, it proves Today only.
- `PATIENTS_SCREEN` and `PATIENT_OVERVIEW_SCREEN` appear only inside their own blocks.
- Nothing iterates `WORKSPACE_SCREENS`.

That I wrote the true version in my report and the false version in the comment is the worse half of
this finding, not a mitigation: the comment is what the next implementer reads.

**Corrected the comment, not the disclosure.** It now lists which suite names which screen, states
plainly that being in the array carries no proof by itself, and says what the array _is_
load-bearing for — the offline screens gate. It also records that parameterising the blocks is filed
as its own work, and why the service-stop block needs deliberate handling.

**I did not parameterise the suites**, per the instruction.

## M6 — the negative assertion is pinned again

The patient half is restored as a stronger pin than the one it replaced: every link whose href
starts with `/caring-contacts/patients/` must equal `patientRoute("patient-plan-1")` exactly. A
wrong patient id, a hand-built path, or a stray extra link into the family all fail. The plan half
is unchanged.

## M7 — comment made to match code, and why that direction

**I made the comment match the code.** `?plan=` is consulted only when the patient has more than one
plan; with exactly one, that plan renders whatever the URL says. Reasons, in order of weight:

1. Ruling 97 states "exactly one plan → render it" without qualification. The parameter exists to
   choose among several, and there is nothing to choose from.
2. The alternative turns a mistyped or stale link into a **one-item chooser** on a clinical screen,
   and gives the URL the power to withhold a plan the actor may see. That is a worse behaviour, not
   a stricter one.
3. Nothing leaks either way: the foreign plan is neither read nor named nor acknowledged, and the
   plan actually rendered has its id on the screen.

The module note now has a section stating this explicitly, the line itself carries a pointer to it,
and — because a documented rule that nothing enforces is the shape this programme keeps recording —
a test pins it: the sole plan renders, `getEpisode` is called only for it, the foreign id appears
nowhere in the DOM, and no chooser is shown.

The validation itself is unchanged and never skipped: no `?plan=` value reaches a read without first
matching a plan in `plansForPatient`.

## Mutation ledger — round 1

Every attempt, including the one that produced no summary line. Presence in the tree was confirmed
with `git diff --stat` as a separate step before any test was run; never chained with `&&`.

| #     | Mutation                                                                       | Covering test          | Verdict                                                             |
| ----- | ------------------------------------------------------------------------------ | ---------------------- | ------------------------------------------------------------------- |
| R1-M1 | overview: revert to the suppressed-only predicate the review rejected          | patient-overview.dom   | **RED** `3 failed \| 20 passed (23)`                                |
| R1-M2 | model: classify `cancelled` as still to send                                   | patient-overview.dom   | **NO SUMMARY LINE — and that is the catch, not a miss** (see below) |
| R1-M3 | model: classify `missed` as still to send                                      | patient-overview.dom   | **RED** `1 failed \| 22 passed (23)`                                |
| R1-M4 | repository: count a still-to-send contact as already sent                      | patient-overview.dom   | **RED** `4 failed \| 19 passed (23)`                                |
| R1-M5 | overview: explain only suppression, leaving a cancelled row bare (the M5 half) | patient-overview.dom   | **RED** `3 failed \| 20 passed (23)`                                |
| R1-M6 | overview: claim a still-running plan ended when a message is cancelled         | patient-overview.dom   | **RED** `1 failed \| 22 passed (23)`                                |
| R1-M7 | overview: restore the future-tense sentence for a plan with nothing to send    | patient-overview.dom   | **RED** `2 failed \| 21 passed (23)`                                |
| R1-M8 | directory: link the row at a wrong-but-well-formed patient route (M6's pin)    | patients-directory.dom | **RED** `1 failed \| 31 passed (32)`                                |
| R1-M9 | page: let `?plan=` fall through to the chooser with one plan (M7's pin)        | patient-overview.dom   | **RED** `1 failed \| 22 passed (23)`                                |

**R1-M2 needs its own sentence, because "no summary line" normally means a gate did not run and here
it means something better.** I reproduced it in isolation rather than assuming. Classifying
`cancelled` as `stillToSend` contradicts `TERMINAL_CONTACT_STATES`, so `model.ts`'s load-time
consistency loop throws while the module is being imported:

> `Error: caring-contacts model: terminal contact state cancelled is classified as still to send`

The suite reports `Tests no tests` because nothing could be imported. That is the assertion working
as designed — the mutation cannot reach a test, because a build carrying it does not start — and it
is a stronger outcome than a red test. It is recorded as what it is rather than as a RED, because
"no summary line" and "the gate proved something" must never be allowed to look alike in a ledger.
R1-M3 is the control: `missed` is not in `TERMINAL_CONTACT_STATES`, so that mutation loads cleanly
and is caught by an ordinary red test rather than by the guard.

## Addition to round 1 — the mobile number is shown (owner decision)

My Concern 4 withheld the patient's mobile number and flagged the choice rather than deciding it
silently. The reviewer recommended leaving it hidden; **the owner overruled that and it is now
shown.** Commit `7e6da48b8`. (That SHA was written from memory in the first draft of this
section and was wrong; it is read from `git log` here. A commit id is evidence, and evidence
is not recalled.)

**I checked for a guard before building it, as instructed, and none objects.** Two things in the
tree look like they might and do not:

- `audit.ts`'s `AU_MOBILE_NUMBER_PATTERN` and `assertAuditEventFreeOfPatientData` bind **audit
  events** — they stop a number reaching the trail. Nothing on this path writes one to an event; the
  episode read records `{ view, episode, <planId> }` and no field of it can carry a number.
- `caring-contact-mockups.dom.test.tsx`'s "prohibition on echoing a patient mobile number" binds
  **patient-visible message copy** — the outgoing SMS and the automated reply. A clinician screen is
  not that surface.

No de-identification guard, no snapshot, and no static scan over number-shaped strings applies to
components. So there was nothing to work around and nothing to report back as a conflict.

**What was built, against each requirement:**

- **On the identity strip, beside the name.** It sits immediately under the synthetic identifier,
  inside the same identity section as the heading — not in a detail row further down.
- **From the `Episode` already in hand.** No read was added and none widened. The module note now
  states that the licence does not travel: `listPatientNames`'s two-field return type structurally
  cannot carry a number, and no other surface calls `getEpisode`.
- **The cleared case says which it is.** A retention clearance blanks the field, so a blank prints
  `Mobile number: no number held for this episode` rather than an empty-looking gap. The no-name
  notice was also corrected — it now says no number is held either, since the clearance empties both
  and the notice previously described only the name.
- **Labelled synthetic in place**, in the screen's own voice: `— invented, and nothing in this
workspace is ever sent to it`. Checked against `CARING_CONTACTS_PROHIBITED_LANGUAGE`; the wording
  avoids it, and the full suite's vocabulary scan passes.
- **Text, never a `tel:` link**, and not a control, so no tap floor applies. Design tokens only; no
  hex.

**Coverage:** three tests — the number renders for a plan that holds one and carries its synthetic
label; a cleared plan says "no number held" and does not render the number; and nothing on the page
is a `tel:` link.

## Not this round

The owner has approved storing the first-contact reason, which closes Ruling 96's gap. It needs a
column, a migration and both stores, and is its own task. **I have not started it**, and the round-1
text above still describes the gap as it stands in this branch.

## Gates — round 1

Every gate below actually ran and printed its own summary. Two lock refusals happened and neither is
reported as a result.

| Gate                | Result                                                                    |
| ------------------- | ------------------------------------------------------------------------- |
| `npm run test`      | `Tests  10019 passed \| 74 skipped (10093)` (830 files passed, 3 skipped) |
| `npm run typecheck` | exit 0, `[gate-receipts] recorded a pass for "typecheck:internal"`        |
| `npm run lint`      | exit 0, `--max-warnings 0`, `recorded a pass for "lint:internal"`         |
| `prettier --check`  | clean on every changed file                                               |

**Two lock refusals, handled rather than reported as outcomes.** The first was mine: a foreground
`npm run test` exceeded a tool timeout, the wrapper was detached but its vitest child kept running
and kept the lease, and my next run was refused with `Another Database heavyweight command is
active`. I confirmed the PID was genuinely alive (and had a live vitest child, 467 MB and growing)
before touching anything, then terminated **my own** orphaned run — releasing my lease, not forcing
past somebody else's — and the retry acquired cleanly.

The second was another worktree's: `npm run typecheck` returned
`DATABASE_HEAVY_RUN_ADMISSION_BUSY`, naming `D:\Worktrees\Database\care-plan-impl` running
Playwright. I retried on a 60-second interval and it passed on the fourth attempt. Nothing was
forced. Worth noting for the ledger: that refusal is emitted with the command's output piped, so
`echo "TYPECHECK-EXIT:$?"` after a pipe reported **0** for a gate that never ran — the exit-code
masking trap. The retry loop captures the output and inspects the real exit code instead.

## Mutation ledger — round 1, the mobile-number addition

| #       | Mutation                                                               | Covering test        | Verdict                                                                                                         |
| ------- | ---------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------- |
| R1-M10  | overview: always print "no number held", never the number              | patient-overview.dom | **RED** `1 failed \| 24 passed (25)`                                                                            |
| R1-M11  | overview: mislabel the number's row as "Cultural identity"             | patient-overview.dom | **RED** `2 failed \| 23 passed (25)`                                                                            |
| R1-M12  | overview: replace the synthetic label with "ready to receive messages" | patient-overview.dom | **ANCHOR NEVER MATCHED** — Prettier had reflowed the JSX after I wrote the mutation against the pre-format text |
| R1-M12b | the same mutation, re-anchored against the formatted source            | patient-overview.dom | **RED** `1 failed \| 24 passed (25)`                                                                            |

**R1-M12 is recorded rather than quietly replaced by R1-M12b**, because the run it produced is the
dangerous kind: the anchor did not match, the tree was therefore unmutated, and the suite printed
`Tests 25 passed (25)`. Read carelessly that is a green line under a mutation heading — a
mutation "surviving" a gate it was never in. The presence check (`git diff --stat`, run as its own
step) is what separated the two, and it is why that check exists.
