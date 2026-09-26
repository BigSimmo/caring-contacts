# Task 15 brief — the templates library

**Plan:** `docs/superpowers/plans/2026-08-24-caring-contact-phase-2b-screens.md`, Group 3, Task 15.
**The standing discipline applies in full** —
`docs/caring-contacts/phase-2b-sdd-archive/STANDING-DISCIPLINE.md`. Read it once; it replaces the
verification boilerplate earlier briefs carried inline, and every rule in it is named with the defect
that bought it.

**Do not touch `docs/caring-contacts/phase-2b-build-record.md`** — the controller owns it and it is the
one file guaranteed to conflict. Other implementers are live in other worktrees on other branches.

Caring Contacts is a suicide-prevention prototype. Every patient is fictional and **nothing is ever
sent to any number**.

## Read this before anything else: there is only ONE message

The plan's Group 3 preamble records a gap that was nearly missed, and your whole task sits on it:

> The pathway-version lifecycle — draft, review, dual approval, publish, retire, immutable snapshot — is
> **fully built and API-wired**. But the actual patient-visible message text is a **single hard-coded
> provisional constant**, not per-version snapshot content. The database column reserved to hold approved
> message content is **empty and no row exists anywhere**.

So a template library can show version records, approvers and lifecycle state, and **cannot show a
different message per version, because there is only one message.** Two independent readings — one of the
storage, one of `copy-review.md` §1.3 from the copy side — had to be put side by side before this became
visible. It is not obvious from either alone.

**Ruling [127] settles what that one message is.** `EXACT_PATIENT_VISIBLE_MESSAGE` is a **specimen, not a
template**: one approved example, greeting and sender name included, measured at **252 septets against a
hard two-segment ceiling with no room left.** It has no name slot and cannot acquire one — a greeting
that varies with the patient makes the segment count vary too, so the one measured safety fact about this
message silently assumes a five-letter name.

**Therefore:** if this screen shows message text at all, it is **the approved example message for that
pathway version** — never "this patient's message", never with a name interpolated at render time, and
never presented as though each version has its own. **You may not author or draft any patient-visible
wording, ever.** Copy-review item B1 is the governing rule: _a true statement about a smaller product
beats a false one about a larger one._

## The governance claim you must NOT let this screen overstate

This is the safety-relevant part of the task and the reason it needs care.

The demo seed populates a pathway version so the workspace has something in it. A seeded version carries
**`PathwayVersionSnapshot.provenance`** — an optional, **weakening-only** marker whose entire purpose is
to stop a synthetic record presenting itself as a real governance record. The seed added it because
without it, a screen renders _"Approved by the clinical programme lead and the lived-experience
representative"_ over a record nobody approved.

**A templates library is precisely the screen that makes that claim.** Carry the provenance marker
wherever an approval is shown, and **fail safe**: an absent or unrecognised provenance must resolve to
the synthetic wording, never to no claim. That exact defect was found in the sign-up wizard — an
unrecognised value yielded `undefined`, the `=== null` test was false, and the screen rendered an empty
paragraph while the approval line stood **unqualified**. Do not reproduce it here.

**Dependency:** `provenance` arrives with the demo-seed branch. If it is not in your tree, **stop and tell
me** — do not invent a marker or proceed without one.

## The route, and the checklist that comes with it

You are adding a real production page route, `/caring-contacts/templates`. This repository has a gate for
exactly this and it fails the build:

1. Add the page.
2. **Light up the nav link in the same change.** `src/components/caring-contacts/workspace/shell.tsx`
   already declares the Templates destination **with no `href`** — deliberately. Ruling 89 is written
   above it: a navigation entry lit ahead of its screen points at a page that makes a false statement
   about whether anything exists. Add `href: CARING_CONTACTS_ROUTES.templates`.
3. `npm run sitemap:update`.
4. A `docs/codebase-index.md` entry.
5. A reachability assertion — `tests/route-reachability.test.ts` fails on a production page route with no
   inbound nav link.

`shell.tsx` is shared with other live branches; expect a merge conflict there and leave it to the
controller.

## What the screen shows

All three lifecycle states — **Current, Retired, Pending** — from the existing pathway-versions API.
**No new API and no new repository method**: the lifecycle is already API-wired, which the plan calls the
lightest half of this group. If you find you need a read that does not exist, that is a finding to report,
not a method to add.

Each state must be distinguishable as its own fact, and the three empty cases must not collapse:
a library with **no versions at all**, a library **filtered to a state that has none**, and a library
whose versions exist but are **all retired**, are three different things. §4.4 requires an empty list
caused by a filter to say what would change it, and an empty list caused by there being no data to say
something different. That is what `ListEmptyState` is for.

## What you are NOT building

- **No template detail screen.** Task 16 builds `/templates/[pathwayId]`, the message-preview surface and
  dual approval, and it carries design correction #2.
- **No overlays.** Task 16 owns this group's overlays, including `message-preview` and
  `template-changed-retired`. Name every seam you leave in your report.
- **No message content.** See above; it does not exist and you may not write it.

## Reading it

The read goes through `auditedRead` with the same access identity the API side uses and fails closed on
every bad outcome. `src/app/caring-contacts/patients/page.tsx` is the model — read its module comment
first, including its note on **Ruling [94]**.

Per **Ruling [46]**, add an `AccessedObjectType` member rather than overloading one. Task 5b is why:
`patientDirectory` already carried two different referral reads, and the trail's query surface filters on
`objectType` with **no `objectId` filter**, so the distinction was visible by eye and unaskable. If you
add a member, the `z.enum` in `src/app/api/caring-contacts/access-trail/route.ts` is a hand-copy of that
union — Task 12 added a pin that keeps them in sync, so **use it rather than writing a second one.**

## Constraints

- Nothing under `src/lib/caring-contacts/` may import from `@/components`, `@/app`, any `@/lib` module
  outside itself, Supabase or OpenAI. **A screen must never re-derive a rule a module owns.**
- **The service-state incident `note` must never cross into a Client Component.**
- **Never render a raw role identifier to a clinician** — and this screen is the one most likely to try,
  because approvers _are_ roles. Role wording lives in the sealed domain and is resolved server-side. The
  vocabulary scan currently _rewards_ leaving identifiers on screen: it refuses "lead" as a whole word but
  passes `clinicalProgrammeLead` on a missing word boundary. **That inversion is filed; do not exploit
  it.**
- **The closed transport vocabulary is frozen**: high risk, safe, engagement score, campaign, lead,
  conversion, best match, inbox, conversation, clinical risk, risk score, wellbeing score, and any claim
  that replies are monitored. `Delivered` is a transport receipt, never a patient-state label. The scan
  checks bare identifiers too.
- Every `<button>` does something. A control unavailable for a **stated reason** uses
  `aria-disabled="true"` + an inert handler + `title="… — coming soon"` + an `sr-only` note; native
  `disabled` is for **transient** inertness only, and never both on one control.
- Internal navigation via `<Link>` / `router.push`, hrefs from `src/lib/caring-contacts-routes.ts`, never
  a path literal — **including in tests**, once the route exists.
- Design tokens only, no hex. Tap targets `min-h-12` (48px), **never `min-h-11`**, on the element
  **containing** the control — on a wrapper it leaves the row's whitespace dead.
- **Do not restate a count in prose** (Ruling [94]). State the invariant.
- **This is Next.js 16.** Read `node_modules/next/dist/docs/` before writing route or boundary code.

## Verification

**The standing discipline governs.** Beyond it, write these first, because they are the task:

- **A seeded version's approval renders with its provenance qualification**, and **an unrecognised
  provenance value falls back to the synthetic wording rather than to no claim.** Mutate the fallback
  itself — a defect that only appears for a value no fixture produces is exactly the kind a suite does
  not notice.
- **The three empty cases, each against the others.** The assertion must fail if any two collapse.
- Forced-colors and 320px.

**Do not compare two outputs of one function to each other and call it coverage.** Task 9b's mutation
falsified exactly that shape: three reads held only against one another stayed green when the mapper they
share was emptied, because three empty lists agree perfectly. Hold at least one side to expected content.

Gates: `npm run test:cc-guards` only, including for mutations — the full `npm run test` is the
controller's at merge points, because concurrent worktrees starved the exclusive lease. Then typecheck and
**uncached** lint (`npx eslint <paths>`, or clear `node_modules/.cache/eslint`; the per-file cache hid two
real errors this week). **Paste every `N passed` line; never report a gate from an exit code.**

**This one almost certainly does touch `tests/ui-caring-contacts-workspace.spec.ts`** — you are adding a
route and lighting a nav link. Say what you think it needs; I run that gate.

## Report

**Commit early — before waiting on any gate.**
Write your full report to `docs/caring-contacts/phase-2b-sdd-archive/task-15-report.md`, then return
ONLY: status, commit SHAs, a one-line test summary, and your concerns. Do not paste the report into your
reply. Do not dispatch subagents. **Do not push and do not open a pull request.**
