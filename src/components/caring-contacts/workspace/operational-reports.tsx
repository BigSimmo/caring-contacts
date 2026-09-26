import { GitCompareArrows, Info, ListChecks, Users } from "lucide-react";

import type { DispatchDiscrepancySummary, OperationalReport } from "@/lib/caring-contacts/operational-reporting";
import type { ReachDisclosure } from "@/lib/caring-contacts/reach-reporting";
import { REACH_REPORTING_GOVERNANCE } from "@/lib/caring-contacts/reach-reporting-governance";
import { workspacePanel, workspacePanelFlush } from "./surfaces";

/**
 * Aggregate operational reporting, and the programme-reach section spec §2.5 owes.
 *
 * A SERVER COMPONENT. It holds no state and takes every number it renders as a prop, so it adds no
 * client payload.
 *
 * WHAT IS NOT HERE, AND IS NOT AN OVERSIGHT. Spec §4.2 forbids ranking clinicians. Nothing on this
 * screen is per-actor: `OperationalReport` carries no actor field to group by, so an ordering of
 * people by output cannot be assembled from what this component is given. The approved design
 * shows no such table either; the constraint and the design agree, and this note records that they
 * were checked against each other rather than assumed to.
 *
 * NO COUNT IS RESTATED IN PROSE (Ruling 94). Every number appears exactly once, in the cell that
 * holds it, and every sentence on this screen states an invariant instead. A report is nothing but
 * counts, so a count written into a sentence here would be wrong the first time the data moved --
 * which on a report is the first time anybody uses it.
 *
 * AN EMPTY MEASURE IS NOT AN ABSENT CAPABILITY. `listPlans` and `listDispatches` both answer an
 * actor who may not see their contents with an empty list, exactly as they answer a team that has
 * none. So the page asks the capability question separately and hands the answer down; a screen
 * that only counted rows would tell a reader their team has no plans when what happened is that
 * they may not see them.
 */

export type ReachReportingSection =
  | {
      /**
       * The field the reach report is over is not collected by this system at all -- a statement
       * about what is recorded, not about who is in the programme. Kept as its own shape rather
       * than as an empty breakdown, because an empty breakdown says "no patient is in any of these
       * categories" and this says "nobody has been asked". Those are different statements and a
       * careless screen renders them identically.
       */
      readonly kind: "notCollected";
    }
  | { readonly kind: "disclosed"; readonly disclosure: ReachDisclosure };

export type OperationalReportsProps = {
  readonly report: OperationalReport;
  readonly dispatches: DispatchDiscrepancySummary;
  readonly mayViewPlans: boolean;
  readonly mayViewDispatches: boolean;
  /**
   * How many days back the dispatch measures look. Stated on the screen rather than left implicit:
   * `listDispatches` has no unbounded form, so every dispatch measure here is over a window, and a
   * measure whose period a reader has to guess at is a measure they can read wrongly.
   */
  readonly dispatchWindowDays: number;
  readonly reach: ReachReportingSection;
};

const sectionClass = workspacePanelFlush;

const tileClass = `${workspacePanel} px-5 py-4`;

/**
 * Display size is for a FIGURE. A tile whose value is a sentence steps down to body size.
 *
 * Every tile here can render either. "Still to send today" is `1`; "Median minutes, attempt to
 * resolution" is `None worked through` when nothing completed, and `Not visible to you` when the
 * reader lacks the capability — and those were being set at display size, which turned a whole
 * sentence into a headline running the width of the tile and reading like a slogan rather than a
 * statement about missing data.
 *
 * The test is the string itself rather than a flag the caller passes, so a value that becomes a
 * sentence tomorrow is typeset correctly without its call site being revisited. `tabular-nums`
 * likewise only means something for digits, so it travels with the figure branch.
 *
 * `text-xl`, not `text-2xl`: `--text-2xl` and `--text-xl` are the same 1.5rem in the v2 layer, and
 * `text-xl` is the step the rest of the app reaches for.
 */
const measureFigureClass = "mt-2 text-xl font-semibold tabular-nums text-[color:var(--text-heading)]";
const measureStatementClass = "mt-2 text-sm font-semibold leading-6 text-[color:var(--text-heading)]";

function isFigure(value: string): boolean {
  return /^[\d.,\s%-]+$/.test(value);
}

/** A measure a reader may not see is stated as such, never as a zero. */
function Measure({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className={tileClass}>
      <p className="text-sm font-medium text-[color:var(--text-muted)]">{label}</p>
      <p className={isFigure(value) ? measureFigureClass : measureStatementClass}>{value}</p>
      <p className="mt-1 text-xs leading-5 text-[color:var(--text-muted)]">{note}</p>
    </div>
  );
}

const NOT_VISIBLE = "Not visible to you";

function SectionHeading({
  id,
  title,
  description,
  icon: Icon,
}: {
  id: string;
  title: string;
  description: string;
  icon: typeof ListChecks;
}) {
  return (
    <div className="border-b border-[color:var(--border)] px-5 py-4 sm:px-6">
      <h2 id={id} className="flex items-center gap-2 text-sm font-semibold text-[color:var(--text-heading)]">
        <Icon aria-hidden="true" className="size-icon-md shrink-0" />
        {title}
      </h2>
      <p className="mt-1 max-w-[var(--measure)] text-xs leading-5 text-[color:var(--text-muted)]">{description}</p>
    </div>
  );
}

/**
 * The programme-reach section, in the one state this system can currently produce and in the
 * states it will produce once it can.
 *
 * The `Suppressed` marker and the withheld reasons come straight from `discloseReach`. NO TOTAL IS
 * RENDERED, and the reason is recorded in that module: publishing a total lets a reader subtract
 * the published cells and recover a suppressed one. The safety of the disclosure does not rest on
 * withholding it -- the module assumes the total is knowable from the measures above -- so this is
 * belt as well as braces rather than the mechanism.
 */
function ReachSection({ reach }: { reach: ReachReportingSection }) {
  return (
    <section
      aria-labelledby="caring-contacts-reach-heading"
      className={sectionClass}
      data-testid="caring-contacts-reach"
    >
      <SectionHeading
        id="caring-contacts-reach-heading"
        title="Programme reach"
        description="Who the programme is reaching, reported in aggregate and never at a size that could identify one person."
        icon={Users}
      />
      <div className="px-5 py-5 text-sm leading-6 text-[color:var(--text-muted)] sm:px-6">
        {reach.kind === "notCollected" ? (
          <div className="space-y-3" data-testid="caring-contacts-reach-not-collected">
            <p className="max-w-[var(--measure)] font-medium text-[color:var(--text)]">
              This service does not record Aboriginal and Torres Strait Islander status, so there are no reach figures
              to report.
            </p>
            <p className="max-w-[var(--measure)]">
              That is a statement about what is collected, not about who is in the programme. Nobody has been asked, so
              a breakdown here would not be an empty one — there is nothing for it to be a breakdown of.
            </p>
            <p className="max-w-[var(--measure)]">
              One thing is still missing before this report can exist: a bounded set of categories to record against.
              Free text cannot carry it, which is why the field stopped being collected.
            </p>
            <p className="max-w-[var(--measure)]" data-testid="caring-contacts-reach-threshold">
              The minimum cell size below which a figure is withheld is already set under governance — it is{" "}
              <span className="font-medium tabular-nums text-[color:var(--text)]">
                {REACH_REPORTING_GOVERNANCE.smallCellThreshold}
              </span>
              , set by {REACH_REPORTING_GOVERNANCE.decidedBy} on {REACH_REPORTING_GOVERNANCE.decidedOn} and open to
              revision. So the suppression rule is ready for the day the categories exist; it is the categories that are
              waiting.
            </p>
          </div>
        ) : reach.disclosure.kind === "withheld" ? (
          <p
            className="max-w-[var(--measure)] font-medium text-[color:var(--text)]"
            data-testid="caring-contacts-reach-withheld"
          >
            {reach.disclosure.reason === "threshold-not-configured"
              ? "No minimum cell size has been set under governance, so no figure can be released. Nothing here has been suppressed; nothing has been calculated."
              : reach.disclosure.reason === "threshold-too-low-to-suppress"
                ? "The minimum cell size that has been set is too low to hide anything: at that size the marker would announce the number it stands for. No figure is released until it is raised."
                : "This breakdown cannot be released at any level of suppression without a hidden figure being recoverable by arithmetic, so it is withheld whole."}
          </p>
        ) : (
          <>
            <dl className="divide-y divide-[color:var(--border)]" data-testid="caring-contacts-reach-breakdown">
              {reach.disclosure.cells.map((cell) => (
                <div key={cell.category} className="grid gap-1 py-3 sm:grid-cols-2 sm:items-baseline">
                  <dt className="font-medium text-[color:var(--text)]">{cell.category}</dt>
                  <dd className="tabular-nums text-[color:var(--text-heading)]">
                    {cell.disclosed ? cell.count : "Suppressed"}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 max-w-[var(--measure)]">
              A suppressed figure is below the minimum cell size, or is hidden so that another one cannot be worked out.
              No total is shown, because a total would let the hidden figures be recovered by subtraction.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

export function OperationalReports({
  report,
  dispatches,
  mayViewPlans,
  mayViewDispatches,
  dispatchWindowDays,
  reach,
}: OperationalReportsProps) {
  const planMeasure = (value: number) => (mayViewPlans ? String(value) : NOT_VISIBLE);
  const dispatchMeasure = (value: number) => (mayViewDispatches ? String(value) : NOT_VISIBLE);

  return (
    <div className="min-w-0 space-y-5" data-testid="caring-contacts-reports">
      {/*
        Four across only at 1440px. At `lg:` — where this used to switch — four tiles left 127px
        of content each after `tileClass`'s `px-5`, for a `text-2xl` numeral plus a label like
        "Median minutes, attempt to resolution", which wrapped to five or six lines under the
        number it belonged to. Two-up holds 306px per tile across 1024-1439.

        `min-[1440px]:` rather than a named breakpoint, per design-system GATES §3b.
      */}
      <div className="grid gap-3 sm:grid-cols-2 min-[1440px]:grid-cols-4">
        <Measure
          label="Still to send today"
          value={planMeasure(report.today.stillToSend)}
          note={`Planned for ${report.today.calendarDay} AWST`}
        />
        <Measure
          label="Already sent today"
          value={planMeasure(report.today.alreadySent)}
          note={`Planned for ${report.today.calendarDay} AWST`}
        />
        <Measure label="Plans on record" value={planMeasure(report.plans.total)} note="Every state, this team only" />
        <Measure
          // NAMED FOR WHAT IT SPANS, not for what a reader would like it to mean. The record holds
          // no "difference detected" instant, so this is attempt-start to resolution-recorded and
          // the carrier round-trip sits inside it -- `operational-reporting.ts` carries the full
          // note. It read "Median minutes to resolve ... from a difference to its recorded
          // outcome", which a reader takes as time-to-triage; it was never that, and no assertion
          // could have caught the difference because every test measures from `startedAt` too.
          label="Median minutes, attempt to resolution"
          // `null` means nothing has been worked through yet, which is a different fact from a
          // median of zero and must never be shown as one.
          value={
            mayViewDispatches
              ? dispatches.medianMinutesFromAttemptToResolution === null
                ? "None worked through"
                : String(dispatches.medianMinutesFromAttemptToResolution)
              : NOT_VISIBLE
          }
          note={`Whole attempt, carrier round-trip included. Last ${dispatchWindowDays} days`}
        />
      </div>

      <section aria-labelledby="caring-contacts-reports-contacts-heading" className={sectionClass}>
        <SectionHeading
          id="caring-contacts-reports-contacts-heading"
          title="Contacts across every plan"
          description="Aggregate service measures only. Nothing here is a statement about how any patient is, and nothing infers one from a transport receipt."
          icon={ListChecks}
        />
        <dl className="divide-y divide-[color:var(--border)] px-5 sm:px-6">
          {[
            { label: "Already sent", value: report.contacts.alreadySent },
            { label: "Still to send", value: report.contacts.stillToSend },
            { label: "Will not be sent", value: report.contacts.willNotBeSent },
            { label: "Planned in total", value: report.contacts.total },
          ].map(({ label, value }) => (
            <div key={label} className="grid gap-1 py-3 sm:grid-cols-2 sm:items-baseline">
              <dt className="text-sm font-medium text-[color:var(--text)]">{label}</dt>
              <dd className="text-sm tabular-nums text-[color:var(--text-heading)]">{planMeasure(value)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="caring-contacts-reports-dispatch-heading" className={sectionClass}>
        <SectionHeading
          id="caring-contacts-reports-dispatch-heading"
          title="Dispatch differences"
          description={`Attempts in the last ${dispatchWindowDays} days where the carrier reported something other than what was expected, and how many have been worked through.`}
          icon={GitCompareArrows}
        />
        <dl className="divide-y divide-[color:var(--border)] px-5 sm:px-6">
          {[
            { label: "Attempts examined", value: dispatches.attempts },
            { label: "Differences found", value: dispatches.discrepancies },
            { label: "Worked through", value: dispatches.resolved },
            { label: "Still open", value: dispatches.unresolved },
          ].map(({ label, value }) => (
            <div key={label} className="grid gap-1 py-3 sm:grid-cols-2 sm:items-baseline">
              <dt className="text-sm font-medium text-[color:var(--text)]">{label}</dt>
              <dd className="text-sm tabular-nums text-[color:var(--text-heading)]">{dispatchMeasure(value)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <ReachSection reach={reach} />

      <div className="flex items-start gap-3 border-t border-[color:var(--border)] pt-5 text-sm leading-6 text-[color:var(--text-muted)]">
        <Info aria-hidden="true" className="mt-0.5 size-icon-md shrink-0" />
        <p className="max-w-[var(--measure)]">
          Every measure on this screen is an aggregate over this team, and none of them names or identifies a patient.
        </p>
      </div>
    </div>
  );
}
