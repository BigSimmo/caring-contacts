# Caring Contacts Phase 2B — handover

> **PHASE 2B HAS LANDED ON `main`. Verified 2026-09-02:** the whole of Phase 2B was squash-merged as
> `17df388e8` — "feat(caring-contacts): Phase 2B workspace, plan lifecycle, team roster and database
> (#2451)", 2026-08-29 — and none of the four feature branches named below exists on `origin` any
> more (`git branch -r` lists no `caring-contacts-demo-seed`, `-schedule`, `-plan-detail` or
> `-message-name`). **Everything below the banner is historical.** The merge checklist has been
> executed, the owed gates were run on the merged tree (build record Rulings [149]–[150]), Tasks 20
> and 21 were accepted afterwards ([151]–[152]), Group 4 was un-deferred by the owner and built
> ([155]), and the close-out is [160]. **Do not merge, fetch or provision anything this file
> names.** Work from a fresh worktree off `origin/main`; the build record is the ledger, and the
> master progress ledger (`PROGRESS-LEDGER.md`) is the current index. The "Owner decisions owed" and
> "Repo-level findings" sections are still worth reading — check each against
> `docs/outstanding-issues.md` before re-filing.

**Written 2026-08-26 by the controller of the subagent-driven build.** Read this before anything else.
`phase-2b-build-record.md` is the full ledger and every ruling is in it; this file is the map.

## The one-paragraph version

Every screen in Phase 2B is built. Nothing is pushed, no pull request exists, and the work lives on
**four unmerged branches**. What remains is: three build tasks, the merge, and the machine-wide gates that
no implementer was allowed to run. The riskiest single step is the merge, and its checklist is below.

## Branches — none pushed, none merged

`claude/browser-test-gate-handoff-d5c1db` is the **trunk** and everything merges into it. It is **0 behind
`origin/main`** after a catch-up merge on 2026-08-26 (merge commit `56fc1796`), which was independently
audited afterwards and found **clean** — nothing lost, and it repaired a live trunk defect nobody knew
about (opening a non-mutating overlay by URL and pressing close threw).

**It has since drifted again and is now 13 behind `origin/main`.** Do the second catch-up merge into the
trunk **before** merging the four feature branches, not after — trunk-versus-main conflicts are cheaper to
resolve while the trunk does not also carry four branches of new files, and the first catch-up proved the
merge is not a formality.

| Worktree                                             | Branch                                | Holds                                                                        |
| ---------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| `.claude/worktrees/browser-test-gate-handoff-d5c1db` | `…-d5c1db` (trunk)                    | Groups 0–1 through Task 9b, the patient-name privacy fix, and every ruling   |
| `D:\Worktrees\Database\cc-templates`                 | `claude/caring-contacts-demo-seed`    | demo seed · Task 15 templates library · Task 19 guidance/reports · Task 16   |
| `D:\Worktrees\Database\cc-schedule`                  | `claude/caring-contacts-schedule`     | Task 12 schedule read · Task 13 schedule screen · Task 14 delivery exception |
| `D:\Worktrees\Database\cc-plan-detail`               | `claude/caring-contacts-plan-detail`  | Task 10 plan and contact detail · Task 11a wizard rows · Task 11b            |
| `D:\Worktrees\Database\cc-message-name`              | `claude/caring-contacts-message-name` | Task P — the patient's first name in the message                             |

**Provisioning a new worktree takes seconds:** `node scripts/setup-codex-worktree.mjs` reuses a
byte-identical install. **Never `npm ci` here** — it takes ~58 minutes.

## Still to build

**Complete and accepted:** Tasks 10, 11a, 12, 13, 14, 15 and 19. Task 14 was accepted at round 5, whose
one item — typing the client's request body through the shared schema — is proved by a `tsc` error naming
the client, not by a test alone.

**Task P is NOT accepted, and my earlier note saying it was is corrected here.** Its round 2 contains a real
49-line code change across `message-copy.ts`, `patient-detail.ts` and two test files — the module holding the
patient-visible wording — and no re-review closed it. I recorded "accepted" from the implementer's own status
line. A scoped re-review of that round is running now, and **nothing merges until it returns**. This is the
tenth instance of the same error in this session: a narrowly-true fact ("the implementer reported complete")
stated at a scope it was never checked against ("the work is accepted").

**In flight:** Task 11b (pause, withdrawal, reassignment) and Task 16's review (template detail).

**Not started, and deliberately held until AFTER the merge — Ruling [133]:** Task 20 (every remaining
overlay reconciled against all 24 matrix rows) and Task 21 (responsive and accessibility proof, 320px to
1440px, dark mode, forced colours, reduced motion, 400% reflow). Both produce a table **about the whole
tree**. Run on one branch they do not produce a partial table, they produce a **wrong** one — the same error
that shipped two separate `ExitOnlyOverlayTrigger` implementations, done deliberately at scale.

**Order from here:** catch-up merge → four feature branches → the owed gates → Task 20 → Task 21.

**Group 4 — Tasks 17 and 18, the team roster — is DEFERRED by the owner.** Do not revive it without him.
**Task 13b (per-row name reveal) is also deferred by the owner** — he chose to keep identifiers and defer
the reveal once the cost of revealing was made explicit.

## The merge, which is the highest-risk step

- **`package.json` does NOT conflict** despite four branches editing the `test:cc-guards` line — their
  additions sit at different positions. Verified by reading the merged tree and counting its paths, not by
  the absence of a conflict marker. **Compute the union at merge time; do not carry a number.**
- **The only real conflict is `STANDING-DISCIPLINE.md`** (add/add, no common ancestor). The trunk's
  consolidated version is the resolution.
- **`patient-overview.tsx` is edited on two branches.** Task 10 built plan and contact detail into it;
  Task 13 moved two label maps out into `contact-vocabulary.ts`. A reviewer verified byte-for-byte that
  **no rendered text changed** in the extraction. Resolve Task 10's additions **on top of** Task 13's
  extraction, then re-read the rendered strings.
- **Suites worth adding to `test:cc-guards`:** `tests/caring-contacts-overlay-trigger.dom.test.tsx` is not
  in it, and its absence caused a task to declare a distinction unprovable offline that this very suite
  already proves. **A gate that omits a suite hides the precedent, not just the coverage.**

## Gates owed — only the controller may run these

Implementers run `test:cc-guards` only, by policy: concurrent worktrees starved the exclusive heavy lease
and one task's mutation ledger came back **ten of twelve unrun**. Once all worktrees are idle:

- the full `npm run test`
- **`npm run build` — not optional.** Three tasks added client components and the privacy fix split the
  patients directory into a server wrapper plus a client island. **This repo has twice shipped
  Server/Client boundary defects past typecheck AND the full unit suite.** `rm -rf .next` first or the
  bundle check reads stale output.
- `npm run verify:ui`, and `tests/ui-caring-contacts-workspace.spec.ts` specifically — **Task 13 added
  seven tests to it and Task 15 added a whole block, none ever executed.**
- `npm run format` across the tree, **committed**. Formatting is in none of `test`, `typecheck` or `lint`;
  a `prettier --check` already caught unformatted files two tasks had created after otherwise green loops.

**Do NOT switch the demo seed on for the Playwright server** to populate Templates or Schedule. Verified:
`emptyStateColours` _throws_ when the empty state is absent, so seeding would fail existing tests rather
than merely alter them. A populated screen needs its own server with `CARING_CONTACTS_DEMO_SEED=on`.

## Owner decisions owed

1. **The small-cell suppression threshold has nowhere to live.** Spec §2.5 requires a
   governance-configured threshold and a non-inferable `Suppressed` state for reach reporting. I searched
   the sealed domain and every caring-contacts migration: **no configuration surface exists.**
   `caring_contacts.cultural_identity_reports` is a real table and it is empty; the sign-up no longer
   collects the field. Task 19 is instructed to **stop and report rather than invent a constant** — a
   hardcoded threshold on a disclosure control is a governance decision made by an implementer, which is
   what the owner refused on 2026-08-25.
2. **Whether the product personalises the patient greeting** (Ruling [127]). Not needed for Phase 2B;
   carries both a schema and a message-length consequence.
3. **Whether to pay for CI to run the caring-contacts database suite.** Strongly argued by a near-miss: a
   migration copied from an earlier one would have silently restored UPDATE and DELETE on the append-only
   audit trail, and **only the database suite could see it** — which runs only when a human has Docker up.

## Repo-level findings worth an `/issues` capture

- **The orphan-route gate is blind to viewport.** `tests/route-reachability.test.ts` reads `shell.tsx` as
  **text** and regex-matches `href…CARING_CONTACTS_ROUTES.(\w+)`, with no notion of which array the match
  sits in, whether that array is filtered, or what CSS governs the element. The general orphan scan is the
  same shape for the whole app. **It proves a route is referenced in source, not that it is reachable at
  any viewport a user can have.** Found because Templates shipped unreachable below 768px while passing.
- ~~**`listSendableContacts` means "not individually stopped", not "should be sent now"** (Ruling [129]).~~
  **CLOSED 2026-09-02 by `#PAMATF` (Ruling [129A]), which overturns [129] with owner approval.** The read
  now consults the owning plan's state through `planSendingHold`, so the name is true: a draft or paused
  plan offers nothing sendable. [129] declined this to avoid duplicating the write gate, and that cost is
  real — the shared repository contract now asserts the read and `requiresActivePlan` agree for every
  `PlanState`, so the two cannot drift. The write gate itself is unchanged. Do not re-file this.
- `middayOf` and `awstCalendarDayOffset` both spell midday, and nothing pins them equal.
- **A hand-maintained test gate drifts silently from the suites that exist.** `test:cc-guards` names its
  suites as literal paths in `package.json`. Nothing adds a suite when one is written, and nothing warns
  when a covered module gains a test the gate does not name. Measured across the five branches: **thirty-two
  Caring Contacts suites are in no branch's gate** — including `message-policy` and `message-copy`, whose
  modules one branch had just changed. I ran the exposed ones per branch afterwards (302 cases, all green),
  so this is an evidence gap rather than a shipped defect, but the same shape applies to every hand-listed
  gate in this repository, not just this one.

## What made this slow, and what it bought

Every task was verified by **mutation testing** — deliberately breaking the code and proving the test goes
red on the predicted message. That is most of the elapsed time and it repeatedly found real defects,
including several in the tests themselves. `STANDING-DISCIPLINE.md` holds every rule it bought, each named
with the defect that bought it. **Read it before writing a brief**; it replaces about forty lines of
boilerplate every brief used to carry.

Three cautions for whoever holds this next, all learned the expensive way:

- **A reviewer's factual claim is a claim, not a finding already checked.** Two were relayed into briefs
  unverified and both were wrong — one of them reported to the owner as a clinical risk it was not.
- **Verifying a narrow claim is not verifying the conclusion drawn from it.** The narrower the thing you
  checked, the larger the gap you are about to jump.
- **A corrected check is still a check.** Three fixes in this programme have been incomplete in the same
  way as the thing they fixed, including two written by the controller.
