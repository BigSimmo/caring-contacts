"use client";

import type { ReactNode } from "react";

import { cn } from "@/components/ui-primitives";

import { overlayDefinition, type NonMutatingOverlayId } from "./definitions";
import { OVERLAY_TRIGGER_CLASS } from "./overlay-trigger";
import { openWorkspaceOverlay } from "./workspace-overlays";

/**
 * The trigger for an overlay whose decision control is an EXIT rather than a confirmation -- the
 * rows the frozen table marks `mutatesState: false`.
 *
 * ## The tension this module exists to resolve, stated rather than papered over
 *
 * Ruling 87 makes {@link WorkspaceOverlayTrigger}'s `commit` required AT THE TYPE LEVEL so a screen
 * cannot open a decision surface it has not wired, and `overlay-commits.ts` deliberately offers no
 * no-op member of `WorkspaceOverlayCommit`. That requirement is right, and it was derived from the
 * rows that record something.
 *
 * It meets a row it was not derived from here. `delivery-detail` is `mutatesState: false` and its
 * decision is "Close this detail" -- Ruling 90 already established, for `commitRefusalFor`'s scope,
 * that those eight controls "are not confirmations -- they are EXITS", and that refusing one renders
 * a sentence that is FALSE about a control whose whole action is to leave. So:
 *
 *  - `{ kind: "unavailable", reason }` is the wrong answer. Its scope is `every-row`, so the host
 *    would `aria-disabled` the exit and print a refusal beside it -- the exact defect Ruling 90
 *    fixed, reintroduced from the caller's side instead of the host's.
 *  - `{ kind: "record", record: () => {} }` is the silent no-op Ruling 87 exists to prevent. Nothing
 *    reaching the host distinguishes "this row records nothing" from "somebody satisfied the
 *    compiler", and that is true wherever the empty function is written -- inline at a call site, or
 *    named and documented in a module like this one.
 *
 * **So this component stages NOTHING, and the absence is the correct value rather than a missing
 * one.** It opens through `openWorkspaceOverlay`, which pushes the overlay's history entry with no
 * commit token; `commitRefusalFor(null)` then answers `NO_STAGED_COMMIT_REASON` with
 * `scope: "recording-rows-only"`, and the host WITHHOLDS a recording-only refusal from a row that
 * records nothing -- so the exit stays live. That path is machinery Ruling 90 already built for
 * exactly this case, and `tests/caring-contacts-overlay-trigger.dom.test.tsx`'s "a row that records
 * nothing keeps its way out" loop already proves it for every non-recording row in the table.
 *
 * ### The adjudication that produced this file, because the alternative was live for a while
 *
 * Two implementations of this component existed at once, on two branches, at two paths -- so they
 * survived the merge without a conflict and both were imported. The other one delegated to
 * {@link WorkspaceOverlayTrigger} and staged `{ kind: "record", record: closingIsTheWholeAction }`,
 * an EMPTY NAMED FUNCTION arguing that the host's own close is the whole action. The argument is
 * true and it is not enough: naming the empty function documents the intent in the SOURCE, and the
 * host reads the staged commit, not the source. A no-op record commit tells the host this decision
 * is wired and records nothing, which is the one shape the type system cannot see through.
 *
 * `WorkspaceOverlays.recordDecision` calls the commit and then calls `closeWorkspaceOverlay()`
 * unconditionally, so "Close this detail" is performed in full with nothing staged. There was never
 * anything for the commit to do; the fix is to stop claiming there was.
 *
 * ## Why it is a component and not an exported commit value
 *
 * Every screen in this workspace is a Server Component, and a Server Component cannot pass a
 * function across the client boundary at all (Next 16, "Server and Client Components": props passed
 * to Client Components must be serializable). A screen therefore passes an overlay id and a label,
 * both plain data, and the whole of the opening happens on this side of the seam. This module is a
 * client boundary for that structural reason AND for an ordinary interactive one: it renders a
 * button with an `onClick`.
 *
 * ## The finding this leaves open, which is the owner's to take
 *
 * `WorkspaceOverlayCommit` has no member meaning "this row's decision is an exit, and the host's own
 * close is the action". Staging nothing is the correct behaviour today and it is spelled as an
 * ABSENCE, so a reader of the host cannot tell an exit row apart from an overlay reached by address
 * without consulting the row. `data-overlay-trigger-kind="exit-only"` below closes that gap for a
 * TEST -- it makes "exit route, not no-op commit" assertable from the DOM rather than only from the
 * source -- but it does not close it for the host. Adding a member is a change to Task 3's pinned
 * contract and to the totality of `commitRefusalFor`, so it is reported rather than made here.
 */
export type ExitOnlyOverlayTriggerProps = {
  /**
   * An id from the frozen 24-row table whose row carries `mutatesState: false`.
   *
   * NARROWED AT THE MERGE, and this realises Ruling [130] rather than working around a merge error.
   * It was `string` on both of the implementations this file replaced; Task 14 narrowed
   * `WorkspaceOverlayTrigger`'s own prop to `WorkspaceOverlayId`, and taking the NON-MUTATING SUBSET
   * of that union here is the stronger of the two available repairs: wiring a recording row to an
   * exit-only trigger is now a COMPILE error at the call site instead of a throw at render.
   * {@link assertExitOnlyOverlayRow}'s runtime throw stays anyway -- it guards the untyped path, and
   * it is the only thing that catches a row whose `mutatesState` changes.
   */
  overlayId: NonMutatingOverlayId;
  /** The control's visible label, and therefore its accessible name. */
  children: ReactNode;
  className?: string;
};

/**
 * Refuses any row this component must not raise: one no frozen row carries, and one that records
 * something.
 *
 * Exported so a test can hold the guard directly rather than only through a rendered screen, and
 * typed `string` deliberately -- since Ruling [130] the ordinary way of getting this wrong is a
 * compile error, so what still reaches here is a cast, an `any`, or a value that entered the program
 * untyped, and a narrowed parameter could not express those at all.
 *
 * It throws at render, in every environment, which is the policy {@link WorkspaceOverlayTrigger} and
 * `blockReasonWording` already follow for an unknown id rather than a second policy invented here. A
 * mutating row raised as an exit would open a confirm control with nothing staged and get
 * `NO_STAGED_COMMIT_REASON` -- a refusal reading as though the screen were opened by address when a
 * control on it was pressed, which is a false statement to a clinician.
 */
export function assertExitOnlyOverlayRow(overlayId: string) {
  const definition = overlayDefinition(overlayId);
  if (definition === null) {
    throw new Error(
      `No overlay is defined for the id "${overlayId}". The 24 rows are frozen in ` +
        `overlays/definitions.ts, transcribed from docs/caring-contacts/interaction-matrix.md. ` +
        `A trigger for an id no row carries would open nothing.`,
    );
  }
  if (definition.mutatesState) {
    throw new Error(
      `The overlay "${overlayId}" records a decision (mutatesState: true), so its confirm control is ` +
        `not an exit and opening it with nothing staged would refuse it with the reason given to an ` +
        `overlay reached by address. Use WorkspaceOverlayTrigger and state the commit: a ` +
        `{ kind: "record" } commit that performs the write, or { kind: "unavailable", reason } ` +
        `saying in plain words what is not built yet.`,
    );
  }
}

export function ExitOnlyOverlayTrigger({ overlayId, children, className }: ExitOnlyOverlayTriggerProps) {
  assertExitOnlyOverlayRow(overlayId);

  return (
    <button
      type="button"
      data-testid="workspace-overlay-trigger"
      data-overlay-trigger={overlayId}
      data-overlay-trigger-kind="exit-only"
      onClick={() => openWorkspaceOverlay(overlayId)}
      className={cn(OVERLAY_TRIGGER_CLASS, className)}
    >
      {children}
    </button>
  );
}
