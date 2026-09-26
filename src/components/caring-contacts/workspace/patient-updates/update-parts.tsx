import { CircleAlert, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/components/ui-primitives";

import { OVERLAY_TRIGGER_CLASS } from "../overlays/overlay-trigger";
import { StatedReason } from "../plan-wizard/stated-reason";
import { PATIENT_UPDATE_NAMES, type PatientUpdateId } from "./patient-update-rules";
import type { PatientUpdateOutcome } from "./use-plan-update";

export const mutedTextClass = "max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]";
export const fieldClass =
  "min-h-tap w-full min-w-0 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] forced-colors:border-[CanvasText]";
export const blockClass =
  "min-w-0 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-3 forced-colors:border-[CanvasText]";
export const blockHeadingClass = "text-sm font-semibold text-[color:var(--text-heading)]";
export const labelClass = "text-sm font-medium text-[color:var(--text-heading)]";
export const buttonClass = cn(OVERLAY_TRIGGER_CLASS, "w-full sm:w-auto");
export const dangerOutlineButtonClass = cn(
  OVERLAY_TRIGGER_CLASS,
  "w-full border-[color:var(--danger-border)] text-[color:var(--danger-text)] hover:border-[color:var(--danger)] sm:w-auto",
);
export const dangerButtonClass = cn(
  OVERLAY_TRIGGER_CLASS,
  "w-full border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] text-[color:var(--danger-text)] hover:border-[color:var(--danger)] sm:w-auto",
);
export const errorTextClass = "max-w-[var(--measure)] text-sm leading-6 text-[color:var(--danger-text)]";

/**
 * The wait and the answer, announced through one live region the reader is already following --
 * the plan actions' own shape, so the two surfaces on this screen answer a write in the same way.
 */
export function UpdateStatus({
  pending,
  outcome,
  testId,
}: {
  pending: PatientUpdateId | null;
  outcome: PatientUpdateOutcome | null;
  testId: string;
}) {
  return (
    <div role="status" data-testid={testId} className="min-w-0">
      {pending !== null ? (
        <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-[color:var(--text-muted)]">
          <Loader2 aria-hidden="true" className="size-icon-md shrink-0 animate-spin motion-reduce:animate-none" />
          <span className="min-w-0">Recording this on the plan…</span>
        </p>
      ) : outcome === null ? null : outcome.kind === "recorded" ? (
        <StatedReason
          heading={`${PATIENT_UPDATE_NAMES[outcome.update]} — recorded on the plan`}
          because={outcome.announcement}
          changedBy="Nothing further here. The rest of this screen is being read again so it shows the change."
        />
      ) : (
        <StatedReason
          heading={`${PATIENT_UPDATE_NAMES[outcome.update]} — ${outcome.refusal.heading}`}
          because={outcome.refusal.because}
          changedBy={outcome.refusal.changedBy}
          icon={<CircleAlert aria-hidden="true" className="size-icon-md shrink-0" />}
        />
      )}
    </div>
  );
}

export function UpdateBlock({
  heading,
  explanation,
  testId,
  children,
}: {
  heading: string;
  explanation: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div className={blockClass} data-testid={testId}>
      <h3 className={blockHeadingClass}>{heading}</h3>
      <p className={cn(mutedTextClass, "mt-1")}>{explanation}</p>
      <div className="mt-2 flex min-w-0 flex-col gap-3">{children}</div>
    </div>
  );
}

/** A checkbox whose whole row is the 48px target, not just the box. */
export function TickRow({
  id,
  checked,
  onChange,
  children,
  testId,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <label htmlFor={id} className="flex min-h-tap min-w-0 cursor-pointer items-start gap-3 py-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        data-testid={testId}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 size-5 shrink-0 accent-[color:var(--clinical-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
      />
      <span className="min-w-0 text-sm leading-6 text-[color:var(--text)]">{children}</span>
    </label>
  );
}
