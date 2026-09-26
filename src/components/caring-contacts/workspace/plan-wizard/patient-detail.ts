// src/components/caring-contacts/workspace/plan-wizard/patient-detail.ts
//
// What stage 3 collects, and whether it is enough to create a plan with.
//
// WHY THIS IS NOT INSIDE THE WIZARD'S JSX. Ruling [115] requires the mobile number to be validated
// before the wizard advances; Ruling [116] requires cultural identity to be optional and to reach a
// plan as `null` rather than `""`. Both are decisions about a VALUE, and Task 9 needs the identical
// decisions when it assembles the `createPlan` call — a rule living inside a render branch is a
// rule Task 9 has to re-derive, and re-deriving is how two copies of one rule come to disagree.
// No React, no `"use client"`, no storage: this module is pure, so it can be tested directly and
// read by whatever builds the create call.
//
// THE MOBILE-NUMBER RULE IS THE INTAKE ADAPTER'S, ASKED HERE RATHER THAN RE-DERIVED.
// Ruling [115] says to look for an existing validator before writing one. One exists: referral
// intake (`SyntheticHospitalReferralAdapter`) accepts only an Australian mobile — 04xx xxx xxx or
// +61 4xx xxx xxx — and refuses landlines, short codes and anything non-numeric. The wizard used to
// accept any non-empty text while intake refused the same value, so the two screens disagreed about
// one field. `mobileNumberProblem` asks the adapter, so there is one rule and one place it moves.
// The reserved fictional list is still used only to STATE something on the screen.
//
// TRIMMING IS STRICTER THAN THE SCHEMA, DELIBERATELY. `z.string().min(1)` accepts `" "`. A plan
// whose patient name is a single space passes the API and identifies nobody, so a blank-after-trim
// entry is treated as absent here.
//
// THE PREFERRED NAME'S RULE IS THE SEALED DOMAIN'S, AND IS ASKED HERE RATHER THAN RE-DERIVED.
// Whether a name fits the message is a property of the message, so `resolvePatientVisibleMessage`
// in `@/lib/caring-contacts/message-copy` decides it and this module reports what it decided. A
// screen that re-implemented the septet arithmetic would be a second copy of a rule that moves
// whenever the provisional wording does.
import { resolvePatientVisibleMessage } from "@/lib/caring-contacts/message-copy";
import type { SendingPreference } from "@/lib/caring-contacts/model";
import { validateAustralianMobile } from "@/lib/caring-contacts/referral/synthetic-hospital-adapter";

/**
 * Stage 3's fields as the clinician has them typed so far.
 *
 * `patientIdentifiers` is held AS TYPED — one identifier per line, the clinician's own text
 * including a half-finished line — rather than as a parsed array. The draft's job is to return the
 * screen to the state it was left in; splitting on the way into storage and re-joining on the way
 * out would quietly rewrite what was typed on every refresh. `parsePatientIdentifiers` splits it at
 * the one moment it matters, which is when a plan is created.
 *
 * `culturalIdentity` IS NO LONGER COLLECTED (owner decision, 2026-08-25) and the field is kept here
 * on purpose rather than deleted. Keeping it is what lets `parseDraft` still RECOGNISE the key in a
 * draft stored before the input was removed and blank it deliberately; delete the field and a stored
 * value is merely ignored by omission, which is a silence rather than a decision. Nothing writes it,
 * `createPlanPatientDetail` sends `null` whatever it holds, and both of those are enforced by tests
 * rather than by the absence of a form control (round 2, N-1).
 */
export type PlanPatientDetailDraft = {
  patientName: string;
  /**
   * What the clinician was told to call this person in messages, AS TYPED.
   *
   * It is its own box because it is its own question. `patientName` is one free-text field and
   * splitting it produces a surname, a title, or half a given name for people who are ordinary in
   * Perth -- so nothing here parses it, and this is asked of the person actually talking to the
   * patient (owner decision, 2026-08-26).
   */
  preferredName: string;
  patientMobileNumber: string;
  /** As typed, one identifier per line. */
  patientIdentifiers: string;
  culturalIdentity: string;
};

export const EMPTY_PLAN_PATIENT_DETAIL: PlanPatientDetailDraft = Object.freeze({
  patientName: "",
  preferredName: "",
  patientMobileNumber: "",
  patientIdentifiers: "",
  culturalIdentity: "",
});

/** The fields stage 3 can refuse to proceed without. Cultural identity is deliberately not one. */
export type PersonalisationField = "patientName" | "preferredName" | "patientMobileNumber" | "sendingPreference";

export type PersonalisationIssue = {
  code:
    | "patient-name-required"
    | "preferred-name-required"
    | "preferred-name-too-long"
    | "preferred-name-not-sendable"
    | "patient-mobile-required"
    | "patient-mobile-invalid"
    | "sending-preference-required";
  field: PersonalisationField;
  /** Plain words a clinician reads, rendered beside the field itself. Never a code. */
  message: string;
};

/**
 * Everything still missing before this plan could be created, in the order the fields appear.
 *
 * Order matters because the screen reads this list twice — once per field, and once as a summary —
 * and a summary that lists what is missing in a different order from the form is a summary a
 * clinician has to re-read to use.
 */
export function personalisationIssues(input: {
  detail: PlanPatientDetailDraft;
  sendingPreference: SendingPreference | null;
}): PersonalisationIssue[] {
  const issues: PersonalisationIssue[] = [];

  if (input.detail.patientName.trim() === "") {
    issues.push({
      code: "patient-name-required",
      field: "patientName",
      message: "Enter the name this plan is for. A plan cannot be created without one.",
    });
  }

  // THE REFUSAL IS THE DOMAIN'S, REPORTED HERE, and each of its three causes gets its own words
  // because they need three different things done about them. The wording a clinician reads is
  // written here; the DECISION is `resolvePatientVisibleMessage`'s, so a wording change to the
  // provisional message moves the cap without this file being touched.
  //
  // EVERY ONE OF THE THREE SENDS THE CLINICIAN BACK TO THE PATIENT, AND THE THIRD ONE DID NOT.
  // Its first draft read "Enter the closest spelling an ordinary text message can send" -- which
  // handed the decision to the clinician at the exact moment this whole feature exists to keep it
  // with the person whose name it is. A clinician quietly stripping the diacritics from someone's
  // name is the small indignity the asked-for field was built to prevent, and a refusal that
  // instructs them to do it is worse than no refusal at all. The field's own hint says "Ask the
  // person"; so does every refusal beneath it.
  // Caring Contacts prototype boundary: provisional message copy still embeds the reserved
  // fictional staffed-line number. Opt in explicitly here — resolvePatientVisibleMessage fails
  // closed when acknowledgment is omitted (#B16HW8).
  const preferredNameResolution = resolvePatientVisibleMessage(input.detail.preferredName, {
    syntheticFictionalContactsAcknowledged: true,
  });
  if (!preferredNameResolution.ok) {
    const issue = preferredNameResolution.issue;
    issues.push({
      code:
        issue.code === "preferred-name-not-recorded"
          ? "preferred-name-required"
          : issue.code === "preferred-name-too-long"
            ? "preferred-name-too-long"
            : "preferred-name-not-sendable",
      field: "preferredName",
      message:
        issue.code === "preferred-name-not-recorded"
          ? "Enter what this person asked to be called. It is used in the messages themselves, so it is asked for rather than taken from the name above — a name typed family-name-first, or with a title, would open the message with the wrong word."
          : issue.code === "preferred-name-too-long"
            ? "This is too long to fit in the message. Messages are limited to two SMS parts, and what is entered here goes inside one. Use the shorter form the person actually goes by."
            : issue.code === "preferred-name-not-sendable"
              ? `A text message here cannot carry ${issue.unsupportedCharacters.join(" ")}, so this plan's message could not be sent as written. Ask them how they would like their name spelled in a text message, and enter that.`
              : "This name cannot be used because the resulting message violates message policy.",
    });
  }

  const mobileProblem = mobileNumberProblem(input.detail.patientMobileNumber);
  if (mobileProblem === "required") {
    issues.push({
      code: "patient-mobile-required",
      field: "patientMobileNumber",
      message: "Enter the mobile number this plan will use. A plan cannot be created without one.",
    });
  } else if (mobileProblem !== null) {
    issues.push({
      code: "patient-mobile-invalid",
      field: "patientMobileNumber",
      message: mobileProblem,
    });
  }

  if (input.sendingPreference === null) {
    issues.push({
      code: "sending-preference-required",
      field: "sendingPreference",
      message: "Choose when in the day messages go out. One choice applies to every contact in this plan.",
    });
  }

  return issues;
}

/** Every non-blank line of `text`, trimmed. An empty box is an empty list, never `[""]`. */
export function parsePatientIdentifiers(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * Exactly the object `createPlanSchema.patientDetail` accepts, or null while anything required is
 * missing.
 *
 * `patientDetail` is `.strict()` with a fixed key set, so this returns exactly that set and nothing
 * else: an extra key is refused by the API outright rather than ignored, which is the failure mode
 * that makes returning a wider object dangerous rather than merely untidy. Adding a field is a
 * SCHEMA change, travelling through the route schema, the stored detail, and both stores together.
 *
 * CULTURAL IDENTITY IS ALWAYS `null` HERE, WHATEVER IS PASSED IN — round 2, finding N-1, and it is
 * the difference between a property of code and a property of state. The field is no longer
 * collected, so before this change `null` reached the schema only because the UI could not write a
 * value. That is not a guarantee: a `sessionStorage` draft written before the input was removed
 * survives `parseDraft` in the same tab across a redeploy, and Task 9 would have submitted it into
 * `cultural_identity_reports` — while this very screen states that the plan records nothing there.
 * An interface claim that holds only while nobody happens to have stale data is a claim, not a rule.
 *
 * Two boundaries are defended, and they are NOT two copies of one rule. `parseDraft` blanks a stored
 * value so it cannot re-enter the application at all; this returns `null` so the function Task 9
 * calls cannot emit one whatever it is handed, including a detail object built by hand that never
 * went near storage. Neither subsumes the other, and today they happen to agree.
 *
 * AND `""` WOULD NOT HAVE DONE INSTEAD OF `null` (round 1, M-3).
 * `createPlanSchema.patientDetail.culturalIdentity` is `z.string().min(1).nullable()`, so `""` is
 * not a weaker way of saying "not given" — it is **REFUSED OUTRIGHT** by the API, and a plan
 * carrying one could not be created at all.
 *
 * The first version argued that `""` and `null` would be "indistinguishable" from a cleared record.
 * That was wrong on its own terms: `CLEARED_PATIENT_DETAIL.culturalIdentity` is `null`, so the two
 * are perfectly distinguishable — merely meaningless, since nothing defines what `""` would mean.
 * The behaviour was right and the argument was not, which is worth recording rather than quietly
 * rewriting: an argument nobody can check is how a correct behaviour later gets "simplified" away.
 */
export function createPlanPatientDetail(detail: PlanPatientDetailDraft): {
  patientName: string;
  patientMobileNumber: string;
  patientIdentifiers: string[];
  culturalIdentity: string | null;
  preferredName: string | null;
} | null {
  const patientName = detail.patientName.trim();
  const patientMobileNumber = detail.patientMobileNumber.trim();
  const preferredName = detail.preferredName.trim();
  // THE PREFERRED NAME IS REQUIRED HERE, and the check is the DOMAIN'S rather than a blank test.
  // A plan created through this wizard exists to send messages, the message opens with this name,
  // and there is no unpersonalised wording -- `resolvePatientVisibleMessage` refuses rather than
  // inventing one. Creating a plan whose first message could not be built defers that refusal to
  // the moment it is least useful.
  //
  // ASKING THE RESOLVER RATHER THAN REPEATING ITS THREE CONDITIONS is the same argument the
  // cultural-identity note below makes about two boundaries. `personalisationIssues` stops the
  // screen advancing; this stops a detail object built by hand -- by a caller that never went near
  // a form -- from carrying a name the message cannot be built from. Neither subsumes the other,
  // and a blank test here would let the over-long and unsendable cases through the second one.
  //
  // It is asked and never derived from `patientName`, whatever the two happen to look like. A
  // caller taking a first token off the name above would greet `Mr John Smith` as "Mr", and a person
  // whose family name is written first by their surname.
  //
  // The API takes `min(1).nullable()`, so `null` is a legitimate wire value for a caller that holds
  // no preferred name. This function never produces one: here, a missing name means no plan.
  if (patientName === "" || mobileNumberProblem(patientMobileNumber) !== null) return null;
  if (!resolvePatientVisibleMessage(preferredName, { syntheticFictionalContactsAcknowledged: true }).ok) return null;

  return {
    patientName,
    preferredName,
    patientMobileNumber,
    patientIdentifiers: parsePatientIdentifiers(detail.patientIdentifiers),
    // ALWAYS null, and never `detail.culturalIdentity`. See the note above: this is the submit
    // boundary's half of round 2's N-1, and it is unconditional so that no caller — a stored draft,
    // a hand-built object at Task 9, a future screen — can put a value into
    // `cultural_identity_reports` while this wizard tells a clinician the plan records nothing there.
    culturalIdentity: null,
  };
}

/**
 * Why `value` cannot be used as this plan's mobile number, or null when it can.
 *
 * `"required"` when nothing is entered; otherwise plain words a clinician reads. The DECISION is the
 * shared intake rule (`validateAustralianMobile`), so the wizard refuses exactly what intake and
 * the plans route refuse.
 */
export function mobileNumberProblem(value: string): "required" | string | null {
  if (value.trim() === "") return "required";
  const result = validateAustralianMobile(value);
  if (result.ok) return null;
  return /landline/i.test(result.error)
    ? "This looks like a landline. Caring contacts are sent by text message, so enter an Australian mobile number (04xx xxx xxx or +61 4xx xxx xxx)."
    : "Enter an Australian mobile number, written as 04xx xxx xxx or +61 4xx xxx xxx.";
}

/**
 * Whether `value` is one of the reserved fictional patient mobiles this prototype's own material
 * uses (`synthetic-contacts.ts`).
 *
 * IT DECIDES WHAT THE SCREEN SAYS, NEVER WHETHER A VALUE IS ACCEPTED. Acceptance is
 * `mobileNumberProblem`'s; refusing everything outside a two-item list would be a rule invented on
 * this screen and enforced nowhere else.
 *
 * Spacing is ignored on both sides. That is a comparison convenience rather than a format rule: the
 * reserved numbers are written `+61 491 570 156` and a clinician copying one may or may not carry
 * the spaces, and answering "no" to the same number written differently would make the statement
 * beside the field wrong.
 */
export function mobileIsDesignatedFictional(value: string, reserved: readonly string[]): boolean {
  const normalised = withoutSpacing(value);
  if (normalised === "") return false;
  return reserved.some((entry) => withoutSpacing(entry) === normalised);
}

function withoutSpacing(value: string): string {
  return value.replace(/\s+/g, "");
}
