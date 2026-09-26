import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { notFound } from "next/navigation";

import { TodayDashboard } from "@/components/caring-contacts/workspace/today-dashboard";
import { auditedRead } from "@/lib/caring-contacts-server/handler";
import { isCaringContactsWorkspaceEnabled, resolveCaringContactsActor } from "@/lib/caring-contacts-server/session";
import { caringContactsStore } from "@/lib/caring-contacts-server/store";
import { awstCalendarDay, systemClock } from "@/lib/caring-contacts/clock";
import { canPerformCaringContactAction } from "@/lib/caring-contacts/permissions";
import { READ_ACTIONS, type PlanRecord } from "@/lib/caring-contacts/repository";
import { buildScheduleRange } from "@/lib/caring-contacts/schedule-view";
import type { ServiceState } from "@/lib/caring-contacts/service-state";
import { buildTeamWorkload, type PlanOwnership, type TeamWorkloadView } from "@/lib/caring-contacts/team-workload";

const CaringContactsShell = dynamic(() =>
  import("@/components/caring-contacts/workspace/shell").then((module) => module.CaringContactsShell),
);

/** The browser tab reads "Today · Caring Contacts" through the layout's title template. */
export const metadata: Metadata = { title: "Today" };

export default async function CaringContactsTodayPage() {
  if (!isCaringContactsWorkspaceEnabled()) notFound();
  const actor = await resolveCaringContactsActor();
  const store = await caringContactsStore();

  const now = systemClock().now();
  const todayCalendarDay = awstCalendarDay(now);

  // "service" names the one service-wide record, matching the object id the API route's
  // `GET`/`POST` on `/api/caring-contacts/service-state` records the same read and writes
  // against — the access trail needs one stable identifier for it, not a per-caller one.
  const { outcome, recorded, released, error } = await auditedRead<ServiceState>(
    store,
    actor,
    { kind: "administrative", objectType: "serviceState", objectId: "service" },
    () => store.getServiceState({ actor }),
  );
  if (outcome === "failed") throw error instanceof Error ? error : new Error("Failed to read the service state.");
  if (!recorded) throw new Error("Caring Contacts access trail is unavailable; nothing was rendered.");
  if (released === null) throw new Error("caring-contacts service state read returned no record.");
  const serviceState = released;

  // Read the day's schedule through the audited seam
  const scheduleRead = await auditedRead<PlanRecord[]>(
    store,
    actor,
    { kind: "search", objectType: "contactSchedule", objectId: `${todayCalendarDay}:${todayCalendarDay}` },
    () => store.listPlans({ actor }),
  );
  if (scheduleRead.outcome === "failed") {
    throw scheduleRead.error instanceof Error ? scheduleRead.error : new Error("Failed to read this team's schedule.");
  }
  if (!scheduleRead.recorded) {
    throw new Error("Caring Contacts access trail is unavailable; nothing was rendered.");
  }
  if (scheduleRead.released == null) {
    throw new Error("caring-contacts schedule read returned no list.");
  }

  const plans = scheduleRead.released;
  const range = buildScheduleRange(plans, todayCalendarDay, todayCalendarDay, now);
  if (!range.ok) {
    throw new Error(`caring-contacts schedule read refused: ${range.reason}`);
  }

  // `listPlans` answers a role without READ_ACTIONS.plan with `[]`, same as a team holding none.
  // Publishing those zeros as "Contacts Due Today" / "Active Caseload" would turn a denied read
  // into an authoritative empty caseload. The schedule page asks the same question and withholds
  // the view; this front door does the same rather than inventing a second empty-state spelling.
  const mayViewPlans = canPerformCaringContactAction(actor, READ_ACTIONS.plan, { teamId: actor.teamId }).allowed;

  // Read team workload distribution
  const teamRead = await auditedRead<TeamWorkloadView | null>(
    store,
    actor,
    { kind: "search", objectType: "teamWorkload", objectId: "all" },
    async () => {
      const records = scheduleRead.released;
      if (records == null) return null;
      const ownerships: PlanOwnership[] = await Promise.all(
        records.map(async (record) => ({
          record,
          assignment: await store.getAssignment(record.plan.id, { actor }),
        })),
      );
      return buildTeamWorkload(ownerships, now);
    },
  );
  if (teamRead.outcome === "failed") {
    throw teamRead.error instanceof Error ? teamRead.error : new Error("Failed to read team workload.");
  }
  if (!teamRead.recorded) {
    throw new Error("Caring Contacts access trail is unavailable; nothing was rendered.");
  }
  if (teamRead.released == null) {
    throw new Error("caring-contacts team workload read returned no view.");
  }

  const scheduleDay = range.view.days[0];
  const teamWorkload = teamRead.released;

  return (
    <CaringContactsShell
      title="Today"
      description="The day's caring-contact work for this team. Every patient, number and message in this workspace is invented; nothing here is ever sent to a real number."
      serviceState={serviceState}
    >
      <TodayDashboard
        scheduleDay={scheduleDay}
        teamWorkload={teamWorkload}
        serviceState={serviceState}
        todayCalendarDay={todayCalendarDay}
        mayViewPlans={mayViewPlans}
      />
    </CaringContactsShell>
  );
}
