# Caring Contacts Phase 2A — continuation prompt

Paste the block below as the **first message** of a new Claude Code session. It is self-sufficient: it
names every path, every constraint, the complete file map, and the exact first action.

**Settings: Opus 5, high effort, plan mode OFF.** Reasoning in the "Settings" section at the foot of this
file.

---

```
Caring Contacts — Phase 2A is BUILT. Finish its closing work, then plan Phase 2B. Read before
writing anything.

═══ WHERE THE WORK IS ═══
Repository:  D:\Repos\Database            (remote: github.com/BigSimmo/Database)
Branch:      main. PHASE 2A HAS ALREADY MERGED. Verified 2026-08-24: the whole phase went in as
             e4cbe8d3a, "Claude/suicide contact mockup b5aaa0 (#2279)", on 2026-08-23. Every
             caring-contacts path on main matches the old branch tip cf03f99a4 except where later
             main work is newer. The old feature branch claude/suicide-contact-mockup-b5aaa0 is
             RETIRED — do not work on it, do not push it, do not resurrect it.

MEASUREMENT DISCIPLINE CARRIES OVER, AND MATTERS MORE ON main. The retired branch was shared: on
2026-08-22 commit c3ef20c3f landed on it from a clone not on this machine, mid-task, and invented both
a phantom failure and a phantom green. main is touched by many more sessions than that branch ever was.
So: record the exact commit any full-suite or browser result was taken against, re-run a single file
alone against a named commit before believing a failure, and treat green under concurrency as worth no
more than red under concurrency. See "the phantom failures" in the build record.

FIRST ACTION — make yourself a working copy off main. Do NOT assume one already exists:
    cd D:\Repos\Database
    git fetch origin
    git worktree add D:\Worktrees\Database\<a-fresh-name> -b claude/<your-task> origin/main
Then confirm you are where you think you are: `git rev-parse --abbrev-ref HEAD` must print your new
branch, and `git log --oneline -1` must show a commit at or after e4cbe8d3a.

DEPENDENCIES ARE FREE IF A COMPLETE INSTALL EXISTS. `npm ci` is 15-58 minutes here, but every
package-lock.json on this machine was byte-identical on 2026-08-24, so
`node scripts/setup-codex-worktree.mjs` reused D:\Repos\Database's node_modules in seconds and
reported "PASS: worktree dependencies match package-lock.json." Run that FIRST, before reaching for
npm ci. Check with `--dry-run` if you want to see what it would do.

WORKING DIRECTORIES ON THIS MACHINE DO NOT SURVIVE. On 2026-08-21 four were destroyed by another
process — under .claude\worktrees\ AND under D:\Worktrees\, one of them holding this exact work, and
one through an explicit `git worktree lock`. RELOCATING IS NOT PROTECTION. The `.git` pointer file is
removed first, so git silently resolves to the MAIN CHECKOUT ON THE WRONG BRANCH; the tracked files
go afterwards. There is no warning and the cause is not identified.

What actually protects the work — proven, because this branch survived a destruction today because
of it:
  * Commit early and often, and PUSH AFTER EVERY TASK. A pushed branch is the only thing that has
    ever survived here. Pushing needs SKIP_STATIC_GUARD=1 while typecheck is knowingly red (below).
  * Anything needed to resume must be a TRACKED file. Git-ignored scratch dies with the directory.
  * After any long gap — a slow install, a subagent, a queued test run — re-check the branch before
    trusting the working copy. If `git status` starts reporting files you never touched, your
    worktree is gone and you are standing in the main checkout.

Dependencies: a fresh worktree has none, and `npm ci` takes ~58 minutes on this machine. If an
earlier worktree still exists with node_modules, reuse it rather than reinstalling. The SDD workspace
needs no dependencies at all — restore it with
`node scripts/rebuild-caring-contacts-sdd-workspace.mjs`.

═══ THE FILE MAP — everything that exists, and when to read it ═══

READ NOW, IN THIS ORDER. Stop once you can state the resume point back to me.
  1. docs/caring-contacts/PROGRESS-LEDGER.md
       Master ledger: programme shape, all three sessions, all 19 task states, verification evidence
       at every gate, both decision sets, carried risks, and where every record lives. The whole
       picture on one page. It is an INDEX — the detailed records win on any disagreement.
  2. docs/caring-contacts/phase-2a-handoff.md
       Session entry point: what this is, exactly where work stopped, the rules that fail the build.
  3. docs/caring-contacts/phase-2a-build-record.md
       THE ledger and the most important file here. All 66 rulings with what each costs if wrong,
       every deferred finding, every review outcome, every test result. Its FINAL "RESUME POINT"
       supersedes everything above it. Trust this file and `git log` over any assumption.
  4. docs/caring-contacts/copy-review.md
       189 strings — every word the system can show a patient or a clinician. DELIVERED to the owner
       2026-08-23. Its last section lists SEVEN items awaiting his clinical decision. Do not change
       patient-visible wording until he has answered.

═══ WHERE WORK ACTUALLY STOPPED, 2026-08-23 ═══

All 19 Phase 2A tasks are built and reviewed, the final whole-branch review ran (three parallel
reviewers, distinct lenses), and its findings were fixed through Ruling 65 — including a CRITICAL one:
patient name, mobile number and the free-text incident note were being written in plaintext to the
idempotency table. Rulings now run to 66.

OPEN, in the order I would take them:

  1. DONE 2026-08-24 — THE BROWSER GATE IS GREEN ON main. `32 passed (55.5s)`, exit 0, no
     ECONNRESET anywhere in a 341-line log. The one test that failed on 2026-08-23 —
     `:822 pins the condensed bar under the header once the banner has gone at 1440px` — ran and
     passed in 898ms. So the residual failure was load, not a defect, and the condensed bar's fix
     round IS closed on that count. Two things made the earlier reading harder than it needed to be
     and are worth keeping: Playwright reports a failure at the test's DECLARATION line, so
     `:822` named the `test(...)` line and not the failing statement — the ECONNRESET was actually
     in `arrangeServiceStop`'s setup POST at line 672, before any pin assertion ran, which is why a
     transport error could never have been the pin being wrong. And `npm run test:e2e` is still the
     only correct invocation: `npx playwright test` refuses with an `Error:` line and EXIT CODE 0,
     so it reads as a pass having run nothing. Redirect the whole log to a file; never pipe a gate
     through `tail`. Expect 32 tests, not 33.
  2. DONE 2026-08-24 — BOTH MUTATION PROOFS RUN, and both discriminate. Pin (`top-full` -> `top-0`):
     13 failed / 19 passed, failing at line 877 on `barBox.top` 64 -> 0 with the two preceding
     assertions passing first, so the 1440px pin is REACHED. Dark colours (danger tokens -> fixed
     literals): exactly 1 failed / 31 passed, at line 931, naming the injected literal — no
     collateral at all. The condensed bar's fix round is CLOSED.
     Read the build record's account of the near-miss before writing your own mutation proof: the
     first colour mutation silently failed to apply and its gate reported `32 passed`, exit 0.
  3. THE COPY DECISIONS await the owner. `docs/caring-contacts/copy-decisions-recommended.md`
     (new, 2026-08-24) carries a recommendation, a reason and a cost-if-wrong for each. Note the
     count: this prompt and the ledger both said SEVEN, but `copy-review.md` actually raises
     THIRTEEN — nine clinical or policy, four pure engineering. The seven was an undercount.
     Do not change patient-visible wording until he has answered.
  4. PHASE 2B has no plan yet. The owner's stated order: patients and their plans -> schedule and
     what's due -> message templates -> team, workload and coverage.
  5. DONE 2026-08-24 — the `/issues capture` sweep ran. All seven deferred items are now immutable
     request files under `docs/outstanding-issues-inbox/`, so they no longer survive only in the
     build record. They reach `docs/outstanding-issues.md` when someone runs
     `npm run issues:reconcile` from a serialized fresh-base branch; until then they are queued,
     not filed.

THE AUTHORITIES, if the brief sends you there or a conflict arises
  - docs/superpowers/plans/2026-08-19-caring-contact-phase-2a-foundations.md
       The plan: 19 tasks in 5 groups, plus Global Constraints every task inherits.
  - docs/superpowers/specs/2026-08-19-caring-contact-production-build-design.md
       The binding spec the plan argues from. Conflicts resolve AGAINST the spec.
  - docs/caring-contacts/phase-1-handoff.md
       Phase 1: what it built, its 13 owner-behalf decisions, and its 6 still-open items.
  - node_modules/next/dist/docs/
       REQUIRED before any route or layout code. This repo runs Next.js 16, which has breaking
       changes against most training data. Reading beats reasoning; more thinking does not repair a
       wrong prior.

THE STORAGE LAYER — Task 11b finished this; the map is here because Phase 2B extends it
  - src/lib/caring-contacts/repository.ts                  the interface: 38 methods
  - src/lib/caring-contacts/in-memory-repository.ts        implements all 38
  - src/lib/caring-contacts/db/postgres-repository.ts      implements all 38; ~2,080 lines
  - tests/helpers/caring-contacts-repository-contract.ts   the SHARED contract BOTH stores run.
                                                           New behaviour goes HERE, not in one store's
                                                           own file, or the two stores drift.
  - tests/helpers/caring-contacts-postgres.ts              harness; CARING_CONTACTS_DATA_TABLES is a
                                                           hand-maintained truncation list every new
                                                           table must join

THE SEALED DOMAIN — src/lib/caring-contacts/ (27 modules). The store PERSISTS decisions; it must
never re-derive a rule a module already owns, even if the answer matches today:
  access-audit  assignment  audit  clock  contact-rescheduling  episode  fingerprint  hospital-events
  ids  in-memory-repository  message-copy  message-policy  message-rules  model
  notification-preferences  pathway-versions  permissions  referrals  repository  retention  schedule
  service-rules  service-state  simulation  synthetic-contacts  training  db/postgres-repository

THE SCHEMA — caring-contacts/supabase/migrations/ (NEVER supabase/migrations/)
  0001_caring_contacts_foundation.sql   0002_caring_contacts_rls.sql
  0003_caring_contacts_workspace.sql    ← Rulings 4, 9, 19-22, 25, 27-34 live here

NEEDED LATER, NOT NOW
  - docs/caring-contacts/interaction-matrix.md          frozen 24-row overlay table (Tasks 17-18)
  - docs/caring-contacts/atlas/ (44 PNGs) + screenshot-atlas-manifest.json + visual-reference-manifest.md
  - docs/caring-contacts/accessibility-acceptance.md, clinical-language-trace.md,
    verification-report.md, linked-prototype-handoff.md      Phase 1 design records
  - src/components/caring-contacts/mockups/                  design scratch, frozen, 404s in production.
                                                             Production code may NEVER import from it.
  - docs/caring-contacts/phase-2a-sdd-archive/               22 files: every brief and report

DO NOT READ
  - docs/caring-contacts/phase-2a-sdd-archive/00-live-ledger-verbatim.md
       A STALE snapshot frozen at Ruling 29, with a warning header. The build record is the live one.

OUTSTANDING WORK RECORDED OUTSIDE THIS PLAN
  - docs/outstanding-issues-inbox/049e0356-b6ad-4382-8f34-958d2681c60e.json
       Owner decision 2026-08-21 on patient case notes and the retention disposition of
       service_stops.note. Read it before touching that column.

RAW CHAT TRANSCRIPTS — outside the repository; you should not need them
  - D:\Repos\caring-contacts-handoff-2026-08-20\   sessions 1-2. Its README names a worktree that no
                                                   longer exists; ignore that path.
  - D:\Repos\caring-contacts-handoff-2026-08-21\   session 3, incl. the ONLY verbatim copy of the
                                                   fix-round-2 review that produced Rulings 32-34.
                                                   Also mirrors PROGRESS-LEDGER.md and this prompt.

THE SCRATCH WORKSPACE — generated, never a source
  - .superpowers/sdd/2026-08-19-caring-contact-phase-2a-foundations/
       A MIRROR. Rebuild with `node scripts/rebuild-caring-contacts-sdd-workspace.mjs`; verify with
       `--check`. Never edit it, and never start a second ledger there — append to the tracked build
       record instead. The original was git-ignored, was destroyed, and took the only copy of the
       session ledger with it. That is why it is now regenerable.

═══ STATE — all 19 tasks built; NOTHING is knowingly red ═══
Every Phase 2A task is complete and reviewed, both checkpoints passed, the final whole-branch review
ran, and its findings were fixed through Ruling 65. Rulings run to 66.

THE TWO EXPECTED FAILURES THIS SECTION USED TO NAME ARE BOTH GONE, and neither was fixed by
weakening anything — that matters, because a green tree reached by softening an assertion is worse
than the red one it replaced:
  - `npm run typecheck` was RED on db/postgres-repository.ts, a 22-method gap against the
    38-method interface. Task 11b implemented all 22. Green.
  - `npm run test` had exactly one failure, tests/caring-contacts-retention.test.ts. Ruling 26's
    fix landed as Step 0b of Task 11b. Green, and the retention suite went 23 -> 24 tests.
So a red typecheck or a red retention test is now a REGRESSION, not the documented baseline. If you
meet one, do not reach for `SKIP_STATIC_GUARD=1` — that override existed only while the red above
was expected.

═══ WHAT THIS IS ═══
A suicide-prevention caring-contacts workspace: patients discharged from hospital receive a fixed
schedule of brief, non-demanding messages. It lives inside the larger Clinical KB deployment but is a
STANDALONE APPLICATION owning its own sidebar — every heading and destination goes in ITS rail, never
the host app's navigation. The tools-catalogue entry is only the front door.

Synthetic, non-clinical prototype. Patient-visible copy is PROVISIONAL and not clinically approved.
Phase 2A is foundations; the clinician-facing screens are Phase 2B, a separate plan.

═══ SKILLS TO USE, AND ONE NOT TO ═══
  superpowers:subagent-driven-development   THE method for this task. Invoke it first.
  superpowers:test-driven-development       test-first, then prove the test can fail.
  superpowers:verification-before-completion  evidence before any claim that something passes.
  superpowers:requesting-code-review        for the task review after the implementer returns.
  superpowers:receiving-code-review         when adjudicating findings — verify them, do not just
                                            agree. Three findings this branch accepted were real;
                                            one earlier "proof" proved something else entirely.
  gates (repo skill)                        picking the smallest correct verification gate and
                                            proving it actually ran.

  Do NOT use superpowers:brainstorming or superpowers:writing-plans. The plan and the spec already
  exist and are binding; re-deriving them costs tokens twice and risks a divergence a reviewer must
  then adjudicate.

═══ METHOD — this matters for cost as much as for quality ═══
Execute with superpowers:subagent-driven-development. Dispatch a fresh implementer subagent for Task
11b so the large files are read in ITS context, not yours. Give it the brief verbatim plus the traps
below. Review what it returns, then run a task review. Do not read those files yourself unless the
review requires it.

Test-first, always. After each piece, deliberately break the implementation and confirm the covering
test goes red — and check FIRST that the mutation actually changes a value some assertion reads.
Three proposed proofs on this branch turned out to prove something other than they claimed, and four
tests across the programme were found unable to fail at all. A refusal path with no test is a defect;
enumerate them before committing.

═══ RUNNING TESTS — read this or you will lose an hour ═══
  docker run -d --name caring-contacts-pg -e POSTGRES_PASSWORD=caring-contacts-local -p 54329:5432 --restart unless-stopped postgres:17
  CARING_CONTACTS_DATABASE_URL=postgres://postgres:caring-contacts-local@127.0.0.1:54329/postgres npm run caring-contacts:db:test

Expect "Tests 96 passed (96)" before your changes. NEVER report a run from its exit code. If the
output carries no "Test Files" summary line THE RUN DID NOT HAPPEN — the cross-worktree lock
coordinator throws EPERM on owner.json/gate.lock under concurrency, which is an acquisition failure,
not a result. Retry it. Piping through `tail` has masked a real result here twice. Runs also queue
behind other worktrees' Playwright runs for 15-40 minutes when other AI sessions are open — ask me to
close them rather than polling tightly.

Run the FULL `npm run test`, not just focused files, before declaring complete any task that adds or
renames an exported symbol inside src/lib/caring-contacts/ — that directory is policed by static scans
living in files no such diff will contain. That is exactly how one real failure survived two tasks.

═══ HARD CONSTRAINTS ═══
- Do not push, do not open a pull request, and do not run verify:release or any provider-backed gate
  (eval:*, check:supabase-project, test:live) without asking me first.
- No message sent to any number, real or test. No SMS provider. No migration against the Clinical KB
  Supabase project sjrfecxgysukkwxsowpy. Caring-contact migrations live ONLY in
  caring-contacts/supabase/migrations/. Synthetic fictional data only.
- Never delete or loosen an existing assertion to make a change fit. The brief warns you will be
  tempted at one exact moment — when the shared contract starts creating its own parent records. If
  you find yourself about to change what a test expects, STOP and report instead.
- Domain isolation: nothing under src/lib/caring-contacts/ may import from @/components, @/app, any
  @/lib module outside itself, Supabase, or OpenAI.
- Production code may never import from src/components/caring-contacts/mockups/.
- Tap targets are min-h-12 (48px). Do NOT "fix" them to min-h-11 — that reintroduces a known flake.
- Prohibited in any interface string: high risk, safe, engagement score, campaign, lead, conversion,
  best match, inbox, conversation, clinical risk, risk score, wellbeing score, and any claim that
  replies are monitored. Transport words (Delivered, Not delivered, …) are never patient-state labels.

═══ MODEL SPLIT ═══
Sonnet 5 at medium-high for ordinary implementer work. Opus 5 at high for: migrations and row-level
security, Tasks 17-18 (the 24-overlay modality contract), anything displaying delivery or clinical
state, and the final whole-branch review.

═══ WHERE TO STOP ═══
Phase 2A is finished, so there is no task boundary left to stop at. Stop instead when the closing
items above are done, and DO NOT begin building Phase 2B screens: 2B needs its own written plan and
the owner's copy decisions first, and starting it early is how the wording gets settled by an
implementer instead of by him.

═══ TELL ME AT THE END ═══
What was built, what you decided on my behalf and what each costs if wrong, and anything you could not
verify. I am a psychiatrist, not a software engineer: lead with the answer, plain English, numbered
steps if there is something for me to do, and say plainly when something is broken, risky or unverified.
```

---

## Settings, and why

**Model: Opus 5. Effort: high. Plan mode: OFF.**

- **Opus 5 at high** — not for the volume of code, but for one judgement. Task 11b moves existing tests
  into a shared contract that both stores must satisfy, and the brief itself warns that at one
  identifiable moment the cheap way out is to soften an assertion rather than make the store meet it.
  Recognising that moment and refusing it is the discipline this branch exists to protect, and it is not
  a mechanical check. The reading and typing are delegated to a subagent, so the strong setting pays
  only for the judgement.
- **Plan mode OFF** — the plan already exists in writing and is binding: 19 tasks, Global Constraints,
  and a complete self-contained brief for this task. Plan mode would re-derive a plan that is already
  written, costing tokens twice and risking a divergence a later reviewer must adjudicate.
- **The exception**: if reading the brief reveals a genuine conflict with the spec, stop and raise it
  rather than planning around it. Conflicts resolve against the spec, and a controller ruling is
  recorded in the build record.

## Durability — the one thing still open

As of head `a15127de4` the branch has **never been pushed**: 54 commits exist only on this workstation,
which is the machine that deleted a working directory mid-session. To close that:

```
cd D:\Worktrees\Database\caring-contacts-phase-2a && git push -u origin claude/suicide-contact-mockup-b5aaa0
```

It opens no pull request and changes nothing live. If the machine or account changes instead, copy
`D:\Repos\Database` and both `D:\Repos\caring-contacts-handoff-2026-08-2*\` bundles, then adjust the
worktree path at the top of the prompt.
