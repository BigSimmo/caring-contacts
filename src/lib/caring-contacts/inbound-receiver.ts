// src/lib/caring-contacts/inbound-receiver.ts
//
// What happens when a text message arrives: file it for a person on every matching plan (pausing
// an active plan when it is an opt-out), then send the one automatic safety reply the loop guard
// allows. The route (/api/caring-contacts/inbound/webhook) authenticates and parses; the rules are
// ./inbound-replies'; this module holds no rule of its own, like ./sender.ts.
//
// ORDER IS DELIBERATE. Recording comes first because it is the durable half: a reply-to-check that
// exists will be seen by a person, and an opt-out that has paused the plan stops the next caring
// message. The automatic reply is attempted whether or not recording succeeded -- a failed store
// write is no reason to leave a person who may be in crisis without the crisis numbers -- and the
// loop guard makes a carrier's retry of the same message cost no second reply.
//
// PRIVACY. The report carries counts, a kind and reason codes. Never the number, the words, a
// plan id or a patient id: it is logged by the route, and how many of this team's plans matched a
// number is not something a log line may say about a person.
import { idempotencyKey, type TeamId } from "./ids";
import {
  admitInboundReplyText,
  choosePlansForInboundReply,
  classifyInboundReply,
  inboundReplyActorsForTeam,
  inboundReplyIdFor,
  INBOUND_AUTO_REPLY_WINDOW_MS,
  type InboundReplyKind,
} from "./inbound-replies";
import { INBOUND_AUTO_REPLY_MESSAGE } from "./message-copy";
import type { CaringContactRepository } from "./repository";
import type { InboundTextMessage } from "./transport/inbound";
import { isDesignatedFictionalMobile, toAustralianMobileE164 } from "./transport/phone";
import type { MessageTransport } from "./transport/types";

export type InboundAutoReplyOutcome =
  /** The transport took it (or, for the simulated transport, "sent" it). */
  | "sent"
  /** This number was answered within the window: nothing sent (the loop guard). */
  | "rateLimited"
  /** Not sent; `autoReplyReason` says why. */
  | "notSent";

export type InboundReceiptReport = {
  kind: InboundReplyKind | null;
  /** Reply-to-check items this message produced (a replay of an earlier one counts). */
  recorded: number;
  /** Plans this message paused. */
  plansPaused: number;
  /**
   * True when a store call THREW, so a matching plan may not have been filed -- the route asks the
   * carrier to retry, and the retry replays whatever did succeed.
   */
  recordingFailed: boolean;
  /** Reason codes for anything that went wrong. Never patient content. */
  failures: string[];
  autoReply: InboundAutoReplyOutcome;
  autoReplyReason?: string;
};

export type ReceiveInboundTextMessageInput = {
  store: CaringContactRepository;
  /** Null when no transport could be built (misconfigured real sending): nothing is sent. */
  transport: MessageTransport | null;
  /** The teams whose plans a number is matched against -- the sender's own list. */
  teamIds: readonly TeamId[];
  message: InboundTextMessage;
  /** `inboundSenderKey(number, secret)`, computed by the route, which holds the secret. */
  senderKey: string;
  windowMs?: number;
};

export async function receiveInboundTextMessage(input: ReceiveInboundTextMessageInput): Promise<InboundReceiptReport> {
  const report: InboundReceiptReport = {
    kind: null,
    recorded: 0,
    plansPaused: 0,
    recordingFailed: false,
    failures: [],
    autoReply: "notSent",
  };

  const from = toAustralianMobileE164(input.message.from);
  if (from === null) {
    // Not an Australian mobile: nothing can be matched to it, and this service replies only to
    // Australian mobiles through an Australian carrier (deployment spec §4.2).
    report.autoReplyReason = "not-an-australian-mobile";
    return report;
  }

  const text = admitInboundReplyText(input.message.text);
  if (text !== null) {
    const kind = classifyInboundReply(text);
    report.kind = kind;
    for (const team of input.teamIds) {
      const { reader, recorder } = inboundReplyActorsForTeam(team);
      try {
        const matches = choosePlansForInboundReply(
          await input.store.findPlansForInboundNumber(from, { actor: reader }),
        );
        for (const match of matches) {
          const replyId = inboundReplyIdFor(match.planId, input.message.carrierMessageId);
          const recorded = await input.store.recordInboundReply(
            { planId: match.planId, replyId, text, kind },
            { actor: recorder, idempotencyKey: idempotencyKey(`inbound-${replyId}`) },
          );
          if (recorded.ok) {
            report.recorded += 1;
            if (recorded.value.planPaused) report.plansPaused += 1;
          } else {
            // A named refusal is an answer, not a fault: asking the carrier to retry would only
            // replay it. Only a THROWN write (below) asks for a retry.
            report.failures.push(recorded.reason);
          }
        }
      } catch (error) {
        report.recordingFailed = true;
        report.failures.push(error instanceof Error ? error.name : "unknown-error");
      }
    }
  } else {
    report.failures.push("blank-message");
  }

  if (input.transport === null) {
    report.autoReplyReason = "transport-unavailable";
    return report;
  }
  if (input.transport.reachesRealPhones && isDesignatedFictionalMobile(from)) {
    // The same rule the sender keeps: a real carrier never texts this prototype's invented numbers.
    report.autoReplyReason = "fictional-recipient";
    return report;
  }

  let claimed: boolean;
  try {
    claimed = await input.store.claimInboundAutoReply({
      senderKey: input.senderKey,
      windowMs: input.windowMs ?? INBOUND_AUTO_REPLY_WINDOW_MS,
    });
  } catch (error) {
    // Without the guard there is no proof this is not a loop with another automatic responder, so
    // nothing is sent. The patient's reply is already filed for a person, and every caring
    // message already carries the crisis numbers.
    report.autoReplyReason = error instanceof Error ? `loop-guard-unavailable:${error.name}` : "loop-guard-unavailable";
    return report;
  }
  if (!claimed) {
    report.autoReply = "rateLimited";
    return report;
  }

  try {
    const sent = await input.transport.send({
      to: from,
      body: INBOUND_AUTO_REPLY_MESSAGE,
      reference: "inbound-auto-reply",
      deliveryReceiptUrl: null,
    });
    if (sent.outcome === "rejected") {
      report.autoReplyReason = sent.reason;
    } else {
      // `unknown` may have reached the phone; it is never re-sent, exactly as the sender never
      // re-sends. The window is already claimed, so a retry of this message will not try again.
      report.autoReply = "sent";
      if (sent.outcome === "unknown") report.autoReplyReason = sent.reason;
    }
  } catch (error) {
    report.autoReplyReason = error instanceof Error ? error.name : "unknown-error";
  }
  return report;
}
