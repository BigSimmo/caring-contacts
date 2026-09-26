import { CircleCheck, OctagonX } from "lucide-react";

import { awstDateTimeWording } from "@/components/caring-contacts/workspace/date-wording";
import type { ServiceStateView } from "@/lib/caring-contacts-server/service-state-view";
import {
  CARING_CONTACT_ROLE_WORDING,
  ROLE_ACTIONS,
  canPerformCaringContactAction,
  type Actor,
  type CaringContactAction,
  type CaringContactRole,
} from "@/lib/caring-contacts/permissions";
import {
  REQUIRED_RESTART_APPROVAL_ROLES,
  SERVICE_STOP_REASONS,
  holdsRestartApprovalSeat,
  restartApprovalRoleWording,
  serviceStopReasonWording,
  type RestartApprovalSeatRoster,
  type ServiceRestartApprovalRole,
  type ServiceStopReason,
} from "@/lib/caring-contacts/service-state";

import { StatedReason } from "./plan-wizard/stated-reason";
import {
  RestartApprovalControls,
  ServiceStopForm,
  type RestartSeatOption,
  type ServiceStopReasonOption,
} from "./service-stop-controls";
import { workspacePanelPadded } from "./surfaces";

/**
 * The service stop screen: where sending stands, the one control that stops all of it, and the
 * three restart approvals that start it again (owner request 2026-09-26: "The emergency safety stop
 * has no button. Stopping all sending during an incident currently needs a developer.").
 *
 * A SERVER COMPONENT, AND THE NOTE IS WHY. The page hands this screen the record ALREADY NARROWED by
 * `narrowServiceStateForActor` -- the same boundary the API's GET uses (Ruling 43) -- so the incident
 * note is here only when that boundary released it to this person, and it is rendered here, on the
 * server. The two client controls beneath receive plain strings and never the record.
 *
 * WHO MAY ACT IS ASKED OF THE SEALED CAPABILITY MAP, never a role list written here. The stop is
 * `triggerServiceSafetyStop` and each approval is `approveServiceRestart`, both for the actor's own
 * team -- exactly what the route checks. The roles named in the "who can do this" explanations are
 * READ from `ROLE_ACTIONS`, so the explanation cannot drift from the grant.
 *
 * A SEAT IS NOT A ROLE. Holding `approveServiceRestart` says someone may approve; governance
 * configuration names who actually holds each seat (owner decision 2026-09-26). So an approval
 * control is offered only for a seat this person is named for, that is still outstanding, and only
 * if they have not already approved in another seat. The store decides every approval again against
 * its own roster.
 */

/** Short labels for the five reason categories. The longer description is the domain's own wording. */
const STOP_REASON_LABELS: Readonly<Record<ServiceStopReason, string>> = Object.freeze({
  "wrong-recipient": "Wrong recipient",
  "duplicate-send": "Duplicate send",
  "unauthorised-content": "Unapproved content",
  "privacy-or-security-incident": "Privacy or security incident",
  "audit-integrity-loss": "Record of sending cannot be trusted",
});

function stopReasonLabel(reason: ServiceStopReason): string {
  if (!Object.hasOwn(STOP_REASON_LABELS, reason)) {
    throw new Error(`No label for the service stop reason "${reason}". Ruling 61: add one deliberately.`);
  }
  return STOP_REASON_LABELS[reason];
}

function sentenceCase(text: string): string {
  return text.length === 0 ? text : `${text[0].toUpperCase()}${text.slice(1)}`;
}

function formatList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The roles the grant table gives an action to, in plain words and table order. */
function rolesHolding(action: CaringContactAction): readonly string[] {
  return (Object.keys(ROLE_ACTIONS) as CaringContactRole[])
    .filter((role) => ROLE_ACTIONS[role].includes(action))
    .map((role) => CARING_CONTACT_ROLE_WORDING[role]);
}

export type RestartSeatStatus = {
  readonly role: ServiceRestartApprovalRole;
  readonly wording: string;
  readonly approval: { readonly actorId: string; readonly approvedAt: string } | null;
  /** False when governance configuration names nobody for this seat, so it cannot be taken. */
  readonly named: boolean;
};

export type ServiceStopScreenModel = {
  readonly view: ServiceStateView;
  readonly endpoint: string;
  readonly mayStop: boolean;
  readonly stopRoles: readonly string[];
  readonly reasons: readonly ServiceStopReasonOption[];
  readonly restartSeatsWording: string;
  readonly mayApprove: boolean;
  readonly approveRoles: readonly string[];
  readonly seats: readonly RestartSeatStatus[];
  readonly takeableSeats: readonly RestartSeatOption[];
  readonly alreadyApproved: boolean;
};

/**
 * Everything the screen needs, decided in one place from the narrowed view, the actor and the seat
 * roster. Pure, so the page's decisions are testable without a render.
 */
export function buildServiceStopScreenModel(input: {
  view: ServiceStateView;
  actor: Actor;
  seats: RestartApprovalSeatRoster;
  endpoint: string;
}): ServiceStopScreenModel {
  const { view, actor, seats, endpoint } = input;
  const own = { teamId: actor.teamId };
  const mayStop = canPerformCaringContactAction(actor, "triggerServiceSafetyStop", own).allowed;
  const mayApprove = canPerformCaringContactAction(actor, "approveServiceRestart", own).allowed;
  const approvals = view.stopped ? view.restartApprovals : [];
  const alreadyApproved = approvals.some((approval) => approval.actorId === actor.id);

  const seatStatuses: RestartSeatStatus[] = REQUIRED_RESTART_APPROVAL_ROLES.map((role) => {
    const approval = approvals.find((candidate) => candidate.role === role) ?? null;
    return {
      role,
      wording: restartApprovalRoleWording(role),
      approval: approval === null ? null : { actorId: approval.actorId, approvedAt: approval.approvedAt },
      named: Object.hasOwn(seats, role) && seats[role].length > 0,
    };
  });

  const takeableSeats: RestartSeatOption[] =
    view.stopped && mayApprove && !alreadyApproved
      ? seatStatuses
          .filter((seat) => seat.approval === null && holdsRestartApprovalSeat(seats, seat.role, actor.id))
          .map((seat) => ({ role: seat.role, wording: seat.wording }))
      : [];

  return {
    view,
    endpoint,
    mayStop,
    stopRoles: rolesHolding("triggerServiceSafetyStop"),
    reasons: SERVICE_STOP_REASONS.map((reason) => ({
      value: reason,
      label: stopReasonLabel(reason),
      description: `${sentenceCase(serviceStopReasonWording(reason))}.`,
    })),
    restartSeatsWording: formatList(REQUIRED_RESTART_APPROVAL_ROLES.map(restartApprovalRoleWording)),
    mayApprove,
    approveRoles: rolesHolding("approveServiceRestart"),
    seats: seatStatuses,
    takeableSeats,
    alreadyApproved,
  };
}

const sectionHeadingClass = "text-base font-semibold text-[color:var(--text-heading)]";
const mutedTextClass = "max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]";
const factLabelClass = "font-medium text-[color:var(--text)]";

function WhereSendingStands({ view }: { view: ServiceStateView }) {
  if (!view.stopped) {
    return (
      <section aria-labelledby="service-stop-state-heading" className={workspacePanelPadded}>
        <h2 id="service-stop-state-heading" className={sectionHeadingClass}>
          Where sending stands
        </h2>
        <p className="mt-2 flex min-w-0 items-center gap-2 text-sm font-semibold text-[color:var(--text)]">
          <CircleCheck aria-hidden="true" className="size-icon-md shrink-0" />
          <span className="min-w-0">Sending is running for the whole service.</span>
        </p>
        <p className={`${mutedTextClass} mt-1`}>
          Scheduled messages go out as planned. Nobody has stopped the service.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="service-stop-state-heading"
      className={`${workspacePanelPadded} border-[color:var(--danger-border)] forced-colors:border-[CanvasText]`}
      data-testid="caring-contacts-service-stop-state"
    >
      <h2 id="service-stop-state-heading" className={sectionHeadingClass}>
        Where sending stands
      </h2>
      <p className="mt-2 flex min-w-0 items-center gap-2 text-sm font-semibold text-[color:var(--danger-text)] forced-colors:text-[CanvasText]">
        <OctagonX aria-hidden="true" className="size-icon-md shrink-0" />
        <span className="min-w-0">Sending is stopped for the whole service.</span>
      </p>
      <dl className="mt-3 grid min-w-0 gap-2 text-sm leading-6 text-[color:var(--text-muted)]">
        <div className="min-w-0">
          <dt className={factLabelClass}>Kind of incident</dt>
          <dd>
            {stopReasonLabel(view.reason)} — {serviceStopReasonWording(view.reason)}.
          </dd>
        </div>
        <div className="min-w-0">
          <dt className={factLabelClass}>Stopped at</dt>
          <dd>{awstDateTimeWording(view.stoppedAt)}</dd>
        </div>
        <div className="min-w-0">
          <dt className={factLabelClass}>Incident note</dt>
          {view.incidentDetail.visible ? (
            <dd data-testid="caring-contacts-service-stop-note">
              <span className="block whitespace-pre-wrap break-words text-[color:var(--text)]">
                {view.incidentDetail.note}
              </span>
              <span className="block">Recorded by account {view.incidentDetail.stoppedBy}.</span>
            </dd>
          ) : (
            <dd data-testid="caring-contacts-service-stop-note-withheld">
              Not shown to this role. The note may describe a patient, so only staff who may see the reporting
              team&apos;s patient records can read it.
            </dd>
          )}
        </div>
      </dl>
    </section>
  );
}

function StopSection({ model }: { model: ServiceStopScreenModel }) {
  return (
    <section aria-labelledby="service-stop-stop-heading" className={workspacePanelPadded}>
      <h2 id="service-stop-stop-heading" className={sectionHeadingClass}>
        Stop all sending
      </h2>
      <p className={`${mutedTextClass} mt-1`}>
        For a confirmed wrong-recipient message, a duplicate send, content nobody approved, a privacy or security
        incident, or a record of sending that can no longer be trusted. The stop covers every patient and every team,
        and it stays in place until {model.restartSeatsWording} have each approved the restart.
      </p>
      <div className="mt-3 min-w-0">
        {model.mayStop ? (
          <ServiceStopForm
            endpoint={model.endpoint}
            reasons={model.reasons}
            restartSeatsWording={model.restartSeatsWording}
          />
        ) : (
          <StatedReason
            heading="This role cannot stop sending"
            because={`Stopping all sending is open to the ${formatList(model.stopRoles)} roles. This account holds none of them.`}
            changedBy="Asking someone in one of those roles to stop sending from this screen."
          />
        )}
      </div>
    </section>
  );
}

function RestartSection({ model }: { model: ServiceStopScreenModel }) {
  if (!model.view.stopped) return null;
  const outstanding = model.seats.filter((seat) => seat.approval === null).length;

  return (
    <section
      aria-labelledby="service-stop-restart-heading"
      className={workspacePanelPadded}
      data-testid="caring-contacts-service-restart"
    >
      <h2 id="service-stop-restart-heading" className={sectionHeadingClass}>
        Restarting sending
      </h2>
      <p className={`${mutedTextClass} mt-1`}>
        Sending restarts only when all three seats have approved, each from a different person named for that seat.
        There is no other way back to running.
      </p>
      <p className="mt-2 text-sm font-medium text-[color:var(--text)]">
        {model.seats.length - outstanding} of {model.seats.length} restart approvals recorded.
      </p>
      <ul className="mt-2 flex min-w-0 flex-col gap-2" aria-label="Restart approvals">
        {model.seats.map((seat) => (
          <li
            key={seat.role}
            data-testid="caring-contacts-restart-seat"
            className="min-w-0 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2 text-sm leading-6 forced-colors:border-[CanvasText]"
          >
            <span className="block font-medium text-[color:var(--text)]">{sentenceCase(seat.wording)}</span>
            <span className="block text-[color:var(--text-muted)]">
              {seat.approval !== null
                ? `Approved by account ${seat.approval.actorId} at ${awstDateTimeWording(seat.approval.approvedAt)}.`
                : seat.named
                  ? "Not yet approved."
                  : "Not yet approved. Nobody is named for this seat in this service's configuration, so the restart cannot be completed until an operator names someone."}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 min-w-0">
        {!model.mayApprove ? (
          <StatedReason
            heading="This role cannot approve a restart"
            because={`Approving a restart is open to the ${formatList(model.approveRoles)} roles, and then only to the person named for each seat.`}
            changedBy="The people named for the outstanding seats approving from this screen."
          />
        ) : model.alreadyApproved ? (
          <StatedReason
            heading="Your approval is recorded"
            because="A restart needs three different people, so this account cannot approve for another seat."
            changedBy="The people named for the outstanding seats approving from this screen."
          />
        ) : model.takeableSeats.length === 0 ? (
          <StatedReason
            heading="You are not named for an outstanding seat"
            because="Each approval must come from the person this service's configuration names for that seat, and this account is not named for any seat still waiting."
            changedBy="The people named for the outstanding seats approving, or an operator naming you for one."
          />
        ) : (
          <RestartApprovalControls endpoint={model.endpoint} seats={model.takeableSeats} outstanding={outstanding} />
        )}
      </div>
    </section>
  );
}

export function ServiceStopScreen({ model }: { model: ServiceStopScreenModel }) {
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="caring-contacts-service-stop-screen">
      <WhereSendingStands view={model.view} />
      {model.view.stopped ? <RestartSection model={model} /> : <StopSection model={model} />}
    </div>
  );
}
