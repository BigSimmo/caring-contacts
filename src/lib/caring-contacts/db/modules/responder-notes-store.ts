// src/lib/caring-contacts/db/modules/responder-notes-store.ts
//
// Domain module: Service stops, responder case notes, restart approvals.

import { awstIsoTimestamp } from "../../clock";
import { actorId as toActorId, teamId as toTeamId } from "../../ids";
import { canPerformCaringContactAction } from "../../permissions";
import { REPOSITORY_REFUSALS, SERVICE_STATE_UNSET_TEAM, type ReadContext, type WriteContext } from "../../repository";
import {
  applyServiceRestartApproval,
  applyServiceStop,
  NO_RESTART_APPROVAL_SEATS,
  restartOutcomeOf,
  runningService,
  type ServiceRestartApproval,
  type ServiceRestartApprovalRole,
  type ServiceRestartOutcome,
  type ServiceState,
  type ServiceStopReason,
} from "../../service-state";
import {
  INSERT_SAVEPOINT,
  instantOf,
  isAbsent,
  pinnedClock,
  textOf,
  withSavepoint,
  type RepositoryContext,
  type SqlConnection,
  type SqlRow,
} from "../shared";
import type { TransitionResult } from "../../model";

export const RESTART_APPROVAL_REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  service_restart_approvals_unique_stop_role: "restart-approval-role-already-recorded",
  service_restart_approvals_unique_stop_actor: "restart-approval-actor-already-recorded",
});

export async function readRestartApprovals(
  connection: SqlConnection,
  stopId: string,
): Promise<readonly ServiceRestartApproval[]> {
  const result = await connection.query(
    `select role, actor_id, approved_at from caring_contacts.service_restart_approvals
     where stop_id = $1::uuid order by id`,
    [stopId],
  );
  return Object.freeze(
    result.rows.map((row) =>
      Object.freeze({
        role: textOf(row.role) as ServiceRestartApprovalRole,
        actorId: toActorId(textOf(row.actor_id)),
        approvedAt: awstIsoTimestamp(instantOf(row.approved_at)),
      }),
    ),
  );
}

export async function serviceStateFrom(connection: SqlConnection, row: SqlRow | null): Promise<ServiceState> {
  if (!row) return runningService(SERVICE_STATE_UNSET_TEAM);

  const reportedByTeamId = isAbsent(row.reported_by_team_id)
    ? SERVICE_STATE_UNSET_TEAM
    : toTeamId(textOf(row.reported_by_team_id));
  if (row.stopped !== true) return runningService(reportedByTeamId);

  return Object.freeze({
    stopped: true as const,
    reportedByTeamId,
    reason: textOf(row.reason) as ServiceStopReason,
    stoppedBy: toActorId(textOf(row.stopped_by)),
    stoppedAt: awstIsoTimestamp(instantOf(row.stopped_at)),
    note: isAbsent(row.note) ? "" : textOf(row.note),
    restartApprovals: await readRestartApprovals(connection, textOf(row.stop_id)),
  });
}

export async function selectServiceState(connection: SqlConnection, forUpdate: boolean): Promise<SqlRow | null> {
  const result = await connection.query(
    `select s.stopped, s.reported_by_team_id, s.stop_id, s.stopped_by, s.stopped_at, i.reason, i.note
       from caring_contacts.service_state s
       left join caring_contacts.service_stops i on i.stop_id = s.stop_id
      where s.singleton${forUpdate ? " for update of s" : ""}`,
  );
  return result.rows[0] ?? null;
}

export async function readServiceState(connection: SqlConnection, forUpdate = false): Promise<ServiceState> {
  return serviceStateFrom(connection, await selectServiceState(connection, forUpdate));
}

export class ResponderNotesStore {
  constructor(private readonly ctx: RepositoryContext) {}

  readServiceState(connection: SqlConnection, forUpdate = false): Promise<ServiceState> {
    return readServiceState(connection, forUpdate);
  }

  async getServiceState(context: ReadContext): Promise<ServiceState> {
    return this.ctx.runRead(context, (connection) => readServiceState(connection));
  }

  async stopService(
    input: { reason: ServiceStopReason; note: string },
    context: WriteContext,
  ): Promise<TransitionResult<ServiceState>> {
    return this.ctx.runWrite<ServiceState>({
      method: "stopService",
      input,
      context,
      auditAction: "stopService",
      objectType: "serviceState",
      objectId: "service",
      bypassServiceStopGate: true,
      stage: async (connection) => {
        const { actor } = context;
        if (!canPerformCaringContactAction(actor, "triggerServiceSafetyStop", { teamId: actor.teamId }).allowed) {
          return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
        }

        const at = this.ctx.clock.now();
        const stamped = pinnedClock(at);

        const seeded: ServiceState = {
          ...(await readServiceState(connection, true)),
          reportedByTeamId: actor.teamId,
        };
        const applied = applyServiceStop(
          seeded,
          { reason: input.reason, actorId: actor.id, note: input.note },
          stamped,
        );
        if (!applied.ok) return applied;
        const stopped = applied.value;
        if (!stopped.stopped) throw new Error("caring-contacts: an accepted stop must be a stopped state");

        const incident = await connection.query(
          `insert into caring_contacts.service_stops
             (stop_id, reason, note, stopped_by, stopped_at, reported_by_team_id)
           values (gen_random_uuid(), $1, $2, $3, $4, $5)
           returning stop_id`,
          [stopped.reason, stopped.note, stopped.stoppedBy, at, actor.teamId],
        );
        const stopId = textOf(incident.rows[0].stop_id);

        const singleton = await connection.query(
          `insert into caring_contacts.service_state
             (singleton, stopped, stopped_by, stopped_at, reported_by_team_id, stop_id, updated_at)
           values (true, true, $1, $2, $3, $4::uuid, $2)
           on conflict (singleton) do update
             set stopped = true, stopped_by = excluded.stopped_by, stopped_at = excluded.stopped_at,
                 reported_by_team_id = excluded.reported_by_team_id, stop_id = excluded.stop_id,
                 updated_at = excluded.updated_at
             where service_state.stopped = false`,
          [stopped.stoppedBy, at, actor.teamId, stopId],
        );

        if (singleton.rowCount !== 1) {
          const secondStop = applyServiceStop(
            stopped,
            { reason: input.reason, actorId: actor.id, note: input.note },
            stamped,
          );
          if (secondStop.ok) {
            throw new Error("caring-contacts: the service-stop rule no longer refuses a second stop");
          }
          return secondStop;
        }

        return { ok: true, value: stopped };
      },
    });
  }

  async approveServiceRestart(
    input: { role: ServiceRestartApprovalRole },
    context: WriteContext,
  ): Promise<TransitionResult<ServiceRestartOutcome>> {
    return this.ctx.runWrite<ServiceRestartOutcome>({
      method: "approveServiceRestart",
      input,
      context,
      auditAction: "approveServiceRestart",
      objectType: "serviceState",
      objectId: "service",
      bypassServiceStopGate: true,
      stage: async (connection) => {
        const { actor } = context;
        if (!canPerformCaringContactAction(actor, "approveServiceRestart", { teamId: actor.teamId }).allowed) {
          return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
        }

        const at = this.ctx.clock.now();
        const stamped = pinnedClock(at);

        const row = await selectServiceState(connection, true);
        const current = await serviceStateFrom(connection, row);
        // Owner decision: the seat must be held by a person governance configuration names for it.
        const applied = applyServiceRestartApproval(
          current,
          { role: input.role, actorId: actor.id },
          stamped,
          this.ctx.options.restartApprovalSeats ?? NO_RESTART_APPROVAL_SEATS,
        );
        if (!applied.ok) return applied;
        if (!row) throw new Error("caring-contacts: an accepted restart approval must name an incident");

        const stopId = textOf(row.stop_id);
        const recorded = await withSavepoint(connection, INSERT_SAVEPOINT, () =>
          connection.query(
            `insert into caring_contacts.service_restart_approvals
               (stop_id, role, actor_id, approved_at, approved_by_team_id)
             values ($1::uuid, $2, $3, $4, $5)`,
            [stopId, input.role, actor.id, at, actor.teamId],
          ),
        );
        if (!recorded.ok) {
          const constraint = recorded.constraint ?? "";
          const refusal = Object.hasOwn(RESTART_APPROVAL_REFUSALS, constraint)
            ? RESTART_APPROVAL_REFUSALS[constraint]
            : undefined;
          if (refusal !== undefined) return { ok: false, reason: refusal };
          throw recorded.error;
        }

        if (!applied.value.stopped) {
          await connection.query(
            "update caring_contacts.service_stops set restarted_at = $2 where stop_id = $1::uuid",
            [stopId, at],
          );
          await connection.query(
            "update caring_contacts.service_state set stopped = false, stop_id = null, updated_at = $1 where singleton",
            [at],
          );
        }

        return { ok: true, value: restartOutcomeOf(applied.value) };
      },
    });
  }
}

export function createResponderNotesStore(ctx: RepositoryContext): ResponderNotesStore {
  return new ResponderNotesStore(ctx);
}
