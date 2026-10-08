import { clearAccountScopedBrowserStorage } from "@/lib/account-scoped-browser-state";

// Browser infrastructure stays outside the sealed caring-contacts domain.
// A tab-local draft owner, not an authentication credential. Legacy/unbound drafts are discarded.
export const DRAFT_OWNER_STORAGE_KEY = "caring-contacts:plan-draft-owner";
export type BrowserSession = { actorId: string; teamId: string; expiresAt: number };
let boundSession: BrowserSession | null = null;
let revokedSession: BrowserSession | null = null;
let reloadRequested = false;
let needsFreshDocument = false;
const listeners = new Set<() => void>();

function readOwner(): BrowserSession | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(DRAFT_OWNER_STORAGE_KEY) ?? "null");
    if (
      value &&
      typeof value.actorId === "string" &&
      typeof value.teamId === "string" &&
      typeof value.expiresAt === "number" &&
      Number.isFinite(value.expiresAt)
    )
      return value;
  } catch {
    // Storage refusal falls back to the current page's in-memory binding.
  }
  return null;
}

export function clearBrowserSessionDraft(): void {
  try {
    window.sessionStorage.removeItem(DRAFT_OWNER_STORAGE_KEY);
  } catch {
    // The transition event also clears the draft store's in-memory fallback.
  }
  clearAccountScopedBrowserStorage();
}

export function endBrowserSession(): void {
  boundSession = null;
  clearBrowserSessionDraft();
  for (const listener of [...listeners]) listener();
}

export function signOutBrowserSession(): void {
  revokedSession = boundSession;
  endBrowserSession();
}

function isRevoked(session: BrowserSession): boolean {
  return (
    revokedSession !== null &&
    revokedSession.actorId === session.actorId &&
    revokedSession.teamId === session.teamId &&
    revokedSession.expiresAt === session.expiresAt
  );
}

function isCurrentSession(session: BrowserSession): boolean {
  return (
    boundSession !== null &&
    boundSession.actorId === session.actorId &&
    boundSession.teamId === session.teamId &&
    boundSession.expiresAt === session.expiresAt
  );
}

export function browserSessionIsBound(session: BrowserSession): boolean {
  return !needsFreshDocument && !isRevoked(session) && isCurrentSession(session) && session.expiresAt > Date.now();
}

/** Runs during React subscription, before draft-reading children can mount. */
export function subscribeBrowserSession(session: BrowserSession, listener: () => void): () => void {
  const incomingExpired = session.expiresAt <= Date.now();
  const mayBind = !needsFreshDocument && !isRevoked(session) && !incomingExpired;
  const previous = boundSession ?? readOwner();
  if (
    mayBind &&
    (previous === null ||
      previous.expiresAt <= Date.now() ||
      previous.actorId !== session.actorId ||
      previous.teamId !== session.teamId)
  )
    endBrowserSession();

  if (mayBind) {
    if (!isCurrentSession(session)) reloadRequested = false;
    boundSession = session;
    try {
      window.sessionStorage.setItem(DRAFT_OWNER_STORAGE_KEY, JSON.stringify(session));
    } catch {
      // Binding still protects the draft held only in memory on this page.
    }
  } else if (
    incomingExpired &&
    (isCurrentSession(session) || (boundSession === null && (previous === null || previous.expiresAt <= Date.now())))
  ) {
    endBrowserSession();
  }
  listeners.add(listener);
  listener();
  const expire = () => {
    if (isCurrentSession(session) && session.expiresAt <= Date.now()) endBrowserSession();
  };
  const suspend = () => {
    // Retain the same-user draft for the fresh document, but never reopen this cached binding.
    // Block ALL cached page identities, including soft back/forward payloads from another account.
    needsFreshDocument = true;
    if (boundSession !== null) revokedSession = boundSession;
    for (const currentListener of [...listeners]) currentListener();
  };
  const refresh = () => {
    expire();
    // An HttpOnly cookie cannot be checked in this document. A fresh request uses the existing
    // signed-session validator, instead of trusting a cached layout after authentication elsewhere.
    suspend();
    // Both the layout observer and the wizard subscribe; request one navigation for this binding.
    if (!reloadRequested) {
      reloadRequested = true;
      window.location.reload();
    }
  };
  const visibility = () => {
    if (document.visibilityState === "hidden") suspend();
    else refresh();
  };
  const restore = (event: PageTransitionEvent) => {
    if (event.persisted) refresh();
    else expire();
  };
  const timer = window.setTimeout(expire, Math.max(0, session.expiresAt - Date.now()));
  // Even a blocked cached subscriber keeps restoration handlers, so a later focus can reload.
  // Timers can be delayed while a tab is suspended or restored from the back/forward cache.
  window.addEventListener("focus", refresh);
  window.addEventListener("pageshow", restore);
  window.addEventListener("popstate", refresh);
  document.addEventListener("visibilitychange", visibility);
  return () => {
    listeners.delete(listener);
    window.clearTimeout(timer);
    window.removeEventListener("focus", refresh);
    window.removeEventListener("pageshow", restore);
    window.removeEventListener("popstate", refresh);
    document.removeEventListener("visibilitychange", visibility);
  };
}
