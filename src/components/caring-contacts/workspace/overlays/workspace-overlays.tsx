"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { CARING_CONTACTS_OVERLAY_PARAM, canonicalCaringContactsQuery } from "@/lib/caring-contacts/workspace-address";

import type { WorkspaceOverlayDefinition } from "./definitions";
import {
  clearStagedWorkspaceOverlayCommit,
  commitForHistoryEntry,
  consumeWorkspaceOverlayCommit,
  commitRefusalFor,
  nextWorkspaceOverlayCommitToken,
  noStagedWorkspaceOverlayCommit,
  readStagedWorkspaceOverlayCommit,
  stageWorkspaceOverlayCommit,
  subscribeToStagedWorkspaceOverlayCommit,
  type OverlayFact,
  type OverlayField,
  type WorkspaceOverlayCommit,
} from "./overlay-commits";
import { OverlayHost } from "./overlay-host";

/**
 * The client boundary the overlay host needs, and nothing else.
 *
 * `shell.tsx` is a Server Component, and must stay one: it is handed the whole
 * service-wide safety-stop record, whose incident note is free text a responder
 * typed mid-incident. A `"use client"` boundary serialises its props into the
 * payload the browser can read, so the shell cannot become a client component
 * and cannot pass functions across the boundary either — `OverlayHostProps` takes `onClose` and `onCommit`,
 * and functions are not serialisable (Next 16, "Server and Client Components":
 * props passed to Client Components must be serializable).
 *
 * So this file exists because the framework requires it, not because a design
 * preferred it: it owns the open-overlay state and the two handlers on the client
 * and renders `OverlayHost` with the pinned props unchanged. It receives NO props
 * at all, which is what keeps that record on the server.
 *
 * Rule 7: the open overlay is represented in the URL as `?overlay=<id>`, so the
 * browser's own Back button closes it. That state is read and written with the
 * native History API rather than `useSearchParams`/`useRouter`, for two reasons
 * Next 16 is explicit about:
 *
 *  - `window.history.pushState`/`replaceState` "integrate into the Next.js
 *    Router" and are the documented way to keep a piece of query state
 *    ("Linking and Navigating → Native History API").
 *  - `useSearchParams` makes the whole client subtree up to the nearest
 *    `<Suspense>` boundary client-rendered, and a statically rendered page that
 *    calls it without one fails the production build. Overlay state is transient
 *    interface state that no server render ever reads, so paying that cost —
 *    and adding a Suspense boundary to the shell for it — would buy nothing.
 */

/**
 * The one query parameter that names an open overlay.
 *
 * Re-exported from the sealed `workspace-address` module rather than declared here, so the overlay
 * writer below and the address allowlist it now builds from cannot name it differently. Every
 * existing importer of this constant is unaffected.
 */
export const WORKSPACE_OVERLAY_PARAM = CARING_CONTACTS_OVERLAY_PARAM;

/**
 * `pushState` fires no event of its own, so the writer below announces its own
 * change. `popstate` covers Back and Forward; nothing else in this workspace
 * writes this parameter.
 */
const OVERLAY_URL_CHANGED_EVENT = "caring-contacts:overlay-url-changed";

function subscribeToOverlayParam(onStoreChange: () => void) {
  window.addEventListener("popstate", onStoreChange);
  window.addEventListener(OVERLAY_URL_CHANGED_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("popstate", onStoreChange);
    window.removeEventListener(OVERLAY_URL_CHANGED_EVENT, onStoreChange);
  };
}

function readOverlayParam(): string | null {
  return new URLSearchParams(window.location.search).get(WORKSPACE_OVERLAY_PARAM);
}

/** The server never has a URL to read here, and never renders an overlay. */
function noOverlayParam(): string | null {
  return null;
}

function subscribeToOnlineStatus(onStoreChange: () => void) {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);
  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
}

function readOnlineStatus(): boolean {
  return typeof navigator !== "undefined" ? navigator.onLine : true;
}

function noOnlineStatus(): boolean {
  return true;
}

/**
 * The address of a history entry this module writes.
 *
 * IT CANONICALISES RATHER THAN COPIES, and that is a patient-confidentiality fix rather than a
 * tidy-up. This function used to build each entry from `new URLSearchParams(window.location.search)`
 * -- every parameter already on the address, carried into every entry it pushed. The shell mounts
 * this module on EVERY workspace route, so a bookmarked `?q=<name>` opened on any of them was
 * written into a fresh history entry every time a coordinator opened an overlay: one name in the
 * address bar became one name per overlay open, in the history of a possibly-shared ward computer.
 * Ruling [111] forbids a patient's name in an address at all, and copying one is not a smaller
 * version of putting one there.
 *
 * THE FIX LIVES HERE, in the one function both `pushState` and `replaceState` go through, rather
 * than in each route's page. The defect was never route-specific -- it was this copy -- so a
 * per-route fix would be four copies of one answer and would miss the fifth route somebody adds.
 * `canonicalCaringContactsQuery` names what may be kept (`workspace-address.ts`) instead of
 * deleting what may not, so a parameter nobody has thought of yet is dropped rather than carried.
 *
 * WHAT IT DOES NOT GUARANTEE, stated because the difference from the Patients page is a finding.
 * That page strips by a server `redirect()` before any read, so a dropped value never reaches an
 * access record and the arrival entry itself is replaced. This runs in the browser and only when an
 * overlay opens or closes, so on the other routes a bookmarked name is still in the address bar on
 * arrival, is still in that request's server log, and stays on the entry the coordinator arrived on
 * until the first overlay interaction rewrites it. This stops the multiplication and the leak into
 * every subsequent entry; it does not give those routes the Patients page's property. See the
 * report for the recommendation.
 *
 * The hash is carried through unchanged, as it always was. Nothing in this workspace writes one, a
 * hash is never sent to the server, and stripping it would break any in-page anchor -- but a
 * bookmarked `#<name>` would survive this function, which is the residual worth knowing about.
 */
function overlayUrl(id: string | null) {
  const query = canonicalCaringContactsQuery(window.location.search, { overlay: id });
  return `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
}

/**
 * The marker this module writes into the history entry it pushes to open an
 * overlay, so closing can tell "an entry I pushed" from "the entry the user
 * arrived on".
 *
 * It lives in `history.state` rather than in a module variable, and that is a
 * correctness choice rather than a stylistic one. A module variable describes the
 * TOP of the stack only, and nothing keeps it true: the user pressing Back, a
 * forward traversal, a second mount, or a test that traverses history directly all
 * leave it stale, and a stale `true` means `back()` on an entry this module never
 * pushed. `history.state` is per-entry, so every traversal brings its own answer
 * with it and there is nothing to reset. It is also namespaced, because Next.js
 * keeps its own router bookkeeping in the same object.
 *
 * Failure direction is the safe one: if the marker is ever lost — Next replacing
 * state on its own navigation, say — close falls through to `replaceState`, which
 * still removes the parameter and never navigates the user anywhere.
 */
const OVERLAY_HISTORY_MARKER = "caringContactsOverlayEntry";

/**
 * The token naming the staged commit this entry was opened with, if a control
 * opened it.
 *
 * It lives beside the marker above and for the identical reason, which is worth
 * stating rather than inheriting: it is per-ENTRY. A module variable would
 * describe the top of the stack only, and Back, Forward, a second mount or a test
 * traversing history directly would each leave it stale — and a stale token means
 * a commit answering an overlay it was never staged for. `history.state` brings
 * its own answer along with every traversal, so there is nothing to reset.
 *
 * Absent on an entry nobody opened from a control: a deep link, the entry the user
 * arrived on, or the entry `history.back()` unwinds to. That absence IS the
 * deep-link case, and the host reads it as "nothing is staged for this".
 */
const OVERLAY_COMMIT_TOKEN = "caringContactsOverlayCommitToken";

function overlayHistoryState(): Record<string, unknown> | null {
  const state: unknown = window.history.state;
  return typeof state === "object" && state !== null ? (state as Record<string, unknown>) : null;
}

function currentEntryWasPushedByThisModule(): boolean {
  const state = overlayHistoryState();
  return state !== null && OVERLAY_HISTORY_MARKER in state;
}

/** The commit token the current history entry carries, or null. */
function readEntryCommitToken(): string | null {
  const token = overlayHistoryState()?.[OVERLAY_COMMIT_TOKEN];
  return typeof token === "string" ? token : null;
}

/** The server has no history to read, so no entry ever carries a token there. */
function noEntryCommitToken(): string | null {
  return null;
}

function pushOverlayEntry(id: string, commitToken: string | null) {
  const state: Record<string, string> = { [OVERLAY_HISTORY_MARKER]: id };
  if (commitToken !== null) state[OVERLAY_COMMIT_TOKEN] = commitToken;
  window.history.pushState(state, "", overlayUrl(id));
  window.dispatchEvent(new Event(OVERLAY_URL_CHANGED_EVENT));
}

/**
 * Opening pushes, so Back closes the overlay — that is the browser-history
 * support rule 7 asks for.
 *
 * This form carries NO commit, so the overlay it opens is in the same position as
 * a deep link: its decision cannot be recorded, and a recording row says so. Use
 * `openWorkspaceOverlayWithCommit` from a control.
 */
export function openWorkspaceOverlay(id: string) {
  pushOverlayEntry(id, null);
}

/**
 * Closing UNWINDS the entry opening pushed; it never pushes another.
 *
 * Pushing on close was the first version and it was wrong in two ways at once:
 * the stack became `[page, ?overlay=x, page]`, so pressing Back after dismissing
 * walked forward into the dismissed modal and reopened it, and every open/close
 * cycle grew the stack by two entries with nothing to unwind them.
 *
 * `history.back()` is correct only when this module put that entry there. A
 * deep link — someone arriving on `?overlay=x` directly, or with the workspace
 * as their first entry — has no entry of ours to unwind, and calling `back()`
 * would take them out of the workspace entirely. That case replaces the current
 * entry instead, which still satisfies rule 7's "closing removes the parameter"
 * and leaves the stack exactly as deep as it was.
 */
export function closeWorkspaceOverlay() {
  if (currentEntryWasPushedByThisModule()) {
    // `popstate` fires from the traversal itself, so no announcement is needed
    // — and announcing here would report the pre-traversal URL.
    window.history.back();
    return;
  }
  window.history.replaceState(null, "", overlayUrl(null));
  window.dispatchEvent(new Event(OVERLAY_URL_CHANGED_EVENT));
}

/**
 * Opens an overlay AND states what confirming it does, in that order.
 *
 * This is the only way a control in the workspace opens an overlay: `commit` is
 * required, so a control cannot raise a decision surface it has not wired
 * (Ruling 87). `openWorkspaceOverlay` above stays available unchanged for the
 * URL-only case its own tests cover, and is deliberately NOT the trigger's route.
 *
 * Staging first is the ordering `overlay-commits.ts` documents: both writes are
 * synchronous, so the host's first render carrying the new entry already carries
 * its commit and never passes through a frame where the overlay is open with
 * nothing staged. The token binds the two together, so the commit answers THIS
 * entry and no other.
 */
export function openWorkspaceOverlayWithCommit(
  id: string,
  commit: WorkspaceOverlayCommit,
  facts?: readonly OverlayFact[],
  field?: OverlayField,
) {
  const token = nextWorkspaceOverlayCommitToken();
  stageWorkspaceOverlayCommit(token, commit, facts, field);
  pushOverlayEntry(id, token);
}

export function WorkspaceOverlays() {
  const openOverlayId = useSyncExternalStore(subscribeToOverlayParam, readOverlayParam, noOverlayParam);
  const entryCommitToken = useSyncExternalStore(subscribeToOverlayParam, readEntryCommitToken, noEntryCommitToken);
  const slot = useSyncExternalStore(
    subscribeToStagedWorkspaceOverlayCommit,
    readStagedWorkspaceOverlayCommit,
    noStagedWorkspaceOverlayCommit,
  );

  /**
   * A failure from an asynchronous `record`, held so it can be raised during
   * render (fix round 1, Important 4).
   *
   * A rejection cannot be allowed to stay in the promise: the overlay has already
   * closed by then, so the clinician would be looking at a screen that gave every
   * appearance of having recorded the decision while nothing was written and
   * nothing was said. Re-raising it during render is what puts it in front of
   * `src/app/caring-contacts/error.tsx`, which states plainly that nothing was
   * sent and nothing was changed. It is stored wrapped, because a promise may
   * reject with `undefined` and a bare `unknown` could not then be told apart
   * from "no failure".
   */
  const [commitFailure, setCommitFailure] = useState<{ readonly error: unknown } | null>(null);
  if (commitFailure !== null) throw commitFailure.error;

  /**
   * What the control that opened THIS history entry said confirming it does — or
   * null, when nothing was staged for it and the decision cannot be recorded.
   */
  const commit = commitForHistoryEntry(slot, entryCommitToken);
  const commitRefusal = commitRefusalFor(commit);
  // Shown only for the entry they were staged with, exactly as the commit is.
  const facts = slot !== null && commit !== null ? (slot.facts ?? null) : null;
  const field = slot !== null && commit !== null ? (slot.field ?? null) : null;

  /**
   * The slot belongs to one history entry, and this is the ONE place it is
   * emptied (fix round 1, Importants 2 and 3).
   *
   * Reconciling here rather than clearing inline is what makes both of those
   * true at once. Inline clearing at the end of a confirm handler ran while the
   * URL still named the overlay — `history.back()` fires `popstate`
   * asynchronously — so React re-rendered the still-open overlay with an empty
   * slot and flashed the refusal at a clinician who had just confirmed a
   * withdrawal. And clearing in `close` covered only the Sheet's own dismissals:
   * Back, the workspace's primary route out, closes through `popstate` and never
   * calls `onClose` at all, so the slot outlived it.
   *
   * A traversal changes the entry, the entry changes the token, and a slot that no
   * longer names the current entry is emptied — whatever route got us here.
   */
  useEffect(() => {
    if (slot !== null && slot.token !== entryCommitToken) clearStagedWorkspaceOverlayCommit();
  }, [slot, entryCommitToken]);

  const close = useCallback(() => {
    closeWorkspaceOverlay();
  }, []);

  /**
   * Read-only rows are exits and recovery actions, not records. Mutating rows
   * atomically claim the staged commit before invoking it, so a second activation
   * while history.back() is still pending cannot produce a duplicate write.
   */
  const recordDecision = useCallback(
    (definition: WorkspaceOverlayDefinition, fieldValue?: string) => {
      if (!definition.mutatesState) {
        closeWorkspaceOverlay();
        return;
      }

      const activeCommit = consumeWorkspaceOverlayCommit(entryCommitToken);
      // A consumed or stale token means another activation has already started
      // closing this entry. It is intentionally a no-op.
      if (activeCommit === null) return;
      if (activeCommit.kind !== "record") {
        throw new Error(`The overlay "${definition.id}" attempted to record from a non-recording commit.`);
      }

      // Promise.resolve rather than instanceof Promise: a Server Action's return
      // value need only be thenable, and a synchronous record returning undefined
      // costs one already-resolved promise.
      void Promise.resolve(
        // Only a row whose control asked for a free-text box hands one on; every other row records
        // exactly as it always has, with the overlay's id alone.
        fieldValue === undefined ? activeCommit.record(definition.id) : activeCommit.record(definition.id, fieldValue),
      ).catch((error: unknown) => {
        setCommitFailure({ error });
      });
      closeWorkspaceOverlay();
    },
    [entryCommitToken],
  );

  const isOnline = useSyncExternalStore(subscribeToOnlineStatus, readOnlineStatus, noOnlineStatus);
  const blockReason = !isOnline
    ? "connection-unavailable"
    : openOverlayId === "permission-unavailable"
      ? "permission-unavailable"
      : null;

  return (
    <OverlayHost
      openOverlayId={openOverlayId}
      onClose={close}
      onCommit={recordDecision}
      blockReason={blockReason}
      commitRefusal={commitRefusal}
      facts={facts}
      field={field}
    />
  );
}
