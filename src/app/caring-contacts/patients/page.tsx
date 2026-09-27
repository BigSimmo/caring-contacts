import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { notFound, redirect } from "next/navigation";

import { PatientsDirectory } from "@/components/caring-contacts/workspace/patients-directory";
import { CARING_CONTACTS_ROUTES } from "@/lib/caring-contacts-routes";
import { auditedRead } from "@/lib/caring-contacts-server/handler";
import { isCaringContactsWorkspaceEnabled, resolveCaringContactsActor } from "@/lib/caring-contacts-server/session";
import { caringContactsStore } from "@/lib/caring-contacts-server/store";
import { readPatientsDirectoryAddress } from "@/lib/caring-contacts/patients-directory-address";
import { canPerformCaringContactAction } from "@/lib/caring-contacts/permissions";
import { READ_ACTIONS, type PatientNameProjection, type PlanRecord } from "@/lib/caring-contacts/repository";
import type { ServiceState } from "@/lib/caring-contacts/service-state";

/**
 * The workspace's lazy route boundary (Ruling 13). Same spelling and same reason as
 * `src/app/caring-contacts/page.tsx`: nothing outside this route segment imports the workspace,
 * and dynamically importing the shell keeps the Client Components beneath it out of the Clinical
 * KB dashboard's chunks. See that file's module note for the argument in full; it is not repeated
 * here, because one copy of it is the source of truth and two copies would drift.
 */
const CaringContactsShell = dynamic(() =>
  import("@/components/caring-contacts/workspace/shell").then((module) => module.CaringContactsShell),
);

/** The browser tab reads "Patients · Caring Contacts" through the layout's title template. */
export const metadata: Metadata = { title: "Patients" };

/**
 * The team's caseload -- the first real screen of Phase 2B, and the shape every later list screen
 * copies.
 *
 * EVERY READ IS AUDITED, AND NONE OF THEM IS HTTP
 * ----------------------------------------------
 * `GET /api/caring-contacts/plans` already lists the team's plans, but this page is a Server
 * Component and reads the store directly, exactly as the Today page does. Going over HTTP from a
 * render would add a network hop, a second copy of the failure handling, and an access trail that
 * recorded the server calling itself.
 *
 * EVERY read on this page goes through `auditedRead`, the same wrapper `readHandler` is built on,
 * with the SAME access identity each read already has on the API side, so the trail does not grow a
 * second vocabulary for the same read.
 *
 * Ruling 94, and this comment is the demonstration: it used to open "TWO AUDITED READS" and say
 * "both reads", and when a third arrived the headline was corrected while the two sentences that
 * depended on it were not -- three bullets under a "both", in the same block as the fixed count.
 * The sentences above state the property instead, so adding a fourth read cannot make them false.
 * The bullets below are a list of what is read, not a tally of how many:
 *
 *   * the service state -- `{ administrative, serviceState, "service" }`, because the safety
 *     banner is required on every screen (Ruling 56) and must be a state that was actually read;
 *   * the plans -- `{ search, plan, "all" }`, matching `plans/route.ts`'s `GET` exactly;
 *   * the patient names -- `{ search, patientName, "all" }`. Its own row AND its own object type,
 *     both deliberately: this is the read on this page that releases patient identity, and the
 *     question the trail must be able to answer is "who read patients' names, and when". Folding it
 *     into the plans read would lose it entirely; recording it as `patientDirectory` would not,
 *     because that type already carries two referral reads and the trail's query surface filters on
 *     `objectType` with no `objectId` filter at all -- the answer would be visible by eye and
 *     unaskable. Ruling 46 says to add a member rather than overload one, and that is what
 *     `access-audit.ts` now does.
 *
 * Every bad outcome fails closed and reaches `error.tsx`, which says nothing was sent and nothing
 * was changed. NO read on this page has an honest fallback -- a caseload rendered beside a
 * service-state read that failed would claim sending is running during an incident, and a caseload
 * rendered from a failed read of its own contents would claim a caseload that was never read.
 *
 * AN EMPTY LIST IS NOT A MISSING RESOURCE
 * --------------------------------------
 * `auditedRead` maps a `null`/`undefined` release to `denied`, which `readHandler` turns into
 * `not-found`. An empty ARRAY is neither, and is recorded as `allowed` -- an empty list IS what was
 * released. So a team with no plans renders the empty STATE on the success path and `notFound()` is
 * never reached; the only `notFound()` on this page is the production demo lock, which is a
 * different fact entirely. `tests/caring-contacts-patients-page.dom.test.tsx` pins that, because
 * `listPlans` returning `[]` and `getPlan` returning `null` look alike at a glance and the access
 * trail itself cannot tell "you may not see these" from "there are none" for a list.
 *
 * WHICH IS WHY THE CAPABILITY IS DECIDED HERE
 * ------------------------------------------
 * `listPlans` answers an actor without `viewReferral` with `[]`, exactly as it answers a team with
 * no plans -- deliberately, so nobody can probe for the existence of records they may not see. A
 * screen that only counted rows would therefore tell an auditor their team has no patients, which
 * is a false statement about a caseload. The page asks `canPerformCaringContactAction` the same
 * question the store asked, and hands the answer to the directory as `mayViewPlans` so the empty
 * list can say which of the two facts it is.
 *
 * THE PLAN-STATE FILTER IS A URL; THE NAME SEARCH IS NOT
 * -----------------------------------------------------
 * `searchParams` is a promise in Next 16 and is awaited before use. Reading it makes the route
 * dynamic, which is already true here -- the role cookie does the same -- and is correct: a cached
 * copy of a caseload would outlive the caseload.
 *
 * `readPatientsDirectoryAddress` reads the plan state and NOTHING ELSE that could name a patient.
 * A caseload search matches the patient's name, and Ruling [111] does not allow one into a query
 * string: "a query string is logged by every proxy between here and the browser. Nothing about a
 * patient may travel here." The name search is local state inside the directory's client island and
 * never reaches this page at all.
 *
 * IGNORING A BOOKMARKED `?q=<name>` WAS NOT ENOUGH, AND WAS WORSE THAN DOING NOTHING. Declining to
 * honour the parameter leaves the name in the address bar, and `overlayUrl()` in
 * `workspace-overlays.tsx` copies EVERY existing parameter into each history entry it pushes -- so
 * an ignored name was re-written into a fresh history entry every time a coordinator opened an
 * overlay. So the address is REWRITTEN rather than merely unread: any unrecognised parameter, by
 * any name (`q`, `name`, `search`, anything), triggers a `redirect()` to the canonical address
 * carrying only the recognised ones plus a non-identifying flag, and the screen then says a saved
 * search term was not applied without ever echoing it.
 *
 * THE REDIRECT IS THE FIRST THING THIS PAGE DOES, and that placement is the guarantee rather than a
 * tidiness preference: it happens before the store is opened and before every `auditedRead` below,
 * so a dropped value cannot reach an access-trail record, an error message or a thrown `Error` on
 * its way through. `redirect()` in a Server Component is a 307 that REPLACES the history entry
 * (Next 16 `redirect` reference), so the bookmarked address carrying the name is not left behind as
 * an entry of its own.
 *
 * `resolveDemoActor()` now runs BEFORE the address is read, not after -- `readPatientsDirectoryAddress`
 * needs the actor to decide whether a `filterToken` in the address may be redeemed for THIS viewer at
 * all (see that function's module note). That is still safe to do ahead of the redirect: it is a
 * cookie read, not a store read, and records nothing to an access trail, so the property above --
 * nothing crosses into the store or an audited read before a dropped value has been caught -- holds
 * exactly as before.
 */
export default async function CaringContactsPatientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isCaringContactsWorkspaceEnabled()) notFound();

  const actor = await resolveCaringContactsActor();

  // Before anything is read, audited or thrown. See "IGNORING A BOOKMARKED ?q= WAS NOT ENOUGH".
  const address = readPatientsDirectoryAddress(await searchParams, actor);
  if (address.droppedUnrecognisedParams) {
    redirect(
      address.canonicalQuery === ""
        ? CARING_CONTACTS_ROUTES.patients
        : `${CARING_CONTACTS_ROUTES.patients}?${address.canonicalQuery}`,
    );
  }
  const filter = address.filter;

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
  // `listPlans` returns an array for every actor, empty where nothing is visible, so "denied" is
  // not a reachable outcome for this read. A null release would mean the store broke that
  // contract, and the ONLY honest response is the same one the service-state read above makes:
  // throw. `?? []` was here first and was wrong in the one case the branch exists for -- it would
  // have rendered "No patients yet" from an answer that was never given, which is a false
  // statement about a caseload and exactly what Ruling 89 merged Task 4 to prevent. Unreachable
  // under the contract; stated correctly anyway, because a branch that cannot run is still read.
  //
  // `== null`, deliberately, and it is the one place in this file a loose equality is correct:
  // `auditedRead` treats null OR UNDEFINED as denied, while `AuditedReadResult` types `released`
  // as `T | null`, so the compiler cannot see the undefined case at all. A store returning
  // `undefined` would have slipped past a `=== null` guard and died on `records.length` further
  // down — still failing closed, so still no false caseload, but with a `TypeError` instead of
  // this sentence, and the branch this guard exists for would not have been the one that fired.
  if (plansRead.released == null) {
    throw new Error("caring-contacts plans read returned no list.");
  }
  const records = plansRead.released;

  // The names-only projection (Ruling 91). It replaces NOTHING above: the caseload is still read
  // as `PlanRecord`s carrying no patient detail, and this adds the single field a clinician needs to
  // recognise their own patients. `getEpisode` is still never called from this page, and would still
  // be the wrong read -- it releases the mobile number, the identifiers and the ancestry alongside
  // the name.
  //
  // Fails closed as every read on this page does, and for its own reason rather than for
  // symmetry: this read is the one that touches patient identity, so an unexplained failure of it
  // is the last thing that should be rendered past. `error.tsx` says nothing was sent and nothing
  // was changed, both of which are true. An actor whose role does not cover the read is not a
  // failure at all -- it is an empty array, exactly as `listPlans` answers, and the rows below then
  // head themselves with the synthetic identifier as they did before this read existed.
  const namesRead = await auditedRead<PatientNameProjection[]>(
    store,
    actor,
    { kind: "search", objectType: "patientName", objectId: "all" },
    () => store.listPatientNames({ actor }),
  );
  if (namesRead.outcome === "failed") {
    throw namesRead.error instanceof Error ? namesRead.error : new Error("Failed to read this team's patient names.");
  }
  if (!namesRead.recorded) {
    throw new Error("Caring Contacts access trail is unavailable; nothing was rendered.");
  }
  // `== null` for the same reason the plans guard above uses it: `auditedRead` treats null AND
  // undefined as denied while typing `released` as `T | null`, so a `=== null` guard would let a
  // contract-breaking `undefined` through to fail somewhere less legible.
  if (namesRead.released == null) {
    throw new Error("caring-contacts patient names read returned no list.");
  }
  const patientNames = namesRead.released;

  const mayViewPlans = canPerformCaringContactAction(actor, READ_ACTIONS.plan, { teamId: actor.teamId }).allowed;
  // The same one-line question, asked of the name capability. A role restriction is a fact about
  // the ACTOR -- known here with certainty, for every row at once -- whereas a de-identified episode
  // is a fact about one record. The directory can state the first and must not guess the second, so
  // it is decided here rather than inferred there from an empty `patientNames`: a coordinator whose
  // team holds only cleared episodes also receives no names, and telling that clinician their role
  // was the reason would be false.
  const mayViewPatientNames = canPerformCaringContactAction(actor, READ_ACTIONS.patientName, {
    teamId: actor.teamId,
  }).allowed;

  return (
    <CaringContactsShell
      title="Patients"
      description="Every patient this team holds a caring-contact plan for, and where each plan has got to."
      serviceState={serviceState}
    >
      <PatientsDirectory
        records={records}
        patientNames={patientNames}
        filter={filter}
        mayViewPlans={mayViewPlans}
        mayViewPatientNames={mayViewPatientNames}
        savedSearchNotApplied={address.searchNotApplied}
        initialSearchQuery={address.searchQuery}
      />
    </CaringContactsShell>
  );
}
