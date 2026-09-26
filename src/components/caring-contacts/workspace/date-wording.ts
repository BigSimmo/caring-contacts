import { toAwstParts } from "@/lib/caring-contacts/clock";

/**
 * Dates in the words a clinician reads, always on the Perth (AWST) calendar.
 *
 * Month names are written out rather than formatted by `Intl`, the Schedule screen's convention
 * and its reason: `Intl.DateTimeFormat`'s wording depends on the ICU data the runtime was built
 * with, so the same date could read differently in a test, in CI and on a clinician's machine.
 * `toAwstParts` only extracts numbers, which do not vary.
 */
const MONTH_NAMES = Object.freeze([
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]);

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * "26 September 2026" for an ISO instant ("2026-09-26T11:59:27.040+08:00") or a calendar day
 * ("2026-09-26"). A calendar day is read as written, never shifted through a time zone. Anything
 * that is not a date is returned unchanged, so a malformed value is shown rather than hidden.
 */
export function awstDateWording(value: string): string {
  const day = CALENDAR_DAY.exec(value);
  if (day) {
    const month = Number(day[2]);
    if (month < 1 || month > 12) return value;
    return `${Number(day[3])} ${MONTH_NAMES[month - 1]} ${day[1]}`;
  }
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return value;
  const { year, month, day: dayOfMonth } = toAwstParts(instant);
  return `${dayOfMonth} ${MONTH_NAMES[month - 1]} ${year}`;
}

/** "11:59 am AWST on 26 September 2026" for an ISO instant; anything else is returned unchanged. */
export function awstDateTimeWording(value: string): string {
  const instant = new Date(value);
  if (CALENDAR_DAY.test(value) || Number.isNaN(instant.getTime())) return awstDateWording(value);
  const { year, month, day, hour, minute } = toAwstParts(instant);
  const suffix = hour < 12 ? "am" : "pm";
  const twelveHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelveHour}:${String(minute).padStart(2, "0")} ${suffix} AWST on ${day} ${MONTH_NAMES[month - 1]} ${year}`;
}
