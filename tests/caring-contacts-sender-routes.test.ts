// The two server-to-server routes: the scheduled sender run and the carrier's delivery-receipt
// webhook, plus activation's wording check. The store is a fresh demo store per test and the
// transport is always simulated or refused -- nothing here can reach a phone or a carrier.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ store: { current: null as unknown } }));

vi.mock("@/lib/caring-contacts-server/store", () => ({
  caringContactsStore: async () => mocks.store.current,
}));

import { POST as receiptPost } from "@/app/api/caring-contacts/delivery/webhook/route";
import { POST as runPost } from "@/app/api/caring-contacts/dispatch-run/route";
import { activationWordingRefusal, resetSenderTransportForTests } from "@/lib/caring-contacts-server/contact-sender";
import {
  createDemoWorkspaceStore,
  DEMO_SEED_PATHWAY_VERSION_ID,
  DEMO_SEED_UNSTARTED_REFERRAL_ID,
} from "@/lib/caring-contacts-server/demo-seed";
import { DEMO_TEAM_ID, demoActorForRole } from "@/lib/caring-contacts-server/session";
import { PLAN_ASSURANCE_VALUES } from "@/lib/caring-contacts/assurances";
import { systemClock } from "@/lib/caring-contacts/clock";
import { idempotencyKey, pathwayVersionId, patientId, planId, referralId } from "@/lib/caring-contacts/ids";
import type { CaringContactRepository, StoredContact } from "@/lib/caring-contacts/repository";
import { senderActorsForTeam } from "@/lib/caring-contacts/sender";
import { buildDeliveryReceiptUrl } from "@/lib/caring-contacts/transport/delivery-link";

const SENDER_SECRET = "a".repeat(40);
const WEBHOOK_SECRET = "b".repeat(40);
const coordinator = demoActorForRole("coordinator");

let store: CaringContactRepository;

beforeEach(async () => {
  store = await createDemoWorkspaceStore(systemClock());
  mocks.store.current = store;
  resetSenderTransportForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetSenderTransportForTests();
});

function runRequest(options: { secret?: string; body?: unknown } = {}): Request {
  return new Request("http://127.0.0.1/api/caring-contacts/dispatch-run", {
    method: "POST",
    headers: options.secret ? { authorization: `Bearer ${options.secret}` } : {},
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

describe("POST /api/caring-contacts/dispatch-run", () => {
  it("does not exist until a sender secret is configured", async () => {
    vi.stubEnv("CARING_CONTACTS_SENDER_SECRET", "");
    expect((await runPost(runRequest({ secret: SENDER_SECRET }))).status).toBe(404);
    vi.stubEnv("CARING_CONTACTS_SENDER_SECRET", "too-short");
    expect((await runPost(runRequest({ secret: "too-short" }))).status).toBe(404);
  });

  it("refuses a missing or wrong bearer secret", async () => {
    vi.stubEnv("CARING_CONTACTS_SENDER_SECRET", SENDER_SECRET);
    expect((await runPost(runRequest())).status).toBe(401);
    expect((await runPost(runRequest({ secret: "c".repeat(40) }))).status).toBe(401);
  });

  it("runs the sender with the simulated transport by default and reports ids and codes only", async () => {
    vi.stubEnv("CARING_CONTACTS_SENDER_SECRET", SENDER_SECRET);
    const response = await runPost(runRequest({ secret: SENDER_SECRET }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { transport: string; serviceStopped: boolean; counts: object };
    expect(body.transport).toBe("simulated");
    expect(body.serviceStopped).toBe(false);
    const text = JSON.stringify(body);
    expect(text).not.toContain("Rowan");
    expect(text).not.toContain("491");
  });

  it("refuses to start when real sending is switched on but incomplete", async () => {
    vi.stubEnv("CARING_CONTACTS_SENDER_SECRET", SENDER_SECRET);
    vi.stubEnv("CARING_CONTACTS_SMS_TRANSPORT", "telstra");
    const response = await runPost(runRequest({ secret: SENDER_SECRET }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ refusal: "sender-misconfigured", error: "SmsTransportConfigError" });
  });

  it("refuses real sending outside live mode even when fully configured", async () => {
    vi.stubEnv("CARING_CONTACTS_SENDER_SECRET", SENDER_SECRET);
    vi.stubEnv("CARING_CONTACTS_SMS_TRANSPORT", "telstra");
    vi.stubEnv("CARING_CONTACTS_TELSTRA_CLIENT_ID", "id");
    vi.stubEnv("CARING_CONTACTS_TELSTRA_CLIENT_SECRET", "secret");
    vi.stubEnv("CARING_CONTACTS_TELSTRA_FROM", "+61400000000");
    vi.stubEnv("CARING_CONTACTS_PUBLIC_BASE_URL", "https://caring.example.gov.au");
    vi.stubEnv("CARING_CONTACTS_DELIVERY_WEBHOOK_SECRET", WEBHOOK_SECRET);
    const response = await runPost(runRequest({ secret: SENDER_SECRET }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "RealSendingNeedsLiveModeError" });
  });

  it("sends a staff connection test through the configured transport without recording or echoing the number", async () => {
    vi.stubEnv("CARING_CONTACTS_SENDER_SECRET", SENDER_SECRET);
    const response = await runPost(
      runRequest({ secret: SENDER_SECRET, body: { mode: "connectionTest", to: "0412 345 678" } }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ transport: "simulated", outcome: "accepted" });
    expect(JSON.stringify(body)).not.toContain("412");
    const bad = await runPost(
      runRequest({ secret: SENDER_SECRET, body: { mode: "connectionTest", to: "+1 415 555 0100" } }),
    );
    expect(bad.status).toBe(400);
  });
});

async function rowanContactSentAwaitingReceipt(): Promise<StoredContact & { planId: string }> {
  const plans = await store.listPlans({ actor: coordinator });
  const active = plans.find((record) => record.plan.state === "active");
  if (!active) throw new Error("no active plan in the demo seed");
  const sendable = await store.listSendableContacts(active.plan.id, { actor: coordinator });
  const target = sendable[0];
  const { dispatcher } = senderActorsForTeam(DEMO_TEAM_ID);
  const started = await store.startContactDispatch(
    { planId: active.plan.id, contactId: target.contact.id, expectedContactVersion: target.contact.version },
    { actor: dispatcher, idempotencyKey: idempotencyKey("routes-test-start") },
  );
  if (!started.ok) throw new Error(started.reason);
  const sent = await store.recordContactSent(
    { planId: active.plan.id, contactId: target.contact.id, expectedContactVersion: started.value.contact.version },
    { actor: dispatcher, idempotencyKey: idempotencyKey("routes-test-sent") },
  );
  if (!sent.ok) throw new Error(sent.reason);
  return { ...sent.value, planId: active.plan.id };
}

function receiptRequest(url: string, body: unknown): Request {
  return new Request(url, { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/caring-contacts/delivery/webhook", () => {
  it("does not exist without a webhook secret", async () => {
    vi.stubEnv("CARING_CONTACTS_DELIVERY_WEBHOOK_SECRET", "");
    const response = await receiptPost(receiptRequest("http://127.0.0.1/api/caring-contacts/delivery/webhook", {}));
    expect(response.status).toBe(404);
  });

  it("records a signed receipt once, answers a repeat without change, and refuses a forged one", async () => {
    vi.stubEnv("CARING_CONTACTS_DELIVERY_WEBHOOK_SECRET", WEBHOOK_SECRET);
    const contact = await rowanContactSentAwaitingReceipt();
    const url = buildDeliveryReceiptUrl(
      "http://127.0.0.1",
      { teamId: DEMO_TEAM_ID, planId: contact.planId, contactId: contact.contact.id },
      WEBHOOK_SECRET,
    );

    const interim = await receiptPost(receiptRequest(url, { messageId: "m", status: "queued" }));
    expect(await interim.json()).toEqual({ result: "interimStatusIgnored" });

    const first = await receiptPost(receiptRequest(url, { messageId: "m", status: "delivered", to: "+61491570156" }));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ result: "recorded" });
    const repeat = await receiptPost(receiptRequest(url, { messageId: "m", status: "delivered" }));
    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toEqual({ result: "duplicate" });

    const after = (await store.listContacts(planId(contact.planId), { actor: coordinator })).find(
      (stored) => stored.contact.id === contact.contact.id,
    );
    expect(after?.contact.state).toBe("delivered");

    const forged = new URL(url);
    forged.searchParams.set("s", "A".repeat(43));
    expect((await receiptPost(receiptRequest(forged.toString(), { status: "delivered" }))).status).toBe(401);
    const otherSecret = buildDeliveryReceiptUrl(
      "http://127.0.0.1",
      { teamId: DEMO_TEAM_ID, planId: contact.planId, contactId: contact.contact.id },
      "z".repeat(40),
    );
    expect((await receiptPost(receiptRequest(otherSecret, { status: "delivered" }))).status).toBe(401);
  });

  it("answers 400 to a body that is not JSON", async () => {
    vi.stubEnv("CARING_CONTACTS_DELIVERY_WEBHOOK_SECRET", WEBHOOK_SECRET);
    const url = buildDeliveryReceiptUrl(
      "http://127.0.0.1",
      { teamId: "t", planId: "p", contactId: "c" },
      WEBHOOK_SECRET,
    );
    const response = await receiptPost(new Request(url, { method: "POST", body: "not json" }));
    expect(response.status).toBe(400);
  });
});

describe("activation's wording check", () => {
  async function draftPlanOnDemoPathway() {
    const id = planId("routes-test-plan-wren");
    const created = await store.createPlan(
      {
        planId: id,
        referralId: referralId(DEMO_SEED_UNSTARTED_REFERRAL_ID),
        patientId: patientId("demo-seed-patient-wren"),
        pathwayVersionId: pathwayVersionId(DEMO_SEED_PATHWAY_VERSION_ID),
        dischargeAt: new Date(),
        sendingPreference: "morning",
        assurances: PLAN_ASSURANCE_VALUES,
        patientDetail: {
          patientName: "Wren Example",
          preferredName: "Wren",
          patientMobileNumber: "0412 345 678",
          patientIdentifiers: ["SYN-UMRN-9999"],
          culturalIdentity: "Not stated",
        },
      },
      { actor: coordinator, idempotencyKey: idempotencyKey("routes-test-plan") },
    );
    if (!created.ok) throw new Error(created.reason);
    return id;
  }

  it("lets activation proceed with the simulated transport, where nothing reaches a phone", async () => {
    const id = await draftPlanOnDemoPathway();
    expect(await activationWordingRefusal(store, coordinator, id, {})).toBeNull();
  });

  it("refuses activation with real sending on when the pathway has no first or closing wording", async () => {
    const id = await draftPlanOnDemoPathway();
    expect(
      await activationWordingRefusal(store, coordinator, id, { CARING_CONTACTS_SMS_TRANSPORT: "telstra" }),
    ).toEqual({
      ok: false,
      reason: "pathway-wording-missing",
    });
    // An unreadable transport setting is treated as real, not as simulated.
    expect(
      await activationWordingRefusal(store, coordinator, id, { CARING_CONTACTS_SMS_TRANSPORT: "carrier-x" }),
    ).toEqual({
      ok: false,
      reason: "pathway-wording-missing",
    });
  });
});
