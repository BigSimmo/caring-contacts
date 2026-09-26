import { describe, expect, it } from "vitest";

import { fixedClock } from "@/lib/caring-contacts/clock";
import { actorId, teamId } from "@/lib/caring-contacts/ids";
import {
  REQUIRED_RESTART_APPROVAL_ROLES,
  applyServiceRestartApproval,
  applyServiceStop,
  describeServiceStop,
  NO_RESTART_APPROVAL_SEATS,
  runningService,
  serviceStopBlocksDispatch,
  type RestartApprovalSeatRoster,
  type ServiceState,
  type ServiceStopReason,
} from "@/lib/caring-contacts/service-state";

const clock = fixedClock("2026-08-19T02:00:00.000Z");
const team = teamId("TEAM-A");

/**
 * Who governance configuration names for each restart-approval seat (owner decision 2026-09-26).
 * SOLO is deliberately named for two seats, so the different-people rule is still what refuses a
 * single person supplying two approvals.
 */
const SEATS: RestartApprovalSeatRoster = {
  incidentLead: [actorId("ACTOR-INCIDENT"), actorId("SOLO"), actorId("ONE"), actorId("TWO"), actorId("X")],
  privacySecurityOwner: [actorId("ACTOR-PRIVACY"), actorId("SOLO")],
  clinicalProgrammeLead: [actorId("ACTOR-CLINICAL")],
};

function stoppedService(): ServiceState {
  const result = applyServiceStop(
    runningService(team),
    {
      reason: "wrong-recipient",
      actorId: actorId("ACTOR-STOP"),
      note: "Message SYN-CONTACT-004 reached the wrong number.",
    },
    clock,
  );
  if (!result.ok) throw new Error(`expected the stop to be accepted, got ${result.reason}`);
  return result.value;
}

describe("service safety stop", () => {
  it("stops the whole service and blocks dispatch", () => {
    const state = stoppedService();
    expect(state.stopped).toBe(true);
    expect(serviceStopBlocksDispatch(state)).toBe(true);
    expect(serviceStopBlocksDispatch(runningService(team))).toBe(false);
  });

  it("refuses a stop with no note", () => {
    expect(
      applyServiceStop(runningService(team), { reason: "duplicate-send", actorId: actorId("A"), note: "   " }, clock),
    ).toEqual({ ok: false, reason: "service-stop-note-required" });
  });

  it("never overwrites the first recorded stop", () => {
    expect(
      applyServiceStop(
        stoppedService(),
        { reason: "audit-integrity-loss", actorId: actorId("B"), note: "second" },
        clock,
      ),
    ).toEqual({ ok: false, reason: "service-already-stopped" });
  });

  it("requires all three approval roles before it restarts", () => {
    let state = stoppedService();
    const actors = ["ACTOR-INCIDENT", "ACTOR-PRIVACY", "ACTOR-CLINICAL"];

    REQUIRED_RESTART_APPROVAL_ROLES.forEach((role, index) => {
      const result = applyServiceRestartApproval(state, { role, actorId: actorId(actors[index]) }, clock, SEATS);
      if (!result.ok) throw new Error(`approval ${role} refused: ${result.reason}`);
      state = result.value;
      const isLast = index === REQUIRED_RESTART_APPROVAL_ROLES.length - 1;
      expect(state.stopped).toBe(!isLast);
    });
  });

  it("refuses a single person supplying more than one approval", () => {
    const first = applyServiceRestartApproval(
      stoppedService(),
      { role: "incidentLead", actorId: actorId("SOLO") },
      clock,
      SEATS,
    );
    if (!first.ok) throw new Error(first.reason);
    expect(
      applyServiceRestartApproval(
        first.value,
        { role: "privacySecurityOwner", actorId: actorId("SOLO") },
        clock,
        SEATS,
      ),
    ).toEqual({ ok: false, reason: "restart-approval-actor-already-recorded" });
  });

  it("refuses the same role approving twice", () => {
    const first = applyServiceRestartApproval(
      stoppedService(),
      { role: "incidentLead", actorId: actorId("ONE") },
      clock,
      SEATS,
    );
    if (!first.ok) throw new Error(first.reason);
    expect(
      applyServiceRestartApproval(first.value, { role: "incidentLead", actorId: actorId("TWO") }, clock, SEATS),
    ).toEqual({
      ok: false,
      reason: "restart-approval-role-already-recorded",
    });
  });

  // Owner decision (2026-09-26): each seat must be held by a named staff member listed for THAT
  // seat in governance configuration, and all approvers must be different people.
  describe("approval seats are held only by the people named for them", () => {
    it("refuses a person governance configuration does not name for any seat", () => {
      expect(
        applyServiceRestartApproval(
          stoppedService(),
          { role: "incidentLead", actorId: actorId("NOBODY") },
          clock,
          SEATS,
        ),
      ).toEqual({ ok: false, reason: "restart-approval-seat-not-held" });
    });

    it("refuses a person named for a different seat", () => {
      expect(
        applyServiceRestartApproval(
          stoppedService(),
          { role: "clinicalProgrammeLead", actorId: actorId("ACTOR-PRIVACY") },
          clock,
          SEATS,
        ),
      ).toEqual({ ok: false, reason: "restart-approval-seat-not-held" });
    });

    it("refuses everyone when no seat holders are configured at all", () => {
      expect(
        applyServiceRestartApproval(
          stoppedService(),
          { role: "incidentLead", actorId: actorId("ACTOR-INCIDENT") },
          clock,
          NO_RESTART_APPROVAL_SEATS,
        ),
      ).toEqual({ ok: false, reason: "restart-approval-seat-not-held" });
    });

    it("records nothing for a refused seat, so the service stays stopped with no approvals", () => {
      const state = stoppedService();
      const refused = applyServiceRestartApproval(
        state,
        { role: "incidentLead", actorId: actorId("NOBODY") },
        clock,
        SEATS,
      );
      expect(refused.ok).toBe(false);
      expect(state.stopped && state.restartApprovals).toEqual([]);
    });
  });

  it("refuses an approval while the service is running", () => {
    expect(
      applyServiceRestartApproval(runningService(team), { role: "incidentLead", actorId: actorId("X") }, clock, SEATS),
    ).toEqual({ ok: false, reason: "service-not-stopped" });
  });

  it("describes the stop in plain words with the approval count, and never mentions a patient", () => {
    const description = describeServiceStop(stoppedService());
    expect(description).toContain("0 of 3");
    expect(description).not.toMatch(/Rowan|Mira|\+61/);
    expect(describeServiceStop(runningService(team))).toBeNull();
  });

  it("never leaks the incident note into the banner, even when the note names a patient", () => {
    const stop = applyServiceStop(
      runningService(team),
      {
        reason: "wrong-recipient",
        actorId: actorId("ACTOR-STOP"),
        note: "Rowan Whitlock's first message went to +61 491 570 156 instead of the number on file.",
      },
      clock,
    );
    if (!stop.ok) throw new Error(`expected the stop to be accepted, got ${stop.reason}`);

    const description = describeServiceStop(stop.value) ?? "";
    expect(description).not.toContain("Rowan");
    expect(description).not.toContain("Whitlock");
    expect(description).not.toContain("+61 491 570 156");
    expect(description).not.toContain("491 570 156");
    // Still a useful banner: the categorised reason and the approval count survive the exclusion.
    expect(description).toContain("wrong recipient");
    expect(description).toContain("0 of 3");
  });

  // Ruling 61, applied to this lookup. STOP_REASON_WORDING is a frozen object literal keyed by a
  // closed union, so `STOP_REASON_WORDING["constructor"]` is a FUNCTION and the banner would have
  // interpolated its source into a sentence shown on every screen. An unwritten reason is a
  // programming error, not a runtime condition -- so it throws, naming the key, rather than
  // rendering a plausible sentence for a value nobody defined.
  it.each(["constructor", "toString", "valueOf", "__proto__", "hasOwnProperty", "notAReason"])(
    "throws rather than rendering inherited wording for the unknown stop reason %s",
    (reason) => {
      expect(() =>
        describeServiceStop({ stopped: true, reason: reason as ServiceStopReason, restartApprovals: [] }),
      ).toThrow(reason);
    },
  );
});
