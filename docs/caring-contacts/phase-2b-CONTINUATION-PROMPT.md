# Caring Contacts Phase 2B — continuation brief for a fresh session

**Read this file first, then the four documents in §1. Do not start work until you have read all five.**

Caring Contacts is a **suicide-prevention clinical prototype**: discharged patients receive a fixed schedule
of brief supportive messages. **Every patient in this build is fictional and nothing is ever sent to any
number.** Accuracy on anything clinical, privacy-related or patient-facing beats brevity every time.

You are the **controller** in subagent-driven development: you dispatch an implementer per task, review it,
run fix rounds, and accept it. You do not write the feature code yourself. Implementers run only
`npm run test:cc-guards`; the heavy gates are yours alone.

---

## 0. Why the previous session ended, and what that means for you

It stopped because the **Anthropic monthly spend limit was reached**. Three subagents were killed mid-flight
by an API error, not by any failure in the work:

| Agent                                | State when killed                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| Task 16 fix round 1 (`cc-templates`) | Had read nothing yet. **No work landed. Re-dispatch from scratch.**                     |
| Task P round-2 re-review             | Had read nothing yet. **No work landed. Re-dispatch from scratch.**                     |
| Task 11b (`cc-plan-detail`)          | **Code is committed and safe** — 4 commits, 2,248 lines. Only its report was unwritten. |

**Nothing has been pushed. No pull request exists. Nothing has been merged into `main`.** The owner has never
authorised a push for this phase; do not push, do not open a PR, and do not merge to `main` unless he says so
in this session.

---

## 1. Read these four, in this order

1. **`docs/superpowers/plans/2026-08-24-caring-contact-phase-2b-screens.md`** — the plan. Group 5 (Tasks 20
   and 21) is what remains unbuilt.
2. **`docs/caring-contacts/phase-2b-HANDOVER.md`** — branch state, what is built, traps.
3. **`docs/caring-contacts/phase-2b-sdd-archive/merge-checklist.md`** — **the most important document.** The
   merge is the highest-risk step left, and this file holds the dry-run conflict map, the resolutions, the
   measured test-gate hole, and the list of rounds nobody re-reviewed.
4. **`docs/caring-contacts/phase-2b-sdd-archive/STANDING-DISCIPLINE.md`** — the binding method contract. Every
   rule in it was bought by a specific shipped defect, and two of its sections are written for the controller
   specifically. Put it in every implementer and reviewer brief.

Then, as needed:

- **`docs/caring-contacts/phase-2b-build-record.md`** — Rulings [1]–[136], the decision record. Trunk-owned.
- **`docs/caring-contacts/interaction-matrix.md`** — the **frozen** 24-row overlay contract. Task 20 exists to
  reconcile against it.
- **`docs/caring-contacts/PROGRESS-LEDGER.md`**, `copy-decisions-recommended.md`, `accessibility-acceptance.md`.
- **`docs/superpowers/specs/2026-08-19-caring-contact-production-build-design.md`** — the spec the plan argues
  from. Where plan and spec disagree, **the spec wins**.

---

## 2. Where the work lives — five worktrees, and the documents are NOT all in one place

**This trips people up: each feature branch carries its own task briefs and reports.** The trunk does not have
them. Work from the branch, or read a file with `git show <branch>:<path>`.

| Worktree                                             | Branch                                                    | Holds                                                                        | Archive files unique to it                                                        |
| ---------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `.claude/worktrees/browser-test-gate-handoff-d5c1db` | `claude/browser-test-gate-handoff-d5c1db` — **the trunk** | Groups 0–1, the privacy fix, every ruling, every controller document         | `merge-checklist.md`, `main-catchup-inventory.md`, this file                      |
| `D:\Worktrees\Database\cc-templates`                 | `claude/caring-contacts-demo-seed`                        | demo seed · Task 15 templates library · Task 19 guidance/reports · Task 16   | `task-15-*`, `task-16-brief/report/`**`review`**, `task-19-*`, `task-seed-report` |
| `D:\Worktrees\Database\cc-schedule`                  | `claude/caring-contacts-schedule`                         | Task 12 schedule read · Task 13 schedule screen · Task 14 delivery exception | `task-12-report`, `task-13-report`, `task-13b-*`, `task-14-*`                     |
| `D:\Worktrees\Database\cc-plan-detail`               | `claude/caring-contacts-plan-detail`                      | Task 10 plan/contact detail · Task 11a wizard rows · Task 11b plan actions   | `task-10-report`, `task-11a-*`, `task-11b-brief`                                  |
| `D:\Worktrees\Database\cc-message-name`              | `claude/caring-contacts-message-name`                     | Task P — the patient's first name in the message                             | `task-p-brief`, `task-p-report`                                                   |

**Provisioning a new worktree takes seconds:** `node scripts/setup-codex-worktree.mjs`. **Never run `npm ci`
here — it takes about 58 minutes.**

The trunk was last at `7d77a1e43` and was **10 behind `origin/main`**. Main moves constantly; re-check rather
than trusting that number.

---

## 3. State of every task — verified against the tree, not recalled

**Accepted:** Tasks 10, 11a, 12, 13, 14, 15, 19. Task 14 was accepted at round 5, whose single item is proved
by a `tsc` error naming the client rather than by a test alone.

**Not accepted, and each needs something specific:**

- **Task 11b** (`cc-plan-detail`) — code committed at `ec4f6b1cb`, `f3ee88113`, `541345e8c`, `fe721ce70`
  (2,248 lines across `plan-action-rules.ts`, `plan-actions.tsx`, `patient-overview.tsx`, the patients page,
  and two test files). **CORRECTED 2026-08-27 (Ruling [137]): its report WAS written and its gates WERE
  run.** The report was sitting untracked in the worktree, complete, with pasted summary lines for the guard
  set, typecheck, uncached lint and Prettier, plus a mutation ledger. It is now committed unchanged as
  `9a64f7b6f`. The previous controller inferred its absence from the subagent's death rather than from the
  tree. **Task 11b needs a review and nothing else.**
- **Task 16** (`cc-templates`, at `79ce79dc4`) — **reviewed, and the review FAILED it on spec.** The fix round
  was dispatched and killed before it read anything. **Re-dispatch fix round 1** from
  `docs/caring-contacts/phase-2b-sdd-archive/task-16-review.md` on that branch, which lists every finding with
  file:line evidence. The controller's rulings on each are in §5 below.
- **Task P** (`cc-message-name`) — **NOT accepted.** Its round 2 changed `message-copy.ts`, the module holding
  the words a discharged patient reads, and **no re-review closed it**. The scoped re-review was dispatched
  and killed. **Re-dispatch it, and merge nothing until it returns.**

**Deferred by the owner — do not revive without asking him:** Group 4 (Tasks 17–18, the team roster), and Task
13b (per-row name reveal on the schedule; he chose to keep identifiers and defer the reveal once its cost was
made explicit).

**Not started:** Task 20 and Task 21.

---

## 4. The order of work from here, and why it is this order

1. **Finish Task 11b** — report, gates, review, accept.
2. **Finish Task 16** — fix round 1, then a scoped re-review.
3. **Re-review Task P round 2** — nothing merges before this returns.
4. **The merge**, exactly as `merge-checklist.md` §3 sets out. Its step 1 (`origin/main` → trunk) was **already
   done and audited** at `be06c7800`; redo it, because the trunk has drifted behind again since.
5. **The gates owed** (§6 below).
6. **Task 20**, then **Task 21** — both on the merged tree.

**Tasks 20 and 21 must NOT run before the merge (Ruling [133]).** Both produce a table _about the whole tree_:
Task 20 reconciles all 24 frozen matrix rows, Task 21 proves responsive and accessibility properties per
screen. The screens live on four different branches. Run on one branch, neither produces a partial table —
each produces a **wrong** one, which is worse, because the next reader treats it as the answer. Their briefs
were written but lived in the previous session's scratchpad, which is gone; **rewrite them from the plan's
Group 5 text.**

---

## 5. Task 16's outstanding fix round — the controller's rulings, ready to paste into a brief

Its review is at `docs/caring-contacts/phase-2b-sdd-archive/task-16-review.md` on `cc-templates`. Verdicts
were **spec ❌, quality not approved**. The method was praised; the block is not the testing.

- **MAJOR 1 — a false clinical claim is on screen.** `template-detail.tsx:319-324` renders _"Only one
  patient-visible message has been approved anywhere in this system…"_ while `message-copy.ts:4` and `:15` mark
  those same constants **"PROVISIONAL — not clinically approved"** — and the sentence sits directly beneath the
  two approval seats. **Ruling [131]: delete the sentence** (no wording of it is true), **state the wording's
  real status where the wording is**, sourced from `message-copy.ts` rather than retyped, and **pin it with
  assertions that can go red** — one failing if the provisional status stops rendering, one failing if an
  approval label renders without it.
- **MAJOR 2 — Rulings [132] and [135]: pin precisely, repair nothing.** The frozen `message-preview` copy is
  false on this screen (four untrue clauses, named in the review). Six such conflicts now exist across the
  phase, and consolidating them is the **owner's** decision. Worse, the review found the frozen table **is not
  one table** — `overlays/definitions.ts:111-122` and `mockups/overlay-specimens.tsx:81-92` disagree, and
  `overlay-definitions.test.ts:203-214` pins structure only, not `summary`/`decision` text. **Record both
  locations; add no gate** — a test pinning them equal would be red on arrival.
- **MINOR 3** — `docs/codebase-index.md` was skipped, and its line 248 ("shows no message wording at all") is
  now false. Add the route, fix the line.
- **MINOR 4** — an assertion that cannot go red: `tests/caring-contacts-template-detail.dom.test.tsx:461-463`
  compares `textContent` values that **include** the distinct headings, so it can never fail while those
  headings differ. Fix it, then run the review's own mutation to prove it reddens.
- **MINOR 5** — `overlay-trigger.tsx:118` says "the EIGHT overlays that record nothing". Correct today, decays
  silently. Reword to name the property, not the number (Ruling [94]).
- **MINOR 6** — the Playwright block's `getByRole("heading", {name: "Template"})` also matches the library's
  "Templates" h1, because Playwright's `name` is substring by default. Pass `exact: true`. **That block has
  never run, and Playwright is the controller's gate, not the implementer's.**
- **NIT 7 / NIT 8** — the forced-colours proxy reads only one border token, so other border tokens are
  silently unexamined; and `not-held.pathwayId` is a deliberate poison pill that needs a comment so nobody
  deletes it as dead code.

---

## 6. Gates owed — only the controller may run these, and one is not optional

Implementers are restricted to `test:cc-guards` because concurrent worktrees starved the exclusive heavy lease
and one task's mutation ledger came back ten of twelve unrun. Once every worktree is idle:

- `npm run test` — **the full suite. This is not a formality.** See §7.
- **`npm run build` — NOT optional.** The privacy fix split the patients directory into a server wrapper plus a
  client island, and **this repository has already shipped two Server/Client boundary defects past typecheck
  AND the full unit suite.** Only a build or a live request catches them. Tasks 13, 15, 16 and 11b all added
  client components. Measure on a cold `.next` (`rm -rf .next` first), or `check:bundle-budget` reads stale
  output and reports byte-identical numbers.
- `npm run verify:ui`, specifically `tests/ui-caring-contacts-workspace.spec.ts` — Task 13 added seven unrun
  tests to it, Task 15 added a route entry with no proof block, Task 16 added a block that has never run.
- `npm run format` across the tree, **committed** — formatting is in none of `test`, `typecheck` or `lint`.

**Do not switch the demo seed on for the Playwright server** to populate Templates and Schedule. It would
delete the empty-caseload observations other tests depend on, and `emptyStateColours` _throws_ when the empty
state is absent.

**Browser proof for Templates and the Schedule screen is owed and deliberately unwritten.**

---

## 7. Two things measured last session that change how you should read the word "green"

**The test gate has a large hole, and it is measured, not suspected.** `test:cc-guards` is a hand-maintained
list of paths in `package.json`. Unioned across all five branches and diffed against every Caring Contacts
suite that exists, **thirty-two suites are in no branch's gate** — including `message-policy` and
`message-copy`, whose modules `cc-message-name` had just changed, and `permissions` and `assignment`, which are
the two most exposed suites for Task 11b.

Rather than assert the risk, the previous session ran the exposed ones per branch:

| Branch            | Result                                              |
| ----------------- | --------------------------------------------------- |
| `cc-message-name` | `Test Files 2 passed (2)`, `Tests 68 passed (68)`   |
| `cc-schedule`     | `Test Files 5 passed (5)`, `Tests 56 passed (56)`   |
| `cc-templates`    | `Test Files 7 passed (7)`, `Tests 178 passed (178)` |

All green — so on those three this is an **evidence** gap, not a shipped defect. **`cc-plan-detail` was
excluded because Task 11b was live in it. Run `permissions`, `assignment`, `model` and `service-state` there
the moment it is idle — they are the suites with the least evidence in the whole phase.**

**Three fix rounds were never re-reviewed (Ruling [136]).** The rule allowing a skipped re-review applies to
**prose-only** rounds; reading the diffs rather than the commit subjects, Task 10 round 3, Task 11a round 2 and
Task 19 round 3 each carry a `fix(` commit written in answer to review findings — which is precisely the code
no review has seen, because the round that answers a review is the round no review saw. **Do not dispatch
three retrospective reviews. Hand that list to the final whole-branch review**, which the method already owes
and which has never been run, and tell it explicitly to treat those diffs as unreviewed rather than as
already-covered ground.

---

## 8. Owner decisions still owed — bring these to Josh, do not decide them

- **The six frozen-copy conflicts, consolidated.** `message-preview` (twice, in two contexts),
  `verify-identity`, `save-draft`, `resolve-failed-delivery`, `outside-window-warning` — each promises detail
  its host screen cannot carry. Six conflicts in one frozen table is one question about what the table is for,
  not six bugs. Ruling [135] adds the part that changes the question: **the frozen table is not one table.**
- **A second approver for the small-cell threshold** — recorded, not built.
- **The bounded category set for §2.5, and how it is collected.**
- **The temporal axis of reach reporting.**

---

## 9. Traps that have already cost this build

- **Never assume `localhost:3000`.** Run `npm run ensure` and use the URL it prints.
- **Tap targets are `min-h-12` (48px)** and must stay there. Generic accessibility guidance teaches 44px
  (`min-h-11`); "fixing" production down to it reintroduces a known `ui-smoke` flake.
- **The test lease has two refusal shapes** — one prints `DATABASE_HEAVY_RUN_ADMISSION_BUSY`, the other
  **throws** with no marker. Record a refusal as UNRUN and retry; **never force past another worktree's lease.**
- **Nothing about a patient may travel in a query string** (Ruling [111]) — not a name, never a number.
- **Never render a raw role identifier to a clinician.** The vocabulary scan has a known hole: it refuses
  "lead" as a whole word but passes `clinicalProgrammeLead` on a missing word boundary. Do not exploit it.
- **You may not author patient-visible wording.** Clinician-facing chrome is fair game; the message is not.
- **This is Next.js 16** — read `node_modules/next/dist/docs/` rather than trusting training data.
- **`npm run format` can exceed a tool timeout.** Background the whole-tree run; fast-check changed files.
- **Generated files are regenerated, not hand-merged** — `data/*-snapshot.json`, `docs/site-map.md`,
  `docs/design-system/ADOPTION.md`, `adoption-manifest.json`, `tests/design-system-adoption.test.ts`.
- There is a stray untracked `1/` directory in the trunk worktree (a Node download). It is junk and it is
  untracked, and it is **not yours to delete without asking.**

---

## 10. How to talk to Josh

He is a **psychiatrist, not an engineer**. Lead with the answer. Say what he needs to do as numbered steps, or
say "nothing for you to do". Write plain English sentences, not fragments. No file paths, function names or
gate names unless they change his decision. One recommendation, not a menu. State plainly when something is
broken, risky or uncertain, and say when you did not check. Full detail for anything clinical,
privacy-related or patient-facing, and for any command he must run.
