// tests/caring-contacts-postgres-repository.test.ts
//
// The SAME store contract as tests/caring-contacts-repository.test.ts, run against the Postgres
// implementation. One suite, two factories: every proof made in Tasks 9 and 10 was made against
// the in-memory store, and duplicating the tests would let the two stores drift apart exactly
// where the drift is least visible and most dangerous.
//
// Note what this file NO LONGER does. Task 11a gave it a `beforeEach` that pre-created the referral
// and pathway version every contract fixture names, plus a call clearing the audit trail those
// inserts produced, because migration 0003 made both links same-team foreign keys while the
// Postgres store still had no `createReferral` or `savePathwayVersion` to create them with. That
// scaffolding meant the two contract runs started from DIFFERENT preconditions and the contract
// could no longer prove this store validates its own parents. Task 11b implemented both methods, so
// the contract now creates its parents through the repository and the scaffolding is gone. Do not
// reintroduce it: a fixture that reaches around the store is a fixture the store is not being
// tested by.
//
// Needs a real Postgres named by CARING_CONTACTS_DATABASE_URL. It never skips — see
// caring-contacts/run-db-tests.mjs.
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { PLAN_ASSURANCE_VALUES } from "@/lib/caring-contacts/assurances";
import { fixedClock } from "@/lib/caring-contacts/clock";
import { createPostgresRepository } from "@/lib/caring-contacts/db/postgres-repository";
import {
  actorId,
  idempotencyKey,
  pathwayVersionId,
  patientId,
  planId,
  referralId,
  teamId,
} from "@/lib/caring-contacts/ids";
import type { Actor, CaringContactActor, SystemActor } from "@/lib/caring-contacts/permissions";

import { describeCaringContactRepositoryContract } from "./helpers/caring-contacts-repository-contract";
import {
  applyCaringContactsMigrations,
  createCaringContactsTestPool,
  dropCaringContactsSchema,
  insertAuditEvent,
  nextAuditToken,
  poolAsSqlConnectionPool,
  runInTeamSession,
  truncateCaringContactsData,
} from "./helpers/caring-contacts-postgres";

import { movableClock } from "./helpers/caring-contacts-movable-clock";

let pool: Pool;

beforeAll(async () => {
  pool = createCaringContactsTestPool();
  await dropCaringContactsSchema(pool);
  await applyCaringContactsMigrations(pool);
}, 120_000);

// Each contract test builds its own store and expects an empty one. The schema is shared, so the
// rows are cleared between tests rather than the schema being rebuilt.
afterEach(async () => {
  await truncateCaringContactsData(pool);
});

afterAll(async () => {
  await pool?.end();
});

describeCaringContactRepositoryContract("postgres", (clock, options) =>
  createPostgresRepository(poolAsSqlConnectionPool(pool), clock, options),
);

// ---------------------------------------------------------------------------
// The reachability control for the shared contract's first-ever-stop race.
//
// That test asserts the BEHAVIOUR both stores owe: exactly one of two simultaneous first stops
// wins. What it cannot assert is that the race window was entered at all. If the two writes were
// ever serialised, the loser would be refused by the DOMAIN check rather than by the store's
// guarded singleton upsert, and the test would pass unchanged -- failing open into meaninglessness
// rather than going red. The two cases are indistinguishable by refusal reason on purpose: the
// guard deliberately answers with the reason the domain gives, so the stores cannot drift on the
// wire text. The control therefore has to come from somewhere else.
//
// It comes from the incident history. A loser that genuinely reached the window has already
// written its own `service_stops` row before losing the singleton; a serialised loser is refused before
// writing one. So TWO rows means the race happened. That table exists in one store only, which is
// why this half lives here rather than in the shared contract -- and why neither half is redundant.
// ---------------------------------------------------------------------------
describe("the first-ever-stop race is genuinely reached (postgres only)", () => {
  /** 2026-03-02 11:00 AWST, the instant the shared contract fixes its own clock to. */
  const NOW = "2026-03-02T03:00:00.000Z";

  const NORTH: Actor = {
    id: actorId("RACE-ACTOR-NORTH"),
    teamId: teamId("RACE-TEAM-NORTH"),
    roles: ["coordinator"],
  };
  const SOUTH: Actor = {
    id: actorId("RACE-ACTOR-SOUTH"),
    teamId: teamId("RACE-TEAM-SOUTH"),
    roles: ["coordinator"],
  };

  it("leaves two incident rows, proving both writers entered the window", async () => {
    const store = createPostgresRepository(poolAsSqlConnectionPool(pool), fixedClock(NOW));

    // Warm one pooled connection per caller, so neither spends its head start opening one. Two
    // TEAMS, not two actors: every write registers its own team first, and that insert queues a
    // second same-team writer until the first commits -- so same-team callers never reach the race.
    await Promise.all([store.getServiceState({ actor: NORTH }), store.getServiceState({ actor: SOUTH })]);

    const [first, second] = await Promise.all([
      store.stopService(
        { reason: "wrong-recipient", note: "the first responder's own account" },
        { actor: NORTH, idempotencyKey: idempotencyKey("race-control-north") },
      ),
      store.stopService(
        { reason: "duplicate-send", note: "a later account of something else entirely" },
        { actor: SOUTH, idempotencyKey: idempotencyKey("race-control-south") },
      ),
    ]);

    // The outcome, restated here only so a failure of the control below cannot be mistaken for a
    // failure of the behaviour the shared contract already pins.
    expect([first, second].filter((result) => result.ok)).toHaveLength(1);

    // THE CONTROL. Read as the migration role deliberately: whether the window was entered is a
    // question about the whole table, not about either team's scoped view of it.
    const incidents = await pool.query("select count(*)::int as recorded from caring_contacts.service_stops");
    expect(incidents.rows[0].recorded).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Patient detail must not reach the idempotency table.
//
// The shared contract already proves patient detail stays out of plan reads and out of the audit
// trail (see "keeps patient-identifying detail out of plan reads and the audit trail"). That check
// reads the RECORDS a store hands back, and stops one table short: `idempotency_records` is written
// by every single write, is scoped to the writing team by row-level security, and holds a
// fingerprint computed over the request -- `createPlan`'s request carries the patient's name, mobile
// number, identifiers and cultural identity, and `stopService`'s carries a responder's free-text
// incident note.
//
// This half has to live here rather than in the shared contract because the only way to ask the
// question honestly is to read the table itself, and that table exists in one store only. Read as
// the migration role deliberately: whether the row holds patient text is a question about the whole
// table, not about one team's scoped view of it.
// ---------------------------------------------------------------------------
describe("no patient detail reaches idempotency_records (postgres only)", () => {
  /** 2026-03-02 11:00 AWST, the instant the shared contract fixes its own clock to. */
  const NOW = "2026-03-02T03:00:00.000Z";

  const COORDINATOR: Actor = {
    id: actorId("IDEM-ACTOR"),
    teamId: teamId("IDEM-TEAM"),
    roles: ["coordinator"],
  };

  const PATIENT_NAME = "Jordan Nguyen";
  const PATIENT_MOBILE = "+61 491 570 156";
  const PATIENT_IDENTIFIER = "UR-00219384";
  const CULTURAL_IDENTITY = "Noongar";
  // Not a substring of `PATIENT_NAME`, deliberately: the preferred name is asked for rather than
  // split off the stored one, so an absence check on it must be able to fail independently.
  const PREFERRED_NAME = "Jordy";

  it("stores no row containing the patient's name, preferred name, mobile number, identifiers or cultural identity", async () => {
    const store = createPostgresRepository(poolAsSqlConnectionPool(pool), fixedClock(NOW));
    const context = (key: string) => ({ actor: COORDINATOR, idempotencyKey: idempotencyKey(key) });

    const referral = await store.createReferral(
      { referralId: referralId("IDEM-REFERRAL"), patientId: patientId("IDEM-PATIENT") },
      context("idem-referral"),
    );
    expect(referral.ok).toBe(true);
    const pathway = await store.savePathwayVersion(
      {
        version: {
          id: pathwayVersionId("IDEM-PATHWAY"),
          teamId: COORDINATOR.teamId,
          state: "draft",
          authorId: COORDINATOR.id,
          approvals: [],
          publishedAt: null,
          retiredAt: null,
          retirementUrgency: null,
          snapshot: {
            cadenceLabels: ["Day 3"],
            messageTextByType: { standard: "Checking in.", first: "Welcome.", closing: "Last one." },
          },
        },
      },
      context("idem-pathway"),
    );
    expect(pathway.ok).toBe(true);

    const created = await store.createPlan(
      {
        planId: planId("IDEM-PLAN"),
        assurances: PLAN_ASSURANCE_VALUES,
        referralId: referralId("IDEM-REFERRAL"),
        patientId: patientId("IDEM-PATIENT"),
        pathwayVersionId: pathwayVersionId("IDEM-PATHWAY"),
        dischargeAt: new Date("2026-03-02T02:00:00.000Z"),
        sendingPreference: "morning",
        patientDetail: {
          patientName: PATIENT_NAME,
          patientMobileNumber: PATIENT_MOBILE,
          patientIdentifiers: [PATIENT_IDENTIFIER],
          culturalIdentity: CULTURAL_IDENTITY,
          preferredName: PREFERRED_NAME,
        },
      },
      context("idem-create"),
    );
    expect(created.ok).toBe(true);

    // Positive controls. The write really happened, it really recorded the patient detail where the
    // detail belongs, and it really wrote an idempotency row -- so an empty search below is the
    // fingerprint being opaque rather than nothing having been written at all.
    const episode = await store.getEpisode(planId("IDEM-PLAN"), { actor: COORDINATOR });
    expect(episode?.patientName).toBe(PATIENT_NAME);
    expect(episode?.culturalIdentity).toBe(CULTURAL_IDENTITY);
    expect(episode?.preferredName).toBe(PREFERRED_NAME);

    const rows = await pool.query(
      "select fingerprint, result::text as result from caring_contacts.idempotency_records",
    );
    expect(rows.rows.length).toBeGreaterThan(0);

    const stored = JSON.stringify(rows.rows);
    for (const secret of [
      PATIENT_NAME,
      "Jordan",
      "Nguyen",
      PATIENT_MOBILE,
      "491 570 156",
      PATIENT_IDENTIFIER,
      CULTURAL_IDENTITY,
      PREFERRED_NAME,
    ]) {
      expect(stored).not.toContain(secret);
    }
  });

  it("stores no row containing a responder's free-text incident note", async () => {
    const store = createPostgresRepository(poolAsSqlConnectionPool(pool), fixedClock(NOW));
    const note = "Reached Jordan Nguyen's old number 0491 570 156 at 09:12";

    const stopped = await store.stopService(
      { reason: "wrong-recipient", note },
      { actor: COORDINATOR, idempotencyKey: idempotencyKey("idem-stop") },
    );
    expect(stopped.ok).toBe(true);

    const rows = await pool.query("select fingerprint from caring_contacts.idempotency_records");
    expect(rows.rows.length).toBeGreaterThan(0);

    const fingerprints = JSON.stringify(rows.rows);
    for (const secret of ["Jordan", "Nguyen", "570 156", "09:12"]) {
      expect(fingerprints).not.toContain(secret);
    }
  });

  it("reads a null preferred name back as null, never as the cleared empty string", async () => {
    // FOUND BY MUTATION, AND IT WAS UNPROVEN. Collapsing `null` onto `""` in this projection left
    // every suite green: no test anywhere builds a plan row without a preferred name, because every
    // route into this store supplies one. The row that has none is a plan created BEFORE migration
    // 0007, which the migration deliberately did not backfill -- so it exists in the live database
    // and nowhere in any fixture.
    //
    // The two are different facts. `""` is what `markRetentionCleared` writes, and a screen says so
    // ("removed when this episode was de-identified"); `null` means no preferred name was ever held.
    // Collapsing them reports a name retention removed as a name nobody ever gave.
    const store = createPostgresRepository(poolAsSqlConnectionPool(pool), fixedClock(NOW));
    const context = (key: string) => ({ actor: COORDINATOR, idempotencyKey: idempotencyKey(key) });

    const referral = await store.createReferral(
      { referralId: referralId("NULLNAME-REFERRAL"), patientId: patientId("NULLNAME-PATIENT") },
      context("nullname-referral"),
    );
    expect(referral.ok).toBe(true);
    const pathway = await store.savePathwayVersion(
      {
        version: {
          id: pathwayVersionId("NULLNAME-PATHWAY"),
          teamId: COORDINATOR.teamId,
          state: "draft",
          authorId: COORDINATOR.id,
          approvals: [],
          publishedAt: null,
          retiredAt: null,
          retirementUrgency: null,
          snapshot: {
            cadenceLabels: ["Day 3"],
            messageTextByType: { standard: "Checking in.", first: "Welcome.", closing: "Last one." },
          },
        },
      },
      context("nullname-pathway"),
    );
    expect(pathway.ok).toBe(true);

    const created = await store.createPlan(
      {
        planId: planId("NULLNAME-PLAN"),
        assurances: PLAN_ASSURANCE_VALUES,
        referralId: referralId("NULLNAME-REFERRAL"),
        patientId: patientId("NULLNAME-PATIENT"),
        pathwayVersionId: pathwayVersionId("NULLNAME-PATHWAY"),
        dischargeAt: new Date("2026-03-02T02:00:00.000Z"),
        sendingPreference: "morning",
        patientDetail: {
          patientName: PATIENT_NAME,
          patientMobileNumber: PATIENT_MOBILE,
          patientIdentifiers: [PATIENT_IDENTIFIER],
          culturalIdentity: null,
          preferredName: PREFERRED_NAME,
        },
      },
      context("nullname-create"),
    );
    expect(created.ok).toBe(true);

    // Positive control: the store really does read a recorded name back, so the null below is this
    // projection preserving null rather than the read never returning anything.
    expect((await store.getEpisode(planId("NULLNAME-PLAN"), { actor: COORDINATOR }))?.preferredName).toBe(
      PREFERRED_NAME,
    );

    // The pre-0007 shape, made directly because no route into this store can produce it -- and made
    // INSIDE AN AUDITED TEAM SESSION, because the schema refuses a bare `update` on this table
    // outside one (`caring-contacts-audit-required`). A first draft used `pool.query` and failed on
    // exactly that trigger; the failure looked like the assertion below and was not, which is why
    // this note is here rather than only the fix.
    await runInTeamSession(pool, { teamId: COORDINATOR.teamId, auditToken: nextAuditToken() }, async (client) => {
      await insertAuditEvent(client, {
        teamId: COORDINATOR.teamId,
        actorId: COORDINATOR.id,
        actorRoles: ["coordinator"],
        action: "createPlan",
        objectType: "plan",
        objectId: "NULLNAME-PLAN",
        outcome: "allowed",
        idempotencyKey: "nullname-strip",
      });
      await client.query("update caring_contacts.plans set preferred_name = null where id = $1", ["NULLNAME-PLAN"]);
    });

    expect((await store.getEpisode(planId("NULLNAME-PLAN"), { actor: COORDINATOR }))?.preferredName).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Ruling 65: a cross-team restart approval leaves no incident note at rest.
//
// Restart approvals are service-wide, so a TEAM-SOUTH team lead legitimately approves a TEAM-NORTH
// incident. `idempotency_records` is scoped by row-level security to the WRITING team, so the
// replay result of that approval sits in a row TEAM-SOUTH may select -- while the API boundary's
// `narrowServiceStateForActor` withholds the very same note from that actor. The two disagreed
// until `approveServiceRestart` stopped returning the note at all.
//
// Read as the migration role deliberately: whether the row holds the note is a question about the
// table, not about either team's scoped view of it.
// ---------------------------------------------------------------------------
describe("a cross-team restart approval stores no incident note (postgres only)", () => {
  /** 2026-03-02 11:00 AWST, the instant the shared contract fixes its own clock to. */
  const NOW = "2026-03-02T03:00:00.000Z";

  const NORTH: Actor = {
    id: actorId("NARROW-ACTOR-NORTH"),
    teamId: teamId("NARROW-TEAM-NORTH"),
    roles: ["coordinator"],
  };
  const SOUTH: Actor = {
    id: actorId("NARROW-ACTOR-SOUTH"),
    teamId: teamId("NARROW-TEAM-SOUTH"),
    roles: ["teamLead"],
  };

  const NOTE = "Rowan Delacroix was sent the same message twice on 491 570 156";

  it("leaves the note only in service_stops, never in the approving team's idempotency row", async () => {
    // SOUTH is the named incident lead in governance configuration (owner decision 2026-09-26).
    const store = createPostgresRepository(poolAsSqlConnectionPool(pool), fixedClock(NOW), {
      restartApprovalSeats: { incidentLead: [SOUTH.id], privacySecurityOwner: [], clinicalProgrammeLead: [] },
    });

    const stopped = await store.stopService(
      { reason: "duplicate-send", note: NOTE },
      { actor: NORTH, idempotencyKey: idempotencyKey("narrow-pg-stop") },
    );
    expect(stopped.ok).toBe(true);

    const approved = await store.approveServiceRestart(
      { role: "incidentLead" },
      { actor: SOUTH, idempotencyKey: idempotencyKey("narrow-pg-approve") },
    );
    expect(approved.ok).toBe(true);

    // Positive control: the note IS held, once, in the one table that owns it. An empty search of
    // the idempotency rows below therefore means the note went nowhere else, not that it was never
    // written.
    const incidents = await pool.query("select note from caring_contacts.service_stops");
    expect(incidents.rows.map((row) => row.note)).toContain(NOTE);

    const southRows = await pool.query(
      "select fingerprint, result::text as result from caring_contacts.idempotency_records where team_id = $1",
      [SOUTH.teamId],
    );
    expect(southRows.rows.length).toBeGreaterThan(0);

    const stored = JSON.stringify(southRows.rows);
    for (const secret of ["Rowan", "Delacroix", "491 570 156", NOTE]) {
      expect(stored).not.toContain(secret);
    }
  });
});

// ---------------------------------------------------------------------------
// Retention clearance reaches the free text that lives OUTSIDE the plan row (postgres only).
//
// The shared contract already holds both stores to clearing the handover note and to redacting the
// replay answer, because both are reachable through reads either store implements. TWO THINGS ARE
// ONLY PROVABLE HERE:
//
//   * `contact_dispatches.discrepancy_note` has no home in the in-memory store at all --
//     `DispatchRecord` carries no note, so that store drops it and there is nothing for a contract
//     test to assert. The column exists here, and this is the only place the clearance can be
//     measured against it.
//   * The replay record is REDACTED RATHER THAN DELETED. The contract proves the consequence -- a
//     replay is refused and the write does not run twice -- and this proves the mechanism, by
//     reading the row and finding it still present under the same key and the same fingerprint.
//
// Read as the migration role deliberately, for the same reason the block above is: whether a column
// still holds the prose is a question about the table rather than about a scoped view of it.
// ---------------------------------------------------------------------------
describe("a retention clearance reaches every store of free text about the patient (postgres only)", () => {
  /** 2026-03-02 11:00 AWST, the instant the shared contract fixes its own clock to. */
  const NOW = "2026-03-02T03:00:00.000Z";

  const COORDINATOR: Actor = {
    id: actorId("CLEAR-ACTOR"),
    teamId: teamId("CLEAR-TEAM"),
    roles: ["coordinator"],
  };
  const LEAD: Actor = {
    id: actorId("CLEAR-LEAD"),
    teamId: teamId("CLEAR-TEAM"),
    roles: ["teamLead"],
  };
  const DISPATCHER: SystemActor = {
    id: actorId("SYSTEM-DISPATCHER"),
    teamId: teamId("CLEAR-TEAM"),
    systemRole: "contactDispatcher",
  };

  const HANDOVER = "Handing this to the lead: his brother in Kalgoorlie is the one answering the phone.";
  const DISCREPANCY = "Rang Rowan Delacroix on 491 570 156; the message never arrived.";

  it("clears the handover note, the discrepancy note and the replay answer, and keeps the replay row", async () => {
    // Movable: a clearance is admitted only seven years after the plan ended (owner decision).
    const clearingClock = movableClock(NOW);
    const store = createPostgresRepository(poolAsSqlConnectionPool(pool), clearingClock);
    const context = (key: string, actor: CaringContactActor = COORDINATOR) => ({
      actor,
      idempotencyKey: idempotencyKey(key),
    });
    const PLAN = planId("CLEAR-PLAN");

    const referral = await store.createReferral(
      { referralId: referralId("CLEAR-REFERRAL"), patientId: patientId("CLEAR-PATIENT") },
      context("clear-referral"),
    );
    expect(referral.ok).toBe(true);
    const pathway = await store.savePathwayVersion(
      {
        version: {
          id: pathwayVersionId("CLEAR-PATHWAY"),
          teamId: COORDINATOR.teamId,
          state: "draft",
          authorId: COORDINATOR.id,
          approvals: [],
          publishedAt: null,
          retiredAt: null,
          retirementUrgency: null,
          snapshot: {
            cadenceLabels: ["Day 3"],
            messageTextByType: { standard: "Checking in.", first: "Welcome.", closing: "Last one." },
          },
        },
      },
      context("clear-pathway"),
    );
    expect(pathway.ok).toBe(true);

    const created = await store.createPlan(
      {
        planId: PLAN,
        assurances: PLAN_ASSURANCE_VALUES,
        referralId: referralId("CLEAR-REFERRAL"),
        patientId: patientId("CLEAR-PATIENT"),
        pathwayVersionId: pathwayVersionId("CLEAR-PATHWAY"),
        dischargeAt: new Date("2026-03-02T02:00:00.000Z"),
        sendingPreference: "morning",
        patientDetail: {
          patientName: "Rowan Delacroix",
          patientMobileNumber: "+61 491 570 156",
          patientIdentifiers: ["UR-00219384"],
          culturalIdentity: null,
          preferredName: "Rowan",
        },
      },
      context("clear-create"),
    );
    if (!created.ok) throw new Error(`createPlan refused: ${created.reason}`);

    const activated = await store.activatePlan(
      { planId: PLAN, expectedVersion: created.value.plan.version },
      context("clear-activate"),
    );
    if (!activated.ok) throw new Error(`activatePlan refused: ${activated.reason}`);

    // The handover note, written through the real assignment path.
    const claimed = await store.applyAssignment(
      { planId: PLAN, action: { type: "claim", actorId: COORDINATOR.id } },
      context("clear-claim"),
    );
    expect(claimed.ok).toBe(true);
    const reassigned = await store.applyAssignment(
      { planId: PLAN, action: { type: "reassign", toActorId: LEAD.id, reason: HANDOVER } },
      context("clear-reassign", LEAD),
    );
    expect(reassigned.ok).toBe(true);

    // The discrepancy note, written through the real reconciliation path.
    const contact = (await store.listSendableContacts(PLAN, { actor: COORDINATOR }))[0];
    const dispatched = await store.startContactDispatch(
      { planId: PLAN, contactId: contact.contact.id, expectedContactVersion: contact.contact.version },
      context("clear-dispatch", DISPATCHER),
    );
    expect(dispatched.ok).toBe(true);
    const resolved = await store.resolveDispatchDiscrepancy(
      { contactId: contact.contact.id, attempt: 1, resolution: "unresolvedNoResend", note: DISCREPANCY },
      context("clear-resolve"),
    );
    expect(resolved.ok).toBe(true);

    // THE POSITIVE CONTROLS. Every value the clearance must remove is read out of the table it
    // lives in BEFORE the clearance runs, so each absence below is this write acting rather than a
    // fixture that never stored the prose.
    const reasonBefore = await pool.query<{ reason: string }>(
      "select reason from caring_contacts.plan_reassignments where plan_id = $1",
      [PLAN],
    );
    expect(reasonBefore.rows.map((row) => row.reason)).toEqual([HANDOVER]);

    const noteBefore = await pool.query<{ discrepancy_note: string | null }>(
      `select d.discrepancy_note from caring_contacts.contact_dispatches d
         join caring_contacts.contacts c on c.id = d.contact_id
        where c.plan_id = $1`,
      [PLAN],
    );
    expect(noteBefore.rows.map((row) => row.discrepancy_note)).toEqual([DISCREPANCY]);

    const replayBefore = await pool.query<{ fingerprint: string; result: string }>(
      `select fingerprint, result::text as result
         from caring_contacts.idempotency_records where plan_id = $1 and idempotency_key = $2`,
      [PLAN, "clear-reassign"],
    );
    expect(replayBefore.rows).toHaveLength(1);
    expect(replayBefore.rows[0].result).toContain("Kalgoorlie");

    const withdrawn = await store.withdrawPlan(
      { planId: PLAN, expectedVersion: activated.value.plan.version, origin: "patient" },
      context("clear-withdraw"),
    );
    if (!withdrawn.ok) throw new Error(`withdrawPlan refused: ${withdrawn.reason}`);

    clearingClock.advanceYears(7);
    const cleared = await store.markRetentionCleared({ planId: PLAN }, context("clear-retention"));
    if (!cleared.ok) throw new Error(`markRetentionCleared refused: ${cleared.reason}`);

    // 1. The handover note is gone; the handover itself is not.
    const reasonAfter = await pool.query<{ reason: string; from_actor_id: string; to_actor_id: string }>(
      "select reason, from_actor_id, to_actor_id from caring_contacts.plan_reassignments where plan_id = $1",
      [PLAN],
    );
    expect(reasonAfter.rows).toHaveLength(1);
    expect(reasonAfter.rows[0].reason).toBe("");
    expect(reasonAfter.rows[0].from_actor_id).toBe(COORDINATOR.id);
    expect(reasonAfter.rows[0].to_actor_id).toBe(LEAD.id);

    // 2. The discrepancy note is gone; its resolution, which holds no patient content, is not.
    const noteAfter = await pool.query<{ discrepancy_note: string | null; discrepancy_resolution: string | null }>(
      `select d.discrepancy_note, d.discrepancy_resolution from caring_contacts.contact_dispatches d
         join caring_contacts.contacts c on c.id = d.contact_id
        where c.plan_id = $1`,
      [PLAN],
    );
    expect(noteAfter.rows).toHaveLength(1);
    expect(noteAfter.rows[0].discrepancy_note).toBe("");
    expect(noteAfter.rows[0].discrepancy_resolution).toBe("unresolvedNoResend");

    // 3. The replay row still EXISTS, under the same key and the same fingerprint, so the key stays
    //    consumed and no retry can execute that write a second time. Only its answer changed.
    const replayAfter = await pool.query<{ fingerprint: string; result: string }>(
      `select fingerprint, result::text as result
         from caring_contacts.idempotency_records where plan_id = $1 and idempotency_key = $2`,
      [PLAN, "clear-reassign"],
    );
    expect(replayAfter.rows).toHaveLength(1);
    expect(replayAfter.rows[0].fingerprint).toBe(replayBefore.rows[0].fingerprint);
    expect(replayAfter.rows[0].result).not.toContain("Kalgoorlie");
    expect(replayAfter.rows[0].result).toContain("idempotent-result-cleared-by-retention");

    // 4. And no replay record anywhere in the schema still holds either note or the patient's name.
    const everyResult = await pool.query<{ result: string }>(
      "select result::text as result from caring_contacts.idempotency_records",
    );
    const stored = JSON.stringify(everyResult.rows);
    for (const secret of ["Kalgoorlie", "Delacroix", "491 570 156", "Rowan"]) {
      expect(stored).not.toContain(secret);
    }
  });
});

// ---------------------------------------------------------------------------
// #RZVMPD — the caseload list read fetches no patient column (postgres only).
//
// `tests/caring-contacts-domain-isolation.test.ts` scans the column constants and their wiring,
// which is what catches a widened `PLAN_LIST_COLUMNS`. This is the other half: what the store
// actually puts on the wire. A scan cannot see a second, hand-written list query added later that
// never names the constant at all, and that is precisely the shape the original defect had --
// `listPlans` selecting a list it was not narrowed for.
//
// It is stated as a property of EVERY statement the call issues rather than of one expected
// string, so a future `listPlans` that fans out into more reads is held to the same rule instead
// of quietly escaping it.
// ---------------------------------------------------------------------------
describe("the caseload list read never puts a patient column on the wire (postgres only)", () => {
  /** 2026-03-02 11:00 AWST, the instant the shared contract fixes its own clock to. */
  const NOW = "2026-03-02T03:00:00.000Z";

  const COORDINATOR: Actor = {
    id: actorId("COLUMNS-ACTOR"),
    teamId: teamId("COLUMNS-TEAM"),
    roles: ["coordinator"],
  };

  it("issues no statement naming patient_name, patient_mobile_number or patient_identifiers", async () => {
    const issued: string[] = [];
    const recorded = poolAsSqlConnectionPool(pool);
    const store = createPostgresRepository(
      {
        async withConnection(work) {
          return recorded.withConnection((connection) =>
            work({
              async query(text, values) {
                issued.push(text);
                return connection.query(text, values);
              },
            }),
          );
        },
      },
      fixedClock(NOW),
    );

    const PLAN = planId("COLUMNS-PLAN");
    const context = (key: string) => ({ actor: COORDINATOR, idempotencyKey: idempotencyKey(key) });

    const referral = await store.createReferral(
      { referralId: referralId("COLUMNS-REFERRAL"), patientId: patientId("COLUMNS-PATIENT") },
      context("columns-referral"),
    );
    expect(referral.ok).toBe(true);
    const pathway = await store.savePathwayVersion(
      {
        version: {
          id: pathwayVersionId("COLUMNS-PATHWAY"),
          teamId: COORDINATOR.teamId,
          state: "draft",
          authorId: COORDINATOR.id,
          approvals: [],
          publishedAt: null,
          retiredAt: null,
          retirementUrgency: null,
          snapshot: {
            cadenceLabels: ["Day 3"],
            messageTextByType: { standard: "Checking in.", first: "Welcome.", closing: "Last one." },
          },
        },
      },
      context("columns-pathway"),
    );
    expect(pathway.ok).toBe(true);

    const created = await store.createPlan(
      {
        planId: PLAN,
        assurances: PLAN_ASSURANCE_VALUES,
        referralId: referralId("COLUMNS-REFERRAL"),
        patientId: patientId("COLUMNS-PATIENT"),
        pathwayVersionId: pathwayVersionId("COLUMNS-PATHWAY"),
        dischargeAt: new Date("2026-03-02T02:00:00.000Z"),
        sendingPreference: "morning",
        patientDetail: {
          patientName: "Rowan Delacroix",
          patientMobileNumber: "+61 491 570 156",
          patientIdentifiers: ["UR-00219384"],
          culturalIdentity: null,
          preferredName: "Rowan",
        },
      },
      context("columns-create"),
    );
    if (!created.ok) throw new Error(`createPlan refused: ${created.reason}`);

    // Only what the caseload render costs. Everything above is fixture.
    issued.length = 0;
    const plans = await store.listPlans({ actor: COORDINATOR });

    // Positive control: the read really ran and really returned the plan, so an empty `issued`
    // cannot pass this test by doing nothing.
    expect(plans.map((record) => record.plan.id)).toEqual([PLAN]);
    expect(issued.some((text) => text.includes("from caring_contacts.plans"))).toBe(true);

    for (const column of ["patient_name", "patient_mobile_number", "patient_identifiers"]) {
      expect(issued.filter((text) => text.includes(column))).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// #J7PZQP — a clearance landing MID-READ cannot produce a half-cleared episode.
//
// `runRead` opens a bare `begin`, so the transaction is READ COMMITTED and every statement in it
// takes a fresh snapshot. `markRetentionCleared` blanks the patient columns, clears the reason and
// preferred name, deletes the cultural identity and writes `retention_state.cleared_at`, all in one
// transaction -- so a clearance committing between two statements of `getEpisode` is seen by the
// later statement and not the earlier one.
//
// While nothing read `cleared_at` back, that was survivable: the fields disagreed and no caller
// concluded anything from it. Carrying the clearance instant made the disagreement load-bearing --
// an episode reporting a completed clearance while still releasing the name and the mobile number,
// which the patient overview renders as "a retention clearance removed the name, the mobile number,
// the identifiers and the cultural identity" beside the name and the mobile number.
//
// Raised by Codex review on PR #2534, which asked for exactly this: a database contract test that
// pauses the read between the statements. This is that test. It is postgres-only because there is
// no statement boundary to pause in the in-memory store, and no isolation level either.
// ---------------------------------------------------------------------------
describe("a clearance committing mid-read cannot half-clear an episode (postgres only)", () => {
  /** 2026-03-02 11:00 AWST, the instant the shared contract fixes its own clock to. */
  const NOW = "2026-03-02T03:00:00.000Z";

  const COORDINATOR: Actor = {
    id: actorId("RACE-CLEAR-ACTOR"),
    teamId: teamId("RACE-CLEAR-TEAM"),
    roles: ["coordinator"],
  };

  it("never reports a clearance while still releasing the name and mobile number", async () => {
    const PLAN = planId("RACE-CLEAR-PLAN");
    // Movable: a clearance is admitted only seven years after the plan ended (owner decision).
    const writerClock = movableClock(NOW);
    const writer = createPostgresRepository(poolAsSqlConnectionPool(pool), writerClock);
    const context = (key: string) => ({ actor: COORDINATOR, idempotencyKey: idempotencyKey(key) });

    expect(
      (
        await writer.createReferral(
          { referralId: referralId("RACE-CLEAR-REFERRAL"), patientId: patientId("RACE-CLEAR-PATIENT") },
          context("race-clear-referral"),
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await writer.savePathwayVersion(
          {
            version: {
              id: pathwayVersionId("RACE-CLEAR-PATHWAY"),
              teamId: COORDINATOR.teamId,
              state: "draft",
              authorId: COORDINATOR.id,
              approvals: [],
              publishedAt: null,
              retiredAt: null,
              retirementUrgency: null,
              snapshot: {
                cadenceLabels: ["Day 3"],
                messageTextByType: { standard: "Checking in.", first: "Welcome.", closing: "Last one." },
              },
            },
          },
          context("race-clear-pathway"),
        )
      ).ok,
    ).toBe(true);

    const created = await writer.createPlan(
      {
        planId: PLAN,
        assurances: PLAN_ASSURANCE_VALUES,
        referralId: referralId("RACE-CLEAR-REFERRAL"),
        patientId: patientId("RACE-CLEAR-PATIENT"),
        pathwayVersionId: pathwayVersionId("RACE-CLEAR-PATHWAY"),
        dischargeAt: new Date("2026-03-02T02:00:00.000Z"),
        sendingPreference: "morning",
        patientDetail: {
          patientName: "Rowan Delacroix",
          patientMobileNumber: "+61 491 570 156",
          patientIdentifiers: ["UR-00219384"],
          culturalIdentity: null,
          preferredName: "Rowan",
        },
      },
      context("race-clear-create"),
    );
    if (!created.ok) throw new Error(`createPlan refused: ${created.reason}`);
    const activated = await writer.activatePlan(
      { planId: PLAN, expectedVersion: created.value.plan.version },
      context("race-clear-activate"),
    );
    if (!activated.ok) throw new Error(`activatePlan refused: ${activated.reason}`);
    const withdrawn = await writer.withdrawPlan(
      { planId: PLAN, expectedVersion: activated.value.plan.version, origin: "patient" },
      context("race-clear-withdraw"),
    );
    if (!withdrawn.ok) throw new Error(`withdrawPlan refused: ${withdrawn.reason}`);
    writerClock.advanceYears(7);

    // THE PAUSE. The reader's own connection is wrapped so that the first statement naming the
    // plans table -- `readPlanRecord`'s select -- is followed by a clearance committed on a
    // DIFFERENT connection, before the reader issues anything else. That is the window.
    let cleared = false;
    const base = poolAsSqlConnectionPool(pool);
    const reader = createPostgresRepository(
      {
        async withConnection(work) {
          return base.withConnection((connection) =>
            work({
              async query(text, values) {
                const result = await connection.query(text, values);
                if (!cleared && text.includes("from caring_contacts.plans") && text.includes("for update") === false) {
                  cleared = true;
                  const outcome = await writer.markRetentionCleared({ planId: PLAN }, context("race-clear-mark"));
                  if (!outcome.ok) throw new Error(`markRetentionCleared refused: ${outcome.reason}`);
                }
                return result;
              },
            }),
          );
        },
      },
      fixedClock(NOW),
    );

    const episode = await reader.getEpisode(PLAN, { actor: COORDINATOR });

    // Positive control: the window was really entered. Without this the assertions below would pass
    // on a run where the clearance never happened at all, which is the shape of a race test that
    // proves nothing.
    expect(cleared).toBe(true);

    expect(episode).not.toBeNull();
    if (episode === null) throw new Error("unreachable");

    // THE INVARIANT. Whichever snapshot this read landed on, the episode must be internally
    // consistent: a reported clearance means the identifying detail is gone, and detail still
    // present means no clearance is reported. The half-and-half state is what must not exist.
    if (episode.patientDetailClearedAt !== null) {
      expect(episode.patientName).toBe("");
      expect(episode.patientMobileNumber).toBe("");
      expect(episode.patientIdentifiers).toEqual([]);
      expect(episode.culturalIdentity).toBeNull();
    } else {
      expect(episode.patientName).toBe("Rowan Delacroix");
      expect(episode.patientMobileNumber).toBe("+61 491 570 156");
    }
  });
});
