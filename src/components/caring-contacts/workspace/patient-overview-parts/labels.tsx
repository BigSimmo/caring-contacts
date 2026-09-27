// src/components/caring-contacts/workspace/patient-overview-parts/labels.tsx
//
// Plan state and outcome wording, and the label/value row the patient page's cards share.
// Split out of `patient-overview.tsx` unchanged; see that module's note for the rulings behind it.
import type { ReactNode } from "react";

import type { PlanState } from "@/lib/caring-contacts/model";
import type { PlanOutcome } from "@/lib/caring-contacts/repository";

export const PLAN_STATE_LABELS: Readonly<Record<PlanState, string>> = Object.freeze({
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  withdrawn: "Withdrawn",
  cancelled: "Cancelled",
  completed: "Completed",
});

export const PLAN_OUTCOME_LABELS: Readonly<Record<PlanOutcome, string>> = Object.freeze({
  inProgress: "In progress",
  withdrawn: "Withdrawn",
  cancelled: "Cancelled",
  completed: "Completed",
});

/**
 * Label-and-value rows, one definition list per card. The label column is fixed from `sm` so the
 * values line up down the card; on a phone each label sits above its value. The label keeps its
 * trailing colon and space so the row still reads as one sentence to a screen reader and in tests.
 */
export const fieldListClass = "grid min-w-0 gap-y-2 text-sm leading-6";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-x-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
      <dt className="font-medium text-[color:var(--text)]">{label}: </dt>
      <dd className="min-w-0 break-words text-[color:var(--text-muted)]">{children}</dd>
    </div>
  );
}
