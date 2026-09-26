import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { notFound } from "next/navigation";

import {
  TemplatesLibrary,
  parseTemplatesLibraryFilter,
} from "@/components/caring-contacts/workspace/templates-library";
import { auditedRead } from "@/lib/caring-contacts-server/handler";
import { isCaringContactsWorkspaceEnabled, resolveCaringContactsActor } from "@/lib/caring-contacts-server/session";
import { caringContactsStore } from "@/lib/caring-contacts-server/store";
import type { PathwayVersion } from "@/lib/caring-contacts/pathway-versions";
import { canPerformCaringContactAction } from "@/lib/caring-contacts/permissions";
import { PATHWAY_VERSION_READ_ACTIONS } from "@/lib/caring-contacts/repository";
import type { ServiceState } from "@/lib/caring-contacts/service-state";

/**
 * The workspace's lazy route boundary (Ruling 13). Same spelling and same reason as
 * `src/app/caring-contacts/page.tsx` and the caseload: nothing outside this route segment imports
 * the workspace, and dynamically importing the shell keeps the Client Components beneath it out of
 * the PsychSift dashboard's chunks. That file's module note carries the argument in full; one
 * copy of it is the source of truth and two copies would drift.
 */
const CaringContactsShell = dynamic(() =>
  import("@/components/caring-contacts/workspace/shell").then((module) => module.CaringContactsShell),
);

/** The browser tab reads "Templates · Caring Contacts" through the layout's title template. */
export const metadata: Metadata = { title: "Templates" };

/**
 * The templates library -- the governed pathway versions behind every plan, and their approval
 * history.
 *
 * EVERY READ IS AUDITED, AND NONE OF THEM IS HTTP
 * ----------------------------------------------
 * `GET /api/caring-contacts/pathway-versions` already lists this team's versions, but this page is
 * a Server Component and reads the store directly, exactly as the caseload and the activation
 * wizard do. Going over HTTP from a render would add a network hop, a second copy of the failure
 * handling, and an access trail that recorded the server calling itself.
 *
 * Every read here goes through `auditedRead` with the SAME access identity the API side records,
 * so the trail does not grow a second vocabulary for the same read. What is read:
 *
 *   * the service state -- `{ administrative, serviceState, "service" }`, because the safety
 *     banner is required on every screen (Ruling 56) and must be a state that was actually read;
 *   * the pathway versions -- `{ view, pathwayVersion, "all" }`, matching this route's own GET in
 *     `api/caring-contacts/pathway-versions/route.ts` exactly, and matching the read
 *     `plans/new/page.tsx` already makes.
 *
 * NO NEW `AccessedObjectType` MEMBER, AND THAT IS RULING 46 FOLLOWED RATHER THAN SET ASIDE.
 * Ruling 46 says to add a member rather than OVERLOAD one, and the defect it names is a type
 * carrying reads of DIFFERENT THINGS: `patientDirectory` held two referral reads, so a patient-name
 * read recorded against it would have been visible by eye and unaskable, because the trail's query
 * surface filters on `objectType` with no `objectId` filter at all. This read is not a different
 * thing. It releases the same objects, with the same sensitivity, through the same repository
 * method as the wizard's read and the API route's, and `pathwayVersion` names exactly those
 * objects. A `pathwayVersionLibrary` member would name a SCREEN rather than an object, and it
 * would split the answer to "who read this team's governed pathway versions, and when" across two
 * values with no way to ask for both -- which is the harm Ruling 46 exists to prevent, arriving
 * from the other direction.
 *
 * Every bad outcome fails closed and reaches `error.tsx`, which says nothing was sent and nothing
 * was changed. Neither read here has an honest fallback: a governance library rendered beside a
 * service-state read that failed would claim sending is running during an incident, and a library
 * rendered from a failed read of its own contents would claim a governance record that was never
 * read -- on the one screen whose whole subject is what has and has not been approved.
 *
 * AN EMPTY LIST IS NOT A MISSING RESOURCE
 * --------------------------------------
 * `auditedRead` maps a `null`/`undefined` release to `denied`. An empty ARRAY is neither, and is
 * recorded as `allowed` -- an empty list IS what was released. So a team with no versions renders
 * the empty STATE on the success path and `notFound()` is never reached; the only `notFound()` on
 * this page is the production demo lock, which is a different fact entirely.
 *
 * WHICH IS WHY THE CAPABILITY IS DECIDED HERE
 * ------------------------------------------
 * `listPathwayVersions` answers an actor holding neither `authorPathwayVersion` nor
 * `approvePathwayVersion` with `[]`, exactly as it answers a team with no versions -- deliberately,
 * so nobody can probe for the existence of records they may not see. A screen that only counted
 * rows would therefore tell an auditor their team has no governed pathway, which is a false
 * statement about a clinical governance record. So the page asks the SAME any-of question the
 * store asks, through `PATHWAY_VERSION_READ_ACTIONS` itself rather than a second copy of that list,
 * and hands the answer down as `mayViewPathwayVersions`.
 *
 * FILTERING IS A URL
 * -----------------
 * `searchParams` is a promise in Next 16 and is awaited before use. Reading it makes the route
 * dynamic, which is already true here -- the role cookie does the same -- and is correct: a cached
 * copy of a governance library would outlive the governance.
 *
 * WHAT THIS SCREEN DOES NOT DO. It shows no message wording; see the module note on
 * `templates-library.tsx` for why there is none to show per version, and Ruling [127] for the
 * ruling behind it. `/caring-contacts/templates/[pathwayId]`, the message-preview surface and the
 * dual-approval controls are Task 16's.
 */
export default async function CaringContactsTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isCaringContactsWorkspaceEnabled()) notFound();
  const actor = await resolveCaringContactsActor();
  const store = await caringContactsStore();
  const filter = parseTemplatesLibraryFilter(await searchParams);

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
  // back, so there is no single object to name. Identical to `pathway-versions/route.ts`'s `GET`.
  const versionsRead = await auditedRead<PathwayVersion[]>(
    store,
    actor,
    { kind: "view", objectType: "pathwayVersion", objectId: "all" },
    () => store.listPathwayVersions({ actor }),
  );
  if (versionsRead.outcome === "failed") {
    throw versionsRead.error instanceof Error
      ? versionsRead.error
      : new Error("Failed to read this team's pathway versions.");
  }
  if (!versionsRead.recorded) {
    throw new Error("Caring Contacts access trail is unavailable; nothing was rendered.");
  }
  // `== null`, deliberately, and the same loose equality the caseload's guard uses for the same
  // reason: `auditedRead` treats null AND UNDEFINED as denied while `AuditedReadResult` types
  // `released` as `T | null`, so a `=== null` guard would let a contract-breaking `undefined`
  // through to fail somewhere less legible. `listPathwayVersions` returns an array for every actor,
  // empty where nothing is visible, so this is unreachable under the contract -- and a branch that
  // cannot run is still read, and `?? []` here would render "No governed versions yet" from an
  // answer that was never given.
  if (versionsRead.released == null) {
    throw new Error("caring-contacts pathway versions read returned no list.");
  }
  const versions = versionsRead.released;

  // The same any-of question `mayReadAny(actor, PATHWAY_VERSION_READ_ACTIONS, teamId)` asks inside
  // the store, asked of the exported list itself rather than of a hand-written pair of actions. A
  // second copy would be free to stop agreeing with the store, and the screen would then state a
  // capability the read did not have.
  const mayViewPathwayVersions = PATHWAY_VERSION_READ_ACTIONS.some(
    (action) => canPerformCaringContactAction(actor, action, { teamId: actor.teamId }).allowed,
  );

  return (
    <CaringContactsShell
      title="Templates"
      description="The governed pathway versions this team holds, and the approval history behind each one. Every patient, number and message in this workspace is invented; nothing here is ever sent to a real number."
      serviceState={serviceState}
    >
      <TemplatesLibrary versions={versions} filter={filter} mayViewPathwayVersions={mayViewPathwayVersions} />
    </CaringContactsShell>
  );
}
