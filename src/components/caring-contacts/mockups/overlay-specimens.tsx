"use client";

import { AlertTriangle, CheckCircle2, Layers3, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { announce } from "@/components/ui/live-announcer";
import { Sheet } from "@/components/ui/sheet";

import { ROWAN_SELECTED_SENDING_PREFERENCE } from "./fixtures";
import { EXACT_MESSAGE_GSM7, PATIENT_VISIBLE_NO_REPLY_NOTICE } from "./personalisation-screen";

export type OverlayPhoneModality = "bottom-sheet" | "full-screen-stage" | "session-gate" | "status-banner";
export type OverlayDesktopModality = "dialog" | "inspection-drawer" | "session-gate" | "status-banner";
export type OverlayDismissal = "escape-backdrop-close" | "action-only" | "recovery-only";

const subscribeToHydration = () => () => {};
const getClientHydrationSnapshot = () => true;
const getServerHydrationSnapshot = () => false;

export type OverlayDefinition = {
  id: string;
  label: string;
  title: string;
  summary: string;
  content: string;
  decision: string;
  availability: "Available" | "Read only" | "Unavailable until resolved";
  mutatesState: boolean;
  phoneModality: OverlayPhoneModality;
  desktopModality: OverlayDesktopModality;
  dismissal: OverlayDismissal;
  tone?: "primary" | "danger";
};

export const completionOverlayDefinitions = [
  {
    id: "verify-identity",
    label: "Verify identity",
    title: "Verify identity before changing patient",
    summary: "Compare the selected identity with the fictional source record before continuing.",
    content:
      "Rowan Sample · SYN-PATIENT-001 · born 3 November 1987. The selected patient remains visible until confirmed.",
    decision: "Confirm fictional identity",
    availability: "Available",
    mutatesState: true,
    phoneModality: "full-screen-stage",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
    tone: "primary",
  },
  {
    id: "change-patient",
    label: "Change patient",
    title: "Change selected patient",
    summary: "Changing patient clears the current activation draft and all object-specific selections.",
    content: "Current fictional selection: Rowan Sample. No patient context carries into the replacement search.",
    decision: "Change patient",
    availability: "Available",
    mutatesState: true,
    phoneModality: "full-screen-stage",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
    tone: "danger",
  },
  {
    id: "pathway-preview",
    label: "Pathway preview",
    title: "Preview governed pathway",
    summary: "Inspect the current locally approved pathway without ranking it as best or recommended.",
    content: "Example twelve-month pathway · SYN-v0.3 · 10 contacts · one-way sender · two-person approval complete.",
    decision: "Use this pathway",
    availability: "Available",
    mutatesState: true,
    phoneModality: "full-screen-stage",
    desktopModality: "inspection-drawer",
    dismissal: "escape-backdrop-close",
  },
  {
    id: "message-preview",
    label: "Message preview",
    title: "Preview exact patient-visible message",
    summary: "The fully substituted message is visible exactly as the patient would receive it.",
    content: `GSM-7 · ${EXACT_MESSAGE_GSM7.septets} septets · ${EXACT_MESSAGE_GSM7.segments} of 2 SMS segments · ${PATIENT_VISIBLE_NO_REPLY_NOTICE}.`,
    decision: "Return to personalisation",
    availability: "Read only",
    mutatesState: false,
    phoneModality: "full-screen-stage",
    desktopModality: "inspection-drawer",
    dismissal: "escape-backdrop-close",
  },
  {
    id: "communication-preference",
    label: "Communication preference",
    title: "Communication preference",
    summary: "Record only a governed preference received through the staffed programme phone.",
    content: `Current plan preference: ${ROWAN_SELECTED_SENDING_PREFERENCE.windowLabel}. Proposed change: Early evening 5:00 pm AWST. The proposal does not change the original cadence and is not recorded by this specimen.`,
    decision: "Record preference",
    availability: "Available",
    mutatesState: true,
    phoneModality: "bottom-sheet",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
  },
  {
    id: "adjust-date-time",
    label: "Adjust date/time",
    title: "Adjust contact time",
    summary: "A coordinator may move a contact only within its already scheduled day.",
    content:
      "Proposed one-contact exception: move contact 2 from 10:00 am to 2:00 pm AWST on Saturday 22 August 2026. The plan preference remains Morning; a date change needs a reason and team-lead approval.",
    decision: "Save time within scheduled day",
    availability: "Available",
    mutatesState: true,
    phoneModality: "bottom-sheet",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
    tone: "primary",
  },
  {
    id: "outside-window-warning",
    label: "Outside-window warning",
    title: "Outside approved sending window",
    summary: "The requested time is outside 9:00 am–6:00 pm AWST and cannot be scheduled.",
    content: "7:30 pm AWST is unavailable. Keep one of the governed Morning, Afternoon or Early evening times.",
    decision: "Keep approved time",
    availability: "Unavailable until resolved",
    mutatesState: true,
    phoneModality: "bottom-sheet",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
    tone: "primary",
  },
  {
    id: "save-draft",
    label: "Save draft",
    title: "Save activation draft",
    summary: "Save the incomplete fictional activation without sending or activating anything.",
    content:
      "The draft retains the selected patient and governed versions. It remains unavailable for sending until every assurance passes.",
    decision: "Save draft",
    availability: "Available",
    mutatesState: true,
    phoneModality: "bottom-sheet",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
    tone: "primary",
  },
  {
    id: "discard-changes",
    label: "Discard changes",
    title: "Discard unsaved changes",
    summary: "Discard only changes made in this session; the frozen approved versions remain unchanged.",
    content: "Preferred-name and timing edits will be removed. Existing plan and audit history are not changed.",
    decision: "Discard changes",
    availability: "Available",
    mutatesState: true,
    phoneModality: "bottom-sheet",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
    tone: "danger",
  },
  {
    id: "final-activation",
    label: "Final activation",
    title: "Final activation assurance",
    summary: "Recheck identity, agreement, ownership, governed versions, exact text and every AWST send time.",
    content:
      "Fresh authentication and atomic activation are future production contracts; this synthetic action records review only.",
    decision: "Confirm activation review",
    availability: "Available",
    mutatesState: true,
    phoneModality: "full-screen-stage",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
    tone: "primary",
  },
  {
    id: "activation-success",
    label: "Activation success",
    title: "Plan activation recorded",
    summary: "A privacy-safe outcome confirms the operational event without patient information.",
    content:
      "Outcome: “Plan activation recorded. View the plan for schedule and audit detail.” No message has been sent by this prototype.",
    decision: "View activated plan",
    availability: "Read only",
    mutatesState: false,
    phoneModality: "bottom-sheet",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
  },
  {
    id: "pause",
    label: "Pause",
    title: "Pause caring-contact plan",
    summary: "Pause is reversible but never rebases the original calendar.",
    content:
      "Contacts inside the pause are permanently skipped. Resumption begins with the next future scheduled contact.",
    decision: "Pause future contacts",
    availability: "Available",
    mutatesState: true,
    phoneModality: "bottom-sheet",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
    tone: "danger",
  },
  {
    id: "withdrawal",
    label: "Withdrawal",
    title: "Record patient-requested withdrawal",
    summary: "Withdrawal immediately cancels every unsent contact and needs no approval.",
    content:
      "The terminal withdrawal record and immutable history remain visible. Fresh authentication is required before mutation; there is no undo action.",
    decision: "Continue to fresh authentication",
    availability: "Available",
    mutatesState: true,
    phoneModality: "full-screen-stage",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
    tone: "danger",
  },
  {
    id: "reassignment",
    label: "Reassignment",
    title: "Reassign plan coordinator",
    summary: "Reassignment changes coordination ownership and retains the complete handover history.",
    content:
      "Current coordinator: Alex Example. Proposed coordinator: Sam Sample. Fresh authentication is required before mutation; duty-of-care claims are not inferred from assignment.",
    decision: "Continue to fresh authentication",
    availability: "Available",
    mutatesState: true,
    phoneModality: "bottom-sheet",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
    tone: "primary",
  },
  {
    id: "delivery-detail",
    label: "Delivery detail",
    title: "Delivery transport detail",
    summary: "Inspect provider-neutral transport evidence without a clinical or patient-state inference.",
    content:
      "Delivered at 10:00:14 am AWST means transport receipt only. It does not show that the message was read or helped.",
    decision: "Close transport detail",
    availability: "Read only",
    mutatesState: false,
    phoneModality: "full-screen-stage",
    desktopModality: "inspection-drawer",
    dismissal: "escape-backdrop-close",
  },
  {
    id: "resolve-failed-delivery",
    label: "Resolve failed delivery",
    title: "Resolve permanent delivery failure",
    summary: "Three attempts in the original window are complete; no additional or late retry is allowed.",
    content:
      "Future contacts remain paused. Record a same-day operational resolution; do not create automatic clinical follow-up.",
    decision: "Record operational resolution",
    availability: "Available",
    mutatesState: true,
    phoneModality: "bottom-sheet",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
    tone: "primary",
  },
  {
    id: "contact-changed-block",
    label: "Contact-changed block",
    title: "Contact destination changed",
    summary: "A source mobile change pauses future contacts for coordinator review.",
    content:
      "The destination must never switch silently. Review source provenance and keep the plan paused until resolved.",
    decision: "Keep plan paused",
    availability: "Unavailable until resolved",
    mutatesState: true,
    phoneModality: "bottom-sheet",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
    tone: "danger",
  },
  {
    id: "template-changed-retired",
    label: "Template changed/retired",
    title: "Governed template is no longer current",
    summary: "The selected template was retired after this draft opened.",
    content:
      "The frozen retired version remains readable in history. New activation requires a current, locally approved version.",
    decision: "Choose current version",
    availability: "Unavailable until resolved",
    mutatesState: true,
    phoneModality: "full-screen-stage",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
    tone: "primary",
  },
  {
    id: "session-expiry",
    label: "Session expiry",
    title: "Session expired",
    summary: "The managed session ended before a protected decision could complete.",
    content:
      "No mutation was recorded. Sign in through WA Health SSO/MFA before continuing; local credentials are absent.",
    decision: "Sign in again",
    availability: "Unavailable until resolved",
    mutatesState: false,
    phoneModality: "session-gate",
    desktopModality: "session-gate",
    dismissal: "action-only",
  },
  {
    id: "offline-banner",
    label: "Offline banner",
    title: "Offline operation unavailable",
    summary: "Downtime fails closed and patient data is not cached for offline use.",
    content:
      "Activation, mutation and uncertain resend are unavailable. Existing synthetic read-only context may remain visible.",
    decision: "Try reconnecting",
    availability: "Unavailable until resolved",
    mutatesState: false,
    phoneModality: "status-banner",
    desktopModality: "status-banner",
    dismissal: "recovery-only",
  },
  {
    id: "recoverable-error",
    label: "Recoverable error",
    title: "Operational records could not be loaded",
    summary: "The error is recoverable and does not change plan or delivery state.",
    content:
      "Retry the same read. If the error persists, return to Today; never guess or display stale state as current.",
    decision: "Retry loading records",
    availability: "Available",
    mutatesState: false,
    phoneModality: "bottom-sheet",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
  },
  {
    id: "permission-unavailable",
    label: "Permission unavailable",
    title: "Permission unavailable",
    summary: "The current synthetic role cannot perform this protected action.",
    content:
      "Return to the plan and contact the team lead. Access remains deny-by-default and the attempted access is audited.",
    decision: "Return to plan",
    availability: "Unavailable until resolved",
    mutatesState: false,
    phoneModality: "bottom-sheet",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
  },
  {
    id: "team-switcher",
    label: "Team switcher",
    title: "Switch active team",
    summary: "Switching team clears the selected patient and every patient-specific draft before new context renders.",
    content:
      "Current team: Example Aftercare Team. Destination: Fictional Coverage Team. No patient context crosses teams.",
    decision: "Clear context and switch team",
    availability: "Available",
    mutatesState: true,
    phoneModality: "bottom-sheet",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
    tone: "danger",
  },
  {
    id: "draft-version-conflict",
    label: "Draft/version conflict",
    title: "Resolve draft version conflict",
    summary: "A governed template changed after this draft opened.",
    content: "Compare the frozen draft with the current approved version. Do not silently overwrite either record.",
    decision: "Review current version",
    availability: "Unavailable until resolved",
    mutatesState: false,
    phoneModality: "full-screen-stage",
    desktopModality: "dialog",
    dismissal: "escape-backdrop-close",
    tone: "primary",
  },
] satisfies readonly OverlayDefinition[];

export const completionMutationOverlayLabels = completionOverlayDefinitions
  .filter(({ mutatesState }) => mutatesState)
  .map(({ label }) => label);

function SpecificOverlayContent({
  definition,
  modality,
}: {
  definition: OverlayDefinition;
  modality: OverlayPhoneModality | OverlayDesktopModality;
}) {
  return (
    <div
      data-testid="overlay-specific-content"
      data-overlay-id={definition.id}
      data-overlay-modality={modality}
      data-overlay-dismissal={definition.dismissal}
      className="space-y-3 text-sm"
    >
      <p className="flex items-start gap-2 font-semibold">
        {definition.availability === "Available" ? (
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-icon-md shrink-0 text-[color:var(--success)]" />
        ) : (
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-icon-md shrink-0 text-[color:var(--warning)]" />
        )}
        Availability: {definition.availability}
      </p>
      <p className="text-[color:var(--text-muted)]">{definition.content}</p>
      <p className="rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-inset)] p-[var(--pad-card)] text-[color:var(--text-muted)]">
        Privacy-safe outcome only: no patient name, identifier, phone number or message text enters a toast, page title
        or external alert.
      </p>
    </div>
  );
}

function SessionExpiryGate({
  open,
  definition,
  onReauthenticate,
  returnFocusRef,
  compact,
}: {
  open: boolean;
  definition: OverlayDefinition;
  onReauthenticate: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
  compact: boolean;
}) {
  const actionRef = useRef<HTMLButtonElement>(null);

  return (
    <Sheet
      open={open}
      onClose={() => undefined}
      title={definition.title}
      description={definition.summary}
      closeLabel="Session expired — sign in required"
      closeButtonClassName="hidden"
      initialFocusRef={actionRef}
      returnFocusRef={returnFocusRef}
      mobilePlacement="fullscreen"
      contentStyle={
        !compact ? { width: "100%", height: "auto", maxHeight: "calc(100dvh - 3rem)", maxWidth: "32rem" } : undefined
      }
      contentClassName="lg:h-auto lg:max-h-[calc(100dvh-3rem)] lg:max-w-lg lg:rounded-2xl lg:border"
      testId="caring-contact-session-expiry-gate"
      footer={
        <div className="flex justify-end">
          <Button ref={actionRef} variant="primary" onClick={onReauthenticate}>
            {definition.decision}
          </Button>
        </div>
      }
    >
      <SpecificOverlayContent
        definition={definition}
        modality={compact ? definition.phoneModality : definition.desktopModality}
      />
    </Sheet>
  );
}

export function ContextualOverlay({
  overlayId,
  mutationUnavailableReason,
  onClose,
  onDecision,
  resumeMode = false,
  externalReturnFocusRef,
}: {
  overlayId: string | null;
  mutationUnavailableReason?: string | null;
  onClose: () => void;
  onDecision: (definition: OverlayDefinition) => void;
  resumeMode?: boolean;
  externalReturnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const [compact, setCompact] = useState(true);
  const [protectedStep, setProtectedStep] = useState(false);
  const portalReady = useSyncExternalStore(
    subscribeToHydration,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot,
  );
  const fallbackReturnFocusRef = useRef<HTMLElement>(null);
  const returnFocusRef = externalReturnFocusRef ?? fallbackReturnFocusRef;
  const baseDefinition = completionOverlayDefinitions.find(({ id }) => id === overlayId) ?? null;
  const active =
    baseDefinition?.id === "pause" && resumeMode
      ? {
          ...baseDefinition,
          label: "Resume",
          title: "Resume caring-contact plan",
          summary: "Resume with the next future contact while preserving the original calendar.",
          content:
            "Contacts skipped during the pause remain skipped. No catch-up or cadence rebase occurs; the next future contact stays at its original AWST time.",
          decision: "Resume with original calendar",
          tone: "primary" as const,
        }
      : baseDefinition;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const sync = () => setCompact(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  if (!active) return null;
  if (active.phoneModality === "status-banner") {
    if (!portalReady) return null;
    return createPortal(
      <section
        role="status"
        aria-label="Offline status"
        data-overlay-id={active.id}
        data-overlay-modality="status-banner"
        data-overlay-dismissal={active.dismissal}
        className="fixed inset-x-4 bottom-24 z-[var(--z-chrome)] rounded-[var(--radius-lg)] border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] p-[var(--pad-card)] shadow-[var(--e2)] md:bottom-6 md:left-auto md:max-w-lg"
      >
        <h2 className="font-semibold">{active.title}</h2>
        <p className="mt-1 text-sm text-[color:var(--text-muted)]">{active.content}</p>
        <div className="mt-3 flex justify-end">
          <Button variant="secondary" onClick={() => onDecision(active)}>
            {active.decision}
          </Button>
        </div>
      </section>,
      document.body,
    );
  }

  if (active.phoneModality === "session-gate") {
    return (
      <SessionExpiryGate
        open
        definition={active}
        onReauthenticate={() => onDecision(active)}
        returnFocusRef={returnFocusRef}
        compact={compact}
      />
    );
  }

  const modality = compact ? active.phoneModality : active.desktopModality;
  const inspectionDrawer = modality === "inspection-drawer";
  const fullScreenStage = modality === "full-screen-stage";
  const actionUnavailable = Boolean(mutationUnavailableReason) && active.mutatesState;
  const protectedDecision = active.id === "withdrawal" || active.id === "reassignment";
  const decisionLabel =
    protectedDecision && protectedStep
      ? active.id === "withdrawal"
        ? "Authenticate and record synthetic withdrawal"
        : "Authenticate and reassign synthetic plan"
      : active.decision;

  return (
    <Sheet
      open
      onClose={onClose}
      title={active.title}
      description={active.summary}
      returnFocusRef={returnFocusRef}
      closeLabel="Close governed decision"
      mobilePlacement={fullScreenStage ? "fullscreen" : "bottom"}
      desktopBackdropClassName={inspectionDrawer ? "lg:!items-stretch lg:!justify-end lg:!p-0" : undefined}
      contentStyle={
        inspectionDrawer
          ? {
              position: "fixed",
              inset: "0 0 0 auto",
              height: "100dvh",
              maxHeight: "100dvh",
              maxWidth: "32rem",
              borderRadius: "1rem 0 0 1rem",
            }
          : undefined
      }
      contentClassName={
        inspectionDrawer
          ? "lg:fixed lg:inset-y-0 lg:right-0 lg:h-dvh lg:max-h-dvh lg:max-w-[32rem] lg:rounded-none lg:rounded-l-2xl lg:border-y-0 lg:border-r-0"
          : undefined
      }
      testId={`caring-contact-overlay-${active.id}`}
      footer={
        <div className="flex justify-end">
          <Button
            variant={actionUnavailable ? "secondary" : active.tone === "danger" ? "danger" : "primary"}
            aria-disabled={actionUnavailable || undefined}
            aria-describedby={actionUnavailable ? "contextual-overlay-unavailable-reason" : undefined}
            title={actionUnavailable ? (mutationUnavailableReason ?? undefined) : undefined}
            onClick={() => {
              if (actionUnavailable) return;
              if (protectedDecision && !protectedStep) {
                setProtectedStep(true);
                announce("Fresh authentication checkpoint ready. Review the protected action before continuing.", {
                  eventId: `caring-contact:fresh-auth:${active.id}`,
                });
                return;
              }
              onDecision(active);
            }}
          >
            {decisionLabel}
          </Button>
        </div>
      }
    >
      <SpecificOverlayContent definition={active} modality={modality} />
      {protectedDecision && protectedStep ? (
        <div
          role="status"
          className="mt-4 rounded-[var(--radius-lg)] border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] p-4"
        >
          <p className="font-semibold text-[color:var(--text-heading)]">Fresh authentication checkpoint</p>
          <p className="mt-1 text-sm leading-6 text-[color:var(--text-muted)]">
            This prototype does not collect credentials. Continue only to simulate a freshly authenticated decision in
            local memory.
          </p>
        </div>
      ) : null}
      {actionUnavailable ? (
        <p
          id="contextual-overlay-unavailable-reason"
          className="mt-3 text-sm font-semibold text-[color:var(--warning)]"
        >
          {mutationUnavailableReason}
        </p>
      ) : null}
    </Sheet>
  );
}

export function OverlaySpecimens({
  offline,
  onOfflineChange,
  onOpenOverlay,
  renderInlineStatus = true,
}: {
  offline: boolean;
  onOfflineChange: (offline: boolean) => void;
  onOpenOverlay?: (overlayId: string) => void;
  renderInlineStatus?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [compact, setCompact] = useState(true);
  const activeTriggerRef = useRef<HTMLButtonElement>(null);
  const active = completionOverlayDefinitions.find(({ id }) => id === openId) ?? null;
  const offlineDefinition = completionOverlayDefinitions.find(
    ({ phoneModality }) => phoneModality === "status-banner",
  )!;
  const activeSessionGate = active?.phoneModality === "session-gate" ? active : null;
  const activeOverlay =
    active && active.phoneModality !== "session-gate" && active.phoneModality !== "status-banner" ? active : null;
  const activeModality = activeOverlay ? (compact ? activeOverlay.phoneModality : activeOverlay.desktopModality) : null;
  const activeActionUnavailable = offline && Boolean(activeOverlay?.mutatesState);
  const activeUsesInspectionDrawer = activeModality === "inspection-drawer";
  const activeUsesFullScreenStage = activeModality === "full-screen-stage";

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const sync = () => setCompact(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return (
    <section className="min-w-0 border-t border-[color:var(--border)] pt-[var(--gap-block)]">
      <div className="flex items-start gap-[var(--gap-inline)]">
        <ShieldCheck aria-hidden="true" className="mt-1 size-icon-lg shrink-0 text-[color:var(--clinical-accent)]" />
        <div>
          <h3 className="text-lg font-semibold">Decision overlay specimens</h3>
          <p className="mt-1 text-sm text-[color:var(--text-muted)]">
            All 24 named decisions are reachable, decision-specific and focus-safe. The frozen matrix selects a compact
            bottom sheet, desktop dialog, desktop inspection drawer, protected phone full-screen stage, non-dismissible
            session gate or persistent offline banner for each item.
          </p>
        </div>
      </div>

      <div className="mt-[var(--gap-block)] rounded-[var(--radius-xl)] border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-[var(--pad-panel)]">
        <div className="flex items-start gap-2">
          <Layers3 aria-hidden="true" className="mt-0.5 size-icon-md shrink-0 text-[color:var(--clinical-accent)]" />
          <div>
            <h3 className="text-lg font-semibold">Complete overlay interaction suite</h3>
            <p className="mt-1 text-sm text-[color:var(--text-muted)]">
              Open any specimen to inspect its exact object, boundary, decision and availability.
            </p>
          </div>
        </div>
        <ol
          aria-label="Complete overlay inventory"
          className="mt-[var(--gap-stack)] grid min-w-0 gap-2 text-sm sm:grid-cols-2"
        >
          {completionOverlayDefinitions.map((definition, index) => {
            const unavailableOffline = offline && definition.mutatesState;
            return (
              <li
                key={definition.id}
                className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2 border-t border-[color:var(--border)] pt-2"
              >
                <span className="pt-3 font-semibold tabular-nums text-[color:var(--clinical-accent)]">{index + 1}</span>
                <button
                  type="button"
                  aria-label={`Open ${definition.label}`}
                  data-overlay-trigger={definition.id}
                  aria-disabled={unavailableOffline || undefined}
                  data-mutates-state={definition.mutatesState ? "true" : "false"}
                  aria-describedby={unavailableOffline ? "caring-contact-offline-mutation-reason" : undefined}
                  title={unavailableOffline ? "Unavailable while offline — reconnect to continue" : undefined}
                  onClick={(event) => {
                    activeTriggerRef.current = event.currentTarget;
                    if (unavailableOffline) return;
                    if (onOpenOverlay) {
                      onOpenOverlay(definition.id);
                    } else if (definition.phoneModality === "status-banner") {
                      onOfflineChange(true);
                    } else {
                      setOpenId(definition.id);
                    }
                  }}
                  className="min-h-tap min-w-0 rounded-[var(--radius-md)] px-2 py-2 text-left hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] aria-disabled:cursor-not-allowed aria-disabled:text-[color:var(--disabled)]"
                >
                  <span className="block font-semibold">Open {definition.label}</span>
                  <span className="mt-0.5 block text-[color:var(--text-muted)]">{definition.summary}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {offline && renderInlineStatus ? (
        <section
          role="status"
          aria-label="Offline status"
          data-overlay-id={offlineDefinition.id}
          data-overlay-modality="status-banner"
          data-overlay-dismissal={offlineDefinition.dismissal}
          className="sticky bottom-[calc(var(--space-11)+var(--safe-area-bottom))] z-[var(--z-chrome)] mt-[var(--gap-block)] rounded-[var(--radius-lg)] border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] p-[var(--pad-card)] shadow-[var(--e1)] md:bottom-4"
        >
          <h4 className="font-semibold">{offlineDefinition.title}</h4>
          <p id="caring-contact-offline-mutation-reason" className="mt-1 text-sm text-[color:var(--text-muted)]">
            {offlineDefinition.content} Governed mutation is unavailable while offline.
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Offline status remains visible until connectivity is restored.</p>
            <Button variant="secondary" onClick={() => onOfflineChange(false)}>
              {offlineDefinition.decision}
            </Button>
          </div>
        </section>
      ) : null}

      <Sheet
        open={activeOverlay !== null}
        onClose={() => setOpenId(null)}
        title={activeOverlay?.title ?? "Overlay specimen"}
        description={activeOverlay?.summary}
        returnFocusRef={activeTriggerRef}
        closeLabel="Close overlay specimen"
        mobilePlacement={activeUsesFullScreenStage ? "fullscreen" : "bottom"}
        desktopBackdropClassName={activeUsesInspectionDrawer ? "lg:!items-stretch lg:!justify-end lg:!p-0" : undefined}
        contentStyle={
          activeUsesInspectionDrawer
            ? {
                position: "fixed",
                inset: "0 0 0 auto",
                height: "100dvh",
                maxHeight: "100dvh",
                maxWidth: "32rem",
                borderRadius: "1rem 0 0 1rem",
              }
            : undefined
        }
        contentClassName={
          activeUsesInspectionDrawer
            ? "lg:fixed lg:inset-y-0 lg:right-0 lg:h-dvh lg:max-h-dvh lg:max-w-[32rem] lg:rounded-none lg:rounded-l-2xl lg:border-y-0 lg:border-r-0"
            : undefined
        }
        testId={
          activeModality === "full-screen-stage"
            ? "completion-fullscreen-stage"
            : activeModality === "inspection-drawer"
              ? "completion-inspection-drawer"
              : activeModality === "bottom-sheet"
                ? "completion-bottom-sheet"
                : "completion-desktop-dialog"
        }
        footer={
          activeOverlay ? (
            <div className="flex justify-end">
              <Button
                variant={activeActionUnavailable ? "secondary" : activeOverlay.tone === "danger" ? "danger" : "primary"}
                aria-disabled={activeActionUnavailable || undefined}
                aria-describedby={
                  activeActionUnavailable ? "caring-contact-overlay-offline-decision-reason" : undefined
                }
                data-mutates-state={activeOverlay.mutatesState ? "true" : "false"}
                title={activeActionUnavailable ? "Unavailable while offline — reconnect to continue" : undefined}
                onClick={() => {
                  if (!activeActionUnavailable) setOpenId(null);
                }}
              >
                {activeOverlay.decision}
              </Button>
            </div>
          ) : undefined
        }
      >
        {activeOverlay && activeModality ? (
          <>
            <SpecificOverlayContent definition={activeOverlay} modality={activeModality} />
            {activeActionUnavailable ? (
              <p
                id="caring-contact-overlay-offline-decision-reason"
                className="mt-3 text-sm font-semibold text-[color:var(--warning)]"
              >
                Unavailable while offline — reconnect before recording this decision.
              </p>
            ) : null}
          </>
        ) : null}
      </Sheet>

      <SessionExpiryGate
        open={activeSessionGate !== null}
        definition={activeSessionGate ?? completionOverlayDefinitions[18]}
        onReauthenticate={() => setOpenId(null)}
        returnFocusRef={activeTriggerRef}
        compact={compact}
      />
    </section>
  );
}
