// tests/caring-contacts-model.test.ts
import { describe, expect, it } from "vitest";

import { contactId, planId, teamId } from "@/lib/caring-contacts/ids";
import {
  TERMINAL_PLAN_STATES,
  applyContactTransition,
  applyDraftCancellation,
  applyPlanTransition,
  planSendingHold,
  type Contact,
  type Plan,
  type PlanState,
} from "@/lib/caring-contacts/model";

const basePlan = (state: Plan["state"]): Plan => ({
  id: planId("PLAN-1"),
  teamId: teamId("TEAM-1"),
  state,
  version: 1,
});

const baseContact = (state: Contact["state"]): Contact => ({
  id: contactId("CONTACT-1"),
  planId: planId("PLAN-1"),
  state,
  version: 1,
});

describe("plan lifecycle", () => {
  it("activates a draft", () => {
    const result = applyPlanTransition(basePlan("draft"), { type: "activate" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.state).toBe("active");
  });

  it("refuses to activate an already active plan and names the reason", () => {
    const result = applyPlanTransition(basePlan("active"), { type: "activate" });
    expect(result).toEqual({ ok: false, reason: "plan-not-draft" });
  });

  it("refuses every transition out of a cancelled plan", () => {
    for (const action of [{ type: "activate" }, { type: "pause" }, { type: "resume" }, { type: "withdraw" }] as const) {
      expect(applyPlanTransition(basePlan("cancelled"), action)).toEqual({ ok: false, reason: "plan-terminal" });
    }
  });

  it("treats withdrawn and completed as terminal too", () => {
    expect(applyPlanTransition(basePlan("withdrawn"), { type: "pause" })).toEqual({
      ok: false,
      reason: "plan-terminal",
    });
    expect(applyPlanTransition(basePlan("completed"), { type: "resume" })).toEqual({
      ok: false,
      reason: "plan-terminal",
    });
  });

  it("pauses an active plan and resumes only from paused", () => {
    const paused = applyPlanTransition(basePlan("active"), { type: "pause" });
    expect(paused.ok && paused.value.state).toBe("paused");
    expect(applyPlanTransition(basePlan("active"), { type: "resume" })).toEqual({
      ok: false,
      reason: "plan-not-paused",
    });
  });

  it("allows withdrawal from active and from paused", () => {
    for (const from of ["active", "paused"] as const) {
      const result = applyPlanTransition(basePlan(from), { type: "withdraw" });
      expect(result.ok && result.value.state).toBe("withdrawn");
    }
  });

  it("increments the version on every accepted transition, for optimistic concurrency", () => {
    const result = applyPlanTransition(basePlan("draft"), { type: "activate" });
    expect(result.ok && result.value.version).toBe(2);
  });
});

describe("contact lifecycle", () => {
  it("advances scheduled to processing to sent to delivered", () => {
    const processing = applyContactTransition(baseContact("scheduled"), { type: "startProcessing" });
    expect(processing.ok && processing.value.state).toBe("processing");

    const sent = applyContactTransition(baseContact("processing"), { type: "markSent" });
    expect(sent.ok && sent.value.state).toBe("sent");

    const delivered = applyContactTransition(baseContact("sent"), { type: "providerStatus", status: "delivered" });
    expect(delivered.ok && delivered.value.state).toBe("delivered");
  });

  it("permits sent to notDelivered", () => {
    const result = applyContactTransition(baseContact("sent"), { type: "providerStatus", status: "notDelivered" });
    expect(result.ok && result.value.state).toBe("notDelivered");
  });

  it("treats delivered as terminal and rejects every further action", () => {
    for (const action of [
      { type: "startProcessing" },
      { type: "markSent" },
      { type: "providerStatus", status: "delivered" },
      { type: "cancel" },
    ] as const) {
      expect(applyContactTransition(baseContact("delivered"), action)).toEqual({
        ok: false,
        reason: "contact-terminal",
      });
    }
  });

  it("treats suppressed and cancelled as terminal too", () => {
    expect(applyContactTransition(baseContact("suppressed"), { type: "markSent" })).toEqual({
      ok: false,
      reason: "contact-terminal",
    });
    expect(applyContactTransition(baseContact("cancelled"), { type: "startProcessing" })).toEqual({
      ok: false,
      reason: "contact-terminal",
    });
  });

  it("lets a contact abandoned mid-processing be recorded as missed", () => {
    // A provider timeout leaves the contact in `processing` with nothing sent. Before this it had
    // no exit: the contact was stranded, neither sent nor accounted for.
    const missed = applyContactTransition(baseContact("processing"), { type: "markMissed" });
    expect(missed.ok && missed.value.state).toBe("missed");
    expect(missed.ok && missed.value.version).toBe(2);
  });

  it("records a scheduled contact as missed when its window closes", () => {
    const missed = applyContactTransition(baseContact("scheduled"), { type: "markMissed" });
    expect(missed.ok && missed.value.state).toBe("missed");
  });

  it("refuses to record a sent contact as missed — the message really did leave", () => {
    expect(applyContactTransition(baseContact("sent"), { type: "markMissed" })).toEqual({
      ok: false,
      reason: "contact-not-missable",
    });
  });

  it("rejects an out-of-order provider status", () => {
    const result = applyContactTransition(baseContact("scheduled"), {
      type: "providerStatus",
      status: "delivered",
    });
    expect(result).toEqual({ ok: false, reason: "contact-out-of-order" });
  });

  it("increments the version on every accepted transition", () => {
    const result = applyContactTransition(baseContact("scheduled"), { type: "startProcessing" });
    expect(result.ok && result.value.version).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// planSendingHold — why a plan is not sending, whatever its contacts say (#PAMATF)
//
// Moved here from ./schedule-view, where it was written for one screen while the read that most
// needed it -- `listSendableContacts` -- could not reach it without importing a view module. Its
// doc there called it "THE GATE listSendableContacts DOES NOT HAVE"; both now consult this.
// ---------------------------------------------------------------------------

describe("planSendingHold", () => {
  it("holds a plan nobody has started, and says which hold it is", () => {
    // The state #PAMATF is about. Contacts are written `scheduled` when the plan is CREATED, so a
    // draft plan's contacts look exactly like an active plan's and only the plan can tell them
    // apart.
    expect(planSendingHold("draft")).toBe("planNotStarted");
  });

  it("lets an active plan send, so it is a gate rather than a blanket refusal", () => {
    expect(planSendingHold("active")).toBeNull();
  });

  it("keeps paused apart from not-started and from ended", () => {
    // Three different facts, and a caller has to be able to say which: a plan a coordinator paused
    // is not a plan nobody started, and neither is a plan that has finished.
    expect(planSendingHold("paused")).toBe("planPaused");
    expect(new Set(["planNotStarted", "planPaused", "planEnded"]).size).toBe(3);
  });

  it("holds every state the model already calls terminal, with no second list to keep in step", () => {
    // Derived from TERMINAL_PLAN_STATES rather than typed out, so a fourth terminal state added
    // there cannot be classified as sending here without this failing. The module additionally
    // throws at load if the two disagree, so a build that got it wrong never starts.
    expect(TERMINAL_PLAN_STATES.length).toBeGreaterThan(0);
    for (const state of TERMINAL_PLAN_STATES) {
      expect(planSendingHold(state)).toBe("planEnded");
    }
  });

  it("classifies every PlanState, so a new one cannot default into sending", () => {
    // The exhaustive switch is a compile-time guarantee; this is the runtime half. Any state whose
    // hold is `undefined` fell through, which the type system would already have refused.
    const every: readonly PlanState[] = ["draft", "active", "paused", "withdrawn", "cancelled", "completed"];
    for (const state of every) {
      expect(planSendingHold(state)).not.toBeUndefined();
    }
    expect(every.filter((state) => planSendingHold(state) === null)).toEqual(["active"]);
  });
});

// Owner-approved (2026-09-26): only a plan that was created and never started may be cancelled by a
// coordinator. A started plan ends by withdrawal (or a recorded death), never by this.
describe("applyDraftCancellation", () => {
  it("cancels a draft and advances its version", () => {
    expect(applyDraftCancellation(basePlan("draft"))).toEqual({
      ok: true,
      value: { ...basePlan("draft"), state: "cancelled", version: 2 },
    });
  });

  it.each(["active", "paused"] as const)("refuses a %s plan by name", (state) => {
    expect(applyDraftCancellation(basePlan(state))).toEqual({ ok: false, reason: "plan-not-draft" });
  });

  it.each(["withdrawn", "cancelled", "completed"] as const)("refuses an ended (%s) plan as terminal", (state) => {
    expect(applyDraftCancellation(basePlan(state))).toEqual({ ok: false, reason: "plan-terminal" });
  });
});
