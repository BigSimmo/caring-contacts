// src/components/caring-contacts/workspace/plan-wizard/stages.ts
//
// The four stages of putting a discharged patient onto a caring-contact plan, and which of them
// have been built.
//
// WHY THIS IS A SEPARATE MODULE FROM THE WIZARD. Three things need the stage set: the wizard
// itself, the draft that survives a refresh (`plan-draft.ts`, which validates a stored stage
// against it), and the tests. The wizard is a Client Component; this module carries no React, no
// hooks and no `"use client"`, so a server-side reader can import it without pulling a client
// boundary in behind it.
//
// WHY THE STAGE SET IS EXHAUSTIVE AT THE TYPE LEVEL RATHER THAN BY CONVENTION. Task 7 built the
// shell and stages 1-2, Task 8 stage 3, and Task 9 builds stage 4 against what they leave. A stage set
// expressed as a plain list plus a few `if`s would let those tasks add a stage body and forget the
// stepper, or flip the stepper and forget the forward control, and nothing would say so. So:
//
//   * `PLAN_WIZARD_STAGE_DEFINITIONS` is a `Record<PlanWizardStage, …>` — a stage added to the
//     union with no definition does not compile;
//   * `planWizardStageImplementation` is a switch with a `never`-typed default — a stage added to
//     the union and left unclassified does not compile either;
//   * the wizard's own render switch has the same `never` default, so a stage nobody handled does
//     not compile there either.
//
// The one mistake no type can catch is the OPPOSITE one: flipping an entry below to `built` and not
// writing the body. Nothing about the types relates a table entry to a switch branch, so that is a
// runtime guard instead — `assertBuiltStageHasABody` in the wizard throws rather than rendering a
// stepper over an empty column.
//
// That guard is proved by calling it directly in `tests/caring-contacts-plan-wizard.dom.test.tsx`,
// and it is worth saying why rather than only where. This comment claimed the same thing from Task 7
// onward and NOTHING TESTED IT: the sentence described a mechanism nobody had run, in the one guard
// protecting the mistake Tasks 8 and 9 could each actually make. Task 9 found it and proved it. A
// render can no longer reach it at all now that every stage is built, so it is exported and called.
//
// `contactSendability` in `src/lib/caring-contacts/model.ts` is the local precedent for this shape,
// and its note says why an exhaustive switch beats a list: a list is something a person has to
// remember to extend, and this does not compile at all when a member is added and left behind.
//
// WHAT TASKS 8 AND 9 CHANGED. Exactly one entry each in `planWizardStageImplementation` — flipping
// `personalisation` (Task 8) and then `review` (Task 9) from `not-built` to `built` — plus the
// matching branch in the wizard's render switch. Nothing else: the stepper reads this table, and
// the forward control asks this function whether the next stage is built, so both follow. Both
// tasks confirmed it: flipping the entry and writing the body turned the previous stage's
// unavailable destination into a real Continue with no edit at that call site.
//
// EVERY STAGE IS NOW BUILT, so `not-built` is returned by nothing. The variant stays because it is
// the extension point a fifth stage would use, and because Ruling 52 lives in it.

/**
 * The stages in the order a coordinator walks them: agreement, pathway, personalisation, review
 * and activation.
 */
export const PLAN_WIZARD_STAGES = ["agreement", "pathway", "personalisation", "review"] as const;

export type PlanWizardStage = (typeof PLAN_WIZARD_STAGES)[number];

export type PlanWizardStageDefinition = {
  /**
   * The stage's name as a DESTINATION NOUN, not an instruction — `UnavailableDestination` builds
   * its screen-reader note as "<label> is not built yet", so an imperative label would read as
   * "Choose a pathway is not built yet".
   */
  label: string;
  /** Plain words: what this stage is for. Read by the stepper and by the unbuilt-stage control. */
  purpose: string;
};

export const PLAN_WIZARD_STAGE_DEFINITIONS: Record<PlanWizardStage, PlanWizardStageDefinition> = {
  agreement: {
    label: "Agreement",
    purpose: "What this team is working from, and what the coordinator confirms before a pathway is chosen.",
  },
  pathway: {
    label: "Pathway",
    purpose: "Which governed message pathway version this plan runs.",
  },
  personalisation: {
    label: "Personalisation",
    // The DAY of the first contact is deliberately not named here any more. Task 8 built the
    // patient's details and the sending preference; the first-contact date is what the mockup's
    // "Adjust schedule" overlay is for, and Task 11 owns this group's overlay wiring. A purpose
    // line naming something the stage does not collect would be a promise the screen breaks.
    purpose: "The patient's details, and when in the day messages go out.",
  },
  review: {
    label: "Review and activation",
    purpose: "The whole plan read back before it starts, and the control that starts it.",
  },
};

/**
 * Whether a stage has a body yet.
 *
 * `not-built` is not an error state and never a dead end: Ruling 52 says an unbuilt destination is
 * an unavailable control with a stated reason, so the `reason` here is what that control states.
 */
export type PlanWizardStageImplementation = { kind: "built" } | { kind: "not-built"; reason: string };

export function planWizardStageImplementation(stage: PlanWizardStage): PlanWizardStageImplementation {
  switch (stage) {
    case "agreement":
    case "pathway":
    case "personalisation":
    // Task 9 built this one, and it was the last. `not-built` is therefore returned by nothing
    // today: the variant, `UnbuiltStagePanel` and `ForwardControl`'s unavailable branch are all
    // UNREACHED rather than dead, and they are kept as the extension point a fifth stage would use.
    // Ruling 52 is what they implement, and deleting them would mean re-deriving it.
    case "review":
      return { kind: "built" };
    default: {
      const unclassified: never = stage;
      return unclassified;
    }
  }
}

export function isPlanWizardStage(value: unknown): value is PlanWizardStage {
  return typeof value === "string" && (PLAN_WIZARD_STAGES as readonly string[]).includes(value);
}

/** The stage after `stage`, or null at the end of the sequence. */
export function nextPlanWizardStage(stage: PlanWizardStage): PlanWizardStage | null {
  const index = PLAN_WIZARD_STAGES.indexOf(stage);
  return PLAN_WIZARD_STAGES[index + 1] ?? null;
}

/** The stage before `stage`, or null at the start of the sequence. */
export function previousPlanWizardStage(stage: PlanWizardStage): PlanWizardStage | null {
  const index = PLAN_WIZARD_STAGES.indexOf(stage);
  return index <= 0 ? null : (PLAN_WIZARD_STAGES[index - 1] ?? null);
}
