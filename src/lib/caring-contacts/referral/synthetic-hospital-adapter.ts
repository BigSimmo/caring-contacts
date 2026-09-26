/**
 * src/lib/caring-contacts/referral/synthetic-hospital-adapter.ts
 *
 * Simulates and validates WA Health discharge notification payloads for:
 * - Royal Perth Hospital (EMHS)
 * - Fiona Stanley Hospital (SMHS)
 * - Sir Charles Gairdner Hospital (NMHS)
 * - WA Country Health Service (WACHS)
 *
 * Implements HospitalReferralAdapter, safely validating JSON envelopes and extracting
 * patient details without throwing unhandled exceptions.
 */

import type { HospitalReferralAdapter, PatientReferral, Result } from "./adapter";

export const WA_HEALTH_FACILITIES = [
  "Royal Perth Hospital",
  "Fiona Stanley Hospital",
  "Sir Charles Gairdner Hospital",
  "WA Country Health Service",
] as const;

export type WAHealthFacility = (typeof WA_HEALTH_FACILITIES)[number];

/**
 * The clinical cohorts a referral may be filed under -- the same four the manual intake form
 * offers. A referral naming anything else is refused at the intake boundary rather than stored
 * under a label no screen or report knows.
 */
export const INTAKE_COHORTS = ["adult_crisis", "youth_mh", "perinatal", "general"] as const;

export type IntakeCohort = (typeof INTAKE_COHORTS)[number];

/**
 * Validates and standardizes Australian mobile telephone numbers, returning the spaced
 * "+61 4xx xxx xxx" form. Shared by referral intake and plan creation so both boundaries accept
 * exactly the same numbers.
 * Rejects non-mobile numbers (e.g. landlines 08..., international non-AU, alpha characters, short codes).
 */
export function validateAustralianMobile(input: string): Result<string> {
  const trimmed = input.trim();
  // Strip common formatting characters: spaces, hyphens, parentheses, periods
  const stripped = trimmed.replace(/[\s\-\(\)\.]/g, "");

  // Must not contain invalid characters (only optional leading +, followed by digits)
  if (!/^\+?\d+$/.test(stripped)) {
    return {
      ok: false,
      error: "Invalid mobile telephone format: contains non-numeric characters",
    };
  }

  // Australian national format: 04XXXXXXXX (10 digits)
  if (/^04\d{8}$/.test(stripped)) {
    return {
      ok: true,
      value: `+61 ${stripped.slice(1, 4)} ${stripped.slice(4, 7)} ${stripped.slice(7)}`,
    };
  }

  // International E.164 with +: +614XXXXXXXX (12 characters)
  if (/^\+614\d{8}$/.test(stripped)) {
    const national = `0${stripped.slice(3)}`;
    return {
      ok: true,
      value: `+61 ${national.slice(1, 4)} ${national.slice(4, 7)} ${national.slice(7)}`,
    };
  }

  // International without +: 614XXXXXXXX (11 characters)
  if (/^614\d{8}$/.test(stripped)) {
    const national = `0${stripped.slice(2)}`;
    return {
      ok: true,
      value: `+61 ${national.slice(1, 4)} ${national.slice(4, 7)} ${national.slice(7)}`,
    };
  }

  // Explicit check for Australian landlines (e.g. WA 08 area code)
  if (/^0[2378]\d{8}$/.test(stripped) || /^\+?61[2378]\d{8}$/.test(stripped)) {
    return {
      ok: false,
      error: "Invalid telephone format: landline number provided, caring contacts requires a mobile number",
    };
  }

  return {
    ok: false,
    error:
      "Invalid mobile telephone format: must be an Australian mobile number (e.g. 04xx xxx xxx or +61 4xx xxx xxx)",
  };
}

export class SyntheticHospitalReferralAdapter implements HospitalReferralAdapter {
  /**
   * Parses and validates an incoming hospital discharge referral notification payload.
   * Handles both JSON string and parsed object inputs, graceful fail-closed error returns.
   */
  async ingestReferral(payload: unknown): Promise<Result<PatientReferral>> {
    try {
      if (payload === null || payload === undefined) {
        return { ok: false, error: "Invalid referral payload: payload is null or undefined" };
      }

      let parsed: unknown = payload;
      if (typeof payload === "string") {
        const trimmed = payload.trim();
        if (trimmed === "") {
          return { ok: false, error: "Invalid referral payload: string payload is empty" };
        }
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          return { ok: false, error: "Malformed referral payload: invalid JSON syntax" };
        }
      }

      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return { ok: false, error: "Invalid referral payload: expected a JSON object envelope" };
      }

      const record = parsed as Record<string, unknown>;

      // Extract nested envelopes if present (e.g. { patient: {...}, episode: {...} })
      const patientEnvelope =
        typeof record.patient === "object" && record.patient !== null && !Array.isArray(record.patient)
          ? (record.patient as Record<string, unknown>)
          : null;

      const episodeEnvelope =
        typeof record.episode === "object" && record.episode !== null && !Array.isArray(record.episode)
          ? (record.episode as Record<string, unknown>)
          : typeof record.encounter === "object" && record.encounter !== null && !Array.isArray(record.encounter)
            ? (record.encounter as Record<string, unknown>)
            : null;

      // 1. Patient Identifier (MRN / UMRN / UR Number)
      const rawIdentifier =
        record.patientIdentifier ??
        record.mrn ??
        record.urNumber ??
        record.patient_identifier ??
        patientEnvelope?.mrn ??
        patientEnvelope?.patientIdentifier ??
        patientEnvelope?.identifier ??
        patientEnvelope?.id;

      if (typeof rawIdentifier !== "string" || rawIdentifier.trim() === "") {
        return { ok: false, error: "Missing or invalid patient identifier (MRN/UR number)" };
      }
      const patientIdentifier = rawIdentifier.trim();

      // 2. Given Name
      const rawGivenName =
        record.givenName ??
        record.firstName ??
        record.first_name ??
        patientEnvelope?.givenName ??
        patientEnvelope?.firstName ??
        patientEnvelope?.first_name;

      if (typeof rawGivenName !== "string" || rawGivenName.trim() === "") {
        return { ok: false, error: "Missing or invalid patient given name" };
      }
      const givenName = rawGivenName.trim();

      // 3. Family Name
      const rawFamilyName =
        record.familyName ??
        record.lastName ??
        record.last_name ??
        record.surname ??
        patientEnvelope?.familyName ??
        patientEnvelope?.lastName ??
        patientEnvelope?.last_name ??
        patientEnvelope?.surname;

      if (typeof rawFamilyName !== "string" || rawFamilyName.trim() === "") {
        return { ok: false, error: "Missing or invalid patient family name" };
      }
      const familyName = rawFamilyName.trim();

      // 4. Mobile Telephone Number
      const rawMobile =
        record.mobileNumber ??
        record.mobile ??
        record.phone ??
        record.telephone ??
        patientEnvelope?.mobileNumber ??
        patientEnvelope?.mobile ??
        patientEnvelope?.phone ??
        patientEnvelope?.telephone;

      if (typeof rawMobile !== "string" || rawMobile.trim() === "") {
        return { ok: false, error: "Missing or invalid patient mobile number" };
      }

      const mobileValidation = validateAustralianMobile(rawMobile);
      if (!mobileValidation.ok) {
        return mobileValidation;
      }
      const mobileNumber = mobileValidation.value;

      // 5. Discharge Timestamp / Date
      const rawDischarge =
        record.dischargeDate ??
        record.discharge_date ??
        record.dischargeTimestamp ??
        episodeEnvelope?.dischargeDate ??
        episodeEnvelope?.discharge_date ??
        episodeEnvelope?.dischargeTimestamp;

      if (typeof rawDischarge !== "string" || rawDischarge.trim() === "") {
        return { ok: false, error: "Missing discharge timestamp" };
      }

      const parsedTimestamp = Date.parse(rawDischarge.trim());
      if (Number.isNaN(parsedTimestamp)) {
        return { ok: false, error: "Corrupt or invalid discharge timestamp" };
      }
      const dischargeDate = new Date(parsedTimestamp).toISOString();

      // 6. Hospital Facility
      const rawFacility =
        record.hospitalFacility ??
        record.hospital ??
        record.facility ??
        record.hospital_facility ??
        episodeEnvelope?.hospitalFacility ??
        episodeEnvelope?.facility ??
        episodeEnvelope?.hospital;

      if (typeof rawFacility !== "string" || rawFacility.trim() === "") {
        return { ok: false, error: "Missing or invalid hospital facility" };
      }
      const hospitalFacility = rawFacility.trim();

      // 7. Cohort
      const rawCohort = record.cohort ?? episodeEnvelope?.cohort;
      const cohort = typeof rawCohort === "string" && rawCohort.trim() !== "" ? rawCohort.trim() : "general";

      // 8. Admitting Ward
      const rawWard =
        record.admittingWard ??
        record.ward ??
        record.admitting_ward ??
        episodeEnvelope?.admittingWard ??
        episodeEnvelope?.ward;
      const admittingWard = typeof rawWard === "string" && rawWard.trim() !== "" ? rawWard.trim() : "General";

      // 9. Clinical Summary
      const rawSummary =
        record.clinicalSummary ??
        record.clinical_summary ??
        record.summary ??
        episodeEnvelope?.clinicalSummary ??
        episodeEnvelope?.summary;
      const clinicalSummary = typeof rawSummary === "string" ? rawSummary.trim() : "";

      // 10. Safety Alerts
      const rawAlerts =
        record.safetyAlerts ??
        record.safety_alerts ??
        record.alerts ??
        episodeEnvelope?.safetyAlerts ??
        episodeEnvelope?.alerts;

      let safetyAlerts: string[] = [];
      if (Array.isArray(rawAlerts)) {
        safetyAlerts = rawAlerts
          .filter((item): item is string => typeof item === "string" && item.trim() !== "")
          .map((s) => s.trim());
      } else if (typeof rawAlerts === "string" && rawAlerts.trim() !== "") {
        safetyAlerts = [rawAlerts.trim()];
      }

      return {
        ok: true,
        value: {
          patientIdentifier,
          givenName,
          familyName,
          mobileNumber,
          dischargeDate,
          hospitalFacility,
          cohort,
          admittingWard,
          clinicalSummary,
          safetyAlerts,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: `Unexpected error during referral ingestion: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Kept for the plan wizard, which reads this rule by name so it refuses exactly what intake
   * refuses. New code should call `validateAustralianMobile` directly.
   */
  validateAndFormatMobile(input: string): Result<string> {
    return validateAustralianMobile(input);
  }

  /**
   * Helper utility for creating realistic synthetic WA Health discharge notification payloads.
   */
  createSyntheticPayload(facility: WAHealthFacility, overrides?: Partial<PatientReferral>): Record<string, unknown> {
    const defaultMrnPrefix: Record<WAHealthFacility, string> = {
      "Royal Perth Hospital": "RPH-",
      "Fiona Stanley Hospital": "FSH-",
      "Sir Charles Gairdner Hospital": "SCGH-",
      "WA Country Health Service": "WACHS-",
    };

    const prefix = defaultMrnPrefix[facility] ?? "WA-";
    const randomId = Math.floor(100000 + Math.random() * 900000);

    return {
      resourceType: "DischargeNotification",
      hospitalFacility: facility,
      patient: {
        mrn: overrides?.patientIdentifier ?? `${prefix}${randomId}`,
        givenName: overrides?.givenName ?? "Mira",
        familyName: overrides?.familyName ?? "Chen",
        mobile: overrides?.mobileNumber ?? "+61 491 570 006",
      },
      episode: {
        dischargeDate: overrides?.dischargeDate ?? new Date().toISOString(),
        admittingWard: overrides?.admittingWard ?? "Ward 4A Acute Mental Health",
        cohort: overrides?.cohort ?? "adult_crisis",
        clinicalSummary:
          overrides?.clinicalSummary ??
          "Discharged following stabilization after acute crisis presentation. Outpatient follow-up organized.",
        safetyAlerts: overrides?.safetyAlerts ?? ["Acute distress", "Aftercare support required"],
      },
    };
  }
}
