/**
 * A count of minutes, said the way a coordinator would say it out loud rather than counted out.
 *
 * WHY THIS EXISTS. The Team screen measures every wait in minutes, because that is the unit its
 * domain reads compute in and the threshold (`UNCLAIMED_ESCALATION_MINUTES`) is defined in. But a
 * raw minute count stops being readable once a wait grows past an hour or so: "44575 minutes" makes
 * a coordinator do arithmetic to learn a message has been waiting a month, and the screen's job is
 * to tell them that directly. This module changes only how the number is SAID -- it never rounds,
 * clamps or otherwise touches the minute count itself, which stays exact wherever it is still
 * compared to the escalation threshold or stored.
 *
 * THE ROUNDING RULE, CHOSEN DELIBERATELY. Below an hour, the count is shown exactly in minutes --
 * that is already the coordinator's own unit and the common case, so it is left alone. At an hour
 * and above, the figure is rounded to the NEAREST whole unit (never floored, never ceiled): a wait
 * of 90 minutes reads "2 hours" and one of 44575 minutes reads "31 days" (44575 minutes is 30.955
 * days). Nearest-rounding was chosen over flooring because flooring would make this module
 * ANNOUNCE LESS TIME THAN HAS ACTUALLY PASSED for an exception backlog a coordinator is meant to
 * treat as overdue, which is the wrong direction to be wrong in; nearest-rounding is honest on
 * average and never off by more than half a unit.
 *
 * THE HOUR-TO-DAY HANDOFF IS DELIBERATELY CASCADED, not done by a fixed minute cutoff. Rounding a
 * count just under 1440 minutes (a day) straight to hours can round UP to 24 -- and "24 hours" is a
 * true statement that no coordinator says; they say "a day". So the day figure is only computed, and
 * only shown, once the hour figure would itself round up to a full day (`hours >= 24`); the day
 * count is then rounded from the original minute count, not from the already-rounded hour count, so
 * a second rounding step cannot compound the first one's error.
 *
 * WHAT STAYS UNCHANGED ON PURPOSE. Singular/plural wording flips at exactly 1 in every unit ("1
 * minute", "1 hour", "1 day"), matching this screen's existing `plural` helper. Zero is worded as
 * "0 minutes", the same way this screen already words a zero count of anything else -- there is no
 * unclaimed-work reading that hands this function a negative count, so none is defended against.
 */
export function formatMinutesDuration(totalMinutes: number): string {
  if (totalMinutes < 60) return countedUnit(totalMinutes, "minute", "minutes");

  const hours = Math.round(totalMinutes / 60);
  if (hours < 24) return countedUnit(hours, "hour", "hours");

  const days = Math.round(totalMinutes / 1440);
  return countedUnit(days, "day", "days");
}

/**
 * A private duplicate of `team-roster.tsx`'s own `plural` helper rather than an import of it.
 * `team-roster.tsx` is a Server Component and does not export it, and this two-line pluraliser is
 * not worth adding an export -- and a cross-module dependency -- to that file for. The same
 * deliberate-duplication call is made a few times over in that file already (see its
 * `WEEKDAY_NAMES`/`MONTH_NAMES` comment) for the same reason: the thing being duplicated cannot
 * change meaning out from under either copy.
 */
function countedUnit(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
