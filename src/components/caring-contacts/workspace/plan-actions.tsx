"use client";

import { CircleAlert, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { cn, ignoreUnavailableActivation } from "@/components/ui-primitives";

import type { WorkspaceOverlayCommit } from "./overlays/overlay-commits";
import { OVERLAY_TRIGGER_CLASS, WorkspaceOverlayTrigger } from "./overlays/overlay-trigger";
import { usePlanSync } from "./plan-sync";
import {
  ACTING_ACCOUNT_ENDPOINT,
  ACTING_ACCOUNT_UNREADABLE,
  actingAccountFrom,
  claimRequestBody,
  planActionCardName,
  planActionRefusal,
  planActionRefusalNameFrom,
  planActionRefusalSentence,
  planActionRefusalWording,
  planActionSubmissionFingerprint,
  planAssignmentEndpoint,
  planFromWriteAnswer,
  planLifecycleEndpoint,
  planLifecycleExpectedVersion,
  planLifecycleRequestBody,
  PLAN_ACTION_TRANSPORT_REFUSALS,
  mintPlanActionIdempotencyKey,
  reassignmentRequestBody,
  type PlanActionId,
  type PlanLifecycleActionId,
  type PlanActionRefusal,
  type PlanActionState,
  type PlanActionsContext,
} from "./plan-action-rules";
import { StatedReason } from "./plan-wizard/stated-reason";
import { WITHDRAWAL_REASON_MAX_LENGTH } from "@/lib/caring-contacts/hospital-events";
import { TERMINAL_PLAN_STATES } from "@/lib/caring-contacts/model";

/**
 * The three plan actions of the frozen matrix, and the resume that pause owes.
 *
 * THESE ARE THE ONLY CONTROLS IN THIS WORKSPACE THAT STOP A SUICIDE-PREVENTION PROGRAMME FOR A
 * PERSON, which is why two of them are two-stage in the frozen table and why every sentence below
 * is derived from what the domain does rather than from what a summary says about it.
 *
 * WHAT PAUSING IS, IN ONE LINE: A HOLD. `pausePlan` moves the plan and touches no contact — the
 * domain's own contract test is named "holds without cancelling for a readmission" — so no dated
 * message is removed, no date shifts, and the plan can be let run again. Withdrawal is the other
 * shape: it ends the plan and the service moves every message that had not gone to `cancelled`.
 * `plan-action-rules.ts` holds that reasoning in full, and this file states it to the reader.
 *
 * AND NOTHING HERE CLAIMS A PAUSE STOPPED A MESSAGE GOING OUT. There is no telephony provider in
 * this system, so there is no sender to stop. That claim has been made wrongly on a screen in this
 * programme before, in both directions, and it is the one sentence this surface must never write.
 *
 * WHY THIS IS A CLIENT COMPONENT, structurally rather than by preference. Its four controls perform
 * writes over the network, and `WorkspaceOverlayCommit`'s `record` member is a FUNCTION position — a
 * Server Component cannot pass one across this boundary at all (Next 16: props passed to Client
 * Components must be serializable). So a mutating row's commit has to be constructed on the client
 * side of the seam. Everything it is handed is plain data, `PlanActionsContext` says so, and the
 * service-wide safety-stop record and its incident note never come near it.
 *
 * THE TWO MOMENTS, AND WHY THE COMMIT DOES NOT TRUST THE ONE IT WAS BUILT IN
 * -------------------------------------------------------------------------
 * `openWorkspaceOverlayWithCommit` stages the commit when the TRIGGER is activated, and the closure
 * it stages was built during a render. A coordinator can then sit on the confirmation for an hour.
 * So the guard is asked twice, exactly as `plan-wizard/overlay-guards.ts` is asked twice:
 *
 *  * at RENDER, with one state passed as both moments — the honest answer there, since nothing has
 *    changed yet. A condition already unmet makes the commit `{ kind: "unavailable", reason }`,
 *    which the host renders as the frozen matrix's guard-rejection shape: the decision control keeps
 *    its tab stop, carries `aria-disabled`, and points at the named reason. The same reason is
 *    stated on THIS screen beside the control, so it does not have to be opened to be read;
 *  * inside the COMMIT, against the render-time values and values read at that instant — the live
 *    ones from `liveState()`, and for the two rows the frozen table marks
 *    `requiresFreshAuthentication`, the account the service is acting as, read from the service.
 *    A refusal there calls nothing, so nothing is changed.
 *
 * WHAT A SUCCESSFUL WRITE DOES TO THE VERSION THIS SCREEN HOLDS, AND WHY IT IS THE POINT
 * -------------------------------------------------------------------------------------
 * `planVersion` arrives as a PROP, and a prop cannot change without a server render. A screen that
 * kept acting on the version it was rendered with would send a stale one for its SECOND action —
 * and the service would refuse it as `stale-version`, whose honest wording is that the plan moved
 * after this screen read it. The coordinator would be told somebody else had changed a
 * suicide-prevention plan when nobody had. So a successful lifecycle write updates the state AND
 * the version this screen holds, from the answer the service gave, and `router.refresh()` asks the
 * server for the rest of the screen. The two-actions-in-a-row case is what proves it.
 */
export type PlanActionsProps = {
  context: PlanActionsContext;
};

/** What this screen last did, held so it can be stated where the coordinator is looking. */
type PlanActionOutcome =
  | { readonly kind: "recorded"; readonly action: PlanActionId; readonly announcement: string }
  | { readonly kind: "refused"; readonly action: PlanActionId; readonly refusal: PlanActionRefusal };

const mutedTextClass = "max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]";
const fieldClass =
  "min-h-tap w-full min-w-0 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] forced-colors:border-[CanvasText]";
const blockClass =
  "min-w-0 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-3 forced-colors:border-[CanvasText]";
const blockHeadingClass = "text-sm font-semibold text-[color:var(--text-heading)]";

/** Nothing this surface records leaves this demonstration, and every control says so once. */
const NOTHING_LEAVES_THIS_SYSTEM =
  "Everything below is recorded in this demonstration only. There is no messaging provider connected to this workspace at all, so nothing any of these controls does can send a message to anybody or stop one being sent.";

export { PlanSyncProvider } from "./plan-sync";

export function PlanActions({ context }: PlanActionsProps) {
  const router = useRouter();
  const sync = usePlanSync();
  const [plan, setPlan] = useState<{ state: PlanActionsContext["planState"]; version: number } | null>({
    state: context.planState,
    version: context.planVersion,
  });
  const [changeOnItsWay, setChangeOnItsWay] = useState(false);
  const [destination, setDestination] = useState("");
  const [handoverNote, setHandoverNote] = useState("");
  const [outcome, setOutcome] = useState<PlanActionOutcome | null>(null);
  /**
   * The account this screen has just claimed the plan for, until the server render says so too.
   *
   * `carriedBy` is a PROP and cannot change until the refresh lands. Without this, the claim control
   * would stay live in that window and a second press would earn `plan-already-claimed` for a claim
   * this screen had just made -- true, but a refusal about nothing anybody else did.
   */
  const [claimedHere, setClaimedHere] = useState<string | null>(null);
  /** Whether the "are you sure?" step of cancelling a draft is showing. Nothing is sent until it is answered. */
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  /**
   * The plan as this screen holds it, re-derived when the SERVER answers with something newer.
   *
   * WHY THIS EXISTS. `useState`'s initialiser runs once, so a screen that only initialised from
   * props would hold the version it was first rendered with for as long as it stayed mounted — and
   * several refusals tell a coordinator to "read this screen again so it holds the plan as it now
   * stands", which would then be advice this screen never performs. Pressing again would send the
   * identical body and earn the identical refusal. `router.refresh()` after every change AND after
   * every commit-time refusal asks for the screen again; this is the half that lets what comes back
   * land in what the next decision acts on.
   *
   * MONOTONE, DELIBERATELY. A successful write answers with a version this screen adopts at once,
   * and the server render that follows may still be the one taken BEFORE that write. Adopting a
   * lower version would send a stale one and earn a collision refusal about a change this screen
   * had just made — the exact false collision `no-other-change-to-this-plan-is-on-its-way` exists
   * to prevent, arriving by another route. So props are adopted only when they are AHEAD of what is
   * held, or when nothing is held at all, which is the unreadable-answer case this recovers from.
   *
   * ADJUSTED DURING RENDER RATHER THAN IN AN EFFECT, which is React's own documented shape for state
   * that has to change when a prop does ("You Might Not Need an Effect"), and is what
   * `react-hooks/set-state-in-effect` exists to push code towards: an effect would render once with
   * the stale value and then again with the right one. `asTheServerLastSaidIt` is held for no other
   * purpose than telling a genuinely new server answer apart from an ordinary re-render.
   */
  const [asTheServerLastSaidIt, setAsTheServerLastSaidIt] = useState({
    state: context.planState,
    version: context.planVersion,
  });
  if (asTheServerLastSaidIt.state !== context.planState || asTheServerLastSaidIt.version !== context.planVersion) {
    setAsTheServerLastSaidIt({ state: context.planState, version: context.planVersion });
    setPlan((current) =>
      current !== null && current.version >= context.planVersion
        ? current
        : { state: context.planState, version: context.planVersion },
    );
  }
  // Another panel on this page wrote to the plan and was answered with a NEWER version: adopt it,
  // monotone for the same reason as the prop sync above. See `plan-sync.ts`.
  if (sync.latest !== null && (plan === null || sync.latest.version > plan.version)) {
    setPlan({ state: sync.latest.state, version: sync.latest.version });
  }
  // Another panel's write in flight guards these controls exactly as this card's own does.
  const anyChangeOnItsWay = changeOnItsWay || sync.writesInFlight > (changeOnItsWay ? 1 : 0);

  /**
   * One key per SUBMISSION in flight, minted at its first confirmation and reused for every retry.
   *
   * A SUBMISSION IS THE ACTION AND ITS BODY, which is what the fingerprint is for. Held per action
   * alone, a key outlives the submission it was minted for: a coordinator whose write the service
   * refused, who then chooses a different destination or rewrites the handover note, is making a
   * genuinely NEW submission — and `runWrite` refuses a key it recorded against different answers
   * as `idempotency-key-reused-for-a-different-write`, whose stated remedy clears no ref. The
   * action could then not be completed from this screen at all.
   *
   * Cleared when that action's write succeeds, so a later action of the same kind is a new
   * submission rather than a replay of this one.
   *
   * WHICH PRESS THE KEY ACTUALLY PROTECTS, AND WHAT PROTECTS THE REST. The key makes a second press
   * a replay only while the body is UNCHANGED, and the window where that holds is the one where
   * nothing has come back yet: two commits racing before either answer arrives fingerprint the same
   * body, share one key, and `runWrite` answers the second with the first's own answer instead of
   * withdrawing a patient twice.
   *
   * It does NOT hold across a refusal. `refuse()` asks for this screen again on every refusal, and
   * the props that come back can carry the version that the lost write itself produced; the sync
   * above adopts it, so a lifecycle body carrying a different `expectedVersion` fingerprints
   * differently and mints a NEW key. That retry reaches the service as a new submission. What stops
   * it double-writing is the condition the row declares, read against the state the same re-read
   * brought back: `the-plan-is-running` for a hold, `the-plan-is-held` for letting it run again,
   * `the-plan-has-started-and-has-not-ended` for a withdrawal, and
   * `a-different-coordinator-is-chosen` for a move -- which a recorded move also clears its choice
   * for, so it refuses even before the re-read lands. **Relaxing one of those four on the belief
   * that the key stands behind it would remove the only guard there is in that case.**
   *
   * A ref rather than state: nothing renders from it, and a re-render between minting and sending
   * would be an opportunity for the value to be lost.
   */
  const keys = useRef<Partial<Record<PlanActionId, { fingerprint: string; key: string }>>>({});

  /**
   * What is true NOW, for the commit to read.
   *
   * A ref because the commit closure was built in an earlier render and would otherwise close over
   * that render's values — which is the whole failure the commit-time recheck exists to catch.
   * Written in an effect rather than during render: reading or writing a ref during render is what
   * `react-hooks/refs` forbids, and it is right to, and an effect has run long before a click.
   */
  const live = useRef({ plan, changeOnItsWay: anyChangeOnItsWay, destination, handoverNote, claimedHere });
  useEffect(() => {
    live.current = { plan, changeOnItsWay: anyChangeOnItsWay, destination, handoverNote, claimedHere };
  }, [plan, anyChangeOnItsWay, destination, handoverNote, claimedHere]);

  const stateFor = useCallback(
    (action: PlanActionId, from: typeof live.current, actingAccount: string): PlanActionState => ({
      planIsKnown: from.plan !== null,
      roleHoldsThisAction: context.granted[action],
      // The last state this screen knew, which is what the guard is about. A plan this screen has
      // lost track of is refused by `this-screen-still-knows-the-plan` before any state is read.
      planState: from.plan?.state ?? context.planState,
      changeOnItsWay: from.changeOnItsWay,
      planCarriedBy: context.carriedBy.actorId ?? from.claimedHere ?? "",
      chosenDestination: from.destination,
      handoverNote: from.handoverNote,
      actingAccount,
    }),
    [context.carriedBy.actorId, context.granted, context.planState],
  );

  /** The render-time answer: one moment, passed as both, because nothing has changed yet. */
  const renderState = useCallback(
    (action: PlanActionId): PlanActionState =>
      stateFor(
        action,
        { plan, changeOnItsWay: anyChangeOnItsWay, destination, handoverNote, claimedHere },
        context.actingAccount,
      ),
    [anyChangeOnItsWay, claimedHere, context.actingAccount, destination, handoverNote, plan, stateFor],
  );

  const refusalAtOpen = useCallback(
    (action: PlanActionId): PlanActionRefusal | null => {
      const opened = renderState(action);
      return planActionRefusal(action, opened, opened);
    },
    [renderState],
  );

  /**
   * Carries out one action: recheck, send, then say what happened.
   *
   * NO PATH OUT OF THIS FUNCTION IS SILENT, and that is a rule rather than an observation. Every
   * exit either sends a write and states the outcome, or states a NAMED refusal — because a confirm
   * control that appears to work and writes nothing is the defect this whole surface exists to
   * remove, and on a reassignment it would leave responsibility for a discharged patient with the
   * wrong person while the screen signalled that it had moved. The one remaining exit that says
   * nothing to the coordinator is `planLifecycleExpectedVersion`'s throw, which is a contradiction
   * between a guard and a write rather than a state anybody can reach: it goes to `error.tsx` and is
   * therefore loud, which is the minimum this workspace accepts. See that function's own note.
   *
   * Apart from that throw it never rejects. The overlay host re-raises a rejected commit during
   * render, which lands on `error.tsx` — a whole-screen error for something this surface can
   * otherwise state in place.
   */
  const carryOut = useCallback(
    async (action: PlanActionId, opened: PlanActionState, withdrawalReason?: string) => {
      const refuse = (refusal: PlanActionRefusal) => {
        setOutcome({ kind: "refused", action, refusal });
        // THE REMEDY THIS SCREEN STATES IS ONE IT PERFORMS. Several of these refusals say to read
        // this screen again so it holds the plan as it now stands; nothing else on the card does
        // that, so pressing again would send the identical body and earn the identical refusal.
        // Asked for on every refusal rather than on a chosen few: a refused write means this
        // screen's view of the plan may be behind whatever refused it, whichever refusal it was.
        router.refresh();
      };

      // FIRST RECHECK: everything knowable without asking anybody, read live rather than from the
      // render this closure was built in.
      const now = stateFor(action, live.current, opened.actingAccount);
      const refusedNow = planActionRefusal(action, opened, now);
      if (refusedNow !== null) {
        refuse(refusedNow);
        return;
      }

      // SECOND RECHECK, on the two rows the frozen table marks `requiresFreshAuthentication`: which
      // account the service is acting as, asked of the service at this instant. See the condition's
      // own note for why this is not, and must never be described as, an authentication check.
      if (planActionNeedsTheAccountChecked(action)) {
        const acting = await readActingAccount();
        if (acting === null) {
          refuse(ACTING_ACCOUNT_UNREADABLE);
          return;
        }
        const refusedByAccount = planActionRefusal(action, opened, stateFor(action, live.current, acting));
        if (refusedByAccount !== null) {
          refuse(refusedByAccount);
          return;
        }
      }

      const destinationWording = (): string =>
        context.destinations.find((entry) => entry.actorId === live.current.destination)?.wording ?? "";

      /**
       * The request as it stands, with whichever key is passed.
       *
       * The version is read HERE, inside the lifecycle half, rather than once for both: a
       * reassignment carries no version at all, so a null plan is not its business, and a shared
       * check would have to decide what to do about a case that only one branch has. It decided to
       * return, which abandoned a confirmed move in silence.
       */
      const bodyWith = (idempotencyKey: string) =>
        action === "reassignment"
          ? reassignmentRequestBody({
              toActorId: live.current.destination,
              handoverNote: live.current.handoverNote,
              idempotencyKey,
            })
          : action === "claim"
            ? claimRequestBody({ actorId: context.actingActorId, idempotencyKey })
            : planLifecycleRequestBody({
                action,
                expectedVersion: planLifecycleExpectedVersion(action, live.current.plan),
                idempotencyKey,
                withdrawalReason,
              });

      // ONE KEY PER SUBMISSION: the same one while the request is the same, a fresh one as soon as
      // the coordinator changes what they are asking for. See the ref's own note.
      const fingerprint = planActionSubmissionFingerprint(bodyWith(""));
      const remembered = keys.current[action];
      const key =
        remembered !== undefined && remembered.fingerprint === fingerprint
          ? remembered.key
          : mintPlanActionIdempotencyKey(action);
      keys.current[action] = { fingerprint, key };

      setChangeOnItsWay(true);
      sync.beginWrite();
      try {
        const sent = await post(
          action === "reassignment" || action === "claim"
            ? planAssignmentEndpoint(context.planId)
            : planLifecycleEndpoint(context.planId),
          bodyWith(key),
        );

        if (!sent.ok) {
          refuse(planActionRefusalWording(sent.refusal));
          return;
        }

        // Only now. The key is spent, so a later action of the same kind is a new submission rather
        // than a replay of this one.
        delete keys.current[action];

        if (action === "reassignment") {
          const announcement = reassignmentAnnouncement(destinationWording());
          // THE CHOICE AND THE NOTE ARE PART OF THE SUBMISSION, so recording it clears them.
          //
          // WHY, AND WHY HERE RATHER THAN AFTER THE REFRESH. `planCarriedBy` is a PROP and cannot
          // change until the server render lands, while these two are client state. Left standing
          // they describe a move that has already happened: in the window before that render
          // arrives, the choice names the account NOW carrying the plan while the prop still names
          // the old one, so `a-different-coordinator-is-chosen` is MET, every other condition is
          // met, and the trigger is live. `applyAssignmentAction` does not refuse a move from an
          // account to itself, and the key was just spent, so a second confirmation appends a
          // handover row saying the plan changed hands when it did not -- permanent, and
          // afterwards indistinguishable from a real one. Clearing them here closes that window
          // without depending on a refresh arriving at all, and what a coordinator then reads
          // beside the control is `a-different-coordinator-is-chosen` by name.
          //
          // The announcement is taken first so that what it names cannot depend on the order these
          // are applied: it is about the destination this move was for.
          setDestination("");
          setHandoverNote("");
          setOutcome({ kind: "recorded", action, announcement });
        } else if (action === "claim") {
          setClaimedHere(context.actingActorId);
          setOutcome({ kind: "recorded", action, announcement: CLAIM_ANNOUNCEMENT });
        } else {
          // The version this screen acts on next comes from the answer the service just gave, never
          // from the prop it was rendered with — see the module note.
          const answered = planFromWriteAnswer(sent.payload);
          setPlan(answered);
          if (answered !== null) sync.publish(answered);
          setOutcome({ kind: "recorded", action, announcement: lifecycleAnnouncement(action, answered !== null) });
        }
        // The rest of this screen was rendered on the server before this change, so it is asked for
        // again. What that refresh brings back is the server's business; this card states the
        // outcome itself so the announcement does not depend on it.
        router.refresh();
      } finally {
        setChangeOnItsWay(false);
        sync.endWrite();
      }
    },
    [context.actingActorId, context.destinations, context.planId, router, stateFor, sync],
  );

  /**
   * What the trigger for one row says confirming it does.
   *
   * `{ kind: "unavailable" }` at open time is the frozen matrix's guard-rejection shape, implemented
   * by the HOST rather than re-derived here: the decision control keeps its tab stop, carries
   * `aria-disabled`, and points at the named reason.
   */
  const commitFor = useCallback(
    (action: PlanActionId): WorkspaceOverlayCommit => {
      const refused = refusalAtOpen(action);
      if (refused !== null) return { kind: "unavailable", reason: planActionRefusalSentence(refused) };
      const opened = renderState(action);
      return {
        kind: "record",
        // The withdrawal dialog carries a Reason box; what was typed arrives here as `fieldValue`.
        record: (_overlayId, fieldValue) => carryOut(action, opened, fieldValue),
      };
    },
    [carryOut, refusalAtOpen, renderState],
  );

  const resumeRefusal = refusalAtOpen("resume");
  const cancelDraftRefusal = refusalAtOpen("cancelDraft");
  const claimRefusal = refusalAtOpen("claim");
  const resumeReasonId = "caring-contacts-plan-action-resume-reason";
  const heldPlanState = plan?.state ?? context.planState;
  // An ended plan (withdrawn, cancelled or completed) takes no further change. Offering Hold, a
  // withdrawal or a move there only to have each dialog refuse is a dead end, so the controls are
  // not offered and one statement says why.
  const planEnded = plan !== null && TERMINAL_PLAN_STATES.includes(heldPlanState);

  return (
    <section aria-labelledby="caring-contacts-plan-actions-heading" data-testid="caring-contacts-plan-actions">
      <h2
        id="caring-contacts-plan-actions-heading"
        className="text-base font-semibold text-[color:var(--text-heading)]"
      >
        Plan actions
      </h2>
      <p className={cn(mutedTextClass, "mt-2")}>{NOTHING_LEAVES_THIS_SYSTEM}</p>
      <p className={cn(mutedTextClass, "mt-2")}>
        <span className="font-medium text-[color:var(--text)]">Recorded against: </span>
        the account this screen is being read in, which is a {context.actingAccountWording} account.
      </p>
      <p className={mutedTextClass}>
        <span className="font-medium text-[color:var(--text)]">Carried by: </span>
        {context.carriedBy.actorId === null
          ? claimedHere !== null
            ? `the ${context.actingAccountWording} account acting here, which has just claimed it.`
            : "nobody has taken this plan on, so it has no named coordinator."
          : context.carriedBy.wording === null
            ? "an account this demonstration cannot put a role to. It identifies accounts by an identifier rather than by a person."
            : `a ${context.carriedBy.wording} account.`}
      </p>

      {/*
       * MOUNTED WHETHER OR NOT THERE IS ANYTHING IN IT. A live region created together with its
       * first content is the pattern assistive technology is least reliable about: the region has
       * to exist before the text arrives for the change to be announced rather than merely
       * rendered. jsdom cannot prove that an announcement reaches assistive technology at all, so
       * this is correctness by construction and is recorded as such rather than as evidence.
       */}
      <div role="status" data-testid="caring-contacts-plan-action-outcome" className="mt-3 min-w-0">
        {/*
          The wait, said out loud. `changeOnItsWay` was already tracked around every write and
          handed to the guards, so a control could not be pressed twice — but nothing on screen
          ever showed it. Between pressing "Hold this plan" and the answer arriving, the one
          surface that stops a suicide-prevention plan for a person said nothing at all, while the
          sign-up wizard two screens away renders sending, refused and half-done copy for the same
          class of wait. Two screens in one workspace answering the same question in opposite ways
          is the defect; this is the half that was missing.

          Inside the existing `role="status"` region rather than beside it, so the wait and the
          answer that replaces it are announced through one region a reader is already following.
          `aria-hidden` is deliberately NOT set: this is the announcement.
        */}
        {changeOnItsWay ? (
          <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-[color:var(--text-muted)]">
            <Loader2 aria-hidden="true" className="size-icon-md shrink-0 animate-spin motion-reduce:animate-none" />
            <span className="min-w-0">Recording this on the plan…</span>
          </p>
        ) : outcome === null ? null : outcome.kind === "recorded" ? (
          <StatedReason
            heading={`${planActionCardName(outcome.action)} — recorded on the plan`}
            because={outcome.announcement}
            changedBy="Nothing further on this screen. The rest of this screen was read before this change and is being read again."
          />
        ) : (
          <StatedReason
            heading={`${planActionCardName(outcome.action)} — ${outcome.refusal.heading}`}
            because={outcome.refusal.because}
            changedBy={outcome.refusal.changedBy}
            icon={<CircleAlert aria-hidden="true" className="size-icon-md shrink-0" />}
          />
        )}
      </div>

      {planEnded ? (
        <div className="mt-4 min-w-0" data-testid="caring-contacts-plan-actions-ended">
          <StatedReason
            heading="This plan has ended, so no plan action applies to it"
            because="An ended plan cannot be held, let run again, withdrawn or moved to another coordinator. How it ended, and every message it held, stay on the record."
            changedBy="Nothing on this screen. A plan that has ended stays ended; caring contacts for this person again would need a new sign-up."
          />
        </div>
      ) : (
        <div className="mt-4 flex min-w-0 flex-col gap-3">
          {heldPlanState === "draft" ? (
            <ActionBlock
              heading="Cancel this draft plan"
              explanation="This plan was signed up and never started, so no message on it has gone to anybody. Cancelling it ends it for good and keeps it on the record as cancelled. It no longer stands in the way of a new plan for this person."
              refusal={cancelDraftRefusal}
              reasonId="caring-contacts-plan-action-cancel-draft-reason"
            >
              {confirmingCancel ? (
                <div
                  className="flex min-w-0 flex-col gap-2"
                  data-testid="caring-contacts-plan-action-cancel-draft-confirmation"
                >
                  <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text)]">
                    Cancel this draft plan? It never started, and cancelling cannot be undone. A new plan can be made
                    for this person afterwards.
                  </p>
                  <div className="flex min-h-tap min-w-0 flex-wrap items-center gap-3">
                    <button
                      type="button"
                      data-testid="caring-contacts-plan-action-cancel-draft-confirm"
                      aria-disabled={cancelDraftRefusal === null ? undefined : "true"}
                      aria-describedby={
                        cancelDraftRefusal === null ? undefined : "caring-contacts-plan-action-cancel-draft-reason"
                      }
                      onClick={
                        cancelDraftRefusal === null
                          ? () => {
                              setConfirmingCancel(false);
                              void carryOut("cancelDraft", renderState("cancelDraft"));
                            }
                          : ignoreUnavailableActivation
                      }
                      className={cn(
                        OVERLAY_TRIGGER_CLASS,
                        "w-full border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] text-[color:var(--danger-text)] hover:border-[color:var(--danger)] sm:w-auto",
                      )}
                    >
                      Yes, cancel this draft plan
                    </button>
                    <button
                      type="button"
                      data-testid="caring-contacts-plan-action-cancel-draft-keep"
                      onClick={() => setConfirmingCancel(false)}
                      className={cn(OVERLAY_TRIGGER_CLASS, "w-full sm:w-auto")}
                    >
                      Keep the draft
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  data-testid="caring-contacts-plan-action-cancel-draft"
                  aria-disabled={cancelDraftRefusal === null ? undefined : "true"}
                  aria-describedby={
                    cancelDraftRefusal === null ? undefined : "caring-contacts-plan-action-cancel-draft-reason"
                  }
                  onClick={cancelDraftRefusal === null ? () => setConfirmingCancel(true) : ignoreUnavailableActivation}
                  className={cn(
                    OVERLAY_TRIGGER_CLASS,
                    "w-full border-[color:var(--danger-border)] text-[color:var(--danger-text)] hover:border-[color:var(--danger)] sm:w-auto",
                  )}
                >
                  Cancel this draft plan
                </button>
              )}
            </ActionBlock>
          ) : null}

          {context.carriedBy.actorId === null && claimedHere === null ? (
            <ActionBlock
              heading="Take this plan on"
              explanation="Nobody is carrying this plan yet. Claiming it makes the account acting here its coordinator, records when that happened, and takes it off the team's unclaimed list."
              refusal={claimRefusal}
              reasonId="caring-contacts-plan-action-claim-reason"
            >
              <button
                type="button"
                data-testid="caring-contacts-plan-action-claim"
                aria-disabled={claimRefusal === null ? undefined : "true"}
                aria-describedby={claimRefusal === null ? undefined : "caring-contacts-plan-action-claim-reason"}
                onClick={
                  claimRefusal === null
                    ? () => {
                        void carryOut("claim", renderState("claim"));
                      }
                    : ignoreUnavailableActivation
                }
                className={cn(OVERLAY_TRIGGER_CLASS, "w-full sm:w-auto")}
              >
                Claim this plan
              </button>
            </ActionBlock>
          ) : null}

          <div className={blockClass}>
            <h3 className={blockHeadingClass}>Hold this plan</h3>
            <p className={cn(mutedTextClass, "mt-1")}>
              Holding a plan takes it out of running and keeps its whole schedule. No dated message is removed, no date
              moves, and the plan can be let run again from this screen. What changes is the record: while a plan is not
              running, the service refuses any attempt to dispatch one of its messages, by name.
            </p>
            <div className="mt-2 flex min-h-tap min-w-0 flex-wrap items-center gap-3">
              <WorkspaceOverlayTrigger overlayId="pause" commit={commitFor("pause")} className="w-full sm:w-auto">
                <span className="truncate">Hold this plan</span>
              </WorkspaceOverlayTrigger>
              <button
                type="button"
                data-testid="caring-contacts-plan-action-resume"
                aria-disabled={resumeRefusal === null ? undefined : "true"}
                aria-describedby={resumeRefusal === null ? undefined : resumeReasonId}
                onClick={
                  resumeRefusal === null
                    ? () => {
                        void carryOut("resume", renderState("resume"));
                      }
                    : ignoreUnavailableActivation
                }
                // The SAME recipe as "Hold this plan" beside it. These two sit in one `gap-3` row and
                // used to disagree on corner radius (12px against 10px), padding and fill — one of
                // them had no background at all — which read as a rendering fault rather than as two
                // deliberate choices.
                className={cn(OVERLAY_TRIGGER_CLASS, "w-full sm:w-auto")}
              >
                Let this plan run again
              </button>
            </div>
            {resumeRefusal === null ? null : (
              <div id={resumeReasonId} className="mt-2 min-w-0">
                <StatedReason
                  heading={resumeRefusal.heading}
                  because={resumeRefusal.because}
                  changedBy={resumeRefusal.changedBy}
                  icon={<CircleAlert aria-hidden="true" className="size-icon-md shrink-0" />}
                />
              </div>
            )}
            {heldPlanState === "paused" &&
            (context.mobileCheckState === "awaitingConfirmation" || context.mobileCheckState === "notReceived") ? (
              <div className="mt-2 min-w-0" data-testid="caring-contacts-plan-action-resume-mobile-check">
                <StatedReason
                  heading="The service will not let this plan run again until the number is confirmed"
                  because={
                    context.mobileCheckState === "awaitingConfirmation"
                      ? "A test text was sent to this patient's number and the patient has not yet said it arrived. Letting the plan run again now would be refused, so that no caring message goes to a number that may be wrong."
                      : "The patient said the test text to this number did not arrive. Letting the plan run again now would be refused, so that no caring message goes to a number that may be wrong."
                  }
                  changedBy="Recording that the test text arrived under Check the number on this screen, or changing the number under Record a change and checking the new one."
                  icon={<CircleAlert aria-hidden="true" className="size-icon-md shrink-0" />}
                />
              </div>
            ) : null}
            <p className={cn(mutedTextClass, "mt-2")}>
              <span className="font-medium text-[color:var(--text)]">This plan is: </span>
              {plan === null
                ? "not known here any more — a change landed and its answer could not be read. Read this screen again."
                : heldPlanState === "paused"
                  ? "being held. Letting it run again is offered above."
                  : heldPlanState === "active"
                    ? "running."
                    : "neither running nor being held, so neither control above applies to it."}
            </p>
          </div>

          <ActionBlock
            heading="Record a withdrawal the patient asked for"
            explanation="A withdrawal ends the plan, and the service moves every message on it that had not already gone to cancelled. That is the opposite of holding it: nothing is kept to come back to, and it cannot be undone. This screen records only a withdrawal the patient asked for, because that is what the confirmation it opens is about."
            refusal={refusalAtOpen("withdrawal")}
            reasonId="caring-contacts-plan-action-withdrawal-reason"
          >
            {/*
            The one control on this screen that cannot be undone looks like it.

            It carried the same neutral trigger recipe as "Hold this plan" forty pixels above it,
            and holding is the reversible one — this screen's own copy says a withdrawal "is the
            opposite of holding it: nothing is kept to come back to, and it cannot be undone". The
            danger treatment only appeared once the overlay was already open, which is after the
            reader has committed to opening it. It reads as danger BEFORE the press, not after.

            Tone on the edge and the label rather than a filled red button: this is a control that
            opens a confirmation, not the confirmation itself, and the overlay's own confirm is
            where the filled danger belongs. The word "withdrawal" still carries the meaning.
          */}
            <WorkspaceOverlayTrigger
              overlayId="withdrawal"
              commit={commitFor("withdrawal")}
              field={WITHDRAWAL_REASON_FIELD}
              className="w-full border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] text-[color:var(--danger-text)] hover:border-[color:var(--danger)] sm:w-auto"
            >
              <span className="truncate">Record a withdrawal</span>
            </WorkspaceOverlayTrigger>
          </ActionBlock>

          <ActionBlock
            heading="Move this plan to another coordinator"
            explanation="Moving a plan changes who is responsible for it. The coordinator carrying it now is not removed from the record: the move and the reason for it are kept with the plan, so who held it and who holds it are both still there afterwards."
            refusal={refusalAtOpen("reassignment")}
            reasonId="caring-contacts-plan-action-reassignment-reason"
          >
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <label
                  htmlFor="caring-contacts-plan-action-destination"
                  className="text-sm font-medium text-[color:var(--text-heading)]"
                >
                  Who this plan moves to
                </label>
                <select
                  id="caring-contacts-plan-action-destination"
                  value={destination}
                  onChange={(event) => setDestination(event.target.value)}
                  className={fieldClass}
                >
                  <option value="">Nobody chosen yet</option>
                  {context.destinations.map((entry) => (
                    <option key={entry.actorId} value={entry.actorId}>
                      {`a ${entry.wording} account`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <label
                  htmlFor="caring-contacts-plan-action-note"
                  className="text-sm font-medium text-[color:var(--text-heading)]"
                >
                  Why this plan is changing hands
                </label>
                <textarea
                  id="caring-contacts-plan-action-note"
                  value={handoverNote}
                  onChange={(event) => setHandoverNote(event.target.value)}
                  rows={3}
                  className={fieldClass}
                />
                <p className={mutedTextClass}>
                  Kept with the move on this plan, for good. Write what a coordinator picking this plan up needs to
                  know.
                </p>
              </div>
              <div className="flex min-h-tap min-w-0 items-center">
                <WorkspaceOverlayTrigger
                  overlayId="reassignment"
                  commit={commitFor("reassignment")}
                  className="w-full sm:w-auto"
                >
                  <span className="truncate">Move this plan</span>
                </WorkspaceOverlayTrigger>
              </div>
            </div>
          </ActionBlock>
        </div>
      )}
    </section>
  );
}

/**
 * One action's block: what it does, the control, and the named reason when it cannot be carried out.
 *
 * The reason is stated HERE as well as inside the overlay the trigger raises, and that is
 * deliberate rather than duplication: the trigger itself is always live (see `overlay-trigger.tsx`),
 * so a coordinator who has not opened the surface would otherwise have to open it to find out why it
 * will refuse. Both are fed from one value, so they cannot disagree.
 */
function ActionBlock({
  heading,
  explanation,
  refusal,
  reasonId,
  children,
}: {
  heading: string;
  explanation: string;
  refusal: PlanActionRefusal | null;
  reasonId: string;
  children: ReactNode;
}) {
  return (
    <div className={blockClass}>
      <h3 className={blockHeadingClass}>{heading}</h3>
      <p className={cn(mutedTextClass, "mt-1")}>{explanation}</p>
      <div className="mt-2 min-w-0">{children}</div>
      {refusal === null ? null : (
        <div id={reasonId} className="mt-2 min-w-0">
          <StatedReason
            heading={refusal.heading}
            because={refusal.because}
            changedBy={refusal.changedBy}
            icon={<CircleAlert aria-hidden="true" className="size-icon-md shrink-0" />}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The optional Reason box in the withdrawal dialog (owner-approved 2026-09-26). Added beside the
 * frozen row's wording, which the interaction-matrix document pins and this does not touch.
 */
const WITHDRAWAL_REASON_FIELD = Object.freeze({
  label: "Reason (optional)",
  hint: `A line on why, if the patient gave one. Kept with the patient's details on this plan, never on a list. Up to ${WITHDRAWAL_REASON_MAX_LENGTH} characters.`,
  maxLength: WITHDRAWAL_REASON_MAX_LENGTH,
});

const CLAIM_ANNOUNCEMENT =
  "This plan is now carried by the account acting here, and the service says so. When it was claimed is kept with the plan, and it has left the team's unclaimed list.";

/** The rows the frozen table marks `requiresFreshAuthentication`, read from that table. */
function planActionNeedsTheAccountChecked(action: PlanActionId): boolean {
  return action === "withdrawal" || action === "reassignment";
}

const LIFECYCLE_ANNOUNCEMENTS: Readonly<Record<PlanLifecycleActionId, string>> = Object.freeze({
  pause:
    "This plan is now being held, and the service says so. Its whole schedule is still on it: no dated message was removed and no date moved, so letting it run again resumes the plan it already had.",
  resume: "This plan is running again, and the service says so. Its dates never moved while it was being held.",
  withdrawal:
    "This plan is withdrawn, and the service says so. Every message on it that had not already gone has been moved to cancelled, and a withdrawn plan takes no further change.",
  cancelDraft:
    "This draft plan is cancelled, and the service says so. It never started, so no message on it went to anybody. It stays on the record as cancelled and no longer stands in the way of a new plan.",
});

/**
 * The change that landed, plus what could not be read about it.
 *
 * TOTAL over the three lifecycle actions rather than a lookup with a fallback: an announcement that
 * silently resolved to the empty string would report a withdrawal as a heading with nothing under
 * it, which is the "plausible instead of visible" failure this workspace refuses everywhere else.
 */
function lifecycleAnnouncement(action: PlanLifecycleActionId, answerWasReadable: boolean): string {
  const landed = LIFECYCLE_ANNOUNCEMENTS[action];
  return answerWasReadable
    ? landed
    : `${landed} The answer itself could not be read here, so this screen cannot say which version of the plan it now stands at, and will not guess one.`;
}

function reassignmentAnnouncement(wording: string): string {
  return `This plan now moves to ${wording === "" ? "the coordinator chosen above" : `a ${wording} account`}, and the service says so. The coordinator who was carrying it, and the reason it changed hands, are both kept with the plan.`;
}

/**
 * One write, and every way it can fail turned into a named refusal rather than a thrown error.
 *
 * `plan-wizard.tsx`'s own `post`, and the shape is deliberately the same: a failed `fetch` is what a
 * lost connection looks like from here, and an unreadable answer says nothing about what the service
 * did. What DIFFERS between the two screens is what a failure means, and that is decided by the
 * caller.
 */
async function post(
  url: string,
  requestBody: unknown,
): Promise<{ ok: true; payload: unknown } | { ok: false; refusal: string }> {
  let answer: Response;
  try {
    answer = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
  } catch {
    return { ok: false, refusal: PLAN_ACTION_TRANSPORT_REFUSALS.didNotReach };
  }

  let payload: unknown;
  try {
    payload = await answer.json();
  } catch {
    return { ok: false, refusal: PLAN_ACTION_TRANSPORT_REFUSALS.unreadableAnswer };
  }

  if (!answer.ok) return { ok: false, refusal: planActionRefusalNameFrom(payload) };
  return { ok: true, payload };
}

/**
 * Which account the service is acting as, asked at the moment a decision is confirmed.
 *
 * Null for anything that did not come back readable, and the caller refuses rather than proceeding:
 * on the two rows that ask this, a change confirmed against an account this screen could not name is
 * exactly what the question exists to prevent.
 */
async function readActingAccount(): Promise<string | null> {
  try {
    const answer = await fetch(ACTING_ACCOUNT_ENDPOINT, { method: "GET", headers: { Accept: "application/json" } });
    if (!answer.ok) return null;
    return actingAccountFrom(await answer.json());
  } catch {
    return null;
  }
}
