// tests/caring-contacts-mobile-check.test.ts
//
// The pure rules behind the number check and the contact-detail edit (src/lib/caring-contacts/mobile-check.ts).
// The stores' use of them is pinned by the shared repository contract, which runs against both.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { containsAuMobileNumber } from "@/lib/caring-contacts/audit";
import { planId, teamId } from "@/lib/caring-contacts/ids";
import {
  MOBILE_CHECK_MESSAGE,
  MOBILE_CHECK_STATES,
  MOBILE_NOT_CHECKED,
  admitContactDetailEdit,
  admitPlanStart,
  contactDetailAuditAction,
  planAfterDetailWrite,
  recordMobileCheckSent,
  resolveMobileCheck,
  sameAustralianMobile,
  type ContactDetail,
  type MobileCheck,
} from "@/lib/caring-contacts/mobile-check";
import type { Plan, PlanState } from "@/lib/caring-contacts/model";

const SENT_AT = new Date("2026-03-02T03:00:00.000Z");
const ANSWERED_AT = new Date("2026-03-02T03:05:00.000Z");

const CURRENT: ContactDetail = {
  patientName: "Jordan Nguyen",
  preferredName: "Jordy",
  patientMobileNumber: "+61 491 570 156",
};

function plan(state: PlanState, version = 3): Plan {
  return { id: planId("PLAN-1"), teamId: teamId("TEAM-NORTH"), state, version };
}

describe("the test message", () => {
  it("is the agreed wording, word for word", () => {
    expect(MOBILE_CHECK_MESSAGE).toBe(
      "Hello, this is a one-off test message from the hospital's follow-up team, to check we have your number right. Please tell the staff member with you that it arrived. There is no need to reply.",
    );
  });
});

describe("the check's states", () => {
  it("lists exactly the states the migration's check constraint allows", () => {
    const migration = readFileSync(
      path.join(process.cwd(), "caring-contacts", "supabase", "migrations", "0030_caring_contacts_mobile_check.sql"),
      "utf8",
    ).replace(/--.*/g, "");
    const declaration = /mobile_check_state in \(([^)]*)\)/.exec(migration);
    expect(declaration).not.toBeNull();
    const listed = [...(declaration?.[1] ?? "").matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();
    expect(listed).toEqual([...MOBILE_CHECK_STATES].sort());
  });

  it("records a sent test as awaiting confirmation, from any state, clearing an earlier answer", () => {
    const confirmed: MobileCheck = { state: "confirmed", sentAt: "2026-01-01T00:00:00.000Z", resolvedAt: "x" };
    for (const from of [MOBILE_NOT_CHECKED, confirmed]) {
      expect(recordMobileCheckSent(from, SENT_AT)).toEqual({
        state: "awaitingConfirmation",
        sentAt: SENT_AT.toISOString(),
        resolvedAt: null,
      });
    }
  });

  it("records the answer only while a test is awaiting one", () => {
    const awaiting = recordMobileCheckSent(MOBILE_NOT_CHECKED, SENT_AT);
    expect(resolveMobileCheck(awaiting, "received", ANSWERED_AT)).toEqual({
      ok: true,
      value: { state: "confirmed", sentAt: SENT_AT.toISOString(), resolvedAt: ANSWERED_AT.toISOString() },
    });
    expect(resolveMobileCheck(awaiting, "notReceived", ANSWERED_AT)).toEqual({
      ok: true,
      value: { state: "notReceived", sentAt: SENT_AT.toISOString(), resolvedAt: ANSWERED_AT.toISOString() },
    });
    expect(resolveMobileCheck(MOBILE_NOT_CHECKED, "received", ANSWERED_AT)).toEqual({
      ok: false,
      reason: "mobile-check-not-awaiting",
    });
  });

  it("lets a plan start only when the number is unchecked or confirmed", () => {
    const verdicts = Object.fromEntries(
      MOBILE_CHECK_STATES.map((state) => [state, admitPlanStart({ state, sentAt: null, resolvedAt: null }).ok]),
    );
    expect(verdicts).toEqual({ notChecked: true, awaitingConfirmation: false, confirmed: true, notReceived: false });
    expect(admitPlanStart({ state: "notReceived", sentAt: null, resolvedAt: null })).toEqual({
      ok: false,
      reason: "mobile-check-unconfirmed",
    });
  });
});

describe("admitContactDetailEdit", () => {
  it("stores a changed mobile in the standard spaced form and names only the fields that changed", () => {
    const admitted = admitContactDetailEdit(CURRENT, { patientMobileNumber: "0491 570 157" });
    expect(admitted).toEqual({
      ok: true,
      value: { next: { ...CURRENT, patientMobileNumber: "+61 491 570 157" }, changed: ["mobile"] },
    });
  });

  it("treats the same number written differently as no change at all", () => {
    expect(admitContactDetailEdit(CURRENT, { patientMobileNumber: "0491570156" })).toEqual({
      ok: false,
      reason: "contact-detail-unchanged",
    });
    expect(sameAustralianMobile("0491 570 156", "+61491570156")).toBe(true);
  });

  it("refuses a blank name, an invalid mobile and an unsendable preferred name by name", () => {
    expect(admitContactDetailEdit(CURRENT, { patientName: "   " })).toEqual({
      ok: false,
      reason: "patient-name-blank",
    });
    expect(admitContactDetailEdit(CURRENT, { patientMobileNumber: "08 9222 1234" })).toEqual({
      ok: false,
      reason: "patient-mobile-invalid",
    });
    expect(admitContactDetailEdit(CURRENT, { preferredName: "  " })).toEqual({
      ok: false,
      reason: "patient-preferred-name-invalid",
    });
    expect(admitContactDetailEdit(CURRENT, { preferredName: "x".repeat(120) })).toEqual({
      ok: false,
      reason: "patient-preferred-name-invalid",
    });
  });

  it("trims names, accepts clearing the preferred name, and orders the changed fields", () => {
    const admitted = admitContactDetailEdit(CURRENT, {
      patientMobileNumber: "+61 491 570 157",
      preferredName: null,
      patientName: "  Jordan Nguyen-Smith ",
    });
    expect(admitted).toEqual({
      ok: true,
      value: {
        next: { patientName: "Jordan Nguyen-Smith", preferredName: null, patientMobileNumber: "+61 491 570 157" },
        changed: ["name", "preferredName", "mobile"],
      },
    });
  });

  it("refuses an edit that changes nothing", () => {
    expect(admitContactDetailEdit(CURRENT, {})).toEqual({ ok: false, reason: "contact-detail-unchanged" });
    expect(admitContactDetailEdit(CURRENT, { patientName: "Jordan Nguyen ", preferredName: "Jordy" })).toEqual({
      ok: false,
      reason: "contact-detail-unchanged",
    });
  });

  it("builds an audit action that names fields and can never hold a number or a name", () => {
    const action = contactDetailAuditAction(["name", "mobile"]);
    expect(action).toBe("updatePatientContactDetail:name,mobile");
    expect(containsAuMobileNumber(action)).toBe(false);
  });
});

describe("planAfterDetailWrite", () => {
  it("pauses an active plan on a changed mobile through the existing hospital event", () => {
    const moved = planAfterDetailWrite(plan("active"), true);
    expect(moved).toEqual({
      ok: true,
      value: { plan: { ...plan("active"), state: "paused", version: 4 }, exceptions: [{ type: "contactChanged" }] },
    });
  });

  it("keeps a paused plan paused, still raising the change, and moves the version on once", () => {
    expect(planAfterDetailWrite(plan("paused"), true)).toEqual({
      ok: true,
      value: { plan: { ...plan("paused"), version: 4 }, exceptions: [{ type: "contactChanged" }] },
    });
  });

  it("changes a draft's number without pausing anything, and a name-only edit pauses nothing", () => {
    expect(planAfterDetailWrite(plan("draft"), true)).toEqual({
      ok: true,
      value: { plan: { ...plan("draft"), version: 4 }, exceptions: [] },
    });
    expect(planAfterDetailWrite(plan("active"), false)).toEqual({
      ok: true,
      value: { plan: { ...plan("active"), version: 4 }, exceptions: [] },
    });
  });

  it("refuses an ended plan with the domain's own reason", () => {
    for (const state of ["withdrawn", "cancelled", "completed"] as const) {
      expect(planAfterDetailWrite(plan(state), true)).toEqual({ ok: false, reason: "plan-terminal" });
    }
  });
});
