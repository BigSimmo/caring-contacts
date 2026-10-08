"use client";

import { useCallback, useSyncExternalStore, type ReactNode } from "react";

import { planDraftIsHeld, subscribeToPlanDraft } from "@/components/caring-contacts/workspace/plan-wizard/plan-draft";

import {
  browserSessionIsBound,
  subscribeBrowserSession,
  type BrowserSession,
} from "@/lib/caring-contacts-browser-session";

const serverSnapshot = () => false;

function DraftReloadWarning() {
  const held = useSyncExternalStore(subscribeToPlanDraft, planDraftIsHeld, serverSnapshot);
  return held ? null : (
    <p role="alert">
      Browser storage is unavailable. Unsaved changes last only while this page stays open. Returning to this tab may
      reload it to check your session and discard those changes. Sign-out and session expiry also discard them.
    </p>
  );
}

export function BrowserSessionBoundary({ session, children }: { session: BrowserSession; children?: ReactNode }) {
  const { actorId, teamId, expiresAt } = session;
  const subscribe = useCallback(
    (listener: () => void) => subscribeBrowserSession({ actorId, teamId, expiresAt }, listener),
    [actorId, teamId, expiresAt],
  );
  const snapshot = useCallback(
    () => browserSessionIsBound({ actorId, teamId, expiresAt }),
    [actorId, teamId, expiresAt],
  );
  const ready = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  // The layout's observer renders nothing; only the wizard's page-specific seam gates readers.
  if (children === undefined) return null;
  return ready ? (
    <>
      <DraftReloadWarning />
      {children}
    </>
  ) : (
    <p role="status">
      <a href="/api/caring-contacts/auth/sign-in">Sign in to continue.</a>
    </p>
  );
}
