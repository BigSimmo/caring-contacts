// src/lib/caring-contacts/transport/delivery-receipts.ts
//
// What a carrier's delivery receipt means for a caring contact.
//
// The status words are Telstra Messaging API v3's message statuses -- queued, sent, delivered,
// expired, undeliverable -- as listed in Telstra's own published v3 SDK (checked 26 September 2026;
// see ./telstra.ts for the sources and what is still uncertain). Only the documented words are
// mapped: any other word is treated as unrecognised, so the contact is left for a person to check
// ("status unavailable") rather than guessed at.
import type { ProviderStatus } from "../model";

/**
 * A final carrier status mapped to this domain's provider status, or null for an interim status
 * (the message is still on its way) or one this build does not recognise. Only final answers are
 * recorded: a contact takes exactly one provider status, so recording "queued" would use up the
 * one slot the real answer needs.
 */
export function providerStatusFromCarrier(status: unknown): ProviderStatus | null {
  if (typeof status !== "string") return null;
  switch (status.trim().toLowerCase()) {
    case "delivered":
      return "delivered";
    case "undeliverable":
    case "expired":
      return "notDelivered";
    default:
      return null;
  }
}
