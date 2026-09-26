// src/lib/caring-contacts/synthetic-caseload.ts
//
// 12 clinically realistic yet strictly synthetic patient journeys for demonstration,
// training, and offline testing (#4STSM1, spec §10.2).
//
// Cohorts represented:
//   1. Post-discharge suicidal ideation (high acuity, acute psychiatric/ED discharge)
//   2. Youth aftercare (CAMHS / young adult transition, custom preferences)
//   3. Rural & regional isolation (WA Pilbara, Kimberley, Goldfields, remote clinics)
//
// Every number is drawn from the designated fictional telephone pool and can never connect to any real person.

import { DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS } from "./synthetic-contacts";

export type SyntheticCohort = "postDischargeSuicidePrevention" | "youthAftercare" | "ruralRegionalIsolation";

export type SyntheticJourneyState =
  | "awaitingHandover"
  | "accepted"
  | "active"
  | "activeLate"
  | "paused"
  | "withdrawn"
  | "readmitted"
  | "deliveryFailure"
  | "completed";

export type SyntheticPatientJourney = {
  id: string;
  patientName: string;
  cohort: SyntheticCohort;
  cohortTitle: string;
  fictionalMobile: string;
  geographicalRegion: string;
  clinicalSummary: string;
  lifecycleState: SyntheticJourneyState;
  cadenceProgressLabel: string;
  dischargeMonthsAgo: number;
  assignedCoordinatorId: string | null;
  preferredSendingWindow: "morning" | "midday" | "afternoon";
  hasSafetyHold: boolean;
};

const [miraMobile, rowanMobile] = DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS;

export const SYNTHETIC_CASELOAD_12_PATIENTS: readonly SyntheticPatientJourney[] = Object.freeze([
  // --- Cohort 1: Post-Discharge Suicidal Ideation ---
  {
    id: "syn-pt-ed-01",
    patientName: "Synthetic Patient 01 (ED Post-Discharge)",
    cohort: "postDischargeSuicidePrevention",
    cohortTitle: "Post-Discharge Suicidal Ideation",
    fictionalMobile: miraMobile,
    geographicalRegion: "Perth Metropolitan (Royal Perth Hospital)",
    clinicalSummary:
      "Discharged following acute suicidal crisis with collaborative safety plan. Commencing Week 1 Caring Contact.",
    lifecycleState: "active",
    cadenceProgressLabel: "Week 1",
    dischargeMonthsAgo: 0,
    assignedCoordinatorId: "coordinator-sarah",
    preferredSendingWindow: "morning",
    hasSafetyHold: false,
  },
  {
    id: "syn-pt-ed-02",
    patientName: "Synthetic Patient 02 (Inpatient Psychiatric Aftercare)",
    cohort: "postDischargeSuicidePrevention",
    cohortTitle: "Post-Discharge Suicidal Ideation",
    fictionalMobile: rowanMobile,
    geographicalRegion: "Fiona Stanley Hospital Catchment",
    clinicalSummary: "Discharged after 5-day voluntary psychiatric stay. Awaiting intake coordinator claim.",
    lifecycleState: "awaitingHandover",
    cadenceProgressLabel: "Referral Intake",
    dischargeMonthsAgo: 0,
    assignedCoordinatorId: null,
    preferredSendingWindow: "midday",
    hasSafetyHold: false,
  },
  {
    id: "syn-pt-ed-03",
    patientName: "Synthetic Patient 03 (Long-Term Stabilisation)",
    cohort: "postDischargeSuicidePrevention",
    cohortTitle: "Post-Discharge Suicidal Ideation",
    fictionalMobile: miraMobile,
    geographicalRegion: "Sir Charles Gairdner Hospital",
    clinicalSummary: "Six months post-discharge with stable outpatient psychotherapy. Month 6 contact scheduled.",
    lifecycleState: "activeLate",
    cadenceProgressLabel: "Month 6",
    dischargeMonthsAgo: 6,
    assignedCoordinatorId: "coordinator-sarah",
    preferredSendingWindow: "afternoon",
    hasSafetyHold: false,
  },
  {
    id: "syn-pt-ed-04",
    patientName: "Synthetic Patient 04 (Acute Re-admission Safety Stop)",
    cohort: "postDischargeSuicidePrevention",
    cohortTitle: "Post-Discharge Suicidal Ideation",
    fictionalMobile: rowanMobile,
    geographicalRegion: "Graylands Hospital Catchment",
    clinicalSummary:
      "Emergency department re-admission notification received; automated dispatch halted under safety stop.",
    lifecycleState: "readmitted",
    cadenceProgressLabel: "Month 2 (Paused)",
    dischargeMonthsAgo: 2,
    assignedCoordinatorId: "coordinator-david",
    preferredSendingWindow: "morning",
    hasSafetyHold: true,
  },

  // --- Cohort 2: Youth Aftercare ---
  {
    id: "syn-pt-youth-05",
    patientName: "Synthetic Patient 05 (Youth Mental Health Transition)",
    cohort: "youthAftercare",
    cohortTitle: "Youth Aftercare (16-24)",
    fictionalMobile: miraMobile,
    geographicalRegion: "Perth Children's / CAMHS Catchment",
    clinicalSummary:
      "Young person transition from adolescent service. Requested afternoon text timing to avoid school/study.",
    lifecycleState: "active",
    cadenceProgressLabel: "Week 2",
    dischargeMonthsAgo: 0,
    assignedCoordinatorId: "coordinator-sarah",
    preferredSendingWindow: "afternoon",
    hasSafetyHold: false,
  },
  {
    id: "syn-pt-youth-06",
    patientName: "Synthetic Patient 06 (Study Pause Request)",
    cohort: "youthAftercare",
    cohortTitle: "Youth Aftercare (16-24)",
    fictionalMobile: rowanMobile,
    geographicalRegion: "South Metropolitan Youth Service",
    clinicalSummary: "Plan temporarily paused for 30 days at young person's request during university exam period.",
    lifecycleState: "paused",
    cadenceProgressLabel: "Month 3 (Paused)",
    dischargeMonthsAgo: 3,
    assignedCoordinatorId: "coordinator-david",
    preferredSendingWindow: "midday",
    hasSafetyHold: false,
  },
  {
    id: "syn-pt-youth-07",
    patientName: "Synthetic Patient 07 (Delivery Exception - Unreachable)",
    cohort: "youthAftercare",
    cohortTitle: "Youth Aftercare (16-24)",
    fictionalMobile: miraMobile,
    geographicalRegion: "East Metropolitan Health Service",
    clinicalSummary: "Provider reported number disconnected/invalid. Contact flagged for operational outreach review.",
    lifecycleState: "deliveryFailure",
    cadenceProgressLabel: "Month 4 (Failed Delivery)",
    dischargeMonthsAgo: 4,
    assignedCoordinatorId: "coordinator-david",
    preferredSendingWindow: "morning",
    hasSafetyHold: false,
  },
  {
    id: "syn-pt-youth-08",
    patientName: "Synthetic Patient 08 (Programme Graduation Complete)",
    cohort: "youthAftercare",
    cohortTitle: "Youth Aftercare (16-24)",
    fictionalMobile: rowanMobile,
    geographicalRegion: "Armadale Youth Mental Health",
    clinicalSummary: "Successfully reached 12-month conclusion of caring contacts. Final closing message delivered.",
    lifecycleState: "completed",
    cadenceProgressLabel: "Month 12 (Graduated)",
    dischargeMonthsAgo: 12,
    assignedCoordinatorId: "coordinator-sarah",
    preferredSendingWindow: "afternoon",
    hasSafetyHold: false,
  },

  // --- Cohort 3: Rural & Regional Isolation ---
  {
    id: "syn-pt-rural-09",
    patientName: "Synthetic Patient 09 (Regional Kimberley Remote)",
    cohort: "ruralRegionalIsolation",
    cohortTitle: "Rural & Regional Isolation",
    fictionalMobile: miraMobile,
    geographicalRegion: "WA Country Health Service (Kimberley)",
    clinicalSummary:
      "Broome hospital discharge following acute distress. Intermittent satellite/mobile coverage accounted for.",
    lifecycleState: "active",
    cadenceProgressLabel: "Week 3",
    dischargeMonthsAgo: 1,
    assignedCoordinatorId: "coordinator-sarah",
    preferredSendingWindow: "morning",
    hasSafetyHold: false,
  },
  {
    id: "syn-pt-rural-10",
    patientName: "Synthetic Patient 10 (Pilbara FIFO Worker)",
    cohort: "ruralRegionalIsolation",
    cohortTitle: "Rural & Regional Isolation",
    fictionalMobile: rowanMobile,
    geographicalRegion: "WA Country Health Service (Pilbara / Karratha)",
    clinicalSummary:
      "FIFO worker on swing roster post-discharge from regional emergency care. Midday window aligned with rest periods.",
    lifecycleState: "accepted",
    cadenceProgressLabel: "Week 1 Pending",
    dischargeMonthsAgo: 0,
    assignedCoordinatorId: "coordinator-david",
    preferredSendingWindow: "midday",
    hasSafetyHold: false,
  },
  {
    id: "syn-pt-rural-11",
    patientName: "Synthetic Patient 11 (Connected to Local Community)",
    cohort: "ruralRegionalIsolation",
    cohortTitle: "Rural & Regional Isolation",
    fictionalMobile: miraMobile,
    geographicalRegion: "WA Country Health Service (Goldfields / Kalgoorlie)",
    clinicalSummary:
      "Patient formally requested withdrawal after engaging full-time with local community health support.",
    lifecycleState: "withdrawn",
    cadenceProgressLabel: "Month 5 (Withdrawn)",
    dischargeMonthsAgo: 5,
    assignedCoordinatorId: "coordinator-sarah",
    preferredSendingWindow: "afternoon",
    hasSafetyHold: false,
  },
  {
    id: "syn-pt-rural-12",
    patientName: "Synthetic Patient 12 (Great Southern Referral)",
    cohort: "ruralRegionalIsolation",
    cohortTitle: "Rural & Regional Isolation",
    fictionalMobile: rowanMobile,
    geographicalRegion: "WA Country Health Service (Albany)",
    clinicalSummary:
      "Discharge notification received from Albany Health Campus. Pending clinical coordinator assignment.",
    lifecycleState: "awaitingHandover",
    cadenceProgressLabel: "Intake Triage",
    dischargeMonthsAgo: 0,
    assignedCoordinatorId: null,
    preferredSendingWindow: "morning",
    hasSafetyHold: false,
  },
]);

/**
 * Returns the full cohort of 12 synthetic demonstration journeys.
 *
 * SCOPE NOTE (PR #2776 Copilot follow-up): this generator is the advertised
 * Phase-3 caseload contract and is covered by unit tests, but the runtime demo
 * store (`createDemoWorkspaceStore` / `DEMO_SEED_PEOPLE`) still seeds a smaller
 * curated population on `systemClock()`. Wiring all 12 journeys plus the
 * virtual AWST `CaringContactsTimeProvider` into the live demo seed is a
 * larger domain-seed rewrite (pathway lifecycle, plan states, dispatch
 * attribution) and is deferred as a tracked follow-up rather than shoehorned
 * into this clinical-safety unblock.
 */
export function generateSyntheticCaseload(): readonly SyntheticPatientJourney[] {
  return SYNTHETIC_CASELOAD_12_PATIENTS;
}

/**
 * Retrieves a synthetic journey by ID.
 */
export function getSyntheticJourney(id: string): SyntheticPatientJourney | undefined {
  return SYNTHETIC_CASELOAD_12_PATIENTS.find((journey) => journey.id === id);
}

/**
 * Returns journeys grouped by synthetic cohort.
 */
export function getSyntheticJourneysByCohort(cohort: SyntheticCohort): readonly SyntheticPatientJourney[] {
  return SYNTHETIC_CASELOAD_12_PATIENTS.filter((journey) => journey.cohort === cohort);
}
