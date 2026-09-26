// src/app/api/caring-contacts/inbound-replies/[replyId]/route.ts
//
// POST: mark one "reply to check" as followed up -- the person who read what the patient texted
// back, and did whatever the reply needed, saying so. Incoming text messages, 2026-09-26.
//
// Next 16: `params` is a Promise and must be awaited. The reply id is a synthetic identifier
// (`reply-...`), never a number or the words, and is held to both its own grammar and the audit
// trail's before it goes anywhere near the trail.
//
// WHAT THIS DOES NOT DO. It does not resume, withdraw or change the plan. An opt-out paused the
// plan; what happens next (resume, withdraw, change the pathway) is a clinical decision the person
// takes on the plan's own screen, through the plan's own audited writes. Marking the reply followed
// up only takes it off the Today screen's list. It is refused a second time
// (`inbound-reply-already-followed-up`), and `expectedVersion` stops two people's clicks racing.
import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  auditableIdentifier,
  invalidRequestResponse,
  writeContextFor,
  writeHandler,
} from "@/lib/caring-contacts-server/handler";
import { planId } from "@/lib/caring-contacts/ids";
import { isInboundReplyId, type InboundReplyRecord } from "@/lib/caring-contacts/inbound-replies";

export const runtime = "nodejs";

const followUpSchema = z
  .object({
    planId: auditableIdentifier,
    expectedVersion: z.number().int().positive(),
    idempotencyKey: auditableIdentifier,
  })
  .strict();

type ReplyRouteContext = { params: Promise<{ replyId: string }> };

export async function POST(request: NextRequest, context: ReplyRouteContext): Promise<Response> {
  const { replyId } = await context.params;
  if (!isInboundReplyId(replyId)) return invalidRequestResponse();

  return writeHandler<z.infer<typeof followUpSchema>, InboundReplyRecord>({
    schema: followUpSchema,
    action: "followUpInboundReply",
    access: { objectType: "inboundReply", objectId: () => replyId },
    write: (store, actor, body) =>
      store.markInboundReplyFollowedUp(
        { planId: planId(body.planId), replyId, expectedVersion: body.expectedVersion },
        writeContextFor(actor, body.idempotencyKey),
      ),
  })(request);
}
