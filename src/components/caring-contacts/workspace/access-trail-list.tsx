import { awstDateTimeWording } from "@/components/caring-contacts/workspace/date-wording";
import { ACCESS_ACTION_PREFIX } from "@/lib/caring-contacts/access-audit";
import type { AuditEvent, AuditOutcome } from "@/lib/caring-contacts/audit";
import {
  CARING_CONTACT_ROLE_WORDING,
  ROLE_ACTIONS,
  type CaringContactAction,
  type CaringContactRole,
} from "@/lib/caring-contacts/permissions";

import { ListEmptyState } from "./list-empty-state";
import { workspacePanelPadded } from "./surfaces";

/**
 * The access trail, read-only: who opened, searched or changed which record, and when.
 *
 * WHAT AN ENTRY SHOWS is what the audit event itself carries and nothing more -- the account, its
 * roles, the kind of access, the kind of object and its identifier, and the outcome. An audit event
 * holds no name, number or message text by construction (`audit.ts`), so neither does this list.
 *
 * WHO SEES IT is decided on the page from the sealed capability map (`viewAccessTrail`), because the
 * store answers a role without it with an empty list -- exactly as it answers a quiet week. A list
 * that only counted rows would tell a coordinator nobody had opened anything.
 *
 * WORDING IS A CLOSED LOOKUP (Ruling 61). An action or object kind this screen has not been taught
 * is shown as the identifier the trail recorded, labelled as such, rather than given a plausible
 * sentence.
 */

const ACCESS_KIND_WORDING: Readonly<Record<string, string>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, string>, {
    view: "Viewed",
    search: "Searched",
    export: "Exported",
    administrative: "Read (administrative)",
    mutation: "Tried to change",
  }),
);

const OBJECT_TYPE_WORDING: Readonly<Record<string, string>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, string>, {
    plan: "plans",
    contact: "contacts",
    episode: "episodes",
    auditTrail: "the access trail",
    report: "reports",
    patientDirectory: "the patient directory",
    patientName: "patient names",
    contactSchedule: "the schedule",
    teamWorkload: "the team's workload",
    notificationPreferences: "notification settings",
    trainingRecord: "training records",
    pathwayVersion: "templates",
    serviceState: "the service stop",
  }),
);

const OUTCOME_WORDING: Readonly<Record<AuditOutcome, string>> = Object.freeze({
  allowed: "Allowed",
  denied: "Refused",
  failed: "Failed",
});

function objectWording(objectType: string): string {
  return OBJECT_TYPE_WORDING[objectType] ?? `a record of kind "${objectType}"`;
}

/** "Searched plans" for an access; "Change: stopService" for a write, named as the trail names it. */
function actionWording(event: AuditEvent): string {
  const [prefix, kind] = event.action.split(":");
  if (prefix === ACCESS_ACTION_PREFIX && kind !== undefined) {
    const verb = ACCESS_KIND_WORDING[kind] ?? `Access of kind "${kind}" to`;
    return `${verb} ${objectWording(event.objectType)}`;
  }
  return `Change recorded as "${event.action}" on ${objectWording(event.objectType)}`;
}

function rolesWording(roles: readonly string[]): string {
  if (roles.length === 0) return "no role recorded";
  return roles
    .map((role) =>
      Object.hasOwn(CARING_CONTACT_ROLE_WORDING, role)
        ? CARING_CONTACT_ROLE_WORDING[role as keyof typeof CARING_CONTACT_ROLE_WORDING]
        : role,
    )
    .join(", ");
}

/** The roles the grant table gives an action to, read from the table rather than restated here. */
function rolesHolding(action: CaringContactAction): readonly CaringContactRole[] {
  return (Object.keys(ROLE_ACTIONS) as CaringContactRole[]).filter((role) => ROLE_ACTIONS[role].includes(action));
}

export type AccessTrailListProps = {
  /** The window's entries, newest first, exactly as the page read them (`newestFirst: true`). */
  entries: readonly AuditEvent[];
  mayViewAccessTrail: boolean;
  windowDays: number;
  /** The most entries one read returns. Reaching it means the window may hold more. */
  limit: number;
};

export function AccessTrailList({ entries, mayViewAccessTrail, windowDays, limit }: AccessTrailListProps) {
  if (!mayViewAccessTrail) {
    return (
      <ListEmptyState
        kind="not-permitted"
        heading="The access trail is not visible in this role"
        because={`Only the ${rolesWording(rolesHolding("viewAccessTrail"))} role may read the access trail, so this screen shows nothing to this account — which says nothing about whether anyone opened anything.`}
        changedBy="Nothing on this screen. An account in that role sees the trail here."
      />
    );
  }

  if (entries.length === 0) {
    return (
      <ListEmptyState
        kind="no-data"
        heading="Nothing recorded in this window"
        explanation={`No access to this team's records was recorded in the last ${windowDays} days. Anyone opening, searching or changing a record is recorded here as it happens.`}
      />
    );
  }

  return (
    <section aria-labelledby="access-trail-heading" className={workspacePanelPadded}>
      <h2 id="access-trail-heading" className="text-base font-semibold text-[color:var(--text-heading)]">
        Last {windowDays} days, most recent first
      </h2>
      <p className="mt-1 max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
        {entries.length === limit
          ? `The window holds at least ${limit} entries; this screen shows the most recent ${limit}, newest first. Reading this screen is itself recorded here.`
          : `${entries.length} ${entries.length === 1 ? "entry" : "entries"}. Reading this screen is itself recorded here.`}
      </p>
      <ol className="mt-3 flex min-w-0 flex-col gap-2" data-testid="caring-contacts-access-trail">
        {entries.map((event) => (
          <li
            key={`${event.idempotencyKey}-${event.timestamp}`}
            data-testid="caring-contacts-access-trail-entry"
            className="min-w-0 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2 text-sm leading-6 forced-colors:border-[CanvasText]"
          >
            <p className="font-medium break-words text-[color:var(--text)]">{actionWording(event)}</p>
            <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 text-[color:var(--text-muted)]">
              <dt>When</dt>
              <dd className="min-w-0">{awstDateTimeWording(event.timestamp)}</dd>
              <dt>Account</dt>
              <dd className="min-w-0 break-words">
                {event.actorId} ({rolesWording(event.actorRoles)})
              </dd>
              <dt>Record</dt>
              <dd className="min-w-0 break-words">{event.objectId}</dd>
              <dt>Outcome</dt>
              <dd className="min-w-0">{OUTCOME_WORDING[event.outcome] ?? event.outcome}</dd>
            </dl>
          </li>
        ))}
      </ol>
    </section>
  );
}
