// tests/caring-contacts-team-route.test.ts
//
// Phase 2B Task 17 -- the HTTP boundary over the team read.
//
// What is asserted here is the boundary's own behaviour, not the roll-up: that the read is recorded
// on the access trail under its own object type, that a team holding no plans gets a roster with an
// empty array rather than a 404, that nothing patient-identifying reaches the wire, that the read
// that releases patient identity is never called, and that nothing from a query string reaches
// either the body or the trail. The roll-up itself is pinned in
// `tests/caring-contacts-team-workload.test.ts`.
//
// The store and the demo-role cookie are both replaced, exactly as
// `tests/caring-contacts-schedule-route.test.ts` does: `caringContactsStore()` is memoised
// process-wide, so a test using the real one would share a single workspace across every case.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ store: { current: null as unknown } }));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: (name: string) => mockCookies[name] })),
}));

vi.mock("@/lib/caring-contacts-server/store", () => ({
  caringContactsStore: async () => mocks.store.current,
}));

import { CARING_CONTACTS_ROLE_COOKIE, demoActorForRole } from "@/lib/caring-contacts-server/session";
import { PLAN_ASSURANCE_VALUES } from "@/lib/caring-contacts/assurances";
import type { AccessRecord } from "@/lib/caring-contacts/access-audit";
import { fixedClock } from "@/lib/caring-contacts/clock";
import { idempotencyKey, pathwayVersionId, patientId, planId, referralId } from "@/lib/caring-contacts/ids";
import { createInMemoryRepository } from "@/lib/caring-contacts/in-memory-repository";
import type { CaringContactRepository } from "@/lib/caring-contacts/repository";
import type { TeamWorkloadView } from "@/lib/caring-contacts/team-workload";

let mockCookies: Record<string, { value: string } | undefined> = {};

const PLAN_ID = planId("SYN-PLAN-001");
const PATIENT_ID = "SYN-PATIENT-001";
const PATIENT_NAME = "Rowan Mira Delacroix";
const PATIENT_MOBILE = "+61 491 570 156";

const DISCHARGE_AT = new Date("2026-08-30T02:00:00.000Z");
const NOW = "2026-08-30T03:00:00.000Z";

type Spied = {
  store: CaringContactRepository;
  recorded: () => AccessRecord[];
  episodeReads: () => number;
};

async function inMemoryStoreWithSpy(options: { seedPlan?: boolean } = {}): Promise<Spied> {
  mockCookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: "coordinator" } };

  const repository = createInMemoryRepository(fixedClock(NOW));
  const records: AccessRecord[] = [];
  let episodeReads = 0;
  const store: CaringContactRepository = {
    ...repository,
    async recordAccess(record: AccessRecord) {
      // The real store first, then the spy, so `records` means "entered the trail".
      await repository.recordAccess(record);
      records.push(record);
    },
    async getEpisode(...args: Parameters<CaringContactRepository["getEpisode"]>) {
      episodeReads += 1;
      return repository.getEpisode(...args);
    },
  };

  if (options.seedPlan !== false) {
    const coordinator = demoActorForRole("coordinator");
    const created = await store.createPlan(
      {
        planId: PLAN_ID,
        referralId: referralId("SYN-REFERRAL-001"),
        patientId: patientId(PATIENT_ID),
        pathwayVersionId: pathwayVersionId("SYN-PATHWAY-001"),
        dischargeAt: DISCHARGE_AT,
        sendingPreference: "morning",
        assurances: PLAN_ASSURANCE_VALUES,
        patientDetail: {
          patientName: PATIENT_NAME,
          preferredName: "Rowan",
          patientMobileNumber: PATIENT_MOBILE,
          patientIdentifiers: ["UR-00219384"],
          culturalIdentity: null,
        },
      },
      { actor: coordinator, idempotencyKey: idempotencyKey("seed-create") },
    );
    if (!created.ok) throw new Error(`seed createPlan refused: ${created.reason}`);
    const activated = await store.activatePlan(
      { planId: PLAN_ID, expectedVersion: created.value.plan.version },
      { actor: coordinator, idempotencyKey: idempotencyKey("seed-activate") },
    );
    if (!activated.ok) throw new Error(`seed activatePlan refused: ${activated.reason}`);
    const claimed = await store.applyAssignment(
      { planId: PLAN_ID, action: { type: "claim", actorId: coordinator.id } },
      { actor: coordinator, idempotencyKey: idempotencyKey("seed-claim") },
    );
    if (!claimed.ok) throw new Error(`seed claim refused: ${claimed.reason}`);
  }

  mocks.store.current = store;
  return { store, recorded: () => records, episodeReads: () => episodeReads };
}

async function callGet(query = ""): Promise<Response> {
  const { GET } = await import("@/app/api/caring-contacts/team/route");
  return GET(new NextRequest(`http://localhost/api/caring-contacts/team${query}`));
}

beforeEach(() => {
  mockCookies = {};
  mocks.store.current = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("an empty roster is a roster, not a missing resource", () => {
  it("answers a team holding no plans with 200 and an empty array", async () => {
    await inMemoryStoreWithSpy({ seedPlan: false });

    const response = await callGet();
    const body = (await response.json()) as TeamWorkloadView;

    // `auditedRead` maps a null release to DENIED and the handler turns that into 404, so an empty
    // roster answered as a collection rather than as a missing one is the thing being pinned.
    expect(response.status).toBe(200);
    expect(body.coordinators).toEqual([]);
    expect(body.unclaimed.plans).toBe(0);
  });

  it("answers a team that does hold work with a row -- the control for the case above", async () => {
    await inMemoryStoreWithSpy();

    const response = await callGet();
    const body = (await response.json()) as TeamWorkloadView;

    expect(response.status).toBe(200);
    expect(body.coordinators).toHaveLength(1);
    expect(body.coordinators[0].activePlans).toBe(1);
  });
});

describe("the read names itself on the access trail", () => {
  it("records one access under its own object type, whatever the roster holds", async () => {
    const spied = await inMemoryStoreWithSpy();

    await callGet();

    const access = spied.recorded();
    expect(access).toHaveLength(1);
    expect(access[0].objectType).toBe("teamWorkload");
    expect(access[0].objectId).toBe("all");
    expect(access[0].outcome).toBe("allowed");
    expect(access[0].actorId).toBe(demoActorForRole("coordinator").id);
  });

  it("records the empty roster too, as allowed rather than denied", async () => {
    const spied = await inMemoryStoreWithSpy({ seedPlan: false });

    await callGet();

    expect(spied.recorded().map((record) => record.outcome)).toEqual(["allowed"]);
  });
});

describe("a roster needs no patient, and is not a route to one", () => {
  it("never calls the read that releases patient identity", async () => {
    const spied = await inMemoryStoreWithSpy();

    await callGet();
    expect(spied.episodeReads()).toBe(0);

    // The double is proven live rather than assumed: the counter moves when the method IS called,
    // so the zero above is the route declining to call it and not a spy that was never wired.
    await spied.store.getEpisode(PLAN_ID, { actor: demoActorForRole("coordinator") });
    expect(spied.episodeReads()).toBe(1);
  });

  it("puts no patient id, plan id, name or mobile number on the wire", async () => {
    const spied = await inMemoryStoreWithSpy();

    const serialised = await (await callGet()).text();

    // The positive control, asserted first, and from TWO sources because the store splits them:
    // the plan and patient ids are on what the roll-up itself was given (`listPlans`), while the
    // name and mobile number are released only by `getEpisode`. So each refusal below is the
    // boundary narrowing something the store demonstrably holds, not an empty fixture.
    const coordinator = demoActorForRole("coordinator");
    const given = JSON.stringify(await spied.store.listPlans({ actor: coordinator }));
    for (const value of [PATIENT_ID, String(PLAN_ID)]) {
      expect(given).toContain(value);
      expect(serialised).not.toContain(value);
    }
    const episode = await spied.store.getEpisode(PLAN_ID, { actor: coordinator });
    if (!episode) throw new Error("seeded episode is unreadable");
    const held = JSON.stringify(episode);
    for (const value of [PATIENT_NAME, PATIENT_MOBILE]) {
      expect(held).toContain(value);
      expect(serialised).not.toContain(value);
    }
    // ... and the body is not empty, so `not.toContain` is not passing over nothing.
    expect(serialised).toContain("coordinators");
  });
});

describe("nothing from a query string reaches the read or the trail", () => {
  /**
   * The body with `asAtIso` taken off. That one field is the instant the request was served, which
   * differs between two calls by design -- the route resolves "now" from the system clock, as the
   * schedule route resolves "today" -- so comparing it would make this case about the clock rather
   * than about the query string.
   */
  function withoutTheInstant(body: string): string {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    expect(typeof parsed.asAtIso).toBe("string");
    delete parsed.asAtIso;
    return JSON.stringify(parsed);
  }

  it("answers a request carrying one exactly as it answers a bare request", async () => {
    const bare = await inMemoryStoreWithSpy();
    const bareBody = await (await callGet()).text();
    const bareAccess = bare.recorded()[0];

    const withQuery = await inMemoryStoreWithSpy();
    const queriedBody = await (await callGet(`?patientId=${PATIENT_ID}&q=${encodeURIComponent(PATIENT_NAME)}`)).text();
    const queriedAccess = withQuery.recorded()[0];

    expect(withoutTheInstant(queriedBody)).toBe(withoutTheInstant(bareBody));
    expect(queriedAccess.objectId).toBe(bareAccess.objectId);
    expect(queriedAccess.objectId).not.toContain(PATIENT_ID);
    expect(queriedBody).not.toContain(PATIENT_ID);
  });
});
