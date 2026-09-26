# Task 3 brief — the overlay trigger, and the commit contract that must ship with it

**Plan:** `docs/superpowers/plans/2026-08-24-caring-contact-phase-2b-screens.md`, Group 0, Task 3.
**These are your requirements.** Read Ruling 87 in `docs/caring-contacts/phase-2b-build-record.md`
before starting — it is why this task is shaped the way it is.

Caring Contacts is a suicide-prevention prototype. Nothing is ever sent to any number and every
patient is fictional. The 24 overlays are the workspace's **decision surfaces** — pause a plan,
withdraw a patient, change a contact's date, restart the service after an incident — not decorative
dialogs.

## What already exists — do NOT rebuild it

Read `src/components/caring-contacts/workspace/overlays/workspace-overlays.tsx` first.

- It is already a Client Component.
- `openWorkspaceOverlay(id)` is already exported and already DOM-tested. It pushes `?overlay=<id>`
  onto history so Back closes the overlay, and `closeWorkspaceOverlay()` handles the deep-link case
  where there is no pushed entry to go back to.
- All 24 overlays are already defined in `overlays/definitions.ts` and rendered by one data-driven
  host. **Zero are wired to a trigger** — every one is reachable only by typing the URL.

So this task is **not** an overlay-opening mechanism. It is the small control a Server Component
screen renders to call the mechanism that exists.

## The part that is easy to miss, and is the actual point of this task

`WorkspaceOverlays`' `commit` callback currently **closes the overlay and records nothing**. Its own
comment explains why that is acceptable today:

> "Nothing in the workspace opens an overlay yet — `?overlay=<id>` is reachable only by typing it — so
> no control in the interface currently advertises an action this does not perform."

**Your task is precisely what makes that clause false.** The moment a screen can open an overlay, its
confirm button becomes a control advertising an action the system does not perform — which is what
this repository's button-wiring gate exists to forbid, and what a real defect fixed on 2026-07-21 was.

**So the trigger and the commit contract ship together (Ruling 87):**

- The trigger component must **require** a commit handler from its caller. Not optional. Not defaulted
  to a no-op. A screen must be **unable to compile** if it opens an overlay it has not wired.
- Where an overlay's action genuinely is not built yet, the caller passes an explicit unavailable
  handler in the shape `unavailable-destination.tsx` already uses — `aria-disabled="true"`, an inert
  handler, a stated reason, an `sr-only` note. The control still says what it is. **Never native
  `disabled` together with `aria-disabled`; lint fails on the pair.**

**A mechanism that is safe only because nothing reaches it is not safe — it is unreached.** Before you
make something reachable, work out what its arrival makes true.

## What to build

1. A **Client Component** trigger — a button that opens a named overlay by calling
   `openWorkspaceOverlay`. Keep it as small as possible: Ruling 13 holds this workspace's client
   payload to a rounding error, and this is the second client boundary the workspace will have.
2. The **commit contract**: the type-level requirement above, plus whatever change to
   `WorkspaceOverlays` / `OverlayHost` is needed so a screen's commit handler actually reaches the
   overlay's confirm control instead of the current record-nothing callback.

Think carefully about where the handler lives. `WorkspaceOverlays` is rendered once by the shell, not
per screen, so a screen's handler has to reach it somehow — and the obvious answers (module-level
mutable state, a context provider) each have costs. **Choose deliberately and write down why in the
code**, including what you rejected. If the honest answer is that this needs a decision above your
level, say so in your report rather than picking silently.

## Constraints

- **The incident `note` must never reach a Client Component.** This is the CRITICAL-finding boundary
  of Phase 2A, enforced by type narrowing (`ServiceStopBannerFacts`), a separate anchors module, and a
  source-scanning test. Your client component must not import or accept anything carrying it.
- Design tokens only, no hardcoded hex. Tap targets `min-h-12` (48px) — **never `min-h-11`**, which
  reintroduces a known `ui-smoke` flake.
- Do not modify `definitions.ts` or the frozen 24-row contract in
  `docs/caring-contacts/interaction-matrix.md`.
- No import from `src/components/caring-contacts/mockups/**`.
- Never delete or loosen an existing assertion. The existing overlay DOM tests and the Playwright spec
  `tests/ui-caring-contacts-workspace.spec.ts` both cover this area — if one goes red, that is a
  defect in your change, not in the test. **In particular there is a Playwright test asserting focus
  returns to "the control an overlay was opened from"** — which until now has meant a synthetic
  control. Check what your change does to it.

## Tests

- A trigger opens the overlay it names, and Back closes it.
- **A trigger for a nonexistent overlay id fails loudly** rather than opening nothing.
- A screen supplying no commit handler does not compile — prove this with a type-level test if the
  repo has a pattern for it, or state plainly in your report that it is enforced only by the compiler
  and show the signature.
- The unavailable-handler path renders the `aria-disabled` shape with its reason reachable (not in a
  `title`).

**Then deliberately break each and confirm the covering test goes red.** Check FIRST that the mutation
changes a value some assertion actually reads. A mutation in this repo recently failed to apply
silently while its gate still reported `32 passed`, which would have supported exactly the wrong
conclusion — **prove the mutation is in the tree before believing any result.**

## Gates

`npm run test:focused -- --files <paths>` while iterating; then the **full `npm run test`**; then
`npm run typecheck` and `npm run lint`. **Never report a gate as passing from an exit code — paste the
`N passed` line.**

**Known environmental noise, not yours:** `tests/gate-receipts.test.ts` has exactly 2 failures on this
machine ("gate receipts — file modes", failing in `chmodSync`) because this Windows drive cannot
represent Unix file modes. Expect those two; report any others.

**If a gate cannot acquire the repository's heavy-run lease, that is "blocked, retry later" — not a
failure and not a pass.** Retry a couple of times, then report which gate did not run. Do not sit in a
retry loop. If the output carries no summary line, the run did not happen whatever the exit code says.

## Report

Write your full report to `docs/caring-contacts/phase-2b-sdd-archive/task-3-report.md`, then return
ONLY: status, commit SHAs, a one-line test summary, and your concerns. **Commit early — this machine
has destroyed working directories mid-session and a commit is what has survived.** Do not push and do
not open a pull request. Do not dispatch subagents.
