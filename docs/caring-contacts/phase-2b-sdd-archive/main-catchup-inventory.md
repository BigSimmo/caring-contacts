# Main catch-up inventory — what `origin/main` holds that this trunk does not

Written before the catch-up merge of `origin/main` into
`claude/browser-test-gate-handoff-d5c1db`, so the merge can be audited against it afterwards.

|                                                     |                                            |
| --------------------------------------------------- | ------------------------------------------ |
| Trunk HEAD at survey                                | `8fe77d59e0c54dc4562cbbfe92ab8ce4d396671e` |
| `origin/main` at survey                             | `424db172e8ca650010b49d9f13b109c4defbef5a` |
| Merge base                                          | `a5935dde2778f34e4991f4f2dd8061f8d3043cf5` |
| Divergence                                          | trunk 226 ahead, 31 behind                 |
| Conflicts reported by `git merge-tree --write-tree` | 26                                         |

The two `main` commits that touch caring-contacts are both squash merges of work cut from this
trunk, which is why so many conflicts are `add/add` — the file has no common ancestor even where the
content largely agrees:

- `82f20e64d` — Phase 2B foundation: approved copy changes, shared empty state, overlay commit
  contract (PR #2350).
- `49642d65e` — the Caring Contacts Patients directory (PR #2354).

Everything below was established by reading the diffs, not inferred from the conflict list.

## Method

For each file, `main`'s own additions were isolated with
`git diff <merge-base> origin/main -- <path>` and then checked for presence in the trunk with
`git diff origin/main HEAD -- <path>`. A file whose `origin/main` → `HEAD` diff is empty already
carries everything `main` added; a file with lines on the `main` side needed a line-by-line decision.

## Summary of main-only findings

| #   | Finding                                                           | Class                                       | Recovered into the merge?      |
| --- | ----------------------------------------------------------------- | ------------------------------------------- | ------------------------------ |
| 1   | Overlay double-activation guard (`consumeWorkspaceOverlayCommit`) | **Race / correctness on mutating overlays** | **Yes**                        |
| 2   | The two tests that prove finding 1                                | Test coverage for finding 1                 | **Yes** (auto-merged)          |
| 3   | Patients directory privacy split — names out of GET URLs          | **Privacy — unresolved, owner decision**    | **No — flagged below**         |
| 4   | Ward Flow sandbox move fallout in two shared test files           | Main's non-caring-contacts work             | **Yes**                        |
| 5   | `ConfirmDialog` no longer reference-only in the census            | Main's non-caring-contacts work             | **Yes**                        |
| 6   | Ruling 88 rename corrections in two Task 1 archive documents      | Doc correctness                             | **Yes**                        |
| 7   | `serviceStateReferences` — a TypeScript-AST client-graph guard    | Superior alternative implementation         | **No — recommended follow-up** |

---

## 1. Overlay double-activation guard — RECOVERED

**Files:** `src/components/caring-contacts/workspace/overlays/overlay-commits.ts`,
`src/components/caring-contacts/workspace/overlays/workspace-overlays.tsx`

`main` adds a `consumedCommitTokens` set and a `consumeWorkspaceOverlayCommit(token)` function, with
the comment _"Claiming a commit must be synchronous: two clicks can both arrive before the browser
finishes the history traversal that closes the overlay."_ It claims a staged commit exactly once
without clearing the slot before the close traversal completes, so a second activation is a no-op
rather than a duplicate write.

`workspace-overlays.tsx` is the consumer. `main` rewrites `recordDecision` to:

1. close immediately for a non-mutating overlay (`definition.mutatesState === false`) instead of
   throwing on the missing commit;
2. claim the commit atomically through `consumeWorkspaceOverlayCommit(entryCommitToken)`;
3. return silently when the token is already consumed or stale.

**Why it matters.** `WORKSPACE_OVERLAY_DEFINITIONS` marks `final-activation`, `pause`, `withdrawal`
and `reassignment` as `mutatesState: true`. Without the guard, two clicks landing inside one history
traversal both reach `commit.record(...)`. On a suicide-prevention prototype these are the overlays
that stop, pause or reassign a patient's contact plan.

**Applicability to the trunk.** Both symbols `main` depends on already exist here — `definitions.ts`
declares `mutatesState`, and `workspace-overlays.tsx` already computes `entryCommitToken`. `main`'s
hunks apply directly with no branch line removed.

**Resolution.** Trunk text as the base, `main`'s additions layered on: the `consumedCommitTokens`
set, the two `delete` calls in `stageWorkspaceOverlayCommit`, the one in
`clearStagedWorkspaceOverlayCommit`, the whole of `consumeWorkspaceOverlayCommit`, and `main`'s
`recordDecision` body.

## 2. The tests that prove finding 1 — RECOVERED (auto-merged)

**File:** `tests/caring-contacts-overlay-host.dom.test.tsx` (not conflicted; git's three-way merge
restores these because the trunk never edited that region)

Two `main`-only tests:

- `"lets an unstaged recovery action close its URL-opened overlay"` — the non-mutating path.
- `"records a staged mutating action only once while its close traversal is pending"` — fires two
  clicks and asserts `expect(record).toHaveBeenCalledTimes(1)`.

Plus the `fireEvent` and `openWorkspaceOverlayWithCommit` imports they need. **These tests fail
unless finding 1 is also taken**, which is the consistency check for the resolution above.

## 3. Patients directory privacy split — NOT RECOVERED, OWNER DECISION

This is the one item this merge does not resolve, and it is deliberately left for the owner rather
than guessed at.

**Files `main` has that this trunk does not:**

- `src/components/caring-contacts/workspace/patients-directory-client.tsx` (417 lines, `"use client"`)
- `src/components/caring-contacts/workspace/patients-directory-row.ts` (15 lines)
- `src/lib/caring-contacts/patients-directory-filter.ts` (31 lines)

All three were created **only** in `49642d65e`; `git log --diff-filter=A` finds no other commit that
adds them, so they never existed on this trunk. They are a review fix applied on the PR branch after
it was cut.

**What the fix is.** `main` splits the directory into a server-owned data-minimisation boundary and a
small client island:

- `patients-directory.tsx` derives an explicit scalar DTO (`PatientsDirectoryRow`) so raw
  `PlanRecord` objects — which also hold team, pathway, outcome, version and every planned contact —
  never cross to the client.
- `patients-directory-client.tsx` keeps the name search as `useState`, and states the reason:
  _"putting a name in a GET query would copy patient information into browser history and request
  logs, which the workspace's binding privacy contract forbids."_
- `parsePatientsDirectoryFilter` on `main` returns `{ state }` only. There is no `q`.

> **RESOLVED 2026-08-26 — this finding is a record of what the merge found, and it is no longer true
> of the tree.** The owner ruled that Ruling [111] (a patient-confidentiality contract) outranks
> Ruling 13 (a client-payload preference) and that `main`'s approach be adopted. It was, on this
> branch: `patients-directory.tsx` is now the server wrapper, `patients-directory-client.tsx` is the
> adopted client island, and `parsePatientsDirectoryFilter` in
> `src/lib/caring-contacts/patients-directory-filter.ts` is the parser in use. The paragraphs below
> are left in the past tense as the record they were written to be. Two things went FURTHER than
> `main`: a bookmarked search parameter is now **stripped by a server redirect** rather than merely
> ignored (ignoring it left the name in the address bar, which `overlayUrl()` then copied into every
> overlay history entry), and the screen states that a saved search was not applied without echoing
> it. See `docs/caring-contacts/phase-2b-sdd-archive/task-privacy-url-report.md`.

**What this trunk did instead, before the fix.** `patients-directory.tsx` was a 589-line Server
Component with no client boundary at all, per Ruling 13 ("this workspace's client payload to a
rounding error"). Its filter type was `{ state, query }`, `patientsDirectoryHref` wrote `?q=<value>`,
the search was an ordinary `method="get"` form, and since `3450ebcb8` ("name the people on the
caseload, from the narrow read", Ruling 91) `matchesFilter` matched the **patient's name** as well as
the three synthetic identifiers.

**The consequence, stated plainly.** On this trunk as merged, typing a patient's name into the
caseload search produced `/caring-contacts/patients?q=Jordan%20Nguyen`. That name then reached
browser history, the `Referer` header and any request log in front of the app. `main` fixed exactly
this; the trunk had never received the fix and had independently widened the same search to cover
names.

**That merge did not cause the defect** — it was already the state of `HEAD` — but the merge was the
moment at which the choice to adopt `main`'s fix fell due, so it was recorded here rather than passed
over. The choice was made, and it was to adopt.

**Main-only tests lost with it** (in `tests/caring-contacts-patients-directory.dom.test.tsx`) — each
now has a replacement in that file, written against the adopted architecture rather than restored
verbatim:

- `"ignores a legacy query parameter rather than passing patient text into the directory"` —
  `parsePatientsDirectoryFilter({ q: "Jordan Nguyen", state: "active" })` must equal
  `{ state: "active" }`.
- `"never exposes the patient-name search as a GET form or URL parameter"` — asserts there is no
  `<form>`, that the searchbox carries no `name` attribute, and that no link href contains the name.
- `"crosses the client boundary with only the rendered, searched or pre-derived row fields"` — an
  exact-key regression test on the DTO.
- `"filters identifying rows before the client boundary"`.

**Why it is not resolved here.** Adopting `main`'s architecture is a refactor, not a merge hunk: the
trunk's directory has since gained Task 6's `<Link href={patientRoute(...)}>` row control, the
role-restriction notice driven by `mayViewPatientNames`, the split suppressed/absorbed contact
counting and a third empty-state kind — none of which exist in `main`'s 417-line client. Reverting to
`main` would drop all of it; porting `main` into the trunk's component is a task with product
consequences. Two documented rulings genuinely conflict (Ruling 13 versus the privacy contract `main`
cites), and that is the owner's call, not a merge resolution.

**Disposition in this merge.** The trunk's `patients-directory.tsx`, `page.tsx` and directory test
are kept. `main`'s three new modules are **kept in the tree, currently unreferenced**, so the fix stays
visible to the owner rather than being deleted; they compile, nothing renders them, and they are in no
bundle.

Keeping `patients-directory-client.tsx` is not free, and the workspace's own guard is what said so.
`tests/caring-contacts-explained-automation.dom.test.tsx` asserts exact set equality between the
`"use client"` files under `src/components/caring-contacts/workspace/` and `ALLOWED_CLIENT_COMPONENTS`,
so an unlisted client component fails it. The file is therefore listed, with a comment stating plainly
that it is `main`'s unadopted island and that nothing renders it. That is a truthful entry rather than a
weakened guard: the set-equality check still refuses any other unlisted client component, and the
module-graph check still proves this file and everything it imports never name the service-state module
or type (verified — its graph reaches `automated-state`, `list-empty-state`, `unavailable-destination`
and `patients-directory-row`, and `list-empty-state`'s single `ServiceStateBanner` mention is prose
inside a block comment, which `stripSourceComments` removes).

Restoring `main`'s versions verbatim, if the island is adopted:

    git show 49642d65e:src/components/caring-contacts/workspace/patients-directory-client.tsx
    git show 49642d65e:src/components/caring-contacts/workspace/patients-directory-row.ts
    git show 49642d65e:src/lib/caring-contacts/patients-directory-filter.ts
    git show 49642d65e:src/app/caring-contacts/patients/page.tsx
    git show 49642d65e:tests/caring-contacts-patients-directory.dom.test.tsx

**Recommended follow-up:** decide between (a) porting the client island onto the trunk's component,
(b) dropping name matching from the URL search so only synthetic identifiers travel, or (c) an
explicit ruling that names in this prototype's URLs are acceptable. Do not leave it undecided.

**Related, and superseded rather than lost:** `main`'s page records the names read as
`{ kind: "search", objectType: "patientDirectory", objectId: "names" }`. The trunk uses
`{ kind: "search", objectType: "patientName", objectId: "all" }`, which is a _later_ correction —
`patientDirectory` already carried two referral reads, so the trail could not be queried for "who
read patients' names". The trunk's form is strictly better. No loss.

## 4. Ward Flow sandbox move — RECOVERED

**Files:** `tests/route-reachability.test.ts`, `tests/design-system-adoption.test.ts`,
`scripts/generate-site-map.ts`

Not caring-contacts. `main`'s other 31 commits moved every Ward Flow route from
`src/app/ward-management/**` to `src/app/mockups/ward-flow/**`, which takes the whole prototype out
of the production census. `main` therefore:

- removes the `/ward-management/constellation` reachability allowlist entry outright (repointing it
  would trip `main`'s own "reachability allowlist has no stale entries" check, because
  `staticPageRoutes` excludes every `/mockups` route);
- removes the three narrowed Ward Flow reachability assertions (handover, escalation, search) for the
  same reason;
- removes the constellation surface assertions and the `NON_VISUAL_REDIRECT_PAGES` entry from the
  design-system adoption test;
- repoints `documentedRedirectTargets`, drops the Ward Management ownership row and drops the
  `/ward-management/patients/[patientId]` sitemap section in `generate-site-map.ts`;
- adds `/factsheets/topics` and `/calculators/search` route descriptions.

The trunk's competing edits to the same regions still name `src/app/ward-management/**`, which will
not exist after this merge. **`main` wins these hunks**; the trunk's caring-contacts additions to the
same files are layered on top.

Route census: `main` asserts `discovered` has length 68, the trunk asserts 82. Neither is right after
the merge — the merged tree is `main`'s route set plus the trunk's
`/caring-contacts/patients/[patientId]` and `/caring-contacts/plans/new`. The manifest is regenerated
and the count taken from it.

## 5. `ConfirmDialog` census change — RECOVERED

**File:** `tests/design-system-adoption.test.ts`

`main` empties `referenceOnlyComponents` and moves `ConfirmDialog` into the adopted set, because the
settings surface put its two destructive privacy actions behind a real confirmation on 23 Aug 2026.
The trunk still lists `ConfirmDialog` as reference-only. `main` is later; `main` wins.

## 6. Ruling 88 rename corrections — RECOVERED

**Files:** `docs/caring-contacts/phase-2b-sdd-archive/task-1-brief.md`,
`docs/caring-contacts/phase-2b-sdd-archive/task-1-report.md`

`main` corrects both to `src/components/caring-contacts/workspace/list-empty-state.tsx` /
`ListEmptyState`, and adds the note explaining why (`EmptyState` collided with the export in
`src/components/ui-primitives.tsx`, and the adoption generator's bare-`EmptyState` regex credited this
task's test as proof coverage for a shared primitive it never imports).

The trunk's copies still say `empty-state.tsx` / `EmptyState`. **They are factually wrong** — the
component on both sides is `list-empty-state.tsx`. `main` wins both files.

`task-3-report.md` differs only in Prettier table-column padding; identical content.

## 7. `serviceStateReferences` AST guard — NOT RECOVERED, RECOMMENDED FOLLOW-UP

**File:** `tests/caring-contacts-explained-automation.dom.test.tsx`

Both sides independently hardened the same guard — the check that no client module in the workspace
reaches the service-state module or the `ServiceState` type — after both found that architecture prose
in comments read as an offence to a raw text match.

- `main` (`49642d65e`, 2026-08-24 22:49 UTC) parses with the TypeScript compiler:
  `serviceStateReferences()` builds a `ts.createSourceFile` and walks for import declarations, dynamic
  `import()` calls and `ServiceState` identifiers. It ships a self-test proving a comment-only mention
  scores `{ module: false, identifier: false }` and a real import scores `{ true, true }`.
- This trunk (`32e0d7d65`, 2026-08-25 05:34 UTC, about seven hours later) wrote
  `tests/helpers/strip-source-comments.ts`, a 158-line character-by-character comment stripper that
  copies string literals through untouched, with extensive self-tests.

Neither is a lost safety fix — both guards work. But `main`'s is strictly more robust, and the trunk's
own test suite documents a hole in its version: _"pins the one place it errs UNSAFELY, so a green
suite cannot be read as closing it"_ (a trailing `//` comment containing a block-comment opener still
opens the block branch and hides the code after it).

**Disposition:** the trunk's version is kept, because it is wired to the trunk's actual client-module
list — which includes `plan-wizard/plan-wizard.tsx`, a module `main` has never seen — and swapping
guards mid-merge would strand the helper and its self-tests. `main`'s AST implementation is recorded
here with its SHA so it can be adopted deliberately. **Recommended:** replace `stripSourceComments`
with `serviceStateReferences` from `49642d65e`, which closes the documented hole.

---

## Files where `main` had nothing this trunk lacks

Byte-identical between `origin/main` and `HEAD`, so every `main` change to them is already here:

- `src/components/caring-contacts/workspace/list-empty-state.tsx`
- `src/components/caring-contacts/workspace/overlays/overlay-host.tsx`
- `src/components/caring-contacts/workspace/overlays/overlay-trigger.tsx`
- `src/components/caring-contacts/workspace/unavailable-destination.tsx`
- `src/lib/caring-contacts/message-copy.ts`
- `src/lib/caring-contacts/message-policy.ts`
- `src/lib/caring-contacts/message-rules.ts`
- `scripts/check-docs-links.mjs`
- `tests/caring-contacts-overlay-trigger.dom.test.tsx`
- `tests/caring-contacts-interface-vocabulary.test.ts`
- `tests/caring-contacts-message-policy.test.ts`
- `tests/caring-contacts-message-copy.test.ts`
- `tests/caring-contact-mockups.dom.test.tsx`

Superseded by later trunk work — every `main` line checked and found to be an earlier form of
something the trunk rewrote, with no unique behaviour:

- `src/lib/caring-contacts/repository.ts` — `main` adds `READ_ACTIONS.patientName`,
  `PATIENT_NAME_READ_ACTIONS`, `PatientNameProjection`,
  `PATIENT_NAME_PROJECTION_RELEASES_ONLY_THE_NAME` and `listPatientNames`. All five are present here,
  with expanded prose; the trunk additionally adds assurance attestations, `StoredPatientDetail`,
  `summariseStoredContacts` and `PLAN_RECORD_HOLDS_NO_FIRST_CONTACT_REASON`.
- `src/lib/caring-contacts/db/postgres-repository.ts` — `main`'s two-column narrowing in
  `listPatientNames` is preserved verbatim here (`select id, patient_name from caring_contacts.plans`),
  gated on `PATIENT_NAME_READ_ACTIONS`. The 25 other `main` lines are the pre-assurance form of
  `toPlanRecord`.
- `src/lib/caring-contacts/in-memory-repository.ts` — trunk is a strict superset (0 main-only lines).
- `src/components/caring-contacts/workspace/shell.tsx` — `main`'s primary control is an
  `UnavailableDestination`; Task 7 built `/caring-contacts/plans/new`, so the trunk's is a `<Link>`.
  Ruling 89 requires the link and the screen to land together.
- `tests/caring-contacts-workspace-shell.dom.test.tsx` — `main` asserts the primary control is an
  unavailable button and counts 14 unbuilt destinations; both superseded by Task 7.
- `tests/caring-contacts-patients-page.dom.test.tsx` — `main`-only lines are the older
  `patientDirectory`/`names` audit assertions, superseded per finding 3.
- `tests/ui-caring-contacts-workspace.spec.ts` — the trunk generalises `emptyStateColours` with a
  label parameter and adds the patient-overview and new-plan screens; `main`'s `New plan` button
  locator is superseded by the Task 7 link.
- `tests/caring-contacts-empty-state.dom.test.tsx` — `main` uses `<a href="/…">`, the trunk uses
  `<Link>`. The repo forbids a raw `<a href>` to an internal route, so the trunk's is correct.
- `docs/caring-contacts/phase-2b-build-record.md` — trunk is a pure superset (0 main-only lines).
- `docs/caring-contacts/phase-2b-sdd-archive/task-5b-report.md` — 27 main-only lines, all archive
  narrative describing the state of the PR at merge, including the sentence recording finding 3:
  _"A final PR privacy review replaced the original GET search because it put patient names into
  browser history and request logs; plan state remains the only URL-driven filter."_ Quoted here
  because the trunk's later revision of the same report describes the GET search instead, and splicing
  the two would make the archive self-contradictory. The commits it names, `85fb6db90` and
  `897a49fa0`, both exist in this repository.

## Generated files — regenerated, not hand-merged

`docs/site-map.md`, `docs/codebase-index.md`, `docs/scripts-index.md`,
`docs/design-system/ADOPTION.md`, `docs/design-system/adoption-contract.json`,
`docs/design-system/adoption-manifest.json` and `data/outstanding-issues-snapshot.json` are all
generated. They are regenerated from the merged tree rather than reconciled hunk by hunk.

`scripts/generate-site-map.ts` is **not** generated and is hand-merged per finding 4.

---

## Found during the merge itself, not in the survey

These are defects and trade-offs the survey could not see, because they only exist in the merged
result. They are recorded here so the merge commit is not the only place they are written down.

### A. `listPatientNames` was silently duplicated by the three-way merge

**File:** `src/lib/caring-contacts/db/postgres-repository.ts`

Both sides added `listPatientNames` to the Postgres store — `main` in the `49642d65e` squash, this
trunk independently — at different offsets in the same object literal. Git's three-way merge found no
textual conflict and kept **both**, producing two `async listPatientNames(context: ReadContext)`
members in one object. `npm run typecheck` caught it:

    src/lib/caring-contacts/db/postgres-repository.ts(2264,11): error TS2300: Duplicate identifier 'listPatientNames'.

This is the failure mode a conflict-list-only review would have missed entirely — the file was never
flagged as conflicted. The two method bodies were compared line by line and are **byte-identical**;
only the preceding doc comments differ, and the trunk's comment is a strict superset of `main`'s (same
two opening paragraphs, plus a third that narrows the claim from the page to this method and records
that `listPlans` still selects `PLAN_COLUMNS`). The duplicate was removed and the trunk's comment kept.
Nothing behavioural was dropped from either side.

### B. `recordDecision` trades Ruling 87's loud failure for the race guard

**File:** `src/components/caring-contacts/workspace/overlays/workspace-overlays.tsx`

`main`'s `recordDecision` was taken whole, because it is the consumer half of finding 1 and the two
recovered tests are written against it. It is not a pure gain, and the cost should be visible.

The trunk's version threw when a confirmed overlay had no recordable commit staged, and its comment
explains why: _"a confirm control that appears to work and writes nothing, which is precisely the
defect Ruling 87 exists to prevent. Loud is the conservative direction."_ `main`'s version returns
silently instead, because a null return from `consumeWorkspaceOverlayCommit` is also how the
double-click no-op is expressed — the two cases are indistinguishable at that call site.

So the merged code is louder about duplicate writes and quieter about missing ones. Distinguishing
"never staged" from "already consumed" is possible but is new behaviour beyond either side, so it was
not invented here. **Recommended:** decide whether Ruling 87's loud failure should be restored for the
never-staged case specifically.

### C. The site map's `/caring-contacts/patients` description understates the URL

**File:** `scripts/generate-site-map.ts`

The trunk's description — _"filtered by plan state or synthetic identifier through the URL"_ — predated
`3450ebcb8`, which widened the same URL search to match patient names. It was incomplete in exactly
the direction finding 3 is about. `main`'s competing description was accurate for `main`'s architecture
and false for this tree, so it could not be taken either. The trunk's text was kept verbatim rather
than rewritten, because the correct wording depended on how finding 3 was decided.

> **RESOLVED 2026-08-26.** Finding 3 was decided by adopting `main`'s split, so the description was
> rewritten and `docs/site-map.md` regenerated. It now says that only the plan state travels in the
> URL and that the search runs in the browser. The old wording had become a false statement about a
> privacy-relevant mechanism sitting in a generated document, which is worse than an incomplete one.

## Route census after the merge

`docs/design-system/adoption-contract.json` was rebuilt as `main`'s file (Ward Flow's twelve route
declarations and the constellation legacy-redirect surface removed, `/factsheets/topics` and
`ChoiceChip` added) with the trunk's one change layered on: `caring-contacts-workspace` declares four
routes rather than two. `npm run design-system:adoption:update` then reported **70 discovered routes,
0 undeclared, 0 missing** — `main`'s 68 plus `/caring-contacts/patients/[patientId]` and
`/caring-contacts/plans/new`. The assertion in `tests/design-system-adoption.test.ts` and its arithmetic
comment were updated from `main`'s 68 to that measured 70; the number was read from the regenerated
manifest, not predicted.

## Verification run on the merged tree

| Gate                             | Result                                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`              | pass, fresh run — `[gate-receipts] recorded a pass for "typecheck:internal" (5501 input files)`                |
| `npm run test:cc-guards`         | `Test Files 18 passed (18)` / `Tests 398 passed (398)`                                                         |
| Remaining caring-contacts suites | `Test Files 7 passed (7)` / `Tests 164 passed (164)`                                                           |
| Recovered race-guard test        | `✓ records a staged mutating action only once while its close traversal is pending`                            |
| Mutation proof of that test      | guard disabled → `expected "vi.fn()" to be called 1 times, but got 2 times`; restored                          |
| `npx eslint --no-cache`          | 13 changed files, exit 0; a JSON run confirmed 5 of them were actually inspected, 0 errors and 0 warnings each |

**Not run, and owed:** the full `npm run test` suite and every Playwright gate. Three implementers were
live in other worktrees throughout, and the exclusive heavy lease would have starved them — one focused
run was already refused mid-merge and had to wait for `cc-plan-detail` to release it. The broad suite
belongs to the owner once those worktrees are finished.
