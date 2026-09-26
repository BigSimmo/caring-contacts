// tests/caring-contacts-migrations.test.ts
//
// The caring-contact schema, proven against a real Postgres.
//
// Everything here runs as `caring_contacts_app` or `caring_contacts_anon`, never as the migration
// superuser — a superuser bypasses row-level security outright, so a policy assertion made as one
// would pass against a schema with no policies at all.
//
// The five load-bearing proofs, in the order the brief states them:
//   1. an anonymous session sees nothing and may write nothing;
//   2. a cross-team select returns ZERO ROWS, not an error that would reveal the row exists;
//   3. a second non-terminal plan for one patient is refused by a unique partial index;
//   4. a second dispatch record for one (contact, attempt) is refused by a unique constraint;
//   5. a change committed without an audit event in the same transaction FAILS.
import { readdirSync } from "node:fs";
import path from "node:path";

import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  ANON_ROLE,
  applyCaringContactsMigrations,
  caringContactsMigrations,
  createCaringContactsTestPool,
  dropCaringContactsSchema,
  insertAuditEvent,
  nextAuditToken,
  runInTeamSession,
  seedPlan,
  truncateCaringContactsData,
} from "./helpers/caring-contacts-postgres";

import { PLAN_ASSURANCE_VALUES } from "@/lib/caring-contacts/assurances";

const TEAM_NORTH = "TEAM-NORTH";
const TEAM_SOUTH = "TEAM-SOUTH";

/** Tables that hold, or point directly at, one identified patient's record. */
const PATIENT_BEARING_TABLES: readonly string[] = Object.freeze([
  "referrals",
  "plans",
  "contacts",
  "contact_dispatches",
  "cultural_identity_reports",
  "audit_events",
  "retention_state",
  "idempotency_records",
  "plan_assignments",
  "plan_reassignments",
  "pathway_version_approvals",
  // Per-actor rather than per-patient, but their row-level security is load-bearing in exactly
  // the same way: a preference or training record leaking across teams still names a person.
  "notification_preferences",
  "training_records",
  // Holds no patient content -- a closed value, an actor and an instant -- but it points directly
  // at one patient's plan, and an attestation readable across teams would say who a team is
  // contacting.
  "plan_assurances",
]);

let pool: Pool;

beforeAll(async () => {
  pool = createCaringContactsTestPool();
  await dropCaringContactsSchema(pool);
  await applyCaringContactsMigrations(pool);
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

beforeEach(async () => {
  await truncateCaringContactsData(pool);
});

describe("caring-contact migrations", () => {
  it("replays without error, so a re-run of the migration set is safe", async () => {
    await applyCaringContactsMigrations(pool);
    const { rows } = await pool.query<{ count: string }>(
      "select count(*)::text as count from information_schema.tables where table_schema = 'caring_contacts'",
    );
    expect(Number(rows[0].count)).toBeGreaterThanOrEqual(12);
  });

  it("uses no CREATE INDEX CONCURRENTLY, which cannot run inside a migration transaction", () => {
    // Comments are stripped first: the migrations discuss the prohibition in prose, and a scan
    // that reads its own warning as a violation is a scan that reports the wrong thing.
    const withoutComments = (sql: string) => sql.replace(/--[^\n]*/g, "");
    const offences = caringContactsMigrations()
      .filter((migration) => /create\s+(unique\s+)?index\s+concurrently/i.test(withoutComments(migration.sql)))
      .map((migration) => migration.name);
    expect(offences).toEqual([]);

    // Positive control: the scanner does find the statement when it is really there.
    expect(withoutComments("create index concurrently x on y (z)")).toMatch(/create\s+index\s+concurrently/i);
  });

  it("declares every table the domain needs", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'caring_contacts'",
    );
    const tables = rows.map((row) => row.table_name);
    for (const expected of [
      "teams",
      "actors",
      "referrals",
      "plans",
      "contacts",
      "pathway_versions",
      "audit_events",
      "service_state",
      "retention_state",
      "cultural_identity_reports",
      "service_stops",
      "pathway_version_approvals",
      "plan_assignments",
      "plan_reassignments",
      "notification_preferences",
      "training_records",
      "service_restart_approvals",
    ]) {
      expect(tables).toContain(expected);
    }
  });

  it("keeps cultural identity off the patient row and in its own reporting projection", async () => {
    const { rows: onPlans } = await pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'caring_contacts' and table_name in ('plans', 'contacts', 'referrals')
         and column_name ilike '%cultural%'`,
    );
    expect(onPlans).toEqual([]);

    const { rows: projection } = await pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'caring_contacts' and table_name = 'cultural_identity_reports'`,
    );
    expect(projection.map((row) => row.column_name)).toContain("cultural_identity");
  });

  it("holds the moved-first-contact reason nullable, undefaulted, and bounded", async () => {
    // Migration 0005. Three properties, each of which would be a real defect if it were otherwise:
    //
    //   * NULLABLE and UNDEFAULTED, because plans created before this column existed hold no reason
    //     and no placeholder was written into them. A default would make a fabricated sentence
    //     indistinguishable from one a clinician typed, on a clinical record.
    //   * BOUNDED, so unbounded free text cannot reach the column by a route that bypassed the
    //     domain's own refusal. The number here is the backstop for
    //     `FIRST_CONTACT_REASON_MAX_LENGTH`; the enforcement lives in schedule.ts, where the
    //     refusal can be named.
    //   * BLANK REFUSED, because the domain trims and writes null when nothing was required, so ''
    //     can only ever be a caller's bug.
    const { rows: column } = await pool.query<{ is_nullable: string; column_default: string | null }>(
      `select is_nullable, column_default from information_schema.columns
       where table_schema = 'caring_contacts' and table_name = 'plans'
         and column_name = 'first_contact_reason'`,
    );
    expect(column).toHaveLength(1);
    expect(column[0].is_nullable).toBe("YES");
    expect(column[0].column_default).toBeNull();

    await seedPlan(pool, { teamId: TEAM_NORTH, planId: "PLAN-REASON", patientId: "PATIENT-REASON" });

    const setReason = async (value: string) =>
      runInTeamSession(pool, { teamId: TEAM_NORTH, auditToken: nextAuditToken() }, async (client) => {
        await insertAuditEvent(client, {
          teamId: TEAM_NORTH,
          actorId: "ACTOR-NORTH",
          actorRoles: ["coordinator"],
          action: "createPlan",
          objectType: "plan",
          objectId: "PLAN-REASON",
          outcome: "allowed",
          idempotencyKey: `reason-${value.length}`,
        });
        await client.query("update caring_contacts.plans set first_contact_reason = $1 where id = $2", [
          value,
          "PLAN-REASON",
        ]);
      });

    // Positive control: an ordinary reason is accepted, so the two refusals below are the check
    // constraint acting rather than the update never reaching the table.
    await expect(setReason("Patient asked to wait until she is home from her sister's.")).resolves.toBeUndefined();

    await expect(setReason("x".repeat(501))).rejects.toThrow(/plans_first_contact_reason_shape/);
    await expect(setReason("")).rejects.toThrow(/plans_first_contact_reason_shape/);
    await expect(setReason("   ")).rejects.toThrow(/plans_first_contact_reason_shape/);

    // Review round 1, minor M-2. The check used bare `btrim()`, which strips SPACES ONLY, so these
    // two passed a constraint whose own comment said a blank was refused -- the comment and the
    // behaviour disagreed, and the two cases above could not tell. Whitespace is now classified
    // with `[[:space:]]`.
    await expect(setReason(String.fromCharCode(9, 9))).rejects.toThrow(/plans_first_contact_reason_shape/);
    await expect(setReason(String.fromCharCode(10))).rejects.toThrow(/plans_first_contact_reason_shape/);

    // The cap is measured after surrounding whitespace is discounted, so padding cannot refuse a
    // reason the domain would have accepted -- the domain stores trimmed text and this must agree.
    await expect(setReason(`  ${"x".repeat(500)}  `)).resolves.toBeUndefined();
  });

  it("holds the withdrawal reason nullable, undefaulted, and bounded to the domain's cap", async () => {
    // Migration 0012, the same shape as 0005 for the same class of value: free text about a
    // patient, optional, capped by `WITHDRAWAL_REASON_MAX_LENGTH` in the domain and backstopped here.
    const { rows: column } = await pool.query<{ is_nullable: string; column_default: string | null }>(
      `select is_nullable, column_default from information_schema.columns
       where table_schema = 'caring_contacts' and table_name = 'plans'
         and column_name = 'withdrawal_reason'`,
    );
    expect(column).toHaveLength(1);
    expect(column[0].is_nullable).toBe("YES");
    expect(column[0].column_default).toBeNull();

    await seedPlan(pool, { teamId: TEAM_NORTH, planId: "PLAN-WITHDRAWAL-REASON", patientId: "PATIENT-WR" });

    const setReason = async (value: string) =>
      runInTeamSession(pool, { teamId: TEAM_NORTH, auditToken: nextAuditToken() }, async (client) => {
        await insertAuditEvent(client, {
          teamId: TEAM_NORTH,
          actorId: "ACTOR-NORTH",
          actorRoles: ["coordinator"],
          action: "withdrawPlan",
          objectType: "plan",
          objectId: "PLAN-WITHDRAWAL-REASON",
          outcome: "allowed",
          idempotencyKey: `withdrawal-reason-${value.length}`,
        });
        await client.query("update caring_contacts.plans set withdrawal_reason = $1 where id = $2", [
          value,
          "PLAN-WITHDRAWAL-REASON",
        ]);
      });

    // Positive control, then the two refusals, then the cap measured after trimming.
    await expect(setReason("Said the messages were hard to read.")).resolves.toBeUndefined();
    await expect(setReason("x".repeat(201))).rejects.toThrow(/plans_withdrawal_reason_shape/);
    await expect(setReason("   ")).rejects.toThrow(/plans_withdrawal_reason_shape/);
    await expect(setReason(`  ${"x".repeat(200)}  `)).resolves.toBeUndefined();
  });

  it("holds the preferred name nullable, undefaulted, unbackfilled, and bounded", async () => {
    // Migration 0007. Four properties, each a real defect if it were otherwise:
    //
    //   * NULLABLE and UNDEFAULTED, because plans created before this column existed hold no
    //     preferred name and no placeholder was written into them. A default -- least of all one
    //     derived from `patient_name` -- would fabricate a clinical record.
    //   * NOT BACKFILLED, so an existing row still reads null rather than a value nobody supplied.
    //   * THE EMPTY STRING IS ACCEPTED, because that is what a retention clearance writes, exactly
    //     as it does for `patient_name`. This is the one place 0007 deliberately differs from 0005:
    //     there, `''` can only be a caller's bug; here it is the cleared value, and refusing it
    //     would make `markRetentionCleared` fail against a real database.
    //   * BOUNDED, so unbounded free text cannot reach a column a patient-visible message is
    //     substituted from by a route that bypassed the domain's own refusal.
    const { rows: column } = await pool.query<{ is_nullable: string; column_default: string | null }>(
      `select is_nullable, column_default from information_schema.columns
       where table_schema = 'caring_contacts' and table_name = 'plans'
         and column_name = 'preferred_name'`,
    );
    expect(column).toHaveLength(1);
    expect(column[0].is_nullable).toBe("YES");
    expect(column[0].column_default).toBeNull();

    await seedPlan(pool, { teamId: TEAM_NORTH, planId: "PLAN-PREFERRED", patientId: "PATIENT-PREFERRED" });

    // NO BACKFILL, proven on a row this migration never touched: the seed writes no preferred name,
    // so anything other than null here would be a default or a backfill acting.
    const { rows: seeded } = await pool.query<{ preferred_name: string | null }>(
      "select preferred_name from caring_contacts.plans where id = $1",
      ["PLAN-PREFERRED"],
    );
    expect(seeded[0].preferred_name).toBeNull();

    const setPreferredName = async (value: string) =>
      runInTeamSession(pool, { teamId: TEAM_NORTH, auditToken: nextAuditToken() }, async (client) => {
        await insertAuditEvent(client, {
          teamId: TEAM_NORTH,
          actorId: "ACTOR-NORTH",
          actorRoles: ["coordinator"],
          action: "createPlan",
          objectType: "plan",
          objectId: "PLAN-PREFERRED",
          outcome: "allowed",
          idempotencyKey: `preferred-${value.length}`,
        });
        await client.query("update caring_contacts.plans set preferred_name = $1 where id = $2", [
          value,
          "PLAN-PREFERRED",
        ]);
      });

    // Positive control: an ordinary preferred name is accepted, so the refusal below is the check
    // constraint acting rather than the update never reaching the table.
    await expect(setPreferredName("Rowan")).resolves.toBeUndefined();

    // The clearance's own value. `markRetentionCleared` writes this against a real database, so a
    // constraint that refused it would break de-identification rather than protect anything.
    await expect(setPreferredName("")).resolves.toBeUndefined();

    await expect(setPreferredName("x".repeat(500))).rejects.toThrow(/plans_preferred_name_shape/);
  });

  it("files a replay record against the plan it is about, without making it depend on that plan", async () => {
    // Migration 0008. Four properties, each a real defect if it were otherwise:
    //
    //   * THE COLUMN EXISTS AND IS NULLABLE AND UNDEFAULTED. A replay record written for a service
    //     stop or a training write names no plan, and every record written before this migration
    //     names none either. A default would claim one.
    //   * NOT BACKFILLED, so a record that predates the column still reads null rather than a plan
    //     somebody guessed for it.
    //   * NOT A FOREIGN KEY, and this is the property most likely to be "tidied" later. A replay
    //     record must OUTLIVE its plan -- deleting it would free the key and let a retry execute a
    //     clinical write a second time -- and a REFUSED `createPlan` is recorded too, naming a plan
    //     id that was never inserted. A reference would turn that named refusal into a raised error.
    //   * INDEXED FOR THE CLEARANCE'S OWN LOOKUP, team first, because row-level security adds the
    //     team predicate to every statement against this table.
    const { rows: column } = await pool.query<{ is_nullable: string; column_default: string | null }>(
      `select is_nullable, column_default from information_schema.columns
       where table_schema = 'caring_contacts' and table_name = 'idempotency_records'
         and column_name = 'plan_id'`,
    );
    expect(column).toHaveLength(1);
    expect(column[0].is_nullable).toBe("YES");
    expect(column[0].column_default).toBeNull();

    const { rows: constraints } = await pool.query<{ conname: string; definition: string }>(
      `select c.conname, pg_catalog.pg_get_constraintdef(c.oid) as definition from pg_catalog.pg_constraint c
         join pg_catalog.pg_class t on t.oid = c.conrelid
         join pg_catalog.pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'caring_contacts' and t.relname = 'idempotency_records' and c.contype = 'f'`,
    );
    // The positive control lives inside the same query rather than beside it: this table DOES carry
    // a foreign key, on `team_id` since 0001. So the empty filter below is `plan_id` specifically
    // having no reference, not the query failing to find this table's keys at all.
    expect(constraints.map((row) => row.conname)).toContain("idempotency_records_team_id_fkey");
    expect(constraints.filter((row) => row.definition.includes("plan_id"))).toEqual([]);

    const { rows: indexes } = await pool.query<{ indexdef: string }>(
      `select indexdef from pg_catalog.pg_indexes
        where schemaname = 'caring_contacts' and indexname = 'idempotency_records_team_plan_idx'`,
    );
    expect(indexes).toHaveLength(1);
    expect(indexes[0].indexdef).toContain("(team_id, plan_id)");

    // And a record naming a plan that does not exist is ACCEPTED, which is what a refused
    // `createPlan` produces. The insert runs as the application role inside a team session, so it
    // is subject to the same policy the store writes under rather than to the migration role's
    // bypass. The team is registered first, because `team_id` IS a foreign key -- which is the
    // distinction this case is about: one column on this table references, the other does not.
    await seedPlan(pool, { teamId: TEAM_NORTH, planId: "PLAN-REPLAY", patientId: "PATIENT-REPLAY" });
    await runInTeamSession(pool, { teamId: TEAM_NORTH, auditToken: nextAuditToken() }, async (client) => {
      // The team row itself, which every other test here gets as a side effect of `seedPlan`. This
      // test deliberately seeds NO plan -- that is its whole subject -- so it must create the team
      // on its own or `idempotency_records_team_id_fkey` refuses the insert before `plan_id` is
      // ever reached, and the orphan-plan assertion below would never run.
      await client.query("insert into caring_contacts.teams (id) values ($1) on conflict (id) do nothing", [
        TEAM_NORTH,
      ]);
      await client.query(
        `insert into caring_contacts.idempotency_records (team_id, idempotency_key, fingerprint, result, plan_id)
         values ($1, $2, $3, $4::jsonb, $5)`,
        [
          TEAM_NORTH,
          "refused-create",
          "fingerprint-1",
          JSON.stringify({ ok: false, reason: "not-found" }),
          "PLAN-NEVER-CREATED",
        ],
      );
    });
    const { rows: orphan } = await pool.query<{ plan_id: string | null }>(
      "select plan_id from caring_contacts.idempotency_records where idempotency_key = $1",
      ["refused-create"],
    );
    expect(orphan.map((row) => row.plan_id)).toEqual(["PLAN-NEVER-CREATED"]);

    // NO BACKFILL, proven on a row written without the column: anything other than null here would
    // be a default or a backfill acting.
    await runInTeamSession(pool, { teamId: TEAM_NORTH, auditToken: nextAuditToken() }, async (client) => {
      await client.query(
        `insert into caring_contacts.idempotency_records (team_id, idempotency_key, fingerprint, result)
         values ($1, $2, $3, $4::jsonb)`,
        [TEAM_NORTH, "no-plan", "fingerprint-2", JSON.stringify({ ok: true, value: null })],
      );
    });
    const { rows: unfiled } = await pool.query<{ plan_id: string | null }>(
      "select plan_id from caring_contacts.idempotency_records where idempotency_key = $1",
      ["no-plan"],
    );
    expect(unfiled.map((row) => row.plan_id)).toEqual([null]);
  });

  it("classifies every column that holds free text about a patient, on the column itself", async () => {
    // Migration 0008, and the finding behind it: `service_stops.note` carries
    // "Treat it as patient data" and a recorded owner disposition, while `discrepancy_note` --
    // a clinician's account of what happened to one named patient's message -- carried nothing.
    // Somebody classified one column and not the other, and the next reader had to derive it.
    //
    // Asserted on `col_description` rather than by grepping the migration text, so a classification
    // is a property of the database a DBA can read with `\\d+` rather than a comment in a file.
    const describeColumn = async (table: string, column: string): Promise<string | null> => {
      const { rows } = await pool.query<{ description: string | null }>(
        `select pg_catalog.col_description(c.oid, a.attnum) as description
           from pg_catalog.pg_class c
           join pg_catalog.pg_namespace n on n.oid = c.relnamespace
           join pg_catalog.pg_attribute a on a.attrelid = c.oid
          where n.nspname = 'caring_contacts' and c.relname = $1 and a.attname = $2`,
        [table, column],
      );
      expect(rows).toHaveLength(1);
      return rows[0].description;
    };

    // The two columns this migration classifies, each named as patient data in the same words
    // `service_stops.note` uses.
    expect(await describeColumn("contact_dispatches", "discrepancy_note")).toContain("Treat it as patient data");
    expect(await describeColumn("plan_reassignments", "reason")).toContain("Treat it as patient data");
    // And the replay payload, which is the one nobody would look for: it is not FOR patient data and
    // holds it anyway, verbatim, for every write.
    expect(await describeColumn("idempotency_records", "result")).toContain("Treat it as patient data");

    // The positive control for those three: a column that is NOT patient data carries a comment
    // that does not say so. Without it, a `col_description` that returned the same string for every
    // column would satisfy all three assertions above.
    const createdAt = await describeColumn("plans", "created_at");
    expect(createdAt).toContain("free for a coordinator to take");
    expect(createdAt).not.toContain("Treat it as patient data");
  });

  it("holds the plan assurances as a closed, undefaulted, team-scoped attestation", async () => {
    // Migration 0006. Four properties, each a real defect if it were otherwise:
    //
    //   * THE VALUE SET IS CLOSED, and closed to the SAME set the domain knows. A check constraint
    //     naming a different list from `PLAN_ASSURANCES` would let a write store an assurance no
    //     screen can render, or refuse one the wizard sends.
    //   * `attested_at` IS UNDEFAULTED, so a write that forgot the instant cannot look like one
    //     that recorded it. `default now()` would make those two indistinguishable.
    //   * `actor_id` IS NOT NULL. An attestation that cannot say who made it is not evidence, and
    //     an anonymous row is worse than an absent one because it reads as proof.
    //   * ONE ROW PER ASSURANCE PER PLAN, so one check cannot be recorded as two.
    const { rows: columns } = await pool.query<{
      column_name: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `select column_name, is_nullable, column_default from information_schema.columns
       where table_schema = 'caring_contacts' and table_name = 'plan_assurances'`,
    );
    const byColumn = new Map(columns.map((row) => [row.column_name, row]));
    expect(byColumn.get("attested_at")?.is_nullable).toBe("NO");
    expect(byColumn.get("attested_at")?.column_default).toBeNull();
    expect(byColumn.get("actor_id")?.is_nullable).toBe("NO");

    await seedPlan(pool, { teamId: TEAM_NORTH, planId: "PLAN-ATTEST", patientId: "PATIENT-ATTEST" });

    const attest = async (assurance: string, planId = "PLAN-ATTEST", teamId = TEAM_NORTH) =>
      runInTeamSession(pool, { teamId, auditToken: nextAuditToken() }, async (client) => {
        await insertAuditEvent(client, {
          teamId,
          actorId: "ACTOR-NORTH",
          actorRoles: ["coordinator"],
          action: "createPlan",
          objectType: "plan",
          objectId: planId,
          outcome: "allowed",
          idempotencyKey: `attest-${planId}-${assurance}`,
        });
        await client.query(
          `insert into caring_contacts.plan_assurances (plan_id, team_id, assurance, actor_id, attested_at)
           values ($1, $2, $3, 'ACTOR-NORTH', now())`,
          [planId, teamId, assurance],
        );
      });

    // Every value the domain knows is accepted, and the loop is what keeps the two lists equal:
    // adding a value to `PLAN_ASSURANCES` without adding it to the constraint fails here.
    for (const assurance of PLAN_ASSURANCE_VALUES) {
      await expect(attest(assurance)).resolves.toBeUndefined();
    }

    // Positive control above means this refusal is the check constraint acting rather than the
    // insert never reaching the table.
    await expect(attest("patient-said-yes-probably")).rejects.toThrow(/plan_assurances_assurance_check/);

    // A repeat of one already written is refused by the key, so a single check cannot be recorded
    // twice by a route that bypassed the domain's own named refusal.
    await expect(attest(PLAN_ASSURANCE_VALUES[0])).rejects.toThrow(/plan_assurances_pkey/);
  });

  it("refuses an attestation attached to another team's plan", async () => {
    // The composite foreign key, and the reason 0003 gives for `plan_assignments`: foreign-key
    // checks bypass row-level security, so a bare `plan_id` reference would let TEAM-SOUTH attach a
    // row to TEAM-NORTH's plan while claiming its own team -- visible to the wrong team and
    // invisible to the right one.
    await seedPlan(pool, { teamId: TEAM_NORTH, planId: "PLAN-CROSS", patientId: "PATIENT-CROSS" });

    await expect(
      runInTeamSession(pool, { teamId: TEAM_SOUTH, auditToken: nextAuditToken() }, async (client) => {
        await client.query("insert into caring_contacts.teams (id) values ($1) on conflict (id) do nothing", [
          TEAM_SOUTH,
        ]);
        await insertAuditEvent(client, {
          teamId: TEAM_SOUTH,
          actorId: "ACTOR-SOUTH",
          actorRoles: ["coordinator"],
          action: "createPlan",
          objectType: "plan",
          objectId: "PLAN-CROSS",
          outcome: "allowed",
          idempotencyKey: "attest-cross",
        });
        await client.query(
          `insert into caring_contacts.plan_assurances (plan_id, team_id, assurance, actor_id, attested_at)
           values ($1, $2, $3, 'ACTOR-SOUTH', now())`,
          ["PLAN-CROSS", TEAM_SOUTH, PLAN_ASSURANCE_VALUES[0]],
        );
      }),
    ).rejects.toThrow(/plan_assurances_plan_fk/);
  });

  it("enables and forces row-level security on every patient-bearing table", async () => {
    const { rows } = await pool.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'caring_contacts' and c.relkind = 'r'`,
    );
    const byName = new Map(rows.map((row) => [row.relname, row]));
    for (const table of PATIENT_BEARING_TABLES) {
      expect(byName.get(table)?.relrowsecurity, `${table} row security`).toBe(true);
      expect(byName.get(table)?.relforcerowsecurity, `${table} forced row security`).toBe(true);
    }
  });

  describe("row-level security", () => {
    beforeEach(async () => {
      await seedPlan(pool, { teamId: TEAM_NORTH, planId: "PLAN-N", patientId: "PATIENT-N" });
    });

    it("shows a team its own rows, so the denials below mean scoping and not absence", async () => {
      const rows = await runInTeamSession(pool, { teamId: TEAM_NORTH }, async (client) => {
        const result = await client.query("select id from caring_contacts.plans");
        return result.rows;
      });
      expect(rows.map((row) => row.id)).toEqual(["PLAN-N"]);
    });

    it("returns ZERO ROWS to another team, never an error that would reveal the row exists", async () => {
      const result = await runInTeamSession(pool, { teamId: TEAM_SOUTH }, async (client) => ({
        plans: (await client.query("select id from caring_contacts.plans")).rows,
        byId: (await client.query("select id from caring_contacts.plans where id = $1", ["PLAN-N"])).rows,
        contacts: (await client.query("select id from caring_contacts.contacts")).rows,
        audit: (await client.query("select id from caring_contacts.audit_events")).rows,
      }));

      expect(result.plans).toEqual([]);
      expect(result.byId).toEqual([]);
      expect(result.contacts).toEqual([]);
      expect(result.audit).toEqual([]);
    });

    it("refuses a cross-team write instead of silently rewriting another team's plan", async () => {
      const updated = await runInTeamSession(
        pool,
        { teamId: TEAM_SOUTH, auditToken: nextAuditToken() },
        async (client) => {
          await client.query("insert into caring_contacts.teams (id) values ($1) on conflict do nothing", [TEAM_SOUTH]);
          await insertAuditEvent(client, {
            teamId: TEAM_SOUTH,
            actorId: "ACTOR-SOUTH",
            actorRoles: ["coordinator"],
            action: "pausePlan",
            objectType: "plan",
            objectId: "PLAN-N",
            outcome: "denied",
            idempotencyKey: "cross-team",
          });
          const result = await client.query("update caring_contacts.plans set state = 'paused' where id = $1", [
            "PLAN-N",
          ]);
          return result.rowCount;
        },
      );
      expect(updated).toBe(0);

      const { rows } = await pool.query<{ state: string }>(
        "select state from caring_contacts.plans where id = 'PLAN-N'",
      );
      expect(rows[0].state).toBe("active");
    });

    it("denies an anonymous session: nothing readable, and nothing writable", async () => {
      const readable = await runInTeamSession(pool, { teamId: TEAM_NORTH, role: ANON_ROLE }, async (client) => ({
        plans: (await client.query("select id from caring_contacts.plans")).rows,
        contacts: (await client.query("select id from caring_contacts.contacts")).rows,
        audit: (await client.query("select id from caring_contacts.audit_events")).rows,
      }));
      expect(readable.plans).toEqual([]);
      expect(readable.contacts).toEqual([]);
      expect(readable.audit).toEqual([]);

      await expect(
        runInTeamSession(pool, { teamId: TEAM_NORTH, role: ANON_ROLE, auditToken: nextAuditToken() }, (client) =>
          client.query("update caring_contacts.plans set state = 'paused' where id = 'PLAN-N'"),
        ),
      ).rejects.toThrow(/permission denied/i);
    });

    it("denies a session that names no team at all", async () => {
      const rows = await runInTeamSession(pool, { teamId: null }, async (client) => {
        const result = await client.query("select id from caring_contacts.plans");
        return result.rows;
      });
      expect(rows).toEqual([]);
    });
  });

  describe("one non-terminal plan per patient", () => {
    it("refuses a second active plan for the same patient", async () => {
      await seedPlan(pool, { teamId: TEAM_NORTH, planId: "PLAN-1", patientId: "PATIENT-1" });

      await expect(seedPlan(pool, { teamId: TEAM_NORTH, planId: "PLAN-2", patientId: "PATIENT-1" })).rejects.toThrow(
        /plans_one_non_terminal_per_patient/,
      );
    });

    it("refuses a second active plan raised by a different team", async () => {
      await seedPlan(pool, { teamId: TEAM_NORTH, planId: "PLAN-1", patientId: "PATIENT-1" });

      await expect(seedPlan(pool, { teamId: TEAM_SOUTH, planId: "PLAN-2", patientId: "PATIENT-1" })).rejects.toThrow(
        /plans_one_non_terminal_per_patient/,
      );
    });

    it("allows a new plan once the previous one has ended", async () => {
      await seedPlan(pool, { teamId: TEAM_NORTH, planId: "PLAN-1", patientId: "PATIENT-1", state: "withdrawn" });
      await expect(
        seedPlan(pool, { teamId: TEAM_NORTH, planId: "PLAN-2", patientId: "PATIENT-1" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("one dispatch record per contact attempt", () => {
    beforeEach(async () => {
      await seedPlan(pool, { teamId: TEAM_NORTH, planId: "PLAN-N", patientId: "PATIENT-N" });
    });

    async function recordDispatch(attempt: number): Promise<void> {
      await runInTeamSession(pool, { teamId: TEAM_NORTH, auditToken: nextAuditToken() }, async (client) => {
        await insertAuditEvent(client, {
          teamId: TEAM_NORTH,
          actorId: "SYSTEM-DISPATCHER",
          actorRoles: ["contactDispatcher"],
          action: "startContactDispatch",
          objectType: "contact",
          objectId: "PLAN-N--contact-1",
          outcome: "allowed",
          idempotencyKey: `dispatch-${attempt}`,
        });
        await client.query(
          `insert into caring_contacts.contact_dispatches (contact_id, team_id, attempt, idempotency_key)
           values ($1, $2, $3, $4)`,
          ["PLAN-N--contact-1", TEAM_NORTH, attempt, `dispatch-${attempt}`],
        );
      });
    }

    it("accepts successive attempts for one contact", async () => {
      await recordDispatch(1);
      await expect(recordDispatch(2)).resolves.toBeUndefined();
    });

    it("refuses a duplicate dispatch record for the same contact and attempt", async () => {
      await recordDispatch(1);
      await expect(recordDispatch(1)).rejects.toThrow(/contact_dispatches_unique_attempt/);
    });
  });

  describe("audit insertion happens in the same transaction as the change", () => {
    beforeEach(async () => {
      await seedPlan(pool, { teamId: TEAM_NORTH, planId: "PLAN-N", patientId: "PATIENT-N" });
    });

    it("accepts a change that writes its audit event in the same transaction", async () => {
      await runInTeamSession(pool, { teamId: TEAM_NORTH, auditToken: nextAuditToken() }, async (client) => {
        await insertAuditEvent(client, {
          teamId: TEAM_NORTH,
          actorId: "ACTOR-1",
          actorRoles: ["coordinator"],
          action: "pausePlan",
          objectType: "plan",
          objectId: "PLAN-N",
          outcome: "allowed",
          idempotencyKey: "audited-pause",
        });
        await client.query("update caring_contacts.plans set state = 'paused', version = 2 where id = 'PLAN-N'");
      });

      const { rows } = await pool.query<{ state: string }>(
        "select state from caring_contacts.plans where id = 'PLAN-N'",
      );
      expect(rows[0].state).toBe("paused");
    });

    it("REFUSES a direct update that writes no audit event, and leaves the row untouched", async () => {
      await expect(
        runInTeamSession(pool, { teamId: TEAM_NORTH, auditToken: nextAuditToken() }, (client) =>
          client.query("update caring_contacts.plans set state = 'paused', version = 2 where id = 'PLAN-N'"),
        ),
      ).rejects.toThrow(/caring-contacts-audit-required/);

      const { rows } = await pool.query<{ state: string; version: number }>(
        "select state, version from caring_contacts.plans where id = 'PLAN-N'",
      );
      expect(rows[0]).toMatchObject({ state: "active", version: 1 });
    });

    it("REFUSES a change made outside an audited transaction at all", async () => {
      await expect(
        runInTeamSession(pool, { teamId: TEAM_NORTH }, (client) =>
          client.query("update caring_contacts.contacts set state = 'cancelled', version = 2 where plan_id = 'PLAN-N'"),
        ),
      ).rejects.toThrow(/caring-contacts-audit-required/);

      const { rows } = await pool.query<{ state: string }>(
        "select state from caring_contacts.contacts where plan_id = 'PLAN-N'",
      );
      expect(rows.every((row) => row.state === "scheduled")).toBe(true);
    });

    it("REFUSES a delete that writes no audit event", async () => {
      await expect(
        runInTeamSession(pool, { teamId: TEAM_NORTH }, (client) =>
          client.query("delete from caring_contacts.contacts where plan_id = 'PLAN-N'"),
        ),
      ).rejects.toThrow(/caring-contacts-audit-required/);

      const { rows } = await pool.query<{ count: string }>(
        "select count(*)::text as count from caring_contacts.contacts where plan_id = 'PLAN-N'",
      );
      expect(Number(rows[0].count)).toBe(2);
    });

    // Migration 0009 extends the same guard to the two governance tables that were listed in no
    // `attach_audit_guard` call before it, and so carried no `require_audit` trigger at all:
    // `pathway_versions`, whose state decides which message content a patient actually receives,
    // and `retention_state`, the record that a patient's identifying detail was cleared. The
    // assertions run against the RUNNING database as `caring_contacts_app`, so they prove the
    // database refuses the write -- not that 0009 contains a string. A later migration that
    // detached either trigger would turn them red.
    it("REFUSES an unaudited pathway version state change (0009)", async () => {
      await expect(
        runInTeamSession(pool, { teamId: TEAM_NORTH }, (client) =>
          client.query(
            "update caring_contacts.pathway_versions set state = 'retired', retired_at = now() where id = 'PLAN-N-PATHWAY'",
          ),
        ),
      ).rejects.toThrow(/caring-contacts-audit-required/);

      const { rows } = await pool.query<{ state: string; retired_at: Date | null }>(
        "select state, retired_at from caring_contacts.pathway_versions where id = 'PLAN-N-PATHWAY'",
      );
      expect(rows[0].state).toBe("approved");
      expect(rows[0].retired_at).toBeNull();
    });

    it("REFUSES an unaudited retention clearance record (0009)", async () => {
      // A retention record belongs to an episode that has ENDED, so it is written against a
      // completed plan rather than the active PLAN-N the neighbouring cases depend on.
      await seedPlan(pool, {
        teamId: TEAM_NORTH,
        planId: "PLAN-N-DONE",
        patientId: "PATIENT-N-DONE",
        state: "completed",
      });

      await expect(
        runInTeamSession(pool, { teamId: TEAM_NORTH }, (client) =>
          client.query(
            `insert into caring_contacts.retention_state (plan_id, team_id, terminal_at, cleared_at)
             values ('PLAN-N-DONE', $1, now(), now())`,
            [TEAM_NORTH],
          ),
        ),
      ).rejects.toThrow(/caring-contacts-audit-required/);

      const { rows } = await pool.query<{ count: string }>(
        "select count(*)::text as count from caring_contacts.retention_state where plan_id = 'PLAN-N-DONE'",
      );
      expect(Number(rows[0].count)).toBe(0);
    });

    it("still accepts the audited writes the repository makes to both governance tables (0009)", async () => {
      await seedPlan(pool, {
        teamId: TEAM_NORTH,
        planId: "PLAN-N-DONE",
        patientId: "PATIENT-N-DONE",
        state: "completed",
      });

      await runInTeamSession(pool, { teamId: TEAM_NORTH, auditToken: nextAuditToken() }, async (client) => {
        await insertAuditEvent(client, {
          teamId: TEAM_NORTH,
          actorId: "ACTOR-1",
          actorRoles: ["clinicalProgrammeLead"],
          action: "retirePathwayVersion",
          objectType: "pathwayVersion",
          objectId: "PLAN-N-PATHWAY",
          outcome: "allowed",
          idempotencyKey: "audited-retire",
        });
        await client.query(
          "update caring_contacts.pathway_versions set state = 'retired', retired_at = now() where id = 'PLAN-N-PATHWAY'",
        );
        await client.query(
          `insert into caring_contacts.retention_state (plan_id, team_id, terminal_at, cleared_at)
             values ('PLAN-N-DONE', $1, now(), now())`,
          [TEAM_NORTH],
        );
      });

      const { rows: pathwayRows } = await pool.query<{ state: string }>(
        "select state from caring_contacts.pathway_versions where id = 'PLAN-N-PATHWAY'",
      );
      expect(pathwayRows[0].state).toBe("retired");
      const { rows: retentionRows } = await pool.query<{ count: string }>(
        "select count(*)::text as count from caring_contacts.retention_state where plan_id = 'PLAN-N-DONE'",
      );
      expect(Number(retentionRows[0].count)).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Migration 0003 — the workspace schema.
//
// Every assertion below is made against the RUNNING DATABASE as `caring_contacts_app`, never by
// reading the SQL text and never as the migration superuser. A superuser bypasses row-level
// security outright, and a regex over a migration file proves that a string was written rather
// than that the database refuses anything.
// ---------------------------------------------------------------------------
describe("the workspace schema", () => {
  const STOP_ONE = "11111111-1111-4111-8111-111111111111";
  const STOP_TWO = "22222222-2222-4222-8222-222222222222";

  const RESTART_APPROVERS = Object.freeze([
    { role: "incidentLead", actorId: "ACTOR-INCIDENT-LEAD" },
    { role: "privacySecurityOwner", actorId: "ACTOR-PRIVACY-OWNER" },
    { role: "clinicalProgrammeLead", actorId: "ACTOR-PROGRAMME-LEAD" },
  ] as const);

  async function registerTeam(teamId: string): Promise<void> {
    await runInTeamSession(pool, { teamId, auditToken: nextAuditToken() }, async (client) => {
      await client.query("insert into caring_contacts.teams (id) values ($1) on conflict do nothing", [teamId]);
    });
  }

  /**
   * Records a stop: one immutable `service_stops` row for the incident, then the singleton
   * pointed at it. The singleton is upserted because there is only ever one row.
   */
  async function recordStop(teamId: string, stopId: string, audited = true): Promise<void> {
    await registerTeam(teamId);
    await runInTeamSession(pool, { teamId, auditToken: nextAuditToken() }, async (client) => {
      if (audited) {
        await insertAuditEvent(client, {
          teamId,
          actorId: "ACTOR-RESPONDER",
          actorRoles: ["teamLead"],
          action: "stopService",
          objectType: "service",
          objectId: stopId,
          outcome: "allowed",
          idempotencyKey: `stop-${stopId}`,
        });
      }
      await client.query(
        `insert into caring_contacts.service_stops
           (stop_id, reason, note, stopped_by, stopped_at, reported_by_team_id)
         values ($1, 'wrong-recipient', 'A message reached the wrong number.', 'ACTOR-RESPONDER', now(), $2)`,
        [stopId, teamId],
      );
      await client.query(
        `insert into caring_contacts.service_state
           (stopped, stopped_by, stopped_at, reported_by_team_id, stop_id, updated_at)
         values (true, 'ACTOR-RESPONDER', now(), $1, $2, now())
         on conflict (singleton) do update set
           stopped = true,
           stopped_by = excluded.stopped_by,
           stopped_at = excluded.stopped_at,
           reported_by_team_id = excluded.reported_by_team_id,
           stop_id = excluded.stop_id,
           updated_at = excluded.updated_at`,
        [teamId, stopId],
      );
    });
  }

  async function restartService(teamId: string, stopId: string): Promise<void> {
    await runInTeamSession(pool, { teamId, auditToken: nextAuditToken() }, async (client) => {
      await insertAuditEvent(client, {
        teamId,
        actorId: "ACTOR-RESPONDER",
        actorRoles: ["teamLead"],
        action: "restartService",
        objectType: "service",
        objectId: stopId,
        outcome: "allowed",
        idempotencyKey: "restart-service",
      });
      await client.query(
        `update caring_contacts.service_state
         set stopped = false, stop_id = null, updated_at = now()`,
      );
      // `restarted_at` is the ONLY field of a recorded incident that ever changes.
      await client.query("update caring_contacts.service_stops set restarted_at = now() where stop_id = $1", [stopId]);
    });
  }

  async function approveRestart(teamId: string, stopId: string, role: string, actorId: string): Promise<void> {
    await runInTeamSession(pool, { teamId, auditToken: nextAuditToken() }, async (client) => {
      await insertAuditEvent(client, {
        teamId,
        actorId,
        actorRoles: ["teamLead"],
        action: "approveServiceRestart",
        objectType: "service",
        objectId: stopId,
        outcome: "allowed",
        idempotencyKey: `approve-${stopId}-${role}-${actorId}`,
      });
      await client.query(
        `insert into caring_contacts.service_restart_approvals
           (stop_id, role, actor_id, approved_at, approved_by_team_id)
         values ($1, $2, $3, now(), $4)`,
        [stopId, role, actorId, teamId],
      );
    });
  }

  /** Inserts a plan naming the referral and pathway version given, creating no parent rows. */
  async function insertPlanNaming(options: {
    teamId: string;
    planId: string;
    patientId: string;
    referralId: string;
    pathwayVersionId: string;
  }): Promise<void> {
    await runInTeamSession(pool, { teamId: options.teamId, auditToken: nextAuditToken() }, async (client) => {
      await insertAuditEvent(client, {
        teamId: options.teamId,
        actorId: "ACTOR-COORDINATOR",
        actorRoles: ["coordinator"],
        action: "createPlan",
        objectType: "plan",
        objectId: options.planId,
        outcome: "allowed",
        idempotencyKey: `create-${options.planId}`,
      });
      await client.query(
        `insert into caring_contacts.plans
           (id, team_id, patient_id, referral_id, pathway_version_id, state, version, outcome,
            discharge_at, sending_preference, patient_name, patient_mobile_number, patient_identifiers)
         values ($1, $2, $3, $4, $5, 'active', 1, 'inProgress', '2026-03-02T02:00:00.000Z', 'morning',
                 'Seed Patient', '+61 491 570 156', array['UR-1'])`,
        [options.planId, options.teamId, options.patientId, options.referralId, options.pathwayVersionId],
      );
    });
  }

  async function claimAssignment(teamId: string, planId: string, ownerId: string): Promise<void> {
    await runInTeamSession(pool, { teamId, auditToken: nextAuditToken() }, async (client) => {
      await insertAuditEvent(client, {
        teamId,
        actorId: ownerId,
        actorRoles: ["coordinator"],
        action: "claimPlan",
        objectType: "plan",
        objectId: planId,
        outcome: "allowed",
        idempotencyKey: `claim-${planId}-${ownerId}`,
      });
      await client.query(
        `insert into caring_contacts.plan_assignments
           (plan_id, team_id, owner_id, claimed_at, coverage_from, coverage_until)
         values ($1, $2, $3, now(), '2026-03-02', '2026-03-09')`,
        [planId, teamId, ownerId],
      );
    });
  }

  async function recordReassignment(teamId: string, planId: string, actorId: string): Promise<void> {
    await runInTeamSession(pool, { teamId, auditToken: nextAuditToken() }, async (client) => {
      await insertAuditEvent(client, {
        teamId,
        actorId,
        actorRoles: ["teamLead"],
        action: "reassignPlan",
        objectType: "plan",
        objectId: planId,
        outcome: "allowed",
        idempotencyKey: `reassign-${planId}-${actorId}`,
      });
      await client.query(
        `insert into caring_contacts.plan_reassignments
           (plan_id, team_id, from_actor_id, to_actor_id, reason, at)
         values ($1, $2, 'ACTOR-PREVIOUS', $3, 'Cover while the previous owner is on leave.', now())`,
        [planId, teamId, actorId],
      );
    });
  }

  async function approvePathwayVersion(
    teamId: string,
    pathwayVersionId: string,
    role: string,
    actorId: string,
    authorId: string,
  ): Promise<void> {
    await runInTeamSession(pool, { teamId, auditToken: nextAuditToken() }, async (client) => {
      await insertAuditEvent(client, {
        teamId,
        actorId,
        actorRoles: ["teamLead"],
        action: "approvePathwayVersion",
        objectType: "pathwayVersion",
        objectId: pathwayVersionId,
        outcome: "allowed",
        idempotencyKey: `approve-${pathwayVersionId}-${role}-${actorId}`,
      });
      await client.query(
        `insert into caring_contacts.pathway_version_approvals
           (pathway_version_id, team_id, author_id, role, actor_id, approved_at)
         values ($1, $2, $3, $4, $5, now())`,
        [pathwayVersionId, teamId, authorId, role, actorId],
      );
    });
  }

  async function setNotificationPreference(teamId: string, actorId: string): Promise<void> {
    await runInTeamSession(pool, { teamId, auditToken: nextAuditToken() }, async (client) => {
      await insertAuditEvent(client, {
        teamId,
        actorId,
        actorRoles: ["coordinator"],
        action: "setNotificationPreferences",
        objectType: "actor",
        objectId: actorId,
        outcome: "allowed",
        idempotencyKey: `prefs-${actorId}`,
      });
      await client.query(
        `insert into caring_contacts.notification_preferences (actor_id, team_id, opted_in)
         values ($1, $2, array['dailyDigest'])`,
        [actorId, teamId],
      );
    });
  }

  async function setTrainingRecord(teamId: string, actorId: string): Promise<void> {
    await runInTeamSession(pool, { teamId, auditToken: nextAuditToken() }, async (client) => {
      await insertAuditEvent(client, {
        teamId,
        actorId,
        actorRoles: ["coordinator"],
        action: "recordTrainingCompletion",
        objectType: "actor",
        objectId: actorId,
        outcome: "allowed",
        idempotencyKey: `training-${actorId}`,
      });
      await client.query(
        `insert into caring_contacts.training_records (actor_id, team_id, completed)
         values ($1, $2, array['caringContactsInduction'])`,
        [actorId, teamId],
      );
    });
  }

  // Standalone extract: this checks PsychSift's own supabase/migrations folder, which is not part of this copy.
  it.skip("keeps every caring-contact migration out of the PsychSift migration directory", () => {
    const caringContactMigrations = readdirSync(path.join(process.cwd(), "caring-contacts", "supabase", "migrations"));
    expect(caringContactMigrations).toContain("0003_caring_contacts_workspace.sql");
    const repositoryMigrations = readdirSync(path.join(process.cwd(), "supabase", "migrations"));
    for (const file of caringContactMigrations) {
      expect(repositoryMigrations).not.toContain(file);
    }
  });

  describe("the service stop is a singleton, not one row per team", () => {
    it("refuses a second service_state row outright", async () => {
      await recordStop(TEAM_NORTH, STOP_ONE);

      await expect(
        runInTeamSession(pool, { teamId: TEAM_NORTH, auditToken: nextAuditToken() }, (client) =>
          client.query(
            `insert into caring_contacts.service_state
               (stopped, stopped_by, stopped_at, reported_by_team_id, stop_id)
             values (true, 'ACTOR-OTHER', now(), $1, $2)`,
            [TEAM_NORTH, STOP_TWO],
          ),
        ),
      ).rejects.toThrow(/service_state_pkey/);
    });

    it("refuses a row that tries to escape the singleton key", async () => {
      await recordStop(TEAM_NORTH, STOP_ONE);

      await expect(
        runInTeamSession(pool, { teamId: TEAM_NORTH, auditToken: nextAuditToken() }, (client) =>
          client.query(
            `insert into caring_contacts.service_state
               (singleton, stopped, stopped_by, stopped_at, reported_by_team_id, stop_id)
             values (false, true, 'ACTOR-OTHER', now(), $1, $2)`,
            [TEAM_NORTH, STOP_TWO],
          ),
        ),
      ).rejects.toThrow(/service_state_is_singleton/);
    });

    it("shows a stop raised by one team to EVERY other team", async () => {
      // Contrast this deliberately with "returns ZERO ROWS to another team" above: a plan raised by
      // TEAM-NORTH is invisible to TEAM-SOUTH, and that is the whole point of the team-scope policy.
      // The service stop is the one thing that must NOT behave that way. A team-scoped stop would
      // read as "the service is running" to every team but the one that reported the incident,
      // while the sending path they had all been told to halt kept running.
      await registerTeam(TEAM_SOUTH);
      await recordStop(TEAM_NORTH, STOP_ONE);

      const rows = await runInTeamSession(pool, { teamId: TEAM_SOUTH }, async (client) => {
        const result = await client.query<{ stopped: boolean; reported_by_team_id: string }>(
          "select stopped, reported_by_team_id from caring_contacts.service_state",
        );
        return result.rows;
      });

      expect(rows).toHaveLength(1);
      expect(rows[0].stopped).toBe(true);
      expect(rows[0].reported_by_team_id).toBe(TEAM_NORTH);
    });

    it("still shows a session that names NO team nothing at all", async () => {
      await recordStop(TEAM_NORTH, STOP_ONE);

      const rows = await runInTeamSession(pool, { teamId: null }, async (client) => {
        const result = await client.query("select stopped from caring_contacts.service_state");
        return result.rows;
      });

      expect(rows).toEqual([]);
    });
  });

  describe("restart approvals are keyed on the stop, never on the team", () => {
    it("refuses a second approval from the same person under a different role", async () => {
      await recordStop(TEAM_NORTH, STOP_ONE);
      await approveRestart(TEAM_NORTH, STOP_ONE, "incidentLead", "ACTOR-X");

      await expect(approveRestart(TEAM_NORTH, STOP_ONE, "privacySecurityOwner", "ACTOR-X")).rejects.toThrow(
        /service_restart_approvals_unique_stop_actor/,
      );
    });

    it("refuses a second approval in the same role from a different person", async () => {
      await recordStop(TEAM_NORTH, STOP_ONE);
      await approveRestart(TEAM_NORTH, STOP_ONE, "incidentLead", "ACTOR-X");

      await expect(approveRestart(TEAM_NORTH, STOP_ONE, "incidentLead", "ACTOR-Y")).rejects.toThrow(
        /service_restart_approvals_unique_stop_role/,
      );
    });

    it("lets the SAME three people approve a LATER stop", async () => {
      // Keyed on the team, the approvals recorded for a first incident would permanently bar their
      // approvers from approving any later one, so a team's second incident could never be
      // restarted. Keyed on the stop, "three different people per restart" holds per incident.
      await recordStop(TEAM_NORTH, STOP_ONE);
      for (const approver of RESTART_APPROVERS) {
        await approveRestart(TEAM_NORTH, STOP_ONE, approver.role, approver.actorId);
      }
      await restartService(TEAM_NORTH, STOP_ONE);

      await recordStop(TEAM_NORTH, STOP_TWO);
      for (const approver of RESTART_APPROVERS) {
        await expect(approveRestart(TEAM_NORTH, STOP_TWO, approver.role, approver.actorId)).resolves.toBeUndefined();
      }

      const { rows } = await pool.query<{ count: string }>(
        "select count(*)::text as count from caring_contacts.service_restart_approvals",
      );
      expect(Number(rows[0].count)).toBe(6);
    });
  });

  describe("a plan may only name a referral and pathway version that exist, in its own team", () => {
    beforeEach(async () => {
      await seedPlan(pool, { teamId: TEAM_NORTH, planId: "PLAN-N", patientId: "PATIENT-N" });
    });

    it("refuses a plan whose pathway version has no parent row", async () => {
      await expect(
        insertPlanNaming({
          teamId: TEAM_NORTH,
          planId: "PLAN-BAD-PATHWAY",
          patientId: "PATIENT-BAD-PATHWAY",
          referralId: "PLAN-N-REFERRAL",
          pathwayVersionId: "PATHWAY-THAT-WAS-NEVER-CREATED",
        }),
      ).rejects.toThrow(/plans_pathway_version_fk/);
    });

    it("refuses a plan whose referral has no parent row", async () => {
      await expect(
        insertPlanNaming({
          teamId: TEAM_NORTH,
          planId: "PLAN-BAD-REFERRAL",
          patientId: "PATIENT-BAD-REFERRAL",
          referralId: "REFERRAL-THAT-WAS-NEVER-CREATED",
          pathwayVersionId: "PLAN-N-PATHWAY",
        }),
      ).rejects.toThrow(/plans_referral_fk/);
    });

    it("refuses a plan that reaches across teams for its referral", async () => {
      // Foreign-key checks are performed by the system and are NOT subject to row-level security,
      // so a bare key would happily let TEAM-NORTH's plan point at TEAM-SOUTH's referral. The key
      // is composite so the team travels with the link.
      await seedPlan(pool, { teamId: TEAM_SOUTH, planId: "PLAN-S", patientId: "PATIENT-S" });

      await expect(
        insertPlanNaming({
          teamId: TEAM_NORTH,
          planId: "PLAN-CROSS-TEAM",
          patientId: "PATIENT-CROSS-TEAM",
          referralId: "PLAN-S-REFERRAL",
          pathwayVersionId: "PLAN-N-PATHWAY",
        }),
      ).rejects.toThrow(/plans_referral_fk/);
    });

    it("accepts a plan whose referral and pathway version both belong to its own team", async () => {
      await expect(
        insertPlanNaming({
          teamId: TEAM_NORTH,
          planId: "PLAN-SECOND",
          patientId: "PATIENT-SECOND",
          referralId: "PLAN-N-REFERRAL",
          pathwayVersionId: "PLAN-N-PATHWAY",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("the new workspace tables carry the same guarantees as the old ones", () => {
    beforeEach(async () => {
      await seedPlan(pool, { teamId: TEAM_NORTH, planId: "PLAN-N", patientId: "PATIENT-N" });
    });

    it("returns ZERO ROWS from plan_assignments to another team", async () => {
      await claimAssignment(TEAM_NORTH, "PLAN-N", "ACTOR-NORTH");
      await registerTeam(TEAM_SOUTH);

      const rows = await runInTeamSession(pool, { teamId: TEAM_SOUTH }, async (client) => {
        const result = await client.query("select plan_id from caring_contacts.plan_assignments");
        return result.rows;
      });

      expect(rows).toEqual([]);
    });

    it("shows a team its own assignment, so the denial above means scoping and not absence", async () => {
      await claimAssignment(TEAM_NORTH, "PLAN-N", "ACTOR-NORTH");

      const rows = await runInTeamSession(pool, { teamId: TEAM_NORTH }, async (client) => {
        const result = await client.query<{ plan_id: string }>("select plan_id from caring_contacts.plan_assignments");
        return result.rows;
      });

      expect(rows.map((row) => row.plan_id)).toEqual(["PLAN-N"]);
    });

    it("REFUSES an assignment written with no audit event in the same transaction", async () => {
      await expect(
        runInTeamSession(pool, { teamId: TEAM_NORTH, auditToken: nextAuditToken() }, (client) =>
          client.query(
            `insert into caring_contacts.plan_assignments (plan_id, team_id, owner_id, claimed_at)
             values ('PLAN-N', $1, 'ACTOR-NORTH', now())`,
            [TEAM_NORTH],
          ),
        ),
      ).rejects.toThrow(/caring-contacts-audit-required/);

      const { rows } = await pool.query<{ count: string }>(
        "select count(*)::text as count from caring_contacts.plan_assignments",
      );
      expect(Number(rows[0].count)).toBe(0);
    });

    it("keeps coverage windows as AWST calendar days rather than instants", async () => {
      const { rows } = await pool.query<{ column_name: string; data_type: string }>(
        `select column_name, data_type from information_schema.columns
         where table_schema = 'caring_contacts' and table_name = 'plan_assignments'
           and column_name in ('coverage_from', 'coverage_until')
         order by column_name`,
      );
      expect(rows).toEqual([
        { column_name: "coverage_from", data_type: "text" },
        { column_name: "coverage_until", data_type: "text" },
      ]);
    });
  });

  describe("a stop is an immutable incident row, so an earlier incident's approvals cannot be reused", () => {
    it("gives a NEW stop zero approvals of its own", async () => {
      // The hazard this guards: after a restart the first incident's three approval rows survive,
      // by design, as the record of what happened. Nothing may let them be counted toward the
      // NEXT incident — a store reading approvals without filtering on the current stop would
      // present a brand-new live incident as already three-person approved, which is a
      // zero-approval restart of exactly the failure the three-person rule exists to prevent.
      await recordStop(TEAM_NORTH, STOP_ONE);
      for (const approver of RESTART_APPROVERS) {
        await approveRestart(TEAM_NORTH, STOP_ONE, approver.role, approver.actorId);
      }
      await restartService(TEAM_NORTH, STOP_ONE);
      await recordStop(TEAM_NORTH, STOP_TWO);

      const rows = await runInTeamSession(pool, { teamId: TEAM_NORTH }, async (client) => {
        const result = await client.query<{ count: string }>(
          `select count(*)::text as count
           from caring_contacts.service_restart_approvals a
           join caring_contacts.service_state s on s.stop_id = a.stop_id`,
        );
        return result.rows;
      });

      expect(Number(rows[0].count)).toBe(0);

      // …while the first incident's record is untouched, because it is what happened.
      const { rows: history } = await pool.query<{ count: string }>(
        "select count(*)::text as count from caring_contacts.service_restart_approvals where stop_id = $1",
        [STOP_ONE],
      );
      expect(Number(history[0].count)).toBe(3);
    });

    it("refuses an approval that names a stop that was never recorded", async () => {
      await recordStop(TEAM_NORTH, STOP_ONE);

      await expect(
        approveRestart(TEAM_NORTH, "33333333-3333-4333-8333-333333333333", "incidentLead", "ACTOR-X"),
      ).rejects.toThrow(/service_restart_approvals_stop_fk/);
    });

    it("keeps the closed incident readable after the restart", async () => {
      await recordStop(TEAM_NORTH, STOP_ONE);
      await restartService(TEAM_NORTH, STOP_ONE);

      const rows = await runInTeamSession(pool, { teamId: TEAM_SOUTH }, async (client) => {
        const result = await client.query<{ stop_id: string; restarted_at: string | null }>(
          "select stop_id, restarted_at from caring_contacts.service_stops",
        );
        return result.rows;
      });

      expect(rows).toHaveLength(1);
      expect(rows[0].stop_id).toBe(STOP_ONE);
      expect(rows[0].restarted_at).not.toBeNull();
    });
  });

  describe("stopping the service is audited like every other change", () => {
    it("REFUSES a stop written with no audit event in the same transaction", async () => {
      await expect(recordStop(TEAM_NORTH, STOP_ONE, false)).rejects.toThrow(/caring-contacts-audit-required/);

      const { rows } = await pool.query<{ count: string }>(
        "select count(*)::text as count from caring_contacts.service_stops",
      );
      expect(Number(rows[0].count)).toBe(0);
    });
  });

  describe("assignment records cannot be attached to another team's plan", () => {
    beforeEach(async () => {
      await seedPlan(pool, { teamId: TEAM_NORTH, planId: "PLAN-N", patientId: "PATIENT-N" });
      await registerTeam(TEAM_SOUTH);
    });

    it("refuses an assignment TEAM-SOUTH writes for TEAM-NORTH's plan", async () => {
      // A bare `plan_id references plans (id)` would accept this: foreign-key checks bypass
      // row-level security, and the policy's WITH CHECK only validates the team the writer
      // CLAIMED. The row would then be visible to TEAM-SOUTH and invisible to TEAM-NORTH, which
      // misplaces the assignment's whole scope. The key is composite so it cannot be claimed.
      await expect(claimAssignment(TEAM_SOUTH, "PLAN-N", "ACTOR-SOUTH")).rejects.toThrow(/plan_assignments_plan_fk/);
    });

    it("refuses a reassignment record TEAM-SOUTH writes for TEAM-NORTH's plan", async () => {
      await expect(recordReassignment(TEAM_SOUTH, "PLAN-N", "ACTOR-SOUTH")).rejects.toThrow(
        /plan_reassignments_plan_fk/,
      );
    });

    it("accepts both records from the team that owns the plan", async () => {
      await expect(claimAssignment(TEAM_NORTH, "PLAN-N", "ACTOR-NORTH")).resolves.toBeUndefined();
      await expect(recordReassignment(TEAM_NORTH, "PLAN-N", "ACTOR-NORTH")).resolves.toBeUndefined();
    });
  });

  describe("pathway version approvals", () => {
    // seedPlan creates `PLAN-N-PATHWAY` in TEAM-NORTH, authored by SEED-AUTHOR.
    const PATHWAY = "PLAN-N-PATHWAY";

    beforeEach(async () => {
      await seedPlan(pool, { teamId: TEAM_NORTH, planId: "PLAN-N", patientId: "PATIENT-N" });
    });

    it("records an approval by somebody other than the author", async () => {
      await expect(
        approvePathwayVersion(TEAM_NORTH, PATHWAY, "clinicalProgrammeLead", "ACTOR-CLINICAL", "SEED-AUTHOR"),
      ).resolves.toBeUndefined();
    });

    it("refuses the author approving the content they wrote", async () => {
      // The same rule the parent row carries: no single actor may both author and approve the
      // same clinical message content.
      await expect(
        approvePathwayVersion(TEAM_NORTH, PATHWAY, "clinicalProgrammeLead", "SEED-AUTHOR", "SEED-AUTHOR"),
      ).rejects.toThrow(/pathway_version_approvals_no_self_approval/);
    });

    it("refuses a second approval in the same role", async () => {
      await approvePathwayVersion(TEAM_NORTH, PATHWAY, "clinicalProgrammeLead", "ACTOR-CLINICAL", "SEED-AUTHOR");

      await expect(
        approvePathwayVersion(TEAM_NORTH, PATHWAY, "clinicalProgrammeLead", "ACTOR-OTHER", "SEED-AUTHOR"),
      ).rejects.toThrow(/pathway_version_approvals_unique_version_role/);
    });

    it("refuses one person supplying both approvals by changing role", async () => {
      await approvePathwayVersion(TEAM_NORTH, PATHWAY, "clinicalProgrammeLead", "ACTOR-CLINICAL", "SEED-AUTHOR");

      await expect(
        approvePathwayVersion(TEAM_NORTH, PATHWAY, "livedExperienceRepresentative", "ACTOR-CLINICAL", "SEED-AUTHOR"),
      ).rejects.toThrow(/pathway_version_approvals_unique_version_actor/);
    });

    it("refuses a role the domain does not define", async () => {
      await expect(
        approvePathwayVersion(TEAM_NORTH, PATHWAY, "chiefExecutive", "ACTOR-CLINICAL", "SEED-AUTHOR"),
      ).rejects.toThrow(/pathway_version_approvals_role_is_known/);
    });

    it("refuses an approval that reaches across teams for its pathway version", async () => {
      // The `team_id` half of the same composite key. Ruling 21 denormalises the team onto this
      // row so the standard policy attaches without a join; the key is what stops a writer
      // claiming a team the version does not belong to and relocating the row's whole scope.
      await registerTeam(TEAM_SOUTH);

      await expect(
        approvePathwayVersion(TEAM_SOUTH, PATHWAY, "clinicalProgrammeLead", "ACTOR-SOUTH", "SEED-AUTHOR"),
      ).rejects.toThrow(/pathway_version_approvals_version_fk/);
    });

    it("refuses an approval that misstates the author it is exempt from", async () => {
      // `author_id` is denormalised so the no-self-approval rule can be a CHECK. The composite
      // foreign key is what stops a writer simply naming a different author to escape it.
      await expect(
        approvePathwayVersion(TEAM_NORTH, PATHWAY, "clinicalProgrammeLead", "SEED-AUTHOR", "SOMEBODY-ELSE"),
      ).rejects.toThrow(/pathway_version_approvals_version_fk/);
    });
  });

  describe("per-person workspace settings are team-scoped like everything else", () => {
    beforeEach(async () => {
      await registerTeam(TEAM_NORTH);
      await registerTeam(TEAM_SOUTH);
    });

    it("shows a team its own notification preferences and none of another team's", async () => {
      await setNotificationPreference(TEAM_NORTH, "ACTOR-NORTH");

      const mine = await runInTeamSession(
        pool,
        { teamId: TEAM_NORTH },
        async (client) =>
          (await client.query<{ actor_id: string }>("select actor_id from caring_contacts.notification_preferences"))
            .rows,
      );
      const theirs = await runInTeamSession(
        pool,
        { teamId: TEAM_SOUTH },
        async (client) => (await client.query("select actor_id from caring_contacts.notification_preferences")).rows,
      );

      expect(mine.map((row) => row.actor_id)).toEqual(["ACTOR-NORTH"]);
      expect(theirs).toEqual([]);
    });

    it("shows a team its own training records and none of another team's", async () => {
      await setTrainingRecord(TEAM_NORTH, "ACTOR-NORTH");

      const mine = await runInTeamSession(
        pool,
        { teamId: TEAM_NORTH },
        async (client) =>
          (await client.query<{ actor_id: string }>("select actor_id from caring_contacts.training_records")).rows,
      );
      const theirs = await runInTeamSession(
        pool,
        { teamId: TEAM_SOUTH },
        async (client) => (await client.query("select actor_id from caring_contacts.training_records")).rows,
      );

      expect(mine.map((row) => row.actor_id)).toEqual(["ACTOR-NORTH"]);
      expect(theirs).toEqual([]);
    });
  });

  describe("a recorded incident cannot be rewritten", () => {
    // `service_stops` is the durable record of safety incidents, and `audit-integrity-loss` is
    // itself one of the five stop reasons — so a history table whose closed rows can be silently
    // rewritten undercuts the very thing it was added for. Immutable by convention plus a primary
    // key is not the standard this schema holds anywhere else.
    async function updateIncident(teamId: string, stopId: string, setClause: string): Promise<void> {
      await runInTeamSession(pool, { teamId, auditToken: nextAuditToken() }, async (client) => {
        await insertAuditEvent(client, {
          teamId,
          actorId: "ACTOR-RESPONDER",
          actorRoles: ["teamLead"],
          action: "updateServiceStop",
          objectType: "service",
          objectId: stopId,
          outcome: "allowed",
          idempotencyKey: `update-${stopId}`,
        });
        await client.query(`update caring_contacts.service_stops set ${setClause} where stop_id = $1`, [stopId]);
      });
    }

    beforeEach(async () => {
      await recordStop(TEAM_NORTH, STOP_ONE);
    });

    it("refuses a rewrite of the reason the incident was recorded under", async () => {
      // A valid reason, so the five-value check cannot fire first and answer a different question.
      await expect(updateIncident(TEAM_NORTH, STOP_ONE, "reason = 'duplicate-send'")).rejects.toThrow(
        /caring-contacts-service-stop-immutable/,
      );

      const { rows } = await pool.query<{ reason: string }>(
        "select reason from caring_contacts.service_stops where stop_id = $1",
        [STOP_ONE],
      );
      expect(rows[0].reason).toBe("wrong-recipient");
    });

    it("refuses a rewrite of who recorded the incident", async () => {
      await expect(updateIncident(TEAM_NORTH, STOP_ONE, "stopped_by = 'ACTOR-SOMEBODY-ELSE'")).rejects.toThrow(
        /caring-contacts-service-stop-immutable/,
      );
    });

    it("refuses a rewrite of the responder's note", async () => {
      await expect(updateIncident(TEAM_NORTH, STOP_ONE, "note = 'Nothing happened.'")).rejects.toThrow(
        /caring-contacts-service-stop-immutable/,
      );
    });

    it("still lets the restart be recorded against it", async () => {
      // The one field of a recorded incident that is meant to change.
      await expect(updateIncident(TEAM_NORTH, STOP_ONE, "restarted_at = now()")).resolves.toBeUndefined();

      const { rows } = await pool.query<{ restarted_at: string | null }>(
        "select restarted_at from caring_contacts.service_stops where stop_id = $1",
        [STOP_ONE],
      );
      expect(rows[0].restarted_at).not.toBeNull();
    });

    it("refuses to clear a restart that was already recorded", async () => {
      // null -> a value is the restart being recorded, and that stays allowed. The reverse is a
      // silent rewrite of a closed incident: a restarted stop that reads as never restarted.
      await updateIncident(TEAM_NORTH, STOP_ONE, "restarted_at = now()");

      await expect(updateIncident(TEAM_NORTH, STOP_ONE, "restarted_at = null")).rejects.toThrow(
        /caring-contacts-service-stop-immutable/,
      );

      const { rows } = await pool.query<{ restarted_at: string | null }>(
        "select restarted_at from caring_contacts.service_stops where stop_id = $1",
        [STOP_ONE],
      );
      expect(rows[0].restarted_at).not.toBeNull();
    });

    it("refuses to move a restart that was already recorded", async () => {
      // Backdating a restart is the same rewrite as clearing it, and reads as a shorter outage
      // than the one that happened. The comparison is made in the database so the assertion is
      // about the stored instant rather than about how a driver renders it.
      await updateIncident(TEAM_NORTH, STOP_ONE, "restarted_at = timestamptz '2026-03-02 11:00:00+08'");

      await expect(
        updateIncident(TEAM_NORTH, STOP_ONE, "restarted_at = timestamptz '2020-01-01 00:00:00+08'"),
      ).rejects.toThrow(/caring-contacts-service-stop-immutable/);

      const { rows } = await pool.query<{ unchanged: boolean }>(
        `select restarted_at = timestamptz '2026-03-02 11:00:00+08' as unchanged
         from caring_contacts.service_stops where stop_id = $1`,
        [STOP_ONE],
      );
      expect(rows[0].unchanged).toBe(true);
    });

    it("freezes every column of the incident except restarted_at, including any added later", async () => {
      // The guard is an ALLOWLIST -- everything frozen but the one named exception -- so this
      // test reads the real column list from the live table instead of naming columns here. A
      // hand-written list here would go stale exactly as a hand-written list in the trigger did,
      // and this table is being extended while the build is in flight. Add a column, and this
      // test fails until the guard covers it.
      const { rows: columns } = await pool.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema = 'caring_contacts' and table_name = 'service_stops'
         order by ordinal_position`,
      );
      const columnNames = columns.map((row) => row.column_name);

      // Without these two, an empty or restarted_at-less list would iterate over nothing and
      // report green while proving nothing at all.
      expect(columnNames.length).toBeGreaterThan(0);
      expect(columnNames).toContain("restarted_at");

      const frozen = columnNames.filter((name) => name !== "restarted_at");
      expect(frozen.length).toBeGreaterThan(0);

      // `null` is a value distinct from everything the fixture wrote, and a BEFORE ROW trigger
      // runs ahead of NOT NULL and foreign-key checking, so the guard's own exception is the one
      // that surfaces. Asserted on the message rather than on "it threw", so a not-null violation
      // cannot be mistaken for the guard doing its job. Every column is attempted before the
      // assertion, so a failure names all of them rather than only the first.
      const notRefusedByTheGuard: string[] = [];
      for (const column of frozen) {
        const outcome = await updateIncident(TEAM_NORTH, STOP_ONE, `${column} = null`).then(
          () => "the update was ALLOWED",
          (error: unknown) => String(error),
        );
        if (!/caring-contacts-service-stop-immutable/.test(outcome)) {
          notRefusedByTheGuard.push(`${column}: ${outcome}`);
        }
      }

      expect(notRefusedByTheGuard).toEqual([]);
    });
  });

  describe("the current incident's reason and note are held in exactly one place", () => {
    it("reports a stopped state's reason and note through the incident row", async () => {
      await recordStop(TEAM_NORTH, STOP_ONE);

      // Read from a DIFFERENT team, so this also re-proves the service-wide policy reaches the
      // join every screen will make.
      const rows = await runInTeamSession(pool, { teamId: TEAM_SOUTH }, async (client) => {
        const result = await client.query<{ stopped: boolean; reason: string; note: string }>(
          `select s.stopped, i.reason, i.note
           from caring_contacts.service_state s
           join caring_contacts.service_stops i on i.stop_id = s.stop_id`,
        );
        return result.rows;
      });

      expect(rows).toEqual([{ stopped: true, reason: "wrong-recipient", note: "A message reached the wrong number." }]);
    });

    it("keeps NO second copy of the reason or note on the singleton", async () => {
      // Two copies of a safety incident's reason can drift, and the worst place for that to
      // surface is the banner rendering the stale one on every screen. There is no constraint
      // policing the two copies because there is only one copy.
      const { rows } = await pool.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema = 'caring_contacts' and table_name = 'service_state'
           and column_name in ('stopped_reason', 'stop_note')`,
      );
      expect(rows).toEqual([]);
    });
  });

  describe("the audit trail itself cannot be rewritten or deleted", () => {
    // `audit-integrity-loss` is one of the five reasons that halts the WHOLE service, so the trail
    // is the last table in this schema that should be quietly editable. `service_stops` was given
    // an immutability trigger and the audit table -- deliberately outside `attach_audit_guard`, so
    // that deleting a row required no audit event of its own -- was not.
    const EVENT_KEY = "audit-immutability-1";

    async function recordEvent(): Promise<void> {
      await runInTeamSession(pool, { teamId: TEAM_NORTH, auditToken: nextAuditToken() }, async (client) => {
        await client.query("insert into caring_contacts.teams (id) values ($1) on conflict (id) do nothing", [
          TEAM_NORTH,
        ]);
        await insertAuditEvent(client, {
          teamId: TEAM_NORTH,
          actorId: "ACTOR-NORTH",
          actorRoles: ["coordinator"],
          action: "activatePlan",
          objectType: "plan",
          objectId: "PLAN-N",
          outcome: "allowed",
          idempotencyKey: EVENT_KEY,
        });
      });
    }

    beforeEach(async () => {
      await recordEvent();
    });

    // Run as the migration superuser ON PURPOSE, which is the opposite of this file's usual rule.
    // A superuser bypasses row-level security AND holds every privilege, so a refusal here is the
    // trigger's doing and nothing else's -- the grant narrowing below cannot be what produced it.
    it("refuses an update even from the schema owner, who bypasses row-level security", async () => {
      await expect(pool.query("update caring_contacts.audit_events set outcome = 'denied'")).rejects.toThrow(
        /caring-contacts-audit-immutable/,
      );

      const { rows } = await pool.query<{ outcome: string }>("select outcome from caring_contacts.audit_events");
      expect(rows.map((row) => row.outcome)).toEqual(["allowed"]);
    });

    it("refuses a delete even from the schema owner", async () => {
      await expect(pool.query("delete from caring_contacts.audit_events")).rejects.toThrow(
        /caring-contacts-audit-immutable/,
      );

      const { rows } = await pool.query<{ count: string }>(
        "select count(*)::text as count from caring_contacts.audit_events",
      );
      expect(rows[0].count).toBe("1");
    });

    it("leaves the application role no UPDATE or DELETE privilege to reach the trigger with", async () => {
      // Defence in depth, and the two halves answer different questions: the trigger says the row
      // is frozen for everyone, the grant says the application never had the privilege to try.
      const { rows } = await pool.query<{ privilege_type: string }>(
        `select privilege_type from information_schema.role_table_grants
         where grantee = 'caring_contacts_app' and table_schema = 'caring_contacts'
           and table_name = 'audit_events'
         order by privilege_type`,
      );
      expect(rows.map((row) => row.privilege_type)).toEqual(["INSERT", "SELECT"]);
    });

    it("refuses the application role before the trigger is even reached", async () => {
      await expect(
        runInTeamSession(pool, { teamId: TEAM_NORTH }, (client) =>
          client.query("delete from caring_contacts.audit_events"),
        ),
      ).rejects.toThrow(/permission denied/i);
    });

    it("still lets the suite truncate the trail, which is how every other test here starts clean", async () => {
      // The constraint the trigger had to be written around. TRUNCATE fires statement-level
      // truncate triggers only, never the per-row DELETE trigger above, so blocking DELETE does
      // not strand `truncateCaringContactsData` -- and if a later change made it a per-row delete,
      // this is the assertion that would say so rather than 40 unrelated tests failing at once.
      await expect(truncateCaringContactsData(pool)).resolves.toBeUndefined();

      const { rows } = await pool.query<{ count: string }>(
        "select count(*)::text as count from caring_contacts.audit_events",
      );
      expect(rows[0].count).toBe("0");
    });
  });

  describe("composite foreign keys enforce multi-tenant isolation (#4VKAA1)", () => {
    it("refuses cross-team foreign key references onto plans and contacts", async () => {
      // Seed TEAM_NORTH's plan with no contacts: default seedPlan inserts sequences 1..2, and
      // contacts_unique_sequence is (plan_id, sequence). A cross-team insert reusing sequence 1
      // would trip the unique gate first and never exercise contacts_team_plan_fk.
      await seedPlan(pool, {
        teamId: TEAM_NORTH,
        planId: "PLAN-NORTH-FK",
        patientId: "PATIENT-NORTH-FK",
        contactCount: 0,
      });
      // TEAM_SOUTH must exist so the failure is the composite plan FK (isolation), not teams_fkey.
      await registerTeam(TEAM_SOUTH);

      // 1. A contact for TEAM_SOUTH referencing TEAM_NORTH's plan must be rejected by foreign key constraint
      await expect(
        pool.query(
          `insert into caring_contacts.contacts (id, plan_id, team_id, sequence, state, version, cadence_label, calendar_day, send_at, message_type)
           values ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9)`,
          ["CONTACT-SOUTH-FK", "PLAN-NORTH-FK", TEAM_SOUTH, 1, "scheduled", 1, "Day 1", "2026-03-03", "standard"],
        ),
      ).rejects.toThrow(/foreign key constraint/i);

      // 2. A retention_state for TEAM_SOUTH referencing TEAM_NORTH's plan must be rejected
      await expect(
        pool.query(
          `insert into caring_contacts.retention_state (plan_id, team_id, terminal_at)
           values ($1, $2, now())`,
          ["PLAN-NORTH-FK", TEAM_SOUTH],
        ),
      ).rejects.toThrow(/foreign key constraint/i);

      // 3. A cultural_identity_reports for TEAM_SOUTH referencing TEAM_NORTH's plan must be rejected
      await expect(
        pool.query(
          `insert into caring_contacts.cultural_identity_reports (plan_id, team_id, cultural_identity)
           values ($1, $2, $3)`,
          ["PLAN-NORTH-FK", TEAM_SOUTH, "Aboriginal"],
        ),
      ).rejects.toThrow(/foreign key constraint/i);
    });
  });
});
