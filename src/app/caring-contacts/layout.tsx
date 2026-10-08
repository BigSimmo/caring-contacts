import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { BrowserSessionBoundary } from "@/components/caring-contacts/workspace/browser-session-boundary";
import {
  CARING_CONTACTS_PRODUCTION_SESSION_COOKIE,
  parseProductionSessionClaims,
} from "@/lib/caring-contacts-server/session-token";
import { isCaringContactsLiveEnabled } from "@/lib/caring-contacts-server/workspace-gate";

import { PRIVATE_APP_ROBOTS_METADATA } from "@/lib/crawler-policy";

// Listed in the live tools catalogue by the owner's decision of 19 August 2026, but never
// indexed: this workspace holds invented patients only and must not appear in a search result
// where its synthetic nature is not visible. Keep the shared private-app robots object even
// though the root layout is indexable — this route must remain noindex.
export const metadata: Metadata = {
  // Each page names itself ("Today", "Patients", ...) and the template adds the product name, so
  // a clinician with several tabs open can tell them apart. A page with no title of its own falls
  // back to the product name alone.
  title: { default: "Caring Contacts", template: "%s · Caring Contacts" },
  robots: PRIVATE_APP_ROBOTS_METADATA,
};

export default async function CaringContactsLayout({ children }: { children: ReactNode }) {
  if (!isCaringContactsLiveEnabled()) return children;
  const raw = (await cookies()).get(CARING_CONTACTS_PRODUCTION_SESSION_COOKIE)?.value;
  const claims = parseProductionSessionClaims(raw);
  if (!claims) redirect("/api/caring-contacts/auth/sign-in");
  return (
    <>
      {/* Observe expiry without hiding server screens or passing their contents across this seam. */}
      <BrowserSessionBoundary
        session={{ actorId: claims.actorId, teamId: claims.teamId, expiresAt: claims.exp * 1000 }}
      />
      {children}
    </>
  );
}
