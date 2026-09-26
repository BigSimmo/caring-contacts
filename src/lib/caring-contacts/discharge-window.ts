// src/lib/caring-contacts/discharge-window.ts
//
// The range of discharge instants a new referral or plan may carry. A caring-contacts schedule is
// anchored on the discharge day, so a discharge far in the past would create a plan whose early
// contacts are already overdue, and one in the future would schedule messages to someone who has
// not left hospital. Both are refused at the request boundary rather than scheduled.
import { awstCalendarDay, awstCalendarDayOffset } from "./clock";

/** How far back a discharge may be and still start caring contacts. */
export const DISCHARGE_MAX_AGE_DAYS = 90;

/** How far ahead of the server clock a discharge may be, to absorb clock skew between machines. */
export const DISCHARGE_CLOCK_SKEW_MINUTES = 10;

const MILLISECONDS_PER_MINUTE = 60_000;

/**
 * True when the discharge's AWST calendar day is no more than 90 days before today's (AWST).
 * Compared by day, not by instant, because the plan wizard records a discharge DAY (stored at
 * midday AWST) and offers exactly today back to today minus 90 days.
 */
function isWithinMaxAge(discharge: Date, now: Date): boolean {
  return awstCalendarDay(discharge) >= awstCalendarDayOffset(awstCalendarDay(now), -DISCHARGE_MAX_AGE_DAYS);
}

/**
 * For a discharge INSTANT (manual intake records a date and time): within the last 90 days, and no
 * more than 10 minutes ahead of `now` to absorb clock skew.
 */
export function isDischargeWithinAcceptedWindow(discharge: Date, now: Date): boolean {
  if (Number.isNaN(discharge.getTime())) return false;
  const latest = now.getTime() + DISCHARGE_CLOCK_SKEW_MINUTES * MILLISECONDS_PER_MINUTE;
  return isWithinMaxAge(discharge, now) && discharge.getTime() <= latest;
}

/**
 * For a plan's discharge, which records a DAY: the AWST day must be from 90 days ago up to today.
 * A discharge "today" is stored at midday AWST, so an instant check would wrongly refuse it every
 * morning; the future is refused by day (tomorrow or later), with the same skew allowance.
 */
export function isDischargeDayWithinAcceptedWindow(discharge: Date, now: Date): boolean {
  if (Number.isNaN(discharge.getTime())) return false;
  const latestDay = awstCalendarDay(new Date(now.getTime() + DISCHARGE_CLOCK_SKEW_MINUTES * MILLISECONDS_PER_MINUTE));
  return isWithinMaxAge(discharge, now) && awstCalendarDay(discharge) <= latestDay;
}
