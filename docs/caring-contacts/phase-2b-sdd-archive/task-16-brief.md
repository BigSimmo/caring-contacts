# Task 16 brief — template detail, dual approval, and this group's overlays

**Plan:** `docs/superpowers/plans/2026-08-24-caring-contact-phase-2b-screens.md`, Group 3, Task 16.
**The standing discipline applies in full** — `docs/caring-contacts/phase-2b-sdd-archive/STANDING-DISCIPLINE.md`.

**Do not touch `docs/caring-contacts/phase-2b-build-record.md`.** Other implementers are live in other
worktrees on other branches.

Caring Contacts is a suicide-prevention prototype. Every patient is fictional and **nothing is ever sent
to any number**. **Task 15 built the templates library on this branch** and went through two fix rounds —
read `task-15-report.md` first, especially its concerns, because three of them are yours to inherit.

## The governing fact, unchanged from Task 15: there is only ONE message

The pathway-version lifecycle — draft, review, dual approval, publish, retire, immutable snapshot — is
fully built and API-wired. **The patient-visible message text is a single provisional constant, not
per-version snapshot content.** The reserved column is empty and no row exists.

So a template detail screen **cannot show a different message per version, because there is only one.**
Task 15 solved the library's half by having each row state **what its own record holds** rather than making
a blanket claim — because a blanket "message content is not yet authored" is **false** against the seeded
record, which really does hold the approved specimen in `messageTextByType.standard`. Inherit that
approach; do not re-derive it, and do not regress to the blanket form.

**Do not render a per-version message body you do not have.** Copy-review item B1 governs: _a true
statement about a smaller product beats a false one about a larger one._

## The message text is changing underneath you — read it, never assemble it

Ruling [127] said the approved message was a **specimen with no name slot**. **The owner has since decided
it gains a first-name slot**, and that change is being made in the sealed domain on the trunk as Task P.

**Read the wording from the sealed domain and render what it gives you.** Do not hardcode its shape, do
not assume it has or lacks a slot, and **never assemble a greeting yourself.** If the preview needs a name
you do not have, that is a finding to report, not a gap to fill.

**You may not author or alter any patient-visible wording, ever.**

## Design correction #2, and a correction to the plan's own instruction

The plan says the reply-handling copy is superseded by spec §2.1, and adds _"if the owner's copy decisions
A2/A3 land first, they win."_

**They have landed.** `message-copy.ts` carries them, dated 2026-08-24, with the reasoning in the module:
`PATIENT_VISIBLE_NO_REPLY_NOTICE` is now _"No one reads replies to this number"_ — because the previous
wording became untrue the moment the number could receive — and `AUTOMATED_REPLY_RESPONSE` says the reply
is automatic, so a patient told nobody reads replies who then receives one cannot conclude somebody read
theirs.

**So: use what the domain holds. Do not implement the spec's older §2.1 text.** If you find any difference
between the domain and the spec, the domain wins and the difference is a finding.

## The governance claim — the same safety requirement as the library

A seeded pathway version carries **`PathwayVersionSnapshot.provenance`**, a **weakening-only** marker that
stops a synthetic record presenting itself as a real governance record. Without it, a screen renders
_"Approved by the clinical programme lead and the lived-experience representative"_ over a record **nobody
approved** — and a **detail** screen makes that claim more prominently than a list does.

**Resolve it through the sealed domain's `pathwayVersionProvenanceWording`, never the wording map
directly.** Its contract, hardened over two rounds: **absent → no qualifier** (no claim was made, and
stamping "invented for demonstration" over a possibly genuine record would be a false statement);
**unrecognised → the weakening wording** (a claim this build cannot read must fail safe). Those two are
different and the distinction is deliberate. **Mutate the fallback branch itself** — the Postgres reader
casts the snapshot with an unchecked `as`, so an unrecognised value is a real possibility.

**Dual approval is the heart of this screen.** Both approvers, their roles resolved server-side to wording,
and the qualification. **Never render a raw role identifier** — the vocabulary scan _rewards_ it, refusing
"lead" as a whole word while passing `clinicalProgrammeLead` on a missing word boundary. That inversion is
filed; do not exploit it.

## The route, and a gate the plan does not name

`/caring-contacts/templates/[pathwayId]`, a dynamic production route. Full checklist: page, inbound link
in the same change (Ruling 89 — the library's rows are the natural link), `npm run sitemap:update`, a
`docs/codebase-index.md` entry, and a reachability assertion.

**Task 15 found a gate the briefs had never mentioned, and it said explicitly that you will hit it.**
`checkAdoptionManifest` is a **census**: an undeclared production page route turns
`design-system-adoption.test.ts` red inside `test:cc-guards`. Three steps — the contract entry,
`design-system:adoption:update`, and the route-count assertion.

**And do not repeat the mistake it made there.** Adding the contract entry records `status: "passed"` for
dark, forced-colours, 320px, print and browser against a spec block that may not exist — **the entry reads
as coverage more strongly than a missing block does.** Write the browser block in the same change. It will
not be run here; I run that gate. Model it on the templates library block Task 15 added.

**Do NOT switch the demo seed on for the Playwright server** to populate this screen. Verified:
`emptyStateColours` _throws_ when the empty state is absent, so seeding would **fail** existing tests
rather than merely alter them.

## Overlays

You own **`template-changed-retired`** and the templates-context **`message-preview`**. `message-preview`
is **Mutation: No** in the frozen matrix, and `overlay-trigger.tsx` requires a commit handler at the type
level, so use the `ExitOnlyOverlayTrigger` pattern rather than a no-op — Task 10 built it and its reasoning
is in the module. **Do not narrow the overlay id union yourself**; Task 14 is doing that on another branch.

Mutating overlays **recheck connectivity, permission, authentication and version state at commit time, not
at open time**, and follow the matrix's feedback contract: success announces the synthetic outcome; **no
change states explicitly that no external or production action occurred**; a guard rejection retains the
surface, keeps the action focusable with `aria-disabled`, names the reason and **does not mutate**; modal
close restores focus to the originating action.

## Reading it

Through `auditedRead`, failing closed on every bad outcome. **Per Ruling [46] and Task 15's upheld finding,
think before adding an `AccessedObjectType` member.** Task 15 declined one and was right: the trail's enum
is single-valued with **no `objectId` filter**, so a member naming a _screen_ splits one askable question
into two that cannot be unioned. **This screen reads one pathway version — `objectId` is what distinguishes
it**, which is the mechanism working as designed. Decide on that reasoning and record it.

## Constraints

- Nothing under `src/lib/caring-contacts/` may import from `@/components`, `@/app`, any `@/lib` module
  outside itself, Supabase or OpenAI. **The service-state incident `note` must never cross into a Client
  Component.**
- **Nothing about a patient may travel in a query string** (Ruling [111]); `overlayUrl()` multiplies
  anything that reaches the address. A fix is in flight on the trunk — do not add to it.
- Every `<button>` does something; never native `disabled` **and** `aria-disabled` together. Tap targets
  `min-h-12` on the element **containing** the control. Design tokens only, no hex. Internal navigation via
  `<Link>` / `router.push`, hrefs from the routes module, never a path literal — including in tests.
- **Do not restate a count in prose** (Ruling [94]). **This is Next.js 16** — read
  `node_modules/next/dist/docs/` before writing route or boundary code.

## Verification

Write these first:

- **A seeded version's approval renders with its provenance qualification**, and **an unrecognised value
  falls back to the weakening wording while an absent one renders no qualifier.** Mutate the fallback
  branch itself.
- **The specimen never renders as this patient's message** — and pair it with the row still saying the
  record _holds_ that wording, so both directions are falsifiable.
- **Dual approval renders both approvers with role wording and no raw identifier.**
- Forced-colors and 320px.

**"Could this possibly go red?" for every assertion.** Give every absence a positive control — asserting
the specimen is absent from a page whose store holds no version proves nothing, which is exactly the trap
Task 15 fell into and corrected.

Gates: **`npm run test:cc-guards` only**, plus typecheck, **uncached** lint, and `prettier --check` with the
line pasted. **Re-verify after your final edit.** Check every SHA still exists. **Contention is severe** —
record every lock refusal UNRUN, retry, never force.

## Report

**Commit early — before waiting on any gate.**
Write your full report to `docs/caring-contacts/phase-2b-sdd-archive/task-16-report.md`, then return ONLY:
status, commit SHAs, a one-line test summary, and your concerns. Do not dispatch subagents. **Do not push
and do not open a pull request.**
