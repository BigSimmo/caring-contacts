// src/app/api/caring-contacts/inbound/webhook/route.ts
//
// POST: one incoming text message from the carrier -- a reply to this service's number. Before
// this route existed, a reply went nowhere at all ("incoming texts vanish", owner, 2026-09-26).
// Now, in this order (../../../../../lib/caring-contacts/inbound-receiver.ts):
//   1. a reply from a number held on a patient's plan becomes a "reply to check" on that plan, for
//      a person, with the words kept where only the roles that may read the patient's record can
//      read them; an opt-out (STOP and the other keywords) also PAUSES an active plan -- never
//      withdraws or cancels it -- for a person to decide what happens next;
//   2. whoever sent it, known or not, gets the one fixed automatic reply naming the crisis lines
//      (`INBOUND_AUTO_REPLY_MESSAGE`), at most once per number per day, through the configured
//      message transport.
//
// House style for a carrier callback, as ../../delivery/webhook/route.ts:
//   * 404 unless the workspace is enabled AND a strong CARING_CONTACTS_INBOUND_WEBHOOK_SECRET is
//     configured, so the route does not exist until the owner switches it on;
//   * 401 for a missing or wrong secret, compared in constant time (../../../../../lib/
//     caring-contacts-server/inbound-webhook.ts), recording and sending nothing;
//   * a hard body-size limit, read incrementally so an oversized body is never held whole;
//   * NOTHING FROM THE BODY IS LOGGED, ECHOED OR PUT IN AN ERROR. The body holds a phone number and
//     a person's words. The log line carries the message kind, counts and reason codes only, and
//     the response carries a fixed result word.
//
// Answers 200 once the message has been taken (including when nothing matched), 400 for a body
// that is not a message this build understands, and 503 when a store write threw, so the carrier
// retries. A retry is safe: a carrier message id makes it replay the same reply-to-check, and the
// loop guard stops a second automatic reply.
import { authoriseInboundWebhookRequest } from "@/lib/caring-contacts-server/inbound-webhook";
import { senderTeamIds, senderTransport } from "@/lib/caring-contacts-server/contact-sender";
import { caringContactsStore } from "@/lib/caring-contacts-server/store";
import { isCaringContactsWorkspaceEnabled } from "@/lib/caring-contacts-server/workspace-gate";
import { inboundSenderKey } from "@/lib/caring-contacts/inbound-replies";
import { receiveInboundTextMessage } from "@/lib/caring-contacts/inbound-receiver";
import { parseInboundTextMessage } from "@/lib/caring-contacts/transport/inbound";
import { toAustralianMobileE164 } from "@/lib/caring-contacts/transport/phone";
import type { MessageTransport } from "@/lib/caring-contacts/transport/types";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** An SMS is at most a few kilobytes of JSON. Anything larger is not a message. */
const INBOUND_WEBHOOK_MAX_BODY_BYTES = 16 * 1024;

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** The body as text, or null when it is larger than the limit. Stops reading at the limit. */
async function readLimitedBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > INBOUND_WEBHOOK_MAX_BODY_BYTES) return null;
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > INBOUND_WEBHOOK_MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function POST(request: Request): Promise<Response> {
  if (!isCaringContactsWorkspaceEnabled()) return json({ refusal: "not-found" }, 404);
  const authorisation = authoriseInboundWebhookRequest(request);
  if (authorisation.outcome === "notConfigured") return json({ refusal: "not-found" }, 404);
  if (authorisation.outcome === "refused") return json({ refusal: "unauthorised" }, 401);

  const raw = await readLimitedBody(request);
  if (raw === null) return json({ refusal: "invalid-request" }, 413);
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(raw);
  } catch {
    return json({ refusal: "invalid-request" }, 400);
  }
  const message = parseInboundTextMessage(parsedBody);
  if (message === null) return json({ refusal: "invalid-request" }, 400);

  const from = toAustralianMobileE164(message.from);
  if (from === null) {
    // Answered 200 so the carrier does not retry something that will never be matched or answered.
    logger.info("Caring Contacts inbound text", { result: "ignored", reason: "not-an-australian-mobile" });
    return json({ result: "ignored" }, 200);
  }

  let transport: MessageTransport | null = null;
  try {
    transport = senderTransport().transport;
  } catch (error) {
    // The reply is still filed for a person; only the automatic reply is lost. Named, not detailed.
    logger.error("Caring Contacts inbound text: no transport for the automatic reply", {
      errorName: error instanceof Error ? error.name : "unknown-error",
    });
  }

  const report = await receiveInboundTextMessage({
    store: await caringContactsStore(),
    transport,
    teamIds: senderTeamIds(),
    message: { ...message, from },
    senderKey: inboundSenderKey(from, authorisation.secret),
  });
  logger.info("Caring Contacts inbound text", {
    kind: report.kind,
    recorded: report.recorded,
    plansPaused: report.plansPaused,
    recordingFailed: report.recordingFailed,
    failures: report.failures,
    autoReply: report.autoReply,
    ...(report.autoReplyReason ? { autoReplyReason: report.autoReplyReason } : {}),
  });
  if (report.recordingFailed) return json({ result: "retry" }, 503);
  return json({ result: "received" }, 200);
}
