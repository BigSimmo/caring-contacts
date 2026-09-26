// tests/caring-contacts-retention.test.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildAuditEvent, type AuditableChange } from "@/lib/caring-contacts/audit";
import { fixedClock } from "@/lib/caring-contacts/clock";
import { actorId, idempotencyKey, pathwayVersionId, teamId } from "@/lib/caring-contacts/ids";
import {
  DEFAULT_RETENTION_POLICY,
  admitRetentionClearance,
  archiveIncidentNotes,
  deidentifyAuditEvent,
  deidentifyEpisode,
  isDueForDeidentification,
  type Episode,
  type IncidentCaseNote,
  type RetentionPolicy,
} from "@/lib/caring-contacts/retention";

const DOMAIN_ROOT = path.join(process.cwd(), "src", "lib", "caring-contacts");

/**
 * Ruling 26. The word-mention half of rule 1 below exempts the STORAGE LAYER, and only the storage
 * layer: `repository.ts` declares the storage contract, and `in-memory-repository.ts` and
 * `db/postgres-repository.ts` implement it. `markRetentionCleared` is a method on that contract,
 * so all three must be able to NAME the thing they store; renaming the method to dodge a regex
 * would be the tail wagging the dog.
 *
 * The exemption is narrow in both directions, and that is the whole point of it:
 *
 *   * the `years: 7` half of rule 1 is UNTOUCHED and still applies to these three files, so the
 *     literal period this file's title is about cannot appear in them;
 *   * these three additionally carry the COMPENSATING assertion below -- no line that mentions
 *     retention may also contain a digit -- which catches a hard-coded period spelled any other
 *     way (`RETENTION_YEARS = 7`, `retentionYears: 7`, `retention: { years: 7 }`) that the
 *     `years: 7` regex alone would miss.
 *
 * So an allowlisted file is checked MORE strictly than the rest of the domain, not less. Do not
 * add a file here to make a diff pass: a module outside the storage layer has no reason to name
 * retention at all, and the correct fix for one that does is to stop naming it.
 *
 * OPEN FOR THE OWNER (Task 11b): Ruling 26 as written named exactly `repository.ts` and
 * `in-memory-repository.ts`, because at the time it was made the Postgres store did not yet
 * implement `markRetentionCleared`. Task 11b implements it, which puts the word into the third
 * storage file for the same reason it is in the other two. Removing that entry is a one-line
 * revert if the owner rules the other way.
 */
const RETENTION_WORD_ALLOWLIST: readonly string[] = Object.freeze([
  "repository.ts",
  "in-memory-repository.ts",
  "postgres-repository.ts",
  "plans-store.ts",
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
  });
}

function baseEpisode(overrides: Partial<Episode> = {}): Episode {
  return {
    state: "completed",
    patientName: "Jordan Nguyen",
    patientMobileNumber: "+61 491 570 156",
    patientIdentifiers: ["UR-00219384", "MRN-778213"],
    culturalIdentity: "Aboriginal",
    // The name this patient asked to be called. Deliberately NOT a substring of `patientName`: it
    // is asked for rather than split off the stored name, so the absence check below can fail
    // independently of the one on `patientName`.
    preferredName: "Jordy",
    // Free text a clinician wrote about this patient, so de-identification must drop it with the
    // other identifying fields rather than carry it into the reporting projection.
    firstContactReason: "Patient asked to wait until she is home from her sister's.",
    // Also free text about this patient, so it must go the same way.
    withdrawalReason: "Said the messages were hard to read while her partner was home.",
    // An episode that has ended but has NOT been cleared. `deidentifyEpisode` must drop this field
    // like every other one it does not name, so the default here is the un-cleared value: were it
    // pre-set to an instant, the assertion that a de-identified episode carries no clearance would
    // be satisfied by a value that was never there.
    patientDetailClearedAt: null,
    planDates: {
      dischargeAt: new Date("2019-08-05T02:00:00.000Z"),
      completedAt: new Date("2019-08-19T02:00:00.000Z"), // 2019-08-19 10:00 AWST
    },
    pathwayVersionId: pathwayVersionId("PATHWAY-1"),
    teamId: teamId("TEAM-1"),
    outcome: "completedFullCourse",
    counts: { contactsScheduled: 10, contactsSent: 10, contactsDelivered: 9 },
    ...overrides,
  };
}

function baseAuditEvent() {
  const change: AuditableChange = {
    actorId: actorId("ACTOR-1"),
    actorRoles: ["coordinator"],
    teamId: teamId("TEAM-1"),
    action: "generateClinicalRecordSummary",
    objectType: "plan",
    objectId: "PLAN-1",
    outcome: "allowed",
    idempotencyKey: idempotencyKey("IDEMP-1"),
  };
  return buildAuditEvent(change, fixedClock("2019-08-19T02:00:00.000Z"));
}

// ---------------------------------------------------------------------------
// Rule 1 — DEFAULT_RETENTION_POLICY is the sole hard-coded retention period
// ---------------------------------------------------------------------------

describe("rule 1: DEFAULT_RETENTION_POLICY", () => {
  it("is { years: 7 }", () => {
    expect(DEFAULT_RETENTION_POLICY).toEqual({ years: 7 });
  });

  it("is a plain value a caller may override without affecting the default", () => {
    const shorter: RetentionPolicy = { ...DEFAULT_RETENTION_POLICY, years: 1 };
    expect(shorter.years).toBe(1);
    expect(DEFAULT_RETENTION_POLICY.years).toBe(7);
  });

  it("is the only module in src/lib/caring-contacts that hard-codes a retention period", () => {
    const offences: string[] = [];
    for (const file of walk(DOMAIN_ROOT)) {
      if (path.basename(file) === "retention.ts") continue;
      const source = readFileSync(file, "utf8");
      const relative = path.relative(process.cwd(), file);
      // The storage layer may NAME retention (see RETENTION_WORD_ALLOWLIST); the period check
      // below still binds it, as does the stricter per-line check in the test that follows.
      if (!RETENTION_WORD_ALLOWLIST.includes(path.basename(file)) && /retention/i.test(source)) {
        offences.push(`${relative}: mentions "retention"`);
      }
      if (/\byears\s*:\s*7\b/.test(source)) offences.push(`${relative}: hard-codes "years: 7"`);
    }
    expect(offences).toEqual([]);
  });

  it("lets the storage layer name retention, but never on a line that also carries a number", () => {
    const offences: string[] = [];
    const inspected: string[] = [];

    for (const file of walk(DOMAIN_ROOT)) {
      const name = path.basename(file);
      if (!RETENTION_WORD_ALLOWLIST.includes(name)) continue;
      inspected.push(name);

      const relative = path.relative(process.cwd(), file);
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((line, index) => {
          if (!/retention/i.test(line)) return;
          if (!/\d/.test(line)) return;
          offences.push(`${relative}:${index + 1}: retention named beside a number -- ${line.trim()}`);
        });
    }

    // Positive control. Without it this assertion would go green on an allowlist that matched no
    // file at all -- after a rename, a move, or a deletion -- and the compensating check would be
    // silently decorative rather than merely wrong.
    expect(inspected.sort()).toEqual([...RETENTION_WORD_ALLOWLIST].sort());
    expect(offences).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — isDueForDeidentification
// ---------------------------------------------------------------------------

describe("rule 2: isDueForDeidentification", () => {
  it("is false one day before the retention period elapses (AWST)", () => {
    const episode = baseEpisode(); // completed 2019-08-19 (AWST)
    const oneDayShort = fixedClock("2026-08-18T02:00:00.000Z"); // 2026-08-18 AWST
    expect(isDueForDeidentification(episode, DEFAULT_RETENTION_POLICY, oneDayShort)).toBe(false);
  });

  it("is true exactly at the seven-year boundary (AWST)", () => {
    const episode = baseEpisode(); // completed 2019-08-19 (AWST)
    const exactlySeven = fixedClock("2026-08-19T02:00:00.000Z"); // 2026-08-19 AWST
    expect(isDueForDeidentification(episode, DEFAULT_RETENTION_POLICY, exactlySeven)).toBe(true);
  });

  it("stays true well past the boundary", () => {
    const episode = baseEpisode();
    const wellPast = fixedClock("2030-01-01T02:00:00.000Z");
    expect(isDueForDeidentification(episode, DEFAULT_RETENTION_POLICY, wellPast)).toBe(true);
  });

  it("respects an overridden, shorter policy", () => {
    const episode = baseEpisode();
    const oneYearLater = fixedClock("2020-08-19T02:00:00.000Z");
    expect(isDueForDeidentification(episode, { years: 1 }, oneYearLater)).toBe(true);
    expect(isDueForDeidentification(episode, DEFAULT_RETENTION_POLICY, oneYearLater)).toBe(false);
  });

  it.each(["draft", "active", "paused"] as const)(
    "is false for a non-terminal state (%s) no matter how much time has passed",
    (state) => {
      const episode = baseEpisode({ state });
      const farFuture = fixedClock("2099-01-01T00:00:00.000Z");
      expect(isDueForDeidentification(episode, DEFAULT_RETENTION_POLICY, farFuture)).toBe(false);
    },
  );

  it.each(["withdrawn", "cancelled", "completed"] as const)(
    "treats %s as a terminal state once its retention period elapses",
    (state) => {
      const episode = baseEpisode({ state });
      const exactlySeven = fixedClock("2026-08-19T02:00:00.000Z");
      expect(isDueForDeidentification(episode, DEFAULT_RETENTION_POLICY, exactlySeven)).toBe(true);
    },
  );

  it("is false for a terminal episode with no recorded completion instant", () => {
    const episode = baseEpisode({ planDates: { dischargeAt: baseEpisode().planDates.dischargeAt, completedAt: null } });
    const farFuture = fixedClock("2099-01-01T00:00:00.000Z");
    expect(isDueForDeidentification(episode, DEFAULT_RETENTION_POLICY, farFuture)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rule 3 — deidentifyEpisode
// ---------------------------------------------------------------------------

describe("rule 3: deidentifyEpisode", () => {
  it("removes patient name, preferred name, mobile, identifiers, and cultural identity", () => {
    const deidentified = deidentifyEpisode(baseEpisode()) as unknown as Record<string, unknown>;
    expect(deidentified).not.toHaveProperty("patientName");
    expect(deidentified).not.toHaveProperty("patientMobileNumber");
    expect(deidentified).not.toHaveProperty("patientIdentifiers");
    expect(deidentified).not.toHaveProperty("culturalIdentity");
    // The name the patient asked to be called (2026-08-26). Nothing but patient content, so it is
    // removed with the rest of it -- and the string check is what proves the property is gone
    // rather than merely the key, on a fixture where the value cannot come from anywhere else.
    expect(deidentified).not.toHaveProperty("preferredName");
    expect(JSON.stringify(deidentified)).not.toContain("Jordy");
    // The reason a first contact moved (Ruling 105). It is not on this module's own list, because that list names
    // what identifies a patient and this names a scheduling decision -- but its VALUE is prose a
    // clinician typed about this patient, so a de-identified episode carrying it would be
    // de-identified in name only.
    expect(deidentified).not.toHaveProperty("firstContactReason");
    expect(JSON.stringify(deidentified)).not.toContain("sister");
  });

  it("retains plan dates, pathway version, team, outcome, and counts", () => {
    const original = baseEpisode();
    const deidentified = deidentifyEpisode(original);
    expect(deidentified.planDates).toEqual(original.planDates);
    expect(deidentified.pathwayVersionId).toBe(original.pathwayVersionId);
    expect(deidentified.teamId).toBe(original.teamId);
    expect(deidentified.outcome).toBe(original.outcome);
    expect(deidentified.counts).toEqual(original.counts);
  });

  it("is frozen", () => {
    const deidentified = deidentifyEpisode(baseEpisode());
    expect(Object.isFrozen(deidentified)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rule 4 — deidentifyAuditEvent
// ---------------------------------------------------------------------------

describe("rule 4: deidentifyAuditEvent", () => {
  it("retains exactly the five named fields: actor, action, timestamp, object type, outcome", () => {
    const original = baseAuditEvent();
    const deidentified = deidentifyAuditEvent(original);

    expect(deidentified.actorId).toBe(original.actorId);
    expect(deidentified.action).toBe(original.action);
    expect(deidentified.timestamp).toBe(original.timestamp);
    expect(deidentified.objectType).toBe(original.objectType);
    expect(deidentified.outcome).toBe(original.outcome);
  });

  it("clears object id", () => {
    const original = baseAuditEvent();
    const deidentified = deidentifyAuditEvent(original);
    expect(deidentified.objectId).not.toBe(original.objectId);
    expect(deidentified.objectId).toBe("");
  });

  it("drops actor roles, team id, and idempotency key entirely", () => {
    const deidentified = deidentifyAuditEvent(baseAuditEvent()) as unknown as Record<string, unknown>;
    expect(deidentified).not.toHaveProperty("actorRoles");
    expect(deidentified).not.toHaveProperty("teamId");
    expect(deidentified).not.toHaveProperty("idempotencyKey");
  });

  it("is frozen", () => {
    const deidentified = deidentifyAuditEvent(baseAuditEvent());
    expect(Object.isFrozen(deidentified)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rule 5 — idempotent de-identification
// ---------------------------------------------------------------------------

describe("rule 5: idempotent de-identification", () => {
  it("deidentifyEpisode applied twice equals applied once", () => {
    const once = deidentifyEpisode(baseEpisode());
    const twice = deidentifyEpisode(once);
    expect(twice).toEqual(once);
  });

  it("deidentifyAuditEvent applied twice equals applied once", () => {
    const once = deidentifyAuditEvent(baseAuditEvent());
    const twice = deidentifyAuditEvent(once);
    expect(twice).toEqual(once);
  });
});

// ---------------------------------------------------------------------------
// Rule 6 — admitRetentionClearance (Ruling 39)
//
// Tested directly, not only through the two stores that call it. A rule exercised solely through
// its callers is a rule whose own boundaries are untested, and the boundary those callers are
// least likely to reach is the second one below: a terminal episode whose completion instant was
// never recorded. It is refused for the same reason a non-terminal one is, because from the
// storage layer's side they are the same fact — there is no end instant to clear against.
// ---------------------------------------------------------------------------

describe("rule 6: admitRetentionClearance", () => {
  // Owner decision (2026-09-26): identifying detail may be cleared only once the retention period
  // -- DEFAULT_RETENTION_POLICY, seven years in AWST calendar days -- has passed since the plan
  // ended. Not immediately on ending. `baseEpisode` ended on 2019-08-19 AWST, so it is due from
  // 2026-08-19 AWST and not a day before.
  const AFTER_RETENTION = fixedClock("2026-08-19T02:00:00.000Z"); // 2026-08-19 10:00 AWST
  const DAY_BEFORE_DUE = fixedClock("2026-08-18T15:00:00.000Z"); // 2026-08-18 23:00 AWST
  const JUST_ENDED = fixedClock("2019-08-19T03:00:00.000Z");

  it.each(["withdrawn", "cancelled", "completed"] as const)(
    "admits a %s episode once the retention period has passed, and hands back the instant it ended",
    (state) => {
      const episode = baseEpisode({ state });
      const admitted = admitRetentionClearance(episode, AFTER_RETENTION);

      expect(admitted).toEqual({ ok: true, value: episode.planDates.completedAt });
    },
  );

  it("refuses an episode that ended moments ago, by name", () => {
    expect(admitRetentionClearance(baseEpisode(), JUST_ENDED)).toEqual({
      ok: false,
      reason: "retention-period-not-elapsed",
    });
  });

  it("refuses on the last AWST day before the period ends, and admits on the day it ends", () => {
    expect(admitRetentionClearance(baseEpisode(), DAY_BEFORE_DUE)).toEqual({
      ok: false,
      reason: "retention-period-not-elapsed",
    });
    expect(admitRetentionClearance(baseEpisode(), AFTER_RETENTION).ok).toBe(true);
  });

  it("honours an explicit policy override rather than the default", () => {
    expect(admitRetentionClearance(baseEpisode(), fixedClock("2020-08-19T02:00:00.000Z"), { years: 1 }).ok).toBe(true);
    expect(admitRetentionClearance(baseEpisode(), fixedClock("2020-08-19T02:00:00.000Z"))).toEqual({
      ok: false,
      reason: "retention-period-not-elapsed",
    });
  });

  it.each(["draft", "active", "paused"] as const)("refuses a %s episode, which has not ended", (state) => {
    expect(admitRetentionClearance(baseEpisode({ state }), AFTER_RETENTION)).toEqual({
      ok: false,
      reason: "retention-episode-not-terminal",
    });
  });

  it("refuses a terminal episode whose completion instant was never recorded", () => {
    const episode = baseEpisode({
      planDates: { dischargeAt: baseEpisode().planDates.dischargeAt, completedAt: null },
    });

    // Positive control: the state really is terminal, so this is the completion instant being
    // missing and not the state check firing first.
    expect(episode.state).toBe("completed");
    expect(admitRetentionClearance(episode, AFTER_RETENTION)).toEqual({
      ok: false,
      reason: "retention-episode-not-terminal",
    });
  });

  it("hands back a copy, so a caller cannot rewrite the episode it asked about", () => {
    const episode = baseEpisode();
    const admitted = admitRetentionClearance(episode, AFTER_RETENTION);
    if (!admitted.ok) throw new Error("expected an admitted clearance");

    admitted.value.setUTCFullYear(1970);

    expect(episode.planDates.completedAt?.getUTCFullYear()).toBe(2019);
  });
});

// ---------------------------------------------------------------------------
// Rule 7 — Incident responder notes and governed archival (#JZ8B36)
// ---------------------------------------------------------------------------

describe("rule 7: incident responder notes and governed archival (#JZ8B36)", () => {
  function baseIncidentNote(overrides: Partial<IncidentCaseNote> = {}): IncidentCaseNote {
    return Object.freeze({
      id: "NOTE-1",
      episodeId: "EPISODE-1",
      stopId: "STOP-1",
      authorId: actorId("ACTOR-1"),
      note: "Mid-incident note regarding wrong-recipient message dispatch.",
      createdAt: "2019-08-19T10:00:00.000+08:00",
      reason: "wrong-recipient",
      restartedAt: null,
      ...overrides,
    });
  }

  describe("immutable note lifecycle", () => {
    it("preserves note contents as immutable during episode lifecycle (assert_service_stop_immutable)", () => {
      const note = baseIncidentNote();
      expect(note.note).toContain("wrong-recipient");
      expect(Object.isFrozen(note)).toBe(true);
      expect(() => {
        (note as { note: string }).note = "Tampered mid-incident content";
      }).toThrow();
    });

    it("refuses archival for non-terminal episode states", () => {
      const activeEpisode = baseEpisode({ state: "active" });
      const clock = fixedClock("2030-01-01T02:00:00.000Z");
      const result = archiveIncidentNotes(
        activeEpisode,
        "governed-retention-archival",
        DEFAULT_RETENTION_POLICY,
        clock,
      );
      expect(result.ok).toBe(false);
      expect(result.archived).toBe(false);
      expect(result.reason).toBe("retention-episode-not-terminal");
    });

    it("refuses archival for draft and paused episodes", () => {
      const draftEpisode = baseEpisode({ state: "draft" });
      const pausedEpisode = baseEpisode({ state: "paused" });
      const clock = fixedClock("2030-01-01T02:00:00.000Z");

      const draftResult = archiveIncidentNotes(draftEpisode, "archive", DEFAULT_RETENTION_POLICY, clock);
      expect(draftResult.ok).toBe(false);
      expect(draftResult.reason).toBe("retention-episode-not-terminal");

      const pausedResult = archiveIncidentNotes(pausedEpisode, "archive", DEFAULT_RETENTION_POLICY, clock);
      expect(pausedResult.ok).toBe(false);
      expect(pausedResult.reason).toBe("retention-episode-not-terminal");
    });

    it("refuses archival for a terminal episode with missing completion instant", () => {
      const episode = baseEpisode({
        planDates: { dischargeAt: baseEpisode().planDates.dischargeAt, completedAt: null },
      });
      const clock = fixedClock("2030-01-01T02:00:00.000Z");
      const result = archiveIncidentNotes(episode, "archive", DEFAULT_RETENTION_POLICY, clock);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("retention-episode-not-terminal");
    });
  });

  describe("governed archival retention boundaries", () => {
    it("refuses archival one day before the clinical retention period elapses (AWST)", () => {
      const episode = baseEpisode(); // completed 2019-08-19 (AWST)
      const oneDayShort = fixedClock("2026-08-18T02:00:00.000Z"); // 2026-08-18 AWST
      const result = archiveIncidentNotes(
        episode,
        "governed-retention-archival",
        DEFAULT_RETENTION_POLICY,
        oneDayShort,
      );
      expect(result.ok).toBe(false);
      expect(result.archived).toBe(false);
      expect(result.reason).toBe("retention-period-not-elapsed");
    });

    it("passes eligibility at the seven-year boundary but does not claim persisted archival (AWST)", () => {
      const episode = baseEpisode(); // completed 2019-08-19 (AWST)
      const exactlySeven = fixedClock("2026-08-19T02:00:00.000Z"); // 2026-08-19 AWST
      const result = archiveIncidentNotes(
        episode,
        "governed-retention-archival",
        DEFAULT_RETENTION_POLICY,
        exactlySeven,
      );
      expect(result.ok).toBe(false);
      expect(result.archived).toBe(false);
      expect(result.reason).toBe("archival-not-persisted");
    });

    it("passes eligibility well past the boundary but does not claim persisted archival", () => {
      const episode = baseEpisode();
      const wellPast = fixedClock("2035-01-01T02:00:00.000Z");
      const result = archiveIncidentNotes(episode, "governed-retention-archival", DEFAULT_RETENTION_POLICY, wellPast);
      expect(result.ok).toBe(false);
      expect(result.archived).toBe(false);
      expect(result.reason).toBe("archival-not-persisted");
    });

    it("respects an overridden, shorter retention policy", () => {
      const episode = baseEpisode();
      const oneYearLater = fixedClock("2020-08-19T02:00:00.000Z");
      const resultShorter = archiveIncidentNotes(episode, "archive", { years: 1 }, oneYearLater);
      expect(resultShorter.ok).toBe(false);
      expect(resultShorter.reason).toBe("archival-not-persisted");

      const resultDefault = archiveIncidentNotes(episode, "archive", DEFAULT_RETENTION_POLICY, oneYearLater);
      expect(resultDefault.ok).toBe(false);
      expect(resultDefault.reason).toBe("retention-period-not-elapsed");
    });

    it("validates mandatory parameters: rejects empty episodeId or missing reason", () => {
      const clock = fixedClock("2030-01-01T02:00:00.000Z");
      const emptyEpisodeResult = archiveIncidentNotes("", "reason", DEFAULT_RETENTION_POLICY, clock);
      expect(emptyEpisodeResult.ok).toBe(false);
      expect(emptyEpisodeResult.reason).toBe("missing-episode-id");

      const emptyReasonResult = archiveIncidentNotes("EPISODE-1", "   ", DEFAULT_RETENTION_POLICY, clock);
      expect(emptyReasonResult.ok).toBe(false);
      expect(emptyReasonResult.reason).toBe("missing-reason");
    });

    it("rejects invalid retention policy values", () => {
      const clock = fixedClock("2030-01-01T02:00:00.000Z");
      const invalidPolicyResult = archiveIncidentNotes("EPISODE-1", "reason", { years: 0 }, clock);
      expect(invalidPolicyResult.ok).toBe(false);
      expect(invalidPolicyResult.reason).toBe("invalid-retention-policy");
    });

    it("fails closed for string-only episodeId without Episode context", () => {
      const clock = fixedClock("2030-01-01T02:00:00.000Z");
      const result = archiveIncidentNotes(
        "EPISODE-99",
        "clinical-record-retention-expired",
        DEFAULT_RETENTION_POLICY,
        clock,
      );
      expect(result.ok).toBe(false);
      expect(result.archived).toBe(false);
      expect(result.episodeId).toBe("EPISODE-99");
      expect(result.reason).toBe("missing-episode-context");
    });

    it("string overload checks terminal/retention rules when Episode is supplied", () => {
      const clock = fixedClock("2030-01-01T02:00:00.000Z");
      const active = baseEpisode({ state: "active" });
      const refusedActive = archiveIncidentNotes(
        "EPISODE-99",
        "clinical-record-retention-expired",
        DEFAULT_RETENTION_POLICY,
        clock,
        active,
      );
      expect(refusedActive.ok).toBe(false);
      expect(refusedActive.reason).toBe("retention-episode-not-terminal");

      const due = baseEpisode();
      const eligible = archiveIncidentNotes(
        "EPISODE-99",
        "clinical-record-retention-expired",
        DEFAULT_RETENTION_POLICY,
        clock,
        due,
      );
      expect(eligible.ok).toBe(false);
      expect(eligible.archived).toBe(false);
      expect(eligible.reason).toBe("archival-not-persisted");
    });
  });
});
