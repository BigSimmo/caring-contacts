// tests/caring-contacts-wizard.test.ts
//
// The plan wizard's stage transition matrix and helpers (#QX7TP2).
import { describe, expect, it } from "vitest";

import {
  PLAN_WIZARD_STAGES,
  PLAN_WIZARD_STAGE_DEFINITIONS,
  isPlanWizardStage,
  nextPlanWizardStage,
  planWizardStageImplementation,
  previousPlanWizardStage,
} from "@/components/caring-contacts/workspace/plan-wizard/stages";

describe("caring contacts plan wizard stages", () => {
  describe("PLAN_WIZARD_STAGES", () => {
    it("defines the four wizard stages in strict sequential progression order", () => {
      expect(PLAN_WIZARD_STAGES).toEqual(["agreement", "pathway", "personalisation", "review"]);
      expect(PLAN_WIZARD_STAGES).toHaveLength(4);
    });
  });

  describe("PLAN_WIZARD_STAGE_DEFINITIONS", () => {
    it("provides valid destination labels and purpose descriptions for each stage", () => {
      for (const stage of PLAN_WIZARD_STAGES) {
        const def = PLAN_WIZARD_STAGE_DEFINITIONS[stage];
        expect(def, `missing definition for stage: ${stage}`).toBeDefined();
        expect(def.label.trim().length, `empty label for stage: ${stage}`).toBeGreaterThan(0);
        expect(def.purpose.trim().length, `empty purpose for stage: ${stage}`).toBeGreaterThan(0);
      }
    });

    it("pins the exact destination labels matching workspace navigation conventions", () => {
      expect(PLAN_WIZARD_STAGE_DEFINITIONS.agreement.label).toBe("Agreement");
      expect(PLAN_WIZARD_STAGE_DEFINITIONS.pathway.label).toBe("Pathway");
      expect(PLAN_WIZARD_STAGE_DEFINITIONS.personalisation.label).toBe("Personalisation");
      expect(PLAN_WIZARD_STAGE_DEFINITIONS.review.label).toBe("Review and activation");
    });
  });

  describe("planWizardStageImplementation", () => {
    it("reports all current stages as built", () => {
      for (const stage of PLAN_WIZARD_STAGES) {
        const impl = planWizardStageImplementation(stage);
        expect(impl).toEqual({ kind: "built" });
      }
    });
  });

  describe("isPlanWizardStage", () => {
    it("recognises all valid PlanWizardStage strings", () => {
      for (const stage of PLAN_WIZARD_STAGES) {
        expect(isPlanWizardStage(stage)).toBe(true);
      }
    });

    it("rejects unknown strings and non-string inputs", () => {
      expect(isPlanWizardStage("unknown")).toBe(false);
      expect(isPlanWizardStage("")).toBe(false);
      expect(isPlanWizardStage("AGREEMENT")).toBe(false);
      expect(isPlanWizardStage("complete")).toBe(false);
      expect(isPlanWizardStage(null)).toBe(false);
      expect(isPlanWizardStage(undefined)).toBe(false);
      expect(isPlanWizardStage(123)).toBe(false);
      expect(isPlanWizardStage({})).toBe(false);
      expect(isPlanWizardStage(["agreement"])).toBe(false);
    });
  });

  describe("nextPlanWizardStage", () => {
    it("transitions sequentially from earliest to latest stage", () => {
      expect(nextPlanWizardStage("agreement")).toBe("pathway");
      expect(nextPlanWizardStage("pathway")).toBe("personalisation");
      expect(nextPlanWizardStage("personalisation")).toBe("review");
    });

    it("returns null at the final review stage", () => {
      expect(nextPlanWizardStage("review")).toBeNull();
    });
  });

  describe("previousPlanWizardStage", () => {
    it("returns null at the first stage (agreement)", () => {
      expect(previousPlanWizardStage("agreement")).toBeNull();
    });

    it("transitions backwards sequentially", () => {
      expect(previousPlanWizardStage("pathway")).toBe("agreement");
      expect(previousPlanWizardStage("personalisation")).toBe("pathway");
      expect(previousPlanWizardStage("review")).toBe("personalisation");
    });
  });
});
