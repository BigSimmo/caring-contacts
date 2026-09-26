// src/lib/caring-contacts/db/modules/audit-store.ts
//
// Domain module: Audit logs, state transitions, idempotency records.

import { buildAccessAuditEvent, type AccessRecord } from "../../access-audit";
import type { AuditEvent, AuditOutcome } from "../../audit";
import { actorId as toActorId, idempotencyKey as toIdempotencyKey, teamId as toTeamId } from "../../ids";
import { READ_ACTIONS, type AccessTrailQuery, type ReadContext } from "../../repository";
import {
  mayReadOwnTeam,
  textOf,
  type RepositoryContext,
  type SqlConnection,
  type SqlRow,
  type SqlValue,
} from "../shared";

export const AUDIT_EVENT_COLUMNS = `team_id, actor_id, actor_roles, action, object_type, object_id, outcome,
  idempotency_key, occurred_at`;

export function toAuditEvent(row: SqlRow): AuditEvent {
  const roles = Object.freeze([...((row.actor_roles as string[] | null) ?? [])]);
  return {
    actorId: toActorId(textOf(row.actor_id)),
    actorRoles: roles,
    actorRole: (row.actor_role as string | null) ?? roles[0] ?? "unknown",
    teamId: toTeamId(textOf(row.team_id)),
    action: textOf(row.action),
    objectType: textOf(row.object_type),
    objectId: textOf(row.object_id),
    outcome: textOf(row.outcome) as AuditOutcome,
    idempotencyKey: toIdempotencyKey(textOf(row.idempotency_key)),
    timestamp: textOf(row.occurred_at),
  };
}

export async function insertAuditEvent(
  connection: SqlConnection,
  event: AuditEvent,
  token: string | null,
): Promise<void> {
  await connection.query(
    `insert into caring_contacts.audit_events
       (team_id, actor_id, actor_roles, action, object_type, object_id, outcome, idempotency_key,
        occurred_at, txn_token)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::uuid)`,
    [
      event.teamId,
      event.actorId,
      [...event.actorRoles],
      event.action,
      event.objectType,
      event.objectId,
      event.outcome,
      event.idempotencyKey,
      event.timestamp,
      token,
    ],
  );
}

export class AuditStore {
  constructor(private readonly ctx: RepositoryContext) {}

  insertAuditEvent(connection: SqlConnection, event: AuditEvent, token: string | null): Promise<void> {
    return insertAuditEvent(connection, event, token);
  }

  async recordAccess(record: AccessRecord): Promise<void> {
    const event = buildAccessAuditEvent(record, this.ctx.clock);
    await this.ctx.options.auditSink?.record(event);
    await this.ctx.inTransaction(record.teamId, null, async (connection) => {
      await this.ctx.ensureTeam(connection, record.teamId);
      await insertAuditEvent(connection, event, null);
    });
  }

  async listAccessTrail(input: AccessTrailQuery, context: ReadContext): Promise<AuditEvent[]> {
    if (!mayReadOwnTeam(context, READ_ACTIONS.auditTrail)) return [];
    return this.ctx.runRead(context, async (connection) => {
      const conditions: string[] = [];
      const values: SqlValue[] = [];
      const placeholder = (value: SqlValue): string => {
        values.push(value);
        return `$${values.length}`;
      };

      if (input.fromIso !== undefined) {
        conditions.push(`occurred_at::timestamptz >= ${placeholder(new Date(input.fromIso))}`);
      }
      if (input.toIso !== undefined) {
        conditions.push(`occurred_at::timestamptz <= ${placeholder(new Date(input.toIso))}`);
      }
      if (input.actorId !== undefined) conditions.push(`actor_id = ${placeholder(input.actorId)}`);
      if (input.objectType !== undefined) conditions.push(`object_type = ${placeholder(input.objectType)}`);

      const where = conditions.length === 0 ? "" : ` where ${conditions.join(" and ")}`;
      const result = await connection.query(
        `select ${AUDIT_EVENT_COLUMNS} from caring_contacts.audit_events${where}
          order by id offset ${placeholder(input.offset)} limit ${placeholder(input.limit)}`,
        values,
      );
      return result.rows.map(toAuditEvent);
    });
  }

  async listAuditEvents(context: ReadContext): Promise<AuditEvent[]> {
    if (!mayReadOwnTeam(context, READ_ACTIONS.auditTrail)) return [];
    return this.ctx.runRead(context, async (connection) => {
      const result = await connection.query(
        `select ${AUDIT_EVENT_COLUMNS} from caring_contacts.audit_events order by id`,
      );
      return result.rows.map(toAuditEvent);
    });
  }
}

export function createAuditStore(ctx: RepositoryContext): AuditStore {
  return new AuditStore(ctx);
}
