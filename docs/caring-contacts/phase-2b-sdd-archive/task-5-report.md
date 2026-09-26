# Task 5 report — the Patients directory (absorbing Task 4)

**Status:** complete, on branch `claude/browser-test-gate-handoff-d5c1db`, base `bb03d00b5`.
Not pushed. No pull request opened. The Playwright browser gate was not run.

---

## 1. The two judgement calls you asked to see either way

### 1.1 The approved design DOES show a patient's name. I stopped and did not reach for `getEpisode`.

`PatientsDirectoryPage` in the design scratch renders `row.name` as the row heading, a
`PersonAvatar` built from `row.initials`, and a search box placeholded **"Search name or synthetic
ID"**. Its `filteredRows` filter matches on `` `${row.name} ${row.id}` ``. So the approved design
shows a patient's name in the list in three separate places.

Per the brief, that is your question, not mine. I did **not** call `getEpisode`, and I did not
invent a second read that would release a name. The screen is built from `PlanRecord`, which
carries no name, mobile number, identifier list or cultural identity by construction, and a row is
therefore headed by the **synthetic patient identifier** the store actually releases to a list
read. The row also states in words that this is a synthetic identifier, so the column is not
mistakable for a name that failed to load.

The decision you now own is one of three:

1. **Leave it as built** — a directory identifies patients by synthetic identifier only. Nothing
   further to do; this is the conservative option and the one that ships today.
2. **Add a name column, from the patient's own record.** This requires a read that releases
   `patientDetail`, which today means `getEpisode` — a read guarded by
   `generateClinicalRecordSummary`, i.e. a capability meant for producing a clinical record
   summary, not for drawing a list. Using it per row would also mean N audited episode reads to
   paint one screen, each recorded against a named patient in the access trail.
3. **Add a narrower read** — a list projection that releases a display name and nothing else,
   guarded by `viewPatientRecord` rather than `generateClinicalRecordSummary`. That is a store
   contract change (both repositories plus the shared contract suite) and belongs in its own task.

My recommendation is (1) for now and (3) if a name is genuinely needed, because (2) widens the
release rule for a screen whose whole job is orientation. I have not implemented (3).

There is a related, smaller consequence: the design's search box searches names. Mine searches the
synthetic patient, plan and referral identifiers, because those are the only things on the screen.

### 1.2 Filtering is fully server-side. No client boundary was added.

Two filters, both carried in the URL and read by the Server Component:

- **Plan state** — a row of `<Link>` chips (`?state=active`, and so on). A link is a navigation,
  so this needs no JavaScript and no state.
- **Identifier search** — an ordinary `<form method="get" action={CARING_CONTACTS_ROUTES.patients}>`
  with a text input named `q` and a submit button. A native GET form submission is a navigation
  too. When a state filter is active it rides along as a hidden field, so searching cannot silently
  widen a filter the clinician set.

The only client component in the rendered tree is `UnavailableDestination`, which was already the
workspace's only one. Nothing new crosses the boundary, so Ruling 13 is unaffected.

An unrecognised or repeated `?state=` value falls back to "All" rather than throwing. A mistyped
URL must widen a caseload, never fail the render, and the "All" chip is then marked current so the
screen and the URL cannot disagree.

---

## 2. What was built

| File                                                              | What it is                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/app/caring-contacts/patients/page.tsx`                       | The route. Server Component; two audited reads; fails closed on every bad outcome.          |
| `src/components/caring-contacts/workspace/patients-directory.tsx` | The screen body. Pure Server Component: given records and a filter, decides what to show.   |
| `src/components/caring-contacts/workspace/shell.tsx`              | `href: CARING_CONTACTS_ROUTES.patients` added to `PRIMARY_DESTINATIONS` (Task 4, absorbed). |

Plus the four things that make it a real destination rather than an orphan: `npm run sitemap:update`
(and a real description in `scripts/generate-site-map.ts`, not the generic "Route discovered from
app directory"), an entry in `docs/codebase-index.md`, and a reachability assertion (§4 below).

### The reads

Both go through `auditedRead` — the same wrapper `readHandler` is built on — with the **same access
identity the API routes already record**, so the trail does not grow a second vocabulary:

- service state — `{ administrative, serviceState, "service" }`, so the safety banner on this screen
  is a state that was genuinely read (Ruling 56);
- plans — `{ search, plan, "all" }` and `store.listPlans({ actor })`, matching `plans/route.ts`'s
  `GET` exactly.

No HTTP. No `getEpisode` (pinned by a test that spies on it).

### The three empty lists

`ListEmptyState` names two facts. This screen has three, and the third is the one that would have
lied:

1. **`"no-data"`** — the team genuinely holds no plan. Explains how a first patient arrives (a
   coordinator accepts a referral and claims a plan).
2. **`"filtered"`** — plans exist, the filter or search is hiding all of them. The `because` names
   which of the two filters is set, its value, and how many plans it is hiding; the `changedBy`
   states the remedy, and a "Show every plan" link makes the remedy reachable rather than merely
   described.
3. **A role that may not view plans at all.** `listPlans` answers an actor without `viewReferral`
   with `[]` — deliberately indistinguishable from "there are none", so nobody can probe for
   records they may not see. A screen that only counted rows would therefore tell an auditor their
   team has no patients. That is a false statement about a caseload and precisely the defect
   `ListEmptyState` exists to prevent, so the page asks `canPerformCaringContactAction` the same
   question the store asked and passes the answer down as `mayViewPlans`.

**This third case is a judgement call I made, and you may want to overrule it.** I rendered it with
the `"filtered"` kind, because that kind carries the reason-and-remedy shape the case needs, and
because `"no-data"` would state something affirmatively false. The heading is "Plans are not visible
in this role", so it does not claim plans exist — but `list-empty-state.tsx`'s own doc comment
defines `"filtered"` as "records exist, but the current filter or search is hiding all of them",
and strictly speaking this is a visibility rule rather than a filter. If you would rather
`ListEmptyState` grew a third kind (`"not-permitted"`), that is a small change to a Group 0
component and I did not make it unasked.

### Explained automation (spec §4.4)

One state on this screen was reached by the system on its own: `schedule.ts` suppresses the Week 1
message when it falls on the same calendar day as the plan's first contact, because two caring
contacts must never land on one day. A plan then carries nine sends, not ten, and the row's contact
count would otherwise be a smaller number with no reachable reason. Such rows render
`AutomatedState` in place, with why and what would change it, as text — never a hover title. A test
pins that the reason is not carried by a `title` attribute, and another pins that nothing is said
about suppression when the system suppressed nothing.

### Ruling 52 vs. the brief's row hrefs — a deliberate deviation

The brief says to build row hrefs from `patientRoute()` / `planRoute()`. **Those routes have no
pages yet** (Tasks 6-7), so a link would 404, which is exactly what Ruling 52 forbids and exactly
what the shell's own navigation avoids. The row's detail control is therefore an
`UnavailableDestination` — `aria-disabled="true"`, an inert handler, `title="… — coming soon"`, and
an `sr-only` reason — with a module comment naming `patientRoute()` as the href it takes once those
pages land. Swapping the control for a `<Link href={patientRoute(record.patientId)}>` is the whole
of that later change. A test asserts that no link on this screen points into the not-yet-built
detail routes.

This is not reachable in the demo today anyway: the in-memory repository seeds no plans, so the
honest state of `/caring-contacts/patients` in a fresh demo is the `"no-data"` empty state.

---

## 3. Constraints, checked one by one

- Internal navigation is `<Link>` throughout. No raw `<a href="/…">` was added.
- Every `<button>` does something: one submit button inside the GET form, and
  `UnavailableDestination`'s own control, which is `aria-disabled` with an inert handler. Native
  `disabled` and `aria-disabled` never appear together.
- Design tokens only; no hex. Tap targets are `min-h-tap` (`--spacing-tap: 3rem` = 48 px), which is
  this repo's spelling of `min-h-12`. No `min-h-11` anywhere.
- The service-state incident `note` never reaches a Client Component: `serviceState` is passed
  server-side to the shell exactly as the Today page passes it, and no client component on this
  screen receives it.
- No import from `src/components/caring-contacts/mockups/**`. The guard is stricter than that — see
  §6.1 — and the module now names the design-scratch component without its path.
- Prohibited vocabulary: clean, including bare identifiers. Two near-misses worth recording, because
  the next screen will hit them. `\bleads?\b` matches "team lead" and "Team Lead" (the hyphen and
  the space are word boundaries; the identifier `teamLead` is safe because "L" follows a word
  character), so the role-restriction copy deliberately does not name roles by that label. `\bsafe\b`
  is likewise banned outright, which rules out the obvious phrasing "nothing is sent to a real
  number, so this is safe".
- Next.js 16: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md` was
  read before writing the route. `searchParams` is a **promise** and is awaited before use; reading
  it makes the route dynamic, which is correct here — a cached copy of a caseload would outlive the
  caseload, and the role cookie already made the sibling route dynamic for the same reason.

---

## 4. The reachability assertion, and why it needed more than a new test

`tests/route-reachability.test.ts` finds inbound links by scanning JSX for `<Link href="…">` with a
**literal** destination. The workspace shell renders `<Link href={href}>` from a frozen destination
table, so the scan sees no path at all and `/caring-contacts/patients` read as an orphan (verified:
it failed with exactly that message before the fix).

`/caring-contacts` itself is not an orphan only because the tools catalogue names it, and that will
not cover any further workspace screen. So rather than allowlisting a route that is genuinely
linked, I added a builder-target source for the workspace, following the Therapy Compass precedent
already in that file: it parses `shell.tsx` for `href: CARING_CONTACTS_ROUTES.<key>` entries and
adds each resolved route. It throws loudly if it parses nothing, and throws if the shell names a
route key that does not exist.

That is not tautological, and I proved it: removing the `href` from the shell makes
`/caring-contacts/patients` fail as an orphan again (§5, mutation M12). What stops the builder from
vouching for a dead entry is `tests/caring-contacts-workspace-shell.dom.test.tsx`, which
independently derives each destination's kind from the DOM and now asserts Patients is a **link**.

**This is a shared file, and every future workspace screen now inherits the guard for free.** That
is the intended shape: Task 6 adds an `href` to the shell and reachability follows automatically.

---

## 5. Verification

### Mutation testing — every piece was broken and the covering test went red

Each mutation was applied to the working tree, its presence proved by a `grep -c` run **separated
by `;`, never `&&`** (the brief's warning is real: M12 below counted zero occurrences and `grep`
exited 1, which would have silently skipped the test run under `&&`), then the suite was run, then
the tree was reverted.

| #   | Mutation                                                           | Result                                                                       |
| --- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| M1  | Page calls `notFound()` when `records.length === 0`                | **red** — 3 failed, incl. "renders the empty STATE … never calls notFound()" |
| M2  | Filtered-empty falls through to the `"no-data"` branch             | **red** — 3 failed, incl. both filtered-empty tests                          |
| M3  | The `!mayViewPlans` branch removed                                 | **red** — 2 failed (component + page role tests)                             |
| M4b | Page calls `store.getEpisode(...)` for the first record            | **red** — exactly 1 failed: "never reads the episode"                        |
| M5  | Plans access `objectId` changed from `"all"` to `"plans"`          | **red** — 2 failed (both audit-identity tests)                               |
| M6  | Plan-state filter removed from `matchesFilter`                     | **red** — 3 failed                                                           |
| M6b | Identifier search neutralised                                      | **red** — 2 failed                                                           |
| M7  | Row control replaced with a `<Link>` into the unbuilt detail route | **red** — exactly 1 failed (Ruling 52 test)                                  |
| M9  | `AutomatedState` removed from the row                              | **red** — exactly 1 failed (explained-automation test)                       |
| M10 | Hidden `state` field dropped from the GET form                     | **red** — exactly 1 failed                                                   |
| M11 | `aria-current` dropped from the state chips                        | **red** — exactly 1 failed                                                   |
| M12 | `href` removed from the shell's Patients destination               | **red** — reachability reports `/caring-contacts/patients` as an orphan      |

A first attempt at M4 used an identifier the page does not import, so the page threw before the
mutated call could run and four tests failed for the wrong reason. That is recorded here rather than
quietly re-run: it is exactly the "the mutation did not measure what it claimed" failure the brief
warns about. M4b is the corrected version and fails exactly one test.

### Gates

```
npm run test        →  Tests  2 failed | 9851 passed | 74 skipped (9927)
                       Test Files  1 failed | 815 passed | 3 skipped (819)
```

The two failures are the known environmental pair only, both in
`tests/gate-receipts.test.ts > gate receipts — file modes`, failing in `chmodSync` because this
Windows drive cannot represent Unix file modes:

- `changes the signature when only the WORKING-TREE mode changes`
- `keeps both modes, so one cannot cancel the other`

**Nothing else failed.** An earlier full run showed two additional failures, both mine, both fixed
and both described in §6.

```
npm run typecheck   →  [gate-receipts] recorded a pass for "typecheck:internal" (5226 input files)
npm run lint        →  [gate-receipts] recorded a pass for "lint:internal" (5226 input files)
```

Both are **fresh** runs ("recorded a pass"), not reused receipts. Both were re-run after the final
formatting pass.

```
npx prettier --check <every changed file>  →  All matched files use Prettier code style!
```

No gate failed to take a lock; no gate was skipped.

### The browser gate — not run, and here is what I think it does

I did not run `tests/ui-caring-contacts-workspace.spec.ts`, as instructed. **I do think this change
can affect it**, in two ways:

1. **The shell's Patients destination changed kind, from an unavailable button to a link.** Any
   assertion in that spec that counts unavailable controls, or that expects the rail/phone-dock
   Patients entry to be a `button`, will now see an `<a>`. The equivalent Vitest DOM assertions in
   `caring-contacts-workspace-shell.dom.test.tsx` did fail on exactly this and I updated them
   (unavailable-control count 16 → 14; rail and phone destination kinds). If the Playwright spec
   carries the same counts, it will need the same update, and I could not verify that by running it.
2. **A second production route now exists in the workspace.** I added
   `src/app/caring-contacts/patients/page.tsx` to the `caring-contacts-workspace` surface's `routes`
   in `docs/design-system/adoption-contract.json`, which was required — the adoption generator
   refuses an undeclared production page route and blocked the commit until I did. **That surface
   declares its dark / forced-colours / compact-320 / print / browser proof as `passed`, with that
   Playwright spec as the evidence, and that spec has never visited `/caring-contacts/patients`.**
   So the contract now claims proof for a route nothing has proved. I did not weaken the claim and I
   did not edit a spec I cannot run. **Recommended: add a `/caring-contacts/patients` visit to
   `tests/ui-caring-contacts-workspace.spec.ts` before that claim is honest.** This is the single
   loosest thread I am leaving.

---

## 6. Two guards this change tripped, and what they taught

### 6.1 The production/prototype separation is stricter than "no imports"

`tests/caring-contact-route-files.test.ts` fails on any production workspace file whose source
**mentions** `caring-contacts/mockups` at all — including inside a comment. My module note cited the
approved design by file path, which is a reasonable thing to write and still fails the guard. The
comment now names the component (`PatientsDirectoryPage`) without its path.

Worth knowing for the next screen: the guard is a substring match on the source, not an import
analysis, so "read the mockup as a specification" cannot be documented by path in a production file.

### 6.2 A `git checkout --` in a mutation harness silently reverted an uncommitted fix

The fix in §6.1 was made **after** the first commit and **before** the mutation runs. My mutation
harness reverts each file with `git checkout -- <path>` after each mutation — which threw away that
uncommitted fix without a word, and the guard failed again on the next full run. `git status` was
clean, which is exactly what made it invisible.

The lesson is the one already in the brief's preamble, sharpened: **commit before running a harness
that reverts files**, not merely before waiting on a gate. Both fixes are now committed.

The full-suite run that produced the numbers in §5 was taken **after** both were fixed.

---

## 7. Concerns and open threads, in order of how much they matter

1. **The design shows a patient's name; the screen does not.** §1.1. Your decision. The screen ships
   correctly either way; if a name is wanted, my recommendation is a narrow new list projection
   rather than `getEpisode`.
2. **The browser proof claim now covers a route the browser spec never visits.** §5. One added visit
   in `tests/ui-caring-contacts-workspace.spec.ts` closes it. Until then, the adoption contract is
   slightly ahead of the evidence.
3. **The browser spec may need the same count updates the DOM test needed.** §5, item 1. I could not
   check without running it.
4. **The role-restriction empty state uses the `"filtered"` kind for something that is not a
   filter.** §2. If you would rather add a third kind to `ListEmptyState`, say so and it is a small
   change — but it touches a Group 0 component every later screen depends on, so I did not do it
   unasked.
5. **Prohibited vocabulary now bites on ordinary clinical English.** "team lead" and "safe" are both
   unusable in interface copy. That is working as designed, but the next screens (Team, especially)
   will collide with the first of those immediately, and it is better known now than discovered at
   the gate.
6. **The demo shows an empty caseload, honestly.** The in-memory repository seeds no plans, so a
   fresh demo of `/caring-contacts/patients` renders the `"no-data"` state. That is the correct
   behaviour, not a defect, but it means nobody will _see_ a row, an `AutomatedState`, or the
   filtered-empty state without creating plans through `POST /api/caring-contacts/plans` first. All
   three paths are covered by tests.

---

# Fix round 1

All ten items taken. Head `a976e3c98`. Not pushed, no pull request.

## Before anything else: this worktree had been moved to another branch

Partway through this round the working directory was on `claude/caring-contacts-foundation` at
`a2b3248d0`, not on the task branch — `src/app/caring-contacts/patients/` and
`patients-directory.tsx` had simply vanished from disk, and two edits I had just made landed on that
other branch's files instead. Nothing was lost: the reflog showed an ordinary
checkout/rebase/checkout sequence, and `claude/browser-test-gate-handoff-d5c1db` still held my three
commits plus the two ledger commits added since.

Recovered by saving the stray diff, restoring the foundation tree to exactly the state I found it in,
switching back, and re-applying. Recorded because "the source file is missing" is not the first
symptom anyone expects of a branch switch, and because the correct first move was to look before
touching anything.

## C-1 — real browser coverage, and what running it actually measured

`openWorkspace()` is now parameterised by screen (`WORKSPACE_SCREENS`, carrying each route with the
`h1` it must render), and a `caring-contacts patients directory` block genuinely visits
`/caring-contacts/patients` under all four accessibility modes plus two behavioural checks:

| Test                                                                   | Proof category it earns |
| ---------------------------------------------------------------------- | ----------------------- |
| serves an empty caseload as a page, not a missing resource             | browser                 |
| holds the frozen layout at 320px                                       | compact320              |
| re-resolves its surfaces and ink in dark                               | dark                    |
| states the empty caseload in words once forced colours drop every tint | forcedColours           |
| prints with the synthetic marker and the empty state still on the page | print                   |
| is reachable from the workspace rail, not only by typing its URL       | browser                 |

```
38 passed (58.3s)      exit 0      at a976e3c98
```

Was 32. All six new tests appear in the log by name.

**Three browser mutations, each red on its own assertion** — adding coverage that cannot fail is the
same defect as the one this item is about, one level up:

| Mutation                                     | Result                                                              |
| -------------------------------------------- | ------------------------------------------------------------------- |
| filter chip `min-h-tap` to `min-h-11`        | **red** — "the state filter chip is under the production tap floor" |
| empty-state `border` class removed           | **red** — "the empty state has no border under forced colours"      |
| page calls `notFound()` on an empty caseload | **red** — 6 failed                                                  |

**The third taught me something I had asserted wrongly.** I expected the HTTP status assertion to be
what caught it. It was not: with `notFound()` in the page the route still answered **200**, and only
the content assertions failed. The route is dynamic and streams under the segment's Suspense
boundary, so the headers are flushed before the render reaches the refusal, and the 404 arrives as
content rather than as a status code. The status line is kept — it still catches a refusal made
before the stream opens — but the test now states which assertions are load-bearing, so nobody later
trims it to the one that cannot catch this.

That is the reviewer's own lesson landing on my new test: `expect(status).toBe(200)` is a well-formed
check that would have certified a well-formed lie.

## I-2 — the client-component count

Corrected in all three places: `docs/codebase-index.md`, `patients-directory.tsx`, and
`unavailable-destination.tsx`, which is where I inherited it. There are five —
`unavailable-destination.tsx`, `overlays/workspace-overlays.tsx`, `overlays/overlay-host.tsx`,
`overlays/overlay-trigger.tsx`, `service-stop-scroll-watcher.tsx`. The conclusion is unchanged and is
now stated as the thing that actually holds Ruling 13: the set is small and shared across screens,
not one member large.

## I-3 (Ruling 93) — the remedy, and a correction to the ruling's premise

**Fixed as directed.** The screen no longer names a role switcher. It says that nothing on this
screen changes it and that no control for it exists anywhere in this workspace yet.

**One factual correction, offered because I verified it rather than to argue the fix.** Ruling 93
states that `CARING_CONTACTS_ROLE_COOKIE` "appears exactly once in `src/`, its own declaration in
`session.ts`, and nothing writes it". It appears four times, and it **is** written:
`src/app/api/caring-contacts/session/route.ts:53` sets it in the `POST` handler of the demo session
route, which exists precisely to switch the demo role.

The ruling's conclusion is nonetheless right and the fix is unchanged: there is no role-switching
control **in the interface**. A clinician reading this screen cannot reach the switch, because it is
an HTTP endpoint with nothing in front of it. So the old sentence was still a false statement about
something reachable, and the new wording — the role is set outside the interface — is true of both
the endpoint and the missing control.

I raise it because the difference matters to whoever builds the switcher: the server half exists.

The new test asserts the remedy's **content** — it must say nothing on this screen changes it, must
say no control exists in this workspace, and must not contain "role switcher". Mutation F1 restores
the old sentence and the test goes red.

## I-4 — the null release throws, and is now pinned

`plansRead.released ?? []` replaced with a throw matching the service-state read above it.

**The mutation initially did not go red, which is the finding.** Restoring `?? []` left all 56 tests
green: the branch is unreachable through the real stores, so nothing exercised it — the same reason
it was wrong and the same reason nobody noticed. It is now pinned by spying `listPlans` to `null`,
and the retried mutation goes red on that test alone.

## I-5 (Ruling 92) — `ListEmptyState` gains `"not-permitted"`

Third kind, same `heading`/`because`/`changedBy` shape, `EyeOff` rather than `SearchX`. Four tests in
the component's own suite, including one that renders `"filtered"` and `"not-permitted"` side by side
and asserts their icons differ — the icon is what states the difference wordlessly, so an icon shared
between the two is a false statement made without words. The type doc records why the kind exists and
that its remedy must be real (Ruling 93), so the next screen copying this one copies the constraint.

## Minors

- **M-6** — floor restored to `>= 5`, with a note that the exact count is asserted directly above it
  and that a floor a change did not breach is not loosened. Raising it to 99 goes red.
- **M-7** — `readHandler`'s empty-list 200 pinned in `tests/caring-contacts-api-handler.test.ts`,
  using the auditor role so the `[]` is genuinely the "you may not see these" case the module's own
  note calls out. Treating an empty array as denied goes red.
- **M-8** — suppression counted from `contact.state === "suppressed"`. The two reasons now carry
  different explanations because they have different remedies: the schedule's absorption is
  reversible by changing the first-contact date; any other suppression is terminal (`suppressed` is
  in the contact model's terminal set) and this row does not hold what caused it, so it says that
  rather than inventing a remedy or naming a screen that does not exist.
- **M-9** — `data-internal-link` asserted on every link. **This one also had a gap the mutation
  found:** the assertion covered the filter chips but not the empty state's own remedy link, so
  stripping the attribute from that single link left the file green. Both paths are pinned now, and
  both mutations go red.
- **M-10** — `label` is a destination noun (`The patient record for <id>`), so the screen-reader note
  reads correctly; the visible text carries the identifier so one row's control stays
  distinguishable from the next.

## Gates, at `a976e3c98`

```
npm run test        →  Tests  2 failed | 9860 passed | 74 skipped (9936)
                       Test Files  1 failed | 815 passed | 3 skipped (819)
```

The two known Windows `chmodSync` file-mode failures in `tests/gate-receipts.test.ts`, and nothing
else.

```
npm run typecheck   →  [gate-receipts] recorded a pass for "typecheck:internal" (5227 input files)
npm run lint        →  [gate-receipts] recorded a pass for "lint:internal" (5227 input files)
npm run test:e2e -- tests/ui-caring-contacts-workspace.spec.ts --project=chromium
                    →  38 passed (58.3s), exit 0
npx prettier --check <every file changed since bb03d00b5>
                    →  All matched files use Prettier code style!
```

Typecheck and lint are fresh runs, not reused receipts. No gate failed to take a lock and none was
skipped.

### The round-1 mutation ledger, itemised

The first version of this section gave a total — "eight Vitest, three browser, two retries" — and
named six. A total that outruns its itemisation is the weakest form of the problem this whole
programme keeps catching, so here is every attempt, including the two that were skipped or measured
nothing.

| #   | Mutation                                                              | File                   | Result                                                                 |
| --- | --------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------- |
| 1   | I-3: restore "The role switcher changes which role you are acting in" | directory              | **red**, 1 failed — "states a remedy that exists…"                     |
| 2   | I-5: the role case falls back to `kind="filtered"`                    | directory              | **red**, 1 failed — "uses the not-permitted kind…"                     |
| 3   | I-5: `"not-permitted"` reuses `SearchX`                               | `list-empty-state.tsx` | **red**, 2 failed — the component suite and the screen suite           |
| 4   | I-4: restore `plansRead.released ?? []`                               | page                   | **NOT RED** — 56 passed. The gap.                                      |
| 5   | I-4 retried, after adding the covering test                           | page                   | **red**, 1 failed                                                      |
| 6   | M-8: count `planned.suppressed` instead of `contact.state`            | directory              | **red**, 1 failed — "explains a contact suppressed by the transition…" |
| 7   | M-9: strip `data-internal-link` from the row control                  | directory              | **SKIPPED** — my anchor string did not match the file                  |
| 8   | M-9: strip it from the empty state's remedy link                      | directory              | **NOT RED** — 21 passed. The second gap.                               |
| 9   | M-9 retried, after closing the gap                                    | directory              | **red**, 1 failed                                                      |
| 10  | M-9: strip it from the filter chips                                   | directory              | **red**, 1 failed                                                      |
| 11  | M-6: raise the floor from `>= 5` to `>= 99`                           | shell test             | **red** — but see the note below                                       |
| 12  | M-7: `readHandler` treats an empty array as denied                    | `handler.ts`           | **red**, 1 failed                                                      |

Plus three browser mutations, tabled above.

**Number 11 is not product proof, and should not have been listed beside the others.** It mutates
the test's own threshold, so all it demonstrates is that the assertion executes — not that the floor
would detect a change to the shell. The exact count two lines above it in that test is what carries
the real weight there. Listed here for completeness, labelled for what it is.

Two attempts (4 and 8) found real holes, and one (7) was a mutation that never entered the tree —
which is exactly why the presence check is separated with `;` rather than `&&`: a `grep -c` that
finds nothing exits non-zero, and chaining would have skipped the run and reported nothing at all.

## Still open

1. **The names-only projection (Ruling 91)** is the owner's decision and its own task. Nothing here
   anticipates it; rows are still headed by the synthetic identifier.
2. **Ruling 93's premise about the role cookie is inaccurate** — the demo session route does write it
   (see I-3). Worth correcting in the build record so the next person does not re-derive it.
3. **`WORKSPACE_SCREENS` is a list a future screen must be added to.** It is documented in place as
   the thing keeping the adoption contract's proof claim true, but nothing enforces it: a Task 6
   screen added to the surface and not to that list recreates C-1 exactly. A static check that every
   route in the surface's `routes` appears in that spec would close it, and I did not build one.

---

# Fix round 2

All six items taken. Head `5e0dba3f5` plus this report. Not pushed, no pull request.

## Ruling 94 — the count is dropped, not corrected

You are right that "five" was wrong, and right about why: I scoped it to
`src/components/caring-contacts/workspace/**` without saying so, and "in total" foreclosed exactly
the scoping I had silently applied. `src/app/caring-contacts/error.tsx` is a Client Component
because Next requires error boundaries to be, it sits inside the workspace by the same paragraph's
own definition, and it pulls `src/components/route-error-boundary.tsx` into the route's client
bundle.

So no number replaces it. All three sites now state the property that does not decay — **nothing
outside the `/caring-contacts` route segment imports this workspace**, so the dashboard references
no chunk exclusive to it however many files the directory grows — plus the one claim that is
checkable per screen and was always the real point: **this screen adds no client component of its
own.**

`unavailable-destination.tsx` carries the history in full, because it is where both wrong counts
were written and where the next person will copy from.

## The mutation ledger — itemised, and one entry relabelled

The round-1 section now lists every attempt in a table rather than giving a total. The two you
could not account for were real and are named: **I-5's `SearchX` reuse** in `list-empty-state.tsx`
(red, 2 failed — the component suite and the screen suite), and **M-8's `planned.suppressed`
count** (red, 1 failed). Two further entries were missing from the total as well: the M-9 mutation
whose anchor never matched the file, and the first M-9 attempt that did not go red.

**M-6's `>= 5` → `>= 99` is relabelled.** You are right that it mutates the test's own threshold, so
it shows the assertion executes and nothing more; the exact count two lines above it carries the
real weight. It is still listed, but as what it is.

## N-1 — `== null`

Fixed, with a comment saying why a loose equality is correct in that one place: `auditedRead`
denies on null **or undefined** while `AuditedReadResult` types `released` as `T | null`, so the
compiler cannot see the gap and my pinning test mocked `null` specifically. The `undefined` case is
now its own test. Mutation R2-1 narrows the guard back to `=== null` and that test goes red.

## N-2 — both causes, counted and explained

`hasAbsorbedContact` became `absorbedContactCount`, and the row now derives its reason from the two
counts rather than branching on whether an absorbed contact exists. A plan carrying one absorbed
Week-1 message and one later `suppress` transition states both causes and **both remedies**, which
is the part that made this worth fixing rather than merely tidying: absorption is undone by choosing
a different first-contact date, and a transition-suppressed contact is terminal. Mutation R2-2
restores the unconditional branch and the new test goes red.

## N-3 — the clinician-facing count is pinned

Two mutations, from both sides, because a single one would not have caught both directions of the
change: R2-3 subtracts only the absorbed contacts (the pre-round-1 definition) and R2-4 subtracts
nothing at all. Both go red on the same new test.

You are right that this is the same shape as my own I-4 finding: a value changed definition and
nothing read it.

## Minor — the dark-mode proof now reads this screen

`shellColours()` reads the rail, the `h1` and the synthetic marker, all identical on both routes, so
the test would have earned the `dark` category for the Patients route while inspecting only the
shell. A new `emptyStateColours()` reads the empty-state panel's own surface, border and ink, none
of them drawn by the shell.

Proved with a browser mutation: hardcoding the panel's `bg-[color:var(--surface-subtle)]` to a hex
value fails with `the empty state's surface did not change in dark`, `Expected: not "rgb(244, 244,
245)"`. Before this change that mutation passed.

## Gates

```
npm run test        →  Tests  2 failed | 9863 passed | 74 skipped (9939)
                       Test Files  1 failed | 815 passed | 3 skipped (819)
npm run typecheck   →  [gate-receipts] recorded a pass for "typecheck:internal" (5228 input files)
npm run lint        →  [gate-receipts] recorded a pass for "lint:internal" (5228 input files)
npm run test:e2e -- tests/ui-caring-contacts-workspace.spec.ts --project=chromium
                    →  38 passed (1.1m), exit 0
npx prettier --check <every file changed since bb03d00b5>
                    →  clean
```

The two failures are the known Windows `chmodSync` file-mode pair in `tests/gate-receipts.test.ts`,
and nothing else. Typecheck and lint are fresh runs, not reused receipts. No gate failed to take a
lock and none was skipped.

### Round-2 mutation ledger

| #    | Mutation                                                | Result                                                                           |
| ---- | ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| R2-1 | narrow the null guard back to `=== null`                | **red**, 1 failed — "throws the same way when the store answers undefined"       |
| R2-2 | absorption wins unconditionally again                   | **red**, 1 failed — "accounts for both causes…"                                  |
| R2-3 | subtract only absorbed contacts from the rendered count | **red**, 1 failed — "states how many messages remain…"                           |
| R2-4 | subtract nothing from the rendered count                | **red**, 1 failed — same test, opposite direction                                |
| B4   | hardcode the empty state's surface to a hex value       | **red** (browser), 1 failed — "the empty state's surface did not change in dark" |

Five attempts, five reds, none skipped, none measuring something other than what it claimed.
Presence proved with `;` in every case.

## Deferred, as instructed

Not touched this round: the `session/route.ts:43` comment naming the same non-existent switcher;
`data-internal-link` being a self-asserted marker rather than structural proof of a `<Link>`; and
`PATIENTS_ROUTE` being built from a literal rather than imported from `caring-contacts-routes.ts`.

## Still open from round 1

`WORKSPACE_SCREENS` is a list a future screen must be added to, and nothing enforces it. A Task 6
screen added to the adoption surface's `routes` but not to that list recreates C-1 exactly. A static
check comparing the two would close it; I did not build one, and it is the one thread I would pick
up first.
