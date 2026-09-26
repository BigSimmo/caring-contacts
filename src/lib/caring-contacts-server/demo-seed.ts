// src/lib/caring-contacts-server/demo-seed.ts
//
// The synthetic population the workspace is demonstrated with.
//
// WHY THIS EXISTS. Phase 2B built the caseload, the patient overview and a four-stage activation
// wizard, and none of it could be driven by anyone, because the running system was empty and there
// was no way to put anything into it. No route can create a pathway version -- the POST surface at
// `api/caring-contacts/pathway-versions` refuses deliberately, because accepting a whole
// `PathwayVersion` from the wire would let a caller post one that arrives already approved -- and
// the one route that creates a referral is called by no screen. So the wizard needed a referral it
// could not get and a pathway it could not get, and every list screen was correctly empty. This
// module is the population, not a change to either of those refusals: both are still correct and
// neither is weakened here.
//
// THE THREE PROPERTIES THAT MAKE IT SAFE RATHER THAN MERELY CONVENIENT
// --------------------------------------------------------------------
//   1. IT CANNOT REACH A DATABASE. Not "must not" -- cannot. `createDemoWorkspaceStore` CONSTRUCTS
//      the in-memory repository itself, so there is no parameter through which a foreign store
//      could arrive, and this module imports `createInMemoryRepository` and nothing from
//      `../caring-contacts/db/**` at all. `applyDemoSeed` additionally refuses any store this
//      module did not build, so even a direct call cannot seed a Postgres repository. Store
//      selection is unchanged: `caringContactsStore()` reaches this module only on the branch it
//      takes when `CARING_CONTACTS_DATABASE_URL` is unset, and
//      `tests/caring-contacts-demo-seed.test.ts` fails if the Postgres branch ever calls it.
//
//   2. IT IS NOT A PRIVILEGED BACK DOOR. Every record below is written through the repository's
//      own methods, with a real demo actor and a real idempotency key -- never by reaching into
//      the store's Maps. The consequence is the point: the pathway version's dual approval is a
//      governance record the DOMAIN produced, checked by `applyPathwayVersionTransition` for two
//      distinct roles held by two distinct people, neither of them its author. A refusal from any
//      write is therefore a finding about the rules and is thrown, not routed around -- see
//      `DemoSeedRefusedError`. A half-seeded store that looked populated would be the worse
//      outcome.
//
//   3. IT AUTHORS NO PATIENT-VISIBLE WORDING. See `DEMO_SEED_MESSAGE_TEXT` below, which is the
//      single most consequential decision in this file.
//
//   4. IT DOES NOT LET A SCREEN PRESENT ITS GOVERNANCE AS REAL. The version it writes carries
//      `snapshot.provenance = "syntheticDemonstration"`, so the wizard's pathway stage can say the
//      approvals are invented. The approvals are structurally genuine -- the domain refused
//      anything else -- and that is exactly why the record has to carry the qualifier: nothing
//      about the shape of a correctly-approved version distinguishes one nobody approved.
//
// PRODUCTION NEVER SEES ANY OF THIS. `isCaringContactsDemoEnabled()` is the same predicate that
// decides whether a demo actor can be resolved at all; where it is false, the store is returned
// empty. That keeps this module inside the repository's standing rule that demo content is a
// development convenience and production fails loudly rather than falling back to synthetic data.
// The isolated Playwright server is the one place that predicate is true inside a production
// build, and it is excluded by default -- see `demoSeedRequested` for why, and for the switch a
// browser journey turns it on with.
import "server-only";
import { PLAN_ASSURANCE_VALUES } from "@/lib/caring-contacts/assurances";

import { awstCalendarDay, awstWallTimeToInstant } from "@/lib/caring-contacts/clock";
import type { Clock } from "@/lib/caring-contacts/clock";
import { idempotencyKey, patientId, pathwayVersionId, planId, referralId } from "@/lib/caring-contacts/ids";
import type { PathwayVersionId, PlanId, ReferralId } from "@/lib/caring-contacts/ids";
import { createInMemoryRepository } from "@/lib/caring-contacts/in-memory-repository";
import { PATIENT_VISIBLE_MESSAGE_TEMPLATE } from "@/lib/caring-contacts/message-copy";
import type { MessageType, ProviderStatus, SendingPreference, TransitionResult } from "@/lib/caring-contacts/model";
import type { PathwayVersion, PathwayVersionSnapshot } from "@/lib/caring-contacts/pathway-versions";
import type { Actor, CaringContactActor } from "@/lib/caring-contacts/permissions";
import type {
  CaringContactRepository,
  EpisodePatientDetail,
  StoredContact,
  WriteContext,
} from "@/lib/caring-contacts/repository";
import { buildApprovedSchedule, calendarDayPlusMonths } from "@/lib/caring-contacts/schedule";
import { FICTIONAL_CONTACTS_BY_ROLE } from "@/lib/caring-contacts/synthetic-contacts";

import { DEMO_RESTART_APPROVAL_SEATS } from "./restart-approval-seats";
import { demoActorForRole, demoSystemDispatcher, isCaringContactsDemoEnabled } from "./session";

/** Thrown when something asks this module to seed a store it did not build. */
export class DemoSeedForeignStoreError extends Error {
  constructor() {
    super(
      "The Caring Contacts demo seed refuses a store it did not construct. It populates only the " +
        "in-memory reference store it builds itself, and never a database-backed repository.",
    );
    this.name = "DemoSeedForeignStoreError";
  }
}

/**
 * Thrown when a seed write is refused.
 *
 * A refusal is a FINDING, not an obstacle to route around: it means the seed tried to make a write
 * the rules do not allow, and the honest response is to stop rather than to reach past the rule or
 * to leave a partly-populated store that looks whole. The message names the step and the domain's
 * own machine-readable reason, and nothing else -- never patient detail.
 */
export class DemoSeedRefusedError extends Error {
  constructor(step: string, reason: string) {
    super(`The Caring Contacts demo seed was refused at ${step}: ${reason}`);
    this.name = "DemoSeedRefusedError";
  }
}

export const DEMO_SEED_PATHWAY_VERSION_ID = "demo-seed-pathway-version-1";

/**
 * The accepted referral that has no plan yet -- the one a coordinator (or a browser test) starts
 * the activation wizard from, at `/caring-contacts/plans/new?referral=<this>`.
 *
 * Exported because the id is the wizard's only entry point: the route takes it from the URL and no
 * screen lists referrals yet, so without a stable, published identifier the wizard remains
 * unreachable even with a population behind it.
 */
export const DEMO_SEED_UNSTARTED_REFERRAL_ID = "demo-seed-referral-wren";

/**
 * THE MESSAGE TEXT, AND WHY TWO OF THE THREE ENTRIES ARE EMPTY.
 *
 * `standard` is `PATIENT_VISIBLE_MESSAGE_TEMPLATE` from the sealed domain's `message-copy` -- the one
 * provisional patient-visible message that exists, and the only one that has been reviewed. It is
 * stored with the preferred-name SLOT, not a name: until 2026-09-26 this entry held the specimen
 * with "Rowan" baked in, so every patient on the pathway would have been greeted as Rowan. The
 * sender fills the slot with each patient's own recorded preferred name (`renderGovernedMessage`).
 *
 * `first` and `closing` are EMPTY, and that is the truthful representation of "not yet written".
 * Nobody has authored either. Copying the standard message into the closing slot would be worse
 * than leaving it blank and is specifically forbidden: `message-rules` requires a final message to
 * say that it is the final message in the programme, so a closing message that did not say so
 * would tell someone the contact continues when it has ended -- and the owner deferred that
 * wording to the lived-experience representative precisely because it is not an implementer's to
 * draft. A blank entry is visibly unfinished; a plausible wrong one is not.
 */
const DEMO_SEED_MESSAGE_TEXT: Readonly<Record<MessageType, string>> = Object.freeze({
  standard: PATIENT_VISIBLE_MESSAGE_TEMPLATE,
  first: "",
  closing: "",
});

/**
 * `culturalIdentity` is recorded as not stated for every seeded patient, and that is a decision
 * rather than a placeholder: a cultural identity attributed to an invented person is an invention
 * about culture, and this programme's standing discipline is that an implementer does not author
 * content of that kind. "Not stated" is what the record honestly holds.
 */
const CULTURAL_IDENTITY_NOT_STATED = "Not stated";

type DemoPlanSeed = {
  planIdentifier: string;
  sendingPreference: SendingPreference;
  /** Where the plan is left. Every plan is created and activated first; this is the last move. */
  finalState: "active" | "paused" | "withdrawn";
  patientDetail: EpisodePatientDetail;
  /**
   * Whole calendar months this plan's OWN discharge day is pushed before the shared `dischargeAt`
   * the pathway snapshot uses, computed with `calendarDayPlusMonths` (a negative offset) rather than
   * a fixed count of days -- see that function's own note on why a second, day-approximated copy of
   * month arithmetic would be able to disagree with `buildApprovedSchedule`'s. Default 0.
   *
   * WHY THIS IS THE LEVER, checked against the schedule rather than assumed. `buildApprovedSchedule`
   * puts Month N at discharge + N calendar months (`MONTH_OFFSETS`), so a plan discharged exactly N
   * months before the shared instant opens its "Month N" contact on the current AWST day -- and
   * because the shift is in calendar months, that holds whatever day of the year the seed runs on,
   * not only on the one day it was written. A single contact COULD instead be moved with
   * `rescheduleContact`'s `changeContactDate` branch, but that write requires a non-blank reason and
   * a recorded team-lead approval -- both of them free text or an attestation about why this
   * invented patient's date moved, for a contact that has no other reason to move. Re-discharging
   * the plan tells the truer story ("what is due today" is what a plan actually discharged that many
   * months ago puts there) without inventing either.
   */
  dischargeMonthsBeforeShared?: number;
  /**
   * Claim this plan for the demo coordinator once it is active. Never set on every plan in
   * `DEMO_SEED_PEOPLE`: the roster needs one coordinator visibly carrying work, and the unclaimed-
   * work escalation needs a plan nobody has claimed, and both facts have to survive out of the same
   * population.
   */
  claimedByCoordinator?: boolean;
  /**
   * Contacts to advance past `scheduled` through the real dispatch path -- `startContactDispatch`,
   * `recordContactSent`, `recordContactProviderStatus`, in that order, exactly as the sealed
   * `driveTwelveMonthSimulation` driver calls them (../simulation.ts). Named by the contact's own
   * `cadenceLabel` rather than by array position, so this cannot silently retarget a different
   * contact if the schedule shape ever changes.
   *
   * `outcome: "delivered"` is what a successful attempt reports; any other `ProviderStatus` is a
   * provider-reported exception -- exactly what `deliveryExceptionExplanation`
   * (schedule-screen.tsx) and the Schedule screen's `resolve-failed-delivery` trigger need a
   * subject for, and what `contactSendability` needs to offer `delivery-detail` on the patient
   * overview. A plan that ALSO sets `dischargeMonthsBeforeShared` (call it N) must never name
   * "Month N" here -- leaving that one contact untouched at `scheduled` is what makes it show as
   * due today, and naming it here besides would attempt a contact whose own date is still in the
   * future, which is exactly the incoherent state this module exists not to seed.
   */
  attemptedContacts?: readonly { key: string; cadenceLabel: string; outcome: ProviderStatus }[];
};

type DemoPersonSeed = {
  key: string;
  patientIdentifier: string;
  referralIdentifier: string;
  /** `awaitingHandover` is left un-accepted so both referral states are visible on a screen. */
  referralState: "accepted" | "awaitingHandover";
  plan?: DemoPlanSeed;
};

/**
 * The population.
 *
 * NO NAME HERE IS NEW, AND THAT IS THE POINT. Every seeded patient name already existed in this
 * repository's synthetic material, checked at the merge base rather than assumed:
 *
 *   * "Mira Example" appears verbatim in the mockup fixtures (`caring-contacts/mockups/fixtures.ts`
 *     and `care-plan/mockups/fixtures.ts`);
 *   * "Rowan Example" appears verbatim in this workspace's own test fixtures
 *     (`caring-contacts-plan-draft.dom.test.tsx`, `caring-contacts-plan-activation.test.ts`);
 *   * "Ari Sample" is the one new PAIRING, and both halves are borrowed: "Ari" from
 *     "Ari Placeholder" in the care-plan mockup fixtures, "Sample" from "Rowan Sample".
 *
 * The surnames are what make these unmistakably not a real person's name, and this tree uses
 * exactly two of them -- Sample and Example. Nothing was drawn from outside that vocabulary, so no
 * seeded patient can be mistaken for a findable person.
 *
 * Round 1 wrote "the given names below are new", round 2 repeated it, and it was false both times:
 * "Rowan" and "Mira" are the given names of the very fixtures cited as the precedent. A sentence
 * that is wrong about where these names came from undermines the one assurance it exists to give,
 * which is why it is spelled out per name rather than summarised.
 *
 * `wren` and `nima` below are IDENTIFIERS, never names. Those two referrals carry no plan, so no
 * patient detail and no name is stored for either.
 *
 * Every mobile number is one of the reserved fictional numbers that stand for a patient's own
 * mobile (`DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS`, derived from `FICTIONAL_CONTACTS_BY_ROLE`
 * below). There are fewer of those than there are plans here, so one is used more than once.
 * Reusing a reserved non-connecting number is the safe outcome; inventing a number-shaped string
 * would not be.
 *
 * The shape is chosen so every built screen has something real on it AND a coordinator can
 * complete a sign-up:
 *   * three plans, left running, paused and stopped, so the caseload and the patient overview show
 *     three different states -- including the stopped one, without which the fix for a screen that
 *     once told a coordinator a stopped plan would still send cannot be demonstrated at all;
 *   * one accepted referral with NO plan, which is what the wizard needs: a patient who already
 *     has a non-terminal plan is refused a second one by the store, and correctly;
 *   * one referral still awaiting handover, so the two referral states are distinguishable.
 *
 * THREE FURTHER STATES, MEASURED BY RUNNING THE APP RATHER THAN READ FROM THE STORE'S SHAPE ABOVE,
 * added without touching the three properties above them or any existing plan's final state:
 *   * Rowan's plan is CLAIMED by the demo coordinator, through `applyAssignment`'s real `claim`
 *     transition, so the Team roster has an actual person carrying actual work. Mira's plan stays
 *     unclaimed on purpose: the unclaimed-work escalation (spec 4.2) needs a subject too, and a
 *     population where every plan was claimed would delete that observation as completely as one
 *     where none was;
 *   * Rowan's plan is discharged two calendar months before the shared `dischargeAt`, so its
 *     "Month 2" contact falls on the current AWST day and the Schedule screen opens on a populated
 *     day instead of an empty one. See `DemoPlanSeed.dischargeMonthsBeforeShared` for why this is
 *     the lever the domain actually offers, and why it has to be calendar months rather than a
 *     fixed day count;
 *   * three of Rowan's EARLIER contacts -- "Day 1", "Week 1" and "Month 1", every one of them
 *     already in the past under that same re-discharge -- are advanced past `scheduled` through the
 *     real dispatch path, two to a successful `delivered` outcome and one -- deliberately "Month 1",
 *     the CLOSEST of the three to today, so paging the Schedule screen forward reaches it in a
 *     couple of clicks rather than dozens -- to `notDelivered`. That is what gives `delivery-detail`
 *     and `resolve-failed-delivery` an actual subject; see `DemoPlanSeed.attemptedContacts`.
 *
 *     WHY ONLY THE PAST THREE, AND NEVER "MONTH 2" ITSELF OR ANYTHING AFTER IT: a contact that has
 *     not been reached yet cannot honestly carry an outcome. An earlier round of this seed
 *     attempted contacts whose own scheduled date was still in the future, which is what let the
 *     patient overview claim messages had already been sent for a plan whose only due-or-past
 *     contact was still `scheduled` -- self-contradictory on its face. Every attempted contact here
 *     is checked to sit on or before the current AWST day; see `tests/caring-contacts-demo-seed.test.ts`.
 * Mira and Ari are left exactly as before: a paused plan and a withdrawn one are the OTHER two
 * states the caseload has to show, and neither can also carry an active dispatch -- the store
 * refuses `startContactDispatch` on anything but an active plan, correctly.
 */
const DEMO_SEED_PEOPLE: readonly DemoPersonSeed[] = Object.freeze([
  {
    key: "rowan",
    patientIdentifier: "demo-seed-patient-rowan",
    referralIdentifier: "demo-seed-referral-rowan",
    referralState: "accepted",
    plan: {
      planIdentifier: "demo-seed-plan-rowan",
      sendingPreference: "morning",
      finalState: "active",
      dischargeMonthsBeforeShared: 2,
      claimedByCoordinator: true,
      attemptedContacts: [
        // Closest to today first, deliberately the failure -- see the module note on why. Never
        // "Month 2" here: that is the contact left `scheduled`, due today.
        { key: "month1", cadenceLabel: "Month 1", outcome: "notDelivered" },
        { key: "week1", cadenceLabel: "Week 1", outcome: "delivered" },
        { key: "day1", cadenceLabel: "Day 1", outcome: "delivered" },
      ],
      patientDetail: {
        patientName: "Rowan Example",
        // Required since Task P. The given name this seeded person is called in the message,
        // which is the ordinary case -- a null here would seed the never-held branch instead.
        preferredName: "Rowan",
        patientMobileNumber: FICTIONAL_CONTACTS_BY_ROLE.rowanPatientMobile,
        patientIdentifiers: ["SYN-UMRN-0001"],
        culturalIdentity: CULTURAL_IDENTITY_NOT_STATED,
      },
    },
  },
  {
    key: "mira",
    patientIdentifier: "demo-seed-patient-mira",
    referralIdentifier: "demo-seed-referral-mira",
    referralState: "accepted",
    plan: {
      planIdentifier: "demo-seed-plan-mira",
      sendingPreference: "afternoon",
      finalState: "paused",
      patientDetail: {
        patientName: "Mira Example",
        // Required since Task P. The given name this seeded person is called in the message,
        // which is the ordinary case -- a null here would seed the never-held branch instead.
        preferredName: "Mira",
        patientMobileNumber: FICTIONAL_CONTACTS_BY_ROLE.miraPatientMobile,
        patientIdentifiers: ["SYN-UMRN-0002"],
        culturalIdentity: CULTURAL_IDENTITY_NOT_STATED,
      },
    },
  },
  {
    key: "ari",
    patientIdentifier: "demo-seed-patient-ari",
    referralIdentifier: "demo-seed-referral-ari",
    referralState: "accepted",
    plan: {
      planIdentifier: "demo-seed-plan-ari",
      sendingPreference: "earlyEvening",
      finalState: "withdrawn",
      patientDetail: {
        patientName: "Ari Sample",
        // Required since Task P. The given name this seeded person is called in the message,
        // which is the ordinary case -- a null here would seed the never-held branch instead.
        preferredName: "Ari",
        patientMobileNumber: FICTIONAL_CONTACTS_BY_ROLE.rowanPatientMobile,
        patientIdentifiers: ["SYN-UMRN-0003"],
        culturalIdentity: CULTURAL_IDENTITY_NOT_STATED,
      },
    },
  },
  {
    key: "wren",
    patientIdentifier: "demo-seed-patient-wren",
    referralIdentifier: DEMO_SEED_UNSTARTED_REFERRAL_ID,
    referralState: "accepted",
  },
  {
    key: "nima",
    patientIdentifier: "demo-seed-patient-nima",
    referralIdentifier: "demo-seed-referral-nima",
    referralState: "awaitingHandover",
  },
]);

/**
 * The stores this module built, and therefore the only stores it will populate.
 *
 * A `WeakSet` rather than a flag on the store, so nothing about the repository's own shape changes
 * and nothing outside this module can add to it. This is what makes property 1 above structural
 * rather than a convention: `applyDemoSeed` is exported so its idempotency can be tested against a
 * real store, and this is what stops that export from being a way into a database-backed one.
 */
const storesBuiltHere = new WeakSet<CaringContactRepository>();

export type DemoSeedOutcome = {
  /** False when the store already held a population, or when the demo is unavailable. */
  populated: boolean;
};

/**
 * The environment variable a browser journey turns the population on with. Values other than `on`
 * -- including absent -- leave the isolated Playwright server empty.
 */
export const CARING_CONTACTS_DEMO_SEED_VAR = "CARING_CONTACTS_DEMO_SEED";

/**
 * Whether this process should hold the demo population.
 *
 * Two gates, and the second is the one that is easy to get wrong.
 *
 * The FIRST is `isCaringContactsDemoEnabled()` -- the same predicate that decides whether a demo
 * actor can be resolved at all. A production process cannot resolve an actor, so a population
 * there would be unreachable synthetic content sitting in a production process for no one: exactly
 * what the standing rule against production demo fallback exists to prevent.
 *
 * The SECOND excludes the isolated Playwright server, which is the ONE place the first predicate is
 * true inside a production build. That server exists to observe the app's honest state end to end,
 * and `tests/ui-caring-contacts-workspace.spec.ts` pins part of that honesty: an empty caseload is
 * served as a PAGE rather than as a missing resource, with the empty state saying in words which of
 * the three facts it is. Seeding that server by default would delete that observation -- the
 * "No patients yet" group would never render again -- and would trade a proven contract for an
 * unproven one. So it starts empty unless a journey asks, and the report for this task states
 * exactly what a wizard journey has to do.
 */
function demoSeedRequested(runtime: Record<string, string | undefined> = process.env): boolean {
  if (!isCaringContactsDemoEnabled()) return false;
  if (runtime.PLAYWRIGHT_OFFLINE_MODE === "true") return runtime[CARING_CONTACTS_DEMO_SEED_VAR] === "on";
  return true;
}

/**
 * Builds the in-memory reference store and populates it.
 *
 * The store is constructed HERE, which is the whole of why the seed cannot reach a database: there
 * is no store parameter for a Postgres repository to arrive through.
 */
export async function createDemoWorkspaceStore(clock: Clock): Promise<CaringContactRepository> {
  // The demo's governance configuration: who holds each service-restart approval seat.
  const store = createInMemoryRepository(clock, { restartApprovalSeats: DEMO_RESTART_APPROVAL_SEATS });
  storesBuiltHere.add(store);
  if (!demoSeedRequested()) return store;
  await applyDemoSeed(store, clock);
  return store;
}

/**
 * Populates a store this module built. A no-op on a store that already holds a population, so a
 * second call cannot produce a second population.
 *
 * Idempotency has two independent guards, because they fail differently. The first is the check
 * below: a store that already holds a pathway version is left alone. The second is that every
 * write carries a FIXED idempotency key, so two callers racing the same fresh store cannot both
 * commit -- the store's own replay contract returns the first answer and performs no second change.
 */
export async function applyDemoSeed(store: CaringContactRepository, clock: Clock): Promise<DemoSeedOutcome> {
  if (!storesBuiltHere.has(store)) throw new DemoSeedForeignStoreError();

  // The production boundary is checked HERE, not only at the constructor, and the difference is not
  // stylistic. In a production process `createDemoWorkspaceStore` returns a store it built and left
  // empty -- so that store is in `storesBuiltHere`, and a caller reaching this function with it
  // would have passed the only other guard. Round 1, I1: the database boundary was structural and
  // this one was conventional, while the module header claimed the stronger property for both.
  if (!demoSeedRequested()) return { populated: false };

  const coordinator = demoActorForRole("coordinator");
  const clinicalProgrammeLead = demoActorForRole("clinicalProgrammeLead");
  const livedExperienceRepresentative = demoActorForRole("livedExperienceRepresentative");
  // The one system actor every dispatch write below is attributed to -- see `demoSystemDispatcher`
  // for why a human demo role can never hold this capability instead.
  const dispatcher = demoSystemDispatcher();

  if ((await store.listPathwayVersions({ actor: coordinator })).length > 0) return { populated: false };

  const dischargeAt = clock.now();
  const version = pathwayVersionId(DEMO_SEED_PATHWAY_VERSION_ID);

  // ---- The governed pathway, through its real lifecycle -------------------------------------
  //
  // draft -> inReview -> approved (two roles, two people, neither the author) -> published.
  // `savePathwayVersion` constructs every governance field server-side whatever is passed, so the
  // draft below supplies only the identifier and the snapshot; the rest is the domain's.
  taken(
    "savePathwayVersion",
    await store.savePathwayVersion(
      { version: draftPathwayVersion(version, coordinator, dischargeAt) },
      writeAs(coordinator, "pathway-save"),
    ),
  );
  taken(
    "pathwayVersion:submitForReview",
    await store.transitionPathwayVersion(
      { pathwayVersionId: version, action: { type: "submitForReview" } },
      writeAs(coordinator, "pathway-submit-for-review"),
    ),
  );
  taken(
    "pathwayVersion:approve:clinicalProgrammeLead",
    await store.transitionPathwayVersion(
      {
        pathwayVersionId: version,
        action: { type: "approve", role: "clinicalProgrammeLead", actorId: clinicalProgrammeLead.id },
      },
      writeAs(clinicalProgrammeLead, "pathway-approve-clinical-programme-lead"),
    ),
  );
  taken(
    "pathwayVersion:approve:livedExperienceRepresentative",
    await store.transitionPathwayVersion(
      {
        pathwayVersionId: version,
        action: {
          type: "approve",
          role: "livedExperienceRepresentative",
          actorId: livedExperienceRepresentative.id,
        },
      },
      writeAs(livedExperienceRepresentative, "pathway-approve-lived-experience-representative"),
    ),
  );
  taken(
    "pathwayVersion:publish",
    await store.transitionPathwayVersion(
      { pathwayVersionId: version, action: { type: "publish", actorId: clinicalProgrammeLead.id } },
      writeAs(clinicalProgrammeLead, "pathway-publish"),
    ),
  );

  // ---- Referrals ------------------------------------------------------------------------------
  for (const person of DEMO_SEED_PEOPLE) {
    const referral: ReferralId = referralId(person.referralIdentifier);
    taken(
      `createReferral:${person.key}`,
      await store.createReferral(
        { referralId: referral, patientId: patientId(person.patientIdentifier) },
        writeAs(coordinator, `referral-create-${person.key}`),
      ),
    );
    if (person.referralState === "accepted") {
      taken(
        `acceptReferral:${person.key}`,
        await store.transitionReferral(
          { referralId: referral, action: { type: "accept", pathwayVersionId: version } },
          writeAs(coordinator, `referral-accept-${person.key}`),
        ),
      );
    }
  }

  // ---- Plans ----------------------------------------------------------------------------------
  for (const person of DEMO_SEED_PEOPLE) {
    if (!person.plan) continue;
    const plan: PlanId = planId(person.plan.planIdentifier);

    // Per-plan, not the shared instant every plan used to take unmodified: see
    // `DemoPlanSeed.dischargeMonthsBeforeShared` for why shifting THIS plan's own discharge, rather
    // than the pathway snapshot's, is the honest lever for "a contact due today" -- and why it has
    // to be calendar months.
    const planDischargeAt = person.plan.dischargeMonthsBeforeShared
      ? shiftedPlanDischargeAt(dischargeAt, person.plan.dischargeMonthsBeforeShared, person.key)
      : dischargeAt;

    const created = taken(
      `createPlan:${person.key}`,
      await store.createPlan(
        {
          planId: plan,
          referralId: referralId(person.referralIdentifier),
          patientId: patientId(person.patientIdentifier),
          pathwayVersionId: version,
          dischargeAt: planDischargeAt,
          sendingPreference: person.plan.sendingPreference,
          // Required since Task 9b. The derived both-confirmed set: createPlan refuses anything
          // less, so a seed whose plans must exist can hold no other value, and taking the exported
          // set rather than a literal means a new assurance reaches the seed automatically.
          assurances: PLAN_ASSURANCE_VALUES,
          patientDetail: person.plan.patientDetail,
        },
        writeAs(coordinator, `plan-create-${person.key}`),
      ),
    );

    const activated = taken(
      `activatePlan:${person.key}`,
      await store.activatePlan(
        { planId: plan, expectedVersion: created.plan.version },
        writeAs(coordinator, `plan-activate-${person.key}`),
      ),
    );

    // ---- Ownership --------------------------------------------------------------------------
    // `claim` requires no plan state at all -- see ../assignment -- so this could run before or
    // after the pause/withdraw branches below with the same result. It runs here, against the
    // just-activated plan, because every seeded plan that claims is also one this seed leaves
    // active.
    if (person.plan.claimedByCoordinator) {
      taken(
        `assignment:claim:${person.key}`,
        await store.applyAssignment(
          { planId: plan, action: { type: "claim", actorId: coordinator.id } },
          writeAs(coordinator, `assignment-claim-${person.key}`),
        ),
      );
    }

    // ---- Dispatch -----------------------------------------------------------------------------
    // Real writes through the real four-step path (../repository's own doc comment on
    // `startContactDispatch`), attributed to the system actor and never to a human demo role --
    // see `demoSystemDispatcher`. `startContactDispatch` refuses anything but an active plan, so
    // this must run before any pause/withdraw below, not after.
    if (person.plan.attemptedContacts && person.plan.attemptedContacts.length > 0) {
      const contactsForPlan: readonly StoredContact[] = await store.listContacts(plan, { actor: coordinator });

      for (const attempt of person.plan.attemptedContacts) {
        const stored = contactsForPlan.find((entry) => entry.planned.cadenceLabel === attempt.cadenceLabel);
        if (!stored) {
          throw new DemoSeedRefusedError(
            `dispatch:${person.key}:${attempt.key}`,
            `no seeded contact carries the cadence label "${attempt.cadenceLabel}"`,
          );
        }

        const started = taken(
          `startContactDispatch:${person.key}:${attempt.key}`,
          await store.startContactDispatch(
            { planId: plan, contactId: stored.contact.id, expectedContactVersion: stored.contact.version },
            writeAs(dispatcher, `dispatch-start-${person.key}-${attempt.key}`),
          ),
        );
        const sent = taken(
          `recordContactSent:${person.key}:${attempt.key}`,
          await store.recordContactSent(
            { planId: plan, contactId: started.contact.id, expectedContactVersion: started.contact.version },
            writeAs(dispatcher, `dispatch-sent-${person.key}-${attempt.key}`),
          ),
        );
        taken(
          `recordContactProviderStatus:${person.key}:${attempt.key}`,
          await store.recordContactProviderStatus(
            {
              planId: plan,
              contactId: sent.contact.id,
              expectedContactVersion: sent.contact.version,
              status: attempt.outcome,
            },
            writeAs(dispatcher, `dispatch-status-${person.key}-${attempt.key}`),
          ),
        );
      }
    }

    if (person.plan.finalState === "paused") {
      taken(
        `pausePlan:${person.key}`,
        await store.pausePlan(
          { planId: plan, expectedVersion: activated.plan.version },
          writeAs(coordinator, `plan-pause-${person.key}`),
        ),
      );
    }

    if (person.plan.finalState === "withdrawn") {
      taken(
        `withdrawPlan:${person.key}`,
        await store.withdrawPlan(
          { planId: plan, expectedVersion: activated.plan.version, origin: "patient" },
          writeAs(coordinator, `plan-withdraw-${person.key}`),
        ),
      );
    }
  }

  return { populated: true };
}

/** The value of a write that succeeded. A refusal is raised, never absorbed -- see the class note. */
function taken<T>(step: string, result: TransitionResult<T>): T {
  if (!result.ok) throw new DemoSeedRefusedError(step, result.reason);
  return result.value;
}

/**
 * A plan's own discharge instant, shifted back `months` calendar months from the shared
 * `dischargeAt` the pathway snapshot uses -- see `DemoPlanSeed.dischargeMonthsBeforeShared` for why
 * this has to be calendar-month arithmetic rather than a fixed day count. Delegates the arithmetic
 * itself to `calendarDayPlusMonths`, the same function `buildApprovedSchedule`'s own Month-N cadence
 * is built from, so the two cannot disagree about what "N months earlier" means on a month-length
 * boundary -- a second, day-approximated copy of that arithmetic here could.
 *
 * `shared`'s own AWST calendar day is always a real one -- `awstCalendarDay` derives it from a live
 * `Date` -- so `calendarDayPlusMonths` refusing it would be a defect in that function, not a
 * possible outcome of this seed's own input. The refusal is still surfaced through
 * `DemoSeedRefusedError` rather than asserted away, for the same reason every other write below is:
 * a refusal is a finding, not a case to route around.
 */
function shiftedPlanDischargeAt(shared: Date, months: number, personKey: string): Date {
  const shiftedCalendarDay = calendarDayPlusMonths(awstCalendarDay(shared), -months);
  if (!shiftedCalendarDay) {
    throw new DemoSeedRefusedError(
      `discharge-shift:${personKey}`,
      "calendarDayPlusMonths refused the shared discharge instant's own AWST calendar day",
    );
  }
  // Midday, not midnight -- the same convention `awstCalendarDayOffset` uses (../clock.ts). Only
  // the AWST calendar day this instant carries is ever read back: `buildApprovedSchedule` takes it
  // through `awstCalendarDay`, and every screen that displays a plan's `dischargeAt` does too -- so
  // the hour chosen here is otherwise inert, and midday keeps it clear of a day boundary regardless.
  return awstWallTimeToInstant(shiftedCalendarDay, 12);
}

/**
 * Fixed, never-derived idempotency keys. Fixed is the point: a key that varied per run would make
 * a repeated seed a NEW write rather than a replay the store already knows the answer to.
 */
function writeAs(actor: CaringContactActor, label: string): WriteContext {
  return { actor, idempotencyKey: idempotencyKey(`demo-seed-${label}`) };
}

/**
 * The draft handed to `savePathwayVersion`. Only `id` and `snapshot` survive that call -- the store
 * constructs `state`, `authorId` and `approvals` itself, whatever is passed, so a caller cannot
 * seed a version that arrives pre-approved. The governance fields below are therefore the honest
 * shape of a draft, not an attempt to set them.
 */
function draftPathwayVersion(id: PathwayVersionId, author: Actor, dischargeAt: Date): PathwayVersion {
  return {
    id,
    teamId: author.teamId,
    state: "draft",
    authorId: author.id,
    approvals: Object.freeze([]),
    publishedAt: null,
    retiredAt: null,
    retirementUrgency: null,
    snapshot: pathwaySnapshot(dischargeAt),
  };
}

/**
 * The cadence labels are DERIVED from the schedule the domain really builds, never typed out here.
 * `buildApprovedSchedule` owns the twelve-month cadence, and a list written into this file would be
 * a second copy of it -- free to go on advertising a cadence the schedule had stopped producing, on
 * the screen where a coordinator chooses which pathway a discharged patient is put onto.
 */
function pathwaySnapshot(dischargeAt: Date): PathwayVersionSnapshot {
  const schedule = buildApprovedSchedule({ dischargeAt, sendingPreference: "morning" });
  if (!schedule.ok) throw new DemoSeedRefusedError("buildApprovedSchedule", schedule.reason);
  return Object.freeze({
    cadenceLabels: Object.freeze(schedule.contacts.map((contact) => contact.cadenceLabel)),
    messageTextByType: DEMO_SEED_MESSAGE_TEXT,
    // Ruling [126]. Stage 2 of the wizard prints "Approved by the clinical programme lead and the
    // lived-experience representative" for whatever it is offered, and for this version no person
    // recorded either approval. The marker is what lets that screen say so without knowing a seed
    // exists -- see PathwayVersionSnapshot.provenance.
    provenance: "syntheticDemonstration",
  });
}
