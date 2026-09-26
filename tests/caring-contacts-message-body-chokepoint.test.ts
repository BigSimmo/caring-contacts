import { describe, expect, it } from "vitest";

import { prepareContactForDispatch, type PlannedContact } from "@/lib/caring-contacts/schedule";
import { validateGovernedMessage } from "@/lib/caring-contacts/message-policy";
import { PROVISIONAL_MESSAGE_RULES } from "@/lib/caring-contacts/message-rules";
import type { DispatchRecord } from "@/lib/caring-contacts/repository";

/**
 * Ledger #B16HW8. `validateGovernedMessage` in `src/lib/caring-contacts/message-policy.ts` is the
 * chokepoint that enforces the segment limit, the prohibited vocabulary, the required support
 * fragments and the fictional-contact check. It gates message CONTENT.
 *
 * `PlannedContact` carries optional `body?: ValidatedGovernedBody`. Because ValidatedGovernedBody
 * is a branded type, raw un-validated strings cannot be assigned to `PlannedContact["body"]`.
 * The only way to produce a `PlannedContact` with a body is through `prepareContactForDispatch`,
 * which routes the body through `validateGovernedMessage`.
 */

/** Exact-key assertion: fails to compile if either side gains or loses a member. */
type AssertKeys<Actual extends string, Expected extends Actual & string> = [Actual] extends [Expected]
  ? [Expected] extends [Actual]
    ? true
    : { missingFromActual: Exclude<Expected, Actual> }
  : { unexpectedOnActual: Exclude<Actual, Expected> };

type PlannedContactKeys = keyof PlannedContact;
type DispatchRecordKeys = keyof DispatchRecord;

const PLANNED_CONTACT_SHAPE_IS_GOVERNED: AssertKeys<
  PlannedContactKeys,
  "sequence" | "cadenceLabel" | "calendarDay" | "sendAt" | "messageType" | "suppressed" | "body"
> = true;

const DISPATCH_RECORD_SHAPE_IS_BODYLESS: AssertKeys<
  DispatchRecordKeys,
  | "contactId"
  | "planId"
  | "attempt"
  | "startedAt"
  | "expectedStatus"
  | "reportedStatus"
  | "discrepancyResolvedAt"
  | "discrepancyResolution"
> = true;

// Compile-time assertion: assigning an unvalidated string to PlannedContact["body"] triggers TS2322.
// @ts-expect-error TS2322: Type 'string' is not assignable to type 'ValidatedGovernedBody | undefined'.
const _unvalidatedBodyCheck: PlannedContact["body"] = "unvalidated raw text";

type IsAssignable<From, To> = [From] extends [To] ? true : false;
type RawStringAssignableToBody = IsAssignable<string, PlannedContact["body"]>;
const RAW_STRING_NOT_ASSIGNABLE_TO_BODY: RawStringAssignableToBody = false;

describe("caring contacts: message body governance chokepoint (#B16HW8)", () => {
  it("PlannedContact carries governed body field when widened", () => {
    expect(PLANNED_CONTACT_SHAPE_IS_GOVERNED).toBe(true);
    expect(RAW_STRING_NOT_ASSIGNABLE_TO_BODY).toBe(false);
  });

  it("DispatchRecord tracks an attempt but no content", () => {
    expect(DISPATCH_RECORD_SHAPE_IS_BODYLESS).toBe(true);
  });

  it("refuses assignment of unvalidated string to PlannedContact body at compile time", () => {
    // Verified by compile-time _unvalidatedBodyCheck above (@ts-expect-error TS2322).
    expect(_unvalidatedBodyCheck).toBe("unvalidated raw text");
  });
});

describe("governed dispatch chokepoint fails closed", () => {
  const baseContact: PlannedContact = {
    sequence: 2,
    cadenceLabel: "Week 1",
    calendarDay: "2026-10-08",
    sendAt: new Date("2026-10-08T10:00:00+08:00"),
    messageType: "standard",
  };

  const firstContact: PlannedContact = {
    sequence: 1,
    cadenceLabel: "Day 1",
    calendarDay: "2026-10-01",
    sendAt: new Date("2026-10-01T10:00:00+08:00"),
    messageType: "first",
  };

  const closingContact: PlannedContact = {
    sequence: 10,
    cadenceLabel: "Month 12",
    calendarDay: "2027-10-01",
    sendAt: new Date("2027-10-01T10:00:00+08:00"),
    messageType: "closing",
  };

  const rules = PROVISIONAL_MESSAGE_RULES;

  it("fails closed on prohibited terms via validateGovernedMessage and prepareContactForDispatch", () => {
    for (const term of rules.prohibitedTerms) {
      const textWithProhibited = `Hello, this message contains ${term} which is strictly prohibited.`;

      // Direct validation
      const direct = validateGovernedMessage({ text: textWithProhibited, messageType: "standard" });
      expect(direct.valid).toBe(false);
      if (!direct.valid) {
        expect(direct.issues.some((issue) => issue.code === "prohibited-term" && issue.term === term)).toBe(true);
      }

      // Via prepareContactForDispatch
      const prep = prepareContactForDispatch(baseContact, textWithProhibited);
      expect(prep.ok).toBe(false);
      if (!prep.ok) {
        expect(prep.issues.some((issue) => issue.code === "prohibited-term" && issue.term === term)).toBe(true);
      }
    }
  });

  it("fails closed when exceeding GSM-7 segment limits via validateGovernedMessage and prepareContactForDispatch", () => {
    // 320 basic-set characters = 3 segments (> maxSegments: 2, which is 306 septets)
    const longMessage = "A".repeat(320);

    const direct = validateGovernedMessage({ text: longMessage, messageType: "standard" });
    expect(direct.valid).toBe(false);
    if (!direct.valid) {
      expect(direct.issues.some((issue) => issue.code === "exceeds-two-segments")).toBe(true);
    }

    const prep = prepareContactForDispatch(baseContact, longMessage);
    expect(prep.ok).toBe(false);
    if (!prep.ok) {
      expect(prep.issues.some((issue) => issue.code === "exceeds-two-segments")).toBe(true);
    }
  });

  it("fails closed on missing support fragments for first message", () => {
    const incompleteFirstText = "Hi, this is your first caring contact. Take care!";

    const direct = validateGovernedMessage({ text: incompleteFirstText, messageType: "first" });
    expect(direct.valid).toBe(false);
    if (!direct.valid) {
      expect(direct.issues.some((issue) => issue.code === "first-message-missing-support-information")).toBe(true);
    }

    const prep = prepareContactForDispatch(firstContact, incompleteFirstText);
    expect(prep.ok).toBe(false);
    if (!prep.ok) {
      expect(prep.issues.some((issue) => issue.code === "first-message-missing-support-information")).toBe(true);
    }
  });

  it("fails closed on missing support fragments or ending statement for closing message", () => {
    const incompleteClosingText = "Hi, we are checking in one last time. Hope you are well.";

    const direct = validateGovernedMessage({ text: incompleteClosingText, messageType: "closing" });
    expect(direct.valid).toBe(false);
    if (!direct.valid) {
      expect(
        direct.issues.some(
          (issue) =>
            issue.code === "closing-message-missing-ending-statement" ||
            issue.code === "closing-message-missing-support-information",
        ),
      ).toBe(true);
    }

    const prep = prepareContactForDispatch(closingContact, incompleteClosingText);
    expect(prep.ok).toBe(false);
    if (!prep.ok) {
      expect(
        prep.issues.some(
          (issue) =>
            issue.code === "closing-message-missing-ending-statement" ||
            issue.code === "closing-message-missing-support-information",
        ),
      ).toBe(true);
    }
  });

  it("successfully prepares contact with ValidatedGovernedBody when valid", () => {
    const validStandardText = "Hi Rowan, Alex from Example Aftercare Team is thinking of you.";
    const prep = prepareContactForDispatch(baseContact, validStandardText);

    expect(prep.ok).toBe(true);
    if (prep.ok) {
      expect(prep.contact.body).toBe(validStandardText);
      expect(prep.contact.sequence).toBe(baseContact.sequence);
      expect(prep.contact.calendarDay).toBe(baseContact.calendarDay);
    }
  });

  it("successfully prepares first contact when all required support information is present", () => {
    const validFirstText = [
      rules.programmeLine,
      rules.operatingHours,
      rules.emergencyDirection,
      rules.crisisSupportContact,
    ].join(". ");

    const prep = prepareContactForDispatch(firstContact, validFirstText);
    expect(prep.ok).toBe(true);
    if (prep.ok) {
      expect(prep.contact.body).toBe(validFirstText);
    }
  });
});
