"use client";

import { ignoreUnavailableActivation, cn } from "@/components/ui-primitives";

import { awstDateTimeWording } from "../date-wording";
import {
  mobileCheckBody,
  mobileCheckEndpoint,
  mobileCheckHoldsThePlan,
  MOBILE_CHECK_STATE_WORDING,
  offeredUpdates,
  PATIENT_UPDATE_ANNOUNCEMENTS,
  type MobileCheckView,
  type PatientUpdatesContext,
} from "./patient-update-rules";
import { buttonClass, mutedTextClass, UpdateStatus } from "./update-parts";
import { usePlanUpdate } from "./use-plan-update";

export type MobileCheckPanelProps = {
  context: PatientUpdatesContext;
};

/**
 * "Check the number": a one-off test text to the number this plan holds, and the patient's answer.
 *
 * Optional, and said to be: a plan whose number was never checked still starts. What the check
 * changes is that once a test text is sent, the service will not start or resume the plan until the
 * patient has said it arrived -- a number in doubt is worse than a number never tested. That rule is
 * the service's (`mobile-check-unconfirmed`); this panel explains it where it applies.
 */
export function MobileCheckPanel({ context }: MobileCheckPanelProps) {
  const { plan, pending, outcome, setOutcome, send } = usePlanUpdate({
    state: context.planState,
    version: context.planVersion,
    mobileCheck: context.mobileCheck,
  });
  const state = plan?.state ?? context.planState;
  if (!offeredUpdates(context, state).mobileCheck) return null;

  const check = plan?.mobileCheck ?? context.mobileCheck;
  const busy = pending !== null;
  const endpoint = mobileCheckEndpoint(context.planId);
  const act = (update: "mobileCheckSend" | "mobileCheckReceived" | "mobileCheckNotReceived") => {
    setOutcome(null);
    void send(
      update,
      endpoint,
      (expectedVersion, idempotencyKey) => mobileCheckBody({ update, expectedVersion, idempotencyKey }),
      () => PATIENT_UPDATE_ANNOUNCEMENTS[update],
    );
  };

  return (
    <section aria-labelledby="caring-contacts-mobile-check-heading" data-testid="caring-contacts-mobile-check">
      <h2
        id="caring-contacts-mobile-check-heading"
        className="text-base font-semibold text-[color:var(--text-heading)]"
      >
        Check the number
      </h2>
      <p className={cn(mutedTextClass, "mt-2")}>
        Send one test text to the number on this plan, then ask the patient whether it arrived. The text says who it is
        from and asks them to tell the staff member with them. It is optional, but once a test text is sent the plan
        cannot start or run again until the patient says it arrived.
      </p>

      <p className="mt-3 text-sm leading-6 text-[color:var(--text)]" data-testid="caring-contacts-mobile-check-state">
        <span className="font-semibold text-[color:var(--text-heading)]">Number check: </span>
        {MOBILE_CHECK_STATE_WORDING[check.state]}
      </p>
      <p className={mutedTextClass}>{checkStateSentence(check)}</p>

      <div className="mt-3">
        <UpdateStatus pending={pending} outcome={outcome} testId="caring-contacts-mobile-check-outcome" />
      </div>

      <div className="mt-3 flex min-h-tap min-w-0 flex-wrap items-center gap-3">
        {check.state === "awaitingConfirmation" ? (
          <>
            <button
              type="button"
              data-testid="caring-contacts-mobile-check-received"
              aria-disabled={busy ? "true" : undefined}
              onClick={busy ? ignoreUnavailableActivation : () => act("mobileCheckReceived")}
              className={buttonClass}
            >
              It arrived
            </button>
            <button
              type="button"
              data-testid="caring-contacts-mobile-check-not-received"
              aria-disabled={busy ? "true" : undefined}
              onClick={busy ? ignoreUnavailableActivation : () => act("mobileCheckNotReceived")}
              className={buttonClass}
            >
              It did not arrive
            </button>
          </>
        ) : null}
        <button
          type="button"
          data-testid="caring-contacts-mobile-check-send"
          aria-disabled={busy ? "true" : undefined}
          onClick={busy ? ignoreUnavailableActivation : () => act("mobileCheckSend")}
          className={buttonClass}
        >
          {check.state === "notChecked" ? "Send a test text" : "Send another test text"}
        </button>
      </div>
    </section>
  );
}

function checkStateSentence(check: MobileCheckView): string {
  const sent = check.sentAt === null ? null : awstDateTimeWording(check.sentAt);
  const resolved = check.resolvedAt === null ? null : awstDateTimeWording(check.resolvedAt);
  const holds = mobileCheckHoldsThePlan(check.state)
    ? " Until the patient says it arrived, the plan cannot start or run again."
    : "";
  switch (check.state) {
    case "notChecked":
      return "No test text has been sent to the number this plan holds. The plan can still start without one.";
    case "awaitingConfirmation":
      return `A test text was sent${sent === null ? "" : ` at ${sent}`}. Ask the patient whether it arrived, then press It arrived or It did not arrive.${holds}`;
    case "confirmed":
      return `The patient said the test text arrived${resolved === null ? "" : ` (recorded at ${resolved})`}. The number is confirmed.`;
    case "notReceived":
      return `The patient said the test text did not arrive${resolved === null ? "" : ` (recorded at ${resolved})`}. Check the number with them, change it under Record a change if it is wrong, or send another test text.${holds}`;
  }
}
