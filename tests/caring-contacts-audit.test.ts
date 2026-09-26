// tests/caring-contacts-audit.test.ts
import { describe, expect, it } from "vitest";

import {
  assertAuditEventFreeOfPatientData,
  buildAuditEvent,
  deserializeAuditEntry,
  deserializeAuditTrail,
  serializeAuditEntry,
  serializeAuditTrail,
  type AuditableChange,
  type AuditEvent,
  type CaringContactsAuditEntry,
} from "@/lib/caring-contacts/audit";
import { fixedClock } from "@/lib/caring-contacts/clock";
import { actorId, idempotencyKey, teamId } from "@/lib/caring-contacts/ids";

const CLOCK = fixedClock("2026-08-19T02:00:00.000Z"); // 10:00 AWST

function baseChange(overrides: Partial<AuditableChange> = {}): AuditableChange {
  return {
    actorId: actorId("ACTOR-1"),
    actorRoles: ["coordinator"],
    teamId: teamId("TEAM-1"),
    action: "activatePlan",
    objectType: "plan",
    objectId: "PLAN-1",
    outcome: "allowed",
    idempotencyKey: idempotencyKey("IDEMP-1"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Rule 1 — every event carries the required fields
// ---------------------------------------------------------------------------

describe("rule 1: required fields", () => {
  it("carries actor id, actor roles, team id, action, object type/id, outcome, timestamp, idempotency key", () => {
    const event = buildAuditEvent(baseChange(), CLOCK);

    expect(event.actorId).toBe("ACTOR-1");
    expect(event.actorRoles).toEqual(["coordinator"]);
    expect(event.teamId).toBe("TEAM-1");
    expect(event.action).toBe("activatePlan");
    expect(event.objectType).toBe("plan");
    expect(event.objectId).toBe("PLAN-1");
    expect(event.outcome).toBe("allowed");
    expect(event.idempotencyKey).toBe("IDEMP-1");
    expect(event.timestamp).toBe("2026-08-19T10:00:00.000+08:00");
  });

  it("produces an ISO timestamp with an explicit numeric offset, not a bare Z", () => {
    const event = buildAuditEvent(baseChange(), CLOCK);
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
  });

  it("accepts every documented outcome", () => {
    for (const outcome of ["allowed", "denied", "failed"] as const) {
      const event = buildAuditEvent(baseChange({ outcome }), CLOCK);
      expect(event.outcome).toBe(outcome);
    }
  });

  it("is pure given a clock: the same input and clock always produce byte-identical output", () => {
    const first = buildAuditEvent(baseChange(), CLOCK);
    const second = buildAuditEvent(baseChange(), CLOCK);
    expect(first).toEqual(second);
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — never a mobile number, message body, or free clinical text
// ---------------------------------------------------------------------------

describe("rule 2: rejects patient data", () => {
  it.each([
    ["spaced +61 form", "+61 491 570 156"],
    ["unspaced +61 form", "+61491570156"],
    ["spaced 04xx local form", "0491 570 156"],
    ["unspaced 04xx local form", "0491570156"],
  ])("throws audit-event-contains-patient-data when the %s appears in any field", (_label, mobile) => {
    expect(() => buildAuditEvent(baseChange({ objectId: mobile }), CLOCK)).toThrow("audit-event-contains-patient-data");
    expect(() => buildAuditEvent(baseChange({ action: `note: call ${mobile}` }), CLOCK)).toThrow(
      "audit-event-contains-patient-data",
    );
  });

  it("scans array fields too: a mobile number hidden in actorRoles still throws", () => {
    expect(() => buildAuditEvent(baseChange({ actorRoles: ["coordinator", "0491570156"] }), CLOCK)).toThrow(
      "audit-event-contains-patient-data",
    );
  });

  it("throws on a forbidden field name even when its value is not a mobile number", () => {
    const withStrayField = { ...baseChange(), patientName: "Jordan Nguyen" } as unknown as AuditableChange;
    expect(() => buildAuditEvent(withStrayField, CLOCK)).toThrow("audit-event-contains-patient-data");
  });

  it("throws on the name a patient asked to be called, which the denylist names in its own right", () => {
    // The guard matches a field name EXACTLY, so the existing `"name"` entry does not cover
    // `preferredName` -- it is a separate entry, and this is what holds it there (2026-08-26).
    // Its value is short, has no digits, and looks like nothing: a denylist is the only thing that
    // could ever stop it.
    const withPreferredName = { ...baseChange(), preferredName: "Jordy" } as unknown as AuditableChange;
    expect(() => buildAuditEvent(withPreferredName, CLOCK)).toThrow("audit-event-contains-patient-data");

    // Positive control: a field name that is NOT on the denylist, carrying the same harmless-looking
    // value, is allowed -- so the throw above is the entry acting rather than the value being
    // refused by some other rule.
    expect(() => assertAuditEventFreeOfPatientData({ chosenName: "Jordy" })).not.toThrow();
  });

  it("lets a caller supply a narrower or wider forbidden-field-name set", () => {
    // A field name outside the default denylist is allowed by default...
    expect(() => assertAuditEventFreeOfPatientData({ freeText: "no digits here" })).not.toThrow();
    // ...but throws once the caller configures it as forbidden.
    expect(() => assertAuditEventFreeOfPatientData({ freeText: "no digits here" }, ["freeText"])).toThrow(
      "audit-event-contains-patient-data",
    );
  });

  it("does not throw for an ordinary event with no patient data anywhere", () => {
    expect(() => buildAuditEvent(baseChange(), CLOCK)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Rule 3 — frozen on construction
// ---------------------------------------------------------------------------

describe("rule 3: frozen on construction", () => {
  it("is frozen", () => {
    const event = buildAuditEvent(baseChange(), CLOCK);
    expect(Object.isFrozen(event)).toBe(true);
  });

  it("silently ignores (non-strict) or throws (strict) a mutation attempt without changing the object", () => {
    const event: AuditEvent = buildAuditEvent(baseChange(), CLOCK);
    const before = { ...event };
    expect(() => {
      "use strict";
      (event as { outcome: string }).outcome = "denied";
    }).toThrow();
    expect(event).toEqual(before);
  });

  it("keeps actorRoles frozen too, so pushing to it does not change the event", () => {
    const event = buildAuditEvent(baseChange(), CLOCK);
    expect(Object.isFrozen(event.actorRoles)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rule 4 — pure given a clock
// ---------------------------------------------------------------------------

describe("rule 4: pure given a clock", () => {
  it("draws its timestamp only from the clock it is handed, not the system clock", () => {
    const laterClock = fixedClock("2026-12-25T00:00:00.000Z");
    const event = buildAuditEvent(baseChange(), laterClock);
    expect(event.timestamp).toBe("2026-12-25T08:00:00.000+08:00");
  });

  it("does not mutate its input", () => {
    const input = baseChange();
    const inputCopy = { ...input, actorRoles: [...input.actorRoles] };
    buildAuditEvent(input, CLOCK);
    expect(input).toEqual(inputCopy);
  });
});

// ---------------------------------------------------------------------------
// Task 3 #Q8NMM3 — actorRole signature and audit export serialization
// ---------------------------------------------------------------------------

describe("Task 3 #Q8NMM3: actorRole signature and audit export serialization", () => {
  it("captures actorRole from input if specified", () => {
    const event = buildAuditEvent(baseChange({ actorRole: "supervisor" }), CLOCK);
    expect(event.actorRole).toBe("supervisor");
    expect(event.actorRoles).toEqual(["coordinator"]);
  });

  it("defaults actorRole to the first role in actorRoles if not explicitly provided", () => {
    const event = buildAuditEvent(baseChange({ actorRoles: ["clinician", "coordinator"] }), CLOCK);
    expect(event.actorRole).toBe("clinician");
  });

  it("serializes an audit entry to JSON with actorRole signature included", () => {
    const event: CaringContactsAuditEntry = buildAuditEvent(baseChange({ actorRole: "clinician" }), CLOCK);
    const serialized = serializeAuditEntry(event);
    const parsed = JSON.parse(serialized);

    expect(parsed.actorRole).toBe("clinician");
    expect(parsed.actorId).toBe("ACTOR-1");
    expect(parsed.teamId).toBe("TEAM-1");
    expect(parsed.action).toBe("activatePlan");
    expect(parsed.outcome).toBe("allowed");
    expect(parsed.timestamp).toBe("2026-08-19T10:00:00.000+08:00");
  });

  it("serializes and deserializes round-trip cleanly", () => {
    const original: CaringContactsAuditEntry = buildAuditEvent(
      baseChange({ actorRole: "coordinator", actorRoles: ["coordinator", "supervisor"] }),
      CLOCK,
    );
    const serialized = serializeAuditEntry(original);
    const deserialized = deserializeAuditEntry(serialized);

    expect(deserialized.actorRole).toBe("coordinator");
    expect(deserialized.actorRoles).toEqual(["coordinator", "supervisor"]);
    expect(deserialized.actorId).toBe(original.actorId);
    expect(deserialized.timestamp).toBe(original.timestamp);
    expect(deserialized.outcome).toBe(original.outcome);
  });

  it("serializes an array of audit entries into newline-delimited JSON", () => {
    const entry1: CaringContactsAuditEntry = buildAuditEvent(baseChange({ actorRole: "clinician" }), CLOCK);
    const entry2: CaringContactsAuditEntry = buildAuditEvent(
      baseChange({ actorRole: "coordinator", action: "viewPlan" }),
      CLOCK,
    );

    const trail = serializeAuditTrail([entry1, entry2]);
    const lines = trail.split("\n");
    expect(lines).toHaveLength(2);

    const parsed1 = JSON.parse(lines[0]);
    const parsed2 = JSON.parse(lines[1]);
    expect(parsed1.actorRole).toBe("clinician");
    expect(parsed2.actorRole).toBe("coordinator");
    expect(parsed2.action).toBe("viewPlan");
  });

  it("rejects deserializing entries containing mobile numbers", () => {
    const tampered = JSON.stringify({
      timestamp: "2026-08-19T10:00:00.000+08:00",
      actorId: "ACTOR-1",
      actorRole: "0491 570 156",
      actorRoles: ["coordinator"],
      teamId: "TEAM-1",
      action: "activatePlan",
      objectType: "plan",
      objectId: "PLAN-1",
      outcome: "allowed",
      idempotencyKey: "IDEMP-1",
    });

    expect(() => deserializeAuditEntry(tampered)).toThrow("audit-event-contains-patient-data");
  });

  it("handles whitespace-only actorRole by falling back to actorRoles or unknown", () => {
    const event = buildAuditEvent(baseChange({ actorRole: "   ", actorRoles: ["coordinator"] }), CLOCK);
    expect(event.actorRole).toBe("coordinator");

    const eventUnknown = buildAuditEvent(baseChange({ actorRole: "   ", actorRoles: [] }), CLOCK);
    expect(eventUnknown.actorRole).toBe("unknown");
  });

  it("rejects deserializing entries with missing required properties", () => {
    const invalidEntry = JSON.stringify({
      actorId: "ACTOR-1",
      // missing timestamp, action, teamId, etc.
    });

    expect(() => deserializeAuditEntry(invalidEntry)).toThrow("Invalid audit entry");
  });

  it("deserializes multi-line audit trail into CaringContactsAuditEntry array", () => {
    const entry1: CaringContactsAuditEntry = buildAuditEvent(baseChange({ actorRole: "clinician" }), CLOCK);
    const entry2: CaringContactsAuditEntry = buildAuditEvent(
      baseChange({ actorRole: "coordinator", action: "viewPlan" }),
      CLOCK,
    );
    const trail = serializeAuditTrail([entry1, entry2]);

    const deserialized = deserializeAuditTrail(trail);
    expect(deserialized).toHaveLength(2);
    expect(deserialized[0].actorRole).toBe("clinician");
    expect(deserialized[1].actorRole).toBe("coordinator");
    expect(deserialized[1].action).toBe("viewPlan");
  });
});
