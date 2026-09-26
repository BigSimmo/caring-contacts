// tests/caring-contacts-contact-route.test.ts
//
// Phase 2B Task 14 -- the HTTP boundary over a within-day contact move.
//
// What is asserted here is the BOUNDARY's behaviour, not the move rule: that the write lands, that
// each of the three refusals a coordinator can actually reach comes back under the domain's own
// name and the right status, that a role without the capability is refused AND recorded, and -- the
// clause the standing discipline says nobody writes -- that after each refusal the stored contact is
// byte-identical to what it was before. The move rule itself is `moveContactWithinDay`'s, and is
// pinned in the domain suite and in the shared repository contract.
//
// The store and the demo-role cookie are both replaced, exactly as
// `tests/caring-contacts-schedule-route.test.ts` does: `caringContactsStore()` is memoised
// process-wide, so a test using the real one would share a single workspace across every case.
import { NextRequest } from "next/server";
import { PLAN_ASSURANCE_VALUES } from "@/lib/caring-contacts/assurances";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ store: { current: null as unknown } }));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: (name: string) => mockCookies[name] })),
}));

vi.mock("@/lib/caring-contacts-server/store", () => ({
  caringContactsStore: async () => mocks.store.current,
}));

import { CARING_CONTACTS_ROLE_COOKIE, demoActorForRole } from "@/lib/caring-contacts-server/session";
import type { AccessRecord } from "@/lib/caring-contacts/access-audit";
import { awstCalendarDay, fixedClock, toAwstParts } from "@/lib/caring-contacts/clock";
import { idempotencyKey, pathwayVersionId, patientId, planId, referralId } from "@/lib/caring-contacts/ids";
import { createInMemoryRepository } from "@/lib/caring-contacts/in-memory-repository";
import type { CaringContactRepository, StoredContact } from "@/lib/caring-contacts/repository";

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

type Seeded = { store: CaringContactRepository; recorded: () => AccessRecord[] };

async function seed(role = "coordinator"): Promise<Seeded> {
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

  mocks.store.current = store;
  return { store, recorded: () => records };
}

/** The one contact on the first-contact day, read back out of the store. */
async function contactUnderTest(store: CaringContactRepository): Promise<StoredContact> {
  const record = await store.getPlan(PLAN_ID, { actor: demoActorForRole("coordinator") });
  if (record === null) throw new Error("the seeded plan is not readable");
  const found = record.contacts.filter((stored) => awstCalendarDay(stored.planned.sendAt) === FIRST_CONTACT_DAY);
  if (found.length !== 1) throw new Error(`expected one contact on ${FIRST_CONTACT_DAY}, found ${found.length}`);
  return found[0];
}

/**
 * Everything about the stored contact a move can change, as one comparable value.
 *
 * A whole-record comparison rather than one field. "The record is unchanged" is the claim, and a
 * check that read only `sendAt` would pass a write that advanced the version, changed the calendar
 * day, or replaced the cadence label.
 */
function stateOf(stored: StoredContact): string {
  return JSON.stringify({
    sendAt: stored.planned.sendAt.toISOString(),
    calendarDay: stored.planned.calendarDay,
    cadenceLabel: stored.planned.cadenceLabel,
    messageType: stored.planned.messageType,
    version: stored.contact.version,
    state: stored.contact.state,
  });
}

function post(plan: string, contact: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/caring-contacts/plans/${plan}/contacts/${contact}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function callPost(plan: string, contact: string, body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/caring-contacts/plans/[planId]/contacts/[contactId]/route");
  return POST(post(plan, contact, body), { params: Promise.resolve({ planId: plan, contactId: contact }) });
}

function moveBody(overrides: Record<string, unknown> = {}) {
  return {
    action: "moveWithinDay",
    toHour: 11,
    toMinute: 30,
    expectedContactVersion: 1,
    idempotencyKey: "CONTACT-MOVE-aaaa",
    ...overrides,
  };
}

beforeEach(() => {
  mockCookies = {};
  mocks.store.current = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/caring-contacts/plans/[planId]/contacts/[contactId]", () => {
  it("moves the contact to the time asked for, on the day it was already on", async () => {
    const { store } = await seed();
    const before = await contactUnderTest(store);

    const response = await callPost(PLAN_ID, before.contact.id, moveBody({ expectedContactVersion: 1 }));
    expect(response.status).toBe(200);

    // THE BODY CARRIES THE UPDATED CONTACT, and the screen depends on it: a control that has just
    // moved a contact reads the new version off this answer so a SECOND move from the same screen
    // does not go out carrying the version the first one consumed. `{ value: null }` here would make
    // every second move a refusal, and the DOM suite's mirror of this route did exactly that until
    // a two-consecutive-moves case caught it.
    const body = (await response.json()) as { value?: { contact?: { version?: number } } };
    expect(body.value?.contact?.version).toBe(2);

    const after = await contactUnderTest(store);
    expect(toAwstParts(after.planned.sendAt)).toMatchObject({ hour: 11, minute: 30 });
    // The day is unchanged and the version advanced: a move within the day, and one write.
    expect(awstCalendarDay(after.planned.sendAt)).toBe(FIRST_CONTACT_DAY);
    expect(after.contact.version).toBe(before.contact.version + 1);
    // The POSITIVE CONTROL for every "the record is unchanged" assertion below: the same comparison,
    // on the same fixture, going the other way. Without it those assertions could pass on a store
    // that never changes anything at all.
    expect(stateOf(after)).not.toBe(stateOf(before));
  });

  it("refuses a time outside the approved window by the domain's own name, and changes nothing", async () => {
    const { store } = await seed();
    const before = await contactUnderTest(store);

    // 18:00 AWST. The approved window's latest hour is EXCLUSIVE, so this is the first hour outside
    // it -- which is the boundary the wording on the screen is written from.
    const response = await callPost(PLAN_ID, before.contact.id, moveBody({ toHour: 18, toMinute: 0 }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ refusal: "contact-move-outside-approved-window" });

    expect(stateOf(await contactUnderTest(store))).toBe(stateOf(before));
  });

  it("accepts the last minute the window does admit", async () => {
    // The other side of the same boundary, so the case above cannot pass by refusing everything.
    const { store } = await seed();
    const before = await contactUnderTest(store);

    const response = await callPost(PLAN_ID, before.contact.id, moveBody({ toHour: 17, toMinute: 59 }));
    expect(response.status).toBe(200);
    expect(toAwstParts((await contactUnderTest(store)).planned.sendAt)).toMatchObject({ hour: 17, minute: 59 });
  });

  it("refuses a version somebody else has moved past, and leaves their move standing", async () => {
    const { store } = await seed();
    const before = await contactUnderTest(store);

    const theirs = await callPost(PLAN_ID, before.contact.id, moveBody({ toHour: 15, toMinute: 0 }));
    expect(theirs.status).toBe(200);
    const afterTheirs = await contactUnderTest(store);

    // The same version the first caller sent -- which is what a second coordinator's screen would
    // still be holding, having rendered before the first move landed.
    const ours = await callPost(
      PLAN_ID,
      before.contact.id,
      moveBody({
        toHour: 11,
        toMinute: 30,
        expectedContactVersion: before.contact.version,
        idempotencyKey: "CONTACT-MOVE-bbbb",
      }),
    );
    expect(ours.status).toBe(409);
    expect(await response(ours)).toEqual({ refusal: "stale-version" });

    // Not merely "refused": the other coordinator's move is still the one on the record.
    expect(stateOf(await contactUnderTest(store))).toBe(stateOf(afterTheirs));
  });

  it("refuses a role that is not granted the move, records the attempt, and changes nothing", async () => {
    const { store, recorded } = await seed("auditor");
    const before = await contactUnderTest(store);
    const trailBefore = recorded().length;

    const answer = await callPost(PLAN_ID, before.contact.id, moveBody());
    expect(answer.status).toBe(403);
    expect(await response(answer)).toEqual({ refusal: "action-not-granted" });

    // A write refused at the boundary never reaches the store, so `runWrite` never audits it -- the
    // attempt would leave no trace at all if `writeHandler` did not record it here.
    expect(recorded().slice(trailBefore)).toEqual([
      expect.objectContaining({ kind: "mutation", objectType: "contact", outcome: "denied" }),
    ]);
    expect(stateOf(await contactUnderTest(store))).toBe(stateOf(before));
  });

  it("answers a contact this plan does not hold as not found", async () => {
    const { store } = await seed();
    const before = await contactUnderTest(store);

    const answer = await callPost(PLAN_ID, "SYN-CONTACT-ABSENT", moveBody());
    expect(answer.status).toBe(404);
    expect(await response(answer)).toEqual({ refusal: "not-found" });

    expect(stateOf(await contactUnderTest(store))).toBe(stateOf(before));
  });

  it("refuses a body that does not parse, and a path segment that is not identifier-shaped", async () => {
    const { store } = await seed();
    const before = await contactUnderTest(store);

    // A date change is not offered by this route at all, so its shape does not parse. That is the
    // point: an approval nobody gave must never be defaulted in.
    const dateChange = await callPost(PLAN_ID, before.contact.id, {
      action: "changeDate",
      toCalendarDay: "2026-09-02",
      reason: "ward asked",
      idempotencyKey: "CONTACT-MOVE-cccc",
    });
    expect(dateChange.status).toBe(400);
    expect(await response(dateChange)).toEqual({ refusal: "invalid-request" });

    // An EXTRA field, which `.strict()` refuses. A schema that quietly dropped it would accept a
    // request carrying more than this route acts on, and the caller would never learn that half of
    // what it sent was ignored.
    const extraField = await callPost(PLAN_ID, before.contact.id, { ...moveBody(), toSecond: 30 });
    expect(extraField.status).toBe(400);
    expect(await response(extraField)).toEqual({ refusal: "invalid-request" });

    const freeText = await callPost(PLAN_ID, "not an identifier", moveBody());
    expect(freeText.status).toBe(400);

    expect(stateOf(await contactUnderTest(store))).toBe(stateOf(before));
  });
});

/** The JSON body of a response, so each case reads as one assertion rather than two statements. */
async function response(answer: Response): Promise<unknown> {
  return answer.json();
}
