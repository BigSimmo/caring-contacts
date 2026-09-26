# Task report — collapsing the two `ExitOnlyOverlayTrigger` implementations

**Status: COMPLETE.** The adjudication recorded in `docs/caring-contacts/phase-2b-build-record.md`
("The duplicate `ExitOnlyOverlayTrigger`, adjudicated") and in merge-checklist §2a is landed in full:
Task 10's file and structure, Task 16's runtime behaviour, Task 16's DOM marker, every consumer
re-pointed, the duplicate deleted, and a source-scan invariant that reddens if either half of the
fork comes back.

Branch `claude/browser-test-gate-handoff-d5c1db`. Nothing pushed, no PR, no subagents dispatched.

| Commit      | What                                                                        |
| ----------- | --------------------------------------------------------------------------- |
| `9d421b7d6` | The de-duplication itself, its behaviour change, and the new invariant test |
| `136ea1117` | Renamed the invariant scan's loop variables off the reserved `module` name  |

Both verified to exist with `git cat-file -e <sha>^{commit}`.

---

## What the tree held, and what it holds now

Two live implementations of one exported name, at two paths, so the merge produced no conflict and
both survived:

| Module                                             | Typed `overlayId`      | Staged on open                                        | Marker |
| -------------------------------------------------- | ---------------------- | ----------------------------------------------------- | ------ |
| `overlays/exit-only-overlay-trigger.tsx` (Task 10) | `NonMutatingOverlayId` | `{ kind: "record", record: closingIsTheWholeAction }` | none   |
| `overlays/overlay-trigger.tsx:179` (Task 16)       | `string`               | nothing                                               | yes    |

Task 10's was imported by `patient-overview.tsx` and `plan-wizard/plan-wizard.tsx`; Task 16's by
`template-detail.tsx`. One name, one workspace, two answers to "what an exit row's commit is" — and
Ruling [130]'s compile-time guarantee holding at two call sites and not at the third.

### What was changed

- **`overlays/overlay-trigger.tsx`** — the duplicate `ExitOnlyOverlayTriggerProps` and
  `ExitOnlyOverlayTrigger` deleted along with their doc comment; `OVERLAY_TRIGGER_CLASS` exported so
  the surviving module shares the one surface constant rather than carrying a second copy of it; the
  now-unused `openWorkspaceOverlay` import dropped. **`WorkspaceOverlayTrigger` itself is byte-for-byte
  unchanged** — same props, same required `commit`, same throw, same DOM.
- **`overlays/exit-only-overlay-trigger.tsx`** — the surviving module. It now renders its own button
  and opens through `openWorkspaceOverlay`, staging **nothing**; `exitOnlyOverlayCommit` became
  `assertExitOnlyOverlayRow`, a guard that throws and returns nothing; `closingIsTheWholeAction`
  deleted; `data-overlay-trigger-kind="exit-only"` carried over. `overlayId` stays
  `NonMutatingOverlayId` (Ruling [130]) and the runtime throw stays as belt-and-braces.
- **`template-detail.tsx`** — imports `ExitOnlyOverlayTrigger` from the surviving module and
  `WorkspaceOverlayTrigger` from the base one. No other change.

### Why the guard's name changed

The adjudication keeps "the exported guard" and removes the commit it returned. Leaving the function
called `exitOnlyOverlayCommit` would have left a name promising a commit in a workspace where the
whole point of the change is that an exit row stages none — and it was still constructible, so the
no-op commit would have remained available to any caller. It is now `assertExitOnlyOverlayRow`,
takes `string` deliberately (since Ruling [130] the ordinary mistake is a compile error, so what
reaches it is a cast or an untyped value), and throws at render rather than at construction, which
is the policy `WorkspaceOverlayTrigger` and `blockReasonWording` already follow.

---

## Task 3's pinned trigger contract — not changed, and why it did not have to be

The Task 20 reviewer expected the marker to require "giving `WorkspaceOverlayTrigger` a pass-through
prop, which is a change to Task 3's pinned trigger contract". **It did not, and the reason is that
carrying Task 16's runtime behaviour across removes the delegation the reviewer's route assumed.**

Task 10's component delegated to `WorkspaceOverlayTrigger`, so the only way to reach the DOM from it
was through that component's props — hence the pass-through. But `WorkspaceOverlayTrigger` requires
a commit and opens through `openWorkspaceOverlayWithCommit`, and the adjudication's whole point is
that an exit row stages nothing. So the surviving component cannot delegate at all: it renders its
own button, exactly as Task 16's did, and the marker is simply an attribute on that button.

What `overlay-trigger.tsx` gives up is one `const` becoming an `export`. The pinned properties are
untouched and all four still hold, verified by the suite on the final tree:

- `commit` is required (`@ts-expect-error`, `tsc --noEmit`);
- an id no frozen row carries is a compile error (`@ts-expect-error`);
- an id reaching it past the type still throws at render;
- `min-h-tap` and a token surface with no `min-h-11`.

---

## The `template-detail` assertion the reviewer flagged — NOT changed

`tests/caring-contacts-template-detail.dom.test.tsx:481` asserts
`data-overlay-trigger-kind="exit-only"`. The reviewer predicted the minimal repair would redden it,
because the surviving module rendered no marker. **Carrying the marker over is half of the
adjudication, so once it is carried the assertion passes unchanged** — and it now asserts it of the
surviving module, which is strictly more than it asserted before. Not a line of that file was
edited, and it is green on the final tree.

Two further points, because the assertion is weaker than it looks on its own:

- The case's `expect(action).not.toHaveAttribute("aria-disabled")` a few lines below passes under
  **both** staging behaviours — a staged `record` commit answers `commitRefusalFor` with `null`, and
  staging nothing answers with a `recording-rows-only` refusal the host withholds from a
  non-recording row. So that line cannot distinguish them either.
- Mutation `M4` proves this directly: restoring Task 10's staged no-op leaves the whole
  `template-detail` suite **green**. The distinction is only caught by the new assertion in
  `caring-contacts-overlay-trigger.dom.test.tsx` that reads the staged slot itself.

## The assertions that DID have to change, with both expectations shown

Two cases in `tests/caring-contacts-patient-overview.dom.test.tsx` were pinned to the behaviour the
adjudication deliberately removes. Neither was deleted, weakened or skipped; the property moved to
where it is now load-bearing, and both old and new forms are recorded in the test's own comments.

**Old (both cases):**

```
expect(commitRefusalFor(exitOnlyOverlayCommit("delivery-detail"))).toBeNull();
expect(commitRefusalFor(exitOnlyOverlayCommit("activation-success"))).toBeNull();
```

That proved the staged commit was a `record` and not an `unavailable` — an `unavailable` carries an
`every-row` refusal the host would render as an `aria-disabled` EXIT, the defect Ruling [90] fixed.
It was a sound assertion about the code beneath it, and the adjudication removed the thing it read:
there is no staged commit any more, so there is nothing for `commitRefusalFor` to be asked about.

**New (both cases):** render the screen, find the trigger for that row, and assert it carries
`data-overlay-trigger-kind="exit-only"` — the DOM's own record of which of the two opening routes
was used, written only by the exit-only trigger. Each has a positive control asserting the control
exists before asserting anything about it, so a green is about the route and not about an empty
list. The guard's throw assertions (`/records a decision/i`, `/No overlay is defined/i`) are
unchanged apart from the function's new name. The first case was also split in two, because one
case was carrying two unrelated properties.

**Where the removed property now lives, proven rather than asserted:** `commitRefusalFor(null)`
answers `NO_STAGED_COMMIT_REASON` with `scope: "recording-rows-only"`, and the host withholds a
recording-only refusal from a row that records nothing — which
`tests/caring-contacts-overlay-trigger.dom.test.tsx`'s existing "a row that records nothing keeps
its way out" loop already proves for **every** non-recording row in the frozen table, including
these two. That loop is unchanged and green.

## Two doc comments that my diff made false

Per the standing rule about reading every doc comment a diff's mechanism touches, two comments in
`tests/caring-contacts-explained-automation.dom.test.tsx` justified client boundaries with reasoning
this change invalidates. Both were corrected; neither is an assertion.

- The `overlays/exit-only-overlay-trigger.tsx` allowlist entry said it was a client component "for a
  structural reason rather than an interactive one … an exit row's commit has to be CONSTRUCTED on
  the client side of the seam". It constructs no commit now. It is a client component because it
  renders a button with an `onClick`. The structural half that still holds — a screen passes an
  overlay id and a label, both plain data — is kept.
- The `plan-actions.tsx` entry cited the exit-only trigger as its precedent for that structural
  argument. It now notes that `plan-actions.tsx` is where the argument still applies.

---

## New coverage

`tests/caring-contacts-overlay-trigger.dom.test.tsx` gains two describe blocks.

**`ExitOnlyOverlayTrigger` is one component, exported once** — a source scan over
`src/components/caring-contacts` and `src/app/caring-contacts`. It exists because of what made the
duplicate invisible: the two implementations sat at different paths, so git reported no conflict,
both files applied cleanly, and every DOM suite stayed green because each consumer was rendering a
component that really did exist and really did work. A duplicate that both halves of a fork keep
working is invisible to every gate that asks whether the code works, so this one asks about the
tree: the name is declared or re-exported by exactly one module, and every module importing it
resolves to that module. Both cases carry a positive control (the walk found the surviving module
and more than twenty modules; the consumer set is non-empty), and `M7` and `M8` prove both controls
can redden.

The word-boundary is written as the character class `[^A-Za-z0-9_$]` rather than `\b`, deliberately:
a `\b` typed into this repository has arrived as a literal `0x08` byte before now, which renders as
nothing and matches nothing while every gate stays green. `tests/source-control-bytes.test.ts` is in
`test:cc-guards` and is green.

**the exit-only trigger** — the surviving component's own behaviour: it stages nothing (with a
recording-route positive control proving the slot is observable and writable from this test first),
it writes the marker, it wears the shared surface and the 48px tap floor, a recording row is a
compile error (`@ts-expect-error`), and a recording row reaching it past the type still throws.

---

## Mutation ledger

Every row below ran against **`136ea11173d0e2c0f64073d027dd3e336eb6cb94`**, the final tree, with the
unmutated baseline re-established on it first: `Test Files 3 passed (3)`, `Tests 147 passed (147)`
over the three suites the rows select. The round had already been run once at `9d421b7d6` and every
verdict is unchanged between the two; it was repeated because the suite was edited afterwards (the
`module` rename and its Prettier reflow), and a gate verdict covers only the tree it saw.

The driver validates its whole table against an allowlist of the five files this task may mutate
**before any file I/O**, asserts id uniqueness, checks each anchor occurs exactly once, asserts the
computed post-image differs from the original, writes it, re-reads from disk and asserts byte
equality, restores the original, and asserts `git diff --quiet` over the allowlisted paths on both
sides of every row. It lives at a worktree-namespaced scratchpad path
(`…/cc-exitonly-d5c1db/mutate.mjs`), because several tasks share one machine and one scratchpad and
an unattributable mutation result is worse than a missing one. Its retry loop matches **both**
refusal shapes — the `DATABASE_HEAVY_RUN_ADMISSION_BUSY` marker and the lock module's bare throw —
and treats an output with no `Test Files` summary line as "the run did not happen" whatever the exit
code said.

Suite keys: **T** = `caring-contacts-overlay-trigger.dom`, **O** = `caring-contacts-patient-overview.dom`,
**D** = `caring-contacts-template-detail.dom`.

| ID            | File                                  | Mutation                                                        | Suites  | Predicted                                                                                                       | Observed                                                                                                                                                                                                                                                                                                                                                                     | Verdict                                        |
| ------------- | ------------------------------------- | --------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `CTRL_NOOP`   | `exit-only-overlay-trigger.tsx`       | replacement equals anchor                                       | —       | the driver refuses the row                                                                                      | `REFUSED — the post-image equals the original`                                                                                                                                                                                                                                                                                                                               | Guard fired                                    |
| `CTRL_ABSENT` | `exit-only-overlay-trigger.tsx`       | anchor not in the file                                          | —       | the driver refuses the row                                                                                      | `REFUSED — anchor occurs 0 times`                                                                                                                                                                                                                                                                                                                                            | Guard fired                                    |
| `M1`          | `overlay-trigger.tsx`                 | restore a second declaration of the name in the base module     | T       | 1 failed: _is exported by exactly one module_, naming `overlay-trigger.tsx`                                     | `Test Files 1 failed (1)`, `Tests 1 failed \| 34 passed (35)`; failed: _is exported by exactly one module_; `expected [ …(2) ] to deeply equal [ Array(1) ]`                                                                                                                                                                                                                 | RED as predicted                               |
| `M2`          | `template-detail.tsx`                 | re-point the consumer back at the module the duplicate lived in | T, D    | T red on _is imported … by every consumer_ naming `template-detail.tsx`; D red at **import** time               | `Test Files 2 failed (2)`, `Tests 21 failed \| 43 passed (64)`; T: _is imported from that module by every consumer, and from nowhere else_, `expected [ Array(1) ] to deeply equal []`; D: 20 cases, `Element type is invalid … but got: undefined`                                                                                                                          | RED — **prediction half wrong, see below**     |
| `M3`          | `exit-only-overlay-trigger.tsx`       | drop Task 16's DOM marker                                       | T, O, D | 4 failed: the T marker case, both new O cases, and `template-detail.dom:481`                                    | `Test Files 3 failed (3)`, `Tests 4 failed \| 143 passed (147)`; failed: _opens its row with NOTHING staged, and says which route it took_, _raises the receipt drawer through the exit route…_, _takes the exit route, which refuses any row that records something_, _offers the message preview as an EXIT…_; `toHaveAttribute("data-overlay-trigger-kind", "exit-only")` | RED as predicted                               |
| `M4`          | `exit-only-overlay-trigger.tsx`       | restore Task 10's staged no-op commit                           | T, D    | 1 failed in T on the staged-slot assertion; **D green**, because no assertion there reads the slot              | `Test Files 1 failed \| 1 passed (2)`, `Tests 1 failed \| 63 passed (64)`; failed: _opens its row with NOTHING staged…_; `the exit route staged a commit: expected { token: '<id elided>', …(1) } to be null`                                                                                                                                                                | RED as predicted, **and D green as predicted** |
| `M5`          | `exit-only-overlay-trigger.tsx`       | stop the guard refusing a recording row                         | T, O    | 3 failed: the T render-throw case and both O guard cases                                                        | `Test Files 2 failed (2)`, `Tests 3 failed \| 115 passed (118)`; failed: _still fails loudly at render for a recording row that reaches it past the type_, _refuses to be the workspace's escape hatch from Ruling 87…_, _takes the exit route, which refuses any row that records something_; `expected [Function] to throw an error`                                       | RED as predicted                               |
| `M6`          | `exit-only-overlay-trigger.tsx`       | **over-sensitivity control** — rename a local in the guard      | T, O, D | GREEN: nothing observable changes                                                                               | `Test Files 3 passed (3)`, `Tests 147 passed (147)`                                                                                                                                                                                                                                                                                                                          | GREEN as predicted                             |
| `M7`          | `caring-contacts-overlay-trigger.dom` | narrow the source walk so it no longer reaches the consumers    | T       | 2 failed: _scans the workspace source at all_ and _is imported … by every consumer_ (the two positive controls) | `Test Files 1 failed (1)`, `Tests 2 failed \| 33 passed (35)`; `the workspace source walk found almost nothing: expected 6 to be greater than 20`; `no module imports the exit-only trigger at all: expected 0 to be greater than 0`                                                                                                                                         | RED as predicted; **the number 6 was not**     |
| `M8`          | `caring-contacts-overlay-trigger.dom` | break the import scan so the consumer check reads an empty set  | T       | 1 failed: _is imported … by every consumer_, on the non-empty-consumers control                                 | `Test Files 1 failed (1)`, `Tests 1 failed \| 34 passed (35)`; `no module imports the exit-only trigger at all: expected 0 to be greater than 0`                                                                                                                                                                                                                             | RED as predicted                               |

> **One value in the `M4` row is elided.** The observed assertion printed the overlay commit's own
> `token`, a per-render identifier the commit machinery generates and throws away — it authenticates
> nothing and reaches no service. Its characters were high-entropy enough that the repository's
> secret scanner read the row as a credential, so the id is shown as `<id elided>` here. Nothing the
> row demonstrates depends on the value: the point of `M4` is that a commit was staged **at all**
> where the assertion required `null`.

### `M2` — the half I predicted wrong

I predicted `template-detail.dom` would fail at **import** time, on the grounds that an ES module
named import of a symbol the target does not export is a link-time error. It failed at **render**
time instead, with React's `Element type is invalid … but got: undefined`. Vite's transform gives
the import a live binding that reads `undefined` rather than refusing the link, so the failure
surfaces where the component is used, not where it is imported. The row is still red for the right
reason and the invariant test named the right file; the prediction about _where_ was wrong, and it
is recorded rather than relabelled.

### `M7` — a number I predicted wrong

I predicted the narrowed walk would find 5 modules; it found 6. `overlays/` holds `definitions.ts`,
`exit-only-overlay-trigger.tsx`, `overlay-commits.ts`, `overlay-host.tsx`, `overlay-trigger.tsx` and
`workspace-overlays.tsx`. A miscount on my part, not a defect in the assertion — but the rule says
an unexpected number in an assertion error is checked rather than absorbed, so it was.

---

## Gates

Every line below is pasted from the run, not summarised from an exit code. Each was run after the
last edit to the tree it covers.

- **`npm run test:cc-guards`**, once, on the final tree, `GATE_RECEIPTS=refresh`, one attempt, no
  lock refusal:

  ```
   Test Files  37 passed (37)
        Tests  827 passed (827)
     Duration  83.17s
  ```

- **Two Caring Contacts suites the gate does not name** that could plausibly see a component-import
  change (`caring-contact-route-files`, `caring-contact-linked-routes.dom`), run narrowed after
  diffing the gate's suite list against the suites that exist:

  ```
   Test Files  2 passed (2)
        Tests  29 passed (29)
  ```

  The remaining thirty Caring Contacts suites absent from the gate are domain, repository, server
  and audit suites that reach none of the three modules changed here. They were not run and that is
  a deliberate scope judgement, not a claim about them.

- **`npx tsc -p tsconfig.json --noEmit`** — read from `tsc` itself, never through a pipe: `exit=0`
  with no diagnostics, re-run after the final edit. This is the gate that carries the three
  `@ts-expect-error` proofs: a directive that stopped being needed would be reported as unused, so
  a clean typecheck is what proves Ruling [130] still bites at both trigger components.

- **`npx eslint <the six changed files>`**, with `node_modules/.cache/eslint` removed first so a
  per-file cache cannot hide it: `exit=0`, no output. The first run of this was **red** —
  `@next/next/no-assign-module-variable` on a loop variable named `module`, the same trap commit
  `30a6c33e1` fixed in this suite's neighbours — and `136ea1117` is that fix. Worth noting that the
  first attempt read `eslint exit=0` because the command ended in `| tail`, which reports the tail's
  status; the error was visible only in the output.

- **`npx prettier --check <the six changed files>`**: `All matched files use Prettier code style!`

Not run, deliberately, per the brief: `npm run test`, `npm run build`, `npm run verify:ui`,
`npx playwright test`, and anything provider-backed.

---

## Concerns

1. **`WorkspaceOverlayCommit` still has no member meaning "this row's decision is an exit".** This
   is Task 10's own open finding and the change does not close it — it moves it. An exit row now
   stages **nothing**, and at the host an absence is an absence: it cannot distinguish "an exit row
   opened by its control" from "an overlay reached by address". The two are told apart only by the
   row's `mutatesState`, which is what makes the refusal withholdable, so nothing is currently
   wrong. But the marker I carried over closes the gap for a **test**, not for the host, and the
   report should not be read as though it closed both. Adding a member is a change to Task 3's
   pinned contract and to the totality of `commitRefusalFor` — the owner's, not a screen's.

2. **The single-export invariant is a source scan, and its limits are the inventory test's limits.**
   It reads text: an `export function ExitOnlyOverlayTrigger` written inside a comment would count,
   and a duplicate introduced by a shape neither regex anticipates (a default export later renamed,
   `export * from`, a dynamic `import()`) would not. It is deliberately narrower than a module-graph
   analysis and it catches the shape that actually happened. It also scans only
   `src/components/caring-contacts` and `src/app/caring-contacts`; a copy planted outside those two
   roots is invisible to it.

3. **`overlay-trigger.tsx` carries a pre-existing doc-comment defect I did not touch.**
   `WorkspaceOverlayTrigger`'s long doc comment (lines 11–46) is immediately followed by a second
   `/** … */` for `OVERLAY_TRIGGER_CLASS`, so the first comment attaches to nothing — the component
   it documents is fifty lines further down with no comment of its own. It predates this task, it
   is cosmetic, and fixing it would have put an unrelated hunk in this diff. Worth a `/issues`
   capture rather than a silent fix.

4. **Task 16 built a component that has now been deleted.** That is the cost of the controller error
   recorded in the build record, and it is already recorded there; it is repeated here only so this
   report is not read as though the adjudication were free.
