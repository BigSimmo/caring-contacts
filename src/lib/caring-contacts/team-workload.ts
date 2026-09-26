// src/lib/caring-contacts/team-workload.ts
//
// Where the team's work is sitting -- Phase 2B Task 17, the read beneath the Team screen and the
// spec §4.2 "workload and queue monitor": active plans per coordinator, unclaimed work against the
// 60-minute escalation, and exception backlog age.
//
// IT REPORTS WHERE WORK IS, AND NEVER WHO IS BETTER OR WORSE (spec §4.2). That is a constraint on
// the SHAPE, not only on the wording, so it is worth stating as three refusals this module holds to:
//
//   * no ordering that could be read as a placing. `coordinators` is sorted by actor id and by
//     nothing else, and the test that pins it uses a fixture whose work order is the exact reverse,
//     so an ordering that followed the counts could not pass by coincidence. A caller wanting a
//     stable order has one; it is obviously not a ranking, because an actor id is not a measure.
//   * no derived comparison between people -- no share of a total, no percentile, no highest or
//     lowest, no team total to divide a row by. Every number below is a count of WORK, answering
//     "how much is here", and none is a number about a person.
//   * no field about a person at all beyond the identifier the work is filed under. The read
//     carries no role, no name, and no history: see "WHAT IT DELIBERATELY DOES NOT CARRY".
//
// WHY IT LIVES IN THE SEALED DOMAIN, decided rather than defaulted (the plan's Task 17 note asks
// for the reason either way). It is an aggregation over existing rules, not a new rule, so domain
// isolation does not settle it by itself -- `schedule-view.ts` is the precedent for putting exactly
// such an aggregation here and it gives the same two reasons, which both hold again:
//
//   * every rule it composes is already owned here -- the escalation threshold and the queue-age
//     arithmetic (./assignment), who is actually answering for a plan (`effectiveResponder`, same),
//     whether a plan's own state holds it (`planSendingHold`, ./schedule-view), and which contact
//     states a person has to look at (`needsOperationalReview`, same). Assembling them in an API
//     route would put a screen's read one edit away from re-deriving a rule the domain owns, which
//     is the thing the isolation constraint exists to stop -- and the constraint binds a route as
//     much as a component;
//   * there will be more than one reader. The HTTP route publishes it and the Team screen's Server
//     Component render reads it directly rather than calling itself over the network. Both must get
//     the same answer, and the only way to guarantee that is for there to be one answer.
//
// IT ADDS NO STORE READ AND NO REPOSITORY METHOD. Its input is `listPlans` joined to `getAssignment`
// per plan -- both already team-scoped, both already API-wired -- so the team scoping this domain
// guards hardest comes free from reads that are already scoped, and there is no second retrieval
// surface to keep honest. The cost is stated rather than hidden: the join is one assignment read per
// plan, which the in-memory store answers from a Map and the Postgres store answers with a query
// each. If that becomes the wrong trade, the fix is a repository method returning the pairs, which
// is a contract change with its own review (Ruling [124]'s shape) -- not a second aggregation here.
//
// Pure and deterministic: no clock, no storage, no ambient time. The instant every age is measured
// to is an argument, for the reason `summariseOperationalReport` states -- a read that silently
// reached for the wall clock could not be tested against a fixed instant.
//
// WHAT IT DELIBERATELY DOES NOT CARRY, each because nothing in this system holds it:
//
//   * a person's NAME or display name. The stores hold `ActorId` and nothing else about a member of
//     staff; the approved design's roster shows a display name, and a staff directory is a system
//     this build is not connected to. The identifier travels; nobody invents a name for it.
//   * a person's ROLE. No read anywhere returns the roles an `ActorId` holds -- `Actor` is assembled
//     at the session seam for the one person acting, never looked up for anybody else. So the
//     approved design's Role column has no source, and a role guessed from an id would be a claim
//     about someone's authority made up by a screen. This also settles the raw-role-identifier rule
//     the easy way: the read returns no role, so there is none to render raw.
//   * anything about a PATIENT. Every field below is a count, an age in whole minutes, or an actor
//     id. No plan id, no patient id, no contact id, and nothing from `getEpisode`, which this read
//     never calls -- a roster needs no patient and must not be a route to one.
//
// TWO AGES, AND THEY ARE NOT THE SAME KIND OF NUMBER. Say which is which before reading either.
//
//   * THE UNCLAIMED AGE IS A REAL QUEUE AGE. It is measured from `PlanRecord.createdAt`, the
//     observed instant a plan came into existence and therefore the instant it became free for a
//     coordinator to take. For a plan nobody has claimed, `asAt` minus that instant IS how long the
//     work has been waiting -- not an estimate of it and not a proxy for it.
//
//     WHY CREATION IS CLAIMABILITY, checked against the domain rather than assumed. A plan is
//     claimable exactly while it has no owner: `applyAssignmentAction`'s `claim` has one
//     precondition, `ownerId === null`, and no plan state gates it -- which is why a draft counts as
//     unclaimed here alongside an active plan. A plan is created with no assignment row, so it is
//     unowned from its first instant, and nothing in this domain returns a claimed plan to unowned:
//     there is no release action, and `reassign` moves ownership from one person to another. So the
//     instant a plan became claimable and the instant it was created are the same instant, for every
//     plan. A release action would break that equality and is the change that would need a separate
//     claimable-since instant on the contract.
//
//     THE ONE CASE THAT OVER-REPORTS, and it errs in the safe direction. A plan whose assignment
//     could not be read at all (`assignment === null`, reachable if a plan is removed between the
//     two reads) is counted as unclaimed, so its age is time since creation even if somebody owned
//     it. That surfaces work whose owner could not be established, one escalation early, rather than
//     dropping a discharged patient's plan out of the monitor.
//
//   * THE EXCEPTION-BACKLOG AGE IS NOT A WAIT AND MUST NOT BE READ AS ONE. Nothing records when a
//     contact entered a state somebody has to look at, so `oldestMinutesSinceScheduledSend` is
//     measured from the scheduled send -- an anchor that IS recorded. The field name says exactly
//     that, and the screen says it in words beside the figure.
//
// WHAT THIS REPLACED, kept because the failure is instructive rather than because the code still has
// it. Until 2026-08-28 the unclaimed age was anchored on `dischargeAt`, which is not an observed
// instant: the only surface that writes one is the plan wizard, and its `dischargeInstantFor` pins
// the value to `DISCHARGE_WALL_CLOCK_HOUR` -- midday -- on the AWST calendar day a coordinator
// typed, a display convention whose own author recorded that nothing in the domain used its time of
// day. This module was the first reader to do instant arithmetic on it. For a plan activated at
// 08:00 on its own discharge day and never claimed, the escalation could not raise at all before
// midday and then under-reported by the morning offset:
//
//     09:00 AWST (unclaimed  60 min) -> reported age  0, withinThreshold
//     11:00 AWST (unclaimed 180 min) -> reported age  0, withinThreshold
//     13:00 AWST (unclaimed 300 min) -> reported age 60, escalated -- four hours late
//
// An earlier version of this comment additionally called that figure an upper bound on the true
// wait, so the module asserted a safety property it did not have -- "raise one early, never miss a
// late one" described the one failure that actually occurred. Both the anchor and the claim are
// gone; `tests/caring-contacts-team-workload.test.ts` pins the corrected behaviour on a fixture that
// crosses the same wizard seam, which is the seam no fixture in the original branch crossed.
import { effectiveResponder, queueAgeMinutes, UNCLAIMED_ESCALATION_MINUTES, type PlanAssignment } from "./assignment";
import { awstIsoTimestamp } from "./clock";
import type { ActorId, PlanId } from "./ids";
import type { PlanRecord } from "./repository";
import { contactNeedsReview, planSendingHold, type PlanSendingHold } from "./schedule-view";

/**
 * One plan and who is carrying it -- what `listPlans` and `getAssignment` answer together.
 *
 * `assignment` is nullable because `getAssignment` answers `null` for a plan it cannot see, which
 * is reachable if a plan is removed between the two reads. Such a plan is counted as UNCLAIMED
 * rather than dropped: surfacing work whose owner could not be established is the conservative
 * direction, and silently losing a discharged patient's plan from the monitor is not.
 */
export type PlanOwnership = { record: PlanRecord; assignment: PlanAssignment | null };

/** Owned plans that their own plan state is holding, and which hold it is. */
export type HeldPlans = { hold: PlanSendingHold; plans: number };

/**
 * Contacts a person has to look at, and how long the oldest has been waiting.
 *
 * WHY THIS READ COUNTS THEM AND DOES NOT EXPLAIN THEM. Each contact's own reason for needing review
 * is on the schedule read (`ScheduleEntry.state` and `notSendingReason`), which is where a screen
 * goes to act on one. Restating it here would be a second answer to the same question. The roster's
 * job is to say the backlog exists, whose it is, and how old it is.
 *
 * `oldestMinutesSinceScheduledSend` is `null` when there is no backlog, which is a different fact
 * from an age of zero and must never be rendered as one.
 */
export type ExceptionBacklog = {
  contacts: number;
  oldestMinutesSinceScheduledSend: number | null;
};

/**
 * One row of the roster: an actor, and the work filed under them.
 *
 * A row exists for an actor who is the NAMED OWNER of at least one plan that has not ended, or who
 * is COVERING one at the instant asked about. Nobody else can be discovered -- see the module note
 * on the absent staff directory -- so a coordinator carrying nothing today has no row, and a screen
 * must say that this is who is carrying work rather than who is on the team.
 */
export type CoordinatorWorkload = {
  actorId: ActorId;
  /** Owned plans that are sending -- neither un-started, nor paused, nor ended. */
  activePlans: number;
  /** Owned plans held by their own plan state, one entry per hold, holds with none omitted. */
  heldPlans: readonly HeldPlans[];
  /** Owned plans somebody else is answering for at this instant. Still counted above: coverage
   *  never moves ownership, so the named coordinator stays visible behind whoever is covering. */
  coveredByAnother: number;
  /** Plans owned by somebody else that this actor is answering for at this instant. */
  coveringForAnother: number;
  /** Over the plans this actor OWNS. A covered plan's backlog stays with its named owner. */
  exceptionBacklog: ExceptionBacklog;
};

/**
 * What the escalation is doing, so the screen can state it (spec §4.4).
 *
 * Three states rather than a boolean, because "nothing is unclaimed" and "something is unclaimed and
 * has not yet reached the threshold" are different facts and a screen must be able to say which.
 */
export type UnclaimedEscalationState = "noUnclaimedWork" | "withinThreshold" | "escalated";

/**
 * Work no coordinator has taken responsibility for.
 *
 * NOT A PER-PERSON MEASURE, and it cannot be one: unclaimed means there is no owner to file it
 * under. The approved design's per-member "Unclaimed work" column therefore has no source in this
 * domain; its own unclaimed row, which this shape feeds, does.
 *
 * `state` and `clearedBy` are the §4.4 pair -- why the system escalated, and what ends it. They are
 * enum values the screen turns into words, never sentences: interface wording is the screen's.
 * `clearedBy` is null only when there is nothing to clear.
 */
export type UnclaimedWork = {
  plans: number;
  /**
   * Of `plans`, those that are sending -- neither un-started, nor paused. The same measure as a
   * roster row's `activePlans`, over plans nobody owns, so a screen totalling the team's running
   * caseload can add the two without losing a running plan for want of an owner (owner decision
   * 2026-09-26). A count of work, never a number about a person.
   */
  activePlans: number;
  /** Of `plans`, those that have reached the threshold. */
  escalated: number;
  /**
   * Whole minutes the OLDEST unclaimed plan has been waiting for a coordinator to take it, measured
   * from the instant it became claimable; null when there are none, which is a different fact from
   * an age of zero. See the module note for why that instant is the plan's creation.
   */
  oldestMinutesUnclaimed: number | null;
  state: UnclaimedEscalationState;
  clearedBy: "aCoordinatorClaimsThePlan" | null;
  /** Contacts needing review on plans nobody owns. Here so an exception cannot go uncounted for
   *  want of an owner to file it under. */
  exceptionBacklog: ExceptionBacklog;
};

export type TeamWorkloadView = {
  /** The instant every age below is measured to, in AWST. */
  asAtIso: string;
  /** In ascending actor-id order. NOT A RANKING -- see the module note. */
  coordinators: readonly CoordinatorWorkload[];
  unclaimed: UnclaimedWork;
  /**
   * Whole minutes after which unclaimed work escalates. Republished from
   * `UNCLAIMED_ESCALATION_MINUTES` so a screen states the threshold it was actually measured
   * against rather than a second copy of the number.
   */
  thresholdMinutes: number;
};

/**
 * The order `heldPlans` entries appear in: the order a plan passes through them.
 *
 * `planEnded` is absent deliberately -- an ended plan is not work and is dropped before it reaches
 * a row (see `buildTeamWorkload`). It is spelled out here rather than derived from the union so
 * that a hold added later has to be placed by a person, which is what an order is for.
 */
const HELD_PLAN_ORDER: readonly Extract<PlanSendingHold, "planNotStarted" | "planPaused">[] = Object.freeze([
  "planNotStarted",
  "planPaused",
]);

type Tally = {
  activePlans: number;
  held: Map<PlanSendingHold, number>;
  coveredByAnother: number;
  coveringForAnother: number;
  reviewableSendInstants: number[];
};

function emptyTally(): Tally {
  return {
    activePlans: 0,
    held: new Map(),
    coveredByAnother: 0,
    coveringForAnother: 0,
    reviewableSendInstants: [],
  };
}

/** The scheduled send instants of this plan's contacts that somebody has to look at, overdue ones included. */
function reviewableSendInstants(record: PlanRecord, asAt: Date): number[] {
  return record.contacts
    .filter((stored) => contactNeedsReview(stored, record.plan.state, asAt))
    .map((stored) => stored.planned.sendAt.getTime());
}

/**
 * Oldest first, in whole minutes, floored and never negative -- `queueAgeMinutes`' arithmetic, not
 * a second copy of it. Null for an empty backlog, which is not an age of zero.
 */
function backlogOf(instants: readonly number[], asAtIso: string): ExceptionBacklog {
  if (instants.length === 0) return { contacts: 0, oldestMinutesSinceScheduledSend: null };
  const oldest = Math.min(...instants);
  return {
    contacts: instants.length,
    oldestMinutesSinceScheduledSend: queueAgeMinutes(new Date(oldest).toISOString(), asAtIso),
  };
}

function heldEntriesOf(held: ReadonlyMap<PlanSendingHold, number>): HeldPlans[] {
  return HELD_PLAN_ORDER.filter((hold) => (held.get(hold) ?? 0) > 0).map((hold) => ({
    hold,
    plans: held.get(hold) ?? 0,
  }));
}

/**
 * The team's roster, rolled up from the plans and assignments a caller has already read.
 *
 * `asAt` is REQUIRED and is the instant every age is measured to and every coverage window is
 * judged against.
 *
 * Plans whose own state has ENDED them are dropped entirely, before any measure: a withdrawn,
 * cancelled or completed plan is not work in front of the team, and counting its contacts would put
 * a closed episode into an operational backlog. `planSendingHold` is asked rather than a list of
 * terminal states being restated here, so a plan state added later cannot default into "still
 * work" -- that function's switch stops compiling instead.
 */
export function buildTeamWorkload(ownership: readonly PlanOwnership[], asAt: Date): TeamWorkloadView {
  const asAtIso = awstIsoTimestamp(asAt);
  const tallies = new Map<ActorId, Tally>();
  const tallyFor = (id: ActorId): Tally => {
    const existing = tallies.get(id);
    if (existing) return existing;
    const created = emptyTally();
    tallies.set(id, created);
    return created;
  };

  let unclaimedPlans = 0;
  let unclaimedActivePlans = 0;
  let unclaimedEscalated = 0;
  let oldestUnclaimedMinutes: number | null = null;
  const unclaimedReviewable: number[] = [];

  for (const { record, assignment } of ownership) {
    const hold = planSendingHold(record.plan.state);
    if (hold === "planEnded") continue;

    // Narrowed here rather than through `assignment?.ownerId`, which left `assignment` typed as
    // nullable below and forced a second null test on a branch that could not run.
    if (assignment === null || assignment.ownerId === null) {
      unclaimedPlans += 1;
      if (hold === null) unclaimedActivePlans += 1;
      // `createdAt`, NOT `dischargeAt`. The plan became free for a coordinator to take when it came
      // into existence; a recorded discharge is a display convention that says nothing about when
      // the work arrived. See the module note.
      const minutes = queueAgeMinutes(awstIsoTimestamp(record.createdAt), asAtIso);
      if (minutes >= UNCLAIMED_ESCALATION_MINUTES) unclaimedEscalated += 1;
      if (oldestUnclaimedMinutes === null || minutes > oldestUnclaimedMinutes) oldestUnclaimedMinutes = minutes;
      unclaimedReviewable.push(...reviewableSendInstants(record, asAt));
      continue;
    }

    const owner = assignment.ownerId;
    const tally = tallyFor(owner);
    if (hold === null) tally.activePlans += 1;
    else tally.held.set(hold, (tally.held.get(hold) ?? 0) + 1);
    tally.reviewableSendInstants.push(...reviewableSendInstants(record, asAt));

    // Who is actually answering at this instant. `effectiveResponder` returns the coverer only
    // while the coverage window is open.
    const responder = effectiveResponder(assignment, asAtIso);
    if (responder !== null && responder !== owner) {
      tally.coveredByAnother += 1;
      tallyFor(responder).coveringForAnother += 1;
    }
  }

  const coordinators = [...tallies.entries()]
    // Ascending actor id, and nothing else. See the module note: a stable order that is obviously
    // not a placing.
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([actorId, tally]) => ({
      actorId,
      activePlans: tally.activePlans,
      heldPlans: heldEntriesOf(tally.held),
      coveredByAnother: tally.coveredByAnother,
      coveringForAnother: tally.coveringForAnother,
      exceptionBacklog: backlogOf(tally.reviewableSendInstants, asAtIso),
    }));

  return {
    asAtIso,
    coordinators,
    unclaimed: {
      plans: unclaimedPlans,
      activePlans: unclaimedActivePlans,
      escalated: unclaimedEscalated,
      oldestMinutesUnclaimed: oldestUnclaimedMinutes,
      state: unclaimedPlans === 0 ? "noUnclaimedWork" : unclaimedEscalated > 0 ? "escalated" : "withinThreshold",
      clearedBy: unclaimedPlans === 0 ? null : "aCoordinatorClaimsThePlan",
      exceptionBacklog: backlogOf(unclaimedReviewable, asAtIso),
    },
    thresholdMinutes: UNCLAIMED_ESCALATION_MINUTES,
  };
}

/**
 * One plan nobody has claimed, as the Team screen's claim list shows it.
 *
 * A SEPARATE READ FROM THE ROSTER, and deliberately so. The roster view above carries no plan id at
 * all, and it still does not: it is also what `GET /api/caring-contacts/team` publishes. This list
 * exists because a coordinator has to be able to TAKE unclaimed work from the screen that shows it
 * (owner decision 2026-09-26), and a claim names one plan. So it carries the plan's own synthetic
 * identifier and nothing else that identifies anything -- no patient id, no name, no contact.
 */
export type UnclaimedPlanEntry = {
  planId: PlanId;
  /** Whole minutes since the plan became claimable -- the same anchor as `oldestMinutesUnclaimed`. */
  minutesUnclaimed: number;
  /** Whether this plan has reached the unclaimed escalation threshold. */
  escalated: boolean;
  /** Null for a running plan; otherwise the hold its own state puts on it. */
  hold: Extract<PlanSendingHold, "planNotStarted" | "planPaused"> | null;
};

/**
 * Every plan nobody has claimed and that has not ended, the longest-waiting first.
 *
 * Oldest first is a QUEUE order -- which work has waited longest -- and says nothing about a person.
 * Ties fall back to the plan id so the order is stable. Uses exactly the rules `buildTeamWorkload`
 * uses: the same "ended" test, the same unreadable-assignment-counts-as-unclaimed direction, the
 * same creation anchor and the same threshold.
 */
export function unclaimedPlanQueue(ownership: readonly PlanOwnership[], asAt: Date): readonly UnclaimedPlanEntry[] {
  const asAtIso = awstIsoTimestamp(asAt);
  const entries: UnclaimedPlanEntry[] = [];
  for (const { record, assignment } of ownership) {
    const hold = planSendingHold(record.plan.state);
    if (hold === "planEnded") continue;
    if (assignment !== null && assignment.ownerId !== null) continue;
    const minutes = queueAgeMinutes(awstIsoTimestamp(record.createdAt), asAtIso);
    entries.push({
      planId: record.plan.id,
      minutesUnclaimed: minutes,
      escalated: minutes >= UNCLAIMED_ESCALATION_MINUTES,
      hold,
    });
  }
  return entries.sort((left, right) =>
    right.minutesUnclaimed !== left.minutesUnclaimed
      ? right.minutesUnclaimed - left.minutesUnclaimed
      : left.planId < right.planId
        ? -1
        : left.planId > right.planId
          ? 1
          : 0,
  );
}
