// tests/caring-contacts-team-claim-list.dom.test.tsx
//
// The Team screen's list of unclaimed plans, each with a "Claim this plan" control (owner decision
// 2026-09-26). Rendered here on its own, against the REAL assignment route and a real in-memory
// store, so a claim is proved by what the store then holds rather than by what the screen says.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  store: { current: null as unknown },
  router: { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: (name: string) => mockCookies[name] })),
}));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => mocks.router,
}));

vi.mock("@/lib/caring-contacts-server/store", () => ({
  caringContactsStore: async () => mocks.store.current,
}));

import { TeamClaimList } from "@/components/caring-contacts/workspace/team-claim-list";
import { CARING_CONTACTS_ROLE_COOKIE, demoActorForRole } from "@/lib/caring-contacts-server/session";
import { PLAN_ASSURANCE_VALUES } from "@/lib/caring-contacts/assurances";
import { fixedClock } from "@/lib/caring-contacts/clock";
import { idempotencyKey, pathwayVersionId, patientId, planId, referralId } from "@/lib/caring-contacts/ids";
import { createInMemoryRepository } from "@/lib/caring-contacts/in-memory-repository";
import type { CaringContactRepository } from "@/lib/caring-contacts/repository";
import type { TeamClaimEntry } from "@/components/caring-contacts/workspace/team-claim-list";

let mockCookies: Record<string, { value: string } | undefined> = {};

const NOW = "2026-03-02T03:00:00.000Z";

async function storeWithPlan(role: "teamLead" | "coordinator" = "teamLead"): Promise<CaringContactRepository> {
  mockCookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: role } };
  const store = createInMemoryRepository(fixedClock(NOW));
  const created = await store.createPlan(
    {
      planId: planId("SYN-PLAN-CLAIM"),
      referralId: referralId("SYN-REFERRAL-CLAIM"),
      patientId: patientId("SYN-PATIENT-CLAIM"),
      pathwayVersionId: pathwayVersionId("SYN-PATHWAY-001"),
      dischargeAt: new Date("2026-03-02T02:00:00.000Z"),
      sendingPreference: "morning",
      assurances: PLAN_ASSURANCE_VALUES,
      patientDetail: {
        patientName: "Synthetic Claimable",
        preferredName: "Synthetic",
        patientMobileNumber: "+61 491 570 156",
        patientIdentifiers: ["UR-CLAIM"],
        culturalIdentity: null,
      },
    },
    { actor: demoActorForRole("coordinator"), idempotencyKey: idempotencyKey("seed-claim-list") },
  );
  if (!created.ok) throw new Error(`seed createPlan refused: ${created.reason}`);
  mocks.store.current = store;
  return store;
}

/** Sends the screen's writes to the real assignment route, and records what it sent. */
function routeFetch() {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const raw = typeof init?.body === "string" ? init.body : "{}";
    sent.push({ url, body: JSON.parse(raw) as Record<string, unknown> });
    if (!url.startsWith("/api/caring-contacts/assignments/")) throw new Error(`unexpected URL ${url}`);
    const id = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1));
    const { POST } = await import("@/app/api/caring-contacts/assignments/[planId]/route");
    return POST(
      new Request(`http://localhost${url}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: raw,
      }) as unknown as NextRequest,
      { params: Promise.resolve({ planId: id }) },
    );
  });
  return sent;
}

const ENTRY: TeamClaimEntry = {
  planId: planId("SYN-PLAN-CLAIM"),
  minutesUnclaimed: 75,
  escalated: true,
  hold: "planNotStarted",
};

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.router.refresh.mockClear();
});

describe("the Team screen's unclaimed list - claiming a plan from it", () => {
  it("claims the plan for the account acting here, and the store records it", async () => {
    const user = userEvent.setup();
    const store = await storeWithPlan("teamLead");
    const sent = routeFetch();

    render(<TeamClaimList entries={[ENTRY]} actingActorId="demo-teamLead" />);
    const row = screen.getByTestId("caring-contacts-team-claim-row");
    expect(row).toHaveTextContent(/waiting 1 hour/i);
    expect(row).toHaveTextContent(/not started/i);

    await user.click(within(row).getByRole("button", { name: "Claim this plan" }));
    await waitFor(() => expect(row).toHaveTextContent(/you are now carrying this plan/i));

    expect(sent).toEqual([
      expect.objectContaining({
        url: "/api/caring-contacts/assignments/SYN-PLAN-CLAIM",
        body: expect.objectContaining({ action: { type: "claim", actorId: "demo-teamLead" } }),
      }),
    ]);
    const assignment = await store.getAssignment(planId("SYN-PLAN-CLAIM"), { actor: demoActorForRole("teamLead") });
    expect(assignment?.ownerId).toBe("demo-teamLead");
    expect(mocks.router.refresh).toHaveBeenCalled();
    // The control is spent once the plan is claimed, so a second press cannot be made.
    expect(within(row).queryByRole("button", { name: "Claim this plan" })).toBeNull();
  });

  it("states the service's refusal in plain words when somebody claimed it first", async () => {
    const user = userEvent.setup();
    const store = await storeWithPlan("teamLead");
    const first = await store.applyAssignment(
      { planId: planId("SYN-PLAN-CLAIM"), action: { type: "claim", actorId: demoActorForRole("coordinator").id } },
      { actor: demoActorForRole("coordinator"), idempotencyKey: idempotencyKey("claimed-elsewhere") },
    );
    if (!first.ok) throw new Error(`seed claim refused: ${first.reason}`);
    routeFetch();

    render(<TeamClaimList entries={[ENTRY]} actingActorId="demo-teamLead" />);
    await user.click(screen.getByRole("button", { name: "Claim this plan" }));

    await waitFor(() =>
      expect(screen.getByTestId("caring-contacts-team-claim-row")).toHaveTextContent(
        "Somebody took this plan on first",
      ),
    );
    const assignment = await store.getAssignment(planId("SYN-PLAN-CLAIM"), { actor: demoActorForRole("teamLead") });
    expect(assignment?.ownerId).toBe("demo-coordinator");
  });

  it("puts no plan or patient identifier in the words on screen", async () => {
    await storeWithPlan("teamLead");
    render(<TeamClaimList entries={[ENTRY]} actingActorId="demo-teamLead" />);

    const text = screen.getByTestId("caring-contacts-team-claim-list").textContent ?? "";
    // Positive control: the row rendered.
    expect(text).toMatch(/Claim this plan/);
    expect(text).not.toContain("SYN-PLAN-CLAIM");
    expect(text).not.toContain("SYN-PATIENT-CLAIM");
    expect(text).not.toMatch(/demo-/);
  });
});
