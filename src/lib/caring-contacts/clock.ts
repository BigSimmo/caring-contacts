export const AWST_TIME_ZONE = "Australia/Perth";

export type Clock = { now(): Date };

export function fixedClock(iso: string): Clock {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) throw new Error(`fixedClock: invalid instant ${iso}`);
  return { now: () => new Date(instant.getTime()) };
}

export function systemClock(): Clock {
  return { now: () => new Date() };
}

export type AwstParts = { year: number; month: number; day: number; hour: number; minute: number };

const AWST_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: AWST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function toAwstParts(instant: Date): AwstParts {
  const parts = Object.fromEntries(AWST_FORMAT.formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

export function awstCalendarDay(instant: Date): string {
  const { year, month, day } = toAwstParts(instant);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** AWST is UTC+8 year-round, so a local wall time maps to exactly one instant. */
export function awstWallTimeToInstant(calendarDay: string, hour: number, minute = 0): Date {
  const [year, month, day] = calendarDay.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute, 0, 0));
}

/**
 * The AWST calendar day a whole number of days away from another one.
 *
 * ADDED FOR A SCREEN, AND PUT HERE RATHER THAN ON IT (Phase 2B Task 13). The Schedule screen's day
 * strip has to name the days either side of the one being looked at, and every navigation control
 * on it is a link to one of them. That is arithmetic over an AWST calendar day, which is this
 * module's subject -- a helper written on the screen would be a second place in the codebase that
 * knows how to step an AWST day, on the surface that tells a coordinator which day a discharged
 * patient hears from the service.
 *
 * MIDDAY, NOT MIDNIGHT, and that is the whole of why this is not a one-liner. Stepping from
 * midnight does the arithmetic on a day boundary, where any error at all lands on the wrong date;
 * midday is the furthest point from either boundary, so adding whole days cannot cross one by
 * accident. AWST is UTC+8 all year, so the margin is against arithmetic rather than against a clock
 * change -- there is no daylight-saving shift here for it to survive.
 *
 * `schedule-view.ts` enumerates a range the same way, privately, and predates this. The two are the
 * same arithmetic and one of them should go; collapsing them was outside Task 13's brief, which
 * froze that module, so the duplication is reported rather than resolved.
 */
export function awstCalendarDayOffset(calendarDay: string, days: number): string {
  const midday = awstWallTimeToInstant(calendarDay, 12);
  return awstCalendarDay(new Date(midday.getTime() + days * 86_400_000));
}

/**
 * The one AWST ISO-8601 form this domain records instants in: a wall-clock value carrying an
 * explicit `+08:00` offset (AWST is UTC+8 year-round, so no daylight-saving branch exists).
 *
 * Shifting the instant forward 8 hours before formatting yields the AWST wall-clock value; the
 * resulting "Z" is then relabelled "+08:00". Every module that stamps a time reuses this so the
 * audit trail and the records beside it cannot drift into two formats.
 */
export function awstIsoTimestamp(instant: Date): string {
  const shifted = new Date(instant.getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().replace("Z", "+08:00");
}
