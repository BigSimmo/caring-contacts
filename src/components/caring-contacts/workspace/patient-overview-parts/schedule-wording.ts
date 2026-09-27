// src/components/caring-contacts/workspace/patient-overview-parts/schedule-wording.ts
//
// Plain-words sentences about a plan's schedule: whether it is running, and why a message will not be sent.
// Split out of `patient-overview.tsx` unchanged; see that module's note for the rulings behind it.
import { contactSendability, type PlanState } from "@/lib/caring-contacts/model";
import type { PlanOutcome, PlanRecord, StoredContact, StoredContactSummary } from "@/lib/caring-contacts/repository";

import { plural } from "../count-wording";
import { PLAN_OUTCOME_LABELS, PLAN_STATE_LABELS } from "./labels";

/**
 * Whether the PLAN is running, said beside the summary of what its messages hold -- or null when
 * there is nothing that could be misread.
 *
 * THE DEFECT THIS EXISTS FOR, AND IT IS THE ONE THIS SCREEN MOST PLAUSIBLY REINTRODUCES. `pausePlan`
 * is a plain lifecycle transition: it moves the plan and touches no contact. So a paused plan's
 * messages are still `scheduled`, `contactSendability` still classifies them `stillToSend`, and
 * `scheduleSummarySentence` above still says "every one of them is still to be sent" -- a true
 * statement about the RECORD that reads as a promise about the future. A draft plan is the same
 * shape: created, dated, and not started.
 *
 * That is deliberately NOT fixed by re-deriving sendability here. The classification is correct and
 * belongs to ./model; what is missing is the second fact, which lives on `plan.state`, and stating
 * it is this screen's job. `withdrawPlan` and `recordHospitalStatusEvent` cancel every unsent
 * contact, so an ENDED plan explains itself row by row through `notSentExplanation` and needs
 * nothing here -- which is why the terminal branch below is guarded by `stillToSend` and says the
 * record disagrees with itself rather than inventing a cause.
 *
 * Nothing here claims what a dispatcher would do with a paused plan's contact. It says what the two
 * records hold and leaves the reader in no doubt that a date on this screen is not a message on its
 * way.
 *
 * An exhaustive switch, so a seventh plan state cannot default into silence.
 */
export function planNotRunningNote(
  state: PlanState,
  summary: StoredContactSummary,
): { state: string; because: string; changedBy: string } | null {
  if (summary.stillToSend === 0) return null;

  const notOnItsWay = "so a date below is not a message on its way.";
  switch (state) {
    case "active":
      return null;
    case "draft":
      return {
        state: PLAN_STATE_LABELS.draft,
        because: `The messages below are dated and still to be sent, and this plan has not been started. A plan that has not been started is not running, ${notOnItsWay}`,
        changedBy:
          "Starting the plan, which is the last step of the sign-up that created it. Nothing on this screen does it.",
      };
    case "paused":
      return {
        state: PLAN_STATE_LABELS.paused,
        because: `The messages below are dated and still to be sent, and this plan is paused. A paused plan is not running, ${notOnItsWay}`,
        changedBy:
          "Letting the plan run again, which the plan actions on this screen offer to a role that is granted it.",
      };
    case "withdrawn":
    case "cancelled":
    case "completed":
      // Unreachable through any store write today: every ending runs the unsent contacts through
      // `{ type: "cancel" }`, so an ended plan holds nothing still to send. Written rather than
      // omitted because the types permit the combination, and the honest thing to say about it is
      // that the two records disagree -- not a cause invented to reconcile them.
      return {
        state: PLAN_STATE_LABELS[state],
        because: `This plan has ended, and the messages below are still recorded as still to be sent. Those two facts disagree, ${notOnItsWay}`,
        changedBy: "Nothing on this screen. A record that disagrees with itself is for the service to look at.",
      };
    default: {
      const unhandled: never = state;
      return unhandled;
    }
  }
}

/**
 * What is true of this plan's schedule, said in plain words and never as a claim about the future
 * that the plan itself has already falsified.
 *
 * "Every one of them will be sent" was the first version, and a withdrawn plan made it false: the
 * sentence has to be derived from all three buckets, not from the absence of one of them. The
 * single-bucket wordings exist because "10 entries: 10 still to send." is arithmetic rather than a
 * sentence, and this is the line a clinician reads first.
 */
export function scheduleSummarySentence(summary: StoredContactSummary): string {
  const entries = plural(summary.total, "entry", "entries");
  if (summary.total === 0) return "This plan holds no schedule entries.";
  if (summary.willNotBeSent === summary.total) return `${entries}, and none of them will be sent.`;
  if (summary.stillToSend === summary.total) return `${entries}, and every one of them is still to be sent.`;
  if (summary.alreadySent === summary.total) return `${entries}, and every one of them has been sent.`;

  const parts: string[] = [];
  if (summary.alreadySent > 0) parts.push(`${summary.alreadySent} already sent`);
  if (summary.stillToSend > 0) parts.push(`${summary.stillToSend} still to send`);
  if (summary.willNotBeSent > 0) parts.push(`${summary.willNotBeSent} that will not be sent`);
  const last = parts.pop() as string;
  return `${entries}: ${[...parts, `and ${last}`].join(", ")}.`;
}

/**
 * Why this message will not be sent, and what would change it — or null when it still will be.
 *
 * Every branch says only what this screen actually holds. A cancelled contact on an ENDED plan is
 * explained by the ending, which the record does carry; a cancelled contact on a plan still running
 * is not, and says so rather than inventing a cause. Neither claims a remedy that does not exist:
 * suppression by absorption is the one reversible case here, and it is the only one offered.
 */
export function notSentExplanation(
  entry: StoredContact,
  plan: PlanRecord,
): { because: string; changedBy: string } | null {
  if (contactSendability(entry.contact.state) !== "willNotBeSent") return null;

  // Only a plan still running has "messages that remain". An ended plan sends nothing further, and
  // saying it continues would tell a coordinator the opposite of what the record holds.
  const finalAndNeverResent = isTerminalOutcome(plan.outcome)
    ? "Nothing here. This message is final and is never sent later, and this plan has ended, so it sends no further messages."
    : "Nothing here. This message is final and is never sent later; the plan continues with the messages that remain.";

  if (entry.contact.state === "suppressed") {
    return entry.planned.suppressed?.reason === "absorbedByFirstContact"
      ? {
          because:
            "This message falls on the same calendar day as this plan's first contact, and two caring contacts must never land on one day, so the schedule kept one of them.",
          changedBy: isTerminalOutcome(plan.outcome)
            ? "Nothing here. This plan has ended, so its first-contact date can no longer be changed and it sends no further messages."
            : "Choosing a different first-contact date for this plan puts this message back into the schedule.",
        }
      : {
          because: "The system marked this message suppressed, and this screen does not hold what caused that.",
          changedBy: finalAndNeverResent,
        };
  }

  if (entry.contact.state === "cancelled") {
    return {
      because: isTerminalOutcome(plan.outcome)
        ? `This plan ended (${PLAN_OUTCOME_LABELS[plan.outcome].toLowerCase()}), and the system cancelled every message that had not already gone out.`
        : // DEFENSIVE, and unreachable through any store write today (established in Task 6's
          // review). Every `{ type: "cancel" }` in the domain travels with a plan transition to
          // `cancelled` or `withdrawn`, and `applyDeathCorrection` deliberately leaves the plan
          // cancelled when it undoes one — so a cancelled contact on a plan still in progress has
          // no path that produces it. The branch stays because the alternative is asserting a
          // combination the types permit, and this wording is what the screen should say if a
          // future write ever creates one. Do not go hunting for the path: there isn't one.
          "The system cancelled this message, and this screen does not hold what caused that.",
      changedBy: finalAndNeverResent,
    };
  }

  return {
    because:
      "The window for sending this message closed without the message going out, so the system recorded it as missed.",
    changedBy: finalAndNeverResent,
  };
}

/** Whether the plan has ended. `"inProgress"` is the one outcome that is not an ending. */
export function isTerminalOutcome(outcome: PlanOutcome): boolean {
  return outcome !== "inProgress";
}
