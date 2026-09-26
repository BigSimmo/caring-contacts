import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { notFound } from "next/navigation";

import {
  PlanStartStateNotice,
  type PlanStartState,
  type StartableReferral,
} from "@/components/caring-contacts/workspace/plan-wizard/plan-start-state";
import type { PlanWizardPathwayOption } from "@/components/caring-contacts/workspace/plan-wizard/plan-wizard";
import { CARING_CONTACTS_REFERRAL_QUERY_PARAM } from "@/lib/caring-contacts-routes";
import { auditedRead } from "@/lib/caring-contacts-server/handler";
import { isCaringContactsWorkspaceEnabled, resolveCaringContactsActor } from "@/lib/caring-contacts-server/session";
import { caringContactsStore } from "@/lib/caring-contacts-server/store";
import { TERMINAL_PLAN_STATES, type Referral } from "@/lib/caring-contacts/model";
import type { PlanRecord, ReferralIntakePayload } from "@/lib/caring-contacts/repository";
import {
  PATHWAY_APPROVAL_ROLE_WORDING,
  pathwayVersionProvenanceWording,
  type PathwayVersion,
} from "@/lib/caring-contacts/pathway-versions";
// The governed patient-visible wording, resolved HERE and handed to stage 3 as a plain string.
// Same reason as the two below it: a screen may not author or alter patient-visible copy, so it
// reads the sealed domain's own value rather than holding a second copy of it — and resolving it
// on the server keeps `message-copy.ts` and the GSM-7 machinery it imports out of this route's
// client chunk. The wording is changing (the owner has decided it gains a first-name slot); this
// page passes whatever that module exports and the wizard renders what it is handed.
import { EXACT_PATIENT_VISIBLE_MESSAGE } from "@/lib/caring-contacts/message-copy";
import { CARING_CONTACT_ROLE_WORDING, canPerformCaringContactAction } from "@/lib/caring-contacts/permissions";
import { READ_ACTIONS } from "@/lib/caring-contacts/repository";
// Both resolved HERE rather than in the wizard, and for the reason round 1 finding M-2 settled: a
// screen must never re-derive a rule a module owns, and resolving on the server keeps both domain
// modules out of this route's client chunk. The send times are derived from the hours
// `buildApprovedSchedule` really uses; the reserved fictional numbers are the ones this prototype's
// own material uses, which stage 3 states beside the field where a number is entered.
import { SENDING_PREFERENCE_OPTIONS } from "@/lib/caring-contacts/schedule";
import { DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS } from "@/lib/caring-contacts/synthetic-contacts";
import type { ServiceState } from "@/lib/caring-contacts/service-state";

/**
 * The workspace's lazy route boundary (Ruling 13). Same spelling and same reason as
 * `src/app/caring-contacts/page.tsx` and the two patients routes: nothing outside this route
 * segment imports the workspace, and dynamically importing the shell keeps the Client Components
 * beneath it out of the PsychSift dashboard's chunks. See the Today page's module note for the
 * argument in full; one copy of it is the source of truth and two copies would drift.
 */
const CaringContactsShell = dynamic(() =>
  import("@/components/caring-contacts/workspace/shell").then((module) => module.CaringContactsShell),
);

/**
 * The wizard, behind the same lazy boundary, and this one carries the workspace's FIRST deliberate
 * client payload (Ruling [109]).
 *
 * Every other screen here is a Server Component that works with JavaScript turned off. This one
 * cannot be: the owner decided on 2026-08-25 that a half-finished sign-up survives a page refresh,
 * and neither a Server Component nor a URL parameter can hold that. A URL parameter is separately
 * forbidden for this data — `src/app/api/caring-contacts/plans/route.ts` says why in the code, and
 * the patient's name and mobile number arrive at stage 3.
 *
 * The licence is for this route only, and it is the whole reason for the `dynamic()` here: the
 * wizard's chunk is loaded when a clinician opens this screen and never enters another route's.
 */
const PlanWizard = dynamic(() =>
  import("@/components/caring-contacts/workspace/plan-wizard/plan-wizard").then((module) => module.PlanWizard),
);

/** The browser tab reads "New plan · Caring Contacts" through the layout's title template. */
export const metadata: Metadata = { title: "New plan" };

/**
 * Putting a discharged patient onto a caring-contact plan -- the route, the wizard's shell, and
 * stages 1 and 2. Tasks 8 and 9 build stages 3 and 4 against `plan-wizard/stages.ts`.
 *
 * THE PAGE IS THE SERVER HALF, AND IT STAYS THAT WAY
 * -------------------------------------------------
 * The client component is the wizard, not the page. This file does the audited reads, decides what
 * the actor may do, fails closed on every bad outcome, and renders the shell. Nothing it hands the
 * wizard is service state, and nothing is derived from it: `ServiceState` carries a free-text
 * incident `note`, `narrowServiceStateForActor` gates that note behind `viewPatientRecord` on the
 * server surface, and a wizard prop would carry it straight past that gate into a client bundle.
 * That constraint is absolute (Ruling [109]) and this is the screen where it would be easiest to
 * breach, so `tests/caring-contacts-new-plan-page.dom.test.tsx` asserts the props this page builds
 * rather than trusting the reading of it.
 *
 * EVERY READ IS AUDITED, AND NONE OF THEM IS HTTP
 * ----------------------------------------------
 * The same shape the patients directory and the patient overview use, for the same reasons: this
 * is a Server Component and reads the store directly rather than calling this app's own API over
 * HTTP, and EVERY read goes through `auditedRead` with the SAME access identity that read already
 * carries on the API side. What is read here:
 *
 *   * the service state -- `{ administrative, serviceState, "service" }`, because the safety
 *     banner is required on every screen (Ruling 56) and must be a state that was actually read;
 *   * the referrals -- `{ search, patientDirectory, "all" }`, matching
 *     `src/app/api/caring-contacts/referrals/route.ts`'s `GET` exactly. A referral names a patient,
 *     which is why that route records it against the patient directory rather than against a plan
 *     that does not exist yet;
 *   * the pathway versions -- `{ view, pathwayVersion, "all" }`, matching
 *     `src/app/api/caring-contacts/pathway-versions/route.ts`'s `GET` exactly.
 *
 * The pathway versions are read ONLY once the referral has been settled, on the same principle the
 * patient overview reads patient names only in the branch that needs them: a read made for a
 * screen that then says "that referral is not one you can open" is a read that bought nothing and
 * still went on the trail.
 *
 * Every bad outcome fails closed and reaches `error.tsx`, which says nothing was sent and nothing
 * was changed. No read here has an honest fallback: a sign-up screen rendered beside a
 * service-state read that failed would let a clinician start a plan during an incident that had
 * stopped the service, and a pathway chooser rendered from a failed read would offer a choice
 * between versions nobody read.
 *
 * WHAT THE URL MAY CARRY, AND WHAT IT MAY NEVER (Ruling [111])
 * ------------------------------------------------------------
 * `createPlanSchema` requires `referralId`, `patientId` and `pathwayVersionId`, so a plan is
 * created FOR a referral rather than from nothing, and the referral is named in the URL by id.
 * A referral id in a query string is acceptable; a patient's name or mobile number is not, and
 * `plans/route.ts` records the reason in the code -- "a query string is logged by every proxy
 * between here and the browser". Nothing this screen builds puts patient detail in a URL, including
 * as a draft key.
 *
 * The named referral is validated against the referrals this actor could already list, exactly as
 * the patient overview validates `?plan=`. A referral that is not this team's is not an error to
 * explain in detail -- it is simply not one this actor may see, and it gets the same answer as one
 * that does not exist, never a 404 that would tell those two apart.
 *
 * THE CAPABILITY IS DECIDED FROM THE ACTOR, NEVER INFERRED FROM AN EMPTY LIST
 * --------------------------------------------------------------------------
 * `listReferrals` answers an actor without `viewReferral` with `[]`, exactly as it answers a team
 * with no referrals -- deliberately, so nobody can probe for records they may not see. A screen
 * that only counted rows would therefore tell a clinician there is no such referral when the real
 * answer is that their role may not read one. So the two capabilities this screen needs are asked
 * of the actor directly, with certainty, before anything is read with them: `claimPlan`, which is
 * the write this whole flow performs, and `viewReferral`, without which the referral cannot be
 * read at all. Task 5 established this shape and Ruling 92 is why.
 *
 * `searchParams` is a promise in Next 16 and is awaited before use. Reading it makes the route
 * dynamic, which is already true here -- the role cookie does the same -- and is correct: a cached
 * copy of a team's referrals would outlive them.
 */
export default async function CaringContactsNewPlanPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isCaringContactsWorkspaceEnabled()) notFound();
  const actor = await resolveCaringContactsActor();
  const store = await caringContactsStore();
  const requestedReferralId = readRequestedReferralId(await searchParams);

  // "service" names the one service-wide record, matching the object id the API route records
  // against -- the access trail needs one stable identifier for it, not a per-caller one.
  const serviceStateRead = await auditedRead<ServiceState>(
    store,
    actor,
    { kind: "administrative", objectType: "serviceState", objectId: "service" },
    () => store.getServiceState({ actor }),
  );
  if (serviceStateRead.outcome === "failed") {
    throw serviceStateRead.error instanceof Error
      ? serviceStateRead.error
      : new Error("Failed to read the service state.");
  }
  if (!serviceStateRead.recorded) {
    throw new Error("Caring Contacts access trail is unavailable; nothing was rendered.");
  }
  if (serviceStateRead.released === null) {
    throw new Error("caring-contacts service state read returned no record.");
  }
  const serviceState = serviceStateRead.released;

  const body = await resolveBody();

  return (
    <CaringContactsShell
      title="New plan"
      description="Putting a discharged patient onto a caring-contact plan: what this team is working from, which governed pathway the plan runs, the patient's own details, and a last read-through before it starts. Every patient, number and message in this workspace is invented; nothing here is ever sent to a real number."
      serviceState={serviceState}
      showPrimaryControl={false}
    >
      {body}
    </CaringContactsShell>
  );

  async function resolveBody() {
    // Both capabilities, asked of the actor. A role that cannot claim a plan cannot finish this
    // flow, and a role that cannot read a referral cannot start it, so neither is a screen worth
    // walking someone through. Every role that holds one holds the other today; the conjunction is
    // the rule that survives a grant edit, and it is the rule that should be checked rather than
    // the membership.
    const mayClaimPlan = canPerformCaringContactAction(actor, "claimPlan", { teamId: actor.teamId }).allowed;
    const mayViewReferral = canPerformCaringContactAction(actor, READ_ACTIONS.referral, {
      teamId: actor.teamId,
    }).allowed;
    if (!mayClaimPlan || !mayViewReferral) return notice({ kind: "not-permitted" });

    // `"all"` is the object id a collection read names -- the actor's own team scopes what comes
    // back, so there is no single object to name. Identical to `referrals/route.ts`'s `GET`.
    const referralsRead = await auditedRead<Referral[]>(
      store,
      actor,
      { kind: "search", objectType: "patientDirectory", objectId: "all" },
      () => store.listReferrals({ actor }),
    );
    if (referralsRead.outcome === "failed") {
      throw referralsRead.error instanceof Error
        ? referralsRead.error
        : new Error("Failed to read this team's referrals.");
    }
    if (!referralsRead.recorded) {
      throw new Error("Caring Contacts access trail is unavailable; nothing was rendered.");
    }
    // `== null`, for the reason the caseload's guard records: `auditedRead` treats null AND
    // undefined as denied while typing `released` as `T | null`, so a `=== null` guard would let a
    // contract-breaking `undefined` through to fail somewhere less legible. `listReferrals` returns
    // an array for every actor, empty where nothing is visible, so this is unreachable under the
    // contract and stated correctly anyway -- a branch that cannot run is still read.
    if (referralsRead.released == null) {
      throw new Error("caring-contacts referrals read returned no list.");
    }

    // No referral named: the workspace's "New plan" control lands here, so rather than a dead end
    // the screen offers the accepted referrals that do not yet carry a plan. A referral whose plan
    // is already on this team's caseload is left out -- the store refuses a second plan for it, so
    // offering it would only lead to a refusal at the last step. The plans read carries the same
    // access identity the patients directory uses.
    if (requestedReferralId === null) {
      const plansRead = await auditedRead<PlanRecord[]>(
        store,
        actor,
        { kind: "search", objectType: "plan", objectId: "all" },
        () => store.listPlans({ actor }),
      );
      if (plansRead.outcome === "failed") {
        throw plansRead.error instanceof Error ? plansRead.error : new Error("Failed to read this team's plans.");
      }
      if (!plansRead.recorded) {
        throw new Error("Caring Contacts access trail is unavailable; nothing was rendered.");
      }
      if (plansRead.released == null) {
        throw new Error("caring-contacts plans read returned no list.");
      }
      const referralsWithAPlan = new Set<string>(plansRead.released.map((record) => record.referralId));
      // A patient who already has a plan that has not ended cannot be given a second one: the
      // create call refuses it with a 409 at the very last step of the wizard. Offering their other
      // accepted referrals would walk a clinician through four stages to that refusal.
      const patientsWithALivePlan = new Set<string>(
        plansRead.released
          .filter((record) => !TERMINAL_PLAN_STATES.includes(record.plan.state))
          .map((record) => record.patientId),
      );
      const candidates = referralsRead.released.filter(
        (candidate) =>
          candidate.state === "accepted" &&
          !referralsWithAPlan.has(candidate.id) &&
          !patientsWithALivePlan.has(candidate.patientId),
      );

      // The patient's name, discharge date and hospital as held on each referral's intake record,
      // read through the same audited access the wizard's own prefill read uses. A referral created
      // without an intake record (the electronic feed, or the demonstration seed) holds none, and
      // the list says so rather than guessing.
      const described: StartableReferral[] = [];
      for (const candidate of candidates) {
        const payloadRead = await auditedRead<ReferralIntakePayload | null>(
          store,
          actor,
          { kind: "view", objectType: "patientDirectory", objectId: candidate.id },
          () => store.getReferralIntakePayload(candidate.id, { actor }),
        );
        if (payloadRead.outcome === "failed") {
          throw payloadRead.error instanceof Error
            ? payloadRead.error
            : new Error("Failed to read a referral's intake payload.");
        }
        if (!payloadRead.recorded) {
          throw new Error("Caring Contacts access trail is unavailable; nothing was rendered.");
        }
        const payload = payloadRead.released;
        const name = payload ? `${payload.givenName} ${payload.familyName}`.trim() : "";
        described.push({
          referralId: candidate.id,
          patientId: candidate.patientId,
          patientName: name === "" ? null : name,
          dischargeDate: payload?.dischargeDate?.trim() ? payload.dischargeDate : null,
          hospital: payload?.hospitalFacility?.trim() ? payload.hospitalFacility : null,
        });
      }

      return notice({ kind: "no-referral-named", startable: newestReferralPerPatient(described) });
    }

    const referral = referralsRead.released.find((candidate) => candidate.id === requestedReferralId) ?? null;
    if (referral === null) return notice({ kind: "referral-not-visible" });
    if (referral.state !== "accepted") {
      return notice({ kind: "referral-not-accepted", referralId: referral.id, state: referral.state });
    }

    const versionsRead = await auditedRead<PathwayVersion[]>(
      store,
      actor,
      { kind: "view", objectType: "pathwayVersion", objectId: "all" },
      () => store.listPathwayVersions({ actor }),
    );
    if (versionsRead.outcome === "failed") {
      throw versionsRead.error instanceof Error
        ? versionsRead.error
        : new Error("Failed to read this team's pathway versions.");
    }
    if (!versionsRead.recorded) {
      throw new Error("Caring Contacts access trail is unavailable; nothing was rendered.");
    }
    if (versionsRead.released == null) {
      throw new Error("caring-contacts pathway versions read returned no list.");
    }

    // A plan may only run a version two different people have approved. `pathway-versions.ts` owns
    // that rule -- `approved` is the state its transition module grants only on the approval that
    // completes both required roles -- so this filters on the state rather than counting approvals
    // for itself. A screen must never re-derive a rule a module owns.
    //
    // A retired version is deliberately not offered: `retirementPausesFutureContacts`'s note says a
    // routine retirement stops new activations and leaves running plans alone, so starting a new
    // plan on one is exactly what retirement prevents.
    const pathwayOptions: PlanWizardPathwayOption[] = versionsRead.released
      .filter((version) => version.state === "approved")
      .map((version) => ({
        id: version.id,
        cadenceLabels: version.snapshot.cadenceLabels,
        // Plain words, resolved here rather than in the wizard (round 1, M-2). The wording lives in
        // the sealed domain beside the roles it names -- a screen must never re-derive a rule a
        // module owns, and the interface-vocabulary scan refuses "lead" as a whole word in a
        // component. Resolving it here also keeps both domain modules out of the client bundle.
        approvedBy: version.approvals.map((approval) => PATHWAY_APPROVAL_ROLE_WORDING[approval.role]),
        // Ruling [126]. `approvedBy` above is a claim about provenance, and a demonstration version
        // has approvals no person gave. Resolved here for the same two reasons the role wording is:
        // the words live in the sealed domain beside the values they name, and resolving on the
        // server keeps that module out of this route's client chunk.
        //
        // Through the domain's own resolver rather than a lookup written here. Round 2 found the
        // lookup fails unsafe: the Postgres store reads the snapshot back with an unchecked cast,
        // so an unrecognised provenance yields `undefined` from the map, the wizard's `=== null`
        // test is false, and the screen renders an empty qualifier beside an unqualified
        // "Approved by ...". `pathwayVersionProvenanceWording` makes the fallback structural.
        provenanceNote: pathwayVersionProvenanceWording(version.snapshot.provenance),
        publishedAt: version.publishedAt,
      }));

    const intakeRead = await auditedRead<ReferralIntakePayload | null>(
      store,
      actor,
      { kind: "view", objectType: "patientDirectory", objectId: referral.id },
      () => store.getReferralIntakePayload(referral.id, { actor }),
    );
    if (intakeRead.outcome === "failed") {
      throw intakeRead.error instanceof Error
        ? intakeRead.error
        : new Error("Failed to read this referral's intake payload.");
    }
    if (!intakeRead.recorded) {
      throw new Error("Caring Contacts access trail is unavailable; nothing was rendered.");
    }

    return (
      <PlanWizard
        referralId={referral.id}
        patientId={referral.patientId}
        teamId={referral.teamId}
        actorId={actor.id}
        actorRoleLabels={actor.roles.map((role) => CARING_CONTACT_ROLE_WORDING[role])}
        referralPathwayVersionId={referral.pathwayVersionId}
        pathwayOptions={pathwayOptions}
        sendingPreferenceOptions={SENDING_PREFERENCE_OPTIONS}
        fictionalPatientMobileNumbers={DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS}
        patientVisibleMessageSpecimen={EXACT_PATIENT_VISIBLE_MESSAGE}
        intakePrefill={intakeRead.released}
      />
    );
  }
}

/**
 * One row per patient: where several accepted referrals without a plan name the same patient, only
 * the newest is offered, so a clinician is not asked to choose between two copies of one discharge.
 *
 * "Newest" is the latest discharge date held on the referral's intake record. No referral carries a
 * received-at time, and the store lists referrals by id, which is not time-ordered. A referral with
 * no discharge date held counts as older than one with a date; between two with none, the later in
 * the list is kept.
 */
function newestReferralPerPatient(referrals: readonly StartableReferral[]): StartableReferral[] {
  const dischargeTime = (referral: StartableReferral) => {
    const time = referral.dischargeDate === null ? Number.NaN : Date.parse(referral.dischargeDate);
    return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
  };
  const newest = new Map<string, StartableReferral>();
  for (const referral of referrals) {
    const kept = newest.get(referral.patientId);
    if (!kept || dischargeTime(referral) >= dischargeTime(kept)) newest.set(referral.patientId, referral);
  }
  return referrals.filter((referral) => newest.get(referral.patientId) === referral);
}

function notice(state: PlanStartState) {
  return <PlanStartStateNotice state={state} />;
}

/**
 * The referral id the URL names, or null.
 *
 * A repeated `?referral=a&referral=b` arrives as an array and names no single referral, so it is
 * treated as naming none rather than as an error: a mistyped URL must say what this screen needs,
 * never fail the render. Nothing is validated about the VALUE here beyond its shape -- whether it
 * is a referral this actor may see is settled above, against the referrals this actor could
 * already list.
 */
function readRequestedReferralId(searchParams: Readonly<Record<string, string | string[] | undefined>>): string | null {
  const raw = searchParams[CARING_CONTACTS_REFERRAL_QUERY_PARAM];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}
