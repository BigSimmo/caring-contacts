// src/components/caring-contacts/workspace/mobile-number-check.tsx
//
// The two guards every screen that TYPES a patient's mobile number applies before it lets a
// coordinator continue: the number is typed twice and the two must agree, and the team's active
// plans are asked whether another patient already has it.
//
// WHY BOTH. A single wrong digit sends a suicide-aftercare message to a stranger, and nothing
// downstream can tell a mistyped number from a real one -- it is a valid Australian mobile either
// way. Typing it twice catches the slip of a finger; the shared-number check catches the number that
// was copied from the wrong record, which typing twice cannot, because it is typed wrongly both times.
//
// NO "use client" HERE, DELIBERATELY. The workspace keeps an explicit list of client boundaries
// (`tests/caring-contacts-explained-automation.dom.test.tsx`). This module is not one: it is only
// ever imported by the two client components that already are (the manual intake form and the plan
// wizard), so it runs on the client through them and adds no boundary of its own.
//
// THE CONFIRMATION ENTRY IS NEVER STORED. Neither caller writes it into a draft, sessionStorage or a
// request body. A stored copy would be restored alongside the first entry after a refresh, and a
// second entry that fills itself in has stopped being a second entry. The server never sees it
// either: the intake and plans routes validate the one number they receive, and this is a guard on
// the typing, not on the value.
import { AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { toAustralianMobileE164 } from "@/lib/caring-contacts/transport/phone";

/** The endpoint that counts this team's active plans holding a number. POST, so the number stays out of URLs. */
export const SHARED_MOBILE_ENDPOINT = "/api/caring-contacts/patients/shared-mobile";

export const SHARED_MOBILE_WARNING =
  "Another patient in your team's active plans has this mobile number. Check it with the patient before continuing.";

export const SHARED_MOBILE_CHECK_FAILED =
  "The check for another patient with this mobile number could not run, so this screen cannot say whether the number is already in use. Check it with the patient before continuing.";

export const MOBILE_CHECKED_TICK_LABEL = "I have checked this number is right";

/**
 * One number, compared the way the transport would send to it: `+614XXXXXXXX` when it is an
 * Australian mobile, so `0491 570 006` and `+61 491 570 006` are the same number. Anything that is
 * not a mobile falls back to its digits and plus sign, so two identical invalid entries still match
 * and the first field's own error is the one the coordinator reads.
 */
export function normalisedMobile(value: string): string {
  return toAustralianMobileE164(value) ?? value.replace(/[\s().-]/g, "");
}

/**
 * Why the second entry cannot be accepted yet, in plain words, or null when it matches the first.
 *
 * Silent while the first entry is blank: that field states its own requirement, and a second
 * sentence about a box nobody has reached yet is noise.
 */
export function mobileConfirmationProblem(first: string, second: string): string | null {
  if (first.trim() === "") return null;
  if (second.trim() === "") {
    return "Type the mobile number again. It is asked for twice so that one wrong digit is caught before any message could go to a stranger.";
  }
  if (normalisedMobile(first) !== normalisedMobile(second)) {
    return "The two mobile numbers do not match. Check the number with the patient and type it again.";
  }
  return null;
}

export type SharedMobileCheck =
  | { status: "not-asked" }
  | { status: "checking" }
  | { status: "clear" }
  | { status: "shared"; sharedWith: number }
  | { status: "failed" };

/** `{ sharedWith }` bare or wrapped in the handler's `{ value }`, or null when neither is readable. */
export function sharedWithFrom(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null) return null;
  const inner =
    "value" in payload && typeof (payload as { value: unknown }).value === "object"
      ? (payload as { value: unknown }).value
      : payload;
  if (typeof inner !== "object" || inner === null || !("sharedWith" in inner)) return null;
  const count = (inner as { sharedWith: unknown }).sharedWith;
  return typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : null;
}

/**
 * Everything a screen needs to decide whether the typed mobile may be used.
 *
 * `blocked` is the single answer a forward or submit control reads. It is true while the entries
 * disagree, while the shared-number check is still running, and -- when the check found another
 * patient or could not run -- until the coordinator has ticked that they checked the number. A
 * failed check is treated exactly like a found one: silence would read as "no other patient", which
 * this screen does not know.
 */
export type MobileNumberCheck = {
  confirmation: string;
  setConfirmation: (value: string) => void;
  confirmationProblem: string | null;
  shared: SharedMobileCheck;
  ticked: boolean;
  setTicked: (value: boolean) => void;
  needsTick: boolean;
  blocked: boolean;
  /** Plain words for a summary of what still stops the screen, or null when nothing does. */
  blockingReason: string | null;
  reset: () => void;
};

export function useMobileNumberCheck({
  mobile,
  mobileIsValid,
  excludePlanId,
}: {
  mobile: string;
  /** Whether the first entry passes the screen's own mobile rule. The check is not asked before it does. */
  mobileIsValid: boolean;
  excludePlanId?: string | null;
}): MobileNumberCheck {
  const [confirmation, setConfirmation] = useState("");
  // Both the answer and the tick are KEYED BY THE NUMBER they are about, so a changed number can
  // never inherit the tick or the all-clear given to the previous one. Deriving that at render is
  // what keeps it true without an effect that resets state after the fact.
  const [answer, setAnswer] = useState<{ number: string; check: SharedMobileCheck } | null>(null);
  const [tickedFor, setTickedFor] = useState<string | null>(null);

  const confirmationProblem = mobileConfirmationProblem(mobile, confirmation);
  const number = normalisedMobile(mobile);
  const ready = mobileIsValid && confirmationProblem === null;

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const body: { mobile: string; excludePlanId?: string } = { mobile: number };
    if (excludePlanId) body.excludePlanId = excludePlanId;
    void (async () => {
      let check: SharedMobileCheck;
      try {
        const response = await fetch(SHARED_MOBILE_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const payload: unknown = await response.json().catch(() => null);
        const sharedWith = response.ok ? sharedWithFrom(payload) : null;
        check =
          sharedWith === null
            ? { status: "failed" }
            : sharedWith > 0
              ? { status: "shared", sharedWith }
              : { status: "clear" };
      } catch {
        if (controller.signal.aborted) return;
        check = { status: "failed" };
      }
      if (!controller.signal.aborted) setAnswer({ number, check });
    })();
    return () => controller.abort();
  }, [ready, number, excludePlanId]);

  const shared: SharedMobileCheck = !ready
    ? { status: "not-asked" }
    : answer !== null && answer.number === number
      ? answer.check
      : { status: "checking" };
  const needsTick = shared.status === "shared" || shared.status === "failed";
  const ticked = needsTick && tickedFor === number;

  const blockingReason =
    confirmationProblem ??
    (shared.status === "checking"
      ? "Wait a moment while this screen checks whether another patient has this mobile number."
      : needsTick && !ticked
        ? `Tick "${MOBILE_CHECKED_TICK_LABEL}" once you have checked the number with the patient.`
        : null);

  return {
    confirmation,
    setConfirmation,
    confirmationProblem,
    shared,
    ticked,
    setTicked: (value) => setTickedFor(value ? number : null),
    needsTick,
    blocked: !mobileIsValid || blockingReason !== null,
    blockingReason: mobileIsValid ? blockingReason : null,
    reset: () => {
      setConfirmation("");
      setTickedFor(null);
      setAnswer(null);
    },
  };
}

/**
 * The second entry, its mismatch statement, and the shared-number result with its tick.
 *
 * Pasting is NOT blocked. A coordinator who pastes the same wrong number twice gains nothing from
 * this field, but one reading a number off a referral letter and pasting it has done nothing wrong,
 * and a field that fights the clipboard is a field people learn to resent and route around.
 *
 * The result region is always rendered and only its content changes, so a screen reader announces
 * the answer when it arrives rather than an inserted region that may never be spoken.
 */
export function MobileConfirmationFields({
  id,
  check,
  inputClassName,
  labelClassName,
  textClassName,
}: {
  id: string;
  check: MobileNumberCheck;
  inputClassName: string;
  labelClassName: string;
  textClassName: string;
}) {
  const problemId = `${id}-problem`;
  const resultId = `${id}-shared-result`;
  const tickId = `${id}-checked`;
  const resultText =
    check.shared.status === "checking"
      ? "Checking whether another patient in your team's active plans has this mobile number…"
      : check.shared.status === "clear"
        ? "No other patient in your team's active plans has this mobile number."
        : check.shared.status === "shared"
          ? SHARED_MOBILE_WARNING
          : check.shared.status === "failed"
            ? SHARED_MOBILE_CHECK_FAILED
            : "";

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={id} className={labelClassName}>
          Type the mobile number again
        </label>
        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          value={check.confirmation}
          onChange={(event) => check.setConfirmation(event.target.value)}
          aria-invalid={check.confirmationProblem !== null}
          aria-describedby={`${check.confirmationProblem === null ? "" : `${problemId} `}${resultId}`}
          className={inputClassName}
        />
        {check.confirmationProblem === null ? null : (
          <p id={problemId} data-testid={problemId} className={textClassName}>
            {check.confirmationProblem}
          </p>
        )}
      </div>

      <div
        id={resultId}
        data-testid={resultId}
        role="status"
        className={
          check.needsTick
            ? "flex min-w-0 items-start gap-2 rounded-[var(--radius-md)] border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] p-3 text-sm leading-6 text-[color:var(--warning-text)] forced-colors:border-[CanvasText]"
            : textClassName
        }
      >
        {check.needsTick ? <AlertCircle aria-hidden="true" className="mt-1 size-4 shrink-0" /> : null}
        {resultText === "" ? null : <span>{resultText}</span>}
      </div>

      {check.needsTick ? (
        <label htmlFor={tickId} className="flex min-h-tap min-w-0 cursor-pointer items-center gap-3">
          <input
            id={tickId}
            type="checkbox"
            checked={check.ticked}
            onChange={(event) => check.setTicked(event.target.checked)}
            aria-describedby={resultId}
            className="size-5 shrink-0 accent-[color:var(--clinical-accent)]"
          />
          <span className="min-w-0 text-sm font-semibold text-[color:var(--text-heading)]">
            {MOBILE_CHECKED_TICK_LABEL}
          </span>
        </label>
      ) : null}
    </div>
  );
}
