/**
 * What confirming an overlay's decision does, and how it reaches the one host.
 *
 * ## The problem this module exists to solve
 *
 * `WorkspaceOverlays` is mounted **once, by the shell**, as a **sibling** of
 * `children` — not per screen. So a screen's confirm behaviour has no shared
 * parent with the host and no prop path to it. Everything below is the record of
 * how that gap is bridged, and of the three alternatives that were rejected.
 *
 * A second constraint narrows it further, and it is easy to miss: the screens are
 * SERVER Components. A Server Component cannot pass a closure across the boundary
 * at all (Next 16, "Server and Client Components": props passed to Client
 * Components must be serializable). So "the screen's handler" can only ever be a
 * serialisable value — which is why {@link WorkspaceOverlayCommit} is a
 * discriminated union of intents rather than a bare function type. Its `record`
 * member is a function POSITION, satisfied from a Server Component by a Server
 * Action and from a Client Component by an ordinary function; its `unavailable`
 * member is plain data.
 *
 * ## The choice: a one-shot handoff bound to the history entry that opened it
 *
 * An overlay opening CARRIES ITS COMMIT WITH IT. The trigger mints a token,
 * stages the commit under that token, and pushes a history entry carrying the
 * same token alongside `?overlay=<id>`. The host offers the staged commit only
 * while the CURRENT history entry carries the token it was staged under.
 *
 * Binding to the entry rather than to the overlay id is fix round 1, Important 3,
 * and it is not a refinement — the id match narrowed the failure modes without
 * closing them. Three things it let through, all closed by the token:
 *
 *  - **Back.** Back closes an overlay through `popstate`, which never calls the
 *    Sheet's `onClose`, so an id-keyed slot was never emptied on the workspace's
 *    PRIMARY dismissal route. The entry Back lands on carries no token, so the
 *    slot no longer matches and is emptied by the host's own reconciliation.
 *  - **A commit outliving its screen.** An id-keyed commit staged on one screen
 *    survived a client-side navigation and answered any later overlay of the same
 *    id — including, on a list screen, one row's commit answering an overlay
 *    raised from a different row, with nothing on screen naming the record. A
 *    later opening mints a NEW token, so the older slot can never answer it.
 *  - **A spent commit.** Confirming unwinds to an entry without the token, so the
 *    slot is emptied and a forward traversal finds nothing staged.
 *
 * Why a handoff at all, rather than a registry keyed by trigger: a list screen may
 * render ten `Pause` triggers, one per row. A registry keyed by overlay id would
 * have all ten claim the same key, and every way of resolving that is worse than
 * not having the problem — throw on the second registration and a legitimate
 * screen cannot be built; last-write-wins and the silent-overwrite failure is
 * back; compare handlers by identity and an inline arrow re-registers on every
 * render. Staging at the moment of activation has no conflict to resolve, because
 * exactly one control was activated.
 *
 * ## What was rejected, and why
 *
 * - **A React context provider.** Structurally impossible from a screen, not
 *   merely costly. The screen is a Server Component, so it cannot render a
 *   provider or hold context state; and `WorkspaceOverlays` is a SIBLING of
 *   `children` in the shell, so a provider rendered inside the screen would not
 *   contain the host even if the screen could render one. Making it work would
 *   mean a new client boundary wrapping the whole workspace — against Ruling 13,
 *   which holds this route's client payload to a rounding error — and the trigger
 *   would still have to write the commit into it on activation. That is this
 *   module's job, with more payload.
 *
 * - **A per-screen host.** Duplicates the renderer the shell mounts once. The
 *   shell's own comment says why it is mounted there: the interaction matrix is a
 *   workspace-wide contract, and a screen that forgot to mount the host would lose
 *   the session gate and the offline notice with it. Two hosts would also mean two
 *   subscribers to one `?overlay=` parameter, both rendering the same overlay, and
 *   `tests/ui-caring-contacts-workspace.spec.ts` asserts single occupancy of the
 *   overlay content node throughout.
 *
 * - **A registry written on mount.** Covered above; the ten-rows case kills it.
 *
 * ## The cost this design carries, stated rather than hidden
 *
 * Module-scoped mutable state is invisible coupling: nothing in a screen's source
 * shows that activating a trigger writes here. Two things pay that back, and both
 * are load-bearing rather than decorative:
 *
 *  1. The token match, and the reconciliation that follows it. A slot that does
 *     not belong to the current history entry is not merely withheld, it is
 *     emptied — so a stale commit does not sit in module scope for the tab's
 *     lifetime waiting for a coincidence.
 *  2. {@link commitRefusalFor} is TOTAL. Every state of the slot maps to an
 *     answer, and two of the three answers refuse in plain words.
 */

/**
 * What a screen says confirming this overlay's decision means.
 *
 * REQUIRED wherever it appears, and required at the type level rather than by
 * review (Ruling 87). There is no default and no no-op member: a screen that
 * opens an overlay it has not wired does not compile.
 */
export type WorkspaceOverlayCommit =
  | {
      readonly kind: "record";
      /**
       * Invoked once, with the overlay's id, when the decision is confirmed —
       * after the fresh-authentication checkpoint where the frozen table asks for
       * one, because the host runs that before it calls its commit at all.
       *
       * The return type ADMITS a promise deliberately (fix round 1, Important 4).
       * A Server Action is asynchronous, so the realistic implementation of this
       * member returns one; typing the position as bare `void` would have accepted
       * it by TypeScript's void-return rule while leaving the host structurally
       * unable to observe a rejection — an unhandled rejection, the overlay
       * already closed, and the clinician told nothing. That is the silent
       * "nothing happened" this whole task exists to remove, moved one layer down.
       * Widening it now also means the task that answers the question below does
       * not have to make a breaking signature change to do it.
       *
       * What the host does with a rejection today is the MINIMUM that is not
       * silent: it re-throws during render, so the failure reaches
       * `src/app/caring-contacts/error.tsx` instead of the console. What it
       * SHOULD do — hold the overlay open, name what was not written, offer a
       * retry — needs a real store and a real screen to answer, and neither
       * exists yet. That policy is deferred; the signature is not.
       */
      readonly record: (overlayId: string, fieldValue?: string) => void | Promise<void>;
    }
  | {
      readonly kind: "unavailable";
      /**
       * Plain words a clinician reads: what this decision cannot do yet, and why.
       * Sentence case, ending in a full stop. Not an identifier and not a key —
       * this is rendered verbatim, so it is written where it is passed.
       */
      readonly reason: string;
    };

/**
 * A commit staged for one history entry, named by the token that entry carries.
 *
 * The token, not the overlay id: see the header. It is opaque, and meaningful only
 * by comparison.
 */
export type StagedWorkspaceOverlayCommit = {
  readonly token: string;
  readonly commit: WorkspaceOverlayCommit;
  /** What the decision is about, shown in the overlay beside the frozen summary. See {@link OverlayFact}. */
  readonly facts?: readonly OverlayFact[];
  /** An optional free-text box the overlay shows above its decision. See {@link OverlayField}. */
  readonly field?: OverlayField;
};

/**
 * One fact the opening control hands the overlay to show: the patient being compared, the pathway a
 * plan will run. The frozen table fixes each overlay's title, summary and decision; these are the
 * specifics that sentence is about, rendered as a list beneath it.
 *
 * Staged in memory with the commit and bound to the same history-entry token, never written to the
 * URL or to `history.state`: a fact can be a patient's name, and an overlay opened by address shows
 * none.
 */
export type OverlayFact = { readonly label: string; readonly value: string };

/**
 * One optional free-text box a control asks its overlay to show, such as the short reason a
 * withdrawal may carry (owner-approved 2026-09-26). The overlay's frozen title, summary and
 * decision wording are untouched: the box is added beside them. What was typed is handed to the
 * commit's `record` as its second argument, exactly as typed -- the domain decides what blank means.
 */
export type OverlayField = { readonly label: string; readonly hint: string; readonly maxLength: number };

/**
 * A refusal standing in the way of an overlay's decision, and how far it reaches.
 *
 * The scope is the whole of Ruling 90, and it exists because the 24 rows are not
 * one kind of thing. See {@link NO_STAGED_COMMIT_REASON}.
 */
export type OverlayCommitRefusal = {
  /** Plain words, rendered verbatim. */
  readonly reason: string;
  /**
   * `every-row` — a screen stated this refusal deliberately, so it holds whatever
   * the row does. `recording-rows-only` — the refusal is about nothing being
   * recordable, which is not a claim that can be made about a row that records
   * nothing.
   */
  readonly scope: "every-row" | "recording-rows-only";
};

/**
 * The refusal shown when an overlay is open with no commit staged for its entry.
 *
 * True in every case that reaches it: a typed or pasted `?overlay=<id>`, an entry
 * whose staged commit was spent, or any entry this module did not open.
 *
 * **Its scope is `recording-rows-only`, and that is Ruling 90.** The first version
 * refused every row, and the review was right that this was wrong on a decidable
 * ground rather than a matter of taste. Eight of the twenty-four carry
 * `mutatesState: false`, and their controls are not confirmations — they are
 * EXITS: "Sign in again", "Try connecting again", "Try loading again", "Back to
 * the plan", "Back to personalisation", "Close this detail", "View the plan",
 * "Review the current version". None of them records anything, so none of them can
 * be a confirm control that records nothing, and Ruling 87 never reached them.
 * Refusing them also contradicted the host's own Rule 9 three lines from where the
 * refusal was applied, and rendered a sentence that was FALSE about a control
 * whose whole action is to leave.
 *
 * On two rows it was actively harmful. `session-expiry` and `offline-banner` are
 * `dismissal: "recovery-only"` — Escape and the backdrop are deliberately inert —
 * so refusing their single control left a person inside the one kind of overlay
 * they cannot walk away from with nothing to do at all.
 *
 * The general lesson, worth more than the fix: Ruling 87 was right, and it was
 * applied to a set whose members differ in exactly the property it depends on. Its
 * domain was assumed rather than checked, and the frozen matrix already carried
 * the `mutatesState` flag that answers it row by row.
 */
export const NO_STAGED_COMMIT_REASON =
  "This was opened by address rather than from a control, so nothing can be recorded here. Open it from the screen it belongs to.";

/**
 * A token is unique to one opening within one document.
 *
 * The counter alone would not do: history entries survive a reload while module
 * state does not, so a restored entry carrying `1` could be answered by the first
 * commit staged after the reload. The per-document prefix makes a token minted by
 * a previous document match nothing.
 */
const COMMIT_TOKEN_DOCUMENT = Math.random().toString(36).slice(2);
let commitTokenCounter = 0;

export function nextWorkspaceOverlayCommitToken(): string {
  commitTokenCounter += 1;
  return `${COMMIT_TOKEN_DOCUMENT}-${commitTokenCounter}`;
}

let staged: StagedWorkspaceOverlayCommit | null = null;
// Claiming a commit must be synchronous: two clicks can both arrive before the
// browser finishes the history traversal that closes the overlay.
const consumedCommitTokens = new Set<string>();
const listeners = new Set<() => void>();

function announce() {
  for (const listener of listeners) listener();
}

/**
 * Hands the commit to the host, under the token the opening entry will carry.
 *
 * Call this BEFORE pushing that entry: both writes are synchronous and React
 * batches the two store notifications into one render, so the host's first render
 * carrying the new entry already carries its commit. Staging afterwards would
 * render once with the overlay open and nothing staged — which the refusal above
 * would correctly, and wrongly, describe.
 */
export function stageWorkspaceOverlayCommit(
  token: string,
  commit: WorkspaceOverlayCommit,
  facts?: readonly OverlayFact[],
  field?: OverlayField,
) {
  if (staged !== null) consumedCommitTokens.delete(staged.token);
  consumedCommitTokens.delete(token);
  staged = {
    token,
    commit,
    ...(facts && facts.length > 0 ? { facts } : {}),
    ...(field !== undefined ? { field } : {}),
  };
  announce();
}

/**
 * Empties the slot.
 *
 * There is exactly ONE caller in the workspace, and that is deliberate: the host
 * reconciles the slot against the current history entry, so emptying is a
 * consequence of a traversal rather than something each interaction has to
 * remember. Clearing inline at the end of a confirm handler was fix round 1,
 * Important 2 — it emptied the slot while the URL still named the overlay, so the
 * frame a clinician saw immediately after confirming showed the action refused.
 */
export function clearStagedWorkspaceOverlayCommit() {
  if (staged === null) return;
  consumedCommitTokens.delete(staged.token);
  staged = null;
  announce();
}

/**
 * Claims the staged commit for a history entry exactly once without clearing the
 * slot before its close traversal completes. Keeping the slot until reconciliation
 * avoids flashing a refusal in the still-visible overlay; the consumed token makes
 * a second activation a no-op.
 */
export function consumeWorkspaceOverlayCommit(token: string | null): WorkspaceOverlayCommit | null {
  if (token === null || staged === null || staged.token !== token || consumedCommitTokens.has(token)) return null;
  consumedCommitTokens.add(token);
  return staged.commit;
}

export function subscribeToStagedWorkspaceOverlayCommit(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

/**
 * The slot's current contents.
 *
 * Returns the stored object itself rather than a fresh one, because
 * `useSyncExternalStore` re-renders on every snapshot whose identity changed and a
 * new object per read would never stop.
 */
export function readStagedWorkspaceOverlayCommit(): StagedWorkspaceOverlayCommit | null {
  return staged;
}

/** The server never activated a control, so nothing is ever staged there. */
export function noStagedWorkspaceOverlayCommit(): StagedWorkspaceOverlayCommit | null {
  return null;
}

/**
 * The commit belonging to the history entry currently on screen, or `null`.
 *
 * The token match is the safeguard, not a formality: a slot staged for a different
 * entry — an earlier screen, a spent decision, a different row of the same list —
 * must never answer this one.
 */
export function commitForHistoryEntry(
  slot: StagedWorkspaceOverlayCommit | null,
  entryCommitToken: string | null,
): WorkspaceOverlayCommit | null {
  if (slot === null || entryCommitToken === null) return null;
  return slot.token === entryCommitToken ? slot.commit : null;
}

/**
 * The refusal standing in the way of the open overlay's decision, or `null`.
 *
 * TOTAL over the three states the slot can be in, and pure, so the rule can be
 * proved directly rather than inferred from a rendered button. Only a staged
 * `record` commit returns `null`; the other two refuse, and differ in how far the
 * refusal reaches.
 */
export function commitRefusalFor(commit: WorkspaceOverlayCommit | null): OverlayCommitRefusal | null {
  // Nothing staged. This says "nothing can be RECORDED here", which is not a
  // statement that can be made about a row recording nothing (Ruling 90).
  if (commit === null) return { reason: NO_STAGED_COMMIT_REASON, scope: "recording-rows-only" };
  // A screen said so, in its own words. It meant this row, whatever the row does —
  // an exit a screen has not built is still an exit that would go nowhere.
  if (commit.kind === "unavailable") return { reason: commit.reason, scope: "every-row" };
  return null;
}
