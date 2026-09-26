// tests/caring-contacts-clock.test.ts
import { describe, expect, it } from "vitest";

import {
  AWST_TIME_ZONE,
  awstCalendarDay,
  awstCalendarDayOffset,
  fixedClock,
  toAwstParts,
} from "@/lib/caring-contacts/clock";

describe("caring-contacts clock", () => {
  it("is fixed and repeatable", () => {
    const clock = fixedClock("2026-08-19T02:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-08-19T02:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-08-19T02:00:00.000Z");
  });

  it("uses AWST with no daylight saving in either half of the year", () => {
    expect(AWST_TIME_ZONE).toBe("Australia/Perth");
    // 02:00 UTC is 10:00 AWST in both January and July — Perth does not observe DST.
    expect(toAwstParts(new Date("2026-01-15T02:00:00.000Z")).hour).toBe(10);
    expect(toAwstParts(new Date("2026-07-15T02:00:00.000Z")).hour).toBe(10);
  });

  it("derives the AWST calendar day across the UTC date boundary", () => {
    // 20:00 UTC on the 18th is 04:00 AWST on the 19th.
    expect(awstCalendarDay(new Date("2026-08-18T20:00:00.000Z"))).toBe("2026-08-19");
  });

  it("steps an AWST calendar day forwards and backwards over a month end", () => {
    // Written out rather than computed, because a test that derived the answer the same way the
    // function does would agree with it however wrong both were.
    expect(awstCalendarDayOffset("2026-08-31", 1)).toBe("2026-09-01");
    expect(awstCalendarDayOffset("2026-09-01", -1)).toBe("2026-08-31");
  });

  it("steps across a leap-year February and a year end", () => {
    expect(awstCalendarDayOffset("2028-02-28", 1)).toBe("2028-02-29");
    expect(awstCalendarDayOffset("2028-02-29", 1)).toBe("2028-03-01");
    expect(awstCalendarDayOffset("2026-12-31", 1)).toBe("2027-01-01");
    expect(awstCalendarDayOffset("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("answers the same day for an offset of zero", () => {
    expect(awstCalendarDayOffset("2026-08-31", 0)).toBe("2026-08-31");
  });

  it("spans a whole strip in both directions without crossing a boundary by accident", () => {
    // The Schedule screen's day strip: three days back, then six forward from there. This is the
    // exact arithmetic `src/app/caring-contacts/schedule/page.tsx` performs, and it is the case a
    // midnight-based implementation gets wrong -- the AWST day and the UTC day differ for every
    // instant before 08:00 AWST, so stepping from midnight lands on the previous UTC date.
    const from = awstCalendarDayOffset("2026-09-01", -3);
    expect(from).toBe("2026-08-29");
    expect(awstCalendarDayOffset(from, 6)).toBe("2026-09-04");
  });
});
