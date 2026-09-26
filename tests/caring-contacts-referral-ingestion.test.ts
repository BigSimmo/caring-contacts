/**
 * tests/caring-contacts-referral-ingestion.test.ts
 *
 * Test suite verifying the hospital referral domain adapter and synthetic WA Health
 * discharge feed ingestion.
 *
 * Verifies:
 * - Valid WA Health discharge notification payloads (Royal Perth, Fiona Stanley,
 *   Sir Charles Gairdner, WACHS) parse cleanly into PatientReferral.
 * - Flat and nested JSON envelopes, and JSON string representations are handled.
 * - Malformed JSON, missing MRN, corrupt timestamps, and bad telephone formats
 *   return descriptive error results without throwing unhandled exceptions.
 */

import { describe, expect, it } from "vitest";

import {
  SyntheticHospitalReferralAdapter,
  WA_HEALTH_FACILITIES,
  type PatientReferral,
  type WAHealthFacility,
} from "@/lib/caring-contacts/referral";

describe("Caring Contacts Hospital Referral Ingestion", () => {
  const adapter = new SyntheticHospitalReferralAdapter();

  describe("Valid WA Health Notification Payloads", () => {
    it.each(WA_HEALTH_FACILITIES)("parses synthetic payloads cleanly for %s", async (facility: WAHealthFacility) => {
      const payload = adapter.createSyntheticPayload(facility);
      const result = await adapter.ingestReferral(payload);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const referral: PatientReferral = result.value;
      expect(referral.hospitalFacility).toBe(facility);
      expect(referral.patientIdentifier).toMatch(/^(?:RPH|FSH|SCGH|WACHS|WA)-\d+$/);
      expect(referral.givenName).toBe("Mira");
      expect(referral.familyName).toBe("Chen");
      expect(referral.mobileNumber).toBe("+61 491 570 006");
      expect(referral.dischargeDate).toBeDefined();
      expect(new Date(referral.dischargeDate).toISOString()).toBe(referral.dischargeDate);
      expect(referral.cohort).toBe("adult_crisis");
      expect(referral.admittingWard).toBe("Ward 4A Acute Mental Health");
      expect(referral.safetyAlerts).toEqual(["Acute distress", "Aftercare support required"]);
    });

    it("parses flat JSON payloads with standard fields", async () => {
      const flatPayload = {
        patientIdentifier: "SCGH-99124",
        givenName: "Rowan",
        familyName: "Taylor",
        mobileNumber: "0491 570 156",
        dischargeDate: "2026-09-12T14:30:00.000Z",
        hospitalFacility: "Sir Charles Gairdner Hospital",
        cohort: "adult",
        admittingWard: "Mental Health Observation Unit",
        clinicalSummary: "Patient completed voluntary acute stay.",
        safetyAlerts: ["Support network required"],
      };

      const result = await adapter.ingestReferral(flatPayload);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toEqual({
        patientIdentifier: "SCGH-99124",
        givenName: "Rowan",
        familyName: "Taylor",
        mobileNumber: "+61 491 570 156",
        dischargeDate: "2026-09-12T14:30:00.000Z",
        hospitalFacility: "Sir Charles Gairdner Hospital",
        cohort: "adult",
        admittingWard: "Mental Health Observation Unit",
        clinicalSummary: "Patient completed voluntary acute stay.",
        safetyAlerts: ["Support network required"],
      });
    });

    it("parses valid JSON string payloads", async () => {
      const jsonString = JSON.stringify({
        mrn: "FSH-44219",
        firstName: "Jesse",
        lastName: "Smith",
        mobile: "+61491570006",
        dischargeTimestamp: "2026-09-10T10:00:00+08:00",
        facility: "Fiona Stanley Hospital",
        ward: "Ward 5A",
        cohort: "youth_mh",
        summary: "Youth crisis transition plan in place.",
        alerts: "Previous crisis presentation",
      });

      const result = await adapter.ingestReferral(jsonString);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.patientIdentifier).toBe("FSH-44219");
      expect(result.value.givenName).toBe("Jesse");
      expect(result.value.familyName).toBe("Smith");
      expect(result.value.mobileNumber).toBe("+61 491 570 006");
      expect(result.value.hospitalFacility).toBe("Fiona Stanley Hospital");
      expect(result.value.admittingWard).toBe("Ward 5A");
      expect(result.value.cohort).toBe("youth_mh");
      expect(result.value.safetyAlerts).toEqual(["Previous crisis presentation"]);
    });

    it("handles various valid Australian mobile telephone formats", async () => {
      const validNumbers = [
        { input: "0491570006", expected: "+61 491 570 006" },
        { input: "0491 570 156", expected: "+61 491 570 156" },
        { input: "0491-570-006", expected: "+61 491 570 006" },
        { input: "(0491) 570 156", expected: "+61 491 570 156" },
        { input: "+61491570006", expected: "+61 491 570 006" },
        { input: "+61 491 570 006", expected: "+61 491 570 006" },
        { input: "61491570006", expected: "+61 491 570 006" },
      ];

      for (const { input, expected } of validNumbers) {
        const payload = {
          mrn: "TEST-01",
          givenName: "Test",
          familyName: "Patient",
          mobile: input,
          dischargeDate: "2026-09-12T00:00:00Z",
          facility: "Royal Perth Hospital",
        };

        const result = await adapter.ingestReferral(payload);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.mobileNumber).toBe(expected);
        }
      }
    });

    it("applies sensible defaults for optional clinical attributes", async () => {
      const minimalPayload = {
        mrn: "WACHS-88123",
        givenName: "Alex",
        familyName: "Rivera",
        mobile: "0491570006",
        dischargeDate: "2026-09-12T12:00:00Z",
        facility: "WA Country Health Service",
      };

      const result = await adapter.ingestReferral(minimalPayload);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.cohort).toBe("general");
      expect(result.value.admittingWard).toBe("General");
      expect(result.value.clinicalSummary).toBe("");
      expect(result.value.safetyAlerts).toEqual([]);
    });
  });

  describe("Fail-Closed Handling of Malformed & Invalid Payloads", () => {
    it("returns an error for null, undefined, or empty payloads without throwing", async () => {
      const nullResult = await adapter.ingestReferral(null);
      expect(nullResult.ok).toBe(false);
      if (!nullResult.ok) {
        expect(nullResult.error).toContain("null or undefined");
      }

      const undefinedResult = await adapter.ingestReferral(undefined);
      expect(undefinedResult.ok).toBe(false);
      if (!undefinedResult.ok) {
        expect(undefinedResult.error).toContain("null or undefined");
      }

      const emptyStringResult = await adapter.ingestReferral("   ");
      expect(emptyStringResult.ok).toBe(false);
      if (!emptyStringResult.ok) {
        expect(emptyStringResult.error).toContain("empty");
      }
    });

    it("returns a syntax error for malformed JSON strings without throwing", async () => {
      const malformedJson = "{ mrn: 'broken', badJson: true ";
      const result = await adapter.ingestReferral(malformedJson);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("invalid JSON syntax");
      }
    });

    it("returns an error when payload is an array or primitive", async () => {
      const arrayResult = await adapter.ingestReferral(["not", "an", "object"]);
      expect(arrayResult.ok).toBe(false);
      if (!arrayResult.ok) {
        expect(arrayResult.error).toContain("expected a JSON object envelope");
      }

      const numberResult = await adapter.ingestReferral(12345);
      expect(numberResult.ok).toBe(false);
    });

    it("returns an error for missing or empty MRN / patient identifier", async () => {
      const missingMrn = {
        givenName: "Test",
        familyName: "User",
        mobile: "0491570006",
        dischargeDate: "2026-09-12T00:00:00Z",
        facility: "Royal Perth Hospital",
      };

      const resultMissing = await adapter.ingestReferral(missingMrn);
      expect(resultMissing.ok).toBe(false);
      if (!resultMissing.ok) {
        expect(resultMissing.error).toContain("patient identifier");
      }

      const blankMrn = { ...missingMrn, patientIdentifier: "   " };
      const resultBlank = await adapter.ingestReferral(blankMrn);
      expect(resultBlank.ok).toBe(false);
      if (!resultBlank.ok) {
        expect(resultBlank.error).toContain("patient identifier");
      }
    });

    it("returns an error for missing patient names", async () => {
      const base = {
        mrn: "RPH-12345",
        mobile: "0491570006",
        dischargeDate: "2026-09-12T00:00:00Z",
        facility: "Royal Perth Hospital",
      };

      const missingGiven = await adapter.ingestReferral({ ...base, familyName: "Chen" });
      expect(missingGiven.ok).toBe(false);
      if (!missingGiven.ok) {
        expect(missingGiven.error).toContain("given name");
      }

      const missingFamily = await adapter.ingestReferral({ ...base, givenName: "Mira" });
      expect(missingFamily.ok).toBe(false);
      if (!missingFamily.ok) {
        expect(missingFamily.error).toContain("family name");
      }
    });

    it("returns an error for missing or corrupt discharge timestamps", async () => {
      const base = {
        mrn: "RPH-12345",
        givenName: "Mira",
        familyName: "Chen",
        mobile: "0491570006",
        facility: "Royal Perth Hospital",
      };

      const missingDate = await adapter.ingestReferral(base);
      expect(missingDate.ok).toBe(false);
      if (!missingDate.ok) {
        expect(missingDate.error).toContain("Missing discharge timestamp");
      }

      const corruptDate = await adapter.ingestReferral({ ...base, dischargeDate: "not-a-timestamp" });
      expect(corruptDate.ok).toBe(false);
      if (!corruptDate.ok) {
        expect(corruptDate.error).toContain("Corrupt or invalid discharge timestamp");
      }
    });

    it("returns an error for missing hospital facility", async () => {
      const missingFacility = {
        mrn: "RPH-12345",
        givenName: "Mira",
        familyName: "Chen",
        mobile: "0491570006",
        dischargeDate: "2026-09-12T00:00:00Z",
      };

      const result = await adapter.ingestReferral(missingFacility);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("hospital facility");
      }
    });

    it("returns descriptive errors for bad telephone formats without throwing", async () => {
      const base = {
        mrn: "RPH-12345",
        givenName: "Mira",
        familyName: "Chen",
        dischargeDate: "2026-09-12T00:00:00Z",
        facility: "Royal Perth Hospital",
      };

      // Landline numbers (e.g. WA 08 area code)
      const landlineResult = await adapter.ingestReferral({ ...base, mobile: "08 9224 2244" });
      expect(landlineResult.ok).toBe(false);
      if (!landlineResult.ok) {
        expect(landlineResult.error).toContain("landline number provided");
      }

      // Non-numeric characters
      const lettersResult = await adapter.ingestReferral({ ...base, mobile: "0491-CALL-ME" });
      expect(lettersResult.ok).toBe(false);
      if (!lettersResult.ok) {
        expect(lettersResult.error).toContain("contains non-numeric characters");
      }

      // Short codes / incomplete numbers
      const shortResult = await adapter.ingestReferral({ ...base, mobile: "0491" });
      expect(shortResult.ok).toBe(false);
      if (!shortResult.ok) {
        expect(shortResult.error).toContain("must be an Australian mobile number");
      }

      // Missing mobile
      const missingResult = await adapter.ingestReferral({ ...base, mobile: "" });
      expect(missingResult.ok).toBe(false);
      if (!missingResult.ok) {
        expect(missingResult.error).toContain("mobile number");
      }
    });
  });
});
