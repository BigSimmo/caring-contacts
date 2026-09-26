import { describe, expect, it } from "vitest";

import {
  assertPilotGovernanceReady,
  PilotGovernanceViolationError,
  validateGovernanceAttestation,
  type CsoGovernanceAttestation,
} from "@/lib/caring-contacts/pilot-governance";

describe("Pilot Governance & Hazard Controls (#1S81R8)", () => {
  const futureExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

  const validAttestation: CsoGovernanceAttestation = {
    attestationVersion: "1.0.0",
    clinicalSafetyOfficer: {
      name: "Dr. Eleanor Vance, FRANZCP",
      ahpraRegistrationNumber: "MED0001928374",
      role: "Clinical Safety Officer & Consultant Psychiatrist",
      organisation: "WA Health Mental Health Division",
    },
    hazardMitigations: {
      h00SafetyOfficerApproved: true,
      h04LivedExperienceReviewApproved: true,
      h05AboriginalCulturalSafetyApproved: true,
    },
    pilotScope: {
      environment: "australia-southeast-pilot",
      authorizedCatchments: ["Perth Metro", "Fiona Stanley Hospital"],
      validUntilIso: futureExpiry,
    },
    signedDateIso: "2026-09-12T00:00:00Z",
    digitalSignatureRef: "SIG-CSO-20260912-9843A1B2",
  };

  it("passes when operating in demo/training mode without attestation", () => {
    expect(() => assertPilotGovernanceReady(true)).not.toThrow();
  });

  it("fails when attempting to disable demo/training mode without an attestation file", () => {
    expect(() => assertPilotGovernanceReady(false)).toThrow(PilotGovernanceViolationError);
    expect(() => assertPilotGovernanceReady(false)).toThrow(
      /Attempted to toggle out of demo\/training mode without an explicit signed governance attestation file/,
    );
  });

  it("passes when live mode is provided with a valid, signed CSO attestation", () => {
    expect(() => assertPilotGovernanceReady(false, validAttestation)).not.toThrow();
    const validated = validateGovernanceAttestation(validAttestation);
    expect(validated.clinicalSafetyOfficer.name).toBe("Dr. Eleanor Vance, FRANZCP");
    expect(validated.hazardMitigations.h00SafetyOfficerApproved).toBe(true);
  });

  it("fails if any mandatory hazard mitigation flag (H-00, H-04, H-05) is false or unapproved", () => {
    const unapprovedLivedExperience = {
      ...validAttestation,
      hazardMitigations: {
        ...validAttestation.hazardMitigations,
        h04LivedExperienceReviewApproved: false,
      },
    };

    expect(() => assertPilotGovernanceReady(false, unapprovedLivedExperience)).toThrow(PilotGovernanceViolationError);
    expect(() => assertPilotGovernanceReady(false, unapprovedLivedExperience)).toThrow(
      /H-00 \(CSO\), H-04 \(Lived Experience\), and H-05 \(Aboriginal Health\) must all be explicitly confirmed true/,
    );
  });

  it("fails if CSO credentials are incomplete or missing", () => {
    const missingCso = {
      ...validAttestation,
      clinicalSafetyOfficer: {
        name: "",
        ahpraRegistrationNumber: "",
        role: "",
        organisation: "",
      },
    };

    expect(() => assertPilotGovernanceReady(false, missingCso)).toThrow(
      /Incomplete Clinical Safety Officer \(CSO\) credentials/,
    );
  });

  it("fails if the attestation signature has expired", () => {
    const expiredAttestation = {
      ...validAttestation,
      pilotScope: {
        ...validAttestation.pilotScope,
        validUntilIso: "2025-01-01T00:00:00Z",
      },
    };

    expect(() => assertPilotGovernanceReady(false, expiredAttestation)).toThrow(/expired or has an invalid date/);
  });

  it("fails if validUntilIso is malformed (non-finite)", () => {
    const malformed = {
      ...validAttestation,
      pilotScope: {
        ...validAttestation.pilotScope,
        validUntilIso: "not-a-date",
      },
    };

    expect(() => assertPilotGovernanceReady(false, malformed)).toThrow(/expired or has an invalid date/);
  });
});
