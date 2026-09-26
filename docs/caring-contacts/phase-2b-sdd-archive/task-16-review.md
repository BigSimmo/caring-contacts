# Task 16 review — template detail, dual approval, and this group's overlays

**Reviewed:** base `33f2106e8b2f4bcd47495f98431a7825a6c80bc8` → head
`ef1fa954b9fb54bcbab72c68eabc1afba32385bd`, branch `claude/caring-contacts-demo-seed`,
worktree `D:\Worktrees\Database\cc-templates`. Worktree clean at review time.
Read-only review: nothing in the diff was edited, no mutation was applied to the tree, nothing
pushed, no pull request, no subagent.

## Verdicts

**Spec compliance: ❌.** The brief's own build is met almost in full and to a high standard. Two
things fail: controller **Ruling [131] is not satisfied**, and the screen states the _opposite_ of
what the sealed domain holds about the wording's approval; and one item of the brief's explicit
route checklist — the `docs/codebase-index.md` entry — was not done and was not disclosed.

**Task quality: not approved — approve on the fixes below.** The method is the strongest in this
phase so far: test-first, every mutation itemised with no aggregate, two under-predictions disclosed
rather than absorbed, an over-sensitivity control labelled as such, the browser block marked
never-run in the artefact a reader meets rather than only in the report, and the one large
interpretive decision (does this screen show the wording?) surfaced for contest instead of resolved
silently. What holds it back is not the testing — it is two disclosure failures and one false
rendered clinical claim.

---

## Findings, by severity

### MAJOR 1 — Ruling [131]: the second approval is absent, and the screen asserts its opposite

**Evidence.**

`src/components/caring-contacts/workspace/template-detail.tsx:319-324` renders, to a clinician:

> Read from this version's own record. Only one patient-visible message has been approved anywhere
> in this system, and it is a specimen — **one approved example**, its greeting and its sender name
> included — so another version would hold the same wording rather than wording of its own.

`src/lib/caring-contacts/message-copy.ts:4` opens the module with `PROVISIONAL — not clinically
approved`, `:15` repeats it over `AUTOMATED_REPLY_RESPONSE`, and `:9-10` names who owns the
decision:

> Final wording is a clinical decision owned by the lived-experience and clinical-programme approval
> gate.

`EXACT_PATIENT_VISIBLE_MESSAGE` (`message-copy.ts:13`) interpolates
`PATIENT_VISIBLE_NO_REPLY_NOTICE`, which sits directly under that provisional marker, so it cannot
be more approved than its parts.

**So the screen tells a clinician the message is approved. The sealed domain says it is not
clinically approved, and names as its owner the very two seats the card immediately above is
displaying.** The brief's own rule for this case — "If you find any difference between the domain
and the spec, the domain wins and the difference is a finding" — was applied to the reply copy and
not to this sentence.

**Positioning makes it worse rather than neutral.** `template-detail.tsx:211-212` renders
`DualApprovalRecord` and then `MessageWordingRecord`, adjacent, in that order. On a record whose
provenance is **absent**, `pathwayVersionProvenanceWording` correctly returns `null`
(`src/lib/caring-contacts/pathway-versions.ts:129`) and the qualifier is not rendered
(`template-detail.tsx:290`) — which is the right contract. The consequence on screen is:

1. "Approved by the clinical programme lead — Recorded 2026-03-01 (AWST)."
2. "Approved by the lived-experience representative — Recorded 2026-03-02 (AWST)."
3. immediately below: "Only one patient-visible message has been **approved** … one **approved**
   example", then the wording itself in a blockquote.

That is precisely the reading Ruling [131] names: a clinician concludes the words a discharged
patient will receive have been clinically signed off. They have not.

**Nothing in the diff pins this.** There is no assertion anywhere in
`tests/caring-contacts-template-detail.dom.test.tsx` or
`tests/caring-contacts-template-detail-page.dom.test.tsx` about the wording's approval status.

**On the implementer's own account of it.** Report §Concerns 2 raises the gap honestly and declines
to put it on screen, arguing that stating "this wording is not clinically approved" beside an
existing provenance qualifier would be two overlapping claims. That argument is worth taking
seriously and it is _not_ what happened: the screen does not stay silent on the wording's approval,
it affirmatively claims the wording _is_ approved. The stated reason does not cover the sentence
that was actually shipped, and the sentence is not mentioned in the report.

**What the fix has to do (not applied here):** state both approvals, and keep them visibly separate
objects — the pathway version's governance approval, and the wording's approval status, which is
"provisional, not clinically approved, owned by the approval gate". The word "approved" must stop
being used of the specimen in rendered prose. This is a screen change plus at least one assertion
that goes red if the wording card ever again claims the message is approved.

---

### MAJOR 2 — Ruling [132]: `message-preview`'s frozen copy, and exactly which clause is untrue

The row the workspace host actually renders is
`src/components/caring-contacts/workspace/overlays/definitions.ts:111-122`
(`overlay-host.tsx:352` renders `definition.title`, `:355` `definition.summary`, `:379`
`definition.decision`). The implementer's quotations of it are **correct** — I checked them against
the file:

- **title:** "Preview the message the patient would see"
- **summary:** "The wording is shown exactly as it would arrive, with every detail already filled in."
- **decision:** "Back to personalisation"

**What the screen that raises it can actually do.**
`/caring-contacts/templates/[pathwayId]` reads exactly two things — the service state and one
pathway version (`page.tsx:108-135`) — and the page suite pins that `getEpisode` and
`listPatientNames` are never called (`…-detail-page.dom.test.tsx:210-226`). There is no patient on
this route. The wording it shows is `snapshot.messageTextByType[type]` read back verbatim through
`readWording` (`template-detail.tsx:364-367`); nothing slices, matches, interpolates or completes
it. The card the trigger sits beside says so in its own words: _"Nothing below is addressed to
anybody, and nothing in this workspace is ever sent to any number"_ (`template-detail.tsx:322-323`).

**Clause by clause:**

1. **"with every detail already filled in" — untrue, and this is the load-bearing one.** Nothing on
   this route fills in any detail. The seeded string's name and sender are baked into the constant
   (`message-copy.ts:13`), not substituted from anything this screen read. Once Task P lands the
   first-name slot the clause stops being merely unsupported and becomes demonstrably false: the
   overlay will promise a filled-in detail beside a visibly unfilled slot.
2. **"exactly as it would arrive" — untrue.** There is no addressee, so there is no arrival. The
   overlay contradicts the card it is raised from.
3. **"the patient would see" (title) — untrue,** same defect as (2): no patient exists in this
   context.
4. **"Back to personalisation" (decision) — untrue.** The control returns to the template detail
   record. Personalisation is stage 3 of the activation wizard at `/caring-contacts/plans/new`,
   which this route neither is nor links to.

**If the consolidation fixes one clause, fix (1);** (2)–(4) are context errors from a row written
for the personalisation stage, and they are fixed together by giving the row a governance-context
form or by removing `templates` from its product context.

**New information the consolidation needs, which is not in the implementer's report.** There are
**two** frozen texts for this id and they already disagree.
`src/components/caring-contacts/mockups/overlay-specimens.tsx:81-92` carries, for the same
`message-preview` row: title "Preview exact patient-visible message", summary "The fully substituted
message is visible exactly as the patient would receive it.", decision "Return to personalisation".
`docs/caring-contacts/interaction-matrix.md:3` names _that_ file as the source of truth, but the
workspace host reads `overlays/definitions.ts`, and
`tests/caring-contacts-overlay-definitions.test.ts` pins `definitions.ts` only against the matrix's
structural columns and a prohibited-language scan (`:203-214`) — **the `summary` and `decision` text
is pinned to nothing.** So the sixth conflict is a conflict with two divergent frozen texts, both
written for personalisation, and neither held to the other by any gate. Nothing in the diff edits
either; that is correct — they are frozen and the choice is the owner's.

---

### MINOR 3 — a brief checklist item was skipped and not disclosed

The brief (line 76) lists the route checklist as: page, inbound link, `sitemap:update`,
**"a `docs/codebase-index.md` entry"**, and a reachability assertion. Four of the five were done.

`docs/codebase-index.md` is **not in the 17-file diff**, and `git grep -n "caring-contacts/templates"
docs/codebase-index.md` returns only the library route (lines 81, 220, 229, 248). Two places are now
incomplete rather than merely un-extended:

- **line 219-221** enumerates the workspace routes "built so far" and does not include this one.
- **line 248** — "`/caring-contacts/templates` is a governance record viewer and shows no message
  wording at all" — remains literally true of the library, but it is now the family's only statement
  about wording, and the family's detail route does show it. The implementer corrected exactly this
  claim inside `templates-library.tsx`'s module note and did not carry the correction here.

The report's status is "complete" and its conflicting-files list (§6) does not mention the omission.
An undisclosed checklist gap is the more serious half: the discipline's rule is that a described
limitation is not a discharged one, and this one was not even described.

---

### MINOR 4 — one assertion whose comment claims more than it tests

`tests/caring-contacts-template-detail.dom.test.tsx:461-463`:

```
// Held apart by their own words, not merely by their headings: two states that render the same
// paragraph are one state with two names.
expect(notHeldText).not.toBe(notPermittedText);
```

Both strings come from `group.textContent`, which **includes the group's heading**. The two headings
are distinct literals — "Governed versions are not visible in this role"
(`template-detail.tsx:140`) and "No governed version with this identifier" (`:149`) — so the two
`textContent` values can never be equal while the headings differ. The assertion therefore cannot go
red for the reason its comment gives; it proves nothing about the paragraphs. The teeth in that case
are lines 464-465, which are fine.

**Mutation that would prove it:** make `not-held`'s `explanation` byte-identical to
`not-permitted`'s `because`, and drop `changedBy` and `action`. Line 463 stays **green**; 464 and
465 go red. **Fix:** compare the body text with the heading excluded, or delete the comment's claim
and let 464/465 stand alone.

This is the only assertion in the two new suites I could find that cannot fail as intended. Every
other absence in both files carries a positive control that really puts its subject within reach,
and I checked each one individually — including the three-scenario list behind the forced-colors and
320px proxies, which is the shape Task 15 got wrong.

---

### MINOR 5 — two counts restated in prose, away from what they count (Ruling [94])

- `template-detail.tsx:320-321`, **rendered to a clinician**: "Only one patient-visible message has
  been approved anywhere in this system". A count about `message-copy.ts`, read by no gate. It
  decays silently the day a second message is authored — and it is the same sentence as MAJOR 1.
- `overlays/overlay-trigger.tsx:118`, new in this diff: "the **EIGHT** overlays that record
  nothing". I derived the number rather than repeating it: `definitions.ts` holds 16
  `mutatesState: true` and 8 `false`, and the matrix's Mutation column reads 8 "No" against 14 "Yes"
  plus 2 "Yes; two-stage". Correct today; the decaying form.

---

### MINOR 6 — the browser block's page-identity assertion is substring-satisfiable

`tests/ui-caring-contacts-workspace.spec.ts`, `caring-contacts template detail` block, uses
`page.getByRole("heading", { level: 1, name: TEMPLATE_DETAIL_SCREEN.heading })` with the heading
`"Template"`. Playwright's `name` option matches case-insensitively **as a substring** unless
`exact: true` is passed, so `"Template"` also matches the templates library's `"Templates"` h1. A
regression that served the library page at the detail URL would satisfy that assertion. It is
mitigated — the nothing-held group assertions in the same tests are detail-specific — but the
identity assertion itself is not doing the work it appears to. Pass `exact: true`.

Stated plainly: **this block has never been executed by anyone**, which the implementer records
correctly both in the report and in the adoption contract's `unverifiedProofNote`.

---

### NIT 7 — the forced-colors proxy examines only one border token

`tests/caring-contacts-template-detail.dom.test.tsx:569` selects
`[class*='border-[color:var(--border)]']`. A surface bordered with any other token —
`--border-strong`, say — matches neither the selector nor the check, and is silently not examined.
No such surface exists on this screen today, so it is not a live hole; it is a hole that opens
without a red the first time one is added.

### NIT 8 — a prop that exists to be ignored

`TemplateDetailView`'s `not-held` member carries `pathwayId` (`template-detail.tsx:124`) and the
branch that renders it (`:146-157`) never reads it. That is deliberate — it is what lets the
reflection case at `…-template-detail.dom.test.tsx:468-475` pass a poisoned value — and the guard is
test-only. Worth a comment at the type so the next reader does not "wire it up".

---

## Shapes I checked for and did NOT find

- **A fixture that renders no rows asserting a row is absent.** Every absence in both new suites has
  a positive control that puts its subject on screen first, and the three surface scenarios behind
  the forced-colors and 320px proxies each carry their own `present()` control naming the surface.
- **A `toEqual` whose expected value an earlier line computed.** None.
- **A constant pinned ahead of the loop that derives it.** None; the `mutatesState` premises at
  `…-detail.dom.test.tsx:367-373` read the frozen table and are the correct shape.
- **A rendered string changed by accident during the `templates-library.tsx` refactor.** The seven
  helpers changed visibility only; no returned string changed. The library suite is green.
- **`aria-disabled` together with native `disabled`.** Neither is set by new code; the retirement
  overlay's control is asserted to carry `aria-disabled` and _not_ `disabled`
  (`…-detail.dom.test.tsx:427-428`).
- **Tap targets.** Every control carries `min-h-tap`, which is `--spacing-tap: 3rem` = 48px
  (`src/app/globals.css:118`) — the production floor, on the element containing the control, and
  `min-h-11` is asserted absent (`…-detail.dom.test.tsx:505-513`).
- **A raw role identifier rendered to a clinician.** None; the wording map is imported from the
  sealed domain and the identifiers are asserted absent over a render that really carried them
  (`…-detail.dom.test.tsx:218-236`). `tests/caring-contacts-interface-vocabulary.test.ts` is green.
- **Anything about a patient in a query string (Ruling [111]).** The route carries a pathway-version
  identifier as a path segment; no query string is written by this screen beyond the host's
  `?overlay=`. The identifier is additionally asserted never to be echoed back.
- **A literal `0x08` byte, or CR bytes,** in any of the seven files this task wrote or changed: zero
  of each.

## Server/Client boundary — inspection, not proof

`page.tsx` is an async Server Component; `CaringContactsShell` and `TemplateDetail` are Server
Components; the only client modules are `ExitOnlyOverlayTrigger` and `WorkspaceOverlayTrigger`
(`overlays/overlay-trigger.tsx:1`, `"use client"`). What crosses the boundary is `overlayId`
(string), `children` (a plain string at both call sites), and — for the mutating row — `commit`
`{ kind: "unavailable", reason: string }`. All serialisable; **no function crosses**. The
service-state incident `note` stays server-side: `serviceState` is passed to `CaringContactsShell`,
which is a Server Component. `next/dynamic` is used without `ssr: false`, the same spelling the
templates library page already uses.

**This is inspection of the source, not proof.** This repo has shipped two RSC boundary defects past
both typecheck and the full unit suite. Only `npm run build` settles it, and I did not run it — it
is the controller's gate.

---

## What I actually ran

All runs on the committed tree at `ef1fa954b`, worktree clean, `GATE_RECEIPTS=refresh`.
**No lock refusal occurred in either run** — both produced a summary line.

```
node scripts/run-vitest.mjs run --reporter=dot \
  tests/caring-contacts-template-detail.dom.test.tsx \
  tests/caring-contacts-template-detail-page.dom.test.tsx

 Test Files  2 passed (2)
      Tests  36 passed (36)
```

```
node scripts/run-vitest.mjs run --reporter=dot \
  tests/caring-contacts-interface-vocabulary.test.ts tests/caring-contacts-workspace-screens.test.ts \
  tests/route-reachability.test.ts tests/design-system-adoption.test.ts \
  tests/caring-contacts-templates-library.dom.test.tsx \
  tests/caring-contacts-overlay-trigger.dom.test.tsx tests/caring-contacts-domain-isolation.test.ts

 Test Files  7 passed (7)
      Tests  125 passed (125)
```

```
git diff --name-only 33f2106e8..ef1fa954b | xargs npx prettier --check
Checking formatting...
All matched files use Prettier code style!
```

`git cat-file -e` on `6a44f38ba`, `5cfe17983`, `f9c2b2761`, `b2e26afd5`, `ef1fa954b` — all five
resolve.

**Not run by me, and not claimed:** `npm run test:cc-guards` in full, `tsc --noEmit`, `eslint`,
`npm run build`, Playwright. No provider-backed command was run.

## Claims verified rather than relayed

| Implementer claim                                                                  | How I checked it                                                                                        | Result                                                                                                                                                             |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ExitOnlyOverlayTrigger` does not exist in this tree                               | `git grep -niE "exit.?only\|exitOnly" 33f2106e8 -- src tests`                                           | **True** — no match at the base. On the head, every match is Task 16's own.                                                                                        |
| Seven wording helpers exported from `templates-library.tsx`                        | counted the `-function`/`-const` → `+export` hunks in the diff                                          | **7**: `PATHWAY_VERSION_STATE_WORDING`, `MESSAGE_TYPE_WORDING`, `MESSAGE_TYPE_ORDER`, `heldMessageTypes`, `joinPhrases`, `publicationWording`, `retirementWording` |
| Route count moved 85 → 86                                                          | read the diff; re-derived `59 + 6 + 13 + 8` and the eight-screen enumeration                            | **Correct**, arithmetic and enumeration both                                                                                                                       |
| `27 passed (27)` for `test:cc-guards`                                              | counted the paths in the new `package.json` script                                                      | **27 paths**, consistent — but I did not run the full gate                                                                                                         |
| `message-preview` is `mutatesState: false`                                         | `definitions.ts:117`; matrix Mutation column                                                            | **True**                                                                                                                                                           |
| `commitRefusalFor(null)` → `recording-rows-only`, withheld from non-recording rows | `overlay-commits.ts:295`; `overlay-host.tsx:302` (`scope === "every-row" \|\| definition.mutatesState`) | **True** — the exit-only trigger's premise holds                                                                                                                   |
| The frozen `message-preview` copy, as quoted in the report                         | `overlays/definitions.ts:111-122`                                                                       | **Quoted correctly** (a differently-worded second copy exists in the mockup specimens; see MAJOR 2)                                                                |
| Report §"complete", all checklist items done                                       | `git grep` over `docs/codebase-index.md`                                                                | **False** — see MINOR 3                                                                                                                                            |

---

## Which `ExitOnlyOverlayTrigger` mechanism the merge should keep

Both versions exist and they are genuinely different mechanisms, not two spellings of one.

**Task 10's** (`claude/caring-contacts-plan-detail`, `overlays/exit-only-overlay-trigger.tsx`) is a
thin wrapper over `WorkspaceOverlayTrigger` that **constructs and stages a commit**:
`exitOnlyOverlayCommit(overlayId)` returns `{ kind: "record", record: closingIsTheWholeAction }`,
where `closingIsTheWholeAction` is an empty named function. Its argument is that on an exit row the
host's own `closeWorkspaceOverlay()` _is_ the whole action, so there is nothing left for the commit
to do. It reads `mutatesState` off the frozen table via `overlayDefinition` and **throws at commit
construction** for a mutating row. It exports the commit factory so a test can hold the guard
without rendering, and it records Ruling [130]: narrow `WORKSPACE_OVERLAY_DEFINITIONS`' `id` to a
literal union in `definitions.ts` and `overlayId` becomes a derived `NonMutatingOverlayId`, turning
the runtime throw into a compile error.

**Task 16's** (this branch, inside `overlays/overlay-trigger.tsx`) is a separate button that calls
`openWorkspaceOverlay(overlayId)` and **stages nothing at all**. It also reads `mutatesState` off
the frozen table via `overlayDefinition`, and **throws at render** for a mutating row. It marks
itself `data-overlay-trigger-kind="exit-only"` so a DOM test can tell the two opening routes apart.

**On the property you asked about, they are equivalent: both read `mutatesState` off the frozen
table rather than from a second list of ids, and both type `overlayId` as `string`.** A narrowed
non-mutating id union assigns freely to `string`, so **neither collides with Task 14 semantically**.
The collision is textual only — Task 16's lives in the same file Task 14 is editing.

**Recommendation: keep Task 10's file and structure, but Task 16's runtime behaviour and its
`data-` marker.** Concretely, the merged component should live in its own
`overlays/exit-only-overlay-trigger.tsx`, export a guard that is testable without rendering, carry
the Ruling [130] narrowing note, mark the button `data-overlay-trigger-kind="exit-only"`, and open
through `openWorkspaceOverlay` with **nothing staged**.

Why that split, and it is the one place the two genuinely conflict: Task 10's
`{ kind: "record", record: <empty function> }` is indistinguishable at the host from a screen that
satisfied the compiler with a no-op — which is the exact defect Ruling [87] exists to make
impossible, and Task 16's module note names it correctly. Task 16's "stage nothing" is
distinguishable: the host receives `null`, `commitRefusalFor` answers
`NO_STAGED_COMMIT_REASON / recording-rows-only`, and `overlay-host.tsx:302` withholds it from a
non-recording row, so the exit stays live _through the machinery that already exists for this case_
rather than around it. I verified that path in the source. Everything else Task 10 does better —
the separate module, the separately testable guard, and the plan for retiring the throw — should be
kept.
