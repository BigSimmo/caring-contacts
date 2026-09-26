import { awstCalendarDay } from "@/lib/caring-contacts/clock";
import type { PatientsDirectoryFilter } from "@/lib/caring-contacts/patients-directory-filter";
import type { PatientNameProjection, PlanRecord } from "@/lib/caring-contacts/repository";

import { PatientsDirectoryClient } from "./patients-directory-client";
import type { PatientsDirectoryRow } from "./patients-directory-row";

/**
 * The team's caseload, as a list of PLANS rather than of people -- the SERVER half.
 *
 * This module reads, narrows and filters; `patients-directory-client.tsx` renders. The seam
 * between them is `PatientsDirectoryRow`, a type that holds exactly what the screen shows and by
 * construction has nowhere to put a mobile number, an identifier list, an ancestry, a pathway, a
 * team or a raw contact schedule. `ServiceState` -- and therefore an incident responder's free-text
 * note -- is not in it either, and never passes through this file at all.
 *
 * What this screen may know, and why it is so little
 * -------------------------------------------------
 * A row starts as a `PlanRecord`, which carries no patient-identifying detail BY CONSTRUCTION, plus
 * ONE further field: the patient's name, read separately through `listPatientNames` (Ruling 91).
 * That read is its own repository method with its own capability check, and its return type holds a
 * plan id and a name.
 *
 * `getEpisode` remains the read this screen must never make. It is the one that releases all four
 * identifying fields together, and a caseload showing one of them has no business pulling four.
 * Task 5 headed each row with the synthetic identifier for exactly that reason; the owner's answer
 * (Ruling 91) was to narrow the read rather than to widen the screen, and this is that read
 * consumed. The approved design's names and initials are honest again as a result.
 *
 * THE TWO CAUSES OF A NAMELESS ROW ARE NOT SYMMETRIC, and the screen says the one it knows
 * ----------------------------------------------------------------------------------------
 * Per row, nothing here can tell a de-identified episode from a role restriction: both arrive as an
 * absent entry, and guessing between them would be a claim the data does not support.
 *
 * But "your role may not see names" is not a per-row fact at all. It is a fact about the ACTOR,
 * known with certainty and known globally, from the same one-line capability call the page already
 * makes for `mayViewPlans`. So it is stated ONCE, above the list, and every fallback row on that
 * render is explained without any inference. What is left is then unambiguous rather than merely
 * unexplained: a nameless row on a page that printed no such notice was de-identified.
 *
 * The distinction is clinical, not cosmetic. One is "ask for access"; the other is a fact about the
 * record, and no access will bring the name back.
 *
 * NO ROLE REACHES THE NOTICE TODAY, and it is written anyway. It needs a role holding `viewReferral`
 * WITHOUT `viewPatientRecord`, and `permissions.ts` currently grants those two such that every role
 * that can list plans can also see names -- the grant runs the other way round, which is exactly why
 * `PATIENT_NAME_READ_ACTIONS` is a conjunction. So this is an unreachable branch, pinned by a
 * component test that passes the prop directly, on the same principle as this page's null-release
 * guard: a branch that cannot run today is still read, is still copied by the next screen, and is
 * one grant edit away from running. Nothing infers it from an empty list, so it cannot fire wrongly
 * while it waits.
 *
 * WHY THE PLAN-STATE FILTER IS A URL AND THE NAME SEARCH IS NOT
 * ------------------------------------------------------------
 * These two filters are treated differently on purpose, and the difference is a patient-
 * confidentiality contract rather than a preference.
 *
 * Plan state is not identifying. It is a URL a coordinator may reload, bookmark or paste into a
 * handover note without disclosing anything about anybody, so it stays a set of `<Link>`
 * navigations that this Server Component reads from `searchParams` and applies HERE, before any
 * row crosses the boundary.
 *
 * A patient's NAME is identifying, and Ruling [111] is explicit: "a query string is logged by every
 * proxy between here and the browser. Nothing about a patient may travel here." A `method="get"`
 * search box put the name into `?q=`, and therefore into the address bar, the browser history of a
 * possibly-shared ward computer, and every request log on the way. That is the defect this split
 * exists to remove. The name search is now local state inside the client island and reaches no URL,
 * no server request and no audit event, in any form -- not as a parameter, not as a fragment, and
 * not as a hash of one, because a hash of a name is still a name-derived identifier in a log.
 *
 * That costs something real and the screen says so rather than hiding it: a reload keeps the plan
 * state and clears the name search, so the island states that in place beside the control (spec
 * 4.4) instead of leaving a coordinator to wonder why their list changed.
 *
 * Ruling 13 holds this workspace's client payload to a rounding error, and this boundary is the one
 * place in the directory where that preference yields: confidentiality outranks payload size, and
 * the yield is paid for by narrowing what crosses rather than by widening it. The rows handed over
 * are already reduced to `PatientsDirectoryRow` AND already reduced to the selected plan state, so
 * the payload carries less than the previous Server Component rendered into HTML.
 *
 * Three empty lists, three different facts
 * ---------------------------------------
 * `ListEmptyState` refuses to blur "nothing exists" and "a filter is hiding everything", and this
 * screen has a THIRD case the component's two kinds do not name: a role that may not view plans at
 * all. `listPlans` answers such an actor with `[]`, exactly as it answers a team with no plans, so
 * a screen that only counted rows would tell an auditor their team has no patients -- a false
 * statement about a caseload, which is the defect the component exists to prevent. The capability
 * is therefore decided from the actor by the page and passed in as `mayViewPlans`, and that case
 * gets the `"not-permitted"` wording shape (a reason and a remedy), because it is a visibility rule
 * hiding the list rather than a claim that the list is empty.
 */

/**
 * How many of a plan's contacts will not be sent because the system suppressed them.
 *
 * Keyed off the CONTACT's own state rather than off `planned.suppressed`. The two agree today,
 * because the only suppression that exists so far is the schedule absorbing Week 1 into the first
 * contact — but `applyContactTransition`'s `suppress` action can move any live contact to
 * `suppressed` later, and a contact suppressed that way carries no `planned.suppressed` marker.
 * Counting the plan rather than the outcome would have left those with no explanation at all,
 * which is the one thing spec 4.4 does not allow a system-reached state to have.
 */
function suppressedContactCount(record: PlanRecord): number {
  return record.contacts.filter((stored) => stored.contact.state === "suppressed").length;
}

/**
 * How many of a plan's suppressed contacts the SCHEDULE absorbed, rather than a later transition.
 *
 * A count, not a boolean. `hasAbsorbedContact` was the first shape and it produced the defect
 * N-2 names: the row subtracted EVERY suppressed contact from its message count while the
 * explanation branched on whether an absorbed one existed at all, so a plan carrying one absorbed
 * Week 1 message and one later `suppress` transition showed a count short by two beside a reason
 * accounting for one. That is the same blur keying the count off `contact.state` had just fixed,
 * one case further along, and it is reachable through `applyContactTransition`.
 *
 * The two causes are counted separately because they have DIFFERENT REMEDIES, which is the whole
 * of why spec 4.4 wants a reason stated in place: absorption is undone by choosing another
 * first-contact date, and a transition-suppressed contact is terminal and never sent.
 */
function absorbedContactCount(record: PlanRecord): number {
  return record.contacts.filter((stored) => stored.planned.suppressed?.reason === "absorbedByFirstContact").length;
}

export type PatientsDirectoryProps = {
  /** Every plan the read released, unfiltered. The state filter is applied here, not by the caller. */
  records: readonly PlanRecord[];
  /**
   * What `listPatientNames` released, in whatever order it came back -- a plan id and a name each,
   * and by its type nothing else. It is a separate prop rather than a field merged onto the records
   * so that the narrow read stays visibly narrow at every layer it passes through: a merged record
   * would be a widened `PlanRecord` in all but name, and the next screen would copy it.
   *
   * Shorter than `records` for a role that may list plans without holding `viewPatientRecord`, and
   * empty when that read released nothing. A missing entry is not an error; the row falls back.
   */
  patientNames: readonly PatientNameProjection[];
  filter: PatientsDirectoryFilter;
  /** False when the acting role does not include viewing plans -- see the module note. */
  mayViewPlans: boolean;
  /**
   * False when the acting role does not hold `viewPatientRecord`, decided by the page from the
   * actor rather than inferred here from an empty `patientNames`. Those two are NOT the same
   * question: a coordinator whose team holds only de-identified episodes also receives no names,
   * and telling that clinician their role is the reason would be false.
   */
  mayViewPatientNames: boolean;
  /**
   * True when the address this render was reached by had carried a parameter this route does not
   * understand -- an old bookmark's saved search term, most likely a patient's name.
   *
   * A BOOLEAN and nothing else. Not the name of the parameter, not its value, not its length: a
   * boolean is the largest thing that can cross to a Client Component without narrowing what the
   * dropped term was. The page has already rewritten the address by the time this renders, so this
   * prop explains a removal that has happened rather than announcing one that is about to.
   */
  savedSearchNotApplied?: boolean;
  /** Optional initial search query safely resolved from an obfuscated session filter token (#HDCF2B). */
  initialSearchQuery?: string;
};

/**
 * The Server Component half: read, narrow, filter by the non-identifying state, hand over.
 *
 * `mayViewPlans === false` hands over NO rows at all. The capability is answered on this side of
 * the boundary, so a role that may not see the caseload does not receive it in a payload it merely
 * declines to render.
 */
export function PatientsDirectory({
  records,
  patientNames,
  filter,
  mayViewPlans,
  mayViewPatientNames,
  savedSearchNotApplied = false,
  initialSearchQuery,
}: PatientsDirectoryProps) {
  // A cleared plan's name is the empty string both stores write for a removed one, so it is dropped
  // here rather than at each row: an empty name is "no name held", never a name, and every reader
  // below asks the same map the same way.
  const nameByPlan = new Map(
    patientNames.filter((entry) => entry.patientName !== "").map((e) => [e.planId, e.patientName]),
  );

  const rows: readonly PatientsDirectoryRow[] = mayViewPlans
    ? records
        .filter((record) => filter.state === "all" || record.plan.state === filter.state)
        .map((record) => {
          const suppressed = suppressedContactCount(record);
          const absorbed = absorbedContactCount(record);
          return {
            planId: record.plan.id,
            patientId: record.patientId,
            referralId: record.referralId,
            state: record.plan.state,
            patientName: nameByPlan.get(record.plan.id) ?? null,
            dischargeDay: awstCalendarDay(record.dischargeAt),
            // Every suppressed contact is subtracted from the count, so every suppressed contact
            // must be accounted for in the reason beside it. `absorbed` can never exceed
            // `suppressed`: both stores write an absorbed contact straight into the terminal
            // `suppressed` state.
            scheduledContactCount: record.contacts.length - suppressed,
            absorbedContactCount: absorbed,
            otherSuppressedContactCount: suppressed - absorbed,
          };
        })
    : [];

  return (
    <PatientsDirectoryClient
      rows={rows}
      totalPlanCount={records.length}
      filter={filter}
      mayViewPlans={mayViewPlans}
      mayViewPatientNames={mayViewPatientNames}
      savedSearchNotApplied={savedSearchNotApplied}
      initialSearchQuery={initialSearchQuery}
    />
  );
}
