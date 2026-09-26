// tests/caring-contacts-plan-store.test.ts

import { describe, expect, it } from "vitest";

import { PLAN_ASSURANCE_VALUES } from "@/lib/caring-contacts/assurances";
import { fixedClock } from "@/lib/caring-contacts/clock";
import {
  actorId,
  idempotencyKey,
  pathwayVersionId,
  patientId,
  planId,
  referralId,
  teamId,
} from "@/lib/caring-contacts/ids";
import { createInMemoryRepository } from "@/lib/caring-contacts/in-memory-repository";
import {
  adaptPlanStore,
  createPlan,
  createPlanStore,
  type PlanCreationInput,
  validatePatientName,
} from "@/lib/caring-contacts/plan-store";
import type { CreatePlanInput, WriteContext } from "@/lib/caring-contacts/repository";

describe("caring-contacts plan-store", () => {
  const clock = fixedClock("2026-03-02T10:00:00.000Z");
  const context = {
    actor: {
      id: actorId("COORDINATOR-1"),
      teamId: teamId("TEAM-1"),
      roles: ["coordinator"],
    },
    idempotencyKey: idempotencyKey("idemp-test-1"),
  } satisfies WriteContext;

  describe("validatePatientName", () => {
    it("accepts valid non-blank names and returns trimmed string", () => {
      expect(validatePatientName("Jane Doe")).toBe("Jane Doe");
      expect(validatePatientName("  John Smith  ")).toBe("John Smith");
    });

    it("throws validation error on blank names", () => {
      expect(() => validatePatientName("   ")).toThrow("Validation error: patient name must not be blank");
      expect(() => validatePatientName("")).toThrow("Validation error: patient name must not be blank");
      expect(() => validatePatientName(null)).toThrow("Validation error: patient name must not be blank");
      expect(() => validatePatientName(undefined)).toThrow("Validation error: patient name must not be blank");
    });
  });

  describe("createPlan negative test for blank patient name", () => {
    it("rejects createPlan({ patientName: '   ' })", async () => {
      await expect(createPlan({ patientName: "   " }, context)).rejects.toThrow(
        "Validation error: patient name must not be blank",
      );
    });

    it("rejects createPlan({ patientName: '' })", async () => {
      await expect(createPlan({ patientName: "" }, context)).rejects.toThrow(
        "Validation error: patient name must not be blank",
      );
    });

    it("rejects createPlan with blank name inside patientDetail", async () => {
      await expect(
        createPlan(
          {
            patientDetail: { patientName: "   " },
          } as unknown as PlanCreationInput,
          context,
        ),
      ).rejects.toThrow("Validation error: patient name must not be blank");
    });

    it("rejects blank patient name on adapted store instance", async () => {
      const store = createPlanStore();
      await expect(store.createPlan({ patientName: "   " }, context)).rejects.toThrow(
        "Validation error: patient name must not be blank",
      );
    });

    it("rejects blank patient name on underlying in-memory repository", async () => {
      const repo = createInMemoryRepository(clock);
      const invalidInput: CreatePlanInput = {
        planId: planId("PLAN-FAIL"),
        referralId: referralId("REF-FAIL"),
        patientId: patientId("PAT-FAIL"),
        pathwayVersionId: pathwayVersionId("PV-FAIL"),
        dischargeAt: new Date(),
        sendingPreference: "morning",
        patientDetail: {
          patientName: "   ",
          patientMobileNumber: "+61 491 570 156",
          patientIdentifiers: ["UR-001"],
          culturalIdentity: null,
          preferredName: "Fail",
        },
        assurances: [...PLAN_ASSURANCE_VALUES],
      };

      await expect(repo.createPlan(invalidInput, context)).rejects.toThrow(
        "Validation error: patient name must not be blank",
      );
    });
  });

  describe("createPlan trust boundaries", () => {
    it("requires caller-supplied assurances", async () => {
      const store = createPlanStore();
      await expect(store.createPlan({ patientName: "Alex Taylor" }, context)).rejects.toThrow(
        "explicit plan assurances are required",
      );
    });

    it("does not invent an actor when write context is missing", async () => {
      const store = createPlanStore();
      await expect(
        store.createPlan(
          { patientName: "Alex Taylor", assurances: [...PLAN_ASSURANCE_VALUES] },
          undefined as unknown as WriteContext,
        ),
      ).rejects.toThrow("authenticated write context is required");
      expect(await store.listPlans(context)).toEqual([]);
    });
  });

  describe("createPlan with valid inputs", () => {
    it("creates a plan with simplified input { patientName: 'Jane Doe' }", async () => {
      const repo = createInMemoryRepository(clock);
      const store = adaptPlanStore(repo);

      const result = await store.createPlan(
        { patientName: "Jane Doe", assurances: [...PLAN_ASSURANCE_VALUES] },
        context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toHaveProperty("patientDetail");
        expect(result.value.plan.state).toBe("draft");
      }
    });

    it("creates a plan with top-level createPlan function", async () => {
      const result = await createPlan({ patientName: "Alex Taylor", assurances: [...PLAN_ASSURANCE_VALUES] }, context);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toHaveProperty("patientDetail");
      }
    });

    it("creates a plan with full CreatePlanInput", async () => {
      const repo = createInMemoryRepository(clock);
      const store = adaptPlanStore(repo);

      const fullInput: CreatePlanInput = {
        planId: planId("PLAN-VALID-FULL"),
        referralId: referralId("REF-VALID-FULL"),
        patientId: patientId("PAT-VALID-FULL"),
        pathwayVersionId: pathwayVersionId("PV-VALID-FULL"),
        dischargeAt: new Date("2026-03-02T12:00:00.000Z"),
        sendingPreference: "afternoon",
        patientDetail: {
          patientName: "Jordan Nguyen",
          patientMobileNumber: "+61 491 570 156",
          patientIdentifiers: ["UR-00219384"],
          culturalIdentity: null,
          preferredName: "Jordy",
        },
        assurances: [...PLAN_ASSURANCE_VALUES],
      };

      const result = await store.createPlan(fullInput, context);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toHaveProperty("patientDetail");
        expect(result.value.plan.id).toBe("PLAN-VALID-FULL");
      }
    });
  });
});
