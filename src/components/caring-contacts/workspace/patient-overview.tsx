import { CalendarClock, ClipboardCheck, EyeOff } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { CARING_CONTACTS_ROUTES, patientPlanRoute } from "@/lib/caring-contacts-routes";
import { planAssuranceWording, type PlanAssuranceAttestation } from "@/lib/caring-contacts/assurances";
import { awstCalendarDay } from "@/lib/caring-contacts/clock";
import type { Episode } from "@/lib/caring-contacts/episode";
import type { InboundReplyWithText } from "@/lib/caring-contacts/inbound-replies";
import { contactSendability, type PlanState } from "@/lib/caring-contacts/model";
import {
  summariseStoredContacts,
  type PatientNameProjection,
  type PlanOutcome,
  type PlanRecord,
  type StoredContact,
  type StoredContactSummary,
} from "@/lib/caring-contacts/repository";

import { AutomatedState } from "./automated-state";
import { CONTACT_STATE_LABELS, MESSAGE_TYPE_LABELS } from "./contact-vocabulary";
import { ListEmptyState } from "./list-empty-state";
import { PatientReplies } from "./inbound-replies";
import { ExitOnlyOverlayTrigger } from "./overlays/exit-only-overlay-trigger";
import type { PlanActionsContext } from "./plan-action-rules";
import { PlanActions, PlanSyncProvider } from "./plan-actions";
import { MobileCheckPanel } from "./patient-updates/mobile-check-panel";
import { offeredUpdates, type PatientUpdatesContext } from "./patient-updates/patient-update-rules";
import { RecordAChange } from "./patient-updates/record-a-change";
import { workspacePanelPadded } from "./surfaces";
import { plural } from "./count-wording";

/**
 * One patient's caring-contact episode -- who they are, which plan is running, what has happened
 * on it, and what is still to come.
 *
 * THE SCREEN IS SCOPED TO ONE PLAN AND NEVER PICKS WHICH (Ruling 97)
 * -----------------------------------------------------------------
 * The route is keyed by PATIENT and every read in this domain is keyed by PLAN. One patient can
 * honestly hold two episodes -- `repository.ts` says so, and `markRetentionCleared` clears detail
 * per plan, so two plans for one person can legitimately differ in what they still hold. So this
 * component takes a `view` that has ALREADY been decided by the page:
 *
 *   * `"no-plan"` -- this team holds no plan for this patient. Deliberately the same answer the
 *     screen gives when the plan belongs to another team: `getPlan` gives one answer for both so
 *     that nobody can find out a record exists by being refused it, and this screen must not
 *     become the one that tells them apart.
 *   * `"not-permitted"` -- the acting role may not view plans at all. A fact about the ACTOR,
 *     decided by the page from the actor rather than inferred here from an empty list, exactly as
 *     `PatientsDirectory` decides `mayViewPlans`. `listPlans` answers such an actor with `[]`, the
 *     same answer it gives a patient with no plan, so a screen that only counted rows would tell
 *     an auditor this patient has no plan -- a false statement about a clinical record.
 *   * `"choose"` -- more than one plan and nothing in the URL naming one. The clinician picks. A
 *     screen that picked for them would put one plan's schedule under a heading carrying this
 *     patient's name, which is the error that matters most here.
 *   * `"episode"` -- one plan, and the episode the page read for it.
 *
 * WHAT THE EPISODE VIEW SHOWS OF THE PERSON
 * ----------------------------------------
 * `getEpisode` is the one read that releases the name, the mobile number, the identifiers and the
 * cultural identity together, and this is the one screen permitted to make it. All four are shown:
 * they are what makes the record this person's rather than somebody else's, the cultural identity
 * is what a caring-contact pathway is chosen against, and the mobile number is the destination the
 * whole plan is aimed at.
 *
 * The mobile number was withheld in the first version of this screen and the owner reversed that
 * (review round 1). It is on the identity strip beside the name rather than in a detail row, since
 * it is being shown deliberately and a reader looking for it should find it where identity lives.
 *
 * THE LICENCE DOES NOT TRAVEL. This screen may see the number because it already made the read
 * that releases it; nothing else in the workspace may. The caseload uses `listPatientNames`, whose
 * two-field return type structurally cannot carry a number, and no other surface calls
 * `getEpisode`. Do not add a read for it elsewhere, and do not widen one.
 *
 * It is rendered as TEXT, never as a `tel:` link. Nothing in this workspace dials anybody, every
 * number in it is invented, and a control that looked dialable would be the one thing on this
 * screen a reader might act on. The label says so in place.
 *
 * A BLANK NAME IS NOT A NAME, AND HERE THE CAUSE IS KNOWABLE
 * ---------------------------------------------------------
 * `CLEARED_PATIENT_DETAIL` is what both stores write once a retention clearance is recorded, so a
 * blank `patientName` means no name is held. `PatientsDirectory` cannot say WHY a name is missing,
 * because a role restriction and a cleared episode arrive there identically. This screen can: an
 * actor who could not read an episode receives no `Episode` at all, so a blank name on a released
 * episode is the clearance, not the role. The note says so.
 *
 * THE COUNT IS DERIVED, THE CLOSING MESSAGE IS ITS OWN KIND (Ruling 98)
 * --------------------------------------------------------------------
 * The approved mockup hard-codes "10 contacts over 12 months" and an `aria-label` of "Ten-contact
 * continuity". Both are wrong as literals. The cadence is Day 1, Week 1, then months 1, 2, 3, 4,
 * 6, 8, 10 and 12; Week 1 is SUPPRESSED exactly when the coordinator set the first contact to
 * discharge + 7, because two caring contacts must never land on one day, which makes that plan
 * nine sendable messages rather than ten; and the last entry is a CLOSING message, a different
 * kind from a caring contact. So every number on this screen is counted from `record.contacts`,
 * and the closing message is labelled as what it is.
 *
 * Sendability is keyed off `contact.state`, never off `planned.suppressed`, for the reason
 * `PatientsDirectory` records: the schedule's absorption is not the only way a contact becomes
 * suppressed -- `applyContactTransition`'s `suppress` action can move any live contact there
 * later, and such a contact carries no `planned.suppressed` marker. Counting the plan rather than
 * the outcome would leave those with no explanation at all.
 *
 * `Episode.counts.contactsScheduled` is deliberately NOT used for that number. It counts entries
 * whose `planned.suppressed` is undefined, so after a later `suppress` transition it would report
 * a message as still to be sent that never will be. `contactsSent` and `contactsDelivered` are
 * keyed off contact state and are used as the module's own.
 *
 * EVERY SYSTEM-REACHED STATE STATES ITS REASON IN PLACE (spec 4.4)
 * ---------------------------------------------------------------
 * A suppressed entry and a moved first contact are both things the reader will otherwise have to
 * account for by guessing. Each carries its reason beside it, in plain words, on the same screen.
 * The moved first contact's RECORDED reason is now held with the plan and shown here verbatim
 * (Ruling 105): it travels on the episode rather than on the plan record, because it is free text
 * a clinician wrote about this patient. When none is held the screen says WHICH absence it is
 * looking at — a role that may not read the episode, a retention clearance, or a plan older than
 * the field — rather than reporting one absence for three different facts. See `FirstContact`.
 *
 * THIS SCREEN IS THE PLAN DETAIL, AND THERE IS NO SECOND ROUTE (Ruling [128])
 * -------------------------------------------------------------------------
 * "Plan and contact detail" reads like two more routes and is neither. Plan detail is
 * `/caring-contacts/patients/[patientId]?plan=<planId>` -- this screen, deepened -- and contact
 * detail is the `delivery-detail` OVERLAY, which `docs/caring-contacts/interaction-matrix.md` lists
 * as a full-screen stage on a phone and an inspection drawer on a desktop, `mutation: No`.
 *
 * A `/caring-contacts/plans/[planId]` route would be a second surface that must independently
 * re-validate that the plan belongs to this patient AND this team, which is the failure this domain
 * guards against hardest; `CARING_CONTACTS_ROUTES` carries no key for it, which is the routes module
 * saying the same thing. So the deepening adds NO read either: the attestations travel on
 * `PlanRecord` (Ruling [122]) and the first-contact reason on `Episode` (Ruling [105]), both of
 * which the page has already read for this plan. Per Ruling [46] the deliberate conclusion is that
 * no new `AccessedObjectType` member is owed, because there is no new object being read -- adding
 * one would put a second name on the trail for a read that did not happen.
 *
 * THE TWO STORED FIELDS THAT MOVE IN OPPOSITE DIRECTIONS, ON ONE SCREEN
 * --------------------------------------------------------------------
 * The first-contact reason is CLEARED by a retention clearance (Ruling [105]) because it is
 * clinician prose that will name patients and places. The attestation is PRESERVED (Ruling [122])
 * because it is an act, an actor and an instant with no patient content -- the same class as an
 * audit event, which de-identification deliberately keeps. `FirstContactReason` and
 * `PlanAssurances` below are the two halves, and a cleared plan renders both at once: the reason
 * states which absence it is, and the attestation is still there beside it.
 *
 * WHAT THE ATTESTATION MAY NOT BE READ AS. It records that a coordinator confirmed they checked the
 * hospital record. Nothing here may say the patient consented: the agreement lives in that record
 * and not in this system. The wording says "recorded on the plan" rather than "stored" or "kept",
 * because this system distinguishes held in a tab's storage from written onto the plan and ordinary
 * English does not.
 *
 * THE PLAN ACTIONS ARE THIS SCREEN'S, AND THEY ARE THE ONLY CONTROLS THAT STOP THE PROGRAMME
 * ------------------------------------------------------------------------------------------
 * `docs/caring-contacts/interaction-matrix.md` puts `pause`, `withdrawal` and `reassignment` under
 * "Plan actions" and "Plan/team actions", and plan detail is this screen (Ruling [128]). They write,
 * so they live in `plan-actions.tsx` on the client side of the seam -- a Server Component cannot
 * pass a commit function across it -- and everything that reaches them is plain data this file and
 * the page resolved. In particular every role reaches them as WORDS: actor identifiers here are
 * `demo-<role>`, and a raw role identifier is never put in front of a clinician.
 *
 * A Server Component with no hooks of its own (Ruling 13). The chooser is a set of `<Link>`s that
 * put the choice in the URL; nothing on this screen needs JavaScript to READ it. Two client
 * components are rendered beneath it: `ExitOnlyOverlayTrigger`, the smallest control that can raise
 * the `delivery-detail` and `activation-success` drawers, and `PlanActions`, which owns the three
 * mutating rows and the resume that pause owes.
 */

const PLAN_STATE_LABELS: Readonly<Record<PlanState, string>> = Object.freeze({
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  withdrawn: "Withdrawn",
  cancelled: "Cancelled",
  completed: "Completed",
});

const PLAN_OUTCOME_LABELS: Readonly<Record<PlanOutcome, string>> = Object.freeze({
  inProgress: "In progress",
  withdrawn: "Withdrawn",
  cancelled: "Cancelled",
  completed: "Completed",
});

/** The programme's usual first contact: the day after discharge. */
const DEFAULT_FIRST_CONTACT_OFFSET_DAYS = 1;
const MILLISECONDS_PER_DAY = 86_400_000;

export type PatientOverviewView =
  | { kind: "no-plan" }
  | { kind: "not-permitted" }
  | {
      kind: "choose";
      /** Every plan this team holds for this patient, in the order the read released them. */
      plans: readonly PlanRecord[];
      /** The names-only read (Ruling 91). A chooser does not need a mobile number. */
      patientNames: readonly PatientNameProjection[];
    }
  | {
      kind: "episode";
      record: PlanRecord;
      /**
       * Everything the plan-actions surface needs, resolved by the page from the actor, the plan
       * and the assignment. Serialisable throughout: it crosses a client boundary.
       */
      actions: PlanActionsContext;
      /**
       * Null when the acting role may not read an episode -- decided by the page from the actor,
       * never inferred here. The plan is still shown; the person is not.
       */
      episode: Episode | null;
      /** How many OTHER plans this team holds for this patient, so the reader knows this is one of several. */
      otherPlanCount: number;
      /**
       * Incoming text messages (2026-09-26): this plan's replies from the patient, with their
       * words. Null (or absent) when the acting role may not read them; the section is then absent.
       */
      inboundReplies?: readonly InboundReplyWithText[] | null;
      /** Whether the acting role holds `followUpInboundReply`, decided by the page. */
      mayFollowUpReplies?: boolean;
      /**
       * "Record a change" and "Check the number", resolved by the page from the actor and the plan.
       * Optional: absent renders neither, which is also what a role without the capability sees.
       */
      updates?: PatientUpdatesContext;
    };

export type PatientOverviewProps = {
  /** The synthetic patient identifier from the URL, already decoded by the framework. */
  patientId: string;
  view: PatientOverviewView;
};

export function PatientOverview({ patientId, view }: PatientOverviewProps) {
  if (view.kind === "not-permitted") {
    return (
      <section className="min-w-0">
        <ListEmptyState
          kind="not-permitted"
          heading="Plans are not visible in this role"
          because="Viewing plans is not part of the role you are acting in. This says nothing about whether this team holds a plan for this patient: a read you may not make and a patient with no plan look identical on purpose, so that nobody can find out a record exists by being refused it."
          changedBy="Nothing on this screen changes it, and there is no control for it anywhere in this workspace yet. The role this demonstration acts in is set outside the interface; a coordinator sees this team's plans."
          action={<BackToPatients />}
        />
      </section>
    );
  }

  if (view.kind === "no-plan") {
    return (
      <section className="min-w-0">
        <ListEmptyState
          kind="no-data"
          heading="No plan for this patient"
          explanation={`This team holds no caring-contact plan for ${patientId}. If another team holds one for this person, this screen answers exactly as it does when no plan exists anywhere, so that nobody can find out a record exists by being refused it.`}
          action={<BackToPatients />}
        />
      </section>
    );
  }

  if (view.kind === "choose") {
    return <PlanChooser patientId={patientId} plans={view.plans} patientNames={view.patientNames} />;
  }

  return (
    <EpisodeOverview
      patientId={patientId}
      record={view.record}
      episode={view.episode}
      otherPlanCount={view.otherPlanCount}
      actions={view.actions}
      inboundReplies={view.inboundReplies ?? null}
      mayFollowUpReplies={view.mayFollowUpReplies ?? false}
      updates={view.updates}
    />
  );
}

/**
 * The card around each surface, rendered only when the surface has something to offer, so an
 * ended plan or a read-only role does not see an empty card. The decision is the rules module's.
 */
function RecordAChangeCard({
  updates,
  detail,
}: {
  updates: PatientUpdatesContext;
  detail: Parameters<typeof RecordAChange>[0]["detail"];
}) {
  const offered = offeredUpdates(updates, updates.planState);
  if (
    !offered.readmission &&
    !offered.death &&
    !offered.deathCorrection &&
    !(offered.contactDetail && detail !== null)
  ) {
    return null;
  }
  return (
    <div className={cardClass}>
      <RecordAChange context={updates} detail={detail} />
    </div>
  );
}

function MobileCheckCard({ updates }: { updates: PatientUpdatesContext }) {
  if (!offeredUpdates(updates, updates.planState).mobileCheck) return null;
  return (
    <div className={cardClass}>
      <MobileCheckPanel context={updates} />
    </div>
  );
}

function BackToPatients() {
  return (
    <Link
      href={CARING_CONTACTS_ROUTES.patients}
      data-internal-link="true"
      className="inline-flex min-h-tap items-center justify-center rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-4 text-sm font-semibold text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] forced-colors:border-[CanvasText]"
    >
      Back to this team&rsquo;s plans
    </Link>
  );
}

const cardClass = workspacePanelPadded;

/**
 * Label-and-value rows, one definition list per card. The label column is fixed from `sm` so the
 * values line up down the card; on a phone each label sits above its value. The label keeps its
 * trailing colon and space so the row still reads as one sentence to a screen reader and in tests.
 */
const fieldListClass = "grid min-w-0 gap-y-2 text-sm leading-6";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-x-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
      <dt className="font-medium text-[color:var(--text)]">{label}: </dt>
      <dd className="min-w-0 break-words text-[color:var(--text-muted)]">{children}</dd>
    </div>
  );
}

const rowLinkClass =
  "flex min-h-tap min-w-0 flex-col justify-center rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] forced-colors:border-[CanvasText]";

/**
 * More than one plan, and nothing in the URL naming one.
 *
 * The name comes from `listPatientNames` (Ruling 91), never from `getEpisode`: choosing between
 * two plans needs a name to recognise the person by and nothing else, and `getEpisode` would
 * release four identifying fields to answer a question about which plan to open. It is also
 * keyed by PLAN, and that matters here more than anywhere else in the workspace -- a retention
 * clearance is recorded per plan, so one of this patient's two plans can hold a name while the
 * other does not, and the chooser shows each row's own answer rather than one name for both.
 */
function PlanChooser({
  patientId,
  plans,
  patientNames,
}: {
  patientId: string;
  plans: readonly PlanRecord[];
  patientNames: readonly PatientNameProjection[];
}) {
  // A cleared plan's name is the empty string both stores write for a removed one, so it is
  // dropped here rather than at each row: an empty name is "no name held", never a name.
  const nameByPlan = new Map(
    patientNames.filter((entry) => entry.patientName !== "").map((entry) => [entry.planId, entry.patientName]),
  );
  const anyName = plans.map((record) => nameByPlan.get(record.plan.id)).find((name) => name !== undefined) ?? null;

  return (
    <section aria-labelledby="caring-contacts-plan-chooser-heading" className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-[color:var(--text-muted)]">
        {anyName === null ? "Synthetic patient identifier" : "Patient"}
      </p>
      <p className="mt-0.5 break-words text-sm font-semibold text-[color:var(--text-heading)]">
        {anyName ?? patientId}
      </p>
      <h2
        id="caring-contacts-plan-chooser-heading"
        className="mt-4 text-base font-semibold text-[color:var(--text-heading)]"
      >
        This patient has more than one plan
      </h2>
      <p className="mt-2 max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
        Choose which plan to open. This screen shows one plan at a time and will not choose for you: two plans for one
        person can hold different things, because a retention clearance is recorded against a plan rather than against a
        patient, and one plan&rsquo;s schedule shown under this patient&rsquo;s name without saying which plan it is
        would be the worst mistake this screen could make.
      </p>

      <ul className="mt-4 flex min-w-0 flex-col gap-3">
        {plans.map((record) => {
          const name = nameByPlan.get(record.plan.id) ?? null;
          return (
            <li key={record.plan.id} className="min-w-0">
              <Link
                href={patientPlanRoute(patientId, record.plan.id)}
                data-internal-link="true"
                className={rowLinkClass}
              >
                <span className="truncate text-sm font-semibold text-[color:var(--text-heading)]">
                  Plan {record.plan.id}
                </span>
                <span className="mt-0.5 truncate text-sm text-[color:var(--text-muted)]">
                  {PLAN_STATE_LABELS[record.plan.state]} &middot; discharged {awstCalendarDay(record.dischargeAt)}{" "}
                  (AWST) &middot; {name === null ? "no name held for this plan" : name}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-5">
        <BackToPatients />
      </div>
    </section>
  );
}

function EpisodeOverview({
  patientId,
  record,
  episode,
  otherPlanCount,
  actions,
  inboundReplies,
  mayFollowUpReplies,
  updates,
}: {
  patientId: string;
  record: PlanRecord;
  episode: Episode | null;
  otherPlanCount: number;
  actions: PlanActionsContext;
  inboundReplies: readonly InboundReplyWithText[] | null;
  mayFollowUpReplies: boolean;
  updates?: PatientUpdatesContext;
}) {
  const name = episode !== null && episode.patientName !== "" ? episode.patientName : null;
  const entries = [...record.contacts].sort((left, right) => left.planned.sequence - right.planned.sequence);
  // The counts come from the domain (`summariseStoredContacts` -> `contactSendability`), not from
  // a predicate written here. The first version of this screen counted "not suppressed" as "will
  // be sent", which is narrower than the truth and wrong on a path ordinary writes reach:
  // `withdrawPlan` and `recordHospitalStatusEvent` cancel every unsent contact, so a withdrawn
  // plan -- or one stopped by a recorded death -- was announced as ten messages still to come.
  const summary = summariseStoredContacts(entries);
  const firstContact = entries.find((entry) => entry.planned.messageType === "first") ?? entries[0];
  const notRunning = planNotRunningNote(record.plan.state, summary);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {/*
        Who the patient is and which plan this is, side by side from 1280px so a desktop reader sees
        both without scrolling; stacked below that. DOM order is unchanged, so the reading order is
        the same at every width.
      */}
      <div className="grid min-w-0 gap-5 xl:grid-cols-2 xl:items-start">
        <section aria-labelledby="caring-contacts-patient-heading" className={cardClass}>
          <p className="text-xs font-medium uppercase tracking-wide text-[color:var(--text-muted)]">
            {name === null ? "Synthetic patient identifier" : "Patient"}
          </p>
          <h2
            id="caring-contacts-patient-heading"
            className="mt-0.5 break-words text-lg font-semibold text-[color:var(--text-heading)]"
          >
            {name ?? patientId}
          </h2>
          {name === null ? null : (
            <p className="mt-0.5 break-words text-xs text-[color:var(--text-muted)]">
              Synthetic identifier: {patientId}
            </p>
          )}

          {/*
          Beside the name, not in a detail row below: the number is shown deliberately, so it sits
          where identity lives. Text, never a `tel:` link -- see the module note.

          A blank is the retention clearance's own value (`CLEARED_PATIENT_DETAIL`), exactly as a
          blank name is, so it is stated as "no number held" rather than rendered as an empty gap
          that a reader would have to interpret. `episode === null` is the role case and prints
          nothing at all here; the notice below says why.
        */}
          {episode === null ? null : (
            <dl className={`mt-3 ${fieldListClass}`}>
              <Field label="Mobile number">
                {episode.patientMobileNumber === "" ? (
                  "no number held for this episode"
                ) : (
                  <>
                    {episode.patientMobileNumber}{" "}
                    <span className="text-xs">&mdash; invented, and nothing in this workspace is ever sent to it</span>
                  </>
                )}
              </Field>
              {/*
              THE NAME THE MESSAGES OPEN WITH, AND ITS THREE STATES KEPT APART.

              A cleared episode and one that never held a preferred name are different facts and must
              not read as the same one. `""` is the retention clearance's own value
              (`CLEARED_PATIENT_DETAIL.preferredName`), exactly as a blank name and a blank number are;
              `null` is an episode that predates the field, or one whose caller supplied none. Each gets
              its own sentence, and NEITHER names a cause the record cannot support -- "removed when this
              episode was de-identified" is an act this record does hold, and "none is held" says only
              what is true now rather than guessing why (see `Episode.preferredName`).
            */}
              <Field label="Called this in messages">
                {episode.preferredName === null
                  ? "none is held for this episode"
                  : episode.preferredName === ""
                    ? "removed when this episode was de-identified"
                    : episode.preferredName}
              </Field>
              {episode.patientIdentifiers.length > 0 ? (
                <Field label="Other identifiers">{episode.patientIdentifiers.join(", ")}</Field>
              ) : null}
              {episode.culturalIdentity !== null ? (
                <Field label="Cultural identity">{episode.culturalIdentity}</Field>
              ) : null}
            </dl>
          )}

          {episode === null ? (
            <div className="mt-3 min-w-0">
              <EpisodeNotPermittedNotice />
            </div>
          ) : null}
          {episode !== null && episode.patientName === "" ? (
            <div className="mt-3 min-w-0">
              {/*
              THE ABSENCE IS OBSERVED HERE; THE CAUSE IS NOT INFERRED FROM IT (#J7PZQP).
              "No name is held" is a true reading of a blank name. "A retention clearance emptied
              it" is a separate claim, and this screen used to derive the second from the first --
              which held only because a Zod schema at the API route happened to reject a blank name
              on the way in. The episode now carries the clearance instant, so the notice is told
              whether one was recorded rather than deducing it.
            */}
              <NoNameHeldNotice
                patientDetailClearedAt={episode.patientDetailClearedAt}
                mobileNumberHeld={episode.patientMobileNumber !== ""}
              />
            </div>
          ) : null}

          {/*
          THE WITHDRAWAL REASON (owner-approved 2026-09-26). Optional, so its absence is stated as
          "no reason is held" and never given a cause: none may have been given, or a clearance may
          have removed it with the rest of the patient detail. It is a clinician's own words about
          this patient, so it is shown verbatim and only here, on the episode read.
        */}
          {episode !== null && record.plan.state === "withdrawn" ? (
            <p
              className="mt-3 max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]"
              data-testid="caring-contacts-withdrawal-reason"
            >
              <span className="font-medium text-[color:var(--text)]">Withdrawal reason: </span>
              {episode.withdrawalReason === null ? (
                "no reason is held for this withdrawal."
              ) : (
                <>&ldquo;{episode.withdrawalReason}&rdquo;</>
              )}
            </p>
          ) : null}

          <p className="mt-3 max-w-[var(--measure)] text-xs leading-5 text-[color:var(--text-muted)]">
            This patient is invented, and so is every identifier and number held against them.
          </p>
        </section>

        <section aria-labelledby="caring-contacts-plan-heading" className={cardClass}>
          <h2 id="caring-contacts-plan-heading" className="text-base font-semibold text-[color:var(--text-heading)]">
            This plan
          </h2>
          <dl data-testid="caring-contacts-plan-summary" className={`mt-3 min-w-0 ${fieldListClass}`}>
            <Field label="Plan">{record.plan.id}</Field>
            <Field label="Plan state">{PLAN_STATE_LABELS[record.plan.state]}</Field>
            <Field label="Outcome">{PLAN_OUTCOME_LABELS[record.outcome]}</Field>
            {/*
            Every date in the schedule hangs off the AWST discharge DAY, never off UTC and never
            off the first contact, so this is the anchor a clinician checks the rest against.
          */}
            <Field label="Discharged">{awstCalendarDay(record.dischargeAt)} (AWST)</Field>
            <Field label="Ended">
              {record.completedAt === null
                ? "not yet — this episode is still open"
                : `${awstCalendarDay(record.completedAt)} (AWST)`}
            </Field>
            <Field label="Pathway version">{record.pathwayVersionId}</Field>
            {episode === null ? null : (
              <Field label="Transport so far">
                {plural(episode.counts.contactsSent, "message sent", "messages sent")}, of which{" "}
                {plural(episode.counts.contactsDelivered, "carries a delivery receipt", "carry a delivery receipt")}.
              </Field>
            )}
          </dl>

          {otherPlanCount > 0 ? (
            <p className="mt-3 max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
              This team holds {plural(otherPlanCount, "other plan", "other plans")} for this patient.{" "}
              <Link
                href={CARING_CONTACTS_ROUTES.patients}
                data-internal-link="true"
                className="underline decoration-[color:var(--border-strong)] underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
              >
                This team&rsquo;s plans
              </Link>{" "}
              lists them.
            </p>
          ) : null}

          {firstContact === undefined ? null : (
            <div data-testid="caring-contacts-first-contact" className="mt-3 min-w-0">
              <FirstContact record={record} episode={episode} firstContact={firstContact} />
            </div>
          )}
        </section>
      </div>

      {/* Incoming text messages (2026-09-26): the patient's replies, directly under the plan they act on. */}
      {inboundReplies !== null ? <PatientReplies replies={inboundReplies} mayFollowUp={mayFollowUpReplies} /> : null}

      <PlanAssurances attestations={record.assuranceAttestations} planState={record.plan.state} />

      {/*
        The frozen matrix's three plan actions, on the screen its own "Plan actions" context names.
        The card is this screen's; what each control does, and what it refuses, is decided in
        `plan-action-rules.ts` from what the domain does.
      */}
      {/*
        The actions sit two-up from 1280px: the plan's own actions on the left, and what has happened
        to the patient plus the number check on the right. Stacked in the same order below that.
      */}
      {/*
        One provider around all three writing panels, so a write in any of them hands the others the
        plan's new version and blocks them while it is in flight. See `plan-sync.ts`.
      */}
      <PlanSyncProvider>
        <div className="grid min-w-0 gap-5 xl:grid-cols-2 xl:items-start">
          <div className={cardClass}>
            <PlanActions context={actions} />
          </div>

          {/*
        What has happened to the patient since discharge, and the test text to their number. Both
        write, so both live in client components beside the plan actions; each renders nothing when
        the role or the plan's state leaves it nothing the service would accept. The contact detail
        edits need the episode read, because nobody should change a number they cannot see.
      */}
          {updates === undefined ? null : (
            <div className="flex min-w-0 flex-col gap-5">
              <RecordAChangeCard
                updates={updates}
                detail={
                  episode === null
                    ? null
                    : {
                        patientName: episode.patientName,
                        preferredName: episode.preferredName,
                        patientMobileNumber: episode.patientMobileNumber,
                      }
                }
              />
              <MobileCheckCard updates={updates} />
            </div>
          )}
        </div>
      </PlanSyncProvider>

      <section aria-labelledby="caring-contacts-schedule-heading" className={cardClass}>
        <div className="min-w-0">
          <h2
            id="caring-contacts-schedule-heading"
            className="text-base font-semibold text-[color:var(--text-heading)]"
          >
            Twelve-month schedule
          </h2>
          {/*
            Counted from the plan's own entries every render (Ruling 98). The approved mockup
            says "10 contacts over 12 months"; that is true only while nothing is suppressed,
            and a plan whose first contact is discharge + 7 has nine sendable messages.
          */}
          <p
            data-testid="caring-contacts-schedule-summary"
            className="mt-2 max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]"
          >
            {scheduleSummarySentence(summary)}
          </p>
        </div>

        {/*
          The sentence above is about the RECORD; this says whether the plan it belongs to is
          running. See `planNotRunningNote` -- the two are different questions and only one of them
          `contactSendability` can answer.

          The `UnavailableDestination` that used to sit here pointed at "the plan detail", which is
          now this screen (Ruling [128]). A control offering to take a clinician to the screen they
          are already on is worse than no control.
        */}
        {notRunning === null ? null : (
          <div className="mt-3 min-w-0">
            <AutomatedState state={notRunning.state} because={notRunning.because} changedBy={notRunning.changedBy} />
          </div>
        )}

        <ul aria-label="Twelve-month schedule" className="mt-4 grid min-w-0 gap-3 lg:grid-cols-2">
          {entries.map((entry) => (
            <ScheduleEntry key={entry.contact.id} entry={entry} plan={record} />
          ))}
        </ul>

        <p className="mt-4 max-w-[var(--measure)] text-xs leading-5 text-[color:var(--text-muted)]">
          A delivery receipt is what the message provider reported about the message. It says nothing about the patient,
          and nothing here is ever sent to a real number.
        </p>
      </section>

      <div>
        <BackToPatients />
      </div>
    </div>
  );
}

/**
 * The first contact date, and — when it is not the programme's usual day — why it moved.
 *
 * Ruling 96 puts the CONTROL on the review-and-activation screen (Tasks 7-9) and the DISPLAY here.
 * Spec 4.4 makes the display a contract: wherever an earlier decision has moved something, the
 * surface stating it must also state why, in plain words, where the reader is looking. So the
 * reason is rendered IN PLACE beside the date — a reason reachable only by hovering has not been
 * stated.
 *
 * THE REASON COMES FROM THE EPISODE, WHICH IS WHY THIS TAKES ONE (Ruling 105)
 * ---------------------------------------------------------------------------
 * It is free text a clinician wrote about this patient, so it is held with the name, the mobile
 * number and the identifiers, and released by the one read that releases those. It is deliberately
 * NOT on `PlanRecord`: that is what the caseload renders for every patient in the team, and a
 * clinical note has no business being fetched for a list screen. `record` therefore cannot answer
 * this question and `episode` can, which is exactly the shape the placement was chosen for.
 *
 * FOUR CASES, AND THEY ARE DIFFERENT FACTS (Ruling 108)
 * ----------------------------------------------------
 * A moved date with nothing beside it has more than one cause, and this screen states which one it
 * is holding rather than picking the tidiest:
 *
 *   * the date is the usual day — no reason was ever required, so none is missing;
 *   * a reason is held — show it, verbatim, beside the date;
 *   * the episode was not released to this role — the plan is visible and the person is not, so the
 *     reason is not this screen's to show and its absence says nothing about whether one exists;
 *   * the episode was released and holds no reason — either a retention clearance removed it with
 *     the rest of the patient detail, which this screen can tell from the blank name exactly as
 *     `NoNameHeldNotice` does, or the plan predates the reason being kept at all.
 *
 * That last case is real and will persist: plans created before this field existed hold null
 * forever, and no placeholder was migrated into them. It is stated as the record's own history, not
 * as a coordinator having failed to give a reason — one WAS required and given, because
 * `buildApprovedSchedule` refuses any offset other than discharge + 1 without a non-blank one.
 * There was simply nowhere to keep it.
 */
function FirstContact({
  record,
  episode,
  firstContact,
}: {
  record: PlanRecord;
  episode: Episode | null;
  firstContact: StoredContact;
}) {
  const day = firstContact.planned.calendarDay;
  const offset = calendarDaysBetween(awstCalendarDay(record.dischargeAt), day);

  if (offset === DEFAULT_FIRST_CONTACT_OFFSET_DAYS) {
    return (
      <p className="text-sm leading-6 text-[color:var(--text-muted)]">
        <span className="font-medium text-[color:var(--text)]">First contact: </span>
        {day} (AWST) — the day after discharge, which is this programme&rsquo;s usual first contact.
      </p>
    );
  }

  const heading = "First contact moved from the usual day";
  const moved = `This plan's first contact is ${day}, ${plural(offset, "day", "days")} after discharge rather than the usual one.`;

  return (
    <>
      <p className="text-sm leading-6 text-[color:var(--text-muted)]">
        <span className="font-medium text-[color:var(--text)]">First contact: </span>
        {day} (AWST)
      </p>
      <div
        role="note"
        aria-label={heading}
        className="mt-2 flex min-w-0 flex-col gap-1 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2 forced-colors:border-[CanvasText]"
      >
        <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[color:var(--text-heading)]">
          <CalendarClock aria-hidden="true" className="size-icon-md shrink-0" />
          <span className="min-w-0">{heading}</span>
        </p>
        <FirstContactReason moved={moved} episode={episode} />
      </div>
    </>
  );
}

/**
 * The "Why" and "What changes it" pair inside the moved-first-contact note.
 *
 * Split out so each of the four cases is one branch returning one pair, rather than a nest of
 * conditionals inside the markup. The wording of each is the point of this component: they are four
 * different statements about what the record holds, and collapsing any two of them would make the
 * screen say something it does not know.
 */
function FirstContactReason({ moved, episode }: { moved: string; episode: Episode | null }) {
  const reason = episode === null ? null : episode.firstContactReason;

  // A reason is held. It is a clinician's own words, so it is rendered verbatim and attributed,
  // never paraphrased or summarised into the sentence around it.
  if (reason !== null) {
    return (
      <>
        <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
          <span className="font-medium text-[color:var(--text)]">Why: </span>
          {moved} The coordinator who created it gave this reason: &ldquo;{reason}&rdquo;
        </p>
        <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
          <span className="font-medium text-[color:var(--text)]">What changes it: </span>
          Nothing on this screen. The date and its reason are set when the plan is created, and the rest of the
          twelve-month schedule hangs off the discharge day rather than off this date, so moving it moves this message
          alone.
        </p>
      </>
    );
  }

  // The role may list plans but may not read an episode, so the reason was never released to this
  // screen. Its absence is a fact about the ACTOR and says nothing about what the plan holds --
  // decided by the page from the actor, exactly as `EpisodeNotPermittedNotice` above is.
  if (episode === null) {
    return (
      <>
        <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
          <span className="font-medium text-[color:var(--text)]">Why: </span>
          {moved} A coordinator has to give a reason before a plan can be created with a moved first contact. That
          reason is part of this patient&rsquo;s record, which is not visible in the role you are acting in, so this
          screen is not showing it — that says nothing about whether one is held.
        </p>
        <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
          <span className="font-medium text-[color:var(--text)]">What changes it: </span>
          Nothing on this screen, and there is no control for it anywhere in this workspace yet. The role this
          demonstration acts in is set outside the interface.
        </p>
      </>
    );
  }

  // The episode WAS released, holds no reason, and CARRIES A RECORDED CLEARANCE (#J7PZQP).
  //
  // This used to read `episode.patientName === ""` and conclude the clearance from it. The comment
  // here said "a blank name here can only be the clearance", which was not true of the domain: the
  // column is `not null` with no CHECK, neither store's `createPlan` validates a non-blank name,
  // and the whole guarantee was `z.string().min(1)` in the plans API route. A plan that reached the
  // store with a blank name any other way made this screen tell a clinician that a reason was
  // given, that a clearance removed it, and that the removal is irreversible -- three definite
  // statements about a live record, from a sentinel that meant two things at once.
  //
  // The instant is now carried on the episode, so this is a read rather than a deduction.
  if (episode.patientDetailClearedAt !== null) {
    return (
      <>
        <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
          <span className="font-medium text-[color:var(--text)]">Why: </span>
          {moved} A coordinator has to give a reason before a plan can be created with a moved first contact, and one
          was given for this plan. A retention clearance has since removed it, along with the name, the mobile number,
          the identifiers and the cultural identity — the reason is a clinician&rsquo;s free text about this patient, so
          it is removed with the rest of them.
        </p>
        <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
          <span className="font-medium text-[color:var(--text)]">What changes it: </span>
          Nothing, here or anywhere. A clearance is not reversible, and the date above is what the record still holds.
        </p>
      </>
    );
  }

  return (
    <>
      <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
        <span className="font-medium text-[color:var(--text)]">Why: </span>
        {moved} A coordinator has to give a reason before a plan can be created with a moved first contact, and one was
        given for this plan. It is not held: this plan was created before reasons were kept with the plan, so there was
        nowhere to put it. Nobody failed to give one.
      </p>
      <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
        <span className="font-medium text-[color:var(--text)]">What changes it: </span>
        Nothing, for this plan. Reasons given from now on are kept with the plan and shown here; an older plan cannot
        gain one after the fact, and inventing a sentence to fill the gap would be worse than the gap.
      </p>
    </>
  );
}

/**
 * One entry in the schedule: what it is, when it goes, and — if it will not go — why not.
 *
 * The explanation covers every state the domain classifies as `willNotBeSent`, not suppression
 * alone. Ruling 98 named only the absorbed Week 1, but a contact CANCELLED when a plan was
 * withdrawn or a death was recorded is just as much the system having acted on its own, and spec
 * 4.4 does not care which of them it is: a row reading "Caring contact · Cancelled" with nothing
 * beside it is the bare status chip that rule exists to prevent.
 *
 * `plan` is passed for one reason: a cancelled contact on a plan that has ENDED can be explained
 * exactly, while a cancelled contact on a plan still running cannot, and the row must not claim the
 * first when it is looking at the second.
 */
function ScheduleEntry({ entry, plan }: { entry: StoredContact; plan: PlanRecord }) {
  const explanation = notSentExplanation(entry, plan);

  return (
    <li className="min-w-0 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-3 forced-colors:border-[CanvasText]">
      <p className="min-w-0 text-sm font-semibold text-[color:var(--text-heading)]">
        {entry.planned.cadenceLabel} &middot; {entry.planned.calendarDay} (AWST)
      </p>
      <p className="mt-0.5 text-sm leading-6 text-[color:var(--text-muted)]">
        {MESSAGE_TYPE_LABELS[entry.planned.messageType]} &middot; {CONTACT_STATE_LABELS[entry.contact.state]}
      </p>
      {entry.planned.messageType === "closing" ? (
        <p className="mt-0.5 max-w-[var(--measure)] text-xs leading-5 text-[color:var(--text-muted)]">
          The last message in the plan. It closes the twelve months and is not one more caring contact.
        </p>
      ) : null}
      {explanation === null ? null : (
        <div className="mt-2 min-w-0">
          <AutomatedState
            state={CONTACT_STATE_LABELS[entry.contact.state]}
            because={explanation.because}
            changedBy={explanation.changedBy}
          />
        </div>
      )}
      {/*
        CONTACT DETAIL: the `delivery-detail` row of the frozen matrix, and its ONLY inbound path in
        this workspace.

        Offered exactly where the domain says a message left. `contactSendability` is asked rather
        than a list of states written out here, for the reason `summariseStoredContacts` exists: that
        classification lives beside the state machine that produces it, and a screen holding a second
        copy of it is the defect this module has already paid for once. A scheduled, suppressed,
        cancelled or missed message has no transport report, so a control promising one would open a
        drawer about nothing.

        WHAT THE DRAWER CAN AND CANNOT SAY, stated here because it is a real limit rather than a
        choice. `OverlayHost` renders each row's frozen `summary` and takes no children, so the
        overlay cannot name the contact it was opened from -- it states what a transport report is
        and is not, which is the row's own copy. The per-contact fact therefore stays ON this row,
        above, where `CONTACT_STATE_LABELS` already labels every provider state as a receipt.

        SO THE LABEL PROMISES ONLY WHAT THE DRAWER HOLDS. The first version read "What the phone
        network reported -- Day 1", which advertises this contact's own report and then opens a
        surface holding no contact data at all. Disclosing that in a comment is not discharging it.
        The visible words are now generic, because the drawer is generic; the cadence label follows
        as the control's ORIGIN, which is what tells one schedule row's control from another's for a
        reader who cannot see which row it sits in, and it claims nothing about what opens.
      */}
      {contactSendability(entry.contact.state) === "alreadySent" ? (
        <div className="mt-2 min-w-0">
          <ExitOnlyOverlayTrigger overlayId="delivery-detail" className="w-full sm:w-auto">
            <span className="truncate">What a delivery receipt means</span>
            <span className="sr-only"> &mdash; opened from the {entry.planned.cadenceLabel} row</span>
          </ExitOnlyOverlayTrigger>
        </div>
      ) : null}
    </li>
  );
}

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
function planNotRunningNote(
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
 * What a coordinator attested to having confirmed before this plan was created (Ruling [122]).
 *
 * WHAT AN ATTESTATION IS: an act, an actor and an instant. WHAT IT IS NOT: a consent record. It says
 * a coordinator confirmed they had checked the hospital record; the agreement itself is held there
 * and not in this system, and no wording here may say the patient consented. The design's
 * `Agreement confirmed: Yes` is exactly that mistake, and the sign-up's last screen already refuses
 * it in the same words.
 *
 * WHY THE ACTOR IS NOT ON SCREEN, WHICH IS A LIMIT RATHER THAN A CHOICE. The attestation holds an
 * actor ID, and this workspace's actor IDs are `demo-<role>` -- so printing one would put a raw role
 * identifier in front of a clinician, which this workspace does not do: role wording lives in the
 * sealed domain (`CARING_CONTACT_ROLE_WORDING`) and is resolved from a ROLE, and nothing maps an
 * actor id to one. So the screen says the plan records who, and shows what and when. Naming the
 * person needs a directory this prototype has not got, and guessing at the identifier's shape here
 * would be a screen re-deriving a rule the session module owns.
 *
 * WHY THE EMPTY CASE IS ITS OWN SENTENCE. A plan created before the attestation existed holds none,
 * there was no backfill on purpose, and a blank space would read as "nobody confirmed anything" --
 * a false statement about a clinical record. Same shape as `FirstContactReason`'s older-plan branch
 * and `ListEmptyState`'s whole reason for being.
 *
 * WHY THE RETENTION SENTENCE IS HERE AT ALL. This is the first screen to render the attestation and
 * the first-contact reason together, and their retention rules are deliberate OPPOSITES: the reason
 * is cleared because it is prose about a patient, the attestation survives because it holds no
 * patient content. On a cleared plan a reader sees both at once, and the reason a reader might
 * otherwise reach for -- "this one was missed" -- is the wrong one.
 */
function PlanAssurances({
  attestations,
  planState,
}: {
  attestations: readonly PlanAssuranceAttestation[];
  /**
   * Which state the plan is in, read only to decide whether the `activation-success` row has
   * anything to be about. Never used to re-derive what the attestations mean.
   */
  planState: PlanState;
}) {
  const headingId = "caring-contacts-assurances-heading";
  return (
    <section aria-labelledby={headingId} className={cardClass}>
      <h2
        id={headingId}
        className="flex min-w-0 items-center gap-2 text-base font-semibold text-[color:var(--text-heading)]"
      >
        <ClipboardCheck aria-hidden="true" className="size-icon-md shrink-0" />
        <span className="min-w-0">What was confirmed before this plan started</span>
      </h2>

      {attestations.length === 0 ? (
        <>
          <p className="mt-2 max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
            This plan holds no record of those confirmations. It was created before this plan began recording them, and
            nothing was written into the older plans afterwards — a placeholder here would be a clinical record nobody
            made. Nobody failed to confirm anything.
          </p>
          <p className="mt-2 max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
            A retention clearance is not what emptied this. A clearance removes the patient&rsquo;s detail from a plan
            and leaves these confirmations on it, because each holds only which check was made and when, and no patient
            detail at all.
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
            Each line is a coordinator&rsquo;s own confirmation, recorded on the plan when the plan was created,
            together with which account made it and the time. What is recorded is that the check was made — not what the
            patient agreed to, which is held in the patient&rsquo;s hospital record and not in this system.
          </p>
          <ul aria-label="Confirmations recorded on this plan" className="mt-3 flex min-w-0 flex-col gap-2">
            {attestations.map((attestation) => (
              <li
                key={attestation.assurance}
                className="min-w-0 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2"
              >
                <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
                  <span className="font-medium text-[color:var(--text)]">A coordinator confirmed </span>
                  {planAssuranceWording(attestation.assurance)} — recorded on the plan on{" "}
                  {awstCalendarDay(attestation.attestedAt)} (AWST).
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-3 max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
            A retention clearance leaves these on the plan while it removes the patient&rsquo;s detail — the name, the
            mobile number, the identifiers, the cultural identity and the reason any first contact was moved. Each line
            above holds no patient detail, only which check was made and when, so removing it would destroy the evidence
            that the check happened while keeping the plan it belongs to.
          </p>
        </>
      )}
      <p className="mt-3 max-w-[var(--measure)] text-xs leading-5 text-[color:var(--text-muted)]">
        The account that made each confirmation is recorded on the plan and is not shown here: this demonstration
        identifies accounts by an identifier rather than by a person.
      </p>

      {/*
        `activation-success` — the frozen matrix's "Patient overview outcome" row, and its ONLY
        inbound path in this workspace.

        WHY IT SITS ON A RUNNING PLAN RATHER THAN ON A JUST-FINISHED SIGN-UP. The wizard clears its
        draft and navigates the moment both writes land, so a control rendered there would exist for
        the width of a navigation. The matrix puts the row on this screen instead, and this is the
        card it belongs beside: what activation recorded IS the confirmations above, and the row's
        own summary — "The plan is recorded. This confirmation carries no patient detail" — is what
        this card spends four paragraphs establishing.

        Offered only while the plan is RUNNING. On a paused, draft or ended plan, a confirmation that
        the plan is recorded and started would contradict what `planNotRunningNote` says a few
        sections below, and two statements about one fact disagreeing on one screen is the defect
        Task 9 found in the wizard's own copy.

        The row is `mutatesState: false` and its decision is "View the plan" — an exit, on the screen
        that IS the plan (Ruling [128]), so the host's own close is the whole action.
        `ExitOnlyOverlayTrigger`'s module records why an inline no-op and `{ kind: "unavailable" }`
        are both the wrong answer for a row like this. As with `delivery-detail` on the rows below,
        the visible words promise only what the drawer holds: `OverlayHost` takes no children, so the
        drawer carries the row's own generic copy and no patient detail whatever.
      */}
      {planState === "active" ? (
        <div className="mt-3 min-w-0">
          <ExitOnlyOverlayTrigger overlayId="activation-success" className="w-full sm:w-auto">
            <span className="truncate">What starting a plan puts on the record</span>
          </ExitOnlyOverlayTrigger>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The acting role may list plans but may not read an episode.
 *
 * Unreachable today and written anyway, on the same principle as `PatientsDirectory`'s names
 * notice: `permissions.ts` currently grants `generateClinicalRecordSummary` to exactly the roles
 * that hold `viewReferral`, so an actor who reached this screen with a plan in hand can always
 * read its episode. That is one grant edit away from being false, and a branch that cannot run
 * today is still read and still copied by the next screen. Nothing infers it from a missing
 * episode — the page decides it from the actor — so it cannot fire wrongly while it waits.
 */
function EpisodeNotPermittedNotice() {
  const heading = "This patient's record is not visible in this role";
  return (
    <div
      role="note"
      aria-label={heading}
      className="flex min-w-0 flex-col gap-1 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2 forced-colors:border-[CanvasText]"
    >
      <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[color:var(--text-heading)]">
        <EyeOff aria-hidden="true" className="size-icon-md shrink-0" />
        <span className="min-w-0">{heading}</span>
      </p>
      <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
        <span className="font-medium text-[color:var(--text)]">Why: </span>
        Reading a patient&rsquo;s record is not part of the role you are acting in. The plan and its schedule are below;
        who the plan is for is not, and this says nothing about what is held for them.
      </p>
      <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
        <span className="font-medium text-[color:var(--text)]">What changes it: </span>
        Nothing on this screen, and there is no control for it anywhere in this workspace yet. The role this
        demonstration acts in is set outside the interface.
      </p>
    </div>
  );
}

/**
 * A released episode holding no name.
 *
 * `CLEARED_PATIENT_DETAIL` is what both stores write once a retention clearance is recorded, and
 * an emptied field IS the cleared value. This screen can name the cause where the directory could
 * not: an actor who may not read an episode receives no episode at all, so the role is ruled out.
 *
 * BUT THE CLEARANCE IS NOW READ, NOT DEDUCED (#J7PZQP). Ruling the role out is not the same as
 * ruling the clearance in. `patient_name` is `not null` with no CHECK and neither store's
 * `createPlan` validates it, so the only thing that made a blank name mean "cleared" was
 * `z.string().min(1)` at the plans API route -- one schema, at one edge, guarding a sentence this
 * screen states as fact on a patient record. `patientDetailClearedAt` is that fact, carried. When
 * it is null the absence is still reported, because it is real; the cause simply is not named.
 *
 * THE MOBILE NUMBER IS READ TOO, FOR THE SAME REASON (review finding). The first version of this
 * fix still said "and no mobile number is held for it either" on BOTH branches. On the cleared
 * branch that is sound -- `markRetentionCleared` empties the name, the number, the identifiers and
 * the cultural identity in one transaction. On the not-cleared branch it is another unchecked
 * claim deduced from the blank name, which is the exact defect this whole change exists to close,
 * reintroduced inside the fix. `Episode.patientMobileNumber` is right there, so it is consulted.
 */
function NoNameHeldNotice({
  patientDetailClearedAt,
  mobileNumberHeld,
}: {
  patientDetailClearedAt: Date | null;
  mobileNumberHeld: boolean;
}) {
  const heading = "No name is held for this patient";
  return (
    <div
      role="note"
      aria-label={heading}
      className="flex min-w-0 flex-col gap-1 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2 forced-colors:border-[CanvasText]"
    >
      <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[color:var(--text-heading)]">
        <EyeOff aria-hidden="true" className="size-icon-md shrink-0" />
        <span className="min-w-0">{heading}</span>
      </p>
      <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
        <span className="font-medium text-[color:var(--text)]">Why: </span>
        {patientDetailClearedAt === null ? (
          <>
            This episode holds no patient name, so the heading above is the synthetic identifier
            {mobileNumberHeld
              ? ", though a mobile number is still held for it"
              : ", and no mobile number is held for it either"}
            . No retention clearance is recorded against this episode, so this screen cannot say why the name is absent,
            and will not guess.
          </>
        ) : (
          <>
            This episode holds no patient name, so the heading above is the synthetic identifier, and no mobile number
            is held for it either. A retention clearance removed the name, the mobile number, the identifiers and the
            cultural identity together after the episode ended.
          </>
        )}
      </p>
      <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
        <span className="font-medium text-[color:var(--text)]">What changes it: </span>
        {patientDetailClearedAt === null ? (
          <>Nothing, here or anywhere. The plan and its schedule below are what the record still holds.</>
        ) : (
          <>
            Nothing, here or anywhere. A clearance is not reversible, and the plan and its schedule below are what the
            record still holds.
          </>
        )}
      </p>
    </div>
  );
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
function scheduleSummarySentence(summary: StoredContactSummary): string {
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
function notSentExplanation(entry: StoredContact, plan: PlanRecord): { because: string; changedBy: string } | null {
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
function isTerminalOutcome(outcome: PlanOutcome): boolean {
  return outcome !== "inProgress";
}

/**
 * Whole calendar days from `from` to `to`, both AWST `YYYY-MM-DD`.
 *
 * UTC midnight is used purely as a cursor and never leaves this function, which is the same
 * technique `schedule.ts` uses for the arithmetic that produced these strings in the first place.
 * This does not re-derive the schedule: the days themselves come from the module that owns them,
 * and this only measures the distance between two of them so the screen can say "seven days after
 * discharge" instead of making a clinician subtract.
 */
function calendarDaysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MILLISECONDS_PER_DAY);
}
