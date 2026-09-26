// src/app/api/caring-contacts/plans/[planId]/mobile-check/route.ts
//
// Checking a plan's mobile number with a one-off test text (see src/lib/caring-contacts/mobile-check.ts).
//
//   { action: "send" }     -> sends MOBILE_CHECK_MESSAGE to the STORED number through the configured
//                             transport, then records "awaiting confirmation". The number comes from
//                             the store, never from the request, and is never logged or echoed. A
//                             failed send records nothing and is refused as `mobile-check-send-failed`.
//   { action: "confirm" }  -> records whether the text arrived ("received" / "notReceived").
//
// Both are gated on `recordHospitalStatusEvent` (coordinator, team lead) and carry `expectedVersion`
// and `idempotencyKey` like every other plan write. Response: `{ value: PlanRecord }`.
import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  auditableIdentifier,
  invalidRequestResponse,
  writeContextFor,
  writeHandler,
} from "@/lib/caring-contacts-server/handler";
import { senderTransport } from "@/lib/caring-contacts-server/contact-sender";
import { isAccessObjectIdShape } from "@/lib/caring-contacts/access-audit";
import { planId, type PlanId } from "@/lib/caring-contacts/ids";
import { MOBILE_CHECK_MESSAGE } from "@/lib/caring-contacts/mobile-check";
import type { TransitionResult } from "@/lib/caring-contacts/model";
import type { Actor } from "@/lib/caring-contacts/permissions";
import {
  REPOSITORY_REFUSALS,
  isTerminalPlan,
  type CaringContactRepository,
  type PlanRecord,
} from "@/lib/caring-contacts/repository";
import { serviceStopBlocksDispatch } from "@/lib/caring-contacts/service-state";
import { isDesignatedFictionalMobile, toAustralianMobileE164 } from "@/lib/caring-contacts/transport/phone";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

type MobileCheckRouteContext = { params: Promise<{ planId: string }> };

const common = { expectedVersion: z.number().int().positive(), idempotencyKey: auditableIdentifier };

const mobileCheckSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send"), ...common }).strict(),
  z.object({ action: z.literal("confirm"), outcome: z.enum(["received", "notReceived"]), ...common }).strict(),
]);

const SEND_FAILED: TransitionResult<never> = { ok: false, reason: REPOSITORY_REFUSALS.mobileCheckSendFailed };

/**
 * Sends the test text, then records it. The send happens BEFORE the write, so the write's own
 * refusals are asked first wherever they can be: a plan that is missing, stale, ended or held by the
 * service-wide stop goes straight to the store -- which answers with its named refusal, or with the
 * original answer when this is a retry of a request already recorded -- and nothing is sent. What
 * remains is a narrow race between the checks and the write; losing it can only send a second,
 * identical test text, never a caring contact.
 *
 * The plan and episode reads below release nothing to the caller, so neither is an access event --
 * the same reasoning the plans route gives for its own parent lookups. The write is audited by the
 * store as usual.
 */
async function sendMobileCheck(
  store: CaringContactRepository,
  actor: Actor,
  input: { planId: PlanId; expectedVersion: number },
  record: () => Promise<TransitionResult<PlanRecord>>,
): Promise<TransitionResult<PlanRecord>> {
  const plan = await store.getPlan(input.planId, { actor });
  if (!plan || plan.plan.version !== input.expectedVersion || isTerminalPlan(plan.plan.state)) return record();
  if (serviceStopBlocksDispatch(await store.getServiceState({ actor }))) return record();

  const episode = await store.getEpisode(input.planId, { actor });
  if (!episode) return { ok: false, reason: REPOSITORY_REFUSALS.notFound };
  const to = toAustralianMobileE164(episode.patientMobileNumber);
  if (to === null) return { ok: false, reason: REPOSITORY_REFUSALS.patientMobileInvalid };

  let transport;
  try {
    transport = senderTransport().transport;
  } catch (error) {
    logger.error("Caring Contacts number check could not start a transport", {
      errorName: error instanceof Error ? error.name : "unknown-error",
    });
    return SEND_FAILED;
  }
  // A real carrier never texts one of the prototype's reserved fictional numbers.
  if (transport.reachesRealPhones && isDesignatedFictionalMobile(to)) return SEND_FAILED;

  const sent = await transport.send({
    to,
    body: MOBILE_CHECK_MESSAGE,
    reference: `mobile-check-${input.planId}`,
    deliveryReceiptUrl: null,
  });
  // "unknown" is treated as a failure too: nothing is recorded, and the staff member can send again.
  // A second test text is harmless; recording one that may never have left is not.
  if (sent.outcome !== "accepted") {
    logger.info("Caring Contacts number check not sent", { transport: transport.kind, outcome: sent.outcome });
    return SEND_FAILED;
  }
  return record();
}

export async function POST(request: NextRequest, context: MobileCheckRouteContext): Promise<Response> {
  const { planId: id } = await context.params;
  if (!isAccessObjectIdShape(id)) return invalidRequestResponse();
  return writeHandler({
    schema: mobileCheckSchema,
    action: "recordHospitalStatusEvent",
    access: { objectType: "plan", objectId: () => id },
    write: async (store, actor, body) => {
      const write = writeContextFor(actor, body.idempotencyKey);
      const input = { planId: planId(id), expectedVersion: body.expectedVersion };
      if (body.action === "confirm") return store.resolveMobileCheck({ ...input, outcome: body.outcome }, write);
      return sendMobileCheck(store, actor, input, () => store.recordMobileCheckSent(input, write));
    },
  })(request);
}
