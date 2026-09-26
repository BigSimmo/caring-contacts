// src/lib/caring-contacts/alerts/raise.ts
//
// Delivers a batch of staff alerts: decides whether each one should go (opt-in), whether it
// already went recently (cooldown), sends it through the configured adapter, and reports what
// happened. It NEVER throws. An alert that cannot be delivered is logged with fixed codes and
// reported; it must never break or stop the thing that raised it -- above all the sender run,
// whose job is getting caring messages to people.
//
// DE-DUPLICATION. Each alert has a SCOPE: the team id for a team's own alert, `service` for a
// service-wide condition, or a caller-chosen key such as `service-stop:<instant>` for one
// particular event. The store's `claimStaffAlert` holds the instant each (scope, class) alert was
// last delivered, durably and atomically, so while a condition persists the same alert goes out
// at most once per cooldown -- however many five-minute runs, health-probe polls or app instances
// see it. A delivery that FAILS gives its claim back (`releaseStaffAlert`), so a channel outage
// does not also silence the next attempt for a whole cooldown.
import type { Clock } from "../clock";
import { actorId, type TeamId } from "../ids";
import type { AlertClass } from "../notification-preferences";
import type { SystemActor } from "../permissions";
import type { CaringContactRepository } from "../repository";

import type { StaffAlertDelivery } from "./delivery";
import { isOperationalAlertClass, type StaffAlert, type StaffAlertReason } from "./staff-alert";

/**
 * The identity alert bookkeeping is written as. It holds the one system role there is (the grant
 * tables never let a system actor act as a person), and this module only ever uses it for the
 * operational writes -- the cooldown claim -- and the team opt-in read. Named for what it does so
 * the store's records say which software acted.
 */
export const STAFF_ALERTS_ACTOR_ID = actorId("system-staff-alerts");

export function staffAlertsActorForTeam(teamId: TeamId): SystemActor {
  return { id: STAFF_ALERTS_ACTOR_ID, teamId, systemRole: "contactDispatcher" };
}

/** The scope for an alert when the caller names none: its team, or the whole service. */
export const SERVICE_ALERT_SCOPE = "service";

export function defaultStaffAlertScope(alert: StaffAlert): string {
  return alert.teamId ?? SERVICE_ALERT_SCOPE;
}

export type StaffAlertOutcome =
  /** Sent through the adapter. */
  | "delivered"
  /** A patient-work class nobody in the team has opted in to (or a team-less one). */
  | "notOptedIn"
  /** The same alert went out within the cooldown. */
  | "coolingDown"
  /** The adapter could not deliver it; the claim was given back so the next attempt can try. */
  | "deliveryFailed"
  /** The store refused the bookkeeping write. */
  | "refused"
  /** Something unexpected; logged by name. */
  | "error";

export type StaffAlertDeliveryReport = {
  alertClass: AlertClass;
  count: number;
  reason: StaffAlertReason | null;
  teamId: TeamId | null;
  outcome: StaffAlertOutcome;
  /** A fixed failure code (adapter reason, store refusal or error name). Never patient text. */
  failure?: string;
};

/**
 * A content-free log line. The caller supplies it (this domain imports nothing from outside its
 * own directory); every field it is given is a fixed code, a count, a synthetic id or a kind.
 */
export type StaffAlertLog = (
  level: "info" | "warn",
  message: string,
  fields: Record<string, string | number | null>,
) => void;

export type DeliverStaffAlertsInput = {
  store: CaringContactRepository;
  delivery: StaffAlertDelivery;
  clock: Clock;
  cooldownMs: number;
  alerts: readonly StaffAlert[];
  /** The team session a service-wide alert's bookkeeping runs under (any configured team). */
  serviceTeamId: TeamId;
  /** Overrides `defaultStaffAlertScope`, e.g. to key a safety-stop alert to one stop. */
  scopeOf?: (alert: StaffAlert) => string;
  log?: StaffAlertLog;
};

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown-error";
}

export async function deliverStaffAlerts(input: DeliverStaffAlertsInput): Promise<StaffAlertDeliveryReport[]> {
  const reports: StaffAlertDeliveryReport[] = [];
  const optInsByTeam = new Map<TeamId, readonly AlertClass[]>();
  const scopeOf = input.scopeOf ?? defaultStaffAlertScope;

  for (const alert of input.alerts) {
    const report = (outcome: StaffAlertOutcome, failure?: string): StaffAlertDeliveryReport => ({
      alertClass: alert.alertClass,
      count: alert.count,
      reason: alert.reason,
      teamId: alert.teamId,
      outcome,
      ...(failure === undefined ? {} : { failure }),
    });
    let outcome: StaffAlertDeliveryReport;
    try {
      outcome = await deliverOne(input, alert, scopeOf(alert), optInsByTeam, report);
    } catch (error) {
      outcome = report("error", errorName(error));
    }
    reports.push(outcome);
    if (outcome.outcome !== "notOptedIn") {
      try {
        input.log?.(
          outcome.outcome === "delivered" || outcome.outcome === "coolingDown" ? "info" : "warn",
          "Caring Contacts staff alert",
          {
            alertClass: outcome.alertClass,
            count: outcome.count,
            reason: outcome.reason,
            teamId: outcome.teamId,
            outcome: outcome.outcome,
            failure: outcome.failure ?? null,
            delivery: input.delivery.kind,
          },
        );
      } catch {
        // A logging fault must not turn into an alert fault either.
      }
    }
  }
  return reports;
}

async function deliverOne(
  input: DeliverStaffAlertsInput,
  alert: StaffAlert,
  scope: string,
  optInsByTeam: Map<TeamId, readonly AlertClass[]>,
  report: (outcome: StaffAlertOutcome, failure?: string) => StaffAlertDeliveryReport,
): Promise<StaffAlertDeliveryReport> {
  if (!isOperationalAlertClass(alert.alertClass)) {
    if (alert.teamId === null) return report("notOptedIn");
    if (!optInsByTeam.has(alert.teamId)) {
      optInsByTeam.set(
        alert.teamId,
        await input.store.listTeamAlertOptIns({ actor: staffAlertsActorForTeam(alert.teamId) }),
      );
    }
    if (!optInsByTeam.get(alert.teamId)?.includes(alert.alertClass)) return report("notOptedIn");
  }

  const context = { actor: staffAlertsActorForTeam(alert.teamId ?? input.serviceTeamId) };
  const at = input.clock.now();
  const claim = await input.store.claimStaffAlert(
    { scope, alertClass: alert.alertClass, at, cooldownMs: input.cooldownMs },
    context,
  );
  if (!claim.ok) return report("refused", claim.reason);
  if (claim.value === "coolingDown") return report("coolingDown");

  let failure: string | null;
  try {
    const delivered = await input.delivery.deliver(alert, at);
    failure = delivered.ok ? null : delivered.reason;
  } catch (error) {
    failure = `delivery-${errorName(error)}`;
  }
  if (failure === null) return report("delivered");
  await input.store.releaseStaffAlert({ scope, alertClass: alert.alertClass, at }, context).catch(() => undefined);
  return report("deliveryFailed", failure);
}
