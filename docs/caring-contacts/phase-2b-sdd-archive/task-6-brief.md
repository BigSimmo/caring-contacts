# Task 6 brief — the Patient overview screen

**Plan:** `docs/superpowers/plans/2026-08-24-caring-contact-phase-2b-screens.md`, Group 1, Task 6.
**These are your requirements.** Read **Rulings 96, 97, 98 and 99** in
`docs/caring-contacts/phase-2b-build-record.md` first — they settle four questions this task would
otherwise have to guess at, and two of them overrule the plan.

Caring Contacts is a suicide-prevention prototype: patients discharged from hospital receive a fixed
schedule of brief, non-demanding messages over twelve months. Every patient is fictional and
**nothing is ever sent to any number**. Task 5 built the caseload; this is the screen a clinician
reaches from a row of it.

## What you are building

`src/app/caring-contacts/patients/[patientId]/page.tsx` and its component — one patient's episode:
who they are, which plan is running, what has happened on it, and what is still to come.

**This is the one screen in the whole workspace that may call `getEpisode`.** It is the only read
that releases the patient's name, mobile number, identifiers and cultural identity together, and
every other screen is built to avoid it. Here it is legitimate — but call it **once**, for **one**
plan, and only after Ruling 97's rule has picked that plan.

## Read the established pattern first, and copy it

`src/app/caring-contacts/patients/page.tsx` (Task 5, just reviewed) is the model and is heavily
commented. Same spine: `isCaringContactsDemoEnabled()` then `notFound()`; `resolveDemoActor()`;
`caringContactsStore()`; every read wrapped in `auditedRead` with the same access identity the API
side already uses for that read; fail closed on every bad outcome; then
`<CaringContactsShell title description serviceState>` behind the same lazy `dynamic()` boundary.

Read its module comment before writing anything — particularly the paragraph on **Ruling 94**. Do
not restate a count in prose anywhere in this task. State the invariant instead. That paragraph has
now been wrong three times in this programme; each time the count was corrected and a sentence
depending on it was not.

**This is Next.js 16.** A dynamic segment's `params` is not what most training data says it is.
Read `node_modules/next/dist/docs/` for the current contract before writing the route signature —
reading beats reasoning here, and this is the first dynamic route in the workspace.

## Ruling 97 — the overview is scoped to ONE plan, and it never chooses which

The route is keyed by **patient**, the reads are keyed by **plan**, and one patient can honestly
have two episodes — `repository.ts` says so explicitly and `markRetentionCleared` clears detail per
plan, so two plans for one patient can legitimately differ in what they still hold.

So:

- Resolve the patient's plans from `listPlans` filtered by `patientId` — team-scoped for free, and
  it reuses the read Task 5 already established rather than adding an oracle keyed by patient id.
- **Zero plans** → an honest empty state saying this team has no plan for this patient. Not a 404:
  the actor may legitimately have reached a patient whose plan is on another team, and the answer
  must not distinguish that from "no plan exists" (`getPlan` deliberately gives the same answer for
  both; do not become the screen that tells them apart).
- **Exactly one plan** → render it.
- **More than one, and no plan named in the URL** → present the plans and let the clinician pick.
  **Do not choose for them.** A screen that silently picked would show one plan's schedule under a
  heading carrying the patient's name, which is the error that matters most here.
- Accept an optional `?plan=<planId>` search param to name the plan. Validate it belongs to this
  patient and this team before using it; a `planId` from the URL that does not is not an error to
  report in detail, it is simply not a plan this actor may see.

**`getEpisode` is called only once a single plan is determined.** In the chooser case, take the
name from `listPatientNames` (Ruling 91's narrow read, built in Task 5b) — a chooser does not need a
mobile number.

## Ruling 96 — the first-contact-date CONTROL is not yours; the DISPLAY is

The plan routes design correction #1 to this task. **Spec §2.3 overrules it**: its own Consequences
sentence puts the control on "the review-and-activation screen", which is Tasks 7–9, not here.

What this screen does instead is **show** the first contact date, and — when it is not the default
of discharge + 1 day — show the recorded reason **in place**. That is spec §4.4's explained
automation, and it is a contract: wherever the system or an earlier decision has moved something,
the surface stating it must also state why, in plain words, where the reader is looking. A date
with no reason beside it, or a reason reachable only by hovering, fails this.

Ruling 86 already established the domain half is built: `schedule.ts` takes and validates
`firstContactDate`, and the plans POST schema accepts `firstContactDate` and `firstContactReason`.
**Do not build a second path.** If you find the stored plan does not actually carry the reason where
this screen can read it, that is a real gap — report it, do not invent a place to keep it.

## Ruling 98 — the contact count is DERIVED, never written as a word or a literal

The mockup (`PatientOverviewProductPage` in `src/components/caring-contacts/mockups/product-pages.tsx`)
is the approved design for this screen and is **out of date on exactly this point**. It hard-codes
`"10 contacts over 12 months"` and `aria-label="Ten-contact continuity"`. Both are wrong as literals:

- The cadence is Day 1, Week 1, then months 1, 2, 3, 4, 6, 8, 10 and 12 — ten entries.
- Week 1 is **suppressed** (`suppressed: { reason: "absorbedByFirstContact" }`) exactly when the
  coordinator set the first contact to discharge + 7 days, because two caring contacts must never
  land on one day. In that case there are **nine** sendable contacts, not ten. That is design
  correction #4, and it is conditional, not a new fixed number.
- The last entry, Month 12, is a **closing message** (`messageType: "closing"`), a distinct kind and
  not one more caring contact. That is design correction #3. Label it as what it is.

So: count from the data, distinguish suppressed from sendable, and give the closing message its own
label. And a suppressed contact is the system having acted on its own — §4.4 applies, so say **why**
it is suppressed, in place, in plain words.

Read `src/lib/caring-contacts/schedule.ts` for the model rather than trusting this paragraph. The
domain already holds all of it; your job is to display it honestly, not to re-derive it. **A screen
must never re-derive a rule a module already owns.**

## Ruling 99 — wire the directory row, or the route is an orphan and the build fails

`src/components/caring-contacts/workspace/patients-directory.tsx` currently renders each row's
detail control as `UnavailableDestination`, and its own comment says why: Ruling 52 — an unbuilt
destination is an unavailable control with a stated reason, never a link into a route that would 404. **You are building that destination**, so swap the control for
`<Link href={patientRoute(record.patientId)}>`. The comment says this is the whole of the change;
check that it is, and update the comment so it no longer describes a future that has arrived.

Then all four, or the build fails on an orphan route:

1. The inbound link above.
2. `npm run sitemap:update`.
3. An entry in `docs/codebase-index.md`.
4. A reachability assertion — see `tests/route-reachability.test.ts`.

## The browser surface — add your screen to `WORKSPACE_SCREENS`

`tests/ui-caring-contacts-workspace.spec.ts` holds `WORKSPACE_SCREENS`, and the design-system
adoption contract names that file as the sole evidence for all five proof categories of the
`caring-contacts-workspace` surface. **A screen on that surface that is not in that array is a
silenced gate**: the proofs pass by never visiting the route. Task 5 added Patients; add yours.

That file's own comment says this, and the build record records that **nothing enforces it** — it is
policy held by people. If you can see a cheap way to make the omission fail rather than pass, build
it and say so. If you cannot, say that too; do not build an expensive one.

A dynamic route needs a real id to visit. Find what the demo store actually seeds rather than
inventing one, and if the id is not stable enough to hard-code in a spec, say so instead of pinning
a value that will rot.

## Constraints

- Nothing under `src/lib/caring-contacts/` may import from `@/components`, `@/app`, any `@/lib`
  module outside itself, Supabase, or OpenAI.
- **The service-state incident `note` must never reach a Client Component.**
- Prefer a Server Component. Ruling 13 holds this workspace's client payload to a rounding error —
  Task 5 achieved a full filter-and-search screen with no new client boundary, using URL links and a
  `method="get"` form. If you conclude a boundary is genuinely unavoidable here, **say so in your
  report with your reasoning** rather than adding one quietly.
- Every `<button>` does something. A control unavailable for a stated reason uses
  `aria-disabled="true"` + an inert handler + `title="… — coming soon"` + an `sr-only` note. Never
  native `disabled` and `aria-disabled` on the same control — lint fails on the pair.
- Internal navigation via `<Link>` / `router.push` / server `redirect()`, never a raw `<a href="/…">`.
  Build every href from `src/lib/caring-contacts-routes.ts`, never a path literal.
- Design tokens only, no hardcoded hex. Tap targets `min-h-12` (48px) — **never `min-h-11`**,
  whatever generic accessibility guidance says; it reintroduces a known `ui-smoke` flake.
- No import from `src/components/caring-contacts/mockups/**`. Read the mockup as a specification
  only, and remember Ruling 98: it is wrong where the spec disagrees with it.
- **The closed transport vocabulary is frozen.** `Delivered` is a transport receipt and never a
  patient-state label. Prohibited in any interface string: high risk, safe, engagement score,
  campaign, lead, conversion, best match, inbox, conversation, clinical risk, risk score, wellbeing
  score, and any claim that replies are monitored. A static scan enforces this **on bare identifiers
  too** — it once caught a lucide icon named `Inbox`.
- Do not restate a count in prose (Ruling 94).

## Verification

- **Test-first.** Write the failing test, run it, watch it fail for the stated reason, then implement.
- Deliberately break each piece and confirm the covering test goes red. **Check FIRST that the
  mutation changes a value some assertion actually reads**, and **prove the mutation is in the tree
  before believing any result**. Never chain the presence check and the test with `&&` — `grep -c`
  exits non-zero on a zero count, so a mutation that removes what you are counting short-circuits
  and the gate never runs, printing no summary line. Use `;`.
- **Itemise every mutation attempt**, including ones that did not go red or whose anchor never
  matched. Do not report an aggregate total; the table is the evidence.
- `npm run test:focused -- --files <paths>` while iterating, then the **full `npm run test`** — this
  tree is policed by static scans living in files your diff will not contain, which is how a real
  failure once survived two tasks here. Then `npm run typecheck` and `npm run lint`.
- **Never report a gate as passing from an exit code — paste the `N passed` line.**
- **A lock-acquisition failure is neither a pass nor a failure.** The cross-worktree coordinator
  refuses a heavy run when another worktree holds the lease, and can throw `EPERM` under
  concurrency. No `Test Files` summary line means no run, whatever the exit code says. Retry rather
  than reporting it red, and **never force past it** — a forced run can flake another worktree's.
  If it stays refused, report which gate did not run.
- Tell me whether you think your change could affect `tests/ui-caring-contacts-workspace.spec.ts`.
  I run that gate.

## Report

**Commit early — before waiting on any gate.** This machine has destroyed working directories
mid-session and a commit is the only thing that has survived.

Write your full report to `docs/caring-contacts/phase-2b-sdd-archive/task-6-report.md`, then return
ONLY: status, commit SHAs, a one-line test summary, and your concerns. Do not paste the report into
your reply. Do not dispatch subagents. **Do not push and do not open a pull request.**
