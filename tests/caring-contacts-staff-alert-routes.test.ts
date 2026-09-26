// Staff alert delivery at the routes: the readiness probe's sender and alert checks (and the
// "sender stalled" alert it raises), the alerts a sender run raises, the safety-stop alert, and
// the "not delivered" delivery-report alert. The store is a fresh demo store per test and alerts
// go to the simulated outbox -- nothing here reaches a phone, a carrier or a real channel.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ store: { current: null as unknown } }));

vi.mock("@/lib/caring-contacts-server/store", () => ({
  caringContactsStore: async () => mocks.store.current,
}));

// The service-state route resolves its actor from the demo role cookie; none set means the demo
// default (a coordinator), who may raise a stop.
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));

import { POST as receiptPost } from "@/app/api/caring-contacts/delivery/webhook/route";
import { POST as runPost } from "@/app/api/caring-contacts/dispatch-run/route";
import { GET as readyGet } from "@/app/api/caring-contacts/ready/route";
import { POST as serviceStatePost } from "@/app/api/caring-contacts/service-state/route";
import { resetSenderTransportForTests } from "@/lib/caring-contacts-server/contact-sender";
import { createDemoWorkspaceStore } from "@/lib/caring-contacts-server/demo-seed";
import { DEMO_TEAM_ID, demoActorForRole } from "@/lib/caring-contacts-server/session";
import { setProcessStartedAtForTests } from "@/lib/caring-contacts-server/staff-alerts";
import { clearSimulatedStaffAlertOutbox, simulatedStaffAlertOutbox } from "@/lib/caring-contacts/alerts/delivery";
import { systemClock } from "@/lib/caring-contacts/clock";
import { idempotencyKey } from "@/lib/caring-contacts/ids";
import type { AlertClass } from "@/lib/caring-contacts/notification-preferences";
import type { CaringContactRepository } from "@/lib/caring-contacts/repository";
import { senderActorsForTeam } from "@/lib/caring-contacts/sender";
import { buildDeliveryReceiptUrl } from "@/lib/caring-contacts/transport/delivery-link";
import { NextRequest } from "next/server";

const SENDER_SECRET = "a".repeat(40);
const WEBHOOK_SECRET = "b".repeat(40);
const MINUTE = 60_000;
const coordinator = demoActorForRole("coordinator");

let store: CaringContactRepository;

beforeEach(async () => {
  store = await createDemoWorkspaceStore(systemClock());
  mocks.store.current = store;
  resetSenderTransportForTests();
  clearSimulatedStaffAlertOutbox();
  setProcessStartedAtForTests(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  resetSenderTransportForTests();
  clearSimulatedStaffAlertOutbox();
  setProcessStartedAtForTests(null);
});

async function ready(): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await readyGet();
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function optIn(classes: AlertClass[]) {
  const saved = await store.saveNotificationPreferences(
    { actorId: coordinator.id, optedIn: classes },
    { actor: coordinator, idempotencyKey: idempotencyKey(`routes-optin-${classes.join("-")}`) },
  );
  if (!saved.ok) throw new Error(saved.reason);
}

const outboxClasses = () => simulatedStaffAlertOutbox().map((payload) => payload.alertClass);

describe("GET /api/caring-contacts/ready: the sender and alert checks", () => {
  it("stays healthy in the demo with simulated sending and no sender at all, and says so", async () => {
    setProcessStartedAtForTests(new Date(Date.now() - 24 * 60 * MINUTE));
    expect(await ready()).toEqual({
      status: 200,
      body: {
        ok: true,
        store: "in-memory",
        caringContactsDatabase: "skipped",
        sender: "not-monitored",
        alerts: "simulated",
      },
    });
    expect(simulatedStaffAlertOutbox()).toEqual([]);
  });

  it("with real sending on, allows a start-up grace, then reports a sender that never ran as stalled and alerts once", async () => {
    vi.stubEnv("CARING_CONTACTS_SMS_TRANSPORT", "telstra");

    setProcessStartedAtForTests(new Date(Date.now() - 5 * MINUTE));
    expect(await ready()).toMatchObject({ status: 200, body: { ok: true, sender: "starting" } });

    setProcessStartedAtForTests(new Date(Date.now() - 20 * MINUTE));
    const stalled = await ready();
    expect(stalled).toEqual({
      status: 503,
      body: {
        ok: false,
        store: "in-memory",
        caringContactsDatabase: "skipped",
        sender: "stalled",
        alerts: "simulated",
      },
    });
    await vi.waitFor(() => expect(outboxClasses()).toEqual(["senderStalled"]));
    expect(simulatedStaffAlertOutbox()[0]).toMatchObject({ reason: "sender-never-run", teamId: null });

    // The orchestrator polls again and again while it stays stalled: no second alert inside the cooldown.
    await ready();
    await ready();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(outboxClasses()).toEqual(["senderStalled"]);
  });

  it("reports a sender that stopped running as stalled, and a running one as running", async () => {
    vi.stubEnv("CARING_CONTACTS_SMS_TRANSPORT", "telstra");
    setProcessStartedAtForTests(new Date(Date.now() - 3 * 60 * MINUTE));
    const { dispatcher } = senderActorsForTeam(DEMO_TEAM_ID);

    await store.recordSenderHeartbeat({ at: new Date(Date.now() - 2 * MINUTE) }, { actor: dispatcher });
    expect(await ready()).toMatchObject({ status: 200, body: { ok: true, sender: "running" } });

    vi.stubEnv("CARING_CONTACTS_SENDER_STALL_MINUTES", "1");
    expect(await ready()).toMatchObject({ status: 503, body: { ok: false, sender: "stalled" } });
    await vi.waitFor(() => expect(simulatedStaffAlertOutbox()[0]).toMatchObject({ reason: "sender-run-overdue" }));
  });

  it("answers 503 when the staff-alert settings are refused, in every mode", async () => {
    vi.stubEnv("CARING_CONTACTS_ALERT_DELIVERY", "webhook");
    expect(await ready()).toMatchObject({ status: 503, body: { ok: false, alerts: "misconfigured" } });
    vi.stubEnv("CARING_CONTACTS_ALERT_WEBHOOK_URL", "https://hooks.example.gov.au/abc");
    expect(await ready()).toMatchObject({ status: 200, body: { ok: true, alerts: "webhook" } });
  });

  it("reports an unreadable heartbeat as unknown and unhealthy when the sender is monitored", async () => {
    vi.stubEnv("CARING_CONTACTS_SMS_TRANSPORT", "telstra");
    const broken: CaringContactRepository = Object.create(store);
    broken.getSenderHeartbeat = async () => {
      throw new Error("relation does not exist");
    };
    mocks.store.current = broken;
    expect(await ready()).toMatchObject({ status: 503, body: { ok: false, sender: "unknown" } });
  });
});

function runRequest(): Request {
  return new Request("http://127.0.0.1/api/caring-contacts/dispatch-run", {
    method: "POST",
    headers: { authorization: `Bearer ${SENDER_SECRET}` },
  });
}

describe("POST /api/caring-contacts/dispatch-run: alerts from a sender run", () => {
  // The demo is seeded relative to "now". Two years later every scheduled contact's approved window
  // has closed, so the run records each one missed -- a permanent delivery failure -- and never
  // sends late. That makes the run's outcome deterministic without reaching into the seed.
  async function runTwoYearsLater(optedIn: AlertClass[] = []) {
    vi.useFakeTimers({ toFake: ["Date"] });
    const seededAt = new Date("2026-10-05T01:30:00.000Z");
    vi.setSystemTime(seededAt);
    store = await createDemoWorkspaceStore(systemClock());
    mocks.store.current = store;
    if (optedIn.length > 0) await optIn(optedIn);
    vi.setSystemTime(new Date(seededAt.getTime() + 2 * 365 * 24 * 60 * MINUTE));
    vi.stubEnv("CARING_CONTACTS_SENDER_SECRET", SENDER_SECRET);
    const response = await runPost(runRequest());
    expect(response.status).toBe(200);
    return (await response.json()) as {
      counts: Record<string, number>;
      alerts: Record<string, number>;
      heartbeatRecorded: boolean;
    };
  }

  it("records the heartbeat, and raises nothing for a team where nobody opted in", async () => {
    const body = await runTwoYearsLater();
    expect(body.counts.missedWindowClosed).toBeGreaterThan(0);
    expect(body.heartbeatRecorded).toBe(true);
    expect(await store.getSenderHeartbeat({ actor: coordinator })).not.toBeNull();
    expect(body.alerts).toEqual({ notOptedIn: 1 });
    expect(simulatedStaffAlertOutbox()).toEqual([]);
  });

  it("delivers the permanent-delivery-failure alert once a team member has opted in, content-free", async () => {
    const body = await runTwoYearsLater(["permanentDeliveryFailure"]);
    expect(body.alerts).toEqual({ delivered: 1 });
    const [payload] = simulatedStaffAlertOutbox();
    expect(payload).toMatchObject({
      alertClass: "permanentDeliveryFailure",
      count: body.counts.missedWindowClosed,
      reason: "sending-window-missed",
      teamId: DEMO_TEAM_ID,
    });
    expect(JSON.stringify(payload)).not.toMatch(/Rowan|Mira|\+61|plan|contact-/i);

    // The next run, five minutes later, finds nothing new to report and sends nothing twice.
    vi.setSystemTime(new Date(Date.now() + 5 * MINUTE));
    const again = await runPost(runRequest());
    expect(((await again.json()) as { alerts: object }).alerts).toEqual({});
    expect(simulatedStaffAlertOutbox()).toHaveLength(1);
  });

  it("still answers the run when the alert settings are refused", async () => {
    vi.stubEnv("CARING_CONTACTS_ALERT_DELIVERY", "carrier-pigeon");
    const body = await runTwoYearsLater();
    expect(body.counts.missedWindowClosed).toBeGreaterThan(0);
    expect(body.alerts).toEqual({});
  });
});

describe("POST /api/caring-contacts/service-state: the safety-stop alert", () => {
  function stopRequest(key: string): NextRequest {
    return new NextRequest("http://localhost/api/caring-contacts/service-state", {
      method: "POST",
      body: JSON.stringify({
        type: "stop",
        reason: "wrong-recipient",
        note: "Message for Rowan Mira Delacroix reached +61 491 570 156.",
        idempotencyKey: key,
      }),
    });
  }

  it("alerts the team channel once per stop, whatever anybody opted in to, and never carries the note", async () => {
    const response = await serviceStatePost(stopRequest("stop-alert-1"));
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(outboxClasses()).toEqual(["serviceSafetyStop"]));
    expect(simulatedStaffAlertOutbox()[0]).toMatchObject({ count: 1, reason: "service-stopped", teamId: null });
    expect(JSON.stringify(simulatedStaffAlertOutbox())).not.toMatch(/Rowan|Mira|491|wrong-recipient/);

    // A replay of the same request is the same stop: no second alert.
    expect((await serviceStatePost(stopRequest("stop-alert-1"))).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(outboxClasses()).toEqual(["serviceSafetyStop"]);
  });
});

describe("POST /api/caring-contacts/delivery/webhook: a report that a message did not arrive", () => {
  async function sentContact() {
    const plans = await store.listPlans({ actor: coordinator });
    const active = plans.find((record) => record.plan.state === "active");
    if (!active) throw new Error("no active plan in the demo seed");
    const target = (await store.listSendableContacts(active.plan.id, { actor: coordinator }))[0];
    const { dispatcher } = senderActorsForTeam(DEMO_TEAM_ID);
    const started = await store.startContactDispatch(
      { planId: active.plan.id, contactId: target.contact.id, expectedContactVersion: target.contact.version },
      { actor: dispatcher, idempotencyKey: idempotencyKey("alert-routes-start") },
    );
    if (!started.ok) throw new Error(started.reason);
    const sent = await store.recordContactSent(
      { planId: active.plan.id, contactId: target.contact.id, expectedContactVersion: started.value.contact.version },
      { actor: dispatcher, idempotencyKey: idempotencyKey("alert-routes-sent") },
    );
    if (!sent.ok) throw new Error(sent.reason);
    return buildDeliveryReceiptUrl(
      "http://127.0.0.1",
      { teamId: DEMO_TEAM_ID, planId: active.plan.id, contactId: target.contact.id },
      WEBHOOK_SECRET,
    );
  }

  it("raises a permanent delivery failure for an opted-in team, once, and not for a repeat", async () => {
    vi.stubEnv("CARING_CONTACTS_DELIVERY_WEBHOOK_SECRET", WEBHOOK_SECRET);
    await optIn(["permanentDeliveryFailure"]);
    const url = await sentContact();
    const post = () =>
      receiptPost(
        new Request(url, { method: "POST", body: JSON.stringify({ status: "undeliverable", to: "+61491570156" }) }),
      );

    expect(await (await post()).json()).toEqual({ result: "recorded" });
    await vi.waitFor(() =>
      expect(simulatedStaffAlertOutbox()).toEqual([
        expect.objectContaining({
          alertClass: "permanentDeliveryFailure",
          count: 1,
          reason: "carrier-reported-undelivered",
          teamId: DEMO_TEAM_ID,
        }),
      ]),
    );
    expect(JSON.stringify(simulatedStaffAlertOutbox())).not.toContain("491570156");

    expect(await (await post()).json()).toEqual({ result: "duplicate" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(simulatedStaffAlertOutbox()).toHaveLength(1);
  });
});
