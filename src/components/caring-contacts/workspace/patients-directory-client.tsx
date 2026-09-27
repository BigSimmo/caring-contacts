"use client";

import { EyeOff, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { CARING_CONTACTS_ROUTES, patientRoute } from "@/lib/caring-contacts-routes";
import { TERMINAL_PLAN_STATES, type PlanState } from "@/lib/caring-contacts/model";
import {
  PATIENTS_DIRECTORY_STATE_ORDER,
  type PatientsDirectoryFilter,
} from "@/lib/caring-contacts/patients-directory-filter";

import { AutomatedState } from "./automated-state";
import { ListEmptyState } from "./list-empty-state";
import type { PatientsDirectoryRow } from "./patients-directory-row";
import { workspacePanelPadded } from "./surfaces";
import { plural } from "./count-wording";

/**
 * The team's caseload -- the CLIENT half, and the reason the boundary exists.
 *
 * WHY THIS FILE IS A CLIENT COMPONENT
 * ----------------------------------
 * Not for interactivity, and not because a `useState` search box is nicer. It exists so that a
 * patient's NAME has somewhere to live that is not a URL.
 *
 * Until this split, the caseload search was a `method="get"` form and the name a coordinator typed
 * arrived as `?q=Jordan%20Nguyen`. That address reaches the browser's history on a possibly-shared
 * ward computer and the access log of every proxy between the browser and the server. Ruling [111]
 * forbids exactly that: "a query string is logged by every proxy between here and the browser.
 * Nothing about a patient may travel here." The typed name is now ordinary React state in this
 * module and is serialized into nothing at all -- not a query parameter, not a fragment, not a
 * hash, because a hash of a name is still a name-derived identifier sitting in a log.
 *
 * Ruling 13 -- the workspace's client payload held to a rounding error -- is a performance
 * preference, and confidentiality outranks it. The yield is paid for by narrowing rather than
 * widening: what crosses is `PatientsDirectoryRow`, already reduced to the fields this screen shows
 * and already reduced by the server to the selected plan state, so this boundary carries less than
 * the Server Component it replaced rendered into HTML. `ServiceState` is not in the row type, is
 * not a prop here, and is named nowhere in this module's import graph.
 *
 * WHAT IS STILL A URL, AND WHAT THE SCREEN OWES THE COORDINATOR FOR THE DIFFERENCE
 * -------------------------------------------------------------------------------
 * The plan-state filter stays in the address. It is not identifying, it is worth reloading and
 * sharing, and it survives both. The name search does neither, and that is a genuine loss rather
 * than a detail: a reload keeps the state filter and clears the name, so a coordinator who reloaded
 * would otherwise watch their list change with no reachable reason for it. Spec 4.4 says a state
 * the system reached on its own must state, in place, why it happened and what would change it, so
 * the note under the search control says exactly that -- and it is wired to the input with
 * `aria-describedby`, because the person who most needs it is the one who cannot see it beside the
 * box.
 *
 * The identifier search runs through the SAME control and the same local state, deliberately. One
 * box searches names and synthetic identifiers together, as the approved design shows; splitting it
 * so identifiers could stay on the server would have put two search boxes on one caseload and given
 * a coordinator a way to type a name into the wrong one. A name must never reach the server as a
 * query parameter on its way to matching an identifier, and the only way to guarantee that with one
 * control is for that control to match on this side of the boundary.
 *
 * WHAT A ROW MAY SAY
 * -----------------
 * A row still SHOWS the synthetic identifier alongside the name. It is what distinguishes two
 * patients who share a name, it is what the row's detail control is named by, and it is the only
 * thing left to head a row with when no name comes back -- which happens for a plan a retention
 * clearance has already de-identified, and for a role that may list plans without holding
 * `viewPatientRecord`. The row never claims a name it was not given, and never guesses which of
 * those two causes applies: the server does not know per row, so neither does this.
 *
 * Why the row's detail control IS a link
 * -------------------------------------
 * It was not one until Task 6. Ruling 52 held it as an unavailable control with a stated reason
 * while `/caring-contacts/patients/[patientId]` did not exist, because an unbuilt destination is
 * never a link into a route that would 404, and Ruling 89 requires the link and the screen to land
 * together. That screen now exists, so the control is `<Link href={patientRoute(...)}>`.
 *
 * It stays keyed by PATIENT rather than by this row's plan, and that is a decision rather than an
 * accident. The control says "patient record", and the destination is the patient's record: where
 * a patient holds two plans, it lands on the overview's chooser and the clinician picks, which is
 * exactly what Ruling 97 requires of a patient-keyed route.
 *
 * Three empty lists, three different facts
 * ---------------------------------------
 * `ListEmptyState` refuses to blur "nothing exists" and "a filter is hiding everything", and this
 * screen has a THIRD case: a role that may not view plans at all, which the server answers with no
 * rows exactly as it answers a team holding none. `mayViewPlans` is decided from the actor and
 * passed in so the empty list can say which of the two facts it is, and that case gets the
 * `"not-permitted"` wording shape rather than a claim that the list is empty.
 */

const PLAN_STATE_LABELS: Readonly<Record<PlanState, string>> = Object.freeze({
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  withdrawn: "Withdrawn",
  cancelled: "Cancelled",
  completed: "Completed",
});

/**
 * Every href this screen builds, and the whole of what a caseload address may contain.
 *
 * `PatientsDirectoryFilter` holds ONE field, the plan state, and it is non-identifying. There is no
 * parameter here for the name search and there must never be one -- see the module note and Ruling
 * [111]. Built from the route module, never from a path literal.
 */
export function patientsDirectoryHref(filter: PatientsDirectoryFilter): string {
  return filter.state === "all"
    ? CARING_CONTACTS_ROUTES.patients
    : `${CARING_CONTACTS_ROUTES.patients}?state=${encodeURIComponent(filter.state)}`;
}

/**
 * The search matches the patient's NAME as well as the three synthetic identifiers -- the approved
 * design's "name or synthetic ID" -- and it runs entirely inside this client boundary. The query is
 * never serialized into a URL, a server request or an audit event.
 *
 * The plan state is NOT re-checked here: the server filtered by it before building these rows, and
 * a second copy of that rule is a second place for it to drift.
 *
 * `patientName` is null for a row with no name to match, and an empty haystack segment can never
 * make a non-empty query match, so no row is found by a name it does not have.
 */
function matchesQuery(row: PatientsDirectoryRow, query: string): boolean {
  if (query === "") return true;
  const needle = query.toLowerCase();
  return `${row.patientName ?? ""} ${row.patientId} ${row.planId} ${row.referralId}`.toLowerCase().includes(needle);
}

/** The reason and the remedy for every contact this plan will not send, covering both causes. */
function suppressionExplanation(
  absorbed: number,
  other: number,
  state: PlanState,
): { because: string; changedBy: string } {
  const absorbedBecause =
    "The Week 1 message falls on the same calendar day as this plan's first contact, and two caring contacts must never land on one day, so the schedule kept one of them.";
  const absorbedChangedBy = TERMINAL_PLAN_STATES.includes(state)
    ? "Nothing here. This plan has ended, so its first-contact date can no longer be changed and it sends no further messages."
    : "Choosing a different first-contact date for this plan puts the Week 1 message back into the schedule.";
  const otherBecause = `The system marked ${plural(other, "message", "messages")} in this plan suppressed, and this row does not hold what caused that.`;
  const otherChangedBy = TERMINAL_PLAN_STATES.includes(state)
    ? "Nothing here. A suppressed message is final and is never sent later, and this plan has ended, so it sends no further messages."
    : "Nothing here. A suppressed message is final and is never sent later; the plan continues with the messages that remain.";

  if (absorbed > 0 && other > 0) {
    return {
      because: `Two separate things happened to this plan. ${absorbedBecause} ${otherBecause}`,
      changedBy: `${absorbedChangedBy} ${otherChangedBy}`,
    };
  }
  if (absorbed > 0) return { because: absorbedBecause, changedBy: absorbedChangedBy };
  return { because: otherBecause, changedBy: otherChangedBy };
}

const sectionId = "caring-contacts-patients-directory";
const searchInputId = "caring-contacts-patients-search";
const searchScopeNoteId = "caring-contacts-patients-search-scope";

const filterChipClass =
  "inline-flex min-h-tap min-w-0 items-center justify-center rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-4 text-sm font-medium text-[color:var(--text-muted)] transition-colors hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] motion-reduce:transition-none aria-[current]:border-[color:var(--clinical-accent)] aria-[current]:bg-[color:var(--clinical-accent-soft)] aria-[current]:font-semibold aria-[current]:text-[color:var(--clinical-accent)] aria-[current]:shadow-[var(--shadow-inset)] forced-colors:border-[CanvasText]";

const fieldClass =
  "min-h-tap w-full min-w-0 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface)] pl-10 pr-3 text-sm text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

const submitClass =
  "inline-flex min-h-tap shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-4 text-sm font-semibold text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] forced-colors:border-[CanvasText]";

const rowActionClass =
  "inline-flex min-h-tap min-w-0 items-center justify-center rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-4 text-sm font-medium text-[color:var(--text-muted)] sm:shrink-0";

export type PatientsDirectoryClientProps = {
  /**
   * The narrow row projection for the selected plan state, already filtered and already reduced by
   * the server. Nothing identifying beyond the patient's name has anywhere in this type to sit.
   */
  rows: readonly PatientsDirectoryRow[];
  /**
   * How many plans the team holds in total, before any filter. Non-identifying, and needed so the
   * screen can say what a filter is hiding without being handed the rows it hides.
   */
  totalPlanCount: number;
  filter: PatientsDirectoryFilter;
  /** False when the acting role does not include viewing plans -- see the module note. */
  mayViewPlans: boolean;
  /** False when the acting role does not hold `viewPatientRecord`, decided by the page. */
  mayViewPatientNames: boolean;
  /**
   * True when the address carried a saved search term that the page dropped. A BOOLEAN: the term
   * itself never crosses this boundary, and neither does its name or its length.
   */
  savedSearchNotApplied: boolean;
  /** Optional initial search query safely resolved from an obfuscated session filter token (#HDCF2B). */
  initialSearchQuery?: string;
};

export function PatientsDirectoryClient({
  rows,
  totalPlanCount,
  filter,
  mayViewPlans,
  mayViewPatientNames,
  savedSearchNotApplied,
  initialSearchQuery,
}: PatientsDirectoryClientProps) {
  // The one place the typed name lives. It is read by `matchesQuery` and rendered back into the
  // input and the empty state, and it reaches nothing else -- no href, no form, no fetch.
  const [rawQuery, setRawQuery] = useState(initialSearchQuery ?? "");
  const query = rawQuery.trim();
  const visible = rows.filter((row) => matchesQuery(row, query));
  const filtering = filter.state !== "all" || query !== "";

  return (
    <section aria-labelledby={`${sectionId}-heading`} className="min-w-0">
      <h2 id={`${sectionId}-heading`} className="text-base font-semibold text-[color:var(--text-heading)]">
        This team&rsquo;s plans
      </h2>
      <p className="mt-2 max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
        One row for each caring-contact plan this team holds. Every patient here is invented. A row carries a name and a
        synthetic identifier and nothing else about the person, because a caseload needs nothing else.
      </p>

      {mayViewPlans ? (
        <>
          {/*
            Deliberately a flat set of links rather than a `<ul>` of `<li>`s. The rows below are a
            real list, and a second list of filter chips made every chip an equal `listitem` to a
            patient's row — indistinguishable to a screen reader counting "8 items" on a caseload
            of two. The `<nav>` already names and groups these.
          */}
          <nav aria-label="Filter by plan state" className="mt-5 flex min-w-0 flex-wrap gap-2">
            <Link
              href={patientsDirectoryHref({ state: "all" })}
              data-internal-link="true"
              aria-current={filter.state === "all" ? "true" : undefined}
              className={filterChipClass}
            >
              All
            </Link>
            {PATIENTS_DIRECTORY_STATE_ORDER.map((state) => (
              <Link
                key={state}
                href={patientsDirectoryHref({ state })}
                data-internal-link="true"
                aria-current={filter.state === state ? "true" : undefined}
                className={filterChipClass}
              >
                {PLAN_STATE_LABELS[state]}
              </Link>
            ))}
          </nav>

          {/*
            NOT a form. There is nothing to submit: the typed text filters the rows already in this
            component, and submitting would be the exact defect this boundary removes — a patient's
            name in a GET query, and therefore in browser history and every proxy log on the way.
          */}
          <div role="search" className="mt-4 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative min-w-0 sm:max-w-sm sm:flex-1">
              {/*
                The control must not advertise something it cannot do. With no names released, a
                name search matches nothing on every row, so the label and the placeholder offer
                only what the search can actually find.
              */}
              <label htmlFor={searchInputId} className="sr-only">
                {mayViewPatientNames
                  ? "Search by name, or by synthetic patient, plan or referral identifier"
                  : "Search by synthetic patient, plan or referral identifier"}
              </label>
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 size-icon-md -translate-y-1/2 text-[color:var(--text-muted)]"
              />
              <input
                id={searchInputId}
                type="search"
                value={rawQuery}
                onChange={(event) => setRawQuery(event.currentTarget.value)}
                aria-describedby={searchScopeNoteId}
                autoComplete="off"
                placeholder={mayViewPatientNames ? "Name or synthetic ID" : "Synthetic identifier"}
                className={fieldClass}
              />
            </div>
            {query === "" ? null : (
              <button type="button" className={submitClass} onClick={() => setRawQuery("")}>
                Clear search
              </button>
            )}
          </div>

          {/*
            Spec 4.4, applied to the cost of the privacy fix rather than to a system-reached plan
            state. Reloading keeps the plan-state filter and clears this search, and a coordinator
            who did not know that would see their list change for no reachable reason.
          */}
          <p
            id={searchScopeNoteId}
            className="mt-2 max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]"
          >
            This search stays in this browser tab. Reloading the page, or opening its web address anywhere else, clears
            what you typed here and keeps the plan-state filter above, because the plan state is in the web address and
            what you type here never is: a patient&rsquo;s name is never put into a web address, browser history or
            server log.
          </p>

          {savedSearchNotApplied ? (
            <div className="mt-4 min-w-0">
              <SavedSearchNotAppliedNotice />
            </div>
          ) : null}

          {mayViewPatientNames ? null : (
            <div className="mt-4 min-w-0">
              <NamesNotShownNotice />
            </div>
          )}

          {visible.length > 0 ? (
            <p className="mt-4 text-sm text-[color:var(--text-muted)]">
              Showing {plural(visible.length, "plan", "plans")} of {plural(totalPlanCount, "plan", "plans")} this team
              holds.
            </p>
          ) : null}
        </>
      ) : null}

      {visible.length > 0 ? (
        <ul className="mt-4 flex min-w-0 flex-col gap-3">
          {visible.map((row) => (
            <PatientRow key={row.planId} row={row} />
          ))}
        </ul>
      ) : (
        <div className="mt-5 min-w-0">
          <DirectoryEmptyState
            totalPlanCount={totalPlanCount}
            filter={filter}
            query={query}
            filtering={filtering}
            mayViewPlans={mayViewPlans}
            clearSearch={() => setRawQuery("")}
          />
        </div>
      )}
    </section>
  );
}

/**
 * Stated once, above the list, when the acting role does not hold `viewPatientRecord`.
 *
 * Local to this screen rather than a shared component, deliberately: it is the first surface in the
 * workspace that needs it, and one use is not a pattern. If a second screen needs the same notice it
 * should move to `workspace/` then, with both call sites visible to whoever generalises it.
 *
 * Not `AutomatedState`: that component is for a state the SYSTEM reached on its own -- suppressed,
 * paused, blocked -- and its `state` prop is documented as a closed transport or plan term. A role
 * restriction is neither. It borrows the same why/what-changes-it shape, because spec 4.4's reason
 * for that shape applies just as much here, and takes its accessible name from the string it
 * renders rather than an id.
 */
function NamesNotShownNotice() {
  const heading = "Names are not shown in this role";
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
        Viewing a patient record is not part of the role you are acting in, so every row below is headed by the
        patient&rsquo;s synthetic identifier rather than their name. This says nothing about whether a name is held for
        any of them.
      </p>
      <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
        <span className="font-medium text-[color:var(--text)]">What changes it: </span>
        Nothing on this screen, and there is no control for it anywhere in this workspace yet. The role this
        demonstration acts in is set outside the interface; a coordinator sees the names.
      </p>
    </div>
  );
}

/**
 * Shown when the address this page was reached by carried a saved search term, which the page
 * dropped on the way in.
 *
 * IT NEVER ECHOES THE TERM, and it is not given it to echo -- the prop that reaches this component
 * is a boolean. Echoing a dropped name back onto the screen would put it in a screenshot, a printed
 * page and a support ticket, which is the same disclosure the address bar was closed against.
 *
 * Spec 4.4's shape, for the same reason `NamesNotShownNotice` borrows it: the coordinator opened a
 * bookmark expecting a filtered list and got an unfiltered one, and a system that quietly declines
 * to do what an address asked owes a reason and a remedy in place.
 */
function SavedSearchNotAppliedNotice() {
  const heading = "A saved search was not applied";
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
        The web address you arrived on carried a search term. This screen never takes one from a web address, because a
        patient&rsquo;s name must never travel in one, so the term was dropped from the address without being used and
        is not shown here.
      </p>
      <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
        <span className="font-medium text-[color:var(--text)]">What changes it: </span>
        Type what you were looking for into the search box above. A search here stays in this browser tab, so there is
        nothing for a bookmark to save.
      </p>
    </div>
  );
}

function DirectoryEmptyState({
  totalPlanCount,
  filter,
  query,
  filtering,
  mayViewPlans,
  clearSearch,
}: {
  totalPlanCount: number;
  filter: PatientsDirectoryFilter;
  query: string;
  filtering: boolean;
  mayViewPlans: boolean;
  clearSearch: () => void;
}) {
  if (!mayViewPlans) {
    return (
      <ListEmptyState
        kind="not-permitted"
        heading="Plans are not visible in this role"
        because="Viewing plans is not part of the role you are acting in. This says nothing about how many plans this team holds: a read you may not make and a team holding none look identical on purpose, so that nobody can find out a record exists by being refused it."
        changedBy="Nothing on this screen changes it, and there is no control for it anywhere in this workspace yet. The role this demonstration acts in is set outside the interface; a coordinator sees this team's plans."
      />
    );
  }

  if (totalPlanCount === 0) {
    return (
      <ListEmptyState
        kind="no-data"
        heading="No patients yet"
        explanation="This team holds no caring-contact plan. A patient appears here once a coordinator accepts a referral and claims a plan for it."
      />
    );
  }

  if (filtering) {
    return (
      <ListEmptyState
        kind="filtered"
        heading="No patients match"
        because={hiddenBecause(totalPlanCount, filter, query)}
        changedBy={`Clearing the filter shows all ${plural(totalPlanCount, "plan", "plans")} this team holds.`}
        action={
          // ONE control for BOTH filters, because they now live in two different places and a
          // remedy that cleared only one of them would be a promise the screen does not keep: the
          // href drops the plan state from the address, and the handler drops the typed search
          // from this tab. A `<Link>` alone would leave the name search filtering the list it had
          // just navigated to.
          <Link
            href={CARING_CONTACTS_ROUTES.patients}
            data-internal-link="true"
            onClick={clearSearch}
            className={submitClass}
          >
            Show every plan
          </Link>
        }
      />
    );
  }

  // Unreachable in practice -- `visible` can only be shorter than `rows` when something is
  // filtering -- but stated rather than left to fall through to nothing at all.
  return (
    <ListEmptyState
      kind="no-data"
      heading="No patients yet"
      explanation="This team holds no caring-contact plan. A patient appears here once a coordinator accepts a referral and claims a plan for it."
    />
  );
}

/** Plain words for exactly which of the two filters is hiding the list, and how much it is hiding. */
function hiddenBecause(total: number, filter: PatientsDirectoryFilter, query: string): string {
  const held = `the ${plural(total, "plan", "plans")} this team holds`;
  if (filter.state !== "all" && query !== "") {
    return `The state filter is set to ${PLAN_STATE_LABELS[filter.state]} and the search is "${query}". Nothing among ${held} satisfies both.`;
  }
  if (filter.state !== "all") {
    return `The state filter is set to ${PLAN_STATE_LABELS[filter.state]}, and none of ${held} is in that state.`;
  }
  return `The search for "${query}" matches no name or identifier among ${held}.`;
}

/**
 * One plan's row.
 *
 * `patientName` is null when the names read held nothing for this plan -- a de-identified episode,
 * or a role without `viewPatientRecord`. The heading then falls back to the synthetic identifier and
 * the label above it says which of the two the heading is, so the row never presents an identifier
 * as a name or leaves a reader guessing. It deliberately does not try to say WHICH cause applies:
 * the screen is not told, and guessing between "this episode was de-identified" and "your role may
 * not see names" would be a claim nothing here can support.
 */
function PatientRow({ row }: { row: PatientsDirectoryRow }) {
  const suppressed = row.absorbedContactCount + row.otherSuppressedContactCount;
  const explanation = suppressionExplanation(row.absorbedContactCount, row.otherSuppressedContactCount, row.state);

  return (
    <li className={workspacePanelPadded}>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-[color:var(--text-muted)]">
            {row.patientName === null ? "Synthetic patient identifier" : "Patient"}
          </p>
          <h3 className="mt-0.5 break-words text-sm font-semibold text-[color:var(--text-heading)]">
            {row.patientName ?? row.patientId}
          </h3>
          {/*
            Kept beside the name, not replaced by it. Two patients can share a name, the row's
            detail control is named by the identifier, and it is the identifier a clinician quotes
            when asking about a record.
          */}
          {row.patientName === null ? null : (
            <p className="mt-0.5 break-words text-xs text-[color:var(--text-muted)]">
              Synthetic identifier: {row.patientId}
            </p>
          )}
          <p className="mt-2 text-sm leading-6 text-[color:var(--text-muted)]">
            <span className="font-medium text-[color:var(--text)]">Plan state: </span>
            {PLAN_STATE_LABELS[row.state]}
          </p>
          <p className="text-sm leading-6 text-[color:var(--text-muted)]">
            <span className="font-medium text-[color:var(--text)]">Discharged: </span>
            {row.dischargeDay} (AWST)
          </p>
          <p className="text-sm leading-6 text-[color:var(--text-muted)]">
            <span className="font-medium text-[color:var(--text)]">Contacts: </span>
            {plural(row.scheduledContactCount, "message in the schedule", "messages in the schedule")}
          </p>
        </div>
        {/*
          The visible text carries the identifier so that one row's control is still
          distinguishable from the next -- a screen reader listing this page's links otherwise
          reads "Patient record" as many times as there are rows, with nothing to tell them apart.
        */}
        <Link href={patientRoute(row.patientId)} data-internal-link="true" className={rowActionClass}>
          <span className="truncate">Patient record &mdash; {row.patientId}</span>
        </Link>
      </div>

      {/*
        Spec 4.4: a state the system reached on its own must state, in place, why and what would
        change it. A suppressed contact is one the system decided not to send, and the row would
        otherwise show a smaller message count with no reachable reason for it.

        Two causes exist, they have different remedies, and a plan can carry BOTH — so the reason
        covers whichever are actually present rather than picking one. The schedule absorbing Week 1
        into the first contact is reversible by the coordinator; any other suppression is terminal
        (`suppressed` is in the contact model's terminal set) and this row does not hold what caused
        it, so it says that rather than inventing a remedy or naming a screen that does not exist.
      */}
      {suppressed > 0 ? (
        <div className="mt-3 min-w-0">
          <AutomatedState state="Suppressed" because={explanation.because} changedBy={explanation.changedBy} />
        </div>
      ) : null}
    </li>
  );
}
