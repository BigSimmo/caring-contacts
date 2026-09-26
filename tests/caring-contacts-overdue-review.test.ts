// tests/caring-contacts-overdue-review.test.ts
//
// A contact still "scheduled" long after its send time was never sent. It must surface as needing
// review on Today and Team (and in the schedule's exceptions group) instead of sitting as
// "Due to send" forever. Synthetic data throughout.
import { describe, expect, it } from "vitest";

import { demoActorForRole } from "@/lib/caring-contacts-server/session";
import { PLAN_ASSURANCE_VALUES } from "@/lib/caring-contacts/assurances";
import { awstCalendarDay, fixedClock } from "@/lib/caring-contacts/clock";
import { idempotencyKey, pathwayVersionId, patientId, planId, referralId } from "@/lib/caring-contacts/ids";
import { createInMemoryRepository } from "@/lib/caring-contacts/in-memory-repository";
import type { PlanRecord } from "@/lib/caring-contacts/repository";
import { buildScheduleRange, OVERDUE_REVIEW_GRACE_MINUTES } from "@/lib/caring-contacts/schedule-view";
import { buildTeamWorkload } from "@/lib/caring-contacts/team-workload";

const DISCHARGE_AT = new Date("2026-03-02T02:00:00.000Z");
const coordinator = demoActorForRole("coordinator");

async function activePlanRecords(options: { pause?: boolean } = {}): Promise<PlanRecord[]> {
  const store = createInMemoryRepository(fixedClock(DISCHARGE_AT.toISOString()));
  const created = await store.createPlan(
    {
      planId: planId("OVERDUE-PLAN-1"),
      referralId: referralId("OVERDUE-REFERRAL-1"),
      patientId: patientId("OVERDUE-PATIENT-1"),
      pathwayVersionId: pathwayVersionId("OVERDUE-PATHWAY-1"),
      dischargeAt: DISCHARGE_AT,
      sendingPreference: "morning",
      patientDetail: {
        patientName: "Synthetic Patient",
        patientMobileNumber: "+61 491 570 156",
        patientIdentifiers: ["UR-OVERDUE-1"],
        culturalIdentity: null,
        preferredName: "Sam",
      },
      assurances: PLAN_ASSURANCE_VALUES,
    },
    { actor: coordinator, idempotencyKey: idempotencyKey("overdue-create") },
  );
  if (!created.ok) throw new Error(created.reason);
  const activated = await store.activatePlan(
    { planId: planId("OVERDUE-PLAN-1"), expectedVersion: created.value.plan.version },
    { actor: coordinator, idempotencyKey: idempotencyKey("overdue-activate") },
  );
  if (!activated.ok) throw new Error(activated.reason);
  if (options.pause) {
    const paused = await store.pausePlan(
      { planId: planId("OVERDUE-PLAN-1"), expectedVersion: activated.value.plan.version },
      { actor: coordinator, idempotencyKey: idempotencyKey("overdue-pause") },
    );
    if (!paused.ok) throw new Error(paused.reason);
  }
  return [...(await store.listPlans({ actor: coordinator }))];
}

function firstContact(records: PlanRecord[]) {
  const contacts = records[0].contacts.filter((stored) => stored.contact.state === "scheduled");
  return contacts.reduce((earliest, stored) =>
    stored.planned.sendAt.getTime() < earliest.planned.sendAt.getTime() ? stored : earliest,
  );
}

describe("overdue scheduled contacts need review", () => {
  it("counts a still-scheduled contact whose send time passed beyond the grace period", async () => {
    const records = await activePlanRecords();
    const first = firstContact(records);
    const asAt = new Date(first.planned.sendAt.getTime() + (OVERDUE_REVIEW_GRACE_MINUTES + 1) * 60_000);

    const team = buildTeamWorkload([{ record: records[0], assignment: null }], asAt);
    expect(team.unclaimed.exceptionBacklog.contacts).toBe(1);

    const day = awstCalendarDay(first.planned.sendAt);
    const range = buildScheduleRange(records, day, day, asAt);
    if (!range.ok) throw new Error(range.reason);
    const entry = range.view.days[0].exceptions.entries.find((candidate) => candidate.contactId === first.contact.id);
    expect(entry?.needsReview).toBe(true);
    expect(entry?.isDue).toBe(false);
    expect(range.view.days[0].counts.needsReview).toBe(1);
  });

  it("does not count a contact still inside the grace period", async () => {
    const records = await activePlanRecords();
    const first = firstContact(records);
    const asAt = new Date(first.planned.sendAt.getTime() + (OVERDUE_REVIEW_GRACE_MINUTES - 1) * 60_000);

    expect(
      buildTeamWorkload([{ record: records[0], assignment: null }], asAt).unclaimed.exceptionBacklog.contacts,
    ).toBe(0);
  });

  it("does not count contacts on a paused plan -- they are held, not overdue", async () => {
    const records = await activePlanRecords({ pause: true });
    const first = firstContact(records);
    const asAt = new Date(first.planned.sendAt.getTime() + 30 * 86_400_000);

    expect(
      buildTeamWorkload([{ record: records[0], assignment: null }], asAt).unclaimed.exceptionBacklog.contacts,
    ).toBe(0);
  });

  it("leaves the schedule unchanged when no instant is given", async () => {
    const records = await activePlanRecords();
    const first = firstContact(records);
    const day = awstCalendarDay(first.planned.sendAt);
    const range = buildScheduleRange(records, day, day);
    if (!range.ok) throw new Error(range.reason);
    expect(range.view.days[0].counts.needsReview).toBe(0);
  });
});
