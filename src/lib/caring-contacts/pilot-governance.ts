// src/lib/caring-contacts/pilot-governance.ts
//
// Pilot Clinical Governance & Hazard Attestation verification (#1S81R8).
// Enforces mandatory Clinical Safety Officer (CSO) sign-off (H-00),
// lived-experience message review (H-04), and Aboriginal cultural safety review (H-05)
// before any non-synthetic / real-patient operation can be activated.

export type CsoGovernanceAttestation = {
  attestationVersion: "1.0.0";
  clinicalSafetyOfficer: {
    name: string;
    ahpraRegistrationNumber: string;
    role: string;
    organisation: string;
  };
  hazardMitigations: {
    h00SafetyOfficerApproved: boolean;
    h04LivedExperienceReviewApproved: boolean;
    h05AboriginalCulturalSafetyApproved: boolean;
  };
  pilotScope: {
    environment: string;
    authorizedCatchments: readonly string[];
    validUntilIso: string;
  };
  signedDateIso: string;
  digitalSignatureRef: string;
};

export class PilotGovernanceViolationError extends Error {
  constructor(message: string) {
    super(`[PILOT GOVERNANCE VIOLATION] ${message}`);
    this.name = "PilotGovernanceViolationError";
  }
}

/**
 * Validates a clinical governance attestation payload.
 */
export function validateGovernanceAttestation(payload: unknown): CsoGovernanceAttestation {
  if (!payload || typeof payload !== "object") {
    throw new PilotGovernanceViolationError(
      "Missing governance attestation payload: real-patient operation requires an explicit signed CSO attestation.",
    );
  }

  const p = payload as Partial<CsoGovernanceAttestation>;

  if (p.attestationVersion !== "1.0.0") {
    throw new PilotGovernanceViolationError(
      `Unsupported attestation version: expected 1.0.0, received ${String(p.attestationVersion)}.`,
    );
  }

  if (
    !p.clinicalSafetyOfficer?.name ||
    !p.clinicalSafetyOfficer?.ahpraRegistrationNumber ||
    !p.clinicalSafetyOfficer?.role
  ) {
    throw new PilotGovernanceViolationError(
      "Incomplete Clinical Safety Officer (CSO) credentials in attestation file (Hazard H-00).",
    );
  }

  if (
    p.hazardMitigations?.h00SafetyOfficerApproved !== true ||
    p.hazardMitigations?.h04LivedExperienceReviewApproved !== true ||
    p.hazardMitigations?.h05AboriginalCulturalSafetyApproved !== true
  ) {
    throw new PilotGovernanceViolationError(
      "Unmitigated clinical hazard flags in attestation. H-00 (CSO), H-04 (Lived Experience), and H-05 (Aboriginal Health) must all be explicitly confirmed true.",
    );
  }

  const validUntilMs = p.pilotScope?.validUntilIso ? new Date(p.pilotScope.validUntilIso).getTime() : Number.NaN;
  if (!Number.isFinite(validUntilMs) || validUntilMs < Date.now()) {
    throw new PilotGovernanceViolationError("The pilot governance attestation has expired or has an invalid date.");
  }

  if (!p.digitalSignatureRef || p.digitalSignatureRef.trim().length < 8) {
    throw new PilotGovernanceViolationError("Missing or invalid digital signature reference in CSO attestation.");
  }

  return p as CsoGovernanceAttestation;
}

/**
 * Enforces that non-synthetic / live pilot mode cannot be activated without an explicit,
 * valid signed CSO attestation.
 */
export function assertPilotGovernanceReady(isDemoOrTrainingMode: boolean, attestationPayload?: unknown): void {
  // If running in synthetic demo or training mode, attestation is not required
  if (isDemoOrTrainingMode) {
    return;
  }

  // If attempting to operate in live / non-synthetic mode, attestation is strictly mandatory
  if (!attestationPayload) {
    throw new PilotGovernanceViolationError(
      "Attempted to toggle out of demo/training mode without an explicit signed governance attestation file. " +
        "Live clinical operation requires signed mitigations for H-00, H-04, and H-05.",
    );
  }

  validateGovernanceAttestation(attestationPayload);
}
