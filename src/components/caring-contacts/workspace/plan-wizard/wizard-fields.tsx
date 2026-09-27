// src/components/caring-contacts/workspace/plan-wizard/wizard-fields.tsx
//
// The form fields, the forward control and the refusal statement the wizard's stages are built from.
// Split out of `plan-wizard.tsx` unchanged. No "use client": it runs on the client through the wizard,
// and `tests/caring-contacts-explained-automation.dom.test.tsx` follows the wizard's imports into it.
import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { UnavailableDestination } from "../unavailable-destination";
import { submissionRefusalWording, type SubmissionRefusalWording } from "./plan-activation";
import {
  nextPlanWizardStage,
  PLAN_WIZARD_STAGE_DEFINITIONS,
  type PlanWizardStage,
  planWizardStageImplementation,
} from "./stages";
import { StatedReason } from "./stated-reason";
import { fieldClass, mutedTextClass, primaryControlClass, secondaryControlClass } from "./wizard-styles";

/** One fact, with where it came from. The source line is the whole point — see Ruling [112]. */
export function SourcedFact({
  icon,
  label,
  value,
  source,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  source: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3 border-t border-[color:var(--border)] py-3 first:border-t-0 first:pt-0">
      <span className="mt-0.5 shrink-0 text-[color:var(--text-muted)]">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-[color:var(--text-muted)]">{label}</p>
        <p className="mt-0.5 break-words text-sm font-semibold text-[color:var(--text-heading)]">{value}</p>
        <p className="mt-0.5 text-xs leading-5 text-[color:var(--text-muted)]">{source}</p>
      </div>
    </div>
  );
}

/**
 * One labelled single-line field, with its requirement stated beneath it.
 *
 * THE REQUIREMENT IS ALWAYS RENDERED, not revealed once the clinician has touched the field and
 * left it empty. It is written as a requirement rather than a rebuke ("a plan cannot be created
 * without one"), so it reads correctly before anything has been typed — and a "touched" flag would
 * mean a screen-reader user who tabs past the field learns nothing about why the forward control is
 * inert. `aria-invalid` follows the same fact, so the two can never disagree.
 */
export function TextField({
  id,
  label,
  hint,
  value,
  requirement,
  onChange,
  inputMode,
  autoComplete,
  describedBy,
}: {
  id: string;
  label: string;
  /**
   * Plain words about what this field is for, shown whether or not anything is missing.
   *
   * Distinct from `requirement`, which appears only while the field is incomplete: a hint that
   * explains WHY a question is asked has to be readable at the moment the clinician is deciding
   * what to type, not only after they have failed to. Both are named in `aria-describedby` when
   * both are present.
   */
  hint?: string;
  value: string;
  /** Plain words: what this field is for and why it cannot be left empty. Null when optional. */
  requirement: string | null;
  onChange: (value: string) => void;
  inputMode?: "tel";
  autoComplete?: "off";
  /**
   * An extra element id to name in `aria-describedby`, for a statement that lives outside this
   * component — today, the mobile field's caution region (round 1, I-2). Joined with the
   * requirement rather than replacing it: a field can be both incomplete and cautioned.
   */
  describedBy?: string;
}) {
  const requirementId = `${id}-requirement`;
  const hintId = `${id}-hint`;
  const described = [
    hint === undefined ? null : hintId,
    requirement === null ? null : requirementId,
    describedBy ?? null,
  ].filter((entry): entry is string => entry !== null);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-[color:var(--text-heading)]">
        {label}
      </label>
      <input
        type="text"
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode={inputMode}
        autoComplete={autoComplete}
        aria-invalid={requirement !== null}
        aria-describedby={described.length === 0 ? undefined : described.join(" ")}
        className={fieldClass}
      />
      {hint === undefined ? null : (
        <p id={hintId} className={mutedTextClass}>
          {hint}
        </p>
      )}
      {requirement === null ? null : (
        <p id={requirementId} className={mutedTextClass}>
          {requirement}
        </p>
      )}
    </div>
  );
}

/** The same, for a value that is a list the clinician writes one line at a time. */
export function TextAreaField({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const hintId = `${id}-hint`;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-[color:var(--text-heading)]">
        {label}
      </label>
      <textarea
        id={id}
        rows={3}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={hintId}
        className={fieldClass}
      />
      <p id={hintId} className={mutedTextClass}>
        {hint}
      </p>
    </div>
  );
}

/**
 * One labelled calendar-day field.
 *
 * Native `disabled` rather than `aria-disabled`, and the difference is the rule rather than a
 * preference: the first-contact day is inert only until the discharge day is entered, which is
 * TRANSIENT inertness and exactly what the native attribute is for. `aria-disabled` plus an inert
 * handler is for a destination that will not exist however long you wait, and the two are never
 * combined on one control.
 */
export function DateField({
  id,
  label,
  value,
  onChange,
  hint,
  min,
  max,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint: string;
  min?: string;
  max?: string;
  disabled?: boolean;
}) {
  const hintId = `${id}-hint`;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-[color:var(--text-heading)]">
        {label}
      </label>
      <input
        type="date"
        id={id}
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={hintId}
        className={fieldClass}
      />
      <p id={hintId} className={mutedTextClass}>
        {hint}
      </p>
    </div>
  );
}

/**
 * The control that moves to the next stage, or states that the next stage is not built.
 *
 * THE EXTENSION POINT, and the reason it is one control rather than two. Task 8 flipped
 * `personalisation` to `built` in `stages.ts` and wrote its body; this control became a real
 * Continue with no edit here, because it asks the same table the stepper reads — the mechanism
 * worked exactly as intended, and Task 9 flips `review` the same way. A hand-written "coming soon"
 * button at each call site is the version of this that either task could have half-changed.
 *
 * `UnavailableDestination` carries `aria-disabled` plus an inert handler rather than the native
 * `disabled` attribute, because `disabled` removes the tab stop and the stated reason could then
 * never be reached by keyboard. `ready` is a different thing entirely — a control awaiting validity
 * is TRANSIENTLY inert, which is what native `disabled` is for — and the two are never combined.
 */
export function ForwardControl({
  from,
  ready,
  onContinue,
}: {
  from: PlanWizardStage;
  ready: boolean;
  onContinue: () => void;
}) {
  const next = nextPlanWizardStage(from);
  if (next === null) return null;
  const definition = PLAN_WIZARD_STAGE_DEFINITIONS[next];
  const implementation = planWizardStageImplementation(next);

  if (implementation.kind === "not-built") {
    return (
      <UnavailableDestination
        id={`plan-wizard-${next}`}
        label={definition.label}
        reason={implementation.reason}
        className={secondaryControlClass}
      />
    );
  }

  return (
    <button type="button" disabled={!ready} onClick={onContinue} className={primaryControlClass}>
      <span className="truncate">Continue to {definition.label.toLowerCase()}</span>
    </button>
  );
}

/**
 * One refusal, in the three-part shape §4.4 sets, with the wording resolved from its name.
 *
 * `wording` is a parameter because the SAME refusal name means two different things depending on
 * which write produced it: `service-stopped` before the create means nothing exists, and after it
 * means a plan exists and is waiting to be started. One lookup table for both would have to print a
 * sentence that is false in one of the two cases.
 */
export function RefusalStatement({
  refusal,
  wording: resolve = submissionRefusalWording,
}: {
  refusal: string;
  wording?: (refusal: string) => SubmissionRefusalWording;
}) {
  const wording = resolve(refusal);
  return (
    <StatedReason
      heading={wording.heading}
      because={wording.because}
      changedBy={wording.changedBy}
      icon={<CircleAlert aria-hidden="true" className="size-icon-md shrink-0" />}
    />
  );
}
