# Task report — the two post-merge safety fixes (Rulings [143] and [144])

Worktree `browser-test-gate-handoff-d5c1db`, branch `claude/browser-test-gate-handoff-d5c1db` — the
merged trunk. Nothing pushed, no PR, no subagents dispatched. The untracked `1/` directory at the
worktree root was left alone and never staged; `data/outstanding-issues-snapshot.json` arrived
already modified and was likewise never staged.

|                                         |                                            |
| --------------------------------------- | ------------------------------------------ |
| Base commit (unmutated baseline #1)     | `b4889e35477870887cb51eda8ec517aa718703ff` |
| Fix One — Ruling [144], the crisis line | `ce47faf34c0a639394e0f349f935482d6df3b0f4` |
| Fix Two — Ruling [143], the lead rule   | `493ba99286106e6cd6755f705bf6f3e29e0dd8b4` |
| Report (this file)                      | see the final commit on the branch         |

Both fix SHAs were checked with `git cat-file -e <sha>^{commit}` after they were written down.

---

## What a patient would read, under every branch of the message code

This is the question the task exists to answer, so it is stated first, in full, and read out of the
built module rather than retyped — `scripts/run-vitest.mjs` was used to print
`resolvePatientVisibleMessage` for each branch on the final tree.

**Nothing is sent to anybody. There is no send path in this tree**, and `resolvePatientVisibleMessage`'s
only production callers are validation inside the plan wizard. What follows is what the code would
produce, not what anyone receives.

**Branch 1 — a preferred name is recorded, sendable, and 33 septets or fewer.** The patient would read:

> Hi Rowan, Alex from Example Aftercare Team is thinking of you. This is a one-way message. No one
> reads replies to this number. For timing changes call +61 491 570 157, 9 am-6 pm. In an emergency
> call 000. If you need to talk, Lifeline 13 11 14, any time. 13YARN 13 92 76. - Alex

(`Rowan` is the slot. `+61 491 570 157` is a reserved fictional staffed line that connects to nobody.)

**Branch 2 — no preferred name recorded (`null`, empty, or whitespace only).** Refusal
`preferred-name-not-recorded`. **No message exists at all**; the patient would read nothing.

**Branch 3 — a name carrying a character outside GSM-7 (`Zoë`).** Refusal
`preferred-name-not-sendable`, naming `ë`. No message exists.

**Branch 4 — a name costing more than 33 septets.** Refusal `preferred-name-too-long`, reporting
`septets: 34, maxSeptets: 33`. No message exists.

**Branch 5 — someone replies to the number.** They would read the automated reply:

> No one at Example Aftercare Team reads this number, and this reply is automatic. To talk to
> someone, call +61 491 570 157, 9 am-6 pm every day. In an emergency call 000. If you need to talk,
> Lifeline 13 11 14, any time. 13YARN 13 92 76.

**What changed in each of those, and only that:** the sentence
`Fictional Support Line: +61 491 570 158.` became
`If you need to talk, Lifeline 13 11 14, any time. 13YARN 13 92 76.` in branches 1 and 5. No other
word of either message moved. The refusals in branches 2–4 are unchanged in kind; branch 4's
threshold moved from 59 to 33 because the message is longer, which is arithmetic rather than a
policy change.

**I did not alter, reword, extend or shorten the owner's sentence.** It is held byte for byte, its
final full stop included, because that is the form he was shown and confirmed.

---

## Fix One — Ruling [144], the crisis line

### What changed

`src/lib/caring-contacts/message-rules.ts`

- `CRISIS_SUPPORT_CONTACT` is now the owner-authorised sentence. It carries a comment recording that
  the wording is his and not this programme's, that it is a single named exception to the standing
  rule and not a precedent, why its three framing choices are doing clinical work, and that it names
  a **real, live service** which must never enter `synthetic-contacts.ts`.
- The module header now says one value in the file is not provisional in the same sense as the rest.
- The `crisisSupportContact` field's own doc comment says the same thing where a reader of the type
  will meet it.
- The `fictionalContactMarkerPattern` doc comment had a stale premise: it justified itself on both
  messages containing `crisisSupportContact`. They no longer do. Rewritten to say what is now true —
  the marker no longer overlaps the crisis contact at all, and what still makes both messages match
  is the fictional **staffed** line.

`src/lib/caring-contacts/message-copy.ts`

- Both messages interpolate `PROVISIONAL_MESSAGE_RULES.crisisSupportContact` instead of building
  `Fictional Support Line: ${…}` by hand.
- Comments updated: the template's own header now records that two changes have been made to this
  text and both were the owner's; the A2/A3 note's "deliberately NOT touched" claim is scoped to the
  A2/A3 sentence, because the message _was_ touched later by [144]; the automated reply gains a note
  saying why it was changed too and that its budget was re-measured rather than inherited.

`src/lib/caring-contacts/synthetic-contacts.ts`

- The header comment claimed these reserved numbers let a **complete message** be shown with no
  possibility of contacting anyone. That is no longer true and the correction says so explicitly,
  names where the real crisis line lives, and forbids adding it here. It also records that
  `crisisSupportContact` in that record is now used by no patient-visible message and survives only
  as a test specimen.

### The three things that made it structural, and what each turned out to require

**1. `crisisSupportContact` is a rule, not decoration.** `message-policy.ts` lines 114 and 124 require
a first or closing message to _contain_ it. The deliberate decision taken: the rule now demands the
whole authorised sentence, final full stop included, and the copy is interpolated from the rule so
there is exactly one copy of the owner's words in `src/`. Two hand-maintained copies of a
crisis-support sentence is precisely how one of them comes to carry a wrong number.

That does create a self-reference — a test asserting the message contains the rule value would be
comparing the module with itself. The independent copy therefore lives in the test as a hardcoded
literal (`AUTHORISED_CRISIS_LINE` in `tests/caring-contacts-message-copy.test.ts`), so a reword in
`message-rules.ts` reddens a test rather than being copied silently into the assertion. M1 proves
that literal can fail.

**2. Lifeline may not live in `FICTIONAL_CONTACTS_BY_ROLE`.** It does not. It is absent from that
record and from `DESIGNATED_FICTIONAL_MOBILE_NUMBERS`, and there is a test asserting both directions:
no reserved fictional number contains either Lifeline number, and the authorised sentence contains no
reserved fictional number. M4 proves that assertion can fail.

**3. Both messages carry it, and Message B's budget was re-measured.** `AUTOMATED_REPLY_RESPONSE`
goes 210 → 236 septets, still 2 segments, 70 septets under the 306 ceiling. It has no name slot, so
that is its whole budget. Measured on the tree, not inferred from Message A.

**The specimen tell survives, verified on this tree rather than reasoned about.**
`fictionalContactMarkerPattern` still fires on both messages, because the fictional staffed line
`+61 491 570 157` remains in both. It is asserted (`…test(text)).toBe(true)`) with a negative control
beside it (the authorised sentence alone must **not** match), and both halves are mutation-proven —
M5b reddens the positive, M6 reddens the negative.

### The length arithmetic, reproduced rather than trusted

Computed from the module on the final tree, not copied from the brief:

|                                                      | Before     | After                |
| ---------------------------------------------------- | ---------- | -------------------- |
| The crisis sentence                                  | 40 septets | **66** septets       |
| Message A with the name slot empty                   | 247        | **273**              |
| Preferred-name budget (`PREFERRED_NAME_MAX_SEPTETS`) | 59         | **33**               |
| Message A with `Rowan`                               | 252        | **278** (2 segments) |
| Message B (no slot)                                  | 210        | **236** (2 segments) |
| Two-segment ceiling                                  | 306        | 306                  |

The brief's figures reproduce exactly. `PREFERRED_NAME_MAX_SEPTETS` did follow automatically, and
that is proven rather than asserted: M7 lengthens the message by one septet, and the discriminating
observation is not the red it causes but the test it leaves **green** — "caps the name at the largest
one that fits" stays green only because the derived cap moved 33 → 32 with the base. Had the cap been
a literal, that test would have failed with `expected 307 to be 306`.

33 septets is ample for a first name; `Rowan` and `Christopher` are both asserted accepted.

---

## Fix Two — Ruling [143], the lead rule

`COMMERCIAL_LEAD_PATTERN` in `src/lib/caring-contacts/message-rules.ts` now mirrors the interface
definition's three "lead" alternatives term for term:

1. `leads` (plural) refused outright, with no job-title exemption. The pattern this replaced put
   `leads?` _behind_ the job-title lookbehind, so "team leads", "clinical leads", "programme leads",
   "service leads" and "incident leads" all read as job titles. Nobody's title is plural.
2. "lead" followed by a commercial companion word, refused even when an exempting word sits
   immediately before it. That is what "clinical lead capture" and "team lead nurturing numbers"
   exploited: the exemption licensed whatever followed the word it exempted.
3. Otherwise "lead" as a whole word, exempt only after one of the five job-title qualifiers.

The companion list in (2) is not the old allowlist returning by the back door: refusal is still the
default from (1) and (3), and (2) only removes an exemption (3) would otherwise grant. M15 shows (3)
is still doing the default refusing; M13 and M14 show (1) and (2) each carry phrases the others miss.

All five genuine job titles still pass on both surfaces — `clinical programme lead`, `incident lead`,
`team lead`, `service lead`, `clinical lead`. M16 (dropping `service` from the exemption) and M17
(unwiring the override entirely) both redden the job-title case, so "these still pass" is a proven
property and not a hope.

**The durable half** is the parity block added to `tests/caring-contacts-interface-vocabulary.test.ts`
— a suite already inside `test:cc-guards`, so it runs. It holds a shared phrase corpus in three named
lists (job titles both must permit, the seven Ruling [143] measured as divergent, and commercial
phrasing neither ever allowed) and asserts the one-directional invariant: **nothing the screen refuses
may be permitted in a message.** It is deliberately not an equality between the two regexes — they
legitimately differ, since the screen list also bans scoring and reply-monitoring claims a message
could not make, and an equality pin would have to be weakened by the next correct divergence.

The message half is asked through `validateGovernedMessage`, not by testing the pattern in isolation,
because that is the surface a message actually passes through. M17 is what makes that choice
load-bearing: unwiring `prohibitedTermPatternOverrides.lead` reddens the parity block, where a pattern
tested in isolation would have stayed green.

`src/lib/caring-contacts/**` may not import a test helper, so the two definitions must remain
separate. The parity block is the only thing holding them in step, and `message-rules.ts` now says so
next to the pattern.

### Scope, stated honestly

**This is a guard weakness, not a live defect.** The patient-visible message is one provisional
constant containing none of these phrases, and nothing in this tree sends anything. The risk is
entirely prospective: the check that would catch commercial language entering a message was the one
that would have let these through.

---

## Mutation ledger

Method notes, because they bear on how much the rows are worth:

- The driver lives at a **worktree-namespaced scratchpad path**
  (`…/scratchpad/browser-test-gate-handoff-d5c1db/`) and stamps every line with the worktree name.
- Every row is validated against an **allowlist of the four files this task may mutate, and for id
  uniqueness, before any file I/O**.
- Presence is proved by **byte equality against a computed post-image**, with `expected !== before`
  asserted first and an occurrence guard (anchor present exactly once) firing before that.
- `git diff --quiet` over the allowlisted files is asserted **clean on both sides of every row**, and
  restoration is compared buffer-to-buffer.
- Both refusal shapes are matched (`DATABASE_HEAVY_RUN_ADMISSION_BUSY`, and a throw with no marker);
  **no `Tests` summary line is treated as no run**, whatever the exit code, and retried.
- Per-row runs are narrowed to the suites the row targets. The full `test:cc-guards` run at the end is
  what makes that narrowing safe.

**Driver guard controls** — each threw on its own line, and the four failure modes are distinct:

| Control                                            | Result                                                                            |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| `CTRL_ABSENT` — anchor not in the file             | refused: `anchor occurs 0 times, expected exactly 1`                              |
| `CTRL_NOOP` — anchor matches, post-image identical | refused: `post-image is byte-identical to the original — this mutates nothing`    |
| `CTRL_FOREIGN` — row naming `src/lib/rag/rag.ts`   | refused before any I/O: `file src/lib/rag/rag.ts is not in this task's allowlist` |
| `CTRL_DUPLICATE_ID` — two rows sharing an id       | refused before any I/O: `duplicate row id SAME`                                   |

**Unmutated baselines.** Baseline #1 at `b4889e354` (pre-change): `Test Files 8 passed (8) / Tests 156
passed (156)` and `Test Files 6 passed (6) / Tests 167 passed (167)` across the two affected sets.
Baseline #2, on the tree every row below was mutated from, at `493ba9928`:
`Test Files 4 passed (4) / Tests 93 passed (93)` over message-copy, message-policy,
interface-vocabulary and mockups.

**Every row ran against `493ba99286106e6cd6755f705bf6f3e29e0dd8b4`.** No row was unrun; no lock
refusal was encountered in this round.

Suites: **C** = `caring-contacts-message-copy`, **P** = `caring-contacts-message-policy`,
**V** = `caring-contacts-interface-vocabulary`, **M** = `caring-contact-mockups.dom`.

| Row | Mutation                                                                | Suites | Predicted                                                                                              | Observed                                                                                                                                                                                                                               | Verdict                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Lifeline's number `13 11 14` → `13 11 15` (length unchanged)            | C, P   | RED — the byte-for-byte pin and the policy `toBe`                                                      | RED, `Tests 4 failed \| 73 passed (77)`. `expected 'If you need to talk, Lifeline 13 11 1…' to be 'If you need to talk, Lifeline 13 11 1…'` on both.                                                                                   | **matched, and under-predicted**: the A2+A3 exact-text pin also reddened, because it holds the authorised sentence as its own literal too. Disclosed rather than relabelled.                                |
| M2  | Message A reverts to the fictional crisis line                          | C, M   | RED — "names the staffed line and crisis support" first                                                | RED, `Tests 6 failed \| 28 passed (34)`. First: `expected 'Hi Rowan, …' to contain 'If you need to talk, Lifeline 13 11 1…'`. Also `expected 247 to be 273`, `expected 252 to be 278`, and the `not.toContain` on the superseded line. | matched                                                                                                                                                                                                     |
| M3  | Message B reverts to the fictional crisis line                          | C, M   | RED — the automated-reply GSM-7 pin first, `210` vs `236`                                              | RED, `Tests 7 failed \| 27 passed (34)`. `expected { valid: true, septets: 210, …(2) } to deeply equal {…}`, then `expected 210 to be 236`.                                                                                            | matched                                                                                                                                                                                                     |
| M4  | `miraPatientMobile` changed to contain `13 11 14`                       | C      | RED — `expected true to be false` on the reserved-number check                                         | RED, `Tests 1 failed \| 25 passed (26)`, `never files the real crisis service among the reserved fictional numbers: expected true to be false`                                                                                         | matched                                                                                                                                                                                                     |
| M5a | Message A's fictional staffed line replaced by a non-reserved number    | C      | RED — `to contain '+61 491 570 157'`                                                                   | RED, `Tests 2 failed \| 24 passed (26)`, `expected 'Hi Rowan, …' to contain '+61 491 570 157'`                                                                                                                                         | matched. Written as a separate row precisely because this assertion sits **before** the marker assertion in the same case and would otherwise hide it.                                                      |
| M5b | `fictionalContactMarkerPattern` reduced to the `"Fictional"` label only | C, P   | RED — the marker assertion, `expected false to be true`                                                | RED, `Tests 5 failed \| 72 passed (77)`, `keeps both messages identifiable as non-sendable specimens: expected false to be true`                                                                                                       | matched, **under-predicted**: `rule 6: contains-patient-mobile` also reddened, because its expected issue list includes the marker issue. Disclosed.                                                        |
| M6  | `fictionalContactMarkerPattern` extended to match `Lifeline`            | C, P   | RED — the negative control, `expected true to be false`                                                | RED, `Tests 2 failed \| 75 passed (77)`, `expected true to be false` in C and `expected { valid: false, …(1) } to deeply equal { valid: true }` in P                                                                                   | matched exactly                                                                                                                                                                                             |
| M7  | One extra space in Message A (`9 am-6  pm`)                             | C      | RED `expected 274 to be 273`; **and "caps the name at the largest one that fits" must stay GREEN**     | RED, `Tests 2 failed \| 24 passed (26)`: `expected 274 to be 273` and `expected 279 to be 278`. The cap case is **not** in the failure list.                                                                                           | matched. That green is the evidence `PREFERRED_NAME_MAX_SEPTETS` is derived: a literal 33 would have failed it with `expected 307 to be 306`.                                                               |
| M8  | `PREFERRED_NAME_MAX_SEPTETS` replaced by the literal `33`               | C      | **GREEN**, deliberately                                                                                | GREEN, `Test Files 1 passed (1) / Tests 26 passed (26)`                                                                                                                                                                                | matched. Over-sensitivity control: a literal equal to today's derived value is indistinguishable while the wording is unchanged. Recorded rather than hidden — it is why M7's green half is the real proof. |
| M9  | `PREFERRED_NAME_MAX_SEPTETS` replaced by the pre-swap literal `59`      | C      | RED at name length 34, `expected 3 to be less than or equal to 2`                                      | RED, `Tests 5 failed \| 21 passed (26)`, first `expected 3 to be less than or equal to 2`, then `expected 332 to be 306`, `expected 59 to be 33`                                                                                       | matched                                                                                                                                                                                                     |
| M12 | `COMMERCIAL_LEAD_PATTERN` reverted to the pre-fix single alternative    | V, P   | RED in V only; **P must stay green**                                                                   | RED, `Test Files 1 failed \| 1 passed (2)`, `Tests 2 failed \| 57 passed (59)`. `a patient could still read "team leads": expected false to be true`; `expected [ Array(7) ] to deeply equal []`. P green.                             | matched, including the green half — which is the point: message-policy alone could never have caught this, because the pre-fix pattern is exactly what it already accepted.                                 |
| M13 | Alternative 1 (outright plural refusal) removed                         | V      | RED on `"team leads"`                                                                                  | RED, `Tests 3 failed \| 5 passed (8)`, `a patient could still read "team leads": expected false to be true`, and `expected [ Array(6) ] to deeply equal []`                                                                            | matched, **under-predicted**: `"new leads"` in the already-refused list also reddened. Disclosed.                                                                                                           |
| M14 | Alternative 2 (commercial companion list) removed                       | V      | RED on `"clinical lead capture"` — the first five are still caught by alternative 1                    | RED, `Tests 2 failed \| 6 passed (8)`, `a patient could still read "clinical lead capture": expected false to be true`, `expected [ 'clinical lead capture', …(1) ] to deeply equal []`                                                | matched exactly, including which phrase fails first                                                                                                                                                         |
| M15 | Alternative 3 (default whole-word refusal) removed                      | V, P   | RED on `"Please qualify this lead."`; P's rule 3c also red                                             | RED, `Tests 3 failed \| 56 passed (59)`, `message no longer refuses "Please qualify this lead.": expected false to be true`; P: `rejects open-ended commercial/CRM phrasing…: expected true to be false`                               | matched                                                                                                                                                                                                     |
| M16 | `service` dropped from the job-title exemption                          | V, P   | RED — over-strictness control, `message refuses the job title "Contact the service lead for details."` | RED, `Tests 2 failed \| 57 passed (59)`, exactly that message; P: `accepts every job title in the closed exemption set` red                                                                                                            | matched                                                                                                                                                                                                     |
| M17 | `lead: COMMERCIAL_LEAD_PATTERN` removed from the override map           | V, P   | RED — job titles refused; P's override-map pin `expected [] to deeply equal [ 'lead' ]`                | RED, `Tests 3 failed \| 56 passed (59)`, `message refuses the job title "Please contact the incident lead for an update.": expected true to be false`; P: `expected [] to deeply equal [ 'lead' ]`                                     | matched. This is what proves the parity helper going through `validateGovernedMessage` is load-bearing rather than convenient.                                                                              |
| M18 | The **interface** helper loses its `leads` alternative                  | V      | RED — `screen no longer refuses "team leads"`                                                          | RED, `Tests 3 failed \| 5 passed (8)`, `screen no longer refuses "team leads": expected false to be true`, plus the pre-existing B3 case                                                                                               | matched. Proves the screen-side positive controls in the parity block can themselves fail, so the comparison is not one-sided.                                                                              |
| M19 | A comment-only edit in `message-rules.ts`                               | C, V   | **GREEN**                                                                                              | GREEN, `Test Files 2 passed (2) / Tests 34 passed (34)`                                                                                                                                                                                | matched. Control that the driver's own write/restore path reddens nothing.                                                                                                                                  |

Three rows were **under-predicted** (M1, M5b, M13): each produced the predicted failure with the
predicted message, plus one further red I had not foreseen. They are recorded as under-predictions
rather than relabelled after the fact, per the standing rule that a reported wrong prediction is worth
more than a right one that was never at risk.

The tree was confirmed clean over the allowlisted files after the final row, and `git status` shows
only the two pre-existing entries.

---

## Gates

All run on the final tree, after the last edit to the code and tests they cover. Lines pasted, not
summarised; no gate is reported from an exit code alone.

**`npx tsc -p tsconfig.json --noEmit`** — read from `tsc` itself, never through a pipe (`; echo`, not
`|`), so the reported status is the compiler's own. `TSC_EXIT=0`. A bare exit code with no output is
exactly the shape a gate that never ran would have, so it was re-run with `--extendedDiagnostics` as
a positive control that it really compiled the project:

```
Files:                         4773
Total time:                  13.50s
```

**`npx eslint <the seven changed files>`**, with `node_modules/.cache/eslint` removed first so no file
could be skipped as unchanged: `ESLINT_EXIT=0`, no output.

**`npx prettier --check`** over the seven changed files plus this report: the report failed on its
first run (`Code style issues found in the above file`), was fixed with `--write`, and re-checked:
`All matched files use Prettier code style!`. The seven source and test files passed on the first
run.

**`GATE_RECEIPTS=refresh npm run test:cc-guards`** — the full guard set, once, at the end:

```
 Test Files  36 passed (36)
      Tests  810 passed (810)
   Duration  80.15s
```

(Its stderr carries `the store refused the write` and a React error-boundary trace. That is
`WorkspaceOverlays`' own deliberate failure case, not a regression — the run is green.)

**The suites the gate does not name.** `test:cc-guards` is a hand-maintained list, so I diffed the
suites it names against the Caring Contacts suites that exist and ran the relevant missing ones
explicitly — including `caring-contacts-message-copy` and `caring-contacts-message-policy`, the direct
behavioural suites of the two modules this task changed:

```
 Test Files  8 passed (8)
      Tests  189 passed (189)
```

(`message-copy`, `message-policy`, `mockups.dom`, `simulation`, `product-redesign.dom`,
`linked-routes.dom`, `prototype-state`, `api-handler`.)

**Not run, by instruction:** `npm run test`, `npm run build`, `npm run verify:ui`,
`npx playwright test`, and anything provider-backed. See concern 7 below for the one consequence of
that worth carrying forward.

---

## Concerns, and what I did not do

1. **`FICTIONAL_CONTACTS_BY_ROLE.crisisSupportContact` is now a misleading name.** It is a reserved
   fictional number, still in the frozen record and still in `DESIGNATED_FICTIONAL_MOBILE_NUMBERS`,
   but no patient-visible message uses it any more — it survives only as a test specimen. I did
   **not** rename or delete it: renaming touches eight files including the frozen-record equality
   test, and deleting an exported symbol is guarded here for good reasons. The comment now says
   plainly what it is and forbids putting it back into copy. **This is worth a controller decision,
   not a silent cleanup.**

2. **The byte-order mark on `tests/helpers/caring-contacts-prohibited-language.ts` is still there.**
   Ruling [143] said to capture it rather than fix it, since it belongs to `main`. I mutated that
   file (M18) and restored it byte-for-byte, BOM included, but did not remove it.

3. **The message-side and interface-side lead rules are still two definitions.** They must be, since
   `src/lib/caring-contacts/**` cannot import a test helper. The parity block is what holds them in
   step and it only covers the corpus it names. A phrase nobody thinks to add is still uncovered on
   both sides — that is a property of a phrase list, not something this fix could close.

4. **The self-reference I accepted deliberately.** Both messages now interpolate the crisis sentence
   from the rule, so a test asserting "the message contains the rule value" reads one source twice. I
   judged one copy of the owner's words in `src/` to be worth more than an independent second copy
   that could drift, and put the independent copy in the test instead. If the controller disagrees,
   the alternative is a second literal in `message-copy.ts` and a test asserting the two agree.

5. **`test:cc-guards` names none of the direct behavioural suites of the two modules this task
   changed.** I listed the suites the gate names and diffed them against the Caring Contacts suites
   that exist: `caring-contacts-message-copy`, `caring-contacts-message-policy`,
   `caring-contact-mockups.dom` and `caring-contacts-simulation` are all outside it, and the first
   two are the direct suites of `message-copy.ts` and `message-policy.ts`. I ran them explicitly, and
   the run is recorded above. The **parity block was deliberately placed in
   `caring-contacts-interface-vocabulary`, which _is_ inside the gate**, so the durable half of Fix
   Two runs without anyone remembering to select it. The rest of the gap is pre-existing and not mine
   to close here.

6. **Not verified by me: the two phone numbers.** A phone number cannot be checked from inside this
   repository. Ruling [144] records that the owner confirmed both. I have carried them byte for byte
   and asserted them against a literal; I have not, and cannot, dial them.

7. **Not run, deliberately:** `npm run test`, `npm run build`, `npm run verify:ui`, Playwright, and
   anything provider-backed. Those are the controller's and the brief states all four had just been
   run green on this tree. Note that both of my commits change `src/`, so those verdicts do not cover
   the current head; `tests/ui-caring-contacts-workspace.spec.ts` imports
   `EXACT_PATIENT_VISIBLE_MESSAGE` (for two `not.toContainText` assertions, which stay satisfied), so
   the Chromium journeys read the changed string and should be re-run at the merge point.
