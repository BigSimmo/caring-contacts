// src/lib/caring-contacts/mobile-check.ts
//
// Checking a patient's mobile number with a one-off test text, and editing the contact detail a
// plan sends to.
//
// Why this exists. A mistyped mobile number sends a year of caring contacts to a stranger, and the
// patient hears nothing. Two guards meet that hazard here:
//   * a test text the staff member sends while the patient is with them, recorded as awaiting
//     confirmation until the staff member says whether it arrived. While a sent test is unanswered,
//     or the patient said it did not arrive, the plan may not start or restart -- the refusal is
//     `mobile-check-unconfirmed`. The test is optional: a plan whose number was never checked may
//     still start, because the check is a help, not a gate every plan must pass;
//   * the rule for an edit to the name, preferred name or mobile number, written once here so both
//     stores apply the same one.
//
// The check state holds NO patient content: a closed state and two instants. It is therefore safe on
// the plan record a list read returns, and clearing the patient detail leaves it alone.
//
// Pure and deterministic: nothing here reads a clock or a store. Callers pass the instant.
import { applyHospitalStatusEvent, type PlanException } from "./hospital-events";
import { resolvePatientVisibleMessage } from "./message-copy";
import { TERMINAL_PLAN_STATES, type Plan, type TransitionResult } from "./model";
import { validateAustralianMobile } from "./referral/synthetic-hospital-adapter";
import { toAustralianMobileE164 } from "./transport/phone";

/**
 * The fixed text of the test message. Staff-facing in purpose, patient-facing in delivery: it carries
 * no clinical content, names no service the patient might not want named to a stranger holding the
 * phone, and asks for nothing by reply.
 */
export const MOBILE_CHECK_MESSAGE =
  "Hello, this is a one-off test message from the hospital's follow-up team, to check we have your number right. Please tell the staff member with you that it arrived. There is no need to reply.";

export const MOBILE_CHECK_STATES = Object.freeze([
  "notChecked",
  "awaitingConfirmation",
  "confirmed",
  "notReceived",
] as const);
export type MobileCheckState = (typeof MOBILE_CHECK_STATES)[number];

/** Instants are ISO strings (`toISOString()`), so the value is the same in memory, in JSON and in a replay. */
export type MobileCheck = { state: MobileCheckState; sentAt: string | null; resolvedAt: string | null };

/** What a plan created before this check existed, or whose number just changed, holds. */
export const MOBILE_NOT_CHECKED: MobileCheck = Object.freeze({ state: "notChecked", sentAt: null, resolvedAt: null });

export const MOBILE_CHECK_REFUSALS = Object.freeze({
  /** A test text is unanswered, or the patient said it did not arrive: the plan may not start. */
  unconfirmed: "mobile-check-unconfirmed",
  /** "It arrived" / "It did not arrive" with no test text waiting for an answer. */
  notAwaiting: "mobile-check-not-awaiting",
  /** The test text could not be handed to the carrier; nothing was recorded. */
  sendFailed: "mobile-check-send-failed",
  /** A contact-detail edit that changes nothing. */
  contactDetailUnchanged: "contact-detail-unchanged",
  patientMobileInvalid: "patient-mobile-invalid",
  patientNameBlank: "patient-name-blank",
  /** A preferred name that is blank or cannot be carried in a text message. */
  patientPreferredNameInvalid: "patient-preferred-name-invalid",
} as const);

export function isMobileCheckState(value: unknown): value is MobileCheckState {
  return typeof value === "string" && (MOBILE_CHECK_STATES as readonly string[]).includes(value);
}

/** A test text has been sent. Allowed from every state: a re-send replaces the earlier attempt. */
export function recordMobileCheckSent(_current: MobileCheck, at: Date): MobileCheck {
  return { state: "awaitingConfirmation", sentAt: at.toISOString(), resolvedAt: null };
}

/** The staff member's answer to "did it arrive?". Refused when no test text is waiting. */
export function resolveMobileCheck(
  current: MobileCheck,
  outcome: "received" | "notReceived",
  at: Date,
): TransitionResult<MobileCheck> {
  if (current.state !== "awaitingConfirmation") return { ok: false, reason: MOBILE_CHECK_REFUSALS.notAwaiting };
  return {
    ok: true,
    value: {
      state: outcome === "received" ? "confirmed" : "notReceived",
      sentAt: current.sentAt,
      resolvedAt: at.toISOString(),
    },
  };
}

/**
 * Whether a plan may start (activate) or restart (resume) given its number check. "notChecked" and
 * "confirmed" proceed; an unanswered test, or one that did not arrive, is refused by name.
 */
export function admitPlanStart(check: MobileCheck): TransitionResult<null> {
  if (check.state === "awaitingConfirmation" || check.state === "notReceived") {
    return { ok: false, reason: MOBILE_CHECK_REFUSALS.unconfirmed };
  }
  return { ok: true, value: null };
}

/** Whether two typed numbers are the same Australian mobile, ignoring spacing and +61/0 form. */
export function sameAustralianMobile(a: string, b: string): boolean {
  const left = toAustralianMobileE164(a);
  return left !== null && left === toAustralianMobileE164(b);
}

export type ContactDetailField = "name" | "preferredName" | "mobile";

/** The three stored fields an edit can reach. */
export type ContactDetail = { patientName: string; preferredName: string | null; patientMobileNumber: string };

/** An edit names only the fields it changes; an absent field is left as it is. */
export type ContactDetailEdit = {
  patientName?: string;
  preferredName?: string | null;
  patientMobileNumber?: string;
};

export type AdmittedContactDetailEdit = {
  next: ContactDetail;
  /** In a fixed order, so the audit action reads the same for the same edit. */
  changed: readonly ContactDetailField[];
};

/**
 * Validates an edit against what is stored, using the same rules plan creation uses:
 *   * a name must not be blank (trimmed);
 *   * a preferred name is `null` (none held) or one the governed message can carry
 *     (`resolvePatientVisibleMessage`);
 *   * a mobile must pass `validateAustralianMobile` and is stored in its standard spaced form. A
 *     number that is the same mobile written differently is NOT a change -- it would otherwise pause
 *     a plan for a formatting difference.
 * An edit that changes nothing is refused by name, so a no-op never bumps a version or pauses a plan.
 */
export function admitContactDetailEdit(
  current: ContactDetail,
  edit: ContactDetailEdit,
): TransitionResult<AdmittedContactDetailEdit> {
  const next: ContactDetail = { ...current };
  const changed: ContactDetailField[] = [];

  if (edit.patientName !== undefined) {
    const name = edit.patientName.trim();
    if (name === "") return { ok: false, reason: MOBILE_CHECK_REFUSALS.patientNameBlank };
    if (name !== current.patientName) {
      next.patientName = name;
      changed.push("name");
    }
  }

  if (edit.preferredName !== undefined) {
    const preferred = edit.preferredName === null ? null : edit.preferredName.trim();
    if (preferred !== null) {
      if (preferred === "") return { ok: false, reason: MOBILE_CHECK_REFUSALS.patientPreferredNameInvalid };
      const sendable = resolvePatientVisibleMessage(preferred, { syntheticFictionalContactsAcknowledged: true });
      if (!sendable.ok) return { ok: false, reason: MOBILE_CHECK_REFUSALS.patientPreferredNameInvalid };
    }
    if (preferred !== current.preferredName) {
      next.preferredName = preferred;
      changed.push("preferredName");
    }
  }

  if (edit.patientMobileNumber !== undefined) {
    const validated = validateAustralianMobile(edit.patientMobileNumber);
    if (!validated.ok) return { ok: false, reason: MOBILE_CHECK_REFUSALS.patientMobileInvalid };
    if (!sameAustralianMobile(validated.value, current.patientMobileNumber)) {
      next.patientMobileNumber = validated.value;
      changed.push("mobile");
    }
  }

  if (changed.length === 0) return { ok: false, reason: MOBILE_CHECK_REFUSALS.contactDetailUnchanged };
  return { ok: true, value: { next, changed } };
}

/**
 * The plan a write about the number check or the contact detail leaves behind, shared by both stores.
 *
 * Every such write moves the plan's version on by exactly one, so a second screen holding the old
 * version is refused as stale rather than overwriting the edit. An ended plan is refused with the
 * domain's own `plan-terminal`.
 *
 * `mobileChanged` on a started plan composes the existing `mobileChanged` hospital event -- it pauses
 * an active plan, keeps a paused one paused, and raises `contactChanged` -- rather than restating the
 * pause here. A draft has not started, so nothing can be paused and nothing has been sent: its number
 * simply changes.
 */
export function planAfterDetailWrite(
  plan: Plan,
  mobileChanged: boolean,
): TransitionResult<{ plan: Plan; exceptions: readonly PlanException[] }> {
  if (TERMINAL_PLAN_STATES.includes(plan.state)) return { ok: false, reason: "plan-terminal" };
  let next = plan;
  let exceptions: readonly PlanException[] = [];
  if (mobileChanged && plan.state !== "draft") {
    const applied = applyHospitalStatusEvent(plan, { type: "mobileChanged" });
    if (!applied.ok) return applied;
    next = applied.value.plan;
    exceptions = applied.value.exceptions;
  }
  if (next.version === plan.version) next = { ...next, version: plan.version + 1 };
  return { ok: true, value: { plan: next, exceptions } };
}

/** The audit action for an accepted contact-detail edit: which fields, never their values. */
export function contactDetailAuditAction(changed: readonly ContactDetailField[]): string {
  return `updatePatientContactDetail:${changed.join(",")}`;
}
