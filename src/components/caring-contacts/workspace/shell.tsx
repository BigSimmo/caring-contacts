import {
  BarChart3,
  BookOpen,
  CalendarDays,
  FilePlus,
  FileText,
  HeartHandshake,
  LayoutDashboard,
  LogOut,
  MoreHorizontal,
  OctagonX,
  Plus,
  ScrollText,
  UserCog,
  Users,
} from "lucide-react";
import Link from "next/link";
import { SignOutForm } from "./sign-out-form";

import { isCaringContactsLiveEnabled } from "@/lib/caring-contacts-server/workspace-gate";
import type { ComponentType, ReactNode, SVGProps } from "react";

import { floatingControl, primaryControl, transitionSurface } from "@/components/ui-primitives";
import { CARING_CONTACTS_ROUTES } from "@/lib/caring-contacts-routes";
import type { ServiceState } from "@/lib/caring-contacts/service-state";

import { WorkspaceOverlays } from "./overlays/workspace-overlays";
import { CondensedServiceStopBar, ServiceStateBanner } from "./service-state-banner";
import { WORKSPACE_HEADER_ID } from "./service-stop-bar-anchors";
import { workspacePanelPadded } from "./surfaces";
import { SyntheticMarker } from "./synthetic-marker";
import { UnavailableDestination } from "./unavailable-destination";
import type { WorkspaceWidthState } from "./width-state";
import { WorkspaceNavLink } from "./workspace-nav-link";

// Re-exported so Tasks 16-18 keep one import site for the shell and its safeguard.
export { FICTIONAL_DATA_MARKER } from "./synthetic-marker";

/** The anchor the phone "More" destination jumps to. */
const MORE_DESTINATIONS_ID = "caring-contacts-more";

type NavigationIcon = ComponentType<SVGProps<SVGSVGElement>>;

type WorkspaceDestination = {
  id: string;
  label: string;
  icon: NavigationIcon;
  /** Present only once the destination has a page. Absent means unavailable. */
  href?: string;
  /** Plain words: what this destination holds, or will hold. */
  reason: string;
};

/**
 * The four primary destinations, frozen by the approved route identities.
 *
 * A destination carries an `href` once — and only once — it has a page. The
 * rest render as unavailable controls that state their reason rather than as
 * links into a not-found page (Ruling 52). Plan 2B gives them pages, and adding
 * an `href` here is the whole of that change. Each entry below says in a comment
 * which task built its screen, so the table states that per row rather than
 * carrying a list somewhere else that a later task has to remember to extend --
 * the decaying form this list was in until the merge, when it still said
 * `Templates` had no `href` and the branch that gave it one was about to land.
 *
 * Ruling 89: the link and the real screen land together. A navigation entry lit
 * up ahead of its screen would point at a page that says "No patients yet"
 * whether or not patients exist, which is a false statement on a clinical
 * caseload screen — so the `href` is added in the same change as the page.
 */
const PRIMARY_DESTINATIONS: readonly WorkspaceDestination[] = [
  {
    id: "today",
    label: "Today",
    icon: LayoutDashboard,
    // A link since Phase 2A built the Today screen.
    href: CARING_CONTACTS_ROUTES.today,
    reason: "The day's caring-contact work for this team.",
  },
  {
    id: "patients",
    label: "Patients",
    icon: Users,
    // A link since Phase 2B Task 5 built the caseload, in the same change (Ruling 89).
    href: CARING_CONTACTS_ROUTES.patients,
    reason: "Every patient with a caring-contact plan, and where each plan has got to.",
  },
  {
    id: "schedule",
    label: "Schedule",
    icon: CalendarDays,
    href: CARING_CONTACTS_ROUTES.schedule,
    reason: "Contacts due, day by day.",
  },
  {
    id: "templates",
    label: "Templates",
    icon: FileText,
    // A link since Phase 2B Task 15 built the library behind it, in the same change (Ruling 89).
    href: CARING_CONTACTS_ROUTES.templates,
    reason: "Governed pathways, message wording and approval history.",
  },
];

/** The phone bar carries three destinations plus a jump to the More panel. */
const PHONE_DESTINATIONS = PRIMARY_DESTINATIONS.filter((destination) => destination.id !== "templates");

/**
 * The primary destinations the phone bar has no room for.
 *
 * DERIVED FROM THE TWO ARRAYS ABOVE rather than listed, because a hand-written third list is how
 * the defect this fixes arose in the first place. `templates` gained a page and an `href` in Task
 * 15, sat in the rail -- which is `hidden … md:flex` -- and was filtered out of the phone bar by
 * name, so below 768px a shipped production route had no inbound link anywhere in the workspace.
 * Nothing caught it: `tests/route-reachability.test.ts` reads this file as TEXT and regex-matches
 * `href…CARING_CONTACTS_ROUTES.<key>` with no notion of which array the match sits in, whether that
 * array is filtered, or what CSS governs the element rendering it. That gate proves a route is
 * REFERENCED IN SOURCE; it cannot prove any viewport reaches it.
 *
 * These render in the More panel -- which is in the document at every width -- inside a `md:hidden`
 * row, so they appear exactly where the rail does not. Deriving the set means dropping a fourth
 * destination from the phone bar tomorrow routes it here without anyone remembering to.
 * `tests/caring-contacts-workspace-shell.dom.test.tsx` checks reachability by walking each link's
 * real ancestor chain for the classes that hide it, which is the assertion that can actually fail.
 */
const PHONE_OVERFLOW_DESTINATIONS = PRIMARY_DESTINATIONS.filter(
  (destination) => !PHONE_DESTINATIONS.includes(destination),
);

/**
 * Every remaining declared destination, with what it holds or will hold.
 * `docs/wiring-conventions.md` requires the reason to be stated, not implied.
 *
 * Ruling 89 governs the `href` here exactly as it governs the rail's: a destination carries one
 * once, and only once, it has a page, and the link lands in the same change as the screen. The
 * field is optional, and every entry without one still renders as an `UnavailableDestination`
 * stating its reason -- the shape grew; the behaviour of the entries that did not change did not.
 */
type MoreDestination = { id: string; label: string; reason: string; href?: string };

const MORE_DESTINATIONS: readonly MoreDestination[] = [
  {
    id: "team",
    label: "Team",
    // A link since Phase 2B Task 18 built the screen behind it, in the same change (Ruling 89).
    href: CARING_CONTACTS_ROUTES.team,
    reason: "Ownership, coverage and unclaimed work.",
  },
  {
    id: "guidance",
    label: "Guidance",
    // A link since Phase 2B Task 19 built the screen behind it, in the same change (Ruling 89).
    href: CARING_CONTACTS_ROUTES.guidance,
    reason: "Programme boundaries and operational guidance.",
  },
  {
    id: "reports",
    label: "Reports",
    // A link since Phase 2B Task 19 built the screen behind it, in the same change (Ruling 89).
    href: CARING_CONTACTS_ROUTES.reports,
    reason: "Aggregate operational reporting.",
  },
  {
    id: "intake",
    label: "Referral intake",
    href: CARING_CONTACTS_ROUTES.intake,
    reason: "Registering a hospital discharge referral by hand when the electronic feed is unavailable.",
  },
  // Service stop and Access trail: links since the service stop screen was built (owner request
  // 2026-09-26), each in the same change as its page (Ruling 89).
  {
    id: "service-stop",
    label: "Service stop",
    href: CARING_CONTACTS_ROUTES.serviceStop,
    reason: "Stopping the whole service, and restarting it.",
  },
  {
    id: "access-trail",
    label: "Access trail",
    href: CARING_CONTACTS_ROUTES.accessTrail,
    reason: "Who opened which record, and when.",
  },
  { id: "workload", label: "Workload", reason: "Work waiting across the team." },
  { id: "reconciliation", label: "Reconciliation", reason: "Differences between what was planned and what happened." },
  { id: "notifications", label: "Notifications", reason: "What the team is told, and how." },
  { id: "training", label: "Training", reason: "Practice mode, kept apart from real records." },
  { id: "coverage", label: "Coverage", reason: "Who is covering while someone is away." },
];

/**
 * The built More destinations, repeated in the desktop rail so a wide screen reaches Team, Guidance,
 * Reports and Referral intake without scrolling to the More panel under every page.
 *
 * DERIVED FROM `MORE_DESTINATIONS` (only the entries that carry an `href`), for the same reason the
 * phone overflow list is derived: a third hand-written list is how a destination goes missing from
 * one surface. An entry gains a rail link in the same change that gives it a page. The icon map is
 * keyed by id; an id without an icon falls back to the generic "more" glyph rather than failing.
 */
const RAIL_MORE_ICONS: Readonly<Record<string, ComponentType<SVGProps<SVGSVGElement>>>> = {
  team: UserCog,
  guidance: BookOpen,
  reports: BarChart3,
  intake: FilePlus,
  // Service stop screen (2026-09-26).
  "service-stop": OctagonX,
  "access-trail": ScrollText,
};

const RAIL_MORE_DESTINATIONS = MORE_DESTINATIONS.flatMap((destination) =>
  destination.href
    ? [{ ...destination, href: destination.href, icon: RAIL_MORE_ICONS[destination.id] ?? MoreHorizontal }]
    : [],
);

/**
 * The four width states of coordination design spec §7, made observable.
 *
 * The layout is pure Tailwind media classes and needs no JavaScript, but that
 * also means nothing in the DOM records which state is active — so a browser
 * proof would have had to re-derive the very breakpoints it is meant to check.
 * Exactly one of these markers is displayed at any width, which lets
 * `tests/ui-caring-contacts-workspace.spec.ts` compare the rendered state
 * against `widthStateFor()` itself rather than against a second copy of the
 * numbers.
 *
 * No named Tailwind breakpoint is used here. Tailwind's `xl` is 1280px, not the
 * frozen 1440, and design-system GATES §3b forbids adding a named
 * `--breakpoint-*` token for these states — so each range is written out.
 *
 * Each marker is `hidden` plus exactly ONE variant that turns it back on. The
 * obvious spelling — `hidden lg:block min-[1440px]:hidden` — is wrong, and wrong
 * silently: Tailwind sorts named breakpoints against each other, but an
 * arbitrary `min-[…]` variant is not guaranteed to be emitted after a named one,
 * so at 1440px `lg:block` won and both `split` and `wide` showed at once.
 * Variant-versus-base ordering is guaranteed; variant-versus-variant is not.
 * Caught by the browser proof at 1440px, the width the mapping exists for.
 *
 * The ranges use media-query range syntax so consecutive bounds MEET rather than
 * merely approach: `< 768px` and `768px <=` share an exact edge, where a
 * `max-[767.98px]` / `min-[768px]` pair would leave 767.98-768.00 showing no
 * marker at all. Integer widths never land there, but 400% zoom produces
 * fractional widths, and a width with no state would fail Task 19 confusingly
 * rather than usefully.
 */
const WIDTH_STATE_MARKERS: readonly { state: WorkspaceWidthState; className: string; label: string }[] = [
  { state: "compact", className: "hidden [@media_(width_<_768px)]:block", label: "Compact layout" },
  { state: "rail", className: "hidden [@media_(768px_<=_width_<_1024px)]:block", label: "Rail layout" },
  { state: "split", className: "hidden [@media_(1024px_<=_width_<_1440px)]:block", label: "Split layout" },
  { state: "wide", className: "hidden [@media_(width_>=_1440px)]:block", label: "Wide layout" },
];

export type CaringContactsShellProps = {
  /** The screen's own name; rendered as the one and only `h1`. */
  title: string;
  /** Optional plain-words statement of what this screen is for. */
  description?: string;
  /**
   * The service-wide safety stop, read from the store by the screen.
   *
   * REQUIRED, and required for a safety reason rather than a tidiness one
   * (Ruling 56). Spec §4.2 puts the banner on EVERY screen while a stop is
   * active, and "everywhere" is not a property that can rest on each page
   * author remembering an optional prop: a screen whose author forgot would
   * show no banner at all during a live stop, and a clinician would keep
   * working believing sending was fine. Making it required means the compiler
   * refuses a new screen that omits it.
   *
   * It must be a state the screen actually READ. Passing a literal
   * `{ stopped: false }` to satisfy the type would be worse than leaving the
   * prop optional — it would render a confident "service running" during an
   * incident.
   */
  serviceState: ServiceState;
  /**
   * Whether the header carries the "New plan" control. False only on the New plan screen itself,
   * where a control linking to the page already open does nothing a reader can see.
   */
  showPrimaryControl?: boolean;
  children: ReactNode;
};

const railItemClass =
  "flex min-h-tap w-full min-w-0 items-center gap-3 rounded-[var(--radius-md)] px-3 text-left text-sm font-medium text-[color:var(--text-muted)] transition-colors hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)] motion-reduce:transition-none";

const phoneItemClass =
  "flex min-h-tap w-full min-w-0 flex-col items-center justify-center gap-1 px-1 text-2xs font-medium text-[color:var(--text-muted)]";

/**
 * The AVAILABLE appearance of a More-panel row, and it has to be that rather than a neutral one.
 *
 * `MorePanelDestination` hands this same class to a live `<Link>` and to an `UnavailableDestination`,
 * so whatever it says is what BOTH look like. It used to say `--surface-subtle` with muted ink,
 * which is roughly where the design system's `controlDisabled` lands an unavailable control -- so
 * the seven unbuilt destinations were pixel-identical to the three real links, and the only signal
 * a sighted person got was the click doing nothing. (Assistive tech was always told correctly:
 * `aria-disabled`, an `sr-only` reason, and the panel's own legend.)
 *
 * Raising the available state to a raised surface with full-strength ink gives
 * `controlDisabled` -- now appended inside `unavailable-destination.tsx` -- something to flatten
 * FROM. `transitionSurface` rather than a bare `transition` because it carries
 * `motion-reduce:transition-none` with it, matching `railItemClass` above.
 */
const morePanelItemClass = `flex min-h-tap w-full min-w-0 items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 text-left text-sm font-medium text-[color:var(--text)] shadow-[var(--e1)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-subtle)] ${transitionSurface}`;

/** How the open destination reads, keyed off the `data-current` hook `WorkspaceNavLink` sets. */
const railItemCurrent =
  "data-[current=true]:bg-[color:var(--clinical-accent-soft)] data-[current=true]:text-[color:var(--clinical-accent)] data-[current=true]:font-semibold";
const phoneItemCurrent = "data-[current=true]:text-[color:var(--clinical-accent)] data-[current=true]:font-semibold";
const morePanelItemCurrent =
  "data-[current=true]:border-[color:var(--clinical-accent)] data-[current=true]:text-[color:var(--clinical-accent)]";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

/**
 * One row of the More panel: a real link once the destination has a screen, and the unavailable
 * control stating its reason until then.
 *
 * One renderer rather than the branch written twice, because the panel now carries two lists --
 * the declared destinations and the primary ones the phone bar overflows -- and two copies of the
 * branch would be free to diverge on the half nobody was looking at. Ruling 52 governs the else:
 * an unbuilt destination is never a link into a page that would 404.
 */
function MorePanelDestination({
  id,
  label,
  href,
  reason,
}: {
  id: string;
  label: string;
  href?: string;
  reason: string;
}) {
  return href ? (
    <WorkspaceNavLink href={href} className={`${morePanelItemClass} ${morePanelItemCurrent} ${focusRing}`}>
      <span className="truncate">{label}</span>
    </WorkspaceNavLink>
  ) : (
    <UnavailableDestination id={id} label={label} reason={reason} className={morePanelItemClass} />
  );
}

/**
 * The Caring Contacts workspace shell.
 *
 * A Server Component by design. The four width states are expressed entirely in
 * Tailwind media classes, so the layout needs no JavaScript:
 *
 * | state   | width       | expression                                        |
 * | ------- | ----------- | ------------------------------------------------- |
 * | compact | below 768   | base — phone dock, no rail, one column            |
 * | rail    | 768-1023    | `md:` — icon rail, labels kept for screen readers |
 * | split   | 1024-1439   | `lg:` — labelled rail, one full-width content column |
 * | wide    | 1440 and up | `min-[1440px]:` — the same, with a wider measure cap |
 *
 * The `split` and `wide` rows said "More panel as a column" and "the same split" until that grid
 * was removed; content is now a single column at every width and the More panel is a section
 * beneath it. Nothing about the four BOUNDARIES changed — they are still the frozen 768/1024/1440,
 * and `width-state.ts` is still the only place they are written as numbers.
 *
 * `width-state.ts` holds the same boundaries as numbers for the overlay
 * modality decision; nothing here re-derives them.
 */
export function CaringContactsShell({
  title,
  description,
  serviceState,
  showPrimaryControl = true,
  children,
}: CaringContactsShellProps) {
  const isTrainingMode = process.env.NEXT_PUBLIC_CARING_CONTACTS_TRAINING_MODE === "true";

  return (
    <div className="min-h-dvh bg-[color:var(--background)] text-[color:var(--text)] md:flex">
      {/* The first thing a keyboard reaches, so the rail's links need not be tabbed through on every page. */}
      <a
        href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-[var(--z-toast)] focus-visible:rounded-[var(--radius-md)] focus-visible:bg-[color:var(--surface)] focus-visible:px-4 focus-visible:py-3 focus-visible:text-sm focus-visible:font-semibold focus-visible:text-[color:var(--text-heading)] focus-visible:shadow-[var(--e2)]"
      >
        Skip to main content
      </a>
      {WIDTH_STATE_MARKERS.map(({ state, className, label }) => (
        <span key={state} data-workspace-width-state={state} className={`sr-only ${className}`}>
          {label}
        </span>
      ))}

      <aside
        data-testid="caring-contacts-rail"
        className="sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-[color:var(--border)] bg-[color:var(--surface-chrome)] md:flex md:w-20 lg:w-64"
      >
        <div className="flex min-h-[var(--header-h)] items-center gap-3 border-b border-[color:var(--border)] px-4 lg:px-5">
          <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)] forced-colors:border forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]">
            <HeartHandshake aria-hidden="true" className="size-icon-lg" />
          </span>
          <span className="sr-only min-w-0 lg:not-sr-only">
            <span className="block truncate text-sm font-semibold text-[color:var(--text-heading)]">
              Caring Contacts
            </span>
          </span>
        </div>

        <nav aria-label="Workspace" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-3">
          {PRIMARY_DESTINATIONS.map(({ id, label, href, icon: Icon, reason }) =>
            href ? (
              <WorkspaceNavLink key={id} href={href} className={`${railItemClass} ${railItemCurrent} ${focusRing}`}>
                <Icon aria-hidden="true" className="size-icon-lg shrink-0" />
                <span className="truncate sr-only lg:not-sr-only">{label}</span>
              </WorkspaceNavLink>
            ) : (
              <UnavailableDestination
                key={id}
                id={`rail-${id}`}
                label={label}
                reason={reason}
                className={railItemClass}
              >
                <Icon aria-hidden="true" className="size-icon-lg shrink-0" />
                <span className="truncate sr-only lg:not-sr-only">{label}</span>
              </UnavailableDestination>
            ),
          )}
          <div aria-hidden="true" className="my-2 border-t border-[color:var(--border)]" />
          {RAIL_MORE_DESTINATIONS.map(({ id, label, href, icon: Icon }) => (
            <WorkspaceNavLink key={id} href={href} className={`${railItemClass} ${railItemCurrent} ${focusRing}`}>
              <Icon aria-hidden="true" className="size-icon-lg shrink-0" />
              <span className="truncate sr-only lg:not-sr-only">{label}</span>
            </WorkspaceNavLink>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        {isTrainingMode && (
          <div
            data-testid="caring-contacts-training-banner"
            role="status"
            className="w-full border-b-2 border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] px-4 py-2 text-center text-xs font-bold uppercase tracking-wider text-[color:var(--warning-text)] sm:text-sm"
          >
            TRAINING MODE — Synthetic Data Only — No SMS Dispatched
          </div>
        )}
        <header
          id={WORKSPACE_HEADER_ID}
          data-synthetic-marker-host
          className="sticky top-0 z-[var(--z-raised)] border-b border-[color:var(--border)] bg-[color:var(--surface-chrome)] px-4 sm:px-6 lg:px-8 forced-colors:bg-[Canvas]"
        >
          <div className="flex min-h-[var(--header-h)] items-center justify-between gap-3 py-2">
            <div className="flex shrink-0 items-center gap-3 md:hidden">
              <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)] forced-colors:border forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]">
                <HeartHandshake aria-hidden="true" className="size-icon-lg" />
              </span>
              <span className="whitespace-nowrap text-sm font-semibold text-[color:var(--text-heading)]">
                Caring Contacts
              </span>
            </div>
            {/* One row at every width: on a narrow phone the marker's words wrap inside it rather than
                pushing the whole marker onto a second header row. */}
            <SyntheticMarker className="ml-auto min-w-0 text-balance text-center" />
          </div>

          {/*
            The condensed statement of a service-wide stop, pinned under this header once the
            full banner below has scrolled out of view. It renders nothing while the service is
            running, and never at the same time as the banner. It lives INSIDE the header, and
            absolutely positioned, so it rides the sticky header without a second sticky element,
            without a magic offset the measured header height would not match, and without
            moving any content as it appears. See `service-state-banner.tsx`.
          */}
          <CondensedServiceStopBar state={serviceState} />
        </header>

        {/*
          Directly under the header, above the screen's own content, so a stop is
          the first thing read on every screen rather than something to scroll to.
          It renders nothing while the service is running.
        */}
        <ServiceStateBanner state={serviceState} />

        {/*
          The bottom reserve is DERIVED from the dock rather than guessed at. The dock below is
          `min-h-tap` plus a top border plus `pb-[var(--safe-area-bottom)]`, so the same two tokens
          plus a clear 1.5rem is the clearance -- and it can no longer drift from the dock the way a
          flat `pb-28` (112px against a 48px dock, 63px of dead space at every phone width) had.
          `md:pb-8` still takes over once the dock is gone.
        */}
        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 focus:outline-none px-4 pb-[calc(var(--spacing-tap)+var(--safe-area-bottom)+1.5rem)] pt-5 sm:px-6 sm:pt-7 md:pb-8 lg:px-8"
        >
          <div className="mx-auto w-full max-w-6xl min-[1440px]:max-w-[90rem]">
            {/*
              The content column is FULL WIDTH at every viewport, and that is the fix rather than
              the default it looks like.

              Until this change the content sat in `lg:grid-cols-[minmax(0,1fr)_18rem]` beside a
              permanent 18rem More panel, with `lg:gap-8`. Add the rail (`lg:w-64`, 256px) and this
              `main`'s `lg:px-8` (64px) and the content column was `viewport - 640px` -- so crossing
              768px to 1024px it SHRANK from 640px to 384px, a 40% loss at the moment the window got
              wider. Every screen's own `lg:` rule then fired on the viewport at exactly the width
              its container collapsed: the schedule's three sending windows became 117px columns
              (~61px of content after their padding), the reports tiles 87px, the guidance prose
              176px. The inversion was the defect, not any one `grid-cols` value.

              A single column makes content width monotonic in viewport width (704px at 1024,
              1120px at 1440) and restores the shape the approved prototype shell already had --
              `mockups/caring-contact-shell-frame.tsx` renders `main > mx-auto max-w-6xl > children`
              with no second track. The two-column grid was a production-only addition.

              The More panel below is unchanged in content: Ruling 52 still renders the whole
              destination set, unbuilt entries included.
            */}
            <div className="min-w-0">
              <div className="mb-6 flex flex-col gap-4 border-b border-[color:var(--border)] pb-5 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                  <h1 className="text-balance text-hero font-semibold leading-display tracking-normal text-[color:var(--text-heading)]">
                    {title}
                  </h1>
                  {description ? (
                    <p className="mt-2 max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)] sm:text-base">
                      {description}
                    </p>
                  ) : null}
                </div>
                {/*
                    The workspace's primary control, and a real link since Phase 2B Task 7 built
                    the screen behind it.

                    Ruling 89 is why it changed in the same diff as that screen rather than before
                    it: a control lit up ahead of its destination points at a page that says
                    nothing useful whether or not there is anything to see. The inverse is just as
                    false, which is what this edit fixes -- once `/caring-contacts/plans/new`
                    exists, an "unavailable" control claims the screen is not built when it is.

                    It carries no referral. The wizard starts from an accepted referral named in
                    the URL (Ruling [111]), so this control reaches the screen's list of accepted
                    referrals that have no plan yet, each of which starts the wizard. It is hidden on
                    that screen itself, where it would only link to the page already open.
                  */}
                <div className="flex shrink-0 flex-wrap items-center gap-3">
                  {showPrimaryControl ? (
                    <Link
                      href={CARING_CONTACTS_ROUTES.newPlan}
                      data-internal-link="true"
                      className={`${primaryControl} shrink-0`}
                    >
                      <Plus aria-hidden="true" className="size-icon-md shrink-0" />
                      <span data-testid="caring-contacts-primary-control" className="truncate">
                        New plan
                      </span>
                    </Link>
                  ) : null}
                  {/* Live mode only: staff arrive through sign-in, so they need a way out. Demo and
                      development have no sign-in, so nothing is shown there. */}
                  {isCaringContactsLiveEnabled() ? (
                    <SignOutForm>
                      <button type="submit" className={`${floatingControl} shrink-0`}>
                        <LogOut aria-hidden="true" className="size-icon-md shrink-0" />
                        <span>Sign out</span>
                      </button>
                    </SignOutForm>
                  ) : null}
                </div>
              </div>
              {children}
            </div>

            <section
              id={MORE_DESTINATIONS_ID}
              aria-labelledby={`${MORE_DESTINATIONS_ID}-heading`}
              className={`${workspacePanelPadded} mt-10`}
            >
              <h2
                id={`${MORE_DESTINATIONS_ID}-heading`}
                className="text-sm font-semibold text-[color:var(--text-heading)]"
              >
                More destinations
              </h2>
              <p className="mt-1 text-xs leading-5 text-[color:var(--text-muted)]">
                <span className="md:hidden">
                  What each destination holds. The ones with a screen behind them are links; the rest state what they
                  will hold once they are built.
                </span>
                <span className="hidden md:inline">
                  Destinations not built yet, and what each will hold. The built ones are in the navigation.
                </span>
              </p>
              {/*
                  A grid, not a stack, now that this panel spans the content column instead of
                  sitting in an 18rem sidebar: eleven 48px rows in one column is a 528px tail under
                  every screen. Three-up brings it to four rows on a desktop and it stays a single
                  column on a phone, which is the width the stacked form was right for.

                  `md:hidden` stays on the overflow row rather than on the control inside it. A
                  hidden GRID item is removed from flow exactly as a hidden flex item was, so the
                  gap still closes behind it.
                */}
              <ul className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {/*
                    The primary destinations the phone bar could not carry, shown only below 768px
                    because the rail carries them at every width above it. `md:hidden` on the row
                    rather than on the control, so the list gap closes with it.
                  */}
                {PHONE_OVERFLOW_DESTINATIONS.map(({ id, label, href, reason }) => (
                  <li key={`overflow-${id}`} className="min-w-0 md:hidden">
                    <MorePanelDestination id={`more-overflow-${id}`} label={label} href={href} reason={reason} />
                  </li>
                ))}
                {/*
                    A BUILT destination is hidden from 768px up, because the rail lists every one of
                    them at those widths and a second copy of the same links under every screen was
                    a 4-row tail of duplicates. The unbuilt entries stay at every width: the rail
                    does not carry them, and this panel is the only place that states their reason.
                */}
                {MORE_DESTINATIONS.map(({ id, label, href, reason }) => (
                  <li key={id} className={href ? "min-w-0 md:hidden" : "min-w-0"}>
                    <MorePanelDestination id={`more-${id}`} label={label} href={href} reason={reason} />
                  </li>
                ))}
              </ul>
            </section>

            {/*
              Said once here rather than appended to every screen's description, where it made
              each description a line longer and pushed the screen's own purpose out of the first
              sentence a reader sees. The header's synthetic marker carries the short form.
            */}
            <p
              data-testid="caring-contacts-invented-data-note"
              className="mt-6 max-w-[var(--measure)] text-xs leading-5 text-[color:var(--text-muted)]"
            >
              Every patient, number and message in this workspace is invented; nothing here is ever sent to a real
              number.
            </p>
          </div>
        </main>
      </div>

      <nav
        aria-label="Phone workspace"
        data-testid="caring-contacts-phone-dock"
        className="fixed inset-x-0 bottom-0 z-[var(--z-chrome)] grid grid-cols-4 border-t border-[color:var(--border)] bg-[color:var(--surface-chrome)] pb-[var(--safe-area-bottom)] md:hidden"
      >
        {PHONE_DESTINATIONS.map(({ id, label, href, icon: Icon, reason }) =>
          href ? (
            <WorkspaceNavLink key={id} href={href} className={`${phoneItemClass} ${phoneItemCurrent} ${focusRing}`}>
              <Icon aria-hidden="true" className="size-icon-lg shrink-0" />
              <span className="truncate">{label}</span>
            </WorkspaceNavLink>
          ) : (
            <UnavailableDestination
              key={id}
              id={`phone-${id}`}
              label={label}
              reason={reason}
              className={phoneItemClass}
            >
              <Icon aria-hidden="true" className="size-icon-lg shrink-0" />
              <span className="truncate">{label}</span>
            </UnavailableDestination>
          ),
        )}
        {/*
          An in-page jump, not a route: the More panel is rendered in this same
          document, so this is deliberately a fragment anchor rather than a
          `<Link>`. The internal-navigation rule covers `href="/…"` targets.
        */}
        <a href={`#${MORE_DESTINATIONS_ID}`} className={`${phoneItemClass} ${focusRing}`}>
          <MoreHorizontal aria-hidden="true" className="size-icon-lg shrink-0" />
          <span className="truncate">More</span>
        </a>
      </nav>

      {/*
        The one renderer for all twenty-four overlays (Task 18), mounted once for
        the whole workspace rather than per screen — the interaction matrix is a
        workspace-wide contract, and a screen that forgot to mount it would lose
        the session gate and the offline notice with it.

        It takes no props: `WorkspaceOverlays` is the client boundary, and giving
        it none is what keeps `serviceState` on the server. It renders nothing at
        all until the URL carries `?overlay=<id>`.
      */}
      <WorkspaceOverlays />
    </div>
  );
}
