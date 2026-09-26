# Task P brief — the message uses the patient's first name

**Owner decision, 2026-08-26.** Two decisions, taken together:

1. **The patient-visible message uses the patient's first name.**
2. **The system ASKS for that name; it does not split the stored one.** A new field on stage 3 —
   _"What should we call them in messages?"_ — filled in by the clinician talking to the patient.

**The standing discipline applies in full** — `docs/caring-contacts/phase-2b-sdd-archive/STANDING-DISCIPLINE.md`.

**Do not touch `docs/caring-contacts/phase-2b-build-record.md`.** Other implementers are live in other
worktrees on other branches.

Caring Contacts is a suicide-prevention prototype. Every patient is fictional and **nothing is ever sent
to any number**.

## Why asking beats splitting, because you must not "simplify" this later

`patientDetail` holds **one free-text `patientName`** and nothing else. Splitting it at the first space
fails on: a person with one name; a person whose family name is written first; a typed title (`Mr John
Smith` → "Mr"); multiple given names; hyphenated names. Perth's population makes every one of those
routine rather than exotic.

**A suicide-prevention message that opens with someone's surname, or with "Mr", is worse than one that
uses no name at all.** So there is no parsing anywhere in this task. The clinician is the person actually
speaking to the patient; they type what to call them.

## Ruling [127] is REVERSED, and the reversal is narrow

Ruling [127] said `EXACT_PATIENT_VISIBLE_MESSAGE` is a **specimen, not a template** — because it had a
hardcoded name and no slot. The owner has now decided it should have one, so **it becomes a template.**

What does **not** change: the message is still **PROVISIONAL and not clinically approved**, and final
wording remains owned by the lived-experience and clinical-programme approval gate
(`docs/caring-contacts/message-review-pack.md` §1). **You are adding a slot to an unapproved draft. You
are not authoring or approving wording.** Every other word stays exactly as it is.

## The length contract, which is the part that can go quietly wrong

Measured, not assumed — I verified these against `tests/caring-contacts-message-copy.test.ts`:

- The message is **252 septets, 2 segments**, pinned by `EXACT_MESSAGE_GSM7`.
- GSM-7 concatenation is **153 septets per segment**, so the two-segment ceiling is **306**.
- The hardcoded name is `Rowan`, 5 septets. So there are roughly **54 septets of headroom.**

**A comment in `message-copy.ts` says "no room left". Read it in context before you trust it** — it means
no room for one specific extra sentence someone wanted to add, not no room at all. The controller
generalised that sentence and told the owner something false; do not inherit the error.

**Therefore:**

- **Cap the new field's length** so that no accepted value can push the message to three segments. Compute
  the cap from the constants — do **not** write a literal. A cap derived from `GSM_7_MULTI_SEGMENT_UNIT`
  and the message's own length stays correct when the wording changes; a literal does not.
- **Replace the pinned `septets: 252` with a proven bound**: for every accepted name length up to the cap,
  `segments <= 2`. Test the boundary — the longest accepted name, and one character beyond the cap being
  refused. **The exact-252 pin is the thing that must not simply be deleted**; it is replaced by a stronger
  statement, and your report should say so in those terms.
- Keep a case pinning the **unpersonalised** form too, if one still exists anywhere.

## What you are building

- **`message-copy.ts`** — the template and its slot. The sealed domain owns this; nothing here may import
  from `@/components`, `@/app`, another `@/lib` module, Supabase or OpenAI.
- **`patientDetail`** — a new field. It is `.strict()` with a fixed shape, so this is a **schema change**,
  not a field addition: the plans route schema, `StoredPatientDetail`, `repository.ts`, **both stores**,
  and `tests/helpers/caring-contacts-repository-contract.ts` so both are held to it. **Every repository
  method must go through `runRead`/`runWrite`** — that is what emits the row-level-security preamble, and
  a method that skips it does not fail loudly, it runs privileged.
- **A migration** in `caring-contacts/supabase/migrations/`, next in sequence. **NEVER in the repository
  root's `supabase/migrations/`** — that targets the live clinical database and merging to `main` applies
  it there within seconds. `0005` is the model: `if not exists`, explicit `check` constraints, **no default
  that hides a missing write**, transactional, replay-safe, and a `comment on` recording the obligation.
  **No backfill** — plans created before this genuinely hold no preferred name, and a placeholder would
  fabricate a clinical record.
- **Stage 3 of the wizard**, which already collects `patientName` and `patientMobileNumber`.
- **The demo seed**, so the screens have something real. Use the existing fictional first names.

## Retention — get this the right way round

**The preferred name is patient content, so retention MUST clear it**, exactly like `patientName`. This is
Ruling [105]'s class, **not** Ruling [122]'s: the attestation is preserved because it holds no patient
content; a name is nothing but patient content.

**Add it to `CLEARED_PATIENT_DETAIL` and pin it in the shared contract suite, mutation-proven in both
directions** — that a clearance removes it, and that the clearance still removes everything else it
should. A test proving only the first passes if clearance stops working entirely.

**A plan whose preferred name has been cleared, and a plan that never had one, must be distinguishable**
on any screen that shows it.

## Constraints

- **You may not author or alter any patient-visible wording** beyond inserting the slot. Not one word.
- **Nothing about a patient may travel in a query string** (Ruling [111]).
- **The service-state incident `note` must never cross into a Client Component.**
- Every `<button>` does something; never native `disabled` **and** `aria-disabled` on one control. Tap
  targets `min-h-12` on the element containing the control, never `min-h-11`.
- Design tokens only, no hex. **Do not restate a count in prose** (Ruling [94]).
- **This is Next.js 16.** Read `node_modules/next/dist/docs/` before writing boundary code.

## Verification

**The standing discipline governs.** Write these first:

- **The length bound**, both ends: longest accepted name still 2 segments; one character past the cap
  refused.
- **Retention clears the preferred name**, and still clears everything else — two mutations, both
  directions.
- **No parsing exists.** Assert that a stored `patientName` of `"Mr John Smith"` produces **no** greeting
  containing "Mr" or "Smith" unless the clinician typed it. Give it a positive control: a preferred name
  that _is_ set must appear.
- **"Could this possibly go red?" for every assertion.** Give every absence a positive control.

Gates: **`npm run test:cc-guards` only**, plus typecheck, **uncached** lint, and `prettier --check` with
the line pasted. **Re-verify after your final edit.** Check every SHA still exists. **Contention is
severe** — record every lock refusal UNRUN, retry, never force.

The Postgres suite needs Docker:
`docker run -d --name caring-contacts-pg -e POSTGRES_PASSWORD=caring-contacts-local -p 54329:5432 --restart unless-stopped postgres:17`
then `CARING_CONTACTS_DATABASE_URL=postgres://postgres:caring-contacts-local@127.0.0.1:54329/postgres npm run caring-contacts:db:test`.
**Prove the migration replays from empty**, not just that it applies to an existing local database. **No
`Test Files` summary line means no run**, whatever the exit code says.

## Report

**Commit early — before waiting on any gate.**
Write your full report to `docs/caring-contacts/phase-2b-sdd-archive/task-p-report.md`, then return ONLY:
status, commit SHAs, a one-line test summary, and your concerns. Do not dispatch subagents. **Do not push
and do not open a pull request.**
