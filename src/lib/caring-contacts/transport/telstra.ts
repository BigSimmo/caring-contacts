// src/lib/caring-contacts/transport/telstra.ts
//
// Real text-message sending through the Telstra Messaging API (version 3), an Australian carrier's
// own HTTP SMS API -- the provider the sovereign deployment spec names (§4.2, "Telstra Health
// Messaging API or Australian-domiciled aggregator").
//
// CHECKED AGAINST TELSTRA'S PUBLISHED MATERIAL ON 26 SEPTEMBER 2026. Telstra's developer site
// (dev.telstra.com/docs/messaging-api, dev.telstra.com/apis/messaging-api/endpoints and
// .../v3-migration-guide) builds its pages with JavaScript and could not be read by the tools used,
// so the check used Telstra's own published SDKs for Messaging API v3 instead, which Telstra
// generates from the same API definition: the official Node SDK @telstra/messaging 4.0.2 (Nov 2025)
// with @telstra/core 0.0.3 and the earlier 3.0.10, read as source, and the READMEs of
// github.com/telstra/MessagingAPI-SDK-Go, MessagingAPI-SDK-dotnet (release/msg-v3) and
// MessagingAPI-SDK-node (release/MessagingAPI-V3-SDK). What they confirm:
//   * token:  POST https://products.api.telstra.com/v2/oauth/token, form fields
//             grant_type=client_credentials, client_id, client_secret, scope (space-separated;
//             messages:read and messages:write are documented scopes); reply { access_token,
//             expires_in } with expires_in in seconds (possibly sent as a string);
//   * send:   POST https://products.api.telstra.com/messaging/v3/messages with Authorization:
//             Bearer <token>, Telstra-api-version: 3.x, Content-Language: en-au, Accept-Charset:
//             utf-8, JSON body { to, from, messageContent, deliveryNotification, statusCallbackUrl };
//             `from` is at most 13 characters, `messageContent` at most 1600;
//   * reply:  { messageId, status, to, from, ... }. messageId is a UUID, typed as "string or array
//             of strings" (an array when several recipients are sent at once);
//   * status: queued, sent, delivered, expired, undeliverable (see ./delivery-receipts.ts). Telstra
//             posts to statusCallbackUrl "when the status of the message changes"; a delivery
//             notification is only sent when deliveryNotification is true, which Telstra describes
//             as a PAID FEATURE on the account.
// STILL UNCERTAIN (not stated in anything that could be read; confirm with Telstra or the staff
// test message before patient use):
//   * the exact body Telstra posts to statusCallbackUrl. This build relies only on a `status` field
//     holding one of the words above; the delivery webhook ignores everything else;
//   * whether Telstra keeps the query string on statusCallbackUrl (the signed receipt address in
//     ./delivery-link.ts depends on it), and any length limit on that address;
//   * whether Telstra signs its callbacks. Nothing documented was found, so the address signature
//     remains the only proof a receipt is genuine;
//   * the success status code for a send (any 2xx is treated as accepted), rate limits, and the
//     error-body format. A 429 ("too many requests") is refused, not sent and not retried, like any
//     other 4xx -- but under its OWN reason code, `carrier-rate-limited`, because it means the
//     carrier is throttling this service rather than refusing this one message. The sender stops
//     claiming further contacts for the rest of that run and raises the operational
//     "carrier rate limiting" staff alert (../alerts/). Telstra's documented limits and whether it
//     sends Retry-After were not readable; Retry-After is ignored;
//   * the newest SDK (4.0.2) no longer sends Telstra-api-version at all; 3.0.10 sent "3.x". It is
//     kept because the API definition lists it as a request header;
//   * where Telstra stores and processes messages. The docs do not say; the owner must get written
//     confirmation of Australian handling (deployment spec section 4.2).
// The automated tests prove this adapter against a FAKE server shaped like the above.
//
// SAFETY PROPERTIES THIS FILE GUARANTEES, whatever the API details turn out to be:
//   * it refuses to be constructed for any endpoint that is not one of Telstra's Australian API
//     hosts over https (`assertAustralianSmsEndpoint`) -- a mistyped or offshore URL throws at
//     start-up instead of carrying a patient's number abroad;
//   * it never logs, throws or returns a phone number, the message text, or anything the carrier
//     sent back (a carrier error body can echo both) -- only HTTP status codes and fixed reason codes;
//   * it never retries a send itself. A reply it cannot interpret is reported `unknown`, and the
//     sender records it for a person to check rather than risking a second caring message.
import type { MessageTransport, OutboundTextMessage, TextMessageSendResult } from "./types";

export const TELSTRA_DEFAULT_API_BASE_URL = "https://products.api.telstra.com";

/**
 * The only host this adapter will talk to: Telstra's own API gateway, the one Messaging API v3 is
 * published on. (The older tapi.telstra.com gateway served only the retired v2 API and was removed on
 * 26 September 2026.) Adding a host here is a sovereignty decision (deployment spec §4.2), not a
 * configuration tweak.
 */
export const AUSTRALIAN_SMS_API_HOSTS: readonly string[] = Object.freeze(["products.api.telstra.com"]);

/**
 * The reason code for an HTTP 429 from either the token or the message endpoint. Distinct from
 * `carrier-refused-<status>` on purpose: a 429 says nothing about the message and everything about
 * the carrier throttling this service, so the sender treats it as a service-level condition.
 */
export const CARRIER_RATE_LIMITED_REASON = "carrier-rate-limited";

/** Scope requested with the token: only the message scopes, of those Telstra documents. */
export const TELSTRA_TOKEN_SCOPE = "messages:read messages:write";
/** Value Telstra's own v3 SDK sent in the Telstra-api-version header. */
export const TELSTRA_API_VERSION_HEADER = "3.x";
const REQUEST_TIMEOUT_MS = 15_000;
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

export class NonAustralianSmsEndpointError extends Error {
  constructor() {
    super(
      "Caring Contacts refuses to start text-message sending: the SMS API address is not one of the " +
        `approved Australian carrier hosts (${AUSTRALIAN_SMS_API_HOSTS.join(", ")}) over https.`,
    );
    this.name = "NonAustralianSmsEndpointError";
  }
}

/**
 * Parses and checks the configured API base address. Throws `NonAustralianSmsEndpointError` for
 * anything that is not https on an approved Australian host. `allowLoopbackForTests` admits
 * http://127.0.0.1 / localhost so the tests can point it at a fake server; the caller only passes
 * it when NODE_ENV is "test".
 */
export function assertAustralianSmsEndpoint(raw: string, options?: { allowLoopbackForTests?: boolean }): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new NonAustralianSmsEndpointError();
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (options?.allowLoopbackForTests && loopback && (url.protocol === "http:" || url.protocol === "https:")) {
    return url;
  }
  if (url.protocol !== "https:" || !AUSTRALIAN_SMS_API_HOSTS.includes(url.hostname)) {
    throw new NonAustralianSmsEndpointError();
  }
  if (url.username || url.password) throw new NonAustralianSmsEndpointError();
  return url;
}

export type TelstraTransportConfig = {
  clientId: string;
  clientSecret: string;
  /** The Australian virtual number or approved sender name messages come from. */
  from: string;
  apiBaseUrl: string;
};

export type TelstraTransportOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  allowLoopbackForTests?: boolean;
  timeoutMs?: number;
};

/** Error codes for a failure before any HTTP response: these mean the request never reached Telstra. */
const NOT_SENT_NETWORK_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]);

function networkErrorCode(error: unknown): string | null {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  return typeof cause?.code === "string" ? cause.code : null;
}

function isTimeout(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * Telstra types messageId as "a string, or an array of strings" (one per recipient). Each send here
 * has exactly one recipient, so a one-element array is unwrapped; anything else is not guessed at.
 */
function singleMessageId(value: unknown): string | null {
  if (typeof value === "string" && value !== "") return value;
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === "string" && value[0] !== "") return value[0];
  return null;
}

export function createTelstraTransport(
  config: TelstraTransportConfig,
  options: TelstraTransportOptions = {},
): MessageTransport & { readonly kind: "telstra" } {
  const base = assertAustralianSmsEndpoint(config.apiBaseUrl, { allowLoopbackForTests: options.allowLoopbackForTests });
  if (!config.clientId.trim() || !config.clientSecret.trim() || !config.from.trim()) {
    throw new Error("Caring Contacts Telstra transport needs a client id, client secret and sender number.");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const tokenUrl = new URL("/v2/oauth/token", base);
  const messagesUrl = new URL("/messaging/v3/messages", base);

  let cachedToken: { value: string; expiresAt: number } | null = null;

  /** The access token, or the reason code for why none could be had. */
  async function accessToken(): Promise<{ token: string } | { failure: string }> {
    const failed = { failure: "carrier-authentication-failed" };
    if (cachedToken && cachedToken.expiresAt - TOKEN_EXPIRY_MARGIN_MS > now()) return { token: cachedToken.value };
    cachedToken = null;
    let response: Response;
    try {
      response = await fetchImpl(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: config.clientId,
          client_secret: config.clientSecret,
          scope: TELSTRA_TOKEN_SCOPE,
        }),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
    } catch {
      return failed;
    }
    if (response.status === 429) return { failure: CARRIER_RATE_LIMITED_REASON };
    if (!response.ok) return failed;
    const payload = (await response.json().catch(() => null)) as {
      access_token?: unknown;
      expires_in?: unknown;
    } | null;
    if (!payload || typeof payload.access_token !== "string" || payload.access_token === "") return failed;
    const expiresInSeconds = Number(payload.expires_in);
    const lifetimeMs = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds * 1000 : 0;
    cachedToken = { value: payload.access_token, expiresAt: now() + lifetimeMs };
    return { token: payload.access_token };
  }

  return {
    kind: "telstra",
    reachesRealPhones: true,
    async send(message: OutboundTextMessage): Promise<TextMessageSendResult> {
      const signedIn = await accessToken();
      // No token means no message request was ever made, so nothing can have reached the patient.
      if ("failure" in signedIn) return { outcome: "rejected", reason: signedIn.failure };
      const token = signedIn.token;

      const body: Record<string, unknown> = {
        to: message.to,
        from: config.from,
        messageContent: message.body,
      };
      if (message.deliveryReceiptUrl) {
        // Telstra only posts a delivery notification when this is true (a paid account feature).
        body.deliveryNotification = true;
        body.statusCallbackUrl = message.deliveryReceiptUrl;
      }

      let response: Response;
      try {
        response = await fetchImpl(messagesUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Telstra-api-version": TELSTRA_API_VERSION_HEADER,
            "Content-Language": "en-au",
            "Accept-Charset": "utf-8",
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
          redirect: "error",
        });
      } catch (error) {
        if (isTimeout(error)) return { outcome: "unknown", reason: "carrier-timeout" };
        const code = networkErrorCode(error);
        if (code !== null && NOT_SENT_NETWORK_CODES.has(code)) {
          return { outcome: "rejected", reason: "carrier-unreachable" };
        }
        return { outcome: "unknown", reason: "carrier-connection-lost" };
      }

      if (response.status === 401 || response.status === 403) {
        cachedToken = null;
        return { outcome: "rejected", reason: `carrier-refused-${response.status}` };
      }
      if (response.status === 429) {
        // Throttled: the carrier did not take the message. Not re-sent here or by the sender.
        return { outcome: "rejected", reason: CARRIER_RATE_LIMITED_REASON };
      }
      if (response.status >= 400 && response.status < 500) {
        return { outcome: "rejected", reason: `carrier-refused-${response.status}` };
      }
      if (!response.ok) {
        // A 5xx may have been produced after the message was queued. Not re-sent; checked by a person.
        return { outcome: "unknown", reason: `carrier-error-${response.status}` };
      }
      const payload = (await response.json().catch(() => null)) as { messageId?: unknown } | null;
      return { outcome: "accepted", providerMessageId: singleMessageId(payload?.messageId) };
    },
  };
}
