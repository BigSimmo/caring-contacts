// src/lib/caring-contacts/episode.ts
//
// The one episode shape in this domain.
//
// These types were introduced in Task 8 inside the de-identification policy module, because no
// episode concept existed yet. Task 9's store needs the same shape to project an episode from what
// it holds, and the Task 8 sibling guard requires that no other module in this directory name that
// policy module at all — so importing the types from it was not open to the store. They live here
// instead: one declaration, imported by both, re-exported unchanged by the policy module so every
// existing import path still resolves. This is a relocation, not a second shape; there is no
// competing episode type anywhere in this directory.
import type { PathwayVersionId, TeamId } from "./ids";

export type EpisodeState = "draft" | "active" | "paused" | "withdrawn" | "cancelled" | "completed";

export type EpisodeCounts = {
  contactsScheduled: number;
  contactsSent: number;
  contactsDelivered: number;
};

export type EpisodePlanDates = {
  dischargeAt: Date;
  /** The instant the episode reached its terminal state; null while it is still open. */
  completedAt: Date | null;
};

export type Episode = {
  state: EpisodeState;
  patientName: string;
  patientMobileNumber: string;
  patientIdentifiers: readonly string[];
  culturalIdentity: string | null;
  /**
   * What this patient asked to be called in the messages they receive, or null when no preferred
   * name is held for this episode.
   *
   * IT IS ASKED FOR, NEVER DERIVED FROM `patientName` (owner decision, 2026-08-26). That field is
   * one free-text box, and splitting it greets a person with one name by their only name, a person
   * whose family name is written first by their surname, `Mr John Smith` as "Mr", and someone with
   * two given names by half of them. Nothing in this domain parses a name, and nothing should.
   *
   * THREE VALUES, THREE DIFFERENT FACTS, AND THEY MUST STAY DISTINGUISHABLE. A non-empty string is
   * a name a clinician recorded. `null` is "no preferred name is held" -- an episode that predates
   * the field, or one a caller created without supplying one. `""` is what the clearance that
   * de-identifies an ended episode writes, exactly as it does for `patientName`, so an episode whose
   * name has been REMOVED is not mistaken for one that never had it. A surface rendering this says
   * which of those it is looking at, or says only that no preferred name is held; it never invents
   * a cause for the absence.
   */
  preferredName: string | null;
  /**
   * Why this episode's first contact was moved off the programme's usual day, or null when no
   * reason is held for it.
   *
   * It sits among the identifying fields rather than beside the plan dates because of what it
   * CONTAINS, not what it describes: it is prose a clinician typed about this patient, and a real
   * one names relatives, places and living arrangements. So it is released by the one read that
   * releases a name, and removed by the one write that removes one. `DeidentifiedEpisode` below
   * does not carry it, which is what makes a de-identified episode free of it.
   *
   * Null carries no single cause and must never be rendered as one. The date may never have been
   * moved, the plan may predate the field existing, or the clearance that de-identifies an ended
   * episode may have removed it; a surface that can tell those apart says which, and one that
   * cannot says only that no reason is held.
   */
  firstContactReason: string | null;
  /**
   * The short reason recorded with a withdrawal, or null when none is held (owner-approved
   * 2026-09-26: optional, so a withdrawal is never held up for want of one).
   *
   * Among the identifying fields for the same reason as `firstContactReason`: it is prose a
   * clinician typed about this patient, so it is released only by the read that releases a name
   * and removed by the clearance that removes one. Null means no reason is held -- none was given,
   * the plan was not withdrawn, or a clearance removed it -- and must never be rendered as a cause.
   */
  withdrawalReason: string | null;
  /**
   * The instant a clearance removed this episode's identifying detail, or null when none has been
   * recorded against it.
   *
   * IT EXISTS BECAUSE THE FACT WAS BEING INFERRED FROM AN EMPTY STRING (#J7PZQP, 2026-09-02). The
   * patient overview decided that a clearance had removed this episode's detail from
   * `patientName === ""`, and said so to a clinician in as many words: that a first-contact reason
   * was given, that a clearance has since removed it, and that a clearance is not reversible. The
   * only thing holding that up was `z.string().min(1)` in the plans API route. Neither store's
   * `createPlan` validates a non-blank name, and the stored column is `not null` with no CHECK
   * against the empty string, so `''` is a legal value that means two different things at once. A
   * plan that reached a store with a blank name made that screen state all three of those things
   * falsely, about a live record.
   *
   * THIS DOES NOT OVERTURN THE `''`-AS-CLEARED CONVENTION, which is correct wherever a non-blank
   * write is actually enforced -- the migration that added `first_contact_reason` says exactly
   * that of it: cleared to the empty string by a write no ordinary caller can produce. For
   * `patientName` that precondition was never established, so the sentinel carried two meanings.
   * This carries the fact directly instead of deducing it from the absence of another.
   *
   * NAMED FOR WHAT WAS CLEARED, NOT FOR THE POLICY THAT ORDERED IT. Ruling 26 keeps the policy's
   * own vocabulary inside the storage layer, and this module is deliberately the shape a store can
   * project WITHOUT importing that policy (see the header above). What an episode holds is that
   * its patient detail was cleared, and when; why it was due is the policy module's question.
   *
   * `Date | null`, never optional. Three-valued absence -- a value, null, or the property missing
   * altogether -- is the shape that produced this class of bug in the first place; see
   * `preferredName` above. Two values, one meaning each.
   *
   * NOT ON `DeidentifiedEpisode`. That type is built by construction from a named field list, so a
   * field added here is absent from a de-identified episode without the builder being touched --
   * the same mechanism that made `preferredName` correct on arrival.
   */
  patientDetailClearedAt: Date | null;
  planDates: EpisodePlanDates;
  pathwayVersionId: PathwayVersionId;
  teamId: TeamId;
  outcome: string;
  counts: EpisodeCounts;
};

export type DeidentifiedEpisode = {
  state: EpisodeState;
  planDates: EpisodePlanDates;
  pathwayVersionId: PathwayVersionId;
  teamId: TeamId;
  outcome: string;
  counts: EpisodeCounts;
};

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
