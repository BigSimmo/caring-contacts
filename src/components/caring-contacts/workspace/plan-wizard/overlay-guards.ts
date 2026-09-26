// src/components/caring-contacts/workspace/plan-wizard/overlay-guards.ts
//
// Whether one of the wizard's decision overlays may carry out its decision, asked at the moment the
// decision is CONFIRMED rather than at the moment the surface was opened.
//
// WHY THIS IS A MODULE AND NOT A CONDITION WRITTEN AT EACH TRIGGER
// ---------------------------------------------------------------
// `docs/caring-contacts/interaction-matrix.md`: "Mutation-bearing actions recheck connectivity,
// permission, authentication and version state at commit time." The failure that clause is about is
// specific and invisible: a coordinator opens a confirmation, is interrupted, and presses it twenty
// minutes later. `openWorkspaceOverlayWithCommit` stages the commit at the moment the TRIGGER is
// activated, so a commit closure that captured the draft it saw then would write that draft back
// over whatever the tab holds now -- including recreating a draft another part of the tab had
// deliberately removed, with a patient's name and mobile number in it.
//
// So the predicate is pure and lives here, and the wizard calls it TWICE with values read at two
// different moments:
//
//   * at RENDER, to decide whether the trigger's commit is `{ kind: "unavailable", reason }`. That
//     is the matrix's own guard-rejection shape and the host implements it exactly -- the decision
//     control is kept focusable, carries `aria-disabled`, and points at the named reason;
//   * inside the commit, against the render-time values AND values read AT THAT MOMENT, so a state
//     that changed while the overlay sat open refuses there instead. A refusal at that point calls
//     nothing and mutates nothing.
//
// WHAT IS DELIBERATELY NOT CHECKED HERE, AND WHY EACH ABSENCE IS A FINDING RATHER THAN AN OVERSIGHT
// ------------------------------------------------------------------------------------------------
// The matrix names four things to recheck. Two of them have no honest application to these rows,
// and inventing a check that cannot fail would be worse than not having one -- a green assertion
// about a condition nothing can change proves only that the assertion was written.
//
//   * CONNECTIVITY. Every decision in this module is a write to this tab's own storage or a
//     navigation within this application. None of them touches the network, so refusing one for
//     want of a connection would be a false statement to a clinician. The one wizard decision that
//     IS network-bound is `final-activation`, which is Task 9's: `post()` in `plan-wizard.tsx`
//     already turns a failed `fetch` into `TRANSPORT_REFUSALS.didNotReach` and keeps the draft.
//   * AUTHENTICATION. `requiresFreshAuthentication` is `true` on exactly two rows of the frozen
//     table, `withdrawal` and `reassignment`, and neither is wired here. Where it IS true,
//     `OverlayHost` owns the checkpoint and commits only on the second activation; nothing a screen
//     writes could add to that.
//
// PERMISSION is a third absence and the argument is different. `src/app/caring-contacts/plans/new/page.tsx`
// asks `canPerformCaringContactAction(actor, "claimPlan", ...)` BEFORE it renders the wizard at all
// and returns `PlanStartStateNotice` instead when the answer is no. So inside this component the
// answer is a constant, and a permission recheck here would be a check that cannot fail. It is
// reported rather than written.
//
// No React, no `"use client"`, no storage and no `window`: this module is pure so the rule can be
// proved directly rather than inferred from a rendered control, and so the wizard cannot end up
// holding a second copy of it.

/**
 * A condition one of the wizard's decisions depends on.
 *
 * TWO KINDS, and the difference is the whole of the commit-time clause rather than a detail:
 *
 *  * `sign-up-still-here` compares the moment the decision was OPENED with the moment it was
 *    CONFIRMED. It is vacuous at open time -- nothing has changed yet -- and is the only thing here
 *    that can catch a confirmation pressed long after the surface was raised.
 *  * `draft-survives-leaving-this-screen` is a plain statement about now, and means the same thing
 *    whenever it is asked.
 *
 * A closed union rather than a free string, so a row cannot declare a need nothing evaluates.
 */
export type WizardDecisionCondition =
  /**
   * The sign-up this decision belongs to has not been REMOVED since the decision was opened.
   *
   * Not "a draft exists". On a screen nobody has typed into yet there is no stored draft at all,
   * and a decision that creates the first one is not a failure. The condition is narrower and its
   * failure is worse: a draft that was there when the surface was raised and has since gone.
   * `clearPlanDraft()` runs from the discard decision, from `change-patient`, from a successful
   * activation, and from `readPlanDraft` when the stored draft turns out to belong to another
   * referral. Writing a captured draft back afterwards would put a patient's name and mobile number
   * into this tab's storage again, after something had deliberately removed them.
   */
  | "sign-up-still-here"
  /**
   * The browser is actually writing the draft down, rather than holding it for the life of this
   * page only.
   *
   * `plan-draft.ts` falls back to an in-memory draft when `sessionStorage` refuses a write -- which
   * is what Safari private browsing does -- and that fallback lasts as long as the page, not as
   * long as the tab. Only a decision that promises the sign-up will still be there AFTER leaving
   * this screen depends on it, which is `save-draft` and nothing else.
   */
  | "draft-survives-leaving-this-screen";

/**
 * What is true at one moment, read at that moment.
 *
 * Deliberately plain booleans rather than the draft itself, so this module cannot be handed a stale
 * object and quietly agree with it.
 */
export type WizardDecisionState = {
  /** A draft for the referral this wizard is for is in this tab. */
  readonly draftExists: boolean;
  /** `planDraftIsHeld()` -- the draft is in the tab's storage rather than only in this page's memory. */
  readonly draftIsWrittenDown: boolean;
};

/**
 * The plain words each refusal is shown in, on the rows it reads the same way on.
 *
 * Written by hand, per condition, and rendered verbatim -- Ruling 61's rule applied one layer up.
 * There is no default branch and nothing is derived from the identifier, so a condition added to
 * the union without wording fails to compile rather than printing a plausible sentence nobody wrote.
 *
 * Each states that nothing was changed, because a refusal arriving after a decision was confirmed
 * is exactly the moment a clinician would assume otherwise.
 */
export const WIZARD_DECISION_REFUSALS: Readonly<Record<WizardDecisionCondition, string>> = Object.freeze({
  "sign-up-still-here":
    "This sign-up was removed from this computer while this was open, so there is nothing left to record it against. Nothing was changed and nothing was put back. Start the sign-up again from this team's plans.",
  "draft-survives-leaving-this-screen":
    "This browser is not writing this sign-up down, so leaving this screen would lose what you have entered rather than keep it. Nothing was changed and nothing has been lost yet. Finish the sign-up in this tab instead.",
});

/**
 * Where one row needs different words from its condition's own, because the same fact means
 * something different on it.
 *
 * ONE ENTRY, AND IT IS A REAL DEFECT RATHER THAN A REFINEMENT. `sign-up-still-here` fires when the
 * sign-up has gone while the surface was open, and the sentence above is right for every row that
 * wanted to RECORD something onto it: there is nothing left to record against, and starting again is
 * the remedy. On `discard-changes` it is wrong twice over. The coordinator asked for the sign-up to
 * go; it has gone; and they are then refused and told to start a sign-up again -- for an outcome
 * they wanted and already have. A refusal that reads as a failure when the thing they asked for is
 * already true is worse than no refusal, because it invites them to undo it.
 *
 * The row still gets a refusal rather than silent success, and that is deliberate: nothing on this
 * press performed the removal, so reporting it as done would claim an action this control did not
 * take. What the override changes is the sentence, never the outcome.
 *
 * Keyed by `overlayId` then condition, both looked up with `Object.hasOwn` for the reason
 * `overlay-host.tsx` records: an object literal inherits `toString`, and a `=== undefined` guard
 * would resolve it to a FUNCTION that React renders as nothing.
 */
export const WIZARD_DECISION_REFUSAL_OVERRIDES: Readonly<
  Record<string, Readonly<Partial<Record<WizardDecisionCondition, string>>>>
> = Object.freeze({
  "discard-changes": Object.freeze({
    "sign-up-still-here":
      "This sign-up had already gone from this computer, so there was nothing left to discard. Nothing was put back and nothing of it remains here, which is what you were asking for. This press is not what removed it, so this says so rather than reporting it as done.",
  }),
});

/**
 * The sentence this row shows for this unmet condition.
 *
 * Total: the override is consulted first, the per-condition wording answers everywhere else, and a
 * condition with no wording throws rather than falling back to something merely plausible.
 */
export function wizardDecisionRefusalWording(overlayId: string, condition: WizardDecisionCondition): string {
  if (Object.hasOwn(WIZARD_DECISION_REFUSAL_OVERRIDES, overlayId)) {
    const overrides = WIZARD_DECISION_REFUSAL_OVERRIDES[overlayId];
    if (Object.hasOwn(overrides, condition)) {
      const wording = overrides[condition];
      // Narrowing only. `Object.hasOwn` cannot tell TypeScript the value is present, and a
      // `Partial` records it as possibly undefined; this is reached only for an entry written as
      // an explicit `undefined`, which would be a mistake worth falling through rather than
      // rendering nothing.
      if (wording !== undefined) return wording;
    }
  }
  // `Object.hasOwn`, not `WIZARD_DECISION_REFUSALS[condition] === undefined`. The map is an object
  // literal, so it inherits from `Object.prototype` and `"toString"` would resolve to a FUNCTION
  // that React renders as nothing -- a control refused with an empty reason beside it. The key is a
  // closed union today, so this is belt-and-braces; `overlay-host.tsx` records why a per-lookup fix
  // does not travel between lookups, and this is the lookup at this end of it.
  if (!Object.hasOwn(WIZARD_DECISION_REFUSALS, condition)) {
    throw new Error(
      `No plain-words refusal for the wizard decision condition "${condition}". Add an entry to ` +
        `WIZARD_DECISION_REFUSALS deliberately; do not derive one from the identifier.`,
    );
  }
  return WIZARD_DECISION_REFUSALS[condition];
}

/**
 * The first condition this row's decision depends on that is not met, in plain words -- or null.
 *
 * TWO STATES, NOT ONE, and that is the mechanism rather than an interface convenience. `opened` is
 * what was true when the surface was raised and `now` is what is true as it is confirmed. A caller
 * asking at open time passes the same value twice, which is the honest answer there because nothing
 * has changed yet.
 *
 * THE ROW IS THE PARAMETER RATHER THAN ITS CONDITION LIST. The list is read here, from the one table
 * that declares it, so a caller cannot pair one row's id with another row's needs -- and the row is
 * what the wording lookup needs, because the same unmet fact does not mean the same thing on every
 * row (see the overrides above).
 *
 * TOTAL over the union, and ordered, so the sentence a clinician reads is the earliest true
 * obstacle rather than whichever check happened to be written first.
 */
export function wizardDecisionRefusal(
  overlayId: string,
  opened: WizardDecisionState,
  now: WizardDecisionState,
): string | null {
  for (const need of wizardDecisionConditions(overlayId)) {
    if (!conditionIsMet(need, opened, now)) return wizardDecisionRefusalWording(overlayId, need);
  }
  return null;
}

function conditionIsMet(
  condition: WizardDecisionCondition,
  opened: WizardDecisionState,
  now: WizardDecisionState,
): boolean {
  switch (condition) {
    case "sign-up-still-here":
      // Unmet ONLY on the transition. A sign-up that existed at neither moment was not removed, and
      // a decision that creates the first draft of a fresh sign-up is not a failure.
      return !(opened.draftExists && !now.draftExists);
    case "draft-survives-leaving-this-screen":
      return now.draftIsWrittenDown;
    default: {
      // A member added to the union and left out of this switch does not compile, which is the
      // point of the `never`: the map above would still have wording for it, so the check would
      // otherwise pass silently for a condition nobody had implemented.
      const unhandled: never = condition;
      return unhandled;
    }
  }
}

/**
 * What each of the wizard's mutating overlay rows depends on.
 *
 * Keyed by the frozen table's own overlay id, so a row wired here and a row in the matrix cannot
 * come apart silently. `change-patient` declares NOTHING, and that is a statement rather than a gap:
 * it removes the draft and leaves, and neither of those can be refused by a state this screen can
 * observe -- removing a draft that has already gone is not a failure, and the destination is a page
 * in this application. Writing a condition for it purely so the row had one would be a check that
 * cannot fail.
 */
export const WIZARD_DECISION_CONDITIONS: Readonly<Record<string, readonly WizardDecisionCondition[]>> = Object.freeze({
  "verify-identity": Object.freeze(["sign-up-still-here"] as const),
  "change-patient": Object.freeze([] as const),
  "pathway-preview": Object.freeze(["sign-up-still-here"] as const),
  "communication-preference": Object.freeze(["sign-up-still-here"] as const),
  "save-draft": Object.freeze(["sign-up-still-here", "draft-survives-leaving-this-screen"] as const),
  "discard-changes": Object.freeze(["sign-up-still-here"] as const),
});

/**
 * The conditions the named row declares.
 *
 * Throws for a row this module says nothing about, rather than returning an empty list. An empty
 * list is `change-patient`'s deliberate answer, so it cannot also be the way a typo is reported --
 * a mistyped id would otherwise wire a mutating decision with no guard at all and look identical to
 * the one row that legitimately has none.
 */
export function wizardDecisionConditions(overlayId: string): readonly WizardDecisionCondition[] {
  if (!Object.hasOwn(WIZARD_DECISION_CONDITIONS, overlayId)) {
    throw new Error(
      `The wizard declares no decision conditions for the overlay "${overlayId}". Add an entry to ` +
        `WIZARD_DECISION_CONDITIONS deliberately -- an empty list is change-patient's stated answer, ` +
        `not a default.`,
    );
  }
  return WIZARD_DECISION_CONDITIONS[overlayId];
}
