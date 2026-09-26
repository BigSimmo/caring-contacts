// src/components/caring-contacts/workspace/plan-action-rules.ts
//
// The three plan actions of the frozen matrix -- `pause`, `withdrawal`, `reassignment` -- plus the
// resume that pause owes, expressed as VALUES rather than as conditions written inside a render.
//
// WHY A PURE MODULE. The same reason `plan-wizard/overlay-guards.ts` is one: the matrix says
// "mutation-bearing actions recheck connectivity, permission, authentication and version state at
// commit time", and `openWorkspaceOverlayWithCommit` stages the commit at the moment the TRIGGER is
// activated. A commit closure that captured what it saw then would act on a plan as it stood twenty
// minutes ago. So the predicate is pure, lives here, and the screen asks it TWICE: once at render,
// to decide whether the trigger's commit is `{ kind: "unavailable", reason }`, and once inside the
// commit, against the render-time values AND values read at that instant.
//
// WHAT PAUSING ACTUALLY DOES, BECAUSE THE COPY HERE IS DERIVED FROM IT AND NOT FROM A SUMMARY
// -------------------------------------------------------------------------------------------
// `pausePlan` is `applyPlanTransition(plan, { type: "pause" })` and nothing else. It moves the plan
// from `active` to `paused` and TOUCHES NO CONTACT: `in-memory-repository.ts` routes it through
// `lifecycleWrite`, which carries no contact work, and the domain's own contract test is named
// "holds without cancelling for a readmission" and asserts the full set is still listed. Withdrawal
// is the opposite shape -- `withdrawPlan` runs `cancelAllNonTerminalContacts` -- and a recorded
// death does the same through `recordHospitalStatusEvent`.
//
// So pausing HOLDS. It removes no dated message, it shifts no date, and the plan can be resumed.
//
// AND NOTHING HERE MAY SAY PAUSING STOPPED A MESSAGE GOING OUT. There is no telephony provider in
// this system at all, so there is no sender for a pause to stop. What the pause changes is the
// RECORD, and one consequence of that record: `contactStatusWrite` takes `requiresActivePlan` and
// `startContactDispatch` passes `true`, so a plan that is not `active` has its dispatch write
// refused by name. The gate is at the write, not in the list -- a paused plan's contacts stay in
// the sendable list and are refused when a dispatch is attempted.
//
// No React, no `"use client"`, no `window`, no `fetch`: the rules can then be proved directly
// rather than inferred from a rendered control, and the screen cannot end up holding a second copy.
import { overlayDefinition } from "./overlays/definitions";
import type { PlanState } from "@/lib/caring-contacts/model";

/**
 * The six controls this surface offers.
 *
 * Three are rows of the frozen 24-overlay table. `resume`, `cancelDraft` and `claim` are NOT rows
 * and are deliberately not given one: the matrix's twenty-four surfaces are frozen, and inventing a
 * twenty-fifth to carry a control would be a screen editing that contract. Each is an ordinary
 * control that performs one write. `resume` exists because a hold a coordinator cannot lift is not
 * a hold; `cancelDraft` because a sign-up nobody started must not block the next one; `claim`
 * because an unclaimed plan must be takeable from the screen that shows it (owner decision
 * 2026-09-26).
 */
export type PlanActionId = "pause" | "resume" | "withdrawal" | "reassignment" | "cancelDraft" | "claim";

/**
 * A condition one of the six depends on.
 *
 * TWO KINDS, and the difference is the commit-time clause rather than a detail:
 *
 *  * `the-acting-account-has-not-changed` compares the moment the surface was RAISED with the
 *    moment it is CONFIRMED. It is vacuous at open time -- nothing has changed yet -- and is the
 *    only member here that can catch a confirmation pressed long after the surface was raised.
 *  * every other member is a plain statement about now, and means the same thing whenever it is
 *    asked.
 *
 * A closed union rather than a free string, so a row cannot declare a need nothing evaluates.
 */
export type PlanActionCondition =
  /**
   * This screen still knows the plan as the service last answered it.
   *
   * Every lifecycle write carries `expectedVersion`, so a screen that cannot say which version it
   * is acting on cannot send one honestly. That happens when a write SUCCEEDS and its answer cannot
   * be read: the change landed, and the version it landed at is unknown here. Guessing would earn a
   * refusal about concurrency instead of about the answer this screen could not understand.
   */
  | "this-screen-still-knows-the-plan"
  /** The role the page was rendered for is granted this action. Re-checked by the service too. */
  | "the-acting-role-holds-this-action"
  /**
   * No other change to this plan is already on its way to the service.
   *
   * THE FALSE COLLISION THIS EXISTS TO PREVENT. Every lifecycle write carries `expectedVersion`,
   * and the service refuses a mismatch with `stale-version`. Two actions confirmed from this screen
   * in quick succession would send the same version twice: the second is refused, and the honest
   * wording for `stale-version` -- the plan moved after this screen read it -- would then be shown
   * for a change THIS screen had just made. A coordinator would be told somebody else had touched a
   * suicide-prevention plan when nobody had.
   */
  | "no-other-change-to-this-plan-is-on-its-way"
  /** `applyPlanTransition` accepts `pause` only from `active`. */
  | "the-plan-is-running"
  /** `applyPlanTransition` accepts `resume` only from `paused`. */
  | "the-plan-is-held"
  /** `applyPlanTransition` accepts `withdraw` from `active` or `paused`, and from nothing else. */
  | "the-plan-has-started-and-has-not-ended"
  /** `applyDraftCancellation` accepts only a `draft` plan, and refuses anything else by name. */
  | "the-plan-has-not-started"
  /** `applyAssignmentAction` refuses `reassign` with `plan-not-claimed` when there is no owner. */
  | "somebody-is-carrying-this-plan"
  /** `applyAssignmentAction` refuses `claim` with `plan-already-claimed` when there is an owner. */
  | "nobody-is-carrying-this-plan"
  /**
   * A reassignment needs a destination, and it may not be whoever already holds the plan.
   *
   * BOTH HALVES ARE CHECKED HERE, AND THE SECOND HALF IS WHY THIS NOTE EXISTS. The server builds
   * the list of destinations without the account carrying the plan -- but the CHOICE is client
   * state and survives this screen being read again, while the list does not.
   * `applyAssignmentAction` does not refuse a move from an account to itself, so a choice left
   * standing after a move would append a handover row saying the plan changed hands when it did
   * not, indistinguishable afterwards from a real one.
   */
  | "a-different-coordinator-is-chosen"
  /** `applyAssignmentAction` refuses `reassign` with `reassignment-reason-required` on blank text. */
  | "a-handover-note-is-written"
  /**
   * The account the service is acting as is still the one this screen was rendered for.
   *
   * THIS IS NOT AUTHENTICATION, AND MUST NOT BE DESCRIBED AS ANY. `caring-contacts-server/session.ts`
   * says of itself that it is "deliberately NOT a login and must never look like one"; the cookie it
   * reads holds a role name and never a credential, and there is no password, no session token and
   * nothing to re-enter. So there is no fresh authentication available to perform, and writing one
   * would be a check that cannot fail wearing the name of one that could.
   *
   * What CAN change, and what this reads, is which account the service will record the write
   * against: the role switcher is a separate surface and another tab can move it while one of these
   * surfaces sits open. The failure it prevents is a coordinator confirming a withdrawal against an
   * account the screen never named. Declared on exactly the two rows the frozen table marks
   * `requiresFreshAuthentication`, so the scope comes from that table rather than from a preference.
   */
  | "the-acting-account-has-not-changed";

/**
 * What is true at one moment, read at that moment.
 *
 * Deliberately plain values rather than the plan record itself, so this module cannot be handed a
 * stale object and quietly agree with it.
 */
export type PlanActionState = {
  /** Whether this screen still holds the plan's state and version as the service last answered. */
  readonly planIsKnown: boolean;
  /** Whether the acting role is granted THIS action, decided by the page from the actor. */
  readonly roleHoldsThisAction: boolean;
  readonly planState: PlanState;
  /** Whether a write from this screen is already on its way to the service. */
  readonly changeOnItsWay: boolean;
  /**
   * The account carrying this plan, or the empty string for none.
   *
   * AN IDENTIFIER RATHER THAN A BOOLEAN, because two conditions read it and only one of them is
   * answered by "is anybody carrying it": the other has to know WHO, so that a move to the account
   * already holding the plan can be refused rather than recorded. Compared and never rendered.
   */
  readonly planCarriedBy: string;
  /** The destination chosen for a reassignment, or the empty string for none. */
  readonly chosenDestination: string;
  /** The handover note as typed, untrimmed -- this module decides what blank means. */
  readonly handoverNote: string;
  /**
   * The account the service is acting as. An identifier, compared and never rendered: role wording
   * for a clinician is resolved in the sealed domain and passed to the screen as words.
   */
  readonly actingAccount: string;
};

/** One coordinator a plan could move to, named in words the sealed domain resolved. */
export type PlanActionCoordinator = {
  /** The identifier the write names. Never rendered. */
  readonly actorId: string;
  /** Plain words for the role, from `CARING_CONTACT_ROLE_WORDING`. Rendered. */
  readonly wording: string;
};

/**
 * Everything the plan-actions surface is handed, all of it serialisable.
 *
 * WHY EVERY ROLE ARRIVES AS WORDS. The screen is a Client Component and the page is not, so what
 * crosses that boundary is data. Actor identifiers in this workspace are `demo-<role>`, and printing
 * one would put a raw role identifier in front of a clinician -- which this workspace does not do:
 * role wording lives in the sealed domain (`CARING_CONTACT_ROLE_WORDING`) and is resolved
 * server-side. `actingAccount` crosses as an identifier because it is COMPARED and never rendered;
 * `actingAccountWording` is the half that reaches a reader.
 */
export type PlanActionsContext = {
  readonly planId: string;
  readonly planState: PlanState;
  readonly planVersion: number;
  /** The role the page was rendered for, as an identifier. Compared at commit time, never rendered. */
  readonly actingAccount: string;
  /** Plain words for that role. */
  readonly actingAccountWording: string;
  /**
   * The account a claim names: the caller's own identifier, compared by the service against the
   * signed session and never rendered. A claim naming anybody else is refused by the service.
   */
  readonly actingActorId: string;
  /**
   * Who is carrying this plan: the account, and what to call them.
   *
   * TWO FIELDS, AND THE SPLIT IS THE SAME ONE `actingAccount` MAKES. `actorId` is compared and
   * never rendered; `wording` is the half that reaches a reader. They are not interchangeable:
   * "nobody has taken this plan on" and "somebody has, and this demonstration cannot name them"
   * are different facts and only the first is a reason to refuse a move, so `wording` is null for
   * an owner no demo role accounts for while `actorId` still names it. No write in this workspace
   * produces such an owner today -- and a branch that cannot run today is still read and copied.
   */
  readonly carriedBy: { readonly actorId: string | null; readonly wording: string | null };
  /** Who this plan could move to: every role granted the action of taking a plan on, minus its holder. */
  readonly destinations: readonly PlanActionCoordinator[];
  /** Whether the acting role is granted each action, decided by the page from the actor. */
  readonly granted: Readonly<Record<PlanActionId, boolean>>;
};

/** A refusal in the three-part shape this workspace states every unavailable action in. */
export type PlanActionRefusal = {
  readonly heading: string;
  readonly because: string;
  readonly changedBy: string;
};

const NOTHING_CHANGED = "Nothing was changed on this plan and nothing was sent to anybody.";

/**
 * The plain words each condition is refused in.
 *
 * Written by hand, per condition, and rendered verbatim -- Ruling 61's rule one layer up. No
 * default branch and nothing derived from the identifier, so a condition added to the union without
 * wording fails to compile rather than printing a plausible sentence nobody wrote.
 */
export const PLAN_ACTION_CONDITION_REFUSALS: Readonly<Record<PlanActionCondition, PlanActionRefusal>> = Object.freeze({
  "this-screen-still-knows-the-plan": {
    heading: "This screen no longer knows the plan as the service sees it",
    because: `A change made from here was carried out and its answer could not be read, so this screen cannot say which version of the plan it would be acting on. It will not guess one. ${NOTHING_CHANGED}`,
    changedBy: "Reading this screen again so it holds the plan as it now stands.",
  },
  "the-acting-role-holds-this-action": {
    heading: "This is not an action the role you are acting in may carry out",
    because: `The role this screen was opened in is not granted this action, so the service would refuse it and this screen does not send it. ${NOTHING_CHANGED}`,
    changedBy: "Acting in a role that is granted it, or asking somebody who holds that role to carry it out.",
  },
  "no-other-change-to-this-plan-is-on-its-way": {
    heading: "Another change to this plan is still on its way to the service",
    because: `A change confirmed a moment ago has not been answered yet, and this one would be worked out against the plan as it stood before it. ${NOTHING_CHANGED}`,
    changedBy: "Waiting for the answer to the change already on its way. This screen says what it was when it arrives.",
  },
  "the-plan-is-running": {
    heading: "Only a running plan can be held",
    because: `Holding a plan takes it out of running, and this plan is not running, so there is nothing to take out. ${NOTHING_CHANGED}`,
    changedBy: "Nothing on this screen. A plan that has not been started is started from the sign-up that created it.",
  },
  "the-plan-is-held": {
    heading: "Only a plan that is being held can be let run again",
    because: `Letting a plan run again is the other half of holding it, and this plan is not being held. ${NOTHING_CHANGED}`,
    changedBy: "Nothing on this screen. There is nothing to lift.",
  },
  "the-plan-has-started-and-has-not-ended": {
    heading: "Only a plan that has started and has not ended can be withdrawn",
    because: `A withdrawal ends a plan, and this plan has either not started or has already ended. ${NOTHING_CHANGED}`,
    changedBy: "Nothing on this screen. A plan that has already ended stays ended, and its ending is on the record.",
  },
  "the-plan-has-not-started": {
    heading: "Only a draft plan that never started can be cancelled",
    because: `Cancelling a draft ends a plan before any message on it could go, and this plan has already started or has ended. ${NOTHING_CHANGED}`,
    changedBy: "Nothing on this screen. A plan that has started is held or withdrawn instead.",
  },
  "somebody-is-carrying-this-plan": {
    heading: "Nobody is carrying this plan, so there is nobody to move it from",
    because: `Moving a plan to another coordinator moves it FROM the one carrying it, and nobody has taken this one on. ${NOTHING_CHANGED}`,
    changedBy: "Somebody taking this plan on first, with Claim this plan on this screen.",
  },
  "nobody-is-carrying-this-plan": {
    heading: "Somebody is already carrying this plan",
    because: `Claiming a plan takes on a plan nobody has, and this one already has a coordinator. ${NOTHING_CHANGED}`,
    changedBy: "Moving the plan instead, which keeps the handover and its reason on the record.",
  },
  "a-different-coordinator-is-chosen": {
    heading: "Nobody different has been chosen to carry this plan",
    because: `A move needs somewhere to move to, and the choice on this screen is either empty or is the coordinator already carrying it. ${NOTHING_CHANGED}`,
    changedBy: "Choosing who the plan moves to, above.",
  },
  "a-handover-note-is-written": {
    heading: "A move needs the reason for it written down",
    because: `The reason a plan changed hands is kept with the move, for good, and this one has not been written. ${NOTHING_CHANGED}`,
    changedBy: "Writing why the plan is changing hands, above.",
  },
  "the-acting-account-has-not-changed": {
    heading: "The account this screen was opened in is not the account acting now",
    because: `The account the service would record this against is no longer the one named on this screen when this was opened, so it was not sent. This is not a sign-in check — this demonstration has none — it is a check that this would be recorded against who you thought. ${NOTHING_CHANGED}`,
    changedBy: "Reading this screen again so it names the account acting now, then deciding again.",
  },
});

/**
 * The refusal when the account read itself could not be made or could not be read.
 *
 * NOT a member of the condition union, because it is not a condition: it is the answer when the
 * question could not be asked. Refusing rather than proceeding is the conservative direction on the
 * two rows that carry it -- a withdrawal confirmed against an account this screen could not name is
 * exactly what that check exists to prevent.
 */
export const ACTING_ACCOUNT_UNREADABLE: PlanActionRefusal = Object.freeze({
  heading: "The account acting here could not be read, so nothing was sent",
  because: `This screen asks which account the service is acting as before it records one of these, and that answer did not come back. It will not guess. ${NOTHING_CHANGED}`,
  changedBy: "Reading this screen again, then deciding again.",
});

/**
 * One refusal as a single sentence, for the shared overlay host.
 *
 * `OverlayCommitRefusal.reason` is one string the host renders verbatim, so the three-part shape
 * this workspace states refusals in has to be flattened for it. The SCREEN still renders all three
 * parts beside the control -- this is the narrower copy of the same value, never a second wording.
 */
export function planActionRefusalSentence(refusal: PlanActionRefusal): string {
  return `${refusal.heading}. ${refusal.because} What would change it: ${refusal.changedBy}`;
}

/**
 * What each of the six depends on, in the order the obstacles are stated.
 *
 * ORDER IS THE CONTRACT. A clinician reads the EARLIEST true obstacle, so the role comes before the
 * plan's state, which comes before what has been typed, which comes before the commit-time account
 * check -- most general first. Two rows carry `the-acting-account-has-not-changed` and they are
 * exactly the two the frozen table marks `requiresFreshAuthentication`; see the condition's own
 * note for what that can and cannot mean here.
 */
export const PLAN_ACTION_CONDITIONS: Readonly<Record<PlanActionId, readonly PlanActionCondition[]>> = Object.freeze({
  pause: Object.freeze([
    "this-screen-still-knows-the-plan",
    "the-acting-role-holds-this-action",
    "no-other-change-to-this-plan-is-on-its-way",
    "the-plan-is-running",
  ] as const),
  resume: Object.freeze([
    "this-screen-still-knows-the-plan",
    "the-acting-role-holds-this-action",
    "no-other-change-to-this-plan-is-on-its-way",
    "the-plan-is-held",
  ] as const),
  withdrawal: Object.freeze([
    "this-screen-still-knows-the-plan",
    "the-acting-role-holds-this-action",
    "no-other-change-to-this-plan-is-on-its-way",
    "the-plan-has-started-and-has-not-ended",
    "the-acting-account-has-not-changed",
  ] as const),
  // `this-screen-still-knows-the-plan` is deliberately ABSENT here, and it is a statement rather
  // than an omission: the assignment route carries no `expectedVersion` at all, so a reassignment
  // does not need this screen to know which version of the plan it is acting on. Declaring it
  // anyway would refuse a move for want of a number the service never asks for.
  reassignment: Object.freeze([
    "the-acting-role-holds-this-action",
    "no-other-change-to-this-plan-is-on-its-way",
    "somebody-is-carrying-this-plan",
    "a-different-coordinator-is-chosen",
    "a-handover-note-is-written",
    "the-acting-account-has-not-changed",
  ] as const),
  // Ending a plan before it ever started. Gated on the capability that creates a plan, because the
  // service gates it there too (`claimPlan`, the same roles that can make one).
  cancelDraft: Object.freeze([
    "this-screen-still-knows-the-plan",
    "the-acting-role-holds-this-action",
    "no-other-change-to-this-plan-is-on-its-way",
    "the-plan-has-not-started",
  ] as const),
  // Taking an unclaimed plan on. Like a reassignment the assignment route carries no version, so
  // `this-screen-still-knows-the-plan` is absent for the same reason it is absent there.
  claim: Object.freeze([
    "the-acting-role-holds-this-action",
    "no-other-change-to-this-plan-is-on-its-way",
    "nobody-is-carrying-this-plan",
  ] as const),
});

/**
 * The conditions the named action declares.
 *
 * Throws for an action this module says nothing about rather than returning an empty list: an empty
 * list would make a mistyped id look identical to an action with no guard at all, and all six of
 * these mutate.
 */
export function planActionConditions(action: string): readonly PlanActionCondition[] {
  if (!Object.hasOwn(PLAN_ACTION_CONDITIONS, action)) {
    throw new Error(
      `No conditions are declared for the plan action "${action}". Add an entry to ` +
        `PLAN_ACTION_CONDITIONS deliberately -- every action on this surface mutates, so an ` +
        `unguarded one is not a default.`,
    );
  }
  return PLAN_ACTION_CONDITIONS[action as PlanActionId];
}

function conditionIsMet(condition: PlanActionCondition, opened: PlanActionState, now: PlanActionState): boolean {
  switch (condition) {
    case "this-screen-still-knows-the-plan":
      return now.planIsKnown;
    case "the-acting-role-holds-this-action":
      return now.roleHoldsThisAction;
    case "no-other-change-to-this-plan-is-on-its-way":
      return !now.changeOnItsWay;
    case "the-plan-is-running":
      return now.planState === "active";
    case "the-plan-is-held":
      return now.planState === "paused";
    case "the-plan-has-started-and-has-not-ended":
      return now.planState === "active" || now.planState === "paused";
    case "the-plan-has-not-started":
      return now.planState === "draft";
    case "somebody-is-carrying-this-plan":
      return now.planCarriedBy !== "";
    case "nobody-is-carrying-this-plan":
      return now.planCarriedBy === "";
    case "a-different-coordinator-is-chosen":
      // BOTH halves, as the condition's own note and its refusal both say: somewhere to move to,
      // and somewhere that is not where the plan already is.
      return now.chosenDestination !== "" && now.chosenDestination !== now.planCarriedBy;
    case "a-handover-note-is-written":
      return now.handoverNote.trim() !== "";
    case "the-acting-account-has-not-changed":
      // The only member that reads BOTH moments. Asked at open time with one value passed twice,
      // which is the honest answer there: nothing has changed yet.
      return opened.actingAccount === now.actingAccount;
    default: {
      // A member added to the union and left out of this switch does not compile. The wording map
      // above would still have an entry for it, so the check would otherwise pass silently for a
      // condition nobody had implemented.
      const unhandled: never = condition;
      return unhandled;
    }
  }
}

/**
 * The first condition this action depends on that is not met, in plain words -- or null.
 *
 * TWO STATES, NOT ONE. `opened` is what was true when the surface was raised and `now` is what is
 * true as it is confirmed. A caller asking at open time passes the same value twice.
 */
export function planActionRefusal(
  action: PlanActionId,
  opened: PlanActionState,
  now: PlanActionState,
): PlanActionRefusal | null {
  for (const need of planActionConditions(action)) {
    if (!conditionIsMet(need, opened, now)) return PLAN_ACTION_CONDITION_REFUSALS[need];
  }
  return null;
}

/**
 * What this action is called, taken from the frozen table for the three rows that have one.
 *
 * `resume`, `cancelDraft` and `claim` have no row, so their words are this screen's own and is written here rather than invented at
 * each call site. The other three read `overlayDefinition`, so a label here and a label in the
 * matrix cannot come apart.
 *
 * READ FOR ITS THROW RATHER THAN FOR ITS STRING, which is not what the paragraph above describes
 * and is worth saying plainly. Since the card's own names replaced the label on screen, the one
 * caller left is `planActionCardName` below, which calls this and DISCARDS the result -- keeping it
 * so that an action naming no row of the frozen table still throws there. So a reader finding no
 * consumer of the returned string has found the truth and the wrong conclusion: this is a guard,
 * not dead code.
 */
export function planActionLabel(action: PlanActionId): string {
  if (action === "resume") return "Let this plan run again";
  if (action === "cancelDraft") return "Cancel this draft plan";
  if (action === "claim") return "Claim this plan";
  const definition = overlayDefinition(action);
  if (definition === null) {
    throw new Error(
      `The plan action "${action}" names no row of the frozen 24-overlay table. The three plan ` +
        `actions take their label from that table; only "resume" is this screen's own.`,
    );
  }
  return definition.label;
}

/**
 * What THIS CARD calls each action, in the words a coordinator pressed.
 *
 * Written by hand and rendered verbatim, like every other string in this module.
 */
const PLAN_ACTION_CARD_NAMES: Readonly<Record<PlanActionId, string>> = Object.freeze({
  pause: "Hold this plan",
  resume: "Let this plan run again",
  withdrawal: "Record a withdrawal",
  reassignment: "Move this plan",
  cancelDraft: "Cancel this draft plan",
  claim: "Claim this plan",
});

/**
 * The card's own word for one action, for the sentence a coordinator reads AFTER it.
 *
 * NOT the frozen row's label, and the difference is the whole point. The frozen label for `pause`
 * is "Pause", while every other sentence on this card says HOLD -- deliberately, because holding is
 * what `pausePlan` does and "pause" invites the reading the frozen summary already makes wrongly
 * ("contacts that fall inside the pause are skipped for good"). The one sentence a coordinator
 * reads after a mutating action must not be the single place the card reverts to the vocabulary the
 * rest of it was written to replace. The frozen row is not edited; it is simply not quoted here.
 *
 * The frozen table is still read, and read FIRST, so an action naming no row of it throws here
 * exactly as it does anywhere else -- this is the card's word for a row that exists, never a way
 * around the table.
 */
export function planActionCardName(action: PlanActionId): string {
  planActionLabel(action);
  return PLAN_ACTION_CARD_NAMES[action];
}

// ---------------------------------------------------------------------------
// The writes
// ---------------------------------------------------------------------------

const PLANS_ENDPOINT = "/api/caring-contacts/plans";
const ASSIGNMENTS_ENDPOINT = "/api/caring-contacts/assignments";

export function planLifecycleEndpoint(plan: string): string {
  return `${PLANS_ENDPOINT}/${encodeURIComponent(plan)}`;
}

export function planAssignmentEndpoint(plan: string): string {
  return `${ASSIGNMENTS_ENDPOINT}/${encodeURIComponent(plan)}`;
}

/** The role switcher's own read, asked at commit time. Never a login: see the condition's note. */
export const ACTING_ACCOUNT_ENDPOINT = "/api/caring-contacts/session";

/**
 * Where a withdrawal recorded from this screen says it came from.
 *
 * FIXED, AND STATED RATHER THAN OFFERED. The frozen row is titled "Record a withdrawal the patient
 * asked for", and the route's body is a discriminated union precisely so that an absent origin
 * cannot be defaulted to `patient` and put words in a patient's mouth. This screen records the one
 * the row is about; `thirdParty` is refused by the domain by name, and a clinician-initiated
 * withdrawal has no surface here at all -- reported rather than invented.
 */
export const WITHDRAWAL_ORIGIN = "patient";

export type PlanLifecycleRequestBody =
  | { action: "pause"; expectedVersion: number; idempotencyKey: string }
  | { action: "resume"; expectedVersion: number; idempotencyKey: string }
  | { action: "cancelDraft"; expectedVersion: number; idempotencyKey: string }
  | {
      action: "withdraw";
      origin: typeof WITHDRAWAL_ORIGIN;
      /** The optional short reason, sent only when something other than whitespace was typed. */
      reason?: string;
      expectedVersion: number;
      idempotencyKey: string;
    };

export type ReassignmentRequestBody = {
  action: { type: "reassign"; toActorId: string; reason: string };
  idempotencyKey: string;
};

/** A claim names the account taking the plan on, which the service insists is the caller. */
export type ClaimRequestBody = {
  action: { type: "claim"; actorId: string };
  idempotencyKey: string;
};

/** The lifecycle actions: the ones that go to the plan route and carry `expectedVersion`. */
export type PlanLifecycleActionId = "pause" | "resume" | "withdrawal" | "cancelDraft";

/**
 * Exactly the body the assignment route accepts for a claim.
 *
 * `actorId` is the account acting here. The service refuses a claim naming anybody else, so the
 * ledger of who carries a plan and the audit trail naming who acted cannot disagree.
 */
export function claimRequestBody(input: { actorId: string; idempotencyKey: string }): ClaimRequestBody {
  return { action: { type: "claim", actorId: input.actorId }, idempotencyKey: input.idempotencyKey };
}

/**
 * Exactly the body the plan lifecycle route accepts, for one of the three lifecycle actions.
 *
 * `expectedVersion` comes from what this screen currently holds for the plan, never from a
 * constant and never from the version the page was first rendered with -- see the screen's own note
 * on what a successful write does to the version it holds.
 */
export function planLifecycleRequestBody(input: {
  action: PlanLifecycleActionId;
  expectedVersion: number;
  idempotencyKey: string;
  /** Withdrawal only: what was typed in the dialog's Reason box. Blank sends no reason at all. */
  withdrawalReason?: string;
}): PlanLifecycleRequestBody {
  if (input.action === "withdrawal") {
    const reason = input.withdrawalReason?.trim() ?? "";
    return {
      action: "withdraw",
      origin: WITHDRAWAL_ORIGIN,
      ...(reason === "" ? {} : { reason }),
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
    };
  }
  return { action: input.action, expectedVersion: input.expectedVersion, idempotencyKey: input.idempotencyKey };
}

/**
 * Exactly the body the assignment route accepts for a reassignment.
 *
 * It carries NO `expectedVersion`, and that is the route's shape rather than an omission here:
 * `applyAssignment` holds no version at all, so a reassignment cannot collide the way a lifecycle
 * write can. Recorded as a finding rather than papered over with a version the service ignores.
 */
export function reassignmentRequestBody(input: {
  toActorId: string;
  handoverNote: string;
  idempotencyKey: string;
}): ReassignmentRequestBody {
  return {
    action: { type: "reassign", toActorId: input.toActorId, reason: input.handoverNote.trim() },
    idempotencyKey: input.idempotencyKey,
  };
}

/**
 * The version a LIFECYCLE write carries, or a loud failure.
 *
 * THIS IS AN INTERNAL CONTRADICTION, NOT A STATE A COORDINATOR CAN REACH, and it throws for that
 * reason. Every lifecycle action declares `this-screen-still-knows-the-plan`, which is evaluated
 * against the same live values this reads and immediately before it, so a null plan is refused BY
 * NAME long before a body is built. Reaching here would mean the guard and the body disagreed about
 * what the screen holds.
 *
 * A REASSIGNMENT MUST NOT GO THROUGH THIS. Its row deliberately omits that condition, because the
 * assignment route carries no `expectedVersion` at all -- so a plan whose version this screen has
 * lost is no reason to refuse a move, and a shared null check that quietly returned would abandon a
 * confirmed move in silence. That defect is what this function's existence separates out.
 */
export function planLifecycleExpectedVersion(action: PlanLifecycleActionId, held: { version: number } | null): number {
  if (held === null) {
    throw new Error(
      `The plan action "${action}" reached its write with no plan held on this screen. Every ` +
        `lifecycle action declares "this-screen-still-knows-the-plan", which refuses that case by ` +
        `name first, so this is a contradiction between the guard and the write rather than ` +
        `anything a coordinator did.`,
    );
  }
  return held.version;
}

/**
 * What identifies one SUBMISSION, for deciding whether a key may be reused.
 *
 * A key names a submission, and a submission is the action AND its body -- `runWrite` fingerprints
 * the request under the key and refuses a key that answered a different one as
 * `idempotency-key-reused-for-a-different-write`. So a retry of the SAME submission must share a
 * key, and a CORRECTED one must not: a coordinator whose move was refused, who then chooses a
 * different destination or rewrites the handover note, is making a new submission, and reusing the
 * key would refuse it for a second and worse reason with no remedy this screen can perform.
 *
 * The whole body is read rather than the fields being listed, so a field added to either request
 * shape is part of the submission's identity without this function being touched. The key itself is
 * blanked rather than omitted, so the shape is identical whichever key is held.
 *
 * WHAT THAT MEANS THIS STRING HOLDS, AND WHY IT IS NOT `src/lib/caring-contacts/fingerprint.ts`
 * ---------------------------------------------------------------------------------------------
 * Reading the whole body means that for a reassignment this string contains `reason` VERBATIM --
 * the free-text handover note a coordinator typed about a patient -- unhashed, and in
 * `JSON.stringify` order rather than a canonicalising sort, so it is key-order dependent as well.
 *
 * BOTH ARE FINE WHERE THIS IS, AND NEITHER WOULD BE ANYWHERE ELSE. The value is compared against
 * one held in a ref in the tab that computed it, is deleted from that ref when the write succeeds,
 * and never leaves: it is not a request field -- both bodies are built by the two builders above,
 * not from this -- and it is never rendered, never persisted, and never crosses a boundary. Key
 * order cannot vary either, because each builder constructs its object literal in one place.
 *
 * The precedent a reader meets first is the other function with "fingerprint" in its name, and it
 * hashes: `src/lib/caring-contacts/fingerprint.ts` says at length that it does so because the
 * requests it is computed over carry patient data. That reasoning applies to the CONTENT of this
 * string too. So if this is ever persisted, logged, sent, or moved server-side, it must be hashed
 * and canonicalised first, exactly as that module does -- this note is here so that decision is
 * made deliberately rather than by assuming the two functions are the same kind of thing.
 */
export function planActionSubmissionFingerprint(
  body: PlanLifecycleRequestBody | ReassignmentRequestBody | ClaimRequestBody,
): string {
  return JSON.stringify({ ...body, idempotencyKey: "" });
}

/**
 * Sixteen hexadecimal characters mapped to sixteen letters.
 *
 * WHY NOT THE UUID ITSELF. `audit.ts` scans every field of an assembled audit event against an
 * Australian mobile-number pattern and THROWS when one matches, and a random hexadecimal string can
 * produce a run of eleven digits -- rare rather than impossible, and the worst kind of defect to
 * leave in, because the write would happen and the event recording it could not be built. An
 * identifier with no digits in it cannot match a number pattern, ever. This is
 * `plan-activation.ts`'s reasoning and its construction, reproduced here rather than imported: that
 * module reaches the whole activation graph, and this screen shares none of it.
 */
const HEX_TO_LETTER = "abcdefghijklmnop";

function lettersFromRandomIdentifier(): string {
  return globalThis.crypto
    .randomUUID()
    .replace(/-/g, "")
    .replace(/[0-9a-f]/g, (character) => HEX_TO_LETTER[Number.parseInt(character, 16)]);
}

/**
 * The key that makes a retry a replay rather than a second withdrawal.
 *
 * ONE PER SUBMISSION, and the failure it prevents is the worst outcome this surface has: mint a
 * fresh key per attempt and a coordinator who presses twice after a timeout withdraws a patient
 * twice, or moves the plan twice. Minted once and reused, the service's own `runWrite` recognises
 * the second attempt by `(team, key)` and returns the FIRST attempt's answer without appending
 * anything at all.
 *
 * A key names one write, never two: `runWrite` fingerprints the method and input under the key and
 * refuses a key that answered a different request as
 * `idempotency-key-reused-for-a-different-write`. So each of the six actions holds its own.
 */
export function mintPlanActionIdempotencyKey(action: PlanActionId): string {
  return `PLAN-${action.toUpperCase()}-${lettersFromRandomIdentifier()}`;
}

// ---------------------------------------------------------------------------
// What the service's own refusals mean, in plain words
// ---------------------------------------------------------------------------

/** The refusal names this screen uses for a failure that never reached the service. */
export const PLAN_ACTION_TRANSPORT_REFUSALS = Object.freeze({
  didNotReach: "request-did-not-reach-the-service",
  unreadableAnswer: "service-answered-with-something-unreadable",
});

const NOTHING_RECORDED = "Nothing was recorded on this plan by this attempt.";

/**
 * Every refusal the two routes behind this screen can answer with, in plain words.
 *
 * TOTAL BY CONSTRUCTION AT THE CALL SITE, not by a default branch: an unrecognised name is given
 * the service's own word for it and is explicitly labelled as one this screen has not been taught,
 * which is visible where a plausible invented sentence would not be.
 *
 * THE TWO THAT MUST NEVER READ ALIKE. `stale-version` and the permission family are different facts
 * and a coordinator acting on a suicide-prevention plan needs to know which: one says the plan moved
 * under this screen, the other says this account may not do this at all. Their headings and their
 * remedies are deliberately disjoint.
 */
export const PLAN_ACTION_SERVICE_REFUSALS: Readonly<Record<string, PlanActionRefusal>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, PlanActionRefusal>, {
    "stale-version": {
      heading: "This plan changed after this screen read it",
      because: `The service compares the plan as this screen read it with the plan as it now stands, and they differ — so it refused this rather than applying it over that change. ${NOTHING_RECORDED}`,
      changedBy: "Reading this screen again so it holds the plan as it now stands, then deciding again.",
    },
    "permission-denied": {
      heading: "This account may not carry out this action on this plan",
      because: `The service checked the account it is acting as against this action and refused it. ${NOTHING_RECORDED}`,
      changedBy: "Acting in a role that is granted it, or asking somebody who holds that role to carry it out.",
    },
    "action-not-granted": {
      heading: "This action is not granted to the role acting here",
      because: `The role the service is acting as is not granted this action at all, so it was refused before the plan was looked at. ${NOTHING_RECORDED}`,
      changedBy: "Acting in a role that is granted it, or asking somebody who holds that role to carry it out.",
    },
    "no-roles": {
      heading: "This session carries no role, so nothing may be carried out",
      because: `The session acting here holds no caring-contacts role at all, so no action can be checked against it. ${NOTHING_RECORDED}`,
      changedBy: "Reading this screen again so the session carries a role.",
    },
    "cross-team-denied": {
      heading: "This plan belongs to another team",
      because: `The service refused this because the plan is not this team's. ${NOTHING_RECORDED}`,
      changedBy: "Nothing on this screen. A plan is acted on by the team that holds it.",
    },
    "not-found": {
      heading: "There was nothing here for the service to act on",
      because: `The service answered that there is nothing to act on — the same answer it gives for a record another team holds, deliberately, so the two cannot be told apart. ${NOTHING_RECORDED}`,
      changedBy: "Going back to this team's plans and opening the plan again from there.",
    },
    "plan-not-active": {
      heading: "The plan is not running, so it could not be held",
      because: `Holding a plan takes it out of running, and the service found it was not running. ${NOTHING_RECORDED}`,
      changedBy: "Reading this screen again so it shows the plan as it now stands.",
    },
    "plan-not-paused": {
      heading: "The plan is not being held, so there was nothing to lift",
      because: `Letting a plan run again is the other half of holding it, and the service found it was not being held. ${NOTHING_RECORDED}`,
      changedBy: "Reading this screen again so it shows the plan as it now stands.",
    },
    "plan-not-withdrawable": {
      heading: "The plan could not be withdrawn from the state it is in",
      because: `A withdrawal ends a plan that has started, and the service found this one had either not started or already ended. ${NOTHING_RECORDED}`,
      changedBy: "Reading this screen again so it shows the plan as it now stands.",
    },
    "plan-terminal": {
      heading: "The plan has already ended",
      because: `A plan that has ended takes no further change, and its ending is on the record. ${NOTHING_RECORDED}`,
      changedBy: "Nothing on this screen. A plan that has ended stays ended.",
    },
    "plan-not-claimed": {
      heading: "Nobody is carrying this plan, so there is nobody to move it from",
      because: `The service found no coordinator carrying this plan, and a move moves it from the one carrying it. ${NOTHING_RECORDED}`,
      changedBy: "Somebody taking this plan on first, with Claim this plan on this screen.",
    },
    "plan-already-claimed": {
      heading: "Somebody took this plan on first",
      because: `The service found a coordinator already carrying this plan, so it was not claimed a second time. ${NOTHING_RECORDED}`,
      changedBy: "Reading this screen again to see who is carrying it. Moving it is still offered.",
    },
    "plan-not-draft": {
      heading: "The plan has started, so it is no longer a draft that can be cancelled",
      because: `Cancelling ends only a plan that never started, and the service found this one had started or ended. ${NOTHING_RECORDED}`,
      changedBy: "Reading this screen again so it shows the plan as it now stands.",
    },
    "reassignment-reason-required": {
      heading: "The service will not move a plan without the reason written down",
      because: `The reason a plan changed hands is kept with the move, and the service found none. ${NOTHING_RECORDED}`,
      changedBy: "Writing why the plan is changing hands, then confirming again.",
    },
    "withdrawal-reason-too-long": {
      heading: "The reason for the withdrawal is longer than the service keeps",
      because: `A withdrawal can carry a short reason, and this one is over the limit, so the service refused the withdrawal rather than cut the reason short. ${NOTHING_RECORDED}`,
      changedBy: "Shortening the reason to a line, then recording the withdrawal again.",
    },
    "third-party-withdrawal-refused": {
      heading: "A withdrawal asked for by somebody else is not recorded here",
      because: `The service refuses a withdrawal that did not come from the patient or a clinician, by name. ${NOTHING_RECORDED}`,
      changedBy: "Nothing on this screen. This screen records only a withdrawal the patient asked for.",
    },
    "idempotency-key-reused-for-a-different-write": {
      heading: "This no longer matches the request it is retrying",
      because: `The key this screen holds for this action was recorded against a different set of answers, so the service refused it rather than treating it as a retry — that check is what stops one press becoming two withdrawals. ${NOTHING_RECORDED}`,
      changedBy: "Reading this screen again so it holds the plan as it now stands, then deciding again.",
    },
    "service-stopped": {
      heading: "The service is stopped, so nothing may be changed",
      because: `A service-wide safety stop is in place and it holds every write, including this one. ${NOTHING_RECORDED}`,
      changedBy: "Three different roles approving the restart. Until then no plan can be changed by anyone.",
    },
    "access-audit-unavailable": {
      heading: "The access trail could not record this, so it did not happen",
      because: `Every read and write here is recorded, and one that cannot be recorded does not happen — that is the bargain, not a fault in this screen. ${NOTHING_RECORDED}`,
      changedBy: "Trying again once the trail is available. Nothing has to be entered twice.",
    },
    "invalid-request": {
      heading: "The service would not read this request",
      because: `The request did not become one the service could act on, so it refused it before anything was checked. ${NOTHING_RECORDED}`,
      changedBy: "Reading this screen again, then deciding again.",
    },
    "request-body-too-large": {
      heading: "This request is larger than the service accepts",
      because: `The service holds a size limit on every request, and this one is over it. ${NOTHING_RECORDED}`,
      changedBy: "Shortening the reason for the move, then confirming again.",
    },
    "request-did-not-reach-the-service": {
      heading: "This did not reach the service",
      because: `The request did not complete, so the service was never asked. This is what a lost connection looks like from here. ${NOTHING_RECORDED}`,
      changedBy:
        "Trying again. Retrying is deliberately harmless: this screen reuses the same key for this action, so one press cannot become two.",
    },
    "service-answered-with-something-unreadable": {
      heading: "The service's answer could not be read",
      because:
        "Something came back that this screen could not read, so it will not claim the change was recorded and it will not claim it was not.",
      changedBy:
        "Reading this screen again to see the plan as it now stands. Trying again is harmless: this screen reuses the same key for this action.",
    },
  }),
);

/**
 * The plain words for one refusal, or the service's own word for it named as untaught.
 *
 * `Object.hasOwn` rather than `=== undefined` is not belt-and-braces even on a null-prototype map:
 * the caller supplies the key from a response body, so `"__proto__"` and friends arrive as ordinary
 * strings and this is the lookup that has to survive them.
 */
export function planActionRefusalWording(refusal: string): PlanActionRefusal {
  if (Object.hasOwn(PLAN_ACTION_SERVICE_REFUSALS, refusal)) return PLAN_ACTION_SERVICE_REFUSALS[refusal];
  return {
    heading: "The service refused this for a reason this screen has not been taught",
    because: `The service refused the request and named the reason "${refusal}". This screen has no plain-words explanation for that one, so the reason is given as the service gave it. ${NOTHING_RECORDED}`,
    changedBy: "Reading this screen again. If it keeps refusing, pass that reason on to whoever supports this service.",
  };
}

/**
 * The refusal name in a body the service refused with, or a named stand-in.
 *
 * `handler.ts` answers every refusal with `{ refusal: string }` and nothing else -- no patient data
 * ever travels in one. Anything else arriving here is an answer this screen did not expect, and it
 * is named as that rather than guessed at.
 */
export function planActionRefusalNameFrom(payload: unknown): string {
  if (typeof payload === "object" && payload !== null && "refusal" in payload) {
    const named = (payload as { refusal: unknown }).refusal;
    if (typeof named === "string" && named !== "") return named;
  }
  return PLAN_ACTION_TRANSPORT_REFUSALS.unreadableAnswer;
}

/**
 * The plan's state and version as the service just answered, or null.
 *
 * NULL RATHER THAN A DEFAULT, for `plan-activation.ts`'s reason: a default would be a guess wearing
 * a number, and the refusal it earned on the NEXT action would be about concurrency rather than
 * about the answer this screen could not understand. Null means this screen says so and asks to be
 * read again, which is true and recoverable.
 *
 * Everything about the shape is checked here rather than assumed, because it arrives over the wire.
 */
export function planFromWriteAnswer(payload: unknown): { state: PlanState; version: number } | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = (payload as { value?: unknown }).value;
  if (typeof value !== "object" || value === null) return null;
  const plan = (value as { plan?: unknown }).plan;
  if (typeof plan !== "object" || plan === null) return null;
  const version = (plan as { version?: unknown }).version;
  const state = (plan as { state?: unknown }).state;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return null;
  if (!isPlanState(state)) return null;
  return { state, version };
}

const PLAN_STATES: readonly PlanState[] = Object.freeze([
  "draft",
  "active",
  "paused",
  "withdrawn",
  "cancelled",
  "completed",
]);

function isPlanState(value: unknown): value is PlanState {
  return typeof value === "string" && (PLAN_STATES as readonly string[]).includes(value);
}

/**
 * The role name the role switcher's read answered with, or null.
 *
 * An identifier, compared and never rendered. It is checked for shape rather than trusted: the
 * whole value of the commit-time comparison is that an answer this screen cannot read is refused
 * rather than treated as agreement.
 */
export function actingAccountFrom(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const role = (payload as { role?: unknown }).role;
  return typeof role === "string" && role !== "" ? role : null;
}
