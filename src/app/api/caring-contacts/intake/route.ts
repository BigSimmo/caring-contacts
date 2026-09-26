// src/app/api/caring-contacts/intake/route.ts
//
// Manual hospital referral intake fallback (Hazard H-44). Validates a discharge
// payload, then persists the full intake clinical payload with the referral and
// accepts it through audited store writes so Initiate Care Plan can open
// `/plans/new?referral=<id>` against a real record whose clinical fields round-trip
// from the store (never an adapter echo of discarded fields).
import { createHash } from "node:crypto";
import { z } from "zod";

import { auditableIdentifier, auditedRead, writeContextFor, writeHandler } from "@/lib/caring-contacts-server/handler";
import { isAccessObjectIdShape } from "@/lib/caring-contacts/access-audit";
import { containsAuMobileNumber } from "@/lib/caring-contacts/audit";
import { systemClock } from "@/lib/caring-contacts/clock";
import { isDischargeWithinAcceptedWindow } from "@/lib/caring-contacts/discharge-window";
import { patientId, pathwayVersionId, referralId } from "@/lib/caring-contacts/ids";
import { INTAKE_COHORTS, SyntheticHospitalReferralAdapter, WA_HEALTH_FACILITIES } from "@/lib/caring-contacts/referral";

export const runtime = "nodejs";

/** Any control character. Single-line fields (names, ward, identifiers) may hold none at all. */
const ANY_CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;
/** Control characters other than tab, line feed and carriage return, for multi-line free text. */
const DISALLOWED_FREE_TEXT_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** A trimmed, non-blank single line of at most `max` characters, with no control characters. */
function singleLine(max: number) {
  return z
    .string()
    .max(max)
    .refine((value) => value.trim() !== "", { message: "must not be blank" })
    .refine((value) => !ANY_CONTROL_CHARACTER.test(value), { message: "must not contain control characters" });
}

/** Free text that may span lines, at most `max` characters, with no control characters beyond line breaks and tabs. */
function freeText(max: number) {
  return z
    .string()
    .max(max)
    .refine((value) => !DISALLOWED_FREE_TEXT_CHARACTER.test(value), {
      message: "must not contain control characters",
    });
}

const intakeSchema = z
  .object({
    // The MRN becomes part of the audit object id, and the audit trail refuses anything shaped like
    // a mobile number. Refusing it HERE gives the caller a clean 400 rather than a failed write.
    patientIdentifier: singleLine(64).refine((value) => !containsAuMobileNumber(value), {
      message: "must not look like a phone number",
    }),
    givenName: singleLine(100),
    familyName: singleLine(100),
    mobileNumber: singleLine(32),
    // A discharge within the last 90 days, up to 10 minutes ahead of the server clock (skew).
    dischargeDate: z
      .string()
      .max(64)
      .refine((value) => isDischargeWithinAcceptedWindow(new Date(value), systemClock().now()), {
        message: "must be a discharge within the last 90 days",
      }),
    hospitalFacility: z.enum(WA_HEALTH_FACILITIES),
    cohort: z.enum(INTAKE_COHORTS),
    admittingWard: singleLine(100),
    clinicalSummary: freeText(4000),
    safetyAlerts: z.array(singleLine(200)).max(20),
    idempotencyKey: auditableIdentifier,
    pathwayVersionId: auditableIdentifier.optional(),
  })
  .strict();

/**
 * Stable object ids for audit / store keys.
 *
 * Hash BEFORE any truncation so two long identifiers that share a prefix cannot
 * collapse into the same patient/referral id. When the compact candidate fits the
 * access-object-id grammar without truncation, keep it for readability; otherwise
 * use a digest of the full raw material.
 */
function toObjectId(prefix: string, raw: string): string {
  const compact = raw
    .replace(/[^A-Za-z0-9_:-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const untruncated = `${prefix}-${compact}`;
  if (untruncated.length <= 128 && isAccessObjectIdShape(untruncated)) return untruncated;
  const digest = createHash("sha256").update(`${prefix}:${raw}`).digest("hex").slice(0, 32);
  return `${prefix}-${digest}`;
}

/** Facility-namespaced patient key so local MRNs from different hospitals do not collide. */
function namespacedPatientKey(facility: string, patientIdentifier: string): string {
  return `${facility.trim()}|${patientIdentifier.trim()}`;
}

/** Deterministic referral id from team + namespaced patient + request idempotency key. */
function deterministicReferralObjectId(teamId: string, namespacedPatient: string, idempotencyKey: string): string {
  return toObjectId("referral", `${teamId}:${namespacedPatient}:${idempotencyKey}`);
}

const adapter = new SyntheticHospitalReferralAdapter();

export const POST = writeHandler({
  schema: intakeSchema,
  action: "createReferral",
  access: {
    objectType: "patientDirectory",
    objectId: (body) => toObjectId("intake", namespacedPatientKey(body.hospitalFacility, body.patientIdentifier)),
  },
  write: async (store, actor, body) => {
    const validated = await adapter.ingestReferral(body);
    if (!validated.ok) {
      return { ok: false, reason: validated.error };
    }

    const referral = validated.value;
    const namespacedPatient = namespacedPatientKey(referral.hospitalFacility, referral.patientIdentifier);
    const nextPatientId = patientId(toObjectId("patient", namespacedPatient));
    const nextReferralId = referralId(
      deterministicReferralObjectId(actor.teamId, namespacedPatient, body.idempotencyKey),
    );

    // Pathway selection BEFORE createReferral so a missing/invalid pathway cannot leave a
    // partial awaitingHandover referral behind.
    const pathwayLookup = await auditedRead(
      store,
      actor,
      { kind: "view", objectType: "pathwayVersion", objectId: "pathway-versions" },
      () => store.listPathwayVersions({ actor }),
    );
    if (!pathwayLookup.recorded) {
      return { ok: false, reason: "access-audit-unavailable" };
    }
    if (pathwayLookup.outcome === "failed") {
      return { ok: false, reason: "pathway-lookup-failed" };
    }
    const versions = pathwayLookup.released ?? [];

    let requested: ReturnType<typeof pathwayVersionId> | null = null;
    if (body.pathwayVersionId) {
      const explicit = versions.find((version) => version.id === body.pathwayVersionId && version.state === "approved");
      if (!explicit) {
        return {
          ok: false,
          reason: "Requested pathwayVersionId is missing, unapproved, or retired.",
        };
      }
      requested = pathwayVersionId(explicit.id);
    } else {
      const approved = versions.find((version) => version.state === "approved");
      if (!approved) {
        return {
          ok: false,
          reason: "No approved pathway version is available to accept this intake referral.",
        };
      }
      requested = approved.id;
    }

    const intakePayload = {
      patientIdentifier: referral.patientIdentifier,
      givenName: referral.givenName,
      familyName: referral.familyName,
      mobileNumber: referral.mobileNumber,
      dischargeDate: referral.dischargeDate,
      hospitalFacility: referral.hospitalFacility,
      cohort: referral.cohort,
      admittingWard: referral.admittingWard,
      clinicalSummary: referral.clinicalSummary,
      safetyAlerts: [...referral.safetyAlerts],
    };

    const created = await store.createReferral(
      { referralId: nextReferralId, patientId: nextPatientId, intakePayload },
      writeContextFor(actor, body.idempotencyKey),
    );
    if (!created.ok) return created;

    const accepted = await store.transitionReferral(
      { referralId: nextReferralId, action: { type: "accept", pathwayVersionId: requested } },
      writeContextFor(actor, `${body.idempotencyKey}-accept`),
    );
    if (!accepted.ok) return accepted;

    // Round-trip clinical fields from the store — never return the adapter validation echo as if
    // it were durable. If the store did not keep the payload, refuse rather than lie.
    const storedPayload = await store.getReferralIntakePayload(nextReferralId, { actor });
    if (!storedPayload) {
      return {
        ok: false,
        reason: "Intake clinical payload was not durable after createReferral; refusing success.",
      };
    }

    return {
      ok: true,
      value: {
        referralId: accepted.value.id,
        patientId: accepted.value.patientId,
        state: accepted.value.state,
        pathwayVersionId: accepted.value.pathwayVersionId,
        referral: storedPayload,
      },
    };
  },
});
