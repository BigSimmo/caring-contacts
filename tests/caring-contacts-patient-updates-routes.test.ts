// tests/caring-contacts-patient-updates-routes.test.ts
//
// The HTTP boundary for recording a change from the plan screen: a hospital event, a contact-detail
// edit, the number check's test text, and the shared-number count.
//
// What is asserted is the BOUNDARY: validation, the capability each action is gated on, the
// response shape, that the number never leaves in a response, and -- for the test text -- that a
// failed send records nothing and a refused write sends nothing. The rules themselves are the
// domain's and are pinned by the shared repository contract against both stores.
//
// The store, the demo-role cookie and the transport are replaced, as the contact route's tests do:
// `caringContactsStore()` is memoised process-wide, and the transport must be observable.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  store: { current: null as unknown },
  sends: [] as { to: string; body: string; reference: string }[],
  sendOutcome: { current: "accepted" as "accepted" | "rejected" | "unknown" },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: (name: string) => mockCookies[name] })),
}));

vi.mock("@/lib/caring-contacts-server/store", () => ({
  caringContactsStore: async () => mocks.store.current,
}));

vi.mock("@/lib/caring-contacts-server/contact-sender", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/caring-contacts-server/contact-sender")>();
  return {
    ...original,
    senderTransport: () => ({
      transport: {
        kind: "simulated",
        reachesRealPhones: false,
        async send(message: { to: string; body: string; reference: string }) {
          mocks.sends.push({ to: message.to, body: message.body, reference: message.reference });
          const outcome = mocks.sendOutcome.current;
          return outcome === "accepted" ? { outcome, providerMessageId: null } : { outcome, reason: "test" };
        },
      },
      deliveryReceipts: null,
    }),
  };
});

import { CARING_CONTACTS_ROLE_COOKIE, demoActorForRole } from "@/lib/caring-contacts-server/session";
import type { AccessRecord } from "@/lib/caring-contacts/access-audit";
import { PLAN_ASSURANCE_VALUES } from "@/lib/caring-contacts/assurances";
import { fixedClock } from "@/lib/caring-contacts/clock";
import { idempotencyKey, pathwayVersionId, patientId, planId, referralId } from "@/lib/caring-contacts/ids";
import { createInMemoryRepository } from "@/lib/caring-contacts/in-memory-repository";
import { MOBILE_CHECK_MESSAGE } from "@/lib/caring-contacts/mobile-check";
import type { CaringContactRepository } from "@/lib/caring-contacts/repository";

let mockCookies: Record<string, { value: string } | undefined> = {};

const PLAN_ID = "SYN-PLAN-UPD-001";
const NOW = "2026-08-30T03:00:00.000Z";
const MOBILE_DIGITS = /491\s?570\s?15\d/;

type Seeded = { store: CaringContactRepository; recorded: () => AccessRecord[]; version: number };

async function seed(role = "coordinator", options: { activate?: boolean } = {}): Promise<Seeded> {
  mockCookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: role } };
  const repository = createInMemoryRepository(fixedClock(NOW));
  const records: AccessRecord[] = [];
  const store: CaringContactRepository = {
    ...repository,
    async recordAccess(record: AccessRecord) {
      await repository.recordAccess(record);
      records.push(record);
    },
  };
  const coordinator = demoActorForRole("coordinator");
  const created = await store.createPlan(
    {
      planId: planId(PLAN_ID),
      referralId: referralId("SYN-REFERRAL-UPD-001"),
      patientId: patientId("SYN-PATIENT-UPD-001"),
      pathwayVersionId: pathwayVersionId("SYN-PATHWAY-001"),
      dischargeAt: new Date("2026-08-30T02:00:00.000Z"),
      sendingPreference: "morning",
      assurances: PLAN_ASSURANCE_VALUES,
      patientDetail: {
        patientName: "Rowan Mira Delacroix",
        preferredName: "Rowan",
        patientMobileNumber: "+61 491 570 156",
        patientIdentifiers: ["UR-00219384"],
        culturalIdentity: null,
      },
    },
    { actor: coordinator, idempotencyKey: idempotencyKey("seed-create") },
  );
  if (!created.ok) throw new Error(`seed createPlan refused: ${created.reason}`);
  let version = created.value.plan.version;
  if (options.activate !== false) {
    const activated = await store.activatePlan(
      { planId: planId(PLAN_ID), expectedVersion: version },
      { actor: coordinator, idempotencyKey: idempotencyKey("seed-activate") },
    );
    if (!activated.ok) throw new Error(`seed activatePlan refused: ${activated.reason}`);
    version = activated.value.plan.version;
  }
  mocks.store.current = store;
  return { store, recorded: () => records, version };
}

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function postPlan(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/caring-contacts/plans/[planId]/route");
  return POST(jsonRequest(`http://localhost/api/caring-contacts/plans/${PLAN_ID}`, body), {
    params: Promise.resolve({ planId: PLAN_ID }),
  });
}

async function postMobileCheck(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/caring-contacts/plans/[planId]/mobile-check/route");
  return POST(jsonRequest(`http://localhost/api/caring-contacts/plans/${PLAN_ID}/mobile-check`, body), {
    params: Promise.resolve({ planId: PLAN_ID }),
  });
}

async function postSharedMobile(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/caring-contacts/patients/shared-mobile/route");
  return POST(jsonRequest("http://localhost/api/caring-contacts/patients/shared-mobile", body));
}

async function planState(store: CaringContactRepository) {
  return (await store.getPlan(planId(PLAN_ID), { actor: demoActorForRole("coordinator") }))!;
}

beforeEach(() => {
  mockCookies = {};
  mocks.store.current = null;
  mocks.sends.length = 0;
  mocks.sendOutcome.current = "accepted";
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/caring-contacts/plans/[planId] -- recordEvent", () => {
  it("pauses the plan on a readmission and answers with the hospital-status outcome", async () => {
    const { version } = await seed();
    const response = await postPlan({
      action: "recordEvent",
      event: "readmission",
      expectedVersion: version,
      idempotencyKey: "EVT-readmit-1",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { value: { record: { plan: { state: string } }; exceptions: unknown[] } };
    expect(body.value.record.plan.state).toBe("paused");
    expect(body.value.exceptions).toEqual([]);
    expect(body.value).toHaveProperty("contactsCancelled", 0);
  });

  it("cancels every unsent message on a death, including one recorded by a role that only holds the safety stop", async () => {
    const { store, version } = await seed("auditor");
    const response = await postPlan({
      action: "recordEvent",
      event: "death",
      diedOn: "2026-08-29",
      expectedVersion: version,
      idempotencyKey: "EVT-death-1",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      value: { record: { plan: { state: string } }; contactsCancelled: number };
    };
    expect(body.value.record.plan.state).toBe("cancelled");
    expect(body.value.contactsCancelled).toBeGreaterThan(0);
    expect((await planState(store)).plan.state).toBe("cancelled");
  });

  it("refuses a readmission from a role without recordHospitalStatusEvent, and records the denial", async () => {
    const { store, version, recorded } = await seed("auditor");
    const response = await postPlan({
      action: "recordEvent",
      event: "readmission",
      expectedVersion: version,
      idempotencyKey: "EVT-readmit-auditor",
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ refusal: "action-not-granted" });
    expect(recorded().map((record) => [record.kind, record.outcome])).toEqual([["mutation", "denied"]]);
    expect((await planState(store)).plan.state).toBe("active");
  });

  it("refuses a date of death in the future by name, and a date with any other event as a bad request", async () => {
    const { store, version } = await seed();
    const future = await postPlan({
      action: "recordEvent",
      event: "death",
      diedOn: "2099-01-01",
      expectedVersion: version,
      idempotencyKey: "EVT-death-future",
    });
    expect(future.status).toBe(422);
    expect(await future.json()).toEqual({ refusal: "death-date-in-future" });

    for (const body of [
      {
        action: "recordEvent",
        event: "readmission",
        diedOn: "2026-08-29",
        expectedVersion: version,
        idempotencyKey: "EVT-x1",
      },
      {
        action: "recordEvent",
        event: "death",
        diedOn: "2026-02-30",
        expectedVersion: version,
        idempotencyKey: "EVT-x2",
      },
      { action: "recordEvent", event: "mobileChanged", expectedVersion: version, idempotencyKey: "EVT-x3" },
    ]) {
      expect((await postPlan(body)).status).toBe(400);
    }
    expect((await planState(store)).plan.state).toBe("active");
  });
});

describe("POST /api/caring-contacts/plans/[planId] -- updateContactDetail", () => {
  it("pauses the plan on a changed mobile and answers without the number", async () => {
    const { store, version } = await seed();
    const response = await postPlan({
      action: "updateContactDetail",
      patientMobileNumber: "0491 570 159",
      expectedVersion: version,
      idempotencyKey: "CD-mobile-1",
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toMatch(MOBILE_DIGITS);
    const body = JSON.parse(text) as {
      value: { record: { plan: { state: string } }; mobileChanged: boolean; exceptions: unknown[] };
    };
    expect(body.value.mobileChanged).toBe(true);
    expect(body.value.record.plan.state).toBe("paused");
    expect(body.value.exceptions).toEqual([{ type: "contactChanged" }]);
    const episode = await store.getEpisode(planId(PLAN_ID), { actor: demoActorForRole("coordinator") });
    expect(episode?.patientMobileNumber).toBe("+61 491 570 159");
  });

  it("refuses an invalid mobile by the domain's name, and an unknown field as a bad request", async () => {
    const { version } = await seed();
    const invalid = await postPlan({
      action: "updateContactDetail",
      patientMobileNumber: "08 9222 1234",
      expectedVersion: version,
      idempotencyKey: "CD-invalid",
    });
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toEqual({ refusal: "patient-mobile-invalid" });

    const extra = await postPlan({
      action: "updateContactDetail",
      patientName: "Someone",
      culturalIdentity: "x",
      expectedVersion: version,
      idempotencyKey: "CD-extra",
    });
    expect(extra.status).toBe(400);
  });
});

describe("POST /api/caring-contacts/plans/[planId]/mobile-check", () => {
  it("sends the fixed test text to the stored number, then records it as awaiting confirmation", async () => {
    const { store, version } = await seed("coordinator", { activate: false });
    const response = await postMobileCheck({ action: "send", expectedVersion: version, idempotencyKey: "MC-send-1" });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toMatch(MOBILE_DIGITS);
    const body = JSON.parse(text) as { value: { mobileCheck: { state: string } } };
    expect(body.value.mobileCheck.state).toBe("awaitingConfirmation");
    expect(mocks.sends).toEqual([
      { to: "+61491570156", body: MOBILE_CHECK_MESSAGE, reference: `mobile-check-${PLAN_ID}` },
    ]);

    // Unanswered: the plan may not start.
    const activate = await postPlan({ action: "activate", expectedVersion: version + 1, idempotencyKey: "MC-act-1" });
    expect(activate.status).toBe(422);
    expect(await activate.json()).toEqual({ refusal: "mobile-check-unconfirmed" });

    const confirmed = await postMobileCheck({
      action: "confirm",
      outcome: "received",
      expectedVersion: version + 1,
      idempotencyKey: "MC-confirm-1",
    });
    expect(confirmed.status).toBe(200);
    expect((await planState(store)).mobileCheck.state).toBe("confirmed");
  });

  it("records nothing when the carrier does not take the message", async () => {
    const { store, version } = await seed();
    for (const outcome of ["rejected", "unknown"] as const) {
      mocks.sendOutcome.current = outcome;
      const response = await postMobileCheck({
        action: "send",
        expectedVersion: version,
        idempotencyKey: `MC-fail-${outcome}`,
      });
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ refusal: "mobile-check-send-failed" });
    }
    const after = await planState(store);
    expect(after.mobileCheck.state).toBe("notChecked");
    expect(after.plan.version).toBe(version);
  });

  it("sends nothing for a stale version or a role without the capability", async () => {
    const { version } = await seed();
    const stale = await postMobileCheck({ action: "send", expectedVersion: version - 1, idempotencyKey: "MC-stale" });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ refusal: "stale-version" });

    mockCookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: "auditor" } };
    const denied = await postMobileCheck({ action: "send", expectedVersion: version, idempotencyKey: "MC-auditor" });
    expect(denied.status).toBe(403);
    expect(mocks.sends).toEqual([]);
  });

  it("refuses an answer when no test text is waiting", async () => {
    const { version } = await seed();
    const response = await postMobileCheck({
      action: "confirm",
      outcome: "notReceived",
      expectedVersion: version,
      idempotencyKey: "MC-not-awaiting",
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ refusal: "mobile-check-not-awaiting" });
  });
});

describe("POST /api/caring-contacts/patients/shared-mobile", () => {
  it("answers a count and nothing else, and records the read under a fixed id", async () => {
    const { recorded } = await seed();
    const response = await postSharedMobile({ mobile: "0491570156" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sharedWith: 1 });
    expect(recorded()).toEqual([
      expect.objectContaining({
        kind: "search",
        objectType: "patientDirectory",
        objectId: "shared-mobile",
        outcome: "allowed",
      }),
    ]);
  });

  it("leaves out the plan being edited, and answers zero for a value that is not a mobile", async () => {
    await seed();
    expect(await (await postSharedMobile({ mobile: "0491 570 156", excludePlanId: PLAN_ID })).json()).toEqual({
      sharedWith: 0,
    });
    expect(await (await postSharedMobile({ mobile: "hello" })).json()).toEqual({ sharedWith: 0 });
  });

  it("refuses a malformed body without echoing it", async () => {
    await seed();
    for (const body of [{ mobile: "0491570156", name: "x" }, { mobile: 491570156 }, "{not json"]) {
      const response = await postSharedMobile(body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ refusal: "invalid-request" });
    }
  });
});
