// src/lib/caring-contacts/db/modules/inbound-replies-store.ts
//
// Incoming text messages (2026-09-26): the Postgres half of the reply-to-check items and the
// automatic-reply loop guard, over migration 0021's two tables. The rules are
// ../../inbound-replies.ts's; the in-memory twin is in ../../in-memory-repository.ts, and the shared
// contract suite holds the two to the same answers.
//
// Every statement runs inside the store's own team-scoped transaction as `caring_contacts_app`, so
// row-level security applies to all of them; the team predicates below are a second line, not the
// only one.
import { toAustralianMobileE164 } from "../../transport/phone";
import {
  admitRecordInboundReplyInput,
  applyInboundReplyFollowUp,
  INBOUND_REPLY_REFUSALS,
  INBOUND_SENDER_KEY_PATTERN,
  optOutPausesPlan,
  type FollowUpInboundReplyInput,
  type InboundReplyKind,
  type InboundReplyPlanMatch,
  type InboundReplyRecord,
  type InboundReplyWithText,
  type RecordInboundReplyInput,
} from "../../inbound-replies";
import { teamId as toTeamId, type ActorId, type PatientId, type PlanId, type TeamId } from "../../ids";
import { applyPlanTransition, type PlanState, type TransitionResult } from "../../model";
import { canPerformCaringContactAction } from "../../permissions";
import { READ_ACTIONS, REPOSITORY_REFUSALS, type ReadContext, type WriteContext } from "../../repository";
import {
  instantOf,
  isAbsent,
  mayReadOwnTeam,
  numberOf,
  textOf,
  type RepositoryContext,
  type SqlConnection,
  type SqlRow,
} from "../shared";

/**
 * The session scope the loop guard runs under. Its table belongs to no team (an unknown number has
 * none), and its policy admits any session that names a team -- the service-wide shape
 * `service_state` has. This names none of the real ones, the same way `SERVICE_STATE_UNSET_TEAM`
 * does, and no row anywhere carries it.
 */
const AUTO_REPLY_LIMIT_SCOPE: TeamId = toTeamId("inbound-auto-reply-limit");

/** Every column EXCEPT the words, for the list read and for every write's answer. */
const REPLY_RECORD_COLUMNS = `r.id, r.team_id, r.plan_id, p.patient_id, r.kind, r.received_at, r.plan_paused,
  r.followed_up_at, r.followed_up_by, r.version`;

function toInboundReplyRecord(row: SqlRow): InboundReplyRecord {
  return {
    id: textOf(row.id),
    planId: textOf(row.plan_id) as PlanId,
    patientId: textOf(row.patient_id) as PatientId,
    teamId: toTeamId(textOf(row.team_id)),
    kind: textOf(row.kind) as InboundReplyKind,
    receivedAt: instantOf(row.received_at),
    planPaused: row.plan_paused === true,
    followedUpAt: isAbsent(row.followed_up_at) ? null : instantOf(row.followed_up_at),
    followedUpBy: isAbsent(row.followed_up_by) ? null : (textOf(row.followed_up_by) as ActorId),
    version: numberOf(row.version),
  };
}

export class InboundRepliesStore {
  constructor(private readonly ctx: RepositoryContext) {}

  private async selectReply(connection: SqlConnection, replyId: string, forUpdate: boolean): Promise<SqlRow | null> {
    const result = await connection.query(
      `select ${REPLY_RECORD_COLUMNS}
         from caring_contacts.inbound_replies r
         join caring_contacts.plans p on p.id = r.plan_id and p.team_id = r.team_id
        where r.id = $1${forUpdate ? " for update of r" : ""}`,
      [replyId],
    );
    return result.rows[0] ?? null;
  }

  async findPlansForInboundNumber(mobileE164: string, context: ReadContext): Promise<InboundReplyPlanMatch[]> {
    const wanted = toAustralianMobileE164(mobileE164);
    if (wanted === null) return [];
    if (!mayReadOwnTeam(context, READ_ACTIONS.inboundReply)) return [];
    // The comparison is made IN THE DATABASE, with the stored value normalised exactly as
    // `toAustralianMobileE164` normalises it (spaces, brackets, dots and hyphens removed; +61, 61
    // and 0 prefixes all accepted), so no patient's number is ever fetched into this process to be
    // compared -- only the identifiers of the plans that match.
    const national = wanted.slice(3); // 4XXXXXXXX
    return this.ctx.runRead(context, async (connection) => {
      const result = await connection.query(
        `select id, patient_id, state, created_at
           from caring_contacts.plans
          where team_id = $1
            and regexp_replace(patient_mobile_number, '[[:space:]().-]', '', 'g') in ($2, $3, $4)
          order by id`,
        [context.actor.teamId, `+61${national}`, `61${national}`, `0${national}`],
      );
      return result.rows.map((row) => ({
        planId: textOf(row.id) as PlanId,
        patientId: textOf(row.patient_id) as PatientId,
        planState: textOf(row.state) as PlanState,
        createdAt: instantOf(row.created_at),
      }));
    });
  }

  async recordInboundReply(
    input: RecordInboundReplyInput,
    context: WriteContext,
  ): Promise<TransitionResult<InboundReplyRecord>> {
    return this.ctx.runWrite<InboundReplyRecord>({
      method: "recordInboundReply",
      input,
      context,
      auditAction: `recordInboundReply:${input.kind}`,
      objectType: "inboundReply",
      objectId: input.replyId,
      // See the contract: a patient's reply must be recordable during a safety stop.
      bypassServiceStopGate: true,
      stage: async (connection) => {
        const admitted = admitRecordInboundReplyInput(input);
        if (!admitted.ok) return admitted;
        const planRow = await this.ctx.selectPlanForUpdate(connection, input.planId, context.actor.teamId);
        if (!planRow) return { ok: false, reason: REPOSITORY_REFUSALS.notFound };
        const team = toTeamId(textOf(planRow.team_id));
        if (!canPerformCaringContactAction(context.actor, "recordInboundReply", { teamId: team }).allowed) {
          return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
        }
        const taken = await connection.query("select 1 from caring_contacts.inbound_replies where id = $1", [
          input.replyId,
        ]);
        if (taken.rows.length > 0) return { ok: false, reason: INBOUND_REPLY_REFUSALS.alreadyRecorded };

        const state = textOf(planRow.state) as PlanState;
        let paused = false;
        if (optOutPausesPlan(input.kind, state)) {
          const moved = applyPlanTransition(
            { id: input.planId, teamId: team, state, version: numberOf(planRow.version) },
            { type: "pause" },
          );
          if (!moved.ok) return moved;
          // A pause never ends a plan, so there is no completion instant to write.
          await this.ctx.writePlan(connection, moved.value, null);
          paused = true;
        }

        await connection.query(
          `insert into caring_contacts.inbound_replies
             (id, team_id, plan_id, kind, body, received_at, plan_paused)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [input.replyId, team, input.planId, input.kind, input.text, this.ctx.clock.now(), paused],
        );
        const row = await this.selectReply(connection, input.replyId, false);
        if (!row) throw new Error("caring-contacts: an inbound reply vanished inside its own transaction");
        return { ok: true, value: toInboundReplyRecord(row) };
      },
    });
  }

  async markInboundReplyFollowedUp(
    input: FollowUpInboundReplyInput,
    context: WriteContext,
  ): Promise<TransitionResult<InboundReplyRecord>> {
    return this.ctx.runWrite<InboundReplyRecord>({
      method: "markInboundReplyFollowedUp",
      input,
      context,
      auditAction: "markInboundReplyFollowedUp",
      objectType: "inboundReply",
      objectId: input.replyId,
      stage: async (connection) => {
        const row = await this.selectReply(connection, input.replyId, true);
        if (!row || textOf(row.plan_id) !== input.planId) return { ok: false, reason: REPOSITORY_REFUSALS.notFound };
        const record = toInboundReplyRecord(row);
        if (!canPerformCaringContactAction(context.actor, "followUpInboundReply", { teamId: record.teamId }).allowed) {
          return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
        }
        if (record.version !== input.expectedVersion) return { ok: false, reason: REPOSITORY_REFUSALS.staleVersion };
        const followed = applyInboundReplyFollowUp(record, context.actor.id, this.ctx.clock.now());
        if (!followed.ok) return followed;
        const updated = await connection.query(
          `update caring_contacts.inbound_replies
              set followed_up_at = $2, followed_up_by = $3, version = $4
            where id = $1 and version = $5 and followed_up_at is null`,
          [
            input.replyId,
            followed.value.followedUpAt,
            followed.value.followedUpBy,
            followed.value.version,
            record.version,
          ],
        );
        if (updated.rowCount !== 1) {
          throw new Error("caring-contacts: an inbound reply moved under a write that held its row lock");
        }
        return { ok: true, value: followed.value };
      },
    });
  }

  async listOpenInboundReplies(context: ReadContext): Promise<InboundReplyRecord[]> {
    if (!mayReadOwnTeam(context, READ_ACTIONS.inboundReply)) return [];
    return this.ctx.runRead(context, async (connection) => {
      const result = await connection.query(
        `select ${REPLY_RECORD_COLUMNS}
           from caring_contacts.inbound_replies r
           join caring_contacts.plans p on p.id = r.plan_id and p.team_id = r.team_id
          where r.team_id = $1 and r.followed_up_at is null
          order by r.received_at, r.id`,
        [context.actor.teamId],
      );
      return result.rows.map(toInboundReplyRecord);
    });
  }

  async listInboundReplies(planId: PlanId, context: ReadContext): Promise<InboundReplyWithText[]> {
    if (!mayReadOwnTeam(context, READ_ACTIONS.inboundReply)) return [];
    return this.ctx.runRead(context, async (connection) => {
      const result = await connection.query(
        `select ${REPLY_RECORD_COLUMNS}, r.body
           from caring_contacts.inbound_replies r
           join caring_contacts.plans p on p.id = r.plan_id and p.team_id = r.team_id
          where r.plan_id = $1 and r.team_id = $2
          order by r.received_at, r.id`,
        [planId, context.actor.teamId],
      );
      return result.rows.map((row) => ({ ...toInboundReplyRecord(row), text: textOf(row.body) }));
    });
  }

  async claimInboundAutoReply(input: { senderKey: string; windowMs: number }): Promise<boolean> {
    if (!INBOUND_SENDER_KEY_PATTERN.test(input.senderKey) || !(input.windowMs > 0)) {
      throw new Error("caring-contacts: an automatic-reply claim needs a sender key and a positive window");
    }
    const now = this.ctx.clock.now();
    const cutoff = new Date(now.getTime() - input.windowMs);
    return this.ctx.inTransaction(AUTO_REPLY_LIMIT_SCOPE, null, async (connection) => {
      await connection.query("delete from caring_contacts.inbound_auto_reply_limits where last_replied_at <= $1", [
        cutoff,
      ]);
      // ONE statement decides the claim, so two instances answering the same number at the same
      // moment cannot both win: the insert takes an absent key, the conditional update takes an
      // expired one, and a live one returns no row. (The delete above has usually removed an expired
      // key already; the `where` keeps the claim correct if it has not.)
      const claimed = await connection.query(
        `insert into caring_contacts.inbound_auto_reply_limits (sender_key, last_replied_at)
         values ($1, $2)
         on conflict (sender_key) do update
           set last_replied_at = excluded.last_replied_at
           where caring_contacts.inbound_auto_reply_limits.last_replied_at <= $3
         returning sender_key`,
        [input.senderKey, now, cutoff],
      );
      return claimed.rows.length === 1;
    });
  }
}

export function createInboundRepliesStore(ctx: RepositoryContext): InboundRepliesStore {
  return new InboundRepliesStore(ctx);
}
