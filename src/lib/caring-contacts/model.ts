// src/lib/caring-contacts/model.ts
import type { ContactId, PathwayVersionId, PatientId, PlanId, ReferralId, TeamId } from "./ids";

export type TransitionResult<T> = { ok: true; value: T } | { ok: false; reason: string };

export type ReferralState = "awaitingHandover" | "accepted" | "returnedForClarification" | "declined";
export type PlanState = "draft" | "active" | "paused" | "withdrawn" | "cancelled" | "completed";
export type ContactState =
  | "scheduled"
  | "processing"
  | "sent"
  | "delivered"
  | "notDelivered"
  | "numberInvalid"
  | "contactChanged"
  | "statusUnavailable"
  | "missed"
  | "suppressed"
  | "cancelled";
export type PathwayVersionState = "draft" | "inReview" | "approved" | "retired";
export type MessageType = "standard" | "first" | "closing";
/**
 * The three approved sending preferences, as a value rather than only a type.
 *
 * Exported for the same reason `TERMINAL_PLAN_STATES` below is: the union was needed at RUNTIME —
 * by the activation wizard's draft, which has to decide whether a value read back out of a
 * browser's storage is still one of them — and a list written out at that call site would be a
 * second copy of this union, free to go on accepting a preference this domain had dropped. The
 * type is derived from the array so the two cannot disagree.
 *
 * The approved AWST send hour for each, and the order they occur in a day, belong to `./schedule`
 * (`SENDING_PREFERENCE_OPTIONS`) — this names the set, not the timing.
 */
export const SENDING_PREFERENCES = Object.freeze(["morning", "afternoon", "earlyEvening"] as const);
export type SendingPreference = (typeof SENDING_PREFERENCES)[number];

/**
 * The plan states that end an episode.
 *
 * Exported because it was needed in three places and declared in three places: this module, the
 * in-memory store and the Postgres store each carried their own copy, so "which states are
 * terminal" could be changed in one and not the others. The de-identification policy module's own
 * terminal list is deliberately NOT this constant -- it is declared over the parallel
 * `EpisodeState` union, and the two were kept separate on purpose.
 */
export const TERMINAL_PLAN_STATES: readonly PlanState[] = Object.freeze(["withdrawn", "cancelled", "completed"]);

export const TERMINAL_CONTACT_STATES: readonly ContactState[] = Object.freeze(["delivered", "suppressed", "cancelled"]);

export const TERMINAL_DISPATCH_REFUSED_CONTACT_STATES: readonly ContactState[] = Object.freeze([
  "delivered",
  "suppressed",
  "cancelled",
  "notDelivered",
  "numberInvalid",
  "contactChanged",
  "statusUnavailable",
  "missed",
]);

/**
 * Contact states that mean the message already left. Reporting only -- nothing keys a send off it.
 * Exported for the same reason as `TERMINAL_PLAN_STATES`: both stores had written their own copy.
 */
export const DISPATCHED_CONTACT_STATES: readonly ContactState[] = Object.freeze([
  "sent",
  "delivered",
  "notDelivered",
  "numberInvalid",
  "contactChanged",
  "statusUnavailable",
]);

export type Plan = { id: PlanId; teamId: TeamId; state: PlanState; version: number };
export type Contact = { id: ContactId; planId: PlanId; state: ContactState; version: number };
export type Referral = {
  id: ReferralId;
  teamId: TeamId;
  patientId: PatientId;
  state: ReferralState;
  pathwayVersionId: PathwayVersionId | null;
};

export type PlanAction =
  | { type: "activate" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "withdraw" }
  | { type: "cancel" }
  | { type: "complete" };

export function applyPlanTransition(plan: Plan, action: PlanAction): TransitionResult<Plan> {
  if (TERMINAL_PLAN_STATES.includes(plan.state)) return { ok: false, reason: "plan-terminal" };
  const advance = (state: PlanState): TransitionResult<Plan> => ({
    ok: true,
    value: { ...plan, state, version: plan.version + 1 },
  });
  switch (action.type) {
    case "activate":
      return plan.state === "draft" ? advance("active") : { ok: false, reason: "plan-not-draft" };
    case "pause":
      return plan.state === "active" ? advance("paused") : { ok: false, reason: "plan-not-active" };
    case "resume":
      return plan.state === "paused" ? advance("active") : { ok: false, reason: "plan-not-paused" };
    case "withdraw":
      return plan.state === "active" || plan.state === "paused"
        ? advance("withdrawn")
        : { ok: false, reason: "plan-not-withdrawable" };
    case "cancel":
      return advance("cancelled");
    case "complete":
      return plan.state === "active" ? advance("completed") : { ok: false, reason: "plan-not-active" };
  }
}

/**
 * Cancels a plan that was created and never started (owner-approved 2026-09-26).
 *
 * Narrower than `applyPlanTransition`'s own `cancel`, which accepts any open plan because a recorded
 * death has to be able to end a plan in whatever state it is in. A coordinator's cancellation is a
 * different act: it withdraws a sign-up nobody has started, so it is refused by name for a plan that
 * has started (`plan-not-draft`) -- that plan ends by withdrawal, which says who asked for it.
 */
export function applyDraftCancellation(plan: Plan): TransitionResult<Plan> {
  if (TERMINAL_PLAN_STATES.includes(plan.state)) return { ok: false, reason: "plan-terminal" };
  if (plan.state !== "draft") return { ok: false, reason: "plan-not-draft" };
  return applyPlanTransition(plan, { type: "cancel" });
}

export type ProviderStatus = "delivered" | "notDelivered" | "numberInvalid" | "contactChanged" | "statusUnavailable";

export type ContactAction =
  | { type: "startProcessing" }
  | { type: "markSent" }
  | { type: "providerStatus"; status: ProviderStatus }
  | { type: "suppress" }
  | { type: "cancel" }
  | { type: "markMissed" };

export function applyContactTransition(contact: Contact, action: ContactAction): TransitionResult<Contact> {
  if (TERMINAL_CONTACT_STATES.includes(contact.state)) return { ok: false, reason: "contact-terminal" };
  const advance = (state: ContactState): TransitionResult<Contact> => ({
    ok: true,
    value: { ...contact, state, version: contact.version + 1 },
  });
  switch (action.type) {
    case "startProcessing":
      return contact.state === "scheduled" ? advance("processing") : { ok: false, reason: "contact-not-scheduled" };
    case "markSent":
      return contact.state === "processing" ? advance("sent") : { ok: false, reason: "contact-not-processing" };
    case "providerStatus":
      return contact.state === "sent" ? advance(action.status) : { ok: false, reason: "contact-out-of-order" };
    case "suppress":
      return advance("suppressed");
    case "cancel":
      return advance("cancelled");
    case "markMissed":
      // `processing` is accepted as well as `scheduled`. A provider timeout leaves a contact in
      // `processing` having sent nothing, and without this it had no exit at all: `markSent` would
      // claim a message that never left, `cancel` would say the plan stopped it, and the contact
      // would sit in `processing` for ever -- neither sent nor accounted for. Recording it missed
      // is the truthful ending, and it sends nothing.
      return contact.state === "scheduled" || contact.state === "processing"
        ? advance("missed")
        : { ok: false, reason: "contact-not-missable" };
  }
}

/**
 * What a contact's state says about whether its message goes out. Three answers, and every
 * `ContactState` has exactly one.
 *
 * WHY THIS LIVES HERE. The patient overview needs to say how much of a plan is still to be sent,
 * and its first answer was "every contact whose state is not `suppressed`" -- a predicate typed out
 * by hand in a component, narrower than the truth, and wrong on a path the domain reaches with an
 * ordinary write: `withdrawPlan` and `recordHospitalStatusEvent` both run every unsent contact
 * through `{ type: "cancel" }`, so a withdrawn plan, or one stopped by a recorded death, is ten
 * CANCELLED contacts that the screen then announced as ten messages still to be sent. On a
 * suicide-prevention screen.
 *
 * The rule belongs beside the state machine that produces the states, not in whatever renders them.
 * This is that rule, stated once.
 *
 * WHY AN EXHAUSTIVE SWITCH RATHER THAN A LIST. A `readonly ContactState[]` of non-sendable states
 * is a list someone has to remember to extend. This does not compile at all when a member is added
 * to `ContactState` and left unclassified, so a new state cannot default into "will be sent".
 *
 * `EpisodeCounts.contactsScheduled` is deliberately NOT redefined in terms of this. It counts
 * entries whose `planned.suppressed` is undefined, other things may read it, and silently changing
 * what an existing number means would be a second defect wearing the first one's clothes. Its own
 * divergence -- a contact suppressed by a later transition still counts as scheduled -- is filed
 * separately.
 */
export type ContactSendability = "alreadySent" | "stillToSend" | "willNotBeSent";

export function contactSendability(state: ContactState): ContactSendability {
  switch (state) {
    case "scheduled":
    case "processing":
      return "stillToSend";
    case "sent":
    case "delivered":
    case "notDelivered":
    case "numberInvalid":
    case "contactChanged":
    case "statusUnavailable":
      return "alreadySent";
    // A missed contact sent nothing and is never retried; `applyContactTransition`'s own note says
    // so. It belongs with suppressed and cancelled, not with the sends.
    case "missed":
    case "suppressed":
    case "cancelled":
      return "willNotBeSent";
    default: {
      const unclassified: never = state;
      return unclassified;
    }
  }
}

/**
 * Why a plan is not sending, whatever its individual contacts say. Null means the plan itself is
 * not in the way.
 *
 * A draft plan's contacts sit in `scheduled` and a paused plan's do too -- neither lifecycle write
 * touches them -- so a read that asked only the contact would announce a plan nobody has started,
 * and a plan a coordinator deliberately paused, as work the service is about to do.
 * `planNotStarted` and `planPaused` are different facts from each other and from `planEnded`, and a
 * caller has to be able to say which.
 *
 * WHY IT LIVES HERE, beside `contactSendability` (#PAMATF, 2026-09-02). It was written in
 * ./schedule-view for the Schedule screen, and its own doc there called it "THE GATE
 * `listSendableContacts` DOES NOT HAVE" -- an accurate description of a rule about the DOMAIN that
 * happened to live in a view module, and one that the read it named could not consult without
 * importing a view. Now that `listSendableContacts` has the gate, both consult this. That module
 * re-exports these two names, so every existing import still resolves.
 */
export type PlanSendingHold = "planNotStarted" | "planPaused" | "planEnded";

/**
 * An exhaustive switch rather than a list of held states, for the same reason `contactSendability`
 * is one: a `PlanState` added later and left unclassified must not compile, so a new state cannot
 * default into "this plan is sending".
 */
export function planSendingHold(state: PlanState): PlanSendingHold | null {
  switch (state) {
    case "draft":
      return "planNotStarted";
    case "active":
      return null;
    case "paused":
      return "planPaused";
    case "withdrawn":
    case "cancelled":
    case "completed":
      return "planEnded";
    default: {
      const unclassified: never = state;
      return unclassified;
    }
  }
}

// Ties the classification above to the two facts this module already held, rather than leaving
// three overlapping descriptions of the same state machine to drift apart. Load-time, and thrown
// rather than asserted in a test, for the same reason `schedule.ts` checks its send window here:
// a build that got this wrong must not start.
for (const state of DISPATCHED_CONTACT_STATES) {
  if (contactSendability(state) !== "alreadySent") {
    throw new Error(`caring-contacts model: dispatched contact state ${state} is not classified as already sent`);
  }
}
for (const state of TERMINAL_CONTACT_STATES) {
  if (contactSendability(state) === "stillToSend") {
    throw new Error(`caring-contacts model: terminal contact state ${state} is classified as still to send`);
  }
}
// The same tie for the plan side. A terminal plan is not sending, by definition -- so if the two
// descriptions of that one fact ever disagree, the build must not start rather than a read
// deciding a withdrawn plan's contacts may still go out.
for (const state of TERMINAL_PLAN_STATES) {
  if (planSendingHold(state) !== "planEnded") {
    throw new Error(`caring-contacts model: terminal plan state ${state} is not classified as ended`);
  }
}
