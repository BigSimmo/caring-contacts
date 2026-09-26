import { AlertTriangle, CircleDashed, FileCheck2, FileClock, FileX2, Info, MessageSquareText } from "lucide-react";
import Link from "next/link";
import type { ComponentType, SVGProps } from "react";

import { CARING_CONTACTS_ROUTES } from "@/lib/caring-contacts-routes";
import { awstCalendarDay } from "@/lib/caring-contacts/clock";
import {
  AUTOMATED_REPLY_RESPONSE,
  CLINICIAN_FACING_WORDING_APPROVAL_STATUS,
  PATIENT_VISIBLE_NO_REPLY_NOTICE,
} from "@/lib/caring-contacts/message-copy";
import type { MessageType } from "@/lib/caring-contacts/model";
import {
  PATHWAY_APPROVAL_ROLE_WORDING,
  REQUIRED_PATHWAY_APPROVAL_ROLES,
  pathwayVersionProvenanceWording,
  type PathwayApproval,
  type PathwayVersion,
} from "@/lib/caring-contacts/pathway-versions";

import { ListEmptyState } from "./list-empty-state";
import { ExitOnlyOverlayTrigger } from "./overlays/exit-only-overlay-trigger";
import { WorkspaceOverlayTrigger } from "./overlays/overlay-trigger";
import {
  MESSAGE_TYPE_ORDER,
  MESSAGE_TYPE_WORDING,
  PATHWAY_VERSION_STATE_WORDING,
  LIFECYCLE_CHIP_BASE,
  LIFECYCLE_CHIP_TONES,
  TEMPLATE_LIFECYCLE_LABELS,
  heldMessageTypes,
  joinPhrases,
  publicationWording,
  retirementWording,
  templateLifecycleOf,
  type TemplateLifecycle,
} from "./templates-library";
import { workspacePanelPadded } from "./surfaces";

/**
 * ONE governed pathway version, in full: its lifecycle, its dual approval, the wording its own
 * record holds, and what a coordinator may do with it.
 *
 * WHAT THIS SCREEN IS. The detail half of the governance record viewer the templates library
 * opens. The library states, per row, what each record holds; this states one record completely,
 * and it is the surface where the approval claim is made most prominently -- which is exactly why
 * every rule the library follows is tighter here rather than looser.
 *
 * THE MESSAGE WORDING, AND THE ONE DECISION IN THIS FILE WORTH ARGUING WITH
 * ------------------------------------------------------------------------
 * This screen SHOWS the wording, and the library does not. That is not a disagreement between
 * them; it is the difference between a list and a record.
 *
 * What is shown is `version.snapshot.messageTextByType[type]` -- the string this version's OWN
 * record holds -- read out of the snapshot and rendered verbatim. Nothing here knows the shape of
 * that string. It is not `EXACT_PATIENT_VISIBLE_MESSAGE` referenced by name, it is not sliced,
 * matched, interpolated or completed, and NO GREETING IS ASSEMBLED HERE OR ANYWHERE BELOW. That
 * matters right now rather than in principle: the owner has decided the approved message gains a
 * first-name slot, that change is being made in the sealed domain, and a screen that had learned
 * the current shape would render the new one wrongly the day it lands. A screen that reads
 * whatever the record holds renders it correctly without being edited.
 *
 * Ruling [127] still governs what may be CLAIMED about it, and this file claims two things and no
 * more: the wording below is what this record holds, and that wording is PROVISIONAL and has not
 * been clinically approved. The second claim is READ from `message-copy.ts` rather than retyped
 * here, so a screen cannot go on calling the wording provisional after the approval gate has
 * decided otherwise, and cannot call it approved before.
 *
 * RULING [131], AND THE SENTENCE THAT USED TO SIT HERE. Round 1 rendered, in this card, "Only one
 * patient-visible message has been approved anywhere in this system ... one approved example".
 * `message-copy.ts` opens by saying the opposite -- PROVISIONAL, not clinically approved -- and
 * names as the owner of that decision the lived-experience and clinical-programme approval gate:
 * the very two seats `DualApprovalRecord` displays immediately above this card. A clinician
 * reading the two together would conclude those seats had signed off the words a discharged
 * patient receives. They have not. No rewording of that sentence is true, so it was deleted rather
 * than softened, and the wording's real status now stands in its place. A version's dual approval
 * approves the VERSION; nothing in this system has approved the words.
 *
 * What is never claimed is that any of this is a message prepared for a person. There is no
 * patient on this screen, nothing here is addressed to anybody, and nothing in this workspace is
 * ever sent to any number.
 *
 * A version whose record holds nothing for a message type renders NOTHING for it and says so.
 * `heldMessageTypes` is imported rather than re-derived, and its `typeof … === "string"` guard is
 * what makes that safe: the Postgres store reads the snapshot back with an unchecked cast, so a
 * key absent from the stored object arrives as `undefined` with the type saying it cannot.
 *
 * THE GOVERNANCE CLAIM, MORE PROMINENT HERE THAN IN A LIST
 * -------------------------------------------------------
 * `DualApprovalRecord` below resolves the approvals AND their qualification together, in one
 * component with no path through it that names a seat without having asked
 * `pathwayVersionProvenanceWording` for the qualification -- the same single-component rule the
 * library follows, and for the same reason: splitting them into siblings is how a screen comes to
 * render "Approved by …" with its qualifier lost, which is the defect found in the sign-up wizard.
 *
 * The resolver's contract is deliberately asymmetric and this screen depends on both halves.
 * ABSENT provenance renders NO qualifier: the record claims nothing, and stamping "invented for
 * demonstration" over a record nobody said anything about would be a false statement about a
 * possibly genuine one. An UNRECOGNISED value renders the weakening wording: a claim this build
 * cannot read must fail toward the weakening reading, because the safe reading of "I do not know
 * what this says" is never "it says nothing". `provenance` is taken as `string | null | undefined`
 * rather than as the narrow union so an unrecognised value reaches that fallback instead of being
 * assumed away by a type that cannot enforce itself.
 *
 * No raw role identifier is rendered. `PATHWAY_APPROVAL_ROLE_WORDING` and
 * `REQUIRED_PATHWAY_APPROVAL_ROLES` are imported from the sealed domain, never copied, and the
 * approving ACTOR is not named either -- a person identifier is not a name and putting one on a
 * governance screen would show a clinician a slug and call it an approver.
 *
 * A SERVER COMPONENT WITH TWO CLIENT CONTROLS BENEATH IT
 * -----------------------------------------------------
 * The screen itself holds no state and no hooks (Ruling 13). The two overlay triggers are the
 * workspace's own client controls, and what crosses that boundary is data: the frozen overlay id,
 * and -- for the mutating row -- a plain-words `reason` string. Never a function, which a Server
 * Component cannot pass across the boundary at all, and never the service-state incident note.
 */

const sectionId = "caring-contacts-template-detail";

const LIFECYCLE_ICONS: Readonly<Record<TemplateLifecycle, ComponentType<SVGProps<SVGSVGElement>>>> = Object.freeze({
  current: FileCheck2,
  pending: FileClock,
  retired: FileX2,
});

const backLinkClass =
  "inline-flex min-h-tap min-w-0 items-center gap-2 self-start rounded-[var(--radius-md)] px-2 text-sm font-semibold text-[color:var(--clinical-accent)] underline decoration-dotted underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

const cardClass = workspacePanelPadded;

const cardHeadingClass = "text-sm font-semibold text-[color:var(--text-heading)]";

const proseClass = "max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]";

/**
 * What the page resolved, as data rather than as three booleans a component would have to
 * recombine. Each member is a DIFFERENT FACT with different words, and the page is the only place
 * that can tell them apart: `getPathwayVersion` answers a version that does not exist, another
 * team's version, and an actor whose role covers neither governance capability with the same
 * `null`, on purpose, so nobody can find out a record exists by being refused it.
 */
export type TemplateDetailView =
  | { kind: "not-permitted" }
  /**
   * `pathwayId` is carried here and DELIBERATELY NEVER READ by the branch that renders it. It is
   * not dead code and must not be "wired up": it is what lets the reflection case in
   * `tests/caring-contacts-template-detail.dom.test.tsx` push a poisoned identifier through the
   * real prop the page supplies and then assert it never reaches the document. Remove the field
   * and that guard can no longer be armed -- the test would be asserting the absence of a value
   * the component was never given.
   */
  | { kind: "not-held"; pathwayId: string }
  | { kind: "version"; version: PathwayVersion };

export function TemplateDetail({ view }: { view: TemplateDetailView }) {
  return (
    <section aria-labelledby={`${sectionId}-heading`} className="flex min-w-0 flex-col gap-4">
      <Link href={CARING_CONTACTS_ROUTES.templates} data-internal-link="true" className={backLinkClass}>
        Back to every governed version
      </Link>

      <h2 id={`${sectionId}-heading`} className="text-base font-semibold text-[color:var(--text-heading)]">
        Governed pathway version
      </h2>

      {view.kind === "not-permitted" ? (
        <ListEmptyState
          kind="not-permitted"
          heading="Governed versions are not visible in this role"
          because="Reading a pathway version's content is not part of the role you are acting in. This says nothing about whether this team holds a version with this identifier: a read you may not make and a record that does not exist look identical on purpose, so that nobody can find out a record exists by being refused it."
          changedBy="Nothing on this screen changes it, and there is no control for it anywhere in this workspace yet. The role this demonstration acts in is set outside the interface; a coordinator sees this team's versions."
        />
      ) : null}

      {view.kind === "not-held" ? (
        <ListEmptyState
          kind="no-data"
          heading="No governed version with this identifier"
          explanation="This team holds no pathway version with the identifier in the address. A version belonging to another team looks exactly the same here, on purpose, so that nobody can find out a record exists by being refused it — this screen cannot tell you which of the two it is, and neither can anyone else."
          action={
            <Link href={CARING_CONTACTS_ROUTES.templates} data-internal-link="true" className={backLinkClass}>
              Show every version this team holds
            </Link>
          }
        />
      ) : null}

      {view.kind === "version" ? <VersionRecord version={view.version} /> : null}
    </section>
  );
}

function VersionRecord({ version }: { version: PathwayVersion }) {
  const lifecycle = templateLifecycleOf(version);
  const Icon = LIFECYCLE_ICONS[lifecycle];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className={cardClass}>
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-[color:var(--text-muted)]">Governed version</p>
            <p className="mt-0.5 break-words text-sm font-semibold text-[color:var(--text-heading)]">{version.id}</p>
          </div>
          {/*
            Words, an icon AND a tint — never colour alone. The chip names the group the design
            shows; the recorded state beneath it is the exact state, so grouping `draft` with
            `inReview` never hides which of the two this record is in. The chip shell and tone map
            are shared with the library so the two screens cannot drift.
          */}
          <p className={`${LIFECYCLE_CHIP_BASE} ${LIFECYCLE_CHIP_TONES[lifecycle]}`}>
            <Icon aria-hidden="true" className="size-icon-sm shrink-0" />
            <span className="min-w-0">{TEMPLATE_LIFECYCLE_LABELS[lifecycle]}</span>
          </p>
        </div>

        <dl className="mt-3 flex min-w-0 flex-col gap-2 text-sm leading-6">
          <div className="min-w-0">
            <dt className="text-xs text-[color:var(--text-muted)]">Lifecycle</dt>
            <dd className="min-w-0 text-[color:var(--text)]">{PATHWAY_VERSION_STATE_WORDING[version.state]}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-[color:var(--text-muted)]">Publication</dt>
            <dd className="min-w-0 text-[color:var(--text)]">{publicationWording(version)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-[color:var(--text-muted)]">Retirement</dt>
            <dd className="min-w-0 text-[color:var(--text)]">{retirementWording(version)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-[color:var(--text-muted)]">Contact cadence</dt>
            <dd className="min-w-0 text-[color:var(--text)]">
              {version.snapshot.cadenceLabels.length === 0
                ? "This record holds no cadence."
                : joinPhrases(version.snapshot.cadenceLabels)}
            </dd>
          </div>
        </dl>
      </div>

      <DualApprovalRecord approvals={version.approvals} provenance={version.snapshot.provenance} />
      <MessageWordingRecord version={version} />
      <ReplyHandling />
      <AvailabilityForANewPlan version={version} lifecycle={lifecycle} />
    </div>
  );
}

/**
 * Both approvals, and the qualification on them, resolved together.
 *
 * ONE COMPONENT, deliberately -- see the module note. There is no path through this that names a
 * seat without having asked `pathwayVersionProvenanceWording` for the qualification.
 *
 * The seats are stated from `REQUIRED_PATHWAY_APPROVAL_ROLES` rather than from the approvals the
 * record happens to carry, so a MISSING seat is a visible row rather than a silence. The domain
 * makes a version `approved` only on the transition completing both, but this screen reads a
 * record back rather than performing a transition, and a record that carries one approval and a
 * state of `approved` is exactly the shape a screen must be able to state truthfully.
 *
 * `provenance` is `string | null | undefined` on purpose: the store's unchecked cast means an
 * unrecognised value is a real possibility, and widening the parameter is what routes it to the
 * resolver's structural fallback instead of letting the type assume it away.
 */
function DualApprovalRecord({
  approvals,
  provenance,
}: {
  approvals: readonly PathwayApproval[];
  provenance: string | null | undefined;
}) {
  const note = pathwayVersionProvenanceWording(provenance);
  const seats = REQUIRED_PATHWAY_APPROVAL_ROLES.map((role) => ({
    role,
    wording: PATHWAY_APPROVAL_ROLE_WORDING[role],
    approval: approvals.find((recorded) => recorded.role === role) ?? null,
  }));
  const everyRequiredSeatRecorded = seats.every((seat) => seat.approval !== null);
  // Two approvals must mean two DIFFERENT people -- the property `applyPathwayVersionTransition`
  // exists to guarantee. Derived from the record rather than assumed from the state, because this
  // screen reads a record back through the same unchecked cast everything else here allows for,
  // and a dual approval one person gave twice is the failure this whole surface reports on.
  const recordedActors = new Set(approvals.map((approval) => approval.actorId));
  const everyApprovalFromADifferentPerson = recordedActors.size === approvals.length;

  return (
    <div className={cardClass} data-testid="caring-contacts-template-detail-approval">
      <h3 className={cardHeadingClass}>Approval</h3>
      <p className={`mt-1 ${proseClass}`}>
        A version may only be used for a new plan once both seats below have recorded an approval,
        {" and the two must be different people. "}
        {everyRequiredSeatRecorded
          ? everyApprovalFromADifferentPerson
            ? "Both seats are recorded here, each by a different person."
            : "Both seats are recorded here, and this record shows the same person against more than one of them."
          : "One of them has not been recorded on this version."}
      </p>

      <ul className="mt-3 flex min-w-0 flex-col gap-2">
        {seats.map((seat) => (
          <li key={seat.role} className="min-w-0 text-sm leading-6">
            <span className="block font-medium text-[color:var(--text)]">
              {/*
                The wording, never the identifier. `PATHWAY_APPROVAL_ROLE_WORDING` lives beside the
                roles it names in the sealed domain, and it must: the interface-vocabulary scan
                refuses one of these job titles as a whole word in a component and has no exemption
                for a job title, so a copy of this map here could not be written at all.
              */}
              Approved by {seat.wording}
            </span>
            <span className="block text-[color:var(--text-muted)]">
              {seat.approval === null
                ? "Not recorded on this version."
                : `Recorded ${awstCalendarDay(new Date(seat.approval.approvedAt))} (AWST).`}
            </span>
          </li>
        ))}
      </ul>

      {note === null ? null : (
        <p
          data-testid="caring-contacts-template-detail-provenance"
          className="mt-3 flex min-w-0 items-start gap-2 text-sm leading-6 text-[color:var(--text-muted)]"
        >
          <Info aria-hidden="true" className="mt-1 size-icon-sm shrink-0" />
          <span className="min-w-0 font-medium">{note}</span>
        </p>
      )}
    </div>
  );
}

/**
 * The wording this record holds, read out of its own snapshot and shown verbatim.
 *
 * See the module note for why this screen shows it and the library does not, and for the two
 * claims it makes about it. Nothing here knows the shape of the string; nothing assembles one.
 */
function MessageWordingRecord({ version }: { version: PathwayVersion }) {
  const held = heldMessageTypes(version.snapshot);
  const unwritten = MESSAGE_TYPE_ORDER.filter((type) => !held.includes(type));

  return (
    <div className={cardClass} data-testid="caring-contacts-template-detail-wording">
      <h3 className={cardHeadingClass}>
        <MessageSquareText aria-hidden="true" className="mr-2 inline size-icon-md shrink-0 align-text-bottom" />
        Message wording this record holds
      </h3>
      <p className={`mt-1 ${proseClass}`}>
        Read from this version&apos;s own record. Nothing below is addressed to anybody, and nothing in this workspace
        is ever sent to any number.
      </p>

      {/*
        The wording's approval status, in the sealed domain's own words and never in this screen's.
        Ruling [131]: it is rendered UNCONDITIONALLY, beside the wording and beneath the two
        approval seats, because the danger the deleted sentence created was an adjacency -- a
        clinician reading two recorded approvals and then a claim about the message. A status shown
        only when a record happens to hold wording would leave that adjacency unqualified on every
        record that does not.
      */}
      <p
        data-testid="caring-contacts-template-detail-wording-status"
        className="mt-3 flex min-w-0 items-start gap-2 text-sm leading-6 text-[color:var(--text-muted)]"
      >
        <Info aria-hidden="true" className="mt-1 size-icon-sm shrink-0" />
        <span className="min-w-0 font-medium">{CLINICIAN_FACING_WORDING_APPROVAL_STATUS}</span>
      </p>

      {held.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-[color:var(--text)]">This record holds no message wording at all.</p>
      ) : (
        <dl className="mt-3 flex min-w-0 flex-col gap-3">
          {held.map((type) => (
            <div key={type} className="min-w-0">
              <dt className="text-xs text-[color:var(--text-muted)]">Wording held for {MESSAGE_TYPE_WORDING[type]}</dt>
              <dd className="mt-1 min-w-0">
                <blockquote
                  data-testid={`caring-contacts-template-detail-wording-${type}`}
                  className="min-w-0 whitespace-pre-line break-words rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-3 text-sm leading-6 text-[color:var(--text)] forced-colors:border-[CanvasText]"
                >
                  {readWording(version, type)}
                </blockquote>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {unwritten.length === 0 ? null : (
        <p className="mt-3 text-sm leading-6 text-[color:var(--text)]">
          Nothing has been written for {joinPhrases(unwritten.map((type) => MESSAGE_TYPE_WORDING[type]))}.
        </p>
      )}
    </div>
  );
}

/**
 * The stored string for one message type, with the same widening the rest of this surface uses.
 *
 * `heldMessageTypes` has already established that this key holds a non-empty string; this reads it
 * back through `String()` rather than trusting the declared type, for the reason that helper
 * exists at all -- the store's unchecked cast means the record's shape is a claim rather than a
 * fact. The two together mean a record that lies about its own shape renders nothing rather than
 * `[object Object]` inside a quotation a clinician would read as approved wording.
 */
function readWording(version: PathwayVersion, type: MessageType): string {
  const stored: unknown = version.snapshot.messageTextByType[type];
  return typeof stored === "string" ? stored : "";
}

/**
 * What a patient who replies is told, in the sealed domain's own words.
 *
 * BOTH STRINGS ARE READ FROM `message-copy.ts` AND NEITHER IS RESTATED HERE. The owner's copy
 * decisions of 2026-08-24 changed both of them, and the module records why in full: the previous
 * no-reply notice became untrue the moment the programme's number could receive, so the claim now
 * describes only what stays true -- that nobody reads them -- and the automated response now says
 * it is automatic, so a patient told nobody reads replies who then receives one cannot conclude
 * that somebody read theirs. A screen holding its own copy of either sentence would have gone on
 * showing the superseded wording. This is why they are read and not written.
 *
 * WHAT THIS SECTION MAY NOT CLAIM. The automated response is a design contract on a sender that
 * does not exist: there is no telephony provider connected to this workspace, so nothing is sent
 * and nothing replies. Saying "this is what we send" would be a claim about behaviour nobody can
 * currently observe, which is the exact class of statement the owner's decision removed from the
 * patient-visible text.
 */
function ReplyHandling() {
  return (
    <div className={cardClass}>
      <h3 className={cardHeadingClass}>If someone replies</h3>
      <p className={`mt-1 ${proseClass}`}>Every message carries this sentence about replies:</p>
      <blockquote
        data-testid="caring-contacts-template-detail-no-reply-notice"
        className="mt-2 min-w-0 break-words rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-3 text-sm leading-6 text-[color:var(--text)] forced-colors:border-[CanvasText]"
      >
        {PATIENT_VISIBLE_NO_REPLY_NOTICE}
      </blockquote>
      <p className={`mt-3 ${proseClass}`}>
        This is the response the programme is specified to send back automatically to anyone who replies. No sender is
        connected to this workspace, so nothing is sent from here and nothing arrives here.
      </p>
      <blockquote
        data-testid="caring-contacts-template-detail-automated-reply"
        className="mt-2 min-w-0 break-words rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-3 text-sm leading-6 text-[color:var(--text)] forced-colors:border-[CanvasText]"
      >
        {AUTOMATED_REPLY_RESPONSE}
      </blockquote>
    </div>
  );
}

/**
 * Whether a new plan may be started on this version, and the overlay that belongs to each answer.
 *
 * THE TWO OVERLAYS THIS SCREEN OWNS, and the gate each is behind.
 *
 * `message-preview` carries `mutatesState: false` in the frozen table -- checked here rather than
 * taken on trust -- so it is raised through `ExitOnlyOverlayTrigger`, which stages no commit and
 * leaves the overlay's exit live. It is offered only where the approved design offers it: on a
 * version a plan may actually be started on, beside the wording that version holds. Offering it on
 * a record holding no wording would open a preview of nothing.
 *
 * `template-changed-retired` carries `mutatesState: true`, so it is raised through
 * `WorkspaceOverlayTrigger` with the commit stated in the screen's own words. The commit is
 * `unavailable` and that is the truth rather than a placeholder: its decision is "Choose the
 * current version", and no control anywhere in this workspace moves a plan onto a different
 * version -- there is no draft here to move, and a new version has to be written and approved by
 * two people before there would be one to move onto.
 *
 * It is offered ONLY on a RETIRED version, and deliberately not on a pending one, which is where
 * this departs from the approved mockup. That mockup offers it for everything that is not current,
 * but the row's own frozen summary says the template "was retired after this draft was opened" --
 * a false sentence over a version that has never been approved, let alone retired. A pending
 * version gets the plain statement without the overlay.
 */
function AvailabilityForANewPlan({ version, lifecycle }: { version: PathwayVersion; lifecycle: TemplateLifecycle }) {
  const held = heldMessageTypes(version.snapshot);

  if (lifecycle === "current") {
    return (
      <div className={cardClass}>
        <h3 className={cardHeadingClass}>Starting a plan on this version</h3>
        <p className={`mt-1 ${proseClass}`}>
          This version carries both approvals, so a plan may be started on it. Starting one happens in the sign-up, not
          here — nothing on this screen changes any plan.
        </p>
        {held.length === 0 ? (
          <p className={`mt-3 ${proseClass}`}>There is no wording to preview: this record holds none.</p>
        ) : (
          <div className="mt-3">
            <ExitOnlyOverlayTrigger overlayId="message-preview">Open message preview</ExitOnlyOverlayTrigger>
          </div>
        )}
      </div>
    );
  }

  if (lifecycle === "retired") {
    return (
      <div
        role="note"
        aria-label="Not available for a new plan"
        className="flex min-w-0 flex-col gap-2 rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-4 forced-colors:border-[CanvasText]"
      >
        <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[color:var(--text-heading)]">
          <AlertTriangle aria-hidden="true" className="size-icon-md shrink-0" />
          <span className="min-w-0">Not available for a new plan</span>
        </p>
        <p className={proseClass}>
          A retired version stays readable here as a record. No new plan may be started on it, and what its retirement
          means for plans already running is recorded above rather than inferred from the state.
        </p>
        <div>
          <WorkspaceOverlayTrigger
            overlayId="template-changed-retired"
            commit={{
              kind: "unavailable",
              reason:
                "Nothing in this workspace moves a plan onto a different version, and there is no control for it anywhere yet. A plan already running keeps the wording it was started with; a new plan needs a version that carries both approvals.",
            }}
          >
            Review the lifecycle decision
          </WorkspaceOverlayTrigger>
        </div>
      </div>
    );
  }

  return (
    <div
      role="note"
      aria-label="Not yet available for a new plan"
      className="flex min-w-0 flex-col gap-2 rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-4 forced-colors:border-[CanvasText]"
    >
      <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[color:var(--text-heading)]">
        <CircleDashed aria-hidden="true" className="size-icon-md shrink-0" />
        <span className="min-w-0">Not yet available for a new plan</span>
      </p>
      <p className={proseClass}>
        This version has not been approved by both seats, so no plan may be started on it. The approval section above
        says which seat has not recorded one. Nothing on this screen records an approval, and there is no control for it
        anywhere in this workspace yet.
      </p>
    </div>
  );
}
