import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { notFound } from "next/navigation";

import { TemplateDetail, type TemplateDetailView } from "@/components/caring-contacts/workspace/template-detail";
import { auditedRead } from "@/lib/caring-contacts-server/handler";
import { isCaringContactsWorkspaceEnabled, resolveCaringContactsActor } from "@/lib/caring-contacts-server/session";
import { caringContactsStore } from "@/lib/caring-contacts-server/store";
import { isAccessObjectIdShape } from "@/lib/caring-contacts/access-audit";
import { pathwayVersionId as toPathwayVersionId } from "@/lib/caring-contacts/ids";
import type { PathwayVersion } from "@/lib/caring-contacts/pathway-versions";
import { canPerformCaringContactAction } from "@/lib/caring-contacts/permissions";
import { PATHWAY_VERSION_READ_ACTIONS } from "@/lib/caring-contacts/repository";
import type { ServiceState } from "@/lib/caring-contacts/service-state";

/**
 * The workspace's lazy route boundary (Ruling 13). Same spelling and same reason as
 * `src/app/caring-contacts/page.tsx` and the templates library beside this file: nothing outside
 * this route segment imports the workspace, and dynamically importing the shell keeps the Client
 * Components beneath it out of the PsychSift dashboard's chunks. That file's module note carries
 * the argument in full; one copy of it is the source of truth and two copies would drift.
 */
const CaringContactsShell = dynamic(() =>
  import("@/components/caring-contacts/workspace/shell").then((module) => module.CaringContactsShell),
);

/** The browser tab reads "Template · Caring Contacts" through the layout's title template. */
export const metadata: Metadata = { title: "Template" };

/**
 * ONE governed pathway version -- the record a coordinator opens from a row of the templates
 * library.
 *
 * THIS IS NEXT 16. `params` is a PROMISE and is awaited before use;
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md` is the
 * contract, not any recollection of Next 14, where it was a plain object. Awaiting it makes the
 * route dynamic, which is already true here -- the role cookie does the same -- and is correct: a
 * cached copy of a governance record would outlive the governance.
 *
 * THE URL SEGMENT IS VALIDATED BEFORE ANYTHING IS READ, AND THAT IS A SAFETY CHECK
 * -------------------------------------------------------------------------------
 * The identifier in the address becomes this read's audit `objectId`, and
 * `buildAccessAuditEvent` THROWS on an `objectId` that is not identifier-shaped -- an allowlist,
 * because a search term or a patient name must never be recordable as one. `access-audit.ts` says
 * in as many words what that leaves open if a caller does not check first: a caller could make the
 * audit event throw, and so switch off their own access record, by typing a space.
 *
 * So a segment that does not match `isAccessObjectIdShape` is refused HERE, before the store is
 * touched and before an audit event is built. `notFound()` rather than a screen, and the
 * distinction is real rather than tidy: a well-formed identifier this team does not hold is a
 * GOVERNANCE FACT the screen states in words, while a segment that is not an identifier at all
 * names no version anywhere and never could. Nothing is read for it, so nothing is recorded for
 * it, which is the right outcome for a request that never became one.
 *
 * EVERY READ IS AUDITED, AND NONE OF THEM IS HTTP
 * ----------------------------------------------
 * The same shape the library uses, for the same reasons: this is a Server Component and reads the
 * store directly rather than calling this app's own API over HTTP, which would add a network hop,
 * a second copy of the failure handling, and an access trail recording the server calling itself.
 * What is read:
 *
 *   * the service state -- `{ administrative, serviceState, "service" }`, because the safety
 *     banner is required on every screen (Ruling 56) and must be a state that was actually read;
 *   * this one pathway version -- `{ view, pathwayVersion, <pathwayId> }`.
 *
 * NO NEW `AccessedObjectType` MEMBER, AND THAT IS RULING 46 FOLLOWED RATHER THAN SET ASIDE.
 * Ruling 46's named defect is a type carrying reads of DIFFERENT OBJECTS: `patientDirectory` held
 * two referral reads, so a patient-name read recorded against it would have been visible by eye
 * and unaskable, because the trail's query surface filters on `objectType` with NO `objectId`
 * filter at all. This screen releases a pathway version, which is exactly what `pathwayVersion`
 * names. What distinguishes this read from the library's is the objectId -- one named version
 * against `"all"` -- and that is the mechanism working as designed rather than an overload of it.
 * A `pathwayVersionDetail` member would name a SCREEN, not an object, and would split the answer
 * to "who read this team's governed pathway versions, and when" across two values that cannot be
 * asked for together, which is the harm Ruling 46 exists to prevent arriving from the other
 * direction. The rider Task 15 recorded still stands: if screen attribution is ever wanted, it
 * needs a `surface`/`context` dimension, never a second `objectType`.
 *
 * A DENIED READ IS NOT A FAILED ONE, AND THE PAGE MUST SAY WHICH FACT IT IS
 * ------------------------------------------------------------------------
 * `getPathwayVersion` answers `null` for a version that does not exist, for another team's
 * version, AND for an actor whose role covers neither governance capability -- deliberately
 * indistinguishable, so nobody can probe for a record they may not see. `auditedRead` therefore
 * records `denied`, which is a legitimate outcome here rather than a fault.
 *
 * The one part of that the page CAN decide with certainty is the capability, which is a fact about
 * the ACTOR. It asks the same any-of question `mayReadAny` asks inside the store, through
 * `PATHWAY_VERSION_READ_ACTIONS` itself rather than a second copy of that list -- a copy would be
 * free to stop agreeing with the store, and the screen would then state a capability the read did
 * not have. With that answered, a null release is either "this role may not read one" or "this
 * team holds no such version", and the screen states whichever it is instead of guessing. It never
 * distinguishes "no such version" from "another team's version", and says so.
 *
 * Every other bad outcome fails closed and reaches `error.tsx`, which says nothing was sent and
 * nothing was changed. Neither read here has an honest fallback: a governance record rendered
 * beside a service-state read that failed would claim sending is running during an incident, and a
 * record rendered from a failed read of its own contents would claim a governance record that was
 * never read -- on the one screen whose whole subject is what has and has not been approved.
 */
export default async function CaringContactsTemplateDetailPage({ params }: { params: Promise<{ pathwayId: string }> }) {
  if (!isCaringContactsWorkspaceEnabled()) notFound();
  const { pathwayId } = await params;
  // Before the store, before the actor, before any audit event exists to be thrown by. See the
  // module note: this is the check that stops a request switching off its own access record.
  if (!isAccessObjectIdShape(pathwayId)) notFound();

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

  // `PathwayVersion | null`, not `PathwayVersion`: `getPathwayVersion` answers null for three
  // different situations on purpose, and typing the read as non-nullable would be a claim the
  // store contract does not make.
  const versionRead = await auditedRead<PathwayVersion | null>(
    store,
    actor,
    { kind: "view", objectType: "pathwayVersion", objectId: pathwayId },
    () => store.getPathwayVersion(toPathwayVersionId(pathwayId), { actor }),
  );
  if (versionRead.outcome === "failed") {
    throw versionRead.error instanceof Error
      ? versionRead.error
      : new Error("Failed to read this team's pathway version.");
  }
  if (!versionRead.recorded) {
    throw new Error("Caring Contacts access trail is unavailable; nothing was rendered.");
  }

  const mayViewPathwayVersions = PATHWAY_VERSION_READ_ACTIONS.some(
    (action) => canPerformCaringContactAction(actor, action, { teamId: actor.teamId }).allowed,
  );

  // `== null`, deliberately, and the same loose equality every guard in this workspace uses for
  // the same reason: `auditedRead` treats null AND UNDEFINED as denied while `AuditedReadResult`
  // types `released` as `T | null`, so a `=== null` guard would let a contract-breaking
  // `undefined` through to be rendered as a version.
  const view: TemplateDetailView =
    versionRead.released == null
      ? mayViewPathwayVersions
        ? { kind: "not-held", pathwayId }
        : { kind: "not-permitted" }
      : { kind: "version", version: versionRead.released };

  return (
    <CaringContactsShell
      title="Template"
      description="One governed pathway version: where it has got to, who approved it, and the wording its own record holds. Every patient, number and message in this workspace is invented; nothing here is ever sent to a real number."
      serviceState={serviceState}
    >
      <TemplateDetail view={view} />
    </CaringContactsShell>
  );
}
