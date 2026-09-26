# Task 1 report — the shared empty-state component

Branch: `claude/browser-test-gate-handoff-d5c1db`. Base commit for this task: `ff79cb6ce`.

Status: **DONE**. Two commits, local only. Nothing pushed, no PR opened, per the brief.

**This report has been corrected once.** The original "Mutation proof" section below described
the wrong mutation and reported numbers from a coarser edit than the brief asked for. That
section has been rewritten with the actual mutation and its actual result — see "Fix round 1 —
Important 1" below for the correction and why the original was wrong. Nothing else in the
original sections was altered; the component itself was reviewed and called spec-compliant.

## Commits

1. `c0f84112f` — feat(caring-contacts): add the shared EmptyState component (Phase 2B Task 1).
   The original build, described in "What was built" through "A real catch from the
   interface-vocabulary guard" below. At this point the component and its exports were named
   `ListEmptyState`, in the file `src/components/caring-contacts/workspace/list-empty-state.tsx`
   (both renamed from `EmptyState` / `empty-state.tsx` in fix round 1, per Ruling 88).
2. `191761fc6` — fix(caring-contacts): Task 1 fix round 1 -- rename collision, accessible group,
   mutation-proof correction. Renamed the component to `ListEmptyState` (file now
   `src/components/caring-contacts/workspace/list-empty-state.tsx`), added the accessible
   `role="group"` wrapper, and re-ran the mutation proof correctly. Detailed in "Fix round 1"
   below.

Every reference to the component past this point uses its current name, `ListEmptyState`, and
its current file, `list-empty-state.tsx`, including in the historical build narrative — the
rename happened after the fact, but describing the original build under the name it no longer
has would make this report harder to cross-reference against the current source.

## What was built

`src/components/caring-contacts/workspace/list-empty-state.tsx`, exporting `ListEmptyState`, a
Server Component with no hooks and no `"use client"` directive.

Modelled exactly as specified — a discriminated union on `kind`:

- `ListEmptyStateNoDataProps` (`kind: "no-data"`) — `heading`, `explanation`, optional `action`.
- `ListEmptyStateFilteredProps` (`kind: "filtered"`) — `heading`, `because`, `changedBy`, optional
  `action`. `because`/`changedBy` are required the moment `kind` is `"filtered"`; there is no
  shared optional field a caller could omit.

The `"filtered"` branch renders `AutomatedState`'s "Why: … / What changes it: …" wording shape
directly in JSX — it does not import or render `AutomatedState` (Ruling 81). It uses its own
icon pair (`FolderOpen` for `"no-data"`, `SearchX` for `"filtered"`) rather than
`AutomatedState`'s `CircleAlert`, and never labels itself with a state-name `aria-label` the way
`AutomatedState` does — Ruling 81 states both of those are wrong for "no patients yet".

**The action slot is a `ReactNode`, not `onClick`/`href` props.** This is what keeps the
component hook-free: a Server Component cannot own an event handler, so the action a caller
wants (a `<Link>`, a form-submit button, or an `UnavailableDestination`) is built by the caller
and handed in whole, the same way `ServiceStateBanner` — itself a Server Component — hosts
`UnavailableDestination` as a child without becoming a Client Component. `ListEmptyState` never
builds a second disabled-control pattern; that stays `UnavailableDestination`'s job. **This
decision was reviewed and explicitly upheld in fix round 1** — an `onClick`-shaped prop cannot
cross a Server-to-Client boundary, so it would have forced a Client Component, exactly what
Ruling 13 forbids.

Tokens and structure follow `automated-state.tsx` exactly: `rounded-[var(--radius-md)]`,
`border-[color:var(--border)]`, `bg-[color:var(--surface-subtle)]`,
`forced-colors:border-[CanvasText]`, `max-w-[var(--measure)]` on wrapping text,
`text-[color:var(--text-heading)]` / `text-[color:var(--text-muted)]` / `text-[color:var(--text)]`
for the tiered text, `size-icon-md` on the icon, `aria-hidden="true"` on the icon. No hardcoded
hex anywhere. No `<button>` is rendered by this component at all (the action is pre-built by the
caller), so the `min-h-12` / native-`disabled`-vs-`aria-disabled` constraints apply to whoever
builds that action node, not to this file.

## A real catch from the interface-vocabulary guard

The first draft used lucide-react's `Inbox` icon for the `"no-data"` kind. Running the full test
suite (not just the focused new test) turned up a genuine failure in
`tests/caring-contacts-interface-vocabulary.test.ts` — its raw-prose scan flagged the bare
identifier `Inbox` (from the import and from the ternary that selects it) as a match for
`CARING_CONTACTS_PROHIBITED_LANGUAGE`, which bans `\binbox(es)?\b` because this is a
suicide-prevention messaging product and "inbox" carries a reply-monitoring/marketing
connotation the product deliberately avoids. This is exactly the closed-list-enumeration
principle from the task brief in action — the guard scans all raw prose (not just string
literals) against a finite banned list, so an identifier name tripped it just as a sentence
would have. Fixed by switching the `"no-data"` icon to `FolderOpen`. Re-ran the full test suite
and the vocabulary test passed clean. **This was reviewed and explicitly upheld in fix round
1** — the reviewer confirmed the scan is working correctly and will not be narrowed to
literals-only, since an identifier is one accidental `aria-label` away from being user-facing.

## Tests — `tests/caring-contacts-empty-state.dom.test.tsx`

Originally 9 tests; fix round 1 added 2 more (the accessible-group tests), for 11 total.

1. `"no-data"` renders its heading and explanation, and the container text does **not** contain
   `"Why:"` or `"What changes it:"`.
2. `"no-data"` renders nothing (`querySelector("a, button")` is null) when `action` is omitted.
3. `"no-data"` renders the given `action` and it is genuinely actionable (a real `<a href>`
   found by accessible role/name).
4. **(new, fix round 1)** `"no-data"` is a named `role="group"` (`aria-label` = the heading) that
   contains the explanation text.
5. `"filtered"` renders both `because` and `changedBy` in the page text, and confirms no `[title]`
   attribute anywhere in the tree contains either string — mirroring exactly how
   `caring-contacts-explained-automation.dom.test.tsx` proves `AutomatedState`'s reason/remedy
   are not tooltip-only.
6. A `@ts-expect-error`-gated compile check (Ruling: type-level, not runtime) that `"filtered"`
   cannot be constructed with `because` omitted, and a second one with `changedBy` omitted —
   `tsc --noEmit` reddens if either field is ever made optional.
7. `"filtered"` renders the given `action` and it is genuinely actionable.
8. **(new, fix round 1)** `"filtered"` is a named `role="group"` (`aria-label` = the heading) that
   contains both the reason and the remedy text.
9. Rendering inside a `320px`-wide container: the heading is present, and every paragraph whose
   text exceeds 40 characters carries `max-w-[var(--measure)]` in its class list — the same wrap
   contract `automated-state.tsx` holds.
10. The outer element's `className` contains the literal `forced-colors:border-[CanvasText]`
    override class. jsdom cannot emulate `forced-colors: active`, so this proves the override
    class is actually present in rendered markup rather than merely written in source — matching
    the DOM-test-level proxy this repo already uses elsewhere for forced-colors guarantees (real
    browser proof for this family of claim lives in `tests/ui-caring-contacts-workspace.spec.ts`,
    out of scope for this task).
11. The icon (`svg`) count is exactly 1 and it carries `aria-hidden="true"` — state is carried by
    words, the icon is decoration only.

### TDD proof (genuine red, then green) — original build

1. Wrote the component first, then backed it up and replaced it with a deliberately naive stub
   (renders only `props.heading`, ignores `kind`, `because`/`changedBy`/`action` entirely).
2. Ran `npx vitest run tests/caring-contacts-empty-state.dom.test.tsx` against the stub:
   **`Tests 6 failed | 3 passed (9)`** — every assertion that reads copy, the action, forced-colors
   class, or icon count failed for the stated reason (missing text, missing link, empty
   `className`, zero icons). The 3 that passed were the "no action renders" test (trivially true
   for a component with no action logic), the type-level `@ts-expect-error` check (compile-time,
   unaffected by the stub body), and the loose half of the 320px test (no paragraphs existed to
   fail the wrap-class loop).
3. Restored the real implementation, reran: **`Test Files 1 passed (1)`, `Tests 9 passed (9)`**.

## Fix round 1

Three review findings, addressed in commit `191761fc6`.

### Important 1 — the mutation-proof narrative was wrong, corrected here

**What was wrong with the original report.** The original "Mutation proof" section (now
replaced below) described mutating the `"filtered"` branch, but the edit actually applied did
two things at once: it hardcoded the ternary's guard to a literal `true`, **and** it replaced the
`"no-data"` branch's real content (`{props.explanation}`) with a hardcoded placeholder string
(`MUTATION-ALWAYS-NO-DATA`). That second change is what the brief did not ask for. The brief's
named mutation is "make the `'filtered'` variant render the same output as `'no-data'`" — which
implies `'no-data'`'s own output stays exactly what it always was. The mutation actually run
changed what `'no-data'` itself rendered too (from the caller's real `explanation` text to a
fixed placeholder), so both kinds broke, and the report's `Tests 2 failed | 7 passed (9)` —
while a true, reproducible number for the edit that was actually made — was evidence for a
coarser, wrongly-targeted mutation, not the one the brief specified. The review reproduced this
exactly and named both the wrong branch attribution and the coarseness.

**The mutation run this round, done correctly.** Touched only two things in
`list-empty-state.tsx`: the ternary's guard (`props.kind === "no-data"` → literal `true`), and —
because forcing every kind through the `"no-data"` branch without narrowing requires it to
compile — a type cast on the one line that reads `props.explanation`, changed to
`(props as ListEmptyStateNoDataProps).explanation`. Nothing else changed; the `"filtered"`
branch's own JSX (the `Why:`/`What changes it:` block) was left completely untouched, just made
unreachable. This is the specified mutation, not a placeholder: it forces `"filtered"` instances
through the exact same rendering _code path_ `"no-data"` uses, rather than substituting a fake
string. The effect on each kind, reasoned through before running it:

- A genuine `"no-data"` instance still has a real `explanation` property, so the cast is a
  no-op and its rendered output is byte-for-byte identical to before the mutation.
- A genuine `"filtered"` instance has no `explanation` property at all — the cast makes it
  compile, but at runtime the read returns `undefined`, which React renders as nothing. The
  `Why:`/`What changes it:` text is gone, exactly matching the brief's "drop the reason and
  remedy," and reusing `"no-data"`'s actual branch rather than inventing new content.

Verification, in order:

1. **Confirmed the target was right before running anything:** `because`/`changedBy` text is
   exactly what the two `"filtered"`-content tests read, so this is the correct value to
   perturb.
2. **Proved the mutation was in the tree**, not silently unapplied: `grep -n "MUTATION"
src/components/caring-contacts/workspace/list-empty-state.tsx` returned the edited comment
   and line before running the test.
3. **Ran the suite**: **`Tests 2 failed | 9 passed (11)`.** Both failures were in the
   `"ListEmptyState — filtered"` describe block: "renders both the reason and the remedy in the
   page, never in a title alone" and "groups the heading, the reason and the remedy under one
   role=group named by the heading" — both because the reason/remedy text no longer renders.
   **Every `"no-data"` test stayed green**, confirming the mutation left `"no-data"`'s real
   output completely intact, which is the property the original mutation failed to have.
4. **Reverted** (`git`-tracked file restored from a pre-mutation backup), confirmed `grep -n
"MUTATION"` returned nothing, and reran: **`Test Files 1 passed (1)`, `Tests 11 passed
(11)`.**

### Important 2 — renamed `EmptyState` → `ListEmptyState`

`src/components/ui-primitives.tsx` already exports a registered design-system primitive named
`EmptyState`, used across 43 files. `scripts/generate-design-system-adoption.mjs` (line ~1562)
credits a component with test coverage by testing `new RegExp("\\b" + name + "\\b")` against
raw test-file **text**, with no import-path awareness. Because my original test file used the
bare word `EmptyState` throughout (in the import, JSX, and describe-block names), the adoption
manifest regenerated by my original commit credited
`tests/caring-contacts-empty-state.dom.test.tsx` as proof coverage for the unrelated
`ui-primitives.tsx` `EmptyState` — a false claim about what that primitive's own tests actually
exercise, in a generated governance artifact.

Fixed by renaming everywhere: the exported function and every type
(`ListEmptyStateProps`/`ListEmptyStateNoDataProps`/`ListEmptyStateFilteredProps`/
`ListEmptyStateAction`), the file (`empty-state.tsx` → `list-empty-state.tsx`, via `git mv`, so
git recorded it as a 54%-similarity rename rather than a delete+add), and every usage and
describe-block name in the test file. Confirmed no stray bare occurrence remains:
`grep -noE '\bEmptyState\b' tests/caring-contacts-empty-state.dom.test.tsx` returns nothing
(exit 1, no matches). `ListEmptyState` does not match `\bEmptyState\b` — the character
immediately before "EmptyState" in "ListEmptyState" is `t`, a word character, so there is no
word boundary there for the regex to anchor on.

**Manifest diff, before vs. after the rename** (regenerated both times with `npm run
design-system:adoption:update`):

```
733d732
<         "tests/caring-contacts-empty-state.dom.test.tsx",
```

That line sat inside the `ui-primitives.tsx` `EmptyState` component's entry (confirmed by
context: `"preview": ".design-sync/previews/EmptyState.tsx"` a few lines above it in the same
object) and is now gone. `git diff --stat docs/design-system/adoption-manifest.json` after the
rename: `1 file changed, 1 deletion(-)` — exactly that one line, nothing else in the manifest
moved.

Source-file comments in `list-empty-state.tsx` do mention the word `EmptyState` in prose (to
explain the collision this rename fixes). That is safe: the adoption script's raw-text matcher
only scans files under `tests/`; comments inside `src/` files are read only through
`importFacts`, which parses actual TypeScript import declarations via the `typescript` compiler
API (`scripts/generate-design-system-adoption.mjs` around line 897) rather than matching raw
text, and `list-empty-state.tsx` contains no import of `EmptyState` from `ui-primitives.tsx` at
all.

### Important 3 — accessible `role="group"` for the whole component

`automated-state.tsx` wraps its three pieces (state, "Why:", "What changes it:") in
`role="group"` named by `aria-label`, specifically so a screen reader that reaches the state has
entered a named group and finds the reason and the remedy without hunting elsewhere on the
page. `ListEmptyState`'s `"filtered"` branch has the identical three-piece shape (heading,
"Why:", "What changes it:") and had no grouping at all before this fix.

Ruling 81 forbade _rendering_ `AutomatedState`, not reusing its accessible structure — the
review brief should have said so, and this fix applies the same structure without importing or
rendering `AutomatedState` itself.

**Applied to the whole component, both kinds, not only `"filtered"`.** The outer `<div>` now
carries `role="group"` and `aria-label={props.heading}`. Reasoning: `"no-data"` has the same
two-piece shape (heading + one explanatory paragraph) and gains the identical benefit — a named
group a screen reader can enter and read straight through. Applying it uniformly means the
workspace's four list screens learn one grouping pattern for this component regardless of
`kind`, rather than a `"filtered"`-only special case a future reader would have to notice and
ask why it wasn't symmetric. It costs nothing: `"no-data"` had no competing structure to
disturb.

Uses `aria-label`, not `aria-labelledby` — the same hook-avoiding technique
`automated-state.tsx` already proves safe, and for the identical reason: `aria-labelledby`
needs an `id`, an `id` in this codebase's convention would come from `useId`, and `useId` is a
hook that would force this Server Component to become a Client Component (Ruling 13 again).

Two new tests (numbers 4 and 8 in the test list above) assert the group and its accessible name
for each kind; both are part of the `Tests 11 passed (11)` count reported throughout this round.

## Full verification chain

### Original build (commit `c0f84112f`)

All four commands were run for real, after the code was final for that commit (post-icon-fix),
and each decisive line was read from the actual command output — not inferred from an exit
code.

1. `npx vitest run tests/caring-contacts-empty-state.dom.test.tsx`: `Test Files 1 passed (1)` /
   `Tests 9 passed (9)`.
2. `npm run test` (full unit suite): `Test Files 1 failed | 812 passed | 3 skipped (816)` /
   `Tests 2 failed | 9794 passed | 74 skipped (9870)` — the one failing file was
   `tests/gate-receipts.test.ts`, both failures the pre-declared Windows `chmodSync`
   environmental noise (`core.fileMode=false` cannot represent Unix file-mode bits), no others.
3. `npm run typecheck`: contended for the repo's heavy-run lease twice (another session's
   Playwright run, then a separate session `favourites-mockups-20260824`) before it ran.
   Decisive line once it acquired the lease: `[gate-receipts] recorded a pass for
"typecheck:internal" (5215 input files).`, exit 0.
4. `npm run lint`: acquired the lease on the first attempt. Decisive line: `[gate-receipts]
recorded a pass for "lint:internal" (5216 input files).`, exit 0.

### Fix round 1 (commit `191761fc6`)

Committed before running any gate, per the coordinator's explicit instruction after the earlier
lock contention. All four ran to real, decisive results this round — no lock-acquisition
failure needed reporting.

1. `npx vitest run tests/caring-contacts-empty-state.dom.test.tsx` (post-rename,
   post-accessible-group, pre-mutation and again post-revert): `Test Files 1 passed (1)` /
   `Tests 11 passed (11)`, both times.
2. `npm run test` (full unit suite, run in the background under `run_in_background` because it
   exceeded the tool's foreground timeout — the completion notification carried the same
   summary line read below): `Test Files 1 failed | 812 passed | 3 skipped (816)` / `Tests 2
failed | 9796 passed | 74 skipped (9872)`. Same one failing file, same two named
   `gate-receipts.test.ts` file-mode failures as the original run, no others. (Total test count
   rose by 2 versus the original build's `9870`, matching the 2 new accessible-group tests
   added this round.)
3. `npm run typecheck`: acquired the lease on the first attempt this round. Decisive line:
   `[gate-receipts] recorded a pass for "typecheck:internal" (5217 input files).`, exit 0.
4. `npm run lint`: acquired the lease on the first attempt. Decisive line: `[gate-receipts]
recorded a pass for "lint:internal" (5217 input files).`, exit 0.

No gate reported a lock-acquisition failure in this round. The earlier
`DATABASE_HEAVY_RUN_ADMISSION_BUSY` responses (both rounds, while other sessions on this machine
held the shared heavy-run lease) were reported as "blocked, retry" in-conversation and never
treated as a pass or a fail; none of the numbers above come from a run that hit that condition.

## Constraints check

- Design tokens only — confirmed by inspection; no hex anywhere in the file.
- No `<button>` rendered by `ListEmptyState` itself, so the `min-h-12` / native-`disabled`-vs-
  `aria-disabled` rule doesn't apply to this file directly; documented in the action-prop
  comment that it applies to whoever builds the action node.
- No `title` attribute carries `because`/`changedBy` — proven by the "never in a title alone"
  test.
- No import from `src/components/caring-contacts/mockups/**`.
- `automated-state.tsx`, `shell.tsx`, and all routes are untouched across both commits (`git
diff` confirms only `list-empty-state.tsx`, its test file, and the regenerated adoption
  manifest).
- No dependency added — only lucide-react (already a dependency) and `react`'s `ReactNode` type.
- Not wired into any screen.

## Concerns / notes for the next task

- None that block. The one design decision worth flagging explicitly for whoever writes the
  four list screens: `action` is a `ReactNode` slot, not a `{ label, href }`-style prop,
  specifically so this component never needs a client boundary. Callers must build their own
  `<Link>` / `UnavailableDestination` / form-submit control and pass the finished element in.
  This was reviewed and upheld — see "What was built" above.
- The icon choice (`FolderOpen` for `"no-data"`, `SearchX` for `"filtered"`) is a judgement
  call, not dictated by either brief; it's easy to swap if a later task's owner wants different
  icons, as long as the replacement doesn't collide with `CARING_CONTACTS_PROHIBITED_LANGUAGE`
  the way `Inbox` did — that scan was reviewed and will not be narrowed.
- The `role="group"` wrapper is applied to the whole component (both kinds), which was a
  judgement call within the fix-round-1 brief's discretion ("apply it to the whole component if
  that reads more consistently — your call"). If a later reviewer would rather it were
  `"filtered"`-only, that is a small, contained change to `list-empty-state.tsx`'s outer `<div>`
  plus removing the `"no-data"` accessible-group test.
