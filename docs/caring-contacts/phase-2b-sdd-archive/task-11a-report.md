# Task 11a report — Group 1's wizard, inspection and outcome overlays

**Worktree:** `D:\Worktrees\Database\cc-plan-detail` · **Branch:** `claude/caring-contacts-plan-detail`
**Not pushed. No pull request. No subagents dispatched.** `pause`, `withdrawal` and `reassignment` untouched.

---

## READ THIS FIRST — the brief and the tree disagree about `pathway-preview`

**The brief lists `pathway-preview` as one of the three NON-mutating rows and tells me to wire it with
Task 10's `ExitOnlyOverlayTrigger`. The frozen contract says the opposite, in both of its copies.**

| Source                                                                     | `pathway-preview`        |
| -------------------------------------------------------------------------- | ------------------------ |
| `docs/caring-contacts/interaction-matrix.md`, the frozen table             | Mutation: **Yes**        |
| `overlays/definitions.ts` line 104, checked row for row against the matrix | `mutatesState: **true**` |
| The same row's `decision`                                                  | **"Use this pathway"**   |

`exitOnlyOverlayCommit` **throws** for any row marked `mutatesState: true`. So the instruction as
written does not merely mis-classify the row — it produces a **render-time throw** on stage 2 of the
activation wizard, reaching `error.tsx`, for every coordinator who opens the pathway chooser.

**What I did, and why I did not stop and ask.** The brief itself names the matrix as "the frozen
contract", and the standing discipline says the types win where a specification and the tree
disagree. The row is not mis-classified in the tree: its decision **selects a pathway version**, so a
preview with a confirm control is exactly what it is. I therefore wired it as the frozen contract
says — a real `{ kind: "record" }` commit that chooses that version — and left the other two
non-mutating rows (`message-preview`, `activation-success`) on `ExitOnlyOverlayTrigger` as directed.
That is the conservative direction: treating a mutating row as an exit is the Ruling [87] defect,
whereas giving a genuinely mutating row a real commit is what Ruling [87] asks for.

**It is still your call to confirm.** If the owner's intent is that stage 2 offers an inspection-only
preview and the choice stays with the radio buttons, then the **matrix row** needs changing, not this
screen — and that is a change to a frozen contract Tasks 18 and 19 build against.

---

## The three the brief pre-decided, and how each landed

1. **`ExitOnlyOverlayTrigger` for the non-mutating rows** — done for `message-preview` and
   `activation-success`. Not `pathway-preview`, for the reason above.
2. **The overlay id union was NOT narrowed.** `definitions.ts` is untouched by this task. Nothing
   here conflicts with Task 14.
3. **`message-preview` reads the wording and renders what it gets.** No greeting is assembled, no
   name is interpolated, and the string is never split. See "What the preview can and cannot promise".

---

## What was built, and where

| File                                                                     | Change                                                                                                                                                                            |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/caring-contacts/workspace/plan-wizard/overlay-guards.ts` | **New, pure.** The commit-time predicate: the two conditions, their plain-words refusals, and which row depends on which.                                                         |
| `src/components/caring-contacts/workspace/plan-wizard/plan-wizard.tsx`   | Seven rows wired; the two-moment guard; the in-place refusal statement; the message specimen panel; `Discard draft` moved behind its confirmation; `Leave this for now` added.    |
| `src/components/caring-contacts/workspace/plan-wizard/plan-draft.ts`     | `PlanDraftDecisions` — the two confirmations `verify-identity` and `communication-preference` record, held in the tab and written onto no plan — plus its tolerant parser branch. |
| `src/components/caring-contacts/workspace/patient-overview.tsx`          | `activation-success`, offered beside the confirmations card while the plan is running.                                                                                            |
| `src/app/caring-contacts/plans/new/page.tsx`                             | Resolves `EXACT_PATIENT_VISIBLE_MESSAGE` on the server and hands it to the wizard as a plain string.                                                                              |
| `tests/caring-contacts-plan-wizard.dom.test.tsx`                         | The new decision-overlay block, plus the discard case moved onto the confirmation.                                                                                                |
| `tests/caring-contacts-patient-overview.dom.test.tsx`                    | The `activation-success` block, plus two counts narrowed from "every trigger" to "this row's triggers".                                                                           |
| `tests/caring-contacts-new-plan-page.dom.test.tsx`                       | The page passes the sealed domain's own wording, not a copy of it.                                                                                                                |

### Where each of the eight is reached from

| Row                        | Where                                    | Commit                                                     |
| -------------------------- | ---------------------------------------- | ---------------------------------------------------------- |
| `verify-identity`          | Stage 1, beside the referral facts       | Records `decisions.identityChecked`                        |
| `change-patient`           | Stage 1, beside it                       | Removes the draft, **then** navigates to this team's plans |
| `pathway-preview`          | Stage 2, one per approved version row    | Chooses that version                                       |
| `message-preview`          | Stage 3, beside the wording panel        | Exit — the host's own close                                |
| `communication-preference` | Stage 3, under the sending-time fieldset | Records `decisions.preferenceGivenOnStaffedLine`           |
| `save-draft`               | The draft notice, on every stage         | Leaves the screen with the sign-up still on this computer  |
| `discard-changes`          | The draft notice, on every stage         | Removes the draft                                          |
| `activation-success`       | Patient overview, on a **running** plan  | Exit — the host's own close                                |

---

## The commit-time recheck, and the two moments it is asked at

`openWorkspaceOverlayWithCommit` stages the commit **when the trigger is activated**. A commit
closure that captured that render's `draft` would write it back over whatever the tab holds when the
decision is finally confirmed — and the worst instance of that is not stale data, it is a draft
holding a patient's name and mobile number being **recreated in this tab's storage after something
deliberately removed it**.

`overlay-guards.ts` is a pure predicate over **two** states — what was true when the surface was
raised, and what is true as it is confirmed — and the wizard asks it twice:

- **at render**, with the same value twice (the honest answer: nothing has changed yet). A condition
  already unmet makes the commit `{ kind: "unavailable", reason }`, which `commitRefusalFor` scopes
  `every-row`, so the **host** renders the named reason and keeps its decision control focusable with
  `aria-disabled`. That is the frozen matrix's guard-rejection shape, implemented by the host rather
  than re-derived on a screen.
- **inside the commit**, against the render-time values and values read at that instant. A refusal
  there calls nothing, so nothing is mutated.

### The structural limit: the host closes unconditionally

`WorkspaceOverlays.recordDecision` calls the commit and then calls `closeWorkspaceOverlay()`
**unconditionally**. So an overlay **cannot** stay open to report a refusal its own commit
discovered. The matrix's "retain the surface" clause is therefore served by the **open-time** branch
only; a commit-time refusal is stated in place on the screen, in the three-part `StatedReason` shape
this workspace uses everywhere, naming the decision from the frozen table and saying that nothing was
changed. That follows Task 9's own precedent for `final-activation` (`state.status === "refused"`
renders on the screen, not in the overlay). **Reported rather than worked around** — closing it
properly means a change to the shared host, which is a coordinator's decision.

### Three of the matrix's four rechecks have no honest application here, and I did not fake them

The matrix says mutating actions recheck **connectivity, permission, authentication and version
state**. Writing a check that cannot fail would be worse than not having one — the brief's own rule.

- **Connectivity.** Every decision in this task writes to this tab's storage or navigates inside this
  application. **None touches the network.** Refusing one for want of a connection would be a false
  statement to a clinician. The one wizard decision that _is_ network-bound is `final-activation`,
  which is Task 9's, and `post()` already turns a failed `fetch` into
  `TRANSPORT_REFUSALS.didNotReach` while keeping the draft.
- **Authentication.** `requiresFreshAuthentication` is `true` on exactly **two** rows of the frozen
  table — `withdrawal` and `reassignment` — and both are Task 11b's. Where it is true, `OverlayHost`
  owns the checkpoint and commits only on the second activation.
- **Permission.** `plans/new/page.tsx` asks `canPerformCaringContactAction(actor, "claimPlan", …)`
  **before it renders the wizard at all** and returns `PlanStartStateNotice` instead when the answer
  is no. Inside the component the answer is a constant, and there is no client-observable way for it
  to change while an overlay sits open. A recheck there is a check that cannot fail.

**"Version state" is the one that does apply, and it is what `sign-up-still-here` is.** The version
of the record these decisions write to is the draft itself, and it genuinely changes underneath an
open overlay: `clearPlanDraft()` runs from `discard-changes`, from `change-patient`, from a
successful activation, and from `readPlanDraft` when the stored draft belongs to another referral.

### Why the condition is a comparison and not "a draft exists"

My first version declared `a-draft-exists` and it was **wrong in a way the tests would not have
caught**: on a screen nobody has typed into yet there is **no stored draft at all**, so every
mutating row would have opened `aria-disabled` on a perfectly ordinary first render. The condition
had to be narrower — _it was there when the surface was raised and has since gone_ — which is also
the only shape that can catch a confirmation pressed long after opening. I caught this by asking what
`stored` is on the first render, before running anything.

---

## What the preview can and cannot promise — a real gap, reported not filled

`EXACT_PATIENT_VISIBLE_MESSAGE` **carries a name of its own and has no slot for the one the clinician
typed at stage 3**. The brief said the owner has decided it gains a first-name slot and that Task P
is doing that on the trunk. It has not landed on this branch.

So the screen does the only honest thing available to it: it renders the governed wording **exactly
as it arrives** and says, in place, that it is a **specimen** carrying its own example name rather
than this patient's. **Nothing here assembles a greeting, interpolates a name, splits the string, or
writes a word of patient-visible copy.** When the slot lands, this call site will fail to compile
rather than silently keep rendering the old shape — which is the outcome I wanted from it.

**FINDING — THREE ROWS' FROZEN COPY DESCRIBES A CAPABILITY THAT DOES NOT EXIST, and the pattern is
the finding rather than the three instances.** Each was found separately and they are the same shape:
the approved drawer copy was written for a product where the surface could carry per-row content and
the system had records it does not have. None of them can be fixed by a screen, because the copy is
frozen and `OverlayHost` renders it verbatim and takes no children.

| Row               | What the frozen copy says                                                                    | What is actually true                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `message-preview` | "The wording is shown exactly as it would arrive, with every detail already filled in."      | The drawer holds no wording at all, and the specimen has no slot for the name typed at stage 3.                                          |
| `verify-identity` | "Compare the person selected here with the invented source record before going any further." | There is **no source record in this system to compare against**. The comparison is one a person makes elsewhere, and the screen says so. |
| `save-draft`      | "Save this activation draft" / "Save draft" / "The draft is kept as it stands."              | Nothing is written — every keystroke already was — and confirming **navigates**, which no part of that copy mentions.                    |

`save-draft` is the one this round acted on, under your ruling: the navigation stays and the SCREEN
announces the destination, because the matrix's Navigation clause is a contract the screen owes and
announcing is additive where amending approved copy is not. The other two are left as findings.

**FINDING — the frozen `message-preview` summary promises more than the shared host can carry.**
Its summary reads "The wording is shown exactly as it would arrive, with every detail already filled
in." `OverlayHost` renders each row's frozen `summary` and **takes no children**, so the drawer
itself contains no wording at all — the same limit Task 10 recorded for `delivery-detail`. I put the
wording on the screen beside the trigger (Task 10's precedent: the per-row fact stays on the row) and
made the control's visible words promise only what the drawer holds. But the frozen sentence is still
a claim about a surface that cannot satisfy it, and that is the owner's to resolve: either the host
gains a content slot, or that row's summary changes.

**Second half of the same finding: the specimen cannot be this patient's message even after Task P.**
The wizard is a Client Component; the wording arrives as a **plain string prop the server resolved**,
which is what keeps `message-copy.ts` and its GSM-7 machinery out of this route's client chunk (the
established pattern for `sendingPreferenceOptions` and `fictionalPatientMobileNumbers`). If the slot
arrives as a **function**, the prop's type has to change and the page becomes the place that fills
the name in — which is also where the name would have to be, since a Server Component cannot pass a
function across the boundary. Worth deciding deliberately rather than discovering at merge.

---

## `save-draft` and `discard-changes` — the storage distinction

**`discard-changes` now sits in front of the control that used to discard on one click.** That
control removed a patient's name and mobile number, and everything else typed, with nothing in
between. Its frozen summary — "Only the edits made in this session go" — is the sentence a
coordinator most needs before pressing it.

**Which of the two it discards is said, not left to be inferred.** Beside the control:
_"Discarding removes this sign-up from this computer. It changes no plan and no record: nothing has
been written onto a plan yet, because the plan is created at the last stage."_ That is the true
statement in this wizard specifically — the plan does not exist until stage 4 — so there is no
ambiguity to leave.

**`save-draft` records nothing new, and confirming it does not pretend to.** Every keystroke already
goes through `writePlanDraft`, so writing again on confirm would be a gesture rather than an action —
and a commit whose whole body is a redundant write is the silent no-op in a costume. What the row
actually decides, per its own summary ("The draft is kept as it stands"), is to **leave the screen
with the sign-up still on this computer**. That is the pair `discard-changes` needs: two ways to walk
away from a half-finished sign-up, differing in exactly one thing — whether a patient's details are
left on the machine — and offering only the destructive one is how a coordinator ends up with no exit
that does not throw their work away.

Its second guard is the one that earns it: `draft-survives-leaving-this-screen`. `plan-draft.ts`
falls back to an **in-memory** draft when `sessionStorage` refuses a write, which is what Safari
private browsing does, and that fallback lasts as long as the **page**, not the tab. Leaving then
loses everything, so the decision refuses and says so.

---

## The two confirmations that have nowhere to go, and why they are in the draft

`verify-identity` and `communication-preference` each record a fact the sealed domain has **no field
for**: `createPlanSchema` carries `assurances` (the two stage-1 ticks Task 9b gave a field to) and
nothing else of this kind.

They are held in the draft — this computer, this tab — and the screens that record them **say exactly
that**: _"kept on this computer for this tab, with the rest of this sign-up, and is written onto no
plan — this system has no field for it."_ Name the destination, not the act.

**That is Task 7's precedent applied, not a location invented.** Task 7 found there was no field for
the stage-1 confirmations, reported it rather than inventing one, and the owner later added one. The
draft is the wizard's own state, so holding them there is honest; adding a column to a sealed schema
on a screen's say-so would not be.

**FINDING for the owner:** if either of these should outlive the sign-up, it needs a domain field and
an attestation, exactly as `assurances` got one. Today they die with the tab.

**`communication-preference`'s meaning, stated because it is not obvious.** It records **where the
sending-time choice came from**, which is a different fact from the choice. The frozen summary is
"Record only a preference the patient gave through the staffed programme phone", and the reason that
qualifier is the whole row is that **this workspace receives nothing**: the number is one-way, no one
reads replies, and no screen shows anything a patient said. So a preference the patient asked for
reached this service by the staffed phone or it did not reach it at all — and if it did not, the
choice is the coordinator's on their behalf, which is a legitimate and different thing to record.
The screen says so and assumes neither.

---

## The parser change, and why it is tolerant where its neighbours refuse

`parseDecisions` accepts an **absent** key and reads it as "neither was recorded"; a present key that
is not two booleans refuses the whole draft.

That is the opposite treatment from `parseActivation` and `parsePatientDetail`, and the difference is
stated at the site. Absence there is **ambiguous** — a missing `patientName` could be a clinician who
typed nothing or a draft older than the stage — and guessing silently defaults half a clinician's
answers. Absence here is not ambiguous: neither decision has a default a clinician could have meant,
and the only reading is "these had not been offered when this draft was written". Reading it as
`false` under-claims in the one direction that is safe (it can never say a check happened that did
not), where refusing would throw away the patient's name and mobile number **to remove two
confirmations the clinician was never shown**.

---

## An instruction of yours that would have produced decoration, and what I did instead

You asked for the commit-time recheck to cover connectivity, permission and authentication. On these
seven rows, **all three are constants** for the reasons set out above — none of them can change while
an overlay is open on this screen. Three assertions about them would have been three assertions that
can never go red, and the brief's own rule says to say so and write the thing that can fail instead.
So the guard has exactly two conditions, both of which change under a real sequence a test performs,
and both of which have a red case and a positive control.

**A second instance, smaller.** The obvious test of "the screen renders the sealed wording" is to
assert the rendered text equals `EXACT_PATIENT_VISIBLE_MESSAGE`. With the test supplying that same
constant as the prop, **it compares the prop with itself and cannot fail whatever the screen does**.
It is split into three that can: the wizard renders a **stand-in** the domain does not contain; the
wizard's source does not mention `message-copy` **or** contain the wording; and the **page test**
asserts the page passes the module's own export, which is the assertion a hardcoding page would fail.

---

## Verification

**Every summary line below is pasted. None is reported from an exit code.**

### `npm run test:cc-guards` — the full set on the final tree

Run with `GATE_RECEIPTS=refresh`, so no cached receipt could stand in for a run.

```
> prompt-for-codex-medical-knowledge-base@0.1.0 test:cc-guards

 Test Files  18 passed (18)
      Tests  431 passed (431)
   Duration  76.91s
```

That is the run that catches collateral damage the per-suite mutation runs cannot see. It took one
attempt; the per-suite runs earlier took up to twelve behind another worktree's exclusive Playwright
lease (PID 83164, `…\.codex\worktrees\remove-followup-suggestions\Database`, exclusive, live). Every
refusal was waited out and recorded UNRUN. Nothing was ever forced.

**RE-VERIFIED AFTER THE FINAL EDIT**, because a gate's verdict covers only the tree it saw and this
report was the last thing to change. Round 1:

```
 Test Files  18 passed (18)
      Tests  431 passed (431)
   Duration  84.34s
```

And again after round 2's four changes, which added two cases:

```
 Test Files  18 passed (18)
      Tests  433 passed (433)
   Duration  63.54s
```

The uncached lint and `prettier --check` below were re-run on that same final tree for the same
reason — the first lint pass predated two test-file commits.

**Precisely what the last run saw, because "re-verified" recurses otherwise.** It ran against the
tree at `b67616399`, the final source commit. The only change after it is this paragraph and the one above, in this report file, which
**no suite in `test:cc-guards` reads** — the overlay-definition test parses
`docs/caring-contacts/interaction-matrix.md`, and nothing reads anything under
`phase-2b-sdd-archive/`. Every source and test file is byte-identical to what that run examined.

**The full set went RED first, and that is evidence the gate examines this change.** The wizard
suite's first run on the new tree:

```
 Test Files  1 failed (1)
      Tests  22 failed | 68 passed (90)
```

Two causes, both mine, and neither predictable from reading the source:

1. `confirmActivation` and four other stage-4 cases resolved the trigger with a bare
   `screen.getByTestId("workspace-overlay-trigger")`. `discard-changes` and `save-draft` live in the
   draft notice, which **every stage renders**, so that lookup became ambiguous and threw. Taking the
   first match would have been worse than the ambiguity — every stage-4 case would have gone on
   passing while confirming whichever row rendered earliest — so the helper now names its row and
   still refuses anything but exactly one.
2. One `toEqual` over a whole stored draft did not know about the new `decisions` key.

### Per-suite runs, and which selection each row used

Recorded so a per-suite red is never read as a full-set red.

| Suite                                           | Baseline on the final tree | Mutations run against it                                                |
| ----------------------------------------------- | -------------------------- | ----------------------------------------------------------------------- |
| `caring-contacts-plan-wizard.dom.test.tsx`      | `Tests 92 passed (92)`     | M1, M2, M3, M6, M7, M8, M9, M10, M11, M12, M13, M14, M15, M16, M17, M19 |
| `caring-contacts-patient-overview.dom.test.tsx` | `Tests 43 passed (43)`     | M4                                                                      |
| `caring-contacts-new-plan-page.dom.test.tsx`    | `Tests 12 passed (12)`     | M5                                                                      |
| `caring-contacts-plan-draft.dom.test.tsx`       | `Tests 19 passed (19)`     | none directly — see M12's note                                          |

**M12 mutates `plan-draft.ts` and was run against the WIZARD suite, not the draft suite.** That is
deliberate and is stated rather than left to be inferred: the tolerant-parser branch it attacks is
exercised by the wizard's stored-draft fixtures, which is where a draft written before this change is
actually read back. The full set above covers the rest.

### Typecheck

`npx tsc -p tsconfig.json --noEmit` — no diagnostics emitted, exit 0. Run four times across the task,
the last on the final tree.

### Lint, uncached

`node_modules/.cache/eslint` removed first, then `npx eslint --format json` over the eight changed
files. `npm run lint` uses a per-file cache, so a failure caused by a different file's change stays
invisible locally and goes red in CI. The JSON names the files it examined, so this is not an exit
code standing in for a run:

```
exit=0
files examined: 8
page.tsx                                        errors 0 warnings 0 []
patient-overview.tsx                            errors 0 warnings 0 []
plan-wizard/overlay-guards.ts                   errors 0 warnings 0 []
plan-wizard/plan-draft.ts                       errors 0 warnings 0 []
plan-wizard/plan-wizard.tsx                     errors 0 warnings 0 []
caring-contacts-new-plan-page.dom.test.tsx      errors 0 warnings 0 []
caring-contacts-patient-overview.dom.test.tsx   errors 0 warnings 0 []
caring-contacts-plan-wizard.dom.test.tsx        errors 0 warnings 0 []
```

### `prettier --check`

It caught two files during the task — `plan-wizard.tsx` and the wizard test — and both were rewritten
and committed rather than left for the pre-push guard. On the final tree, over every changed file:

```
Checking formatting...
All matched files use Prettier code style!
```

### Not run, and why

- `npm run test` — the controller's, at merge points. Other worktrees are live and the exclusive heavy
  lease was held continuously for most of this task.
- `npm run verify:ui` / `tests/ui-caring-contacts-workspace.spec.ts` — see the section below.
- Anything provider-backed — not approached.

---

## `tests/ui-caring-contacts-workspace.spec.ts` — what I think it needs

**My assessment: it needs one change, and the rest is unreachable. I did not run it.**

That spec's isolated Playwright server **seeds no referrals and no plans** — its own module note says
so. So `/caring-contacts/plans/new` always renders `PlanStartStateNotice`, and every one of the seven
wizard rows is behind a screen no case in that spec can reach. `activation-success` is behind
`EpisodeOverview`, which the zero-plan patient-overview path never reaches either.

**The one thing that is reachable, and is the change I would make.** That spec asserts **single
occupancy of the overlay content node** throughout. Task 10 introduced the workspace's first
production `delivery-detail` trigger on an unreachable branch; this task introduces eight more,
seven of them on an unreachable route. Nothing changes today. But if a referral or a plan is **ever
seeded into that server**, that spec becomes the surface where these rows are finally provable in a
browser — and it is where the two things this branch can only assert in jsdom would become real:

1. **The commit-time refusal in a real browser.** jsdom has no layout and no real history timing; the
   token/history interaction between staging a commit and confirming it is exercised for real only
   there.
2. **320px and forced colors on the new controls.** I assert the classes (`min-h-tap`,
   `forced-colors:`) because jsdom has no layout. A pixel measurement of the stage-3 wording panel
   and the two-control draft-notice row at 320px is browser work, and it is the place a wrapped or
   overflowing control would actually show.

If you want a cheap version now: seeding one accepted referral into that server makes the whole
wizard reachable and would let that spec prove all seven rows against the same frozen table this
branch reads.

---

## Open questions and limits I could not close

1. **`pathway-preview`'s classification** — the top of this report. Yours to confirm.
2. **The host closes unconditionally**, so a commit-time refusal cannot retain the overlay surface.
   Reported above; the fix is a change to `workspace-overlays.tsx` that Tasks 18 and 19 build
   against.
3. **`message-preview`'s frozen summary promises content the host structurally cannot carry.**
   Reported above.
4. **The two wizard-local confirmations die with the tab.** No domain field exists. Reported above.
5. **No sixth hospital-record value was found.** The five the standing discipline names are the only
   ones these screens wanted and did not have. `verify-identity` looked like a sixth — the design
   implies comparing against a source record — but it is the FIRST one (stage 1's identity) wearing a
   different hat. **Its drawer-versus-screen conflict is not a hospital-record question at all and is
   filed above with `message-preview`'s and `save-draft`'s**, where it belongs: three rows, one
   pattern.
6. **`save-draft`'s announcement lives on the screen rather than in the drawer**, under your ruling.
   If the owner would rather the approved copy said it, the screen's two sentences come out and the
   agreement test's frozen-drawer watch is what tells you to move them — it goes red the moment that
   copy starts mentioning leaving.

---

## Round 2 — what your review changed

Four items. Every one of them is a change to the tree, not to this report; the mutation ledger below
was re-run whole against the result, and the two rows whose anchors the round invalidated were
rewritten and re-run rather than left describing a tree that no longer exists.

### 1. `save-draft` navigated without saying so, and now announces its destination

**You were right that my justification overstated its evidence.** I wrote that leaving happens "per
its own summary (_The draft is kept as it stands_)". That sentence says the draft is kept. It does
not say the screen changes, and I attached a navigation to it as though it did.

What the row actually was: the control said _"Leave this for now"_, the frozen drawer said _"Save this
activation draft" / "Save draft" / "The draft is kept as it stands. Nothing is sent and no plan
starts."_, and confirming wrote nothing and pushed to this team's plans. The last thing a coordinator
read before confirming never mentioned leaving, which is exactly what the matrix's **Navigation**
clause exists to prevent.

**Implemented as you ruled**, and the reasoning is recorded at the commit site so a later reader does
not have to reconstruct it: the navigation stays, the SCREEN announces the destination, and the
frozen copy is untouched. Two places, both read before confirming, both fed from one constant
(`SAVE_DRAFT_DESTINATION`) so they cannot drift apart:

- the control's own accessible name — `Leave this for now — keeps this sign-up on this computer and
takes you to this team's plans`;
- a sentence in the flow of the draft notice, stating the pair's difference: _"Leave this for now
  keeps this sign-up on this computer and takes you to this team's plans. Discard draft removes it
  and stays on this screen."_

**The agreement case is written and mutated** — the equivalent of stage 4's _"labels the control for
both writes, agreeing with the overlay it opens"_. It asserts both halves (M16, M17), and it adds a
**frozen-drawer watch**: the drawer's own text is asserted NOT to mention leaving, so if the owner
ever amends that copy the case goes red and names the remedy — move the announcement in rather than
say it twice. That watch is given a positive control, because a `not.toMatch` with a regex that
matches nothing proves nothing: the same regex is asserted to MATCH the screen's destination sentence
first.

**What I did NOT change, and you accepted the reasoning:** the row still writes nothing on confirm.
Every keystroke already goes through the draft, so an identical write would be a gesture rather than
an action.

### 2. The refusal sentence was wrong on `discard-changes`

`sign-up-still-here` fires when the sign-up has gone while the surface was open. Its sentence ends
_"Start the sign-up again from this team's plans."_ On every row that wanted to RECORD something that
is the remedy. On `discard-changes` the coordinator **asked** for the sign-up to go, it has gone, and
they were being refused and told to restart — for the outcome they wanted and already have. A refusal
that reads as a failure when the thing they asked for is already true is worse than no refusal,
because it invites them to undo it.

Fixed with a per-row override (`WIZARD_DECISION_REFUSAL_OVERRIDES`), not by softening the generic
sentence, which is right everywhere else. The row now reads: _"This sign-up had already gone from
this computer, so there was nothing left to discard. Nothing was put back and nothing of it remains
here, which is what you were asking for. This press is not what removed it, so this says so rather
than reporting it as done."_

**It is still a refusal rather than silent success, deliberately.** Nothing on that press performed
the removal, so reporting it as done would claim an action the control did not take. What the
override changes is the sentence, never the outcome.

The two rows are now held apart **in both directions**: the `verify-identity` case pins that the
generic sentence DOES say _"Start the sign-up again"_, so the discard case's assertion that it does
not is a contrast between two rows rather than a sentence nothing says anywhere. M19 proves it.

### 3. The two disclosure gaps

- **The source scan had no positive control, and you were right that it was the one that got away.**
  `stripSourceComments` has no test of its own, so a regression returning an empty string would have
  silenced both `not.toContain("message-copy")` and `not.toMatch(/thinking of you/i)` while the case
  stayed green. One line closes it: the scan is asserted to contain `export function PlanWizard`
  before anything is concluded about what it lacks.
- **The three per-row accessibility assertions are now disclosed** in "What the ledger does NOT
  prove", with the reason you gave for not mutating them: the pre-existing stage scan already asserts
  `min-h-tap` on every `<button>` and carries its own mutation history, so a mutation here would
  re-prove a proved mechanism at the cost of a lease. What the per-row copies add is a NAMED failure,
  which is worth having and is not worth a separate red.

### 4. `verify-identity`'s frozen-copy conflict moved, and the three consolidated

You are right that I filed it under the wrong heading. It is not a hospital-record question; it is
the same drawer-versus-screen conflict as `message-preview`'s. It now sits beside it, and the three
rows are stated as **one finding with three instances**, because the pattern is the finding.

### And M15 undersells itself — corrected

I wrote that M15's second failure was the `save-draft` case "for the same reason M1's is: one
mechanism, two rows". It is not. Under M15 that case fails on
`expect(navigation.push).not.toHaveBeenCalled()` — `save-draft`'s OWN non-mutation clause, since
leaving is the whole of what it does. **M15 isolates the does-not-mutate clause on both rows that can
reach it**, one measured in storage and one in navigation. The lesson is small and general: read
which assertion did the work per row, rather than inferring it from the failure count.

### Noted

The commit subject `049ba68db` restates a count ("the fifteen-row mutation ledger") in a view where
the rows are not visible. Left as history, as you said.

---

## Mutation ledger

**The driver is this branch's, and every one of its four guards is kept**, in the order they run:
each row's `file` is validated against an **allowlist of files this task may mutate** and each row's
`id` for uniqueness, **both before any file I/O at all**; the tree is asserted `git status --porcelain`
clean before a mutation and again after restoring it; the computed post-image must **differ** from the
original before it is written; and the file is re-read from disk and asserted byte-identical to that
post-image. Nothing was staged by wildcard while a mutation was applied — every commit in this task
stages explicit paths.

**One correction to the inherited driver, and it is a correction rather than a preference.** Its lock
detector matched only the lock module's **throw**, whose message contains `capacity is full`.
`run-heavy.mjs` refuses differently — it prints `DATABASE_HEAVY_RUN_ADMISSION_BUSY` and exits 75 — and
a detector that knows one shape reports the other as a **run**. Both are matched now.

Every attempt is itemised, greens included. **No aggregate total** — the table is the evidence.

| #   | The claim the mutation attacks                                                                         | Expected | Got                                           | Gate result (`Tests`)      | Selection |
| --- | ------------------------------------------------------------------------------------------------------ | -------- | --------------------------------------------- | -------------------------- | --------- |
| M1  | THE COMMIT-TIME RECHECK ACTUALLY RECHECKS: it reads the store now, not the state it closed over        | red      | **RED**, as predicted                         | 3 failed / 89 passed (92)  | wizard    |
| M2  | the guard's early return is load-bearing — a refused decision does not fall through and perform        | red      | **RED**, message differed — see below         | 3 failed / 89 passed (92)  | wizard    |
| M3  | the condition is a COMPARISON, so a screen nobody has typed into yet is not refused on arrival         | red      | **RED**, as predicted                         | 4 failed / 88 passed (92)  | wizard    |
| M4  | `activation-success` is offered on a RUNNING plan and withheld from a paused or draft one              | red      | **RED**, message differed — see below         | 3 failed / 40 passed (43)  | overview  |
| M5  | the PAGE reads the patient-visible wording from the sealed domain rather than writing it out           | red      | **RED**, as predicted                         | 1 failed / 11 passed (12)  | page      |
| M6  | the specimen panel renders the wording it is handed                                                    | red      | **RED**, as predicted                         | 1 failed / 91 passed (92)  | wizard    |
| M7  | leaving asks whether the browser is still writing the sign-up down                                     | red      | **RED**, as predicted                         | 1 failed / 91 passed (92)  | wizard    |
| M8  | changing patient REMOVES the sign-up before it leaves the screen                                       | red      | **RED**, as predicted                         | 1 failed / 91 passed (92)  | wizard    |
| M9  | confirming a pathway preview chooses the version it was opened from                                    | red      | **RED**, as predicted                         | 1 failed / 91 passed (92)  | wizard    |
| M10 | the recording row records, so "no change" is distinguishable from success                              | red      | **RED**, as predicted                         | 1 failed / 91 passed (92)  | wizard    |
| M11 | the refusal NAMES which decision did not happen, from the frozen table                                 | red      | **RED**, as predicted                         | 3 failed / 89 passed (92)  | wizard    |
| M12 | the parser's tolerant branch is reached: a draft written before these decisions is read, not discarded | red      | **RED**, as predicted                         | 32 failed / 60 passed (92) | wizard    |
| M13 | the preview panel says no external action occurs, in words                                             | red      | **RED**, as predicted                         | 1 failed / 91 passed (92)  | wizard    |
| M14 | OVER-SENSITIVITY CONTROL: no assertion reads the specimen panel's `whitespace-` class                  | green    | **GREEN**, as predicted                       | 92 passed (92)             | wizard    |
| M15 | A GUARD REJECTION DOES NOT MUTATE, on BOTH rows that can reach it — isolated, because M2 cannot        | red      | **RED**, as predicted                         | 2 failed / 90 passed (92)  | wizard    |
| M16 | ROUND 2: the "Leave this for now" control names its destination in its accessible name                 | red      | **RED**, as predicted                         | 1 failed / 91 passed (92)  | wizard    |
| M17 | ROUND 2: the draft notice says where each of the two exits leaves you                                  | red      | **RED**, as predicted                         | 1 failed / 91 passed (92)  | wizard    |
| M19 | ROUND 2: `discard-changes` has its own refusal wording rather than the generic one                     | red      | **RED**, as predicted (on the second attempt) | 2 failed / 90 passed (92)  | wizard    |

### Predicted message against observed, and the two that did not match

- **M1** — predicted: _the refusal element is never found_
  - failing test: `refuses a decision confirmed after the sign-up was removed, and puts nothing back`
  - observed: `Error: Unable to find an element by: [data-testid="caring-contacts-decision-refusal"]`
  - the second failure is `refuses Leave this for now once the browser stops writing the sign-up down`.
    Both refusals go through the one mechanism, so one mutation moves both — stated rather than
    counted, because a reader seeing "2 failed" should know which two and why.

- **M2 — THE PREDICTION WAS WRONG, AND THE DISCREPANCY IS THE FINDING.**
  - predicted: _the storage assertion fails — "the refused decision put the sign-up back on the machine"_
  - observed: `Error: Unable to find an element by: [data-testid="caring-contacts-decision-refusal"]`
  - Why: removing the `return` does not merely let the decision through, it falls into
    `setDecisionRefusal(null)` on the next line, so the refusal is **cleared before it can render**.
    The refusal assertion fails first and **the storage assertion is never reached**.
  - This is exactly the shape the standing discipline names — _an assertion behind a sibling that
    fails first is never reached_ — so M2 does **not** prove "a guard rejection does not mutate". It
    proves the early return matters, which is a different and lesser claim. **M15 was written for
    that reason**: it performs the decision _before_ consulting the guard, against a state captured
    first, so the refusal still renders and the record still moves. Its observed message is the one
    M2 was predicted to produce.

- **M3** — predicted: _the loop's first row opens a decision whose control is `aria-disabled`_
  - failing test: `reaches verify-identity from a control, and its decision is wired rather than refused`
  - observed: `verify-identity opened a decision the screen has not wired: expect(element).not.toHaveAttribute("aria-disabled")`
  - the other two are `discard-changes` and `save-draft`, the rows also reachable from a fresh screen.

- **M4 — the message differed, and the mutation is stronger than predicted.**
  - predicted: _`expected [] to have a length of 1`_
  - observed: `Error: Unable to find an element by: [data-testid="workspace-overlay-trigger"]` —
    `getAllByTestId` **throws** on none rather than returning an empty array, so the query fails
    before the length assertion. The absence is still what is proved.
  - It went red **three** times, not one, and both directions are covered by the single mutation:
    inverting the condition removes the control from the running plan **and** adds it to the paused
    and draft ones, so `offers none on a paused plan` and `offers none on a draft plan` fail too.
  - **What this leaves unproven, stated rather than glossed:** the `toHaveLength(1)` guards against a
    _second_ control appearing, and no mutation here moves toward two. That assertion is unproven.

- **M5** — predicted: _the page's value is not the module's_
  - failing test: the page-props case
  - observed: `AssertionError: expected 'Hi Rowan, a stand-in written on this …' to be 'Hi Rowan, Alex from Example Aftercare…'`

- **M6** — predicted: _the specimen node no longer contains the stand-in wording_
  - failing test: `renders the patient-visible wording it is handed`
  - observed: `Error: expect(element).toHaveTextContent()`

- **M7** — predicted: _the refusal element is never found_
  - failing test: `refuses Leave this for now once the browser stops writing the sign-up down, and does not navigate`
  - observed: `Error: Unable to find an element by: [data-testid="caring-contacts-decision-refusal"]`

- **M8** — predicted: _storage still holds the sign-up_
  - failing test: `removes the sign-up before it leaves when the patient is the wrong one`
  - observed: `AssertionError: the wrong patient's sign-up was left on the machine: expected '{"referralId":"SYN-REFERRAL-001","sta…' to be null`

- **M9** — predicted: _the draft still names the referral's own version_
  - failing test: `chooses the version a pathway preview was opened from, and says which row it came from`
  - observed: `AssertionError: confirming the preview chose nothing: expected 'SYN-PATHWAY-001' to be 'SYN-PATHWAY-002'`

- **M10** — predicted: _the recorded flag is still false_
  - failing test: `tells a read-only row from a recording one by what each leaves behind`
  - observed: `AssertionError: the recording row recorded nothing: expected false to be true`

- **M11** — predicted: _the refusal does not contain "Verify identity was not carried out"_
  - failing tests: the two refusal cases, one naming `Verify identity` and one naming `Save draft`
  - observed: `Error: expect(element).toHaveTextContent()`

- **M12** — predicted: _the review stage cannot be reached from a stored draft_
  - failing test: `returns a stored draft to the stage it names, including the one that writes`, and 31
    others — every case built on a stored fixture, which is the blast radius that shows the branch is
    genuinely load-bearing rather than defensive
  - observed: `Error: Unable to find role="region" and name "Review and activation"`

- **M13** — predicted: _the personalisation region no longer says nothing is ever sent_
  - failing test: `states beside the preview that no external action occurred, in words rather than by omission`
  - observed: `Error: expect(element).toHaveTextContent()`

- **M16** — predicted: _the trigger's accessible name no longer names the destination_
  - failing test: `says where Leave this for now takes you, which the frozen drawer it opens does not`
  - observed: `Error: expect(element).toHaveAccessibleName()`

- **M17** — predicted: _the destinations paragraph no longer names either destination_
  - failing test: the same case, its in-flow half
  - observed: `Error: expect(element).toHaveTextContent()`

- **M19 — RUN TWICE, AND THE FIRST MESSAGE WAS A SECOND DEFECT.**
  - predicted: _the discard refusal falls back to the generic sentence_
  - first observed: `AssertionError: the given combination of arguments (undefined and string) is
invalid for this assertion.` That is red, and it is useless: the pin read
    `OVERRIDES["discard-changes"]?.["sign-up-still-here"]`, so renaming the row key yielded
    `undefined` and `toContain` failed on the RECEIVER'S TYPE rather than on the wording. A pin that
    cannot tell "the override is gone" from "the wording changed" is not drawing the distinction it
    exists to draw, so it was split in two — the row key's presence, named in the failure message,
    then the wording.
  - re-run observed: `AssertionError: discard-changes no longer has its own refusal wording, so it
falls back to the sentence that tells a coordinator to start again: expected false to be true`
  - the second failure is the screen-side case, which loses "there was nothing left to discard" and
    regains "Start the sign-up again". That is the pair working as designed: the module held to a
    literal on one side, the rendered text on the other, and neither able to satisfy the other.

- **M14** — predicted: _GREEN; nothing reads a presentational class on a paragraph_
  - observed: `Tests 90 passed (90)`. The over-sensitivity control: the tap-target scan reads the
    `className` of **buttons** and of **labels**, and this is a `<p>`, so a class change there must
    not move the suite. It does not.

- **M15** — predicted: _the storage assertion fails — "the refused decision put the sign-up back on the machine"_
  - failing test: `refuses a decision confirmed after the sign-up was removed, and puts nothing back`
  - observed: `AssertionError: the refused decision put the sign-up back on the machine: expected '{"referralId":"SYN-REFERRAL-001","sta…' to be null`
  - **THE SECOND FAILURE IS A SECOND CLAIM, NOT THE SAME ONE TWICE — I under-read this the first
    time.** I wrote that it fails "for the same reason M1's is: one mechanism, two rows". It does
    not. Under M15 the `save-draft` case fails on `expect(navigation.push).not.toHaveBeenCalled()`,
    which is that row's OWN non-mutation clause: leaving is the whole of what `save-draft` does, so
    proving the navigation did not happen IS proving the refusal changed nothing. M15 therefore
    isolates the does-not-mutate clause on **both** rows that can reach it — one measured in storage,
    one in navigation. M1's and M7's second failures genuinely are one mechanism reaching two rows;
    the difference is which assertion does the work, and that is worth reading per row rather than
    inferring from the count.

### What the ledger does NOT prove

- **Three per-row accessibility assertions carry no mutation** — `min-h-tap`, `not min-h-11` and
  `forced-colors:` on each of the seven triggers, in the reachability loop. They are **disclosed
  rather than mutated**, deliberately: the pre-existing "every activation surface is a production tap
  target" block already scans every `<button>` in the rendered stage for `min-h-tap` and has its own
  mutation history from Task 7, so a mutation here would re-prove a mechanism that is already proved
  and cost a lease to do it. What the per-row copies add is a **named** failure — they say which
  row's control lost the floor — and that value is real but not worth a separate red.
- **The frozen-drawer watch has no mutation, and cannot have one from this task.** The assertion that
  `save-draft`'s drawer never mentions leaving can only be falsified by editing `definitions.ts`,
  which is outside this task's mutation allowlist and is precisely the event the assertion exists to
  detect. It is given a **positive control instead**: the same regex is asserted to MATCH the
  screen's own destination sentence first, so a regex that matched nothing would go red there.
- **The source scan's positive control has no mutation.** `expect(wizardSource).toContain("export
function PlanWizard")` guards against `stripSourceComments` returning an empty string, and nothing
  this task may mutate can empty it — the helper lives in `tests/helpers/` and has no test of its
  own. Its falsifiability is structural: an empty input fails it and nothing else does.
- **`change-patient` has no guard, so nothing can refuse it.** That is stated in the module as a
  property of the row rather than a gap, and no mutation can make an absent condition fail. What IS
  proved is the ordering (M8) and that `wizardDecisionConditions` throws for an id nobody declared —
  which is what stops a mistyped id looking identical to this one legitimate empty list.
- **`toHaveLength(1)` on the `activation-success` control** — see M4.
- **Nothing here is browser evidence.** jsdom has no layout, so the tap-target and forced-colors
  assertions read class names. The pixel measurement is `verify:ui`'s, and that spec cannot reach
  these screens today — see the section above for the one change that would let it.
