import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { notFound } from "next/navigation";

import {
  buildServiceStopScreenModel,
  ServiceStopScreen,
} from "@/components/caring-contacts/workspace/service-stop-screen";
import { auditedRead } from "@/lib/caring-contacts-server/handler";
import { restartApprovalSeatsInForce } from "@/lib/caring-contacts-server/restart-approval-seats";
import { narrowServiceStateForActor } from "@/lib/caring-contacts-server/service-state-view";
import { isCaringContactsWorkspaceEnabled, resolveCaringContactsActor } from "@/lib/caring-contacts-server/session";
import { caringContactsStore } from "@/lib/caring-contacts-server/store";
import type { ServiceState } from "@/lib/caring-contacts/service-state";

/**
 * The workspace's lazy route boundary (Ruling 13). Same spelling and same reason as
 * `src/app/caring-contacts/page.tsx` and every other screen in this segment; that file's module
 * note carries the argument in full.
 */
const CaringContactsShell = dynamic(() =>
  import("@/components/caring-contacts/workspace/shell").then((module) => module.CaringContactsShell),
);

/**
 * Where the screen's two writes go. The existing route, unchanged: `POST {type: "stop"}` needs
 * `triggerServiceSafetyStop`, `POST {type: "approveRestart"}` needs `approveServiceRestart`, and the
 * route checks both on every request. Declared here and handed to the client controls as a prop,
 * because a client module in this workspace may not name the stop record's module -- see
 * `service-stop-controls.tsx`.
 */
const SERVICE_STOP_ENDPOINT = "/api/caring-contacts/service-state";

/** The browser tab reads "Service stop · Caring Contacts" through the layout's title template. */
export const metadata: Metadata = { title: "Service stop" };

/**
 * The service stop screen (owner request 2026-09-26: "The emergency safety stop has no button.
 * Stopping all sending during an incident currently needs a developer.").
 *
 * ONE READ, AUDITED, AND NOT OVER HTTP. The service state is read once, through `auditedRead`, with
 * the SAME access identity `api/caring-contacts/service-state`'s GET records --
 * `{ administrative, serviceState, "service" }` -- and that one read serves both the shell's banner
 * and this screen. Every other screen already makes exactly this read for its banner, so this screen
 * adds no new kind of access.
 *
 * NARROWED AT THE SAME BOUNDARY AS THE API. The shell takes the whole record, as on every screen
 * (it renders the banner through a type that omits the note). The screen takes the record only
 * after `narrowServiceStateForActor` -- the API's own narrowing, Ruling 43 -- so the incident note
 * reaches this screen for exactly the people the GET releases it to, and for nobody else.
 *
 * FAILS CLOSED. A read that failed, an access trail that could not take the event, and a missing
 * record each throw to `error.tsx`, which says nothing was sent and nothing was changed. On this
 * screen above all, a "running" rendered from a read that never happened would tell a responder mid-
 * incident that there is nothing to stop.
 *
 * Reading the role cookie makes this route dynamic, which is correct: a cached copy would show a
 * stop that has since been raised or lifted.
 */
export default async function CaringContactsServiceStopPage() {
  if (!isCaringContactsWorkspaceEnabled()) notFound();
  const actor = await resolveCaringContactsActor();
  const store = await caringContactsStore();

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

  const model = buildServiceStopScreenModel({
    view: narrowServiceStateForActor(serviceState, actor),
    actor,
    seats: restartApprovalSeatsInForce(),
    endpoint: SERVICE_STOP_ENDPOINT,
  });

  return (
    <CaringContactsShell
      title="Service stop"
      description="Stopping all caring-contact sending for the whole service during an incident, and the three approvals that start it again."
      serviceState={serviceState}
    >
      <ServiceStopScreen model={model} />
    </CaringContactsShell>
  );
}
