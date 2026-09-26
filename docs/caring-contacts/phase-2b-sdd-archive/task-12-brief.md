# Task 12 brief — the schedule read

**Plan:** `docs/superpowers/plans/2026-08-24-caring-contact-phase-2b-screens.md`, Group 2, Task 12.
**The standing discipline applies in full** —
`docs/caring-contacts/phase-2b-sdd-archive/STANDING-DISCIPLINE.md`. Read it once; it replaces the
verification boilerplate earlier briefs carried inline, and every rule in it is named with the defect
that bought it.

You are in a **separate worktree** (`D:\Worktrees\Database\cc-schedule`, branch
`claude/caring-contacts-schedule`). Other implementers are working in two other worktrees on other
branches. **Do not touch `docs/caring-contacts/phase-2b-build-record.md`** — the controller owns it
elsewhere and it is the one file guaranteed to conflict.

Caring Contacts is a suicide-prevention prototype. Every patient is fictional and **nothing is ever
sent to any number**. Group 1 built the caseload, the patient overview and a four-stage sign-up that
creates a plan and starts it. Group 2 builds "what is due" — you are building the **read** it needs.

## Ruling [124] — derive from `listPlans`; add no repository method

The plan says "the schedule read API". **Do not add one to the repository contract.** Everything a
schedule needs is already in what `listPlans` returns: each `PlanRecord` carries
`contacts: StoredContact[]`, and each of those carries `planned` (`sendAt`, `calendarDay`,
`cadenceLabel`, `messageType`, and `suppressed` when absorbed) alongside `contact.state`.

Three reasons, and the third is the one that decides it:

1. **It is an aggregation over existing rules, not a new rule.** The plan says the same of Task 17's
   roll-up and asks for the decision to be made deliberately rather than by habit.
2. **Team scoping comes free.** `listPlans` is already scoped; a new repository read would have to
   re-derive that, and getting it wrong is the failure this domain most guards against.
3. **A second read surface is a second thing to keep honest.** There is already a filed issue that
   `listSendableContacts` has no plan-state gate, so a draft plan's contacts present as sendable.
   **Do not use `listSendableContacts`** and do not fix it here — that is a retrieval-surface change
   with its own review.

**Where the derivation lives is yours to decide, and say why in the code.** The sealed domain
(`src/lib/caring-contacts/`) or the API layer are both defensible; the domain-isolation constraint
does not settle it, because this is arithmetic over values the domain already produced.

## What the read must answer

The Schedule screen (Task 13) needs, for a given day or range:

- **What is due**, grouped by the **three sending windows** — `morning`, `afternoon`, `earlyEvening`.
  One preference applies per plan; the windows map to fixed AWST hours and `schedule.ts` owns that
  mapping. **Do not re-derive it.**
- **What is not due and why.** A suppressed contact (`absorbedByFirstContact`) and a cancelled one are
  different facts and must not collapse into "not sending". Task 6's `contactSendability()` in
  `model.ts` already classifies this — **use it rather than classifying again.**
- **Named exceptions** — the operational panel Task 13 renders.

**Counts are derived, never literal** (Ruling [98]). The number of contacts in a plan is conditional:
setting the first contact to discharge + 7 absorbs the Week 1 contact, so a plan sends nine rather
than ten, and the last entry is a **closing message**, a distinct kind and not one more caring
contact.

## Ruling [125] — the read is audited, and it names itself honestly in the trail

Every read on this workspace goes through `auditedRead` with the same access identity the API side
uses, and fails closed on every bad outcome. `src/app/caring-contacts/patients/page.tsx` is the model
— read its module comment first, including its note on **Ruling [94]**.

**Give this read its own `AccessedObjectType` member rather than overloading one.** Ruling [46] says
add a member rather than overload, and Task 5b proved why: `patientDirectory` already carried two
different referral reads, and the trail's query surface filters on `objectType` with **no `objectId`
filter**, so the distinction was visible by eye and unaskable. If you add a member, the route's
`z.enum` in `src/app/api/caring-contacts/access-trail/route.ts` is a hand-copy of that union and must
be kept in sync — there is a filed issue that nothing enforces it.

## What you are NOT building

- **No screen.** Task 13 builds the Schedule screen on what you leave. Say in your report exactly what
  it gets and what shape it is in.
- **No overlays.** Task 14 and Task 20 own those.
- **No change to `listSendableContacts`**, `schedule.ts`'s window mapping, or `contactSendability()`.

## Verification

**The standing discipline governs.** Beyond it, two things specific to this task:

- **Test the boundaries of the day, not the middle.** A schedule read is where a timezone error hides:
  AWST is UTC+8 with no daylight saving, and `schedule.ts` already owns `awstCalendarDay`,
  `awstWallTimeToInstant` and the approved send window. **Use them.** A contact at 17:00 AWST on the
  last day of a month, and one at 00:00, are the cases worth writing first.
- **A plan with every contact suppressed, and a plan with none, must be distinguishable in the
  result** — not both rendered as "nothing due". That is the same defect `ListEmptyState` exists to
  prevent, one layer down.

Gates: `npm run test:cc-guards` for iteration, the full `npm run test` once at the end backgrounded,
then typecheck and lint. **Paste every `N passed` line; never report a gate from an exit code.**
Tell me whether you think this touches `tests/ui-caring-contacts-workspace.spec.ts` — I run that gate.

## Report

Write your full report to `docs/caring-contacts/phase-2b-sdd-archive/task-12-report.md`, then return
ONLY: status, commit SHAs, a one-line test summary, and your concerns.
