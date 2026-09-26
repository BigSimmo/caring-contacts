import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { notFound } from "next/navigation";

import {
  parseScheduleDay,
  scheduleDayWasNotUnderstood,
  ScheduleScreen,
  SCHEDULE_STRIP_DAYS,
  SCHEDULE_STRIP_DAYS_BEFORE,
} from "@/components/caring-contacts/workspace/schedule-screen";
import { auditedRead } from "@/lib/caring-contacts-server/handler";
import { isCaringContactsWorkspaceEnabled, resolveCaringContactsActor } from "@/lib/caring-contacts-server/session";
import { caringContactsStore } from "@/lib/caring-contacts-server/store";
import { awstCalendarDay, awstCalendarDayOffset, systemClock } from "@/lib/caring-contacts/clock";
import { canPerformCaringContactAction } from "@/lib/caring-contacts/permissions";
import { READ_ACTIONS, type PlanRecord } from "@/lib/caring-contacts/repository";
import { buildScheduleRange } from "@/lib/caring-contacts/schedule-view";
import type { ServiceState } from "@/lib/caring-contacts/service-state";

/**
 * The workspace's lazy route boundary (Ruling 13). Same spelling and same reason as
 * `src/app/caring-contacts/page.tsx`: nothing outside this route segment imports the workspace, and
 * dynamically importing the shell keeps the Client Components beneath it out of the PsychSift
 * dashboard's chunks. See that file's module note for the argument in full.
 */
const CaringContactsShell = dynamic(() =>
  import("@/components/caring-contacts/workspace/shell").then((module) => module.CaringContactsShell),
);

/** The browser tab reads "Schedule · Caring Contacts" through the layout's title template. */
export const metadata: Metadata = { title: "Schedule" };

/**
 * The team's schedule -- what its caring-contact plans put on one AWST day.
 *
 * ONE READ FEEDS THE WHOLE SCREEN. `buildScheduleRange` is asked for the strip, and the day being
 * looked at is one of the days it returned. There is deliberately no second call for "the selected
 * day": two calls would be two places for the grouping to be applied, and a strip that disagreed
 * with the day open beneath it is exactly the kind of quiet inconsistency a schedule cannot afford.
 *
 * NOTHING IS DERIVED HERE EITHER. The windows, the holds, the exceptions, the counts and the
 * disposition all come out of the sealed domain. This page resolves WHO is asking, WHEN "today" is,
 * and WHICH days to ask about, and hands the answer to the screen.
 *
 * THE ACCESS TRAIL RECORDS THE QUESTION, NOT THE MECHANISM. The store read is `listPlans`, but the
 * event is `{ search, contactSchedule, "<from>:<to>" }` -- byte for byte the identity
 * `src/app/api/caring-contacts/schedule/route.ts` records for the same question. Recording it as
 * `plan` would be defensible by provenance and wrong by meaning: the trail has no `objectId` filter,
 * so a caseload read and a schedule read sharing a member would become one undifferentiated stream,
 * and "which days did this clinician look at" would stop being answerable. Ruling 46, Ruling [125].
 *
 * IT READS NO PATIENT NAME, and that is a decision rather than something forgotten. The caseload
 * reads `listPatientNames` (Ruling 91) because recognising your own patients is the whole job of a
 * caseload. A schedule answers a different question -- what does the service send today, and what
 * needs a person -- and it is a working view a coordinator returns to through the day. Folding an
 * identity-bearing read into it would put a `patientName` row in the trail every time somebody
 * glanced at a day, which is the opposite of what that row is for: it exists so "who read patients'
 * names, and when" has a short, meaningful answer. Every row instead carries the synthetic
 * identifier and links to the patient record, which holds the name and is audited for reading it.
 * The approved mockup shows names on this screen; that difference is recorded in the task report
 * rather than resolved here.
 *
 * Every bad outcome fails closed and reaches `error.tsx`, which says nothing was sent and nothing
 * was changed. Neither read has an honest fallback: a schedule rendered beside a service-state read
 * that failed would claim sending is running during an incident, and a schedule rendered from a
 * failed read of its own contents would claim a day that was never read.
 *
 * AN EMPTY DAY IS NOT A MISSING RESOURCE. `listPlans` returns an array for every actor -- empty
 * where nothing is visible -- so `auditedRead`'s null-means-denied mapping is not a reachable
 * outcome for it, and a team with no plans renders the empty STATE on the success path. The only
 * `notFound()` on this page is the production demo lock, which is a different fact entirely.
 *
 * `searchParams` is a promise in Next 16 and is awaited before use. Reading it makes the route
 * dynamic, which is already true here -- the role cookie does the same -- and is correct: a cached
 * copy of a schedule would outlive the schedule.
 */
export default async function CaringContactsSchedulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isCaringContactsWorkspaceEnabled()) notFound();
  const actor = await resolveCaringContactsActor();
  const store = await caringContactsStore();

  // "Today" is ambient time and is resolved here, at the edge, for the same reason
  // `schedule/route.ts` resolves it there: the domain takes the day as an argument precisely so it
  // never reaches for a clock of its own. `systemClock()` is this seam's clock.
  const now = systemClock().now();
  const todayCalendarDay = awstCalendarDay(now);
  const requested = await searchParams;
  const selectedCalendarDay = parseScheduleDay(requested, todayCalendarDay);
  const dayNotUnderstood = scheduleDayWasNotUnderstood(requested);
  const fromCalendarDay = awstCalendarDayOffset(selectedCalendarDay, -SCHEDULE_STRIP_DAYS_BEFORE);
  const toCalendarDay = awstCalendarDayOffset(fromCalendarDay, SCHEDULE_STRIP_DAYS - 1);

  // "service" names the one service-wide record, matching the object id the API route records
  // against -- the access trail needs one stable identifier for it, not a per-caller one.
  const serviceStateRead = await auditedRead<ServiceState>(
    store,
    actor,
    { kind: "administrative", objectType: "serviceState", objectId: "service" },
    () => store.getServiceState({ actor }),
  );
  if (serviceStateRead.outcome === "failed") {
    throw serviceStateRead.error instanceof Error
      ? serviceStateRead.error
      : new Error("Failed to read the service state.");
  }
  if (!serviceStateRead.recorded) {
    throw new Error("Caring Contacts access trail is unavailable; nothing was rendered.");
  }
  if (serviceStateRead.released === null) {
    throw new Error("caring-contacts service state read returned no record.");
  }
  const serviceState = serviceStateRead.released;

  const scheduleRead = await auditedRead<PlanRecord[]>(
    store,
    actor,
    { kind: "search", objectType: "contactSchedule", objectId: `${fromCalendarDay}:${toCalendarDay}` },
    () => store.listPlans({ actor }),
  );
  if (scheduleRead.outcome === "failed") {
    throw scheduleRead.error instanceof Error ? scheduleRead.error : new Error("Failed to read this team's schedule.");
  }
  if (!scheduleRead.recorded) {
    throw new Error("Caring Contacts access trail is unavailable; nothing was rendered.");
  }
  // `== null`, deliberately: `auditedRead` treats null OR UNDEFINED as denied while typing
  // `released` as `T | null`, so a `=== null` guard would let a store that broke `listPlans`'s
  // array contract through to fail somewhere less legible. `?? []` would be the wrong statement
  // here in the one case the branch exists for -- it would render "no contacts on this day" from an
  // answer that was never given.
  if (scheduleRead.released == null) {
    throw new Error("caring-contacts schedule read returned no list.");
  }

  const range = buildScheduleRange(scheduleRead.released, fromCalendarDay, toCalendarDay, now);
  // Unreachable: `awstCalendarDayOffset` produces real AWST calendar days and the strip is shorter
  // than `SCHEDULE_RANGE_MAX_DAYS`, so every refusal this call can give is about a range this page
  // cannot construct. Stated correctly anyway, because a branch that cannot run is still read --
  // and the wrong statement here would be an empty view, which renders as a quiet week.
  if (!range.ok) {
    throw new Error(`caring-contacts schedule read refused: ${range.reason}`);
  }

  const mayViewPlans = canPerformCaringContactAction(actor, READ_ACTIONS.plan, { teamId: actor.teamId }).allowed;
  // Asked of the sealed domain, with the action the STORE itself checks for a within-day move --
  // never a broader stand-in, and never a list of roles written here. It decides whether the control
  // is offered at all; the control rechecks it at the moment a move is confirmed, because a role can
  // change while a confirmation sits open.
  const mayMoveContactWithinDay = canPerformCaringContactAction(actor, "moveContactWithinDay", {
    teamId: actor.teamId,
  }).allowed;

  return (
    <CaringContactsShell
      title="Schedule"
      description="Contacts due, day by day, in the approved sending windows. Every patient, number and message in this workspace is invented; nothing here is ever sent to a real number."
      serviceState={serviceState}
    >
      <ScheduleScreen
        view={range.view}
        selectedCalendarDay={selectedCalendarDay}
        todayCalendarDay={todayCalendarDay}
        mayViewPlans={mayViewPlans}
        acting={{ actorId: actor.id, teamId: actor.teamId, mayMoveContactWithinDay }}
        dayNotUnderstood={dayNotUnderstood}
      />
    </CaringContactsShell>
  );
}
