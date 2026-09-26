// tests/caring-contacts-restart-approval-seats.test.ts
//
// Owner decision (2026-09-26): each service-restart approval seat must be held by a named staff
// member listed for that seat in governance configuration, and all approvers must be different
// people. The rule lives in the sealed domain (service-state.ts); this file pins the configuration
// the server seam supplies, and that it fails closed.
import { describe, expect, it } from "vitest";

import {
  DEMO_RESTART_APPROVAL_SEATS,
  parseRestartApprovalSeats,
} from "@/lib/caring-contacts-server/restart-approval-seats";
import { demoActorForRole } from "@/lib/caring-contacts-server/session";
import { actorId } from "@/lib/caring-contacts/ids";
import { NO_RESTART_APPROVAL_SEATS } from "@/lib/caring-contacts/service-state";

describe("restart approval seat configuration", () => {
  it("names only real demo people, and names nobody as privacy and security owner", () => {
    expect(DEMO_RESTART_APPROVAL_SEATS.incidentLead).toEqual([demoActorForRole("teamLead").id]);
    expect(DEMO_RESTART_APPROVAL_SEATS.clinicalProgrammeLead).toEqual([demoActorForRole("clinicalProgrammeLead").id]);
    expect(DEMO_RESTART_APPROVAL_SEATS.privacySecurityOwner).toEqual([]);
  });

  it("reads a well-formed live roster", () => {
    expect(
      parseRestartApprovalSeats(
        JSON.stringify({
          incidentLead: ["staff-1"],
          privacySecurityOwner: ["staff-2"],
          clinicalProgrammeLead: ["staff-3"],
        }),
      ),
    ).toEqual({
      incidentLead: [actorId("staff-1")],
      privacySecurityOwner: [actorId("staff-2")],
      clinicalProgrammeLead: [actorId("staff-3")],
    });
  });

  it("treats a missing seat as held by nobody", () => {
    expect(parseRestartApprovalSeats(JSON.stringify({ incidentLead: ["staff-1"] })).privacySecurityOwner).toEqual([]);
  });

  it.each([
    ["unset", undefined],
    ["blank", "   "],
    ["not JSON", "incidentLead=staff-1"],
    ["an array", "[]"],
    ["a seat that is not a list", JSON.stringify({ incidentLead: "staff-1" })],
    ["a blank staff identifier", JSON.stringify({ incidentLead: ["staff-1", " "] })],
    ["a non-string staff identifier", JSON.stringify({ incidentLead: [7] })],
  ])("fails closed -- nobody holds any seat -- when the configuration is %s", (_label, raw) => {
    expect(parseRestartApprovalSeats(raw)).toEqual(NO_RESTART_APPROVAL_SEATS);
  });
});
