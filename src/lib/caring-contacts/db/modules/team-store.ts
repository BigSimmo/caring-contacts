// src/lib/caring-contacts/db/modules/team-store.ts
//
// Domain module: Team assignments, workloads, members, cover, preferences, training.

import { applyAssignmentAction, unassigned, type AssignmentAction, type PlanAssignment } from "../../assignment";
import { awstIsoTimestamp } from "../../clock";
import { actorId as toActorId, teamId as toTeamId, type PlanId, type TeamId } from "../../ids";
import type { TransitionResult } from "../../model";
import {
  defaultNotificationPreferences,
  type AlertClass,
  type NotificationPreferences,
} from "../../notification-preferences";
import { canPerformCaringContactAction, type CaringContactAction } from "../../permissions";
import { READ_ACTIONS, REPOSITORY_REFUSALS, type ReadContext, type WriteContext } from "../../repository";
import { emptyTrainingRecord, recordCompetency, type TrainingCompetency, type TrainingRecord } from "../../training";
import { instantOf, isAbsent, mayReadOwnTeam, textOf, type RepositoryContext, type SqlConnection } from "../shared";

export async function readAssignment(
  connection: SqlConnection,
  planId: PlanId,
  teamId?: TeamId,
): Promise<PlanAssignment> {
  const current = teamId
    ? await connection.query(
        `select owner_id, claimed_at, covered_by, coverage_from, coverage_until
         from caring_contacts.plan_assignments where plan_id = $1 and team_id = $2`,
        [planId, teamId],
      )
    : await connection.query(
        `select owner_id, claimed_at, covered_by, coverage_from, coverage_until
         from caring_contacts.plan_assignments where plan_id = $1`,
        [planId],
      );
  const history = teamId
    ? await connection.query(
        `select from_actor_id, to_actor_id, reason, at
         from caring_contacts.plan_reassignments where plan_id = $1 and team_id = $2 order by id`,
        [planId, teamId],
      )
    : await connection.query(
        `select from_actor_id, to_actor_id, reason, at
         from caring_contacts.plan_reassignments where plan_id = $1 order by id`,
        [planId],
      );
  const reassignmentHistory = history.rows.map((row) => ({
    fromActorId: toActorId(textOf(row.from_actor_id)),
    toActorId: toActorId(textOf(row.to_actor_id)),
    reason: textOf(row.reason),
    at: awstIsoTimestamp(instantOf(row.at)),
  }));

  const row = current.rows[0];
  if (!row) return { ...unassigned(), reassignmentHistory };
  return {
    ownerId: isAbsent(row.owner_id) ? null : toActorId(textOf(row.owner_id)),
    claimedAt: isAbsent(row.claimed_at) ? null : awstIsoTimestamp(instantOf(row.claimed_at)),
    coveredBy: isAbsent(row.covered_by)
      ? null
      : {
          actorId: toActorId(textOf(row.covered_by)),
          from: textOf(row.coverage_from),
          until: textOf(row.coverage_until),
        },
    reassignmentHistory,
  };
}

export async function writeAssignment(
  connection: SqlConnection,
  planId: PlanId,
  team: TeamId,
  assignment: PlanAssignment,
  alreadyRecordedHandovers: number,
): Promise<void> {
  await connection.query(
    `insert into caring_contacts.plan_assignments
       (plan_id, team_id, owner_id, claimed_at, covered_by, coverage_from, coverage_until)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (plan_id) do update
       set owner_id = excluded.owner_id, claimed_at = excluded.claimed_at,
           covered_by = excluded.covered_by, coverage_from = excluded.coverage_from,
           coverage_until = excluded.coverage_until`,
    [
      planId,
      team,
      assignment.ownerId,
      assignment.claimedAt === null ? null : new Date(assignment.claimedAt),
      assignment.coveredBy?.actorId ?? null,
      assignment.coveredBy?.from ?? null,
      assignment.coveredBy?.until ?? null,
    ],
  );

  for (const entry of assignment.reassignmentHistory.slice(alreadyRecordedHandovers)) {
    await connection.query(
      `insert into caring_contacts.plan_reassignments (plan_id, team_id, from_actor_id, to_actor_id, reason, at)
       values ($1, $2, $3, $4, $5, $6)`,
      [planId, team, entry.fromActorId, entry.toActorId, entry.reason, new Date(entry.at)],
    );
  }
}

export class TeamStore {
  constructor(private readonly ctx: RepositoryContext) {}

  readAssignment(connection: SqlConnection, planId: PlanId, teamId?: TeamId): Promise<PlanAssignment> {
    return readAssignment(connection, planId, teamId);
  }

  writeAssignment(
    connection: SqlConnection,
    planId: PlanId,
    team: TeamId,
    assignment: PlanAssignment,
    alreadyRecordedHandovers: number,
  ): Promise<void> {
    return writeAssignment(connection, planId, team, assignment, alreadyRecordedHandovers);
  }

  async getAssignment(planId: PlanId, context: ReadContext): Promise<PlanAssignment | null> {
    if (!mayReadOwnTeam(context, READ_ACTIONS.plan)) return null;
    return this.ctx.runRead(context, async (connection) => {
      const stored = await this.ctx.readPlanRecord(connection, planId, context.actor.teamId);
      if (!stored) return null;
      return readAssignment(connection, planId, context.actor.teamId);
    });
  }

  async applyAssignment(
    input: { planId: PlanId; action: AssignmentAction },
    context: WriteContext,
  ): Promise<TransitionResult<PlanAssignment>> {
    const permission: CaringContactAction =
      input.action.type === "claim"
        ? "claimPlan"
        : input.action.type === "reassign"
          ? "reassignPlan"
          : "coverCoordinator";
    return this.ctx.runWrite<PlanAssignment>({
      method: "applyAssignment",
      input,
      context,
      auditAction: "applyAssignment",
      objectId: input.planId,
      stage: async (connection) => {
        const planRow = await this.ctx.selectPlanForUpdate(connection, input.planId);
        if (!planRow) return { ok: false, reason: REPOSITORY_REFUSALS.notFound };

        const team = toTeamId(textOf(planRow.team_id));
        if (!canPerformCaringContactAction(context.actor, permission, { teamId: team }).allowed) {
          return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
        }
        if (input.action.type === "claim" && input.action.actorId !== context.actor.id) {
          return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
        }

        const current = await readAssignment(connection, input.planId, team);
        const transitioned = applyAssignmentAction(current, input.action, this.ctx.clock);
        if (!transitioned.ok) return transitioned;

        await writeAssignment(connection, input.planId, team, transitioned.value, current.reassignmentHistory.length);
        return { ok: true, value: transitioned.value };
      },
    });
  }

  async getNotificationPreferences(context: ReadContext): Promise<NotificationPreferences> {
    return this.ctx.runRead(context, async (connection) => {
      const result = await connection.query(
        "select actor_id, opted_in from caring_contacts.notification_preferences where actor_id = $1",
        [context.actor.id],
      );
      const row = result.rows[0];
      if (!row) return defaultNotificationPreferences(context.actor.id);
      return Object.freeze({
        actorId: toActorId(textOf(row.actor_id)),
        optedIn: Object.freeze([...((row.opted_in as string[] | null) ?? [])] as AlertClass[]),
      });
    });
  }

  async saveNotificationPreferences(
    input: NotificationPreferences,
    context: WriteContext,
  ): Promise<TransitionResult<NotificationPreferences>> {
    return this.ctx.runWrite<NotificationPreferences>({
      method: "saveNotificationPreferences",
      input,
      context,
      auditAction: "saveNotificationPreferences",
      objectType: "notificationPreferences",
      objectId: context.actor.id,
      stage: async (connection) => {
        const { actor } = context;
        if (input.actorId !== actor.id) return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
        if (!canPerformCaringContactAction(actor, "manageNotificationPreferences", { teamId: actor.teamId }).allowed) {
          return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
        }

        const saved: NotificationPreferences = Object.freeze({
          actorId: input.actorId,
          optedIn: Object.freeze([...input.optedIn]),
        });
        await connection.query(
          `insert into caring_contacts.notification_preferences (actor_id, team_id, opted_in)
           values ($1, $2, $3)
           on conflict (actor_id) do update set team_id = excluded.team_id, opted_in = excluded.opted_in`,
          [saved.actorId, actor.teamId, [...saved.optedIn]],
        );
        return { ok: true, value: saved };
      },
    });
  }

  async getTrainingRecord(context: ReadContext): Promise<TrainingRecord> {
    return this.ctx.runRead(context, async (connection) => {
      const result = await connection.query(
        "select actor_id, completed from caring_contacts.training_records where actor_id = $1",
        [context.actor.id],
      );
      const row = result.rows[0];
      if (!row) return emptyTrainingRecord(context.actor.id);
      return Object.freeze({
        actorId: toActorId(textOf(row.actor_id)),
        completed: Object.freeze([...((row.completed as string[] | null) ?? [])] as TrainingCompetency[]),
      });
    });
  }

  async recordTrainingCompetency(
    input: { competency: TrainingCompetency },
    context: WriteContext,
  ): Promise<TransitionResult<TrainingRecord>> {
    return this.ctx.runWrite<TrainingRecord>({
      method: "recordTrainingCompetency",
      input,
      context,
      auditAction: "recordTrainingCompetency",
      objectType: "trainingRecord",
      objectId: context.actor.id,
      stage: async (connection) => {
        const { actor } = context;
        if (!canPerformCaringContactAction(actor, "enterTrainingMode", { teamId: actor.teamId }).allowed) {
          return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
        }

        const existing = await connection.query(
          "select completed from caring_contacts.training_records where actor_id = $1 for update",
          [actor.id],
        );
        const row = existing.rows[0];
        const current: TrainingRecord = row
          ? {
              actorId: actor.id,
              completed: [...((row.completed as string[] | null) ?? [])] as TrainingCompetency[],
            }
          : emptyTrainingRecord(actor.id);

        const updated = recordCompetency(current, input.competency);
        await connection.query(
          `insert into caring_contacts.training_records (actor_id, team_id, completed)
           values ($1, $2, $3)
           on conflict (actor_id) do update set team_id = excluded.team_id, completed = excluded.completed`,
          [actor.id, actor.teamId, [...updated.completed]],
        );
        return { ok: true, value: updated };
      },
    });
  }
}

export function createTeamStore(ctx: RepositoryContext): TeamStore {
  return new TeamStore(ctx);
}
