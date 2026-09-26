// tests/helpers/caring-contacts-repository-contract.ts
//
// The behaviour every caring-contact store must show, written once and run against each
// implementation. Task 9 runs it against the in-memory store; Task 11 runs this same function
// against the Postgres store rather than writing a second suite, which is why it takes a factory
// instead of calling a constructor.
//
// Not named *.test.ts on purpose: the vitest node project collects `tests/**/*.test.ts`, so a
// suite living here is registered only by the thin file that calls this function.
import { describe, expect, it } from "vitest";

import { PLAN_ASSURANCES, PLAN_ASSURANCE_VALUES, type PlanAssurance } from "@/lib/caring-contacts/assurances";
import { AuditEventContainsPatientDataError, type AuditEvent } from "@/lib/caring-contacts/audit";
import { fixedClock, type Clock } from "@/lib/caring-contacts/clock";
import {
  actorId,
  idempotencyKey,
  pathwayVersionId,
  patientId,
  planId,
  referralId,
  teamId,
} from "@/lib/caring-contacts/ids";
import type { PathwayVersion } from "@/lib/caring-contacts/pathway-versions";
import {
  canPerformCaringContactAction,
  type Actor,
  type CaringContactActor,
  type CaringContactRole,
  type SystemActor,
} from "@/lib/caring-contacts/permissions";
import {
  PATIENT_NAME_READ_ACTIONS,
  READ_ACTIONS,
  REPOSITORY_REFUSALS,
  type AuditSink,
  type CaringContactRepository,
  type CaringContactRepositoryFactory,
  type CreatePlanInput,
  type EpisodePatientDetail,
  type PlanRecord,
  type WriteContext,
} from "@/lib/caring-contacts/repository";
import type { RestartApprovalSeatRoster } from "@/lib/caring-contacts/service-state";
import { DEFAULT_RETENTION_POLICY, deidentifyEpisode, isDueForDeidentification } from "@/lib/caring-contacts/retention";
import { FIRST_CONTACT_REASON_MAX_LENGTH } from "@/lib/caring-contacts/schedule";
import {
  INBOUND_REPLY_REFUSALS,
  inboundReplyActorsForTeam,
  inboundReplyIdFor,
  inboundSenderKey,
  type InboundReplyKind,
} from "@/lib/caring-contacts/inbound-replies";

const TEAM_A = teamId("TEAM-NORTH");

const PLAN_ID = planId("PLAN-1");
const PATIENT_ID = patientId("PATIENT-1");
const REFERRAL_ID = referralId("REFERRAL-1");
const PATHWAY_VERSION_ID = pathwayVersionId("PATHWAY-1");

/** 2026-03-02 10:00 AWST. */
const DISCHARGE_AT = new Date("2026-03-02T02:00:00.000Z");
const NOW = "2026-03-02T03:00:00.000Z";
/** Seven years (DEFAULT_RETENTION_POLICY) after NOW, on the AWST calendar day the period ends. */
const RETENTION_PERIOD_PASSED = "2033-03-02T03:00:00.000Z";

/**
 * What a plan is created attesting, unless a case says otherwise. Both closed values, because that
 * is what the wizard sends: stage 1 will not advance until every confirmation is made.
 *
 * Spread into a mutable array at each use rather than shared, so a store that kept the caller's
 * array cannot be caught by one case and missed by the next.
 */
const ASSURANCES: readonly PlanAssurance[] = PLAN_ASSURANCE_VALUES;

function actorWith(id: string, team: string, roles: readonly CaringContactRole[]): Actor {
  return { id: actorId(id), teamId: teamId(team), roles };
}

const COORDINATOR_A = actorWith("ACTOR-1", "TEAM-NORTH", ["coordinator"]);
const TEAM_LEAD_A = actorWith("ACTOR-2", "TEAM-NORTH", ["teamLead"]);
const AUDITOR_A = actorWith("ACTOR-3", "TEAM-NORTH", ["auditor"]);
const COORDINATOR_B = actorWith("ACTOR-4", "TEAM-SOUTH", ["coordinator"]);
const ROLELESS_A = actorWith("ACTOR-5", "TEAM-NORTH", []);

/** The non-human actor that writes contact status. It holds no human capability at all. */
const DISPATCHER_A: SystemActor = {
  id: actorId("SYSTEM-DISPATCHER"),
  teamId: teamId("TEAM-NORTH"),
  systemRole: "contactDispatcher",
};

const PATIENT_DETAIL: EpisodePatientDetail = {
  patientName: "Jordan Nguyen",
  patientMobileNumber: "+61 491 570 156",
  patientIdentifiers: ["UR-00219384"],
  culturalIdentity: null,
  // DELIBERATELY NOT A SUBSTRING OF `patientName`, and not derivable from it by any split. The
  // preferred name is ASKED FOR rather than parsed off the stored name (2026-08-26), so a fixture
  // where the two overlap would let an implementation that DID split satisfy every assertion about
  // it -- and would make the `JSON.stringify` absence checks below unable to tell the two apart.
  preferredName: "Jordy",
};

/**
 * A SECOND team lead, and the two Phase 2 governance seats. The three-person restart needs three
 * distinct actors drawn from the roles that hold `approveServiceRestart`, and dual pathway approval
 * needs the two approver seats -- neither is reachable from the five fixtures above.
 */
const SECOND_TEAM_LEAD_A = actorWith("ACTOR-7", "TEAM-NORTH", ["teamLead"]);

/**
 * A team lead in the OTHER team. Restart approvals are deliberately service-wide, so this actor
 * legitimately approves an incident that another team reported -- which is the only way to ask
 * whether `approveServiceRestart` hands a cross-team approver the reporting team's incident note.
 */
const TEAM_LEAD_B = actorWith("ACTOR-11", "TEAM-SOUTH", ["teamLead"]);
const PROGRAMME_LEAD_A = actorWith("ACTOR-8", "TEAM-NORTH", ["clinicalProgrammeLead"]);
const LIVED_EXPERIENCE_A = actorWith("ACTOR-9", "TEAM-NORTH", ["livedExperienceRepresentative"]);

/**
 * Who governance configuration names for each restart-approval seat in this suite (owner decision
 * 2026-09-26: a seat is held only by a named person listed for it). TEAM_LEAD_A is named for two
 * seats on purpose, so the different-people rule -- not the roster -- is what refuses one person
 * supplying two approvals. LIVED_EXPERIENCE_A and COORDINATOR_A are named for none.
 */
const SEATS: RestartApprovalSeatRoster = {
  incidentLead: [TEAM_LEAD_A.id, TEAM_LEAD_B.id],
  privacySecurityOwner: [PROGRAMME_LEAD_A.id, TEAM_LEAD_A.id],
  clinicalProgrammeLead: [SECOND_TEAM_LEAD_A.id, TEAM_LEAD_B.id],
};

/**
 * A clock that never returns the same instant twice.
 *
 * Every other fixture here uses `fixedClock`, which makes two reads of the clock indistinguishable
 * from one -- so a store that stamps a domain value from one read and persists another read of its
 * own looks correct under all of them. This is the fixture that can tell those apart.
 */
function advancingClock(startIso: string, stepMs = 1_000): Clock {
  const start = new Date(startIso).getTime();
  let reads = 0;
  return {
    now() {
      reads += 1;
      return new Date(start + reads * stepMs);
    },
  };
}

function writeContext(actor: CaringContactActor, key: string): WriteContext {
  return { actor, idempotencyKey: idempotencyKey(key) };
}

let extensionSequence = 0;

/** A fresh unapproved draft carrying synthetic wording. No real clinical text lives in a fixture. */
function draftPathwayVersion(author: Actor = COORDINATOR_A, id?: string): PathwayVersion {
  extensionSequence += 1;
  return {
    id: pathwayVersionId(id ?? `EXT-PATHWAY-${extensionSequence}`),
    teamId: author.teamId,
    state: "draft",
    authorId: author.id,
    approvals: [],
    publishedAt: null,
    retiredAt: null,
    retirementUrgency: null,
    snapshot: {
      cadenceLabels: ["Day 3"],
      messageTextByType: { standard: "Checking in.", first: "Welcome.", closing: "This is our last message." },
    },
  };
}

/**
 * The referral and pathway version `createInput` names, created through the REPOSITORY.
 *
 * They are not seeded around the store. `plans.referral_id` and `plans.pathway_version_id` are
 * same-team foreign keys in the Postgres schema, so a plan naming a parent nobody created is
 * refused by the database -- and a harness that pre-created them out of band would leave the two
 * contract runs starting from different preconditions, with neither run proving the store validates
 * its own parents.
 *
 * It appends audit events of its own, so a test that counts the trail takes its baseline AFTER
 * calling this rather than assuming an empty one.
 */
async function createPlanParents(
  store: CaringContactRepository,
  actor: Actor,
  options: { referralIds?: readonly string[]; pathwayVersionIds?: readonly string[]; keyPrefix?: string } = {},
): Promise<void> {
  const prefix = options.keyPrefix ?? "key-parents";
  for (const id of options.referralIds ?? ["REFERRAL-1", "REFERRAL-2"]) {
    unwrap(
      await store.createReferral(
        { referralId: referralId(id), patientId: patientId(`${id}-PATIENT`) },
        writeContext(actor, `${prefix}-${id}`),
      ),
    );
  }
  for (const id of options.pathwayVersionIds ?? ["PATHWAY-1"]) {
    unwrap(
      await store.savePathwayVersion(
        { version: draftPathwayVersion(actor, id) },
        writeContext(actor, `${prefix}-${id}`),
      ),
    );
  }
}

let extensionPlanSequence = 0;

/**
 * One plan already moved to `active`, on a fresh plan and patient identifier each call -- and built
 * entirely through the repository, including the referral and the pathway version it names.
 *
 * The parents go through `createReferral` and `savePathwayVersion` rather than being seeded around
 * the store because `plans.referral_id` and `plans.pathway_version_id` are same-team foreign keys in
 * the Postgres schema: a plan naming a parent nobody created is refused by the database. Creating
 * them here is what lets these tests prove the store validates its own parents.
 */
async function createActivePlan(
  store: CaringContactRepository,
  options: {
    actor?: Actor;
    culturalIdentity?: string;
    /**
     * Stops before `activatePlan`, returning the plan as CREATED. Its schedule already exists and
     * every contact is already `scheduled` -- which is the state #PAMATF is about, and which no
     * other fixture here can produce because they all activate.
     */
    leaveAsDraft?: boolean;
  } = {},
): Promise<PlanRecord> {
  extensionPlanSequence += 1;
  const suffix = String(extensionPlanSequence);
  const actor = options.actor ?? COORDINATOR_A;
  const referral = referralId(`EXT-REFERRAL-${suffix}`);
  const pathway = `EXT-PATHWAY-PLAN-${suffix}`;
  const patient = patientId(`EXT-PATIENT-${suffix}`);

  unwrap(
    await store.createReferral(
      { referralId: referral, patientId: patient },
      writeContext(actor, `ext-referral-${suffix}`),
    ),
  );
  unwrap(
    await store.savePathwayVersion(
      { version: draftPathwayVersion(actor, pathway) },
      writeContext(actor, `ext-pathway-${suffix}`),
    ),
  );

  const created = unwrap(
    await store.createPlan(
      {
        planId: planId(`EXT-PLAN-${suffix}`),
        referralId: referral,
        patientId: patient,
        pathwayVersionId: pathwayVersionId(pathway),
        dischargeAt: DISCHARGE_AT,
        sendingPreference: "morning",
        // `PATIENT_DETAIL` carries a NULL cultural identity, so a case asserting that a clearance
        // nulls it proves nothing unless it sets one. Opt-in rather than always-on, because the
        // cultural identity lives in its own table in the Postgres store and most callers here have
        // no business creating a row in it.
        patientDetail:
          options.culturalIdentity === undefined
            ? PATIENT_DETAIL
            : { ...PATIENT_DETAIL, culturalIdentity: options.culturalIdentity },
        assurances: [...ASSURANCES],
      },
      writeContext(actor, `ext-create-${suffix}`),
    ),
  );

  if (options.leaveAsDraft === true) return created;

  return unwrap(
    await store.activatePlan(
      { planId: created.plan.id, expectedVersion: created.plan.version },
      writeContext(actor, `ext-activate-${suffix}`),
    ),
  );
}

/**
 * A first contact three days after discharge — moved off the programme's usual discharge + 1, and
 * so requiring a reason, without landing on the discharge + 7 day that absorbs Week 1. Keeping the
 * absorption out of these cases means a failure here is about the reason and nothing else.
 */
const MOVED_FIRST_CONTACT_DAY = "2026-03-05";

/**
 * The kind of sentence a coordinator really writes: it names a relative and a living arrangement.
 * That is the whole argument for clearing it (Ruling 105), so the fixture has to look like it —
 * a reason reading "coordinator decision" would let a clearance that missed the field pass every
 * assertion below that greps for identifying content.
 */
const FIRST_CONTACT_REASON = "Patient asked to wait until she is home from her sister's.";

let movedFirstContactSequence = 0;

/**
 * A plan whose first contact was MOVED, built through the repository like every other fixture here
 * — including the referral and pathway version it names, which the Postgres schema requires as
 * same-team foreign keys.
 *
 * Returns the raw `createPlan` result rather than unwrapping it, because the refusal cases below
 * need to inspect it. Each call uses a fresh plan and patient, so a refused create leaves nothing
 * behind for the next one to collide with.
 */
async function createPlanWithMovedFirstContact(
  store: CaringContactRepository,
  options: { reason?: string; firstContactDate?: string; actor?: Actor } = {},
) {
  movedFirstContactSequence += 1;
  const suffix = String(movedFirstContactSequence);
  const actor = options.actor ?? COORDINATOR_A;
  const referral = referralId(`MOVED-REFERRAL-${suffix}`);
  const pathway = `MOVED-PATHWAY-${suffix}`;
  const patient = patientId(`MOVED-PATIENT-${suffix}`);
  const plan = planId(`MOVED-PLAN-${suffix}`);

  unwrap(
    await store.createReferral({ referralId: referral, patientId: patient }, writeContext(actor, `moved-r-${suffix}`)),
  );
  unwrap(
    await store.savePathwayVersion(
      { version: draftPathwayVersion(actor, pathway) },
      writeContext(actor, `moved-p-${suffix}`),
    ),
  );

  const created = await store.createPlan(
    {
      planId: plan,
      referralId: referral,
      patientId: patient,
      pathwayVersionId: pathwayVersionId(pathway),
      dischargeAt: DISCHARGE_AT,
      sendingPreference: "morning",
      firstContactDate: options.firstContactDate ?? MOVED_FIRST_CONTACT_DAY,
      firstContactReason: options.reason ?? FIRST_CONTACT_REASON,
      patientDetail: PATIENT_DETAIL,
      assurances: [...ASSURANCES],
    },
    writeContext(actor, `moved-create-${suffix}`),
  );

  return { planId: plan, created };
}

function createInput(overrides: Partial<CreatePlanInput> = {}): CreatePlanInput {
  return {
    planId: PLAN_ID,
    referralId: REFERRAL_ID,
    patientId: PATIENT_ID,
    pathwayVersionId: PATHWAY_VERSION_ID,
    dischargeAt: DISCHARGE_AT,
    sendingPreference: "morning",
    patientDetail: PATIENT_DETAIL,
    assurances: [...ASSURANCES],
    ...overrides,
  };
}

/** A sink that can be switched to failing mid-suite, so a write can be broken part-way through. */
function togglableAuditSink(): AuditSink & { failNext: boolean; recorded: AuditEvent[] } {
  const sink = {
    failNext: false,
    recorded: [] as AuditEvent[],
    record(event: AuditEvent) {
      if (sink.failNext) throw new Error("audit-sink-unavailable");
      sink.recorded.push(event);
    },
  };
  return sink;
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!result.ok) throw new Error(`expected an accepted write, got refusal "${result.reason}"`);
  return result.value;
}

export function describeCaringContactRepositoryContract(label: string, factory: CaringContactRepositoryFactory): void {
  describe(`CaringContactRepository contract (${label})`, () => {
    /**
     * The suite's clock. Fixed at NOW for every store, and moved forward only by
     * `passRetentionPeriod` -- the one thing in this suite that has to happen years later.
     */
    let clockInstant = NOW;
    const clock: Clock = { now: () => fixedClock(clockInstant).now() };

    async function newStore(auditSink?: AuditSink): Promise<CaringContactRepository> {
      clockInstant = NOW;
      return await factory(
        clock,
        auditSink ? { auditSink, restartApprovalSeats: SEATS } : { restartApprovalSeats: SEATS },
      );
    }

    /**
     * Owner decision (2026-09-26): identifying detail may be cleared only once the retention period
     * -- seven years, in AWST calendar days -- has passed since the plan ended, never immediately.
     * Every plan in this suite ends at NOW, so a clearance that should succeed is made on a clock
     * seven years later. `newStore` puts the clock back.
     */
    function passRetentionPeriod(): void {
      clockInstant = RETENTION_PERIOD_PASSED;
    }

    /** A store holding one plan already moved to `active`, i.e. version 2. */
    async function storeWithActivePlan(auditSink?: AuditSink) {
      const store = await newStore(auditSink);
      await createPlanParents(store, COORDINATOR_A);
      const created = unwrap(await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create")));
      const activated = unwrap(
        await store.activatePlan(
          { planId: PLAN_ID, expectedVersion: created.plan.version },
          writeContext(COORDINATOR_A, "key-activate"),
        ),
      );
      return { store, activated };
    }

    async function auditTrail(store: CaringContactRepository): Promise<AuditEvent[]> {
      return await store.listAuditEvents({ actor: AUDITOR_A });
    }

    describe("rule 1 — every write is idempotent on its key", () => {
      it("replays the original created plan and stores no second plan", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        const first = await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create"));
        const replay = await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create"));

        expect(first.ok).toBe(true);
        expect(replay).toEqual(first);
        expect(await store.listPlans({ actor: COORDINATOR_A })).toHaveLength(1);
      });

      it("replays a pause without applying it a second time", async () => {
        const { store, activated } = await storeWithActivePlan();
        const context = writeContext(COORDINATOR_A, "key-pause");

        const first = unwrap(await store.pausePlan({ planId: PLAN_ID, expectedVersion: 2 }, context));
        const replay = await store.pausePlan({ planId: PLAN_ID, expectedVersion: 2 }, context);

        expect(activated.plan.version).toBe(2);
        expect(first.plan.version).toBe(3);
        expect(replay).toEqual({ ok: true, value: first });
        expect((await store.getPlan(PLAN_ID, { actor: COORDINATOR_A }))?.plan.version).toBe(3);
      });

      it("appends no second audit event for a replay", async () => {
        const { store } = await storeWithActivePlan();
        const context = writeContext(COORDINATOR_A, "key-pause");

        await store.pausePlan({ planId: PLAN_ID, expectedVersion: 2 }, context);
        const afterFirst = (await auditTrail(store)).length;
        await store.pausePlan({ planId: PLAN_ID, expectedVersion: 2 }, context);

        expect((await auditTrail(store)).length).toBe(afterFirst);
      });

      it("refuses a key reused for a different write", async () => {
        const { store } = await storeWithActivePlan();
        await store.pausePlan({ planId: PLAN_ID, expectedVersion: 2 }, writeContext(COORDINATOR_A, "key-shared"));

        const reused = await store.resumePlan(
          { planId: PLAN_ID, expectedVersion: 3 },
          writeContext(COORDINATOR_A, "key-shared"),
        );

        expect(reused).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.idempotencyKeyReused });
        expect((await store.getPlan(PLAN_ID, { actor: COORDINATOR_A }))?.plan.state).toBe("paused");
      });

      it("scopes keys per team, so one team cannot replay another team's result", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        // The other team's plan names the other team's OWN referral and pathway version, created by
        // that team's own actor. A referral belongs to exactly one team, so two teams sharing one
        // referral id was fixture convenience rather than anything the domain allows; migration 0003
        // makes both links same-team foreign keys and refuses it outright. The assertions below are
        // unchanged -- this test is about idempotency keys being scoped per team.
        await createPlanParents(store, COORDINATOR_B, {
          referralIds: ["REFERRAL-3"],
          pathwayVersionIds: ["PATHWAY-2"],
          keyPrefix: "key-parents-south",
        });

        const mine = await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create"));
        const theirs = await store.createPlan(
          createInput({
            planId: planId("PLAN-2"),
            patientId: patientId("PATIENT-2"),
            referralId: referralId("REFERRAL-3"),
            pathwayVersionId: pathwayVersionId("PATHWAY-2"),
          }),
          writeContext(COORDINATOR_B, "key-create"),
        );

        expect(mine.ok).toBe(true);
        expect(theirs.ok).toBe(true);
        expect(await store.listPlans({ actor: COORDINATOR_A })).toHaveLength(1);
        expect(await store.listPlans({ actor: COORDINATOR_B })).toHaveLength(1);
      });
    });

    describe("rule 2 — exactly one audit event, atomically with the change", () => {
      it("appends exactly one allowed event per accepted write", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        // Taken after the parents, whose creation is itself audited. The claim is unchanged: this
        // write appends exactly one event, and the next write appends exactly one more.
        const before = (await auditTrail(store)).length;
        await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create"));

        const trail = await auditTrail(store);
        expect(trail).toHaveLength(before + 1);
        expect(trail[trail.length - 1]).toMatchObject({
          actorId: COORDINATOR_A.id,
          teamId: TEAM_A,
          outcome: "allowed",
          objectType: "plan",
          objectId: PLAN_ID,
          idempotencyKey: idempotencyKey("key-create"),
        });

        await store.activatePlan({ planId: PLAN_ID, expectedVersion: 1 }, writeContext(COORDINATOR_A, "key-activate"));
        expect(await auditTrail(store)).toHaveLength(before + 2);
      });

      it("appends exactly one denied event for a refused write, and changes nothing", async () => {
        const { store } = await storeWithActivePlan();
        const before = (await auditTrail(store)).length;

        const refused = await store.activatePlan(
          { planId: PLAN_ID, expectedVersion: 2 },
          writeContext(COORDINATOR_A, "key-reactivate"),
        );

        expect(refused).toEqual({ ok: false, reason: "plan-not-draft" });
        const trail = await auditTrail(store);
        expect(trail).toHaveLength(before + 1);
        expect(trail[trail.length - 1]).toMatchObject({ outcome: "denied" });
        expect((await store.getPlan(PLAN_ID, { actor: COORDINATOR_A }))?.plan.version).toBe(2);
      });

      it("leaves neither the change nor the audit event when the audit sink fails part-way", async () => {
        const sink = togglableAuditSink();
        const { store } = await storeWithActivePlan(sink);
        const trailBefore = await auditTrail(store);
        const recordedBefore = sink.recorded.length;

        sink.failNext = true;
        await expect(
          store.pausePlan({ planId: PLAN_ID, expectedVersion: 2 }, writeContext(COORDINATOR_A, "key-pause")),
        ).rejects.toThrow("audit-sink-unavailable");
        sink.failNext = false;

        const after = await store.getPlan(PLAN_ID, { actor: COORDINATOR_A });
        expect(after?.plan.state).toBe("active");
        expect(after?.plan.version).toBe(2);
        expect(await auditTrail(store)).toHaveLength(trailBefore.length);
        expect(sink.recorded).toHaveLength(recordedBefore);
      });

      it("leaves neither the change nor the audit event when the audit guard rejects the event", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        const before = await auditTrail(store);
        // An upstream identifier carrying something that reads as a mobile number. The change is
        // fully computed before the audit event is built, so this breaks the write part-way.
        const hostileId = planId("PLAN-0491 570 156");

        await expect(
          store.createPlan(createInput({ planId: hostileId }), writeContext(COORDINATOR_A, "key-create")),
        ).rejects.toThrow(/audit-event-contains-patient-data/);

        expect(await store.getPlan(hostileId, { actor: COORDINATOR_A })).toBeNull();
        expect(await store.listPlans({ actor: COORDINATOR_A })).toEqual([]);
        // Byte-identical to the trail before the failed write: it appended nothing at all.
        expect(await auditTrail(store)).toEqual(before);
      });

      it("does not consume the idempotency key when a write throws, so a retry still works", async () => {
        const sink = togglableAuditSink();
        const { store } = await storeWithActivePlan(sink);
        const context = writeContext(COORDINATOR_A, "key-pause");

        sink.failNext = true;
        await expect(store.pausePlan({ planId: PLAN_ID, expectedVersion: 2 }, context)).rejects.toThrow();
        sink.failNext = false;

        const retried = await store.pausePlan({ planId: PLAN_ID, expectedVersion: 2 }, context);
        expect(retried.ok).toBe(true);
        expect((await store.getPlan(PLAN_ID, { actor: COORDINATOR_A }))?.plan.state).toBe("paused");
      });
    });

    describe("rule 3 — optimistic concurrency", () => {
      it("refuses a write against a stale version and applies nothing", async () => {
        const { store } = await storeWithActivePlan();

        const stale = await store.pausePlan(
          { planId: PLAN_ID, expectedVersion: 1 },
          writeContext(COORDINATOR_A, "key-stale"),
        );

        expect(stale).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.staleVersion });
        const after = await store.getPlan(PLAN_ID, { actor: COORDINATOR_A });
        expect(after?.plan.state).toBe("active");
        expect(after?.plan.version).toBe(2);
      });

      it("lets exactly one of two simultaneous pauses win, refusing the other with stale-version", async () => {
        const { store } = await storeWithActivePlan();

        const [first, second] = await Promise.all([
          store.pausePlan({ planId: PLAN_ID, expectedVersion: 2 }, writeContext(COORDINATOR_A, "key-pause-a")),
          store.pausePlan({ planId: PLAN_ID, expectedVersion: 2 }, writeContext(TEAM_LEAD_A, "key-pause-b")),
        ]);

        const accepted = [first, second].filter((result) => result.ok);
        const refused = [first, second].filter((result) => !result.ok);

        expect(accepted).toHaveLength(1);
        expect(refused).toEqual([{ ok: false, reason: REPOSITORY_REFUSALS.staleVersion }]);

        const after = await store.getPlan(PLAN_ID, { actor: COORDINATOR_A });
        expect(after?.plan.state).toBe("paused");
        expect(after?.plan.version).toBe(3);
      });
    });

    describe("rule 4 — one non-terminal plan per patient", () => {
      it("refuses a second plan for the same patient", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create"));

        const second = await store.createPlan(
          createInput({ planId: planId("PLAN-2"), referralId: referralId("REFERRAL-2") }),
          writeContext(COORDINATOR_A, "key-create-2"),
        );

        expect(second).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.duplicateActivePlan });
        expect(await store.listPlans({ actor: COORDINATOR_A })).toHaveLength(1);
      });

      it("refuses a duplicate raised by another team too", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create"));

        const second = await store.createPlan(
          createInput({ planId: planId("PLAN-2"), referralId: referralId("REFERRAL-2") }),
          writeContext(COORDINATOR_B, "key-create-2"),
        );

        expect(second).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.duplicateActivePlan });
      });

      it("allows a new plan once the previous one has ended", async () => {
        const { store } = await storeWithActivePlan();
        await store.withdrawPlan(
          { planId: PLAN_ID, expectedVersion: 2, origin: "patient" },
          writeContext(COORDINATOR_A, "key-withdraw"),
        );

        const second = await store.createPlan(
          createInput({ planId: planId("PLAN-2"), referralId: referralId("REFERRAL-2") }),
          writeContext(COORDINATOR_A, "key-create-2"),
        );

        expect(second.ok).toBe(true);
      });

      it("refuses a repeat of an identifier already used", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create"));

        const clash = await store.createPlan(
          createInput({ patientId: patientId("PATIENT-2") }),
          writeContext(COORDINATOR_A, "key-create-2"),
        );

        expect(clash).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.planAlreadyExists });
      });

      it("rejects a blank patient name or empty string", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);

        await expect(
          store.createPlan(
            createInput({
              patientDetail: {
                ...PATIENT_DETAIL,
                patientName: "   ",
              },
            }),
            writeContext(COORDINATOR_A, "key-create-blank-spaces"),
          ),
        ).rejects.toThrow("Validation error: patient name must not be blank");

        await expect(
          store.createPlan(
            createInput({
              patientDetail: {
                ...PATIENT_DETAIL,
                patientName: "",
              },
            }),
            writeContext(COORDINATOR_A, "key-create-blank-empty"),
          ),
        ).rejects.toThrow("Validation error: patient name must not be blank");
      });
    });

    // Owner-approved (2026-09-26): a draft plan -- created and never started -- can be cancelled.
    // Before this a draft could not be ended at all, and it blocked every future plan and referral
    // for that patient. Permission is the one `createPlan` itself requires (`claimPlan`), so exactly
    // the roles that can create a plan can cancel one.
    describe("cancelling a draft plan that never started", () => {
      async function storeWithDraft() {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        const draft = unwrap(await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create")));
        return { store, draft };
      }

      it("ends the draft as cancelled, cancels every contact it held, and audits it", async () => {
        const { store, draft } = await storeWithDraft();
        expect(draft.plan.state).toBe("draft");

        const cancelled = unwrap(
          await store.cancelDraftPlan(
            { planId: PLAN_ID, expectedVersion: draft.plan.version },
            writeContext(COORDINATOR_A, "key-cancel"),
          ),
        );

        expect(cancelled.plan.state).toBe("cancelled");
        expect(cancelled.plan.version).toBe(draft.plan.version + 1);
        expect(cancelled.outcome).toBe("cancelled");
        expect(cancelled.completedAt).not.toBeNull();
        expect(
          cancelled.contacts.every(
            (entry) => entry.contact.state === "cancelled" || entry.contact.state === "suppressed",
          ),
        ).toBe(true);
        expect(await store.listSendableContacts(PLAN_ID, { actor: COORDINATOR_A })).toEqual([]);

        const events = (await auditTrail(store)).filter((event) => event.action === "cancelDraftPlan");
        expect(events.map((event) => [event.objectId, event.outcome])).toEqual([[PLAN_ID, "allowed"]]);
      });

      it("refuses a plan that has started, by name, and changes nothing", async () => {
        const { store, activated } = await storeWithActivePlan();
        const refused = await store.cancelDraftPlan(
          { planId: PLAN_ID, expectedVersion: activated.plan.version },
          writeContext(COORDINATOR_A, "key-cancel-active"),
        );
        expect(refused).toEqual({ ok: false, reason: "plan-not-draft" });
        expect((await store.getPlan(PLAN_ID, { actor: COORDINATOR_A }))?.plan.state).toBe("active");
      });

      it("refuses a role that cannot create plans, a stale version, and another team", async () => {
        const { store, draft } = await storeWithDraft();
        expect(
          await store.cancelDraftPlan(
            { planId: PLAN_ID, expectedVersion: draft.plan.version },
            writeContext(AUDITOR_A, "key-cancel-auditor"),
          ),
        ).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });
        expect(
          await store.cancelDraftPlan(
            { planId: PLAN_ID, expectedVersion: draft.plan.version + 5 },
            writeContext(COORDINATOR_A, "key-cancel-stale"),
          ),
        ).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.staleVersion });
        expect(
          await store.cancelDraftPlan(
            { planId: PLAN_ID, expectedVersion: draft.plan.version },
            writeContext(COORDINATOR_B, "key-cancel-other-team"),
          ),
        ).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.notFound });
        expect((await store.getPlan(PLAN_ID, { actor: COORDINATOR_A }))?.plan.state).toBe("draft");
      });

      it("a team lead may cancel a draft too, and a replay returns the first answer without a second change", async () => {
        const { store, draft } = await storeWithDraft();
        const context = writeContext(TEAM_LEAD_A, "key-cancel-lead");
        const first = await store.cancelDraftPlan({ planId: PLAN_ID, expectedVersion: draft.plan.version }, context);
        const replay = await store.cancelDraftPlan({ planId: PLAN_ID, expectedVersion: draft.plan.version }, context);
        expect(first.ok).toBe(true);
        expect(replay).toEqual(first);
        expect((await store.getPlan(PLAN_ID, { actor: COORDINATOR_A }))?.plan.version).toBe(draft.plan.version + 1);
      });

      it("no longer blocks a new referral or a new plan for that patient", async () => {
        const { store, draft } = await storeWithDraft();

        // Positive control: while the draft stands, both are refused.
        expect(
          await store.createReferral(
            { referralId: referralId("REFERRAL-AFTER-DRAFT"), patientId: PATIENT_ID },
            writeContext(COORDINATOR_A, "key-referral-blocked"),
          ),
        ).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.duplicateActivePlan });

        unwrap(
          await store.cancelDraftPlan(
            { planId: PLAN_ID, expectedVersion: draft.plan.version },
            writeContext(COORDINATOR_A, "key-cancel"),
          ),
        );

        unwrap(
          await store.createReferral(
            { referralId: referralId("REFERRAL-AFTER-DRAFT"), patientId: PATIENT_ID },
            writeContext(COORDINATOR_A, "key-referral-after"),
          ),
        );
        const second = await store.createPlan(
          createInput({ planId: planId("PLAN-AFTER-DRAFT"), referralId: referralId("REFERRAL-AFTER-DRAFT") }),
          writeContext(COORDINATOR_A, "key-create-after"),
        );
        expect(second.ok).toBe(true);
      });

      it("is refused while the service is stopped, like every other ordinary mutation", async () => {
        const { store, draft } = await storeWithDraft();
        unwrap(
          await store.stopService({ reason: "wrong-recipient", note: "n/a" }, writeContext(COORDINATOR_A, "s-cancel")),
        );
        expect(
          await store.cancelDraftPlan(
            { planId: PLAN_ID, expectedVersion: draft.plan.version },
            writeContext(COORDINATOR_A, "key-cancel-stopped"),
          ),
        ).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.serviceStopped });
      });
    });

    describe("rule 5 — reads are team-scoped and reveal nothing", () => {
      it("returns empty for every read made by an actor from another team", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create"));

        expect(await store.getPlan(PLAN_ID, { actor: COORDINATOR_B })).toBeNull();
        expect(await store.listPlans({ actor: COORDINATOR_B })).toEqual([]);
        expect(await store.listContacts(PLAN_ID, { actor: COORDINATOR_B })).toEqual([]);
        expect(await store.listSendableContacts(PLAN_ID, { actor: COORDINATOR_B })).toEqual([]);
        expect(await store.getEpisode(PLAN_ID, { actor: COORDINATOR_B })).toBeNull();
        expect(await store.listAuditEvents({ actor: actorWith("ACTOR-6", "TEAM-SOUTH", ["auditor"]) })).toEqual([]);

        expect(await store.getPlan(PLAN_ID, { actor: COORDINATOR_A })).not.toBeNull();
      });

      it("gives a cross-team write the same answer as a plan that does not exist", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create"));

        const crossTeam = await store.activatePlan(
          { planId: PLAN_ID, expectedVersion: 1 },
          writeContext(COORDINATOR_B, "key-activate"),
        );
        const absent = await store.activatePlan(
          { planId: planId("PLAN-ABSENT"), expectedVersion: 1 },
          writeContext(COORDINATOR_B, "key-activate-2"),
        );

        expect(crossTeam).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.notFound });
        expect(crossTeam).toEqual(absent);
        expect((await store.getPlan(PLAN_ID, { actor: COORDINATOR_A }))?.plan.state).toBe("draft");
      });

      it("returns empty rather than a refusal when the actor's role does not cover the read", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        const before = (await auditTrail(store)).length;
        unwrap(await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create")));

        // Positive controls first: the record and the trail are both genuinely readable by an
        // actor whose role covers them, so the empty results below are scoping and not absence.
        expect(await store.getPlan(PLAN_ID, { actor: COORDINATOR_A })).not.toBeNull();
        expect(await store.getEpisode(PLAN_ID, { actor: TEAM_LEAD_A })).not.toBeNull();
        expect(await store.listAuditEvents({ actor: AUDITOR_A })).toHaveLength(before + 1);

        expect(await store.getPlan(PLAN_ID, { actor: AUDITOR_A })).toBeNull();
        expect(await store.getEpisode(PLAN_ID, { actor: AUDITOR_A })).toBeNull();
        expect(await store.listAuditEvents({ actor: COORDINATOR_A })).toEqual([]);
      });

      it("refuses a write by an in-team actor whose role does not grant the action", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create"));

        const refused = await store.activatePlan(
          { planId: PLAN_ID, expectedVersion: 1 },
          writeContext(ROLELESS_A, "key-activate"),
        );

        expect(refused).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });
      });

      it("keeps patient-identifying detail out of plan reads and the audit trail", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        const before = (await auditTrail(store)).length;
        await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create"));

        const record = await store.getPlan(PLAN_ID, { actor: COORDINATOR_A });
        const trail = await auditTrail(store);

        // Positive controls: both really did come back, so the absences below mean something.
        expect(record?.patientId).toBe(PATIENT_ID);
        expect(trail).toHaveLength(before + 1);

        expect(JSON.stringify(record)).not.toContain("491 570 156");
        expect(JSON.stringify(record)).not.toContain("Jordan");
        expect(JSON.stringify(trail)).not.toContain("491 570 156");
        expect(JSON.stringify(trail)).not.toContain("Jordan");

        // ...and the detail is still held, released only through the episode projection.
        expect((await store.getEpisode(PLAN_ID, { actor: TEAM_LEAD_A }))?.patientName).toBe("Jordan Nguyen");

        // WHAT THIS TEST CANNOT SEE. It reads the records a store hands BACK, and stops one table
        // short: every write also inserts an `idempotency_records` row holding a fingerprint of the
        // request, and this request's fingerprint was a faithful rendering of the four fields above.
        // A store test cannot ask that question of an in-memory Map, so the other half lives in
        // tests/caring-contacts-postgres-repository.test.ts ("no patient detail reaches
        // idempotency_records"), which reads the table itself as the migration role. ../fingerprint
        // now hashes, so neither store can write the request's text into that row.
      });
    });

    /**
     * Ruling 91's names-only projection, held by the SHARED contract so both stores answer it the
     * same way. The screen it exists for is the Patients directory, which needs a name per row and
     * has no business holding a mobile number, an identifier list or a cultural identity.
     */
    describe("listPatientNames — the name, and structurally nothing else (Ruling 91)", () => {
      it("releases the patient's name for a plan the actor can list, and no other detail with it", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        unwrap(await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create")));

        const names = await store.listPatientNames({ actor: COORDINATOR_A });

        expect(names).toEqual([{ planId: PLAN_ID, patientName: "Jordan Nguyen" }]);
        // The shape itself, not merely the values: an extra field would satisfy `toEqual`'s
        // subset-free comparison only because it is asserted here as the whole key set.
        expect(Object.keys(names[0]).sort()).toEqual(["patientName", "planId"]);
        // And the three fields this read exists to leave behind. The fixture's own values, so a
        // pass means they were not released rather than that the fixture never held them --
        // `getEpisode` below is the positive control that the store is still holding all of them.
        const serialised = JSON.stringify(names);
        expect(serialised).not.toContain("491 570 156");
        expect(serialised).not.toContain("UR-00219384");
        const episode = await store.getEpisode(PLAN_ID, { actor: TEAM_LEAD_A });
        expect(episode?.patientMobileNumber).toBe("+61 491 570 156");
        expect(episode?.patientIdentifiers).toEqual(["UR-00219384"]);
      });

      it("names exactly the plans the same actor can list, one entry each", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        unwrap(await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create")));
        await createActivePlan(store);

        const plans = await store.listPlans({ actor: COORDINATOR_A });
        const names = await store.listPatientNames({ actor: COORDINATOR_A });

        expect(plans).toHaveLength(2);
        expect([...names].map((entry) => entry.planId).sort()).toEqual([...plans].map((plan) => plan.plan.id).sort());
      });

      it("gives an actor from another team the same empty answer an empty store gives", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        unwrap(await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create")));

        const empty = await newStore();

        // Positive control: the plan is genuinely readable inside its own team, so the two empties
        // below are scoping rather than an absent record.
        expect(await store.listPatientNames({ actor: COORDINATOR_A })).toHaveLength(1);
        // Identical answers, so nothing here tells a cross-team actor whether the plan exists --
        // the property `getPlan` protects by returning null for both cases. This read takes no
        // plan id at all, so there is no question for it to answer either way.
        expect(await store.listPatientNames({ actor: COORDINATOR_B })).toEqual([]);
        expect(await empty.listPatientNames({ actor: COORDINATOR_B })).toEqual([]);
      });

      it("is empty, never a refusal, for a role that may not list plans — even one holding viewPatientRecord", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        unwrap(await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create")));

        // The auditor is the case this rule exists for, and the assertion below is what makes the
        // empty answer meaningful: the auditor DOES hold the name capability, and still gets
        // nothing, because it cannot enumerate this team's plans. A read gated on
        // `viewPatientRecord` alone would hand this role every name the team holds -- a widening,
        // from a change whose whole purpose is narrowing.
        expect(
          canPerformCaringContactAction(AUDITOR_A, READ_ACTIONS.patientName, { teamId: AUDITOR_A.teamId }),
        ).toEqual({ allowed: true });
        expect(canPerformCaringContactAction(AUDITOR_A, READ_ACTIONS.plan, { teamId: AUDITOR_A.teamId }).allowed).toBe(
          false,
        );
        expect(PATIENT_NAME_READ_ACTIONS).toContain(READ_ACTIONS.plan);

        expect(await store.listPatientNames({ actor: AUDITOR_A })).toEqual([]);
        expect(await store.listPlans({ actor: AUDITOR_A })).toEqual([]);
        expect(await store.listPatientNames({ actor: ROLELESS_A })).toEqual([]);
        // Software has no reason to know a patient's name; the dispatcher holds no human capability
        // at all, and a delivery pipeline that could read names would be a new disclosure surface.
        expect(await store.listPatientNames({ actor: DISPATCHER_A })).toEqual([]);
      });

      it("holds no name for a plan a retention clearance has already de-identified", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        unwrap(
          await store.withdrawPlan(
            { planId: plan.plan.id, expectedVersion: plan.plan.version, origin: "patient" },
            writeContext(COORDINATOR_A, `names-withdraw-${plan.plan.id}`),
          ),
        );

        // Positive control: the name is released right up until the clearance.
        const before = await store.listPatientNames({ actor: COORDINATOR_A });
        expect(before.find((entry) => entry.planId === plan.plan.id)?.patientName).toBe("Jordan Nguyen");

        passRetentionPeriod();
        unwrap(
          await store.markRetentionCleared(
            { planId: plan.plan.id },
            writeContext(COORDINATOR_A, `names-clear-${plan.plan.id}`),
          ),
        );

        const after = await store.listPatientNames({ actor: COORDINATOR_A });
        // The row is still listed -- the plan still exists -- and the cleared value is the empty
        // string both stores write, which a caller must read as "no name held". Dropping the entry
        // instead would make a cleared plan indistinguishable from one this actor may not see.
        expect(after.find((entry) => entry.planId === plan.plan.id)?.patientName).toBe("");
      });
    });

    describe("dispatch never keys off sendAt", () => {
      it("stores an absorbed contact as terminal, so it can never reach a dispatch list", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        const created = unwrap(
          await store.createPlan(
            createInput({ firstContactDate: "2026-03-09", firstContactReason: "Patient asked to start later" }),
            writeContext(COORDINATOR_A, "key-create"),
          ),
        );
        // Activated, so this case measures ABSORPTION and nothing else. It used to read the
        // sendable list off a plan still in `draft`, which was only possible because that list had
        // no plan gate (#PAMATF); the nine below would otherwise be nine messages offered for a
        // plan nobody had started, which is the defect rather than the subject.
        unwrap(
          await store.activatePlan(
            { planId: PLAN_ID, expectedVersion: created.plan.version },
            writeContext(COORDINATOR_A, "key-activate-absorbed"),
          ),
        );

        const all = await store.listContacts(PLAN_ID, { actor: COORDINATOR_A });
        const sendable = await store.listSendableContacts(PLAN_ID, { actor: COORDINATOR_A });
        const absorbed = all.filter((stored) => stored.planned.suppressed !== undefined);

        expect(all).toHaveLength(10);
        expect(absorbed).toHaveLength(1);
        expect(absorbed[0].contact.state).toBe("suppressed");
        expect(absorbed[0].planned.sendAt.getTime()).toBeGreaterThan(0);
        expect(sendable).toHaveLength(9);
        expect(sendable.map((stored) => stored.contact.id)).not.toContain(absorbed[0].contact.id);

        const days = sendable.map((stored) => stored.planned.calendarDay);
        expect(new Set(days).size).toBe(days.length);
      });
    });

    describe("a recorded death stops everything outright", () => {
      it("cancels every non-terminal contact without comparing any time to now", async () => {
        const { store } = await storeWithActivePlan();

        const outcome = unwrap(
          await store.recordHospitalStatusEvent(
            { planId: PLAN_ID, expectedVersion: 2, event: { type: "death", recordedAt: new Date(NOW) } },
            writeContext(COORDINATOR_A, "key-death"),
          ),
        );

        expect(outcome.record.plan.state).toBe("cancelled");
        expect(outcome.contactsCancelled).toBe(10);
        const contacts = await store.listContacts(PLAN_ID, { actor: COORDINATOR_A });
        expect(contacts.every((stored) => stored.contact.state === "cancelled")).toBe(true);
        expect(await store.listSendableContacts(PLAN_ID, { actor: COORDINATOR_A })).toEqual([]);
      });

      it("cancels contacts whose send instant is far in the future just the same", async () => {
        const { store } = await storeWithActivePlan();
        await store.recordHospitalStatusEvent(
          { planId: PLAN_ID, expectedVersion: 2, event: { type: "death", recordedAt: new Date(NOW) } },
          writeContext(COORDINATOR_A, "key-death"),
        );

        const contacts = await store.listContacts(PLAN_ID, { actor: COORDINATOR_A });
        const latest = contacts.reduce((a, b) => (a.planned.sendAt > b.planned.sendAt ? a : b));
        expect(latest.planned.sendAt.getTime()).toBeGreaterThan(new Date(NOW).getTime());
        expect(latest.contact.state).toBe("cancelled");
      });

      it("holds without cancelling for a readmission", async () => {
        const { store } = await storeWithActivePlan();

        const outcome = unwrap(
          await store.recordHospitalStatusEvent(
            { planId: PLAN_ID, expectedVersion: 2, event: { type: "readmission" } },
            writeContext(COORDINATOR_A, "key-readmission"),
          ),
        );

        expect(outcome.record.plan.state).toBe("paused");
        expect(outcome.contactsCancelled).toBe(0);

        // NOTHING WAS CANCELLED, AND NOTHING IS SENDABLE. Those are two different facts and this
        // case is the reason both have to be stated (#PAMATF).
        //
        // This assertion used to read `toHaveLength(10)`, because `listSendableContacts` filtered
        // on the contact alone: a readmission pauses the plan WITHOUT touching its contacts, which
        // is the whole point of a hold, so all ten stayed `scheduled` and the read went on offering
        // them. It was pinning the defect. A paused plan sends nothing -- that is what pausing is.
        //
        // The hold's reversibility is still proven, by `listContacts` below: the ten contacts are
        // all still there, all still `scheduled`, so resuming the plan restores them. A read that
        // had cancelled them could not pass both assertions.
        expect(await store.listSendableContacts(PLAN_ID, { actor: COORDINATOR_A })).toHaveLength(0);
        const held = await store.listContacts(PLAN_ID, { actor: COORDINATOR_A });
        expect(held).toHaveLength(10);
        expect(held.every((entry) => entry.contact.state === "scheduled")).toBe(true);
      });

      it("keeps the read gate and the write gate agreeing on every plan state (Ruling [129A])", async () => {
        // THE PRICE RULING [129] PREDICTED, PINNED RATHER THAN ACCEPTED.
        //
        // [129] declined to gate the read precisely because it would duplicate `requiresActivePlan`
        // on the write -- "two places to keep in step where there is now one". #PAMATF overturned
        // that with owner approval, which makes keeping them in step this suite's job. Nothing else
        // enforces it: the load-time invariant in ./model ties `planSendingHold` to
        // `TERMINAL_PLAN_STATES` only, and says nothing about the write.
        //
        // Stated as an equivalence over every reachable plan state, not as two separate lists, so
        // the assertion is the agreement itself. Whichever gate a future change moves, this fails.
        const store = await newStore();

        // THE THREE STATES WHERE THE PLAN GATE IS WHAT DECIDES. The ended states are deliberately
        // excluded: `withdrawPlan` and a recorded death run every unsent contact through `cancel`,
        // so there is no `scheduled` contact left and BOTH gates refuse on the CONTACT rather than
        // on the plan -- an agreement that would hold even if the plan gate were deleted. Including
        // them would make this pass for the wrong reason. Their plan-side classification is pinned
        // instead by the load-time invariant in ./model against `TERMINAL_PLAN_STATES`.
        for (const target of ["draft", "active", "paused"] as const) {
          const plan = await createActivePlan(store, { leaveAsDraft: true });
          const id = plan.plan.id;
          let version = plan.plan.version;

          if (target !== "draft") {
            version = unwrap(
              await store.activatePlan(
                { planId: id, expectedVersion: version },
                writeContext(COORDINATOR_A, `gates-activate-${target}`),
              ),
            ).plan.version;
          }
          if (target === "paused") {
            version = unwrap(
              await store.pausePlan(
                { planId: id, expectedVersion: version },
                writeContext(COORDINATOR_A, "gates-pause"),
              ),
            ).plan.version;
          }

          // A contact to aim the write at, taken from the full list so a held plan still has one --
          // `listSendableContacts` is the very thing under test and cannot be the source here.
          const contacts = await store.listContacts(id, { actor: COORDINATOR_A });
          const target_ = contacts.find((entry) => entry.contact.state === "scheduled");
          if (!target_) throw new Error(`no scheduled contact for a ${target} plan`);

          const readAdmits = (await store.listSendableContacts(id, { actor: COORDINATOR_A })).length > 0;
          const write = await store.startContactDispatch(
            { planId: id, contactId: target_.contact.id, expectedContactVersion: target_.contact.version },
            writeContext(DISPATCHER_A, `gates-dispatch-${target}`),
          );
          const writeAdmits = write.ok || write.reason !== REPOSITORY_REFUSALS.contactDispatchRequiresActivePlan;

          expect({ target, readAdmits, writeAdmits }).toEqual({ target, readAdmits: writeAdmits, writeAdmits });
          // Positive control on the pair: `active` must be the state where BOTH admit, so an
          // implementation that refused everywhere would agree with itself and still fail here.
          expect({ target, readAdmits }).toEqual({ target, readAdmits: target === "active" });
        }
      });

      it("offers nothing sendable until a plan is started, and again once it is (#PAMATF)", async () => {
        // Contacts are written `scheduled` at CREATION -- the schedule is built when the plan is,
        // not when it is activated -- and no plan lifecycle write touches them. So a read keyed on
        // the contact alone announced a plan nobody had started as ten messages about to go out.
        //
        // Not a live send hole: both stores already refuse to OPEN a dispatch on a non-active plan.
        // It is the read a dispatcher will trust that was wrong, and Ruling [129] said to fix the
        // name or the gate before anything was built that dispatches.
        const store = await newStore();
        const draft = await createActivePlan(store, { leaveAsDraft: true });

        // Positive control: the contacts really are there and really are `scheduled`, so the empty
        // list below is the plan gate acting rather than the schedule never having been built.
        const plannedWhileDraft = await store.listContacts(draft.plan.id, { actor: COORDINATOR_A });
        expect(plannedWhileDraft.length).toBeGreaterThan(0);
        expect(plannedWhileDraft.every((entry) => entry.contact.state === "scheduled")).toBe(true);

        expect(draft.plan.state).toBe("draft");
        expect(await store.listSendableContacts(draft.plan.id, { actor: COORDINATOR_A })).toEqual([]);

        unwrap(
          await store.activatePlan(
            { planId: draft.plan.id, expectedVersion: draft.plan.version },
            writeContext(COORDINATOR_A, "pamatf-activate"),
          ),
        );

        // And the gate opens, so it is a gate rather than a blanket refusal.
        expect((await store.listSendableContacts(draft.plan.id, { actor: COORDINATOR_A })).length).toBe(
          plannedWhileDraft.length,
        );
      });

      it("records a death as a hospital status event, not as a service safety stop", async () => {
        const { store } = await storeWithActivePlan();
        const before = (await auditTrail(store)).length;

        await store.recordHospitalStatusEvent(
          { planId: PLAN_ID, expectedVersion: 2, event: { type: "death", recordedAt: new Date(NOW) } },
          writeContext(COORDINATOR_A, "key-death"),
        );

        const event = (await auditTrail(store))[before];
        expect(event.action).toBe("recordHospitalStatusEvent:death");
        expect(event.action).not.toContain("SafetyStop");
      });

      it("never blocks a recorded death on a permission check, even for an auditor", async () => {
        const { store } = await storeWithActivePlan();

        // The auditor holds no recordHospitalStatusEvent grant...
        const readmission = await store.recordHospitalStatusEvent(
          { planId: PLAN_ID, expectedVersion: 2, event: { type: "readmission" } },
          writeContext(AUDITOR_A, "key-readmission"),
        );
        expect(readmission).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });

        // ...but a death still gets through, on triggerServiceSafetyStop, because a refusal here
        // would leave the plan sending to someone who has died.
        const death = unwrap(
          await store.recordHospitalStatusEvent(
            { planId: PLAN_ID, expectedVersion: 2, event: { type: "death", recordedAt: new Date(NOW) } },
            writeContext(AUDITOR_A, "key-death"),
          ),
        );
        expect(death.record.plan.state).toBe("cancelled");
        expect(death.contactsCancelled).toBe(10);
      });

      it("refuses a third-party withdrawal by name and leaves the plan alone", async () => {
        const { store } = await storeWithActivePlan();

        const refused = await store.withdrawPlan(
          { planId: PLAN_ID, expectedVersion: 2, origin: "thirdParty" },
          writeContext(COORDINATOR_A, "key-withdraw"),
        );

        expect(refused).toEqual({ ok: false, reason: "third-party-withdrawal-refused" });
        expect((await store.getPlan(PLAN_ID, { actor: COORDINATOR_A }))?.plan.state).toBe("active");
      });
    });

    describe("contact status is written by the dispatcher, and only by the dispatcher", () => {
      /** The first sendable contact of an active plan, with the version a write must state. */
      async function firstSendable(store: CaringContactRepository) {
        const sendable = await store.listSendableContacts(PLAN_ID, { actor: COORDINATOR_A });
        return sendable[0];
      }

      it("carries a contact through dispatch, so the episode's sent and delivered counts can move off zero", async () => {
        const { store } = await storeWithActivePlan();
        const target = await firstSendable(store);

        const processing = unwrap(
          await store.startContactDispatch(
            { planId: PLAN_ID, contactId: target.contact.id, expectedContactVersion: target.contact.version },
            writeContext(DISPATCHER_A, "key-dispatch"),
          ),
        );
        expect(processing.contact.state).toBe("processing");

        const sent = unwrap(
          await store.recordContactSent(
            { planId: PLAN_ID, contactId: target.contact.id, expectedContactVersion: processing.contact.version },
            writeContext(DISPATCHER_A, "key-sent"),
          ),
        );
        expect(sent.contact.state).toBe("sent");

        const delivered = unwrap(
          await store.recordContactProviderStatus(
            {
              planId: PLAN_ID,
              contactId: target.contact.id,
              expectedContactVersion: sent.contact.version,
              status: "delivered",
            },
            writeContext(DISPATCHER_A, "key-status"),
          ),
        );
        expect(delivered.contact.state).toBe("delivered");

        const episode = await store.getEpisode(PLAN_ID, { actor: TEAM_LEAD_A });
        expect(episode?.counts.contactsSent).toBe(1);
        expect(episode?.counts.contactsDelivered).toBe(1);
        // ...and the contact is out of the sendable list, so it cannot be dispatched twice.
        expect(
          (await store.listSendableContacts(PLAN_ID, { actor: COORDINATOR_A })).map((s) => s.contact.id),
        ).not.toContain(target.contact.id);
      });

      it("refuses a human actor writing a delivery receipt by hand", async () => {
        const { store } = await storeWithActivePlan();
        const target = await firstSendable(store);

        for (const actor of [COORDINATOR_A, TEAM_LEAD_A, AUDITOR_A]) {
          const refused = await store.startContactDispatch(
            { planId: PLAN_ID, contactId: target.contact.id, expectedContactVersion: target.contact.version },
            writeContext(actor, `key-human-${actor.id}`),
          );
          expect(refused).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });
        }
      });

      it("refuses to begin a dispatch unless the plan is active", async () => {
        const { store } = await storeWithActivePlan();
        const target = await firstSendable(store);
        await store.pausePlan({ planId: PLAN_ID, expectedVersion: 2 }, writeContext(COORDINATOR_A, "key-pause"));

        const refused = await store.startContactDispatch(
          { planId: PLAN_ID, contactId: target.contact.id, expectedContactVersion: target.contact.version },
          writeContext(DISPATCHER_A, "key-dispatch"),
        );
        expect(refused).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.contactDispatchRequiresActivePlan });
      });

      it("refuses a contact-status write that states a stale contact version", async () => {
        const { store } = await storeWithActivePlan();
        const target = await firstSendable(store);
        await store.startContactDispatch(
          { planId: PLAN_ID, contactId: target.contact.id, expectedContactVersion: target.contact.version },
          writeContext(DISPATCHER_A, "key-dispatch"),
        );

        const refused = await store.recordContactSent(
          { planId: PLAN_ID, contactId: target.contact.id, expectedContactVersion: target.contact.version },
          writeContext(DISPATCHER_A, "key-sent"),
        );
        expect(refused).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.staleVersion });
      });

      it("appends one audit event per contact-status write, naming the contact and the system role", async () => {
        const { store } = await storeWithActivePlan();
        const target = await firstSendable(store);
        const before = (await auditTrail(store)).length;

        await store.startContactDispatch(
          { planId: PLAN_ID, contactId: target.contact.id, expectedContactVersion: target.contact.version },
          writeContext(DISPATCHER_A, "key-dispatch"),
        );

        const trail = await auditTrail(store);
        expect(trail).toHaveLength(before + 1);
        const event = trail[trail.length - 1];
        expect(event.action).toBe("startContactDispatch");
        expect(event.objectType).toBe("contact");
        expect(event.objectId).toBe(target.contact.id);
        expect(event.actorRoles).toEqual(["contactDispatcher"]);
        expect(event.outcome).toBe("allowed");
      });

      it("gives the dispatcher no read access at all", async () => {
        const { store } = await storeWithActivePlan();
        expect(await store.getPlan(PLAN_ID, { actor: DISPATCHER_A })).toBeNull();
        expect(await store.listSendableContacts(PLAN_ID, { actor: DISPATCHER_A })).toEqual([]);
        expect(await store.listAuditEvents({ actor: DISPATCHER_A })).toEqual([]);
        expect(await store.getEpisode(PLAN_ID, { actor: DISPATCHER_A })).toBeNull();
      });
    });

    describe("the episode projection is retention's own type", () => {
      it("projects a finished plan into an Episode that retention can act on", async () => {
        const { store } = await storeWithActivePlan();
        await store.withdrawPlan(
          { planId: PLAN_ID, expectedVersion: 2, origin: "patient" },
          writeContext(COORDINATOR_A, "key-withdraw"),
        );

        const episode = await store.getEpisode(PLAN_ID, { actor: TEAM_LEAD_A });
        expect(episode).not.toBeNull();
        if (!episode) return;

        expect(episode.state).toBe("withdrawn");
        expect(episode.teamId).toBe(TEAM_A);
        expect(episode.pathwayVersionId).toBe(PATHWAY_VERSION_ID);
        expect(episode.patientMobileNumber).toBe(PATIENT_DETAIL.patientMobileNumber);
        expect(episode.planDates.completedAt).toEqual(new Date(NOW));
        expect(episode.counts.contactsScheduled).toBe(10);

        expect(deidentifyEpisode(episode)).not.toHaveProperty("patientMobileNumber");
        expect(isDueForDeidentification(episode, DEFAULT_RETENTION_POLICY, fixedClock(NOW))).toBe(false);
        expect(
          isDueForDeidentification(episode, DEFAULT_RETENTION_POLICY, fixedClock("2033-03-03T03:00:00.000Z")),
        ).toBe(true);
      });

      it("leaves completedAt null while the plan is still open", async () => {
        const { store } = await storeWithActivePlan();
        const episode = await store.getEpisode(PLAN_ID, { actor: TEAM_LEAD_A });
        expect(episode?.planDates.completedAt).toBeNull();
        expect(episode?.outcome).toBe("inProgress");
      });
    });

    // -------------------------------------------------------------------------
    // The Task 10 storage extension: referrals, pathway versions, service state, assignment,
    // dispatch reconciliation, the access trail, preferences, training and retention.
    //
    // These arrived in tests/caring-contacts-repository.test.ts, which builds the in-memory store
    // directly, so they held exactly ONE store to the behaviour. They live here now for the reason
    // this file exists at all: the service-wide safety stop, the three-person restart, and Ruling
    // 14's authored-content-only save are the last places in this domain where a silent divergence
    // between two stores could be tolerated, and they are the first places it would hurt.
    // -------------------------------------------------------------------------

    describe("workspace storage extension", () => {
      it("refuses every ordinary mutation while the service is stopped, and still accepts a death", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);

        const stop = await store.stopService(
          { reason: "wrong-recipient", note: "SYN-CONTACT-004 reached the wrong number." },
          writeContext(COORDINATOR_A, "stop-1"),
        );
        expect(stop.ok).toBe(true);

        const paused = await store.pausePlan(
          { planId: plan.plan.id, expectedVersion: plan.plan.version },
          writeContext(COORDINATOR_A, "pause-1"),
        );
        // The wire text is pinned as a LITERAL here, and deliberately only here. Every other test
        // reads the constant, so a rename of REPOSITORY_REFUSALS.serviceStopped would sail through
        // all of them; this one is what makes the reason a contract with callers rather than an
        // internal name two stores happen to share.
        expect(paused).toEqual({ ok: false, reason: "service-stopped" });

        const death = await store.recordHospitalStatusEvent(
          {
            planId: plan.plan.id,
            expectedVersion: plan.plan.version,
            event: { type: "death", recordedAt: clock.now() },
          },
          writeContext(COORDINATOR_A, "death-1"),
        );
        expect(death.ok).toBe(true);
      });

      it("still reads while the service is stopped", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        await store.stopService(
          { reason: "duplicate-send", note: "two sends on 2026-08-19" },
          writeContext(COORDINATOR_A, "stop-2"),
        );
        await expect(store.getPlan(plan.plan.id, { actor: COORDINATOR_A })).resolves.not.toBeNull();
      });

      it("records a view in the access trail that listAuditEvents never produced", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        await store.recordAccess({
          actorId: COORDINATOR_A.id,
          actorRoles: ["coordinator"],
          teamId: COORDINATOR_A.teamId,
          kind: "view",
          objectType: "plan",
          objectId: plan.plan.id,
          outcome: "allowed",
        });
        const trail = await store.listAccessTrail({ limit: 50, offset: 0 }, { actor: AUDITOR_A });
        expect(trail.map((event) => event.action)).toContain("access:view:plan");
      });

      it("resolves a dispatch discrepancy without ever resending (Ruling 2)", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        const contact = (await store.listSendableContacts(plan.plan.id, { actor: COORDINATOR_A }))[0];
        const dispatched = unwrap(
          await store.startContactDispatch(
            { planId: plan.plan.id, contactId: contact.contact.id, expectedContactVersion: contact.contact.version },
            writeContext(DISPATCHER_A, "dispatch-1"),
          ),
        );

        const resolved = await store.resolveDispatchDiscrepancy(
          { contactId: contact.contact.id, attempt: 1, resolution: "unresolvedNoResend", note: "provider outage" },
          writeContext(COORDINATOR_A, "resolve-1"),
        );
        if (!resolved.ok) throw new Error(resolved.reason);
        expect(resolved.value.discrepancyResolution).toBe("unresolvedNoResend");

        // The contact itself is untouched: same state, same version. There is no method anywhere in
        // this contract that re-dispatches a contact whose status is uncertain -- an
        // `unresolvedNoResend` outcome must never quietly turn into a guessed resend.
        const after = (await store.listContacts(plan.plan.id, { actor: COORDINATOR_A })).find(
          (stored) => stored.contact.id === contact.contact.id,
        );
        expect(after?.contact.state).toBe(dispatched.contact.state);
        expect(after?.contact.version).toBe(dispatched.contact.version);

        // No second dispatch attempt row was ever opened for this contact.
        const dispatches = await store.listDispatches(
          { fromIso: "2026-01-01T00:00:00.000Z", toIso: "2026-12-31T23:59:59.999Z" },
          { actor: COORDINATOR_A },
        );
        expect(dispatches.filter((record) => record.contactId === contact.contact.id)).toHaveLength(1);
      });

      it("keeps the reassignment history readable after a reassignment", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        await store.applyAssignment(
          { planId: plan.plan.id, action: { type: "claim", actorId: COORDINATOR_A.id } },
          writeContext(COORDINATOR_A, "claim-1"),
        );
        await store.applyAssignment(
          {
            planId: plan.plan.id,
            action: { type: "reassign", toActorId: actorId("ACTOR-NEW"), reason: "annual leave" },
          },
          writeContext(TEAM_LEAD_A, "reassign-1"),
        );
        const assignment = await store.getAssignment(plan.plan.id, { actor: COORDINATOR_A });
        expect(assignment?.reassignmentHistory).toHaveLength(1);
      });
    });

    // -------------------------------------------------------------------------
    // Ruling 3: the safety stop is one record for the whole service, never one per team.
    // -------------------------------------------------------------------------
    describe("service safety stop is a service-wide singleton (Ruling 3)", () => {
      it("makes a stop raised by team A block dispatch for a plan owned by team B", async () => {
        const store = await newStore();
        const planA = await createActivePlan(store, { actor: COORDINATOR_A });
        const planB = await createActivePlan(store, { actor: COORDINATOR_B });

        await store.stopService(
          { reason: "duplicate-send", note: "Team A saw a duplicate send this morning." },
          writeContext(COORDINATOR_A, "stop-cross-team"),
        );

        const pausedB = await store.pausePlan(
          { planId: planB.plan.id, expectedVersion: planB.plan.version },
          writeContext(COORDINATOR_B, "pause-b"),
        );
        expect(pausedB).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.serviceStopped });

        const pausedA = await store.pausePlan(
          { planId: planA.plan.id, expectedVersion: planA.plan.version },
          writeContext(COORDINATOR_A, "pause-a"),
        );
        expect(pausedA).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.serviceStopped });
      });

      it("returns the exact same record to every actor of every team -- one record, not one per team", async () => {
        const store = await newStore();
        await createActivePlan(store, { actor: COORDINATOR_A });
        await createActivePlan(store, { actor: COORDINATOR_B });
        await store.stopService(
          { reason: "audit-integrity-loss", note: "trail gap found" },
          writeContext(COORDINATOR_A, "stop-3"),
        );

        const seenByTeamA = await store.getServiceState({ actor: COORDINATOR_A });
        const seenByTeamB = await store.getServiceState({ actor: COORDINATOR_B });
        expect(seenByTeamA).toEqual(seenByTeamB);
        expect(seenByTeamA.stopped).toBe(true);
      });

      it("also gates a new write method beyond pausePlan, proving the gate is not method-specific", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        await store.stopService(
          { reason: "unauthorised-content", note: "unapproved wording sent" },
          writeContext(COORDINATOR_A, "stop-4"),
        );

        const claim = await store.applyAssignment(
          { planId: plan.plan.id, action: { type: "claim", actorId: COORDINATOR_A.id } },
          writeContext(COORDINATOR_A, "claim-blocked"),
        );
        expect(claim).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.serviceStopped });

        const prefs = await store.saveNotificationPreferences(
          { actorId: COORDINATOR_A.id, optedIn: ["serviceSafetyStop"] },
          writeContext(COORDINATOR_A, "prefs-blocked"),
        );
        expect(prefs).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.serviceStopped });
      });
    });

    // -------------------------------------------------------------------------
    // Service safety stop lifecycle: stopService / approveServiceRestart refusals.
    // -------------------------------------------------------------------------
    describe("stopService and approveServiceRestart", () => {
      it("refuses a second stop while one is already recorded", async () => {
        const store = await newStore();
        const first = await store.stopService(
          { reason: "wrong-recipient", note: "first incident" },
          writeContext(COORDINATOR_A, "s1"),
        );
        expect(first.ok).toBe(true);

        const second = await store.stopService(
          { reason: "duplicate-send", note: "second incident" },
          writeContext(TEAM_LEAD_A, "s2"),
        );
        expect(second).toEqual({ ok: false, reason: "service-already-stopped" });
      });

      it("refuses a blank note on the first stop", async () => {
        const store = await newStore();
        const stop = await store.stopService(
          { reason: "wrong-recipient", note: "  " },
          writeContext(COORDINATOR_A, "s-blank"),
        );
        expect(stop).toEqual({ ok: false, reason: "service-stop-note-required" });
      });

      it("refuses stopService for an actor without triggerServiceSafetyStop (the dispatcher)", async () => {
        const store = await newStore();
        const stop = await store.stopService(
          { reason: "wrong-recipient", note: "n/a" },
          writeContext(DISPATCHER_A, "s-dispatcher"),
        );
        expect(stop).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });
      });

      it("refuses an approval from a person governance configuration does not name for that seat (owner decision)", async () => {
        const store = await newStore();
        unwrap(
          await store.stopService(
            { reason: "wrong-recipient", note: "incident" },
            writeContext(COORDINATOR_A, "seat-stop"),
          ),
        );

        // SECOND_TEAM_LEAD_A holds `approveServiceRestart` through the team-lead role, but is named
        // only for the clinical programme lead seat -- not the incident lead's.
        const wrongSeat = await store.approveServiceRestart(
          { role: "incidentLead" },
          writeContext(SECOND_TEAM_LEAD_A, "seat-wrong"),
        );
        expect(wrongSeat).toEqual({ ok: false, reason: "restart-approval-seat-not-held" });

        // Nothing was recorded: the rightful holder can still take the seat.
        const rightful = unwrap(
          await store.approveServiceRestart({ role: "incidentLead" }, writeContext(TEAM_LEAD_A, "seat-right")),
        );
        expect(rightful.stopped).toBe(true);
        expect(rightful.stopped && rightful.restartApprovals.map((approval) => approval.actorId)).toEqual([
          TEAM_LEAD_A.id,
        ]);
      });

      it("refuses every approval when no seat holders are configured, so the stop holds", async () => {
        clockInstant = NOW;
        const store = await factory(clock, undefined);
        unwrap(
          await store.stopService(
            { reason: "wrong-recipient", note: "incident" },
            writeContext(COORDINATOR_A, "noseat-stop"),
          ),
        );
        const refused = await store.approveServiceRestart(
          { role: "incidentLead" },
          writeContext(TEAM_LEAD_A, "noseat-approve"),
        );
        expect(refused).toEqual({ ok: false, reason: "restart-approval-seat-not-held" });
        expect((await store.getServiceState({ actor: TEAM_LEAD_A })).stopped).toBe(true);
      });

      it("requires all three distinct roles from three distinct actors before restarting, then restarts on the third", async () => {
        const store = await newStore();
        await store.stopService(
          { reason: "wrong-recipient", note: "incident" },
          writeContext(COORDINATOR_A, "s-restart"),
        );

        const first = unwrap(
          await store.approveServiceRestart({ role: "incidentLead" }, writeContext(TEAM_LEAD_A, "approve-1")),
        );
        expect(first.stopped).toBe(true);

        // Same role again is refused, even from a different actor.
        const sameRole = await store.approveServiceRestart(
          { role: "incidentLead" },
          writeContext(PROGRAMME_LEAD_A, "approve-same-role"),
        );
        expect(sameRole).toEqual({ ok: false, reason: "restart-approval-role-already-recorded" });

        // The same actor cannot supply a second approval under a different role.
        const sameActor = await store.approveServiceRestart(
          { role: "privacySecurityOwner" },
          writeContext(TEAM_LEAD_A, "approve-same-actor"),
        );
        expect(sameActor).toEqual({ ok: false, reason: "restart-approval-actor-already-recorded" });

        const second = unwrap(
          await store.approveServiceRestart(
            { role: "privacySecurityOwner" },
            writeContext(PROGRAMME_LEAD_A, "approve-2"),
          ),
        );
        expect(second.stopped).toBe(true);

        const third = unwrap(
          await store.approveServiceRestart(
            { role: "clinicalProgrammeLead" },
            writeContext(SECOND_TEAM_LEAD_A, "approve-3"),
          ),
        );
        expect(third.stopped).toBe(false);

        // Once running again, an ordinary write is no longer blocked.
        const plan = await createActivePlan(store);
        const paused = await store.pausePlan(
          { planId: plan.plan.id, expectedVersion: plan.plan.version },
          writeContext(COORDINATOR_A, "pause-after-restart"),
        );
        expect(paused.ok).toBe(true);
      });

      it("hands a restart approver the stop it is approving, and never the incident note", async () => {
        // Ruling 65. Restart approvals are service-wide by design, so a TEAM-SOUTH team lead
        // legitimately approves a TEAM-NORTH incident -- and the first two approvals leave the
        // service STOPPED, so this write used to hand back the whole live record, note and all.
        // That value is also what both stores persist as the replay result, under the APPROVING
        // team's id, in a table scoped by row-level security to that team. Narrowing it at the API
        // boundary could not reach that copy; narrowing what the method returns removes it from
        // both places by construction.
        const store = await newStore();
        const note = "Jordan Nguyen was sent the same message twice on 491 570 156";
        unwrap(await store.stopService({ reason: "duplicate-send", note }, writeContext(COORDINATOR_A, "narrow-stop")));

        // Positive control: the note really was recorded and really is held, so an absence below is
        // the return value being narrow rather than the incident being empty.
        const state = await store.getServiceState({ actor: COORDINATOR_A });
        if (!state.stopped) throw new Error("expected a stopped service");
        expect(state.note).toBe(note);

        const approved = unwrap(
          await store.approveServiceRestart({ role: "incidentLead" }, writeContext(TEAM_LEAD_B, "narrow-approve")),
        );

        // The approver still gets what an approval is FOR: the stop still standing, what kind of
        // failure it was, and their own approval now recorded against it.
        if (!approved.stopped) throw new Error("expected the service to still be stopped");
        expect(approved.reason).toBe("duplicate-send");
        expect(approved.restartApprovals.map((approval) => approval.role)).toEqual(["incidentLead"]);
        expect(approved.restartApprovals[0].actorId).toBe(TEAM_LEAD_B.id);

        // ...and nothing that names the patient, the responder, or the reporting team.
        expect(approved).not.toHaveProperty("note");
        expect(approved).not.toHaveProperty("stoppedBy");
        expect(approved).not.toHaveProperty("reportedByTeamId");
        expect(JSON.stringify(approved)).not.toContain("Jordan");
        expect(JSON.stringify(approved)).not.toContain("491 570 156");

        // A replay returns the ORIGINAL answer, which is now the narrow one -- so the replay is
        // truthful and clean at the same time, rather than one at the cost of the other.
        const replay = unwrap(
          await store.approveServiceRestart({ role: "incidentLead" }, writeContext(TEAM_LEAD_B, "narrow-approve")),
        );
        expect(replay).toEqual(approved);
      });

      it("narrows the approval reply on the restart too, where there is no incident left to name", async () => {
        // The approval that COMPLETES the restart returns a running service. That variant never
        // carried the note, but it did carry `reportedByTeamId`, and the narrowed shape has to hold
        // for both variants or the discriminated union would leak through one arm.
        const store = await newStore();
        unwrap(
          await store.stopService(
            { reason: "wrong-recipient", note: "Jordan Nguyen's number was reached in error" },
            writeContext(COORDINATOR_A, "narrow-restart-stop"),
          ),
        );
        unwrap(
          await store.approveServiceRestart({ role: "incidentLead" }, writeContext(TEAM_LEAD_A, "narrow-restart-1")),
        );
        unwrap(
          await store.approveServiceRestart(
            { role: "privacySecurityOwner" },
            writeContext(PROGRAMME_LEAD_A, "narrow-restart-2"),
          ),
        );
        const restarted = unwrap(
          await store.approveServiceRestart(
            { role: "clinicalProgrammeLead" },
            writeContext(TEAM_LEAD_B, "narrow-restart-3"),
          ),
        );

        expect(restarted).toEqual({ stopped: false });
        expect(JSON.stringify(restarted)).not.toContain("Jordan");
      });

      it("reads restart approvals for the CURRENT incident only, so a new stop starts at zero", async () => {
        const store = await newStore();
        await store.stopService(
          { reason: "wrong-recipient", note: "first incident" },
          writeContext(COORDINATOR_A, "two-stop-1"),
        );
        unwrap(await store.approveServiceRestart({ role: "incidentLead" }, writeContext(TEAM_LEAD_A, "two-approve-1")));
        unwrap(
          await store.approveServiceRestart(
            { role: "privacySecurityOwner" },
            writeContext(PROGRAMME_LEAD_A, "two-approve-2"),
          ),
        );
        const restarted = unwrap(
          await store.approveServiceRestart(
            { role: "clinicalProgrammeLead" },
            writeContext(SECOND_TEAM_LEAD_A, "two-approve-3"),
          ),
        );
        expect(restarted.stopped).toBe(false);

        unwrap(
          await store.stopService(
            { reason: "duplicate-send", note: "second, unrelated incident" },
            writeContext(COORDINATOR_A, "two-stop-2"),
          ),
        );

        // A brand-new live incident that read the PREVIOUS incident's approvals would present
        // itself as already three-person approved -- a zero-approval restart.
        const state = await store.getServiceState({ actor: COORDINATOR_A });
        if (!state.stopped) throw new Error("expected a stopped service");
        expect(state.restartApprovals).toEqual([]);
        expect(state.reason).toBe("duplicate-send");
        expect(state.note).toBe("second, unrelated incident");
      });

      it("persists the instant it handed back, not a second reading of the clock", async () => {
        // A clock that never returns the same instant twice. Every other test in this file uses a
        // FIXED clock, which is exactly why none of them can see a store that reads the clock once
        // for the domain and again for the row it writes.
        const ticking = advancingClock(NOW);
        const control = { first: ticking.now().getTime(), second: ticking.now().getTime() };
        expect(control.second).toBeGreaterThan(control.first);

        const store = await factory(ticking, { restartApprovalSeats: SEATS });
        const stopped = unwrap(
          await store.stopService(
            { reason: "wrong-recipient", note: "a message reached a number nobody recognised" },
            writeContext(COORDINATOR_A, "tick-stop"),
          ),
        );
        if (!stopped.stopped) throw new Error("expected a stopped service");

        // The stop is the write this matters most for: its record is enforced immutable, so an
        // instant recorded even milliseconds away from the one the caller was handed can never be
        // corrected afterwards.
        const readBack = await store.getServiceState({ actor: COORDINATOR_A });
        if (!readBack.stopped) throw new Error("expected a stopped service");
        expect(readBack.stoppedAt).toBe(stopped.stoppedAt);

        const approved = unwrap(
          await store.approveServiceRestart({ role: "incidentLead" }, writeContext(TEAM_LEAD_A, "tick-approve")),
        );
        if (!approved.stopped) throw new Error("expected the service to still be stopped");

        const afterApproval = await store.getServiceState({ actor: COORDINATOR_A });
        if (!afterApproval.stopped) throw new Error("expected a stopped service");
        expect(afterApproval.restartApprovals.map((approval) => approval.approvedAt)).toEqual(
          approved.restartApprovals.map((approval) => approval.approvedAt),
        );
      });

      it("lets exactly one of two simultaneous first stops win, refusing the other by name", async () => {
        // The FIRST-EVER stop is the one race a row lock cannot cover: there is no singleton row to
        // take `for update` on until one of these two writes creates it. Without a guard the loser's
        // write overwrites the winner's reason, actor and incident -- and "the first record of an
        // incident is permanent" is the property ../service-state exists to hold.
        const store = await newStore();

        // This is the BEHAVIOURAL half of the proof, and it is here because both stores owe the
        // same answer. It cannot show that the race window was actually ENTERED: if scheduling ever
        // serialised these two writes the loser would be refused by the domain check instead of by
        // the store's guard, and this test would still pass. That reachability control needs the
        // incident-history table, which only one store has, so it lives beside this in
        // tests/caring-contacts-postgres-repository.test.ts. Neither half is redundant -- do not
        // delete one thinking the other covers it.
        //
        // The two responders are from DIFFERENT teams, and that is what makes this a race rather
        // than a queue. Every write registers its own team first, so two callers from ONE team
        // serialise on that row and never reach the window at all; two teams do not touch each
        // other's row and arrive together. It is also the truthful shape: the stop is service-wide,
        // so two teams finding two different incidents at once is exactly how this happens.
        await Promise.all([
          store.getServiceState({ actor: COORDINATOR_A }),
          store.getServiceState({ actor: COORDINATOR_B }),
        ]);

        const [first, second] = await Promise.all([
          store.stopService(
            { reason: "wrong-recipient", note: "the first responder's own account" },
            writeContext(COORDINATOR_A, "race-stop-a"),
          ),
          store.stopService(
            { reason: "duplicate-send", note: "a later account of something else entirely" },
            writeContext(COORDINATOR_B, "race-stop-b"),
          ),
        ]);

        const accepted = [first, second].filter((result) => result.ok);
        const refused = [first, second].filter((result) => !result.ok);
        expect(accepted).toHaveLength(1);
        expect(refused).toEqual([{ ok: false, reason: "service-already-stopped" }]);

        const winner = accepted[0];
        if (!winner.ok || !winner.value.stopped) throw new Error("expected an accepted stop");

        const state = await store.getServiceState({ actor: AUDITOR_A });
        if (!state.stopped) throw new Error("expected a stopped service");
        expect(state.reason).toBe(winner.value.reason);
        expect(state.note).toBe(winner.value.note);
        expect(state.stoppedBy).toBe(winner.value.stoppedBy);
      });

      it("refuses a restart approval while the service is running", async () => {
        const store = await newStore();
        const approval = await store.approveServiceRestart(
          { role: "incidentLead" },
          writeContext(TEAM_LEAD_A, "approve-not-stopped"),
        );
        expect(approval).toEqual({ ok: false, reason: "service-not-stopped" });
      });

      it("refuses approveServiceRestart for an actor without the grant (coordinator)", async () => {
        const store = await newStore();
        await store.stopService({ reason: "wrong-recipient", note: "incident" }, writeContext(COORDINATOR_A, "s-perm"));
        const approval = await store.approveServiceRestart(
          { role: "incidentLead" },
          writeContext(COORDINATOR_A, "approve-perm"),
        );
        expect(approval).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });
      });

      it("does not poison the idempotency key with a service-stopped refusal -- the same retry succeeds after the restart", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        await store.stopService(
          { reason: "duplicate-send", note: "a duplicate send was seen this morning" },
          writeContext(COORDINATOR_A, "s-poison"),
        );

        const refused = await store.pausePlan(
          { planId: plan.plan.id, expectedVersion: plan.plan.version },
          writeContext(COORDINATOR_A, "pause-retry"),
        );
        expect(refused).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.serviceStopped });

        unwrap(
          await store.approveServiceRestart({ role: "incidentLead" }, writeContext(TEAM_LEAD_A, "poison-approve-1")),
        );
        unwrap(
          await store.approveServiceRestart(
            { role: "privacySecurityOwner" },
            writeContext(PROGRAMME_LEAD_A, "poison-approve-2"),
          ),
        );
        const restarted = unwrap(
          await store.approveServiceRestart(
            { role: "clinicalProgrammeLead" },
            writeContext(SECOND_TEAM_LEAD_A, "poison-approve-3"),
          ),
        );
        expect(restarted.stopped).toBe(false);

        // The SAME key as the refused attempt. Idempotency keys are stable across retries, so a
        // remembered service-stop refusal would refuse this write forever with a reason that is no
        // longer true -- and the resume path is the entire point of a safety stop.
        const retried = await store.pausePlan(
          { planId: plan.plan.id, expectedVersion: plan.plan.version },
          writeContext(COORDINATOR_A, "pause-retry"),
        );
        expect(retried.ok).toBe(true);
      });

      it("still replays every OTHER refusal against the same key, even once its cause is gone", async () => {
        const store = await newStore();
        const late = planId("EXT-PLAN-LATE");

        const refused = await store.markRetentionCleared({ planId: late }, writeContext(COORDINATOR_A, "late-key"));
        expect(refused).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.notFound });

        unwrap(
          await store.createReferral(
            { referralId: referralId("EXT-REFERRAL-LATE"), patientId: patientId("EXT-PATIENT-LATE") },
            writeContext(COORDINATOR_A, "late-referral"),
          ),
        );
        unwrap(
          await store.savePathwayVersion(
            { version: draftPathwayVersion(COORDINATOR_A, "EXT-PATHWAY-LATE") },
            writeContext(COORDINATOR_A, "late-pathway"),
          ),
        );
        unwrap(
          await store.createPlan(
            {
              planId: late,
              referralId: referralId("EXT-REFERRAL-LATE"),
              patientId: patientId("EXT-PATIENT-LATE"),
              pathwayVersionId: pathwayVersionId("EXT-PATHWAY-LATE"),
              dischargeAt: DISCHARGE_AT,
              sendingPreference: "morning",
              patientDetail: PATIENT_DETAIL,
              assurances: [...ASSURANCES],
            },
            writeContext(COORDINATOR_A, "late-create"),
          ),
        );

        // The plan exists now, but this key already has an answer: replaying it returns the ORIGINAL
        // refusal rather than recomputing one. Only `service-stopped` is exempt from that.
        const replay = await store.markRetentionCleared({ planId: late }, writeContext(COORDINATOR_A, "late-key"));
        expect(replay).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.notFound });
      });
    });

    // -------------------------------------------------------------------------
    // Referrals
    // -------------------------------------------------------------------------
    describe("referrals", () => {
      it("creates a referral, refuses a duplicate id, and refuses a role without the grant", async () => {
        const store = await newStore();
        const created = unwrap(
          await store.createReferral(
            { referralId: referralId("EXT-REF-1"), patientId: patientId("EXT-PAT-1") },
            writeContext(COORDINATOR_A, "cr-1"),
          ),
        );
        expect(created.state).toBe("awaitingHandover");

        const duplicate = await store.createReferral(
          { referralId: referralId("EXT-REF-1"), patientId: patientId("EXT-PAT-2") },
          writeContext(COORDINATOR_A, "cr-2"),
        );
        expect(duplicate).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.referralAlreadyExists });

        const denied = await store.createReferral(
          { referralId: referralId("EXT-REF-2"), patientId: patientId("EXT-PAT-3") },
          writeContext(AUDITOR_A, "cr-3"),
        );
        expect(denied).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });
      });

      it("refuses a second referral while the patient's accepted referral still has no plan", async () => {
        const store = await newStore();
        unwrap(
          await store.createReferral(
            { referralId: referralId("EXT-REF-DUP-1"), patientId: patientId("EXT-PAT-DUP") },
            writeContext(COORDINATOR_A, "dup-cr-1"),
          ),
        );
        // Awaiting handover only: not yet an accepted referral, so a second referral is not refused.
        unwrap(
          await store.createReferral(
            { referralId: referralId("EXT-REF-DUP-2"), patientId: patientId("EXT-PAT-DUP") },
            writeContext(COORDINATOR_A, "dup-cr-2"),
          ),
        );
        unwrap(
          await store.transitionReferral(
            {
              referralId: referralId("EXT-REF-DUP-1"),
              action: { type: "accept", pathwayVersionId: pathwayVersionId("EXT-PATHWAY-SEED") },
            },
            writeContext(COORDINATOR_A, "dup-tr-1"),
          ),
        );

        const third = await store.createReferral(
          { referralId: referralId("EXT-REF-DUP-3"), patientId: patientId("EXT-PAT-DUP") },
          writeContext(COORDINATOR_A, "dup-cr-3"),
        );
        expect(third).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.referralAlreadyAcceptedForPatient });

        // Same idempotency key as the original write: a replay, never a refusal.
        const replay = await store.createReferral(
          { referralId: referralId("EXT-REF-DUP-1"), patientId: patientId("EXT-PAT-DUP") },
          writeContext(COORDINATOR_A, "dup-cr-1"),
        );
        expect(replay.ok).toBe(true);

        const otherPatient = await store.createReferral(
          { referralId: referralId("EXT-REF-DUP-4"), patientId: patientId("EXT-PAT-OTHER") },
          writeContext(COORDINATOR_A, "dup-cr-4"),
        );
        expect(otherPatient.ok).toBe(true);
      });

      it("refuses a new referral while the patient's plan has not ended, and allows one after", async () => {
        const { store } = await storeWithActivePlan();

        const refused = await store.createReferral(
          { referralId: referralId("EXT-REF-PLAN-1"), patientId: PATIENT_ID },
          writeContext(COORDINATOR_A, "plan-cr-1"),
        );
        expect(refused).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.duplicateActivePlan });

        unwrap(
          await store.withdrawPlan(
            { planId: PLAN_ID, expectedVersion: 2, origin: "patient" },
            writeContext(COORDINATOR_A, "plan-withdraw"),
          ),
        );
        const allowed = await store.createReferral(
          { referralId: referralId("EXT-REF-PLAN-2"), patientId: PATIENT_ID },
          writeContext(COORDINATOR_A, "plan-cr-2"),
        );
        expect(allowed.ok).toBe(true);
      });

      it("accepts a referral onto a pathway version, and refuses an unknown referral id", async () => {
        const store = await newStore();
        await store.createReferral(
          { referralId: referralId("EXT-REF-3"), patientId: patientId("EXT-PAT-4") },
          writeContext(COORDINATOR_A, "cr-4"),
        );

        const accepted = unwrap(
          await store.transitionReferral(
            {
              referralId: referralId("EXT-REF-3"),
              action: { type: "accept", pathwayVersionId: pathwayVersionId("EXT-PATHWAY-SEED") },
            },
            writeContext(COORDINATOR_A, "tr-1"),
          ),
        );
        expect(accepted.state).toBe("accepted");
        expect(accepted.pathwayVersionId).toBe(pathwayVersionId("EXT-PATHWAY-SEED"));

        const missing = await store.transitionReferral(
          { referralId: referralId("EXT-REF-UNKNOWN"), action: { type: "decline", reason: "not eligible" } },
          writeContext(COORDINATOR_A, "tr-2"),
        );
        expect(missing).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.notFound });
      });

      it("refuses re-accepting a referral already accepted, and a blank decline reason", async () => {
        const store = await newStore();
        await store.createReferral(
          { referralId: referralId("EXT-REF-5"), patientId: patientId("EXT-PAT-5") },
          writeContext(COORDINATOR_A, "cr-5"),
        );
        await store.transitionReferral(
          {
            referralId: referralId("EXT-REF-5"),
            action: { type: "accept", pathwayVersionId: pathwayVersionId("EXT-PATHWAY-SEED") },
          },
          writeContext(COORDINATOR_A, "tr-3"),
        );

        const reaccept = await store.transitionReferral(
          {
            referralId: referralId("EXT-REF-5"),
            action: { type: "accept", pathwayVersionId: pathwayVersionId("EXT-PATHWAY-SEED") },
          },
          writeContext(COORDINATOR_A, "tr-4"),
        );
        expect(reaccept).toEqual({ ok: false, reason: "referral-not-awaiting-handover" });

        await store.createReferral(
          { referralId: referralId("EXT-REF-6"), patientId: patientId("EXT-PAT-6") },
          writeContext(COORDINATOR_A, "cr-6"),
        );
        const blankDecline = await store.transitionReferral(
          { referralId: referralId("EXT-REF-6"), action: { type: "decline", reason: "  " } },
          writeContext(COORDINATOR_A, "tr-5"),
        );
        expect(blankDecline).toEqual({ ok: false, reason: "referral-reason-required" });
      });

      it("scopes listReferrals to the actor's own team and the viewReferral grant", async () => {
        const store = await newStore();
        await store.createReferral(
          { referralId: referralId("EXT-REF-7"), patientId: patientId("EXT-PAT-7") },
          writeContext(COORDINATOR_A, "cr-7"),
        );

        expect(await store.listReferrals({ actor: COORDINATOR_A })).toHaveLength(1);
        expect(await store.listReferrals({ actor: COORDINATOR_B })).toEqual([]);
        expect(await store.listReferrals({ actor: AUDITOR_A })).toEqual([]);
      });
    });

    // -------------------------------------------------------------------------
    // Pathway versions
    // -------------------------------------------------------------------------
    describe("pathway versions", () => {
      it("saves a version, refuses a duplicate id, and refuses a role without authorPathwayVersion", async () => {
        const store = await newStore();
        const version = draftPathwayVersion();
        const saved = unwrap(await store.savePathwayVersion({ version }, writeContext(COORDINATOR_A, "sv-1")));
        expect(saved.state).toBe("draft");

        const duplicate = await store.savePathwayVersion({ version }, writeContext(COORDINATOR_A, "sv-2"));
        expect(duplicate).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.pathwayVersionAlreadyExists });

        const denied = await store.savePathwayVersion(
          { version: draftPathwayVersion() },
          writeContext(AUDITOR_A, "sv-3"),
        );
        expect(denied).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });
      });

      it("carries a version through submit, dual approval, publish and retirement", async () => {
        const store = await newStore();
        const version = draftPathwayVersion(TEAM_LEAD_A);
        await store.savePathwayVersion({ version }, writeContext(TEAM_LEAD_A, "sv-4"));

        const submitted = unwrap(
          await store.transitionPathwayVersion(
            { pathwayVersionId: version.id, action: { type: "submitForReview" } },
            writeContext(TEAM_LEAD_A, "pv-1"),
          ),
        );
        expect(submitted.state).toBe("inReview");

        // The author holds approvePathwayVersion too, but may not approve their own version.
        const selfApproval = await store.transitionPathwayVersion(
          {
            pathwayVersionId: version.id,
            action: { type: "approve", role: "clinicalProgrammeLead", actorId: TEAM_LEAD_A.id },
          },
          writeContext(TEAM_LEAD_A, "pv-2"),
        );
        expect(selfApproval).toEqual({ ok: false, reason: "self-approval-denied" });

        const firstApproval = unwrap(
          await store.transitionPathwayVersion(
            {
              pathwayVersionId: version.id,
              action: { type: "approve", role: "clinicalProgrammeLead", actorId: PROGRAMME_LEAD_A.id },
            },
            writeContext(PROGRAMME_LEAD_A, "pv-3"),
          ),
        );
        expect(firstApproval.state).toBe("inReview");

        const secondApproval = unwrap(
          await store.transitionPathwayVersion(
            {
              pathwayVersionId: version.id,
              action: {
                type: "approve",
                role: "livedExperienceRepresentative",
                actorId: LIVED_EXPERIENCE_A.id,
              },
            },
            writeContext(LIVED_EXPERIENCE_A, "pv-4"),
          ),
        );
        expect(secondApproval.state).toBe("approved");

        // publishPathwayVersion is granted to the clinical programme lead only.
        const publishDenied = await store.transitionPathwayVersion(
          { pathwayVersionId: version.id, action: { type: "publish", actorId: TEAM_LEAD_A.id } },
          writeContext(TEAM_LEAD_A, "pv-5"),
        );
        expect(publishDenied).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });

        const published = unwrap(
          await store.transitionPathwayVersion(
            { pathwayVersionId: version.id, action: { type: "publish", actorId: PROGRAMME_LEAD_A.id } },
            writeContext(PROGRAMME_LEAD_A, "pv-6"),
          ),
        );
        expect(published.publishedAt).toMatch(/\+08:00$/);

        const retired = unwrap(
          await store.transitionPathwayVersion(
            { pathwayVersionId: version.id, action: { type: "retire", urgency: "routine" } },
            writeContext(TEAM_LEAD_A, "pv-7"),
          ),
        );
        expect(retired.state).toBe("retired");
      });

      // Dual approval means one clinical programme lead AND one lived-experience representative.
      // The seat travels in the request, so without this a team lead -- who holds
      // approvePathwayVersion -- could take the lived-experience seat, and two team leads could
      // approve a version no lived-experience representative ever saw. And the approval must be
      // recorded in the name of whoever is actually acting.
      it("refuses an approval in a seat the acting person does not hold, or in someone else's name", async () => {
        const store = await newStore();
        const version = draftPathwayVersion(COORDINATOR_A);
        await store.savePathwayVersion({ version }, writeContext(COORDINATOR_A, "sv-seat"));
        unwrap(
          await store.transitionPathwayVersion(
            { pathwayVersionId: version.id, action: { type: "submitForReview" } },
            writeContext(COORDINATOR_A, "pv-seat-1"),
          ),
        );

        const wrongSeat = await store.transitionPathwayVersion(
          {
            pathwayVersionId: version.id,
            action: { type: "approve", role: "livedExperienceRepresentative", actorId: TEAM_LEAD_A.id },
          },
          writeContext(TEAM_LEAD_A, "pv-seat-2"),
        );
        expect(wrongSeat).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.approvalSeatNotHeld });

        const inAnotherName = await store.transitionPathwayVersion(
          {
            pathwayVersionId: version.id,
            action: { type: "approve", role: "livedExperienceRepresentative", actorId: LIVED_EXPERIENCE_A.id },
          },
          writeContext(PROGRAMME_LEAD_A, "pv-seat-3"),
        );
        expect(inAnotherName).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });

        const fetched = await store.getPathwayVersion(version.id, { actor: COORDINATOR_A });
        expect(fetched?.approvals).toEqual([]);
      });

      it("refuses transitioning an unknown pathway version id and an approve made before submission", async () => {
        const store = await newStore();
        const missing = await store.transitionPathwayVersion(
          { pathwayVersionId: pathwayVersionId("EXT-PATHWAY-MISSING"), action: { type: "submitForReview" } },
          writeContext(COORDINATOR_A, "pv-8"),
        );
        expect(missing).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.notFound });

        const version = draftPathwayVersion();
        await store.savePathwayVersion({ version }, writeContext(COORDINATOR_A, "sv-5"));
        const earlyApprove = await store.transitionPathwayVersion(
          {
            pathwayVersionId: version.id,
            action: { type: "approve", role: "clinicalProgrammeLead", actorId: PROGRAMME_LEAD_A.id },
          },
          writeContext(PROGRAMME_LEAD_A, "pv-9"),
        );
        expect(earlyApprove).toEqual({ ok: false, reason: "pathway-not-in-review" });
      });

      it("scopes getPathwayVersion/listPathwayVersions to the team, visible to author or approver roles, not the auditor", async () => {
        const store = await newStore();
        const version = draftPathwayVersion();
        await store.savePathwayVersion({ version }, writeContext(COORDINATOR_A, "sv-6"));

        expect(await store.getPathwayVersion(version.id, { actor: COORDINATOR_A })).not.toBeNull();
        expect(await store.getPathwayVersion(version.id, { actor: PROGRAMME_LEAD_A })).not.toBeNull();
        expect(await store.getPathwayVersion(version.id, { actor: AUDITOR_A })).toBeNull();
        expect(await store.getPathwayVersion(version.id, { actor: COORDINATOR_B })).toBeNull();
        expect(await store.getPathwayVersion(pathwayVersionId("EXT-NOPE"), { actor: COORDINATOR_A })).toBeNull();

        expect(await store.listPathwayVersions({ actor: COORDINATOR_A })).toHaveLength(1);
        expect(await store.listPathwayVersions({ actor: AUDITOR_A })).toEqual([]);
      });

      // ---- Ruling 14: a save persists authored content, never governance. ----
      it("persists authored content only -- state, approvals, authorId and publication are constructed server-side (Ruling 14)", async () => {
        const store = await newStore();
        const forged: PathwayVersion = {
          ...draftPathwayVersion(),
          // Everything one actor holding authorPathwayVersion might try to seed past the governance
          // lifecycle in a single call. `approved` is the state that actually lands the exploit:
          // publication is not a state of its own, so an approved version publishes on a
          // `publishedAt` alone -- see pathway-versions.
          state: "approved",
          authorId: TEAM_LEAD_A.id,
          approvals: [
            { role: "clinicalProgrammeLead", actorId: PROGRAMME_LEAD_A.id, approvedAt: "2026-03-02T11:00:00+08:00" },
            {
              role: "livedExperienceRepresentative",
              actorId: LIVED_EXPERIENCE_A.id,
              approvedAt: "2026-03-02T11:00:00+08:00",
            },
          ],
          publishedAt: "2026-03-02T11:00:00+08:00",
          retiredAt: "2026-03-02T12:00:00+08:00",
          retirementUrgency: "urgentSafety",
        };

        const saved = unwrap(
          await store.savePathwayVersion({ version: forged }, writeContext(COORDINATOR_A, "sv-forged")),
        );
        expect(saved.state).toBe("draft");
        expect(saved.approvals).toEqual([]);
        expect(saved.authorId).toBe(COORDINATOR_A.id);
        expect(saved.publishedAt).toBeNull();
        expect(saved.retiredAt).toBeNull();
        expect(saved.retirementUrgency).toBeNull();
        // The authored content itself is kept verbatim: this write persists content, not governance.
        expect(saved.snapshot).toEqual(forged.snapshot);

        // The stored record says the same, not merely the copy that came back.
        const stored = await store.getPathwayVersion(forged.id, { actor: COORDINATOR_A });
        expect(stored?.state).toBe("draft");
        expect(stored?.approvals).toEqual([]);
        expect(stored?.authorId).toBe(COORDINATOR_A.id);
        expect(stored?.publishedAt).toBeNull();
      });

      it("refuses to publish a version a caller tried to seed as already approved -- dual approval is not bypassable by a save", async () => {
        const store = await newStore();
        const forged: PathwayVersion = {
          ...draftPathwayVersion(),
          state: "approved",
          approvals: [
            { role: "clinicalProgrammeLead", actorId: PROGRAMME_LEAD_A.id, approvedAt: "2026-03-02T11:00:00+08:00" },
            {
              role: "livedExperienceRepresentative",
              actorId: LIVED_EXPERIENCE_A.id,
              approvedAt: "2026-03-02T11:00:00+08:00",
            },
          ],
        };
        unwrap(await store.savePathwayVersion({ version: forged }, writeContext(COORDINATOR_A, "sv-forged-2")));

        const published = await store.transitionPathwayVersion(
          { pathwayVersionId: forged.id, action: { type: "publish", actorId: PROGRAMME_LEAD_A.id } },
          writeContext(PROGRAMME_LEAD_A, "pv-forged-publish"),
        );
        expect(published).toEqual({ ok: false, reason: "pathway-not-approved" });
      });
    });

    // -------------------------------------------------------------------------
    // Assignment
    // -------------------------------------------------------------------------
    describe("assignment", () => {
      it("refuses claiming an already-claimed plan, reassigning an unclaimed one, and a blank reassignment reason", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);

        const reassignUnclaimed = await store.applyAssignment(
          { planId: plan.plan.id, action: { type: "reassign", toActorId: TEAM_LEAD_A.id, reason: "cover" } },
          writeContext(TEAM_LEAD_A, "aa-1"),
        );
        expect(reassignUnclaimed).toEqual({ ok: false, reason: "plan-not-claimed" });

        unwrap(
          await store.applyAssignment(
            { planId: plan.plan.id, action: { type: "claim", actorId: COORDINATOR_A.id } },
            writeContext(COORDINATOR_A, "aa-2"),
          ),
        );

        const reclaim = await store.applyAssignment(
          { planId: plan.plan.id, action: { type: "claim", actorId: TEAM_LEAD_A.id } },
          writeContext(TEAM_LEAD_A, "aa-3"),
        );
        expect(reclaim).toEqual({ ok: false, reason: "plan-already-claimed" });

        const blankReason = await store.applyAssignment(
          { planId: plan.plan.id, action: { type: "reassign", toActorId: TEAM_LEAD_A.id, reason: "  " } },
          writeContext(TEAM_LEAD_A, "aa-4"),
        );
        expect(blankReason).toEqual({ ok: false, reason: "reassignment-reason-required" });
      });

      it("refuses reassignPlan for a role that lacks the grant, and an inverted coverage window", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        await store.applyAssignment(
          { planId: plan.plan.id, action: { type: "claim", actorId: COORDINATOR_A.id } },
          writeContext(COORDINATOR_A, "aa-5"),
        );

        const deniedReassign = await store.applyAssignment(
          { planId: plan.plan.id, action: { type: "reassign", toActorId: TEAM_LEAD_A.id, reason: "leave" } },
          writeContext(COORDINATOR_A, "aa-6"),
        );
        expect(deniedReassign).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });

        const invertedWindow = await store.applyAssignment(
          {
            planId: plan.plan.id,
            action: { type: "startCoverage", actorId: TEAM_LEAD_A.id, from: "2026-03-10", until: "2026-03-05" },
          },
          writeContext(TEAM_LEAD_A, "aa-7"),
        );
        expect(invertedWindow).toEqual({ ok: false, reason: "coverage-window-invalid" });
      });

      it("refuses a coverage window that is not an AWST calendar day, by name in both stores", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        unwrap(
          await store.applyAssignment(
            { planId: plan.plan.id, action: { type: "claim", actorId: COORDINATOR_A.id } },
            writeContext(COORDINATOR_A, "aa-cal-claim"),
          ),
        );

        // A coverage window is an AWST calendar day (YYYY-MM-DD), which is what `effectiveResponder`
        // compares on. The only check the domain used to make was `until > from` -- a LEXICAL string
        // compare, which "cherry" > "banana" satisfies. So this pair was accepted and stored by the
        // in-memory store, where `effectiveResponder` then silently named the wrong person, while
        // the Postgres schema's own `~ '^\d{4}-\d{2}-\d{2}$'` check raised and escaped as a throw.
        // Two stores, two answers, and a throw where this domain's convention is a named refusal.
        const nonsense = await store.applyAssignment(
          {
            planId: plan.plan.id,
            action: { type: "startCoverage", actorId: TEAM_LEAD_A.id, from: "banana", until: "cherry" },
          },
          writeContext(TEAM_LEAD_A, "aa-cal-1"),
        );
        expect(nonsense).toEqual({ ok: false, reason: "coverage-window-not-calendar-day" });

        // A date that LOOKS like a calendar day but is not one. The schema's regular expression
        // accepts this; only the domain predicate rejects it, which is why the rule belongs there.
        const impossibleDay = await store.applyAssignment(
          {
            planId: plan.plan.id,
            action: { type: "startCoverage", actorId: TEAM_LEAD_A.id, from: "2026-02-30", until: "2026-03-05" },
          },
          writeContext(TEAM_LEAD_A, "aa-cal-2"),
        );
        expect(impossibleDay).toEqual({ ok: false, reason: "coverage-window-not-calendar-day" });

        // ...and nothing was stored by either store, so the refusal is a refusal rather than a
        // rejected value that still reached the assignment.
        expect((await store.getAssignment(plan.plan.id, { actor: COORDINATOR_A }))?.coveredBy).toBeNull();
      });

      it("refuses an unknown plan and returns null/unassigned for reads", async () => {
        const store = await newStore();
        const missing = await store.applyAssignment(
          { planId: planId("EXT-PLAN-MISSING"), action: { type: "claim", actorId: COORDINATOR_A.id } },
          writeContext(COORDINATOR_A, "aa-8"),
        );
        expect(missing).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.notFound });

        expect(await store.getAssignment(planId("EXT-PLAN-MISSING"), { actor: COORDINATOR_A })).toBeNull();

        const plan = await createActivePlan(store);
        expect(await store.getAssignment(plan.plan.id, { actor: COORDINATOR_A })).toEqual({
          ownerId: null,
          claimedAt: null,
          coveredBy: null,
          reassignmentHistory: [],
        });
        expect(await store.getAssignment(plan.plan.id, { actor: COORDINATOR_B })).toBeNull();
      });

      it("refuses a claim that names an actor other than the caller, so the ledger and the audit trail cannot disagree", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);

        // The audit event names the caller. If the ledger were allowed to name somebody else, the
        // two records of "who took this work" would contradict each other.
        const impersonated = await store.applyAssignment(
          { planId: plan.plan.id, action: { type: "claim", actorId: TEAM_LEAD_A.id } },
          writeContext(COORDINATOR_A, "claim-impersonate"),
        );
        expect(impersonated).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });
        expect(await store.getAssignment(plan.plan.id, { actor: COORDINATOR_A })).toMatchObject({ ownerId: null });

        const own = unwrap(
          await store.applyAssignment(
            { planId: plan.plan.id, action: { type: "claim", actorId: COORDINATOR_A.id } },
            writeContext(COORDINATOR_A, "claim-own"),
          ),
        );
        expect(own.ownerId).toBe(COORDINATOR_A.id);
      });

      it("still lets coverage and reassignment name a third party, which is the whole point of both", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        unwrap(
          await store.applyAssignment(
            { planId: plan.plan.id, action: { type: "claim", actorId: COORDINATOR_A.id } },
            writeContext(COORDINATOR_A, "third-claim"),
          ),
        );

        const covered = unwrap(
          await store.applyAssignment(
            {
              planId: plan.plan.id,
              action: {
                type: "startCoverage",
                actorId: SECOND_TEAM_LEAD_A.id,
                from: "2026-03-03",
                until: "2026-03-10",
              },
            },
            writeContext(TEAM_LEAD_A, "third-cover"),
          ),
        );
        expect(covered.coveredBy?.actorId).toBe(SECOND_TEAM_LEAD_A.id);

        const reassigned = unwrap(
          await store.applyAssignment(
            {
              planId: plan.plan.id,
              action: { type: "reassign", toActorId: actorId("ACTOR-COVER"), reason: "annual leave" },
            },
            writeContext(TEAM_LEAD_A, "third-reassign"),
          ),
        );
        expect(reassigned.ownerId).toBe(actorId("ACTOR-COVER"));
      });
    });

    // -------------------------------------------------------------------------
    // Reads must not hand out a live internal reference: a caller holding one could rewrite plan
    // ownership or a live incident's account in place, with no version bump and no audit event.
    // -------------------------------------------------------------------------
    describe("reads hand back something a caller cannot rewrite in place", () => {
      it("returns a copy from getAssignment, so plan ownership cannot be rewritten without a write", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        unwrap(
          await store.applyAssignment(
            { planId: plan.plan.id, action: { type: "claim", actorId: COORDINATOR_A.id } },
            writeContext(COORDINATOR_A, "copy-claim"),
          ),
        );
        unwrap(
          await store.applyAssignment(
            {
              planId: plan.plan.id,
              action: {
                type: "startCoverage",
                actorId: SECOND_TEAM_LEAD_A.id,
                from: "2026-03-03",
                until: "2026-03-10",
              },
            },
            writeContext(TEAM_LEAD_A, "copy-cover"),
          ),
        );

        const first = await store.getAssignment(plan.plan.id, { actor: COORDINATOR_A });
        if (first === null) throw new Error("expected an assignment");
        first.ownerId = actorId("ACTOR-IMPOSTER");
        first.claimedAt = "1970-01-01T08:00:00+08:00";
        if (first.coveredBy !== null) first.coveredBy.actorId = actorId("ACTOR-IMPOSTER");

        const second = await store.getAssignment(plan.plan.id, { actor: COORDINATOR_A });
        expect(second?.ownerId).toBe(COORDINATOR_A.id);
        expect(second?.claimedAt).not.toBe("1970-01-01T08:00:00+08:00");
        expect(second?.coveredBy?.actorId).toBe(SECOND_TEAM_LEAD_A.id);
      });

      it("returns a service state a caller cannot rewrite in place", async () => {
        const store = await newStore();
        unwrap(
          await store.stopService(
            { reason: "wrong-recipient", note: "the original account of the incident" },
            writeContext(COORDINATOR_A, "copy-stop"),
          ),
        );

        const first = await store.getServiceState({ actor: COORDINATOR_A });
        expect(Object.isFrozen(first)).toBe(true);
        if (!first.stopped) throw new Error("expected a stopped service");
        expect(Object.isFrozen(first.restartApprovals)).toBe(true);

        const second = await store.getServiceState({ actor: AUDITOR_A });
        if (!second.stopped) throw new Error("expected a stopped service");
        expect(second.note).toBe("the original account of the incident");
        expect(second.stoppedBy).toBe(COORDINATOR_A.id);
        expect(second.reason).toBe("wrong-recipient");
      });

      it("returns a pathway version whose governed message text a caller cannot rewrite in place", async () => {
        // The one value in this store that IS the clinical message a patient receives. A reader
        // holding the live snapshot could rewrite the approved wording with no version bump, no
        // approval, and no audit event -- which is the whole of what pathway governance exists to
        // prevent. The Postgres store round-trips through `jsonb` and so copies for free; the
        // in-memory store had to be made to, which is exactly the drift a shared contract is for.
        const store = await newStore();
        const version = draftPathwayVersion(COORDINATOR_A, "EXT-PATHWAY-SNAPSHOT");
        unwrap(await store.savePathwayVersion({ version }, writeContext(COORDINATOR_A, "snapshot-save")));

        const first = await store.getPathwayVersion(version.id, { actor: COORDINATOR_A });
        if (first === null) throw new Error("expected a pathway version");
        // Positive control: the governed wording really is what the read hands back, so the
        // unchanged values below are the copy holding rather than the read returning nothing.
        expect(first.snapshot.messageTextByType.standard).toBe("Checking in.");

        const mutableSnapshot = first.snapshot as unknown as {
          cadenceLabels: string[];
          messageTextByType: Record<string, string>;
        };
        try {
          mutableSnapshot.messageTextByType.standard = "Rewritten without approval.";
          mutableSnapshot.cadenceLabels.push("Day 999");
        } catch {
          // A frozen snapshot throws in strict mode. Either defence is acceptable; what is not
          // acceptable is the write landing on the stored version.
        }

        const second = await store.getPathwayVersion(version.id, { actor: COORDINATOR_A });
        expect(second?.snapshot.messageTextByType.standard).toBe("Checking in.");
        expect(second?.snapshot.cadenceLabels).toEqual(["Day 3"]);

        const listed = (await store.listPathwayVersions({ actor: COORDINATOR_A })).find(
          (candidate) => candidate.id === version.id,
        );
        expect(listed?.snapshot.messageTextByType.standard).toBe("Checking in.");
        expect(listed?.snapshot.cadenceLabels).toEqual(["Day 3"]);

        // ...and the object the CALLER passed to `savePathwayVersion` is not the stored one either.
        const callerSnapshot = version.snapshot as unknown as { messageTextByType: Record<string, string> };
        try {
          callerSnapshot.messageTextByType.standard = "Rewritten through the caller's own object.";
        } catch {
          // Same as above: a frozen caller object is one acceptable outcome.
        }
        const third = await store.getPathwayVersion(version.id, { actor: COORDINATOR_A });
        expect(third?.snapshot.messageTextByType.standard).toBe("Checking in.");
      });

      it("round-trips a snapshot's provenance, which says the approvals were given by nobody", async () => {
        // Ruling [126]. `snapshot.provenance` is what lets a screen qualify "Approved by the
        // clinical programme lead and the lived-experience representative" for a version whose
        // approvals are structurally genuine and were recorded by no person. A store that drops it
        // does not fail loudly: the record comes back looking like an ordinary approved version,
        // and the qualifier simply stops appearing.
        //
        // It belongs in the SHARED contract for the reason `clonePathwayVersion`'s own note gives
        // for this helper existing -- "the two stores came to differ on the one type carrying
        // clinical content". This field is that type, and the in-memory store did drop it once
        // already: its snapshot copy enumerated the fields it knew about, so a field the type had
        // gained disappeared on the way out while every existing case stayed green. Postgres
        // round-trips the snapshot through `jsonb` and so carries it for free; the value of the case
        // is that the NEXT enumerating copy is caught in both stores rather than in neither.
        const store = await newStore();
        const version = {
          ...draftPathwayVersion(COORDINATOR_A, "EXT-PATHWAY-PROVENANCE"),
          snapshot: {
            cadenceLabels: ["Day 3"],
            messageTextByType: { standard: "Checking in.", first: "Welcome.", closing: "This is our last message." },
            provenance: "syntheticDemonstration" as const,
          },
        };
        unwrap(await store.savePathwayVersion({ version }, writeContext(COORDINATOR_A, "provenance-save")));

        const fetched = await store.getPathwayVersion(version.id, { actor: COORDINATOR_A });
        expect(fetched?.snapshot.provenance).toBe("syntheticDemonstration");

        const listed = (await store.listPathwayVersions({ actor: COORDINATOR_A })).find(
          (candidate) => candidate.id === version.id,
        );
        expect(listed?.snapshot.provenance).toBe("syntheticDemonstration");

        // And a version that claims nothing must still claim nothing -- the marker is not something
        // a store may add on a caller's behalf either.
        const plain = draftPathwayVersion(COORDINATOR_A, "EXT-PATHWAY-NO-PROVENANCE");
        unwrap(await store.savePathwayVersion({ version: plain }, writeContext(COORDINATOR_A, "no-provenance-save")));
        const plainFetched = await store.getPathwayVersion(plain.id, { actor: COORDINATOR_A });
        expect(plainFetched?.snapshot.provenance).toBeUndefined();
      });
    });

    // -------------------------------------------------------------------------
    // Contact rescheduling -- Ruling 1's addition.
    // -------------------------------------------------------------------------
    describe("rescheduleContact (Ruling 1)", () => {
      it("moves a contact within its scheduled day, bumping its version", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        const contact = (await store.listSendableContacts(plan.plan.id, { actor: COORDINATOR_A }))[0];

        const moved = unwrap(
          await store.rescheduleContact(
            {
              planId: plan.plan.id,
              contactId: contact.contact.id,
              expectedContactVersion: contact.contact.version,
              change: { contact: contact.planned, toHour: 14, toMinute: 30 },
            },
            writeContext(COORDINATOR_A, "rc-1"),
          ),
        );
        expect(moved.planned.calendarDay).toBe(contact.planned.calendarDay);
        expect(moved.planned.sendAt.getUTCHours()).toBe(14 - 8);
        expect(moved.contact.version).toBe(contact.contact.version + 1);
      });

      it("refuses a move that leaves the scheduled day or the approved window", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        const contact = (await store.listSendableContacts(plan.plan.id, { actor: COORDINATOR_A }))[0];

        const outsideWindow = await store.rescheduleContact(
          {
            planId: plan.plan.id,
            contactId: contact.contact.id,
            expectedContactVersion: contact.contact.version,
            change: { contact: contact.planned, toHour: 20, toMinute: 0 },
          },
          writeContext(COORDINATOR_A, "rc-2"),
        );
        expect(outsideWindow).toEqual({ ok: false, reason: "contact-move-outside-approved-window" });
      });

      it("refuses to move a contact to a time that has already passed, including earlier today (owner decision)", async () => {
        // Date-change path: the suite's clock reads 2026-03-02 11:00 AWST, and a morning contact
        // moved to today keeps its 10:00 send hour, which has already passed.
        const store = await newStore();
        const plan = await createActivePlan(store);
        const contact = (await store.listSendableContacts(plan.plan.id, { actor: COORDINATOR_A }))[0];

        const earlierToday = await store.rescheduleContact(
          {
            planId: plan.plan.id,
            contactId: contact.contact.id,
            expectedContactVersion: contact.contact.version,
            change: {
              contact: contact.planned,
              toCalendarDay: "2026-03-02",
              reason: "patient request",
              teamLeadApprovalActorId: TEAM_LEAD_A.id,
            },
          },
          writeContext(TEAM_LEAD_A, "rc-past"),
        );
        expect(earlierToday).toEqual({ ok: false, reason: "contact-move-time-already-passed" });
        const unchanged = (await store.listContacts(plan.plan.id, { actor: COORDINATOR_A })).find(
          (entry) => entry.contact.id === contact.contact.id,
        );
        expect(unchanged?.planned.calendarDay).toBe(contact.planned.calendarDay);

        // Within-day path: on the contact's own day at 12:30 AWST, 10:30 that day has passed.
        clockInstant = `${contact.planned.calendarDay}T04:30:00.000Z`;
        const earlierThatDay = await store.rescheduleContact(
          {
            planId: plan.plan.id,
            contactId: contact.contact.id,
            expectedContactVersion: contact.contact.version,
            change: { contact: contact.planned, toHour: 10, toMinute: 30 },
          },
          writeContext(COORDINATOR_A, "rc-past-within-day"),
        );
        expect(earlierThatDay).toEqual({ ok: false, reason: "contact-move-time-already-passed" });
      });

      it("changes a contact's date only with a reason and a team-lead approval, refusing a blank reason or a missing approval", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        const contact = (await store.listSendableContacts(plan.plan.id, { actor: COORDINATOR_A }))[0];
        const targetDay = "2026-03-20";

        const blankReason = await store.rescheduleContact(
          {
            planId: plan.plan.id,
            contactId: contact.contact.id,
            expectedContactVersion: contact.contact.version,
            change: {
              contact: contact.planned,
              toCalendarDay: targetDay,
              reason: "  ",
              teamLeadApprovalActorId: TEAM_LEAD_A.id,
            },
          },
          writeContext(TEAM_LEAD_A, "rc-3"),
        );
        expect(blankReason).toEqual({ ok: false, reason: "contact-date-change-reason-required" });

        const missingApproval = await store.rescheduleContact(
          {
            planId: plan.plan.id,
            contactId: contact.contact.id,
            expectedContactVersion: contact.contact.version,
            change: {
              contact: contact.planned,
              toCalendarDay: targetDay,
              reason: "patient request",
              teamLeadApprovalActorId: null,
            },
          },
          writeContext(TEAM_LEAD_A, "rc-4"),
        );
        expect(missingApproval).toEqual({ ok: false, reason: "contact-date-change-approval-required" });

        const changed = unwrap(
          await store.rescheduleContact(
            {
              planId: plan.plan.id,
              contactId: contact.contact.id,
              expectedContactVersion: contact.contact.version,
              change: {
                contact: contact.planned,
                toCalendarDay: targetDay,
                reason: "patient request",
                teamLeadApprovalActorId: TEAM_LEAD_A.id,
              },
            },
            writeContext(TEAM_LEAD_A, "rc-5"),
          ),
        );
        expect(changed.planned.calendarDay).toBe(targetDay);
      });

      it("refuses a coordinator changing a contact's date -- only changeContactDate holders may", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        const contact = (await store.listSendableContacts(plan.plan.id, { actor: COORDINATOR_A }))[0];

        const denied = await store.rescheduleContact(
          {
            planId: plan.plan.id,
            contactId: contact.contact.id,
            expectedContactVersion: contact.contact.version,
            change: {
              contact: contact.planned,
              toCalendarDay: "2026-03-20",
              reason: "cover",
              teamLeadApprovalActorId: TEAM_LEAD_A.id,
            },
          },
          writeContext(COORDINATOR_A, "rc-6"),
        );
        expect(denied).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });
      });

      it("refuses a stale contact version", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        const contact = (await store.listSendableContacts(plan.plan.id, { actor: COORDINATOR_A }))[0];

        const stale = await store.rescheduleContact(
          {
            planId: plan.plan.id,
            contactId: contact.contact.id,
            expectedContactVersion: contact.contact.version + 5,
            change: { contact: contact.planned, toHour: 11, toMinute: 0 },
          },
          writeContext(COORDINATOR_A, "rc-7"),
        );
        expect(stale).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.staleVersion });
      });

      // A contact that has already left, or will never be sent, is a record of what happened. Moving
      // its time or its day would rewrite when a message was sent -- or re-schedule a message that a
      // withdrawal deliberately cancelled -- so only a contact still waiting to go may be moved.
      it("refuses to move a contact that is no longer waiting to be sent", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        const contact = (await store.listSendableContacts(plan.plan.id, { actor: COORDINATOR_A }))[0];
        const processing = unwrap(
          await store.startContactDispatch(
            { planId: plan.plan.id, contactId: contact.contact.id, expectedContactVersion: contact.contact.version },
            writeContext(DISPATCHER_A, "rc-dispatch"),
          ),
        );

        const moveInFlight = await store.rescheduleContact(
          {
            planId: plan.plan.id,
            contactId: contact.contact.id,
            expectedContactVersion: processing.contact.version,
            change: { contact: processing.planned, toHour: 15, toMinute: 0 },
          },
          writeContext(COORDINATOR_A, "rc-8"),
        );
        expect(moveInFlight).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.contactNotReschedulable });

        const withdrawnPlan = await createActivePlan(store);
        unwrap(
          await store.withdrawPlan(
            { planId: withdrawnPlan.plan.id, expectedVersion: withdrawnPlan.plan.version, origin: "patient" },
            writeContext(COORDINATOR_A, "rc-withdraw"),
          ),
        );
        const cancelled = (await store.listContacts(withdrawnPlan.plan.id, { actor: COORDINATOR_A })).find(
          (entry) => entry.contact.state === "cancelled",
        );
        if (!cancelled) throw new Error("expected a cancelled contact on a withdrawn plan");
        const moveCancelled = await store.rescheduleContact(
          {
            planId: withdrawnPlan.plan.id,
            contactId: cancelled.contact.id,
            expectedContactVersion: cancelled.contact.version,
            change: {
              contact: cancelled.planned,
              toCalendarDay: "2026-03-20",
              reason: "patient request",
              teamLeadApprovalActorId: TEAM_LEAD_A.id,
            },
          },
          writeContext(TEAM_LEAD_A, "rc-9"),
        );
        expect(moveCancelled).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.contactNotReschedulable });
        const after = (await store.listContacts(withdrawnPlan.plan.id, { actor: COORDINATOR_A })).find(
          (entry) => entry.contact.id === cancelled.contact.id,
        );
        expect(after?.planned.calendarDay).toBe(cancelled.planned.calendarDay);
      });

      it("refuses a date change to a day that is not a real calendar day", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        const contact = (await store.listSendableContacts(plan.plan.id, { actor: COORDINATOR_A }))[0];

        for (const [index, toCalendarDay] of ["banana", "2026-02-30", "2026-3-20"].entries()) {
          const refused = await store.rescheduleContact(
            {
              planId: plan.plan.id,
              contactId: contact.contact.id,
              expectedContactVersion: contact.contact.version,
              change: {
                contact: contact.planned,
                toCalendarDay,
                reason: "patient request",
                teamLeadApprovalActorId: TEAM_LEAD_A.id,
              },
            },
            writeContext(TEAM_LEAD_A, `rc-invalid-day-${index}`),
          );
          expect(refused).toEqual({ ok: false, reason: "contact-date-change-invalid-day" });
        }
      });

      // "Two caring contacts must never land on the same calendar day" is the schedule's own safety
      // contract, and a date change is the one write that can move a contact onto another's day.
      it("refuses a date change onto a day another contact of the same plan already sends on", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        const [first, second] = await store.listSendableContacts(plan.plan.id, { actor: COORDINATOR_A });

        const collided = await store.rescheduleContact(
          {
            planId: plan.plan.id,
            contactId: first.contact.id,
            expectedContactVersion: first.contact.version,
            change: {
              contact: first.planned,
              toCalendarDay: second.planned.calendarDay,
              reason: "patient request",
              teamLeadApprovalActorId: TEAM_LEAD_A.id,
            },
          },
          writeContext(TEAM_LEAD_A, "rc-collide"),
        );
        expect(collided).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.contactDateChangeCollides });
        const unchanged = (await store.listContacts(plan.plan.id, { actor: COORDINATOR_A })).find(
          (entry) => entry.contact.id === first.contact.id,
        );
        expect(unchanged?.planned.calendarDay).toBe(first.planned.calendarDay);
      });
    });

    // -------------------------------------------------------------------------
    // Dispatch reconciliation beyond the Ruling-2 test above.
    // -------------------------------------------------------------------------
    describe("dispatch reconciliation", () => {
      async function dispatchedContact(store: CaringContactRepository) {
        const plan = await createActivePlan(store);
        const contact = (await store.listSendableContacts(plan.plan.id, { actor: COORDINATOR_A }))[0];
        await store.startContactDispatch(
          { planId: plan.plan.id, contactId: contact.contact.id, expectedContactVersion: contact.contact.version },
          writeContext(DISPATCHER_A, `dispatch-${contact.contact.id}`),
        );
        return { plan, contact };
      }

      it("refuses resolving an unknown attempt, a role without reconcileProviderDispatch, a blank note, and a repeat resolution", async () => {
        const store = await newStore();
        const { contact } = await dispatchedContact(store);

        const missing = await store.resolveDispatchDiscrepancy(
          { contactId: contact.contact.id, attempt: 99, resolution: "confirmedDelivered", note: "n/a" },
          writeContext(COORDINATOR_A, "rd-1"),
        );
        expect(missing).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.notFound });

        const denied = await store.resolveDispatchDiscrepancy(
          { contactId: contact.contact.id, attempt: 1, resolution: "confirmedDelivered", note: "confirmed via portal" },
          writeContext(AUDITOR_A, "rd-2"),
        );
        expect(denied).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });

        const blankNote = await store.resolveDispatchDiscrepancy(
          { contactId: contact.contact.id, attempt: 1, resolution: "confirmedDelivered", note: " " },
          writeContext(COORDINATOR_A, "rd-3"),
        );
        expect(blankNote).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.dispatchDiscrepancyNoteRequired });

        const resolved = unwrap(
          await store.resolveDispatchDiscrepancy(
            {
              contactId: contact.contact.id,
              attempt: 1,
              resolution: "confirmedDelivered",
              note: "confirmed via portal",
            },
            writeContext(COORDINATOR_A, "rd-4"),
          ),
        );
        expect(resolved.discrepancyResolution).toBe("confirmedDelivered");

        const repeat = await store.resolveDispatchDiscrepancy(
          { contactId: contact.contact.id, attempt: 1, resolution: "confirmedNotDelivered", note: "changed my mind" },
          writeContext(COORDINATOR_A, "rd-5"),
        );
        expect(repeat).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.dispatchDiscrepancyAlreadyResolved });
      });

      it("scopes listDispatches to the actor's team and the reconcileProviderDispatch grant", async () => {
        const store = await newStore();
        await dispatchedContact(store);

        const wideRange = { fromIso: "2020-01-01T00:00:00.000Z", toIso: "2030-01-01T00:00:00.000Z" };
        expect(await store.listDispatches(wideRange, { actor: COORDINATOR_A })).toHaveLength(1);
        expect(await store.listDispatches(wideRange, { actor: COORDINATOR_B })).toEqual([]);
        expect(await store.listDispatches(wideRange, { actor: AUDITOR_A })).toEqual([]);

        const narrowRange = { fromIso: "2020-01-01T00:00:00.000Z", toIso: "2020-01-02T00:00:00.000Z" };
        expect(await store.listDispatches(narrowRange, { actor: COORDINATOR_A })).toEqual([]);
      });
    });

    // -------------------------------------------------------------------------
    // Access trail
    // -------------------------------------------------------------------------
    describe("access trail", () => {
      it("throws rather than record a non-identifier-shaped objectId (a search term or a name)", async () => {
        const store = await newStore();
        await expect(
          store.recordAccess({
            actorId: COORDINATOR_A.id,
            actorRoles: ["coordinator"],
            teamId: COORDINATOR_A.teamId,
            kind: "search",
            objectType: "patientDirectory",
            objectId: "Rowan Sample",
            outcome: "allowed",
          }),
        ).rejects.toThrow(AuditEventContainsPatientDataError);
      });

      it("still records access while the service is stopped -- the trail must not go dark mid-incident", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        await store.stopService(
          { reason: "audit-integrity-loss", note: "trail gap" },
          writeContext(COORDINATOR_A, "s-access"),
        );

        await store.recordAccess({
          actorId: AUDITOR_A.id,
          actorRoles: ["auditor"],
          teamId: AUDITOR_A.teamId,
          kind: "view",
          objectType: "plan",
          objectId: plan.plan.id,
          outcome: "allowed",
        });

        const trail = await store.listAccessTrail({ limit: 50, offset: 0 }, { actor: AUDITOR_A });
        expect(trail.some((event) => event.action === "access:view:plan")).toBe(true);
      });

      it("scopes listAccessTrail to viewAccessTrail (the auditor), returning empty for a coordinator", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        await store.recordAccess({
          actorId: COORDINATOR_A.id,
          actorRoles: ["coordinator"],
          teamId: COORDINATOR_A.teamId,
          kind: "view",
          objectType: "plan",
          objectId: plan.plan.id,
          outcome: "allowed",
        });

        expect(await store.listAccessTrail({ limit: 10, offset: 0 }, { actor: COORDINATOR_A })).toEqual([]);
        // Naming the recorded access, not merely counting: the plan writes above already put events
        // in this trail, so a non-empty count alone would pass without the access ever being visible.
        const auditorTrail = await store.listAccessTrail({ limit: 50, offset: 0 }, { actor: AUDITOR_A });
        expect(auditorTrail.map((event) => event.action)).toContain("access:view:plan");
      });

      it("applies the objectType and limit/offset filters", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        for (let i = 0; i < 3; i += 1) {
          await store.recordAccess({
            actorId: AUDITOR_A.id,
            actorRoles: ["auditor"],
            teamId: AUDITOR_A.teamId,
            kind: "view",
            objectType: "plan",
            objectId: plan.plan.id,
            outcome: "allowed",
          });
        }
        await store.recordAccess({
          actorId: AUDITOR_A.id,
          actorRoles: ["auditor"],
          teamId: AUDITOR_A.teamId,
          kind: "search",
          objectType: "patientDirectory",
          objectId: "patientDirectory",
          outcome: "allowed",
        });

        const onlyDirectory = await store.listAccessTrail(
          { limit: 10, offset: 0, objectType: "patientDirectory" },
          { actor: AUDITOR_A },
        );
        expect(onlyDirectory).toHaveLength(1);

        const firstOfTwo = await store.listAccessTrail(
          { limit: 2, offset: 0, objectType: "plan" },
          { actor: AUDITOR_A },
        );
        expect(firstOfTwo).toHaveLength(2);
      });
    });

    // -------------------------------------------------------------------------
    // Notification preferences
    // -------------------------------------------------------------------------
    describe("notification preferences", () => {
      it("defaults a new actor to opted in to nothing, then persists a save", async () => {
        const store = await newStore();
        const initial = await store.getNotificationPreferences({ actor: COORDINATOR_A });
        expect(initial).toEqual({ actorId: COORDINATOR_A.id, optedIn: [] });

        const saved = unwrap(
          await store.saveNotificationPreferences(
            { actorId: COORDINATOR_A.id, optedIn: ["serviceSafetyStop", "unclaimedWorkEscalation"] },
            writeContext(COORDINATOR_A, "np-1"),
          ),
        );
        expect(saved.optedIn).toEqual(["serviceSafetyStop", "unclaimedWorkEscalation"]);
        expect(await store.getNotificationPreferences({ actor: COORDINATOR_A })).toEqual(saved);
      });

      it("refuses saving another actor's preferences, and a system actor's own", async () => {
        const store = await newStore();
        const impersonating = await store.saveNotificationPreferences(
          { actorId: TEAM_LEAD_A.id, optedIn: ["serviceSafetyStop"] },
          writeContext(COORDINATOR_A, "np-2"),
        );
        expect(impersonating).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });

        const asDispatcher = await store.saveNotificationPreferences(
          { actorId: DISPATCHER_A.id, optedIn: ["serviceSafetyStop"] },
          writeContext(DISPATCHER_A, "np-3"),
        );
        expect(asDispatcher).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });
      });

      it("keeps preferences scoped per actor, not shared across the team", async () => {
        const store = await newStore();
        await store.saveNotificationPreferences(
          { actorId: COORDINATOR_A.id, optedIn: ["pathwayRetired"] },
          writeContext(COORDINATOR_A, "np-4"),
        );
        const teamLeadPrefs = await store.getNotificationPreferences({ actor: TEAM_LEAD_A });
        expect(teamLeadPrefs).toEqual({ actorId: TEAM_LEAD_A.id, optedIn: [] });
      });
    });

    // -------------------------------------------------------------------------
    // Training
    // -------------------------------------------------------------------------
    describe("training", () => {
      it("starts empty, records competencies idempotently, and refuses a role without enterTrainingMode", async () => {
        const store = await newStore();
        expect(await store.getTrainingRecord({ actor: COORDINATOR_A })).toEqual({
          actorId: COORDINATOR_A.id,
          completed: [],
        });

        const first = unwrap(
          await store.recordTrainingCompetency({ competency: "activation" }, writeContext(COORDINATOR_A, "tc-1")),
        );
        expect(first.completed).toEqual(["activation"]);

        const replayedCompetency = unwrap(
          await store.recordTrainingCompetency({ competency: "activation" }, writeContext(COORDINATOR_A, "tc-2")),
        );
        expect(replayedCompetency.completed).toEqual(["activation"]);

        const denied = await store.recordTrainingCompetency(
          { competency: "withdrawal" },
          writeContext(DISPATCHER_A, "tc-3"),
        );
        expect(denied).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });
      });

      it("keeps training records scoped per actor", async () => {
        const store = await newStore();
        await store.recordTrainingCompetency({ competency: "downtime" }, writeContext(COORDINATOR_A, "tc-4"));
        expect(await store.getTrainingRecord({ actor: TEAM_LEAD_A })).toEqual({
          actorId: TEAM_LEAD_A.id,
          completed: [],
        });
      });
    });

    // -------------------------------------------------------------------------
    // Clearing an episode's identifying detail
    // -------------------------------------------------------------------------
    // -------------------------------------------------------------------------
    // The reason a first contact was moved (Ruling 105)
    //
    // `buildApprovedSchedule` refuses any first-contact date other than discharge + 1 unless a
    // non-blank reason is given, and until this task it threw the string away: the system demanded
    // a reason, refused without one, and kept nothing. These cases pin where the stored reason may
    // and may not travel, and both stores run all of them.
    // -------------------------------------------------------------------------
    describe("the reason a first contact was moved", () => {
      it("keeps the reason and releases it through the one read that releases patient detail", async () => {
        const store = await newStore();
        const { planId: moved } = await createPlanWithMovedFirstContact(store);

        const episode = await store.getEpisode(moved, { actor: TEAM_LEAD_A });
        expect(episode?.firstContactReason).toBe(FIRST_CONTACT_REASON);

        // Positive control on the fixture itself: the date really did move, so the reason above is
        // a stored reason for a real move rather than a string kept for a plan on the usual day.
        const contacts = await store.listContacts(moved, { actor: COORDINATOR_A });
        const first = contacts.find((stored) => stored.planned.messageType === "first");
        expect(first?.planned.calendarDay).toBe(MOVED_FIRST_CONTACT_DAY);
      });

      it("holds no reason for a plan whose first contact is on the programme's usual day", async () => {
        // Null rather than an empty string, and never the string a caller may have sent anyway: a
        // reason is required only when the date moves, so a plan on the usual day is not missing
        // one. Storing free text nothing accounts for is the failure this case pins.
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        unwrap(
          await store.createPlan(
            createInput({ firstContactReason: "Sent although no move was requested" }),
            writeContext(COORDINATOR_A, "usual-day-create"),
          ),
        );

        const episode = await store.getEpisode(PLAN_ID, { actor: TEAM_LEAD_A });
        expect(episode?.firstContactReason).toBeNull();
        expect(JSON.stringify(episode)).not.toContain("no move was requested");
      });

      it("stores the reason trimmed, exactly as the schedule accepted it", async () => {
        const store = await newStore();
        const { planId: moved } = await createPlanWithMovedFirstContact(store, {
          reason: `  ${FIRST_CONTACT_REASON}\n`,
        });

        const episode = await store.getEpisode(moved, { actor: TEAM_LEAD_A });
        expect(episode?.firstContactReason).toBe(FIRST_CONTACT_REASON);
      });

      it("never puts the reason on a plan record, which is what a caseload lists", async () => {
        // The reason is a clinical note keyed to one patient. `listPlans` is rendered for every
        // patient in the team, and `PlanRecord` is what it returns -- so the reason must not be
        // reachable there, whether or not any screen reads it today.
        const store = await newStore();
        const { planId: moved, created } = await createPlanWithMovedFirstContact(store);
        const record = unwrap(created);

        const fetched = await store.getPlan(moved, { actor: COORDINATOR_A });
        const listed = await store.listPlans({ actor: COORDINATOR_A });
        const names = await store.listPatientNames({ actor: COORDINATOR_A });

        // POSITIVE CONTROLS, AND THIS CASE HAD NONE (found in Task 9b's fix round 2, same family as
        // the M6 finding one section down). Every assertion below is an ABSENCE, so four empty reads
        // satisfied all of them: a store that returned null, null, [] and [] passed a case whose
        // name promises the reason is kept off a caseload. It guards a real retention obligation, so
        // it must first prove the reads carry something.
        //
        // Two controls, because they fail differently. The first proves the REASON exists at all --
        // without it the whole case is vacuous against a store that never stored one. The second
        // proves each of the four reads actually returned this plan, so an emptied read is a red
        // rather than a pass. Every one of the four carries the plan id, including the names
        // projection, which is what makes one loop enough.
        expect((await store.getEpisode(moved, { actor: TEAM_LEAD_A }))?.firstContactReason).toBe(FIRST_CONTACT_REASON);

        for (const released of [record, fetched, listed, names]) {
          expect(JSON.stringify(released)).toContain(moved);
          expect(JSON.stringify(released)).not.toContain("sister");
          expect(JSON.stringify(released)).not.toContain("firstContactReason");
        }
      });

      it("is as unobtainable to another team as the plan itself", async () => {
        const store = await newStore();
        const { planId: moved } = await createPlanWithMovedFirstContact(store);

        // Positive control first: the reason IS released to an actor of the owning team, so the
        // null below is the team scoping and not the field being absent everywhere.
        expect((await store.getEpisode(moved, { actor: TEAM_LEAD_A }))?.firstContactReason).toBe(FIRST_CONTACT_REASON);

        expect(await store.getEpisode(moved, { actor: COORDINATOR_B })).toBeNull();
        expect(await store.listPlans({ actor: COORDINATOR_B })).toEqual([]);
      });

      it("refuses a reason past the cap by name, and stores no plan at all (Ruling 106)", async () => {
        // Refused, never truncated: a clinical reason cut off mid-sentence can invert its meaning,
        // and nothing in the record would show that it had happened.
        const store = await newStore();
        const overLong = "x".repeat(FIRST_CONTACT_REASON_MAX_LENGTH + 1);
        const { planId: moved, created } = await createPlanWithMovedFirstContact(store, { reason: overLong });

        expect(created).toEqual({ ok: false, reason: "first-contact-reason-too-long" });
        expect(await store.getPlan(moved, { actor: COORDINATOR_A })).toBeNull();
      });

      it("accepts a reason exactly at the cap, so the refusal above is the boundary and not the rule", async () => {
        const store = await newStore();
        const atCap = "y".repeat(FIRST_CONTACT_REASON_MAX_LENGTH);
        const { planId: moved, created } = await createPlanWithMovedFirstContact(store, { reason: atCap });

        unwrap(created);
        expect((await store.getEpisode(moved, { actor: TEAM_LEAD_A }))?.firstContactReason).toBe(atCap);
      });

      it("still refuses a moved first contact with no reason at all, unchanged", async () => {
        const store = await newStore();
        const { created } = await createPlanWithMovedFirstContact(store, { reason: "   " });
        expect(created).toEqual({ ok: false, reason: "first-contact-reason-required" });
      });
    });

    // -------------------------------------------------------------------------
    // The attestation that a check happened (Ruling [122])
    //
    // Stage 1 asks a coordinator to confirm the patient agreed and that the mobile is the
    // patient's own. Until now neither could be stored, so an activated plan carried no evidence
    // that anyone had confirmed anything. These cases pin WHAT is recorded, and -- the case this
    // section exists for -- that a retention clearance leaves it alone while still clearing
    // everything it is supposed to.
    //
    // What is recorded is that a coordinator confirmed a check: who, what, when. It is not a
    // consent record and no assertion here may be written as though it were; agreement lives in
    // the patient's hospital record, and this system is not connected to it.
    // -------------------------------------------------------------------------
    /**
     * `PlanRecord.createdAt` -- the observed instant a plan became free for a coordinator to take
     * (Group 4 review MAJOR-1, owner-approved 2026-08-28).
     *
     * IT IS HELD IN THE SHARED CONTRACT rather than in either store's own suite because the
     * unclaimed-work escalation measures a safety queue age from it, and a store that answered from
     * a different clock -- the Postgres column defaults to the database's `now()`, not this
     * repository's -- would give the same roster two different answers about how late work is.
     */
    describe("the instant a plan became free for a coordinator to take", () => {
      it("releases the plan's own creation instant, from the domain clock and not the discharge", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        const created = unwrap(await store.createPlan(createInput(), writeContext(COORDINATOR_A, "created-at-1")));

        expect(created.createdAt).toEqual(new Date(NOW));
        // The positive control for the assertion above, and the one that matters: the fixture's
        // discharge is a DIFFERENT instant from the fixture's clock, so a store that answered this
        // field from `discharge_at` -- which is what the escalation used to measure from -- could
        // not pass. Stated as an inequality rather than assumed from two constants.
        expect(created.dischargeAt).not.toEqual(created.createdAt);
        expect(created.createdAt).not.toEqual(DISCHARGE_AT);

        // And it survives every read the roster is built from, not only the write's own answer.
        const listed = await store.listPlans({ actor: COORDINATOR_A });
        expect(listed.map((record) => record.createdAt)).toEqual([new Date(NOW)]);
        const fetched = await store.getPlan(PLAN_ID, { actor: COORDINATOR_A });
        expect(fetched?.createdAt).toEqual(new Date(NOW));
      });

      it("is not patient content, so a retention clearance leaves it alone", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        // Positive control: the instant is there to survive.
        expect(plan.createdAt).toEqual(new Date(NOW));

        unwrap(
          await store.withdrawPlan(
            { planId: plan.plan.id, expectedVersion: plan.plan.version, origin: "patient" },
            writeContext(COORDINATOR_A, "created-at-withdraw"),
          ),
        );
        passRetentionPeriod();
        unwrap(
          await store.markRetentionCleared({ planId: plan.plan.id }, writeContext(COORDINATOR_A, "created-at-clear")),
        );

        // The same class as an attestation and an audit event: an instant, with no patient content
        // in it. De-identification keeps those and removes the fields that identify a person.
        const after = await store.getPlan(plan.plan.id, { actor: COORDINATOR_A });
        expect(after?.createdAt).toEqual(new Date(NOW));
      });
    });

    describe("the attestation that a check happened", () => {
      it("records who confirmed, what they confirmed, and when", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        const created = unwrap(await store.createPlan(createInput(), writeContext(COORDINATOR_A, "att-create")));

        expect(created.assuranceAttestations).toEqual([
          {
            assurance: PLAN_ASSURANCES.patientAgreementConfirmed,
            actorId: COORDINATOR_A.id,
            attestedAt: new Date(NOW),
          },
          {
            assurance: PLAN_ASSURANCES.patientControlsMobileConfirmed,
            actorId: COORDINATOR_A.id,
            attestedAt: new Date(NOW),
          },
        ]);
      });

      it("holds nothing beyond the act, its actor and its instant", async () => {
        // The guard against the field this structure must not gain. A note on WHAT was checked
        // would name patients, relatives and places -- and the clearing rule two cases below would
        // have to flip for it. A shape assertion here is what makes that a decision somebody takes
        // rather than one they inherit.
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        const created = unwrap(await store.createPlan(createInput(), writeContext(COORDINATOR_A, "att-shape")));

        for (const attestation of created.assuranceAttestations) {
          expect(Object.keys(attestation).sort()).toEqual(["actorId", "assurance", "attestedAt"]);
        }
      });

      it("reads back through getPlan and through the caseload list alike", async () => {
        // Two reads, because the Postgres store fetches them by two different queries: one keyed on
        // the plan and one grouped across every plan in the team. A grouping bug would leave
        // `getPlan` right and the caseload wrong, and only this case would see it.
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        const created = unwrap(await store.createPlan(createInput(), writeContext(COORDINATOR_A, "att-read")));

        // CONTENT FIRST, THEN AGREEMENT -- and that order is a mutation finding rather than a
        // preference. The first version asserted only that the three reads matched each other, so a
        // mutation emptying `toPlanRecord` for every read left it GREEN: three empty lists agree
        // perfectly. An assertion that only compares reads to one another cannot see a fault they
        // share. Each read is now held to the attestations the plan actually carries, and the
        // agreement assertion sits on top of that.
        const expected = ASSURANCES.length;

        const fetched = await store.getPlan(PLAN_ID, { actor: COORDINATOR_A });
        expect(fetched?.assuranceAttestations).toHaveLength(expected);
        expect(fetched?.assuranceAttestations).toEqual(created.assuranceAttestations);

        const listed = await store.listPlans({ actor: COORDINATOR_A });
        const fromList = listed.find((record) => record.plan.id === PLAN_ID)?.assuranceAttestations;
        expect(fromList).toHaveLength(expected);
        expect(fromList).toEqual(created.assuranceAttestations);
      });

      it("refuses a plan that would carry no attestation, and stores no plan at all", async () => {
        // Refused rather than accepted-and-empty. A plan holding an empty list is indistinguishable
        // afterwards from one created before attestations existed, and this is the write that
        // decides which of those a new plan is.
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        const created = await store.createPlan(
          createInput({ assurances: [] }),
          writeContext(COORDINATOR_A, "att-empty"),
        );

        expect(created).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.planAssurancesRequired });
        expect(await store.getPlan(PLAN_ID, { actor: COORDINATOR_A })).toBeNull();
      });

      it("refuses a repeated assurance by name, so one check cannot be recorded as two", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        const created = await store.createPlan(
          createInput({
            assurances: [PLAN_ASSURANCES.patientAgreementConfirmed, PLAN_ASSURANCES.patientAgreementConfirmed],
          }),
          writeContext(COORDINATOR_A, "att-repeat"),
        );

        expect(created).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.planAssuranceRepeated });
        expect(await store.getPlan(PLAN_ID, { actor: COORDINATOR_A })).toBeNull();
      });

      it("is as unobtainable to another team as the plan itself", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        unwrap(await store.createPlan(createInput(), writeContext(COORDINATOR_A, "att-scope")));

        // Positive control: the owning team's actor does get it, so the emptiness below is the team
        // scoping rather than the attestation being absent everywhere.
        expect((await store.getPlan(PLAN_ID, { actor: COORDINATOR_A }))?.assuranceAttestations).toHaveLength(
          ASSURANCES.length,
        );

        expect(await store.getPlan(PLAN_ID, { actor: COORDINATOR_B })).toBeNull();
        expect(await store.listPlans({ actor: COORDINATOR_B })).toEqual([]);
      });

      it("survives a retention clearance, which must not remove evidence that a check happened", async () => {
        // RULING [122], AND IT INVERTS RULING [105]. That ruling clears the first-contact reason
        // because it is prose a clinician typed about a patient. Judge an attestation the same way
        // -- by what it CONTAINS -- and the answer comes out the other way: a closed value, an
        // actor and an instant, no patient content at all. It is the same class as an audit event,
        // which de-identification deliberately preserves. Clearing it would destroy the evidence
        // that a check happened while keeping the plan it belongs to.
        const store = await newStore();
        const plan = await createActivePlan(store);
        const before = plan.assuranceAttestations;
        expect(before).toHaveLength(ASSURANCES.length);

        unwrap(
          await store.withdrawPlan(
            { planId: plan.plan.id, expectedVersion: plan.plan.version, origin: "patient" },
            writeContext(COORDINATOR_A, `att-withdraw-${plan.plan.id}`),
          ),
        );
        passRetentionPeriod();
        unwrap(
          await store.markRetentionCleared(
            { planId: plan.plan.id },
            writeContext(COORDINATOR_A, `att-clear-${plan.plan.id}`),
          ),
        );

        const after = await store.getPlan(plan.plan.id, { actor: COORDINATOR_A });
        expect(after?.assuranceAttestations).toEqual(before);
      });

      it("does not stop that clearance removing what it is supposed to remove", async () => {
        // THE OTHER HALF, AND IT IS NOT REDUNDANT. The case above passes just as well against a
        // clearance that has stopped working entirely -- an attestation left alone by a write that
        // does nothing looks exactly like one left alone on purpose. This case is what tells those
        // two apart, on the same shape of plan and the same shape of run.
        const store = await newStore();
        // A cultural identity is SET on purpose. The shared fixture leaves it null, so the cleared
        // assertion on it below would have been null before and null after -- an assertion whose
        // only possible outcome is green, in the one place where proof is the point.
        const plan = await createActivePlan(store, { culturalIdentity: "Noongar" });

        unwrap(
          await store.withdrawPlan(
            { planId: plan.plan.id, expectedVersion: plan.plan.version, origin: "patient" },
            writeContext(COORDINATOR_A, `att-both-withdraw-${plan.plan.id}`),
          ),
        );

        // Positive control on EVERY field the clearance is asserted to empty, not only the name:
        // each must be held right up until the clearance, or its emptiness afterwards proves
        // nothing about the clearance.
        const before = await store.getEpisode(plan.plan.id, { actor: TEAM_LEAD_A });
        expect(before?.patientName).toBe("Jordan Nguyen");
        expect(before?.patientMobileNumber).not.toBe("");
        expect(before?.patientIdentifiers).not.toEqual([]);
        expect(before?.culturalIdentity).toBe("Noongar");
        expect(before?.preferredName).toBe("Jordy");

        passRetentionPeriod();
        unwrap(
          await store.markRetentionCleared(
            { planId: plan.plan.id },
            writeContext(COORDINATOR_A, `att-both-clear-${plan.plan.id}`),
          ),
        );

        const episode = await store.getEpisode(plan.plan.id, { actor: TEAM_LEAD_A });
        expect(episode?.patientName).toBe("");
        expect(episode?.patientMobileNumber).toBe("");
        expect(episode?.patientIdentifiers).toEqual([]);
        expect(episode?.culturalIdentity).toBeNull();
        expect(episode?.preferredName).toBe("");
      });
    });

    describe("the reason a withdrawal was asked for (owner-approved 2026-09-26)", () => {
      const WITHDRAWAL_REASON = "Said the messages were hard to read while her partner was home.";

      it("keeps a given reason, trimmed, with the patient detail and releases it on the episode only", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);

        const withdrawn = unwrap(
          await store.withdrawPlan(
            {
              planId: plan.plan.id,
              expectedVersion: plan.plan.version,
              origin: "patient",
              reason: `  ${WITHDRAWAL_REASON}  `,
            },
            writeContext(COORDINATOR_A, `wr-withdraw-${plan.plan.id}`),
          ),
        );

        expect(withdrawn.plan.state).toBe("withdrawn");
        const episode = await store.getEpisode(plan.plan.id, { actor: TEAM_LEAD_A });
        expect(episode?.withdrawalReason).toBe(WITHDRAWAL_REASON);
        // Never on a list read: the caseload's record carries no free text about the patient.
        const listed = (await store.listPlans({ actor: COORDINATOR_A })).find(
          (record) => record.plan.id === plan.plan.id,
        );
        expect(listed).toBeDefined();
        expect(JSON.stringify(listed)).not.toContain(WITHDRAWAL_REASON);
        // Nor on the audit trail.
        expect(JSON.stringify(await store.listAuditEvents({ actor: AUDITOR_A }))).not.toContain("partner");
      });

      it("holds no reason when none, or only whitespace, was given", async () => {
        const store = await newStore();
        const withNone = await createActivePlan(store);
        unwrap(
          await store.withdrawPlan(
            { planId: withNone.plan.id, expectedVersion: withNone.plan.version, origin: "clinician" },
            writeContext(COORDINATOR_A, `wr-none-${withNone.plan.id}`),
          ),
        );
        expect((await store.getEpisode(withNone.plan.id, { actor: TEAM_LEAD_A }))?.withdrawalReason).toBeNull();

        const blank = await createActivePlan(store);
        unwrap(
          await store.withdrawPlan(
            { planId: blank.plan.id, expectedVersion: blank.plan.version, origin: "patient", reason: "   " },
            writeContext(COORDINATOR_A, `wr-blank-${blank.plan.id}`),
          ),
        );
        expect((await store.getEpisode(blank.plan.id, { actor: TEAM_LEAD_A }))?.withdrawalReason).toBeNull();
      });

      it("refuses an over-long reason by name and leaves the plan running", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);

        const refused = await store.withdrawPlan(
          { planId: plan.plan.id, expectedVersion: plan.plan.version, origin: "patient", reason: "x".repeat(201) },
          writeContext(COORDINATOR_A, `wr-long-${plan.plan.id}`),
        );

        expect(refused).toEqual({ ok: false, reason: "withdrawal-reason-too-long" });
        expect((await store.getPlan(plan.plan.id, { actor: COORDINATOR_A }))?.plan.state).toBe("active");
      });

      it("is removed by the retention clearance with the rest of the patient detail", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        unwrap(
          await store.withdrawPlan(
            { planId: plan.plan.id, expectedVersion: plan.plan.version, origin: "patient", reason: WITHDRAWAL_REASON },
            writeContext(COORDINATOR_A, `wr-clear-withdraw-${plan.plan.id}`),
          ),
        );
        // Positive control: held until the clearance.
        expect((await store.getEpisode(plan.plan.id, { actor: TEAM_LEAD_A }))?.withdrawalReason).toBe(
          WITHDRAWAL_REASON,
        );

        passRetentionPeriod();
        unwrap(
          await store.markRetentionCleared(
            { planId: plan.plan.id },
            writeContext(COORDINATOR_A, `wr-clear-${plan.plan.id}`),
          ),
        );

        expect((await store.getEpisode(plan.plan.id, { actor: TEAM_LEAD_A }))?.withdrawalReason).toBeNull();
      });
    });

    describe("markRetentionCleared", () => {
      it("marks a plan cleared, refuses an unknown plan, and refuses a role without the grant", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);

        const denied = await store.markRetentionCleared({ planId: plan.plan.id }, writeContext(AUDITOR_A, "mrc-1"));
        expect(denied).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });

        // An OPEN episode has no completion instant, and ../retention's own precondition says an
        // episode that has not completed is never due for de-identification. Marking cleared
        // something that could never have been due is nonsense rather than an edge case, so it is
        // refused by name -- not accepted with nothing written, which would leave a later purge
        // unable to find the episode at all.
        const stillOpen = await store.markRetentionCleared(
          { planId: plan.plan.id },
          writeContext(COORDINATOR_A, "mrc-2"),
        );
        expect(stillOpen).toEqual({ ok: false, reason: "retention-episode-not-terminal" });

        const missing = await store.markRetentionCleared(
          { planId: planId("EXT-PLAN-MISSING") },
          writeContext(COORDINATOR_A, "mrc-3"),
        );
        expect(missing).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.notFound });
      });

      it("refuses to clear an ended episode before its retention period has passed (owner decision)", async () => {
        // Owner decision (2026-09-26): identifying detail may be cleared only seven years after the
        // plan ended, not immediately. The refusal is named, and nothing is cleared.
        const store = await newStore();
        const plan = await createActivePlan(store);
        unwrap(
          await store.withdrawPlan(
            { planId: plan.plan.id, expectedVersion: plan.plan.version, origin: "patient" },
            writeContext(COORDINATOR_A, "mrc-early-withdraw"),
          ),
        );

        const early = await store.markRetentionCleared(
          { planId: plan.plan.id },
          writeContext(COORDINATOR_A, "mrc-early"),
        );
        expect(early).toEqual({ ok: false, reason: "retention-period-not-elapsed" });
        const episode = await store.getEpisode(plan.plan.id, { actor: TEAM_LEAD_A });
        expect(episode?.patientName).toBe(PATIENT_DETAIL.patientName);
        expect(episode?.patientDetailClearedAt).toBeNull();
      });

      it("clears an episode that has actually ended", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        const ended = unwrap(
          await store.withdrawPlan(
            { planId: plan.plan.id, expectedVersion: plan.plan.version, origin: "patient" },
            writeContext(COORDINATOR_A, "mrc-withdraw"),
          ),
        );
        // Positive control: the episode really did reach a terminal state and record when, so the
        // acceptance below is the rule admitting it rather than the rule not being asked.
        expect(ended.plan.state).toBe("withdrawn");
        expect(ended.completedAt).not.toBeNull();

        passRetentionPeriod();
        const cleared = await store.markRetentionCleared(
          { planId: plan.plan.id },
          writeContext(COORDINATOR_A, "mrc-5"),
        );
        expect(cleared).toEqual({ ok: true, value: undefined });
      });

      it("actually removes the identifying detail, rather than only recording that it was cleared", async () => {
        // Ruling 64. `cleared_at` used to be the ONLY thing this write touched: the plan kept the
        // patient's name, mobile number, identifiers and cultural identity, and `getEpisode` handed
        // all four back afterwards -- so anything reading the clearance record concluded a clearance
        // had happened that never had. A column named `cleared_at` must mean cleared.
        const store = await newStore();
        const plan = await createActivePlan(store);
        unwrap(
          await store.withdrawPlan(
            { planId: plan.plan.id, expectedVersion: plan.plan.version, origin: "patient" },
            writeContext(COORDINATOR_A, "mrc-deid-withdraw"),
          ),
        );

        // Positive control: every field this write must remove is genuinely present first, so the
        // absences below are the clearance acting rather than the fixture never having held them.
        const before = await store.getEpisode(plan.plan.id, { actor: TEAM_LEAD_A });
        expect(before?.patientName).toBe(PATIENT_DETAIL.patientName);
        expect(before?.patientMobileNumber).toBe(PATIENT_DETAIL.patientMobileNumber);
        expect(before?.patientIdentifiers).toEqual([...PATIENT_DETAIL.patientIdentifiers]);
        expect(before?.preferredName).toBe(PATIENT_DETAIL.preferredName);

        passRetentionPeriod();
        unwrap(await store.markRetentionCleared({ planId: plan.plan.id }, writeContext(COORDINATOR_A, "mrc-deid")));

        const after = await store.getEpisode(plan.plan.id, { actor: TEAM_LEAD_A });
        // The episode is still THERE -- de-identification keeps everything aggregate reporting
        // needs. It is the four identifying fields, and only those, that are gone.
        expect(after).not.toBeNull();
        expect(after?.state).toBe("withdrawn");
        expect(after?.pathwayVersionId).toBe(plan.pathwayVersionId);
        expect(after?.counts.contactsScheduled).toBe(before?.counts.contactsScheduled);
        expect(after?.planDates.completedAt).toEqual(before?.planDates.completedAt);

        expect(after?.patientName).toBe("");
        expect(after?.patientMobileNumber).toBe("");
        expect(after?.patientIdentifiers).toEqual([]);
        expect(after?.culturalIdentity).toBeNull();
        // The name the patient asked to be called goes too (2026-08-26). It is Ruling [105]'s class
        // rather than Ruling [122]'s: the attestation is preserved because it holds no patient
        // content, and this holds nothing else. It clears to `""` rather than null, matching
        // `patientName`, so a REMOVED preferred name stays distinguishable from an episode that
        // never held one -- which is null and is what every plan predating the column carries.
        expect(after?.preferredName).toBe("");
        expect(JSON.stringify(after)).not.toContain("Jordy");
        expect(JSON.stringify(after)).not.toContain("Jordan");
        expect(JSON.stringify(after)).not.toContain("491 570 156");
        expect(JSON.stringify(after)).not.toContain("UR-00219384");
      });

      it("carries the clearance instant on the episode, so no screen has to infer it (#J7PZQP)", async () => {
        // The clearance instant was already recorded by both stores -- the in-memory map and the
        // `retention_state` row -- and read back by nothing. So the patient overview decided a
        // clearance had happened from `patientName === ""`, and told a clinician so in as many
        // words: that a reason was given, that a clearance removed it, and that the removal is
        // irreversible.
        //
        // That inference rested entirely on `z.string().min(1)` in the plans API route. The column
        // is `not null` with NO CHECK against the empty string, and neither store's `createPlan`
        // validates a non-blank name, so `''` is a legal stored value that means two things at
        // once. Carrying the fact directly is what makes the sentinel stop being load-bearing.
        //
        // Pinned in the SHARED suite because the two stores hold it in completely different places
        // and only an external assertion catches one of them forgetting.
        const store = await newStore();
        const plan = await createActivePlan(store);
        unwrap(
          await store.withdrawPlan(
            { planId: plan.plan.id, expectedVersion: plan.plan.version, origin: "patient" },
            writeContext(COORDINATOR_A, "mrc-instant-withdraw"),
          ),
        );

        // An episode that has ENDED but has not been cleared carries no instant. Without this the
        // assertion below could pass on a store that returned the completion instant, or any
        // non-null date, for every ended episode.
        const beforeClearance = await store.getEpisode(plan.plan.id, { actor: TEAM_LEAD_A });
        expect(beforeClearance?.planDates.completedAt).not.toBeNull();
        expect(beforeClearance?.patientDetailClearedAt).toBeNull();

        passRetentionPeriod();
        unwrap(await store.markRetentionCleared({ planId: plan.plan.id }, writeContext(COORDINATOR_A, "mrc-instant")));

        const afterClearance = await store.getEpisode(plan.plan.id, { actor: TEAM_LEAD_A });
        expect(afterClearance?.patientDetailClearedAt).toBeInstanceOf(Date);
        expect(Number.isNaN(afterClearance?.patientDetailClearedAt?.getTime())).toBe(false);

        // And it is a fact in its own right, not a restatement of the blank name: an episode that
        // was never cleared reports null even though this suite's clock and fixtures are otherwise
        // identical.
        const untouched = await createActivePlan(store);
        expect((await store.getEpisode(untouched.plan.id, { actor: TEAM_LEAD_A }))?.patientDetailClearedAt).toBeNull();
      });

      it("clears the reason a first contact was moved, which is free text a clinician wrote", async () => {
        // Ruling 105, and the point of that ruling most likely to be missed. The reason is not on
        // ../retention's list of identifying fields -- that list names name, mobile number,
        // identifiers and cultural identity -- but a real one reads "patient asked to wait until
        // she is home from her sister's", which is patient-identifying content in every practical
        // sense. `CLEARED_PATIENT_DETAIL` blanks a fixed set of fields, so a fifth one added
        // anywhere else would survive a clearance and leave identifying prose in a record the
        // system reports as de-identified.
        //
        // Pinned HERE, in the shared suite, rather than in either store's own file: the in-memory
        // store clears by spreading the whole constant and so gained this for free, while the
        // Postgres store names its columns in SQL and had to be told. A test living with the
        // in-memory store would have proved nothing about the one that could forget.
        const store = await newStore();
        const { planId: moved, created } = await createPlanWithMovedFirstContact(store);
        const record = unwrap(created);

        const activated = unwrap(
          await store.activatePlan(
            { planId: moved, expectedVersion: record.plan.version },
            writeContext(COORDINATOR_A, "moved-clear-activate"),
          ),
        );
        unwrap(
          await store.withdrawPlan(
            { planId: moved, expectedVersion: activated.plan.version, origin: "patient" },
            writeContext(COORDINATOR_A, "moved-clear-withdraw"),
          ),
        );

        // Positive control: the reason is genuinely held right up to the clearance, so its absence
        // afterwards is this write acting rather than the fixture never having stored it.
        const before = await store.getEpisode(moved, { actor: TEAM_LEAD_A });
        expect(before?.firstContactReason).toBe(FIRST_CONTACT_REASON);
        expect(JSON.stringify(before)).toContain("sister");

        passRetentionPeriod();
        unwrap(await store.markRetentionCleared({ planId: moved }, writeContext(COORDINATOR_A, "moved-clear")));

        const after = await store.getEpisode(moved, { actor: TEAM_LEAD_A });
        // The episode survives -- de-identification keeps what aggregate reporting needs. It is the
        // identifying content that is gone, and the reason is part of that content.
        expect(after).not.toBeNull();
        expect(after?.state).toBe("withdrawn");
        expect(after?.firstContactReason).toBeNull();
        expect(JSON.stringify(after)).not.toContain("sister");

        // The moved DATE is deliberately untouched. It is not identifying, it is the first
        // contact's own calendar day rather than a second copy of anything, and an aggregate report
        // of when plans started must still be able to see it.
        const contacts = await store.listContacts(moved, { actor: COORDINATOR_A });
        expect(contacts.find((stored) => stored.planned.messageType === "first")?.planned.calendarDay).toBe(
          MOVED_FIRST_CONTACT_DAY,
        );
      });

      it("clears the cultural-identity report too, which lives outside the plan row", async () => {
        // Cultural identity is deliberately held in its own projection rather than on the plan, so
        // a store that de-identified only the plan row would leave it behind -- and it is one of the
        // four fields ../retention names.
        const store = await newStore();
        const referral = referralId("EXT-REFERRAL-CULTURAL");
        const pathway = "EXT-PATHWAY-CULTURAL";
        const patient = patientId("EXT-PATIENT-CULTURAL");
        const cultural = planId("EXT-PLAN-CULTURAL");

        unwrap(
          await store.createReferral(
            { referralId: referral, patientId: patient },
            writeContext(COORDINATOR_A, "cul-r"),
          ),
        );
        unwrap(
          await store.savePathwayVersion(
            { version: draftPathwayVersion(COORDINATOR_A, pathway) },
            writeContext(COORDINATOR_A, "cul-p"),
          ),
        );
        const created = unwrap(
          await store.createPlan(
            {
              planId: cultural,
              referralId: referral,
              patientId: patient,
              pathwayVersionId: pathwayVersionId(pathway),
              dischargeAt: DISCHARGE_AT,
              sendingPreference: "morning",
              patientDetail: { ...PATIENT_DETAIL, culturalIdentity: "Noongar" },
              assurances: [...ASSURANCES],
            },
            writeContext(COORDINATOR_A, "cul-create"),
          ),
        );
        const activated = unwrap(
          await store.activatePlan(
            { planId: cultural, expectedVersion: created.plan.version },
            writeContext(COORDINATOR_A, "cul-activate"),
          ),
        );
        unwrap(
          await store.withdrawPlan(
            { planId: cultural, expectedVersion: activated.plan.version, origin: "patient" },
            writeContext(COORDINATOR_A, "cul-withdraw"),
          ),
        );

        expect((await store.getEpisode(cultural, { actor: TEAM_LEAD_A }))?.culturalIdentity).toBe("Noongar");

        passRetentionPeriod();
        unwrap(await store.markRetentionCleared({ planId: cultural }, writeContext(COORDINATOR_A, "cul-clear")));

        expect((await store.getEpisode(cultural, { actor: TEAM_LEAD_A }))?.culturalIdentity).toBeNull();
      });

      it("refuses while the service is stopped, like every other ordinary mutation", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        await store.stopService({ reason: "wrong-recipient", note: "n/a" }, writeContext(COORDINATOR_A, "s-clear"));

        const refused = await store.markRetentionCleared(
          { planId: plan.plan.id },
          writeContext(COORDINATOR_A, "mrc-4"),
        );
        expect(refused).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.serviceStopped });
      });

      /**
       * The handover note a coordinator writes when a plan moves (Ruling [139] MAJOR-4, owner
       * decision 1 of 2026-08-27: delete it with the patient, do not narrow what coordinators may
       * write).
       *
       * WHAT GOES AND WHAT STAYS, and the split is the same one de-identification makes everywhere
       * else in this domain: the free text goes, the RECORD OF THE ACT stays. `deidentifyAuditEvent`
       * keeps actor, action, timestamp and object type and drops the rest; a reassignment entry is
       * the same shape -- who handed over, to whom, and when -- with one free-text field a clinician
       * typed. Clearing the entry outright would destroy spec 4.3's "any formal reassignment still
       * visible" while the plan it belongs to survives, which is the opposite of what retention is
       * for. So the reason clears to `''` and the three facts beside it are untouched.
       */
      it("clears the handover note a coordinator wrote when the plan moved, and keeps the handover itself", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        const handover =
          "Moving this to the team lead: her sister is staying at the house and asked to be the contact.";

        unwrap(
          await store.applyAssignment(
            { planId: plan.plan.id, action: { type: "claim", actorId: COORDINATOR_A.id } },
            writeContext(COORDINATOR_A, "mrc-note-claim"),
          ),
        );
        unwrap(
          await store.applyAssignment(
            { planId: plan.plan.id, action: { type: "reassign", toActorId: TEAM_LEAD_A.id, reason: handover } },
            writeContext(TEAM_LEAD_A, "mrc-note-reassign"),
          ),
        );

        // The positive control: the note is genuinely held before the clearance runs, so the
        // absence below is this write removing it rather than the fixture never having stored it.
        const before = await store.getAssignment(plan.plan.id, { actor: TEAM_LEAD_A });
        expect(before?.reassignmentHistory.map((entry) => entry.reason)).toEqual([handover]);

        unwrap(
          await store.withdrawPlan(
            { planId: plan.plan.id, expectedVersion: plan.plan.version, origin: "patient" },
            writeContext(COORDINATOR_A, "mrc-note-withdraw"),
          ),
        );
        passRetentionPeriod();
        unwrap(
          await store.markRetentionCleared({ planId: plan.plan.id }, writeContext(COORDINATOR_A, "mrc-note-clear")),
        );

        const after = await store.getAssignment(plan.plan.id, { actor: TEAM_LEAD_A });
        expect(after?.reassignmentHistory).toHaveLength(1);
        expect(after?.reassignmentHistory[0].reason).toBe("");
        expect(after?.reassignmentHistory[0].fromActorId).toBe(COORDINATOR_A.id);
        expect(after?.reassignmentHistory[0].toActorId).toBe(TEAM_LEAD_A.id);
        expect(JSON.stringify(after)).not.toContain("sister");
      });

      /**
       * The SECOND home of that same note, and the one the whole-branch review found: every write's
       * verbatim result payload is kept for replay, so clearing `plan_reassignments` alone leaves a
       * byte-identical copy in the replay record.
       *
       * REDACTED, NOT DELETED, and the direction matters. Deleting the row would return the key to
       * unused, so an identical retry would EXECUTE THE WRITE A SECOND TIME -- a destroyed
       * idempotency guarantee on a clinical write, which is a worse failure than a retained note.
       * The row therefore stays, the key stays consumed, and only the stored answer is replaced by a
       * named refusal. Both halves are asserted below.
       */
      it("clears the same note from the replay record, and the key stays consumed", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        const handover = "Handing over: he is back at his mother's place in Bunbury for a fortnight.";
        const reassign = {
          planId: plan.plan.id,
          action: { type: "reassign" as const, toActorId: TEAM_LEAD_A.id, reason: handover },
        };

        unwrap(
          await store.applyAssignment(
            { planId: plan.plan.id, action: { type: "claim", actorId: COORDINATOR_A.id } },
            writeContext(COORDINATOR_A, "mrc-replay-claim"),
          ),
        );
        unwrap(await store.applyAssignment(reassign, writeContext(TEAM_LEAD_A, "mrc-replay-reassign")));

        // The positive control, and it is the leak stated as behaviour: replaying the key hands the
        // note straight back out of the replay record.
        const replayBefore = await store.applyAssignment(reassign, writeContext(TEAM_LEAD_A, "mrc-replay-reassign"));
        expect(JSON.stringify(replayBefore)).toContain("Bunbury");

        unwrap(
          await store.withdrawPlan(
            { planId: plan.plan.id, expectedVersion: plan.plan.version, origin: "patient" },
            writeContext(COORDINATOR_A, "mrc-replay-withdraw"),
          ),
        );
        passRetentionPeriod();
        unwrap(
          await store.markRetentionCleared({ planId: plan.plan.id }, writeContext(COORDINATOR_A, "mrc-replay-clear")),
        );

        const replayAfter = await store.applyAssignment(reassign, writeContext(TEAM_LEAD_A, "mrc-replay-reassign"));
        expect(replayAfter).toEqual({
          ok: false,
          reason: REPOSITORY_REFUSALS.idempotentResultClearedByRetention,
        });
      });

      /**
       * The guarantee the redaction exists to preserve, and it is a SEPARATE CASE for a reason
       * found by mutating.
       *
       * It began as a second assertion at the end of the case above. Replacing the redaction with a
       * `delete` -- the exact mistake this whole design decision is about -- made the refusal
       * assertion above it fail first, so the assertion that actually proves the write did not run
       * twice was never reached and was therefore never proven at all. Split, both are reached: one
       * says what a replay ANSWERS, the other says what a replay DOES.
       */
      it("does not free the key: a replay after a clearance still runs no second write", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        const reassign = {
          planId: plan.plan.id,
          action: {
            type: "reassign" as const,
            toActorId: TEAM_LEAD_A.id,
            reason: "Handing over while he is at his mother's place for a fortnight.",
          },
        };

        unwrap(
          await store.applyAssignment(
            { planId: plan.plan.id, action: { type: "claim", actorId: COORDINATOR_A.id } },
            writeContext(COORDINATOR_A, "mrc-key-claim"),
          ),
        );
        unwrap(await store.applyAssignment(reassign, writeContext(TEAM_LEAD_A, "mrc-key-reassign")));

        // The positive control: one handover has happened, so the length below is a number that
        // could move rather than a list that was always empty.
        const before = await store.getAssignment(plan.plan.id, { actor: TEAM_LEAD_A });
        expect(before?.reassignmentHistory).toHaveLength(1);

        unwrap(
          await store.withdrawPlan(
            { planId: plan.plan.id, expectedVersion: plan.plan.version, origin: "patient" },
            writeContext(COORDINATOR_A, "mrc-key-withdraw"),
          ),
        );
        passRetentionPeriod();
        unwrap(
          await store.markRetentionCleared({ planId: plan.plan.id }, writeContext(COORDINATOR_A, "mrc-key-clear")),
        );

        // The replay's ANSWER is deliberately not asserted here -- that is the case above. What is
        // asserted is that the write did not happen a second time.
        await store.applyAssignment(reassign, writeContext(TEAM_LEAD_A, "mrc-key-reassign"));

        const after = await store.getAssignment(plan.plan.id, { actor: TEAM_LEAD_A });
        expect(after?.reassignmentHistory).toHaveLength(1);
      });
    });

    // -------------------------------------------------------------------------
    // Every new write group routes through the audited write path.
    //
    // The shared write helper is only proof that a write CAN audit; it says nothing about whether a
    // given method goes through it. A method that committed straight to its own storage would pass
    // every other test here -- `recordAccess` already commits outside that helper by design, so this
    // is not hypothetical. One representative write per new group, checked for the exact event it
    // must append and for the fact that it appends exactly one.
    // -------------------------------------------------------------------------
    describe("every new write group appends its own audit event", () => {
      const auditedWrites: readonly {
        group: string;
        action: string;
        /** Sets the store up, then returns the single write whose audit events are measured. */
        arrange: (store: CaringContactRepository) => Promise<() => Promise<{ ok: boolean }>>;
      }[] = [
        {
          group: "referrals",
          action: "createReferral",
          arrange: async (store) => () =>
            store.createReferral(
              { referralId: referralId("EXT-REF-AUDIT"), patientId: patientId("EXT-PAT-AUDIT") },
              writeContext(COORDINATOR_A, "audit-referral"),
            ),
        },
        {
          group: "pathway versions",
          action: "savePathwayVersion",
          arrange: async (store) => {
            const version = draftPathwayVersion();
            return () => store.savePathwayVersion({ version }, writeContext(COORDINATOR_A, "audit-pathway"));
          },
        },
        {
          group: "service state",
          action: "stopService",
          arrange: async (store) => () =>
            store.stopService(
              { reason: "wrong-recipient", note: "a message reached a number nobody recognised" },
              writeContext(COORDINATOR_A, "audit-stop"),
            ),
        },
        {
          group: "assignment",
          action: "applyAssignment",
          arrange: async (store) => {
            const plan = await createActivePlan(store);
            return () =>
              store.applyAssignment(
                { planId: plan.plan.id, action: { type: "claim", actorId: COORDINATOR_A.id } },
                writeContext(COORDINATOR_A, "audit-assignment"),
              );
          },
        },
        {
          group: "dispatch reconciliation",
          action: "resolveDispatchDiscrepancy",
          arrange: async (store) => {
            const plan = await createActivePlan(store);
            const contact = (await store.listSendableContacts(plan.plan.id, { actor: COORDINATOR_A }))[0];
            await store.startContactDispatch(
              { planId: plan.plan.id, contactId: contact.contact.id, expectedContactVersion: contact.contact.version },
              writeContext(DISPATCHER_A, "audit-dispatch"),
            );
            return () =>
              store.resolveDispatchDiscrepancy(
                {
                  contactId: contact.contact.id,
                  attempt: 1,
                  resolution: "confirmedDelivered",
                  note: "confirmed in the portal",
                },
                writeContext(COORDINATOR_A, "audit-resolve"),
              );
          },
        },
        {
          group: "notification preferences",
          action: "saveNotificationPreferences",
          arrange: async (store) => () =>
            store.saveNotificationPreferences(
              { actorId: COORDINATOR_A.id, optedIn: ["serviceSafetyStop"] },
              writeContext(COORDINATOR_A, "audit-prefs"),
            ),
        },
        {
          group: "training",
          action: "recordTrainingCompetency",
          arrange: async (store) => () =>
            store.recordTrainingCompetency({ competency: "activation" }, writeContext(COORDINATOR_A, "audit-training")),
        },
        {
          group: "clearing identifying detail",
          action: "markRetentionCleared",
          arrange: async (store) => {
            const plan = await createActivePlan(store);
            // Ended first: a clearance is only admissible for an episode that has actually ended.
            unwrap(
              await store.withdrawPlan(
                { planId: plan.plan.id, expectedVersion: plan.plan.version, origin: "patient" },
                writeContext(COORDINATOR_A, "audit-clear-withdraw"),
              ),
            );
            passRetentionPeriod();
            return () =>
              store.markRetentionCleared({ planId: plan.plan.id }, writeContext(COORDINATOR_A, "audit-clear"));
          },
        },
        {
          group: "contact rescheduling",
          action: "rescheduleContact",
          arrange: async (store) => {
            const plan = await createActivePlan(store);
            const contact = (await store.listSendableContacts(plan.plan.id, { actor: COORDINATOR_A }))[0];
            return () =>
              store.rescheduleContact(
                {
                  planId: plan.plan.id,
                  contactId: contact.contact.id,
                  expectedContactVersion: contact.contact.version,
                  change: { contact: contact.planned, toHour: 14, toMinute: 0 },
                },
                writeContext(COORDINATOR_A, "audit-reschedule"),
              );
          },
        },
      ];

      for (const { group, action, arrange } of auditedWrites) {
        it(`appends exactly one "${action}" event for a ${group} write`, async () => {
          const store = await newStore();
          const write = await arrange(store);
          const before = await store.listAuditEvents({ actor: AUDITOR_A });

          const result = await write();
          expect(result.ok).toBe(true);

          const after = await store.listAuditEvents({ actor: AUDITOR_A });
          expect(after.slice(before.length).map((event) => event.action)).toEqual([action]);
        });
      }
    });

    // -------------------------------------------------------------------------
    // Cross-cutting proof that the roleless actor is refused across every new write, and every new
    // read is unusable to the dispatcher (the system actor gets no read access at all, unchanged).
    // -------------------------------------------------------------------------
    describe("cross-cutting: no-roles and system-actor boundaries hold for the new surface too", () => {
      it("refuses a roleless actor on a representative new write", async () => {
        const store = await newStore();
        const refused = await store.createReferral(
          { referralId: referralId("EXT-REF-ROLELESS"), patientId: patientId("EXT-PAT-ROLELESS") },
          writeContext(ROLELESS_A, "cr-roleless"),
        );
        expect(refused).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });
      });

      it("gives the dispatcher no read access to the new surfaces either", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        await store.createReferral(
          { referralId: referralId("EXT-REF-DISPATCHER-CHECK"), patientId: patientId("EXT-PAT-DISPATCHER-CHECK") },
          writeContext(COORDINATOR_A, "cr-dispatcher-check"),
        );

        // Positive control: the referral really is there for an actor whose role covers it.
        expect(await store.listReferrals({ actor: COORDINATOR_A })).not.toEqual([]);

        expect(await store.getAssignment(plan.plan.id, { actor: DISPATCHER_A })).toBeNull();
        expect(await store.listReferrals({ actor: DISPATCHER_A })).toEqual([]);
        expect(await store.listAccessTrail({ limit: 10, offset: 0 }, { actor: DISPATCHER_A })).toEqual([]);
      });
    });

    // -------------------------------------------------------------------------
    // Staff alerts and sender heartbeat (feature: staff alert delivery, migration 0020)
    //
    // Operational bookkeeping: software writes it, any actor may read the heartbeat, and the team
    // opt-in read returns classes only. Written once here so both stores are held to the same
    // answers -- including the cooldown arithmetic and the "never backwards" heartbeat.
    // -------------------------------------------------------------------------
    describe("staff alerts and sender heartbeat", () => {
      const DISPATCHER_B: SystemActor = { ...DISPATCHER_A, teamId: teamId("TEAM-SOUTH") };
      const at = (iso: string) => new Date(iso);

      it("starts with no heartbeat, records one from the dispatcher and shows it to every team", async () => {
        const store = await newStore();
        expect(await store.getSenderHeartbeat({ actor: COORDINATOR_A })).toBeNull();

        const recorded = unwrap(
          await store.recordSenderHeartbeat({ at: at("2026-03-02T03:05:00.000Z") }, { actor: DISPATCHER_A }),
        );
        expect(recorded.lastRunAt.toISOString()).toBe("2026-03-02T03:05:00.000Z");

        // Service-wide: a different team's session reads the same heartbeat.
        expect((await store.getSenderHeartbeat({ actor: COORDINATOR_B }))?.lastRunAt.toISOString()).toBe(
          "2026-03-02T03:05:00.000Z",
        );
        expect((await store.getSenderHeartbeat({ actor: DISPATCHER_B }))?.lastRunAt.toISOString()).toBe(
          "2026-03-02T03:05:00.000Z",
        );
      });

      it("never moves the heartbeat backwards when an overlapping run finishes earlier", async () => {
        const store = await newStore();
        unwrap(await store.recordSenderHeartbeat({ at: at("2026-03-02T03:10:00.000Z") }, { actor: DISPATCHER_A }));
        const earlier = unwrap(
          await store.recordSenderHeartbeat({ at: at("2026-03-02T03:05:00.000Z") }, { actor: DISPATCHER_A }),
        );
        expect(earlier.lastRunAt.toISOString()).toBe("2026-03-02T03:10:00.000Z");
        unwrap(await store.recordSenderHeartbeat({ at: at("2026-03-02T03:15:00.000Z") }, { actor: DISPATCHER_B }));
        expect((await store.getSenderHeartbeat({ actor: AUDITOR_A }))?.lastRunAt.toISOString()).toBe(
          "2026-03-02T03:15:00.000Z",
        );
      });

      it("refuses every operational write to a person, whatever their role", async () => {
        const store = await newStore();
        for (const person of [COORDINATOR_A, TEAM_LEAD_A, AUDITOR_A, ROLELESS_A]) {
          expect(await store.recordSenderHeartbeat({ at: at(NOW) }, { actor: person })).toEqual({
            ok: false,
            reason: REPOSITORY_REFUSALS.permissionDenied,
          });
          expect(
            await store.claimStaffAlert(
              { scope: "TEAM-NORTH", alertClass: "permanentDeliveryFailure", at: at(NOW), cooldownMs: 60_000 },
              { actor: person },
            ),
          ).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });
          expect(
            await store.releaseStaffAlert(
              { scope: "TEAM-NORTH", alertClass: "permanentDeliveryFailure", at: at(NOW) },
              { actor: person },
            ),
          ).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });
        }
        // Positive control: the refusals were about the actor, not a broken method.
        expect(await store.getSenderHeartbeat({ actor: COORDINATOR_A })).toBeNull();
        expect(unwrap(await store.recordSenderHeartbeat({ at: at(NOW) }, { actor: DISPATCHER_A })).lastRunAt).toEqual(
          at(NOW),
        );
      });

      it("answers the team's opted-in classes as a union, in ALERT_CLASSES order, and nothing about who", async () => {
        const store = await newStore();
        expect(await store.listTeamAlertOptIns({ actor: DISPATCHER_A })).toEqual([]);

        unwrap(
          await store.saveNotificationPreferences(
            { actorId: COORDINATOR_A.id, optedIn: ["exceptionBacklog", "permanentDeliveryFailure"] },
            writeContext(COORDINATOR_A, "alerts-optin-1"),
          ),
        );
        unwrap(
          await store.saveNotificationPreferences(
            { actorId: TEAM_LEAD_A.id, optedIn: ["permanentDeliveryFailure", "serviceSafetyStop"] },
            writeContext(TEAM_LEAD_A, "alerts-optin-2"),
          ),
        );
        // Another team's opt-in must not leak into this team's answer.
        unwrap(
          await store.saveNotificationPreferences(
            { actorId: COORDINATOR_B.id, optedIn: ["pathwayRetired"] },
            writeContext(COORDINATOR_B, "alerts-optin-3"),
          ),
        );

        const expected = ["permanentDeliveryFailure", "serviceSafetyStop", "exceptionBacklog"];
        expect(await store.listTeamAlertOptIns({ actor: DISPATCHER_A })).toEqual(expected);
        expect(await store.listTeamAlertOptIns({ actor: COORDINATOR_A })).toEqual(expected);
        expect(await store.listTeamAlertOptIns({ actor: DISPATCHER_B })).toEqual(["pathwayRetired"]);
        // Deny-by-default: a person with no roles learns nothing.
        expect(await store.listTeamAlertOptIns({ actor: ROLELESS_A })).toEqual([]);
      });

      it("claims an alert once per cooldown per scope and class, and again once the cooldown has passed", async () => {
        const store = await newStore();
        const claim = (scope: string, alertClass: "senderStalled" | "carrierRateLimited", iso: string) =>
          store.claimStaffAlert(
            { scope, alertClass, at: at(iso), cooldownMs: 60 * 60 * 1000 },
            { actor: DISPATCHER_A },
          );

        expect(unwrap(await claim("service", "senderStalled", "2026-03-02T03:00:00.000Z"))).toBe("claimed");
        expect(unwrap(await claim("service", "senderStalled", "2026-03-02T03:05:00.000Z"))).toBe("coolingDown");
        expect(unwrap(await claim("service", "senderStalled", "2026-03-02T03:59:59.000Z"))).toBe("coolingDown");
        // A different class, and a different scope, are independent.
        expect(unwrap(await claim("service", "carrierRateLimited", "2026-03-02T03:05:00.000Z"))).toBe("claimed");
        expect(unwrap(await claim("TEAM-NORTH", "senderStalled", "2026-03-02T03:05:00.000Z"))).toBe("claimed");
        // Exactly one cooldown later it may go again -- and the new claim restarts the cooldown.
        expect(unwrap(await claim("service", "senderStalled", "2026-03-02T04:00:00.000Z"))).toBe("claimed");
        expect(unwrap(await claim("service", "senderStalled", "2026-03-02T04:30:00.000Z"))).toBe("coolingDown");
        // Service-wide: another team's dispatcher sees the same claim.
        expect(
          unwrap(
            await store.claimStaffAlert(
              {
                scope: "service",
                alertClass: "senderStalled",
                at: at("2026-03-02T04:30:00.000Z"),
                cooldownMs: 3_600_000,
              },
              { actor: DISPATCHER_B },
            ),
          ),
        ).toBe("coolingDown");
      });

      it("lets exactly one of two simultaneous claims win", async () => {
        const store = await newStore();
        const input = {
          scope: "TEAM-NORTH",
          alertClass: "permanentDeliveryFailure" as const,
          at: at("2026-03-02T03:00:00.000Z"),
          cooldownMs: 3_600_000,
        };
        const results = await Promise.all([
          store.claimStaffAlert(input, { actor: DISPATCHER_A }),
          store.claimStaffAlert(input, { actor: DISPATCHER_A }),
        ]);
        expect(results.map((result) => unwrap(result)).sort()).toEqual(["claimed", "coolingDown"]);
      });

      it("gives a failed delivery's claim back, and only that claim", async () => {
        const store = await newStore();
        const base = { scope: "service", alertClass: "carrierRateLimited" as const, cooldownMs: 3_600_000 };
        expect(
          unwrap(await store.claimStaffAlert({ ...base, at: at("2026-03-02T03:00:00.000Z") }, { actor: DISPATCHER_A })),
        ).toBe("claimed");
        // Releasing a claim made at a DIFFERENT instant leaves the real one standing.
        unwrap(
          await store.releaseStaffAlert(
            { scope: base.scope, alertClass: base.alertClass, at: at("2026-03-02T02:00:00.000Z") },
            { actor: DISPATCHER_A },
          ),
        );
        expect(
          unwrap(await store.claimStaffAlert({ ...base, at: at("2026-03-02T03:01:00.000Z") }, { actor: DISPATCHER_A })),
        ).toBe("coolingDown");
        unwrap(
          await store.releaseStaffAlert(
            { scope: base.scope, alertClass: base.alertClass, at: at("2026-03-02T03:00:00.000Z") },
            { actor: DISPATCHER_A },
          ),
        );
        expect(
          unwrap(await store.claimStaffAlert({ ...base, at: at("2026-03-02T03:02:00.000Z") }, { actor: DISPATCHER_A })),
        ).toBe("claimed");
      });

      it("writes no audit event for heartbeat or alert bookkeeping", async () => {
        const store = await newStore();
        const before = (await auditTrail(store)).length;
        unwrap(await store.recordSenderHeartbeat({ at: at(NOW) }, { actor: DISPATCHER_A }));
        unwrap(
          await store.claimStaffAlert(
            { scope: "service", alertClass: "senderStalled", at: at(NOW), cooldownMs: 60_000 },
            { actor: DISPATCHER_A },
          ),
        );
        expect((await auditTrail(store)).length).toBe(before);
      });
    });
    // Incoming text messages (2026-09-26). A reply from a patient's number becomes a reply-to-check
    // on their plan; an opt-out PAUSES an active plan (never withdraws it); a person marks the reply
    // followed up; and the automatic reply's loop guard allows one reply per number per window.
    // -------------------------------------------------------------------------
    describe("incoming replies", () => {
      const NORTH_ACTORS = inboundReplyActorsForTeam(TEAM_A);
      const SOUTH_ACTORS = inboundReplyActorsForTeam(teamId("TEAM-SOUTH"));
      /** `PATIENT_DETAIL`'s number, as a carrier would give it. */
      const SENDER = "+61491570156";
      const SENDER_KEY = inboundSenderKey(SENDER, "a-test-secret-that-is-at-least-32-characters");
      let replySequence = 0;

      async function record(
        store: CaringContactRepository,
        plan: PlanRecord,
        kind: InboundReplyKind,
        options: { text?: string; key?: string; replyId?: string; actor?: CaringContactActor } = {},
      ) {
        replySequence += 1;
        const replyId = options.replyId ?? inboundReplyIdFor(plan.plan.id, `carrier-${replySequence}`);
        return store.recordInboundReply(
          { planId: plan.plan.id, replyId, text: options.text ?? "Synthetic reply text.", kind },
          writeContext(options.actor ?? NORTH_ACTORS.recorder, options.key ?? `inbound-${replyId}`),
        );
      }

      it("finds the plans holding a number, in any written form, and only in the reader's own team", async () => {
        const store = await newStore();
        const north = await createActivePlan(store);
        await createActivePlan(store, { actor: COORDINATOR_B });

        for (const form of [SENDER, "0491 570 156", "61491570156"]) {
          const found = await store.findPlansForInboundNumber(form, { actor: NORTH_ACTORS.reader });
          expect(found.map((match) => match.planId)).toEqual([north.plan.id]);
          expect(found[0]).toMatchObject({ patientId: north.patientId, planState: "active" });
        }
        expect(await store.findPlansForInboundNumber("+61491570157", { actor: NORTH_ACTORS.reader })).toEqual([]);
        expect(await store.findPlansForInboundNumber("not a number", { actor: NORTH_ACTORS.reader })).toEqual([]);
        // A role that may not read a patient's record learns nothing, not even that a plan matched.
        expect(await store.findPlansForInboundNumber(SENDER, { actor: AUDITOR_A })).toEqual([]);
        expect(await store.findPlansForInboundNumber(SENDER, { actor: ROLELESS_A })).toEqual([]);
      });

      it("files a plain reply without touching the plan, and releases the words only to the plan read", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        const recorded = unwrap(await record(store, plan, "reply", { text: "Thanks, doing ok." }));

        expect(recorded).toMatchObject({ planId: plan.plan.id, kind: "reply", planPaused: false, version: 1 });
        expect(recorded.followedUpAt).toBeNull();
        expect(recorded).not.toHaveProperty("text");
        expect((await store.getPlan(plan.plan.id, { actor: COORDINATOR_A }))?.plan.state).toBe("active");

        const open = await store.listOpenInboundReplies({ actor: COORDINATOR_A });
        expect(open.map((reply) => reply.id)).toEqual([recorded.id]);
        expect(open[0]).not.toHaveProperty("text");
        const withText = await store.listInboundReplies(plan.plan.id, { actor: COORDINATOR_A });
        expect(withText.map((reply) => reply.text)).toEqual(["Thanks, doing ok."]);
      });

      it("PAUSES an active plan on an opt-out, and never withdraws or cancels it", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        const recorded = unwrap(await record(store, plan, "optOutRequest", { text: "STOP" }));

        expect(recorded).toMatchObject({ kind: "optOutRequest", planPaused: true });
        const after = await store.getPlan(plan.plan.id, { actor: COORDINATOR_A });
        expect(after?.plan.state).toBe("paused");
        expect(after?.plan.version).toBe(plan.plan.version + 1);
        // No contact was cancelled: a pause holds the schedule for a person to decide.
        expect(after?.contacts.map((entry) => entry.contact.state)).toEqual(
          plan.contacts.map((entry) => entry.contact.state),
        );
        const trail = await auditTrail(store);
        expect(trail.map((event) => event.action)).toContain("recordInboundReply:optOutRequest");
        expect(JSON.stringify(trail)).not.toMatch(/491\s?570|STOP/);
      });

      it("files an opt-out on a plan that is not running without changing it", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        const paused = unwrap(
          await store.pausePlan(
            { planId: plan.plan.id, expectedVersion: plan.plan.version },
            writeContext(COORDINATOR_A, `inbound-pause-${plan.plan.id}`),
          ),
        );
        const recorded = unwrap(await record(store, plan, "optOutRequest"));
        expect(recorded.planPaused).toBe(false);
        expect((await store.getPlan(plan.plan.id, { actor: COORDINATOR_A }))?.plan.version).toBe(paused.plan.version);
      });

      it("pauses EVERY plan holding the number, one reply item per plan, during a safety stop too", async () => {
        const store = await newStore();
        const first = await createActivePlan(store);
        const second = await createActivePlan(store);
        unwrap(
          await store.stopService(
            { reason: "wrong-recipient", note: "n/a" },
            writeContext(COORDINATOR_A, "inbound-stop"),
          ),
        );

        const matches = await store.findPlansForInboundNumber(SENDER, { actor: NORTH_ACTORS.reader });
        expect(matches.map((match) => match.planId).sort()).toEqual([first.plan.id, second.plan.id].sort());
        for (const plan of [first, second]) {
          expect(unwrap(await record(store, plan, "optOutRequest")).planPaused).toBe(true);
          expect((await store.getPlan(plan.plan.id, { actor: COORDINATOR_A }))?.plan.state).toBe("paused");
        }
        expect(await store.listOpenInboundReplies({ actor: COORDINATOR_A })).toHaveLength(2);
      });

      it("replays a retried delivery and refuses a second write claiming the same reply id", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        const replyId = inboundReplyIdFor(plan.plan.id, "carrier-retry");
        const first = await record(store, plan, "optOutRequest", { replyId });
        const replay = await record(store, plan, "optOutRequest", { replyId });
        expect(replay).toEqual(first);
        const clash = await record(store, plan, "optOutRequest", { replyId, key: "a-different-key" });
        expect(clash).toEqual({ ok: false, reason: INBOUND_REPLY_REFUSALS.alreadyRecorded });
        expect(await store.listOpenInboundReplies({ actor: COORDINATOR_A })).toHaveLength(1);
      });

      it("records only as the recorder system role, only in its own team, and only a well-formed reply", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        expect(await record(store, plan, "reply", { actor: COORDINATOR_A })).toEqual({
          ok: false,
          reason: REPOSITORY_REFUSALS.permissionDenied,
        });
        expect(await record(store, plan, "reply", { actor: DISPATCHER_A })).toEqual({
          ok: false,
          reason: REPOSITORY_REFUSALS.permissionDenied,
        });
        expect(await record(store, plan, "optOutRequest", { actor: SOUTH_ACTORS.recorder })).toEqual({
          ok: false,
          reason: REPOSITORY_REFUSALS.notFound,
        });
        expect(await record(store, plan, "reply", { text: "   " })).toEqual({
          ok: false,
          reason: INBOUND_REPLY_REFUSALS.invalidReply,
        });
        expect(await record(store, plan, "reply", { replyId: "not-a-reply-id" })).toEqual({
          ok: false,
          reason: INBOUND_REPLY_REFUSALS.invalidReply,
        });
        // An id shaped like a mobile number never reaches storage: the audit event refuses it first,
        // as it does for every write (the API boundary answers that with a 400).
        await expect(record(store, plan, "reply", { replyId: "0412345678" })).rejects.toThrow(
          AuditEventContainsPatientDataError,
        );
        expect((await store.getPlan(plan.plan.id, { actor: COORDINATOR_A }))?.plan.state).toBe("active");
        expect(await store.listOpenInboundReplies({ actor: COORDINATOR_A })).toEqual([]);
      });

      it("lets a person mark a reply followed up once, on the version they saw", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        const recorded = unwrap(await record(store, plan, "reply"));
        const followUp = (actor: CaringContactActor, expectedVersion: number, key: string) =>
          store.markInboundReplyFollowedUp(
            { planId: plan.plan.id, replyId: recorded.id, expectedVersion },
            writeContext(actor, key),
          );

        expect(await followUp(AUDITOR_A, 1, "fu-auditor")).toEqual({
          ok: false,
          reason: REPOSITORY_REFUSALS.permissionDenied,
        });
        expect(await followUp(NORTH_ACTORS.recorder, 1, "fu-recorder")).toEqual({
          ok: false,
          reason: REPOSITORY_REFUSALS.permissionDenied,
        });
        expect(await followUp(COORDINATOR_B, 1, "fu-south")).toEqual({
          ok: false,
          reason: REPOSITORY_REFUSALS.notFound,
        });

        const followed = unwrap(await followUp(COORDINATOR_A, 1, "fu-first"));
        expect(followed).toMatchObject({ id: recorded.id, followedUpBy: COORDINATOR_A.id, version: 2 });
        expect(followed.followedUpAt).toEqual(new Date(NOW));
        expect(await followUp(TEAM_LEAD_A, 1, "fu-stale")).toEqual({
          ok: false,
          reason: REPOSITORY_REFUSALS.staleVersion,
        });
        expect(await followUp(TEAM_LEAD_A, 2, "fu-again")).toEqual({
          ok: false,
          reason: INBOUND_REPLY_REFUSALS.alreadyFollowedUp,
        });
        expect(await store.listOpenInboundReplies({ actor: COORDINATOR_A })).toEqual([]);
        const kept = await store.listInboundReplies(plan.plan.id, { actor: COORDINATOR_A });
        expect(kept.map((reply) => reply.followedUpBy)).toEqual([COORDINATOR_A.id]);
      });

      it("releases replies to no one outside the team or without the patient-record read", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        unwrap(await record(store, plan, "reply"));
        expect(await store.listOpenInboundReplies({ actor: TEAM_LEAD_A })).toHaveLength(1);
        for (const actor of [AUDITOR_A, ROLELESS_A, COORDINATOR_B]) {
          expect(await store.listOpenInboundReplies({ actor })).toEqual([]);
          expect(await store.listInboundReplies(plan.plan.id, { actor })).toEqual([]);
        }
      });

      it("clears a reply's words with the rest of the patient detail", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        unwrap(await record(store, plan, "reply", { text: "Please call my sister Anne." }));
        unwrap(
          await store.withdrawPlan(
            { planId: plan.plan.id, expectedVersion: plan.plan.version, origin: "patient" },
            writeContext(COORDINATOR_A, `inbound-withdraw-${plan.plan.id}`),
          ),
        );
        passRetentionPeriod();
        unwrap(
          await store.markRetentionCleared({ planId: plan.plan.id }, writeContext(COORDINATOR_A, "inbound-clear")),
        );
        const after = await store.listInboundReplies(plan.plan.id, { actor: COORDINATOR_A });
        expect(after).toHaveLength(1);
        expect(after[0].text).toBe("");
      });

      it("allows one automatic reply per sender in the window, and another once it has passed", async () => {
        const store = await newStore();
        const window = 24 * 60 * 60 * 1000;
        expect(await store.claimInboundAutoReply({ senderKey: SENDER_KEY, windowMs: window })).toBe(true);
        expect(await store.claimInboundAutoReply({ senderKey: SENDER_KEY, windowMs: window })).toBe(false);
        const other = inboundSenderKey("+61491570157", "a-test-secret-that-is-at-least-32-characters");
        expect(await store.claimInboundAutoReply({ senderKey: other, windowMs: window })).toBe(true);

        clockInstant = "2026-03-03T03:00:00.001Z";
        expect(await store.claimInboundAutoReply({ senderKey: SENDER_KEY, windowMs: window })).toBe(true);
        expect(await store.claimInboundAutoReply({ senderKey: SENDER_KEY, windowMs: window })).toBe(false);

        // Two claims at once: exactly one wins.
        clockInstant = "2026-03-05T03:00:00.000Z";
        const raced = await Promise.all([
          store.claimInboundAutoReply({ senderKey: SENDER_KEY, windowMs: window }),
          store.claimInboundAutoReply({ senderKey: SENDER_KEY, windowMs: window }),
        ]);
        expect(raced.filter(Boolean)).toHaveLength(1);

        await expect(store.claimInboundAutoReply({ senderKey: SENDER, windowMs: window })).rejects.toThrow();
        await expect(store.claimInboundAutoReply({ senderKey: SENDER_KEY, windowMs: 0 })).rejects.toThrow();
      });
    });
  });
}
