// src/app/api/caring-contacts/delivery/webhook/route.ts
//
// POST: the carrier's delivery receipt (DLR) for one caring-contact message -- the endpoint the
// sovereign deployment spec names (§4.2). Each message was sent with its own receipt address
// carrying an HMAC signature of the team, plan and contact it belongs to
// (../../../../../lib/caring-contacts/transport/delivery-link.ts). A receipt whose signature does
// not verify is refused 401 and records nothing.
//
// Idempotent: a repeated receipt changes nothing and still answers 200, so a carrier that retries
// does not raise false alarms. A receipt that arrives before the sender has recorded the message as
// sent answers 409 so the carrier tries again shortly.
//
// Nothing from the body is logged or echoed: a carrier receipt can carry the phone number.
import { caringContactsStore } from "@/lib/caring-contacts-server/store";
import { isCaringContactsWorkspaceEnabled } from "@/lib/caring-contacts-server/workspace-gate";
import { contactId, planId, teamId } from "@/lib/caring-contacts/ids";
import { recordDeliveryReceipt } from "@/lib/caring-contacts/sender";
import {
  deliveryWebhookSecretIsStrong,
  verifyDeliveryReceiptParams,
} from "@/lib/caring-contacts/transport/delivery-link";
import { providerStatusFromCarrier } from "@/lib/caring-contacts/transport/delivery-receipts";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  if (!isCaringContactsWorkspaceEnabled()) return json({ refusal: "not-found" }, 404);
  const secret = process.env.CARING_CONTACTS_DELIVERY_WEBHOOK_SECRET?.trim();
  if (!deliveryWebhookSecretIsStrong(secret)) return json({ refusal: "not-found" }, 404);

  const reference = verifyDeliveryReceiptParams(new URL(request.url).searchParams, secret);
  if (!reference) return json({ refusal: "unauthorised" }, 401);

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ refusal: "invalid-request" }, 413);
  let status: unknown;
  try {
    status = (JSON.parse(raw) as { status?: unknown } | null)?.status;
  } catch {
    return json({ refusal: "invalid-request" }, 400);
  }

  const result = await recordDeliveryReceipt({
    store: await caringContactsStore(),
    teamId: teamId(reference.teamId),
    planId: planId(reference.planId),
    contactId: contactId(reference.contactId),
    status: providerStatusFromCarrier(status),
  });
  logger.info("Caring Contacts delivery receipt", { result });
  if (result === "notYetSent") return json({ result }, 409);
  // The store refused the write (for example during a service safety stop): ask the carrier to retry.
  if (result === "refused") return json({ result }, 503);
  return json({ result }, 200);
}
