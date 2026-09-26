// src/lib/caring-contacts/transport/delivery-link.ts
//
// The delivery-receipt address handed to the carrier with each message, and its verification.
//
// WHY THE PROOF RIDES IN THE ADDRESS. The carrier posts its receipt to whatever address it was
// given with the message, and a carrier callback cannot be relied on to carry a signature header of
// our choosing. So each message gets its own address naming the team, plan and contact it belongs
// to (synthetic ids only, never a name or number), plus an HMAC-SHA256 of exactly those three,
// keyed with CARING_CONTACTS_DELIVERY_WEBHOOK_SECRET. A forged or altered receipt cannot name a
// contact it was not issued for, and the secret itself never appears in any address or log.
import { createHmac, timingSafeEqual } from "node:crypto";

export const DELIVERY_WEBHOOK_PATH = "/api/caring-contacts/delivery/webhook";
const MINIMUM_SECRET_LENGTH = 32;
const SIGNATURE_VERSION = "v1";

export type DeliveryReceiptReference = { teamId: string; planId: string; contactId: string };

export function deliveryWebhookSecretIsStrong(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.trim().length >= MINIMUM_SECRET_LENGTH;
}

function signature(reference: DeliveryReceiptReference, secret: string): string {
  return createHmac("sha256", secret)
    .update([SIGNATURE_VERSION, reference.teamId, reference.planId, reference.contactId].join("\n"))
    .digest("base64url");
}

/** The full receipt address for one message. `publicBaseUrl` is this service's own https origin. */
export function buildDeliveryReceiptUrl(
  publicBaseUrl: string,
  reference: DeliveryReceiptReference,
  secret: string,
): string {
  const url = new URL(DELIVERY_WEBHOOK_PATH, publicBaseUrl);
  url.searchParams.set("t", reference.teamId);
  url.searchParams.set("p", reference.planId);
  url.searchParams.set("c", reference.contactId);
  url.searchParams.set("s", signature(reference, secret));
  return url.toString();
}

/** The reference a receipt address names, or null when it is incomplete or its signature is wrong. */
export function verifyDeliveryReceiptParams(params: URLSearchParams, secret: string): DeliveryReceiptReference | null {
  const teamId = params.get("t");
  const planId = params.get("p");
  const contactId = params.get("c");
  const given = params.get("s");
  if (!teamId || !planId || !contactId || !given) return null;
  const reference = { teamId, planId, contactId };
  const expected = Buffer.from(signature(reference, secret));
  const actual = Buffer.from(given);
  if (expected.length !== actual.length) return null;
  return timingSafeEqual(expected, actual) ? reference : null;
}
