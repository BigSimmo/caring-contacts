import { describe, expect, it } from "vitest";

import { awstWallTimeToInstant, fixedClock } from "@/lib/caring-contacts/clock";
import { actorId } from "@/lib/caring-contacts/ids";
import { changeContactDate, moveContactWithinDay } from "@/lib/caring-contacts/contact-rescheduling";
import type { PlannedContact } from "@/lib/caring-contacts/schedule";

const clock = fixedClock("2026-08-19T02:00:00.000Z");
const contact: PlannedContact = {
  sequence: 3,
  cadenceLabel: "Month 1",
  calendarDay: "2026-09-15",
  sendAt: awstWallTimeToInstant("2026-09-15", 10),
  messageType: "standard",
};

describe("rescheduling a contact", () => {
  it("moves a contact inside its own day and keeps its calendar identity", () => {
    const result = moveContactWithinDay({ contact, toHour: 14, toMinute: 0 }, clock);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.sendAt).toEqual(awstWallTimeToInstant("2026-09-15", 14));
    expect(result.value.sequence).toBe(3);
    expect(result.value.cadenceLabel).toBe("Month 1");
    expect(result.value.calendarDay).toBe("2026-09-15");
  });

  it("refuses a move outside the approved send window", () => {
    expect(moveContactWithinDay({ contact, toHour: 20, toMinute: 0 }, clock)).toEqual({
      ok: false,
      reason: "contact-move-outside-approved-window",
    });
  });

  it("refuses a move that rolls the instant onto a different AWST calendar day even though the resulting hour looks in-window", () => {
    // toHour 33 rolls "2026-09-15T33:00" AWST forward to "2026-09-16T09:00" AWST -- 09:00 is
    // inside the 09:00-18:00 window, so this only fails if the day check runs independently of
    // (and cannot be short-circuited by a pass from) the window check.
    expect(moveContactWithinDay({ contact, toHour: 33, toMinute: 0 }, clock)).toEqual({
      ok: false,
      reason: "contact-move-leaves-scheduled-day",
    });
  });

  it("refuses a date change with no reason and no team-lead approval", () => {
    expect(
      changeContactDate(
        { contact, toCalendarDay: "2026-09-16", reason: " ", teamLeadApprovalActorId: actorId("LEAD") },
        clock,
      ),
    ).toEqual({ ok: false, reason: "contact-date-change-reason-required" });

    expect(
      changeContactDate(
        { contact, toCalendarDay: "2026-09-16", reason: "ward transfer", teamLeadApprovalActorId: null },
        clock,
      ),
    ).toEqual({ ok: false, reason: "contact-date-change-approval-required" });
  });

  it("refuses a date change into the past", () => {
    expect(
      changeContactDate(
        { contact, toCalendarDay: "2026-08-01", reason: "ward transfer", teamLeadApprovalActorId: actorId("LEAD") },
        clock,
      ),
    ).toEqual({ ok: false, reason: "contact-date-change-in-the-past" });
  });

  it("changes the date without rebasing the cadence label", () => {
    const result = changeContactDate(
      { contact, toCalendarDay: "2026-09-16", reason: "ward transfer", teamLeadApprovalActorId: actorId("LEAD") },
      clock,
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.calendarDay).toBe("2026-09-16");
    expect(result.value.cadenceLabel).toBe("Month 1");
    expect(result.value.sequence).toBe(3);
  });

  // Owner decision (2026-09-26): a contact may never be moved to a time that has already passed,
  // including earlier today. Refused by name, whichever of the two moves is asked for.
  describe("never to a time that has already passed", () => {
    const todaysContact: PlannedContact = {
      ...contact,
      calendarDay: "2026-08-19",
      sendAt: awstWallTimeToInstant("2026-08-19", 15),
    };
    // 2026-08-19 12:30 AWST.
    const middayClock = fixedClock("2026-08-19T04:30:00.000Z");

    it("refuses a move to earlier today", () => {
      expect(moveContactWithinDay({ contact: todaysContact, toHour: 10, toMinute: 0 }, middayClock)).toEqual({
        ok: false,
        reason: "contact-move-time-already-passed",
      });
    });

    it("refuses a move to this very minute, which is already under way", () => {
      expect(moveContactWithinDay({ contact: todaysContact, toHour: 12, toMinute: 30 }, middayClock)).toEqual({
        ok: false,
        reason: "contact-move-time-already-passed",
      });
    });

    it("accepts a move to later today", () => {
      const moved = moveContactWithinDay({ contact: todaysContact, toHour: 16, toMinute: 0 }, middayClock);
      expect(moved.ok).toBe(true);
    });

    it("refuses a date change to today at a send hour that has already passed", () => {
      const morningContact: PlannedContact = {
        ...contact,
        sendAt: awstWallTimeToInstant("2026-09-15", 10),
      };
      expect(
        changeContactDate(
          {
            contact: morningContact,
            toCalendarDay: "2026-08-19",
            reason: "ward transfer",
            teamLeadApprovalActorId: actorId("LEAD"),
          },
          middayClock,
        ),
      ).toEqual({ ok: false, reason: "contact-move-time-already-passed" });
    });

    it("accepts a date change to today at a send hour still to come", () => {
      const afternoonContact: PlannedContact = { ...contact, sendAt: awstWallTimeToInstant("2026-09-15", 15) };
      const moved = changeContactDate(
        {
          contact: afternoonContact,
          toCalendarDay: "2026-08-19",
          reason: "ward transfer",
          teamLeadApprovalActorId: actorId("LEAD"),
        },
        middayClock,
      );
      expect(moved.ok).toBe(true);
    });
  });
});
