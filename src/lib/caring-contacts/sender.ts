// src/lib/caring-contacts/sender.ts
//
// The scheduled background sender: finds the caring contacts that are due now, renders each
// patient's governed message, hands it to the message transport, and records what happened
// through the store's own dispatch writes.
//
// Like ./simulation.ts, this module holds NO rules of its own. Every decision is read from the
// module that owns it:
//   * whether anything may go out at all -> the service safety stop (`serviceStopBlocksDispatch`);
//   * which contacts may go out           -> the store's `listSendableContacts`, which already
//                                            excludes paused, draft and ended plans, suppressed and
//                                            cancelled contacts;
//   * when                                -> the contact's own `sendAt` plus the first step of the
//                                            governed retry ladder (`DEFAULT_CONTACT_RETRY_POLICY`:
//                                            attempt 1 goes out one minute after `sendAt`), and only
//                                            inside the approved AWST window on the contact's own
//                                            calendar day (`isWithinApprovedSendWindow`) -- a
//                                            contact whose window has closed is recorded missed,
//                                            never sent late;
//   * what text                           -> the plan's pathway version wording, rendered with the
//                                            patient's own preferred name and passed through
//                                            `validateGovernedMessage` (`renderGovernedMessage`).
//
// NO DOUBLE SENDS. The claim is the store's existing `startContactDispatch` transition
// (scheduled -> processing), made with the version this run read and a FRESH idempotency key.
// Both stores make that write atomic against the contact's version (the Postgres store under
// `select ... for update`), so when two runs overlap exactly one claim succeeds and the other is
// refused `stale-version` before it sends anything. The key is fresh on purpose: a replayed key
// returns the ORIGINAL success, which would let two runs both believe they had claimed.
//
// NO AUTOMATIC RE-SENDS. The contact lifecycle has no way back from `processing` to `scheduled`,
// and that is kept: once a send has been attempted, the outcome is recorded (sent, not sent, or
// "status unavailable" when the carrier's answer was ambiguous) and a person reviews anything that
// did not clearly succeed. A missed caring message is recoverable by a phone call; a duplicate one
// to a person after a suicide attempt is not something this service may risk.
//
// NO MADE-UP TEXT. Where the pathway holds no wording for a contact's message type (today the
// demo pathway has none for the first and closing messages), or the patient has no usable
// preferred name or mobile number, nothing is sent and the contact is recorded `missed`, which
// every screen shows as needing review.
//
// PRIVACY. The report this returns and everything it logs carry synthetic ids and reason codes
// only -- never a name, a phone number or message text.
import { randomUUID } from "node:crypto";

import { awstCalendarDay, type Clock } from "./clock";
import { actorId, idempotencyKey, type ContactId, type PathwayVersionId, type PlanId, type TeamId } from "./ids";
import { renderGovernedMessage } from "./message-copy";
import type { ProviderStatus } from "./model";
import type { Actor, SystemActor } from "./permissions";
import type { CaringContactRepository, PlanRecord, StoredContact, WriteContext } from "./repository";
import { calculateRetryDelayMs } from "./retry-queue";
import { isWithinApprovedSendWindow } from "./schedule";
import { DEFAULT_CONTACT_RETRY_POLICY, type ContactRetryPolicy } from "./service-rules";
import { serviceStopBlocksDispatch } from "./service-state";
import type { PathwayVersion } from "./pathway-versions";
import { isDesignatedFictionalMobile, toAustralianMobileE164 } from "./transport/phone";
import type { MessageTransport } from "./transport/types";

export const SENDER_ACTOR_ID = actorId("system-contact-sender");

/**
 * How long after its send time a contact may sit at "sent" with no delivery receipt before it is
 * recorded `statusUnavailable` for a person to check. Only applied with a real carrier; the
 * simulated transport answers at once.
 */
export const DELIVERY_RECEIPT_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/**
 * The two identities the sender acts as, for one team.
 *
 * The WRITER is the existing system dispatcher role, which holds the four dispatch writes and
 * nothing else. The READER is needed because every read in this domain is granted to human roles
 * only (the grant tables are pinned never to overlap), so it carries the coordinator role's read
 * grants under a system id that names the sender. The sender only ever READS with it.
 */
export function senderActorsForTeam(teamId: TeamId): { reader: Actor; dispatcher: SystemActor } {
  return {
    reader: { id: SENDER_ACTOR_ID, teamId, roles: ["coordinator"] },
    dispatcher: { id: SENDER_ACTOR_ID, teamId, systemRole: "contactDispatcher" },
  };
}

export type SenderOutcomeKind =
  /** Carrier accepted it (and, when known, said what happened). */
  | "sent"
  /** Carrier's answer was ambiguous: recorded sent with status unavailable, for review. */
  | "sentStatusUnknown"
  /** Carrier definitely did not take it: recorded missed, for review. */
  | "notSentCarrierRefused"
  /** Nothing sent because nothing sendable could be produced: recorded missed, for review. */
  | "needsReview"
  /** The approved window closed before it could go: recorded missed. */
  | "missedWindowClosed"
  /** Another run claimed it first, or the store refused the claim. Nothing sent by this run. */
  | "notClaimed"
  /** Sent, but the store refused to record it. Needs a person; never re-sent. */
  | "sentButNotRecorded"
  /** No delivery receipt within the timeout: recorded status unavailable. */
  | "receiptTimedOut"
  /** An unexpected error; the contact is left as it was or as far as it got. */
  | "error";

export type SenderContactOutcome = {
  teamId: TeamId;
  planId: PlanId;
  contactId: ContactId;
  sequence: number;
  outcome: SenderOutcomeKind;
  /** A machine-readable reason code. Never patient text. */
  reason?: string;
};

export type SenderRunReport = {
  startedAt: string;
  transport: MessageTransport["kind"];
  serviceStopped: boolean;
  outcomes: SenderContactOutcome[];
};

export type RunContactSenderInput = {
  store: CaringContactRepository;
  transport: MessageTransport;
  clock: Clock;
  teamIds: readonly TeamId[];
  /** The delivery-receipt address for one contact, or null for none. */
  deliveryReceiptUrlFor?: (reference: { teamId: TeamId; planId: PlanId; contactId: ContactId }) => string | null;
  retryPolicy?: ContactRetryPolicy;
};

function write(actor: SystemActor, step: string): WriteContext {
  return { actor, idempotencyKey: idempotencyKey(`sender-${step}-${randomUUID()}`) };
}

/**
 * Whether the contact's approved sending window has closed for good: its own AWST day has passed,
 * or it is that day and past the window's end. Never true for a contact whose day is still ahead.
 */
function windowClosed(stored: StoredContact, now: Date): boolean {
  const today = awstCalendarDay(now);
  if (today > stored.planned.calendarDay) return true;
  return today === stored.planned.calendarDay && now >= stored.planned.sendAt && !isWithinApprovedSendWindow(now);
}

export async function runContactSender(input: RunContactSenderInput): Promise<SenderRunReport> {
  const now = input.clock.now();
  const policy = input.retryPolicy ?? DEFAULT_CONTACT_RETRY_POLICY;
  const dispatchDelayMs = calculateRetryDelayMs(0, policy.backoffMs) ?? 0;
  const report: SenderRunReport = {
    startedAt: now.toISOString(),
    transport: input.transport.kind,
    serviceStopped: false,
    outcomes: [],
  };
  if (input.teamIds.length === 0) return report;

  // The stop is service-wide and readable by any actor. Checked once up front so a stopped service
  // makes no writes at all; the store refuses a dispatch write during a stop as well.
  const firstReader = senderActorsForTeam(input.teamIds[0]).reader;
  if (serviceStopBlocksDispatch(await input.store.getServiceState({ actor: firstReader }))) {
    report.serviceStopped = true;
    return report;
  }

  for (const teamId of input.teamIds) {
    const { reader, dispatcher } = senderActorsForTeam(teamId);
    const pathways = new Map<PathwayVersionId, PathwayVersion | null>();
    const plans = (await input.store.listPlans({ actor: reader })).filter((record) => record.plan.state === "active");

    for (const record of plans) {
      const note = (stored: StoredContact, outcome: SenderOutcomeKind, reason?: string) =>
        report.outcomes.push({
          teamId,
          planId: record.plan.id,
          contactId: stored.contact.id,
          sequence: stored.planned.sequence,
          outcome,
          ...(reason ? { reason } : {}),
        });

      try {
        if (input.transport.reachesRealPhones) {
          await timeOutMissingReceipts(input, record, dispatcher, reader, now, note);
        }

        const sendable = (await input.store.listSendableContacts(record.plan.id, { actor: reader })).sort(
          (a, b) => a.planned.sendAt.getTime() - b.planned.sendAt.getTime(),
        );
        for (const stored of sendable) {
          if (now.getTime() < stored.planned.sendAt.getTime() + dispatchDelayMs) continue;
          try {
            await dispatchOne(input, record, stored, { reader, dispatcher, pathways, now, note });
          } catch (error) {
            note(stored, "error", error instanceof Error ? error.name : "unknown-error");
          }
        }
      } catch (error) {
        report.outcomes.push({
          teamId,
          planId: record.plan.id,
          contactId: "" as ContactId,
          sequence: 0,
          outcome: "error",
          reason: error instanceof Error ? error.name : "unknown-error",
        });
      }
    }
  }
  return report;
}

type DispatchContext = {
  reader: Actor;
  dispatcher: SystemActor;
  pathways: Map<PathwayVersionId, PathwayVersion | null>;
  now: Date;
  note: (stored: StoredContact, outcome: SenderOutcomeKind, reason?: string) => void;
};

async function markMissed(
  input: RunContactSenderInput,
  record: PlanRecord,
  contactId: ContactId,
  expectedContactVersion: number,
  dispatcher: SystemActor,
) {
  return input.store.recordContactMissed(
    { planId: record.plan.id, contactId, expectedContactVersion },
    write(dispatcher, "missed"),
  );
}

async function dispatchOne(
  input: RunContactSenderInput,
  record: PlanRecord,
  stored: StoredContact,
  context: DispatchContext,
): Promise<void> {
  const { reader, dispatcher, pathways, now, note } = context;
  const planId = record.plan.id;
  const contactId = stored.contact.id;

  if (windowClosed(stored, now)) {
    const marked = await markMissed(input, record, contactId, stored.contact.version, dispatcher);
    note(
      stored,
      marked.ok ? "missedWindowClosed" : "notClaimed",
      marked.ok ? "outside-approved-send-window" : marked.reason,
    );
    return;
  }
  if (!isWithinApprovedSendWindow(now)) return;

  const needsReview = async (reason: string) => {
    const marked = await markMissed(input, record, contactId, stored.contact.version, dispatcher);
    note(stored, marked.ok ? "needsReview" : "notClaimed", marked.ok ? reason : marked.reason);
  };

  if (!pathways.has(record.pathwayVersionId)) {
    pathways.set(
      record.pathwayVersionId,
      await input.store.getPathwayVersion(record.pathwayVersionId, { actor: reader }),
    );
  }
  const pathway = pathways.get(record.pathwayVersionId) ?? null;
  if (!pathway) return needsReview("pathway-version-unavailable");

  const episode = await input.store.getEpisode(planId, { actor: reader });
  if (!episode) return needsReview("patient-record-unavailable");

  const to = toAustralianMobileE164(episode.patientMobileNumber);
  if (to === null) return needsReview("mobile-number-not-sendable");
  if (input.transport.reachesRealPhones && isDesignatedFictionalMobile(to)) {
    return needsReview("fictional-recipient");
  }

  const rendered = renderGovernedMessage({
    template: pathway.snapshot.messageTextByType[stored.planned.messageType],
    messageType: stored.planned.messageType,
    preferredName: episode.preferredName,
    planState: record.plan.state,
    contactState: stored.contact.state,
    patientMobileNumber: episode.patientMobileNumber,
    // Only a transport that cannot reach a real phone may accept the prototype's reserved
    // fictional contact numbers in the text. A real carrier never does.
    syntheticFictionalContactsAcknowledged: !input.transport.reachesRealPhones,
  });
  if (!rendered.ok) return needsReview(rendered.issue.code);

  // THE CLAIM. Everything above only read; this is the first write, and only its winner sends.
  const claimed = await input.store.startContactDispatch(
    { planId, contactId, expectedContactVersion: stored.contact.version },
    write(dispatcher, "start"),
  );
  if (!claimed.ok) {
    note(stored, "notClaimed", claimed.reason);
    return;
  }

  const result = await input.transport.send({
    to,
    body: rendered.text,
    reference: contactId,
    deliveryReceiptUrl: input.deliveryReceiptUrlFor?.({ teamId: record.plan.teamId, planId, contactId }) ?? null,
  });

  if (result.outcome === "rejected") {
    const marked = await markMissed(input, record, contactId, claimed.value.contact.version, dispatcher);
    note(stored, marked.ok ? "notSentCarrierRefused" : "error", marked.ok ? result.reason : marked.reason);
    return;
  }

  const sent = await input.store.recordContactSent(
    { planId, contactId, expectedContactVersion: claimed.value.contact.version },
    write(dispatcher, "sent"),
  );
  if (!sent.ok) {
    note(stored, "sentButNotRecorded", sent.reason);
    return;
  }

  const status = result.outcome === "unknown" ? "statusUnavailable" : result.status;
  if (status === undefined) {
    note(stored, "sent");
    return;
  }
  const recorded = await input.store.recordContactProviderStatus(
    { planId, contactId, expectedContactVersion: sent.value.contact.version, status },
    write(dispatcher, "status"),
  );
  if (result.outcome === "unknown") note(stored, "sentStatusUnknown", result.reason);
  else note(stored, "sent", recorded.ok ? undefined : recorded.reason);
}

async function timeOutMissingReceipts(
  input: RunContactSenderInput,
  record: PlanRecord,
  dispatcher: SystemActor,
  reader: Actor,
  now: Date,
  note: DispatchContext["note"],
): Promise<void> {
  const contacts = await input.store.listContacts(record.plan.id, { actor: reader });
  for (const stored of contacts) {
    if (stored.contact.state !== "sent") continue;
    if (now.getTime() - stored.planned.sendAt.getTime() < DELIVERY_RECEIPT_TIMEOUT_MS) continue;
    const recorded = await input.store.recordContactProviderStatus(
      {
        planId: record.plan.id,
        contactId: stored.contact.id,
        expectedContactVersion: stored.contact.version,
        status: "statusUnavailable",
      },
      write(dispatcher, "receipt-timeout"),
    );
    if (recorded.ok) note(stored, "receiptTimedOut", "no-delivery-receipt");
  }
}

export type DeliveryReceiptResult =
  "recorded" | "duplicate" | "interimStatusIgnored" | "alreadyFinal" | "notYetSent" | "unknownContact" | "refused";

/**
 * Records one carrier delivery receipt against the contact its (already verified) address names.
 *
 * Idempotent: the write's idempotency key is derived from the contact and the reported status, so
 * a carrier re-posting the same receipt replays the original answer and records nothing twice; a
 * receipt for a contact that already holds a final status records nothing at all. `notYetSent`
 * means the receipt beat the sender's own "sent" write -- the caller answers so the carrier retries.
 */
export async function recordDeliveryReceipt(input: {
  store: CaringContactRepository;
  teamId: TeamId;
  planId: PlanId;
  contactId: ContactId;
  /** Already mapped by `providerStatusFromCarrier`; null for an interim or unrecognised status. */
  status: ProviderStatus | null;
}): Promise<DeliveryReceiptResult> {
  if (input.status === null) return "interimStatusIgnored";
  const { reader, dispatcher } = senderActorsForTeam(input.teamId);
  const contacts = await input.store.listContacts(input.planId, { actor: reader });
  const stored = contacts.find((candidate) => candidate.contact.id === input.contactId);
  if (!stored) return "unknownContact";
  if (stored.contact.state === input.status) return "duplicate";
  if (stored.contact.state === "processing") return "notYetSent";
  if (stored.contact.state !== "sent") return "alreadyFinal";
  const recorded = await input.store.recordContactProviderStatus(
    {
      planId: input.planId,
      contactId: input.contactId,
      expectedContactVersion: stored.contact.version,
      status: input.status,
    },
    { actor: dispatcher, idempotencyKey: idempotencyKey(`receipt-${input.contactId}-${input.status}`) },
  );
  return recorded.ok ? "recorded" : "refused";
}
