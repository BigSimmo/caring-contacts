// src/lib/caring-contacts/transport/simulated.ts
//
// The default transport. It NEVER sends anything to anybody: it records that a send was asked for
// and answers with an outcome, exactly as the twelve-month simulation's transport does
// (../simulation.ts, whose default is "accepted and delivered on the first attempt").
//
// What it records holds the contact reference and the instant only -- never the number or the text
// -- so nothing patient-identifying accumulates in process memory.
import type { MessageTransport, OutboundTextMessage, TextMessageSendResult } from "./types";

export type SimulatedSendRecord = { reference: string; at: Date; outcome: TextMessageSendResult["outcome"] };

export type SimulatedTransport = MessageTransport & {
  readonly kind: "simulated";
  /** Every send asked of this transport, oldest first. */
  readonly records: readonly SimulatedSendRecord[];
};

export function createSimulatedTransport(options?: {
  /** Decide the outcome per message. Defaults to accepted and delivered. */
  outcome?: (message: OutboundTextMessage) => TextMessageSendResult;
  now?: () => Date;
}): SimulatedTransport {
  const records: SimulatedSendRecord[] = [];
  const decide =
    options?.outcome ??
    ((): TextMessageSendResult => ({ outcome: "accepted", providerMessageId: null, status: "delivered" }));
  const now = options?.now ?? (() => new Date());
  return {
    kind: "simulated",
    reachesRealPhones: false,
    records,
    async send(message) {
      const result = decide(message);
      records.push({ reference: message.reference, at: now(), outcome: result.outcome });
      return result;
    },
  };
}
