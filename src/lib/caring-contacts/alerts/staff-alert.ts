// src/lib/caring-contacts/alerts/staff-alert.ts
//
// What a staff alert IS: an alert class, a count, an optional fixed reason code, and (for a
// team's own alert) the synthetic team id. Nothing else can be put in one.
//
// PRIVACY, BY CONSTRUCTION. The spec (§4.2) requires alerts to carry no patient identifiers. The
// type below has no field that could hold a name, a mobile number, message text, a patient id, a
// plan id or a contact id, and the reason is drawn from a CLOSED set of fixed codes -- so no caller
// can pass a carrier's echoed error body or a free-text note through it. The human-readable text is
// `alertBodyFor` (../notification-preferences.ts), which is built from the class and the count
// alone. A team id is a synthetic service identifier, not a person.
//
// WHO RECEIVES WHAT. This build has no per-person contact address: staff sign-in deliberately keeps
// no email address or phone number (see ../../caring-contacts-server/oidc.ts), and the session
// carries only an opaque actor id, a team and roles. So alerts go to ONE configured team channel
// (a webhook), and opt-in decides WHICH alerts go there:
//
//   * a patient-work class (a failed delivery, a review backlog, ...) is delivered for a team only
//     when at least one member of that team has opted in to it -- opt-in stays "additive and
//     explicit, never assumed", as ../notification-preferences.ts requires;
//   * the OPERATIONAL classes below are delivered ALWAYS. They say the service itself is unsafe or
//     not working -- sending halted, sending not happening, the carrier throttling us -- and a
//     missed message to a high-risk patient must not depend on somebody having ticked a box.
import type { TeamId } from "../ids";
import { alertBodyFor, type AlertClass } from "../notification-preferences";

/** Delivered to the team channel whatever anybody's opt-in says. */
export const OPERATIONAL_ALERT_CLASSES: readonly AlertClass[] = Object.freeze([
  "serviceSafetyStop",
  "senderStalled",
  "carrierRateLimited",
]);

export function isOperationalAlertClass(alertClass: AlertClass): boolean {
  return OPERATIONAL_ALERT_CLASSES.includes(alertClass);
}

/**
 * The only reasons an alert may give. Fixed, machine-readable, never patient text. A reason that is
 * not in this list cannot be put on an alert (`staffAlert` throws), which is the point: the carrier
 * reason codes the sender records are NOT passed through, because a new transport could one day
 * produce one that echoes something it should not.
 */
export const STAFF_ALERT_REASONS = Object.freeze([
  /** Messages not sent: the carrier refused them, or nothing sendable could be produced. */
  "messages-not-sent",
  /** The carrier's delivery report said a sent message did not arrive (or the number is invalid). */
  "carrier-reported-undelivered",
  /** The approved sending window closed before messages could go (for example, a sender outage). */
  "sending-window-missed",
  /** Sent, but what happened could not be confirmed or recorded; a person must check. */
  "outcome-needs-checking",
  /** The carrier answered "too many requests"; this run stopped sending. */
  "carrier-rate-limited",
  /** The sender has not finished a run within the allowed time. */
  "sender-run-overdue",
  /** The sender has never finished a run since this app started. */
  "sender-never-run",
  /** A safety stop was raised; nothing will be sent until it is lifted. */
  "service-stopped",
] as const);

export type StaffAlertReason = (typeof STAFF_ALERT_REASONS)[number];

export type StaffAlert = {
  readonly alertClass: AlertClass;
  /** How many items the alert is about. 1 for a condition such as a stalled sender. */
  readonly count: number;
  readonly reason: StaffAlertReason | null;
  /** The team the alert is for, or null for a service-wide condition. */
  readonly teamId: TeamId | null;
};

/** Builds an alert, refusing anything outside the closed shape. */
export function staffAlert(input: {
  alertClass: AlertClass;
  count: number;
  reason?: StaffAlertReason | null;
  teamId?: TeamId | null;
}): StaffAlert {
  if (!Number.isInteger(input.count) || input.count < 1) {
    throw new Error("A staff alert's count must be a whole number of at least 1.");
  }
  const reason = input.reason ?? null;
  if (reason !== null && !(STAFF_ALERT_REASONS as readonly string[]).includes(reason)) {
    throw new Error(`"${reason}" is not a staff alert reason. Add it to STAFF_ALERT_REASONS deliberately.`);
  }
  // Throws for an unlabelled class (Ruling 61) -- checked here so a bad alert fails when built.
  alertBodyFor(input.alertClass, input.count);
  return Object.freeze({ alertClass: input.alertClass, count: input.count, reason, teamId: input.teamId ?? null });
}

/**
 * The JSON a delivery adapter sends. `text` is what a Teams- or Slack-style incoming webhook shows;
 * the other fields are for a relay or a rule that routes by class. Every field is a fixed code, a
 * count, a synthetic team id or an instant.
 */
export type StaffAlertPayload = {
  service: "caring-contacts";
  text: string;
  alertClass: AlertClass;
  count: number;
  reason: StaffAlertReason | null;
  teamId: string | null;
  raisedAt: string;
};

export function staffAlertPayload(alert: StaffAlert, raisedAt: Date): StaffAlertPayload {
  const body = alertBodyFor(alert.alertClass, alert.count);
  const where = alert.teamId === null ? "" : ` Team: ${alert.teamId}.`;
  const why = alert.reason === null ? "" : ` Reason: ${alert.reason}.`;
  return {
    service: "caring-contacts",
    text: `Caring Contacts staff alert: ${body}${why}${where} Open the workspace to review.`,
    alertClass: alert.alertClass,
    count: alert.count,
    reason: alert.reason,
    teamId: alert.teamId,
    raisedAt: raisedAt.toISOString(),
  };
}
