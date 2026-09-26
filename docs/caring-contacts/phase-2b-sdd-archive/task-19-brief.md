# Task 19 brief — Guidance and Reports

**Plan:** `docs/superpowers/plans/2026-08-24-caring-contact-phase-2b-screens.md`, Group 5, Task 19.
**The standing discipline applies in full** —
`docs/caring-contacts/phase-2b-sdd-archive/STANDING-DISCIPLINE.md`. Read it once; it replaces the
verification boilerplate earlier briefs carried inline, and every rule in it is named with the defect
that bought it.

**Do not touch `docs/caring-contacts/phase-2b-build-record.md`** — the controller owns it and it is the
one file guaranteed to conflict. Other implementers are live in other worktrees on other branches.

Caring Contacts is a suicide-prevention prototype. Every patient is fictional and **nothing is ever
sent to any number**.

**These are in this phase by the owner's decision of 2026-08-24, reversing Ruling 75 which had deferred
them.** Both have approved designs, so nothing here needs designing from nothing.

## Reports — read this before you write a line of it

Spec §2.5 promises aggregate reporting on **programme reach**: Aboriginal and Torres Strait Islander
status, imported from the source record, used for exactly one purpose, with a governance-configured
**small-cell threshold** and a non-inferable **`Suppressed`** state.

**On 2026-08-25 the owner decided to stop collecting that field**, and the reasoning is the whole shape
of your task. The sign-up had been collecting it as **free text a clinician types**, because there is no
source record and no import path. Free text cannot deliver what §2.5 promises: small-cell suppression
**presupposes a bounded category set**, and unbounded distinct values — "Aboriginal", "aboriginal",
"ATSI", "Noongar", spellings, typos — mean **either every rare spelling is a cell of one and suppression
eats the report, or an unaudited normalisation step decides who counts as Aboriginal.** That second
outcome is a governance decision nobody has made, hidden inside a data-cleaning routine.

**The scope of that decision is narrow and it lands directly on you.** The input went. **The schema field
stays nullable, the column stays, `cultural_identity_reports` stays, and Task 19 still owes reach
reporting.** The owner has not changed his mind about wanting it — he declined to collect it by a route
that could not produce it. Replacing the input with a category picker is a schema-and-governance decision
he has **deferred**, and **no task may make it incidentally.** That includes yours.

So you are building a reach report over a field that **nothing currently populates**. Say that, plainly,
as its own fact. Do not render an empty breakdown that reads as "no Aboriginal or Torres Strait Islander
patients", do not fabricate categories, and do not add a collection path. Copy-review item B1 governs:
**a true statement about a smaller product beats a false one about a larger one.**

## The suppression rule, and the defect that makes naive suppression useless

`Suppressed` must be **non-inferable**. That word is doing real work and it is the part most
implementations get wrong.

**If you suppress every cell below the threshold but publish the total, a single suppressed cell is
exactly the total minus the cells you published.** Suppression that can be undone by subtraction is
decoration. The same holds across filters and across time: two reports that differ by one filter let a
reader difference them and recover the cell that only one of them suppressed.

You must handle this explicitly, and there are only a few honest options — **suppress a second cell so no
single value is recoverable (complementary suppression), or withhold the total, or withhold the breakdown
entirely.** Pick one, **say why in the code**, and **write the inference attempt as a test**: a case that
takes your rendered output and tries to recover a suppressed cell by arithmetic, and fails to. A
suppression test that only checks the word "Suppressed" appears is not a test of suppression.

**The threshold is governance-configured, not a literal you choose — and I have checked: there is nowhere
for it to live.** I searched the sealed domain and every caring-contacts migration for a small-cell
threshold and found none; the only "suppress" in the domain is the contact-suppression action, which is
unrelated. So **the configuration surface does not exist and you are the one who discovers it**.

**Do not invent a constant to unblock yourself.** A hardcoded threshold on a disclosure control is a
governance decision made by an implementer — the same failure the owner refused on 2026-08-25 when he
declined a data-cleaning routine that would silently decide who counts as Aboriginal. **Stop and report
it**, and say what shape the configuration would need. Whether the screen ships behind an explicit
"reach reporting is not configured" state, or the threshold gets a governance home first, is the owner's
call and not yours.

**What does exist, so you do not go looking:** `caring_contacts.cultural_identity_reports` is a real
table, created in `0001_caring_contacts_foundation.sql` and carrying RLS from `0002`. It is deliberately
a **separate reporting projection**, so an ordinary clinical read never touches it — read `0001`'s header
comment, which says why. It exists and it is empty.

## Guidance

Programme boundaries and operational guidance, per the approved design. The standing constraints do most
of the work here: **the closed transport vocabulary is frozen**, **no patient-visible copy may be
drafted**, and **no raw role identifier may be rendered to a clinician**. If the approved guidance text
states a capability this system does not have, that is the fifth instance of a pattern already recorded
four times — **report it, do not invent a source for it.**

## Two routes, and a nav shape that does not yet exist

You are adding `/caring-contacts/guidance` and `/caring-contacts/reports`. Both need the full new-route
checklist — page, inbound link **in the same change** (Ruling 89), `npm run sitemap:update`, a
`docs/codebase-index.md` entry, and a reachability assertion.

**But these two are not primary destinations.** `src/components/caring-contacts/workspace/shell.tsx`
carries them in `MORE_DESTINATIONS`, whose entries are `{ id, label, reason }` — **there is no `href`
field on that shape at all**, and every entry renders as `UnavailableDestination`. So you are extending
the More panel's contract, not just filling in a value, and every other entry must keep working without
one. A shape change that silently makes the remaining entries look broken is worse than the missing link.

### And while you are there — fix a shipped route that no phone can reach

**Templates is currently unreachable below 768px**, and this is the same missing capability. Verified by
two independent readings: the rail is `hidden … md:flex`, `PHONE_DESTINATIONS` filters `templates` out by
name, and every `MORE_DESTINATIONS` entry is href-less. So below 768px there is **no inbound link to a
shipped production route.**

**Route Templates through the More panel** once it carries real links. Do not solve it by displacing
something from the phone bar — that dock is `grid-cols-4` holding three destinations plus More, so
adding a fifth is a layout decision nobody has taken.

**The reason this was not caught, which you should understand before trusting the gate you are about to
satisfy:** `tests/route-reachability.test.ts` reads `shell.tsx` **as text** and regex-matches
`href(?::\s*|=\{)CARING_CONTACTS_ROUTES\.(\w+)`. It has no notion of which array the match sits in,
whether that array is filtered, or what CSS governs the element rendering it. The general orphan scan is
the same shape for the rest of the app. **So the orphan-route gate proves a route is referenced in
source, not that it is reachable at any viewport a user can have** — and it will pass for your two new
routes whether or not a phone can reach them.

**Therefore write a test that can actually fail on this.** A DOM assertion that the phone navigation
renders each destination you added as a real link is the minimum; say in your report what a general fix
would need, because this is repo-wide and not Caring Contacts' to close alone.

`shell.tsx` is shared with other live branches; expect a merge conflict there and leave it to the
controller.

## Reading it

Both reads go through `auditedRead` with the same access identity the API side uses, failing closed on
every bad outcome. `src/app/caring-contacts/patients/page.tsx` is the model — read its module comment
first, including its note on **Ruling [94]**.

Per **Ruling [46]**, add an `AccessedObjectType` member rather than overloading one, and consider
carefully whether Guidance and Reports are the same object — they are not. Task 5b's defect was two
different reads sharing one member: the trail's query surface filters on `objectType` with **no
`objectId` filter**, so the distinction was visible by eye and unaskable. The `z.enum` in
`src/app/api/caring-contacts/access-trail/route.ts` is a hand-copy of that union; Task 12 added a pin that
keeps them in sync, so **use it rather than writing a second one.**

**A reach report is the most sensitive read in this workspace.** Whatever else you do, it is audited, it
is team-scoped, and it fails closed.

## Constraints

- Nothing under `src/lib/caring-contacts/` may import from `@/components`, `@/app`, any `@/lib` module
  outside itself, Supabase or OpenAI. **A screen must never re-derive a rule a module owns** — and a
  suppression threshold is a rule.
- **The service-state incident `note` must never cross into a Client Component.**
- **The closed transport vocabulary is frozen**: high risk, safe, engagement score, campaign, lead,
  conversion, best match, inbox, conversation, clinical risk, risk score, wellbeing score, and any claim
  that replies are monitored. `Delivered` is a transport receipt, never a patient-state label. The scan
  checks **bare identifiers** too.
- **Never rank clinicians** (spec §4.2). Reports is operational only. If the approved design shows
  anything that orders people by output, that is a difference to record and report.
- Every `<button>` does something. A control unavailable for a **stated reason** uses
  `aria-disabled="true"` + an inert handler + `title="… — coming soon"` + an `sr-only` note; native
  `disabled` is for **transient** inertness only, and never both on one control.
- Internal navigation via `<Link>` / `router.push`, hrefs from `src/lib/caring-contacts-routes.ts`, never
  a path literal — **including in tests**, once the route exists.
- Design tokens only, no hex. Tap targets `min-h-12` (48px), **never `min-h-11`**, on the element
  **containing** the control.
- **Do not restate a count in prose** (Ruling [94]). State the invariant. This matters more here than
  anywhere: a report is nothing but counts, and a count in its prose will be wrong the first time the data
  moves.
- **This is Next.js 16.** Read `node_modules/next/dist/docs/` before writing route or boundary code.

## Verification

**The standing discipline governs.** Beyond it, write these first:

- **The inference attempt.** Take the rendered output and try to recover a suppressed cell arithmetically.
  It must fail. Mutate your suppression so the recovery succeeds, and confirm the test goes red — that is
  the only thing that proves the suppression is real rather than cosmetic.
- **A reach report over a field nothing populates**, rendering as its own explicit fact, distinguishable
  from a report over a populated field that genuinely has no members in a category. Those are different
  statements and a careless screen makes them identical.
- **An assertion is proof only if some reachable state makes it fail.** Do not assert a field is empty
  when the fixture never fills it — set it, assert it is held, then assert the rule empties it.
- Forced-colors and 320px.

Gates: `npm run test:cc-guards` only, including for mutations — the full `npm run test` is the
controller's at merge points. Then typecheck and **uncached** lint, and **run them after your last edit**,
not before it. Two rounds were lost in this programme to a green typecheck followed by one more added
case. **Paste every `N passed` line; never report a gate from an exit code.**

**This one touches `tests/ui-caring-contacts-workspace.spec.ts`** — two new routes and a changed nav
shape. Say what you think it needs; I run that gate.

## Report

**Commit early — before waiting on any gate.**
Write your full report to `docs/caring-contacts/phase-2b-sdd-archive/task-19-report.md`, then return
ONLY: status, commit SHAs, a one-line test summary, and your concerns. Do not paste the report into your
reply. Do not dispatch subagents. **Do not push and do not open a pull request.**
