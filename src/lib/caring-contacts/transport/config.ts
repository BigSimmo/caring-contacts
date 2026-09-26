// src/lib/caring-contacts/transport/config.ts
//
// Chooses the message transport from the environment. Simulated unless real sending has been
// deliberately and completely configured; a half-configured real setup REFUSES (throws) rather
// than quietly falling back to simulation, because a service that believes it is texting patients
// while it is not is the worse failure.
//
// Settings (documented in .env.example and deploy/australia/env.australia.example):
//   CARING_CONTACTS_SMS_TRANSPORT            "simulated" (default) or "telstra"
//   CARING_CONTACTS_TELSTRA_CLIENT_ID        Telstra API client id
//   CARING_CONTACTS_TELSTRA_CLIENT_SECRET    Telstra API client secret
//   CARING_CONTACTS_TELSTRA_FROM             the Australian virtual number / approved sender name
//   CARING_CONTACTS_TELSTRA_API_BASE_URL     optional; must be an approved Australian Telstra host
//   CARING_CONTACTS_PUBLIC_BASE_URL          this service's https address, for delivery receipts
//   CARING_CONTACTS_DELIVERY_WEBHOOK_SECRET  32+ characters; signs each delivery-receipt address
import { deliveryWebhookSecretIsStrong } from "./delivery-link";
import { createSimulatedTransport } from "./simulated";
import { createTelstraTransport, TELSTRA_DEFAULT_API_BASE_URL } from "./telstra";
import type { MessageTransport } from "./types";

export const SMS_TRANSPORT_VAR = "CARING_CONTACTS_SMS_TRANSPORT";

export class SmsTransportConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmsTransportConfigError";
  }
}

type Env = Record<string, string | undefined>;

function value(env: Env, name: string): string | undefined {
  const raw = env[name]?.trim();
  return raw ? raw : undefined;
}

export type ResolvedTransport = {
  transport: MessageTransport;
  /** Builds nothing when null: receipts are only asked for from a real carrier. */
  deliveryReceipts: { publicBaseUrl: string; secret: string } | null;
};

/** The configured transport kind, without building anything. */
export function configuredTransportKind(env: Env = process.env): "simulated" | "telstra" {
  const kind = value(env, SMS_TRANSPORT_VAR)?.toLowerCase() ?? "simulated";
  if (kind === "simulated" || kind === "telstra") return kind;
  throw new SmsTransportConfigError(`${SMS_TRANSPORT_VAR} must be "simulated" or "telstra".`);
}

export function resolveMessageTransport(
  env: Env = process.env,
  options: { nodeEnv?: string; fetchImpl?: typeof fetch } = {},
): ResolvedTransport {
  const kind = configuredTransportKind(env);
  if (kind === "simulated") return { transport: createSimulatedTransport(), deliveryReceipts: null };

  const allowLoopbackForTests = (options.nodeEnv ?? process.env.NODE_ENV) === "test";
  const missing = [
    "CARING_CONTACTS_TELSTRA_CLIENT_ID",
    "CARING_CONTACTS_TELSTRA_CLIENT_SECRET",
    "CARING_CONTACTS_TELSTRA_FROM",
    "CARING_CONTACTS_PUBLIC_BASE_URL",
    "CARING_CONTACTS_DELIVERY_WEBHOOK_SECRET",
  ].filter((name) => value(env, name) === undefined);
  if (missing.length > 0) {
    throw new SmsTransportConfigError(
      `Real text-message sending is switched on but not fully set up. Missing: ${missing.join(", ")}.`,
    );
  }
  const secret = value(env, "CARING_CONTACTS_DELIVERY_WEBHOOK_SECRET") as string;
  if (!deliveryWebhookSecretIsStrong(secret)) {
    throw new SmsTransportConfigError("CARING_CONTACTS_DELIVERY_WEBHOOK_SECRET must be at least 32 characters.");
  }
  const publicBaseUrl = value(env, "CARING_CONTACTS_PUBLIC_BASE_URL") as string;
  let parsedPublic: URL;
  try {
    parsedPublic = new URL(publicBaseUrl);
  } catch {
    throw new SmsTransportConfigError("CARING_CONTACTS_PUBLIC_BASE_URL is not a valid address.");
  }
  const loopback = parsedPublic.hostname === "127.0.0.1" || parsedPublic.hostname === "localhost";
  if (parsedPublic.protocol !== "https:" && !(allowLoopbackForTests && loopback)) {
    throw new SmsTransportConfigError("CARING_CONTACTS_PUBLIC_BASE_URL must be an https address.");
  }

  const transport = createTelstraTransport(
    {
      clientId: value(env, "CARING_CONTACTS_TELSTRA_CLIENT_ID") as string,
      clientSecret: value(env, "CARING_CONTACTS_TELSTRA_CLIENT_SECRET") as string,
      from: value(env, "CARING_CONTACTS_TELSTRA_FROM") as string,
      apiBaseUrl: value(env, "CARING_CONTACTS_TELSTRA_API_BASE_URL") ?? TELSTRA_DEFAULT_API_BASE_URL,
    },
    { fetchImpl: options.fetchImpl, allowLoopbackForTests },
  );
  return { transport, deliveryReceipts: { publicBaseUrl: parsedPublic.origin, secret } };
}
