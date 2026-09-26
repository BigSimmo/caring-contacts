import { describe, expect, it } from "vitest";

import { PLAN_ASSURANCE_VALUES } from "@/lib/caring-contacts/assurances";
import { demoActorForRole } from "@/lib/caring-contacts-server/session";
import { systemClock } from "@/lib/caring-contacts/clock";
import { createInMemoryRepository } from "@/lib/caring-contacts/in-memory-repository";
import { idempotencyKey, pathwayVersionId, patientId, planId, referralId } from "@/lib/caring-contacts/ids";
import type { PathwayVersion } from "@/lib/caring-contacts/pathway-versions";
import type { ReferralIntakePayload } from "@/lib/caring-contacts/repository";

import { movableClock } from "./helpers/caring-contacts-movable-clock";

const payload: ReferralIntakePayload = {
  patientIdentifier: "RPH-582914",
  givenName: "Mira",
  familyName: "Chen",
  mobileNumber: "+61491570006",
  dischargeDate: "2026-09-12T02:34:00.000Z",
  hospitalFacility: "Royal Perth Hospital",
  cohort: "adult_crisis",
  admittingWard: "Ward 4A",
  clinicalSummary: "Post-discharge aftercare required.",
  safetyAlerts: ["Acute distress", "Aftercare support required"],
};

describe("referral intake payload persistence", () => {
  it("stores the H-44 clinical payload with createReferral and round-trips it", async () => {
    const store = createInMemoryRepository(systemClock());
    const actor = demoActorForRole("coordinator");
    const nextReferralId = referralId("referral-intake-roundtrip");
    const nextPatientId = patientId("patient-intake-roundtrip");

    const created = await store.createReferral(
      { referralId: nextReferralId, patientId: nextPatientId, intakePayload: payload },
      { actor, idempotencyKey: idempotencyKey("intake-payload-create") },
    );
    expect(created.ok).toBe(true);

    const stored = await store.getReferralIntakePayload(nextReferralId, { actor });
    expect(stored).toEqual(payload);
  });

  it("returns null when createReferral omitted the clinical payload", async () => {
    const store = createInMemoryRepository(systemClock());
    const actor = demoActorForRole("coordinator");
    const nextReferralId = referralId("referral-intake-empty");
    const nextPatientId = patientId("patient-intake-empty");

    const created = await store.createReferral(
      { referralId: nextReferralId, patientId: nextPatientId },
      { actor, idempotencyKey: idempotencyKey("intake-payload-empty") },
    );
    expect(created.ok).toBe(true);
    await expect(store.getReferralIntakePayload(nextReferralId, { actor })).resolves.toBeNull();
  });

  it("clears the intake payload when markRetentionCleared runs for the linked plan", async () => {
    // Movable: a clearance is admitted only seven years after the plan ended (owner decision).
    const clock = movableClock(new Date().toISOString());
    const store = createInMemoryRepository(clock);
    const actor = demoActorForRole("coordinator");
    const nextReferralId = referralId("referral-intake-retention");
    const nextPatientId = patientId("patient-intake-retention");
    const nextPlanId = planId("plan-intake-retention");
    const nextPathwayId = pathwayVersionId("pathway-intake-retention");

    const createdReferral = await store.createReferral(
      { referralId: nextReferralId, patientId: nextPatientId, intakePayload: payload },
      { actor, idempotencyKey: idempotencyKey("intake-retention-referral") },
    );
    expect(createdReferral.ok).toBe(true);

    const pathway: PathwayVersion = {
      id: nextPathwayId,
      teamId: actor.teamId,
      state: "draft",
      authorId: actor.id,
      approvals: [],
      publishedAt: null,
      retiredAt: null,
      retirementUrgency: null,
      snapshot: {
        cadenceLabels: ["Day 3"],
        messageTextByType: { standard: "Checking in.", first: "Welcome.", closing: "This is our last message." },
      },
    };
    const savedPathway = await store.savePathwayVersion(
      { version: pathway },
      { actor, idempotencyKey: idempotencyKey("intake-retention-pathway") },
    );
    expect(savedPathway.ok).toBe(true);

    const createdPlan = await store.createPlan(
      {
        planId: nextPlanId,
        referralId: nextReferralId,
        patientId: nextPatientId,
        pathwayVersionId: nextPathwayId,
        dischargeAt: new Date("2026-09-12T02:00:00.000Z"),
        sendingPreference: "morning",
        patientDetail: {
          patientName: "Mira Chen",
          preferredName: "Mira",
          patientMobileNumber: "+61491570006",
          patientIdentifiers: ["RPH-582914"],
          culturalIdentity: null,
        },
        assurances: [...PLAN_ASSURANCE_VALUES],
      },
      { actor, idempotencyKey: idempotencyKey("intake-retention-create-plan") },
    );
    expect(createdPlan.ok).toBe(true);
    if (!createdPlan.ok) return;

    const activated = await store.activatePlan(
      { planId: nextPlanId, expectedVersion: createdPlan.value.plan.version },
      { actor, idempotencyKey: idempotencyKey("intake-retention-activate") },
    );
    expect(activated.ok).toBe(true);
    if (!activated.ok) return;

    const withdrawn = await store.withdrawPlan(
      { planId: nextPlanId, expectedVersion: activated.value.plan.version, origin: "patient" },
      { actor, idempotencyKey: idempotencyKey("intake-retention-withdraw") },
    );
    expect(withdrawn.ok).toBe(true);

    await expect(store.getReferralIntakePayload(nextReferralId, { actor })).resolves.toEqual(payload);

    clock.advanceYears(7);
    const cleared = await store.markRetentionCleared(
      { planId: nextPlanId },
      { actor, idempotencyKey: idempotencyKey("intake-retention-clear") },
    );
    expect(cleared).toEqual({ ok: true, value: undefined });
    await expect(store.getReferralIntakePayload(nextReferralId, { actor })).resolves.toBeNull();
  });
});
