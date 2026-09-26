import { CircleDashed, FileCheck2, FileClock, FileX2, Info } from "lucide-react";
import Link from "next/link";
import type { ComponentType, SVGProps } from "react";

import { CARING_CONTACTS_ROUTES, pathwayRoute } from "@/lib/caring-contacts-routes";
import { awstCalendarDay } from "@/lib/caring-contacts/clock";
import type { MessageType, PathwayVersionState } from "@/lib/caring-contacts/model";
import {
  PATHWAY_APPROVAL_ROLE_WORDING,
  pathwayVersionProvenanceWording,
  type PathwayApproval,
  type PathwayVersion,
  type PathwayVersionSnapshot,
} from "@/lib/caring-contacts/pathway-versions";

import { ListEmptyState } from "./list-empty-state";
import { workspacePanelPadded } from "./surfaces";

/**
 * The governed pathway versions this team holds, and the approval history behind each one.
 *
 * WHAT THIS SCREEN IS, AND THE ONE THING IT IS NOT
 * -----------------------------------------------
 * It is a GOVERNANCE record viewer. It shows a version's lifecycle state, the recorded facts of
 * its publication and retirement, and who approved it -- and it deliberately shows no message
 * wording at all.
 *
 * That is not an omission to be filled in later by whoever reads this. Ruling [127]: the one
 * patient-visible message that exists is `EXACT_PATIENT_VISIBLE_MESSAGE`, a SPECIMEN rather than a
 * template -- one approved example, greeting and sender name included, measured against a hard
 * two-segment ceiling with no room left. There is no per-version message content anywhere in this
 * system, so a LIST that set wording beside each row would be claiming a per-version relationship
 * that does not exist -- and would repeat one long block of patient-visible text down a screen
 * whose subject is governance. What this screen CAN say truthfully, per version and derived from
 * that version's own snapshot, is which of the three message types the record holds wording for
 * and which are still unwritten. It says that and stops.
 *
 * `./template-detail.tsx` DOES show it, and the difference is a list against a record rather than
 * a disagreement. It renders `snapshot.messageTextByType[type]` for one version, verbatim and
 * unexamined, states that only one approved message exists and that it is a specimen, and never
 * presents it as a message prepared for a person. Its module note carries that argument in full.
 * Two things this file used to say about the specimen have been corrected there rather than
 * repeated here: its SHAPE is not settled -- the owner has decided it gains a first-name slot, and
 * that change is being made in the sealed domain -- so no screen may learn its shape, complete it,
 * or assemble a greeting. Reading whatever the record holds is the only spelling that survives the
 * change. No wording is drafted in either file, and none may be.
 *
 * WHAT THE DETAIL SCREEN IMPORTS FROM HERE, AND WHY IT IS NOT COPIED
 * ------------------------------------------------------------------
 * `PATHWAY_VERSION_STATE_WORDING`, `MESSAGE_TYPE_WORDING`, `MESSAGE_TYPE_ORDER`,
 * `heldMessageTypes`, `joinPhrases`, `publicationWording` and `retirementWording` are exported for
 * `./template-detail.tsx`. Every one of them decides what a governance fact SAYS, and a second
 * copy would be free to stop agreeing -- the list and the record would then describe the same
 * stored fact in two ways, on two screens a coordinator reaches one from the other. The
 * `typeof … === "string"` guard inside `heldMessageTypes` is the sharpest case: the detail screen
 * renders the stored wording, so a truthiness test there would print an absent key.
 *
 * THE GOVERNANCE CLAIM THIS SCREEN MUST NOT OVERSTATE
 * --------------------------------------------------
 * "Approved by the clinical programme lead and the lived-experience representative" is a claim
 * about PROVENANCE, and a demonstration population produces a version whose approvals are
 * structurally genuine -- `applyPathwayVersionTransition` refused anything else, from two roles
 * held by two people, neither of them the author -- and whose governance is invented. Nothing
 * about the shape of such a record distinguishes it from one people really approved, which is why
 * `PathwayVersionSnapshot.provenance` exists and why it is a WEAKENING-only marker.
 *
 * This is the screen that makes the claim, so `ApprovalRecord` below resolves the approvals and
 * their qualification TOGETHER, in one component that cannot render the first without asking for
 * the second. Through `pathwayVersionProvenanceWording`, never a lookup written here: the Postgres
 * store reads the snapshot back with an unchecked cast, so an unrecognised provenance string is a
 * real possibility rather than a hypothetical, and the obvious spelling
 * (`PATHWAY_VERSION_PROVENANCE_WORDING[provenance]`) yields `undefined` for one -- which a
 * `=== null` test reads as "there is a qualifier" and renders as an empty paragraph beside an
 * approval line left standing unqualified. That exact defect was found in the sign-up wizard. The
 * resolver's fallback is structural: absent claims nothing, recognised gets its words, and
 * anything else gets the weakening claim.
 *
 * WHY THE RESOLUTION HAPPENS HERE RATHER THAN ON THE PAGE
 * ------------------------------------------------------
 * `plans/new/page.tsx` resolves both the role wording and the provenance note on the page, because
 * the wizard beneath it is a Client Component and the sealed domain must not cross that boundary.
 * This screen has no client boundary -- it is a Server Component with no hooks, like every other
 * list screen in this workspace (Ruling 13) -- so the domain modules stay on the server either
 * way, and doing it here is what makes the fail-safe directly provable: a test can render this
 * component with a version carrying a provenance value no fixture produces and watch the weakening
 * claim appear. A defect that only shows for a value nothing produces is exactly the kind a suite
 * does not notice.
 *
 * Neither wording map is copied into this file. `PATHWAY_APPROVAL_ROLE_WORDING` lives in the
 * sealed domain beside the roles it names, and it must: the interface-vocabulary scan refuses
 * `lead` as a whole word in a component, with no exemption for a job title. A raw role identifier
 * is never rendered to a clinician.
 *
 * THREE EMPTY LISTS, AND A FOURTH FACT THAT IS NOT EMPTINESS
 * ---------------------------------------------------------
 * `ListEmptyState` refuses to blur "nothing exists" and "a filter is hiding everything", and this
 * screen adds the visibility case the caseload also has: `listPathwayVersions` answers an actor
 * holding neither `authorPathwayVersion` nor `approvePathwayVersion` with `[]`, exactly as it
 * answers a team with no versions. So the capability is decided by the page from the actor and
 * arrives as `mayViewPathwayVersions`, and the empty list can say which fact it is.
 *
 * The fourth is the one that matters clinically and is NOT an empty list at all: a team whose
 * versions all exist but are all retired. The list is full, and no new plan can be started on any
 * of them -- `plans/new` offers only `approved` versions, because a retired version is precisely
 * one that new activations must not use. Left to a row-by-row read that is a fact a coordinator
 * has to assemble for themselves, so it is stated once above the list, and the filtered-empty
 * branch states it too rather than offering "clear the filter" as though a Current version were
 * behind it.
 */

/**
 * The three groups the approved design's library shows, and the exhaustive map from the domain's
 * own lifecycle states onto them.
 *
 * A `Record` over `PathwayVersionState`, so a state added to the domain stops this file compiling
 * rather than falling silently into whichever branch happens to be last. The mapping is a
 * PRESENTATION grouping and nothing more: it reads `version.state`, which
 * `applyPathwayVersionTransition` alone sets, and never re-derives approval from counting
 * approvals -- a version is `approved` only on the transition that completes both required roles,
 * and that rule belongs to the domain.
 *
 * `draft` and `inReview` share the `pending` group because that is what the design shows, and each
 * row still names its own recorded state beneath the group chip, so the two are never conflated on
 * screen.
 */
export type TemplateLifecycle = "current" | "pending" | "retired";

const LIFECYCLE_BY_STATE: Readonly<Record<PathwayVersionState, TemplateLifecycle>> = Object.freeze({
  draft: "pending",
  inReview: "pending",
  approved: "current",
  retired: "retired",
});

export const TEMPLATE_LIFECYCLE_LABELS: Readonly<Record<TemplateLifecycle, string>> = Object.freeze({
  current: "Current",
  pending: "Pending",
  retired: "Retired",
});

/** The order the filter offers the groups in, and the order rows are grouped by. */
export const TEMPLATE_LIFECYCLE_ORDER: readonly TemplateLifecycle[] = Object.freeze(["current", "pending", "retired"]);

/** Plain words for each recorded lifecycle state, so no state identifier reaches a clinician. */
export const PATHWAY_VERSION_STATE_WORDING: Readonly<Record<PathwayVersionState, string>> = Object.freeze({
  draft: "Drafted, not yet submitted for review",
  inReview: "In review, awaiting both approvals",
  approved: "Approved for use",
  retired: "Retired",
});

/** Plain words for each message type. Never a raw `first`/`standard`/`closing` on screen. */
export const MESSAGE_TYPE_WORDING: Readonly<Record<MessageType, string>> = Object.freeze({
  first: "the first message",
  standard: "the standard message",
  closing: "the closing message",
});

export const MESSAGE_TYPE_ORDER: readonly MessageType[] = Object.freeze(["first", "standard", "closing"]);

export function templateLifecycleOf(version: PathwayVersion): TemplateLifecycle {
  return LIFECYCLE_BY_STATE[version.state];
}

export type TemplatesLibraryFilter = {
  /** The lifecycle group the URL asks for, already validated; "all" when absent or unrecognised. */
  lifecycle: TemplateLifecycle | "all";
};

/** The one place a query value becomes a filter -- never re-derived in a component below. */
export function parseTemplatesLibraryFilter(
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
): TemplatesLibraryFilter {
  const raw = searchParams.lifecycle;
  // A repeated `?lifecycle=a&lifecycle=b` arrives as an array and names no single group. Both that
  // and an unrecognised value fall back to "all" rather than throwing: a mistyped URL must widen
  // the list, never fail the render or hide a governance record behind an error page.
  const lifecycle: TemplateLifecycle | "all" =
    typeof raw === "string" && (TEMPLATE_LIFECYCLE_ORDER as readonly string[]).includes(raw)
      ? (raw as TemplateLifecycle)
      : "all";
  return { lifecycle };
}

/** Every href on this screen is built from the route module, never from a path literal. */
export function templatesLibraryHref(filter: TemplatesLibraryFilter): string {
  if (filter.lifecycle === "all") return CARING_CONTACTS_ROUTES.templates;
  const params = new URLSearchParams({ lifecycle: filter.lifecycle });
  return `${CARING_CONTACTS_ROUTES.templates}?${params.toString()}`;
}

/**
 * Which of the three message types this version's snapshot holds wording for.
 *
 * `typeof … === "string"` rather than a truthiness test, and it is load-bearing rather than
 * defensive habit: the Postgres store reads the snapshot back with an unchecked cast, so a key
 * absent from the stored object arrives as `undefined` with the type saying it cannot. An absent
 * key and an empty string mean the same thing here -- no wording has been written -- and both fall
 * to the unwritten side, which is the direction that cannot overstate what the record holds.
 */
export function heldMessageTypes(snapshot: PathwayVersionSnapshot): readonly MessageType[] {
  return MESSAGE_TYPE_ORDER.filter((type) => {
    const stored: unknown = snapshot.messageTextByType[type];
    return typeof stored === "string" && stored.trim() !== "";
  });
}

/** "a, b and c" -- an Oxford-free join for a short closed list of plain-words phrases. */
export function joinPhrases(phrases: readonly string[]): string {
  if (phrases.length === 0) return "";
  if (phrases.length === 1) return phrases[0];
  return `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}`;
}

const sectionId = "caring-contacts-templates-library";

const filterChipClass =
  "inline-flex min-h-tap min-w-0 items-center justify-center rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-4 text-sm font-medium text-[color:var(--text-muted)] transition-colors hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] motion-reduce:transition-none aria-[current]:border-[color:var(--clinical-accent)] aria-[current]:bg-[color:var(--clinical-accent-soft)] aria-[current]:font-semibold aria-[current]:text-[color:var(--clinical-accent)] aria-[current]:shadow-[var(--shadow-inset)] forced-colors:border-[CanvasText]";

const showEveryVersionClass =
  "inline-flex min-h-tap shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-4 text-sm font-semibold text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] forced-colors:border-[CanvasText]";

type LifecycleIcon = ComponentType<SVGProps<SVGSVGElement>>;

const LIFECYCLE_ICONS: Readonly<Record<TemplateLifecycle, LifecycleIcon>> = Object.freeze({
  current: FileCheck2,
  pending: FileClock,
  retired: FileX2,
});

/**
 * The chip's tint per lifecycle group — the THIRD channel, never the only one.
 *
 * All three groups rendered on the same neutral `--surface-subtle` until now, distinguished only
 * by a 14px glyph, so in a list a reader scans for a governed pathway to use, an approved version
 * and a retired one looked identical. The rule this screen's comment cites is that status is never
 * carried by colour ALONE; it does not say a status may not be coloured, and the design system
 * ships the success/warning/danger triads for exactly this. The chip keeps its word
 * (`TEMPLATE_LIFECYCLE_LABELS`) and its icon, and the line beneath the row still names the exact
 * recorded state, so the reading survives greyscale, forced colours and colour blindness — the
 * tint just means nobody has to read three rows to find the current one.
 *
 * `retired` takes the danger triad rather than a grey: retired is not "less"; it is the one group
 * whose wording must not be used on a new plan.
 *
 * Exported so `template-detail.tsx` renders the same chip rather than a second copy that drifts.
 */
export const LIFECYCLE_CHIP_TONES: Readonly<Record<TemplateLifecycle, string>> = Object.freeze({
  current: "border-[color:var(--success-border)] bg-[color:var(--success-bg)] text-[color:var(--success-text)]",
  pending: "border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] text-[color:var(--warning-text)]",
  retired: "border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] text-[color:var(--danger-text)]",
});

/** The chip shell, tone applied by the caller. */
export const LIFECYCLE_CHIP_BASE =
  "inline-flex min-w-0 shrink-0 items-center gap-2 rounded-[var(--radius-pill)] border px-3 py-1 text-xs font-semibold forced-colors:border-[CanvasText]";

export type TemplatesLibraryProps = {
  /** Every pathway version the read released, unfiltered. The filter is applied here. */
  versions: readonly PathwayVersion[];
  filter: TemplatesLibraryFilter;
  /**
   * False when the acting role holds neither governance capability that reads a version's
   * content. Decided by the page from the actor, never inferred here from an empty list: the
   * store answers a refused read and a team with no versions identically, on purpose.
   */
  mayViewPathwayVersions: boolean;
};

export function TemplatesLibrary({ versions, filter, mayViewPathwayVersions }: TemplatesLibraryProps) {
  const held = mayViewPathwayVersions ? versions : [];
  const visible =
    filter.lifecycle === "all" ? held : held.filter((version) => templateLifecycleOf(version) === filter.lifecycle);
  const everyHeldVersionRetired = held.length > 0 && held.every((version) => version.state === "retired");

  return (
    <section aria-labelledby={`${sectionId}-heading`} className="min-w-0">
      <h2 id={`${sectionId}-heading`} className="text-base font-semibold text-[color:var(--text-heading)]">
        Governed pathway versions
      </h2>
      <p className="mt-2 max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
        One row for each governed version this team holds: where it has got to, what was recorded when it was published
        or retired, and who approved it. The wording a patient receives is not shown here, and no version holds wording
        of its own — each row states which of the three messages its record has text for.
      </p>

      {mayViewPathwayVersions ? (
        <>
          {/*
            A flat set of links inside the `<nav>` that names them, not a `<ul>`: the rows below are
            a real list, and a second list of chips would make every chip an equal `listitem` to a
            governance record. The same shape the caseload settled on, and for the same reason.
          */}
          <nav aria-label="Filter by lifecycle state" className="mt-5 flex min-w-0 flex-wrap gap-2">
            <Link
              href={templatesLibraryHref({ lifecycle: "all" })}
              data-internal-link="true"
              aria-current={filter.lifecycle === "all" ? "true" : undefined}
              className={filterChipClass}
            >
              All
            </Link>
            {TEMPLATE_LIFECYCLE_ORDER.map((lifecycle) => (
              <Link
                key={lifecycle}
                href={templatesLibraryHref({ lifecycle })}
                data-internal-link="true"
                aria-current={filter.lifecycle === lifecycle ? "true" : undefined}
                className={filterChipClass}
              >
                {TEMPLATE_LIFECYCLE_LABELS[lifecycle]}
              </Link>
            ))}
          </nav>

          {everyHeldVersionRetired ? (
            <div className="mt-4 min-w-0">
              <EveryVersionRetiredNotice />
            </div>
          ) : null}
        </>
      ) : null}

      {visible.length > 0 ? (
        <ul className="mt-4 flex min-w-0 flex-col gap-3">
          {visible.map((version) => (
            <PathwayVersionRow key={version.id} version={version} />
          ))}
        </ul>
      ) : (
        <div className="mt-5 min-w-0">
          <LibraryEmptyState
            held={held}
            filter={filter}
            everyHeldVersionRetired={everyHeldVersionRetired}
            mayViewPathwayVersions={mayViewPathwayVersions}
          />
        </div>
      )}
    </section>
  );
}

/**
 * Stated once, above the list, when every version this team holds has been retired.
 *
 * NOT an empty state: the list below it is full. It is the clinical consequence of what the rows
 * add up to, which no single row states and which a coordinator would otherwise have to assemble
 * by reading all of them. `plans/new` offers only `approved` versions -- a retired version is
 * exactly the one a new activation must not use -- so with every version retired, no plan can be
 * started at all, and the sign-up screen would say so only after a coordinator had walked into it.
 *
 * Local to this screen rather than shared, deliberately: one use is not a pattern. It borrows
 * `AutomatedState`'s why/what-changes-it shape without being it -- retirement is a decision a
 * person recorded, not a state the system reached on its own -- and takes its accessible name from
 * the string it renders rather than an id, so this screen still ships no client component.
 */
function EveryVersionRetiredNotice() {
  const heading = "No version is available for a new plan";
  return (
    <div
      role="note"
      aria-label={heading}
      className="flex min-w-0 flex-col gap-1 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2 forced-colors:border-[CanvasText]"
    >
      <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[color:var(--text-heading)]">
        <CircleDashed aria-hidden="true" className="size-icon-md shrink-0" />
        <span className="min-w-0">{heading}</span>
      </p>
      <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
        <span className="font-medium text-[color:var(--text)]">Why: </span>
        Every version this team holds has been retired. A plan may only be started on a version that carries both
        approvals, and retirement is what stops a version being used for a new plan.
      </p>
      <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
        <span className="font-medium text-[color:var(--text)]">What changes it: </span>A new version has to be written
        and approved by two people. Nothing on this screen does that, and there is no control for it anywhere in this
        workspace yet. Plans already running keep the wording they were started with; a retirement does not reach back
        into them.
      </p>
    </div>
  );
}

function LibraryEmptyState({
  held,
  filter,
  everyHeldVersionRetired,
  mayViewPathwayVersions,
}: {
  held: readonly PathwayVersion[];
  filter: TemplatesLibraryFilter;
  everyHeldVersionRetired: boolean;
  mayViewPathwayVersions: boolean;
}) {
  if (!mayViewPathwayVersions) {
    return (
      <ListEmptyState
        kind="not-permitted"
        heading="Governed versions are not visible in this role"
        because="Reading a pathway version's content is not part of the role you are acting in. This says nothing about how many versions this team holds: a read you may not make and a team holding none look identical on purpose, so that nobody can find out a record exists by being refused it."
        changedBy="Nothing on this screen changes it, and there is no control for it anywhere in this workspace yet. The role this demonstration acts in is set outside the interface; a coordinator sees this team's versions."
      />
    );
  }

  if (held.length === 0 || filter.lifecycle === "all") {
    // The second half of that condition is unreachable in practice and is stated rather than left
    // to fall through: with no filter set, `visible` IS `held`, so a non-empty `held` cannot
    // produce an empty list here. If it ever does, "nothing exists" is the only honest reading of
    // an empty list carrying no filter — inventing a filter to blame would be worse than the
    // branch being unreachable.
    return (
      <ListEmptyState
        kind="no-data"
        heading="No governed versions yet"
        explanation="This team holds no pathway version at all — not a draft, not a retired one, nothing. A version appears here once one is written; it then has to be reviewed and approved by two people before any plan can be started on it."
      />
    );
  }

  // Everything below is a filtered empty list, and the two branches are DIFFERENT FACTS with
  // different remedies. "Clear the filter" is the honest answer when the group happens to be empty
  // and other groups are not; it is a misdirection when every version is retired, because clearing
  // the filter reveals retired records and still leaves nothing a plan can be started on.
  if (everyHeldVersionRetired) {
    return (
      <ListEmptyState
        kind="filtered"
        heading="No version in this state"
        because={`The lifecycle filter is set to ${TEMPLATE_LIFECYCLE_LABELS[filter.lifecycle]}, and every version this team holds has been retired.`}
        changedBy="Clearing the filter lists the retired versions, which is all this team holds. It does not make one available for a new plan — that needs a new version, written and approved by two people, and no control on this screen does it."
        action={
          <Link
            href={templatesLibraryHref({ lifecycle: "all" })}
            data-internal-link="true"
            className={showEveryVersionClass}
          >
            Show every version
          </Link>
        }
      />
    );
  }

  return (
    <ListEmptyState
      kind="filtered"
      heading="No version in this state"
      because={`The lifecycle filter is set to ${TEMPLATE_LIFECYCLE_LABELS[filter.lifecycle]}, and none of the versions this team holds is in that state. Others are.`}
      changedBy="Clearing the filter shows every version this team holds, in whatever state each one is in."
      action={
        <Link
          href={templatesLibraryHref({ lifecycle: "all" })}
          data-internal-link="true"
          className={showEveryVersionClass}
        >
          Show every version
        </Link>
      }
    />
  );
}

/** One governed version's row. */
function PathwayVersionRow({ version }: { version: PathwayVersion }) {
  const lifecycle = templateLifecycleOf(version);
  const Icon = LIFECYCLE_ICONS[lifecycle];
  const held = heldMessageTypes(version.snapshot);
  const unwritten = MESSAGE_TYPE_ORDER.filter((type) => !held.includes(type));

  return (
    <li className={workspacePanelPadded}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-[color:var(--text-muted)]">Governed version</p>
          <p className="mt-0.5 break-words text-sm font-semibold text-[color:var(--text-heading)]">{version.id}</p>
        </div>
        {/*
          Words, an icon AND a tint — never colour alone, and never colour withheld either. The chip
          names the group the design shows; the line beneath the row names the exact state the
          record is in, so grouping `draft` with `inReview` never hides which of the two a version
          is. See `LIFECYCLE_CHIP_TONES` for why the tint is the third channel rather than the only
          one.
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
        <div className="min-w-0">
          <dt className="text-xs text-[color:var(--text-muted)]">Message wording</dt>
          <dd className="min-w-0 text-[color:var(--text)]">
            {held.length === 0
              ? "This record holds no message wording at all."
              : `Wording is held for ${joinPhrases(held.map((type) => MESSAGE_TYPE_WORDING[type]))}.`}
            {unwritten.length === 0
              ? ""
              : ` Nothing has been written for ${joinPhrases(unwritten.map((type) => MESSAGE_TYPE_WORDING[type]))}.`}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-[color:var(--text-muted)]">Approval</dt>
          <dd className="min-w-0">
            <ApprovalRecord approvals={version.approvals} provenance={version.snapshot.provenance} />
          </dd>
        </div>
      </dl>

      {/*
        THE INBOUND LINK TO THE DETAIL SCREEN (Ruling 89, and the direction it is usually
        forgotten). `/caring-contacts/templates/[pathwayId]` is a dynamic production route, and
        `tests/route-reachability.test.ts` requires a non-mockup source to render
        `<Link href={pathwayRoute(...)}>` for the family -- documenting the link does not count,
        because that test strips comments before it scans, after a module note satisfied it on
        prose. Built from the routes module, never from a path literal.

        The href is the whole tap target rather than the row: a row-wide link would make the
        version identifier, the lifecycle chip and every recorded fact one enormous control with
        one accessible name, and `min-h-tap` on a wrapper leaves the row's own whitespace dead.
      */}
      <p className="mt-3 min-w-0">
        <Link
          href={pathwayRoute(version.id)}
          data-internal-link="true"
          className="inline-flex min-h-tap min-w-0 items-center rounded-[var(--radius-md)] px-2 text-sm font-semibold text-[color:var(--clinical-accent)] underline decoration-dotted underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
        >
          <span className="min-w-0 break-words">Open this governed record</span>
          {/*
            Every row renders this control, so the visible words alone would give a screen reader a
            list of identically named links to different records. The identifier is already on the
            row above; repeating it here only in the accessible name keeps each link's purpose
            distinguishable without printing it twice.
          */}
          <span className="sr-only">, {version.id}</span>
        </Link>
      </p>
    </li>
  );
}

/** The recorded fact of publication, or the absence of one. Never inferred from the state. */
export function publicationWording(version: PathwayVersion): string {
  if (version.publishedAt === null) {
    return version.state === "approved"
      ? "Approved, and not yet published. A plan may still be started on it."
      : "Not published.";
  }
  return `Published ${awstCalendarDay(new Date(version.publishedAt))} (AWST).`;
}

/**
 * The recorded fact of retirement.
 *
 * The urgency is stated in the words the domain's own note uses, because the two urgencies have
 * genuinely different consequences for patients: a routine retirement stops new activations and
 * leaves plans already running alone, while an urgent-safety retirement pauses future contacts on
 * plans already activated so a person reviews them. Rendering "Retired" alone would collapse the
 * one distinction that reaches a patient.
 */
export function retirementWording(version: PathwayVersion): string {
  if (version.retiredAt === null) return "Not retired.";
  const day = awstCalendarDay(new Date(version.retiredAt));
  if (version.retirementUrgency === "urgentSafety") {
    return `Retired ${day} (AWST) as an urgent safety matter. No new plan may be started on it, and future contacts on plans already running against it are paused for review.`;
  }
  if (version.retirementUrgency === "routine") {
    return `Retired ${day} (AWST) as a routine change. No new plan may be started on it; plans already running against it continue with the wording they were started with.`;
  }
  // `retiredAt` set with no urgency recorded is a record this build does not fully understand.
  // The safe reading is the narrow one: state what IS recorded and claim nothing about what a
  // running plan does, rather than picking whichever urgency reads better.
  return `Retired ${day} (AWST). This record does not say how the retirement was classified, so what it means for plans already running is not stated here.`;
}

/**
 * A version's approvals AND the qualification on them, resolved together.
 *
 * ONE COMPONENT, deliberately. The failure this exists to prevent is a screen that renders the
 * approval sentence and loses its qualifier -- which is what happened in the sign-up wizard, where
 * an unrecognised provenance resolved to `undefined`, the `=== null` test read false, and an empty
 * bold paragraph was rendered while "Approved by ..." stood unqualified. Splitting these into two
 * siblings is how that becomes possible again, so they are not split: there is no path through
 * this component that prints an approval without having asked `pathwayVersionProvenanceWording`
 * for its qualification.
 *
 * `provenance` is taken as `string | null | undefined` rather than as the narrow union, and that
 * is not laziness. The Postgres store casts the stored snapshot with an unchecked `as`, so the
 * type at this call site is a claim about what SHOULD be there. Widening it here means an
 * unrecognised value reaches the resolver -- whose fallback is structural -- instead of being
 * quietly assumed away by a type that cannot enforce itself.
 */
function ApprovalRecord({
  approvals,
  provenance,
}: {
  approvals: readonly PathwayApproval[];
  provenance: string | null | undefined;
}) {
  const note = pathwayVersionProvenanceWording(provenance);
  const roles = approvals.map((approval) => PATHWAY_APPROVAL_ROLE_WORDING[approval.role]);
  // A role the wording map does not name would render as `undefined` inside a sentence. It cannot
  // happen through the transition module, which types the role, but the same unchecked cast that
  // makes an unrecognised provenance possible makes this possible too, and the honest answer is to
  // say a seat was recorded rather than to name it wrongly.
  const named = roles.filter((role) => typeof role === "string" && role !== "");
  const everyApprovalNamed = named.length === roles.length;

  const approvalSentence =
    approvals.length === 0
      ? "No approval has been recorded on this version."
      : named.length === 0
        ? "An approval is recorded, and this record does not name the seat that gave it."
        : everyApprovalNamed
          ? `Approved by ${joinPhrases(named)}.`
          : `Approved by ${joinPhrases(named)}, and by a seat this record does not name.`;

  return (
    <>
      <span className="block min-w-0 text-[color:var(--text)]">{approvalSentence}</span>
      {note === null ? null : (
        <span
          data-testid="caring-contacts-pathway-provenance"
          className="mt-1 flex min-w-0 items-start gap-2 text-[color:var(--text-muted)]"
        >
          <Info aria-hidden="true" className="mt-1 size-icon-sm shrink-0" />
          <span className="min-w-0 font-medium">{note}</span>
        </span>
      )}
    </>
  );
}
