// tests/caring-contacts-api-handler.test.ts
//
// The API boundary. Phase 1 left "reads are not audited" open because a read is only observable
// where it crosses a boundary, and until Task 14 there was no boundary to observe it at. These
// tests are written against that boundary rather than against the stores, because the property
// being proved -- an access event exists for EVERY read, allowed or denied -- is a property of the
// seam, not of either store.
//
// The store and the demo-role cookie are both replaced here: `caringContactsStore()` is memoised
// process-wide (deliberately -- see store.ts), so a test that used the real one would share a
// single in-memory workspace across every case in this file.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({ store: { current: null as unknown } }));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: (name: string) => mockCookies[name] })),
}));

vi.mock("@/lib/caring-contacts-server/store", () => ({
  caringContactsStore: async () => mocks.store.current,
}));

import { readHandler, writeHandler } from "@/lib/caring-contacts-server/handler";
import { DEMO_RESTART_APPROVAL_SEATS } from "@/lib/caring-contacts-server/restart-approval-seats";
import { PLAN_ASSURANCE_VALUES } from "@/lib/caring-contacts/assurances";
import { narrowServiceStateForActor, type ServiceStateView } from "@/lib/caring-contacts-server/service-state-view";
import { CARING_CONTACTS_ROLE_COOKIE, DEMO_TEAM_ID, demoActorForRole } from "@/lib/caring-contacts-server/session";
import type { AccessRecord } from "@/lib/caring-contacts/access-audit";
import { fixedClock } from "@/lib/caring-contacts/clock";
import {
  actorId,
  idempotencyKey,
  pathwayVersionId,
  patientId,
  planId,
  referralId,
  teamId,
} from "@/lib/caring-contacts/ids";
import { createInMemoryRepository } from "@/lib/caring-contacts/in-memory-repository";
import type { Actor, CaringContactRole } from "@/lib/caring-contacts/permissions";
import type { CaringContactRepository } from "@/lib/caring-contacts/repository";
import type { ServiceState } from "@/lib/caring-contacts/service-state";

let mockCookies: Record<string, { value: string } | undefined> = {};
afterEach(() => {
  // `process.env.NODE_ENV` is read-only under TypeScript 6, so the production gate is
  // exercised through Vitest env stubbing rather than by assigning to it directly. This
  // restores what the assignment did and changes nothing about what is asserted.
  vi.unstubAllEnvs();
});

const PLAN_ID = planId("SYN-PLAN-001");

/**
 * Synthetic throughout. The name and mobile number are the exact strings the "no patient data in a
 * refusal body" assertion looks for, so a handler that echoed the record it refused to act on
 * would be caught rather than merely suspected.
 */
const PATIENT_DETAIL = {
  patientName: "Rowan Mira Delacroix",
  patientMobileNumber: "+61 491 570 156",
  patientIdentifiers: ["UR-00219384"],
  culturalIdentity: null,
  preferredName: "Rowan",
};

/** 2026-03-02 10:00 AWST discharge, read at 11:00 AWST -- the same instants the store contract uses. */
const DISCHARGE_AT = new Date("2026-03-02T02:00:00.000Z");
const NOW = "2026-03-02T03:00:00.000Z";

type Spied = { store: CaringContactRepository; recorded: () => AccessRecord[] };

/**
 * A fresh in-memory store holding one active plan, wired in behind `caringContactsStore()`, with
 * every `recordAccess` call captured. `actorRole` sets the demo cookie, which is the only thing
 * `resolveDemoActor()` reads.
 */
async function inMemoryStoreWithSpy(options: { actorRole?: CaringContactRole } = {}): Promise<Spied> {
  const role = options.actorRole ?? "coordinator";
  mockCookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: role } };

  // The demo's governance configuration, so a restart approval has a named seat holder to find.
  const repository = createInMemoryRepository(fixedClock(NOW), { restartApprovalSeats: DEMO_RESTART_APPROVAL_SEATS });
  const records: AccessRecord[] = [];
  const store: CaringContactRepository = {
    ...repository,
    async recordAccess(record: AccessRecord) {
      // The real store first, then the spy: `records` must mean "entered the trail", not "was
      // offered to it". Recording the attempt would have made the spy agree with a handler that
      // built an event the trail then rejected -- the exact defect fix round 1 Important 1 fixed.
      await repository.recordAccess(record);
      records.push(record);
    },
  };

  const coordinator = demoActorForRole("coordinator");
  const created = await store.createPlan(
    {
      planId: PLAN_ID,
      referralId: referralId("SYN-REFERRAL-001"),
      patientId: patientId("SYN-PATIENT-001"),
      pathwayVersionId: pathwayVersionId("SYN-PATHWAY-001"),
      dischargeAt: DISCHARGE_AT,
      sendingPreference: "morning",
      patientDetail: PATIENT_DETAIL,
      assurances: PLAN_ASSURANCE_VALUES,
    },
    { actor: coordinator, idempotencyKey: idempotencyKey("seed-create") },
  );
  if (!created.ok) throw new Error(`seed createPlan refused: ${created.reason}`);
  const activated = await store.activatePlan(
    { planId: PLAN_ID, expectedVersion: created.value.plan.version },
    { actor: coordinator, idempotencyKey: idempotencyKey("seed-activate") },
  );
  if (!activated.ok) throw new Error(`seed activatePlan refused: ${activated.reason}`);

  mocks.store.current = store;
  return { store, recorded: () => records };
}

function get(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

function post(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body) });
}

/** Stops the service, then attempts a pause of the seeded plan through the real plan route. */
async function pauseThroughHandler(): Promise<Response> {
  const { store } = await inMemoryStoreWithSpy();
  const stopped = await store.stopService(
    // The note is exactly the leak this whole task narrows: free text a responder writes
    // mid-incident, naming the patient involved.
    { reason: "wrong-recipient", note: "Message for Rowan Mira Delacroix reached +61 491 570 156." },
    { actor: demoActorForRole("coordinator"), idempotencyKey: idempotencyKey("seed-stop") },
  );
  if (!stopped.ok) throw new Error(`seed stopService refused: ${stopped.reason}`);

  const { POST } = await import("@/app/api/caring-contacts/plans/[planId]/route");
  return POST(
    post("/api/caring-contacts/plans/SYN-PLAN-001", {
      action: "pause",
      expectedVersion: 2,
      idempotencyKey: "pause-1",
    }),
    {
      params: Promise.resolve({ planId: "SYN-PLAN-001" }),
    },
  );
}

beforeEach(() => {
  mockCookies = {};
  mocks.store.current = null;
  // The plan route refuses a discharge more than 90 days before the server clock, so the wall clock
  // is pinned to the same instant the in-memory store's fixed clock uses. Only `Date` is faked.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.useRealTimers();
});

// Parents a plan names, built through the store's own writes: an approved pathway version and a
// referral, accepted or not. The plan route refuses a plan without them.
const PARENT_AUTHOR = demoActorForRole("coordinator");
const parentCtx = (actor: Actor, key: string) => ({ actor, idempotencyKey: idempotencyKey(key) });

/** A pathway version two different people approved, built through the store's own transitions. */
async function approvedPathwayVersion(store: CaringContactRepository, id: string): Promise<void> {
  const saved = await store.savePathwayVersion(
    {
      version: {
        id: pathwayVersionId(id),
        teamId: DEMO_TEAM_ID,
        state: "draft",
        authorId: PARENT_AUTHOR.id,
        approvals: [],
        publishedAt: null,
        retiredAt: null,
        retirementUrgency: null,
        snapshot: { cadenceLabels: ["Day 1"], messageTextByType: { standard: "s", first: "f", closing: "c" } },
      },
    },
    parentCtx(PARENT_AUTHOR, `${id}-save`),
  );
  if (!saved.ok) throw new Error(saved.reason);
  const steps: [Actor, Parameters<CaringContactRepository["transitionPathwayVersion"]>[0]["action"]][] = [
    [PARENT_AUTHOR, { type: "submitForReview" }],
    [
      demoActorForRole("clinicalProgrammeLead"),
      { type: "approve", role: "clinicalProgrammeLead", actorId: demoActorForRole("clinicalProgrammeLead").id },
    ],
    [
      demoActorForRole("livedExperienceRepresentative"),
      {
        type: "approve",
        role: "livedExperienceRepresentative",
        actorId: demoActorForRole("livedExperienceRepresentative").id,
      },
    ],
  ];
  for (const [index, [actor, action]] of steps.entries()) {
    const moved = await store.transitionPathwayVersion(
      { pathwayVersionId: pathwayVersionId(id), action },
      parentCtx(actor, `${id}-step-${index}`),
    );
    if (!moved.ok) throw new Error(moved.reason);
  }
}

async function planReferral(store: CaringContactRepository, id: string, patient: string, accept: string | null) {
  const created = await store.createReferral(
    { referralId: referralId(id), patientId: patientId(patient) },
    parentCtx(PARENT_AUTHOR, `${id}-create`),
  );
  if (!created.ok) throw new Error(created.reason);
  if (accept === null) return;
  const accepted = await store.transitionReferral(
    { referralId: referralId(id), action: { type: "accept", pathwayVersionId: pathwayVersionId(accept) } },
    parentCtx(PARENT_AUTHOR, `${id}-accept`),
  );
  if (!accepted.ok) throw new Error(accepted.reason);
}

describe("caring-contacts API boundary", () => {
  it("fails closed in production before a role-only demo session can read or mutate records", async () => {
    const { store, recorded } = await inMemoryStoreWithSpy();
    const getPlan = vi.spyOn(store, "getPlan");
    const applyAssignment = vi.spyOn(store, "applyAssignment");
    vi.stubEnv("NODE_ENV", "production");
    // The production lock's own isolated-Playwright-server exception is doubly flagged (see
    // "the production lock" in caring-contacts-session.test.ts) -- stub both flags off so this
    // stays fail-closed regardless of what the ambient process env happens to carry.
    vi.stubEnv("PLAYWRIGHT_OFFLINE_MODE", "false");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");

    const { GET: readPlan } = await import("@/app/api/caring-contacts/plans/[planId]/route");
    const { POST: writeAssignment } = await import("@/app/api/caring-contacts/assignments/[planId]/route");
    const context = { params: Promise.resolve({ planId: PLAN_ID }) };

    const read = await readPlan(get(`/api/caring-contacts/plans/${PLAN_ID}`), context);
    const write = await writeAssignment(
      post(`/api/caring-contacts/assignments/${PLAN_ID}`, {
        action: { type: "claim", actorId: "ACTOR-COVER" },
        idempotencyKey: "production-demo-denied",
      }),
      context,
    );

    expect(read.status).toBe(404);
    expect(write.status).toBe(404);
    expect(getPlan).not.toHaveBeenCalled();
    expect(applyAssignment).not.toHaveBeenCalled();
    expect(recorded()).toEqual([]);
  });

  /**
   * Live sovereign mode resolves its actor from a signed production session cookie, and
   * `resolveProductionActor` THROWS when it cannot rather than returning null. Nothing caught
   * that, so an unauthenticated live request left this boundary as an unhandled exception: a 500
   * with a stack trace, which tells the caller nothing it can act on and models nothing the audit
   * trail understands. Found while verifying an external audit on 2026-09-17 (finding C2).
   *
   * 401 and not 404: the disabled-workspace 404 above exists so an unavailable demo surface cannot
   * become an authorization oracle, and that reasoning does not carry here. Live mode has already
   * passed `isCaringContactsWorkspaceEnabled`, so the workspace demonstrably exists and "sign in"
   * discloses nothing the enabled workspace has not disclosed already.
   */
  function stubLiveMode(): void {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CARING_CONTACTS_DEMO_ENABLED", "false");
    vi.stubEnv("CARING_CONTACTS_SESSION_HMAC_SECRET", "session-hmac-secret");
    vi.stubEnv("CARING_CONTACTS_DATABASE_URL", "postgres://example.invalid/caring_contacts");
    // The production lock's isolated-Playwright exception is doubly flagged; stub both off so
    // this stays live mode regardless of what the ambient process env carries.
    vi.stubEnv("PLAYWRIGHT_OFFLINE_MODE", "false");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
  }

  it("refuses an unauthenticated live read with a named refusal, not a 500", async () => {
    const { store, recorded } = await inMemoryStoreWithSpy();
    const getPlan = vi.spyOn(store, "getPlan");
    stubLiveMode();
    mockCookies = {};

    const handler = readHandler({
      access: { kind: "view", objectType: "plan", objectId: () => "SYN-PLAN-001" },
      read: async (repository, actor) => repository.getPlan(PLAN_ID, { actor }),
    });
    const response = await handler(get("/api/caring-contacts/plans/SYN-PLAN-001"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ refusal: "session-required" });
    // Nothing was read and nothing was audited: the request never became an access attempt by an
    // identified actor, so there is no actor to record it against.
    expect(getPlan).not.toHaveBeenCalled();
    expect(recorded()).toEqual([]);
  });

  it("refuses an unauthenticated live write with a named refusal, not a 500", async () => {
    const { store, recorded } = await inMemoryStoreWithSpy();
    const applyAssignment = vi.spyOn(store, "applyAssignment");
    stubLiveMode();
    mockCookies = {};

    const { POST: writeAssignment } = await import("@/app/api/caring-contacts/assignments/[planId]/route");
    const response = await writeAssignment(
      post(`/api/caring-contacts/assignments/${PLAN_ID}`, {
        action: { type: "claim", actorId: "ACTOR-COVER" },
        idempotencyKey: "live-session-missing",
      }),
      { params: Promise.resolve({ planId: PLAN_ID }) },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ refusal: "session-required" });
    expect(applyAssignment).not.toHaveBeenCalled();
    expect(recorded()).toEqual([]);
  });

  it("does not let a forged demo role cookie stand in for a live session", async () => {
    // The demo role cookie carries a role name and no credential. In live mode it must buy
    // nothing at all -- not even the coordinator default it deliberately falls back to in demo.
    const { store } = await inMemoryStoreWithSpy();
    const getPlan = vi.spyOn(store, "getPlan");
    stubLiveMode();
    mockCookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: "teamLead" } };

    const handler = readHandler({
      access: { kind: "view", objectType: "plan", objectId: () => "SYN-PLAN-001" },
      read: async (repository, actor) => repository.getPlan(PLAN_ID, { actor }),
    });
    const response = await handler(get("/api/caring-contacts/plans/SYN-PLAN-001"));

    expect(response.status).toBe(401);
    expect(getPlan).not.toHaveBeenCalled();
  });

  it("records an access event for a successful read", async () => {
    const { recorded } = await inMemoryStoreWithSpy();
    const handler = readHandler({
      access: { kind: "view", objectType: "plan", objectId: () => "SYN-PLAN-001" },
      read: async (repository, actor) => repository.getPlan(PLAN_ID, { actor }),
    });

    const response = await handler(get("/api/caring-contacts/plans/SYN-PLAN-001"));

    expect(response.status).toBe(200);
    expect(recorded()).toContainEqual(
      expect.objectContaining({ kind: "view", objectType: "plan", outcome: "allowed" }),
    );
  });

  it("records an access event even when the read is denied", async () => {
    // The auditor may read the access trail and nothing else: `getEpisode` needs
    // generateClinicalRecordSummary, which the auditor does not hold, so the store returns null.
    const { recorded } = await inMemoryStoreWithSpy({ actorRole: "auditor" });
    const handler = readHandler({
      access: { kind: "view", objectType: "episode", objectId: () => "SYN-PLAN-001" },
      read: async (repository, actor) => repository.getEpisode(PLAN_ID, { actor }),
    });

    const response = await handler(get("/api/caring-contacts/episodes/SYN-PLAN-001"));

    expect(response.status).toBe(404);
    expect(recorded()).toContainEqual(expect.objectContaining({ outcome: "denied" }));
  });

  // Ruling 84's HTTP half. `auditedRead` maps a null/undefined release to "denied", and this
  // handler turns "denied" into 404 -- see the denied-read test above. AN EMPTY ARRAY IS NEITHER,
  // and a list read that comes back empty must reach the caller as a 200 carrying `[]`. Nothing
  // pinned it: the render half is pinned in tests/caring-contacts-patients-page.dom.test.tsx, and
  // an edit that "simplified" the outcome check to a falsy test would have turned every empty
  // caseload in the workspace into a missing resource with no test to notice.
  it("releases an EMPTY LIST as a 200, never as the 404 a denied read produces", async () => {
    // The auditor holds no `viewReferral`, so `listPlans` filters the seeded plan out and returns
    // `[]` -- the exact case this module's own note calls out as the one the trail cannot tell
    // apart from "there are none". Both must leave here as 200, because both released a list.
    const { recorded } = await inMemoryStoreWithSpy({ actorRole: "auditor" });
    const handler = readHandler({
      access: { kind: "search", objectType: "plan", objectId: () => "all" },
      read: async (repository, actor) => repository.listPlans({ actor }),
    });

    const response = await handler(get("/api/caring-contacts/plans"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([]);
    // And it is recorded as ALLOWED: an empty list IS what was released.
    expect(recorded()).toContainEqual(
      expect.objectContaining({ kind: "search", objectType: "plan", objectId: "all", outcome: "allowed" }),
    );
  });

  it("names the acting actor and team on the access event, so the trail can be read back", async () => {
    const { recorded } = await inMemoryStoreWithSpy({ actorRole: "teamLead" });
    const handler = readHandler({
      access: { kind: "view", objectType: "plan", objectId: () => "SYN-PLAN-001" },
      read: async (repository, actor) => repository.getPlan(PLAN_ID, { actor }),
    });

    await handler(get("/api/caring-contacts/plans/SYN-PLAN-001"));

    expect(recorded()).toContainEqual(
      expect.objectContaining({ actorId: actorId("demo-teamLead"), teamId: DEMO_TEAM_ID, actorRoles: ["teamLead"] }),
    );
  });

  it("returns the named denial reason so the interface can explain itself", async () => {
    await inMemoryStoreWithSpy();
    const handler = writeHandler({
      schema: z.object({ planId: z.string() }),
      action: "publishPathwayVersion",
      access: { objectType: "pathwayVersion", objectId: () => "SYN-PATHWAY-001" },
      write: async () => ({ ok: true, value: null }),
    });

    const response = await handler(post("/api/caring-contacts/pathway-versions", { planId: "SYN-PLAN-001" }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ refusal: "action-not-granted" });
  });

  it("never reaches the write when the capability check denies it", async () => {
    await inMemoryStoreWithSpy();
    const write = vi.fn(async () => ({ ok: true as const, value: null }));
    const handler = writeHandler({
      schema: z.object({}),
      action: "publishPathwayVersion",
      access: { objectType: "pathwayVersion", objectId: () => "SYN-PATHWAY-001" },
      write,
    });

    await handler(post("/api/caring-contacts/pathway-versions", {}));

    expect(write).not.toHaveBeenCalled();
  });

  it("returns 423 and refuses a write while the service is stopped", async () => {
    expect((await pauseThroughHandler()).status).toBe(423);
  });

  it("never returns patient data in a refusal body", async () => {
    const response = await pauseThroughHandler();
    const body = await response.text();
    expect(body).toContain("service-stopped");
    expect(body).not.toMatch(/Rowan|Mira|\+61/);
  });

  it("refuses a body that does not parse, without leaking an internal error", async () => {
    await inMemoryStoreWithSpy();
    const handler = writeHandler({
      schema: z.object({ expectedVersion: z.number() }),
      action: "pausePlan",
      access: { objectType: "plan", objectId: () => "SYN-PLAN-001" },
      write: async () => ({ ok: true, value: null }),
    });

    const response = await handler(post("/api/caring-contacts/plans/SYN-PLAN-001", { expectedVersion: "two" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ refusal: "invalid-request" });
  });

  // A store fault must still leave the boundary as the boundary's own JSON shape, uncacheable and
  // carrying nothing of the error -- never an unhandled exception.
  it("answers a write that throws with a named 500, not an unhandled exception", async () => {
    await inMemoryStoreWithSpy();
    const handler = writeHandler({
      schema: z.object({}),
      action: "pausePlan",
      access: { objectType: "plan", objectId: () => "SYN-PLAN-001" },
      write: async () => {
        throw new Error("connection reset while writing Rowan Mira Delacroix");
      },
    });

    const response = await handler(post("/api/caring-contacts/plans/SYN-PLAN-001", {}));

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ refusal: "write-failed" });
    expect(body).not.toMatch(/Rowan|connection reset/);
  });

  // "0412345678" is a legal identifier shape AND an Australian mobile number, so the audit event's
  // own patient-data scan refuses it after the schema has accepted it. Nothing is written, and the
  // caller has sent an unusable identifier -- a 400, not a server fault.
  it("answers an identifier the audit trail refuses as patient data with a 400", async () => {
    await inMemoryStoreWithSpy();
    const { POST } = await import("@/app/api/caring-contacts/plans/[planId]/route");

    const response = await POST(
      post("/api/caring-contacts/plans/SYN-PLAN-001", {
        action: "pause",
        expectedVersion: 2,
        idempotencyKey: "0412345678",
      }),
      { params: Promise.resolve({ planId: "SYN-PLAN-001" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ refusal: "invalid-request" });
  });

  it("refuses a plan whose patient name is only whitespace with a 400, not a 500", async () => {
    await inMemoryStoreWithSpy();
    const { POST } = await import("@/app/api/caring-contacts/plans/route");

    const response = await POST(
      post("/api/caring-contacts/plans", {
        planId: "SYN-PLAN-002",
        referralId: "SYN-REFERRAL-002",
        patientId: "SYN-PATIENT-002",
        pathwayVersionId: "SYN-PATHWAY-001",
        dischargeAt: "2026-03-02T02:00:00.000Z",
        sendingPreference: "morning",
        patientDetail: { ...PATIENT_DETAIL, patientName: "   " },
        assurances: [...PLAN_ASSURANCE_VALUES],
        idempotencyKey: "blank-name-create",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ refusal: "invalid-request" });
  });

  describe("creating a plan checks the referral and pathway it names", () => {
    function createBody(overrides: Record<string, unknown>) {
      return {
        planId: "SYN-PLAN-010",
        referralId: "SYN-REFERRAL-010",
        patientId: "SYN-PATIENT-010",
        pathwayVersionId: "SYN-PATHWAY-010",
        dischargeAt: "2026-03-02T02:00:00.000Z",
        sendingPreference: "morning",
        patientDetail: PATIENT_DETAIL,
        assurances: [...PLAN_ASSURANCE_VALUES],
        idempotencyKey: "parents-create",
        ...overrides,
      };
    }

    it("refuses a referral that does not exist", async () => {
      const { store } = await inMemoryStoreWithSpy();
      await approvedPathwayVersion(store, "SYN-PATHWAY-010");
      const { POST } = await import("@/app/api/caring-contacts/plans/route");

      const response = await POST(post("/api/caring-contacts/plans", createBody({})));
      expect(response.status).toBe(404);
      expect(await store.getPlan(planId("SYN-PLAN-010"), { actor: PARENT_AUTHOR })).toBeNull();
    });

    it("refuses a referral that was never accepted, or that names a different patient", async () => {
      const { store } = await inMemoryStoreWithSpy();
      await approvedPathwayVersion(store, "SYN-PATHWAY-010");
      await planReferral(store, "SYN-REFERRAL-010", "SYN-PATIENT-010", null);
      await planReferral(store, "SYN-REFERRAL-011", "SYN-PATIENT-OTHER", "SYN-PATHWAY-010");
      const { POST } = await import("@/app/api/caring-contacts/plans/route");

      const notAccepted = await POST(post("/api/caring-contacts/plans", createBody({})));
      expect(notAccepted.status).toBe(422);
      await expect(notAccepted.json()).resolves.toEqual({ refusal: "referral-not-accepted" });

      const wrongPatient = await POST(
        post("/api/caring-contacts/plans", createBody({ referralId: "SYN-REFERRAL-011", idempotencyKey: "k-2" })),
      );
      expect(wrongPatient.status).toBe(422);
      await expect(wrongPatient.json()).resolves.toEqual({ refusal: "referral-patient-mismatch" });
      expect(await store.getPlan(planId("SYN-PLAN-010"), { actor: PARENT_AUTHOR })).toBeNull();
    });

    // The wizard offers only approved versions, but a version can be retired -- for an urgent
    // safety reason -- while a wizard is open in another tab.
    it("refuses a pathway version that is not approved", async () => {
      const { store } = await inMemoryStoreWithSpy();
      await approvedPathwayVersion(store, "SYN-PATHWAY-010");
      await planReferral(store, "SYN-REFERRAL-010", "SYN-PATIENT-010", "SYN-PATHWAY-010");
      const retired = await store.transitionPathwayVersion(
        {
          pathwayVersionId: pathwayVersionId("SYN-PATHWAY-010"),
          action: { type: "retire", urgency: "urgentSafety" },
        },
        parentCtx(demoActorForRole("clinicalProgrammeLead"), "retire"),
      );
      if (!retired.ok) throw new Error(retired.reason);
      const { POST } = await import("@/app/api/caring-contacts/plans/route");

      const response = await POST(post("/api/caring-contacts/plans", createBody({})));
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toEqual({ refusal: "pathway-version-not-approved" });
    });

    it("creates the plan when the referral is accepted for this patient and the version is approved", async () => {
      const { store } = await inMemoryStoreWithSpy();
      await approvedPathwayVersion(store, "SYN-PATHWAY-010");
      await planReferral(store, "SYN-REFERRAL-010", "SYN-PATIENT-010", "SYN-PATHWAY-010");
      const { POST } = await import("@/app/api/caring-contacts/plans/route");

      const response = await POST(post("/api/caring-contacts/plans", createBody({})));
      expect(response.status).toBe(200);
      expect(await store.getPlan(planId("SYN-PLAN-010"), { actor: PARENT_AUTHOR })).not.toBeNull();
    });
  });

  // An instant with no offset is read in the SERVER's local time zone by JavaScript and in the
  // session time zone by Postgres, so the same request would anchor a discharge -- and with it the
  // whole twelve-month calendar -- to a different AWST day depending on where it ran.
  it("refuses a discharge instant that carries no time-zone offset", async () => {
    await inMemoryStoreWithSpy();
    const { POST } = await import("@/app/api/caring-contacts/plans/route");

    const response = await POST(
      post("/api/caring-contacts/plans", {
        planId: "SYN-PLAN-003",
        referralId: "SYN-REFERRAL-003",
        patientId: "SYN-PATIENT-003",
        pathwayVersionId: "SYN-PATHWAY-001",
        dischargeAt: "2026-03-02T20:00:00",
        sendingPreference: "morning",
        patientDetail: PATIENT_DETAIL,
        assurances: [...PLAN_ASSURANCE_VALUES],
        idempotencyKey: "no-offset-create",
      }),
    );

    expect(response.status).toBe(400);
  });

  it("refuses a dispatch window with no offset, or whose end is before its start", async () => {
    await inMemoryStoreWithSpy();
    const { GET } = await import("@/app/api/caring-contacts/dispatches/route");

    const noOffset = await GET(get("/api/caring-contacts/dispatches?from=2026-03-01T00:00:00&to=2026-03-09T00:00:00"));
    expect(noOffset.status).toBe(400);

    const inverted = await GET(
      get("/api/caring-contacts/dispatches?from=2026-03-09T00:00:00.000Z&to=2026-03-01T00:00:00.000Z"),
    );
    expect(inverted.status).toBe(400);

    const ok = await GET(
      get("/api/caring-contacts/dispatches?from=2026-03-01T00:00:00%2B08:00&to=2026-03-09T00:00:00Z"),
    );
    expect(ok.status).toBe(200);
  });

  it("maps a stale version to 409 rather than to the catch-all", async () => {
    const { store } = await inMemoryStoreWithSpy();
    const { POST } = await import("@/app/api/caring-contacts/plans/[planId]/route");

    const response = await POST(
      post("/api/caring-contacts/plans/SYN-PLAN-001", {
        action: "pause",
        expectedVersion: 99,
        idempotencyKey: "pause-stale",
      }),
      { params: Promise.resolve({ planId: "SYN-PLAN-001" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ refusal: "stale-version" });
    expect((await store.getPlan(PLAN_ID, { actor: demoActorForRole("coordinator") }))?.plan.state).toBe("active");
  });

  it("marks every response no-store, allowed and refused alike", async () => {
    await inMemoryStoreWithSpy();
    const allowed = readHandler({
      access: { kind: "view", objectType: "plan", objectId: () => "SYN-PLAN-001" },
      read: async (repository, actor) => repository.getPlan(PLAN_ID, { actor }),
    });
    const readResponse = await allowed(get("/api/caring-contacts/plans/SYN-PLAN-001"));
    const refusedResponse = await pauseThroughHandler();

    expect(readResponse.headers.get("cache-control")).toContain("no-store");
    expect(refusedResponse.headers.get("cache-control")).toContain("no-store");
  });

  // Ruling 45. Before it, a write refused by the capability check never reached the store, so
  // `runWrite` never ran and the attempt left no trace at all -- the one gap in "every mutation".
  it("produces exactly one audit event for every write attempt through the boundary, whichever way it goes", async () => {
    const { store, recorded } = await inMemoryStoreWithSpy();
    const auditor = demoActorForRole("auditor");
    const before = (await store.listAuditEvents({ actor: auditor })).length;

    // Denied at the boundary: the coordinator does not hold `publishPathwayVersion`.
    const { POST: publish } = await import("@/app/api/caring-contacts/pathway-versions/route");
    const denied = await publish(
      post("/api/caring-contacts/pathway-versions", {
        pathwayVersionId: "SYN-PATHWAY-001",
        action: { type: "publish" },
        idempotencyKey: "publish-1",
      }),
    );

    expect(denied.status).toBe(403);
    expect(recorded()).toEqual([
      expect.objectContaining({ kind: "mutation", objectType: "pathwayVersion", outcome: "denied" }),
    ]);
    expect(await store.listAuditEvents({ actor: auditor })).toHaveLength(before + 1);

    // Allowed at the boundary: the store audits it, and the boundary adds nothing of its own.
    const { POST: lifecycle } = await import("@/app/api/caring-contacts/plans/[planId]/route");
    const allowed = await lifecycle(
      post("/api/caring-contacts/plans/SYN-PLAN-001", {
        action: "pause",
        expectedVersion: 2,
        idempotencyKey: "pause-invariant",
      }),
      { params: Promise.resolve({ planId: "SYN-PLAN-001" }) },
    );

    expect(allowed.status).toBe(200);
    expect(recorded()).toHaveLength(1);
    expect(await store.listAuditEvents({ actor: auditor })).toHaveLength(before + 2);
  });

  it("still refuses the write when the denial cannot be recorded", async () => {
    const { store } = await inMemoryStoreWithSpy();
    vi.spyOn(store, "recordAccess").mockRejectedValue(new Error("audit sink unavailable"));
    const { POST: publish } = await import("@/app/api/caring-contacts/pathway-versions/route");

    const response = await publish(
      post("/api/caring-contacts/pathway-versions", {
        pathwayVersionId: "SYN-PATHWAY-001",
        action: { type: "publish" },
        idempotencyKey: "publish-2",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ refusal: "action-not-granted" });
  });

  // Fix round 1, Important 1. The audited actor could switch off their own audit record by typing
  // a space: a malformed objectId made `buildAccessAuditEvent` throw, and `recordAccessAttempt`
  // discards that failure by design (Ruling 45's unblockable requirement). The record must be made
  // whatever the caller sent.
  it("still records exactly one audit event when the denied write carries a malformed identifier", async () => {
    const { store, recorded } = await inMemoryStoreWithSpy();
    const auditor = demoActorForRole("auditor");
    const before = (await store.listAuditEvents({ actor: auditor })).length;
    // Deliberately unconstrained, so this proves the handler's own guarantee rather than the route
    // schema in front of it.
    const handler = writeHandler({
      schema: z.object({ id: z.string() }),
      action: "publishPathwayVersion",
      access: { objectType: "pathwayVersion", objectId: (body) => body.id },
      write: async () => ({ ok: true, value: null }),
    });

    const response = await handler(post("/api/caring-contacts/pathway-versions", { id: "SYN PATHWAY 001" }));

    expect(response.status).toBe(403);
    expect(recorded()).toHaveLength(1);
    expect(await store.listAuditEvents({ actor: auditor })).toHaveLength(before + 1);
    // The rejected value is never recorded; the bare object-type name is the documented safe shape.
    expect(recorded()[0]).toMatchObject({ objectType: "pathwayVersion", objectId: "pathwayVersion" });
  });

  it("refuses a malformed identifier at the route with a clean 400, before it reaches the audit path", async () => {
    await inMemoryStoreWithSpy();
    const { POST } = await import("@/app/api/caring-contacts/pathway-versions/route");

    const response = await POST(
      post("/api/caring-contacts/pathway-versions", {
        pathwayVersionId: "SYN PATHWAY 001",
        action: { type: "publish" },
        idempotencyKey: "publish-malformed",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ refusal: "invalid-request" });
  });

  // Fix round 1, Minor 1. The same chain on the read side reported the trail as DOWN for what was
  // only ever a caller mistake, which would make a genuine outage alarm untrustworthy.
  it("does not report the audit trail as unavailable when the caller supplies a malformed identifier", async () => {
    const { recorded } = await inMemoryStoreWithSpy();
    const handler = readHandler({
      access: { kind: "view", objectType: "plan", objectId: () => "SYN PLAN 001" },
      read: async (repository, actor) => repository.getPlan(PLAN_ID, { actor }),
    });

    const response = await handler(get("/api/caring-contacts/plans/SYN-PLAN-001"));

    expect(response.status).toBe(200);
    expect(recorded()).toEqual([expect.objectContaining({ objectType: "plan", objectId: "plan" })]);
  });

  // Fix round 2, Important 1 half 2. The shape allowlist and the mobile-number scan are two
  // INDEPENDENT guards and their grammars overlap: "0412345678" is a legal identifier shape AND a
  // mobile number, so a substitution keyed on the first guard left the second one able to throw
  // the event away. The pair above cannot tell "the record is unfailable" apart from "the record
  // survives the one rejection reason we thought of"; this is the case that can.
  it("still records exactly one audit event when the denied write carries a mobile-shaped identifier", async () => {
    const { store, recorded } = await inMemoryStoreWithSpy();
    const auditor = demoActorForRole("auditor");
    const before = (await store.listAuditEvents({ actor: auditor })).length;
    const handler = writeHandler({
      schema: z.object({ id: z.string() }),
      action: "publishPathwayVersion",
      access: { objectType: "pathwayVersion", objectId: (body) => body.id },
      write: async () => ({ ok: true, value: null }),
    });

    const response = await handler(post("/api/caring-contacts/pathway-versions", { id: "0412345678" }));

    expect(response.status).toBe(403);
    expect(recorded()).toHaveLength(1);
    expect(await store.listAuditEvents({ actor: auditor })).toHaveLength(before + 1);
    expect(recorded()[0]).toMatchObject({ objectType: "pathwayVersion", objectId: "pathwayVersion" });
  });

  // Fix round 2, Minor 1. Same residual on the read side, through the real route: the segment
  // passes the route's shape guard, then the mobile-number scan rejects the event, and the caller
  // was told the TRAIL was down.
  it("does not report the audit trail as unavailable for a mobile-shaped path segment", async () => {
    const { recorded } = await inMemoryStoreWithSpy();
    const { GET } = await import("@/app/api/caring-contacts/plans/[planId]/route");

    const response = await GET(get("/api/caring-contacts/plans/0412345678"), {
      params: Promise.resolve({ planId: "0412345678" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ refusal: "not-found" });
    expect(recorded()).toEqual([expect.objectContaining({ objectType: "plan", objectId: "plan", outcome: "denied" })]);
  });

  // Fix round 1, Minor 3. Pre-existing store behaviour, deliberately unchanged: `runWrite` returns
  // the cached result before building an event, so a replay is not a second attempt. Pinned here
  // because it sits on the edge of Ruling 45's invariant and nothing covered it.
  it("produces no audit event for an idempotent replay of an already-recorded attempt", async () => {
    const { store } = await inMemoryStoreWithSpy();
    const auditor = demoActorForRole("auditor");
    const { POST } = await import("@/app/api/caring-contacts/plans/[planId]/route");
    const body = { action: "pause", expectedVersion: 2, idempotencyKey: "pause-replay" };

    const first = await POST(post("/api/caring-contacts/plans/SYN-PLAN-001", body), {
      params: Promise.resolve({ planId: "SYN-PLAN-001" }),
    });
    const afterFirst = (await store.listAuditEvents({ actor: auditor })).length;
    const replay = await POST(post("/api/caring-contacts/plans/SYN-PLAN-001", body), {
      params: Promise.resolve({ planId: "SYN-PLAN-001" }),
    });

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(await store.listAuditEvents({ actor: auditor })).toHaveLength(afterFirst);
  });

  // Fix round 1, Important 2. `parseJsonBodyOrDefault` returned null for an unparseable body,
  // which the schema's own defaults then turned into the BROADEST window -- so an audit reviewer
  // was answered a different question than the one they asked, and it looked authoritative.
  it("refuses an unparseable access-trail query rather than answering a different window", async () => {
    await inMemoryStoreWithSpy({ actorRole: "auditor" });
    const { POST } = await import("@/app/api/caring-contacts/access-trail/route");

    const response = await POST(
      new NextRequest("http://localhost/api/caring-contacts/access-trail", { method: "POST", body: "{not json" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ refusal: "invalid-request" });
  });

  it("answers a well-formed access-trail query", async () => {
    await inMemoryStoreWithSpy({ actorRole: "auditor" });
    const { POST } = await import("@/app/api/caring-contacts/access-trail/route");

    const response = await POST(post("/api/caring-contacts/access-trail", { limit: 5, offset: 0 }));

    expect(response.status).toBe(200);
    expect(Array.isArray(await response.json())).toBe(true);
  });

  it("refuses an invalid access-trail timestamp before the datastore query", async () => {
    const { store } = await inMemoryStoreWithSpy({ actorRole: "auditor" });
    const listAccessTrail = vi.spyOn(store, "listAccessTrail");
    const { POST } = await import("@/app/api/caring-contacts/access-trail/route");

    const response = await POST(post("/api/caring-contacts/access-trail", { fromIso: "not-a-date" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ refusal: "invalid-request" });
    expect(listAccessTrail).not.toHaveBeenCalled();
  });

  // Fix round 1, Minor 6. The service-stopped body is assembled from a constant, so it could not
  // catch a leak anywhere else. This refusal arises from stored record state, and the request that
  // provokes it carries a name, a mobile number and an identifier.
  it("never returns patient data in a refusal that arises from real record data", async () => {
    await inMemoryStoreWithSpy();
    // The seeded plan for SYN-PATIENT-001 has not ended, so a new referral for that patient is
    // refused from real record data -- `createReferral` asks the same one-open-plan-per-person
    // question `createPlan` does, and it is now the first place a duplicate is caught.
    const { POST } = await import("@/app/api/caring-contacts/referrals/route");

    const response = await POST(
      post("/api/caring-contacts/referrals", {
        type: "create",
        referralId: "SYN-REFERRAL-002",
        patientId: "SYN-PATIENT-001",
        idempotencyKey: "create-duplicate",
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(409);
    expect(body).toContain("duplicate-active-plan");
    expect(body).not.toMatch(/Rowan|Mira|\+61|UR-00219384/);
  });

  // Ruling 49: a duplicate identifier is a conflict, the same as the three 409s the brief named.
  it("maps a duplicate referral identifier to 409, not to the catch-all", async () => {
    await inMemoryStoreWithSpy();
    const { POST } = await import("@/app/api/caring-contacts/referrals/route");

    const first = await POST(
      post("/api/caring-contacts/referrals", {
        type: "create",
        referralId: "SYN-REFERRAL-010",
        patientId: "SYN-PATIENT-010",
        idempotencyKey: "referral-first",
      }),
    );
    const duplicate = await POST(
      post("/api/caring-contacts/referrals", {
        type: "create",
        referralId: "SYN-REFERRAL-010",
        patientId: "SYN-PATIENT-011",
        idempotencyKey: "referral-second",
      }),
    );

    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toEqual({ refusal: "referral-already-exists" });
  });

  it("falls back to 422 for a refusal the status map does not name", async () => {
    // `resume` on a plan that is already active. Not a permission problem, not a conflict of
    // versions -- a state the domain refuses by name, which is what the catch-all is for.
    await inMemoryStoreWithSpy();
    const { POST } = await import("@/app/api/caring-contacts/plans/[planId]/route");

    const response = await POST(
      post("/api/caring-contacts/plans/SYN-PLAN-001", {
        action: "resume",
        expectedVersion: 2,
        idempotencyKey: "resume-1",
      }),
      { params: Promise.resolve({ planId: "SYN-PLAN-001" }) },
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ refusal: "plan-not-paused" });
  });

  it("records a failed outcome and releases nothing when the read itself throws", async () => {
    const { recorded } = await inMemoryStoreWithSpy();
    const handler = readHandler({
      access: { kind: "view", objectType: "plan", objectId: () => "SYN-PLAN-001" },
      read: async () => {
        throw new Error("store unavailable");
      },
    });

    const response = await handler(get("/api/caring-contacts/plans/SYN-PLAN-001"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ refusal: "read-failed" });
    expect(recorded()).toContainEqual(expect.objectContaining({ outcome: "failed" }));
  });

  it("releases nothing when the access event cannot be recorded", async () => {
    const { store } = await inMemoryStoreWithSpy();
    vi.spyOn(store, "recordAccess").mockRejectedValue(new Error("audit sink unavailable"));
    const handler = readHandler({
      access: { kind: "view", objectType: "plan", objectId: () => "SYN-PLAN-001" },
      read: async (repository, actor) => repository.getPlan(PLAN_ID, { actor }),
    });

    const response = await handler(get("/api/caring-contacts/plans/SYN-PLAN-001"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ refusal: "access-audit-unavailable" });
  });
});

// ---------------------------------------------------------------------------
// Ruling 43 -- the service-state read is narrowed at this boundary.
//
// `getServiceState` is not capability-checked in either store, by design: the stopped FACT must
// reach every team, including one that had no part in the incident (Ruling 9). But the record it
// hands back carries the responder's free-text `note`, which the schema classifies as patient
// data. The narrowing happens here, at the designated boundary, and it has two halves -- the note
// is withheld, and the fact is not.
// ---------------------------------------------------------------------------

const REPORTING_TEAM = teamId("TEAM-NORTH");

function stoppedState(): ServiceState {
  return {
    stopped: true,
    reportedByTeamId: REPORTING_TEAM,
    reason: "wrong-recipient",
    stoppedBy: actorId("ACTOR-INCIDENT-LEAD"),
    stoppedAt: "2026-03-02T11:00:00.000+08:00",
    note: "Message for Rowan Mira Delacroix reached +61 491 570 156.",
    restartApprovals: [],
  };
}

function foreignActor(): Actor {
  return { id: actorId("ACTOR-SOUTH"), teamId: teamId("TEAM-SOUTH"), roles: ["coordinator"] };
}

function reportingActor(): Actor {
  return { id: actorId("ACTOR-NORTH"), teamId: REPORTING_TEAM, roles: ["coordinator"] };
}

function stoppedView(view: ServiceStateView): Extract<ServiceStateView, { stopped: true }> {
  if (!view.stopped) throw new Error("expected a stopped service-state view");
  return view;
}

describe("service-state read narrowing (Ruling 43)", () => {
  it("withholds the incident note from an actor outside the reporting team", () => {
    const view = stoppedView(narrowServiceStateForActor(stoppedState(), foreignActor()));

    expect(view.incidentDetail).toEqual({ visible: false, withheldReason: "cross-team-denied" });
    expect(JSON.stringify(view)).not.toMatch(/Rowan|Mira|\+61/);
  });

  it("still tells that actor the service is stopped, why, and when", () => {
    const view = stoppedView(narrowServiceStateForActor(stoppedState(), foreignActor()));

    expect(view.reason).toBe("wrong-recipient");
    expect(view.stoppedAt).toBe("2026-03-02T11:00:00.000+08:00");
    expect(view.banner).toContain("All caring-contact sending is stopped for the whole service");
  });

  it("releases the note to an actor of the reporting team who may see incident detail", () => {
    const view = stoppedView(narrowServiceStateForActor(stoppedState(), reportingActor()));

    expect(view.incidentDetail).toEqual({
      visible: true,
      stoppedBy: actorId("ACTOR-INCIDENT-LEAD"),
      note: "Message for Rowan Mira Delacroix reached +61 491 570 156.",
    });
  });

  it("withholds the note from an actor whose roles do not include the patient-record capability", () => {
    const roleless: Actor = { id: actorId("ACTOR-NONE"), teamId: REPORTING_TEAM, roles: [] };

    const view = stoppedView(narrowServiceStateForActor(stoppedState(), roleless));

    expect(view.incidentDetail).toEqual({ visible: false, withheldReason: "no-roles" });
    expect(view.reason).toBe("wrong-recipient");
  });

  it("carries no incident fields at all while the service is running", () => {
    const running: ServiceState = { stopped: false, reportedByTeamId: REPORTING_TEAM };

    expect(narrowServiceStateForActor(running, foreignActor())).toEqual({ stopped: false, banner: null });
  });

  it("narrows the note through the service-state route, and still reports the stop", async () => {
    const { store, recorded } = await inMemoryStoreWithSpy();
    // Raised by an actor of another team, so the demo actor reading it is outside the reporting
    // team -- the exact case Ruling 43 is about.
    const stopped = await store.stopService(
      { reason: "duplicate-send", note: "Rowan Mira Delacroix received the same message twice." },
      {
        actor: { id: actorId("ACTOR-NORTH"), teamId: REPORTING_TEAM, roles: ["teamLead"] },
        idempotencyKey: idempotencyKey("seed-stop-other-team"),
      },
    );
    if (!stopped.ok) throw new Error(`seed stopService refused: ${stopped.reason}`);

    const { GET } = await import("@/app/api/caring-contacts/service-state/route");
    const response = await GET(get("/api/caring-contacts/service-state"));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toMatch(/Rowan|Mira/);
    expect(JSON.parse(body)).toMatchObject({
      stopped: true,
      reason: "duplicate-send",
      incidentDetail: { visible: false, withheldReason: "cross-team-denied" },
    });
    expect(recorded()).toContainEqual(expect.objectContaining({ objectType: "serviceState", outcome: "allowed" }));
  });

  it("narrows the note out of the POST reply too, not only the GET", async () => {
    // The first and second restart approvals leave the service STOPPED, so `approveServiceRestart`
    // hands back the still-stopped record -- note and all. `writeHandler` serialises whatever the
    // write returns, so an unnarrowed POST reply releases the reporting team's incident note to
    // the approver. Capability is checked here against the APPROVER'S OWN team, while the note is
    // only releasable to an actor of the REPORTING team, so the two questions are not the same one
    // and a second team's approver is a legitimate reader of a reply they may not read the note in.
    const { store } = await inMemoryStoreWithSpy({ actorRole: "teamLead" });
    const stopped = await store.stopService(
      { reason: "duplicate-send", note: "Rowan Mira Delacroix received the same message twice." },
      {
        actor: { id: actorId("ACTOR-NORTH"), teamId: REPORTING_TEAM, roles: ["teamLead"] },
        idempotencyKey: idempotencyKey("seed-stop-before-approval"),
      },
    );
    if (!stopped.ok) throw new Error(`seed stopService refused: ${stopped.reason}`);

    const { POST } = await import("@/app/api/caring-contacts/service-state/route");
    const response = await POST(
      post("/api/caring-contacts/service-state", {
        type: "approveRestart",
        role: "incidentLead",
        idempotencyKey: "approve-restart-1",
      }),
    );
    const body = await response.text();

    // The approval was accepted: this is the reply of a write that succeeded, not of one refused
    // before it could leak anything.
    expect(response.status).toBe(200);
    expect(JSON.parse(body)).toMatchObject({ value: { stopped: true, reason: "duplicate-send" } });
    expect(body).not.toMatch(/Rowan|Mira/);
    expect(body).not.toMatch(/"note"/);
  });
});

// ---------------------------------------------------------------------------
// The assignment boundary refuses a malformed coverage window before the store has to.
//
// A coverage window is an AWST calendar day, and the domain now refuses anything else by name
// (`coverage-window-not-calendar-day`). The route accepted `from`/`until` as any non-empty string,
// so the store's named refusal was the ONLY thing standing between nonsense and the database's own
// regular-expression check. Both layers now hold the same rule, from the same predicate.
// ---------------------------------------------------------------------------
describe("the assignment route holds coverage windows to the calendar-day shape", () => {
  const context = { params: Promise.resolve({ planId: PLAN_ID }) };

  function coverage(from: string, until: string) {
    return post(`/api/caring-contacts/assignments/${PLAN_ID}`, {
      action: { type: "startCoverage", actorId: "ACTOR-COVER", from, until },
      idempotencyKey: "cover-1",
    });
  }

  it("refuses a window that is not a calendar day, without reaching the store", async () => {
    const { store } = await inMemoryStoreWithSpy({ actorRole: "teamLead" });
    const applyAssignment = vi.spyOn(store, "applyAssignment");

    const { POST } = await import("@/app/api/caring-contacts/assignments/[planId]/route");

    for (const [from, until] of [
      ["banana", "cherry"],
      ["2026-02-30", "2026-03-05"],
      ["2026-08-20T00:00:00.000Z", "2026-08-27T00:00:00.000Z"],
    ]) {
      const response = await POST(coverage(from, until), { params: Promise.resolve({ planId: PLAN_ID }) });
      expect(response.status).toBe(400);
    }

    expect(applyAssignment).not.toHaveBeenCalled();
  });

  it("still accepts a well-formed window, so the boundary is not refusing everything", async () => {
    const { store } = await inMemoryStoreWithSpy({ actorRole: "teamLead" });
    const claimed = await store.applyAssignment(
      { planId: planId(PLAN_ID), action: { type: "claim", actorId: demoActorForRole("teamLead").id } },
      { actor: demoActorForRole("teamLead"), idempotencyKey: idempotencyKey("cover-claim") },
    );
    if (!claimed.ok) throw new Error(`seed claim refused: ${claimed.reason}`);

    const { POST } = await import("@/app/api/caring-contacts/assignments/[planId]/route");
    const response = await POST(coverage("2026-03-03", "2026-03-10"), context);

    expect(response.status).toBe(200);
    expect(JSON.parse(await response.text())).toMatchObject({
      value: { coveredBy: { from: "2026-03-03", until: "2026-03-10" } },
    });
  });
});

describe("the plan route cancels a draft plan that never started", () => {
  const DRAFT_ID = "SYN-PLAN-DRAFT";
  const context = { params: Promise.resolve({ planId: DRAFT_ID }) };

  async function withDraft(actorRole: CaringContactRole = "coordinator") {
    const spied = await inMemoryStoreWithSpy({ actorRole });
    const created = await spied.store.createPlan(
      {
        planId: planId(DRAFT_ID),
        referralId: referralId("SYN-REFERRAL-DRAFT"),
        patientId: patientId("SYN-PATIENT-DRAFT"),
        pathwayVersionId: pathwayVersionId("SYN-PATHWAY-001"),
        dischargeAt: DISCHARGE_AT,
        sendingPreference: "morning",
        patientDetail: PATIENT_DETAIL,
        assurances: PLAN_ASSURANCE_VALUES,
      },
      { actor: demoActorForRole("coordinator"), idempotencyKey: idempotencyKey("seed-draft") },
    );
    if (!created.ok) throw new Error(`seed draft refused: ${created.reason}`);
    return { ...spied, version: created.value.plan.version };
  }

  it("cancels a draft with a version check, and a replay of the same key changes nothing further", async () => {
    const { store, version } = await withDraft();
    const { POST } = await import("@/app/api/caring-contacts/plans/[planId]/route");
    const body = { action: "cancelDraft", expectedVersion: version, idempotencyKey: "cancel-draft-1" };

    const first = await POST(post(`/api/caring-contacts/plans/${DRAFT_ID}`, body), context);
    expect(first.status).toBe(200);
    const firstBody: unknown = await first.json();
    const replay = await POST(post(`/api/caring-contacts/plans/${DRAFT_ID}`, body), context);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(firstBody);

    const plan = await store.getPlan(planId(DRAFT_ID), { actor: demoActorForRole("coordinator") });
    expect(plan?.plan).toMatchObject({ state: "cancelled", version: version + 1 });
  });

  it("refuses a stale version with 409 and leaves the draft as it was", async () => {
    const { store, version } = await withDraft();
    const { POST } = await import("@/app/api/caring-contacts/plans/[planId]/route");
    const response = await POST(
      post(`/api/caring-contacts/plans/${DRAFT_ID}`, {
        action: "cancelDraft",
        expectedVersion: version + 5,
        idempotencyKey: "cancel-draft-stale",
      }),
      context,
    );
    expect(response.status).toBe(409);
    expect((await store.getPlan(planId(DRAFT_ID), { actor: demoActorForRole("coordinator") }))?.plan.state).toBe(
      "draft",
    );
  });

  it("refuses a plan that has started, by name, so it cannot be used to end a running plan", async () => {
    const { store } = await withDraft();
    const { POST } = await import("@/app/api/caring-contacts/plans/[planId]/route");
    const response = await POST(
      post("/api/caring-contacts/plans/SYN-PLAN-001", {
        action: "cancelDraft",
        expectedVersion: 2,
        idempotencyKey: "cancel-running",
      }),
      { params: Promise.resolve({ planId: "SYN-PLAN-001" }) },
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ refusal: "plan-not-draft" });
    expect((await store.getPlan(PLAN_ID, { actor: demoActorForRole("coordinator") }))?.plan.state).toBe("active");
  });

  it("refuses a role that may not create plans at the boundary", async () => {
    const { store, version } = await withDraft("auditor");
    const { POST } = await import("@/app/api/caring-contacts/plans/[planId]/route");
    const response = await POST(
      post(`/api/caring-contacts/plans/${DRAFT_ID}`, {
        action: "cancelDraft",
        expectedVersion: version,
        idempotencyKey: "cancel-auditor",
      }),
      context,
    );
    expect(response.status).toBe(403);
    expect((await store.getPlan(planId(DRAFT_ID), { actor: demoActorForRole("coordinator") }))?.plan.state).toBe(
      "draft",
    );
  });
});

describe("the plan route records an optional withdrawal reason", () => {
  const context = { params: Promise.resolve({ planId: "SYN-PLAN-001" }) };

  it("stores the reason given with a withdrawal and releases it on the episode", async () => {
    const { store } = await inMemoryStoreWithSpy();
    const { POST } = await import("@/app/api/caring-contacts/plans/[planId]/route");

    const response = await POST(
      post("/api/caring-contacts/plans/SYN-PLAN-001", {
        action: "withdraw",
        origin: "patient",
        reason: "Said the messages were hard to read.",
        expectedVersion: 2,
        idempotencyKey: "withdraw-with-reason",
      }),
      context,
    );

    expect(response.status).toBe(200);
    // Not in the answer the route gives: that is the plan record, which never carries the reason.
    expect(await response.text()).not.toContain("hard to read");
    const episode = await store.getEpisode(PLAN_ID, { actor: demoActorForRole("teamLead") });
    expect(episode?.withdrawalReason).toBe("Said the messages were hard to read.");
  });

  it("refuses an over-long reason by name, and the plan keeps running", async () => {
    const { store } = await inMemoryStoreWithSpy();
    const { POST } = await import("@/app/api/caring-contacts/plans/[planId]/route");

    const response = await POST(
      post("/api/caring-contacts/plans/SYN-PLAN-001", {
        action: "withdraw",
        origin: "patient",
        reason: "x".repeat(201),
        expectedVersion: 2,
        idempotencyKey: "withdraw-long-reason",
      }),
      context,
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ refusal: "withdrawal-reason-too-long" });
    expect((await store.getPlan(PLAN_ID, { actor: demoActorForRole("coordinator") }))?.plan.state).toBe("active");
  });
});
