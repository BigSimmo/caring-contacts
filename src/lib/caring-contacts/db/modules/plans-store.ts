// src/lib/caring-contacts/db/modules/plans-store.ts
//
// Domain module: Plan creation, status changes, clearances, plan querying, referrals, pathway versions.

import { isPlanAssurance, type PlanAssuranceAttestation } from "../../assurances";
import { awstIsoTimestamp } from "../../clock";
import type { Episode } from "../../episode";
import {
  admitWithdrawalReason,
  applyHospitalStatusEvent,
  applyWithdrawalRequest,
  sendableContacts,
} from "../../hospital-events";
import {
  actorId as toActorId,
  teamId as toTeamId,
  type PathwayVersionId,
  type PatientId,
  type PlanId,
  type ReferralId,
  type TeamId,
} from "../../ids";
import {
  DISPATCHED_CONTACT_STATES,
  TERMINAL_PLAN_STATES,
  applyDraftCancellation,
  applyPlanTransition,
  type ContactState,
  type PathwayVersionState,
  type Plan,
  type PlanState,
  type Referral,
  type ReferralState,
  type TransitionResult,
} from "../../model";
import {
  applyPathwayVersionTransition,
  type PathwayApproval,
  type PathwayApprovalRole,
  type PathwayRetirementUrgency,
  type PathwayVersion,
  type PathwayVersionSnapshot,
} from "../../pathway-versions";
import {
  admitContactDetailEdit,
  admitPlanStart,
  contactDetailAuditAction,
  isMobileCheckState,
  MOBILE_NOT_CHECKED,
  planAfterDetailWrite,
  recordMobileCheckSent as markMobileCheckSent,
  resolveMobileCheck as answerMobileCheck,
  type MobileCheck,
} from "../../mobile-check";
import { canPerformCaringContactAction, type CaringContactAction, type CaringContactActor } from "../../permissions";
import { applyReferralTransition } from "../../referrals";
import { admitRetentionClearance } from "../../retention";
import {
  CLEARED_PATIENT_DETAIL,
  CLEARED_PATIENT_FREE_TEXT,
  PATHWAY_VERSION_READ_ACTIONS,
  PATIENT_NAME_READ_ACTIONS,
  READ_ACTIONS,
  REPOSITORY_REFUSALS,
  admitPathwayGovernanceActor,
  admitPlanAssurances,
  contactIdentifierFor,
  isTerminalPlan,
  outcomeFor,
  type ContactDetailInput,
  type ContactDetailOutcome,
  type CreatePlanInput,
  type CreateReferralInput,
  type HospitalStatusInput,
  type ReferralIntakePayload,
  type HospitalStatusOutcome,
  type PathwayVersionTransitionInput,
  type PatientNameProjection,
  type PlanLifecycleInput,
  type PlanOutcome,
  type PlanRecord,
  type ReadContext,
  type ReferralTransitionInput,
  type ResolveMobileCheckInput,
  type SavePathwayVersionInput,
  type SharedMobileQuery,
  type StoredContact,
  type StoredPatientDetail,
  type WithdrawPlanInput,
  type WriteContext,
} from "../../repository";
import { buildApprovedSchedule } from "../../schedule";
import { toAustralianMobileE164 } from "../../transport/phone";
import {
  encodeStoredValue,
  INSERT_SAVEPOINT,
  instantOf,
  isAbsent,
  mayReadAllOwnTeam,
  mayReadAnyOwnTeam,
  mayReadOwnTeam,
  numberOf,
  textOf,
  withSavepoint,
  type RepositoryContext,
  type SqlConnection,
  type SqlRow,
} from "../shared";

export const PLAN_COLUMNS = `id, team_id, patient_id, referral_id, pathway_version_id, state, version, outcome,
  discharge_at, created_at, completed_at, sending_preference, patient_name, patient_mobile_number,
  patient_identifiers, mobile_check_state, mobile_check_sent_at, mobile_check_resolved_at`;

export const PLAN_LIST_COLUMNS = `id, team_id, patient_id, referral_id, pathway_version_id, state, version,
  outcome, discharge_at, created_at, completed_at, sending_preference, mobile_check_state, mobile_check_sent_at,
  mobile_check_resolved_at`;

export const PLAN_ASSURANCE_COLUMNS = "plan_id, assurance, actor_id, attested_at";

export const REFERRAL_COLUMNS = "id, team_id, patient_id, state, pathway_version_id";

export const PATHWAY_VERSION_COLUMNS = `id, team_id, state, author_id, published_at, retired_at,
  retirement_urgency, snapshot`;

export function toPlan(row: SqlRow): Plan {
  return {
    id: textOf(row.id) as PlanId,
    teamId: toTeamId(textOf(row.team_id)),
    state: textOf(row.state) as PlanState,
    version: numberOf(row.version),
  };
}

export function toAssuranceAttestation(row: SqlRow): PlanAssuranceAttestation {
  const assurance = textOf(row.assurance);
  if (!isPlanAssurance(assurance)) {
    throw new Error(`caring-contacts: plan assurance "${assurance}" is not one this domain knows`);
  }
  return { assurance, actorId: toActorId(textOf(row.actor_id)), attestedAt: instantOf(row.attested_at) };
}

/** The number check's three columns (migration 0030). An unknown state fails loudly, like an unknown assurance. */
export function toMobileCheck(row: SqlRow): MobileCheck {
  const state = textOf(row.mobile_check_state);
  if (!isMobileCheckState(state)) {
    throw new Error(`caring-contacts: mobile check state "${state}" is not one this domain knows`);
  }
  return {
    state,
    sentAt: isAbsent(row.mobile_check_sent_at) ? null : instantOf(row.mobile_check_sent_at).toISOString(),
    resolvedAt: isAbsent(row.mobile_check_resolved_at) ? null : instantOf(row.mobile_check_resolved_at).toISOString(),
  };
}

/**
 * Writes a plan's number check together with its next version, under the same optimistic guard
 * `writePlan` uses. The check columns hold no patient content.
 */
export async function writeMobileCheck(
  connection: SqlConnection,
  plan: Plan,
  check: MobileCheck,
  completedAt: Date | null,
): Promise<void> {
  await writePlan(connection, plan, completedAt);
  await connection.query(
    `update caring_contacts.plans
        set mobile_check_state = $2, mobile_check_sent_at = $3, mobile_check_resolved_at = $4
      where id = $1`,
    [
      plan.id,
      check.state,
      check.sentAt === null ? null : new Date(check.sentAt),
      check.resolvedAt === null ? null : new Date(check.resolvedAt),
    ],
  );
}

export function toPlanRecord(
  planRow: SqlRow,
  contactRows: readonly SqlRow[],
  assuranceRows: readonly SqlRow[],
  toStoredContactFn: (row: SqlRow) => StoredContact,
): PlanRecord {
  return {
    plan: toPlan(planRow),
    patientId: textOf(planRow.patient_id) as PatientId,
    referralId: textOf(planRow.referral_id) as ReferralId,
    pathwayVersionId: textOf(planRow.pathway_version_id) as PathwayVersionId,
    dischargeAt: instantOf(planRow.discharge_at),
    createdAt: instantOf(planRow.created_at),
    completedAt:
      planRow.completed_at === null || planRow.completed_at === undefined ? null : instantOf(planRow.completed_at),
    outcome: textOf(planRow.outcome) as PlanOutcome,
    contacts: contactRows.map(toStoredContactFn),
    assuranceAttestations: assuranceRows.map(toAssuranceAttestation),
    mobileCheck: toMobileCheck(planRow),
  };
}

export function toReferral(row: SqlRow): Referral {
  return {
    id: textOf(row.id) as ReferralId,
    teamId: toTeamId(textOf(row.team_id)),
    patientId: textOf(row.patient_id) as PatientId,
    state: textOf(row.state) as ReferralState,
    pathwayVersionId: isAbsent(row.pathway_version_id) ? null : (textOf(row.pathway_version_id) as PathwayVersionId),
  };
}

export function toPathwayApproval(row: SqlRow): PathwayApproval {
  return {
    role: textOf(row.role) as PathwayApprovalRole,
    actorId: toActorId(textOf(row.actor_id)),
    approvedAt: awstIsoTimestamp(instantOf(row.approved_at)),
  };
}

export function toPathwayVersion(row: SqlRow, approvals: readonly PathwayApproval[]): PathwayVersion {
  return {
    id: textOf(row.id) as PathwayVersionId,
    teamId: toTeamId(textOf(row.team_id)),
    state: textOf(row.state) as PathwayVersionState,
    authorId: toActorId(textOf(row.author_id)),
    approvals,
    publishedAt: isAbsent(row.published_at) ? null : awstIsoTimestamp(instantOf(row.published_at)),
    retiredAt: isAbsent(row.retired_at) ? null : awstIsoTimestamp(instantOf(row.retired_at)),
    retirementUrgency: isAbsent(row.retirement_urgency)
      ? null
      : (textOf(row.retirement_urgency) as PathwayRetirementUrgency),
    snapshot: row.snapshot as PathwayVersionSnapshot,
  };
}

export async function selectPlanForUpdate(
  connection: SqlConnection,
  planId: PlanId,
  teamId?: TeamId,
): Promise<SqlRow | null> {
  const result = teamId
    ? await connection.query(
        `select ${PLAN_COLUMNS} from caring_contacts.plans where id = $1 and team_id = $2 for update`,
        [planId, teamId],
      )
    : await connection.query(`select ${PLAN_COLUMNS} from caring_contacts.plans where id = $1 for update`, [planId]);
  return result.rows[0] ?? null;
}

export async function writePlan(connection: SqlConnection, plan: Plan, completedAt: Date | null): Promise<void> {
  const result = await connection.query(
    `update caring_contacts.plans
       set state = $2, version = $3, outcome = $4, completed_at = $5
     where id = $1 and version = $6`,
    [plan.id, plan.state, plan.version, outcomeFor(plan.state), completedAt, plan.version - 1],
  );
  if (result.rowCount !== 1) {
    throw new Error(`caring-contacts: plan ${plan.id} moved under an optimistic write that held a row lock`);
  }
}

export async function selectPlanAssurances(connection: SqlConnection, planId: PlanId): Promise<SqlRow[]> {
  const result = await connection.query(
    `select ${PLAN_ASSURANCE_COLUMNS} from caring_contacts.plan_assurances
       where plan_id = $1 order by attested_at, assurance`,
    [planId],
  );
  return result.rows;
}

export async function readPlanRecord(
  connection: SqlConnection,
  ctx: RepositoryContext,
  planId: PlanId,
  teamId?: TeamId,
): Promise<{ planRow: SqlRow; contactRows: SqlRow[]; assuranceRows: SqlRow[] } | null> {
  const result = teamId
    ? await connection.query(`select ${PLAN_COLUMNS} from caring_contacts.plans where id = $1 and team_id = $2`, [
        planId,
        teamId,
      ])
    : await connection.query(`select ${PLAN_COLUMNS} from caring_contacts.plans where id = $1`, [planId]);
  const planRow = result.rows[0];
  if (!planRow) return null;
  return {
    planRow,
    contactRows: await ctx.selectContacts(connection, planId, teamId ?? toTeamId(textOf(planRow.team_id))),
    assuranceRows: await selectPlanAssurances(connection, planId),
  };
}

export async function readPathwayVersion(connection: SqlConnection, versionId: string): Promise<PathwayVersion | null> {
  const result = await connection.query(
    `select ${PATHWAY_VERSION_COLUMNS} from caring_contacts.pathway_versions where id = $1`,
    [versionId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const approvals = await connection.query(
    `select role, actor_id, approved_at from caring_contacts.pathway_version_approvals
     where pathway_version_id = $1 order by id`,
    [versionId],
  );
  return toPathwayVersion(row, approvals.rows.map(toPathwayApproval));
}

export async function readAllPathwayVersions(connection: SqlConnection): Promise<PathwayVersion[]> {
  const versions = await connection.query(
    `select ${PATHWAY_VERSION_COLUMNS} from caring_contacts.pathway_versions order by id`,
  );
  const approvals = await connection.query(
    `select pathway_version_id, role, actor_id, approved_at
     from caring_contacts.pathway_version_approvals order by id`,
  );

  const byVersion = new Map<string, PathwayApproval[]>();
  for (const row of approvals.rows) {
    const key = textOf(row.pathway_version_id);
    const bucket = byVersion.get(key);
    if (bucket) bucket.push(toPathwayApproval(row));
    else byVersion.set(key, [toPathwayApproval(row)]);
  }

  return versions.rows.map((row) => toPathwayVersion(row, byVersion.get(textOf(row.id)) ?? []));
}

export class PlansStore {
  constructor(
    private readonly ctx: RepositoryContext,
    private readonly toStoredContactFn: (row: SqlRow) => StoredContact,
  ) {}

  selectPlanForUpdate(connection: SqlConnection, planId: PlanId, teamId?: TeamId): Promise<SqlRow | null> {
    return selectPlanForUpdate(connection, planId, teamId);
  }

  writePlan(connection: SqlConnection, plan: Plan, completedAt: Date | null): Promise<void> {
    return writePlan(connection, plan, completedAt);
  }

  readPlanRecord(
    connection: SqlConnection,
    planId: PlanId,
    teamId?: TeamId,
  ): Promise<{ planRow: SqlRow; contactRows: SqlRow[]; assuranceRows: SqlRow[] } | null> {
    return readPlanRecord(connection, this.ctx, planId, teamId);
  }

  private toPlanRecord(planRow: SqlRow, contactRows: readonly SqlRow[], assuranceRows: readonly SqlRow[]): PlanRecord {
    return toPlanRecord(planRow, contactRows, assuranceRows, this.toStoredContactFn);
  }

  private async resolveForWrite(
    connection: SqlConnection,
    input: PlanLifecycleInput,
    actor: CaringContactActor,
    actions: readonly CaringContactAction[],
  ): Promise<TransitionResult<SqlRow>> {
    const row = await selectPlanForUpdate(connection, input.planId);
    if (!row) return { ok: false, reason: REPOSITORY_REFUSALS.notFound };

    const team = toTeamId(textOf(row.team_id));
    const permitted = actions.some((action) => canPerformCaringContactAction(actor, action, { teamId: team }).allowed);
    if (!permitted) return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
    if (numberOf(row.version) !== input.expectedVersion) {
      return { ok: false, reason: REPOSITORY_REFUSALS.staleVersion };
    }
    return { ok: true, value: row };
  }

  private async lifecycleWrite(
    method: string,
    action: CaringContactAction,
    transition: "activate" | "pause" | "resume",
    input: PlanLifecycleInput,
    context: WriteContext,
  ): Promise<TransitionResult<PlanRecord>> {
    return this.ctx.runWrite<PlanRecord>({
      method,
      input,
      context,
      auditAction: method,
      objectId: input.planId,
      stage: async (connection) => {
        const resolved = await this.resolveForWrite(connection, input, context.actor, [action]);
        if (!resolved.ok) return resolved;
        const moved = applyPlanTransition(toPlan(resolved.value), { type: transition });
        if (!moved.ok) return moved;
        // The same rule, from the same module, as the in-memory store: see `admitPlanStart`.
        if (transition !== "pause") {
          const admitted = admitPlanStart(toMobileCheck(resolved.value));
          if (!admitted.ok) return admitted;
        }

        const completedAt = isTerminalPlan(moved.value.state) ? this.ctx.clock.now() : null;
        await writePlan(connection, moved.value, completedAt);

        const stored = await this.readPlanRecord(connection, input.planId);
        if (!stored) throw new Error(`caring-contacts: plan ${input.planId} vanished inside its own transaction`);
        return { ok: true, value: this.toPlanRecord(stored.planRow, stored.contactRows, stored.assuranceRows) };
      },
    });
  }

  async createPlan(input: CreatePlanInput, context: WriteContext): Promise<TransitionResult<PlanRecord>> {
    const name = input?.patientDetail?.patientName ?? (input as unknown as { patientName?: string })?.patientName ?? "";
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new Error("Validation error: patient name must not be blank");
    }
    return this.ctx.runWrite<PlanRecord>({
      method: "createPlan",
      input,
      context,
      auditAction: "createPlan",
      objectId: input.planId,
      stage: async (connection) => {
        const { actor } = context;
        if (!canPerformCaringContactAction(actor, "claimPlan", { teamId: actor.teamId }).allowed) {
          return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
        }

        const exists = await connection.query("select caring_contacts.plan_exists($1) as present", [input.planId]);
        if (exists.rows[0].present === true) {
          return { ok: false, reason: REPOSITORY_REFUSALS.planAlreadyExists };
        }
        const open = await connection.query("select caring_contacts.patient_has_non_terminal_plan($1) as present", [
          input.patientId,
        ]);
        if (open.rows[0].present === true) {
          return { ok: false, reason: REPOSITORY_REFUSALS.duplicateActivePlan };
        }

        const assurances = admitPlanAssurances(input.assurances);
        if (!assurances.ok) return assurances;

        const schedule = buildApprovedSchedule({
          dischargeAt: input.dischargeAt,
          sendingPreference: input.sendingPreference,
          firstContactDate: input.firstContactDate,
          firstContactReason: input.firstContactReason,
        });
        if (!schedule.ok) return schedule;

        const createdAt = this.ctx.clock.now();

        await connection.query(
          `insert into caring_contacts.plans
             (id, team_id, patient_id, referral_id, pathway_version_id, state, version, outcome,
              discharge_at, created_at, completed_at, sending_preference, patient_name,
              patient_mobile_number, patient_identifiers, first_contact_reason, preferred_name)
           values ($1, $2, $3, $4, $5, 'draft', 1, 'inProgress', $6, $7, null, $8, $9, $10, $11, $12, $13)`,
          [
            input.planId,
            actor.teamId,
            input.patientId,
            input.referralId,
            input.pathwayVersionId,
            input.dischargeAt,
            createdAt,
            input.sendingPreference,
            input.patientDetail.patientName,
            input.patientDetail.patientMobileNumber,
            [...input.patientDetail.patientIdentifiers],
            schedule.firstContactReason,
            input.patientDetail.preferredName,
          ],
        );

        const sendable = new Set(sendableContacts(schedule.contacts).map((planned) => planned.sequence));
        for (const planned of schedule.contacts) {
          await connection.query(
            `insert into caring_contacts.contacts
               (id, plan_id, team_id, sequence, state, version, cadence_label, calendar_day, send_at,
                message_type, suppressed_reason)
             values ($1, $2, $3, $4, $5, 1, $6, $7, $8, $9, $10)`,
            [
              contactIdentifierFor(input.planId, planned.sequence),
              input.planId,
              actor.teamId,
              planned.sequence,
              sendable.has(planned.sequence) ? "scheduled" : "suppressed",
              planned.cadenceLabel,
              planned.calendarDay,
              planned.sendAt,
              planned.messageType,
              planned.suppressed?.reason ?? null,
            ],
          );
        }

        const attestedAt = createdAt;
        for (const assurance of assurances.value) {
          await connection.query(
            `insert into caring_contacts.plan_assurances (plan_id, team_id, assurance, actor_id, attested_at)
             values ($1, $2, $3, $4, $5)`,
            [input.planId, actor.teamId, assurance, actor.id, attestedAt],
          );
        }

        if (input.patientDetail.culturalIdentity !== null) {
          await connection.query(
            `insert into caring_contacts.cultural_identity_reports (plan_id, team_id, cultural_identity)
             values ($1, $2, $3)`,
            [input.planId, actor.teamId, input.patientDetail.culturalIdentity],
          );
        }

        const stored = await this.readPlanRecord(connection, input.planId);
        if (!stored) throw new Error(`caring-contacts: plan ${input.planId} vanished inside its own transaction`);
        return { ok: true, value: this.toPlanRecord(stored.planRow, stored.contactRows, stored.assuranceRows) };
      },
    });
  }

  async activatePlan(input: PlanLifecycleInput, context: WriteContext): Promise<TransitionResult<PlanRecord>> {
    return this.lifecycleWrite("activatePlan", "activatePlan", "activate", input, context);
  }

  async pausePlan(input: PlanLifecycleInput, context: WriteContext): Promise<TransitionResult<PlanRecord>> {
    return this.lifecycleWrite("pausePlan", "pausePlan", "pause", input, context);
  }

  async resumePlan(input: PlanLifecycleInput, context: WriteContext): Promise<TransitionResult<PlanRecord>> {
    return this.lifecycleWrite("resumePlan", "resumePlan", "resume", input, context);
  }

  async withdrawPlan(input: WithdrawPlanInput, context: WriteContext): Promise<TransitionResult<PlanRecord>> {
    return this.ctx.runWrite<PlanRecord>({
      method: "withdrawPlan",
      input,
      context,
      auditAction: "withdrawPlan",
      objectId: input.planId,
      stage: async (connection) => {
        const resolved = await this.resolveForWrite(connection, input, context.actor, ["withdrawPlan"]);
        if (!resolved.ok) return resolved;

        const withdrawal = applyWithdrawalRequest(toPlan(resolved.value), { origin: input.origin });
        if (!withdrawal.ok) return withdrawal;
        const reason = admitWithdrawalReason(input.reason);
        if (!reason.ok) return reason;

        const completedAt = isTerminalPlan(withdrawal.value.plan.state) ? this.ctx.clock.now() : null;
        await writePlan(connection, withdrawal.value.plan, completedAt);
        // With the patient detail columns, never selected by a list read: see `admitWithdrawalReason`.
        await connection.query("update caring_contacts.plans set withdrawal_reason = $2 where id = $1", [
          input.planId,
          reason.value,
        ]);
        await this.ctx.cancelAllNonTerminalContacts(
          connection,
          await this.ctx.selectContactsForUpdate(connection, input.planId),
        );

        const stored = await this.readPlanRecord(connection, input.planId);
        if (!stored) throw new Error(`caring-contacts: plan ${input.planId} vanished inside its own transaction`);
        return { ok: true, value: this.toPlanRecord(stored.planRow, stored.contactRows, stored.assuranceRows) };
      },
    });
  }

  async cancelDraftPlan(input: PlanLifecycleInput, context: WriteContext): Promise<TransitionResult<PlanRecord>> {
    return this.ctx.runWrite<PlanRecord>({
      method: "cancelDraftPlan",
      input,
      context,
      auditAction: "cancelDraftPlan",
      objectId: input.planId,
      stage: async (connection) => {
        // `claimPlan` is what `createPlan` requires, so the roles that create a plan cancel one.
        const resolved = await this.resolveForWrite(connection, input, context.actor, ["claimPlan"]);
        if (!resolved.ok) return resolved;

        const cancellation = applyDraftCancellation(toPlan(resolved.value));
        if (!cancellation.ok) return cancellation;

        await writePlan(connection, cancellation.value, this.ctx.clock.now());
        await this.ctx.cancelAllNonTerminalContacts(
          connection,
          await this.ctx.selectContactsForUpdate(connection, input.planId),
        );

        const stored = await this.readPlanRecord(connection, input.planId);
        if (!stored) throw new Error(`caring-contacts: plan ${input.planId} vanished inside its own transaction`);
        return { ok: true, value: this.toPlanRecord(stored.planRow, stored.contactRows, stored.assuranceRows) };
      },
    });
  }

  async recordHospitalStatusEvent(
    input: HospitalStatusInput,
    context: WriteContext,
  ): Promise<TransitionResult<HospitalStatusOutcome>> {
    const actions: readonly CaringContactAction[] =
      input.event.type === "death" || input.event.type === "deathCorrection"
        ? ["recordHospitalStatusEvent", "triggerServiceSafetyStop"]
        : ["recordHospitalStatusEvent"];

    return this.ctx.runWrite<HospitalStatusOutcome>({
      method: "recordHospitalStatusEvent",
      input,
      context,
      auditAction: `recordHospitalStatusEvent:${input.event.type}`,
      objectId: input.planId,
      bypassServiceStopGate: true,
      stage: async (connection) => {
        const resolved = await this.resolveForWrite(connection, input, context.actor, actions);
        if (!resolved.ok) return resolved;

        const applied = applyHospitalStatusEvent(toPlan(resolved.value), input.event);
        if (!applied.ok) return applied;

        const completedAt = isTerminalPlan(applied.value.plan.state) ? this.ctx.clock.now() : null;
        if (applied.value.plan.version !== numberOf(resolved.value.version)) {
          await writePlan(connection, applied.value.plan, completedAt);
        }

        const { contactOutcome } = applied.value;
        const stopsEverything = contactOutcome.type === "cancelUnsent" || contactOutcome.type === "stopAll";
        const cancelled = stopsEverything
          ? await this.ctx.cancelAllNonTerminalContacts(
              connection,
              await this.ctx.selectContactsForUpdate(connection, input.planId),
            )
          : 0;

        const stored = await this.readPlanRecord(connection, input.planId);
        if (!stored) throw new Error(`caring-contacts: plan ${input.planId} vanished inside its own transaction`);

        const value: HospitalStatusOutcome = {
          record: this.toPlanRecord(stored.planRow, stored.contactRows, stored.assuranceRows),
          exceptions: applied.value.exceptions,
          contactsCancelled: cancelled,
        };
        if (applied.value.incident) value.incident = applied.value.incident;
        return { ok: true, value };
      },
    });
  }

  async updatePatientContactDetail(
    input: ContactDetailInput,
    context: WriteContext,
  ): Promise<TransitionResult<ContactDetailOutcome>> {
    return this.ctx.runWrite<ContactDetailOutcome>({
      method: "updatePatientContactDetail",
      input,
      context,
      auditAction: "updatePatientContactDetail",
      auditActionFor: (value) => contactDetailAuditAction(value.changed),
      objectId: input.planId,
      stage: async (connection) => {
        const resolved = await this.resolveForWrite(connection, input, context.actor, ["recordHospitalStatusEvent"]);
        if (!resolved.ok) return resolved;
        const plan = toPlan(resolved.value);
        if (isTerminalPlan(plan.state)) return { ok: false, reason: "plan-terminal" };

        // The detail columns are read here, inside the write, and never leave it: the outcome
        // carries the record and the names of the changed fields, not their values.
        const detail = await connection.query(
          "select patient_name, preferred_name, patient_mobile_number from caring_contacts.plans where id = $1",
          [input.planId],
        );
        const row = detail.rows[0];
        const edit = admitContactDetailEdit(
          {
            patientName: textOf(row.patient_name),
            preferredName: isAbsent(row.preferred_name) ? null : textOf(row.preferred_name),
            patientMobileNumber: textOf(row.patient_mobile_number),
          },
          {
            patientName: input.patientName,
            preferredName: input.preferredName,
            patientMobileNumber: input.patientMobileNumber,
          },
        );
        if (!edit.ok) return edit;
        const mobileChanged = edit.value.changed.includes("mobile");
        const moved = planAfterDetailWrite(plan, mobileChanged);
        if (!moved.ok) return moved;

        const check = mobileChanged ? MOBILE_NOT_CHECKED : toMobileCheck(resolved.value);
        await writeMobileCheck(connection, moved.value.plan, check, null);
        await connection.query(
          `update caring_contacts.plans
              set patient_name = $2, preferred_name = $3, patient_mobile_number = $4
            where id = $1`,
          [
            input.planId,
            edit.value.next.patientName,
            edit.value.next.preferredName,
            edit.value.next.patientMobileNumber,
          ],
        );

        const stored = await this.readPlanRecord(connection, input.planId);
        if (!stored) throw new Error(`caring-contacts: plan ${input.planId} vanished inside its own transaction`);
        return {
          ok: true,
          value: {
            record: this.toPlanRecord(stored.planRow, stored.contactRows, stored.assuranceRows),
            mobileChanged,
            changed: [...edit.value.changed],
            exceptions: [...moved.value.exceptions],
          },
        };
      },
    });
  }

  async recordMobileCheckSent(input: PlanLifecycleInput, context: WriteContext): Promise<TransitionResult<PlanRecord>> {
    return this.ctx.runWrite<PlanRecord>({
      method: "recordMobileCheckSent",
      input,
      context,
      auditAction: "recordMobileCheckSent",
      objectId: input.planId,
      stage: async (connection) => {
        const resolved = await this.resolveForWrite(connection, input, context.actor, ["recordHospitalStatusEvent"]);
        if (!resolved.ok) return resolved;
        const moved = planAfterDetailWrite(toPlan(resolved.value), false);
        if (!moved.ok) return moved;
        const check = markMobileCheckSent(toMobileCheck(resolved.value), this.ctx.clock.now());
        await writeMobileCheck(connection, moved.value.plan, check, null);

        const stored = await this.readPlanRecord(connection, input.planId);
        if (!stored) throw new Error(`caring-contacts: plan ${input.planId} vanished inside its own transaction`);
        return { ok: true, value: this.toPlanRecord(stored.planRow, stored.contactRows, stored.assuranceRows) };
      },
    });
  }

  async resolveMobileCheck(
    input: ResolveMobileCheckInput,
    context: WriteContext,
  ): Promise<TransitionResult<PlanRecord>> {
    return this.ctx.runWrite<PlanRecord>({
      method: "resolveMobileCheck",
      input,
      context,
      auditAction: `resolveMobileCheck:${input.outcome}`,
      objectId: input.planId,
      stage: async (connection) => {
        const resolved = await this.resolveForWrite(connection, input, context.actor, ["recordHospitalStatusEvent"]);
        if (!resolved.ok) return resolved;
        const moved = planAfterDetailWrite(toPlan(resolved.value), false);
        if (!moved.ok) return moved;
        const answered = answerMobileCheck(toMobileCheck(resolved.value), input.outcome, this.ctx.clock.now());
        if (!answered.ok) return answered;
        await writeMobileCheck(connection, moved.value.plan, answered.value, null);

        const stored = await this.readPlanRecord(connection, input.planId);
        if (!stored) throw new Error(`caring-contacts: plan ${input.planId} vanished inside its own transaction`);
        return { ok: true, value: this.toPlanRecord(stored.planRow, stored.contactRows, stored.assuranceRows) };
      },
    });
  }

  async createReferral(input: CreateReferralInput, context: WriteContext): Promise<TransitionResult<Referral>> {
    return this.ctx.runWrite<Referral>({
      method: "createReferral",
      input,
      context,
      auditAction: "createReferral",
      objectType: "referral",
      objectId: input.referralId,
      stage: async (connection) => {
        const { actor } = context;
        if (!canPerformCaringContactAction(actor, "createReferral", { teamId: actor.teamId }).allowed) {
          return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
        }

        // Same two checks, in the same order, as the in-memory store. The open-plan question is
        // cross-team, so it goes through the security-definer function `createPlan` uses; the
        // accepted-referral question is this team's own rows under row-level security.
        const openPlan = await connection.query("select caring_contacts.patient_has_non_terminal_plan($1) as present", [
          input.patientId,
        ]);
        if (openPlan.rows[0].present === true) {
          return { ok: false, reason: REPOSITORY_REFUSALS.duplicateActivePlan };
        }
        const acceptedWithoutPlan = await connection.query(
          `select exists (
             select 1 from caring_contacts.referrals r
             where r.patient_id = $1 and r.state = 'accepted'
               and not exists (select 1 from caring_contacts.plans p where p.referral_id = r.id)
           ) as present`,
          [input.patientId],
        );
        if (acceptedWithoutPlan.rows[0].present === true) {
          return { ok: false, reason: REPOSITORY_REFUSALS.referralAlreadyAcceptedForPatient };
        }

        const referral: Referral = {
          id: input.referralId,
          teamId: actor.teamId,
          patientId: input.patientId,
          state: "awaitingHandover",
          pathwayVersionId: null,
        };
        const intakePayload = input.intakePayload ?? null;

        // intake_payload is the H-44 clinical sidecar (migration 0010_referral_intake_payload);
        // omitted createReferral callers leave it null so identifier-only referrals stay valid.
        const inserted = await withSavepoint(connection, INSERT_SAVEPOINT, () =>
          connection.query(
            `insert into caring_contacts.referrals (id, team_id, patient_id, state, pathway_version_id, intake_payload)
             values ($1, $2, $3, $4, null, $5::jsonb)`,
            [
              referral.id,
              referral.teamId,
              referral.patientId,
              referral.state,
              intakePayload ? JSON.stringify(intakePayload) : null,
            ],
          ),
        );
        if (!inserted.ok) {
          if (inserted.constraint === "referrals_pkey") {
            return { ok: false, reason: REPOSITORY_REFUSALS.referralAlreadyExists };
          }
          throw inserted.error;
        }

        return { ok: true, value: referral };
      },
    });
  }

  async transitionReferral(input: ReferralTransitionInput, context: WriteContext): Promise<TransitionResult<Referral>> {
    const permission: CaringContactAction =
      input.action.type === "accept"
        ? "acceptReferral"
        : input.action.type === "returnForClarification"
          ? "returnReferralForClarification"
          : "declineReferral";
    return this.ctx.runWrite<Referral>({
      method: "transitionReferral",
      input,
      context,
      auditAction: "transitionReferral",
      objectType: "referral",
      objectId: input.referralId,
      stage: async (connection) => {
        const result = await connection.query(
          `select ${REFERRAL_COLUMNS} from caring_contacts.referrals where id = $1 for update`,
          [input.referralId],
        );
        const row = result.rows[0];
        if (!row) return { ok: false, reason: REPOSITORY_REFUSALS.notFound };

        const stored = toReferral(row);
        if (!canPerformCaringContactAction(context.actor, permission, { teamId: stored.teamId }).allowed) {
          return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
        }

        const transitioned = applyReferralTransition(stored, input.action);
        if (!transitioned.ok) return transitioned;

        await connection.query(
          "update caring_contacts.referrals set state = $2, pathway_version_id = $3 where id = $1",
          [input.referralId, transitioned.value.state, transitioned.value.pathwayVersionId],
        );
        return { ok: true, value: transitioned.value };
      },
    });
  }

  async listReferrals(context: ReadContext): Promise<Referral[]> {
    if (!mayReadOwnTeam(context, READ_ACTIONS.referral)) return [];
    return this.ctx.runRead(context, async (connection) => {
      const result = await connection.query(`select ${REFERRAL_COLUMNS} from caring_contacts.referrals order by id`);
      return result.rows.map(toReferral);
    });
  }

  async getReferralIntakePayload(referralId: ReferralId, context: ReadContext): Promise<ReferralIntakePayload | null> {
    if (!mayReadOwnTeam(context, READ_ACTIONS.referral)) return null;
    return this.ctx.runRead(context, async (connection) => {
      const result = await connection.query(`select intake_payload from caring_contacts.referrals where id = $1`, [
        referralId,
      ]);
      const row = result.rows[0];
      if (!row || isAbsent(row.intake_payload)) return null;
      return parseReferralIntakePayload(row.intake_payload);
    });
  }

  async savePathwayVersion(
    input: SavePathwayVersionInput,
    context: WriteContext,
  ): Promise<TransitionResult<PathwayVersion>> {
    return this.ctx.runWrite<PathwayVersion>({
      method: "savePathwayVersion",
      input,
      context,
      auditAction: "savePathwayVersion",
      objectType: "pathwayVersion",
      objectId: input.version.id,
      stage: async (connection) => {
        const { actor } = context;
        if (!canPerformCaringContactAction(actor, "authorPathwayVersion", { teamId: actor.teamId }).allowed) {
          return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
        }

        const version: PathwayVersion = {
          id: input.version.id,
          teamId: actor.teamId,
          state: "draft",
          authorId: actor.id,
          approvals: Object.freeze([]),
          publishedAt: null,
          retiredAt: null,
          retirementUrgency: null,
          snapshot: input.version.snapshot,
        };

        const inserted = await withSavepoint(connection, INSERT_SAVEPOINT, () =>
          connection.query(
            `insert into caring_contacts.pathway_versions
               (id, team_id, state, author_id, approver_id, published_at, retired_at, retirement_urgency, snapshot)
             values ($1, $2, $3, $4, null, null, null, null, $5::jsonb)`,
            [version.id, version.teamId, version.state, version.authorId, JSON.stringify(version.snapshot)],
          ),
        );
        if (!inserted.ok) {
          if (inserted.constraint === "pathway_versions_pkey") {
            return { ok: false, reason: REPOSITORY_REFUSALS.pathwayVersionAlreadyExists };
          }
          throw inserted.error;
        }

        return { ok: true, value: version };
      },
    });
  }

  async transitionPathwayVersion(
    input: PathwayVersionTransitionInput,
    context: WriteContext,
  ): Promise<TransitionResult<PathwayVersion>> {
    const permission: CaringContactAction =
      input.action.type === "submitForReview"
        ? "authorPathwayVersion"
        : input.action.type === "approve"
          ? "approvePathwayVersion"
          : input.action.type === "publish"
            ? "publishPathwayVersion"
            : "retirePathwayVersion";
    return this.ctx.runWrite<PathwayVersion>({
      method: "transitionPathwayVersion",
      input,
      context,
      auditAction: "transitionPathwayVersion",
      objectType: "pathwayVersion",
      objectId: input.pathwayVersionId,
      stage: async (connection) => {
        const locked = await connection.query(
          "select id from caring_contacts.pathway_versions where id = $1 for update",
          [input.pathwayVersionId],
        );
        if (!locked.rows[0]) return { ok: false, reason: REPOSITORY_REFUSALS.notFound };

        const stored = await readPathwayVersion(connection, input.pathwayVersionId);
        if (!stored) return { ok: false, reason: REPOSITORY_REFUSALS.notFound };
        if (!canPerformCaringContactAction(context.actor, permission, { teamId: stored.teamId }).allowed) {
          return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
        }

        const transitioned = applyPathwayVersionTransition(stored, input.action, this.ctx.clock);
        if (!transitioned.ok) return transitioned;
        const governance = admitPathwayGovernanceActor(input.action, context.actor);
        if (!governance.ok) return governance;

        for (const approval of transitioned.value.approvals.slice(stored.approvals.length)) {
          await connection.query(
            `insert into caring_contacts.pathway_version_approvals
               (pathway_version_id, team_id, author_id, role, actor_id, approved_at)
             values ($1, $2, $3, $4, $5, $6)`,
            [stored.id, stored.teamId, stored.authorId, approval.role, approval.actorId, new Date(approval.approvedAt)],
          );
        }

        await connection.query(
          `update caring_contacts.pathway_versions
              set state = $2, published_at = $3, retired_at = $4, retirement_urgency = $5
            where id = $1`,
          [
            stored.id,
            transitioned.value.state,
            transitioned.value.publishedAt === null ? null : new Date(transitioned.value.publishedAt),
            transitioned.value.retiredAt === null ? null : new Date(transitioned.value.retiredAt),
            transitioned.value.retirementUrgency,
          ],
        );

        return { ok: true, value: transitioned.value };
      },
    });
  }

  async getPathwayVersion(id: PathwayVersionId, context: ReadContext): Promise<PathwayVersion | null> {
    if (!mayReadAnyOwnTeam(context, PATHWAY_VERSION_READ_ACTIONS)) return null;
    return this.ctx.runRead(context, (connection) => readPathwayVersion(connection, id));
  }

  async listPathwayVersions(context: ReadContext): Promise<PathwayVersion[]> {
    if (!mayReadAnyOwnTeam(context, PATHWAY_VERSION_READ_ACTIONS)) return [];
    return this.ctx.runRead(context, (connection) => readAllPathwayVersions(connection));
  }

  async markRetentionCleared(input: { planId: PlanId }, context: WriteContext): Promise<TransitionResult<void>> {
    return this.ctx.runWrite<void>({
      method: "markRetentionCleared",
      input,
      context,
      auditAction: "markRetentionCleared",
      objectId: input.planId,
      stage: async (connection) => {
        const planRow = await selectPlanForUpdate(connection, input.planId);
        if (!planRow) return { ok: false, reason: REPOSITORY_REFUSALS.notFound };

        const team = toTeamId(textOf(planRow.team_id));
        if (!canPerformCaringContactAction(context.actor, "generateClinicalRecordSummary", { teamId: team }).allowed) {
          return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
        }

        // Owner decision: refused by name until the retention period has passed since the plan ended.
        const admitted = admitRetentionClearance(
          {
            state: textOf(planRow.state) as PlanState,
            planDates: { completedAt: isAbsent(planRow.completed_at) ? null : instantOf(planRow.completed_at) },
          },
          this.ctx.clock,
        );
        if (!admitted.ok) return admitted;

        await connection.query(
          `insert into caring_contacts.retention_state
             (plan_id, team_id, terminal_at, cleared_at)
           values ($1, $2, $3, $4)
           on conflict (plan_id) do update
             set terminal_at = excluded.terminal_at, cleared_at = excluded.cleared_at`,
          [input.planId, team, admitted.value, this.ctx.clock.now()],
        );

        await connection.query(
          `update caring_contacts.plans
              set patient_name = $2, patient_mobile_number = $3, patient_identifiers = $4,
                  first_contact_reason = $5, preferred_name = $6, withdrawal_reason = $7
            where id = $1`,
          [
            input.planId,
            CLEARED_PATIENT_DETAIL.patientName,
            CLEARED_PATIENT_DETAIL.patientMobileNumber,
            [...CLEARED_PATIENT_DETAIL.patientIdentifiers],
            CLEARED_PATIENT_DETAIL.firstContactReason,
            CLEARED_PATIENT_DETAIL.preferredName,
            CLEARED_PATIENT_DETAIL.withdrawalReason,
          ],
        );
        await connection.query(
          "delete from caring_contacts.cultural_identity_reports where plan_id = $1 and team_id = $2",
          [input.planId, team],
        );

        await connection.query(
          `update caring_contacts.plan_reassignments
              set reason = $3
            where plan_id = $1 and team_id = $2`,
          [input.planId, team, CLEARED_PATIENT_FREE_TEXT.reassignmentReason],
        );

        await connection.query(
          `update caring_contacts.contact_dispatches d
              set discrepancy_note = $3
             from caring_contacts.contacts c
            where c.id = d.contact_id and c.plan_id = $1 and d.team_id = $2
              and d.discrepancy_note is not null`,
          [input.planId, team, CLEARED_PATIENT_FREE_TEXT.dispatchDiscrepancyNote],
        );

        await connection.query(
          `update caring_contacts.idempotency_records
              set result = $3::jsonb
            where plan_id = $1 and team_id = $2`,
          [
            input.planId,
            team,
            JSON.stringify(
              encodeStoredValue({ ok: false, reason: REPOSITORY_REFUSALS.idempotentResultClearedByRetention }),
            ),
          ],
        );

        // H-44 intake clinical sidecar on the linked referral (migration 0010_referral_intake_payload).
        // Null the jsonb in this transaction so a clearance record cannot coexist with a readable intake payload.
        await connection.query(
          `update caring_contacts.referrals
              set intake_payload = null
            where id = $1 and team_id = $2
              and intake_payload is not null`,
          [textOf(planRow.referral_id), team],
        );

        return { ok: true, value: undefined };
      },
    });
  }

  async getPlan(planId: PlanId, context: ReadContext): Promise<PlanRecord | null> {
    if (!mayReadOwnTeam(context, READ_ACTIONS.plan)) return null;
    return this.ctx.runRead(context, async (connection) => {
      const stored = await this.readPlanRecord(connection, planId);
      return stored ? this.toPlanRecord(stored.planRow, stored.contactRows, stored.assuranceRows) : null;
    });
  }

  async listPlans(context: ReadContext): Promise<PlanRecord[]> {
    if (!mayReadOwnTeam(context, READ_ACTIONS.plan)) return [];
    return this.ctx.runRead(context, async (connection) => {
      const plans = await connection.query(`select ${PLAN_LIST_COLUMNS} from caring_contacts.plans order by id`);
      // Team-scoped all-contacts for grouping — not selectContacts("") which filters plan_id = $1.
      const contacts = await this.ctx.selectAllContacts(connection, context.actor.teamId);
      const assurances = await connection.query(
        `select ${PLAN_ASSURANCE_COLUMNS} from caring_contacts.plan_assurances
           order by plan_id, attested_at, assurance`,
      );
      const groupByPlan = (rows: readonly SqlRow[]) => {
        const grouped = new Map<string, SqlRow[]>();
        for (const row of rows) {
          const key = textOf(row.plan_id);
          const bucket = grouped.get(key);
          if (bucket) bucket.push(row);
          else grouped.set(key, [row]);
        }
        return grouped;
      };
      const contactsByPlan = groupByPlan(contacts);
      const assurancesByPlan = groupByPlan(assurances.rows);
      return plans.rows.map((row) =>
        this.toPlanRecord(row, contactsByPlan.get(textOf(row.id)) ?? [], assurancesByPlan.get(textOf(row.id)) ?? []),
      );
    });
  }

  async listPatientNames(context: ReadContext): Promise<PatientNameProjection[]> {
    if (!mayReadAllOwnTeam(context, PATIENT_NAME_READ_ACTIONS)) return [];
    return this.ctx.runRead(context, async (connection) => {
      const result = await connection.query("select id, patient_name from caring_contacts.plans order by id");
      return result.rows.map((row) => ({
        planId: textOf(row.id) as PlanId,
        patientName: textOf(row.patient_name),
      }));
    });
  }

  /**
   * The shared-number count, scoped as `listPatientNames` is. The team's open plans' numbers are
   * compared here, after normalising, so the comparison needs no SQL of its own for the several
   * forms a number is stored in; none of them leaves this function.
   */
  async countPlansSharingMobile(input: SharedMobileQuery, context: ReadContext): Promise<number> {
    if (!mayReadAllOwnTeam(context, PATIENT_NAME_READ_ACTIONS)) return 0;
    const wanted = toAustralianMobileE164(input.mobile);
    if (wanted === null) return 0;
    return this.ctx.runRead(context, async (connection) => {
      const result = await connection.query(
        `select id, patient_mobile_number from caring_contacts.plans
          where team_id = $1 and state <> all($2::text[])`,
        [context.actor.teamId, [...TERMINAL_PLAN_STATES]],
      );
      return result.rows.filter(
        (row) =>
          textOf(row.id) !== input.excludePlanId &&
          toAustralianMobileE164(textOf(row.patient_mobile_number)) === wanted,
      ).length;
    });
  }

  async getEpisode(planId: PlanId, context: ReadContext): Promise<Episode | null> {
    if (!mayReadOwnTeam(context, READ_ACTIONS.episode)) return null;
    return this.ctx.runRead(context, async (connection) => {
      const stored = await this.readPlanRecord(connection, planId, context.actor.teamId);
      if (!stored) return null;
      const { planRow, contactRows } = stored;

      const detailRow = await connection.query(
        `select p.patient_name, p.patient_mobile_number, p.patient_identifiers,
                p.first_contact_reason, p.preferred_name, p.withdrawal_reason,
                r.cleared_at, c.cultural_identity
           from caring_contacts.plans p
           left join caring_contacts.retention_state r on r.plan_id = p.id
           left join caring_contacts.cultural_identity_reports c on c.plan_id = p.id
          where p.id = $1`,
        [planId],
      );
      const detailValues = detailRow.rows[0];
      const culturalValue = detailValues?.cultural_identity;
      const culturalIdentity = isAbsent(culturalValue) ? null : textOf(culturalValue);
      const reasonValue = detailValues?.first_contact_reason;
      const firstContactReason = isAbsent(reasonValue) ? null : textOf(reasonValue);
      const withdrawalReasonValue = detailValues?.withdrawal_reason;
      const withdrawalReason = isAbsent(withdrawalReasonValue) ? null : textOf(withdrawalReasonValue);
      const preferredNameValue = detailValues?.preferred_name;
      const preferredName = isAbsent(preferredNameValue) ? null : textOf(preferredNameValue);
      const clearedAtValue = detailValues?.cleared_at;
      const patientDetailClearedAt = isAbsent(clearedAtValue) ? null : instantOf(clearedAtValue);

      const detail: StoredPatientDetail = {
        patientName: textOf(detailValues?.patient_name),
        patientMobileNumber: textOf(detailValues?.patient_mobile_number),
        patientIdentifiers: [...((detailValues?.patient_identifiers as string[] | null) ?? [])],
        culturalIdentity,
        preferredName,
        firstContactReason,
        withdrawalReason,
      };
      const states = contactRows.map((row) => textOf(row.state) as ContactState);

      return {
        state: textOf(planRow.state) as PlanState,
        patientName: detail.patientName,
        patientMobileNumber: detail.patientMobileNumber,
        patientIdentifiers: detail.patientIdentifiers,
        culturalIdentity: detail.culturalIdentity,
        preferredName: detail.preferredName,
        firstContactReason: detail.firstContactReason,
        withdrawalReason: detail.withdrawalReason,
        patientDetailClearedAt,
        planDates: {
          dischargeAt: instantOf(planRow.discharge_at),
          completedAt:
            planRow.completed_at === null || planRow.completed_at === undefined
              ? null
              : instantOf(planRow.completed_at),
        },
        pathwayVersionId: textOf(planRow.pathway_version_id) as PathwayVersionId,
        teamId: toTeamId(textOf(planRow.team_id)),
        outcome: textOf(planRow.outcome),
        counts: {
          contactsScheduled: contactRows.filter(
            (row) => row.suppressed_reason === null || row.suppressed_reason === undefined,
          ).length,
          contactsSent: states.filter((state) => DISPATCHED_CONTACT_STATES.includes(state)).length,
          contactsDelivered: states.filter((state) => state === "delivered").length,
        },
      };
    });
  }
}

function parseReferralIntakePayload(raw: unknown): ReferralIntakePayload | null {
  const value = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const safetyAlerts = record.safetyAlerts;
  if (!Array.isArray(safetyAlerts) || !safetyAlerts.every((entry) => typeof entry === "string")) {
    return null;
  }
  const required = [
    "patientIdentifier",
    "givenName",
    "familyName",
    "mobileNumber",
    "dischargeDate",
    "hospitalFacility",
    "cohort",
    "admittingWard",
    "clinicalSummary",
  ] as const;
  for (const key of required) {
    if (typeof record[key] !== "string") return null;
  }
  return {
    patientIdentifier: record.patientIdentifier as string,
    givenName: record.givenName as string,
    familyName: record.familyName as string,
    mobileNumber: record.mobileNumber as string,
    dischargeDate: record.dischargeDate as string,
    hospitalFacility: record.hospitalFacility as string,
    cohort: record.cohort as string,
    admittingWard: record.admittingWard as string,
    clinicalSummary: record.clinicalSummary as string,
    safetyAlerts: safetyAlerts.map(String),
  };
}

export function createPlansStore(
  ctx: RepositoryContext,
  toStoredContactFn: (row: SqlRow) => StoredContact,
): PlansStore {
  return new PlansStore(ctx, toStoredContactFn);
}
