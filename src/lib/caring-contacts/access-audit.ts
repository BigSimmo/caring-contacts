// src/lib/caring-contacts/access-audit.ts
//
// Typed access-audit events -- the read-side half of the audit trail.
//
// Contract (decision lock, 2026-08-19, spec §4.2): the audit trail must record "every search,
// view, decision, mutation, write-back and administrative access". `buildAuditEvent` (see
// audit.ts) covers a mutation that REACHES a store, because `runWrite` calls it directly. This
// module gives every other kind -- view, search, export, administrative access, and the one class
// of mutation `runWrite` can never see -- a typed shape and a single constructor path, so a read
// enters the same patient-data-free trail a write already does.
//
// Ruling 45 (2026-08-22) added `"mutation"`. A write refused by the API boundary's capability
// check never reaches a store, so `runWrite` never runs and the refusal produced no record at all
// -- the one gap in "every mutation". The boundary now records it here instead. It is deliberately
// NOT used for a write that reaches a store: that one is already audited there, and recording both
// would count it twice.
//
// `buildAccessAuditEvent` delegates to `buildAuditEvent` rather than constructing an `AuditEvent`
// itself: there must be exactly one audit-event constructor in this codebase, so a future change
// to the audit shape (a new required field, a stricter guard) cannot miss the access path by
// having its own parallel construction to forget.
//
// A denied read is still an access attempt and still belongs in the trail -- `outcome` is part of
// `AccessRecord` precisely so a caller can record "denied" rather than dropping the event.
import { AuditEventContainsPatientDataError, buildAuditEvent, type AuditEvent, type AuditOutcome } from "./audit";
import { awstIsoTimestamp, type Clock } from "./clock";
import { idempotencyKey as makeIdempotencyKey, type ActorId, type TeamId } from "./ids";

/**
 * `"mutation"` is for a write REFUSED BEFORE IT REACHED A STORE (see the Ruling 45 note above),
 * never for one the store accepted or refused on its own terms.
 */
export type AccessKind = "view" | "search" | "export" | "administrative" | "mutation";

/**
 * Every surface an access can name. Ruling 46 (2026-08-22) added the last four: before them the
 * API boundary had to record a service-state read and a training-record read as the same
 * `"report"`, which made the two indistinguishable in the trail and defeated the point of having
 * an object type at all. Add a member here rather than reaching for `"report"` as a catch-all --
 * `"report"` means a report.
 */
export type AccessedObjectType =
  | "plan"
  | "contact"
  | "episode"
  | "auditTrail"
  | "report"
  | "patientDirectory"
  /**
   * A read of patients' NAMES and nothing else -- `listPatientNames` (Ruling 91).
   *
   * Its own member rather than a reuse of `patientDirectory`, and the choice is forced rather than
   * stylistic: the trail's query surface (`api/caring-contacts/access-trail`) filters on
   * `objectType` and offers NO `objectId` filter, so a read recorded as `patientDirectory` with a
   * distinguishing `objectId` can be picked out by eye but cannot be ASKED for. "Who read patients'
   * names, and when" is precisely the question the separate read exists to make answerable, and
   * `patientDirectory` already carries two referral reads -- so sharing it would have returned name
   * reads mixed with referral searches and no way to separate them server-side. This is Ruling 46's
   * own instruction followed: add a member rather than overload an existing one.
   */
  | "patientName"
  /**
   * A read of the team's SCHEDULE -- which contacts fall on which AWST days, and what each day's
   * sending windows hold (Phase 2B Task 12).
   *
   * Its own member rather than a reuse of `plan`, on this type's own instruction above. The read is
   * derived from `listPlans`, so recording it as `plan` would be defensible by provenance and wrong
   * by meaning: `plan` already names the caseload read that every list screen performs, and the
   * question a trail must answer is who looked at what, not which store call it went through. The
   * two are asked about differently -- a caseload read is one clinician opening their patient list,
   * a schedule read is one clinician looking at a particular set of days -- and with no `objectId`
   * filter on the trail's query surface, a shared member would make them one undifferentiated
   * stream.
   */
  | "contactSchedule"
  /**
   * A read of WHERE THE TEAM'S WORK SITS -- the roster behind the Team screen (Phase 2B Task 17):
   * every plan's owner, the unclaimed group, and each coordinator's backlog, together.
   *
   * Its own member, decided against Ruling [134] rather than by Ruling [46]'s letter, because the
   * two rulings pull opposite ways and the reasoning is the ruling. Ruling [134] collapsed the
   * Templates library into `pathwayVersion` because that read was BYTE-IDENTICAL to one that
   * already existed, so a second member would have named a screen rather than an object and split
   * one askable question into two. This read is not identical to anything: no existing read joins
   * `listPlans` to every plan's `getAssignment`, so recording it as `plan` would put "who looked at
   * how work is distributed across the team" into the caseload's stream -- and with no `objectId`
   * filter on the trail's query surface, it could then be picked out by eye and never asked for.
   * That is Ruling [46]'s reason, and it reaches here.
   */
  | "teamWorkload"
  | "notificationPreferences"
  | "trainingRecord"
  | "pathwayVersion"
  | "serviceState";

export type AccessRecord = {
  actorId: ActorId;
  actorRoles: readonly string[];
  teamId: TeamId;
  kind: AccessKind;
  objectType: AccessedObjectType;
  objectId: string;
  outcome: AuditOutcome;
};

/** The action-name prefix every access-audit event carries, distinguishing it from a write action. */
export const ACCESS_ACTION_PREFIX = "access" as const;

/**
 * `access:<kind>:<objectType>` -- lets a trail be filtered to reads (or to one read kind, or one
 * object type) with a string match instead of a second table or a boolean column.
 */
export function accessActionName(kind: AccessKind, objectType: AccessedObjectType): string {
  return `${ACCESS_ACTION_PREFIX}:${kind}:${objectType}`;
}

/**
 * An allowlist, not a name detector. `audit.ts`'s mobile-number scan catches a phone number
 * anywhere in a field, but a patient name has no digits to catch, and a denylist of "name-shaped"
 * strings cannot be made reliable -- a two-word name and a legitimate free-text identifier are
 * indistinguishable in general. What *is* reliably knowable is the closed set of shapes an
 * `objectId` legitimately takes in this domain: a namespaced synthetic id (`SYN-PLAN-001`), a
 * slug-style actor id (`demo-coordinator`), a bare object-type name (`patientDirectory`), or a
 * uuid. None of those needs whitespace, punctuation beyond hyphen/underscore/colon, or unbounded
 * length -- and a search term or a patient name almost always does. The surface being searched
 * (`objectType`, `kind`) is what gets recorded; the query itself is never an identifier and must
 * never reach `objectId`. Do not replace this allowlist with a name heuristic: heuristics regress
 * the moment a new plausible name shape appears, allowlists on a closed id grammar do not.
 */
export const ACCESS_OBJECT_ID_PATTERN = /^[A-Za-z0-9_:-]{1,128}$/;

/**
 * Exported so a caller can constrain an identifier BEFORE it reaches this module, against this
 * exact grammar rather than a second, looser copy of it. Fix round 1, Important 1: the API
 * boundary accepted `z.string().min(1)` for identifiers that became an `objectId`, so a caller
 * could make `buildAccessAuditEvent` throw -- and switch off their own audit record -- by typing a
 * space.
 */
export function isAccessObjectIdShape(value: string): boolean {
  return ACCESS_OBJECT_ID_PATTERN.test(value);
}

function assertObjectIdIsAnIdentifierShape(objectId: string): void {
  if (!isAccessObjectIdShape(objectId)) {
    throw new AuditEventContainsPatientDataError(
      "objectId is not identifier-shaped -- a search term or a name must never be recorded as an objectId",
    );
  }
}

/**
 * Builds a frozen `AuditEvent` for a read/administrative access, through the same constructor a
 * write uses. Validates `objectId` against the identifier-shape allowlist above before anything
 * else runs, then delegates to `buildAuditEvent`, whose own mobile-number/forbidden-field scan
 * still runs on the assembled event as a second, independent line of defence -- this function
 * does not replace that scan, it adds a check the scan cannot make.
 */
export function buildAccessAuditEvent(record: AccessRecord, clock: Clock): AuditEvent {
  assertObjectIdIsAnIdentifierShape(record.objectId);

  const action = accessActionName(record.kind, record.objectType);
  const timestamp = awstIsoTimestamp(clock.now());
  const idempotencyKey = makeIdempotencyKey(
    `access:${record.actorId}:${record.objectType}:${record.objectId}:${timestamp}`,
  );

  return buildAuditEvent(
    {
      actorId: record.actorId,
      actorRoles: record.actorRoles,
      teamId: record.teamId,
      action,
      objectType: record.objectType,
      objectId: record.objectId,
      outcome: record.outcome,
      idempotencyKey,
    },
    clock,
  );
}
