// src/lib/caring-contacts/transport/inbound.ts
//
// Reads ONE incoming text message out of the body a carrier posts to
// /api/caring-contacts/inbound/webhook, or refuses it. Knows nothing about patients or plans.
//
// NOT CONFIRMED AGAINST TELSTRA. Telstra's developer pages could not be read by the tools used to
// build this (see ./telstra.ts for what WAS confirmed about sending, and how). Nothing about the
// Messaging API v3's INBOUND side was confirmed at all, so this parser is deliberately small and
// tolerant, and every assumption it makes is listed here to be checked against Telstra's own
// documentation -- and with a staff phone -- before any patient's reply depends on it:
//
//   ASSUMED (must be confirmed):
//     * Telstra delivers an incoming SMS to a virtual number by POSTing JSON to a callback address
//       configured for that number (a "reply callback" / "notify URL"), one message per request;
//     * the JSON has the SENDER'S number in `from`, in E.164 (+614...) or national (04...) form;
//     * the words are in `messageContent` (the field Telstra's v3 SEND request uses), or `body`,
//       `content` or `text` -- all four are accepted; if more than one is present they must agree,
//       or the message is refused rather than one of them guessed at;
//     * a message identifier, if any, is in `messageId` (or `id`), and a RETRY of the same message
//       carries the same identifier. The receiver uses it to make a retry land on the same reply;
//       without one, a retried post may create a second reply-to-check (the safe failure);
//     * a long SMS arrives as ONE post with the whole text. If Telstra posts each part of a
//       concatenated message separately (look for `multipart`-style fields), every part will become
//       its own reply-to-check, and a STOP split across parts may not be recognised;
//     * Telstra can be configured to send a fixed secret with the callback -- as a header or in the
//       callback address's query string (`?token=`). If it cannot, and it signs callbacks some
//       other way, the route's authentication must be changed to verify that instead. Nothing was
//       found saying Telstra signs callbacks at all;
//     * the callback comes from Australian infrastructure, like the send API (deployment spec §4.2).
//
//   ALSO TO CONFIRM: what status code Telstra expects (this build answers 200 when the message was
//   taken, 503 to ask for a retry), whether it retries on 5xx and how often, and whether a delivery
//   receipt for OUR automatic reply arrives at this address (it should not: the reply is sent with
//   no receipt address).
//
// Nothing is logged, thrown or echoed from here: the body holds a phone number and a patient's
// words. A refusal is `null`, and the route answers it with a fixed reason code.

export type InboundTextMessage = {
  /** The sender's number exactly as the carrier gave it. The receiver normalises it. */
  from: string;
  /** The words, untrimmed. */
  text: string;
  /** The carrier's own identifier for this message, or null when it gave none. */
  carrierMessageId: string | null;
};

/** The text fields accepted, in the order they are read. `messageContent` is Telstra's v3 send field. */
export const INBOUND_TEXT_FIELDS: readonly string[] = Object.freeze(["messageContent", "body", "content", "text"]);

/** Longer than this is not a phone number in any form, and is refused rather than normalised. */
const MAX_FROM_LENGTH = 32;
/** A carrier message id is an opaque token; anything longer is refused rather than stored in a key. */
const MAX_MESSAGE_ID_LENGTH = 128;

function stringField(record: Record<string, unknown>, name: string): string | undefined {
  if (!Object.hasOwn(record, name)) return undefined;
  const value = record[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * The message a carrier body carries, or null when it is not one this build understands.
 *
 * Refused: anything that is not a JSON object; a missing or over-long `from`; no text field, or
 * text fields that disagree; a present-but-unusable message id. A text that is present but blank
 * is ACCEPTED here -- whether an empty message is worth a reply-to-check is the receiver's
 * decision, not the parser's.
 */
export function parseInboundTextMessage(raw: unknown): InboundTextMessage | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const from = stringField(record, "from")?.trim();
  if (!from || from.length > MAX_FROM_LENGTH) return null;

  const texts = INBOUND_TEXT_FIELDS.map((name) => stringField(record, name)).filter(
    (value): value is string => value !== undefined,
  );
  if (texts.length === 0) return null;
  if (texts.some((value) => value !== texts[0])) return null;

  let carrierMessageId: string | null = null;
  for (const name of ["messageId", "id"]) {
    if (!Object.hasOwn(record, name)) continue;
    const value = record[name];
    if (value === null || value === undefined) continue;
    if (typeof value !== "string" || value.trim() === "" || value.length > MAX_MESSAGE_ID_LENGTH) return null;
    carrierMessageId = value.trim();
    break;
  }

  return { from, text: texts[0], carrierMessageId };
}
