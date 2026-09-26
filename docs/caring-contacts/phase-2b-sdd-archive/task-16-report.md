# Task 16 report — the template detail record, dual approval, and this group's overlays

**Branch:** `claude/caring-contacts-demo-seed` · **Worktree:** `D:\Worktrees\Database\cc-templates`
**Status:** complete. Nothing pushed, no pull request opened, no subagent dispatched.

## Commits

Every SHA below was re-checked with `git cat-file -e <sha>^{commit}` after the last commit.

| SHA         | What it is                                                                       |
| ----------- | -------------------------------------------------------------------------------- |
| `6a44f38ba` | the page, the detail component, the row link, the exit-only trigger, docs, gates |
| `5cfe17983` | both test files                                                                  |
| `f9c2b2761` | Prettier over every file this task touched                                       |
| _(below)_   | this report                                                                      |

HEAD before this report: `f9c2b27612848e43d2ad112db57553e25387a97a`.

## What was built

`/caring-contacts/templates/[pathwayId]` — a Server Component page and one Server Component record
(`src/components/caring-contacts/workspace/template-detail.tsx`). Two client controls sit beneath it,
both of them the workspace's own overlay triggers.

The record carries: the version identifier; the lifecycle chip and the exact recorded state beneath it;
publication and retirement as recorded facts; the cadence the snapshot holds; **dual approval, seat by
seat, with the qualification the record's own provenance carries**; **the wording the record holds**;
what a patient who replies is told; and whether a new plan may be started on it.

The templates library's rows gained `<Link href={pathwayRoute(version.id)}>` in the same change
(Ruling 89), and seven wording helpers were exported from `templates-library.tsx` rather than copied.

## The decision most worth contesting: this screen SHOWS the wording

The brief points two ways at once, and I want the disagreement visible rather than resolved silently.

It says **"Read the wording from the sealed domain and render what it gives you"**, **"never assemble a
greeting yourself"**, and **"if the preview needs a name you do not have, that is a finding"** — all of
which presuppose wording being rendered. It also says **"Do not render a per-version message body you do
not have"** and, in the verification list, **"the specimen never renders as this patient's message"** —
which read as an absence.

I resolved it toward rendering, on four grounds:

1. **The approved design settles it.** `src/components/caring-contacts/mockups/product-ui.tsx`'s
   `MessagePreviewCard` renders `EXACT_PATIENT_VISIBLE_MESSAGE` verbatim in a blockquote headed "Exact
   patient-visible message", and `product-pages.tsx` puts that card on the **templates detail** screen,
   with the `message-preview` overlay raised from it. The standing discipline's rule is that where the
   design and the types disagree the types win — and here they **agree**:
   `PathwayVersionSnapshot.messageTextByType` holds the string, and the seed writes it.
2. **The qualifier in the brief's own sentence.** "Never renders as **this patient's message**." There is
   no patient on this screen. What renders is the record's own contents, framed as such.
3. **A governance record viewer that withholds the record's contents describes a record nobody can
   check.** The library is a list and says what each record holds; the detail is a record and shows it.
   That is the difference between the two screens, not a disagreement between them.
4. **What is rendered is `snapshot.messageTextByType[type]`, not the specimen by name.** Nothing in the
   screen references `EXACT_PATIENT_VISIBLE_MESSAGE`, slices it, matches it, interpolates into it or
   completes it, and no greeting is assembled anywhere. Task P's first-name slot therefore renders
   correctly the day it lands, with no edit here. A record holding nothing renders nothing and says so.

**If the controller wanted the absence, this is the one thing to reverse, and it is one component.** The
falsifiable pair is written the other way round from Task 15's on purpose: the page test requires
`EXACT_PATIENT_VISIBLE_MESSAGE` to be **present, exactly once, inside the quotation that names it**, and
mutation M7 (the read replaced by `""`) takes both that and the component case down.

Two claims and no more are made about it, and both are asserted: the wording is what **this record**
holds, and only one patient-visible message has been approved anywhere, a **specimen** — so another
version would hold the same wording rather than wording of its own. Then: _"Nothing below is addressed to
anybody, and nothing in this workspace is ever sent to any number."_ Mutation M10 removes that sentence
and two cases go red.

## The governance claim

`DualApprovalRecord` resolves the approvals **and** their qualification in one component. There is no
path through it that names a seat without having asked `pathwayVersionProvenanceWording` for the
qualification — the same single-component rule the library follows, and for the same reason.

Two things it does that the library's `ApprovalRecord` does not, because a detail screen can:

- **Seats come from `REQUIRED_PATHWAY_APPROVAL_ROLES`, not from the approvals the record carries.** A
  missing seat is a visible row saying "Not recorded on this version" rather than a silence. M5 swaps the
  source and the case goes red.
- **"Two approvals must mean two different people" is derived from the record, never assumed from the
  state.** `applyPathwayVersionTransition` guarantees it at transition time; this screen reads a record
  back through the same unchecked cast everything else here allows for, and a dual approval one person
  gave twice is the exact failure this surface reports on. M4 asserts it instead of deriving it, red.

`provenance` is taken as `string | null | undefined`, so an unrecognised value reaches the resolver's
structural fallback. **The fallback branch itself was mutated** (M1 → `null`, M2 → `""`), as the brief
required; both went red across the detail suite and the library's.

The asymmetry is pinned in both directions and separately: **absent → no qualifier** (M3 flips the render
guard from `=== null` to `=== undefined` and the absent case goes red), **unrecognised → the weakening
wording**, including the inherited-key case `"constructor"`.

No raw role identifier and no actor identifier reaches the screen. M6 renders the approving actor beside
the seat and the case goes red naming `clinicalProgrammeLead`.

## Design correction #2 — the reply-handling copy

`PATIENT_VISIBLE_NO_REPLY_NOTICE` and `AUTOMATED_REPLY_RESPONSE` are read from `message-copy.ts` and
rendered; the production spec's older §2.1 text is not implemented anywhere. The assertion with teeth is
the **absence** of the two sentences the owner's decisions A2/A3 replaced — a screen that had frozen
either into its own source goes red (M11, M12), where an assertion that the current strings are present
would still pass if the module were edited.

The section may not claim anything is currently sent: the automated response is a design contract on a
sender that does not exist. The screen says _"No sender is connected to this workspace, so nothing is
sent from here and nothing arrives here."_

## The two overlays, and where each is offered

**`message-preview`** — confirmed `mutatesState: false` in the frozen table before anything was built on
it, and the suite asserts that premise so a table change fails there rather than looking like a screen
defect. Raised through the new `ExitOnlyOverlayTrigger`, on a **current** version whose record holds
wording. Offering it over a record holding none would open a preview of nothing (M16, red).

**`template-changed-retired`** — `mutatesState: true`, raised through the ordinary
`WorkspaceOverlayTrigger` with `{ kind: "unavailable", reason }` written in the screen's own words: no
control anywhere in this workspace moves a plan onto a different version. M14 replaces it with a no-op
`record` commit and the aria-disabled case goes red.

**It is offered only on a RETIRED version, and this is the one place the screen departs from the approved
mockup.** The mockup offers it for everything that is not current; the row's frozen summary says the
template "was retired after this draft was opened", which is a false sentence over a version nobody has
approved, let alone retired. A pending version gets the plain statement instead. M15 restores the
mockup's shape and the case goes red.

## `ExitOnlyOverlayTrigger` — a finding first, then what I built

**The brief says "Task 10 built it and its reasoning is in the module." It does not exist in this tree.**
`grep -rniE "exit.?only|exitOnly"` over `src`, `tests` and `docs/caring-contacts` matches the brief and
nothing else, and no screen in the workspace has ever raised a non-recording overlay —
`plan-wizard.tsx`'s `final-activation` is the only `WorkspaceOverlayTrigger` call site. I built it rather
than blocking, and it is the smallest thing that satisfies the brief's own instruction ("not a no-op").

It stages **nothing**, which is the shape that is already correct: `commitRefusalFor(null)` answers
`NO_STAGED_COMMIT_REASON` with `scope: "recording-rows-only"`, and the host withholds a recording-only
refusal from a row that records nothing (Ruling 90). The eight-row loop in
`caring-contacts-overlay-trigger.dom.test.tsx` already proves that behaviour; this component makes it
reachable from a control. It throws at render for a mutating row, reading `mutatesState` off the frozen
table rather than a second list of ids — so Task 14's narrowing of the id union cannot disagree with it.

`workspace-overlays.ts` says `openWorkspaceOverlay` is "deliberately NOT the trigger's route". That
sentence is about the trigger whose contract is that a commit travels with the opening. Here there is no
commit to travel, and the absence is the correct value rather than a missing one. M13 makes the exit-only
trigger stage an `unavailable` commit instead, and the preview's way out is refused — red.

## Ruling [46] — no new `AccessedObjectType` member, and why that IS the ruling followed

The read is `{ kind: "view", objectType: "pathwayVersion", objectId: <the version's id> }`.

Ruling 46's named defect is a type carrying reads of **different objects**. This screen releases a
pathway version, which is exactly what `pathwayVersion` names. What distinguishes this read from the
library's is the **objectId** — one named version against `"all"` — and the trail's query surface has no
`objectId` filter, which is precisely why a `pathwayVersionDetail` member would be the harm: it would
name a **screen** and split "who read this team's governed pathway versions, and when" across two values
that cannot be asked for together. Task 15 declined a member on the same reasoning and was upheld.

M18 records the read against `"all"` instead and three cases go red. The rider still stands: **screen
attribution needs a `surface`/`context` dimension, never a second `objectType`.**

## The URL segment is validated before anything is read, and that is a safety check

`isAccessObjectIdShape(pathwayId)` is checked **before the store, the actor and any audit event**. This
is not tidiness. `buildAccessAuditEvent` throws on an `objectId` that is not identifier-shaped, and
`access-audit.ts` states the consequence in as many words: a caller could make the audit event throw —
and so **switch off their own access record** — by typing a space. A segment that is not an identifier
names no version anywhere, so `notFound()`, with nothing read and nothing recorded.

A well-formed identifier this team does not hold is a **different fact** and gets a screen: the read is
made, recorded as `denied`, and the statement says the two indistinguishable causes cannot be told apart
here. M17 removes the check (the store is read for `"not an id"`, red) and M20 turns the not-held case
into `notFound()` (red) — the two together are the claim that the **shape** of the segment decides and
nothing else.

## The two gates the plan does not name

**`checkAdoptionManifest` is a census.** All three steps are in `6a44f38ba`: the route joins the
`caring-contacts-workspace` surface in `docs/design-system/adoption-contract.json`,
`npm run design-system:adoption:update` regenerated the manifest and `ADOPTION.md`, and the route-count
assertion moved from 85 to 86 while stating what the eighth Caring Contacts screen is. Mutation M28
removes the contract entry, regenerates, and `design-system-adoption.test.ts` goes red with
`production page route is undeclared: src/app/caring-contacts/templates/[pathwayId]/page.tsx`.

**And the mistake Task 15 made there is not repeated.** The browser block landed in the same change as
the contract entry, and the surface's `unverifiedProofNote` now records — in the file, where a reader
meets it — that the block covering this route has never been executed. That is Task 19's precedent
followed rather than re-derived.

**The dynamic-family reachability gate.** `/caring-contacts/templates/[pathwayId]` is registered in
`CARING_CONTACTS_DYNAMIC_ROUTE_BUILDERS` against `pathwayRoute`, and the library's row renders the link.
M21 replaces that href and `route-reachability.test.ts` goes red naming the orphan.

**The silenced-gate guard.** The `WORKSPACE_SCREENS` entry and the browser block landed together. M27
drops the entry and `caring-contacts-workspace-screens.test.ts` goes red naming the route.

## Verification

Every line below is pasted from the run, not summarised. Worktree clean at the time of the run,
`GATE_RECEIPTS=refresh`, re-run after the final code edit.

```
WORKTREE-CLEAN
 Test Files  27 passed (27)
      Tests  566 passed (566)
```

**Typecheck** (`npx tsc --noEmit -p tsconfig.json`): `TSC-EXIT=0`.

**Uncached lint** (`node_modules/.cache/eslint` removed first, then `npx eslint <changed paths>`):
`ESLINT-EXIT=0`.

**Prettier** over every file this task changed, including this report: the line is in the closing block.

### Sensitivity controls for the two gates that print nothing on success

| Control | What was applied                                              | Result                                                                             |
| ------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| C1      | `const held: number = heldMessageTypes(...)` in the component | `TS2322: Type 'readonly MessageType[]' is not assignable to type 'number'`, EXIT=2 |
| C2      | `bg-[#ff0000]` on `cardHeadingClass`                          | `local/no-hardcoded-hex` fired at 112:26, `ESLINT-EXIT=1`                          |

C2 is the shape Task 15's C2b established: the rule matches Tailwind utilities of the form `bg-[#…]`,
not a bare hex constant, so the utility form is the one that proves lint reaches this file.

### Mutation ledger

Itemised, no aggregate total. Every mutation was applied and restored by a driver namespaced to this
worktree (`scratchpad/.../cc-detail-mutate.mjs`), which asserts `git diff --quiet` clean on **both** sides,
checks presence by reading the file in process rather than through a shell, refuses an anchor that
matches other than exactly once, and runs with `GATE_RECEIPTS=refresh`.

**Per mutation, only the suite(s) that mutation targets were run**, and the selection is in the table.
`detail` = `caring-contacts-template-detail.dom.test.tsx`, `page` = `…-template-detail-page.dom.test.tsx`,
`library` = `caring-contacts-templates-library.dom.test.tsx`, `trigger` =
`caring-contacts-overlay-trigger.dom.test.tsx`, `reach` = `route-reachability.test.ts`, `screens` =
`caring-contacts-workspace-screens.test.ts`, `adoption` = `design-system-adoption.test.ts`.

| #   | Mutation                                                           | Suites run            | Predicted                                          | Observed                                                                                                        |
| --- | ------------------------------------------------------------------ | --------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| M1  | domain provenance fallback → `null`                                | detail, page, library | testid absent; unrecognised + inherited red        | **RED as predicted.** 4 failed / 58 passed (62). `Unable to find an element by: [data-testid="…-provenance"]`   |
| M2  | domain provenance fallback → `""` (the sign-up defect's shape)     | detail, page, library | the element renders and says nothing               | **RED as predicted.** 4 failed / 58 passed (62). Library's own case: `expected '' not to be ''`                 |
| M3  | render guard `note === null` → `note === undefined`                | detail                | absent-provenance case red                         | **RED as predicted.** 1 failed / 25 passed (26). `expected <p …(2)>…(2)</p> to be null`                         |
| M4  | two-different-people asserted rather than derived                  | detail                | the same-person case red                           | **RED as predicted.** 1 failed / 25 passed (26)                                                                 |
| M5  | seats built from `approvals`, not the required-roles list          | detail                | missing-seat case red                              | **RED as predicted.** 1 failed / 25 passed (26). `to contain 'Not recorded on this version.'`                   |
| M6  | the approving actor's identifier rendered beside the seat          | detail                | the no-raw-identifier case red                     | **RED**, three cases — one more than predicted; see the note below                                              |
| M7  | `readWording` never reads the snapshot                             | detail, page          | the verbatim case red AND the seeded page case red | **RED as predicted.** 3 failed / 33 passed (36), including the seeded render                                    |
| M8  | `heldMessageTypes` drops `.trim() !== ""`                          | detail, page, library | empty strings count as held, across three screens  | **RED as predicted.** 5 failed / 57 passed (62), including the library's own held/unwritten case                |
| M9  | `heldMessageTypes` drops the `typeof` guard                        | detail, library       | a `TypeError` on the absent key                    | **RED as predicted.** `TypeError: Cannot read properties of undefined (reading 'trim')`                         |
| M10 | the "not addressed to anybody" framing removed                     | detail, page          | both wording cases red                             | **RED as predicted.** 2 failed / 34 passed (36)                                                                 |
| M11 | the superseded no-reply notice hardcoded                           | detail                | the superseded-absence case red                    | **RED as predicted.** 2 failed / 24 passed (26). `not to contain 'Replies are not received, stored, ana…'`      |
| M12 | the superseded storage claim hardcoded                             | detail                | the superseded-absence case red                    | **RED as predicted.** 2 failed / 24 passed (26). `not to contain 'has not been seen by anyone and has n…'`      |
| M13 | exit-only trigger stages an `unavailable` commit                   | detail, trigger       | the preview's exit is refused                      | **RED as predicted.** 1 failed / 52 passed (53). `the preview's way out was refused`                            |
| M14 | retirement overlay given a no-op `record` commit                   | detail                | the aria-disabled case red                         | **RED as predicted.** 1 failed / 25 passed (26)                                                                 |
| M15 | retirement overlay offered for everything not current              | detail                | the pending case red                               | **RED as predicted.** `Unable to find … role "note" and name "Not yet available for a new plan"`                |
| M16 | message preview offered over a record holding no wording           | detail                | the no-wording case red                            | **RED as predicted.** 1 failed / 25 passed (26)                                                                 |
| M17 | the identifier-shape check removed                                 | page                  | the store is read for `"not an id"`                | **RED as predicted.** `promise resolved "{ …(10) }" instead of rejecting`                                       |
| M18 | access objectId `pathwayId` → `"all"`                              | page                  | the identity case red                              | **RED**, three cases: identity, the denied read, and the auditor's. 3 failed / 7 passed (10)                    |
| M19 | capability computed as a constant, not from the actor              | page                  | the auditor case red                               | **RED as predicted.** `Unable to find … "Governed versions are not visible in this role"`                       |
| M20 | a not-held identifier becomes `notFound()`                         | page                  | the control case and the denied-read case red      | **RED as predicted.** 2 failed / 8 passed (10). `Error: NEXT_NOT_FOUND`                                         |
| M21 | the row's detail link points back at the library                   | reach, library        | reachability red naming the orphan                 | **RED as predicted.** `Orphan dynamic page route /caring-contacts/templates/[pathwayId]`                        |
| M22 | the not-held fact stated in the not-permitted fact's words         | detail                | the two-facts case red                             | **RED as predicted.** 1 failed / 25 passed (26)                                                                 |
| M23 | the identifier from the address echoed onto the screen             | detail                | the reflection case red                            | **RED as predicted.** `not to contain 'SYN-PATHWAY-REFLECTED'`                                                  |
| M24 | `bg-[#ff0000]` on a shared class — OVER-SENSITIVITY CONTROL        | detail                | vitest stays GREEN                                 | **GREEN as predicted.** 26 passed (26). Colour is not asserted by this suite; C2 above is where it is caught    |
| M25 | forced-colors fallback stripped from the wording quotation         | detail                | the forced-colors proxy red naming the BLOCKQUOTE  | **RED as predicted.** `BLOCKQUOTE draws a border with no forced-colors fallback`                                |
| M26 | `w-[400px]` on the retired notice, not on a wording card           | detail                | the 320px proxy red naming the DIV                 | **RED as predicted.** `a retired version with its lifecycle notice: DIV carries a fixed width`                  |
| M27 | the detail route dropped from `WORKSPACE_SCREENS`                  | screens               | the silenced-gate guard red                        | **RED as predicted.** `never visits these production workspace routes … /caring-contacts/templates/[pathwayId]` |
| M28 | the route removed from the adoption contract, manifest regenerated | adoption              | the census red naming the undeclared route         | **RED as predicted.** 3 failed / 51 passed (54). `production page route is undeclared: …/[pathwayId]/page.tsx`  |

**No row above is unrun, and there were no lock refusals in this round.** Every invocation produced a
summary line; the driver treats a run with no `Test Files` line as UNRUN and none occurred.

**M6 produced one more red than predicted, and the extra one is the useful part.** I predicted only the
raw-identifier case. Appending `by ${seat.approval.actorId}` to the recorded-day sentence also broke the
two `Recorded 2026-03-01 (AWST).` / `2026-03-02 (AWST).` assertions, because they are exact substrings
ending in a full stop. Foreseeable and under-predicted. Those two per-seat dates differ on purpose: a
screen reading one approval for both seats would print the same day twice.

**M18 produced three reds, also more than predicted.** With the objectId collapsed to `"all"`, every case
that names the version's own identifier in an expected access record fails, not only the identity case.
Foreseeable and under-predicted.

**M1's page suite passed, and that is not a gap.** The seeded record's provenance is `syntheticDemonstration`,
which the map recognises, so the fallback branch is never reached on that render. The fallback is proved
by the component suite's unrecognised and inherited-key cases; the page's provenance case proves the
recognised path end to end. Recorded rather than left to be discovered as a hole.

## Concerns and seams

### 1. `message-preview`'s frozen copy is wrong on this screen, and I shipped the control anyway

Its summary is _"The wording is shown exactly as it would arrive, with every detail already filled in."_
On this screen there is **no patient**, so no detail is filled in — this is exactly the case the brief
predicted ("if the preview needs a name you do not have, that is a finding to report"). Its decision text
is _"Back to personalisation"_, and there is no personalisation to go back to: that is the activation
wizard's stage, and the frozen row was clearly written for it.

I raised it anyway because the approved design places it on this exact screen and I may not edit frozen
copy. **The wording behind the overlay is real** — the card the trigger sits beside shows what the record
holds — so "the wording is shown" is true of the surface as a whole; "every detail already filled in" is
not, and "Back to personalisation" is not.

**This is the finding I would act on first.** It is a matrix question, not a screen one: either the row's
summary and decision need a second form for the governance context, or the overlay belongs only in the
wizard and the templates screen should raise nothing. I did not choose, because the matrix is frozen and
the choice is the owner's.

### 2. The record can say "approved" while the wording says it is not clinically approved

`message-copy.ts` opens _"PROVISIONAL — not clinically approved"_ and names the approval gate that owns
the final wording. A seeded version's record simultaneously says both seats approved it. Those are two
different objects — the pathway version, and the message text — and a coordinator reading this screen has
no way to see the second fact.

I did **not** put it on screen. Stating "this wording is not clinically approved" beside a record whose
provenance qualification already says nobody approved anything would be two overlapping claims, and on a
genuine record it would be a claim I cannot support from anything the record carries. But the gap is
real: **the version's approval and the wording's approval are not the same approval, and only one of them
is visible.** Worth a ruling.

### 3. The exit-only trigger did not exist, and one non-recording row now has a home

Reported in full above. Beyond the missing component, the broader fact is that **seven of the eight
non-recording rows are still raised from no control anywhere** — they are reachable only by address, and
`overlay-trigger.dom.test.tsx` proves their exits stay live in that state. This screen is the first
control-raised one.

### 4. The browser block is written and has never been run

`test.describe("caring-contacts template detail")` sits after the templates library block and is modelled
on it: the nothing-held statement as a page with a 200 and the `h1`, the way back to the library clicked
and landing, 320px with the width-state markers and the tap floor measured, dark against this screen's
own surface rather than shell chrome, forced colours reading a computed border, and print.

**I cannot run Playwright from this worktree.** The block is typechecked, linted, and parsed by
`caring-contacts-workspace-screens.test.ts`, and nothing more — it is a mechanism I have not seen run.
That is stated in the adoption contract's `unverifiedProofNote` as well as here.

Two limits the block itself records rather than papering over:

- **Reachability is proved from the record BACK to the library, not from a row forward.** This server's
  library holds no rows to click, because `demoSeedRequested()` excludes it. The row's link is proved
  offline and the family's inbound link is proved statically by `route-reachability.test.ts`.
- **The malformed-segment refusal is deliberately not asserted in the browser.** A `notFound()` reached
  during a render that streams under `loading.tsx` arrives as content after the headers are flushed, so a
  status assertion would not be measuring what it appears to. It is proved offline, where the call itself
  is observable.

I did **not** turn the demo seed on for that server. Verified for myself rather than taken on trust:
`emptyStateColours` throws when the empty state is absent, so seeding would fail the dark-mode tests
rather than merely alter them.

### 5. Task 15's phone-reachability gap now reaches one route further

Templates is `hidden` below 768px and excluded from the phone dock, so there is no inbound link to
`/caring-contacts/templates` on a phone — and therefore none to this detail route either, since the only
link to it is a library row. Task 15 flagged this and declined to fix it because it is a shell decision;
that reasoning is unchanged, and the consequence is now one screen wider.

### 6. Files that will conflict, left for the controller as instructed

`package.json` (`test:cc-guards`), `tests/ui-caring-contacts-workspace.spec.ts`,
`tests/design-system-adoption.test.ts`, `tests/route-reachability.test.ts`, `docs/site-map.md`,
`scripts/generate-site-map.ts`, the three generated `docs/design-system/` artefacts, and
`src/components/caring-contacts/workspace/overlays/overlay-trigger.tsx` — that last one because **Task 14
is narrowing the overlay id union on another branch**. I deliberately did not narrow it; the exit-only
guard reads `mutatesState` off the frozen table, so the two changes compose rather than collide on
semantics, but they will collide on text.

`src/components/caring-contacts/workspace/templates-library.tsx` also changed: seven exports, the row
link, and two corrections to its module note. One of those corrections matters on its own — the note
claimed the specimen "has no name slot and cannot acquire one", which the owner's decision has made
false. It now says the shape is not settled and that no screen may learn it.

### 7. One thing I did not verify

I never ran the app. Everything here is offline evidence: unit and DOM tests, typecheck, lint, and static
reads of the markup. The screen has not been seen rendering in a browser by me.

---

**Closing verification, run after this report was written.** The report is the only file changed since
the block above, and no gate in `test:cc-guards` reads it, so the suite line is unchanged and that is
expected rather than stale — re-run anyway, on the committed tree:

```
 Test Files  27 passed (27)
      Tests  566 passed (566)
```

Prettier DOES read this file, and the check below covers it along with every other file this task
changed — `src/components/caring-contacts/workspace/template-detail.tsx`, `…/templates-library.tsx`,
`…/overlays/overlay-trigger.tsx`, `src/app/caring-contacts/templates/[pathwayId]/page.tsx`, both test
files, `tests/ui-caring-contacts-workspace.spec.ts`, `tests/route-reachability.test.ts`,
`tests/design-system-adoption.test.ts`, `scripts/generate-site-map.ts`, `docs/site-map.md`, the three
generated `docs/design-system/` artefacts, `package.json`, and this report:

```
Checking formatting...
All matched files use Prettier code style!
```

The regress this could become is worth naming, because the next person appending to a report will meet
it: a verification block quoting a run, then a run after the block, then a block quoting that run. The
line to draw is Task 15's — **an append of prose to a report cannot change what any gate reads**, so one
post-append Prettier run is enough, and this paragraph does not require another.
