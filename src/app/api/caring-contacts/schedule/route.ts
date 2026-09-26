// src/app/api/caring-contacts/schedule/route.ts
//
// The team's schedule for a day or a range of days.
//
// IT ADDS NO STORE READ (Ruling 124). The read is `listPlans` -- already team-scoped, already free
// of patient identity -- and `buildScheduleRange` in the sealed domain does the rest. So this route
// publishes an aggregation rather than opening a second retrieval surface. `listSendableContacts`
// is still deliberately not used, but no longer because it is wrong: since #PAMATF it consults the
// owning plan's state, so a draft plan's contacts no longer present there as sendable. It is not
// used because a SCHEDULE shows what will not be sent as well as what will, and a list of only the
// sendable ones cannot answer that.
//
// It records its own object type, `contactSchedule`, rather than the caseload's `plan`. Ruling 46's
// instruction, and see that member's note in `access-audit.ts` for why provenance is not the test.
// The access event is recorded by `readHandler`, on every call, as it is for every other read.
//
// The range travels in the query string, which is safe here and would not be on the audit trail:
// two AWST calendar days are identifiers, never free text, and the schema below refuses anything
// that is not one before it can reach an audit `objectId`.
import type { NextRequest } from "next/server";
import { z } from "zod";

import { invalidRequestResponse, readHandler } from "@/lib/caring-contacts-server/handler";
import { awstCalendarDay, systemClock } from "@/lib/caring-contacts/clock";
import { isAwstCalendarDay } from "@/lib/caring-contacts/schedule";
import { buildScheduleRange, type ScheduleRangeView } from "@/lib/caring-contacts/schedule-view";

export const runtime = "nodejs";

/**
 * A real AWST calendar day, checked by the domain's own `isAwstCalendarDay` rather than by a
 * pattern written here -- that function rejects `2026-02-30` and `2026-13-01`, which a
 * `\d{4}-\d{2}-\d{2}` pattern accepts, and a second copy of the format is how the two drift.
 */
const calendarDay = z.string().refine(isAwstCalendarDay, { message: "must be an AWST calendar day" });

const querySchema = z.object({ from: calendarDay.optional(), to: calendarDay.optional() }).strict();

/**
 * Today in AWST when no day is asked for, and a one-day range when only `from` is.
 *
 * The default is resolved here rather than in the domain because "today" is ambient time, and
 * `schedule-view.ts` takes the day as an argument precisely so it never reaches for a clock of its
 * own. `systemClock()` is this seam's clock, the same one every other server-side read uses.
 */
function resolveRange(from: string | undefined, to: string | undefined): { from: string; to: string } {
  const today = awstCalendarDay(systemClock().now());
  const start = from ?? today;
  return { from: start, to: to ?? start };
}

/**
 * The domain's own verdict on a range, asked without any plans.
 *
 * NOT A SECOND COPY OF THE RANGE RULES -- it is the same function the read below calls. With no
 * plans there is nothing to group, so what comes back is exactly its judgement on the two days, and
 * an inverted or over-long range is refused here in the same breath it would be refused there.
 */
function rangeIsUnreadable(from: string, to: string): boolean {
  return !buildScheduleRange([], from, to).ok;
}

export async function GET(request: NextRequest): Promise<Response> {
  // Parsed before `readHandler` runs, exactly as the access-trail route parses its body first: a
  // range this route cannot read is a request that never became one, so there is no read to record
  // and no refusal the domain made. Nothing of the query is echoed back.
  //
  // In production the demo gate inside `readHandler` answers every well-formed request with 404, so
  // a malformed one is answered differently. That is the access-trail route's shape too, and it is
  // accepted for the same reason: the query is refused before any actor is resolved, any store is
  // opened or any record is touched.
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return invalidRequestResponse();
  const range = resolveRange(parsed.data.from, parsed.data.to);
  if (rangeIsUnreadable(range.from, range.to)) return invalidRequestResponse();

  return readHandler<ScheduleRangeView>({
    access: {
      kind: "search",
      objectType: "contactSchedule",
      // The days that were read. Identifier-shaped by construction -- the schema above accepted
      // only two calendar days -- so it can never carry a name or a search term, and the trail
      // records WHICH days a clinician looked at rather than only that they looked.
      objectId: () => `${range.from}:${range.to}`,
    },
    read: async (store, actor) => {
      const result = buildScheduleRange(await store.listPlans({ actor }), range.from, range.to, systemClock().now());
      // Unreachable: every refusal this can give is about the range, and `rangeIsUnreadable` above
      // asked the same function about the same two days before this ran. Stated correctly anyway,
      // because a branch that cannot run is still read -- and the wrong statement here would be
      // `return null`, which `auditedRead` maps to DENIED and `readHandler` turns into 404, saying
      // this team has no schedule.
      if (!result.ok) throw new Error(`caring-contacts schedule read refused: ${result.reason}`);
      return result.view;
    },
  })(request);
}
