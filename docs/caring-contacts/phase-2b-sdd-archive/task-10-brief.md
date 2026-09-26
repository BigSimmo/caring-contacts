# Task 10 brief — plan and contact detail

**Plan:** `docs/superpowers/plans/2026-08-24-caring-contact-phase-2b-screens.md`, Group 1, Task 10.
**The standing discipline applies in full** —
`docs/caring-contacts/phase-2b-sdd-archive/STANDING-DISCIPLINE.md`. Read it once; it replaces the
verification boilerplate earlier briefs carried inline, and every rule in it is named with the defect
that bought it.

**Do not touch `docs/caring-contacts/phase-2b-build-record.md`** — the controller owns it and it is the
one file guaranteed to conflict. Other implementers are live in other worktrees on other branches.

Caring Contacts is a suicide-prevention prototype. Every patient is fictional and **nothing is ever
sent to any number**. Group 1 built the caseload, the patient overview and a four-stage sign-up that
creates a plan and starts it. You are building the screen a coordinator lands on **after** all that: the
one that answers "what is actually going to happen to this person, and what already has".

## Ruling [128] — you add NO new page route

The plan says "plan and contact detail" and that reads like two routes. It is neither.

- **Plan detail already has a route.** `/caring-contacts/patients/[patientId]?plan=<planId>` exists, and
  Ruling [97] fixed its shape: one patient can honestly hold two episodes, the overview never picks
  between them, and the clinician's choice travels **in the URL** so the chooser needs no client state.
  `patientPlanRoute()` in `src/lib/caring-contacts-routes.ts` builds it. Plan detail is that screen,
  deepened — not a second one.
- **Contact detail is an overlay, not a route.** `docs/caring-contacts/interaction-matrix.md` lists
  `delivery-detail` — product context "Plan/contact inspection", full-screen stage on phone, inspection
  drawer on desktop, **mutation: No**.

A `/caring-contacts/plans/[planId]` route would be a second surface that must independently re-validate
that the plan belongs to this patient **and** this team. Getting that wrong is the failure this domain
guards against hardest, and `CARING_CONTACTS_ROUTES` has no key for it — which is the routes module
telling you the same thing.

**If the approved design shows a standalone plan page, that is a difference to record and report, not a
reason to add the route.** The types win; the disagreement is worth writing down.

## What this screen must answer

**Everything on it is derived. Nothing is a literal** (Ruling [98], and Ruling [119] is the same finding
at its most consequential). A plan sends **nine** caring contacts rather than ten when the first contact
is set to discharge + 7, because the Week 1 contact is absorbed — and the final entry is a **closing
message**, a distinct kind, not one more caring contact.

- **What is going to happen**: the remaining schedule. `contactSendability()` in `model.ts` already
  classifies suppressed, cancelled, missed and sendable — **use it, do not classify again.** It exists
  because a screen once told a coordinator that a **stopped plan would still send**, which is the single
  worst defect this programme has produced.
- **What already happened**: delivery attempts and outcomes. `Delivered` is a **transport receipt and
  never a patient-state label** — the closed vocabulary is frozen and the scan checks bare identifiers.
- **Why anything is not sending**, separately for each reason. A suppressed contact
  (`absorbedByFirstContact`), a cancelled one, and a contact on a plan that has been stopped are three
  different facts and must not collapse into "not sending".

## The two stored fields that behave in OPPOSITE directions, and the defect that lives between them

This screen is the first to render both, and their retention rules are deliberate opposites. Read
Rulings [105] and [122] before you write either.

- **The first-contact reason** (Task 6b) is **cleared** by retention, because it is clinician prose that
  will name patients and places.
- **The attestation** (Task 9b) is **preserved** by retention, because it is `{ assurance, actorId,
instant }` with no patient content — the same class as an audit event, which de-identification
  deliberately keeps.

**A cleared reason must state itself as its own fact.** A plan whose reason has been cleared, and a plan
whose first contact was never moved and so never had one, are **different** and must not both render as
blank space. This is the same defect `ListEmptyState` exists to prevent, and it is worse here: the
absence of an explanation for a moved first contact reads as "nobody gave one".

**And the attestation is not a consent record.** It records that a coordinator confirmed they checked
the hospital record. No wording on this screen may say the patient consented — Task 9b's brief has the
full reasoning and four screens were corrected to get it right. **Name the destination, not the act**:
"recorded on the plan" survives; "stored", "kept" and "recorded" alone do not.

A plan created **before** the attestation migration genuinely holds none. There was no backfill, on
purpose — writing a placeholder would fabricate a clinical record. Say so as its own fact.

## The one overlay you wire, and the tension in wiring it

Wire **`delivery-detail`**'s inbound path. Leave `resolve-failed-delivery` to Task 14, and `pause`,
`withdrawal`, `reassignment` and `activation-success` to Task 11 — name every seam you leave in your
report.

**The tension, stated so you resolve it honestly rather than silently:** `delivery-detail` is
**mutation: No**, but Task 3 made `overlay-trigger.tsx` require a commit handler **at the type level**,
deliberately, so a screen cannot open a decision surface it has not wired. A no-op passed to satisfy the
compiler is exactly what that requirement exists to prevent.

Decide what "commit" means for a read-only inspection surface and **say why in the code**. If the honest
answer is that the type is wrong for non-mutating overlays, that is a finding worth reporting — do not
paper over it with a silent no-op, and do not weaken the type to make your screen compile.

## Reading it

The read goes through `auditedRead` with the same access identity the API side uses and fails closed on
every bad outcome. `src/app/caring-contacts/patients/page.tsx` is the model — read its module comment
first, including its note on **Ruling [94]**.

Per **Ruling [46]**, add an `AccessedObjectType` member rather than overloading one, **if** this read is
genuinely a different object from what the overview already reads. It may not be — the overview already
reads this plan. **Decide deliberately and say which you concluded**; Task 5b's defect was two different
reads sharing one member, and the trail filters on `objectType` with no `objectId` filter, so the
distinction was visible by eye and unaskable. If you do add a member, the `z.enum` in
`src/app/api/caring-contacts/access-trail/route.ts` is a hand-copy of that union and Task 12 has just
added a pin that keeps them in sync — use it rather than writing a second one.

## Constraints

- Nothing under `src/lib/caring-contacts/` may import from `@/components`, `@/app`, any `@/lib` module
  outside itself, Supabase or OpenAI. **A screen must never re-derive a rule a module owns.**
- **The service-state incident `note` must never cross into a Client Component.** A test asserts this.
- **Patient-visible copy is frozen, and you may not draft any.** `EXACT_PATIENT_VISIBLE_MESSAGE` is a
  **specimen, not a template** (Ruling [127]): one approved example, greeting and sender name included,
  measured at 252 septets against a hard two-segment ceiling with no room left. If this screen shows a
  message, it is **the approved example message for that pathway version** — never "this patient's
  message", and never with a name interpolated at render time.
- **Never render a raw role identifier to a clinician.** Role wording lives in the sealed domain and is
  resolved server-side. The vocabulary scan currently _rewards_ leaving identifiers on screen — it
  refuses "lead" as a whole word but passes `clinicalProgrammeLead` on a missing word boundary. That
  inversion is filed; do not exploit it.
- Every `<button>` does something. A control unavailable for a **stated reason** uses
  `aria-disabled="true"` + an inert handler + `title="… — coming soon"` + an `sr-only` note; native
  `disabled` is for **transient** inertness only, and never both on one control.
- Internal navigation via `<Link>` / `router.push`, hrefs from `src/lib/caring-contacts-routes.ts`,
  never a path literal — **including in tests**, once the route exists. Two raw `<a href>` in a test
  file went red in lint this week for exactly that.
- Design tokens only, no hex. Tap targets `min-h-12` (48px), **never `min-h-11`**, on the element
  **containing** the control — on a wrapper it leaves the row's whitespace dead.
- **Do not restate a count in prose** (Ruling [94]). State the invariant.
- **This is Next.js 16.** Read `node_modules/next/dist/docs/` before writing route or boundary code.

## Verification

**The standing discipline governs.** Beyond it, three cases specific to this screen:

- **A stopped plan.** Its remaining contacts must not read as forthcoming. Write this one first — it is
  the defect this screen most plausibly reintroduces.
- **A plan whose first-contact reason has been cleared**, against one that never had a reason. Both must
  be distinguishable on screen, and the assertion must fail if they collapse.
- **A plan with no attestation** (created before the migration), against one with an attestation. Same
  requirement.

**Do not compare two outputs of one function to each other and call it coverage.** Task 9b's mutation
falsified exactly that shape: three reads held only against one another stayed green when the mapper
they share was emptied, because three empty lists agree perfectly. Hold at least one side to expected
content.

Gates: `npm run test:cc-guards` only, including for mutations — the full `npm run test` is the
controller's at merge points, because three concurrent worktrees starved the exclusive lease. Then
typecheck and **uncached** lint (`npx eslint <paths>`, or clear `node_modules/.cache/eslint`; the
per-file cache hid two real errors this week). **Paste every `N passed` line; never report a gate from
an exit code.**

Tell me whether you think this touches `tests/ui-caring-contacts-workspace.spec.ts` — I run that gate.

## Report

**Commit early — before waiting on any gate.**
Write your full report to `docs/caring-contacts/phase-2b-sdd-archive/task-10-report.md`, then return
ONLY: status, commit SHAs, a one-line test summary, and your concerns. Do not paste the report into your
reply. Do not dispatch subagents. **Do not push and do not open a pull request.**
