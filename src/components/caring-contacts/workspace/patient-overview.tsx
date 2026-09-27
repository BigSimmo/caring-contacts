import { ClipboardCheck } from "lucide-react";
import Link from "next/link";

import { CARING_CONTACTS_ROUTES } from "@/lib/caring-contacts-routes";
import { type PlanAssuranceAttestation, planAssuranceWording } from "@/lib/caring-contacts/assurances";
import { awstCalendarDay } from "@/lib/caring-contacts/clock";
import type { Episode } from "@/lib/caring-contacts/episode";
import type { InboundReplyWithText } from "@/lib/caring-contacts/inbound-replies";
import { contactSendability, type PlanState } from "@/lib/caring-contacts/model";
import {
  type PatientNameProjection,
  type PlanRecord,
  type StoredContact,
  summariseStoredContacts,
} from "@/lib/caring-contacts/repository";

import { AutomatedState } from "./automated-state";
import { CONTACT_STATE_LABELS, MESSAGE_TYPE_LABELS } from "./contact-vocabulary";
import { plural } from "./count-wording";
import { PatientReplies } from "./inbound-replies";
import { ListEmptyState } from "./list-empty-state";
import { ExitOnlyOverlayTrigger } from "./overlays/exit-only-overlay-trigger";
import { FirstContact } from "./patient-overview-parts/first-contact";
import { Field, fieldListClass, PLAN_OUTCOME_LABELS, PLAN_STATE_LABELS } from "./patient-overview-parts/labels";
import { EpisodeNotPermittedNotice, NoNameHeldNotice } from "./patient-overview-parts/notices";
import { BackToPatients, PlanChooser } from "./patient-overview-parts/plan-chooser";
import {
  notSentExplanation,
  planNotRunningNote,
  scheduleSummarySentence,
} from "./patient-overview-parts/schedule-wording";
import { MobileCheckPanel } from "./patient-updates/mobile-check-panel";
import { offeredUpdates, type PatientUpdatesContext } from "./patient-updates/patient-update-rules";
import { RecordAChange } from "./patient-updates/record-a-change";
import type { PlanActionsContext } from "./plan-action-rules";
import { PlanActions, PlanSyncProvider } from "./plan-actions";
import { workspacePanelPadded } from "./surfaces";

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

const cardClass = workspacePanelPadded;

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
