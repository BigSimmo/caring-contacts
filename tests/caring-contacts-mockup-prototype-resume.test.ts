import { describe, expect, it } from "vitest";

import { createInitialPrototypeState, prototypeReducer } from "@/components/caring-contacts/mockups/prototype-state";

// L65: of the 13 CaringContactPrototypeAction types, `resume-plan` was referenced by no unit,
// DOM, or Playwright test — the reducer case exists and is dispatched from a real control
// (routable-suite.tsx's pause/resume toggle), but nothing proved it. This is the reducer-level
// coverage; the mockup is the frozen reference renderer Phase 2B builds production screens from,
// so an unproven state transition could otherwise be copied unverified.
describe("Caring Contact prototype reducer: resume-plan", () => {
  it("pauses then resumes a plan, returning to Active with a new audit row", () => {
    const initial = createInitialPrototypeState();
    expect(initial.plan.status).toBe("Active");

    const paused = prototypeReducer(initial, { type: "pause-plan" });
    expect(paused.plan.status).toBe("Paused");
    expect(paused.audit.at(-1)?.event).toBe("Plan paused in synthetic prototype");
    expect(paused.lastOutcome?.kind).toBe("success");

    const resumed = prototypeReducer(paused, { type: "resume-plan" });
    expect(resumed.plan.status).toBe("Active");
    expect(resumed.audit).toHaveLength(paused.audit.length + 1);
    expect(resumed.audit.at(-1)?.event).toBe("Plan resumed in synthetic prototype");
    expect(resumed.lastOutcome?.kind).toBe("success");
    expect(resumed.lastOutcome?.message).toMatch(/Plan resumed in synthetic prototype/);
  });

  it("fails closed: resume-plan is blocked the same way every other plan mutation is blocked", () => {
    const offline = prototypeReducer(createInitialPrototypeState(), {
      type: "set-connectivity",
      online: false,
    });
    const paused = { ...offline, plan: { ...offline.plan, status: "Paused" as const } };

    const attempted = prototypeReducer(paused, { type: "resume-plan" });
    expect(attempted.plan.status).toBe("Paused");
    expect(attempted.lastOutcome?.kind).toBe("blocked");
    expect(attempted.lastOutcome?.message).toMatch(/No synthetic plan change was made/i);
  });
});
