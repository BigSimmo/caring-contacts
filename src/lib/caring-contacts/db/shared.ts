// src/lib/caring-contacts/db/shared.ts
//
// Shared types, connection abstraction, row mappers, and transaction engine
// for the modular Postgres caring-contacts repository.

import { buildAuditEvent, type AuditEvent, type AuditOutcome } from "../audit";
import type { Clock } from "../clock";
import { fingerprintOf } from "../fingerprint";
import type { PlanId, TeamId } from "../ids";
import type { Contact, Plan, TransitionResult } from "../model";
import {
  actorRoleNames,
  canPerformCaringContactAction,
  type CaringContactAction,
  type CaringContactActor,
} from "../permissions";
import {
  REPOSITORY_REFUSALS,
  replayRecordPlanId,
  type ReadContext,
  type RepositoryOptions,
  type WriteContext,
} from "../repository";
import { serviceStopBlocksDispatch, type ServiceState } from "../service-state";

// ---------------------------------------------------------------------------
// The connection abstraction
// ---------------------------------------------------------------------------

export type SqlValue = string | number | boolean | Date | null | readonly string[];
export type SqlRow = Record<string, unknown>;
export type SqlResult = { rows: SqlRow[]; rowCount: number };

/** One connection, held for the length of a transaction. */
export type SqlConnection = { query(text: string, values?: readonly SqlValue[]): Promise<SqlResult> };

/**
 * A source of connections. `withConnection` must hold ONE connection for the whole callback --
 * every transaction here spans several statements, and a pool that handed out a different
 * connection per statement would break both the transaction and the transaction-local team scope.
 */
export type SqlConnectionPool = { withConnection<T>(work: (connection: SqlConnection) => Promise<T>): Promise<T> };

/** A fixed identifier, never interpolated from input -- a savepoint name cannot be parameterised. */
export const INSERT_SAVEPOINT = "caring_contacts_insert";

// ---------------------------------------------------------------------------
// Result storage
//
// A replay must return the ORIGINAL result, not a freshly derived one: by the time a `createPlan`
// is replayed the plan may have been activated, and re-deriving would answer a different question.
// JSON cannot carry a Date, so instants are marked and revived.
// ---------------------------------------------------------------------------

export const DATE_MARKER = "__caringContactInstant";

export function encodeStoredValue(value: unknown): unknown {
  if (value instanceof Date) return { [DATE_MARKER]: value.getTime() };
  if (Array.isArray(value)) return value.map(encodeStoredValue);
  if (value !== null && typeof value === "object") {
    const encoded: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) continue;
      encoded[key] = encodeStoredValue(entry);
    }
    return encoded;
  }
  return value;
}

export function decodeStoredValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeStoredValue);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record[DATE_MARKER] === "number") return new Date(record[DATE_MARKER] as number);
    const decoded: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(record)) decoded[key] = decodeStoredValue(entry);
    return decoded;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Row mapping helpers
// ---------------------------------------------------------------------------

/** A column the database left empty. Both spellings, because a driver may hand back either. */
export function isAbsent(value: unknown): boolean {
  return value === null || value === undefined;
}

export function textOf(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}

export function numberOf(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

export function instantOf(value: unknown): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
}

/**
 * The name of the constraint a refusal came from, read as a field rather than parsed out of the
 * message. Migration 0003 named every constraint deliberately so a store never has to read prose.
 */
export function constraintNameOf(error: unknown): string | null {
  if (error === null || typeof error !== "object") return null;
  const constraint = (error as { constraint?: unknown }).constraint;
  return typeof constraint === "string" ? constraint : null;
}

export type SavepointOutcome<T> = { ok: true; value: T } | { ok: false; constraint: string | null; error: unknown };

/**
 * Runs one statement a constraint may legitimately refuse, inside a savepoint.
 */
export async function withSavepoint<T>(
  connection: SqlConnection,
  name: string,
  work: () => Promise<T>,
): Promise<SavepointOutcome<T>> {
  await connection.query(`savepoint ${name}`);
  try {
    const value = await work();
    await connection.query(`release savepoint ${name}`);
    return { ok: true, value };
  } catch (error) {
    await connection.query(`rollback to savepoint ${name}`);
    return { ok: false, constraint: constraintNameOf(error), error };
  }
}

/**
 * A clock pinned to one instant.
 */
export function pinnedClock(at: Date): Clock {
  return Object.freeze({ now: () => new Date(at.getTime()) });
}

/** Transaction audit tokens. Deterministic per store instance, unique within it. */
export function auditTokenFactory(): () => string {
  let issued = 0;
  const prefix = Math.floor(Math.random() * 0xffff_ffff)
    .toString(16)
    .padStart(8, "0");
  return () => {
    issued += 1;
    return `${prefix}-0000-4000-8000-${String(issued).padStart(12, "0")}`;
  };
}

export function mayRead(actor: CaringContactActor, action: CaringContactAction, resourceTeamId: TeamId): boolean {
  return canPerformCaringContactAction(actor, action, { teamId: resourceTeamId }).allowed;
}

/** The team is the actor's own: a read of another team's row returns nothing, never a refusal. */
export function mayReadOwnTeam(context: ReadContext, action: CaringContactAction): boolean {
  return mayRead(context.actor, action, context.actor.teamId);
}

/** True only if the actor holds EVERY one of the given read capabilities for their own team. */
export function mayReadAllOwnTeam(context: ReadContext, actions: readonly CaringContactAction[]): boolean {
  return actions.every((action) => mayReadOwnTeam(context, action));
}

/** True if the actor holds ANY of the given read capabilities for their own team. */
export function mayReadAnyOwnTeam(context: ReadContext, actions: readonly CaringContactAction[]): boolean {
  return actions.some((action) => mayReadOwnTeam(context, action));
}

export type WriteSpec<T> = {
  method: string;
  input: unknown;
  context: WriteContext;
  auditAction: string;
  objectId: string;
  objectType?: string;
  bypassServiceStopGate?: boolean;
  stage: (connection: SqlConnection) => Promise<TransitionResult<T>>;
};

export type RepositoryContext = {
  readonly pool: SqlConnectionPool;
  readonly clock: Clock;
  readonly options: RepositoryOptions;
  readonly nextAuditToken: () => string;
  inTransaction<T>(
    team: TeamId,
    auditToken: string | null,
    work: (connection: SqlConnection) => Promise<T>,
  ): Promise<T>;
  runRead<T>(context: ReadContext, work: (connection: SqlConnection) => Promise<T>): Promise<T>;
  runWrite<T>(spec: WriteSpec<T>): Promise<TransitionResult<T>>;
  ensureTeam(connection: SqlConnection, team: TeamId): Promise<void>;
  // Pluggable domain delegates
  readServiceState: (connection: SqlConnection, forUpdate?: boolean) => Promise<ServiceState>;
  insertAuditEvent: (connection: SqlConnection, event: AuditEvent, token: string | null) => Promise<void>;
  selectPlanForUpdate: (connection: SqlConnection, planId: PlanId, teamId?: TeamId) => Promise<SqlRow | null>;
  selectContacts: (connection: SqlConnection, planId: PlanId, teamId?: TeamId) => Promise<SqlRow[]>;
  selectAllContacts: (connection: SqlConnection, teamId?: TeamId) => Promise<SqlRow[]>;
  selectContactsForUpdate: (connection: SqlConnection, planId: PlanId, teamId?: TeamId) => Promise<SqlRow[]>;
  cancelAllNonTerminalContacts: (connection: SqlConnection, rows: readonly SqlRow[]) => Promise<number>;
  readPlanRecord: (
    connection: SqlConnection,
    planId: PlanId,
    teamId?: TeamId,
  ) => Promise<{ planRow: SqlRow; contactRows: SqlRow[]; assuranceRows: SqlRow[] } | null>;
  writeContact: (connection: SqlConnection, contact: Contact) => Promise<void>;
  writePlan: (connection: SqlConnection, plan: Plan, completedAt: Date | null) => Promise<void>;
};

export function createExecutionContext(
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
        serviceStopBlocksDispatch(await ctx.readServiceState(connection));

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

      await ctx.insertAuditEvent(connection, event, token);

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

  const ctx: RepositoryContext = {
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

  return ctx;
}
