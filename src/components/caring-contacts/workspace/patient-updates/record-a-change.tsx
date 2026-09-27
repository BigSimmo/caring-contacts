"use client";

import { useEffect, useId, useRef, useState } from "react";

import { cn, ignoreUnavailableActivation } from "@/components/ui-primitives";
import { awstCalendarDay } from "@/lib/caring-contacts/clock";

import { MOBILE_CHECKED_TICK_LABEL } from "../mobile-number-check";
import { planLifecycleEndpoint, planActionRefusalWording } from "../plan-action-rules";
import {
  contactsCancelledFrom,
  diedOnProblem,
  isSameMobile,
  mobileChangeBody,
  mobilePairProblem,
  nameChangeBody,
  offeredUpdates,
  PATIENT_UPDATE_ANNOUNCEMENTS,
  recordEventBody,
  sharedWithFrom,
  SHARED_MOBILE_ENDPOINT,
  standardMobile,
  type PatientUpdatesContext,
} from "./patient-update-rules";
import {
  blockClass,
  buttonClass,
  dangerButtonClass,
  dangerOutlineButtonClass,
  errorTextClass,
  fieldClass,
  labelClass,
  mutedTextClass,
  TickRow,
  UpdateBlock,
  UpdateStatus,
} from "./update-parts";
import { post, usePlanUpdate } from "./use-plan-update";

/** The patient detail this surface edits, from the episode read. Null when the role cannot read it. */
export type PatientUpdateDetail = {
  readonly patientName: string;
  readonly preferredName: string | null;
  readonly patientMobileNumber: string;
};

export type RecordAChangeProps = {
  context: PatientUpdatesContext;
  detail: PatientUpdateDetail | null;
};

/**
 * "Record a change": the things that happen to a patient after discharge that change what this
 * plan should do. Suicide-prevention aftercare, so every control says in plain words what it does to
 * the messages before it is pressed, and the one that cannot be undone asks twice.
 *
 * No overlay here. The frozen overlay matrix has no row for these, and a row cannot be added from
 * a screen: each change is confirmed in place, the way cancelling a draft plan already is.
 */
export function RecordAChange({ context, detail }: RecordAChangeProps) {
  const { plan, pending, outcome, setOutcome, send } = usePlanUpdate({
    state: context.planState,
    version: context.planVersion,
    mobileCheck: context.mobileCheck,
  });
  const state = plan?.state ?? context.planState;
  const offered = offeredUpdates(context, state);
  const busy = pending !== null;
  const endpoint = planLifecycleEndpoint(context.planId);

  const [confirming, setConfirming] = useState<"readmission" | "death" | "deathCorrection" | null>(null);
  const [diedOn, setDiedOn] = useState("");
  const [deathUnderstood, setDeathUnderstood] = useState(false);
  const today = awstCalendarDay(new Date());
  const diedOnError = diedOnProblem(diedOn, today);

  const nothingOffered =
    !offered.readmission && !offered.death && !offered.deathCorrection && !(offered.contactDetail && detail !== null);
  if (nothingOffered) return null;

  const recordEvent = async (event: "readmission" | "death" | "deathCorrection") => {
    setConfirming(null);
    const done = await send(
      event,
      endpoint,
      (expectedVersion, idempotencyKey) =>
        recordEventBody({ event, diedOn: event === "death" ? diedOn : undefined, expectedVersion, idempotencyKey }),
      (payload) => {
        if (event !== "death") return PATIENT_UPDATE_ANNOUNCEMENTS[event];
        const cancelled = contactsCancelledFrom(payload);
        return cancelled === null
          ? PATIENT_UPDATE_ANNOUNCEMENTS.death
          : `${PATIENT_UPDATE_ANNOUNCEMENTS.death} ${cancelled === 1 ? "1 unsent message was" : `${cancelled} unsent messages were`} cancelled.`;
      },
    );
    if (done.ok && event === "death") {
      setDiedOn("");
      setDeathUnderstood(false);
    }
  };

  return (
    <section aria-labelledby="caring-contacts-record-a-change-heading" data-testid="caring-contacts-record-a-change">
      <h2
        id="caring-contacts-record-a-change-heading"
        className="text-base font-semibold text-[color:var(--text-heading)]"
      >
        Record a change
      </h2>
      <p className={cn(mutedTextClass, "mt-2")}>
        Something has happened to this patient since discharge. Each change below says what it does to the messages
        before you confirm it.
      </p>

      <div className="mt-3">
        <UpdateStatus pending={pending} outcome={outcome} testId="caring-contacts-record-a-change-outcome" />
      </div>

      <div className="mt-4 flex min-w-0 flex-col gap-3">
        {offered.readmission ? (
          <UpdateBlock
            heading="Readmitted to hospital"
            explanation="Recording a readmission pauses this plan straight away, so no message goes while the patient is in hospital. The calendar is not moved: every date stays where it is. Nothing restarts by itself — messages start again only when someone lets this plan run again from Plan actions on this screen."
            testId="caring-contacts-update-readmission-block"
          >
            {confirming === "readmission" ? (
              <div className="flex min-w-0 flex-col gap-2">
                <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text)]">
                  Record that this patient has been readmitted? Messages pause until someone resumes the plan.
                </p>
                <div className="flex min-h-tap min-w-0 flex-wrap items-center gap-3">
                  <button
                    type="button"
                    data-testid="caring-contacts-update-readmission-confirm"
                    aria-disabled={busy ? "true" : undefined}
                    onClick={busy ? ignoreUnavailableActivation : () => void recordEvent("readmission")}
                    className={buttonClass}
                  >
                    Yes, record the readmission
                  </button>
                  <button type="button" onClick={() => setConfirming(null)} className={buttonClass}>
                    Go back
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex min-h-tap min-w-0 items-center">
                <button
                  type="button"
                  data-testid="caring-contacts-update-readmission"
                  aria-disabled={busy ? "true" : undefined}
                  onClick={
                    busy
                      ? ignoreUnavailableActivation
                      : () => {
                          setOutcome(null);
                          setConfirming("readmission");
                        }
                  }
                  className={buttonClass}
                >
                  Record a readmission
                </button>
              </div>
            )}
          </UpdateBlock>
        ) : null}

        {offered.contactDetail && detail !== null ? (
          <>
            <MobileChange
              planId={context.planId}
              currentMobile={detail.patientMobileNumber}
              busy={busy}
              onSave={(mobile, reset) =>
                void send(
                  "contactMobile",
                  endpoint,
                  (expectedVersion, idempotencyKey) => mobileChangeBody({ mobile, expectedVersion, idempotencyKey }),
                  () => PATIENT_UPDATE_ANNOUNCEMENTS.contactMobile,
                ).then((done) => {
                  if (done.ok) reset();
                })
              }
              onRefuse={(refusal) => setOutcome({ kind: "refused", update: "contactMobile", refusal })}
              planIsPaused={state === "paused"}
            />
            <NameChange
              detail={detail}
              busy={busy}
              onSave={(patientName, preferredName) => {
                const probe = nameChangeBody({
                  patientName,
                  preferredName,
                  current: detail,
                  expectedVersion: 1,
                  idempotencyKey: "",
                });
                if (probe === null) {
                  setOutcome({
                    kind: "refused",
                    update: "contactName",
                    refusal: planActionRefusalWording("contact-detail-unchanged"),
                  });
                  return;
                }
                void send(
                  "contactName",
                  endpoint,
                  (expectedVersion, idempotencyKey) =>
                    nameChangeBody({ patientName, preferredName, current: detail, expectedVersion, idempotencyKey }) ??
                    probe,
                  () => PATIENT_UPDATE_ANNOUNCEMENTS.contactName,
                );
              }}
            />
          </>
        ) : null}

        {offered.death ? (
          <UpdateBlock
            heading="Patient has died"
            explanation="Recording a death ends this plan straight away. Every message on it that has not been sent is cancelled for good, and the plan can never restart. This cannot be undone: if it is recorded in error, the correction keeps the plan ended and a new referral is needed."
            testId="caring-contacts-update-death-block"
          >
            {confirming === "death" ? (
              <DeathConfirmation
                diedOn={diedOn}
                onDiedOn={setDiedOn}
                diedOnError={diedOnError}
                today={today}
                understood={deathUnderstood}
                onUnderstood={setDeathUnderstood}
                busy={busy}
                onConfirm={() => void recordEvent("death")}
                onCancel={() => {
                  setConfirming(null);
                  setDeathUnderstood(false);
                }}
              />
            ) : (
              <div className="flex min-h-tap min-w-0 items-center">
                <button
                  type="button"
                  data-testid="caring-contacts-update-death"
                  aria-disabled={busy ? "true" : undefined}
                  onClick={
                    busy
                      ? ignoreUnavailableActivation
                      : () => {
                          setOutcome(null);
                          setConfirming("death");
                        }
                  }
                  className={dangerOutlineButtonClass}
                >
                  Record that the patient has died
                </button>
              </div>
            )}
          </UpdateBlock>
        ) : null}

        {offered.deathCorrection ? (
          <UpdateBlock
            heading="Correct a recorded death"
            explanation="Use this only if this plan was ended because a death was recorded by mistake. The correction is kept on the record beside the original entry. It does not restart this plan and does not bring back any cancelled message. To start caring contacts for this person again, a new referral is needed."
            testId="caring-contacts-update-death-correction-block"
          >
            {confirming === "deathCorrection" ? (
              <div className="flex min-w-0 flex-col gap-2">
                <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text)]">
                  Record that the death was recorded in error? This plan stays ended either way.
                </p>
                <div className="flex min-h-tap min-w-0 flex-wrap items-center gap-3">
                  <button
                    type="button"
                    data-testid="caring-contacts-update-death-correction-confirm"
                    aria-disabled={busy ? "true" : undefined}
                    onClick={busy ? ignoreUnavailableActivation : () => void recordEvent("deathCorrection")}
                    className={buttonClass}
                  >
                    Yes, record the correction
                  </button>
                  <button type="button" onClick={() => setConfirming(null)} className={buttonClass}>
                    Go back
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex min-h-tap min-w-0 items-center">
                <button
                  type="button"
                  data-testid="caring-contacts-update-death-correction"
                  aria-disabled={busy ? "true" : undefined}
                  onClick={
                    busy
                      ? ignoreUnavailableActivation
                      : () => {
                          setOutcome(null);
                          setConfirming("deathCorrection");
                        }
                  }
                  className={buttonClass}
                >
                  Correct a recorded death
                </button>
              </div>
            )}
          </UpdateBlock>
        ) : null}
      </div>
    </section>
  );
}

function DeathConfirmation({
  diedOn,
  onDiedOn,
  diedOnError,
  today,
  understood,
  onUnderstood,
  busy,
  onConfirm,
  onCancel,
}: {
  diedOn: string;
  onDiedOn: (value: string) => void;
  diedOnError: string | null;
  today: string;
  understood: boolean;
  onUnderstood: (value: boolean) => void;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const blocked = busy || !understood || diedOnError !== null;
  return (
    <div
      className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-md)] border border-[color:var(--danger-border)] bg-[color:var(--surface)] px-3 py-3 forced-colors:border-[CanvasText]"
      data-testid="caring-contacts-update-death-confirmation"
    >
      <p className="max-w-[var(--measure)] text-sm font-semibold leading-6 text-[color:var(--text-heading)]">
        This cannot be undone.
      </p>
      <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text)]">
        Every message on this plan that has not been sent will be cancelled for good, and this plan can never restart.
        No further message will go to this number from this plan.
      </p>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${id}-died-on`} className={labelClass}>
          Date of death (optional)
        </label>
        <input
          id={`${id}-died-on`}
          type="date"
          value={diedOn}
          max={today}
          onChange={(event) => onDiedOn(event.target.value)}
          aria-describedby={`${id}-died-on-hint${diedOnError === null ? "" : ` ${id}-died-on-error`}`}
          aria-invalid={diedOnError === null ? undefined : "true"}
          className={cn(fieldClass, "sm:max-w-xs")}
        />
        <p id={`${id}-died-on-hint`} className={mutedTextClass}>
          Leave it blank if you do not know the date. The time you record this is kept instead.
        </p>
        {diedOnError === null ? null : (
          <p id={`${id}-died-on-error`} className={errorTextClass}>
            {diedOnError}
          </p>
        )}
      </div>
      <TickRow
        id={`${id}-understood`}
        checked={understood}
        onChange={onUnderstood}
        testId="caring-contacts-update-death-understood"
      >
        I understand that every unsent message is cancelled for good and this plan can never restart.
      </TickRow>
      <div className="flex min-h-tap min-w-0 flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="caring-contacts-update-death-confirm"
          aria-disabled={blocked ? "true" : undefined}
          aria-describedby={understood ? undefined : `${id}-understood`}
          onClick={blocked ? ignoreUnavailableActivation : onConfirm}
          className={dangerButtonClass}
        >
          Record the death and cancel every unsent message
        </button>
        <button type="button" onClick={onCancel} className={buttonClass}>
          Go back
        </button>
      </div>
    </div>
  );
}

type SharedCheck =
  | { readonly kind: "idle" }
  | { readonly kind: "checking"; readonly number: string }
  | { readonly kind: "answered"; readonly number: string; readonly sharedWith: number | null };

function MobileChange({
  planId,
  currentMobile,
  busy,
  onSave,
  onRefuse,
  planIsPaused,
}: {
  planId: string;
  currentMobile: string;
  busy: boolean;
  onSave: (mobile: string, reset: () => void) => void;
  onRefuse: (refusal: ReturnType<typeof planActionRefusalWording>) => void;
  planIsPaused: boolean;
}) {
  const id = useId();
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [checkedByHand, setCheckedByHand] = useState(false);
  const [shared, setShared] = useState<SharedCheck>({ kind: "idle" });
  const [triedToSave, setTriedToSave] = useState(false);

  const problem = mobilePairProblem(first, second);
  const standard = problem === null ? standardMobile(first) : null;
  const unchanged = standard !== null && isSameMobile(standard, currentMobile);

  // The shared-number check runs once the two entries are a valid, matching, NEW number. Asked by
  // POST so the number never sits in a URL or a log line.
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (standard === null || unchanged) {
      asked.current = null;
      return;
    }
    if (asked.current === standard) return;
    asked.current = standard;
    let current = true;
    setShared({ kind: "checking", number: standard });
    void post(SHARED_MOBILE_ENDPOINT, { mobile: standard, excludePlanId: planId }).then((answer) => {
      if (!current) return;
      setShared({
        kind: "answered",
        number: standard,
        sharedWith: answer.ok ? sharedWithFrom(answer.payload) : null,
      });
    });
    return () => {
      current = false;
      if (asked.current === standard) asked.current = null;
    };
  }, [planId, standard, unchanged]);

  const answer = shared.kind === "answered" && shared.number === standard ? shared : null;
  const needsTick = answer !== null && (answer.sharedWith === null || answer.sharedWith > 0);
  const checking = standard !== null && !unchanged && answer === null;
  const blockedReason =
    problem ??
    (unchanged
      ? "This is the number the plan already holds."
      : checking
        ? "Checking whether another plan uses this number…"
        : needsTick && !checkedByHand
          ? "Tick the box above once you have checked the number with the patient."
          : null);
  const blocked = busy || blockedReason !== null;

  const reset = () => {
    setFirst("");
    setSecond("");
    setCheckedByHand(false);
    setTriedToSave(false);
    setShared({ kind: "idle" });
  };

  return (
    <UpdateBlock
      heading="Change mobile number"
      explanation={`Changing the number pauses this plan, so no message goes to the new number until someone has checked it and lets the plan run again from Plan actions. ${planIsPaused ? "This plan is already paused and stays paused." : "Nothing restarts by itself."} The number check below goes back to not checked.`}
      testId="caring-contacts-update-mobile-block"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${id}-first`} className={labelClass}>
          New mobile number
        </label>
        <input
          id={`${id}-first`}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          value={first}
          onChange={(event) => {
            setFirst(event.target.value);
            setCheckedByHand(false);
          }}
          className={cn(fieldClass, "sm:max-w-xs")}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${id}-second`} className={labelClass}>
          Type the mobile number again
        </label>
        <input
          id={`${id}-second`}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          value={second}
          onChange={(event) => {
            setSecond(event.target.value);
            setCheckedByHand(false);
          }}
          aria-describedby={`${id}-second-hint`}
          className={cn(fieldClass, "sm:max-w-xs")}
        />
        <p id={`${id}-second-hint`} className={mutedTextClass}>
          Type it again rather than copying it from the box above, so a slip in either box is caught.
        </p>
      </div>

      {answer !== null && needsTick ? (
        <div
          role="group"
          aria-label="Check this number before saving"
          data-testid="caring-contacts-update-mobile-shared"
          className="flex min-w-0 flex-col gap-1 rounded-[var(--radius-md)] border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] px-3 py-2 forced-colors:border-[CanvasText]"
        >
          <p className="text-sm font-semibold text-[color:var(--text-heading)]">Check this number before saving</p>
          <p className={mutedTextClass}>
            {answer.sharedWith === null
              ? "This screen could not check whether another plan in this team uses this number. Read it back to the patient before saving."
              : `${answer.sharedWith === 1 ? "Another open plan" : `${answer.sharedWith} other open plans`} in this team ${answer.sharedWith === 1 ? "uses" : "use"} this same number. A shared or mistyped number could send one person's messages to someone else. Read the number back to the patient before saving.`}
          </p>
          <TickRow
            id={`${id}-checked`}
            checked={checkedByHand}
            onChange={setCheckedByHand}
            testId="caring-contacts-update-mobile-checked"
          >
            {MOBILE_CHECKED_TICK_LABEL}
          </TickRow>
        </div>
      ) : null}

      {triedToSave && blockedReason !== null ? (
        <p id={`${id}-blocked`} className={errorTextClass} data-testid="caring-contacts-update-mobile-problem">
          {blockedReason}
        </p>
      ) : null}

      <div className="flex min-h-tap min-w-0 items-center">
        <button
          type="button"
          data-testid="caring-contacts-update-mobile-save"
          aria-disabled={blocked ? "true" : undefined}
          aria-describedby={triedToSave && blockedReason !== null ? `${id}-blocked` : undefined}
          onClick={() => {
            if (busy) return;
            setTriedToSave(true);
            if (unchanged) {
              onRefuse(planActionRefusalWording("contact-detail-unchanged"));
              return;
            }
            if (blockedReason !== null || standard === null) return;
            onSave(standard, reset);
          }}
          className={buttonClass}
        >
          Save the new number and pause the plan
        </button>
      </div>
    </UpdateBlock>
  );
}

function NameChange({
  detail,
  busy,
  onSave,
}: {
  detail: PatientUpdateDetail;
  busy: boolean;
  onSave: (patientName: string, preferredName: string) => void;
}) {
  const id = useId();
  const [name, setName] = useState(detail.patientName);
  const [preferred, setPreferred] = useState(detail.preferredName ?? "");
  const [triedToSave, setTriedToSave] = useState(false);
  const nameBlank = name.trim() === "";

  return (
    <div className={blockClass} data-testid="caring-contacts-update-name">
      <h3 className="text-sm font-semibold text-[color:var(--text-heading)]">Edit name or preferred name</h3>
      <p className={cn(mutedTextClass, "mt-1")}>
        For a correction or a change the patient asked for. Changing a name does not pause the plan. The preferred name
        is the one messages open with.
      </p>
      <div className="mt-2 flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${id}-name`} className={labelClass}>
            Full name
          </label>
          <input
            id={`${id}-name`}
            type="text"
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={triedToSave && nameBlank ? "true" : undefined}
            aria-describedby={triedToSave && nameBlank ? `${id}-name-error` : undefined}
            className={cn(fieldClass, "sm:max-w-md")}
          />
          {triedToSave && nameBlank ? (
            <p id={`${id}-name-error`} className={errorTextClass}>
              Enter the patient&rsquo;s name.
            </p>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${id}-preferred`} className={labelClass}>
            Preferred name (optional)
          </label>
          <input
            id={`${id}-preferred`}
            type="text"
            autoComplete="off"
            value={preferred}
            onChange={(event) => setPreferred(event.target.value)}
            className={cn(fieldClass, "sm:max-w-md")}
          />
        </div>
        <div className="flex min-h-tap min-w-0 items-center">
          <button
            type="button"
            data-testid="caring-contacts-update-name-save"
            aria-disabled={busy || nameBlank ? "true" : undefined}
            onClick={() => {
              setTriedToSave(true);
              if (busy || nameBlank) return;
              onSave(name, preferred);
            }}
            className={buttonClass}
          >
            Save the name
          </button>
        </div>
      </div>
    </div>
  );
}
