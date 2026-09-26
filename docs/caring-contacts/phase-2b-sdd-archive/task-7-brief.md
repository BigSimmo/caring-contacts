# Task 7 brief — the activation wizard's shell, and stages 1 and 2

**Plan:** `docs/superpowers/plans/2026-08-24-caring-contact-phase-2b-screens.md`, Group 1, Tasks 7–9.
**These are your requirements.** Read **Rulings [109], [110], [111], [112] and [113]** in
`docs/caring-contacts/phase-2b-build-record.md` first — note the **square brackets**; a plain
`Ruling 109` grep finds nothing. Two of them overrule the approved mockup, and one is an owner
decision with its costs recorded beside it.

Caring Contacts is a suicide-prevention prototype. Every patient is fictional and **nothing is ever
sent to any number**. This is the flow a coordinator uses to put a discharged patient onto a caring
contacts plan: **agreement → pathway → personalisation → review and activation.** You are building
the route, the shell that carries all four stages, and **stages 1 and 2 only.** Tasks 8 and 9 build
stages 3 and 4 on what you leave them.

## What you are building

- `src/app/caring-contacts/plans/new/page.tsx` — the route. `CARING_CONTACTS_ROUTES.newPlan` already
  names it.
- The wizard shell: the four-stage stepper, the draft that survives a refresh, and the stage
  switching.
- **Stage 1, agreement.** The assurances a coordinator confirms before a pathway can be chosen.
- **Stage 2, pathway.** Choosing which message pathway version this plan will run.

**Do not build stages 3 or 4.** Leave them as an explicit, typed extension point — a stage the shell
knows about and renders as not-yet-built, using `UnavailableDestination`'s pattern (Ruling 52: an
unbuilt destination is an unavailable control with a stated reason, never a dead end). Say in your
report exactly what Tasks 8 and 9 must implement against what you leave.

## Ruling [109] — this screen gets a Client Component, and it is the first deliberate one

Every other screen in this workspace is a Server Component and works with JavaScript disabled. Tasks
5 and 6 both achieved a full filter-and-search screen with **no new client boundary**. This one
cannot, and the reason is an owner decision, not convenience.

**Ruling 13 holds this workspace's client payload to a rounding error — not to zero.** A four-step
data-entry form is a different thing from a list screen. But the licence is for _this route_:

- Load the wizard behind the same lazy `dynamic()` boundary the other routes use, so it never enters
  any other route's chunk.
- The client component is the wizard, not the page. The page stays a Server Component: it does the
  audited reads, fails closed, and renders the shell.
- **The service-state incident `note` must never cross into it.** That constraint is absolute and
  the wizard is exactly where it would be easiest to leak.

## Ruling [110] — the draft lives in `sessionStorage`, is cleared on both exits, and the clinician is told

**The owner decided this on 2026-08-25, knowing the cost.** A half-finished sign-up must survive a
page refresh and disappear when the tab closes. That means the patient's name and mobile number are
written to storage on the clinician's machine while the form is open — a shared ward computer, in
practice. The owner was asked twice, the second time with that exposure named explicitly, and chose
it. **Do not re-litigate it; implement it safely.**

Four requirements, and the third is the one that matters most:

1. **`sessionStorage`, never `localStorage`.** `localStorage` outlives the tab and would leave patient
   details on a ward machine indefinitely. The storage API must enforce tab-lifetime, not a comment
   promising it.
2. **Cleared on successful activation** — which Task 9 performs, so leave it a clear seam and say
   what it must call.
3. **Cleared on abandoning the flow.** Relying on tab close alone means a clinician who finishes and
   walks away leaves the previous patient's details for the next person at that machine. There must
   be a way to abandon, and it must clear.
4. **The screen says so, in plain words, in place.** Unfinished details are held on this computer
   until the tab is closed. That is the system doing something the clinician did not ask for, which
   is precisely spec §4.4's contract — and a notice reachable only by hovering has not been stated.

**Prove the clearing with a mutation.** Break each clear and confirm a test goes red. A test that
asserts the draft is written is not a test that it is removed.

## Ruling [111] — the wizard starts from an accepted referral, named in the URL by id

A plan is created for a referral: `createPlanSchema` requires `referralId`, `patientId` and
`pathwayVersionId`. So the route takes the referral — `?referral=<id>` — and reads it server-side.

- **A referral id in the URL is acceptable; a patient's name or mobile number is not.** The plans
  route already records why, and it is worth reading: _"The patient's name and mobile number travel
  in the BODY, never in the URL — a query string is logged by every proxy between here and the
  browser."_ Nothing you build may put patient detail in a URL, ever, including as a draft key.
- Validate the referral belongs to this actor's team before using it, exactly as Task 6 validates
  `?plan=`. A referral that is not this team's is not an error to explain in detail — it is simply
  not one this actor may see.
- No referral named, or one this actor cannot see: an honest state saying so, never a 404 that
  distinguishes "does not exist" from "another team's".

## Ruling [112] — stage 1 shows what a referral ACTUALLY carries; the mockup shows fields that do not exist

**Read this before writing stage 1, because the approved mockup will mislead you.**
`ActivationWorkflow`'s `AgreementStage` renders an identity row (`patient.fullName · patient.id`) and
a mobile-suitability row, both sourced "Imported referral record". **Neither is reproducible.**
`Referral` in `model.ts` is exactly five fields: `id`, `teamId`, `patientId`, `state`,
`pathwayVersionId`. There is **no patient name and no mobile number on a referral anywhere in this
domain** — they arrive in `createPlanSchema.patientDetail`, supplied by the clinician at stage 3.

So the assurances at stage 1 are **the coordinator's confirmations**, not imported facts. Build them
as that, and let the wording say which is which — an interface that presents a clinician's own
tick as an imported record is lying about provenance, on a screen whose entire purpose is assurance.

**If you conclude an assurance must be RECORDED rather than confirmed in-session, stop and report
it.** There is no field for it today. Do not invent a storage location, and do not quietly let it
live only in the draft as though that were durable.

## Ruling [113] — the pathway may already be chosen, and stage 2 must say so

`transitionReferral`'s `accept` action **carries a `pathwayVersionId`** (see the referrals route's
schema), and `Referral.pathwayVersionId` holds it. So an accepted referral can already name a
pathway, decided by whoever accepted it.

Stage 2 must therefore **show that as the existing decision and say where it came from**, not present
an empty choice as though nothing had been decided. If the coordinator changes it, that is a change
to an earlier decision and the interface should read that way. If the referral names none, stage 2 is
an ordinary first choice.

This is spec §4.4 again: where something has already been decided, the surface stating it also states
why and what would change it.

## Constraints

- Nothing under `src/lib/caring-contacts/` may import from `@/components`, `@/app`, any `@/lib`
  module outside itself, Supabase, or OpenAI. **A screen must never re-derive a rule a module owns.**
- Every audited read goes through `auditedRead` with the same access identity the API side uses for
  that read, and fails closed on every bad outcome. `src/app/caring-contacts/patients/page.tsx` is the
  model; read its module comment first, including its note on **Ruling [94]** — do not restate a count
  in prose anywhere in this task.
- **This is Next.js 16.** Read `node_modules/next/dist/docs/` before writing route or client-boundary
  code. It has breaking changes against most training data and reading beats reasoning.
- Every `<button>` does something. A control unavailable for a stated reason uses
  `aria-disabled="true"` + an inert handler + `title="… — coming soon"` + an `sr-only` note. **Never**
  native `disabled` and `aria-disabled` on the same control — lint fails on the pair. Note a form's
  submit button awaiting validity is _transient_ inertness, which is what native `disabled` is for.
- Internal navigation via `<Link>` / `router.push` / server `redirect()`, never a raw `<a href="/…">`.
  Every href from `src/lib/caring-contacts-routes.ts`, never a path literal.
- Design tokens only, no hardcoded hex. Tap targets `min-h-12` (48px) — **never `min-h-11`**.
- No import from `src/components/caring-contacts/mockups/**`. Read the mockup as a specification only,
  and remember Ruling [112]: it is wrong where the domain disagrees with it.
- **Patient-visible copy is frozen.** A screen that hardcodes a patient-visible string is a defect
  even when the string is correct. The wizard previews messages; those come from the sealed domain's
  `message-copy`, never from a literal here.
- **The closed transport vocabulary is frozen.** Prohibited in any interface string: high risk, safe,
  engagement score, campaign, lead, conversion, best match, inbox, conversation, clinical risk, risk
  score, wellbeing score, and any claim that replies are monitored. `Delivered` is a transport
  receipt, never a patient-state label. The scan checks **bare identifiers too** — it once caught a
  lucide icon named `Inbox`.
- **Do not wire the 24 overlays.** Task 11 does this group's overlay wiring. The mockup opens several
  from these stages; leave the seams and say what Task 11 must connect.
- Add your screen to `WORKSPACE_SCREENS` in `tests/ui-caring-contacts-workspace.spec.ts`. **Be aware
  it is a registry, not a driver** — joining it carries no proof by itself, because the
  accessibility-mode and service-stop suites name their screens as literals and nothing iterates the
  array. Your screen needs its own browser cases, as Tasks 5 and 6 each wrote theirs.

## Verification

- **Test-first.** Write the failing test, run it, watch it fail for the stated reason, then implement.
- Deliberately break each piece and confirm the covering test goes red. **Check FIRST that the
  mutation changes a value some assertion reads**, and **prove the mutation is in the tree before
  believing any result**. Never chain the presence check and the gate with `&&` — `grep -c` exits
  non-zero on a zero count and short-circuits, so the gate never runs and prints no summary line.
  Use `;`.
- **Predict what each mutation's failure message will say, not just that it will be red**, and compare.
  An unexpected number in an assertion error is a second defect. On 2026-08-25 a uniqueness control in
  this programme fired at `expected 3 to be 1` where 2 was predicted — the third occurrence was inside
  the mutation's own comment, and the control had been counting prose.
- A mutation whose anchor no longer matches — because Prettier reflowed the line — prints a **green**
  summary on an unmutated tree. **Itemise every attempt**, including greens and unmatched anchors, and
  give no aggregate total. A mutation that _should_ leave a gate green is evidence too; label it.
- `npm run test:focused -- --files <paths>` while iterating, then the **full `npm run test`** — this
  tree is policed by static scans living in files your diff will not contain. Then `npm run typecheck`
  and `npm run lint`.
- **Never report a gate as passing from an exit code — paste the `N passed` line.** A refusal arriving
  through a pipe leaves `$?` reading **0** for a gate that never ran; no summary line means no run.
- **A lock refusal is neither a pass nor a failure.** Retry; **never force past another worktree's
  lease.** If you believe an orphaned run is your own, prove it by the recorded working directory, not
  by a live PID — and note that evidence adequate for _waiting_ is not adequate for _breaking_ a
  lease. The strength of evidence you need scales with the destructiveness of what you do with it.
- Tell me whether you think this touches `tests/ui-caring-contacts-workspace.spec.ts`. I run that gate.

## Report

**Commit early — before waiting on any gate.** This machine has destroyed working directories
mid-session and a commit is the only thing that has survived.

Write your full report to `docs/caring-contacts/phase-2b-sdd-archive/task-7-report.md`, then return
ONLY: status, commit SHAs, a one-line test summary, and your concerns. Do not paste the report into
your reply. Do not dispatch subagents. **Do not push and do not open a pull request.**
