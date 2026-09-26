# Task 1 brief — the shared empty-state component

**Plan:** `docs/superpowers/plans/2026-08-24-caring-contact-phase-2b-screens.md`, Group 0, Task 1.
**These are your requirements.**

Caring Contacts is a suicide-prevention prototype. Every patient and number is invented and nothing is
ever sent. Phase 2A built the shell, the sealed domain, the storage and the API. Phase 2B builds the
clinician screens, and **four of them are lists** — patients, schedule, templates, team. **No
empty-state component exists anywhere in the workspace today.** You are building the one they share,
before any of them is written, so that four screens cannot each invent their own.

## What you are building

`src/components/caring-contacts/workspace/list-empty-state.tsx`, exporting `ListEmptyState`.

> **Renamed after this brief was written.** The brief originally said `empty-state.tsx` /
> `EmptyState`. Ruling 88 renamed both: `src/components/ui-primitives.tsx` already exports an
> `EmptyState`, and the design-system adoption generator matches test files to components by a
> bare `\bEmptyState\b` regex with no import awareness — so the collision credited this task's
> test as proof coverage for a shared primitive it never imports. The path is corrected here so
> the reference resolves; the naming instruction above was mine and the collision was my defect.

It renders a heading, a plain-words explanation, and **at most one action**.

**It must distinguish two different emptinesses, because they need different words and a clinician
who cannot tell them apart cannot act:**

| Kind         | Means                                                     | Must tell the reader                                          |
| ------------ | --------------------------------------------------------- | ------------------------------------------------------------- |
| `"no-data"`  | Nothing exists yet — no patients, no templates, no team   | That the list is genuinely empty, and how a first one arrives |
| `"filtered"` | Things exist, but the current filter or search hides them | **Why** they are hidden, and **what would change it**         |

A `"filtered"` empty list that says only "Nothing to show" is the defect this task exists to prevent:
it is indistinguishable from "there are no patients", and it invites a clinician to conclude a
caseload is empty when it is not.

Model it as a discriminated union on `kind`, so the `"filtered"` variant cannot be constructed without
its reason and its remedy. **Do not make those optional strings on one flat props type** — an optional
reason is a reason that will be omitted.

## Match the component beside it, and read it first

`src/components/caring-contacts/workspace/automated-state.tsx` is the closest sibling and the
established pattern here. Read it before writing anything. In particular:

- **It is a Server Component with no hooks, deliberately.** Ruling 13 keeps this workspace's client
  payload to a rounding error, and `AutomatedState` avoids `useId` for exactly that reason. Your
  component must not introduce a `"use client"` boundary or any hook.
- **State is carried by words and an icon, never by colour alone** — anything that reads as nothing in
  greyscale, in forced colours, or to a colour-blind clinician has failed to state anything.
- **A reason is never carried by a `title` attribute**, because a hover reason is unreachable for a
  keyboard or screen-reader user.
- The `"filtered"` variant should reuse `AutomatedState`'s **"Why: … / What changes it: …" wording
  shape**, so a clinician learns one pattern across the workspace.

**Ruling 81, so you do not have to decide it:** `EmptyState` is its own component and does **not**
render `AutomatedState` internally. They have different triggers — `AutomatedState` is for the system
acting on its own (paused, suppressed, escalated), while an empty list is usually the user's own
filter or simply nothing existing yet. Its `CircleAlert` icon and its state-name `aria-label` are both
wrong for "no patients yet". Reuse the _wording shape_, not the component.

## The action

At most one, and optional. When present it is a real control — this repository fails the build on a
`<button>` that does nothing. Either give it an `onClick`, make it a submit inside a form, or wrap it
in a `<Link>`. If a caller wants an action that is not yet available, that is
`UnavailableDestination`'s job, not yours — do not build a second disabled-button pattern.

Never both native `disabled` and `aria-disabled` on one control; lint fails on the pair.

## Constraints

- **Design tokens only** — no hardcoded hex. Follow `automated-state.tsx`'s token usage exactly.
- **Tap targets are `min-h-12` (48px)** if you render a control. Do **not** use `min-h-11`; that
  reintroduces a known `ui-smoke` flake, whatever generic accessibility guidance says.
- **Forced colours** must be handled the way `automated-state.tsx` handles them
  (`forced-colors:border-[CanvasText]` and friends).
- Text wrapping uses `max-w-[var(--measure)]`, as the sibling does.
- No import from `src/components/caring-contacts/mockups/**` — production code may never do that.

## Tests — `tests/caring-contacts-empty-state.dom.test.tsx`

1. `"no-data"` renders its heading and explanation and does **not** render a "Why"/"What changes it"
   pair.
2. `"filtered"` renders both the reason and the remedy, and both are in the accessible name/description
   path — not in a `title`.
3. The optional action renders when given and is genuinely actionable; nothing renders when omitted.
4. Rendering is stable at a 320px-width container.
5. A forced-colors assertion consistent with how the existing workspace tests do it — look at how
   `automated-state` or the service-state banner is covered and follow that, rather than inventing a
   new approach.

**Then deliberately break it and confirm the right test goes red.** The mutation that matters here:
make the `"filtered"` variant render the same output as `"no-data"` (drop the reason and remedy) and
confirm test 2 fails. **Check first that your mutation actually changes a value some assertion reads**
— a mutation that leaves every asserted value unchanged proves nothing however red the suite goes. A
mutation in this repo recently failed to apply silently while its gate still reported `32 passed`,
which would have supported exactly the wrong conclusion. Prove the mutation is in the tree.

## Do NOT

- Do not wire this component into any screen. Task 4 and the group tasks do that. Your task ends at
  the component and its tests.
- Do not modify `automated-state.tsx`, `shell.tsx`, or any route.
- Do not add a dependency.

## Gates before you report

- `npm run test:focused -- --files <your test file>` while iterating.
- Then the **full `npm run test`** — this tree is policed by static scans living in files your diff
  will not contain, which is how a real failure once survived two tasks here.
- `npm run typecheck` and `npm run lint`.
- **Never report a gate as passing from an exit code.** Paste the decisive `N passed` line.

## Report

Write your full report to `docs/caring-contacts/phase-2b-sdd-archive/task-1-report.md`, then return
ONLY: status, commit SHAs, a one-line test summary, and your concerns. Do not paste the report into
your reply. Do not dispatch subagents. Commit locally; **do not push and do not open a pull request.**
