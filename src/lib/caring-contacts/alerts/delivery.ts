// src/lib/caring-contacts/alerts/delivery.ts
//
// How a staff alert leaves the app. Chosen from the environment, exactly as the text-message
// transport is (../transport/config.ts): SIMULATED unless a real channel has been deliberately and
// completely configured, and a half-configured real channel REFUSES (throws) rather than quietly
// simulating -- a service that believes it is alerting staff while it is not is the failure this
// feature exists to remove.
//
// Settings (documented in .env.example and deploy/australia/env.australia.example):
//   CARING_CONTACTS_ALERT_DELIVERY      "simulated" (default) or "webhook"
//   CARING_CONTACTS_ALERT_WEBHOOK_URL   the team channel's incoming-webhook address (https). A Teams-
//                                       or Slack-style incoming webhook, or an email relay that
//                                       accepts a JSON POST. Treated as a secret: never logged.
//
// PRIVACY RULE FOR EVERY ADAPTER, the same one ../transport/types.ts states for text messages: an
// adapter never logs, throws or returns the webhook address or anything the far end sent back.
// Failures are short fixed codes only.
import { staffAlertPayload, type StaffAlert, type StaffAlertPayload } from "./staff-alert";

export const ALERT_DELIVERY_VAR = "CARING_CONTACTS_ALERT_DELIVERY";
export const ALERT_WEBHOOK_URL_VAR = "CARING_CONTACTS_ALERT_WEBHOOK_URL";
const WEBHOOK_TIMEOUT_MS = 10_000;
/** The simulated outbox keeps only the most recent alerts, so it never grows without bound. */
export const SIMULATED_OUTBOX_LIMIT = 200;

export class AlertDeliveryConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlertDeliveryConfigError";
  }
}

export type AlertDeliveryResult = { ok: true } | { ok: false; reason: string };

export type StaffAlertDeliveryKind = "simulated" | "webhook";

export interface StaffAlertDelivery {
  readonly kind: StaffAlertDeliveryKind;
  deliver(alert: StaffAlert, raisedAt: Date): Promise<AlertDeliveryResult>;
}

type Env = Record<string, string | undefined>;

function value(env: Env, name: string): string | undefined {
  const raw = env[name]?.trim();
  return raw ? raw : undefined;
}

// -------------------------------------------------------------------------------------------------
// Simulated: an in-memory outbox tests and the demo can read. Process-wide on `globalThis`, for the
// same reason ../../caring-contacts-server/store.ts pins its store there: Turbopack gives route
// handlers and pages separate module registries under `next dev`.
// -------------------------------------------------------------------------------------------------
const OUTBOX_GLOBAL_KEY = "__caringContactsSimulatedStaffAlertOutbox";
type GlobalWithOutbox = typeof globalThis & { [OUTBOX_GLOBAL_KEY]?: StaffAlertPayload[] };

function outbox(): StaffAlertPayload[] {
  const runtime = globalThis as GlobalWithOutbox;
  runtime[OUTBOX_GLOBAL_KEY] ??= [];
  return runtime[OUTBOX_GLOBAL_KEY];
}

/** Every alert the simulated adapter has "delivered" in this process, oldest first. */
export function simulatedStaffAlertOutbox(): readonly StaffAlertPayload[] {
  return [...outbox()];
}

/** Test-only: empty the simulated outbox. */
export function clearSimulatedStaffAlertOutbox(): void {
  outbox().length = 0;
}

export function createSimulatedAlertDelivery(): StaffAlertDelivery {
  return {
    kind: "simulated",
    async deliver(alert, raisedAt) {
      const box = outbox();
      box.push(staffAlertPayload(alert, raisedAt));
      if (box.length > SIMULATED_OUTBOX_LIMIT) box.splice(0, box.length - SIMULATED_OUTBOX_LIMIT);
      return { ok: true };
    },
  };
}

// -------------------------------------------------------------------------------------------------
// Webhook: one JSON POST per alert to the configured team channel.
// -------------------------------------------------------------------------------------------------

/**
 * Checks the webhook address: https only, no credentials in the address. `allowLoopbackForTests`
 * admits http://127.0.0.1 / localhost so the tests can use a fake server; it is only passed when
 * NODE_ENV is "test". Never echoes the address in the error, because it is usually a secret.
 */
export function assertAlertWebhookUrl(raw: string, options?: { allowLoopbackForTests?: boolean }): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AlertDeliveryConfigError(`${ALERT_WEBHOOK_URL_VAR} is not a valid address.`);
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  const httpAllowed = options?.allowLoopbackForTests === true && loopback && url.protocol === "http:";
  if (url.protocol !== "https:" && !httpAllowed) {
    throw new AlertDeliveryConfigError(`${ALERT_WEBHOOK_URL_VAR} must be an https address.`);
  }
  if (url.username || url.password) {
    throw new AlertDeliveryConfigError(`${ALERT_WEBHOOK_URL_VAR} must not carry a user name or password.`);
  }
  return url;
}

export function createWebhookAlertDelivery(
  webhookUrl: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; allowLoopbackForTests?: boolean } = {},
): StaffAlertDelivery {
  const url = assertAlertWebhookUrl(webhookUrl, { allowLoopbackForTests: options.allowLoopbackForTests });
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? WEBHOOK_TIMEOUT_MS;
  return {
    kind: "webhook",
    async deliver(alert, raisedAt) {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(staffAlertPayload(alert, raisedAt)),
          signal: AbortSignal.timeout(timeoutMs),
          redirect: "error",
        });
      } catch (error) {
        const name = (error as { name?: unknown } | null)?.name;
        return {
          ok: false,
          reason: name === "TimeoutError" || name === "AbortError" ? "webhook-timeout" : "webhook-unreachable",
        };
      }
      // The body is never read: whatever the far end says is not ours to log.
      await response.body?.cancel().catch(() => undefined);
      return response.ok ? { ok: true } : { ok: false, reason: `webhook-refused-${response.status}` };
    },
  };
}

// -------------------------------------------------------------------------------------------------
// Choosing one.
// -------------------------------------------------------------------------------------------------

/** The configured delivery kind, without building anything. Throws on an unknown value. */
export function configuredAlertDeliveryKind(env: Env = process.env): StaffAlertDeliveryKind {
  const kind = value(env, ALERT_DELIVERY_VAR)?.toLowerCase() ?? "simulated";
  if (kind === "simulated" || kind === "webhook") return kind;
  throw new AlertDeliveryConfigError(`${ALERT_DELIVERY_VAR} must be "simulated" or "webhook".`);
}

/**
 * Builds the configured adapter. Refuses (throws `AlertDeliveryConfigError`) on:
 *   * an unknown delivery kind;
 *   * "webhook" with no address, or an address that is not https;
 *   * an address set while delivery is still "simulated" -- half-configured: somebody meant alerts
 *     to go somewhere, and quietly keeping them in memory would hide that they do not.
 */
export function resolveStaffAlertDelivery(
  env: Env = process.env,
  options: { nodeEnv?: string; fetchImpl?: typeof fetch } = {},
): StaffAlertDelivery {
  const kind = configuredAlertDeliveryKind(env);
  const address = value(env, ALERT_WEBHOOK_URL_VAR);
  if (kind === "simulated") {
    if (address !== undefined) {
      throw new AlertDeliveryConfigError(
        `${ALERT_WEBHOOK_URL_VAR} is set but ${ALERT_DELIVERY_VAR} is not "webhook". Set both, or neither.`,
      );
    }
    return createSimulatedAlertDelivery();
  }
  if (address === undefined) {
    throw new AlertDeliveryConfigError(`Staff alerts are set to "webhook" but ${ALERT_WEBHOOK_URL_VAR} is missing.`);
  }
  const allowLoopbackForTests = (options.nodeEnv ?? process.env.NODE_ENV) === "test";
  return createWebhookAlertDelivery(address, { fetchImpl: options.fetchImpl, allowLoopbackForTests });
}
