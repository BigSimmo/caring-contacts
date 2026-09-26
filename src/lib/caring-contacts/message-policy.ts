// src/lib/caring-contacts/message-policy.ts
//
// Mechanism only. The content this module checks against — prohibited terms, the required
// programme/hours/emergency/crisis-support fragments, the closing statement, and the maximum
// segment count — all live in message-rules.ts and change there, wholesale, without editing
// this file. See message-rules.ts for why.
import {
  TERMINAL_DISPATCH_REFUSED_CONTACT_STATES,
  TERMINAL_PLAN_STATES,
  planSendingHold,
  type ContactState,
  type MessageType,
  type PlanSendingHold,
  type PlanState,
} from "./model";
import { PROVISIONAL_MESSAGE_RULES } from "./message-rules";

// The GSM-7 default alphabet (basic set) and its extension table, per the SMS standard. These
// character sets and the 160/153 septet thresholds are a fixed telecom specification, not
// provisional clinical content, so they live here rather than in message-rules.ts.
const GSM_7_BASIC_CHARACTERS = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
const GSM_7_EXTENSION_CHARACTERS = new Set("\f^{}\\[~]|€");
const GSM_7_SINGLE_SEGMENT_LIMIT = 160;
const GSM_7_MULTI_SEGMENT_UNIT = 153;

/**
 * The largest septet count that still fits inside `segments` GSM-7 segments.
 *
 * It exists so that a caller sizing something that goes INTO a message — today, the preferred name
 * `message-copy.ts` substitutes — can derive its own ceiling from this module's thresholds rather
 * than writing the number down. A literal is correct only for the wording in front of whoever wrote
 * it; this stays correct when the wording changes, which for a PROVISIONAL message still awaiting
 * clinical approval is not hypothetical.
 *
 * The single-segment case is NOT `153 * 1`. A message that is never split carries 160 septets,
 * because the concatenation header costing the other 7 exists only once there is more than one
 * segment. Returning `153 * segments` for every input would understate a one-segment budget — a
 * quiet answer, wrong in the safe direction, which is the kind that survives review unnoticed.
 */
export function maxSeptetsWithin(segments: number): number {
  return segments <= 1 ? GSM_7_SINGLE_SEGMENT_LIMIT : GSM_7_MULTI_SEGMENT_UNIT * segments;
}

export type Gsm7Evidence = {
  valid: boolean;
  segments: number;
  septets: number;
  invalidCharacters: string[];
};

/**
 * Counts GSM-7 septets for `text` and derives the SMS segment count. Basic-set characters cost
 * 1 septet, extension-set characters cost 2, and anything else makes the message invalid (the
 * device would substitute or drop it) — reported with `valid: false` and `segments: 0`.
 */
export function calculateGsm7(text: string): Gsm7Evidence {
  let septets = 0;
  const invalidCharacters: string[] = [];

  for (const character of text) {
    if (GSM_7_BASIC_CHARACTERS.has(character)) septets += 1;
    else if (GSM_7_EXTENSION_CHARACTERS.has(character)) septets += 2;
    else if (!invalidCharacters.includes(character)) invalidCharacters.push(character);
  }

  if (invalidCharacters.length > 0) {
    return { valid: false, septets, segments: 0, invalidCharacters };
  }
  const segments =
    septets === 0 ? 0 : septets <= GSM_7_SINGLE_SEGMENT_LIMIT ? 1 : Math.ceil(septets / GSM_7_MULTI_SEGMENT_UNIT);
  return { valid: true, septets, segments, invalidCharacters };
}

export type GovernedMessageInput = {
  /**
   * The fully substituted outgoing message, or `undefined` when no body was resolved at all.
   *
   * IT IS OPTIONAL SO THAT "NOTHING WAS AUTHORED" CAN REACH THIS FUNCTION (item A4, 2026-09-02).
   * A required `string` left a sender holding no body with only two moves: pass `""`, which is
   * refused for the WRONG reason (see `closing-message-body-not-authored` below), or skip the
   * chokepoint entirely and decide for itself -- the bypass this widening exists to close. An
   * absent body is a fact about the message, so the type says so.
   */
  text: string | undefined;
  messageType: MessageType;
  /** The recipient's own mobile number, if known, so it can be checked for leakage into the text. */
  patientMobileNumber?: string;
  /**
   * Explicit, greppable acknowledgement that a reserved fictional contact detail (see
   * message-rules.ts's `fictionalContactMarkerPattern`) in `text` is known to be synthetic.
   * Ruling 79 (item A1, 2026-08-24): defaults to false/absent, which means the message is
   * REFUSED whenever it matches that pattern. There is deliberately no way to silence the check
   * other than passing this flag at the call site.
   */
  syntheticFictionalContactsAcknowledged?: boolean;
  /**
   * Contact state, if evaluated in the context of an existing contact record.
   * Attempts to dispatch or evaluate messages for a contact that is already in a terminal state
   * trigger deterministic refusal.
   */
  contactState?: ContactState;
  /**
   * Plan state, if evaluated in the context of an existing plan.
   *
   * Messages cannot be dispatched to a plan that has ended (withdrawn, cancelled, completed), and
   * since #PAMATF nor to one that has not started or is paused. A draft and a paused plan used to
   * pass this check: it tested `TERMINAL_PLAN_STATES` only, which names the three ended states, so
   * the two halves of "this plan is not sending" were split between a list here and nothing at all.
   */
  planState?: PlanState;
};

export type MessageValidationIssue =
  | { code: "exceeds-two-segments"; septets: number; segments: number }
  | { code: "prohibited-term"; term: string }
  | { code: "fictional-contact-detail-present" }
  | { code: "first-message-missing-support-information" }
  | { code: "closing-message-missing-ending-statement" }
  | { code: "closing-message-missing-support-information" }
  /**
   * No closing body exists to check at all -- distinct from the two codes above, which mean a body
   * exists and is wrong. See `resolveClosingContactMessageBody` for why the distinction is the
   * whole point rather than a nicety.
   */
  | { code: "closing-message-body-not-authored" }
  /**
   * The same fact for a `standard` or `first` message: no body exists to send.
   *
   * Its OWN code rather than the closing one, because the closing case carries a specific meaning --
   * no closing wording has ever been clinically authored (item A4) -- that says nothing about an
   * ordinary message whose body a caller simply failed to supply.
   */
  | { code: "message-body-not-authored" }
  | { code: "contains-patient-mobile" }
  | { code: "solicits-reply" }
  | { code: "terminated-contact-dispatch-refused"; state: ContactState | PlanState }
  /**
   * The owning plan is not sending -- it has not been started, or it is paused. Its own code, not
   * `terminated-contact-dispatch-refused`: a draft plan has not ended, and reporting it as though
   * it had would name the wrong reason for the right refusal. `hold` says which.
   */
  | { code: "plan-not-dispatchable"; state: PlanState; hold: PlanSendingHold };

export type ValidationResult = { valid: true } | { valid: false; issues: MessageValidationIssue[] };

/**
 * Checks a fully substituted outgoing message against the current PROVISIONAL_MESSAGE_RULES.
 * Pure and synchronous: no network, model, or provider call, and no mutation of `input`.
 */
export function validateGovernedMessage(input: GovernedMessageInput): ValidationResult {
  const rules = PROVISIONAL_MESSAGE_RULES;
  const issues: MessageValidationIssue[] = [];

  // NO BODY, NO SEND -- FOR EVERY MESSAGE TYPE (item A4, 2026-09-02).
  //
  // It returns rather than accumulating, because a message with no body has nothing for any of the
  // TEXT checks below to read: running them anyway would report
  // `closing-message-missing-ending-statement` -- "the body you wrote is wrong" -- about a body
  // nobody wrote. That is a refusal either way; it is the DIAGNOSIS that would be false, and this
  // module's reason for separating the two codes is that a maintainer reading the first one goes
  // looking for wording to fix. There is none to fix.
  //
  // IT COVERS `standard` AND `first`, NOT ONLY `closing`. Widening `text` to `string | undefined`
  // made "nothing was authored" expressible for the first time, and a rule that answered only for
  // closing messages would have made the chokepoint say `valid: true` -- an explicit "this may be
  // sent" -- for a standard message with no body at all. That would be a NEW permission, granted by
  // the very change whose purpose is closing a bypass.
  //
  // THE STATE REFUSALS ARE STILL REPORTED. They do not read the text, so they are appended before
  // returning. Without that, a cancelled plan with no body reported only "write a body": the
  // recoverable condition masking the unrecoverable one, which is the mirror image of the false
  // diagnosis above.
  if (!messageBodyIsAuthored(input.text)) {
    issues.push({
      code: input.messageType === "closing" ? "closing-message-body-not-authored" : "message-body-not-authored",
    });
    appendStateIssues(input, issues);
    return { valid: false, issues };
  }

  const text = input.text;

  const gsm7 = calculateGsm7(text);
  if (gsm7.valid && gsm7.segments > rules.maxSegments) {
    issues.push({ code: "exceeds-two-segments", septets: gsm7.septets, segments: gsm7.segments });
  }

  const lowerText = text.toLowerCase();
  for (const term of rules.prohibitedTerms) {
    // B2: a term with a pattern override (today, only "lead") is matched by that pattern instead
    // of plain substring inclusion. Every other term's behaviour is unchanged.
    const override = rules.prohibitedTermPatternOverrides[term];
    const matched = override ? override.test(text) : lowerText.includes(term.toLowerCase());
    if (matched) {
      issues.push({ code: "prohibited-term", term });
    }
  }

  // Ruling 79 (item A1): always reported when the marker pattern matches, unless explicitly
  // acknowledged at the call site. See message-rules.ts's `fictionalContactMarkerPattern` doc
  // comment for why this is a pattern (label OR number) rather than a single string.
  if (!input.syntheticFictionalContactsAcknowledged && rules.fictionalContactMarkerPattern.test(text)) {
    issues.push({ code: "fictional-contact-detail-present" });
  }

  if (input.messageType === "first") {
    const hasFullSupportInformation =
      text.includes(rules.programmeLine) &&
      text.includes(rules.operatingHours) &&
      text.includes(rules.emergencyDirection) &&
      text.includes(rules.crisisSupportContact);
    if (!hasFullSupportInformation) {
      issues.push({ code: "first-message-missing-support-information" });
    }
  }

  if (input.messageType === "closing") {
    if (!text.includes(rules.closingStatement)) {
      issues.push({ code: "closing-message-missing-ending-statement" });
    }
    const hasSupportInformation = text.includes(rules.programmeLine) && text.includes(rules.crisisSupportContact);
    if (!hasSupportInformation) {
      issues.push({ code: "closing-message-missing-support-information" });
    }
  }

  if (input.patientMobileNumber && text.includes(input.patientMobileNumber)) {
    issues.push({ code: "contains-patient-mobile" });
  }

  if (text.includes("?")) {
    issues.push({ code: "solicits-reply" });
  }

  appendStateIssues(input, issues);

  return issues.length === 0 ? { valid: true } : { valid: false, issues };
}

/**
 * The refusals that depend on the RECORD rather than on the text -- a contact already past dispatch,
 * or a plan that has ended.
 *
 * Extracted so BOTH exits from `validateGovernedMessage` report them, including the unauthored-body
 * return above. They read no text, so there is nothing about a missing body that makes them
 * unanswerable.
 */
function appendStateIssues(input: GovernedMessageInput, issues: MessageValidationIssue[]): void {
  if (input.contactState && TERMINAL_DISPATCH_REFUSED_CONTACT_STATES.includes(input.contactState)) {
    issues.push({ code: "terminated-contact-dispatch-refused", state: input.contactState });
  }

  if (input.planState) {
    // The ended states keep their existing code, so nothing that reads it changes meaning.
    if (TERMINAL_PLAN_STATES.includes(input.planState)) {
      issues.push({ code: "terminated-contact-dispatch-refused", state: input.planState });
    } else {
      // #PAMATF: and the other two ways a plan is not sending, which previously passed. The stores
      // already refuse to OPEN a dispatch on a non-active plan (`requiresActivePlan`), so this is
      // defence in depth rather than the only gate -- but it is the gate a sender reaches with a
      // message in hand, and it was the one that said yes.
      const hold = planSendingHold(input.planState);
      if (hold !== null) {
        issues.push({ code: "plan-not-dispatchable", state: input.planState, hold });
      }
    }
  }
}

/**
 * Whether a body was authored at all. Blank-or-absent is the same answer, because a
 * whitespace-only body sends whitespace.
 *
 * Declared here so `validateGovernedMessage` above and `resolveClosingContactMessageBody` below ask
 * the question once. Two copies of "is anything actually written here" is how the chokepoint and
 * its adapter would come to disagree, which is the failure this whole change closes.
 */
function messageBodyIsAuthored(body: string | undefined): body is string {
  return body !== undefined && body.trim().length > 0;
}

export type ClosingMessageBodyIssue = { code: "closing-message-body-not-authored" };

export type ClosingMessageBodyResolution = { ok: true; body: string } | { ok: false; issue: ClosingMessageBodyIssue };

/**
 * Resolves the outgoing text for a `closing` contact (item A4, 2026-08-24).
 *
 * No closing message has ever been written -- final wording is a clinical decision the owner has
 * deferred to a lived-experience representative, not an implementation gap. A plan reaching its
 * end today has nothing to send, and the only acceptable response to that is a loud, identifiable
 * refusal: never an empty string, never a silent fall-back to some other message's text, and never
 * a silently skipped contact. This is the refusal only -- it drafts no closing-message wording of
 * its own, deliberately, because an implementer doing so would be the exact failure this exists to
 * prevent. This is distinct from `closing-message-missing-ending-statement`: that code means a body
 * exists but is wrong; this one means no body exists to check at all.
 *
 * No existing seam resolves a contact's message body anywhere in this domain today (checked
 * schedule.ts, simulation.ts, repository.ts, model.ts) -- `PlannedContact` carries a `messageType`
 * but no body content, and nothing yet supplies one. This function is a convenience for a future
 * sender that wants the body back on the success branch; it is not itself wired into the schedule
 * or the simulation driver, because doing so would require inventing where an authored closing
 * body comes from, which is exactly the decision this task defers.
 *
 * IT NO LONGER OWNS THE RULE (#59JT7W, 2026-09-02). It used to hold the refusal alone, which made
 * the guarantee conditional on a caller CHOOSING to ask -- and a sender that resolved a closing
 * body some other way met no refusal at all. Unlike the A1 fictional-contact check, which rides
 * `validateGovernedMessage`, nothing obliged anyone to come here. The rule now lives in that
 * chokepoint, which every sender must pass whatever it did to obtain a body, and this function
 * delegates to it: it reads the single `closing-message-body-not-authored` issue and maps it back
 * to the resolution shape. It deliberately ignores every OTHER issue the chokepoint may report --
 * a body that exists but is wrong is a real body, and saying whether it may be SENT is the
 * caller's own `validateGovernedMessage` call to make, not this one's.
 */
export function resolveClosingContactMessageBody(
  authoredClosingBody: string | undefined,
): ClosingMessageBodyResolution {
  const validated = validateGovernedMessage({ text: authoredClosingBody, messageType: "closing" });
  if (!validated.valid && validated.issues.some((issue) => issue.code === "closing-message-body-not-authored")) {
    return { ok: false, issue: { code: "closing-message-body-not-authored" } };
  }
  // Unreachable unless the chokepoint stops reporting the issue for an unauthored body, which the
  // contract test in tests/caring-contacts-message-policy.test.ts pins. Narrowed rather than
  // asserted non-null so the impossible case still refuses rather than returning `undefined` as a
  // body -- "never an empty string, never a silent fall-back" applies to this line too.
  if (authoredClosingBody === undefined) {
    return { ok: false, issue: { code: "closing-message-body-not-authored" } };
  }
  return { ok: true, body: authoredClosingBody };
}
