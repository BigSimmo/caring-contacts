// tests/caring-contacts-plan-activation.test.ts
//
// What stage 4 collects, what it derives, and the body it sends (Phase 2B Task 9).
//
// The module under test is pure — no React, no storage, no fetch — because every decision in it is
// a decision about a VALUE, and the wizard is a Client Component whose DOM tests cannot prove a
// value cheaply. What is pinned here, and why each one:
//
//   * Ruling [120] — the plan id and the idempotency key are minted ONCE and reused, and both must
//     survive the audit trail's own guards. A minted id the trail refuses would switch off the
//     audit record for the one write this whole workspace performs.
//   * Ruling [121] — `dischargeAt` is collected here, and the instant it becomes must land on the
//     AWST calendar day the clinician chose.
//   * Ruling [118] — the first-contact day, its range, its reason, and the CONSEQUENCE of moving
//     it: at discharge + 7 the Week 1 contact is absorbed and the plan sends nine, not ten.
//   * Ruling [119] — every count is derived. The strongest available pin is here: the preview the
//     screen shows is compared against `summariseStoredContacts` over the contacts the store
//     ACTUALLY creates from the same input, so a preview that agreed only with itself goes red.
//
// `createPlanRequestBody` is likewise not checked against a copy of the schema. The body it builds
// is POSTed to the real route handler, so `.strict()`, every `min(1)` and the `auditableIdentifier`
// shape are all enforced by the thing that will enforce them in production.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ store: { current: null as unknown } }));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: (name: string) => mockCookies[name] })),
}));

vi.mock("@/lib/caring-contacts-server/store", () => ({
  caringContactsStore: async () => mocks.store.current,
}));

import {
  EMPTY_PLAN_ACTIVATION,
  activatePlanRequestBody,
  activationRefusalWording,
  createPlanRequestBody,
  unconfirmedAssuranceLabels,
  unconfirmedAssuranceSentence,
  planVersionFromCreateAnswer,
  dischargeInstantFor,
  firstContactReasonIsRequired,
  mintPlanSubmissionIdentity,
  planSchedulePreview,
  submissionRefusalWording,
  type PlanActivationDraft,
} from "@/components/caring-contacts/workspace/plan-wizard/plan-activation";
import { CARING_CONTACTS_ROLE_COOKIE, demoActorForRole } from "@/lib/caring-contacts-server/session";
import { buildAccessAuditEvent } from "@/lib/caring-contacts/access-audit";
import { PLAN_ASSURANCE_VALUES } from "@/lib/caring-contacts/assurances";
import { awstCalendarDay, fixedClock } from "@/lib/caring-contacts/clock";
import { createInMemoryRepository } from "@/lib/caring-contacts/in-memory-repository";
import {
  actorId,
  idempotencyKey,
  patientId,
  planId,
  referralId,
  pathwayVersionId,
  teamId,
} from "@/lib/caring-contacts/ids";
import { summariseStoredContacts } from "@/lib/caring-contacts/repository";
import {
  buildApprovedSchedule,
  firstContactDayBounds,
  FIRST_CONTACT_REASON_MAX_LENGTH,
} from "@/lib/caring-contacts/schedule";

let mockCookies: Record<string, { value: string } | undefined> = {};

// The screen refuses a discharge day in the future or more than 90 days ago, counted from today.
// These cases are written around a March 2026 discharge, so "today" is pinned two days after it.
// Only `Date` is faked; timers still run, so nothing here waits on a clock that never moves.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-12T04:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const DISCHARGE_DAY = "2026-03-10";
const NOW = "2026-03-10T03:00:00.000Z";

const PATIENT_DETAIL = {
  patientName: "Rowan Example",
  patientMobileNumber: "+61 491 570 156",
  patientIdentifiers: ["UR-00219384"],
  culturalIdentity: null,
  preferredName: "Rowan",
};

/** A stage-1 panel with every confirmation made, which is the only state stage 4 can be reached in. */
const BOTH_CONFIRMED = { patientAgreed: true, mobileIsPatientControlled: true };

function activation(overrides: Partial<PlanActivationDraft> = {}): PlanActivationDraft {
  return { ...EMPTY_PLAN_ACTIVATION, dischargeDay: DISCHARGE_DAY, ...overrides };
}

function bounds() {
  const resolved = firstContactDayBounds(DISCHARGE_DAY);
  if (resolved === null) throw new Error("the fixture discharge day is not a calendar day");
  return resolved;
}

function ready(preview: ReturnType<typeof planSchedulePreview>) {
  if (preview.kind !== "ready") throw new Error(`expected a ready preview, got ${preview.kind}`);
  return preview;
}

describe("minting the plan id and the idempotency key (Ruling [120])", () => {
  it("mints a different pair every time it is called", () => {
    const first = mintPlanSubmissionIdentity();
    const second = mintPlanSubmissionIdentity();

    // The wrong value this rejects: a constant. A fixed plan id would make the SECOND patient
    // signed up on this machine collide with the first, and the collision is refused as a replay —
    // so the second clinician's plan would silently never be created.
    expect(first.planId).not.toBe(second.planId);
    expect(first.createIdempotencyKey).not.toBe(second.createIdempotencyKey);
    // And the two halves of one pair are not the same value either: one key covering one plan is
    // the contract, but a key that IS the plan id would make a retry of a different write on the
    // same plan collide with the create.
    expect(first.planId).not.toBe(first.createIdempotencyKey);
  });

  it("mints identifiers the audit trail itself accepts", () => {
    // NOT a regex written here. `buildAccessAuditEvent` applies the id-shape allowlist AND the
    // audit event's own mobile-number scan, and either of them throwing means the write this
    // screen performs would leave no audit record. The wrong value this rejects is an id
    // containing a run of digits that reads as an Australian mobile number — which a random
    // hexadecimal identifier can produce.
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const minted = mintPlanSubmissionIdentity();
      for (const value of [minted.planId, minted.createIdempotencyKey]) {
        expect(() =>
          buildAccessAuditEvent(
            {
              actorId: actorId("demo-coordinator"),
              actorRoles: ["coordinator"],
              teamId: teamId("SYN-TEAM-001"),
              kind: "mutation",
              objectType: "plan",
              objectId: value,
              outcome: "denied",
            },
            fixedClock(NOW),
          ),
        ).not.toThrow();
        // Belt and braces, and it is the property that makes the guard above unable to fail: no
        // digits at all means no digit run can ever read as a phone number.
        expect(value, "a minted identifier carries a digit, so it could one day read as a number").not.toMatch(/\d/);
      }
    }
  });
});

describe("the discharge day stage 4 collects (Ruling [121])", () => {
  it("turns a chosen AWST day into an instant that falls on that same AWST day", () => {
    const instant = dischargeInstantFor(DISCHARGE_DAY);
    expect(instant).not.toBeNull();
    // The wrong value this rejects: UTC midnight for the chosen day, which in AWST is 8am the same
    // day, and for any wall time before 08:00 AWST is the day BEFORE.
    // `buildApprovedSchedule` hangs the entire twelve-month calendar off the AWST day of this
    // instant, so a day out is a year of dates out.
    expect(awstCalendarDay(instant!)).toBe(DISCHARGE_DAY);
  });

  it("answers null for anything that is not a real AWST calendar day", () => {
    expect(dischargeInstantFor("")).toBeNull();
    expect(dischargeInstantFor("2026-02-30")).toBeNull();
    expect(dischargeInstantFor("10/03/2026")).toBeNull();
  });
});

describe("the schedule preview stage 4 derives (Rulings [118] and [119])", () => {
  it("says what is missing rather than previewing a schedule it cannot build", () => {
    const noDischarge = planSchedulePreview({ activation: EMPTY_PLAN_ACTIVATION, sendingPreference: "morning" });
    expect(noDischarge.kind).toBe("incomplete");
    if (noDischarge.kind === "incomplete") {
      expect(noDischarge.issues.map((issue) => issue.code)).toEqual(["discharge-day-required"]);
    }

    const badDischarge = planSchedulePreview({
      activation: activation({ dischargeDay: "2026-02-30" }),
      sendingPreference: "morning",
    });
    expect(badDischarge.kind).toBe("incomplete");
    if (badDischarge.kind === "incomplete") {
      expect(badDischarge.issues.map((issue) => issue.code)).toEqual(["discharge-day-invalid"]);
    }

    // Today is pinned to 2026-03-12 (AWST). A future discharge, and one more than 90 days back, are
    // refused with their own code; exactly 90 days back is still allowed.
    for (const outside of ["2026-03-13", "2025-12-11"]) {
      const preview = planSchedulePreview({
        activation: activation({ dischargeDay: outside }),
        sendingPreference: "morning",
      });
      expect(preview.kind).toBe("incomplete");
      if (preview.kind === "incomplete") {
        expect(preview.issues.map((issue) => issue.code)).toEqual(["discharge-day-out-of-range"]);
      }
    }
    expect(
      planSchedulePreview({ activation: activation({ dischargeDay: "2025-12-12" }), sendingPreference: "morning" })
        .kind,
    ).not.toBe("incomplete");

    const noPreference = planSchedulePreview({ activation: activation(), sendingPreference: null });
    expect(noPreference.kind).toBe("incomplete");
    if (noPreference.kind === "incomplete") {
      expect(noPreference.issues.map((issue) => issue.code)).toEqual(["sending-preference-required"]);
    }
  });

  it("previews the usual day as ten entries, of which one is the closing message", () => {
    const preview = ready(planSchedulePreview({ activation: activation(), sendingPreference: "morning" }));

    expect(preview.firstContactDay).toBe(bounds().usual);
    expect(preview.movedFromUsualDay).toBe(false);
    // Ruling [98]/[119]: derived, never the mockup's literal. The wrong value this rejects is the
    // "10-contact schedule" heading — ten ENTRIES is right, ten caring contacts is not, because the
    // last one is a closing message.
    expect(preview.summary.total).toBe(10);
    expect(preview.summary.stillToSend).toBe(10);
    expect(preview.summary.willNotBeSent).toBe(0);
    expect(preview.summary.closing).toBe(1);
  });

  it("previews discharge + 7 as NINE messages, because Week 1 is absorbed (Ruling [118])", () => {
    const preview = ready(
      planSchedulePreview({
        activation: activation({
          firstContactDay: bounds().latest,
          firstContactReason: "The ward agreed this day with the patient before discharge.",
        }),
        sendingPreference: "morning",
      }),
    );

    // This is the consequence the clinician must see BEFORE the choice is committed. The wrong
    // value it rejects is ten — the count every other day in the range produces, and the count the
    // approved mockup writes as a literal.
    expect(preview.summary.total).toBe(10);
    expect(preview.summary.stillToSend).toBe(9);
    expect(preview.summary.willNotBeSent).toBe(1);
    expect(preview.absorbed.map((contact) => contact.cadenceLabel)).toEqual(["Week 1"]);
    expect(preview.movedFromUsualDay).toBe(true);
  });

  it("agrees with the contacts the store actually creates, on both the usual day and discharge + 7", async () => {
    // RULING [119], and the only pin here that can fail honestly. Every other assertion in this
    // file compares the preview against numbers written here; this one compares it against
    // `summariseStoredContacts` — one of the two functions the ruling names — over a plan the
    // in-memory store really built from the same input. A preview that counted its own way would
    // disagree here even while agreeing with itself everywhere else.
    for (const [label, chosen, reason] of [
      ["the usual day", "", ""],
      ["discharge + 7", bounds().latest, "The ward agreed this day with the patient before discharge."],
    ] as const) {
      const draft = activation({ firstContactDay: chosen, firstContactReason: reason });
      const preview = ready(planSchedulePreview({ activation: draft, sendingPreference: "morning" }));

      const store = createInMemoryRepository(fixedClock(NOW));
      const created = await store.createPlan(
        {
          planId: planId("SYN-PLAN-PREVIEW"),
          assurances: PLAN_ASSURANCE_VALUES,
          referralId: referralId("SYN-REFERRAL-001"),
          patientId: patientId("SYN-PATIENT-001"),
          pathwayVersionId: pathwayVersionId("SYN-PATHWAY-001"),
          dischargeAt: dischargeInstantFor(DISCHARGE_DAY)!,
          sendingPreference: "morning",
          firstContactDate: chosen === "" ? undefined : chosen,
          firstContactReason: reason === "" ? undefined : reason,
          patientDetail: PATIENT_DETAIL,
        },
        { actor: demoActorForRole("coordinator"), idempotencyKey: idempotencyKey("preview-create") },
      );
      if (!created.ok) throw new Error(`${label}: the store refused the same input (${created.reason})`);

      const stored = summariseStoredContacts(created.value.contacts);
      expect(preview.summary.total, `${label}: the preview counts a different number of entries`).toBe(stored.total);
      expect(preview.summary.stillToSend, `${label}: the preview promises a different number of messages`).toBe(
        stored.stillToSend,
      );
      expect(preview.summary.willNotBeSent, `${label}: the preview hides a message the store will not send`).toBe(
        stored.willNotBeSent,
      );
      expect(preview.contacts.map((contact) => contact.calendarDay)).toEqual(
        created.value.contacts.map((entry) => entry.planned.calendarDay),
      );
    }
  });

  it("names the schedule's own refusal rather than deciding for itself that a value is wrong", () => {
    const moved = { firstContactDay: bounds().latest };

    const noReason = planSchedulePreview({ activation: activation(moved), sendingPreference: "morning" });
    expect(noReason.kind).toBe("refused");
    if (noReason.kind === "refused") expect(noReason.refusal).toBe("first-contact-reason-required");

    const tooLong = planSchedulePreview({
      activation: activation({ ...moved, firstContactReason: "x".repeat(FIRST_CONTACT_REASON_MAX_LENGTH + 1) }),
      sendingPreference: "morning",
    });
    expect(tooLong.kind).toBe("refused");
    if (tooLong.kind === "refused") expect(tooLong.refusal).toBe("first-contact-reason-too-long");

    const outOfRange = planSchedulePreview({
      activation: activation({ firstContactDay: "2026-03-20", firstContactReason: "Agreed with the ward." }),
      sendingPreference: "morning",
    });
    expect(outOfRange.kind).toBe("refused");
    if (outOfRange.kind === "refused") expect(outOfRange.refusal).toBe("first-contact-out-of-range");

    // A reason of exactly the maximum length is accepted, so "too long" means longer than the limit
    // rather than at it — the wrong value that rejects is an off-by-one refusing a reason the
    // domain takes.
    const atCap = planSchedulePreview({
      activation: activation({ ...moved, firstContactReason: "x".repeat(FIRST_CONTACT_REASON_MAX_LENGTH) }),
      sendingPreference: "morning",
    });
    expect(atCap.kind).toBe("ready");
  });
});

describe("when the screen asks for a reason (Ruling [118])", () => {
  it("asks for one on exactly the days the schedule refuses without one", () => {
    // The property, not a copy of the rule. For every day the control can offer, the screen's
    // decision to show the reason field must agree with what `buildApprovedSchedule` does when no
    // reason is supplied. The wrong value this rejects is "ask on every moved day except the
    // earliest", or any other off-by-one at the ends of the range.
    const range = bounds();
    const offered = daysFrom(range.earliest, range.latest);
    expect(offered.length, "the range under test collapsed to nothing").toBeGreaterThan(2);

    for (const day of offered) {
      const refusedWithoutReason =
        buildApprovedSchedule({
          dischargeAt: dischargeInstantFor(DISCHARGE_DAY)!,
          sendingPreference: "morning",
          firstContactDate: day,
        }).ok === false;

      expect(
        firstContactReasonIsRequired({ dischargeDay: DISCHARGE_DAY, firstContactDay: day }),
        `${day}: the screen and the schedule disagree about whether a reason is required`,
      ).toBe(refusedWithoutReason);
    }
  });

  it("asks for none while no day has been chosen, because the usual day needs none", () => {
    expect(firstContactReasonIsRequired({ dischargeDay: DISCHARGE_DAY, firstContactDay: "" })).toBe(false);
    expect(firstContactReasonIsRequired({ dischargeDay: "", firstContactDay: "" })).toBe(false);
  });
});

describe("the body stage 4 sends", () => {
  it("is accepted by the real route, which is what proves it matches the schema", async () => {
    mockCookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: "coordinator" } };
    const store = createInMemoryRepository(fixedClock(NOW));
    mocks.store.current = store;

    // The route refuses a plan whose referral is not accepted for this patient, or whose pathway
    // version is not approved, so both are created through the store's own writes first.
    const author = demoActorForRole("coordinator");
    const write = (actor: ReturnType<typeof demoActorForRole>, key: string) => ({
      actor,
      idempotencyKey: idempotencyKey(key),
    });
    const setup = [
      await store.savePathwayVersion(
        {
          version: {
            id: pathwayVersionId("SYN-PATHWAY-001"),
            teamId: author.teamId,
            state: "draft",
            authorId: author.id,
            approvals: [],
            publishedAt: null,
            retiredAt: null,
            retirementUrgency: null,
            snapshot: { cadenceLabels: ["Day 1"], messageTextByType: { standard: "s", first: "f", closing: "c" } },
          },
        },
        write(author, "setup-save"),
      ),
      await store.transitionPathwayVersion(
        { pathwayVersionId: pathwayVersionId("SYN-PATHWAY-001"), action: { type: "submitForReview" } },
        write(author, "setup-submit"),
      ),
      ...(await Promise.all(
        (["clinicalProgrammeLead", "livedExperienceRepresentative"] as const).map(async (role) => {
          const approver = demoActorForRole(role);
          return store.transitionPathwayVersion(
            {
              pathwayVersionId: pathwayVersionId("SYN-PATHWAY-001"),
              action: { type: "approve", role, actorId: approver.id },
            },
            write(approver, `setup-approve-${role}`),
          );
        }),
      )),
      await store.createReferral(
        { referralId: referralId("SYN-REFERRAL-001"), patientId: patientId("SYN-PATIENT-001") },
        write(author, "setup-referral"),
      ),
      await store.transitionReferral(
        {
          referralId: referralId("SYN-REFERRAL-001"),
          action: { type: "accept", pathwayVersionId: pathwayVersionId("SYN-PATHWAY-001") },
        },
        write(author, "setup-accept"),
      ),
    ];
    for (const step of setup) if (!step.ok) throw new Error(`setup refused: ${step.reason}`);

    const minted = mintPlanSubmissionIdentity();
    const body = createPlanRequestBody({
      submission: minted,
      referralId: "SYN-REFERRAL-001",
      patientId: "SYN-PATIENT-001",
      pathwayVersionId: "SYN-PATHWAY-001",
      activation: activation(),
      sendingPreference: "morning",
      patientDetail: PATIENT_DETAIL,
      assurances: BOTH_CONFIRMED,
    });
    expect(body).not.toBeNull();

    const { POST } = await import("@/app/api/caring-contacts/plans/route");
    const response = await POST(
      new NextRequest("http://localhost/api/caring-contacts/plans", { method: "POST", body: JSON.stringify(body) }),
    );

    // 400 here would mean the body failed `createPlanSchema` — the failure mode a hand-written
    // list of expected keys cannot see, because `.strict()` refuses a fifth key outright.
    expect(response.status, `the route refused the body: ${await response.clone().text()}`).toBe(200);
  });

  it("sends the day the screen showed, and omits a reason nobody had to give", () => {
    const body = createPlanRequestBody({
      submission: mintPlanSubmissionIdentity(),
      referralId: "SYN-REFERRAL-001",
      patientId: "SYN-PATIENT-001",
      pathwayVersionId: "SYN-PATHWAY-001",
      activation: activation(),
      sendingPreference: "morning",
      patientDetail: PATIENT_DETAIL,
      assurances: BOTH_CONFIRMED,
    });

    expect(body).not.toBeNull();
    // The day is sent explicitly rather than left to the domain's default, because the screen
    // showed a specific day and the plan must be created for the day that was read back.
    expect(body!.firstContactDate).toBe(bounds().usual);
    // `firstContactReason` is `z.string().min(1).optional()`, so an empty string is REFUSED
    // outright. The wrong value this rejects is `""`.
    expect(Object.keys(body!)).not.toContain("firstContactReason");
  });

  it("refuses to build a body while anything required is missing", () => {
    const common = {
      submission: mintPlanSubmissionIdentity(),
      referralId: "SYN-REFERRAL-001",
      patientId: "SYN-PATIENT-001",
      pathwayVersionId: "SYN-PATHWAY-001" as string | null,
      activation: activation(),
      sendingPreference: "morning" as const,
      patientDetail: PATIENT_DETAIL,
      assurances: BOTH_CONFIRMED,
    };

    expect(createPlanRequestBody({ ...common, submission: null })).toBeNull();
    expect(createPlanRequestBody({ ...common, patientDetail: null })).toBeNull();
    expect(createPlanRequestBody({ ...common, sendingPreference: null })).toBeNull();
    expect(createPlanRequestBody({ ...common, activation: EMPTY_PLAN_ACTIVATION })).toBeNull();
    expect(createPlanRequestBody({ ...common, pathwayVersionId: null })).toBeNull();
  });

  it("refuses to build a body while any stage-1 confirmation is missing, not merely all of them", () => {
    // THE REACHABLE PATH THIS GUARDS, and it only became reachable when the confirmations started
    // being recorded. Stage 1 will not advance until every confirmation is made, so a coordinator
    // walking the wizard cannot arrive here half-ticked. A DRAFT RESTORED FROM A TAB'S STORAGE can:
    // it is parsed input, not a promise. Without this, such a draft creates a plan attesting one
    // confirmation that never passed the gate -- an attestation of something that did not happen,
    // which is the single outcome this whole feature exists to prevent.
    //
    // The domain's own rule is deliberately weaker (at least one, no repeats) because WHICH
    // confirmations are asked for belongs to the screen that asks. This is the screen asserting its
    // own rule, and the case is here rather than in the contract for that reason.
    const common = {
      submission: mintPlanSubmissionIdentity(),
      referralId: "SYN-REFERRAL-001",
      patientId: "SYN-PATIENT-001",
      pathwayVersionId: "SYN-PATHWAY-001" as string | null,
      activation: activation(),
      sendingPreference: "morning" as const,
      patientDetail: PATIENT_DETAIL,
      assurances: BOTH_CONFIRMED,
    };

    // Positive control: with both made, this same input DOES build a body -- so the nulls below are
    // the confirmations and not some other missing field.
    expect(createPlanRequestBody(common)).not.toBeNull();

    expect(
      createPlanRequestBody({ ...common, assurances: { patientAgreed: true, mobileIsPatientControlled: false } }),
    ).toBeNull();
    expect(
      createPlanRequestBody({ ...common, assurances: { patientAgreed: false, mobileIsPatientControlled: true } }),
    ).toBeNull();
    expect(
      createPlanRequestBody({ ...common, assurances: { patientAgreed: false, mobileIsPatientControlled: false } }),
    ).toBeNull();
  });

  it("names which confirmation is still to be made, rather than saying one of them is missing", () => {
    // "At least one of the confirmations is not ticked" tells a coordinator they are blocked without
    // telling them by what, on the one screen whose only remedy is to go back a stage and hunt.
    const both = unconfirmedAssuranceSentence({ patientAgreed: false, mobileIsPatientControlled: false });
    expect(both).toContain("that the patient agreed to receive caring contacts");
    expect(both).toContain("that the number this plan will use is the patient's own");

    const mobileOnly = unconfirmedAssuranceSentence({ patientAgreed: true, mobileIsPatientControlled: false });
    expect(mobileOnly).toContain("that the number this plan will use is the patient's own");
    // The one already made is NOT listed as outstanding. Without this the sentence could name every
    // confirmation every time and still pass the assertion above.
    expect(mobileOnly).not.toContain("that the patient agreed to receive caring contacts");

    const agreementOnly = unconfirmedAssuranceSentence({ patientAgreed: false, mobileIsPatientControlled: true });
    expect(agreementOnly).toContain("that the patient agreed to receive caring contacts");
    expect(agreementOnly).not.toContain("that the number this plan will use is the patient's own");

    // It states what is outstanding, never that the patient refused. A coordinator who has not yet
    // confirmed a check has not learned anything about the patient.
    for (const sentence of [both, mobileOnly, agreementOnly]) {
      expect(sentence).not.toMatch(/did not agree|refused|declined|does not consent/i);
    }
  });

  it("lists every assurance the domain knows as outstanding when none has been made", () => {
    // The list is DERIVED by subtracting what was confirmed from `PLAN_ASSURANCE_VALUES`, not
    // branched per checkbox -- so a third confirmation added to the domain appears here without this
    // module being touched. This case is what would go red if someone replaced the derivation with a
    // pair of hardcoded strings.
    expect(unconfirmedAssuranceLabels({ patientAgreed: false, mobileIsPatientControlled: false })).toHaveLength(
      PLAN_ASSURANCE_VALUES.length,
    );
    expect(unconfirmedAssuranceLabels(BOTH_CONFIRMED)).toEqual([]);
  });
});

describe("what the screen says when the write is refused (Ruling [117])", () => {
  it("tells the three kinds of refusal apart, in words", () => {
    const denied = submissionRefusalWording("action-not-granted");
    const exists = submissionRefusalWording("duplicate-active-plan");
    const schedule = submissionRefusalWording("first-contact-reason-required");

    // The three the ruling names must not read alike, and the wrong value this rejects is one
    // sentence reused for all of them.
    expect(new Set([denied.heading, exists.heading, schedule.heading]).size).toBe(3);
    expect(denied.heading).toMatch(/not allowed|not permitted|cannot/i);
    expect(exists.heading).toMatch(/already/i);
    expect(schedule.heading).toMatch(/schedule/i);
  });

  it("never says only that something went wrong, whatever the refusal is called", () => {
    // The failure this exists to prevent, stated as a property over every refusal the boundary can
    // produce plus one it cannot. A default reading "Something went wrong" would pass a check that
    // only looked at named refusals.
    const named = [
      "not-found",
      "permission-denied",
      "cross-team-denied",
      "action-not-granted",
      "no-roles",
      "stale-version",
      "duplicate-active-plan",
      "plan-already-exists",
      "idempotency-key-reused-for-a-different-write",
      "service-stopped",
      "invalid-request",
      "request-body-too-large",
      "access-audit-unavailable",
      "first-contact-invalid-date",
      "first-contact-out-of-range",
      "first-contact-reason-required",
      "first-contact-reason-too-long",
      "unknown-sending-preference",
      "invalid-discharge-instant",
      "contacts-not-strictly-increasing",
      "a-refusal-nobody-has-written-yet",
    ];
    for (const refusal of named) {
      const wording = submissionRefusalWording(refusal);
      expect(wording.heading, `${refusal} is not explained`).not.toMatch(/something went wrong/i);
      expect(wording.because.length, `${refusal} has no reason`).toBeGreaterThan(20);
      expect(wording.changedBy.length, `${refusal} has no remedy`).toBeGreaterThan(10);
      // Every refusal must say the draft is still here. A clinician who has typed a name, a mobile
      // number and identifiers needs to know they have not lost them.
      expect(`${wording.because} ${wording.changedBy}`, `${refusal} does not say the draft survived`).toMatch(
        /still on this computer/i,
      );
    }

    // The unnamed one still names ITSELF, so an unmapped refusal is legible rather than mute.
    expect(submissionRefusalWording("a-refusal-nobody-has-written-yet").because).toContain(
      "a-refusal-nobody-has-written-yet",
    );
  });
});

/** Every calendar day from `from` to `to` inclusive. */
function daysFrom(from: string, to: string): string[] {
  const days: string[] = [];
  let cursor = from;
  for (let guard = 0; guard < 40 && cursor <= to; guard += 1) {
    days.push(cursor);
    const [year, month, day] = cursor.split("-").map(Number);
    cursor = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  }
  return days;
}

describe("the second write: starting the plan that was just created (Ruling [123])", () => {
  it("mints a SECOND idempotency key, independent of the first and of the plan id", () => {
    const minted = mintPlanSubmissionIdentity();

    // Three values, not two, and none derived from another. One key answers one write: a second
    // write carrying the first write's key would be refused as a replay of a different request
    // (`idempotency-key-reused-for-a-different-write`), so the plan would be created and could
    // never be started.
    expect(new Set([minted.planId, minted.createIdempotencyKey, minted.activateIdempotencyKey]).size).toBe(3);

    // A cheap extra, and NOT the independence pin -- see the case below for why.
    expect(minted.activateIdempotencyKey).not.toContain(minted.createIdempotencyKey.replace("PLAN-CREATE-", ""));

    const second = mintPlanSubmissionIdentity();
    expect(second.activateIdempotencyKey).not.toBe(minted.activateIdempotencyKey);
  });

  it("draws each of the three identifiers from its own source of randomness", () => {
    // ROUND 2, I2. The assertion above is a SUBSTRING pin, not an independence pin: it catches
    // literal embedding, which is what mutation N2b did, and nothing else. A hash of the create
    // key, a reversal of it, or any other derivation passes it while leaving the activate key
    // exactly as dependent on the create key as a copy would be.
    //
    // This pins the property instead: three identifiers, three independent draws. A derivation of
    // any kind consumes fewer draws, so the call count catches every shape of it at once -- and
    // pairwise distinctness catches the remaining case where three draws are taken and one is
    // thrown away.
    const draws = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    ];
    let next = 0;
    const randomUUID = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockImplementation(() => draws[next++ % draws.length] as `${string}-${string}-${string}-${string}-${string}`);

    const minted = mintPlanSubmissionIdentity();

    // The double IS asserted to have been used. A stub nothing calls is the shape that let a
    // previous test in this wizard pass inert.
    expect(randomUUID, "the mint did not draw from crypto.randomUUID at all").toHaveBeenCalledTimes(3);
    const values = [minted.planId, minted.createIdempotencyKey, minted.activateIdempotencyKey];
    expect(new Set(values).size, "two identifiers came from the same draw").toBe(3);
    // Each identifier's random half differs from the others', which is what "its own draw" means
    // once the prefixes are removed.
    const halves = values.map((value) => value.replace(/^PLAN-(CREATE-|START-)?/, ""));
    expect(new Set(halves).size, "two identifiers share a random half, so one was derived").toBe(3);
  });

  it("mints an activate key the audit trail accepts, on the same terms as the other two", () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const value = mintPlanSubmissionIdentity().activateIdempotencyKey;
      expect(() =>
        buildAccessAuditEvent(
          {
            actorId: actorId("demo-coordinator"),
            actorRoles: ["coordinator"],
            teamId: teamId("SYN-TEAM-001"),
            kind: "mutation",
            objectType: "plan",
            objectId: value,
            outcome: "denied",
          },
          fixedClock(NOW),
        ),
      ).not.toThrow();
      expect(value, "the activate key carries a digit, so it could one day read as a number").not.toMatch(/\d/);
    }
  });

  it("reads the version to start from out of the create's own answer, never a guess", () => {
    // `expectedVersion` is an optimistic-concurrency check. Guessing 1 would be right today and
    // wrong the moment anything else touches the plan between the two writes, and the store would
    // then refuse `stale-version` on a plan that had just been created.
    expect(planVersionFromCreateAnswer({ value: { plan: { id: "SYN-PLAN-001", version: 4 } } })).toBe(4);

    // Anything this screen cannot read a version out of is null, not a default. A default would be
    // a guess wearing a number.
    expect(planVersionFromCreateAnswer({ value: { plan: { id: "SYN-PLAN-001" } } })).toBeNull();
    expect(planVersionFromCreateAnswer({ value: null })).toBeNull();
    expect(planVersionFromCreateAnswer({})).toBeNull();
    expect(planVersionFromCreateAnswer("not an object")).toBeNull();
    expect(planVersionFromCreateAnswer({ value: { plan: { version: 0 } } })).toBeNull();
    expect(planVersionFromCreateAnswer({ value: { plan: { version: 1.5 } } })).toBeNull();
  });

  it("builds a body the real lifecycle route accepts, and the plan really starts", async () => {
    mockCookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: "coordinator" } };
    const store = createInMemoryRepository(fixedClock(NOW));
    mocks.store.current = store;

    const minted = mintPlanSubmissionIdentity();
    const created = await store.createPlan(
      {
        planId: planId(minted.planId),
        referralId: referralId("SYN-REFERRAL-001"),
        patientId: patientId("SYN-PATIENT-001"),
        pathwayVersionId: pathwayVersionId("SYN-PATHWAY-001"),
        dischargeAt: dischargeInstantFor(DISCHARGE_DAY)!,
        sendingPreference: "morning",
        assurances: PLAN_ASSURANCE_VALUES,
        patientDetail: PATIENT_DETAIL,
      },
      { actor: demoActorForRole("coordinator"), idempotencyKey: idempotencyKey(minted.createIdempotencyKey) },
    );
    if (!created.ok) throw new Error(`the store refused the create: ${created.reason}`);

    const body = activatePlanRequestBody({ submission: minted, expectedVersion: created.value.plan.version });
    const { POST } = await import("@/app/api/caring-contacts/plans/[planId]/route");
    const response = await POST(
      new NextRequest(`http://localhost/api/caring-contacts/plans/${minted.planId}`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ planId: minted.planId }) },
    );

    // The lifecycle schema is a `.strict()` discriminated union, so a wrong key or a missing one is
    // a 400 rather than something this screen could paper over.
    expect(response.status, `the route refused the body: ${await response.clone().text()}`).toBe(200);

    // And the plan really started. A 200 that left the plan in draft would be the exact failure
    // this whole second write exists to prevent.
    const record = await store.getPlan(planId(minted.planId), { actor: demoActorForRole("coordinator") });
    expect(record?.plan.state).toBe("active");
  });
});

describe("what the screen says when the plan was created but did not start (Ruling [123])", () => {
  /**
   * The refusals after which the plan is still sitting in draft, waiting to be started.
   *
   * A refusal means the write did not happen, so "it has not been started" is true of all of these.
   */
  const STILL_WAITING = [
    "stale-version",
    "not-found",
    "permission-denied",
    "action-not-granted",
    "no-roles",
    "service-stopped",
    "mobile-check-unconfirmed",
    "invalid-request",
    "request-body-too-large",
    "access-audit-unavailable",
    "request-did-not-reach-the-service",
    "a-refusal-nobody-has-written-yet",
  ];

  /**
   * The refusals after which the plan MAY ALREADY HAVE STARTED, so no branch may claim otherwise.
   *
   * ROUND 2, C3, AND THE OLD ASSERTION WAS ENFORCING A FALSEHOOD. The previous version of this walk
   * required EVERY branch to match /not started|has not been started/, and `plan-not-draft` renders
   * "It has not been started ... an earlier attempt already started it" -- a branch asserting and
   * denying one fact, with a test holding it there. Relaxing that requirement for these three is
   * not loosening a test to fit a change; it is deleting an assertion that was pinning a
   * contradiction, and the replacement below is STRICTER than what it replaces: each of these must
   * now positively refuse the claim and send the reader to look.
   *
   * The review named `plan-not-draft`. Two more have the identical defect and are included here:
   * `plan-terminal` (a plan that has been ended may well have run first) and
   * `service-answered-with-something-unreadable` (the write may have landed -- that branch's own
   * heading already said "it is not clear whether it started" while the shared prefix denied it).
   */
  const MAY_HAVE_STARTED = ["plan-not-draft", "plan-terminal", "service-answered-with-something-unreadable"];

  const ALL_REFUSALS = [...STILL_WAITING, ...MAY_HAVE_STARTED];

  function whole(refusal: string): string {
    const wording = activationRefusalWording(refusal);
    return `${wording.heading} ${wording.because} ${wording.changedBy}`;
  }

  it("never says nothing was created, because something was", () => {
    // THE FAILURE THIS EXISTS TO PREVENT. `submissionRefusalWording` says "Nothing was created" in
    // every branch, which is true of the first write and FALSE here. A coordinator told nothing was
    // created starts the sign-up again, and this patient gets a second plan, two schedules and two
    // sets of messages.
    for (const refusal of ALL_REFUSALS) {
      expect(whole(refusal), `${refusal} says nothing was created, and a plan was`).not.toMatch(/nothing was created/i);
      expect(whole(refusal), `${refusal} does not say the plan exists`).toMatch(/the plan was created/i);
      expect(whole(refusal), `${refusal} is reported as a general failure`).not.toMatch(/something went wrong/i);
    }
  });

  it("says the contacts are scheduled, because creating a plan schedules them", () => {
    // ROUND 2, C2. This said "no message is scheduled to go out yet", which the domain contradicts:
    // `createPlan` writes every contact in state `scheduled` at creation. That is still true and is
    // what the copy says. What is no longer true is the rest of the original note -- that
    // `listSendableContacts` filtered on contact state "with no plan-state gate in either store".
    // Since #PAMATF both stores consult the owning plan first, so a draft plan offers nothing
    // sendable. The copy is unaffected either way: its subject is what CREATING a plan does.
    // What still stops a message regardless is that nothing sends -- there is no provider, and
    // `simulation.ts` is the only reader of that list anywhere in the tree.
    for (const refusal of ALL_REFUSALS) {
      expect(whole(refusal), `${refusal} still claims nothing is scheduled`).not.toMatch(
        /no message is scheduled|nothing is scheduled/i,
      );
      expect(whole(refusal), `${refusal} does not say the contacts are scheduled`).toMatch(/contacts are scheduled/i);
      expect(whole(refusal), `${refusal} does not say why nothing reaches a handset`).toMatch(
        /no messaging provider|nothing that sends/i,
      );
    }
  });

  it("tells the clinician a retry finishes the same plan rather than making another", () => {
    for (const refusal of ALL_REFUSALS) {
      expect(whole(refusal), `${refusal} does not say a retry is not a second plan`).toMatch(
        /same plan|cannot create a second|will not create another/i,
      );
    }
  });

  it("claims the plan has not started only where that is true", () => {
    for (const refusal of STILL_WAITING) {
      expect(whole(refusal), `${refusal} does not say the plan has not started`).toMatch(/has not been started/i);
    }
    for (const refusal of MAY_HAVE_STARTED) {
      // The assertion that replaces the one that pinned the contradiction. A branch here must NOT
      // claim the plan is unstarted, and must instead say the state is unknown and point at where
      // to look -- so the defect C3 found goes red rather than green.
      expect(whole(refusal), `${refusal} claims the plan has not started, and it may have`).not.toMatch(
        /has not been started/i,
      );
      expect(whole(refusal), `${refusal} does not admit the plan's state is unknown`).toMatch(
        /may already have started|already been ended|not clear whether it started/i,
      );
      expect(whole(refusal), `${refusal} does not send the reader to look at the plan`).toMatch(
        /patient's screen|opening the plan|checking the plan/i,
      );
    }
  });

  it("names an unmapped refusal rather than hiding it", () => {
    expect(activationRefusalWording("a-refusal-nobody-has-written-yet").because).toContain(
      "a-refusal-nobody-has-written-yet",
    );
  });

  it("tells a plan that cannot be started apart from one that merely was not", () => {
    const alreadyStarted = activationRefusalWording("plan-not-draft");
    const denied = activationRefusalWording("action-not-granted");
    expect(alreadyStarted.heading).not.toBe(denied.heading);
    expect(`${alreadyStarted.because} ${alreadyStarted.changedBy}`).toMatch(
      /may already have started|already started/i,
    );
  });
});
