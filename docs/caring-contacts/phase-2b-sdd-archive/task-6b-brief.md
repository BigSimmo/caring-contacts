# Task 6b brief — store the reason a first contact date was moved

**Plan:** `docs/superpowers/plans/2026-08-24-caring-contact-phase-2b-screens.md`, Group 1 (added
after Task 6, on the owner's decision of 2026-08-25).
**These are your requirements.** Read **Rulings [96], [101] and [105]–[108]** in
`docs/caring-contacts/phase-2b-build-record.md` first — note the square brackets; a plain
`Ruling 96` grep misses them.

Caring Contacts is a suicide-prevention prototype. Every patient is fictional and **nothing is ever
sent to any number**. Task 6 built the patient overview screen and found this gap while trying to
satisfy Ruling [96].

## The gap, verified twice

`schedule.ts` refuses a non-default first contact date when no reason is given:

```
const isDefault = offset === FIRST_CONTACT_DEFAULT_OFFSET_DAYS;
if (!isDefault && (input.firstContactReason ?? "").trim() === "") {
  return { ok: false, reason: "first-contact-reason-required" };
}
```

…and then **discards the string**. It is the only use of `firstContactReason` in the tree. Neither
`StoredPlan` nor the `caring_contacts.plans` insert has a field or a column for it, in either store.
So the system demands a reason, refuses without one, and keeps nothing.

**The owner approved storing it on 2026-08-25**, on the grounds that a reason you demand and then
throw away is worse than not asking, and that nobody can later review why dates were changed.

The **date** itself is not lost — it survives as the first contact's own `calendarDay`/`sendAt`. Only
the reason is missing. Do not add a second copy of the date.

## What you are building

The reason, stored, and the patient overview showing it.

- `src/lib/caring-contacts/repository.ts` — the shared contract both stores satisfy.
- `src/lib/caring-contacts/in-memory-repository.ts` and
  `src/lib/caring-contacts/db/postgres-repository.ts` — both implement it.
- `tests/helpers/caring-contacts-repository-contract.ts` — **the shared contract suite both stores
  run.** New behaviour goes HERE, not in one store's own file, or the two stores drift.
- A migration in **`caring-contacts/supabase/migrations/`**. Read the next section before writing it.
- `src/components/caring-contacts/workspace/patient-overview.tsx` — Task 6 already renders the
  first contact date and states, in place, that no reason is held. That sentence becomes the reason.

## The migration, and the trap that would be expensive

**Caring-contact migrations live ONLY in `caring-contacts/supabase/migrations/`, NEVER in
`supabase/migrations/`.** The repository root's `supabase/` directory targets the live Clinical KB
database `sjrfecxgysukkwxsowpy`, which is **not** this workspace's database and merging to `main`
deploys it to production automatically. A caring-contacts migration placed there would be applied to
a live clinical database within seconds. The existing files are `0001`–`0004`; yours is next in
sequence and follows their style exactly.

The plans table's existing shape is in `0001_caring_contacts_foundation.sql`. Match its conventions
— `if not exists`, explicit `check` constraints where a value is closed, no implicit defaults that
hide a missing write.

## Ruling [105] — where the reason may and may not travel

Three constraints, and the first is the one that matters:

1. **It must never appear on `PlanRecord`.** `PlanRecord` is what `listPlans` returns and what the
   caseload renders for every patient in the team. A free-text clinical note keyed to a patient has
   no business being fetched for a list screen, and Task 5b's whole argument was about not doing
   exactly that. It is released by the read that already releases patient detail.
2. **`markRetentionCleared` must clear it.** This is the point most likely to be missed and it is
   the one that matters clinically. The reason is **free text a clinician wrote**, and a real one
   would say things like "patient asked to wait until she is home from her sister's". That is
   patient-identifying content in every practical sense. `CLEARED_PATIENT_DETAIL` today blanks four
   fields and would not touch a fifth added elsewhere — so a de-identified record would keep
   identifying prose. **Pin the clearance in the shared contract suite**, and deliberately break the
   clearance to prove the test goes red.
3. **The names-only projection must not be able to gain it.**
   `PATIENT_NAME_PROJECTION_RELEASES_ONLY_THE_NAME` in `repository.ts` is a compile-time guard that
   pins that projection to exactly two fields. Check it still holds and does not need a sibling.

**Decide the shape and say why in the code.** Whether it lives beside `patientDetail`, inside it, or
as its own component of `StoredPlan` is yours to choose — but a shape that lets the reason reach a
list read fails constraint 1 even if nothing reaches it today, and a shape that clearance can forget
fails constraint 2. Task 5b's `PatientNameProjection` comment is the model for the kind of reasoning
to write down: **two fields is a guarantee; empty fields are a promise.**

## Ruling [106] — cap the length, and say what the cap is

It is unbounded free text going into a database column. Choose a limit, enforce it where the input is
validated rather than only at the column, and give the refusal its own identifiable reason — the same
shape `first-contact-reason-required` already has. A silent truncation is not acceptable: a clinical
reason cut off mid-sentence can invert its meaning.

## Ruling [107] — the write path already exists; do not build a second one

The plans POST schema already accepts `firstContactDate` and `firstContactReason`, and `schedule.ts`
already validates the pair (Ruling [86]). **Your change is to stop the reason being dropped between
that validation and the store, not to add a new way to supply it.** If you find the API schema and
the store disagree about the field, report it rather than reconciling them by inventing a third path.

## Ruling [108] — the screen states what is held, never what it assumes

Task 6 renders the first contact date and, where the date is not the default, says plainly that no
reason is held. With this task that sentence has three cases and they are different facts:

- The date is the default → no reason was required, and none is missing.
- The date was moved and a reason is stored → show the reason, in place, beside the date. Spec §4.4
  is a contract: a reason reachable only by hovering has not been stated.
- The date was moved and no reason is stored → this is a **pre-existing plan**, created before the
  column existed. Say that, and do not present it as a clinician having failed to give one.

That third case is real and will persist. Do not migrate a placeholder string into old rows to make
the screen simpler; a fabricated reason on a clinical record is far worse than an honest absence.

## Constraints

- Nothing under `src/lib/caring-contacts/` may import from `@/components`, `@/app`, any `@/lib`
  module outside itself, Supabase, or OpenAI.
- **Every method in `postgres-repository.ts` must emit the
  `set_config('caring_contacts.team_id', …)` / `set local role caring_contacts_app` preamble** — in
  practice by going through `runRead`/`runWrite` as its siblings do. A method that forgets it does
  not fail loudly; it silently runs as a privileged role with every row-level-security policy
  bypassed. That is the single most dangerous mistake available in this file, and Task 5b's mutation
  M1 proved the contract catches it — a `TEAM-SOUTH` coordinator read `TEAM-NORTH`'s patient name.
- Team scoping is not optional. A reason on another team's plan must be as unobtainable as the plan.
- The service-state incident `note` must never reach a Client Component.
- Design tokens only, no hardcoded hex. Tap targets `min-h-12` — **never `min-h-11`**.
- The reason is **not** patient-visible copy, so the frozen-copy constraint does not bind it — but
  the labels around it are interface strings and the prohibited-vocabulary scan applies, **including
  bare identifiers**.
- **Do not restate a count in prose** (Ruling [94]). State the invariant.

## Verification

- **Test-first.** New behaviour goes in the **shared contract suite** so both stores are held to it.
- The Postgres suite needs a database:
  `docker run -d --name caring-contacts-pg -e POSTGRES_PASSWORD=caring-contacts-local -p 54329:5432 --restart unless-stopped postgres:17`
  then `CARING_CONTACTS_DATABASE_URL=postgres://postgres:caring-contacts-local@127.0.0.1:54329/postgres npm run caring-contacts:db:test`.
  **If the output carries no `Test Files` summary line the run did not happen.**
- **Prove the migration replays from empty**, not just that it applies to your existing local
  database. A column added to a table that already exists locally can pass by accident.
- Deliberately break each piece and confirm the covering test goes red. **Check FIRST that the
  mutation changes a value some assertion reads**, and **prove the mutation is in the tree before
  believing any result**. Never chain the presence check and the gate with `&&` — `grep -c` exits
  non-zero on a zero count and short-circuits, so the gate never runs and prints no summary line.
  Use `;`. And beware the two traps this programme has already hit: a mutation whose anchor no longer
  matches because Prettier reflowed the line will print a **green** summary on an unmutated tree, and
  a refusal arriving through a pipe leaves `$?` reading **0** for a gate that never ran.
- **Itemise every mutation attempt**, including ones that did not go red or whose anchor never
  matched. No aggregate total; the table is the evidence.
- Then the full `npm run test`, `npm run typecheck`, `npm run lint`. **Never report a gate as passing
  from an exit code — paste the `N passed` line.**
- **A lock refusal is neither a pass nor a failure.** Retry; never force past another worktree's
  lease. If it stays refused, report which gate did not run.
- Tell me whether you think this touches `tests/ui-caring-contacts-workspace.spec.ts`. I run that gate.

## Report

**Commit early — before waiting on any gate.**
Write your full report to `docs/caring-contacts/phase-2b-sdd-archive/task-6b-report.md`, then return
ONLY: status, commit SHAs, a one-line test summary, and your concerns. Do not paste the report into
your reply. Do not dispatch subagents. **Do not push and do not open a pull request.**
