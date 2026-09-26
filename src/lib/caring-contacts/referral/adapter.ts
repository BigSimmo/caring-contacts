/**
 * src/lib/caring-contacts/referral/adapter.ts
 *
 * Provider-neutral hospital referral domain interface.
 * Mitigates Hazard H-44 by insulating the core Caring Contacts domain from external
 * hospital EMR/PAS integration variances (e.g. WebPAS, HL7 v2, FHIR).
 */

export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

export interface PatientReferral {
  patientIdentifier: string;
  givenName: string;
  familyName: string;
  mobileNumber: string;
  dischargeDate: string;
  hospitalFacility: string;
  cohort: string;
  admittingWard: string;
  clinicalSummary: string;
  safetyAlerts: string[];
}

export interface HospitalReferralAdapter {
  ingestReferral(payload: unknown): Promise<Result<PatientReferral>>;
}
