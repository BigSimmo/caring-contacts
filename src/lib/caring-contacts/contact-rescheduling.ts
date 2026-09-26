// src/lib/caring-contacts/contact-rescheduling.ts
//
// Coordination design spec §5: "A coordinator may move a contact only within its scheduled day;
// a date change needs a reason and team-lead approval." `moveContactWithinDay` and
// `changeContactDate` are granted action names with no rules behind them until now. Spec §8 also
// requires that nothing sends outside 09:00-18:00 AWST and that the twelve-month calendar never
// rebases -- both functions below leave `sequence`, `cadenceLabel`, `messageType`, and
// `suppressed` untouched; only `calendarDay` and `sendAt` ever change.
//
// Pure transition module: no ambient time beyond the injected `Clock` (both moves need one, to
// refuse a time that has already passed), no storage, no permission check -- the
// caller has already authorised the action and, for a date change, already collected the
// team-lead approval this module only checks for presence.
import { awstCalendarDay, awstWallTimeToInstant, type Clock } from "./clock";
import type { ActorId } from "./ids";
import { contactSendability, type ContactState, type TransitionResult } from "./model";
import { isAwstCalendarDay, isWithinApprovedSendWindow, type PlannedContact } from "./schedule";

export type ContactMoveRequest = { contact: PlannedContact; toHour: number; toMinute: number };
export type ContactDateChangeRequest = {
  contact: PlannedContact;
  toCalendarDay: string;
  reason: string;
  teamLeadApprovalActorId: ActorId | null;
};

/**
 * Moves a contact to a different time on the same scheduled day.
 *
 * Refusals:
 *   * `contact-move-leaves-scheduled-day` -- the resulting instant's AWST calendar day must equal
 *     `contact.calendarDay`. Checked independently of the window check below: an hour/minute pair
 *     that overflows past midnight can roll onto the next AWST day while still looking like an
 *     in-window hour (e.g. 33:00 on day N reads as 09:00 on day N+1), so this check cannot be
 *     skipped just because the resulting hour happens to fall inside 09:00-18:00.
 *   * `contact-move-outside-approved-window` -- the resulting instant must fall inside
 *     `APPROVED_SEND_WINDOW` (09:00-18:00 AWST).
 *   * `contact-move-time-already-passed` -- see `CONTACT_MOVE_TIME_ALREADY_PASSED`.
 */
export function moveContactWithinDay(request: ContactMoveRequest, clock: Clock): TransitionResult<PlannedContact> {
  const { contact, toHour, toMinute } = request;
  const sendAt = awstWallTimeToInstant(contact.calendarDay, toHour, toMinute);

  if (awstCalendarDay(sendAt) !== contact.calendarDay) {
    return { ok: false, reason: "contact-move-leaves-scheduled-day" };
  }
  if (!isWithinApprovedSendWindow(sendAt)) {
    return { ok: false, reason: "contact-move-outside-approved-window" };
  }
  if (hasAlreadyPassed(sendAt, clock)) return { ok: false, reason: CONTACT_MOVE_TIME_ALREADY_PASSED };

  return { ok: true, value: { ...contact, sendAt } };
}

/**
 * OWNER DECISION (2026-09-26): a contact may never be moved to a time that has already passed --
 * including earlier today, and including this very minute, which is already under way. A message
 * rescheduled into the past would either go out at once, outside the time anyone chose, or never go
 * at all while the plan showed it as still to come. Both moves refuse it by this one name.
 */
export const CONTACT_MOVE_TIME_ALREADY_PASSED = "contact-move-time-already-passed";

function hasAlreadyPassed(sendAt: Date, clock: Clock): boolean {
  return sendAt.getTime() <= clock.now().getTime();
}

/**
 * Moves a contact to a different scheduled day, at the same wall-clock hour it was already
 * scheduled for (see the module note: the twelve-month calendar's other fields never rebase, and
 * the send hour is one of them -- a date change is a date change, not also an implicit time
 * change).
 *
 * Refusals:
 *   * `contact-date-change-reason-required` -- a non-blank reason is required.
 *   * `contact-date-change-approval-required` -- a team-lead approver must be recorded.
 *   * `contact-date-change-invalid-day` -- the target must be a real AWST calendar day in
 *     `YYYY-MM-DD` form. Without this, `"banana"` sorted after today and reached the store as an
 *     invalid send instant.
 *   * `contact-date-change-in-the-past` -- the target day must not be before the clock's current
 *     AWST calendar day.
 *   * `contact-move-time-already-passed` -- the target day is today, and the contact's send time
 *     on it has already passed. See `CONTACT_MOVE_TIME_ALREADY_PASSED`.
 */
export function changeContactDate(request: ContactDateChangeRequest, clock: Clock): TransitionResult<PlannedContact> {
  const { contact, toCalendarDay, reason, teamLeadApprovalActorId } = request;

  if (reason.trim() === "") return { ok: false, reason: "contact-date-change-reason-required" };
  if (teamLeadApprovalActorId === null) return { ok: false, reason: "contact-date-change-approval-required" };
  if (!isAwstCalendarDay(toCalendarDay)) return { ok: false, reason: "contact-date-change-invalid-day" };

  const today = awstCalendarDay(clock.now());
  if (toCalendarDay < today) return { ok: false, reason: "contact-date-change-in-the-past" };

  const { hour, minute } = wallClockOf(contact.sendAt, contact.calendarDay);
  const sendAt = awstWallTimeToInstant(toCalendarDay, hour, minute);
  if (hasAlreadyPassed(sendAt, clock)) return { ok: false, reason: CONTACT_MOVE_TIME_ALREADY_PASSED };
  return { ok: true, value: { ...contact, calendarDay: toCalendarDay, sendAt } };
}

/** Recovers the AWST wall-clock hour/minute a contact was scheduled at, from its own `sendAt`. */
function wallClockOf(sendAt: Date, calendarDay: string): { hour: number; minute: number } {
  const wholeMinutesSinceMidnight = Math.round(
    (sendAt.getTime() - awstWallTimeToInstant(calendarDay, 0, 0).getTime()) / 60_000,
  );
  return { hour: Math.floor(wholeMinutesSinceMidnight / 60), minute: wholeMinutesSinceMidnight % 60 };
}

/**
 * Whether a contact in this state may still be moved at all.
 *
 * Only a contact still waiting to go (`scheduled`) may. Every other state is a record of something
 * that already happened -- a send in flight, a send made, a delivery report, a cancellation by a
 * withdrawal or a recorded death -- and moving its `sendAt` would rewrite when a message went, or
 * re-arm the calendar of a message that was deliberately stopped. Both stores ask this before they
 * move anything, so they refuse the same writes by the same name.
 */
export function isContactReschedulable(state: ContactState): boolean {
  return state === "scheduled";
}

/**
 * True when moving one contact to `toCalendarDay` would put it on the same AWST day as another
 * contact of the same plan that is sending, or has sent (spec §8: two caring contacts must never
 * land on the same calendar day). Contacts that will never be sent -- suppressed, cancelled,
 * missed -- do not occupy their day.
 */
export function dateChangeCollides(
  movingContactId: string,
  toCalendarDay: string,
  siblings: readonly { id: string; state: ContactState; calendarDay: string }[],
): boolean {
  return siblings.some(
    (sibling) =>
      sibling.id !== movingContactId &&
      sibling.calendarDay === toCalendarDay &&
      contactSendability(sibling.state) !== "willNotBeSent",
  );
}
