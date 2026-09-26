import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { notFound } from "next/navigation";

import type { PlanActionsContext } from "@/components/caring-contacts/workspace/plan-action-rules";
import { PatientOverview, type PatientOverviewView } from "@/components/caring-contacts/workspace/patient-overview";
import { CARING_CONTACTS_PLAN_QUERY_PARAM } from "@/lib/caring-contacts-routes";
import { auditedRead } from "@/lib/caring-contacts-server/handler";
import {
  DEMO_ROLES,
  demoActorForRole,
  isCaringContactsWorkspaceEnabled,
  resolveCaringContactsActor,
} from "@/lib/caring-contacts-server/session";
import { caringContactsStore } from "@/lib/caring-contacts-server/store";
import type { Episode } from "@/lib/caring-contacts/episode";
import { planId as toPlanId } from "@/lib/caring-contacts/ids";
import type { PlanAssignment } from "@/lib/caring-contacts/assignment";
import {
  canPerformCaringContactAction,
  CARING_CONTACT_ROLE_WORDING,
  type CaringContactRole,
} from "@/lib/caring-contacts/permissions";
import { READ_ACTIONS, type PatientNameProjection, type PlanRecord } from "@/lib/caring-contacts/repository";
import type { ServiceState } from "@/lib/caring-contacts/service-state";

/**
 * The workspace's lazy route boundary (Ruling 13). Same spelling and same reason as
 * `src/app/caring-contacts/page.tsx` and the patients directory beside this file: nothing outside
 * this route segment imports the workspace, and dynamically importing the shell keeps the Client
 * Components beneath it out of the PsychSift dashboard's chunks. See the Today page's module
 * note for the argument in full; one copy of it is the source of truth and two copies would drift.
 */
const CaringContactsShell = dynamic(() =>
  import("@/components/caring-contacts/workspace/shell").then((module) => module.CaringContactsShell),
);

/** The browser tab reads "Patient · Caring Contacts" through the layout's title template. */
export const metadata: Metadata = { title: "Patient" };

/**
 * One patient's episode -- the screen a clinician reaches from a row of the caseload, and the ONE
 * screen in this workspace that may call `getEpisode`.
 *
 * THE FIRST DYNAMIC ROUTE IN THIS WORKSPACE, AND THIS IS NEXT 16
 * -------------------------------------------------------------
 * `params` is a PROMISE, exactly as `searchParams` already is, and is awaited before use --
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md` is the
 * contract, not any recollection of Next 14, where it was a plain object. Awaiting either makes
 * the route dynamic, which is already true here (the role cookie does the same) and is correct: a
 * cached copy of a patient's episode would outlive the episode.
 *
 * WHY THE ROUTE IS KEYED BY PATIENT AND EVERY READ BY PLAN (Ruling 97)
 * -------------------------------------------------------------------
 * `getEpisode` takes a plan id. The URL carries a patient id. Those do not resolve to one another,
 * and inventing an oracle that made them would be the wrong fix: one patient can honestly hold two
 * episodes -- `repository.ts` says so, and `markRetentionCleared` clears detail PER PLAN, so two
 * plans for one patient can legitimately differ in what they still hold.
 *
 * So the patient's plans are resolved by filtering `listPlans`, which is team-scoped for free and
 * is the read Task 5 already established, rather than by adding a patient-keyed lookup that would
 * answer for an id the caller supplied. From there:
 *
 *   * zero plans is an honest empty state, never `notFound()`. The actor may legitimately have
 *     reached a patient whose plan is on another team, and the answer must not distinguish that
 *     from "no plan exists" -- `getPlan` deliberately gives one answer for both, and this screen
 *     does not become the one that tells them apart;
 *   * exactly one plan renders, and the URL cannot change that -- see below;
 *   * more than one, with no plan named in the URL, ASKS. A screen that silently picked would show
 *     one plan's schedule under a heading carrying this patient's name;
 *   * `?plan=<planId>` names one, and is validated against the plans this actor could already list
 *     for this patient before anything is read with it. A plan id that does not belong to this
 *     patient and this team is not an error worth reporting in detail -- it is simply not a plan
 *     this actor may see, so it is ignored.
 *
 * WHAT "IGNORED" MEANS WHEN THERE IS EXACTLY ONE PLAN, because the two rules meet there and this
 * comment used to imply an answer the code does not give (review round 1, finding M7).
 *
 * `?plan=` is consulted ONLY when the patient has more than one plan. With exactly one, that plan
 * renders whatever the URL says -- including when `?plan=` names a plan belonging to somebody
 * else. The code is written that way deliberately and the comment is what moved:
 *
 *   * Ruling 97 states "exactly one plan -> render it" without qualification. The parameter exists
 *     to CHOOSE among several, and there is nothing to choose from;
 *   * the alternative -- treating an unrecognised `?plan=` as a reason to fall through to the
 *     chooser -- would present a one-plan patient with a one-item chooser, turning a mistyped or
 *     stale URL into an extra click on a clinical screen, and would make the URL able to withhold
 *     a plan the actor may see;
 *   * nothing leaks either way. The foreign plan is neither read nor named nor acknowledged; the
 *     screen renders the plan it would have rendered with no query string at all, and a reader who
 *     wants to know which plan they are looking at is told, because the plan id is on the screen.
 *
 * So the validation is real and is never skipped: no `?plan=` value ever reaches a read without
 * first matching a plan in `plansForPatient`. What it does not do is give the URL a veto.
 *
 * `getEpisode` is called ONCE, for ONE plan, and only after that rule has picked the plan. The
 * chooser takes its name from `listPatientNames` (Ruling 91) instead: choosing between two plans
 * needs a name to recognise the person by, and `getEpisode` would release the mobile number, the
 * identifiers and the cultural identity to answer that.
 *
 * EVERY READ IS AUDITED, AND NONE OF THEM IS HTTP
 * ----------------------------------------------
 * The same shape the patients directory uses, for the same reasons: this is a Server Component and
 * reads the store directly rather than calling this app's own API over HTTP, and EVERY read goes
 * through `auditedRead` with the same access identity that read already carries on the API side --
 * `{ administrative, serviceState, "service" }`, `{ search, plan, "all" }` and
 * `{ search, patientName, "all" }` are all `plans/route.ts` and the directory's, unchanged.
 *
 * The episode read is the one this screen adds, and it has NO API-side twin to copy: no route
 * under `src/app/api/caring-contacts/` reads an episode. Its identity is
 * `{ view, episode, <planId> }` -- `"view"` because a single named object is being looked at
 * rather than a collection searched, `"episode"` because `AccessedObjectType` already carries that
 * member for exactly this read, and the plan id as the object id because that is the object
 * released. The question the trail must be able to answer here is "who read this patient's
 * record, and when", and it is asked of a specific episode rather than of a list.
 *
 * Every bad outcome fails closed and reaches `error.tsx`, which says nothing was sent and nothing
 * was changed. No read on this page has an honest fallback: an episode rendered beside a
 * service-state read that failed would claim sending is running during an incident, and a plan
 * rendered from a failed read of its own contents would claim a schedule that was never read.
 *
 * A DENIED EPISODE IS NOT A FAILED ONE
 * -----------------------------------
 * `getEpisode` answers `null` for a plan that does not exist, for another team's plan, AND for an
 * actor whose role does not cover the read -- deliberately indistinguishable, so nobody can probe
 * for a record they may not see. `auditedRead` therefore records `denied`, which is a legitimate
 * outcome here rather than a fault: this page has ALREADY established, from `listPlans`, that the
 * plan exists and is this team's. So a null release is the capability, and the capability is a
 * fact about the ACTOR that `canPerformCaringContactAction` answers with certainty. The read is
 * still made and still recorded -- a denied read belongs on the trail -- and the answer to the
 * capability question is what lets the screen say which fact it is rather than guess.
 */
export default async function CaringContactsPatientOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ patientId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isCaringContactsWorkspaceEnabled()) notFound();
  const actor = await resolveCaringContactsActor();
  const store = await caringContactsStore();
  const { patientId } = await params;
  const requestedPlanId = readRequestedPlanId(await searchParams);

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

  // `"all"` is the object id a collection read names -- the actor's own team scopes what comes
  // back, so there is no single object to name. Identical to `plans/route.ts`'s `GET`.
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
  // `== null` for the reason the directory's guard records: `auditedRead` treats null OR UNDEFINED
  // as denied while typing `released` as `T | null`, so a `=== null` guard would let a
  // contract-breaking `undefined` through to fail somewhere less legible. `listPlans` returns an
  // array for every actor, empty where nothing is visible, so this is unreachable under the
  // contract and stated correctly anyway -- a branch that cannot run is still read.
  if (plansRead.released == null) {
    throw new Error("caring-contacts plans read returned no list.");
  }

  const mayViewPlans = canPerformCaringContactAction(actor, READ_ACTIONS.plan, { teamId: actor.teamId }).allowed;
  const plansForPatient = plansRead.released.filter((record) => record.patientId === patientId);

  const view = await resolveView();

  return (
    <CaringContactsShell
      title="Patient"
      description="One patient's caring-contact episode: who they are, which plan is running, what has happened on it, and what is still to come. Every patient, number and message in this workspace is invented; nothing here is ever sent to a real number."
      serviceState={serviceState}
    >
      <PatientOverview patientId={patientId} view={view} />
    </CaringContactsShell>
  );

  async function resolveView(): Promise<PatientOverviewView> {
    // The capability is decided from the ACTOR, never inferred from an empty list. `listPlans`
    // answers an actor without `viewReferral` with `[]`, exactly as it answers a patient this team
    // holds no plan for, so a screen that only counted rows would tell an auditor there is no plan
    // -- a false statement about a clinical record, and the defect Ruling 92 closed for the
    // caseload.
    if (!mayViewPlans) return { kind: "not-permitted" };
    if (plansForPatient.length === 0) return { kind: "no-plan" };

    const named =
      requestedPlanId === null ? null : (plansForPatient.find((record) => record.plan.id === requestedPlanId) ?? null);
    // One plan renders regardless of `?plan=`; the parameter only ever picks between several. See
    // the module note's "what ignored means when there is exactly one plan" -- the comment was the
    // half that was wrong, not this line.
    const chosen = plansForPatient.length === 1 ? plansForPatient[0] : named;

    if (chosen === null) {
      // The chooser's name comes from the narrow read (Ruling 91), and it is read ONLY here: the
      // episode branch below already has the name, and making both reads would release a patient's
      // name twice on one render for one screen's worth of use.
      const namesRead = await auditedRead<PatientNameProjection[]>(
        store,
        actor,
        { kind: "search", objectType: "patientName", objectId: "all" },
        () => store.listPatientNames({ actor }),
      );
      if (namesRead.outcome === "failed") {
        throw namesRead.error instanceof Error
          ? namesRead.error
          : new Error("Failed to read this team's patient names.");
      }
      if (!namesRead.recorded) {
        throw new Error("Caring Contacts access trail is unavailable; nothing was rendered.");
      }
      if (namesRead.released == null) {
        throw new Error("caring-contacts patient names read returned no list.");
      }
      return { kind: "choose", plans: plansForPatient, patientNames: namesRead.released };
    }

    // ONE call, for ONE plan, and only now that the plan is settled.
    // `Episode | null`, not `Episode`: `getEpisode` answers null for a plan that does not exist,
    // for another team's plan, AND for a role that may not read one, and `auditedRead` turns that
    // release into the `denied` outcome. Typing the read as non-nullable would be a claim the
    // contract does not make.
    const episodeRead = await auditedRead<Episode | null>(
      store,
      actor,
      { kind: "view", objectType: "episode", objectId: chosen.plan.id },
      () => store.getEpisode(toPlanId(chosen.plan.id), { actor }),
    );
    if (episodeRead.outcome === "failed") {
      throw episodeRead.error instanceof Error
        ? episodeRead.error
        : new Error("Failed to read this patient's episode.");
    }
    if (!episodeRead.recorded) {
      throw new Error("Caring Contacts access trail is unavailable; nothing was rendered.");
    }
    // A null release is `denied`, and here that is the CAPABILITY rather than a fault -- see the
    // module note. The plan and its schedule still render; the person does not, and the notice
    // says which of the two facts that is rather than leaving a nameless record unexplained.
    const mayViewEpisode = canPerformCaringContactAction(actor, READ_ACTIONS.episode, {
      teamId: actor.teamId,
    }).allowed;
    if (episodeRead.released == null && mayViewEpisode) {
      // The read was permitted and the plan was listed a moment ago, so nothing legitimate returns
      // null here. Failing closed rather than rendering a nameless record that would read exactly
      // like a role restriction.
      throw new Error("caring-contacts episode read released nothing for a plan this actor may read.");
    }

    // WHO IS CARRYING THIS PLAN, read here because the plan actions need it and no other read on
    // this page answers it. Its access identity is the one `assignments/[planId]/route.ts` already
    // records for the same read -- `{ view, plan, <planId> }` -- so no new `AccessedObjectType`
    // member is owed: an assignment is a fact ABOUT a plan, and this is that plan being looked at.
    const assignmentRead = await auditedRead<PlanAssignment | null>(
      store,
      actor,
      { kind: "view", objectType: "plan", objectId: chosen.plan.id },
      () => store.getAssignment(toPlanId(chosen.plan.id), { actor }),
    );
    if (assignmentRead.outcome === "failed") {
      throw assignmentRead.error instanceof Error
        ? assignmentRead.error
        : new Error("Failed to read who is carrying this plan.");
    }
    if (!assignmentRead.recorded) {
      throw new Error("Caring Contacts access trail is unavailable; nothing was rendered.");
    }
    if (assignmentRead.released == null) {
      // `getAssignment` answers null only for a plan this actor cannot see, and this plan was
      // listed for this actor a moment ago. Failing closed rather than rendering plan actions
      // against an assignment nothing read.
      throw new Error("caring-contacts assignment read released nothing for a plan this actor may read.");
    }

    return {
      kind: "episode",
      record: chosen,
      episode: episodeRead.released,
      otherPlanCount: plansForPatient.length - 1,
      actions: planActionsContext(chosen, assignmentRead.released),
    };
  }

  /**
   * Everything the plan-actions surface is handed, decided HERE from the actor and the domain.
   *
   * Three things are resolved on this side of the client boundary and none of them may move:
   *
   *   * WHETHER EACH ACTION IS GRANTED, asked of `canPerformCaringContactAction` per action rather
   *     than of one broader stand-in. The service checks the same capability at the write, so this
   *     is what the screen SHOWS rather than what enforces it -- and `reassignPlan` is granted to a
   *     narrower set of roles than the other three, which is why they are asked separately.
   *   * ROLE WORDING, from `CARING_CONTACT_ROLE_WORDING` in the sealed domain. Actor identifiers in
   *     this workspace are `demo-<role>`, and a raw role identifier is never put in front of a
   *     clinician. The reverse lookup goes through `demoActorForRole`, the session module's own
   *     constructor, rather than by re-deriving its `demo-` prefix here.
   *   * WHERE A PLAN MAY MOVE TO: every demo role granted the action of taking a plan on, minus
   *     whoever is already carrying it. Asked of the domain rather than restated from its grants.
   */
  function planActionsContext(plan: PlanRecord, assignment: PlanAssignment): PlanActionsContext {
    const grants = (role: CaringContactRole, action: Parameters<typeof canPerformCaringContactAction>[1]) =>
      canPerformCaringContactAction(demoActorForRole(role), action, { teamId: actor.teamId }).allowed;
    const actingRole: CaringContactRole = actor.roles[0] ?? "coordinator";
    const ownerRole = assignment.ownerId === null ? null : roleOfDemoActor(assignment.ownerId);

    return {
      planId: plan.plan.id,
      planState: plan.plan.state,
      planVersion: plan.plan.version,
      actingAccount: actingRole,
      actingAccountWording: CARING_CONTACT_ROLE_WORDING[actingRole],
      actingActorId: actor.id,
      carriedBy: {
        // The identifier crosses because it is COMPARED and never rendered: a move to the account
        // already carrying the plan is refused by the rules module, which has to know which one
        // that is. The wording beside it is the half a clinician reads.
        actorId: assignment.ownerId,
        wording: ownerRole === null ? null : CARING_CONTACT_ROLE_WORDING[ownerRole],
      },
      destinations: DEMO_ROLES.filter((role) => grants(role, "claimPlan") && role !== ownerRole).map((role) => ({
        actorId: demoActorForRole(role).id,
        wording: CARING_CONTACT_ROLE_WORDING[role],
      })),
      granted: {
        pause: canPerformCaringContactAction(actor, "pausePlan", { teamId: actor.teamId }).allowed,
        resume: canPerformCaringContactAction(actor, "resumePlan", { teamId: actor.teamId }).allowed,
        withdrawal: canPerformCaringContactAction(actor, "withdrawPlan", { teamId: actor.teamId }).allowed,
        reassignment: canPerformCaringContactAction(actor, "reassignPlan", { teamId: actor.teamId }).allowed,
        // Both gated where the service gates them: `claimPlan`, the roles that can create a plan.
        cancelDraft: canPerformCaringContactAction(actor, "claimPlan", { teamId: actor.teamId }).allowed,
        claim: canPerformCaringContactAction(actor, "claimPlan", { teamId: actor.teamId }).allowed,
      },
    };
  }
}

/**
 * The demo role an actor identifier names, or null.
 *
 * Resolved by asking `demoActorForRole` for each role and comparing, rather than by taking the
 * identifier apart: the `demo-<role>` shape is the session module's, and a screen that re-derived it
 * would hold a second copy of a rule that module owns. Null for an identifier no demo role produces,
 * which no write in this workspace makes today -- the caller states that absence rather than
 * reporting it as "nobody is carrying this plan", which is a different fact.
 */
function roleOfDemoActor(id: string): CaringContactRole | null {
  return DEMO_ROLES.find((role) => demoActorForRole(role).id === id) ?? null;
}

/**
 * The plan id the URL names, or null.
 *
 * A repeated `?plan=a&plan=b` arrives as an array and names no single plan, so it is treated as
 * naming none rather than as an error: a mistyped URL must fall back to asking, never fail the
 * render. Nothing is validated about the VALUE here beyond its shape -- whether it is a plan this
 * actor may see is settled above, against the plans this actor could already list.
 */
function readRequestedPlanId(searchParams: Readonly<Record<string, string | string[] | undefined>>): string | null {
  const raw = searchParams[CARING_CONTACTS_PLAN_QUERY_PARAM];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}
