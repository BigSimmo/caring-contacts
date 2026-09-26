// tests/caring-contacts-schedule-route.test.ts
//
// Phase 2B Task 12 -- the HTTP boundary over the schedule read.
//
// What is asserted here is the boundary's own behaviour, not the grouping: that the read is
// recorded on the access trail under its own object type, that a team holding no plans gets a
// schedule rather than a 404, that a range the domain will not answer is refused as a bad request
// rather than as a missing resource, and that nothing patient-identifying reaches the wire. The
// grouping itself is pinned in `tests/caring-contacts-schedule-view.test.ts`.
//
// The store and the demo-role cookie are both replaced, exactly as
// `tests/caring-contacts-api-handler.test.ts` does: `caringContactsStore()` is memoised
// process-wide, so a test using the real one would share a single workspace across every case.
import { readFileSync } from "node:fs";
import { PLAN_ASSURANCE_VALUES } from "@/lib/caring-contacts/assurances";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

const mocks = vi.hoisted(() => ({ store: { current: null as unknown } }));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: (name: string) => mockCookies[name] })),
}));

vi.mock("@/lib/caring-contacts-server/store", () => ({
  caringContactsStore: async () => mocks.store.current,
}));

import { CARING_CONTACTS_ROLE_COOKIE, demoActorForRole } from "@/lib/caring-contacts-server/session";
import type { AccessRecord } from "@/lib/caring-contacts/access-audit";
import { awstCalendarDay, fixedClock } from "@/lib/caring-contacts/clock";
import { idempotencyKey, pathwayVersionId, patientId, planId, referralId } from "@/lib/caring-contacts/ids";
import { createInMemoryRepository } from "@/lib/caring-contacts/in-memory-repository";
import type { CaringContactRepository } from "@/lib/caring-contacts/repository";
import { SCHEDULE_RANGE_MAX_DAYS, type ScheduleRangeView } from "@/lib/caring-contacts/schedule-view";

let mockCookies: Record<string, { value: string } | undefined> = {};

const PLAN_ID = planId("SYN-PLAN-001");

/** 2026-08-30 10:00 AWST discharge, so the default first contact lands on the last day of August. */
const DISCHARGE_AT = new Date("2026-08-30T02:00:00.000Z");
const NOW = "2026-08-30T03:00:00.000Z";
const FIRST_CONTACT_DAY = "2026-08-31";

const PATIENT_DETAIL = {
  patientName: "Rowan Mira Delacroix",
  // Required since Task P. An ordinary episode holds one; these cases are not about it.
  preferredName: "Rowan",
  patientMobileNumber: "+61 491 570 156",
  patientIdentifiers: ["UR-00219384"],
  culturalIdentity: null,
};

type Spied = { store: CaringContactRepository; recorded: () => AccessRecord[] };

async function inMemoryStoreWithSpy(options: { seedPlan?: boolean } = {}): Promise<Spied> {
  mockCookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: "coordinator" } };

  const repository = createInMemoryRepository(fixedClock(NOW));
  const records: AccessRecord[] = [];
  const store: CaringContactRepository = {
    ...repository,
    async recordAccess(record: AccessRecord) {
      // The real store first, then the spy, so `records` means "entered the trail".
      await repository.recordAccess(record);
      records.push(record);
    },
  };

  if (options.seedPlan !== false) {
    const coordinator = demoActorForRole("coordinator");
    const created = await store.createPlan(
      {
        planId: PLAN_ID,
        referralId: referralId("SYN-REFERRAL-001"),
        patientId: patientId("SYN-PATIENT-001"),
        pathwayVersionId: pathwayVersionId("SYN-PATHWAY-001"),
        dischargeAt: DISCHARGE_AT,
        sendingPreference: "morning",
        // Required since Task 9b. The derived both-confirmed set rather than a literal, so this
        // fixture cannot drift from the source if an assurance is ever added.
        assurances: PLAN_ASSURANCE_VALUES,
        patientDetail: PATIENT_DETAIL,
      },
      { actor: coordinator, idempotencyKey: idempotencyKey("seed-create") },
    );
    if (!created.ok) throw new Error(`seed createPlan refused: ${created.reason}`);
    const activated = await store.activatePlan(
      { planId: PLAN_ID, expectedVersion: created.value.plan.version },
      { actor: coordinator, idempotencyKey: idempotencyKey("seed-activate") },
    );
    if (!activated.ok) throw new Error(`seed activatePlan refused: ${activated.reason}`);
  }

  mocks.store.current = store;
  return { store, recorded: () => records };
}

function get(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/caring-contacts/schedule${query}`);
}

async function callGet(query: string): Promise<Response> {
  const { GET } = await import("@/app/api/caring-contacts/schedule/route");
  return GET(get(query));
}

beforeEach(() => {
  mockCookies = {};
  mocks.store.current = null;
  // The route flags a still-scheduled contact past its send time as overdue against the server
  // clock, so the wall clock is pinned to the fixture's own instant. Only `Date` is faked.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/caring-contacts/schedule", () => {
  it("returns the day's schedule and records the read under its own object type", async () => {
    const { recorded } = await inMemoryStoreWithSpy();

    const response = await callGet(`?from=${FIRST_CONTACT_DAY}`);
    expect(response.status).toBe(200);
    const view = (await response.json()) as ScheduleRangeView;
    expect(view.days).toHaveLength(1);
    expect(view.days[0].disposition).toBe("contactsDue");

    // Its OWN member, not the caseload's `plan`, and the days it read as the object it read.
    expect(recorded()).toEqual([
      expect.objectContaining({
        kind: "search",
        objectType: "contactSchedule",
        objectId: `${FIRST_CONTACT_DAY}:${FIRST_CONTACT_DAY}`,
        outcome: "allowed",
      }),
    ]);
  });

  it("answers a team holding no plans with a schedule rather than a not-found", async () => {
    // The surviving half of Task 2 (Ruling 84), one layer along: `auditedRead` maps a null release
    // to `denied` and `readHandler` turns that into 404, so a read that answered "nothing" with
    // null would tell a clinician their team's schedule does not exist. Every day of the range is
    // present, and each says which kind of empty it is.
    const { recorded } = await inMemoryStoreWithSpy({ seedPlan: false });

    const response = await callGet(`?from=${FIRST_CONTACT_DAY}`);
    expect(response.status).toBe(200);
    const view = (await response.json()) as ScheduleRangeView;
    expect(view.days.map((day) => day.disposition)).toEqual(["noContactsPlanned"]);
    expect(recorded().map((record) => record.outcome)).toEqual(["allowed"]);
  });

  it("defaults to today in AWST when no day is asked for", async () => {
    await inMemoryStoreWithSpy();
    const today = awstCalendarDay(new Date());

    const view = (await (await callGet("")).json()) as ScheduleRangeView;
    expect(view.fromCalendarDay).toBe(today);
    expect(view.toCalendarDay).toBe(today);
  });

  it("reads a range, and every day of it comes back in order", async () => {
    await inMemoryStoreWithSpy();
    const view = (await (await callGet(`?from=${FIRST_CONTACT_DAY}&to=2026-09-06`)).json()) as ScheduleRangeView;
    expect(view.days.map((day) => day.calendarDay)).toEqual([
      FIRST_CONTACT_DAY,
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
    ]);
  });

  it("refuses a malformed, inverted or over-long range as a bad request, never as a missing schedule", async () => {
    await inMemoryStoreWithSpy();
    for (const query of [
      "?from=2026-02-30",
      "?from=yesterday",
      `?from=2026-09-02&to=2026-09-01`,
      `?from=2026-01-01&to=2026-12-31`,
      "?from=2026-09-01&week=1",
    ]) {
      const response = await callGet(query);
      expect([query, response.status]).toEqual([query, 400]);
      expect(await response.json()).toEqual({ refusal: "invalid-request" });
    }
  });

  it("accepts a range exactly as long as the published maximum", async () => {
    await inMemoryStoreWithSpy();
    const response = await callGet("?from=2026-01-01&to=2026-01-31");
    expect(response.status).toBe(200);
    const view = (await response.json()) as ScheduleRangeView;
    expect(view.days).toHaveLength(SCHEDULE_RANGE_MAX_DAYS);
  });

  it("records the read but releases nothing when the access trail cannot take the event", async () => {
    const { store } = await inMemoryStoreWithSpy();
    vi.spyOn(store, "recordAccess").mockRejectedValue(new Error("trail unavailable"));

    const response = await callGet(`?from=${FIRST_CONTACT_DAY}`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ refusal: "access-audit-unavailable" });
  });

  it("puts no patient name, mobile number or identifier on the wire", async () => {
    await inMemoryStoreWithSpy();
    const body = await (await callGet(`?from=${FIRST_CONTACT_DAY}`)).text();
    expect(body).not.toContain(PATIENT_DETAIL.patientName);
    expect(body).not.toContain("491 570 156");
    expect(body).not.toContain(PATIENT_DETAIL.patientIdentifiers[0]);
    // The synthetic patient id is what a schedule row is keyed by, and it is not identity.
    expect(body).toContain("SYN-PATIENT-001");
  });

  it("fails closed in production before a role-only demo session can read a schedule", async () => {
    await inMemoryStoreWithSpy();
    vi.stubEnv("NODE_ENV", "production");

    const response = await callGet(`?from=${FIRST_CONTACT_DAY}`);
    expect(response.status).toBe(404);
  });
});

describe("the access trail's object-type filter", () => {
  /**
   * `AccessedObjectType`'s members, read as TEXT.
   *
   * The union carries doc comments between its members, so the comments are stripped before the
   * quoted names are collected. Every step throws rather than returning nothing: a rename this
   * parser stops understanding must fail here rather than quietly comparing two empty sets, which
   * is the failure mode the check itself exists to close.
   */
  function membersOf(relativePath: string, startMarker: string, endMarker: string): string[] {
    const source = readFileSync(path.join(process.cwd(), relativePath), "utf8");
    const start = source.indexOf(startMarker);
    if (start === -1) throw new Error(`${relativePath}: no ${startMarker} — update this parser.`);
    const end = source.indexOf(endMarker, start + startMarker.length);
    if (end === -1) throw new Error(`${relativePath}: no ${endMarker} after ${startMarker} — update this parser.`);
    const body = source.slice(start + startMarker.length, end).replace(/\/\*[\s\S]*?\*\//g, "");
    const members = [...body.matchAll(/"([A-Za-z]+)"/g)].map((match) => match[1]);
    if (members.length === 0) throw new Error(`${relativePath}: parsed no members — update this parser.`);
    return members;
  }

  it("offers every object type an access can be recorded under", () => {
    // The route's `z.enum` is a hand-copy of the union, and nothing in the build compares them. A
    // member added to one and not the other is an access the trail can never be filtered to --
    // which is exactly what Ruling 46 added members to prevent, so the copy has to be checked.
    const union = membersOf("src/lib/caring-contacts/access-audit.ts", "export type AccessedObjectType =", ";");
    const enumerated = membersOf(
      "src/app/api/caring-contacts/access-trail/route.ts",
      "objectType: z\n      .enum([",
      "])",
    );
    expect(enumerated).toEqual(union);
    expect(union).toContain("contactSchedule");
  });
});
