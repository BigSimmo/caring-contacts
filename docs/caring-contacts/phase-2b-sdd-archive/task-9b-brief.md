# Task 9b brief — store the stage-1 assurances as an attestation

**Plan:** `docs/superpowers/plans/2026-08-24-caring-contact-phase-2b-screens.md`, Group 1 (added after
Task 9, on the owner's decision of 2026-08-25).
**These are your requirements.** Read **Rulings [105], [117], [120], [122] and [123]** in
`docs/caring-contacts/phase-2b-build-record.md` first — note the **square brackets**; a plain
`Ruling 122` grep finds nothing. **Ruling [122] is the design and it inverts a rule you will find
elsewhere in that file** — read it before writing anything.

Caring Contacts is a suicide-prevention prototype. Every patient is fictional and **nothing is ever
sent to any number**. Tasks 7–9 built the activation wizard end to end; it now creates a plan and
starts it. You are closing the one gap the owner asked to be closed.

## The gap

Stage 1 asks the coordinator to confirm two things — `patientAgreed` and
`mobileIsPatientControlled`. **Neither can be stored.** `createPlanSchema` is `.strict()` with ten
fields, `patientDetail` is `.strict()` with four, and `StoredPatientDetail` has no room. They cannot
even be **sent**, so this is a schema change rather than a field addition.

Today an activated plan carries **no evidence that anyone confirmed the patient agreed to receive the
messages.**

## What you are storing, and what you are NOT

**Read this paragraph twice; it is the whole shape of the task.** The approved design sources the
agreement row as `"Imported source record—not legal or treatment consent"`. **This system is not
where consent lives.** The hospital record holds the agreement; the coordinator is confirming they
**checked** it.

So you are storing an **attestation that a check happened** — who confirmed, what they confirmed,
when — and **not a consent record.** That distinction is the reason the owner approved this quickly,
and it must survive into the field names, the wording, and the comments. A future reader who mistakes
this for a consent model will draw wrong conclusions about what the system can attest to.

## Ruling [122], as three requirements

1. **On the PLAN, not in `patientDetail`.** It is an act performed by a clinician, not a fact about
   the patient. Putting it in `patientDetail` would also subject it to `CLEARED_PATIENT_DETAIL`,
   which is exactly wrong — see (3).
2. **A list, not two fields.** Stage 1's assurance set is not frozen: the design shows five rows, two
   of which are confirmations and three display. A fixed pair needs a schema change the first time a
   third is added, and this programme has already paid for one of those. It must be **non-empty** when
   a plan is created.
3. **Retention must NOT clear it, and this inverts Ruling [105].** Ruling [105] required the
   first-contact reason to be cleared **because it is clinician prose that will name patients and
   places.** An attestation is `{ assurance, actorId, instant }` — **no patient content at all** — and
   it is the same class as an audit event, which spec line 413 says de-identification deliberately
   **preserves**: _"removes patient fields and preserves actor, action, timestamp, object type"_.
   `deidentifyAccessEvent` does precisely that. **Clearing the attestation would destroy the evidence
   that a check happened while keeping the plan it belongs to** — the opposite of what retention is
   for.

   **Pin this in the shared contract suite, and mutation-prove it in both directions**: that a
   retention clearance leaves the attestation intact, and that it still clears everything it is
   supposed to. A test proving only the first would pass if clearance stopped working entirely.

**If you conclude the attestation must carry free text** — a note on what was checked — **stop and
report it.** That text WOULD name patients and the clearing rule flips for that field. Ruling [122]
records this so the next person asks rather than inherits the answer.

## What you are building

- `src/lib/caring-contacts/repository.ts` — the shared contract both stores satisfy.
- `src/lib/caring-contacts/in-memory-repository.ts` and `db/postgres-repository.ts` — both implement
  it. **Every method here must go through `runRead`/`runWrite`**, which is what emits the
  `set_config('caring_contacts.team_id', …)` / `set local role caring_contacts_app` preamble. A method
  that skips it does not fail loudly; it runs privileged with row-level security bypassed.
- `tests/helpers/caring-contacts-repository-contract.ts` — **the shared suite both stores run.** New
  behaviour goes HERE, not in one store's file, or the two drift.
- A migration in **`caring-contacts/supabase/migrations/`**, next in sequence after `0005`.
- `src/app/api/caring-contacts/plans/route.ts` — the `.strict()` schema gains the field.
- The wizard: stage 1 already collects the two booleans into the draft
  (`draft.assurances.patientAgreed`, `.mobileIsPatientControlled`). Stage 4 sends them.

## The migration, and the trap that would be expensive

**Caring-contact migrations live ONLY in `caring-contacts/supabase/migrations/`, NEVER in
`supabase/migrations/`.** The repository root's `supabase/` targets the live Clinical KB database
`sjrfecxgysukkwxsowpy`, and merging to `main` applies it there within seconds. `0005` is the model —
match its style: `if not exists`, explicit `check` constraints where a value is closed, no default
that hides a missing write, transactional, replay-safe, and a `comment on` recording the obligation so
it travels with the schema rather than living only in a test.

**No backfill.** Plans created before this migration genuinely hold no attestation and the interface
must say so as its own fact. Writing a placeholder would fabricate a clinical record.

## The wording, which four screens now get wrong in your favour

Three screens and one panel currently state that the confirmations are **not recorded on the plan**.
That was true and is about to stop being true. Find them all — the wizard's stage 1 panel, its status
line, stage 4's review, and Task 9's activation wording — and make each true again.

**The rule this wizard bought with three attempts at one sentence: name the destination, not the
act.** "Recorded on the plan" survives; "stored", "kept" and "recorded" alone do not, because this
system distinguishes _held in a tab's storage_ from _written onto the plan_ while ordinary English does
not. There is a comment at the site saying so.

**And do not overshoot the other way.** The attestation records that a coordinator confirmed a check.
It does not record that the patient consented, and no screen may say it does.

## Constraints

- Nothing under `src/lib/caring-contacts/` may import from `@/components`, `@/app`, any `@/lib` module
  outside itself, Supabase, or OpenAI.
- Team scoping is not optional. An attestation on another team's plan must be as unobtainable as the
  plan.
- **Never render a raw role identifier to a clinician.** Role wording lives in the sealed domain and
  is resolved server-side. The interface-vocabulary scan currently _rewards_ leaving identifiers on
  screen — it refuses "lead" as a whole word but passes `clinicalProgrammeLead` on a missing word
  boundary. That inversion is filed; **do not exploit it.**
- The service-state incident `note` must never cross into the Client Component.
- Design tokens only, no hex; tap targets `min-h-12` — never `min-h-11`, and put it on the element
  **containing** the control.
- **Do not restate a count in prose** (Ruling [94]). State the invariant.

## Verification

- **Test-first.** New behaviour goes in the shared contract so both stores are held to it.
- The Postgres suite needs a database:
  `docker run -d --name caring-contacts-pg -e POSTGRES_PASSWORD=caring-contacts-local -p 54329:5432 --restart unless-stopped postgres:17`
  then `CARING_CONTACTS_DATABASE_URL=postgres://postgres:caring-contacts-local@127.0.0.1:54329/postgres npm run caring-contacts:db:test`.
  **No `Test Files` summary line means no run**, whatever the exit code says.
- **Prove the migration replays from empty**, not just that it applies to your existing local database.
- **A mutation proves the assertion it makes fail, not the case it makes red.** A case with N
  assertions needs N mutations or needs splitting. Predict each failure message and compare.
- **A check you believe is redundant is a hypothesis too** — mutate it before filing it as redundant.
- **The `grep -c` presence check has a known false negative** (Task 9's M12 reported 0 while the
  mutation was live; the cause is under investigation and the likeliest is an anchor spanning a line
  break after a Prettier reflow). It fails safe — it can under-report presence, never invent it — so a
  `0` is not proof the mutation is absent. Confirm by reading the file when it disagrees with you.
- **Commit each piece before you mutate the file it lives in**, and **stage explicit paths, never
  `git add -A`** — both rules were bought this week, in both directions.
- Gates: `npm run test:cc-guards` for iteration; the full `npm run test` once at the end,
  **backgrounded from the first command**; plus the Postgres suite. Paste every `N passed` line.
- **A lock refusal is neither a pass nor a failure.** Retry; never force past another worktree's lease.
- Tell me whether you think this touches `tests/ui-caring-contacts-workspace.spec.ts`. I run that gate.

## Report

**Commit early — before waiting on any gate.**
Write your full report to `docs/caring-contacts/phase-2b-sdd-archive/task-9b-report.md`, then return
ONLY: status, commit SHAs, a one-line test summary, and your concerns. Do not paste the report into
your reply. Do not dispatch subagents. **Do not push and do not open a pull request.**
