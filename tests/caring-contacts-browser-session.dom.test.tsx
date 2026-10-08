import { act, fireEvent, render, screen } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let { emptyPlanDraft, writePlanDraft, planDraftSnapshot, planDraftServerSnapshot, subscribeToPlanDraft } =
  await import("@/components/caring-contacts/workspace/plan-wizard/plan-draft");
import { PLAN_DRAFT_STORAGE_KEY } from "@/lib/account-scoped-browser-state";
import type { BrowserSession } from "@/lib/caring-contacts-browser-session";
import { DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS } from "@/lib/caring-contacts/synthetic-contacts";

const NOW = new Date("2026-10-07T08:00:00Z").getTime();
let caseNumber = 0;
let A: BrowserSession;
let B: BrowserSession;
let BrowserSessionBoundary: (typeof import("@/components/caring-contacts/workspace/browser-session-boundary"))["BrowserSessionBoundary"];
let SignOutForm: (typeof import("@/components/caring-contacts/workspace/sign-out-form"))["SignOutForm"];
let DRAFT_OWNER_STORAGE_KEY: string;
let browserSessionIsBound: (typeof import("@/lib/caring-contacts-browser-session"))["browserSessionIsBound"];
let endBrowserSession: (typeof import("@/lib/caring-contacts-browser-session"))["endBrowserSession"];
let subscribeBrowserSession: (typeof import("@/lib/caring-contacts-browser-session"))["subscribeBrowserSession"];
let observedDrafts: string[] = [];
function saveDraft() {
  const draft = emptyPlanDraft("SYN-REFERRAL-001", null);
  draft.patientDetail.patientName = "Synthetic Draft Person";
  draft.patientDetail.patientMobileNumber = DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS[0];
  writePlanDraft(draft);
}
function DraftReader() {
  const draft = useSyncExternalStore(subscribeToPlanDraft, planDraftSnapshot, planDraftServerSnapshot);
  observedDrafts.push(draft?.patientDetail.patientName ?? "Empty draft");
  return <p data-testid="draft">{draft?.patientDetail.patientName ?? "Empty draft"}</p>;
}
function workspace(session: BrowserSession) {
  return (
    <BrowserSessionBoundary session={session}>
      <DraftReader />
    </BrowserSessionBoundary>
  );
}
beforeEach(async () => {
  // A blocked document can only resume via a new document/module lifetime, never a test reset API.
  vi.resetModules();
  ({ emptyPlanDraft, writePlanDraft, planDraftSnapshot, planDraftServerSnapshot, subscribeToPlanDraft } =
    await import("@/components/caring-contacts/workspace/plan-wizard/plan-draft"));
  ({ DRAFT_OWNER_STORAGE_KEY, browserSessionIsBound, endBrowserSession, subscribeBrowserSession } =
    await import("@/lib/caring-contacts-browser-session"));
  ({ BrowserSessionBoundary } = await import("@/components/caring-contacts/workspace/browser-session-boundary"));
  ({ SignOutForm } = await import("@/components/caring-contacts/workspace/sign-out-form"));
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  endBrowserSession();
  // Separate invented sessions so a revoked document's identity is never reused by another case.
  A = { actorId: `synthetic-staff-A-${++caseNumber}`, teamId: "synthetic-team", expiresAt: NOW + 60_000 };
  B = { ...A, actorId: `synthetic-staff-B-${caseNumber}` };
  window.sessionStorage.clear();
  observedDrafts = [];
});
afterEach(() => {
  endBrowserSession();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("synthetic staff draft lifecycle", () => {
  it("clears a legacy unbound draft before the first reader mounts and binds the fresh owner", () => {
    saveDraft();
    render(workspace(A));
    expect(screen.getByTestId("draft")).toHaveTextContent("Empty draft");
    expect(window.sessionStorage.getItem(PLAN_DRAFT_STORAGE_KEY)).toBeNull();
    expect(JSON.parse(window.sessionStorage.getItem(DRAFT_OWNER_STORAGE_KEY)!)).toEqual(A);
  });

  it("retains a same-user draft on remount and a same-user session refresh", () => {
    const view = render(workspace(A));
    act(saveDraft);
    view.unmount();
    const next = render(workspace(A));
    expect(screen.getByTestId("draft")).toHaveTextContent("Synthetic Draft Person");
    next.rerender(workspace({ ...A, expiresAt: NOW + 120_000 }));
    expect(screen.getByTestId("draft")).toHaveTextContent("Synthetic Draft Person");
  });

  it("retains a valid same-user stored draft after a full module reload", async () => {
    window.sessionStorage.setItem(DRAFT_OWNER_STORAGE_KEY, JSON.stringify(A));
    saveDraft();
    vi.resetModules();
    const fresh = await import("@/lib/caring-contacts-browser-session");
    const unsubscribe = fresh.subscribeBrowserSession(A, () => {});
    expect(window.sessionStorage.getItem(PLAN_DRAFT_STORAGE_KEY)).not.toBeNull();
    unsubscribe();
    fresh.endBrowserSession();
  });

  it("clears A's draft before B can read the same referral and binds B", () => {
    const view = render(workspace(A));
    act(saveDraft);
    observedDrafts = [];
    view.rerender(workspace(B));
    expect(screen.getByTestId("draft")).toHaveTextContent("Empty draft");
    expect(planDraftSnapshot()).toBeNull();
    expect(JSON.parse(window.sessionStorage.getItem(DRAFT_OWNER_STORAGE_KEY)!)).toEqual(B);
    expect(observedDrafts).not.toContain("Synthetic Draft Person");
  });

  it("clears A's persisted draft when B arrives after a full page reload", () => {
    window.sessionStorage.setItem(DRAFT_OWNER_STORAGE_KEY, JSON.stringify(A));
    saveDraft();
    render(workspace(B));
    expect(screen.getByTestId("draft")).toHaveTextContent("Empty draft");
    expect(window.sessionStorage.getItem(PLAN_DRAFT_STORAGE_KEY)).toBeNull();
    expect(JSON.parse(window.sessionStorage.getItem(DRAFT_OWNER_STORAGE_KEY)!)).toEqual(B);
  });

  it("treats a malformed owner as unbound and preserves unrelated tab storage", () => {
    window.sessionStorage.setItem(DRAFT_OWNER_STORAGE_KEY, "invalid synthetic metadata");
    window.sessionStorage.setItem("synthetic-unrelated-key", "keep");
    saveDraft();
    render(workspace(A));
    expect(window.sessionStorage.getItem(PLAN_DRAFT_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem("synthetic-unrelated-key")).toBe("keep");
  });

  it("clears on team transition, even for the same staff identity", () => {
    const view = render(workspace(A));
    act(saveDraft);
    view.rerender(workspace({ ...A, teamId: "other-synthetic-team" }));
    expect(screen.getByTestId("draft")).toHaveTextContent("Empty draft");
  });

  it("clears before the native sign-out POST, then B starts empty", () => {
    const view = render(
      <>
        <SignOutForm>
          <button type="submit">Sign out</button>
        </SignOutForm>
        <BrowserSessionBoundary session={A}>
          <DraftReader />
        </BrowserSessionBoundary>
      </>,
    );
    act(saveDraft);
    const form = screen.getByRole("button", { name: "Sign out" }).closest("form")!;
    expect(fireEvent.submit(form)).toBe(true);
    expect(form).toBeInTheDocument();
    expect(form).toHaveAttribute("action", "/api/caring-contacts/auth/sign-out");
    expect(form).toHaveAttribute("method", "post");
    expect(window.sessionStorage.getItem(PLAN_DRAFT_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(DRAFT_OWNER_STORAGE_KEY)).toBeNull();
    expect(planDraftSnapshot()).toBeNull();
    expect(browserSessionIsBound(A)).toBe(false);
    expect(screen.queryByTestId("draft")).toBeNull();
    const staleSubscriber = subscribeBrowserSession(A, () => {});
    expect(browserSessionIsBound(A)).toBe(false);
    staleSubscriber();
    view.rerender(workspace(B));
    expect(screen.getByTestId("draft")).toHaveTextContent("Empty draft");
    act(saveDraft);
    view.rerender(workspace({ ...B, expiresAt: NOW + 120_000 }));
    act(() => {
      vi.setSystemTime(NOW + 60_001);
      const staleExpiredSubscriber = subscribeBrowserSession(A, () => {});
      staleExpiredSubscriber();
    });
    expect(screen.getByTestId("draft")).toHaveTextContent("Synthetic Draft Person");
  });

  it("clears on session expiry and blocks the old reader, then B starts empty", () => {
    const view = render(workspace(A));
    act(saveDraft);
    act(() => vi.advanceTimersByTime(60_000));
    expect(window.sessionStorage.getItem(PLAN_DRAFT_STORAGE_KEY)).toBeNull();
    expect(planDraftSnapshot()).toBeNull();
    expect(screen.queryByTestId("draft")).toBeNull();
    expect(screen.getByRole("link", { name: "Sign in to continue." })).toHaveAttribute(
      "href",
      "/api/caring-contacts/auth/sign-in",
    );
    view.rerender(workspace({ ...B, expiresAt: NOW + 120_000 }));
    expect(screen.getByTestId("draft")).toHaveTextContent("Empty draft");
    act(saveDraft);
    expect(planDraftSnapshot()).not.toBeNull();
    act(() => {
      // Ordinary expiry, without a sign-out tombstone: stale A must not clear valid B either.
      const staleExpiredSubscriber = subscribeBrowserSession(A, () => {});
      staleExpiredSubscriber();
    });
    expect(planDraftSnapshot()).not.toBeNull();
    expect(screen.getByTestId("draft")).toHaveTextContent("Synthetic Draft Person");
    expect(JSON.parse(window.sessionStorage.getItem(DRAFT_OWNER_STORAGE_KEY)!).actorId).toBe(B.actorId);
  });

  it("clears expired stored ownership on same-user reauthentication after navigation", () => {
    window.sessionStorage.setItem(DRAFT_OWNER_STORAGE_KEY, JSON.stringify({ ...A, expiresAt: NOW - 1 }));
    saveDraft();
    render(workspace(A));
    expect(screen.getByTestId("draft")).toHaveTextContent("Empty draft");
  });

  it("clears on focus after a suspended tab passes expiry", () => {
    render(workspace(A));
    act(saveDraft);
    vi.setSystemTime(NOW + 60_001);
    fireEvent.focus(window);
    expect(planDraftSnapshot()).toBeNull();
    expect(screen.queryByTestId("draft")).toBeNull();
  });

  it("blocks suspended readers while retaining a valid same-user draft for a fresh document", () => {
    render(workspace(A));
    act(saveDraft);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    expect(browserSessionIsBound(A)).toBe(false);
    expect(screen.queryByTestId("draft")).toBeNull();
    expect(window.sessionStorage.getItem(PLAN_DRAFT_STORAGE_KEY)).not.toBeNull();
    expect(planDraftSnapshot()).not.toBeNull();
    const staleSubscriber = subscribeBrowserSession(A, () => {});
    expect(browserSessionIsBound(A)).toBe(false);
    staleSubscriber();
    expect(window.sessionStorage.getItem(PLAN_DRAFT_STORAGE_KEY)).not.toBeNull();
    const cachedOtherOwner = subscribeBrowserSession(B, () => {});
    expect(browserSessionIsBound(B)).toBe(false);
    cachedOtherOwner();
  });

  it("blocks cached page identities on soft back/forward before a fresh document request", () => {
    render(workspace(B));
    act(saveDraft);
    fireEvent(window, new PopStateEvent("popstate"));
    expect(browserSessionIsBound(B)).toBe(false);
    expect(screen.queryByTestId("draft")).toBeNull();
    const staleSubscriber = subscribeBrowserSession(A, () => {});
    expect(browserSessionIsBound(A)).toBe(false);
    expect(planDraftSnapshot()).not.toBeNull();
    staleSubscriber();
  });

  it("never mounts an expired draft reader when returning to an unmounted workspace", () => {
    const view = render(workspace(A));
    act(saveDraft);
    view.unmount();
    vi.setSystemTime(NOW + 60_001);
    observedDrafts = [];
    render(workspace(A));
    expect(observedDrafts).toEqual([]);
    expect(planDraftSnapshot()).toBeNull();
    expect(screen.queryByTestId("draft")).toBeNull();
  });

  it("clears in-memory drafts when storage refuses writes", () => {
    const storageWrite = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Synthetic storage refusal");
    });
    const view = render(workspace(A));
    act(saveDraft);
    expect(storageWrite).toHaveBeenCalled();
    expect(planDraftSnapshot()).not.toBeNull();
    view.rerender(workspace(B));
    expect(planDraftSnapshot()).toBeNull();
  });

  it("warns when draft writes fail even though owner metadata can still be stored", () => {
    const setItem = Storage.prototype.setItem;
    const refused = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === PLAN_DRAFT_STORAGE_KEY) throw new Error("Synthetic draft quota refusal");
      setItem.call(this, key, value);
    });
    render(workspace(A));
    expect(screen.queryByRole("alert")).toBeNull();
    act(saveDraft);
    expect(refused).toHaveBeenCalledWith(PLAN_DRAFT_STORAGE_KEY, expect.any(String));
    expect(screen.getByRole("alert")).toHaveTextContent("Returning to this tab may reload it");
    expect(screen.getByTestId("draft")).toHaveTextContent("Synthetic Draft Person");
    expect(window.sessionStorage.getItem(PLAN_DRAFT_STORAGE_KEY)).toBeNull();
    refused.mockRestore();
    act(saveDraft);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("warns before editing when access to storage is refused, then still blocks suspended readers", () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new Error("Synthetic storage access refusal");
    });
    render(workspace(A));
    expect(screen.getByRole("alert")).toHaveTextContent("Sign-out and session expiry also discard them");
    act(saveDraft);
    expect(planDraftSnapshot()).not.toBeNull();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    expect(browserSessionIsBound(A)).toBe(false);
    expect(screen.queryByTestId("draft")).toBeNull();
  });

  it("removes timers and listeners on unmount without discarding an active draft", () => {
    const unsubscribe = subscribeBrowserSession(A, () => {});
    saveDraft();
    unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
    expect(planDraftSnapshot()).not.toBeNull();
  });
});
