// src/components/caring-contacts/workspace/plan-wizard/wizard-wording.ts
//
// Plain-words helpers the wizard's stages share: refusal headings, unavailable reasons and identity facts.
// Split out of `plan-wizard.tsx` unchanged. No "use client": it runs on the client through the wizard,
// and `tests/caring-contacts-explained-automation.dom.test.tsx` follows the wizard's imports into it.
import type { ReferralIntakePayload } from "@/lib/caring-contacts/referral-intake";

import { awstDateWording } from "../date-wording";
import { overlayDefinition } from "../overlays/definitions";
import { TRANSPORT_REFUSALS } from "./plan-activation";

/**
 * Which decision was refused, named from the frozen table rather than from a sentence written here.
 *
 * `overlayDefinition(...).label` is the row's own words, so a label edited in the matrix travels
 * here without anyone remembering to. An id no row carries throws, on the same policy
 * `WorkspaceOverlayTrigger` and `blockReasonWording` already follow: a refusal attributed to a
 * decision nobody can find is worse than an error page that says nothing was changed.
 */
export function decisionRefusalHeading(overlayId: string): string {
  const definition = overlayDefinition(overlayId);
  if (definition === null) {
    throw new Error(
      `No overlay is defined for the id "${overlayId}", so a refusal cannot be attributed to it. ` +
        `The 24 rows are frozen in overlays/definitions.ts.`,
    );
  }
  return `${definition.label} was not carried out`;
}

/**
 * Stage 4 — the whole plan read back, and the control that creates it.
 *
 * THE ONLY STAGE THAT WRITES, AND THE FIRST SCREEN IN THIS WORKSPACE THAT CREATES ANYTHING.
 * Everything before it reads. That single fact is why most of this component is about failure
 * rather than success: each of Ruling [117]'s three orderings is SILENT when it is reversed, and
 * what a reversal costs is either a clinician's typing or a patient's mobile number left on a ward
 * machine after the tab looked finished.
 *
 * WHAT IT COLLECTS, AND WHY THOSE TWO CONTROLS ARE ADJACENT (Rulings [118] and [121]). The
 * discharge day is collected here because `createPlanSchema` requires `dischargeAt` and nothing in
 * this domain carries one — the fourth value in this wizard whose approved design shows it arriving
 * from a hospital record this system is not connected to. The first-contact day is defined ENTIRELY
 * relative to it, so the two sit together: a date control anchored on a day nobody has entered means
 * nothing, and the relationship has to be visible at the moment both are chosen.
 *
 * WHAT IT DERIVES (Ruling [119]). Every count comes from the schedule the domain builds for the
 * dates on screen. The mockup's `"10-contact schedule"` heading is a literal and it is wrong: ten
 * ENTRIES, the last of which is a closing message rather than one more caring contact, and only nine
 * are sent when the first contact falls on discharge + 7. Moving the date is the system about to
 * remove a message from a suicide-prevention schedule, so §4.4 requires that stated IN PLACE, before
 * the choice is committed — which is why the preview is live rather than shown after the write.
 *
 * WHAT IT CLAIMS, AND WHAT IT STILL REFUSES TO (Ruling [119], then Ruling [122]). The mockup renders
 * `Agreement confirmed: Yes` as a stored fact. When this screen was built it was not stored at all,
 * and the copy said so. Task 9b closed that: the plan now records an attestation for each
 * confirmation — who confirmed, what, when — so "not recorded on the plan" would be the false
 * sentence here today. That is exactly why the earlier wording stated a fact of the day rather than
 * a permanent property; it took one edit to make true again instead of a hunt.
 *
 * What the screen still refuses to claim is the mockup's actual assertion. `Agreement confirmed:
 * Yes` reads as the patient's agreement being a fact this plan holds. It is not. What the plan holds
 * is that a coordinator confirmed they checked it, and this is the last surface before the plan
 * exists — so it names the act and its actor, never the patient's state.
 *
 * WHAT CONFIRMING ACTUALLY DOES, said in place rather than implied by a verb. It performs TWO
 * writes (Ruling [123]): `POST /api/caring-contacts/plans` creates the plan, its patient detail and
 * its whole twelve-month schedule, and `POST /api/caring-contacts/plans/<id>` with
 * `action: "activate"` then starts it. The wizard IS the activation workflow — the frozen overlay
 * it opens is titled "Last check before the plan starts" — so a screen that created a draft nothing
 * here could start would be doing half of what its own decision surface promises.
 *
 * An earlier version of this comment said the opposite, and the copy beneath it said it to the
 * clinician. That is the `stages.ts` defect this task found and fixed — a comment describing a
 * mechanism the code no longer has — reappearing two functions away in the same file. Finding the
 * class did not stop me writing another instance of it. The wording below is now pinned by tests
 * for exactly that reason: prose nothing asserts on is prose that survives the code changing.
 */
/**
 * What the identity check compares, from the referral as it was received: the name and hospital
 * record number recorded at intake, and the hospital and discharge date that place the admission.
 * This workspace holds no date of birth, so none is shown. A referral saved without an intake record
 * holds only its synthetic patient identifier, and the check says so rather than showing blanks.
 */
export function identityFacts({
  patientId,
  intake,
}: {
  patientId: string;
  intake: ReferralIntakePayload | null;
}): { label: string; value: string }[] {
  if (intake === null) {
    return [
      { label: "Name", value: "Not held on this referral" },
      { label: "Synthetic patient identifier", value: patientId },
    ];
  }
  const name = `${intake.givenName} ${intake.familyName}`.trim();
  return [
    { label: "Name", value: name === "" ? "Not held on this referral" : name },
    { label: "Record number", value: intake.patientIdentifier.trim() || patientId },
    { label: "Hospital", value: intake.hospitalFacility.trim() || "Not held on this referral" },
    {
      label: "Discharged",
      value: intake.dischargeDate.trim() ? awstDateWording(intake.dischargeDate) : "Not held on this referral",
    },
  ];
}

/**
 * The refusal name in a body the API refused with, or a named stand-in.
 *
 * `handler.ts` answers every refusal with `{ refusal: string }` and nothing else -- no patient data
 * ever travels in one. Anything else arriving here is an answer this screen did not expect, and it
 * is named as that rather than guessed at: `submissionRefusalWording` is total, so an unrecognised
 * name is still explained and still says the draft survived.
 */
export function refusalNameFrom(payload: unknown): string {
  if (typeof payload === "object" && payload !== null && "refusal" in payload) {
    const named = (payload as { refusal: unknown }).refusal;
    if (typeof named === "string" && named !== "") return named;
  }
  return TRANSPORT_REFUSALS.unreadableAnswer;
}
