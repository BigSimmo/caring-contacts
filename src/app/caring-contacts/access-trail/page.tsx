import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { notFound } from "next/navigation";

import { AccessTrailList } from "@/components/caring-contacts/workspace/access-trail-list";
import { auditedRead } from "@/lib/caring-contacts-server/handler";
import { isCaringContactsWorkspaceEnabled, resolveCaringContactsActor } from "@/lib/caring-contacts-server/session";
import { caringContactsStore } from "@/lib/caring-contacts-server/store";
import type { AuditEvent } from "@/lib/caring-contacts/audit";
import { systemClock } from "@/lib/caring-contacts/clock";
import { canPerformCaringContactAction } from "@/lib/caring-contacts/permissions";
import { READ_ACTIONS } from "@/lib/caring-contacts/repository";
import type { ServiceState } from "@/lib/caring-contacts/service-state";

/**
 * The workspace's lazy route boundary (Ruling 13). Same spelling and same reason as
 * `src/app/caring-contacts/page.tsx`; that file's module note carries the argument in full.
 */
const CaringContactsShell = dynamic(() =>
  import("@/components/caring-contacts/workspace/shell").then((module) => module.CaringContactsShell),
);

/** How far back the screen looks. Stated on the screen, so a reader never guesses the period. */
const ACCESS_TRAIL_WINDOW_DAYS = 7;
/** The most one read returns -- the API route's own ceiling. Reaching it is stated on the screen. */
const ACCESS_TRAIL_LIMIT = 500;

/** The browser tab reads "Access trail · Caring Contacts" through the layout's title template. */
export const metadata: Metadata = { title: "Access trail" };

/**
 * The access trail, read-only.
 *
 * EVERY READ IS AUDITED, AND NONE OF THEM IS HTTP -- the same shape as every other screen here:
 *
 *   * the service state -- `{ administrative, serviceState, "service" }`, for the banner every
 *     screen carries (Ruling 56);
 *   * the trail itself -- `{ search, auditTrail, "all" }`, byte for byte the identity
 *     `api/caring-contacts/access-trail`'s POST records. Reading the trail is itself an access, so
 *     an auditor's own views sit in the trail beside everybody else's.
 *
 * THE CAPABILITY IS DECIDED FROM THE ACTOR. `listAccessTrail` answers a role without
 * `viewAccessTrail` with `[]`, exactly as it answers a quiet week, so the page asks the store's own
 * question (`READ_ACTIONS.auditTrail`) and tells the screen which fact it is. The read is still
 * made, and recorded, for every role -- the same as the reports and team screens -- so an attempt to
 * read the trail by a role that may not is on the trail too.
 *
 * Every bad outcome fails closed and reaches `error.tsx`. An empty trail rendered from a read that
 * failed would tell an auditor that nobody opened anything, which is the one false statement this
 * screen exists to rule out.
 */
export default async function CaringContactsAccessTrailPage() {
  if (!isCaringContactsWorkspaceEnabled()) notFound();
  const actor = await resolveCaringContactsActor();
  const store = await caringContactsStore();
  const now = systemClock().now();

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
  if (serviceStateRead.released == null) {
    throw new Error("caring-contacts service state read returned no record.");
  }
  const serviceState = serviceStateRead.released;

  const windowFrom = new Date(now.getTime() - ACCESS_TRAIL_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const trailRead = await auditedRead<AuditEvent[]>(
    store,
    actor,
    { kind: "search", objectType: "auditTrail", objectId: "all" },
    () =>
      store.listAccessTrail(
        {
          fromIso: windowFrom.toISOString(),
          toIso: now.toISOString(),
          limit: ACCESS_TRAIL_LIMIT,
          offset: 0,
          newestFirst: true,
        },
        { actor },
      ),
  );
  if (trailRead.outcome === "failed") {
    throw trailRead.error instanceof Error ? trailRead.error : new Error("Failed to read the access trail.");
  }
  if (!trailRead.recorded) {
    throw new Error("Caring Contacts access trail is unavailable; nothing was rendered.");
  }
  // `== null`, the same loose equality the other screens' guards use: `auditedRead` treats null AND
  // undefined as denied while typing `released` as `T | null`.
  if (trailRead.released == null) {
    throw new Error("caring-contacts access trail read returned no list.");
  }

  const mayViewAccessTrail = canPerformCaringContactAction(actor, READ_ACTIONS.auditTrail, {
    teamId: actor.teamId,
  }).allowed;

  return (
    <CaringContactsShell
      title="Access trail"
      description="Who opened, searched or changed which record, and when. Read-only."
      serviceState={serviceState}
    >
      <AccessTrailList
        entries={trailRead.released}
        mayViewAccessTrail={mayViewAccessTrail}
        windowDays={ACCESS_TRAIL_WINDOW_DAYS}
        limit={ACCESS_TRAIL_LIMIT}
      />
    </CaringContactsShell>
  );
}
