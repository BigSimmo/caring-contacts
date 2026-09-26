// src/app/api/caring-contacts/dispatch-run/route.ts
//
// POST: run the scheduled sender once. Called by an external scheduler (cron, a cloud scheduler)
// or by `npm run sender`, never by a browser. Protected by CARING_CONTACTS_SENDER_SECRET as a
// bearer token; with no secret configured the route answers 404, so it does not exist until the
// owner switches it on.
//
// Safe to call twice or at the same time: the sender's claim is the store's own dispatch-start
// transition, so each contact goes out at most once however many runs overlap.
//
// A body of { "mode": "connectionTest", "to": "04xx xxx xxx" } sends ONE fixed staff test message
// (CONNECTION_TEST_MESSAGE) to that number and records nothing in the store -- the owner's
// "test with a staff phone first" step. The number is never logged or echoed back.
//
// The response holds synthetic ids and reason codes only.
import { z } from "zod";

import {
  authoriseSchedulerRequest,
  CONNECTION_TEST_MESSAGE,
  deliveryReceiptUrlBuilder,
  senderTeamIds,
  senderTransport,
} from "@/lib/caring-contacts-server/contact-sender";
import { caringContactsStore } from "@/lib/caring-contacts-server/store";
import { isCaringContactsWorkspaceEnabled } from "@/lib/caring-contacts-server/workspace-gate";
import { systemClock } from "@/lib/caring-contacts/clock";
import { runContactSender } from "@/lib/caring-contacts/sender";
import { toAustralianMobileE164 } from "@/lib/caring-contacts/transport/phone";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.union([
  z.object({ mode: z.literal("run") }).strict(),
  z.object({ mode: z.literal("connectionTest"), to: z.string().min(1).max(32) }).strict(),
]);

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  if (!isCaringContactsWorkspaceEnabled()) return json({ refusal: "not-found" }, 404);
  const authorisation = authoriseSchedulerRequest(request.headers);
  if (authorisation === "notConfigured") return json({ refusal: "not-found" }, 404);
  if (authorisation === "refused") return json({ refusal: "unauthorised" }, 401);

  const raw = await request.text();
  let parsed: z.infer<typeof bodySchema>;
  try {
    const candidate = bodySchema.safeParse(raw.trim() === "" ? { mode: "run" } : JSON.parse(raw));
    if (!candidate.success) return json({ refusal: "invalid-request" }, 400);
    parsed = candidate.data;
  } catch {
    return json({ refusal: "invalid-request" }, 400);
  }

  let resolved;
  try {
    resolved = senderTransport();
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown-error";
    logger.error("Caring Contacts sender refused to start", { errorName: name });
    return json({ refusal: "sender-misconfigured", error: name }, 503);
  }

  if (parsed.mode === "connectionTest") {
    const to = toAustralianMobileE164(parsed.to);
    if (to === null) return json({ refusal: "not-an-australian-mobile" }, 400);
    const result = await resolved.transport.send({
      to,
      body: CONNECTION_TEST_MESSAGE,
      reference: "connection-test",
      deliveryReceiptUrl: null,
    });
    logger.info("Caring Contacts connection test", { transport: resolved.transport.kind, outcome: result.outcome });
    return json(
      {
        transport: resolved.transport.kind,
        outcome: result.outcome,
        ...(result.outcome === "accepted" ? {} : { reason: result.reason }),
      },
      200,
    );
  }

  const report = await runContactSender({
    store: await caringContactsStore(),
    transport: resolved.transport,
    clock: systemClock(),
    teamIds: senderTeamIds(),
    deliveryReceiptUrlFor: deliveryReceiptUrlBuilder(resolved),
  });
  const counts: Record<string, number> = {};
  for (const outcome of report.outcomes) counts[outcome.outcome] = (counts[outcome.outcome] ?? 0) + 1;
  logger.info("Caring Contacts sender run", {
    transport: report.transport,
    serviceStopped: report.serviceStopped,
    counts,
  });
  return json({ ...report, counts }, 200);
}
