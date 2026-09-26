// src/lib/caring-contacts/db/modules/contacts-store.ts
//
// Domain module: Contact schedule, dispatch tracking, discrepancy resolution.

import {
  changeContactDate,
  dateChangeCollides,
  isContactReschedulable,
  moveContactWithinDay,
  type ContactDateChangeRequest,
  type ContactMoveRequest,
} from "../../contact-rescheduling";
import { contactId, teamId as toTeamId, type ContactId, type PlanId, type TeamId } from "../../ids";
import {
  applyContactTransition,
  planSendingHold,
  type Contact,
  type ContactAction,
  type ContactState,
  type PlanState,
  type ProviderStatus,
  type TransitionResult,
} from "../../model";
import { canPerformCaringContactAction, type CaringContactAction } from "../../permissions";
import {
  READ_ACTIONS,
  REPOSITORY_REFUSALS,
  type ContactProviderStatusInput,
  type ContactStatusInput,
  type DispatchDiscrepancyResolution,
  type DispatchRecord,
  type ReadContext,
  type ResolveDiscrepancyInput,
  type StoredContact,
  type WriteContext,
} from "../../repository";
import type { PlannedContact } from "../../schedule";
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

export const CONTACT_COLUMNS = `id, plan_id, team_id, sequence, state, version, cadence_label, calendar_day,
  send_at, message_type, suppressed_reason`;

export const DISPATCH_COLUMNS = `d.contact_id, c.plan_id, d.attempt, d.started_at, d.reported_status,
  d.discrepancy_resolved_at, d.discrepancy_resolution`;

export function toPlanned(row: SqlRow): PlannedContact {
  const planned: PlannedContact = {
    sequence: numberOf(row.sequence),
    cadenceLabel: textOf(row.cadence_label),
    calendarDay: textOf(row.calendar_day),
    sendAt: instantOf(row.send_at),
    messageType: textOf(row.message_type) as PlannedContact["messageType"],
  };
  if (row.suppressed_reason !== null && row.suppressed_reason !== undefined) {
    planned.suppressed = { reason: textOf(row.suppressed_reason) as "absorbedByFirstContact" };
  }
  return planned;
}

export function toStoredContact(row: SqlRow): StoredContact {
  const contact: Contact = {
    id: contactId(textOf(row.id)),
    planId: textOf(row.plan_id) as PlanId,
    state: textOf(row.state) as ContactState,
    version: numberOf(row.version),
  };
  return { contact, planned: toPlanned(row) };
}

export function toDispatchRecord(row: SqlRow): DispatchRecord {
  return {
    contactId: contactId(textOf(row.contact_id)),
    planId: textOf(row.plan_id) as PlanId,
    attempt: numberOf(row.attempt),
    startedAt: instantOf(row.started_at),
    expectedStatus: null,
    reportedStatus: isAbsent(row.reported_status) ? null : (textOf(row.reported_status) as ProviderStatus),
    discrepancyResolvedAt: isAbsent(row.discrepancy_resolved_at) ? null : instantOf(row.discrepancy_resolved_at),
    discrepancyResolution: isAbsent(row.discrepancy_resolution)
      ? null
      : (textOf(row.discrepancy_resolution) as DispatchDiscrepancyResolution),
  };
}

export async function selectContacts(connection: SqlConnection, planId: PlanId, teamId?: TeamId): Promise<SqlRow[]> {
  const result = teamId
    ? await connection.query(
        `select ${CONTACT_COLUMNS} from caring_contacts.contacts where plan_id = $1 and team_id = $2 order by sequence`,
        [planId, teamId],
      )
    : await connection.query(
        `select ${CONTACT_COLUMNS} from caring_contacts.contacts where plan_id = $1 order by sequence`,
        [planId],
      );
  return result.rows;
}

/** Team-scoped (optional) all-contacts query for listPlans grouping. Ordered by plan_id, sequence. */
export async function selectAllContacts(connection: SqlConnection, teamId?: TeamId): Promise<SqlRow[]> {
  const result = teamId
    ? await connection.query(
        `select ${CONTACT_COLUMNS} from caring_contacts.contacts where team_id = $1 order by plan_id, sequence`,
        [teamId],
      )
    : await connection.query(`select ${CONTACT_COLUMNS} from caring_contacts.contacts order by plan_id, sequence`);
  return result.rows;
}

export async function selectContactsForUpdate(
  connection: SqlConnection,
  planId: PlanId,
  teamId?: TeamId,
): Promise<SqlRow[]> {
  const result = teamId
    ? await connection.query(
        `select ${CONTACT_COLUMNS} from caring_contacts.contacts where plan_id = $1 and team_id = $2 order by sequence for update`,
        [planId, teamId],
      )
    : await connection.query(
        `select ${CONTACT_COLUMNS} from caring_contacts.contacts where plan_id = $1 order by sequence for update`,
        [planId],
      );
  return result.rows;
}

export async function writeContact(connection: SqlConnection, contact: Contact): Promise<void> {
  const result = await connection.query(
    "update caring_contacts.contacts set state = $2, version = $3 where id = $1 and version = $4",
    [contact.id, contact.state, contact.version, contact.version - 1],
  );
  if (result.rowCount !== 1) {
    throw new Error(`caring-contacts: contact ${contact.id} moved under an optimistic write that held a row lock`);
  }
}

export async function cancelAllNonTerminalContacts(
  connection: SqlConnection,
  rows: readonly SqlRow[],
): Promise<number> {
  let cancelled = 0;
  for (const row of rows) {
    const stored = toStoredContact(row);
    const transition = applyContactTransition(stored.contact, { type: "cancel" });
    if (!transition.ok) continue;
    await writeContact(connection, transition.value);
    cancelled += 1;
  }
  return cancelled;
}

export class ContactsStore {
  constructor(private readonly ctx: RepositoryContext) {}

  selectContacts(connection: SqlConnection, planId: PlanId, teamId?: TeamId): Promise<SqlRow[]> {
    return selectContacts(connection, planId, teamId);
  }

  selectAllContacts(connection: SqlConnection, teamId?: TeamId): Promise<SqlRow[]> {
    return selectAllContacts(connection, teamId);
  }

  selectContactsForUpdate(connection: SqlConnection, planId: PlanId, teamId?: TeamId): Promise<SqlRow[]> {
    return selectContactsForUpdate(connection, planId, teamId);
  }

  writeContact(connection: SqlConnection, contact: Contact): Promise<void> {
    return writeContact(connection, contact);
  }

  cancelAllNonTerminalContacts(connection: SqlConnection, rows: readonly SqlRow[]): Promise<number> {
    return cancelAllNonTerminalContacts(connection, rows);
  }

  private async contactStatusWrite(
    method: string,
    permission: CaringContactAction,
    input: ContactStatusInput,
    action: ContactAction,
    context: WriteContext,
    requiresActivePlan: boolean,
    recordDispatchAttempt = false,
    reportedStatus?: ProviderStatus,
  ): Promise<TransitionResult<StoredContact>> {
    return this.ctx.runWrite<StoredContact>({
      method,
      input,
      context,
      auditAction: method,
      objectType: "contact",
      objectId: input.contactId,
      stage: async (connection) => {
        const planRow = await this.ctx.selectPlanForUpdate(connection, input.planId);
        if (!planRow) return { ok: false, reason: REPOSITORY_REFUSALS.notFound };

        const team = toTeamId(textOf(planRow.team_id));
        if (!canPerformCaringContactAction(context.actor, permission, { teamId: team }).allowed) {
          return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
        }

        const contactResult = await connection.query(
          `select ${CONTACT_COLUMNS} from caring_contacts.contacts where plan_id = $1 and id = $2 and team_id = $3 for update`,
          [input.planId, input.contactId, team],
        );
        const contactRow = contactResult.rows[0];
        if (!contactRow) return { ok: false, reason: REPOSITORY_REFUSALS.notFound };
        if (numberOf(contactRow.version) !== input.expectedContactVersion) {
          return { ok: false, reason: REPOSITORY_REFUSALS.staleVersion };
        }

        if (requiresActivePlan && textOf(planRow.state) !== "active") {
          return { ok: false, reason: REPOSITORY_REFUSALS.contactDispatchRequiresActivePlan };
        }

        const stored = toStoredContact(contactRow);
        const moved = applyContactTransition(stored.contact, action);
        if (!moved.ok) return moved;
        await writeContact(connection, moved.value);

        if (recordDispatchAttempt) {
          const attempts = await connection.query(
            "select coalesce(max(attempt), 0) + 1 as attempt from caring_contacts.contact_dispatches where contact_id = $1",
            [input.contactId],
          );
          await connection.query(
            `insert into caring_contacts.contact_dispatches
               (contact_id, team_id, attempt, idempotency_key, started_at)
             values ($1, $2, $3, $4, $5)`,
            [input.contactId, team, numberOf(attempts.rows[0].attempt), context.idempotencyKey, this.ctx.clock.now()],
          );
        }

        if (reportedStatus !== undefined) {
          await connection.query(
            `update caring_contacts.contact_dispatches set reported_status = $2
              where id = (
                select id from caring_contacts.contact_dispatches where contact_id = $1
                 order by attempt desc limit 1
              )`,
            [input.contactId, reportedStatus],
          );
        }

        return { ok: true, value: { contact: moved.value, planned: stored.planned } };
      },
    });
  }

  async startContactDispatch(
    input: ContactStatusInput,
    context: WriteContext,
  ): Promise<TransitionResult<StoredContact>> {
    return this.contactStatusWrite(
      "startContactDispatch",
      "startContactDispatch",
      input,
      { type: "startProcessing" },
      context,
      true,
      true,
    );
  }

  async recordContactSent(input: ContactStatusInput, context: WriteContext): Promise<TransitionResult<StoredContact>> {
    return this.contactStatusWrite(
      "recordContactSent",
      "recordContactSent",
      input,
      { type: "markSent" },
      context,
      false,
    );
  }

  async recordContactProviderStatus(
    input: ContactProviderStatusInput,
    context: WriteContext,
  ): Promise<TransitionResult<StoredContact>> {
    return this.contactStatusWrite(
      "recordContactProviderStatus",
      "recordContactProviderStatus",
      input,
      { type: "providerStatus", status: input.status },
      context,
      false,
      false,
      input.status,
    );
  }

  async recordContactMissed(
    input: ContactStatusInput,
    context: WriteContext,
  ): Promise<TransitionResult<StoredContact>> {
    return this.contactStatusWrite(
      "recordContactMissed",
      "recordContactMissed",
      input,
      { type: "markMissed" },
      context,
      false,
    );
  }

  async rescheduleContact(
    input: {
      planId: PlanId;
      contactId: ContactId;
      expectedContactVersion: number;
      change: ContactMoveRequest | ContactDateChangeRequest;
    },
    context: WriteContext,
  ): Promise<TransitionResult<StoredContact>> {
    const permission: CaringContactAction = "toHour" in input.change ? "moveContactWithinDay" : "changeContactDate";
    return this.ctx.runWrite<StoredContact>({
      method: "rescheduleContact",
      input,
      context,
      auditAction: "rescheduleContact",
      objectType: "contact",
      objectId: input.contactId,
      stage: async (connection) => {
        const planRow = await this.ctx.selectPlanForUpdate(connection, input.planId);
        if (!planRow) return { ok: false, reason: REPOSITORY_REFUSALS.notFound };

        const team = toTeamId(textOf(planRow.team_id));
        if (!canPerformCaringContactAction(context.actor, permission, { teamId: team }).allowed) {
          return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
        }

        const contactResult = await connection.query(
          `select ${CONTACT_COLUMNS} from caring_contacts.contacts where plan_id = $1 and id = $2 and team_id = $3 for update`,
          [input.planId, input.contactId, team],
        );
        const contactRow = contactResult.rows[0];
        if (!contactRow) return { ok: false, reason: REPOSITORY_REFUSALS.notFound };
        if (numberOf(contactRow.version) !== input.expectedContactVersion) {
          return { ok: false, reason: REPOSITORY_REFUSALS.staleVersion };
        }

        const stored = toStoredContact(contactRow);
        if (!isContactReschedulable(stored.contact.state)) {
          return { ok: false, reason: REPOSITORY_REFUSALS.contactNotReschedulable };
        }
        const moved =
          "toHour" in input.change
            ? moveContactWithinDay(
                { contact: stored.planned, toHour: input.change.toHour, toMinute: input.change.toMinute },
                this.ctx.clock,
              )
            : changeContactDate(
                {
                  contact: stored.planned,
                  toCalendarDay: input.change.toCalendarDay,
                  reason: input.change.reason,
                  teamLeadApprovalActorId: input.change.teamLeadApprovalActorId,
                },
                this.ctx.clock,
              );
        if (!moved.ok) return moved;
        if (!("toHour" in input.change)) {
          // The plan row is already locked above, so no sibling can move underneath this check.
          const siblings = (await selectContacts(connection, input.planId, team)).map(toStoredContact);
          const collides = dateChangeCollides(
            stored.contact.id,
            moved.value.calendarDay,
            siblings.map((entry) => ({
              id: entry.contact.id,
              state: entry.contact.state,
              calendarDay: entry.planned.calendarDay,
            })),
          );
          if (collides) return { ok: false, reason: REPOSITORY_REFUSALS.contactDateChangeCollides };
        }

        const nextVersion = stored.contact.version + 1;
        const written = await connection.query(
          `update caring_contacts.contacts
              set calendar_day = $2, send_at = $3, version = $4
            where id = $1 and version = $5`,
          [input.contactId, moved.value.calendarDay, moved.value.sendAt, nextVersion, stored.contact.version],
        );
        if (written.rowCount !== 1) {
          throw new Error(
            `caring-contacts: contact ${input.contactId} moved under an optimistic write that held a row lock`,
          );
        }

        return { ok: true, value: { contact: { ...stored.contact, version: nextVersion }, planned: moved.value } };
      },
    });
  }

  async listContacts(planId: PlanId, context: ReadContext): Promise<StoredContact[]> {
    if (!mayReadOwnTeam(context, READ_ACTIONS.contacts)) return [];
    return this.ctx.runRead(context, async (connection) => {
      const stored = await this.ctx.readPlanRecord(connection, planId);
      return stored ? stored.contactRows.map(toStoredContact) : [];
    });
  }

  async listSendableContacts(planId: PlanId, context: ReadContext): Promise<StoredContact[]> {
    if (!mayReadOwnTeam(context, READ_ACTIONS.contacts)) return [];
    return this.ctx.runRead(context, async (connection) => {
      const stored = await this.ctx.readPlanRecord(connection, planId);
      if (!stored) return [];
      if (planSendingHold(textOf(stored.planRow.state) as PlanState) !== null) return [];
      return stored.contactRows.filter((row) => textOf(row.state) === "scheduled").map(toStoredContact);
    });
  }

  async listDispatches(input: { fromIso: string; toIso: string }, context: ReadContext): Promise<DispatchRecord[]> {
    if (!mayReadOwnTeam(context, READ_ACTIONS.dispatch)) return [];
    return this.ctx.runRead(context, async (connection) => {
      const result = await connection.query(
        `select ${DISPATCH_COLUMNS} from caring_contacts.contact_dispatches d
           join caring_contacts.contacts c on c.id = d.contact_id
          where d.started_at >= $1 and d.started_at <= $2
          order by d.contact_id, d.attempt`,
        [new Date(input.fromIso), new Date(input.toIso)],
      );
      return result.rows.map(toDispatchRecord);
    });
  }

  async resolveDispatchDiscrepancy(
    input: ResolveDiscrepancyInput,
    context: WriteContext,
  ): Promise<TransitionResult<DispatchRecord>> {
    return this.ctx.runWrite<DispatchRecord>({
      method: "resolveDispatchDiscrepancy",
      input,
      context,
      auditAction: "resolveDispatchDiscrepancy",
      objectType: "contact",
      objectId: input.contactId,
      stage: async (connection) => {
        const result = await connection.query(
          `select ${DISPATCH_COLUMNS}, d.id as dispatch_id from caring_contacts.contact_dispatches d
             join caring_contacts.contacts c on c.id = d.contact_id
            where d.contact_id = $1 and d.attempt = $2
            for update of d`,
          [input.contactId, input.attempt],
        );
        const row = result.rows[0];
        if (!row) return { ok: false, reason: REPOSITORY_REFUSALS.notFound };

        if (
          !canPerformCaringContactAction(context.actor, "reconcileProviderDispatch", {
            teamId: context.actor.teamId,
          }).allowed
        ) {
          return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
        }
        if (!isAbsent(row.discrepancy_resolved_at)) {
          return { ok: false, reason: REPOSITORY_REFUSALS.dispatchDiscrepancyAlreadyResolved };
        }
        if (input.note.trim() === "") {
          return { ok: false, reason: REPOSITORY_REFUSALS.dispatchDiscrepancyNoteRequired };
        }

        const resolvedAt = this.ctx.clock.now();
        await connection.query(
          `update caring_contacts.contact_dispatches
              set discrepancy_resolved_at = $2, discrepancy_resolution = $3, discrepancy_note = $4
            where id = $1`,
          [numberOf(row.dispatch_id), resolvedAt, input.resolution, input.note],
        );

        return {
          ok: true,
          value: {
            ...toDispatchRecord(row),
            discrepancyResolvedAt: resolvedAt,
            discrepancyResolution: input.resolution,
          },
        };
      },
    });
  }
}

export function createContactsStore(ctx: RepositoryContext): ContactsStore {
  return new ContactsStore(ctx);
}
