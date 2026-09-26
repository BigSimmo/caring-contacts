// src/app/api/caring-contacts/team/route.ts
//
// Where the team's work is sitting -- the read behind the Team screen (Phase 2B Task 17).
//
// IT ADDS NO REPOSITORY METHOD AND NO RULE. The reads are `listPlans` and, per plan,
// `getAssignment` -- both already team-scoped and both already API-wired -- and
// `buildTeamWorkload` in the sealed domain does the rest. The scoping is therefore the scoping
// those two reads already have and is not widened here: the assignment read is gated on exactly
// the predicate `listPlans` filters by, so a plan invisible to one is invisible to the other.
//
// The N+1 join is deliberate and stated rather than hidden. One assignment read per listed plan is
// what the contract offers today; if it becomes the wrong trade the fix is a repository method
// returning the pairs, which is a contract change with its own review (Ruling [124]'s shape).
//
// IT TAKES NO PARAMETERS AT ALL. There is nothing to ask this read about -- it answers for the
// actor's own team, whole -- so no query string is parsed and none can reach the store, the body or
// the audit `objectId`. That is also why nothing about a patient can travel in one.
//
// It records its own object type, `teamWorkload`, rather than the caseload's `plan`; the reasoning
// is on that member in `access-audit.ts`. The access event is recorded by `readHandler`, on every
// call, as it is for every other read.
import type { NextRequest } from "next/server";

import { readHandler } from "@/lib/caring-contacts-server/handler";
import { systemClock } from "@/lib/caring-contacts/clock";
import { buildTeamWorkload, type PlanOwnership, type TeamWorkloadView } from "@/lib/caring-contacts/team-workload";

export const runtime = "nodejs";

/** The `objectId` convention every collection read on this workspace shares. */
const COLLECTION = "all";

export async function GET(request: NextRequest): Promise<Response> {
  return readHandler<TeamWorkloadView>({
    access: { kind: "search", objectType: "teamWorkload", objectId: () => COLLECTION },
    read: async (store, actor) => {
      const records = await store.listPlans({ actor });
      const ownership: PlanOwnership[] = await Promise.all(
        records.map(async (record) => ({
          record,
          assignment: await store.getAssignment(record.plan.id, { actor }),
        })),
      );
      // Never null. An empty team is an empty roster, which is a 200 with empty arrays -- a null
      // here would reach `auditedRead` as DENIED and be answered 404, telling a coordinator that
      // their team does not exist.
      return buildTeamWorkload(ownership, systemClock().now());
    },
  })(request);
}
