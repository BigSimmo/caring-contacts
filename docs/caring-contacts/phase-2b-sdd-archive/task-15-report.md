# Task 15 report — the templates library

**Branch:** `claude/caring-contacts-demo-seed` · **Worktree:** `D:\Worktrees\Database\cc-templates`
**Status:** complete. Nothing pushed, no pull request opened, no subagent dispatched.

## Commits

Every SHA below was re-checked with `git cat-file -e <sha>^{commit}` after the last amend-free commit.

| SHA         | What it is                                                            |
| ----------- | --------------------------------------------------------------------- |
| `398745495` | the page, the library component, the nav link, both test files, docs  |
| `6e6893b06` | declares the route on the `caring-contacts-workspace` design surface  |
| `c9e8a0d9c` | pins both filtered empty states to one lifecycle filter (mutation M7) |
| `26f8a8e95` | static proxies for the forced-colors and 320px proofs                 |
| `f074a4a8d` | makes the forced-colors check examine a version row (mutation M17)    |

Full HEAD: `f074a4a8ddeed6ccd79eff06933ffc7903b40e94`.

## What was built

`/caring-contacts/templates` — a Server Component page and one Server Component library
(`src/components/caring-contacts/workspace/templates-library.tsx`). The screen adds no client
component of its own.

Each row is one governed pathway version and carries: the version identifier; a lifecycle chip
(Current / Pending / Retired, words plus an icon, never colour alone); the exact recorded state in
plain words beneath it; publication as a recorded fact; retirement as a recorded fact including what
the urgency means for plans already running; the cadence the snapshot holds; which of the three
message types the record holds wording for and which are unwritten; and the approvals with their
provenance qualification.

A URL filter (`?lifecycle=current|pending|retired`) narrows the list server-side. An unrecognised or
repeated value widens to "all" rather than throwing.

The Templates rail destination gained `href: CARING_CONTACTS_ROUTES.templates` in the same change
(Ruling 89), and each row of the shell's destination table now says in a comment which task built
its screen, so the table states that per row instead of a list elsewhere going stale.

## The governance claim

`ApprovalRecord` resolves the approvals **and** their qualification in one component. There is no
path through it that prints "Approved by …" without having asked `pathwayVersionProvenanceWording`
for its qualification — the two are not siblings a later edit could separate, which is how the
sign-up defect became possible. It takes `provenance` as `string | null | undefined` rather than as
the narrow union, deliberately: the Postgres store casts the stored snapshot with an unchecked `as`,
so the type at that call site is a claim about what should be there, and widening it means an
unrecognised value reaches the resolver's structural fallback instead of being assumed away.

The resolution happens in the component rather than on the page — a deliberate departure from
`plans/new/page.tsx`, which resolves on the page because the wizard beneath it is a Client
Component. This screen has no client boundary, so both domain modules stay on the server either way,
and resolving in the component is what makes the fail-safe directly testable: a test can hand it a
version carrying a provenance value no fixture produces and watch the weakening claim appear.

`PATHWAY_APPROVAL_ROLE_WORDING` is imported, never copied. No role identifier is rendered.

## Message wording — what the screen says, and one place the brief does not match the tree

The screen shows no message wording, and a fixture marker string proves it: `messageTextByType`
carries `MESSAGE-BODY-THAT-MUST-NEVER-RENDER` and the assertion requires it never to reach the
document.

**Finding.** The brief says "the message-content column is empty and no row exists anywhere". That
is true of the Postgres column. It is **not** true of the running demo: `demo-seed.ts`'s
`pathwaySnapshot` writes `EXACT_PATIENT_VISIBLE_MESSAGE` into `snapshot.messageTextByType.standard`
and leaves `first` and `closing` empty strings, with the seed's own note explaining that an empty
string is the truthful representation of "not yet written". So a seeded version's record does hold
wording for one message type.

A screen-level sentence saying "message content is not yet authored" would therefore have been false
against the seeded record. Each row instead states what its own record holds — "Wording is held for
the standard message. Nothing has been written for the first message and the closing message." —
derived from the snapshot, showing none of the text. Ruling [127]'s point is stated once at the top
of the section instead: no version holds wording of its own.

The held/unwritten test uses `typeof stored === "string" && stored.trim() !== ""` rather than
truthiness, and that is load-bearing rather than habit: the same unchecked cast means a key absent
from the stored object arrives as `undefined` with the type saying it cannot. Absent and empty both
fall to the unwritten side, which is the direction that cannot overstate what a record holds.

## Ruling [46] — no new `AccessedObjectType` member, and why that IS the ruling followed

The brief says to add a member rather than overload one. I reused the existing `pathwayVersion`, and
this is the decision most worth contesting if you disagree with it, so the reasoning is here in full.

The read is `{ kind: "view", objectType: "pathwayVersion", objectId: "all" }` — byte for byte the
identity `api/caring-contacts/pathway-versions/route.ts`'s `GET` records, and the one
`plans/new/page.tsx` already reuses. The brief's own instruction is that a page read uses the same
access identity the API side uses; those two instructions point the same way only if this read is
not a different kind of thing.

Ruling 46's named defect is a type carrying reads of **different objects**: `patientDirectory` held
two referral reads, so recording a patient-name read against it would have been visible by eye and
unaskable, because the trail's query surface filters on `objectType` with no `objectId` filter at
all. This read releases the same objects, at the same sensitivity, through the same repository
method as the wizard's read. A `pathwayVersionLibrary` member would name a **screen**, not an
object, and would split the answer to "who read this team's governed pathway versions, and when"
across two values that cannot be asked for together — which is the harm Ruling 46 exists to prevent,
arriving from the other direction.

Consequence: the `z.enum` in `access-trail/route.ts` needed no change, so Task 12's pin was not
exercised by this task.

## Four empty facts, and one that is not emptiness

`ListEmptyState` carries three of them: nothing exists; a filter is hiding records; the acting role
may not read a version at all (`listPathwayVersions` answers such an actor with `[]`, exactly as it
answers a team holding nothing, so the capability is decided on the page from the actor through
`PATHWAY_VERSION_READ_ACTIONS` itself — the same any-of list the store asks — and never inferred
from an empty list).

The fourth is a filtered-empty list where **every** held version is retired. It gets its own
`because` and, more importantly, its own `changedBy`: clearing the filter reveals the retired
records and still leaves nothing a plan can be started on, so "clear the filter" would be a
misdirection. A new version has to be written and approved by two people, and no control on this
screen does that.

The fact that is **not** an empty list at all is stated above a **full** one: when every held
version is retired, a `role="note"` says no version is available for a new plan. That is what those
rows add up to and no single row says it. `plans/new` offers only `approved` versions, so with every
version retired a coordinator would otherwise discover this only after walking into the sign-up.

## Verification

Every line below is pasted from the run, not summarised. Suite: `npm run test:cc-guards`, 22 files,
worktree `cc-templates`.

**Final state of the tree (re-run after the last edit, not merely last in order):**

```
WORKTREE-CLEAN
 Test Files  22 passed (22)
      Tests  457 passed (457)
```

**Typecheck** (`npx tsc --noEmit -p tsconfig.json`): `TSC-EXIT=0`.

**Uncached lint** (`node_modules/.cache/eslint` removed first, then `npx eslint <changed paths>`):
`ESLINT-EXIT=0`.

**Prettier** on every file this task changed: `All matched files use Prettier code style!`

### Sensitivity controls for the two gates that print nothing on success

A clean typecheck and a clean lint both print nothing, which reads exactly like a command that never
examined the file.

| Control | What was applied                                              | Result                                                                             |
| ------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| C1      | `const held: number = heldMessageTypes(...)` in the component | `TS2322: Type 'readonly MessageType[]' is not assignable to type 'number'`, EXIT=2 |
| C2a     | a bare `const … = "#ff0000"` in the component                 | `ESLINT-EXIT=0` — **my control was wrong, not the rule**                           |
| C2b     | `bg-[#ff0000]` on the filter-chip class                       | `local/no-hardcoded-hex` fired at 198:3, `ESLINT-EXIT=1`                           |

C2a is recorded rather than dropped: `no-hardcoded-hex` matches only Tailwind utilities of the shape
`bg-[#…]` / `text-[#…]` / `border-[#…]`, so a bare hex constant is outside its stated scope. The
rule behaved correctly; the control did not, and re-running it in the right shape is what proved the
lint run reaches this file.

### Mutation ledger

Itemised, no aggregate total. Every row records the tree it ran against by test count — 455 before
the two static-proxy assertions landed, 457 after — because a result that does not name itself
cannot be attributed. All mutations were applied and restored by a driver namespaced to this
worktree (`scratchpad/cc-templates/cc-templates-mutation-driver.mjs`), which asserts
`git diff --quiet` clean on both sides, checks mutation presence by reading the file in process
rather than through a shell, and runs the gate with `GATE_RECEIPTS=refresh`.

| #   | Mutation                                                               | Predicted                                              | Observed                                                                                                         |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| M1  | domain fallback → `null`                                               | testid absent; unrecognised + inherited-key cases red  | **RED as predicted.** 4 failed / 453 passed (457). `Unable to find an element by: [data-testid=…provenance]`     |
| M2  | domain fallback → `""` (the sign-up defect shape exactly)              | `expected '' not to be ''`                             | **RED as predicted.** 4 failed / 453 passed (457). The element renders and says nothing                          |
| M3  | render guard `note === null` → `note === undefined`                    | absent-provenance case red: queryByTestId not null     | **RED as predicted.** 1 failed / 454 passed (455). `expected <span …> to be null`                                |
| M4  | the qualification never rendered at all                                | component AND page seeded cases red                    | **RED as predicted.** 4 failed / 453 passed (457), including the page's seeded-record case                       |
| M5a | all-retired empty state's REASON → the ordinary one                    | `toContain('every version … has been retired')` fails  | **RED as predicted.** 1 failed / 454 passed (455)                                                                |
| M5b | all-retired empty state's REMEDY → the ordinary one                    | `toContain('It does not make one available…')` fails   | **RED as predicted.** 1 failed / 454 passed (455)                                                                |
| M6  | `if (everyHeldVersionRetired)` → `if (!everyHeldVersionRetired)`       | both content cases red; **pairwise stays GREEN**       | **As predicted, including the green.** 2 failed / 453 passed (455) — see the note below                          |
| M7  | all-retired empty state collapsed into the ordinary one, word for word | pairwise case red                                      | **GREEN on the first run — a mismatch, and a real defect in my test.** RED after the fixture fix (`c9e8a0d9c`)   |
| M8  | `held.every(...)` → `held.some(...)`                                   | the "does not claim every version is retired" case red | **RED**, plus one more than predicted: the ordinary-filtered case also flipped. 2 failed / 453 passed (455)      |
| M9  | held-wording check drops `.trim() !== ""`                              | all three message types read as held                   | **RED as predicted.** 1 failed / 454 passed (455)                                                                |
| M10 | held-wording check drops the `typeof` guard                            | a `TypeError` on the missing key                       | **RED as predicted.** `TypeError: Cannot read properties of undefined (reading 'trim')`                          |
| M11 | row prints `messageTextByType[type]` instead of the plain-words name   | the marker string reaches the document                 | **RED as predicted.** `expected … not to contain 'MESSAGE-BODY-THAT-MUST-NEVER-RENDER'`. 2 failed / 453 (455)    |
| M12 | page's access identity `pathwayVersion` → `report`                     | the two identity cases red                             | **RED**, three cases: the allowed-empty read, the identity case, and the failed-read attempt. 3 failed / 452     |
| M13 | capability computed as a constant rather than from the actor           | the auditor case red                                   | **RED as predicted.** The not-permitted group is absent. 1 failed / 454 passed (455)                             |
| M14 | `released == null` → `released === undefined`                          | a `TypeError`, not `/returned no list/`                | **RED, message mismatched** — `promise resolved instead of rejecting`. See the note below                        |
| M15 | the shell's `href` for Templates removed                               | shell cases red AND route-reachability red             | **RED as predicted.** 4 failed / 451 passed (455), including `Orphan page route(s) … /caring-contacts/templates` |
| M16 | a bare hex constant, as an over-sensitivity control                    | vitest stays GREEN                                     | **GREEN as predicted.** 22 files / 455 passed. Colour is not asserted by this suite                              |
| M17 | forced-colors fallback stripped from the version row                   | the forced-colors case red                             | **GREEN on the first run — a mismatch, and a real defect in my test.** RED after the fixture fix (`f074a4a8d`)   |
| M18 | `w-[400px]` added to the version row                                   | the fixed-width case red                               | **RED as predicted.** `LI carries a fixed width: expected 'w-[400px] …' not to match /\b(min-)?w-\[[0-9]/`       |

**Lock refusals, recorded as neither pass nor failure.** M1 was refused twice, M7 once, M10 once and
M2 once, each time by another worktree's exclusive lease (`Database focused-test capacity is full`,
owner in `browser-test-gate-handoff-d5c1db`). The driver detects the refusal and reports UNRUN with
its verdict line rather than counting it as a red. Every one was retried until it ran; **no row in
the ledger above is unrun.**

**M6 is the over-sensitivity control that matters.** It swapped the branch condition, so both
filtered empty states rendered the other's words — and the pairwise comparison stayed green while
both content assertions went red. That is the demonstration, on this screen's own code, of why
holding empty states only against each other is not coverage.

**M7 was a prediction mismatch, and the mismatch was the finding.** I predicted the pairwise
comparison would go red when the all-retired branch was overwritten with the ordinary one. It stayed
green. Every filtered empty state interpolates its own filter's label, and my two fixtures asked for
different filters (Pending and Current), so two branches now saying the same thing still rendered
different text. The pairwise check was appearing to carry weight it did not carry. Both fixtures now
ask for the same filter, so the label is no longer a source of difference; M7 then went red on
exactly the predicted message.

**M17 was the same shape and worse.** The forced-colors check rendered one library — a retired
version under a Pending filter, which is an empty list — so no row was in the document at all.
Stripping the fallback from the row left it green: the `bordered.length > 0` vacuity guard was
satisfied by the filter chips and the empty state, and the surface the mutation attacked was never
examined. A "there is something here" guard is not a guard that the right something is here. The
check now walks two scenarios, one required to contain a row.

**M14's message mismatched and the assertion still held.** I predicted a `TypeError` from
`versions.filter`; the page function instead **resolved**, returning an element carrying a `null`
prop that would throw during React's render rather than in the page function. The assertion — that
the page rejects — fired correctly. The guard is load-bearing; it fails _earlier and more legibly_
than the alternative rather than being the difference between failing and not.

**M8 produced one more red than predicted.** With `some` in place of `every`, a mixed library also
took the all-retired branch, so the ordinary-filtered case went red too. Foreseeable, and
under-predicted.

## Concerns and seams

### 1. Templates is unreachable on a phone. This is the one I would act on first.

The rail is `hidden` below 768px, `PHONE_DESTINATIONS` filters Templates out of the phone dock, and
the More panel lists only destinations that have no page. So below 768px there is now **no inbound
link to `/caring-contacts/templates` anywhere in the workspace.**

`tests/route-reachability.test.ts` passes, and correctly: it reads the shell's destination table,
which is a fact about what is linked, not about at what width. The exclusion was written when
Templates had no page and the phone bar carried three built destinations plus More.

I did not fix it. Either fix is a shell decision rather than a screen one — swapping what the phone
bar carries, or giving the More panel the ability to hold a real link — and `shell.tsx` is shared
with three live branches. Flagging it rather than choosing.

### 2. A gate the brief does not mention, which Task 16 will hit

`checkAdoptionManifest` is a **census**: a production page route that no design surface declares
fails `tests/design-system-adoption.test.ts`, which is inside `test:cc-guards`. Adding the page
turned that suite red with `production page route is undeclared`. The fix is three steps, all in
`6e6893b06`: add the route to the `caring-contacts-workspace` surface in
`docs/design-system/adoption-contract.json`, run `npm run design-system:adoption:update`, and update
the route-count assertion in `tests/design-system-adoption.test.ts`. Task 16 adds
`/caring-contacts/templates/[pathwayId]` and will need the same three steps.

### 3. The browser proof is owed, and I have not written it

`tests/ui-caring-contacts-workspace.spec.ts` gained `TEMPLATES_ROUTE` and a `WORKSPACE_SCREENS`
entry, because `tests/caring-contacts-workspace-screens.test.ts` requires every production workspace
route to appear there and goes red otherwise. **It has no proof block.** I did not write one: I
cannot run Playwright from this worktree, and an unrun browser block is worse than an absent one —
it would look like coverage. The spec's own constant says so in a comment, so the omission is stated
in the file rather than only here.

What it needs, if you want my reading: a `caring-contacts templates library` block that opens
`TEMPLATES_ROUTE` through `openWorkspace`, asserts the `h1` is `Templates`, and covers
forced-colors, 320px and the service-stop banner on this screen. On that server the screen renders
its empty state — `demoSeedRequested()` excludes the isolated Playwright server unless
`CARING_CONTACTS_DEMO_SEED=on` — which is a real production state, not a fixture. **Do not turn the
seed on for that server to get a populated screen**; the seed's own note explains that doing so
deletes the empty-caseload observations rather than adding one.

Offline, the two regressions that are mechanically visible in the markup are covered — a bordered
surface with no forced-colors fallback, and a fixed pixel width — and both are labelled in the test
file as static proxies. jsdom evaluates no media query and no forced-colors mode; they say nothing
about how the screen paints.

### 4. Seams left for Task 16

- `/caring-contacts/templates/[pathwayId]` — the detail route. `pathwayRoute(pathwayId)` already
  exists in `caring-contacts-routes.ts` and is unused; nothing on my screen links to it, because the
  destination does not exist yet (Ruling 89 in the direction it is usually forgotten). Adding that
  link belongs in the same change as that page. It will also need a
  `CARING_CONTACTS_DYNAMIC_ROUTE_BUILDERS` entry in `tests/route-reachability.test.ts`, which is
  mandatory rather than optional for a dynamic workspace family.
- The message-preview surface and the `message-preview` overlay — untouched.
- The `template-changed-retired` overlay — untouched. My all-retired notice is a plain `role="note"`
  above the list and deliberately does not open an overlay; if Task 16 wants that control there, the
  notice is the place to put it.
- Dual-approval controls — untouched. Nothing on this screen mutates anything; there is not one
  `<button>` in the library, only `<Link>`s.
- `TEMPLATE_LIFECYCLE_LABELS`, `TEMPLATE_LIFECYCLE_ORDER`, `templateLifecycleOf`,
  `parseTemplatesLibraryFilter` and `templatesLibraryHref` are exported for reuse by the detail
  screen, so the grouping is not re-derived there.

### 5. Files that will conflict, left for the controller as instructed

`src/components/caring-contacts/workspace/shell.tsx`, `package.json` (`test:cc-guards`),
`tests/caring-contacts-workspace-shell.dom.test.tsx`, `tests/ui-caring-contacts-workspace.spec.ts`,
`tests/design-system-adoption.test.ts`, `docs/codebase-index.md`, `docs/site-map.md`, and the three
generated `docs/design-system/` artefacts.

The shell test's expectations moved with the change: the rail's Templates entry is now a `link`, the
internal-href set gained `CARING_CONTACTS_ROUTES.templates`, and the exact unavailable-control count
went from 13 to 12. The floor assertion beneath it was left at 5 — it is written as a floor, the
exact count is asserted above it, and lowering a floor a change did not breach is loosening for its
own sake.

### 6. One thing I did not verify

I never ran the app. Everything here is offline evidence: unit and DOM tests, typecheck, lint, and
static reads of the markup. The screen has not been seen rendering in a browser by me.

---

# Review round 1 — what changed

Task 15 passed with two exceptions and five fixes. All five are done. This section is appended
rather than folded into the sections above, so the original claims and their corrections both stay
readable.

## Commits added this round

| SHA           | What it is                                                                     |
| ------------- | ------------------------------------------------------------------------------ |
| `2193dfd96`   | the templates browser block, three vacuity fixes, and the site-map description |
| _(this file)_ | the round-1 report append                                                      |

Both re-checked with `git cat-file -e <sha>^{commit}` after the last commit.

## 1. The browser block is written

The reviewer is right and my reasoning was half-correct in a way that made it wrong. I withheld the
proof block because an unrun block would read as coverage — and then added a contract entry that
reads as coverage more strongly, because `adoption-contract.json` records `status: "passed"` for
dark, forcedColours, compact320, print and browser on the `caring-contacts-workspace` surface,
citing this spec as sole evidence. My concerns 2 and 3 were not independent findings; together they
were one defect, and I reported them as two.

`test.describe("caring-contacts templates library")` now sits after the New-plan block and is
modelled on it:

- **serves an empty library as a page, and shows no message wording** — 200, the `h1`, the empty
  state's own words, and `await expect(page.locator("body")).not.toContainText(EXACT_PATIENT_VISIBLE_MESSAGE)`.
  That is Ruling [127] observed end to end in the one place the whole stack runs in a single
  process. It also asserts the filter offers all four links with `All` carrying `aria-current`;
- **is reachable from the workspace rail** — clicks the rail link at 1024 and checks the pathname;
- **does not blame a filter for a library that holds nothing** — clicks `Retired`, then requires the
  `no-data` group and requires the filtered group to have count 0. The four empty facts are held
  apart offline; this is the one this server can reach, and it is the one a bookmarked URL lands on;
- **320px**, **dark**, **forced colours**, **print** — the same four the other three screens carry,
  reading this screen's own surface through `emptyStateColours(page, "No governed versions yet")`
  rather than shell chrome, plus a filter chip's measured `boundingBox().height >= 48`.

The block's header records, where a reader will actually meet it, that reachability is proved at
1024 and **not** on a phone, why that is a gap rather than a choice, and why a phone test written
against the current dock would pin the gap in place instead of closing it.

**I have not run it.** I cannot run Playwright from this worktree, so the block is typechecked,
linted and parsed by `tests/caring-contacts-workspace-screens.test.ts`, and nothing more. It is a
mechanism I have not seen run.

## 2. M7 and M17 re-runs, with their messages

Both were re-run on the final tree (457 tests) and both went red on the predicted message.

**M7** — the all-retired empty state collapsed into the ordinary filtered one, word for word:

```
  Test Files  1 failed | 21 passed (22)
  Tests  2 failed | 455 passed (457)
  FAIL  |jsdom| … > holds all four apart from one another, so no two may collapse into the same words
  AssertionError: "filtered" and "all retired" render the same empty state: expected 'No version in this stateWhy: The life…' not to be 'No version in this stateWhy: The life…' // Object.is equality
  FAIL  |jsdom| … > says a library filtered to Current with everything retired is a different fact from a filter with records behind it
  AssertionError: expected 'No version in this stateWhy: The life…' to contain 'every version this team holds has bee…'
```

**M17** — the forced-colors fallback stripped from the version row:

```
  Test Files  1 failed | 21 passed (22)
  Tests  1 failed | 456 passed (457)
  FAIL  |jsdom| … > gives every bordered surface a forced-colors fallback, so none of them vanishes
  AssertionError: a version row: LI draws a border with no forced-colors fallback: expected 'min-w-0 rounded-[var(--radius-lg)] bo…' to contain 'forced-colors:border-[CanvasText]'
```

## 3. The vacuity the M17 fix left standing, and two more like it

The reviewer is right that the fix applied its own lesson to one scenario and not the other. Both
static proxies now walk **one** `surfaceScenarios` list, and every scenario carries its own
`present(container)` positive control naming the surface it exists to render — a version row for the
first, an empty state **and** `getByRole("note", { name: "No version is available for a new plan" })`
for the second. The 320px check walks the same list, so a fixed width on the empty state or the
notice is no longer outside what it reads.

Three new mutations prove the three new guards. Every one was predicted before it ran.

| #   | Mutation                                                 | Predicted                                                                | Observed                                                                                                                                                                                                            |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M19 | the all-retired notice never renders                     | both proxies red on the note's absence; **green before the round-2 fix** | **RED as predicted.** 3 failed / 454 passed (457). `Unable to find an accessible element with the role "note" and name "No version is available for a new plan"` — from both proxies and from the notice's own case |
| M20 | `w-[400px]` on the all-retired notice, not on a row      | the 320px proxy red naming the DIV; **outside the check before the fix** | **RED as predicted.** 1 failed / 456 passed (457). `an empty state and the all-retired notice: DIV carries a fixed width: expected 'w-[400px] flex min-w-0 flex-col gap-1…' not to match /\b(min-)?w-\[[0-9]/`      |
| M21 | the page reads a literal `[]` instead of the spied store | the privacy control red; **both absences would have passed without it**  | **RED as predicted.** 5 failed / 452 passed (457). `the page did not read the spied store — the absences below prove nothing: expected "listPathwayVersions" to be called at least once`                            |

M19 is the one worth reading twice: it is the exact regression the round-1 fix left reachable, and
it now takes down both proxies rather than passing through them.

## 4. Exception A — absent provenance, named rather than resolved silently

I resolved a contradiction on the one requirement the brief called safety-relevant without saying
so. That was wrong of me, and the correction matters more than the omission, so here is the
distinction the brief conflated:

- **Absent** provenance means **no claim was made**. `pathwayVersionProvenanceWording` returns `null`
  and the screen renders no qualifier. Stamping "Invented for demonstration: no person recorded
  either approval…" onto a record whose provenance says nothing would be a **false statement about a
  possibly genuine record** — the marker is documented as weakening-only, and absence asserting
  nothing is the whole of what "weakening-only" means.
- **Unrecognised** provenance means **a claim this build cannot read**. That must fail safe to the
  weakening wording, because the safe reading of "I do not know what this says" is never "it says
  nothing", and every value the field can hold is a weakening claim.

The brief said "an absent **or** unrecognised provenance must resolve to the synthetic wording". The
domain does not, and the domain is right. My screen follows the domain, and
`tests/caring-contacts-templates-library.dom.test.tsx` pins both halves separately: "claims nothing
about provenance when the record claims nothing" (asserting the qualifier element is **absent**, not
that it is empty) and the three unrecognised cases. Mutation M3 proves the first — flipping the
render guard from `note === null` to `note === undefined` makes the absent case render an empty
qualifier, and the assertion fires with `expected <span …> to be null`.

The reason for stating it rather than quietly complying: a later reader holding the brief and not
the domain would read the screen as under-qualifying, and "fix" it toward the false direction.

## 5. The three small ones

**Positive controls on two absence assertions.**
`templates-page.dom.test.tsx`'s privacy assertion now spies `listPathwayVersions` and requires it to
have been called, plus requires the empty state to be in the document, before asserting `getEpisode`
and `listPatientNames` were not. This is the privacy claim this screen makes, so it now carries its
own proof that the spied store is the one the page used; M21 above is that guard failing on demand.
`templates-library.dom.test.tsx`'s no-message-text assertion requires exactly one row and the
"Wording is held for" sentence before asserting the marker's absence.

**The seeded page test asserts the specimen never renders.** That render is the only one where
`EXACT_PATIENT_VISIBLE_MESSAGE` is in the page's own data and could reach the document, so it is the
strongest available form of the Ruling [127] guarantee. It is paired with an assertion that the row
still says, in plain words, that the record **holds** that wording — the two together are the claim:
the library says what the governance record contains and never shows it. Re-running **M11** (the row
printing `messageTextByType[type]` in place of the plain-words name) now takes that assertion down
too:

```
  FAIL  |jsdom| tests/caring-contacts-templates-page.dom.test.tsx > … a seeded version's approvals are qualified > renders the demo population's governed version with the provenance its record carries
  AssertionError: expected 'Governed pathway versionsOne row for …' not to contain 'Hi Rowan, Alex from Example Aftercare…'
```

**`docs/site-map.md`.** `/caring-contacts/templates` had the generator's "Route discovered from app
directory" placeholder. `scripts/generate-site-map.ts` gained a `routeDescriptions` entry and the
map was regenerated; the row now reads like its four siblings.

## Carried forward

The rider on Ruling [46] is worth keeping where the next person will find it, so it is recorded
here as well as in the coordinator's note: **if screen attribution is ever wanted on the access
trail, it needs a `surface`/`context` dimension, not a second `objectType`.** The enum is
single-valued and the query surface has no `objectId` filter, so every member added to it subtracts
from the answerability of the members already there.

## Verification after this round

Re-run after the final edit, not merely last in order. Worktree clean at the time of the run.

```
WORKTREE-CLEAN
 Test Files  22 passed (22)
      Tests  457 passed (457)
TSC-EXIT=0
ESLINT-EXIT=0
```

Lint was uncached (`node_modules/.cache/eslint` removed first) and covered
`tests/ui-caring-contacts-workspace.spec.ts` and `scripts/generate-site-map.ts` alongside the
earlier paths. The sensitivity controls C1 and C2b from the first round establish that a clean
`tsc` and a clean `eslint` on these files are not silence.

**Lock refusals this round:** M19 was refused once and retried. No row above is unrun.

**What is still not verified:** the browser block itself. Everything else in this task is offline
evidence, and I have still never seen the screen render.

---

# Review round 2 — what changed

Round 1 came back clean. Three small things were raised, none of which changes a test's behaviour;
all three are done. One commit: `0dc7e0990` (the two comment corrections). The Prettier line this
round was told to paste is in the verification block at the end.

## 1. A comment that under-claims proof decays as fast as one that over-claims it

`TEMPLATES_ROUTE`'s doc comment still read "NO PROOF BLOCK IS WRITTEN AGAINST THIS ROUTE YET" and
still listed forced-colors and 320px as owed, 650 lines above the block that covers both. This is
the same defect the previous round existed to fix, arriving from the opposite direction, and I
walked straight into it: I edited the thing the round was about and left the sentence that
described it.

Worth naming rather than just fixing, because the general rule is the one the standing discipline
already states and I applied only in one direction: **when a diff changes what a mechanism does,
read every doc comment in the files it touches** — including the comments that were true when they
were written and are now too modest. The corrected comment names the block, says what it covers,
and says the service-stop banner on this screen is what is still owed. That is all that is owed.

## 2. "The strongest available form of the guarantee" was claimed twice, and I put it on the weaker one

The spec's `not.toContainText(EXACT_PATIENT_VISIBLE_MESSAGE)` runs against a store that holds no
pathway version, so the specimen is not in that page's data and **the assertion cannot go red for
the reason it exists.** That is precisely the "absence asserted over a fixture that never held any"
shape this round's own criticism was about — added by the round that made the criticism.

The assertion stays: it is whole-stack, and the `h1` and empty-state assertions immediately above it
are its positive controls, so it cannot pass on a page that rendered nothing. Only the claim
changed. Its comment now opens "READ THIS BEFORE TREATING IT AS THE STRONG FORM OF THE GUARANTEE",
says in as many words that it cannot fail for its own reason, and points at
`tests/caring-contacts-templates-page.dom.test.tsx` — the seeded render, where
`snapshot.messageTextByType.standard` IS the specimen and where mutation M11 makes it fail:

```
  FAIL  |jsdom| tests/caring-contacts-templates-page.dom.test.tsx > … a seeded version's approvals are qualified > renders the demo population's governed version with the provenance its record carries
  AssertionError: expected 'Governed pathway versionsOne row for …' not to contain 'Hi Rowan, Alex from Example Aftercare…'
```

Only one place now claims the title, and it is the one that earns it.

## 3. The round-1 verification block dropped Prettier

Correct, and the reason it matters is exactly as put to me: reading the added lines is not the
check. Formatting is in none of `test`, `typecheck` or `lint`, so a block that lists three of those
and omits the fourth is claiming less than a full pass while reading like one. The line is below,
and the round-1 block is left as it was rather than backfilled — a verification block records what
was run at the time, and editing one after the fact to look complete is the opposite of what it is
for.

## Carried forward, unchanged

The Ruling [46] rider still stands: screen attribution on the access trail needs a `surface`/
`context` dimension, never a second `objectType`.

## Verification after this round

Re-run after the final edit, not merely last in order. Worktree clean at the time of the run.

```
WORKTREE-CLEAN
 Test Files  22 passed (22)
      Tests  457 passed (457)
TSC-EXIT=0
ESLINT-EXIT=0
Checking formatting...
All matched files use Prettier code style!
```

The Prettier line is `npx prettier --check` over the six files this round and the last one touched:
`tests/ui-caring-contacts-workspace.spec.ts`,
`tests/caring-contacts-templates-library.dom.test.tsx`,
`tests/caring-contacts-templates-page.dom.test.tsx`, `scripts/generate-site-map.ts`,
`docs/site-map.md` and this report. Lint was uncached (`node_modules/.cache/eslint` removed first).

**Lock refusals this round: five in a row.** The heavy lease was held continuously by
`D:\Worktrees\Database\dev-hub-phase-1` running `npm run build:internal`, and a retry loop reported
each refusal as UNRUN rather than counting it. The verdict above is attempt six:

```
attempt 1: UNRUN - lock refusal, waiting 90s
attempt 2: UNRUN - lock refusal, waiting 90s
attempt 3: UNRUN - lock refusal, waiting 90s
attempt 4: UNRUN - lock refusal, waiting 90s
attempt 5: UNRUN - lock refusal, waiting 90s
attempt 6: RAN, exit 0
Test Files  22 passed (22)
Tests  457 passed (457)
```

The tree was clean and unchanged across all six attempts, so that run covers exactly the tree the
first refusal was asked about.

**And it was run AGAIN after this section was appended**, because the rule is "re-verify after your
final edit", not "after your final code edit". The second run refused once and then landed:

```
attempt 1: UNRUN - lock refusal
attempt 2: RAN, exit 0
Test Files  22 passed (22)
      Tests  457 passed (457)
```

The regress this could turn into is worth naming, because the next person appending a report will
meet it: a verification block quoting a run, then a run after the block, then a block quoting that
run, and so on. The line to draw is that **an append of prose to a report cannot change what any
gate reads** — no gate in `test:cc-guards` opens this file — so one post-append run is enough, and
this paragraph does not require another. A code edit is a different matter and always does.

**The gate line is unchanged at 22/457, and that is expected rather than a stale number.** This
round added no Vitest case: `0dc7e0990` changes two comments and nothing else, and the previous
round's additions were Playwright `test(` blocks, which Vitest never counts.

**What is still not verified:** the browser block, which I have never run, and the service-stop
banner on this screen, which the block does not yet cover.
