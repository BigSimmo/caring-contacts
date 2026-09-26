// src/lib/caring-contacts/repository.ts
//
// The storage contract every caring-contact change passes through.
//
// Contract (decision lock, 2026-08-19):
//   * every write carries an idempotency key; replaying that key returns the ORIGINAL result and
//     performs no second change, so a retried request can never send a second caring contact;
//   * every write appends exactly one audit event, atomically with the change — if the audit
//     record cannot be produced or accepted, the change does not happen either;
//   * every write states the version it expected; a write against a stale version is refused by
//     name rather than overwriting whatever another actor did in between;
//   * a patient may have only one non-terminal plan at a time;
//   * reads are scoped to the actor's team and return EMPTY for anything outside it — never a
//     refusal that would reveal a record exists.
//
// Every refusal is a named, machine-readable reason. Nothing here is thrown for an expected
// condition; a throw means the write could not be completed at all and nothing was recorded.
//
// WHAT THE REPLAY RECORD MAY HOLD. Both stores persist two things per write: an opaque fingerprint
// of the request (see ./fingerprint — hashed there so neither store can write the request's text
// into a row) and the ORIGINAL result, which a replay returns verbatim. The result is therefore
// bounded by the return types declared below, and those already exclude patient-identifying detail:
// every write returns a `PlanRecord`, `StoredContact`, `Referral`, `PathwayVersion`,
// `PlanAssignment`, `DispatchRecord`, `ServiceState`, `NotificationPreferences`, `TrainingRecord`
// or `void`, and no write returns any of `StoredPlan`'s `patientDetail`. That detail is released by
// READS alone, and only by two of them: `getEpisode`, which releases every field of it together --
// including the free-text first-contact reason, which is why that reason is filed there rather than
// on the plan -- and `listPatientNames`, which releases the name and structurally cannot release
// anything else. A new write
// that would put anything else identifying in a result needs a NARROWER RETURN TYPE, not a filter on
// the way into storage: the stored result is the answer a replay must return, so filtering it makes
// a genuine retry receive less than the first call did.
//
// The one free-text field that does reach it is `ServiceState.note`, and it is a KNOWN RESIDUAL
// rather than a settled decision. `stopService`'s row is written under the reporting team's own id,
// which is fine. `approveServiceRestart`'s is not: restart approvals are service-wide, so another
// team's approver stores the reporting team's note under THEIR team id, and this table's row-level
// security is team-scoped -- while `narrowServiceStateForActor` on the server surface gates that
// note behind `viewPatientRecord` for the reporting team. Narrowing `approveServiceRestart`'s
// return type is the recommended fix; it spans this contract and the API surface, so it was left
// for a decision rather than guessed at. See the wave A review report.
//
// This module is types, named constants, and the few pure helpers both stores would otherwise each
// declare for themselves. Both the in-memory store (Task 9) and the Postgres store (Task 11)
// implement it, and both are exercised by the identical contract suite.
import { teamId } from "./ids";
import type { AccessedObjectType, AccessRecord } from "./access-audit";
import type { PlanAssurance, PlanAssuranceAttestation } from "./assurances";
import type { AssignmentAction, PlanAssignment } from "./assignment";
import type { AuditEvent } from "./audit";
import type { Clock } from "./clock";
import type { ContactDateChangeRequest, ContactMoveRequest } from "./contact-rescheduling";
import type { HospitalStatusEvent, PlanException, PlanIncident, WithdrawalOrigin } from "./hospital-events";
import type {
  ActorId,
  ContactId,
  IdempotencyKey,
  PathwayVersionId,
  PatientId,
  PlanId,
  ReferralId,
  TeamId,
} from "./ids";
import { contactSendability, TERMINAL_PLAN_STATES } from "./model";
import type { Contact, Plan, PlanState, ProviderStatus, Referral, SendingPreference, TransitionResult } from "./model";
import type { NotificationPreferences } from "./notification-preferences";
import type { PathwayVersion, PathwayVersionAction } from "./pathway-versions";
import type { CaringContactAction, CaringContactActor } from "./permissions";
import type { ReferralIntakePayload } from "./referral-intake";
import type { ReferralAction } from "./referrals";
import type {
  ServiceRestartApprovalRole,
  ServiceRestartOutcome,
  ServiceState,
  ServiceStopReason,
  RestartApprovalSeatRoster,
} from "./service-state";
import type { TrainingCompetency, TrainingRecord } from "./training";
import type { Episode, EpisodeState } from "./episode";
import type { PlannedContact } from "./schedule";
import type {
  FollowUpInboundReplyInput,
  InboundReplyPlanMatch,
  InboundReplyRecord,
  InboundReplyWithText,
  RecordInboundReplyInput,
} from "./inbound-replies";

/**
 * Episode reconciliation (carried finding from Task 8).
 *
 * `Episode` and `DeidentifiedEpisode` are adopted verbatim from ./episode; this module defines no
 * competing episode shape. The division is:
 *   * `StoredPlan` is what the datastore holds — identifiers, versions, contacts, patient detail;
 *   * `Episode` is the reporting projection assembled from a `StoredPlan` on demand
 *     (`CaringContactRepository.getEpisode`), so the domain still has exactly one episode type.
 *
 * The projection maps `Plan.state` straight onto `Episode.state`. Those two unions are declared in
 * different modules, so the assertion below pins them as the same set: if a future edit adds a
 * state to one and not the other, this line stops compiling instead of the projection silently
 * narrowing an episode's state.
 */
type SameUnion<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const EPISODE_STATE_MATCHES_PLAN_STATE: SameUnion<PlanState, EpisodeState> = true;

/** `true` only while `T` has no property called `K`. Used below to pin a shape's ABSENCES. */
type LacksKey<T, K extends string> = K extends keyof T ? never : true;

/**
 * The fields that say who the patient is and what to call them. A CALLER supplies exactly these,
 * which is why `CreatePlanInput.patientDetail` still names this type rather than the wider stored
 * one below.
 *
 * `preferredName` joined them on 2026-08-26 and is patient content like the rest of them: it is
 * released by the one read that releases a name and removed by the one write that removes one. It
 * is ASKED FOR rather than derived from `patientName` -- see `Episode.preferredName` for why no
 * part of this domain splits a stored name.
 *
 * Taken from `Episode` so it cannot drift from it.
 */
export type EpisodePatientDetail = Pick<
  Episode,
  "patientName" | "patientMobileNumber" | "patientIdentifiers" | "culturalIdentity" | "preferredName"
>;

/**
 * Everything a stored plan holds ABOUT ITS PATIENT: the four identifying fields above, plus the
 * free-text reason a coordinator gave for moving the first contact off the programme's usual day.
 *
 * WHY THE REASON IS FILED HERE, AND NOT BESIDE THE PLAN DATES (Ruling 105). It is not a fact about
 * the person the way a name is; it is a fact about a scheduling decision. But it is PROSE A
 * CLINICIAN TYPED, and a real one reads "patient asked to wait until she is home from her
 * sister's" -- relatives, places, living arrangements. Judged by what it contains rather than by
 * what it is about, it belongs with the name, and that placement buys two guarantees that a field
 * sitting beside `dischargeAt` would not have had:
 *
 *   * IT CANNOT REACH A LIST READ. `StoredPlan` is `PlanRecord` plus this; `PlanRecord` is what
 *     `listPlans` returns and what the caseload renders for every patient in the team, and
 *     `toPlanRecord` in each store is the one function that crosses the line. A free-text clinical
 *     note fetched for a list screen was Task 5b's whole argument.
 *     `PLAN_RECORD_HOLDS_NO_FIRST_CONTACT_REASON` below turns that from a habit into a compile
 *     error.
 *   * A CLEARANCE CANNOT FORGET IT. `CLEARED_PATIENT_DETAIL` is declared as this type, so adding a
 *     field here and not to that constant stops the module compiling. That is the failure this
 *     placement exists to make impossible: the clearance blanks a fixed list of fields, and a
 *     fifth one added anywhere else would have been left behind -- leaving identifying prose in a
 *     record the system reports as de-identified.
 *
 * The compile error covers the CONSTANT, not the two stores' writes: the Postgres store names its
 * columns in SQL, which no type can check. That half is pinned by the shared contract suite, which
 * clears a plan and asserts the reason is gone from both stores.
 */
export type StoredPatientDetail = EpisodePatientDetail & Pick<Episode, "firstContactReason" | "withdrawalReason">;

/**
 * Seeds the running-service singleton before any stop has ever been raised. It names no real
 * team, so an unstopped store cannot be mistaken for one that has already recorded an incident.
 *
 * It lives here, on the contract, rather than in either store: `ServiceState.reportedByTeamId` is
 * carried forward across a restart, so a store that seeded a different placeholder would hand back
 * a different running state than the other for the same history -- a divergence the shared contract
 * suite would only catch if it happened to assert on the field.
 */
export const SERVICE_STATE_UNSET_TEAM: TeamId = teamId("service-state-unset");

/**
 * Every mutating call is attributed to an actor and keyed for replay. The actor may be a person or
 * the dispatcher: a provider status has no human author, and an unattributable write is not one
 * this layer accepts.
 */
export type WriteContext = { actor: CaringContactActor; idempotencyKey: IdempotencyKey };

/** Every read is attributed to an actor, which is what scopes it to a team. */
export type ReadContext = { actor: CaringContactActor };

/**
 * Named refusals this layer adds on top of the domain reasons it passes through unchanged
 * (`plan-not-active`, `plan-terminal`, `third-party-withdrawal-refused`, the schedule's
 * `first-contact-out-of-range`, and so on).
 *
 * `notFound` deliberately covers both "no such plan" and "that plan belongs to another team": a
 * cross-team actor must not be able to tell those two apart.
 */
export const REPOSITORY_REFUSALS = Object.freeze({
  notFound: "not-found",
  permissionDenied: "permission-denied",
  staleVersion: "stale-version",
  duplicateActivePlan: "duplicate-active-plan",
  planAlreadyExists: "plan-already-exists",
  idempotencyKeyReused: "idempotency-key-reused-for-a-different-write",
  /**
   * A dispatch may only START while the plan is active. Deliberately checked at the start of a
   * dispatch and nowhere else: once a contact is `processing` the send is committed, and a plan
   * change arriving mid-flight must resolve that one contact rather than strand it in a state the
   * contact lifecycle has no exit from. A death is not carried by this refusal at all -- it cancels
   * every unsent contact outright, so the refusal there is `contact-terminal`.
   */
  contactDispatchRequiresActivePlan: "contact-dispatch-requires-active-plan",
  /**
   * `rescheduleContact` was asked to move a contact that is no longer waiting to be sent -- one in
   * flight, already sent, or cancelled/suppressed/missed. See `isContactReschedulable` in
   * ./contact-rescheduling.
   */
  contactNotReschedulable: "contact-not-reschedulable",
  /** A date change would put two sending contacts of one plan on the same AWST calendar day. */
  contactDateChangeCollides: "contact-date-change-collides",
  /**
   * A pathway-version approval named a governance seat (clinical programme lead, lived-experience
   * representative) that the acting person does not hold. See `holdsPathwayApprovalSeat`.
   */
  approvalSeatNotHeld: "approval-seat-not-held",
  /**
   * The service-wide safety stop (./service-state) blocks this write. Applied inside `runWrite`
   * itself -- see the in-memory store -- to every mutating method except `stopService`,
   * `approveServiceRestart`, and `recordHospitalStatusEvent`, so no future write can forget the
   * gate by omission.
   */
  serviceStopped: "service-stopped",
  /** A referral id already used by another referral. */
  referralAlreadyExists: "referral-already-exists",
  /**
   * `createReferral` for a patient whose earlier referral in this team is already accepted and has
   * no plan yet. A second accepted referral would put the same person in the "start a plan" queue
   * twice. A patient with a plan that has not ended is refused as `duplicate-active-plan`, the same
   * reason `createPlan` gives, checked across every team.
   */
  referralAlreadyAcceptedForPatient: "referral-already-accepted-for-patient",
  /** A pathway version id already used by another version. */
  pathwayVersionAlreadyExists: "pathway-version-already-exists",
  /** That attempt's discrepancy already has a recorded resolution; a second one would overwrite it. */
  dispatchDiscrepancyAlreadyResolved: "dispatch-discrepancy-already-resolved",
  /** `resolveDispatchDiscrepancy` requires a non-blank note, the same convention every other named-reason write in this domain uses for free text. */
  dispatchDiscrepancyNoteRequired: "dispatch-discrepancy-note-required",
  /**
   * `createPlan` was asked to create a plan with no assurance attestation on it (Ruling [122]).
   *
   * Refused rather than accepted-and-empty, because an empty list and a missing check are
   * indistinguishable afterwards: a plan carrying no attestation would look exactly like one
   * created before the attestation existed. A plan created from now on says who confirmed what,
   * and a plan that cannot say it is not created.
   */
  planAssurancesRequired: "plan-assurances-required",
  /**
   * The same assurance was named twice in one `createPlan`.
   *
   * Refused rather than de-duplicated, following Ruling [106]'s stance on the first-contact reason:
   * a store that silently collapses a caller's list records something the caller did not send, and
   * nothing afterwards shows that it happened. It also keeps the two stores honest -- the Postgres
   * table is keyed on (plan, assurance), so a duplicate would be a constraint violation there and a
   * silent second row here.
   */
  planAssuranceRepeated: "plan-assurance-repeated",
  /**
   * What a replay is answered with once retention has cleared the plan the original write was
   * about (owner decision 1 of 2026-08-27, and the whole-branch review's MAJOR-1).
   *
   * A replay record holds the VERBATIM result of the write it protects, so a reassignment's record
   * holds the handover note a coordinator typed. Clearing the note where it is stored and leaving
   * this copy would clear nothing. See `RETENTION_CLEARED_REPLAY_ANSWER` for why the record is
   * REDACTED rather than deleted, and why this refusal exists at all instead of the key simply
   * becoming free again.
   */
  idempotentResultClearedByRetention: "idempotent-result-cleared-by-retention",
} as const);

export type RepositoryRefusal = (typeof REPOSITORY_REFUSALS)[keyof typeof REPOSITORY_REFUSALS];

/**
 * Whether a `createPlan` may proceed on the assurances it was given (Ruling [122]).
 *
 * It lives on the contract rather than in either store for the reason `CLEARED_PATIENT_DETAIL`
 * does: it is a rule about what a plan MEANS, and two stores each writing their own copy would be
 * two answers to "may a plan exist without an attestation". The Postgres table's primary key would
 * catch a duplicate and the in-memory map would not, so the answer has to be decided before either
 * store touches storage.
 *
 * It does NOT decide WHICH assurances are required. Nothing in this domain says a plan needs the
 * patient-agreement one specifically, and nothing should start saying so here: the design's
 * assurance set is not frozen, and a required-list encoded in a store would have to be edited in
 * lockstep with a screen every time a row moved between confirmation and display. What a store
 * guarantees is that a plan created from now on carries at least one attestation and names no
 * assurance twice; which confirmations a coordinator is asked for is the screen's question.
 */
/**
 * Who may record a pathway-version approval or publication, beyond the capability check.
 *
 * The approval SEAT and the approver id travel in the action, so a store that checked only
 * `approvePathwayVersion` let a team lead (who holds it) take the lived-experience seat -- two team
 * leads could then "dual approve" a version no lived-experience representative ever saw -- and let
 * any caller record an approval or a publication in somebody else's name. Both stores ask this after
 * the domain transition succeeds, so the domain's own refusals (self-approval, wrong state) keep
 * their names.
 */
export function admitPathwayGovernanceActor(
  action: PathwayVersionAction,
  actor: CaringContactActor,
): TransitionResult<null> {
  if ((action.type === "approve" || action.type === "publish") && action.actorId !== actor.id) {
    return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
  }
  if (action.type === "approve") {
    const roles: readonly string[] = "roles" in actor ? actor.roles : [];
    if (!roles.includes(action.role)) return { ok: false, reason: REPOSITORY_REFUSALS.approvalSeatNotHeld };
  }
  return { ok: true, value: null };
}

export function admitPlanAssurances(assurances: readonly PlanAssurance[]): TransitionResult<readonly PlanAssurance[]> {
  if (assurances.length === 0) return { ok: false, reason: REPOSITORY_REFUSALS.planAssurancesRequired };
  const seen = new Set<PlanAssurance>();
  for (const assurance of assurances) {
    if (seen.has(assurance)) return { ok: false, reason: REPOSITORY_REFUSALS.planAssuranceRepeated };
    seen.add(assurance);
  }
  return { ok: true, value: assurances };
}

/** What the episode ended as. Held separately from `Plan.state` because it outlives the plan. */
export type PlanOutcome = "inProgress" | "withdrawn" | "cancelled" | "completed";

/**
 * The capability each read surface requires.
 *
 * This is an ACCESS-CONTROL RULE, not a value list, which is why it lives on the contract rather
 * than in either store. Both stores had written their own identical copy — the Postgres one
 * commented "kept identical to the in-memory store on purpose" — so a change to who may read an
 * episode could land in one store and not the other, and the shared contract would only notice if
 * it happened to exercise that surface with that role.
 *
 * Kept as a map rather than inline so every read surface has to name the capability it requires,
 * and a new read cannot default to visible.
 */
export const READ_ACTIONS = Object.freeze({
  plan: "viewReferral",
  contacts: "viewReferral",
  auditTrail: "viewAccessTrail",
  episode: "generateClinicalRecordSummary",
  referral: "viewReferral",
  /**
   * Ruling 95: the names-only projection is checked in its own right, against the EXISTING
   * `viewPatientRecord`. No new capability is minted -- a see-names-but-not-records tier would have
   * to be decided for every role to satisfy `permissions.ts`'s exhaustiveness guard, and no role
   * wants one.
   */
  patientName: "viewPatientRecord",
  /**
   * The reconciliation read. Named here for the same reason every other row is: the capability was
   * written inline in BOTH stores' `listDispatches`, so a reporting surface asking whether its
   * reader may see the answer had a third copy to keep in step. `/caring-contacts/reports` has to
   * ask the question the store asked -- an empty dispatch list means "you may not see these" and
   * "there are none" alike -- and it now asks it through this entry rather than through a fourth.
   */
  dispatch: "reconcileProviderDispatch",
  /**
   * Incoming text messages (2026-09-26): a patient's reply, and the "reply to check" items built
   * from replies. The EPISODE's capability, not the plan's, because a reply is the patient's own
   * words -- the same class of content `getEpisode` releases -- so exactly the roles that may read
   * the patient's record may read it. The number match (`findPlansForInboundNumber`) is held to it
   * too: it reads the stored mobile numbers.
   */
  inboundReply: "generateClinicalRecordSummary",
} as const satisfies Record<string, CaringContactAction>);

/** Either governance action reading a pathway version's content is granted by. Same rule, same reason. */
export const PATHWAY_VERSION_READ_ACTIONS: readonly CaringContactAction[] = Object.freeze([
  "authorPathwayVersion",
  "approvePathwayVersion",
]);

/**
 * EVERY action `listPatientNames` requires -- an ALL-of list, unlike `PATHWAY_VERSION_READ_ACTIONS`
 * above, which is an any-of.
 *
 * `READ_ACTIONS.patientName` is the capability Ruling 95 names, and it is not the whole rule. The
 * projection ENUMERATES the team's plans, so it must release a name only for a plan the actor could
 * have listed for themselves -- the same "scoped through the plan" rule `listContacts` follows.
 *
 * The property the conjunction preserves, stated rather than illustrated: `viewPatientRecord` is
 * granted MORE WIDELY than plan visibility is, so it cannot decide a plan-enumerating read on its
 * own. Only the roles holding BOTH can list plans at all, and those are exactly the roles that can
 * already reach a name through `getEpisode`; every role holding `viewPatientRecord` WITHOUT
 * `viewReferral` can obtain no patient's name by any route today -- `listPlans` answers `[]` and
 * `getEpisode` answers `null`. Gating this read on `viewPatientRecord` alone would hand each of
 * them every name their team holds, which is a WIDENING produced by a change whose whole purpose is
 * to narrow. As `permissions.ts` stands the second set is `auditor`, `clinicalProgrammeLead` and
 * `livedExperienceRepresentative`; the rule above is what holds if a sixth role is added tomorrow,
 * and it is the rule that should be checked rather than the membership.
 *
 * This decides the SCOPE of the read, not its capability, so it re-opens nothing: no action is
 * minted, and the name still travels on `viewPatientRecord` exactly as ruled.
 */
export const PATIENT_NAME_READ_ACTIONS: readonly CaringContactAction[] = Object.freeze([
  READ_ACTIONS.plan,
  READ_ACTIONS.patientName,
]);

/**
 * Whether a plan has ended, and what it ended as.
 *
 * Both were written twice, once per store, over a `TERMINAL_PLAN_STATES` that was itself written
 * three times. They are here rather than in ./model because `PlanOutcome` is a storage projection
 * that outlives the plan, and `outcomeFor` is the one mapping from the lifecycle state to it.
 */
export function isTerminalPlan(state: PlanState): boolean {
  return TERMINAL_PLAN_STATES.includes(state);
}

export function outcomeFor(state: PlanState): PlanOutcome {
  return state === "withdrawn" || state === "cancelled" || state === "completed" ? state : "inProgress";
}

/**
 * What every store writes in place of the patient-identifying detail once a retention clearance is
 * recorded (`markRetentionCleared`).
 *
 * It lives on the contract rather than in either store because the clearance is the one write whose
 * WHOLE meaning is what is no longer held: two stores clearing to two different shapes would be two
 * different answers to "was this episode de-identified", and the contract could only catch the
 * difference where it happened to look. The four identifying fields are exactly ../retention's list
 * — name, mobile number, identifiers, cultural identity — and `Episode` types the first two as
 * `string` rather than `string | null`, so an emptied field is the cleared value.
 *
 * `preferredName` is cleared too, and the direction is the whole point (Ruling [105]'s class, not
 * Ruling [122]'s). It is asked for rather than derived, but what it HOLDS is a patient's own name
 * and nothing else -- there is no closed enum, no actor, no instant in it. The attestation below is
 * preserved precisely because it holds no patient content; apply that same test here and it comes
 * out the other way immediately. It clears to `""` rather than to null, matching `patientName`,
 * because that keeps a CLEARED preferred name distinguishable from an episode that never held one
 * (`null`) -- see `Episode.preferredName`.
 *
 * `firstContactReason` is the last of them, and it is not on ../retention's list because that list names
 * what identifies a patient and this names a scheduling decision. It is cleared all the same: the
 * VALUE is free text a clinician wrote about this patient (see `StoredPatientDetail`), and an
 * episode reported as de-identified while still holding that prose would be the worst outcome this
 * constant can produce. It clears to null rather than to `""`, because `Episode` types it as
 * `string | null` and null is already what "no reason held" means everywhere else.
 *
 * WHAT THIS CONSTANT DELIBERATELY DOES NOT REACH, AND IT INVERTS THE REFLEX ABOVE (Ruling [122]).
 * `PlanRecord.assuranceAttestations` is NOT cleared by a retention clearance and must never be
 * added to this shape to make it so. The paragraph above clears the first-contact reason on what it
 * CONTAINS; apply the same test to an attestation and the answer comes out the other way. An
 * attestation is a closed enum value, an actor id and an instant -- no patient content -- and it is
 * the same class as an audit event, which de-identification deliberately PRESERVES: it removes
 * patient fields and keeps actor, action, timestamp and object type. `deidentifyAccessEvent` does
 * exactly that. Clearing an attestation would destroy the evidence that a check happened while
 * keeping the plan it belongs to, which is the opposite of what retention is for.
 *
 * The clearance is `{ ...stored, patientDetail: { ...CLEARED_PATIENT_DETAIL } }` in the in-memory
 * store and a named column list in the Postgres one, so neither reaches an attestation today. That
 * is a property of two implementations rather than of this type, which is why the shared contract
 * suite asserts BOTH directions after a clearance: the attestation survives, and everything this
 * constant names is gone. A test proving only the first would still pass if the clearance stopped
 * working entirely.
 */
export const CLEARED_PATIENT_DETAIL: StoredPatientDetail = Object.freeze({
  patientName: "",
  patientMobileNumber: "",
  patientIdentifiers: Object.freeze([]),
  culturalIdentity: null,
  preferredName: "",
  firstContactReason: null,
  // Prose about the patient, like the first-contact reason, so cleared to null the same way.
  withdrawalReason: null,
});

/**
 * The free text about a patient that a retention clearance removes from OUTSIDE the plan row, and
 * what it clears each field to (owner decision 1 of 2026-08-27, extended to all three stores on
 * 2026-08-28 after the whole-branch review found the second and third).
 *
 * WHY THIS IS A SEPARATE CONSTANT FROM `CLEARED_PATIENT_DETAIL` ABOVE, rather than more fields on
 * it. That one is a `StoredPatientDetail` -- the shape of ONE plan row's patient columns -- and its
 * whole guarantee is that adding a field to that type without adding it there stops the module
 * compiling. These three values live in three different tables, on rows keyed by something other
 * than the plan, so no type relates them and no compile error is available. What holds them
 * together is that each is prose a clinician typed about one named patient, filed somewhere whose
 * stated purpose is not holding patient data:
 *
 *   * `reassignmentReason` -- the handover note, `plan_reassignments.reason` and
 *     `PlanAssignment.reassignmentHistory[].reason`. The column is `not null`, so `''` is how it
 *     says removed, exactly as `patient_name` does. ONLY the reason clears: the entry stays, with
 *     who handed over, to whom and when, because spec 4.3 requires a formal reassignment to remain
 *     visible and because that trio is the same no-patient-content class an audit event keeps.
 *
 *   * `dispatchDiscrepancyNote` -- `contact_dispatches.discrepancy_note`, a clinician's free-text
 *     account of what happened to one named patient's message. The column is nullable and null
 *     already means "this attempt was never reconciled", so it clears to `''` for 0007's reason
 *     rather than to null: `''` is a value the domain refuses on write
 *     (`dispatchDiscrepancyNoteRequired`), so it can only ever have been written by a clearance,
 *     and a REMOVED note stays distinguishable from an attempt that never had one.
 *
 * The replay record is the third and does not belong in this shape, because it is a whole answer
 * rather than a field -- see `RETENTION_CLEARED_REPLAY_ANSWER`.
 */
export const CLEARED_PATIENT_FREE_TEXT = Object.freeze({
  reassignmentReason: "",
  dispatchDiscrepancyNote: "",
  /**
   * Incoming text messages (2026-09-26): the words of every reply filed against the plan,
   * `inbound_replies.body`. The patient's own words, so a clearance removes them with the rest of
   * the patient detail. `''` rather than null, for `reassignmentReason`'s reason: the column is
   * `not null`, and a stored reply is never blank (`admitInboundReplyText` refuses one), so `''`
   * can only have been written by a clearance. The item itself stays -- that a reply arrived, what
   * kind, when, and who followed it up -- the same no-patient-content class an audit event keeps.
   */
  inboundReplyText: "",
});

/**
 * What a replay of a cleared plan's write is answered with, and the decision behind it.
 *
 * THE PROBLEM. A replay record holds the verbatim result of the write it protects, keyed by team
 * and idempotency key, with no expiry. For a reassignment that result is a `PlanAssignment`, whose
 * `reassignmentHistory[].reason` IS the handover note -- so clearing the note from
 * `plan_reassignments` and stopping there leaves a byte-identical copy behind, in the one table
 * whose stated purpose has nothing to do with patient data.
 *
 * WHY REDACTED AND NOT DELETED, which was the live question. Deleting the row returns the key to
 * unused: a retry carrying that key would find no previous record and RUN THE WRITE AGAIN. The
 * guarantee this table exists for -- one key, one execution -- would be destroyed to remove a note,
 * and a clinical write executing twice is a worse outcome than a retained one. So the row stays,
 * the key stays consumed, and only the stored ANSWER is replaced.
 *
 * WHAT THE CALLER LOSES, stated rather than glossed. A replay after a clearance no longer returns
 * the original answer; it returns this named refusal. That is a real narrowing of the replay
 * contract and it is the conservative direction: the caller is told the answer is no longer held,
 * instead of being handed a discharged patient's clinical prose or having its write re-executed.
 * It is reachable only for a plan whose episode has ended and whose identifying detail has already
 * been removed, which is not a window any live retry is in.
 *
 * IT IS ONE VALUE, DECLARED ONCE, for the reason `CLEARED_PATIENT_DETAIL` is: two stores writing
 * two shapes would be two answers to "what does a replay say after a clearance", and the contract
 * suite could only catch the difference where it happened to look.
 */
export const RETENTION_CLEARED_REPLAY_ANSWER: TransitionResult<never> = Object.freeze({
  ok: false,
  reason: REPOSITORY_REFUSALS.idempotentResultClearedByRetention,
});

/**
 * The plan a replay record is filed against, so a retention clearance can reach it.
 *
 * DERIVED FROM THE WRITE'S OWN INPUT RATHER THAN DECLARED PER METHOD, and that is the whole point.
 * A `planId` passed by hand at each write site is a field a future method can simply not pass:
 * nothing would fail, no test would go red, and a discharged patient's prose would sit in a replay
 * record nothing could find. Every write input in this contract that concerns a plan already names
 * it `planId` -- `CreatePlanInput`, `PlanLifecycleInput` and everything built on it,
 * `ContactStatusInput`, the assignment input -- so reading that field files the record correctly
 * for a method nobody has written yet.
 *
 * It lives on the contract rather than in either store for `CLEARED_PATIENT_DETAIL`'s reason: two
 * stores deciding separately which records belong to a plan would be two answers to what a
 * clearance reaches, and the contract suite could only catch the difference where it looked.
 *
 * THE ONE WRITE IT FILES NOTHING FOR is `resolveDispatchDiscrepancy`, whose input names a contact
 * and an attempt. That is safe only because its result is a `DispatchRecord`, which holds no note
 * -- pinned by `DISPATCH_RECORD_HOLDS_NO_DISCREPANCY_NOTE` above, so releasing the note there
 * stops the module compiling rather than quietly creating an unreachable copy.
 */
export function replayRecordPlanId(input: unknown): PlanId | null {
  if (input === null || typeof input !== "object") return null;
  const candidate = (input as { planId?: unknown }).planId;
  return typeof candidate === "string" ? (candidate as PlanId) : null;
}

/**
 * A stored contact keeps its planned entry verbatim, including the real `sendAt` of an absorbed
 * entry. Sendability is carried by `contact.state`, which is set to the terminal `suppressed` at
 * creation for an absorbed entry — so an absorbed contact is not merely filtered out of a dispatch
 * list, it can never be in one.
 */
export type StoredContact = { contact: Contact; planned: PlannedContact };

/**
 * How much of a plan has gone out, how much is still to go, and how much never will.
 *
 * Every count is derived from `contactSendability` in ./model, which classifies each `ContactState`
 * with an exhaustive switch beside the state machine that produces it. Nothing here decides which
 * states are sendable, and nothing that renders a schedule should either -- that was the defect
 * this function exists to remove: the patient overview counted "not suppressed" as "will be sent",
 * which announced a withdrawn plan's ten CANCELLED contacts as ten messages still to come.
 *
 * It lives on the contract rather than in a component or a store because `StoredContact` is
 * declared here and both stores hold one: a second copy of this arithmetic anywhere would be a
 * second answer to "how much of this plan is left".
 *
 * `total` is stated rather than left to the caller to add up, so a caller cannot reconstruct it
 * from two of the three buckets and be wrong when a third exists.
 */
export type StoredContactSummary = {
  total: number;
  alreadySent: number;
  stillToSend: number;
  willNotBeSent: number;
};

export function summariseStoredContacts(contacts: readonly StoredContact[]): StoredContactSummary {
  const summary: StoredContactSummary = { total: contacts.length, alreadySent: 0, stillToSend: 0, willNotBeSent: 0 };
  for (const stored of contacts) {
    switch (contactSendability(stored.contact.state)) {
      case "alreadySent":
        summary.alreadySent += 1;
        break;
      case "stillToSend":
        summary.stillToSend += 1;
        break;
      case "willNotBeSent":
        summary.willNotBeSent += 1;
        break;
    }
  }
  return summary;
}

/** What a read returns. Deliberately carries no patient-identifying detail — see `getEpisode`. */
export type PlanRecord = {
  plan: Plan;
  patientId: PatientId;
  referralId: ReferralId;
  pathwayVersionId: PathwayVersionId;
  dischargeAt: Date;
  /**
   * The OBSERVED instant this plan came into existence, and therefore the instant it became free
   * for a coordinator to take (Group 4 review MAJOR-1, owner-approved 2026-08-28).
   *
   * WHY THE CONTRACT RELEASES IT AT ALL. The unclaimed-work escalation (spec 4.2) needs an instant
   * to measure a queue age from, and until this field there was none: `team-workload.ts` used
   * `dischargeAt`, which is not an observed instant but a display convention -- the plan wizard
   * writes midday on the AWST calendar day a coordinator typed. Measured from that, a plan
   * activated at 08:00 and never claimed reported an age of ZERO all morning and escalated four
   * hours late, on a safety escalation whose whole purpose is not to miss one.
   *
   * WHY THE CREATION INSTANT IS THE CLAIMABLE INSTANT, checked against the domain rather than
   * assumed. A plan is claimable exactly while it has no owner: `applyAssignmentAction`'s `claim`
   * has ONE precondition, `ownerId === null`, and no plan state anywhere gates it -- a draft is as
   * claimable as an active plan, which is why `buildTeamWorkload` counts both as unclaimed. A plan
   * is created with no assignment row at all, so it is unowned from its first instant; and nothing
   * in this domain returns a claimed plan to unowned -- there is no release action, and `reassign`
   * moves ownership from one actor to another. So "unowned since" and "created at" are the same
   * instant for every plan that has one, which is why this is the creation instant under its own
   * name rather than a second `claimable_since` column holding a copy of it. A release action, if
   * one is ever added, is the change that would break that equality and would have to introduce
   * the separate column then.
   *
   * WHY IT IS NOT PART OF `patientDetail` AND IS NOT CLEARED. It is an instant, like
   * `PlanAssuranceAttestation.attestedAt` -- no patient content, and the same class
   * de-identification deliberately preserves. `deidentifyEpisode` keeps `planDates` for exactly
   * this reason.
   */
  createdAt: Date;
  /** The instant the plan reached a terminal state; null while it is still open. */
  completedAt: Date | null;
  outcome: PlanOutcome;
  contacts: readonly StoredContact[];
  /**
   * What a coordinator attested to having confirmed before this plan was created, and nothing else
   * about it -- who, what, when. Empty for a plan created before the attestation existed, and that
   * emptiness is a fact to be stated rather than filled in; see the migration's "no backfill".
   *
   * WHY IT SITS ON THE RECORD RATHER THAN IN `patientDetail` (Ruling [122]). It is an act a
   * clinician performed, not a fact about the patient, and `patientDetail` is subject to
   * `CLEARED_PATIENT_DETAIL` -- which is the one thing that must not happen to it. See that
   * constant's own note.
   *
   * WHY THE LIST READ MAY CARRY IT, WHEN THE FIRST-CONTACT REASON MAY NOT.
   * `PLAN_RECORD_HOLDS_NO_FIRST_CONTACT_REASON` below keeps that reason off this shape because the
   * reason is prose a clinician typed about a patient, and the caseload renders this shape for every
   * patient in the team. An attestation contains no patient content at all: a closed enum value, an
   * actor id and an instant. Judged the way that reason was judged -- by what it CONTAINS rather
   * than by what it is about -- it belongs here. What it does cost is a second grouped query per
   * list read in the Postgres store; that is a stated cost, not an oversight, and it buys a read
   * that returns the plan and the evidence about it together rather than by two different routes.
   */
  assuranceAttestations: readonly PlanAssuranceAttestation[];
};

/**
 * Pins `PlanRecord` as holding no first-contact reason (Ruling 105).
 *
 * The sibling of `PATIENT_NAME_PROJECTION_RELEASES_ONLY_THE_NAME` below, and the same argument
 * pointed the other way: that one pins a shape to the two fields it MAY hold, this one pins a
 * shape against one field it may NOT. `PlanRecord` is the caseload's read, so a reason added to it
 * would be fetched for every patient in the team on every render of a list screen -- and it would
 * typecheck, pass every existing test, and be described by its own name as a plan record.
 *
 * A guard rather than a comment because `StoredPlan` is `PlanRecord & …`: the natural place for a
 * later editor to put a new plan-level field is the record, and that is exactly where it must not
 * go.
 */
export const PLAN_RECORD_HOLDS_NO_FIRST_CONTACT_REASON: LacksKey<PlanRecord, "firstContactReason"> = true;

/** The same pin for the withdrawal reason: free text about a patient never reaches a list read. */
export const PLAN_RECORD_HOLDS_NO_WITHDRAWAL_REASON: LacksKey<PlanRecord, "withdrawalReason"> = true;

/** What the datastore holds. The patient detail is released only through `getEpisode`. */
export type StoredPlan = PlanRecord & { patientDetail: StoredPatientDetail };

/**
 * One plan's patient NAME, and the plan it belongs to. The whole of what `listPatientNames`
 * releases (Ruling 91).
 *
 * WHY THIS SHAPE, AND NOT A NARROWED RECORD. It is declared here as its own two-field type rather
 * than as a `Pick` of `Episode` or a `PlanRecord` with the other fields blanked, because a shape
 * that COULD hold a mobile number, an identifier list or a cultural identity is one edit away from
 * doing so -- and it would still typecheck, still pass every existing test, and still be described
 * by its own name as a names projection. Two fields is the guarantee; empty fields are a promise.
 * The assertion below turns that from a convention into a compile error.
 *
 * WHY KEYED BY PLAN, NOT BY PATIENT. The patient detail is held PER PLAN, and
 * `markRetentionCleared` clears it per plan -- so one patient's two episodes can honestly differ,
 * one cleared and one not. A patient-keyed map would have to invent a rule for which of those wins.
 * Plan-keyed joins 1:1 onto `listPlans`, which is what a caseload renders, and needs no such rule.
 *
 * WHY A LIST, NOT A LOOKUP PER PLAN. A caseload costs ONE round trip rather than one per row, and
 * a list cannot be used as an existence oracle: a per-plan lookup would have to answer for a plan
 * id the caller supplied, and `getPlan` deliberately gives the same answer for "no such plan" and
 * "another team's plan" so a cross-team actor cannot tell them apart. This read never takes a plan
 * id at all, so there is nothing for it to be asked about.
 *
 * `patientName` is `""` for a plan whose detail a retention clearance has already removed --
 * `CLEARED_PATIENT_DETAIL` above is what the stores write, and an emptied field IS the cleared
 * value. A caller must therefore treat blank as "no name held", never as a name.
 */
export type PatientNameProjection = { planId: PlanId; patientName: string };

/**
 * Pins the projection's fields to exactly those two. Adding `patientMobileNumber`,
 * `patientIdentifiers` or `culturalIdentity` -- or anything else -- stops this line compiling, so
 * the read cannot be widened quietly by someone who has not read the paragraph above.
 *
 * It held unchanged when `firstContactReason` was added to the stored detail (Ruling 105), because
 * this type is declared field by field rather than derived from the detail: a fifth stored field
 * reaches it only if someone writes it here, and writing it here breaks this line. It therefore
 * needed no sibling of its own. `PLAN_RECORD_HOLDS_NO_FIRST_CONTACT_REASON` above is the sibling
 * the new field DID need, for the one shape that is derived by intersection and so could have
 * gained it silently.
 */
export const PATIENT_NAME_PROJECTION_RELEASES_ONLY_THE_NAME: SameUnion<
  keyof PatientNameProjection,
  "planId" | "patientName"
> = true;

export type CreatePlanInput = {
  planId: PlanId;
  referralId: ReferralId;
  patientId: PatientId;
  pathwayVersionId: PathwayVersionId;
  dischargeAt: Date;
  sendingPreference: SendingPreference;
  firstContactDate?: string;
  firstContactReason?: string;
  patientDetail: EpisodePatientDetail;
  /**
   * Which assurances the coordinator confirmed. Required and non-empty -- `admitPlanAssurances`
   * refuses by name otherwise, and no plan is created.
   *
   * ONLY THE ASSURANCES. The actor and the instant are stamped by the store from the write context
   * and the domain clock, never taken from here, so a request cannot claim someone else made the
   * check or claim it was made at a time it was not.
   */
  assurances: readonly PlanAssurance[];
};

export type PlanLifecycleInput = { planId: PlanId; expectedVersion: number };
export type WithdrawPlanInput = PlanLifecycleInput & {
  origin: WithdrawalOrigin;
  /**
   * An optional short reason for the withdrawal (owner-approved 2026-09-26). Trimmed; blank means
   * none; over `WITHDRAWAL_REASON_MAX_LENGTH` is refused as `withdrawal-reason-too-long`. Stored with
   * the patient detail and released only by `getEpisode`.
   */
  reason?: string;
};
export type HospitalStatusInput = PlanLifecycleInput & { event: HospitalStatusEvent };

export type HospitalStatusOutcome = {
  record: PlanRecord;
  exceptions: readonly PlanException[];
  incident?: PlanIncident;
  /** How many stored contacts this event cancelled outright. */
  contactsCancelled: number;
};

/**
 * An additional append-only destination for audit events — an external trail, for instance. It is
 * called inside the write, before anything is committed: if it throws, the change is abandoned,
 * because a change nobody can prove happened is worse than a change refused.
 */
export type AuditSink = { record(event: AuditEvent): void | Promise<void> };

/**
 * A contact-status write. It states the contact version it expected for the same reason a plan
 * write does: two dispatchers racing the same contact must not both believe they started it.
 */
export type ContactStatusInput = { planId: PlanId; contactId: ContactId; expectedContactVersion: number };

export type ContactProviderStatusInput = ContactStatusInput & { status: ProviderStatus };

export type RepositoryOptions = {
  auditSink?: AuditSink;
  /**
   * Who governance configuration names for each service-restart approval seat (owner decision
   * 2026-09-26; see `RestartApprovalSeatRoster`). Absent means NOBODY holds any seat, so every
   * restart approval is refused -- an unconfigured seat fails closed rather than open.
   */
  restartApprovalSeats?: RestartApprovalSeatRoster;
};

/**
 * Clinical payload captured at hospital referral intake (Hazard H-44).
 *
 * Defined in ./referral-intake so the plan wizard (client) can name the persisted
 * shape without importing this contract — this file imports `service-state`.
 * Kept off the `Referral` identity record (identifiers + state only) but persisted
 * beside it so success UX and the plan wizard can round-trip what was actually written.
 */
export type { ReferralIntakePayload };

export type CreateReferralInput = {
  referralId: ReferralId;
  patientId: PatientId;
  /** Optional H-44 intake clinical payload; omitted by non-intake referral creators. */
  intakePayload?: ReferralIntakePayload | null;
};
export type ReferralTransitionInput = { referralId: ReferralId; action: ReferralAction };
export type SavePathwayVersionInput = { version: PathwayVersion };
export type PathwayVersionTransitionInput = { pathwayVersionId: PathwayVersionId; action: PathwayVersionAction };

/**
 * One recorded dispatch attempt for one contact, the reconciliation surface between what the
 * dispatcher expected and what the provider reported. `discrepancyResolution` is null until
 * `resolveDispatchDiscrepancy` records one, and `unresolvedNoResend` is as final an answer as
 * `confirmedDelivered` -- there is no method anywhere in this contract that re-dispatches a
 * contact whose status is uncertain.
 */
export type DispatchRecord = {
  contactId: ContactId;
  planId: PlanId;
  attempt: number;
  startedAt: Date;
  expectedStatus: ProviderStatus | null;
  reportedStatus: ProviderStatus | null;
  discrepancyResolvedAt: Date | null;
  discrepancyResolution: DispatchDiscrepancyResolution | null;
};
/**
 * Pins `DispatchRecord` as carrying no discrepancy note, and it is load-bearing rather than tidy.
 *
 * `resolveDispatchDiscrepancy` is the ONE write in this store whose input holds patient free text
 * and whose spec names no plan, so its replay record is the one that cannot be reached by plan id
 * when retention clears an episode. That is safe only because what it stores is this shape, which
 * holds the resolution and its instant and NOT the note. Adding the note here would put a
 * clinician's account of one named patient's message into a replay record nothing can clear --
 * so it stops the module compiling instead. If the note ever has to be released, the plan id has
 * to reach the replay record first.
 */
export const DISPATCH_RECORD_HOLDS_NO_DISCREPANCY_NOTE: LacksKey<DispatchRecord, "discrepancyNote"> = true;

/**
 * Incoming text messages (2026-09-26). Pins `InboundReplyRecord` -- what both reply writes return,
 * and therefore what their replay records hold, and what the team-wide list read releases -- as
 * carrying none of the patient's words. The words are released by `listInboundReplies` alone.
 */
export const INBOUND_REPLY_RECORD_HOLDS_NO_TEXT: LacksKey<InboundReplyRecord, "text"> = true;

export type DispatchDiscrepancyResolution = "confirmedDelivered" | "confirmedNotDelivered" | "unresolvedNoResend";
export type ResolveDiscrepancyInput = {
  contactId: ContactId;
  attempt: number;
  resolution: DispatchDiscrepancyResolution;
  note: string;
};
export type AccessTrailQuery = {
  fromIso?: string;
  toIso?: string;
  actorId?: ActorId;
  objectType?: AccessedObjectType;
  limit: number;
  offset: number;
};

export interface CaringContactRepository {
  createPlan(input: CreatePlanInput, context: WriteContext): Promise<TransitionResult<PlanRecord>>;
  activatePlan(input: PlanLifecycleInput, context: WriteContext): Promise<TransitionResult<PlanRecord>>;
  pausePlan(input: PlanLifecycleInput, context: WriteContext): Promise<TransitionResult<PlanRecord>>;
  resumePlan(input: PlanLifecycleInput, context: WriteContext): Promise<TransitionResult<PlanRecord>>;
  withdrawPlan(input: WithdrawPlanInput, context: WriteContext): Promise<TransitionResult<PlanRecord>>;
  /**
   * Cancels a plan that was created and never started (owner-approved 2026-09-26), cancelling every
   * contact it held. Refuses `plan-not-draft` for a plan that has started -- that one ends by
   * withdrawal. Gated on `claimPlan`, the capability `createPlan` itself requires, so exactly the
   * roles that can create a plan can cancel one. A cancelled plan is terminal, so it no longer blocks
   * a new plan or referral for the patient.
   */
  cancelDraftPlan(input: PlanLifecycleInput, context: WriteContext): Promise<TransitionResult<PlanRecord>>;
  recordHospitalStatusEvent(
    input: HospitalStatusInput,
    context: WriteContext,
  ): Promise<TransitionResult<HospitalStatusOutcome>>;

  /**
   * The dispatch path. Four separate writes rather than one, because each is a distinct fact with
   * its own audit record: the send was begun, the message left, the provider said what happened,
   * or the window closed without a send. Every one of them is a system-actor capability; no human
   * role is granted any of them, so a delivery receipt cannot be written by hand.
   */
  startContactDispatch(input: ContactStatusInput, context: WriteContext): Promise<TransitionResult<StoredContact>>;
  recordContactSent(input: ContactStatusInput, context: WriteContext): Promise<TransitionResult<StoredContact>>;
  recordContactProviderStatus(
    input: ContactProviderStatusInput,
    context: WriteContext,
  ): Promise<TransitionResult<StoredContact>>;
  recordContactMissed(input: ContactStatusInput, context: WriteContext): Promise<TransitionResult<StoredContact>>;

  /**
   * Moves a contact within its scheduled day, or changes its date with team-lead approval --
   * Task 7's `moveContactWithinDay` / `changeContactDate` given somewhere to persist. Refuses the
   * exact reasons those functions do, unchanged; adds `notFound`, `permissionDenied`, and
   * `staleVersion` on top, the same as every other contact-status write.
   */
  rescheduleContact(
    input: {
      planId: PlanId;
      contactId: ContactId;
      expectedContactVersion: number;
      change: ContactMoveRequest | ContactDateChangeRequest;
    },
    context: WriteContext,
  ): Promise<TransitionResult<StoredContact>>;

  // Referrals
  createReferral(input: CreateReferralInput, context: WriteContext): Promise<TransitionResult<Referral>>;
  transitionReferral(input: ReferralTransitionInput, context: WriteContext): Promise<TransitionResult<Referral>>;
  listReferrals(context: ReadContext): Promise<Referral[]>;
  /**
   * The H-44 intake clinical payload stored with `createReferral`, or null when none was written
   * or the referral is not visible to this actor. Never invents fields from an adapter echo.
   */
  getReferralIntakePayload(referralId: ReferralId, context: ReadContext): Promise<ReferralIntakePayload | null>;

  // Pathway versions
  savePathwayVersion(input: SavePathwayVersionInput, context: WriteContext): Promise<TransitionResult<PathwayVersion>>;
  transitionPathwayVersion(
    input: PathwayVersionTransitionInput,
    context: WriteContext,
  ): Promise<TransitionResult<PathwayVersion>>;
  getPathwayVersion(id: PathwayVersionId, context: ReadContext): Promise<PathwayVersion | null>;
  listPathwayVersions(context: ReadContext): Promise<PathwayVersion[]>;

  // Service state
  /**
   * The one service-wide record -- never one per team. Visible unconditionally to every actor of
   * every team: the whole point of the singleton is that a stop raised by one team's actor blocks
   * dispatch for every other team's plans too, and the banner it feeds must render on every
   * screen, including ones with no patient in view at all.
   */
  getServiceState(context: ReadContext): Promise<ServiceState>;
  stopService(
    input: { reason: ServiceStopReason; note: string },
    context: WriteContext,
  ): Promise<TransitionResult<ServiceState>>;
  /**
   * Ruling 65: returns `ServiceRestartOutcome`, NOT the record. Restart approvals are service-wide,
   * so the approver may sit outside the reporting team, and every store persists a write's return
   * value as its replay result -- under the APPROVING team's id. Returning the record put the
   * reporting team's incident note in a row that team could read. The narrow type removes it from
   * the reply and from storage together, and a replay stays truthful because the original answer
   * never carried it either.
   */
  approveServiceRestart(
    input: { role: ServiceRestartApprovalRole },
    context: WriteContext,
  ): Promise<TransitionResult<ServiceRestartOutcome>>;

  // Assignment
  getAssignment(planId: PlanId, context: ReadContext): Promise<PlanAssignment | null>;
  applyAssignment(
    input: { planId: PlanId; action: AssignmentAction },
    context: WriteContext,
  ): Promise<TransitionResult<PlanAssignment>>;

  // Reconciliation
  listDispatches(input: { fromIso: string; toIso: string }, context: ReadContext): Promise<DispatchRecord[]>;
  /** Never resends. `unresolvedNoResend` is as final an outcome as any other -- see `DispatchRecord`. */
  resolveDispatchDiscrepancy(
    input: ResolveDiscrepancyInput,
    context: WriteContext,
  ): Promise<TransitionResult<DispatchRecord>>;

  // Access trail
  /**
   * Records a view/search/export/administrative access. No `WriteContext` -- the caller already
   * knows who is accessing what, `AccessRecord` carries it, and this is a best-effort append with
   * no refusal to report: recording that "every search, view, decision, mutation, write-back and
   * administrative access" happened must not itself be blockable by the service safety stop, or
   * the trail would go dark for exactly the incidents (including `audit-integrity-loss`) it exists
   * to prove happened.
   */
  recordAccess(record: AccessRecord): Promise<void>;
  listAccessTrail(input: AccessTrailQuery, context: ReadContext): Promise<AuditEvent[]>;

  // Preferences, training, retention
  getNotificationPreferences(context: ReadContext): Promise<NotificationPreferences>;
  saveNotificationPreferences(
    input: NotificationPreferences,
    context: WriteContext,
  ): Promise<TransitionResult<NotificationPreferences>>;
  getTrainingRecord(context: ReadContext): Promise<TrainingRecord>;
  recordTrainingCompetency(
    input: { competency: TrainingCompetency },
    context: WriteContext,
  ): Promise<TransitionResult<TrainingRecord>>;
  /**
   * Records that an episode's identifying detail has been cleared, AND CLEARS IT, in one
   * transaction (Ruling 64: a record named "cleared" must mean cleared).
   *
   * WHAT IT REACHES, which is wider than the plan row and was not always. The plan's patient
   * columns (`CLEARED_PATIENT_DETAIL`) and the cultural-identity projection, plus the free-text
   * stores about the patient that live outside that row: the handover note on every reassignment
   * of this plan, the discrepancy note on every dispatch of its contacts, the stored answer of
   * every replay record filed against it, and the H-44 `intake_payload` jsonb on the linked
   * referral (name, mobile, clinicalSummary, safetyAlerts). See `CLEARED_PATIENT_FREE_TEXT` and
   * `RETENTION_CLEARED_REPLAY_ANSWER`; the replay record is redacted rather than deleted, and that
   * distinction is a guarantee rather than an implementation detail.
   *
   * Admissibility is ../retention's rule, not a store's: an episode that has not ended has no
   * instant to clear against and is refused by name, and (owner decision, 2026-09-26) so is one
   * whose retention period has not yet passed since it ended -- `retention-period-not-elapsed`.
   */
  markRetentionCleared(input: { planId: PlanId }, context: WriteContext): Promise<TransitionResult<void>>;

  /** Null for a plan that does not exist AND for one belonging to another team. */
  getPlan(planId: PlanId, context: ReadContext): Promise<PlanRecord | null>;
  listPlans(context: ReadContext): Promise<PlanRecord[]>;
  /**
   * The patient NAME for each plan this actor could list, and nothing else about them (Ruling 91).
   *
   * Its own method with its own capability check, so a caseload can name the people on it without
   * `getEpisode` -- the only other read that releases a name, and one that releases the mobile
   * number, the identifiers and the cultural identity alongside it.
   *
   * Empty, never a refusal, for an actor whose role does not cover it and for one outside the team
   * -- the same answer `listPlans` gives, for the same reason: a refusal would confirm that records
   * exist. Team scoping is `listPlans`'s exactly, so a plan invisible there has no name here.
   */
  listPatientNames(context: ReadContext): Promise<PatientNameProjection[]>;
  listContacts(planId: PlanId, context: ReadContext): Promise<StoredContact[]>;
  /**
   * The contacts that may actually go out.
   *
   * Keyed off the OWNING PLAN's state and then the contact's own, never off `sendAt`. The plan half
   * arrived with #PAMATF: contacts are written `scheduled` at creation, while the plan is still a
   * draft, and no plan lifecycle write touches them -- so a contract keyed on the contact alone
   * promised a draft plan's messages, and a paused plan's, as work about to happen. Both stores
   * consult `planSendingHold` in ./model, so neither can answer it its own way.
   *
   * Empty for a held plan, which is deliberately the same answer a plan with nothing left to send
   * gives: this returns what may go out, and a caller that needs to know WHY nothing may has
   * `planSendingHold` itself, which distinguishes not-started, paused and ended.
   */
  listSendableContacts(planId: PlanId, context: ReadContext): Promise<StoredContact[]>;
  listAuditEvents(context: ReadContext): Promise<AuditEvent[]>;
  getEpisode(planId: PlanId, context: ReadContext): Promise<Episode | null>;

  // -------------------------------------------------------------------------------------------
  // Incoming text messages (2026-09-26). The rules live in ./inbound-replies; see that module.
  // -------------------------------------------------------------------------------------------

  /**
   * The plans in the ACTOR'S OWN TEAM whose stored mobile number is this Australian mobile
   * (`+614XXXXXXXX`), compared after normalising the stored value the way the sender does
   * (`toAustralianMobileE164`). Releases identifiers and state only, never the number or a name.
   * Empty for an actor without `READ_ACTIONS.inboundReply`, and for another team's plans, exactly
   * as `listPlans` is -- so one team's match can never see, or be filed on, another team's plan.
   * A cleared plan holds no number and so never matches.
   */
  findPlansForInboundNumber(mobileE164: string, context: ReadContext): Promise<InboundReplyPlanMatch[]>;
  /**
   * Records one incoming message as a "reply to check" on one plan and, when it is an opt-out on an
   * ACTIVE plan, pauses that plan in the same atomic write (`optOutPausesPlan`). Never withdraws,
   * cancels or resumes anything. Gated on `recordInboundReply`, which only the
   * `inboundReplyRecorder` system role holds.
   *
   * NO EXPECTED PLAN VERSION, deliberately, and the one write here without one. The pause is the
   * conservative direction and is applied to the plan as it stands under a row lock: if it is no
   * longer active (someone paused, withdrew or ended it meanwhile) the pause simply does not
   * happen and the item still records what was asked. There is no lost update to guard against,
   * and a stale-version refusal would be REMEMBERED under the carrier's retry key -- so a genuine
   * STOP could be refused for ever.
   *
   * NOT BLOCKED BY THE SERVICE SAFETY STOP, like `recordHospitalStatusEvent`: a patient's reply --
   * above all an opt-out -- must be recordable during an incident, and a pause only ever reduces
   * what is sent.
   */
  recordInboundReply(
    input: RecordInboundReplyInput,
    context: WriteContext,
  ): Promise<TransitionResult<InboundReplyRecord>>;
  /** A person marks a reply followed up. Gated on `followUpInboundReply`; once only; versioned. */
  markInboundReplyFollowedUp(
    input: FollowUpInboundReplyInput,
    context: WriteContext,
  ): Promise<TransitionResult<InboundReplyRecord>>;
  /** The team's replies nobody has followed up yet, oldest first, WITHOUT the words. */
  listOpenInboundReplies(context: ReadContext): Promise<InboundReplyRecord[]>;
  /** Every reply filed against one plan, oldest first, WITH the words. The patient screen's read. */
  listInboundReplies(planId: PlanId, context: ReadContext): Promise<InboundReplyWithText[]>;
  /**
   * The automatic-reply loop guard: true, and the window restarted, when `senderKey` has not been
   * answered within `windowMs` of the store's clock; false otherwise. Atomic across concurrent
   * callers and across instances sharing the store. Entries older than the window are deleted on
   * every call, so nothing about a number outlives the window it exists for.
   *
   * No actor and no audit event, like `recordAccess`: it is keyed by a hash that names nobody
   * (`inboundSenderKey`), belongs to no team (an unknown number has none), and changes nothing about
   * any patient. It is not blocked by the service safety stop.
   */
  claimInboundAutoReply(input: { senderKey: string; windowMs: number }): Promise<boolean>;
}

/**
 * Every store in this domain is built this way, so one contract suite can run against all of them.
 * Task 11's Postgres store returns a promise here; the in-memory store returns directly.
 */
export type CaringContactRepositoryFactory = (
  clock: Clock,
  options?: RepositoryOptions,
) => CaringContactRepository | Promise<CaringContactRepository>;

/** Deterministic contact identifier, so the same plan always produces the same contact ids. */
export function contactIdentifierFor(planId: PlanId, sequence: number): string {
  return `${planId}--contact-${sequence}`;
}
