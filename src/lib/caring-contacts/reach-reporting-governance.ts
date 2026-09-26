// src/lib/caring-contacts/reach-reporting-governance.ts
//
// The governance decisions that parameterise programme-reach reporting (spec §2.5).
//
// WHY THIS FILE EXISTS AT ALL, rather than a number in `reach-reporting.ts`.
// -------------------------------------------------------------------------
// A small-cell threshold is a DISCLOSURE CONTROL. Setting one decides, for every future report,
// which figures about Aboriginal and Torres Strait Islander patients may be published and which may
// not. That is a decision with an author and a date, and a bare integer in the body of a module has
// neither: a later reader cannot tell a value somebody decided from a value somebody typed. Nor can
// they tell what it rests on. So the value lives here, in a record whose whole subject is the
// decision, in a file a governance change would naturally open.
//
// This is the file to edit when the threshold changes. It is deliberately the ONLY place the number
// appears -- `reachReportingThreshold()` in ./reach-reporting reads it, the reach section renders it
// from here, and nothing restates it.
//
// WHAT A CHANGE TO IT SHOULD REQUIRE, and what actually enforces that today.
// -------------------------------------------------------------------------
// Today, exactly one thing enforces deliberateness: `tests/caring-contacts-reporting.test.ts` pins
// the value AND the provenance fields beside it, so an edit that moves the number without moving
// the record that explains it turns the suite red. That makes the change visible and reviewable; it
// does not make it authorised -- one commit can edit both the value and the pin.
//
// THAT GAP IS ACCEPTED, NOT OUTSTANDING. The owner ruled on 2026-08-26 that a provenance pin is
// proportionate for a prototype holding no real data, and that a second-approver mechanism is a
// governance decision nobody has been asked for. It is still a gap: what would close it -- a second
// approver, and a superseding record rather than an in-place edit -- is written down in
// `docs/caring-contacts/phase-2b-sdd-archive/task-19-report.md` §1 so that whoever operationalises
// this finds it rather than re-deriving it. Do not weaken the pin to make an edit easier: with the
// stronger mechanisms deliberately not built, the pin IS the deliberateness.

/**
 * One governance decision, with what it rests on.
 *
 * `basis` and `restsOn` are separate fields on purpose, and the second is the unusual one: a
 * number presented as derived when it was chosen decays the same way a restated count does. A later
 * reader who assumes this threshold came out of a calculation over this dataset would over-trust it
 * -- and might, for instance, decline to revisit it because "the analysis said 5".
 */
export type ReachReportingGovernanceDecision = {
  /** The minimum cell size below which a figure is withheld rather than shown. */
  readonly smallCellThreshold: number;
  /** Who took the decision, in plain words. */
  readonly decidedBy: string;
  /** The AWST calendar day it was taken. */
  readonly decidedOn: string;
  /** What the value was chosen by. */
  readonly basis: string;
  /** What it does NOT rest on. Stated, because the absence is not visible from the number. */
  readonly restsOn: string;
  /** Whether it is settled, and on what terms. */
  readonly revisit: string;
};

/**
 * The owner's decision of 2026-08-26.
 *
 * Frozen so nothing can move it at runtime: a disclosure control that a request could mutate would
 * be no control at all.
 */
export const REACH_REPORTING_GOVERNANCE: ReachReportingGovernanceDecision = Object.freeze({
  smallCellThreshold: 5,
  decidedBy: "the service owner",
  decidedOn: "2026-08-26",
  basis: "common practice for small-cell suppression, by analogy",
  restsOn:
    "No calculation over this programme's own data. Nothing has been counted, and this number is not an output of anything.",
  revisit: "Explicitly open to revision; taken to unblock reporting, not to settle the question.",
});
