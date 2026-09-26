# Task 13b brief — reveal one patient's name, one act at a time

**Owner decision, 2026-08-26.** The Schedule screen shows synthetic identifiers and no patient names.
Task 13's reviewer upheld that and then proposed a third option, which the owner has chosen: **a per-row
reveal.** Rows keep the identifier; a control on each row reveals **that one patient's** name.

**The standing discipline applies in full** — `docs/caring-contacts/phase-2b-sdd-archive/STANDING-DISCIPLINE.md`.

**Do not touch `docs/caring-contacts/phase-2b-build-record.md`** — the controller owns it. Other
implementers are live in other worktrees on other branches.

Caring Contacts is a suicide-prevention prototype. Every patient is fictional and **nothing is ever sent
to any number**.

## Why this shape, because it decides the whole implementation

Task 13 deliberately kept names off this screen, and the reviewer's judgement of that is the thing to hold
on to: **it protects the trail, not the names.** The coordinator who needs a name can already open the
record and generate a trail row. What an ambient page-level read would change is the _shape_ of the
record: folding `listPatientNames` into a view a coordinator refreshes all day turns _"who read patients'
names, and when"_ into a stream of page loads — and because the access trail has **no `objectId` filter**,
that noise cannot be filtered back out afterwards.

**A trail that records an intention is worth more than one that records ambient traffic.** So the design
requirement is not "show fewer names". It is:

> **One deliberate act → one trail row → one patient.**

Everything below follows from that sentence, and any implementation that satisfies the sentence is
acceptable.

## What that forbids, specifically

- **Do not fetch names for the visible rows up front and reveal from memory.** That is one read of many
  patients dressed as several reads of one, and it writes the wrong trail row — or worse, one row for a
  page the coordinator never looked at properly.
- **Do not use `listPatientNames`** or any collection read. This screen's reveal must read **one** patient.
- **Do not release the name to the client until the control is pressed.** If the name is in the page
  payload, the reveal is theatre and the trail row is a lie about when it was read.
- **Do not batch or debounce several reveals into one request.** Two names revealed is two acts.

## The read, which is the substantial part

You need a **single-patient** name read. Establish first whether one exists — `getEpisode` is the patient
overview's read and releases far more than a name; `listPatientNames` is a collection. **If neither fits,
say so before building**: adding a repository method is a contract change that goes in
`src/lib/caring-contacts/repository.ts` and `tests/helpers/caring-contacts-repository-contract.ts` so
**both stores** are held to it, and every method must go through `runRead`/`runWrite`, which is what emits
the row-level-security preamble. A method that skips it does not fail loudly — it runs privileged.

**The audit row is the deliverable, not a side effect.** It must name **that patient**, so the trail can
answer "who revealed whose name". Per **Ruling [46]** consider whether this is a new `AccessedObjectType`
member — but read Task 15's finding first, because it is the counter-example: a member that names a
_screen_ rather than an _object_ makes the trail **worse**, since the enum is single-valued and has no
`objectId` filter, so each new member subtracts from the answerability of the others. Decide deliberately
and record the reasoning either way. **If what you want is screen attribution, that needs a
`surface`/`context` dimension, not a second `objectType`** — and that is not this task.

## The control

- Every `<button>` does something. This one does — it reads.
- **Tap target `min-h-12` (48px) on the element containing the control**, never `min-h-11`, and never on a
  wrapping `<div>`: that leaves the row's whitespace dead on a phone, which was a real finding in Task 7.
- The reveal must be **announced** to a screen reader when it lands, not silently swapped in.
- **A revealed name must not enter the URL, the history, or any address** — Ruling [111], and the caseload
  screen has just been rebuilt to honour it. Note `overlayUrl()` copies every existing query parameter
  into each history entry it pushes, so anything that reaches the address is multiplied.
- Design tokens only, no hex. Internal navigation via `<Link>` / `router.push`, hrefs from
  `src/lib/caring-contacts-routes.ts`, never a path literal — including in tests.
- **Never render a raw role identifier to a clinician.**

## What you may also need to move

`NamesNotShownNotice` currently lives in `patients-directory.tsx`, and that file's own comment asks for it
to move into `workspace/` on second use. This is the second use. Move it rather than copying it; if the
two uses need different wording, that is a finding worth reporting, not two components.

## Verification

**The standing discipline governs.** Write these first, because they are the task:

- **One reveal writes exactly one trail row, and that row names that patient.** Mutate it: make the reveal
  read the collection instead, and confirm the case reddens on the row's shape — not merely on a count.
- **The name is not in the page payload before the control is pressed.** Give this a positive control:
  reveal a name that really is in the fixture, prove it arrives, and separately prove it was absent
  beforehand. Asserting absence over a fixture with no name in it proves nothing.
- **Two reveals write two rows**, naming two different patients.
- Forced-colors and 320px.

**"Could this possibly go red?" for every assertion you write.** Two tasks this session shipped instances
of that family _after naming it_, and one proved a refusal on the panel that displays it rather than on the
control a coordinator presses.

Gates: `npm run test:cc-guards` only, including for mutations. Then typecheck and **uncached** lint. If you
use a mutation driver, its presence check must compute the expected post-image in process, write it,
re-read from disk and assert **byte equality** — `!after.includes(find)` is structurally wrong for any
additive mutation. And **namespacing the driver's directory is not sufficient**: another task's row shape
crossed into a namespaced driver this session, so **refuse unrecognised row shapes loudly** rather than
logging them as a near-miss.

**Re-verify after your final edit** — a gate's verdict covers the tree it saw. **Paste every `N passed`
line; never report a gate from an exit code.** **Check every SHA you write down still exists.**

This touches `tests/ui-caring-contacts-workspace.spec.ts` — say what you think it needs; I run that gate.

## Report

**Commit early — before waiting on any gate.**
Write your full report to `docs/caring-contacts/phase-2b-sdd-archive/task-13b-report.md`, then return
ONLY: status, commit SHAs, a one-line test summary, and your concerns. Do not dispatch subagents. **Do not
push and do not open a pull request.**
