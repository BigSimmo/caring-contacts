import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { notFound } from "next/navigation";

import { TeamRoster } from "@/components/caring-contacts/workspace/team-roster";
import { auditedRead } from "@/lib/caring-contacts-server/handler";
import { isCaringContactsWorkspaceEnabled, resolveCaringContactsActor } from "@/lib/caring-contacts-server/session";
import { caringContactsStore } from "@/lib/caring-contacts-server/store";
import { systemClock } from "@/lib/caring-contacts/clock";
import { canPerformCaringContactAction } from "@/lib/caring-contacts/permissions";
import { READ_ACTIONS } from "@/lib/caring-contacts/repository";
import type { ServiceState } from "@/lib/caring-contacts/service-state";
import {
  buildTeamWorkload,
  unclaimedPlanQueue,
  type PlanOwnership,
  type TeamWorkloadView,
  type UnclaimedPlanEntry,
} from "@/lib/caring-contacts/team-workload";

/**
 * The workspace's lazy route boundary (Ruling 13). Same spelling and same reason as
 * `src/app/caring-contacts/page.tsx` and every other screen in this segment: nothing outside this
 * route segment imports the workspace, and dynamically importing the shell keeps the Client
 * Components beneath it out of the PsychSift dashboard's chunks. That file's module note carries
 * the argument in full; one copy of it is the source of truth and two copies would drift.
 */
const CaringContactsShell = dynamic(() =>
  import("@/components/caring-contacts/workspace/shell").then((module) => module.CaringContactsShell),
);

/** The browser tab reads "Team · Caring Contacts" through the layout's title template. */
export const metadata: Metadata = { title: "Team" };

/**
 * The team screen -- where this team's caring-contact work is sitting (Phase 2B Task 18).
 *
 * EVERY READ IS AUDITED, AND NONE OF THEM IS HTTP. `GET /api/caring-contacts/team` publishes
 * exactly this answer, but this page is a Server Component and rolls it up from the store directly,
 * as the caseload, the schedule and the templates library already do. Going over HTTP from a render
 * would add a network hop, a second copy of the failure handling, and an access trail that recorded
 * the server calling itself.
 *
 * THE ROLL-UP IS NOT REPEATED HERE. `buildTeamWorkload` is the one answer, in the sealed domain,
 * and both readers ask it -- which is the whole reason Task 17 put it there rather than in the
 * route. This page resolves WHO is asking and WHEN "now" is, joins the two reads the domain takes
 * as input, and hands the result to the screen. It derives nothing: the escalation threshold, the
 * two ages, who is actually answering for a plan, whether a plan's own state holds it, and which
 * contacts somebody has to look at are all the domain's.
 *
 * THE ACCESS TRAIL RECORDS THE QUESTION, NOT THE MECHANISM. The store reads are `listPlans` and one
 * `getAssignment` per plan, but the event is `{ search, teamWorkload, "all" }` -- byte for byte the
 * identity `src/app/api/caring-contacts/team/route.ts` records for the same question, and the
 * member Task 17 added deliberately. Recording it as `plan` would drop "who looked at how work is
 * distributed across the team" into the caseload's stream, and the trail has no `objectId` filter,
 * so it could then be picked out by eye and never asked for. Ruling 46, Ruling [125], Ruling [134].
 *
 * IT READS NO PATIENT RECORD AND NAMES NO PATIENT. `getEpisode` and `listPatientNames` are never
 * called, and nothing the roll-up returns carries a patient, plan or contact id -- a roster needs
 * no patient and must not be a route to one.
 *
 * IT TAKES NO PARAMETERS AT ALL. There is nothing to ask this screen about: it answers for the
 * actor's own team, whole. So no `searchParams` is read, nothing about a patient can travel in a
 * query string, and the route is dynamic for the role cookie alone.
 *
 * Every bad outcome fails closed and reaches `error.tsx`, which says nothing was sent and nothing
 * was changed. Neither read has an honest fallback: a roster rendered beside a service-state read
 * that failed would claim sending is running during an incident, and a roster rendered from a
 * failed read of its own contents would claim that nobody is waiting for a coordinator -- on the
 * one screen whose subject is whether anyone is answering for a discharged patient's plan.
 *
 * AN EMPTY ROSTER IS NOT A MISSING RESOURCE. `auditedRead` maps a `null`/`undefined` release to
 * `denied`; the roll-up always returns a view, so a team carrying nothing renders the empty STATE
 * on the success path and `notFound()` is never reached. The only `notFound()` here is the
 * production demo lock, which is a different fact entirely.
 *
 * WHICH IS WHY BOTH CAPABILITIES ARE DECIDED HERE. `listPlans` answers a role without
 * `viewReferral` with `[]`, exactly as it answers a team carrying nothing -- so a screen that only
 * counted rows would tell an auditor their team is idle, which is a false statement about a
 * clinical service. And `reassignPlan` decides whether the reassignment control is offered at all;
 * the surface it leads to rechecks it, because a role can change while a screen is open.
 *
 * WHAT THIS SCREEN DOES NOT SHOW, and in each case because nothing in this system holds it: a
 * member of staff's name, anybody's role but the acting user's, and a per-person unclaimed figure.
 * `team-roster.tsx`'s module note carries each one; all three are Task 17 findings reported to the
 * owner rather than gaps a screen filled in.
 */
export default async function CaringContactsTeamPage() {
  if (!isCaringContactsWorkspaceEnabled()) notFound();
  const actor = await resolveCaringContactsActor();
  const store = await caringContactsStore();

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

  // `"all"` is the object id a collection read names -- the actor's own team scopes what comes
  // back, so there is no single object to name. Identical to `api/caring-contacts/team/route.ts`.
  // `TeamWorkloadView | null`, and the `null` is deliberate rather than defensive typing: the read
  // below releases one when the store breaks `listPlans`'s array contract, and `auditedRead` maps a
  // null release to `denied`. Typing it away would force a cast at exactly the point the guard
  // exists for.
  //
  // The same read also yields the unclaimed plans a coordinator can claim from here (owner decision
  // 2026-09-26). It is one question -- where is the team's work sitting -- so it stays one access
  // event; the list carries each plan's synthetic identifier for the claim and nothing about a patient.
  const teamRead = await auditedRead<{ view: TeamWorkloadView; queue: readonly UnclaimedPlanEntry[] } | null>(
    store,
    actor,
    { kind: "search", objectType: "teamWorkload", objectId: "all" },
    async () => {
      const records = await store.listPlans({ actor });
      // A store that broke `listPlans`'s array contract must not be laundered into an empty roster.
      // A `?? []` here would render "Nobody is carrying work" from an answer that was never given,
      // so the broken contract is released as `null` and refused by the guard below.
      if (records == null) return null;
      // Stated rather than hidden: one assignment read per listed plan. Both reads are already
      // team-scoped and the assignment read gates on exactly the predicate `listPlans` filters by,
      // so the scoping comes free from reads that are already scoped. If the join becomes the wrong
      // trade the fix is a repository method returning the pairs, which is a contract change with
      // its own review -- not a second aggregation here.
      const ownership: PlanOwnership[] = await Promise.all(
        records.map(async (record) => ({
          record,
          assignment: await store.getAssignment(record.plan.id, { actor }),
        })),
      );
      const asAt = systemClock().now();
      return { view: buildTeamWorkload(ownership, asAt), queue: unclaimedPlanQueue(ownership, asAt) };
    },
  );
  if (teamRead.outcome === "failed") {
    throw teamRead.error instanceof Error ? teamRead.error : new Error("Failed to read this team's workload.");
  }
  if (!teamRead.recorded) {
    throw new Error("Caring Contacts access trail is unavailable; nothing was rendered.");
  }
  // `== null`, deliberately, and the same loose equality the other screens' guards use for the same
  // reason: `auditedRead` treats null AND UNDEFINED as denied while typing `released` as
  // `T | null`, so a `=== null` guard would let a contract-breaking `undefined` through to fail
  // somewhere less legible.
  if (teamRead.released == null) {
    throw new Error("caring-contacts team read returned no roster.");
  }
  const { view, queue } = teamRead.released;

  const mayViewPlans = canPerformCaringContactAction(actor, READ_ACTIONS.plan, { teamId: actor.teamId }).allowed;
  // Asked of the sealed domain, with the action the STORE itself checks for a reassignment -- never
  // a broader stand-in, and never a list of roles written here.
  const mayReassignPlan = canPerformCaringContactAction(actor, "reassignPlan", { teamId: actor.teamId }).allowed;
  // Claiming is gated where the service gates it: `claimPlan`, for this team.
  const mayClaimPlan = canPerformCaringContactAction(actor, "claimPlan", { teamId: actor.teamId }).allowed;

  return (
    <CaringContactsShell
      title="Team"
      description="Where this team's caring-contact work is sitting: what each coordinator is carrying, and what nobody has claimed yet. Every patient, number and message in this workspace is invented; nothing here is ever sent to a real number."
      serviceState={serviceState}
    >
      <TeamRoster
        view={view}
        mayViewPlans={mayViewPlans}
        mayReassignPlan={mayReassignPlan}
        claim={mayClaimPlan ? { entries: queue, actingActorId: actor.id } : undefined}
      />
    </CaringContactsShell>
  );
}
