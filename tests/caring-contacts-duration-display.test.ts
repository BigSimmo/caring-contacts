// tests/caring-contacts-duration-display.test.ts
//
// `formatMinutesDuration` (src/lib/caring-contacts/duration-display.ts) turns a raw minute count
// into what a coordinator reads as a wait -- "31 days" rather than "44575 minutes". This is a
// presentation-only fix (Phase 2B design sweep, 2026-08-29): the Team screen's overdue-exception
// cell and its screen-reader announcement were both printing the raw minute count once a wait grew
// past an hour, which nobody can read as a duration without doing arithmetic.
//
// EVERY CASE HERE IS A BOUNDARY, not a sample. The function's whole job is deciding which unit to
// switch to and how to round at each switch, so the boundaries -- 59/60/61 (minute-to-hour), 90
// (a rounding case inside the hour tier), 1439/1440/1441 (hour-to-day), and 44575 (the exact figure
// that was observed on screen as the defect) -- are what would actually catch an off-by-one in that
// arithmetic. A sweep of arbitrary values would not.
import { describe, expect, it } from "vitest";

import { formatMinutesDuration } from "@/lib/caring-contacts/duration-display";

describe("formatMinutesDuration says a minute count the way a coordinator reads it", () => {
  it("stays in exact minutes below an hour, singular only at exactly 1", () => {
    expect(formatMinutesDuration(0)).toBe("0 minutes");
    expect(formatMinutesDuration(1)).toBe("1 minute");
    expect(formatMinutesDuration(59)).toBe("59 minutes");
  });

  it("switches to hours at 60 minutes, rounded to the nearest hour", () => {
    expect(formatMinutesDuration(60)).toBe("1 hour");
    // 61 minutes is 1.017 hours -- nearest-rounds down to the same "1 hour" as 60, not up.
    expect(formatMinutesDuration(61)).toBe("1 hour");
    // 90 minutes is exactly 1.5 hours -- the deliberate round-up-on-a-tie case.
    expect(formatMinutesDuration(90)).toBe("2 hours");
  });

  it("hands the hour-to-day boundary off before ever saying '24 hours'", () => {
    // 1439 minutes is 23h59m -- rounding that to hours alone would say "24 hours", which nobody
    // says. Because the day figure is computed once the hour figure would reach 24, this instead
    // reads as what a coordinator would actually call it: a day.
    expect(formatMinutesDuration(1439)).toBe("1 day");
    expect(formatMinutesDuration(1440)).toBe("1 day");
    expect(formatMinutesDuration(1441)).toBe("1 day");
  });

  it("renders the defect's own observed figure as the readable duration it stands for", () => {
    // 44575 minutes is 30.955 days -- the value this fix exists for, previously rendered as the
    // raw, unreadable "44575 minutes" on the running Team screen.
    expect(formatMinutesDuration(44575)).toBe("31 days");
  });
});
