// src/lib/caring-contacts-server/inbound-webhook.ts
//
// Server glue for the incoming-text webhook: its setting, and the check that a caller is the
// carrier it claims to be. The rules are in ../caring-contacts/inbound-replies.ts and the flow in
// ../caring-contacts/inbound-receiver.ts.
//
// Setting (see .env.example and deploy/australia/README.md, "Text messages"):
//   CARING_CONTACTS_INBOUND_WEBHOOK_SECRET   32+ characters. The carrier presents it with every
//                                            incoming message, as the header
//                                            `x-caring-contacts-inbound-secret`, as
//                                            `Authorization: Bearer <secret>`, or -- for a carrier
//                                            that can only be given an address -- as `?token=` on
//                                            the callback address. Unset or short = the route does
//                                            not exist (404). It also keys the loop guard's hash of
//                                            each sending number (`inboundSenderKey`).
//
// THE COMPARISON LEAKS NOTHING, INCLUDING LENGTH. Both sides are hashed to a fixed-length digest
// before `timingSafeEqual`, the idea of the shared-secret gate in the owner's other repository
// (src/lib/webhooks/secret-auth.ts there, read and adapted, not imported): the presented value's
// length never decides how long the comparison takes, and a crafted multi-byte token cannot make
// `timingSafeEqual` throw.
//
// THE QUERY-STRING FORM IS A CONCESSION, stated as one: a secret in an address can reach an access
// log. It is accepted because a carrier callback may be configurable only as an address (see
// ../caring-contacts/transport/inbound.ts). Prefer the header wherever the carrier allows it.
import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

export const INBOUND_WEBHOOK_SECRET_VAR = "CARING_CONTACTS_INBOUND_WEBHOOK_SECRET";
export const INBOUND_WEBHOOK_SECRET_HEADER = "x-caring-contacts-inbound-secret";
const MINIMUM_SECRET_LENGTH = 32;

type Env = Record<string, string | undefined>;

/** The configured secret, or null when it is absent or too short to be one. */
export function inboundWebhookSecret(env: Env = process.env): string | null {
  const secret = env[INBOUND_WEBHOOK_SECRET_VAR]?.trim();
  return secret && secret.length >= MINIMUM_SECRET_LENGTH ? secret : null;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time equality that does not depend on either value's length. */
export function sameInboundSecret(presented: string, expected: string): boolean {
  return timingSafeEqual(digest(presented), digest(expected));
}

function presentedSecret(request: Request): string {
  const header = request.headers.get(INBOUND_WEBHOOK_SECRET_HEADER)?.trim();
  if (header) return header;
  const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]?.trim();
  if (bearer) return bearer;
  try {
    return new URL(request.url).searchParams.get("token")?.trim() ?? "";
  } catch {
    return "";
  }
}

export type InboundWebhookAuthorisation =
  { outcome: "authorised"; secret: string } | { outcome: "notConfigured" } | { outcome: "refused" };

/** Whether this request carries the configured inbound secret. */
export function authoriseInboundWebhookRequest(request: Request, env: Env = process.env): InboundWebhookAuthorisation {
  const secret = inboundWebhookSecret(env);
  if (secret === null) return { outcome: "notConfigured" };
  const presented = presentedSecret(request);
  if (presented === "") return { outcome: "refused" };
  return sameInboundSecret(presented, secret) ? { outcome: "authorised", secret } : { outcome: "refused" };
}
