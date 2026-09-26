# Task 21 — the responsive and accessibility proof, per screen and per condition

Run on the merged tree, per Ruling [133]. Branch `claude/browser-test-gate-handoff-d5c1db`, from
`b824f4f98`. The spec commits, in order, are `8fb2c5d79`, `7b2cbc2f3`, `d3015f4e2` and
`679d5749e`; this report and its corrections follow them and change no code. Nothing was pushed and
no pull request was opened.

**The result in one line:** every screen × condition cell now names the `file:line` that proves it,
and all forty-five are proved — but each is proved on the state this server can reach, which for six
of the nine screens is an empty or statement state rather than a populated screen. That limit is the
one thing in this report worth reading twice, and it is set out in full below rather than left in a
column.

---

## 1. What was already covered, before this task

The brief asked for this inventory first, and it turned out to be half the work: the four Phase 2B
branches each proved their own screen as it landed, so what they add up to is per-screen rather than
uniform, and the shape of the shortfall was not visible until the branches were merged and could be
read together. Measured by reading every block in `tests/ui-caring-contacts-workspace.spec.ts`.

| Screen           | 320–1440 widths  | Dark    | Forced colours | Reduced motion | 400% reflow |
| ---------------- | ---------------- | ------- | -------------- | -------------- | ----------- |
| Today            | `:387` all six   | `:435`  | `:455`         | —              | `:1851`     |
| Patients         | `:542` 320 only  | `:559`  | `:591`         | —              | —           |
| Patient overview | `:674` 320 only  | `:690`  | `:718`         | —              | —           |
| New plan         | `:792` 320 only  | `:808`  | `:834`         | —              | —           |
| Schedule         | `:921` 320 only  | `:937`  | `:963`         | —              | —           |
| Templates        | `:1099` 320 only | `:1118` | `:1144`        | —              | —           |
| Template detail  | `:1249` 320 only | `:1266` | `:1292`        | —              | —           |
| Guidance         | `:2699` 320 only | **—**   | **—**          | —              | —           |
| Reports          | `:2699` 320 only | `:2709` | `:2731`        | —              | —           |

Of the forty-five cells, **eighteen were fully proved** (Today's width sweep, eight dark, eight
forced colours, Today's reflow), **eight were partially proved** — a width cell holding 320px alone
while `rail`, `split` and `wide` went unobserved — and **nineteen were not proved at all**.

Three of those gaps are worth naming rather than counting:

- **Guidance had neither dark nor forced colours.** Its block, `caring-contacts guidance and
reports`, covers two screens, and both of those tests name `REPORTS_SCREEN`. The block's name reads
  as though it covered both; it did not. That is the failure the file's own header warns about — a
  declaration certifying a route it never inspected in that mode.
- **Reduced motion was asserted nowhere in the file, on any screen.** This is the one most easily
  misread as covered, because `playwright.config.ts` sets `contextOptions: { reducedMotion: "reduce" }`
  suite-wide: every test in the file already RAN under the preference. That proves the screens render
  under it and says nothing about whether motion was suppressed, because no assertion anywhere read a
  duration or a transition property. A screen could have animated straight through a reduce request
  with every gate green.
- **400% reflow was proved on Today only.** The brief guessed this would be the condition least
  likely to be covered already, and for eight of the nine screens it was right.

---

## 2. The table

Line numbers are as at `679d5749e`. Three of the columns resolve to a single line because the block
is parameterised over `WORKSPACE_SCREENS` — the screen's name is in the test title, so a failure
still names the screen. That parameterisation is the fix the array's own note in the spec had filed
as its own work; it means a screen added to the surface is swept, reflowed and probed the moment it
is added, rather than when someone remembers.

All lines are in `tests/ui-caring-contacts-workspace.spec.ts`.

| Screen           | 320–1440 widths       | Dark              | Forced colours    | Reduced motion | 400% reflow            |
| ---------------- | --------------------- | ----------------- | ----------------- | -------------- | ---------------------- |
| Today            | `:1928` (also `:387`) | `:435`            | `:455`            | `:2105`        | `:1977` (also `:1851`) |
| Patients         | `:1928`               | `:559`            | `:591`            | `:2105`        | `:1977`                |
| Patient overview | `:1928`               | `:690`            | `:718`            | `:2105`        | `:1977`                |
| New plan         | `:1928`               | `:808`            | `:834`            | `:2105`        | `:1977`                |
| Schedule         | `:1928`               | `:937`            | `:963`            | `:2105`        | `:1977`                |
| Templates        | `:1928`               | `:1118`           | `:1144`           | `:2105`        | `:1977`                |
| Template detail  | `:1928`               | `:1266`           | `:1292`           | `:2105`        | `:1977`                |
| Guidance         | `:1928`               | **`:2230` (new)** | **`:2255` (new)** | `:2105`        | `:1977`                |
| Reports          | `:1928`               | `:2709`           | `:2731`           | `:2105`        | `:1977`                |

**Forty-five of forty-five cells proved; none gapped**, subject to §3. One row sits outside the
grid because it is not a screen: **the overlay surfaces under a reduced-motion preference, `:2165`**,
all twenty-four rows at both matrix widths. It is there because the screens have almost no motion of
their own and the overlay surface has all of it — the shared `Sheet` carries `animate-sheet-up`,
`animate-pop-in`, `animate-dialog-rise` and an `animate-overlay-in` backdrop. A reduced-motion proof
that never opened an overlay would have reported on the surface with no animation and said nothing
about the one with four.

What each condition now asserts:

- **Widths** — no horizontal spill; exactly one width-state marker displayed and it is the one
  `widthStateFor()` names; and the dock/rail exchange at `WORKSPACE_WIDTH_BREAKPOINTS.rail`. Driven
  by `REVIEW_WIDTHS`, so the frozen 320/390/430/768/1024/1440 set is swept without a copy of those
  numbers in the assertion.
- **Dark** — the screen's OWN surface, border and ink change between the two schemes, not only the
  shell chrome, which is identical on every route and would otherwise claim the category on a screen
  it had not inspected.
- **Forced colours** — the words that carried the meaning survive the tint being dropped, and the
  panel keeps a delimiting border.
- **Reduced motion** — nothing on the page carries a perceptible transition or animation under the
  preference, with a per-screen positive control proving something does move without it.
- **400% reflow** — WCAG 1.4.10, emulated as a 320×200 layout viewport (1280×800 ÷ 4, the same
  equivalence `ui-smoke.spec.ts` uses for 200%): no horizontal spill, the frozen mapping really did
  drop to `compact`, navigation reflowed with the page, and the synthetic marker survived.

---

## 3. What each cell is proved ON, which is the limit that matters

Every cell above is proved against a real production state, in a real browser. For six of the nine
screens that state is the screen's empty or statement state, because the isolated Playwright server
holds no records: `demoSeedRequested()` excludes it unless `CARING_CONTACTS_DEMO_SEED=on`.

| Screen           | What is on the page when these assertions run                                         |
| ---------------- | ------------------------------------------------------------------------------------- |
| Today            | The whole screen. Fixed text, nothing to populate.                                    |
| Patients         | The empty caseload, "No patients yet", plus the state filter chips. **No rows.**      |
| Patient overview | "No plan for this patient" and its way back. **No plan, no schedule, no chooser.**    |
| New plan         | "No referral named". **The wizard's client boundary does not mount at all** (`:778`). |
| Schedule         | The seven-day strip, and "No contacts in these days". **No contacts, no windows.**    |
| Templates        | The lifecycle filter chips, and "No governed versions yet". **No rows.**              |
| Template detail  | "No governed version with this identifier", and its way back. **No record.**          |
| Guidance         | The whole screen. Fixed text, nothing to populate.                                    |
| Reports          | The reach section in full; the operational measures over an empty store.              |

So the populated bodies of six screens — the caseload rows, a plan's schedule, the four activation
stages, a populated day, a version's governance record — **have no browser responsive or accessibility
proof at all.** They are proved offline in jsdom DOM suites, which cannot measure geometry, cannot
resolve a colour, and have no notion of a media query, so those suites cannot close any of these five
conditions.

**The seed was deliberately not turned on**, and not only because the brief forbids it: `emptyStateColours`
THROWS when the empty state is absent, so seeding this server would fail existing tests rather than
change what they sample, and it would delete the empty-state observations several blocks exist for.
Closing this gap needs a **second server instance carrying the seed**, with its own blocks, which is a
piece of work rather than a flag. **Recorded as the principal residual of this task.**

### Unreachable in a browser walk, and correctly so

Task 20 recorded three wired controls behind states the demonstration cannot produce, and this task
confirms the consequence rather than working around it:

| Overlay                    | Control                    | Why a browser walk cannot reach it                                |
| -------------------------- | -------------------------- | ----------------------------------------------------------------- |
| `delivery-detail`          | `patient-overview.tsx:825` | Renders only where `contactSendability(state) === "alreadySent"`. |
| `resolve-failed-delivery`  | `schedule-screen.tsx:936`  | Renders only where `needsOperationalReview(state)` is true.       |
| `template-changed-retired` | `template-detail.tsx:514`  | Renders only on a retired pathway version.                        |

No route advances a contact past `scheduled`, and no control retires a version. Each condition is the
right one: loosening any of them to reach the surface would offer a carrier's report for a message
that was never sent, which is the defect rather than the proof. **These three are recorded as
unreachable-in-browser-through-their-control, not as covered.** The overlays themselves are proved at
their frozen modality and geometry by `caring-contacts workspace overlays` (`:1564`), which deep-links
all twenty-four, and now under reduced motion at `:2165`.

---

## 4. Findings for the controller

**F1 — the app's reduced-motion guarantee is one global CSS rule, and the ~164 `motion-reduce:` call
sites are not what carries it.** Measured, and it contradicts what the components look like they are
doing. `globals.css` suppresses motion with a universal rule under `prefers-reduced-motion: reduce`:
`html:not([data-motion="full"]) *, …::before, …::after { transition-duration: 0.01ms !important;
animation-duration: 0.01ms !important; animation-iteration-count: 1 !important }`. Two mutations
separate the layers:

- **M6** removed `motion-reduce:transition-none` from the shell's rail item class — **green**. The
  universal clamp still held every duration below perceptibility.
- **M13** removed the clamp's `transition-duration` line and left the component variant in place —
  **red**, listing twenty-three interactive elements on Today still transitioning under the
  preference, the rail links among them.

So the clamp is sufficient and the component variant is not. **Why the variant is not sufficient is
unexplained and worth one look**: `motion-reduce:transition-none` should set `transition-property:
none` on those very elements, which would exclude them from the probe. It does not appear to. I did
not chase it because it is a whole-app question rather than a Caring Contacts one, but a great deal of
this repository is written as though those variants were the mechanism.

**F2 — motion in this workspace is app-wide and element-typed, not component-scoped.** `globals.css`
gives every `button, a, summary` a `transition-duration: var(--duration-fast)` over colour,
background, border, opacity, shadow and transform. **M7** stripped `transition-colors` from the rail
item class expecting the reduced-motion positive control to collapse; it stayed satisfied on every
screen. Only removing both (**M18**) falsifies it. This is recorded because it was a wrong prediction
of mine that the round corrected, and because the same assumption — "this component's classes are its
motion" — would mislead anyone reasoning about motion here.

**F3 — a reused Playwright build root produced false reds, and mutation evidence built on one cannot
be trusted.** `run-playwright.mjs` accepts `PLAYWRIGHT_BUILD_ROOT_ID` + `PLAYWRIGHT_KEEP_BUILD_ROOT`
to reuse a build directory, which cuts a 3-minute build to about one. Rounds 1–3 used it. Two
mutations touching **disjoint files** — one only `globals.css`, one only `sheet.tsx` — returned
**byte-identical** 26-element failure lists, which is not something two unrelated changes do. Re-run
on fresh roots, **both are green** (M17a, M17b). The whole table was therefore re-run on fresh roots
and only the fresh verdicts are recorded in §5. Every other row's fresh verdict matched its reused-root
verdict, so the corruption looks confined — but "looks confined" is not a basis for keeping the rest,
and it was cheaper to re-run than to argue. **Recommendation: do not use the kept build root for
mutation testing.**

**F4 — a Tailwind arbitrary-value utility can be a mutation that changes nothing.** Two attempts to
make the width sweep's overflow assertion fail — adding `md:min-w-[1600px]` to Guidance's grid, then
dropping the `min-w-0` beside it — both left it green, and both are worthless as evidence: neither
moved the layout. An inline `style={{ minWidth: 3000 }}` reddens it immediately. An earlier draft of
this report and of a code comment read the first green as proof that `documentOverflow` cannot see a
spill through `overflow-x: clip`; **that claim is withdrawn** (`679d5749e`), and whether the narrower
helper could see it remains untested.

**F5 — a generated file oscillated under this task, and the tree ends clean.**
`data/outstanding-issues-snapshot.json` was clean at session start, appeared modified partway through
the browser-gate runs — `pending` 47 → 36, eleven inbox request entries dropped — and is clean again
at `5ebdd4265`. It is regenerated by `prebuild` → `snapshot:issues`, which several runs here invoke.
Nothing in this task touched the issues inbox, and nothing of it was committed. It is recorded only so
that a later reader who sees the same file move mid-run knows it has been seen and is not this task's:
**the shipping tree carries no change to it**, and the only uncommitted thing left is the untracked
`1/` directory the brief said to leave alone.

**F6 — the file's per-screen blocks still use `documentOverflow` and the new blocks use
`layoutOverflow`.** The two are not the same measure: `layoutOverflow` takes the larger of
`documentElement.scrollWidth` and `body.scrollWidth` against `documentElement.clientWidth`, and both
of those elements carry `overflow-x: clip` in `globals.css`. The new blocks use the wider measure and
it is proved falsifiable (M1c). Whether the narrower one is equally sensitive is unknown — see F4. It
is one experiment to settle, and it is not this task's to change other tasks' assertions.

---

## 5. Mutation ledger

Every row below ran on a **fresh** Playwright build root, for the reason in F3. Rows are listed
individually, greens included. Each was applied by a driver that validates its whole table against an
allowlist of the six files this task may mutate **before any file I/O**, asserts id uniqueness,
asserts the worktree it is running in, checks each anchor occurs exactly once, asserts the computed
post-image differs from the original, writes it, re-reads from disk, asserts byte equality, restores
with `git checkout` over the allowlist, and asserts the allowlisted paths are clean on both sides.
Selection is named per row; the full suite ran unmutated at the end.

| ID            | What it changed                                                              | Predicted                                     | Observed                                                                                                                    | Verdict                      |
| ------------- | ---------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `CTRL_NOOP`   | replacement equals the anchor                                                | the driver refuses                            | `REFUSED — the post-image equals the original`                                                                              | Guard fired                  |
| `CTRL_ABSENT` | anchor not in the file                                                       | the driver refuses                            | `REFUSED — anchor occurs 0 times in …/shell.tsx`                                                                            | Guard fired                  |
| `M1c`         | inline `style={{ minWidth: 3000 }}` on Guidance's grid                       | width sweep red on the overflow assertion     | `1 failed`; `Error: horizontal overflow on Guidance at 320px`                                                               | RED as predicted             |
| `M2`          | rail width-state marker's media range widened to `< 1440px`                  | two markers displayed at 1024                 | `1 failed`; `width state on Today at 1024px`, `Received + 1`, `["rail", "split"]` against `["split"]`                       | RED as predicted             |
| `M3`          | the rail's `md:flex` becomes `lg:flex`                                       | rail/dock exchange red at 768                 | `1 failed`; `Today at 768px: the rail does not own navigation`, `unexpected value "hidden"`                                 | RED as predicted             |
| `M4`          | `min-w-[900px]` on Guidance's grid, `min-w-0` dropped                        | reflow red on the overflow assertion          | `1 failed`; `Error: horizontal overflow at the 400% zoom equivalent on Guidance`                                            | RED as predicted             |
| `M5`          | `WORKSPACE_WIDTH_BREAKPOINTS.rail` 768 → 300                                 | reflow red on the width-state assertion       | `1 failed`; `Error: width state at the 400% zoom equivalent on Today`                                                       | RED as predicted             |
| `M12`         | the phone dock's `md:hidden` becomes `hidden`                                | reflow red on the dock assertion              | `1 failed`; `Error: Today: no navigation reflowed with the page`                                                            | RED as predicted             |
| `M7`          | `transition-colors` removed from the rail item class                         | **RED** — positive control collapses on Today | `2 passed` — **prediction wrong.** Every `button, a, summary` is transitioned app-wide, so the rail is not its source       | GREEN — see F2               |
| `M6`          | `motion-reduce:transition-none` removed from the rail item class             | GREEN — the universal clamp still holds       | `1 passed`                                                                                                                  | GREEN as predicted           |
| `M13`         | the universal reduced-motion `transition-duration` clamp deleted             | **GREEN** — the component variant holds it    | `1 failed`; `Today: still moving under a reduced-motion preference`, 23 elements — **prediction wrong**, see F1             | RED — see F1                 |
| `M15`         | both of the above together                                                   | RED on every screen and both overlay tests    | `11 failed` — nine screens plus both overlay widths                                                                         | RED as predicted             |
| `M18`         | `transition-colors` removed AND the app-wide `button, a, summary` transition | RED — the positive control has nothing left   | `1 failed`; `Today: nothing on this screen moves even without a reduced-motion preference…`; `Expected: > 0`, `Received: 0` | RED as predicted             |
| `M17a`        | the universal reduced-motion `animation-duration` clamp deleted              | RED on the overlay block                      | `2 passed` — the transition clamp and the `motion-safe:` gates still hold it                                                | GREEN — prediction wrong     |
| `M17b`        | the Sheet backdrop un-gated and its `motion-reduce:animate-none` dropped     | RED on the overlay block                      | `2 passed` — the universal clamp still holds it                                                                             | GREEN — prediction wrong     |
| `M8`          | the Guidance boundary panel's `--info-soft` surface becomes `bg-transparent` | dark red, forced colours green                | `1 failed \| 1 passed`; `the boundary panel's surface did not change in dark`                                               | RED as predicted             |
| `M9`          | the Guidance boundary panel loses its border                                 | forced colours red, dark green                | `1 failed \| 1 passed`; `the boundary panel has no border under forced colours`                                             | RED as predicted             |
| `M10`         | "does not mean the message was read" reworded                                | forced colours red on the words               | `1 failed \| 1 passed`; `expect(locator).toContainText(expected) failed`                                                    | RED as predicted             |
| `M11`         | the boundary panel's padding `p-4 sm:p-5` → `p-3 sm:p-6`                     | **GREEN** — no assertion reads padding        | `2 passed`                                                                                                                  | GREEN as predicted (control) |

**Withdrawn rows, recorded rather than deleted.** `M1` and `M1b` added a Tailwind arbitrary
`min-w-[…]` to Guidance's grid and both returned green; neither moved the layout, so neither is
evidence about anything (F4). `M17` combined three edits and ran only on a reused build root; it is
superseded by `M17a` and `M17b` on fresh roots (F3).

**Two predictions were wrong and both changed what is in the tree.** `M7` corrected a comment that
claimed the rail carried the shell's only transition. `M13` inverted my model of which layer suppresses
motion — I had it exactly backwards, and the assertion that matters is pinned to the layer that turned
out to be load-bearing. A third, `M9`'s dark half, I predicted with stated uncertainty and it held.

**Assertions in the new blocks that were NOT mutated**, stated so a green is not over-read: the
synthetic-marker visibility in the reflow and reduced-motion blocks, and the `h1` identity in the
reduced-motion block. Each duplicates a locator that nine existing cases in this file already assert,
so it is not the assertion at risk; but it is unproven here and is not claimed otherwise.

---

## 6. What changed, and what deliberately did not

**Added**, all in `tests/ui-caring-contacts-workspace.spec.ts`:

- `caring-contacts every screen, at every reviewed width` — nine tests, six widths each.
- `caring-contacts every screen, at the 400% zoom equivalent` — nine tests.
- `caring-contacts every screen, under a reduced-motion preference` — nine tests, both preferences.
- `caring-contacts overlay surfaces, under a reduced-motion preference` — two tests, 24 rows each.
- `caring-contacts guidance, in the modes its own block proved on reports` — two tests.

Thirty-one tests; the file goes from **84 to 115**.

**Also added:** `tests/ui-caring-contacts-workspace.spec.ts` to `MOTION_SENSITIVE_SPECS` in
`tests/playwright-motion-emulation-contract.test.ts`. That contract requires a motion-sensitive spec
to declare its own `reducedMotion` configuration; naming this spec there is what stops the declaration
being deleted later and leaving blocks that still read as a reduced-motion proof while inheriting the
suite-wide default.

**No existing assertion was deleted, loosened, or re-scoped.** No production source was changed by
this task; every source edit in the ledger was a mutation, applied and restored, with the allowlisted
paths asserted clean on both sides. No tap target was touched — production stays `min-h-12` (48px) and
the blocks that assert 48 are untouched. The demo seed was not turned on.

---

## 7. Gates

All on the final tree, `679d5749e`. Evidence is the summary line, not an exit code.

- The Caring Contacts browser gate, whole file, fresh build root:
  `npm run test:e2e -- tests/ui-caring-contacts-workspace.spec.ts --project=chromium` —
  `Running 115 tests using 1 worker`, `115 passed (3.0m)`, exit 0. Unmutated, on a fresh
  build root, at `679d5749e`.
- `npx tsc -p tsconfig.json --noEmit`: exit 0 and no output at all, read from `tsc` directly, never
  through a pipe.
- `npx eslint tests/ui-caring-contacts-workspace.spec.ts tests/playwright-motion-emulation-contract.test.ts
--no-cache`, after removing `node_modules/.cache/eslint`: `errorCount: 0 warningCount: 0`.
- `npx prettier --check` over every changed file: `All matched files use Prettier code style!`
- `node scripts/run-vitest.mjs run --reporter=dot tests/playwright-motion-emulation-contract.test.ts` —
  `Test Files  1 passed (1)`, `Tests  3 passed (3)`, with `GATE_RECEIPTS=refresh`.
- `npm run test:cc-guards` — `Test Files  37 passed (37)`, `Tests  827 passed (827)`, with `GATE_RECEIPTS=refresh`.

**Earlier runs, recorded because they are part of the evidence rather than noise.** At `8fb2c5d79`
the gate returned `9 failed`, `104 passed (5.6m)`: every failure was the new reduced-motion probe,
counting any duration above zero and so reporting 228 elements per screen — `head` and `meta` among
them — because the universal clamp sets 0.01ms rather than 0, deliberately, so `transitionend` and
`animationend` still fire. The probe was corrected to ask whether a duration is perceptible, and at
`7b2cbc2f3` the same gate returned `115 passed (5.6m)`.

One lock refusal was observed, in the throwing shape with no marker: `Error: Database focused-test
capacity is full (current owner PID 46164, worktree …browser-test-gate-handoff-d5c1db…)`. It was this
task's own Playwright run holding the lease; the vitest call was retried after it finished. No lease
was forced.

**The last change to this tree is this report.** No suite reads it, and `test:cc-guards` was
run again after it was written, on the committed tree, returning the same line — through one
lock refusal in the throwing shape from another worktree, retried rather than forced. The browser gate above ran on the code
tree at `679d5749e`, which this document does not alter.

`tests/source-control-bytes.test.ts` is inside `test:cc-guards` and covers the literal-backspace trap;
no `\b` was written into this task's sources, in a regex or anywhere else.
