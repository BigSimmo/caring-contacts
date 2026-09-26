// tests/caring-contacts-request-validation.test.ts
//
// The two create routes -- manual intake and plan creation -- must refuse a bad body with a clear
// 4xx rather than accepting it, or failing later as a 500. Synthetic data throughout.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ store: { current: null as unknown }, cookies: {} as Record<string, unknown> }));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: (name: string) => mocks.cookies[name] })),
}));

vi.mock("@/lib/caring-contacts-server/store", () => ({
  caringContactsStore: async () => mocks.store.current,
}));

import { createDemoWorkspaceStore, DEMO_SEED_PATHWAY_VERSION_ID } from "@/lib/caring-contacts-server/demo-seed";
import { CARING_CONTACTS_ROLE_COOKIE, demoActorForRole } from "@/lib/caring-contacts-server/session";
import { PLAN_ASSURANCE_VALUES } from "@/lib/caring-contacts/assurances";
import { systemClock } from "@/lib/caring-contacts/clock";
import { idempotencyKey, pathwayVersionId, patientId, referralId } from "@/lib/caring-contacts/ids";
import type { CaringContactRepository } from "@/lib/caring-contacts/repository";

const DAY_MS = 86_400_000;

function post(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body) });
}

async function freshStore(): Promise<CaringContactRepository> {
  mocks.cookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: "coordinator" } };
  const store = await createDemoWorkspaceStore(systemClock());
  mocks.store.current = store;
  return store;
}

beforeEach(() => {
  mocks.store.current = null;
  mocks.cookies = {};
});

function intakeBody(overrides: Record<string, unknown> = {}) {
  return {
    patientIdentifier: "RPH-7781234",
    givenName: "Rowan",
    familyName: "Delacroix",
    mobileNumber: "0491 570 156",
    dischargeDate: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    hospitalFacility: "Royal Perth Hospital",
    cohort: "adult_crisis",
    admittingWard: "Ward 5A",
    clinicalSummary: "Synthetic handover note.",
    safetyAlerts: ["Synthetic alert"],
    idempotencyKey: "intake-validation-1",
    ...overrides,
  };
}

async function postIntake(body: unknown): Promise<Response> {
  await freshStore();
  const { POST } = await import("@/app/api/caring-contacts/intake/route");
  return POST(post("/api/caring-contacts/intake", body));
}

describe("manual intake request validation", () => {
  it("accepts a well-formed synthetic referral", async () => {
    const response = await postIntake(intakeBody());
    expect(response.status).toBe(200);
  });

  for (const mrn of ["0412345678", "+61412345678", "0412 345 678"]) {
    it(`refuses an MRN that looks like a mobile number (${mrn}) with a 400, not a 500`, async () => {
      const response = await postIntake(intakeBody({ patientIdentifier: mrn }));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ refusal: "invalid-request" });
    });
  }

  const badBodies: [string, Record<string, unknown>][] = [
    ["an unknown cohort", { cohort: "zzz" }],
    ["an unknown hospital facility", { hospitalFacility: "Not A Real Hospital" }],
    ["a given name over 100 characters", { givenName: "A".repeat(101) }],
    ["a family name over 100 characters", { familyName: "B".repeat(101) }],
    ["an admitting ward over 100 characters", { admittingWard: "W".repeat(101) }],
    ["a clinical summary over 4000 characters", { clinicalSummary: "s".repeat(4001) }],
    ["more than 20 safety alerts", { safetyAlerts: Array.from({ length: 21 }, (_, i) => `alert ${i}`) }],
    ["a safety alert over 200 characters", { safetyAlerts: ["x".repeat(201)] }],
    ["a NUL character in a name", { givenName: "Ro\u0000wan" }],
    ["a control character in the family name", { familyName: "Dela\u0007croix" }],
    ["a control character in the summary", { clinicalSummary: "note\u0000" }],
    ["a discharge date more than 90 days ago", { dischargeDate: new Date(Date.now() - 91 * DAY_MS).toISOString() }],
    [
      "a discharge date more than 10 minutes in the future (clock-skew allowance)",
      { dischargeDate: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
    ],
    ["a discharge date that is not a date", { dischargeDate: "yesterday" }],
  ];

  for (const [label, overrides] of badBodies) {
    it(`refuses ${label} with a 400`, async () => {
      const response = await postIntake(intakeBody(overrides));
      expect(response.status).toBe(400);
    });
  }

  it("still accepts a discharge a few minutes in the future (within the clock-skew allowance)", async () => {
    const response = await postIntake(
      intakeBody({ dischargeDate: new Date(Date.now() + 2 * 60 * 1000).toISOString() }),
    );
    expect(response.status).toBe(200);
  });

  it("refuses a second intake for the same facility and MRN with a named 409, but replays the same key", async () => {
    // One body, sent twice: the discharge date is computed from the clock, so rebuilding it would
    // make the retry a different write rather than a replay.
    const firstBody = intakeBody({ idempotencyKey: "intake-dup-1" });
    const first = await postIntake(firstBody);
    expect(first.status).toBe(200);
    const { POST } = await import("@/app/api/caring-contacts/intake/route");

    const retry = await POST(post("/api/caring-contacts/intake", firstBody));
    expect(retry.status).toBe(200);

    const second = await POST(post("/api/caring-contacts/intake", intakeBody({ idempotencyKey: "intake-dup-2" })));
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toEqual({ refusal: "referral-already-accepted-for-patient" });

    const otherHospital = await POST(
      post(
        "/api/caring-contacts/intake",
        intakeBody({ idempotencyKey: "intake-dup-3", hospitalFacility: "Fiona Stanley Hospital" }),
      ),
    );
    expect(otherHospital.status).toBe(200);
  });

  it("still accepts a clinical summary with ordinary line breaks and tabs", async () => {
    const response = await postIntake(intakeBody({ clinicalSummary: "Line one\nLine two\r\n\tIndented" }));
    expect(response.status).toBe(200);
  });
});

describe("plan creation request validation", () => {
  const coordinator = demoActorForRole("coordinator");

  async function storeWithAcceptedReferral(): Promise<CaringContactRepository> {
    const store = await freshStore();
    const created = await store.createReferral(
      { referralId: referralId("VAL-REFERRAL-1"), patientId: patientId("VAL-PATIENT-1") },
      { actor: coordinator, idempotencyKey: idempotencyKey("val-ref-create") },
    );
    if (!created.ok) throw new Error(created.reason);
    const accepted = await store.transitionReferral(
      {
        referralId: referralId("VAL-REFERRAL-1"),
        action: { type: "accept", pathwayVersionId: pathwayVersionId(DEMO_SEED_PATHWAY_VERSION_ID) },
      },
      { actor: coordinator, idempotencyKey: idempotencyKey("val-ref-accept") },
    );
    if (!accepted.ok) throw new Error(accepted.reason);
    return store;
  }

  function planBody(overrides: Record<string, unknown> = {}, detail: Record<string, unknown> = {}) {
    return {
      planId: "VAL-PLAN-1",
      referralId: "VAL-REFERRAL-1",
      patientId: "VAL-PATIENT-1",
      pathwayVersionId: DEMO_SEED_PATHWAY_VERSION_ID,
      dischargeAt: new Date(Date.now() - 2 * DAY_MS).toISOString(),
      sendingPreference: "morning",
      patientDetail: {
        patientName: "Rowan Delacroix",
        patientMobileNumber: "0491 570 156",
        patientIdentifiers: ["RPH-7781234"],
        culturalIdentity: null,
        preferredName: "Rowan",
        ...detail,
      },
      assurances: [...PLAN_ASSURANCE_VALUES],
      idempotencyKey: "val-plan-create",
      ...overrides,
    };
  }

  async function postPlan(body: unknown): Promise<Response> {
    await storeWithAcceptedReferral();
    const { POST } = await import("@/app/api/caring-contacts/plans/route");
    return POST(post("/api/caring-contacts/plans", body));
  }

  it("creates a plan from a well-formed body", async () => {
    const response = await postPlan(planBody());
    expect(response.status).toBe(200);
  });

  for (const mobile of ["123", "08 9224 2244", "+61 8 9224 2244", "0491 570 15x"]) {
    it(`refuses a patient mobile that is not an Australian mobile (${mobile})`, async () => {
      const response = await postPlan(planBody({}, { patientMobileNumber: mobile }));
      expect(response.status).toBe(400);
    });
  }

  for (const only of PLAN_ASSURANCE_VALUES) {
    it(`refuses a plan carrying only one of the required assurances (${only})`, async () => {
      const response = await postPlan(planBody({ assurances: [only] }));
      expect(response.status).toBe(400);
    });
  }

  it("refuses a discharge more than 90 days ago", async () => {
    const response = await postPlan(planBody({ dischargeAt: new Date(Date.now() - 91 * DAY_MS).toISOString() }));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ refusal: "discharge-out-of-range" });
  });

  describe("with the clock at 09:00 AWST on 2026-09-26", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-26T01:00:00.000Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("accepts a discharge recorded as today, although the wizard stores it at midday AWST", async () => {
      const response = await postPlan(planBody({ dischargeAt: "2026-09-26T04:00:00.000Z" }));
      expect(response.status).toBe(200);
    });

    it("accepts a discharge day exactly 90 days ago, and refuses 91 days ago", async () => {
      const ninety = await postPlan(planBody({ dischargeAt: "2026-06-28T04:00:00.000Z" }));
      expect(ninety.status).toBe(200);
      const ninetyOne = await postPlan(planBody({ dischargeAt: "2026-06-27T04:00:00.000Z" }));
      expect(ninetyOne.status).toBe(422);
    });
  });

  it("refuses a discharge in the future (tomorrow or later, AWST)", async () => {
    const response = await postPlan(planBody({ dischargeAt: new Date(Date.now() + DAY_MS).toISOString() }));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ refusal: "discharge-out-of-range" });
  });
});
