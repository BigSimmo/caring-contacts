import {
  FICTIONAL_CONTACTS_BY_ROLE,
  type SyntheticAuditEvent,
  type SyntheticDeliveryEvent,
  type SyntheticEpisode,
  type SyntheticPathway,
  type SyntheticPatient,
  type SyntheticPlannedContact,
  type SyntheticReferral,
  type SyntheticSendingPreference,
  type SyntheticTeamMember,
  type SyntheticTemplate,
} from "./types";

export const FICTIONAL_DATA_MARKER = "Synthetic prototype — fictional data only";

export const SYNTHETIC_SERVICE_SENDING_WINDOWS = {
  Morning: { scheduledTime: "10:00:00", windowLabel: "Morning 10:00 am AWST" },
  Afternoon: { scheduledTime: "14:00:00", windowLabel: "Afternoon 2:00 pm AWST" },
  "Early evening": { scheduledTime: "17:00:00", windowLabel: "Early evening 5:00 pm AWST" },
} as const satisfies Record<string, Omit<SyntheticSendingPreference, "window">>;

export const ROWAN_SELECTED_SENDING_PREFERENCE = {
  window: "Morning",
  ...SYNTHETIC_SERVICE_SENDING_WINDOWS.Morning,
} as const satisfies SyntheticSendingPreference;

export const syntheticPatients = [
  {
    id: "SYN-PATIENT-002",
    fullName: "Mira Example",
    preferredName: "Mira",
    dateOfBirth: "1992-04-17",
    mobile: FICTIONAL_CONTACTS_BY_ROLE.miraPatientMobile,
    mobileSource: "Synthetic hospital record",
    patientControlledForSms: true,
  },
  {
    id: "SYN-PATIENT-001",
    fullName: "Rowan Sample",
    preferredName: "Rowan",
    dateOfBirth: "1987-11-03",
    mobile: FICTIONAL_CONTACTS_BY_ROLE.rowanPatientMobile,
    mobileSource: "Synthetic hospital record",
    patientControlledForSms: true,
  },
] satisfies readonly SyntheticPatient[];

export const syntheticReferrals = [
  {
    id: "SYN-REFERRAL-001",
    patientId: "SYN-PATIENT-002",
    referringTeam: "Fictional Ward A",
    receivedAt: "2026-08-15T08:40:00+08:00",
    dischargedAt: "2026-08-15T08:10:00+08:00",
    handoverState: "Awaiting handover",
    agreementConfirmed: true,
  },
  {
    id: "SYN-REFERRAL-002",
    patientId: "SYN-PATIENT-001",
    referringTeam: "Example Transition Unit",
    receivedAt: "2026-08-15T09:15:00+08:00",
    dischargedAt: "2026-08-15T09:00:00+08:00",
    handoverState: "Accepted",
    agreementConfirmed: true,
  },
] satisfies readonly SyntheticReferral[];

export const syntheticPathways = [
  {
    id: "SYN-PATHWAY-001",
    name: "Example twelve-month pathway",
    version: "SYN-v0.3",
    duration: "12 months",
    cadence: [
      "Day 1",
      "Week 1",
      "Month 1",
      "Month 2",
      "Month 3",
      "Month 4",
      "Month 6",
      "Month 8",
      "Month 10",
      "Month 12",
    ],
    senderLabel: "Example Aftercare Team",
    governanceLabel: "Illustrative locally governed pathway",
    approvalState: "Locally approved",
    lifecycle: "Current",
    approvalEvidence: {
      clinicalProgrammeLead: "Taylor Fiction · clinical programme lead · approved 14 Aug 2026 at 4:10 pm AWST",
      livedExperienceContentReviewer:
        "Jordan Example · lived-experience/content reviewer · approved 14 Aug 2026 at 4:24 pm AWST",
    },
  },
  {
    id: "SYN-PATHWAY-RETIRED",
    name: "Example retired twelve-month pathway",
    version: "SYN-v0.2-retired",
    duration: "12 months",
    cadence: [
      "Day 1",
      "Week 1",
      "Month 1",
      "Month 2",
      "Month 3",
      "Month 4",
      "Month 6",
      "Month 8",
      "Month 10",
      "Month 12",
    ],
    senderLabel: "Example Aftercare Team",
    governanceLabel: "Illustrative locally governed pathway",
    approvalState: "Locally approved",
    lifecycle: "Retired",
    approvalEvidence: {
      clinicalProgrammeLead: "Taylor Fiction · clinical programme lead · approved 1 Aug 2026 at 2:10 pm AWST",
      livedExperienceContentReviewer:
        "Jordan Example · lived-experience/content reviewer · approved 1 Aug 2026 at 2:24 pm AWST",
    },
  },
] satisfies readonly SyntheticPathway[];

export const syntheticTeamMembers = [
  { id: "SYN-TEAM-001", displayName: "Alex Example", role: "Coordinator" },
  { id: "SYN-TEAM-002", displayName: "Sam Sample", role: "Team lead" },
  { id: "SYN-TEAM-003", displayName: "Taylor Fiction", role: "Authorised clinician" },
] satisfies readonly SyntheticTeamMember[];

export const syntheticEpisodes = [
  {
    id: "SYN-EPISODE-001",
    patientId: "SYN-PATIENT-001",
    referralId: "SYN-REFERRAL-002",
    state: "Active",
    coordinatorId: "SYN-TEAM-001",
    pathwayId: "SYN-PATHWAY-001",
    openedAt: "2026-08-15T09:35:00+08:00",
    selectedSendingPreference: ROWAN_SELECTED_SENDING_PREFERENCE,
  },
] satisfies readonly SyntheticEpisode[];

export const syntheticPlannedContacts = [
  ["Day 1", "2026-08-15T10:00:00+08:00", "Delivered"],
  ["Week 1", "2026-08-22T10:00:00+08:00", "Scheduled"],
  ["Month 1", "2026-09-15T10:00:00+08:00", "Scheduled"],
  ["Month 2", "2026-10-15T10:00:00+08:00", "Scheduled"],
  ["Month 3", "2026-11-15T10:00:00+08:00", "Scheduled"],
  ["Month 4", "2026-12-15T10:00:00+08:00", "Scheduled"],
  ["Month 6", "2027-02-15T10:00:00+08:00", "Scheduled"],
  ["Month 8", "2027-04-15T10:00:00+08:00", "Scheduled"],
  ["Month 10", "2027-06-15T10:00:00+08:00", "Scheduled"],
  ["Month 12", "2027-08-15T10:00:00+08:00", "Scheduled"],
].map(
  ([cadenceLabel, scheduledAt, transportState], index) =>
    ({
      id: `SYN-CONTACT-${String(index + 1).padStart(3, "0")}`,
      episodeId: "SYN-EPISODE-001",
      sequence: index + 1,
      cadenceLabel,
      scheduledAt,
      window: ROWAN_SELECTED_SENDING_PREFERENCE.window,
      windowLabel: ROWAN_SELECTED_SENDING_PREFERENCE.windowLabel,
      transportState,
    }) as SyntheticPlannedContact,
);

export const syntheticTemplates = [
  {
    id: "SYN-TEMPLATE-001",
    name: "Example first contact",
    version: "SYN-copy-v1.0",
    variant: "Warm neutral A",
    segmentCount: 2,
    encoding: "GSM-7",
    approvalState: "Locally approved",
    lifecycle: "Current",
    approvalEvidence: {
      clinicalProgrammeLead: "Taylor Fiction · clinical programme lead · approved 14 Aug 2026 at 4:10 pm AWST",
      livedExperienceContentReviewer:
        "Jordan Example · lived-experience/content reviewer · approved 14 Aug 2026 at 4:24 pm AWST",
    },
  },
  {
    id: "SYN-TEMPLATE-002",
    name: "Example pending contact",
    version: "SYN-copy-v0.2",
    variant: "Warm neutral draft",
    segmentCount: 2,
    encoding: "GSM-7",
    approvalState: "Illustrative — approval pending",
    lifecycle: "Current",
    approvalEvidence: null,
  },
] satisfies readonly SyntheticTemplate[];

export const syntheticDeliveryEvents = [
  {
    id: "SYN-DELIVERY-001",
    contactId: "SYN-CONTACT-001",
    occurredAt: "2026-08-15T10:00:14+08:00",
    state: "Delivered",
    operationalNote: "Transport receipt recorded; this does not show that the contact was read.",
  },
] satisfies readonly SyntheticDeliveryEvent[];

export const syntheticAuditEvents = [
  {
    id: "SYN-AUDIT-001",
    occurredAt: "2026-08-15T09:35:00+08:00",
    actorId: "SYN-TEAM-003",
    action: "Accepted fictional referral",
    objectId: "SYN-REFERRAL-002",
  },
] satisfies readonly SyntheticAuditEvent[];
