// src/lib/caring-contacts/audit.ts
//
// Frozen, patient-data-free audit trail records for caring-contact actions.
//
// Contract (decision lock, 2026-08-19):
//   * every event names the actor, its roles, the team, the action, the kind and id of the object
//     acted on, and whether the action was allowed, denied, or failed -- never why in clinical terms;
//   * an event must never carry a mobile number, a message body, or any free clinical text -- the
//     guard below rejects both by value (a mobile-number pattern) and by field name (a configurable
//     denylist), so a caller cannot smuggle patient data through an unexpected field, even one the
//     type checker never saw;
//   * every event is frozen at construction. An audit record that can be edited after the fact is
//     not an audit record.
//
// Pure and deterministic given a clock: buildAuditEvent never reaches for a datastore or any clock
// other than the one it is handed.
import { awstIsoTimestamp, type Clock } from "./clock";
import type { ActorId, IdempotencyKey, TeamId } from "./ids";

export type AuditOutcome = "allowed" | "denied" | "failed";

export type AuditableChange = {
  actorId: ActorId;
  actorRoles: readonly string[];
  /** Primary actor role signature (e.g. clinician, coordinator, supervisor). */
  actorRole?: string;
  teamId: TeamId;
  action: string;
  objectType: string;
  objectId: string;
  outcome: AuditOutcome;
  idempotencyKey: IdempotencyKey;
};

export type AuditEvent = AuditableChange & {
  /** ISO-8601 instant with an explicit numeric offset (AWST, +08:00 year-round -- see clock.ts). */
  timestamp: string;
  /** Primary actor role signature (e.g. clinician, coordinator, supervisor). */
  actorRole: string;
};

/**
 * Standard audit trail entry format for export and serialization (#Q8NMM3).
 */
export type CaringContactsAuditEntry = AuditEvent;

/**
 * Australian mobile numbers, in every form this codebase has produced them: spaced
 * ("+61 491 570 156"), unspaced ("+61491570156"), and the 04xx local form, spaced or not
 * ("0491 570 156" / "0491570156").
 */
const AU_MOBILE_NUMBER_PATTERN = /(?:\+?61[ .-]?4\d{2}[ .-]?\d{3}[ .-]?\d{3})|(?:\b04\d{2}[ .-]?\d{3}[ .-]?\d{3}\b)/;

/**
 * Whether a value contains something the audit guard would read as an Australian mobile number.
 * Exported so a request boundary can refuse such a value up front, with a 400, instead of letting
 * it reach the audit trail and be rejected there.
 */
export function containsAuMobileNumber(value: string): boolean {
  return AU_MOBILE_NUMBER_PATTERN.test(value);
}

/**
 * Field names that must never appear on an audit event, regardless of value -- these are the
 * shapes patient data takes elsewhere in this domain (see message-policy.ts). Exported so a
 * caller with a wider denylist can extend the guard instead of forking it.
 */
export const DEFAULT_FORBIDDEN_AUDIT_FIELD_NAMES: readonly string[] = Object.freeze([
  "mobileNumber",
  "mobile",
  "phoneNumber",
  "patientMobileNumber",
  "messageBody",
  "message",
  "text",
  "clinicalNote",
  "note",
  "notes",
  "patientName",
  "name",
  // The name a patient asked to be called (2026-08-26). Its own entry rather than being covered by
  // "name" above, because the guard matches a field name exactly -- and this is no less a patient's
  // own name for being the one they chose.
  "preferredName",
  "culturalIdentity",
]);

export class AuditEventContainsPatientDataError extends Error {
  constructor(reason: string) {
    super(`audit-event-contains-patient-data: ${reason}`);
    this.name = "audit-event-contains-patient-data";
  }
}

/**
 * Throws `AuditEventContainsPatientDataError` if any own field's value matches the mobile-number
 * pattern, or if any own field name is in `forbiddenFieldNames`. Runs against every own key on
 * `input`, not just the keys the caller's declared type has, so a loosely-typed caller (or one
 * that spreads extra data onto the object) cannot smuggle a field past the type checker.
 */
export function assertAuditEventFreeOfPatientData(
  input: Record<string, unknown>,
  forbiddenFieldNames: readonly string[] = DEFAULT_FORBIDDEN_AUDIT_FIELD_NAMES,
): void {
  for (const [field, value] of Object.entries(input)) {
    if (forbiddenFieldNames.includes(field)) {
      throw new AuditEventContainsPatientDataError(`forbidden field name "${field}"`);
    }
    const candidates = Array.isArray(value) ? value : [value];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && AU_MOBILE_NUMBER_PATTERN.test(candidate)) {
        throw new AuditEventContainsPatientDataError(`mobile-number pattern matched in field "${field}"`);
      }
    }
  }
}

/**
 * Builds a frozen audit event from `input` and `clock`. Pure and deterministic given the clock:
 * the same input and the same clock always produce byte-identical output. Throws
 * `AuditEventContainsPatientDataError` before constructing anything if `input` fails the guard.
 */
export function buildAuditEvent(input: AuditableChange, clock: Clock): AuditEvent {
  assertAuditEventFreeOfPatientData(input as unknown as Record<string, unknown>);

  const rawRole = typeof input.actorRole === "string" ? input.actorRole.trim() : "";
  const fallbackRole = input.actorRoles.find((r) => typeof r === "string" && r.trim() !== "")?.trim() ?? "unknown";
  const actorRole = rawRole !== "" ? rawRole : fallbackRole;

  const event: AuditEvent = {
    actorId: input.actorId,
    actorRoles: Object.freeze([...input.actorRoles]),
    actorRole,
    teamId: input.teamId,
    action: input.action,
    objectType: input.objectType,
    objectId: input.objectId,
    outcome: input.outcome,
    idempotencyKey: input.idempotencyKey,
    timestamp: awstIsoTimestamp(clock.now()),
  };
  return Object.freeze(event);
}

/**
 * Serializes an audit trail entry for export, capturing the actorRole signature (#Q8NMM3).
 */
export function serializeAuditEntry(entry: CaringContactsAuditEntry): string {
  return JSON.stringify({
    timestamp: entry.timestamp,
    actorId: entry.actorId,
    actorRole: entry.actorRole,
    actorRoles: entry.actorRoles,
    teamId: entry.teamId,
    action: entry.action,
    objectType: entry.objectType,
    objectId: entry.objectId,
    outcome: entry.outcome,
    idempotencyKey: entry.idempotencyKey,
  });
}

/**
 * Serializes an array of audit trail entries into newline-delimited JSON for export.
 */
export function serializeAuditTrail(entries: readonly CaringContactsAuditEntry[]): string {
  return entries.map((entry) => serializeAuditEntry(entry)).join("\n");
}

/**
 * Deserializes an exported audit trail entry, verifying that no patient data is present
 * and validating all required schema properties.
 */
export function deserializeAuditEntry(serialized: string): CaringContactsAuditEntry {
  const parsed = JSON.parse(serialized) as Record<string, unknown>;
  assertAuditEventFreeOfPatientData(parsed);

  if (typeof parsed.timestamp !== "string" || !parsed.timestamp) {
    throw new Error("Invalid audit entry: missing or invalid timestamp");
  }
  if (typeof parsed.actorId !== "string" || !parsed.actorId) {
    throw new Error("Invalid audit entry: missing or invalid actorId");
  }
  if (typeof parsed.teamId !== "string" || !parsed.teamId) {
    throw new Error("Invalid audit entry: missing or invalid teamId");
  }
  if (typeof parsed.action !== "string" || !parsed.action) {
    throw new Error("Invalid audit entry: missing or invalid action");
  }
  if (typeof parsed.objectType !== "string" || !parsed.objectType) {
    throw new Error("Invalid audit entry: missing or invalid objectType");
  }
  if (typeof parsed.objectId !== "string" || !parsed.objectId) {
    throw new Error("Invalid audit entry: missing or invalid objectId");
  }
  if (typeof parsed.outcome !== "string" || !["allowed", "denied", "failed"].includes(parsed.outcome)) {
    throw new Error("Invalid audit entry: missing or invalid outcome");
  }
  if (typeof parsed.idempotencyKey !== "string" || !parsed.idempotencyKey) {
    throw new Error("Invalid audit entry: missing or invalid idempotencyKey");
  }

  const rawRoles = Array.isArray(parsed.actorRoles)
    ? parsed.actorRoles.filter((r): r is string => typeof r === "string" && r.trim() !== "")
    : [];
  const rawRole =
    typeof parsed.actorRole === "string" && parsed.actorRole.trim() !== "" ? parsed.actorRole.trim() : undefined;
  const actorRole = rawRole ?? rawRoles[0] ?? "unknown";
  const actorRoles = rawRoles.length > 0 ? rawRoles : [actorRole];

  return Object.freeze({
    timestamp: parsed.timestamp,
    actorId: parsed.actorId as ActorId,
    actorRole,
    actorRoles: Object.freeze(actorRoles),
    teamId: parsed.teamId as TeamId,
    action: parsed.action,
    objectType: parsed.objectType,
    objectId: parsed.objectId,
    outcome: parsed.outcome as AuditOutcome,
    idempotencyKey: parsed.idempotencyKey as IdempotencyKey,
  });
}

/**
 * Deserializes an exported newline-delimited JSON audit trail into an array of CaringContactsAuditEntry.
 */
export function deserializeAuditTrail(serialized: string): CaringContactsAuditEntry[] {
  const lines = serialized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.map((line) => deserializeAuditEntry(line));
}
