// src/components/caring-contacts/workspace/plan-wizard/intake-seed.tsx
//
// What a referral's intake payload contributes to a new plan: the clinical banner and the seeded draft.
// Split out of `plan-wizard.tsx` unchanged. No "use client": it runs on the client through the wizard,
// and `tests/caring-contacts-explained-automation.dom.test.tsx` follows the wizard's imports into it.
import type { ReferralIntakePayload } from "@/lib/caring-contacts/referral-intake";

import { emptyPlanDraft } from "./plan-draft";
import { panelClass } from "./wizard-styles";

export function IntakeClinicalBanner({ intake }: { intake: ReferralIntakePayload }) {
  return (
    <section
      aria-label="Stored intake clinical payload"
      className={`${panelClass} mb-4 border-l-4 border-l-[color:var(--focus)] space-y-2`}
    >
      <h2 className="text-sm font-semibold text-[color:var(--text-heading)]">
        Clinical intake loaded from the audited store
      </h2>
      <p className="text-xs leading-5 text-[color:var(--text-muted)]">
        These fields were persisted with the referral at H-44 intake and round-tripped from the store for this plan.
        Patient name, mobile number and identifier are prefilled into personalisation for you to check; review safety
        alerts before activation.
      </p>
      <div className="text-xs space-y-1">
        <p>
          <span className="font-semibold text-[color:var(--text-muted)]">Facility / ward:</span>{" "}
          <span className="text-[color:var(--text)]">
            {intake.hospitalFacility} — {intake.admittingWard}
          </span>
        </p>
        {intake.clinicalSummary ? (
          <p>
            <span className="font-semibold text-[color:var(--text-muted)]">Clinical summary:</span>{" "}
            <span className="text-[color:var(--text)]">{intake.clinicalSummary}</span>
          </p>
        ) : null}
        {intake.safetyAlerts.length > 0 ? (
          <div>
            <span className="font-semibold text-[color:var(--text-muted)]">Safety alerts:</span>
            <ul className="mt-1 list-disc pl-5 text-[color:var(--text)]">
              {intake.safetyAlerts.map((alert) => (
                <li key={alert}>{alert}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** The patient name intake recorded, as the wizard seeds it. Blank when there is no intake. */
export function intakePatientName(intake: ReferralIntakePayload | null): string {
  return intake ? `${intake.givenName} ${intake.familyName}`.trim() : "";
}

/**
 * Whether `value` is still exactly what the referral intake recorded. Provenance text uses this so
 * it never says "entered by you" for a value carried over, nor "from intake" for one retyped.
 */
export function carriedFromIntake(value: string, intakeValue: string | undefined): boolean {
  return intakeValue !== undefined && intakeValue.trim() !== "" && value.trim() === intakeValue.trim();
}

export function seedDraftFromIntake(
  draft: ReturnType<typeof emptyPlanDraft>,
  intake: ReferralIntakePayload | null | undefined,
): ReturnType<typeof emptyPlanDraft> {
  if (!intake) return draft;
  const patientName = intakePatientName(intake);
  return {
    ...draft,
    patientDetail: {
      ...draft.patientDetail,
      patientName: draft.patientDetail.patientName || patientName,
      patientMobileNumber: draft.patientDetail.patientMobileNumber || intake.mobileNumber,
      patientIdentifiers: draft.patientDetail.patientIdentifiers || intake.patientIdentifier,
    },
  };
}
