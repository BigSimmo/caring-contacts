# Task 11b, fix round 1 — scoped re-review

**Reviewed:** `f2d23c425`, `a43bc7728`, `8b98e2a17`, `487cb2ed7`, `9cb661a29`, `230d1b411`, `b8313a791`,
against the review they answer at `72c4477b3`. Every one of those SHAs was checked with
`git cat-file -e <sha>^{commit}` and exists. `git log --oneline 72c4477b3..b8313a791` returns exactly those
seven and nothing else, so the round's commit set is the brief's set — confirmed against the tree rather
than taken from the brief.

`git diff --stat 72c4477b3..b8313a791` touches five files: the round-1 report, the patient-overview page,
`plan-action-rules.ts`, `plan-actions.tsx`, and `tests/caring-contacts-patient-overview.dom.test.tsx`.

**Worktree:** `D:\Worktrees\Database\cc-plan-detail`, branch `claude/caring-contacts-plan-detail`. Nothing
pushed, no pull request, no subagents. The untracked `1/` directory was left exactly as it was and is not
staged.

---

## The two verdicts

### CRITICAL-1 — **CLOSED**

The bare `if (held === null) return;` is gone. I did not read the invariant, I enumerated the exits and
established what a coordinator sees at each; the enumeration and the throw's landing place are below. The
reassignment path now sends a write and announces it, and there is a case that drives exactly the state the
defect needed — `plan === null`, produced by a real lifecycle write whose answer comes back `200 {}` —
through both stages of the two-stage confirmation, then asserts a second request left the screen, the
outcome region says the plan moved, and the store's assignment actually changed hands.

### MAJOR-1 — **CLOSED**

A key now names a submission rather than an action. I checked the half the report did not have to argue:
that the client's notion of "the same submission" is a faithful proxy for the server's. It is — `runWrite`
fingerprints `{ method, input }`, and for both routes `input` is derived from the path plan id plus the
client body and from nothing else (`assignments/[planId]/route.ts` builds `{ planId, action }` from the
body; the lifecycle route's `input` is the plan id, the version and, for a withdrawal, the origin). The
actor is not in the fingerprint, so a role change between two identical submissions cannot turn a retry into
a key reuse. Both directions of the property have their own case and their own mutation.

### Spec compliance and task quality for the round — **PASS, with four MINOR findings and five NITs**

None of the findings is a shipped defect a coordinator reaches by an ordinary route. The one behavioural
residual (MINOR-A) is a race I reasoned about and did **not** reproduce, and I say so where it is stated.

---

## CRITICAL-1, checked rather than read

### Every exit from `carryOut`, and what a coordinator sees

`src/components/caring-contacts/workspace/plan-actions.tsx:233` onward. I enumerated every `return`, every
`throw`, the fall-through, and every throw a call inside the function could raise.

| Exit                                                    | What a coordinator sees                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------- |
| `refusedNow !== null` → `refuse(); return`              | the named condition refusal, plus a re-read of the screen                 |
| `acting === null` → `refuse(ACTING_ACCOUNT_UNREADABLE)` | that refusal by name                                                      |
| `refusedByAccount !== null` → `refuse(); return`        | the named condition refusal                                               |
| `planLifecycleExpectedVersion` throws                   | a whole-screen error — loud, and unreachable (below)                      |
| `!sent.ok` → `refuse(); return`, inside the `try`       | the service's refusal in plain words; `finally` clears the in-flight flag |
| falls off the end                                       | the recorded outcome, announced                                           |

**The calls that could have thrown and do not.** `post` (`:610`) and `readActingAccount` (`:643`) are total —
every `fetch` failure and every unreadable body is caught and returned as a named refusal.
`planActionRefusalWording` (`plan-action-rules.ts:758`) has a named fallback for a refusal string it has not
been taught. `planActionRefusalNameFrom` and `planFromWriteAnswer` return named stand-ins and `null` rather
than throwing. `reassignmentRequestBody` and `planLifecycleRequestBody` are plain object constructors with no
validation, so `bodyWith("")` — called before the key exists, purely to fingerprint — cannot throw on the
blank key. So the six exits above are the whole set.

### The throw is unreachable, and it does reach an error boundary

**Unreachable.** All three lifecycle rows declare `this-screen-still-knows-the-plan` as their FIRST
condition (`plan-action-rules.ts:300`), `conditionIsMet` answers it from `now.planIsKnown`, and `stateFor`
derives that from `live.current.plan` — the same ref `planLifecycleExpectedVersion` reads. For `pause` and
`resume` there is no `await` between the recheck and the read. For `withdrawal` there is one, and the
post-account recheck re-evaluates every condition including that one, after which the path to `bodyWith` is
synchronous; `live.current` is only written in an effect, which cannot interleave with synchronous code. So
the guard and the read cannot disagree. R2's green is correct for the reason it gives.

**It reaches `error.tsx`, and I checked the boundary rather than trusting the comment.** The host stores a
rejected commit and re-raises it during its own render (`workspace-overlays.tsx:232` and `:288`).
`WorkspaceOverlays` is rendered by `CaringContactsShell`, and the shell is rendered by the PAGE —
`src/app/caring-contacts/patients/[patientId]/page.tsx:34` imports it dynamically — not by
`src/app/caring-contacts/layout.tsx`, which returns `children` untouched. That distinction is the one that
would have made the claim false: a segment's `error.tsx` does not catch a throw from its own `layout.tsx`.
The host is in the page subtree, so `src/app/caring-contacts/error.tsx` sits above it and catches it. The
claim holds.

### The case

`moves a plan whose last answer could not be read, rather than closing and saying nothing`
(`tests/caring-contacts-patient-overview.dom.test.tsx:2138`). The `garble` transport returns `200 {}` AFTER
the real handler has run against the real store, which is the only state that produces `plan === null`; the
case waits for the card to say so in words before it moves anything. Session reads return before
`sent.push`, so `garble(…, index === 0)` is unambiguously the pause write. The assertions are the write, the
announcement and the store — not one of them is a proxy.

---

## MAJOR-1, checked in both directions

- **A retry of the same submission still shares a key.** The pre-existing replay case is unchanged and still
  passes, and R4 mutates it to red on two assertions: the duplicated `reassignmentHistory` row, and the key
  equality.
- **A changed submission does not.** The new case drives a real `stale-version` refusal from the real store,
  re-reads the screen, and confirms the corrected version; R3 reddens it with the service's own
  `idempotency-key-reused-for-a-different-write` wording.
- **Can either pass while the other's property is broken?** R3's gate line is `1 failed / 74 passed`, so the
  key mutation reddens the corrected-submission case ALONE — it is not standing on the props sync. R7
  (remove the sync) reddens two cases, the corrected-submission case among them, and the report says so and
  says why. The dependency therefore runs one way only and is disclosed. That is adequate.
- **The double-press race is not weakened.** Two commits racing before the effect writes
  `live.current.changeOnItsWay` compute the SAME fingerprint, so they reuse one key and the second is a true
  replay — exactly as before the round.

---

## The wrong prediction, R15, checked literally

**The story holds.** `git show 8b98e2a17` is one commit adding one case,
`mounts the region that announces an outcome before there is an outcome to announce`, and its own message
states the discrepancy. It sits AFTER the assertions commit `a43bc7728` in the round's order, which is what
"planned and never written" predicts: the fix for MINOR-5 (the unconditional mount) is in `f2d23c425`, the
assertions commit did not carry a case for it, and the mutation had nothing to reach.

**Does the case exist, does it assert what R15 mutates, and would it redden?** Yes to all three. Reverting
the mount to `outcome === null ? null : <div…>` removes the node, so
`screen.getByTestId("caring-contacts-plan-action-outcome")` throws — and the observed message the report
records is `Unable to find an element by: [data-testid="caring-contacts-plan-action-outcome"]`, which is
that throw and not something else.

**The corroborating detail I did not expect and found.** The same commit's sibling change is real work
rather than tidying: a settle in another case that read `expect(outcomeRegion()).toBeInTheDocument()` became
`not.toBeEmptyDOMElement()`. Once the region is always mounted, the old settle resolves instantly and would
have raced the assertion behind it. That is the inert-assertion failure the discipline names, caught in the
act of creating it. I grepped every `outcomeRegion()` use in the file for the same shape and found no other.

The one thing the row does not carry is NIT-4 below.

---

## Findings

### MINOR-A — the self-handover refusal reads a prop that has not arrived yet, and the window straight after a successful move is neither closed nor tested

`plan-action-rules.ts:368` now checks `now.chosenDestination !== now.planCarriedBy`, and `planCarriedBy`
comes from `context.carriedBy.actorId` — a PROP, refreshed only when the server render lands. The
destination is client state and is not cleared after a successful move, and neither is the handover note.

So in the window between a successful move and the arrival of that move's `router.refresh()`:
`planCarriedBy` still names the OLD holder while `chosenDestination` names the new one, the condition is
met, every other condition is met, and the trigger is live. A second confirmation sends a move whose
`toActorId` is the account that now holds the plan. `applyAssignmentAction` (`src/lib/caring-contacts/assignment.ts`,
the `reassign` branch) does not refuse `from === to` — I read it — so it appends a
`{ fromActorId: X, toActorId: X }` handover row, permanent and afterwards indistinguishable from a real one.
The idempotency key does not stop it, because the key is deleted on success and a fresh one is minted.

Once the refresh lands the fix works exactly as claimed, and the new case proves that half: the stale choice
then equals the holder and the decision control is `aria-disabled` with the named reason. That is the half
the original MINOR-1 was written about, and it is genuinely closed.

**Stated at the scope I checked it at: this is reasoned from the code, NOT reproduced.** Both new MINOR-1
cases call `rereadTheScreen` before the second attempt, and in jsdom `router.refresh()` is a mock that
delivers no props, so the suite cannot reach this window as written. In a browser the window is one RSC
round trip against a coordinator opening a confirmation and pressing twice, so it is narrow. I record it
because it is the same shape as the finding it answers — a condition whose predicate is now correct and
whose input is not yet the fact it names — and because a phantom handover on a suicide-prevention plan is
not a cosmetic record. Clearing the destination and the note on a recorded reassignment would close it at
the source, without depending on the refresh at all.

### MINOR-B — one of MAJOR-3's two new negatives has no positive control and no mutation

`tests/caring-contacts-patient-overview.dom.test.tsx:1643`. The first negative is properly built: the hold's
`keeps its whole schedule` is asserted PRESENT in the hold block (`:1662`) before it is asserted absent from
the withdrawal block, and R10 proves the scope fires. **That one I checked, and the pin would fail if the
reassuring hold wording were written into the irreversible action's block** — the block is located by its own
`<h3>` through `planActionBlock`, and `ActionBlock` renders that heading as the direct child of the block
`<div>`, so the negative reads the withdrawal block and nothing else.

The second negative, `not.toHaveTextContent(/can be let run again/i)` at `:1667`, has neither. The phrase is
real — the hold block says "the plan can be let run again from this screen" (`plan-actions.tsx:412`) — but
nothing asserts it is there, and no ledger row mutates it. If the hold block's wording were reworded, this
negative would go on passing forever about a phrase that exists nowhere on the card, which is the decoration
the discipline's positive-control rule is about. It is one line to fix, and it sits inside the very fix
written to answer that rule.

### MINOR-C — the submission fingerprint keeps the handover note in plaintext, and nothing says so

`planActionSubmissionFingerprint` is `JSON.stringify({ ...body, idempotencyKey: "" })`
(`plan-action-rules.ts:578`). For a reassignment that string contains `action.reason` verbatim — the
free-text handover note — and it is written into `keys.current[action].fingerprint`
(`plan-actions.tsx:296-302`), where it stays until the next submission of that action or until that action
succeeds. A coordinator who is refused and then clears the textarea leaves a plaintext copy of the note in
that ref.

**This is not a leak, and I checked the ways it could have been one.** The value is never sent — both
request bodies are built by the two builders, not from the fingerprint — never rendered, never persisted,
and never crosses a boundary. It lives in one tab's memory alongside the `handoverNote` state that already
holds the same text.

I raise it because `src/lib/caring-contacts/fingerprint.ts` hashes ITS fingerprint specifically because "the
requests it is computed over carry patient data", says so at length, and is the precedent a later reader will
reach for on meeting a second function with "fingerprint" in its name. This one is unhashed, and is
`JSON.stringify` rather than the canonicalising sort, so it is key-order dependent. Both are fine where it
is; neither is fine if it ever moves server-side or is persisted. The module note explains why the whole body
is read and says nothing about what that means it holds.

### MINOR-D — the key's stated safety guarantee is now carried by the state guards, not by the key, in the common case

The ref's note (`plan-actions.tsx:171`) says the retry chain "shares a key and the service answers a second
press with the first press's own answer instead of withdrawing a patient twice". That is true of a chain
whose body has not changed. This round's own MINOR-2 fix makes the body change: `refuse()` now calls
`router.refresh()` on EVERY refusal, and the props sync then adopts a newer version — so after a
lost-transport refusal on a write that actually landed, the coordinator's retry carries a different
`expectedVersion`, fingerprints differently, and mints a NEW key.

**The behaviour is still safe, and I traced all four rows rather than assuming.** A second pause is refused
by `the-plan-is-running`, a second resume by `the-plan-is-held`, a second withdrawal by
`the-plan-has-started-and-has-not-ended`, and a second move by `a-different-coordinator-is-chosen` — because
the same refresh that changed the version also changed the state or the holder. Nothing double-writes.

What is worth recording is that the protection has moved. A later reader who trusted the ref's note could
relax one of those state conditions believing the key still stands behind it, and no case covers the
post-refresh double-press for any of the four. Both halves — the note and the missing case — are cheap.

---

## NITs

**NIT-1 — the forced-colours comment claims more than the loop does.** The loop iterates
`card.querySelectorAll("button")` plus `select, textarea` (`:2375`), and the comment beside it names
`controlBase`, `fieldClass` and `blockClass` as the three whose loss it would catch. `blockClass` is on
`<div>`s, which the loop never reaches, so `blockClass` losing `forced-colors:border-[CanvasText]` still
reddens nothing. Two of three is a strictly better assertion than the one control it replaces; the sentence
should say which two.

**NIT-2 — `planActionLabel` now has no consumer outside its own module.** `grep` across `src` and `tests`
returns no reference to it outside `plan-action-rules.ts` itself. NIT-1 of the previous review removed its
only production caller, and it survives as the throw-guard `planActionCardName` calls one line above the map
lookup. That is a real and deliberate job, and it is not what the function's own note describes. It is not
dead code and not a `check:dead-code-candidate` case; a clause saying "read for its throw" would stop the
next reader concluding otherwise.

**NIT-3 — a number in the ledger's preamble contradicts a number in its table.** "Every row in the table
below ran against `487cb2ed7`" sits directly above R15's gate cell `74 passed (74)`, which that tree cannot
produce — it has 75 cases, because `8b98e2a17` is its ancestor. The prose two sections down explains the
sequence correctly and honestly; the preamble sentence needs the exception in it.

**NIT-4 — the R15 case carries three assertions and one mutation.** `role="status"` and
`toBeEmptyDOMElement()` are unproven: the mutation removes the node, so `getByTestId` throws before either
is reached. Both are plausible and neither is decoration, but per the discipline they are unproven rather
than covered.

**NIT-5 — `writes()`'s session filter is now dead.** `routeFetch` returns early for
`/api/caring-contacts/session` before `sent.push`, so `sent` never contains a session read and
`sent.filter((entry) => !entry.url.includes("/session"))` filters nothing. Harmless, and it reads as though
session reads were being excluded from write counts when they were never in them.

---

## Whether any fix is incomplete in the same way as the thing it fixed

This is the question the brief put hardest, so it gets a verdict per fix.

- **CRITICAL-1** — no. The fix does not patch the null case, it moves the version read into the only branch
  that has one, so the reassignment branch has no null question to answer. The
  `"pause" | "resume" | "withdrawal"` parameter type makes the reassignment path unable to call it at all.
  That is the structural form rather than the conditional form.
- **MAJOR-1** — no. The fingerprint reads the whole body rather than a list of fields, so a field added to
  either request shape joins the submission's identity without this function being touched. I checked that
  the trim in `reassignmentRequestBody` runs BEFORE the fingerprint, so a note differing only in surrounding
  whitespace is correctly the same submission on both sides.
- **MINOR-1** — partially: see MINOR-A. The predicate now performs the check its name makes; the input it
  performs it on is not always current.
- **MINOR-2** — no, and `487cb2ed7` did not reintroduce it (below).
- **MINOR-3** — no. The new case makes the claim in the direction the title used to promise, with the
  collision heading pinned positively first and three permission phrases negated. I checked all three against
  the source: `may not carry out this action`, `not granted to the role`, and `acting in a role that is
granted it` are the real headings and shared `changedBy` of `permission-denied` and `action-not-granted`
  (`plan-action-rules.ts:650-659`), so none of the three is a phrase the test invented.
- **MINOR-4** — no. The retitle matches what the case does, both voided locals are gone, and so is a third
  in the replay case that nobody had asked about.
- **MINOR-5** — no, and the audited-read assertion is load-bearing rather than merely reachable. I checked
  that the page's other audited reads carry different access identities (`search`/`plan`/`all`,
  `view`/`episode`, `administrative`/`serviceState`, and the patient-names read), so `{ view, plan, <planId> }`
  is produced by the assignment read and by nothing else on that page. Replacing it with a bare
  `store.getAssignment` leaves nothing that matches, which is what R12's observed message shows.
- **MAJOR-3** — partially: see MINOR-B. One of the two negatives is proven, the other is not.

---

## `487cb2ed7` — the props sync moved out of an effect

**It did not alter behaviour and it did not reintroduce MINOR-2.** The effect ran on
`[context.planState, context.planVersion]`; the render-time guard fires when those same two values differ
from `asTheServerLastSaidIt`, which is the same trigger. The monotone updater is byte-identical between the
two versions. The effect also ran on mount, where its updater was a no-op because `plan`'s initialiser had
just set the same version. There is no infinite-render path: the updater returns `current` by reference when
props are behind, which React bails out of, and the guard is false on the render that follows.

The one behavioural difference is a strict improvement, and it is worth naming rather than calling the change
neutral. With the effect, the first render after a prop change computed `refusalAtOpen` and `commitFor` from
the STALE plan, and a trigger activated in that instant would have staged a commit built on it. Adjusting
during render removes that render entirely. This is a case where the lint rule was pointing at something real
rather than at a style preference.

I did not run lint. The report's uncached-lint line is therefore unverified by me.

---

## Privacy

**Nothing in this round widened what travels, and nothing about a patient reaches a query string.** Checked
rather than assumed:

- **The one new value crossing the boundary is `carriedBy.actorId`**
  (`src/app/caring-contacts/patients/[patientId]/page.tsx:339`), replacing a boolean. It is a demo ROLE
  identifier (`demo-coordinator`), not patient data, and identifiers of exactly that shape already crossed in
  `destinations[].actorId`. It is compared and never rendered, and the case at `:2331` asserts the card's
  rendered text matches neither `/demo-/` nor `/teamLead/` — the load-bearing guard for the new field, with
  the option's `value` attribute asserted to BE the identifier four lines above as its positive control.
- **MAJOR-4 was not widened.** No prompt, no schema, no retention path and no store was touched. The only
  new place the handover note is copied is the client-side fingerprint ref, which never leaves the tab —
  MINOR-C, raised as an incidental store and explicitly not as a re-raising of MAJOR-4.
- **URLs are unchanged.** Both endpoints still put the synthetic plan id in the path under
  `encodeURIComponent`, and the fingerprint is never a request field. The existing URL case still passes.
- **Worth the controller knowing, and not a finding:** `refuse()` now calls `router.refresh()` on every
  refusal, so every refused action re-renders the page on the server and performs its audited reads again.
  That is more rows on the access trail, not more data, and a recorded read is what this system's bargain
  asks for.

---

## What I ran

Every line below is pasted from the run. None is reported from an exit code.

**The suite this round changed**, on `b8313a791`, tree clean, `GATE_RECEIPTS=refresh` — this independently
reproduces the report's baseline, so its rows are attributable:

```
 Test Files  1 passed (1)
      Tests  75 passed (75)
```

**`npm run test:cc-guards`**, on the same tree, `GATE_RECEIPTS=refresh` — reproducing the report's headline
exactly, which is what would catch collateral damage the narrowed rows cannot see:

```
 Test Files  18 passed (18)
      Tests  465 passed (465)
```

**Four suites the gate does not name that cover what this round touched** — the page's access-audit
contract, the assignment domain MINOR-1 reasons about, the overlay host the throw travels through, and the
API handler MAJOR-1's fix depends on:

```
 Test Files  4 passed (4)
      Tests  71 passed (71)
```

**The gate-drift diff, computed rather than trusted.** I read the eighteen paths out of `package.json` and
listed every `tests/caring-contacts-*` suite that exists. The gate names sixteen Caring Contacts suites plus
`route-reachability` and `design-system-adoption`; the set it does not name is exactly the set the report
lists, name for name — `access-audit`, `api-handler`, `assignment`, `audit`, `clock`, `contact-rescheduling`,
`empty-state.dom`, `fingerprint`, `hospital-events`, `message-copy`, `message-policy`, `migrations`, `model`,
`notification-preferences`, `overlay-host.dom`, `overlay-trigger.dom`, `page-access-audit`,
`pathway-versions`, `permissions`, `postgres-repository`, `referrals`, `repository`, `server-config`,
`server-pool`, `server-store`, `service-state`, `session`, `simulation`, `training`, `width-state`,
`write-serialisation`. The report's MAJOR-2 work is accurate.

**One report claim I checked because it is a correction of an earlier one.** The report says
`source-control-bytes` reads this archive directory, correcting the previous round. It does:
`tests/source-control-bytes.test.ts:203` asserts the scanned set contains
`docs/caring-contacts/phase-2b-sdd-archive/task-8-report.md`.

**Lock refusals.** None this session. Every run above completed on its first attempt. No lease was forced
and no lock state was touched.

**Not run, and why.** `npm run test`, `npm run build`, `npm run verify:ui`, Playwright, typecheck, lint and
`prettier --check` — out of scope by instruction; the controller's at the merge point. I have therefore NOT
independently verified the report's typecheck, uncached-lint or Prettier lines. `check:docs-links` is
already red on this branch for pre-existing references in other documents and is the controller's at the
merge; I did not run it and I raise no finding about it.

**What I could not check.** The report's "watched fail first" claims are claims about ORDER, and a green
tree afterwards cannot confirm them. What I can confirm is the weaker and still useful thing: every
assertion those claims are about has a ledger row that made it red, so none of them is an assertion that
cannot fail. The mutation text itself is still not recorded per row — the previous review asked for it, and
this round describes the mutation in prose for most rows and as a `find`/`replace` for none. That is better
than the round before and short of the ask.

---

## What I would hold the merge for

Nothing. CRITICAL-1 and MAJOR-1 are closed and proven, and no finding here is a shipped defect a coordinator
reaches by an ordinary route.

MINOR-A is the one I would want a decision on rather than a silent carry: it is the only finding with a
clinical-record consequence, it is one line to close at the source — clear the destination and the note on a
recorded reassignment — rather than by depending on a refresh, and it belongs to the controller because I
could not reproduce it. MINOR-B, MINOR-C, MINOR-D and the five NITs are each one line or one sentence, and
none of them needs a further review pass on its own.
