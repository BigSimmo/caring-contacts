// tests/caring-contacts-team-workload.test.ts
//
// Phase 2B Task 17 -- the team read, rolled up from `listPlans` and `getAssignment`.
//
// Written against the SEALED DOMAIN rather than the route, for the same reason
// `tests/caring-contacts-schedule-view.test.ts` is: everything asserted here is arithmetic over
// values the stores already produced. The HTTP boundary that publishes it is pinned separately in
// `tests/caring-contacts-team-route.test.ts`.
//
// The fixtures go through `createInMemoryRepository` rather than assembling `PlanRecord`s and
// `PlanAssignment`s by hand, so every plan and every claim under test is one the store could
// actually hold: the ownership comes from the real `applyAssignment` write path, and the contact
// states come from the real dispatch writes.
//
// SPEC 4.2, AND IT IS WHAT MOST OF THESE CASES ARE ABOUT: this read is operational and never ranks
// clinicians. The order case below is the load-bearing one -- it proves the row order is the actor
// id and not the amount of work, on a fixture built so the two orders disagree.
import { beforeEach, describe, expect, it } from "vitest";

// THE ONE IMPORT IN THIS FILE THAT REACHES OUT OF THE SEALED DOMAIN, and it is the point of the
// anchoring cases below rather than a convenience. `dischargeInstantFor` is the only surface in the
// tree that writes a `dischargeAt`, and the seam between the convention it writes and the instant
// arithmetic this read performs is the seam no fixture in this branch crossed.
import { dischargeInstantFor } from "@/components/caring-contacts/workspace/plan-wizard/plan-activation";
import { PLAN_ASSURANCE_VALUES } from "@/lib/caring-contacts/assurances";
import { UNCLAIMED_ESCALATION_MINUTES } from "@/lib/caring-contacts/assignment";
import { awstCalendarDay } from "@/lib/caring-contacts/clock";
import {
  actorId,
  idempotencyKey,
  pathwayVersionId,
  patientId,
  planId,
  referralId,
  teamId,
  type ActorId,
  type PlanId,
} from "@/lib/caring-contacts/ids";
import { createInMemoryRepository } from "@/lib/caring-contacts/in-memory-repository";
import type { ContactState, PlanState } from "@/lib/caring-contacts/model";
import type { Actor, SystemActor } from "@/lib/caring-contacts/permissions";
import type { CaringContactRepository, PlanRecord, StoredContact } from "@/lib/caring-contacts/repository";
import {
  buildTeamWorkload,
  type CoordinatorWorkload,
  type PlanOwnership,
  type TeamWorkloadView,
  unclaimedPlanQueue,
} from "@/lib/caring-contacts/team-workload";

const TEAM = teamId("TEAM-NORTH");
const COORDINATOR: Actor = { id: actorId("ACTOR-1"), teamId: TEAM, roles: ["coordinator"] };
const TEAM_LEAD: Actor = { id: actorId("ACTOR-LEAD"), teamId: TEAM, roles: ["teamLead"] };
const DISPATCHER: SystemActor = { id: actorId("SYSTEM-DISPATCHER"), teamId: TEAM, systemRole: "contactDispatcher" };

const AVA = actorId("ACTOR-AVA");
const BLAKE = actorId("ACTOR-BLAKE");
const CASS = actorId("ACTOR-CASS");

/** 2026-08-30 10:00 AWST discharge, so the default first contact lands on the last day of August. */
const DISCHARGE_AT = new Date("2026-08-30T02:00:00.000Z");
/**
 * When a seeded plan is CREATED, which is the instant it became free for a coordinator to take and
 * therefore the anchor every unclaimed age below is measured from. 10:00 AWST.
 *
 * It is a separate constant from the discharge deliberately. The two used to be conflated -- the
 * escalation was anchored on the recorded discharge, which is a display convention rather than an
 * observed instant -- and a fixture that sets them to one value cannot tell a read measuring the
 * right thing from a read measuring the wrong one.
 */
const CREATED_AT = "2026-08-30T02:00:00.000Z";
/** One hour after a plan is created -- exactly `UNCLAIMED_ESCALATION_MINUTES` later. 11:00 AWST. */
const NOW = "2026-08-30T03:00:00.000Z";
const AS_AT = new Date(NOW);

/**
 * The store's clock, which the fixtures MOVE. `fixedClock` cannot express what these cases are
 * about: a plan is created at one instant and the roster is read at another, and the distance
 * between the two is the queue age under test.
 */
let storeInstant = new Date(CREATED_AT);
const FIRST_CONTACT_DAY = "2026-08-31";

let seeded = 0;

// Reset per case so a fixture can name its own plan and patient ids, which two of the privacy
// assertions below quote literally.
beforeEach(() => {
  seeded = 0;
});

type SeedOptions = {
  dischargeAt?: Date;
  /** When the plan is created, and so when it became claimable. Defaults to `CREATED_AT`. */
  createdAt?: string;
  planState?: Extract<PlanState, "draft" | "active" | "paused" | "withdrawn">;
  /** Who claims it. Left unclaimed when absent. */
  owner?: ActorId;
};

function newStore(): CaringContactRepository {
  storeInstant = new Date(CREATED_AT);
  return createInMemoryRepository({ now: () => new Date(storeInstant.getTime()) });
}

/** Creates one plan through the real write path, leaves it in the requested state, and claims it. */
async function seedPlan(store: CaringContactRepository, options: SeedOptions = {}): Promise<PlanId> {
  seeded += 1;
  storeInstant = new Date(options.createdAt ?? CREATED_AT);
  const suffix = String(seeded).padStart(3, "0");
  const id = planId(`SYN-PLAN-${suffix}`);
  const created = await store.createPlan(
    {
      planId: id,
      referralId: referralId(`SYN-REFERRAL-${suffix}`),
      patientId: patientId(`SYN-PATIENT-${suffix}`),
      pathwayVersionId: pathwayVersionId("SYN-PATHWAY-001"),
      dischargeAt: options.dischargeAt ?? DISCHARGE_AT,
      sendingPreference: "morning",
      assurances: PLAN_ASSURANCE_VALUES,
      patientDetail: {
        patientName: `Synthetic Patient ${suffix}`,
        preferredName: "Synthetic",
        patientMobileNumber: "+61 491 570 156",
        patientIdentifiers: [`UR-${suffix}`],
        culturalIdentity: null,
      },
    },
    { actor: COORDINATOR, idempotencyKey: idempotencyKey(`seed-create-${suffix}`) },
  );
  if (!created.ok) throw new Error(`seed createPlan refused: ${created.reason}`);

  const target = options.planState ?? "active";
  let version = created.value.plan.version;
  if (target !== "draft") {
    const activated = await store.activatePlan(
      { planId: id, expectedVersion: version },
      { actor: COORDINATOR, idempotencyKey: idempotencyKey(`seed-activate-${suffix}`) },
    );
    if (!activated.ok) throw new Error(`seed activatePlan refused: ${activated.reason}`);
    version = activated.value.plan.version;
  }
  if (target === "paused") {
    const paused = await store.pausePlan(
      { planId: id, expectedVersion: version },
      { actor: COORDINATOR, idempotencyKey: idempotencyKey(`seed-pause-${suffix}`) },
    );
    if (!paused.ok) throw new Error(`seed pausePlan refused: ${paused.reason}`);
  }
  if (target === "withdrawn") {
    const withdrawn = await store.withdrawPlan(
      { planId: id, expectedVersion: version, origin: "patient" },
      { actor: COORDINATOR, idempotencyKey: idempotencyKey(`seed-withdraw-${suffix}`) },
    );
    if (!withdrawn.ok) throw new Error(`seed withdrawPlan refused: ${withdrawn.reason}`);
  }

  if (options.owner !== undefined) await claim(store, id, options.owner);
  return id;
}

/**
 * A claim is made BY the person taking the work -- the store refuses one that names anybody else,
 * so the acting actor here is the owner rather than a fixed seeding coordinator.
 */
async function claim(store: CaringContactRepository, id: PlanId, owner: ActorId): Promise<void> {
  const actor: Actor = { id: owner, teamId: TEAM, roles: ["coordinator"] };
  const claimed = await store.applyAssignment(
    { planId: id, action: { type: "claim", actorId: owner } },
    { actor, idempotencyKey: idempotencyKey(`seed-claim-${id}`) },
  );
  if (!claimed.ok) throw new Error(`seed claim refused: ${claimed.reason}`);
}

async function cover(
  store: CaringContactRepository,
  id: PlanId,
  coverer: ActorId,
  from: string,
  until: string,
): Promise<void> {
  const covered = await store.applyAssignment(
    { planId: id, action: { type: "startCoverage", actorId: coverer, from, until } },
    { actor: TEAM_LEAD, idempotencyKey: idempotencyKey(`seed-cover-${id}`) },
  );
  if (!covered.ok) throw new Error(`seed startCoverage refused: ${covered.reason}`);
}

/** The pair the roll-up takes, read the way the route reads it. */
async function ownershipOf(store: CaringContactRepository): Promise<PlanOwnership[]> {
  const records = await store.listPlans({ actor: COORDINATOR });
  return Promise.all(
    records.map(async (record) => ({
      record,
      assignment: await store.getAssignment(record.plan.id, { actor: COORDINATOR }),
    })),
  );
}

async function viewOf(store: CaringContactRepository, asAt: Date = AS_AT): Promise<TeamWorkloadView> {
  return buildTeamWorkload(await ownershipOf(store), asAt);
}

function rowFor(view: TeamWorkloadView, id: ActorId): CoordinatorWorkload {
  const found = view.coordinators.find((row) => row.actorId === id);
  if (!found) throw new Error(`no roster row for ${id}; rows: ${view.coordinators.map((row) => row.actorId)}`);
  return found;
}

/** The contact a plan holds for a given AWST calendar day, by the instant it actually sends at. */
function contactOn(record: PlanRecord, calendarDay: string): StoredContact {
  const found = record.contacts.filter((stored) => awstCalendarDay(stored.planned.sendAt) === calendarDay);
  if (found.length !== 1) throw new Error(`expected one contact on ${calendarDay}, found ${found.length}`);
  return found[0];
}

/** Drives one contact through the real dispatch path to the state named. */
async function driveContactTo(
  store: CaringContactRepository,
  id: PlanId,
  stored: StoredContact,
  state: Extract<ContactState, "delivered" | "statusUnavailable" | "missed">,
): Promise<void> {
  const key = (step: string) => idempotencyKey(`${stored.contact.id}-${step}`);
  if (state === "missed") {
    const missed = await store.recordContactMissed(
      { planId: id, contactId: stored.contact.id, expectedContactVersion: stored.contact.version },
      { actor: DISPATCHER, idempotencyKey: key("missed") },
    );
    if (!missed.ok) throw new Error(`recordContactMissed refused: ${missed.reason}`);
    return;
  }
  const started = await store.startContactDispatch(
    { planId: id, contactId: stored.contact.id, expectedContactVersion: stored.contact.version },
    { actor: DISPATCHER, idempotencyKey: key("start") },
  );
  if (!started.ok) throw new Error(`startContactDispatch refused: ${started.reason}`);
  const sent = await store.recordContactSent(
    { planId: id, contactId: stored.contact.id, expectedContactVersion: started.value.contact.version },
    { actor: DISPATCHER, idempotencyKey: key("sent") },
  );
  if (!sent.ok) throw new Error(`recordContactSent refused: ${sent.reason}`);
  const status = await store.recordContactProviderStatus(
    { planId: id, contactId: stored.contact.id, expectedContactVersion: sent.value.contact.version, status: state },
    { actor: DISPATCHER, idempotencyKey: key("status") },
  );
  if (!status.ok) throw new Error(`recordContactProviderStatus refused: ${status.reason}`);
}

describe("the team read names where work sits", () => {
  it("puts a plan's named owner on the roster and takes it out of the unclaimed group", async () => {
    const store = newStore();
    await seedPlan(store, { owner: AVA });

    const view = await viewOf(store);

    expect(view.coordinators.map((row) => row.actorId)).toEqual([AVA]);
    expect(rowFor(view, AVA).activePlans).toBe(1);
    expect(view.unclaimed.plans).toBe(0);
  });

  it("counts a plan nobody has claimed as unclaimed work, and gives it no roster row", async () => {
    const store = newStore();
    await seedPlan(store);

    const view = await viewOf(store);

    expect(view.coordinators).toEqual([]);
    expect(view.unclaimed.plans).toBe(1);
  });

  it("counts the unclaimed plans that are running, so the team's caseload does not lose them", async () => {
    const store = newStore();
    await seedPlan(store);
    await seedPlan(store);
    await seedPlan(store, { planState: "paused" });
    await seedPlan(store, { planState: "draft" });
    await seedPlan(store, { planState: "withdrawn" });
    await seedPlan(store, { owner: AVA });

    const view = await viewOf(store);

    // Four unclaimed plans are work (the withdrawn one has ended), and two of them are running.
    expect(view.unclaimed.plans).toBe(4);
    expect(view.unclaimed.activePlans).toBe(2);
    // The owned running plan stays on its owner's row and is not counted twice.
    expect(rowFor(view, AVA).activePlans).toBe(1);
  });

  it("reports no running unclaimed plans when nothing is unclaimed", async () => {
    const store = newStore();
    await seedPlan(store, { owner: AVA });

    expect((await viewOf(store)).unclaimed.activePlans).toBe(0);
  });

  it("treats an unreadable assignment as unclaimed rather than dropping the plan", async () => {
    const store = newStore();
    await seedPlan(store, { owner: AVA });
    const records = await store.listPlans({ actor: COORDINATOR });

    // The store answers every plan `listPlans` released, so `null` is only reachable when the plan
    // is removed between the two reads. Passed here directly because the conservative direction --
    // surface it as unclaimed work rather than lose it -- is the behaviour, not the shape.
    const view = buildTeamWorkload(
      records.map((record) => ({ record, assignment: null })),
      AS_AT,
    );

    expect(view.unclaimed.plans).toBe(1);
    expect(view.coordinators).toEqual([]);
  });
});

describe("the roster order is the actor id and never the amount of work (spec 4.2)", () => {
  it("orders rows by actor id on a fixture whose work order is the reverse", async () => {
    const store = newStore();
    // Cass carries three, Blake two, Ava one -- so an order that followed the work would be
    // exactly the reverse of the order asserted below, and could not pass by coincidence.
    await seedPlan(store, { owner: AVA });
    await seedPlan(store, { owner: BLAKE });
    await seedPlan(store, { owner: BLAKE });
    await seedPlan(store, { owner: CASS });
    await seedPlan(store, { owner: CASS });
    await seedPlan(store, { owner: CASS });

    const view = await viewOf(store);

    expect(view.coordinators.map((row) => row.actorId)).toEqual([AVA, BLAKE, CASS]);
    expect(view.coordinators.map((row) => row.activePlans)).toEqual([1, 2, 3]);
  });

  it("publishes no comparison between people -- no total to divide by, no rank, no share", async () => {
    const store = newStore();
    await seedPlan(store, { owner: AVA });
    await seedPlan(store, { owner: BLAKE });

    const view = await viewOf(store);

    // A positive control for the absence: the per-row work count IS published, so an emptied
    // read could not satisfy the four refusals below by having nothing in it at all.
    expect(rowFor(view, AVA).activePlans).toBe(1);
    const row = rowFor(view, AVA) as unknown as Record<string, unknown>;
    for (const forbidden of ["rank", "share", "percentile", "position"]) {
      expect(Object.keys(row)).not.toContain(forbidden);
    }
  });
});

describe("unclaimed work against the 60-minute escalation", () => {
  it("takes its threshold from the domain rather than restating the number", async () => {
    const store = newStore();
    const view = await viewOf(store);

    expect(view.thresholdMinutes).toBe(UNCLAIMED_ESCALATION_MINUTES);
  });

  it("escalates at the threshold and not one minute before it", async () => {
    const store = newStore();
    await seedPlan(store);

    const atThreshold = await viewOf(store, AS_AT);
    const oneMinuteEarlier = await viewOf(store, new Date(AS_AT.getTime() - 60_000));

    expect(atThreshold.unclaimed.oldestMinutesUnclaimed).toBe(UNCLAIMED_ESCALATION_MINUTES);
    expect(atThreshold.unclaimed.escalated).toBe(1);
    expect(atThreshold.unclaimed.state).toBe("escalated");
    expect(oneMinuteEarlier.unclaimed.oldestMinutesUnclaimed).toBe(UNCLAIMED_ESCALATION_MINUTES - 1);
    expect(oneMinuteEarlier.unclaimed.escalated).toBe(0);
    expect(oneMinuteEarlier.unclaimed.state).toBe("withinThreshold");
  });

  it("says what would end the escalation, and says nothing to end when there is none (spec 4.4)", async () => {
    const store = newStore();
    const empty = await viewOf(store);
    expect(empty.unclaimed.state).toBe("noUnclaimedWork");
    expect(empty.unclaimed.clearedBy).toBeNull();

    await seedPlan(store);
    const held = await viewOf(store);
    expect(held.unclaimed.clearedBy).toBe("aCoordinatorClaimsThePlan");
  });

  it("reports no oldest age when nothing is unclaimed, which is not an age of zero", async () => {
    const store = newStore();
    await seedPlan(store, { owner: AVA });

    const claimed = await viewOf(store);
    expect(claimed.unclaimed.oldestMinutesUnclaimed).toBeNull();

    // The positive control: the same measure over an unclaimed plan is a number, so the null above
    // is this read distinguishing the two cases rather than never producing an age at all.
    await seedPlan(store);
    expect((await viewOf(store)).unclaimed.oldestMinutesUnclaimed).toBe(UNCLAIMED_ESCALATION_MINUTES);
  });

  it("takes the oldest of several unclaimed plans, not the newest and not the last read", async () => {
    const store = newStore();
    await seedPlan(store, { createdAt: "2026-08-30T02:30:00.000Z" });
    await seedPlan(store, { createdAt: "2026-08-30T01:00:00.000Z" });
    await seedPlan(store, { createdAt: "2026-08-30T02:45:00.000Z" });

    const view = await viewOf(store);

    expect(view.unclaimed.plans).toBe(3);
    expect(view.unclaimed.oldestMinutesUnclaimed).toBe(120);
  });
});

/**
 * WHAT THE UNCLAIMED AGE IS ANCHORED ON, pinned as behaviour rather than left in a note.
 *
 * THE CASE THE GROUP 4 REVIEW REPRODUCED IS THE FIRST ONE BELOW, and until 2026-08-28 it failed.
 * The age was measured from `dischargeAt`, which is not an observed instant: the only surface that
 * writes one is the plan wizard, and `dischargeInstantFor` pins it to `DISCHARGE_WALL_CLOCK_HOUR`
 * -- midday -- on the AWST calendar day a coordinator typed. So a plan created at 08:00 on its own
 * discharge day and never claimed reported an age of ZERO at 09:00, at 10:00 and at 11:00, and
 * escalated only at 13:00 -- four hours late, on the escalation whose stated purpose is not to miss
 * a late one.
 *
 * WHY THESE CASES GO THROUGH THE WIZARD'S OWN FUNCTION. Every other fixture in this file builds a
 * discharge instant by hand, which is exactly why no test could have found the defect: the seam
 * between the wizard's midday convention and this read's instant arithmetic was crossed by no
 * fixture in the branch. These cross it, so the anchoring is met as a test by the next reader
 * rather than as a surprise -- and the midday discharge is now a value the age must IGNORE, which is
 * the stronger property of the two.
 */
describe("the unclaimed age is anchored on when the plan became free for a coordinator to take", () => {
  const DISCHARGE_DAY = "2026-08-30";

  /** The instant the wizard would store for that day, refusing to guess if it would not store one. */
  function wizardDischargeInstant(day: string): Date {
    const instant = dischargeInstantFor(day);
    if (instant === null) throw new Error(`the wizard writes no discharge instant for ${day}`);
    return instant;
  }

  it("reports an hour for a plan created at 08:00 and unclaimed at 09:00, and escalates there", async () => {
    const store = newStore();
    const dischargeAt = wizardDischargeInstant(DISCHARGE_DAY);
    // The positive control, and the reason this case is the seam rather than a model of it: the
    // wizard's instant really is midday AWST, which is 04:00 UTC -- three hours AFTER the plan below
    // is created and an hour after it is read. An age anchored on it could only be zero here.
    expect(dischargeAt.toISOString()).toBe("2026-08-30T04:00:00.000Z");

    // Created 08:00 AWST, read at 09:00 AWST. Unclaimed for exactly the escalation threshold.
    await seedPlan(store, { dischargeAt, createdAt: "2026-08-30T00:00:00.000Z" });
    const morning = await viewOf(store, new Date("2026-08-30T01:00:00.000Z"));

    expect(morning.unclaimed.oldestMinutesUnclaimed).toBe(UNCLAIMED_ESCALATION_MINUTES);
    expect(morning.unclaimed.escalated).toBe(1);
    expect(morning.unclaimed.state).toBe("escalated");
  });

  it("does not wait for the discharge anchor before it will escalate at all", async () => {
    const store = newStore();
    // Created 08:00 AWST on its discharge day, read at 11:00 AWST -- still an hour before the
    // midday anchor the old read counted from, and three times the threshold into the wait.
    await seedPlan(store, {
      dischargeAt: wizardDischargeInstant(DISCHARGE_DAY),
      createdAt: "2026-08-30T00:00:00.000Z",
    });

    const lateMorning = await viewOf(store, new Date("2026-08-30T03:00:00.000Z"));

    expect(lateMorning.unclaimed.oldestMinutesUnclaimed).toBe(180);
    expect(lateMorning.unclaimed.state).toBe("escalated");
  });

  it("ignores a discharge typed for a future day rather than reporting zero for it", async () => {
    const store = newStore();
    // `firstContactDayBounds` accepts tomorrow, so a plan can carry a discharge instant AHEAD of
    // now. The old anchor clamped that to zero, so such a plan could never escalate at all; the
    // wait is a fact about the plan's own age and is unaffected by it.
    await seedPlan(store, {
      dischargeAt: wizardDischargeInstant("2026-08-31"),
      createdAt: "2026-08-30T00:00:00.000Z",
    });

    const view = await viewOf(store, new Date("2026-08-30T01:00:00.000Z"));

    expect(view.unclaimed.oldestMinutesUnclaimed).toBe(UNCLAIMED_ESCALATION_MINUTES);
    expect(view.unclaimed.state).toBe("escalated");
  });
});

describe("a plan that is not running is held work, not active work", () => {
  it("names the hold rather than counting a paused plan as active", async () => {
    const store = newStore();
    await seedPlan(store, { planState: "paused", owner: AVA });

    const row = rowFor(await viewOf(store), AVA);

    expect(row.activePlans).toBe(0);
    expect(row.heldPlans).toEqual([{ hold: "planPaused", plans: 1 }]);
  });

  it("names a draft plan's hold as not started, distinctly from a pause", async () => {
    const store = newStore();
    await seedPlan(store, { planState: "draft", owner: AVA });

    expect(rowFor(await viewOf(store), AVA).heldPlans).toEqual([{ hold: "planNotStarted", plans: 1 }]);
  });

  it("drops an ended plan from every measure it was counted in while it was running", async () => {
    const store = newStore();
    const id = await seedPlan(store, { owner: AVA });

    // The positive control: the same plan, counted, before it ends.
    expect(rowFor(await viewOf(store), AVA).activePlans).toBe(1);

    const records = await store.listPlans({ actor: COORDINATOR });
    const record = records.find((candidate) => candidate.plan.id === id);
    if (!record) throw new Error("seeded plan missing from the read");
    const withdrawn = await store.withdrawPlan(
      { planId: id, expectedVersion: record.plan.version, origin: "patient" },
      { actor: COORDINATOR, idempotencyKey: idempotencyKey("withdraw-for-ended") },
    );
    if (!withdrawn.ok) throw new Error(`withdrawPlan refused: ${withdrawn.reason}`);

    const after = await viewOf(store);
    expect(after.coordinators).toEqual([]);
    expect(after.unclaimed.plans).toBe(0);
  });
});

describe("coverage keeps the named coordinator visible behind whoever is answering", () => {
  it("reports the cover on both rows while the window is open", async () => {
    const store = newStore();
    const id = await seedPlan(store, { owner: AVA });
    await cover(store, id, BLAKE, "2026-08-29", "2026-08-31");

    const view = await viewOf(store);

    expect(rowFor(view, AVA).activePlans).toBe(1);
    expect(rowFor(view, AVA).coveredByAnother).toBe(1);
    expect(rowFor(view, BLAKE).coveringForAnother).toBe(1);
    // The coverer is answering for someone else's plan, not carrying one of their own.
    expect(rowFor(view, BLAKE).activePlans).toBe(0);
  });

  /**
   * THE ATTRIBUTION THIS PINS IS THE UNCOMFORTABLE ONE. The module states the rule -- "a covered
   * plan's backlog stays with its named owner" -- and no case combined coverage with a backlog, so
   * an edit that moved the backlog to whoever is answering would have passed the whole suite.
   *
   * The consequence is worth naming beside the assertion: while a coordinator is away, the
   * contacts somebody has to look at are counted in the row of the person who is NOT answering.
   * `team-roster.tsx` now says so on the screen; this is the proof that it is true.
   */
  it("leaves a covered plan's exception backlog with its named owner, and gives the coverer none of it", async () => {
    const store = newStore();
    const id = await seedPlan(store, { owner: AVA });
    const records = await store.listPlans({ actor: COORDINATOR });
    const record = records.find((candidate) => candidate.plan.id === id);
    if (!record) throw new Error("seeded plan missing from the read");
    const first = contactOn(record, FIRST_CONTACT_DAY);
    await driveContactTo(store, id, first, "missed");
    await cover(store, id, BLAKE, "2026-08-29", "2026-09-30");

    const asAt = new Date(first.planned.sendAt.getTime() + 90 * 60_000);
    const view = await viewOf(store, asAt);

    // The positive control: the cover really is in force at this instant, so what follows is about
    // ownership rather than about a window that had already closed.
    expect(rowFor(view, BLAKE).coveringForAnother).toBe(1);

    expect(rowFor(view, AVA).exceptionBacklog.contacts).toBe(1);
    expect(rowFor(view, BLAKE).exceptionBacklog.contacts).toBe(0);
  });

  it("reports no cover once the window has passed", async () => {
    const store = newStore();
    const id = await seedPlan(store, { owner: AVA });
    await cover(store, id, BLAKE, "2026-08-20", "2026-08-21");

    const view = await viewOf(store);

    expect(rowFor(view, AVA).coveredByAnother).toBe(0);
    expect(view.coordinators.map((row) => row.actorId)).toEqual([AVA]);
  });
});

describe("exception backlog age", () => {
  it("counts a contact needing operational review and ages it from its scheduled send time", async () => {
    const store = newStore();
    const id = await seedPlan(store, { owner: AVA });
    const records = await store.listPlans({ actor: COORDINATOR });
    const record = records.find((candidate) => candidate.plan.id === id);
    if (!record) throw new Error("seeded plan missing from the read");
    const first = contactOn(record, FIRST_CONTACT_DAY);
    await driveContactTo(store, id, first, "missed");

    // Read at a fixed distance from that contact's own scheduled instant, so the expected age is
    // derived from the contact rather than from the seeding clock.
    const asAt = new Date(first.planned.sendAt.getTime() + 90 * 60_000);
    const row = rowFor(await viewOf(store, asAt), AVA);

    expect(row.exceptionBacklog.contacts).toBe(1);
    expect(row.exceptionBacklog.oldestMinutesSinceScheduledSend).toBe(90);
  });

  it("does not count a delivered contact, and reports no age when the backlog is empty", async () => {
    const store = newStore();
    const id = await seedPlan(store, { owner: AVA });
    const records = await store.listPlans({ actor: COORDINATOR });
    const record = records.find((candidate) => candidate.plan.id === id);
    if (!record) throw new Error("seeded plan missing from the read");
    const first = contactOn(record, FIRST_CONTACT_DAY);

    // The positive control: this same contact, in a review state, IS counted -- pinned by the case
    // above -- so the zero below is the delivery being excluded and not the plan being invisible.
    await driveContactTo(store, id, first, "delivered");

    const row = rowFor(await viewOf(store, new Date(first.planned.sendAt.getTime() + 90 * 60_000)), AVA);

    expect(row.exceptionBacklog.contacts).toBe(0);
    expect(row.exceptionBacklog.oldestMinutesSinceScheduledSend).toBeNull();
  });

  it("ages the backlog from the oldest reviewable contact, over more than one review state", async () => {
    const store = newStore();
    const id = await seedPlan(store, { owner: AVA });
    const records = await store.listPlans({ actor: COORDINATOR });
    const record = records.find((candidate) => candidate.plan.id === id);
    if (!record) throw new Error("seeded plan missing from the read");
    const ordered = [...record.contacts].sort(
      (left, right) => left.planned.sendAt.getTime() - right.planned.sendAt.getTime(),
    );
    await driveContactTo(store, id, ordered[0], "missed");
    await driveContactTo(store, id, ordered[1], "statusUnavailable");

    const asAt = new Date(ordered[1].planned.sendAt.getTime() + 60_000);
    const row = rowFor(await viewOf(store, asAt), AVA);

    expect(row.exceptionBacklog.contacts).toBe(2);
    // Aged from the FIRST of the two, which is older than the second by whole days.
    const expected = Math.floor((asAt.getTime() - ordered[0].planned.sendAt.getTime()) / 60_000);
    expect(row.exceptionBacklog.oldestMinutesSinceScheduledSend).toBe(expected);
  });
  it("files a reviewable contact on an unowned plan under the unclaimed group, not nowhere", async () => {
    const store = newStore();
    const id = await seedPlan(store);
    const records = await store.listPlans({ actor: COORDINATOR });
    const record = records.find((candidate) => candidate.plan.id === id);
    if (!record) throw new Error("seeded plan missing from the read");
    const first = contactOn(record, FIRST_CONTACT_DAY);
    await driveContactTo(store, id, first, "missed");

    const asAt = new Date(first.planned.sendAt.getTime() + 30 * 60_000);
    const view = await viewOf(store, asAt);

    // No owner to file it under, so a roll-up that only walked the roster rows would lose it.
    expect(view.coordinators).toEqual([]);
    expect(view.unclaimed.exceptionBacklog.contacts).toBe(1);
    expect(view.unclaimed.exceptionBacklog.oldestMinutesSinceScheduledSend).toBe(30);
  });
});

describe("the read releases nothing about a patient", () => {
  it("carries no patient id, plan id or contact id, though it was given all three", async () => {
    const store = newStore();
    const id = await seedPlan(store, { owner: AVA });
    const given = JSON.stringify(await ownershipOf(store));

    const serialised = JSON.stringify(await viewOf(store));

    // The positive control, asserted first: each identifier IS in what the roll-up was handed, so
    // the three refusals below are this read narrowing its input and not an empty fixture.
    for (const identifier of ["SYN-PATIENT-001", String(id), `${id}--contact-1`]) {
      expect(given).toContain(identifier);
      expect(serialised).not.toContain(identifier);
    }
    // ... and the view is not empty, so `not.toContain` is not passing over an empty string.
    expect(serialised).toContain(AVA);
  });

  /**
   * NEITHER INPUT CAN CARRY THESE, and that is the finding rather than the assurance. `PlanRecord`
   * holds no name and no mobile number and `PlanAssignment` holds neither either, so no mutation of
   * the roll-up can make this case red -- it is pinning the SHAPE of what the roll-up is handed, not
   * a narrowing the roll-up performs. The narrowing that IS performed, and that a mutation does
   * falsify, is pinned by the case above and by the route's own boundary test.
   */
  it("carries no patient name or mobile number, neither of which its input holds", async () => {
    const store = newStore();
    const id = await seedPlan(store, { owner: AVA });

    // The positive control comes from `getEpisode`, the only read that releases these -- so these
    // strings are the fixture's real name and number rather than two strings nothing ever held.
    const episode = await store.getEpisode(id, { actor: COORDINATOR });
    if (!episode) throw new Error("seeded episode is unreadable");
    const held = JSON.stringify(episode);
    expect(held).toContain("Synthetic Patient 001");
    expect(held).toContain("+61 491 570 156");

    // What the roll-up is actually handed, asserted rather than assumed: neither string is in it.
    const given = JSON.stringify(await ownershipOf(store));
    expect(given).not.toContain("Synthetic Patient 001");
    expect(given).not.toContain("+61 491 570 156");

    const serialised = JSON.stringify(await viewOf(store));
    expect(serialised).not.toContain("Synthetic Patient 001");
    expect(serialised).not.toContain("+61 491 570 156");
    expect(serialised).toContain(AVA);
  });

  /**
   * The one piece of free clinician text this read's INPUT does hold, so this is the absence with
   * teeth. `reassignmentHistory[].reason` is the handover note a coordinator types when moving a
   * plan; the whole-branch review recorded that it is stored permanently and that a retention
   * clearance does not touch it. A roster read is exactly the surface that would carry it onto a
   * screen by accident, so its absence is asserted against a fixture that really has one.
   */
  it("carries no handover note, though the assignment it was given holds one", async () => {
    const store = newStore();
    const id = await seedPlan(store, { owner: AVA });
    const note = "Handover note quoting clinical detail nobody should meet on a roster";
    const moved = await store.applyAssignment(
      { planId: id, action: { type: "reassign", toActorId: BLAKE, reason: note } },
      { actor: TEAM_LEAD, idempotencyKey: idempotencyKey("reassign-for-note") },
    );
    if (!moved.ok) throw new Error(`reassign refused: ${moved.reason}`);

    // The positive control: the note IS in what the roll-up was handed.
    expect(JSON.stringify(await ownershipOf(store))).toContain(note);

    const serialised = JSON.stringify(await viewOf(store));
    expect(serialised).not.toContain(note);
    expect(serialised).toContain(BLAKE);
  });
});

describe("the unclaimed plans a coordinator can claim from the Team screen", () => {
  it("lists every unclaimed plan that has not ended, oldest first, with its wait and whether it is running", async () => {
    const store = newStore();
    const newer = await seedPlan(store, { createdAt: "2026-08-30T02:30:00.000Z" });
    const older = await seedPlan(store, { createdAt: "2026-08-30T01:00:00.000Z", planState: "draft" });
    await seedPlan(store, { planState: "withdrawn" });
    await seedPlan(store, { owner: AVA });

    const queue = unclaimedPlanQueue(await ownershipOf(store), AS_AT);

    expect(queue).toEqual([
      { planId: older, minutesUnclaimed: 120, escalated: true, hold: "planNotStarted" },
      { planId: newer, minutesUnclaimed: 30, escalated: false, hold: null },
    ]);
  });

  it("carries nothing about a patient, only the plan's own identifier", async () => {
    const store = newStore();
    await seedPlan(store);

    const [entry] = unclaimedPlanQueue(await ownershipOf(store), AS_AT);

    expect(Object.keys(entry).sort()).toEqual(["escalated", "hold", "minutesUnclaimed", "planId"]);
    expect(JSON.stringify(entry)).not.toMatch(/PATIENT|Synthetic|491/);
  });
});
