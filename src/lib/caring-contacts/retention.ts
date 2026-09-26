// src/lib/caring-contacts/retention.ts
//
// Retention policy and de-identification for caring-contact episodes and their audit trail.
//
// Contract (decision lock, 2026-08-19):
//   * DEFAULT_RETENTION_POLICY holds the one hard-coded retention period in this module -- every
//     other file in this directory reaches for it (or an explicit override) rather than repeating
//     the number. A sibling-scanning test in this suite enforces that.
//   * an episode becomes due for de-identification only once it has reached a terminal state AND
//     the policy period has elapsed since it did, measured in AWST calendar days -- never UTC, and
//     never from any other milestone.
//   * de-identifying an episode removes everything that identifies the patient -- name, mobile,
//     identifiers, cultural identity, and the preferred name they asked to be called -- and keeps
//     everything needed for aggregate reporting (plan dates, pathway version, team, outcome,
//     counts).
//   * de-identifying an audit event keeps only the five fields that tell the story of what
//     happened -- actor id, action, timestamp, object type, outcome -- and drops everything else,
//     including the object id, which could otherwise point back at a specific patient's record.
//   * both de-identification functions are idempotent: applying either a second time returns the
//     same value as applying it once, so a caller never has to track whether it already ran.
import type { AuditEvent, AuditOutcome } from "./audit";
import { awstCalendarDay, systemClock } from "./clock";
import type { Clock } from "./clock";
import type { DeidentifiedEpisode, Episode, EpisodeState } from "./episode";
import type { ActorId } from "./ids";
import type { TransitionResult } from "./model";
import type { IncidentNoteArchiveResult } from "./types";

export type { IncidentCaseNote, IncidentNoteArchiveResult } from "./types";

export type RetentionPolicy = { years: number };

/** The one hard-coded retention period in this domain. Callers may override it per call. */
export const DEFAULT_RETENTION_POLICY: RetentionPolicy = Object.freeze({ years: 7 });

// The episode shape moved to ./episode so the datastore can project one without importing this
// policy module, which the sibling guard in tests/caring-contacts-retention.test.ts forbids. It is
// re-exported here unchanged, so every existing import of these names still resolves.
export type { DeidentifiedEpisode, Episode, EpisodeCounts, EpisodePlanDates, EpisodeState } from "./episode";

const TERMINAL_EPISODE_STATES: readonly EpisodeState[] = Object.freeze(["withdrawn", "cancelled", "completed"]);

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** Adds whole years to an AWST calendar day, clamping 29 Feb to 28 Feb in a non-leap target year. */
function addYearsToCalendarDay(calendarDay: string, years: number): string {
  const [year, month, day] = calendarDay.split("-").map(Number);
  const targetYear = year + years;
  const clampedDay = Math.min(day, daysInMonth(targetYear, month));
  return `${String(targetYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
}

/**
 * True only once an episode has reached a terminal state and `policy.years` whole years have
 * elapsed since it did, both sides measured as an AWST calendar day. An episode that has not
 * completed, or whose completion instant is unknown, is never due.
 */
export function isDueForDeidentification(episode: Episode, policy: RetentionPolicy, clock: Clock): boolean {
  if (!TERMINAL_EPISODE_STATES.includes(episode.state)) return false;
  if (episode.planDates.completedAt === null) return false;

  const completedCalendarDay = awstCalendarDay(episode.planDates.completedAt);
  const dueCalendarDay = addYearsToCalendarDay(completedCalendarDay, policy.years);
  const nowCalendarDay = awstCalendarDay(clock.now());
  return nowCalendarDay >= dueCalendarDay;
}

/**
 * The two facts a clearance decision turns on, and deliberately nothing else.
 *
 * Narrowed rather than taking a whole `Episode` for the same reason `ServiceStopBannerFacts` is
 * narrowed in ./service-state: a store asking this question holds a plan row, not an assembled
 * episode, and a wider parameter would invite the rule to start reading fields it has no business
 * in. `Episode` is structurally assignable to it, so a caller that does hold one just passes it.
 */
export type RetentionClearanceFacts = {
  state: EpisodeState;
  planDates: { completedAt: Date | null };
};

/**
 * Whether an episode's identifying detail may be cleared now, and the instant it ended.
 *
 * OWNER DECISION (2026-09-26): identifying patient data may be cleared only once the retention
 * period has passed since the plan ended -- `DEFAULT_RETENTION_POLICY`, seven years, measured in
 * AWST calendar days exactly as `isDueForDeidentification` measures it -- and NOT immediately on
 * ending. A clinical record has to stay readable for the whole retention period; clearing it the
 * day a plan ended would destroy it early.
 *
 * Refusals, each by name:
 *   * `retention-episode-not-terminal` -- the episode has not ended, or its end instant was never
 *     recorded. Both are the same fact from the storage layer's side: there is no end instant to
 *     measure the period from.
 *   * `retention-period-not-elapsed` -- it ended, but the period since has not yet passed.
 *
 * Returning the end instant is not a convenience. A stored clearance is only interpretable beside
 * the end it is measured from, which is why the schema's own `retention_state_cleared_after_terminal`
 * refuses one without the other.
 *
 * Pure transition: the caller injects the clock, and has already authorised the action; recording
 * it in the audit trail is likewise the caller's job.
 */
export function admitRetentionClearance(
  episode: RetentionClearanceFacts,
  clock: Clock,
  policy: RetentionPolicy = DEFAULT_RETENTION_POLICY,
): TransitionResult<Date> {
  if (!TERMINAL_EPISODE_STATES.includes(episode.state)) {
    return { ok: false, reason: "retention-episode-not-terminal" };
  }
  const { completedAt } = episode.planDates;
  if (completedAt === null) return { ok: false, reason: "retention-episode-not-terminal" };
  const dueCalendarDay = addYearsToCalendarDay(awstCalendarDay(completedAt), policy.years);
  if (awstCalendarDay(clock.now()) < dueCalendarDay) {
    return { ok: false, reason: "retention-period-not-elapsed" };
  }
  return { ok: true, value: new Date(completedAt.getTime()) };
}

/**
 * Removes patient name, mobile number, identifiers, cultural identity, and the preferred name;
 * keeps plan dates, pathway version, team, outcome, and counts. Accepts an already-de-identified
 * episode too, so applying it twice is exactly the same as applying it once.
 *
 * It removes by CONSTRUCTION rather than by deletion -- it names the fields a `DeidentifiedEpisode`
 * keeps and builds a new object from those, so a field added to `Episode` is absent from the result
 * without this function being touched. That is how `preferredName` arrived already removed. The
 * stores are the half that can forget, which is why the clearance is pinned in the shared contract
 * suite rather than here.
 */
export function deidentifyEpisode(episode: Episode | DeidentifiedEpisode): DeidentifiedEpisode {
  const { state, planDates, pathwayVersionId, teamId, outcome, counts } = episode;
  return Object.freeze({
    state,
    planDates: Object.freeze({ ...planDates }),
    pathwayVersionId,
    teamId,
    outcome,
    counts: Object.freeze({ ...counts }),
  });
}

export type DeidentifiedAuditEvent = {
  actorId: ActorId;
  action: string;
  timestamp: string;
  objectType: string;
  outcome: AuditOutcome;
  /** Always cleared: the object id can point back at a specific patient's record. */
  objectId: string;
};

/**
 * Keeps exactly actor id, action, timestamp, object type, and outcome; clears object id and drops
 * every other field (actor roles, team id, idempotency key). Accepts an already-de-identified
 * event too, so applying it twice is exactly the same as applying it once.
 */
export function deidentifyAuditEvent(event: AuditEvent | DeidentifiedAuditEvent): DeidentifiedAuditEvent {
  const { actorId, action, timestamp, objectType, outcome } = event;
  return Object.freeze({ actorId, action, timestamp, objectType, outcome, objectId: "" });
}

// ---------------------------------------------------------------------------
// Incident Responder Notes & Retention Policy (#JZ8B36)
//
// Formalizing the lightweight case-note capability on `service_stops.note`:
//
// 1. Retention disposition during episode lifecycle:
//    Notes written by responders mid-incident on `service_stops.note` are free text containing
//    clinical and patient details ("Treat it as patient data").
//    Throughout the episode lifecycle, notes are strictly immutable, enforced at the storage
//    layer by the `assert_service_stop_immutable` trigger (Rulings 30 and 32). UPDATE is
//    forbidden across all incident note fields.
//
// 2. Governed archival path vs permanent unremovability (Ruling 34 & Owner Decision 2026-08-21):
//    DELETE was deliberately left unblocked on `service_stops` so that patient case notes would
//    not become permanently unremovable, while avoiding accidental or un-governed deletion.
//    Notes must not be deleted or purged ad-hoc during the active episode lifecycle.
//    Once an episode has concluded and reached a terminal state ("withdrawn", "cancelled",
//    "completed") and the mandatory clinical record retention period has elapsed (7 years in AWST
//    calendar days under DEFAULT_RETENTION_POLICY), the notes become eligible for governed
//    archival and de-identification via `archiveIncidentNotes`.
// ---------------------------------------------------------------------------

/**
 * Dedicated, governed retention archival gate for safety-incident responder notes (#JZ8B36).
 *
 * Episode context is mandatory: terminal state and elapsed retention (7 years via
 * DEFAULT_RETENTION_POLICY, AWST) are always checked. The string overload must supply `episode`
 * (5th argument); omitting it fails closed rather than reporting a successful archival.
 *
 * This pure function does not read, delete, de-identify, or persist notes. It therefore never
 * returns `archived: true`. A storage-backed archiver must perform the archival and record
 * success only after notes are actually removed or de-identified.
 */
export function archiveIncidentNotes(
  episode: Episode,
  reason: string,
  policy?: RetentionPolicy,
  clock?: Clock,
): IncidentNoteArchiveResult;
export function archiveIncidentNotes(
  episodeId: string,
  reason: string,
  policy?: RetentionPolicy,
  clock?: Clock,
  episode?: Episode,
): IncidentNoteArchiveResult;
export function archiveIncidentNotes(
  episodeOrId: string | Episode,
  reason: string,
  policy: RetentionPolicy = DEFAULT_RETENTION_POLICY,
  clock: Clock = systemClock(),
  episodeContext?: Episode,
): IncidentNoteArchiveResult {
  const isEpisodeObject = typeof episodeOrId === "object" && episodeOrId !== null;
  const episode = isEpisodeObject ? episodeOrId : episodeContext;
  const episodeId = isEpisodeObject
    ? ((episodeOrId as unknown as { id?: string; episodeId?: string }).id ??
      (episodeOrId as unknown as { id?: string; episodeId?: string }).episodeId ??
      "episode")
    : episodeOrId;

  if (!episodeId || episodeId.trim() === "") {
    return { ok: false, episodeId: "", archived: false, reason: "missing-episode-id" };
  }
  if (!reason || reason.trim() === "") {
    return { ok: false, episodeId, archived: false, reason: "missing-reason" };
  }
  if (!policy || typeof policy.years !== "number" || policy.years <= 0 || !Number.isFinite(policy.years)) {
    return { ok: false, episodeId, archived: false, reason: "invalid-retention-policy" };
  }

  // String overload without Episode cannot check terminal/retention rules — fail closed.
  if (!episode) {
    return { ok: false, episodeId, archived: false, reason: "missing-episode-context" };
  }

  if (!TERMINAL_EPISODE_STATES.includes(episode.state)) {
    return { ok: false, episodeId, archived: false, reason: "retention-episode-not-terminal" };
  }
  if (episode.planDates.completedAt === null) {
    return { ok: false, episodeId, archived: false, reason: "retention-episode-not-terminal" };
  }
  if (!isDueForDeidentification(episode, policy, clock)) {
    return { ok: false, episodeId, archived: false, reason: "retention-period-not-elapsed" };
  }

  // Eligibility passed, but this function has no storage backend — do not claim archival.
  return {
    ok: false,
    episodeId,
    archived: false,
    reason: "archival-not-persisted",
  };
}
