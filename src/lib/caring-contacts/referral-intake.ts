// src/lib/caring-contacts/referral-intake.ts
//
// Clinical payload captured at hospital referral intake (Hazard H-44).
//
// Kept in its own module so client screens (the plan wizard) can name the persisted
// shape without importing the repository contract. That contract imports
// `service-state`, and a client graph that reaches service-state would put the
// incident note on the wrong side of the server boundary.

export type ReferralIntakePayload = {
  patientIdentifier: string;
  givenName: string;
  familyName: string;
  mobileNumber: string;
  dischargeDate: string;
  hospitalFacility: string;
  cohort: string;
  admittingWard: string;
  clinicalSummary: string;
  safetyAlerts: readonly string[];
};
