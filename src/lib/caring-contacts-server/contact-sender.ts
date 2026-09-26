// src/lib/caring-contacts-server/contact-sender.ts
//
// Server glue for the scheduled sender and the delivery-receipt webhook: reads the settings, picks
// the transport, and checks that a caller is the scheduler it claims to be. The rules themselves
// live in ../caring-contacts/sender.ts.
//
// Settings (see .env.example and deploy/australia/README.md, "Text messages"):
//   CARING_CONTACTS_SENDER_SECRET     32+ characters. The scheduler sends it as
//                                     "Authorization: Bearer <secret>". Unset = the run route is off.
//   CARING_CONTACTS_SENDER_TEAM_IDS   comma-separated team ids the sender works for. Defaults to the
//                                     demo team only while the demo is running.
//   plus the transport settings in ../caring-contacts/transport/config.ts.
import "server-only";

import { timingSafeEqual } from "node:crypto";

import { teamId, type PlanId, type TeamId } from "@/lib/caring-contacts/ids";
import type { TransitionResult } from "@/lib/caring-contacts/model";
import { PATHWAY_WORDING_MISSING_REFUSAL, unwrittenScheduledMessageTypes } from "@/lib/caring-contacts/pathway-wording";
import type { Actor } from "@/lib/caring-contacts/permissions";
import type { CaringContactRepository } from "@/lib/caring-contacts/repository";
import {
  configuredTransportKind,
  resolveMessageTransport,
  type ResolvedTransport,
} from "@/lib/caring-contacts/transport/config";
import { buildDeliveryReceiptUrl } from "@/lib/caring-contacts/transport/delivery-link";

import { DEMO_TEAM_ID } from "./session";
import { isCaringContactsDemoEnabled, isCaringContactsLiveEnabled } from "./workspace-gate";

export const SENDER_SECRET_VAR = "CARING_CONTACTS_SENDER_SECRET";
export const SENDER_TEAM_IDS_VAR = "CARING_CONTACTS_SENDER_TEAM_IDS";
const MINIMUM_SECRET_LENGTH = 32;

type Env = Record<string, string | undefined>;

/** The teams the sender works for. Never guessed in live mode: an unset list sends nothing. */
export function senderTeamIds(env: Env = process.env): TeamId[] {
  const configured = (env[SENDER_TEAM_IDS_VAR] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");
  if (configured.length > 0) return [...new Set(configured)].map((value) => teamId(value));
  return isCaringContactsDemoEnabled(env.NODE_ENV as typeof process.env.NODE_ENV, env) ? [DEMO_TEAM_ID] : [];
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type SchedulerAuthorisation = "authorised" | "notConfigured" | "refused";

/** Whether this request carries the scheduler's bearer secret. */
export function authoriseSchedulerRequest(headers: Headers, env: Env = process.env): SchedulerAuthorisation {
  const secret = env[SENDER_SECRET_VAR]?.trim();
  if (!secret || secret.length < MINIMUM_SECRET_LENGTH) return "notConfigured";
  const header = headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return "refused";
  return sameSecret(match[1].trim(), secret) ? "authorised" : "refused";
}

export class RealSendingNeedsLiveModeError extends Error {
  constructor() {
    super(
      "Caring Contacts refuses to send real text messages outside live mode. Real sending needs " +
        "CARING_CONTACTS_DEMO_ENABLED=false with the live-mode settings, so no demo (forgeable) sign-in " +
        "can ever sit in front of a real carrier.",
    );
    this.name = "RealSendingNeedsLiveModeError";
  }
}

const TRANSPORT_GLOBAL_KEY = "__caringContactsResolvedTelstraTransport";
type GlobalWithTransport = typeof globalThis & { [TRANSPORT_GLOBAL_KEY]?: ResolvedTransport };

/**
 * The transport for this process. The simulated transport is built fresh for each run so its
 * record of sends never grows without bound; a real carrier's is kept so its access token is reused.
 * Throws (and so sends nothing) on any incomplete or unsafe real-sending setup.
 */
export function senderTransport(
  env: Env = process.env,
  options: { requireLiveModeForRealSending?: boolean } = {},
): ResolvedTransport {
  const runtime = globalThis as GlobalWithTransport;
  const cached = runtime[TRANSPORT_GLOBAL_KEY];
  if (cached) return cached;
  const resolved = resolveMessageTransport(env);
  if (resolved.transport.kind === "simulated") return resolved;
  if (
    (options.requireLiveModeForRealSending ?? true) &&
    !isCaringContactsLiveEnabled(env.NODE_ENV as typeof process.env.NODE_ENV, env)
  ) {
    throw new RealSendingNeedsLiveModeError();
  }
  runtime[TRANSPORT_GLOBAL_KEY] = resolved;
  return resolved;
}

/** Test-only: forget the cached real transport. */
export function resetSenderTransportForTests(): void {
  Reflect.deleteProperty(globalThis, TRANSPORT_GLOBAL_KEY);
}

/** Builds the per-contact receipt address function the sender hands to the carrier. */
export function deliveryReceiptUrlBuilder(resolved: ResolvedTransport) {
  const receipts = resolved.deliveryReceipts;
  if (!receipts) return undefined;
  return (reference: { teamId: string; planId: string; contactId: string }) =>
    buildDeliveryReceiptUrl(receipts.publicBaseUrl, reference, receipts.secret);
}

/**
 * The fixed text of the staff connection test. Staff-facing, never sent to a patient, carries no
 * clinical content and asks for nothing.
 */
export const CONNECTION_TEST_MESSAGE =
  "Caring Contacts: this is a staff test of the text-message connection. No action is needed.";

/**
 * Activation's wording check. With real sending switched on (or its setting unreadable), a plan
 * whose pathway has no wording for one of its scheduled message types is refused by name before
 * it starts, so no patient is enrolled on a schedule whose first or closing message could never be
 * sent. With the simulated transport nothing reaches a phone, so activation proceeds and the sender
 * marks those contacts for review when they fall due -- which keeps the demo pathway (which has no
 * first or closing wording yet) usable.
 */
export async function activationWordingRefusal(
  store: CaringContactRepository,
  actor: Actor,
  plan: PlanId,
  env: Env = process.env,
): Promise<TransitionResult<never> | null> {
  let kind: "simulated" | "telstra" | "unreadable";
  try {
    kind = configuredTransportKind(env);
  } catch {
    kind = "unreadable";
  }
  if (kind === "simulated") return null;
  const record = await store.getPlan(plan, { actor });
  if (!record) return null; // The store's own activation refuses a plan this actor cannot see.
  const version = await store.getPathwayVersion(record.pathwayVersionId, { actor });
  if (!version) return { ok: false, reason: PATHWAY_WORDING_MISSING_REFUSAL };
  const missing = unwrittenScheduledMessageTypes(version.snapshot, await store.listContacts(plan, { actor }));
  return missing.length > 0 ? { ok: false, reason: PATHWAY_WORDING_MISSING_REFUSAL } : null;
}
