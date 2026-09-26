// src/lib/caring-contacts/alerts/sender-run-alerts.ts
//
// Which staff alerts one sender run raises. Pure: reads the run's report, returns alerts. The
// report already holds only synthetic ids and reason codes; the alerts hold less -- a class, a
// count, a fixed reason and a team id. No contact, plan or carrier reason code travels on.
//
// HOW EACH SENDER OUTCOME IS CLASSED, and why:
//
//   permanentDeliveryFailure -- the person did NOT get this caring message, and nothing will send
//   it (no automatic re-sends, by design). A person needs to decide whether to phone instead.
//     * notSentCarrierRefused  the carrier definitely refused it          (messages-not-sent)
//     * needsReview            nothing sendable could be produced         (messages-not-sent)
//     * missedWindowClosed     the approved window closed before it went  (sending-window-missed)
//       -- the outcome a sender outage produces, which is exactly what the owner asked to hear about.
//
//   exceptionBacklog -- something may or may not have reached the person, or the record is not
//   right, and a person must check before anything else is done. Never re-sent automatically.
//     * sentStatusUnknown      the carrier's answer was ambiguous          (outcome-needs-checking)
//     * sentButNotRecorded     sent, but the store refused to record it    (outcome-needs-checking)
//     * receiptTimedOut        no delivery report within the timeout       (outcome-needs-checking)
//     * error                  an unexpected fault, contact left mid-way   (outcome-needs-checking)
//
//   not alerted:
//     * sent                   it worked;
//     * notClaimed             another run took it, or the store refused the claim before anything
//                              was sent -- that contact is still someone else's or still scheduled.
//
//   carrierRateLimited (OPERATIONAL, always delivered, service-wide) -- any send refused with
//   `carrier-rate-limited`. That contact is ALSO counted as a permanent delivery failure above: the
//   two alerts answer different questions ("a person missed a message" vs "the carrier is
//   throttling the whole service") and go to people who may have opted in differently.
//
// One alert per class per team per run, carrying the total count. The reason is given when every
// counted outcome shares it and left off when they are mixed, rather than picking one to show.
import type { TeamId } from "../ids";
import type { AlertClass } from "../notification-preferences";
import type { SenderOutcomeKind, SenderRunReport } from "../sender";
import { CARRIER_RATE_LIMITED_REASON } from "../transport/telstra";

import { staffAlert, type StaffAlert, type StaffAlertReason } from "./staff-alert";

const OUTCOME_ALERTS: Partial<Record<SenderOutcomeKind, { alertClass: AlertClass; reason: StaffAlertReason }>> = {
  notSentCarrierRefused: { alertClass: "permanentDeliveryFailure", reason: "messages-not-sent" },
  needsReview: { alertClass: "permanentDeliveryFailure", reason: "messages-not-sent" },
  missedWindowClosed: { alertClass: "permanentDeliveryFailure", reason: "sending-window-missed" },
  sentStatusUnknown: { alertClass: "exceptionBacklog", reason: "outcome-needs-checking" },
  sentButNotRecorded: { alertClass: "exceptionBacklog", reason: "outcome-needs-checking" },
  receiptTimedOut: { alertClass: "exceptionBacklog", reason: "outcome-needs-checking" },
  error: { alertClass: "exceptionBacklog", reason: "outcome-needs-checking" },
};

export function alertsFromSenderRun(report: SenderRunReport): StaffAlert[] {
  const tallies = new Map<
    string,
    { teamId: TeamId; alertClass: AlertClass; count: number; reasons: Set<StaffAlertReason> }
  >();
  let rateLimited = 0;

  for (const outcome of report.outcomes) {
    if (outcome.reason === CARRIER_RATE_LIMITED_REASON) rateLimited += 1;
    if (!Object.hasOwn(OUTCOME_ALERTS, outcome.outcome)) continue;
    const mapped = OUTCOME_ALERTS[outcome.outcome];
    if (!mapped) continue;
    const key = `${outcome.teamId}::${mapped.alertClass}`;
    const tally = tallies.get(key) ?? {
      teamId: outcome.teamId,
      alertClass: mapped.alertClass,
      count: 0,
      reasons: new Set<StaffAlertReason>(),
    };
    tally.count += 1;
    tally.reasons.add(mapped.reason);
    tallies.set(key, tally);
  }

  const alerts: StaffAlert[] = [];
  if (rateLimited > 0 || report.carrierRateLimited) {
    alerts.push(
      staffAlert({ alertClass: "carrierRateLimited", count: Math.max(rateLimited, 1), reason: "carrier-rate-limited" }),
    );
  }
  for (const tally of tallies.values()) {
    alerts.push(
      staffAlert({
        alertClass: tally.alertClass,
        count: tally.count,
        reason: tally.reasons.size === 1 ? [...tally.reasons][0] : null,
        teamId: tally.teamId,
      }),
    );
  }
  return alerts;
}
