// src/lib/caring-contacts/assurances.ts
//
// What a coordinator confirms at the start of a sign-up, and what the plan then records about that
// confirmation.
//
// WHAT THIS IS: AN ATTESTATION THAT A CHECK HAPPENED. Read this paragraph before adding anything
// below it. A stored attestation says WHO confirmed, WHAT they confirmed and WHEN -- and nothing
// else. It is a record of an act a clinician performed, in the same class as an audit event.
//
// WHAT THIS IS NOT: A CONSENT RECORD. This system is not where consent lives. The approved design
// sources the agreement row as "Imported source record--not legal or treatment consent": the
// hospital record holds whatever the patient agreed to, and the coordinator is confirming they
// checked it. So an attestation here can support "a coordinator confirmed the patient's agreement
// before this plan was created" and CANNOT support "the patient consented". A reader who mistakes
// one for the other will draw conclusions this domain cannot back, which is why the distinction is
// carried by the names and not only by this comment.
//
// WHY THIS MODULE EXISTS AT ALL, RATHER THAN THE VOCABULARY LIVING ON ../repository. The plan
// wizard is a Client Component and its whole module graph is scanned by
// `tests/caring-contacts-explained-automation.dom.test.tsx` for any path that reaches the
// service-state module, whose incident record carries a free-text note that must never cross that
// boundary. `repository.ts` names service-state in its own imports, so the wizard cannot import
// from it -- and the wizard is exactly where the confirmations are collected. A leaf module with
// one dependency (`./ids`, for the branded actor id) is reachable from the screen, from the route's
// request schema and from both stores, so all four name ONE closed list rather than three copies.
import type { ActorId } from "./ids";

/**
 * The closed set of things a coordinator may attest to having confirmed.
 *
 * A LIST RATHER THAN A FIXED PAIR (Ruling [122]). Stage 1's assurance set is not frozen -- the
 * approved design shows five rows, of which some are confirmations and the rest are display -- so a
 * pair of booleans would need a schema change, a migration and a request-shape change the first
 * time a third confirmation is added. Adding one here is a value in this map, a value in the
 * migration's check constraint, and a checkbox.
 *
 * The wire values are kebab-case and the keys camelCase, matching `REPOSITORY_REFUSALS`: the value
 * is what reaches a database column and an HTTP body, so it is written out rather than derived from
 * the key.
 *
 * BOTH VALUES NAME THE ACT, NOT A PATIENT STATE. "patient-agreement-confirmed" is a coordinator
 * saying they confirmed the agreement; it is not the agreement, and nothing downstream may render
 * it as one.
 */
export const PLAN_ASSURANCES = Object.freeze({
  /** A coordinator confirmed the patient agreed to receive caring contacts. Not consent to treatment, and not legal consent. */
  patientAgreementConfirmed: "patient-agreement-confirmed",
  /** A coordinator confirmed the mobile number this plan will use is the patient's own. */
  patientControlsMobileConfirmed: "patient-controls-mobile-confirmed",
} as const);

export type PlanAssurance = (typeof PLAN_ASSURANCES)[keyof typeof PLAN_ASSURANCES];

/** Every assurance value, in declaration order. The one source a schema or a check constraint reads. */
export const PLAN_ASSURANCE_VALUES: readonly PlanAssurance[] = Object.freeze(Object.values(PLAN_ASSURANCES));

/**
 * One recorded attestation: who confirmed, what they confirmed, when.
 *
 * `attestedAt` is the field Ruling [122] calls `instant`; it is named for the codebase's own
 * convention (`claimedAt`, `clearedAt`, `startedAt`) rather than for the ruling's prose, and it is
 * the same value.
 *
 * `actorId` and `attestedAt` are stamped BY THE STORE, from the write context and the domain clock.
 * A caller supplies only which assurances it confirmed -- see `CreatePlanInput.assurances`. That is
 * not a detail: a caller-supplied actor or instant would let a request claim someone else made the
 * check, or claim it was made at a time it was not, and the whole value of this record is that it
 * says who and when.
 */
export type PlanAssuranceAttestation = {
  assurance: PlanAssurance;
  actorId: ActorId;
  attestedAt: Date;
};

/**
 * Pins the attestation to exactly the act, its actor and its instant.
 *
 * A GUARD RATHER THAN A COMMENT, and it is the specific guard Ruling [122] asks for. The ruling's
 * "cost if wrong" is a fourth field carrying FREE TEXT -- a note on what was checked -- because
 * such a note would name patients, relatives and places -- and the de-identification rule recorded
 * beside `CLEARED_PATIENT_DETAIL` in ../repository, which deliberately leaves an attestation alone,
 * would have to flip for that one field. This line stops compiling when a fourth field is added,
 * which is what makes the question reachable instead of inherited: whoever adds it has to come here,
 * read the paragraph, and take the decision to the owner rather than discover it later.
 *
 * A committed guard holds the clearance period to exactly one module in this directory, and a
 * vocabulary leaf is not it -- which is why the rule above is named by the constant it lives beside
 * rather than by the obvious word.
 */
type SameUnion<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const PLAN_ASSURANCE_ATTESTATION_HOLDS_ONLY_ACT_ACTOR_AND_INSTANT: SameUnion<
  keyof PlanAssuranceAttestation,
  "assurance" | "actorId" | "attestedAt"
> = true;

/** True only while `value` is one of the closed assurance values. */
export function isPlanAssurance(value: unknown): value is PlanAssurance {
  return typeof value === "string" && (PLAN_ASSURANCE_VALUES as readonly string[]).includes(value);
}

/**
 * The plain words a screen reads an attestation back in.
 *
 * WHY IT LIVES HERE RATHER THAN ON THE SCREEN THAT RENDERS IT. `PLAN_ASSURANCES` above holds wire
 * values -- `patient-agreement-confirmed` is a database column value and an HTTP body field, not a
 * sentence -- and Ruling [61]'s rule is the one that applies: a screen may neither invent copy for
 * an identifier nor derive copy from it, because a derived "Patient agreement confirmed" is a
 * plausible-looking sentence nobody wrote and nobody reviewed. `STOP_REASON_WORDING` in
 * ../service-state and `CARING_CONTACT_ROLE_WORDING` in ../permissions are the same pattern in the
 * same directory: the words live beside the closed vocabulary they name.
 *
 * WHAT EACH SENTENCE IS CAREFUL TO SAY, AND IT IS THE WHOLE POINT OF THE FILE. Each reads as an act
 * a clinician performed -- "that the patient had agreed", never "the patient agreed". The
 * attestation is evidence that a check happened; the agreement itself is held in the patient's
 * hospital record and not here. A wording that dropped the reported-speech frame would turn this
 * module into the consent record the header spends a paragraph saying it is not.
 *
 * Each is written to complete "A coordinator confirmed ...", so a screen states the act once and
 * does not have to repeat it per row.
 */
export const PLAN_ASSURANCE_WORDING: Readonly<Record<PlanAssurance, string>> = Object.freeze({
  [PLAN_ASSURANCES.patientAgreementConfirmed]: "that the patient had agreed to receive caring contacts",
  [PLAN_ASSURANCES.patientControlsMobileConfirmed]: "that the mobile number this plan uses is the patient's own",
});

/**
 * Throws, deliberately and in every environment, on an assurance with no wording.
 *
 * `Object.hasOwn`, not `map[value] === undefined`, and the reason is the defect `blockReasonWording`
 * in the overlay host already paid for: an object literal inherits from `Object.prototype`, so
 * `PLAN_ASSURANCE_WORDING["toString"]` is a FUNCTION rather than undefined. A `=== undefined` guard
 * waves it through, TypeScript types the result `string`, and React renders a function as nothing --
 * an attestation row with no words in it, no throw and no error boundary. `isPlanAssurance` below
 * means a value read off the wire can reach here.
 *
 * No default branch and no derivation from the identifier: a third assurance must arrive with a
 * sentence somebody wrote, not with one this function guessed.
 */
export function planAssuranceWording(assurance: PlanAssurance): string {
  if (!Object.hasOwn(PLAN_ASSURANCE_WORDING, assurance)) {
    throw new Error(
      `No plain-words wording for the plan assurance "${assurance}". Add an entry to ` +
        `PLAN_ASSURANCE_WORDING deliberately: do not derive it from the identifier and do not add a ` +
        `default branch. It must read as an act a clinician performed, never as a fact about the patient.`,
    );
  }
  return PLAN_ASSURANCE_WORDING[assurance];
}
