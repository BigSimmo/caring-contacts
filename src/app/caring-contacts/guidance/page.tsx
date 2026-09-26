import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { notFound } from "next/navigation";

import { ProgrammeGuidance } from "@/components/caring-contacts/workspace/programme-guidance";
import { auditedRead } from "@/lib/caring-contacts-server/handler";
import { isCaringContactsWorkspaceEnabled, resolveCaringContactsActor } from "@/lib/caring-contacts-server/session";
import { caringContactsStore } from "@/lib/caring-contacts-server/store";
import type { ServiceState } from "@/lib/caring-contacts/service-state";

/**
 * The workspace's lazy route boundary (Ruling 13). Same spelling and same reason as
 * `src/app/caring-contacts/page.tsx`, the caseload and the templates library: nothing outside this
 * route segment imports the workspace, and dynamically importing the shell keeps the Client
 * Components beneath it out of the PsychSift dashboard's chunks. That file's module note carries
 * the argument in full; one copy of it is the source of truth and two copies would drift.
 */
const CaringContactsShell = dynamic(() =>
  import("@/components/caring-contacts/workspace/shell").then((module) => module.CaringContactsShell),
);

/** The browser tab reads "Guidance · Caring Contacts" through the layout's title template. */
export const metadata: Metadata = { title: "Guidance" };

/**
 * Programme boundaries and operational guidance.
 *
 * THE ONLY THING THIS SCREEN READS IS THE SERVICE STATE, and that is not a shortcut. Guidance is
 * fixed text about how the programme is run: the words are held in the sealed domain and in the
 * component beside them, not in any record about anybody. There is no patient, plan, contact or
 * governance record on this screen, so there is nothing else to ask a store for.
 *
 * The service-state read is required all the same (Ruling 56): spec §4.2 puts the safety banner on
 * EVERY screen while a stop is active, and the shell's `serviceState` prop is required so a screen
 * cannot omit it. It must be a state that was actually READ -- passing a literal running state to
 * satisfy the type would render a confident "service running" during an incident.
 *
 * That read goes through `auditedRead` with the identity `api/caring-contacts/service-state`
 * records, `{ administrative, serviceState, "service" }`, so the trail does not grow a second
 * vocabulary for one read. Every bad outcome fails closed and reaches `error.tsx`, which says
 * nothing was sent and nothing was changed.
 *
 * NO NEW `AccessedObjectType` MEMBER, AND THAT IS RULING 46 FOLLOWED RATHER THAN SET ASIDE.
 * Ruling 46 says to add a member rather than OVERLOAD one, and the defect it names is a type
 * carrying reads of different things. Nothing is read here except the service state, which already
 * has its member. A `guidance` member would name a SCREEN rather than an object -- there is no
 * guidance object; there is a page of text -- and the trail's query surface filters on
 * `objectType` with no `objectId` filter, so a screen-named member splits one askable question in
 * two. Task 15 declined a member on exactly that reasoning and was upheld.
 *
 * The incident `note` inside the service-state record never crosses into a Client Component: this
 * page and the shell are both Server Components, and the banner's own parameter type omits the
 * note by construction.
 */
export default async function CaringContactsGuidancePage() {
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
  // `getServiceState` never returns null, so "denied" is not a reachable outcome for this read. A
  // null release would mean the store broke that contract, and the only honest response is to fail
  // closed rather than render guidance beside a claim that sending is running.
  if (serviceStateRead.released === null) {
    throw new Error("caring-contacts service state read returned no record.");
  }

  return (
    <CaringContactsShell
      title="Guidance"
      description="How this programme is run, where its boundaries are, and what to do when a system it depends on is unavailable. Every patient, number and message in this workspace is invented; nothing here is ever sent to a real number."
      serviceState={serviceStateRead.released}
    >
      <ProgrammeGuidance />
    </CaringContactsShell>
  );
}
