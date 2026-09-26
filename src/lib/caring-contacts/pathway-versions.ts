// src/lib/caring-contacts/pathway-versions.ts
//
// The lifecycle of a pathway version: the governed message content a patient actually receives
// (spec §4.2). A version moves draft -> inReview -> approved -> retired. Publication and
// retirement are recorded facts on an already-approved version, not states of their own.
//
// Two properties this module exists to guarantee:
//
//   1. Two approvals must mean two different people. The same role recording twice, or the same
//      actor recording under both roles, is refused -- exactly the pairing that
//      `applyServiceRestartApproval` in ./service-state guards for its own three-role approval,
//      and the reason names are deliberately distinct from that module's so a caller can never
//      confuse which lifecycle refused it. The author-approving-their-own-version rule is a
//      separate concern with its own home in ./permissions (`canApproveOwnAuthoredVersion`); this
//      module delegates to it rather than re-implementing a second self-approval check.
//
//   2. The snapshot never moves. `snapshot` is frozen where the caller constructs the version and
//      no transition here spreads into it or replaces it -- every transition below returns
//      `{ ...version, ... }` with `snapshot` untouched, so a plan already running against a
//      version keeps the exact wording it was activated with even after that version is retired.
//
// This is a pure transition module. It reads no ambient time (the caller injects a `Clock`),
// touches no storage, and performs no permission check beyond the self-approval delegation --
// the caller has already asked `canPerformCaringContactAction` for `approvePathwayVersion`,
// `publishPathwayVersion`, or `retirePathwayVersion`. Recording the transition in the audit trail
// is likewise the caller's job; see ./audit.
import { awstIsoTimestamp, type Clock } from "./clock";
import type { ActorId, PathwayVersionId, TeamId } from "./ids";
import type { MessageType, PathwayVersionState, TransitionResult } from "./model";
import { canApproveOwnAuthoredVersion } from "./permissions";

export type PathwayApprovalRole = "clinicalProgrammeLead" | "livedExperienceRepresentative";

export type PathwayApproval = {
  role: PathwayApprovalRole;
  actorId: ActorId;
  /** AWST ISO-8601 instant with an explicit `+08:00` offset -- the same form ./audit records. */
  approvedAt: string;
};

export type PathwayRetirementUrgency = "routine" | "urgentSafety";

export type PathwayVersion = {
  id: PathwayVersionId;
  teamId: TeamId;
  state: PathwayVersionState;
  authorId: ActorId;
  approvals: readonly PathwayApproval[];
  publishedAt: string | null;
  retiredAt: string | null;
  retirementUrgency: PathwayRetirementUrgency | null;
  snapshot: PathwayVersionSnapshot;
};

/**
 * The governed message content itself, frozen at construction. No transition in this module ever
 * replaces or mutates this object -- see the module-level note above.
 */
export type PathwayVersionSnapshot = Readonly<{
  cadenceLabels: readonly string[];
  messageTextByType: Readonly<Record<MessageType, string>>;
  /**
   * Present only on a version whose approvals were not given by people (Ruling [126], round 1 I2).
   *
   * WHY THE RECORD CARRIES THIS RATHER THAN THE SCREEN INFERRING IT. A version's approvals are
   * rendered in plain words -- "Approved by the clinical programme lead and the lived-experience
   * representative" -- and that sentence is a claim about provenance. A demonstration population
   * produces a version whose approvals are structurally real (the transition below refused
   * anything else) and whose governance is invented, and nothing in the resulting record
   * distinguished the two. A screen cannot be asked to recognise a seed; the record has to say so.
   *
   * WHY IN THE SNAPSHOT. `savePathwayVersion` rebuilds every governance field server-side whatever
   * the caller sends -- deliberately, so a version cannot arrive pre-approved -- and copies the
   * snapshot verbatim. The snapshot is therefore the only channel an author may state anything
   * through, and the only claim this field can make is a WEAKENING one: it can say an approval is
   * synthetic, never that one is genuine. Absence asserts nothing.
   */
  provenance?: PathwayVersionProvenance;
}>;

/**
 * What a version's provenance may say. One member today, and a union rather than a boolean so a
 * second kind (a training copy, say) is added here rather than by overloading a flag.
 */
export type PathwayVersionProvenance = "syntheticDemonstration";

/**
 * Plain words for each provenance, beside the values they name -- the same reason
 * `PATHWAY_APPROVAL_ROLE_WORDING` below lives here rather than in the component that renders it,
 * and the same reason it must: the interface-vocabulary scan refuses `lead` as a whole word in a
 * component, and this sentence sits directly beneath one that contains it.
 *
 * It says the approvals are invented. It does NOT say the pathway is invalid or unusable, because
 * a demonstration that cannot show a governed pathway shows nothing.
 */
export const PATHWAY_VERSION_PROVENANCE_WORDING: Readonly<Record<PathwayVersionProvenance, string>> = Object.freeze({
  syntheticDemonstration:
    "Invented for demonstration: no person recorded either approval, and this version was never reviewed.",
});

/**
 * The words a screen shows for a stored provenance, or `null` when the record claims nothing.
 *
 * WHY THIS IS A FUNCTION AND NOT A LOOKUP AT THE CALL SITE. The call site's obvious spelling is
 * `provenance === undefined ? null : PATHWAY_VERSION_PROVENANCE_WORDING[provenance]`, and it fails
 * in the UNSAFE direction. `provenance` is typed, but the Postgres store reads the snapshot back
 * with an unchecked `as` cast, so an unrecognised string reaches this code with the type saying it
 * cannot. The lookup then yields `undefined` -- not `null` -- and a caller testing `=== null` sees
 * false, renders an empty qualifier, and leaves "Approved by ..." standing with nothing beside it.
 * The one value that must never lose its qualifier would be the one that did.
 *
 * So the fallback is structural rather than a second equality check anybody could forget:
 *
 *   * absent -- `undefined` or `null` -- returns `null`. Nothing is claimed, which is the honest
 *     answer for a version whose record says nothing about where its approvals came from;
 *   * a RECOGNISED value returns its own wording;
 *   * anything else returns the synthetic wording. An unrecognised provenance is a record making a
 *     claim this build does not understand, and the safe reading of "I do not know what this says"
 *     is not "it says nothing". Every value this field can hold is a WEAKENING claim -- that is the
 *     invariant `PathwayVersionSnapshot.provenance` is documented with -- so failing toward the
 *     weakening one keeps the invariant true for values that do not exist yet.
 *
 * `Object.hasOwn` rather than a truthiness test on the lookup, for the reason `permissions.ts`
 * records at length: this is a frozen object literal, so `PATHWAY_VERSION_PROVENANCE_WORDING`
 * inherits `constructor`, `toString` and the rest from `Object.prototype`, and a provenance string
 * of `"constructor"` would otherwise resolve to a function and be rendered.
 */
export function pathwayVersionProvenanceWording(provenance: string | null | undefined): string | null {
  if (provenance === undefined || provenance === null) return null;
  return Object.hasOwn(PATHWAY_VERSION_PROVENANCE_WORDING, provenance)
    ? PATHWAY_VERSION_PROVENANCE_WORDING[provenance as PathwayVersionProvenance]
    : PATHWAY_VERSION_PROVENANCE_WORDING.syntheticDemonstration;
}

export type PathwayVersionAction =
  | { type: "submitForReview" }
  | { type: "approve"; role: PathwayApprovalRole; actorId: ActorId }
  | { type: "publish"; actorId: ActorId }
  | { type: "retire"; urgency: PathwayRetirementUrgency };

/**
 * Both roles must be recorded, by two different people, before a version is approved. Shortening
 * this list -- or letting one person cover both entries -- converts a dual-approval governance
 * decision into one person's call, which is the specific failure this module exists to prevent.
 */
/**
 * Plain words for the two approval seats, for a screen stating a version's governance provenance.
 *
 * Here rather than in the component that renders it, for the reasons `permissions.ts`'s
 * `CARING_CONTACT_ROLE_WORDING` records in full: the wording belongs beside the roles it names, and
 * the interface-vocabulary scan refuses `lead` as a whole word in a component with no exemption for
 * job titles.
 */
export const PATHWAY_APPROVAL_ROLE_WORDING: Readonly<Record<PathwayApprovalRole, string>> = Object.freeze({
  clinicalProgrammeLead: "the clinical programme lead",
  livedExperienceRepresentative: "the lived-experience representative",
});

export const REQUIRED_PATHWAY_APPROVAL_ROLES: readonly PathwayApprovalRole[] = Object.freeze([
  "clinicalProgrammeLead",
  "livedExperienceRepresentative",
]);

/**
 * Applies one lifecycle action to a pathway version.
 *
 * Refusals:
 *   * `pathway-not-draft` -- `submitForReview` is only legal from `draft`.
 *   * `pathway-not-in-review` -- `approve` is only legal from `inReview`.
 *   * `self-approval-denied` -- the author may never approve their own version. Delegated to
 *     `canApproveOwnAuthoredVersion` unchanged; see the module-level note.
 *   * `pathway-approval-role-already-recorded` -- that role has already spoken; a second holder
 *     of the same role does not add a second independent check.
 *   * `pathway-approval-actor-already-recorded` -- this person has already approved in some role.
 *     Without this check, one person could supply both approvals by changing role.
 *   * `pathway-not-approved` -- `publish` is only legal from `approved`.
 *   * `pathway-not-retirable` -- `retire` is only legal from `approved`.
 *
 * A version becomes `approved` only on the approval that completes both
 * `REQUIRED_PATHWAY_APPROVAL_ROLES`; one approval leaves it `inReview`.
 */
export function applyPathwayVersionTransition(
  version: PathwayVersion,
  action: PathwayVersionAction,
  clock: Clock,
): TransitionResult<PathwayVersion> {
  switch (action.type) {
    case "submitForReview": {
      if (version.state !== "draft") return { ok: false, reason: "pathway-not-draft" };
      return { ok: true, value: { ...version, state: "inReview" } };
    }

    case "approve": {
      if (version.state !== "inReview") return { ok: false, reason: "pathway-not-in-review" };

      const selfApproval = canApproveOwnAuthoredVersion(version.authorId, action.actorId);
      if (!selfApproval.allowed) return { ok: false, reason: selfApproval.reason };

      if (version.approvals.some((approval) => approval.role === action.role)) {
        return { ok: false, reason: "pathway-approval-role-already-recorded" };
      }
      if (version.approvals.some((approval) => approval.actorId === action.actorId)) {
        return { ok: false, reason: "pathway-approval-actor-already-recorded" };
      }

      const approvals: readonly PathwayApproval[] = Object.freeze([
        ...version.approvals,
        Object.freeze({ role: action.role, actorId: action.actorId, approvedAt: awstIsoTimestamp(clock.now()) }),
      ]);

      const everyRequiredRoleApproved = REQUIRED_PATHWAY_APPROVAL_ROLES.every((role) =>
        approvals.some((approval) => approval.role === role),
      );

      return {
        ok: true,
        value: { ...version, approvals, state: everyRequiredRoleApproved ? "approved" : "inReview" },
      };
    }

    case "publish": {
      if (version.state !== "approved") return { ok: false, reason: "pathway-not-approved" };
      return { ok: true, value: { ...version, publishedAt: awstIsoTimestamp(clock.now()) } };
    }

    case "retire": {
      if (version.state !== "approved") return { ok: false, reason: "pathway-not-retirable" };
      return {
        ok: true,
        value: {
          ...version,
          state: "retired",
          retiredAt: awstIsoTimestamp(clock.now()),
          retirementUrgency: action.urgency,
        },
      };
    }
  }
}

/**
 * True only for a retired version whose retirement urgency was `urgentSafety`. A routine
 * retirement stops new activations from this version and leaves plans already running against
 * its snapshot alone -- it does not pause them. Only an urgent-safety retirement pauses future
 * contacts on plans already activated for explicit review.
 */
export function retirementPausesFutureContacts(version: PathwayVersion): boolean {
  return version.state === "retired" && version.retirementUrgency === "urgentSafety";
}
