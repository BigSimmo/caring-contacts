# Task 16 — fix round 1 report

**Branch:** `claude/caring-contacts-demo-seed` · **Worktree:** `D:\Worktrees\Database\cc-templates`
**Answers:** `docs/caring-contacts/phase-2b-sdd-archive/task-16-review.md` (base `33f2106e8`, head `ef1fa954b`).
**Status:** complete. Nothing pushed, no pull request opened, no subagent dispatched, nothing merged.

## Commits

Each SHA below was re-checked with `git cat-file -e <sha>^{commit}` after the last commit in this
round, and each resolves.

| SHA          | What it is                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `4b97b29f3`  | the sealed-domain status constant, the three failing screen assertions written against it, `docs/codebase-index.md`, Playwright |
| `6adbf8902`  | the screen change: the false sentence deleted, the status rendered — plus MINOR 4, MINOR 5, NIT 7, NIT 8                        |
| `42ebc801a`  | the leak guard M9 exposed as unable to fire, corrected                                                                          |
| _(this one)_ | this report                                                                                                                     |

HEAD before this report: `42ebc801a0932627585e0dd5cef4cab6c4659620`.

---

## MAJOR 1 — Ruling [131]: the false clinical claim is gone, and the real status is in its place

**What was on screen.** `template-detail.tsx`, in the wording card, directly beneath the two
approval seats: _"Only one patient-visible message has been approved anywhere in this system, and it
is a specimen — one approved example, its greeting and its sender name included …"_.
`message-copy.ts:4` opens `PROVISIONAL — not clinically approved`, `:15` repeats it, and `:9-10`
names the lived-experience and clinical-programme approval gate as the owner of the decision — the
same two seats `DualApprovalRecord` renders immediately above. The review's reading of this is
correct and I have not tried to rescue the sentence.

**What was done, and in the order the ruling gives.**

1. **The sentence is deleted, not reworded.** No wording of it is true; there is no shorter form of
   a false claim that becomes true. The card's remaining framing — "Read from this version's own
   record" and "Nothing below is addressed to anybody, and nothing in this workspace is ever sent to
   any number" — was already true and is unchanged, and its two existing assertions stayed green
   throughout.
2. **The wording's real status is stated where the wording is, sourced rather than retyped.**
   `src/lib/caring-contacts/message-copy.ts` now exports
   `CLINICIAN_FACING_WORDING_APPROVAL_STATUS`, and the card renders it. Nothing in the screen types
   the sentence. This is the half of the ruling that matters most for the future: the module's
   `PROVISIONAL — not clinically approved` marker is a **comment**, which no screen can read and no
   gate can check, so any screen wanting to state the status had to retype it and would have gone on
   saying "provisional" after the approval gate decided otherwise. It is now the same fact as a
   value, in the file the gate's decision will be recorded in.

   The constant is **clinician-facing chrome and is not patient-visible.** It is named so that
   nobody can mistake it for message wording, its own doc comment says so in its first line, and a
   committed assertion holds it out of both patient-visible strings (see M9 below, which is the row
   that found that assertion could not originally fire).

3. **What the status says, and the distinction the deleted sentence collapsed.** "This wording is
   provisional and has not been clinically approved. Whether it may be sent to a patient is a
   clinical decision owned by the lived-experience and clinical-programme approval gate, and that
   gate has not made it. A pathway version's recorded approvals approve the version, not these
   words." The last sentence is the one the adjacency needed: a version's dual approval is an
   approval of the **version** — its cadence, its lifecycle, its governance record — and nothing in
   this system has approved the words.

4. **It renders unconditionally**, including on a record that holds no wording at all. The danger
   the review identified was an **adjacency** — two recorded approvals, then a claim about the
   message — not a property of the wording card. A status shown only when a record happens to hold
   wording would leave that adjacency unqualified on every record that does not, so the third
   assertion below pins exactly that.

**The three assertions, and what each can go red for.** All three were written first, run against
`4b97b29f3`, and observed failing for their stated reasons before any screen change existed.

| Assertion (all in `tests/caring-contacts-template-detail.dom.test.tsx`) | Goes red when                                                                    | Proven by |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------- |
| "reads the status from the sealed domain rather than retyping it"       | the provisional status stops reaching the card                                   | M1        |
| "makes no claim of its own about approval anywhere in that card"        | the card says anything about approval that is not the sealed domain's own status | M3        |
| "never names an approval seat without stating the wording's status too" | an approval label renders on a screen where the status does not                  | M1, M2    |

The second is the one the ruling asked to be non-decaying, so it is not written around the deleted
sentence's own words. It removes the sealed status from the card's text — asserting first that the
removal really shortens the string, so the check cannot pass over a card that never had it — and
then refuses the stem `/approv/i` in everything that is left. Any new claim about approval in that
card, in any phrasing, reddens it.

A fourth assertion was added to `tests/caring-contacts-template-detail-page.dom.test.tsx`, in the
seeded case. That is the only render in either suite where all three sit together: two recorded
approvals, the provenance qualification, and the **real** `EXACT_PATIENT_VISIBLE_MESSAGE` rather
than a fixture marker. The property is asserted where it is load-bearing, not only where it is
convenient.

**Round 1's own account of the gap, for the record.** The previous report's Concerns 2 argued
against stating the wording's approval status because it would overlap the provenance qualifier.
The review's answer is right and I have not re-argued it: the screen was not silent, it made the
opposite claim, and the argument never covered the sentence that actually shipped. The two objects
are now visibly separate — the provenance qualifier is about **this record's governance provenance**
and sits in the approval card; the status is about **the words** and sits in the wording card.

---

## MAJOR 2 — Rulings [132] and [135]: recorded precisely, repaired not at all

**No frozen copy was edited and no gate was added.** Both are the owner's call, and the review is
right that a test pinning the two copies equal would be red on arrival.

**The two frozen texts for `message-preview`, both verified in this tree at `42ebc801a`:**

| Where                                                                                              | title                                       | summary                                                                                 | decision                    |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------- |
| `src/components/caring-contacts/workspace/overlays/definitions.ts:110-122` (what the host renders) | "Preview the message the patient would see" | "The wording is shown exactly as it would arrive, with every detail already filled in." | "Back to personalisation"   |
| `src/components/caring-contacts/mockups/overlay-specimens.tsx:80-92`                               | "Preview exact patient-visible message"     | "The fully substituted message is visible exactly as the patient would receive it."     | "Return to personalisation" |

`docs/caring-contacts/interaction-matrix.md:3` names the **mockup specimens** file as the source of
truth; the workspace host reads **`definitions.ts`**. The specimens row additionally carries a
`content` field the workspace row does not have at all.

**What holds the two together: nothing.** I re-read
`tests/caring-contacts-overlay-definitions.test.ts` to check the review's claim rather than relay
it. Its scan over `definitions.ts` asserts, per field, that a string is non-empty, is not `"-"`, and
does not match the prohibited-language pattern (`:203-214`), plus a separate check on
`summary + decision` for monitoring/scoring language. **No assertion compares any `summary` or
`decision` to the matrix or to the specimens.** The review's claim is confirmed as written.

`message-preview` is `mutatesState: false` in both, and the matrix's Mutation column for it reads
"No" (`interaction-matrix.md:10`, product context "Personalisation, review, templates").

**The four untrue clauses on this route** are exactly as the review states, and I re-checked the
load-bearing one against the code rather than accepting it: this route reads the service state and
one pathway version, renders `snapshot.messageTextByType[type]` verbatim through `readWording`, and
interpolates nothing — so "with every detail already filled in" describes a substitution this screen
never performs. The page suite's assertion that `getEpisode` and `listPatientNames` are never called
is the reason there is no patient here to fill anything in for.

---

## MINOR 3 — the skipped checklist item, and the claim it made false

`docs/codebase-index.md` now carries:

- the route table row for `/caring-contacts/templates/[pathwayId]` → `src/app/caring-contacts/templates/[pathwayId]/page.tsx`;
- the route in the "built so far" enumeration of workspace destinations;
- a corrected wording claim. The old sentence — "`/caring-contacts/templates` is a governance record
  viewer and shows no message wording at all" — is now stated of the **library**, with the detail
  route's opposite behaviour and its Ruling [131] status stated beside it. That is the same
  correction round 1 made inside `templates-library.tsx`'s module note and did not carry across.

**No gate catches this omission, and that is worth knowing rather than assuming.**
`scripts/check-codebase-index-coverage.mjs` (and `tests/codebase-index-coverage.test.ts` over it)
works at the granularity of top-level directory names under `src/app`, so `caring-contacts` being
present satisfies it; a nested dynamic route cannot make it red. The pre-commit hook ran
`docs:check-index` on both commits and reported "all 63 repository roots/modules/routes … are
indexed" **both before and after** this change. So this item is an undisclosed-omission fix with no
mutation available to prove it, and I am recording that rather than inventing a row for it.

---

## MINOR 4 — the assertion that could not fail, and the control that shows it

`expect(notHeldText).not.toBe(notPermittedText)` compared two `group.textContent` values that
**include** the group's heading, and the two headings are distinct literals — so the values could
never be equal, whatever happened to the paragraphs. Fixed by comparing bodies with the heading
paragraph excluded (`bodyOfEmptyState`, which drops the paragraph whose text equals the group's
`aria-label`), with a non-empty control on each side so a render producing no body fails saying so
rather than comparing two empty strings.

The review's proposed mutation was "make `not-held`'s `explanation` byte-identical to
`not-permitted`'s `because`". I checked that first and it does **not** reach the assertion: the
`not-permitted` branch renders "Why: " and "What changes it: " labels around its prose, so the two
bodies still differ. The mutation that actually collapses the two states is **M4**: render the
`not-held` branch through the `not-permitted` shape with that branch's own `because` and
`changedBy`, keeping its distinct heading. That makes the two bodies byte-identical while the
headings stay different — precisely the case the old assertion was blind to.

**M4 and M4+M4_PRE together are the demonstration**, and the difference between them is the whole
point: the same collapse reddens the fixed assertion at its own line, and leaves the pre-fix
assertion green, moving the failure down to the `toContain` line the review already identified as
"the teeth".

---

## MINOR 5 — counts replaced by the property they count

`overlays/overlay-trigger.tsx`'s new JSDoc named overlay-row counts five times, none of them beside
the table that holds them. All five now name the property:

- "the EIGHT overlays that record nothing" → "an overlay whose frozen row records nothing";
- "sixteen of the twenty-four rows confirm something" → "the rows that confirm something";
- "The other eight carry `mutatesState: false`" → "The rest carry `mutatesState: false`";
- "already proves for all eight rows" → "for every row that records nothing";
- "the two `recovery-only` rows" → "a `recovery-only` row";
- "A union narrowed to the eight ids" → "A union narrowed to the non-recording ids".

The review named only the first. I fixed all of them because they are the same decaying form in the
same block, written by the same round; leaving four of five would have been a fix that reads as
though the class had been handled.

**Not changed:** the two `throw` messages in that file that say "The 24 rows are frozen in
`overlays/definitions.ts`". Those are runtime strings a person reads when a trigger names an unknown
id, one of them pre-existing and copied into the new component. The count sits directly beside the
name of the file that holds the rows, which is the acceptable form, and changing a thrown message is
a behaviour change I did not want to fold into a comment fix. Recorded rather than done silently.

---

## MINOR 6 — the Playwright selector, fixed but NOT run

`page.getByRole("heading", { name })` matches case-insensitively **as a substring** unless
`exact: true` is passed, so `"Template"` was satisfiable by the templates library's `"Templates"`
h1. `exact: true` is now passed in three places: the shared `openWorkspace` helper (line 250) and
the two direct assertions in the `caring-contacts template detail` block (1027, 1134).

**The blast radius is wider than the finding, and I checked it before widening it.** `openWorkspace`
is shared by every workspace block, so making it exact changes seven other screens' identity
assertions too. Every screen's `h1` is its page's `title` prop rendered verbatim
(`shell.tsx:343` renders `{title}`), and I read all eight `title=` values: `Today`, `Patients`,
`Patient`, `New plan`, `Templates`, `Template`, `Guidance`, `Reports` — each byte-equal to its
`WORKSPACE_SCREENS.heading`. So exact matching is what those headings already meant. It is
nonetheless a stricter matcher applied to blocks I did not run.

**This block has still never been executed, by me or by anyone.** Playwright is the controller's
gate; I neither ran it nor started a server. The adoption contract's `unverifiedProofNote` still
carries that statement.

---

## NIT 7 — the forced-colours proxy now examines every border token

`[class*='border-[color:var(--border)]']` selected one token, so a surface drawn with
`--border-strong` matched neither the selector nor the check and was silently unexamined. The
selector is now `[class*='border-[color:var(--']`, the prefix every border token shares. The
vacuity guard on each scenario is unchanged.

**M6 and M6+M6_PRE are the pair that shows this was a real hole rather than a tidy-up**: the same
mutation — every card drawn with `--border-strong` and no `forced-colors` fallback — is caught by
the broadened selector and passes completely unnoticed under the old one.

## NIT 8 — the poison-pill prop is documented

`TemplateDetailView`'s `not-held` member carries `pathwayId`, which the branch rendering it never
reads. The union now carries a doc comment saying that this is deliberate, that it must not be
"wired up", and why: it is what lets the reflection case push a poisoned identifier through the real
prop the page supplies. Removing the field would leave that guard asserting the absence of a value
the component was never given.

---

## Mutation ledger

**Baseline.** Every row ran against the committed tree at `6adbf8902` (rows M1–M9 of pass 1) or
`42ebc801a` (pass 2), worktree clean on both sides of every row — `git status --porcelain` is
printed by the driver before the apply and after the restore, and the runner refuses to continue if
it is not empty. The **unmutated** verdict on the pass-2 tree, run immediately before M9 and M1 were
re-run, was `Test Files 3 passed (3) / Tests 52 passed (52)`.

**Presence.** Every applied row is proved present by **byte equality against a computed post-image**,
with the post-image asserted different from the original _first_. Two guards, two failure modes, and
each has its own positive control that was made to throw on its own line:

| Control       | What it proves the driver catches                      | Observed                                                                                                              |
| ------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `CTRL_NOOP`   | a mutation that matches its anchor and changes nothing | `Error: CTRL_NOOP: NO-OP GUARD -- the computed post-image equals the original for anchor: export const CLINICIAN_FA…` |
| `CTRL_ABSENT` | an absent (or ambiguous) anchor, before any file I/O   | `Error: CTRL_ABSENT: OCCURRENCE GUARD -- anchor occurs 0 times, expected exactly 1: THIS_ANCHOR_IS_NOT_IN_THE_FILE…`  |

Neither wrote to disk. The driver also validates every row against an allowlist of the three files
this round may mutate **before** any read, and asserts row-id uniqueness. It lives at a path
namespaced by this worktree.

**Selection.** Recorded per row, because a per-suite red must never be read as a full-set red.
`DOM` = `tests/caring-contacts-template-detail.dom.test.tsx`, `PAGE` =
`tests/caring-contacts-template-detail-page.dom.test.tsx`, `COPY` =
`tests/caring-contacts-message-copy.test.ts`.

| Row                                            | Mutation                                                                  | Selection         | Predicted                         | Observed                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------- | ----------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **M1**                                         | the sealed status emptied out of the wording card                         | DOM + PAGE        | RED, 4 failed                     | RED. `Test Files 2 failed (2) / Tests 4 failed \| 35 passed (39)`. `Expected element to have text content:` at `…-detail.dom.test.tsx:377` and `…-page.dom.test.tsx:303`; `expected 'Message wording this record holdsRead…' to contain 'This wording is provisional and has n…'`; and the seat/status loop at scenario 1. **Matched.**                |
| **M2**                                         | the status made conditional on the record holding wording                 | DOM               | RED, 1 failed                     | RED. `Tests 1 failed \| 28 passed (29)`. `a version holding no wording at all names an approval seat with no status for the wording: expected 'Back to every governed versionGoverne…' to contain 'This wording is provisional and has n…'`. **Matched**, including which scenario fired.                                                              |
| **M3**                                         | the deleted false claim restored to the card                              | DOM               | RED, 1 failed                     | RED. `Tests 1 failed \| 28 passed (29)`. `the wording card makes its own claim about approval: expected 'Message wording this record holdsRead…' not to match /approv/i`. **Matched.**                                                                                                                                                                 |
| **M4**                                         | `not-held` collapsed onto `not-permitted`'s body, distinct heading kept   | DOM               | RED, 1 failed                     | RED, on attempt 3 after two lock refusals. `Tests 1 failed \| 28 passed (29)`. `expected 'Why: Reading a pathway version\'s con…' not to be 'Why: Reading a pathway version\'s con…' // Object.is equality`. **Matched.**                                                                                                                              |
| **M4+M4_PRE**                                  | the same collapse, with the MINOR 4 fix reverted (control)                | DOM               | RED at a DIFFERENT assertion      | RED. `Tests 1 failed \| 28 passed (29)`, but at `expected 'No governed version with this identif…' to contain 'looks exactly the same here'`. The pre-fix `not.toBe` stayed **green** under a mutation that made the two bodies identical. **Matched** — this is the row that shows the old assertion could not fail as its comment claimed.           |
| **M6**                                         | every card given a `--border-strong` edge with no forced-colours fallback | DOM               | RED, 1 failed                     | RED. `Tests 1 failed \| 28 passed (29)`. `a current version with its wording and its preview control: DIV draws a border with no forced-colors fallback: expected 'min-w-0 rounded-[var(--radius-lg)] bo…' to match /forced-colors:border/`. **Matched.**                                                                                              |
| **M6+M6_PRE**                                  | the same mutation, with the NIT 7 selector reverted (control)             | DOM               | **GREEN**                         | **GREEN.** `Test Files 1 passed (1) / Tests 29 passed (29)`. The narrow selector cannot see a `--border-strong` surface at all. **Matched** — a green is the evidence here, and it is what makes NIT 7 a real hole rather than a preference.                                                                                                           |
| **M8**                                         | the status softened to "under review"                                     | COPY + DOM + PAGE | RED in COPY only                  | RED. `Test Files 1 failed \| 2 passed (3) / Tests 1 failed \| 51 passed (52)`. `expected 'This wording is under review. Whether…' to contain 'has not been clinically approved'`. DOM and PAGE **green**, as predicted: they compare the rendered text against the same constant, which is exactly why the domain-level pin has to exist. **Matched.** |
| **M9** (pass 1)                                | the status's first sentence leaked into `AUTOMATED_REPLY_RESPONSE`        | COPY              | RED, ≥4 failed, target among them | RED, `Tests 3 failed \| 10 passed (13)` — **and the target assertion was NOT among them.** Under-predicted; see below.                                                                                                                                                                                                                                 |
| **M9** (pass 2, after the guard was corrected) | the same leak                                                             | COPY              | RED, target among them            | RED. `Tests 4 failed \| 9 passed (13)`, and the target now fires: `expected 'This wording is provisional and has n…' not to contain 'clinically approved'` at `caring-contacts-message-copy.test.ts:84`.                                                                                                                                               |

### The one wrong prediction, reported rather than relabelled

**M9 pass 1 found a defect in my own assertion, not in the code.** The leak guard I had written read
`expect(text).not.toContain("not clinically approved")`. The status says "has **not been** clinically
approved" — "been" sits between the two halves — so that substring **never occurs in the value the
guard is about**, and a partial leak of the status into a patient-visible string passed the guard
written to catch exactly that. Three other pins on that constant went red (the GSM-7 septet pin, the
exact-text pin, the two-segment ceiling), which is what made it look like a successful row until I
read the failure list rather than the count.

The guard now asserts that each phrase it forbids **is** a substring of the status before forbidding
it in the messages, so it cannot drift away from the value again. That correction is `42ebc801a`,
and M9 was re-run against it in pass 2 with a fresh unmutated baseline first.

This is also why M9 is recorded as two rows rather than one improved row: the first attempt is the
evidence that the guard was inert, and deleting it would delete the finding.

### Checks I did not mutate, and why

- **MINOR 3** (`docs/codebase-index.md`): no gate reads a nested dynamic route out of that file — see
  the MINOR 3 section. There is no assertion to redden, so there is no honest row.
- **MINOR 5** (`overlay-trigger.tsx` JSDoc) and **NIT 8** (the union's doc comment): comments. No
  assertion reads either, so no mutation of them can produce evidence.
- **MINOR 6** (`exact: true`): Playwright, which is the controller's gate. Not run, so not mutated.

---

## Gates

All runs `GATE_RECEIPTS=refresh`, in this worktree, against `42ebc801a`.

```
npm run test:cc-guards          (ran on attempt 5, after 4 lock refusals)
 Test Files  27 passed (27)
      Tests  569 passed (569)
   Duration  294.26s
```

**The gate names its suites by hand, so I diffed it before trusting it.** `test:cc-guards` names 27
paths; 61 caring-contacts suites exist on disk, so 36 are named by no gate — among them
`caring-contacts-message-copy`, `caring-contacts-message-policy` and `caring-contacts-overlay-host`,
which cover the two modules this round changed outside `template-detail.tsx`. Run separately:

```
node scripts/run-vitest.mjs run --reporter=dot \
  tests/caring-contacts-message-copy.test.ts \
  tests/caring-contacts-message-policy.test.ts \
  tests/caring-contacts-overlay-host.dom.test.tsx

 Test Files  3 passed (3)
      Tests  77 passed (77)
```

```
npx tsc -p tsconfig.json --noEmit
(no output; exit 0)
```

```
rm -rf node_modules/.cache/eslint
npx eslint src/components/caring-contacts/workspace/template-detail.tsx \
  src/components/caring-contacts/workspace/overlays/overlay-trigger.tsx \
  src/lib/caring-contacts/message-copy.ts \
  tests/caring-contacts-template-detail.dom.test.tsx \
  tests/caring-contacts-template-detail-page.dom.test.tsx \
  tests/caring-contacts-message-copy.test.ts \
  tests/ui-caring-contacts-workspace.spec.ts
(no output; exit 0)
```

```
git diff --name-only 79ce79dc4..HEAD | xargs npx prettier --check
Checking formatting...
All matched files use Prettier code style!
```

**Lock refusals, recorded as UNRUN rather than absorbed.** The first attempt at the red baseline was
refused 19 consecutive times over about 20 minutes behind another worktree's Playwright lease
(`D:\Worktrees\Database\pr-2390-fix`, `ui-ward-roles.spec.ts`) and was then killed by a tool timeout,
printing `[exited with code 0]` with nothing having run — the exact shape the discipline names, and
the reason nothing in this report is claimed from an exit code. It was re-run to a real summary line.
Further refusals: M4 (2), `test:cc-guards` (4). No lease was ever forced.

**Not run, and not claimed:** `npm run test` in full, `npm run build`, Playwright, and anything
provider-backed. The Server/Client boundary of this screen is unchanged by this round; it remains
inspected rather than proved, and only `npm run build` settles it.

**Re-verification after the final edit.** The gate lines above were produced on the tree at
`42ebc801a`, and this report is the only thing added afterwards — so that verdict does not cover the
tree as committed. `test:cc-guards` was therefore re-run on the tree **carrying this file, including
this paragraph**:

```
npm run test:cc-guards
 Test Files  27 passed (27)
      Tests  569 passed (569)
```

Deliberately quoted without its attempt count or duration: those differ between runs (the observed
runs took 294s and about 72s, on a busy and a quiet machine), and a note that quoted them would be
false of the next run of the same tree while the counts it is actually about stayed identical. The
re-run is the mechanism here, not the ordering — "run it last" would not have covered a file added
after the run, which is exactly the shape that cost an earlier task two rounds.

---

## Concerns

1. **The status is now correct and its future is a two-place problem I have reduced but not
   closed.** `message-copy.ts` holds the status as a value, so a screen cannot contradict it. But the
   module's own `PROVISIONAL — not clinically approved` **comments** at `:4` and `:15` are still
   comments, and nothing makes them agree with the constant. If the approval gate decides and someone
   updates only the comments, the screen keeps saying "provisional"; if they update only the constant,
   the module keeps saying it is not approved. A small pin — the constant's claim and the comment
   marker asserted consistent — would close it, but it is a design decision about how that eventual
   approval is recorded (a boolean? a dated record? per-message?), which is the owner's, so I have not
   invented a shape for it.

2. **Task P is landing a first-name slot in this same constant's neighbourhood.** This round added an
   export to `message-copy.ts` while another worktree (`cc-message-name`) was running that file's own
   suite. Nothing conflicts on disk — separate branches — but the two changes meet at merge, and the
   status sentence I added says nothing about slots, so it should survive a slot landing unchanged. The
   thing to check at merge is that both edits to `message-copy.ts` are present, not one.

3. **MAJOR 2 is recorded and untouched, and it is now six conflicts with a seventh property.** The
   `message-preview` row exists twice, in two different wordings, and the matrix names as source of
   truth the copy the product does **not** render. Nothing holds them together. Whatever the owner
   decides about the four untrue clauses, the divergence itself is a separate defect: a consolidation
   that fixes `definitions.ts` alone leaves the matrix pointing at a third text.

4. **The `exact: true` change reaches seven blocks I could not run.** I verified every `h1` against its
   declared heading by reading the eight `title=` props, so I believe it is safe, but "verified from the
   source" is not "observed in a browser", and Playwright is the controller's gate.

5. **An untracked `1/` directory sits in this worktree** (a Node compile cache: `1/v24.19.0-x64-…`).
   It is **not** mine — it exists in `D:\Worktrees\Database\cc-plan-detail` too and predates my first
   command here — and it is not in `.gitignore`, so it shows in every `git status`. Nothing in this
   round staged it. Worth someone deciding whether it should be ignored, because it is one careless
   `git add -A` away from being committed, and this programme has already lost a round to a wildcard
   stage.

6. **MINOR 3's class of defect has no gate.** The codebase-index coverage check cannot see a nested
   dynamic route, so "did you document the route?" remains a checklist item held by people. The next
   dynamic route added under an already-indexed directory will be able to skip it just as silently.
