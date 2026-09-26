import { EyeOff, FolderOpen, SearchX } from "lucide-react";
import type { ReactNode } from "react";

/**
 * One shared way of saying "this list has nothing in it", for the four Phase 2B
 * list screens (patients, schedule, templates, team) that would otherwise each
 * invent their own.
 *
 * Named `ListEmptyState`, not the shorter `EmptyState`: `src/components/ui-primitives.tsx`
 * already exports a registered design-system primitive called `EmptyState`, used across 43
 * files. The bare name would have been a real collision, not merely a stylistic one —
 * `scripts/generate-design-system-adoption.mjs` credits a component with test coverage by
 * matching `\bName\b` against raw test-file TEXT, with no import-path awareness, so a test
 * file that used the bare name (even for this unrelated component) would have been recorded
 * as proof coverage for the *other* `EmptyState` in the generated adoption manifest — a false
 * claim about what that primitive's tests actually exercise. `ListEmptyState` does not match
 * `\bEmptyState\b` (the character before "EmptyState" is not a word boundary), so it cannot
 * recreate that false attribution.
 *
 * There are exactly three reasons a list can be empty, and they read as
 * different facts to a clinician, so the component refuses to blur them into one
 * shape:
 *
 *  - `"no-data"` — nothing exists yet. The list is genuinely empty.
 *  - `"filtered"` — records exist, but the current filter or search is hiding
 *    all of them. A `"filtered"` empty list that only says "Nothing to show" is
 *    indistinguishable from `"no-data"` and invites a clinician to conclude a
 *    caseload is empty when it is not — which is the defect this component
 *    exists to prevent. So the `"filtered"` branch cannot be built without
 *    stating a `because` and a `changedBy`; there is no shared optional field
 *    that a caller could simply leave out.
 *  - `"not-permitted"` — the acting role may not see these records at all, so
 *    the list says NOTHING about how many exist. Ruling 92 added this kind in
 *    Phase 2B Task 5, after the Patients directory expressed the case with
 *    `"filtered"`: a store answers an actor without the capability with an empty
 *    array, exactly as it answers a team with no records, so a screen that only
 *    counted rows would tell an auditor their caseload is empty. The screen's
 *    WORDS could be made honest that way, and were; the type and the icon could
 *    not. `"filtered"` documents itself as "records exist", which this case
 *    asserts neither half of, and it selects a struck-through magnifying glass —
 *    a search reported on a screen where no search was performed, in a component
 *    whose own rule is that the icon states the difference wordlessly. `EyeOff`
 *    says "not shown to you", which is the fact. It takes the same
 *    `because`/`changedBy` pair as `"filtered"`, for the same reason: a
 *    restriction with no stated remedy is a dead end. And the remedy must be
 *    REAL — see Ruling 93; naming a control that does not exist is worse than
 *    naming none, because the reader will hunt for it.
 *
 * The `"filtered"` branch reuses `AutomatedState`'s "Why: … / What changes it:
 * …" wording shape, so a clinician learns one pattern across the workspace —
 * but this is its own component. Ruling 81: `ListEmptyState` does not render
 * `AutomatedState` internally. The two have different triggers (the system
 * acting on its own, versus a user's own filter or simply nothing existing
 * yet) and `AutomatedState`'s `CircleAlert` icon and state-name `aria-label`
 * are both wrong for "no patients yet", so this component carries its own
 * icon pair and never labels itself with the word "state".
 *
 * It DOES reuse `AutomatedState`'s accessible grouping, though — Ruling 81 forbade rendering
 * `AutomatedState`, not reusing the structure that makes its reason and remedy reachable
 * together. `automated-state.tsx` wraps its three pieces in `role="group"` with an
 * `aria-label`, so that a screen reader that reaches the state has entered a named group and
 * finds the reason and the remedy without hunting for them elsewhere on the page. This
 * component has the identical shape for `"filtered"` (heading, "Why:", "What changes it:"),
 * so it gets the same wrapper — applied to the WHOLE component rather than only the
 * `"filtered"` branch, so a `"no-data"` instance is an equally well-named group and a
 * clinician learns one grouping pattern for this component regardless of kind, not two.
 *
 * A Server Component with no hooks, deliberately (Ruling 13): every one of the
 * four list screens renders this on first paint, so a hook here would put a
 * client boundary under all four instead of none. The group above is named by
 * `aria-label={heading}` rather than `aria-labelledby`, the same `useId`-avoiding
 * technique `automated-state.tsx` already proves safe, for the same reason:
 * `aria-labelledby` needs an id, an id needs `useId`, and `useId` is a hook.
 *
 * The optional `action` is never built from raw `onClick`/`href` props — it is
 * a fully-formed node the caller already built (a `<Link>`, a form-submit
 * button, or an `UnavailableDestination`), the same way `ServiceStateBanner` —
 * also a Server Component — hosts `UnavailableDestination` as a child without
 * becoming a Client Component itself. If a caller wants an action that is not
 * yet available, `UnavailableDestination` is still the tool for that; this
 * component does not build a second disabled-control pattern to compete with
 * it.
 */
export type ListEmptyStateAction = ReactNode;

export type ListEmptyStateNoDataProps = {
  kind: "no-data";
  /** Sentence-case heading naming what is empty, e.g. "No patients yet". */
  heading: string;
  /** Plain-words statement that the list is genuinely empty, and how a first record arrives. */
  explanation: string;
  /** At most one already-built control — a `<Link>`, a form-submit button, or an `UnavailableDestination`. */
  action?: ListEmptyStateAction;
};

export type ListEmptyStateFilteredProps = {
  kind: "filtered";
  /** Sentence-case heading naming what the filter hid, e.g. "No patients match". */
  heading: string;
  /** Plain-words reason the current filter or search is hiding every record. */
  because: string;
  /** Plain-words statement of what would change it — clear the filter, widen the search. */
  changedBy: string;
  /** At most one already-built control — a `<Link>`, a form-submit button, or an `UnavailableDestination`. */
  action?: ListEmptyStateAction;
};

export type ListEmptyStateNotPermittedProps = {
  kind: "not-permitted";
  /** Sentence-case heading naming what is not visible, e.g. "Plans are not visible in this role". */
  heading: string;
  /** Plain-words reason this role cannot see the records — never a claim about how many exist. */
  because: string;
  /** Plain-words statement of what would change it. If nothing on this screen can, say exactly that. */
  changedBy: string;
  /** At most one already-built control — a `<Link>`, a form-submit button, or an `UnavailableDestination`. */
  action?: ListEmptyStateAction;
};

export type ListEmptyStateProps =
  ListEmptyStateNoDataProps | ListEmptyStateFilteredProps | ListEmptyStateNotPermittedProps;

export function ListEmptyState(props: ListEmptyStateProps) {
  // Three different icons, never one reused across kinds: the icon is part of
  // what states the difference wordlessly, matching the "words and an icon,
  // never colour alone" rule this file inherits from `automated-state.tsx`.
  // Reusing `SearchX` for `"not-permitted"` would draw a struck-through
  // magnifying glass on a screen where no search was performed — the defect
  // Ruling 92 closed.
  const Icon = props.kind === "no-data" ? FolderOpen : props.kind === "filtered" ? SearchX : EyeOff;

  return (
    <div
      role="group"
      aria-label={props.heading}
      /*
        One hook for "this list is showing nothing", carried by all three kinds.
        `tests/ui-caring-contacts-populated.spec.ts` runs against the SEEDED server and has to be
        able to prove a screen actually has records on it before it measures the layout of one --
        a sweep that silently ran against empty screens would pass while proving exactly nothing,
        which is the gap that spec exists to close. Matching the rendered prose instead was tried
        and is not workable: the copy on these screens legitimately contains sentences like
        "No contact needs review on a plan nobody owns", which is a populated screen saying
        something true, not an empty one.
      */
      data-testid="caring-contacts-list-empty-state"
      className="flex min-w-0 flex-col items-start gap-2 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-4 py-6 forced-colors:border-[CanvasText]"
    >
      <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[color:var(--text-heading)]">
        <Icon aria-hidden="true" className="size-icon-md shrink-0" />
        <span className="min-w-0">{props.heading}</span>
      </p>
      {props.kind === "no-data" ? (
        <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">{props.explanation}</p>
      ) : (
        <>
          <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
            <span className="font-medium text-[color:var(--text)]">Why: </span>
            {props.because}
          </p>
          <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
            <span className="font-medium text-[color:var(--text)]">What changes it: </span>
            {props.changedBy}
          </p>
        </>
      )}
      {props.action ? <div className="mt-1">{props.action}</div> : null}
    </div>
  );
}
