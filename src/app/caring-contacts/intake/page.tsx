import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { notFound } from "next/navigation";

import { ManualIntakeForm } from "@/components/caring-contacts/workspace/manual-intake-form";
import { auditedRead } from "@/lib/caring-contacts-server/handler";
import { isCaringContactsWorkspaceEnabled, resolveCaringContactsActor } from "@/lib/caring-contacts-server/session";
import { caringContactsStore } from "@/lib/caring-contacts-server/store";
import type { ServiceState } from "@/lib/caring-contacts/service-state";

/**
 * The workspace's lazy route boundary (Ruling 13). Same spelling and reason as
 * `src/app/caring-contacts/page.tsx` and the other workspace routes: dynamically importing
 * the shell keeps Client Components beneath it out of unrelated chunks.
 */
const CaringContactsShell = dynamic(() =>
  import("@/components/caring-contacts/workspace/shell").then((module) => module.CaringContactsShell),
);

/** The browser tab reads "Referral intake · Caring Contacts" through the layout's title template. */
export const metadata: Metadata = { title: "Referral intake" };

/**
 * Hospital referral intake fallback screen (Hazard H-44).
 *
 * Provides manual clinical intake when automated WA Health hospital discharge feeds
 * (HL7 v2 or FHIR) are unavailable, delayed, or during early pilot onboarding.
 *
 * Every read is audited through `auditedRead`. The service state is read to ensure
 * the safety banner renders appropriately during any service-wide stop (Ruling 56).
 */
export default async function CaringContactsIntakePage() {
  if (!isCaringContactsWorkspaceEnabled()) notFound();
  const actor = await resolveCaringContactsActor();
  const store = await caringContactsStore();

  // Read service state through the audited seam
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

  return (
    <CaringContactsShell
      title="Referral intake"
      description="Manual clinical intake fallback for hospital discharge referrals when structured electronic feeds are unavailable (Hazard H-44)."
      serviceState={serviceStateRead.released}
    >
      <ManualIntakeForm />
    </CaringContactsShell>
  );
}
