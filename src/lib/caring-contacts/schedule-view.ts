// src/lib/caring-contacts/schedule-view.ts
//
// What a team's caring-contact schedule holds on a given AWST day -- Phase 2B Task 12, the read
// beneath the Schedule screen.
//
// WHY THERE IS NO NEW REPOSITORY METHOD (Ruling 124). Everything a schedule needs is already in
// what `listPlans` returns: each `PlanRecord` carries its contacts, and each of those carries the
// instant it sends at, the cadence label, the message type, whether the planner absorbed it, and
// the contact's own state. This module is an AGGREGATION OVER EXISTING RULES, not a new rule, so a
// second store read would add a second thing to keep honest -- and team scoping, the fact this
// domain guards hardest, comes free from the read that is already scoped. `listSendableContacts`
// is still deliberately NOT used, but no longer because it is wrong: since #PAMATF it consults the
// owning plan's state through `planSendingHold`, the very function this module used to own. It is
// not used because a SCHEDULE has to show what will NOT be sent, and why, as well as what will.
//
// WHY IT LIVES IN THE SEALED DOMAIN rather than beside the route or the screen. Three of the four
// rules it composes are already owned here -- the window mapping (./schedule), the sendability
// classification (./model) and the plan lifecycle (./model, ./repository) -- and the fourth, that a
// plan's own state holds sending, is a rule about the domain and not about any screen. There will
// be more than one reader: the HTTP route publishes it, and a Server Component render reads it
// directly rather than calling itself over the network. Both must get the same answer, and the only
// way to guarantee that is for there to be one answer.
//
// NOTHING HERE RE-DERIVES A RULE. The window an instant sends in comes from
// `sendingPreferenceAt`; whether a contact still sends comes from `contactSendability`; the three
// windows and their order come from `SENDING_PREFERENCE_OPTIONS`; and the sent/to-send/never
// arithmetic comes from `summariseStoredContacts`. What this module adds is the day bucketing, the
// plan-state hold, and the grouping.
//
// IT RELEASES NO PATIENT IDENTITY. Every field below comes from a `PlanRecord`, which carries none
// -- the patient is named only by the synthetic `patientId`. A screen that needs names reads them
// through `listPatientNames`, which is audited in its own right. Since #RZVMPD that is true of the
// QUERY too and not only of the type: `listPlans` selects `PLAN_LIST_COLUMNS`, which names no
// patient column, so a caseload render no longer pulls names, mobile numbers and identifiers into
// the process merely to discard them.
//
// Pure and deterministic: no clock, no storage, no ambient time. The day being asked about is an
// argument.
import { awstCalendarDay, awstCalendarDayOffset, awstWallTimeToInstant } from "./clock";
import type { ContactId, PatientId, PlanId } from "./ids";
import {
  contactSendability,
  planSendingHold,
  type ContactSendability,
  type ContactState,
  type MessageType,
  type PlanSendingHold,
} from "./model";
import type { PlanState, SendingPreference } from "./model";
import { summariseStoredContacts, type PlanRecord, type StoredContact, type StoredContactSummary } from "./repository";
import { isAwstCalendarDay, SENDING_PREFERENCE_OPTIONS, sendingPreferenceAt } from "./schedule";

/**
 * `planSendingHold` and its type moved to ./model (#PAMATF, 2026-09-02).
 *
 * Its own doc used to call it "THE GATE `listSendableContacts` DOES NOT HAVE", which was the
 * accurate description of a rule about the domain that happened to live in a view module. That
 * read now has the gate, and consults this same function, so the rule sits beside the state
 * machine that produces the states -- exactly where `contactSendability` sits, and for the reason
 * this module's own header gives for putting it there.
 *
 * Re-exported so every existing import of these names still resolves.
 */
export { planSendingHold, type PlanSendingHold };

/**
 * Whether a contact's state is one a person has to look at.
 *
 * The four provider outcomes that are not a delivery, plus a contact the window closed on. All
 * five sent nothing a coordinator can rely on and none of them is retried, so each is a patient who
 * did not hear from the service and nobody has yet decided what to do about it.
 *
 * Exhaustive for the same reason the two switches above are. `delivered` and `sent` are not
 * exceptions: one is a transport receipt and the other is a send awaiting one.
 */
export function needsOperationalReview(state: ContactState): boolean {
  switch (state) {
    case "notDelivered":
    case "numberInvalid":
    case "contactChanged":
    case "statusUnavailable":
    case "missed":
      return true;
    case "scheduled":
    case "processing":
    case "sent":
    case "delivered":
    case "suppressed":
    case "cancelled":
      return false;
    default: {
      const unclassified: never = state;
      return unclassified;
    }
  }
}

/**
 * How long past its send time a contact may still be "scheduled" before a person must look at it.
 * An hour covers a dispatcher run that is merely late; anything older was never sent.
 */
export const OVERDUE_REVIEW_GRACE_MINUTES = 60;

/**
 * Whether a contact is still waiting to send although its send time passed more than the grace
 * period before `asAt` -- for example a plan activated with an old discharge date. Contacts on a
 * plan that is holding its sends (paused, ended) are held, not overdue. Without `asAt` nothing is
 * overdue, so a caller that supplies no clock gets the old, state-only answer.
 */
export function isOverdueUnsent(stored: StoredContact, planState: PlanRecord["plan"]["state"], asAt?: Date): boolean {
  if (asAt === undefined) return false;
  if (stored.contact.state !== "scheduled") return false;
  if (planSendingHold(planState) !== null) return false;
  return stored.planned.sendAt.getTime() + OVERDUE_REVIEW_GRACE_MINUTES * 60_000 < asAt.getTime();
}

/** The one "needs review" answer Today, Team and Schedule share: a review state, or overdue and unsent. */
export function contactNeedsReview(
  stored: StoredContact,
  planState: PlanRecord["plan"]["state"],
  asAt?: Date,
): boolean {
  return needsOperationalReview(stored.contact.state) || isOverdueUnsent(stored, planState, asAt);
}

/**
 * Why a contact will not be sent. Only ever set where `contactSendability` already answered
 * `willNotBeSent`, so it explains that answer rather than competing with it.
 *
 * `absorbedByFirstContact` is kept apart from the other three deliberately. An absorbed entry is
 * the planner folding Week 1 into a first contact moved onto the same day -- the plan is working
 * exactly as designed -- whereas a cancellation means something stopped it. Collapsing the two into
 * "not sending" is the shape of the defect `ListEmptyState` exists to prevent, one layer down.
 */
export type ScheduleNotSendingReason = "absorbedByFirstContact" | "suppressed" | "cancelled" | "missed";

/** One contact, on one day, with everything a screen needs to say what is happening to it. */
export type ScheduleEntry = {
  planId: PlanId;
  patientId: PatientId;
  contactId: ContactId;
  planState: PlanState;
  /**
   * The stored contact's own version, the optimistic-concurrency token every contact write takes
   * as `expectedContactVersion`.
   *
   * PUBLISHED BECAUSE A READ THAT OFFERS A MOVE HAS TO CARRY IT (Phase 2B Task 14). A screen that
   * lets a coordinator move a contact must send the version it was looking at, so a second
   * coordinator's move lands as `stale-version` rather than silently overwriting the first --
   * which is the whole guarantee `rescheduleContact` makes. Without it here the screen's only
   * options were to fetch the plan again at commit time, which reintroduces the race it is trying
   * to close, or to omit the check, which removes it.
   *
   * IT IS NOT PATIENT DATA AND CARRIES NO IDENTITY. It is a counter this domain increments on
   * every write to the contact; it says how many times the record has changed and nothing about
   * whom it belongs to. `PlanRecord` already released the contact id, the plan id and the
   * synthetic patient id beside it.
   */
  contactVersion: number;
  /** The AWST calendar day this contact actually sends on, derived from `sendAt`. */
  calendarDay: string;
  sendAt: Date;
  cadenceLabel: string;
  messageType: MessageType;
  state: ContactState;
  /** What the CONTACT's state says -- `contactSendability`'s answer, unmodified. */
  sendability: ContactSendability;
  /** What the PLAN's state says. A fact about the plan, so it is reported on a sent contact too. */
  planHold: PlanSendingHold | null;
  /** Still to send AND not held by its plan. The only entries the service will actually send. */
  isDue: boolean;
  /** Why this contact will not be sent; null unless `sendability` is `willNotBeSent`. */
  notSendingReason: ScheduleNotSendingReason | null;
  /** Whether this contact belongs in the named-exceptions panel rather than a routine window. */
  needsReview: boolean;
};

/**
 * How much of a group is going out, how much never will, and how much is held.
 *
 * `StoredContactSummary` supplies `total`, `alreadySent`, `stillToSend` and `willNotBeSent` from
 * `summariseStoredContacts` -- this does not restate that arithmetic, it EXTENDS it by splitting
 * `stillToSend` into the part the service will send and the part its own plan is holding.
 *
 * The invariant, stated rather than left to be inferred: `due + held === stillToSend`.
 */
export type ScheduleCounts = StoredContactSummary & {
  due: number;
  held: number;
  needsReview: number;
};

export type ScheduleGroup = {
  entries: readonly ScheduleEntry[];
  counts: ScheduleCounts;
};

/** One of the three approved sending windows, with the wording and time ./schedule publishes. */
export type ScheduleWindow = ScheduleGroup & {
  preference: SendingPreference;
  label: string;
  sendTime: string;
};

/**
 * What a day's emptiness means, which is exactly the distinction a list screen must not lose.
 *
 * `noContactsPlanned` and `nothingDue` both render as a day with no work on it, and they are
 * different facts about a suicide-prevention service: the first is a quiet day, the second is a day
 * whose contacts were all stopped, absorbed, missed or held. `counts` says which of those it was.
 */
export type ScheduleDayDisposition = "noContactsPlanned" | "nothingDue" | "contactsDue";

/**
 * One AWST calendar day.
 *
 * EVERY ENTRY THE DAY HOLDS APPEARS IN EXACTLY ONE GROUP: one of the three windows, the
 * outside-the-windows group, or the exceptions group. A contact needing operational review is taken
 * out of its window rather than listed twice, because the approved design keeps named exceptions
 * separate from the routine sending-window lists and a screen rendering both would otherwise count
 * one patient as two. `counts` covers the day as a whole, so the day's totals never depend on which
 * group an entry landed in.
 */
export type ScheduleDay = {
  calendarDay: string;
  /** Always all three, in the order they occur in a day, present whether or not they hold anything. */
  windows: readonly ScheduleWindow[];
  /** Contacts moved to a time that is not an approved send time -- see `sendingPreferenceAt`. */
  outsideApprovedWindows: ScheduleGroup;
  exceptions: ScheduleGroup;
  counts: ScheduleCounts;
  disposition: ScheduleDayDisposition;
};

export type ScheduleRangeView = {
  fromCalendarDay: string;
  toCalendarDay: string;
  /** Every day of the range, in order, including the ones holding nothing. */
  days: readonly ScheduleDay[];
};

export type ScheduleRangeResult = { ok: true; view: ScheduleRangeView } | { ok: false; reason: string };

/**
 * The longest range this read will answer, in days.
 *
 * A month, so a month view is possible and a seven-day strip is comfortably inside it. It is a
 * bound rather than a preference: the range arrives from a query string, the work is one pass over
 * every plan's every contact per day, and an unbounded range would let a caller ask for a decade.
 * Published so a screen offering a date range does not restate it.
 */
export const SCHEDULE_RANGE_MAX_DAYS = 31;

const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * A calendar day as an instant, taken at midday AWST.
 *
 * Midday rather than midnight on purpose: it is the furthest point from either boundary, so the
 * difference between two of them cannot round across one. AWST is UTC+8 all year, so there is no
 * daylight-saving shift for this to survive -- the margin is against arithmetic, not against a
 * clock change.
 *
 * `daysBetween` below is its only caller, and it wants the INSTANT rather than the day, which is
 * why the midday expression is still written here as well as inside `awstCalendarDayOffset`. The
 * enumeration that used to be the second caller now goes through that helper (Task 13 review).
 */
function middayOf(calendarDay: string): number {
  return awstWallTimeToInstant(calendarDay, 12).getTime();
}

function daysBetween(fromCalendarDay: string, toCalendarDay: string): number {
  return Math.round((middayOf(toCalendarDay) - middayOf(fromCalendarDay)) / MILLISECONDS_PER_DAY);
}

function calendarDaysFrom(fromCalendarDay: string, count: number): string[] {
  return Array.from({ length: count }, (_unused, offset) => awstCalendarDayOffset(fromCalendarDay, offset));
}

function notSendingReasonFor(stored: StoredContact): ScheduleNotSendingReason | null {
  if (contactSendability(stored.contact.state) !== "willNotBeSent") return null;
  // The planner's own mark, checked before the state: an absorbed entry is stored in the terminal
  // `suppressed` state at creation, so reading the state alone could not tell it apart from a
  // contact something later suppressed.
  if (stored.planned.suppressed !== undefined) return "absorbedByFirstContact";
  switch (stored.contact.state) {
    case "suppressed":
      return "suppressed";
    case "cancelled":
      return "cancelled";
    case "missed":
      return "missed";
    default:
      // Unreachable while every state `contactSendability` answers `willNotBeSent` for is named
      // above. If one is ever added there and not here, saying nothing is better than naming the
      // wrong reason, so this returns null rather than guessing.
      return null;
  }
}

function entryFor(record: PlanRecord, stored: StoredContact, asAt?: Date): ScheduleEntry {
  const sendability = contactSendability(stored.contact.state);
  const planHold = planSendingHold(record.plan.state);
  const overdue = isOverdueUnsent(stored, record.plan.state, asAt);
  return {
    planId: record.plan.id,
    patientId: record.patientId,
    contactId: stored.contact.id,
    planState: record.plan.state,
    contactVersion: stored.contact.version,
    calendarDay: awstCalendarDay(stored.planned.sendAt),
    sendAt: new Date(stored.planned.sendAt.getTime()),
    cadenceLabel: stored.planned.cadenceLabel,
    messageType: stored.planned.messageType,
    state: stored.contact.state,
    sendability,
    planHold,
    // An overdue contact is not "due to send" -- it missed its time and is listed for review instead.
    isDue: sendability === "stillToSend" && planHold === null && !overdue,
    notSendingReason: notSendingReasonFor(stored),
    needsReview: needsOperationalReview(stored.contact.state) || overdue,
  };
}

/** Sorted so two reads of the same plans, in any order, produce the same list. */
function ordered(entries: ScheduleEntry[]): ScheduleEntry[] {
  return [...entries].sort(
    (left, right) =>
      left.sendAt.getTime() - right.sendAt.getTime() ||
      (left.planId < right.planId ? -1 : left.planId > right.planId ? 1 : 0) ||
      (left.contactId < right.contactId ? -1 : left.contactId > right.contactId ? 1 : 0),
  );
}

/**
 * The three buckets `summariseStoredContacts` already answers for, plus the two this read adds.
 * The stored contacts are handed to it rather than the entries, so the sent/to-send/never counts
 * stay that function's answer and not a second one taken over the same states.
 */
function countsFor(entries: readonly ScheduleEntry[], stored: readonly StoredContact[]): ScheduleCounts {
  return {
    ...summariseStoredContacts(stored),
    due: entries.filter((entry) => entry.isDue).length,
    held: entries.filter((entry) => entry.sendability === "stillToSend" && entry.planHold !== null).length,
    needsReview: entries.filter((entry) => entry.needsReview).length,
  };
}

function groupOf(pairs: readonly { entry: ScheduleEntry; stored: StoredContact }[]): ScheduleGroup {
  const entries = ordered(pairs.map((pair) => pair.entry));
  return {
    entries,
    counts: countsFor(
      entries,
      pairs.map((pair) => pair.stored),
    ),
  };
}

function dispositionOf(counts: ScheduleCounts): ScheduleDayDisposition {
  if (counts.total === 0) return "noContactsPlanned";
  return counts.due > 0 ? "contactsDue" : "nothingDue";
}

function buildDay(
  pairsByDay: ReadonlyMap<string, { entry: ScheduleEntry; stored: StoredContact }[]>,
  calendarDay: string,
): ScheduleDay {
  const pairs = pairsByDay.get(calendarDay) ?? [];

  const exceptions = pairs.filter((pair) => pair.entry.needsReview);
  const routine = pairs.filter((pair) => !pair.entry.needsReview);
  const byPreference = new Map<SendingPreference, { entry: ScheduleEntry; stored: StoredContact }[]>();
  const outside: { entry: ScheduleEntry; stored: StoredContact }[] = [];
  for (const pair of routine) {
    const preference = sendingPreferenceAt(pair.entry.sendAt);
    if (preference === null) {
      outside.push(pair);
      continue;
    }
    const bucket = byPreference.get(preference);
    if (bucket) bucket.push(pair);
    else byPreference.set(preference, [pair]);
  }

  const windows: ScheduleWindow[] = SENDING_PREFERENCE_OPTIONS.map((option) => ({
    preference: option.preference,
    label: option.label,
    sendTime: option.sendTime,
    ...groupOf(byPreference.get(option.preference) ?? []),
  }));

  const counts = countsFor(
    pairs.map((pair) => pair.entry),
    pairs.map((pair) => pair.stored),
  );

  return {
    calendarDay,
    windows,
    outsideApprovedWindows: groupOf(outside),
    exceptions: groupOf(exceptions),
    counts,
    disposition: dispositionOf(counts),
  };
}

/**
 * The team's schedule over an inclusive range of AWST calendar days. One day is the range
 * `(day, day)`; there is deliberately no second entry point for it, because two entry points would
 * be two places for the grouping rules to be applied slightly differently.
 *
 * `plans` is whatever `listPlans` released for the actor -- already team-scoped, already free of
 * patient identity. Refuses by name rather than answering something for a range it cannot honour,
 * exactly as `buildApprovedSchedule` does, so the boundary above it can say what was wrong.
 *
 * A contact is placed on the AWST day of its OWN `sendAt`, never on `planned.calendarDay` and never
 * on the UTC date. `sendAt` is the instant that actually sends; the calendar day beside it is a
 * copy made when the plan was built, and a read that trusted the copy would report a day the
 * service was not going to send on. AWST is UTC+8, so the UTC date is a different day for anything
 * before 08:00 AWST.
 */
export function buildScheduleRange(
  plans: readonly PlanRecord[],
  fromCalendarDay: string,
  toCalendarDay: string,
  /** The current instant. When given, a still-scheduled contact past its send time is flagged for review. */
  asAt?: Date,
): ScheduleRangeResult {
  if (!isAwstCalendarDay(fromCalendarDay) || !isAwstCalendarDay(toCalendarDay)) {
    return { ok: false, reason: "schedule-range-invalid-day" };
  }
  const span = daysBetween(fromCalendarDay, toCalendarDay);
  if (span < 0) return { ok: false, reason: "schedule-range-inverted" };
  if (span + 1 > SCHEDULE_RANGE_MAX_DAYS) return { ok: false, reason: "schedule-range-too-long" };

  const days = calendarDaysFrom(fromCalendarDay, span + 1);
  const wanted = new Set(days);

  const pairsByDay = new Map<string, { entry: ScheduleEntry; stored: StoredContact }[]>();
  for (const record of plans) {
    for (const stored of record.contacts) {
      const entry = entryFor(record, stored, asAt);
      if (!wanted.has(entry.calendarDay)) continue;
      const bucket = pairsByDay.get(entry.calendarDay);
      if (bucket) bucket.push({ entry, stored });
      else pairsByDay.set(entry.calendarDay, [{ entry, stored }]);
    }
  }

  return {
    ok: true,
    view: { fromCalendarDay, toCalendarDay, days: days.map((day) => buildDay(pairsByDay, day)) },
  };
}
