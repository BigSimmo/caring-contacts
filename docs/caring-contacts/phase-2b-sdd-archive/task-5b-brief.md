# Task 5b brief — the names-only patient projection

**Plan:** `docs/superpowers/plans/2026-08-24-caring-contact-phase-2b-screens.md`, Group 1.
**These are your requirements.** Read **Rulings 91 and 95** in
`docs/caring-contacts/phase-2b-build-record.md` first — they are the owner's decision and its scope.

Caring Contacts is a suicide-prevention prototype. Every patient is fictional and **nothing is ever
sent to any number**. Task 5 built the Patients directory; it currently heads each row with a
synthetic identifier, because the only read that releases a patient's name also releases their mobile
number, identifiers and cultural identity, and a caseload list needs none of those.

**The owner decided (Ruling 91): build a narrow read that returns the name alone.** A caseload a
clinician cannot recognise their own patients in is barely a caseload — but a list that pulls four
sensitive fields to display one is the wrong way to fix that.

## What you are building

A new repository read that returns **the patient's name and nothing else**, and the Patients directory
consuming it.

**Ruling 95 settles the permission question, so do not re-open it:** the read is its own method with
its own capability check, and that check uses the **existing `viewPatientRecord`**. Do NOT mint a new
capability. A new one would only buy something if some role should see names but not records, and none
exists — `viewPatientRecord` is granted at five sites covering the human roles that can list plans at
all, and a new action would force every role's grant to be decided to satisfy the exhaustiveness guard
in `permissions.ts`.

## The shape of the change, and why it is its own task

This touches the **shared storage contract**, which is why it is not a fix round on Task 5:

- `src/lib/caring-contacts/repository.ts` — the interface both stores must satisfy. It currently
  declares 38 methods; you are adding one.
- `src/lib/caring-contacts/in-memory-repository.ts` — implements it.
- `src/lib/caring-contacts/db/postgres-repository.ts` — implements it. **Every method here must emit
  the `set_config('caring_contacts.team_id', …)` / `set local role caring_contacts_app` preamble.** A
  method that forgets it does not fail loudly — it silently runs as a privileged role with every
  row-level-security policy bypassed. That is the single most dangerous mistake available in this file.
- `tests/helpers/caring-contacts-repository-contract.ts` — **the shared contract both stores run.**
  New behaviour goes HERE, not in one store's own file, or the two stores drift.

**Design the return shape deliberately and say why in the code.** A map from plan or patient id to
name, a list of `{ patientId, patientName }`, or a per-plan lookup are all defensible; they differ in
how many round trips a caseload costs and in what an over-broad call could release. Whatever you
choose, it must be impossible for a caller to obtain mobile number, identifiers or cultural identity
through it — that is the whole point of the task, and a shape that returns "the patient record but
only the name field is populated" fails it even if the other fields are empty today.

**Team scoping is not optional.** The read is team-scoped exactly as `listPlans` is. A name for a plan
belonging to another team must be as unobtainable as the plan itself — and remember `getPlan` returns
`null` for both "does not exist" and "belongs to another team", deliberately, so a cross-team actor
cannot tell them apart. Your read must not become the oracle that distinguishes them.

## Then consume it in the Patients directory

`src/components/caring-contacts/workspace/patients-directory.tsx` and
`src/app/caring-contacts/patients/page.tsx`.

- Rows show the patient's name. Keep the synthetic identifier visible or accessible — it is what
  distinguishes rows for a screen-reader user today, and the existing row control's accessible name
  depends on it. Check `tests/caring-contacts-patients-directory.dom.test.tsx` before changing it.
- The existing search box is "Search name or synthetic ID" in the approved design. If you make search
  match names, that filtering must stay **server-side** — Ruling 13 holds this workspace's client
  payload to a rounding error, and the current filters are navigations, not client state.
- **`getEpisode` remains forbidden here**, and there is a spy pinning its absence
  (`tests/caring-contacts-patients-page.dom.test.tsx`). Do not weaken that spy; add your new read
  alongside it.

## Constraints

- Nothing under `src/lib/caring-contacts/` may import from `@/components`, `@/app`, any `@/lib` module
  outside itself, Supabase, or OpenAI.
- The service-state incident `note` must never reach a Client Component.
- Design tokens only, no hardcoded hex. Tap targets `min-h-12` — **never `min-h-11`**.
- Internal navigation via `<Link>`; hrefs from `src/lib/caring-contacts-routes.ts`.
- Prohibited vocabulary is statically scanned **including bare identifiers**.
- **Do not restate a count in prose** (Ruling 94). If you need to describe how much of something
  exists, state the invariant that makes it true rather than the tally — a fact that must be restated
  to stay true will eventually be false, and that paragraph has already been wrong twice.

## Verification

- Test-first. New behaviour goes in the **shared contract** so both stores are held to it.
- The Postgres suite needs a database:
  `docker run -d --name caring-contacts-pg -e POSTGRES_PASSWORD=caring-contacts-local -p 54329:5432 --restart unless-stopped postgres:17`
  then `CARING_CONTACTS_DATABASE_URL=postgres://postgres:caring-contacts-local@127.0.0.1:54329/postgres npm run caring-contacts:db:test`.
  **If the output carries no `Test Files` summary line the run did not happen** — the cross-worktree
  lock coordinator throws `EPERM` under concurrency, which is an acquisition failure, not a result.
  Retry rather than reporting it as red.
- Deliberately break each piece and confirm the covering test goes red. **Check FIRST that the
  mutation changes a value some assertion actually reads**, and **prove the mutation is in the tree
  before believing any result**. Never chain the presence check and the test with `&&` — `grep -c`
  exits non-zero on a zero count, so a mutation that removes what you are counting short-circuits and
  the test never runs, printing no summary line.
- **Itemise every mutation attempt, including ones that did not go red or whose anchor never matched.**
  Do not report an aggregate total; the table is the evidence.
- Then the full `npm run test`, `npm run typecheck`, `npm run lint`. **Never report a gate as passing
  from an exit code — paste the `N passed` line.**
- **Known environmental noise, not yours:** exactly 2 failures in `tests/gate-receipts.test.ts` ("gate
  receipts — file modes", `chmodSync`) — this Windows drive cannot represent Unix file modes.
- Tell me whether you think your change could affect `tests/ui-caring-contacts-workspace.spec.ts`; I
  run that gate.

## Report

**Commit early — before waiting on any gate.**
Write your full report to `docs/caring-contacts/phase-2b-sdd-archive/task-5b-report.md`, then return
ONLY: status, commit SHAs, a one-line test summary, and your concerns. Do not dispatch subagents.
**Do not push and do not open a pull request.**
