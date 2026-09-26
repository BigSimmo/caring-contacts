import { formatMinutesDuration } from "@/lib/caring-contacts/duration-display";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  Clock,
  FilePlus,
  Plus,
  ShieldAlert,
  UserCheck,
  Users,
} from "lucide-react";
import Link from "next/link";

import { floatingControl, primaryControl } from "@/components/ui-primitives";
import { CARING_CONTACTS_ROUTES, patientPlanRoute, scheduleDayRoute } from "@/lib/caring-contacts-routes";
import { isWithinApprovedSendWindow } from "@/lib/caring-contacts/schedule";
import type { ScheduleDay, ScheduleEntry } from "@/lib/caring-contacts/schedule-view";
import type { ServiceState } from "@/lib/caring-contacts/service-state";
import type { TeamWorkloadView } from "@/lib/caring-contacts/team-workload";
import type { InboundReplyRecord } from "@/lib/caring-contacts/inbound-replies";

import { CONTACT_STATE_LABELS, MESSAGE_TYPE_LABELS } from "./contact-vocabulary";
import { RepliesToCheck } from "./inbound-replies";
import { ListEmptyState } from "./list-empty-state";
import { workspacePanel, workspacePanelPadded } from "./surfaces";

export type TodayDashboardProps = {
  scheduleDay: ScheduleDay;
  teamWorkload: TeamWorkloadView;
  serviceState: ServiceState;
  todayCalendarDay: string;
  mayViewPlans?: boolean;
  /**
   * Incoming text messages (2026-09-26): patients' replies not yet followed up, without their
   * words. Null (or absent) when the acting role may not read replies -- the list is then not
   * shown at all rather than shown empty, for the same reason `mayViewPlans` withholds the view.
   */
  repliesToCheck?: readonly InboundReplyRecord[] | null;
};

const badgeClass =
  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)] px-2 py-0.5 text-xs font-medium";

export function TodayDashboard({
  scheduleDay,
  teamWorkload,
  serviceState,
  todayCalendarDay,
  mayViewPlans = true,
  repliesToCheck = null,
}: TodayDashboardProps) {
  const { counts, exceptions, outsideApprovedWindows, windows } = scheduleDay;
  const { unclaimed, coordinators, thresholdMinutes } = teamWorkload;

  // Running plans on every coordinator's row PLUS running plans nobody has claimed yet: an
  // unclaimed plan is still a patient in the team's active caseload (owner decision 2026-09-26).
  const totalActivePlans = coordinators.reduce((sum, c) => sum + c.activePlans, 0) + unclaimed.activePlans;
  const totalHeldPlans = coordinators.reduce((sum, c) => sum + c.heldPlans.reduce((hSum, h) => hSum + h.plans, 0), 0);

  // Contacts needing review across the whole caseload, not only today's schedule. A delivery that
  // failed last month still needs a person to look at it, and a "Needs review: 0 / Clear" card
  // beside a coordinator carrying a month-old failure would tell the team the opposite of the truth.
  // The roster's backlog is over every plan that has not ended, owned or unclaimed, so no exception
  // goes uncounted for want of an owner.
  const reviewBacklog =
    coordinators.reduce((sum, c) => sum + c.exceptionBacklog.contacts, 0) + unclaimed.exceptionBacklog.contacts;

  const dueEntries: ScheduleEntry[] = [];
  for (const window of windows) {
    for (const entry of window.entries) {
      if (entry.isDue) dueEntries.push(entry);
    }
  }
  const outsideWindowDueIds = new Set<string>();
  for (const entry of outsideApprovedWindows.entries) {
    if (!entry.isDue) continue;
    dueEntries.push(entry);
    // Only a contact that really falls outside 9:00 am to 6:00 pm AWST is flagged as outside the
    // window. `outsideApprovedWindows` holds every contact moved off an approved send TIME, and a
    // move within the window is not outside it; the rule is the schedule domain's own.
    if (!isWithinApprovedSendWindow(entry.sendAt)) outsideWindowDueIds.add(entry.contactId);
  }

  if (!mayViewPlans) {
    return (
      <div data-testid="caring-contacts-today-not-permitted" className="space-y-6">
        <ListEmptyState
          kind="not-permitted"
          heading="Today's workload is not visible in this role"
          because="Viewing plans is not part of the role you are acting in, and both Contacts Due Today and Active Caseload are built entirely from this team's plans. This says nothing about how many contacts fall today or how many plans are active: a read you may not make and an empty caseload look identical on purpose, so that nobody can find out a record exists by being refused it."
          changedBy="Nothing on this screen changes it, and there is no control for it anywhere in this workspace yet. The role this demonstration acts in is set outside the interface; a coordinator sees today's figures."
        />
      </div>
    );
  }

  const hasNoCaseload = counts.total === 0 && unclaimed.plans === 0 && coordinators.length === 0;

  if (hasNoCaseload) {
    return (
      <div data-testid="caring-contacts-today-empty" className="space-y-6">
        {/* A reply can arrive on a plan that has ended, so it is shown even with no caseload. */}
        {repliesToCheck !== null && repliesToCheck.length > 0 ? <RepliesToCheck replies={repliesToCheck} /> : null}
        <ListEmptyState
          kind="no-data"
          heading="No caring contacts active today"
          explanation="There are currently no active plans or scheduled contacts for this team. You can initiate a plan from an accepted referral or register an intake referral."
          action={
            <div className="flex flex-wrap items-center gap-3">
              <Link href={CARING_CONTACTS_ROUTES.newPlan} data-internal-link="true" className={primaryControl}>
                <Plus aria-hidden="true" className="size-icon-sm shrink-0" />
                <span>New plan</span>
              </Link>
              <Link href={CARING_CONTACTS_ROUTES.intake} data-internal-link="true" className={floatingControl}>
                <FilePlus aria-hidden="true" className="size-icon-sm shrink-0" />
                <span>Referral intake</span>
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div data-testid="caring-contacts-today-dashboard" className="space-y-8">
      {/* 1. Urgent Triage Bar */}
      <section aria-labelledby="triage-bar-heading" data-testid="caring-contacts-urgent-triage" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2
            id="triage-bar-heading"
            className="text-sm font-semibold uppercase tracking-wider text-[color:var(--text-muted)]"
          >
            Clinical triage status
          </h2>
          <span className="text-xs text-[color:var(--text-muted)]">
            AWST Day: <time dateTime={todayCalendarDay}>{todayCalendarDay}</time>
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Card: Due Today */}
          <div className={`${workspacePanelPadded} flex flex-col justify-between`}>
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-[color:var(--text-muted)]">Due today</span>
                <span
                  className={`${badgeClass} ${
                    counts.due > 0
                      ? "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                      : "bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]"
                  }`}
                >
                  <Clock aria-hidden="true" className="size-3.5" />
                  {serviceState.stopped ? "Dispatch stopped" : counts.due > 0 ? "Dispatch ready" : "None due"}
                </span>
              </div>
              <p className="mt-2 text-2xl font-bold text-[color:var(--text-heading)]">{counts.due}</p>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-[color:var(--border)] pt-3 text-xs text-[color:var(--text-muted)]">
              <span>
                {windows.length > 0 ? `Windows: ${windows.map((w) => w.label).join(" · ")}` : "No sending windows"}
              </span>
              <Link
                href={scheduleDayRoute(todayCalendarDay)}
                data-internal-link="true"
                className="inline-flex min-h-tap shrink-0 items-center gap-1 font-medium text-[color:var(--command)] hover:underline"
              >
                Schedule <ArrowRight aria-hidden="true" className="size-3" />
              </Link>
            </div>
          </div>

          {/* Card: Operational Reviews / Exceptions */}
          <div className={`${workspacePanelPadded} flex flex-col justify-between`}>
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-[color:var(--text-muted)]">Needs review</span>
                <span
                  className={`${badgeClass} ${
                    reviewBacklog > 0
                      ? "bg-[color:var(--warning-bg)] text-[color:var(--warning-text)]"
                      : "bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]"
                  }`}
                >
                  <AlertTriangle aria-hidden="true" className="size-3.5" />
                  {reviewBacklog > 0 ? "Exceptions" : "Clear"}
                </span>
              </div>
              <p className="mt-2 text-2xl font-bold text-[color:var(--text-heading)]">{reviewBacklog}</p>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-[color:var(--border)] pt-3 text-xs text-[color:var(--text-muted)]">
              <span>
                Failed, missed or invalid numbers, on any day
                {counts.needsReview > 0 ? ` (${counts.needsReview} today)` : ""}
              </span>
              {reviewBacklog > 0 ? (
                <Link
                  href={CARING_CONTACTS_ROUTES.team}
                  data-internal-link="true"
                  className="inline-flex min-h-tap shrink-0 items-center gap-1 font-medium text-[color:var(--command)] hover:underline"
                >
                  Team roster <ArrowRight aria-hidden="true" className="size-3" />
                </Link>
              ) : null}
            </div>
          </div>

          {/* Card: Unclaimed Work */}
          <div className={`${workspacePanelPadded} flex flex-col justify-between`}>
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-[color:var(--text-muted)]">Unclaimed cases</span>
                <span
                  className={`${badgeClass} ${
                    unclaimed.state === "escalated"
                      ? "bg-[color:var(--danger-bg)] text-[color:var(--danger-text)]"
                      : unclaimed.state === "withinThreshold"
                        ? "bg-[color:var(--warning-bg)] text-[color:var(--warning-text)]"
                        : "bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]"
                  }`}
                >
                  <Users aria-hidden="true" className="size-3.5" />
                  {unclaimed.state === "escalated"
                    ? `Escalated (>${thresholdMinutes}m)`
                    : unclaimed.state === "withinThreshold"
                      ? "Pending coordinator"
                      : "Assigned"}
                </span>
              </div>
              <p className="mt-2 text-2xl font-bold text-[color:var(--text-heading)]">{unclaimed.plans}</p>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-[color:var(--border)] pt-3 text-xs text-[color:var(--text-muted)]">
              <span>
                {unclaimed.oldestMinutesUnclaimed !== null
                  ? `Oldest waiting ${formatMinutesDuration(unclaimed.oldestMinutesUnclaimed)}`
                  : "No queue backlog"}
              </span>
              <Link
                href={CARING_CONTACTS_ROUTES.team}
                data-internal-link="true"
                className="inline-flex min-h-tap shrink-0 items-center gap-1 font-medium text-[color:var(--command)] hover:underline"
              >
                Team roster <ArrowRight aria-hidden="true" className="size-3" />
              </Link>
            </div>
          </div>

          {/* Card: Service Safety State */}
          <div className={`${workspacePanelPadded} flex flex-col justify-between`}>
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-[color:var(--text-muted)]">Safety state</span>
                <span
                  className={`${badgeClass} ${
                    serviceState.stopped
                      ? "bg-[color:var(--danger-bg)] text-[color:var(--danger-text)]"
                      : "bg-[color:var(--success-bg)] text-[color:var(--success-text)]"
                  }`}
                >
                  {serviceState.stopped ? (
                    <ShieldAlert aria-hidden="true" className="size-3.5" />
                  ) : (
                    <CheckCircle2 aria-hidden="true" className="size-3.5" />
                  )}
                  {serviceState.stopped ? "Stopped" : "Active"}
                </span>
              </div>
              <p className="mt-2 text-lg font-semibold text-[color:var(--text-heading)]">
                {serviceState.stopped ? "STOPPED" : "Operational"}
              </p>
            </div>
            <div className="mt-4 border-t border-[color:var(--border)] pt-3 text-xs text-[color:var(--text-muted)]">
              <span>
                {serviceState.stopped
                  ? "All dispatches held by emergency stop"
                  : counts.held > 0
                    ? `${counts.held} contacts held by plan`
                    : "Dispatches running"}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Incoming text messages (2026-09-26): patients' replies waiting for a person. */}
      {repliesToCheck !== null ? <RepliesToCheck replies={repliesToCheck} /> : null}

      {/* 2. Action Queue & Operational Review */}
      <section aria-labelledby="action-queue-heading" data-testid="caring-contacts-action-queue" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="action-queue-heading" className="text-base font-semibold text-[color:var(--text-heading)]">
            Clinical action queue
          </h2>
          <span className="text-xs text-[color:var(--text-muted)]">
            {exceptions.entries.length} to review · {dueEntries.length} due today
          </span>
        </div>

        {exceptions.entries.length === 0 && dueEntries.length === 0 ? (
          <div className={`${workspacePanelPadded} text-sm text-[color:var(--text-muted)]`}>
            No contacts require intervention or delivery today. Routine schedules are up to date.
          </div>
        ) : (
          <div className={`${workspacePanel} overflow-hidden`}>
            <div
              className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--focus)]"
              tabIndex={0}
              role="region"
              aria-label="Clinical action queue, scrolls sideways"
            >
              <table className="w-full text-left text-sm">
                <thead className="border-b border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-xs font-semibold text-[color:var(--text-muted)] uppercase tracking-wider">
                  <tr>
                    <th scope="col" className="px-4 py-3">
                      Patient ref
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Contact
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Message
                    </th>
                    <th scope="col" className="px-4 py-3">
                      State
                    </th>
                    <th scope="col" className="px-4 py-3 text-right">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--border)] bg-[color:var(--surface)]">
                  {/* Urgent exceptions first */}
                  {exceptions.entries.map((entry) => (
                    <tr key={entry.contactId} className="hover:bg-[color:var(--surface-subtle)]/50">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-medium text-[color:var(--text-heading)]">
                        {entry.patientId}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-[color:var(--text)]">
                        {entry.cadenceLabel}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-[color:var(--text-muted)]">
                        {MESSAGE_TYPE_LABELS[entry.messageType]}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`${badgeClass} bg-[color:var(--warning-bg)] text-[color:var(--warning-text)]`}>
                          <AlertCircle aria-hidden="true" className="size-3" />
                          {CONTACT_STATE_LABELS[entry.state]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={patientPlanRoute(entry.patientId, entry.planId)}
                          data-internal-link="true"
                          className="inline-flex min-h-tap items-center gap-1 whitespace-nowrap text-xs font-medium text-[color:var(--command)] hover:underline"
                        >
                          Review patient <ArrowRight aria-hidden="true" className="size-3" />
                        </Link>
                      </td>
                    </tr>
                  ))}

                  {/* Due routine contacts */}
                  {dueEntries.map((entry) => (
                    <tr key={entry.contactId} className="hover:bg-[color:var(--surface-subtle)]/50">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-medium text-[color:var(--text-heading)]">
                        {entry.patientId}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-[color:var(--text)]">
                        {entry.cadenceLabel}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-[color:var(--text-muted)]">
                        {MESSAGE_TYPE_LABELS[entry.messageType]}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`${badgeClass} bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]`}
                        >
                          <Clock aria-hidden="true" className="size-3" />
                          {outsideWindowDueIds.has(entry.contactId)
                            ? "Due outside approved window"
                            : "Due for dispatch"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={patientPlanRoute(entry.patientId, entry.planId)}
                          data-internal-link="true"
                          className="inline-flex min-h-tap items-center gap-1 whitespace-nowrap text-xs font-medium text-[color:var(--command)] hover:underline"
                        >
                          View plan <ArrowRight aria-hidden="true" className="size-3" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* 3. Team Caseload & Workload Distribution */}
      <section
        aria-labelledby="caseload-workload-heading"
        data-testid="caring-contacts-team-caseload"
        className="space-y-4"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="caseload-workload-heading" className="text-base font-semibold text-[color:var(--text-heading)]">
            Team caseload and work distribution
          </h2>
          <Link
            href={CARING_CONTACTS_ROUTES.team}
            data-internal-link="true"
            className="inline-flex items-center gap-1 text-xs font-medium text-[color:var(--command)] hover:underline"
          >
            Full workload roster <ArrowRight aria-hidden="true" className="size-3" />
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className={`${workspacePanelPadded} flex items-center gap-4`}>
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]">
              <UserCheck aria-hidden="true" className="size-5" />
            </span>
            <div>
              <p className="text-xs font-medium text-[color:var(--text-muted)]">Active coordinators</p>
              <p className="text-xl font-bold text-[color:var(--text-heading)]">{coordinators.length}</p>
            </div>
          </div>

          <div className={`${workspacePanelPadded} flex items-center gap-4`}>
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]">
              <Users aria-hidden="true" className="size-5" />
            </span>
            <div>
              <p className="text-xs font-medium text-[color:var(--text-muted)]">Active patient caseload</p>
              <p className="text-xl font-bold text-[color:var(--text-heading)]">{totalActivePlans}</p>
            </div>
          </div>

          <div className={`${workspacePanelPadded} flex items-center gap-4`}>
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]">
              <AlertTriangle aria-hidden="true" className="size-5" />
            </span>
            <div>
              <p className="text-xs font-medium text-[color:var(--text-muted)]">Held / safety pauses</p>
              <p className="text-xl font-bold text-[color:var(--text-heading)]">{totalHeldPlans}</p>
            </div>
          </div>
        </div>

        {/* Coordinators table if assigned */}
        {coordinators.length > 0 && (
          <div className={`${workspacePanel} overflow-hidden`}>
            <div
              className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--focus)]"
              tabIndex={0}
              role="region"
              aria-label="Coordinator workload, scrolls sideways"
            >
              <table className="w-full text-left text-sm">
                <thead className="border-b border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-xs font-semibold text-[color:var(--text-muted)]">
                  <tr>
                    <th scope="col" className="px-4 py-2.5">
                      Coordinator
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-center">
                      Active plans
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-center">
                      Held plans
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-center">
                      Backlog
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--border)] bg-[color:var(--surface)] text-xs">
                  {coordinators.map((c) => (
                    <tr key={c.actorId} className="hover:bg-[color:var(--surface-subtle)]/50">
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[color:var(--text-heading)]">
                        {c.actorId}
                      </td>
                      <td className="px-4 py-2.5 text-center font-medium">{c.activePlans}</td>
                      <td className="px-4 py-2.5 text-center text-[color:var(--text-muted)]">
                        {c.heldPlans.reduce((sum, h) => sum + h.plans, 0)}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {c.exceptionBacklog.contacts > 0 ? (
                          <span className="font-semibold text-[color:var(--warning-text)]">
                            {c.exceptionBacklog.contacts}
                          </span>
                        ) : (
                          <span className="text-[color:var(--text-muted)]">0</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Quick entry links. "New plan" is not repeated here (the header carries it); only the empty-state card offers it again as its next step. */}
      <section aria-label="Workspace shortcuts" className="flex flex-wrap items-center gap-3 pt-2">
        <Link href={CARING_CONTACTS_ROUTES.patients} data-internal-link="true" className={floatingControl}>
          <Users aria-hidden="true" className="size-icon-sm shrink-0" />
          <span>Patients</span>
        </Link>
        <Link href={CARING_CONTACTS_ROUTES.schedule} data-internal-link="true" className={floatingControl}>
          <Calendar aria-hidden="true" className="size-icon-sm shrink-0" />
          <span>Schedule</span>
        </Link>
        <Link href={CARING_CONTACTS_ROUTES.intake} data-internal-link="true" className={floatingControl}>
          <FilePlus aria-hidden="true" className="size-icon-sm shrink-0" />
          <span>Referral intake</span>
        </Link>
      </section>
    </div>
  );
}
