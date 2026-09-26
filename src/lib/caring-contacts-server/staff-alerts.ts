// src/lib/caring-contacts-server/staff-alerts.ts
//
// Server glue for staff alerts and the sender health check: reads the settings, picks the alert
// delivery adapter, supplies the content-free logger, and raises the three kinds of alert this
// build sends. The rules live in ../caring-contacts/alerts/.
//
// Settings (see .env.example and deploy/australia/env.australia.example):
//   CARING_CONTACTS_ALERT_DELIVERY            "simulated" (default) or "webhook"
//   CARING_CONTACTS_ALERT_WEBHOOK_URL         the team channel's https incoming-webhook address
//   CARING_CONTACTS_ALERT_COOLDOWN_MINUTES    how long the same alert is held back while its
//                                             condition persists. Default 60, minimum 1.
//   CARING_CONTACTS_SENDER_STALL_MINUTES      how long without a finished sender run before the
//                                             sender counts as stalled. Default 15, minimum 1.
//
// WHERE EACH ALERT IS RAISED, and why there:
//   * sender-run alerts (failed deliveries, a review backlog, carrier rate limiting): at the end of
//     each run, in the dispatch-run route -- the run knows what happened;
//   * a carrier delivery report of "not delivered" / "number invalid": in the delivery webhook,
//     as a permanent delivery failure for that team;
//   * a safety stop: in the service-state route, right after the store accepts the stop;
//   * a STALLED SENDER: in the readiness probe. A dead sender cannot report its own death, and the
//     next dispatch-run only happens if the sender is alive. The probe is the one thing an
//     orchestrator calls on its own schedule, every 15-30 seconds, whether or not the sender runs;
//     the durable cooldown keeps those polls (and several app instances) to one alert per cooldown.
//     Its limit, stated plainly: if nothing polls the probe, nothing raises this alert.
import "server-only";

import {
  deliverStaffAlerts,
  SERVICE_ALERT_SCOPE,
  staffAlertsActorForTeam,
  type StaffAlertDeliveryReport,
  type StaffAlertLog,
} from "@/lib/caring-contacts/alerts/raise";
import { resolveStaffAlertDelivery, type StaffAlertDelivery } from "@/lib/caring-contacts/alerts/delivery";
import { alertsFromSenderRun } from "@/lib/caring-contacts/alerts/sender-run-alerts";
import {
  DEFAULT_SENDER_STALL_THRESHOLD_MS,
  senderHealth,
  type SenderHealth,
} from "@/lib/caring-contacts/alerts/sender-health";
import { staffAlert } from "@/lib/caring-contacts/alerts/staff-alert";
import { systemClock, type Clock } from "@/lib/caring-contacts/clock";
import { teamId, type TeamId } from "@/lib/caring-contacts/ids";
import type { ProviderStatus } from "@/lib/caring-contacts/model";
import type { CaringContactRepository } from "@/lib/caring-contacts/repository";
import type { SenderRunReport } from "@/lib/caring-contacts/sender";
import { configuredTransportKind } from "@/lib/caring-contacts/transport/config";
import { logger } from "@/lib/logger";

import { senderTeamIds } from "./contact-sender";
import { isCaringContactsLiveEnabled } from "./workspace-gate";

export const ALERT_COOLDOWN_MINUTES_VAR = "CARING_CONTACTS_ALERT_COOLDOWN_MINUTES";
export const SENDER_STALL_MINUTES_VAR = "CARING_CONTACTS_SENDER_STALL_MINUTES";
export const DEFAULT_ALERT_COOLDOWN_MS = 60 * 60 * 1000;
/** A safety stop is one event, not a condition: its alert is keyed to that stop and held for a year. */
const SERVICE_STOP_ALERT_HOLD_MS = 365 * 24 * 60 * 60 * 1000;
/** The session team for service-wide bookkeeping when no sender team is configured. */
const NO_SENDER_TEAM: TeamId = teamId("service-health-probe");

type Env = Record<string, string | undefined>;

/**
 * Whole minutes from a setting, or the default. An unreadable value falls back to the DEFAULT
 * rather than to something shorter or longer: a typo must not silence alerts or hide a stall.
 */
function minutesSetting(env: Env, name: string, defaultMs: number): number {
  const raw = env[name]?.trim();
  if (!raw) return defaultMs;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes < 1) return defaultMs;
  return Math.round(minutes * 60 * 1000);
}

export function staffAlertCooldownMs(env: Env = process.env): number {
  return minutesSetting(env, ALERT_COOLDOWN_MINUTES_VAR, DEFAULT_ALERT_COOLDOWN_MS);
}

export function senderStallThresholdMs(env: Env = process.env): number {
  return minutesSetting(env, SENDER_STALL_MINUTES_VAR, DEFAULT_SENDER_STALL_THRESHOLD_MS);
}

/**
 * Whether a stalled sender may make the app unhealthy. Yes when real text messages are switched on
 * (or the setting cannot be read, which fails closed) or live mode is on: then a dead sender means
 * real people are not being contacted. No for the demo and simulated sending, where there is often
 * no sender running at all and an "unhealthy" app would be noise, not safety.
 */
export function senderMonitoringRequired(env: Env = process.env): boolean {
  if (isCaringContactsLiveEnabled(env.NODE_ENV as typeof process.env.NODE_ENV, env)) return true;
  try {
    return configuredTransportKind(env) !== "simulated";
  } catch {
    return true;
  }
}

/** The team whose session service-wide bookkeeping runs under. */
export function serviceAlertTeamId(env: Env = process.env): TeamId {
  return senderTeamIds(env)[0] ?? NO_SENDER_TEAM;
}

const PROCESS_STARTED_GLOBAL_KEY = "__caringContactsProcessStartedAt";
type GlobalWithStart = typeof globalThis & { [PROCESS_STARTED_GLOBAL_KEY]?: number };

/** When this app process started, for the stall rule's start-up grace. */
export function processStartedAt(): Date {
  const runtime = globalThis as GlobalWithStart;
  runtime[PROCESS_STARTED_GLOBAL_KEY] ??= Date.now() - Math.round(process.uptime() * 1000);
  return new Date(runtime[PROCESS_STARTED_GLOBAL_KEY]);
}

/** Test-only: pretend the process started at `at` (or forget the override). */
export function setProcessStartedAtForTests(at: Date | null): void {
  const runtime = globalThis as GlobalWithStart;
  if (at === null) Reflect.deleteProperty(runtime, PROCESS_STARTED_GLOBAL_KEY);
  else runtime[PROCESS_STARTED_GLOBAL_KEY] = at.getTime();
}

const alertLog: StaffAlertLog = (level, message, fields) => {
  if (level === "warn") logger.warn(message, fields);
  else logger.info(message, fields);
};

export type AlertDeliveryStatus = StaffAlertDelivery["kind"] | "misconfigured";

/** The configured adapter, or null (logged by error name) when the settings are refused. */
function deliveryOrNull(env: Env): StaffAlertDelivery | null {
  try {
    return resolveStaffAlertDelivery(env);
  } catch (error) {
    logger.error("Caring Contacts staff alerts are misconfigured; no alert can be delivered", {
      errorName: error instanceof Error ? error.name : "unknown-error",
    });
    return null;
  }
}

/** What the readiness probe reports about alert delivery. Content-free. */
export function alertDeliveryStatus(env: Env = process.env): AlertDeliveryStatus {
  try {
    return resolveStaffAlertDelivery(env).kind;
  } catch {
    return "misconfigured";
  }
}

type RaiseOptions = { env?: Env; clock?: Clock };

/** Raises the alerts one sender run calls for. Never throws. */
export async function raiseSenderRunAlerts(
  store: CaringContactRepository,
  report: SenderRunReport,
  options: RaiseOptions = {},
): Promise<StaffAlertDeliveryReport[]> {
  const env = options.env ?? process.env;
  try {
    const alerts = alertsFromSenderRun(report);
    if (alerts.length === 0) return [];
    const delivery = deliveryOrNull(env);
    if (!delivery) return [];
    return await deliverStaffAlerts({
      store,
      delivery,
      clock: options.clock ?? systemClock(),
      cooldownMs: staffAlertCooldownMs(env),
      alerts,
      serviceTeamId: serviceAlertTeamId(env),
      log: alertLog,
    });
  } catch (error) {
    logger.warn("Caring Contacts staff alerts failed after a sender run", {
      errorName: error instanceof Error ? error.name : "unknown-error",
    });
    return [];
  }
}

/**
 * A carrier delivery report that says a sent message did NOT arrive is a permanent delivery
 * failure for that team (opt-in class). Raised only for a receipt this call actually recorded, so a
 * carrier re-posting the same receipt does not alert again. Never throws.
 */
export async function raiseDeliveryReceiptAlert(
  store: CaringContactRepository,
  receipt: { teamId: TeamId; status: ProviderStatus | null; result: string },
  options: RaiseOptions = {},
): Promise<StaffAlertDeliveryReport[]> {
  const env = options.env ?? process.env;
  try {
    if (receipt.result !== "recorded") return [];
    if (receipt.status !== "notDelivered" && receipt.status !== "numberInvalid") return [];
    const delivery = deliveryOrNull(env);
    if (!delivery) return [];
    return await deliverStaffAlerts({
      store,
      delivery,
      clock: options.clock ?? systemClock(),
      cooldownMs: staffAlertCooldownMs(env),
      alerts: [
        staffAlert({
          alertClass: "permanentDeliveryFailure",
          count: 1,
          reason: "carrier-reported-undelivered",
          teamId: receipt.teamId,
        }),
      ],
      serviceTeamId: receipt.teamId,
      log: alertLog,
    });
  } catch (error) {
    logger.warn("Caring Contacts delivery-report alert failed", {
      errorName: error instanceof Error ? error.name : "unknown-error",
    });
    return [];
  }
}

/**
 * Raises the always-delivered safety-stop alert for one stop. Keyed to the stop's own instant, so a
 * replayed stop request does not alert twice and a later, separate stop does. Never throws.
 */
export async function raiseServiceStopAlert(
  store: CaringContactRepository,
  stop: { reportedByTeamId: TeamId; stoppedAt: string },
  options: RaiseOptions = {},
): Promise<StaffAlertDeliveryReport[]> {
  const env = options.env ?? process.env;
  try {
    const delivery = deliveryOrNull(env);
    if (!delivery) return [];
    const stoppedAt = new Date(stop.stoppedAt);
    const scope = Number.isNaN(stoppedAt.getTime()) ? "service-stop" : `service-stop:${stoppedAt.toISOString()}`;
    return await deliverStaffAlerts({
      store,
      delivery,
      clock: options.clock ?? systemClock(),
      cooldownMs: SERVICE_STOP_ALERT_HOLD_MS,
      alerts: [staffAlert({ alertClass: "serviceSafetyStop", count: 1, reason: "service-stopped" })],
      serviceTeamId: stop.reportedByTeamId,
      scopeOf: () => scope,
      log: alertLog,
    });
  } catch (error) {
    logger.warn("Caring Contacts safety-stop alert failed", {
      errorName: error instanceof Error ? error.name : "unknown-error",
    });
    return [];
  }
}

export type SenderCheck = SenderHealth | { status: "unknown"; reason: null };

/**
 * The readiness probe's sender check. Reads the heartbeat (as the alerts identity of the first
 * sender team) and applies the stall rule. "unknown" when the heartbeat cannot be read at all.
 */
export async function checkSender(
  store: CaringContactRepository,
  options: RaiseOptions & { now?: Date } = {},
): Promise<SenderCheck> {
  const env = options.env ?? process.env;
  const monitored = senderMonitoringRequired(env);
  if (!monitored) return { status: "notMonitored", reason: null };
  let lastRunAt: Date | null;
  try {
    const heartbeat = await store.getSenderHeartbeat({ actor: staffAlertsActorForTeam(serviceAlertTeamId(env)) });
    lastRunAt = heartbeat?.lastRunAt ?? null;
  } catch {
    return { status: "unknown", reason: null };
  }
  return senderHealth({
    monitored,
    lastRunAt,
    now: options.now ?? (options.clock ?? systemClock()).now(),
    processStartedAt: processStartedAt(),
    thresholdMs: senderStallThresholdMs(env),
  });
}

/** Raises the always-delivered "sender stalled" alert, service-wide, under the cooldown. Never throws. */
export async function raiseSenderStalledAlert(
  store: CaringContactRepository,
  health: SenderHealth,
  options: RaiseOptions = {},
): Promise<StaffAlertDeliveryReport[]> {
  const env = options.env ?? process.env;
  try {
    if (health.status !== "stalled") return [];
    const delivery = deliveryOrNull(env);
    if (!delivery) return [];
    return await deliverStaffAlerts({
      store,
      delivery,
      clock: options.clock ?? systemClock(),
      cooldownMs: staffAlertCooldownMs(env),
      alerts: [staffAlert({ alertClass: "senderStalled", count: 1, reason: health.reason })],
      serviceTeamId: serviceAlertTeamId(env),
      scopeOf: () => SERVICE_ALERT_SCOPE,
      log: alertLog,
    });
  } catch (error) {
    logger.warn("Caring Contacts sender-stalled alert failed", {
      errorName: error instanceof Error ? error.name : "unknown-error",
    });
    return [];
  }
}
