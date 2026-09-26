# Task 8 brief — stage 3, personalisation

**Plan:** `docs/superpowers/plans/2026-08-24-caring-contact-phase-2b-screens.md`, Group 1, Task 8.
**These are your requirements.** Read **Rulings [109], [110], [114], [115] and [116]** in
`docs/caring-contacts/phase-2b-build-record.md` first — note the **square brackets**; a plain
`Ruling 114` grep finds nothing. **Ruling [114] overrules the approved mockup on what this stage
fundamentally is**, and if you build from the mockup without reading it you will build the wrong
screen.

Caring Contacts is a suicide-prevention prototype. Every patient is fictional and **nothing is ever
sent to any number**. Task 7 built the activation wizard's route, its shell, the draft that survives
a refresh, and stages 1 and 2. You are building **stage 3 only**. Task 9 builds stage 4.

Read Task 7's report (`task-7-report.md`) before starting — it says exactly what it left you and what
the extension point requires.

## Ruling [114] — this is a DATA ENTRY stage, not a confirmation stage. The mockup has it backwards.

`PersonalisationStage` in `src/components/caring-contacts/mockups/activation-workflow.tsx` renders
four rows — preferred name, message variant, team identity, coordinator signature — as **read-only
governed values with green ticks**, sourced "Imported from the synthetic referral".

**That is not what the domain supports.** `createPlanSchema.patientDetail` requires the clinician to
**supply**:

```
patientName:            z.string().min(1)      // required
patientMobileNumber:    z.string().min(1)      // required
patientIdentifiers:     z.array(z.string().min(1))
culturalIdentity:       z.string().min(1).nullable()
```

And a `Referral` is five fields — `id`, `teamId`, `patientId`, `state`, `pathwayVersionId` — with
**no patient name and no mobile number anywhere in this domain** (Ruling [112], established by
reading `model.ts` rather than the mockup). There is nothing to import and nothing to tick.

So stage 3 is where a clinician **types a real person's name and mobile number.** Build it as that.
The mockup's green ticks are a picture of a system that reads from a hospital record it is not
connected to; presenting a clinician's own typing as an imported governed value would be a lie about
provenance on the screen that decides where messages get sent.

**What the mockup gets right and you should keep:** the sending-preference fieldset (three options,
one preference per plan) matches `sendingPreference: z.enum(["morning", "afternoon",
"earlyEvening"])` exactly. Keep its shape.

**What else in it is wrong:** its legend says _"One preference applies to all 10 contacts."_
Ruling [98] settled that the count is **derived and conditional** — Week 1 is absorbed when the first
contact is set to discharge + 7, giving nine, and the last entry is a closing message, a distinct
kind. Do not write a number here. State the property: one preference applies to every contact in the
plan.

## Ruling [115] — the mobile number is required, and the design does not show a field for it

`patientMobileNumber` is `z.string().min(1)` — a plan **cannot be created without one** — and
`PersonalisationStage` contains no input for it. This is not an oversight you may route around by
leaving it to stage 4: stage 4 is review and activation, and a review screen that is also the only
place a required value can be entered is not a review.

Collect it here. And because this is the field that decides where a message physically goes:

- **Validate it before letting the wizard advance**, and say what is wrong in words, in place.
- Do not invent a format rule from scratch. `FICTIONAL_CONTACTS_BY_ROLE` and the message-policy
  module already hold this domain's notion of a contact number; look for an existing validator before
  writing one, and if none exists say so rather than quietly inventing the authority.
- **Every number in this prototype is fictional and non-connecting.** The screen must say so where
  the number is entered. A clinician who believes this field reaches a real handset is the single
  most dangerous misunderstanding this interface can create.

## Ruling [116] — cultural identity is optional, and the screen says why it is asked

`culturalIdentity` is `string | null` — the only nullable field in `patientDetail`, deliberately.

- It must be genuinely optional: skippable without an error, and stored as `null` rather than `""`
  when not given.
- **The screen states, in place, why it is asked and what it is used for.** Asking a distressed
  person's cultural identity without saying why is the kind of thing that erodes trust in a service,
  and this repository's standard for the system doing something unexplained (spec §4.4) applies at
  least as strongly to asking something unexplained.
- If you cannot find a recorded purpose for it in the spec or the domain, **say so in your report and
  state the absence on the screen rather than inventing a justification.** An invented reason for
  collecting demographic data is worse than an admitted one.

## The draft, and what stage 3 puts in it

Task 7 built the draft. **The owner decided on 2026-08-25, knowing the cost, that it lives in
`sessionStorage`** — surviving a page refresh, cleared when the tab closes. Stage 3 is where that
decision becomes concrete: **this is the stage whose values are a patient's name and mobile number,
written to storage on the clinician's machine.**

- Use the draft Task 7 built. Do not add a second storage mechanism.
- **Nothing you write may put patient detail in a URL**, including as a draft key.
  `plans/route.ts` records why in the code: _"a query string is logged by every proxy between here
  and the browser."_
- Task 7's notice tells the clinician unfinished details are held on this computer. Check it is
  reachable from this stage and still true of what stage 3 stores; if stage 3 makes it more true —
  and it does — the wording may need to be stronger, not weaker.

## Constraints

- Nothing under `src/lib/caring-contacts/` may import from `@/components`, `@/app`, any `@/lib`
  module outside itself, Supabase, or OpenAI. **A screen must never re-derive a rule a module owns.**
- **Patient-visible copy is frozen.** The message preview reads the sealed domain's `message-copy`.
  A screen that hardcodes a patient-visible string is a defect **even when the string is correct**,
  because it puts the owner's pending decisions in two places.
- **Do not wire the overlays.** The mockup opens four from this stage — communication preference,
  adjust schedule, save draft, discard changes. **Task 11 wires this group's overlays.** Leave the
  seams and say in your report exactly what Task 11 must connect.
- Every `<button>` does something. A control unavailable for a stated reason uses
  `aria-disabled="true"` + an inert handler + `title="… — coming soon"` + an `sr-only` note. Never
  native `disabled` and `aria-disabled` on the same control. A submit awaiting form validity is
  _transient_ inertness, which is what native `disabled` is for.
- Internal navigation via `<Link>` / `router.push` / server `redirect()`; hrefs from
  `src/lib/caring-contacts-routes.ts`, never a path literal.
- Design tokens only, no hardcoded hex. Tap targets `min-h-12` (48px) — **never `min-h-11`**.
- **The closed transport vocabulary is frozen.** Prohibited in any interface string: high risk, safe,
  engagement score, campaign, lead, conversion, best match, inbox, conversation, clinical risk, risk
  score, wellbeing score, and any claim that replies are monitored. The scan checks **bare
  identifiers too**.
- **Do not restate a count in prose** (Ruling [94]). State the invariant.
- **This is Next.js 16.** Read `node_modules/next/dist/docs/` before writing boundary code.

## Verification — and one change to how you run the gates

- **Test-first.** Write the failing test, run it, watch it fail for the stated reason, then implement.
- Deliberately break each piece and confirm the covering test goes red. **Check FIRST that the
  mutation changes a value some assertion reads**, and **prove the mutation is in the tree before
  believing any result**. Never chain the presence check and the gate with `&&` — `grep -c` exits
  non-zero on a zero count and short-circuits, so the gate never runs and prints no summary line.
  Use `;`.
- **Predict what each mutation's failure message will say**, not just that it will be red, and
  compare. An unexpected number in an assertion error is a second defect: on 2026-08-25 a control in
  this programme fired at `expected 3 to be 1` where 2 was predicted, because it was counting its own
  comment.
- **Itemise every attempt**, including greens and unmatched anchors, with **no aggregate total**. A
  mutation whose anchor no longer matches — because Prettier reflowed the line — prints a **green**
  summary on an unmutated tree. A mutation that _should_ leave a gate green is evidence too; label it.
- **NEW — do not run the full suite on every fix round.** During iteration and every fix round, run
  your own tests plus this named guard set, which is the tree-walking scans a diff cannot contain:

  ```
  node scripts/run-vitest.mjs run --reporter=dot \
    tests/caring-contacts-domain-isolation.test.ts \
    tests/caring-contacts-interface-vocabulary.test.ts \
    tests/caring-contacts-retention.test.ts \
    tests/caring-contacts-overlay-definitions.test.ts \
    tests/route-reachability.test.ts \
    tests/design-system-adoption.test.ts \
    <your own test files>
  ```

  Then the **full `npm run test` once**, at the end, before you report. `npm run test:focused`
  deliberately **refuses** a list of test files ("Focused test selection is unsafe"), which is why
  this uses `run-vitest.mjs` directly — the same mechanism `test:ci-workflows` uses.

  **Report both timings** — the guard set and the full suite — with the `N passed` lines. The saving
  is expected but has never been measured; you are the first task to measure it, and if it turns out
  not to save anything I want to know that rather than keep believing it.

- Then `npm run typecheck` and `npm run lint`.
- **Never report a gate as passing from an exit code — paste the `N passed` line.** A refusal through
  a pipe leaves `$?` reading **0** for a gate that never ran; no summary line means no run.
- **A lock refusal is neither a pass nor a failure.** One exclusive heavy job runs at a time across
  every worktree of this repository, and other projects are active on this machine — a wait of hours
  has already happened once. Retry; **never force past another worktree's lease.** If you believe an
  orphaned run is your own, prove it from the lease record's `worktree` field, not a live PID — and
  note that evidence adequate for _waiting_ is not adequate for _breaking_ a lease.
- Tell me whether you think this touches `tests/ui-caring-contacts-workspace.spec.ts`. I run that gate.

## Report

**Commit early — before waiting on any gate.**
Write your full report to `docs/caring-contacts/phase-2b-sdd-archive/task-8-report.md`, then return
ONLY: status, commit SHAs, a one-line test summary, and your concerns. Do not paste the report into
your reply. Do not dispatch subagents. **Do not push and do not open a pull request.**
