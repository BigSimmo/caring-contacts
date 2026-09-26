# Task 19 report — Guidance and Reports, and the More-panel navigation

**Branch:** `claude/caring-contacts-demo-seed`. **Worktree:** `D:\Worktrees\Database\cc-templates`.
Nothing pushed, no pull request opened, no subagent dispatched.

---

## 1. The thing you most needed me to get right: the reach report

**Written in two passes.** I built this screen under the original instruction — _stop, do not invent
a threshold, report what shape the configuration would need_ — and then the owner's decision of
2026-08-26 arrived mid-task, setting the threshold at 5. Both halves are recorded below, because the
first half is what makes the second one safe to read: the value did not come from an implementer,
and the file it now lives in exists to say so.

### What I found before the decision

I searched independently of your search and reached the same answer: no configuration surface for a
small-cell threshold existed anywhere in `src/lib/caring-contacts/**`, in
`caring-contacts/supabase/migrations/**`, or in the server seam. The only "suppress" in the domain
is the contact-suppression state, which is unrelated. `reachReportingThreshold()` returned `null` and
the screen rendered the not-configured state.

### What the decision changed, and what it did not

**It gave the value an owner. It did not give the report a field.** Those are independent, and the
screen still says so:

- `/caring-contacts/reports` performs **no read of `caring_contacts.cultural_identity_reports`**;
- its reach section states that this service does not record Aboriginal and Torres Strait Islander
  status, so there are no reach figures to report;
- that this is a statement about what is collected and **not** about who is in the programme —
  explicitly, "nobody has been asked, so a breakdown here would not be an empty one; there is
  nothing for it to be a breakdown of";
- that **one** thing is still missing: a bounded set of categories to record against;
- and that the minimum cell size **is** already set under governance, naming the value, who set it
  and when — so a reader can see that what is waiting is the categories, not the rule.

It renders **no breakdown element**, so the "no Aboriginal or Torres Strait Islander patients"
reading is not available to a reader by any route. That is asserted structurally rather than by
wording (`queryByTestId(...breakdown)` is null, and the section contains no `Suppressed`), and
end-to-end in the browser block.

### Where the value lives, and why there

`src/lib/caring-contacts/reach-reporting-governance.ts` — a new module whose only content is the
decision:

```
smallCellThreshold: 5
decidedBy:          the service owner
decidedOn:          2026-08-26
basis:              common practice for small-cell suppression, by analogy
restsOn:            No calculation over this programme's own data. Nothing has been counted, and
                    this number is not an output of anything.
revisit:            Explicitly open to revision; taken to unblock reporting, not to settle the
                    question.
```

Three things about that shape, each answering one of your three points:

1. **It is a decision, not a constant.** The number is not in a component and not in the body of the
   sealed domain's suppression module. `reachReportingThreshold()` in `reach-reporting.ts` reads it;
   the reach section renders it from the same record; **nothing restates it**. The file is the one a
   governance change would naturally open, and its module note says so in as many words.
2. **`restsOn` is a field, not a sentence in a comment.** It exists because the failure mode you
   named is real and invisible from the number: a threshold presented as derived when it was chosen
   is the decaying form of a restated count. A later reader who assumed 5 came out of an analysis of
   this dataset would over-trust it, and might decline to revisit it because "the analysis said 5".
   The record says, in the value itself, that nothing has been counted.
3. **It cannot be moved silently, but "not silently" is weaker than "not without authority".** See
   below.

### What a change to it should require — and what actually stops one today

**Today, exactly one thing makes a change deliberate**: `tests/caring-contacts-reporting.test.ts`
pins the value **together with** `decidedBy`, `decidedOn`, `basis`, `restsOn` and `revisit`, so an
edit that moves the number without moving the record that explains it turns the suite red. That
makes a change **visible and reviewable**. It does not make it **authorised** — a single commit can
edit both the value and the pin, and nothing outside review would notice.

What I think a change ought to require, in ascending order of what it buys:

- **A second approver, at minimum.** This domain already refuses to let one person both author and
  approve clinical message content (`pathway_versions_no_self_approval`). A disclosure control over
  Aboriginal and Torres Strait Islander status is at least as consequential as message wording, and
  the argument that carried there carries here.
- **A dated, superseding record rather than an in-place edit** — the same discipline the review
  ledger uses. An in-place edit destroys the previous decision; a superseding record keeps the
  history of what was disclosable when, which is the question an auditor asks after the fact.
- **A migration, if and only if the threshold becomes per-service.** A committed constant is
  honest while there is one service and one owner. The moment a second service could hold a
  different threshold, a stored row is the only shape that can be right, and then it needs the
  guard-migration contract like any other schema change.

**Ruled on 2026-08-26: recorded, not built.** A test pinning the value together with its provenance
is proportionate for a prototype holding no real data, and a second-approver mechanism is a
governance decision the owner has not been asked for. So none of the above is built, and this
paragraph is where whoever operationalises this should find the recommendation rather than
re-deriving it. The gap between **visible** and **authorised** is real, deliberate, and open.

### Still outstanding for §2.5

1. **A bounded category set, versioned.** Suppression presupposes it, and it is the thing the report
   is now waiting on. The natural home is beside the other governed vocabularies in the sealed
   domain — a frozen list with a version identifier, so a report can say which set it was computed
   against and a later change does not silently restate an older report. Free text cannot be
   normalised into this without an unaudited step deciding who counts as Aboriginal, which is the
   decision the owner refused on 2026-08-25.
2. **A collection path**, once the categories exist. The input was removed and the wizard sends
   `null` unconditionally; nothing on my screens changes that, and nothing should until the
   categories are decided.
3. **A new `AccessedObjectType` member, when the read is built.** A reach read over
   `cultural_identity_reports` is a genuinely different object from anything the trail names today.
   That is the member this screen would warrant, and it belongs to building that read — not to
   building this screen. See §4.

**The floor holds, and it is now actually proven — it was not when I first wrote this.** A threshold
below 3 is refused by name: at 2, "suppressed" means "exactly 1" and the marker announces the number
it stands for; at 1, nothing is ever suppressed. That refusal is arithmetic, not policy.

The correction matters more than the claim. The first version of this paragraph said the floor was
mutation-proven; **it was not.** The only mutation on it lowered the constant, and the pin on the
constant sat ahead of the behavioural loop in the same test case — so the mutation reddened the pin,
the loop was never reached, and the enforcement inside `discloseReach` had no coverage whatsoever.
The pin and the behaviour are now two separate cases, and two separate mutations (M4 on the constant,
M18 on the guard) redden them independently. §8 carries the messages. A future decision set below the
point at which suppression suppresses anything now goes red rather than shipping, which is what this
paragraph claimed all along.

---

## 2. Suppression, and the inference attempt

The rule lives in `src/lib/caring-contacts/reach-reporting.ts`. It takes the threshold as a
**required argument** — there is no default parameter, so a caller that forgets it cannot silently
acquire one — and it is fully built and fully tested even though no page currently calls it with a
number.

### What it does, and why

It assumes **the population total is knowable**. `discloseReach` prints no total and the reach
section renders none, but a reports screen publishes measures over the same team beside it, so a
reader who can count the team's plans has the total whether or not the reach section prints it.
Withholding the total is therefore belt-and-braces, not the mechanism. Stating that assumption is
the point: a rule whose safety rests on withholding a number that is published two sections above it
is not a rule.

Given that, a hidden cell is recoverable exactly when the arithmetic pins it to one value:

- nothing hidden — nothing to pin;
- **exactly one cell hidden — it IS the residual, by one subtraction.** This is naive suppression;
- **residual zero — every hidden cell is zero**, however many there are;
- otherwise, two or more non-negative integers summing to a positive residual admit more than one
  assignment, so no cell has a single feasible value.

So the rule hides the cells below the threshold, then **promotes further cells into the hidden set,
smallest first, until nothing is pinned** — and **withholds the breakdown whole** when no promotion
can achieve that. Promotion is what buys the ambiguity: a reader who knows the rule cannot tell a
cell hidden for being small from a cell hidden to protect it, so no per-cell upper bound survives to
narrow the assignments.

**What is deliberately not modelled:** differencing two reports that share a population but differ
by a filter. No per-report rule can prevent that. The reach section is therefore **unfiltered by
construction** — the screen offers no control that would produce a second, differently-scoped reach
report to difference against it. That is a property of the surface, and it is recorded in the module
where a reader will look for it.

### The test is an attack, and it carries its own positive control

`tests/helpers/caring-contacts-reach-inference.ts` holds the attack in one place, because it is used
twice and two copies of a safety check drift. It takes what a reader can see, computes the residual
from the published cells and the assumed-known total, enumerates **every** split of that residual
across the hidden cells, and returns the categories whose value is the same in every split.

- Against **naive** suppression of `{12, 2, 9}` at threshold 5, it recovers `Torres Strait Islander`.
  **That is the positive control**, and it is asserted first: an attack that could not recover a cell
  from naive suppression would prove nothing by failing to recover one from the real rule.
- Against the real disclosure of the same data, it recovers nothing.
- Both are run twice: once over `discloseReach`'s value, and once over the **rendered rows**, read
  back out of the DOM exactly as a reader reads them.

There is no assertion anywhere that the word "Suppressed" appears and stops there.

---

## 3. The shipped route no phone could reach

Confirmed as you described it, and fixed.

`MORE_DESTINATIONS` entries now carry an optional `href`; every entry without one still renders as an
`UnavailableDestination` stating its reason, and that is asserted as the full panel list rather than
as a count. Guidance and Reports carry hrefs under Ruling 89 — link and screen in the same change.

For Templates I did **not** displace anything from the phone bar. The More panel now also carries
`PHONE_OVERFLOW_DESTINATIONS`, **derived** as `PRIMARY_DESTINATIONS` minus `PHONE_DESTINATIONS`
rather than listed, inside a `md:hidden` row — so they appear exactly where the rail does not, and
dropping a fourth destination from the phone bar tomorrow routes it here without anyone remembering
to. A hand-written third list is how the defect arose in the first place.

### The assertion that can actually fail

You are right that the orphan-route gate proves nothing about a phone, and I did not rely on it.

`tests/caring-contacts-workspace-shell.dom.test.tsx` gains `rendersAt(element, width)`: it walks the
element's **real rendered ancestor chain**, resolves which Tailwind display utility wins at that
width from a **closed map of variants**, and **throws** on a variant it does not recognise rather
than guessing — because a silent "assume visible" would reproduce the exact failure mode the orphan
gate already has. Its positive controls are the rail and the phone dock, which are opposite by
construction: the rail must be absent at 375 and present at 900, the dock the reverse. The
reachability test then requires every built route to have **at least one link that renders at 375
and at least one that renders at 900**.

That is still a model of the CSS rather than the CSS, so the browser block sets a real 390px
viewport, asserts the rail is hidden and the dock visible, finds Templates, Guidance and Reports as
links in the More panel, and clicks through to Templates. The two halves fail for different reasons:
a stylesheet that did not ship the variant reddens only in the browser.

### What a general fix would need

This is repo-wide and not Caring Contacts' to close alone. `tests/route-reachability.test.ts` asks
"is this route referenced in source?" The question worth asking is "does some viewport render a link
to it?" Closing it generally needs a rendered-DOM reachability pass per breakpoint over the app's
real nav surfaces — which the general scan cannot do as a text match, because the answer depends on
CSS. The cheapest honest intermediate step is what this task did locally: for each nav-owning
component, a DOM test that resolves display variants over the rendered tree at the reviewed widths.
Worth an `/issues` row; I have not written one, since the ledger is serialized and this is not mine
to queue mid-task.

---

## 4. Decisions I took, with the reasoning rather than the ruling's letter

### No new `AccessedObjectType` member — and I read Task 15's finding first

**Guidance** reads only the service state. There is no guidance object; there is a page of text. A
`guidance` member would name a **screen**, and since the trail filters on `objectType` with no
`objectId` filter, a screen-named member splits one askable question in two. That is Task 15's
finding exactly, and it applies unchanged.

**Reports** reads plans and dispatch attempts, and records each against the object it read —
`{ search, plan, "all" }` matching `plans/route.ts`, `{ search, contact, "all" }` matching
`dispatches/route.ts`. I considered and rejected the declared-but-unused `"report"` member for the
plans read: **the read did release plan records to the server**, so recording it as a report read
would make "who read this team's plans, and when" miss it — the Ruling 46 harm arriving from the
other direction.

**The residual that leaves, stated rather than glossed:** this screen's plan read and the caseload's
are byte-identical records, so the trail cannot be asked which of the two a reader used. That is a
property of the trail, not of the screen, and minting a screen-named member to work around it would
make the trail worse. Recorded here; the fix is an `objectId` filter on the trail's query surface.

The member that Reports **would** genuinely warrant is the one for the read it does not make — see
§1.4.

### `READ_ACTIONS.dispatch`

`reconcileProviderDispatch` was written inline in **both** stores' `listDispatches`. A reporting
screen must ask the same question the store asked, because an empty dispatch list means "you may not
see these" and "there are none" alike. Rather than add a third copy in the page, I added
`dispatch: "reconcileProviderDispatch"` to `READ_ACTIONS` and pointed both stores and the page at it.
Three call sites, one source.

---

## 5. Findings — where the tree does not match what I was told

### 5.1 The Task 12 pin is real, but not on this branch — corrected

The brief told me to use a pin keeping the `z.enum` in
`src/app/api/caring-contacts/access-trail/route.ts` in step with `AccessedObjectType`. I reported it
missing. **Both halves were true and the coordinator has confirmed which is which: the pin exists on
`claude/caring-contacts-schedule`, and arrives at merge. It is not in this tree.**

What is true here, and worth knowing if you are on this branch: only three files mention
`trainingRecord` — the union in `access-audit.ts`, the hand-copied `z.enum`, and the two store
implementations that merely use the type. Nothing on this branch compares them.

**Nothing to build.** The coordinator is carrying it as a merge item. The reason it is recorded at
all is so **the next task to add an `AccessedObjectType` member looks on the right branch** rather
than concluding, as I did, that no guard exists and writing a second one. That matters soon: the
reach read over `cultural_identity_reports` is exactly the change that will add a member (§1).

### 5.2 A correction to the brief: the cultural-identity column is not untouched

The brief states that nothing populates the cultural-identity field. **That is very nearly true and
the exception matters.** `src/lib/caring-contacts-server/demo-seed.ts` writes `culturalIdentity` for
every seeded patient — the literal string `"Not stated"`, with a recorded rationale, namely that a
cultural identity attributed to an invented person is an invention about culture. The wizard sends
`null` unconditionally, so no clinician can populate it; but the column is written, and the API
schema still accepts `z.string().min(1).nullable()`.

**The consequence, spelled out, because it is the trap the owner's decision was about: a sentinel in
a free-text column is indistinguishable from a category to anything that counts categories.**
"Not stated" is a statement that no answer was recorded. A counting routine cannot see that — it sees
a distinct string with a frequency, exactly like "Aboriginal" or "Noongar" or a typo. So had this
screen rendered a breakdown, the demo would have shown **a single reach category called "Not stated"
with a count of three, presented as programme-reach reporting**, and it would have looked like data.
The same routine, run over a real free-text column, would have promoted every rare spelling and every
"declined to answer" into a category of its own — which is precisely why suppression presupposes a
bounded set, and why the owner declined a normalisation step that would silently have decided
membership.

Nothing on my screens reads the column, so nothing shows it. It is recorded here because "nothing
fills them" should not be read as "the column is empty" by whoever builds the read.

### 5.3 A sixth design value the types do not support — and two copy departures

The approved mockups' Guidance page carries `OneWayBoundary`, whose closing sentence is
"…never means the message was read **or the patient is safe**". That sentence **cannot be written in
this tree**: the interface-vocabulary scan refuses `safe` as a whole word, and the standing
constraints forbid exploiting the scan's known word-boundary inversion to slip it past. I rewrote it
to say the same thing without the word — what `Delivered` is, and the three things it is not — and
the test asserts the replacement's presence **beside** the word's absence, so a blank screen cannot
satisfy it.

Second, the design's language-rules table has a row reading "Use / Agreement", which is legible on a
design board beside its neighbours and not on its own. I wrote it out as the instruction it
abbreviates ("Say / Agreement — never consent."). Recorded rather than silently resolved.

**This is not a sixth instance of the five-values pattern.** I looked, and found no new value the
design shows arriving from a hospital record. The two items above are copy that a repo rule forbids
and copy that does not survive being read alone.

### 5.4 One approved-design measure I mapped rather than reproduced

The Reports design's four tiles are `Due / Dispatched / Named failures / Median resolution`. Three
map directly onto records this system holds and are built as such (day-scoped through the domain's
own AWST calendar day and its own sendability classification). **"Named failures — permanent
transport failures"** does not: the domain has no "permanent" classification of a contact state, and
inventing one would be a clinical-operational judgement. I built the measure the records do support —
dispatch **differences**: attempts examined, differences found, worked through, still open — which is
what `DispatchRecord`'s `expectedStatus`/`reportedStatus`/`discrepancyResolvedAt` actually describe,
and which is also where the median comes from. If "permanent failure" is meant to be a real category,
it needs deciding before a screen names one.

### 5.5 Never rank clinicians — checked, not assumed

Spec §4.2 forbids it. I checked the approved design for anything ordering people by output and found
nothing. `OperationalReport` carries no actor field to group by, so such a table cannot be assembled
from what the component is given; it would have to be written from scratch. Recorded in the
component's own note so the constraint and the design are recorded as having been checked against
each other rather than assumed to agree.

---

## 6. What I changed

| File                                                                                    | What                                                                                                                                    |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/caring-contacts/reach-reporting.ts`                                            | New. The §2.5 suppression rule; `reachReportingThreshold()` reads the owner's decision.                                                 |
| `src/lib/caring-contacts/reach-reporting-governance.ts`                                 | New. The owner's 2026-08-26 decision, with what it rests on and what it does not.                                                       |
| `src/lib/caring-contacts/operational-reporting.ts`                                      | New. Plan/contact rollups and dispatch-difference measures.                                                                             |
| `src/lib/caring-contacts/repository.ts`                                                 | `READ_ACTIONS.dispatch`.                                                                                                                |
| `src/lib/caring-contacts/in-memory-repository.ts`, `db/postgres-repository.ts`          | Both `listDispatches` now name the capability through `READ_ACTIONS`.                                                                   |
| `src/components/caring-contacts/workspace/programme-guidance.tsx`                       | New. The Guidance screen.                                                                                                               |
| `src/components/caring-contacts/workspace/operational-reports.tsx`                      | New. The Reports screen, including the reach section's three states.                                                                    |
| `src/components/caring-contacts/workspace/shell.tsx`                                    | More-panel `href`; derived phone-overflow row; one `MorePanelDestination` renderer; the panel's intro sentence, which had become false. |
| `src/app/caring-contacts/guidance/page.tsx`, `src/app/caring-contacts/reports/page.tsx` | New routes.                                                                                                                             |
| `tests/caring-contacts-reporting.test.ts`                                               | New. The domain half, centred on the inference attempt.                                                                                 |
| `tests/caring-contacts-guidance-reports-pages.dom.test.tsx`                             | New. Both pages, and the inference attempt over rendered rows.                                                                          |
| `tests/helpers/caring-contacts-reach-inference.ts`                                      | New. The attack, in one place.                                                                                                          |
| `tests/caring-contacts-workspace-shell.dom.test.tsx`                                    | `rendersAt`, its positive controls, and the phone-reachability assertion.                                                               |
| `tests/ui-caring-contacts-workspace.spec.ts`                                            | Two `WORKSPACE_SCREENS` entries and the block that proves them.                                                                         |
| `package.json`                                                                          | The two new suites added to `test:cc-guards`.                                                                                           |
| `docs/codebase-index.md`, `docs/site-map.md`                                            | The two routes, the More-panel capability, and why the reach section reads nothing.                                                     |

`docs/caring-contacts/phase-2b-build-record.md` was not touched.

---

## 7. What `tests/ui-caring-contacts-workspace.spec.ts` needs — you run that gate

I have written it; this is what it now contains, so you know what you are running.

Two entries in `WORKSPACE_SCREENS` (`Guidance`/`Guidance`, `Reports`/`Reports`) with `GUIDANCE_SCREEN`
and `REPORTS_SCREEN` beside the existing constants — required, because
`tests/caring-contacts-workspace-screens.test.ts` goes red offline the moment a production workspace
route has no entry. Each route constant carries its own note on what this server renders. The
`WORKSPACE_SCREENS` doc comment's list of which block proves which screen was extended (it had
already fallen behind — it did not name the templates block either).

One new block, `caring-contacts guidance and reports`, with seven tests:

1. Guidance serves 200, renders its `h1`, and states the one-way boundary.
2. Reports serves 200, renders its `h1`, and the reach section states the field is not collected —
   with `caring-contacts-reach-breakdown` at count 0 and no `Suppressed` anywhere in the section.
   **This is the end-to-end form of the assertion the task turns on.** It also asserts that the
   governance-set minimum cell size is stated on the same screen, so a reader can see that what is
   waiting is the categories and not the rule.
3. Reports is reached by clicking the More panel at 1024px.
4. **Templates, Guidance and Reports are all reachable at 390px**, with the rail hidden and the dock
   visible, and Templates is clicked through. This is the defect closed in a browser.
5. Both screens at 320px: no horizontal overflow, correct width state, dock visible.
6. Reports in dark: shell chrome plus the reach section's own surface and ink, compared against
   light, with no colour resolving to transparent.
7. Reports under forced colours at 390px: the statement still readable, the section's border still
   painted, no overflow.

**One risk to watch on your run.** Tests 3, 4 and 6 use `openWorkspace`, which asserts
`caring-contacts-rail` has count 1 before proceeding. At 390px the rail is `hidden` but still in the
DOM, so the count holds — that is the existing templates block's own pattern at 320px, so I expect
it to behave. If test 4 fails on that assertion rather than on a link, it is the helper and not the
navigation.

---

## 8. Verification

Gate: `npm run test:cc-guards` for the whole-tree runs, plus the narrowed per-mutation selections the
mid-task instruction asked for. The full `npm run test` is yours at the merge point; it was not run.

### What ran, and what it said

**`npm run test:cc-guards`, on the tree before the governance decision arrived:**

```
 Test Files  24 passed (24)
      Tests  496 passed (496)
```

**`npm run test:cc-guards`, re-run on the final tree** — because a gate's verdict covers the tree it
saw, and ordering is not the mechanism, re-running is. Run after every round's last source edit; the
line below is the last of them, and the only change made afterwards is this report, which none of
the twenty-four suites reads:

```
 Test Files  24 passed (24)
      Tests  503 passed (503)
```

496 → 500 → 503 across the three rounds, as the governance pins and then the review's three new cases
(the split floor case, the interval-span case and the no-control case) were added.

**`npm run typecheck`** (`tsc -p tsconfig.typecheck.json --noEmit`), run through the lease wrapper,
**after the last edit** — the tree it saw is the tree being handed over:

```
[gate-receipts] recorded a pass for "typecheck:internal" (5357 input files).
```

That count is one higher than the run before the governance change, which is the new module and is
the cheapest corroboration that the compiler saw it. It is unchanged across round 3, which is
correct — that round added no files, only edits.

`tsc` prints nothing on success, so that receipt line plus the wrapper's own exit status is the
whole of the evidence — stated exactly rather than dressed up as a summary line it does not emit.
It was captured from the command's own status, not through a pipe.

**`npx eslint --no-cache` on every changed source and test file** — no output, which is eslint's
clean result. `--no-cache` deliberately: `npm run lint` uses a per-file cache, so a file that has not
changed is not re-examined and a failure caused by a different file's change stays invisible locally.

**`npx prettier --check`** on every changed file, after the last edit:

```
Checking formatting...
All matched files use Prettier code style!
```

Formatting is in none of `test`, `typecheck` or `lint`, which is why it is checked separately.

**`npm run check:design-system-adoption`** — because two new production routes change a census:

```
design-system adoption checked: 54 components, 100 roots
```

### The lock, and one refusal that read as a pass

The first `test:cc-guards` attempt returned **exit code 0 having never run**:

```
Error: Database focused-test capacity is full (current owner PID 60368, worktree
C:\Users\joshs\.codex\worktrees\document-viewer-workspace-20260826\Database, ...):
playwright --project=chromium --grep-invert @quarantine|@mockup
...
[exited with code 0]
```

A refusal arriving through a pipe left `$?` reading 0 with no summary line. Recorded as UNRUN,
retried on a delay, and never forced past another worktree's lease. Every subsequent run captured
its status directly rather than through a pipe.

**Every refusal, itemised — no aggregate.** Four implementer worktrees plus another project shared
two slots for most of this session. Each row below is one attempt that was refused and retried;
none was forced.

Whole-set `test:cc-guards`, first retry loop (abandoned when the tree moved under it):

| Attempt | Time (AWST) | Owner of the lease                    |
| ------- | ----------- | ------------------------------------- |
| 1       | 11:43:25    | another worktree, Playwright chromium |
| 2       | 11:45:34    | same                                  |
| 3       | 11:47:39    | same                                  |
| 4       | 11:49:43    | same                                  |
| 5       | 11:51:48    | same                                  |

Whole-set `test:cc-guards`, second retry loop (the one that produced the 496-test run):

| Attempt | Time (AWST) | Outcome                            |
| ------- | ----------- | ---------------------------------- |
| 1       | 11:52:44    | refused                            |
| 2       | 11:54:54    | refused                            |
| 3       | 11:56:58    | refused                            |
| 4       | 11:59:03    | refused                            |
| 5       | 12:01:07    | refused                            |
| 6       | 12:03:16    | refused                            |
| 7       | 12:05:21    | refused                            |
| 8       | 12:07:29    | refused                            |
| 9       | 12:09:38    | **ran — `Tests 496 passed (496)`** |

Whole-set `test:cc-guards` after the governance change:

| Attempt | Time (AWST) | Outcome                            |
| ------- | ----------- | ---------------------------------- |
| 1       | 12:33:50    | refused                            |
| 2       | 12:35:55    | refused                            |
| 3       | 12:37:57    | **ran — `Tests 500 passed (500)`** |

Two typecheck attempts were refused, one of them by a lease whose owning PID was already dead and
whose `worktree` field was mine. I did not break it: the lock's own stale-lease reclamation cleared
it on a later attempt, and evidence adequate for waiting is not adequate for breaking a lease.

**Two aggregates I cannot itemise, and I am saying so rather than inventing rows.** The mutation
driver retries inside its own process and logged only a count, so M1's eight refusals on the earlier
whole-set configuration and M11's thirty on the narrowed one have no per-attempt record. That is a
gap in the driver, not a summary I chose. Every refusal after the narrowing was cleared on the first
or second attempt, and the final whole-set re-run of all eighteen rows hit none at all.

### Mutation testing

**The driver, and what it checks before it touches anything.** Rows are validated against an
**allowlist of files this task may mutate** and for **id uniqueness** before any file I/O; the tree
must be clean before a mutation and again after restoring it; the computed post-image must **differ
from the original** before it is written; and the file is **re-read from disk** and asserted
byte-identical to that post-image afterwards. Every anchor was dry-run first, so a row whose anchor
did not occur exactly once could not burn a lease to discover it. Every mutation was applied against
a committed tree, and only explicit paths were ever staged.

**Selection per row.** Each row ran only the suite(s) the mutation can move, through the same runner
and the same shared lease (`node scripts/run-vitest.mjs run <reporter> <suites>`). The column records
which. That narrowing is what unblocked the set: rows had come back UNRUN under whole-set runs, and
all of them ran once narrowed. The per-row runs cannot see collateral damage and do not claim to; the
full `test:cc-guards` set is what catches that, and it is run separately on the final tree.

**The whole set was re-run after the review fixes**, on the tree being handed over, because the
review changed both source and suites. The numbers below are that run. Predictions — count and named
assertion — were written down before it and every one of the eighteen matched.

| #   | Mutation                                                                                            | Suites          | Predicted                                                                                                                                                | Observed                                     |
| --- | --------------------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| M1  | `reach-reporting.ts`: remove complementary suppression — stop promoting further cells               | reporting+pages | RED on exactly 5: recovers-nothing (domain), hides-a-second-cell, withholds-when-hiding-everything, withholds-a-single-category, recovers-nothing (rows) | **RED — `Tests 5 failed \| 39 passed (44)`** |
| M2  | `reach-reporting.ts`: a lone suppressed cell is no longer treated as pinned                         | reporting+pages | RED on 4 — that set minus withholds-when-hiding-everything, which stays green because a zero residual still pins                                         | **RED — `Tests 4 failed \| 40 passed (44)`** |
| M3  | `reach-reporting.ts`: a zero residual no longer pins every suppressed cell                          | reporting       | RED on 1: withholds-when-hiding-everything                                                                                                               | **RED — `Tests 1 failed \| 23 passed (24)`** |
| M4  | `reach-reporting.ts`: lower the floor CONSTANT from 3 to 2                                          | reporting       | RED on 2 — the constant pin **and** the behavioural case at threshold 2, now that the two are separate cases                                             | **RED — `Tests 2 failed \| 22 passed (24)`** |
| M18 | `reach-reporting.ts`: disable the floor GUARD, leaving the constant untouched                       | reporting       | RED on 1: the behavioural case only, at threshold 0 — the constant pin stays green                                                                       | **RED — `Tests 1 failed \| 23 passed (24)`** |
| M5  | `reach-reporting.ts`: promote the LARGEST cell instead of the smallest                              | reporting+pages | RED on 1: hides-a-second-cell. Recovers-nothing stays green — two hidden cells over a residual of 14 are still unpinned                                  | **RED — `Tests 1 failed \| 43 passed (44)`** |
| M6  | `reach-reporting.ts`: an unconfigured threshold silently becomes a configured one                   | reporting       | RED on 1: withholds-for-the-absence-of-a-threshold                                                                                                       | **RED — `Tests 1 failed \| 23 passed (24)`** |
| M7  | `operational-reporting.ts`: drop the AWST day filter                                                | reporting       | RED on 1: scopes-the-day-measures                                                                                                                        | **RED — `Tests 1 failed \| 23 passed (24)`** |
| M8  | `operational-reporting.ts`: upper middle value of an even set instead of the mean of the middle two | reporting       | RED on 1: the median case, `expected 50 to be 40`. The 600-minute span case is odd-length and stays green                                                | **RED — `Tests 1 failed \| 23 passed (24)`** |
| M9  | `operational-reporting.ts`: drop BOTH null guards on a difference                                   | reporting       | RED on 1: counts-a-difference-only-where-both-known, `expected 3 to be 1`                                                                                | **RED — `Tests 1 failed \| 23 passed (24)`** |
| M10 | `operational-reporting.ts`: report a median of zero when nothing has been worked through            | reporting       | RED on 1: says-nothing-has-been-worked-through                                                                                                           | **RED — `Tests 1 failed \| 23 passed (24)`** |
| M11 | `shell.tsx`: hide the phone-overflow row below 768px instead of above it — the shipped defect, back | shell           | RED on 1: the phone-reachability assertion, naming `/caring-contacts/templates`                                                                          | **RED — `Tests 1 failed \| 11 passed (12)`** |
| M12 | `shell.tsx`: render no phone-overflow row at all                                                    | shell           | RED on 2: the More-panel destination set, and phone reachability                                                                                         | **RED — `Tests 2 failed \| 10 passed (12)`** |
| M13 | `operational-reports.tsx`: show a zero to a reader who may not see the measure                      | pages           | RED on 1: the may-not-see assertion                                                                                                                      | **RED — `Tests 1 failed \| 19 passed (20)`** |
| M14 | `caring-contacts-reach-inference.ts`: weaken the attack so it never reports a recovery              | reporting+pages | RED on 2: the positive control in each suite                                                                                                             | **RED — `Tests 2 failed \| 42 passed (44)`** |
| M15 | `reach-reporting-governance.ts`: move the threshold without moving the record that explains it      | reporting       | RED on 1: the provenance pin                                                                                                                             | **RED — `Tests 1 failed \| 23 passed (24)`** |
| M16 | `operational-reports.tsx`: retype the cell size on screen instead of sourcing it from the decision  | pages           | **GREEN** — over-sensitivity control                                                                                                                     | **GREEN — `Tests 20 passed (20)`**           |
| M17 | `reach-reporting.ts`: make the lookup return its own number instead of reading the decision         | reporting       | **GREEN** — the same control from the other side                                                                                                         | **GREEN — `Tests 24 passed (24)`**           |

**The floor is now proven, and it was not before.** The first report claimed the suppression rule was
"mutation-proven in all four of its parts" on the strength of M1/M2/M3/M5 plus M4. **M4 did not prove
the floor.** The pin `expect(MINIMUM_SUPPRESSING_THRESHOLD).toBe(3)` sat ahead of the behavioural loop
in the same case, so lowering the constant reddened the pin and **the loop was never reached** — the
enforcement inside `discloseReach` had no mutation covering it at all, and my own ledger recorded the
symptom ("failing at its first assertion") without drawing the conclusion. That is the standing rule
_an assertion behind a sibling that fails first is never reached_, hit and then written down as if it
were fine.

Split into two cases, both halves are now covered and the messages show it. M4 reaches the loop:

```
AssertionError: expected 2 to be 3 // Object.is equality
AssertionError: threshold 2: expected { kind: 'breakdown', …(1) } to deeply equal { kind: 'withheld', …(1) }
```

and M18 exercises the guard with the constant left alone, which is the coverage that did not exist:

```
AssertionError: threshold 0: expected { kind: 'breakdown', …(1) } to deeply equal { kind: 'withheld', …(1) }
```

**So the rule is proven in five parts**: complementary suppression (M1), the lone-hidden-cell rule
(M2), the zero-residual rule (M3), the promotion order (M5), and the floor — constant (M4) and guard
(M18) separately. Each reddens a different assertion, so no part rests on another part's coverage.

M1's five, which remain the ones that matter most:

```
AssertionError: expected [ 'Torres Strait Islander' ] to deeply equal []
AssertionError: expected [ 'Torres Strait Islander' ] to deeply equal [ 'Torres Strait Islander', 'Neither' ]
AssertionError: expected { kind: 'breakdown', …(1) } to deeply equal { kind: 'withheld', …(1) }
AssertionError: expected { kind: 'breakdown', …(1) } to deeply equal { kind: 'withheld', …(1) }
AssertionError: expected 1 to be greater than 1
```

The first line is the whole claim of §2: with complementary suppression removed the rule degrades to
naive suppression, and **the inference attempt recovers the hidden cell by arithmetic** — from the
disclosure value, and, in the last line, from the rendered rows, where only one cell was left hidden.

M12 confirms the More panel's overflow row is load-bearing rather than decorative:

```
AssertionError: /caring-contacts/templates has no link a phone can reach — it is an orphan below 768px:
expected false to be true
```

**On M16 and M17, which are GREEN on purpose.** Over-sensitivity controls, not misses. Both replace a
sourced value with the literal `5` — today's decided value — so nothing observable changes, and a red
here would have meant a test asserting against the literal rather than against the record. They go red
the day the decision moves, which is exactly when sourcing matters. A mutation that should leave a gate
green is evidence too, and it belongs in the ledger beside the reds.

**Nothing is unrun.** Every row defined for this task ran on the final tree.

---

## 9. Concerns

1. **The reach report is smaller than spec §2.5 promises, and the threshold decision did not close
   that.** The screen is honest, but "honest about a gap" is not the same as delivering the section.
   What remains is a bounded category set and a collection path; §1 says what shape they need.
2. **"Cannot be moved silently" is not "cannot be moved" — ruled, and left open deliberately.** The
   only thing making a change to the threshold deliberate is a test that pins the value together with
   its provenance, and one commit can edit both. The owner has ruled this proportionate for a
   prototype holding no real data; the recommendation (a second approver at minimum, and a
   superseding record rather than an in-place edit) is written into §1 for whoever operationalises
   it. Not a defect — a known, accepted limit.
3. **The `z.enum` hand-copy is unguarded ON THIS BRANCH (§5.1).** The pin exists on
   `claude/caring-contacts-schedule` and arrives at merge; the coordinator is carrying it. Recorded
   so the next task to add an `AccessedObjectType` member looks there rather than writing a second
   guard — which is the mistake my own report nearly caused.
4. **`shell.tsx` will conflict.** It is shared with live branches and I changed both the
   `MORE_DESTINATIONS` shape and the panel's render. The `PHONE_OVERFLOW_DESTINATIONS` derivation is
   the part worth preserving through any merge; a hand-written list restores the defect.
5. **`package.json` will conflict too**, for the two `test:cc-guards` entries.
6. **The demo seed writes a free-text sentinel into the cultural-identity column (§5.2).** Nothing on
   my screens reads it. It is worth deciding whether the seed should stop writing it, now that the
   input is gone — a column written only by a seed is a column that will surprise someone.
7. **`rendersAt` is a model of the CSS, and a narrow one.** It throws on any display variant it does
   not know, which is the right failure direction, but it models display utilities ONLY — `sr-only`,
   `invisible`, `opacity-0`, a clipped or zero-size ancestor and the `hidden` attribute all pass it
   silently. The 390px browser block is the only thing covering that, and it has not been executed.
8. **A time-to-triage measure does not exist and cannot be built here.** `DispatchRecord` holds no
   difference-detected instant, so the dispatch measure spans the whole attempt. The wording now says
   so on both sides, but if the programme actually wants triage time, that is a repository contract
   change with its own review.
9. **The temporal differencing axis is open.** Two reach reports taken at different times over a
   growing population can be differenced. No live exposure today, because the section discloses
   nothing — but it needs a decision about what a reach report is _as at_ before it ever does.

---

## 10. Round 2 — what the coordinator asked for after the first report

**1. The nine unrun mutations.** Run, on the narrowed selection, all nine RED, every predicted count
and every named assertion matching. The suppression rule is now proven in all four of its parts
rather than one; the row that mattered most, M3 (the residual-zero rule), reddens with
`expected { kind: 'breakdown', …(1) } to deeply equal { kind: 'withheld', …(1) }`. **Nothing from
this task's mutation set is left unrun.** Full table and messages in §8.

The narrowing is what did it. The same rows had come back UNRUN or unattempted against the whole
24-suite set; every one of them ran on the suite it targets. Two rows still needed retries — M1 after
eight refusals, M11 after thirty — and both were retried rather than forced. No lease was broken at
any point.

**2. The pin.** §5.1 rewritten: it exists on `claude/caring-contacts-schedule` and arrives at merge,
and it is not in this tree. Nothing built; the coordinator is carrying it. Recorded so the next task
to add an `AccessedObjectType` member looks on the right branch instead of writing a second guard.

**3. The demo-seed sentinel.** §5.2 rewritten as an explicit correction to the brief, with the
consequence spelled out: **a sentinel in a free-text column is indistinguishable from a category to
anything that counts categories.** Had this screen rendered a breakdown, the demo would have shown a
reach category called "Not stated" with a count of three, and it would have looked like data.

**4. The second-approver recommendation.** Ruled recorded-not-built. §1 carries the recommendation
where the threshold lives, and `reach-reporting-governance.ts`'s own note now says the gap is
accepted rather than outstanding — so a reader of the code does not take it for an open action.

### Re-verification after the last edit

All three after the final source edit — the note added to `reach-reporting-governance.ts`, which was
round 2's only change to source:

```
Checking formatting...
All matched files use Prettier code style!
```

```
[gate-receipts] recorded a pass for "typecheck:internal" (5357 input files).
```

```
 Test Files  24 passed (24)
      Tests  500 passed (500)
```

`npx eslint --no-cache` on the changed file produced no output, which is its clean result. Both gates
were admitted on the first attempt this time; the contention that dominated the earlier rounds had
cleared. Every commit SHA in this report was re-checked with `git cat-file -e <sha>^{commit}` after
the final commit.

---

## 11. Round 3 — the review's findings

### 11.1 A measure labelled as an interval it does not compute — fixed in the wording

The tile read **"Median minutes to resolve"** with the note _"From a difference to its recorded
outcome"_, which a reader takes as time-to-triage. It never was that. `DispatchRecord` carries
`startedAt` — the **dispatch attempt's** start — and `discrepancyResolvedAt`, and **no
difference-detected instant at all**. So the number spans attempt start to resolution recorded, and
the whole carrier round-trip that happened before the difference existed sits inside it.

**No assertion could have caught it**, because every test derives its expected value from `startedAt`
too: the arithmetic and the assertions agreed with each other while both disagreed with the words on
the screen. That is the classic reporting defect — internally consistent and externally false — and
it is the reason the correction is in the wording on both sides rather than in a gate:

- the field is now `medianMinutesFromAttemptToResolution`, named the long way on purpose: a short
  name reads as time-to-triage;
- the tile reads **"Median minutes, attempt to resolution"**, noted _"Whole attempt, carrier
  round-trip included"_;
- `operational-reporting.ts` carries the full note, including that no test can catch a mislabelling
  here;
- and one test now pins the **span** as a number rather than leaving it to the field name: a record
  resolved ten hours after its attempt began yields 600.

**Reported, not built:** a genuine time-to-triage measure needs a difference-detected instant on
`DispatchRecord`. That is a repository contract change — it touches the shape both stores implement
and the contract suite that exercises them — and it wants its own review. I have not built it.

### 11.2 M4 did not prove the floor, and §8 overclaimed by one part

Correct, and worse than it looked: the enforcement inside `discloseReach` had **no mutation covering
it at all**. `expect(MINIMUM_SUPPRESSING_THRESHOLD).toBe(3)` sat ahead of the behavioural loop in the
same case, so lowering the constant reddened the pin and the loop was never reached. **My own ledger
row recorded the symptom — "failing at its first assertion" — without drawing the conclusion**, which
is the part worth naming: the evidence was in front of me and I filed it as a detail.

Fixed both ways the review offered, because they cover different things: the constant pin is now its
own case, and **M18** mutates the guard while leaving the constant alone. §8 now claims five parts,
with M4 and M18 reddening independently, and §1's "the floor holds either way" is corrected to say
the earlier claim was unproven.

### 11.3 The most important line contradicted the code beneath it

`reports/page.tsx` still said the threshold has nowhere to live — **inside the diff that gave it
one**, on the line the file itself calls its most important. Rewritten to say which half of §2.5 is
configured and which is not, and to record that it was wrong for one commit and why: the standing
rule is _when a diff changes what a mechanism does, read every doc comment in the files it touches_,
and nothing else catches this.

I also swept the rest of the tree for the same stale claim — `nowhere for`, `no configuration
surface`, `not yet hold`, `ready for the day a threshold` — and found no other instance.

### 11.4 The census claimed proofs that are unrun, and one that was absent

**The print test was genuinely missing** — every earlier caring-contacts block has one. Added two:
Reports must keep the synthetic marker, its `h1` and the reach statement on a printed page with no
breakdown appearing, and Guidance must keep the marker and the one-way boundary panel. A printed
report that has lost the reach statement is a page of operational figures with a silent gap where
programme reach should be, and a reader supplies their own reason for the silence.

**On honesty about what is unrun:** the contract schema has no state between `passed` and
`not-applicable` — `checkAdoptionManifest` fails a v2 surface whose proof is anything but `passed` —
so the status could not be downgraded without failing the gate. The entry now carries an
`unverifiedProofNote` recording, in the file itself, that the block covering these two routes has
never been executed and that the passed statuses are declared-and-unrun for them. `check:design-system-adoption`
accepts it. If you would rather the schema grew a real state for this, that is a design-system change
and I have not made one.

### 11.5 Half the cross-filter defence was a paragraph — now pinned, and the temporal axis recorded

The **filter axis** is now a test: any interactive element inside the reach section fails it,
whatever the control is called, with the not-collected statement asserted beside it as a positive
control so it is not an absence over a region that failed to render. `reach-reporting.ts` names the
test rather than only arguing the point.

The **temporal axis is not closed, and I am recording it rather than implying otherwise.** Two
reports taken at different times over a growing population can be differenced exactly as two
differently-scoped reports can, and nothing here or on the screen prevents it. There is no live
exposure — the section discloses nothing at all — but it is an open gap. Closing it needs a decision
about what a reach report is **as at**: a frozen reporting period, or a published as-at instant that
makes two reports comparable rather than differenceable. That is a governance-shaped decision, not an
implementer's.

### 11.6 The minors

- **Site map:** both routes now carry real prose in `descriptionMap` and `docs/site-map.md` is
  regenerated.
- **`rendersAt`:** its comment now says what it does **not** model — `sr-only`, `invisible`,
  `opacity-0`, `visibility`, a clipped or zero-size ancestor, an off-screen transform, a stacking
  overlay, or the plain `hidden` attribute. It fails closed on an unrecognised display _variant_,
  which is narrower than failing closed on an unrecognised way of hiding something, and the only
  thing covering that gap is the 390px browser block.
- **M9's label** corrected: it drops **both** null guards, which is what yields `expected 3 to be 1`.
- **Lock refusals** are now itemised per attempt in §8, with the two counts I cannot itemise named as
  a gap in the driver rather than presented as a summary.
- **The two live recommendations** — a second approver on the threshold, and the repo-wide
  rendered-DOM reachability gap — are noted as queued by the coordinator at merge. They stay written
  here so a code reader following the pointer finds the reasoning, but this report is not their home.

### Re-verification after the last edit

Every mutation re-run on the final tree (all eighteen, §8). `prettier --check`, uncached `eslint`,
`npm run typecheck` and the full `npm run test:cc-guards` all run after the last source edit; lines
in §8. Every commit SHA re-checked with `git cat-file -e <sha>^{commit}`.
