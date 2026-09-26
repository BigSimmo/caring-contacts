// src/lib/caring-contacts/transport/types.ts
//
// The one interface every way of sending a caring-contact text message implements.
//
// A transport knows how to hand ONE already-governed message to a carrier and say what happened.
// It decides nothing clinical: what may be sent, to whom and when is decided before it is called
// (see ../sender.ts), and the text it receives has already passed `validateGovernedMessage`.
//
// PRIVACY RULE FOR EVERY IMPLEMENTATION: a transport never logs, throws or returns the phone number
// or the message text. Errors and reasons are short machine-readable codes only.
import type { ProviderStatus } from "../model";

export type OutboundTextMessage = {
  /** Australian mobile number in E.164 form (+614XXXXXXXX). */
  to: string;
  /** The finished, governed message text. */
  body: string;
  /**
   * Our own reference for this send -- the contact id. Synthetic, never patient-identifying. Kept
   * so a simulated transport can say which contact it "sent".
   */
  reference: string;
  /** Where the carrier should post its delivery receipt, or null for none. */
  deliveryReceiptUrl: string | null;
};

/**
 * What happened to one send.
 *
 * - `accepted`: the carrier took the message. `status` is present only when the transport already
 *   knows the final outcome (the simulated transport does; a real carrier reports it later through
 *   the delivery-receipt webhook).
 * - `rejected`: the message definitely did NOT leave (refused request, bad credentials, carrier said
 *   no). Nothing reached the patient.
 * - `unknown`: the message MAY have left (timeout, connection dropped after the request was sent,
 *   an unreadable reply). Never re-sent automatically -- a second caring message is worse than a
 *   missing one -- so it is recorded for a person to check.
 */
export type TextMessageSendResult =
  | { outcome: "accepted"; providerMessageId: string | null; status?: ProviderStatus }
  | { outcome: "rejected"; reason: string }
  | { outcome: "unknown"; reason: string };

export type MessageTransportKind = "simulated" | "telstra";

export interface MessageTransport {
  readonly kind: MessageTransportKind;
  /** True when this transport can reach a real phone. Governs the fictional-contact acknowledgement. */
  readonly reachesRealPhones: boolean;
  send(message: OutboundTextMessage): Promise<TextMessageSendResult>;
}
