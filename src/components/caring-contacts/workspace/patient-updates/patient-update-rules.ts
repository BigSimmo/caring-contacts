import { validateAustralianMobile } from "@/lib/caring-contacts/referral/synthetic-hospital-adapter";
import type { PlanState } from "@/lib/caring-contacts/model";
import { TERMINAL_PLAN_STATES } from "@/lib/caring-contacts/model";

import { mintIdempotencyKeyLetters, planLifecycleEndpoint } from "../plan-action-rules";

/**
 * The rules behind "Record a change" and "Check the number" on the patient/plan screen.
 *
 * Pure: no React and no fetch, so every decision a coordinator meets here can be tested without a
 * render. The screens in this folder ask this module what to offer and what to send, and the plan
 * route and the service decide what actually happens -- nothing here is a second copy of a domain
 * rule. Where this module withholds a control, it is because the service would refuse it by name
 * (a terminal plan, a death correction on a plan that was not cancelled), never a rule invented here.
 */

/** Where a test text to the patient's number stands. Mirrors `PlanRecord.mobileCheck.state`. */
export type MobileCheckState = "notChecked" | "awaitingConfirmation" | "confirmed" | "notReceived";

/** The number check as this screen holds it. Instants are ISO strings: this crosses a client boundary. */
export type MobileCheckView = {
  readonly state: MobileCheckState;
  readonly sentAt: string | null;
  readonly resolvedAt: string | null;
};

export const MOBILE_CHECK_NOT_CHECKED: MobileCheckView = Object.freeze({
  state: "notChecked",
  sentAt: null,
  resolvedAt: null,
});

/** Everything the two surfaces are handed by the page. Serialisable throughout. */
export type PatientUpdatesContext = {
  readonly planId: string;
  readonly planState: PlanState;
  readonly planVersion: number;
  readonly mobileCheck: MobileCheckView;
  /** Decided by the page from the actor, exactly as the plan actions' grants are. */
  readonly granted: {
    /** `recordHospitalStatusEvent`: readmission, contact detail and the number check. */
    readonly hospitalEvents: boolean;
    /** A death and its correction: `recordHospitalStatusEvent` OR `triggerServiceSafetyStop`. */
    readonly death: boolean;
  };
};

export type PatientUpdateId =
  | "readmission"
  | "death"
  | "deathCorrection"
  | "contactName"
  | "contactMobile"
  | "mobileCheckSend"
  | "mobileCheckReceived"
  | "mobileCheckNotReceived";

const MOBILE_CHECK_STATES: readonly MobileCheckState[] = Object.freeze([
  "notChecked",
  "awaitingConfirmation",
  "confirmed",
  "notReceived",
]);

function isMobileCheckState(value: unknown): value is MobileCheckState {
  return typeof value === "string" && (MOBILE_CHECK_STATES as readonly string[]).includes(value);
}

function isoOrNull(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "string" && value !== "" && !Number.isNaN(new Date(value).getTime())) return value;
  return null;
}

/**
 * The number check a plan record carries, or null when it carries none this screen can read.
 *
 * Takes `unknown` because it reads both the page's own plan record and a record that came back over
 * the wire. A record that predates the field is not guessed at here; the caller decides (the page
 * treats it as not checked, which is what the migration defaults existing rows to).
 */
export function mobileCheckFrom(record: unknown): MobileCheckView | null {
  if (typeof record !== "object" || record === null) return null;
  const check = (record as { mobileCheck?: unknown }).mobileCheck;
  if (typeof check !== "object" || check === null) return null;
  const { state, sentAt, resolvedAt } = check as { state?: unknown; sentAt?: unknown; resolvedAt?: unknown };
  if (!isMobileCheckState(state)) return null;
  return { state, sentAt: isoOrNull(sentAt), resolvedAt: isoOrNull(resolvedAt) };
}

/** Whether the service would refuse to start or resume this plan because of the number check. */
export function mobileCheckHoldsThePlan(state: MobileCheckState): boolean {
  return state === "awaitingConfirmation" || state === "notReceived";
}

export function planHasEnded(state: PlanState): boolean {
  return TERMINAL_PLAN_STATES.includes(state);
}

/**
 * Which of the changes this screen offers, for this plan and this actor.
 *
 * Each is offered only where the service would accept it: a readmission holds a plan that has
 * started and not ended (a draft cannot be held, and the service refuses it as `plan-not-active`);
 * a death ends any plan that has not ended; a correction applies only to a cancelled plan (the
 * domain refuses anything else as `death-correction-without-cancellation`); the contact detail and
 * the number check are refused on an ended plan.
 */
export function offeredUpdates(context: Pick<PatientUpdatesContext, "granted">, state: PlanState) {
  const ended = planHasEnded(state);
  return {
    readmission: context.granted.hospitalEvents && (state === "active" || state === "paused"),
    death: context.granted.death && !ended,
    deathCorrection: context.granted.death && state === "cancelled",
    contactDetail: context.granted.hospitalEvents && !ended,
    mobileCheck: context.granted.hospitalEvents && !ended,
  };
}

// ---------------------------------------------------------------------------
// Typing a number twice
// ---------------------------------------------------------------------------

/** The number in the one standard form the intake rule produces, or null when it is not a mobile. */
export function standardMobile(value: string): string | null {
  const result = validateAustralianMobile(value);
  return result.ok ? result.value : null;
}

/**
 * What is wrong with the two typed numbers, in plain words, or null when they can be saved.
 *
 * Compared AFTER normalising, so "0412 345 678" and "+61412345678" are the same number, as they
 * are to the service. The first box is judged first: a second box cannot match a first that is
 * not a number.
 */
export function mobilePairProblem(first: string, second: string): string | null {
  if (first.trim() === "") return "Type the new mobile number.";
  const standard = standardMobile(first);
  if (standard === null) return "Enter an Australian mobile number, written as 04xx xxx xxx or +61 4xx xxx xxx.";
  if (second.trim() === "") return "Type the mobile number again, so a slip in one box is caught.";
  const again = standardMobile(second);
  if (again === null || again !== standard) {
    return "The two numbers do not match. Check both boxes against what the patient told you.";
  }
  return null;
}

/** Whether `candidate` is the number the plan already holds, after normalising both. */
export function isSameMobile(candidate: string, current: string): boolean {
  const a = standardMobile(candidate);
  const b = standardMobile(current);
  return a !== null && b !== null && a === b;
}

/**
 * How many other open plans this team holds for the same number, read from the check's answer.
 *
 * The route answers a bare `{ sharedWith }`; a `{ value: { sharedWith } }` wrapping is read too, so
 * the check does not quietly fail if it is served through the write wrapper. Null is "could not
 * tell", which the screen treats exactly as "shared": it asks for the tick rather than assuming.
 */
export function sharedWithFrom(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null) return null;
  const direct = (payload as { sharedWith?: unknown }).sharedWith;
  const wrapped = (payload as { value?: { sharedWith?: unknown } | null }).value?.sharedWith;
  const count = direct ?? wrapped;
  return typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : null;
}

// ---------------------------------------------------------------------------
// The writes
// ---------------------------------------------------------------------------

export const SHARED_MOBILE_ENDPOINT = "/api/caring-contacts/patients/shared-mobile";

export function mobileCheckEndpoint(plan: string): string {
  return `${planLifecycleEndpoint(plan)}/mobile-check`;
}

export type RecordEventBody = {
  action: "recordEvent";
  event: "readmission" | "death" | "deathCorrection";
  diedOn?: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type ContactDetailBody = {
  action: "updateContactDetail";
  patientName?: string;
  preferredName?: string | null;
  patientMobileNumber?: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type MobileCheckBody =
  | { action: "send"; expectedVersion: number; idempotencyKey: string }
  | { action: "confirm"; outcome: "received" | "notReceived"; expectedVersion: number; idempotencyKey: string };

export function recordEventBody(input: {
  event: RecordEventBody["event"];
  diedOn?: string;
  expectedVersion: number;
  idempotencyKey: string;
}): RecordEventBody {
  const diedOn = input.event === "death" ? (input.diedOn ?? "").trim() : "";
  return {
    action: "recordEvent",
    event: input.event,
    ...(diedOn === "" ? {} : { diedOn }),
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
  };
}

/**
 * The name edit: only the fields that changed, or null when nothing did.
 *
 * A blank preferred name is sent as null ("none held"), never as an empty string, which is the
 * retention clearance's own value and would read as "removed when de-identified".
 */
export function nameChangeBody(input: {
  patientName: string;
  preferredName: string;
  current: { patientName: string; preferredName: string | null };
  expectedVersion: number;
  idempotencyKey: string;
}): ContactDetailBody | null {
  const name = input.patientName.trim();
  const preferred = input.preferredName.trim() === "" ? null : input.preferredName.trim();
  const nameChanged = name !== input.current.patientName;
  const preferredChanged = preferred !== (input.current.preferredName === "" ? null : input.current.preferredName);
  if (!nameChanged && !preferredChanged) return null;
  return {
    action: "updateContactDetail",
    ...(nameChanged ? { patientName: name } : {}),
    ...(preferredChanged ? { preferredName: preferred } : {}),
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
  };
}

export function mobileChangeBody(input: {
  mobile: string;
  expectedVersion: number;
  idempotencyKey: string;
}): ContactDetailBody {
  return {
    action: "updateContactDetail",
    patientMobileNumber: standardMobile(input.mobile) ?? input.mobile.trim(),
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
  };
}

export function mobileCheckBody(input: {
  update: "mobileCheckSend" | "mobileCheckReceived" | "mobileCheckNotReceived";
  expectedVersion: number;
  idempotencyKey: string;
}): MobileCheckBody {
  if (input.update === "mobileCheckSend") {
    return { action: "send", expectedVersion: input.expectedVersion, idempotencyKey: input.idempotencyKey };
  }
  return {
    action: "confirm",
    outcome: input.update === "mobileCheckReceived" ? "received" : "notReceived",
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
  };
}

/** One key per submission; see `mintPlanActionIdempotencyKey` for why it holds no digits. */
export function mintPatientUpdateIdempotencyKey(update: PatientUpdateId): string {
  return `PLAN-${update.toUpperCase()}-${mintIdempotencyKeyLetters()}`;
}

/**
 * The plan, its state and version, and its number check, from any of these writes' answers.
 *
 * Every write here answers `{ value: { record, ... } }` -- a hospital event, a contact-detail
 * change and a number check alike. Null for anything else, never a default: a default would be a
 * guess wearing a number.
 */
export function recordFromUpdateAnswer(
  payload: unknown,
): { state: PlanState; version: number; mobileCheck: MobileCheckView | null } | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = (payload as { value?: unknown }).value;
  if (typeof value !== "object" || value === null) return null;
  const record = (value as { record?: unknown }).record;
  if (typeof record !== "object" || record === null) return null;
  const plan = (record as { plan?: unknown }).plan;
  if (typeof plan !== "object" || plan === null) return null;
  const { state, version } = plan as { state?: unknown; version?: unknown };
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return null;
  if (!isPlanStateValue(state)) return null;
  return { state, version, mobileCheck: mobileCheckFrom(record) };
}

const PLAN_STATE_VALUES: readonly PlanState[] = Object.freeze([
  "draft",
  "active",
  "paused",
  "withdrawn",
  "cancelled",
  "completed",
]);

function isPlanStateValue(value: unknown): value is PlanState {
  return typeof value === "string" && (PLAN_STATE_VALUES as readonly string[]).includes(value);
}

/** Whether a contact-detail answer says the number changed. Read, never assumed. */
export function mobileChangedFrom(payload: unknown): boolean | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = (payload as { value?: { mobileChanged?: unknown } | null }).value;
  return typeof value?.mobileChanged === "boolean" ? value.mobileChanged : null;
}

/** How many unsent messages a recorded event cancelled, when the answer says. */
export function contactsCancelledFrom(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = (payload as { value?: { contactsCancelled?: unknown } | null }).value;
  const count = value?.contactsCancelled;
  return typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : null;
}

// ---------------------------------------------------------------------------
// The calendar day a death is recorded against
// ---------------------------------------------------------------------------

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What is wrong with the date of death as typed, or null. Blank is allowed: the service then
 * records the moment of recording instead. `today` is the Perth calendar day, passed in.
 */
export function diedOnProblem(value: string, today: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!CALENDAR_DAY.test(trimmed) || Number.isNaN(new Date(`${trimmed}T00:00:00Z`).getTime())) {
    return "Enter the date as a day, month and year, or leave it blank.";
  }
  if (trimmed > today) return "The date of death cannot be later than today. Leave it blank if it is not known.";
  return null;
}

// ---------------------------------------------------------------------------
// Plain words
// ---------------------------------------------------------------------------

export const MOBILE_CHECK_STATE_WORDING: Readonly<Record<MobileCheckState, string>> = Object.freeze({
  notChecked: "Not checked",
  awaitingConfirmation: "Waiting for the patient to confirm",
  confirmed: "Confirmed",
  notReceived: "Did not arrive",
});

export const PATIENT_UPDATE_ANNOUNCEMENTS: Readonly<Record<PatientUpdateId, string>> = Object.freeze({
  readmission:
    "The readmission is recorded and this plan is paused. No message will go while it is paused. The calendar has not moved, and nothing restarts by itself: someone has to let the plan run again from Plan actions.",
  death:
    "The death is recorded. This plan has ended, every message on it that had not been sent is cancelled for good, and it can never restart.",
  deathCorrection:
    "The correction is recorded beside the original entry. This plan stays ended and no cancelled message comes back. Caring contacts for this person again need a new referral.",
  contactName: "The name is saved. Changing a name does not pause the plan.",
  contactMobile:
    "The new number is saved and this plan is paused. No message will go until someone has checked the number and lets the plan run again. The number check has been reset to not checked.",
  mobileCheckSend: "The test text has been sent. Ask the patient whether it arrived, then record their answer below.",
  mobileCheckReceived: "Recorded: the patient says the test text arrived. The number is confirmed.",
  mobileCheckNotReceived:
    "Recorded: the test text did not arrive. Check the number with the patient. The plan cannot start or run again until the number is confirmed or changed.",
});

/** The heading a result is stated under, per change. */
export const PATIENT_UPDATE_NAMES: Readonly<Record<PatientUpdateId, string>> = Object.freeze({
  readmission: "Readmitted to hospital",
  death: "Patient has died",
  deathCorrection: "Correct a recorded death",
  contactName: "Edit name or preferred name",
  contactMobile: "Change mobile number",
  mobileCheckSend: "Send a test text",
  mobileCheckReceived: "It arrived",
  mobileCheckNotReceived: "It did not arrive",
});
