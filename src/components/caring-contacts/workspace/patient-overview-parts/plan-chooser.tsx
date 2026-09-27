// src/components/caring-contacts/workspace/patient-overview-parts/plan-chooser.tsx
//
// The patient page's chooser, shown when this team holds more than one plan for the patient.
// Split out of `patient-overview.tsx` unchanged; see that module's note for the rulings behind it.
import Link from "next/link";

import { CARING_CONTACTS_ROUTES, patientPlanRoute } from "@/lib/caring-contacts-routes";
import { awstCalendarDay } from "@/lib/caring-contacts/clock";
import type { PatientNameProjection, PlanRecord } from "@/lib/caring-contacts/repository";

import { PLAN_STATE_LABELS } from "./labels";

export function BackToPatients() {
  return (
    <Link
      href={CARING_CONTACTS_ROUTES.patients}
      data-internal-link="true"
      className="inline-flex min-h-tap items-center justify-center rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-4 text-sm font-semibold text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] forced-colors:border-[CanvasText]"
    >
      Back to this team&rsquo;s plans
    </Link>
  );
}

export const rowLinkClass =
  "flex min-h-tap min-w-0 flex-col justify-center rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] forced-colors:border-[CanvasText]";

/**
 * More than one plan, and nothing in the URL naming one.
 *
 * The name comes from `listPatientNames` (Ruling 91), never from `getEpisode`: choosing between
 * two plans needs a name to recognise the person by and nothing else, and `getEpisode` would
 * release four identifying fields to answer a question about which plan to open. It is also
 * keyed by PLAN, and that matters here more than anywhere else in the workspace -- a retention
 * clearance is recorded per plan, so one of this patient's two plans can hold a name while the
 * other does not, and the chooser shows each row's own answer rather than one name for both.
 */
export function PlanChooser({
  patientId,
  plans,
  patientNames,
}: {
  patientId: string;
  plans: readonly PlanRecord[];
  patientNames: readonly PatientNameProjection[];
}) {
  // A cleared plan's name is the empty string both stores write for a removed one, so it is
  // dropped here rather than at each row: an empty name is "no name held", never a name.
  const nameByPlan = new Map(
    patientNames.filter((entry) => entry.patientName !== "").map((entry) => [entry.planId, entry.patientName]),
  );
  const anyName = plans.map((record) => nameByPlan.get(record.plan.id)).find((name) => name !== undefined) ?? null;

  return (
    <section aria-labelledby="caring-contacts-plan-chooser-heading" className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-[color:var(--text-muted)]">
        {anyName === null ? "Synthetic patient identifier" : "Patient"}
      </p>
      <p className="mt-0.5 break-words text-sm font-semibold text-[color:var(--text-heading)]">
        {anyName ?? patientId}
      </p>
      <h2
        id="caring-contacts-plan-chooser-heading"
        className="mt-4 text-base font-semibold text-[color:var(--text-heading)]"
      >
        This patient has more than one plan
      </h2>
      <p className="mt-2 max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
        Choose which plan to open. This screen shows one plan at a time and will not choose for you: two plans for one
        person can hold different things, because a retention clearance is recorded against a plan rather than against a
        patient, and one plan&rsquo;s schedule shown under this patient&rsquo;s name without saying which plan it is
        would be the worst mistake this screen could make.
      </p>

      <ul className="mt-4 flex min-w-0 flex-col gap-3">
        {plans.map((record) => {
          const name = nameByPlan.get(record.plan.id) ?? null;
          return (
            <li key={record.plan.id} className="min-w-0">
              <Link
                href={patientPlanRoute(patientId, record.plan.id)}
                data-internal-link="true"
                className={rowLinkClass}
              >
                <span className="truncate text-sm font-semibold text-[color:var(--text-heading)]">
                  Plan {record.plan.id}
                </span>
                <span className="mt-0.5 truncate text-sm text-[color:var(--text-muted)]">
                  {PLAN_STATE_LABELS[record.plan.state]} &middot; discharged {awstCalendarDay(record.dischargeAt)}{" "}
                  (AWST) &middot; {name === null ? "no name held for this plan" : name}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-5">
        <BackToPatients />
      </div>
    </section>
  );
}
