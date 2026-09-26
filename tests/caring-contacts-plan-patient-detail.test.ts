// tests/caring-contacts-plan-patient-detail.test.ts
//
// Stage 3's rules, tested where they live: `plan-wizard/patient-detail.ts` (Phase 2B Task 8).
//
// WHY THIS IS A SEPARATE MODULE FROM THE SCREEN, AND WHY IT IS TESTED SEPARATELY. Ruling [115]
// requires the mobile number to be validated before the wizard advances, and Ruling [116] requires
// cultural identity to be genuinely optional and to reach a plan as `null` rather than `""`. Those
// are decisions about a value, not about a rendering, and Task 9 needs exactly the same decisions
// when it builds the create call. A rule that exists only inside a JSX branch is a rule Task 9 has
// to re-derive, and re-deriving is how two copies come to disagree.
//
// THE MOBILE-NUMBER RULE IS INTAKE'S. Referral intake accepts only an Australian mobile, and the
// wizard now asks the same adapter rather than accepting any text, so the two screens can no longer
// disagree about one field. The reserved fictional set (`synthetic-contacts.ts`) is still used only
// to STATE something, never to refuse.
import { describe, expect, it } from "vitest";

import {
  EMPTY_PLAN_PATIENT_DETAIL,
  createPlanPatientDetail,
  mobileIsDesignatedFictional,
  mobileNumberProblem,
  parsePatientIdentifiers,
  personalisationIssues,
} from "@/components/caring-contacts/workspace/plan-wizard/patient-detail";
import { PREFERRED_NAME_MAX_SEPTETS, resolvePatientVisibleMessage } from "@/lib/caring-contacts/message-copy";
import {
  DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS,
  FICTIONAL_CONTACTS_BY_ROLE,
} from "@/lib/caring-contacts/synthetic-contacts";

const COMPLETE = {
  patientName: "Rowan Example",
  preferredName: "Rowan",
  patientMobileNumber: DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS[1],
  patientIdentifiers: "",
  culturalIdentity: "",
};

describe("stage 3's required values (Rulings [114] and [115])", () => {
  it("refuses a plan with no patient name and no mobile number, naming each in words", () => {
    const issues = personalisationIssues({
      detail: EMPTY_PLAN_PATIENT_DETAIL,
      sendingPreference: null,
    });

    expect(issues.map((issue) => issue.field)).toEqual([
      "patientName",
      "preferredName",
      "patientMobileNumber",
      "sendingPreference",
    ]);
    for (const issue of issues) {
      // Plain words, in place. A code is for the screen to key on; the message is what a clinician
      // reads, so an empty or code-shaped message would be a defect the field list cannot catch.
      expect(issue.message.length, `${issue.field} has no plain-words message`).toBeGreaterThan(20);
      expect(issue.message).not.toContain(issue.code);
    }
  });

  it("treats whitespace as absent, which the schema alone would not", () => {
    // `z.string().min(1)` accepts " ". The screen trimming is therefore STRICTER than the API, and
    // deliberately so: a plan whose patient name is a space is a plan nobody can identify.
    const issues = personalisationIssues({
      detail: { ...COMPLETE, patientName: "   ", patientMobileNumber: "\t\n " },
      sendingPreference: "morning",
    });
    expect(issues.map((issue) => issue.field)).toEqual(["patientName", "patientMobileNumber"]);
  });

  it("is satisfied by the names, a number and a sending preference, and asks for nothing else", () => {
    expect(personalisationIssues({ detail: COMPLETE, sendingPreference: "earlyEvening" })).toEqual([]);
  });
});

describe("cultural identity is not collected, and null is a property of code (N-1)", () => {
  it("raises no issue when it is absent, because it is never asked for", () => {
    const issues = personalisationIssues({
      detail: { ...COMPLETE, culturalIdentity: "" },
      sendingPreference: "morning",
    });
    expect(issues).toEqual([]);
  });

  it("sends null even when handed a value, so the screen's claim cannot be falsified by state", () => {
    // ROUND 2, N-1. This used to pass a non-empty value straight through, which meant `null` reached
    // the schema only because the UI could no longer write one — a property of STATE, not of code.
    // A `sessionStorage` draft written before the field was removed, or any caller that builds a
    // detail object by hand, could still have carried a value into `cultural_identity_reports`
    // while the screen said "the plan records nothing here".
    //
    // `""` still maps to null too: `z.string().min(1).nullable()` REFUSES the empty string, so a
    // plan carrying one could not be created at all.
    expect(createPlanPatientDetail({ ...COMPLETE, culturalIdentity: "   " })?.culturalIdentity).toBeNull();
    expect(
      createPlanPatientDetail({ ...COMPLETE, culturalIdentity: "Noongar" })?.culturalIdentity,
      "a supplied cultural identity was passed through to the plan",
    ).toBeNull();
  });
});

describe("the shape `createPlanSchema.patientDetail` requires", () => {
  it("answers null while anything required is missing, so a caller cannot post half a patient", () => {
    expect(createPlanPatientDetail({ ...COMPLETE, patientMobileNumber: " " })).toBeNull();
    expect(createPlanPatientDetail({ ...COMPLETE, patientName: "" })).toBeNull();
    expect(createPlanPatientDetail({ ...COMPLETE, preferredName: "  " })).toBeNull();
  });

  it("trims the required fields and carries exactly the keys the schema names", () => {
    const detail = createPlanPatientDetail({
      patientName: "  Rowan Example  ",
      preferredName: "  Rowan  ",
      patientMobileNumber: `  ${DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS[0]}  `,
      patientIdentifiers: "SYN-MRN-4471",
      culturalIdentity: "",
    });

    // `createPlanSchema.patientDetail` is `.strict()` with exactly this key set, so one more added
    // here would be refused by the API rather than ignored.
    expect(Object.keys(detail ?? {}).sort()).toEqual([
      "culturalIdentity",
      "patientIdentifiers",
      "patientMobileNumber",
      "patientName",
      "preferredName",
    ]);
    expect(detail?.preferredName).toBe("Rowan");
    expect(detail?.patientName).toBe("Rowan Example");
    expect(detail?.patientMobileNumber).toBe(DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS[0]);
    expect(detail?.patientIdentifiers).toEqual(["SYN-MRN-4471"]);
  });
});

describe("the name the message opens with is ASKED FOR, never split off the stored one", () => {
  // Owner decision, 2026-08-26, and the half most likely to be "simplified" away later. Splitting
  // one free-text name fails on a person with one name, a person whose family name is written
  // first, a typed title, multiple given names, and hyphenated names -- all ordinary in Perth. A
  // suicide-prevention message that opens with a surname, or with "Mr", is worse than one that uses
  // no name at all.
  const TITLED = "Mr John Smith";

  it("never derives a greeting from the stored patient name", () => {
    // The load-bearing path: what a plan would actually be created with. `preferredName` is what
    // the clinician typed, and no part of `patientName` reaches it.
    const detail = createPlanPatientDetail({ ...COMPLETE, patientName: TITLED, preferredName: "Jo" });
    expect(detail?.preferredName).toBe("Jo");
    expect(detail?.patientName).toBe(TITLED);

    const message = resolvePatientVisibleMessage(detail?.preferredName ?? null, {
      syntheticFictionalContactsAcknowledged: true as const,
    });
    expect(message).toMatchObject({ ok: true });
    if (message.ok) {
      // Positive control FIRST: the name the clinician typed really is in the message, so the two
      // absences below are a split not happening rather than the message holding no name at all.
      expect(message.text).toContain("Hi Jo,");
      expect(message.text).not.toContain("Mr");
      expect(message.text).not.toContain("Smith");
    }
  });

  it("creates no plan at all rather than falling back to the stored name", () => {
    // The failure this guards against is not a wrong greeting but a CONVENIENT one: a later editor
    // "helpfully" defaulting the empty preferred name to the first word of `patientName` would
    // greet this patient as "Mr".
    expect(createPlanPatientDetail({ ...COMPLETE, patientName: TITLED, preferredName: "" })).toBeNull();
    expect(resolvePatientVisibleMessage(null, { syntheticFictionalContactsAcknowledged: true })).toEqual({
      ok: false,
      issue: { code: "preferred-name-not-recorded" },
    });
  });
});

describe("stage 3 reports the message's own length rule rather than re-deriving it", () => {
  const at = (length: number) => "x".repeat(length);

  const fieldsFor = (preferredName: string) =>
    personalisationIssues({ detail: { ...COMPLETE, preferredName }, sendingPreference: "morning" });

  it("accepts the longest name the message can carry and refuses the next character", () => {
    // Both ends. The cap is `PREFERRED_NAME_MAX_SEPTETS`, which message-copy.ts COMPUTES from the
    // GSM-7 constants and the message's own length -- so this test moves with the provisional
    // wording instead of pinning a number that a wording change would silently falsify.
    expect(fieldsFor(at(PREFERRED_NAME_MAX_SEPTETS))).toEqual([]);

    const refused = fieldsFor(at(PREFERRED_NAME_MAX_SEPTETS + 1));
    expect(refused.map((issue) => issue.code)).toEqual(["preferred-name-too-long"]);
    expect(refused[0].field).toBe("preferredName");
    // Plain words a clinician reads, never the code, and never the septet arithmetic.
    expect(refused[0].message).not.toContain("septet");
    expect(refused[0].message).not.toContain(refused[0].code);
  });

  it("refuses a name a text message cannot carry, names the characters, and asks the person", () => {
    const refused = fieldsFor("Zoë");
    expect(refused.map((issue) => issue.code)).toEqual(["preferred-name-not-sendable"]);
    expect(refused[0].message).toContain("ë");

    // WHO DECIDES, and this assertion is the one with clinical weight rather than technical weight.
    // The first draft of this message said "Enter the closest spelling an ordinary text message can
    // send", which instructs the clinician to strip the diacritics from someone's name themselves --
    // the exact small indignity an ASKED-FOR preferred name exists to prevent. Every refusal on this
    // field sends them back to the person whose name it is.
    expect(refused[0].message, "the refusal decides the spelling instead of asking the person").toMatch(
      /ask them how they would like their name spelled/i,
    );
    expect(refused[0].message.toLowerCase()).not.toContain("closest spelling");

    // Positive control on the alphabet: an accented name GSM-7 does carry raises nothing, so this
    // is the transport limit rather than a blanket refusal of anything unfamiliar.
    expect(fieldsFor("José")).toEqual([]);
  });
});

describe("identifiers, one per line", () => {
  it('drops blank lines and trims each, so an empty box is an empty array rather than [""]', () => {
    // `patientIdentifiers` is `z.array(z.string().min(1))`, so a single empty string would be
    // REFUSED by the API — an empty box has to produce an empty array, not one blank entry.
    expect(parsePatientIdentifiers("")).toEqual([]);
    expect(parsePatientIdentifiers("\n  \n\t\n")).toEqual([]);
    expect(parsePatientIdentifiers("  SYN-MRN-4471  \n\nSYN-URN-90210\n")).toEqual(["SYN-MRN-4471", "SYN-URN-90210"]);
  });
});

describe("the one authority this domain holds about numbers that cannot connect", () => {
  it("recognises a reserved fictional patient mobile, however it is spaced", () => {
    // Ignoring spacing is a comparison convenience, not a format rule: it decides what the screen
    // SAYS about a number, never whether the number is accepted.
    for (const reserved of DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS) {
      expect(mobileIsDesignatedFictional(reserved, DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS)).toBe(true);
      expect(
        mobileIsDesignatedFictional(reserved.replace(/\s+/g, ""), DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS),
        "the same reserved number written without spaces was not recognised",
      ).toBe(true);
    }
  });

  it("does not recognise anything else, including a near miss", () => {
    const [first] = DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS;
    expect(mobileIsDesignatedFictional(`${first}1`, DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS)).toBe(false);
    expect(mobileIsDesignatedFictional("+61 400 000 000", DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS)).toBe(false);
    expect(mobileIsDesignatedFictional("", DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS)).toBe(false);
  });

  it("names only the two reserved PATIENT mobiles, not the staffed line or the crisis contact", () => {
    // Offering the crisis-support number as a patient's own mobile would put a support line into a
    // recipient field, which is the one confusion this list must not create.
    //
    // ROUND 1, M-2. The first version asserted `toHaveLength(2)` under this exact name, so swapping
    // the crisis-support number in for a patient mobile passed it -- the assertion counted the list
    // rather than checking what is in it, which is the tautology this task's own finding 3
    // documented and then reproduced. Both halves are now named against the frozen record.
    expect([...DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS]).toEqual([
      FICTIONAL_CONTACTS_BY_ROLE.miraPatientMobile,
      FICTIONAL_CONTACTS_BY_ROLE.rowanPatientMobile,
    ]);
    // NOT redundant with the assertion above, although it looks it — round 3, and I had it written
    // down as a check that cannot fail before the mutation said otherwise. R3-M25 sets
    // `rowanPatientMobile` to the crisis-support number: the equality above still PASSES, because
    // both sides read the same record, and this loop is what fails. It catches exactly the confusion
    // the case is named for — a number a patient CALLS offered as one they receive on. Do not delete
    // it on the reasoning that the equality covers it.
    for (const serviceLine of [
      FICTIONAL_CONTACTS_BY_ROLE.programmeStaffedLine,
      FICTIONAL_CONTACTS_BY_ROLE.crisisSupportContact,
    ]) {
      expect(
        [...DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS],
        "a number a patient CALLS is offered as a number a patient receives on",
      ).not.toContain(serviceLine);
    }
  });
});

describe("the mobile number follows intake's rule", () => {
  it("refuses what intake refuses: a short number and a landline", () => {
    expect(mobileNumberProblem("123")).toMatch(/Australian mobile number/);
    expect(mobileNumberProblem("0892223333")).toMatch(/landline/);
    expect(mobileNumberProblem("  ")).toBe("required");
    const issues = personalisationIssues({
      detail: { ...COMPLETE, patientMobileNumber: "123" },
      sendingPreference: "morning",
    });
    expect(issues.map((issue) => issue.code)).toEqual(["patient-mobile-invalid"]);
    expect(createPlanPatientDetail({ ...COMPLETE, patientMobileNumber: "0892223333" })).toBeNull();
  });

  it("accepts what intake accepts, including both reserved fictional numbers however spaced", () => {
    for (const reserved of DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS) {
      expect(mobileNumberProblem(reserved)).toBeNull();
      expect(mobileNumberProblem(reserved.replace(/\s+/g, ""))).toBeNull();
    }
    expect(mobileNumberProblem("0412 345 678")).toBeNull();
  });
});
