// tests/caring-contacts-plans.test.ts
import { describe, expect, it } from "vitest";

import { PLAN_ASSURANCE_VALUES } from "@/lib/caring-contacts/assurances";
import { fixedClock } from "@/lib/caring-contacts/clock";
import { ValidationError } from "@/lib/caring-contacts/episode";
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
import { createPlan, createPlanStore } from "@/lib/caring-contacts/plan-store";
import type { CreatePlanInput, WriteContext } from "@/lib/caring-contacts/repository";

import { movableClock } from "./helpers/caring-contacts-movable-clock";

describe("caring-contacts plans: patient name validation and retention clearance sentinel (#V6CDEV)", () => {
  const clock = fixedClock("2026-03-02T10:00:00.000Z");
  const context: WriteContext = {
    actor: {
      id: actorId("COORDINATOR-1"),
      teamId: teamId("TEAM-1"),
      roles: ["coordinator"],
    },
    idempotencyKey: idempotencyKey("idemp-plans-test-1"),
  };

  const validAssurances = [...PLAN_ASSURANCE_VALUES];

  describe("createPlan rejects blank and whitespace-only patient names", () => {
    const adversarialNames = ["", "   ", "\t\n", " \t \r\n "];

    for (const blankName of adversarialNames) {
      it(`rejects createPlan with patientName: ${JSON.stringify(blankName)}`, async () => {
        await expect(createPlan({ patientName: blankName, assurances: validAssurances }, context)).rejects.toThrow(
          ValidationError,
        );

        await expect(createPlan({ patientName: blankName, assurances: validAssurances }, context)).rejects.toThrow(
          /Patient name cannot be blank or whitespace/,
        );
      });

      it(`rejects in-memory repository directly with patientName: ${JSON.stringify(blankName)}`, async () => {
        const repo = createInMemoryRepository(clock);
        const input: CreatePlanInput = {
          planId: planId(`PLAN-TEST-${Math.random().toString(36).slice(2, 7)}`),
          referralId: referralId("REF-1"),
          patientId: patientId(`PAT-${Math.random().toString(36).slice(2, 7)}`),
          pathwayVersionId: pathwayVersionId("PV-1"),
          dischargeAt: new Date("2026-03-02T10:00:00.000Z"),
          sendingPreference: "morning",
          patientDetail: {
            patientName: blankName,
            patientMobileNumber: "+61 491 570 156",
            patientIdentifiers: ["UR-001"],
            culturalIdentity: null,
            preferredName: "Test",
          },
          assurances: validAssurances,
        };

        await expect(repo.createPlan(input, context)).rejects.toThrow(ValidationError);
        await expect(repo.createPlan(input, context)).rejects.toThrow(/Patient name cannot be blank or whitespace/);
      });
    }
  });

  describe("retention clearance sentinel '' is valid ONLY via explicit policy clearance", () => {
    it("preserves valid patientName on creation and does not render as cleared", async () => {
      const repo = createInMemoryRepository(clock);
      const store = createPlanStore(repo, clock);

      const pId = planId("PLAN-RETENTION-1");
      const result = await store.createPlan(
        {
          planId: pId,
          patientName: "Jane Doe",
          assurances: validAssurances,
        },
        context,
      );

      expect(result.ok).toBe(true);
      const episode = await repo.getEpisode(pId, context);
      expect(episode).not.toBeNull();
      expect(episode?.patientName).toBe("Jane Doe");
      expect(episode?.patientDetailClearedAt).toBeNull();
    });

    it("clears patientName to empty string ONLY when markRetentionCleared is executed", async () => {
      // Movable: a clearance is admitted only seven years after the plan ended (owner decision).
      const later = movableClock("2026-03-02T10:00:00.000Z");
      const repo = createInMemoryRepository(later);
      const store = createPlanStore(repo, later);

      const pId = planId("PLAN-RETENTION-2");
      const created = await store.createPlan(
        {
          planId: pId,
          patientName: "John Smith",
          assurances: validAssurances,
        },
        context,
      );
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Transition plan to active then withdrawn so retention clearance can be admitted
      const activated = await repo.activatePlan(
        { planId: pId, expectedVersion: created.value.plan.version },
        { ...context, idempotencyKey: idempotencyKey("idemp-plans-act-1") },
      );
      expect(activated.ok).toBe(true);
      if (!activated.ok) return;

      const withdrawn = await repo.withdrawPlan(
        { planId: pId, expectedVersion: activated.value.plan.version, origin: "patient" },
        { ...context, idempotencyKey: idempotencyKey("idemp-plans-with-1") },
      );
      expect(withdrawn.ok).toBe(true);

      // Now execute administrative policy clearance, once the retention period has passed
      later.advanceYears(7);
      const cleared = await repo.markRetentionCleared(
        { planId: pId },
        { ...context, idempotencyKey: idempotencyKey("idemp-plans-clear-1") },
      );
      expect(cleared.ok).toBe(true);

      const episodeAfterClearance = await repo.getEpisode(pId, context);
      expect(episodeAfterClearance).not.toBeNull();
      // Empty string is now legitimately the retention-cleared sentinel
      expect(episodeAfterClearance?.patientName).toBe("");
      expect(episodeAfterClearance?.patientDetailClearedAt).not.toBeNull();
    });
  });
});
