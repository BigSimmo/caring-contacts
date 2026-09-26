// tests/caring-contacts-schedule.test.ts
import { describe, expect, it } from "vitest";

import { awstCalendarDay, toAwstParts } from "@/lib/caring-contacts/clock";
import {
  APPROVED_SEND_WINDOW,
  buildApprovedSchedule,
  calendarDayPlusMonths,
  FIRST_CONTACT_REASON_MAX_LENGTH,
  firstContactDayBounds,
  SENDING_PREFERENCE_OPTIONS,
} from "@/lib/caring-contacts/schedule";

const discharge = new Date("2026-03-10T06:30:00.000Z"); // 14:30 AWST on 2026-03-10

function ok(result: ReturnType<typeof buildApprovedSchedule>) {
  if (!result.ok) throw new Error(`expected success, got ${result.reason}`);
  return result.contacts;
}

describe("buildApprovedSchedule", () => {
  it("produces exactly ten contacts with the approved cadence labels", () => {
    const contacts = ok(buildApprovedSchedule({ dischargeAt: discharge, sendingPreference: "morning" }));
    expect(contacts).toHaveLength(10);
    expect(contacts.map((c) => c.cadenceLabel)).toEqual([
      "Day 1",
      "Week 1",
      "Month 1",
      "Month 2",
      "Month 3",
      "Month 4",
      "Month 6",
      "Month 8",
      "Month 10",
      "Month 12",
    ]);
  });

  it("defaults the first contact to the day after discharge", () => {
    const contacts = ok(buildApprovedSchedule({ dischargeAt: discharge, sendingPreference: "morning" }));
    expect(contacts[0].calendarDay).toBe("2026-03-11");
    expect(contacts[1].calendarDay).toBe("2026-03-17"); // discharge + 7
  });

  it("anchors every later contact to the discharge date, not the first contact date", () => {
    const moved = ok(
      buildApprovedSchedule({
        dischargeAt: discharge,
        sendingPreference: "morning",
        firstContactDate: "2026-03-14",
        firstContactReason: "Patient requested a later start",
      }),
    );
    expect(moved[0].calendarDay).toBe("2026-03-14");
    expect(moved[2].calendarDay).toBe("2026-04-10"); // Month 1 from discharge, unmoved
  });

  it("clamps month arithmetic to the last day of a shorter month", () => {
    const contacts = ok(
      buildApprovedSchedule({ dischargeAt: new Date("2026-01-31T02:00:00.000Z"), sendingPreference: "morning" }),
    );
    expect(contacts[2].calendarDay).toBe("2026-02-28"); // 2026 is not a leap year
  });

  it("clamps into a leap February", () => {
    const contacts = ok(
      buildApprovedSchedule({ dischargeAt: new Date("2028-01-31T02:00:00.000Z"), sendingPreference: "morning" }),
    );
    expect(contacts[2].calendarDay).toBe("2028-02-29");
  });

  it("maps each preference to its exact AWST hour", () => {
    for (const [preference, hour] of [
      ["morning", 10],
      ["afternoon", 14],
      ["earlyEvening", 17],
    ] as const) {
      const contacts = ok(buildApprovedSchedule({ dischargeAt: discharge, sendingPreference: preference }));
      for (const contact of contacts) expect(toAwstParts(contact.sendAt).hour).toBe(hour);
    }
  });

  it("never schedules outside 09:00-18:00 AWST", () => {
    for (const preference of ["morning", "afternoon", "earlyEvening"] as const) {
      const contacts = ok(buildApprovedSchedule({ dischargeAt: discharge, sendingPreference: preference }));
      for (const contact of contacts) {
        const { hour } = toAwstParts(contact.sendAt);
        expect(hour).toBeGreaterThanOrEqual(9);
        expect(hour).toBeLessThan(18);
      }
    }
  });

  it("sends on weekends without adjustment", () => {
    // 2026-03-13 is a Friday; +1 day is Saturday 2026-03-14.
    const contacts = ok(
      buildApprovedSchedule({ dischargeAt: new Date("2026-03-13T02:00:00.000Z"), sendingPreference: "morning" }),
    );
    expect(contacts[0].calendarDay).toBe("2026-03-14");
    expect(new Date(`${contacts[0].calendarDay}T00:00:00Z`).getUTCDay()).toBe(6);
  });

  it("types the first and closing messages", () => {
    const contacts = ok(buildApprovedSchedule({ dischargeAt: discharge, sendingPreference: "morning" }));
    expect(contacts[0].messageType).toBe("first");
    expect(contacts[9].messageType).toBe("closing");
    expect(contacts.slice(1, 9).every((c) => c.messageType === "standard")).toBe(true);
  });

  it("accepts both ends of the permitted first-contact range", () => {
    for (const day of ["2026-03-10", "2026-03-17"]) {
      const result = buildApprovedSchedule({
        dischargeAt: discharge,
        sendingPreference: "morning",
        firstContactDate: day,
        firstContactReason: "Coordinator decision",
      });
      expect(result.ok).toBe(true);
    }
  });

  it("rejects a first contact date outside the permitted range", () => {
    for (const day of ["2026-03-09", "2026-03-18"]) {
      expect(
        buildApprovedSchedule({
          dischargeAt: discharge,
          sendingPreference: "morning",
          firstContactDate: day,
          firstContactReason: "Too far",
        }),
      ).toEqual({ ok: false, reason: "first-contact-out-of-range" });
    }
  });

  it("requires a reason whenever the first contact date is not the default", () => {
    expect(
      buildApprovedSchedule({
        dischargeAt: discharge,
        sendingPreference: "morning",
        firstContactDate: "2026-03-13",
      }),
    ).toEqual({ ok: false, reason: "first-contact-reason-required" });
    expect(
      buildApprovedSchedule({
        dischargeAt: discharge,
        sendingPreference: "morning",
        firstContactDate: "2026-03-13",
        firstContactReason: "   ",
      }),
    ).toEqual({ ok: false, reason: "first-contact-reason-required" });
  });

  it("publishes the reason it accepted, trimmed, so a store never re-derives whether one was needed", () => {
    // Ruling 107: the write path already existed and this is the one thing that was missing from
    // it. The schedule decides whether a reason is required, so the schedule -- not each store --
    // is what says which string may be persisted.
    const result = buildApprovedSchedule({
      dischargeAt: discharge,
      sendingPreference: "morning",
      firstContactDate: "2026-03-13",
      firstContactReason: "  Patient asked to wait until she is home from her sister's.\n",
    });
    expect(result).toMatchObject({
      ok: true,
      firstContactReason: "Patient asked to wait until she is home from her sister's.",
    });
  });

  it("publishes NO reason when the first contact is on the usual day, whatever was supplied", () => {
    // A reason is required only when the date moves, so a plan on the usual day is not missing one
    // -- and free text about a patient that no surface ever accounts for should not be stored.
    const notRequested = buildApprovedSchedule({ dischargeAt: discharge, sendingPreference: "morning" });
    expect(notRequested).toMatchObject({ ok: true, firstContactReason: null });

    const supplied = buildApprovedSchedule({
      dischargeAt: discharge,
      sendingPreference: "morning",
      firstContactDate: "2026-03-11", // the default day, stated explicitly
      firstContactReason: "Sent although no move was requested",
    });
    expect(supplied).toMatchObject({ ok: true, firstContactReason: null });
  });

  it("refuses a reason past the cap by its own name, rather than truncating it (Ruling 106)", () => {
    // Truncation is what is being refused here, not length as such: "not because the family
    // objected" cut off after "not" says the opposite, and nothing in the record would show it.
    expect(
      buildApprovedSchedule({
        dischargeAt: discharge,
        sendingPreference: "morning",
        firstContactDate: "2026-03-13",
        firstContactReason: "x".repeat(FIRST_CONTACT_REASON_MAX_LENGTH + 1),
      }),
    ).toEqual({ ok: false, reason: "first-contact-reason-too-long" });

    // The boundary itself is accepted, so the refusal above is the cap and not the rule.
    const atCap = "x".repeat(FIRST_CONTACT_REASON_MAX_LENGTH);
    expect(
      buildApprovedSchedule({
        dischargeAt: discharge,
        sendingPreference: "morning",
        firstContactDate: "2026-03-13",
        firstContactReason: atCap,
      }),
    ).toMatchObject({ ok: true, firstContactReason: atCap });
  });

  it("measures the cap after trimming, so surrounding whitespace cannot refuse an acceptable reason", () => {
    const atCap = "x".repeat(FIRST_CONTACT_REASON_MAX_LENGTH);
    expect(
      buildApprovedSchedule({
        dischargeAt: discharge,
        sendingPreference: "morning",
        firstContactDate: "2026-03-13",
        firstContactReason: `   ${atCap}   `,
      }),
    ).toMatchObject({ ok: true, firstContactReason: atCap });
  });

  it("suppresses Week 1 when the first contact absorbs it, rather than sending twice in a day", () => {
    const contacts = ok(
      buildApprovedSchedule({
        dischargeAt: discharge,
        sendingPreference: "morning",
        firstContactDate: "2026-03-17",
        firstContactReason: "Patient away for a week",
      }),
    );
    expect(contacts[1].suppressed).toEqual({ reason: "absorbedByFirstContact" });
    expect(contacts.filter((c) => !c.suppressed)).toHaveLength(9);
  });

  it("keeps non-suppressed calendar days strictly increasing", () => {
    for (const day of ["2026-03-10", "2026-03-13", "2026-03-17"]) {
      const contacts = ok(
        buildApprovedSchedule({
          dischargeAt: discharge,
          sendingPreference: "morning",
          firstContactDate: day,
          firstContactReason: "Coordinator decision",
        }),
      ).filter((c) => !c.suppressed);
      const days = contacts.map((c) => c.calendarDay);
      expect([...days].sort()).toEqual(days);
      expect(new Set(days).size).toBe(days.length);
    }
  });

  it("is deterministic", () => {
    const a = ok(buildApprovedSchedule({ dischargeAt: discharge, sendingPreference: "afternoon" }));
    const b = ok(buildApprovedSchedule({ dischargeAt: discharge, sendingPreference: "afternoon" }));
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("derives the discharge day in AWST, not UTC", () => {
    // 20:00 UTC on 2026-03-10 is 04:00 AWST on 2026-03-11, so day 1 is the 12th.
    const contacts = ok(
      buildApprovedSchedule({ dischargeAt: new Date("2026-03-10T20:00:00.000Z"), sendingPreference: "morning" }),
    );
    expect(awstCalendarDay(new Date("2026-03-10T20:00:00.000Z"))).toBe("2026-03-11");
    expect(contacts[0].calendarDay).toBe("2026-03-12");
  });
});

describe("SENDING_PREFERENCE_OPTIONS — the wording a screen may render (Phase 2B Task 8)", () => {
  it("offers the three preferences in the order they occur in a day", () => {
    expect(SENDING_PREFERENCE_OPTIONS.map((option) => option.preference)).toEqual([
      "morning",
      "afternoon",
      "earlyEvening",
    ]);
    expect(SENDING_PREFERENCE_OPTIONS.map((option) => option.label)).toEqual(["Morning", "Afternoon", "Early evening"]);
  });

  it("states the same send time the schedule actually uses, derived rather than restated", () => {
    // The property, not the strings. A screen writing "10:00 am AWST" beside a radio button would
    // be a second copy of SEND_HOUR_BY_PREFERENCE, free to go on saying 10:00 after the hour moved.
    // So each option's wording is checked against the hour the built schedule really sends at.
    for (const option of SENDING_PREFERENCE_OPTIONS) {
      const contacts = ok(buildApprovedSchedule({ dischargeAt: discharge, sendingPreference: option.preference }));
      const { hour } = toAwstParts(contacts[0].sendAt);
      const suffix = hour < 12 ? "am" : "pm";
      const twelveHour = hour % 12 === 0 ? 12 : hour % 12;
      expect(option.sendTime, `${option.preference} is advertised at the wrong time`).toBe(
        `${twelveHour}:00 ${suffix} AWST`,
      );
    }
  });

  it("advertises every send time inside the approved window", () => {
    // ROUND 1, M-1. The first version of this case asserted
    // `/^(9|10|11|12|[1-5]):00 (am|pm) AWST$/`, which is named for the window and does not test it:
    // "5:00 am AWST" matches, and 5am is four hours before the earliest send this domain permits.
    // It was the same tautology this task's own finding 3 documented -- an assertion that reads a
    // shape instead of the rule -- written twice more in the same diff by the person who wrote the
    // finding. So this parses the advertised wording back to a 24-hour hour and compares it against
    // APPROVED_SEND_WINDOW itself.
    for (const option of SENDING_PREFERENCE_OPTIONS) {
      const parsed = /^(\d{1,2}):00 (am|pm) AWST$/.exec(option.sendTime);
      expect(parsed, `${option.preference} does not advertise an AWST wall-clock time`).not.toBeNull();
      const twelveHour = Number(parsed![1]);
      const meridiem = parsed![2];
      const hour = meridiem === "pm" ? (twelveHour === 12 ? 12 : twelveHour + 12) : twelveHour === 12 ? 0 : twelveHour;

      expect(hour, `${option.preference} is advertised before the earliest permitted send`).toBeGreaterThanOrEqual(
        APPROVED_SEND_WINDOW.earliestHour,
      );
      expect(hour, `${option.preference} is advertised at or after the latest permitted send`).toBeLessThan(
        APPROVED_SEND_WINDOW.latestHourExclusive,
      );
    }
  });
});

describe("firstContactDayBounds — the range a screen may offer (Phase 2B Task 9)", () => {
  // Ruling [118] puts the first-contact-date control on the review-and-activation screen, and the
  // screen must offer exactly the days `buildApprovedSchedule` accepts. These cases check the
  // published bounds against the function that enforces them, rather than against the numbers 0, 1
  // and 7 written out a second time — a bound that agreed with a copy of the rule instead of with
  // the rule would be the tautology round 1's M-1 and M-2 were about.
  const dischargeDay = awstCalendarDay(discharge);

  it("names a usual day the schedule uses when no date is supplied at all", () => {
    const bounds = firstContactDayBounds(dischargeDay);
    expect(bounds).not.toBeNull();
    const contacts = ok(buildApprovedSchedule({ dischargeAt: discharge, sendingPreference: "morning" }));
    expect(bounds!.usual, "the advertised usual day is not the day the schedule defaults to").toBe(
      contacts[0].calendarDay,
    );
  });

  it("names an earliest and a latest day the schedule accepts, and no day outside them", () => {
    const bounds = firstContactDayBounds(dischargeDay)!;

    // Every advertised day is accepted. A reason is supplied because a moved date requires one;
    // the point of the case is the RANGE, so the reason must not be what refuses it.
    for (const day of [bounds.earliest, bounds.usual, bounds.latest]) {
      const result = buildApprovedSchedule({
        dischargeAt: discharge,
        sendingPreference: "morning",
        firstContactDate: day,
        firstContactReason: "The ward agreed this day with the patient before discharge.",
      });
      expect(result.ok, `${day} is advertised as choosable and the schedule refused it`).toBe(true);
    }

    // And the day on each side is refused, which is what makes the bounds bounds rather than two
    // days that happen to work.
    for (const day of [dayBefore(bounds.earliest), dayAfter(bounds.latest)]) {
      const result = buildApprovedSchedule({
        dischargeAt: discharge,
        sendingPreference: "morning",
        firstContactDate: day,
        firstContactReason: "The ward agreed this day with the patient before discharge.",
      });
      expect(result.ok, `${day} is outside the advertised range and the schedule accepted it`).toBe(false);
      if (!result.ok) expect(result.reason).toBe("first-contact-out-of-range");
    }
  });

  it("answers null for a day that is not a real AWST calendar day", () => {
    // A screen holds whatever a clinician typed, including nothing. Answering with bounds computed
    // from a nonsense day would put three nonsense days on a date control.
    expect(firstContactDayBounds("")).toBeNull();
    expect(firstContactDayBounds("2026-02-30")).toBeNull();
    expect(firstContactDayBounds("10/03/2026")).toBeNull();
  });
});

describe("calendarDayPlusMonths — the arithmetic the demo seed re-discharges a plan against (Ruling 159)", () => {
  // The demo seed needs to place a plan's own discharge day a fixed number of calendar months
  // before "now" so a later Month-N cadence entry lands exactly on today. These cases check the
  // exported function against the schedule it is meant to agree with, not against a second,
  // hand-typed set of dates that could quietly drift away from it.
  const dischargeDay = awstCalendarDay(discharge); // 2026-03-10

  it("agrees with the Month-N cadence buildApprovedSchedule itself builds forward", () => {
    const contacts = ok(buildApprovedSchedule({ dischargeAt: discharge, sendingPreference: "morning" }));
    const monthTwo = contacts.find((contact) => contact.cadenceLabel === "Month 2");
    expect(monthTwo).toBeDefined();
    expect(calendarDayPlusMonths(dischargeDay, 2)).toBe(monthTwo!.calendarDay);
  });

  it("goes backwards for a negative amount, which is what the demo seed actually uses", () => {
    expect(calendarDayPlusMonths("2026-08-29", -2)).toBe("2026-06-29");
  });

  it("clamps to the last day of a shorter target month, in both directions", () => {
    expect(calendarDayPlusMonths("2026-01-31", 1)).toBe("2026-02-28"); // 2026 is not a leap year
    expect(calendarDayPlusMonths("2026-03-31", -1)).toBe("2026-02-28");
  });

  it("answers null for a day that is not a real AWST calendar day", () => {
    expect(calendarDayPlusMonths("", 2)).toBeNull();
    expect(calendarDayPlusMonths("2026-02-30", 2)).toBeNull();
    expect(calendarDayPlusMonths("10/03/2026", 2)).toBeNull();
  });
});

/** One calendar day either side, computed here so the bounds are checked against arithmetic they do not share. */
function dayBefore(calendarDay: string): string {
  return shiftDay(calendarDay, -1);
}

function dayAfter(calendarDay: string): string {
  return shiftDay(calendarDay, 1);
}

function shiftDay(calendarDay: string, amount: number): string {
  const [year, month, day] = calendarDay.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day + amount));
  return cursor.toISOString().slice(0, 10);
}
