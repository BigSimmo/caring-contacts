import { describe, expect, it } from "vitest";

import { createInitialPrototypeState, prototypeReducer } from "@/components/caring-contacts/mockups/prototype-state";
import { CARING_CONTACT_MOCKUP_ROUTES, caringContactMockupRoute } from "@/components/caring-contacts/mockups/routes";
import {
  syntheticPathways,
  syntheticPatients,
  syntheticPlannedContacts,
} from "@/components/caring-contacts/mockups/fixtures";

describe("Caring Contact linked prototype state", () => {
  it("emits only the approved synthetic mockup routes", () => {
    expect(CARING_CONTACT_MOCKUP_ROUTES).toEqual({
      today: "/mockups/caring-contacts",
      patients: "/mockups/caring-contacts/patients",
      patient: "/mockups/caring-contacts/patients/SYN-PATIENT-001",
      newPlan: "/mockups/caring-contacts/plans/new",
      plan: "/mockups/caring-contacts/plans/SYN-PLAN-001",
      schedule: "/mockups/caring-contacts/schedule",
      contact: "/mockups/caring-contacts/contacts/SYN-CONTACT-004",
      templates: "/mockups/caring-contacts/templates",
      template: "/mockups/caring-contacts/templates/SYN-PATHWAY-001",
      team: "/mockups/caring-contacts/team",
      guidance: "/mockups/caring-contacts/guidance",
      reports: "/mockups/caring-contacts/reports",
      systemStates: "/mockups/caring-contacts/system-states",
    });

    expect(caringContactMockupRoute.newPlan("review")).toBe("/mockups/caring-contacts/plans/new?stage=review");
    expect(caringContactMockupRoute.schedule("2026-08-15")).toBe("/mockups/caring-contacts/schedule?date=2026-08-15");
    expect(caringContactMockupRoute.overlay("final-activation", CARING_CONTACT_MOCKUP_ROUTES.newPlan)).toBe(
      "/mockups/caring-contacts/plans/new?overlay=final-activation",
    );
    expect(Object.values(CARING_CONTACT_MOCKUP_ROUTES).every((route) => route.startsWith("/mockups/"))).toBe(true);
  });

  it("keeps route identities aligned with the rendered synthetic fixtures", () => {
    expect(syntheticPatients.find(({ fullName }) => fullName === "Rowan Sample")?.id).toBe("SYN-PATIENT-001");
    expect(syntheticPathways[0]?.id).toBe("SYN-PATHWAY-001");
    expect(syntheticPlannedContacts.find(({ sequence }) => sequence === 4)?.id).toBe("SYN-CONTACT-004");
  });

  it("applies deterministic in-memory mutations and resets to the fixture", () => {
    const initial = createInitialPrototypeState();
    expect(initial.plan.status).toBe("Active");
    const activated = prototypeReducer(initial, { type: "activate-plan" });
    const paused = prototypeReducer(activated, { type: "pause-plan" });
    const reassigned = prototypeReducer(paused, {
      type: "reassign-plan",
      coordinatorId: "SYN-TEAM-002",
    });

    expect(activated.plan.status).toBe("Active");
    expect(activated.audit.at(-1)?.event).toBe("Plan activated in synthetic prototype");
    expect(paused.plan.status).toBe("Paused");
    expect(reassigned.plan.coordinatorId).toBe("SYN-TEAM-002");
    expect(prototypeReducer(reassigned, { type: "reset" })).toEqual(initial);
  });

  it("fails closed when connectivity, permission, authentication, or version state changes before commit", () => {
    const guardedStates = [
      prototypeReducer(createInitialPrototypeState(), { type: "set-connectivity", online: false }),
      prototypeReducer(createInitialPrototypeState(), { type: "set-permission", available: false }),
      prototypeReducer(createInitialPrototypeState(), { type: "set-authentication", authenticated: false }),
      prototypeReducer(createInitialPrototypeState(), { type: "set-version-conflict", active: true }),
    ];

    for (const state of guardedStates) {
      const attempted = prototypeReducer(state, { type: "activate-plan" });
      expect(attempted.plan.status).toBe(state.plan.status);
      expect(attempted.lastOutcome?.kind).toBe("blocked");
      expect(attempted.lastOutcome?.message).toMatch(/No synthetic plan change was made/i);
    }

    const offline = guardedStates[0]!;
    const teamAttempt = prototypeReducer(offline, { type: "set-team", teamId: "SYN-TEAM-CENTRAL" });
    expect(teamAttempt.activeTeamId).toBe("SYN-TEAM-NORTH");
    expect(teamAttempt.lastOutcome?.kind).toBe("blocked");
  });

  it("keeps scenario state explicit without persisting patient data", () => {
    const initial = createInitialPrototypeState("offline");
    expect(initial.scenario).toBe("offline");
    expect(initial.connectivity.online).toBe(false);
    expect(initial.patient.id).toBe("SYN-PATIENT-001");
    expect(initial.persistence).toBe("memory-only");

    const recovered = prototypeReducer(initial, { type: "apply-scenario", scenario: "normal" });
    expect(recovered.scenario).toBe("normal");
    expect(recovered.connectivity.online).toBe(true);
  });
});
