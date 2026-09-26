# Task 9 brief — stage 4, review and activation

**Plan:** `docs/superpowers/plans/2026-08-24-caring-contact-phase-2b-screens.md`, Group 1, Task 9.
**These are your requirements.** Read **Rulings [96], [98], [109], [110], [117], [118], [119] and
[120]** in `docs/caring-contacts/phase-2b-build-record.md` first — note the **square brackets**; a
plain `Ruling 117` grep finds nothing.

Caring Contacts is a suicide-prevention prototype. Every patient is fictional and **nothing is ever
sent to any number**. Tasks 7 and 8 built the wizard's route, shell, draft and stages 1–3. **You are
building stage 4, and it is the only stage that writes.** Read both their reports first
(`task-7-report.md`, `task-8-report.md`) — they say what they left you.

**This is the first screen in the entire workspace that creates anything.** Everything before it
reads. That single fact is why most of this brief is about failure rather than success.

## Ruling [117] — the write, and the three orderings that must not be got wrong

Stage 4 POSTs to `/api/caring-contacts/plans`, which is built on `writeHandler` — so the audit event
and the idempotency check come free and you must not re-implement either.

**Three orderings, each of which is a defect if reversed:**

1. **Confirm success → clear the draft → navigate.** Never clear before the response, never navigate
   before clearing. Clearing early loses a clinician's typing on a failure; navigating early leaves a
   patient's name and mobile number in that tab's storage on a shared ward computer, which is exactly
   what Ruling [110]'s third requirement exists to prevent.
2. **On ANY failure the draft must survive.** A clinician who has typed a name, a mobile number and
   identifiers and then hits a network error, a validation refusal, or a permission denial must lose
   none of it. Test this explicitly: the failure path is the one nobody writes a test for and the one
   a real clinician will meet first.
3. **The refusal must say which failure it was, in words, in place.** "Something went wrong" on the
   screen that creates a suicide-prevention contact plan is not acceptable. `writeHandler`'s refusal
   codes are named for a reason — surface the distinction between "you may not do this", "this plan
   already exists", and "the schedule could not be built".

## Ruling [120] — the plan id and the idempotency key are minted ONCE, together, and held in the draft

`createPlanSchema` requires **both** a `planId` and an `idempotencyKey`, each an
`auditableIdentifier`. Nothing upstream mints them, so this stage does.

**Mint both at the moment stage 4 is first reached, store them in the draft, and reuse them for every
retry of that submission.** The handler's own comment is the authority here and is worth reading in
full: _"Every write route therefore REQUIRES one in the body rather than deriving a default… Only the
caller knows whether this request is a retry of the last one."_

**The trap, stated plainly so you do not fall into it:** if you mint a fresh `planId` on each attempt,
a clinician who presses Activate twice after a timeout creates **two plans for one patient** — two
schedules, two sets of messages. If you mint them once and reuse them, the second attempt is correctly
refused as a replay. This is the whole reason the key is caller-supplied.

They live in the draft for the same reason everything else does, and they are cleared with it.

## Ruling [118] — the first-contact-date control belongs here, and it must show its consequence

Ruling [96] moved this control off the patient overview and onto **this** screen, because spec §2.3's
own Consequences sentence names "the review-and-activation screen".

The domain half is already built (Ruling [86]) — **do not build a second path**:

- Default is **discharge + 1 day**.
- Movable within **the discharge day to discharge + 7 inclusive**.
- **Any value other than the default requires a recorded reason.** `schedule.ts` refuses with
  `first-contact-reason-required` otherwise.
- Task 6b added the storage, a length cap, and a named refusal `first-contact-reason-too-long`.
  Surface both refusals distinguishably.

**The part that is yours and is not in the mockup at all:** moving the date has a **consequence the
clinician must see while choosing, not after.** Setting the first contact to discharge + 7 collides
with the Week 1 contact, which is then suppressed (`absorbedByFirstContact`) — so the plan sends
**nine** caring contacts instead of ten. That is spec §4.4's explained-automation contract at its
sharpest: the system is about to remove a contact from a suicide-prevention schedule as a side effect
of a date choice, and the screen must say so **in place, before the choice is committed**.

## Ruling [119] — the schedule preview is derived; the mockup's "10-contact schedule" is a literal and it is wrong

Same finding as Ruling [98], now at its most consequential because this is the last screen before the
plan exists. `ReviewStage` hard-codes a `"10-contact schedule"` heading and shows
`Agreement confirmed: Yes` as though it were a stored fact.

- **Derive every count** from the schedule the domain builds. Task 6's `contactSendability()` in
  `model.ts` and `summariseStoredContacts()` in `repository.ts` already do this work — use them
  rather than counting again.
- Distinguish **sendable**, **suppressed** and the **closing message** (`messageType: "closing"`,
  design correction #3). A closing message is not one more caring contact.
- **`Agreement confirmed: Yes` must not be presented as a stored fact.** It is not stored — that gap
  is with the owner and is unresolved. Present it as what stage 1 actually captured: a confirmation
  made in this session, not recorded on the plan.

## The confirmation step — the one overlay you DO wire

Task 11 wires this group's overlays and you should leave them all alone **except one**: the
final-activation confirmation. An Activate control that writes with no confirmation step is not
something to ship and then fix later, and Task 3 built `overlay-trigger.tsx` to **require a commit
handler at the type level** precisely so a screen cannot open a decision surface it has not wired.

Wire that one. Leave every other seam named in your report for Task 11.

## Wording — a rule bought with three attempts

"Held in this tab's storage" and "written onto the plan" are different things, and this wizard got one
sentence wrong **twice, in opposite directions**, before it stuck. The rule that came out of it:
**name the destination, not the act.** "Recorded on the plan" survives; "stored", "kept" and
"recorded" alone do not. There is a comment at the site saying so. Stage 4 is where the two meanings
finally diverge for real — before the write they are held; after it, some are recorded and some
still are not.

## Constraints

- Nothing under `src/lib/caring-contacts/` may import from `@/components`, `@/app`, any `@/lib`
  module outside itself, Supabase, or OpenAI. **A screen must never re-derive a rule a module owns.**
- The service-state incident `note` must never cross into the Client Component. A test asserts the
  wizard's props contain neither it, the stop reason, nor a key of that name. **Do not weaken it.**
- **Patient-visible copy is frozen.** The message preview reads the sealed domain's `message-copy`.
  A screen that hardcodes a patient-visible string is a defect even when the string is correct.
- **Never render a raw role identifier to a clinician.** Role wording lives in the sealed domain and
  is resolved server-side. The interface-vocabulary scan currently _rewards_ leaving identifiers on
  screen — it refuses "lead" as a whole word but passes `clinicalProgrammeLead` on a missing word
  boundary. That inversion is filed; **do not exploit it.**
- Every `<button>` does something. Never native `disabled` **and** `aria-disabled` on one control; a
  submit awaiting validity is transient inertness, which is what native `disabled` is for.
- Tap targets `min-h-12` (48px) — **never `min-h-11`**. Put `min-h-tap` on the element that contains
  the control, not on a wrapping `<div>`; that was a real finding in Task 7 and it left a row's
  whitespace dead on a phone.
- Design tokens only, no hardcoded hex. Internal navigation via `<Link>` / `router.push`; hrefs from
  `src/lib/caring-contacts-routes.ts`, never a path literal.
- **The closed transport vocabulary is frozen.** Prohibited in any interface string: high risk, safe,
  engagement score, campaign, lead, conversion, best match, inbox, conversation, clinical risk, risk
  score, wellbeing score, any claim that replies are monitored. `Delivered` is a transport receipt,
  never a patient-state label. The scan checks **bare identifiers too**.
- **Do not restate a count in prose** (Ruling [94]). State the invariant.
- **This is Next.js 16.** Read `node_modules/next/dist/docs/` before writing boundary or navigation code.

## Verification

- **Test-first.** Task 7 skipped it, disclosed it honestly, and it cost exactly one real bug — an
  unreachable fallback branch nobody had written an assertion about, which no mutation could reach
  because **mutation testing can only falsify tests that exist.** Do not repeat that here, on the
  stage that writes.
- **Commit each piece before you mutate the file it lives in.** `git checkout --` reverting a mutation
  also discards any uncommitted fix in that file; that cost a previous implementer its work mid-round.
- Deliberately break each piece and confirm the covering test goes red. **Check FIRST that the
  mutation changes a value some assertion reads**, and **prove the mutation is in the tree before
  believing any result**. Use `;` between the presence check and the gate, never `&&` — `grep -c`
  exits non-zero on a zero count and short-circuits.
- **Predict what each mutation's failure message will say**, then compare. An unexpected number in an
  assertion error is a second defect.
- **A test that installs a double must assert the double was used.** A previous test in this wizard
  passed inert because jsdom's storage is a Proxy answering from the prototype, so the mock was never
  called.
- **Itemise every attempt**, including greens and unmatched anchors, with **no aggregate total**.
- Gates: `npm run test:cc-guards` (~133 s) during iteration and every fix round; the **full
  `npm run test` once** at the end (~800 s). Paste the `N passed` line for both. Then `npm run
typecheck` and `npm run lint`.
- **Never report a gate as passing from an exit code.** A refusal through a pipe leaves `$?` reading
  **0** for a gate that never ran; no summary line means no run.
- **A lock refusal is neither a pass nor a failure.** One exclusive heavy job runs at a time across
  every worktree, and other projects are active on this machine. Retry; **never force past another
  worktree's lease.** Prove ownership from the lease record's `worktree` field, not a live PID — and
  evidence adequate for _waiting_ is not adequate for _breaking_ a lease.
- Tell me whether you think this touches `tests/ui-caring-contacts-workspace.spec.ts`. I run that gate.

## Report

**Commit early — before waiting on any gate.**
Write your full report to `docs/caring-contacts/phase-2b-sdd-archive/task-9-report.md`, then return
ONLY: status, commit SHAs, a one-line test summary, and your concerns. Do not paste the report into
your reply. Do not dispatch subagents. **Do not push and do not open a pull request.**
