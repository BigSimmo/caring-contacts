// tests/caring-contacts-service-stop-page.dom.test.tsx
//
// `/caring-contacts/service-stop` (`src/app/caring-contacts/service-stop/page.tsx`) and
// `/caring-contacts/access-trail` (`src/app/caring-contacts/access-trail/page.tsx`).
//
// WHAT THIS FILE PROVES THAT THE SCREEN TESTS CANNOT
// --------------------------------------------------
//   * each render records its reads on the access trail with the SAME identity the matching API
//     route records, so the trail does not grow a second vocabulary for one read;
//   * the service stop page narrows the record through the API's own boundary before the screen
//     sees it, and the incident note never reaches the client controls' props -- proved by stopping
//     the service with a distinctive note and walking the element tree the page returns;
//   * the capabilities are decided from the actor, not inferred from what the store returned;
//   * every bad outcome fails closed, with nothing rendered.
import { render, screen } from "@testing-library/react";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  store: { current: null as unknown },
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: (name: string) => mockCookies[name] })),
}));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  notFound: mocks.notFound,
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock("@/lib/caring-contacts-server/store", () => ({
  caringContactsStore: async () => mocks.store.current,
}));

// The access trail page reads a window ending at "now"; the store stamps its events with the fixed
// clock below, so the page's clock is the same one or every event would fall outside the window.
vi.mock("@/lib/caring-contacts/clock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/caring-contacts/clock")>();
  return { ...actual, systemClock: () => actual.fixedClock("2026-03-02T03:00:00.000Z") };
});

import { RestartApprovalControls, ServiceStopForm } from "@/components/caring-contacts/workspace/service-stop-controls";
import { DEMO_RESTART_APPROVAL_SEATS } from "@/lib/caring-contacts-server/restart-approval-seats";
import { CARING_CONTACTS_ROLE_COOKIE, demoActorForRole } from "@/lib/caring-contacts-server/session";
import type { AccessRecord } from "@/lib/caring-contacts/access-audit";
import { fixedClock } from "@/lib/caring-contacts/clock";
import { idempotencyKey } from "@/lib/caring-contacts/ids";
import { createInMemoryRepository } from "@/lib/caring-contacts/in-memory-repository";
import type { CaringContactRepository } from "@/lib/caring-contacts/repository";

let mockCookies: Record<string, { value: string } | undefined> = {};

const NOW = "2026-03-02T03:00:00.000Z";
const NOTE = "SENTINEL-PAGE-NOTE patient on ward 7 received message meant for another";

/** Wraps a store so every access event it takes is visible, without changing what it does. */
function storeWithSpy(role: string): { store: CaringContactRepository; recorded: () => AccessRecord[] } {
  mockCookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: role } };
  const repository = createInMemoryRepository(fixedClock(NOW), { restartApprovalSeats: DEMO_RESTART_APPROVAL_SEATS });
  const records: AccessRecord[] = [];
  const store: CaringContactRepository = {
    ...repository,
    async recordAccess(record: AccessRecord) {
      await repository.recordAccess(record);
      records.push(record);
    },
  };
  mocks.store.current = store;
  return { store, recorded: () => records };
}

async function stop(store: CaringContactRepository) {
  const stopped = await store.stopService(
    { reason: "wrong-recipient", note: NOTE },
    { actor: demoActorForRole("coordinator"), idempotencyKey: idempotencyKey("seed-stop") },
  );
  if (!stopped.ok) throw new Error(`seed stop refused: ${stopped.reason}`);
}

type ShellElement = ReactElement<{ title: string; children: ReactElement }>;

async function renderServiceStopPage(): Promise<ShellElement> {
  const { default: Page } = await import("@/app/caring-contacts/service-stop/page");
  const element = (await Page()) as ShellElement;
  // The shell is the page's root; the screen it wraps is what this file inspects.
  render(element.props.children);
  return element;
}

async function renderAccessTrailPage(): Promise<ShellElement> {
  const { default: Page } = await import("@/app/caring-contacts/access-trail/page");
  const element = (await Page()) as ShellElement;
  render(element.props.children);
  return element;
}

/** Every element of the given component types in a rendered tree, props included. */
function propsOfEvery(node: ReactNode, types: readonly unknown[]): unknown[] {
  const found: unknown[] = [];
  const visit = (value: ReactNode) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isValidElement(value)) return;
    const props = value.props as { children?: ReactNode };
    if (types.includes(value.type)) found.push(props);
    if (typeof value.type === "function" && !types.includes(value.type)) {
      // Server components here are plain synchronous functions; render them to reach their children.
      visit((value.type as (p: unknown) => ReactNode)(props));
      return;
    }
    visit(props.children);
  };
  visit(node);
  return found;
}

beforeEach(() => {
  mockCookies = {};
  mocks.store.current = null;
  mocks.notFound.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the /caring-contacts/service-stop page", () => {
  it("records the service-state read with the same identity the API route records", async () => {
    const { recorded } = storeWithSpy("coordinator");

    const element = await renderServiceStopPage();

    expect(element.props.title).toBe("Service stop");
    expect(recorded()).toContainEqual(
      expect.objectContaining({
        kind: "administrative",
        objectType: "serviceState",
        objectId: "service",
        outcome: "allowed",
        actorId: demoActorForRole("coordinator").id,
      }),
    );
    expect(screen.getByRole("button", { name: "Stop all sending" })).toBeInTheDocument();
  });

  it("never hands the incident note to a client control, even to a role that may read it", async () => {
    const { store } = storeWithSpy("teamLead");
    await stop(store);

    const element = await renderServiceStopPage();

    // The screen, a Server Component, renders the note for this role -- the API releases it to them.
    expect(screen.getByTestId("caring-contacts-service-stop-note")).toHaveTextContent("SENTINEL-PAGE-NOTE");
    // THE POSITIVE CONTROL: the client controls ARE in the tree, so the absence below means something.
    const clientProps = propsOfEvery(element.props.children, [ServiceStopForm, RestartApprovalControls]);
    expect(clientProps.length, "no client control was found; the assertion below would prove nothing").toBeGreaterThan(
      0,
    );
    expect(JSON.stringify(clientProps)).not.toContain("SENTINEL-PAGE-NOTE");
  });

  it("offers the team lead the incident seat, the one the demo configuration names them for", async () => {
    const { store } = storeWithSpy("teamLead");
    await stop(store);

    await renderServiceStopPage();

    expect(screen.getByRole("button", { name: "Approve the restart as the incident lead" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /privacy and security owner/i })).toBeNull();
  });

  it("offers an auditor no approval control, because the role holds no approveServiceRestart", async () => {
    const { store } = storeWithSpy("auditor");
    await stop(store);

    await renderServiceStopPage();

    expect(screen.getByRole("group", { name: "This role cannot approve a restart" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /approve the restart/i })).toBeNull();
  });

  it("fails closed when the access trail cannot take the event", async () => {
    const { store } = storeWithSpy("coordinator");
    mocks.store.current = {
      ...store,
      async recordAccess() {
        throw new Error("trail down");
      },
    };

    await expect(renderServiceStopPage()).rejects.toThrow(/access trail is unavailable/i);
  });

  it("fails closed when the service state cannot be read", async () => {
    const { store } = storeWithSpy("coordinator");
    mocks.store.current = {
      ...store,
      async getServiceState() {
        throw new Error("state unreadable");
      },
    };

    await expect(renderServiceStopPage()).rejects.toThrow(/state unreadable/);
  });

  it("is not found where the workspace is disabled", async () => {
    storeWithSpy("coordinator");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CARING_CONTACTS_DEMO_ENABLED", "");
    vi.stubEnv("CARING_CONTACTS_SESSION_HMAC_SECRET", "");
    vi.stubEnv("PLAYWRIGHT_OFFLINE_MODE", "");

    await expect(renderServiceStopPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("the /caring-contacts/access-trail page", () => {
  it("lists the trail for a role that may read it, recorded with the API route's own identity", async () => {
    const { recorded } = storeWithSpy("auditor");

    const element = await renderAccessTrailPage();

    expect(element.props.title).toBe("Access trail");
    expect(recorded()).toContainEqual(
      expect.objectContaining({ kind: "search", objectType: "auditTrail", objectId: "all", outcome: "allowed" }),
    );
    // The service-state read this render made is on the trail it then lists.
    const entries = screen.getAllByTestId("caring-contacts-access-trail-entry");
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]).toHaveTextContent(/the service stop/i);
    expect(entries[0]).toHaveTextContent(demoActorForRole("auditor").id);
  });

  it("tells a role without viewAccessTrail that the trail is not visible, rather than that it is empty", async () => {
    storeWithSpy("coordinator");

    await renderAccessTrailPage();

    expect(screen.getByRole("group", { name: /not visible in this role/i })).toBeInTheDocument();
    expect(screen.queryByTestId("caring-contacts-access-trail")).toBeNull();
    expect(screen.queryByText(/nothing recorded in this window/i)).toBeNull();
  });

  it("fails closed when the trail read fails", async () => {
    const { store } = storeWithSpy("auditor");
    mocks.store.current = {
      ...store,
      async listAccessTrail() {
        throw new Error("trail unreadable");
      },
    };

    await expect(renderAccessTrailPage()).rejects.toThrow(/trail unreadable/);
  });
});
