// src/components/caring-contacts/workspace/plan-wizard/wizard-chrome.tsx
//
// The wizard's stepper and the panel an unbuilt stage renders.
// Split out of `plan-wizard.tsx` unchanged. No "use client": it runs on the client through the wizard,
// and `tests/caring-contacts-explained-automation.dom.test.tsx` follows the wizard's imports into it.
import { ListEmptyState } from "../list-empty-state";
import {
  PLAN_WIZARD_STAGE_DEFINITIONS,
  PLAN_WIZARD_STAGES,
  type PlanWizardStage,
  planWizardStageImplementation,
} from "./stages";
import { panelClass, secondaryControlClass } from "./wizard-styles";

export function Stepper({ active }: { active: PlanWizardStage }) {
  return (
    <nav aria-label="Sign-up stages">
      <ol className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
        {PLAN_WIZARD_STAGES.map((stage) => {
          const definition = PLAN_WIZARD_STAGE_DEFINITIONS[stage];
          const implementation = planWizardStageImplementation(stage);
          const current = stage === active;
          return (
            <li
              key={stage}
              aria-current={current ? "step" : undefined}
              className={`flex min-w-0 items-center gap-2 rounded-[var(--radius-md)] border px-3 py-2 text-sm ${
                current
                  ? "border-[color:var(--clinical-accent)] font-semibold text-[color:var(--text-heading)]"
                  : "border-[color:var(--border)] text-[color:var(--text-muted)]"
              } forced-colors:border-[CanvasText]`}
            >
              <span className="min-w-0 truncate">{definition.label}</span>
              {implementation.kind === "not-built" ? (
                <span className="shrink-0 text-xs text-[color:var(--text-muted)]">not built yet</span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * A stage this task did not build.
 *
 * Ruling 52: an unbuilt destination is an unavailable control with a stated reason, never a dead
 * end — so the way back is a real control, not a promise.
 */
export function UnbuiltStagePanel({
  stage,
  reason,
  onBack,
}: {
  stage: PlanWizardStage;
  reason: string;
  onBack: () => void;
}) {
  const definition = PLAN_WIZARD_STAGE_DEFINITIONS[stage];
  return (
    <section aria-label={definition.label} className={panelClass}>
      <ListEmptyState
        kind="no-data"
        heading={`${definition.label} is not built yet`}
        explanation={reason}
        action={
          <button type="button" onClick={onBack} className={secondaryControlClass}>
            <span className="truncate">Back</span>
          </button>
        }
      />
    </section>
  );
}
