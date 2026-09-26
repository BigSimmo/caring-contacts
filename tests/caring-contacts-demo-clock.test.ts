import { describe, expect, it } from "vitest";

import { CaringContactsTimeProvider } from "@/lib/caring-contacts/demo-clock";
import { awstCalendarDay, awstWallTimeToInstant } from "@/lib/caring-contacts/clock";
import { buildScheduleRange } from "@/lib/caring-contacts/schedule-view";
import { contactId, pathwayVersionId, patientId, planId, referralId, teamId } from "@/lib/caring-contacts/ids";
import type { PlanRecord } from "@/lib/caring-contacts/repository";
import {
  generateSyntheticCaseload,
  getSyntheticJourney,
  getSyntheticJourneysByCohort,
} from "@/lib/caring-contacts/synthetic-caseload";

describe("CaringContactsTimeProvider (Demo Clock)", () => {
  const baseIso = "2026-09-12T10:00:00+08:00";

  it("instantiates at the given instant and derives the correct AWST calendar day", () => {
    const clock = new CaringContactsTimeProvider(baseIso);
    expect(clock.calendarDay()).toBe("2026-09-12");
  });

  it("advances time forward by +1 day without mutating time of day or affecting timezones", () => {
    const clock = new CaringContactsTimeProvider(baseIso);
    const advanced = clock.advanceDays(1);
    expect(clock.calendarDay()).toBe("2026-09-13");
    expect(awstCalendarDay(advanced)).toBe("2026-09-13");
  });

  it("advances time forward by +1 week (+7 days)", () => {
    const clock = new CaringContactsTimeProvider(baseIso);
    const advanced = clock.advanceWeeks(1);
    expect(clock.calendarDay()).toBe("2026-09-19");
    expect(awstCalendarDay(advanced)).toBe("2026-09-19");
  });

  it("advances time forward by whole calendar months", () => {
    const clock = new CaringContactsTimeProvider(baseIso);
    const advanced = clock.advanceMonths(1);
    expect(clock.calendarDay()).toBe("2026-10-12");
    expect(awstCalendarDay(advanced)).toBe("2026-10-12");
  });

  it("resets back to initial baseline instant", () => {
    const clock = new CaringContactsTimeProvider(baseIso);
    clock.advanceDays(5);
    expect(clock.calendarDay()).toBe("2026-09-17");

    clock.reset();
    expect(clock.calendarDay()).toBe("2026-09-12");
  });

  it("sets virtual time directly to a specific instant", () => {
    const clock = new CaringContactsTimeProvider(baseIso);
    clock.setTime("2026-11-01T09:00:00+08:00");
    expect(clock.calendarDay()).toBe("2026-11-01");
  });

  it("triggers planned schedule states when virtual time advances past scheduled dates", () => {
    const clock = new CaringContactsTimeProvider("2026-09-12T08:00:00+08:00");
    const testPlanId = planId("demo-plan-time-test");
    const testPatientId = patientId("demo-patient-time-test");
    const contact1Id = contactId("demo-contact-01");
    const contact2Id = contactId("demo-contact-02");

    // Contact 1 scheduled for today (2026-09-12)
    // Contact 2 scheduled for 1 week later (2026-09-19)
    const mockPlan: PlanRecord = {
      plan: {
        id: testPlanId,
        teamId: teamId("team-a"),
        state: "active",
        version: 1,
      },
      patientId: testPatientId,
      referralId: referralId("ref-1"),
      pathwayVersionId: pathwayVersionId("pv-1"),
      createdAt: new Date("2026-09-10T08:00:00Z"),
      dischargeAt: new Date("2026-09-10T08:00:00Z"),
      completedAt: null,
      outcome: "inProgress",
      assuranceAttestations: [],
      contacts: [
        {
          contact: {
            id: contact1Id,
            planId: testPlanId,
            version: 1,
            state: "scheduled",
          },
          planned: {
            sequence: 1,
            calendarDay: "2026-09-12",
            sendAt: awstWallTimeToInstant("2026-09-12", 10),
            cadenceLabel: "Week 1",
            messageType: "standard",
          },
        },
        {
          contact: {
            id: contact2Id,
            planId: testPlanId,
            version: 1,
            state: "scheduled",
          },
          planned: {
            sequence: 2,
            calendarDay: "2026-09-19",
            sendAt: awstWallTimeToInstant("2026-09-19", 10),
            cadenceLabel: "Week 2",
            messageType: "standard",
          },
        },
      ],
    };

    // On base day (2026-09-12), contact 1 is due today, contact 2 is not
    const day1 = clock.calendarDay();
    const range1 = buildScheduleRange([mockPlan], day1, day1);
    expect(range1.ok).toBe(true);
    if (range1.ok) {
      expect(range1.view.days[0].counts.due).toBe(1);
      expect(range1.view.days[0].windows[0].entries[0].contactId).toBe(contact1Id);
    }

    // Advance clock by +1 week
    clock.advanceWeeks(1);
    const day2 = clock.calendarDay();
    expect(day2).toBe("2026-09-19");

    // On advanced day (2026-09-19), contact 2 is due
    const range2 = buildScheduleRange([mockPlan], day2, day2);
    expect(range2.ok).toBe(true);
    if (range2.ok) {
      expect(range2.view.days[0].counts.due).toBe(1);
      expect(range2.view.days[0].windows[0].entries[0].contactId).toBe(contact2Id);
    }
  });
});

describe("Synthetic Caseload Generator (#4STSM1)", () => {
  it("generates exactly 12 clinically realistic synthetic patient journeys", () => {
    const caseload = generateSyntheticCaseload();
    expect(caseload).toHaveLength(12);
  });

  it("covers all three requested cohorts: suicide prevention, youth aftercare, and rural/regional isolation", () => {
    const suicidePrevention = getSyntheticJourneysByCohort("postDischargeSuicidePrevention");
    const youth = getSyntheticJourneysByCohort("youthAftercare");
    const rural = getSyntheticJourneysByCohort("ruralRegionalIsolation");

    expect(suicidePrevention.length).toBeGreaterThanOrEqual(4);
    expect(youth.length).toBeGreaterThanOrEqual(4);
    expect(rural.length).toBeGreaterThanOrEqual(4);
  });

  it("ensures every patient number is strictly fictional and non-contactable", () => {
    const caseload = generateSyntheticCaseload();
    for (const journey of caseload) {
      expect(journey.fictionalMobile).toMatch(/^\+61 491 570 \d{3}$/);
      expect(journey.patientName).toContain("Synthetic");
    }
  });

  it("allows lookup of individual journeys by ID", () => {
    const journey = getSyntheticJourney("syn-pt-ed-01");
    expect(journey).toBeDefined();
    expect(journey?.cohort).toBe("postDischargeSuicidePrevention");
    expect(journey?.lifecycleState).toBe("active");
  });
});
