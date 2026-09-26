// tests/caring-contacts-service-stop-screen.dom.test.tsx
//
// The service stop screen (owner request 2026-09-26: "The emergency safety stop has no button.
// Stopping all sending during an incident currently needs a developer.").
//
// Rendered here against the REAL service-state route and a real in-memory store, so a stop or an
// approval is proved by what the store then holds, not by what the screen says. What it proves:
//
//   * role gating -- an actor without `triggerServiceSafetyStop` gets no stop button and is told who
//     can, and an actor without `approveServiceRestart` gets no approval control;
//   * the stop flow -- reason, a required note, a confirm step that says what happens -- posts
//     exactly `{type: "stop", reason, note, idempotencyKey}` and the store is then stopped;
//   * the stopped state shows the approvals so far, and a seat holder can record theirs;
//   * a refusal is shown and announced in plain words, never as the service's identifier alone.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  store: { current: null as unknown },
  router: { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() },
  announce: vi.fn(),
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

vi.mock("@/components/ui/live-announcer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/live-announcer")>()),
  announce: mocks.announce,
}));

import {
  buildServiceStopScreenModel,
  ServiceStopScreen,
} from "@/components/caring-contacts/workspace/service-stop-screen";
import { DEMO_RESTART_APPROVAL_SEATS } from "@/lib/caring-contacts-server/restart-approval-seats";
import { narrowServiceStateForActor } from "@/lib/caring-contacts-server/service-state-view";
import { CARING_CONTACTS_ROLE_COOKIE, demoActorForRole } from "@/lib/caring-contacts-server/session";
import { fixedClock } from "@/lib/caring-contacts/clock";
import { idempotencyKey } from "@/lib/caring-contacts/ids";
import { createInMemoryRepository } from "@/lib/caring-contacts/in-memory-repository";
import type { Actor, CaringContactRole } from "@/lib/caring-contacts/permissions";
import type { CaringContactRepository } from "@/lib/caring-contacts/repository";

let mockCookies: Record<string, { value: string } | undefined> = {};

const NOW = "2026-03-02T03:00:00.000Z";
const ENDPOINT = "/api/caring-contacts/service-state";
const NOTE = "SENTINEL-NOTE message 4 went to the wrong ward phone";

function freshStore(): CaringContactRepository {
  const store = createInMemoryRepository(fixedClock(NOW), { restartApprovalSeats: DEMO_RESTART_APPROVAL_SEATS });
  mocks.store.current = store;
  return store;
}

function actingAs(role: CaringContactRole): Actor {
  mockCookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: role } };
  return demoActorForRole(role);
}

async function stopDirectly(store: CaringContactRepository) {
  const stopped = await store.stopService(
    { reason: "wrong-recipient", note: NOTE },
    { actor: demoActorForRole("coordinator"), idempotencyKey: idempotencyKey("seed-stop") },
  );
  if (!stopped.ok) throw new Error(`seed stop refused: ${stopped.reason}`);
}

async function renderScreen(store: CaringContactRepository, actor: Actor) {
  const state = await store.getServiceState({ actor });
  const model = buildServiceStopScreenModel({
    view: narrowServiceStateForActor(state, actor),
    actor,
    seats: DEMO_RESTART_APPROVAL_SEATS,
    endpoint: ENDPOINT,
  });
  return render(<ServiceStopScreen model={model} />);
}

/** Sends the screen's writes to the real route, and records what it sent. */
function routeFetch(override?: (url: string) => Response | null) {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const raw = typeof init?.body === "string" ? init.body : "{}";
    sent.push({ url, body: JSON.parse(raw) as Record<string, unknown> });
    const overridden = override?.(url) ?? null;
    if (overridden !== null) return overridden;
    if (url !== ENDPOINT) throw new Error(`unexpected URL ${url}`);
    const { POST } = await import("@/app/api/caring-contacts/service-state/route");
    return POST(
      new Request(`http://localhost${url}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: raw,
      }) as unknown as NextRequest,
    );
  });
  return sent;
}

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.router.refresh.mockClear();
  mocks.announce.mockClear();
  mockCookies = {};
});

describe("the service stop screen - who may stop sending", () => {
  it("offers the stop button to a role that holds triggerServiceSafetyStop", async () => {
    const store = freshStore();
    await renderScreen(store, actingAs("coordinator"));

    expect(screen.getByText(/sending is running for the whole service/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop all sending" })).toBeInTheDocument();
  });

  it("shows no stop button to an actor without the capability, and says who can", async () => {
    // Every human role holds triggerServiceSafetyStop by design (rule 6: stopping must never be
    // blocked by a permission check), so the only actor without it is one with no role at all.
    const store = freshStore();
    const roleless: Actor = { ...demoActorForRole("coordinator"), roles: [] };
    await renderScreen(store, roleless);

    expect(screen.queryByRole("button", { name: "Stop all sending" })).toBeNull();
    const explanation = screen.getByRole("group", { name: "This role cannot stop sending" });
    expect(explanation).toHaveTextContent(/coordinator/);
    expect(explanation).toHaveTextContent(/auditor/);
  });
});

describe("the service stop screen - stopping all sending", () => {
  it("asks for a reason and a note, states what happens, then posts exactly the stop body", async () => {
    const store = freshStore();
    const actor = actingAs("coordinator");
    const sent = routeFetch();
    const user = userEvent.setup();
    await renderScreen(store, actor);

    await user.click(screen.getByRole("button", { name: "Stop all sending" }));

    // Both fields are required before the confirm step.
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Choose what kind of incident this is.")).toBeInTheDocument();
    expect(mocks.announce).toHaveBeenCalledWith("Choose what kind of incident this is.", expect.anything());
    await user.click(screen.getByRole("radio", { name: /wrong recipient/i }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Write what happened in the incident note.")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/incident note/i), NOTE);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    const confirm = screen.getByTestId("caring-contacts-service-stop-confirm");
    expect(within(confirm).getByRole("heading", { name: "Stop all sending now?" })).toBeInTheDocument();
    expect(confirm).toHaveTextContent(/every scheduled message stops, for every patient and every team/i);
    expect(confirm).toHaveTextContent(
      /three different people: the incident lead, the privacy and security owner and the clinical programme lead/i,
    );
    expect(sent).toEqual([]);

    await user.click(within(confirm).getByRole("button", { name: "Stop all sending now" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].url).toBe(ENDPOINT);
    expect(Object.keys(sent[0].body).sort()).toEqual(["idempotencyKey", "note", "reason", "type"]);
    expect(sent[0].body).toMatchObject({ type: "stop", reason: "wrong-recipient", note: NOTE });
    expect(sent[0].body.idempotencyKey).toMatch(/^SERVICE-STOP-[a-p]+$/);

    await waitFor(async () => expect((await store.getServiceState({ actor })).stopped).toBe(true));
    await waitFor(() =>
      expect(mocks.announce).toHaveBeenCalledWith(
        expect.stringMatching(/all sending is stopped for the whole service/i),
        expect.objectContaining({ priority: "assertive" }),
      ),
    );
    expect(mocks.router.refresh).toHaveBeenCalled();
  });

  it("uses a fresh key for a different submission, and the same key for a retry of the same one", async () => {
    const store = freshStore();
    const actor = actingAs("coordinator");
    let failNext = true;
    const sent = routeFetch(() => {
      if (!failNext) return null;
      failNext = false;
      throw new TypeError("network down");
    });
    const user = userEvent.setup();
    await renderScreen(store, actor);

    await user.click(screen.getByRole("button", { name: "Stop all sending" }));
    await user.click(screen.getByRole("radio", { name: /duplicate send/i }));
    await user.type(screen.getByLabelText(/incident note/i), "second copy of message 2 went out");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Stop all sending now" }));

    // The first attempt never reached the service: said plainly, and the store is untouched.
    await screen.findByRole("group", { name: "The request may not have reached the service" });
    expect((await store.getServiceState({ actor })).stopped).toBe(false);

    await user.click(screen.getByRole("button", { name: "Stop all sending now" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].body.idempotencyKey).toBe(sent[0].body.idempotencyKey);
    await waitFor(async () => expect((await store.getServiceState({ actor })).stopped).toBe(true));
  });

  it("mints a new key when the submission is edited after the confirm step", async () => {
    const store = freshStore();
    const actor = actingAs("coordinator");
    const sent = routeFetch(() => new Response(JSON.stringify({ refusal: "write-failed" }), { status: 500 }));
    const user = userEvent.setup();
    await renderScreen(store, actor);

    await user.click(screen.getByRole("button", { name: "Stop all sending" }));
    await user.click(screen.getByRole("radio", { name: /duplicate send/i }));
    await user.type(screen.getByLabelText(/incident note/i), "first account");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Stop all sending now" }));
    await screen.findByRole("group", { name: "The service could not record this" });

    await user.click(screen.getByRole("button", { name: "Go back" }));
    await user.type(screen.getByLabelText(/incident note/i), " with more detail");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Stop all sending now" }));

    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].body.idempotencyKey).not.toBe(sent[0].body.idempotencyKey);
  });

  it("puts a refusal into plain words and announces it", async () => {
    const store = freshStore();
    const actor = actingAs("coordinator");
    routeFetch(() => new Response(JSON.stringify({ refusal: "service-already-stopped" }), { status: 422 }));
    const user = userEvent.setup();
    await renderScreen(store, actor);

    await user.click(screen.getByRole("button", { name: "Stop all sending" }));
    await user.click(screen.getByRole("radio", { name: /wrong recipient/i }));
    await user.type(screen.getByLabelText(/incident note/i), "an account");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Stop all sending now" }));

    expect(await screen.findByRole("group", { name: "Sending was already stopped" })).toBeInTheDocument();
    expect(mocks.announce).toHaveBeenCalledWith(
      expect.stringMatching(/^Sending was already stopped\./),
      expect.objectContaining({ priority: "assertive" }),
    );
    expect(document.body.textContent).not.toMatch(/service-already-stopped/);
    expect(mocks.router.refresh).toHaveBeenCalled();
  });
});

describe("the service stop screen - while sending is stopped", () => {
  it("shows the stop's facts and the approvals so far, and no second stop button", async () => {
    const store = freshStore();
    await stopDirectly(store);
    const lead = demoActorForRole("teamLead");
    const approved = await store.approveServiceRestart(
      { role: "incidentLead" },
      { actor: lead, idempotencyKey: idempotencyKey("seed-approve") },
    );
    if (!approved.ok) throw new Error(`seed approval refused: ${approved.reason}`);

    await renderScreen(store, actingAs("coordinator"));

    const state = screen.getByTestId("caring-contacts-service-stop-state");
    expect(state).toHaveTextContent(/sending is stopped for the whole service/i);
    expect(state).toHaveTextContent(/wrong recipient/i);
    expect(screen.queryByRole("button", { name: "Stop all sending" })).toBeNull();

    expect(screen.getByText("1 of 3 restart approvals recorded.")).toBeInTheDocument();
    const seats = screen.getAllByTestId("caring-contacts-restart-seat");
    expect(seats).toHaveLength(3);
    expect(seats[0]).toHaveTextContent(/the incident lead/i);
    expect(seats[0]).toHaveTextContent(`Approved by account ${lead.id}`);
    expect(seats[1]).toHaveTextContent(/privacy and security owner/i);
    // No demo person is named for the privacy seat, and the screen says what that means.
    expect(seats[1]).toHaveTextContent(/nobody is named for this seat/i);
    expect(seats[2]).toHaveTextContent(/not yet approved/i);

    // The coordinator holds no approveServiceRestart.
    expect(screen.getByRole("group", { name: "This role cannot approve a restart" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /approve the restart/i })).toBeNull();
  });

  it("shows the note to a role the API releases it to, and withholds it from one it does not", async () => {
    const store = freshStore();
    await stopDirectly(store);

    const shown = await renderScreen(store, actingAs("coordinator"));
    expect(screen.getByTestId("caring-contacts-service-stop-note")).toHaveTextContent(NOTE);
    shown.unmount();

    const outside: Actor = { ...demoActorForRole("coordinator"), teamId: "another-team" as Actor["teamId"] };
    await renderScreen(store, outside);
    expect(screen.getByTestId("caring-contacts-service-stop-note-withheld")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("SENTINEL-NOTE");
  });

  it("lets a seat holder record their approval, posting exactly the approval body", async () => {
    const store = freshStore();
    await stopDirectly(store);
    const actor = actingAs("teamLead");
    const sent = routeFetch();
    const user = userEvent.setup();
    await renderScreen(store, actor);

    // The team lead is named for the incident seat only, so that is the one control offered.
    const controls = screen.getByTestId("caring-contacts-restart-approval-controls");
    expect(
      within(controls)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Approve the restart as the incident lead"]);

    await user.click(within(controls).getByRole("button", { name: "Approve the restart as the incident lead" }));
    expect(screen.getByText(/sending stays stopped after this/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Record my approval" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(Object.keys(sent[0].body).sort()).toEqual(["idempotencyKey", "role", "type"]);
    expect(sent[0].body).toMatchObject({ type: "approveRestart", role: "incidentLead" });
    expect(sent[0].body.idempotencyKey).toMatch(/^SERVICE-RESTART-[a-p]+$/);

    await waitFor(async () => {
      const state = await store.getServiceState({ actor });
      expect(state.stopped && state.restartApprovals.map((approval) => approval.role)).toEqual(["incidentLead"]);
    });
    expect(await screen.findByText(/your approval as the incident lead is recorded/i)).toBeInTheDocument();
    expect(mocks.router.refresh).toHaveBeenCalled();
  });

  it("offers no approval control to a seat holder who has already approved", async () => {
    const store = freshStore();
    await stopDirectly(store);
    const lead = demoActorForRole("teamLead");
    await store.approveServiceRestart(
      { role: "incidentLead" },
      { actor: lead, idempotencyKey: idempotencyKey("seed-approve") },
    );

    await renderScreen(store, actingAs("teamLead"));

    expect(screen.getByRole("group", { name: "Your approval is recorded" })).toBeInTheDocument();
    expect(screen.queryByTestId("caring-contacts-restart-approval-controls")).toBeNull();
  });
});
