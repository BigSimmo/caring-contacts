import { formatMinutesDuration } from "@/lib/caring-contacts/duration-display";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FilePlus,
  Plus,
  ShieldAlert,
  UserCheck,
  Users,
  type LucideIcon,
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
      {/* 1. Urgent triage: four cards built from one shape, so their figures and footers line up. */}
      <section aria-labelledby="triage-bar-heading" data-testid="caring-contacts-urgent-triage" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="triage-bar-heading" className="text-base font-semibold text-[color:var(--text-heading)]">
            Clinical triage status
          </h2>
          <span className="text-xs text-[color:var(--text-muted)]">
            AWST day: <time dateTime={todayCalendarDay}>{todayCalendarDay}</time>
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <TriageCard
            label="Due today"
            value={counts.due}
            badge={{
              tone: serviceState.stopped ? "danger" : counts.due > 0 ? "accent" : "neutral",
              icon: Clock,
              text: serviceState.stopped ? "Dispatch stopped" : counts.due > 0 ? "Dispatch ready" : "None due",
            }}
            footnote={windows.length > 0 ? `Windows: ${windows.map((w) => w.label).join(" · ")}` : "No sending windows"}
            link={{ href: scheduleDayRoute(todayCalendarDay), label: "Schedule" }}
          />

          <TriageCard
            label="Needs review"
            value={reviewBacklog}
            badge={{
              tone: reviewBacklog > 0 ? "warning" : "neutral",
              icon: AlertTriangle,
              text: reviewBacklog > 0 ? "Exceptions" : "Clear",
            }}
            footnote={`Failed, missed or invalid numbers, on any day${
              counts.needsReview > 0 ? ` (${counts.needsReview} today)` : ""
            }`}
            link={reviewBacklog > 0 ? { href: CARING_CONTACTS_ROUTES.team, label: "Team roster" } : null}
          />

          <TriageCard
            label="Unclaimed cases"
            value={unclaimed.plans}
            badge={{
              tone:
                unclaimed.state === "escalated"
                  ? "danger"
                  : unclaimed.state === "withinThreshold"
                    ? "warning"
                    : "neutral",
              icon: Users,
              text:
                unclaimed.state === "escalated"
                  ? `Escalated (>${thresholdMinutes}m)`
                  : unclaimed.state === "withinThreshold"
                    ? "Pending coordinator"
                    : "Assigned",
            }}
            footnote={
              unclaimed.oldestMinutesUnclaimed !== null
                ? `Oldest waiting ${formatMinutesDuration(unclaimed.oldestMinutesUnclaimed)}`
                : "No queue backlog"
            }
            link={{ href: CARING_CONTACTS_ROUTES.team, label: "Team roster" }}
          />

          {/*
            The safety card links to the service stop screen whatever the state: while sending runs
            it is where a stop is raised, and once stopped it is where the restart approvals are.
            On a phone this is the nearest route to that control, which otherwise sits in More.
          */}
          <TriageCard
            label="Safety state"
            value={serviceState.stopped ? "Stopped" : "Operational"}
            badge={{
              tone: serviceState.stopped ? "danger" : "success",
              icon: serviceState.stopped ? ShieldAlert : CheckCircle2,
              text: serviceState.stopped ? "Stopped" : "Active",
            }}
            footnote={
              serviceState.stopped
                ? "All dispatches held by emergency stop"
                : counts.held > 0
                  ? `${counts.held} contacts held by plan`
                  : "Dispatches running"
            }
            link={{ href: CARING_CONTACTS_ROUTES.serviceStop, label: "Service stop" }}
          />
        </div>
      </section>

      {/* Incoming text messages (2026-09-26): patients' replies waiting for a person. */}
      {repliesToCheck !== null ? <RepliesToCheck replies={repliesToCheck} /> : null}

      {/* 2. Action queue. */}
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
          /*
            A list rather than a sideways-scrolling table. On a phone the table hid its Action
            column off-screen, so the one control each row exists for was the thing a reader could
            not see. Each row is a card on a phone and lines up under the column labels from `md`.
          */
          <div className={`${workspacePanel} overflow-hidden`}>
            <div
              aria-hidden="true"
              className="hidden border-b border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)] md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto] md:gap-4"
            >
              <span>Patient ref</span>
              <span>Contact</span>
              <span>Message</span>
              <span>State</span>
              <span className="text-right">Action</span>
            </div>
            <ul
              aria-label="Contacts to act on"
              className="divide-y divide-[color:var(--border)] bg-[color:var(--surface)]"
            >
              {/* Urgent exceptions first */}
              {exceptions.entries.map((entry) => (
                <ActionQueueRow
                  key={entry.contactId}
                  entry={entry}
                  badge={{ tone: "warning", icon: AlertCircle, text: CONTACT_STATE_LABELS[entry.state] }}
                  linkLabel="Review patient"
                />
              ))}
              {/* Due routine contacts */}
              {dueEntries.map((entry) => (
                <ActionQueueRow
                  key={entry.contactId}
                  entry={entry}
                  badge={{
                    tone: "accent",
                    icon: Clock,
                    text: outsideWindowDueIds.has(entry.contactId) ? "Due outside approved window" : "Due for dispatch",
                  }}
                  linkLabel="View plan"
                />
              ))}
            </ul>
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
            className="inline-flex min-h-tap items-center gap-1 text-xs font-medium text-[color:var(--command)] hover:underline"
          >
            Full workload roster <ArrowRight aria-hidden="true" className="size-icon-xs" />
          </Link>
        </div>

        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          <div className={`${workspacePanelPadded} flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4`}>
            <span className="hidden size-10 shrink-0 place-items-center rounded-full bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)] sm:grid">
              <UserCheck aria-hidden="true" className="size-icon-lg" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium text-[color:var(--text-muted)]">Active coordinators</p>
              <p className="text-xl font-bold text-[color:var(--text-heading)]">{coordinators.length}</p>
            </div>
          </div>

          <div className={`${workspacePanelPadded} flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4`}>
            <span className="hidden size-10 shrink-0 place-items-center rounded-full bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)] sm:grid">
              <Users aria-hidden="true" className="size-icon-lg" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium text-[color:var(--text-muted)]">Active patient caseload</p>
              <p className="text-xl font-bold text-[color:var(--text-heading)]">{totalActivePlans}</p>
            </div>
          </div>

          <div className={`${workspacePanelPadded} flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4`}>
            <span className="hidden size-10 shrink-0 place-items-center rounded-full bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)] sm:grid">
              <AlertTriangle aria-hidden="true" className="size-icon-lg" />
            </span>
            <div className="min-w-0">
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
    </div>
  );
}

type BadgeTone = "accent" | "warning" | "danger" | "success" | "neutral";

const BADGE_TONES: Readonly<Record<BadgeTone, string>> = {
  accent: "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
  warning: "bg-[color:var(--warning-bg)] text-[color:var(--warning-text)]",
  danger: "bg-[color:var(--danger-bg)] text-[color:var(--danger-text)]",
  success: "bg-[color:var(--success-bg)] text-[color:var(--success-text)]",
  neutral: "bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]",
};

type Badge = { tone: BadgeTone; icon: LucideIcon; text: string };

function StatusBadge({ badge }: { badge: Badge }) {
  const Icon = badge.icon;
  return (
    <span className={`${badgeClass} ${BADGE_TONES[badge.tone]}`}>
      <Icon aria-hidden="true" className="size-icon-sm shrink-0" />
      {badge.text}
    </span>
  );
}

const cardLinkClass =
  "inline-flex min-h-tap shrink-0 items-center gap-1 font-medium text-[color:var(--command)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

/**
 * One triage card. The label, the figure and the badge sit in a fixed order and the footer is
 * pushed to the bottom, so four cards side by side keep their figures and footers on one line even
 * when one badge is longer than the others (the unclaimed card's used to wrap under its label and
 * push its figure down a row).
 */
function TriageCard({
  label,
  value,
  badge,
  footnote,
  link,
}: {
  label: string;
  value: number | string;
  badge: Badge;
  footnote: string;
  link: { href: string; label: string } | null;
}) {
  return (
    <div className={`${workspacePanelPadded} flex min-w-0 flex-col`}>
      <span className="text-xs font-medium text-[color:var(--text-muted)]">{label}</span>
      <p
        className={`mt-1 font-bold text-[color:var(--text-heading)] ${
          typeof value === "number" ? "text-2xl" : "text-xl"
        }`}
      >
        {value}
      </p>
      <div className="mb-4 mt-2">
        <StatusBadge badge={badge} />
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-[color:var(--border)] pt-3 text-xs text-[color:var(--text-muted)]">
        <span className="min-w-0">{footnote}</span>
        {link === null ? null : (
          <Link href={link.href} data-internal-link="true" className={cardLinkClass}>
            {link.label} <ArrowRight aria-hidden="true" className="size-icon-xs" />
          </Link>
        )}
      </div>
    </div>
  );
}

/** One contact in the action queue: a card on a phone, a row under the column labels from `md`. */
function ActionQueueRow({ entry, badge, linkLabel }: { entry: ScheduleEntry; badge: Badge; linkLabel: string }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 hover:bg-[color:var(--surface-subtle)]/50 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto]">
      <span className="min-w-0 break-all font-mono text-xs font-medium text-[color:var(--text-heading)]">
        {entry.patientId}
      </span>
      <span className="text-sm text-[color:var(--text)] max-md:col-start-1 max-md:row-start-2">
        {entry.cadenceLabel}
        <span className="text-xs text-[color:var(--text-muted)] md:hidden">
          {" "}
          · {MESSAGE_TYPE_LABELS[entry.messageType]}
        </span>
      </span>
      <span className="hidden text-xs text-[color:var(--text-muted)] md:block">
        {MESSAGE_TYPE_LABELS[entry.messageType]}
      </span>
      <span className="min-w-0 max-md:col-start-1 max-md:row-start-3">
        <StatusBadge badge={badge} />
      </span>
      <Link
        href={patientPlanRoute(entry.patientId, entry.planId)}
        data-internal-link="true"
        className={`${cardLinkClass} justify-end whitespace-nowrap text-xs max-md:col-start-2 max-md:row-span-3 max-md:row-start-1`}
      >
        {linkLabel} <ArrowRight aria-hidden="true" className="size-icon-xs" />
      </Link>
    </li>
  );
}
