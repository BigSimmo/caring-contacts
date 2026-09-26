# Task SEED brief — make the demo drivable

**Owner decision, 2026-08-26.** Brought forward from Phase 3 (Ruling [104]) because the consequence
of deferring it became visible: **the running prototype is empty and cannot be driven end to end by
anyone.** Read the finding under "the running prototype is empty" in
`docs/caring-contacts/phase-2b-build-record.md` before starting.

You are working in a **second worktree** — `D:\Worktrees\Database\cc-templates`, branch
`claude/caring-contacts-demo-seed`, based on the Phase 2B feature branch. Another implementer is
working in a different worktree on a different branch. **Do not touch
`docs/caring-contacts/phase-2b-build-record.md`** — the controller owns it in the other worktree and
it is the one file guaranteed to conflict.

Caring Contacts is a suicide-prevention prototype. Every patient is fictional and **nothing is ever
sent to any number**.

## The problem, established by reading rather than inferred

- `caringContactsStore()` returns the in-memory store when no database is configured, and **nothing
  seeds it**. Its Maps start empty.
- **No route can create a pathway version.** `pathway-versions/route.ts` refuses deliberately:
  accepting a whole `PathwayVersion` from the wire "would let a caller post a version that arrives
  already approved". **That reasoning is correct and you must not weaken it.**
- A referral can only be made by `POST /api/caring-contacts/referrals`, which **no screen calls**.
- So the activation wizard — four screens, the centre of this phase — **cannot be completed**, and
  every list screen is correctly empty because everything is empty.

## What you are building

A **demo seed**: a small, obviously-synthetic population loaded into the in-memory store so every
screen can be seen with something in it and a coordinator can complete a sign-up.

**The safety boundary is the first requirement, not the last.** The seed must be **impossible** to run
against a real database:

- It runs **only** on the in-memory branch of `caringContactsStore()`. When
  `CARING_CONTACTS_DATABASE_URL` is configured, the Postgres store is chosen and the seed must not
  execute at all — not "should not", _cannot_. Make that structural, and pin it with a test that
  fails if the seed becomes reachable from the Postgres branch.
- It must be **idempotent**: seeding twice must not duplicate. The store is memoised on `globalThis`,
  so under `next dev` a second call must be a no-op rather than a second population.
- It writes through the **repository's own methods**, with a real actor and real idempotency keys —
  not by reaching into the Maps. If a write it needs is refused, that refusal is a finding: **the
  seed must not become a privileged back door that bypasses the rules every other caller obeys.**

## What to seed, and the one hard limit

Enough to make every built screen show something real, and to complete a sign-up:

- **A pathway version** — without one, nothing can be created at all.
- **Referrals**, including at least one accepted and one not yet accepted, so the wizard has somewhere
  to start and the states are distinguishable.
- **A handful of plans** in different states, so the caseload, the patient overview and the schedule
  preview have content. Include at least one withdrawn or death-stopped plan: Task 9 found that the
  screen once told a coordinator a stopped plan would still send, and a demo that cannot show that
  state cannot demonstrate the fix.

### The hard limit: **you may not write any patient-visible message wording.**

This has governed every task in this programme and it governs yours. `messageTextByType` needs three
entries — `first`, `standard`, `closing` — and:

- **`standard`:** use `EXACT_PATIENT_VISIBLE_MESSAGE` from the sealed domain's `message-copy`. It is
  the one provisional message that exists, and it is already owner-reviewed.
- **`first` and `closing`: leave them empty**, because no wording has been authored. An empty string
  is the truthful representation of "not yet written", and Task 16 is already required to say exactly
  that.
- **Do NOT copy the standard message into the closing slot.** A closing message that does not say it
  is the last message in the programme is a specific, documented harm — the rules require a final
  message to contain `This is the final message in this programme`, and the owner deferred that
  wording to a lived-experience representative. **An implementer drafting it is the exact failure this
  programme exists to prevent.**
- If you find that an empty entry is refused somewhere, **stop and report it** rather than filling it.

**Every number must be one of the reserved fictional non-connecting numbers**
(`DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS` / `FICTIONAL_CONTACTS_BY_ROLE`). Never invent a
number-shaped string.

**Every name must be obviously invented**, and the existing synthetic fixtures are the precedent for
tone. Do not use a real Australian name that could belong to a findable person.

## Two things this unblocks, and one you should check

1. **The browser gap.** Three implementers each reported "the isolated Playwright server seeds no
   referral". The fuller truth is that **even with a referral there was nothing to choose at stage 2**.
   Your seed should make it possible for a browser test to reach a wizard stage. **You are not writing
   those tests** — say in your report exactly what a test would now need to do to reach stage 4.
2. **The templates library** (a later task) can show a real governance record.
3. **Check whether the seed makes any existing test fail.** Several suites assert empty states. If a
   suite that asserted "no patients" now sees patients, that is a finding about whether the seed leaks
   into the test environment — which it must not. The offline suites must be unaffected.

## Constraints

- Nothing under `src/lib/caring-contacts/` may import from `@/components`, `@/app`, any `@/lib` module
  outside itself, Supabase, or OpenAI.
- **Production must never fall back to synthetic content.** This repository's standing rule is that
  demo fallback is a development convenience and production fails loudly instead.
- Design tokens only if you touch any component; no hardcoded hex.
- **The closed transport vocabulary is frozen**, including in seed data: no "high risk", "safe",
  "engagement score", "campaign", "lead", "conversion", "best match", "inbox", "conversation",
  "clinical risk", "risk score", "wellbeing score", and no claim replies are monitored.
- **Do not restate a count in prose** (Ruling [94]). State the invariant.

## Verification

- **Test-first.**
- **Commit each piece before you mutate the file it lives in** — `git checkout --` also discards
  uncommitted work in that file.
- **A mutation proves the assertion it makes fail, not the case it makes red.** A case with N
  assertions needs N mutations or needs splitting. Predict each failure message and compare.
- **Do not run the presence check through a shell.** On this Windows machine the MSYS2 runtime
  re-parses the command line, so an argv element containing `"`, `{`, `?`, `[` or `*` is not the string
  you sent — `grep -c` silently returns 0 for a mutation that is demonstrably present, and `-F` does
  **not** fix it. Read the file in-process and check the substring there.
- **Run controls with `GATE_RECEIPTS=refresh`.** A restored tree hits a cached receipt and exits 0
  with **no summary line**, which reads exactly like a gate that never ran.
- Gates: `npm run test:cc-guards` for iteration, then the **full `npm run test` once**, backgrounded
  from the first command. Paste every `N passed` line. **Never report a gate from an exit code.**
- **A lock refusal is neither a pass nor a failure.** One exclusive heavy job runs at a time across
  **every** worktree of this repository and another implementer is active in one. **Retry; never force
  past another worktree's lease**, and prove ownership from the lease record's `worktree` field rather
  than a live PID before terminating anything you believe is your own.

## Report

**Commit early — before waiting on any gate.**
Write your full report to `docs/caring-contacts/phase-2b-sdd-archive/task-seed-report.md`, then return
ONLY: status, commit SHAs, a one-line test summary, and your concerns. Do not paste the report into
your reply. Do not dispatch subagents. **Do not push and do not open a pull request.**
