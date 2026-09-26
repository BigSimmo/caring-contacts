// src/app/api/caring-contacts/plans/route.ts
//
// The plan collection. GET lists the plans this actor's team may see; POST creates one.
//
// Neither method records an access event of its own -- `readHandler` does that, on every call, for
// every read. A route that could forget the call is exactly the failure this boundary removes.
import { z } from "zod";

import {
  auditableIdentifier,
  isoInstant,
  readHandler,
  writeContextFor,
  writeHandler,
} from "@/lib/caring-contacts-server/handler";
import { PLAN_ASSURANCE_VALUES, PLAN_ASSURANCES } from "@/lib/caring-contacts/assurances";
import { systemClock } from "@/lib/caring-contacts/clock";
import { isDischargeDayWithinAcceptedWindow } from "@/lib/caring-contacts/discharge-window";
import { pathwayVersionId, patientId, planId, referralId } from "@/lib/caring-contacts/ids";
import { validateAustralianMobile } from "@/lib/caring-contacts/referral";
import { REPOSITORY_REFUSALS } from "@/lib/caring-contacts/repository";

export const runtime = "nodejs";

/** A collection read names no single object; the actor's own team scopes what it returns. */
const COLLECTION = "all";

/**
 * Non-blank after trimming. `min(1)` alone let "   " through to the store, which throws on a blank
 * patient name -- so a whitespace-only name surfaced as a 500 rather than as the bad request it is.
 */
const nonBlankText = z.string().refine((value) => value.trim() !== "", { message: "must not be blank" });

// The patient's name and mobile number travel in the BODY, never in the URL -- a query string is
// logged by every proxy between here and the browser.
const createPlanSchema = z
  .object({
    planId: auditableIdentifier,
    referralId: auditableIdentifier,
    patientId: auditableIdentifier,
    pathwayVersionId: auditableIdentifier,
    dischargeAt: isoInstant,
    sendingPreference: z.enum(["morning", "afternoon", "earlyEvening"]),
    firstContactDate: z.string().min(1).optional(),
    firstContactReason: z.string().min(1).optional(),
    patientDetail: z
      .object({
        patientName: nonBlankText,
        // The same Australian-mobile rule manual intake applies, so a plan cannot be created
        // against "123" or a landline that intake itself would have refused.
        patientMobileNumber: z
          .string()
          .max(32)
          .refine((value) => validateAustralianMobile(value).ok, { message: "must be an Australian mobile number" }),
        patientIdentifiers: z.array(z.string().min(1)),
        culturalIdentity: z.string().min(1).nullable(),
        /**
         * What the patient asked to be called in the messages they receive. ASKED FOR by the
         * clinician, never derived from `patientName` -- see `Episode.preferredName`.
         *
         * `min(1)` because `""` is what a RETENTION CLEARANCE writes, and the clearance must stay
         * the only thing that can write it: a request carrying `""` would create a plan already
         * shaped like a de-identified one. `nullable` because a caller may legitimately hold no
         * preferred name -- the same fact every plan created before the column existed carries --
         * and the message resolver then refuses BY NAME rather than sending an unpersonalised
         * greeting nobody has authored.
         */
        preferredName: z.string().min(1).nullable(),
      })
      .strict(),
    /**
     * What the coordinator attests to having confirmed. The enum is built FROM `PLAN_ASSURANCES`
     * rather than restated here, so the wire vocabulary, the screen and the database check
     * constraint cannot drift apart.
     *
     * EVERY assurance is required, exactly as the wizard requires every checkbox before it will
     * submit. This is the schema half of the domain's `plan-assurances-required` refusal, not a
     * replacement for it: a body that reaches `createPlan` another way is still refused there, by
     * name. Only the assurances travel -- who attested and when are stamped by the store from the
     * session and the domain clock, so a request cannot claim someone else made the check.
     */
    assurances: z
      .array(z.enum(PLAN_ASSURANCES))
      .refine((given) => PLAN_ASSURANCE_VALUES.every((required) => given.includes(required)), {
        message: "every assurance the coordinator confirms on screen is required",
      }),
    idempotencyKey: auditableIdentifier,
  })
  .strict();

export const GET = readHandler({
  access: { kind: "search", objectType: "plan", objectId: () => COLLECTION },
  read: async (store, actor) => store.listPlans({ actor }),
});

export const POST = writeHandler({
  schema: createPlanSchema,
  action: "claimPlan",
  access: { objectType: "plan", objectId: (body) => body.planId },
  write: async (store, actor, body) => {
    // A discharge more than 90 days ago would create a plan whose first contacts are already
    // overdue; one in the future would message someone still in hospital. Refused by name.
    if (!isDischargeDayWithinAcceptedWindow(new Date(body.dischargeAt), systemClock().now())) {
      return { ok: false, reason: "discharge-out-of-range" };
    }

    // THE PARENTS ARE CHECKED HERE, AT THE BOUNDARY, BECAUSE NOTHING ELSE CHECKED THEM. The wizard
    // page offers only accepted referrals and approved versions, but that is a statement about the
    // screen as it was rendered: a referral declined, or a version retired for an urgent safety
    // reason, while a wizard sat open in another tab still reached `createPlan`, which trusts both
    // ids. So did a direct request. A plan is a year of messages to one person, so it is refused
    // unless the referral is this team's, accepted, and for this patient, and the version is
    // approved. Neither lookup releases anything to the caller, so neither is an access event --
    // the same reasoning `contacts/[contactId]/route.ts` gives for its own lookup -- and the write
    // that follows is audited by the store as usual.
    //
    // A narrow race remains between these reads and the store's write; closing it needs the same
    // checks inside both stores' transactions (reported, not done here).
    const referral = (await store.listReferrals({ actor })).find((candidate) => candidate.id === body.referralId);
    if (!referral) return { ok: false, reason: REPOSITORY_REFUSALS.notFound };
    if (referral.state !== "accepted") return { ok: false, reason: "referral-not-accepted" };
    if (referral.patientId !== body.patientId) return { ok: false, reason: "referral-patient-mismatch" };
    const version = await store.getPathwayVersion(pathwayVersionId(body.pathwayVersionId), { actor });
    if (!version || version.state !== "approved") return { ok: false, reason: "pathway-version-not-approved" };

    return store.createPlan(
      {
        planId: planId(body.planId),
        referralId: referralId(body.referralId),
        patientId: patientId(body.patientId),
        pathwayVersionId: pathwayVersionId(body.pathwayVersionId),
        dischargeAt: new Date(body.dischargeAt),
        sendingPreference: body.sendingPreference,
        firstContactDate: body.firstContactDate,
        firstContactReason: body.firstContactReason,
        patientDetail: body.patientDetail,
        assurances: body.assurances,
      },
      writeContextFor(actor, body.idempotencyKey),
    );
  },
});
