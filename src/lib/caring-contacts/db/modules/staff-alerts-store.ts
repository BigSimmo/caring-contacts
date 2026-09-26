// src/lib/caring-contacts/db/modules/staff-alerts-store.ts
//
// Domain module (feature: staff alert delivery): the team's opted-in alert classes, the sender
// heartbeat and the staff-alert cooldown claims. Tables from migration 0020.
//
// None of these writes goes through `runWrite`. They are operational bookkeeping, not clinical
// records: no idempotency key (a heartbeat or an alert claim is not a request a person could
// retry), and no audit event (0020 explains why the audit guard is deliberately not attached).
// They still run inside `inTransaction`, as `caring_contacts_app` with a team scope set, so
// row-level security applies to them like every other statement this store makes.
import type { TransitionResult } from "../../model";
import type { AlertClass } from "../../notification-preferences";
import {
  mayReadTeamAlertOptIns,
  mayWriteOperationalRecord,
  REPOSITORY_REFUSALS,
  unionOfAlertOptIns,
  type ReadContext,
  type SenderHeartbeat,
  type StaffAlertClaim,
  type StaffAlertClaimInput,
  type StaffAlertReleaseInput,
} from "../../repository";
import { instantOf, type RepositoryContext } from "../shared";

/** The singleton key of `caring_contacts.sender_heartbeats` (checked by migration 0020). */
const SENDER_HEARTBEAT_ID = "sender";

export class StaffAlertsStore {
  constructor(private readonly ctx: RepositoryContext) {}

  async listTeamAlertOptIns(context: ReadContext): Promise<AlertClass[]> {
    if (!mayReadTeamAlertOptIns(context.actor)) return [];
    return this.ctx.runRead(context, async (connection) => {
      // Row-level security scopes this to the actor's own team; the predicate says so as well.
      const result = await connection.query(
        "select opted_in from caring_contacts.notification_preferences where team_id = $1",
        [context.actor.teamId],
      );
      return unionOfAlertOptIns(result.rows.map((row) => (row.opted_in as string[] | null) ?? []));
    });
  }

  async recordSenderHeartbeat(input: { at: Date }, context: ReadContext): Promise<TransitionResult<SenderHeartbeat>> {
    if (!mayWriteOperationalRecord(context.actor)) return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
    return this.ctx.inTransaction(context.actor.teamId, null, async (connection) => {
      // `greatest` so an overlapping run finishing with an earlier instant never moves it back.
      const result = await connection.query(
        `insert into caring_contacts.sender_heartbeats (id, last_run_at) values ($1, $2)
         on conflict (id) do update
           set last_run_at = greatest(caring_contacts.sender_heartbeats.last_run_at, excluded.last_run_at)
         returning last_run_at`,
        [SENDER_HEARTBEAT_ID, input.at],
      );
      return { ok: true, value: { lastRunAt: instantOf(result.rows[0].last_run_at) } };
    });
  }

  async getSenderHeartbeat(context: ReadContext): Promise<SenderHeartbeat | null> {
    return this.ctx.runRead(context, async (connection) => {
      const result = await connection.query("select last_run_at from caring_contacts.sender_heartbeats where id = $1", [
        SENDER_HEARTBEAT_ID,
      ]);
      const row = result.rows[0];
      return row ? { lastRunAt: instantOf(row.last_run_at) } : null;
    });
  }

  async claimStaffAlert(input: StaffAlertClaimInput, context: ReadContext): Promise<TransitionResult<StaffAlertClaim>> {
    if (!mayWriteOperationalRecord(context.actor)) return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
    return this.ctx.inTransaction(context.actor.teamId, null, async (connection) => {
      // One statement, so it is atomic: `on conflict` locks the existing row, and the update only
      // happens when the stored delivery is at least one cooldown older than this one. A row that
      // came back means this call claimed the alert; no row means another delivery is too recent.
      const result = await connection.query(
        `insert into caring_contacts.staff_alert_deliveries (scope, alert_class, last_sent_at)
         values ($1, $2, $3)
         on conflict (scope, alert_class) do update
           set last_sent_at = excluded.last_sent_at
           where caring_contacts.staff_alert_deliveries.last_sent_at
             <= excluded.last_sent_at - make_interval(secs => $4::double precision / 1000)
         returning last_sent_at`,
        [input.scope, input.alertClass, input.at, input.cooldownMs],
      );
      return { ok: true, value: result.rowCount > 0 ? "claimed" : "coolingDown" };
    });
  }

  async releaseStaffAlert(input: StaffAlertReleaseInput, context: ReadContext): Promise<TransitionResult<void>> {
    if (!mayWriteOperationalRecord(context.actor)) return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
    return this.ctx.inTransaction(context.actor.teamId, null, async (connection) => {
      await connection.query(
        `delete from caring_contacts.staff_alert_deliveries
         where scope = $1 and alert_class = $2 and last_sent_at = $3`,
        [input.scope, input.alertClass, input.at],
      );
      return { ok: true, value: undefined };
    });
  }
}

export function createStaffAlertsStore(ctx: RepositoryContext): StaffAlertsStore {
  return new StaffAlertsStore(ctx);
}
