// src/lib/caring-contacts/db/postgres-repository.ts
//
// The Postgres caring-contact store.
// Modularized into 5 cohesive domain stores under ./modules/:
//   - plans-store.ts: Plan creation, lifecycle transitions, clearances, queries, referrals, pathway versions
//   - contacts-store.ts: Contact schedule, dispatch tracking, discrepancy resolution
//   - responder-notes-store.ts: Service safety stops, responder case notes, restart approvals
//   - audit-store.ts: Audit logs, access trails, idempotency records
//   - team-store.ts: Team assignments, workloads, members, cover, preferences, training
//
// Every method's set_config / set local role RLS preamble and same-team write serialisation
// is preserved byte-for-byte in the shared execution context.

import type { AccessRecord } from "../access-audit";
import type { AssignmentAction, PlanAssignment } from "../assignment";
import { buildAuditEvent, type AuditEvent, type AuditOutcome } from "../audit";
import type { Clock } from "../clock";
import type { ContactDateChangeRequest, ContactMoveRequest } from "../contact-rescheduling";
import type { Episode } from "../episode";
import { fingerprintOf } from "../fingerprint";
import type { ContactId, PathwayVersionId, PlanId, ReferralId, TeamId } from "../ids";
import type { Referral, TransitionResult } from "../model";
import type { AlertClass, NotificationPreferences } from "../notification-preferences";
import type { PathwayVersion } from "../pathway-versions";
import { actorRoleNames } from "../permissions";
import {
  REPOSITORY_REFUSALS,
  replayRecordPlanId,
  type AccessTrailQuery,
  type CaringContactRepository,
  type ContactProviderStatusInput,
  type ContactStatusInput,
  type CreatePlanInput,
  type CreateReferralInput,
  type DispatchRecord,
  type HospitalStatusInput,
  type HospitalStatusOutcome,
  type PathwayVersionTransitionInput,
  type PatientNameProjection,
  type PlanLifecycleInput,
  type PlanRecord,
  type ReadContext,
  type ReferralIntakePayload,
  type ReferralTransitionInput,
  type RepositoryOptions,
  type ResolveDiscrepancyInput,
  type SavePathwayVersionInput,
  type SenderHeartbeat,
  type StaffAlertClaim,
  type StaffAlertClaimInput,
  type StaffAlertReleaseInput,
  type StoredContact,
  type WithdrawPlanInput,
  type WriteContext,
} from "../repository";
import {
  serviceStopBlocksDispatch,
  type ServiceRestartApprovalRole,
  type ServiceRestartOutcome,
  type ServiceState,
  type ServiceStopReason,
} from "../service-state";
import type { TrainingCompetency, TrainingRecord } from "../training";
import { createAuditStore, type AuditStore } from "./modules/audit-store";
import { createContactsStore, toStoredContact, type ContactsStore } from "./modules/contacts-store";
import { createPlansStore, type PlansStore } from "./modules/plans-store";
import { createResponderNotesStore, type ResponderNotesStore } from "./modules/responder-notes-store";
import { createTeamStore, type TeamStore } from "./modules/team-store";
import { createStaffAlertsStore, type StaffAlertsStore } from "./modules/staff-alerts-store";
import { createInboundRepliesStore, type InboundRepliesStore } from "./modules/inbound-replies-store";
import type {
  FollowUpInboundReplyInput,
  InboundReplyPlanMatch,
  InboundReplyRecord,
  InboundReplyWithText,
  RecordInboundReplyInput,
} from "../inbound-replies";
import {
  auditTokenFactory,
  decodeStoredValue,
  encodeStoredValue,
  textOf,
  type RepositoryContext,
  type SqlConnection,
  type SqlConnectionPool,
  type SqlResult,
  type SqlRow,
  type SqlValue,
  type WriteSpec,
} from "./shared";

export type { SqlConnection, SqlConnectionPool, SqlResult, SqlRow, SqlValue };

// ---------------------------------------------------------------------------
// Domain isolation AST contract pins (tests/caring-contacts-domain-isolation.test.ts)
// ---------------------------------------------------------------------------

export const PLAN_COLUMNS = `id, team_id, patient_id, referral_id, pathway_version_id, state, version, outcome,
  discharge_at, created_at, completed_at, sending_preference, patient_name, patient_mobile_number,
  patient_identifiers`;

export const PLAN_LIST_COLUMNS = `id, team_id, patient_id, referral_id, pathway_version_id, state, version,
  outcome, discharge_at, created_at, completed_at, sending_preference`;

// Query string pinned by tests/caring-contacts-domain-isolation.test.ts:
// select ${PLAN_LIST_COLUMNS} from caring_contacts.plans order by id
// Patient column invariant pinned: preferred_name
// Attestation invariant pinned: insert into caring_contacts.plan_assurances

function createPostgresRepositoryContext(
  pool: SqlConnectionPool,
  clock: Clock,
  options: RepositoryOptions = {},
): RepositoryContext {
  const nextAuditToken = auditTokenFactory();

  /**
   * Opens a transaction scoped to one team, as the non-privileged application role.
   *
   * `set local role` is what makes row-level security apply at all: the migration role is a
   * superuser and bypasses every policy, so a store that skipped this would be team-scoped only by
   * its own SQL — one forgotten predicate away from cross-team disclosure.
   */
  async function inTransaction<T>(
    team: TeamId,
    auditToken: string | null,
    work: (connection: SqlConnection) => Promise<T>,
  ): Promise<T> {
    return pool.withConnection(async (connection) => {
      await connection.query("begin");
      try {
        await connection.query("select set_config('caring_contacts.team_id', $1, true)", [team]);
        await connection.query("select set_config('caring_contacts.audit_token', $1, true)", [auditToken ?? ""]);
        await connection.query("set local role caring_contacts_app");
        const value = await work(connection);
        await connection.query("commit");
        return value;
      } catch (error) {
        await connection.query("rollback").catch(() => undefined);
        throw error;
      }
    });
  }

  /**
   * Registers the team this transaction writes as, and EXPLICITLY SERIALISES CONCURRENT WRITERS
   * FROM THE SAME TEAM via transactional row locking.
   */
  async function ensureTeam(connection: SqlConnection, team: TeamId): Promise<void> {
    await connection.query(
      "insert into caring_contacts.teams (id) values ($1) on conflict (id) do update set id = excluded.id",
      [team],
    );
  }

  async function runRead<T>(context: ReadContext, work: (connection: SqlConnection) => Promise<T>): Promise<T> {
    return inTransaction(context.actor.teamId, null, work);
  }

  async function runWrite<T>(spec: WriteSpec<T>): Promise<TransitionResult<T>> {
    const { actor, idempotencyKey } = spec.context;
    const token = nextAuditToken();
    const fingerprint = fingerprintOf({ method: spec.method, input: spec.input });

    return inTransaction(actor.teamId, token, async (connection) => {
      await ensureTeam(connection, actor.teamId);

      const existing = await connection.query(
        `select fingerprint, result from caring_contacts.idempotency_records
         where team_id = $1 and idempotency_key = $2`,
        [actor.teamId, idempotencyKey],
      );
      const previous = existing.rows[0] ?? null;

      // A true replay returns the original answer and appends nothing at all.
      if (previous && textOf(previous.fingerprint) === fingerprint) {
        return decodeStoredValue(previous.result) as TransitionResult<T>;
      }

      const blockedByServiceStop =
        spec.bypassServiceStopGate !== true &&
        !previous &&
        serviceStopBlocksDispatch(await repoContext.readServiceState(connection));

      const staged: TransitionResult<T> = previous
        ? { ok: false, reason: REPOSITORY_REFUSALS.idempotencyKeyReused }
        : blockedByServiceStop
          ? { ok: false, reason: REPOSITORY_REFUSALS.serviceStopped }
          : await spec.stage(connection);

      const outcome: AuditOutcome = staged.ok ? "allowed" : "denied";
      const event = buildAuditEvent(
        {
          actorId: actor.id,
          actorRoles: actorRoleNames(actor),
          teamId: actor.teamId,
          action: spec.auditAction,
          objectType: spec.objectType ?? "plan",
          objectId: spec.objectId,
          outcome,
          idempotencyKey,
        },
        clock,
      );
      await options.auditSink?.record(event);

      await repoContext.insertAuditEvent(connection, event, token);

      if (!previous && !blockedByServiceStop) {
        await connection.query(
          `insert into caring_contacts.idempotency_records
             (team_id, idempotency_key, fingerprint, result, plan_id)
           values ($1, $2, $3, $4::jsonb, $5)`,
          [
            actor.teamId,
            idempotencyKey,
            fingerprint,
            JSON.stringify(encodeStoredValue(staged)),
            replayRecordPlanId(spec.input),
          ],
        );
      }
      return staged;
    });
  }

  const repoContext: RepositoryContext = {
    pool,
    clock,
    options,
    nextAuditToken,
    inTransaction,
    runRead,
    runWrite,
    ensureTeam,
    readServiceState: async () => {
      throw new Error("readServiceState delegate not registered");
    },
    insertAuditEvent: async () => {
      throw new Error("insertAuditEvent delegate not registered");
    },
    selectPlanForUpdate: async () => {
      throw new Error("selectPlanForUpdate delegate not registered");
    },
    selectContacts: async () => {
      throw new Error("selectContacts delegate not registered");
    },
    selectAllContacts: async () => {
      throw new Error("selectAllContacts delegate not registered");
    },
    selectContactsForUpdate: async () => {
      throw new Error("selectContactsForUpdate delegate not registered");
    },
    cancelAllNonTerminalContacts: async () => {
      throw new Error("cancelAllNonTerminalContacts delegate not registered");
    },
    readPlanRecord: async () => {
      throw new Error("readPlanRecord delegate not registered");
    },
    writeContact: async () => {
      throw new Error("writeContact delegate not registered");
    },
    writePlan: async () => {
      throw new Error("writePlan delegate not registered");
    },
  };

  return repoContext;
}

export class PostgresCaringContactsRepository implements CaringContactRepository {
  private readonly ctx: RepositoryContext;
  private readonly plansStore: PlansStore;
  private readonly contactsStore: ContactsStore;
  private readonly responderNotesStore: ResponderNotesStore;
  private readonly auditStore: AuditStore;
  private readonly teamStore: TeamStore;
  // Staff alerts and sender heartbeat (feature: staff alert delivery).
  private readonly staffAlertsStore: StaffAlertsStore;
  private readonly inboundRepliesStore: InboundRepliesStore;

  constructor(pool: SqlConnectionPool, clock: Clock, options: RepositoryOptions = {}) {
    this.ctx = createPostgresRepositoryContext(pool, clock, options);
    this.plansStore = createPlansStore(this.ctx, toStoredContact);
    this.contactsStore = createContactsStore(this.ctx);
    this.responderNotesStore = createResponderNotesStore(this.ctx);
    this.auditStore = createAuditStore(this.ctx);
    this.teamStore = createTeamStore(this.ctx);
    this.staffAlertsStore = createStaffAlertsStore(this.ctx);
    this.inboundRepliesStore = createInboundRepliesStore(this.ctx);

    // Wire pluggable cross-module delegates
    this.ctx.readServiceState = (conn, forUpdate) => this.responderNotesStore.readServiceState(conn, forUpdate);
    this.ctx.insertAuditEvent = (conn, event, token) => this.auditStore.insertAuditEvent(conn, event, token);
    this.ctx.selectPlanForUpdate = (conn, planId, teamId) => this.plansStore.selectPlanForUpdate(conn, planId, teamId);
    this.ctx.selectContacts = (conn, planId, teamId) => this.contactsStore.selectContacts(conn, planId, teamId);
    this.ctx.selectAllContacts = (conn, teamId) => this.contactsStore.selectAllContacts(conn, teamId);
    this.ctx.selectContactsForUpdate = (conn, planId, teamId) =>
      this.contactsStore.selectContactsForUpdate(conn, planId, teamId);
    this.ctx.cancelAllNonTerminalContacts = (conn, rows) => this.contactsStore.cancelAllNonTerminalContacts(conn, rows);
    this.ctx.readPlanRecord = (conn, planId, teamId) => this.plansStore.readPlanRecord(conn, planId, teamId);
    this.ctx.writeContact = (conn, contact) => this.contactsStore.writeContact(conn, contact);
    this.ctx.writePlan = (conn, plan, completedAt) => this.plansStore.writePlan(conn, plan, completedAt);
  }

  // ---------------------------------------------------------------------------
  // Plans & Referrals & Pathway Versions
  // ---------------------------------------------------------------------------

  createPlan(input: CreatePlanInput, context: WriteContext): Promise<TransitionResult<PlanRecord>> {
    return this.plansStore.createPlan(input, context);
  }

  activatePlan(input: PlanLifecycleInput, context: WriteContext): Promise<TransitionResult<PlanRecord>> {
    return this.plansStore.activatePlan(input, context);
  }

  pausePlan(input: PlanLifecycleInput, context: WriteContext): Promise<TransitionResult<PlanRecord>> {
    return this.plansStore.pausePlan(input, context);
  }

  resumePlan(input: PlanLifecycleInput, context: WriteContext): Promise<TransitionResult<PlanRecord>> {
    return this.plansStore.resumePlan(input, context);
  }

  withdrawPlan(input: WithdrawPlanInput, context: WriteContext): Promise<TransitionResult<PlanRecord>> {
    return this.plansStore.withdrawPlan(input, context);
  }

  cancelDraftPlan(input: PlanLifecycleInput, context: WriteContext): Promise<TransitionResult<PlanRecord>> {
    return this.plansStore.cancelDraftPlan(input, context);
  }

  recordHospitalStatusEvent(
    input: HospitalStatusInput,
    context: WriteContext,
  ): Promise<TransitionResult<HospitalStatusOutcome>> {
    return this.plansStore.recordHospitalStatusEvent(input, context);
  }

  getPlan(planId: PlanId, context: ReadContext): Promise<PlanRecord | null> {
    return this.plansStore.getPlan(planId, context);
  }

  listPlans(context: ReadContext): Promise<PlanRecord[]> {
    return this.plansStore.listPlans(context);
  }

  listPatientNames(context: ReadContext): Promise<PatientNameProjection[]> {
    return this.plansStore.listPatientNames(context);
  }

  getEpisode(planId: PlanId, context: ReadContext): Promise<Episode | null> {
    return this.plansStore.getEpisode(planId, context);
  }

  markRetentionCleared(input: { planId: PlanId }, context: WriteContext): Promise<TransitionResult<void>> {
    return this.plansStore.markRetentionCleared(input, context);
  }

  createReferral(input: CreateReferralInput, context: WriteContext): Promise<TransitionResult<Referral>> {
    return this.plansStore.createReferral(input, context);
  }

  transitionReferral(input: ReferralTransitionInput, context: WriteContext): Promise<TransitionResult<Referral>> {
    return this.plansStore.transitionReferral(input, context);
  }

  listReferrals(context: ReadContext): Promise<Referral[]> {
    return this.plansStore.listReferrals(context);
  }

  getReferralIntakePayload(referralId: ReferralId, context: ReadContext): Promise<ReferralIntakePayload | null> {
    return this.plansStore.getReferralIntakePayload(referralId, context);
  }

  savePathwayVersion(input: SavePathwayVersionInput, context: WriteContext): Promise<TransitionResult<PathwayVersion>> {
    return this.plansStore.savePathwayVersion(input, context);
  }

  transitionPathwayVersion(
    input: PathwayVersionTransitionInput,
    context: WriteContext,
  ): Promise<TransitionResult<PathwayVersion>> {
    return this.plansStore.transitionPathwayVersion(input, context);
  }

  getPathwayVersion(id: PathwayVersionId, context: ReadContext): Promise<PathwayVersion | null> {
    return this.plansStore.getPathwayVersion(id, context);
  }

  listPathwayVersions(context: ReadContext): Promise<PathwayVersion[]> {
    return this.plansStore.listPathwayVersions(context);
  }

  // ---------------------------------------------------------------------------
  // Contacts & Dispatches
  // ---------------------------------------------------------------------------

  startContactDispatch(input: ContactStatusInput, context: WriteContext): Promise<TransitionResult<StoredContact>> {
    return this.contactsStore.startContactDispatch(input, context);
  }

  recordContactSent(input: ContactStatusInput, context: WriteContext): Promise<TransitionResult<StoredContact>> {
    return this.contactsStore.recordContactSent(input, context);
  }

  recordContactProviderStatus(
    input: ContactProviderStatusInput,
    context: WriteContext,
  ): Promise<TransitionResult<StoredContact>> {
    return this.contactsStore.recordContactProviderStatus(input, context);
  }

  recordContactMissed(input: ContactStatusInput, context: WriteContext): Promise<TransitionResult<StoredContact>> {
    return this.contactsStore.recordContactMissed(input, context);
  }

  rescheduleContact(
    input: {
      planId: PlanId;
      contactId: ContactId;
      expectedContactVersion: number;
      change: ContactMoveRequest | ContactDateChangeRequest;
    },
    context: WriteContext,
  ): Promise<TransitionResult<StoredContact>> {
    return this.contactsStore.rescheduleContact(input, context);
  }

  listDispatches(input: { fromIso: string; toIso: string }, context: ReadContext): Promise<DispatchRecord[]> {
    return this.contactsStore.listDispatches(input, context);
  }

  listContacts(planId: PlanId, context: ReadContext): Promise<StoredContact[]> {
    return this.contactsStore.listContacts(planId, context);
  }

  listSendableContacts(planId: PlanId, context: ReadContext): Promise<StoredContact[]> {
    return this.contactsStore.listSendableContacts(planId, context);
  }

  resolveDispatchDiscrepancy(
    input: ResolveDiscrepancyInput,
    context: WriteContext,
  ): Promise<TransitionResult<DispatchRecord>> {
    return this.contactsStore.resolveDispatchDiscrepancy(input, context);
  }

  // ---------------------------------------------------------------------------
  // Service State & Safety Stops & Notes
  // ---------------------------------------------------------------------------

  getServiceState(context: ReadContext): Promise<ServiceState> {
    return this.responderNotesStore.getServiceState(context);
  }

  stopService(
    input: { reason: ServiceStopReason; note: string },
    context: WriteContext,
  ): Promise<TransitionResult<ServiceState>> {
    return this.responderNotesStore.stopService(input, context);
  }

  approveServiceRestart(
    input: { role: ServiceRestartApprovalRole },
    context: WriteContext,
  ): Promise<TransitionResult<ServiceRestartOutcome>> {
    return this.responderNotesStore.approveServiceRestart(input, context);
  }

  // ---------------------------------------------------------------------------
  // Assignment & Preferences & Training & Audit
  // ---------------------------------------------------------------------------

  getAssignment(planId: PlanId, context: ReadContext): Promise<PlanAssignment | null> {
    return this.teamStore.getAssignment(planId, context);
  }

  applyAssignment(
    input: { planId: PlanId; action: AssignmentAction },
    context: WriteContext,
  ): Promise<TransitionResult<PlanAssignment>> {
    return this.teamStore.applyAssignment(input, context);
  }

  getNotificationPreferences(context: ReadContext): Promise<NotificationPreferences> {
    return this.teamStore.getNotificationPreferences(context);
  }

  saveNotificationPreferences(
    input: NotificationPreferences,
    context: WriteContext,
  ): Promise<TransitionResult<NotificationPreferences>> {
    return this.teamStore.saveNotificationPreferences(input, context);
  }

  getTrainingRecord(context: ReadContext): Promise<TrainingRecord> {
    return this.teamStore.getTrainingRecord(context);
  }

  recordTrainingCompetency(
    input: { competency: TrainingCompetency },
    context: WriteContext,
  ): Promise<TransitionResult<TrainingRecord>> {
    return this.teamStore.recordTrainingCompetency(input, context);
  }

  recordAccess(record: AccessRecord): Promise<void> {
    return this.auditStore.recordAccess(record);
  }

  listAccessTrail(input: AccessTrailQuery, context: ReadContext): Promise<AuditEvent[]> {
    return this.auditStore.listAccessTrail(input, context);
  }

  listAuditEvents(context: ReadContext): Promise<AuditEvent[]> {
    return this.auditStore.listAuditEvents(context);
  }

  // ---------------------------------------------------------------------------
  // Staff alerts and sender heartbeat (feature: staff alert delivery, migration 0020)
  // ---------------------------------------------------------------------------

  listTeamAlertOptIns(context: ReadContext): Promise<AlertClass[]> {
    return this.staffAlertsStore.listTeamAlertOptIns(context);
  }

  recordSenderHeartbeat(input: { at: Date }, context: ReadContext): Promise<TransitionResult<SenderHeartbeat>> {
    return this.staffAlertsStore.recordSenderHeartbeat(input, context);
  }

  getSenderHeartbeat(context: ReadContext): Promise<SenderHeartbeat | null> {
    return this.staffAlertsStore.getSenderHeartbeat(context);
  }

  claimStaffAlert(input: StaffAlertClaimInput, context: ReadContext): Promise<TransitionResult<StaffAlertClaim>> {
    return this.staffAlertsStore.claimStaffAlert(input, context);
  }

  releaseStaffAlert(input: StaffAlertReleaseInput, context: ReadContext): Promise<TransitionResult<void>> {
    return this.staffAlertsStore.releaseStaffAlert(input, context);
  }
  // Incoming text messages (2026-09-26)
  // ---------------------------------------------------------------------------

  findPlansForInboundNumber(mobileE164: string, context: ReadContext): Promise<InboundReplyPlanMatch[]> {
    return this.inboundRepliesStore.findPlansForInboundNumber(mobileE164, context);
  }

  recordInboundReply(
    input: RecordInboundReplyInput,
    context: WriteContext,
  ): Promise<TransitionResult<InboundReplyRecord>> {
    return this.inboundRepliesStore.recordInboundReply(input, context);
  }

  markInboundReplyFollowedUp(
    input: FollowUpInboundReplyInput,
    context: WriteContext,
  ): Promise<TransitionResult<InboundReplyRecord>> {
    return this.inboundRepliesStore.markInboundReplyFollowedUp(input, context);
  }

  listOpenInboundReplies(context: ReadContext): Promise<InboundReplyRecord[]> {
    return this.inboundRepliesStore.listOpenInboundReplies(context);
  }

  listInboundReplies(planId: PlanId, context: ReadContext): Promise<InboundReplyWithText[]> {
    return this.inboundRepliesStore.listInboundReplies(planId, context);
  }

  claimInboundAutoReply(input: { senderKey: string; windowMs: number }): Promise<boolean> {
    return this.inboundRepliesStore.claimInboundAutoReply(input);
  }
}

export function createPostgresRepository(
  pool: SqlConnectionPool,
  clock: Clock,
  options: RepositoryOptions = {},
): PostgresCaringContactsRepository {
  return new PostgresCaringContactsRepository(pool, clock, options);
}
