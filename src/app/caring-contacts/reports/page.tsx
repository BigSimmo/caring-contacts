import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { notFound } from "next/navigation";

import { OperationalReports } from "@/components/caring-contacts/workspace/operational-reports";
import { auditedRead } from "@/lib/caring-contacts-server/handler";
import { isCaringContactsWorkspaceEnabled, resolveCaringContactsActor } from "@/lib/caring-contacts-server/session";
import { caringContactsStore } from "@/lib/caring-contacts-server/store";
import { systemClock } from "@/lib/caring-contacts/clock";
import {
  summariseDispatchDiscrepancies,
  summariseOperationalReport,
} from "@/lib/caring-contacts/operational-reporting";
import { canPerformCaringContactAction } from "@/lib/caring-contacts/permissions";
import { READ_ACTIONS, type DispatchRecord, type PlanRecord } from "@/lib/caring-contacts/repository";
import type { ServiceState } from "@/lib/caring-contacts/service-state";

/**
 * The workspace's lazy route boundary (Ruling 13). Same spelling and same reason as
 * `src/app/caring-contacts/page.tsx`: nothing outside this route segment imports the workspace,
 * and dynamically importing the shell keeps the Client Components beneath it out of the Clinical
 * KB dashboard's chunks. That file's module note carries the argument in full.
 */
const CaringContactsShell = dynamic(() =>
  import("@/components/caring-contacts/workspace/shell").then((module) => module.CaringContactsShell),
);

/**
 * How far back the dispatch-difference measures look.
 *
 * `listDispatches` takes a window and has no unbounded form, so a window has to be chosen; the
 * approved design's own reconciliation measures are over the last seven days. The number lives here
 * as a named constant and the window it produces is stated on the screen, so a reader is never left
 * to guess what period a measure covers.
 */
const DISPATCH_WINDOW_DAYS = 7;

/** The browser tab reads "Reports · Caring Contacts" through the layout's title template. */
export const metadata: Metadata = { title: "Reports" };

/**
 * Aggregate operational reporting, and the programme-reach section spec §2.5 owes.
 *
 * EVERY READ IS AUDITED, AND NONE OF THEM IS HTTP. Same shape as the caseload and the templates
 * library: this is a Server Component and it reads the store directly, through `auditedRead`, with
 * the SAME access identity the equivalent API route records -- so the trail does not grow a second
 * vocabulary for one read. What is read:
 *
 *   * the service state -- `{ administrative, serviceState, "service" }`, because the safety
 *     banner is required on every screen (Ruling 56) and must be a state that was actually read;
 *   * this team's plans -- `{ search, plan, "all" }`, matching `plans/route.ts`'s `GET` exactly.
 *     A plan record carries its contacts, so every contact measure on this screen comes from this
 *     one read rather than from a per-plan fan-out;
 *   * this team's dispatch attempts in the window -- `{ search, contact, "all" }`, matching
 *     `dispatches/route.ts`'s `GET` exactly, which records a dispatch read against `contact`
 *     because a dispatch attempt is a contact-level record.
 *
 * NO NEW `AccessedObjectType` MEMBER, AND THE REASONING MATTERS MORE THAN THE RULING'S LETTER.
 * Ruling 46 says to add a member rather than OVERLOAD one, and the defect it names is a type
 * carrying reads of DIFFERENT THINGS. Every read above releases exactly the objects its existing
 * member names, and each already has one. `"report"` is deliberately NOT used: nothing stored here
 * is a report, and recording a plan read against it would make "who read this team's plans, and
 * when" miss a read that did release plan records to the server -- the harm Ruling 46 exists to
 * prevent, arriving from the other direction. An `operationalReport` member would name a SCREEN
 * rather than an object, which is the reasoning Task 15 gave for declining one and was upheld on.
 *
 * THE RESIDUAL THAT LEAVES, STATED RATHER THAN GLOSSED: this screen's plan read and the caseload's
 * are identical records, so the trail cannot be asked which of the two a reader used. That is a
 * property of the trail -- it filters on `objectType` and offers no `objectId` filter -- and the
 * fix belongs there, not in a screen minting a member named after itself. Recorded in the Task 19
 * report. The member that this screen WOULD genuinely warrant is the one for the read it does not
 * make: a reach read over `cultural_identity_reports` is a different object with no existing member,
 * and adding it is part of building that read, not of building this screen.
 *
 * AN EMPTY LIST IS NOT A MISSING RESOURCE, AND IT IS NOT AN ABSENT CAPABILITY EITHER.
 * `auditedRead` maps a `null`/`undefined` release to `denied`; an empty ARRAY is neither and is
 * recorded as `allowed`, because an empty list IS what was released. And both `listPlans` and
 * `listDispatches` answer an actor who may not see their contents with `[]`, exactly as they answer
 * a team that has none -- deliberately, so nobody can probe for records they may not see. So this
 * page asks each capability question separately, through `READ_ACTIONS` itself rather than a second
 * copy of the action names, and hands the answers to the screen. A report that only counted rows
 * would tell an auditor their team has sent nothing, which is a false statement about a caseload.
 *
 * WHAT THIS SCREEN DOES NOT DO, AND WHY IT IS THE MOST IMPORTANT LINE IN THIS FILE. It performs NO
 * read of `caring_contacts.cultural_identity_reports`, and the reason is NOT the threshold. Spec
 * §2.5 promises reach reporting over Aboriginal and Torres Strait Islander status, and the two
 * halves of that promise are in different states:
 *
 *   * the small-cell threshold IS configured -- the owner's decision of 2026-08-26, held with its
 *     provenance in `src/lib/caring-contacts/reach-reporting-governance.ts` and read by
 *     `reachReportingThreshold()`. The screen names it, so a reader can see the control exists;
 *   * the FIELD is not collected. Nothing records the status, so there is nothing to read, nothing
 *     to count and nothing to suppress.
 *
 * So the reach section states what is and is not collected and reads nothing at all -- an empty
 * breakdown would read as a statement about patients rather than about collection. The suppression
 * rule is built and proved in `src/lib/caring-contacts/reach-reporting.ts`, waiting on a bounded
 * category set rather than on a number.
 *
 * This block said the opposite for one commit: it was written before the threshold existed and not
 * re-read when it arrived, INSIDE the diff that made it false. The standing rule -- when a diff
 * changes what a mechanism does, read every doc comment in the files it touches -- is the one that
 * catches that, and nothing else does.
 *
 * Reading the role cookie makes this route dynamic, which is correct: a cached report would outlive
 * the data it reports on.
 */
export default async function CaringContactsReportsPage() {
  if (!isCaringContactsWorkspaceEnabled()) notFound();
  const actor = await resolveCaringContactsActor();
  const store = await caringContactsStore();
  const now = systemClock().now();

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
  // back, so there is no single object to name. Identical to `plans/route.ts`'s `COLLECTION`.
  const plansRead = await auditedRead<PlanRecord[]>(
    store,
    actor,
    { kind: "search", objectType: "plan", objectId: "all" },
    () => store.listPlans({ actor }),
  );
  if (plansRead.outcome === "failed") {
    throw plansRead.error instanceof Error ? plansRead.error : new Error("Failed to read this team's plans.");
  }
  if (!plansRead.recorded) {
    throw new Error("Caring Contacts access trail is unavailable; nothing was rendered.");
  }
  // `== null`, deliberately, and the same loose equality the caseload's guard uses for the same
  // reason: `auditedRead` treats null AND UNDEFINED as denied while `AuditedReadResult` types
  // `released` as `T | null`. `listPlans` returns an array for every actor, so this is unreachable
  // under the contract -- and `?? []` here would render a report of zeroes from an answer that was
  // never given, which on a report is a page of false statements rather than one.
  if (plansRead.released == null) {
    throw new Error("caring-contacts plans read returned no list.");
  }

  const windowFrom = new Date(now.getTime() - DISPATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const dispatchesRead = await auditedRead<DispatchRecord[]>(
    store,
    actor,
    { kind: "search", objectType: "contact", objectId: "all" },
    () => store.listDispatches({ fromIso: windowFrom.toISOString(), toIso: now.toISOString() }, { actor }),
  );
  if (dispatchesRead.outcome === "failed") {
    throw dispatchesRead.error instanceof Error
      ? dispatchesRead.error
      : new Error("Failed to read this team's dispatch attempts.");
  }
  if (!dispatchesRead.recorded) {
    throw new Error("Caring Contacts access trail is unavailable; nothing was rendered.");
  }
  if (dispatchesRead.released == null) {
    throw new Error("caring-contacts dispatch attempts read returned no list.");
  }

  // The same questions the stores asked, asked of the exported capability map itself rather than of
  // a second hand-written copy of the action names. A second copy would be free to stop agreeing
  // with the store, and the screen would then state a capability the read did not have.
  const mayViewPlans = canPerformCaringContactAction(actor, READ_ACTIONS.plan, { teamId: actor.teamId }).allowed;
  const mayViewDispatches = canPerformCaringContactAction(actor, READ_ACTIONS.dispatch, {
    teamId: actor.teamId,
  }).allowed;

  return (
    <CaringContactsShell
      title="Reports"
      description="Aggregate operational measures for this team, and how far the programme reaches. No measure here is a statement about how any patient is."
      serviceState={serviceState}
    >
      <OperationalReports
        report={summariseOperationalReport(plansRead.released, now)}
        dispatches={summariseDispatchDiscrepancies(dispatchesRead.released)}
        mayViewPlans={mayViewPlans}
        mayViewDispatches={mayViewDispatches}
        dispatchWindowDays={DISPATCH_WINDOW_DAYS}
        // The one state this system can currently produce: the field the §2.5 reach report is over
        // is not collected, so there is nothing to disclose and nothing to suppress. See this
        // module's note above, and `reach-reporting.ts` for the rule that is waiting on a threshold.
        reach={{ kind: "notCollected" }}
      />
    </CaringContactsShell>
  );
}
