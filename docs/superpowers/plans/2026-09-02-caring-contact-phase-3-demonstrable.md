# Caring Contacts Phase 3 — Make It Demonstrable: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status: DRAFT, not yet approved for execution.** Written 2026-09-02.

**Spec:** `docs/superpowers/specs/2026-08-19-caring-contact-production-build-design.md` — binding. This
plan covers §10 (demo clock, synthetic caseload, training mode), §2.9 (the one permitted patient-level
document) and the rehearsed demonstration path named in §0's Phase 3 row. Where this plan and the spec
disagree, the spec wins.

**Goal:** make the working system openable in front of somebody. Phases 1 and 2 built rules that are
proven and screens that are correct; neither can be shown to a stranger without a narrator. Phase 3
supplies the moving clock, the populated caseload, the bounded document a hospital service will ask for,
the training sandbox that gates production access, and one rehearsed five-minute path through all of it.

---

## 0. What Phase 3 is, and what Phases 1 and 2 actually left

**This inventory was verified against `main` at `45a3dca` on 2026-09-02, not taken from the ledger.**
`docs/outstanding-issues.md` `#4STSM1` still says the Phase 1 implementation plan is unwritten. It is
not: `docs/superpowers/plans/2026-08-19-caring-contact-domain-and-datastore.md` holds its eleven
test-first tasks and the work landed, as did Phase 2 under
`docs/superpowers/plans/2026-08-24-caring-contact-phase-2b-screens.md`. Phase 3 is what remains.

**Built and merged — do not rebuild:**

- The sealed domain layer, 36 modules under `src/lib/caring-contacts/`, including `clock.ts` (the
  injected time source every domain function already takes), `training.ts` (competency list, per-actor
  record, and the `workspacesMayShareData` isolation predicate), `synthetic-contacts.ts` (the designated
  fictional mobile numbers), `service-state.ts`, `retention.ts` and `audit.ts`.
- Eight migrations under `caring-contacts/supabase/migrations/`, `0001`–`0008`.
- The production workspace at `src/app/caring-contacts/` — dashboard, patients, patient detail, new
  plan, schedule, templates, template detail, team, reports, guidance — with `layout.tsx`,
  `loading.tsx` and `error.tsx`, and the components under
  `src/components/caring-contacts/workspace/`.
- A demo seed at `src/lib/caring-contacts-server/demo-seed.ts` behind the `CARING_CONTACTS_DEMO_SEED`
  environment variable, with `applyDemoSeed` and `createDemoWorkspaceStore`, pinned by
  `tests/caring-contacts-demo-seed.test.ts`.
- 73 caring-contacts test files, including `tests/caring-contacts-domain-isolation.test.ts`.

**Not built — this plan's scope:**

| Spec         | Requirement                                                                                                                                    | State on `main`                                                                                                                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §10.1        | A non-production control advancing the injected clock so a reviewer sees month 1, 6 or 12 at once                                              | **Nothing.** `clock.ts` is injectable but no surface moves it. Ward Flow's `ward-demo-controls.tsx` is the nearest pattern and is a different module.                                                                             |
| §10.2        | At least twelve fictional patients across nine named plan states                                                                               | **Partial.** The seed carries five (`ari`, `mira`, `nima`, `rowan`, `wren`) reaching referral, active, paused and withdrawn. Awaiting-claim, active-late, readmitted, permanent-delivery-failure and completed are unrepresented. |
| §10.3 / §4.2 | Badged training sandbox, own cohort, scenario scripts for seven competencies, per-user completion record, persistent indicator on every screen | **Domain only.** `training.ts` exists; no store isolation, no screen, no scenarios, no indicator.                                                                                                                                 |
| §2.9 / §4.3  | The bounded clinical-record plan summary, generated and audited                                                                                | **Nothing.** No module, no route, no audit event.                                                                                                                                                                                 |
| §0 Phase 3   | A rehearsed five-minute demonstration path                                                                                                     | **Nothing.**                                                                                                                                                                                                                      |

### Deliberately NOT in Phase 3

Everything §12 refuses, unchanged: no SMS provider and no message sent to any number real or test; no
real patient data; no migration of any kind against the Clinical KB Supabase project; no production
deployment, hosting change, enterprise sign-on or hospital-system connection. Also not here: the
missing production routes noted in §"What this plan needs before execution starts" — those are a Phase 2
question, not Phase 3 scope, and must not be quietly absorbed.

---

## Global Constraints

Copy these into every task dispatch. They bind every task.

- **The domain seam is absolute.** No file under `src/lib/caring-contacts/` may import from
  `@/components`, `@/app`, any `@/lib` module outside itself, Supabase, or OpenAI.
  `tests/caring-contacts-domain-isolation.test.ts` parses every import specifier in the directory and
  will fail. The demo clock's _control_ is a component; the clock it advances is domain. Keep them apart.
- **No ambient time, still.** Phase 3 adds a clock a human can move; it does not add a clock a module can
  read. Every domain function keeps taking its clock as an argument.
- **Timezone `Australia/Perth`** (AWST, UTC+8, no daylight saving), display locale `en-AU`.
- **Non-production affordances take the shape of the `mockupsEnabled()` gate in `src/lib/env.ts` but
  not its escape hatch**: present in dev and test, and **unconditionally absent from a production build**,
  asserted by test. `mockupsEnabled()` allows a production opt-in via `NEXT_PUBLIC_MOCKUPS_ENABLED`; the
  demo clock gets no such flag, because a control that advances clinical schedules shipping to production
  is a clinical-safety defect, not a cosmetic one, and a flag is exactly how that happens by accident.
- **Synthetic data is obviously synthetic.** Patients are plainly fictional; mobile numbers come from
  `DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS` in `synthetic-contacts.ts` and nowhere else. The existing
  `synthetic-marker.tsx` treatment stays visible.
- **Training data can never join a live query.** §10.3 says never shares data with the live workspace.
  Enforce it at the store/repository seam so no screen can violate it by omission, and prove the
  enforcement with a test that fails when the seam is removed.
- **Explained automation (§4.4) applies to everything Phase 3 adds.** Any state the system reached on its
  own says, in place and in plain words, why and what would change it. `automated-state.tsx` is the
  existing component; DOM-test every new automated state.
- **The §2.9 document is bounded and the boundary is the point.** Plan, pathway version, dates, owning
  team, coordinator. **No mobile number, no message text, no clinical detail.** Every generation is
  audited with actor, timestamp and purpose. Assert the exclusions, not just the inclusions.
- **Repository gates that fail the build:** every `<button>` is wired (`eslint-rules/require-button-wiring.mjs`);
  no production page route without an inbound nav link (`tests/route-reachability.test.ts`); design tokens,
  never hex; production tap targets are `min-h-12` (48 px) — do **not** reduce to `min-h-11`; one search
  composer per page; internal navigation via `<Link>` / `router.push` / server `redirect()`.
- **No caring-contact migration may be written into `supabase/migrations/`.** Phase 3 migrations, if any,
  go to `caring-contacts/supabase/migrations/` and continue the `0009…` numbering.
- **No provider-backed gate, ever, in this plan.** No OpenAI, no Supabase, no hosted CI, no
  `check:supabase-project`, no `verify:release`. Local Postgres and the in-memory store only.
- **Patient-visible copy is not authored by any agent.** No implementer, reviewer or controller invents
  or edits words a patient could read. Those come from the domain's existing message modules; if a task
  appears to need new patient-facing wording, it stops and asks.

---

## Rulings taken in writing this plan

**Ruling [1] — Phase 3 gets its own pull request.** Spec §13 says Phase 3 "folds into the Phase 2 pull
request unless it grows". Phase 2B merged without it, so the fold is no longer available and the
condition is satisfied by events. Cost if wrong: one extra PR and one extra CI run.

**Ruling [2] — the seed is extended, never replaced.** `demo-seed.ts` is 722 lines with a comment block
warning that new plans must be added without touching the properties above them or any existing plan's
final state, and `tests/caring-contacts-demo-seed.test.ts` pins the current five. Rewriting it would
discard proven cadence behaviour to save typing. Cost if wrong: the seed keeps a shape chosen for five
patients while carrying twelve.

**Ruling [3] — the demo clock is built first, before the caseload grows.** Six of the nine required plan
states (active late, readmitted, permanent delivery failure, completed) are _positions in time_, not
static fixtures. With a movable clock they are reachable from one seeded episode; without it each must be
hand-authored at a fabricated offset. Cost if wrong: Task 3 waits on Tasks 1–2 rather than running in
parallel with them.

**Ruling [4] — training mode is built last, exactly as §10.3 directs**, so it can slip without blocking
the demonstration path. Cost if wrong: a PR that ships the demo without the sandbox, which §10.3
explicitly permits.

**Ruling [5] — the §2.9 summary is a print-ready in-app view in this phase, not a generated file
download.** §2.9 permits one patient-level _artefact_; it does not say the artefact leaves the browser,
and §12 refuses "any other export, download, or bulk extract". A print view satisfies "a document for
filing" with the smaller blast radius, and adding a download later is additive. **This is the one ruling
most likely to be wrong** and it is listed as a question for the owner below. Cost if wrong: a follow-up
task adds the download path; nothing built here is discarded.

**Ruling [6] — the demonstration path is a tracked document plus an executable journey, not a script in
someone's head.** A rehearsal nobody can re-run is a rehearsal that rots at the next merge. Cost if
wrong: one Playwright journey's maintenance.

**Ruling [7] — the demo clock gets no production opt-in, diverging from the letter of spec §10.1.**
§10.1 says both "never present in a production build" AND "guarded by the same environment-gate pattern
as `mockupsEnabled`". Those two clauses conflict, because `mockupsEnabled()` _does_ ship in production
when its public flag is set. For a control that advances clinical schedules the absolute clause wins:
the plan takes the gate's shape and drops its escape hatch. Raised by the Codex review of this plan
(2026-09-02), which caught the plan contradicting its own Global Constraints. Cost if wrong: nobody can
demonstrate the clock from a production build, which is the intended state.

**Ruling [8] — `check:production-readiness` is run at the closing gate rather than skipped.** Spec §11
excludes it; `docs/agents/verification-gates.md` requires it for environment and clinical-output changes,
and Phase 3 is both. The deciding fact is that `scripts/production-readiness.ts` validates configuration
and makes no live provider call, so the provider boundary is not what §11's exclusion protects — the
command simply cannot pass without local configuration. Running it and recording the result keeps a real
environment regression visible. Also raised by the Codex review. Cost if wrong: one extra local command
whose output is a known configuration failure; the owner can strike this ruling and restore §11's text.

---

## Group A — The clock you can move (2 tasks)

- [ ] **Task 1 — The advanceable clock, domain side.** Extend the `Clock` seam in
      `src/lib/caring-contacts/clock.ts` with a deterministic advanceable implementation (fixed instant,
      explicit `advanceTo`/`advanceBy`, no ambient reads, no import added to the module's dependency set).
      Test-first in `tests/caring-contacts-clock.test.ts`: advancing is monotonic; a rewind is refused
      with a named reason; AWST calendar-day derivation is stable across a month boundary and a leap day;
      and the existing `systemClock` behaviour is unchanged. **No component, no route, no environment
      variable in this task.**

- [ ] **Task 2 — The control surface, and its absence in production.** A demo-clock control in
      `src/components/caring-contacts/workspace/`, mounted from the workspace shell, offering jumps to the
      cadence points a reviewer asks for (day 1, week 1, month 1, month 6, month 12) and a return to now.
      Gate it in the shape of `mockupsEnabled()` in `src/lib/env.ts` — **but with no production opt-in**.
      `mockupsEnabled()` returns true in production when `NEXT_PUBLIC_MOCKUPS_ENABLED` is set; the demo
      clock must have no equivalent escape hatch. `process.env.NODE_ENV === "production"` denies it
      unconditionally, whatever any flag says (Ruling 7). Tests: a DOM test that the
      control renders and moves the workspace's clock; a DOM test that every jump target states, in place,
      what changed and why (§4.4); and **a production-build test asserting the control is absent**, which
      must fail when the gate is removed **and must also fail with the opt-in flag set to `true`** — the
      flag is the failure mode this task exists to prevent. Wire every button per
      `docs/wiring-conventions.md`.

**Checkpoint A:** `npx vitest run` over the caring-contacts clock and demo-control tests, plus
`npm run lint` on the changed files. The clock moves and cannot ship.

---

## Group B — The caseload (2 tasks)

- [ ] **Task 3 — Twelve patients across nine states.** Extend `demo-seed.ts` per Ruling 2 from five
      seeded patients to at least twelve, covering referral, awaiting claim, active early, active late,
      paused, withdrawn, readmitted, permanent delivery failure and completed. Use only
      `DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS`. Test-first in
      `tests/caring-contacts-demo-seed.test.ts`: a **state-coverage assertion listing all nine states and
      failing when any is unrepresented** — not a count, which twelve patients in three states would
      satisfy. Every existing assertion keeps passing untouched.

- [ ] **Task 4 — No screen is ever demonstrated empty.** A DOM/journey assertion per production screen
      under `src/app/caring-contacts/` that, with the seed applied, each renders populated content rather
      than `list-empty-state.tsx`. Where a screen legitimately has nothing to show for the seeded cohort,
      that is a **finding to report, not a fixture to invent** — record it and let the controller rule.

**Checkpoint B:** the seeded workspace opens on every screen with content on it.

---

## Group C — The one permitted document (2 tasks)

- [ ] **Task 5 — Summary generation, in the domain, audited.** A new module under
      `src/lib/caring-contacts/` producing the §2.9 summary from a plan: plan, pathway version, dates,
      owning team, coordinator. Every generation constructs an audit event via the existing `audit.ts`
      carrying actor, timestamp and purpose, in the same transaction as the generation record — the Phase 1
      rule that no code path writes one without the other still binds. Test-first: the inclusions; **the
      exclusions, asserted as absences — no mobile number, no message text, no clinical detail — against a
      plan whose source data contains all three**; the audit event's fields; and refusal when the actor
      lacks the capability, with a named reason from `permissions.ts`.

- [ ] **Task 6 — The surface, and its boundary.** A print-ready view reachable from plan detail
      (Ruling 5), stating in plain words what the document contains and what it deliberately omits, so the
      person filing it knows. New route ⇒ the full new-route checklist: inbound nav link,
      `npm run docs:update`, a `docs/codebase-index.md` entry, and a reachability assertion. DOM tests:
      the boundary statement renders; a plan the actor may not access does not; the generation is audited
      once per generation, not once per render.

**Checkpoint C:** `npm run verify:pr-local -- --dry-run --files <changed>` to confirm scope selection,
then the focused suites for the changed modules.

---

## Group D — Training mode (3 tasks, last per §10.3)

- [ ] **Task 7 — Isolation at the seam, not at the screen.** Carry `WorkspaceKind` from `training.ts`
      through `src/lib/caring-contacts-server/store.ts` so a training actor's reads and writes cannot
      reach live rows and vice versa. Test-first, with a **mutation proof**: removing the seam must fail
      the test. `workspacesMayShareData` already states the rule; this task makes the store obey it.

- [ ] **Task 8 — The persistent indicator.** A training badge on **every** screen while the workspace is
      training, following the `service-state-banner.tsx` precedent for always-visible state. A DOM test
      per screen, driven off the same screen registry the existing suites use, so a screen added later
      cannot silently omit it.

- [ ] **Task 9 — Scenarios and the completion record.** Scenario scripts for the seven competencies in
      `TRAINING_COMPETENCIES` (identity review, activation, withdrawal, delivery failure, readmission,
      downtime, incident handling), each runnable in the training cohort, plus the per-user completion
      record persisted through Task 7's seam. Test-first: completing all seven marks the record complete
      via `trainingComplete`; six does not; a training completion is never visible to a live query.

**Checkpoint D:** training mode is enterable, badged everywhere, isolated by a proven seam, and its
scenarios run.

---

## Group E — The rehearsed path and closing proof (2 tasks)

- [ ] **Task 10 — The five-minute path.** A tracked document in `docs/caring-contacts/`, named
      `demonstration-path.md`: the exact
      sequence — seeded workspace, a referral accepted and activated, the clock advanced to month 1 and
      month 12, the closing message, a pause and its explained automation, the §2.9 summary, the training
      badge — with what to say at each step and what the viewer should notice. Plus one repository-wrapped
      Playwright journey walking the same sequence, so the path cannot rot silently (Ruling 6).

- [ ] **Task 11 — Closing proof.** `npm run format` and commit the result; `npm run verify:pr-local`;
      `npm run verify:ui` once (spec §11 requires it for the screen-bearing PR); screenshot-atlas
      re-capture with justified-difference review per §6; and the PR body written in full prose from
      `.github/pull_request_template.md`, including the clinical governance preflight, since this diff
      touches clinical output.

**Checkpoint E — the pull request.**

---

## Verification plan

Per spec §11, and nothing broader than the change needs:

- Focused Vitest per module, written before implementation. Run single files with
  `npx vitest run <path>`; do not run the full suite per task — it holds a repository-wide lock.
- `tests/caring-contacts-domain-isolation.test.ts` after every task that adds a domain module.
- The production-absence test for the demo clock (Task 2) is the one that matters most: it must be
  watched failing under a removed gate before it is trusted.
- DOM tests per screen, including the explained-automation and empty-state contracts.
- One `npm run verify:pr-local` and one `npm run verify:ui` for the whole pull request, not per task.
- **`npm run check:production-readiness` runs once at the closing gate, and its output is recorded**
  (Ruling 8). Spec §11 says it "remains intentionally gated without live configuration"; that is true of
  its result, not a reason to skip the command. `scripts/production-readiness.ts` validates configuration
  and makes no live OpenAI or Supabase call, so running it crosses no provider boundary, and
  `docs/agents/verification-gates.md` requires it for environment and clinical-output changes — which
  Phase 3's §2.9 document and production-gated demo clock both are. Record what it reports, including any
  failure that is only the absence of local configuration; that is expected here and is not a Phase 3
  regression, but it must be stated rather than assumed.
- **No other provider-backed gate.** No live OpenAI or Supabase call, no `check:supabase-project`, no
  `verify:release`, no eval dispatch.
- Evidence is never compressed: paste the decisive line from each gate. Exit code 0 alone is not proof.

---

## What this plan needs before execution starts

Four questions for the product owner. **None blocks starting at Task 1**; each is answered before the
task that depends on it.

1. **Does the §2.9 summary leave the browser as a file, or only as a print view?** Ruling 5 assumes print
   only. Needed before Task 6.
2. **Contact detail and system states exist as mockup routes with no production equivalent**
   (`src/app/mockups/caring-contacts/contacts/[contactId]` and `.../system-states`, absent from
   `src/app/caring-contacts/`). Deliberate, or a Phase 2 gap? The demonstration path in Task 10 wants
   contact detail. Not absorbed into this plan either way.
3. **Are the five existing seeded names kept and seven added, or is the cohort renamed wholesale?**
   Ruling 2 assumes kept. Needed before Task 3.
4. **Spec §14's four open decisions remain open** — patient-visible reply wording, the retention figure,
   whether to provision the dedicated Supabase project, and the week-1 collision rule. None blocks Phase 3,
   but the reply wording is spoken aloud during the Task 10 demonstration, so it is worth confirming that
   the provisional words are acceptable to say to an audience.
