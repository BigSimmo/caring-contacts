# Task 3 report — the overlay trigger, and the commit contract that shipped with it

**Branch** `claude/browser-test-gate-handoff-d5c1db`, base `f65dd39d3`.
**Status: DONE.** Gates below.

---

## 1. The architectural decision, and what was rejected

This is the part of the task that carried a real choice, so it is first.

### The problem

`WorkspaceOverlays` is mounted **once, by the shell**, as a **sibling** of `children`. A screen's
confirm behaviour therefore has no shared parent with the host and no prop path to it.

A second constraint narrows the space much further than the brief's framing implies, and it is the
one that decided the shape: **the screens are Server Components.** A Server Component cannot pass a
closure to a Client Component at all — props crossing that boundary must be serialisable (Next 16,
"Server and Client Components"). So "the screen's commit handler" can never be an arbitrary
callback the screen wrote. It can only be a serialisable value, or a Server Action reference.

That is why `WorkspaceOverlayCommit` is a **discriminated union of intents**, not a function type:

```ts
export type WorkspaceOverlayCommit =
  | { readonly kind: "record"; readonly record: (overlayId: string) => void }
  | { readonly kind: "unavailable"; readonly reason: string };
```

`record` is a function _position_, satisfied from a Server Component by a Server Action and from a
Client Component by an ordinary function. `unavailable` is plain data. Both are required members of
a required prop — there is no default, no optional prop, and no no-op member.

### The choice: a single-slot handoff, written at the moment of opening

**An overlay opening carries its commit with it.** `openWorkspaceOverlayWithCommit(id, commit)`
stages the commit in a module-scoped slot and then pushes `?overlay=<id>`. `WorkspaceOverlays`
subscribes to that slot with `useSyncExternalStore` — the same mechanism it already uses for the
URL — and uses the staged commit **only while the staged id and the URL's id are the same overlay**.

Both writes are synchronous, so the host's first render carrying the new id already carries its
commit; there is no frame where the overlay is open with nothing staged.

### What was rejected, and why

Each of these is also written into `overlay-commits.ts` itself, not only here.

**A React context provider — rejected as structurally impossible, not merely costly.** Two
independent reasons, either sufficient: the screen is a Server Component, so it cannot render a
provider or hold context state at all; and `WorkspaceOverlays` is a _sibling_ of `children` in the
shell, so a provider rendered inside a screen would not contain the host even if a screen could
render one. Making context work would mean a new client boundary wrapping the whole workspace —
against Ruling 13, which holds this route's client payload to a rounding error — **and the trigger
would still have to write the commit into it on activation**, which is this module's job with more
payload attached.

**A per-screen host — rejected.** It duplicates the renderer the shell deliberately mounts once.
The shell's own comment gives the reason: the interaction matrix is a workspace-wide contract, and
a screen that forgot to mount the host would lose the session gate and the offline notice with it.
Two hosts would also mean two subscribers to one `?overlay=` parameter both rendering the same
overlay, and `tests/ui-caring-contacts-workspace.spec.ts` asserts single occupancy of the overlay
content node (`toHaveCount(1)`) throughout.

**A registry keyed by overlay id, written on mount — rejected, and this is the one worth reading.**
It is the obvious way to close the "a second registration silently overwrites the first" hole the
brief named, and I built the argument for it before finding what kills it: **a list screen may
render ten `Pause` triggers, one per row.** All ten would claim the same key, and every resolution
is worse than not having the problem — throw on the second registration and a legitimate screen
cannot be built; last-write-wins and the silent-overwrite failure is back unchanged; compare
handlers by identity and an inline arrow re-registers on every render. Staging at the **moment of
activation** has no conflict to resolve at all, because exactly one control was activated.

### The cost this design carries, stated rather than hidden

Module-scoped mutable state is invisible coupling: nothing in a screen's source shows that
activating a trigger writes into a module. Two things pay that back, and both are load-bearing:

1. **The identity check** (`commitForOpenOverlay`). A commit staged for one overlay is never
   offered to a different one, so a stale slot cannot be mistaken for a wired control.
2. **`commitUnavailableReasonFor` is total.** Every state of the slot maps to an answer and two of
   the three are a refusal in plain words.

### The decision with the largest blast radius — OVERRULED in fix round 1 (Ruling 90)

I originally made the no-staged-commit refusal apply to **all 24 rows**, and flagged it here as the
judgement most worth an owner's attention. The review overruled it, and was right on a decidable
ground rather than a matter of taste. **Ruling 90:** the refusal now carries
`scope: "recording-rows-only"` and is withheld from the 8 rows with `mutatesState: false`.

Why my original reasoning was wrong. I rejected restricting it as "reopening the defect on the other
eight" — but those eight rows' controls are **not confirmations, they are exits**: "Sign in again",
"Try connecting again", "Try loading again", "Back to the plan", "Back to personalisation", "Close
this detail", "View the plan", "Review the current version". None of them records anything, so none
can be a confirm control that records nothing, and Ruling 87 never reached them. Refusing them also
contradicted the host's own Rule 9 three lines from where I applied the change, and rendered a
sentence — "nothing can be recorded here" — that is simply **false** about a control whose action is
to leave.

**And on two rows it was actively harmful.** `session-expiry` and `offline-banner` are
`dismissal: "recovery-only"`: Escape and the backdrop are deliberately inert. Refusing their single
control left a person inside the one kind of overlay they must not be able to walk away from with
**nothing to do at all** — and `shell.tsx` renders `WorkspaceOverlays` in production, so any deep
link reached it.

A caller-stated `{ kind: "unavailable", reason }` still refuses on **every** row: there the screen
said so deliberately, and an exit nobody has built is still an exit that would go nowhere.

**The lesson, which is worth more than the fix.** Ruling 87 was right, and I applied it to a set
whose members differ in exactly the property it depends on. Its domain was **assumed rather than
checked** — and `definitions.ts` already carried the `mutatesState` flag that answers it row by row.
The eight rows are now covered by a parameterised test each, plus a named one for the recovery-only
gate.

---

## 2. What was built

| File                                                                       | What                                                                                                                                                                    |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/caring-contacts/workspace/overlays/overlay-commits.ts`     | **New.** `WorkspaceOverlayCommit`, the single-slot handoff store, `commitForOpenOverlay`, the total `commitUnavailableReasonFor`, and the rejected-alternatives record. |
| `src/components/caring-contacts/workspace/overlays/overlay-trigger.tsx`    | **New.** `WorkspaceOverlayTrigger` — the client control, with `commit` required.                                                                                        |
| `src/components/caring-contacts/workspace/overlays/workspace-overlays.tsx` | `openWorkspaceOverlayWithCommit`; the record-nothing `commit` replaced by `recordDecision`; the slot subscription; `commitUnavailableReason` passed to the host.        |
| `src/components/caring-contacts/workspace/overlays/overlay-host.tsx`       | New **required** prop `commitUnavailableReason: string \| null`, folded into the existing refusal path.                                                                 |
| `tests/caring-contacts-overlay-trigger.dom.test.tsx`                       | **New.** 12 tests.                                                                                                                                                      |
| `tests/caring-contacts-overlay-host.dom.test.tsx`                          | 11 existing `OverlayHost` call sites given `commitUnavailableReason={null}`. **No assertion changed, weakened or removed.**                                             |
| `tests/caring-contacts-explained-automation.dom.test.tsx`                  | `overlays/overlay-trigger.tsx` added to `ALLOWED_CLIENT_COMPONENTS` with its three-condition justification.                                                             |

`definitions.ts` and `docs/caring-contacts/interaction-matrix.md` are untouched, as required.

### The type-level requirement, and its exact signature

```ts
export type WorkspaceOverlayTriggerProps = {
  overlayId: string;
  commit: WorkspaceOverlayCommit; // required — no default, no no-op member
  children: ReactNode;
  className?: string;
};
```

This repo already has a pattern for proving a required prop (`caring-contacts-empty-state`,
`caring-contacts-explained-automation`), so it is proved rather than asserted: a `@ts-expect-error`
render in the test file, which **fails `tsc --noEmit`** the moment the error stops being raised.
Mutation M1 below shows it doing exactly that.

### Two behaviours worth naming

**An unknown overlay id throws at render, in every environment.** `overlayDefinition` returns null
for an id no row carries, so without the throw the trigger becomes a button that opens an empty
overlay — the silent form of the defect the whole contract forbids. The throw lands on
`src/app/caring-contacts/error.tsx`, which says plainly that nothing was sent and nothing was
changed. This follows `blockReasonWording`'s existing every-environment policy rather than
inventing a second one. At render, not on click, so a mistyped id cannot ship waiting for a
clinician to find it.

**The trigger itself is always live, even when its commit is `unavailable`.** The `aria-disabled`
shape belongs on the _overlay's confirm control_, which is what the commit handler backs. Opening a
decision surface that then states in plain words what cannot be recorded yet tells the clinician
more than a dead button on the screen behind it. A screen with no overlay to raise at all should
still render `UnavailableDestination`.

### Constraints held

- **Incident `note` boundary:** `overlay-commits.ts` and `overlay-trigger.tsx` name neither the
  service-state module nor its type, and the allowlist's companion guard walks the whole module
  graph reachable from the trigger and proves it. The trigger's props are an id, a class name,
  children, and an intent union — no state object.
- **Tap target:** `min-h-tap` (`--spacing-tap`, 3rem = 48px), the design system's one knob. Never
  `min-h-11`. Pinned by its own test.
- **Never both `disabled` and `aria-disabled`:** the refused action carries `aria-disabled="true"`
  only; asserted directly.
- **Design tokens only**, no hex; the reason is reachable via `aria-describedby`, never a `title`.
- **No import from `mockups/**`.**

---

## 3. Mutation proof

Every mutation was applied with a script that **asserts the original text exists before replacing
it**, and the mutated line was grepped out of the file and printed before the gate ran. Each was
reverted with `git checkout --` before the next.

| #   | Mutation (file, exact change)                                                                                 | Result                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | `overlay-trigger.tsx`: `commit: WorkspaceOverlayCommit` → `commit?: WorkspaceOverlayCommit`                   | `tsc` red: `error TS2578: Unused '@ts-expect-error' directive.` at line 107 of `tests/caring-contacts-overlay-trigger.dom.test.tsx` plus `TS2345` at the call site. Baseline `tsc` on the same tree: exit 0, no output. |
| M2  | `overlay-trigger.tsx`: `if (overlayDefinition(overlayId) === null)` → `if (false as boolean)`                 | `Tests 1 failed \| 11 passed (12)` — "fails loudly for an id the frozen table does not carry".                                                                                                                          |
| M3  | `workspace-overlays.tsx`: `stageWorkspaceOverlayCommit(id, commit);` → `void commit;`                         | `Tests 4 failed \| 8 passed (12)` — the record path, the checkpoint path, and both unavailable paths.                                                                                                                   |
| M4  | `overlay-commits.ts`: `if (commit === null) return NO_STAGED_COMMIT_REASON;` → `return null;`                 | `Tests 2 failed \| 10 passed (12)` — "refuses an overlay reached by address" and the totality test.                                                                                                                     |
| M5  | `overlay-host.tsx`: refusal ternary's else branch `commitUnavailableReason` → `null`                          | `Tests 3 failed \| 23 passed (26)` — the unavailable shape, the read-only row, and the by-address refusal.                                                                                                              |
| M6  | `overlay-commits.ts`: `return slot.overlayId === openOverlayId ? slot.commit : null;` → `return slot.commit;` | `Tests 1 failed \| 11 passed (12)` — "never offers one overlay's staged commit to another".                                                                                                                             |

**A lock incident during M4, reported because it is exactly the trap the brief names.** The first
M4 run produced **no summary line at all** — the run had not happened. The output was
`Error: Database focused-test capacity is full (current owner PID 73752, worktree
D:\Worktrees\Database\dev-hub-phase-1)`. My first attempt filtered that away with `grep -E "FAIL|Tests "`
and would have shown a clean-looking empty result. It was retried on a bounded loop and acquired
the lease on the second attempt; the row above is the real run.

---

## 4. Gates

All four gates ran for real — each one carries its own summary line, and none is quoted from an
exit code.

**Full unit suite** — `npm run test`, after a ~5 minute wait for the exclusive heavy-run lease:

```
 Test Files  1 failed | 813 passed | 3 skipped (817)
      Tests  2 failed | 9808 passed | 74 skipped (9884)
   Duration  373.61s
```

The two failures are **exactly** the known environmental pair the brief names — both in
`tests/gate-receipts.test.ts > gate receipts — file modes (Codex review, PR #2216)`, both failing at
`chmodSync` because this Windows drive cannot represent Unix file modes:

```
AssertionError: expected '266c7353fd49d41fab93e1b15cba66ec148f4…' not to be '266c7353fd49d41fab93e1b15cba66ec148f4…'
AssertionError: expected 2 to be 3
```

**No others.** Nothing in the caring-contacts surface, nothing in the design-system adoption
manifest, nothing in route reachability, and nothing in the interface-vocabulary scan.

**Typecheck** — `npm run typecheck`, a fresh run through the heavy-run wrapper, no errors emitted:

```
> node ./node_modules/typescript/bin/tsc -p tsconfig.typecheck.json --noEmit …
[gate-receipts] recorded a pass for "typecheck:internal" (5222 input files).
```

**Lint** — `npm run lint`, `--max-warnings 0`, no errors emitted:

```
> eslint src tests scripts worker supabase playwright … --max-warnings 0 …
[gate-receipts] recorded a pass for "lint:internal" (5222 input files).
```

**Format** — `prettier --write` on all seven changed files before the second commit.

### The gate that did NOT run

**`npm run verify:ui` / `tests/ui-caring-contacts-workspace.spec.ts` was not run.** It needs a dev
server and the exclusive Playwright lease, and it is outside the gates the brief listed. Two things
in it were read closely instead:

- _"returns focus to the control an overlay was opened from"_ — **unaffected**. It stands its opener
  in with the shell's `New plan` control and pushes the parameter itself via `page.evaluate`. That
  control is untouched, the host's `openedFromRef` capture is untouched, and the Sheet's focus
  return is untouched. Escape still closes a dismissible overlay whether or not its action is
  refused.
- _the 24-overlay matrix test_ — **the one place my change is visible to it**, and my first
  description of the size of that change was wrong. I wrote "one extra short refusal paragraph".
  `NO_STAGED_COMMIT_REASON` is **126 characters**, which inside `max-w-[var(--measure)]` at 390px is
  roughly **4-5 lines**, not a short paragraph. The margin against
  `toBeInViewport({ ratio: 1 })` on the action and `expectFullyOnScreen`'s bottom-edge bound (900px
  viewport) is therefore **smaller than I described**. Two things have since reduced the exposure,
  neither of which is a measurement: Ruling 90 withdrew the refusal from the 8 non-recording rows,
  so 16 of the 24 can render it rather than all of them; and the sentence itself was shortened while
  being reworded for Ruling 90. I still have **not** measured it. The coordinator is running that
  gate.

---

## 5. Concerns

1. **The deep-link refusal is the decision to review first.** It is written up in §1 under "the
   decision with the largest blast radius". I believe it is required by Ruling 87 rather than
   optional, but it changes what all 24 overlays do today, and it is the one judgement here I would
   want an owner to agree with rather than inherit. The reversal is two lines and the covering test
   names it.

2. **The Playwright spec was not run** (above). Low risk, unmeasured, and I would rather it were
   measured before this is treated as proven in a browser.

3. **A failed asynchronous record has no policy yet, deliberately.** `record` is typed
   `(overlayId: string) => void`, which accepts a Server Action (TypeScript's `void`-return rule),
   and the host does not await it. What a failed write should do to the interface — hold the overlay
   open, say what was not written, offer a retry — needs a real store and a real screen to answer,
   and neither exists. Inventing that now would be behaviour nobody reviewed against a live surface.
   **The task that introduces the first store must decide it**, and the comment on `record` says so.
   This is a stated gap, not an oversight.

4. **The `record` variant has no production consumer yet.** Every Phase 2B screen will pass
   `{ kind: "unavailable", reason }` until the stores exist. `record` is covered by DOM tests with a
   spy, including through the fresh-authentication checkpoint, but it has never run against a real
   Server Action across a real Server → Client boundary. The assignability claim is a TypeScript
   fact I am confident in; the end-to-end behaviour is untested and should not be described as
   proven.

5. **Module-scoped state is still module-scoped state.** The identity check and the total refusal
   function bound its failure modes, but a screen's source does not show that activating a trigger
   writes into a module. If a reviewer prefers the coupling to be visible in the tree, the honest
   alternative is to move the host into a client boundary wrapping the whole workspace and use
   context — which costs Ruling 13's payload budget. I judged that trade the wrong way round; it is
   a legitimate place to disagree.

6. **Nothing renders a trigger yet.** Task 3 ships the control and the contract; no screen uses
   either. The first screen to adopt it is where the ergonomics get tested, and it may find the
   `commit` prop wants to travel differently (per row, per action) than a single prop allows.

---

## 6. Fix round 1

Four Important, one Also-fix. Three of the four turned on the same finding: **the id-match guard
narrowed the module-state failure modes rather than closing them.** That was correct and I had
described the guard as if it closed them.

### Important 1 — Ruling 90, the blanket refusal

Overruled and applied; written up in §1 above, where the original claim was. The refusal type is now
`OverlayCommitRefusal = { reason, scope }`, and the host applies `recording-rows-only` only where
`definition.mutatesState` is true. `mutatesState` is still read from the frozen table in the host and
re-decided nowhere.

### Important 2 — the refusal flashed in the frame the decision was confirmed in

Real, and the mutation below reproduces it. `record` → `clear` → `close`: the clear notified
subscribers synchronously while `history.back()`'s `popstate` had not yet fired, so React re-rendered
the still-open overlay with an empty slot. After someone confirmed "Withdraw this patient", the frame
they saw showed the action `aria-disabled` with "nothing can be recorded here".

Closing before clearing would not have fixed it — both are synchronous within the handler, and the
URL change is not. The fix is that **the confirm handler no longer clears at all**: reconciliation
moved into one effect keyed on the history entry.

The covering test uses `fireEvent`, not `userEvent`, and no `waitFor`. `fireEvent` flushes React
inside the click while the `popstate` is still a queued task, so it reads the exact frame the flash
appears in. Every other test in the file waits for the settled state and steps straight over it —
which is precisely why none of them caught this.

### Important 3 — the slot was never cleared on Back, and my comment claimed otherwise

Also real. `close` is only ever called by the Sheet (Escape / backdrop / close button); Back closes
through `popstate`, which never calls `onClose`. My own first trigger test walks exactly that path.

Fixed with the **one-shot token** the review recommended, which closes all three holes together:
`openWorkspaceOverlayWithCommit` mints a token, stages the commit under it, and pushes it in the
history entry's state beside the existing marker. The host matches on the token, and one effect
empties any slot that does not name the current entry.

| Hole                                                             | Closed by                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Back leaves the slot full                                        | The entry Back lands on carries no token → mismatch → emptied            |
| A commit outlives its screen and answers a later same-id overlay | A later opening mints a **new** token; the older slot can never match    |
| One list row's commit answering another row's overlay            | Same — each activation mints its own token                               |
| A spent commit re-entered by Forward                             | Confirming unwinds to an entry without the token → emptied               |
| The closure retained for the tab's lifetime                      | The slot is emptied on the first non-matching entry, not merely withheld |

The comment now describes what the code does. The token lives in `history.state` for the same
per-entry reason the existing marker does, and that reasoning is written down rather than inherited.

### Important 4 — the signature, not the policy

`record` is now `(overlayId: string) => void | Promise<void>`, and the host attaches
`Promise.resolve(...).catch(...)` — `Promise.resolve` rather than `instanceof Promise`, because a
Server Action's return value need only be thenable. A rejection is stored wrapped (a promise may
reject with `undefined`) and re-raised during render, so it reaches
`src/app/caring-contacts/error.tsx` rather than the console.

The review's framing was the part I had got wrong: I deferred the **signature** along with the
policy, and a `void` return type would have forced the later task into a breaking change to answer
the question at all. The policy — hold the overlay open, name what was not written, offer a retry —
still defers, and the comment on `record` says so.

### Also fix — M-3, the trigger had no surface

It shipped geometry and a focus ring and no colour, so a caller passing no `className` — the shape
every usage takes — got an effectively unstyled control, and nothing covered the default rendering.
It now carries the same border/background/text tokens the shell's secondary controls use, with a
test asserting each is a `var(--…)` token rather than a literal.

### Fix-round mutation proof

Same method as §3: assert-then-replace, mutated line grepped out of the file and printed before the
gate, reverted with `git checkout --` before the next.

| #   | Mutation                                                                                            | Result                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| N1  | `overlay-commits.ts`: unstaged refusal `scope` back to `"every-row"`                                | `Tests 10 failed \| 17 passed (27)` — all 8 non-recording rows, the recovery-only gate, and the scope rule |
| N2  | `workspace-overlays.tsx`: `clearStagedWorkspaceOverlayCommit()` restored inside the confirm handler | `Tests 1 failed \| 26 passed (27)` — "never shows the refusal in the frame the decision was confirmed in"  |
| N3  | `workspace-overlays.tsx`: reconciliation effect made `if (false as boolean)`                        | `Tests 2 failed \| 25 passed (27)` — the Back test and the spent-commit half of the record test            |
| N3b | `overlay-commits.ts`: token match dropped (`return slot.commit`)                                    | `Tests 1 failed \| 26 passed (27)` — "never answers an entry it was not staged for"                        |
| N4  | `workspace-overlays.tsx`: `.catch` removed (`void commit.record(...)`)                              | `Tests 1 failed \| 26 passed (27)` — the rejection reaches no boundary                                     |
| N5  | `overlay-trigger.tsx`: default border/background/text classes stripped                              | `Tests 1 failed \| 26 passed (27)` — the default-surface test                                              |

**One run that did not happen, reported because the brief requires it.** The first N5 attempt chained
the gate behind `grep -c "bg-\[color:var" … && node scripts/run-vitest.mjs …`. With the classes
stripped the count was `0`, `grep` exited non-zero, and the `&&` short-circuited — so **no test ran
at all** and the output carried no summary line. It was re-run with `;` separators. Same shape as the
M-4 lock incident in §3: an absent summary line is the only reliable signal that a gate did not run.

### Not fixed, by instruction

- The `overlayId: string` render-time throw and its blast radius — deferred; a literal-union id needs
  `definitions.ts`, which the brief forbids touching.
- Two wording-looseness items in §3's mutation table — deferred.
- The M-4 length estimate **was** corrected: see §4.

### Fix-round gates

Re-run in full after the fixes, on a clean tree with every mutation reverted.

**Full unit suite** — `npm run test`:

```
 Test Files  1 failed | 813 passed | 3 skipped (817)
      Tests  2 failed | 9823 passed | 74 skipped (9899)
   Duration  388.75s
```

The two failures are the same known environmental pair, both in
`tests/gate-receipts.test.ts > gate receipts — file modes (Codex review, PR #2216)`, both at
`chmodSync` — `AssertionError: expected 2 to be 3`. **No others.** The total rose from 9884 to 9899:
the fix round added 15 tests, of which 8 are the parameterised non-recording rows.

**Typecheck** — `npm run typecheck`, no errors emitted:

```
[gate-receipts] recorded a pass for "typecheck:internal" (5222 input files).
```

**Lint** — `npm run lint`, `--max-warnings 0`, no errors emitted:

```
[gate-receipts] recorded a pass for "lint:internal" (5222 input files).
```

**Format** — `prettier --write` on every changed file before each commit.

**The browser gate is green, but at a head that predates this fix round.** The coordinator ran
`verify:ui` and recorded `32 passed (53.8s)` in `9cc7fa580` — against Task 3's head **before** fix
round 1, and its own record says the green must be re-taken afterwards. That is right, and for two
independent reasons: Ruling 90 changes **which** rows render the refusal paragraph at all (16 of 24,
not all 24), and the confirm-sequence fix changes **what** renders in the frame a decision is
confirmed in. So the 24-overlay matrix and geometry assertions ran against a different set of
rendered overlays than the current head produces.

I have **not** re-run it: it needs a dev server and the exclusive Playwright lease, and it is outside
the gates this brief lists. The risk moved in the safe direction — fewer rows render the paragraph
and the sentence is shorter — but that is an argument, not a measurement, and this branch's own
standing rule is that a browser result names the commit it ran against or it means nothing. **The
re-take is owed at `b452084b5` or later.**

### One generated file changed that I did not write

`docs/design-system/adoption-manifest.json` gained one line: the pre-commit hook's
`design-system:adoption:update` added `tests/caring-contacts-overlay-trigger.dom.test.tsx` to the
`Sheet` component's `testFiles`. The generator matches component names as word-boundary regexes
against test sources, and the fix round's comments name `Sheet` (Back never calls the Sheet's
`onClose`). The attribution is defensible on its own terms — these tests render the real `Sheet`
through the host — but it was produced by prose, not by intent. Staged as generated rather than
suppressed by rewording, which would be gaming the generator.
