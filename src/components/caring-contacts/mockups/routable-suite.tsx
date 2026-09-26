"use client";

import { ArrowLeft, Plus, RotateCcw, WifiOff } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { announce } from "@/components/ui/live-announcer";
import { cn, controlBase } from "@/components/ui-primitives";

import { ActivationWorkflow } from "./activation-workflow";
import { CaringContactShellFrame } from "./caring-contact-shell-frame";
import { ComponentStateSpecimens } from "./component-state-specimens";
import { FoundationBoard } from "./foundation-board";
import { ContextualOverlay, OverlaySpecimens, type OverlayDefinition } from "./overlay-specimens";
import {
  createInitialPrototypeState,
  getPrototypeMutationBlockReason,
  prototypeReducer,
  type CaringContactPrototypeAction,
  type CaringContactPrototypeState,
  type CaringContactScenario,
} from "./prototype-state";
import { CARING_CONTACT_MOCKUP_ROUTES, caringContactMockupRoute, type ActivationStage } from "./routes";
import {
  DeliveryExceptionDrawer,
  GuidanceProductPage,
  PatientOverviewProductPage,
  PatientsDirectoryPage,
  PlanDetailProductPage,
  ReportsProductPage,
  ScheduleProductPage,
  TeamProductPage,
  TemplatesProductPage,
  TodayProductPage,
} from "./product-pages";
import type { WorkspaceDestination } from "./types";

type PrototypeContextValue = {
  state: CaringContactPrototypeState;
  dispatch: (action: CaringContactPrototypeAction) => void;
};

const PrototypeContext = createContext<PrototypeContextValue | null>(null);

export function CaringContactPrototypeProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(prototypeReducer, undefined, () => createInitialPrototypeState());
  useEffect(() => {
    const handleOnline = () => dispatch({ type: "set-connectivity", online: true });
    const handleOffline = () => dispatch({ type: "set-connectivity", online: false });
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);
  return <PrototypeContext.Provider value={{ state, dispatch }}>{children}</PrototypeContext.Provider>;
}

export function useCaringContactPrototype() {
  const value = useContext(PrototypeContext);
  if (!value) throw new Error("Caring Contact prototype surfaces must be rendered inside the prototype provider.");
  return value;
}

const workflowTitles: Record<ActivationStage, string> = {
  agreement: "Patient and agreement",
  pathway: "Pathway selection",
  personalisation: "Personalisation",
  review: "Review and activation",
};

const workflowStepLabels: Record<ActivationStage, string> = {
  agreement: "Step 1 of 4",
  pathway: "Step 2 of 4",
  personalisation: "Step 3 of 4",
  review: "Step 4 of 4",
};

const scenarioValues: readonly CaringContactScenario[] = [
  "normal",
  "loading",
  "empty",
  "offline",
  "expired-session",
  "permission-unavailable",
  "recoverable-error",
  "version-conflict",
];
const scenarios = new Set<CaringContactScenario>(scenarioValues);

function scenarioFromQuery(query: URLSearchParams): CaringContactScenario {
  const candidate = query.get("scenario") as CaringContactScenario | null;
  return candidate && scenarios.has(candidate) ? candidate : "normal";
}

function stageFromQuery(query: URLSearchParams): ActivationStage {
  const candidate = query.get("stage");
  return candidate === "pathway" || candidate === "personalisation" || candidate === "review" ? candidate : "agreement";
}

function hasValidStage(query: URLSearchParams) {
  const candidate = query.get("stage");
  return (
    candidate === "agreement" || candidate === "pathway" || candidate === "personalisation" || candidate === "review"
  );
}

function destinationFromPath(pathname: string): WorkspaceDestination {
  if (pathname.includes("/schedule")) return "Schedule";
  if (pathname.includes("/templates")) return "Templates";
  if (pathname.includes("/team")) return "Team";
  if (pathname.includes("/guidance")) return "Guidance";
  if (pathname.includes("/reports")) return "Reports";
  if (pathname.includes("/patients") || pathname.includes("/plans") || pathname.includes("/contacts"))
    return "Patients";
  return "Today";
}

function RouteActionLink({ href, children, icon: Icon }: { href: string; children: ReactNode; icon?: typeof Plus }) {
  return (
    <Link
      href={href}
      className={cn(
        controlBase,
        "border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] px-4 text-sm text-[color:var(--text)] shadow-[var(--shadow-inset)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-subtle)]",
      )}
    >
      {Icon ? <Icon aria-hidden="true" className="size-icon-md" /> : null}
      <span>{children}</span>
    </Link>
  );
}

function ScenarioNotice({ scenario }: { scenario: CaringContactScenario }) {
  if (scenario === "normal") return null;
  if (scenario === "offline") {
    return (
      <div
        role="status"
        aria-label="Offline status"
        className="mb-5 flex items-start gap-3 rounded-[var(--radius-lg)] border border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] p-4 text-[color:var(--warning-text)]"
      >
        <WifiOff aria-hidden="true" className="mt-0.5 size-icon-md shrink-0" />
        <div>
          <p className="font-semibold">Offline—read-only prototype</p>
          <p className="mt-1 text-sm">
            No patient information is stored on this device. Reconnect before changing a plan.
          </p>
        </div>
      </div>
    );
  }

  const copy: Record<Exclude<CaringContactScenario, "normal" | "offline">, [string, string]> = {
    loading: ["Loading synthetic workspace", "The shell remains available while this deterministic specimen resolves."],
    empty: ["No records in this scenario", "Change the scenario or return to Today to continue the prototype."],
    "expired-session": ["Session expired", "Re-authentication is required before any synthetic plan change."],
    "permission-unavailable": [
      "Permission unavailable",
      "You can inspect the record, but plan changes are unavailable.",
    ],
    "recoverable-error": [
      "This surface could not be completed",
      "Retry the deterministic scenario or return to Today.",
    ],
    "version-conflict": ["Newer draft available", "Review the newer synthetic draft before making another change."],
  };
  const [title, description] = copy[scenario];
  return (
    <div
      role="status"
      className="mb-5 rounded-[var(--radius-lg)] border border-[color:var(--border-strong)] bg-[color:var(--surface-inset)] p-4"
    >
      <p className="font-semibold text-[color:var(--text)]">{title}</p>
      <p className="mt-1 text-sm text-[color:var(--text-muted)]">{description}</p>
    </div>
  );
}

function SystemStatesPage({
  scenario,
  onOpenOverlay,
  onOpenScenario,
}: {
  scenario: CaringContactScenario;
  onOpenOverlay: (overlayId: string) => void;
  onOpenScenario: (scenario: CaringContactScenario) => void;
}) {
  const { dispatch } = useCaringContactPrototype();
  return (
    <div className="space-y-8" data-testid="caring-contact-system-states">
      <ScenarioNotice scenario={scenario} />
      <section
        aria-labelledby="scenario-switcher-heading"
        className="rounded-[var(--radius-xl)] border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-[var(--pad-panel)]"
      >
        <h2 id="scenario-switcher-heading" className="text-lg font-semibold text-[color:var(--text-heading)]">
          Demonstration scenarios
        </h2>
        <p className="mt-1 text-sm text-[color:var(--text-muted)]">
          Each URL contains only a named synthetic state—never patient, phone or clinical information.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {scenarioValues.map((value) => (
            <Button
              key={value}
              variant={scenario === value ? "primary" : "secondary"}
              size="sm"
              aria-pressed={scenario === value}
              onClick={() => onOpenScenario(value)}
            >
              Open {value.replaceAll("-", " ")} scenario
            </Button>
          ))}
        </div>
      </section>
      <section aria-labelledby="foundation-heading">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--clinical-accent)]">
              Repository design language
            </p>
            <h2 id="foundation-heading" className="mt-1 text-xl font-semibold text-[color:var(--text-heading)]">
              Foundation board
            </h2>
          </div>
          <Button variant="secondary" icon={RotateCcw} onClick={() => dispatch({ type: "reset" })}>
            Reset prototype
          </Button>
        </div>
        <FoundationBoard />
      </section>
      <section aria-labelledby="component-states-heading">
        <h2 id="component-states-heading" className="text-xl font-semibold text-[color:var(--text-heading)]">
          Component and recovery states
        </h2>
        <div className="mt-4">
          <ComponentStateSpecimens />
        </div>
      </section>
      <OverlaySpecimens
        offline={scenario === "offline"}
        onOfflineChange={(offline) => dispatch({ type: "set-connectivity", online: !offline })}
        onOpenOverlay={onOpenOverlay}
        renderInlineStatus={false}
      />
    </div>
  );
}

export function CaringContactRouteSurface({
  pathname,
  query = "",
  navigate,
}: {
  pathname: string;
  query?: string;
  navigate: (href: string) => void;
}) {
  const { state, dispatch } = useCaringContactPrototype();
  const queryParams = useMemo(() => new URLSearchParams(query), [query]);
  const stage = stageFromQuery(queryParams);
  const scenario = scenarioFromQuery(queryParams);
  const overlayId = queryParams.get("overlay");
  const overlayReturnFocusRef = useRef<HTMLElement | null>(null);
  const previousOverlayIdRef = useRef<string | null>(overlayId);
  const activeDestination = destinationFromPath(pathname);
  const isNewPlan = pathname === CARING_CONTACT_MOCKUP_ROUTES.newPlan;
  const pageFocusKey = `${pathname}:${isNewPlan ? stage : ""}:${
    pathname === CARING_CONTACT_MOCKUP_ROUTES.schedule ? (queryParams.get("date") ?? "2026-08-15") : ""
  }`;

  function closeOverlay() {
    const nextQuery = new URLSearchParams(queryParams);
    nextQuery.delete("overlay");
    const next = nextQuery.toString();
    navigate(`${pathname}${next ? `?${next}` : ""}`);
  }

  function closeOverlayAndScenario() {
    const nextQuery = new URLSearchParams(queryParams);
    nextQuery.delete("overlay");
    nextQuery.delete("scenario");
    const next = nextQuery.toString();
    navigate(`${pathname}${next ? `?${next}` : ""}`);
  }

  function openOverlay(overlay: string) {
    overlayReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const nextQuery = new URLSearchParams(queryParams);
    nextQuery.set("overlay", overlay);
    navigate(`${pathname}?${nextQuery.toString()}`);
  }

  function openScenario(nextScenario: CaringContactScenario) {
    dispatch({ type: "apply-scenario", scenario: nextScenario });
    const nextQuery = new URLSearchParams(queryParams);
    nextQuery.delete("overlay");
    if (nextScenario === "normal") nextQuery.delete("scenario");
    else nextQuery.set("scenario", nextScenario);
    const next = nextQuery.toString();
    navigate(`${pathname}${next ? `?${next}` : ""}`);
  }

  function commitOverlayDecision(definition: OverlayDefinition) {
    const blocked = definition.mutatesState ? getPrototypeMutationBlockReason(state) : null;
    if (blocked) {
      dispatch({ type: "set-outcome", outcome: { kind: "blocked", message: blocked } });
      announce(blocked, { eventId: `caring-contact:blocked:${definition.id}` });
      return;
    }
    if (definition.id === "final-activation") {
      dispatch({ type: "activate-plan" });
      navigate(caringContactMockupRoute.overlay("activation-success", CARING_CONTACT_MOCKUP_ROUTES.patient));
      return;
    }
    if (definition.id === "pause") dispatch({ type: state.plan.status === "Paused" ? "resume-plan" : "pause-plan" });
    else if (definition.id === "withdrawal") dispatch({ type: "withdraw-plan" });
    else if (definition.id === "reassignment") dispatch({ type: "reassign-plan", coordinatorId: "SYN-TEAM-002" });
    else if (definition.id === "team-switcher") dispatch({ type: "set-team", teamId: "SYN-TEAM-CENTRAL" });
    else if (definition.id === "session-expiry") {
      dispatch({ type: "set-authentication", authenticated: true });
      closeOverlayAndScenario();
      return;
    } else if (definition.id === "offline-banner") {
      dispatch({ type: "set-connectivity", online: true });
      closeOverlayAndScenario();
      return;
    } else {
      dispatch({
        type: "set-outcome",
        outcome: {
          kind: definition.mutatesState ? "success" : "info",
          message: `${definition.label} reviewed in the in-memory synthetic prototype. No external action occurred.`,
        },
      });
    }
    closeOverlay();
  }

  // Track whether the current scenario came from the URL. Without this the lens
  // was one-way: `?scenario=offline` engaged the mutation guard, and following an
  // ordinary link to a URL with no `scenario` left the guard engaged while the
  // visible scenario notice disappeared. Only a query-derived scenario is reset,
  // so a scenario toggled by hand on the system-states screen is left alone.
  const queryScenarioRef = useRef<CaringContactScenario | null>(null);
  useEffect(() => {
    if (queryParams.has("scenario")) {
      queryScenarioRef.current = scenario;
      if (state.scenario !== scenario) dispatch({ type: "apply-scenario", scenario });
      return;
    }
    if (queryScenarioRef.current === null) return;
    const wasQueryDerived = state.scenario === queryScenarioRef.current;
    queryScenarioRef.current = null;
    if (wasQueryDerived && state.scenario !== "normal") {
      dispatch({ type: "apply-scenario", scenario: "normal" });
    }
  }, [dispatch, queryParams, scenario, state.scenario]);

  useEffect(() => {
    if (!isNewPlan || hasValidStage(queryParams)) return;
    const nextQuery = new URLSearchParams(queryParams);
    nextQuery.set("stage", "agreement");
    announce("The requested workflow stage was unavailable. Returned to patient and agreement.", {
      eventId: "caring-contact:invalid-stage",
    });
    navigate(`${pathname}?${nextQuery.toString()}`);
  }, [isNewPlan, navigate, pathname, queryParams]);

  useEffect(() => {
    const previousOverlayId = previousOverlayIdRef.current;
    previousOverlayIdRef.current = overlayId;
    if (!previousOverlayId || overlayId) return;

    let timeout: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      timeout = window.setTimeout(() => {
        const preferred = overlayReturnFocusRef.current;
        const fallback = document.querySelector<HTMLElement>("[data-caring-contact-page-title]");
        const target = preferred?.isConnected ? preferred : fallback;
        target?.focus({ preventScroll: true });
      }, 50);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [overlayId]);

  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    const heading = document.querySelector<HTMLElement>("[data-caring-contact-page-title]");
    overlayReturnFocusRef.current = heading;
    heading?.focus({ preventScroll: true });
    announce(`${heading?.textContent?.trim() ?? activeDestination} page`, {
      eventId: `caring-contact:route:${pageFocusKey}`,
    });
  }, [activeDestination, pageFocusKey]);

  let title = "Today";
  let eyebrow: string | undefined = "Saturday, 15 August 2026";
  let description = "Prioritised referrals, operational work and today’s scheduled contacts.";
  let headerAction: ReactNode;
  let content: ReactNode;

  if (pathname === CARING_CONTACT_MOCKUP_ROUTES.today) {
    headerAction = (
      <RouteActionLink href={caringContactMockupRoute.newPlan("agreement")} icon={Plus}>
        New referral
      </RouteActionLink>
    );
    content = (
      <TodayProductPage
        onReviewReferral={() => navigate(caringContactMockupRoute.newPlan("agreement"))}
        onOpenPatients={() => navigate(CARING_CONTACT_MOCKUP_ROUTES.patients)}
        onOpenSchedule={() => navigate(caringContactMockupRoute.schedule("2026-08-15"))}
      />
    );
  } else if (isNewPlan) {
    title = workflowTitles[stage];
    eyebrow = workflowStepLabels[stage];
    description = "Create a governed 10-contact plan for the selected fictional patient.";
    headerAction = (
      <RouteActionLink href={CARING_CONTACT_MOCKUP_ROUTES.patients} icon={ArrowLeft}>
        Patients
      </RouteActionLink>
    );
    content = (
      <ActivationWorkflow
        stage={stage}
        onStageChange={(nextStage) => navigate(caringContactMockupRoute.newPlan(nextStage))}
        onActivated={() => {
          dispatch({ type: "activate-plan" });
          navigate(CARING_CONTACT_MOCKUP_ROUTES.patient);
        }}
        onOpenOverlay={openOverlay}
      />
    );
  } else if (pathname === CARING_CONTACT_MOCKUP_ROUTES.patients) {
    title = "Patients";
    eyebrow = "Example Aftercare Team";
    description = "Team-scoped referrals and caring-contact episodes. No global patient search.";
    headerAction = (
      <RouteActionLink href={caringContactMockupRoute.newPlan("agreement")} icon={Plus}>
        New plan
      </RouteActionLink>
    );
    content = (
      <PatientsDirectoryPage
        onOpenRowan={() => navigate(CARING_CONTACT_MOCKUP_ROUTES.patient)}
        onContinueMira={() => navigate(caringContactMockupRoute.newPlan("agreement"))}
      />
    );
  } else if (pathname === CARING_CONTACT_MOCKUP_ROUTES.patient) {
    title = "Patient overview";
    eyebrow = "Rowan Sample · synthetic patient";
    description = "Identity, ownership, continuity and the complete operational history in one place.";
    headerAction = <RouteActionLink href={CARING_CONTACT_MOCKUP_ROUTES.plan}>View active plan</RouteActionLink>;
    content = <PatientOverviewProductPage onViewPlan={() => navigate(CARING_CONTACT_MOCKUP_ROUTES.plan)} />;
  } else if (pathname === CARING_CONTACT_MOCKUP_ROUTES.plan) {
    title = "Plan and contact detail";
    eyebrow = "Rowan Sample · synthetic plan";
    description = "The plan, frozen versions, future schedule, audit trail and governed actions.";
    headerAction = (
      <RouteActionLink href={CARING_CONTACT_MOCKUP_ROUTES.patient} icon={ArrowLeft}>
        View patient
      </RouteActionLink>
    );
    content = (
      <PlanDetailProductPage
        onOpenException={() => navigate(CARING_CONTACT_MOCKUP_ROUTES.contact)}
        onOpenOverlay={openOverlay}
        status={state.plan.status}
        coordinator={state.plan.coordinatorId === "SYN-TEAM-002" ? "Sam Sample" : "Alex Example"}
      />
    );
  } else if (pathname === CARING_CONTACT_MOCKUP_ROUTES.contact) {
    title = "Contact and delivery exception";
    eyebrow = "Rowan Sample · contact 4 of 10";
    description = "Transport attempts and same-day operational review without clinical inference.";
    content = (
      <>
        <PlanDetailProductPage
          onOpenException={() => undefined}
          onOpenOverlay={openOverlay}
          status={state.plan.status}
          coordinator={state.plan.coordinatorId === "SYN-TEAM-002" ? "Sam Sample" : "Alex Example"}
        />
        <DeliveryExceptionDrawer open onClose={() => navigate(CARING_CONTACT_MOCKUP_ROUTES.plan)} />
      </>
    );
  } else if (pathname === CARING_CONTACT_MOCKUP_ROUTES.schedule) {
    title = "Schedule";
    eyebrow = "Australia/Perth";
    description = "One-day operational view with routine windows separated from named exceptions.";
    content = (
      <ScheduleProductPage
        onOpenException={() => navigate(CARING_CONTACT_MOCKUP_ROUTES.contact)}
        selectedDate={queryParams.get("date") ?? "2026-08-15"}
        onSelectedDateChange={(date) => {
          const nextQuery = new URLSearchParams(queryParams);
          nextQuery.set("date", date);
          navigate(`${pathname}?${nextQuery.toString()}`);
        }}
      />
    );
  } else if (
    pathname === CARING_CONTACT_MOCKUP_ROUTES.templates ||
    pathname === CARING_CONTACT_MOCKUP_ROUTES.template
  ) {
    title = "Governed templates";
    eyebrow = "Programme administration";
    description = "Approved pathway and message versions with explicit ownership and lifecycle.";
    content = <TemplatesProductPage onOpenOverlay={openOverlay} />;
  } else if (pathname === CARING_CONTACT_MOCKUP_ROUTES.team) {
    title = "Team";
    eyebrow = "Ownership and capacity";
    description = "Explicit coordination, unclaimed work and escalation for the active team.";
    content = <TeamProductPage onOpenOverlay={openOverlay} />;
  } else if (pathname === CARING_CONTACT_MOCKUP_ROUTES.guidance) {
    title = "Guidance";
    eyebrow = "Programme boundaries";
    description = "Clear operational guidance for one-way caring-contact coordination.";
    content = <GuidanceProductPage />;
  } else if (pathname === CARING_CONTACT_MOCKUP_ROUTES.reports) {
    title = "Reports";
    eyebrow = "Aggregate operations";
    description = "Quiet service measures without patient-state, engagement or clinical inference.";
    content = <ReportsProductPage />;
  } else {
    title = "Component and system states";
    eyebrow = "Prototype quality lab";
    description = "Repository primitives, all governed decisions and deterministic recovery states.";
    content = <SystemStatesPage scenario={scenario} onOpenOverlay={openOverlay} onOpenScenario={openScenario} />;
  }

  return (
    <CaringContactShellFrame
      routable
      activeDestination={activeDestination}
      systemStatesActive={pathname === CARING_CONTACT_MOCKUP_ROUTES.systemStates}
      onOpenTeamSwitcher={() => openOverlay("team-switcher")}
      title={title}
      eyebrow={eyebrow}
      description={description}
      headerAction={headerAction}
    >
      {pathname === CARING_CONTACT_MOCKUP_ROUTES.systemStates ? null : <ScenarioNotice scenario={scenario} />}
      {state.lastOutcome ? (
        <p
          role="status"
          className="mb-5 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-inset)] p-3 text-sm font-medium"
        >
          {state.lastOutcome.message}
        </p>
      ) : null}
      {content}
      <ContextualOverlay
        key={overlayId ?? "closed"}
        overlayId={overlayId}
        mutationUnavailableReason={getPrototypeMutationBlockReason(state)}
        onClose={closeOverlay}
        onDecision={commitOverlayDecision}
        resumeMode={state.plan.status === "Paused"}
        externalReturnFocusRef={overlayReturnFocusRef}
      />
    </CaringContactShellFrame>
  );
}

export function CaringContactRoutableSuite() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  return (
    <CaringContactRouteSurface
      pathname={pathname}
      query={searchParams.toString()}
      navigate={(href) => router.push(href)}
    />
  );
}
